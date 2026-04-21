import { createHash, randomBytes } from "node:crypto";

export type SessionStatus =
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface SessionTransition {
  readonly from: string;
  readonly to: string;
  readonly when: string;
}

export interface NodeExecutionRecord {
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly status:
    | "succeeded"
    | "failed"
    | "timed_out"
    | "cancelled"
    | "skipped";
  readonly artifactDir: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly attempt?: number;
  readonly outputAttemptCount?: number;
  readonly outputValidationErrors?: readonly {
    readonly path: string;
    readonly message: string;
  }[];
  readonly backendSessionId?: string;
  readonly backendSessionMode?: "new" | "reuse";
  readonly restartedFromNodeExecId?: string;
}

export interface NodeRestartEvent {
  readonly nodeId: string;
  readonly fromNodeExecId: string;
  readonly restartAttempt: number;
  readonly reason: "stuck_timeout";
  readonly at: string;
}

export interface ConversationTurnRecord {
  readonly conversationId: string;
  readonly turnIndex: number;
  readonly fromSubWorkflowId: string;
  readonly toSubWorkflowId: string;
  readonly fromManagerNodeId: string;
  readonly toManagerNodeId: string;
  readonly communicationId: string;
  readonly outputRef: OutputRef;
  readonly sentAt: string;
}

export interface NodeOutputRef {
  readonly kind?: "node-output";
  readonly workflowExecutionId: string;
  readonly workflowId: string;
  readonly subWorkflowId?: string;
  readonly outputNodeId: string;
  readonly nodeExecId: string;
  readonly artifactDir: string;
}

export type OutputRef = NodeOutputRef;

export interface ManagerMessagePayloadRef {
  readonly kind: "manager-message";
  readonly workflowExecutionId: string;
  readonly workflowId: string;
  readonly subWorkflowId?: string;
  readonly outputNodeId: string;
  readonly nodeExecId: string;
  readonly artifactDir: string;
  readonly managerSessionId: string;
  readonly managerMessageId: string;
  readonly managerNodeId: string;
  readonly managerNodeExecId: string;
}

export type CommunicationPayloadRef = OutputRef | ManagerMessagePayloadRef;

export interface CommunicationRecord {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly communicationId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly fromSubWorkflowId?: string;
  readonly toSubWorkflowId?: string;
  readonly routingScope:
    | "parent-to-sub-workflow"
    | "cross-sub-workflow"
    | "intra-sub-workflow"
    | "external-mailbox";
  readonly sourceNodeExecId: string;
  readonly payloadRef: CommunicationPayloadRef;
  readonly deliveryKind:
    | "edge-transition"
    | "loop-back"
    | "manual-rerun"
    | "conversation-turn"
    | "external-input"
    | "external-output";
  readonly transitionWhen: string;
  readonly status:
    | "created"
    | "delivered"
    | "consumed"
    | "delivery_failed"
    | "superseded";
  readonly deliveryAttemptIds: readonly string[];
  readonly activeDeliveryAttemptId?: string;
  readonly createdAt: string;
  readonly deliveredAt?: string;
  readonly consumedByNodeExecId?: string;
  readonly consumedAt?: string;
  readonly failureReason?: string;
  readonly supersededByCommunicationId?: string;
  readonly supersededAt?: string;
  readonly replayedFromCommunicationId?: string;
  readonly managerMessageId?: string;
  readonly artifactDir: string;
}

export interface NodeBackendSessionRecord {
  readonly nodeId: string;
  readonly backend: string;
  readonly provider: string;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastNodeExecId: string;
}

export interface PendingOptionalNodeDecision {
  readonly nodeId: string;
  readonly owningManagerNodeId: string;
  readonly subWorkflowId?: string;
  readonly requestedAt: string;
  readonly status: "pending" | "execute" | "skip";
  readonly reason?: string;
  readonly decidedAt?: string;
  readonly decidedByNodeExecId?: string;
}

export interface ActiveUserActionRef {
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly userActionId: string;
  readonly artifactDir: string;
  readonly status: "waiting-for-reply";
  readonly pausedAt: string;
}

export interface WorkflowSessionState {
  readonly sessionId: string;
  readonly workflowName: string;
  readonly workflowId: string;
  readonly status: SessionStatus;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly queue: readonly string[];
  readonly currentNodeId?: string;
  readonly nodeExecutionCounter: number;
  readonly nodeExecutionCounts: Readonly<Record<string, number>>;
  readonly loopIterationCounts?: Readonly<Record<string, number>>;
  readonly restartCounts?: Readonly<Record<string, number>>;
  readonly restartEvents?: readonly NodeRestartEvent[];
  readonly transitions: readonly SessionTransition[];
  readonly nodeExecutions: readonly NodeExecutionRecord[];
  readonly communicationCounter: number;
  readonly communications: readonly CommunicationRecord[];
  readonly conversationTurns?: readonly ConversationTurnRecord[];
  readonly nodeBackendSessions?: Readonly<
    Record<string, NodeBackendSessionRecord>
  >;
  readonly pendingOptionalNodeDecisions?: readonly PendingOptionalNodeDecision[];
  readonly activeUserActions?: readonly ActiveUserActionRef[];
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly lastError?: string;
}

export interface CreateSessionInput {
  readonly sessionId: string;
  readonly workflowName: string;
  readonly workflowId: string;
  readonly initialNodeId: string;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
}

export function createSessionState(
  input: CreateSessionInput,
): WorkflowSessionState {
  return {
    sessionId: input.sessionId,
    workflowName: input.workflowName,
    workflowId: input.workflowId,
    status: "running",
    startedAt: new Date().toISOString(),
    queue: [input.initialNodeId],
    nodeExecutionCounter: 0,
    nodeExecutionCounts: {},
    loopIterationCounts: {},
    restartCounts: {},
    restartEvents: [],
    transitions: [],
    nodeExecutions: [],
    communicationCounter: 0,
    communications: [],
    conversationTurns: [],
    nodeBackendSessions: {},
    pendingOptionalNodeDecisions: [],
    activeUserActions: [],
    runtimeVariables: input.runtimeVariables,
  };
}

export function normalizeSessionState(
  session: WorkflowSessionState,
): WorkflowSessionState {
  const communications = Array.isArray(session.communications)
    ? session.communications
    : [];
  const communicationCounter =
    Number.isInteger(session.communicationCounter) &&
    session.communicationCounter >= 0
      ? session.communicationCounter
      : communications.length;

  return {
    ...session,
    loopIterationCounts: { ...(session.loopIterationCounts ?? {}) },
    restartCounts: { ...(session.restartCounts ?? {}) },
    restartEvents: [...(session.restartEvents ?? [])],
    conversationTurns: [...(session.conversationTurns ?? [])],
    communicationCounter,
    communications: [...communications],
    nodeBackendSessions: { ...(session.nodeBackendSessions ?? {}) },
    pendingOptionalNodeDecisions: [
      ...(session.pendingOptionalNodeDecisions ?? []),
    ],
    activeUserActions: [...(session.activeUserActions ?? [])],
  };
}

export function isSafeSessionId(sessionId: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-_]{5,127}$/.test(sessionId);
}

function normalizeWorkflowSlug(workflowId: string): string {
  const normalized = workflowId
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return normalized.length > 0 ? normalized : "workflow";
}

export function createSessionId(
  input: {
    readonly workflowId?: string;
    readonly now?: Date;
  } = {},
): string {
  const now = input.now ?? new Date();
  const unixTime = String(Math.floor(now.getTime() / 1000));
  const workflowSlug = normalizeWorkflowSlug(input.workflowId ?? "workflow");
  const hash = createHash("sha256")
    .update(`${input.workflowId ?? "workflow"}:${unixTime}:`)
    .update(randomBytes(16).toString("hex"))
    .digest("hex")
    .slice(0, 8);
  const maxWorkflowSlugLength = Math.max(
    1,
    128 - `div--${unixTime}-${hash}`.length,
  );
  const safeWorkflowSlug = workflowSlug.slice(0, maxWorkflowSlugLength);
  return `div-${safeWorkflowSlug}-${unixTime}-${hash}`;
}
