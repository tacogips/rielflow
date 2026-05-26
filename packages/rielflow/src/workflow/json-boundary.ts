function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizePlainTextValue(
  value: unknown,
): Readonly<Record<string, unknown>> | unknown {
  if (typeof value === "string") {
    return { text: value };
  }
  return value;
}

export function normalizeExternalMailboxBusinessPayload(
  value: unknown,
): Readonly<Record<string, unknown>> {
  const normalized = normalizePlainTextValue(value);
  if (isRecord(normalized)) {
    return normalized;
  }
  return { value: normalized };
}

export function normalizeManagerMessageForMailbox(value: unknown): unknown {
  if (typeof value === "string") {
    return { payload: { text: value } };
  }
  if (!isRecord(value) || !Object.hasOwn(value, "payload")) {
    return value;
  }

  return {
    ...value,
    payload: normalizePlainTextValue(value["payload"]),
  };
}

export function normalizeTextBusinessPayload(
  text: string,
): Readonly<Record<string, unknown>> {
  return { text };
}
