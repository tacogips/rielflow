import { readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJsonFile } from "../../shared/fs";
import { resolveConfiguredRootPath } from "../paths";
import { err, ok, type Result } from "../result";
import { normalizeWorkflowPackageTrustedSigners } from "./integrity";
import {
  DEFAULT_WORKFLOW_PACKAGE_REGISTRY_BRANCH,
  DEFAULT_WORKFLOW_PACKAGE_REGISTRY_ID,
  DEFAULT_WORKFLOW_PACKAGE_REGISTRY_LOCAL_PATH,
  DEFAULT_WORKFLOW_PACKAGE_REGISTRY_URL,
  type WorkflowPackageFailure,
  type WorkflowPackageRegistryConfig,
  type WorkflowPackageRegistryConfigOptions,
  type WorkflowPackageRegistryEntry,
} from "./types";

function packageFailure(
  code: WorkflowPackageFailure["code"],
  message: string,
): WorkflowPackageFailure {
  return { code, message };
}

export function resolveWorkflowPackageRoot(
  options: WorkflowPackageRegistryConfigOptions,
): string {
  const env = options.env ?? process.env;
  const configured = options.userRoot ?? env["RIEL_USER_ROOT"] ?? "~/.rielflow";
  return path.join(
    resolveConfiguredRootPath(configured, {
      env,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    }),
    "workflow-packages",
  );
}

export function resolveWorkflowPackageRegistryConfigPath(
  options: WorkflowPackageRegistryConfigOptions,
): string {
  return path.join(resolveWorkflowPackageRoot(options), "registries.json");
}

export function isSafeWorkflowPackageRegistryId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id);
}

export function isSupportedGitHubRepositoryUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "github.com" &&
      segments.length === 2
    );
  } catch {
    return false;
  }
}

export function createDefaultWorkflowPackageRegistryConfig(
  now: Date,
): WorkflowPackageRegistryConfig {
  const timestamp = now.toISOString();
  return {
    defaultRegistryId: DEFAULT_WORKFLOW_PACKAGE_REGISTRY_ID,
    registries: [
      {
        id: DEFAULT_WORKFLOW_PACKAGE_REGISTRY_ID,
        url: DEFAULT_WORKFLOW_PACKAGE_REGISTRY_URL,
        defaultBranch: DEFAULT_WORKFLOW_PACKAGE_REGISTRY_BRANCH,
        localPath: DEFAULT_WORKFLOW_PACKAGE_REGISTRY_LOCAL_PATH,
        registeredAt: timestamp,
        updatedAt: timestamp,
        description: "Default rielflow workflow package registry",
        priority: 0,
      },
    ],
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRegistryEntry(
  value: unknown,
): Result<WorkflowPackageRegistryEntry, WorkflowPackageFailure> {
  if (!isRecord(value)) {
    return err(packageFailure("INVALID_REGISTRY", "registry entry is invalid"));
  }
  const id = value["id"];
  const url = value["url"];
  const defaultBranch = value["defaultBranch"];
  const registeredAt = value["registeredAt"];
  const updatedAt = value["updatedAt"];
  if (
    typeof id !== "string" ||
    typeof url !== "string" ||
    typeof defaultBranch !== "string" ||
    typeof registeredAt !== "string" ||
    typeof updatedAt !== "string"
  ) {
    return err(
      packageFailure("INVALID_REGISTRY", "registry entry is missing fields"),
    );
  }
  if (!isSafeWorkflowPackageRegistryId(id)) {
    return err(
      packageFailure("INVALID_REGISTRY", `invalid registry id '${id}'`),
    );
  }
  if (!isSupportedGitHubRepositoryUrl(url)) {
    return err(
      packageFailure(
        "INVALID_REGISTRY",
        `registry '${id}' must use an https://github.com/<owner>/<repo> URL`,
      ),
    );
  }
  const localPath = value["localPath"];
  const description = value["description"];
  const priority = value["priority"];
  const trustedSigners = normalizeWorkflowPackageTrustedSigners(
    value["trustedSigners"],
  );
  if (!trustedSigners.ok) {
    return trustedSigners;
  }
  const requireSignature = value["requireSignature"];
  if (requireSignature !== undefined && typeof requireSignature !== "boolean") {
    return err(
      packageFailure(
        "INVALID_REGISTRY",
        "registry requireSignature must be a boolean",
      ),
    );
  }
  return ok({
    id,
    url,
    defaultBranch,
    registeredAt,
    updatedAt,
    ...(typeof localPath === "string" && localPath.length > 0
      ? { localPath }
      : {}),
    ...(typeof description === "string" ? { description } : {}),
    ...(typeof priority === "number" && Number.isFinite(priority)
      ? { priority }
      : {}),
    ...(trustedSigners.value === undefined
      ? {}
      : { trustedSigners: trustedSigners.value }),
    ...(requireSignature === undefined ? {} : { requireSignature }),
  });
}

export function normalizeWorkflowPackageRegistryConfig(
  value: unknown,
): Result<WorkflowPackageRegistryConfig, WorkflowPackageFailure> {
  if (!isRecord(value) || !Array.isArray(value["registries"])) {
    return err(
      packageFailure("INVALID_REGISTRY", "registry config is invalid"),
    );
  }
  const defaultRegistryId = value["defaultRegistryId"];
  if (typeof defaultRegistryId !== "string") {
    return err(
      packageFailure("INVALID_REGISTRY", "defaultRegistryId is required"),
    );
  }
  const registries: WorkflowPackageRegistryEntry[] = [];
  for (const entry of value["registries"]) {
    const normalized = normalizeRegistryEntry(entry);
    if (!normalized.ok) {
      return normalized;
    }
    registries.push(normalized.value);
  }
  if (!registries.some((entry) => entry.id === defaultRegistryId)) {
    return err(
      packageFailure(
        "INVALID_REGISTRY",
        `default registry '${defaultRegistryId}' is not registered`,
      ),
    );
  }
  return ok({
    defaultRegistryId,
    registries: [...registries].sort(
      (left, right) => (left.priority ?? 100) - (right.priority ?? 100),
    ),
  });
}

export async function loadWorkflowPackageRegistryConfig(
  options: WorkflowPackageRegistryConfigOptions = {},
): Promise<Result<WorkflowPackageRegistryConfig, WorkflowPackageFailure>> {
  const configPath = resolveWorkflowPackageRegistryConfigPath(options);
  try {
    const raw = await readFile(configPath, "utf8");
    return normalizeWorkflowPackageRegistryConfig(JSON.parse(raw) as unknown);
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { readonly code?: unknown }).code
        : undefined;
    if (code === "ENOENT") {
      const created = createDefaultWorkflowPackageRegistryConfig(
        options.now ?? new Date(),
      );
      await atomicWriteJsonFile(configPath, created);
      return ok(created);
    }
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      packageFailure(
        "IO",
        `failed to load workflow package registry config: ${message}`,
      ),
    );
  }
}

export async function saveWorkflowPackageRegistryConfig(
  config: WorkflowPackageRegistryConfig,
  options: WorkflowPackageRegistryConfigOptions = {},
): Promise<Result<WorkflowPackageRegistryConfig, WorkflowPackageFailure>> {
  const normalized = normalizeWorkflowPackageRegistryConfig(config);
  if (!normalized.ok) {
    return normalized;
  }
  try {
    await atomicWriteJsonFile(
      resolveWorkflowPackageRegistryConfigPath(options),
      normalized.value,
    );
    return normalized;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      packageFailure(
        "IO",
        `failed to save workflow package registry config: ${message}`,
      ),
    );
  }
}

export async function registerWorkflowPackageRegistry(input: {
  readonly id: string;
  readonly url: string;
  readonly localPath?: string;
  readonly branch?: string;
  readonly description?: string;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}): Promise<Result<WorkflowPackageRegistryConfig, WorkflowPackageFailure>> {
  if (!isSafeWorkflowPackageRegistryId(input.id)) {
    return err(
      packageFailure("INVALID_REGISTRY", `invalid registry id '${input.id}'`),
    );
  }
  if (!isSupportedGitHubRepositoryUrl(input.url)) {
    return err(
      packageFailure(
        "INVALID_REGISTRY",
        "registry URL must be https://github.com/<owner>/<repo>",
      ),
    );
  }
  const loaded = await loadWorkflowPackageRegistryConfig(input.options);
  if (!loaded.ok) {
    return loaded;
  }
  const now = (input.options?.now ?? new Date()).toISOString();
  const existing = loaded.value.registries.find(
    (entry) => entry.id === input.id,
  );
  const nextEntry: WorkflowPackageRegistryEntry = {
    id: input.id,
    url: input.url,
    defaultBranch: input.branch ?? existing?.defaultBranch ?? "main",
    registeredAt: existing?.registeredAt ?? now,
    updatedAt: now,
    ...(input.localPath !== undefined || existing?.localPath !== undefined
      ? { localPath: input.localPath ?? existing?.localPath ?? "" }
      : {}),
    ...(input.description !== undefined || existing?.description !== undefined
      ? { description: input.description ?? existing?.description ?? "" }
      : {}),
    ...(existing?.priority === undefined
      ? {}
      : { priority: existing.priority }),
    ...(existing?.trustedSigners === undefined
      ? {}
      : { trustedSigners: existing.trustedSigners }),
    ...(existing?.requireSignature === undefined
      ? {}
      : { requireSignature: existing.requireSignature }),
  };
  return saveWorkflowPackageRegistryConfig(
    {
      defaultRegistryId: loaded.value.defaultRegistryId,
      registries: [
        nextEntry,
        ...loaded.value.registries.filter((entry) => entry.id !== input.id),
      ],
    },
    input.options,
  );
}

export function resolveWorkflowPackageRegistryEntry(
  config: WorkflowPackageRegistryConfig,
  selector?: string,
): Result<WorkflowPackageRegistryEntry, WorkflowPackageFailure> {
  const selected = selector ?? config.defaultRegistryId;
  const entry = config.registries.find(
    (candidate) => candidate.id === selected || candidate.url === selected,
  );
  return entry === undefined
    ? err(
        packageFailure("MISSING_REGISTRY", `registry '${selected}' not found`),
      )
    : ok(entry);
}
