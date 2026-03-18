import path from "node:path";
import {
  DEFAULT_ATTACHMENT_ROOT,
  DEFAULT_WORKFLOW_ROOT,
  DEFAULT_ROOT_DATA_DIR,
  type EffectiveRoots,
  type LoadOptions,
} from "./types";

function resolveRootPath(root: string, cwd: string): string {
  return path.isAbsolute(root) ? root : path.resolve(cwd, root);
}

export function resolveRootDataDir(options: LoadOptions = {}): string {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const rootDataDir =
    options.rootDataDir ??
    env["DIVEDRA_ROOT_DATA_DIR"] ??
    env["DIVEDRA_RUNTIME_ROOT"] ??
    DEFAULT_ROOT_DATA_DIR;
  return resolveRootPath(rootDataDir, cwd);
}

export function resolveAttachmentRoot(options: LoadOptions = {}): string {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const attachmentRoot =
    env["DIVEDRA_ATTACHMENT_ROOT"] ??
    path.join(resolveRootDataDir(options), "files");
  return resolveRootPath(attachmentRoot, cwd);
}

export function resolveEffectiveRoots(
  options: LoadOptions = {},
): EffectiveRoots {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const rootDataDir = resolveRootDataDir(options);

  const workflowRoot =
    options.workflowRoot ??
    env["DIVEDRA_WORKFLOW_ROOT"] ??
    DEFAULT_WORKFLOW_ROOT;
  const artifactRoot =
    options.artifactRoot ??
    env["DIVEDRA_ARTIFACT_ROOT"] ??
    path.join(rootDataDir, "workflow");
  const attachmentRoot =
    env["DIVEDRA_ATTACHMENT_ROOT"] ??
    path.join(rootDataDir, "files");

  return {
    workflowRoot: resolveRootPath(workflowRoot, cwd),
    artifactRoot: resolveRootPath(artifactRoot, cwd),
    rootDataDir,
    attachmentRoot:
      attachmentRoot === DEFAULT_ATTACHMENT_ROOT
        ? path.join(rootDataDir, "files")
        : resolveRootPath(attachmentRoot, cwd),
  };
}

export function isSafeWorkflowName(workflowName: string): boolean {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-_]{0,63}$/.test(workflowName)) {
    return false;
  }
  return !workflowName.includes("..");
}
