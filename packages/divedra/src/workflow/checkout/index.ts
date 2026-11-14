import { cp, mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkflowFromDisk } from "../load";
import { err, ok, type Result } from "../result";
import type { LoadOptions } from "../types";
import {
  fetchGitHubDirectoryToStaging,
  parseGitHubDirectoryUrl,
} from "./github-directory";
import {
  createWorkflowCheckoutRegistryRecord,
  resolveWorkflowCheckoutDestination,
  writeWorkflowCheckoutRegistryRecord,
} from "./registry";
import type { WorkflowCheckoutFailure, WorkflowCheckoutResult } from "./types";
export type {
  WorkflowCheckoutFailure,
  WorkflowCheckoutResult,
  WorkflowCheckoutScope,
} from "./types";
export type {
  WorkflowCheckoutDestination,
  WorkflowCheckoutRegistryRecord,
} from "./registry";
export {
  parseGitHubDirectoryUrl,
  fetchGitHubDirectoryToStaging,
} from "./github-directory";
export {
  resolveWorkflowCheckoutDestination,
  resolveUserScopeRootForCheckout,
} from "./registry";

export interface WorkflowCheckoutOptions extends LoadOptions {
  readonly sourceUrl: string;
  readonly userScope?: boolean;
  readonly overwrite?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

function checkoutFailure(
  code: WorkflowCheckoutFailure["code"],
  message: string,
): WorkflowCheckoutFailure {
  return { code, message };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function moveDirectory(
  sourceDirectory: string,
  destinationDirectory: string,
): Promise<void> {
  try {
    await rename(sourceDirectory, destinationDirectory);
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { readonly code?: unknown }).code
        : undefined;
    if (code !== "EXDEV") {
      throw error;
    }
    await cp(sourceDirectory, destinationDirectory, { recursive: true });
    await rm(sourceDirectory, { recursive: true, force: true });
  }
}

function isInsideDirectory(
  parentDirectory: string,
  childDirectory: string,
): boolean {
  const relative = path.relative(
    path.resolve(parentDirectory),
    path.resolve(childDirectory),
  );
  return (
    relative.length > 0 &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

async function restoreCheckoutBackup(input: {
  readonly backupDirectory: string | undefined;
  readonly destinationDirectory: string;
}): Promise<void> {
  await rm(input.destinationDirectory, { recursive: true, force: true });
  if (input.backupDirectory !== undefined) {
    await rename(input.backupDirectory, input.destinationDirectory);
  }
}

export async function checkoutWorkflow(
  options: WorkflowCheckoutOptions,
): Promise<Result<WorkflowCheckoutResult, WorkflowCheckoutFailure>> {
  const parsedUrl = parseGitHubDirectoryUrl(options.sourceUrl);
  if (!parsedUrl.ok) {
    return parsedUrl;
  }
  const preflightDestination = resolveWorkflowCheckoutDestination(
    parsedUrl.value.workflowName,
    options,
  );
  if (!preflightDestination.ok) {
    return preflightDestination;
  }
  const destinationExistsBeforeFetch = await pathExists(
    preflightDestination.value.workflowDirectory,
  );
  const registryExistsBeforeFetch = await pathExists(
    preflightDestination.value.registryPath,
  );
  if (
    (destinationExistsBeforeFetch || registryExistsBeforeFetch) &&
    options.overwrite !== true
  ) {
    return err(
      checkoutFailure(
        "DUPLICATE_CHECKOUT",
        `workflow checkout already exists for ${preflightDestination.value.scope}:${parsedUrl.value.workflowName}`,
      ),
    );
  }

  const stagingRoot = await mkdtemp(
    path.join(os.tmpdir(), "divedra-workflow-checkout-"),
  );
  try {
    const provisionalUrl = await fetchGitHubDirectoryToStaging({
      sourceUrl: options.sourceUrl,
      destinationDirectory: path.join(stagingRoot, "remote"),
      ...(options.fetchImpl === undefined
        ? {}
        : { fetchImpl: options.fetchImpl }),
    });
    if (!provisionalUrl.ok) {
      return provisionalUrl;
    }

    const workflowName = provisionalUrl.value.workflowName;
    const stagedWorkflowDirectory = path.join(stagingRoot, workflowName);
    await rename(path.join(stagingRoot, "remote"), stagedWorkflowDirectory);

    const loaded = await loadWorkflowFromDisk(workflowName, {
      ...options,
      workflowRoot: stagingRoot,
    });
    if (!loaded.ok) {
      return err(
        checkoutFailure(
          "VALIDATION",
          `remote workflow validation failed: ${loaded.error.message}`,
        ),
      );
    }

    const destination = preflightDestination;

    const destinationExists = await pathExists(
      destination.value.workflowDirectory,
    );
    const registryExists = await pathExists(destination.value.registryPath);
    const duplicateExists = destinationExists || registryExists;
    if (duplicateExists && options.overwrite !== true) {
      return err(
        checkoutFailure(
          "DUPLICATE_CHECKOUT",
          `workflow checkout already exists for ${destination.value.scope}:${workflowName}`,
        ),
      );
    }

    if (
      destinationExists &&
      !isInsideDirectory(
        destination.value.workflowRoot,
        destination.value.workflowDirectory,
      )
    ) {
      return err(
        checkoutFailure(
          "UNSAFE_DESTINATION",
          `refusing to remove destination outside workflow root: ${destination.value.workflowDirectory}`,
        ),
      );
    }

    const record = createWorkflowCheckoutRegistryRecord({
      workflowName,
      sourceUrl: options.sourceUrl,
      scope: destination.value.scope,
      checkedOutAt: options.now?.() ?? new Date(),
      destinationDirectory: destination.value.workflowDirectory,
    });

    await mkdir(destination.value.workflowRoot, { recursive: true });
    const backupParent = destinationExists
      ? await mkdtemp(
          path.join(
            destination.value.workflowRoot,
            `.${workflowName}-checkout-backup-`,
          ),
        )
      : undefined;
    const backupDirectory =
      backupParent === undefined
        ? undefined
        : path.join(backupParent, "workflow");
    try {
      if (backupDirectory !== undefined) {
        await rename(destination.value.workflowDirectory, backupDirectory);
      }
      await moveDirectory(
        stagedWorkflowDirectory,
        destination.value.workflowDirectory,
      );
      try {
        await writeWorkflowCheckoutRegistryRecord(
          destination.value.registryPath,
          record,
        );
      } catch (error: unknown) {
        await restoreCheckoutBackup({
          backupDirectory,
          destinationDirectory: destination.value.workflowDirectory,
        });
        throw error;
      }
    } catch (error: unknown) {
      if (
        backupDirectory !== undefined &&
        (await pathExists(backupDirectory))
      ) {
        await restoreCheckoutBackup({
          backupDirectory,
          destinationDirectory: destination.value.workflowDirectory,
        });
      } else if (backupDirectory === undefined) {
        await rm(destination.value.workflowDirectory, {
          recursive: true,
          force: true,
        });
      }
      throw error;
    } finally {
      if (backupParent !== undefined) {
        await rm(backupParent, { recursive: true, force: true });
      }
    }

    return ok({
      workflowName,
      sourceUrl: options.sourceUrl,
      scope: destination.value.scope,
      destinationDirectory: destination.value.workflowDirectory,
      registryPath: destination.value.registryPath,
      validationStatus: "valid",
      overwritten: duplicateExists,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(checkoutFailure("IO", `workflow checkout failed: ${message}`));
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}
