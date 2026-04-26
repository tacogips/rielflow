import { createHash, randomBytes } from "node:crypto";
import type { AdapterExecutionInput } from "./adapter";
import {
  findOwningSubWorkflowByRuntimeNodeId,
  type StepIdentityFields,
  toStepIdentityFields,
} from "./runtime-addressing";
import type {
  AgentNodePayload,
  SupervisionRunState,
  WorkflowJson,
} from "./types";

export type SessionStatus =
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export function isTerminalWorkflowSessionStatus(
  status: SessionStatus,
): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

export interface SessionTransition {
  readonly from: string;
  readonly to: string;
  readonly when: string;
}

export interface NodeExecutionRecord extends StepIdentityFields {
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly mailboxInstanceId?: string;
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
  readonly promptVariant?: string;
  readonly timeoutMs?: number;
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
  readonly outputStepId?: string;
  readonly nodeRegistryId?: string;
  readonly nodeExecId: string;
  readonly mailboxInstanceId?: string;
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

export interface NodeBackendSessionRecord extends StepIdentityFields {
  readonly nodeId: string;
  readonly sourceStepId?: string;
  readonly lastStepId?: string;
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
  /** Present when the session is part of an auto-improve / superviser cycle. */
  readonly supervision?: SupervisionRunState;
}

function toOutputRefIdentityFields(
  input: StepIdentityFields,
): Pick<OutputRef, "outputStepId" | "nodeRegistryId"> {
  const stepIdentityFields = toStepIdentityFields(input);
  return {
    ...(stepIdentityFields.stepId === undefined
      ? {}
      : { outputStepId: stepIdentityFields.stepId }),
    ...(stepIdentityFields.nodeRegistryId === undefined
      ? {}
      : { nodeRegistryId: stepIdentityFields.nodeRegistryId }),
  };
}

export function buildOutputRefForExecution(input: {
  readonly workflow: WorkflowJson;
  readonly session: Pick<WorkflowSessionState, "sessionId" | "workflowId">;
  readonly execution: NodeExecutionRecord;
  readonly runtimeNodeId?: string;
}): OutputRef {
  const runtimeNodeId = input.runtimeNodeId ?? input.execution.nodeId;
  const owningSubWorkflow = findOwningSubWorkflowByRuntimeNodeId(
    input.workflow,
    runtimeNodeId,
  );
  return {
    kind: "node-output",
    workflowExecutionId: input.session.sessionId,
    workflowId: input.session.workflowId,
    ...(owningSubWorkflow === undefined
      ? {}
      : { subWorkflowId: owningSubWorkflow.id }),
    outputNodeId: runtimeNodeId,
    ...toOutputRefIdentityFields(input.execution),
    nodeExecId: input.execution.nodeExecId,
    ...(input.execution.mailboxInstanceId === undefined
      ? {}
      : { mailboxInstanceId: input.execution.mailboxInstanceId }),
    artifactDir: input.execution.artifactDir,
  };
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
    ...(session.supervision === undefined
      ? {}
      : {
          supervision: {
            ...session.supervision,
            incidents: [...session.supervision.incidents],
            ...(session.supervision.remediations === undefined
              ? {}
              : { remediations: [...session.supervision.remediations] }),
          },
        }),
  };
}

export function resolveCurrentStepId(
  session: Pick<WorkflowSessionState, "currentNodeId" | "nodeExecutions">,
): string | null {
  if (session.currentNodeId === undefined) {
    return null;
  }

  const currentExecution = [...session.nodeExecutions]
    .reverse()
    .find(
      (execution) =>
        execution.nodeId === session.currentNodeId ||
        execution.stepId === session.currentNodeId,
    );
  if (currentExecution?.stepId !== undefined) {
    return currentExecution.stepId;
  }

  return session.nodeExecutions.some(
    (execution) => execution.stepId === session.currentNodeId,
  )
    ? session.currentNodeId
    : null;
}

export function resolveCurrentStepIdFromWorkflow(
  session: Pick<WorkflowSessionState, "currentNodeId" | "nodeExecutions">,
  workflow: Pick<WorkflowJson, "steps"> | undefined,
): string | null {
  const currentStepId = resolveCurrentStepId(session);
  if (currentStepId !== null) {
    return currentStepId;
  }
  if (
    session.currentNodeId === undefined ||
    workflow?.steps?.some((step) => step.id === session.currentNodeId) !== true
  ) {
    return null;
  }
  return session.currentNodeId;
}

function resolveBackendSessionSourceStepId(
  record: NodeBackendSessionRecord,
): string | undefined {
  return record.sourceStepId ?? record.stepId ?? record.nodeId;
}

function compareBackendSessionRecency(
  left: NodeBackendSessionRecord,
  right: NodeBackendSessionRecord,
): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

export function resolveRequestedBackendSession(
  input: {
    readonly session: WorkflowSessionState;
    readonly node: AgentNodePayload;
    readonly sessionLookupNodeId?: string;
    readonly inheritFromStepId?: string;
  } & StepIdentityFields,
): AdapterExecutionInput["backendSession"] | undefined {
  if (input.node.sessionPolicy === undefined) {
    return undefined;
  }

  if (input.node.sessionPolicy.mode === "new") {
    return { mode: "new" };
  }

  if (input.node.executionBackend === undefined) {
    return { mode: "new" };
  }

  const compatibleSessions = Object.values(
    input.session.nodeBackendSessions ?? {},
  )
    .filter((record) => record.backend === input.node.executionBackend)
    .filter((record) =>
      input.nodeRegistryId === undefined
        ? record.nodeId === (input.sessionLookupNodeId ?? input.node.id)
        : record.nodeRegistryId === input.nodeRegistryId ||
          (record.nodeRegistryId === undefined &&
            record.nodeId === (input.sessionLookupNodeId ?? input.node.id)),
    );

  const selected =
    input.inheritFromStepId === undefined
      ? compatibleSessions.sort(compareBackendSessionRecency)[0]
      : compatibleSessions
          .filter(
            (record) =>
              resolveBackendSessionSourceStepId(record) ===
              input.inheritFromStepId,
          )
          .sort(compareBackendSessionRecency)[0];
  if (selected === undefined) {
    return { mode: "new" };
  }

  return {
    mode: "reuse",
    sessionId: selected.sessionId,
  };
}

export function persistNodeBackendSession(
  input: {
    readonly session: WorkflowSessionState;
    readonly node: AgentNodePayload;
    readonly nodeExecId: string;
    readonly provider: string;
    readonly endedAt: string;
    readonly backendSession: AdapterExecutionInput["backendSession"];
    readonly returnedSessionId?: string;
    readonly inheritFromStepId?: string;
  } & StepIdentityFields,
): Readonly<Record<string, NodeBackendSessionRecord>> {
  const current = { ...(input.session.nodeBackendSessions ?? {}) };
  if (input.node.sessionPolicy?.mode !== "reuse") {
    return current;
  }

  const sessionId = input.returnedSessionId ?? input.backendSession?.sessionId;
  if (sessionId === undefined) {
    return current;
  }

  if (input.node.executionBackend === undefined) {
    return current;
  }

  const recordKey = input.stepId ?? input.node.id;
  const existing = current[recordKey];
  const sourceStepId =
    input.inheritFromStepId ??
    existing?.sourceStepId ??
    existing?.stepId ??
    input.stepId;
  current[recordKey] = {
    nodeId: recordKey,
    ...toStepIdentityFields(input),
    ...(sourceStepId === undefined ? {} : { sourceStepId }),
    ...(input.stepId === undefined ? {} : { lastStepId: input.stepId }),
    backend: input.node.executionBackend,
    provider: input.provider,
    sessionId,
    createdAt: existing?.createdAt ?? input.endedAt,
    updatedAt: input.endedAt,
    lastNodeExecId: input.nodeExecId,
  };
  return current;
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
