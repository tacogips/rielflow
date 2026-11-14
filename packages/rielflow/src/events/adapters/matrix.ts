import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isJsonObject, type JsonObject } from "../../shared/json";
import {
  chatHistoryBounds,
  ChatHistoryCache,
  createChatHistoryPersistence,
  trimChatHistory,
  type ChatHistoryPersistence,
  type GenericChatHistoryItem,
} from "./chat-history-persistence";
import {
  chatReplyDispatchResultFromResponse,
  readOptionalChatReplyJson,
} from "./chat-reply-response";
import {
  downloadMatrixAttachmentText,
  isMatrixAttachmentMessageType,
  readMatrixAttachmentMetadata,
  textWithMatrixAttachment,
  type MatrixAttachmentInput,
} from "./matrix-attachments";
import type {
  EventSourceAcceptedEventInput,
  EventSourceDiagnostic,
  EventSourceDiagnosticSink,
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

function matrixHistoryBounds(source: MatrixSourceConfig) {
  return chatHistoryBounds({
    history: isJsonObject(source.history) ? source.history : undefined,
    scope: "thread-or-room",
    includeBotMessagesKey: "includeOwnMessages",
  });
}

function matrixHistoryKey(input: {
  readonly source: MatrixSourceConfig;
  readonly roomId: string;
  readonly threadId?: string | undefined;
}): string {
  const bounds = matrixHistoryBounds(input.source);
  const threadComponent =
    bounds.scope === "thread-or-room" && input.threadId !== undefined
      ? input.threadId
      : "root";
  return `${input.source.id}:${input.roomId}:${threadComponent}`;
}

function matrixHistoryItem(input: {
  readonly source: MatrixSourceConfig;
  readonly event: ExternalEventEnvelope;
}): GenericChatHistoryItem | null {
  const roomId = input.event.conversation?.id;
  const sender = input.event.actor?.id;
  const text = input.event.input["text"];
  const msgtype = input.event.input["msgtype"];
  if (
    roomId === undefined ||
    sender === undefined ||
    typeof text !== "string"
  ) {
    return null;
  }
  return {
    messageId: input.event.eventId,
    authorId: sender,
    displayName: input.event.actor?.displayName ?? sender,
    isBot: sender === input.source.userId,
    createdAt: input.event.occurredAt ?? input.event.receivedAt,
    text,
    conversationId: roomId,
    ...(input.event.conversation?.threadId === undefined
      ? {}
      : { threadId: input.event.conversation.threadId }),
    provider: input.event.provider,
    ...(typeof msgtype === "string" ? { msgtype } : {}),
  };
}

async function seedMatrixHistory(input: {
  readonly source: MatrixSourceConfig;
  readonly key: string;
  readonly receivedAt: string;
  readonly cache: ChatHistoryCache;
  readonly persistence: ChatHistoryPersistence;
}): Promise<void> {
  if (input.cache.has(input.key)) {
    return;
  }
  const persisted = await input.persistence.load(input.key);
  input.cache.seed({
    key: input.key,
    history: persisted,
    receivedAt: input.receivedAt,
    mode: input.persistence.enabled ? "persisted" : "memory",
  });
}

function attachMatrixHistory(input: {
  readonly source: MatrixSourceConfig;
  readonly event: ExternalEventEnvelope;
  readonly cache: ChatHistoryCache;
  readonly key: string;
}): ExternalEventEnvelope {
  const bounds = matrixHistoryBounds(input.source);
  const history = input.cache.recent(input.key);
  return {
    ...input.event,
    input: {
      ...input.event.input,
      history,
      historySource: {
        mode: input.cache.sourceMode(input.key),
        historyKey: input.key,
        maxMessages: bounds.maxMessages,
        maxBytes: bounds.maxBytes,
        maxAgeMs: bounds.maxAgeMs,
        messageCount: history.length,
      },
    },
  };
}

async function appendAcceptedMatrixHistory(input: {
  readonly source: MatrixSourceConfig;
  readonly event: ExternalEventEnvelope;
  readonly cache: ChatHistoryCache;
  readonly persistence: ChatHistoryPersistence;
}): Promise<void> {
  if (input.source.history === undefined) {
    return;
  }
  const roomId = input.event.conversation?.id;
  if (roomId === undefined) {
    return;
  }
  const key = matrixHistoryKey({
    source: input.source,
    roomId,
    threadId: input.event.conversation?.threadId,
  });
  await seedMatrixHistory({
    source: input.source,
    key,
    receivedAt: input.event.receivedAt,
    cache: input.cache,
    persistence: input.persistence,
  });
  const item = matrixHistoryItem({ source: input.source, event: input.event });
  if (item === null) {
    return;
  }
  const next = input.cache.append({
    key,
    item,
    receivedAt: input.event.receivedAt,
  });
  await input.persistence.save(key, next);
}

function createMatrixHistoryCache(
  source: MatrixSourceConfig,
): ChatHistoryCache {
  const bounds = matrixHistoryBounds(source);
  return new ChatHistoryCache((input) =>
    trimChatHistory({
      history: input.history,
      bounds,
      receivedAt: input.receivedAt,
    }),
  );
}

function createMatrixHistoryPersistence(input: {
  readonly source: MatrixSourceConfig;
  readonly eventDataRoot?: string | undefined;
  readonly readOnly?: boolean | undefined;
  readonly diagnosticSink?: EventSourceDiagnosticSink | undefined;
}): ChatHistoryPersistence {
  return createChatHistoryPersistence({
    adapterKind: "matrix",
    eventDataRoot: input.eventDataRoot,
    readOnly: input.readOnly,
    sourceId: input.source.id,
    bounds: matrixHistoryBounds(input.source),
    diagnosticPrefix: "Matrix",
    diagnosticSink: input.diagnosticSink,
  });
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
  readonly attachment?: MatrixAttachmentInput;
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
  const bodyText = optionalString(content["body"]);
  const attachment = input.attachment ?? readMatrixAttachmentMetadata(content);
  const isTextMessage =
    msgtype !== undefined && TEXT_MESSAGE_TYPES.has(msgtype);
  const isAttachmentMessage =
    msgtype !== undefined &&
    attachment !== null &&
    isMatrixAttachmentMessageType(msgtype) &&
    input.source.attachments !== undefined;
  if (
    msgtype === undefined ||
    bodyText === undefined ||
    (!isTextMessage && !isAttachmentMessage)
  ) {
    return null;
  }
  const text = textWithMatrixAttachment({
    text: bodyText,
    ...(attachment === null ? {} : { attachment }),
  });
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
      ...(attachment === null
        ? {}
        : {
            attachments: [attachment],
            attachmentText: attachment.contentText ?? "",
          }),
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

async function normalizeOneMatrixRawEvent(
  raw: RawExternalEvent,
): Promise<ExternalEventEnvelope> {
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
      if (source.history === undefined) {
        return normalized;
      }
      const roomId = normalized.conversation?.id;
      if (roomId === undefined) {
        return normalized;
      }
      const cache = createMatrixHistoryCache(source);
      const persistence = createMatrixHistoryPersistence({
        source,
        eventDataRoot: raw.eventDataRoot,
        readOnly: raw.readOnly,
        diagnosticSink: raw.diagnosticSink,
      });
      const key = matrixHistoryKey({
        source,
        roomId,
        threadId: normalized.conversation?.threadId,
      });
      await seedMatrixHistory({
        source,
        key,
        receivedAt: raw.receivedAt,
        cache,
        persistence,
      });
      return attachMatrixHistory({ source, event: normalized, cache, key });
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
  const replyAs = input.request.message.replyAs;
  const accessTokenEnv =
    replyAs === undefined
      ? input.source.accessTokenEnv
      : (input.source.replyBots?.[replyAs]?.accessTokenEnv ??
        input.source.accessTokenEnv);
  const accessToken = requiredEnv({
    env: input.env,
    name: accessTokenEnv,
    label:
      replyAs === undefined ||
      input.source.replyBots?.[replyAs]?.accessTokenEnv === undefined
        ? "access token"
        : `reply bot '${replyAs}' access token`,
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
      const historyCache =
        source.history === undefined
          ? undefined
          : createMatrixHistoryCache(source);
      const historyPersistence =
        source.history === undefined
          ? undefined
          : createMatrixHistoryPersistence({
              source,
              eventDataRoot: input.eventDataRoot,
              readOnly: input.readOnly,
              diagnosticSink: input.diagnosticSink,
            });
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
            const content = candidate.event["content"];
            const attachmentMetadata = isJsonObject(content)
              ? readMatrixAttachmentMetadata(content)
              : null;
            const attachment =
              attachmentMetadata === null
                ? undefined
                : await downloadMatrixAttachmentText({
                    source,
                    attachment: attachmentMetadata,
                    homeserver,
                    accessToken,
                    fetchImpl,
                    diagnosticSink: input.diagnosticSink,
                  });
            const event = normalizeMatrixRoomEvent({
              source,
              roomId: candidate.roomId,
              event: candidate.event,
              receivedAt,
              rawRef: undefined,
              ...(attachment === undefined ? {} : { attachment }),
            });
            if (event !== null) {
              let eventWithHistory = event;
              if (
                historyCache !== undefined &&
                historyPersistence !== undefined
              ) {
                const historyKey = matrixHistoryKey({
                  source,
                  roomId: candidate.roomId,
                  threadId: event.conversation?.threadId,
                });
                await seedMatrixHistory({
                  source,
                  key: historyKey,
                  receivedAt,
                  cache: historyCache,
                  persistence: historyPersistence,
                });
                eventWithHistory = attachMatrixHistory({
                  source,
                  event,
                  cache: historyCache,
                  key: historyKey,
                });
              }
              const outcome = await input.dispatch(
                eventWithHistory,
                candidate.event,
              );
              const accepted =
                outcome === undefined ||
                outcome.receipts.some((receipt) => !receipt.duplicate);
              if (
                accepted &&
                historyCache !== undefined &&
                historyPersistence !== undefined
              ) {
                await appendAcceptedMatrixHistory({
                  source,
                  event: eventWithHistory,
                  cache: historyCache,
                  persistence: historyPersistence,
                });
              }
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
    async recordAcceptedEvent(
      input: EventSourceAcceptedEventInput,
    ): Promise<void> {
      if (!isMatrixSource(input.source)) {
        return;
      }
      const source = input.source;
      const cache = createMatrixHistoryCache(source);
      const persistence = createMatrixHistoryPersistence({
        source,
        eventDataRoot: input.eventDataRoot,
        readOnly: input.readOnly,
        diagnosticSink: input.diagnosticSink,
      });
      await appendAcceptedMatrixHistory({
        source,
        event: input.event,
        cache,
        persistence,
      });
    },
    dispatchChatReply: dispatchMatrixChatReply,
  };
}
