import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_WORKFLOW_ROOT,
  ROOT_DATA_FILES_SUBDIR,
  ROOT_DATA_WORKFLOW_SUBDIR,
  type EffectiveRoots,
  type LoadOptions,
  type WorkflowScopeSelector,
} from "./workflow-model";

export function resolveRootPath(root: string, cwd: string): string {
  return path.isAbsolute(root) ? root : path.resolve(cwd, root);
}

export interface ExplicitRuntimeStorageRoots {
  readonly artifactRoot?: string;
  readonly sessionStoreRoot?: string;
  readonly cwd?: string;
}

export interface ProjectScopedRuntimeDataDirInput {
  readonly projectRoot: string;
  readonly userRoot?: string;
  readonly cwd?: string;
}

export interface ProjectScopeRootRuntimeDataDirInput {
  readonly scopeRoot: string;
  readonly userRoot?: string;
  readonly cwd?: string;
}

function resolveHomeDir(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const fromEnv = env["HOME"] ?? env["USERPROFILE"];
  return fromEnv === undefined || fromEnv.length === 0 ? os.homedir() : fromEnv;
}

export function expandLeadingHome(
  root: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (root === "~") {
    return resolveHomeDir(env);
  }
  if (root.startsWith("~/") || root.startsWith("~\\")) {
    return path.join(resolveHomeDir(env), root.slice(2));
  }
  return root;
}

export function resolveConfiguredRootPath(
  root: string,
  options: Pick<LoadOptions, "cwd" | "env"> = {},
): string {
  return resolveRootPath(
    expandLeadingHome(root, options.env ?? process.env),
    options.cwd ?? process.cwd(),
  );
}

function resolveNearestWorkflowProjectRoot(cwd: string): string {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, ".divedra");
    try {
      if (statSync(candidate).isDirectory()) {
        return current;
      }
    } catch {
      // Keep walking upward when `.divedra` is absent or unreadable.
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(cwd);
    }
    current = parent;
  }
}

export function resolveRootDataDir(options: LoadOptions = {}): string {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const rootDataDir =
    options.rootDataDir ??
    env["DIVEDRA_ARTIFACT_DIR"] ??
    computeDefaultRootDataDir(options.userRoot ?? env["DIVEDRA_USER_ROOT"]);
  return resolveRootPath(rootDataDir, cwd);
}

export function resolveAttachmentRoot(options: LoadOptions = {}): string {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const rootDataDir = resolveRootDataDir(options);
  const attachmentRoot =
    env["DIVEDRA_ATTACHMENT_ROOT"] !== undefined &&
    env["DIVEDRA_ATTACHMENT_ROOT"] !== ""
      ? resolveRootPath(env["DIVEDRA_ATTACHMENT_ROOT"], cwd)
      : path.join(rootDataDir, ROOT_DATA_FILES_SUBDIR);
  return attachmentRoot;
}

export function resolveSafeScopedPath(
  root: string,
  ...segments: readonly string[]
): string | undefined {
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\"),
    )
  ) {
    return undefined;
  }

  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
    ? resolvedTarget
    : undefined;
}

export function resolveWorkflowScopedPath(
  root: string,
  workflowId: string,
  ...segments: readonly string[]
): string | undefined {
  return isSafeWorkflowId(workflowId)
    ? resolveSafeScopedPath(root, workflowId, ...segments)
    : undefined;
}

export function resolveEffectiveRoots(
  options: LoadOptions = {},
): EffectiveRoots {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const projectRoot = resolveNearestWorkflowProjectRoot(cwd);
  const rootDataDir = resolveRootDataDir(options);
  const envWorkflowDefinitionDir = env["DIVEDRA_WORKFLOW_DEFINITION_DIR"];
  const workflowDefinitionDir =
    envWorkflowDefinitionDir !== undefined &&
    envWorkflowDefinitionDir.length > 0
      ? envWorkflowDefinitionDir
      : undefined;

  const workflowRoot =
    options.workflowRoot ??
    workflowDefinitionDir ??
    path.join(projectRoot, DEFAULT_WORKFLOW_ROOT);
  const artifactRoot =
    options.artifactRoot ??
    env["DIVEDRA_ARTIFACT_ROOT"] ??
    path.join(rootDataDir, ROOT_DATA_WORKFLOW_SUBDIR);

  return {
    workflowRoot: resolveRootPath(workflowRoot, cwd),
    artifactRoot: resolveRootPath(artifactRoot, cwd),
    rootDataDir,
    attachmentRoot: resolveAttachmentRoot(options),
  };
}

export function inferRootDataDirFromExplicitStorageRoots(
  input: ExplicitRuntimeStorageRoots,
): string | undefined {
  const cwd = input.cwd ?? process.cwd();
  const artifactRoot =
    input.artifactRoot === undefined
      ? undefined
      : resolveRootPath(input.artifactRoot, cwd);
  const sessionStoreRoot =
    input.sessionStoreRoot === undefined
      ? undefined
      : resolveRootPath(input.sessionStoreRoot, cwd);

  if (artifactRoot !== undefined && sessionStoreRoot !== undefined) {
    const artifactParent = path.dirname(artifactRoot);
    const sessionStoreParent = path.dirname(sessionStoreRoot);
    return artifactParent === sessionStoreParent ? artifactParent : undefined;
  }
  if (artifactRoot !== undefined) {
    return path.dirname(artifactRoot);
  }
  if (sessionStoreRoot !== undefined) {
    return path.dirname(sessionStoreRoot);
  }
  return undefined;
}
/**
 * Default root data directory when no env override is set:
 * `<user-root>/artifacts`, where user root defaults to `~/.divedra`.
 */
export function computeDefaultRootDataDir(userRoot?: string): string {
  const resolvedUserRoot = expandLeadingHome(userRoot ?? "~/.divedra");
  return path.join(resolvedUserRoot, "artifacts");
}

export function encodeProjectRootForRuntimeData(projectRoot: string): string {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const canonicalProjectRoot = (() => {
    try {
      return realpathSync.native(resolvedProjectRoot);
    } catch {
      return resolvedProjectRoot;
    }
  })();
  const slug =
    path
      .basename(canonicalProjectRoot)
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "project";
  const digest = createHash("sha256")
    .update(path.resolve(canonicalProjectRoot))
    .digest("hex")
    .slice(0, 16);
  return `${slug}-${digest}`;
}

export function computeProjectScopedRootDataDir(
  input: ProjectScopedRuntimeDataDirInput,
): string {
  const cwd = input.cwd ?? process.cwd();
  const resolvedUserRoot = resolveRootPath(
    expandLeadingHome(input.userRoot ?? "~/.divedra"),
    cwd,
  );
  return path.join(
    resolvedUserRoot,
    "projects",
    encodeProjectRootForRuntimeData(input.projectRoot),
    "artifacts",
  );
}

export function resolveProjectRootForScopeRoot(scopeRoot: string): string {
  const resolvedScopeRoot = path.resolve(scopeRoot);
  return path.basename(resolvedScopeRoot) === ".divedra"
    ? path.dirname(resolvedScopeRoot)
    : resolvedScopeRoot;
}

export function computeProjectScopedRootDataDirForScopeRoot(
  input: ProjectScopeRootRuntimeDataDirInput,
): string {
  return computeProjectScopedRootDataDir({
    projectRoot: resolveProjectRootForScopeRoot(input.scopeRoot),
    ...(input.userRoot === undefined ? {} : { userRoot: input.userRoot }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
  });
}

const SAFE_WORKFLOW_TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]{0,63}$/;

export function isSafeWorkflowId(workflowId: string): boolean {
  return SAFE_WORKFLOW_TOKEN_PATTERN.test(workflowId);
}

export function isSafeWorkflowName(workflowName: string): boolean {
  return isSafeWorkflowId(workflowName);
}

export function parseWorkflowScopeSelector(
  value: string | undefined,
): WorkflowScopeSelector | undefined {
  return value === "auto" || value === "project" || value === "user"
    ? value
    : undefined;
}

/** Supervision run ids are minted as `sup-` + hex (see engine). */
const SUPERVISION_RUN_ID_PATTERN = /^sup-[0-9a-f]{8,64}$/;

export function isSafeSupervisionRunId(id: string): boolean {
  return SUPERVISION_RUN_ID_PATTERN.test(id);
}

/**
 * Directory for an execution-scoped copy of a workflow under the artifact root:
 * `<artifactRoot>/supervision/<supervisionRunId>/mutable/<workflowId>`.
 */
export function resolveSupervisionMutableWorkflowDirectory(
  artifactRoot: string,
  supervisionRunId: string,
  workflowId: string,
): string | undefined {
  if (
    !isSafeSupervisionRunId(supervisionRunId) ||
    !isSafeWorkflowId(workflowId)
  ) {
    return undefined;
  }
  return resolveSafeScopedPath(
    artifactRoot,
    "supervision",
    supervisionRunId,
    "mutable",
    workflowId,
  );
}

/**
 * Per-supervision-run directory: `<artifactRoot>/supervision/<supervisionRunId>`.
 */
export function resolveSupervisionRunDirectory(
  artifactRoot: string,
  supervisionRunId: string,
): string | undefined {
  if (!isSafeSupervisionRunId(supervisionRunId)) {
    return undefined;
  }
  return resolveSafeScopedPath(artifactRoot, "supervision", supervisionRunId);
}
