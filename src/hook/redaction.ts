const REDACTED = "[REDACTED]";
const MAX_REDACTION_DEPTH = 20;

const SENSITIVE_KEY_PATTERN =
  /(?:authorization|api[_-]?key|secret|token|password|credential|private[_-]?key|session[_-]?token|access[_-]?token|refresh[_-]?token|stdout|stderr|output|command[_-]?output)/i;

function shouldRedactKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_REDACTION_DEPTH) {
    return "[REDACTED: depth limit]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, depth + 1));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = shouldRedactKey(key)
      ? REDACTED
      : redactValue(entry, depth + 1);
  }
  return redacted;
}

export function redactHookPayload(payload: unknown): unknown {
  return redactValue(payload, 0);
}
