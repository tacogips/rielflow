import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkflowPackageRunProvenance } from "../workflow/packages";
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
  readonly provenance: WorkflowPackageRunProvenance;
  readonly cleanup?: RegistryRunCleanupOutput;
}): Readonly<Record<string, unknown>> {
  return {
    source: "registry",
    package: input.provenance,
    ...(input.cleanup === undefined ? {} : { cleanup: input.cleanup }),
  };
}

export async function persistRegistryRunProvenance(input: {
  readonly options: RunCliSharedOptions;
  readonly sessionId: string;
  readonly provenance: WorkflowPackageRunProvenance;
}): Promise<string | undefined> {
  try {
    const directory = registryRunProvenanceDirectory(input.options);
    await mkdir(directory, { recursive: true });
    await writeFile(
      registryRunProvenancePath({
        options: input.options,
        sessionId: input.sessionId,
      }),
      `${JSON.stringify(
        {
          source: "registry",
          sessionId: input.sessionId,
          package: input.provenance,
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

export async function readRegistryRunProvenance(input: {
  readonly options: RunCliSharedOptions;
  readonly sessionId: string;
}): Promise<WorkflowPackageRunProvenance | undefined> {
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
  const packagePayload = parsed["package"];
  return isWorkflowPackageRunProvenance(packagePayload)
    ? packagePayload
    : undefined;
}

export function registryRunWorkflowRoot(
  provenance: WorkflowPackageRunProvenance,
): string {
  return path.dirname(provenance.temporaryWorkflowDirectory);
}

export function skippedRetainedRegistryRunCleanup(
  provenance: WorkflowPackageRunProvenance,
  reason: string,
): RegistryRunCleanupOutput {
  return {
    ok: false,
    skipped: true,
    reason,
    remainingPaths: [provenance.temporaryWorkflowDirectory],
  };
}

export async function cleanupRetainedRegistryRunCheckout(
  provenance: WorkflowPackageRunProvenance,
): Promise<RegistryRunCleanupOutput> {
  const temporaryRoot = retainedRegistryTemporaryRoot(provenance);
  if (temporaryRoot === undefined) {
    return {
      ok: false,
      error:
        "registry run provenance does not point to a managed temporary checkout",
    };
  }

  try {
    await rm(temporaryRoot, { recursive: true, force: true });
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
  provenance: WorkflowPackageRunProvenance,
): string | undefined {
  const workflowsDirectory = path.dirname(
    provenance.temporaryWorkflowDirectory,
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
