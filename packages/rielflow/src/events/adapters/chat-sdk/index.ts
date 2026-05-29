import type { EventSourceAdapter } from "../../source-adapter";
import type { ChatSdkSourceConfig } from "../../types";
import {
  attachChatSdkHistory,
  createChatSdkHistoryCache,
  recordAcceptedChatSdkHistory,
} from "./history";
import { normalizeChatSdkRawEvent } from "./normalization";
import { dispatchChatSdkReply } from "./reply";

export {
  CHAT_SDK_PROVIDER_CAPABILITIES,
  CHAT_SDK_PROVIDERS,
  getChatSdkProviderCapability,
  isChatSdkProvider,
} from "./types";
export { normalizeChatSdkRawEvent } from "./normalization";

export function createChatSdkEventSourceAdapter(): EventSourceAdapter {
  const historyCaches = new Map<
    string,
    ReturnType<typeof createChatSdkHistoryCache>
  >();
  const historyCacheFor = (source: ChatSdkSourceConfig) => {
    const existing = historyCaches.get(source.id);
    if (existing !== undefined) {
      return existing;
    }
    const created = createChatSdkHistoryCache(source);
    historyCaches.set(source.id, created);
    return created;
  };
  return {
    kind: "chat-sdk",
    capabilities: {
      eventTypes: ["chat.message"],
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
    async normalize(raw) {
      const event = normalizeChatSdkRawEvent(raw);
      if (raw.source?.kind !== "chat-sdk") {
        return event;
      }
      const source = raw.source as ChatSdkSourceConfig;
      return attachChatSdkHistory({
        source,
        event,
        raw,
        cache: historyCacheFor(source),
      });
    },
    async recordAcceptedEvent(input) {
      if (input.source.kind !== "chat-sdk") {
        return;
      }
      const source = input.source as ChatSdkSourceConfig;
      await recordAcceptedChatSdkHistory({
        accepted: input,
        cache: historyCacheFor(source),
      });
    },
    dispatchChatReply: dispatchChatSdkReply,
  };
}
