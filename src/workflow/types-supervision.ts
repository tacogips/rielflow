import type { LoadOptions } from "./types";

/**
 * Input policy for supervised `--auto-improve` runs. Persisted on the session when active.
 */
export interface AutoImprovePolicy {
  readonly enabled: true;
  readonly superviserWorkflowId?: string;
  readonly monitorIntervalMs: number;
  readonly stallTimeoutMs: number;
  readonly maxSupervisedAttempts: number;
  readonly maxWorkflowPatches: number;
  readonly workflowMutationMode: "execution-copy" | "in-place";
  readonly allowTargetedRerun?: boolean;
}

/**
 * Polls the runtime session snapshot row (`sessions.updated_at` from
 * `saveSessionSnapshotToRuntimeDb`) while a step executes; on stale snapshots,
 * the adapter or native step execution is aborted (design: persisted timestamps).
 */
export interface SupervisionStallWatch {
  readonly sessionId: string;
  readonly monitorIntervalMs: number;
  readonly stallTimeoutMs: number;
  readonly loadOptions: LoadOptions;
}

export interface SupervisionIncident {
  readonly incidentId: string;
  readonly supervisedAttemptId: string;
  readonly category: "failure" | "stall" | "budget-exhausted";
  readonly summary: string;
  readonly detectedAt: string;
}

/** Normalized remediation choice recorded after an incident (impl-plan superviser module). */
export type SupervisionRemediationAction =
  | "rerun-workflow"
  | "rerun-step"
  | "patch-workflow"
  | "stop-supervision";

export interface SupervisionRemediationRecord {
  readonly remediationId: string;
  readonly incidentId: string;
  readonly decidedAt: string;
  readonly action: SupervisionRemediationAction;
  readonly targetStepId?: string;
  readonly reason: string;
}

export type SupervisionRunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "stopped";

/**
 * Durable supervision cycle state stored on the workflow session record when auto-improve is active.
 * Policy and remediation history are required for resume-safe supervision.
 */
export interface SupervisionRunState {
  readonly supervisionRunId: string;
  readonly targetWorkflowId: string;
  readonly superviserWorkflowId: string;
  readonly status: SupervisionRunStatus;
  readonly attemptCount: number;
  readonly workflowPatchCount: number;
  readonly policy?: AutoImprovePolicy;
  readonly nestedSuperviserSessionId?: string;
  readonly mutableWorkflowDir?: string;
  readonly incidents: readonly SupervisionIncident[];
  readonly remediations?: readonly SupervisionRemediationRecord[];
}

export interface SupervisionSummary {
  readonly supervisionRunId: string;
  readonly targetWorkflowId: string;
  readonly superviserWorkflowId: string;
  readonly status: SupervisionRunStatus;
  readonly attemptCount: number;
  readonly workflowPatchCount: number;
  readonly latestIncidentId?: string;
  readonly latestRemediationId?: string;
  readonly mutableWorkflowDir?: string;
  readonly nestedSuperviserSessionId?: string;
}

export interface SuperviserControlAuth {
  readonly supervisionRunId: string;
  readonly targetSessionId: string;
}

export interface StartWorkflowAddonInput {
  readonly workflowId: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly autoImprove?: AutoImprovePolicy;
}

export interface GetWorkflowStatusAddonInput {
  readonly sessionId: string;
}

export interface GetWorkflowExecutionDetailsAddonInput {
  readonly sessionId: string;
}

export interface RerunWorkflowAddonInput {
  readonly sessionId: string;
  readonly rerunFromStepId?: string;
}

export interface LoadWorkflowDefinitionAddonInput {
  readonly workflowId: string;
  readonly mutableWorkflowDir: string;
}

export interface SaveWorkflowDefinitionAddonInput {
  readonly workflowId: string;
  readonly mutableWorkflowDir: string;
  readonly bundle: {
    readonly workflow: Readonly<Record<string, unknown>>;
    readonly nodePayloads: Readonly<Record<string, unknown>>;
  };
}

export interface StartTargetWorkflowOutput {
  readonly sessionId: string;
  readonly status: string;
}

export interface GetWorkflowStatusOutput {
  readonly sessionId: string;
  readonly status: string;
  readonly workflowId: string;
  readonly currentNodeId?: string;
  readonly lastError?: string;
}

export interface GetWorkflowExecutionDetailsOutput {
  readonly session: Readonly<Record<string, unknown>>;
}

export interface RerunTargetWorkflowOutput {
  readonly sessionId: string;
  readonly status: string;
}

export interface LoadWorkflowDefinitionOutput {
  readonly workflowId: string;
  readonly mutableWorkflowDir: string;
  readonly bundle: Readonly<Record<string, unknown>>;
}

export interface SaveWorkflowDefinitionOutput {
  readonly saved: true;
  readonly workflowId: string;
  readonly mutableWorkflowDir: string;
}

export type StartTargetWorkflowControlArguments = SuperviserControlAuth &
  StartWorkflowAddonInput;
export type GetWorkflowStatusControlArguments = SuperviserControlAuth &
  GetWorkflowStatusAddonInput;
export type GetWorkflowExecutionDetailsControlArguments =
  SuperviserControlAuth & GetWorkflowExecutionDetailsAddonInput;
export type RerunWorkflowControlArguments = SuperviserControlAuth &
  RerunWorkflowAddonInput;
export type LoadWorkflowDefinitionControlArguments = SuperviserControlAuth &
  LoadWorkflowDefinitionAddonInput;
export type SaveWorkflowDefinitionControlArguments = SuperviserControlAuth &
  SaveWorkflowDefinitionAddonInput;

export interface MutableWorkflowWorkspace {
  readonly workflowId: string;
  readonly sourceWorkflowDir: string;
  readonly mutableWorkflowDir: string;
  readonly mutationMode: "execution-copy" | "in-place";
}

export interface WorkflowPatchRevisionInput {
  readonly supervisionRunId: string;
  readonly mutableWorkflowDir: string;
  readonly reason: string;
  readonly patchedByStepId: string;
}

export interface WorkflowPatchRevisionRecord {
  readonly patchRevisionId: string;
  readonly recordedAt: string;
  readonly reason: string;
  readonly patchedByStepId: string;
  readonly mutableWorkflowDir: string;
}
