import type {
  WorkflowDefaults,
  WorkflowSelfImproveMode,
  WorkflowSelfImprovePolicy,
} from "../types";
import {
  WORKFLOW_SELF_IMPROVE_SOURCE_MODES,
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
