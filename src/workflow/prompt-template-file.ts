import path from "node:path";
import { err, ok, type Result } from "./result";

export interface WorkflowRelativePathFailure {
  readonly message: string;
}

function splitWorkflowRelativePath(relativePath: string): readonly string[] {
  return relativePath
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0);
}

export function isSafeWorkflowRelativePath(relativePath: string): boolean {
  if (
    relativePath.length === 0 ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    return false;
  }

  const segments = splitWorkflowRelativePath(relativePath);
  if (segments.length === 0) {
    return false;
  }

  return !segments.some((segment) => segment === "." || segment === "..");
}

export function isReservedWorkflowDefinitionPath(relativePath: string): boolean {
  const segments = splitWorkflowRelativePath(relativePath);
  if (segments.length !== 1) {
    return false;
  }

  const fileName = segments[0];
  if (fileName === undefined) {
    return false;
  }
  return (
    fileName === "workflow.json" ||
    fileName === "workflow-vis.json" ||
    /^node-.+\.json$/u.test(fileName)
  );
}

export function resolveWorkflowRelativePath(
  workflowDirectory: string,
  relativePath: string,
): Result<string, WorkflowRelativePathFailure> {
  if (!isSafeWorkflowRelativePath(relativePath)) {
    return err({
      message:
        `promptTemplateFile '${relativePath}' must be a workflow-relative path without '.' or '..' segments`,
    });
  }
  if (isReservedWorkflowDefinitionPath(relativePath)) {
    return err({
      message:
        `promptTemplateFile '${relativePath}' must not overwrite canonical workflow definition files`,
    });
  }

  const resolved = path.resolve(workflowDirectory, relativePath);
  const relative = path.relative(workflowDirectory, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return err({
      message:
        `promptTemplateFile '${relativePath}' must stay within workflow directory '${workflowDirectory}'`,
    });
  }

  return ok(resolved);
}
