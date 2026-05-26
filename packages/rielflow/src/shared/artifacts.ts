import { createHash } from "node:crypto";

export function safeArtifactPathSegment(
  value: string,
  fallback: string,
): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96) || fallback;
}

export function hashJsonSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
