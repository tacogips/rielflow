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
  > {
  readonly allowResolvedStepFileFields?: boolean;
  readonly executablePreflight?: boolean;
}
export function isStrictWorkflowAuthorshipValidation(
  _options: WorkflowValidationOptions,
): boolean {
  return true;
}
export type UnknownRecord = Record<string, unknown>;
export type ValidationResult = Result<
  NormalizedWorkflowBundle,
  readonly ValidationIssue[]
>;
export interface ValidationSuccessDetails {
  readonly bundle: NormalizedWorkflowBundle;
  readonly issues: readonly ValidationIssue[];
  readonly nodeValidationResults: readonly NodeValidationResult[];
}
export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
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
export function makeIssue(
  severity: "error" | "warning",
  path: string,
  message: string,
): ValidationIssue {
  return { severity, path, message };
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
export function readStringField(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
): string | null {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    issues.push(
      makeIssue("error", `${path}.${key}`, "must be a non-empty string"),
    );
    return null;
  }
  return value;
}
export function readNumberField(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
): number | null {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(
      makeIssue("error", `${path}.${key}`, "must be a finite number"),
    );
    return null;
  }
  return value;
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
export function normalizePositiveNumberField(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  issues.push(makeIssue("error", path, "must be > 0 when provided"));
  return undefined;
}
export function normalizePositiveIntegerValue(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  issues.push(makeIssue("error", path, "must be a positive integer"));
  return undefined;
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
export function normalizeStringArrayField(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push(makeIssue("error", path, "must be an array when provided"));
    return undefined;
  }
  const entries: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      issues.push(
        makeIssue("error", `${path}[${index}]`, "must be a non-empty string"),
      );
      return;
    }
    entries.push(entry);
  });
  return entries;
}
export function normalizeStringMapField(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const entries: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== "string") {
      issues.push(
        makeIssue("error", `${path}.${key}`, "must be a string when provided"),
      );
      continue;
    }
    entries[key] = entryValue;
  }
  return entries;
}
export function normalizeContainerBuild(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): ContainerBuild | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const allowedKeys = new Set(["contextPath", "containerfilePath", "target"]);
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

  if (contextPath === null || !isSafeWorkflowRelativePath(contextPath)) {
    return undefined;
  }

  return {
    contextPath,
    ...(containerfilePath === undefined ? {} : { containerfilePath }),
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
    ...(argvTemplate === undefined ? {} : { argvTemplate }),
    ...(envTemplate === undefined ? {} : { envTemplate }),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
  };
}
