import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  GitHubDirectoryRunProvenance,
  RetainedRegistryRunProvenance,
  WorkflowPackageRunProvenance,
  WorkflowRegistryRunProvenance,
} from "../workflow/packages";
import { workflowRegistryRunTemporaryWorkflowDirectory } from "../workflow/packages";
import { resolveRootDataDir } from "../workflow/paths";
import type { RunCliSharedOptions } from "./storage-and-options";

const REGISTRY_RUNS_DIRECTORY_NAME = "registry-runs";
const REGISTRY_TEMPORARY_ROOT_PREFIX = "rielflow-registry-run-";

export type RegistryRunCleanupOutput =
  | { readonly ok: true; readonly remainingPaths: readonly string[] }
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: false;
      readonly skipped: true;
      readonly reason: string;
      readonly remainingPaths: readonly string[];
    };

export function registryRunSourceJson(input: {
  readonly provenance: WorkflowRegistryRunProvenance;
  readonly cleanup?: RegistryRunCleanupOutput;
  readonly retained?: RetainedRegistryRunProvenance;
}): Readonly<Record<string, unknown>> {
  return {
    source: "registry",
    originalTarget:
      input.provenance.targetKind === "github-directory-url"
        ? input.provenance.github.originalTarget
        : input.provenance.package.originalTarget,
    targetKind: input.provenance.targetKind,
    ...(input.provenance.targetKind === "github-directory-url"
      ? { github: input.provenance.github }
      : { package: input.provenance.package }),
    ...(input.retained === undefined ? {} : { retained: input.retained }),
    ...(input.cleanup === undefined ? {} : { cleanup: input.cleanup }),
  };
}

export async function persistRegistryRunProvenance(input: {
  readonly options: RunCliSharedOptions;
  readonly sessionId: string;
  readonly provenance: WorkflowRegistryRunProvenance;
  readonly retainedForStatus?: "paused" | "running" | "waiting";
}): Promise<string | undefined> {
  try {
    const directory = registryRunProvenanceDirectory(input.options);
    const provenancePath = registryRunProvenancePath({
      options: input.options,
      sessionId: input.sessionId,
    });
    await mkdir(directory, { recursive: true });
    await writeFile(
      provenancePath,
      `${JSON.stringify(
        {
          source: "registry",
          sessionId: input.sessionId,
          targetKind: input.provenance.targetKind,
          retained: {
            sessionId: input.sessionId,
            retainedForStatus: input.retainedForStatus ?? "paused",
            temporaryWorkflowDirectory:
              workflowRegistryRunTemporaryWorkflowDirectory(input.provenance),
            retainedProvenancePath: provenancePath,
            cleanupOwner: "workflow-run",
          },
          ...(input.provenance.targetKind === "github-directory-url"
            ? { github: input.provenance.github }
            : { package: input.provenance.package }),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return undefined;
  } catch (error: unknown) {
    return error instanceof Error ? error.message : "unknown error";
  }
}

export async function removeRegistryRunProvenance(input: {
  readonly options: RunCliSharedOptions;
  readonly sessionId: string;
}): Promise<string | undefined> {
  try {
    await rm(registryRunProvenancePath(input), { force: true });
    return undefined;
  } catch (error: unknown) {
    return error instanceof Error ? error.message : "unknown error";
  }
}

export async function readRegistryRunProvenance(input: {
  readonly options: RunCliSharedOptions;
  readonly sessionId: string;
}): Promise<WorkflowRegistryRunProvenance | undefined> {
  let raw: string;
  try {
    raw = await readFile(registryRunProvenancePath(input), "utf8");
  } catch (error: unknown) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return undefined;
    }
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  if (
    parsed["source"] !== "registry" ||
    parsed["sessionId"] !== input.sessionId
  ) {
    return undefined;
  }
  if (parsed["targetKind"] === "github-directory-url") {
    const githubPayload = parsed["github"];
    return isGitHubDirectoryRunProvenance(githubPayload)
      ? { targetKind: "github-directory-url", github: githubPayload }
      : undefined;
  }
  const packagePayload = parsed["package"];
  const packageProvenance =
    normalizeWorkflowPackageRunProvenance(packagePayload);
  return packageProvenance === undefined
    ? undefined
    : {
        targetKind:
          parsed["targetKind"] === "registered-shorthand"
            ? "registered-shorthand"
            : "package-id",
        package: packageProvenance,
      };
}

export function registryRunWorkflowRoot(
  provenance: WorkflowRegistryRunProvenance,
): string {
  return path.dirname(
    workflowRegistryRunTemporaryWorkflowDirectory(provenance),
  );
}

export function skippedRetainedRegistryRunCleanup(
  provenance: WorkflowRegistryRunProvenance,
  reason: string,
): RegistryRunCleanupOutput {
  return {
    ok: false,
    skipped: true,
    reason,
    remainingPaths: [workflowRegistryRunTemporaryWorkflowDirectory(provenance)],
  };
}

export async function cleanupRetainedRegistryRunCheckout(input: {
  readonly options: RunCliSharedOptions;
  readonly sessionId: string;
  readonly provenance: WorkflowRegistryRunProvenance;
}): Promise<RegistryRunCleanupOutput> {
  const temporaryRoot = retainedRegistryTemporaryRoot(input.provenance);
  if (temporaryRoot === undefined) {
    return {
      ok: false,
      error:
        "registry run provenance does not point to a managed temporary checkout",
    };
  }

  try {
    await rm(temporaryRoot, { recursive: true, force: true });
    const provenanceError = await removeRegistryRunProvenance(input);
    if (provenanceError !== undefined) {
      return { ok: false, error: provenanceError };
    }
    return {
      ok: true,
      remainingPaths: (await pathExists(temporaryRoot)) ? [temporaryRoot] : [],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return { ok: false, error: message };
  }
}

function registryRunProvenanceDirectory(options: RunCliSharedOptions): string {
  return path.join(resolveRootDataDir(options), REGISTRY_RUNS_DIRECTORY_NAME);
}

function registryRunProvenancePath(input: {
  readonly options: RunCliSharedOptions;
  readonly sessionId: string;
}): string {
  return path.join(
    registryRunProvenanceDirectory(input.options),
    `${input.sessionId}.json`,
  );
}

function retainedRegistryTemporaryRoot(
  provenance: WorkflowRegistryRunProvenance,
): string | undefined {
  const workflowsDirectory = path.dirname(
    workflowRegistryRunTemporaryWorkflowDirectory(provenance),
  );
  const temporaryRoot = path.dirname(workflowsDirectory);
  if (path.basename(workflowsDirectory) !== "workflows") {
    return undefined;
  }
  if (
    !path.basename(temporaryRoot).startsWith(REGISTRY_TEMPORARY_ROOT_PREFIX)
  ) {
    return undefined;
  }
  return temporaryRoot;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function isWorkflowPackageRunProvenance(
  value: unknown,
): value is WorkflowPackageRunProvenance {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value["packageId"] === "string" &&
    typeof value["originalTarget"] === "string" &&
    typeof value["workflowName"] === "string" &&
    typeof value["registryId"] === "string" &&
    typeof value["registryUrl"] === "string" &&
    typeof value["registryRef"] === "string" &&
    typeof value["sourcePath"] === "string" &&
    typeof value["sourceDirectory"] === "string" &&
    typeof value["metadataPath"] === "string" &&
    typeof value["checksum"] === "string" &&
    value["checksumAlgorithm"] === "md5" &&
    value["integrityVerified"] === true &&
    value["verification"] === "package-integrity" &&
    typeof value["temporaryWorkflowDirectory"] === "string"
  );
}

function normalizeWorkflowPackageRunProvenance(
  value: unknown,
): WorkflowPackageRunProvenance | undefined {
  if (isWorkflowPackageRunProvenance(value)) {
    return value;
  }
  if (!isLegacyWorkflowPackageRunProvenance(value)) {
    return undefined;
  }
  return {
    ...value,
    originalTarget: value.packageId,
    integrityVerified: true,
    verification: "package-integrity",
  };
}

function isLegacyWorkflowPackageRunProvenance(
  value: unknown,
): value is Omit<
  WorkflowPackageRunProvenance,
  "originalTarget" | "integrityVerified" | "verification"
> {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value["packageId"] === "string" &&
    typeof value["workflowName"] === "string" &&
    typeof value["registryId"] === "string" &&
    typeof value["registryUrl"] === "string" &&
    typeof value["registryRef"] === "string" &&
    typeof value["sourcePath"] === "string" &&
    typeof value["sourceDirectory"] === "string" &&
    typeof value["metadataPath"] === "string" &&
    typeof value["checksum"] === "string" &&
    value["checksumAlgorithm"] === "md5" &&
    typeof value["temporaryWorkflowDirectory"] === "string"
  );
}

function isGitHubDirectoryRunProvenance(
  value: unknown,
): value is GitHubDirectoryRunProvenance {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value["originalTarget"] === "string" &&
    typeof value["owner"] === "string" &&
    typeof value["repository"] === "string" &&
    typeof value["ref"] === "string" &&
    typeof value["directoryPath"] === "string" &&
    typeof value["sourceUrl"] === "string" &&
    typeof value["sourcePath"] === "string" &&
    typeof value["sourceDirectory"] === "string" &&
    typeof value["temporaryWorkflowDirectory"] === "string" &&
    value["verification"] === "workflow-bundle-only"
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
