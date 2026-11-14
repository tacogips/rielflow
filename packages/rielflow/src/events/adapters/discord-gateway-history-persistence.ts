import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isJsonObject, type JsonObject } from "../../shared/json";
import type { EventSourceDiagnosticSink } from "../source-adapter";
import type {
  DiscordGatewayHistoryConfig,
  DiscordGatewaySourceConfig,
} from "../types";
import type { DiscordGatewayHistoryItem } from "./discord-gateway";

const DEFAULT_HISTORY_MAX_MESSAGES = 20;
const DEFAULT_HISTORY_MAX_BYTES = 32_768;
const DEFAULT_HISTORY_MAX_AGE_MS = 86_400_000;
const MAX_HISTORY_MESSAGES = 100;

export type DiscordGatewayHistorySourceMode =
  | "persisted"
  | "memory"
  | "rest"
  | "mixed"
  | "empty";

type TrimDiscordGatewayHistory = (input: {
  readonly history: readonly DiscordGatewayHistoryItem[];
  readonly source: DiscordGatewaySourceConfig;
  readonly receivedAt: string;
}) => readonly DiscordGatewayHistoryItem[];

export const DISCORD_GATEWAY_HISTORY_LIMITS = {
  maxMessages: MAX_HISTORY_MESSAGES,
  defaultMaxMessages: DEFAULT_HISTORY_MAX_MESSAGES,
  defaultMaxBytes: DEFAULT_HISTORY_MAX_BYTES,
  defaultMaxAgeMs: DEFAULT_HISTORY_MAX_AGE_MS,
};

export function isDiscordSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}

interface DiscordGatewayPersistedHistoryBounds extends JsonObject {
  readonly maxMessages: number;
  readonly maxBytes: number;
  readonly maxAgeMs: number;
  readonly scope: "thread-or-channel" | "channel";
  readonly includeBotMessages: boolean;
}

interface DiscordGatewayPersistedHistoryFile extends JsonObject {
  readonly version: 1;
  readonly sourceId: string;
  readonly historyKey: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly bounds: DiscordGatewayPersistedHistoryBounds;
  readonly messages: readonly DiscordGatewayHistoryItem[];
}

export interface DiscordGatewayHistoryPersistence {
  readonly enabled: boolean;
  load(
    key: string,
    receivedAt: string,
  ): Promise<readonly DiscordGatewayHistoryItem[]>;
  save(
    key: string,
    history: readonly DiscordGatewayHistoryItem[],
    receivedAt: string,
  ): Promise<void>;
}

export interface DiscordGatewayHistoryPersistenceOptions {
  readonly eventDataRoot?: string;
  readonly readOnly?: boolean;
  readonly sourceId: string;
  readonly bounds: DiscordGatewayPersistedHistoryBounds;
  readonly diagnosticSink?: EventSourceDiagnosticSink;
}

export class DiscordGatewayHistoryCache {
  private readonly entries = new Map<string, DiscordGatewayHistoryItem[]>();
  private readonly loadedKeys = new Set<string>();
  private readonly sourceModes = new Map<
    string,
    DiscordGatewayHistorySourceMode
  >();

  constructor(private readonly trimHistory: TrimDiscordGatewayHistory) {}

  recent(key: string): readonly DiscordGatewayHistoryItem[] {
    return this.entries.get(key) ?? [];
  }

  has(key: string): boolean {
    return this.loadedKeys.has(key);
  }

  sourceMode(key: string): DiscordGatewayHistorySourceMode {
    return this.sourceModes.get(key) ?? "empty";
  }

  append(input: {
    readonly key: string;
    readonly item: DiscordGatewayHistoryItem;
    readonly source: DiscordGatewaySourceConfig;
    readonly receivedAt: string;
  }): void {
    const current = this.entries.get(input.key) ?? [];
    this.entries.set(input.key, [
      ...this.trimHistory({
        history: mergeDiscordGatewayHistoryEntries(current, [input.item]),
        source: input.source,
        receivedAt: input.receivedAt,
      }),
    ]);
    this.loadedKeys.add(input.key);
    const previousMode = this.sourceModes.get(input.key) ?? "empty";
    if (previousMode === "empty") {
      this.sourceModes.set(input.key, "memory");
    } else if (previousMode !== "memory") {
      this.sourceModes.set(input.key, "mixed");
    }
  }

  seed(input: {
    readonly key: string;
    readonly history: readonly DiscordGatewayHistoryItem[];
    readonly source: DiscordGatewaySourceConfig;
    readonly receivedAt: string;
    readonly mode: DiscordGatewayHistorySourceMode;
  }): void {
    const trimmed = [
      ...this.trimHistory({
        history: input.history,
        source: input.source,
        receivedAt: input.receivedAt,
      }),
    ];
    this.entries.set(input.key, trimmed);
    this.loadedKeys.add(input.key);
    this.sourceModes.set(
      input.key,
      trimmed.length === 0 ? "empty" : input.mode,
    );
  }
}

export function mergeDiscordGatewayHistoryEntries(
  left: readonly DiscordGatewayHistoryItem[],
  right: readonly DiscordGatewayHistoryItem[],
): readonly DiscordGatewayHistoryItem[] {
  const entries = new Map<string, DiscordGatewayHistoryItem>();
  for (const item of [...left, ...right]) {
    entries.set(item.messageId, item);
  }
  return [...entries.values()].toSorted((a, b) => {
    const aTime = a.createdAt === undefined ? 0 : Date.parse(a.createdAt);
    const bTime = b.createdAt === undefined ? 0 : Date.parse(b.createdAt);
    return aTime - bTime;
  });
}

export function discordGatewayHistoryKey(input: {
  readonly sourceId: string;
  readonly channelId: string;
  readonly parentChannelId?: string;
  readonly scope: "thread-or-channel" | "channel";
}): string {
  const rootChannelId = input.parentChannelId ?? input.channelId;
  const threadComponent =
    input.scope === "thread-or-channel" && input.parentChannelId !== undefined
      ? input.channelId
      : "root";
  return `${input.sourceId}:${rootChannelId}:${threadComponent}`;
}

export function discordGatewayHistoryConversationId(input: {
  readonly channelId: string;
  readonly parentChannelId?: string;
  readonly scope: "thread-or-channel" | "channel";
}): string {
  return input.scope === "thread-or-channel" &&
    input.parentChannelId !== undefined
    ? input.channelId
    : (input.parentChannelId ?? input.channelId);
}

export function discordGatewayChannelHistoryKey(
  sourceId: string,
  channelId: string,
): string {
  return `${sourceId}:${channelId}:root`;
}

export function readDiscordGatewayHistorySourceMode(
  body: unknown,
): DiscordGatewayHistorySourceMode {
  if (!isJsonObject(body)) {
    return "empty";
  }
  const mode = body["historySourceMode"];
  return mode === "persisted" ||
    mode === "memory" ||
    mode === "rest" ||
    mode === "mixed"
    ? mode
    : Array.isArray(body["history"]) && body["history"].length > 0
      ? "memory"
      : "empty";
}

export function persistedHistoryBounds(
  history: Required<
    Pick<
      DiscordGatewayHistoryConfig,
      "maxMessages" | "maxBytes" | "maxAgeMs" | "scope" | "includeBotMessages"
    >
  >,
): DiscordGatewayPersistedHistoryBounds {
  return {
    maxMessages: history.maxMessages,
    maxBytes: history.maxBytes,
    maxAgeMs: history.maxAgeMs,
    scope: history.scope,
    includeBotMessages: history.includeBotMessages,
  };
}

export function discordGatewayHistoryConfig(
  source: DiscordGatewaySourceConfig,
): Required<
  Pick<
    DiscordGatewayHistoryConfig,
    "maxMessages" | "maxBytes" | "maxAgeMs" | "scope" | "includeBotMessages"
  >
> & {
  readonly fetchOnMessage: "never" | "when-cache-empty" | "always";
} {
  const history = source.history ?? {};
  return {
    maxMessages:
      typeof history.maxMessages === "number"
        ? Math.min(history.maxMessages, MAX_HISTORY_MESSAGES)
        : DEFAULT_HISTORY_MAX_MESSAGES,
    maxBytes:
      typeof history.maxBytes === "number"
        ? history.maxBytes
        : DEFAULT_HISTORY_MAX_BYTES,
    maxAgeMs:
      typeof history.maxAgeMs === "number"
        ? history.maxAgeMs
        : DEFAULT_HISTORY_MAX_AGE_MS,
    scope: history.scope ?? "thread-or-channel",
    includeBotMessages: history.includeBotMessages ?? false,
    fetchOnMessage: history.fetchOnMessage ?? "when-cache-empty",
  };
}

export function discordGatewayHistoryFilePath(input: {
  readonly eventDataRoot: string;
  readonly sourceId: string;
  readonly historyKey: string;
}): string {
  const root = path.resolve(input.eventDataRoot);
  const sourceDirectory = encodeURIComponent(input.sourceId);
  const fileName = `${encodeURIComponent(input.historyKey)}.json`;
  return path.join(
    root,
    "discord-gateway",
    "history",
    sourceDirectory,
    fileName,
  );
}

function diagnostic(
  options: DiscordGatewayHistoryPersistenceOptions,
  errorClass: string,
): void {
  options.diagnosticSink?.({ sourceId: options.sourceId, errorClass });
}

function splitHistoryKey(key: string): {
  readonly conversationId: string;
  readonly threadId?: string;
} {
  const [, conversationId = key, threadId] = key.split(":");
  return {
    conversationId,
    ...(threadId === undefined || threadId === "root" || threadId.length === 0
      ? {}
      : { threadId }),
  };
}

function normalizedHistoryItem(
  value: unknown,
): DiscordGatewayHistoryItem | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const messageId = value["messageId"];
  const authorId = value["authorId"];
  const text = value["text"];
  const conversationId = value["conversationId"];
  if (
    typeof messageId !== "string" ||
    typeof authorId !== "string" ||
    typeof text !== "string" ||
    typeof conversationId !== "string"
  ) {
    return null;
  }
  const displayName =
    typeof value["displayName"] === "string" ? value["displayName"] : undefined;
  const username =
    typeof value["username"] === "string" ? value["username"] : undefined;
  const createdAt =
    typeof value["createdAt"] === "string" ? value["createdAt"] : undefined;
  const threadId =
    typeof value["threadId"] === "string" ? value["threadId"] : undefined;
  return {
    messageId,
    authorId,
    ...(displayName === undefined ? {} : { displayName }),
    ...(username === undefined ? {} : { username }),
    isBot: value["isBot"] === true,
    ...(createdAt === undefined ? {} : { createdAt }),
    text,
    conversationId,
    ...(threadId === undefined ? {} : { threadId }),
  };
}

function persistedHistoryFile(input: {
  readonly sourceId: string;
  readonly key: string;
  readonly bounds: DiscordGatewayPersistedHistoryBounds;
  readonly history: readonly DiscordGatewayHistoryItem[];
}): DiscordGatewayPersistedHistoryFile {
  const conversation = splitHistoryKey(input.key);
  return {
    version: 1,
    sourceId: input.sourceId,
    historyKey: input.key,
    conversationId: conversation.conversationId,
    ...(conversation.threadId === undefined
      ? {}
      : { threadId: conversation.threadId }),
    bounds: input.bounds,
    messages: input.history,
  };
}

function parsePersistedHistoryFile(
  value: unknown,
  expectedSourceId: string,
  expectedKey: string,
): readonly DiscordGatewayHistoryItem[] {
  if (!isJsonObject(value)) {
    throw new Error("DiscordGatewayPersistedHistoryInvalidJson");
  }
  if (
    value["version"] !== 1 ||
    value["sourceId"] !== expectedSourceId ||
    value["historyKey"] !== expectedKey ||
    !Array.isArray(value["messages"])
  ) {
    throw new Error("DiscordGatewayPersistedHistoryInvalidSchema");
  }
  return value["messages"].flatMap((entry) => {
    const normalized = normalizedHistoryItem(entry);
    return normalized === null ? [] : [normalized];
  });
}

class DisabledDiscordGatewayHistoryPersistence
  implements DiscordGatewayHistoryPersistence
{
  readonly enabled = false;

  async load(): Promise<readonly DiscordGatewayHistoryItem[]> {
    return [];
  }

  async save(): Promise<void> {
    return;
  }
}

class FileDiscordGatewayHistoryPersistence
  implements DiscordGatewayHistoryPersistence
{
  readonly enabled = true;

  constructor(
    private readonly options: DiscordGatewayHistoryPersistenceOptions & {
      readonly eventDataRoot: string;
    },
  ) {}

  async load(key: string): Promise<readonly DiscordGatewayHistoryItem[]> {
    const filePath = discordGatewayHistoryFilePath({
      eventDataRoot: this.options.eventDataRoot,
      sourceId: this.options.sourceId,
      historyKey: key,
    });
    try {
      const content = await readFile(filePath, "utf8");
      return parsePersistedHistoryFile(
        JSON.parse(content) as unknown,
        this.options.sourceId,
        key,
      );
    } catch (error: unknown) {
      const code = isJsonObject(error) ? error["code"] : undefined;
      if (code === "ENOENT") {
        return [];
      }
      diagnostic(
        this.options,
        error instanceof SyntaxError
          ? "DiscordGatewayPersistedHistoryInvalidJson"
          : error instanceof Error
            ? error.message
            : "DiscordGatewayPersistedHistoryReadFailed",
      );
      return [];
    }
  }

  async save(
    key: string,
    history: readonly DiscordGatewayHistoryItem[],
  ): Promise<void> {
    const filePath = discordGatewayHistoryFilePath({
      eventDataRoot: this.options.eventDataRoot,
      sourceId: this.options.sourceId,
      historyKey: key,
    });
    const directory = path.dirname(filePath);
    const temporaryPath = `${filePath}.${Date.now().toString(36)}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`;
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(
        temporaryPath,
        `${JSON.stringify(
          persistedHistoryFile({
            sourceId: this.options.sourceId,
            key,
            bounds: this.options.bounds,
            history,
          }),
          null,
          2,
        )}\n`,
        "utf8",
      );
      await rename(temporaryPath, filePath);
    } catch {
      diagnostic(this.options, "DiscordGatewayPersistedHistoryWriteFailed");
    }
  }
}

export function createDiscordGatewayHistoryPersistence(
  options: DiscordGatewayHistoryPersistenceOptions,
): DiscordGatewayHistoryPersistence {
  if (
    options.eventDataRoot === undefined ||
    options.eventDataRoot.length === 0
  ) {
    diagnostic(options, "DiscordGatewayHistoryPersistenceUnavailable");
    return new DisabledDiscordGatewayHistoryPersistence();
  }
  if (options.readOnly === true) {
    diagnostic(options, "DiscordGatewayHistoryPersistenceReadOnly");
    return new DisabledDiscordGatewayHistoryPersistence();
  }
  return new FileDiscordGatewayHistoryPersistence({
    ...options,
    eventDataRoot: options.eventDataRoot,
  });
}
