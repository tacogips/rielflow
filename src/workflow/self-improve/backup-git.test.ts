import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { commitWorkflowSelfImproveChanges } from "./git";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-self-improve-git-"),
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

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
  return stdout.trim();
}

describe("commitWorkflowSelfImproveChanges", () => {
  test("commits only self-improve changed files without assistant attribution", async () => {
    const repoRoot = await makeTempDir();
    const workflowDirectory = path.join(repoRoot, "workflows/demo");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });
    await git(repoRoot, ["init"]);
    await git(repoRoot, ["config", "user.email", "test@example.invalid"]);
    await git(repoRoot, ["config", "user.name", "Test User"]);
    await writeFile(
      path.join(workflowDirectory, "nodes/node-manager.json"),
      '{"promptTemplate":"old"}\n',
      "utf8",
    );
    await writeFile(path.join(repoRoot, "unrelated.txt"), "old\n", "utf8");
    await git(repoRoot, ["add", "."]);
    await git(repoRoot, ["commit", "-m", "test: initial"]);
    await writeFile(
      path.join(workflowDirectory, "nodes/node-manager.json"),
      '{"promptTemplate":"new"}\n',
      "utf8",
    );
    await writeFile(path.join(repoRoot, "unrelated.txt"), "new\n", "utf8");

    const result = await commitWorkflowSelfImproveChanges({
      workflowDirectory,
      workflowName: "demo",
      selfImproveId: "sim-test",
      changedFiles: ["nodes/node-manager.json"],
    });

    expect(result.status).toBe("committed");
    expect(result.commitHash).toMatch(/^[0-9a-f]{40}$/);
    const committedFiles = await git(repoRoot, [
      "show",
      "--name-only",
      "--format=",
      "HEAD",
    ]);
    expect(committedFiles.split("\n").filter(Boolean)).toEqual([
      "workflows/demo/nodes/node-manager.json",
    ]);
    const message = await git(repoRoot, ["log", "-1", "--format=%B"]);
    expect(message).toContain("Self-improve id: sim-test");
    expect(message).not.toContain("Co-Authored-By");
    expect(message).not.toContain("Generated");
    expect(await readFile(path.join(repoRoot, "unrelated.txt"), "utf8")).toBe(
      "new\n",
    );
    expect(await git(repoRoot, ["status", "--short"])).toBe("M unrelated.txt");
  });

  test("rejects escaped, absolute, and directory changed files", async () => {
    const repoRoot = await makeTempDir();
    const workflowDirectory = path.join(repoRoot, "workflows/demo");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });
    await git(repoRoot, ["init"]);

    await expect(
      commitWorkflowSelfImproveChanges({
        workflowDirectory,
        workflowName: "demo",
        selfImproveId: "sim-test",
        changedFiles: ["../escape.json"],
      }),
    ).resolves.toMatchObject({
      status: "failed",
      message:
        "self-improve changed file '../escape.json' escapes workflow directory",
    });

    await expect(
      commitWorkflowSelfImproveChanges({
        workflowDirectory,
        workflowName: "demo",
        selfImproveId: "sim-test",
        changedFiles: [path.join(workflowDirectory, "nodes/node-manager.json")],
      }),
    ).resolves.toMatchObject({
      status: "failed",
      message: expect.stringContaining(
        "must be a non-empty relative file path",
      ),
    });

    await expect(
      commitWorkflowSelfImproveChanges({
        workflowDirectory,
        workflowName: "demo",
        selfImproveId: "sim-test",
        changedFiles: ["nodes"],
      }),
    ).resolves.toMatchObject({
      status: "failed",
      message: "self-improve changed file 'nodes' must not be a directory",
    });
  });

  test("rejects unexpected pre-staged files and skips empty commits", async () => {
    const repoRoot = await makeTempDir();
    const workflowDirectory = path.join(repoRoot, "workflows/demo");
    await mkdir(path.join(workflowDirectory, "nodes"), { recursive: true });
    await git(repoRoot, ["init"]);
    await git(repoRoot, ["config", "user.email", "test@example.invalid"]);
    await git(repoRoot, ["config", "user.name", "Test User"]);
    await writeFile(
      path.join(workflowDirectory, "nodes/node-manager.json"),
      "{}\n",
      "utf8",
    );
    await writeFile(path.join(repoRoot, "other.txt"), "old\n", "utf8");
    await git(repoRoot, ["add", "."]);
    await git(repoRoot, ["commit", "-m", "test: initial"]);
    await writeFile(path.join(repoRoot, "other.txt"), "new\n", "utf8");
    await git(repoRoot, ["add", "other.txt"]);

    await expect(
      commitWorkflowSelfImproveChanges({
        workflowDirectory,
        workflowName: "demo",
        selfImproveId: "sim-test",
        changedFiles: ["nodes/node-manager.json"],
      }),
    ).resolves.toMatchObject({
      status: "failed",
      message:
        "self-improve refused to commit pre-staged files outside changedFiles: other.txt",
    });

    await git(repoRoot, ["reset", "other.txt"]);
    await expect(
      commitWorkflowSelfImproveChanges({
        workflowDirectory,
        workflowName: "demo",
        selfImproveId: "sim-test",
        changedFiles: ["nodes/node-manager.json"],
      }),
    ).resolves.toMatchObject({
      status: "failed",
      message: "self-improve has no staged changes to commit",
    });
    expect(await git(repoRoot, ["rev-list", "--count", "HEAD"])).toBe("1");
  });
});
