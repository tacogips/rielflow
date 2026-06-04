import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicWriteJsonFile } from "../../shared/fs";
import type { WorkflowCheckoutScope } from "../checkout";
import { resolveUserScopeRootForCheckout } from "../checkout";
import { err, ok, type Result } from "../result";
import { packageChangedArtifacts } from "./change-detection";
import { computeWorkflowNodeAddonPackageChecksum } from "./checksum";
import type {
  WorkflowPackageCheckoutInput,
  WorkflowPackageCheckoutResult,
} from "./checkout";
import { verifyWorkflowNodeAddonPackageIntegrity } from "./integrity";
import {
  installWorkflowPackageAddons,
  validateWorkflowPackageAddons,
} from "./node-addon-install";
import type {
  NormalizedWorkflowNodeAddonPackageManifest,
  WorkflowPackageAddonInstallTarget,
  WorkflowPackageDependencyEdge,
  WorkflowPackageDependencyInstallResult,
  WorkflowPackageFailure,
  WorkflowPackageIndexRecord,
  WorkflowPackageRegistryEntry,
} from "./types";

interface PackageCheckoutBackup {
  readonly targetPath: string;
  readonly backupPath?: string;
}

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

async function removePathIfPresent(filePath: string): Promise<void> {
  try {
    await rm(filePath, { recursive: true, force: true });
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { readonly code?: unknown }).code
        : undefined;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      throw error;
    }
  }
}

async function readJsonRecord(
  filePath: string,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Readonly<Record<string, unknown>>)
      : undefined;
  } catch {
    return undefined;
  }
}

function recordString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function recordArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
): readonly unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function previousAddonDestinationSet(
  previousRecord: Readonly<Record<string, unknown>> | undefined,
): ReadonlySet<string> {
  if (previousRecord?.["packageKind"] !== "node-addon") {
    return new Set();
  }
  return new Set(
    recordArray(previousRecord, "addons").flatMap((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return [];
      }
      const target = recordString(
        entry as Readonly<Record<string, unknown>>,
        "destinationDirectory",
      );
      return target === undefined ? [] : [path.resolve(target)];
    }),
  );
}

async function anyPathExists(paths: readonly string[]): Promise<boolean> {
  for (const candidate of paths) {
    if (await pathExists(candidate)) {
      return true;
    }
  }
  return false;
}

async function createMutationBackups(input: {
  readonly paths: readonly string[];
}): Promise<{
  readonly backupRoot: string;
  readonly backups: readonly PackageCheckoutBackup[];
}> {
  const backupRoot = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-package-checkout-backup-"),
  );
  return createMutationBackupsWithRoot({
    backupRoot,
    paths: input.paths,
  });
}

async function createMutationBackupsWithRoot(input: {
  readonly backupRoot: string;
  readonly paths: readonly string[];
}): Promise<{
  readonly backupRoot: string;
  readonly backups: readonly PackageCheckoutBackup[];
}> {
  const backups: PackageCheckoutBackup[] = [];
  const uniquePaths = [
    ...new Set(input.paths.map((target) => path.resolve(target))),
  ];
  for (const [index, targetPath] of uniquePaths.entries()) {
    if (await pathExists(targetPath)) {
      const backupPath = path.join(input.backupRoot, `backup-${String(index)}`);
      await mkdir(path.dirname(backupPath), { recursive: true });
      await rename(targetPath, backupPath);
      backups.push({ targetPath, backupPath });
    } else {
      backups.push({ targetPath });
    }
  }
  return { backupRoot: input.backupRoot, backups };
}

async function restoreMutationBackups(input: {
  readonly backupRoot: string;
  readonly backups: readonly PackageCheckoutBackup[];
}): Promise<void> {
  for (const backup of [...input.backups].reverse()) {
    await removePathIfPresent(backup.targetPath);
    if (
      backup.backupPath !== undefined &&
      (await pathExists(backup.backupPath))
    ) {
      await mkdir(path.dirname(backup.targetPath), { recursive: true });
      await rename(backup.backupPath, backup.targetPath);
    }
  }
  await removePathIfPresent(input.backupRoot);
}

async function discardMutationBackups(input: {
  readonly backupRoot: string;
}): Promise<void> {
  await removePathIfPresent(input.backupRoot);
}

function checkoutRecordPath(input: {
  readonly userRoot: string;
  readonly installId: string;
}): string {
  return path.join(
    input.userRoot,
    "workflow-registry",
    "checkouts",
    `${input.installId}.json`,
  );
}

function resolveProjectRootForAddonInstall(
  options: WorkflowPackageCheckoutInput["options"],
): string {
  if (options?.projectRoot !== undefined) {
    return path.resolve(options.projectRoot);
  }
  if (options?.cwd !== undefined) {
    return path.resolve(options.cwd);
  }
  return process.cwd();
}

function resolveNodeAddonInstallScope(input: {
  readonly userScope?: boolean;
  readonly options?: WorkflowPackageCheckoutInput["options"];
}): {
  readonly scope: WorkflowCheckoutScope;
  readonly addonRoot: string;
  readonly projectRootIdentity?: string;
} {
  const userRoot = resolveUserScopeRootForCheckout(input.options ?? {});
  if (input.userScope === true) {
    return {
      scope: "user",
      addonRoot: path.join(userRoot, "addons"),
    };
  }
  const projectRoot = resolveProjectRootForAddonInstall(input.options);
  return {
    scope: "project",
    addonRoot: path.join(projectRoot, ".rielflow", "addons"),
    projectRootIdentity: projectRoot,
  };
}

function createNodeAddonPackageInstallId(input: {
  readonly scope: WorkflowCheckoutScope;
  readonly addonRoot: string;
  readonly projectRootIdentity?: string;
  readonly packageId: string;
}): string {
  const hash = createHash("sha256");
  hash.update("node-addon");
  hash.update("\0");
  hash.update(input.scope);
  hash.update("\0");
  hash.update(path.resolve(input.addonRoot));
  hash.update("\0");
  hash.update(input.projectRootIdentity ?? "");
  hash.update("\0");
  hash.update(input.packageId);
  return `package-${hash.digest("hex").slice(0, 24)}`;
}

function combinedAddonContentDigest(
  artifacts: readonly WorkflowPackageAddonInstallTarget[],
): string {
  const hash = createHash("sha256");
  for (const artifact of artifacts) {
    hash.update(artifact.addonName, "utf8");
    hash.update("\0", "utf8");
    hash.update(artifact.addonVersion, "utf8");
    hash.update("\0", "utf8");
    hash.update(artifact.contentDigest, "utf8");
    hash.update("\0", "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function checkoutWorkflowNodeAddonPackage(input: {
  readonly checkoutInput: WorkflowPackageCheckoutInput;
  readonly registry: WorkflowPackageRegistryEntry & {
    readonly localPath: string;
  };
  readonly record: WorkflowPackageIndexRecord;
  readonly packageRoot: string;
  readonly manifest: NormalizedWorkflowNodeAddonPackageManifest;
  readonly dependencies?: readonly WorkflowPackageDependencyInstallResult[];
  readonly dependencyGraph?: readonly WorkflowPackageDependencyEdge[];
}): Promise<Result<WorkflowPackageCheckoutResult, WorkflowPackageFailure>> {
  if (input.checkoutInput.options?.workflowRoot !== undefined) {
    return err(
      packageFailure(
        "USAGE",
        "--workflow-definition-dir is only supported for workflow package checkout",
      ),
    );
  }
  const userRoot = resolveUserScopeRootForCheckout(
    input.checkoutInput.options ?? {},
  );
  const checksum = await computeWorkflowNodeAddonPackageChecksum({
    packageRoot: input.packageRoot,
  });
  if (!checksum.ok) {
    return checksum;
  }
  if (
    checksum.value.checksum !== input.record.checksum ||
    checksum.value.checksumAlgorithm !== input.record.checksumAlgorithm
  ) {
    return err(
      packageFailure(
        "VALIDATION",
        `package checksum mismatch for '${input.record.packageName}'`,
      ),
    );
  }
  if (
    input.manifest.integrity === undefined &&
    input.manifest.addons.some(
      (addon) =>
        addon.execution !== undefined && addon.execution.kind !== "declarative",
    )
  ) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        `executable node-addon package '${input.record.packageName}' requires sha256 integrity metadata`,
      ),
    );
  }
  const integrity = await verifyWorkflowNodeAddonPackageIntegrity({
    packageRoot: input.packageRoot,
    ...(input.manifest.integrity === undefined
      ? {}
      : { integrity: input.manifest.integrity }),
    registry: input.registry,
    ...(input.checkoutInput.options === undefined
      ? {}
      : { options: input.checkoutInput.options }),
  });
  if (!integrity.ok) {
    return integrity;
  }
  const artifacts = await validateWorkflowPackageAddons({
    packageRoot: input.packageRoot,
    addons: input.manifest.addons,
  });
  if (!artifacts.ok) {
    return artifacts;
  }
  const destination = resolveNodeAddonInstallScope({
    ...(input.checkoutInput.userScope === undefined
      ? {}
      : { userScope: input.checkoutInput.userScope }),
    ...(input.checkoutInput.options === undefined
      ? {}
      : { options: input.checkoutInput.options }),
  });
  const installId = createNodeAddonPackageInstallId({
    scope: destination.scope,
    addonRoot: destination.addonRoot,
    ...(destination.projectRootIdentity === undefined
      ? {}
      : { projectRootIdentity: destination.projectRootIdentity }),
    packageId: input.record.packageName,
  });
  const recordPath = checkoutRecordPath({ userRoot, installId });
  const previousRecord = await readJsonRecord(recordPath);
  const plannedAddonPaths = artifacts.value.map((artifact) => {
    const [namespace, addonName] = artifact.addonName.split("/");
    return path.join(
      destination.addonRoot,
      namespace ?? "",
      addonName ?? "",
      artifact.addonVersion,
    );
  });
  const destinationExists = await anyPathExists(plannedAddonPaths);
  const checkoutRecordExists = await pathExists(recordPath);
  const previouslyOwnedAddonDestinations =
    previousAddonDestinationSet(previousRecord);
  const existingUnownedDestination = await (async () => {
    for (const plannedPath of plannedAddonPaths) {
      if (
        (await pathExists(plannedPath)) &&
        !previouslyOwnedAddonDestinations.has(path.resolve(plannedPath))
      ) {
        return plannedPath;
      }
    }
    return undefined;
  })();
  if (
    (destinationExists || checkoutRecordExists) &&
    input.checkoutInput.overwrite !== true
  ) {
    return err(
      packageFailure(
        "DUPLICATE_PACKAGE",
        `node-addon package checkout already exists for ${destination.scope}:${input.record.packageName}`,
      ),
    );
  }
  if (
    checkoutRecordExists &&
    previousRecord?.["packageKind"] !== "node-addon"
  ) {
    return err(
      packageFailure(
        "DUPLICATE_PACKAGE",
        `existing checkout record for '${input.record.packageName}' is not a node-addon package record`,
      ),
    );
  }
  if (existingUnownedDestination !== undefined) {
    return err(
      packageFailure(
        "DUPLICATE_PACKAGE",
        `existing add-on destination for '${input.record.packageName}' is not package-owned: ${existingUnownedDestination}`,
      ),
    );
  }
  if (
    (destinationExists || checkoutRecordExists) &&
    input.checkoutInput.overwrite === true &&
    input.checkoutInput.yes !== true
  ) {
    return err(
      packageFailure(
        "UPDATE_CONFIRMATION_REQUIRED",
        `node-addon package checkout update for '${input.record.packageName}' requires --yes with --overwrite`,
      ),
    );
  }
  const mutationBackups = await createMutationBackups({
    paths: [
      recordPath,
      ...plannedAddonPaths,
      ...recordArray(previousRecord ?? {}, "addons").flatMap((entry) => {
        if (
          typeof entry !== "object" ||
          entry === null ||
          Array.isArray(entry)
        ) {
          return [];
        }
        const target = recordString(
          entry as Readonly<Record<string, unknown>>,
          "destinationDirectory",
        );
        return target === undefined ? [] : [target];
      }),
    ],
  });
  try {
    const installedAddons = await installWorkflowPackageAddons({
      artifacts: artifacts.value,
      addonRoot: destination.addonRoot,
      scope: destination.scope,
      overwrite: input.checkoutInput.overwrite === true,
    });
    if (!installedAddons.ok) {
      await restoreMutationBackups(mutationBackups);
      return installedAddons;
    }
    const checkedOutAt = input.checkoutInput.options?.now ?? new Date();
    const contentDigest = combinedAddonContentDigest(installedAddons.value);
    const packageRecord = {
      checkoutKind: "package",
      packageKind: "node-addon",
      installId,
      workflowName: input.record.packageName,
      sourceUrl: `${input.record.registryUrl}#${input.record.sourceBranch}:${input.record.sourcePath}`,
      scope: destination.scope,
      checkedOutAt: checkedOutAt.toISOString(),
      destinationDirectory: destination.addonRoot,
      contentDigestAlgorithm: "sha256",
      contentDigest,
      includedFiles: checksum.value.includedFiles,
      packageId: input.record.packageName,
      packageName: input.record.packageName,
      version: input.record.version,
      registryUrl: input.record.registryUrl,
      registryRef: input.record.sourceBranch,
      sourcePath: input.record.sourcePath,
      sourceDirectory: input.packageRoot,
      metadataPath: path.posix.join(
        input.record.sourcePath,
        "rielflow-package.json",
      ),
      checksum: input.record.checksum,
      checksumAlgorithm: input.record.checksumAlgorithm,
      addons: installedAddons.value,
      packageHash: checksum.value.checksum,
      integrity: {
        digestAlgorithm: integrity.value.digestAlgorithm,
        digest: integrity.value.digest,
        signatureVerified: integrity.value.signatureVerified,
        signatureRequired: integrity.value.signatureRequired,
      },
      ...(input.dependencies === undefined || input.dependencies.length === 0
        ? {}
        : { dependencies: input.dependencies }),
      ...(input.dependencyGraph === undefined ||
      input.dependencyGraph.length === 0
        ? {}
        : { dependencyGraph: input.dependencyGraph }),
      ...(destination.projectRootIdentity === undefined
        ? {}
        : { projectRootIdentity: destination.projectRootIdentity }),
    } as const;
    const changedArtifacts = packageChangedArtifacts({
      previousRecord,
      nextRecord: packageRecord,
    });
    await atomicWriteJsonFile(recordPath, {
      ...packageRecord,
      changedArtifacts,
      updateAvailable: changedArtifacts.length > 0,
    });
    await discardMutationBackups(mutationBackups);
    return ok({
      packageKind: "node-addon",
      packageId: input.record.packageName,
      packageName: input.record.packageName,
      workflowName: input.record.packageName,
      scope: destination.scope,
      destinationDirectory: destination.addonRoot,
      registryPath: input.registry.localPath,
      registryUrl: input.record.registryUrl,
      registryRef: input.record.sourceBranch,
      sourcePath: input.record.sourcePath,
      sourceDirectory: input.packageRoot,
      metadataPath: path.posix.join(
        input.record.sourcePath,
        "rielflow-package.json",
      ),
      checkoutRecordPath: recordPath,
      checksum: input.record.checksum,
      checksumAlgorithm: input.record.checksumAlgorithm,
      contentDigestAlgorithm: "sha256",
      contentDigest,
      includedFiles: checksum.value.includedFiles,
      packageVersion: input.record.version,
      packageHash: checksum.value.checksum,
      skills: [],
      addons: installedAddons.value,
      installId,
      overwritten: destinationExists || checkoutRecordExists,
      updated: destinationExists || checkoutRecordExists,
      confirmationSkipped: input.checkoutInput.yes === true,
      changedArtifacts,
      integrityDigest: integrity.value.digest,
      ...(input.dependencies === undefined || input.dependencies.length === 0
        ? {}
        : { dependencies: input.dependencies }),
      ...(input.dependencyGraph === undefined ||
      input.dependencyGraph.length === 0
        ? {}
        : { dependencyGraph: input.dependencyGraph }),
    });
  } catch (error: unknown) {
    await restoreMutationBackups(mutationBackups);
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      packageFailure("IO", `node-addon package checkout failed: ${message}`),
    );
  }
}
