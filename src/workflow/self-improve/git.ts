import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { WorkflowSelfImproveGitCommitResult } from "./types";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", cwd, ...args], {
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
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
    const relativeFiles = input.changedFiles.map((file) =>
      path.relative(repoRoot, path.resolve(workflowDirectory, file)),
    );
    await git(repoRoot, ["add", "--", ...relativeFiles]);
    const message = `chore: self-improve workflow ${input.workflowName}\n\nSelf-improve id: ${input.selfImproveId}`;
    await git(repoRoot, ["commit", "-m", message, "--", ...relativeFiles]);
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
