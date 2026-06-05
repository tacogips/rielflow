import {
  isRecord,
  makeIssue,
  normalizePositiveInteger as normalizePositiveIntegerValue,
  normalizePositiveNumber as normalizePositiveNumberField,
  normalizeStringArray as normalizeStringArrayField,
  normalizeStringMap as normalizeStringMapField,
  readNumberField,
  readStringField,
  type UnknownRecord,
} from "rielflow-core/workflow-validation";
import {
  DEFAULT_MONITOR_INTERVAL_MS,
  DEFAULT_STALL_TIMEOUT_MS,
} from "../auto-improve-policy";
import {
  isReservedWorkflowDefinitionPath,
  isSafeWorkflowRelativePath,
} from "../prompt-template-file";
import type { Result } from "../result";
import type { NodeValidationResult } from "./node-validation-result";
import {
  DEFAULT_CONTAINER_RUNNER_KIND,
  type CommandExecution,
  type ContainerBuild,
  type ContainerRunnerKind,
  type ContainerRuntimeDefaults,
  type LoadOptions,
  type NodeExecutionBackend,
  type NodeRole,
  type NodeSessionPolicy,
  type NodeType,
  type NormalizedWorkflowBundle,
  type ValidationIssue,
  type WorkflowSupervisionDefaults,
} from "../types";
import { normalizeWorkingDirectoryPath } from "../working-directory";

export interface RawBundle {
  readonly workflow: unknown;
  readonly nodePayloads: Readonly<Record<string, unknown>>;
}
export interface NodeStepRoleUsage {
  readonly manager: boolean;
  readonly worker: boolean;
}
export interface WorkflowValidationOptions
  extends Pick<
    LoadOptions,
    | "workflowRoot"
    | "workflowScope"
    | "userRoot"
    | "projectRoot"
    | "addonRoot"
    | "resolvedWorkflowSource"
    | "env"
    | "cwd"
    | "nodeAddons"
    | "asyncNodeAddonResolvers"
    | "nodeAddonResolvers"
    | "nodePatch"
    | "directExecutableAddonGrants"
    | "addonDependencyLocks"
    | "allowUnpackagedExecutableAddons"
  > {
  readonly allowResolvedStepFileFields?: boolean;
  readonly executablePreflight?: boolean;
  readonly skipCrossWorkflowCalleeEntryValidation?: boolean;
  readonly workflowCalleeEntryResolver?:
    | WorkflowCalleeEntryResolver
    | undefined;
  readonly preloadedWorkflowCalleeEntries?:
    | ReadonlyMap<string, WorkflowCalleeEntryResolution>
    | undefined;
}
export interface WorkflowCalleeEntryRequest {
  readonly workflowRoot: string;
  readonly workflowId: string;
}
export interface WorkflowCalleeEntryResolution {
  readonly workflowId: string;
  readonly entryStepId: string;
  readonly workflowDirectory: string;
  readonly source: "effective-loader" | "preloaded-sync";
}
export type WorkflowCalleeEntryResolver = (
  input: WorkflowCalleeEntryRequest,
) => Promise<
  | { readonly ok: true; readonly value: WorkflowCalleeEntryResolution }
  | { readonly ok: false; readonly message: string }
>;
export function isStrictWorkflowAuthorshipValidation(
  _options: WorkflowValidationOptions,
): boolean {
  return true;
}
export type ValidationResult = Result<
  NormalizedWorkflowBundle,
  readonly ValidationIssue[]
>;
export interface ValidationSuccessDetails {
  readonly bundle: NormalizedWorkflowBundle;
  readonly issues: readonly ValidationIssue[];
  readonly nodeValidationResults: readonly NodeValidationResult[];
}
export {
  isRecord,
  makeIssue,
  normalizePositiveIntegerValue,
  normalizePositiveNumberField,
  normalizeStringArrayField,
  normalizeStringMapField,
  readNumberField,
  readStringField,
  type UnknownRecord,
};
export function requiresSeparatedModel(
  executionBackend: NodeExecutionBackend | undefined,
): executionBackend is NodeExecutionBackend {
  return executionBackend !== undefined;
}
export function isLegacyCliModelIdentifier(value: unknown): value is string {
  return (
    value === "tacogips/codex-agent" || value === "tacogips/claude-code-agent"
  );
}
export function isNodeSessionMode(
  value: unknown,
): value is NodeSessionPolicy["mode"] {
  return value === "new" || value === "reuse";
}
export function isNodeType(value: unknown): value is NodeType {
  return (
    value === "agent" ||
    value === "command" ||
    value === "container" ||
    value === "sleep" ||
    value === "user-action"
  );
}
export function isContainerRunnerKind(
  value: unknown,
): value is ContainerRunnerKind {
  return (
    value === "podman" ||
    value === "docker" ||
    value === "nerdctl" ||
    value === "apple-container"
  );
}
export function normalizeWorkingDirectoryField(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    try {
      return normalizeWorkingDirectoryPath(value);
    } catch {
      // Validation reports the normalized issue below.
    }
  }
  issues.push(
    makeIssue(
      "error",
      path,
      "must be a non-empty absolute or relative path when provided",
    ),
  );
  return undefined;
}
export function normalizeNodeRole(value: unknown): NodeRole | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "manager" || value === "worker") {
    return value;
  }
  return undefined;
}
export function readPositiveIntegerField(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
): number | null {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    issues.push(
      makeIssue("error", `${path}.${key}`, "must be a positive integer"),
    );
    return null;
  }
  return value;
}
export function normalizeNonNegativeIntegerValue(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  issues.push(makeIssue("error", path, "must be a non-negative integer"));
  return undefined;
}
export function isAbsoluteContainerPath(value: string): boolean {
  return value.startsWith("/");
}
export function normalizeContainerBuild(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  options?: { readonly allowRuntimeAddonBuildPaths?: boolean },
): ContainerBuild | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const allowedKeys = new Set([
    "contextPath",
    "containerfilePath",
    "target",
    ...(options?.allowRuntimeAddonBuildPaths === true
      ? ["runtimeContextPath", "runtimeContainerfilePath"]
      : []),
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported container build field",
        ),
      );
    }
  }

  const contextPath = readStringField(value, "contextPath", path, issues);
  if (contextPath !== null && !isSafeWorkflowRelativePath(contextPath)) {
    issues.push(
      makeIssue(
        "error",
        `${path}.contextPath`,
        "must be a workflow-relative path without '.' or '..' segments",
      ),
    );
  }

  const containerfilePathRaw = value["containerfilePath"];
  let containerfilePath: string | undefined;
  if (containerfilePathRaw !== undefined) {
    if (
      typeof containerfilePathRaw !== "string" ||
      containerfilePathRaw.length === 0
    ) {
      issues.push(
        makeIssue(
          "error",
          `${path}.containerfilePath`,
          "must be a non-empty string when provided",
        ),
      );
    } else if (!isSafeWorkflowRelativePath(containerfilePathRaw)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.containerfilePath`,
          "must be a workflow-relative path without '.' or '..' segments",
        ),
      );
    } else if (isReservedWorkflowDefinitionPath(containerfilePathRaw)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.containerfilePath`,
          "must not target canonical workflow definition files such as workflow.json or node-*.json",
        ),
      );
    } else {
      containerfilePath = containerfilePathRaw;
    }
  }

  if (value["dockerfilePath"] !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.dockerfilePath`,
        "legacy field 'dockerfilePath' is not supported; use 'containerfilePath'",
      ),
    );
  }
  const targetRaw = value["target"];
  let target: string | undefined;
  if (targetRaw !== undefined) {
    if (typeof targetRaw === "string" && targetRaw.length > 0) {
      target = targetRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.target`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }
  let runtimeContextPath: string | undefined;
  const runtimeContextPathRaw = value["runtimeContextPath"];
  if (runtimeContextPathRaw !== undefined) {
    if (
      options?.allowRuntimeAddonBuildPaths === true &&
      typeof runtimeContextPathRaw === "string" &&
      runtimeContextPathRaw.length > 0
    ) {
      runtimeContextPath = runtimeContextPathRaw;
    } else if (options?.allowRuntimeAddonBuildPaths === true) {
      issues.push(
        makeIssue(
          "error",
          `${path}.runtimeContextPath`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }
  let runtimeContainerfilePath: string | undefined;
  const runtimeContainerfilePathRaw = value["runtimeContainerfilePath"];
  if (runtimeContainerfilePathRaw !== undefined) {
    if (
      options?.allowRuntimeAddonBuildPaths === true &&
      typeof runtimeContainerfilePathRaw === "string" &&
      runtimeContainerfilePathRaw.length > 0
    ) {
      runtimeContainerfilePath = runtimeContainerfilePathRaw;
    } else if (options?.allowRuntimeAddonBuildPaths === true) {
      issues.push(
        makeIssue(
          "error",
          `${path}.runtimeContainerfilePath`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  if (contextPath === null || !isSafeWorkflowRelativePath(contextPath)) {
    return undefined;
  }

  return {
    contextPath,
    ...(containerfilePath === undefined ? {} : { containerfilePath }),
    ...(runtimeContextPath === undefined ? {} : { runtimeContextPath }),
    ...(runtimeContainerfilePath === undefined
      ? {}
      : { runtimeContainerfilePath }),
    ...(target === undefined ? {} : { target }),
  };
}
export function normalizeContainerRuntimeDefaults(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): ContainerRuntimeDefaults {
  if (value === undefined) {
    return { runnerKind: DEFAULT_CONTAINER_RUNNER_KIND };
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return { runnerKind: DEFAULT_CONTAINER_RUNNER_KIND };
  }

  const allowedKeys = new Set(["runnerKind", "runnerPath"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported container runtime defaults field",
        ),
      );
    }
  }

  const runnerKindRaw = value["runnerKind"];
  let runnerKind = DEFAULT_CONTAINER_RUNNER_KIND;
  if (runnerKindRaw !== undefined) {
    if (isContainerRunnerKind(runnerKindRaw)) {
      runnerKind = runnerKindRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.runnerKind`,
          "must be podman, docker, nerdctl, or apple-container",
        ),
      );
    }
  }

  const runnerPathRaw = value["runnerPath"];
  let runnerPath: string | undefined;
  if (runnerPathRaw !== undefined) {
    if (typeof runnerPathRaw === "string" && runnerPathRaw.length > 0) {
      runnerPath = runnerPathRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.runnerPath`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  return {
    runnerKind,
    ...(runnerPath === undefined ? {} : { runnerPath }),
  };
}
export function normalizeWorkflowSupervisionDefaults(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowSupervisionDefaults | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const superviserWorkflowIdRaw = value["superviserWorkflowId"];
  let superviserWorkflowId: string | undefined;
  if (superviserWorkflowIdRaw !== undefined) {
    if (
      typeof superviserWorkflowIdRaw === "string" &&
      superviserWorkflowIdRaw.trim().length > 0
    ) {
      superviserWorkflowId = superviserWorkflowIdRaw.trim();
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.superviserWorkflowId`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const monitorIntervalMs = normalizePositiveIntegerValue(
    value["monitorIntervalMs"],
    `${path}.monitorIntervalMs`,
    issues,
  );
  const stallTimeoutMs = normalizePositiveIntegerValue(
    value["stallTimeoutMs"],
    `${path}.stallTimeoutMs`,
    issues,
  );
  const maxSupervisedAttempts = normalizePositiveIntegerValue(
    value["maxSupervisedAttempts"],
    `${path}.maxSupervisedAttempts`,
    issues,
  );
  const maxWorkflowPatches = normalizeNonNegativeIntegerValue(
    value["maxWorkflowPatches"],
    `${path}.maxWorkflowPatches`,
    issues,
  );

  const workflowMutationModeRaw = value["workflowMutationMode"];
  let workflowMutationMode: "execution-copy" | "in-place" | undefined;
  if (workflowMutationModeRaw !== undefined) {
    if (
      workflowMutationModeRaw === "execution-copy" ||
      workflowMutationModeRaw === "in-place"
    ) {
      workflowMutationMode = workflowMutationModeRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.workflowMutationMode`,
          "must be 'execution-copy' or 'in-place' when provided",
        ),
      );
    }
  }

  const allowTargetedRerunRaw = value["allowTargetedRerun"];
  let allowTargetedRerun: boolean | undefined;
  if (allowTargetedRerunRaw !== undefined) {
    if (typeof allowTargetedRerunRaw === "boolean") {
      allowTargetedRerun = allowTargetedRerunRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.allowTargetedRerun`,
          "must be a boolean when provided",
        ),
      );
    }
  }

  const effectiveMonitor = monitorIntervalMs ?? DEFAULT_MONITOR_INTERVAL_MS;
  const effectiveStall = stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
  if (effectiveStall < effectiveMonitor) {
    issues.push(
      makeIssue(
        "error",
        `${path}.stallTimeoutMs`,
        "must be greater than or equal to monitorIntervalMs",
      ),
    );
  }

  return {
    ...(superviserWorkflowId === undefined ? {} : { superviserWorkflowId }),
    ...(monitorIntervalMs === undefined ? {} : { monitorIntervalMs }),
    ...(stallTimeoutMs === undefined ? {} : { stallTimeoutMs }),
    ...(maxSupervisedAttempts === undefined ? {} : { maxSupervisedAttempts }),
    ...(maxWorkflowPatches === undefined ? {} : { maxWorkflowPatches }),
    ...(workflowMutationMode === undefined ? {} : { workflowMutationMode }),
    ...(allowTargetedRerun === undefined ? {} : { allowTargetedRerun }),
  };
}
export function normalizeCommandExecution(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  options?: { readonly allowRuntimeAddonCommandPaths?: boolean },
): CommandExecution | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const allowedKeys = new Set([
    "scriptPath",
    ...(options?.allowRuntimeAddonCommandPaths === true
      ? ["runtimeScriptPath"]
      : []),
    "argvTemplate",
    "envTemplate",
    "workingDirectory",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported command field",
        ),
      );
    }
  }

  const scriptPath = readStringField(value, "scriptPath", path, issues);
  if (scriptPath !== null && !isSafeWorkflowRelativePath(scriptPath)) {
    issues.push(
      makeIssue(
        "error",
        `${path}.scriptPath`,
        "must be a workflow-relative path without '.' or '..' segments",
      ),
    );
  }
  let runtimeScriptPath: string | undefined;
  const runtimeScriptPathRaw = value["runtimeScriptPath"];
  if (runtimeScriptPathRaw !== undefined) {
    if (
      options?.allowRuntimeAddonCommandPaths === true &&
      typeof runtimeScriptPathRaw === "string" &&
      runtimeScriptPathRaw.length > 0
    ) {
      runtimeScriptPath = runtimeScriptPathRaw;
    } else if (options?.allowRuntimeAddonCommandPaths === true) {
      issues.push(
        makeIssue(
          "error",
          `${path}.runtimeScriptPath`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const argvTemplate = normalizeStringArrayField(
    value["argvTemplate"],
    `${path}.argvTemplate`,
    issues,
  );
  const envTemplate = normalizeStringMapField(
    value["envTemplate"],
    `${path}.envTemplate`,
    issues,
  );

  const workingDirectoryRaw = value["workingDirectory"];
  const workingDirectory = normalizeWorkingDirectoryField(
    workingDirectoryRaw,
    `${path}.workingDirectory`,
    issues,
  );

  if (scriptPath === null || !isSafeWorkflowRelativePath(scriptPath)) {
    return undefined;
  }

  return {
    scriptPath,
    ...(runtimeScriptPath === undefined ? {} : { runtimeScriptPath }),
    ...(argvTemplate === undefined ? {} : { argvTemplate }),
    ...(envTemplate === undefined ? {} : { envTemplate }),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
  };
}
