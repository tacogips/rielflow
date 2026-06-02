import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result } from "../result";
import { normalizeWorkflowPackageIntegrity } from "./integrity";
import {
  WORKFLOW_PACKAGE_MANIFEST_FILE,
  type AnyWorkflowPackageManifest,
  type NormalizedWorkflowPackageManifest,
  type NormalizedWorkflowNodeAddonPackageManifest,
  type WorkflowPackageFailure,
  type WorkflowPackageKind,
  type WorkflowPackageManifestDependencyEntry,
  type WorkflowPackageManifestAddonEntry,
  type WorkflowPackageManifestSkillEntry,
  type WorkflowPackageSkillVendor,
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

function normalizeWorkflowPackageKind(
  value: unknown,
): Result<WorkflowPackageKind, WorkflowPackageFailure> {
  if (value === undefined || value === "workflow") {
    return ok("workflow");
  }
  if (value === "node-addon") {
    return ok("node-addon");
  }
  return err(
    packageFailure(
      "INVALID_MANIFEST",
      "package manifest kind must be workflow or node-addon",
    ),
  );
}

const WORKFLOW_PACKAGE_SKILL_VENDOR_SET: ReadonlySet<string> = new Set([
  "agents",
  "claude",
  "codex",
  "cursor",
  "gemini",
]);

function normalizeWorkflowPackageSkillVendor(
  value: unknown,
): WorkflowPackageSkillVendor | undefined {
  return typeof value === "string" &&
    WORKFLOW_PACKAGE_SKILL_VENDOR_SET.has(value)
    ? (value as WorkflowPackageSkillVendor)
    : undefined;
}

function normalizeWorkflowPackageManifestSkills(
  value: unknown,
): Result<
  readonly WorkflowPackageManifestSkillEntry[] | undefined,
  WorkflowPackageFailure
> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (!Array.isArray(value)) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        "package manifest skills must be an array",
      ),
    );
  }
  const entries: WorkflowPackageManifestSkillEntry[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      return err(
        packageFailure(
          "INVALID_MANIFEST",
          `package manifest skills[${index}] must be an object`,
        ),
      );
    }
    const vendor = normalizeWorkflowPackageSkillVendor(entry["vendor"]);
    const name = entry["name"];
    const sourcePath = entry["sourcePath"];
    if (
      vendor === undefined ||
      typeof name !== "string" ||
      name.length === 0 ||
      typeof sourcePath !== "string" ||
      normalizePackageRelativePath(sourcePath) === undefined
    ) {
      return err(
        packageFailure(
          "INVALID_MANIFEST",
          `package manifest skills[${index}] is invalid`,
        ),
      );
    }
    entries.push({ vendor, name, sourcePath });
  }
  return ok(entries);
}

const WORKFLOW_PACKAGE_DEPENDENCY_KEYS: ReadonlySet<string> = new Set([
  "packageId",
  "registry",
  "branch",
]);

function normalizeWorkflowPackageManifestDependencies(
  value: unknown,
  packageName: string,
): Result<
  readonly WorkflowPackageManifestDependencyEntry[],
  WorkflowPackageFailure
> {
  if (value === undefined) {
    return ok([]);
  }
  if (!Array.isArray(value)) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        "package manifest dependencies must be an array",
      ),
    );
  }
  const dependencies: WorkflowPackageManifestDependencyEntry[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry === "string") {
      if (!isSafeWorkflowPackageName(entry) || entry === packageName) {
        return err(
          packageFailure(
            "INVALID_MANIFEST",
            `package manifest dependencies[${index}] packageId is invalid`,
          ),
        );
      }
      dependencies.push({ packageId: entry });
      continue;
    }
    if (!isRecord(entry)) {
      return err(
        packageFailure(
          "INVALID_MANIFEST",
          `package manifest dependencies[${index}] must be a string or object`,
        ),
      );
    }
    for (const key of Object.keys(entry)) {
      if (!WORKFLOW_PACKAGE_DEPENDENCY_KEYS.has(key)) {
        return err(
          packageFailure(
            "INVALID_MANIFEST",
            `package manifest dependencies[${index}] has unsupported key '${key}'`,
          ),
        );
      }
    }
    const packageId = entry["packageId"];
    const registry = entry["registry"];
    const branch = entry["branch"];
    if (
      typeof packageId !== "string" ||
      !isSafeWorkflowPackageName(packageId) ||
      packageId === packageName ||
      (registry !== undefined &&
        (typeof registry !== "string" || registry.trim().length === 0)) ||
      (branch !== undefined &&
        (typeof branch !== "string" || branch.trim().length === 0))
    ) {
      return err(
        packageFailure(
          "INVALID_MANIFEST",
          `package manifest dependencies[${index}] is invalid`,
        ),
      );
    }
    dependencies.push({
      packageId,
      ...(registry === undefined ? {} : { registry }),
      ...(branch === undefined ? {} : { branch }),
    });
  }
  return ok(dependencies);
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
  const kind = normalizeWorkflowPackageKind(value["kind"]);
  if (!kind.ok) {
    return kind;
  }
  if (kind.value !== "workflow") {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        "workflow package manifest loader requires kind workflow",
      ),
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
  const dependencies = normalizeWorkflowPackageManifestDependencies(
    value["dependencies"],
    name,
  );
  if (!dependencies.ok) {
    return dependencies;
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
  const skillDirectoryRaw = value["skillDirectory"];
  const skillDirectory =
    skillDirectoryRaw === undefined
      ? undefined
      : typeof skillDirectoryRaw === "string"
        ? normalizePackageRelativePath(skillDirectoryRaw)
        : undefined;
  if (skillDirectoryRaw !== undefined && skillDirectory === undefined) {
    return err(
      packageFailure(
        "UNSAFE_PATH",
        `unsafe skillDirectory for package '${name}'`,
      ),
    );
  }
  const skills = normalizeWorkflowPackageManifestSkills(value["skills"]);
  if (!skills.ok) {
    return skills;
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
    kind: "workflow",
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
    ...(skillDirectory === undefined ? {} : { skillDirectory }),
    ...(skills.value === undefined ? {} : { skills: skills.value }),
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
    dependencies: dependencies.value,
    // Checked by loadWorkflowPackageManifest after async filesystem stat.
    ...(workflowJsonPath.length > 0 ? {} : {}),
  });
}

function normalizeWorkflowPackageManifestAddons(
  value: unknown,
): Result<
  readonly WorkflowPackageManifestAddonEntry[],
  WorkflowPackageFailure
> {
  if (!Array.isArray(value) || value.length === 0) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        "node-addon package manifest addons must be a non-empty array",
      ),
    );
  }
  const addons: WorkflowPackageManifestAddonEntry[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      return err(
        packageFailure(
          "INVALID_MANIFEST",
          `node-addon package manifest addons[${index}] must be an object`,
        ),
      );
    }
    const name = entry["name"];
    const version = entry["version"];
    const sourcePath = entry["sourcePath"];
    const normalizedSourcePath =
      typeof sourcePath === "string"
        ? normalizePackageRelativePath(sourcePath)
        : undefined;
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      typeof version !== "string" ||
      version.length === 0 ||
      normalizedSourcePath === undefined
    ) {
      return err(
        packageFailure(
          "INVALID_MANIFEST",
          `node-addon package manifest addons[${index}] is invalid`,
        ),
      );
    }
    const duplicateKey = `${name}\0${version}`;
    if (seen.has(duplicateKey)) {
      return err(
        packageFailure(
          "INVALID_MANIFEST",
          `node-addon package manifest addons[${index}] duplicates ${name}@${version}`,
        ),
      );
    }
    seen.add(duplicateKey);
    addons.push({ name, version, sourcePath: normalizedSourcePath });
  }
  return ok(addons);
}

export function normalizeWorkflowNodeAddonPackageManifest(
  value: unknown,
): Result<NormalizedWorkflowNodeAddonPackageManifest, WorkflowPackageFailure> {
  if (!isRecord(value)) {
    return err(
      packageFailure("INVALID_MANIFEST", "package manifest is invalid"),
    );
  }
  const kind = normalizeWorkflowPackageKind(value["kind"]);
  if (!kind.ok) {
    return kind;
  }
  if (kind.value !== "node-addon") {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        "node-addon package manifest loader requires kind node-addon",
      ),
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
  if (
    value["workflow"] !== undefined ||
    value["workflowDirectory"] !== undefined
  ) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        "node-addon package manifest must not include workflow metadata",
      ),
    );
  }
  const dependencies = normalizeWorkflowPackageManifestDependencies(
    value["dependencies"],
    name,
  );
  if (!dependencies.ok) {
    return dependencies;
  }
  const addons = normalizeWorkflowPackageManifestAddons(value["addons"]);
  if (!addons.ok) {
    return addons;
  }
  const authors = readStringArray(value["authors"]);
  const examples = readStringArray(value["examples"]);
  return ok({
    kind: "node-addon",
    name,
    version,
    description,
    tags,
    registry,
    checksum,
    checksumAlgorithm,
    addons: addons.value,
    ...(integrity.value === undefined ? {} : { integrity: integrity.value }),
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
    dependencies: dependencies.value,
  });
}

export function normalizeAnyWorkflowPackageManifest(
  value: unknown,
  packageRoot: string,
): Result<AnyWorkflowPackageManifest, WorkflowPackageFailure> {
  if (!isRecord(value)) {
    return err(
      packageFailure("INVALID_MANIFEST", "package manifest is invalid"),
    );
  }
  const kind = normalizeWorkflowPackageKind(value["kind"]);
  if (!kind.ok) {
    return kind;
  }
  return kind.value === "node-addon"
    ? normalizeWorkflowNodeAddonPackageManifest(value)
    : normalizeWorkflowPackageManifest(value, packageRoot);
}

export async function loadWorkflowPackageManifest(
  packageRoot: string,
): Promise<Result<NormalizedWorkflowPackageManifest, WorkflowPackageFailure>> {
  const loaded = await loadAnyWorkflowPackageManifest(packageRoot);
  if (!loaded.ok) {
    return loaded;
  }
  if (loaded.value.kind !== "workflow") {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        `package '${loaded.value.name}' is a node-addon package, not a workflow package`,
      ),
    );
  }
  return ok(loaded.value);
}

export async function loadAnyWorkflowPackageManifest(
  packageRoot: string,
): Promise<Result<AnyWorkflowPackageManifest, WorkflowPackageFailure>> {
  const manifestPath = path.join(packageRoot, WORKFLOW_PACKAGE_MANIFEST_FILE);
  try {
    const raw = await readFile(manifestPath, "utf8");
    const normalized = normalizeAnyWorkflowPackageManifest(
      JSON.parse(raw) as unknown,
      packageRoot,
    );
    if (!normalized.ok) {
      return normalized;
    }
    if (normalized.value.kind === "node-addon") {
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
