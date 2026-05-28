import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkflowFromDisk } from "../load";
import { err, ok, type Result } from "../result";
import { computeWorkflowPackageChecksum } from "./checksum";
import { verifyWorkflowPackageIntegrity } from "./integrity";
import { loadWorkflowPackageManifest } from "./manifest";
import {
  loadWorkflowPackageRegistryConfig,
  resolveWorkflowPackageRegistryEntry,
} from "./registry-config";
import { searchWorkflowPackages } from "./search";
import type {
  WorkflowPackageFailure,
  WorkflowPackageTemporaryRunCheckoutInput,
  WorkflowPackageTemporaryRunCheckoutResult,
  WorkflowPackageTemporaryRunCleanupResult,
} from "./types";

function packageFailure(
  code: WorkflowPackageFailure["code"],
  message: string,
): WorkflowPackageFailure {
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

async function cleanupTemporaryRoot(
  temporaryRoot: string,
): Promise<
  Result<WorkflowPackageTemporaryRunCleanupResult, WorkflowPackageFailure>
> {
  try {
    await rm(temporaryRoot, { recursive: true, force: true });
    return ok({
      removed: true,
      temporaryRoot,
      remainingPaths: [],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      packageFailure(
        "IO",
        `temporary registry workflow cleanup failed: ${message}`,
      ),
    );
  }
}

export async function checkoutWorkflowPackageForTemporaryRun(
  input: WorkflowPackageTemporaryRunCheckoutInput,
): Promise<
  Result<WorkflowPackageTemporaryRunCheckoutResult, WorkflowPackageFailure>
> {
  const config = await loadWorkflowPackageRegistryConfig(input.options);
  if (!config.ok) {
    return config;
  }
  const registry = resolveWorkflowPackageRegistryEntry(
    config.value,
    input.registry,
  );
  if (!registry.ok) {
    return registry;
  }
  if (registry.value.localPath === undefined) {
    return err(
      packageFailure(
        "FETCH_FAILED",
        `registry '${registry.value.id}' has no localPath for temporary workflow run`,
      ),
    );
  }

  const searched = await searchWorkflowPackages({
    query: input.packageName,
    registry: registry.value.id,
    refresh: false,
    ...(input.branch === undefined ? {} : { branch: input.branch }),
    ...(input.options === undefined ? {} : { options: input.options }),
  });
  if (!searched.ok) {
    return searched;
  }
  const matches = searched.value.records.filter(
    (candidate) => candidate.packageName === input.packageName,
  );
  if (matches.length === 0) {
    return err(
      packageFailure(
        "MISSING_PACKAGE",
        `package '${input.packageName}' not found`,
      ),
    );
  }
  if (matches.length > 1) {
    return err(
      packageFailure(
        "DUPLICATE_PACKAGE",
        `multiple registry packages match '${input.packageName}'; retry with --registry or --branch`,
      ),
    );
  }
  const record = matches[0];
  if (record === undefined) {
    return err(
      packageFailure(
        "MISSING_PACKAGE",
        `package '${input.packageName}' not found`,
      ),
    );
  }

  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-registry-run-"),
  );
  try {
    const sourcePackageRoot = path.join(
      registry.value.localPath,
      record.sourcePath,
    );
    const packageStagingDirectory = path.join(temporaryRoot, "package");
    await cp(sourcePackageRoot, packageStagingDirectory, { recursive: true });
    const stagedWorkflowDirectory = path.join(
      packageStagingDirectory,
      record.workflowDirectory,
    );
    const manifest = await loadWorkflowPackageManifest(packageStagingDirectory);
    if (!manifest.ok) {
      await cleanupTemporaryRoot(temporaryRoot);
      return manifest;
    }
    const checksum = await computeWorkflowPackageChecksum({
      packageRoot: packageStagingDirectory,
      workflowDirectory: record.workflowDirectory,
    });
    if (!checksum.ok) {
      await cleanupTemporaryRoot(temporaryRoot);
      return checksum;
    }
    if (
      checksum.value.checksum !== record.checksum ||
      checksum.value.checksumAlgorithm !== record.checksumAlgorithm
    ) {
      await cleanupTemporaryRoot(temporaryRoot);
      return err(
        packageFailure(
          "VALIDATION",
          `package checksum mismatch for '${record.packageName}'`,
        ),
      );
    }
    const integrity = await verifyWorkflowPackageIntegrity({
      packageRoot: packageStagingDirectory,
      workflowDirectory: record.workflowDirectory,
      ...(manifest.value.integrity === undefined
        ? {}
        : { integrity: manifest.value.integrity }),
      registry: registry.value,
      ...(input.options === undefined ? {} : { options: input.options }),
    });
    if (!integrity.ok) {
      await cleanupTemporaryRoot(temporaryRoot);
      return integrity;
    }
    const loaded = await loadWorkflowFromDisk(
      path.basename(stagedWorkflowDirectory),
      {
        workflowRoot: path.dirname(stagedWorkflowDirectory),
        ...(input.options?.cwd === undefined ? {} : { cwd: input.options.cwd }),
        ...(input.options?.env === undefined ? {} : { env: input.options.env }),
        ...(input.options?.userRoot === undefined
          ? {}
          : { userRoot: input.options.userRoot }),
      },
    );
    if (!loaded.ok) {
      await cleanupTemporaryRoot(temporaryRoot);
      return err(
        packageFailure(
          "VALIDATION",
          `package workflow validation failed: ${loaded.error.message}`,
        ),
      );
    }

    const workflowDefinitionDir = path.join(temporaryRoot, "workflows");
    const temporaryWorkflowDirectory = path.join(
      workflowDefinitionDir,
      loaded.value.workflowName,
    );
    await cp(stagedWorkflowDirectory, temporaryWorkflowDirectory, {
      recursive: true,
    });

    return ok({
      workflowName: loaded.value.workflowName,
      workflowDefinitionDir,
      packageStagingDirectory,
      provenance: {
        packageId: record.packageName,
        workflowName: loaded.value.workflowName,
        registryId: record.registryId,
        registryUrl: record.registryUrl,
        registryRef: record.sourceBranch,
        sourcePath: record.sourcePath,
        sourceDirectory: stagedWorkflowDirectory,
        metadataPath: path.posix.join(
          record.sourcePath,
          "rielflow-package.json",
        ),
        checksum: record.checksum,
        checksumAlgorithm: record.checksumAlgorithm,
        temporaryWorkflowDirectory,
      },
      cleanup: async () => {
        const cleanup = await cleanupTemporaryRoot(temporaryRoot);
        if (!cleanup.ok) {
          return cleanup;
        }
        return ok({
          ...cleanup.value,
          remainingPaths: (await pathExists(temporaryRoot))
            ? [temporaryRoot]
            : [],
        });
      },
    });
  } catch (error: unknown) {
    await cleanupTemporaryRoot(temporaryRoot);
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      packageFailure(
        "IO",
        `temporary registry workflow checkout failed: ${message}`,
      ),
    );
  }
}
