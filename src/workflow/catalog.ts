import { readdir, stat } from "node:fs/promises";
import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { err, ok, type Result } from "./result";
import {
  computeProjectScopedRootDataDirForScopeRoot,
  inferRootDataDirFromExplicitStorageRoots,
  isSafeWorkflowName,
} from "./paths";
import type {
  AddonSourceScope,
  LoadOptions,
  ResolvedAddonSource,
  ResolvedWorkflowSource,
  WorkflowNodeAddonRef,
  WorkflowScopeSelector,
  WorkflowSourceScope,
} from "./types";

export interface WorkflowCatalogFailure {
  readonly code: "INVALID_WORKFLOW_NAME" | "INVALID_SCOPE" | "NOT_FOUND" | "IO";
  readonly message: string;
}

export interface AddonCatalogFailure {
  readonly code:
    | "INVALID_ADDON_NAME"
    | "INVALID_ADDON_VERSION"
    | "NOT_FOUND"
    | "IO";
  readonly message: string;
}

interface WorkflowRootCandidate {
  readonly scope: WorkflowSourceScope;
  readonly workflowRoot: string;
  readonly scopeRoot?: string;
}

interface AddonRootCandidate {
  readonly scope: AddonSourceScope;
  readonly addonRoot: string;
  readonly scopeRoot?: string;
}

function resolveCwd(options: LoadOptions): string {
  return options.cwd ?? process.cwd();
}

function resolveRootPath(root: string, cwd: string): string {
  return path.isAbsolute(root) ? root : path.resolve(cwd, root);
}

function resolveHomeDir(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const fromEnv = env["HOME"] ?? env["USERPROFILE"];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return os.homedir();
}

function expandLeadingHome(
  rawPath: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (rawPath === "~") {
    return resolveHomeDir(env);
  }
  if (rawPath.startsWith("~/") || rawPath.startsWith("~\\")) {
    return path.join(resolveHomeDir(env), rawPath.slice(2));
  }
  return rawPath;
}

function resolveConfiguredRootPath(
  rawPath: string,
  options: LoadOptions,
): string {
  const env = options.env ?? process.env;
  return resolveRootPath(expandLeadingHome(rawPath, env), resolveCwd(options));
}

function parseWorkflowScopeSelector(
  value: string | undefined,
): WorkflowScopeSelector | undefined {
  return value === "auto" || value === "project" || value === "user"
    ? value
    : undefined;
}

function invalidWorkflowScopeSelector(value: string): WorkflowCatalogFailure {
  return {
    code: "INVALID_SCOPE",
    message: `invalid DIVEDRA_WORKFLOW_SCOPE value '${value}'; expected auto, project, or user`,
  };
}

function resolveWorkflowScopeSelectorResult(
  options: LoadOptions = {},
): Result<WorkflowScopeSelector, WorkflowCatalogFailure> {
  if (options.workflowScope !== undefined) {
    return ok(options.workflowScope);
  }

  const env = options.env ?? process.env;
  const envScope = env["DIVEDRA_WORKFLOW_SCOPE"];
  if (envScope === undefined || envScope.length === 0) {
    return ok("auto");
  }

  const parsed = parseWorkflowScopeSelector(envScope);
  return parsed === undefined
    ? err(invalidWorkflowScopeSelector(envScope))
    : ok(parsed);
}

export function resolveWorkflowScopeSelector(
  options: LoadOptions = {},
): WorkflowScopeSelector {
  const selector = resolveWorkflowScopeSelectorResult(options);
  if (!selector.ok) {
    throw new Error(selector.error.message);
  }
  return selector.value;
}

function resolveDirectWorkflowRootOverride(
  options: LoadOptions,
): string | undefined {
  const env = options.env ?? process.env;
  const envDefinitionDir = env["DIVEDRA_WORKFLOW_DEFINITION_DIR"];
  const workflowDefinitionDir =
    envDefinitionDir !== undefined && envDefinitionDir.length > 0
      ? envDefinitionDir
      : undefined;
  const directRoot = options.workflowRoot ?? workflowDefinitionDir;
  if (directRoot === undefined || directRoot.length === 0) {
    return undefined;
  }
  return resolveConfiguredRootPath(directRoot, options);
}

function discoverProjectScopeRoot(options: LoadOptions): string | undefined {
  const env = options.env ?? process.env;
  const explicitProjectRoot =
    options.projectRoot ?? env["DIVEDRA_PROJECT_ROOT"];
  if (explicitProjectRoot !== undefined && explicitProjectRoot.length > 0) {
    return resolveConfiguredRootPath(explicitProjectRoot, options);
  }

  let current = path.resolve(resolveCwd(options));
  while (true) {
    const candidate = path.join(current, ".divedra");
    try {
      if (statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // Continue walking when this ancestor does not own a project scope.
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function resolveProjectScopeRootForCreate(options: LoadOptions): string {
  return (
    discoverProjectScopeRoot(options) ??
    path.join(path.resolve(resolveCwd(options)), ".divedra")
  );
}

function resolveUserScopeRoot(options: LoadOptions): string {
  const env = options.env ?? process.env;
  const userRoot = options.userRoot ?? env["DIVEDRA_USER_ROOT"] ?? "~/.divedra";
  return resolveConfiguredRootPath(userRoot, options);
}

function workflowRootForScope(scopeRoot: string): string {
  return path.join(scopeRoot, "workflows");
}

function addonRootForScope(scopeRoot: string): string {
  return path.join(scopeRoot, "addons");
}

async function pathIsDirectory(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function workflowExists(
  workflowRoot: string,
  workflowName: string,
): Promise<boolean> {
  try {
    return (
      await stat(path.join(workflowRoot, workflowName, "workflow.json"))
    ).isFile();
  } catch {
    return false;
  }
}

function createResolvedWorkflowSource(
  candidate: WorkflowRootCandidate,
  workflowName: string,
): ResolvedWorkflowSource {
  return {
    scope: candidate.scope,
    workflowRoot: candidate.workflowRoot,
    workflowName,
    workflowDirectory: path.join(candidate.workflowRoot, workflowName),
    ...(candidate.scopeRoot === undefined
      ? {}
      : { scopeRoot: candidate.scopeRoot }),
  };
}

const SAFE_ADDON_TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export function isSafeAddonVersion(version: string): boolean {
  return SAFE_ADDON_TOKEN_PATTERN.test(version);
}

export function isSafeAddonName(name: string): boolean {
  const segments = name.split("/");
  if (segments.length !== 2) {
    return false;
  }
  const [namespace, addonName] = segments;
  return (
    namespace !== undefined &&
    addonName !== undefined &&
    SAFE_ADDON_TOKEN_PATTERN.test(namespace) &&
    SAFE_ADDON_TOKEN_PATTERN.test(addonName)
  );
}

function isBuiltinAddonNamespace(addonName: string): boolean {
  return addonName.startsWith("divedra/");
}

function resolveDirectAddonRootOverride(
  options: LoadOptions,
): string | undefined {
  const env = options.env ?? process.env;
  const directRoot = options.addonRoot ?? env["DIVEDRA_ADDON_ROOT"];
  if (directRoot === undefined || directRoot.length === 0) {
    return undefined;
  }
  return resolveConfiguredRootPath(directRoot, options);
}

function createAddonSource(
  candidate: AddonRootCandidate,
  addon: WorkflowNodeAddonRef,
  version: string,
): ResolvedAddonSource {
  const [namespace, addonName] = addon.name.split("/");
  const addonDirectory = path.join(
    candidate.addonRoot,
    namespace ?? "",
    addonName ?? "",
    version,
  );
  return {
    scope: candidate.scope,
    addonRoot: candidate.addonRoot,
    addonName: addon.name,
    version,
    addonDirectory,
    manifestPath: path.join(addonDirectory, "addon.json"),
    ...(candidate.scopeRoot === undefined
      ? {}
      : { scopeRoot: candidate.scopeRoot }),
  };
}

function pushAddonCandidate(
  candidates: AddonRootCandidate[],
  candidate: AddonRootCandidate,
): void {
  if (
    candidates.some((existing) => existing.addonRoot === candidate.addonRoot)
  ) {
    return;
  }
  candidates.push(candidate);
}

function createScopedAddonCandidates(input: {
  readonly workflowSource?: ResolvedWorkflowSource;
  readonly options: LoadOptions;
}): readonly AddonRootCandidate[] {
  const candidates: AddonRootCandidate[] = [];
  const directAddonRoot = resolveDirectAddonRootOverride(input.options);
  if (directAddonRoot !== undefined) {
    pushAddonCandidate(candidates, {
      scope: "direct",
      addonRoot: directAddonRoot,
    });
  }

  if (
    input.workflowSource?.scope === "direct" ||
    (input.workflowSource === undefined &&
      resolveDirectWorkflowRootOverride(input.options) !== undefined)
  ) {
    return candidates;
  }

  const projectScopeRoot = discoverProjectScopeRoot(input.options);
  if (projectScopeRoot !== undefined) {
    pushAddonCandidate(candidates, {
      scope: "project",
      scopeRoot: projectScopeRoot,
      addonRoot: addonRootForScope(projectScopeRoot),
    });
  }

  const explicitUserScopeRoot =
    input.workflowSource?.scope === "user"
      ? input.workflowSource.scopeRoot
      : undefined;
  const userScopeRoot =
    explicitUserScopeRoot ?? resolveUserScopeRoot(input.options);
  if (userScopeRoot !== undefined && projectScopeRoot !== userScopeRoot) {
    pushAddonCandidate(candidates, {
      scope: "user",
      scopeRoot: userScopeRoot,
      addonRoot: addonRootForScope(userScopeRoot),
    });
  }

  return candidates;
}

export async function resolveAddonSource(input: {
  readonly addon: WorkflowNodeAddonRef;
  readonly workflowSource?: ResolvedWorkflowSource;
  readonly options?: LoadOptions;
}): Promise<Result<ResolvedAddonSource, AddonCatalogFailure>> {
  if (
    !isSafeAddonName(input.addon.name) ||
    isBuiltinAddonNamespace(input.addon.name)
  ) {
    return err({
      code: "INVALID_ADDON_NAME",
      message: `invalid local add-on name '${input.addon.name}'`,
    });
  }

  const version = input.addon.version;
  if (version === undefined || version.length === 0) {
    return err({
      code: "INVALID_ADDON_VERSION",
      message: `local add-on '${input.addon.name}' must specify an explicit version`,
    });
  }
  if (!isSafeAddonVersion(version)) {
    return err({
      code: "INVALID_ADDON_VERSION",
      message: `invalid local add-on version '${version}' for '${input.addon.name}'`,
    });
  }

  const options = input.options ?? {};
  const candidates = createScopedAddonCandidates({
    options,
    ...(input.workflowSource === undefined
      ? {}
      : { workflowSource: input.workflowSource }),
  });
  for (const candidate of candidates) {
    const source = createAddonSource(candidate, input.addon, version);
    if (await fileExists(source.manifestPath)) {
      return ok(source);
    }
  }

  const checkedRoots = candidates.map((candidate) => candidate.addonRoot);
  return err({
    code: "NOT_FOUND",
    message:
      checkedRoots.length === 0
        ? `local add-on '${input.addon.name}' was not found because no add-on scope is available`
        : `local add-on '${input.addon.name}' version '${version}' was not found in add-on roots: ${checkedRoots.join(", ")}`,
  });
}

async function createWorkflowRootCandidates(
  options: LoadOptions,
): Promise<Result<readonly WorkflowRootCandidate[], WorkflowCatalogFailure>> {
  const directRoot = resolveDirectWorkflowRootOverride(options);
  if (directRoot !== undefined) {
    return ok([{ scope: "direct", workflowRoot: directRoot }]);
  }

  const selector = resolveWorkflowScopeSelectorResult(options);
  if (!selector.ok) {
    return selector;
  }
  const candidates: WorkflowRootCandidate[] = [];
  const projectScopeRoot = discoverProjectScopeRoot(options);

  if (
    projectScopeRoot !== undefined &&
    (selector.value === "auto" || selector.value === "project")
  ) {
    const projectWorkflowRoot = workflowRootForScope(projectScopeRoot);
    candidates.push({
      scope: "project",
      scopeRoot: projectScopeRoot,
      workflowRoot: projectWorkflowRoot,
    });

    if (!(await pathIsDirectory(projectWorkflowRoot))) {
      candidates.push({
        scope: "project",
        scopeRoot: projectScopeRoot,
        workflowRoot: projectScopeRoot,
      });
    }
  }

  if (selector.value === "auto" || selector.value === "user") {
    const userScopeRoot = resolveUserScopeRoot(options);
    candidates.push({
      scope: "user",
      scopeRoot: userScopeRoot,
      workflowRoot: workflowRootForScope(userScopeRoot),
    });
  }

  return ok(candidates);
}

export async function resolveWorkflowSource(
  workflowName: string,
  options: LoadOptions = {},
): Promise<Result<ResolvedWorkflowSource, WorkflowCatalogFailure>> {
  if (!isSafeWorkflowName(workflowName)) {
    return err({
      code: "INVALID_WORKFLOW_NAME",
      message: `invalid workflow name '${workflowName}'`,
    });
  }

  const directRoot = resolveDirectWorkflowRootOverride(options);
  if (directRoot !== undefined) {
    return ok(
      createResolvedWorkflowSource(
        { scope: "direct", workflowRoot: directRoot },
        workflowName,
      ),
    );
  }

  const candidates = await createWorkflowRootCandidates(options);
  if (!candidates.ok) {
    return candidates;
  }
  for (const candidate of candidates.value) {
    if (await workflowExists(candidate.workflowRoot, workflowName)) {
      return ok(createResolvedWorkflowSource(candidate, workflowName));
    }
  }

  const checkedRoots = candidates.value.map(
    (candidate) => candidate.workflowRoot,
  );
  return err({
    code: "NOT_FOUND",
    message:
      checkedRoots.length === 0
        ? `workflow '${workflowName}' was not found because no workflow scope is available`
        : `workflow '${workflowName}' was not found in scoped workflow roots: ${checkedRoots.join(", ")}`,
  });
}

export function resolveWorkflowCreateSource(
  workflowName: string,
  options: LoadOptions = {},
): Result<ResolvedWorkflowSource, WorkflowCatalogFailure> {
  if (!isSafeWorkflowName(workflowName)) {
    return err({
      code: "INVALID_WORKFLOW_NAME",
      message: `invalid workflow name '${workflowName}'`,
    });
  }

  const directRoot = resolveDirectWorkflowRootOverride(options);
  if (directRoot !== undefined) {
    return ok(
      createResolvedWorkflowSource(
        { scope: "direct", workflowRoot: directRoot },
        workflowName,
      ),
    );
  }

  const selector = resolveWorkflowScopeSelectorResult(options);
  if (!selector.ok) {
    return selector;
  }
  if (selector.value === "user") {
    const userScopeRoot = resolveUserScopeRoot(options);
    return ok(
      createResolvedWorkflowSource(
        {
          scope: "user",
          scopeRoot: userScopeRoot,
          workflowRoot: workflowRootForScope(userScopeRoot),
        },
        workflowName,
      ),
    );
  }

  const discoveredProjectScopeRoot = discoverProjectScopeRoot(options);
  if (
    selector.value === "project" ||
    discoveredProjectScopeRoot !== undefined
  ) {
    const projectScopeRoot =
      discoveredProjectScopeRoot ?? resolveProjectScopeRootForCreate(options);
    return ok(
      createResolvedWorkflowSource(
        {
          scope: "project",
          scopeRoot: projectScopeRoot,
          workflowRoot: workflowRootForScope(projectScopeRoot),
        },
        workflowName,
      ),
    );
  }

  const userScopeRoot = resolveUserScopeRoot(options);
  return ok(
    createResolvedWorkflowSource(
      {
        scope: "user",
        scopeRoot: userScopeRoot,
        workflowRoot: workflowRootForScope(userScopeRoot),
      },
      workflowName,
    ),
  );
}

function shouldPreserveConfiguredRootDataDir(options: LoadOptions): boolean {
  const env = options.env ?? process.env;
  return (
    options.rootDataDir !== undefined ||
    env["DIVEDRA_ARTIFACT_DIR"] !== undefined
  );
}

function inferExplicitRuntimeRootDataDir(
  options: LoadOptions,
): string | undefined {
  if (shouldPreserveConfiguredRootDataDir(options)) {
    return undefined;
  }

  const env = options.env ?? process.env;
  return inferRootDataDirFromExplicitStorageRoots({
    ...(options.artifactRoot !== undefined
      ? { artifactRoot: options.artifactRoot }
      : env["DIVEDRA_ARTIFACT_ROOT"] === undefined
        ? {}
        : { artifactRoot: env["DIVEDRA_ARTIFACT_ROOT"] }),
    ...(options.sessionStoreRoot !== undefined
      ? { sessionStoreRoot: options.sessionStoreRoot }
      : env["DIVEDRA_SESSION_STORE"] === undefined
        ? {}
        : { sessionStoreRoot: env["DIVEDRA_SESSION_STORE"] }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
}

function scopedRootDataDirForSource(
  source: ResolvedWorkflowSource,
  options: LoadOptions,
): string | undefined {
  if (
    source.scope === "direct" ||
    source.scopeRoot === undefined ||
    shouldPreserveConfiguredRootDataDir(options)
  ) {
    return undefined;
  }

  const explicitRuntimeRootDataDir = inferExplicitRuntimeRootDataDir(options);
  if (explicitRuntimeRootDataDir !== undefined) {
    return explicitRuntimeRootDataDir;
  }

  if (source.scope === "project") {
    const env = options.env ?? process.env;
    return computeProjectScopedRootDataDirForScopeRoot({
      scopeRoot: source.scopeRoot,
      ...(options.userRoot !== undefined
        ? { userRoot: options.userRoot }
        : env["DIVEDRA_USER_ROOT"] === undefined
          ? {}
          : { userRoot: env["DIVEDRA_USER_ROOT"] }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
  }

  return path.join(source.scopeRoot, "artifacts");
}

export function withResolvedWorkflowSourceOptions<T extends LoadOptions>(
  source: ResolvedWorkflowSource,
  options: T,
): T & {
  readonly workflowRoot: string;
  readonly resolvedWorkflowSource: ResolvedWorkflowSource;
} {
  const scopedRootDataDir = scopedRootDataDirForSource(source, options);

  return {
    ...options,
    workflowRoot: source.workflowRoot,
    resolvedWorkflowSource: source,
    ...(scopedRootDataDir === undefined
      ? {}
      : { rootDataDir: scopedRootDataDir }),
  };
}

export async function listWorkflowCatalogSources(
  options: LoadOptions = {},
): Promise<Result<readonly ResolvedWorkflowSource[], WorkflowCatalogFailure>> {
  const sources: ResolvedWorkflowSource[] = [];
  const candidates = await createWorkflowRootCandidates(options);
  if (!candidates.ok) {
    return candidates;
  }

  for (const candidate of candidates.value) {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(candidate.workflowRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (!isSafeWorkflowName(entry.name)) {
        continue;
      }
      if (!(await workflowExists(candidate.workflowRoot, entry.name))) {
        continue;
      }
      sources.push(createResolvedWorkflowSource(candidate, entry.name));
    }
  }

  return ok(
    sources.sort((left, right) => {
      const byName = left.workflowName.localeCompare(right.workflowName);
      return byName === 0 ? left.scope.localeCompare(right.scope) : byName;
    }),
  );
}
