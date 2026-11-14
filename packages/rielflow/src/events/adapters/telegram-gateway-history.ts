import type {
  ExternalEventEnvelope,
  TelegramGatewaySourceConfig,
} from "../types";
import type { EventSourceDiagnosticSink } from "../source-adapter";
import {
  chatHistoryBounds,
  ChatHistoryCache,
  createChatHistoryPersistence,
  trimChatHistory,
  type ChatHistoryPersistence,
  type GenericChatHistoryItem,
} from "./chat-history-persistence";
import { isJsonObject } from "../../shared/json";

function telegramHistoryBounds(source: TelegramGatewaySourceConfig) {
  return chatHistoryBounds({
    history: isJsonObject(source.history) ? source.history : undefined,
    scope: "chat",
  });
}

export function telegramHistoryKey(input: {
  readonly source: TelegramGatewaySourceConfig;
  readonly chatId: string;
}): string {
  return `${input.source.id}:${input.chatId}`;
}

export function createTelegramHistoryCache(
  source: TelegramGatewaySourceConfig,
): ChatHistoryCache {
  const bounds = telegramHistoryBounds(source);
  return new ChatHistoryCache((input) =>
    trimChatHistory({
      history: input.history,
      bounds,
      receivedAt: input.receivedAt,
    }),
  );
}

export function createTelegramHistoryPersistence(input: {
  readonly source: TelegramGatewaySourceConfig;
  readonly eventDataRoot?: string | undefined;
  readonly readOnly?: boolean | undefined;
  readonly diagnosticSink?: EventSourceDiagnosticSink | undefined;
}): ChatHistoryPersistence {
  return createChatHistoryPersistence({
    adapterKind: "telegram-gateway",
    eventDataRoot: input.eventDataRoot,
    readOnly: input.readOnly,
    sourceId: input.source.id,
    bounds: telegramHistoryBounds(input.source),
    diagnosticPrefix: "Telegram",
    diagnosticSink: input.diagnosticSink,
  });
}

export async function seedTelegramHistory(input: {
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

function telegramHistoryItem(
  event: ExternalEventEnvelope,
): GenericChatHistoryItem | null {
  const chatId = event.conversation?.id;
  const actorId = event.actor?.id;
  const text = event.input["text"];
  if (
    chatId === undefined ||
    actorId === undefined ||
    typeof text !== "string"
  ) {
    return null;
  }
  return {
    messageId: event.eventId,
    authorId: actorId,
    displayName: event.actor?.displayName ?? actorId,
    ...(event.actor?.isBot === undefined ? {} : { isBot: event.actor.isBot }),
    createdAt: event.occurredAt ?? event.receivedAt,
    text,
    conversationId: chatId,
    provider: event.provider,
  };
}

export function attachTelegramHistory(input: {
  readonly source: TelegramGatewaySourceConfig;
  readonly event: ExternalEventEnvelope;
  readonly cache: ChatHistoryCache;
  readonly key: string;
}): ExternalEventEnvelope {
  const bounds = telegramHistoryBounds(input.source);
  const history = input.cache.recent(input.key);
  return {
    ...input.event,
    input: {
      ...input.event.input,
      history,
      historySource: {
        mode: input.cache.sourceMode(input.key),
        historyKey: input.key,
        maxMessages: bounds.maxMessages,
        maxBytes: bounds.maxBytes,
        maxAgeMs: bounds.maxAgeMs,
        messageCount: history.length,
      },
    },
  };
}

export async function appendAcceptedTelegramHistory(input: {
  readonly source: TelegramGatewaySourceConfig;
  readonly event: ExternalEventEnvelope;
  readonly cache: ChatHistoryCache;
  readonly persistence: ChatHistoryPersistence;
}): Promise<void> {
  if (input.source.history === undefined) {
    return;
  }
  const chatId = input.event.conversation?.id;
  if (chatId === undefined) {
    return;
  }
  const key = telegramHistoryKey({ source: input.source, chatId });
  await seedTelegramHistory({
    key,
    receivedAt: input.event.receivedAt,
    cache: input.cache,
    persistence: input.persistence,
  });
  const item = telegramHistoryItem(input.event);
  if (item === null) {
    return;
  }
  const next = input.cache.append({
    key,
    item,
    receivedAt: input.event.receivedAt,
  });
  await input.persistence.save(key, next);
}
