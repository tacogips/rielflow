import { isJsonObject } from "../shared/json";
import {
  DISCORD_GATEWAY_HISTORY_LIMITS,
  isDiscordSnowflake,
} from "./adapters/discord-gateway";
import {
  eventConfigError as error,
  isNonEmptyString,
  isPositiveInteger,
  validateEnvName,
  validateSecretEnvName,
} from "./validation-utils";
import type { EventConfigValidationIssue, EventSourceConfig } from "./types";

const MAX_HISTORY_BYTES = 131_072;
const MAX_HISTORY_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function validateSnowflakeList(input: {
  readonly value: unknown;
  readonly path: string;
  readonly issues: EventConfigValidationIssue[];
}): void {
  if (input.value === undefined) {
    return;
  }
  if (!Array.isArray(input.value)) {
    input.issues.push(error(input.path, "must be an array of Discord ids"));
    return;
  }
  input.value.forEach((entry, index) => {
    if (typeof entry !== "string" || !isDiscordSnowflake(entry)) {
      input.issues.push(
        error(
          `${input.path}[${String(index)}]`,
          "must be a Discord snowflake string",
        ),
      );
    }
  });
}

function validateChannels(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  const channels = source["channels"];
  if (!Array.isArray(channels) || channels.length === 0) {
    issues.push(
      error(
        `sources.${source.id}.channels`,
        "discord-gateway channels must be a non-empty array",
      ),
    );
    return;
  }
  channels.forEach((channel, index) => {
    const path = `sources.${source.id}.channels[${String(index)}]`;
    if (!isJsonObject(channel)) {
      issues.push(error(path, "channel entry must be an object"));
      return;
    }
    const id = channel["id"];
    if (typeof id !== "string" || !isDiscordSnowflake(id)) {
      issues.push(error(`${path}.id`, "must be a Discord snowflake string"));
    }
    if (
      channel["includeThreads"] !== undefined &&
      typeof channel["includeThreads"] !== "boolean"
    ) {
      issues.push(error(`${path}.includeThreads`, "must be a boolean"));
    }
    if (
      channel["personas"] !== undefined &&
      (!Array.isArray(channel["personas"]) ||
        !channel["personas"].every(isNonEmptyString))
    ) {
      issues.push(
        error(`${path}.personas`, "must be an array of non-empty strings"),
      );
    }
  });
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
      Number(maxMessages) > DISCORD_GATEWAY_HISTORY_LIMITS.maxMessages)
  ) {
    issues.push(
      error(
        `sources.${source.id}.history.maxMessages`,
        `must be a positive integer no greater than ${String(DISCORD_GATEWAY_HISTORY_LIMITS.maxMessages)}`,
      ),
    );
  }
  const maxBytes = history["maxBytes"];
  if (
    maxBytes !== undefined &&
    (!isPositiveInteger(maxBytes) || Number(maxBytes) > MAX_HISTORY_BYTES)
  ) {
    issues.push(
      error(
        `sources.${source.id}.history.maxBytes`,
        `must be a positive integer no greater than ${String(MAX_HISTORY_BYTES)}`,
      ),
    );
  }
  const maxAgeMs = history["maxAgeMs"];
  if (
    maxAgeMs !== undefined &&
    (!isPositiveInteger(maxAgeMs) || Number(maxAgeMs) > MAX_HISTORY_AGE_MS)
  ) {
    issues.push(
      error(
        `sources.${source.id}.history.maxAgeMs`,
        `must be a positive integer no greater than ${String(MAX_HISTORY_AGE_MS)}`,
      ),
    );
  }
  const scope = history["scope"];
  if (
    scope !== undefined &&
    scope !== "channel" &&
    scope !== "thread-or-channel"
  ) {
    issues.push(
      error(
        `sources.${source.id}.history.scope`,
        "must be 'channel' or 'thread-or-channel'",
      ),
    );
  }
  const fetchOnMessage = history["fetchOnMessage"];
  if (
    fetchOnMessage !== undefined &&
    fetchOnMessage !== "never" &&
    fetchOnMessage !== "when-cache-empty" &&
    fetchOnMessage !== "always"
  ) {
    issues.push(
      error(
        `sources.${source.id}.history.fetchOnMessage`,
        "must be 'never', 'when-cache-empty', or 'always'",
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
  for (const key of ["ignoreBots", "ignoreSelf", "requireMention"]) {
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
  for (const key of ["includeImages", "resolveFilePaths"]) {
    if (
      attachments[key] !== undefined &&
      typeof attachments[key] !== "boolean"
    ) {
      issues.push(
        error(`sources.${source.id}.attachments.${key}`, "must be a boolean"),
      );
    }
  }
  const maxBytes = attachments["maxBytes"];
  if (
    maxBytes !== undefined &&
    (!isPositiveInteger(maxBytes) || Number(maxBytes) > 20 * 1024 * 1024)
  ) {
    issues.push(
      error(
        `sources.${source.id}.attachments.maxBytes`,
        "must be a positive integer no greater than 20971520",
      ),
    );
  }
}

export function validateDiscordGatewaySource(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  if (source.kind !== "discord-gateway") {
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
  if (!isNonEmptyString(source["applicationIdEnv"])) {
    issues.push(
      error(
        `sources.${source.id}.applicationIdEnv`,
        "applicationIdEnv is required",
      ),
    );
  }
  validateEnvName(
    source["applicationIdEnv"],
    `sources.${source.id}.applicationIdEnv`,
    "application id env var name",
    issues,
  );
  validateSnowflakeList({
    value: source["guildIds"],
    path: `sources.${source.id}.guildIds`,
    issues,
  });
  validateChannels(source, issues);
  validateHistory(source, issues);
  validateFilters(source, issues);
  validateAttachments(source, issues);
  validateReplyBots(source, issues);
  const intents = source["intents"];
  if (
    intents !== undefined &&
    (!Number.isInteger(intents) || Number(intents) <= 0)
  ) {
    issues.push(
      error(`sources.${source.id}.intents`, "must be a positive integer"),
    );
  }
}
