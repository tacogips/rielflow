import type {
  WorkflowDefaults,
  WorkflowSelfImproveMode,
  WorkflowSelfImprovePolicy,
} from "../types";
import {
  WORKFLOW_SELF_IMPROVE_SOURCE_MODES,
  type ExecuteWorkflowSelfImproveInput,
  type WorkflowSelfImproveSourceMode,
} from "./types";

export const DEFAULT_SELF_IMPROVE_LOG_LIMIT = 10;
const ENV_DEFAULT_LIMIT = "DIVEDRA_SELF_IMPROVE_DEFAULT_LIMIT";
const WORKFLOW_SELF_IMPROVE_MODES = [
  "report-only",
  "report-and-auto-improve",
] as const satisfies readonly WorkflowSelfImproveMode[];

export interface ResolveWorkflowSelfImprovePolicyInput {
  readonly defaults?: WorkflowDefaults["selfImprove"];
  readonly mode?: WorkflowSelfImproveMode | string;
  readonly limit?: number;
  readonly enableDisabled?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface WorkflowSelfImproveValidatedPublicInput {
  readonly workflowName: string;
  readonly mode?: WorkflowSelfImproveMode;
  readonly sourceMode?: WorkflowSelfImproveSourceMode;
  readonly limit?: number;
  readonly sessionIds?: readonly string[];
  readonly enableDisabled?: boolean;
  readonly commandApiOverrides: readonly string[];
}

function readEnvLimit(
  env: Readonly<Record<string, string | undefined>>,
): number | undefined {
  const raw = env[ENV_DEFAULT_LIMIT];
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${ENV_DEFAULT_LIMIT} must be a positive integer`);
  }
  return parsed;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

export function parseWorkflowSelfImproveMode(
  value: unknown,
): WorkflowSelfImproveMode {
  if (
    typeof value === "string" &&
    (WORKFLOW_SELF_IMPROVE_MODES as readonly string[]).includes(value)
  ) {
    return value as WorkflowSelfImproveMode;
  }
  throw new Error(`invalid self-improve mode '${String(value)}'`);
}

export function parseWorkflowSelfImproveSourceMode(
  value: unknown,
): WorkflowSelfImproveSourceMode {
  if (
    typeof value === "string" &&
    (WORKFLOW_SELF_IMPROVE_SOURCE_MODES as readonly string[]).includes(value)
  ) {
    return value as WorkflowSelfImproveSourceMode;
  }
  throw new Error(`invalid self-improve source mode '${String(value)}'`);
}

function validateExplicitSessionId(sessionId: string): string {
  const normalized = sessionId.trim();
  if (normalized.length === 0) {
    throw new Error("self-improve explicit session ids must be non-empty");
  }
  if (normalized.includes("/") || normalized.includes("\\")) {
    throw new Error(
      `invalid self-improve explicit session id '${sessionId}'; path separators are not allowed`,
    );
  }
  return normalized;
}

export function validateWorkflowSelfImprovePublicInput(
  input: ExecuteWorkflowSelfImproveInput,
): WorkflowSelfImproveValidatedPublicInput {
  const workflowName = input.workflowName.trim();
  if (workflowName.length === 0) {
    throw new Error("self-improve workflowName must be a non-empty string");
  }
  const commandApiOverrides: string[] = [];
  const mode =
    input.mode === undefined
      ? undefined
      : parseWorkflowSelfImproveMode(input.mode);
  if (mode !== undefined) {
    commandApiOverrides.push("mode");
  }
  const sourceMode =
    input.sourceMode === undefined
      ? undefined
      : parseWorkflowSelfImproveSourceMode(input.sourceMode);
  if (sourceMode !== undefined) {
    commandApiOverrides.push("sourceMode");
  }
  if (input.limit !== undefined) {
    assertPositiveInteger(input.limit, "self-improve source limit");
    commandApiOverrides.push("limit");
  }
  const sessionIds =
    input.sessionIds === undefined
      ? undefined
      : input.sessionIds.map(validateExplicitSessionId);
  if (sessionIds !== undefined) {
    commandApiOverrides.push("sessionIds");
  }
  if (sourceMode === "explicit" && (sessionIds ?? []).length === 0) {
    throw new Error(
      "self-improve sourceMode 'explicit' requires at least one session id",
    );
  }
  if (
    sourceMode !== undefined &&
    sourceMode !== "explicit" &&
    sessionIds !== undefined &&
    sessionIds.length > 0
  ) {
    throw new Error(
      "self-improve explicit session ids require sourceMode 'explicit'",
    );
  }
  if (input.enableDisabled !== undefined) {
    commandApiOverrides.push("enableDisabled");
  }
  return {
    workflowName,
    ...(mode === undefined ? {} : { mode }),
    ...(sourceMode === undefined ? {} : { sourceMode }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(sessionIds === undefined ? {} : { sessionIds }),
    ...(input.enableDisabled === undefined
      ? {}
      : { enableDisabled: input.enableDisabled }),
    commandApiOverrides,
  };
}

export function resolveWorkflowSelfImprovePolicy(
  input: ResolveWorkflowSelfImprovePolicyInput,
): WorkflowSelfImprovePolicy {
  const envLimit = readEnvLimit(input.env ?? process.env);
  const defaultLogLimit =
    input.limit ??
    input.defaults?.defaultLogLimit ??
    envLimit ??
    DEFAULT_SELF_IMPROVE_LOG_LIMIT;
  assertPositiveInteger(defaultLogLimit, "self-improve log limit");

  const mode = parseWorkflowSelfImproveMode(
    input.mode ?? input.defaults?.mode ?? "report-only",
  );
  const configuredEnabled = input.defaults?.enabled ?? false;
  const enabled = configuredEnabled || input.enableDisabled === true;
  return { enabled, mode, defaultLogLimit };
}
