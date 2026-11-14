import { readdirSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result } from "./result";
import { validateJsonSchemaDefinition } from "./json-schema";
import {
  REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS,
  REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS,
  REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE,
  REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS,
  REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE,
  collectStepAddressedAuthoredWorkflowFieldIssues,
} from "./authored-workflow";
import {
  isReservedWorkflowDefinitionPath,
  isSafeWorkflowRelativePath,
} from "./prompt-template-file";
import {
  normalizeWorkflowRelativeJsonPath,
  remapAuthoredNodePayloadsByNodeFile,
  synthesizeInlineNodeFile,
} from "./authored-node";
import { isSafeWorkflowId, isSafeWorkflowName } from "./paths";
import { normalizeWorkingDirectoryPath } from "./working-directory";
import {
  normalizeCliAgentBackend,
  normalizeNodeExecutionBackend,
} from "./backend";
import {
  DEFAULT_MONITOR_INTERVAL_MS,
  DEFAULT_STALL_TIMEOUT_MS,
} from "./auto-improve-policy";
import {
  createAsyncNodeAddonRegistry,
  createNodeAddonRegistry,
  resolveNodeAddonPayload,
  resolveNodeAddonPayloadAsync,
} from "./node-addons";
import {
  DEFAULT_CONTAINER_RUNNER_KIND,
  DEFAULT_MAX_LOOP_ITERATIONS,
  DEFAULT_NODE_TIMEOUT_MS,
  NODE_ID_PATTERN,
  getNormalizedNodePayload,
  type ArgumentBinding,
  type AsyncNodeAddonPayloadResolver,
  type CommandExecution,
  type ContainerBuild,
  type ContainerExecution,
  type ContainerRuntimeDefaults,
  type ContainerRunnerKind,
  type JsonObject,
  type LoadOptions,
  type NodeAddonPayloadResolver,
  type NodeInputContract,
  type NodeOutputContract,
  type NodeDurability,
  type NodeExecutionBackend,
  type NodePayload,
  type NodePromptVariant,
  type NodeRole,
  type NodeType,
  type NodeSessionPolicy,
  type NormalizedWorkflowBundle,
  type ValidationIssue,
  type WorkflowJson,
  type WorkflowNodeAddonEnvBinding,
  type WorkflowNodeAddonRef,
  type WorkflowNodeExecutionPolicy,
  type WorkflowNodeRegistryRef,
  type WorkflowNodeRef,
  type WorkflowPrompts,
  type WorkflowSupervisionDefaults,
  type WorkflowStepFanout,
  type WorkflowStepRef,
  type WorkflowStepSessionPolicy,
  type WorkflowStepTransition,
  type WorkflowTimeoutPolicy,
  type UserActionNodeConfig,
  type NodeKind,
  type WorkflowNodeRepeatPolicy,
} from "./types";
import { getStructuralEdges, getStructuralLoops } from "./types";

export {
  REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS,
  REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS,
  REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE,
  REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS,
  REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE,
};

interface RawBundle {
  readonly workflow: unknown;
  readonly nodePayloads: Readonly<Record<string, unknown>>;
}

interface NodeStepRoleUsage {
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
  > {
  readonly allowResolvedStepFileFields?: boolean;
}

export function isStrictWorkflowAuthorshipValidation(
  _options: WorkflowValidationOptions,
): boolean {
  return true;
}

type UnknownRecord = Record<string, unknown>;
type ValidationResult = Result<
  NormalizedWorkflowBundle,
  readonly ValidationIssue[]
>;

interface ValidationSuccessDetails {
  readonly bundle: NormalizedWorkflowBundle;
  readonly issues: readonly ValidationIssue[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiresSeparatedModel(
  executionBackend: NodeExecutionBackend | undefined,
): executionBackend is NodeExecutionBackend {
  return executionBackend !== undefined;
}

function isLegacyCliModelIdentifier(value: unknown): value is string {
  return (
    value === "tacogips/codex-agent" || value === "tacogips/claude-code-agent"
  );
}

function isNodeSessionMode(value: unknown): value is NodeSessionPolicy["mode"] {
  return value === "new" || value === "reuse";
}

function isNodeType(value: unknown): value is NodeType {
  return (
    value === "agent" ||
    value === "command" ||
    value === "container" ||
    value === "user-action"
  );
}

function isContainerRunnerKind(value: unknown): value is ContainerRunnerKind {
  return (
    value === "podman" ||
    value === "docker" ||
    value === "nerdctl" ||
    value === "apple-container"
  );
}

function makeIssue(
  severity: "error" | "warning",
  path: string,
  message: string,
): ValidationIssue {
  return { severity, path, message };
}

function normalizeWorkingDirectoryField(
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

function normalizeNodeRole(value: unknown): NodeRole | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "manager" || value === "worker") {
    return value;
  }
  return undefined;
}

function readStringField(
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

function readNumberField(
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

function readPositiveIntegerField(
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

function normalizePositiveNumberField(
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

function normalizePositiveIntegerValue(
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

function normalizeNonNegativeIntegerValue(
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

function isAbsoluteContainerPath(value: string): boolean {
  return value.startsWith("/");
}

function normalizeStringArrayField(
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

function normalizeStringMapField(
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

function normalizeContainerBuild(
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

function normalizeContainerRuntimeDefaults(
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

function normalizeWorkflowSupervisionDefaults(
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

function normalizeCommandExecution(
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

function normalizeContainerExecution(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): ContainerExecution | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const allowedKeys = new Set([
    "runnerKind",
    "runnerPath",
    "image",
    "build",
    "entrypoint",
    "argsTemplate",
    "envTemplate",
    "workingDirectory",
    "workspace",
    "resources",
    "networkPolicy",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported container field",
        ),
      );
    }
  }

  const runnerKindRaw = value["runnerKind"];
  let runnerKind: ContainerRunnerKind | undefined;
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

  const imageRaw = value["image"];
  let image: string | undefined;
  if (imageRaw !== undefined) {
    if (typeof imageRaw === "string" && imageRaw.length > 0) {
      image = imageRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.image`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const build = normalizeContainerBuild(
    value["build"],
    `${path}.build`,
    issues,
  );
  if ((image === undefined) === (build === undefined)) {
    issues.push(
      makeIssue(
        "error",
        path,
        "must declare exactly one of container.image or container.build",
      ),
    );
  }

  const entrypoint = normalizeStringArrayField(
    value["entrypoint"],
    `${path}.entrypoint`,
    issues,
  );
  const argsTemplate = normalizeStringArrayField(
    value["argsTemplate"],
    `${path}.argsTemplate`,
    issues,
  );
  const envTemplate = normalizeStringMapField(
    value["envTemplate"],
    `${path}.envTemplate`,
    issues,
  );

  const workingDirectoryRaw = value["workingDirectory"];
  let workingDirectory: string | undefined;
  if (workingDirectoryRaw !== undefined) {
    if (
      typeof workingDirectoryRaw === "string" &&
      workingDirectoryRaw.length > 0 &&
      isAbsoluteContainerPath(workingDirectoryRaw)
    ) {
      workingDirectory = workingDirectoryRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.workingDirectory`,
          "must be an absolute container path when provided",
        ),
      );
    }
  }

  const workspaceRaw = value["workspace"];
  let workspace: ContainerExecution["workspace"];
  if (workspaceRaw !== undefined) {
    if (!isRecord(workspaceRaw)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.workspace`,
          "must be an object when provided",
        ),
      );
    } else {
      const modeRaw = workspaceRaw["mode"];
      let mode: "none" | "ephemeral" | undefined;
      if (modeRaw !== undefined) {
        if (modeRaw === "none" || modeRaw === "ephemeral") {
          mode = modeRaw;
        } else {
          issues.push(
            makeIssue(
              "error",
              `${path}.workspace.mode`,
              "must be 'none' or 'ephemeral'",
            ),
          );
        }
      }
      const mountPathRaw = workspaceRaw["mountPath"];
      let mountPath: string | undefined;
      if (mountPathRaw !== undefined) {
        if (
          typeof mountPathRaw === "string" &&
          mountPathRaw.length > 0 &&
          isAbsoluteContainerPath(mountPathRaw)
        ) {
          mountPath = mountPathRaw;
        } else {
          issues.push(
            makeIssue(
              "error",
              `${path}.workspace.mountPath`,
              "must be an absolute container path when provided",
            ),
          );
        }
      }
      workspace = {
        ...(mode === undefined ? {} : { mode }),
        ...(mountPath === undefined ? {} : { mountPath }),
      };
    }
  }

  const resourcesRaw = value["resources"];
  let resources: ContainerExecution["resources"];
  if (resourcesRaw !== undefined) {
    if (!isRecord(resourcesRaw)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.resources`,
          "must be an object when provided",
        ),
      );
    } else {
      const parsed: Record<string, number> = {};
      for (const key of ["cpuMax", "memoryMaxMb", "pidsMax"] as const) {
        const rawValue = resourcesRaw[key];
        if (rawValue === undefined) {
          continue;
        }
        if (
          typeof rawValue === "number" &&
          Number.isFinite(rawValue) &&
          rawValue > 0
        ) {
          parsed[key] = rawValue;
        } else {
          issues.push(
            makeIssue(
              "error",
              `${path}.resources.${key}`,
              "must be > 0 when provided",
            ),
          );
        }
      }
      resources = parsed;
    }
  }

  const networkPolicyRaw = value["networkPolicy"];
  let networkPolicy: "disabled" | "egress-allowed" | undefined;
  if (networkPolicyRaw !== undefined) {
    if (
      networkPolicyRaw === "disabled" ||
      networkPolicyRaw === "egress-allowed"
    ) {
      networkPolicy = networkPolicyRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.networkPolicy`,
          "must be 'disabled' or 'egress-allowed'",
        ),
      );
    }
  }

  return {
    ...(runnerKind === undefined ? {} : { runnerKind }),
    ...(runnerPath === undefined ? {} : { runnerPath }),
    ...(image === undefined ? {} : { image }),
    ...(build === undefined ? {} : { build }),
    ...(entrypoint === undefined ? {} : { entrypoint }),
    ...(argsTemplate === undefined ? {} : { argsTemplate }),
    ...(envTemplate === undefined ? {} : { envTemplate }),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    ...(workspace === undefined ? {} : { workspace }),
    ...(resources === undefined ? {} : { resources }),
    ...(networkPolicy === undefined ? {} : { networkPolicy }),
  };
}

function normalizeNodeDurability(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): NodeDurability | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const modeRaw = value["mode"];
  if (modeRaw !== "disabled" && modeRaw !== "node-persistent") {
    issues.push(
      makeIssue(
        "error",
        `${path}.mode`,
        "must be 'disabled' or 'node-persistent'",
      ),
    );
    return undefined;
  }

  const mountPathRaw = value["mountPath"];
  let mountPath: string | undefined;
  if (mountPathRaw !== undefined) {
    if (
      typeof mountPathRaw === "string" &&
      mountPathRaw.length > 0 &&
      isAbsoluteContainerPath(mountPathRaw)
    ) {
      mountPath = mountPathRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.mountPath`,
          "must be an absolute container path when provided",
        ),
      );
    }
  }

  return {
    mode: modeRaw,
    ...(mountPath === undefined ? {} : { mountPath }),
  };
}

const ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isValidEnvVarName(value: string): boolean {
  return ENV_VAR_NAME_PATTERN.test(value);
}

function normalizeWorkflowNodeAddonEnvBinding(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowNodeAddonEnvBinding | undefined {
  if (typeof value === "string") {
    if (value.length === 0 || !isValidEnvVarName(value)) {
      issues.push(
        makeIssue("error", path, "must be a valid environment variable name"),
      );
      return undefined;
    }
    return { fromEnv: value };
  }

  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be a string or object"));
    return undefined;
  }

  const allowedKeys = new Set(["fromEnv", "required"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(makeIssue("error", `${path}.${key}`, "is not supported"));
    }
  }

  const fromEnv = value["fromEnv"];
  if (typeof fromEnv !== "string" || !isValidEnvVarName(fromEnv)) {
    issues.push(
      makeIssue(
        "error",
        `${path}.fromEnv`,
        "must be a valid environment variable name",
      ),
    );
    return undefined;
  }

  const required = value["required"];
  if (required !== undefined && typeof required !== "boolean") {
    issues.push(makeIssue("error", `${path}.required`, "must be a boolean"));
  }

  return {
    fromEnv,
    ...(typeof required === "boolean" ? { required } : {}),
  };
}

function normalizeWorkflowNodeAddonEnv(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): Readonly<Record<string, WorkflowNodeAddonEnvBinding>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const bindings: Record<string, WorkflowNodeAddonEnvBinding> = {};
  for (const [targetEnv, bindingValue] of Object.entries(value)) {
    if (!isValidEnvVarName(targetEnv)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${targetEnv}`,
          "target must be a valid environment variable name",
        ),
      );
      continue;
    }
    const binding = normalizeWorkflowNodeAddonEnvBinding(
      bindingValue,
      `${path}.${targetEnv}`,
      issues,
    );
    if (binding !== undefined) {
      bindings[targetEnv] = binding;
    }
  }
  return bindings;
}

function normalizeWorkflowNodeAddonRef(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowNodeAddonRef | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    if (value.length === 0) {
      issues.push(makeIssue("error", path, "must be a non-empty string"));
      return undefined;
    }
    return { name: value };
  }

  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be a string or object"));
    return undefined;
  }

  const allowedKeys = new Set(["name", "version", "config", "env", "inputs"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(makeIssue("error", `${path}.${key}`, "is not supported"));
    }
  }

  const name = readStringField(value, "name", path, issues);
  const versionRaw = value["version"];
  let version: string | undefined;
  if (versionRaw !== undefined) {
    if (typeof versionRaw === "string" && versionRaw.length > 0) {
      version = versionRaw;
    } else {
      issues.push(
        makeIssue("error", `${path}.version`, "must be a non-empty string"),
      );
    }
  }

  const configRaw = value["config"];
  if (configRaw !== undefined && !isRecord(configRaw)) {
    issues.push(makeIssue("error", `${path}.config`, "must be an object"));
  }
  const env = normalizeWorkflowNodeAddonEnv(
    value["env"],
    `${path}.env`,
    issues,
  );
  const inputsRaw = value["inputs"];
  if (inputsRaw !== undefined && !isRecord(inputsRaw)) {
    issues.push(makeIssue("error", `${path}.inputs`, "must be an object"));
  }

  if (name === null) {
    return undefined;
  }

  return {
    name,
    ...(version === undefined ? {} : { version }),
    ...(isRecord(configRaw) ? { config: configRaw } : {}),
    ...(env === undefined ? {} : { env }),
    ...(isRecord(inputsRaw) ? { inputs: inputsRaw } : {}),
  };
}

function normalizeWorkflowTimeoutPolicy(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowTimeoutPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const onTimeout = value["onTimeout"];
  if (
    onTimeout !== "fail" &&
    onTimeout !== "retry-same-step" &&
    onTimeout !== "jump-to-step"
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.onTimeout`,
        "must be 'fail', 'retry-same-step', or 'jump-to-step'",
      ),
    );
    return undefined;
  }

  const maxRetriesRaw = value["maxRetries"];
  let maxRetries: number | undefined;
  if (maxRetriesRaw !== undefined) {
    if (
      typeof maxRetriesRaw === "number" &&
      Number.isInteger(maxRetriesRaw) &&
      maxRetriesRaw >= 0
    ) {
      maxRetries = maxRetriesRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.maxRetries`,
          "must be an integer >= 0 when provided",
        ),
      );
    }
  }

  const retryTimeoutIncrementMsRaw = value["retryTimeoutIncrementMs"];
  let retryTimeoutIncrementMs: number | undefined;
  if (retryTimeoutIncrementMsRaw !== undefined) {
    if (
      typeof retryTimeoutIncrementMsRaw === "number" &&
      Number.isFinite(retryTimeoutIncrementMsRaw) &&
      retryTimeoutIncrementMsRaw >= 0
    ) {
      retryTimeoutIncrementMs = retryTimeoutIncrementMsRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.retryTimeoutIncrementMs`,
          "must be >= 0 when provided",
        ),
      );
    }
  }

  const jumpStepIdRaw = value["jumpStepId"];
  let jumpStepId: string | undefined;
  if (jumpStepIdRaw !== undefined) {
    if (typeof jumpStepIdRaw === "string" && jumpStepIdRaw.length > 0) {
      jumpStepId = jumpStepIdRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.jumpStepId`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const reuseBackendSessionRaw = value["reuseBackendSession"];
  let reuseBackendSession: boolean | undefined;
  if (reuseBackendSessionRaw !== undefined) {
    if (typeof reuseBackendSessionRaw === "boolean") {
      reuseBackendSession = reuseBackendSessionRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.reuseBackendSession`,
          "must be a boolean when provided",
        ),
      );
    }
  }

  if (onTimeout === "jump-to-step" && jumpStepId === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.jumpStepId`,
        "is required when onTimeout is 'jump-to-step'",
      ),
    );
  }

  return {
    onTimeout,
    ...(maxRetries === undefined ? {} : { maxRetries }),
    ...(retryTimeoutIncrementMs === undefined
      ? {}
      : { retryTimeoutIncrementMs }),
    ...(jumpStepId === undefined ? {} : { jumpStepId }),
    ...(reuseBackendSession === undefined ? {} : { reuseBackendSession }),
  };
}

const NODE_KIND_VALUES = new Set<NodeKind>([
  "task",
  "branch-judge",
  "loop-judge",
  "input",
  "output",
]);

function normalizeRegistryNodeKind(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): NodeKind | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !NODE_KIND_VALUES.has(value as NodeKind)) {
    issues.push(
      makeIssue(
        "error",
        path,
        "must be 'task', 'branch-judge', 'loop-judge', 'input', or 'output'",
      ),
    );
    return undefined;
  }
  return value as NodeKind;
}

function normalizeWorkflowNodeRepeatPolicy(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowNodeRepeatPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return undefined;
  }
  const whileRaw = value["while"];
  if (typeof whileRaw !== "string" || whileRaw.length === 0) {
    issues.push(
      makeIssue("error", `${path}.while`, "must be a non-empty string"),
    );
    return undefined;
  }
  const restartAtRaw = value["restartAt"];
  const maxIterationsRaw = value["maxIterations"];
  let restartAt: string | undefined;
  if (restartAtRaw !== undefined) {
    if (typeof restartAtRaw !== "string" || restartAtRaw.length === 0) {
      issues.push(
        makeIssue("error", `${path}.restartAt`, "must be a non-empty string"),
      );
    } else {
      restartAt = restartAtRaw;
    }
  }
  let maxIterations: number | undefined;
  if (maxIterationsRaw !== undefined) {
    if (
      typeof maxIterationsRaw !== "number" ||
      !Number.isInteger(maxIterationsRaw) ||
      maxIterationsRaw < 1
    ) {
      issues.push(
        makeIssue(
          "error",
          `${path}.maxIterations`,
          "must be a positive integer when provided",
        ),
      );
    } else {
      maxIterations = maxIterationsRaw;
    }
  }
  return {
    while: whileRaw,
    ...(restartAt === undefined ? {} : { restartAt }),
    ...(maxIterations === undefined ? {} : { maxIterations }),
  };
}

function normalizeWorkflowNodeRegistryRef(
  value: unknown,
  index: number,
  issues: ValidationIssue[],
): WorkflowNodeRegistryRef | null {
  const path = `workflow.nodes[${index}]`;
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const allowedKeys = new Set([
    "id",
    "nodeFile",
    "addon",
    "execution",
    "kind",
    "repeat",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported step-addressed node registry field",
        ),
      );
    }
  }

  const id = readStringField(value, "id", path, issues);
  if (id !== null && !NODE_ID_PATTERN.test(id)) {
    issues.push(
      makeIssue("error", `${path}.id`, "must match ^[a-z0-9][a-z0-9-]{1,63}$"),
    );
  }

  const nodeFileRaw = value["nodeFile"];
  let nodeFile: string | undefined;
  if (nodeFileRaw !== undefined) {
    if (typeof nodeFileRaw !== "string" || nodeFileRaw.length === 0) {
      issues.push(
        makeIssue("error", `${path}.nodeFile`, "must be a non-empty string"),
      );
    } else {
      nodeFile = normalizeWorkflowRelativeJsonPath(nodeFileRaw);
    }
  }

  const addon = normalizeWorkflowNodeAddonRef(
    value["addon"],
    `${path}.addon`,
    issues,
  );
  const execution = normalizeWorkflowNodeExecutionPolicy(
    value["execution"],
    `${path}.execution`,
    issues,
  );
  const kind = normalizeRegistryNodeKind(value["kind"], `${path}.kind`, issues);
  const repeat = normalizeWorkflowNodeRepeatPolicy(
    value["repeat"],
    `${path}.repeat`,
    issues,
  );

  if ((nodeFile === undefined) === (addon === undefined)) {
    issues.push(
      makeIssue("error", path, "must declare exactly one of nodeFile or addon"),
    );
  }

  if (id === null) {
    return null;
  }

  return {
    id,
    ...(nodeFile === undefined ? {} : { nodeFile }),
    ...(addon === undefined ? {} : { addon }),
    ...(execution === undefined ? {} : { execution }),
    ...(kind === undefined ? {} : { kind }),
    ...(repeat === undefined ? {} : { repeat }),
  };
}

function normalizeWorkflowStepTransition(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowStepTransition | null {
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const allowedKeys = new Set([
    "toStepId",
    "toWorkflowId",
    "resumeStepId",
    "label",
    "fanout",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported step transition field",
        ),
      );
    }
  }

  const toStepId = readStringField(value, "toStepId", path, issues);
  const toWorkflowIdRaw = value["toWorkflowId"];
  let toWorkflowId: string | undefined;
  if (toWorkflowIdRaw !== undefined) {
    if (typeof toWorkflowIdRaw === "string" && toWorkflowIdRaw.length > 0) {
      toWorkflowId = toWorkflowIdRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.toWorkflowId`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const resumeStepIdRaw = value["resumeStepId"];
  let resumeStepId: string | undefined;
  if (resumeStepIdRaw !== undefined) {
    if (typeof resumeStepIdRaw === "string" && resumeStepIdRaw.length > 0) {
      resumeStepId = resumeStepIdRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.resumeStepId`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const labelRaw = value["label"];
  let label: string | undefined;
  if (labelRaw !== undefined) {
    if (typeof labelRaw === "string" && labelRaw.length > 0) {
      label = labelRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.label`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  if (toWorkflowId === undefined && resumeStepId !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.resumeStepId`,
        "is supported only when toWorkflowId is set",
      ),
    );
  }

  const fanout = normalizeWorkflowStepFanout(
    value["fanout"],
    `${path}.fanout`,
    issues,
  );

  if (toStepId === null) {
    return null;
  }

  return {
    toStepId,
    ...(toWorkflowId === undefined ? {} : { toWorkflowId }),
    ...(resumeStepId === undefined ? {} : { resumeStepId }),
    ...(label === undefined ? {} : { label }),
    ...(fanout === undefined ? {} : { fanout }),
  };
}

function normalizeWorkflowStepFanout(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowStepFanout | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const allowedKeys = new Set([
    "groupId",
    "itemsFrom",
    "itemVariable",
    "concurrency",
    "joinStepId",
    "failurePolicy",
    "resultOrder",
    "writeOwnership",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported fanout field",
        ),
      );
    }
  }

  const groupId = readStringField(value, "groupId", path, issues);
  const itemsFrom = readStringField(value, "itemsFrom", path, issues);
  if (
    typeof itemsFrom === "string" &&
    !(itemsFrom === "" || itemsFrom.startsWith("/"))
  ) {
    issues.push(
      makeIssue("error", `${path}.itemsFrom`, "must be a JSON Pointer"),
    );
  }
  const joinStepId = readStringField(value, "joinStepId", path, issues);
  const itemVariableRaw = value["itemVariable"];
  let itemVariable: string | undefined;
  if (itemVariableRaw !== undefined) {
    if (
      typeof itemVariableRaw === "string" &&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(itemVariableRaw)
    ) {
      itemVariable = itemVariableRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.itemVariable`,
          "must be an identifier-like non-empty string when provided",
        ),
      );
    }
  }

  const concurrency =
    value["concurrency"] === undefined
      ? undefined
      : readPositiveIntegerField(value, "concurrency", path, issues);
  const failurePolicyRaw = value["failurePolicy"];
  let failurePolicy: WorkflowStepFanout["failurePolicy"] | undefined;
  if (failurePolicyRaw !== undefined) {
    if (
      failurePolicyRaw === "fail-fast" ||
      failurePolicyRaw === "collect-all"
    ) {
      failurePolicy = failurePolicyRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.failurePolicy`,
          "must be 'fail-fast' or 'collect-all' when provided",
        ),
      );
    }
  }
  const resultOrderRaw = value["resultOrder"];
  let resultOrder: WorkflowStepFanout["resultOrder"] | undefined;
  if (resultOrderRaw !== undefined) {
    if (resultOrderRaw === "input") {
      resultOrder = resultOrderRaw;
    } else {
      issues.push(makeIssue("error", `${path}.resultOrder`, "must be 'input'"));
    }
  }
  const writeOwnership = normalizeWorkflowFanoutWriteOwnership(
    value["writeOwnership"],
    `${path}.writeOwnership`,
    issues,
  );

  if (groupId === null || itemsFrom === null || joinStepId === null) {
    return undefined;
  }
  return {
    groupId,
    itemsFrom,
    ...(itemVariable === undefined ? {} : { itemVariable }),
    ...(concurrency === undefined || concurrency === null
      ? {}
      : { concurrency }),
    joinStepId,
    ...(failurePolicy === undefined ? {} : { failurePolicy }),
    ...(resultOrder === undefined ? {} : { resultOrder }),
    ...(writeOwnership === undefined ? {} : { writeOwnership }),
  };
}

function normalizeWorkflowFanoutWriteOwnership(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowStepFanout["writeOwnership"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const allowedKeys = new Set(["mode", "paths", "directories"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported fanout writeOwnership field",
        ),
      );
    }
  }
  const modeRaw = value["mode"];
  let mode: "read-only" | "disjoint-paths" | "isolated-workspace" | undefined;
  if (
    modeRaw === "read-only" ||
    modeRaw === "disjoint-paths" ||
    modeRaw === "isolated-workspace"
  ) {
    mode = modeRaw;
  } else {
    issues.push(
      makeIssue(
        "error",
        `${path}.mode`,
        "must be 'read-only', 'disjoint-paths', or 'isolated-workspace'",
      ),
    );
  }
  const paths = normalizeStringArrayField(
    value["paths"],
    `${path}.paths`,
    issues,
  );
  const directories = normalizeStringArrayField(
    value["directories"],
    `${path}.directories`,
    issues,
  );
  if (mode === undefined) {
    return undefined;
  }
  return {
    mode,
    ...(paths === undefined ? {} : { paths }),
    ...(directories === undefined ? {} : { directories }),
  };
}

function normalizeWorkflowStepSessionPolicy(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowStepSessionPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const allowedKeys = new Set(["mode", "inheritFromStepId"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported step session policy field",
        ),
      );
    }
  }

  const modeRaw = value["mode"];
  let mode: WorkflowStepSessionPolicy["mode"];
  if (modeRaw !== undefined) {
    if (isNodeSessionMode(modeRaw)) {
      mode = modeRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.mode`,
          "must be 'new' or 'reuse' when provided",
        ),
      );
    }
  }

  const inheritFromStepIdRaw = value["inheritFromStepId"];
  let inheritFromStepId: string | undefined;
  if (inheritFromStepIdRaw !== undefined) {
    if (
      typeof inheritFromStepIdRaw === "string" &&
      inheritFromStepIdRaw.length > 0
    ) {
      inheritFromStepId = inheritFromStepIdRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.inheritFromStepId`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  return {
    ...(mode === undefined ? {} : { mode }),
    ...(inheritFromStepId === undefined ? {} : { inheritFromStepId }),
  };
}

function normalizeWorkflowNodeExecutionPolicy(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowNodeExecutionPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return undefined;
  }

  const allowedKeys = new Set(["mode", "decisionBy"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported workflow node execution field",
        ),
      );
    }
  }

  const modeRaw = value["mode"];
  let mode: WorkflowNodeExecutionPolicy["mode"] | undefined;
  if (modeRaw !== undefined) {
    if (modeRaw === "required" || modeRaw === "optional") {
      mode = modeRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.mode`,
          "must be 'required' or 'optional' when provided",
        ),
      );
    }
  }

  const decisionByRaw = value["decisionBy"];
  let decisionBy: WorkflowNodeExecutionPolicy["decisionBy"] | undefined;
  if (decisionByRaw !== undefined) {
    if (decisionByRaw === "owning-manager") {
      decisionBy = decisionByRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.decisionBy`,
          "must be 'owning-manager' when provided",
        ),
      );
    }
  }

  return {
    ...(mode === undefined ? {} : { mode }),
    ...(decisionBy === undefined ? {} : { decisionBy }),
  };
}

function normalizeWorkflowStepRef(
  value: unknown,
  index: number,
  issues: ValidationIssue[],
  options: Pick<WorkflowValidationOptions, "allowResolvedStepFileFields">,
): WorkflowStepRef | null {
  const path = `workflow.steps[${index}]`;
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const allowedKeys = new Set([
    "id",
    "stepFile",
    "nodeId",
    "description",
    "role",
    "promptVariant",
    "timeoutMs",
    "stallTimeoutMs",
    "sessionPolicy",
    "transitions",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue("error", `${path}.${key}`, "uses an unsupported step field"),
      );
    }
  }

  const id = readStringField(value, "id", path, issues);
  const stepFileRaw = value["stepFile"];
  let stepFile: string | undefined;
  if (stepFileRaw !== undefined) {
    if (typeof stepFileRaw === "string" && stepFileRaw.length > 0) {
      stepFile = normalizeWorkflowRelativeJsonPath(stepFileRaw);
    } else {
      issues.push(
        makeIssue("error", `${path}.stepFile`, "must be a non-empty string"),
      );
    }
  }
  if (stepFile !== undefined && options.allowResolvedStepFileFields !== true) {
    for (const inlineField of [
      "nodeId",
      "description",
      "role",
      "promptVariant",
      "timeoutMs",
      "sessionPolicy",
      "transitions",
    ] as const) {
      if (value[inlineField] !== undefined) {
        issues.push(
          makeIssue(
            "error",
            `${path}.${inlineField}`,
            "must not be authored inline when workflow.steps[].stepFile is used",
          ),
        );
      }
    }
  }

  const nodeIdRaw = value["nodeId"];
  let nodeId: string | undefined;
  if (typeof nodeIdRaw === "string" && nodeIdRaw.length > 0) {
    nodeId = nodeIdRaw;
  } else {
    issues.push(
      makeIssue(
        "error",
        `${path}.nodeId`,
        "must be a non-empty string after step files are resolved",
      ),
    );
  }

  const descriptionRaw = value["description"];
  let description: string | undefined;
  if (descriptionRaw !== undefined) {
    if (typeof descriptionRaw === "string" && descriptionRaw.length > 0) {
      description = descriptionRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.description`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const role = normalizeNodeRole(value["role"]);
  if (value["role"] !== undefined && role === undefined) {
    issues.push(
      makeIssue("error", `${path}.role`, "must be 'manager' or 'worker'"),
    );
  }

  const promptVariantRaw = value["promptVariant"];
  let promptVariant: string | undefined;
  if (promptVariantRaw !== undefined) {
    if (typeof promptVariantRaw === "string" && promptVariantRaw.length > 0) {
      promptVariant = promptVariantRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.promptVariant`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const timeoutMsRaw = value["timeoutMs"];
  const timeoutMs = normalizePositiveNumberField(
    timeoutMsRaw,
    `${path}.timeoutMs`,
    issues,
  );
  const stallTimeoutMs = normalizePositiveIntegerValue(
    value["stallTimeoutMs"],
    `${path}.stallTimeoutMs`,
    issues,
  );

  const sessionPolicy = normalizeWorkflowStepSessionPolicy(
    value["sessionPolicy"],
    `${path}.sessionPolicy`,
    issues,
  );

  const transitionsRaw = value["transitions"];
  let transitions: readonly WorkflowStepTransition[] | undefined;
  if (transitionsRaw !== undefined) {
    if (!Array.isArray(transitionsRaw)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.transitions`,
          "must be an array when provided",
        ),
      );
    } else {
      transitions = transitionsRaw
        .map((transition, transitionIndex) =>
          normalizeWorkflowStepTransition(
            transition,
            `${path}.transitions[${transitionIndex}]`,
            issues,
          ),
        )
        .filter(
          (transition): transition is WorkflowStepTransition =>
            transition !== null,
        );
    }
  }

  if (id === null || nodeId === undefined) {
    return null;
  }

  return {
    id,
    ...(stepFile === undefined ? {} : { stepFile }),
    nodeId,
    ...(description === undefined ? {} : { description }),
    ...(role === undefined ? {} : { role }),
    ...(promptVariant === undefined ? {} : { promptVariant }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(stallTimeoutMs === undefined ? {} : { stallTimeoutMs }),
    ...(sessionPolicy === undefined ? {} : { sessionPolicy }),
    ...(transitions === undefined ? {} : { transitions }),
  };
}

function normalizeStepAddressedWorkflow(
  workflow: UnknownRecord,
  issues: ValidationIssue[],
  options: WorkflowValidationOptions,
): WorkflowJson | null {
  const workflowId = readStringField(
    workflow,
    "workflowId",
    "workflow",
    issues,
  );
  if (workflowId !== null && !isSafeWorkflowId(workflowId)) {
    issues.push(
      makeIssue(
        "error",
        "workflow.workflowId",
        "must start with an alphanumeric character and contain only letters, digits, hyphens, or underscores",
      ),
    );
  }

  const descriptionRaw = workflow["description"];
  let description = "";
  if (descriptionRaw !== undefined) {
    if (typeof descriptionRaw === "string" && descriptionRaw.length > 0) {
      description = descriptionRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          "workflow.description",
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const defaultsValue = workflow["defaults"];
  if (!isRecord(defaultsValue)) {
    issues.push(makeIssue("error", "workflow.defaults", "must be an object"));
  }
  const nodeTimeoutMs =
    isRecord(defaultsValue) && defaultsValue["nodeTimeoutMs"] !== undefined
      ? readNumberField(
          defaultsValue,
          "nodeTimeoutMs",
          "workflow.defaults",
          issues,
        )
      : DEFAULT_NODE_TIMEOUT_MS;
  const maxLoopIterationsRaw =
    isRecord(defaultsValue) && defaultsValue["maxLoopIterations"] !== undefined
      ? readNumberField(
          defaultsValue,
          "maxLoopIterations",
          "workflow.defaults",
          issues,
        )
      : DEFAULT_MAX_LOOP_ITERATIONS;
  const fanoutConcurrency =
    isRecord(defaultsValue) && defaultsValue["fanoutConcurrency"] !== undefined
      ? readPositiveIntegerField(
          defaultsValue,
          "fanoutConcurrency",
          "workflow.defaults",
          issues,
        )
      : 20;
  const supervision = normalizeWorkflowSupervisionDefaults(
    isRecord(defaultsValue) ? defaultsValue["supervision"] : undefined,
    "workflow.defaults.supervision",
    issues,
  );
  const containerRuntime = normalizeContainerRuntimeDefaults(
    isRecord(defaultsValue) ? defaultsValue["containerRuntime"] : undefined,
    "workflow.defaults.containerRuntime",
    issues,
  );
  const timeoutPolicy = normalizeWorkflowTimeoutPolicy(
    isRecord(defaultsValue) ? defaultsValue["timeoutPolicy"] : undefined,
    "workflow.defaults.timeoutPolicy",
    issues,
  );

  let prompts: WorkflowPrompts | undefined;
  const promptsRaw = workflow["prompts"];
  if (promptsRaw !== undefined) {
    if (!isRecord(promptsRaw)) {
      issues.push(
        makeIssue(
          "error",
          "workflow.prompts",
          "must be an object when provided",
        ),
      );
    } else {
      const divedraPromptTemplateRaw = promptsRaw["divedraPromptTemplate"];
      const workerSystemPromptTemplateRaw =
        promptsRaw["workerSystemPromptTemplate"];

      if (
        divedraPromptTemplateRaw !== undefined &&
        typeof divedraPromptTemplateRaw !== "string"
      ) {
        issues.push(
          makeIssue(
            "error",
            "workflow.prompts.divedraPromptTemplate",
            "must be a string when provided",
          ),
        );
      }
      if (
        workerSystemPromptTemplateRaw !== undefined &&
        typeof workerSystemPromptTemplateRaw !== "string"
      ) {
        issues.push(
          makeIssue(
            "error",
            "workflow.prompts.workerSystemPromptTemplate",
            "must be a string when provided",
          ),
        );
      }

      prompts = {
        ...(typeof divedraPromptTemplateRaw === "string"
          ? { divedraPromptTemplate: divedraPromptTemplateRaw }
          : {}),
        ...(typeof workerSystemPromptTemplateRaw === "string"
          ? { workerSystemPromptTemplate: workerSystemPromptTemplateRaw }
          : {}),
      };
    }
  }

  const entryStepId = readStringField(
    workflow,
    "entryStepId",
    "workflow",
    issues,
  );
  const managerStepIdRaw = workflow["managerStepId"];
  let managerStepId: string | undefined | null;
  if (managerStepIdRaw !== undefined) {
    if (typeof managerStepIdRaw === "string" && managerStepIdRaw.length > 0) {
      managerStepId = managerStepIdRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          "workflow.managerStepId",
          "must be a non-empty string when provided",
        ),
      );
      managerStepId = null;
    }
  }

  issues.push(...collectStepAddressedAuthoredWorkflowFieldIssues(workflow));

  const nodeRegistryRaw = workflow["nodes"];
  if (!Array.isArray(nodeRegistryRaw)) {
    issues.push(makeIssue("error", "workflow.nodes", "must be an array"));
  }
  const nodeRegistry = Array.isArray(nodeRegistryRaw)
    ? nodeRegistryRaw
        .map((entry, index) =>
          normalizeWorkflowNodeRegistryRef(entry, index, issues),
        )
        .filter((entry): entry is WorkflowNodeRegistryRef => entry !== null)
    : [];
  if (Array.isArray(nodeRegistryRaw) && nodeRegistry.length === 0) {
    issues.push(
      makeIssue(
        "error",
        "workflow.nodes",
        "must contain at least one workflow node registry entry",
      ),
    );
  }

  const stepsRaw = workflow["steps"];
  if (!Array.isArray(stepsRaw)) {
    issues.push(makeIssue("error", "workflow.steps", "must be an array"));
  }
  const steps = Array.isArray(stepsRaw)
    ? stepsRaw
        .map((entry, index) =>
          normalizeWorkflowStepRef(entry, index, issues, options),
        )
        .filter((entry): entry is WorkflowStepRef => entry !== null)
    : [];
  if (Array.isArray(stepsRaw) && steps.length === 0) {
    issues.push(
      makeIssue("error", "workflow.steps", "must contain at least one step"),
    );
  }

  const seenNodeRegistryIds = new Set<string>();
  nodeRegistry.forEach((node, index) => {
    if (seenNodeRegistryIds.has(node.id)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.nodes[${index}].id`,
          `duplicate node registry id '${node.id}'`,
        ),
      );
      return;
    }
    seenNodeRegistryIds.add(node.id);
  });

  const seenStepIds = new Set<string>();
  steps.forEach((step, index) => {
    if (seenStepIds.has(step.id)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.steps[${index}].id`,
          `duplicate step id '${step.id}'`,
        ),
      );
      return;
    }
    seenStepIds.add(step.id);
  });

  const stepIdSet = new Set(steps.map((step) => step.id));
  const explicitManagerSteps = steps.filter((step) => step.role === "manager");
  if (explicitManagerSteps.length > 1) {
    issues.push(
      makeIssue(
        "error",
        "workflow.steps",
        "must not declare more than one manager-role step",
      ),
    );
  }
  if (managerStepId === undefined && explicitManagerSteps.length === 1) {
    managerStepId = explicitManagerSteps[0]?.id;
  }
  if (managerStepId !== undefined && managerStepId !== null) {
    if (!stepIdSet.has(managerStepId)) {
      issues.push(
        makeIssue(
          "error",
          "workflow.managerStepId",
          `must reference an existing step id (${managerStepId})`,
        ),
      );
    }
    const explicitManagerStep = explicitManagerSteps[0];
    if (
      explicitManagerStep !== undefined &&
      explicitManagerStep.id !== managerStepId
    ) {
      issues.push(
        makeIssue(
          "error",
          "workflow.managerStepId",
          `must match the authored manager-role step '${explicitManagerStep.id}'`,
        ),
      );
    }
  }
  if (entryStepId !== null && !stepIdSet.has(entryStepId)) {
    issues.push(
      makeIssue(
        "error",
        "workflow.entryStepId",
        `must reference an existing step id (${entryStepId})`,
      ),
    );
  }

  steps.forEach((step, index) => {
    const registryNode = nodeRegistry.find((node) => node.id === step.nodeId);
    if (registryNode === undefined) {
      issues.push(
        makeIssue(
          "error",
          `workflow.steps[${index}].nodeId`,
          `must reference an existing workflow node registry entry (${step.nodeId})`,
        ),
      );
    } else {
      const stepRole =
        step.role ?? (step.id === managerStepId ? "manager" : "worker");
      if (stepRole === "manager" && registryNode.addon !== undefined) {
        issues.push(
          makeIssue(
            "error",
            `workflow.steps[${index}].nodeId`,
            `manager step '${step.id}' must reference a file-backed node; add-on-backed node registry entry '${step.nodeId}' is worker-only`,
          ),
        );
      }
    }
    const crossWorkflowTransitions = (step.transitions ?? []).filter(
      (t) => t.toWorkflowId !== undefined,
    );
    if (crossWorkflowTransitions.length > 1) {
      issues.push(
        makeIssue(
          "error",
          `workflow.steps[${index}]`,
          "must have at most one cross-workflow transition (toWorkflowId)",
        ),
      );
    }
    const seenFanoutGroupIds = new Set<string>();
    step.transitions?.forEach((transition, transitionIndex) => {
      if (transition.fanout !== undefined) {
        if (seenFanoutGroupIds.has(transition.fanout.groupId)) {
          issues.push(
            makeIssue(
              "error",
              `workflow.steps[${index}].transitions[${transitionIndex}].fanout.groupId`,
              `duplicate fanout groupId '${transition.fanout.groupId}' on step '${step.id}'`,
            ),
          );
        }
        seenFanoutGroupIds.add(transition.fanout.groupId);
        if (!stepIdSet.has(transition.fanout.joinStepId)) {
          issues.push(
            makeIssue(
              "error",
              `workflow.steps[${index}].transitions[${transitionIndex}].fanout.joinStepId`,
              `must reference an existing step id (${transition.fanout.joinStepId})`,
            ),
          );
        }
        if (
          transition.toWorkflowId !== undefined &&
          transition.resumeStepId !== transition.fanout.joinStepId
        ) {
          issues.push(
            makeIssue(
              "error",
              `workflow.steps[${index}].transitions[${transitionIndex}].resumeStepId`,
              "must equal fanout.joinStepId when cross-workflow fanout is set",
            ),
          );
        }
        if (
          transition.fanout.concurrency !== undefined &&
          fanoutConcurrency !== null &&
          transition.fanout.concurrency > fanoutConcurrency
        ) {
          issues.push(
            makeIssue(
              "error",
              `workflow.steps[${index}].transitions[${transitionIndex}].fanout.concurrency`,
              `must not exceed workflow.defaults.fanoutConcurrency (${fanoutConcurrency})`,
            ),
          );
        }
        const effectiveFanoutConcurrency =
          transition.fanout.concurrency ?? fanoutConcurrency ?? 20;
        if (
          effectiveFanoutConcurrency > 1 &&
          transition.fanout.writeOwnership === undefined
        ) {
          issues.push(
            makeIssue(
              "error",
              `workflow.steps[${index}].transitions[${transitionIndex}].fanout.writeOwnership`,
              "is required for concurrent fanout; declare read-only, disjoint-paths, or isolated-workspace ownership",
            ),
          );
        }
      }
      if (transition.toWorkflowId !== undefined) {
        if (transition.resumeStepId === undefined) {
          issues.push(
            makeIssue(
              "error",
              `workflow.steps[${index}].transitions[${transitionIndex}].resumeStepId`,
              "is required when toWorkflowId is set (parent step to resume after the callee workflow completes)",
            ),
          );
        } else if (!stepIdSet.has(transition.resumeStepId)) {
          issues.push(
            makeIssue(
              "error",
              `workflow.steps[${index}].transitions[${transitionIndex}].resumeStepId`,
              `must reference an existing step id (${transition.resumeStepId})`,
            ),
          );
        }
      }
      if (
        transition.toWorkflowId === undefined &&
        !stepIdSet.has(transition.toStepId)
      ) {
        issues.push(
          makeIssue(
            "error",
            `workflow.steps[${index}].transitions[${transitionIndex}].toStepId`,
            `must reference an existing step id (${transition.toStepId})`,
          ),
        );
      }
    });
    if (
      step.sessionPolicy?.inheritFromStepId !== undefined &&
      !stepIdSet.has(step.sessionPolicy.inheritFromStepId)
    ) {
      issues.push(
        makeIssue(
          "error",
          `workflow.steps[${index}].sessionPolicy.inheritFromStepId`,
          `must reference an existing step id (${step.sessionPolicy.inheritFromStepId})`,
        ),
      );
    }
  });

  if (
    workflowId === null ||
    entryStepId === null ||
    managerStepId === null ||
    typeof nodeTimeoutMs !== "number" ||
    typeof maxLoopIterationsRaw !== "number" ||
    typeof fanoutConcurrency !== "number"
  ) {
    return null;
  }

  const nodesMaterializedFromSteps: WorkflowNodeRef[] = steps.map((step) => {
    const registryNode = nodeRegistry.find((node) => node.id === step.nodeId);
    const role =
      step.role ?? (step.id === managerStepId ? "manager" : "worker");
    return {
      id: step.id,
      nodeFile: registryNode?.nodeFile ?? synthesizeInlineNodeFile(step.id),
      ...(registryNode?.addon === undefined
        ? {}
        : { addon: registryNode.addon }),
      ...(registryNode?.execution === undefined
        ? {}
        : { execution: registryNode.execution }),
      ...(registryNode?.kind === undefined ? {} : { kind: registryNode.kind }),
      ...(registryNode?.repeat === undefined
        ? {}
        : { repeat: registryNode.repeat }),
      role,
    };
  });
  return {
    workflowId,
    description,
    defaults: {
      nodeTimeoutMs,
      maxLoopIterations: maxLoopIterationsRaw,
      fanoutConcurrency,
      ...(supervision === undefined ? {} : { supervision }),
      ...(timeoutPolicy === undefined ? {} : { timeoutPolicy }),
      ...(containerRuntime === undefined ? {} : { containerRuntime }),
    },
    ...(prompts === undefined ? {} : { prompts }),
    hasManagerNode: managerStepId !== undefined,
    ...(managerStepId === undefined ? {} : { managerStepId }),
    entryStepId,
    nodeRegistry,
    steps,
    nodes: nodesMaterializedFromSteps,
  };
}

function normalizeWorkflow(
  workflow: unknown,
  issues: ValidationIssue[],
  options: WorkflowValidationOptions,
): WorkflowJson | null {
  if (!isRecord(workflow)) {
    issues.push(makeIssue("error", "workflow", "must be an object"));
    return null;
  }
  return normalizeStepAddressedWorkflow(workflow, issues, options);
}

function normalizeNodeTemplateFields(args: {
  readonly path: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly issues: ValidationIssue[];
  readonly templateField: string;
  readonly templateFileField: string;
}): {
  readonly template?: string;
  readonly templateFile?: string;
} {
  const templateRaw = args.payload[args.templateField];
  const templateFileRaw = args.payload[args.templateFileField];

  let template: string | undefined;
  let templateFile: string | undefined;

  if (templateFileRaw !== undefined) {
    if (typeof templateFileRaw === "string" && templateFileRaw.length > 0) {
      if (isSafeWorkflowRelativePath(templateFileRaw)) {
        if (isReservedWorkflowDefinitionPath(templateFileRaw)) {
          args.issues.push(
            makeIssue(
              "error",
              `${args.path}.${args.templateFileField}`,
              "must not target canonical workflow definition files such as workflow.json or node-*.json",
            ),
          );
        } else {
          templateFile = templateFileRaw;
        }
      } else {
        args.issues.push(
          makeIssue(
            "error",
            `${args.path}.${args.templateFileField}`,
            "must be a workflow-relative path without '.' or '..' segments",
          ),
        );
      }
    } else {
      args.issues.push(
        makeIssue(
          "error",
          `${args.path}.${args.templateFileField}`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  if (typeof templateRaw === "string" && templateRaw.length > 0) {
    template = templateRaw;
  } else if (templateRaw !== undefined && typeof templateRaw !== "string") {
    args.issues.push(
      makeIssue(
        "error",
        `${args.path}.${args.templateField}`,
        "must be a non-empty string when provided",
      ),
    );
  } else if (typeof templateRaw === "string" && templateRaw.length === 0) {
    args.issues.push(
      makeIssue(
        "error",
        `${args.path}.${args.templateField}`,
        "must be a non-empty string when provided",
      ),
    );
  }

  return {
    ...(template === undefined ? {} : { template }),
    ...(templateFile === undefined ? {} : { templateFile }),
  };
}

function normalizeNodePromptVariants(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): Readonly<Record<string, NodePromptVariant>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const variants: Record<string, NodePromptVariant> = {};
  for (const [variantName, variantValue] of Object.entries(value)) {
    if (variantName.length === 0) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${variantName}`,
          "variant names must be non-empty strings",
        ),
      );
      continue;
    }
    if (!isRecord(variantValue)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${variantName}`,
          "must be an object when provided",
        ),
      );
      continue;
    }
    const normalizedSystemPromptTemplate = normalizeNodeTemplateFields({
      path: `${path}.${variantName}`,
      payload: variantValue,
      issues,
      templateField: "systemPromptTemplate",
      templateFileField: "systemPromptTemplateFile",
    });
    const normalizedPromptTemplate = normalizeNodeTemplateFields({
      path: `${path}.${variantName}`,
      payload: variantValue,
      issues,
      templateField: "promptTemplate",
      templateFileField: "promptTemplateFile",
    });
    const normalizedSessionStartPromptTemplate = normalizeNodeTemplateFields({
      path: `${path}.${variantName}`,
      payload: variantValue,
      issues,
      templateField: "sessionStartPromptTemplate",
      templateFileField: "sessionStartPromptTemplateFile",
    });

    variants[variantName] = {
      ...(normalizedSystemPromptTemplate.template === undefined
        ? {}
        : {
            systemPromptTemplate: normalizedSystemPromptTemplate.template,
          }),
      ...(normalizedSystemPromptTemplate.templateFile === undefined
        ? {}
        : {
            systemPromptTemplateFile:
              normalizedSystemPromptTemplate.templateFile,
          }),
      ...(normalizedPromptTemplate.template === undefined
        ? {}
        : { promptTemplate: normalizedPromptTemplate.template }),
      ...(normalizedPromptTemplate.templateFile === undefined
        ? {}
        : { promptTemplateFile: normalizedPromptTemplate.templateFile }),
      ...(normalizedSessionStartPromptTemplate.template === undefined
        ? {}
        : {
            sessionStartPromptTemplate:
              normalizedSessionStartPromptTemplate.template,
          }),
      ...(normalizedSessionStartPromptTemplate.templateFile === undefined
        ? {}
        : {
            sessionStartPromptTemplateFile:
              normalizedSessionStartPromptTemplate.templateFile,
          }),
    };
  }

  return variants;
}

function normalizeNodePayload(input: {
  readonly nodeId: string;
  readonly nodeFile: string;
  readonly payload: unknown;
  readonly issues: ValidationIssue[];
  readonly path?: string;
  readonly allowManagerCodePathDefaults?: boolean;
}): NodePayload | null {
  const path = input.path ?? `nodePayloads.${input.nodeFile}`;
  const payload = input.payload;
  const issues = input.issues;
  if (!isRecord(payload)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const id = readStringField(payload, "id", path, issues);
  if (id !== null && id !== input.nodeId) {
    issues.push(makeIssue("error", `${path}.id`, `must equal ${input.nodeId}`));
  }

  let nodeType: NodeType = "agent";
  const nodeTypeRaw = payload["nodeType"];
  if (nodeTypeRaw !== undefined) {
    if (nodeTypeRaw === "addon") {
      nodeType = "addon";
      issues.push(
        makeIssue(
          "error",
          `${path}.nodeType`,
          "nodeType 'addon' is runtime-owned; author add-ons with workflow.nodes[].addon",
        ),
      );
    } else if (isNodeType(nodeTypeRaw)) {
      nodeType = nodeTypeRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.nodeType`,
          "must be 'agent', 'command', 'container', or 'user-action'",
        ),
      );
    }
  }

  const command = normalizeCommandExecution(
    payload["command"],
    `${path}.command`,
    issues,
  );
  const container = normalizeContainerExecution(
    payload["container"],
    `${path}.container`,
    issues,
  );
  if (payload["runtimeIsolation"] !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.runtimeIsolation`,
        "legacy field 'runtimeIsolation' is not supported; use 'container'",
      ),
    );
  }
  if (container !== undefined && nodeTypeRaw === undefined) {
    nodeType = "container";
  }

  const managerTypeRaw = payload["managerType"];
  let managerType: NodePayload["managerType"];
  if (managerTypeRaw !== undefined) {
    if (managerTypeRaw === "code" || managerTypeRaw === "llm") {
      managerType = managerTypeRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.managerType`,
          "must be 'code' or 'llm' when provided",
        ),
      );
    }
  }
  const allowsManagerCodePathDefaults =
    input.allowManagerCodePathDefaults === true &&
    (managerType === undefined || managerType === "code");

  const modelRaw = payload["model"];
  let model: string | undefined;
  if (typeof modelRaw === "string" && modelRaw.length > 0) {
    model = modelRaw;
  } else if (
    modelRaw !== undefined &&
    nodeType === "agent" &&
    !allowsManagerCodePathDefaults
  ) {
    issues.push(
      makeIssue("error", `${path}.model`, "must be a non-empty string"),
    );
  } else if (modelRaw !== undefined && typeof modelRaw !== "string") {
    issues.push(
      makeIssue("error", `${path}.model`, "must be a non-empty string"),
    );
  }

  const executionBackendRaw = payload["executionBackend"];
  let executionBackend: NodeExecutionBackend | undefined;
  if (executionBackendRaw !== undefined) {
    const normalizedExecutionBackend =
      normalizeNodeExecutionBackend(executionBackendRaw);
    if (normalizedExecutionBackend !== null) {
      executionBackend = normalizedExecutionBackend;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.executionBackend`,
          "must be codex-agent, claude-code-agent, cursor-cli-agent, official/openai-sdk, or official/anthropic-sdk",
        ),
      );
    }
  } else if (nodeType === "agent" && !allowsManagerCodePathDefaults) {
    issues.push(
      makeIssue(
        "error",
        `${path}.executionBackend`,
        "is required for agent nodes",
      ),
    );
  }
  if (
    nodeType === "agent" &&
    model !== undefined &&
    requiresSeparatedModel(executionBackend) &&
    (normalizeCliAgentBackend(model) !== null ||
      isLegacyCliModelIdentifier(model))
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.model`,
        `must be a provider or backend-specific model name when executionBackend is '${executionBackend}', not a tacogips CLI-wrapper identifier`,
      ),
    );
  }

  const normalizedSystemPromptTemplate = normalizeNodeTemplateFields({
    path,
    payload,
    issues,
    templateField: "systemPromptTemplate",
    templateFileField: "systemPromptTemplateFile",
  });
  const normalizedPromptTemplate = normalizeNodeTemplateFields({
    path,
    payload,
    issues,
    templateField: "promptTemplate",
    templateFileField: "promptTemplateFile",
  });
  const normalizedSessionStartPromptTemplate = normalizeNodeTemplateFields({
    path,
    payload,
    issues,
    templateField: "sessionStartPromptTemplate",
    templateFileField: "sessionStartPromptTemplateFile",
  });

  const promptTemplate = normalizedPromptTemplate.template;
  const promptTemplateFile = normalizedPromptTemplate.templateFile;
  const systemPromptTemplate = normalizedSystemPromptTemplate.template;
  const systemPromptTemplateFile = normalizedSystemPromptTemplate.templateFile;
  const sessionStartPromptTemplate =
    normalizedSessionStartPromptTemplate.template;
  const sessionStartPromptTemplateFile =
    normalizedSessionStartPromptTemplate.templateFile;
  const promptVariants = normalizeNodePromptVariants(
    payload["promptVariants"],
    `${path}.promptVariants`,
    issues,
  );
  if (
    promptTemplate === undefined &&
    nodeType === "agent" &&
    !allowsManagerCodePathDefaults
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.promptTemplate`,
        "must be a non-empty string",
      ),
    );
  }

  const variablesRaw = payload["variables"];
  let variables: UnknownRecord | null = null;
  if (isRecord(variablesRaw)) {
    variables = variablesRaw;
  } else {
    issues.push(makeIssue("error", `${path}.variables`, "must be an object"));
  }
  if (payload["prompt"] !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.prompt`,
        "legacy field 'prompt' is not supported; use 'promptTemplate'",
      ),
    );
  }
  if (payload["variable"] !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.variable`,
        "legacy field 'variable' is not supported; use 'variables'",
      ),
    );
  }

  const descriptionRaw = payload["description"];
  const description =
    typeof descriptionRaw === "string" && descriptionRaw.trim().length > 0
      ? descriptionRaw
      : undefined;
  if (descriptionRaw !== undefined && typeof descriptionRaw !== "string") {
    issues.push(
      makeIssue(
        "error",
        `${path}.description`,
        "must be a non-empty string when provided",
      ),
    );
  } else if (typeof descriptionRaw === "string" && description === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.description`,
        "must be a non-empty string when provided",
      ),
    );
  }

  const timeoutRaw = payload["timeoutMs"];
  const timeoutMs = normalizePositiveNumberField(
    timeoutRaw,
    `${path}.timeoutMs`,
    issues,
  );
  const stallTimeoutMs = normalizePositiveIntegerValue(
    payload["stallTimeoutMs"],
    `${path}.stallTimeoutMs`,
    issues,
  );

  const durability = normalizeNodeDurability(
    payload["durability"],
    `${path}.durability`,
    issues,
  );
  const userAction = normalizeUserActionNodeConfig(
    payload["userAction"],
    `${path}.userAction`,
    issues,
  );

  const sessionPolicyRaw = payload["sessionPolicy"];
  let sessionPolicy: NodeSessionPolicy | undefined;
  if (sessionPolicyRaw !== undefined) {
    if (!isRecord(sessionPolicyRaw)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.sessionPolicy`,
          "must be an object when provided",
        ),
      );
    } else if (!isNodeSessionMode(sessionPolicyRaw["mode"])) {
      issues.push(
        makeIssue(
          "error",
          `${path}.sessionPolicy.mode`,
          "must be 'new' or 'reuse'",
        ),
      );
    } else {
      sessionPolicy = { mode: sessionPolicyRaw["mode"] };
    }
  }

  const argumentsTemplateRaw = payload["argumentsTemplate"];
  let argumentsTemplate: UnknownRecord | undefined;
  if (argumentsTemplateRaw !== undefined) {
    if (isRecord(argumentsTemplateRaw)) {
      argumentsTemplate = argumentsTemplateRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.argumentsTemplate`,
          "must be an object when provided",
        ),
      );
    }
  }

  const argumentBindingsRaw = payload["argumentBindings"];
  let argumentBindings: readonly ArgumentBinding[] | undefined;
  if (argumentBindingsRaw !== undefined) {
    if (!Array.isArray(argumentBindingsRaw)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.argumentBindings`,
          "must be an array when provided",
        ),
      );
    } else {
      const parsed: ArgumentBinding[] = [];
      argumentBindingsRaw.forEach((entry, index) => {
        const entryPath = `${path}.argumentBindings[${index}]`;
        if (!isRecord(entry)) {
          issues.push(makeIssue("error", entryPath, "must be an object"));
          return;
        }

        const targetPath = readStringField(
          entry,
          "targetPath",
          entryPath,
          issues,
        );
        const sourceRaw = entry["source"];
        if (
          sourceRaw !== "variables" &&
          sourceRaw !== "node-output" &&
          sourceRaw !== "workflow-output" &&
          sourceRaw !== "human-input" &&
          sourceRaw !== "conversation-transcript"
        ) {
          issues.push(
            makeIssue(
              "error",
              `${entryPath}.source`,
              "must be a valid binding source",
            ),
          );
          return;
        }

        if (targetPath === null) {
          return;
        }

        const sourceRef = entry["sourceRef"];
        const sourcePath = entry["sourcePath"];
        const required = entry["required"];

        parsed.push({
          targetPath,
          source: sourceRaw,
          ...(typeof sourceRef === "string" || isRecord(sourceRef)
            ? { sourceRef }
            : {}),
          ...(typeof sourcePath === "string" ? { sourcePath } : {}),
          ...(typeof required === "boolean" ? { required } : {}),
        });
      });
      argumentBindings = parsed;
    }
  }

  const templateEngineRaw = payload["templateEngine"];
  const templateEngine =
    typeof templateEngineRaw === "string" ? templateEngineRaw : undefined;
  const workingDirectory = normalizeWorkingDirectoryField(
    payload["workingDirectory"],
    `${path}.workingDirectory`,
    issues,
  );

  const outputContract = normalizeNodeOutputContract(
    payload["output"],
    `${path}.output`,
    issues,
  );
  const inputContract = normalizeNodeInputContract(
    payload["input"],
    `${path}.input`,
    issues,
  );

  if (nodeType === "command" && command === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.command`,
        "is required when nodeType is 'command'",
      ),
    );
  }
  if (nodeType === "container" && container === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.container`,
        "is required when nodeType is 'container'",
      ),
    );
  }
  if (durability !== undefined && nodeType !== "container") {
    issues.push(
      makeIssue(
        "error",
        `${path}.durability`,
        "is currently valid only for container nodes",
      ),
    );
  }
  if (userAction !== undefined && nodeType !== "user-action") {
    issues.push(
      makeIssue(
        "error",
        `${path}.userAction`,
        "is valid only when nodeType is 'user-action'",
      ),
    );
  }
  if (nodeType === "user-action" && userAction === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.userAction`,
        "is required when nodeType is 'user-action'",
      ),
    );
  }
  if (nodeType === "user-action" && model !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.model`,
        "must be omitted when nodeType is 'user-action'",
      ),
    );
  }
  if (nodeType === "user-action" && executionBackend !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.executionBackend`,
        "must be omitted when nodeType is 'user-action'",
      ),
    );
  }
  if (nodeType === "user-action" && sessionPolicy !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.sessionPolicy`,
        "must be omitted when nodeType is 'user-action'",
      ),
    );
  }
  if (nodeType === "user-action" && command !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.command`,
        "must be omitted when nodeType is 'user-action'",
      ),
    );
  }
  if (nodeType === "user-action" && container !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.container`,
        "must be omitted when nodeType is 'user-action'",
      ),
    );
  }
  if (nodeType === "user-action" && durability !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.durability`,
        "must be omitted when nodeType is 'user-action'",
      ),
    );
  }
  if (
    nodeType === "user-action" &&
    promptTemplate === undefined &&
    promptTemplateFile === undefined
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.promptTemplate`,
        "must be provided inline or by promptTemplateFile when nodeType is 'user-action'",
      ),
    );
  }

  if (
    id === null ||
    variables === null ||
    nodeType === "addon" ||
    (nodeType === "agent" &&
      (model === undefined || promptTemplate === undefined) &&
      !allowsManagerCodePathDefaults)
  ) {
    return null;
  }

  return {
    id,
    ...(description === undefined ? {} : { description }),
    ...(nodeType === "agent" ? {} : { nodeType }),
    ...(managerType === undefined ? {} : { managerType }),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    ...(model === undefined ? {} : { model }),
    ...(executionBackend === undefined ? {} : { executionBackend }),
    ...(sessionPolicy === undefined ? {} : { sessionPolicy }),
    ...(systemPromptTemplate === undefined ? {} : { systemPromptTemplate }),
    ...(systemPromptTemplateFile === undefined
      ? {}
      : { systemPromptTemplateFile }),
    ...(promptTemplate === undefined ? {} : { promptTemplate }),
    ...(promptTemplateFile === undefined ? {} : { promptTemplateFile }),
    ...(sessionStartPromptTemplate === undefined
      ? {}
      : { sessionStartPromptTemplate }),
    ...(sessionStartPromptTemplateFile === undefined
      ? {}
      : { sessionStartPromptTemplateFile }),
    ...(promptVariants === undefined ? {} : { promptVariants }),
    variables,
    ...(command === undefined ? {} : { command }),
    ...(container === undefined ? {} : { container }),
    ...(durability === undefined ? {} : { durability }),
    ...(userAction === undefined ? {} : { userAction }),
    ...(argumentsTemplate === undefined ? {} : { argumentsTemplate }),
    ...(argumentBindings === undefined ? {} : { argumentBindings }),
    ...(templateEngine === undefined ? {} : { templateEngine }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(stallTimeoutMs === undefined ? {} : { stallTimeoutMs }),
    ...(inputContract === undefined ? {} : { input: inputContract }),
    ...(outputContract === undefined ? {} : { output: outputContract }),
  };
}

function resolveWorkflowStepExecutionRole(
  workflow: Pick<WorkflowJson, "managerStepId">,
  step: Pick<WorkflowStepRef, "id" | "role">,
): NodeRole {
  return (
    step.role ?? (workflow.managerStepId === step.id ? "manager" : "worker")
  );
}

function applyPromptVariantTemplateOverride(input: {
  readonly payload: NodePayload;
  readonly variant: NodePromptVariant;
  readonly templateField:
    | "systemPromptTemplate"
    | "promptTemplate"
    | "sessionStartPromptTemplate";
  readonly templateFileField:
    | "systemPromptTemplateFile"
    | "promptTemplateFile"
    | "sessionStartPromptTemplateFile";
}): NodePayload {
  const variantTemplate = input.variant[input.templateField];
  const variantTemplateFile = input.variant[input.templateFileField];
  if (variantTemplate === undefined && variantTemplateFile === undefined) {
    return input.payload;
  }

  const {
    [input.templateField]: _removedTemplate,
    [input.templateFileField]: _removedTemplateFile,
    ...payloadWithoutTemplatePair
  } = input.payload;

  return {
    ...payloadWithoutTemplatePair,
    ...(variantTemplate === undefined
      ? {}
      : { [input.templateField]: variantTemplate }),
    ...(variantTemplateFile === undefined
      ? {}
      : { [input.templateFileField]: variantTemplateFile }),
  };
}

function collectStepNodeRoleUsage(
  workflow: Pick<WorkflowJson, "managerStepId" | "steps">,
): ReadonlyMap<string, NodeStepRoleUsage> {
  const usage = new Map<string, NodeStepRoleUsage>();

  for (const step of workflow.steps ?? []) {
    const role = resolveWorkflowStepExecutionRole(workflow, step);
    const current = usage.get(step.nodeId) ?? {
      manager: false,
      worker: false,
    };
    usage.set(step.nodeId, {
      manager: current.manager || role === "manager",
      worker: current.worker || role === "worker",
    });
  }

  return usage;
}

function normalizeUserActionNodeConfig(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): UserActionNodeConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return undefined;
  }

  const allowedKeys = new Set([
    "messageToolIds",
    "notificationToolIds",
    "replyPolicy",
    "allowStructuredReply",
    "allowFreeTextReply",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported userAction field",
        ),
      );
    }
  }

  const messageToolIds = normalizeNamedStringArrayField(
    value,
    "messageToolIds",
    path,
    issues,
  );
  const notificationToolIds = normalizeOptionalNamedStringArrayField(
    value,
    "notificationToolIds",
    path,
    issues,
  );

  if (messageToolIds !== null && messageToolIds.length === 0) {
    issues.push(
      makeIssue(
        "error",
        `${path}.messageToolIds`,
        "must contain at least one tool id",
      ),
    );
  }

  const replyPolicyRaw = value["replyPolicy"];
  let replyPolicy: UserActionNodeConfig["replyPolicy"];
  if (replyPolicyRaw !== undefined) {
    if (replyPolicyRaw === "first-valid-reply-wins") {
      replyPolicy = replyPolicyRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.replyPolicy`,
          "must be 'first-valid-reply-wins' when provided",
        ),
      );
    }
  }

  const allowStructuredReply = normalizeOptionalBooleanField(
    value,
    "allowStructuredReply",
    path,
    issues,
  );
  const allowFreeTextReply = normalizeOptionalBooleanField(
    value,
    "allowFreeTextReply",
    path,
    issues,
  );

  if (messageToolIds === null) {
    return undefined;
  }

  return {
    messageToolIds,
    ...(notificationToolIds === undefined ? {} : { notificationToolIds }),
    ...(replyPolicy === undefined ? {} : { replyPolicy }),
    ...(allowStructuredReply === undefined ? {} : { allowStructuredReply }),
    ...(allowFreeTextReply === undefined ? {} : { allowFreeTextReply }),
  };
}

function normalizeNamedStringArrayField(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
): readonly string[] | null {
  const value = record[key];
  if (!Array.isArray(value)) {
    issues.push(makeIssue("error", `${path}.${key}`, "must be an array"));
    return null;
  }
  const normalized = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  if (normalized.length !== value.length) {
    issues.push(
      makeIssue(
        "error",
        `${path}.${key}`,
        "must contain only non-empty strings",
      ),
    );
  }
  return normalized;
}

function normalizeOptionalNamedStringArrayField(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
): readonly string[] | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  const normalized = normalizeNamedStringArrayField(record, key, path, issues);
  return normalized === null ? undefined : normalized;
}

function normalizeOptionalBooleanField(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
): boolean | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    issues.push(
      makeIssue("error", `${path}.${key}`, "must be a boolean when provided"),
    );
    return undefined;
  }
  return value;
}

function normalizeNodeOutputContract(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): NodeOutputContract | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return undefined;
  }

  const allowedKeys = new Set([
    "description",
    "jsonSchema",
    "maxValidationAttempts",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported output contract field",
        ),
      );
    }
  }
  const hasDescriptionKey = Object.hasOwn(value, "description");
  const hasJsonSchemaKey = Object.hasOwn(value, "jsonSchema");

  const descriptionRaw = value["description"];
  const description =
    typeof descriptionRaw === "string" && descriptionRaw.trim().length > 0
      ? descriptionRaw
      : undefined;
  if (descriptionRaw !== undefined && typeof descriptionRaw !== "string") {
    issues.push(
      makeIssue(
        "error",
        `${path}.description`,
        "must be a string when provided",
      ),
    );
  } else if (typeof descriptionRaw === "string" && description === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.description`,
        "must be a non-empty string when provided",
      ),
    );
  }

  const jsonSchemaRaw = value["jsonSchema"];
  let jsonSchema: JsonObject | undefined;
  if (jsonSchemaRaw !== undefined) {
    if (!isRecord(jsonSchemaRaw)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.jsonSchema`,
          "must be an object when provided",
        ),
      );
    } else {
      const schemaIssues = validateJsonSchemaDefinition(
        jsonSchemaRaw as JsonObject,
      );
      schemaIssues.forEach((entry) => {
        issues.push(
          makeIssue(
            "error",
            `${path}.jsonSchema${entry.path === "$schema" ? "" : entry.path.slice("$schema".length)}`,
            entry.message,
          ),
        );
      });
      if (schemaIssues.length === 0) {
        jsonSchema = jsonSchemaRaw as JsonObject;
      }
    }
  }

  const maxValidationAttemptsRaw = value["maxValidationAttempts"];
  let maxValidationAttempts: number | undefined;
  if (maxValidationAttemptsRaw !== undefined) {
    if (
      typeof maxValidationAttemptsRaw === "number" &&
      Number.isInteger(maxValidationAttemptsRaw) &&
      maxValidationAttemptsRaw > 0
    ) {
      maxValidationAttempts = maxValidationAttemptsRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.maxValidationAttempts`,
          "must be an integer > 0 when provided",
        ),
      );
    }
  }

  if (!hasDescriptionKey && !hasJsonSchemaKey) {
    issues.push(
      makeIssue(
        "error",
        path,
        "must define output.description and/or output.jsonSchema when provided",
      ),
    );
  }

  return {
    ...(description === undefined ? {} : { description }),
    ...(jsonSchema === undefined ? {} : { jsonSchema }),
    ...(maxValidationAttempts === undefined ? {} : { maxValidationAttempts }),
  };
}

function normalizeNodeInputContract(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): NodeInputContract | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return undefined;
  }

  const allowedKeys = new Set(["description", "jsonSchema"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported input contract field",
        ),
      );
    }
  }

  const hasDescriptionKey = Object.hasOwn(value, "description");
  const hasJsonSchemaKey = Object.hasOwn(value, "jsonSchema");

  const descriptionRaw = value["description"];
  const description =
    typeof descriptionRaw === "string" && descriptionRaw.trim().length > 0
      ? descriptionRaw
      : undefined;
  if (descriptionRaw !== undefined && typeof descriptionRaw !== "string") {
    issues.push(
      makeIssue(
        "error",
        `${path}.description`,
        "must be a string when provided",
      ),
    );
  } else if (typeof descriptionRaw === "string" && description === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.description`,
        "must be a non-empty string when provided",
      ),
    );
  }

  const jsonSchemaRaw = value["jsonSchema"];
  let jsonSchema: JsonObject | undefined;
  if (jsonSchemaRaw !== undefined) {
    if (!isRecord(jsonSchemaRaw)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.jsonSchema`,
          "must be an object when provided",
        ),
      );
    } else {
      const schemaIssues = validateJsonSchemaDefinition(
        jsonSchemaRaw as JsonObject,
      );
      schemaIssues.forEach((entry) => {
        issues.push(
          makeIssue(
            "error",
            `${path}.jsonSchema${entry.path === "$schema" ? "" : entry.path.slice("$schema".length)}`,
            entry.message,
          ),
        );
      });
      if (schemaIssues.length === 0) {
        jsonSchema = jsonSchemaRaw as JsonObject;
      }
    }
  }

  if (!hasDescriptionKey && !hasJsonSchemaKey) {
    issues.push(
      makeIssue(
        "error",
        path,
        "must define input.description and/or input.jsonSchema when provided",
      ),
    );
  }

  return {
    ...(description === undefined ? {} : { description }),
    ...(jsonSchema === undefined ? {} : { jsonSchema }),
  };
}

function intervalsPartiallyOverlap(
  left: Readonly<{ startOrder: number; endOrder: number }>,
  right: Readonly<{ startOrder: number; endOrder: number }>,
): boolean {
  const leftStartsInsideRight =
    right.startOrder < left.startOrder &&
    left.startOrder <= right.endOrder &&
    right.endOrder < left.endOrder;
  const rightStartsInsideLeft =
    left.startOrder < right.startOrder &&
    right.startOrder <= left.endOrder &&
    left.endOrder < right.endOrder;
  return leftStartsInsideRight || rightStartsInsideLeft;
}

function findNodeIdByOrder(
  bundle: NormalizedWorkflowBundle,
  order: number,
): string {
  return bundle.workflow.nodes[order]?.id ?? "unknown";
}

function pushCrossingIntervalIssue(
  issues: ValidationIssue[],
  bundle: NormalizedWorkflowBundle,
  args: {
    readonly path: string;
    readonly leftId: string;
    readonly leftStartOrder: number;
    readonly rightId: string;
    readonly rightStartOrder: number;
    readonly messagePrefix: string;
  },
): void {
  const earlierId =
    args.leftStartOrder <= args.rightStartOrder ? args.leftId : args.rightId;
  const laterId = earlierId === args.leftId ? args.rightId : args.leftId;
  const crossingNodeId = findNodeIdByOrder(
    bundle,
    args.leftStartOrder <= args.rightStartOrder
      ? args.rightStartOrder
      : args.leftStartOrder,
  );
  issues.push(
    makeIssue(
      "error",
      args.path,
      `${args.messagePrefix} '${earlierId}' and '${laterId}' cross; reorder or nest them cleanly around node '${crossingNodeId}'`,
    ),
  );
}

function resolveCalleeStepFilePath(
  workflowDirectory: string,
  relativeStepFile: string,
): string | undefined {
  if (
    relativeStepFile.length === 0 ||
    path.posix.isAbsolute(relativeStepFile) ||
    path.win32.isAbsolute(relativeStepFile)
  ) {
    return undefined;
  }
  const segments = relativeStepFile
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    return undefined;
  }
  const resolved = path.resolve(workflowDirectory, relativeStepFile);
  const relative = path.relative(workflowDirectory, resolved);
  return relative.startsWith("..") || path.isAbsolute(relative)
    ? undefined
    : resolved;
}

function inferSingleManagerStepIdFromRawSync(input: {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly workflowDirectory: string;
}): { ok: true; managerStepId?: string } | { ok: false; message: string } {
  const stepsRaw = input.raw["steps"];
  if (!Array.isArray(stepsRaw)) {
    return { ok: true };
  }

  const managerIds = new Set<string>();
  for (const step of stepsRaw) {
    if (!isRecord(step)) {
      continue;
    }
    const authoredId =
      typeof step["id"] === "string" && step["id"].length > 0
        ? step["id"]
        : undefined;
    if (step["role"] === "manager" && authoredId !== undefined) {
      managerIds.add(authoredId);
      continue;
    }

    const stepFile = step["stepFile"];
    if (typeof stepFile !== "string" || stepFile.length === 0) {
      continue;
    }
    const resolvedStepFile = resolveCalleeStepFilePath(
      input.workflowDirectory,
      stepFile,
    );
    if (resolvedStepFile === undefined) {
      return {
        ok: false,
        message: `callee stepFile '${stepFile}' must stay within workflow directory '${input.workflowDirectory}'`,
      };
    }
    let rawStep: unknown;
    try {
      rawStep = JSON.parse(readFileSync(resolvedStepFile, "utf8")) as unknown;
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? `failed to read callee stepFile '${stepFile}': ${error.message}`
            : `failed to read callee stepFile '${stepFile}'`,
      };
    }
    if (!isRecord(rawStep)) {
      return {
        ok: false,
        message: `callee stepFile '${stepFile}' must contain a JSON object`,
      };
    }
    if (rawStep["role"] !== "manager") {
      continue;
    }
    const resolvedId =
      authoredId ??
      (typeof rawStep["id"] === "string" && rawStep["id"].length > 0
        ? rawStep["id"]
        : undefined);
    if (resolvedId !== undefined) {
      managerIds.add(resolvedId);
    }
  }

  const explicitManagerStepId = input.raw["managerStepId"];
  if (
    managerIds.size > 1 &&
    !(
      typeof explicitManagerStepId === "string" &&
      explicitManagerStepId.length > 0
    )
  ) {
    return {
      ok: false,
      message:
        "callee workflow declares more than one manager-role step; set managerStepId explicitly or fix the callee workflow authorship",
    };
  }
  const managerStepId = [...managerIds][0];
  return managerStepId === undefined
    ? { ok: true }
    : { ok: true, managerStepId };
}

async function inferSingleManagerStepIdFromRawAsync(input: {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly workflowDirectory: string;
}): Promise<
  { ok: true; managerStepId?: string } | { ok: false; message: string }
> {
  const stepsRaw = input.raw["steps"];
  if (!Array.isArray(stepsRaw)) {
    return { ok: true };
  }

  const managerIds = new Set<string>();
  for (const step of stepsRaw) {
    if (!isRecord(step)) {
      continue;
    }
    const authoredId =
      typeof step["id"] === "string" && step["id"].length > 0
        ? step["id"]
        : undefined;
    if (step["role"] === "manager" && authoredId !== undefined) {
      managerIds.add(authoredId);
      continue;
    }

    const stepFile = step["stepFile"];
    if (typeof stepFile !== "string" || stepFile.length === 0) {
      continue;
    }
    const resolvedStepFile = resolveCalleeStepFilePath(
      input.workflowDirectory,
      stepFile,
    );
    if (resolvedStepFile === undefined) {
      return {
        ok: false,
        message: `callee stepFile '${stepFile}' must stay within workflow directory '${input.workflowDirectory}'`,
      };
    }
    let rawStep: unknown;
    try {
      rawStep = JSON.parse(await readFile(resolvedStepFile, "utf8")) as unknown;
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? `failed to read callee stepFile '${stepFile}': ${error.message}`
            : `failed to read callee stepFile '${stepFile}'`,
      };
    }
    if (!isRecord(rawStep)) {
      return {
        ok: false,
        message: `callee stepFile '${stepFile}' must contain a JSON object`,
      };
    }
    if (rawStep["role"] !== "manager") {
      continue;
    }
    const resolvedId =
      authoredId ??
      (typeof rawStep["id"] === "string" && rawStep["id"].length > 0
        ? rawStep["id"]
        : undefined);
    if (resolvedId !== undefined) {
      managerIds.add(resolvedId);
    }
  }

  const explicitManagerStepId = input.raw["managerStepId"];
  if (
    managerIds.size > 1 &&
    !(
      typeof explicitManagerStepId === "string" &&
      explicitManagerStepId.length > 0
    )
  ) {
    return {
      ok: false,
      message:
        "callee workflow declares more than one manager-role step; set managerStepId explicitly or fix the callee workflow authorship",
    };
  }
  const managerStepId = [...managerIds][0];
  return managerStepId === undefined
    ? { ok: true }
    : { ok: true, managerStepId };
}

function parseCalleeWorkflowJsonText(
  text: string,
):
  | { ok: true; raw: Readonly<Record<string, unknown>> }
  | { ok: false; message: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "callee workflow.json is not valid JSON" };
  }
  if (!isRecord(raw)) {
    return { ok: false, message: "callee workflow.json must be a JSON object" };
  }
  return { ok: true, raw };
}

function resolveCalleeWorkflowJsonByIdSync(input: {
  readonly workflowRoot: string;
  readonly workflowId: string;
}):
  | {
      ok: true;
      raw: Readonly<Record<string, unknown>>;
      workflowDirectory: string;
    }
  | { ok: false; message: string } {
  let directoryEntries: ReturnType<typeof readdirSync>;
  try {
    directoryEntries = readdirSync(input.workflowRoot, {
      withFileTypes: true,
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `failed listing workflow root '${input.workflowRoot}': ${error.message}`
          : `failed listing workflow root '${input.workflowRoot}'`,
    };
  }

  const candidateDirectories = directoryEntries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => {
      if (left.name === input.workflowId) {
        return -1;
      }
      if (right.name === input.workflowId) {
        return 1;
      }
      return left.name.localeCompare(right.name);
    });

  let preferredDirectoryError: string | undefined;
  for (const entry of candidateDirectories) {
    const workflowDirectory = path.join(input.workflowRoot, entry.name);
    const workflowJsonPath = path.join(workflowDirectory, "workflow.json");
    let text: string;
    try {
      text = readFileSync(workflowJsonPath, "utf8");
    } catch (error) {
      if (entry.name === input.workflowId) {
        preferredDirectoryError =
          error instanceof Error
            ? error.message
            : "failed to read callee workflow.json";
      }
      continue;
    }
    const parsed = parseCalleeWorkflowJsonText(text);
    if (!parsed.ok) {
      if (entry.name === input.workflowId) {
        preferredDirectoryError = parsed.message;
      }
      continue;
    }
    if (parsed.raw["workflowId"] !== input.workflowId) {
      continue;
    }
    return {
      ok: true,
      raw: parsed.raw,
      workflowDirectory,
    };
  }

  if (preferredDirectoryError !== undefined) {
    return { ok: false, message: preferredDirectoryError };
  }
  return {
    ok: false,
    message: `workflow id '${input.workflowId}' was not found under workflow root '${input.workflowRoot}'`,
  };
}

async function resolveCalleeWorkflowJsonByIdAsync(input: {
  readonly workflowRoot: string;
  readonly workflowId: string;
}): Promise<
  | {
      ok: true;
      raw: Readonly<Record<string, unknown>>;
      workflowDirectory: string;
    }
  | { ok: false; message: string }
> {
  let directoryEntries: Awaited<ReturnType<typeof readdir>>;
  try {
    directoryEntries = await readdir(input.workflowRoot, {
      withFileTypes: true,
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `failed listing workflow root '${input.workflowRoot}': ${error.message}`
          : `failed listing workflow root '${input.workflowRoot}'`,
    };
  }

  const candidateDirectories = directoryEntries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => {
      if (left.name === input.workflowId) {
        return -1;
      }
      if (right.name === input.workflowId) {
        return 1;
      }
      return left.name.localeCompare(right.name);
    });

  let preferredDirectoryError: string | undefined;
  for (const entry of candidateDirectories) {
    const workflowDirectory = path.join(input.workflowRoot, entry.name);
    const workflowJsonPath = path.join(workflowDirectory, "workflow.json");
    let text: string;
    try {
      text = await readFile(workflowJsonPath, "utf8");
    } catch (error) {
      if (entry.name === input.workflowId) {
        preferredDirectoryError =
          error instanceof Error
            ? error.message
            : "failed to read callee workflow.json";
      }
      continue;
    }
    const parsed = parseCalleeWorkflowJsonText(text);
    if (!parsed.ok) {
      if (entry.name === input.workflowId) {
        preferredDirectoryError = parsed.message;
      }
      continue;
    }
    if (parsed.raw["workflowId"] !== input.workflowId) {
      continue;
    }
    return {
      ok: true,
      raw: parsed.raw,
      workflowDirectory,
    };
  }

  if (preferredDirectoryError !== undefined) {
    return { ok: false, message: preferredDirectoryError };
  }
  return {
    ok: false,
    message: `workflow id '${input.workflowId}' was not found under workflow root '${input.workflowRoot}'`,
  };
}

function resolveCalleeWorkflowEntry(input: {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly inferredManagerStepId?: string;
}): { ok: true; entry: string } | { ok: false; message: string } {
  const managerStepId = input.raw["managerStepId"];
  const entryStepId = input.raw["entryStepId"];
  let entry: string | undefined;
  if (typeof managerStepId === "string" && managerStepId.length > 0) {
    entry = managerStepId;
  } else if (input.inferredManagerStepId !== undefined) {
    entry = input.inferredManagerStepId;
  } else if (typeof entryStepId === "string" && entryStepId.length > 0) {
    entry = entryStepId;
  }
  if (entry === undefined) {
    return {
      ok: false,
      message:
        "callee workflow must declare managerStepId or entryStepId (or exactly one manager-role step)",
    };
  }
  return { ok: true, entry };
}

/**
 * When `workflowRoot` is available, ensures each cross-workflow step transition's
 * `toStepId` matches the step id where the callee run starts: `managerStepId` when
 * present, otherwise `entryStepId` (or an inferred single manager-role step).
 * Callee start steps are resolved from `managerStepId`, `entryStepId`, or a
 * single manager-role step only (not from rejected legacy top-level node alias fields on disk).
 */
function validateCrossWorkflowCalleeEntryAlignmentSync(
  bundle: NormalizedWorkflowBundle,
  options: WorkflowValidationOptions,
  issues: ValidationIssue[],
): void {
  const workflowRoot = options.workflowRoot;
  if (workflowRoot === undefined || workflowRoot === "") {
    return;
  }
  const steps = bundle.workflow.steps;
  if (steps === undefined) {
    return;
  }

  const cwd = options.cwd ?? process.cwd();
  const resolvedRoot = path.isAbsolute(workflowRoot)
    ? workflowRoot
    : path.resolve(cwd, workflowRoot);

  const calleeEntryById = new Map<
    string,
    { status: "ok"; entry: string } | { status: "error"; message: string }
  >();

  function resolveCalleeEntry(
    calleeId: string,
  ): { ok: true; entry: string } | { ok: false; message: string } {
    const cached = calleeEntryById.get(calleeId);
    if (cached !== undefined) {
      return cached.status === "ok"
        ? { ok: true, entry: cached.entry }
        : { ok: false, message: cached.message };
    }

    try {
      const resolvedWorkflow = resolveCalleeWorkflowJsonByIdSync({
        workflowRoot: resolvedRoot,
        workflowId: calleeId,
      });
      if (!resolvedWorkflow.ok) {
        calleeEntryById.set(calleeId, {
          status: "error",
          message: resolvedWorkflow.message,
        });
        return { ok: false, message: resolvedWorkflow.message };
      }
      const inferred = inferSingleManagerStepIdFromRawSync({
        raw: resolvedWorkflow.raw,
        workflowDirectory: resolvedWorkflow.workflowDirectory,
      });
      if (!inferred.ok) {
        calleeEntryById.set(calleeId, {
          status: "error",
          message: inferred.message,
        });
        return { ok: false, message: inferred.message };
      }
      const resolved = resolveCalleeWorkflowEntry({
        raw: resolvedWorkflow.raw,
        ...(inferred.managerStepId === undefined
          ? {}
          : { inferredManagerStepId: inferred.managerStepId }),
      });
      if (!resolved.ok) {
        calleeEntryById.set(calleeId, {
          status: "error",
          message: resolved.message,
        });
        return { ok: false, message: resolved.message };
      }
      calleeEntryById.set(calleeId, { status: "ok", entry: resolved.entry });
      return { ok: true, entry: resolved.entry };
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "failed to read callee workflow.json";
      calleeEntryById.set(calleeId, { status: "error", message });
      return { ok: false, message };
    }
  }

  for (const [stepIndex, step] of steps.entries()) {
    const transitions = step.transitions ?? [];
    for (const [ti, transition] of transitions.entries()) {
      if (transition.toWorkflowId === undefined) {
        continue;
      }
      const calleeId = transition.toWorkflowId;
      if (!isSafeWorkflowName(calleeId)) {
        issues.push(
          makeIssue(
            "error",
            `workflow.steps[${stepIndex}].transitions[${ti}].toWorkflowId`,
            `must be a safe workflow directory name (got '${calleeId}')`,
          ),
        );
        continue;
      }
      const resolved = resolveCalleeEntry(calleeId);
      if (!resolved.ok) {
        issues.push(
          makeIssue(
            "error",
            `workflow.steps[${stepIndex}].transitions[${ti}].toWorkflowId`,
            `cannot load callee workflow '${calleeId}': ${resolved.message}`,
          ),
        );
        continue;
      }
      if (transition.toStepId !== resolved.entry) {
        issues.push(
          makeIssue(
            "error",
            `workflow.steps[${stepIndex}].transitions[${ti}].toStepId`,
            `must match callee start step '${resolved.entry}' (callee '${calleeId}': managerStepId, else entryStepId); cross-workflow step calls use the callee's step-addressed start target`,
          ),
        );
      }
    }
  }
}

async function validateCrossWorkflowCalleeEntryAlignment(
  bundle: NormalizedWorkflowBundle,
  options: WorkflowValidationOptions,
  issues: ValidationIssue[],
): Promise<void> {
  const workflowRoot = options.workflowRoot;
  if (workflowRoot === undefined || workflowRoot === "") {
    return;
  }
  const steps = bundle.workflow.steps;
  if (steps === undefined) {
    return;
  }

  const cwd = options.cwd ?? process.cwd();
  const resolvedRoot = path.isAbsolute(workflowRoot)
    ? workflowRoot
    : path.resolve(cwd, workflowRoot);

  const calleeEntryById = new Map<
    string,
    { status: "ok"; entry: string } | { status: "error"; message: string }
  >();

  async function resolveCalleeEntry(
    calleeId: string,
  ): Promise<{ ok: true; entry: string } | { ok: false; message: string }> {
    const cached = calleeEntryById.get(calleeId);
    if (cached !== undefined) {
      return cached.status === "ok"
        ? { ok: true, entry: cached.entry }
        : { ok: false, message: cached.message };
    }

    try {
      const resolvedWorkflow = await resolveCalleeWorkflowJsonByIdAsync({
        workflowRoot: resolvedRoot,
        workflowId: calleeId,
      });
      if (!resolvedWorkflow.ok) {
        calleeEntryById.set(calleeId, {
          status: "error",
          message: resolvedWorkflow.message,
        });
        return { ok: false, message: resolvedWorkflow.message };
      }
      const inferred = await inferSingleManagerStepIdFromRawAsync({
        raw: resolvedWorkflow.raw,
        workflowDirectory: resolvedWorkflow.workflowDirectory,
      });
      if (!inferred.ok) {
        calleeEntryById.set(calleeId, {
          status: "error",
          message: inferred.message,
        });
        return { ok: false, message: inferred.message };
      }
      const resolved = resolveCalleeWorkflowEntry({
        raw: resolvedWorkflow.raw,
        ...(inferred.managerStepId === undefined
          ? {}
          : { inferredManagerStepId: inferred.managerStepId }),
      });
      if (!resolved.ok) {
        calleeEntryById.set(calleeId, {
          status: "error",
          message: resolved.message,
        });
        return { ok: false, message: resolved.message };
      }
      calleeEntryById.set(calleeId, { status: "ok", entry: resolved.entry });
      return { ok: true, entry: resolved.entry };
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "failed to read callee workflow.json";
      calleeEntryById.set(calleeId, { status: "error", message });
      return { ok: false, message };
    }
  }

  for (const [stepIndex, step] of steps.entries()) {
    const transitions = step.transitions ?? [];
    for (const [ti, transition] of transitions.entries()) {
      if (transition.toWorkflowId === undefined) {
        continue;
      }
      const calleeId = transition.toWorkflowId;
      if (!isSafeWorkflowName(calleeId)) {
        issues.push(
          makeIssue(
            "error",
            `workflow.steps[${stepIndex}].transitions[${ti}].toWorkflowId`,
            `must be a safe workflow directory name (got '${calleeId}')`,
          ),
        );
        continue;
      }
      const resolved = await resolveCalleeEntry(calleeId);
      if (!resolved.ok) {
        issues.push(
          makeIssue(
            "error",
            `workflow.steps[${stepIndex}].transitions[${ti}].toWorkflowId`,
            `cannot load callee workflow '${calleeId}': ${resolved.message}`,
          ),
        );
        continue;
      }
      if (transition.toStepId !== resolved.entry) {
        issues.push(
          makeIssue(
            "error",
            `workflow.steps[${stepIndex}].transitions[${ti}].toStepId`,
            `must match callee start step '${resolved.entry}' (callee '${calleeId}': managerStepId, else entryStepId); cross-workflow step calls use the callee's step-addressed start target`,
          ),
        );
      }
    }
  }
}

function runSemanticValidation(
  bundle: NormalizedWorkflowBundle,
  issues: ValidationIssue[],
): void {
  const structuralEdges = getStructuralEdges(bundle.workflow);
  const structuralLoops = getStructuralLoops(bundle.workflow);
  const nodeIdSet = new Set(bundle.workflow.nodes.map((node) => node.id));
  const nodeOrderByNodeId = new Map(
    bundle.workflow.nodes.map((node, order) => [node.id, order]),
  );

  const seenNodeIds = new Set<string>();
  bundle.workflow.nodes.forEach((node, index) => {
    if (seenNodeIds.has(node.id)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.nodes[${index}].id`,
          `duplicate node id '${node.id}'`,
        ),
      );
      return;
    }
    seenNodeIds.add(node.id);

    const payload = getNormalizedNodePayload(bundle, node.id);
    if (!payload) {
      issues.push(
        makeIssue(
          "error",
          `nodePayloads.${node.nodeFile}`,
          "node payload file is missing",
        ),
      );
      return;
    }

    if (
      node.role === "manager" &&
      (payload.nodeType === "command" ||
        payload.nodeType === "container" ||
        payload.nodeType === "user-action" ||
        payload.nodeType === "addon")
    ) {
      issues.push(
        makeIssue(
          "error",
          `nodePayloads.${node.nodeFile}.nodeType`,
          "manager-role nodes must stay on the agent execution path",
        ),
      );
    }
    if (node.role !== "manager" && payload.managerType !== undefined) {
      issues.push(
        makeIssue(
          "error",
          `nodePayloads.${node.nodeFile}.managerType`,
          "managerType is valid only for manager-role nodes",
        ),
      );
    }

    if (
      payload.timeoutMs === undefined &&
      bundle.workflow.defaults.nodeTimeoutMs === DEFAULT_NODE_TIMEOUT_MS
    ) {
      issues.push(
        makeIssue(
          "warning",
          `nodePayloads.${node.nodeFile}.timeoutMs`,
          "not set; workflow default timeout will be applied",
        ),
      );
    }
  });

  structuralEdges.forEach((edge, index) => {
    if (!nodeIdSet.has(edge.from)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.steps[${index}].transitions`,
          "must reference an existing step id",
        ),
      );
    }
    if (!nodeIdSet.has(edge.to)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.steps[${index}].transitions`,
          "must reference an existing step id",
        ),
      );
    }
  });

  structuralLoops.forEach((loop, index) => {
    if (!nodeIdSet.has(loop.judgeNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.loops[${index}].judgeNodeId`,
          "must reference an existing node id",
        ),
      );
      return;
    }
    const judgeNode = bundle.workflow.nodes.find(
      (node) => node.id === loop.judgeNodeId,
    );
    if (judgeNode?.kind !== "loop-judge") {
      issues.push(
        makeIssue(
          "error",
          `workflow.loops[${index}].judgeNodeId`,
          "must reference a loop-judge node",
        ),
      );
    }
  });

  const loopIntervals: Array<{
    readonly id: string;
    readonly startOrder: number;
    readonly endOrder: number;
  }> = [];
  structuralLoops.forEach((loop, index) => {
    const judgeOrder = nodeOrderByNodeId.get(loop.judgeNodeId);
    if (judgeOrder === undefined) {
      return;
    }

    const continueTargets = structuralEdges.filter(
      (edge) =>
        edge.from === loop.judgeNodeId && edge.when === loop.continueWhen,
    );
    if (continueTargets.length === 0) {
      issues.push(
        makeIssue(
          "error",
          `workflow.loops[${index}].continueWhen`,
          "must have at least one matching continue edge from the loop judge",
        ),
      );
    }
    continueTargets.forEach((edge, continueIndex) => {
      const targetOrder = nodeOrderByNodeId.get(edge.to);
      if (targetOrder === undefined) {
        return;
      }
      if (targetOrder <= judgeOrder) {
        loopIntervals.push({
          id: loop.id,
          startOrder: targetOrder,
          endOrder: judgeOrder,
        });
      }
      if (targetOrder > judgeOrder) {
        issues.push(
          makeIssue(
            "error",
            `workflow.loops[${index}].continueWhen`,
            `continue edge target '${edge.to}' must appear before loop judge '${loop.judgeNodeId}' in vertical order`,
          ),
        );
      }
      if (
        continueIndex > 0 &&
        targetOrder !== undefined &&
        targetOrder !== nodeOrderByNodeId.get(continueTargets[0]?.to ?? "")
      ) {
        issues.push(
          makeIssue(
            "warning",
            `workflow.loops[${index}].continueWhen`,
            "multiple continue targets produce a shared visual loop block based on the earliest target",
          ),
        );
      }
    });

    structuralEdges
      .filter(
        (edge) => edge.from === loop.judgeNodeId && edge.when === loop.exitWhen,
      )
      .forEach((edge) => {
        const targetOrder = nodeOrderByNodeId.get(edge.to);
        if (targetOrder === undefined) {
          return;
        }
        if (targetOrder <= judgeOrder) {
          issues.push(
            makeIssue(
              "error",
              `workflow.loops[${index}].exitWhen`,
              `exit edge target '${edge.to}' must appear after loop judge '${loop.judgeNodeId}' in vertical order`,
            ),
          );
        }
      });
  });

  for (let index = 0; index < loopIntervals.length; index += 1) {
    const current = loopIntervals[index];
    if (current === undefined) {
      continue;
    }
    for (
      let compareIndex = index + 1;
      compareIndex < loopIntervals.length;
      compareIndex += 1
    ) {
      const other = loopIntervals[compareIndex];
      if (other === undefined || current.id === other.id) {
        continue;
      }
      if (intervalsPartiallyOverlap(current, other)) {
        pushCrossingIntervalIssue(issues, bundle, {
          path: "workflow.loops",
          leftId: current.id,
          leftStartOrder: current.startOrder,
          rightId: other.id,
          rightStartOrder: other.startOrder,
          messagePrefix: "vertical loop scopes",
        });
      }
    }
  }

  if (
    bundle.workflow.defaults.maxLoopIterations === DEFAULT_MAX_LOOP_ITERATIONS
  ) {
    issues.push(
      makeIssue(
        "warning",
        "workflow.defaults.maxLoopIterations",
        "using default loop iteration value; consider explicit value per workflow",
      ),
    );
  }
}

function validateResolvedAddonPayload(input: {
  readonly authoredAddonName: string;
  readonly expectedNodeId: string;
  readonly payload: unknown;
  readonly path: string;
  readonly issues: ValidationIssue[];
}): boolean {
  const payload = input.payload;
  let valid = true;
  if (!isRecord(payload)) {
    input.issues.push(
      makeIssue("error", `${input.path}.payload`, "must be an object"),
    );
    return false;
  }
  if (payload["id"] !== input.expectedNodeId) {
    input.issues.push(
      makeIssue(
        "error",
        `${input.path}.payload.id`,
        `resolved add-on payload id must be '${input.expectedNodeId}'`,
      ),
    );
    valid = false;
  }
  if (
    !input.authoredAddonName.startsWith("divedra/") &&
    payload["nodeType"] === "addon"
  ) {
    input.issues.push(
      makeIssue(
        "error",
        `${input.path}.payload.nodeType`,
        "third-party add-on resolvers must return an ordinary agent, command, container, or user-action payload",
      ),
    );
    valid = false;
  }
  if (
    !input.authoredAddonName.startsWith("divedra/") &&
    payload["addon"] !== undefined
  ) {
    input.issues.push(
      makeIssue(
        "error",
        `${input.path}.payload.addon`,
        "third-party add-on resolvers must not return runtime add-on metadata",
      ),
    );
    valid = false;
  }
  return valid;
}

function resolveSyncNodeAddonResolvers(
  options: WorkflowValidationOptions,
  issues: ValidationIssue[],
): readonly NodeAddonPayloadResolver[] | undefined {
  if (
    options.asyncNodeAddonResolvers !== undefined &&
    options.asyncNodeAddonResolvers.length > 0
  ) {
    issues.push(
      makeIssue(
        "error",
        "workflow.nodes",
        "async node add-on resolvers require validateWorkflowBundleAsync or loadWorkflowFromDisk",
      ),
    );
  }

  return options.nodeAddons === undefined || options.nodeAddons.length === 0
    ? options.nodeAddonResolvers
    : [
        ...(options.nodeAddonResolvers ?? []),
        createNodeAddonRegistry(options.nodeAddons),
      ];
}

function resolveAsyncNodeAddonResolvers(
  options: WorkflowValidationOptions,
): readonly AsyncNodeAddonPayloadResolver[] | undefined {
  const resolvers: AsyncNodeAddonPayloadResolver[] = [
    ...(options.nodeAddonResolvers ?? []),
    ...(options.asyncNodeAddonResolvers ?? []),
  ];
  if (options.nodeAddons !== undefined && options.nodeAddons.length > 0) {
    resolvers.push(createAsyncNodeAddonRegistry(options.nodeAddons));
  }
  return resolvers.length === 0 ? undefined : resolvers;
}

function applyStepPromptVariant(input: {
  readonly basePayload: NodePayload;
  readonly workflow: Pick<WorkflowJson, "managerStepId">;
  readonly step: WorkflowStepRef;
  readonly issues: ValidationIssue[];
  readonly stepPath: string;
}): NodePayload {
  const { basePayload, step } = input;
  const stepRole = resolveWorkflowStepExecutionRole(input.workflow, step);
  if (stepRole !== "manager" && basePayload.managerType !== undefined) {
    input.issues.push(
      makeIssue(
        "error",
        `${input.stepPath}.nodeId`,
        `references node '${step.nodeId}' whose payload declares managerType; managerType is valid only for manager-role steps`,
      ),
    );
  }

  const resolvedPayload: NodePayload = {
    ...basePayload,
    id: step.id,
    ...(step.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
    ...(step.stallTimeoutMs === undefined
      ? {}
      : { stallTimeoutMs: step.stallTimeoutMs }),
    ...(step.sessionPolicy?.mode === undefined
      ? {}
      : { sessionPolicy: { mode: step.sessionPolicy.mode } }),
  };
  const payloadWithResolvedManagerType =
    stepRole === "manager"
      ? {
          ...resolvedPayload,
          managerType: basePayload.managerType ?? "code",
        }
      : (() => {
          const { managerType: _managerType, ...payloadWithoutManagerType } =
            resolvedPayload;
          return payloadWithoutManagerType;
        })();

  if (step.promptVariant === undefined) {
    return payloadWithResolvedManagerType;
  }

  const variant = basePayload.promptVariants?.[step.promptVariant];
  if (variant === undefined) {
    input.issues.push(
      makeIssue(
        "error",
        `${input.stepPath}.promptVariant`,
        `must reference a promptVariants entry on node '${step.nodeId}'`,
      ),
    );
    return payloadWithResolvedManagerType;
  }

  return [
    {
      templateField: "systemPromptTemplate" as const,
      templateFileField: "systemPromptTemplateFile" as const,
    },
    {
      templateField: "promptTemplate" as const,
      templateFileField: "promptTemplateFile" as const,
    },
    {
      templateField: "sessionStartPromptTemplate" as const,
      templateFileField: "sessionStartPromptTemplateFile" as const,
    },
  ].reduce(
    (payload, templatePair) =>
      applyPromptVariantTemplateOverride({
        payload,
        variant,
        templateField: templatePair.templateField,
        templateFileField: templatePair.templateFileField,
      }),
    payloadWithResolvedManagerType,
  );
}

function buildStepAddressedNodePayloadsSync(input: {
  readonly workflow: WorkflowJson;
  readonly nodePayloadsRaw: Readonly<Record<string, unknown>>;
  readonly issues: ValidationIssue[];
  readonly options: WorkflowValidationOptions;
  readonly nodeAddonResolvers: readonly NodeAddonPayloadResolver[] | undefined;
}): Record<string, NodePayload> {
  const nodePayloads: Record<string, NodePayload> = {};
  const nodeRegistry = input.workflow.nodeRegistry ?? [];
  const steps = input.workflow.steps ?? [];
  const basePayloadsByRegistryId = new Map<string, NodePayload>();
  const nodeRoleUsage = collectStepNodeRoleUsage(input.workflow);

  nodeRegistry.forEach((node, index) => {
    const usage = nodeRoleUsage.get(node.id);
    if (node.addon !== undefined) {
      const resolved = resolveNodeAddonPayload({
        nodeId: node.id,
        addon: node.addon,
        path: `workflow.nodes[${index}].addon`,
        ...(input.options.resolvedWorkflowSource === undefined
          ? {}
          : { workflowSource: input.options.resolvedWorkflowSource }),
        options: input.options,
        ...(input.nodeAddonResolvers === undefined
          ? {}
          : { thirdPartyResolvers: input.nodeAddonResolvers }),
      });
      input.issues.push(...(resolved.issues ?? []));
      if (
        resolved.payload !== undefined &&
        validateResolvedAddonPayload({
          authoredAddonName: node.addon.name,
          expectedNodeId: node.id,
          payload: resolved.payload,
          path: `workflow.nodes[${index}].addon`,
          issues: input.issues,
        })
      ) {
        const normalizedPayload = node.addon.name.startsWith("divedra/")
          ? (resolved.payload as NodePayload)
          : normalizeNodePayload({
              nodeId: node.id,
              nodeFile: node.nodeFile ?? synthesizeInlineNodeFile(node.id),
              payload: resolved.payload,
              issues: input.issues,
              path: `workflow.nodes[${index}].addon.payload`,
              allowManagerCodePathDefaults:
                usage?.manager === true && usage.worker !== true,
            });
        if (normalizedPayload !== null) {
          basePayloadsByRegistryId.set(node.id, normalizedPayload);
          nodePayloads[node.id] = normalizedPayload;
        }
      }
      return;
    }

    if (node.nodeFile === undefined) {
      return;
    }
    const payloadRaw = input.nodePayloadsRaw[node.nodeFile];
    if (payloadRaw === undefined) {
      input.issues.push(
        makeIssue(
          "error",
          `nodePayloads.${node.nodeFile}`,
          "node payload file is missing",
        ),
      );
      return;
    }
    const payload = normalizeNodePayload({
      nodeId: node.id,
      nodeFile: node.nodeFile,
      payload: payloadRaw,
      issues: input.issues,
      allowManagerCodePathDefaults:
        usage?.manager === true && usage.worker !== true,
    });
    if (payload !== null) {
      basePayloadsByRegistryId.set(node.id, payload);
      nodePayloads[node.id] = payload;
      nodePayloads[node.nodeFile] = payload;
    }
  });

  steps.forEach((step, index) => {
    const basePayload = basePayloadsByRegistryId.get(step.nodeId);
    if (basePayload === undefined) {
      return;
    }
    nodePayloads[step.id] = applyStepPromptVariant({
      basePayload,
      workflow: input.workflow,
      step,
      issues: input.issues,
      stepPath: `workflow.steps[${index}]`,
    });
  });

  return nodePayloads;
}

async function buildStepAddressedNodePayloadsAsync(input: {
  readonly workflow: WorkflowJson;
  readonly nodePayloadsRaw: Readonly<Record<string, unknown>>;
  readonly issues: ValidationIssue[];
  readonly options: WorkflowValidationOptions;
  readonly nodeAddonResolvers:
    | readonly AsyncNodeAddonPayloadResolver[]
    | undefined;
}): Promise<Record<string, NodePayload>> {
  const nodePayloads: Record<string, NodePayload> = {};
  const nodeRegistry = input.workflow.nodeRegistry ?? [];
  const steps = input.workflow.steps ?? [];
  const basePayloadsByRegistryId = new Map<string, NodePayload>();
  const nodeRoleUsage = collectStepNodeRoleUsage(input.workflow);

  for (const [index, node] of nodeRegistry.entries()) {
    const usage = nodeRoleUsage.get(node.id);
    if (node.addon !== undefined) {
      const resolved = await resolveNodeAddonPayloadAsync({
        nodeId: node.id,
        addon: node.addon,
        path: `workflow.nodes[${index}].addon`,
        ...(input.options.resolvedWorkflowSource === undefined
          ? {}
          : { workflowSource: input.options.resolvedWorkflowSource }),
        options: input.options,
        ...(input.nodeAddonResolvers === undefined
          ? {}
          : { thirdPartyResolvers: input.nodeAddonResolvers }),
      });
      input.issues.push(...(resolved.issues ?? []));
      if (
        resolved.payload !== undefined &&
        validateResolvedAddonPayload({
          authoredAddonName: node.addon.name,
          expectedNodeId: node.id,
          payload: resolved.payload,
          path: `workflow.nodes[${index}].addon`,
          issues: input.issues,
        })
      ) {
        const normalizedPayload = node.addon.name.startsWith("divedra/")
          ? (resolved.payload as NodePayload)
          : normalizeNodePayload({
              nodeId: node.id,
              nodeFile: node.nodeFile ?? synthesizeInlineNodeFile(node.id),
              payload: resolved.payload,
              issues: input.issues,
              path: `workflow.nodes[${index}].addon.payload`,
              allowManagerCodePathDefaults:
                usage?.manager === true && usage.worker !== true,
            });
        if (normalizedPayload !== null) {
          basePayloadsByRegistryId.set(node.id, normalizedPayload);
          nodePayloads[node.id] = normalizedPayload;
        }
      }
      continue;
    }

    if (node.nodeFile === undefined) {
      continue;
    }
    const payloadRaw = input.nodePayloadsRaw[node.nodeFile];
    if (payloadRaw === undefined) {
      input.issues.push(
        makeIssue(
          "error",
          `nodePayloads.${node.nodeFile}`,
          "node payload file is missing",
        ),
      );
      continue;
    }
    const payload = normalizeNodePayload({
      nodeId: node.id,
      nodeFile: node.nodeFile,
      payload: payloadRaw,
      issues: input.issues,
      allowManagerCodePathDefaults:
        usage?.manager === true && usage.worker !== true,
    });
    if (payload !== null) {
      basePayloadsByRegistryId.set(node.id, payload);
      nodePayloads[node.id] = payload;
      nodePayloads[node.nodeFile] = payload;
    }
  }

  steps.forEach((step, index) => {
    const basePayload = basePayloadsByRegistryId.get(step.nodeId);
    if (basePayload === undefined) {
      return;
    }
    nodePayloads[step.id] = applyStepPromptVariant({
      basePayload,
      workflow: input.workflow,
      step,
      issues: input.issues,
      stepPath: `workflow.steps[${index}]`,
    });
  });

  return nodePayloads;
}

export function validateWorkflowBundleDetailed(
  raw: RawBundle,
  options: WorkflowValidationOptions = {},
): Result<ValidationSuccessDetails, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const nodePayloadsRaw = remapAuthoredNodePayloadsByNodeFile(
    raw.workflow,
    raw.nodePayloads,
  );

  const workflow = normalizeWorkflow(raw.workflow, issues, options);

  const nodeAddonResolvers = resolveSyncNodeAddonResolvers(options, issues);

  let nodePayloads: Record<string, NodePayload> = {};
  if (workflow !== null && workflow.nodeRegistry !== undefined) {
    nodePayloads = buildStepAddressedNodePayloadsSync({
      workflow,
      nodePayloadsRaw,
      issues,
      options,
      nodeAddonResolvers,
    });
  } else if (workflow !== null) {
    workflow.nodes.forEach((node, index) => {
      if (node.addon !== undefined) {
        const resolved = resolveNodeAddonPayload({
          nodeId: node.id,
          addon: node.addon,
          path: `workflow.nodes[${index}].addon`,
          ...(options.resolvedWorkflowSource === undefined
            ? {}
            : { workflowSource: options.resolvedWorkflowSource }),
          options,
          ...(nodeAddonResolvers === undefined
            ? {}
            : { thirdPartyResolvers: nodeAddonResolvers }),
        });
        issues.push(...(resolved.issues ?? []));
        if (
          resolved.payload !== undefined &&
          validateResolvedAddonPayload({
            authoredAddonName: node.addon.name,
            expectedNodeId: node.id,
            payload: resolved.payload,
            path: `workflow.nodes[${index}].addon`,
            issues,
          })
        ) {
          if (node.addon.name.startsWith("divedra/")) {
            nodePayloads[node.id] = resolved.payload;
            return;
          }

          const normalizedPayload = normalizeNodePayload({
            nodeId: node.id,
            nodeFile: node.nodeFile,
            payload: resolved.payload,
            issues,
            path: `workflow.nodes[${index}].addon.payload`,
          });
          if (normalizedPayload !== null) {
            nodePayloads[node.id] = normalizedPayload;
          }
        }
        return;
      }

      const payloadRaw = nodePayloadsRaw[node.nodeFile];
      if (payloadRaw === undefined) {
        issues.push(
          makeIssue(
            "error",
            `nodePayloads.${node.nodeFile}`,
            "node payload file is missing",
          ),
        );
        return;
      }
      const payload = normalizeNodePayload({
        nodeId: node.id,
        nodeFile: node.nodeFile,
        payload: payloadRaw,
        issues,
      });
      if (payload !== null) {
        nodePayloads[node.id] = payload;
      }
    });
  }

  if (workflow === null) {
    return err(issues);
  }

  const bundle: NormalizedWorkflowBundle = {
    workflow,
    nodePayloads,
  };

  runSemanticValidation(bundle, issues);
  validateCrossWorkflowCalleeEntryAlignmentSync(bundle, options, issues);
  const allErrors = issues.filter((entry) => entry.severity === "error");
  if (allErrors.length > 0) {
    return err(issues);
  }

  return ok({ bundle, issues });
}

export async function validateWorkflowBundleDetailedAsync(
  raw: RawBundle,
  options: WorkflowValidationOptions = {},
): Promise<Result<ValidationSuccessDetails, readonly ValidationIssue[]>> {
  const issues: ValidationIssue[] = [];
  const nodePayloadsRaw = remapAuthoredNodePayloadsByNodeFile(
    raw.workflow,
    raw.nodePayloads,
  );

  const workflow = normalizeWorkflow(raw.workflow, issues, options);
  const nodeAddonResolvers = resolveAsyncNodeAddonResolvers(options);

  let nodePayloads: Record<string, NodePayload> = {};
  if (workflow !== null && workflow.nodeRegistry !== undefined) {
    nodePayloads = await buildStepAddressedNodePayloadsAsync({
      workflow,
      nodePayloadsRaw,
      issues,
      options,
      nodeAddonResolvers,
    });
  } else if (workflow !== null) {
    for (const [index, node] of workflow.nodes.entries()) {
      if (node.addon !== undefined) {
        const resolved = await resolveNodeAddonPayloadAsync({
          nodeId: node.id,
          addon: node.addon,
          path: `workflow.nodes[${index}].addon`,
          ...(options.resolvedWorkflowSource === undefined
            ? {}
            : { workflowSource: options.resolvedWorkflowSource }),
          options,
          ...(nodeAddonResolvers === undefined
            ? {}
            : { thirdPartyResolvers: nodeAddonResolvers }),
        });
        issues.push(...(resolved.issues ?? []));
        if (
          resolved.payload !== undefined &&
          validateResolvedAddonPayload({
            authoredAddonName: node.addon.name,
            expectedNodeId: node.id,
            payload: resolved.payload,
            path: `workflow.nodes[${index}].addon`,
            issues,
          })
        ) {
          if (node.addon.name.startsWith("divedra/")) {
            nodePayloads[node.id] = resolved.payload;
            continue;
          }

          const normalizedPayload = normalizeNodePayload({
            nodeId: node.id,
            nodeFile: node.nodeFile,
            payload: resolved.payload,
            issues,
            path: `workflow.nodes[${index}].addon.payload`,
          });
          if (normalizedPayload !== null) {
            nodePayloads[node.id] = normalizedPayload;
          }
        }
        continue;
      }

      const payloadRaw = nodePayloadsRaw[node.nodeFile];
      if (payloadRaw === undefined) {
        issues.push(
          makeIssue(
            "error",
            `nodePayloads.${node.nodeFile}`,
            "node payload file is missing",
          ),
        );
        continue;
      }
      const payload = normalizeNodePayload({
        nodeId: node.id,
        nodeFile: node.nodeFile,
        payload: payloadRaw,
        issues,
      });
      if (payload !== null) {
        nodePayloads[node.id] = payload;
      }
    }
  }

  if (workflow === null) {
    return err(issues);
  }

  const bundle: NormalizedWorkflowBundle = {
    workflow,
    nodePayloads,
  };

  runSemanticValidation(bundle, issues);
  await validateCrossWorkflowCalleeEntryAlignment(bundle, options, issues);
  const allErrors = issues.filter((entry) => entry.severity === "error");
  if (allErrors.length > 0) {
    return err(issues);
  }

  return ok({ bundle, issues });
}

export function validateWorkflowBundle(
  raw: RawBundle,
  options: WorkflowValidationOptions = {},
): ValidationResult {
  const validation = validateWorkflowBundleDetailed(raw, options);
  if (!validation.ok) {
    return err(validation.error);
  }
  return ok(validation.value.bundle);
}

export async function validateWorkflowBundleAsync(
  raw: RawBundle,
  options: WorkflowValidationOptions = {},
): Promise<ValidationResult> {
  const validation = await validateWorkflowBundleDetailedAsync(raw, options);
  if (!validation.ok) {
    return err(validation.error);
  }
  return ok(validation.value.bundle);
}
