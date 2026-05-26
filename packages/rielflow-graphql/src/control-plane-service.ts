import type {
  GraphqlRuntimeEventReplyDispatchRecord,
  GraphqlRuntimeHookEventRecord,
  GraphqlRuntimeLlmSessionMessageRecord,
  GraphqlRuntimeNodeExecutionSummary,
  GraphqlRuntimeNodeLogEntry,
  WorkflowControlPlaneSession,
  WorkflowControlPlaneSessionStatus,
} from "./dto";

export interface WorkflowControlPlaneExecutionResult {
  readonly workflowExecutionId: string;
  readonly sessionId: string;
  readonly status: WorkflowControlPlaneSessionStatus;
  readonly exitCode: number;
}

export interface WorkflowControlPlaneContinuationResult
  extends WorkflowControlPlaneExecutionResult {
  readonly continuedAfterStepRunId: string;
  readonly continuedStartStepId: string;
}

export interface WorkflowControlPlaneStepRunView {
  readonly workflowExecutionId: string;
  readonly timelineOrdinal: number;
  readonly executionOrdinal: number;
  readonly stepRunId: string;
  readonly stepId?: string;
  readonly nodeRegistryId?: string;
  readonly status: string;
  readonly imported: boolean;
  readonly sourceWorkflowExecutionId: string;
  readonly startedAt: string;
  readonly endedAt: string;
}

export interface WorkflowControlPlaneStepRunsResult {
  readonly workflowExecutionId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly stepRuns: readonly WorkflowControlPlaneStepRunView[];
}

export interface WorkflowControlPlaneService<TContext = unknown> {
  loadSession(
    workflowExecutionId: string,
    context: TContext,
  ): Promise<WorkflowControlPlaneSession | null>;
  listSessionIds(context: TContext): Promise<readonly string[]>;
  saveSession(
    session: WorkflowControlPlaneSession,
    context: TContext,
  ): Promise<void>;
  listNodeExecutions(
    workflowExecutionId: string,
    context: TContext,
  ): Promise<readonly GraphqlRuntimeNodeExecutionSummary[]>;
  listNodeLogs(
    workflowExecutionId: string,
    context: TContext,
  ): Promise<readonly GraphqlRuntimeNodeLogEntry[]>;
  listLlmSessionMessages(
    workflowExecutionId: string,
    context: TContext,
  ): Promise<readonly GraphqlRuntimeLlmSessionMessageRecord[]>;
  listHookEvents(
    workflowExecutionId: string,
    context: TContext,
  ): Promise<readonly GraphqlRuntimeHookEventRecord[]>;
  listReplyDispatches(
    workflowExecutionId: string,
    context: TContext,
  ): Promise<readonly GraphqlRuntimeEventReplyDispatchRecord[]>;
  runWorkflow(input: {
    readonly workflowName: string;
    readonly options: unknown;
  }): Promise<WorkflowControlPlaneExecutionResult>;
  continueWorkflowFromHistory(
    input: unknown,
  ): Promise<WorkflowControlPlaneContinuationResult>;
  listWorkflowExecutionStepRuns(
    input: unknown,
  ): Promise<WorkflowControlPlaneStepRunsResult>;
}
