import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isReservedWorkflowDefinitionPath,
  isSafeWorkflowRelativePath,
  resolveWorkflowRelativePath,
} from "../prompt-template-file";
import type { WorkflowSelfImprovePatchResult } from "./types";

export interface WorkflowSelfImprovePatchOperation {
  readonly relativePath: string;
  readonly content: string;
}

function resolveCanonicalWorkflowPatchPath(
  root: string,
  relativePath: string,
): string {
  if (!isSafeWorkflowRelativePath(relativePath)) {
    throw new Error(
      `self-improve patch path '${relativePath}' must be a workflow-relative path without '.' or '..' segments`,
    );
  }
  const isCanonicalWorkflowPatchTarget =
    relativePath === "workflow.json" ||
    /^nodes[/\\]node-[^/\\]+\.json$/u.test(relativePath);
  if (!isCanonicalWorkflowPatchTarget) {
    const resolved = resolveWorkflowRelativePath(root, relativePath, {
      fieldName: "self-improve patch path",
    });
    if (!resolved.ok) {
      throw new Error(resolved.error.message);
    }
    return resolved.value;
  }
  if (!isReservedWorkflowDefinitionPath(relativePath)) {
    throw new Error(
      `self-improve patch path '${relativePath}' is not a canonical workflow definition file`,
    );
  }
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `self-improve patch path escapes workflow directory: ${relativePath}`,
    );
  }
  return target;
}

async function restoreWorkflowDirectoryFromBackup(input: {
  readonly workflowDirectory: string;
  readonly backupPath: string;
}): Promise<void> {
  await mkdir(input.workflowDirectory, { recursive: true });
  const entries = await readdir(input.workflowDirectory, {
    withFileTypes: true,
  });
  await Promise.all(
    entries
      .filter((entry) => entry.name !== ".git")
      .map((entry) =>
        rm(path.join(input.workflowDirectory, entry.name), {
          recursive: true,
          force: true,
        }),
      ),
  );
  await cp(input.backupPath, input.workflowDirectory, {
    recursive: true,
    force: true,
  });
}

export async function applyWorkflowSelfImprovePatch(input: {
  readonly workflowDirectory: string;
  readonly backupPath: string;
  readonly operations?: readonly WorkflowSelfImprovePatchOperation[];
  readonly validate: () => Promise<boolean>;
}): Promise<WorkflowSelfImprovePatchResult> {
  if (input.operations === undefined || input.operations.length === 0) {
    return {
      status: "not-attempted",
      changedFiles: [],
      validationStatus: "not-run",
      message: "No safe deterministic workflow patch was produced.",
    };
  }

  const changedFiles: string[] = [];
  try {
    for (const operation of input.operations) {
      const target = resolveCanonicalWorkflowPatchPath(
        input.workflowDirectory,
        operation.relativePath,
      );
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, operation.content, "utf8");
      changedFiles.push(operation.relativePath);
    }
    if (await input.validate()) {
      return { status: "applied", changedFiles, validationStatus: "passed" };
    }
    await restoreWorkflowDirectoryFromBackup(input);
    return {
      status: "patch-reverted",
      changedFiles,
      validationStatus: "failed",
    };
  } catch (error: unknown) {
    if (changedFiles.length > 0) {
      try {
        await restoreWorkflowDirectoryFromBackup(input);
        return {
          status: "patch-reverted",
          changedFiles,
          validationStatus: "failed",
          message:
            error instanceof Error ? error.message : "unknown patch failure",
        };
      } catch (restoreError: unknown) {
        const patchMessage =
          error instanceof Error ? error.message : "unknown patch failure";
        const restoreMessage =
          restoreError instanceof Error
            ? restoreError.message
            : "unknown restore failure";
        return {
          status: "failed",
          changedFiles,
          validationStatus: "failed",
          message: `${patchMessage}; restore failed: ${restoreMessage}`,
        };
      }
    }
    return {
      status: "failed",
      changedFiles,
      validationStatus: "failed",
      message: error instanceof Error ? error.message : "unknown patch failure",
    };
  }
}
