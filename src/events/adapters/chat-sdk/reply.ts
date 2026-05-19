import type { EventSourceChatReplyInput } from "../../source-adapter";
import type { ChatSdkSourceConfig } from "../../types";
import type { ChatReplyDispatchResult } from "../../../workflow/types";
import {
  chatReplyDispatchResultFromResponse,
  readOptionalChatReplyJson,
} from "../chat-reply-response";

function chatSdkSource(input: EventSourceChatReplyInput): ChatSdkSourceConfig {
  if (input.source.kind !== "chat-sdk") {
    throw new Error(
      `chat-sdk reply dispatch cannot use source kind '${input.source.kind}'`,
    );
  }
  return input.source as ChatSdkSourceConfig;
}

export async function dispatchChatSdkReply(
  input: EventSourceChatReplyInput,
): Promise<ChatReplyDispatchResult> {
  const source = chatSdkSource(input);
  const send = source.send;
  if (send === undefined) {
    throw new Error(`chat-sdk source '${source.id}' does not configure send`);
  }
  const endpoint = input.env[send.endpointUrlEnv];
  if (endpoint === undefined || endpoint.length === 0) {
    throw new Error(
      `chat-sdk source '${source.id}' send endpoint env '${send.endpointUrlEnv}' is not set`,
    );
  }
  const token =
    send.tokenEnv === undefined ? undefined : input.env[send.tokenEnv];
  if (
    send.tokenEnv !== undefined &&
    (token === undefined || token.length === 0)
  ) {
    throw new Error(
      `chat-sdk source '${source.id}' send token env '${send.tokenEnv}' is not set`,
    );
  }

  const response = await input.fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-divedra-idempotency-key": input.request.idempotencyKey,
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({
      provider: source.provider,
      target: {
        conversationId: input.request.target.conversationId,
        ...(input.request.target.threadId === undefined
          ? {}
          : { threadId: input.request.target.threadId }),
      },
      message: input.request.message,
      idempotencyKey: input.request.idempotencyKey,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `chat-sdk send endpoint rejected request with HTTP ${String(response.status)}`,
    );
  }

  const payload = await readOptionalChatReplyJson(response);
  return chatReplyDispatchResultFromResponse({
    response,
    provider: source.provider,
    payload,
  });
}
