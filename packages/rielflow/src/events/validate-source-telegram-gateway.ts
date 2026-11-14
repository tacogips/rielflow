import { isJsonObject } from "../shared/json";
import { CHAT_HISTORY_LIMITS } from "./adapters/chat-history-persistence";
import {
  eventConfigError as error,
  isNonEmptyString,
  isPositiveInteger,
  validateEnvName,
  validateSecretEnvName,
} from "./validation-utils";
import type { EventConfigValidationIssue, EventSourceConfig } from "./types";

const TELEGRAM_CHAT_ID_PATTERN = /^-?\d+$/;
const MAX_POLL_TIMEOUT_SECONDS = 50;
const MAX_POLL_LIMIT = 100;

function validateTelegramChatId(input: {
  readonly value: unknown;
  readonly path: string;
  readonly issues: EventConfigValidationIssue[];
}): void {
  if (
    typeof input.value !== "string" ||
    !TELEGRAM_CHAT_ID_PATTERN.test(input.value)
  ) {
    input.issues.push(error(input.path, "must be a Telegram numeric chat id"));
  }
}

function validateChats(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  const chats = source["chats"];
  if (chats === undefined) {
    return;
  }
  if (!Array.isArray(chats)) {
    issues.push(error(`sources.${source.id}.chats`, "must be an array"));
    return;
  }
  chats.forEach((chat, index) => {
    const path = `sources.${source.id}.chats[${String(index)}]`;
    if (!isJsonObject(chat)) {
      issues.push(error(path, "chat entry must be an object"));
      return;
    }
    validateTelegramChatId({
      value: chat["id"],
      path: `${path}.id`,
      issues,
    });
    if (
      chat["personas"] !== undefined &&
      (!Array.isArray(chat["personas"]) ||
        !chat["personas"].every(isNonEmptyString))
    ) {
      issues.push(
        error(`${path}.personas`, "must be an array of non-empty strings"),
      );
    }
  });
}

function validatePolling(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  const polling = source["polling"];
  if (polling === undefined) {
    return;
  }
  if (!isJsonObject(polling)) {
    issues.push(error(`sources.${source.id}.polling`, "must be an object"));
    return;
  }
  const timeoutSeconds = polling["timeoutSeconds"];
  if (
    timeoutSeconds !== undefined &&
    (!isPositiveInteger(timeoutSeconds) ||
      Number(timeoutSeconds) > MAX_POLL_TIMEOUT_SECONDS)
  ) {
    issues.push(
      error(
        `sources.${source.id}.polling.timeoutSeconds`,
        `must be a positive integer no greater than ${String(MAX_POLL_TIMEOUT_SECONDS)}`,
      ),
    );
  }
  const limit = polling["limit"];
  if (
    limit !== undefined &&
    (!isPositiveInteger(limit) || Number(limit) > MAX_POLL_LIMIT)
  ) {
    issues.push(
      error(
        `sources.${source.id}.polling.limit`,
        `must be a positive integer no greater than ${String(MAX_POLL_LIMIT)}`,
      ),
    );
  }
  if (
    polling["offsetPath"] !== undefined &&
    !isNonEmptyString(polling["offsetPath"])
  ) {
    issues.push(
      error(
        `sources.${source.id}.polling.offsetPath`,
        "must be a non-empty string",
      ),
    );
  }
}

function validateHistory(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  const history = source["history"];
  if (history === undefined) {
    return;
  }
  if (!isJsonObject(history)) {
    issues.push(error(`sources.${source.id}.history`, "must be an object"));
    return;
  }
  const maxMessages = history["maxMessages"];
  if (
    maxMessages !== undefined &&
    (!isPositiveInteger(maxMessages) ||
      Number(maxMessages) > CHAT_HISTORY_LIMITS.maxMessages)
  ) {
    issues.push(
      error(
        `sources.${source.id}.history.maxMessages`,
        `must be a positive integer no greater than ${String(CHAT_HISTORY_LIMITS.maxMessages)}`,
      ),
    );
  }
  const maxBytes = history["maxBytes"];
  if (
    maxBytes !== undefined &&
    (!isPositiveInteger(maxBytes) ||
      Number(maxBytes) > CHAT_HISTORY_LIMITS.maxBytes)
  ) {
    issues.push(
      error(
        `sources.${source.id}.history.maxBytes`,
        `must be a positive integer no greater than ${String(CHAT_HISTORY_LIMITS.maxBytes)}`,
      ),
    );
  }
  const maxAgeMs = history["maxAgeMs"];
  if (
    maxAgeMs !== undefined &&
    (!isPositiveInteger(maxAgeMs) ||
      Number(maxAgeMs) > CHAT_HISTORY_LIMITS.maxAgeMs)
  ) {
    issues.push(
      error(
        `sources.${source.id}.history.maxAgeMs`,
        `must be a positive integer no greater than ${String(CHAT_HISTORY_LIMITS.maxAgeMs)}`,
      ),
    );
  }
  if (history["scope"] !== undefined && history["scope"] !== "chat") {
    issues.push(error(`sources.${source.id}.history.scope`, "must be 'chat'"));
  }
  if (
    history["includeBotMessages"] !== undefined &&
    typeof history["includeBotMessages"] !== "boolean"
  ) {
    issues.push(
      error(
        `sources.${source.id}.history.includeBotMessages`,
        "must be a boolean",
      ),
    );
  }
}

function validateFilters(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  const filters = source["filters"];
  if (filters === undefined) {
    return;
  }
  if (!isJsonObject(filters)) {
    issues.push(error(`sources.${source.id}.filters`, "must be an object"));
    return;
  }
  for (const key of ["ignoreBots", "ignoreSelf"]) {
    if (filters[key] !== undefined && typeof filters[key] !== "boolean") {
      issues.push(
        error(`sources.${source.id}.filters.${key}`, "must be a boolean"),
      );
    }
  }
  if (filters["ignoreSelf"] === false) {
    issues.push(
      error(
        `sources.${source.id}.filters.ignoreSelf`,
        "must not be false; disabling self filtering can create reply loops",
      ),
    );
  }
}

function validateAttachments(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  const attachments = source["attachments"];
  if (attachments === undefined) {
    return;
  }
  if (!isJsonObject(attachments)) {
    issues.push(error(`sources.${source.id}.attachments`, "must be an object"));
    return;
  }
  for (const key of ["includePhotos", "resolveFilePaths"]) {
    if (
      attachments[key] !== undefined &&
      typeof attachments[key] !== "boolean"
    ) {
      issues.push(
        error(`sources.${source.id}.attachments.${key}`, "must be a boolean"),
      );
    }
  }
}

function validateReplyBots(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  const replyBots = source["replyBots"];
  if (replyBots === undefined) {
    return;
  }
  if (!isJsonObject(replyBots)) {
    issues.push(error(`sources.${source.id}.replyBots`, "must be an object"));
    return;
  }
  for (const [botId, config] of Object.entries(replyBots)) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(botId)) {
      issues.push(
        error(
          `sources.${source.id}.replyBots.${botId}`,
          "reply bot id must be lowercase alphanumeric or hyphenated",
        ),
      );
    }
    if (!isJsonObject(config)) {
      issues.push(
        error(`sources.${source.id}.replyBots.${botId}`, "must be an object"),
      );
      continue;
    }
    validateSecretEnvName(
      config["tokenEnv"],
      `sources.${source.id}.replyBots.${botId}.tokenEnv`,
      issues,
    );
  }
}

export function validateTelegramGatewaySource(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  if (source.kind !== "telegram-gateway") {
    return;
  }
  if (!isNonEmptyString(source["tokenEnv"])) {
    issues.push(error(`sources.${source.id}.tokenEnv`, "tokenEnv is required"));
  }
  validateSecretEnvName(
    source["tokenEnv"],
    `sources.${source.id}.tokenEnv`,
    issues,
  );
  validateEnvName(
    source["botIdEnv"],
    `sources.${source.id}.botIdEnv`,
    "bot id env var name",
    issues,
  );
  validateChats(source, issues);
  validatePolling(source, issues);
  validateHistory(source, issues);
  validateFilters(source, issues);
  validateAttachments(source, issues);
  validateReplyBots(source, issues);
  if (source["provider"] !== undefined && source["provider"] !== "telegram") {
    issues.push(
      error(`sources.${source.id}.provider`, "provider must be 'telegram'"),
    );
  }
  if (
    source["restBaseUrl"] !== undefined &&
    !isNonEmptyString(source["restBaseUrl"])
  ) {
    issues.push(
      error(`sources.${source.id}.restBaseUrl`, "must be a non-empty string"),
    );
  }
}
