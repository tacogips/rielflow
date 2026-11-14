import { hashJsonSha256 } from "../../../shared/artifacts";
import { isJsonObject, type JsonObject } from "../../../shared/json";
import type { RawExternalEvent } from "../../source-adapter";
import type {
  ChatSdkProvider,
  ChatSdkSourceConfig,
  EventActor,
  EventConversation,
  ExternalEventEnvelope,
} from "../../types";
import {
  isChatSdkProvider,
  type ChatSdkAttachmentDescriptor,
  type ChatSdkMessageInput,
} from "./types";

const MAX_INLINE_ATTACHMENT_EVIDENCE_CHARS = 16_384;
const MAX_CLASSIFICATION_HINT_CHARS = 1_024;
const SAFE_CONTENT_REF_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalBoundedString(input: {
  readonly value: unknown;
  readonly fieldName: string;
  readonly maxLength: number;
}): string | undefined {
  if (input.value === undefined) {
    return undefined;
  }
  if (typeof input.value !== "string") {
    throw new Error(`chat-sdk attachment ${input.fieldName} must be a string`);
  }
  if (input.value.length > input.maxLength) {
    throw new Error(
      `chat-sdk attachment ${input.fieldName} exceeds ${input.maxLength} characters`,
    );
  }
  return input.value;
}

function optionalAttachmentString(input: {
  readonly value: unknown;
  readonly fieldName: string;
}): string | undefined {
  if (input.value === undefined) {
    return undefined;
  }
  if (typeof input.value !== "string" || input.value.length === 0) {
    throw new Error(`chat-sdk attachment ${input.fieldName} must be a string`);
  }
  return input.value;
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

function isSafeContentRef(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  if (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
  ) {
    return false;
  }
  const segments = value.split(/[\\/]+/);
  return (
    segments.length > 0 &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        SAFE_CONTENT_REF_SEGMENT_PATTERN.test(segment),
    )
  );
}

function readAttachmentKind(
  value: unknown,
): ChatSdkAttachmentDescriptor["kind"] {
  if (value === undefined) {
    return undefined;
  }
  if (value === "image" || value === "pdf" || value === "other") {
    return value;
  }
  throw new Error("chat-sdk attachment kind must be image, pdf, or other");
}

function readOptionalNumber(input: {
  readonly value: unknown;
  readonly fieldName: string;
}): number | undefined {
  if (input.value === undefined) {
    return undefined;
  }
  if (
    typeof input.value !== "number" ||
    !Number.isFinite(input.value) ||
    input.value < 0
  ) {
    throw new Error(`chat-sdk attachment ${input.fieldName} must be a number`);
  }
  return input.value;
}

function redactAttachmentSource(
  value: unknown,
): JsonObject | string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" || isJsonObject(value)) {
    return { redacted: true };
  }
  throw new Error("chat-sdk attachment source must be a string or JSON object");
}

function readClassificationHints(
  value: unknown,
): ChatSdkAttachmentDescriptor["classificationHints"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (typeof entry !== "string") {
        throw new Error(
          "chat-sdk attachment classificationHints must be strings",
        );
      }
      if (entry.length > MAX_CLASSIFICATION_HINT_CHARS) {
        throw new Error(
          `chat-sdk attachment classificationHints entries exceed ${MAX_CLASSIFICATION_HINT_CHARS} characters`,
        );
      }
      return entry;
    });
  }
  if (isJsonObject(value)) {
    return value;
  }
  throw new Error(
    "chat-sdk attachment classificationHints must be an array or JSON object",
  );
}

function readAttachment(value: JsonObject): ChatSdkAttachmentDescriptor {
  const id = optionalAttachmentString({
    value: value["id"],
    fieldName: "id",
  });
  const kind = readAttachmentKind(value["kind"]);
  const mediaType = optionalAttachmentString({
    value: value["mediaType"],
    fieldName: "mediaType",
  });
  const filename = optionalAttachmentString({
    value: value["filename"],
    fieldName: "filename",
  });
  const sizeBytes = readOptionalNumber({
    value: value["sizeBytes"],
    fieldName: "sizeBytes",
  });
  const source = redactAttachmentSource(value["source"]);
  const textContent = optionalBoundedString({
    value: value["textContent"],
    fieldName: "textContent",
    maxLength: MAX_INLINE_ATTACHMENT_EVIDENCE_CHARS,
  });
  const imageDescription = optionalBoundedString({
    value: value["imageDescription"],
    fieldName: "imageDescription",
    maxLength: MAX_INLINE_ATTACHMENT_EVIDENCE_CHARS,
  });
  const classificationHints = readClassificationHints(
    value["classificationHints"],
  );
  const contentRef = optionalAttachmentString({
    value: value["contentRef"],
    fieldName: "contentRef",
  });
  if (contentRef !== undefined && !isSafeContentRef(contentRef)) {
    throw new Error(
      "chat-sdk attachment contentRef must be data-root-relative",
    );
  }

  return {
    ...value,
    ...(id === undefined ? {} : { id }),
    ...(kind === undefined ? {} : { kind }),
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(filename === undefined ? {} : { filename }),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    ...(source === undefined ? {} : { source }),
    ...(contentRef === undefined ? {} : { contentRef }),
    ...(textContent === undefined ? {} : { textContent }),
    ...(imageDescription === undefined ? {} : { imageDescription }),
    ...(classificationHints === undefined ? {} : { classificationHints }),
  };
}

function readAttachments(
  value: unknown,
): readonly ChatSdkAttachmentDescriptor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry, index) => {
    if (!isJsonObject(entry)) {
      throw new Error(
        `chat-sdk payload message.attachments[${index}] must be a JSON object`,
      );
    }
    return readAttachment(entry);
  });
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
  return hashJsonSha256({
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
