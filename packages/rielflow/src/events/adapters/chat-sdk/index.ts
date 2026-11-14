import type { EventSourceAdapter } from "../../source-adapter";
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
      return normalizeChatSdkRawEvent(raw);
    },
    dispatchChatReply: dispatchChatSdkReply,
  };
}
