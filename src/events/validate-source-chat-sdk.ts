import { isJsonObject } from "../shared/json";
import {
  CHAT_SDK_PROVIDERS,
  getChatSdkProviderCapability,
  isChatSdkProvider,
} from "./adapters/chat-sdk";
import {
  eventConfigError as error,
  isNonEmptyString,
  isPositiveInteger,
  validateEnvName,
  validateSecretEnvName,
} from "./validation-utils";
import type {
  ChatSdkSourceConfig,
  EventBinding,
  EventConfigValidationIssue,
  EventSourceConfig,
} from "./types";

function validateChatSdkRelativePath(
  value: unknown,
  pathName: string,
  issues: EventConfigValidationIssue[],
): void {
  if (
    !isNonEmptyString(value) ||
    value.startsWith("/") ||
    value.includes("..") ||
    value.includes("?") ||
    value.includes("#") ||
    /\s/.test(value)
  ) {
    issues.push(
      error(
        pathName,
        "chat-sdk webhook path must be a relative path without traversal, whitespace, '?' or '#'",
      ),
    );
  }
}

export function chatSdkHttpPath(
  source: ChatSdkSourceConfig,
): string | undefined {
  const pathValue = source.webhook.path;
  if (!isNonEmptyString(pathValue)) {
    return undefined;
  }
  return `/events/${pathValue
    .split("/")
    .filter((part) => part.length > 0)
    .map(encodeURIComponent)
    .join("/")}`;
}

export function isChatSdkSource(
  source: EventSourceConfig | undefined,
): source is ChatSdkSourceConfig {
  return source?.kind === "chat-sdk";
}

export function validateChatSdkSource(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  const base = `sources.${source.id}`;
  if (!isChatSdkProvider(source["provider"])) {
    issues.push(
      error(
        `${base}.provider`,
        `chat-sdk provider must be one of ${CHAT_SDK_PROVIDERS.join(", ")}`,
      ),
    );
  }
  if (source["mode"] !== undefined && source["mode"] !== "generic-webhook") {
    issues.push(
      error(`${base}.mode`, "chat-sdk mode must be 'generic-webhook' when set"),
    );
  }
  const webhook = source["webhook"];
  if (!isJsonObject(webhook)) {
    issues.push(error(`${base}.webhook`, "chat-sdk webhook is required"));
  } else {
    validateChatSdkRelativePath(
      webhook["path"],
      `${base}.webhook.path`,
      issues,
    );
    validateSecretEnvName(
      webhook["signingSecretEnv"],
      `${base}.webhook.signingSecretEnv`,
      issues,
    );
    validateEnvName(
      webhook["bearerTokenEnv"],
      `${base}.webhook.bearerTokenEnv`,
      "bearer token env var name",
      issues,
    );
    if (
      webhook["signingSecretEnv"] === undefined &&
      webhook["bearerTokenEnv"] === undefined
    ) {
      issues.push(
        error(
          `${base}.webhook`,
          "chat-sdk webhook must configure signingSecretEnv or bearerTokenEnv",
        ),
      );
    }
    const rateLimit = webhook["rateLimit"];
    if (rateLimit !== undefined) {
      if (!isJsonObject(rateLimit)) {
        issues.push(
          error(`${base}.webhook.rateLimit`, "rateLimit must be an object"),
        );
      } else {
        if (!isPositiveInteger(rateLimit["windowMs"])) {
          issues.push(
            error(
              `${base}.webhook.rateLimit.windowMs`,
              "rateLimit.windowMs must be at least 1",
            ),
          );
        }
        if (!isPositiveInteger(rateLimit["maxRequests"])) {
          issues.push(
            error(
              `${base}.webhook.rateLimit.maxRequests`,
              "rateLimit.maxRequests must be at least 1",
            ),
          );
        }
      }
    }
  }

  const send = source["send"];
  if (send !== undefined) {
    if (!isJsonObject(send)) {
      issues.push(error(`${base}.send`, "chat-sdk send must be an object"));
    } else {
      validateEnvName(
        send["endpointUrlEnv"],
        `${base}.send.endpointUrlEnv`,
        "send endpoint URL env var name",
        issues,
      );
      if (!isNonEmptyString(send["endpointUrlEnv"])) {
        issues.push(
          error(
            `${base}.send.endpointUrlEnv`,
            "send endpoint URL env var name is required",
          ),
        );
      }
      validateEnvName(
        send["tokenEnv"],
        `${base}.send.tokenEnv`,
        "send token env var name",
        issues,
      );
    }
  }
  if (
    isJsonObject(source["providerConfig"]) &&
    source["providerConfig"]["eventType"] !== undefined
  ) {
    issues.push(
      error(
        `${base}.providerConfig.eventType`,
        "providerConfig cannot bypass normalized event type mapping",
      ),
    );
  }
}

export function validateChatSdkBindingCapabilities(input: {
  readonly binding: EventBinding;
  readonly source: EventSourceConfig | undefined;
  readonly issues: EventConfigValidationIssue[];
}): void {
  if (!isChatSdkSource(input.source)) {
    return;
  }
  const eventType = input.binding.match?.eventType;
  if (eventType === undefined) {
    return;
  }
  const provider = input.source.provider;
  if (!isChatSdkProvider(provider)) {
    return;
  }
  const capability = getChatSdkProviderCapability(provider);
  if (!(capability.eventTypes as readonly string[]).includes(eventType)) {
    input.issues.push(
      error(
        `bindings.${input.binding.id}.match.eventType`,
        `chat-sdk provider '${provider}' does not support event type '${eventType}'`,
      ),
    );
  }
}
