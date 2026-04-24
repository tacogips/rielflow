import { readdirSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result } from "./result";
import { validateJsonSchemaDefinition } from "./json-schema";
import {
  isReservedWorkflowDefinitionPath,
  isSafeWorkflowRelativePath,
} from "./prompt-template-file";
import {
  INLINE_NODE_FIELD,
  isSupportedNodeFilePath,
  normalizeWorkflowRelativeJsonPath,
  remapAuthoredNodePayloadsByNodeFile,
  synthesizeInlineNodeFile,
} from "./authored-node";
import { crossWorkflowCallsFromSteps } from "./cross-workflow-from-steps";
import { isSafeWorkflowId, isSafeWorkflowName } from "./paths";
import { normalizeWorkingDirectoryPath } from "./working-directory";
import {
  normalizeCliAgentBackend,
  normalizeNodeExecutionBackend,
} from "./backend";
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
  type ArgumentBinding,
  type AsyncNodeAddonPayloadResolver,
  type CommandExecution,
  type ContainerBuild,
  type ContainerExecution,
  type ContainerRuntimeDefaults,
  type ContainerRunnerKind,
  type JsonObject,
  type LoadOptions,
  type CompletionRule,
  type NodeControlKind,
  type NodeAddonPayloadResolver,
  type NodeOutputContract,
  type NodeDurability,
  type LoopRule,
  type NodeExecutionBackend,
  type NodeKind,
  type NodePayload,
  type NodePromptVariant,
  type NodeRole,
  type NodeType,
  type NodeSessionPolicy,
  type NormalizedWorkflowBundle,
  type SubWorkflowBlock,
  type SubWorkflowConversation,
  type SubWorkflowInputSource,
  type SubWorkflowRef,
  type ValidationIssue,
  type WorkflowCallRef,
  type WorkflowEdge,
  type WorkflowJson,
  type WorkflowNodeExecutionPolicy,
  type WorkflowNodeAddonEnvBinding,
  type WorkflowNodeAddonRef,
  type WorkflowNodeRegistryRef,
  type WorkflowNodeRepeatPolicy,
  type WorkflowNodeRef,
  type WorkflowPrompts,
  type WorkflowStepRef,
  type WorkflowStepSessionPolicy,
  type WorkflowStepTransition,
  type WorkflowTimeoutPolicy,
  type UserActionNodeConfig,
} from "./types";

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
  readonly rejectLegacyWorkflowAuthoring?: boolean;
}

/**
 * When true, authored bundles must use step-addressed-only fields (legacy authoring rejected).
 * Explicit `false`/`true` always wins; when omitted, production defaults to strict. Callers that
 * load legacy-shaped fixtures (including unit tests) should pass `rejectLegacyWorkflowAuthoring:
 * false` on `LoadOptions`. Setting `DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT=true` still makes
 * omission non-strict for processes that cannot thread options (for example some `runCli` tests).
 */
export function isStrictWorkflowAuthorshipValidation(
  options: Pick<WorkflowValidationOptions, "rejectLegacyWorkflowAuthoring">,
): boolean {
  if (options.rejectLegacyWorkflowAuthoring === false) {
    return false;
  }
  if (options.rejectLegacyWorkflowAuthoring === true) {
    return true;
  }
  return process.env["DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT"] !== "true";
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

function normalizeNodeKind(value: unknown): NodeKind | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  switch (value) {
    case "task":
    case "branch-judge":
    case "loop-judge":
    case "root-manager":
    case "subworkflow-manager":
    case "input":
    case "output":
      return value;
    default:
      return undefined;
  }
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

function normalizeNodeControlKind(value: unknown): NodeControlKind | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "none" || value === "branch-judge" || value === "loop-judge") {
    return value;
  }
  return undefined;
}

function deriveRoleAndControlFromKind(kind: NodeKind): {
  readonly role: NodeRole;
  readonly control?: NodeControlKind;
} {
  switch (kind) {
    case "root-manager":
      return { role: "manager" };
    case "subworkflow-manager":
    case "branch-judge":
      return kind === "subworkflow-manager"
        ? { role: "worker" }
        : { role: "worker", control: "branch-judge" };
    case "loop-judge":
      return { role: "worker", control: "loop-judge" };
    case "task":
    case "input":
    case "output":
      return { role: "worker" };
  }
}

function deriveLegacyKindFromRoleAndControl(
  role: NodeRole | undefined,
  control: NodeControlKind | undefined,
): NodeKind | undefined {
  if (role === undefined) {
    return undefined;
  }
  if (role === "manager") {
    return "root-manager";
  }
  switch (control) {
    case "branch-judge":
      return "branch-judge";
    case "loop-judge":
      return "loop-judge";
    case "none":
    case undefined:
      return "task";
  }
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

function normalizeCompletion(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): CompletionRule | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return undefined;
  }

  const typeValue = value["type"];
  if (
    typeValue !== "checklist" &&
    typeValue !== "score-threshold" &&
    typeValue !== "validator-result" &&
    typeValue !== "none"
  ) {
    issues.push(
      makeIssue("error", `${path}.type`, "must be a valid completion type"),
    );
    return undefined;
  }

  const configValue = value["config"];
  if (configValue !== undefined && !isRecord(configValue)) {
    issues.push(
      makeIssue("error", `${path}.config`, "must be an object when provided"),
    );
    return { type: typeValue };
  }

  if (isRecord(configValue)) {
    return { type: typeValue, config: configValue };
  }
  return { type: typeValue };
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

function normalizeNodeRef(
  value: unknown,
  index: number,
  issues: ValidationIssue[],
): WorkflowNodeRef | null {
  const path = `workflow.nodes[${index}]`;
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const id = readStringField(value, "id", path, issues);
  const nodeFileRaw = value["nodeFile"];
  const inlineNodeRaw = value[INLINE_NODE_FIELD];
  const addonRaw = value["addon"];
  const addon = normalizeWorkflowNodeAddonRef(
    addonRaw,
    `${path}.addon`,
    issues,
  );
  let nodeFile: string | null = null;
  if (nodeFileRaw === undefined) {
    if (inlineNodeRaw === undefined && addonRaw === undefined) {
      issues.push(
        makeIssue(
          "error",
          `${path}.nodeFile`,
          "is required unless node or addon is provided",
        ),
      );
    } else if (id !== null) {
      nodeFile = synthesizeInlineNodeFile(id);
    }
  } else if (typeof nodeFileRaw !== "string" || nodeFileRaw.length === 0) {
    issues.push(
      makeIssue("error", `${path}.nodeFile`, "must be a non-empty string"),
    );
  } else {
    nodeFile = normalizeWorkflowRelativeJsonPath(nodeFileRaw);
  }
  if (nodeFileRaw !== undefined && inlineNodeRaw !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.${INLINE_NODE_FIELD}`,
        "must be omitted when nodeFile is provided",
      ),
    );
  }
  if (addonRaw !== undefined && nodeFileRaw !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.addon`,
        "must be omitted when nodeFile is provided",
      ),
    );
  }
  if (addonRaw !== undefined && inlineNodeRaw !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.addon`,
        `must be omitted when ${INLINE_NODE_FIELD} is provided`,
      ),
    );
  }
  const completion = normalizeCompletion(
    value["completion"],
    `${path}.completion`,
    issues,
  );
  const repeat = normalizeWorkflowNodeRepeatPolicy(
    value["repeat"],
    `${path}.repeat`,
    issues,
  );
  const execution = normalizeWorkflowNodeExecutionPolicy(
    value["execution"],
    `${path}.execution`,
    issues,
  );
  const groupRaw = value["group"];
  let group: string | undefined;
  if (groupRaw !== undefined) {
    if (typeof groupRaw !== "string" || groupRaw.length === 0) {
      issues.push(
        makeIssue(
          "error",
          `${path}.group`,
          "must be a non-empty string when provided",
        ),
      );
    } else {
      group = groupRaw;
    }
  }

  const roleRaw = value["role"];
  const normalizedRole = normalizeNodeRole(roleRaw);
  let role: WorkflowNodeRef["role"];
  if (roleRaw !== undefined) {
    if (normalizedRole === undefined) {
      issues.push(
        makeIssue("error", `${path}.role`, "must be 'manager' or 'worker'"),
      );
    } else {
      role = normalizedRole;
    }
  }

  const controlRaw = value["control"];
  const normalizedControl = normalizeNodeControlKind(controlRaw);
  let control: WorkflowNodeRef["control"];
  if (controlRaw !== undefined) {
    if (normalizedControl === undefined) {
      issues.push(
        makeIssue(
          "error",
          `${path}.control`,
          "must be 'none', 'branch-judge', or 'loop-judge'",
        ),
      );
    } else if (normalizedControl !== "none") {
      control = normalizedControl;
    }
  }

  const kindRaw = value["kind"];
  let kind: WorkflowNodeRef["kind"];
  if (kindRaw !== undefined) {
    const normalizedKind = normalizeNodeKind(kindRaw);
    if (normalizedKind === undefined) {
      issues.push(
        makeIssue("error", `${path}.kind`, "must be a valid node kind"),
      );
    } else {
      kind = normalizedKind;
      const usesAuthoredRoleFields =
        Object.hasOwn(value, "role") || Object.hasOwn(value, "control");
      if (
        usesAuthoredRoleFields &&
        (normalizedKind === "subworkflow-manager" ||
          normalizedKind === "input" ||
          normalizedKind === "output")
      ) {
        issues.push(
          makeIssue(
            "error",
            `${path}.kind`,
            `kind '${normalizedKind}' is legacy structural compatibility only and cannot be combined with authored role/control nodes`,
          ),
        );
      }
      const derived = deriveRoleAndControlFromKind(normalizedKind);
      if (role !== undefined && role !== derived.role) {
        issues.push(
          makeIssue(
            "error",
            `${path}.role`,
            `must match kind '${normalizedKind}'`,
          ),
        );
      }

      const derivedControl = derived.control;
      if (
        control !== undefined &&
        control !== "none" &&
        derivedControl !== undefined &&
        control !== derivedControl
      ) {
        issues.push(
          makeIssue(
            "error",
            `${path}.control`,
            `must match kind '${normalizedKind}'`,
          ),
        );
      } else if (
        control !== undefined &&
        control !== "none" &&
        derivedControl === undefined
      ) {
        issues.push(
          makeIssue(
            "error",
            `${path}.control`,
            `kind '${normalizedKind}' does not support control '${control}'`,
          ),
        );
      }
    }
  }

  if (role === undefined && control !== undefined) {
    role = "worker";
  }
  if (repeat !== undefined) {
    if (role === "manager") {
      issues.push(
        makeIssue(
          "error",
          `${path}.repeat`,
          "manager-role nodes cannot declare repeat",
        ),
      );
    }
    role ??= "worker";
    if (control !== undefined && control !== "loop-judge") {
      issues.push(
        makeIssue(
          "error",
          `${path}.control`,
          "repeat nodes must use loop-judge control",
        ),
      );
    }
    control = "loop-judge";
    if (kind !== undefined && kind !== "loop-judge") {
      issues.push(
        makeIssue(
          "error",
          `${path}.kind`,
          "repeat nodes must use kind 'loop-judge'",
        ),
      );
    }
    kind = "loop-judge";
  }
  if (kind === undefined) {
    kind = deriveLegacyKindFromRoleAndControl(role, control);
  }
  if (role === "manager" && control !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.control`,
        "manager-role nodes cannot declare branch or loop control",
      ),
    );
  }
  if (addon !== undefined && roleRaw === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.addon`,
        "add-on nodes must declare role 'worker'",
      ),
    );
  }
  if (role === "manager" && addon !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.addon`,
        "manager-role nodes cannot reference add-ons",
      ),
    );
  }

  if (id === null || nodeFile === null) {
    return null;
  }

  if (!NODE_ID_PATTERN.test(id)) {
    issues.push(
      makeIssue("error", `${path}.id`, "must match ^[a-z0-9][a-z0-9-]{1,63}$"),
    );
  }
  if (!isSupportedNodeFilePath(id, nodeFile)) {
    issues.push(
      makeIssue(
        "error",
        `${path}.nodeFile`,
        `must be a workflow-relative path whose basename equals node-${id}.json`,
      ),
    );
  }

  return {
    id,
    nodeFile,
    ...(addon === undefined ? {} : { addon }),
    ...(kind === undefined ? {} : { kind }),
    ...(role === undefined ? {} : { role }),
    ...(control === undefined ? {} : { control }),
    ...(completion === undefined ? {} : { completion }),
    ...(execution === undefined ? {} : { execution }),
    ...(group === undefined ? {} : { group }),
    ...(repeat === undefined ? {} : { repeat }),
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
          "uses an unsupported workflow node execution policy field",
        ),
      );
    }
  }

  const modeRaw = value["mode"];
  let mode: WorkflowNodeExecutionPolicy["mode"];
  if (modeRaw !== undefined) {
    if (modeRaw === "required" || modeRaw === "optional") {
      mode = modeRaw;
    } else {
      issues.push(
        makeIssue("error", `${path}.mode`, "must be 'required' or 'optional'"),
      );
    }
  }

  const decisionByRaw = value["decisionBy"];
  let decisionBy: WorkflowNodeExecutionPolicy["decisionBy"];
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

  if (mode === undefined && decisionBy === undefined) {
    issues.push(
      makeIssue(
        "error",
        path,
        "must define execution.mode when execution is provided",
      ),
    );
    return undefined;
  }
  if (mode === "optional" && decisionBy === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.decisionBy`,
        "is required when execution.mode is 'optional'",
      ),
    );
  }
  if (mode !== "optional" && decisionBy !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.decisionBy`,
        "is currently valid only when execution.mode is 'optional'",
      ),
    );
  }

  return {
    ...(mode === undefined ? {} : { mode }),
    ...(decisionBy === undefined ? {} : { decisionBy }),
  };
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

  const allowedKeys = new Set(["while", "restartAt", "maxIterations"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported workflow node repeat field",
        ),
      );
    }
  }

  const whileExpression = readStringField(value, "while", path, issues);
  const restartAtRaw = value["restartAt"];
  let restartAt: string | undefined;
  if (restartAtRaw !== undefined) {
    if (typeof restartAtRaw !== "string" || restartAtRaw.length === 0) {
      issues.push(
        makeIssue(
          "error",
          `${path}.restartAt`,
          "must be a non-empty string when provided",
        ),
      );
    } else {
      restartAt = restartAtRaw;
    }
  }

  const maxIterationsRaw = value["maxIterations"];
  let maxIterations: number | undefined;
  if (maxIterationsRaw !== undefined) {
    if (
      typeof maxIterationsRaw !== "number" ||
      !Number.isFinite(maxIterationsRaw) ||
      maxIterationsRaw <= 0
    ) {
      issues.push(
        makeIssue(
          "error",
          `${path}.maxIterations`,
          "must be a finite number > 0 when provided",
        ),
      );
    } else {
      maxIterations = maxIterationsRaw;
    }
  }

  if (whileExpression === null) {
    return undefined;
  }

  return {
    while: whileExpression,
    ...(restartAt === undefined ? {} : { restartAt }),
    ...(maxIterations === undefined ? {} : { maxIterations }),
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

  const allowedKeys = new Set(["id", "nodeFile", "addon"]);
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
    if (
      typeof resumeStepIdRaw === "string" &&
      resumeStepIdRaw.length > 0
    ) {
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

  if (toStepId === null) {
    return null;
  }

  return {
    toStepId,
    ...(toWorkflowId === undefined ? {} : { toWorkflowId }),
    ...(resumeStepId === undefined ? {} : { resumeStepId }),
    ...(label === undefined ? {} : { label }),
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
  let timeoutMs: number | undefined;
  if (timeoutMsRaw !== undefined) {
    if (
      typeof timeoutMsRaw === "number" &&
      Number.isFinite(timeoutMsRaw) &&
      timeoutMsRaw > 0
    ) {
      timeoutMs = timeoutMsRaw;
    } else {
      issues.push(
        makeIssue("error", `${path}.timeoutMs`, "must be > 0 when provided"),
      );
    }
  }

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
    isRecord(defaultsValue) &&
    readNumberField(
      defaultsValue,
      "nodeTimeoutMs",
      "workflow.defaults",
      issues,
    );
  const maxLoopIterationsRaw =
    isRecord(defaultsValue) && defaultsValue["maxLoopIterations"] !== undefined
      ? readNumberField(
          defaultsValue,
          "maxLoopIterations",
          "workflow.defaults",
          issues,
        )
      : DEFAULT_MAX_LOOP_ITERATIONS;
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

  for (const legacyField of [
    "managerNodeId",
    "entryNodeId",
    "subWorkflows",
    "subWorkflowConversations",
    "edges",
    "loops",
    "branching",
  ] as const) {
    if (workflow[legacyField] !== undefined) {
      issues.push(
        makeIssue(
          "error",
          `workflow.${legacyField}`,
          "is not part of the step-addressed workflow schema",
        ),
      );
    }
  }

  const workflowCallsRaw = workflow["workflowCalls"];
  if (workflowCallsRaw !== undefined) {
    if (isStrictWorkflowAuthorshipValidation(options)) {
      issues.push(
        makeIssue(
          "error",
          "workflow.workflowCalls",
          "is not part of the step-addressed workflow schema",
        ),
      );
    } else if (!Array.isArray(workflowCallsRaw)) {
      issues.push(
        makeIssue(
          "error",
          "workflow.workflowCalls",
          "must be an array when provided",
        ),
      );
    }
  }
  const workflowCalls =
    Array.isArray(workflowCallsRaw) &&
    !isStrictWorkflowAuthorshipValidation(options)
      ? workflowCallsRaw
          .map((entry, index) => normalizeWorkflowCall(entry, index, issues))
          .filter((entry): entry is WorkflowCallRef => entry !== null)
      : undefined;

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
    const callsFromSameStep = (workflowCalls ?? []).filter(
      (call) => (call.callerStepId ?? call.callerNodeId) === step.id,
    );
    if (crossWorkflowTransitions.length > 0 && callsFromSameStep.length > 0) {
      issues.push(
        makeIssue(
          "error",
          `workflow.steps[${index}]`,
          "cannot combine cross-workflow transitions with workflowCalls for the same caller step",
        ),
      );
    }
    step.transitions?.forEach((transition, transitionIndex) => {
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
    typeof maxLoopIterationsRaw !== "number"
  ) {
    return null;
  }

  const compatNodes: WorkflowNodeRef[] = steps.map((step) => {
    const registryNode = nodeRegistry.find((node) => node.id === step.nodeId);
    const role =
      step.role ?? (step.id === managerStepId ? "manager" : "worker");
    return {
      id: step.id,
      nodeFile: registryNode?.nodeFile ?? synthesizeInlineNodeFile(step.id),
      ...(registryNode?.addon === undefined
        ? {}
        : { addon: registryNode.addon }),
      role,
      kind: role === "manager" ? "root-manager" : "task",
    };
  });
  const edges: WorkflowEdge[] = steps.flatMap((step) =>
    (step.transitions ?? [])
      .filter((transition) => transition.toWorkflowId === undefined)
      .map((transition) => ({
        from: step.id,
        to: transition.toStepId,
        when: transition.label ?? "always",
      })),
  );

  const derivedCrossWorkflowCalls = crossWorkflowCallsFromSteps(steps);
  if (workflowCalls !== undefined) {
    const authoredIds = new Set(workflowCalls.map((call) => call.id));
    for (const derived of derivedCrossWorkflowCalls) {
      if (authoredIds.has(derived.id)) {
        issues.push(
          makeIssue(
            "error",
            "workflow.workflowCalls",
            `id '${derived.id}' is reserved for cross-workflow step transitions; rename the workflow call or adjust step transitions`,
          ),
        );
      }
    }
  }
  const mergedWorkflowCalls =
    workflowCalls === undefined ? undefined : [...workflowCalls];

  return {
    workflowId,
    description,
    defaults: {
      nodeTimeoutMs,
      maxLoopIterations: maxLoopIterationsRaw,
      ...(timeoutPolicy === undefined ? {} : { timeoutPolicy }),
      ...(containerRuntime === undefined ? {} : { containerRuntime }),
    },
    ...(prompts === undefined ? {} : { prompts }),
    managerNodeId: managerStepId ?? entryStepId,
    hasManagerNode: managerStepId !== undefined,
    entryNodeId: entryStepId,
    ...(mergedWorkflowCalls === undefined ? {} : { workflowCalls: mergedWorkflowCalls }),
    ...(managerStepId === undefined ? {} : { managerStepId }),
    entryStepId,
    nodeRegistry,
    steps,
    subWorkflows: [],
    nodes: compatNodes,
    edges,
    branching: { mode: "fan-out" },
  };
}

function normalizeEdge(
  value: unknown,
  index: number,
  issues: ValidationIssue[],
): WorkflowEdge | null {
  const path = `workflow.edges[${index}]`;
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const from = readStringField(value, "from", path, issues);
  const to = readStringField(value, "to", path, issues);
  const when = readStringField(value, "when", path, issues);
  const priorityRaw = value["priority"];

  let priority: number | undefined;
  if (priorityRaw !== undefined) {
    const parsed = readNumberField(value, "priority", path, issues);
    if (parsed !== null) {
      priority = parsed;
    }
  }

  if (from === null || to === null || when === null) {
    return null;
  }

  return {
    from,
    to,
    when,
    ...(priority === undefined ? {} : { priority }),
  };
}

function normalizeLoop(
  value: unknown,
  index: number,
  issues: ValidationIssue[],
): LoopRule | null {
  const path = `workflow.loops[${index}]`;
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const id = readStringField(value, "id", path, issues);
  const judgeNodeId = readStringField(value, "judgeNodeId", path, issues);
  const continueWhen = readStringField(value, "continueWhen", path, issues);
  const exitWhen = readStringField(value, "exitWhen", path, issues);

  let maxIterations: number | undefined;
  const maxIterationsRaw = value["maxIterations"];
  if (maxIterationsRaw !== undefined) {
    const parsed = readNumberField(value, "maxIterations", path, issues);
    if (parsed !== null && parsed > 0) {
      maxIterations = parsed;
    } else if (parsed !== null) {
      issues.push(makeIssue("error", `${path}.maxIterations`, "must be > 0"));
    }
  }

  let backoffMs: number | undefined;
  const backoffRaw = value["backoffMs"];
  if (backoffRaw !== undefined) {
    const parsed = readNumberField(value, "backoffMs", path, issues);
    if (parsed !== null && parsed >= 0) {
      backoffMs = parsed;
    } else if (parsed !== null) {
      issues.push(makeIssue("error", `${path}.backoffMs`, "must be >= 0"));
    }
  }

  if (
    id === null ||
    judgeNodeId === null ||
    continueWhen === null ||
    exitWhen === null
  ) {
    return null;
  }

  return {
    id,
    judgeNodeId,
    continueWhen,
    exitWhen,
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(backoffMs === undefined ? {} : { backoffMs }),
  };
}

function normalizeWorkflowCall(
  value: unknown,
  index: number,
  issues: ValidationIssue[],
): WorkflowCallRef | null {
  const path = `workflow.workflowCalls[${index}]`;
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const id = readStringField(value, "id", path, issues);
  const workflowId = readStringField(value, "workflowId", path, issues);
  const callerNodeId = readStringField(value, "callerNodeId", path, issues);

  const callerStepIdRaw = value["callerStepId"];
  let callerStepId: string | undefined;
  if (callerStepIdRaw !== undefined) {
    if (typeof callerStepIdRaw === "string" && callerStepIdRaw.length > 0) {
      callerStepId = callerStepIdRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.callerStepId`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const resultNodeIdRaw = value["resultNodeId"];
  let resultNodeId: string | undefined;
  if (resultNodeIdRaw !== undefined) {
    if (typeof resultNodeIdRaw === "string" && resultNodeIdRaw.length > 0) {
      resultNodeId = resultNodeIdRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.resultNodeId`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const whenRaw = value["when"];
  let when: string | undefined;
  if (whenRaw !== undefined) {
    if (typeof whenRaw === "string" && whenRaw.length > 0) {
      when = whenRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.when`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  if (id === null || workflowId === null || callerNodeId === null) {
    return null;
  }

  return {
    id,
    workflowId,
    callerNodeId,
    ...(callerStepId === undefined ? {} : { callerStepId }),
    ...(resultNodeId === undefined ? {} : { resultNodeId }),
    ...(when === undefined ? {} : { when }),
  };
}

function normalizeSubWorkflowInputSource(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): SubWorkflowInputSource | null {
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const typeRaw = value["type"];
  if (
    typeRaw !== "human-input" &&
    typeRaw !== "workflow-output" &&
    typeRaw !== "node-output" &&
    typeRaw !== "sub-workflow-output"
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.type`,
        "must be a valid sub-workflow input source type",
      ),
    );
    return null;
  }

  const workflowId =
    typeof value["workflowId"] === "string" ? value["workflowId"] : undefined;
  const nodeId =
    typeof value["nodeId"] === "string" ? value["nodeId"] : undefined;
  const subWorkflowId =
    typeof value["subWorkflowId"] === "string"
      ? value["subWorkflowId"]
      : undefined;

  if (
    typeRaw === "workflow-output" &&
    (workflowId === undefined || workflowId.length === 0)
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.workflowId`,
        "is required when type is workflow-output",
      ),
    );
  }
  if (
    typeRaw === "node-output" &&
    (nodeId === undefined || nodeId.length === 0)
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.nodeId`,
        "is required when type is node-output",
      ),
    );
  }
  if (
    typeRaw === "sub-workflow-output" &&
    (subWorkflowId === undefined || subWorkflowId.length === 0)
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.subWorkflowId`,
        "is required when type is sub-workflow-output",
      ),
    );
  }

  if (value["selectionPolicy"] !== undefined) {
    issues.push(
      makeIssue(
        "warning",
        `${path}.selectionPolicy`,
        "deprecated/unsupported in current runtime phase; remove or migrate before execution",
      ),
    );
    issues.push(
      makeIssue(
        "error",
        `${path}.selectionPolicy`,
        "is currently unsupported and rejected in the active runtime phase",
      ),
    );
  }

  return {
    type: typeRaw,
    ...(workflowId === undefined ? {} : { workflowId }),
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(subWorkflowId === undefined ? {} : { subWorkflowId }),
  };
}

function normalizeSubWorkflow(
  value: unknown,
  index: number,
  issues: ValidationIssue[],
): SubWorkflowRef | null {
  const path = `workflow.subWorkflows[${index}]`;
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const id = readStringField(value, "id", path, issues);
  const description = readStringField(value, "description", path, issues);
  const managerNodeId = readStringField(value, "managerNodeId", path, issues);
  const inputNodeId = readStringField(value, "inputNodeId", path, issues);
  const outputNodeId = readStringField(value, "outputNodeId", path, issues);
  const nodeIdsRaw = value["nodeIds"];
  if (!Array.isArray(nodeIdsRaw)) {
    issues.push(makeIssue("error", `${path}.nodeIds`, "must be an array"));
  }
  const nodeIds = Array.isArray(nodeIdsRaw)
    ? nodeIdsRaw.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.length > 0,
      )
    : undefined;
  if (
    Array.isArray(nodeIdsRaw) &&
    nodeIds !== undefined &&
    nodeIds.length !== nodeIdsRaw.length
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.nodeIds`,
        "must contain only non-empty strings",
      ),
    );
  }

  if (value["inputs"] !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.inputs`,
        "legacy field 'inputs' is not supported; use 'inputSources'",
      ),
    );
  }
  const inputSourcesRaw = value["inputSources"];
  if (!Array.isArray(inputSourcesRaw)) {
    issues.push(makeIssue("error", `${path}.inputSources`, "must be an array"));
  }
  const inputSources = Array.isArray(inputSourcesRaw)
    ? inputSourcesRaw
        .map((entry, sourceIndex) =>
          normalizeSubWorkflowInputSource(
            entry,
            `${path}.inputSources[${sourceIndex}]`,
            issues,
          ),
        )
        .filter((entry): entry is SubWorkflowInputSource => entry !== null)
    : [];

  let block: SubWorkflowBlock | undefined;
  const blockRaw = value["block"];
  if (blockRaw !== undefined) {
    if (!isRecord(blockRaw)) {
      issues.push(
        makeIssue("error", `${path}.block`, "must be an object when provided"),
      );
    } else {
      const typeRaw = blockRaw["type"];
      const loopIdRaw = blockRaw["loopId"];
      if (
        typeRaw !== "plain" &&
        typeRaw !== "branch-block" &&
        typeRaw !== "loop-body"
      ) {
        issues.push(
          makeIssue(
            "error",
            `${path}.block.type`,
            "must be 'plain', 'branch-block', or 'loop-body'",
          ),
        );
      } else {
        if (
          loopIdRaw !== undefined &&
          (typeof loopIdRaw !== "string" || loopIdRaw.length === 0)
        ) {
          issues.push(
            makeIssue(
              "error",
              `${path}.block.loopId`,
              "must be a non-empty string when provided",
            ),
          );
        }
        block = {
          type: typeRaw,
          ...(typeof loopIdRaw === "string" && loopIdRaw.length > 0
            ? { loopId: loopIdRaw }
            : {}),
        };
      }
    }
  }

  if (
    id === null ||
    description === null ||
    managerNodeId === null ||
    inputNodeId === null ||
    outputNodeId === null ||
    nodeIds === undefined
  ) {
    return null;
  }

  return {
    id,
    description,
    managerNodeId,
    inputNodeId,
    outputNodeId,
    nodeIds,
    inputSources,
    ...(block === undefined ? {} : { block }),
  };
}

function normalizeSubWorkflowConversation(
  value: unknown,
  index: number,
  issues: ValidationIssue[],
): SubWorkflowConversation | null {
  const path = `workflow.subWorkflowConversations[${index}]`;
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const id = readStringField(value, "id", path, issues);
  const stopWhen = readStringField(value, "stopWhen", path, issues);

  if (value["participantsIds"] !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.participantsIds`,
        "legacy field 'participantsIds' is not supported; use 'participants'",
      ),
    );
  }
  const participantsRaw = value["participants"];
  if (!Array.isArray(participantsRaw)) {
    issues.push(makeIssue("error", `${path}.participants`, "must be an array"));
  }
  const participants = Array.isArray(participantsRaw)
    ? participantsRaw.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.length > 0,
      )
    : [];
  if (
    Array.isArray(participantsRaw) &&
    participants.length !== participantsRaw.length
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.participants`,
        "must contain only non-empty strings",
      ),
    );
  }

  const maxTurnsRaw = value["maxTurns"];
  let maxTurns: number | null = null;
  if (
    typeof maxTurnsRaw === "number" &&
    Number.isFinite(maxTurnsRaw) &&
    maxTurnsRaw > 0
  ) {
    maxTurns = maxTurnsRaw;
  } else {
    issues.push(
      makeIssue("error", `${path}.maxTurns`, "must be a positive number"),
    );
  }

  if (value["conversationPolicy"] !== undefined) {
    issues.push(
      makeIssue(
        "warning",
        `${path}.conversationPolicy`,
        "deprecated/unsupported in current runtime phase; remove or migrate before execution",
      ),
    );
    issues.push(
      makeIssue(
        "error",
        `${path}.conversationPolicy`,
        "is currently unsupported and rejected in the active runtime phase",
      ),
    );
  }

  if (id === null || stopWhen === null || maxTurns === null) {
    return null;
  }

  return {
    id,
    participants,
    maxTurns,
    stopWhen,
  };
}

function buildRepeatExitExpression(whileExpression: string): string {
  return `!(${whileExpression})`;
}

function synthesizeSequentialEdges(input: {
  readonly nodes: readonly WorkflowNodeRef[];
  readonly issues: ValidationIssue[];
}): readonly WorkflowEdge[] {
  const edges: WorkflowEdge[] = [];

  input.nodes.forEach((node, index) => {
    const nextNode = input.nodes[index + 1];
    if (nextNode === undefined) {
      if (node.repeat !== undefined) {
        input.issues.push(
          makeIssue(
            "error",
            `workflow.nodes[${index}].repeat`,
            "repeat nodes cannot be the terminal node in simplified sequential mode",
          ),
        );
      }
      return;
    }

    if (node.repeat === undefined) {
      edges.push({ from: node.id, to: nextNode.id, when: "always" });
      return;
    }

    const restartAt = node.repeat.restartAt ?? node.id;
    const restartIndex = input.nodes.findIndex(
      (candidate) => candidate.id === restartAt,
    );
    if (restartIndex < 0) {
      input.issues.push(
        makeIssue(
          "error",
          `workflow.nodes[${index}].repeat.restartAt`,
          `must reference an existing node id (${restartAt})`,
        ),
      );
      return;
    }
    if (restartIndex > index) {
      input.issues.push(
        makeIssue(
          "error",
          `workflow.nodes[${index}].repeat.restartAt`,
          "must reference the same node or an earlier node in simplified sequential mode",
        ),
      );
      return;
    }

    edges.push({ from: node.id, to: restartAt, when: node.repeat.while });
    edges.push({
      from: node.id,
      to: nextNode.id,
      when: buildRepeatExitExpression(node.repeat.while),
    });
  });

  return edges;
}

function synthesizeRepeatLoops(
  nodes: readonly WorkflowNodeRef[],
): readonly LoopRule[] {
  return nodes.flatMap((node) =>
    node.repeat === undefined
      ? []
      : [
          {
            id: `repeat-${node.id}`,
            judgeNodeId: node.id,
            continueWhen: node.repeat.while,
            exitWhen: buildRepeatExitExpression(node.repeat.while),
            ...(node.repeat.maxIterations === undefined
              ? {}
              : { maxIterations: node.repeat.maxIterations }),
          },
        ],
  );
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

  if (isStrictWorkflowAuthorshipValidation(options)) {
    return normalizeStepAddressedWorkflow(workflow, issues, options);
  }

  if (
    Object.hasOwn(workflow, "steps") ||
    workflow["entryStepId"] !== undefined ||
    workflow["managerStepId"] !== undefined
  ) {
    return normalizeStepAddressedWorkflow(workflow, issues, options);
  }

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
  let description: string | null;
  if (descriptionRaw === undefined) {
    description = "";
  } else if (typeof descriptionRaw === "string" && descriptionRaw.length > 0) {
    description = descriptionRaw;
  } else {
    issues.push(
      makeIssue(
        "error",
        "workflow.description",
        "must be a non-empty string when provided",
      ),
    );
    description = null;
  }
  const managerNodeIdRaw = workflow["managerNodeId"];
  let managerNodeId: string | undefined | null;
  if (managerNodeIdRaw !== undefined) {
    if (typeof managerNodeIdRaw === "string" && managerNodeIdRaw.length > 0) {
      managerNodeId = managerNodeIdRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          "workflow.managerNodeId",
          "must be a non-empty string when provided",
        ),
      );
      managerNodeId = null;
    }
  }

  const entryNodeIdRaw = workflow["entryNodeId"];
  let entryNodeId: string | undefined | null;
  if (entryNodeIdRaw !== undefined) {
    if (typeof entryNodeIdRaw === "string" && entryNodeIdRaw.length > 0) {
      entryNodeId = entryNodeIdRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          "workflow.entryNodeId",
          "must be a non-empty string when provided",
        ),
      );
      entryNodeId = null;
    }
  }

  const defaultsValue = workflow["defaults"];
  if (!isRecord(defaultsValue)) {
    issues.push(makeIssue("error", "workflow.defaults", "must be an object"));
  }

  const maxLoopIterations =
    isRecord(defaultsValue) &&
    readNumberField(
      defaultsValue,
      "maxLoopIterations",
      "workflow.defaults",
      issues,
    );
  const nodeTimeoutMs =
    isRecord(defaultsValue) &&
    readNumberField(
      defaultsValue,
      "nodeTimeoutMs",
      "workflow.defaults",
      issues,
    );
  const containerRuntime = normalizeContainerRuntimeDefaults(
    isRecord(defaultsValue) ? defaultsValue["containerRuntime"] : undefined,
    "workflow.defaults.containerRuntime",
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

  const subWorkflowsRaw = workflow["subWorkflows"];
  const subWorkflows = Array.isArray(subWorkflowsRaw)
    ? subWorkflowsRaw
        .map((entry, index) => normalizeSubWorkflow(entry, index, issues))
        .filter((entry): entry is SubWorkflowRef => entry !== null)
    : [];
  if (subWorkflowsRaw !== undefined && !Array.isArray(subWorkflowsRaw)) {
    issues.push(
      makeIssue(
        "error",
        "workflow.subWorkflows",
        "must be an array when provided",
      ),
    );
  }

  const nodesRaw = workflow["nodes"];
  if (!Array.isArray(nodesRaw)) {
    issues.push(makeIssue("error", "workflow.nodes", "must be an array"));
  }
  const usesAuthoredRoleModel =
    Array.isArray(nodesRaw) &&
    nodesRaw.some(
      (entry) =>
        isRecord(entry) &&
        (Object.hasOwn(entry, "role") || Object.hasOwn(entry, "control")),
    );
  const nodes = Array.isArray(nodesRaw)
    ? nodesRaw
        .map((entry, index) => normalizeNodeRef(entry, index, issues))
        .filter((entry): entry is WorkflowNodeRef => entry !== null)
    : [];

  if (usesAuthoredRoleModel && subWorkflows.length > 0) {
    issues.push(
      makeIssue(
        "error",
        "workflow.subWorkflows",
        "non-empty structural subWorkflows are legacy compatibility only and cannot be combined with authored role/control nodes",
      ),
    );
  }

  const edgesRaw = workflow["edges"];
  if (edgesRaw !== undefined && !Array.isArray(edgesRaw)) {
    issues.push(
      makeIssue("error", "workflow.edges", "must be an array when provided"),
    );
  }
  const authoredEdges = Array.isArray(edgesRaw)
    ? edgesRaw
        .map((entry, index) => normalizeEdge(entry, index, issues))
        .filter((entry): entry is WorkflowEdge => entry !== null)
    : undefined;

  const workflowCallsRaw = workflow["workflowCalls"];
  if (workflowCallsRaw !== undefined && !Array.isArray(workflowCallsRaw)) {
    issues.push(
      makeIssue(
        "error",
        "workflow.workflowCalls",
        "must be an array when provided",
      ),
    );
  }
  const workflowCalls = Array.isArray(workflowCallsRaw)
    ? workflowCallsRaw
        .map((entry, index) => normalizeWorkflowCall(entry, index, issues))
        .filter((entry): entry is WorkflowCallRef => entry !== null)
    : undefined;

  const loopsRaw = workflow["loops"];
  const authoredLoops = Array.isArray(loopsRaw)
    ? loopsRaw
        .map((entry, index) => normalizeLoop(entry, index, issues))
        .filter((entry): entry is LoopRule => entry !== null)
    : undefined;

  if (loopsRaw !== undefined && !Array.isArray(loopsRaw)) {
    issues.push(
      makeIssue("error", "workflow.loops", "must be an array when provided"),
    );
  }

  const hasRepeatNodes = nodes.some((node) => node.repeat !== undefined);
  if (hasRepeatNodes && authoredEdges !== undefined) {
    issues.push(
      makeIssue(
        "error",
        "workflow.edges",
        "repeat is supported only when workflow.edges is omitted in the simplified transition format",
      ),
    );
  }

  const edges = authoredEdges ?? synthesizeSequentialEdges({ nodes, issues });
  const repeatLoops = synthesizeRepeatLoops(nodes);
  const loops =
    authoredLoops === undefined
      ? repeatLoops.length === 0
        ? undefined
        : repeatLoops
      : [...authoredLoops, ...repeatLoops];

  const branching = workflow["branching"];
  if (branching !== undefined) {
    if (!isRecord(branching)) {
      issues.push(
        makeIssue("error", "workflow.branching", "must be an object"),
      );
    }
    if (!isRecord(branching) || branching["mode"] !== "fan-out") {
      issues.push(
        makeIssue("error", "workflow.branching.mode", "must be 'fan-out'"),
      );
    }
  }

  const subWorkflowConversationsRaw = workflow["subWorkflowConversations"];
  if (
    subWorkflowConversationsRaw !== undefined &&
    !Array.isArray(subWorkflowConversationsRaw)
  ) {
    issues.push(
      makeIssue(
        "error",
        "workflow.subWorkflowConversations",
        "must be an array when provided",
      ),
    );
  }
  const subWorkflowConversations = Array.isArray(subWorkflowConversationsRaw)
    ? subWorkflowConversationsRaw
        .map((entry, index) =>
          normalizeSubWorkflowConversation(entry, index, issues),
        )
        .filter((entry): entry is SubWorkflowConversation => entry !== null)
    : undefined;

  if (usesAuthoredRoleModel && (subWorkflowConversations?.length ?? 0) > 0) {
    issues.push(
      makeIssue(
        "error",
        "workflow.subWorkflowConversations",
        "non-empty structural subWorkflowConversations are legacy compatibility only and cannot be combined with authored role/control nodes",
      ),
    );
  }

  const authoredManagerNodeIds = nodes
    .filter((node) => node.role === "manager")
    .map((node) => node.id);
  const hasManagerNode =
    managerNodeId !== undefined || authoredManagerNodeIds.length > 0;
  let effectiveManagerNodeId = managerNodeId;
  if (effectiveManagerNodeId === undefined) {
    if (authoredManagerNodeIds.length === 1) {
      effectiveManagerNodeId = authoredManagerNodeIds[0];
    } else if (
      authoredManagerNodeIds.length === 0 &&
      entryNodeId !== undefined
    ) {
      effectiveManagerNodeId = entryNodeId;
    }
  }
  let effectiveEntryNodeId = entryNodeId;
  if (effectiveEntryNodeId === undefined) {
    effectiveEntryNodeId = effectiveManagerNodeId;
  }

  if (effectiveManagerNodeId === undefined) {
    issues.push(
      makeIssue(
        "error",
        "workflow.managerNodeId",
        "is required unless exactly one manager-role node can be inferred or entryNodeId is provided for a manager-less workflow",
      ),
    );
  }
  if (effectiveEntryNodeId === undefined) {
    issues.push(
      makeIssue(
        "error",
        "workflow.entryNodeId",
        "is required unless it can be derived from managerNodeId",
      ),
    );
  }

  if (
    workflowId === null ||
    description === null ||
    managerNodeId === null ||
    entryNodeId === null ||
    typeof maxLoopIterations !== "number" ||
    typeof nodeTimeoutMs !== "number" ||
    effectiveManagerNodeId === undefined ||
    effectiveEntryNodeId === undefined
  ) {
    return null;
  }

  if (maxLoopIterations <= 0) {
    issues.push(
      makeIssue("error", "workflow.defaults.maxLoopIterations", "must be > 0"),
    );
  }
  if (nodeTimeoutMs <= 0) {
    issues.push(
      makeIssue("error", "workflow.defaults.nodeTimeoutMs", "must be > 0"),
    );
  }

  return {
    workflowId: workflowId!,
    description: description!,
    defaults: { maxLoopIterations, nodeTimeoutMs, containerRuntime },
    ...(prompts === undefined ? {} : { prompts }),
    managerNodeId: effectiveManagerNodeId!,
    hasManagerNode,
    entryNodeId: effectiveEntryNodeId!,
    ...(workflowCalls === undefined ? {} : { workflowCalls }),
    subWorkflows,
    ...(subWorkflowConversations === undefined
      ? {}
      : { subWorkflowConversations }),
    nodes,
    edges,
    ...(loops === undefined ? {} : { loops }),
    branching: { mode: "fan-out" },
  };
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
          "must be codex-agent, claude-code-agent, official/openai-sdk, or official/anthropic-sdk",
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
  let timeoutMs: number | undefined;
  if (timeoutRaw !== undefined) {
    if (typeof timeoutRaw === "number" && timeoutRaw > 0) {
      timeoutMs = timeoutRaw;
    } else {
      issues.push(
        makeIssue("error", `${path}.timeoutMs`, "must be > 0 when provided"),
      );
    }
  }

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
          sourceRaw !== "sub-workflow-output" &&
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
}):
  | { ok: true; managerStepId?: string }
  | { ok: false; message: string } {
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
  | { ok: true; managerStepId?: string }
  | { ok: false; message: string }
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

function parseCalleeWorkflowJsonText(text: string):
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
}):
  | { ok: true; entry: string }
  | { ok: false; message: string } {
  const managerStepId = input.raw["managerStepId"];
  const entryStepId = input.raw["entryStepId"];
  const entryNodeId = input.raw["entryNodeId"];
  let entry: string | undefined;
  if (typeof managerStepId === "string" && managerStepId.length > 0) {
    entry = managerStepId;
  } else if (input.inferredManagerStepId !== undefined) {
    entry = input.inferredManagerStepId;
  } else if (typeof entryStepId === "string" && entryStepId.length > 0) {
    entry = entryStepId;
  } else if (typeof entryNodeId === "string" && entryNodeId.length > 0) {
    entry = entryNodeId;
  }
  if (entry === undefined) {
    return {
      ok: false,
      message:
        "callee workflow must declare managerStepId, entryStepId, or entryNodeId (or exactly one manager-role step)",
    };
  }
  return { ok: true, entry };
}

/**
 * When `workflowRoot` is available, ensures each cross-workflow step transition's
 * `toStepId` matches the step id where the callee run starts: `managerStepId` when
 * present, otherwise `entryStepId` or legacy `entryNodeId`. That matches
 * `runWorkflowInternal`, which seeds the session at `workflow.managerNodeId`
 * (the normalized manager step for managed bundles, or entry for worker-only).
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
    | { status: "ok"; entry: string }
    | { status: "error"; message: string }
  >();

  function resolveCalleeEntry(calleeId: string):
    | { ok: true; entry: string }
    | { ok: false; message: string } {
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
            `must match callee start step '${resolved.entry}' (callee '${calleeId}': managerStepId, else entryStepId / entryNodeId); cross-workflow calls use the same initial step as a normal run`,
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
    | { status: "ok"; entry: string }
    | { status: "error"; message: string }
  >();

  async function resolveCalleeEntry(calleeId: string): Promise<
    | { ok: true; entry: string }
    | { ok: false; message: string }
  > {
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
            `must match callee start step '${resolved.entry}' (callee '${calleeId}': managerStepId, else entryStepId / entryNodeId); cross-workflow calls use the same initial step as a normal run`,
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
  const isStepAddressedWorkflow =
    bundle.workflow.nodeRegistry !== undefined &&
    bundle.workflow.steps !== undefined;
  const authoredSteps = bundle.workflow.steps;
  const stepIdSet =
    authoredSteps === undefined
      ? new Set<string>()
      : new Set(authoredSteps.map((step) => step.id));
  const nodeIdSet = new Set(bundle.workflow.nodes.map((node) => node.id));
  const nodeOrderByNodeId = new Map(
    bundle.workflow.nodes.map((node, order) => [node.id, order]),
  );
  const rootManagerNodeIds = bundle.workflow.nodes
    .filter((node) => node.kind === "root-manager")
    .map((node) => node.id);
  const managerRoleNodeIds = bundle.workflow.nodes
    .filter((node) => node.role === "manager")
    .map((node) => node.id);

  if (
    !isStepAddressedWorkflow &&
    !nodeIdSet.has(bundle.workflow.managerNodeId)
  ) {
    issues.push(
      makeIssue(
        "error",
        "workflow.managerNodeId",
        `must reference an existing node id (${bundle.workflow.managerNodeId})`,
      ),
    );
  }

  if (
    !isStepAddressedWorkflow &&
    bundle.workflow.entryNodeId !== undefined &&
    !nodeIdSet.has(bundle.workflow.entryNodeId)
  ) {
    issues.push(
      makeIssue(
        "error",
        "workflow.entryNodeId",
        `must reference an existing node id (${bundle.workflow.entryNodeId})`,
      ),
    );
  }

  if (!isStepAddressedWorkflow && managerRoleNodeIds.length > 1) {
    managerRoleNodeIds.forEach((nodeId) => {
      issues.push(
        makeIssue(
          "error",
          "workflow.nodes",
          `node '${nodeId}' cannot use role 'manager' because workflows may define at most one manager node`,
        ),
      );
    });
  }

  const managerNode = bundle.workflow.nodes.find(
    (node) => node.id === bundle.workflow.managerNodeId,
  );
  if (
    !isStepAddressedWorkflow &&
    managerRoleNodeIds.length === 1 &&
    managerRoleNodeIds[0] !== bundle.workflow.managerNodeId
  ) {
    issues.push(
      makeIssue(
        "error",
        "workflow.managerNodeId",
        `must reference the manager-role node '${managerRoleNodeIds[0]}'`,
      ),
    );
  }
  if (
    !isStepAddressedWorkflow &&
    bundle.workflow.hasManagerNode !== false &&
    managerNode?.kind !== "root-manager"
  ) {
    issues.push(
      makeIssue(
        "error",
        "workflow.managerNodeId",
        "must reference a node with kind 'root-manager'",
      ),
    );
  }
  if (
    !isStepAddressedWorkflow &&
    bundle.workflow.hasManagerNode === false &&
    bundle.workflow.entryNodeId !== undefined &&
    bundle.workflow.managerNodeId !== bundle.workflow.entryNodeId
  ) {
    issues.push(
      makeIssue(
        "error",
        "workflow.managerNodeId",
        "manager-less workflows must set managerNodeId equal to entryNodeId",
      ),
    );
  }
  if (!isStepAddressedWorkflow) {
    rootManagerNodeIds.forEach((nodeId) => {
      if (nodeId === bundle.workflow.managerNodeId) {
        return;
      }
      issues.push(
        makeIssue(
          "error",
          "workflow.nodes",
          `node '${nodeId}' cannot use kind 'root-manager' unless it is workflow.managerNodeId`,
        ),
      );
    });
  }

  const seenNodeIds = new Set<string>();
  bundle.workflow.nodes.forEach((node, index) => {
    if (seenNodeIds.has(node.id)) {
      if (!isStepAddressedWorkflow) {
        issues.push(
          makeIssue(
            "error",
            `workflow.nodes[${index}].id`,
            `duplicate node id '${node.id}'`,
          ),
        );
      }
      return;
    }
    seenNodeIds.add(node.id);

    const payload = bundle.nodePayloads[node.id];
    if (!payload) {
      if (isStepAddressedWorkflow) {
        return;
      }
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

  if (!isStepAddressedWorkflow) {
    bundle.workflow.edges.forEach((edge, index) => {
      if (!nodeIdSet.has(edge.from)) {
        issues.push(
          makeIssue(
            "error",
            `workflow.edges[${index}].from`,
            "must reference an existing node id",
          ),
        );
      }
      if (!nodeIdSet.has(edge.to)) {
        issues.push(
          makeIssue(
            "error",
            `workflow.edges[${index}].to`,
            "must reference an existing node id",
          ),
        );
      }
    });
  }

  const workflowCallIdSet = new Set<string>();
  bundle.workflow.workflowCalls?.forEach((call, index) => {
    if (workflowCallIdSet.has(call.id)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.workflowCalls[${index}].id`,
          `duplicate workflow call id '${call.id}'`,
        ),
      );
    } else {
      workflowCallIdSet.add(call.id);
    }

    if (!nodeIdSet.has(call.callerNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.workflowCalls[${index}].callerNodeId`,
          "must reference an existing node id",
        ),
      );
    }

    if (call.callerStepId !== undefined) {
      if (!isStepAddressedWorkflow) {
        issues.push(
          makeIssue(
            "error",
            `workflow.workflowCalls[${index}].callerStepId`,
            "is only supported when the workflow defines workflow.steps (step-addressed model)",
          ),
        );
      } else if (!stepIdSet.has(call.callerStepId)) {
        issues.push(
          makeIssue(
            "error",
            `workflow.workflowCalls[${index}].callerStepId`,
            "must reference an existing step id",
          ),
        );
      } else if (call.callerNodeId !== call.callerStepId) {
        issues.push(
          makeIssue(
            "error",
            `workflow.workflowCalls[${index}].callerNodeId`,
            "must equal callerStepId for step-addressed workflows (execution-scoped ids are step ids)",
          ),
        );
      }
    }

    if (call.resultNodeId !== undefined && !nodeIdSet.has(call.resultNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.workflowCalls[${index}].resultNodeId`,
          "must reference an existing node id when provided",
        ),
      );
    }
  });

  bundle.workflow.loops?.forEach((loop, index) => {
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

  const declaredSubWorkflowIds = new Set(
    bundle.workflow.subWorkflows.map((entry) => entry.id),
  );
  const declaredLoopIds = new Set(
    (bundle.workflow.loops ?? []).map((entry) => entry.id),
  );
  const subWorkflowIdSet = new Set<string>();
  const loopBodyOwnerByLoopId = new Map<string, string>();
  const subWorkflowNodeOwnership = new Map<string, string>();
  const subWorkflowBoundaryOwnership = new Map<string, string>();
  bundle.workflow.subWorkflows.forEach((subWorkflow, index) => {
    if (subWorkflowIdSet.has(subWorkflow.id)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].id`,
          `duplicate subWorkflow id '${subWorkflow.id}'`,
        ),
      );
    } else {
      subWorkflowIdSet.add(subWorkflow.id);
    }

    if (subWorkflow.managerNodeId === subWorkflow.inputNodeId) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].managerNodeId`,
          "must not reference the same node as inputNodeId",
        ),
      );
    }
    if (subWorkflow.managerNodeId === subWorkflow.outputNodeId) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].managerNodeId`,
          "must not reference the same node as outputNodeId",
        ),
      );
    }
    if (subWorkflow.inputNodeId === subWorkflow.outputNodeId) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].inputNodeId`,
          "must not reference the same node as outputNodeId",
        ),
      );
    }

    if (!nodeIdSet.has(subWorkflow.managerNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].managerNodeId`,
          "must reference an existing node id",
        ),
      );
    } else {
      const subManagerNode = bundle.workflow.nodes.find(
        (node) => node.id === subWorkflow.managerNodeId,
      );
      if (subManagerNode?.kind !== "subworkflow-manager") {
        issues.push(
          makeIssue(
            "error",
            `workflow.subWorkflows[${index}].managerNodeId`,
            "must reference a node with kind 'subworkflow-manager'",
          ),
        );
      }
    }
    const existingBoundaryOwner = subWorkflowBoundaryOwnership.get(
      subWorkflow.managerNodeId,
    );
    if (
      existingBoundaryOwner !== undefined &&
      existingBoundaryOwner !== subWorkflow.id
    ) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].managerNodeId`,
          `manager node '${subWorkflow.managerNodeId}' is already assigned to subWorkflow '${existingBoundaryOwner}'`,
        ),
      );
    } else {
      subWorkflowBoundaryOwnership.set(
        subWorkflow.managerNodeId,
        subWorkflow.id,
      );
    }

    if (!nodeIdSet.has(subWorkflow.inputNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].inputNodeId`,
          "must reference an existing node id",
        ),
      );
    } else {
      const inputNode = bundle.workflow.nodes.find(
        (node) => node.id === subWorkflow.inputNodeId,
      );
      if (inputNode?.kind !== "input") {
        issues.push(
          makeIssue(
            "error",
            `workflow.subWorkflows[${index}].inputNodeId`,
            "must reference a node with kind 'input'",
          ),
        );
      }
    }
    const existingInputOwner = subWorkflowBoundaryOwnership.get(
      subWorkflow.inputNodeId,
    );
    if (
      existingInputOwner !== undefined &&
      existingInputOwner !== subWorkflow.id
    ) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].inputNodeId`,
          `input node '${subWorkflow.inputNodeId}' is already assigned to subWorkflow '${existingInputOwner}'`,
        ),
      );
    } else {
      subWorkflowBoundaryOwnership.set(subWorkflow.inputNodeId, subWorkflow.id);
    }

    if (!nodeIdSet.has(subWorkflow.outputNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].outputNodeId`,
          "must reference an existing node id",
        ),
      );
    } else {
      const outputNode = bundle.workflow.nodes.find(
        (node) => node.id === subWorkflow.outputNodeId,
      );
      if (outputNode?.kind !== "output") {
        issues.push(
          makeIssue(
            "error",
            `workflow.subWorkflows[${index}].outputNodeId`,
            "must reference a node with kind 'output'",
          ),
        );
      }
    }
    const existingOutputOwner = subWorkflowBoundaryOwnership.get(
      subWorkflow.outputNodeId,
    );
    if (
      existingOutputOwner !== undefined &&
      existingOutputOwner !== subWorkflow.id
    ) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].outputNodeId`,
          `output node '${subWorkflow.outputNodeId}' is already assigned to subWorkflow '${existingOutputOwner}'`,
        ),
      );
    } else {
      subWorkflowBoundaryOwnership.set(
        subWorkflow.outputNodeId,
        subWorkflow.id,
      );
    }

    if (subWorkflow.nodeIds.length === 0) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].nodeIds`,
          "must not be empty",
        ),
      );
    }
    const seenNodeIds = new Set<string>();
    subWorkflow.nodeIds.forEach((nodeId, nodeIndex) => {
      if (seenNodeIds.has(nodeId)) {
        issues.push(
          makeIssue(
            "error",
            `workflow.subWorkflows[${index}].nodeIds[${nodeIndex}]`,
            `duplicate node id '${nodeId}' is not allowed within the same subWorkflow`,
          ),
        );
        return;
      }
      seenNodeIds.add(nodeId);
      if (!nodeIdSet.has(nodeId)) {
        issues.push(
          makeIssue(
            "error",
            `workflow.subWorkflows[${index}].nodeIds[${nodeIndex}]`,
            "must reference an existing node id",
          ),
        );
        return;
      }
      const existingOwner = subWorkflowNodeOwnership.get(nodeId);
      if (existingOwner !== undefined && existingOwner !== subWorkflow.id) {
        issues.push(
          makeIssue(
            "error",
            `workflow.subWorkflows[${index}].nodeIds[${nodeIndex}]`,
            `node id '${nodeId}' is already owned by subWorkflow '${existingOwner}'`,
          ),
        );
        return;
      }
      subWorkflowNodeOwnership.set(nodeId, subWorkflow.id);
    });

    if (!subWorkflow.nodeIds.includes(subWorkflow.managerNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].nodeIds`,
          "must include managerNodeId",
        ),
      );
    }
    if (!subWorkflow.nodeIds.includes(subWorkflow.inputNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].nodeIds`,
          "must include inputNodeId",
        ),
      );
    }
    if (!subWorkflow.nodeIds.includes(subWorkflow.outputNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].nodeIds`,
          "must include outputNodeId",
        ),
      );
    }

    subWorkflow.inputSources.forEach((source, sourceIndex) => {
      const sourcePath = `workflow.subWorkflows[${index}].inputSources[${sourceIndex}]`;
      if (
        source.type === "node-output" &&
        source.nodeId !== undefined &&
        !nodeIdSet.has(source.nodeId)
      ) {
        issues.push(
          makeIssue(
            "error",
            `${sourcePath}.nodeId`,
            "must reference an existing node id",
          ),
        );
      }
      if (
        source.type === "sub-workflow-output" &&
        source.subWorkflowId !== undefined &&
        !declaredSubWorkflowIds.has(source.subWorkflowId)
      ) {
        issues.push(
          makeIssue(
            "error",
            `${sourcePath}.subWorkflowId`,
            "must reference an existing subWorkflow id",
          ),
        );
      }
    });

    const blockPath = `workflow.subWorkflows[${index}].block`;
    if (subWorkflow.block?.type === "branch-block") {
      const incomingBranchEdges = bundle.workflow.edges.filter(
        (edge) =>
          edge.to === subWorkflow.managerNodeId &&
          bundle.workflow.nodes.find((node) => node.id === edge.from)?.kind ===
            "branch-judge",
      );
      if (incomingBranchEdges.length === 0) {
        issues.push(
          makeIssue(
            "error",
            `${blockPath}.type`,
            "branch-block subWorkflow must be entered by at least one edge from a branch-judge to its managerNodeId",
          ),
        );
      }
    }
    if (subWorkflow.block?.type === "loop-body") {
      if (subWorkflow.block.loopId === undefined) {
        issues.push(
          makeIssue(
            "error",
            `${blockPath}.loopId`,
            "is required when block.type is 'loop-body'",
          ),
        );
      } else if (!declaredLoopIds.has(subWorkflow.block.loopId)) {
        issues.push(
          makeIssue(
            "error",
            `${blockPath}.loopId`,
            "must reference an existing workflow loop id",
          ),
        );
      } else {
        const existingOwner = loopBodyOwnerByLoopId.get(
          subWorkflow.block.loopId,
        );
        if (existingOwner !== undefined && existingOwner !== subWorkflow.id) {
          issues.push(
            makeIssue(
              "error",
              `${blockPath}.loopId`,
              `loop '${subWorkflow.block.loopId}' is already assigned to loop-body subWorkflow '${existingOwner}'`,
            ),
          );
        } else {
          loopBodyOwnerByLoopId.set(subWorkflow.block.loopId, subWorkflow.id);
        }

        const loopRule = bundle.workflow.loops?.find(
          (entry) => entry.id === subWorkflow.block?.loopId,
        );
        const continueEdgeToManager =
          loopRule === undefined
            ? undefined
            : bundle.workflow.edges.find(
                (edge) =>
                  edge.from === loopRule.judgeNodeId &&
                  edge.when === loopRule.continueWhen &&
                  edge.to === subWorkflow.managerNodeId,
              );
        if (loopRule !== undefined && continueEdgeToManager === undefined) {
          issues.push(
            makeIssue(
              "error",
              `${blockPath}.loopId`,
              `loop-body subWorkflow must be re-entered by loop '${subWorkflow.block.loopId}' via a continue edge to manager '${subWorkflow.managerNodeId}'`,
            ),
          );
        }
      }
    }
    if (
      subWorkflow.block?.type !== "loop-body" &&
      subWorkflow.block?.loopId !== undefined
    ) {
      issues.push(
        makeIssue(
          "error",
          `${blockPath}.loopId`,
          "is only allowed when block.type is 'loop-body'",
        ),
      );
    }
  });

  bundle.workflow.edges.forEach((edge, index) => {
    const sourceSubWorkflowId = subWorkflowNodeOwnership.get(edge.from);
    const targetSubWorkflowId = subWorkflowNodeOwnership.get(edge.to);

    if (sourceSubWorkflowId === targetSubWorkflowId) {
      return;
    }

    if (
      sourceSubWorkflowId === undefined &&
      targetSubWorkflowId !== undefined
    ) {
      const targetSubWorkflow = bundle.workflow.subWorkflows.find(
        (entry) => entry.id === targetSubWorkflowId,
      );
      if (
        targetSubWorkflow !== undefined &&
        edge.to !== targetSubWorkflow.managerNodeId
      ) {
        issues.push(
          makeIssue(
            "error",
            `workflow.edges[${index}].to`,
            `cross-scope edge from root scope must target recipient sub-workflow manager '${targetSubWorkflow.managerNodeId}', not child node '${edge.to}'`,
          ),
        );
      }
      return;
    }

    if (
      sourceSubWorkflowId !== undefined &&
      targetSubWorkflowId === undefined
    ) {
      if (edge.to !== bundle.workflow.managerNodeId) {
        issues.push(
          makeIssue(
            "error",
            `workflow.edges[${index}].to`,
            `cross-scope edge from sub-workflow '${sourceSubWorkflowId}' to root scope must target workflow manager '${bundle.workflow.managerNodeId}', not root node '${edge.to}'`,
          ),
        );
      }
      return;
    }

    const targetSubWorkflow = bundle.workflow.subWorkflows.find(
      (entry) => entry.id === targetSubWorkflowId,
    );
    if (
      targetSubWorkflow !== undefined &&
      edge.to !== targetSubWorkflow.managerNodeId
    ) {
      issues.push(
        makeIssue(
          "error",
          `workflow.edges[${index}].to`,
          `cross-scope edge from sub-workflow '${sourceSubWorkflowId}' to sub-workflow '${targetSubWorkflowId}' must target recipient manager '${targetSubWorkflow.managerNodeId}', not child node '${edge.to}'`,
        ),
      );
    }
  });

  bundle.workflow.subWorkflowConversations?.forEach((conversation, index) => {
    if (conversation.participants.length < 2) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflowConversations[${index}].participants`,
          "must include at least two participants",
        ),
      );
    }
    if (new Set(conversation.participants).size < 2) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflowConversations[${index}].participants`,
          "must include at least two distinct participants",
        ),
      );
    }
    conversation.participants.forEach((participant, participantIndex) => {
      if (!declaredSubWorkflowIds.has(participant)) {
        issues.push(
          makeIssue(
            "error",
            `workflow.subWorkflowConversations[${index}].participants[${participantIndex}]`,
            "must reference an existing subWorkflow id",
          ),
        );
      }
    });
  });

  const subWorkflowIntervals: Array<{
    readonly id: string;
    readonly inputOrder: number;
    readonly outputOrder: number;
  }> = [];
  for (const subWorkflow of bundle.workflow.subWorkflows) {
    const inputOrder = nodeOrderByNodeId.get(subWorkflow.inputNodeId);
    const outputOrder = nodeOrderByNodeId.get(subWorkflow.outputNodeId);
    if (inputOrder === undefined || outputOrder === undefined) {
      continue;
    }
    if (inputOrder > outputOrder) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows.${subWorkflow.id}`,
          "must place inputNodeId before outputNodeId in vertical order",
        ),
      );
      continue;
    }
    subWorkflowIntervals.push({
      id: subWorkflow.id,
      inputOrder,
      outputOrder,
    });
  }

  for (let index = 0; index < subWorkflowIntervals.length; index += 1) {
    const current = subWorkflowIntervals[index];
    if (current === undefined) {
      continue;
    }
    for (
      let compareIndex = index + 1;
      compareIndex < subWorkflowIntervals.length;
      compareIndex += 1
    ) {
      const other = subWorkflowIntervals[compareIndex];
      if (other === undefined) {
        continue;
      }
      if (
        intervalsPartiallyOverlap(
          { startOrder: current.inputOrder, endOrder: current.outputOrder },
          { startOrder: other.inputOrder, endOrder: other.outputOrder },
        )
      ) {
        pushCrossingIntervalIssue(issues, bundle, {
          path: "workflow.subWorkflows",
          leftId: current.id,
          leftStartOrder: current.inputOrder,
          rightId: other.id,
          rightStartOrder: other.inputOrder,
          messagePrefix: "vertical subWorkflow groups",
        });
      }
    }
  }

  const loopIntervals: Array<{
    readonly id: string;
    readonly startOrder: number;
    readonly endOrder: number;
  }> = [];
  const loopIdsRepresentedBySubWorkflow = new Set<string>();
  bundle.workflow.subWorkflows.forEach((subWorkflow, index) => {
    if (
      subWorkflow.block?.type !== "loop-body" ||
      subWorkflow.block.loopId === undefined
    ) {
      return;
    }
    const inputOrder = nodeOrderByNodeId.get(subWorkflow.inputNodeId);
    const outputOrder = nodeOrderByNodeId.get(subWorkflow.outputNodeId);
    if (inputOrder === undefined || outputOrder === undefined) {
      return;
    }
    if (inputOrder > outputOrder) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].block.loopId`,
          "loop-body subWorkflow must place inputNodeId before outputNodeId in vertical order",
        ),
      );
      return;
    }
    loopIntervals.push({
      id: subWorkflow.block.loopId,
      startOrder: inputOrder,
      endOrder: outputOrder,
    });
    loopIdsRepresentedBySubWorkflow.add(subWorkflow.block.loopId);
  });
  bundle.workflow.loops?.forEach((loop, index) => {
    if (loopIdsRepresentedBySubWorkflow.has(loop.id)) {
      return;
    }
    const judgeOrder = nodeOrderByNodeId.get(loop.judgeNodeId);
    if (judgeOrder === undefined) {
      return;
    }

    const continueTargets = bundle.workflow.edges.filter(
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

    bundle.workflow.edges
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

  for (const groupInterval of subWorkflowIntervals) {
    for (const loopInterval of loopIntervals) {
      if (
        intervalsPartiallyOverlap(
          {
            startOrder: groupInterval.inputOrder,
            endOrder: groupInterval.outputOrder,
          },
          loopInterval,
        )
      ) {
        pushCrossingIntervalIssue(issues, bundle, {
          path: "workflow",
          leftId: groupInterval.id,
          leftStartOrder: groupInterval.inputOrder,
          rightId: loopInterval.id,
          rightStartOrder: loopInterval.startOrder,
          messagePrefix: "vertical group and loop scopes",
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
