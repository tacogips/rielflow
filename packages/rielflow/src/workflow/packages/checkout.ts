import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicWriteJsonFile } from "../../shared/fs";
import { loadWorkflowFromDisk } from "../load";
import { resolveConfiguredRootPath } from "../paths";
import { err, ok, type Result } from "../result";
import { packageChangedArtifacts } from "./change-detection";
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
import {
  installWorkflowPackageSkills,
  resolveWorkflowPackageSkillProjectionPath,
} from "./skill-install";
import { validateWorkflowPackageSkills } from "./skills";
import type { WorkflowCheckoutScope } from "../checkout";
import { computeWorkflowCheckoutContentDigest } from "../checkout/content-digest";
import {
  resolveWorkflowCheckoutDestination,
  resolveUserScopeRootForCheckout,
} from "../checkout";
import type {
  WorkflowPackageFailure,
  WorkflowPackagePreInstallCheckMode,
  WorkflowPackagePreInstallCheckResult,
  WorkflowPackageRegistryConfigOptions,
  WorkflowPackageContainerRuntimeRequest,
  WorkflowPackageSkillInstallTarget,
  WorkflowPackageSkillSelection,
} from "./types";

export {
  getWorkflowPackageCheckoutStatus,
  listWorkflowPackageCheckouts,
  removeWorkflowPackageCheckout,
  updateWorkflowPackageCheckout,
} from "./checkout-records";

export interface WorkflowPackageCheckoutInput {
  readonly packageId?: string;
  readonly packageName: string;
  readonly registry?: string;
  readonly branch?: string;
  readonly userScope?: boolean;
  readonly overwrite?: boolean;
  readonly yes?: boolean;
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
  readonly contentDigestAlgorithm: "sha256";
  readonly contentDigest: string;
  readonly includedFiles: readonly string[];
  readonly packageVersion: string;
  readonly packageHash: string;
  readonly skills: readonly WorkflowPackageSkillInstallTarget[];
  readonly managedSkillRoot?: string;
  readonly preInstallCheck?: WorkflowPackagePreInstallCheckResult;
  readonly installId: string;
  readonly overwritten: boolean;
  readonly updated: boolean;
  readonly workflowDefinitionDirOverride?: string;
  readonly projectRootIdentity?: string;
  readonly changedArtifacts?: readonly string[];
  readonly confirmationSkipped?: boolean;
  readonly provenancePath?: string;
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

function resolveProjectRootForSkillInstall(input: {
  readonly options: WorkflowPackageRegistryConfigOptions | undefined;
  readonly workflowRoot: string;
}): string {
  if (input.options?.projectRoot !== undefined) {
    return path.resolve(input.options.projectRoot);
  }
  if (input.options?.cwd !== undefined) {
    return path.resolve(input.options.cwd);
  }
  const workflowRootName = path.basename(input.workflowRoot);
  if (workflowRootName === "workflows") {
    return path.dirname(input.workflowRoot);
  }
  return path.dirname(input.workflowRoot);
}

function createWorkflowPackageInstallId(input: {
  readonly scope: WorkflowCheckoutScope;
  readonly destinationDirectory: string;
  readonly projectRootIdentity?: string;
  readonly packageId: string;
  readonly workflowName: string;
}): string {
  const hash = createHash("sha256");
  hash.update(input.scope);
  hash.update("\0");
  hash.update(path.resolve(input.destinationDirectory));
  hash.update("\0");
  hash.update(input.projectRootIdentity ?? "");
  hash.update("\0");
  hash.update(input.packageId);
  hash.update("\0");
  hash.update(input.workflowName);
  return `package-${hash.digest("hex").slice(0, 24)}`;
}

function workflowDefinitionDirOverride(
  options: WorkflowPackageRegistryConfigOptions | undefined,
): string | undefined {
  return options?.workflowRoot === undefined
    ? undefined
    : resolveConfiguredRootPath(options.workflowRoot, options);
}

function packageCheckoutRegistryPath(input: {
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

async function readPackageCheckoutRecord(
  filePath: string,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  return readJsonRecord(filePath);
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

function existingSkillArtifactPaths(
  record: Readonly<Record<string, unknown>> | undefined,
): readonly string[] {
  if (record === undefined) {
    return [];
  }
  const paths: string[] = [];
  for (const entry of recordArray(record, "skills")) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }
    const skillRecord = entry as Readonly<Record<string, unknown>>;
    const managedPath = recordString(skillRecord, "managedPath");
    const projectionPath = recordString(skillRecord, "projectionPath");
    if (managedPath !== undefined) {
      paths.push(managedPath);
    }
    if (projectionPath !== undefined) {
      paths.push(projectionPath);
    }
  }
  const managedSkillRoot = recordString(record, "managedSkillRoot");
  if (managedSkillRoot !== undefined) {
    paths.push(managedSkillRoot);
  }
  return paths;
}

function plannedSkillArtifactPaths(input: {
  readonly managedSkillRoot: string;
  readonly scope: WorkflowCheckoutScope;
  readonly projectRoot: string;
  readonly userRoot: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly skills: readonly WorkflowPackageSkillSelection[];
}): readonly string[] {
  return input.skills.flatMap((skill) => {
    const managedPath = path.join(input.managedSkillRoot, skill.sourcePath);
    const projectionPath = resolveWorkflowPackageSkillProjectionPath({
      scope: input.scope,
      projectRoot: input.projectRoot,
      userRoot: input.userRoot,
      ...(input.env === undefined ? {} : { env: input.env }),
      skill,
    });
    return projectionPath === undefined
      ? [managedPath]
      : [managedPath, projectionPath];
  });
}

async function anyPathExists(paths: readonly string[]): Promise<boolean> {
  for (const candidate of paths) {
    if (await pathExists(candidate)) {
      return true;
    }
  }
  return false;
}

interface PackageCheckoutBackup {
  readonly targetPath: string;
  readonly backupPath?: string;
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
  const backups: PackageCheckoutBackup[] = [];
  const uniquePaths = [
    ...new Set(input.paths.map((target) => path.resolve(target))),
  ];
  for (const [index, targetPath] of uniquePaths.entries()) {
    if (await pathExists(targetPath)) {
      const backupPath = path.join(backupRoot, `backup-${String(index)}`);
      await mkdir(path.dirname(backupPath), { recursive: true });
      await rename(targetPath, backupPath);
      backups.push({ targetPath, backupPath });
    } else {
      backups.push({ targetPath });
    }
  }
  return { backupRoot, backups };
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

export async function checkoutWorkflowPackage(
  input: WorkflowPackageCheckoutInput,
): Promise<Result<WorkflowPackageCheckoutResult, WorkflowPackageFailure>> {
  if (input.userScope === true && input.options?.workflowRoot !== undefined) {
    return err(
      packageFailure(
        "USAGE",
        "--workflow-definition-dir cannot be combined with --user-scope for package checkout",
      ),
    );
  }
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
  const skills = await validateWorkflowPackageSkills({
    packageRoot,
    ...(manifest.value.skillDirectory === undefined
      ? {}
      : { skillDirectory: manifest.value.skillDirectory }),
  });
  if (!skills.ok) {
    return skills;
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
  const contentDigest =
    await computeWorkflowCheckoutContentDigest(sourceDirectory);
  if (!contentDigest.ok) {
    return err(packageFailure("IO", contentDigest.error.message));
  }
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
      ...(input.options?.workflowRoot === undefined
        ? {}
        : { workflowRoot: input.options.workflowRoot }),
      ...(input.userScope === undefined ? {} : { userScope: input.userScope }),
    },
  );
  if (!destination.ok) {
    return err(packageFailure("USAGE", destination.error.message));
  }
  const destinationExists = await pathExists(
    destination.value.workflowDirectory,
  );
  const userRoot = resolveUserScopeRootForCheckout(input.options ?? {});
  const projectRootIdentity =
    destination.value.scope === "project"
      ? resolveProjectRootForSkillInstall({
          options: input.options,
          workflowRoot: destination.value.workflowRoot,
        })
      : undefined;
  const installId = createWorkflowPackageInstallId({
    scope: destination.value.scope,
    destinationDirectory: destination.value.workflowDirectory,
    ...(projectRootIdentity === undefined ? {} : { projectRootIdentity }),
    packageId: record.packageName,
    workflowName: loaded.value.workflowName,
  });
  const checkoutRecordPath = packageCheckoutRegistryPath({
    userRoot,
    installId,
  });
  const checkoutRecordExists = await pathExists(checkoutRecordPath);
  const previousRecord = await readPackageCheckoutRecord(checkoutRecordPath);
  if ((destinationExists || checkoutRecordExists) && input.overwrite !== true) {
    return err(
      packageFailure(
        "DUPLICATE_PACKAGE",
        `package checkout already exists for ${destination.value.scope}:${loaded.value.workflowName}`,
      ),
    );
  }
  if (
    (destinationExists || checkoutRecordExists) &&
    input.overwrite === true &&
    input.yes !== true
  ) {
    return err(
      packageFailure(
        "UPDATE_CONFIRMATION_REQUIRED",
        `package checkout update for '${record.packageName}' requires --yes with --overwrite`,
      ),
    );
  }
  const directWorkflowDefinitionDir = workflowDefinitionDirOverride(
    input.options,
  );
  const plannedManagedSkillRoot = path.join(
    destination.value.scope === "user"
      ? path.join(path.dirname(userRoot), ".rielflow-managed")
      : path.join(
          resolveProjectRootForSkillInstall({
            options: input.options,
            workflowRoot: destination.value.workflowRoot,
          }),
          ".rielflow",
          "managed",
        ),
    "packages",
    record.packageName.replaceAll("/", "__").replaceAll("@", ""),
    record.version.replaceAll("/", "__").replaceAll("@", ""),
    "skills",
  );
  const projectRootForSkillInstall = resolveProjectRootForSkillInstall({
    options: input.options,
    workflowRoot: destination.value.workflowRoot,
  });
  const plannedSkillPaths = plannedSkillArtifactPaths({
    managedSkillRoot: plannedManagedSkillRoot,
    scope: destination.value.scope,
    projectRoot: projectRootForSkillInstall,
    userRoot,
    ...(input.options?.env === undefined ? {} : { env: input.options.env }),
    skills: skills.value,
  });
  if (input.overwrite !== true && (await anyPathExists(plannedSkillPaths))) {
    return err(
      packageFailure(
        "DUPLICATE_PACKAGE",
        `skill checkout already exists for package '${record.packageName}'`,
      ),
    );
  }
  const mutationBackups = await createMutationBackups({
    paths: [
      destination.value.workflowDirectory,
      checkoutRecordPath,
      plannedManagedSkillRoot,
      ...existingSkillArtifactPaths(previousRecord),
      ...plannedSkillPaths,
    ],
  });
  try {
    await copyPackageWorkflow({
      sourceDirectory,
      destinationDirectory: destination.value.workflowDirectory,
      ...(input.overwrite === undefined ? {} : { overwrite: input.overwrite }),
    });
    const installedSkills = await installWorkflowPackageSkills({
      packageRoot,
      packageName: record.packageName,
      version: record.version,
      scope: destination.value.scope,
      projectRoot: projectRootForSkillInstall,
      userRoot,
      ...(input.options?.env === undefined ? {} : { env: input.options.env }),
      overwrite: input.overwrite === true,
      skills: skills.value,
    });
    if (!installedSkills.ok) {
      await restoreMutationBackups(mutationBackups);
      return installedSkills;
    }
    const checkedOutAt = input.options?.now ?? new Date();
    const packageRecord = {
      checkoutKind: "package",
      installId,
      workflowName: loaded.value.workflowName,
      sourceUrl: `${record.registryUrl}#${record.sourceBranch}:${record.sourcePath}`,
      scope: destination.value.scope,
      checkedOutAt: checkedOutAt.toISOString(),
      destinationDirectory: destination.value.workflowDirectory,
      contentDigestAlgorithm: contentDigest.value.contentDigestAlgorithm,
      contentDigest: contentDigest.value.contentDigest,
      includedFiles: contentDigest.value.includedFiles,
      packageId: record.packageName,
      packageName: record.packageName,
      version: record.version,
      registryUrl: record.registryUrl,
      registryRef: record.sourceBranch,
      sourceDirectory,
      metadataPath: path.posix.join(record.sourcePath, "rielflow-package.json"),
      checksum: record.checksum,
      checksumAlgorithm: record.checksumAlgorithm,
      workflowDirectory: record.workflowDirectory,
      skillDirectory: manifest.value.skillDirectory ?? "skills",
      managedSkillRoot: installedSkills.value.managedSkillRoot,
      skills: installedSkills.value.targets,
      packageHash: checksum.value.checksum,
      integrity: {
        digestAlgorithm: integrity.value.digestAlgorithm,
        digest: integrity.value.digest,
        signatureVerified: integrity.value.signatureVerified,
        signatureRequired: integrity.value.signatureRequired,
      },
      ...(projectRootIdentity === undefined ? {} : { projectRootIdentity }),
      ...(directWorkflowDefinitionDir === undefined
        ? {}
        : { workflowDefinitionDirOverride: directWorkflowDefinitionDir }),
    } as const;
    const changedArtifacts = packageChangedArtifacts({
      previousRecord,
      nextRecord: packageRecord,
    });
    const packageRecordWithChanges = {
      ...packageRecord,
      changedArtifacts,
      updateAvailable: changedArtifacts.length > 0,
    } as const;
    await atomicWriteJsonFile(checkoutRecordPath, packageRecordWithChanges);
    await atomicWriteJsonFile(
      path.join(
        destination.value.workflowDirectory,
        ".rielflow-package-provenance.json",
      ),
      {
        packageId: record.packageName,
        installId,
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
        workflowDirectory: record.workflowDirectory,
        skillDirectory: manifest.value.skillDirectory ?? "skills",
        checksum: record.checksum,
        checksumAlgorithm: record.checksumAlgorithm,
        packageVersion: record.version,
        packageHash: checksum.value.checksum,
        ...(projectRootIdentity === undefined ? {} : { projectRootIdentity }),
        ...(directWorkflowDefinitionDir === undefined
          ? {}
          : { workflowDefinitionDirOverride: directWorkflowDefinitionDir }),
        managedSkillRoot: installedSkills.value.managedSkillRoot,
        skills: installedSkills.value.targets,
        integrity: {
          digestAlgorithm: integrity.value.digestAlgorithm,
          digest: integrity.value.digest,
          signatureVerified: integrity.value.signatureVerified,
          signatureRequired: integrity.value.signatureRequired,
        },
        checkedOutAt: checkedOutAt.toISOString(),
      },
    );
    await discardMutationBackups(mutationBackups);
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
      checkoutRecordPath,
      provenancePath: path.join(
        destination.value.workflowDirectory,
        ".rielflow-package-provenance.json",
      ),
      checksum: record.checksum,
      contentDigestAlgorithm: contentDigest.value.contentDigestAlgorithm,
      contentDigest: contentDigest.value.contentDigest,
      includedFiles: contentDigest.value.includedFiles,
      packageVersion: record.version,
      packageHash: checksum.value.checksum,
      skills: installedSkills.value.targets,
      installId,
      overwritten: destinationExists || checkoutRecordExists,
      updated: destinationExists || checkoutRecordExists,
      confirmationSkipped: input.yes === true,
      changedArtifacts,
      ...(projectRootIdentity === undefined ? {} : { projectRootIdentity }),
      ...(directWorkflowDefinitionDir === undefined
        ? {}
        : { workflowDefinitionDirOverride: directWorkflowDefinitionDir }),
      ...(installedSkills.value.targets.length === 0
        ? {}
        : { managedSkillRoot: installedSkills.value.managedSkillRoot }),
      ...(combinedPreInstallCheck === undefined
        ? {}
        : { preInstallCheck: combinedPreInstallCheck }),
    });
  } catch (error: unknown) {
    await restoreMutationBackups(mutationBackups);
    const message = error instanceof Error ? error.message : "unknown error";
    return err(packageFailure("IO", `package checkout failed: ${message}`));
  }
}
