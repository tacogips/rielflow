import { createHash, randomBytes } from "node:crypto";
import type { AdapterExecutionInput } from "./adapter";
import {
  type StepIdentityFields,
  toStepIdentityFields,
} from "./runtime-addressing";
import type {
  AgentNodePayload,
  SupervisionRunState,
  WorkflowFanoutFailurePolicy,
  WorkflowFanoutResultOrder,
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

/**
 * Persisted lineage mode for executions created by history-linked continuation.
 * See `design-docs/specs/design-step-run-history-rerun.md` (`continuationMode`).
 */
export type WorkflowContinuationMode =
  | "fresh-run"
  | "resume"
  | "rerun-from-history";

/**
 * One contiguous imported-history segment (oldest segments appear first overall).
 */
export interface HistoryImportSegment {
  readonly sourceWorkflowExecutionId: string;
  readonly throughStepRunId: string;
  readonly throughExecutionOrdinal: number;
}

export interface NodeExecutionRecord extends StepIdentityFields {
  readonly nodeId: string;
  readonly nodeExecId: string;
  /**
   * Monotonic ordinal within this workflow execution (`sessionId`).
   * Emitted together with increments to `nodeExecutionCounter`.
   *
   * Public inspection surfaces expose the same persisted id via `stepRunId` === `nodeExecId`.
   */
  readonly executionOrdinal?: number;
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

/** Operator-facing concrete step-run id aliases persisted {@link NodeExecutionRecord.nodeExecId}. */
export type StepRunId = NodeExecutionRecord["nodeExecId"];

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
  readonly fromManagerStepId: string;
  readonly toManagerStepId: string;
  readonly communicationId: string;
  readonly outputRef: OutputRef;
  readonly sentAt: string;
}

export interface NodeOutputRef {
  readonly kind?: "node-output";
  readonly workflowExecutionId: string;
  readonly workflowId: string;
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
  readonly outputNodeId: string;
  readonly nodeExecId: string;
  readonly artifactDir: string;
  readonly managerSessionId: string;
  readonly managerMessageId: string;
  readonly managerStepId: string;
  readonly managerNodeExecId: string;
}

export type CommunicationPayloadRef = OutputRef | ManagerMessagePayloadRef;

/** Discriminates in-execution graph delivery vs external mailbox boundary I/O. */
export type CommunicationRoutingScope = "intra-workflow" | "external-mailbox";

/**
 * Maps persisted `routingScope` values to the current enum. Only
 * `external-mailbox` is preserved; every other string (including labels from
 * removed structural routing models or typos) is coerced to `intra-workflow`.
 */
export function normalizeCommunicationRoutingScope(
  value: unknown,
): CommunicationRoutingScope {
  if (value === "external-mailbox") {
    return "external-mailbox";
  }
  return "intra-workflow";
}

export interface CommunicationRecord {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly communicationId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly routingScope: CommunicationRoutingScope;
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
  readonly owningManagerStepId: string;
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

export type FanoutBranchStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "paused";

export interface FanoutBranchRecord {
  readonly branchIndex: number;
  readonly item: unknown;
  readonly status: FanoutBranchStatus;
  readonly workItemId: string;
  readonly nodeExecIds?: readonly string[];
  readonly outputRef?: OutputRef;
  readonly error?: string;
  readonly workspaceRoot?: string;
  /**
   * When this branch was created as a retry of a prior fanout group execution,
   * records the workspace root from the superseded branch attempt so operators
   * can locate prior branch work for inspection and cleanup.
   */
  readonly supersededWorkspaceRoot?: string;
}

export interface FanoutGroupRunRecord {
  readonly fanoutGroupRunId: string;
  readonly groupId: string;
  readonly sourceStepId: string;
  readonly sourceNodeExecId: string;
  readonly transitionLabel?: string;
  readonly targetStepId: string;
  readonly targetWorkflowId?: string;
  readonly joinStepId: string;
  readonly concurrency: number;
  readonly failurePolicy: WorkflowFanoutFailurePolicy;
  readonly resultOrder: WorkflowFanoutResultOrder;
  readonly branches: readonly FanoutBranchRecord[];
}

export interface WorkflowSessionState {
  readonly sessionId: string;
  readonly workflowName: string;
  readonly workflowId: string;
  readonly status: SessionStatus;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly queue: readonly string[];
  /**
   * Active step id (`workflow.steps[].id`). Persisted JSON still uses this property name;
   * it is not a separate node-graph id.
   */
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
  readonly fanoutGroups?: readonly FanoutGroupRunRecord[];
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly lastError?: string;
  /** Present when the session is part of an auto-improve / superviser cycle. */
  readonly supervision?: SupervisionRunState;

  readonly continuedFromWorkflowExecutionId?: string;
  readonly continuedAfterStepRunId?: string;
  readonly continuedAfterExecutionOrdinal?: number;
  readonly continuedStartStepId?: string;
  readonly continuationMode?: WorkflowContinuationMode;
  readonly historyImports?: readonly HistoryImportSegment[];
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
  return {
    kind: "node-output",
    workflowExecutionId: input.session.sessionId,
    workflowId: input.session.workflowId,
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
  /** Entry step id seeded as the first `queue` entry. */
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

function isWorkflowContinuationMode(
  value: unknown,
): value is WorkflowContinuationMode {
  return (
    value === "fresh-run" ||
    value === "resume" ||
    value === "rerun-from-history"
  );
}

function coerceHistoryImports(
  raw: unknown,
): readonly HistoryImportSegment[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const segments: HistoryImportSegment[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const objectEntry = entry as Record<string, unknown>;
    const sourceWorkflowExecutionId = objectEntry["sourceWorkflowExecutionId"];
    const throughStepRunId = objectEntry["throughStepRunId"];
    const throughExecutionOrdinal = objectEntry["throughExecutionOrdinal"];
    if (
      typeof sourceWorkflowExecutionId !== "string" ||
      sourceWorkflowExecutionId.length === 0 ||
      typeof throughStepRunId !== "string" ||
      throughStepRunId.length === 0 ||
      typeof throughExecutionOrdinal !== "number" ||
      !Number.isInteger(throughExecutionOrdinal) ||
      throughExecutionOrdinal < 1
    ) {
      continue;
    }
    segments.push({
      sourceWorkflowExecutionId,
      throughStepRunId,
      throughExecutionOrdinal,
    });
  }
  return segments.length === 0 ? undefined : segments;
}

function assignStableExecutionOrdinals(
  executions: readonly NodeExecutionRecord[],
): readonly NodeExecutionRecord[] {
  if (executions.length === 0) {
    return executions;
  }
  const allDefined = executions.every(
    (execution) =>
      typeof execution.executionOrdinal === "number" &&
      Number.isInteger(execution.executionOrdinal) &&
      execution.executionOrdinal >= 1,
  );
  if (allDefined) {
    return [...executions].sort((left, right) => {
      const ordinalDiff = left.executionOrdinal! - right.executionOrdinal!;
      if (ordinalDiff !== 0) {
        return ordinalDiff;
      }
      return left.nodeExecId.localeCompare(right.nodeExecId);
    });
  }
  return executions.map((execution, ordinalIdx) => ({
    ...execution,
    executionOrdinal: ordinalIdx + 1,
  }));
}

/**
 * Workflow executions whose history may be loaded by reference when this session runs
 * (immediate parent plus every `historyImports` segment source).
 */
export function listContinuationReferencedWorkflowExecutionIds(
  session: WorkflowSessionState,
): readonly string[] {
  const ids = new Set<string>();
  if (session.continuedFromWorkflowExecutionId !== undefined) {
    ids.add(session.continuedFromWorkflowExecutionId);
  }
  if (session.historyImports !== undefined) {
    for (const segment of session.historyImports) {
      ids.add(segment.sourceWorkflowExecutionId);
    }
  }
  return [...ids];
}

export function sessionReferencesWorkflowExecutionAsContinuationSource(
  session: WorkflowSessionState,
  targetWorkflowExecutionId: string,
): boolean {
  if (session.continuedFromWorkflowExecutionId === targetWorkflowExecutionId) {
    return true;
  }
  return (
    session.historyImports?.some(
      (segment) =>
        segment.sourceWorkflowExecutionId === targetWorkflowExecutionId,
    ) ?? false
  );
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

  const historyImports = coerceHistoryImports(
    (session as { historyImports?: unknown }).historyImports,
  );
  const continuationMode =
    session.continuationMode === undefined
      ? undefined
      : isWorkflowContinuationMode(session.continuationMode)
        ? session.continuationMode
        : undefined;

  let next: WorkflowSessionState = {
    ...session,
    loopIterationCounts: { ...(session.loopIterationCounts ?? {}) },
    restartCounts: { ...(session.restartCounts ?? {}) },
    restartEvents: [...(session.restartEvents ?? [])],
    conversationTurns: (session.conversationTurns ?? []).map((turn) => ({
      ...turn,
    })),
    communicationCounter,
    communications: communications.map((communication) => ({
      ...communication,
      routingScope: normalizeCommunicationRoutingScope(
        communication.routingScope,
      ),
    })),
    nodeBackendSessions: { ...(session.nodeBackendSessions ?? {}) },
    pendingOptionalNodeDecisions: (
      session.pendingOptionalNodeDecisions ?? []
    ).map((decision) => ({ ...decision })),
    activeUserActions: [...(session.activeUserActions ?? [])],
    nodeExecutions: assignStableExecutionOrdinals(
      Array.isArray(session.nodeExecutions) ? session.nodeExecutions : [],
    ),
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

  next =
    historyImports === undefined
      ? (() => {
          const { historyImports: removedHistoryImports, ...remainder } = next;
          void removedHistoryImports;
          return remainder as WorkflowSessionState;
        })()
      : {
          ...next,
          historyImports,
        };

  next =
    continuationMode === undefined
      ? (() => {
          const { continuationMode: removedContinuationMode, ...remainder } =
            next;
          void removedContinuationMode;
          return remainder as WorkflowSessionState;
        })()
      : {
          ...next,
          continuationMode,
        };

  return next;
}

/**
 * Resolves the current step id from session state. Matches either `execution.stepId` or
 * `execution.nodeId` against `currentNodeId` because persisted execution rows may populate one or
 * both fields for the same runtime step.
 */
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
