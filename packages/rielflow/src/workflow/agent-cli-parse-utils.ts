export function compactAgentCliMessage(
  message: string | undefined,
  fallback: string,
): string {
  const raw = message ?? fallback;
  return raw.replace(/\s+/g, " ").trim().slice(0, 500);
}

export function firstNonEmptyLine(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.split(/\r?\n/u)[0] ?? null;
}
