import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isJsonObject, type JsonObject } from "../../shared/json";
import {
  chatReplyDispatchResultFromResponse,
  readOptionalChatReplyJson,
} from "./chat-reply-response";
import type {
  EventSourceDiagnostic,
  EventSourceAdapter,
  EventSourceChatReplyInput,
  EventSourceHandle,
  RawExternalEvent,
} from "../source-adapter";
import type {
  ExternalEventEnvelope,
  MatrixSourceConfig,
  MatrixSourceRoomConfig,
} from "../types";
import type { ChatReplyDispatchResult } from "../../workflow/types";

const DEFAULT_SYNC_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 1000;
const TEXT_MESSAGE_TYPES = new Set(["m.text", "m.notice", "m.emote"]);
const MATRIX_SYNC_HTTP_ERROR_CLASS = "MatrixSyncHttpError";

interface MatrixRoomEvent {
  readonly roomId: string;
  readonly event: JsonObject;
}

export type MatrixSyncDiagnostic = EventSourceDiagnostic;

function normalizeErrorClass(error: unknown): string {
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  if (error instanceof Error && error.name.length > 0) {
    return error.name;
  }
  if (error instanceof DOMException && error.name.length > 0) {
    return error.name;
  }
  if (error !== null && typeof error === "object") {
    return error.constructor.name.length > 0
      ? error.constructor.name
      : "Object";
  }
  return typeof error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

export function sanitizeMatrixSyncFailureDiagnostic(input: {
  readonly sourceId: string;
  readonly status?: number;
  readonly error: unknown;
}): MatrixSyncDiagnostic {
  return {
    sourceId: input.sourceId,
    ...(input.status === undefined ? {} : { httpStatus: input.status }),
    errorClass: normalizeErrorClass(input.error),
  };
}

function isMatrixSource(source: unknown): source is MatrixSourceConfig {
  return isJsonObject(source) && source["kind"] === "matrix";
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function requiredEnv(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly name: string;
  readonly label: string;
  readonly sourceId: string;
}): string {
  const value = input.env[input.name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `matrix source '${input.sourceId}' ${input.label} env '${input.name}' is not set`,
    );
  }
  return value;
}

function matrixClientUrl(homeserver: string, pathname: string): string {
  const url = new URL(pathname, `${trimTrailingSlash(homeserver)}/`);
  return url.toString();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function errorCode(error: unknown): string | undefined {
  return isJsonObject(error) ? optionalString(error["code"]) : undefined;
}

function readRelation(content: JsonObject): JsonObject | undefined {
  const relation = content["m.relates_to"];
  return isJsonObject(relation) ? relation : undefined;
}

function readReplyToEventId(
  relation: JsonObject | undefined,
): string | undefined {
  const inReplyTo = relation?.["m.in_reply_to"];
  return isJsonObject(inReplyTo)
    ? optionalString(inReplyTo["event_id"])
    : undefined;
}

function readThreadRootEventId(
  relation: JsonObject | undefined,
): string | undefined {
  if (relation?.["rel_type"] !== "m.thread") {
    return undefined;
  }
  return optionalString(relation["event_id"]);
}

function readFormattedHtml(content: JsonObject): string | undefined {
  if (content["format"] !== "org.matrix.custom.html") {
    return undefined;
  }
  return optionalString(content["formatted_body"]);
}

function configuredRoomIds(source: MatrixSourceConfig): ReadonlySet<string> {
  return new Set(
    source.rooms.map((room: MatrixSourceRoomConfig) => room.roomId),
  );
}

function readRoomEvent(body: unknown): MatrixRoomEvent | null {
  if (!isJsonObject(body)) {
    return null;
  }
  const nestedEvent = body["event"];
  if (isJsonObject(nestedEvent)) {
    const roomId =
      optionalString(body["room_id"]) ?? optionalString(body["roomId"]);
    return roomId === undefined ? null : { roomId, event: nestedEvent };
  }
  const roomId =
    optionalString(body["room_id"]) ?? optionalString(body["roomId"]);
  return roomId === undefined ? null : { roomId, event: body };
}

function collectSyncRoomEvents(body: unknown): readonly MatrixRoomEvent[] {
  if (!isJsonObject(body)) {
    return [];
  }
  const rooms = body["rooms"];
  if (!isJsonObject(rooms)) {
    return [];
  }
  const joined = rooms["join"];
  if (!isJsonObject(joined)) {
    return [];
  }
  const events: MatrixRoomEvent[] = [];
  for (const [roomId, roomValue] of Object.entries(joined)) {
    if (!isJsonObject(roomValue)) {
      continue;
    }
    const timeline = roomValue["timeline"];
    if (!isJsonObject(timeline) || !Array.isArray(timeline["events"])) {
      continue;
    }
    for (const event of timeline["events"]) {
      if (isJsonObject(event)) {
        events.push({ roomId, event });
      }
    }
  }
  return events;
}

function normalizeMatrixRoomEvent(input: {
  readonly source: MatrixSourceConfig;
  readonly roomId: string;
  readonly event: JsonObject;
  readonly receivedAt: string;
  readonly rawRef: RawExternalEvent["rawRef"];
}): ExternalEventEnvelope | null {
  if (!configuredRoomIds(input.source).has(input.roomId)) {
    return null;
  }
  if (input.event["type"] !== "m.room.message") {
    return null;
  }
  const eventId = optionalString(input.event["event_id"]);
  const sender = optionalString(input.event["sender"]);
  const content = input.event["content"];
  if (eventId === undefined || sender === undefined || !isJsonObject(content)) {
    return null;
  }
  if (
    input.source.ignoreOwnMessages !== false &&
    sender === input.source.userId
  ) {
    return null;
  }
  const msgtype = optionalString(content["msgtype"]);
  const text = optionalString(content["body"]);
  if (
    msgtype === undefined ||
    !TEXT_MESSAGE_TYPES.has(msgtype) ||
    text === undefined
  ) {
    return null;
  }
  const relation = readRelation(content);
  const replyToEventId = readReplyToEventId(relation);
  const threadRootEventId = readThreadRootEventId(relation);
  const html = readFormattedHtml(content);
  const occurredAt =
    typeof input.event["origin_server_ts"] === "number"
      ? new Date(input.event["origin_server_ts"]).toISOString()
      : undefined;
  const threadId = threadRootEventId ?? replyToEventId;
  const replyTarget = {
    sourceId: input.source.id,
    provider: input.source.provider ?? "matrix",
    eventId,
    conversationId: input.roomId,
    ...(threadId === undefined ? {} : { threadId }),
    actorId: sender,
  };
  return {
    sourceId: input.source.id,
    eventId,
    provider: input.source.provider ?? "matrix",
    eventType: "chat.message",
    ...(occurredAt === undefined ? {} : { occurredAt }),
    receivedAt: input.receivedAt,
    dedupeKey: `${input.source.id}:${input.roomId}:${eventId}`,
    actor: { id: sender, displayName: sender },
    conversation: {
      id: input.roomId,
      ...(threadId === undefined ? {} : { threadId }),
    },
    input: {
      text,
      ...(html === undefined ? {} : { html }),
      roomId: input.roomId,
      eventId,
      sender,
      msgtype,
      ...(replyToEventId === undefined ? {} : { replyToEventId }),
      ...(threadRootEventId === undefined ? {} : { threadRootEventId }),
      replyTarget,
    },
    ...(input.rawRef === undefined ? {} : { rawRef: input.rawRef }),
  };
}

function sourceFromRaw(raw: RawExternalEvent): MatrixSourceConfig {
  if (!isMatrixSource(raw.source)) {
    throw new Error("matrix raw event requires a matrix source");
  }
  return raw.source;
}

function normalizeOneMatrixRawEvent(
  raw: RawExternalEvent,
): ExternalEventEnvelope {
  const source = sourceFromRaw(raw);
  const directEvent = readRoomEvent(raw.body);
  const candidates =
    directEvent === null ? collectSyncRoomEvents(raw.body) : [directEvent];
  for (const candidate of candidates) {
    const normalized = normalizeMatrixRoomEvent({
      source,
      roomId: candidate.roomId,
      event: candidate.event,
      receivedAt: raw.receivedAt,
      rawRef: raw.rawRef,
    });
    if (normalized !== null) {
      return normalized;
    }
  }
  throw new Error("matrix raw event did not contain a supported room message");
}

async function readSinceToken(
  filePath: string | undefined,
): Promise<string | undefined> {
  if (filePath === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return isJsonObject(parsed)
      ? optionalString(parsed["nextBatch"])
      : undefined;
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function writeSinceToken(
  filePath: string | undefined,
  nextBatch: string | undefined,
): Promise<void> {
  if (filePath === undefined || nextBatch === undefined) {
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify({ nextBatch }, null, 2)}\n`,
    "utf8",
  );
}

function buildMatrixReplyContent(input: EventSourceChatReplyInput): JsonObject {
  const content: JsonObject = {
    msgtype: "m.text",
    body: input.request.message.text,
  };
  const target = input.request.target;
  if (input.request.threadPolicy !== "same-thread") {
    return content;
  }
  if (target.threadId !== undefined) {
    return {
      ...content,
      "m.relates_to": {
        rel_type: "m.thread",
        event_id: target.threadId,
        is_falling_back: true,
        "m.in_reply_to": { event_id: target.eventId },
      },
    };
  }
  return {
    ...content,
    "m.relates_to": { "m.in_reply_to": { event_id: target.eventId } },
  };
}

export async function dispatchMatrixChatReply(
  input: EventSourceChatReplyInput,
): Promise<ChatReplyDispatchResult> {
  if (!isMatrixSource(input.source)) {
    throw new Error(
      `matrix reply dispatch cannot use source kind '${input.source.kind}'`,
    );
  }
  const homeserver = requiredEnv({
    env: input.env,
    name: input.source.homeserverUrlEnv,
    label: "homeserver URL",
    sourceId: input.source.id,
  });
  const accessToken = requiredEnv({
    env: input.env,
    name: input.source.accessTokenEnv,
    label: "access token",
    sourceId: input.source.id,
  });
  const roomId = input.request.target.conversationId;
  const url = matrixClientUrl(
    homeserver,
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(input.request.idempotencyKey)}`,
  );
  const response = await input.fetchImpl(url, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(buildMatrixReplyContent(input)),
  });
  if (!response.ok) {
    throw new Error(
      `matrix reply endpoint rejected request with HTTP ${String(response.status)}`,
    );
  }
  const payload = await readOptionalChatReplyJson(response);
  return chatReplyDispatchResultFromResponse({
    response,
    provider: input.source.provider ?? "matrix",
    payload,
    dispatchIdKeys: [],
    providerMessageIdKeys: ["event_id"],
  });
}

export function createMatrixEventSourceAdapter(): EventSourceAdapter {
  return {
    kind: "matrix",
    capabilities: {
      eventTypes: ["chat.message"],
      supportsStart: true,
      webhook: false,
      chatReply: true,
    },
    async start(input): Promise<EventSourceHandle> {
      if (!isMatrixSource(input.source)) {
        throw new Error("matrix adapter requires a matrix source");
      }
      const source = input.source;
      const env = input.env ?? process.env;
      const fetchImpl = input.fetchImpl ?? fetch;
      const homeserver = requiredEnv({
        env,
        name: source.homeserverUrlEnv,
        label: "homeserver URL",
        sourceId: source.id,
      });
      const accessToken = requiredEnv({
        env,
        name: source.accessTokenEnv,
        label: "access token",
        sourceId: source.id,
      });
      const sinceTokenPath = source.sync?.sinceTokenPath;
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let since = await readSinceToken(sinceTokenPath);
      const poll = async (): Promise<void> => {
        if (stopped || input.signal.aborted) {
          return;
        }
        let responseStatus: number | undefined;
        try {
          const url = new URL(
            matrixClientUrl(homeserver, "/_matrix/client/v3/sync"),
          );
          url.searchParams.set(
            "timeout",
            String(source.sync?.pollTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS),
          );
          if (since !== undefined) {
            url.searchParams.set("since", since);
          }
          const response = await fetchImpl(url.toString(), {
            method: "GET",
            headers: { authorization: `Bearer ${accessToken}` },
            signal: input.signal,
          });
          responseStatus = response.status;
          if (!response.ok) {
            input.diagnosticSink?.(
              sanitizeMatrixSyncFailureDiagnostic({
                sourceId: source.id,
                status: responseStatus,
                error: MATRIX_SYNC_HTTP_ERROR_CLASS,
              }),
            );
            return;
          }
          const body = (await response.json()) as unknown;
          const receivedAt = input.now().toISOString();
          for (const candidate of collectSyncRoomEvents(body)) {
            const event = normalizeMatrixRoomEvent({
              source,
              roomId: candidate.roomId,
              event: candidate.event,
              receivedAt,
              rawRef: undefined,
            });
            if (event !== null) {
              await input.dispatch(event, candidate.event);
            }
          }
          since = isJsonObject(body)
            ? optionalString(body["next_batch"])
            : undefined;
          await writeSinceToken(sinceTokenPath, since);
        } catch (error: unknown) {
          if (stopped || input.signal.aborted || isAbortError(error)) {
            return;
          }
          input.diagnosticSink?.(
            sanitizeMatrixSyncFailureDiagnostic({
              sourceId: source.id,
              ...(responseStatus === undefined
                ? {}
                : { status: responseStatus }),
              error,
            }),
          );
        } finally {
          if (!stopped && !input.signal.aborted) {
            timer = setTimeout(() => void poll(), RETRY_DELAY_MS);
          }
        }
      };
      void poll();
      const stop = (): void => {
        stopped = true;
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      };
      input.signal.addEventListener("abort", stop, { once: true });
      return {
        sourceId: source.id,
        stop: async () => {
          stop();
        },
      };
    },
    async normalize(raw): Promise<ExternalEventEnvelope> {
      return normalizeOneMatrixRawEvent(raw);
    },
    dispatchChatReply: dispatchMatrixChatReply,
  };
}
