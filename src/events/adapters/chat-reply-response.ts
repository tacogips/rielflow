import { isJsonObject, type JsonObject } from "../../shared/json";
import type { ChatReplyDispatchResult } from "../../workflow/types";

const DEFAULT_PROVIDER_MESSAGE_ID_KEYS = [
  "providerMessageId",
  "messageId",
  "id",
] as const;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function readOptionalChatReplyJson(
  response: Response,
): Promise<JsonObject | undefined> {
  try {
    const value = (await response.json()) as unknown;
    return isJsonObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function firstOptionalString(
  payload: JsonObject | undefined,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = optionalString(payload?.[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

export function chatReplyStatusFromResponse(
  response: Response,
): ChatReplyDispatchResult["status"] {
  return response.status === 202 ? "queued" : "sent";
}

export function chatReplyDispatchResultFromResponse(input: {
  readonly response: Response;
  readonly provider: string;
  readonly payload: JsonObject | undefined;
  readonly dispatchIdKeys?: readonly string[];
  readonly providerMessageIdKeys?: readonly string[];
}): ChatReplyDispatchResult {
  const dispatchId = firstOptionalString(input.payload, [
    ...(input.dispatchIdKeys ?? ["dispatchId"]),
  ]);
  const providerMessageId = firstOptionalString(
    input.payload,
    input.providerMessageIdKeys ?? DEFAULT_PROVIDER_MESSAGE_ID_KEYS,
  );
  return {
    status: chatReplyStatusFromResponse(input.response),
    provider: input.provider,
    ...(dispatchId === undefined ? {} : { dispatchId }),
    ...(providerMessageId === undefined ? {} : { providerMessageId }),
  };
}
