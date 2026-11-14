import { isJsonObject } from "../shared/json";
import type { EventSourceConfig, WebhookSourceConfig } from "./types";

export function defaultEventSourceHttpPath(source: EventSourceConfig): string {
  return `/events/${encodeURIComponent(source.id)}`;
}

export function isValidEventHttpPath(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.includes("?") &&
    !value.includes("#") &&
    !/\s/.test(value)
  );
}

export function resolveEventSourceHttpPath(
  source: EventSourceConfig,
): string | undefined {
  if (source.kind === "webhook" && typeof source["path"] === "string") {
    return source["path"];
  }
  if (source.kind === "s3-repository") {
    const eventReceiver = source["eventReceiver"];
    if (
      isJsonObject(eventReceiver) &&
      typeof eventReceiver["path"] === "string"
    ) {
      return eventReceiver["path"];
    }
    return defaultEventSourceHttpPath(source);
  }
  return undefined;
}

export function buildWebhookVerificationSource(
  source: EventSourceConfig,
): WebhookSourceConfig | undefined {
  if (source.kind === "webhook") {
    return source as WebhookSourceConfig;
  }
  if (source.kind !== "s3-repository") {
    return undefined;
  }
  const eventReceiver = source["eventReceiver"];
  if (!isJsonObject(eventReceiver)) {
    return undefined;
  }
  return {
    id: source.id,
    kind: "webhook",
    path:
      resolveEventSourceHttpPath(source) ?? defaultEventSourceHttpPath(source),
    ...(typeof eventReceiver["signingSecretEnv"] === "string"
      ? { signingSecretEnv: eventReceiver["signingSecretEnv"] }
      : {}),
  };
}
