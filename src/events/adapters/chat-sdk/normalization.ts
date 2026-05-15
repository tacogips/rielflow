import { createHash } from "node:crypto";
import { isJsonObject, type JsonObject } from "../../../shared/json";
import type { RawExternalEvent } from "../../source-adapter";
import type {
  ChatSdkProvider,
  ChatSdkSourceConfig,
  EventActor,
  EventConversation,
  ExternalEventEnvelope,
} from "../../types";
import { isChatSdkProvider, type ChatSdkMessageInput } from "./types";

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readActor(value: unknown): EventActor | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const id = optionalString(value["id"]);
  if (id === undefined) {
    return undefined;
  }
  return {
    id,
    ...(typeof value["displayName"] === "string"
      ? { displayName: value["displayName"] }
      : {}),
  };
}

function readConversation(value: unknown): EventConversation | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const id = optionalString(value["id"]);
  if (id === undefined) {
    return undefined;
  }
  return {
    id,
    ...(typeof value["threadId"] === "string"
      ? { threadId: value["threadId"] }
      : {}),
  };
}

function readAttachments(value: unknown): readonly JsonObject[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isJsonObject);
}

function readMessageInput(input: {
  readonly provider: ChatSdkProvider;
  readonly body: JsonObject;
}): ChatSdkMessageInput {
  const message = input.body["message"];
  if (!isJsonObject(message)) {
    throw new Error("chat-sdk payload message must be a JSON object");
  }
  const text = optionalString(message["text"]);
  if (text === undefined) {
    throw new Error("chat-sdk payload message.text is required");
  }
  const format = message["format"] === "markdown" ? "markdown" : "plain";
  const action = input.body["action"];
  return {
    provider: input.provider,
    text,
    format,
    attachments: readAttachments(message["attachments"]),
    ...(isJsonObject(action) || action === null ? { action } : {}),
    ...(typeof input.body["eventType"] === "string"
      ? { rawEventType: input.body["eventType"] }
      : {}),
  };
}

function chatSdkSourceFromRaw(raw: RawExternalEvent): ChatSdkSourceConfig {
  if (raw.source?.kind !== "chat-sdk") {
    throw new Error("chat-sdk raw event requires a chat-sdk source");
  }
  return raw.source as ChatSdkSourceConfig;
}

function fallbackEventId(input: {
  readonly sourceId: string;
  readonly provider: ChatSdkProvider;
  readonly receivedAt: string;
  readonly body: JsonObject;
}): string {
  return hashJson({
    sourceId: input.sourceId,
    provider: input.provider,
    receivedAt: input.receivedAt,
    actor: input.body["actor"],
    conversation: input.body["conversation"],
    message: input.body["message"],
  });
}

export function normalizeChatSdkRawEvent(
  raw: RawExternalEvent,
): ExternalEventEnvelope {
  const source = chatSdkSourceFromRaw(raw);
  if (!isJsonObject(raw.body)) {
    throw new Error("chat-sdk body must be a JSON object");
  }
  const provider = raw.body["provider"];
  if (!isChatSdkProvider(provider)) {
    throw new Error("chat-sdk payload provider is unsupported");
  }
  if (provider !== source.provider) {
    throw new Error(
      `chat-sdk payload provider '${provider}' does not match source provider '${source.provider}'`,
    );
  }

  const eventId =
    optionalString(raw.body["eventId"]) ??
    fallbackEventId({
      sourceId: source.id,
      provider,
      receivedAt: raw.receivedAt,
      body: raw.body,
    });
  const actor = readActor(raw.body["actor"]);
  const conversation = readConversation(raw.body["conversation"]);
  const input = readMessageInput({ provider, body: raw.body });
  return {
    sourceId: source.id,
    eventId,
    provider,
    eventType: "chat.message",
    ...(typeof raw.body["occurredAt"] === "string"
      ? { occurredAt: raw.body["occurredAt"] }
      : {}),
    receivedAt: raw.receivedAt,
    dedupeKey:
      optionalString(raw.body["dedupeKey"]) ??
      `${source.id}:${provider}:${eventId}`,
    ...(actor === undefined ? {} : { actor }),
    ...(conversation === undefined ? {} : { conversation }),
    input,
    ...(raw.rawRef === undefined
      ? {}
      : { rawRef: { root: raw.rawRef.root, path: raw.rawRef.path } }),
  };
}
