import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_WORKFLOW_ROOT,
  ROOT_DATA_FILES_SUBDIR,
  ROOT_DATA_WORKFLOW_SUBDIR,
  type EffectiveRoots,
  type LoadOptions,
} from "./types";

function resolveRootPath(root: string, cwd: string): string {
  return path.isAbsolute(root) ? root : path.resolve(cwd, root);
}

export interface ExplicitRuntimeStorageRoots {
  readonly artifactRoot?: string;
  readonly sessionStoreRoot?: string;
  readonly cwd?: string;
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
  const scopedProjectRoot = resolveNearestWorkflowProjectRoot(cwd);
  const rootDataDir =
    options.rootDataDir ??
    env["DIVEDRA_ARTIFACT_DIR"] ??
    env["DIVEDRA_ROOT_DATA_DIR"] ??
    env["DIVEDRA_RUNTIME_ROOT"] ??
    computeDefaultRootDataDir(scopedProjectRoot);
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

  const workflowRoot =
    options.workflowRoot ??
    env["DIVEDRA_WORKFLOW_ROOT"] ??
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
 * Encodes an absolute filesystem path for use under `~/.divedra/project/<encoded>/divedra-artifact`.
 * Path segments (split on `/` and `\\`) are joined with `__`, and characters
 * that are problematic in portable directory names are normalized to `_`.
 */
export function encodeProjectPathForDivedraScope(absolutePath: string): string {
  const normalized = path.resolve(absolutePath);
  const segments = normalized
    .split(/[/\\]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, "_"));
  if (segments.length === 0) {
    return "root";
  }
  return segments.join("__");
}

/**
 * Default root data directory when no env override is set:
 * `~/.divedra/project/<encode(cwd)>/divedra-artifact`
 */
export function computeDefaultRootDataDir(cwd: string): string {
  const encoded = encodeProjectPathForDivedraScope(cwd);
  return path.join(
    os.homedir(),
    ".divedra",
    "project",
    encoded,
    "divedra-artifact",
  );
}

const SAFE_WORKFLOW_TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]{0,63}$/;

export function isSafeWorkflowId(workflowId: string): boolean {
  return SAFE_WORKFLOW_TOKEN_PATTERN.test(workflowId);
}

export function isSafeWorkflowName(workflowName: string): boolean {
  return isSafeWorkflowId(workflowName);
}
