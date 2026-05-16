import { err, ok, type Result } from "./result";
import type { AutoImprovePolicy, WorkflowSupervisionDefaults } from "./types";

/** Default superviser bundle id (valid workflow id; loadWorkflowByIdFromDisk matches workflow.json). */
export const DEFAULT_SUPERVISER_WORKFLOW_ID = "divedra-default-superviser";
export const DEFAULT_MONITOR_INTERVAL_MS = 5_000;
export const DEFAULT_STALL_TIMEOUT_MS = 60 * 60 * 1000;
export const DEFAULT_MAX_SUPERVISED_ATTEMPTS = 5;
export const DEFAULT_MAX_WORKFLOW_PATCHES = 3;
export const LIFECYCLE_SUPERVISION_MAX_WORKFLOW_PATCHES = 0;
export const DEFAULT_WORKFLOW_MUTATION_MODE = "execution-copy" as const;

export interface AutoImprovePolicyInput {
  readonly enabled: boolean;
  readonly superviserWorkflowId?: string;
  readonly monitorIntervalMs?: number;
  readonly stallTimeoutMs?: number;
  readonly maxSupervisedAttempts?: number;
  readonly maxWorkflowPatches?: number;
  readonly workflowMutationMode?: "execution-copy" | "in-place";
  readonly allowTargetedRerun?: boolean;
}

export function createDefaultAutoImprovePolicy(): AutoImprovePolicy {
  return {
    enabled: true,
    superviserWorkflowId: DEFAULT_SUPERVISER_WORKFLOW_ID,
    monitorIntervalMs: DEFAULT_MONITOR_INTERVAL_MS,
    stallTimeoutMs: DEFAULT_STALL_TIMEOUT_MS,
    maxSupervisedAttempts: DEFAULT_MAX_SUPERVISED_ATTEMPTS,
    maxWorkflowPatches: DEFAULT_MAX_WORKFLOW_PATCHES,
    workflowMutationMode: DEFAULT_WORKFLOW_MUTATION_MODE,
  };
}

export function createDefaultLifecycleSupervisionPolicy(): AutoImprovePolicy {
  return {
    ...createDefaultAutoImprovePolicy(),
    maxWorkflowPatches: LIFECYCLE_SUPERVISION_MAX_WORKFLOW_PATCHES,
  };
}

export function createLifecycleSupervisionPolicyInput(): AutoImprovePolicyInput {
  return {
    enabled: true,
    maxWorkflowPatches: LIFECYCLE_SUPERVISION_MAX_WORKFLOW_PATCHES,
  };
}

export function applyWorkflowSupervisionDefaults(
  input: AutoImprovePolicyInput,
  defaults: WorkflowSupervisionDefaults | undefined,
): AutoImprovePolicyInput {
  if (defaults === undefined) {
    return input;
  }
  return {
    ...(defaults.superviserWorkflowId === undefined
      ? {}
      : { superviserWorkflowId: defaults.superviserWorkflowId }),
    ...(defaults.monitorIntervalMs === undefined
      ? {}
      : { monitorIntervalMs: defaults.monitorIntervalMs }),
    ...(defaults.stallTimeoutMs === undefined
      ? {}
      : { stallTimeoutMs: defaults.stallTimeoutMs }),
    ...(defaults.maxSupervisedAttempts === undefined
      ? {}
      : { maxSupervisedAttempts: defaults.maxSupervisedAttempts }),
    ...(defaults.maxWorkflowPatches === undefined
      ? {}
      : { maxWorkflowPatches: defaults.maxWorkflowPatches }),
    ...(defaults.workflowMutationMode === undefined
      ? {}
      : { workflowMutationMode: defaults.workflowMutationMode }),
    ...(defaults.allowTargetedRerun === undefined
      ? {}
      : { allowTargetedRerun: defaults.allowTargetedRerun }),
    ...input,
  };
}

function hasDisabledAutoImproveOverrides(
  input: AutoImprovePolicyInput,
): boolean {
  return (
    input.superviserWorkflowId !== undefined ||
    input.monitorIntervalMs !== undefined ||
    input.stallTimeoutMs !== undefined ||
    input.maxSupervisedAttempts !== undefined ||
    input.maxWorkflowPatches !== undefined ||
    input.workflowMutationMode !== undefined ||
    input.allowTargetedRerun !== undefined
  );
}

function validatePositiveInteger(
  value: unknown,
  fieldName: string,
): Result<number, string> {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return err(`${fieldName} must be a positive integer`);
  }
  return ok(value);
}

function validateNonNegativeInteger(
  value: unknown,
  fieldName: string,
): Result<number, string> {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return err(`${fieldName} must be a non-negative integer`);
  }
  return ok(value);
}

function validateOptionalString(
  value: unknown,
  fieldName: string,
): Result<string | undefined, string> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (typeof value !== "string") {
    return err(`${fieldName} must be a string when provided`);
  }
  return ok(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveSuperviserWorkflowId(
  value: string | undefined,
): Result<string, string> {
  if (value === undefined) {
    return ok(DEFAULT_SUPERVISER_WORKFLOW_ID);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return err("superviserWorkflowId must not be empty when provided");
  }
  return ok(normalized);
}

function validateWorkflowMutationMode(
  value: unknown,
): Result<"execution-copy" | "in-place", string> {
  if (value === undefined) {
    return ok(DEFAULT_WORKFLOW_MUTATION_MODE);
  }
  if (value === "execution-copy" || value === "in-place") {
    return ok(value);
  }
  return err(
    "workflowMutationMode must be 'execution-copy' or 'in-place' when provided",
  );
}

export function parseAutoImprovePolicyInput(
  value: unknown,
  path: string,
): Result<AutoImprovePolicyInput, string> {
  if (!isRecord(value)) {
    return err(`${path} must be an object when provided`);
  }
  if (typeof value["enabled"] !== "boolean") {
    return err(`${path}.enabled must be a boolean`);
  }
  const input: {
    enabled: boolean;
    superviserWorkflowId?: string;
    monitorIntervalMs?: number;
    stallTimeoutMs?: number;
    maxSupervisedAttempts?: number;
    maxWorkflowPatches?: number;
    workflowMutationMode?: "execution-copy" | "in-place";
    allowTargetedRerun?: boolean;
  } = {
    enabled: value["enabled"],
  };
  const optionalNumberFields = [
    "monitorIntervalMs",
    "stallTimeoutMs",
    "maxSupervisedAttempts",
    "maxWorkflowPatches",
  ] as const;
  for (const key of optionalNumberFields) {
    const field = value[key];
    if (field === undefined) {
      continue;
    }
    if (typeof field !== "number" || !Number.isFinite(field)) {
      return err(`${path}.${key} must be a finite number when provided`);
    }
    input[key] = field;
  }
  if (
    value["superviserWorkflowId"] !== undefined &&
    typeof value["superviserWorkflowId"] !== "string"
  ) {
    return err(`${path}.superviserWorkflowId must be a string when provided`);
  }
  if (
    value["superviserWorkflowId"] !== undefined &&
    value["superviserWorkflowId"].trim().length === 0
  ) {
    return err(
      `${path}.superviserWorkflowId must be a non-empty string when provided`,
    );
  }
  if (typeof value["superviserWorkflowId"] === "string") {
    input.superviserWorkflowId = value["superviserWorkflowId"];
  }
  if (
    value["workflowMutationMode"] !== undefined &&
    typeof value["workflowMutationMode"] !== "string"
  ) {
    return err(`${path}.workflowMutationMode must be a string when provided`);
  }
  if (
    value["workflowMutationMode"] !== undefined &&
    value["workflowMutationMode"] !== "execution-copy" &&
    value["workflowMutationMode"] !== "in-place"
  ) {
    return err(
      `${path}.workflowMutationMode must be 'execution-copy' or 'in-place' when provided`,
    );
  }
  if (
    value["workflowMutationMode"] === "execution-copy" ||
    value["workflowMutationMode"] === "in-place"
  ) {
    input.workflowMutationMode = value["workflowMutationMode"];
  }
  if (
    value["allowTargetedRerun"] !== undefined &&
    typeof value["allowTargetedRerun"] !== "boolean"
  ) {
    return err(`${path}.allowTargetedRerun must be a boolean when provided`);
  }
  if (typeof value["allowTargetedRerun"] === "boolean") {
    input.allowTargetedRerun = value["allowTargetedRerun"];
  }
  return ok(input);
}

export function normalizeAutoImprovePolicy(
  input: AutoImprovePolicyInput,
): Result<AutoImprovePolicy | undefined, string> {
  if (input.enabled !== true && input.enabled !== false) {
    return err("enabled must be a boolean");
  }
  if (!input.enabled) {
    if (hasDisabledAutoImproveOverrides(input)) {
      return err(
        "autoImprove settings require enabled=true when additional policy fields are provided",
      );
    }
    return ok(createDefaultLifecycleSupervisionPolicy());
  }

  const superviserWorkflowId = validateOptionalString(
    input.superviserWorkflowId,
    "superviserWorkflowId",
  );
  if (!superviserWorkflowId.ok) {
    return superviserWorkflowId;
  }
  const normalizedSuperviserWorkflowId = resolveSuperviserWorkflowId(
    superviserWorkflowId.value,
  );
  if (!normalizedSuperviserWorkflowId.ok) {
    return normalizedSuperviserWorkflowId;
  }

  const monitorIntervalMs = validatePositiveInteger(
    input.monitorIntervalMs ?? DEFAULT_MONITOR_INTERVAL_MS,
    "monitorIntervalMs",
  );
  if (!monitorIntervalMs.ok) {
    return monitorIntervalMs;
  }

  const stallTimeoutMs = validatePositiveInteger(
    input.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS,
    "stallTimeoutMs",
  );
  if (!stallTimeoutMs.ok) {
    return stallTimeoutMs;
  }
  if (stallTimeoutMs.value < monitorIntervalMs.value) {
    return err(
      "stallTimeoutMs must be greater than or equal to monitorIntervalMs",
    );
  }

  const maxSupervisedAttempts = validatePositiveInteger(
    input.maxSupervisedAttempts ?? DEFAULT_MAX_SUPERVISED_ATTEMPTS,
    "maxSupervisedAttempts",
  );
  if (!maxSupervisedAttempts.ok) {
    return maxSupervisedAttempts;
  }

  const maxWorkflowPatches = validateNonNegativeInteger(
    input.maxWorkflowPatches ?? DEFAULT_MAX_WORKFLOW_PATCHES,
    "maxWorkflowPatches",
  );
  if (!maxWorkflowPatches.ok) {
    return maxWorkflowPatches;
  }

  const workflowMutationMode = validateWorkflowMutationMode(
    input.workflowMutationMode,
  );
  if (!workflowMutationMode.ok) {
    return workflowMutationMode;
  }

  if (
    input.allowTargetedRerun !== undefined &&
    typeof input.allowTargetedRerun !== "boolean"
  ) {
    return err("allowTargetedRerun must be a boolean when provided");
  }

  return ok({
    enabled: true,
    superviserWorkflowId: normalizedSuperviserWorkflowId.value,
    monitorIntervalMs: monitorIntervalMs.value,
    stallTimeoutMs: stallTimeoutMs.value,
    maxSupervisedAttempts: maxSupervisedAttempts.value,
    maxWorkflowPatches: maxWorkflowPatches.value,
    workflowMutationMode: workflowMutationMode.value,
    ...(input.allowTargetedRerun === false
      ? { allowTargetedRerun: false as const }
      : {}),
  });
}
