import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { backupWorkflowDirectory } from "./backup";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-self-improve-backup-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("backupWorkflowDirectory", () => {
  test("copies workflow files under the backup path and excludes .git metadata", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "workflow");
    const backupPath = path.join(root, "self-improve", "exec", "backup");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });
    await mkdir(path.join(workflowDirectory, ".git"), { recursive: true });
    await writeFile(path.join(workflowDirectory, "workflow.json"), "{}\n");
    await writeFile(
      path.join(workflowDirectory, "nodes", "node-a.json"),
      "{}\n",
    );
    await writeFile(path.join(workflowDirectory, ".git", "config"), "git\n");

    const result = await backupWorkflowDirectory({
      workflowDirectory,
      backupPath,
    });

    expect(result).toEqual({ backupPath, copiedFileCount: 2 });
    await expect(
      readFile(path.join(backupPath, "workflow.json"), "utf8"),
    ).resolves.toBe("{}\n");
    await expect(readdir(path.join(backupPath, ".git"))).rejects.toThrow();
  });
});
