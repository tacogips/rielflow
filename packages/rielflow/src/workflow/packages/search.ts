import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadWorkflowFromDisk } from "../load";
import { err, ok, type Result } from "../result";
import { computeWorkflowPackageChecksum } from "./checksum";
import { createWorkflowPackageCacheBackend } from "./cache";
import { loadWorkflowPackageManifest } from "./manifest";
import {
  loadWorkflowPackageRegistryConfig,
  resolveWorkflowPackageRegistryEntry,
} from "./registry-config";
import {
  WORKFLOW_PACKAGE_MANIFEST_FILE,
  type WorkflowPackageCacheBackendKind,
  type WorkflowPackageFailure,
  type WorkflowPackageIndexRecord,
  type WorkflowPackageRegistryConfigOptions,
  type WorkflowPackageRegistryEntry,
  type WorkflowPackageSearchCliResult,
  type WorkflowPackageSearchRecord,
} from "./types";

export interface WorkflowPackageSearchInput {
  readonly query?: string;
  readonly registry?: string;
  readonly tags?: readonly string[];
  readonly backend?: string;
  readonly branch?: string;
  readonly limit?: number;
  readonly refresh?: boolean;
  readonly cacheBackend?: WorkflowPackageCacheBackendKind;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}

export type WorkflowPackageSearchResult = WorkflowPackageSearchCliResult;

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

async function findPackageRoots(
  registryRoot: string,
): Promise<readonly string[]> {
  const roots: string[] = [];
  async function visit(directory: string): Promise<void> {
    if (
      await pathExists(path.join(directory, WORKFLOW_PACKAGE_MANIFEST_FILE))
    ) {
      roots.push(directory);
      return;
    }
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".git") {
        continue;
      }
      await visit(path.join(directory, entry.name));
    }
  }
  await visit(registryRoot);
  return roots.sort((left, right) => left.localeCompare(right));
}

async function readWorkflowMetadata(workflowDirectory: string): Promise<{
  readonly workflowId: string;
  readonly workflowDescription: string;
}> {
  const raw = await readFile(
    path.join(workflowDirectory, "workflow.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as unknown;
  const record =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Readonly<Record<string, unknown>>)
      : {};
  const workflowId =
    record["id"] ?? record["workflowName"] ?? path.basename(workflowDirectory);
  const workflowDescription = record["description"];
  return {
    workflowId:
      typeof workflowId === "string"
        ? workflowId
        : path.basename(workflowDirectory),
    workflowDescription:
      typeof workflowDescription === "string" ? workflowDescription : "",
  };
}

function readExecutionBackend(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const backend = (value as Readonly<Record<string, unknown>>)[
    "executionBackend"
  ];
  return typeof backend === "string" && backend.length > 0
    ? backend
    : undefined;
}

async function readWorkflowNodeBackends(
  workflowDirectory: string,
): Promise<readonly string[]> {
  const backends = new Set<string>();
  try {
    const rawWorkflow = await readFile(
      path.join(workflowDirectory, "workflow.json"),
      "utf8",
    );
    const workflow = JSON.parse(rawWorkflow) as unknown;
    if (
      typeof workflow === "object" &&
      workflow !== null &&
      !Array.isArray(workflow)
    ) {
      const nodes = (workflow as Readonly<Record<string, unknown>>)["nodes"];
      if (Array.isArray(nodes)) {
        for (const node of nodes) {
          const backend = readExecutionBackend(node);
          if (backend !== undefined) {
            backends.add(backend);
          }
        }
      }
    }
  } catch {
    return [];
  }

  const nodesDirectory = path.join(workflowDirectory, "nodes");
  try {
    const entries = await readdir(nodesDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const rawNode = await readFile(
        path.join(nodesDirectory, entry.name),
        "utf8",
      );
      const backend = readExecutionBackend(JSON.parse(rawNode) as unknown);
      if (backend !== undefined) {
        backends.add(backend);
      }
    }
  } catch {
    return [...backends].sort((left, right) => left.localeCompare(right));
  }

  return [...backends].sort((left, right) => left.localeCompare(right));
}

async function buildRegistryIndex(input: {
  readonly registry: WorkflowPackageRegistryEntry;
  readonly branch: string;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}): Promise<
  Result<readonly WorkflowPackageIndexRecord[], WorkflowPackageFailure>
> {
  if (input.registry.localPath === undefined) {
    return err(
      packageFailure(
        "FETCH_FAILED",
        `registry '${input.registry.id}' has no localPath cache; register a localPath or clone the GitHub repository first`,
      ),
    );
  }
  try {
    const roots = await findPackageRoots(input.registry.localPath);
    const records: WorkflowPackageIndexRecord[] = [];
    for (const packageRoot of roots) {
      const manifest = await loadWorkflowPackageManifest(packageRoot);
      if (!manifest.ok) {
        continue;
      }
      const checksum = await computeWorkflowPackageChecksum({
        packageRoot,
        workflowDirectory: manifest.value.workflowDirectory,
      });
      if (!checksum.ok) {
        return checksum;
      }
      const workflowDirectory = path.join(
        packageRoot,
        manifest.value.workflowDirectory,
      );
      const loaded = await loadWorkflowFromDisk(
        path.basename(workflowDirectory),
        {
          workflowRoot: path.dirname(workflowDirectory),
          ...(input.options?.cwd === undefined
            ? {}
            : { cwd: input.options.cwd }),
          ...(input.options?.env === undefined
            ? {}
            : { env: input.options.env }),
          ...(input.options?.userRoot === undefined
            ? {}
            : { userRoot: input.options.userRoot }),
        },
      );
      const metadata = await readWorkflowMetadata(workflowDirectory);
      const derivedBackends = await readWorkflowNodeBackends(workflowDirectory);
      const backends = [
        ...new Set([...manifest.value.backends, ...derivedBackends]),
      ].sort((left, right) => left.localeCompare(right));
      records.push({
        registryId: input.registry.id,
        registryUrl: input.registry.url,
        packageName: manifest.value.name,
        version: manifest.value.version,
        ...(manifest.value.title === undefined
          ? {}
          : { title: manifest.value.title }),
        description: manifest.value.workflow.description,
        tags: manifest.value.workflow.tags,
        backends,
        workflowId: loaded.ok ? loaded.value.workflowName : metadata.workflowId,
        workflowDescription: metadata.workflowDescription,
        workflowDirectory: manifest.value.workflowDirectory,
        sourceBranch: input.branch,
        sourcePath: path
          .relative(input.registry.localPath, packageRoot)
          .split(path.sep)
          .join("/"),
        checksum: checksum.value.checksum,
        checksumAlgorithm: checksum.value.checksumAlgorithm,
        ...(manifest.value.integrity === undefined
          ? {}
          : { integrity: manifest.value.integrity }),
        updatedAt:
          input.options?.now?.toISOString() ?? new Date().toISOString(),
      });
    }
    return ok(records);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(packageFailure("IO", `failed to index registry: ${message}`));
  }
}

function matchesSearch(
  record: WorkflowPackageIndexRecord,
  input: WorkflowPackageSearchInput,
): boolean {
  const requiredTags = input.tags ?? [];
  if (
    requiredTags.some(
      (tag) => !record.tags.some((candidate) => candidate === tag),
    )
  ) {
    return false;
  }
  if (
    input.backend !== undefined &&
    !record.backends.some((backend) => backend === input.backend)
  ) {
    return false;
  }
  const query = input.query?.trim().toLowerCase();
  if (query === undefined || query.length === 0) {
    return true;
  }
  const haystack = [
    record.packageName,
    record.title ?? "",
    record.description,
    record.workflowId,
    record.workflowDescription,
    ...record.tags,
    ...record.backends,
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(query);
}

function toSearchRecord(
  record: WorkflowPackageIndexRecord,
): WorkflowPackageSearchRecord {
  return {
    packageId: record.packageName,
    packageName: record.packageName,
    workflowName: record.workflowId,
    ...(record.title === undefined ? {} : { title: record.title }),
    description: record.description,
    tags: record.tags,
    backends: record.backends,
    registryId: record.registryId,
    registryUrl: record.registryUrl,
    registryRef: record.sourceBranch,
    workflowDirectory: record.workflowDirectory,
    sourceDirectory: record.sourcePath,
    metadataPath: path.posix.join(
      record.sourcePath,
      WORKFLOW_PACKAGE_MANIFEST_FILE,
    ),
    checksum: record.checksum,
    checksumAlgorithm: record.checksumAlgorithm,
    ...(record.integrity === undefined ? {} : { integrity: record.integrity }),
    updatedAt: record.updatedAt,
  };
}

function buildSearchResult(input: {
  readonly request: WorkflowPackageSearchInput;
  readonly registryFilters: readonly string[];
  readonly records: readonly WorkflowPackageIndexRecord[];
  readonly cacheBackend: WorkflowPackageCacheBackendKind;
  readonly cacheUsed: boolean;
  readonly refreshed: boolean;
}): WorkflowPackageSearchResult {
  const records =
    input.request.limit === undefined
      ? input.records
      : input.records.slice(0, input.request.limit);
  return {
    ...(input.request.query === undefined
      ? {}
      : { query: input.request.query }),
    registryFilters: input.registryFilters,
    packages: records.map(toSearchRecord),
    records,
    cache: {
      backend: input.cacheBackend,
      used: input.cacheUsed,
      refreshed: input.refreshed,
    },
    cacheUsed: input.cacheUsed,
    refreshed: input.refreshed,
  };
}

export async function searchWorkflowPackages(
  input: WorkflowPackageSearchInput = {},
): Promise<Result<WorkflowPackageSearchResult, WorkflowPackageFailure>> {
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
  const branch = input.branch ?? registry.value.defaultBranch;
  const cacheBackend = input.cacheBackend ?? "json";
  const cache = createWorkflowPackageCacheBackend(cacheBackend, input.options);
  const cached =
    input.refresh === true
      ? undefined
      : await cache.readIndex({
          registryId: registry.value.id,
          registryUrl: registry.value.url,
          branch,
        });
  if (cached !== undefined) {
    return ok(
      buildSearchResult({
        request: input,
        registryFilters: input.registry === undefined ? [] : [input.registry],
        records: cached.filter((record) => matchesSearch(record, input)),
        cacheBackend,
        cacheUsed: true,
        refreshed: false,
      }),
    );
  }
  const built = await buildRegistryIndex({
    registry: registry.value,
    branch,
    ...(input.options === undefined ? {} : { options: input.options }),
  });
  if (!built.ok) {
    return built;
  }
  await cache.writeIndex({
    registryId: registry.value.id,
    registryUrl: registry.value.url,
    branch,
    records: built.value,
  });
  return ok(
    buildSearchResult({
      request: input,
      registryFilters: input.registry === undefined ? [] : [input.registry],
      records: built.value.filter((record: WorkflowPackageIndexRecord) =>
        matchesSearch(record, input),
      ),
      cacheBackend,
      cacheUsed: false,
      refreshed: true,
    }),
  );
}
