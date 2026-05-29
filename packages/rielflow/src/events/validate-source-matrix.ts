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

const MATRIX_ROOM_ID_PATTERN = /^![^\s:]+:[^\s:]+$/;
const MATRIX_USER_ID_PATTERN = /^@[^\s:]+:[^\s:]+$/;
const MAX_MATRIX_ATTACHMENT_BYTES = 1_048_576;

export function validateMatrixSource(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  if (!isNonEmptyString(source["homeserverUrlEnv"])) {
    issues.push(
      error(
        `sources.${source.id}.homeserverUrlEnv`,
        "homeserver URL env var name is required",
      ),
    );
  } else {
    validateEnvName(
      source["homeserverUrlEnv"],
      `sources.${source.id}.homeserverUrlEnv`,
      "homeserver URL env var name",
      issues,
    );
  }
  if (!isNonEmptyString(source["accessTokenEnv"])) {
    issues.push(
      error(
        `sources.${source.id}.accessTokenEnv`,
        "access token env var name is required",
      ),
    );
  } else {
    validateSecretEnvName(
      source["accessTokenEnv"],
      `sources.${source.id}.accessTokenEnv`,
      issues,
    );
  }
  if (
    !isNonEmptyString(source["userId"]) ||
    !MATRIX_USER_ID_PATTERN.test(source["userId"])
  ) {
    issues.push(
      error(
        `sources.${source.id}.userId`,
        "Matrix user id must look like @user:server",
      ),
    );
  }
  validateMatrixRooms(source, issues);
  validateMatrixSync(source, issues);
  validateMatrixHistory(source, issues);
  validateMatrixAttachments(source, issues);
  if (
    source["ignoreOwnMessages"] !== undefined &&
    typeof source["ignoreOwnMessages"] !== "boolean"
  ) {
    issues.push(
      error(
        `sources.${source.id}.ignoreOwnMessages`,
        "ignoreOwnMessages must be a boolean when set",
      ),
    );
  }
}

function validateMatrixAttachments(
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
  if (
    attachments["downloadText"] !== undefined &&
    typeof attachments["downloadText"] !== "boolean"
  ) {
    issues.push(
      error(
        `sources.${source.id}.attachments.downloadText`,
        "must be a boolean",
      ),
    );
  }
  const maxBytes = attachments["maxBytes"];
  if (
    maxBytes !== undefined &&
    (!isPositiveInteger(maxBytes) ||
      Number(maxBytes) > MAX_MATRIX_ATTACHMENT_BYTES)
  ) {
    issues.push(
      error(
        `sources.${source.id}.attachments.maxBytes`,
        `must be a positive integer no greater than ${String(MAX_MATRIX_ATTACHMENT_BYTES)}`,
      ),
    );
  }
  const allowedMimeTypes = attachments["allowedMimeTypes"];
  if (allowedMimeTypes !== undefined) {
    if (
      !Array.isArray(allowedMimeTypes) ||
      allowedMimeTypes.length === 0 ||
      !allowedMimeTypes.every(isNonEmptyString)
    ) {
      issues.push(
        error(
          `sources.${source.id}.attachments.allowedMimeTypes`,
          "must be a non-empty array of MIME type strings",
        ),
      );
    }
  }
}

function validateMatrixHistory(
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
  const scope = history["scope"];
  if (scope !== undefined && scope !== "room" && scope !== "thread-or-room") {
    issues.push(
      error(
        `sources.${source.id}.history.scope`,
        "must be 'room' or 'thread-or-room'",
      ),
    );
  }
  if (
    history["includeOwnMessages"] !== undefined &&
    typeof history["includeOwnMessages"] !== "boolean"
  ) {
    issues.push(
      error(
        `sources.${source.id}.history.includeOwnMessages`,
        "must be a boolean",
      ),
    );
  }
}

function validateMatrixRooms(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  const rooms = source["rooms"];
  if (!Array.isArray(rooms) || rooms.length === 0) {
    issues.push(
      error(
        `sources.${source.id}.rooms`,
        "at least one Matrix room is required",
      ),
    );
    return;
  }
  rooms.forEach((room, index) => {
    const pathName = `sources.${source.id}.rooms[${String(index)}]`;
    if (!isJsonObject(room)) {
      issues.push(error(pathName, "Matrix room must be an object"));
      return;
    }
    if (
      !isNonEmptyString(room["roomId"]) ||
      !MATRIX_ROOM_ID_PATTERN.test(room["roomId"])
    ) {
      issues.push(
        error(
          `${pathName}.roomId`,
          "Matrix room id must look like !room:server",
        ),
      );
    }
    if (room["alias"] !== undefined && !isNonEmptyString(room["alias"])) {
      issues.push(
        error(`${pathName}.alias`, "Matrix room alias must be non-empty"),
      );
    }
  });
}

function validateMatrixSync(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  const sync = source["sync"];
  if (sync === undefined) {
    return;
  }
  if (!isJsonObject(sync)) {
    issues.push(error(`sources.${source.id}.sync`, "sync must be an object"));
    return;
  }
  const timeout = sync["pollTimeoutMs"];
  if (
    timeout !== undefined &&
    (!isPositiveInteger(timeout) ||
      Number(timeout) < 1000 ||
      Number(timeout) > 30000)
  ) {
    issues.push(
      error(
        `sources.${source.id}.sync.pollTimeoutMs`,
        "sync pollTimeoutMs must be an integer between 1000 and 30000",
      ),
    );
  }
  const sinceTokenPath = sync["sinceTokenPath"];
  if (
    sinceTokenPath !== undefined &&
    (!isNonEmptyString(sinceTokenPath) ||
      sinceTokenPath.startsWith("/") ||
      sinceTokenPath.includes(".."))
  ) {
    issues.push(
      error(
        `sources.${source.id}.sync.sinceTokenPath`,
        "sync sinceTokenPath must be a safe relative path",
      ),
    );
  }
}
