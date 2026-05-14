import type { JsonObject } from "../../../shared/json";
import type { ChatSdkProvider } from "../../types";

export const CHAT_SDK_PROVIDERS = [
  "slack",
  "teams",
  "gchat",
  "discord",
  "telegram",
  "github",
  "linear",
  "whatsapp",
  "messenger",
  "web",
] as const satisfies readonly ChatSdkProvider[];

export type ChatSdkNormalizedEventType =
  | "chat.message"
  | "chat.mention"
  | "chat.command"
  | "chat.action"
  | "chat.modal-submit";

export interface ChatSdkProviderCapability extends JsonObject {
  readonly provider: ChatSdkProvider;
  readonly eventTypes: readonly ChatSdkNormalizedEventType[];
  readonly reply: boolean;
}

export const CHAT_SDK_PROVIDER_CAPABILITIES: readonly ChatSdkProviderCapability[] =
  CHAT_SDK_PROVIDERS.map((provider) => ({
    provider,
    eventTypes: ["chat.message"],
    reply: true,
  }));

const CHAT_SDK_PROVIDER_SET: ReadonlySet<string> = new Set(CHAT_SDK_PROVIDERS);

export function isChatSdkProvider(value: unknown): value is ChatSdkProvider {
  return typeof value === "string" && CHAT_SDK_PROVIDER_SET.has(value);
}

export function getChatSdkProviderCapability(
  provider: ChatSdkProvider,
): ChatSdkProviderCapability {
  const capability = CHAT_SDK_PROVIDER_CAPABILITIES.find(
    (entry) => entry.provider === provider,
  );
  if (capability === undefined) {
    throw new Error(`unsupported Chat SDK provider '${provider}'`);
  }
  return capability;
}

export interface ChatSdkActorPayload extends JsonObject {
  readonly id: string;
  readonly displayName?: string;
}

export interface ChatSdkConversationPayload extends JsonObject {
  readonly id: string;
  readonly threadId?: string;
}

export interface ChatSdkMessagePayload extends JsonObject {
  readonly text: string;
  readonly format?: "plain" | "markdown";
  readonly attachments?: readonly JsonObject[];
}

export interface ChatSdkGenericInboundPayload extends JsonObject {
  readonly provider: ChatSdkProvider;
  readonly eventId?: string;
  readonly eventType?: string;
  readonly occurredAt?: string;
  readonly actor?: ChatSdkActorPayload;
  readonly conversation?: ChatSdkConversationPayload;
  readonly message?: ChatSdkMessagePayload;
  readonly action?: JsonObject | null;
}

export interface ChatSdkMessageInput extends JsonObject {
  readonly provider: ChatSdkProvider;
  readonly text: string;
  readonly format: "plain" | "markdown";
  readonly attachments: readonly JsonObject[];
  readonly action?: JsonObject | null;
  readonly rawEventType?: string;
}
