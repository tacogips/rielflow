import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildGitHubTreeDirectoryUrl,
  fetchGitHubDefaultBranch,
  fetchGitHubDirectoryToStaging,
  parseBranchlessGitHubDirectoryUrl,
  parseGitHubDirectoryUrl,
  type BranchlessGitHubDirectoryUrl,
  type GitHubDirectoryUrl,
} from "../checkout";
import { loadWorkflowFromDisk } from "../load";
import { err, ok, type Result } from "../result";
import { computeWorkflowPackageChecksum } from "./checksum";
import { verifyWorkflowPackageIntegrity } from "./integrity";
import {
  isSafeWorkflowPackageName,
  loadWorkflowPackageManifest,
} from "./manifest";
import {
  loadWorkflowPackageRegistryConfig,
  resolveWorkflowPackageRegistryEntry,
} from "./registry-config";
import { searchWorkflowPackages } from "./search";
import type {
  RegistryRunTargetKind,
  WorkflowPackageFailure,
  WorkflowPackageIndexRecord,
  WorkflowPackageRegistryConfig,
  WorkflowPackageRegistryEntry,
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

function checkoutFailureToPackageFailure(
  messagePrefix: string,
  code: WorkflowPackageFailure["code"] = "FETCH_FAILED",
): (error: { readonly message: string }) => WorkflowPackageFailure {
  return (error) => packageFailure(code, `${messagePrefix}: ${error.message}`);
}

function isGitHubDirectoryUrl(target: string): boolean {
  try {
    const parsed = new URL(target);
    if (parsed.protocol === "https:" && parsed.hostname === "github.com") {
      return true;
    }
  } catch {
    return false;
  }
  return (
    parseGitHubDirectoryUrl(target).ok ||
    parseBranchlessGitHubDirectoryUrl(target).ok
  );
}

function classifyRegistryRunTarget(target: string): RegistryRunTargetKind {
  if (isGitHubDirectoryUrl(target)) {
    return "github-directory-url";
  }
  if (isSafeWorkflowPackageName(target)) {
    return "package-id";
  }
  const segments = target.split("/").filter((segment) => segment.length > 0);
  return segments.length === 2 ? "registered-shorthand" : "package-id";
}

function registryRepositoryCoordinates(
  registry: WorkflowPackageRegistryEntry,
): { readonly owner: string; readonly repository: string } | undefined {
  try {
    const parsed = new URL(registry.url);
    const [owner, repository] = parsed.pathname.split("/").filter(Boolean);
    return owner === undefined || repository === undefined
      ? undefined
      : { owner, repository };
  } catch {
    return undefined;
  }
}

function selectRegistries(
  config: WorkflowPackageRegistryConfig,
  selector: string | undefined,
): Result<readonly WorkflowPackageRegistryEntry[], WorkflowPackageFailure> {
  if (selector !== undefined) {
    const selected = resolveWorkflowPackageRegistryEntry(config, selector);
    return selected.ok
      ? ok([selected.value])
      : err(packageFailure("INVALID_REGISTRY", selected.error.message));
  }
  return ok(config.registries);
}

async function resolveGitHubDirectoryRef(input: {
  readonly target: string;
  readonly branch?: string;
  readonly registry?: string;
  readonly config: WorkflowPackageRegistryConfig;
  readonly options?: WorkflowPackageTemporaryRunCheckoutInput["options"];
  readonly fetchImpl?: typeof fetch;
}): Promise<Result<GitHubDirectoryUrl, WorkflowPackageFailure>> {
  const parsedTree = parseGitHubDirectoryUrl(input.target);
  if (parsedTree.ok) {
    return ok(parsedTree.value);
  }
  const branchless = parseBranchlessGitHubDirectoryUrl(input.target);
  if (!branchless.ok) {
    return err(
      checkoutFailureToPackageFailure("invalid GitHub directory URL")(
        branchless.error,
      ),
    );
  }
  if (input.branch !== undefined) {
    return ok({ ...branchless.value, ref: input.branch });
  }
  const registeredDefaultBranch = resolveRegisteredDefaultBranch({
    branchless: branchless.value,
    config: input.config,
    ...(input.registry === undefined ? {} : { registry: input.registry }),
  });
  if (!registeredDefaultBranch.ok) {
    return registeredDefaultBranch;
  }
  if (registeredDefaultBranch.value !== undefined) {
    return ok({ ...branchless.value, ref: registeredDefaultBranch.value });
  }
  const defaultBranch = await fetchGitHubDefaultBranch({
    owner: branchless.value.owner,
    repository: branchless.value.repository,
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
  });
  return defaultBranch.ok
    ? ok({ ...branchless.value, ref: defaultBranch.value })
    : err(
        checkoutFailureToPackageFailure(
          "failed to resolve GitHub default branch",
        )(defaultBranch.error),
      );
}

function resolveRegisteredDefaultBranch(input: {
  readonly branchless: BranchlessGitHubDirectoryUrl;
  readonly registry?: string;
  readonly config: WorkflowPackageRegistryConfig;
}): Result<string | undefined, WorkflowPackageFailure> {
  const registries = selectRegistries(input.config, input.registry);
  if (!registries.ok) {
    return registries;
  }
  const match = registries.value.find((registry) => {
    const coordinates = registryRepositoryCoordinates(registry);
    return (
      coordinates !== undefined &&
      coordinates.owner === input.branchless.owner &&
      coordinates.repository === input.branchless.repository
    );
  });
  return ok(match?.defaultBranch);
}

function shorthandMatch(
  record: WorkflowPackageIndexRecord,
  workflowDir: string,
): boolean {
  const terminalSourcePath = record.sourcePath.split("/").at(-1);
  const terminalWorkflowDirectory = record.workflowDirectory.split("/").at(-1);
  return (
    record.packageName === workflowDir ||
    record.workflowId === workflowDir ||
    terminalSourcePath === workflowDir ||
    terminalWorkflowDirectory === workflowDir
  );
}

async function resolvePackageRecord(input: {
  readonly targetKind: "package-id" | "registered-shorthand";
  readonly target: string;
  readonly registry?: string;
  readonly branch?: string;
  readonly config: WorkflowPackageRegistryConfig;
  readonly options?: WorkflowPackageTemporaryRunCheckoutInput["options"];
}): Promise<
  Result<
    {
      readonly registry: WorkflowPackageRegistryEntry;
      readonly record: WorkflowPackageIndexRecord;
    },
    WorkflowPackageFailure
  >
> {
  if (input.targetKind === "package-id") {
    const registry = resolveWorkflowPackageRegistryEntry(
      input.config,
      input.registry,
    );
    if (!registry.ok) {
      return registry;
    }
    const searched = await searchWorkflowPackages({
      query: input.target,
      registry: registry.value.id,
      refresh: false,
      ...(input.branch === undefined ? {} : { branch: input.branch }),
      ...(input.options === undefined ? {} : { options: input.options }),
    });
    if (!searched.ok) {
      return searched;
    }
    const matches = searched.value.records.filter(
      (candidate) => candidate.packageName === input.target,
    );
    if (matches.length !== 1) {
      return err(
        packageFailure(
          matches.length === 0 ? "MISSING_PACKAGE" : "DUPLICATE_PACKAGE",
          matches.length === 0
            ? `package '${input.target}' not found`
            : `multiple registry packages match '${input.target}'; retry with --registry or --branch`,
        ),
      );
    }
    const match = matches[0];
    return match === undefined
      ? err(
          packageFailure(
            "MISSING_PACKAGE",
            `package '${input.target}' not found`,
          ),
        )
      : ok({ registry: registry.value, record: match });
  }

  const [owner, workflowDir] = input.target.split("/");
  if (owner === undefined || workflowDir === undefined) {
    return err(
      packageFailure(
        "INVALID_PACKAGE_NAME",
        `invalid registry shorthand '${input.target}'`,
      ),
    );
  }
  const registries = selectRegistries(input.config, input.registry);
  if (!registries.ok) {
    return registries;
  }
  const matches: {
    readonly registry: WorkflowPackageRegistryEntry;
    readonly record: WorkflowPackageIndexRecord;
  }[] = [];
  for (const registry of registries.value) {
    const coordinates = registryRepositoryCoordinates(registry);
    if (coordinates?.owner !== owner) {
      continue;
    }
    const searched = await searchWorkflowPackages({
      registry: registry.id,
      refresh: false,
      ...(input.branch === undefined ? {} : { branch: input.branch }),
      ...(input.options === undefined ? {} : { options: input.options }),
    });
    if (!searched.ok) {
      return searched;
    }
    for (const record of searched.value.records) {
      if (shorthandMatch(record, workflowDir)) {
        matches.push({ registry, record });
      }
    }
  }
  if (matches.length === 0) {
    return err(
      packageFailure(
        "MISSING_PACKAGE",
        `registry shorthand '${input.target}' did not match a registered workflow`,
      ),
    );
  }
  if (matches.length > 1) {
    const candidates = matches
      .map((match) => `${match.registry.id}:${match.record.packageName}`)
      .sort((left, right) => left.localeCompare(right))
      .join(", ");
    return err(
      packageFailure(
        "DUPLICATE_PACKAGE",
        `registry shorthand '${input.target}' is ambiguous; candidates: ${candidates}`,
      ),
    );
  }
  const match = matches[0];
  return match === undefined
    ? err(
        packageFailure(
          "MISSING_PACKAGE",
          `registry shorthand '${input.target}' did not match a registered workflow`,
        ),
      )
    : ok(match);
}

async function checkoutPackageTargetForTemporaryRun(input: {
  readonly target: string;
  readonly targetKind: "package-id" | "registered-shorthand";
  readonly registry?: string;
  readonly branch?: string;
  readonly options?: WorkflowPackageTemporaryRunCheckoutInput["options"];
  readonly config: WorkflowPackageRegistryConfig;
}): Promise<
  Result<WorkflowPackageTemporaryRunCheckoutResult, WorkflowPackageFailure>
> {
  const resolved = await resolvePackageRecord(input);
  if (!resolved.ok) {
    return resolved;
  }
  const { registry, record } = resolved.value;
  if (registry.localPath === undefined) {
    return err(
      packageFailure(
        "FETCH_FAILED",
        `registry '${registry.id}' has no localPath for temporary workflow run`,
      ),
    );
  }

  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-registry-run-"),
  );
  try {
    const sourcePackageRoot = path.join(registry.localPath, record.sourcePath);
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
      registry,
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
      targetKind: input.targetKind,
      packageStagingDirectory,
      provenance: {
        targetKind: input.targetKind,
        package: {
          originalTarget: input.target,
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
          integrityVerified: true,
          verification: "package-integrity",
          temporaryWorkflowDirectory,
        },
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

async function checkoutGitHubDirectoryForTemporaryRun(input: {
  readonly target: string;
  readonly registry?: string;
  readonly branch?: string;
  readonly options?: WorkflowPackageTemporaryRunCheckoutInput["options"];
  readonly config: WorkflowPackageRegistryConfig;
  readonly fetchImpl?: typeof fetch;
}): Promise<
  Result<WorkflowPackageTemporaryRunCheckoutResult, WorkflowPackageFailure>
> {
  const parsed = await resolveGitHubDirectoryRef(input);
  if (!parsed.ok) {
    return parsed;
  }
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "rielflow-registry-run-"),
  );
  try {
    const sourceUrl = buildGitHubTreeDirectoryUrl(parsed.value);
    const sourceDirectory = path.join(temporaryRoot, parsed.value.workflowName);
    const fetched = await fetchGitHubDirectoryToStaging({
      sourceUrl,
      destinationDirectory: sourceDirectory,
      ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
    });
    if (!fetched.ok) {
      await cleanupTemporaryRoot(temporaryRoot);
      return err(
        checkoutFailureToPackageFailure("GitHub directory checkout failed")(
          fetched.error,
        ),
      );
    }
    const resolved = fetched.value;
    const resolvedSourceUrl = buildGitHubTreeDirectoryUrl(resolved);
    const loaded = await loadWorkflowFromDisk(resolved.workflowName, {
      workflowRoot: path.dirname(sourceDirectory),
      ...(input.options?.cwd === undefined ? {} : { cwd: input.options.cwd }),
      ...(input.options?.env === undefined ? {} : { env: input.options.env }),
      ...(input.options?.userRoot === undefined
        ? {}
        : { userRoot: input.options.userRoot }),
    });
    if (!loaded.ok) {
      await cleanupTemporaryRoot(temporaryRoot);
      return err(
        packageFailure(
          "VALIDATION",
          `remote workflow validation failed: ${loaded.error.message}`,
        ),
      );
    }
    const workflowDefinitionDir = path.join(temporaryRoot, "workflows");
    const temporaryWorkflowDirectory = path.join(
      workflowDefinitionDir,
      loaded.value.workflowName,
    );
    await cp(sourceDirectory, temporaryWorkflowDirectory, { recursive: true });
    return ok({
      targetKind: "github-directory-url",
      workflowName: loaded.value.workflowName,
      workflowDefinitionDir,
      packageStagingDirectory: sourceDirectory,
      provenance: {
        targetKind: "github-directory-url",
        github: {
          originalTarget: input.target,
          owner: resolved.owner,
          repository: resolved.repository,
          ref: resolved.ref,
          directoryPath: resolved.directoryPath,
          sourceUrl: resolvedSourceUrl,
          sourcePath: resolved.directoryPath,
          sourceDirectory,
          temporaryWorkflowDirectory,
          verification: "workflow-bundle-only",
        },
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
        `temporary GitHub workflow checkout failed: ${message}`,
      ),
    );
  }
}

export async function checkoutWorkflowPackageForTemporaryRun(
  input: WorkflowPackageTemporaryRunCheckoutInput,
): Promise<
  Result<WorkflowPackageTemporaryRunCheckoutResult, WorkflowPackageFailure>
> {
  const target = input.target ?? input.packageName;
  if (target === undefined || target.trim().length === 0) {
    return err(
      packageFailure("INVALID_PACKAGE_NAME", "registry run target is required"),
    );
  }
  const config = await loadWorkflowPackageRegistryConfig(input.options);
  if (!config.ok) {
    return config;
  }
  const targetKind = classifyRegistryRunTarget(target);
  return targetKind === "github-directory-url"
    ? checkoutGitHubDirectoryForTemporaryRun({
        target,
        ...(input.registry === undefined ? {} : { registry: input.registry }),
        ...(input.branch === undefined ? {} : { branch: input.branch }),
        ...(input.options === undefined ? {} : { options: input.options }),
        config: config.value,
        ...(input.fetchImpl === undefined
          ? {}
          : { fetchImpl: input.fetchImpl }),
      })
    : checkoutPackageTargetForTemporaryRun({
        target,
        targetKind,
        ...(input.registry === undefined ? {} : { registry: input.registry }),
        ...(input.branch === undefined ? {} : { branch: input.branch }),
        ...(input.options === undefined ? {} : { options: input.options }),
        config: config.value,
      });
}
