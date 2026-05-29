import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isJsonObject, type JsonObject } from "../../shared/json";
import {
  appendAcceptedTelegramHistory,
  attachTelegramHistory,
  createTelegramHistoryCache,
  createTelegramHistoryPersistence,
  seedTelegramHistory,
  telegramHistoryKey,
} from "./telegram-gateway-history";
import { dispatchTelegramGatewayReply } from "./telegram-gateway-reply";
import type { ChatHistoryCache } from "./chat-history-persistence";
import type {
  EventSourceAcceptedEventInput,
  EventSourceAdapter,
  EventSourceDiagnosticSink,
  EventSourceHandle,
  EventSourceStartInput,
  RawExternalEvent,
} from "../source-adapter";
import type {
  ExternalEventEnvelope,
  TelegramGatewaySourceConfig,
} from "../types";

const TELEGRAM_PROVIDER = "telegram";
const DEFAULT_REST_BASE_URL = "https://api.telegram.org";
const DEFAULT_POLL_TIMEOUT_SECONDS = 30;
const DEFAULT_POLL_LIMIT = 100;
const RETRY_DELAY_MS = 1000;
const TELEGRAM_POLL_HTTP_ERROR_CLASS = "TelegramPollHttpError";
const TELEGRAM_GET_FILE_HTTP_ERROR_CLASS = "TelegramGetFileHttpError";
const TELEGRAM_DOWNLOAD_FILE_HTTP_ERROR_CLASS = "TelegramDownloadFileHttpError";

interface TelegramUser {
  readonly id: string;
  readonly isBot?: boolean;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly username?: string;
}

interface TelegramChat {
  readonly id: string;
  readonly type?: string;
  readonly title?: string;
  readonly username?: string;
}

interface TelegramPhotoSize {
  readonly fileId: string;
  readonly fileUniqueId?: string;
  readonly width: number;
  readonly height: number;
  readonly fileSize?: number;
}

interface TelegramMessage {
  readonly messageId: string;
  readonly messageThreadId?: string;
  readonly date?: number;
  readonly from?: TelegramUser;
  readonly chat: TelegramChat;
  readonly text: string;
  readonly caption?: string;
  readonly photos: readonly TelegramPhotoSize[];
}

interface TelegramUpdate {
  readonly updateId: number;
  readonly message: TelegramMessage;
}

interface TelegramPhotoAttachment extends JsonObject {
  readonly id: string;
  readonly kind: "image";
  readonly mediaType: "image/jpeg";
  readonly filename: string;
  readonly sizeBytes?: number;
  readonly width: number;
  readonly height: number;
  readonly caption?: string;
  readonly fileId: string;
  readonly fileUniqueId?: string;
  readonly filePath?: string;
  readonly localPath?: string;
  readonly contentRef?: string;
  readonly source: JsonObject;
}

interface TelegramResolvedPhotoFile {
  readonly filePath: string;
  readonly localPath?: string;
  readonly contentRef?: string;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringFromId(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function safePathSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 96) : "item";
}

function relativeEventAttachmentPath(input: {
  readonly source: TelegramGatewaySourceConfig;
  readonly updateId: number;
  readonly message: TelegramMessage;
  readonly photo: TelegramPhotoSize;
  readonly filePath: string;
}): string {
  const ext = path.extname(input.filePath).match(/^\.[A-Za-z0-9]{1,12}$/)
    ? path.extname(input.filePath)
    : ".jpg";
  return path.join(
    "attachments",
    "telegram-gateway",
    safePathSegment(input.source.id),
    `${safePathSegment(String(input.updateId))}-${safePathSegment(
      input.message.messageId,
    )}-${safePathSegment(input.photo.fileId)}${ext}`,
  );
}

function isTelegramSource(
  source: unknown,
): source is TelegramGatewaySourceConfig {
  return isJsonObject(source) && source["kind"] === "telegram-gateway";
}

function sourceFromRaw(raw: RawExternalEvent): TelegramGatewaySourceConfig {
  if (!isTelegramSource(raw.source)) {
    throw new Error(
      "telegram-gateway raw event requires a telegram-gateway source",
    );
  }
  return raw.source;
}

function displayName(user: TelegramUser | undefined): string | undefined {
  if (user === undefined) {
    return undefined;
  }
  const names = [user.firstName, user.lastName].filter(
    (entry): entry is string => entry !== undefined,
  );
  return names.length > 0 ? names.join(" ") : user.username;
}

function readUser(value: unknown): TelegramUser | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const id = stringFromId(value["id"]);
  if (id === undefined) {
    return undefined;
  }
  const isBot =
    optionalBoolean(value["is_bot"]) ?? optionalBoolean(value["isBot"]);
  const firstName =
    optionalString(value["first_name"]) ?? optionalString(value["firstName"]);
  const lastName =
    optionalString(value["last_name"]) ?? optionalString(value["lastName"]);
  const username = optionalString(value["username"]);
  return {
    id,
    ...(isBot === undefined ? {} : { isBot }),
    ...(firstName === undefined ? {} : { firstName }),
    ...(lastName === undefined ? {} : { lastName }),
    ...(username === undefined ? {} : { username }),
  };
}

function readChat(value: unknown): TelegramChat | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const id = stringFromId(value["id"]);
  if (id === undefined) {
    return null;
  }
  const type = optionalString(value["type"]);
  const title = optionalString(value["title"]);
  const username = optionalString(value["username"]);
  return {
    id,
    ...(type === undefined ? {} : { type }),
    ...(title === undefined ? {} : { title }),
    ...(username === undefined ? {} : { username }),
  };
}

function readPhotoSize(value: unknown): TelegramPhotoSize | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const fileId =
    optionalString(value["file_id"]) ?? optionalString(value["fileId"]);
  const width = optionalNumber(value["width"]);
  const height = optionalNumber(value["height"]);
  if (fileId === undefined || width === undefined || height === undefined) {
    return null;
  }
  const fileUniqueId =
    optionalString(value["file_unique_id"]) ??
    optionalString(value["fileUniqueId"]);
  const fileSize =
    optionalNumber(value["file_size"]) ?? optionalNumber(value["fileSize"]);
  return {
    fileId,
    ...(fileUniqueId === undefined ? {} : { fileUniqueId }),
    width,
    height,
    ...(fileSize === undefined ? {} : { fileSize }),
  };
}

function readPhotos(value: unknown): readonly TelegramPhotoSize[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const photo = readPhotoSize(entry);
    return photo === null ? [] : [photo];
  });
}

function readMessage(value: unknown): TelegramMessage | null {
  if (!isJsonObject(value)) {
    return null;
  }
  const messageId =
    stringFromId(value["message_id"]) ?? stringFromId(value["messageId"]);
  const chat = readChat(value["chat"]);
  if (messageId === undefined || chat === null) {
    return null;
  }
  const text = optionalString(value["text"]) ?? "";
  const caption = optionalString(value["caption"]);
  const messageThreadId = stringFromId(value["message_thread_id"]);
  const date = optionalNumber(value["date"]);
  const from = readUser(value["from"]);
  return {
    messageId,
    ...(messageThreadId === undefined ? {} : { messageThreadId }),
    ...(date === undefined ? {} : { date }),
    ...(from === undefined ? {} : { from }),
    chat,
    text: text.length > 0 ? text : (caption ?? ""),
    ...(caption === undefined ? {} : { caption }),
    photos: readPhotos(value["photo"]),
  };
}

function readUpdateBody(body: unknown): TelegramUpdate | null {
  const update =
    isJsonObject(body) && isJsonObject(body["update"]) ? body["update"] : body;
  if (!isJsonObject(update)) {
    return null;
  }
  const updateId = optionalNumber(update["update_id"]);
  const message = readMessage(update["message"] ?? update);
  if (updateId === undefined || message === null) {
    return null;
  }
  return { updateId, message };
}

function configuredChatIds(
  source: TelegramGatewaySourceConfig,
): ReadonlySet<string> {
  return new Set(source.chats?.map((chat) => chat.id) ?? []);
}

function shouldAcceptMessage(input: {
  readonly source: TelegramGatewaySourceConfig;
  readonly message: TelegramMessage;
  readonly botId?: string;
}): boolean {
  const allowedChats = configuredChatIds(input.source);
  if (allowedChats.size > 0 && !allowedChats.has(input.message.chat.id)) {
    return false;
  }
  const filters = input.source.filters ?? {};
  if ((filters.ignoreBots ?? true) && input.message.from?.isBot === true) {
    return false;
  }
  if (
    (filters.ignoreSelf ?? true) &&
    input.botId !== undefined &&
    input.message.from?.id === input.botId
  ) {
    return false;
  }
  return input.message.text.length > 0 || input.message.photos.length > 0;
}

function selectLargestPhoto(
  photos: readonly TelegramPhotoSize[],
): TelegramPhotoSize | undefined {
  return photos.toSorted((left, right) => {
    const leftScore = left.fileSize ?? left.width * left.height;
    const rightScore = right.fileSize ?? right.width * right.height;
    return rightScore - leftScore;
  })[0];
}

function readPhotoAttachments(input: {
  readonly source: TelegramGatewaySourceConfig;
  readonly message: TelegramMessage;
  readonly files?: ReadonlyMap<string, TelegramResolvedPhotoFile>;
}): readonly TelegramPhotoAttachment[] {
  if (input.source.attachments?.includePhotos === false) {
    return [];
  }
  const photo = selectLargestPhoto(input.message.photos);
  if (photo === undefined) {
    return [];
  }
  const file = input.files?.get(photo.fileId);
  return [
    {
      id: photo.fileId,
      kind: "image",
      mediaType: "image/jpeg",
      filename: `telegram-photo-${input.message.messageId}.jpg`,
      ...(photo.fileSize === undefined ? {} : { sizeBytes: photo.fileSize }),
      width: photo.width,
      height: photo.height,
      ...(input.message.caption === undefined
        ? {}
        : { caption: input.message.caption }),
      fileId: photo.fileId,
      ...(photo.fileUniqueId === undefined
        ? {}
        : { fileUniqueId: photo.fileUniqueId }),
      ...(file?.filePath === undefined ? {} : { filePath: file.filePath }),
      ...(file?.localPath === undefined ? {} : { localPath: file.localPath }),
      ...(file?.contentRef === undefined
        ? {}
        : { contentRef: file.contentRef }),
      source: {
        provider: TELEGRAM_PROVIDER,
        fileId: photo.fileId,
        ...(file?.filePath === undefined ? {} : { filePath: file.filePath }),
        ...(file?.localPath === undefined ? {} : { localPath: file.localPath }),
        ...(file?.contentRef === undefined
          ? {}
          : { contentRef: file.contentRef }),
      },
    },
  ];
}

function imagePathsFromAttachments(
  attachments: readonly TelegramPhotoAttachment[],
): readonly string[] {
  return attachments.flatMap((attachment) =>
    attachment.localPath === undefined ? [] : [attachment.localPath],
  );
}

function normalizeTelegramUpdate(input: {
  readonly source: TelegramGatewaySourceConfig;
  readonly update: TelegramUpdate;
  readonly receivedAt: string;
  readonly rawRef: RawExternalEvent["rawRef"];
  readonly files?: ReadonlyMap<string, TelegramResolvedPhotoFile>;
}): ExternalEventEnvelope {
  const message = input.update.message;
  const actorName = displayName(message.from);
  const occurredAt =
    message.date === undefined
      ? undefined
      : new Date(message.date * 1000).toISOString();
  const attachments = readPhotoAttachments({
    source: input.source,
    message,
    ...(input.files === undefined ? {} : { files: input.files }),
  });
  const imagePaths = imagePathsFromAttachments(attachments);
  const text =
    message.text.length > 0
      ? message.text
      : attachments.length > 0
        ? "[Photo attachment]"
        : "";
  const replyTarget = {
    sourceId: input.source.id,
    provider: input.source.provider ?? TELEGRAM_PROVIDER,
    eventId: message.messageId,
    conversationId: message.chat.id,
    ...(message.messageThreadId === undefined
      ? {}
      : { threadId: message.messageThreadId }),
    ...(message.from?.id === undefined ? {} : { actorId: message.from.id }),
  };
  return {
    sourceId: input.source.id,
    eventId: `${String(input.update.updateId)}:${message.messageId}`,
    provider: input.source.provider ?? TELEGRAM_PROVIDER,
    eventType: "chat.message",
    ...(occurredAt === undefined ? {} : { occurredAt }),
    receivedAt: input.receivedAt,
    dedupeKey: `${input.source.id}:${String(input.update.updateId)}:${message.messageId}`,
    ...(message.from === undefined
      ? {}
      : {
          actor: {
            id: message.from.id,
            ...(actorName === undefined ? {} : { displayName: actorName }),
            ...(message.from.username === undefined
              ? {}
              : { username: message.from.username }),
            isBot: message.from.isBot === true,
          },
        }),
    conversation: {
      id: message.chat.id,
      ...(message.messageThreadId === undefined
        ? {}
        : { threadId: message.messageThreadId }),
    },
    input: {
      provider: input.source.provider ?? TELEGRAM_PROVIDER,
      text,
      ...(attachments.length === 0
        ? {}
        : {
            attachments,
            attachmentText: message.caption ?? "",
            ...(imagePaths.length === 0 ? {} : { imagePaths }),
          }),
      telegram: {
        updateId: input.update.updateId,
        messageId: message.messageId,
        chatId: message.chat.id,
        ...(message.chat.type === undefined
          ? {}
          : { chatType: message.chat.type }),
        ...(message.chat.title === undefined
          ? {}
          : { chatTitle: message.chat.title }),
        ...(message.chat.username === undefined
          ? {}
          : { chatUsername: message.chat.username }),
        ...(message.messageThreadId === undefined
          ? {}
          : { messageThreadId: message.messageThreadId }),
      },
      replyTarget,
    },
    ...(input.rawRef === undefined ? {} : { rawRef: input.rawRef }),
  };
}

async function normalizeOneTelegramRawEvent(
  raw: RawExternalEvent,
): Promise<ExternalEventEnvelope> {
  const source = sourceFromRaw(raw);
  const update = readUpdateBody(raw.body);
  if (
    update === null ||
    !shouldAcceptMessage({ source, message: update.message })
  ) {
    throw new Error(
      "telegram-gateway raw event did not contain a supported message",
    );
  }
  return normalizeTelegramUpdate({
    source,
    update,
    receivedAt: raw.receivedAt,
    rawRef: raw.rawRef,
  });
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

function telegramFileUrl(input: {
  readonly source: TelegramGatewaySourceConfig;
  readonly token: string;
  readonly filePath: string;
}): string {
  const base = input.source.restBaseUrl ?? DEFAULT_REST_BASE_URL;
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const encodedFilePath = input.filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${normalizedBase}/file/bot${input.token}/${encodedFilePath}`;
}

async function readOffset(
  filePath: string | undefined,
): Promise<number | undefined> {
  if (filePath === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (isJsonObject(parsed)) {
      const offset = optionalNumber(parsed["offset"]);
      return offset === undefined ? undefined : Math.trunc(offset);
    }
    return undefined;
  } catch (error: unknown) {
    if (isJsonObject(error) && error["code"] === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function writeOffset(
  filePath: string | undefined,
  offset: number | undefined,
): Promise<void> {
  if (filePath === undefined || offset === undefined) {
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({ offset }, null, 2)}\n`, "utf8");
}

function normalizeErrorClass(error: unknown): string {
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  if (error instanceof Error && error.name.length > 0) {
    return error.name;
  }
  if (error instanceof DOMException && error.name.length > 0) {
    return error.name;
  }
  return typeof error;
}

async function downloadTelegramPhotoFile(input: {
  readonly source: TelegramGatewaySourceConfig;
  readonly token: string;
  readonly updateId: number;
  readonly message: TelegramMessage;
  readonly photo: TelegramPhotoSize;
  readonly filePath: string;
  readonly eventDataRoot?: string | undefined;
  readonly fetchImpl: typeof fetch;
  readonly diagnosticSink?: EventSourceDiagnosticSink | undefined;
}): Promise<TelegramResolvedPhotoFile> {
  if (input.eventDataRoot === undefined || input.eventDataRoot.length === 0) {
    return { filePath: input.filePath };
  }
  const contentRef = relativeEventAttachmentPath(input);
  const localPath = path.join(input.eventDataRoot, contentRef);
  try {
    const response = await input.fetchImpl(
      telegramFileUrl({
        source: input.source,
        token: input.token,
        filePath: input.filePath,
      }),
      { method: "GET" },
    );
    if (!response.ok) {
      input.diagnosticSink?.({
        sourceId: input.source.id,
        httpStatus: response.status,
        errorClass: TELEGRAM_DOWNLOAD_FILE_HTTP_ERROR_CLASS,
      });
      return { filePath: input.filePath };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, bytes);
    return { filePath: input.filePath, localPath, contentRef };
  } catch (error: unknown) {
    input.diagnosticSink?.({
      sourceId: input.source.id,
      errorClass: normalizeErrorClass(error),
    });
    return { filePath: input.filePath };
  }
}

async function resolveTelegramPhotoFiles(input: {
  readonly source: TelegramGatewaySourceConfig;
  readonly token: string;
  readonly updateId: number;
  readonly message: TelegramMessage;
  readonly eventDataRoot?: string | undefined;
  readonly fetchImpl: typeof fetch;
  readonly diagnosticSink?: EventSourceDiagnosticSink | undefined;
}): Promise<ReadonlyMap<string, TelegramResolvedPhotoFile>> {
  if (input.source.attachments?.resolveFilePaths !== true) {
    return new Map();
  }
  const photo = selectLargestPhoto(input.message.photos);
  if (photo === undefined) {
    return new Map();
  }
  const response = await input.fetchImpl(
    telegramApiUrl({
      source: input.source,
      token: input.token,
      method: "getFile",
    }),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_id: photo.fileId }),
    },
  );
  if (!response.ok) {
    input.diagnosticSink?.({
      sourceId: input.source.id,
      httpStatus: response.status,
      errorClass: TELEGRAM_GET_FILE_HTTP_ERROR_CLASS,
    });
    return new Map();
  }
  const body = (await response.json()) as unknown;
  const result = isJsonObject(body) ? body["result"] : undefined;
  const filePath = isJsonObject(result)
    ? (optionalString(result["file_path"]) ??
      optionalString(result["filePath"]))
    : undefined;
  if (filePath === undefined) {
    return new Map();
  }
  const file = await downloadTelegramPhotoFile({
    source: input.source,
    token: input.token,
    updateId: input.updateId,
    message: input.message,
    photo,
    filePath,
    eventDataRoot: input.eventDataRoot,
    fetchImpl: input.fetchImpl,
    diagnosticSink: input.diagnosticSink,
  });
  return new Map([[photo.fileId, file]]);
}

async function startTelegramGatewaySource(
  input: EventSourceStartInput,
): Promise<EventSourceHandle> {
  if (!isTelegramSource(input.source)) {
    throw new Error(
      "telegram-gateway start requires a telegram-gateway source",
    );
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
  const botId =
    source.botIdEnv === undefined
      ? undefined
      : requiredEnv({
          env,
          envName: source.botIdEnv,
          sourceId: source.id,
          label: "bot id",
        });
  const historyCache =
    source.history === undefined
      ? undefined
      : createTelegramHistoryCache(source);
  const historyPersistence =
    source.history === undefined
      ? undefined
      : createTelegramHistoryPersistence({
          source,
          eventDataRoot: input.eventDataRoot,
          readOnly: input.readOnly,
          diagnosticSink: input.diagnosticSink,
        });
  let offset = await readOffset(source.polling?.offsetPath);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async (): Promise<void> => {
    if (stopped || input.signal.aborted) {
      return;
    }
    let delayMs = 0;
    try {
      const url = new URL(
        telegramApiUrl({ source, token, method: "getUpdates" }),
      );
      url.searchParams.set(
        "timeout",
        String(source.polling?.timeoutSeconds ?? DEFAULT_POLL_TIMEOUT_SECONDS),
      );
      url.searchParams.set(
        "limit",
        String(source.polling?.limit ?? DEFAULT_POLL_LIMIT),
      );
      if (offset !== undefined) {
        url.searchParams.set("offset", String(offset));
      }
      url.searchParams.set("allowed_updates", JSON.stringify(["message"]));
      const response = await fetchImpl(url.toString(), {
        method: "GET",
        signal: input.signal,
      });
      if (!response.ok) {
        input.diagnosticSink?.({
          sourceId: source.id,
          httpStatus: response.status,
          errorClass: TELEGRAM_POLL_HTTP_ERROR_CLASS,
        });
        delayMs = RETRY_DELAY_MS;
        return;
      }
      const body = (await response.json()) as unknown;
      const result = isJsonObject(body) ? body["result"] : undefined;
      const updates = Array.isArray(result) ? result : [];
      const receivedAt = input.now().toISOString();
      for (const entry of updates) {
        const update = readUpdateBody(entry);
        if (update === null) {
          continue;
        }
        offset = Math.max(offset ?? 0, update.updateId + 1);
        if (
          !shouldAcceptMessage({
            source,
            message: update.message,
            ...(botId === undefined ? {} : { botId }),
          })
        ) {
          continue;
        }
        const files = await resolveTelegramPhotoFiles({
          source,
          token,
          updateId: update.updateId,
          message: update.message,
          eventDataRoot: input.eventDataRoot,
          fetchImpl,
          diagnosticSink: input.diagnosticSink,
        });
        let event = normalizeTelegramUpdate({
          source,
          update,
          receivedAt,
          rawRef: undefined,
          files,
        });
        if (historyCache !== undefined && historyPersistence !== undefined) {
          const key = telegramHistoryKey({
            source,
            chatId: update.message.chat.id,
          });
          await seedTelegramHistory({
            key,
            receivedAt,
            cache: historyCache,
            persistence: historyPersistence,
          });
          event = attachTelegramHistory({
            source,
            event,
            cache: historyCache,
            key,
          });
        }
        const outcome = await input.dispatch(event, entry);
        const accepted =
          outcome === undefined ||
          outcome.receipts.some((receipt) => !receipt.duplicate);
        if (
          accepted &&
          historyCache !== undefined &&
          historyPersistence !== undefined
        ) {
          await appendAcceptedTelegramHistory({
            source,
            event,
            cache: historyCache,
            persistence: historyPersistence,
          });
        }
      }
      await writeOffset(source.polling?.offsetPath, offset);
    } catch (error: unknown) {
      if (
        !(error instanceof DOMException && error.name === "AbortError") &&
        !stopped
      ) {
        input.diagnosticSink?.({
          sourceId: source.id,
          errorClass: normalizeErrorClass(error),
        });
        delayMs = RETRY_DELAY_MS;
      }
    } finally {
      if (!stopped && !input.signal.aborted) {
        timer = setTimeout(() => void poll(), delayMs);
      }
    }
  };
  void poll();
  const stop = (): void => {
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  };
  input.signal.addEventListener("abort", stop, { once: true });
  return {
    sourceId: source.id,
    stop: async () => {
      stop();
    },
  };
}

export function createTelegramGatewayEventSourceAdapter(): EventSourceAdapter {
  const historyCaches = new Map<string, ChatHistoryCache>();
  const historyCacheFor = (source: TelegramGatewaySourceConfig) => {
    const existing = historyCaches.get(source.id);
    if (existing !== undefined) {
      return existing;
    }
    const created = createTelegramHistoryCache(source);
    historyCaches.set(source.id, created);
    return created;
  };
  return {
    kind: "telegram-gateway",
    capabilities: {
      eventTypes: ["chat.message"],
      supportsStart: true,
      webhook: false,
      chatReply: true,
    },
    start: startTelegramGatewaySource,
    async normalize(raw): Promise<ExternalEventEnvelope> {
      const event = await normalizeOneTelegramRawEvent(raw);
      if (!isTelegramSource(raw.source) || raw.source.history === undefined) {
        return event;
      }
      const chatId = event.conversation?.id;
      if (chatId === undefined) {
        return event;
      }
      const source = raw.source;
      const cache = historyCacheFor(source);
      const persistence = createTelegramHistoryPersistence({
        source,
        eventDataRoot: raw.eventDataRoot,
        readOnly: raw.readOnly,
        diagnosticSink: raw.diagnosticSink,
      });
      const key = telegramHistoryKey({ source, chatId });
      await seedTelegramHistory({
        key,
        receivedAt: raw.receivedAt,
        cache,
        persistence,
      });
      return attachTelegramHistory({ source, event, cache, key });
    },
    async recordAcceptedEvent(
      input: EventSourceAcceptedEventInput,
    ): Promise<void> {
      if (!isTelegramSource(input.source)) {
        return;
      }
      const source = input.source;
      await appendAcceptedTelegramHistory({
        source,
        event: input.event,
        cache: historyCacheFor(source),
        persistence: createTelegramHistoryPersistence({
          source,
          eventDataRoot: input.eventDataRoot,
          readOnly: input.readOnly,
          diagnosticSink: input.diagnosticSink,
        }),
      });
    },
    dispatchChatReply: dispatchTelegramGatewayReply,
  };
}

export { dispatchTelegramGatewayReply } from "./telegram-gateway-reply";
