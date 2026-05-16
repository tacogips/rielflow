import {
  HookEventName,
  type HookInputPayload,
  KNOWN_HOOK_EVENT_NAMES,
} from "./types";

export class HookParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HookParseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyStringField(
  rawJson: Record<string, unknown>,
  fieldName: "session_id" | "hook_event_name" | "cwd",
): string {
  const value = rawJson[fieldName];
  if (typeof value !== "string" || value.length === 0) {
    throw new HookParseError(
      `hook payload field '${fieldName}' must be a non-empty string`,
    );
  }
  return value;
}

function validateOptionalNullableStringField(
  rawJson: Record<string, unknown>,
  fieldName: "transcript_path",
): void {
  const value = rawJson[fieldName];
  if (value === undefined || typeof value === "string" || value === null) {
    return;
  }
  throw new HookParseError(
    `hook payload field '${fieldName}' must be a string, null, or omitted`,
  );
}

function validateOptionalStringField(
  rawJson: Record<string, unknown>,
  fieldName: "model",
): void {
  const value = rawJson[fieldName];
  if (value === undefined || typeof value === "string") {
    return;
  }
  throw new HookParseError(
    `hook payload field '${fieldName}' must be a string when present`,
  );
}

function assertHookInputPayload(
  rawJson: Record<string, unknown>,
): asserts rawJson is HookInputPayload {
  requireNonEmptyStringField(rawJson, "session_id");
  requireNonEmptyStringField(rawJson, "hook_event_name");
  requireNonEmptyStringField(rawJson, "cwd");
  validateOptionalNullableStringField(rawJson, "transcript_path");
  validateOptionalStringField(rawJson, "model");
}

function normalizeHookEventName(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

const NORMALIZED_EVENT_NAMES = new Map<string, HookEventName>(
  KNOWN_HOOK_EVENT_NAMES.map((eventName) => [
    normalizeHookEventName(eventName),
    eventName,
  ]),
);

export function resolveHookEventName(value: string): HookEventName {
  return (
    NORMALIZED_EVENT_NAMES.get(normalizeHookEventName(value)) ??
    HookEventName.Unknown
  );
}

export function parseHookPayload(rawStdin: string): {
  readonly payload: HookInputPayload;
  readonly eventName: HookEventName;
  readonly rawEventName: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawStdin);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "unknown JSON parse error";
    throw new HookParseError(`invalid hook JSON: ${message}`);
  }

  if (!isRecord(parsed)) {
    throw new HookParseError("hook payload must be a JSON object");
  }

  assertHookInputPayload(parsed);
  const rawEventName = parsed.hook_event_name;

  return {
    payload: parsed,
    eventName: resolveHookEventName(rawEventName),
    rawEventName,
  };
}
