import path from "node:path";
import type { WorkflowCheckoutScope } from "../checkout";
import { ok, type Result } from "../result";
import { searchWorkflowPackages } from "./search";
import type { WorkflowPackageCheckoutResult } from "./checkout";
import type {
  WorkflowPackageFailure,
  WorkflowPackageRegistryConfigOptions,
  WorkflowPackageSkillInstallTarget,
} from "./types";

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

function integrityDigest(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const digest = (value as Readonly<Record<string, unknown>>)["digest"];
  return typeof digest === "string" ? digest : undefined;
}

function installedArtifacts(
  record: Readonly<Record<string, unknown>>,
  checkoutRecordPath: string,
): readonly Readonly<Record<string, unknown>>[] {
  const artifacts: Readonly<Record<string, unknown>>[] = [
    {
      kind: "workflow",
      destination: recordString(record, "destinationDirectory"),
      sourcePath: recordString(record, "workflowDirectory"),
      checksum: recordString(record, "checksum"),
    },
    {
      kind: "provenance",
      destination: path.join(
        recordString(record, "destinationDirectory") ?? "",
        ".rielflow-package-provenance.json",
      ),
      sourcePath: checkoutRecordPath,
    },
  ];
  for (const skill of recordArray(record, "skills")) {
    if (typeof skill !== "object" || skill === null || Array.isArray(skill)) {
      continue;
    }
    const skillRecord = skill as Readonly<Record<string, unknown>>;
    artifacts.push({
      kind: "skill",
      vendor: recordString(skillRecord, "vendor"),
      name: recordString(skillRecord, "name"),
      managedPath: recordString(skillRecord, "managedPath"),
      projectionPath: recordString(skillRecord, "projectionPath"),
      sourcePath: recordString(skillRecord, "sourcePath"),
      checksum: recordString(skillRecord, "checksum"),
    });
  }
  return artifacts;
}

function changedArtifacts(input: {
  readonly installedVersion: string | undefined;
  readonly availableVersion: string | undefined;
  readonly installedChecksum: string | undefined;
  readonly availableChecksum: string | undefined;
  readonly installedIntegrityDigest: string | undefined;
  readonly availableIntegrityDigest: string | undefined;
}): readonly string[] {
  const changed: string[] = [];
  if (input.installedVersion !== input.availableVersion) {
    changed.push("version");
  }
  if (input.installedChecksum !== input.availableChecksum) {
    changed.push("checksum");
  }
  if (input.installedIntegrityDigest !== input.availableIntegrityDigest) {
    changed.push("integrity");
  }
  return changed;
}

export async function resolveWorkflowPackageCheckoutStatus(input: {
  readonly record: Readonly<Record<string, unknown>>;
  readonly checkoutRecordPath: string;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}): Promise<Result<Readonly<Record<string, unknown>>, WorkflowPackageFailure>> {
  const packageId = recordString(input.record, "packageId");
  const registryUrl = recordString(input.record, "registryUrl");
  const registryRef = recordString(input.record, "registryRef");
  const searched =
    packageId === undefined || registryUrl === undefined
      ? undefined
      : await searchWorkflowPackages({
          query: packageId,
          registry: registryUrl,
          refresh: true,
          ...(registryRef === undefined ? {} : { branch: registryRef }),
          ...(input.options === undefined ? {} : { options: input.options }),
        });
  if (searched !== undefined && !searched.ok) {
    return searched;
  }
  const available = searched?.value.records.find(
    (candidate) => candidate.packageName === packageId,
  );
  const installedVersion = recordString(input.record, "version");
  const installedChecksum = recordString(input.record, "checksum");
  const installedIntegrityDigest = integrityDigest(input.record["integrity"]);
  const availableVersion = available?.version;
  const availableChecksum = available?.checksum;
  const availableIntegrityDigest = available?.integrity?.digest;
  const changed = changedArtifacts({
    installedVersion,
    availableVersion,
    installedChecksum,
    availableChecksum,
    installedIntegrityDigest,
    availableIntegrityDigest,
  });
  const status =
    available === undefined
      ? "missing-source-package"
      : installedChecksum === availableChecksum
        ? installedVersion === availableVersion
          ? "up-to-date"
          : "metadata-drift"
        : "update-available";
  return ok({
    ...input.record,
    checkoutRecordPath: input.checkoutRecordPath,
    provenancePath: path.join(
      recordString(input.record, "destinationDirectory") ?? "",
      ".rielflow-package-provenance.json",
    ),
    status,
    updateAvailable: status !== "up-to-date",
    installedVersion,
    availableVersion,
    installedChecksum,
    availableChecksum,
    installedIntegrityDigest,
    availableIntegrityDigest,
    installedArtifacts: installedArtifacts(
      input.record,
      input.checkoutRecordPath,
    ),
    changedArtifacts: changed,
  });
}

export function createNoopWorkflowPackageUpdateResult(
  status: Readonly<Record<string, unknown>>,
): WorkflowPackageCheckoutResult {
  return {
    packageId: String(status["packageId"] ?? ""),
    packageName: String(status["packageName"] ?? status["packageId"] ?? ""),
    workflowName: String(status["workflowName"] ?? ""),
    scope: String(status["scope"] ?? "project") as WorkflowCheckoutScope,
    destinationDirectory: String(status["destinationDirectory"] ?? ""),
    registryPath: String(status["registryPath"] ?? ""),
    registryUrl: String(status["registryUrl"] ?? ""),
    registryRef: String(status["registryRef"] ?? ""),
    sourcePath: String(status["sourcePath"] ?? ""),
    sourceDirectory: String(status["sourceDirectory"] ?? ""),
    metadataPath: String(status["metadataPath"] ?? ""),
    checkoutRecordPath: String(status["checkoutRecordPath"] ?? ""),
    checksum: String(status["installedChecksum"] ?? status["checksum"] ?? ""),
    contentDigestAlgorithm: "sha256",
    contentDigest: String(status["contentDigest"] ?? ""),
    includedFiles: (Array.isArray(status["includedFiles"])
      ? status["includedFiles"]
      : []) as readonly string[],
    packageVersion: String(status["installedVersion"] ?? ""),
    packageHash: String(status["packageHash"] ?? status["checksum"] ?? ""),
    skills: (Array.isArray(status["skills"])
      ? status["skills"]
      : []) as readonly WorkflowPackageSkillInstallTarget[],
    installId: String(status["installId"] ?? ""),
    overwritten: false,
    updated: false,
    changedArtifacts: [],
    confirmationSkipped: false,
    provenancePath: String(status["provenancePath"] ?? ""),
  };
}
