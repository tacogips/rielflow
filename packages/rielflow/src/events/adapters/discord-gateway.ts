import { isJsonObject, type JsonObject } from "../../shared/json";
import {
  chatReplyDispatchResultFromResponse,
  readOptionalChatReplyJson,
} from "./chat-reply-response";
import {
  createDiscordGatewayHistoryPersistence,
  discordGatewayHistoryConfig as historyConfig,
  discordGatewayChannelHistoryKey,
  discordGatewayHistoryConversationId,
  discordGatewayHistoryKey,
  DiscordGatewayHistoryCache,
  mergeDiscordGatewayHistoryEntries,
  persistedHistoryBounds,
  readDiscordGatewayHistorySourceMode,
  type DiscordGatewayHistoryPersistence,
} from "./discord-gateway-history-persistence";
import type {
  EventSourceAdapter,
  EventSourceChatReplyInput,
  EventSourceHandle,
  EventSourceStartInput,
  RawExternalEvent,
} from "../source-adapter";
import type {
  DiscordGatewayChannelConfig,
  DiscordGatewaySourceConfig,
  ExternalEventEnvelope,
} from "../types";
import type { ChatReplyDispatchResult } from "../../workflow/types";

const DISCORD_PROVIDER = "discord";
const DEFAULT_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const DEFAULT_REST_BASE_URL = "https://discord.com/api/v10";
const DEFAULT_INTENTS = 512 | 32_768;

interface DiscordAuthor {
  readonly id: string;
  readonly username?: string;
  readonly globalName?: string;
  readonly bot?: boolean;
}

export interface DiscordGatewayHistoryItem extends JsonObject {
  readonly messageId: string;
  readonly authorId: string;
  readonly displayName?: string;
  readonly username?: string;
  readonly isBot: boolean;
  readonly createdAt?: string;
  readonly text: string;
  readonly conversationId: string;
  readonly threadId?: string;
}

interface DiscordMessage {
  readonly id: string;
  readonly channelId: string;
  readonly parentChannelId?: string;
  readonly guildId?: string;
  readonly author: DiscordAuthor;
  readonly content: string;
  readonly timestamp?: string;
  readonly mentions: readonly string[];
}

interface DiscordGatewayPayload {
  readonly op?: number;
  readonly t?: string;
  readonly s?: number;
  readonly d?: unknown;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isDiscordSource(
  source: unknown,
): source is DiscordGatewaySourceConfig {
  return isJsonObject(source) && source["kind"] === "discord-gateway";
}

function sourceFromRaw(raw: RawExternalEvent): DiscordGatewaySourceConfig {
  if (!isDiscordSource(raw.source)) {
    throw new Error(
      "discord-gateway raw event requires a discord-gateway source",
    );
  }
  return raw.source;
}

function displayName(author: DiscordAuthor): string | undefined {
  return author.globalName ?? author.username;
}

function readAuthor(value: unknown): DiscordAuthor | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const id = optionalString(value["id"]);
  if (id === undefined) {
    return null;
  }
  const username = optionalString(value["username"]);
  const globalName =
    optionalString(value["global_name"]) ?? optionalString(value["globalName"]);
  const bot = optionalBoolean(value["bot"]);
  return {
    id,
    ...(username === undefined ? {} : { username }),
    ...(globalName === undefined ? {} : { globalName }),
    ...(bot === undefined ? {} : { bot }),
  };
}

function readMentionIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!isJsonObject(entry)) {
      return [];
    }
    const id = optionalString(entry["id"]);
    return id === undefined ? [] : [id];
  });
}

function readMessageBody(body: unknown): DiscordMessage {
  const message =
    isJsonObject(body) && body["t"] === "MESSAGE_CREATE"
      ? body["d"]
      : isJsonObject(body) && isJsonObject(body["event"])
        ? body["event"]
        : body;
  if (!isJsonObject(message)) {
    throw new Error("discord-gateway message payload must be a JSON object");
  }
  const id = optionalString(message["id"]);
  const channelId =
    optionalString(message["channel_id"]) ??
    optionalString(message["channelId"]);
  const author = readAuthor(message["author"]);
  if (id === undefined || channelId === undefined || author === null) {
    throw new Error(
      "discord-gateway MESSAGE_CREATE requires id, channel_id, and author",
    );
  }
  const content =
    optionalString(message["content"]) ?? optionalString(message["text"]) ?? "";
  const parentChannelId =
    optionalString(message["parent_channel_id"]) ??
    optionalString(message["parentChannelId"]);
  const guildId = optionalString(message["guild_id"]);
  const timestamp = optionalString(message["timestamp"]);
  return {
    id,
    channelId,
    ...(parentChannelId === undefined ? {} : { parentChannelId }),
    ...(guildId === undefined ? {} : { guildId }),
    author,
    content,
    ...(timestamp === undefined ? {} : { timestamp }),
    mentions: readMentionIds(message["mentions"]),
  };
}

function toHistoryItem(
  message: DiscordMessage,
  current: DiscordMessage,
): DiscordGatewayHistoryItem | null {
  if (message.id === current.id) {
    return null;
  }
  const name = displayName(message.author);
  return {
    messageId: message.id,
    authorId: message.author.id,
    ...(name === undefined ? {} : { displayName: name }),
    ...(message.author.username === undefined
      ? {}
      : { username: message.author.username }),
    isBot: message.author.bot === true,
    ...(message.timestamp === undefined
      ? {}
      : { createdAt: message.timestamp }),
    text: message.content,
    conversationId: message.parentChannelId ?? message.channelId,
    ...(message.parentChannelId === undefined
      ? {}
      : { threadId: message.channelId }),
  };
}

function normalizeHistoryEntry(
  value: unknown,
  current: DiscordMessage,
): DiscordGatewayHistoryItem | null {
  if (!isJsonObject(value)) {
    return null;
  }
  if (typeof value["messageId"] === "string") {
    const text = optionalString(value["text"]) ?? "";
    const authorId = optionalString(value["authorId"]) ?? "unknown";
    const name = optionalString(value["displayName"]);
    const username = optionalString(value["username"]);
    const createdAt = optionalString(value["createdAt"]);
    const threadId = optionalString(value["threadId"]);
    return {
      messageId: value["messageId"],
      authorId,
      ...(name === undefined ? {} : { displayName: name }),
      ...(username === undefined ? {} : { username }),
      isBot: value["isBot"] === true,
      ...(createdAt === undefined ? {} : { createdAt }),
      text,
      conversationId:
        optionalString(value["conversationId"]) ?? current.channelId,
      ...(threadId === undefined ? {} : { threadId }),
    };
  }
  try {
    return toHistoryItem(readMessageBody(value), current);
  } catch {
    return null;
  }
}

function trimHistory(input: {
  readonly history: readonly DiscordGatewayHistoryItem[];
  readonly source: DiscordGatewaySourceConfig;
  readonly receivedAt: string;
}): readonly DiscordGatewayHistoryItem[] {
  const config = historyConfig(input.source);
  const cutoff = Date.parse(input.receivedAt) - config.maxAgeMs;
  const byAgeAndBot = input.history
    .filter((entry) => {
      if (!config.includeBotMessages && entry.isBot) {
        return false;
      }
      if (entry.createdAt === undefined) {
        return true;
      }
      const createdAt = Date.parse(entry.createdAt);
      return Number.isNaN(createdAt) || createdAt >= cutoff;
    })
    .toSorted((left, right) => {
      const leftTime =
        left.createdAt === undefined ? 0 : Date.parse(left.createdAt);
      const rightTime =
        right.createdAt === undefined ? 0 : Date.parse(right.createdAt);
      return leftTime - rightTime;
    });
  const newestBounded = byAgeAndBot.slice(-config.maxMessages);
  const selected: DiscordGatewayHistoryItem[] = [];
  let bytes = 0;
  for (const entry of [...newestBounded].reverse()) {
    const entryBytes = JSON.stringify(entry).length;
    if (entryBytes > config.maxBytes) {
      continue;
    }
    const nextBytes = bytes + entryBytes;
    if (nextBytes > config.maxBytes) {
      break;
    }
    selected.push(entry);
    bytes = nextBytes;
  }
  return selected.reverse();
}

function readHistory(
  body: unknown,
  current: DiscordMessage,
): readonly DiscordGatewayHistoryItem[] {
  if (!isJsonObject(body) || !Array.isArray(body["history"])) {
    return [];
  }
  return body["history"].flatMap((entry) => {
    const normalized = normalizeHistoryEntry(entry, current);
    return normalized === null ? [] : [normalized];
  });
}

function conversationFor(message: DiscordMessage): {
  readonly id: string;
  readonly threadId?: string;
} {
  if (message.parentChannelId !== undefined) {
    return { id: message.parentChannelId, threadId: message.channelId };
  }
  return { id: message.channelId };
}

function configuredChannelForMessage(
  source: DiscordGatewaySourceConfig,
  message: DiscordMessage,
): DiscordGatewayChannelConfig | undefined {
  const exactChannel = source.channels.find(
    (channel) => channel.id === message.channelId,
  );
  if (exactChannel !== undefined) {
    return exactChannel;
  }
  if (message.parentChannelId === undefined) {
    return undefined;
  }
  return source.channels.find(
    (channel) => channel.id === message.parentChannelId,
  );
}

function threadParentFromGatewayPayload(
  value: unknown,
): { readonly threadId: string; readonly parentChannelId: string } | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const threadId = optionalString(value["id"]);
  const parentChannelId =
    optionalString(value["parent_id"]) ??
    optionalString(value["parentChannelId"]);
  if (threadId === undefined || parentChannelId === undefined) {
    return undefined;
  }
  return { threadId, parentChannelId };
}

function rememberThreadParent(
  threadParents: Map<string, string>,
  value: unknown,
): void {
  const parent = threadParentFromGatewayPayload(value);
  if (parent !== undefined) {
    threadParents.set(parent.threadId, parent.parentChannelId);
  }
}

function withParentChannel(
  message: DiscordMessage,
  parentChannelId: string | undefined,
): DiscordMessage {
  if (
    message.parentChannelId !== undefined ||
    parentChannelId === undefined ||
    parentChannelId.length === 0
  ) {
    return message;
  }
  return { ...message, parentChannelId };
}

function shouldAcceptMessage(input: {
  readonly source: DiscordGatewaySourceConfig;
  readonly message: DiscordMessage;
  readonly applicationId?: string;
}): boolean {
  const configuredChannel = configuredChannelForMessage(
    input.source,
    input.message,
  );
  if (configuredChannel === undefined) {
    return false;
  }
  if (
    input.message.parentChannelId !== undefined &&
    configuredChannel.id === input.message.parentChannelId &&
    configuredChannel.includeThreads === false
  ) {
    return false;
  }
  const filters = input.source.filters ?? {};
  if ((filters.ignoreBots ?? true) && input.message.author.bot === true) {
    return false;
  }
  if (
    (filters.ignoreSelf ?? true) &&
    input.applicationId !== undefined &&
    input.message.author.id === input.applicationId
  ) {
    return false;
  }
  if (
    filters.requireMention === true &&
    input.applicationId !== undefined &&
    !input.message.mentions.includes(input.applicationId)
  ) {
    return false;
  }
  return true;
}

export function normalizeDiscordGatewayRawEvent(
  raw: RawExternalEvent,
): ExternalEventEnvelope {
  const source = sourceFromRaw(raw);
  const message = readMessageBody(raw.body);
  const conversation = conversationFor(message);
  const actorDisplayName = displayName(message.author);
  const history = trimHistory({
    history: readHistory(raw.body, message),
    source,
    receivedAt: raw.receivedAt,
  });
  return {
    sourceId: source.id,
    eventId: message.id,
    provider: DISCORD_PROVIDER,
    eventType: "chat.message",
    ...(message.timestamp === undefined
      ? {}
      : { occurredAt: message.timestamp }),
    receivedAt: raw.receivedAt,
    dedupeKey: `${source.id}:${message.id}`,
    actor: {
      id: message.author.id,
      ...(actorDisplayName === undefined
        ? {}
        : { displayName: actorDisplayName }),
      ...(message.author.username === undefined
        ? {}
        : { username: message.author.username }),
      isBot: message.author.bot === true,
    },
    conversation,
    input: {
      provider: DISCORD_PROVIDER,
      text: message.content,
      history,
      historySource: {
        mode: readDiscordGatewayHistorySourceMode(raw.body),
        maxMessages: historyConfig(source).maxMessages,
        maxBytes: historyConfig(source).maxBytes,
        maxAgeMs: historyConfig(source).maxAgeMs,
        count: history.length,
      },
      discord: {
        messageId: message.id,
        channelId: message.channelId,
        ...(message.parentChannelId === undefined
          ? {}
          : { parentChannelId: message.parentChannelId }),
        ...(message.guildId === undefined ? {} : { guildId: message.guildId }),
      },
      replyTarget: {
        sourceId: source.id,
        provider: DISCORD_PROVIDER,
        eventId: message.id,
        conversationId: conversation.id,
        ...(conversation.threadId === undefined
          ? {}
          : { threadId: conversation.threadId }),
        actorId: message.author.id,
      },
    },
    ...(raw.rawRef === undefined
      ? {}
      : { rawRef: { root: raw.rawRef.root, path: raw.rawRef.path } }),
  };
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
      `discord-gateway source '${input.sourceId}' ${input.label} env '${input.envName}' is not set`,
    );
  }
  return value;
}

function discordRestUrl(
  source: DiscordGatewaySourceConfig,
  path: string,
): string {
  const base = source.restBaseUrl ?? DEFAULT_REST_BASE_URL;
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
}

function replyToken(input: EventSourceChatReplyInput): string {
  const source = input.source as DiscordGatewaySourceConfig;
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

export async function dispatchDiscordGatewayReply(
  input: EventSourceChatReplyInput,
): Promise<ChatReplyDispatchResult> {
  if (!isDiscordSource(input.source)) {
    throw new Error(
      `discord-gateway reply dispatch cannot use source kind '${input.source.kind}'`,
    );
  }
  const token = replyToken(input);
  const channelId =
    input.request.threadPolicy === "same-thread"
      ? (input.request.target.threadId ?? input.request.target.conversationId)
      : input.request.target.conversationId;
  const response = await input.fetchImpl(
    discordRestUrl(input.source, `channels/${channelId}/messages`),
    {
      method: "POST",
      headers: {
        authorization: `Bot ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: input.request.message.text,
        allowed_mentions: { parse: [] },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `discord-gateway send rejected request with HTTP ${String(response.status)}`,
    );
  }
  const payload = await readOptionalChatReplyJson(response);
  return chatReplyDispatchResultFromResponse({
    response,
    provider: DISCORD_PROVIDER,
    payload,
  });
}

async function fetchDiscordHistory(input: {
  readonly source: DiscordGatewaySourceConfig;
  readonly token: string;
  readonly channelId: string;
  readonly current: DiscordMessage;
  readonly fetchImpl: typeof fetch;
}): Promise<readonly DiscordGatewayHistoryItem[]> {
  const maxMessages = historyConfig(input.source).maxMessages;
  const response = await input.fetchImpl(
    discordRestUrl(
      input.source,
      `channels/${input.channelId}/messages?limit=${String(maxMessages)}`,
    ),
    { headers: { authorization: `Bot ${input.token}` } },
  );
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) {
    return [];
  }
  return body.flatMap((entry) => {
    const normalized = normalizeHistoryEntry(entry, input.current);
    return normalized === null ? [] : [normalized];
  });
}

async function fetchDiscordChannelParentId(input: {
  readonly source: DiscordGatewaySourceConfig;
  readonly token: string;
  readonly channelId: string;
  readonly fetchImpl: typeof fetch;
}): Promise<string | undefined> {
  const response = await input.fetchImpl(
    discordRestUrl(input.source, `channels/${input.channelId}`),
    { headers: { authorization: `Bot ${input.token}` } },
  );
  if (!response.ok) {
    return undefined;
  }
  const body = (await response.json()) as unknown;
  if (!isJsonObject(body)) {
    return undefined;
  }
  return (
    optionalString(body["parent_id"]) ?? optionalString(body["parentChannelId"])
  );
}

function gatewayPayload(value: unknown): DiscordGatewayPayload {
  return isJsonObject(value) ? (value as DiscordGatewayPayload) : {};
}

function sendGatewayJson(socket: WebSocket, value: JsonObject): void {
  socket.send(JSON.stringify(value));
}

function enqueueSerialized(
  queues: Map<string, Promise<void>>,
  key: string,
  task: () => Promise<void>,
): Promise<void> {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const tracked = run
    .catch(() => undefined)
    .then(() => {
      if (queues.get(key) === tracked) {
        queues.delete(key);
      }
    });
  queues.set(key, tracked);
  return run;
}

async function seedHistoryOnStart(input: {
  readonly source: DiscordGatewaySourceConfig;
  readonly token: string;
  readonly cache: DiscordGatewayHistoryCache;
  readonly fetchImpl: typeof fetch;
  readonly receivedAt: string;
  readonly persistence: DiscordGatewayHistoryPersistence;
  readonly diagnosticSink?: EventSourceStartInput["diagnosticSink"];
}): Promise<void> {
  await Promise.all(
    input.source.channels.map(async (channel) => {
      try {
        const key = discordGatewayChannelHistoryKey(
          input.source.id,
          channel.id,
        );
        const persisted = await input.persistence.load(key, input.receivedAt);
        if (persisted.length > 0 || input.persistence.enabled) {
          input.cache.seed({
            key,
            history: persisted,
            source: input.source,
            receivedAt: input.receivedAt,
            mode: "persisted",
          });
        }
        if (input.source.history?.fetchOnStart !== true) {
          return;
        }
        const current: DiscordMessage = {
          id: "",
          channelId: channel.id,
          author: { id: "" },
          content: "",
          mentions: [],
        };
        const history = await fetchDiscordHistory({
          source: input.source,
          token: input.token,
          channelId: channel.id,
          current,
          fetchImpl: input.fetchImpl,
        });
        const merged = mergeDiscordGatewayHistoryEntries(persisted, history);
        input.cache.seed({
          key,
          history: merged,
          source: input.source,
          receivedAt: input.receivedAt,
          mode:
            persisted.length > 0 && history.length > 0
              ? "mixed"
              : history.length > 0
                ? "rest"
                : persisted.length > 0
                  ? "persisted"
                  : "empty",
        });
        if (input.persistence.enabled) {
          await input.persistence.save(
            key,
            input.cache.recent(key),
            input.receivedAt,
          );
        }
      } catch (error: unknown) {
        input.diagnosticSink?.({
          sourceId: input.source.id,
          errorClass: error instanceof Error ? error.name : typeof error,
        });
      }
    }),
  );
}

async function resolveMessageThreadParent(input: {
  readonly source: DiscordGatewaySourceConfig;
  readonly token: string;
  readonly message: DiscordMessage;
  readonly threadParents: Map<string, string>;
  readonly fetchImpl: typeof fetch;
}): Promise<DiscordMessage> {
  if (
    input.message.parentChannelId !== undefined ||
    input.source.channels.some(
      (channel) => channel.id === input.message.channelId,
    )
  ) {
    return input.message;
  }
  const cachedParent = input.threadParents.get(input.message.channelId);
  if (cachedParent !== undefined) {
    return withParentChannel(input.message, cachedParent);
  }
  const fetchedParent = await fetchDiscordChannelParentId({
    source: input.source,
    token: input.token,
    channelId: input.message.channelId,
    fetchImpl: input.fetchImpl,
  });
  if (fetchedParent !== undefined) {
    input.threadParents.set(input.message.channelId, fetchedParent);
  }
  return withParentChannel(input.message, fetchedParent);
}

export async function startDiscordGatewaySource(
  input: EventSourceStartInput,
): Promise<EventSourceHandle> {
  if (!isDiscordSource(input.source)) {
    throw new Error("discord-gateway start requires a discord-gateway source");
  }
  const source = input.source;
  const env = input.env ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const token = requiredEnv({
    env,
    envName: source.tokenEnv,
    sourceId: source.id,
    label: "bot token",
  });
  const applicationId =
    source.applicationIdEnv === undefined
      ? undefined
      : requiredEnv({
          env,
          envName: source.applicationIdEnv,
          sourceId: source.id,
          label: "application id",
        });
  const cache = new DiscordGatewayHistoryCache(trimHistory);
  const persistence = createDiscordGatewayHistoryPersistence({
    ...(input.eventDataRoot === undefined
      ? {}
      : { eventDataRoot: input.eventDataRoot }),
    ...(input.readOnly === undefined ? {} : { readOnly: input.readOnly }),
    sourceId: source.id,
    bounds: persistedHistoryBounds(historyConfig(source)),
    ...(input.diagnosticSink === undefined
      ? {}
      : { diagnosticSink: input.diagnosticSink }),
  });
  await seedHistoryOnStart({
    source,
    token,
    cache,
    fetchImpl,
    receivedAt: input.now().toISOString(),
    persistence,
    ...(input.diagnosticSink === undefined
      ? {}
      : { diagnosticSink: input.diagnosticSink }),
  });
  const socket = new WebSocket(source.gatewayUrl ?? DEFAULT_GATEWAY_URL);
  const threadParents = new Map<string, string>();
  const messageQueues = new Map<string, Promise<void>>();
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  input.signal.addEventListener("abort", () => {
    if (heartbeatTimer !== undefined) {
      clearInterval(heartbeatTimer);
    }
    socket.close();
  });
  socket.addEventListener("message", (event) => {
    void (async () => {
      const payload = gatewayPayload(JSON.parse(String(event.data)) as unknown);
      if (payload.op === 10 && isJsonObject(payload.d)) {
        const interval = payload.d["heartbeat_interval"];
        if (typeof interval === "number") {
          heartbeatTimer = setInterval(
            () => sendGatewayJson(socket, { op: 1, d: null }),
            interval,
          );
        }
        sendGatewayJson(socket, {
          op: 2,
          d: {
            token,
            intents: source.intents ?? DEFAULT_INTENTS,
            properties: {
              os: "unknown",
              browser: "rielflow",
              device: "rielflow",
            },
          },
        });
        return;
      }
      if (payload.t !== "MESSAGE_CREATE") {
        if (
          payload.t === "THREAD_CREATE" ||
          payload.t === "THREAD_UPDATE" ||
          payload.t === "CHANNEL_CREATE" ||
          payload.t === "CHANNEL_UPDATE"
        ) {
          rememberThreadParent(threadParents, payload.d);
        }
        return;
      }
      const incomingMessage = readMessageBody(payload);
      await enqueueSerialized(
        messageQueues,
        `${source.id}:gateway-channel:${incomingMessage.channelId}`,
        async () => {
          const message = await resolveMessageThreadParent({
            source,
            token,
            message: incomingMessage,
            threadParents,
            fetchImpl,
          });
          if (
            !shouldAcceptMessage({
              source,
              message,
              ...(applicationId === undefined ? {} : { applicationId }),
            })
          ) {
            return;
          }
          const key = discordGatewayHistoryKey({
            sourceId: source.id,
            channelId: message.channelId,
            ...(message.parentChannelId === undefined
              ? {}
              : { parentChannelId: message.parentChannelId }),
            scope: historyConfig(source).scope,
          });
          await enqueueSerialized(messageQueues, `history:${key}`, async () => {
            if (!cache.has(key)) {
              const persisted = await persistence.load(
                key,
                input.now().toISOString(),
              );
              cache.seed({
                key,
                history: persisted,
                source,
                receivedAt: input.now().toISOString(),
                mode: "persisted",
              });
            }
            let history = cache.recent(key);
            let historySourceMode = cache.sourceMode(key);
            const fetchMode = historyConfig(source).fetchOnMessage;
            if (
              fetchMode === "always" ||
              (fetchMode === "when-cache-empty" && history.length === 0)
            ) {
              const fetchedHistory = await fetchDiscordHistory({
                source,
                token,
                channelId: discordGatewayHistoryConversationId({
                  channelId: message.channelId,
                  ...(message.parentChannelId === undefined
                    ? {}
                    : { parentChannelId: message.parentChannelId }),
                  scope: historyConfig(source).scope,
                }),
                current: message,
                fetchImpl,
              });
              history = mergeDiscordGatewayHistoryEntries(
                history,
                fetchedHistory,
              );
              historySourceMode =
                history.length === 0
                  ? "empty"
                  : cache.recent(key).length > 0 && fetchedHistory.length > 0
                    ? "mixed"
                    : fetchedHistory.length > 0
                      ? "rest"
                      : historySourceMode;
              cache.seed({
                key,
                history,
                source,
                receivedAt: input.now().toISOString(),
                mode: historySourceMode,
              });
            }
            const rawBody = isJsonObject(payload.d)
              ? {
                  ...payload.d,
                  ...(message.parentChannelId === undefined
                    ? {}
                    : { parent_channel_id: message.parentChannelId }),
                  history,
                  historySourceMode,
                }
              : {
                  ...payload,
                  ...(message.parentChannelId === undefined
                    ? {}
                    : { parent_channel_id: message.parentChannelId }),
                  history,
                  historySourceMode,
                };
            const eventEnvelope = normalizeDiscordGatewayRawEvent({
              sourceId: source.id,
              source,
              receivedAt: input.now().toISOString(),
              body: rawBody,
            });
            const currentItem = toHistoryItem(message, { ...message, id: "" });
            if (currentItem !== null) {
              const receivedAt = input.now().toISOString();
              cache.append({ key, item: currentItem, source, receivedAt });
              await persistence.save(key, cache.recent(key), receivedAt);
            }
            await input.dispatch(eventEnvelope, rawBody);
          });
        },
      );
    })().catch((error: unknown) => {
      input.diagnosticSink?.({
        sourceId: source.id,
        errorClass: error instanceof Error ? error.name : typeof error,
      });
    });
  });
  return {
    sourceId: source.id,
    stop: async () => {
      if (heartbeatTimer !== undefined) {
        clearInterval(heartbeatTimer);
      }
      socket.close();
    },
  };
}

export function createDiscordGatewayEventSourceAdapter(): EventSourceAdapter {
  return {
    kind: "discord-gateway",
    capabilities: {
      eventTypes: ["chat.message"],
      supportsStart: true,
      webhook: false,
      chatReply: true,
    },
    start: startDiscordGatewaySource,
    async normalize(raw) {
      return normalizeDiscordGatewayRawEvent(raw);
    },
    dispatchChatReply: dispatchDiscordGatewayReply,
  };
}

export {
  DISCORD_GATEWAY_HISTORY_LIMITS,
  isDiscordSnowflake,
} from "./discord-gateway-history-persistence";
