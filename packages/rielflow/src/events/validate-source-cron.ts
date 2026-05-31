import { isJsonObject } from "../shared/json";
import { isValidCronSchedule, isValidTimeZone } from "./adapters/cron";
import type { EventConfigValidationIssue, EventSourceConfig } from "./types";
import {
  eventConfigError as error,
  isNonEmptyString,
  validateEnvName,
} from "./validation-utils";

function validateCronReplyTarget(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  const target = source["replyTarget"];
  if (target === undefined) {
    return;
  }
  if (!isJsonObject(target)) {
    issues.push(
      error(
        `sources.${source.id}.replyTarget`,
        "cron replyTarget must be an object when set",
      ),
    );
    return;
  }
  for (const key of [
    "sourceId",
    "provider",
    "conversationId",
    "conversationIdEnv",
    "eventId",
    "threadId",
    "actorId",
  ] as const) {
    const value = target[key];
    if (value !== undefined && !isNonEmptyString(value)) {
      issues.push(
        error(
          `sources.${source.id}.replyTarget.${key}`,
          "cron replyTarget fields must be non-empty strings",
        ),
      );
    }
  }
  for (const key of ["sourceId", "provider"] as const) {
    if (target[key] === undefined) {
      issues.push(
        error(
          `sources.${source.id}.replyTarget.${key}`,
          "cron replyTarget requires sourceId and provider",
        ),
      );
    }
  }
  if (
    target["conversationId"] === undefined &&
    target["conversationIdEnv"] === undefined
  ) {
    issues.push(
      error(
        `sources.${source.id}.replyTarget.conversationId`,
        "cron replyTarget requires conversationId or conversationIdEnv",
      ),
    );
  }
  if (typeof target["conversationIdEnv"] === "string") {
    validateEnvName(
      target["conversationIdEnv"],
      `sources.${source.id}.replyTarget.conversationIdEnv`,
      "conversation id env var name",
      issues,
    );
  }
}

export function validateCronSource(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  if (source.kind !== "cron") {
    return;
  }
  if (!isNonEmptyString(source["schedule"])) {
    issues.push(
      error(`sources.${source.id}.schedule`, "cron schedule is required"),
    );
  } else if (!isValidCronSchedule(source["schedule"])) {
    issues.push(
      error(
        `sources.${source.id}.schedule`,
        "cron schedule must have five or six valid fields",
      ),
    );
  }
  if (!isNonEmptyString(source["timezone"])) {
    issues.push(error(`sources.${source.id}.timezone`, "timezone is required"));
  } else if (!isValidTimeZone(source["timezone"])) {
    issues.push(
      error(
        `sources.${source.id}.timezone`,
        "timezone must be a valid IANA time zone",
      ),
    );
  }
  validateCronReplyTarget(source, issues);
}
