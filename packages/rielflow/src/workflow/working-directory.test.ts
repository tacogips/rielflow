import { describe, expect, test } from "vitest";
import {
  normalizeWorkingDirectoryPath,
  normalizeWorkflowWorkingDirectoryOverride,
  resolveNodeExecutionWorkingDirectory,
  resolveWorkflowExecutionWorkingDirectory,
} from "./working-directory";

describe("working-directory", () => {
  test("defaults workflow execution working directory to command cwd", () => {
    expect(
      resolveWorkflowExecutionWorkingDirectory({
        cwd: "/tmp/project",
      }),
    ).toBe("/tmp/project");
  });

  test("resolves relative workflow working directory from command cwd", () => {
    expect(
      resolveWorkflowExecutionWorkingDirectory({
        cwd: "/tmp/project",
        workflowWorkingDirectory: "apps/reviewer",
      }),
    ).toBe("/tmp/project/apps/reviewer");
  });

  test("keeps absolute workflow working directory", () => {
    expect(
      resolveWorkflowExecutionWorkingDirectory({
        cwd: "/tmp/project",
        workflowWorkingDirectory: "/var/tmp/worktree",
      }),
    ).toBe("/var/tmp/worktree");
  });

  test("resolves relative node working directory from workflow working directory", () => {
    expect(
      resolveNodeExecutionWorkingDirectory(
        "/tmp/project/apps/reviewer",
        "packages/worker",
      ),
    ).toBe("/tmp/project/apps/reviewer/packages/worker");
  });

  test("keeps absolute node working directory", () => {
    expect(
      resolveNodeExecutionWorkingDirectory(
        "/tmp/project/apps/reviewer",
        "/var/tmp/worker",
      ),
    ).toBe("/var/tmp/worker");
  });

  test("trims node working directory before resolution", () => {
    expect(
      resolveNodeExecutionWorkingDirectory(
        "/tmp/project/apps/reviewer",
        " packages/worker ",
      ),
    ).toBe("/tmp/project/apps/reviewer/packages/worker");
  });

  test("trims workflow execution working directory overrides", () => {
    expect(normalizeWorkflowWorkingDirectoryOverride(" apps/reviewer ")).toBe(
      "apps/reviewer",
    );
  });

  test("trims shared working directory values", () => {
    expect(normalizeWorkingDirectoryPath(" apps/reviewer ")).toBe(
      "apps/reviewer",
    );
  });

  test("rejects whitespace-only workflow execution working directory overrides", () => {
    expect(() => normalizeWorkflowWorkingDirectoryOverride("   ")).toThrow(
      "workingDirectory must be a non-empty path when provided",
    );
  });

  test("rejects whitespace-only node working directories", () => {
    expect(() =>
      resolveNodeExecutionWorkingDirectory("/tmp/project", "   "),
    ).toThrow("workingDirectory must be a non-empty path when provided");
  });
});
