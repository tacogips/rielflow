import path from "node:path";

const NON_EMPTY_WORKING_DIRECTORY_ERROR =
  "workingDirectory must be a non-empty path when provided";

export function normalizeWorkingDirectoryPath(
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalizedValue = value.trim();
  if (normalizedValue.length === 0) {
    throw new Error(NON_EMPTY_WORKING_DIRECTORY_ERROR);
  }

  return normalizedValue;
}

export function normalizeWorkflowWorkingDirectoryOverride(
  value: string | undefined,
): string | undefined {
  return normalizeWorkingDirectoryPath(value);
}

export function resolveWorkflowExecutionWorkingDirectory(input: {
  readonly cwd?: string;
  readonly workflowWorkingDirectory?: string;
}): string {
  const commandExecutionDirectory = path.resolve(input.cwd ?? process.cwd());
  const workflowWorkingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    input.workflowWorkingDirectory,
  );
  if (workflowWorkingDirectory === undefined) {
    return commandExecutionDirectory;
  }
  return path.isAbsolute(workflowWorkingDirectory)
    ? path.resolve(workflowWorkingDirectory)
    : path.resolve(commandExecutionDirectory, workflowWorkingDirectory);
}

export function resolveNodeExecutionWorkingDirectory(
  workflowWorkingDirectory: string,
  nodeWorkingDirectory: string | undefined,
): string {
  const normalizedNodeWorkingDirectory =
    normalizeWorkingDirectoryPath(nodeWorkingDirectory);
  if (normalizedNodeWorkingDirectory === undefined) {
    return workflowWorkingDirectory;
  }
  return path.isAbsolute(normalizedNodeWorkingDirectory)
    ? path.resolve(normalizedNodeWorkingDirectory)
    : path.resolve(workflowWorkingDirectory, normalizedNodeWorkingDirectory);
}
