export function compactAgentCliMessage(
  message: string | undefined,
  fallback: string,
): string {
  const raw = message ?? fallback;
  return raw.replace(/\s+/g, " ").trim().slice(0, 500);
}
