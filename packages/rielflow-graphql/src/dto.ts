export type WorkflowControlPlaneSessionStatus =
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowControlPlaneNodeExecutionStatus =
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "skipped";

export type WorkflowControlPlaneCommunicationStatus =
  | "created"
  | "delivered"
  | "consumed"
  | "delivery_failed"
  | "superseded";

export interface WorkflowControlPlaneSessionTransition {
  readonly from: string;
  readonly to: string;
  readonly when: string;
}

export interface WorkflowControlPlaneSupervisionState {
  readonly supervisionRunId: string;
  readonly targetWorkflowId: string;
  readonly superviserWorkflowId: string;
  readonly status: string;
  readonly attemptCount: number;
  readonly workflowPatchCount: number;
  readonly mutableWorkflowDir?: string;
  readonly nestedSuperviserSessionId?: string;
  readonly policy?: {
    readonly monitorIntervalMs?: number;
    readonly [key: string]: unknown;
  };
  readonly incidents: readonly {
    readonly incidentId?: string;
    readonly [key: string]: unknown;
  }[];
  readonly remediations: readonly {
    readonly remediationId?: string;
    readonly action?: string;
    readonly [key: string]: unknown;
  }[];
}

export interface WorkflowControlPlaneNodeExecutionRecord {
  readonly nodeId: string;
  readonly stepId?: string;
  readonly nodeRegistryId?: string;
  readonly nodeExecId: string;
  readonly mailboxInstanceId?: string;
  readonly status: WorkflowControlPlaneNodeExecutionStatus;
  readonly artifactDir: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly attempt?: number;
  readonly outputAttemptCount?: number;
  readonly outputValidationErrors?: readonly {
    readonly path: string;
    readonly message: string;
  }[];
  readonly promptVariant?: string;
  readonly timeoutMs?: number;
  readonly backendSessionId?: string;
  readonly backendSessionMode?: "new" | "reuse";
  readonly restartedFromNodeExecId?: string;
}

export interface WorkflowControlPlaneCommunicationRecord {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly communicationId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly sourceNodeExecId: string;
  readonly status: WorkflowControlPlaneCommunicationStatus;
  readonly artifactDir: string;
  readonly [key: string]: unknown;
}

export interface WorkflowControlPlaneSession {
  readonly sessionId: string;
  readonly workflowName: string;
  readonly workflowId: string;
  readonly status: WorkflowControlPlaneSessionStatus;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly queue: readonly string[];
  readonly currentNodeId?: string | null;
  readonly currentStepId?: string | null;
  readonly nodeExecutionCounter: number;
  readonly nodeExecutionCounts: Readonly<Record<string, number>>;
  readonly loopIterationCounts?: Readonly<Record<string, number>>;
  readonly restartCounts?: Readonly<Record<string, number>>;
  readonly restartEvents: readonly unknown[];
  readonly transitions: readonly WorkflowControlPlaneSessionTransition[];
  readonly nodeExecutions: readonly WorkflowControlPlaneNodeExecutionRecord[];
  readonly communicationCounter: number;
  readonly communications: readonly WorkflowControlPlaneCommunicationRecord[];
  readonly conversationTurns: readonly unknown[];
  readonly nodeBackendSessions: readonly unknown[];
  readonly fanoutGroups?: readonly unknown[];
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly lastError?: string;
  readonly supervision?: WorkflowControlPlaneSupervisionState;
}

export function projectWorkflowSessionStateToControlPlaneSession(
  session: unknown,
): WorkflowControlPlaneSession {
  const projected = session as WorkflowControlPlaneSession;
  return {
    ...projected,
    queue: projected.queue,
    restartEvents: projected.restartEvents,
    transitions: projected.transitions,
    nodeExecutions: projected.nodeExecutions,
    communications: projected.communications,
    conversationTurns: projected.conversationTurns,
    nodeBackendSessions: projected.nodeBackendSessions,
    runtimeVariables: projected.runtimeVariables,
  };
}

export function projectControlPlaneSessionToWorkflowSessionState<T>(
  session: WorkflowControlPlaneSession,
): T {
  const projected = {
    ...session,
    queue: session.queue,
    restartEvents: session.restartEvents,
    transitions: session.transitions,
    nodeExecutions: session.nodeExecutions,
    communications: session.communications,
    conversationTurns: session.conversationTurns,
    nodeBackendSessions: session.nodeBackendSessions,
    runtimeVariables: session.runtimeVariables,
  };
  return projected as unknown as T;
}

export function projectControlPlaneNodeExecutionRecord<T>(record: unknown): T {
  return record as T;
}

export interface GraphqlRuntimeNodeExecutionSummary {
  readonly sessionId: string;
  readonly nodeExecId: string;
  readonly nodeId: string;
  readonly stepId?: string | null;
  readonly nodeRegistryId?: string | null;
  readonly mailboxInstanceId?: string | null;
  readonly status: string;
  readonly artifactDir: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly attempt: number | null;
  readonly outputAttemptCount: number | null;
  readonly outputValidationErrors:
    | readonly {
        readonly path: string;
        readonly message: string;
      }[]
    | null;
  readonly promptVariant?: string | null;
  readonly timeoutMs?: number | null;
  readonly backendSessionMode: "new" | "reuse" | null;
  readonly backendSessionId: string | null;
  readonly restartedFromNodeExecId: string | null;
  readonly executionOrdinal: number | null;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly inputJson: string;
  readonly outputJson: string;
  readonly createdAt: string;
}

export interface GraphqlRuntimeNodeLogEntry {
  readonly id: number;
  readonly sessionId: string;
  readonly nodeExecId: string | null;
  readonly nodeId: string | null;
  readonly level: string;
  readonly message: string;
  readonly payloadJson: string | null;
  readonly at: string;
}

export interface GraphqlRuntimeLlmSessionMessageRecord {
  readonly id: number;
  readonly sessionId: string;
  readonly nodeExecId: string;
  readonly nodeId: string;
  readonly provider: string;
  readonly model: string;
  readonly backendSessionId: string | null;
  readonly ordinal: number;
  readonly role: string | null;
  readonly eventType: string;
  readonly contentText: string | null;
  readonly rawMessageJson: string | null;
  readonly at: string;
}

export interface GraphqlRuntimeHookEventRecord {
  readonly hookEventId: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly managerSessionId: string | null;
  readonly vendor: string;
  readonly agentSessionId: string;
  readonly rawEventName: string;
  readonly eventName: string;
  readonly cwd: string;
  readonly transcriptPath: string | null;
  readonly model: string | null;
  readonly turnId: string | null;
  readonly payloadHash: string;
  readonly payloadRefJson: string | null;
  readonly responseJson: string | null;
  readonly status: string;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GraphqlRuntimeEventReplyDispatchRecord {
  readonly idempotencyKey: string;
  readonly sourceId: string;
  readonly provider: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly eventId: string;
  readonly conversationId: string;
  readonly threadId: string | null;
  readonly actorId: string | null;
  readonly status: string;
  readonly dispatchId: string | null;
  readonly providerMessageId: string | null;
  readonly requestJson: string;
  readonly responseJson: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowSelfImproveSourceRunDto {
  readonly sessionId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly status: string;
  readonly startedAt?: string;
  readonly updatedAt?: string;
  readonly artifactDir?: string;
  readonly lastError?: string;
  readonly nodeExecutions?: readonly WorkflowSelfImproveSourceNodeExecutionDto[];
}

export interface WorkflowSelfImproveSourceNodeExecutionDto {
  readonly nodeId: string;
  readonly stepId?: string;
  readonly nodeExecId: string;
  readonly status: string;
  readonly artifactDir: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly outputAttemptCount?: number;
  readonly outputValidationErrors?: readonly {
    readonly path: string;
    readonly message: string;
  }[];
}

export interface WorkflowSelfImproveFindingDto {
  readonly severity: "high" | "mid" | "low";
  readonly category: "purpose" | "structure" | "prompt" | "runtime";
  readonly message: string;
  readonly evidenceSessionIds: readonly string[];
  readonly stepIds?: readonly string[];
  readonly nodeIds?: readonly string[];
}

export interface WorkflowSelfImproveResultDto {
  readonly selfImproveId: string;
  readonly workflowName: string;
  readonly workflowId: string;
  readonly reportPath: string;
  readonly markdownReportPath: string;
  readonly inputRunsPath: string;
  readonly backupPath?: string;
  readonly selectedSourceRuns: readonly WorkflowSelfImproveSourceRunDto[];
  readonly findings: readonly WorkflowSelfImproveFindingDto[];
  readonly purposeAchievement: string;
  readonly patchStatus: string;
  readonly validationStatus: string;
  readonly gitCommitStatus: string;
  readonly gitCommitHash?: string;
}
