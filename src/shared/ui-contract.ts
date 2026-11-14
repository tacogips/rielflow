import type { WorkflowSessionState } from "../workflow/session";
import type { WorkflowAddonSourceSummary } from "../workflow/addon-source-summary";
import type {
  NormalizedWorkflowBundle,
  ValidationIssue,
} from "../workflow/types";
import type { DerivedVisNode } from "../workflow/visualization";

export type SessionStatus = WorkflowSessionState["status"];

export interface WorkflowListResponse {
  readonly workflows: readonly string[];
}

export interface WorkflowResponse {
  readonly workflowName: string;
  readonly workflowDirectory?: string;
  readonly artifactWorkflowRoot?: string;
  readonly revision: string | null;
  readonly bundle: NormalizedWorkflowBundle;
  readonly derivedVisualization: readonly DerivedVisNode[];
}

export interface WorkflowExecutionSummary {
  readonly workflowExecutionId: string;
  readonly sessionId: string;
  readonly workflowName: string;
  readonly status: SessionStatus;
  readonly currentNodeId: string | null;
  readonly nodeExecutionCounter: number;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export interface SessionsResponse {
  readonly sessions: readonly WorkflowExecutionSummary[];
}

export type WorkflowExecutionStateResponse = WorkflowSessionState & {
  readonly workflowExecutionId: string;
};

export interface ValidationResponse {
  readonly valid: boolean;
  readonly workflowId?: string;
  readonly addonSources?: readonly WorkflowAddonSourceSummary[];
  readonly warnings?: readonly ValidationIssue[];
  readonly issues?: readonly ValidationIssue[];
  readonly error?: string;
}

export interface CreateWorkflowRequest {
  readonly workflowName: string;
}

export interface ValidateWorkflowRequest<TBundle = NormalizedWorkflowBundle> {
  readonly bundle: TBundle;
}

export interface SaveWorkflowRequest<TBundle = NormalizedWorkflowBundle> {
  readonly bundle: TBundle;
  readonly expectedRevision?: string;
}

export interface WorkflowRunRequest {
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly workingDirectory?: string;
  readonly mockScenario?: Readonly<Record<string, unknown>>;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly dryRun?: true;
}

export interface ExecuteWorkflowRequest extends WorkflowRunRequest {
  readonly async: boolean;
}

export interface RerunWorkflowRequest extends WorkflowRunRequest {
  readonly fromNodeId?: string;
}

export interface SaveWorkflowResponse {
  readonly workflowName: string;
  readonly workflowDirectory?: string;
  readonly revision: string;
}

export interface ExecuteWorkflowResponse {
  readonly workflowExecutionId: string;
  readonly accepted?: boolean;
  readonly sessionId: string;
  readonly status: SessionStatus;
  readonly exitCode?: number;
}

export interface CancelWorkflowExecutionResponse {
  readonly accepted: boolean;
  readonly status: SessionStatus;
  readonly workflowExecutionId: string;
  readonly sessionId: string;
}

export interface RerunWorkflowResponse {
  readonly sourceWorkflowExecutionId: string;
  readonly sourceSessionId: string;
  readonly workflowExecutionId: string;
  readonly sessionId: string;
  readonly status: SessionStatus;
  readonly rerunFromNodeId: string;
  readonly exitCode?: number;
}

export interface ErrorResponse {
  readonly error?: string;
  readonly currentRevision?: string | null;
  readonly exitCode?: number;
}
