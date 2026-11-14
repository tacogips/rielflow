import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isJsonObject, type JsonObject } from "../../shared/json";
import {
  chatReplyDispatchResultFromResponse,
  readOptionalChatReplyJson,
} from "./chat-reply-response";
import type { EventSourceAdapter } from "../source-adapter";
import type { EventSourceChatReplyInput } from "../source-adapter";
import type {
  EventActor,
  EventConversation,
  ExternalEventEnvelope,
  WebhookSourceConfig,
} from "../types";
import type { ChatReplyDispatchResult } from "../../workflow/types";

export interface WebhookVerificationResult {
  readonly ok: boolean;
  readonly reason?:
    | "missing-secret"
    | "missing-signature"
    | "invalid-signature"
    | "replay";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeHeaders(
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

function stripSignaturePrefix(signature: string): string {
  return signature.startsWith("sha256=")
    ? signature.slice("sha256=".length)
    : signature;
}

function safeCompareHex(left: string, right: string): boolean {
  const normalizedLeft = stripSignaturePrefix(left);
  const normalizedRight = stripSignaturePrefix(right);
  if (
    !/^[0-9a-f]+$/i.test(normalizedLeft) ||
    !/^[0-9a-f]+$/i.test(normalizedRight)
  ) {
    return false;
  }
  const leftBuffer = Uint8Array.from(Buffer.from(normalizedLeft, "hex"));
  const rightBuffer = Uint8Array.from(Buffer.from(normalizedRight, "hex"));
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function verifyWebhookRequest(input: {
  readonly source: WebhookSourceConfig;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: Date;
}): WebhookVerificationResult {
  if (input.source.signingSecretEnv === undefined) {
    return { ok: true };
  }
  const secret = input.env[input.source.signingSecretEnv];
  if (secret === undefined || secret.length === 0) {
    return { ok: false, reason: "missing-secret" };
  }
  const headers = normalizeHeaders(input.headers);
  const signatureHeader = (
    input.source.signatureHeader ?? "x-divedra-signature"
  ).toLowerCase();
  const signature = headers[signatureHeader];
  if (signature === undefined || signature.length === 0) {
    return { ok: false, reason: "missing-signature" };
  }
  if (input.source.timestampHeader !== undefined) {
    const timestampRaw = headers[input.source.timestampHeader.toLowerCase()];
    const timestamp =
      timestampRaw === undefined ? Number.NaN : Number(timestampRaw);
    const timestampMs =
      timestamp > 9_999_999_999 ? timestamp : timestamp * 1000;
    const replayWindowMs = input.source.replayWindowMs ?? 300_000;
    if (
      !Number.isFinite(timestampMs) ||
      Math.abs(input.now.getTime() - timestampMs) > replayWindowMs
    ) {
      return { ok: false, reason: "replay" };
    }
  }
  const expected = createHmac("sha256", secret)
    .update(input.bodyText)
    .digest("hex");
  return safeCompareHex(signature, expected)
    ? { ok: true }
    : { ok: false, reason: "invalid-signature" };
}

function optionalObject(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function readActor(value: unknown): EventActor | undefined {
  if (!isJsonObject(value) || typeof value["id"] !== "string") {
    return undefined;
  }
  return {
    id: value["id"],
    ...(typeof value["displayName"] === "string"
      ? { displayName: value["displayName"] }
      : {}),
  };
}

function readConversation(value: unknown): EventConversation | undefined {
  if (!isJsonObject(value) || typeof value["id"] !== "string") {
    return undefined;
  }
  return {
    id: value["id"],
    ...(typeof value["threadId"] === "string"
      ? { threadId: value["threadId"] }
      : {}),
  };
}

async function dispatchWebhookChatReply(
  input: EventSourceChatReplyInput,
): Promise<ChatReplyDispatchResult> {
  if (input.source.kind !== "webhook") {
    throw new Error(
      `webhook reply dispatch cannot use source kind '${input.source.kind}'`,
    );
  }
  const source = input.source as WebhookSourceConfig;
  if (source.replyEndpointEnv === undefined) {
    throw new Error(
      `webhook source '${source.id}' does not configure replyEndpointEnv`,
    );
  }
  const endpoint = input.env[source.replyEndpointEnv];
  if (endpoint === undefined || endpoint.length === 0) {
    throw new Error(
      `webhook source '${source.id}' reply endpoint env '${source.replyEndpointEnv}' is not set`,
    );
  }

  const response = await input.fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-divedra-idempotency-key": input.request.idempotencyKey,
    },
    body: JSON.stringify({
      type: "divedra.chat_reply",
      sourceId: source.id,
      target: input.request.target,
      message: input.request.message,
      visibility: input.request.visibility,
      threadPolicy: input.request.threadPolicy,
      idempotencyKey: input.request.idempotencyKey,
      workflowId: input.request.workflowId,
      workflowExecutionId: input.request.workflowExecutionId,
      nodeId: input.request.nodeId,
      nodeExecId: input.request.nodeExecId,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `webhook reply endpoint rejected request with HTTP ${String(response.status)}`,
    );
  }

  const payload = await readOptionalChatReplyJson(response);
  return chatReplyDispatchResultFromResponse({
    response,
    provider: source.provider ?? "webhook",
    payload,
  });
}

export function createWebhookEventSourceAdapter(): EventSourceAdapter {
  return {
    kind: "webhook",
    capabilities: {
      eventTypes: [
        "webhook.event",
        "chat.message",
        "chat.command",
        "chat.action",
      ],
      supportsStart: false,
      webhook: true,
      chatReply: true,
    },
    async start(input) {
      return {
        sourceId: input.source.id,
        stop: async () => {},
      };
    },
    async normalize(raw): Promise<ExternalEventEnvelope> {
      if (!isJsonObject(raw.body)) {
        throw new Error("webhook body must be a JSON object");
      }
      const input = optionalObject(raw.body["input"]) ?? raw.body;
      const eventType =
        typeof raw.body["eventType"] === "string"
          ? raw.body["eventType"]
          : "webhook.event";
      const eventId =
        typeof raw.body["eventId"] === "string"
          ? raw.body["eventId"]
          : hash(`${raw.sourceId}:${raw.receivedAt}:${JSON.stringify(input)}`);
      const actor = readActor(raw.body["actor"]);
      const conversation = readConversation(raw.body["conversation"]);
      return {
        sourceId: raw.sourceId,
        eventId,
        provider:
          typeof raw.body["provider"] === "string"
            ? raw.body["provider"]
            : "webhook",
        eventType,
        ...(typeof raw.body["occurredAt"] === "string"
          ? { occurredAt: raw.body["occurredAt"] }
          : {}),
        receivedAt: raw.receivedAt,
        dedupeKey:
          typeof raw.body["dedupeKey"] === "string"
            ? raw.body["dedupeKey"]
            : hash(`${raw.sourceId}:${eventType}:${eventId}`),
        ...(actor === undefined ? {} : { actor }),
        ...(conversation === undefined ? {} : { conversation }),
        input,
        ...(raw.rawRef === undefined ? {} : { rawRef: raw.rawRef }),
      };
    },
    dispatchChatReply: dispatchWebhookChatReply,
  };
}
