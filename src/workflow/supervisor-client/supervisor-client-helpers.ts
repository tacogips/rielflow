import type { SupervisedRunCorrelationKey } from "../../events/supervised-runs";
import { resolveSupervisedRunArtifactDir } from "../../events/supervised-runs";
import type {
  EventBinding,
  EventSupervisedRunRecord,
  EventSupervisedRunStatus,
  EventSupervisorCommand,
} from "../../events/types";
import { listRuntimeNodeExecutions, listRuntimeNodeLogs } from "../runtime-db";
import type { WorkflowSessionState } from "../session";
import { loadSession, saveSession } from "../session-store";
import type {
  SupervisedWorkflowCommandResult,
  SupervisedWorkflowView,
  SupervisorEngineOverrides,
} from "../supervisor-client-types";
import type { LoadOptions } from "../types";

export function nowIso(): string {
  return new Date().toISOString();
}

export function isTerminalTargetStatus(
  status: WorkflowSessionState["status"],
): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

export function localEngineOverrides(
  input: SupervisorEngineOverrides | undefined,
): Pick<
  SupervisorEngineOverrides,
  | "mockScenario"
  | "dryRun"
  | "maxSteps"
  | "maxLoopIterations"
  | "defaultTimeoutMs"
> {
  if (input === undefined) {
    return {};
  }
  return {
    ...(input.mockScenario === undefined
      ? {}
      : { mockScenario: input.mockScenario }),
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
    ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
    ...(input.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: input.maxLoopIterations }),
    ...(input.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: input.defaultTimeoutMs }),
  };
}

export function asyncEngineObserver(
  input: SupervisorEngineOverrides | undefined,
): Pick<SupervisorEngineOverrides, "asyncRun" | "onAsyncRun"> {
  if (input === undefined) {
    return {};
  }
  return {
    ...(input.asyncRun === undefined ? {} : { asyncRun: input.asyncRun }),
    ...(input.onAsyncRun === undefined ? {} : { onAsyncRun: input.onAsyncRun }),
  };
}

export function mergeRuntimeVariables(
  base: Readonly<Record<string, unknown>>,
  overlay?: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (overlay === undefined) {
    return base;
  }
  return { ...base, ...overlay };
}

export function resolveRerunFromStepId(
  command: EventSupervisorCommand,
): string | undefined {
  const firstArg = command.args?.[0]?.trim();
  return firstArg === undefined || firstArg.length === 0 ? undefined : firstArg;
}

export function resolvePublicCommandId(input: {
  readonly idempotencyKey: string | undefined;
  readonly prefix: string;
  readonly scope: string;
}): string {
  if (input.idempotencyKey !== undefined && input.idempotencyKey.length > 0) {
    return input.idempotencyKey;
  }
  return `${input.prefix}-${nowIso()}-${input.scope}`;
}

export function requireNonEmptyLookupValue(
  value: string | undefined,
  label: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export function normalizeSupervisorLifecycleAction(
  action: EventSupervisorCommand["action"],
):
  | "start"
  | "status"
  | "progress"
  | "inbox"
  | "logs"
  | "stop"
  | "restart"
  | "input" {
  if (action === "status") {
    return "status";
  }
  if (action === "progress") {
    return "progress";
  }
  if (action === "inbox" || action === "read") {
    return "inbox";
  }
  if (action === "logs" || action === "export") {
    return "logs";
  }
  if (action === "stop" || action === "cancel") {
    return "stop";
  }
  if (action === "restart" || action === "rerun") {
    return "restart";
  }
  if (action === "input" || action === "submit" || action === "resume") {
    return "input";
  }
  return "start";
}

export async function cancelTargetSession(
  sessionId: string,
  options: LoadOptions,
): Promise<void> {
  const loaded = await loadSession(sessionId, options);
  if (!loaded.ok) {
    return;
  }
  if (isTerminalTargetStatus(loaded.value.status)) {
    return;
  }
  const cancelled: WorkflowSessionState = {
    ...loaded.value,
    status: "cancelled",
    endedAt: nowIso(),
    lastError: "cancelled by event supervisor",
  };
  const saved = await saveSession(cancelled, options);
  if (!saved.ok) {
    throw new Error(saved.error.message);
  }
}

export function eventBindingStubFromSupervisedRunRecord(
  record: EventSupervisedRunRecord,
): EventBinding {
  return {
    id: record.bindingId,
    sourceId: record.sourceId,
    workflowName: record.targetWorkflowName,
    inputMapping: { mode: "event-input" },
    execution: {
      mode: "supervised",
      supervisorWorkflowName: record.supervisorWorkflowName,
      maxRestartsOnFailure: record.maxRestartsOnFailure,
      autoImprove: record.autoImproveEnabled,
    },
  };
}

export function viewFrom(
  record: EventSupervisedRunRecord,
  activeTargetStatus?: WorkflowSessionState["status"],
  commandResult?: SupervisedWorkflowCommandResult,
): SupervisedWorkflowView {
  return {
    supervisedRun: record,
    ...(activeTargetStatus === undefined ? {} : { activeTargetStatus }),
    ...(commandResult === undefined ? {} : { commandResult }),
  };
}

export async function activeTargetStatusFor(
  record: EventSupervisedRunRecord,
  options: LoadOptions,
): Promise<WorkflowSessionState["status"] | undefined> {
  const id = record.activeTargetExecutionId;
  if (id === undefined) {
    return undefined;
  }
  const loaded = await loadSession(id, options);
  if (!loaded.ok) {
    return undefined;
  }
  return loaded.value.status;
}

export async function loadActiveTargetSession(
  record: EventSupervisedRunRecord,
  options: LoadOptions,
): Promise<WorkflowSessionState | undefined> {
  const id = record.activeTargetExecutionId;
  if (id === undefined) {
    return undefined;
  }
  const loaded = await loadSession(id, options);
  return loaded.ok ? loaded.value : undefined;
}

export async function buildSupervisorInspectionCommandResult(
  action: "status" | "progress" | "inbox" | "logs",
  record: EventSupervisedRunRecord,
  options: LoadOptions,
): Promise<SupervisedWorkflowCommandResult> {
  const session = await loadActiveTargetSession(record, options);
  const workflowExecutionId = record.activeTargetExecutionId;
  if (action === "status") {
    return {
      kind: "status",
      ...(workflowExecutionId === undefined ? {} : { workflowExecutionId }),
      ...(session === undefined ? {} : { targetStatus: session.status }),
    };
  }
  if (action === "progress") {
    return {
      kind: "progress",
      ...(workflowExecutionId === undefined ? {} : { workflowExecutionId }),
      ...(session === undefined
        ? {}
        : {
            targetStatus: session.status,
            ...(session.currentNodeId === undefined
              ? {}
              : { currentStepId: session.currentNodeId }),
          }),
      queuedStepIds: session?.queue ?? [],
      completedStepCount:
        session?.nodeExecutions.filter((entry) => entry.status === "succeeded")
          .length ?? 0,
      nodeExecutionCount: session?.nodeExecutions.length ?? 0,
    };
  }
  if (action === "inbox") {
    const pending = session?.activeUserActions ?? [];
    return {
      kind: "inbox",
      ...(workflowExecutionId === undefined ? {} : { workflowExecutionId }),
      pendingUserActionCount: pending.length,
      pendingUserActions: pending.map((entry) => ({
        nodeId: entry.nodeId,
        nodeExecId: entry.nodeExecId,
        userActionId: entry.userActionId,
        pausedAt: entry.pausedAt,
      })),
    };
  }
  const nodeExecutions =
    workflowExecutionId === undefined
      ? []
      : await listRuntimeNodeExecutions(workflowExecutionId, options);
  const logs =
    workflowExecutionId === undefined
      ? []
      : await listRuntimeNodeLogs(workflowExecutionId, options);
  return {
    kind: "logs",
    ...(workflowExecutionId === undefined ? {} : { workflowExecutionId }),
    nodeExecutionCount: nodeExecutions.length,
    runtimeLogCount: logs.length,
    recentLogs: logs.slice(-20).map((entry) => ({
      level: entry.level,
      message: entry.message,
      nodeId: entry.nodeId,
      nodeExecId: entry.nodeExecId,
      at: entry.at,
    })),
    exportArtifactDir: resolveSupervisedRunArtifactDir(record, options),
  };
}

export async function reconcileTerminalSupervisedRunRecord(
  record: EventSupervisedRunRecord,
  repo: {
    readonly save: (
      record: EventSupervisedRunRecord,
      artifactDir: string,
    ) => Promise<void>;
  },
  options: LoadOptions,
): Promise<EventSupervisedRunRecord> {
  const sessionId = record.activeTargetExecutionId;
  if (sessionId === undefined) {
    return record;
  }
  if (
    record.status !== "starting" &&
    record.status !== "running" &&
    record.status !== "stopping" &&
    record.status !== "restarting"
  ) {
    return record;
  }
  const loaded = await loadSession(sessionId, options);
  if (!loaded.ok) {
    return record;
  }
  const st = loaded.value.status;
  if (!isTerminalTargetStatus(st)) {
    return record;
  }
  let nextStatus: EventSupervisedRunStatus;
  if (st === "completed") {
    nextStatus = "completed";
  } else if (st === "failed") {
    nextStatus = "failed";
  } else {
    nextStatus = "stopped";
  }
  const { activeTargetExecutionId: _omit, ...persistable } = record;
  const updated: EventSupervisedRunRecord = {
    ...persistable,
    status: nextStatus,
    updatedAt: nowIso(),
  };
  const dir = resolveSupervisedRunArtifactDir(updated, options);
  await repo.save(updated, dir);
  return updated;
}

export async function reconcileTerminalSupervisedRunForCorrelation(
  correlation: SupervisedRunCorrelationKey,
  repo: {
    readonly findActiveByCorrelation: (
      input: SupervisedRunCorrelationKey,
    ) => Promise<EventSupervisedRunRecord | null>;
    readonly save: (
      record: EventSupervisedRunRecord,
      artifactDir: string,
    ) => Promise<void>;
  },
  options: LoadOptions,
): Promise<void> {
  const active = await repo.findActiveByCorrelation(correlation);
  if (active === null) {
    return;
  }
  await reconcileTerminalSupervisedRunRecord(active, repo, options);
}

export function assertSupervisedCommandBindingConsistency(input: {
  readonly command: EventSupervisorCommand;
  readonly binding: EventBinding;
}): void {
  if (input.binding.execution?.mode !== "supervised") {
    throw new Error(
      'supervisor command binding requires execution.mode "supervised"',
    );
  }
  if (input.command.sourceId !== input.binding.sourceId) {
    throw new Error(
      "supervisor command sourceId does not match binding.sourceId",
    );
  }
  if (input.command.bindingId !== input.binding.id) {
    throw new Error("supervisor command bindingId does not match binding.id");
  }
  if (input.command.targetWorkflowName !== input.binding.workflowName) {
    throw new Error(
      "supervisor command targetWorkflowName does not match binding.workflowName",
    );
  }
}
