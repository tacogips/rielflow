import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

async function cleanupTempFile(tempPath: string): Promise<void> {
  try {
    await unlink(tempPath);
  } catch {
    // Best-effort cleanup after a failed write or rename.
  }
}

function buildAtomicTempPath(filePath: string): string {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
}

export async function atomicWriteTextFile(
  filePath: string,
  content: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = buildAtomicTempPath(filePath);
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  } catch (error: unknown) {
    await cleanupTempFile(tempPath);
    throw error;
  }
}

export async function atomicWriteJsonFile(
  filePath: string,
  payload: unknown,
): Promise<void> {
  await atomicWriteTextFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}
