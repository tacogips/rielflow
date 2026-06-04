import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  resolveUserScopeRootForCheckout,
  type WorkflowCheckoutScope,
} from "../checkout";
import { resolveConfiguredRootPath } from "../paths";
import { err, ok, type Result } from "../result";
import {
  checkoutWorkflowPackage,
  type WorkflowPackageCheckoutResult,
} from "./checkout";
import {
  createNoopWorkflowPackageUpdateResult,
  resolveWorkflowPackageCheckoutStatus,
} from "./status";
import type {
  WorkflowPackageAddonInstallTarget,
  WorkflowPackageFailure,
  WorkflowPackageKind,
  WorkflowPackageRegistryConfigOptions,
  WorkflowPackageSkillInstallTarget,
} from "./types";

export interface WorkflowPackageInstalledRecord {
  readonly installId: string;
  readonly packageKind: WorkflowPackageKind;
  readonly packageId: string;
  readonly packageName: string;
  readonly workflowName: string;
  readonly scope: WorkflowCheckoutScope;
  readonly destinationDirectory: string;
  readonly checkoutRecordPath: string;
  readonly checkedOutAt?: string;
  readonly version?: string;
  readonly packageVersion?: string;
  readonly packageHash?: string;
  readonly checksum?: string;
  readonly checksumAlgorithm?: string;
  readonly contentDigest?: string;
  readonly integrityDigest?: string;
  readonly registryUrl?: string;
  readonly registryRef?: string;
  readonly sourceUrl?: string;
  readonly skills: readonly WorkflowPackageSkillInstallTarget[];
  readonly addons: readonly WorkflowPackageAddonInstallTarget[];
}

export interface RawWorkflowCheckoutInstalledRecord {
  readonly installType: "workflow-checkout";
  readonly workflowName: string;
  readonly scope: WorkflowCheckoutScope;
  readonly destinationDirectory: string;
  readonly checkoutRecordPath: string;
  readonly suggestedCommands: readonly string[];
  readonly sourceUrl: string;
  readonly contentDigestAlgorithm: "sha256";
  readonly contentDigest: string;
  readonly checkedOutAt?: string;
}

export interface RawWorkflowCheckoutStatus
  extends RawWorkflowCheckoutInstalledRecord {
  readonly status: "workflow-checkout";
  readonly managedBy: "workflow checkout";
  readonly packageManaged: false;
}

export interface WorkflowPackageListResult {
  readonly packages: readonly WorkflowPackageInstalledRecord[];
  readonly workflowCheckouts: readonly RawWorkflowCheckoutInstalledRecord[];
}

export interface WorkflowPackageRemoveResult {
  readonly installId: string;
  readonly packageKind: WorkflowPackageKind;
  readonly packageId: string;
  readonly workflowName: string;
  readonly scope: WorkflowCheckoutScope;
  readonly removedPaths: readonly string[];
  readonly skippedPaths: readonly string[];
  readonly checkoutRecordPath: string;
}

export interface WorkflowPackageMissingRegistryRemovalResult
  extends WorkflowPackageRemoveResult {
  readonly updated: true;
  readonly removed: true;
  readonly packageMissingFromRegistry: true;
  readonly removalConfirmed: true;
}

export type WorkflowPackageUpdateResult =
  | WorkflowPackageCheckoutResult
  | WorkflowPackageMissingRegistryRemovalResult;

function packageFailure(
  code: WorkflowPackageFailure["code"],
  message: string,
): WorkflowPackageFailure {
  return { code, message };
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

async function listPackageCheckoutRecords(input: {
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

async function listRawWorkflowCheckoutRecords(input: {
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
          return record !== undefined && record["checkoutKind"] !== "package"
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

function resolveStatusProjectRootIdentity(
  options: WorkflowPackageRegistryConfigOptions | undefined,
): string {
  if (options?.projectRoot !== undefined) {
    return path.resolve(options.projectRoot);
  }
  if (options?.cwd !== undefined) {
    return path.resolve(options.cwd);
  }
  return process.cwd();
}

function workflowDefinitionDirOverride(
  options: WorkflowPackageRegistryConfigOptions | undefined,
): string | undefined {
  return options?.workflowRoot === undefined
    ? undefined
    : resolveConfiguredRootPath(options.workflowRoot, options);
}

function recordScope(
  record: Readonly<Record<string, unknown>>,
): WorkflowCheckoutScope | undefined {
  const scope = recordString(record, "scope");
  return scope === "project" || scope === "user" ? scope : undefined;
}

function recordSkills(
  record: Readonly<Record<string, unknown>>,
): readonly WorkflowPackageSkillInstallTarget[] {
  return recordArray(record, "skills").filter(
    (entry): entry is WorkflowPackageSkillInstallTarget => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return false;
      }
      const skillRecord = entry as Readonly<Record<string, unknown>>;
      return (
        recordString(skillRecord, "vendor") !== undefined &&
        recordString(skillRecord, "name") !== undefined &&
        recordString(skillRecord, "sourcePath") !== undefined &&
        recordString(skillRecord, "checksum") !== undefined &&
        recordString(skillRecord, "managedPath") !== undefined &&
        recordString(skillRecord, "installMode") !== undefined
      );
    },
  );
}

function recordAddons(
  record: Readonly<Record<string, unknown>>,
): readonly WorkflowPackageAddonInstallTarget[] {
  return recordArray(record, "addons").filter(
    (entry): entry is WorkflowPackageAddonInstallTarget => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return false;
      }
      const addonRecord = entry as Readonly<Record<string, unknown>>;
      return (
        recordString(addonRecord, "addonName") !== undefined &&
        recordString(addonRecord, "addonVersion") !== undefined &&
        recordString(addonRecord, "destinationDirectory") !== undefined &&
        recordString(addonRecord, "manifestPath") !== undefined &&
        recordString(addonRecord, "contentDigest") !== undefined
      );
    },
  );
}

function integrityRecordDigest(
  record: Readonly<Record<string, unknown>>,
): string | undefined {
  const integrity = record["integrity"];
  if (
    typeof integrity !== "object" ||
    integrity === null ||
    Array.isArray(integrity)
  ) {
    return undefined;
  }
  return recordString(integrity as Readonly<Record<string, unknown>>, "digest");
}

function toInstalledPackageRecord(input: {
  readonly path: string;
  readonly record: Readonly<Record<string, unknown>>;
}): WorkflowPackageInstalledRecord | undefined {
  const installId = recordString(input.record, "installId");
  const packageKindRaw = recordString(input.record, "packageKind");
  const packageKind =
    packageKindRaw === "node-addon" ? "node-addon" : "workflow";
  const packageId = recordString(input.record, "packageId");
  const packageName = recordString(input.record, "packageName") ?? packageId;
  const workflowName = recordString(input.record, "workflowName");
  const scope = recordScope(input.record);
  const destinationDirectory = recordString(
    input.record,
    "destinationDirectory",
  );
  if (
    installId === undefined ||
    packageId === undefined ||
    packageName === undefined ||
    workflowName === undefined ||
    scope === undefined ||
    destinationDirectory === undefined
  ) {
    return undefined;
  }
  const version = recordString(input.record, "version");
  const checkedOutAt = recordString(input.record, "checkedOutAt");
  const packageHash = recordString(input.record, "packageHash");
  const checksum = recordString(input.record, "checksum");
  const checksumAlgorithm = recordString(input.record, "checksumAlgorithm");
  const contentDigest = recordString(input.record, "contentDigest");
  const integrityDigest = integrityRecordDigest(input.record);
  const registryUrl = recordString(input.record, "registryUrl");
  const registryRef = recordString(input.record, "registryRef");
  const sourceUrl = recordString(input.record, "sourceUrl");
  return {
    installId,
    packageKind,
    packageId,
    packageName,
    workflowName,
    scope,
    destinationDirectory,
    checkoutRecordPath: input.path,
    ...(checkedOutAt === undefined ? {} : { checkedOutAt }),
    ...(version === undefined ? {} : { version, packageVersion: version }),
    ...(packageHash === undefined ? {} : { packageHash }),
    ...(checksum === undefined ? {} : { checksum }),
    ...(checksumAlgorithm === undefined ? {} : { checksumAlgorithm }),
    ...(contentDigest === undefined ? {} : { contentDigest }),
    ...(integrityDigest === undefined ? {} : { integrityDigest }),
    ...(registryUrl === undefined ? {} : { registryUrl }),
    ...(registryRef === undefined ? {} : { registryRef }),
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    skills: recordSkills(input.record),
    addons: recordAddons(input.record),
  };
}

function workflowCheckoutSuggestedCommands(input: {
  readonly workflowName: string;
  readonly scope: WorkflowCheckoutScope;
}): readonly string[] {
  return [
    `rielflow workflow usage ${input.workflowName} --scope ${input.scope}`,
    input.scope === "user"
      ? "rielflow package install <package-id> --user-scope"
      : "rielflow package install <package-id>",
  ];
}

function toRawWorkflowCheckoutRecord(input: {
  readonly path: string;
  readonly record: Readonly<Record<string, unknown>>;
}): RawWorkflowCheckoutInstalledRecord | undefined {
  const workflowName = recordString(input.record, "workflowName");
  const scope = recordScope(input.record);
  const destinationDirectory = recordString(
    input.record,
    "destinationDirectory",
  );
  if (
    workflowName === undefined ||
    scope === undefined ||
    destinationDirectory === undefined
  ) {
    return undefined;
  }
  const sourceUrl = recordString(input.record, "sourceUrl");
  const contentDigestAlgorithm = recordString(
    input.record,
    "contentDigestAlgorithm",
  );
  const contentDigest = recordString(input.record, "contentDigest");
  if (
    sourceUrl === undefined ||
    contentDigestAlgorithm !== "sha256" ||
    contentDigest === undefined
  ) {
    return undefined;
  }
  const checkedOutAt = recordString(input.record, "checkedOutAt");
  return {
    installType: "workflow-checkout",
    workflowName,
    scope,
    destinationDirectory,
    checkoutRecordPath: input.path,
    sourceUrl,
    contentDigestAlgorithm: "sha256",
    contentDigest,
    ...(checkedOutAt === undefined ? {} : { checkedOutAt }),
    suggestedCommands: workflowCheckoutSuggestedCommands({
      workflowName,
      scope,
    }),
  };
}

function matchesPackageCheckoutRecord(input: {
  readonly record: Readonly<Record<string, unknown>>;
  readonly workflowName?: string;
  readonly installId?: string;
  readonly scope?: WorkflowCheckoutScope;
  readonly currentProjectRootIdentity: string;
  readonly currentWorkflowDefinitionDir?: string;
}): boolean {
  if (input.installId !== undefined) {
    return recordString(input.record, "installId") === input.installId;
  }
  if (
    input.workflowName !== undefined &&
    recordString(input.record, "workflowName") !== input.workflowName &&
    recordString(input.record, "packageId") !== input.workflowName &&
    recordString(input.record, "packageName") !== input.workflowName
  ) {
    return false;
  }
  const scope = recordString(input.record, "scope");
  if (input.scope !== undefined && scope !== input.scope) {
    return false;
  }
  if (scope !== "project") {
    return true;
  }
  const recordProjectRootIdentity = recordString(
    input.record,
    "projectRootIdentity",
  );
  if (
    recordProjectRootIdentity !== undefined &&
    recordProjectRootIdentity !== input.currentProjectRootIdentity
  ) {
    return false;
  }
  const recordWorkflowDefinitionDir = recordString(
    input.record,
    "workflowDefinitionDirOverride",
  );
  return (
    input.currentWorkflowDefinitionDir === undefined ||
    recordWorkflowDefinitionDir === undefined ||
    recordWorkflowDefinitionDir === input.currentWorkflowDefinitionDir
  );
}

function matchPackageCheckoutRecords(input: {
  readonly workflowName?: string;
  readonly installId?: string;
  readonly scope?: WorkflowCheckoutScope;
  readonly options?: WorkflowPackageRegistryConfigOptions;
  readonly records: readonly {
    readonly path: string;
    readonly record: Readonly<Record<string, unknown>>;
  }[];
}): readonly {
  readonly path: string;
  readonly record: Readonly<Record<string, unknown>>;
}[] {
  const currentProjectRootIdentity = resolveStatusProjectRootIdentity(
    input.options,
  );
  const currentWorkflowDefinitionDir = workflowDefinitionDirOverride(
    input.options,
  );
  return input.records.filter(({ record }) =>
    matchesPackageCheckoutRecord({
      record,
      ...(input.workflowName === undefined
        ? {}
        : { workflowName: input.workflowName }),
      ...(input.installId === undefined ? {} : { installId: input.installId }),
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      currentProjectRootIdentity,
      ...(currentWorkflowDefinitionDir === undefined
        ? {}
        : { currentWorkflowDefinitionDir }),
    }),
  );
}

function matchesRawWorkflowCheckoutRecord(input: {
  readonly record: Readonly<Record<string, unknown>>;
  readonly workflowName?: string;
  readonly scope?: WorkflowCheckoutScope;
  readonly currentProjectRootIdentity: string;
  readonly currentWorkflowDefinitionDir?: string;
}): boolean {
  if (
    input.workflowName !== undefined &&
    recordString(input.record, "workflowName") !== input.workflowName
  ) {
    return false;
  }
  const scope = recordString(input.record, "scope");
  if (input.scope !== undefined && scope !== input.scope) {
    return false;
  }
  if (scope !== "project") {
    return true;
  }
  const recordProjectRootIdentity = recordString(
    input.record,
    "projectRootIdentity",
  );
  if (
    recordProjectRootIdentity !== undefined &&
    recordProjectRootIdentity !== input.currentProjectRootIdentity
  ) {
    return false;
  }
  const recordWorkflowDefinitionDir = recordString(
    input.record,
    "workflowDefinitionDirOverride",
  );
  return (
    input.currentWorkflowDefinitionDir === undefined ||
    recordWorkflowDefinitionDir === undefined ||
    recordWorkflowDefinitionDir === input.currentWorkflowDefinitionDir
  );
}

function matchRawWorkflowCheckoutRecords(input: {
  readonly workflowName?: string;
  readonly scope?: WorkflowCheckoutScope;
  readonly options?: WorkflowPackageRegistryConfigOptions;
  readonly records: readonly {
    readonly path: string;
    readonly record: Readonly<Record<string, unknown>>;
  }[];
}): readonly {
  readonly path: string;
  readonly record: Readonly<Record<string, unknown>>;
}[] {
  const currentProjectRootIdentity = resolveStatusProjectRootIdentity(
    input.options,
  );
  const currentWorkflowDefinitionDir = workflowDefinitionDirOverride(
    input.options,
  );
  return input.records.filter(({ record }) =>
    matchesRawWorkflowCheckoutRecord({
      record,
      ...(input.workflowName === undefined
        ? {}
        : { workflowName: input.workflowName }),
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      currentProjectRootIdentity,
      ...(currentWorkflowDefinitionDir === undefined
        ? {}
        : { currentWorkflowDefinitionDir }),
    }),
  );
}

function rawCheckoutAmbiguityMessage(
  records: readonly {
    readonly path: string;
    readonly record: Readonly<Record<string, unknown>>;
  }[],
): string {
  const paths = records.map((record) => record.path).join(", ");
  return `multiple raw workflow checkout records match; retry with a narrower --scope or --workflow-definition-dir (${paths})`;
}

function toRawWorkflowCheckoutStatus(
  record: RawWorkflowCheckoutInstalledRecord,
): RawWorkflowCheckoutStatus {
  return {
    ...record,
    status: "workflow-checkout",
    managedBy: "workflow checkout",
    packageManaged: false,
  };
}

export async function getWorkflowPackageCheckoutStatus(input: {
  readonly workflowName?: string;
  readonly installId?: string;
  readonly scope?: WorkflowCheckoutScope;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}): Promise<Result<Readonly<Record<string, unknown>>, WorkflowPackageFailure>> {
  const userRoot = resolveUserScopeRootForCheckout(input.options ?? {});
  const matched = matchPackageCheckoutRecords({
    ...(input.workflowName === undefined
      ? {}
      : { workflowName: input.workflowName }),
    ...(input.installId === undefined ? {} : { installId: input.installId }),
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(input.options === undefined ? {} : { options: input.options }),
    records: await listPackageCheckoutRecords({ userRoot }),
  });
  if (matched.length === 0) {
    const rawMatched =
      input.installId === undefined
        ? matchRawWorkflowCheckoutRecords({
            ...(input.workflowName === undefined
              ? {}
              : { workflowName: input.workflowName }),
            ...(input.scope === undefined ? {} : { scope: input.scope }),
            ...(input.options === undefined ? {} : { options: input.options }),
            records: await listRawWorkflowCheckoutRecords({ userRoot }),
          })
        : [];
    if (rawMatched.length === 1) {
      const rawRecord =
        rawMatched[0] === undefined
          ? undefined
          : toRawWorkflowCheckoutRecord(rawMatched[0]);
      if (rawRecord !== undefined) {
        return ok(
          toRawWorkflowCheckoutStatus(rawRecord) as unknown as Readonly<
            Record<string, unknown>
          >,
        );
      }
    }
    if (rawMatched.length > 1) {
      return err(
        packageFailure("USAGE", rawCheckoutAmbiguityMessage(rawMatched)),
      );
    }
    return err(
      packageFailure(
        "MISSING_PACKAGE",
        "no package checkout record or raw workflow checkout record found",
      ),
    );
  }
  if (matched.length > 1) {
    return err(
      packageFailure(
        "DUPLICATE_PACKAGE",
        "multiple package checkout records match; retry with --install-id",
      ),
    );
  }
  const record = matched[0];
  if (record === undefined) {
    return err(
      packageFailure(
        "MISSING_PACKAGE",
        "no package checkout record or raw workflow checkout record found",
      ),
    );
  }
  return resolveWorkflowPackageCheckoutStatus({
    record: record.record,
    checkoutRecordPath: record.path,
    ...(input.options === undefined ? {} : { options: input.options }),
  });
}

export async function listWorkflowPackageCheckouts(input: {
  readonly scope?: WorkflowCheckoutScope;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}): Promise<Result<WorkflowPackageListResult, WorkflowPackageFailure>> {
  const userRoot = resolveUserScopeRootForCheckout(input.options ?? {});
  const packageRecords = matchPackageCheckoutRecords({
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(input.options === undefined ? {} : { options: input.options }),
    records: await listPackageCheckoutRecords({ userRoot }),
  });
  const rawRecords = matchRawWorkflowCheckoutRecords({
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(input.options === undefined ? {} : { options: input.options }),
    records: await listRawWorkflowCheckoutRecords({ userRoot }),
  });
  const packages = packageRecords
    .map(toInstalledPackageRecord)
    .filter(
      (record): record is WorkflowPackageInstalledRecord =>
        record !== undefined,
    )
    .sort((left, right) =>
      `${left.scope}:${left.packageId}:${left.workflowName}:${left.installId}`.localeCompare(
        `${right.scope}:${right.packageId}:${right.workflowName}:${right.installId}`,
      ),
    );
  const workflowCheckouts = rawRecords
    .map(toRawWorkflowCheckoutRecord)
    .filter(
      (record): record is RawWorkflowCheckoutInstalledRecord =>
        record !== undefined,
    )
    .sort((left, right) =>
      `${left.scope}:${left.workflowName}:${left.destinationDirectory}`.localeCompare(
        `${right.scope}:${right.workflowName}:${right.destinationDirectory}`,
      ),
    );
  return ok({ packages, workflowCheckouts });
}

async function removeRecordedPackagePath(input: {
  readonly path: string | undefined;
  readonly removedPaths: string[];
}): Promise<void> {
  if (input.path === undefined) {
    return;
  }
  await removePathIfPresent(input.path);
  input.removedPaths.push(input.path);
}

export async function removeWorkflowPackageCheckout(input: {
  readonly workflowName?: string;
  readonly installId?: string;
  readonly scope?: WorkflowCheckoutScope;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}): Promise<Result<WorkflowPackageRemoveResult, WorkflowPackageFailure>> {
  if (input.workflowName === undefined && input.installId === undefined) {
    return err(
      packageFailure(
        "USAGE",
        "package remove requires a workflow name or --install-id",
      ),
    );
  }
  const userRoot = resolveUserScopeRootForCheckout(input.options ?? {});
  const matched = matchPackageCheckoutRecords({
    ...(input.workflowName === undefined
      ? {}
      : { workflowName: input.workflowName }),
    ...(input.installId === undefined ? {} : { installId: input.installId }),
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(input.options === undefined ? {} : { options: input.options }),
    records: await listPackageCheckoutRecords({ userRoot }),
  });
  if (matched.length === 0) {
    if (input.installId === undefined) {
      const rawMatched = matchRawWorkflowCheckoutRecords({
        ...(input.workflowName === undefined
          ? {}
          : { workflowName: input.workflowName }),
        ...(input.scope === undefined ? {} : { scope: input.scope }),
        ...(input.options === undefined ? {} : { options: input.options }),
        records: await listRawWorkflowCheckoutRecords({ userRoot }),
      });
      if (rawMatched.length > 0) {
        const workflowName = input.workflowName ?? "<workflow-name>";
        const scopeHint =
          input.scope === undefined ? "" : ` --scope ${input.scope}`;
        return err(
          packageFailure(
            "NOT_PACKAGE_CHECKOUT",
            `not-package-checkout: '${workflowName}' is a raw workflow checkout, not a registry package install; use rielflow workflow usage ${workflowName}${scopeHint} or install through rielflow package install for package lifecycle commands`,
          ),
        );
      }
    }
    return err(
      packageFailure(
        "MISSING_PACKAGE",
        "no package checkout record or raw workflow checkout record found",
      ),
    );
  }
  if (matched.length > 1) {
    return err(
      packageFailure(
        "DUPLICATE_PACKAGE",
        "multiple package checkout records match; retry with --install-id",
      ),
    );
  }
  const matchedRecord = matched[0];
  if (matchedRecord === undefined) {
    return err(
      packageFailure(
        "MISSING_PACKAGE",
        "no package checkout record or raw workflow checkout record found",
      ),
    );
  }
  const installed = toInstalledPackageRecord(matchedRecord);
  if (installed === undefined) {
    return err(
      packageFailure("INVALID_MANIFEST", "package checkout record is invalid"),
    );
  }
  const removedPaths: string[] = [];
  const skippedPaths: string[] = [];
  try {
    if (installed.packageKind === "node-addon") {
      for (const addon of installed.addons) {
        await removeRecordedPackagePath({
          path: addon.destinationDirectory,
          removedPaths,
        });
      }
    } else {
      for (const skill of installed.skills) {
        await removeRecordedPackagePath({
          path: skill.projectionPath,
          removedPaths,
        });
        await removeRecordedPackagePath({
          path: skill.managedPath,
          removedPaths,
        });
      }
      await removeRecordedPackagePath({
        path: recordString(matchedRecord.record, "managedSkillRoot"),
        removedPaths,
      });
      await removeRecordedPackagePath({
        path: path.join(
          installed.destinationDirectory,
          ".rielflow-package-provenance.json",
        ),
        removedPaths,
      });
      await removeRecordedPackagePath({
        path: installed.destinationDirectory,
        removedPaths,
      });
    }
    await removeRecordedPackagePath({
      path: matchedRecord.path,
      removedPaths,
    });
    return ok({
      installId: installed.installId,
      packageKind: installed.packageKind,
      packageId: installed.packageId,
      workflowName: installed.workflowName,
      scope: installed.scope,
      removedPaths,
      skippedPaths,
      checkoutRecordPath: matchedRecord.path,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(packageFailure("IO", `package remove failed: ${message}`));
  }
}

export async function updateWorkflowPackageCheckout(input: {
  readonly workflowName?: string;
  readonly installId?: string;
  readonly scope?: WorkflowCheckoutScope;
  readonly yes?: boolean;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}): Promise<Result<WorkflowPackageUpdateResult, WorkflowPackageFailure>> {
  const status = await getWorkflowPackageCheckoutStatus(input);
  if (!status.ok) {
    return status;
  }
  if (status.value["installType"] === "workflow-checkout") {
    return err(
      packageFailure(
        "NOT_PACKAGE_CHECKOUT",
        "not-package-checkout: raw workflow checkouts are not package-managed; use workflow commands or install through rielflow package install",
      ),
    );
  }
  if (status.value["status"] === "missing-source-package") {
    if (input.yes !== true) {
      return err(
        packageFailure(
          "UPDATE_CONFIRMATION_REQUIRED",
          "package was removed from the registry; confirm removal before deleting the local checkout",
        ),
      );
    }
    const removed = await removeWorkflowPackageCheckout({
      ...(input.workflowName === undefined
        ? {}
        : { workflowName: input.workflowName }),
      ...(input.installId === undefined ? {} : { installId: input.installId }),
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      ...(input.options === undefined ? {} : { options: input.options }),
    });
    if (!removed.ok) {
      return removed;
    }
    return ok({
      ...removed.value,
      updated: true,
      removed: true,
      packageMissingFromRegistry: true,
      removalConfirmed: true,
    });
  }
  if (status.value["updateAvailable"] !== true) {
    return ok(createNoopWorkflowPackageUpdateResult(status.value));
  }
  const packageName = recordString(status.value, "packageId");
  if (packageName === undefined) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        "package checkout record is missing packageId",
      ),
    );
  }
  const registry = recordString(status.value, "registryUrl");
  const branch = recordString(status.value, "registryRef");
  const projectRootIdentity = recordString(status.value, "projectRootIdentity");
  const workflowDefinitionDir = recordString(
    status.value,
    "workflowDefinitionDirOverride",
  );
  const options = {
    ...(input.options ?? {}),
    ...(projectRootIdentity === undefined ? {} : { cwd: projectRootIdentity }),
    ...(workflowDefinitionDir === undefined
      ? {}
      : { workflowRoot: workflowDefinitionDir }),
  };
  return checkoutWorkflowPackage({
    packageName,
    packageId: packageName,
    ...(registry === undefined ? {} : { registry }),
    ...(branch === undefined ? {} : { branch }),
    overwrite: true,
    yes: true,
    userScope: recordString(status.value, "scope") === "user",
    options,
  });
}
