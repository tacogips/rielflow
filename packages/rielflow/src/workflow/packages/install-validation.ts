import { cp, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyWorkflowRootEntries(input: {
  readonly sourceWorkflowRoot: string;
  readonly validationWorkflowRoot: string;
}): Promise<void> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(input.sourceWorkflowRoot, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sourceDirectory = path.join(input.sourceWorkflowRoot, entry.name);
    if (!(await pathExists(path.join(sourceDirectory, "workflow.json")))) {
      continue;
    }
    const targetDirectory = path.join(input.validationWorkflowRoot, entry.name);
    if (await pathExists(targetDirectory)) {
      continue;
    }
    await cp(sourceDirectory, targetDirectory, {
      recursive: true,
      errorOnExist: false,
      force: false,
    });
  }
}

export async function createPackageValidationWorkflowRoot(input: {
  readonly sourceDirectory: string;
  readonly sourceWorkflowRoot: string;
  readonly destinationWorkflowRoot: string;
  readonly userRoot: string;
  readonly includeUserScope: boolean;
}): Promise<{
  readonly workflowRoot: string;
  readonly searchedRoots: readonly string[];
}> {
  const validationWorkflowRoot = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-package-validation-workflows-"),
  );
  await copyWorkflowRootEntries({
    sourceWorkflowRoot: input.sourceWorkflowRoot,
    validationWorkflowRoot,
  });
  await copyWorkflowRootEntries({
    sourceWorkflowRoot: input.destinationWorkflowRoot,
    validationWorkflowRoot,
  });
  const searchedRoots = [
    input.sourceWorkflowRoot,
    input.destinationWorkflowRoot,
  ];
  if (input.includeUserScope) {
    const userWorkflowRoot = path.join(input.userRoot, "workflows");
    await copyWorkflowRootEntries({
      sourceWorkflowRoot: userWorkflowRoot,
      validationWorkflowRoot,
    });
    searchedRoots.push(userWorkflowRoot);
  }
  await rm(
    path.join(validationWorkflowRoot, path.basename(input.sourceDirectory)),
    {
      recursive: true,
      force: true,
    },
  );
  await cp(
    input.sourceDirectory,
    path.join(validationWorkflowRoot, path.basename(input.sourceDirectory)),
    {
      recursive: true,
      force: true,
    },
  );
  return { workflowRoot: validationWorkflowRoot, searchedRoots };
}

export function describePackageValidationFailure(input: {
  readonly message: string;
  readonly issues?: readonly {
    readonly path: string;
    readonly message: string;
  }[];
  readonly searchedRoots: readonly string[];
}): string {
  const issueDetails =
    input.issues === undefined || input.issues.length === 0
      ? ""
      : `: ${input.issues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join("; ")}`;
  return `${input.message}${issueDetails}; searched workflow roots: ${input.searchedRoots.join(", ")}`;
}
