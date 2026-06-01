import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadWorkflowFromDisk } from "../load";
import { resolveWorkflowCheckoutDestination } from "../checkout";
import { err, ok, type Result } from "../result";
import {
  loadWorkflowPackageRegistryConfig,
  resolveWorkflowPackageRegistryEntry,
} from "./registry-config";
import { searchWorkflowPackages } from "./search";
import type {
  WorkflowPackageDependencyEdge,
  WorkflowPackageDependencyIdentity,
  WorkflowPackageDependencyInstallResult,
  WorkflowPackageFailure,
  WorkflowPackageIndexRecord,
  WorkflowPackageRegistryConfigOptions,
  WorkflowPackageRegistryEntry,
} from "./types";
import type {
  WorkflowPackageCheckoutInput,
  WorkflowPackageCheckoutResult,
} from "./checkout";

export interface WorkflowPackageDependencyInstallContext {
  readonly stack: WorkflowPackageDependencyIdentity[];
  readonly dependencies: WorkflowPackageDependencyInstallResult[];
  readonly dependencyGraph: WorkflowPackageDependencyEdge[];
  readonly installedDependencies: WorkflowPackageCheckoutResult[];
  readonly dependencyMutationBackups: WorkflowPackageDependencyMutationBackup[];
}

export interface WorkflowPackageDependencyMutationBackup {
  readonly backupRoot: string;
  readonly backups: readonly {
    readonly targetPath: string;
    readonly backupPath?: string;
  }[];
}

function packageFailure(
  code: WorkflowPackageFailure["code"],
  message: string,
): WorkflowPackageFailure {
  return { code, message };
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

export function dependencyIdentity(input: {
  readonly packageId: string;
  readonly registryUrl: string;
  readonly sourceBranch: string;
  readonly sourcePath: string;
}): WorkflowPackageDependencyIdentity {
  return {
    packageId: input.packageId,
    registryUrl: input.registryUrl,
    sourceBranch: input.sourceBranch,
    sourcePath: input.sourcePath,
  };
}

function packageIdentityKey(identity: WorkflowPackageDependencyIdentity): string {
  return [
    identity.registryUrl,
    identity.sourceBranch,
    identity.sourcePath,
    identity.packageId,
  ].join("\0");
}

function formatPackageIdentityChain(
  identities: readonly WorkflowPackageDependencyIdentity[],
): string {
  return identities.map((identity) => identity.packageId).join(" -> ");
}

export function dependencyInstallResultFromCheckout(
  result: WorkflowPackageCheckoutResult,
): WorkflowPackageDependencyInstallResult {
  return {
    packageId: result.packageId,
    registryUrl: result.registryUrl,
    registryRef: result.registryRef,
    status: "installed",
    installId: result.installId,
    workflowName: result.workflowName,
    checkoutRecordPath: result.checkoutRecordPath,
  };
}

export async function resolvePackageCheckoutSearchRecord(input: {
  readonly packageId: string;
  readonly registry?: string;
  readonly branch?: string;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}): Promise<
  Result<
    {
      readonly registry: WorkflowPackageRegistryEntry & {
        readonly localPath: string;
      };
      readonly record: WorkflowPackageIndexRecord;
    },
    WorkflowPackageFailure
  >
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
        `registry '${registry.value.id}' has no localPath for checkout`,
      ),
    );
  }
  const searched = await searchWorkflowPackages({
    query: input.packageId,
    registry: registry.value.id,
    refresh: false,
    ...(input.branch === undefined ? {} : { branch: input.branch }),
    ...(input.options === undefined ? {} : { options: input.options }),
  });
  if (!searched.ok) {
    return searched;
  }
  const record = searched.value.records.find(
    (candidate) => candidate.packageName === input.packageId,
  );
  if (record === undefined) {
    return err(
      packageFailure(
        "MISSING_PACKAGE",
        `package '${input.packageId}' not found`,
      ),
    );
  }
  return ok({
    registry: registry.value as WorkflowPackageRegistryEntry & {
      readonly localPath: string;
    },
    record,
  });
}

async function listPackageCheckoutRecordFiles(input: {
  readonly userRoot: string;
}): Promise<
  readonly {
    readonly path: string;
    readonly record: Readonly<Record<string, unknown>>;
  }[]
> {
  const checkoutRoot = path.join(
    input.userRoot,
    "workflow-registry",
    "checkouts",
  );
  try {
    const entries = await readdir(checkoutRoot, { withFileTypes: true });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const recordPath = path.join(checkoutRoot, entry.name);
          const record = await readJsonRecord(recordPath);
          return record?.["checkoutKind"] === "package"
            ? { path: recordPath, record }
            : undefined;
        }),
    );
    return records.filter(
      (
        record,
      ): record is {
        readonly path: string;
        readonly record: Readonly<Record<string, unknown>>;
      } => record !== undefined,
    );
  } catch {
    return [];
  }
}

async function findSatisfiedDependency(input: {
  readonly identity: WorkflowPackageDependencyIdentity;
  readonly workflowName: string;
  readonly userRoot: string;
  readonly options?: WorkflowPackageRegistryConfigOptions;
  readonly userScope?: boolean;
}): Promise<WorkflowPackageDependencyInstallResult | undefined> {
  const destination = resolveWorkflowCheckoutDestination(input.workflowName, {
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
  });
  if (!destination.ok) {
    return undefined;
  }
  const records = await listPackageCheckoutRecordFiles({
    userRoot: input.userRoot,
  });
  const matched = records.find(({ record }) => {
    return (
      recordString(record, "packageId") === input.identity.packageId &&
      recordString(record, "registryUrl") === input.identity.registryUrl &&
      recordString(record, "registryRef") === input.identity.sourceBranch &&
      recordString(record, "sourcePath") === input.identity.sourcePath &&
      recordString(record, "scope") === destination.value.scope &&
      recordString(record, "workflowName") === input.workflowName &&
      recordString(record, "destinationDirectory") ===
        destination.value.workflowDirectory
    );
  });
  if (matched === undefined) {
    return undefined;
  }
  const loaded = await loadWorkflowFromDisk(input.workflowName, {
    workflowRoot: destination.value.workflowRoot,
    ...(input.options?.cwd === undefined ? {} : { cwd: input.options.cwd }),
    ...(input.options?.env === undefined ? {} : { env: input.options.env }),
    ...(input.options?.userRoot === undefined
      ? {}
      : { userRoot: input.options.userRoot }),
  });
  if (!loaded.ok) {
    return undefined;
  }
  const installId = recordString(matched.record, "installId");
  return {
    packageId: input.identity.packageId,
    registryUrl: input.identity.registryUrl,
    registryRef: input.identity.sourceBranch,
    status: "already-installed",
    ...(installId === undefined ? {} : { installId }),
    workflowName: input.workflowName,
    checkoutRecordPath: matched.path,
  };
}

export async function installManifestDependencies(input: {
  readonly parent: WorkflowPackageDependencyIdentity;
  readonly manifestDependencies: readonly {
    readonly packageId: string;
    readonly registry?: string;
    readonly branch?: string;
  }[];
  readonly checkoutInput: WorkflowPackageCheckoutInput;
  readonly userRoot: string;
  readonly context: WorkflowPackageDependencyInstallContext;
  readonly checkoutDependency: (
    dependencyInput: WorkflowPackageCheckoutInput,
    context: WorkflowPackageDependencyInstallContext,
  ) => Promise<Result<WorkflowPackageCheckoutResult, WorkflowPackageFailure>>;
}): Promise<Result<void, WorkflowPackageFailure>> {
  for (const dependency of input.manifestDependencies) {
    const dependencyRegistry =
      dependency.registry ?? input.checkoutInput.registry;
    const resolved = await resolvePackageCheckoutSearchRecord({
      packageId: dependency.packageId,
      ...(dependencyRegistry === undefined
        ? {}
        : { registry: dependencyRegistry }),
      ...(dependency.branch === undefined ? {} : { branch: dependency.branch }),
      ...(input.checkoutInput.options === undefined
        ? {}
        : { options: input.checkoutInput.options }),
    });
    if (!resolved.ok) {
      return resolved;
    }
    const identity = dependencyIdentity({
      packageId: resolved.value.record.packageName,
      registryUrl: resolved.value.record.registryUrl,
      sourceBranch: resolved.value.record.sourceBranch,
      sourcePath: resolved.value.record.sourcePath,
    });
    input.context.dependencyGraph.push({ from: input.parent, to: identity });
    const existingIndex = input.context.stack.findIndex(
      (candidate) =>
        packageIdentityKey(candidate) === packageIdentityKey(identity),
    );
    if (existingIndex >= 0) {
      const chain = [...input.context.stack.slice(existingIndex), identity];
      return err(
        packageFailure(
          "VALIDATION",
          `package dependency cycle detected: ${formatPackageIdentityChain(chain)}`,
        ),
      );
    }
    const satisfied = await findSatisfiedDependency({
      identity,
      workflowName: resolved.value.record.workflowId,
      userRoot: input.userRoot,
      ...(input.checkoutInput.options === undefined
        ? {}
        : { options: input.checkoutInput.options }),
      ...(input.checkoutInput.userScope === undefined
        ? {}
        : { userScope: input.checkoutInput.userScope }),
    });
    if (satisfied !== undefined) {
      input.context.dependencies.push(satisfied);
      continue;
    }
    const dependencyInput: WorkflowPackageCheckoutInput = {
      packageName: dependency.packageId,
      packageId: dependency.packageId,
      ...(dependencyRegistry === undefined
        ? {}
        : { registry: dependencyRegistry }),
      ...(dependency.branch === undefined ? {} : { branch: dependency.branch }),
      ...(input.checkoutInput.userScope === undefined
        ? {}
        : { userScope: input.checkoutInput.userScope }),
      ...(input.checkoutInput.overwrite === undefined
        ? {}
        : { overwrite: input.checkoutInput.overwrite }),
      ...(input.checkoutInput.yes === undefined
        ? {}
        : { yes: input.checkoutInput.yes }),
      ...(input.checkoutInput.preInstallCheck === undefined
        ? {}
        : { preInstallCheck: input.checkoutInput.preInstallCheck }),
      ...(input.checkoutInput.preInstallCheckMode === undefined
        ? {}
        : { preInstallCheckMode: input.checkoutInput.preInstallCheckMode }),
      ...(input.checkoutInput.preInstallCheckContainer === undefined
        ? {}
        : {
            preInstallCheckContainer:
              input.checkoutInput.preInstallCheckContainer,
          }),
      ...(input.checkoutInput.options === undefined
        ? {}
        : { options: input.checkoutInput.options }),
    };
    const checkedOut = await input.checkoutDependency(
      dependencyInput,
      {
        ...input.context,
        stack: [...input.context.stack, identity],
      },
    );
    if (!checkedOut.ok) {
      return checkedOut;
    }
    input.context.installedDependencies.push(checkedOut.value);
    input.context.dependencies.push(
      dependencyInstallResultFromCheckout(checkedOut.value),
    );
  }
  return ok(undefined);
}
