const MAX_ATTRIBUTE_STRING_LENGTH = 4096;
const SECRET_KEY_PATTERN =
  /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|credential|private[_-]?key|session[_-]?token)/i;
const SECRET_VALUE_PATTERN =
  /(Bearer\s+)[A-Za-z0-9._~+/=-]+|((?:sk|rk|pk|ghp|github_pat)_[A-Za-z0-9_=-]{8,})/gi;

export type TelemetryAttributeValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | boolean[];

export type TelemetryAttributes = Readonly<Record<string, unknown>>;

function truncate(value: string): string {
  if (value.length <= MAX_ATTRIBUTE_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_ATTRIBUTE_STRING_LENGTH)}...[truncated]`;
}

function redactString(value: string): string {
  return truncate(
    value.replace(SECRET_VALUE_PATTERN, (_match, bearerPrefix: string) =>
      bearerPrefix === undefined ? "[redacted]" : `${bearerPrefix}[redacted]`,
    ),
  );
}

function sanitizeAttributeValue(
  key: string,
  value: unknown,
): TelemetryAttributeValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (SECRET_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value === "string" ? redactString(value) : value;
  }
  if (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean",
    )
  ) {
    return value.map((entry) =>
      typeof entry === "string" ? redactString(entry) : entry,
    ) as string[] | number[] | boolean[];
  }
  return redactString(JSON.stringify(value));
}

export function sanitizeTelemetryAttributes(
  attributes: TelemetryAttributes,
): Record<string, TelemetryAttributeValue> {
  const sanitized: Record<string, TelemetryAttributeValue> = {};
  Object.entries(attributes).forEach(([key, value]) => {
    const safe = sanitizeAttributeValue(key, value);
    if (safe !== undefined) {
      sanitized[key] = safe;
    }
  });
  return sanitized;
}

export function messagePayloadTelemetryAttributes(input: {
  readonly key: string;
  readonly value: unknown;
  readonly exportMessages: boolean;
}): Record<string, TelemetryAttributeValue> {
  const serialized =
    typeof input.value === "string" ? input.value : JSON.stringify(input.value);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  const result: Record<string, TelemetryAttributeValue> = {
    [`${input.key}.bytes`]: bytes,
  };
  if (input.exportMessages) {
    result[input.key] = redactString(serialized);
  }
  return result;
}
