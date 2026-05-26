import { isJsonObject } from "../shared/json";
import {
  eventConfigError as error,
  isNonEmptyString,
  validateEnvName,
  validateSafeObjectPrefix,
} from "./validation-utils";
import type {
  ChatSdkSourceConfig,
  ChatOutputDestinationConfig,
  EventConfigValidationIssue,
  EventOutputDestinationConfig,
  EventSourceConfig,
} from "./types";

const SUPPORTED_DESTINATION_KINDS = new Set(["chat", "s3-backup"]);

export function validateDestination(
  destination: EventOutputDestinationConfig,
  sourcesById: ReadonlyMap<string, EventSourceConfig>,
  issues: EventConfigValidationIssue[],
): void {
  if (!SUPPORTED_DESTINATION_KINDS.has(destination.kind)) {
    issues.push(
      error(
        `destinations.${destination.id}.kind`,
        `unsupported destination kind '${destination.kind}'`,
      ),
    );
  }

  if (destination.kind === "chat") {
    validateChatDestination(
      destination as ChatOutputDestinationConfig,
      sourcesById,
      issues,
    );
  }
  if (destination.kind === "s3-backup") {
    validateS3BackupDestination(destination, issues);
  }
}

export function validateBindingOutputDestinations(
  bindingId: string,
  outputDestinations: readonly string[] | undefined,
  destinationsById: ReadonlyMap<string, EventOutputDestinationConfig>,
  issues: EventConfigValidationIssue[],
): void {
  if (outputDestinations === undefined) {
    return;
  }
  if (!Array.isArray(outputDestinations) || outputDestinations.length === 0) {
    issues.push(
      error(
        `bindings.${bindingId}.outputDestinations`,
        "outputDestinations must be a non-empty string array when set",
      ),
    );
    return;
  }
  for (const [index, destinationId] of outputDestinations.entries()) {
    const path = `bindings.${bindingId}.outputDestinations[${String(index)}]`;
    if (typeof destinationId !== "string" || destinationId.length === 0) {
      issues.push(
        error(path, "output destination id must be a non-empty string"),
      );
    } else if (!destinationsById.has(destinationId)) {
      issues.push(error(path, `unknown output destination '${destinationId}'`));
    }
  }
}

function validateChatDestination(
  destination: ChatOutputDestinationConfig,
  sourcesById: ReadonlyMap<string, EventSourceConfig>,
  issues: EventConfigValidationIssue[],
): void {
  const sourceId = destination["sourceId"];
  if (!isNonEmptyString(sourceId)) {
    issues.push(
      error(
        `destinations.${destination.id}.sourceId`,
        "chat destination sourceId is required",
      ),
    );
  } else if (!sourcesById.has(sourceId)) {
    issues.push(
      error(
        `destinations.${destination.id}.sourceId`,
        `unknown source '${sourceId}'`,
      ),
    );
  } else {
    const source = sourcesById.get(sourceId);
    if (
      source?.kind === "chat-sdk" &&
      (source as ChatSdkSourceConfig).send === undefined
    ) {
      issues.push(
        error(
          `destinations.${destination.id}.sourceId`,
          `chat-sdk source '${sourceId}' does not configure send`,
        ),
      );
    }
  }

  const target = destination["target"];
  if (target === undefined) {
    return;
  }
  if (!isJsonObject(target)) {
    issues.push(
      error(
        `destinations.${destination.id}.target`,
        "chat destination target must be an object when set",
      ),
    );
    return;
  }
  for (const key of [
    "provider",
    "eventId",
    "conversationId",
    "threadId",
    "actorId",
  ] as const) {
    const value = target[key];
    if (value !== undefined && !isNonEmptyString(value)) {
      issues.push(
        error(
          `destinations.${destination.id}.target.${key}`,
          "chat destination target fields must be non-empty strings",
        ),
      );
    }
  }
}

function validateS3BackupDestination(
  destination: EventOutputDestinationConfig,
  issues: EventConfigValidationIssue[],
): void {
  if (
    destination["provider"] !== "aws-s3" &&
    destination["provider"] !== "s3-compatible"
  ) {
    issues.push(
      error(
        `destinations.${destination.id}.provider`,
        "s3-backup provider must be aws-s3 or s3-compatible",
      ),
    );
  }
  if (!isNonEmptyString(destination["bucket"])) {
    issues.push(
      error(`destinations.${destination.id}.bucket`, "bucket is required"),
    );
  }
  validateEnvName(
    destination["endpointUrlEnv"],
    `destinations.${destination.id}.endpointUrlEnv`,
    "endpoint URL env var name",
    issues,
  );
  validateSafeObjectPrefix(
    destination["rootPrefix"],
    `destinations.${destination.id}.rootPrefix`,
    issues,
  );
}
