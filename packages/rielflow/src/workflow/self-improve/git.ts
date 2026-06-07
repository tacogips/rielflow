import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorkflowSelfImproveGitCommitResult } from "./types";

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const captureDir = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-self-improve-git-"),
  );
  const captureId = randomUUID();
  const stdoutPath = path.join(captureDir, `${captureId}-stdout.log`);
  const stderrPath = path.join(captureDir, `${captureId}-stderr.log`);
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(
      "sh",
      [
        "-c",
        'exec "$@" >"$RIEL_GIT_STDOUT" 2>"$RIEL_GIT_STDERR"',
        "rielflow-git",
        "git",
        "-C",
        cwd,
        ...args,
      ],
      {
        stdio: ["ignore", "ignore", "ignore"],
        env: {
          ...process.env,
          RIEL_GIT_STDOUT: stdoutPath,
          RIEL_GIT_STDERR: stderrPath,
        },
      },
    );

    child.on("error", (error: unknown) => {
      void rm(captureDir, { recursive: true, force: true });
      reject(error);
    });
    child.on("close", (exitCode) => {
      void (async () => {
        const [stdout, stderr] = await Promise.all([
          readFile(stdoutPath, "utf8").catch(() => ""),
          readFile(stderrPath, "utf8").catch(() => ""),
        ]);
        await rm(captureDir, { recursive: true, force: true }).catch(() => {});
        if (exitCode === 0) {
          resolve(stdout.trim());
          return;
        }
        reject(
          new Error(
            `git ${args.join(" ")} failed with ${String(exitCode)}: ${stderr.trim()}`,
          ),
        );
      })();
    });
  });
}

async function pathIsDirectory(filePath: string): Promise<boolean> {
  try {
    return (await lstat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

async function normalizeChangedFiles(input: {
  readonly repoRoot: string;
  readonly workflowDirectory: string;
  readonly changedFiles: readonly string[];
}): Promise<readonly string[]> {
  const normalized: string[] = [];
  for (const file of input.changedFiles) {
    if (
      file.length === 0 ||
      path.posix.isAbsolute(file) ||
      path.win32.isAbsolute(file)
    ) {
      throw new Error(
        `self-improve changed file '${file}' must be a non-empty relative file path`,
      );
    }
    const target = path.resolve(input.workflowDirectory, file);
    const workflowRelative = path.relative(input.workflowDirectory, target);
    if (
      workflowRelative.length === 0 ||
      workflowRelative.startsWith("..") ||
      path.isAbsolute(workflowRelative)
    ) {
      throw new Error(
        `self-improve changed file '${file}' escapes workflow directory`,
      );
    }
    if (await pathIsDirectory(target)) {
      throw new Error(
        `self-improve changed file '${file}' must not be a directory`,
      );
    }
    const repoRelative = path.relative(input.repoRoot, target);
    if (
      repoRelative.length === 0 ||
      repoRelative.startsWith("..") ||
      path.isAbsolute(repoRelative)
    ) {
      throw new Error(
        `self-improve changed file '${file}' escapes git repository`,
      );
    }
    normalized.push(repoRelative.split(path.sep).join("/"));
  }
  return [...new Set(normalized)];
}

async function listStagedFiles(repoRoot: string): Promise<readonly string[]> {
  const output = await git(repoRoot, ["diff", "--cached", "--name-only", "--"]);
  return output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function assertNoUnexpectedStagedFiles(input: {
  readonly stagedFiles: readonly string[];
  readonly allowedFiles: ReadonlySet<string>;
}): void {
  const unexpected = input.stagedFiles.filter(
    (file) => !input.allowedFiles.has(file),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `self-improve refused to commit pre-staged files outside changedFiles: ${unexpected.join(", ")}`,
    );
  }
}

export async function commitWorkflowSelfImproveChanges(input: {
  readonly workflowDirectory: string;
  readonly workflowName: string;
  readonly selfImproveId: string;
  readonly changedFiles: readonly string[];
}): Promise<WorkflowSelfImproveGitCommitResult> {
  if (input.changedFiles.length === 0) {
    return { status: "not-git-managed" };
  }
  try {
    const repoRootRaw = await git(input.workflowDirectory, [
      "rev-parse",
      "--show-toplevel",
    ]);
    if (repoRootRaw.length === 0) {
      return { status: "not-git-managed" };
    }
    const repoRoot = await realpath(repoRootRaw);
    const workflowDirectory = await realpath(input.workflowDirectory);
    const relativeFiles = await normalizeChangedFiles({
      repoRoot,
      workflowDirectory,
      changedFiles: input.changedFiles,
    });
    const allowedFiles = new Set(relativeFiles);
    assertNoUnexpectedStagedFiles({
      stagedFiles: await listStagedFiles(repoRoot),
      allowedFiles,
    });
    await git(repoRoot, ["add", "--", ...relativeFiles]);
    const stagedFiles = await listStagedFiles(repoRoot);
    assertNoUnexpectedStagedFiles({ stagedFiles, allowedFiles });
    if (stagedFiles.length === 0) {
      return {
        status: "failed",
        message: "self-improve has no staged changes to commit",
      };
    }
    const message = `chore: self-improve workflow ${input.workflowName}\n\nSelf-improve id: ${input.selfImproveId}`;
    await git(repoRoot, ["commit", "-m", message]);
    const commitHash = await git(repoRoot, ["rev-parse", "HEAD"]);
    return { status: "committed", commitHash, message };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "git commit failed";
    return message.includes("not a git repository")
      ? { status: "not-git-managed" }
      : { status: "failed", message };
  }
}
