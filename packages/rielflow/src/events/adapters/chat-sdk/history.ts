import { isJsonObject } from "../../../shared/json";
import type {
  EventSourceAcceptedEventInput,
  EventSourceDiagnosticSink,
  RawExternalEvent,
} from "../../source-adapter";
import type {
  ChatSdkProvider,
  ChatSdkSourceConfig,
  ExternalEventEnvelope,
} from "../../types";
import {
  chatHistoryBounds,
  ChatHistoryCache,
  createChatHistoryPersistence,
  trimChatHistory,
  type ChatHistoryPersistence,
  type GenericChatHistoryItem,
} from "../chat-history-persistence";

const CHAT_SDK_HISTORY_PROVIDERS = new Set<ChatSdkProvider>([
  "slack",
  "telegram",
]);

export function hasChatSdkHistory(
  source: ChatSdkSourceConfig,
): source is ChatSdkSourceConfig & {
  readonly history: NonNullable<ChatSdkSourceConfig["history"]>;
} {
  return (
    source.history !== undefined &&
    CHAT_SDK_HISTORY_PROVIDERS.has(source.provider)
  );
}

function chatSdkHistoryBounds(source: ChatSdkSourceConfig) {
  return chatHistoryBounds({
    history: isJsonObject(source.history) ? source.history : undefined,
    scope: "thread-or-conversation",
  });
}

export function chatSdkHistoryKey(input: {
  readonly source: ChatSdkSourceConfig;
  readonly event: ExternalEventEnvelope;
}): string | undefined {
  const conversationId = input.event.conversation?.id;
  if (conversationId === undefined) {
    return undefined;
  }
  const bounds = chatSdkHistoryBounds(input.source);
  const threadComponent =
    bounds.scope === "thread-or-conversation" &&
    input.event.conversation?.threadId !== undefined
      ? input.event.conversation.threadId
      : "root";
  return `${input.source.id}:${input.source.provider}:${conversationId}:${threadComponent}`;
}

export function chatSdkHistoryItem(input: {
  readonly source: ChatSdkSourceConfig;
  readonly event: ExternalEventEnvelope;
}): GenericChatHistoryItem | null {
  const conversationId = input.event.conversation?.id;
  const authorId = input.event.actor?.id;
  const text = input.event.input["text"];
  if (
    conversationId === undefined ||
    authorId === undefined ||
    typeof text !== "string"
  ) {
    return null;
  }
  return {
    messageId: input.event.eventId,
    authorId,
    ...(input.event.actor?.displayName === undefined
      ? {}
      : { displayName: input.event.actor.displayName }),
    ...(input.event.actor?.isBot === true ? { isBot: true } : {}),
    createdAt: input.event.occurredAt ?? input.event.receivedAt,
    text,
    conversationId,
    ...(input.event.conversation?.threadId === undefined
      ? {}
      : { threadId: input.event.conversation.threadId }),
    provider: input.source.provider,
  };
}

export function createChatSdkHistoryCache(
  source: ChatSdkSourceConfig,
): ChatHistoryCache {
  const bounds = chatSdkHistoryBounds(source);
  return new ChatHistoryCache((input) =>
    trimChatHistory({
      history: input.history,
      bounds,
      receivedAt: input.receivedAt,
    }),
  );
}

function createChatSdkHistoryPersistence(input: {
  readonly source: ChatSdkSourceConfig;
  readonly eventDataRoot?: string | undefined;
  readonly readOnly?: boolean | undefined;
  readonly diagnosticSink?: EventSourceDiagnosticSink | undefined;
}): ChatHistoryPersistence {
  return createChatHistoryPersistence({
    adapterKind: "chat-sdk",
    eventDataRoot: input.eventDataRoot,
    readOnly: input.readOnly,
    sourceId: input.source.id,
    bounds: chatSdkHistoryBounds(input.source),
    diagnosticPrefix: "ChatSdk",
    diagnosticSink: input.diagnosticSink,
  });
}

async function seedChatSdkHistory(input: {
  readonly source: ChatSdkSourceConfig;
  readonly key: string;
  readonly receivedAt: string;
  readonly cache: ChatHistoryCache;
  readonly persistence: ChatHistoryPersistence;
}): Promise<void> {
  if (input.cache.has(input.key)) {
    return;
  }
  const persisted = await input.persistence.load(input.key);
  input.cache.seed({
    key: input.key,
    history: persisted,
    receivedAt: input.receivedAt,
    mode: input.persistence.enabled ? "persisted" : "memory",
  });
}

export async function attachChatSdkHistory(input: {
  readonly source: ChatSdkSourceConfig;
  readonly event: ExternalEventEnvelope;
  readonly raw: RawExternalEvent;
  readonly cache: ChatHistoryCache;
}): Promise<ExternalEventEnvelope> {
  if (!hasChatSdkHistory(input.source)) {
    return input.event;
  }
  const key = chatSdkHistoryKey({ source: input.source, event: input.event });
  if (key === undefined) {
    return input.event;
  }
  const persistence = createChatSdkHistoryPersistence({
    source: input.source,
    eventDataRoot: input.raw.eventDataRoot,
    readOnly: input.raw.readOnly,
    diagnosticSink: input.raw.diagnosticSink,
  });
  await seedChatSdkHistory({
    source: input.source,
    key,
    receivedAt: input.event.receivedAt,
    cache: input.cache,
    persistence,
  });
  const bounds = chatSdkHistoryBounds(input.source);
  const history = input.cache.recent(key);
  return {
    ...input.event,
    input: {
      ...input.event.input,
      history,
      historySource: {
        mode: input.cache.sourceMode(key),
        historyKey: key,
        maxMessages: bounds.maxMessages,
        maxBytes: bounds.maxBytes,
        maxAgeMs: bounds.maxAgeMs,
        messageCount: history.length,
      },
    },
  };
}

export async function recordAcceptedChatSdkHistory(input: {
  readonly accepted: EventSourceAcceptedEventInput;
  readonly cache: ChatHistoryCache;
}): Promise<void> {
  if (input.accepted.source.kind !== "chat-sdk") {
    return;
  }
  const source = input.accepted.source as ChatSdkSourceConfig;
  if (!hasChatSdkHistory(source)) {
    return;
  }
  const key = chatSdkHistoryKey({ source, event: input.accepted.event });
  if (key === undefined) {
    return;
  }
  const persistence = createChatSdkHistoryPersistence({
    source,
    eventDataRoot: input.accepted.eventDataRoot,
    readOnly: input.accepted.readOnly,
    diagnosticSink: input.accepted.diagnosticSink,
  });
  await seedChatSdkHistory({
    source,
    key,
    receivedAt: input.accepted.event.receivedAt,
    cache: input.cache,
    persistence,
  });
  const item = chatSdkHistoryItem({ source, event: input.accepted.event });
  if (item === null) {
    return;
  }
  const next = input.cache.append({
    key,
    item,
    receivedAt: input.accepted.event.receivedAt,
  });
  await persistence.save(key, next);
}
