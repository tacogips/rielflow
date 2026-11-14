import { isJsonObject } from "../shared/json";
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
