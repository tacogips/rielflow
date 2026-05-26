import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import type { WorkflowSelfImproveBackupResult } from "./types";

async function countFiles(directory: string): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }
    const child = path.join(directory, entry.name);
    count += entry.isDirectory() ? await countFiles(child) : 1;
  }
  return count;
}

export async function backupWorkflowDirectory(input: {
  readonly workflowDirectory: string;
  readonly backupPath: string;
}): Promise<WorkflowSelfImproveBackupResult> {
  await mkdir(path.dirname(input.backupPath), { recursive: true });
  await cp(input.workflowDirectory, input.backupPath, {
    recursive: true,
    force: true,
    filter(source) {
      return path.basename(source) !== ".git";
    },
  });
  return {
    backupPath: input.backupPath,
    copiedFileCount: await countFiles(input.backupPath),
  };
}
