import { rm } from "node:fs/promises";

export function isErrnoException(
  error: unknown,
): error is { readonly code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  );
}

export async function cleanupMaterializedAttachmentFiles(
  createdAttachmentPaths: readonly string[],
): Promise<void> {
  for (const filePath of [...createdAttachmentPaths].reverse()) {
    await rm(filePath, { force: true });
  }
}
