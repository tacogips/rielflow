import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result } from "../result";
import { normalizeWorkflowPackageIntegrity } from "./integrity";
import {
  WORKFLOW_PACKAGE_MANIFEST_FILE,
  type NormalizedWorkflowPackageManifest,
  type WorkflowPackageFailure,
  type WorkflowPackageWorkflowMetadata,
} from "./types";

function packageFailure(
  code: WorkflowPackageFailure["code"],
  message: string,
): WorkflowPackageFailure {
  return { code, message };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSafeWorkflowPackageName(name: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._-]{0,79}\/)?[a-z0-9][a-z0-9._-]{0,79}$/.test(
    name,
  );
}

export function normalizePackageRelativePath(
  rawPath: string,
): string | undefined {
  const normalized = path.posix.normalize(rawPath.replaceAll(path.sep, "/"));
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    path.isAbsolute(normalized)
  ) {
    return normalized === "." ? "." : undefined;
  }
  return normalized;
}

function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return values.length === value.length ? values : undefined;
}

export function normalizeWorkflowPackageWorkflowMetadata(
  value: unknown,
): Result<WorkflowPackageWorkflowMetadata, WorkflowPackageFailure> {
  if (!isRecord(value)) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        "workflow package metadata must be an object",
      ),
    );
  }
  const title = value["title"];
  const description = value["description"];
  const tags = readStringArray(value["tags"]);
  const backends = readStringArray(value["backends"]);
  if (title !== undefined && typeof title !== "string") {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        "workflow package metadata title must be a string",
      ),
    );
  }
  if (typeof description !== "string" || description.trim().length === 0) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        "workflow package metadata description must be a non-empty string",
      ),
    );
  }
  if (tags === undefined) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        "workflow package metadata tags must be an array of non-empty strings",
      ),
    );
  }
  if (value["backends"] !== undefined && backends === undefined) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        "workflow package metadata backends must be an array of non-empty strings",
      ),
    );
  }
  return ok({
    ...(title === undefined ? {} : { title }),
    description,
    tags,
    ...(backends === undefined ? {} : { backends }),
  });
}

export function normalizeWorkflowPackageMetadataFromWorkflowJson(
  workflowJson: unknown,
): Result<WorkflowPackageWorkflowMetadata, WorkflowPackageFailure> {
  if (!isRecord(workflowJson)) {
    return err(packageFailure("VALIDATION", "workflow.json must be an object"));
  }
  const metadata = workflowJson["metadata"];
  if (!isRecord(metadata)) {
    return err(
      packageFailure(
        "VALIDATION",
        "workflow publish requires workflow.metadata.rielflowPackage",
      ),
    );
  }
  const packageMetadata = metadata["rielflowPackage"];
  const normalized = normalizeWorkflowPackageWorkflowMetadata(packageMetadata);
  if (!normalized.ok) {
    return err(
      packageFailure(
        "VALIDATION",
        `invalid workflow.metadata.rielflowPackage: ${normalized.error.message}`,
      ),
    );
  }
  return normalized;
}

export function normalizeWorkflowPackageManifest(
  value: unknown,
  packageRoot: string,
): Result<NormalizedWorkflowPackageManifest, WorkflowPackageFailure> {
  if (!isRecord(value)) {
    return err(
      packageFailure("INVALID_MANIFEST", "package manifest is invalid"),
    );
  }
  const name = value["name"];
  const version = value["version"];
  const description = value["description"];
  const tags = readStringArray(value["tags"]);
  const registry = value["registry"];
  const checksum = value["checksum"];
  const checksumAlgorithm = value["checksumAlgorithm"];
  const integrity = normalizeWorkflowPackageIntegrity(value["integrity"]);
  if (!integrity.ok) {
    return integrity;
  }
  if (
    typeof name !== "string" ||
    typeof version !== "string" ||
    typeof description !== "string" ||
    tags === undefined ||
    typeof registry !== "string" ||
    typeof checksum !== "string" ||
    checksumAlgorithm !== "md5"
  ) {
    return err(
      packageFailure("INVALID_MANIFEST", "package manifest is missing fields"),
    );
  }
  if (!isSafeWorkflowPackageName(name)) {
    return err(
      packageFailure("INVALID_PACKAGE_NAME", `invalid package name '${name}'`),
    );
  }
  const workflow: Result<
    WorkflowPackageWorkflowMetadata,
    WorkflowPackageFailure
  > =
    value["workflow"] === undefined
      ? ok({
          description,
          tags,
        } satisfies WorkflowPackageWorkflowMetadata)
      : normalizeWorkflowPackageWorkflowMetadata(value["workflow"]);
  if (!workflow.ok) {
    return workflow;
  }
  const workflowDirectoryRaw = value["workflowDirectory"];
  const workflowDirectory =
    workflowDirectoryRaw === undefined
      ? "."
      : typeof workflowDirectoryRaw === "string"
        ? normalizePackageRelativePath(workflowDirectoryRaw)
        : undefined;
  if (workflowDirectory === undefined) {
    return err(
      packageFailure(
        "UNSAFE_PATH",
        `unsafe workflowDirectory for package '${name}'`,
      ),
    );
  }
  const workflowJsonPath = path.join(
    packageRoot,
    workflowDirectory,
    "workflow.json",
  );
  const authors = readStringArray(value["authors"]);
  const examples = readStringArray(value["examples"]);
  const authoredBackends = readStringArray(value["backends"]);
  if (value["backends"] !== undefined && authoredBackends === undefined) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        "package manifest backends must be an array of non-empty strings",
      ),
    );
  }
  return ok({
    name,
    version,
    description,
    tags,
    workflow: workflow.value,
    registry,
    checksum,
    checksumAlgorithm,
    ...(integrity.value === undefined ? {} : { integrity: integrity.value }),
    workflowDirectory,
    ...(typeof value["title"] === "string" ? { title: value["title"] } : {}),
    ...(authors === undefined ? {} : { authors }),
    ...(typeof value["license"] === "string"
      ? { license: value["license"] }
      : {}),
    ...(typeof value["homepage"] === "string"
      ? { homepage: value["homepage"] }
      : {}),
    ...(typeof value["repository"] === "string"
      ? { repository: value["repository"] }
      : {}),
    ...(examples === undefined ? {} : { examples }),
    ...(typeof value["minimumRielflowVersion"] === "string"
      ? { minimumRielflowVersion: value["minimumRielflowVersion"] }
      : {}),
    backends: authoredBackends ?? workflow.value.backends ?? [],
    // Checked by loadWorkflowPackageManifest after async filesystem stat.
    ...(workflowJsonPath.length > 0 ? {} : {}),
  });
}

export async function loadWorkflowPackageManifest(
  packageRoot: string,
): Promise<Result<NormalizedWorkflowPackageManifest, WorkflowPackageFailure>> {
  const manifestPath = path.join(packageRoot, WORKFLOW_PACKAGE_MANIFEST_FILE);
  try {
    const raw = await readFile(manifestPath, "utf8");
    const normalized = normalizeWorkflowPackageManifest(
      JSON.parse(raw) as unknown,
      packageRoot,
    );
    if (!normalized.ok) {
      return normalized;
    }
    const workflowJsonPath = path.join(
      packageRoot,
      normalized.value.workflowDirectory,
      "workflow.json",
    );
    if (!(await stat(workflowJsonPath)).isFile()) {
      return err(
        packageFailure(
          "MISSING_WORKFLOW_BUNDLE",
          `workflow.json not found for package '${normalized.value.name}'`,
        ),
      );
    }
    return normalized;
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { readonly code?: unknown }).code
        : undefined;
    if (code === "ENOENT") {
      return err(
        packageFailure(
          "MISSING_PACKAGE",
          `package manifest not found: ${manifestPath}`,
        ),
      );
    }
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      packageFailure("IO", `failed to load package manifest: ${message}`),
    );
  }
}
