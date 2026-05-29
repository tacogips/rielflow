import { isJsonObject } from "../../shared/json";
import {
  chatReplyDispatchResultFromResponse,
  readOptionalChatReplyJson,
} from "./chat-reply-response";
import type { EventSourceChatReplyInput } from "../source-adapter";
import type { TelegramGatewaySourceConfig } from "../types";
import type { ChatReplyDispatchResult } from "../../workflow/types";

const TELEGRAM_PROVIDER = "telegram";
const DEFAULT_REST_BASE_URL = "https://api.telegram.org";

function isTelegramSource(
  source: unknown,
): source is TelegramGatewaySourceConfig {
  return isJsonObject(source) && source["kind"] === "telegram-gateway";
}

function requiredEnv(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly envName: string;
  readonly sourceId: string;
  readonly label: string;
}): string {
  const value = input.env[input.envName];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `telegram-gateway source '${input.sourceId}' ${input.label} env '${input.envName}' is not set`,
    );
  }
  return value;
}

function telegramApiUrl(input: {
  readonly source: TelegramGatewaySourceConfig;
  readonly token: string;
  readonly method: string;
}): string {
  const base = input.source.restBaseUrl ?? DEFAULT_REST_BASE_URL;
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalizedBase}/bot${input.token}/${input.method}`;
}

function replyToken(input: EventSourceChatReplyInput): string {
  const source = input.source as TelegramGatewaySourceConfig;
  const replyAs = input.request.message.replyAs;
  const botTokenEnv =
    replyAs === undefined ? undefined : source.replyBots?.[replyAs]?.tokenEnv;
  return requiredEnv({
    env: input.env,
    envName: botTokenEnv ?? source.tokenEnv,
    sourceId: source.id,
    label:
      botTokenEnv === undefined ? "bot token" : `reply bot '${replyAs}' token`,
  });
}

export async function dispatchTelegramGatewayReply(
  input: EventSourceChatReplyInput,
): Promise<ChatReplyDispatchResult> {
  if (!isTelegramSource(input.source)) {
    throw new Error(
      `telegram-gateway reply dispatch cannot use source kind '${input.source.kind}'`,
    );
  }
  const token = replyToken(input);
  const body: Record<string, unknown> = {
    chat_id: input.request.target.conversationId,
    text: input.request.message.text,
  };
  if (input.request.threadPolicy === "same-thread") {
    const messageId = Number(input.request.target.eventId);
    if (Number.isInteger(messageId) && messageId > 0) {
      body["reply_parameters"] = { message_id: messageId };
    }
    const threadId = Number(input.request.target.threadId);
    if (Number.isInteger(threadId) && threadId > 0) {
      body["message_thread_id"] = threadId;
    }
  }
  const response = await input.fetchImpl(
    telegramApiUrl({ source: input.source, token, method: "sendMessage" }),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    throw new Error(
      `telegram-gateway send rejected request with HTTP ${String(response.status)}`,
    );
  }
  const payload = await readOptionalChatReplyJson(response);
  const result = isJsonObject(payload?.["result"])
    ? payload["result"]
    : payload;
  const resultPayload = isJsonObject(result)
    ? {
        ...result,
        ...(typeof result["message_id"] === "number"
          ? { message_id: String(result["message_id"]) }
          : {}),
      }
    : payload;
  return chatReplyDispatchResultFromResponse({
    response,
    provider: input.source.provider ?? TELEGRAM_PROVIDER,
    payload: resultPayload,
    dispatchIdKeys: [],
    providerMessageIdKeys: ["message_id", "messageId"],
  });
}
