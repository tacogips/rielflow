import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { backupWorkflowDirectory } from "./backup";
import { applyWorkflowSelfImprovePatch } from "./patcher";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-self-improve-patcher-"),
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

async function createWorkflowFixture(root: string): Promise<{
  readonly workflowDirectory: string;
  readonly backupPath: string;
}> {
  const workflowDirectory = path.join(root, "workflow");
  await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });
  await writeFile(
    path.join(workflowDirectory, "workflow.json"),
    '{"workflowId":"demo"}\n',
    "utf8",
  );
  await writeFile(
    path.join(workflowDirectory, "nodes/node-manager.json"),
    '{"promptTemplate":"short"}\n',
    "utf8",
  );
  const backupPath = path.join(root, "backup");
  await backupWorkflowDirectory({ workflowDirectory, backupPath });
  return { workflowDirectory, backupPath };
}

describe("applyWorkflowSelfImprovePatch", () => {
  test("restores backup when validation fails after patch writes", async () => {
    const root = await makeTempDir();
    const { workflowDirectory, backupPath } = await createWorkflowFixture(root);

    const result = await applyWorkflowSelfImprovePatch({
      workflowDirectory,
      backupPath,
      operations: [
        {
          relativePath: "nodes/node-manager.json",
          content: '{"promptTemplate":"expanded prompt"}\n',
        },
        {
          relativePath: "generated/new-node.json",
          content: '{"promptTemplate":"new prompt"}\n',
        },
      ],
      validate: async () => false,
    });

    expect(result).toMatchObject({
      status: "patch-reverted",
      changedFiles: ["nodes/node-manager.json", "generated/new-node.json"],
      validationStatus: "failed",
    });
    await expect(
      readFile(path.join(workflowDirectory, "nodes/node-manager.json"), "utf8"),
    ).resolves.toContain("short");
    await expect(
      readFile(path.join(workflowDirectory, "generated/new-node.json"), "utf8"),
    ).rejects.toThrow();
  });

  test("preserves repository metadata while restoring backup", async () => {
    const root = await makeTempDir();
    const { workflowDirectory, backupPath } = await createWorkflowFixture(root);
    await mkdir(path.join(workflowDirectory, ".git"), { recursive: true });
    await writeFile(
      path.join(workflowDirectory, ".git", "config"),
      "[core]\n\trepositoryformatversion = 0\n",
      "utf8",
    );

    const result = await applyWorkflowSelfImprovePatch({
      workflowDirectory,
      backupPath,
      operations: [
        {
          relativePath: "nodes/node-manager.json",
          content: '{"promptTemplate":"expanded prompt"}\n',
        },
      ],
      validate: async () => false,
    });

    expect(result.status).toBe("patch-reverted");
    await expect(
      readFile(path.join(workflowDirectory, ".git", "config"), "utf8"),
    ).resolves.toContain("repositoryformatversion");
    await expect(stat(path.join(backupPath, ".git"))).rejects.toThrow();
  });

  test("restores backup when a post-write patch failure is thrown", async () => {
    const root = await makeTempDir();
    const { workflowDirectory, backupPath } = await createWorkflowFixture(root);

    const result = await applyWorkflowSelfImprovePatch({
      workflowDirectory,
      backupPath,
      operations: [
        {
          relativePath: "nodes/node-manager.json",
          content: '{"promptTemplate":"expanded prompt"}\n',
        },
      ],
      validate: async () => {
        throw new Error("validation crashed");
      },
    });

    expect(result).toMatchObject({
      status: "patch-reverted",
      changedFiles: ["nodes/node-manager.json"],
      validationStatus: "failed",
      message: "validation crashed",
    });
    await expect(
      readFile(path.join(workflowDirectory, "nodes/node-manager.json"), "utf8"),
    ).resolves.toContain("short");
  });

  test("rejects escaped, absolute, and reserved prompt-file patch paths before writes", async () => {
    const root = await makeTempDir();
    const { workflowDirectory, backupPath } = await createWorkflowFixture(root);

    await expect(
      applyWorkflowSelfImprovePatch({
        workflowDirectory,
        backupPath,
        operations: [{ relativePath: "../escape.md", content: "bad\n" }],
        validate: async () => true,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      changedFiles: [],
      validationStatus: "failed",
    });

    await expect(
      applyWorkflowSelfImprovePatch({
        workflowDirectory,
        backupPath,
        operations: [
          {
            relativePath: path.resolve(root, "absolute.md"),
            content: "bad\n",
          },
        ],
        validate: async () => true,
      }),
    ).resolves.toMatchObject({ status: "failed", changedFiles: [] });

    await expect(
      applyWorkflowSelfImprovePatch({
        workflowDirectory,
        backupPath,
        operations: [
          {
            relativePath: "generated/node-sidecar.json",
            content: "{}\n",
          },
        ],
        validate: async () => true,
      }),
    ).resolves.toMatchObject({
      status: "failed",
      changedFiles: [],
      message:
        "self-improve patch path 'generated/node-sidecar.json' must not overwrite canonical workflow definition files",
    });
  });
});
