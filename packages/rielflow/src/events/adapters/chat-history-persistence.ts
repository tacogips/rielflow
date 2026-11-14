import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isJsonObject, type JsonObject } from "../../shared/json";
import type { EventSourceDiagnosticSink } from "../source-adapter";

const DEFAULT_HISTORY_MAX_MESSAGES = 20;
const DEFAULT_HISTORY_MAX_BYTES = 32_768;
const DEFAULT_HISTORY_MAX_AGE_MS = 86_400_000;
const MAX_HISTORY_MESSAGES = 100;
const MAX_HISTORY_BYTES = 131_072;
const MAX_HISTORY_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const CHAT_HISTORY_LIMITS = {
  maxMessages: MAX_HISTORY_MESSAGES,
  maxBytes: MAX_HISTORY_BYTES,
  maxAgeMs: MAX_HISTORY_AGE_MS,
  defaultMaxMessages: DEFAULT_HISTORY_MAX_MESSAGES,
  defaultMaxBytes: DEFAULT_HISTORY_MAX_BYTES,
  defaultMaxAgeMs: DEFAULT_HISTORY_MAX_AGE_MS,
};

export type ChatHistorySourceMode =
  | "persisted"
  | "memory"
  | "mixed"
  | "empty"
  | "unavailable"
  | "sync";

export interface ChatHistoryBounds extends JsonObject {
  readonly maxMessages: number;
  readonly maxBytes: number;
  readonly maxAgeMs: number;
  readonly scope: string;
  readonly includeBotMessages: boolean;
}

export interface GenericChatHistoryItem extends JsonObject {
  readonly messageId: string;
  readonly authorId: string;
  readonly displayName?: string;
  readonly isBot?: boolean;
  readonly createdAt?: string;
  readonly text: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly provider?: string;
  readonly msgtype?: string;
}

interface PersistedChatHistoryFile extends JsonObject {
  readonly version: 1;
  readonly adapterKind: string;
  readonly sourceId: string;
  readonly historyKey: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly bounds: ChatHistoryBounds;
  readonly messages: readonly GenericChatHistoryItem[];
}

export interface ChatHistoryPersistence {
  readonly enabled: boolean;
  load(key: string): Promise<readonly GenericChatHistoryItem[]>;
  save(key: string, history: readonly GenericChatHistoryItem[]): Promise<void>;
}

export interface ChatHistoryPersistenceOptions {
  readonly adapterKind: string;
  readonly eventDataRoot?: string | undefined;
  readonly readOnly?: boolean | undefined;
  readonly sourceId: string;
  readonly bounds: ChatHistoryBounds;
  readonly diagnosticPrefix: string;
  readonly diagnosticSink?: EventSourceDiagnosticSink | undefined;
}

type TrimChatHistory = (input: {
  readonly history: readonly GenericChatHistoryItem[];
  readonly receivedAt: string;
}) => readonly GenericChatHistoryItem[];

export class ChatHistoryCache {
  private readonly entries = new Map<string, GenericChatHistoryItem[]>();
  private readonly loadedKeys = new Set<string>();
  private readonly sourceModes = new Map<string, ChatHistorySourceMode>();

  constructor(private readonly trimHistory: TrimChatHistory) {}

  recent(key: string): readonly GenericChatHistoryItem[] {
    return this.entries.get(key) ?? [];
  }

  has(key: string): boolean {
    return this.loadedKeys.has(key);
  }

  sourceMode(key: string): ChatHistorySourceMode {
    return this.sourceModes.get(key) ?? "empty";
  }

  seed(input: {
    readonly key: string;
    readonly history: readonly GenericChatHistoryItem[];
    readonly receivedAt: string;
    readonly mode: ChatHistorySourceMode;
  }): void {
    const trimmed = [
      ...this.trimHistory({
        history: input.history,
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

  append(input: {
    readonly key: string;
    readonly item: GenericChatHistoryItem;
    readonly receivedAt: string;
  }): readonly GenericChatHistoryItem[] {
    const current = this.entries.get(input.key) ?? [];
    const next = [
      ...this.trimHistory({
        history: mergeChatHistoryEntries(current, [input.item]),
        receivedAt: input.receivedAt,
      }),
    ];
    this.entries.set(input.key, next);
    this.loadedKeys.add(input.key);
    const previousMode = this.sourceModes.get(input.key) ?? "empty";
    if (previousMode === "empty") {
      this.sourceModes.set(input.key, "memory");
    } else if (previousMode !== "memory") {
      this.sourceModes.set(input.key, "mixed");
    }
    return next;
  }
}

export function chatHistoryBounds(input: {
  readonly history: JsonObject | undefined;
  readonly scope: string;
  readonly includeBotMessagesKey?: "includeBotMessages" | "includeOwnMessages";
}): ChatHistoryBounds {
  const includeKey = input.includeBotMessagesKey ?? "includeBotMessages";
  return {
    maxMessages:
      typeof input.history?.["maxMessages"] === "number"
        ? Math.min(input.history["maxMessages"], MAX_HISTORY_MESSAGES)
        : DEFAULT_HISTORY_MAX_MESSAGES,
    maxBytes:
      typeof input.history?.["maxBytes"] === "number"
        ? input.history["maxBytes"]
        : DEFAULT_HISTORY_MAX_BYTES,
    maxAgeMs:
      typeof input.history?.["maxAgeMs"] === "number"
        ? input.history["maxAgeMs"]
        : DEFAULT_HISTORY_MAX_AGE_MS,
    scope:
      typeof input.history?.["scope"] === "string"
        ? input.history["scope"]
        : input.scope,
    includeBotMessages: input.history?.[includeKey] === true,
  };
}

export function trimChatHistory(input: {
  readonly history: readonly GenericChatHistoryItem[];
  readonly bounds: ChatHistoryBounds;
  readonly receivedAt: string;
}): readonly GenericChatHistoryItem[] {
  const cutoff = Date.parse(input.receivedAt) - input.bounds.maxAgeMs;
  const filtered = input.history.filter((item) => {
    if (!input.bounds.includeBotMessages && item.isBot === true) {
      return false;
    }
    if (item.createdAt === undefined) {
      return true;
    }
    const createdAt = Date.parse(item.createdAt);
    return Number.isNaN(createdAt) || createdAt >= cutoff;
  });
  const boundedByCount = filtered.slice(-input.bounds.maxMessages);
  const selected: GenericChatHistoryItem[] = [];
  let bytes = 0;
  for (const item of boundedByCount.toReversed()) {
    const itemBytes = Buffer.byteLength(JSON.stringify(item), "utf8");
    if (selected.length > 0 && bytes + itemBytes > input.bounds.maxBytes) {
      break;
    }
    selected.push(item);
    bytes += itemBytes;
  }
  return selected.toReversed();
}

export function mergeChatHistoryEntries(
  left: readonly GenericChatHistoryItem[],
  right: readonly GenericChatHistoryItem[],
): readonly GenericChatHistoryItem[] {
  const entries = new Map<string, GenericChatHistoryItem>();
  for (const item of [...left, ...right]) {
    entries.set(item.messageId, item);
  }
  return [...entries.values()].toSorted((a, b) => {
    const aTime = a.createdAt === undefined ? 0 : Date.parse(a.createdAt);
    const bTime = b.createdAt === undefined ? 0 : Date.parse(b.createdAt);
    return aTime - bTime;
  });
}

export function chatHistoryFilePath(input: {
  readonly eventDataRoot: string;
  readonly adapterKind: string;
  readonly sourceId: string;
  readonly historyKey: string;
}): string {
  const root = path.resolve(input.eventDataRoot);
  return path.join(
    root,
    input.adapterKind,
    "history",
    encodeURIComponent(input.sourceId),
    `${encodeURIComponent(input.historyKey)}.json`,
  );
}

function splitHistoryKey(key: string): {
  readonly conversationId: string;
  readonly threadId?: string;
} {
  const parts = key.split(":");
  const conversationId = parts.at(-2) ?? key;
  const threadId = parts.at(-1);
  return {
    conversationId,
    ...(threadId === undefined || threadId === "root" || threadId.length === 0
      ? {}
      : { threadId }),
  };
}

function normalizedHistoryItem(value: unknown): GenericChatHistoryItem | null {
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
  return {
    messageId,
    authorId,
    ...(typeof value["displayName"] === "string"
      ? { displayName: value["displayName"] }
      : {}),
    ...(value["isBot"] === true ? { isBot: true } : {}),
    ...(typeof value["createdAt"] === "string"
      ? { createdAt: value["createdAt"] }
      : {}),
    text,
    conversationId,
    ...(typeof value["threadId"] === "string"
      ? { threadId: value["threadId"] }
      : {}),
    ...(typeof value["provider"] === "string"
      ? { provider: value["provider"] }
      : {}),
    ...(typeof value["msgtype"] === "string"
      ? { msgtype: value["msgtype"] }
      : {}),
  };
}

function persistedHistoryFile(input: {
  readonly adapterKind: string;
  readonly sourceId: string;
  readonly key: string;
  readonly bounds: ChatHistoryBounds;
  readonly history: readonly GenericChatHistoryItem[];
}): PersistedChatHistoryFile {
  const conversation = splitHistoryKey(input.key);
  return {
    version: 1,
    adapterKind: input.adapterKind,
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
  input: {
    readonly adapterKind: string;
    readonly sourceId: string;
    readonly historyKey: string;
    readonly diagnosticPrefix: string;
  },
): readonly GenericChatHistoryItem[] {
  if (!isJsonObject(value)) {
    throw new Error(`${input.diagnosticPrefix}PersistedHistoryInvalidJson`);
  }
  if (
    value["version"] !== 1 ||
    value["adapterKind"] !== input.adapterKind ||
    value["sourceId"] !== input.sourceId ||
    value["historyKey"] !== input.historyKey ||
    !Array.isArray(value["messages"])
  ) {
    throw new Error(`${input.diagnosticPrefix}PersistedHistoryInvalidSchema`);
  }
  return value["messages"].flatMap((entry) => {
    const normalized = normalizedHistoryItem(entry);
    return normalized === null ? [] : [normalized];
  });
}

function diagnostic(
  options: ChatHistoryPersistenceOptions,
  errorClass: string,
): void {
  options.diagnosticSink?.({ sourceId: options.sourceId, errorClass });
}

class DisabledChatHistoryPersistence implements ChatHistoryPersistence {
  readonly enabled = false;

  async load(): Promise<readonly GenericChatHistoryItem[]> {
    return [];
  }

  async save(): Promise<void> {
    return;
  }
}

class FileChatHistoryPersistence implements ChatHistoryPersistence {
  readonly enabled = true;

  constructor(
    private readonly options: ChatHistoryPersistenceOptions & {
      readonly eventDataRoot: string;
    },
  ) {}

  async load(key: string): Promise<readonly GenericChatHistoryItem[]> {
    const filePath = chatHistoryFilePath({
      eventDataRoot: this.options.eventDataRoot,
      adapterKind: this.options.adapterKind,
      sourceId: this.options.sourceId,
      historyKey: key,
    });
    try {
      const content = await readFile(filePath, "utf8");
      return parsePersistedHistoryFile(JSON.parse(content) as unknown, {
        adapterKind: this.options.adapterKind,
        sourceId: this.options.sourceId,
        historyKey: key,
        diagnosticPrefix: this.options.diagnosticPrefix,
      });
    } catch (error: unknown) {
      const code = isJsonObject(error) ? error["code"] : undefined;
      if (code === "ENOENT") {
        return [];
      }
      diagnostic(
        this.options,
        error instanceof SyntaxError
          ? `${this.options.diagnosticPrefix}PersistedHistoryInvalidJson`
          : error instanceof Error
            ? error.message
            : `${this.options.diagnosticPrefix}PersistedHistoryReadFailed`,
      );
      return [];
    }
  }

  async save(
    key: string,
    history: readonly GenericChatHistoryItem[],
  ): Promise<void> {
    const filePath = chatHistoryFilePath({
      eventDataRoot: this.options.eventDataRoot,
      adapterKind: this.options.adapterKind,
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
            adapterKind: this.options.adapterKind,
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
      diagnostic(
        this.options,
        `${this.options.diagnosticPrefix}PersistedHistoryWriteFailed`,
      );
    }
  }
}

export function createChatHistoryPersistence(
  options: ChatHistoryPersistenceOptions,
): ChatHistoryPersistence {
  if (
    options.eventDataRoot === undefined ||
    options.eventDataRoot.length === 0
  ) {
    diagnostic(
      options,
      `${options.diagnosticPrefix}HistoryPersistenceUnavailable`,
    );
    return new DisabledChatHistoryPersistence();
  }
  if (options.readOnly === true) {
    diagnostic(
      options,
      `${options.diagnosticPrefix}HistoryPersistenceReadOnly`,
    );
    return new DisabledChatHistoryPersistence();
  }
  return new FileChatHistoryPersistence({
    ...options,
    eventDataRoot: options.eventDataRoot,
  });
}
