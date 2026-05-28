import type { Result } from "../result";

export const DEFAULT_WORKFLOW_PACKAGE_REGISTRY_ID = "default";
export const DEFAULT_WORKFLOW_PACKAGE_REGISTRY_URL =
  "https://github.com/tacogips/rielflow-packages";
export const DEFAULT_WORKFLOW_PACKAGE_REGISTRY_LOCAL_PATH =
  "/Users/taco/gits/tacogips/rielflow-packages";
export const DEFAULT_WORKFLOW_PACKAGE_REGISTRY_BRANCH = "main";
export const WORKFLOW_PACKAGE_MANIFEST_FILE = "rielflow-package.json";

export type WorkflowPackageChecksumAlgorithm = "md5";
export type WorkflowPackageCacheBackendKind = "json" | "sqlite";
export type WorkflowPackageIntegrityAlgorithm = "sha256";
export type WorkflowPackageSignatureAlgorithm = "ed25519";
export type WorkflowPackagePreInstallCheckMode = "warn" | "reject";
export type WorkflowPackagePreInstallCheckStatus =
  | "passed"
  | "warned"
  | "failed"
  | "skipped";
export type WorkflowPackagePreInstallFindingSeverity =
  | "info"
  | "low"
  | "medium"
  | "high"
  | "critical";
export type WorkflowPackageContainerRuntime = "docker" | "podman";
export type WorkflowPackageContainerRuntimeRequest =
  | WorkflowPackageContainerRuntime
  | "auto";
export type WorkflowPackageSkillVendor =
  | "agents"
  | "claude"
  | "codex"
  | "cursor"
  | "gemini";
export type WorkflowPackageSkillInstallMode = "managed-only" | "projected";

export interface WorkflowPackageTrustedSigner {
  readonly id: string;
  readonly publicKey: string;
}

export interface WorkflowPackageSignature {
  readonly keyId: string;
  readonly algorithm: WorkflowPackageSignatureAlgorithm;
  readonly signature: string;
}

export interface WorkflowPackageIntegrity {
  readonly digestAlgorithm: WorkflowPackageIntegrityAlgorithm;
  readonly digest: string;
  readonly signatures?: readonly WorkflowPackageSignature[];
}

export interface WorkflowPackageRegistryEntry {
  readonly id: string;
  readonly url: string;
  readonly defaultBranch: string;
  readonly registeredAt: string;
  readonly updatedAt: string;
  readonly localPath?: string;
  readonly description?: string;
  readonly priority?: number;
  readonly trustedSigners?: readonly WorkflowPackageTrustedSigner[];
  readonly requireSignature?: boolean;
}

export interface WorkflowPackageRegistryConfig {
  readonly registries: readonly WorkflowPackageRegistryEntry[];
  readonly defaultRegistryId: string;
}

export interface WorkflowPackageRegistryConfigOptions {
  readonly userRoot?: string;
  readonly projectRoot?: string;
  readonly workflowRoot?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly now?: Date;
}

export interface WorkflowPackageManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly workflow: WorkflowPackageWorkflowMetadata;
  readonly registry: string;
  readonly checksum: string;
  readonly checksumAlgorithm: WorkflowPackageChecksumAlgorithm;
  readonly integrity?: WorkflowPackageIntegrity;
  readonly workflowDirectory?: string;
  readonly skillDirectory?: string;
  readonly skills?: readonly WorkflowPackageManifestSkillEntry[];
  readonly title?: string;
  readonly authors?: readonly string[];
  readonly license?: string;
  readonly homepage?: string;
  readonly repository?: string;
  readonly examples?: readonly string[];
  readonly minimumRielflowVersion?: string;
  readonly backends?: readonly string[];
}

export interface NormalizedWorkflowPackageManifest
  extends WorkflowPackageManifest {
  readonly workflowDirectory: string;
  readonly backends: readonly string[];
}

export interface WorkflowPackageWorkflowMetadata {
  readonly title?: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly backends?: readonly string[];
}

export interface WorkflowPackageManifestSkillEntry {
  readonly vendor: WorkflowPackageSkillVendor;
  readonly name: string;
  readonly sourcePath: string;
}

export interface WorkflowPackageIndexRecord {
  readonly registryId: string;
  readonly registryUrl: string;
  readonly packageName: string;
  readonly version: string;
  readonly title?: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly backends: readonly string[];
  readonly workflowId: string;
  readonly workflowDescription: string;
  readonly workflowDirectory: string;
  readonly sourceBranch: string;
  readonly sourcePath: string;
  readonly checksum: string;
  readonly checksumAlgorithm: WorkflowPackageChecksumAlgorithm;
  readonly integrity?: WorkflowPackageIntegrity;
  readonly updatedAt: string;
}

export interface WorkflowPackageSearchRecord {
  readonly packageId: string;
  readonly packageName: string;
  readonly workflowName: string;
  readonly title?: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly backends: readonly string[];
  readonly registryId: string;
  readonly registryUrl: string;
  readonly registryRef: string;
  readonly workflowDirectory: string;
  readonly sourceDirectory: string;
  readonly metadataPath: string;
  readonly checksum: string;
  readonly checksumAlgorithm: WorkflowPackageChecksumAlgorithm;
  readonly integrity?: WorkflowPackageIntegrity;
  readonly updatedAt: string;
}

export interface WorkflowPackageSearchCliResult {
  readonly query?: string;
  readonly registryFilters: readonly string[];
  readonly packages: readonly WorkflowPackageSearchRecord[];
  readonly records: readonly WorkflowPackageIndexRecord[];
  readonly cache: {
    readonly backend: WorkflowPackageCacheBackendKind;
    readonly used: boolean;
    readonly refreshed: boolean;
  };
  readonly cacheUsed: boolean;
  readonly refreshed: boolean;
}

export interface WorkflowPackageFailure {
  readonly code:
    | "UPDATE_CONFIRMATION_REQUIRED"
    | "DUPLICATE_PACKAGE"
    | "FETCH_FAILED"
    | "GIT_FAILED"
    | "INVALID_MANIFEST"
    | "INVALID_PACKAGE_NAME"
    | "INVALID_SKILL_ENTRY"
    | "INVALID_SKILL_VENDOR"
    | "INVALID_REGISTRY"
    | "IO"
    | "MISSING_PACKAGE"
    | "MISSING_REGISTRY"
    | "MISSING_WORKFLOW_BUNDLE"
    | "PRE_INSTALL_CHECK_FAILED"
    | "UNSAFE_PATH"
    | "USAGE"
    | "VALIDATION";
  readonly message: string;
}

export interface WorkflowPackageTemporaryRunCleanupResult {
  readonly removed: boolean;
  readonly temporaryRoot: string;
  readonly remainingPaths: readonly string[];
}

export type RegistryRunTargetKind =
  | "package-id"
  | "github-directory-url"
  | "registered-shorthand";

export interface WorkflowPackageRunProvenance {
  readonly originalTarget: string;
  readonly packageId: string;
  readonly workflowName: string;
  readonly registryId: string;
  readonly registryUrl: string;
  readonly registryRef: string;
  readonly sourcePath: string;
  readonly sourceDirectory: string;
  readonly metadataPath: string;
  readonly checksum: string;
  readonly checksumAlgorithm: WorkflowPackageChecksumAlgorithm;
  readonly integrityVerified: boolean;
  readonly verification: "package-integrity";
  readonly temporaryWorkflowDirectory: string;
}

export interface GitHubDirectoryRunProvenance {
  readonly originalTarget: string;
  readonly owner: string;
  readonly repository: string;
  readonly ref: string;
  readonly directoryPath: string;
  readonly sourceUrl: string;
  readonly sourcePath: string;
  readonly sourceDirectory: string;
  readonly temporaryWorkflowDirectory: string;
  readonly verification: "workflow-bundle-only";
}

export type WorkflowRegistryRunProvenance =
  | {
      readonly targetKind: "package-id" | "registered-shorthand";
      readonly package: WorkflowPackageRunProvenance;
    }
  | {
      readonly targetKind: "github-directory-url";
      readonly github: GitHubDirectoryRunProvenance;
    };

export function workflowRegistryRunTemporaryWorkflowDirectory(
  provenance: WorkflowRegistryRunProvenance,
): string {
  return provenance.targetKind === "github-directory-url"
    ? provenance.github.temporaryWorkflowDirectory
    : provenance.package.temporaryWorkflowDirectory;
}

export function workflowRegistryRunTextSummary(
  provenance: WorkflowRegistryRunProvenance,
): string {
  if (provenance.targetKind === "github-directory-url") {
    return `${provenance.github.originalTarget} ${provenance.github.sourceUrl}`;
  }
  return `${provenance.package.packageId} ${provenance.package.registryUrl}#${provenance.package.registryRef}`;
}

export interface RetainedRegistryRunProvenance {
  readonly sessionId: string;
  readonly retainedForStatus: "paused" | "running" | "waiting";
  readonly temporaryWorkflowDirectory: string;
  readonly retainedProvenancePath: string;
  readonly cleanupOwner: "workflow-run" | "session-resume" | "session-continue";
}

export interface WorkflowPackageTemporaryRunCheckoutInput {
  readonly target?: string;
  readonly packageName?: string;
  readonly registry?: string;
  readonly branch?: string;
  readonly options?: WorkflowPackageRegistryConfigOptions;
  readonly fetchImpl?: typeof fetch;
}

export interface WorkflowPackageTemporaryRunCheckoutResult {
  readonly targetKind: RegistryRunTargetKind;
  readonly workflowName: string;
  readonly workflowDefinitionDir: string;
  readonly packageStagingDirectory: string;
  readonly provenance: WorkflowRegistryRunProvenance;
  cleanup(): Promise<
    Result<WorkflowPackageTemporaryRunCleanupResult, WorkflowPackageFailure>
  >;
}

export interface WorkflowPackageSkillSelection {
  readonly vendor: WorkflowPackageSkillVendor;
  readonly name: string;
  readonly sourcePath: string;
  readonly checksum: string;
}

export interface WorkflowPackageSkillInstallTarget
  extends WorkflowPackageSkillSelection {
  readonly managedPath: string;
  readonly projectionPath?: string;
  readonly installMode: WorkflowPackageSkillInstallMode;
}

export interface WorkflowPackagePreInstallFinding {
  readonly id: string;
  readonly severity: WorkflowPackagePreInstallFindingSeverity;
  readonly relativePath: string;
  readonly evidence: string;
  readonly ruleName: string;
  readonly remediation: string;
}

export interface WorkflowPackagePreInstallCheckResult {
  readonly enabled: boolean;
  readonly mode: WorkflowPackagePreInstallCheckMode;
  readonly status: WorkflowPackagePreInstallCheckStatus;
  readonly scannerVersion: string;
  readonly containerRuntime?: WorkflowPackageContainerRuntime;
  readonly findings: readonly WorkflowPackagePreInstallFinding[];
}
