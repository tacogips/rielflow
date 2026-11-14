import { isJsonObject, type JsonObject } from "../../../shared/json";
import type { EventSourceConfig } from "../../types";

const REDACTED_ATTACHMENT_SOURCE = { redacted: true } as const;

function redactAttachmentRaw(value: unknown): unknown {
  if (!isJsonObject(value)) {
    return value;
  }
  if (value["source"] === undefined) {
    return value;
  }
  return {
    ...value,
    source: REDACTED_ATTACHMENT_SOURCE,
  };
}

function redactMessageRaw(value: unknown): unknown {
  if (!isJsonObject(value)) {
    return value;
  }
  const attachments = value["attachments"];
  if (!Array.isArray(attachments)) {
    return value;
  }
  return {
    ...value,
    attachments: attachments.map(redactAttachmentRaw),
  };
}

export function redactChatSdkRawPayloadForPersistence(input: {
  readonly source: EventSourceConfig;
  readonly body: unknown;
}): unknown {
  if (input.source.kind !== "chat-sdk" || !isJsonObject(input.body)) {
    return input.body;
  }
  const message = input.body["message"];
  const redactedMessage = redactMessageRaw(message);
  if (redactedMessage === message) {
    return input.body;
  }
  return {
    ...(input.body as JsonObject),
    message: redactedMessage,
  };
}
