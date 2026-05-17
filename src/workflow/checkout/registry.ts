import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWriteJsonFile } from "../../shared/fs";
import { isSafeWorkflowName, resolveSafeScopedPath } from "../paths";
import type { LoadOptions } from "../types";
import { err, ok, type Result } from "../result";
import type { WorkflowCheckoutFailure, WorkflowCheckoutScope } from "./types";

export interface WorkflowCheckoutDestination {
  readonly scope: WorkflowCheckoutScope;
  readonly scopeRoot: string;
  readonly workflowRoot: string;
  readonly workflowDirectory: string;
  readonly registryPath: string;
}

export interface WorkflowCheckoutRegistryRecord {
  readonly workflowName: string;
  readonly sourceUrl: string;
  readonly scope: WorkflowCheckoutScope;
  readonly checkedOutAt: string;
  readonly destinationDirectory: string;
}

function checkoutFailure(
  code: WorkflowCheckoutFailure["code"],
  message: string,
): WorkflowCheckoutFailure {
  return { code, message };
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
  return fromEnv === undefined || fromEnv.length === 0 ? os.homedir() : fromEnv;
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
      // Keep walking until an ancestor project scope is discovered.
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function resolveProjectScopeRootForCheckout(options: LoadOptions): string {
  return (
    discoverProjectScopeRoot(options) ??
    path.join(path.resolve(resolveCwd(options)), ".divedra")
  );
}

export function resolveUserScopeRootForCheckout(options: LoadOptions): string {
  const env = options.env ?? process.env;
  const userRoot = options.userRoot ?? env["DIVEDRA_USER_ROOT"] ?? "~/.divedra";
  return resolveConfiguredRootPath(userRoot, options);
}

function directWorkflowRootOverride(options: LoadOptions): string | undefined {
  const env = options.env ?? process.env;
  const envDefinitionDir = env["DIVEDRA_WORKFLOW_DEFINITION_DIR"];
  return options.workflowRoot ?? envDefinitionDir;
}

export function resolveWorkflowCheckoutDestination(
  workflowName: string,
  options: LoadOptions & { readonly userScope?: boolean },
): Result<WorkflowCheckoutDestination, WorkflowCheckoutFailure> {
  if (!isSafeWorkflowName(workflowName)) {
    return err({
      code: "INVALID_WORKFLOW_NAME",
      message: `invalid workflow name '${workflowName}'`,
    });
  }

  if (directWorkflowRootOverride(options) !== undefined) {
    return err(
      checkoutFailure(
        "USAGE",
        "workflow checkout does not support --workflow-definition-dir; use project scope or --user-scope",
      ),
    );
  }

  const userScopeRoot = resolveUserScopeRootForCheckout(options);
  const scope: WorkflowCheckoutScope =
    options.userScope === true ? "user" : "project";
  const scopeRoot =
    scope === "user"
      ? userScopeRoot
      : resolveProjectScopeRootForCheckout(options);
  const workflowRoot = path.join(scopeRoot, "workflows");
  const workflowDirectory = resolveSafeScopedPath(workflowRoot, workflowName);
  if (workflowDirectory === undefined) {
    return err(
      checkoutFailure(
        "UNSAFE_DESTINATION",
        `checkout destination is not safe for workflow '${workflowName}'`,
      ),
    );
  }

  return ok({
    scope,
    scopeRoot,
    workflowRoot,
    workflowDirectory,
    registryPath: path.join(
      userScopeRoot,
      "workflow-registry",
      "checkouts",
      `${scope}-${workflowName}.json`,
    ),
  });
}

export function createWorkflowCheckoutRegistryRecord(input: {
  readonly workflowName: string;
  readonly sourceUrl: string;
  readonly scope: WorkflowCheckoutScope;
  readonly checkedOutAt: Date;
  readonly destinationDirectory: string;
}): WorkflowCheckoutRegistryRecord {
  return {
    workflowName: input.workflowName,
    sourceUrl: input.sourceUrl,
    scope: input.scope,
    checkedOutAt: input.checkedOutAt.toISOString(),
    destinationDirectory: input.destinationDirectory,
  };
}

export async function writeWorkflowCheckoutRegistryRecord(
  registryPath: string,
  record: WorkflowCheckoutRegistryRecord,
): Promise<void> {
  await atomicWriteJsonFile(registryPath, record);
}
