import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJsonFile } from "../../shared/fs";
import { loadWorkflowFromDisk } from "../load";
import { err, ok, type Result } from "../result";
import { computeWorkflowPackageChecksum } from "./checksum";
import { verifyWorkflowPackageIntegrity } from "./integrity";
import { loadWorkflowPackageManifest } from "./manifest";
import { runWorkflowPackageContainerCheck } from "./pre-install-container";
import { createWorkflowPackageStaticScanner } from "./pre-install-scanner";
import {
  loadWorkflowPackageRegistryConfig,
  resolveWorkflowPackageRegistryEntry,
} from "./registry-config";
import { searchWorkflowPackages } from "./search";
import type { WorkflowCheckoutScope } from "../checkout";
import {
  resolveWorkflowCheckoutDestination,
  writeWorkflowCheckoutRegistryRecord,
} from "../checkout";
import type {
  WorkflowPackageFailure,
  WorkflowPackagePreInstallCheckMode,
  WorkflowPackagePreInstallCheckResult,
  WorkflowPackageRegistryConfigOptions,
  WorkflowPackageContainerRuntimeRequest,
} from "./types";

export interface WorkflowPackageCheckoutInput {
  readonly packageId?: string;
  readonly packageName: string;
  readonly registry?: string;
  readonly branch?: string;
  readonly userScope?: boolean;
  readonly overwrite?: boolean;
  readonly preInstallCheck?: boolean;
  readonly preInstallCheckMode?: WorkflowPackagePreInstallCheckMode;
  readonly preInstallCheckContainer?: WorkflowPackageContainerRuntimeRequest;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}

export interface WorkflowPackageCheckoutResult {
  readonly packageId: string;
  readonly packageName: string;
  readonly workflowName: string;
  readonly scope: WorkflowCheckoutScope;
  readonly destinationDirectory: string;
  readonly registryPath: string;
  readonly registryUrl: string;
  readonly registryRef: string;
  readonly sourcePath: string;
  readonly sourceDirectory: string;
  readonly metadataPath: string;
  readonly checkoutRecordPath: string;
  readonly checksum: string;
  readonly preInstallCheck?: WorkflowPackagePreInstallCheckResult;
}

function packageFailure(
  code: WorkflowPackageFailure["code"],
  message: string,
): WorkflowPackageFailure {
  return { code, message };
}

function mergePreInstallResults(
  staticResult: WorkflowPackagePreInstallCheckResult,
  containerResult: WorkflowPackagePreInstallCheckResult | undefined,
): WorkflowPackagePreInstallCheckResult {
  if (containerResult === undefined) {
    return staticResult;
  }
  return {
    enabled: true,
    mode: staticResult.mode,
    status:
      staticResult.status === "failed" || containerResult.status === "failed"
        ? "failed"
        : staticResult.status === "warned" ||
            containerResult.status === "warned"
          ? "warned"
          : "passed",
    scannerVersion: `${staticResult.scannerVersion}+${containerResult.scannerVersion}`,
    ...(containerResult.containerRuntime === undefined
      ? {}
      : { containerRuntime: containerResult.containerRuntime }),
    findings: [...staticResult.findings, ...containerResult.findings],
  };
}

async function copyPackageWorkflow(input: {
  readonly sourceDirectory: string;
  readonly destinationDirectory: string;
  readonly overwrite?: boolean;
}): Promise<void> {
  await mkdir(path.dirname(input.destinationDirectory), { recursive: true });
  if (input.overwrite === true) {
    await rm(input.destinationDirectory, { recursive: true, force: true });
  }
  await cp(input.sourceDirectory, input.destinationDirectory, {
    recursive: true,
    errorOnExist: input.overwrite !== true,
    force: input.overwrite === true,
  });
}

export async function checkoutWorkflowPackage(
  input: WorkflowPackageCheckoutInput,
): Promise<Result<WorkflowPackageCheckoutResult, WorkflowPackageFailure>> {
  const packageId = input.packageId ?? input.packageName;
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
        `registry '${registry.value.id}' has no localPath for checkout`,
      ),
    );
  }
  const searched = await searchWorkflowPackages({
    query: packageId,
    registry: registry.value.id,
    refresh: false,
    ...(input.branch === undefined ? {} : { branch: input.branch }),
    ...(input.options === undefined ? {} : { options: input.options }),
  });
  if (!searched.ok) {
    return searched;
  }
  const record = searched.value.records.find(
    (candidate) => candidate.packageName === packageId,
  );
  if (record === undefined) {
    return err(
      packageFailure("MISSING_PACKAGE", `package '${packageId}' not found`),
    );
  }
  const packageRoot = path.join(registry.value.localPath, record.sourcePath);
  const sourceDirectory = path.join(packageRoot, record.workflowDirectory);
  const manifest = await loadWorkflowPackageManifest(packageRoot);
  if (!manifest.ok) {
    return manifest;
  }
  const checksum = await computeWorkflowPackageChecksum({
    packageRoot,
    workflowDirectory: record.workflowDirectory,
  });
  if (!checksum.ok) {
    return checksum;
  }
  if (
    checksum.value.checksum !== record.checksum ||
    checksum.value.checksumAlgorithm !== record.checksumAlgorithm
  ) {
    return err(
      packageFailure(
        "VALIDATION",
        `package checksum mismatch for '${record.packageName}'`,
      ),
    );
  }
  const integrity = await verifyWorkflowPackageIntegrity({
    packageRoot,
    workflowDirectory: record.workflowDirectory,
    ...(manifest.value.integrity === undefined
      ? {}
      : { integrity: manifest.value.integrity }),
    registry: registry.value,
    ...(input.options === undefined ? {} : { options: input.options }),
  });
  if (!integrity.ok) {
    return integrity;
  }
  const loaded = await loadWorkflowFromDisk(path.basename(sourceDirectory), {
    workflowRoot: path.dirname(sourceDirectory),
    ...(input.options?.cwd === undefined ? {} : { cwd: input.options.cwd }),
    ...(input.options?.env === undefined ? {} : { env: input.options.env }),
    ...(input.options?.userRoot === undefined
      ? {}
      : { userRoot: input.options.userRoot }),
  });
  if (!loaded.ok) {
    return err(
      packageFailure(
        "VALIDATION",
        `package workflow validation failed: ${loaded.error.message}`,
      ),
    );
  }
  const preInstallMode = input.preInstallCheckMode ?? "reject";
  const shouldRunPreInstallCheck =
    input.preInstallCheck === true ||
    input.preInstallCheckContainer !== undefined;
  const preInstallCheck = shouldRunPreInstallCheck
    ? await createWorkflowPackageStaticScanner().scan({
        packageDirectory: packageRoot,
        workflowDirectory: record.workflowDirectory,
        mode: preInstallMode,
      })
    : undefined;
  if (preInstallCheck?.status === "failed") {
    return err(
      packageFailure(
        "PRE_INSTALL_CHECK_FAILED",
        `pre-install check failed for '${record.packageName}' with ${preInstallCheck.findings.length} finding(s)`,
      ),
    );
  }
  const containerCheck =
    input.preInstallCheckContainer === undefined
      ? undefined
      : await runWorkflowPackageContainerCheck({
          packageDirectory: packageRoot,
          runtime: input.preInstallCheckContainer,
          mode: preInstallMode,
        });
  if (containerCheck !== undefined && !containerCheck.ok) {
    return containerCheck;
  }
  const combinedPreInstallCheck =
    preInstallCheck === undefined
      ? undefined
      : mergePreInstallResults(preInstallCheck, containerCheck?.value);
  const destination = resolveWorkflowCheckoutDestination(
    loaded.value.workflowName,
    {
      ...(input.options?.cwd === undefined ? {} : { cwd: input.options.cwd }),
      ...(input.options?.env === undefined ? {} : { env: input.options.env }),
      ...(input.options?.userRoot === undefined
        ? {}
        : { userRoot: input.options.userRoot }),
      ...(input.options?.projectRoot === undefined
        ? {}
        : { projectRoot: input.options.projectRoot }),
      ...(input.userScope === undefined ? {} : { userScope: input.userScope }),
    },
  );
  if (!destination.ok) {
    return err(packageFailure("USAGE", destination.error.message));
  }
  try {
    await copyPackageWorkflow({
      sourceDirectory,
      destinationDirectory: destination.value.workflowDirectory,
      ...(input.overwrite === undefined ? {} : { overwrite: input.overwrite }),
    });
    const checkedOutAt = input.options?.now ?? new Date();
    await writeWorkflowCheckoutRegistryRecord(destination.value.registryPath, {
      workflowName: loaded.value.workflowName,
      sourceUrl: `${record.registryUrl}#${record.sourceBranch}:${record.sourcePath}`,
      scope: destination.value.scope,
      checkedOutAt: checkedOutAt.toISOString(),
      destinationDirectory: destination.value.workflowDirectory,
    });
    await atomicWriteJsonFile(
      path.join(
        destination.value.workflowDirectory,
        ".rielflow-package-provenance.json",
      ),
      {
        packageId: record.packageName,
        packageName: record.packageName,
        registryId: record.registryId,
        registryUrl: record.registryUrl,
        registryRef: record.sourceBranch,
        sourceBranch: record.sourceBranch,
        sourcePath: record.sourcePath,
        sourceDirectory,
        metadataPath: path.posix.join(
          record.sourcePath,
          "rielflow-package.json",
        ),
        checksum: record.checksum,
        checksumAlgorithm: record.checksumAlgorithm,
        integrity: {
          digestAlgorithm: integrity.value.digestAlgorithm,
          digest: integrity.value.digest,
          signatureVerified: integrity.value.signatureVerified,
          signatureRequired: integrity.value.signatureRequired,
        },
        checkedOutAt: checkedOutAt.toISOString(),
      },
    );
    return ok({
      packageId: record.packageName,
      packageName: record.packageName,
      workflowName: loaded.value.workflowName,
      scope: destination.value.scope,
      destinationDirectory: destination.value.workflowDirectory,
      registryPath: destination.value.registryPath,
      registryUrl: record.registryUrl,
      registryRef: record.sourceBranch,
      sourcePath: record.sourcePath,
      sourceDirectory,
      metadataPath: path.posix.join(record.sourcePath, "rielflow-package.json"),
      checkoutRecordPath: destination.value.registryPath,
      checksum: record.checksum,
      ...(combinedPreInstallCheck === undefined
        ? {}
        : { preInstallCheck: combinedPreInstallCheck }),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(packageFailure("IO", `package checkout failed: ${message}`));
  }
}
