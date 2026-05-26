import {
  INLINE_NODE_FIELD,
  normalizeWorkflowRelativeJsonPath,
  remapAuthoredNodePayloadsByNodeFile,
  resolveAuthoredNodeFileReference,
  synthesizeInlineNodeFile,
} from "./authored-node";
import { collectStepAddressedAuthoredWorkflowFieldIssues } from "./authored-workflow";
import { isSafeWorkflowId } from "./paths";
import { err, ok, type Result } from "./result";
import type {
  ArgumentBinding,
  CommandExecution,
  ContainerExecution,
  ContainerRuntimeDefaults,
  JsonObject,
  NodeDurability,
  NodeInputContract,
  NodeKind,
  NodeOutputContract,
  NodePayload,
  NodePromptVariant,
  NodeSessionPolicy,
  SleepNodeConfig,
  UserActionNodeConfig,
  ValidationIssue,
  WorkflowDefaults,
  WorkflowJson,
  WorkflowNodeAddonEnvBinding,
  WorkflowNodeAddonRef,
  WorkflowNodeRef,
  WorkflowNodeRegistryRef,
  WorkflowNodeRepeatPolicy,
  WorkflowStepFanout,
  WorkflowStepRef,
  WorkflowStepSessionPolicy,
  WorkflowStepTransition,
  WorkflowSelfImproveMode,
  WorkflowSupervisionDefaults,
  WorkflowTimeoutPolicy,
} from "./workflow-model";
import {
  DEFAULT_CONTAINER_RUNNER_KIND,
  DEFAULT_MAX_LOOP_ITERATIONS,
  DEFAULT_NODE_TIMEOUT_MS,
  NODE_ID_PATTERN,
  NODE_EXECUTION_BACKEND_LIST_TEXT,
  normalizeNodeExecutionBackend,
} from "./workflow-model";

export interface RawWorkflowBundle {
  readonly workflow: unknown;
  readonly nodePayloads: Readonly<Record<string, unknown>>;
}

export interface PureWorkflowValidationOptions {
  readonly allowResolvedStepFileFields?: boolean;
}

export interface PureWorkflowValidationSuccess {
  readonly workflow: WorkflowJson;
  readonly nodePayloads: Readonly<Record<string, NodePayload>>;
  readonly issues: readonly ValidationIssue[];
}

export type PureWorkflowValidationResult = Result<
  {
    readonly workflow: WorkflowJson;
    readonly nodePayloads: Readonly<Record<string, NodePayload>>;
  },
  readonly ValidationIssue[]
>;

export type UnknownRecord = Record<string, unknown>;
const DEFAULT_MONITOR_INTERVAL_MS = 5_000;
const DEFAULT_STALL_TIMEOUT_MS = 60 * 60 * 1000;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function makeIssue(
  severity: "error" | "warning",
  path: string,
  message: string,
): ValidationIssue {
  return { severity, path, message };
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
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    issues.push(
      makeIssue("error", `${path}.${key}`, "must be a positive integer"),
    );
    return null;
  }
  return value;
}

export function normalizePositiveNumber(
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

export function normalizePositiveInteger(
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

export function normalizeStringArray(
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

export function normalizeStringMap(
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

export function normalizeObjectField(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): UnknownRecord | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  return value;
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

  const superviserWorkflowId =
    typeof value["superviserWorkflowId"] === "string" &&
    value["superviserWorkflowId"].length > 0
      ? value["superviserWorkflowId"]
      : undefined;
  const monitorIntervalMs = normalizePositiveInteger(
    value["monitorIntervalMs"],
    `${path}.monitorIntervalMs`,
    issues,
  );
  const stallTimeoutMs = normalizePositiveInteger(
    value["stallTimeoutMs"],
    `${path}.stallTimeoutMs`,
    issues,
  );
  const maxSupervisedAttempts = normalizePositiveInteger(
    value["maxSupervisedAttempts"],
    `${path}.maxSupervisedAttempts`,
    issues,
  );
  const maxWorkflowPatches =
    value["maxWorkflowPatches"] === undefined
      ? undefined
      : typeof value["maxWorkflowPatches"] === "number" &&
          Number.isSafeInteger(value["maxWorkflowPatches"]) &&
          value["maxWorkflowPatches"] >= 0
        ? value["maxWorkflowPatches"]
        : undefined;
  if (
    value["maxWorkflowPatches"] !== undefined &&
    maxWorkflowPatches === undefined
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.maxWorkflowPatches`,
        "must be a non-negative integer",
      ),
    );
  }
  const workflowMutationModeRaw = value["workflowMutationMode"];
  const workflowMutationMode =
    workflowMutationModeRaw === "execution-copy" ||
    workflowMutationModeRaw === "in-place"
      ? workflowMutationModeRaw
      : undefined;
  if (
    workflowMutationModeRaw !== undefined &&
    workflowMutationMode === undefined
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.workflowMutationMode`,
        "must be 'execution-copy' or 'in-place'",
      ),
    );
  }
  const allowTargetedRerun =
    typeof value["allowTargetedRerun"] === "boolean"
      ? value["allowTargetedRerun"]
      : undefined;
  if (
    value["allowTargetedRerun"] !== undefined &&
    allowTargetedRerun === undefined
  ) {
    issues.push(
      makeIssue("error", `${path}.allowTargetedRerun`, "must be a boolean"),
    );
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

function normalizeContainerRuntimeDefaults(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): ContainerRuntimeDefaults | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const runnerKindRaw = value["runnerKind"];
  const runnerKind =
    runnerKindRaw === "podman" ||
    runnerKindRaw === "docker" ||
    runnerKindRaw === "nerdctl" ||
    runnerKindRaw === "apple-container"
      ? runnerKindRaw
      : undefined;
  if (runnerKindRaw !== undefined && runnerKind === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.runnerKind`,
        "must be podman, docker, nerdctl, or apple-container",
      ),
    );
  }
  const runnerPath =
    typeof value["runnerPath"] === "string" && value["runnerPath"].length > 0
      ? value["runnerPath"]
      : undefined;
  if (value["runnerPath"] !== undefined && runnerPath === undefined) {
    issues.push(
      makeIssue("error", `${path}.runnerPath`, "must be a non-empty string"),
    );
  }
  return {
    runnerKind: runnerKind ?? DEFAULT_CONTAINER_RUNNER_KIND,
    ...(runnerPath === undefined ? {} : { runnerPath }),
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
  const maxRetries =
    value["maxRetries"] === undefined
      ? undefined
      : typeof value["maxRetries"] === "number" &&
          Number.isInteger(value["maxRetries"]) &&
          value["maxRetries"] >= 0
        ? value["maxRetries"]
        : undefined;
  if (value["maxRetries"] !== undefined && maxRetries === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.maxRetries`,
        "must be an integer >= 0 when provided",
      ),
    );
  }
  const retryTimeoutIncrementMs =
    value["retryTimeoutIncrementMs"] === undefined
      ? undefined
      : typeof value["retryTimeoutIncrementMs"] === "number" &&
          Number.isFinite(value["retryTimeoutIncrementMs"]) &&
          value["retryTimeoutIncrementMs"] >= 0
        ? value["retryTimeoutIncrementMs"]
        : undefined;
  if (
    value["retryTimeoutIncrementMs"] !== undefined &&
    retryTimeoutIncrementMs === undefined
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.retryTimeoutIncrementMs`,
        "must be >= 0 when provided",
      ),
    );
  }
  const jumpStepId =
    typeof value["jumpStepId"] === "string" && value["jumpStepId"].length > 0
      ? value["jumpStepId"]
      : undefined;
  if (onTimeout === "jump-to-step" && jumpStepId === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.jumpStepId`,
        "is required when onTimeout is 'jump-to-step'",
      ),
    );
  }
  const reuseBackendSession =
    typeof value["reuseBackendSession"] === "boolean"
      ? value["reuseBackendSession"]
      : undefined;
  if (
    value["reuseBackendSession"] !== undefined &&
    reuseBackendSession === undefined
  ) {
    issues.push(
      makeIssue("error", `${path}.reuseBackendSession`, "must be a boolean"),
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

function normalizeDefaults(
  raw: unknown,
  issues: ValidationIssue[],
): WorkflowDefaults {
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", "workflow.defaults", "must be an object"));
    return {
      nodeTimeoutMs: DEFAULT_NODE_TIMEOUT_MS,
      maxLoopIterations: DEFAULT_MAX_LOOP_ITERATIONS,
    };
  }

  return {
    nodeTimeoutMs:
      raw["nodeTimeoutMs"] === undefined
        ? DEFAULT_NODE_TIMEOUT_MS
        : (readNumberField(raw, "nodeTimeoutMs", "workflow.defaults", issues) ??
          DEFAULT_NODE_TIMEOUT_MS),
    maxLoopIterations:
      raw["maxLoopIterations"] === undefined
        ? DEFAULT_MAX_LOOP_ITERATIONS
        : (readNumberField(
            raw,
            "maxLoopIterations",
            "workflow.defaults",
            issues,
          ) ?? DEFAULT_MAX_LOOP_ITERATIONS),
    ...(typeof raw["fanoutConcurrency"] === "number" &&
    Number.isSafeInteger(raw["fanoutConcurrency"]) &&
    raw["fanoutConcurrency"] > 0
      ? { fanoutConcurrency: raw["fanoutConcurrency"] }
      : {}),
    ...(() => {
      const supervision = normalizeWorkflowSupervisionDefaults(
        raw["supervision"],
        "workflow.defaults.supervision",
        issues,
      );
      return supervision === undefined ? {} : { supervision };
    })(),
    ...(() => {
      const timeoutPolicy = normalizeWorkflowTimeoutPolicy(
        raw["timeoutPolicy"],
        "workflow.defaults.timeoutPolicy",
        issues,
      );
      return timeoutPolicy === undefined ? {} : { timeoutPolicy };
    })(),
    ...(() => {
      const containerRuntime = normalizeContainerRuntimeDefaults(
        raw["containerRuntime"],
        "workflow.defaults.containerRuntime",
        issues,
      );
      return containerRuntime === undefined ? {} : { containerRuntime };
    })(),
    ...(() => {
      const selfImprove = normalizeWorkflowSelfImproveDefaults(
        raw["selfImprove"],
        "workflow.defaults.selfImprove",
        issues,
      );
      return selfImprove === undefined ? {} : { selfImprove };
    })(),
  };
}

function normalizeWorkflowSelfImproveDefaults(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowDefaults["selfImprove"] {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const allowedKeys = new Set(["enabled", "mode", "defaultLogLimit"]);
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported self-improve defaults field",
        ),
      );
    }
  }

  const enabledRaw = raw["enabled"];
  let enabled: boolean | undefined;
  if (enabledRaw !== undefined) {
    if (typeof enabledRaw === "boolean") {
      enabled = enabledRaw;
    } else {
      issues.push(makeIssue("error", `${path}.enabled`, "must be a boolean"));
    }
  }

  const modeRaw = raw["mode"];
  let mode: WorkflowSelfImproveMode | undefined;
  if (modeRaw !== undefined) {
    if (modeRaw === "report-only" || modeRaw === "report-and-auto-improve") {
      mode = modeRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.mode`,
          "must be report-only or report-and-auto-improve",
        ),
      );
    }
  }

  const defaultLogLimit =
    raw["defaultLogLimit"] === undefined
      ? undefined
      : readPositiveIntegerField(raw, "defaultLogLimit", path, issues);
  return {
    ...(enabled === undefined ? {} : { enabled }),
    ...(mode === undefined ? {} : { mode }),
    ...(defaultLogLimit === undefined || defaultLogLimit === null
      ? {}
      : { defaultLogLimit }),
  };
}

function normalizeAddonEnvBinding(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowNodeAddonEnvBinding | undefined {
  if (typeof raw === "string") {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(raw)) {
      return { fromEnv: raw };
    }
    issues.push(
      makeIssue("error", path, "must be a valid environment variable name"),
    );
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be a string or object"));
    return undefined;
  }
  const fromEnv = raw["fromEnv"];
  if (
    typeof fromEnv !== "string" ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(fromEnv)
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.fromEnv`,
        "must be a valid environment variable name",
      ),
    );
    return undefined;
  }
  const required = raw["required"];
  if (required !== undefined && typeof required !== "boolean") {
    issues.push(makeIssue("error", `${path}.required`, "must be a boolean"));
  }
  return {
    fromEnv,
    ...(typeof required === "boolean" ? { required } : {}),
  };
}

function normalizeAddonEnv(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): Readonly<Record<string, WorkflowNodeAddonEnvBinding>> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const env: Record<string, WorkflowNodeAddonEnvBinding> = {};
  for (const [targetEnv, bindingRaw] of Object.entries(raw)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(targetEnv)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${targetEnv}`,
          "target must be a valid environment variable name",
        ),
      );
      continue;
    }
    const binding = normalizeAddonEnvBinding(
      bindingRaw,
      `${path}.${targetEnv}`,
      issues,
    );
    if (binding !== undefined) {
      env[targetEnv] = binding;
    }
  }
  return env;
}

function normalizeAddonRef(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowNodeAddonRef | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw === "string") {
    if (raw.length === 0) {
      issues.push(makeIssue("error", path, "must be a non-empty string"));
      return undefined;
    }
    return { name: raw };
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be a string or object"));
    return undefined;
  }
  const name = readStringField(raw, "name", path, issues);
  if (name === null) {
    return undefined;
  }
  const env = normalizeAddonEnv(raw["env"], `${path}.env`, issues);

  return {
    name,
    ...(typeof raw["version"] === "string" && raw["version"].length > 0
      ? { version: raw["version"] }
      : {}),
    ...(isRecord(raw["config"]) ? { config: raw["config"] } : {}),
    ...(env === undefined ? {} : { env }),
    ...(isRecord(raw["inputs"]) ? { inputs: raw["inputs"] } : {}),
  };
}

function normalizeNodeKind(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): NodeKind | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (
    raw === "task" ||
    raw === "branch-judge" ||
    raw === "loop-judge" ||
    raw === "input" ||
    raw === "output"
  ) {
    return raw;
  }
  issues.push(
    makeIssue(
      "error",
      path,
      "must be 'task', 'branch-judge', 'loop-judge', 'input', or 'output'",
    ),
  );
  return undefined;
}

function normalizeNodeExecutionPolicy(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowNodeRegistryRef["execution"] {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return undefined;
  }
  const mode = raw["mode"];
  const decisionBy = raw["decisionBy"];
  if (mode !== undefined && mode !== "required" && mode !== "optional") {
    issues.push(
      makeIssue("error", `${path}.mode`, "must be 'required' or 'optional'"),
    );
  }
  if (decisionBy !== undefined && decisionBy !== "owning-manager") {
    issues.push(
      makeIssue(
        "error",
        `${path}.decisionBy`,
        "must be 'owning-manager' when provided",
      ),
    );
  }
  return {
    ...(mode === "required" || mode === "optional" ? { mode } : {}),
    ...(decisionBy === "owning-manager" ? { decisionBy } : {}),
  };
}

function normalizeNodeRepeatPolicy(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowNodeRepeatPolicy | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return undefined;
  }
  const whileExpression = readStringField(raw, "while", path, issues);
  if (whileExpression === null) {
    return undefined;
  }
  const restartAt =
    typeof raw["restartAt"] === "string" && raw["restartAt"].length > 0
      ? raw["restartAt"]
      : undefined;
  if (raw["restartAt"] !== undefined && restartAt === undefined) {
    issues.push(
      makeIssue("error", `${path}.restartAt`, "must be a non-empty string"),
    );
  }
  const maxIterations =
    raw["maxIterations"] === undefined
      ? undefined
      : readPositiveIntegerField(raw, "maxIterations", path, issues);
  return {
    while: whileExpression,
    ...(restartAt === undefined ? {} : { restartAt }),
    ...(maxIterations === null || maxIterations === undefined
      ? {}
      : { maxIterations }),
  };
}

function normalizeNodeRegistryRef(
  raw: unknown,
  index: number,
  issues: ValidationIssue[],
): WorkflowNodeRegistryRef | null {
  const path = `workflow.nodes[${index}]`;
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }
  const allowedKeys = new Set([
    "id",
    "nodeFile",
    INLINE_NODE_FIELD,
    "addon",
    "execution",
    "kind",
    "repeat",
  ]);
  for (const key of Object.keys(raw)) {
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

  const id = readStringField(raw, "id", path, issues);
  if (id !== null && !NODE_ID_PATTERN.test(id)) {
    issues.push(
      makeIssue("error", `${path}.id`, "must match ^[a-z0-9][a-z0-9-]{1,63}$"),
    );
  }
  if (id === null) {
    return null;
  }

  const nodeFile =
    typeof raw["nodeFile"] === "string" && raw["nodeFile"].length > 0
      ? raw["nodeFile"]
      : resolveAuthoredNodeFileReference(raw);
  const addon = normalizeAddonRef(raw["addon"], `${path}.addon`, issues);
  const execution = normalizeNodeExecutionPolicy(
    raw["execution"],
    `${path}.execution`,
    issues,
  );
  const kind = normalizeNodeKind(raw["kind"], `${path}.kind`, issues);
  const repeat = normalizeNodeRepeatPolicy(
    raw["repeat"],
    `${path}.repeat`,
    issues,
  );
  if (nodeFile === undefined && addon === undefined) {
    issues.push(
      makeIssue("error", path, "must define nodeFile, inline node, or addon"),
    );
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

function normalizeFanoutWriteOwnership(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowStepFanout["writeOwnership"] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const modeRaw = raw["mode"];
  const mode =
    modeRaw === "read-only" ||
    modeRaw === "disjoint-paths" ||
    modeRaw === "isolated-workspace"
      ? modeRaw
      : undefined;
  if (mode === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.mode`,
        "must be 'read-only', 'disjoint-paths', or 'isolated-workspace'",
      ),
    );
    return undefined;
  }
  const paths = normalizeStringArray(raw["paths"], `${path}.paths`, issues);
  const directories = normalizeStringArray(
    raw["directories"],
    `${path}.directories`,
    issues,
  );
  return {
    mode,
    ...(paths === undefined ? {} : { paths }),
    ...(directories === undefined ? {} : { directories }),
  };
}

function normalizeStepFanout(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowStepFanout | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const groupId = readStringField(raw, "groupId", path, issues);
  const itemsFrom = readStringField(raw, "itemsFrom", path, issues);
  const joinStepId = readStringField(raw, "joinStepId", path, issues);
  const itemVariable =
    typeof raw["itemVariable"] === "string" && raw["itemVariable"].length > 0
      ? raw["itemVariable"]
      : undefined;
  if (
    raw["itemVariable"] !== undefined &&
    (itemVariable === undefined ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(itemVariable))
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.itemVariable`,
        "must be an identifier-like non-empty string when provided",
      ),
    );
  }
  if (
    typeof itemsFrom === "string" &&
    !(itemsFrom === "" || itemsFrom.startsWith("/"))
  ) {
    issues.push(
      makeIssue("error", `${path}.itemsFrom`, "must be a JSON Pointer"),
    );
  }
  const concurrency =
    raw["concurrency"] === undefined
      ? undefined
      : readPositiveIntegerField(raw, "concurrency", path, issues);
  const failurePolicyRaw = raw["failurePolicy"];
  const failurePolicy =
    failurePolicyRaw === "fail-fast" || failurePolicyRaw === "collect-all"
      ? failurePolicyRaw
      : undefined;
  if (failurePolicyRaw !== undefined && failurePolicy === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.failurePolicy`,
        "must be 'fail-fast' or 'collect-all' when provided",
      ),
    );
  }
  const resultOrder = raw["resultOrder"] === "input" ? "input" : undefined;
  if (raw["resultOrder"] !== undefined && resultOrder === undefined) {
    issues.push(makeIssue("error", `${path}.resultOrder`, "must be 'input'"));
  }
  const writeOwnership = normalizeFanoutWriteOwnership(
    raw["writeOwnership"],
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

function normalizeStepTransition(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowStepTransition | null {
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }
  const toStepId = readStringField(raw, "toStepId", path, issues);
  const toWorkflowId =
    typeof raw["toWorkflowId"] === "string" && raw["toWorkflowId"].length > 0
      ? raw["toWorkflowId"]
      : undefined;
  if (raw["toWorkflowId"] !== undefined && toWorkflowId === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.toWorkflowId`,
        "must be a non-empty string when provided",
      ),
    );
  }
  const resumeStepId =
    typeof raw["resumeStepId"] === "string" && raw["resumeStepId"].length > 0
      ? raw["resumeStepId"]
      : undefined;
  if (raw["resumeStepId"] !== undefined && resumeStepId === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.resumeStepId`,
        "must be a non-empty string when provided",
      ),
    );
  }
  const label =
    typeof raw["label"] === "string" && raw["label"].length > 0
      ? raw["label"]
      : undefined;
  if (raw["label"] !== undefined && label === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.label`,
        "must be a non-empty string when provided",
      ),
    );
  }
  const fanout = normalizeStepFanout(raw["fanout"], `${path}.fanout`, issues);
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

function normalizeStepSessionPolicy(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowStepSessionPolicy | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const modeRaw = raw["mode"];
  const mode = modeRaw === "new" || modeRaw === "reuse" ? modeRaw : undefined;
  if (modeRaw !== undefined && mode === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.mode`,
        "must be 'new' or 'reuse' when provided",
      ),
    );
  }
  const inheritFromStepId =
    typeof raw["inheritFromStepId"] === "string" &&
    raw["inheritFromStepId"].length > 0
      ? raw["inheritFromStepId"]
      : undefined;
  if (
    raw["inheritFromStepId"] !== undefined &&
    inheritFromStepId === undefined
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.inheritFromStepId`,
        "must be a non-empty string when provided",
      ),
    );
  }
  return {
    ...(mode === undefined ? {} : { mode }),
    ...(inheritFromStepId === undefined ? {} : { inheritFromStepId }),
  };
}

function normalizeNodeTemplateFields(input: {
  readonly raw: UnknownRecord;
  readonly path: string;
  readonly templateField: keyof NodePromptVariant;
  readonly templateFileField: keyof NodePromptVariant;
  readonly issues: ValidationIssue[];
}): {
  readonly template?: string;
  readonly templateFile?: string;
} {
  const templateRaw = input.raw[input.templateField];
  const templateFileRaw = input.raw[input.templateFileField];
  const template =
    typeof templateRaw === "string" && templateRaw.length > 0
      ? templateRaw
      : undefined;
  if (templateRaw !== undefined && template === undefined) {
    input.issues.push(
      makeIssue(
        "error",
        `${input.path}.${input.templateField}`,
        "must be a non-empty string when provided",
      ),
    );
  }
  const templateFile =
    typeof templateFileRaw === "string" && templateFileRaw.length > 0
      ? templateFileRaw
      : undefined;
  if (templateFileRaw !== undefined && templateFile === undefined) {
    input.issues.push(
      makeIssue(
        "error",
        `${input.path}.${input.templateFileField}`,
        "must be a non-empty string when provided",
      ),
    );
  }
  return {
    ...(template === undefined ? {} : { template }),
    ...(templateFile === undefined ? {} : { templateFile }),
  };
}

function normalizePromptVariants(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): Readonly<Record<string, NodePromptVariant>> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const variants: Record<string, NodePromptVariant> = {};
  for (const [name, variantRaw] of Object.entries(raw)) {
    if (!isRecord(variantRaw)) {
      issues.push(makeIssue("error", `${path}.${name}`, "must be an object"));
      continue;
    }
    const systemPrompt = normalizeNodeTemplateFields({
      raw: variantRaw,
      path: `${path}.${name}`,
      templateField: "systemPromptTemplate",
      templateFileField: "systemPromptTemplateFile",
      issues,
    });
    const prompt = normalizeNodeTemplateFields({
      raw: variantRaw,
      path: `${path}.${name}`,
      templateField: "promptTemplate",
      templateFileField: "promptTemplateFile",
      issues,
    });
    const sessionStart = normalizeNodeTemplateFields({
      raw: variantRaw,
      path: `${path}.${name}`,
      templateField: "sessionStartPromptTemplate",
      templateFileField: "sessionStartPromptTemplateFile",
      issues,
    });
    variants[name] = {
      ...(systemPrompt.template === undefined
        ? {}
        : { systemPromptTemplate: systemPrompt.template }),
      ...(systemPrompt.templateFile === undefined
        ? {}
        : { systemPromptTemplateFile: systemPrompt.templateFile }),
      ...(prompt.template === undefined
        ? {}
        : { promptTemplate: prompt.template }),
      ...(prompt.templateFile === undefined
        ? {}
        : { promptTemplateFile: prompt.templateFile }),
      ...(sessionStart.template === undefined
        ? {}
        : { sessionStartPromptTemplate: sessionStart.template }),
      ...(sessionStart.templateFile === undefined
        ? {}
        : { sessionStartPromptTemplateFile: sessionStart.templateFile }),
    };
  }
  return variants;
}

function normalizeCommandExecution(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): CommandExecution | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const scriptPath = readStringField(raw, "scriptPath", path, issues);
  if (scriptPath === null) {
    return undefined;
  }
  const argvTemplate = normalizeStringArray(
    raw["argvTemplate"],
    `${path}.argvTemplate`,
    issues,
  );
  const envTemplate = normalizeStringMap(
    raw["envTemplate"],
    `${path}.envTemplate`,
    issues,
  );
  const workingDirectory =
    typeof raw["workingDirectory"] === "string" &&
    raw["workingDirectory"].length > 0
      ? raw["workingDirectory"]
      : undefined;
  if (raw["workingDirectory"] !== undefined && workingDirectory === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.workingDirectory`,
        "must be a non-empty string when provided",
      ),
    );
  }
  return {
    scriptPath,
    ...(argvTemplate === undefined ? {} : { argvTemplate }),
    ...(envTemplate === undefined ? {} : { envTemplate }),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
  };
}

function normalizeContainerExecution(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): ContainerExecution | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const runnerKind =
    raw["runnerKind"] === "podman" ||
    raw["runnerKind"] === "docker" ||
    raw["runnerKind"] === "nerdctl" ||
    raw["runnerKind"] === "apple-container"
      ? raw["runnerKind"]
      : undefined;
  const runnerPath =
    typeof raw["runnerPath"] === "string" && raw["runnerPath"].length > 0
      ? raw["runnerPath"]
      : undefined;
  const image =
    typeof raw["image"] === "string" && raw["image"].length > 0
      ? raw["image"]
      : undefined;
  const build = normalizeContainerBuild(raw["build"], `${path}.build`, issues);
  const entrypoint = normalizeStringArray(
    raw["entrypoint"],
    `${path}.entrypoint`,
    issues,
  );
  const argsTemplate = normalizeStringArray(
    raw["argsTemplate"],
    `${path}.argsTemplate`,
    issues,
  );
  const envTemplate = normalizeStringMap(
    raw["envTemplate"],
    `${path}.envTemplate`,
    issues,
  );
  const workingDirectory =
    typeof raw["workingDirectory"] === "string" &&
    raw["workingDirectory"].length > 0
      ? raw["workingDirectory"]
      : undefined;
  const workspace = normalizeObjectField(
    raw["workspace"],
    `${path}.workspace`,
    issues,
  ) as ContainerExecution["workspace"] | undefined;
  const resources = normalizeObjectField(
    raw["resources"],
    `${path}.resources`,
    issues,
  ) as ContainerExecution["resources"] | undefined;
  const networkPolicy =
    raw["networkPolicy"] === "disabled" ||
    raw["networkPolicy"] === "egress-allowed"
      ? raw["networkPolicy"]
      : undefined;
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

function normalizeContainerBuild(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): ContainerExecution["build"] {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const contextPath = readStringField(raw, "contextPath", path, issues);
  if (contextPath === null) {
    return undefined;
  }
  const containerfilePath =
    typeof raw["containerfilePath"] === "string" &&
    raw["containerfilePath"].length > 0
      ? raw["containerfilePath"]
      : undefined;
  const target =
    typeof raw["target"] === "string" && raw["target"].length > 0
      ? raw["target"]
      : undefined;
  return {
    contextPath,
    ...(containerfilePath === undefined ? {} : { containerfilePath }),
    ...(target === undefined ? {} : { target }),
  };
}

function normalizeDurability(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): NodeDurability | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const mode = raw["mode"];
  if (mode !== "disabled" && mode !== "node-persistent") {
    issues.push(
      makeIssue(
        "error",
        `${path}.mode`,
        "must be 'disabled' or 'node-persistent'",
      ),
    );
    return undefined;
  }
  const mountPath =
    typeof raw["mountPath"] === "string" && raw["mountPath"].length > 0
      ? raw["mountPath"]
      : undefined;
  return {
    mode,
    ...(mountPath === undefined ? {} : { mountPath }),
  };
}

function normalizeSleepConfig(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): SleepNodeConfig | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const durationMs = normalizePositiveInteger(
    raw["durationMs"],
    `${path}.durationMs`,
    issues,
  );
  const until =
    typeof raw["until"] === "string" && raw["until"].length > 0
      ? raw["until"]
      : undefined;
  return {
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(until === undefined ? {} : { until }),
  };
}

function normalizeUserAction(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): UserActionNodeConfig | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const messageToolIds = normalizeStringArray(
    raw["messageToolIds"],
    `${path}.messageToolIds`,
    issues,
  );
  if (messageToolIds === undefined) {
    return undefined;
  }
  const notificationToolIds = normalizeStringArray(
    raw["notificationToolIds"],
    `${path}.notificationToolIds`,
    issues,
  );
  const replyPolicy =
    raw["replyPolicy"] === "first-valid-reply-wins"
      ? raw["replyPolicy"]
      : undefined;
  const allowStructuredReply =
    typeof raw["allowStructuredReply"] === "boolean"
      ? raw["allowStructuredReply"]
      : undefined;
  const allowFreeTextReply =
    typeof raw["allowFreeTextReply"] === "boolean"
      ? raw["allowFreeTextReply"]
      : undefined;
  return {
    messageToolIds,
    ...(notificationToolIds === undefined ? {} : { notificationToolIds }),
    ...(replyPolicy === undefined ? {} : { replyPolicy }),
    ...(allowStructuredReply === undefined ? {} : { allowStructuredReply }),
    ...(allowFreeTextReply === undefined ? {} : { allowFreeTextReply }),
  };
}

function normalizeArgumentBindings(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): readonly ArgumentBinding[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    issues.push(makeIssue("error", path, "must be an array when provided"));
    return undefined;
  }
  return raw.flatMap((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      issues.push(makeIssue("error", entryPath, "must be an object"));
      return [];
    }
    const targetPath = readStringField(entry, "targetPath", entryPath, issues);
    const source = entry["source"];
    if (
      source !== "variables" &&
      source !== "node-output" &&
      source !== "workflow-output" &&
      source !== "human-input" &&
      source !== "conversation-transcript"
    ) {
      issues.push(
        makeIssue(
          "error",
          `${entryPath}.source`,
          "must be a valid binding source",
        ),
      );
      return [];
    }
    if (targetPath === null) {
      return [];
    }
    return [
      {
        targetPath,
        source,
        ...(typeof entry["sourceRef"] === "string" ||
        isRecord(entry["sourceRef"])
          ? { sourceRef: entry["sourceRef"] }
          : {}),
        ...(typeof entry["sourcePath"] === "string"
          ? { sourcePath: entry["sourcePath"] }
          : {}),
        ...(typeof entry["required"] === "boolean"
          ? { required: entry["required"] }
          : {}),
      },
    ];
  });
}

function normalizeJsonObject(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): JsonObject | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  return raw as JsonObject;
}

function normalizeNodeInputContract(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): NodeInputContract | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const description =
    typeof raw["description"] === "string" && raw["description"].length > 0
      ? raw["description"]
      : undefined;
  const jsonSchema = normalizeJsonObject(
    raw["jsonSchema"],
    `${path}.jsonSchema`,
    issues,
  );
  return {
    ...(description === undefined ? {} : { description }),
    ...(jsonSchema === undefined ? {} : { jsonSchema }),
  };
}

function normalizeNodeOutputContract(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): NodeOutputContract | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const description =
    typeof raw["description"] === "string" && raw["description"].length > 0
      ? raw["description"]
      : undefined;
  const jsonSchema = normalizeJsonObject(
    raw["jsonSchema"],
    `${path}.jsonSchema`,
    issues,
  );
  const maxValidationAttempts = normalizePositiveInteger(
    raw["maxValidationAttempts"],
    `${path}.maxValidationAttempts`,
    issues,
  );
  return {
    ...(description === undefined ? {} : { description }),
    ...(jsonSchema === undefined ? {} : { jsonSchema }),
    ...(maxValidationAttempts === undefined ? {} : { maxValidationAttempts }),
  };
}

function normalizeStepRef(
  raw: unknown,
  index: number,
  issues: ValidationIssue[],
  options: Pick<PureWorkflowValidationOptions, "allowResolvedStepFileFields">,
): WorkflowStepRef | null {
  const path = `workflow.steps[${index}]`;
  if (!isRecord(raw)) {
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
  for (const key of Object.keys(raw)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue("error", `${path}.${key}`, "uses an unsupported step field"),
      );
    }
  }

  const id = readStringField(raw, "id", path, issues);
  if (id === null) {
    return null;
  }
  const stepFileRaw = raw["stepFile"];
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
      if (raw[inlineField] !== undefined) {
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
  const nodeId =
    typeof raw["nodeId"] === "string" && raw["nodeId"].length > 0
      ? raw["nodeId"]
      : undefined;
  if (nodeId === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.nodeId`,
        "must be a non-empty string after step files are resolved",
      ),
    );
    return null;
  }
  const sessionPolicy = normalizeStepSessionPolicy(
    raw["sessionPolicy"],
    `${path}.sessionPolicy`,
    issues,
  );
  const transitionsRaw = raw["transitions"];
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
          normalizeStepTransition(
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

  return {
    id,
    nodeId,
    ...(stepFile === undefined ? {} : { stepFile }),
    ...(typeof raw["description"] === "string" && raw["description"].length > 0
      ? { description: raw["description"] }
      : {}),
    ...(raw["role"] === "manager" || raw["role"] === "worker"
      ? { role: raw["role"] }
      : {}),
    ...(typeof raw["promptVariant"] === "string" &&
    raw["promptVariant"].length > 0
      ? { promptVariant: raw["promptVariant"] }
      : {}),
    ...(typeof raw["timeoutMs"] === "number" &&
    Number.isFinite(raw["timeoutMs"])
      ? { timeoutMs: raw["timeoutMs"] }
      : {}),
    ...(typeof raw["stallTimeoutMs"] === "number" &&
    Number.isFinite(raw["stallTimeoutMs"])
      ? { stallTimeoutMs: raw["stallTimeoutMs"] }
      : {}),
    ...(sessionPolicy === undefined ? {} : { sessionPolicy }),
    ...(transitions === undefined ? {} : { transitions }),
  };
}

function normalizeWorkflow(
  raw: unknown,
  issues: ValidationIssue[],
  options: PureWorkflowValidationOptions = {},
): WorkflowJson | null {
  if (!isRecord(raw)) {
    issues.push(makeIssue("error", "workflow", "must be an object"));
    return null;
  }

  const workflowId = readStringField(raw, "workflowId", "workflow", issues);
  if (workflowId !== null && !isSafeWorkflowId(workflowId)) {
    issues.push(
      makeIssue(
        "error",
        "workflow.workflowId",
        "must start with an alphanumeric character and contain only letters, digits, hyphens, or underscores",
      ),
    );
  }

  const nodeRegistryRaw = raw["nodes"];
  if (!Array.isArray(nodeRegistryRaw)) {
    issues.push(makeIssue("error", "workflow.nodes", "must be an array"));
  }
  const nodeRegistry = Array.isArray(nodeRegistryRaw)
    ? nodeRegistryRaw
        .map((entry, index) => normalizeNodeRegistryRef(entry, index, issues))
        .filter((entry): entry is WorkflowNodeRegistryRef => entry !== null)
    : [];

  const stepsRaw = raw["steps"];
  const steps: WorkflowStepRef[] =
    Array.isArray(stepsRaw) && stepsRaw.length > 0
      ? stepsRaw
          .map((entry, index) =>
            normalizeStepRef(entry, index, issues, options),
          )
          .filter((entry): entry is WorkflowStepRef => entry !== null)
      : nodeRegistry.map((node) => ({ id: node.id, nodeId: node.id }));

  const entryStepId =
    typeof raw["entryStepId"] === "string" && raw["entryStepId"].length > 0
      ? raw["entryStepId"]
      : steps[0]?.id;
  if (entryStepId === undefined) {
    issues.push(
      makeIssue("error", "workflow.entryStepId", "must be a non-empty string"),
    );
  }

  issues.push(...collectStepAddressedAuthoredWorkflowFieldIssues(raw));

  if (workflowId === null || entryStepId === undefined) {
    return null;
  }

  const registryById = new Map(nodeRegistry.map((node) => [node.id, node]));
  const nodes: WorkflowNodeRef[] = [];
  for (const step of steps) {
    const registryNode = registryById.get(step.nodeId);
    if (registryNode === undefined) {
      issues.push(
        makeIssue(
          "error",
          `workflow.steps.${step.id}.nodeId`,
          `must reference workflow.nodes[] entry '${step.nodeId}'`,
        ),
      );
      continue;
    }
    nodes.push({
      id: step.id,
      nodeFile: registryNode.nodeFile ?? synthesizeInlineNodeFile(step.nodeId),
      ...(registryNode.addon === undefined
        ? {}
        : { addon: registryNode.addon }),
      ...(step.role === undefined ? {} : { role: step.role }),
      ...(registryNode.kind === undefined ? {} : { kind: registryNode.kind }),
      ...(registryNode.execution === undefined
        ? {}
        : { execution: registryNode.execution }),
      ...(registryNode.repeat === undefined
        ? {}
        : { repeat: registryNode.repeat }),
    });
  }

  return {
    workflowId,
    description:
      typeof raw["description"] === "string" ? raw["description"] : "",
    defaults: normalizeDefaults(raw["defaults"], issues),
    ...(isRecord(raw["prompts"]) ? { prompts: raw["prompts"] } : {}),
    ...(typeof raw["managerStepId"] === "string" &&
    raw["managerStepId"].length > 0
      ? { managerStepId: raw["managerStepId"] }
      : {}),
    entryStepId,
    nodeRegistry,
    steps,
    nodes,
  };
}

function normalizeNodePayload(input: {
  readonly nodeId: string;
  readonly raw: unknown;
  readonly path: string;
  readonly issues: ValidationIssue[];
}): NodePayload | null {
  if (!isRecord(input.raw)) {
    input.issues.push(makeIssue("error", input.path, "must be an object"));
    return null;
  }

  const id = readStringField(input.raw, "id", input.path, input.issues);
  if (id !== null && id !== input.nodeId) {
    input.issues.push(
      makeIssue("error", `${input.path}.id`, `must equal ${input.nodeId}`),
    );
  }

  const nodeTypeRaw = input.raw["nodeType"];
  const nodeType =
    nodeTypeRaw === "agent" ||
    nodeTypeRaw === "command" ||
    nodeTypeRaw === "container" ||
    nodeTypeRaw === "sleep" ||
    nodeTypeRaw === "user-action" ||
    nodeTypeRaw === "addon"
      ? nodeTypeRaw
      : undefined;
  if (nodeTypeRaw !== undefined && nodeType === undefined) {
    input.issues.push(
      makeIssue(
        "error",
        `${input.path}.nodeType`,
        "must be 'agent', 'command', 'container', 'sleep', 'user-action', or 'addon'",
      ),
    );
  }
  const managerType =
    input.raw["managerType"] === "code" || input.raw["managerType"] === "llm"
      ? input.raw["managerType"]
      : undefined;
  if (input.raw["managerType"] !== undefined && managerType === undefined) {
    input.issues.push(
      makeIssue(
        "error",
        `${input.path}.managerType`,
        "must be 'code' or 'llm' when provided",
      ),
    );
  }
  const executionBackend = normalizeNodeExecutionBackend(
    input.raw["executionBackend"],
  );
  if (
    input.raw["executionBackend"] !== undefined &&
    executionBackend === undefined
  ) {
    input.issues.push(
      makeIssue(
        "error",
        `${input.path}.executionBackend`,
        `must be ${NODE_EXECUTION_BACKEND_LIST_TEXT}`,
      ),
    );
  }
  const sessionPolicyRaw = input.raw["sessionPolicy"];
  let sessionPolicy: NodeSessionPolicy | undefined;
  if (sessionPolicyRaw !== undefined) {
    if (!isRecord(sessionPolicyRaw)) {
      input.issues.push(
        makeIssue(
          "error",
          `${input.path}.sessionPolicy`,
          "must be an object when provided",
        ),
      );
    } else if (
      sessionPolicyRaw["mode"] === "new" ||
      sessionPolicyRaw["mode"] === "reuse"
    ) {
      sessionPolicy = { mode: sessionPolicyRaw["mode"] };
    } else {
      input.issues.push(
        makeIssue(
          "error",
          `${input.path}.sessionPolicy.mode`,
          "must be 'new' or 'reuse'",
        ),
      );
    }
  }
  const systemPrompt = normalizeNodeTemplateFields({
    raw: input.raw,
    path: input.path,
    templateField: "systemPromptTemplate",
    templateFileField: "systemPromptTemplateFile",
    issues: input.issues,
  });
  const prompt = normalizeNodeTemplateFields({
    raw: input.raw,
    path: input.path,
    templateField: "promptTemplate",
    templateFileField: "promptTemplateFile",
    issues: input.issues,
  });
  const sessionStart = normalizeNodeTemplateFields({
    raw: input.raw,
    path: input.path,
    templateField: "sessionStartPromptTemplate",
    templateFileField: "sessionStartPromptTemplateFile",
    issues: input.issues,
  });
  const promptVariants = normalizePromptVariants(
    input.raw["promptVariants"],
    `${input.path}.promptVariants`,
    input.issues,
  );
  const variables = isRecord(input.raw["variables"])
    ? input.raw["variables"]
    : {};
  if (
    input.raw["variables"] !== undefined &&
    !isRecord(input.raw["variables"])
  ) {
    input.issues.push(
      makeIssue("error", `${input.path}.variables`, "must be an object"),
    );
  }
  const command = normalizeCommandExecution(
    input.raw["command"],
    `${input.path}.command`,
    input.issues,
  );
  const container = normalizeContainerExecution(
    input.raw["container"],
    `${input.path}.container`,
    input.issues,
  );
  const durability = normalizeDurability(
    input.raw["durability"],
    `${input.path}.durability`,
    input.issues,
  );
  const sleep = normalizeSleepConfig(
    input.raw["sleep"],
    `${input.path}.sleep`,
    input.issues,
  );
  const userAction = normalizeUserAction(
    input.raw["userAction"],
    `${input.path}.userAction`,
    input.issues,
  );
  const argumentsTemplate = normalizeObjectField(
    input.raw["argumentsTemplate"],
    `${input.path}.argumentsTemplate`,
    input.issues,
  );
  const argumentBindings = normalizeArgumentBindings(
    input.raw["argumentBindings"],
    `${input.path}.argumentBindings`,
    input.issues,
  );
  const templateEngine =
    typeof input.raw["templateEngine"] === "string"
      ? input.raw["templateEngine"]
      : undefined;
  const timeoutMs = normalizePositiveNumber(
    input.raw["timeoutMs"],
    `${input.path}.timeoutMs`,
    input.issues,
  );
  const stallTimeoutMs = normalizePositiveInteger(
    input.raw["stallTimeoutMs"],
    `${input.path}.stallTimeoutMs`,
    input.issues,
  );
  const inputContract = normalizeNodeInputContract(
    input.raw["input"],
    `${input.path}.input`,
    input.issues,
  );
  const outputContract = normalizeNodeOutputContract(
    input.raw["output"],
    `${input.path}.output`,
    input.issues,
  );

  if (id === null) {
    return null;
  }

  return {
    id,
    ...(typeof input.raw["description"] === "string" &&
    input.raw["description"].length > 0
      ? { description: input.raw["description"] }
      : {}),
    ...(nodeType === undefined ? {} : { nodeType }),
    ...(managerType === undefined ? {} : { managerType }),
    ...(typeof input.raw["workingDirectory"] === "string" &&
    input.raw["workingDirectory"].length > 0
      ? { workingDirectory: input.raw["workingDirectory"] }
      : {}),
    ...(typeof input.raw["model"] === "string"
      ? { model: input.raw["model"] }
      : {}),
    ...(executionBackend === undefined ? {} : { executionBackend }),
    ...(sessionPolicy === undefined ? {} : { sessionPolicy }),
    ...(systemPrompt.template === undefined
      ? {}
      : { systemPromptTemplate: systemPrompt.template }),
    ...(systemPrompt.templateFile === undefined
      ? {}
      : { systemPromptTemplateFile: systemPrompt.templateFile }),
    ...(prompt.template === undefined
      ? {}
      : { promptTemplate: prompt.template }),
    ...(prompt.templateFile === undefined
      ? {}
      : { promptTemplateFile: prompt.templateFile }),
    ...(sessionStart.template === undefined
      ? {}
      : { sessionStartPromptTemplate: sessionStart.template }),
    ...(sessionStart.templateFile === undefined
      ? {}
      : { sessionStartPromptTemplateFile: sessionStart.templateFile }),
    ...(promptVariants === undefined ? {} : { promptVariants }),
    variables,
    ...(command === undefined ? {} : { command }),
    ...(container === undefined ? {} : { container }),
    ...(durability === undefined ? {} : { durability }),
    ...(sleep === undefined ? {} : { sleep }),
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

function buildPureNodePayloads(input: {
  readonly workflow: WorkflowJson;
  readonly rawWorkflow: unknown;
  readonly rawNodePayloads: Readonly<Record<string, unknown>>;
  readonly issues: ValidationIssue[];
}): Record<string, NodePayload> {
  const nodePayloadsRaw = remapAuthoredNodePayloadsByNodeFile(
    input.rawWorkflow,
    input.rawNodePayloads,
  );
  const payloads: Record<string, NodePayload> = {};

  for (const registryNode of input.workflow.nodeRegistry) {
    if (registryNode.addon !== undefined) {
      continue;
    }

    const nodeFile =
      registryNode.nodeFile ?? synthesizeInlineNodeFile(registryNode.id);
    const payloadRaw =
      nodePayloadsRaw[nodeFile] ??
      (isRecord(input.rawWorkflow)
        ? (
            (
              input.rawWorkflow["nodes"] as readonly unknown[] | undefined
            )?.find(
              (node) =>
                isRecord(node) &&
                node["id"] === registryNode.id &&
                node[INLINE_NODE_FIELD] !== undefined,
            ) as UnknownRecord | undefined
          )?.[INLINE_NODE_FIELD]
        : undefined);
    if (payloadRaw === undefined) {
      input.issues.push(
        makeIssue(
          "error",
          `nodePayloads.${nodeFile}`,
          "node payload file is missing",
        ),
      );
      continue;
    }

    const payload = normalizeNodePayload({
      nodeId: registryNode.id,
      raw: payloadRaw,
      path: `nodePayloads.${nodeFile}`,
      issues: input.issues,
    });
    if (payload !== null) {
      payloads[registryNode.id] = payload;
      payloads[nodeFile] = payload;
    }
  }

  for (const step of input.workflow.steps) {
    const payload = payloads[step.nodeId];
    if (payload !== undefined) {
      payloads[step.id] = payload;
    }
  }

  return payloads;
}

export function validatePureWorkflowBundleDetailed(
  raw: RawWorkflowBundle,
  options: PureWorkflowValidationOptions = {},
): Result<PureWorkflowValidationSuccess, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const workflow = normalizeWorkflow(raw.workflow, issues, options);
  if (workflow === null) {
    return err(issues);
  }

  const nodePayloads = buildPureNodePayloads({
    workflow,
    rawWorkflow: raw.workflow,
    rawNodePayloads: raw.nodePayloads,
    issues,
  });
  const allErrors = issues.filter((issue) => issue.severity === "error");
  if (allErrors.length > 0) {
    return err(issues);
  }

  return ok({ workflow, nodePayloads, issues });
}

export function validatePureWorkflowBundle(
  raw: RawWorkflowBundle,
  options: PureWorkflowValidationOptions = {},
): PureWorkflowValidationResult {
  const validation = validatePureWorkflowBundleDetailed(raw, options);
  if (!validation.ok) {
    return err(validation.error);
  }
  return ok({
    workflow: validation.value.workflow,
    nodePayloads: validation.value.nodePayloads,
  });
}
