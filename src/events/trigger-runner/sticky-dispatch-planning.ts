import type { DivedraOptions, WorkflowExecutionClientOptions } from "../../lib";
import { withResolvedWorkflowSourceOptions } from "../../workflow/catalog";
import { loadWorkflowFromCatalog } from "../../workflow/load";
import type { WorkflowSessionState } from "../../workflow/session";
import { loadSession, saveSession } from "../../workflow/session-store";
import type { WorkflowSupervisorDispatchView } from "../../workflow/supervisor-dispatch-client";
import {
  getNormalizedNodePayload,
  resolveWorkflowManagerStepId,
} from "../../workflow/types";
import {
  deleteEventWorkflowSessionStickiness,
  loadEventWorkflowSessionStickiness,
  saveEventWorkflowSessionStickiness,
} from "../session-stickiness";
import type { SupervisorIntentResolution } from "../supervisor-intent";
import type {
  EventBinding,
  EventReceiptRecord,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "../types";
import type { WorkflowTriggerRunnerOptions } from "../workflow-trigger-runner-options";

export interface WorkflowTriggerDispatchInput {
  readonly binding: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly source?: EventSourceConfig;
  readonly raw?: unknown;
  /** When set, the precomputed supervisor intent is used instead of resolving dynamically. */
  readonly supervisorIntentOverride?: SupervisorIntentResolution;
  /** When set, the dispatch is skipped with this reason (precomputed ambiguity). */
  readonly supervisorIntentPrecheckSkip?: { readonly reason: string };
  /**
   * When true, skips provider chat replies for this dispatch so a router-level
   * handler can emit a single clarification (e.g. destructive LLM ambiguity).
   */
  readonly suppressSupervisorChatReply?: boolean;
}
export interface WorkflowTriggerResult {
  readonly receipt: EventReceiptRecord;
  readonly duplicate: boolean;
  readonly workflowName?: string;
  readonly workflowExecutionId?: string;
  readonly supervisedRunId?: string;
  readonly supervisorExecutionId?: string;
  readonly supervisorConversationId?: string;
  readonly supervisorDecisionId?: string;
}
export interface WorkflowTriggerRunner {
  dispatch(input: WorkflowTriggerDispatchInput): Promise<WorkflowTriggerResult>;
}
export function workflowExecutionIdFromDispatchView(
  view: WorkflowSupervisorDispatchView,
): string | undefined {
  const selectedId = view.conversation.selectedManagedRunId;
  if (selectedId !== undefined) {
    const selectedRun = view.managedRuns.find(
      (r) => r.managedRunId === selectedId,
    );
    if (selectedRun?.activeTargetExecutionId !== undefined) {
      return selectedRun.activeTargetExecutionId;
    }
  }
  for (const run of view.managedRuns) {
    if (
      (run.status === "running" || run.status === "starting") &&
      run.activeTargetExecutionId !== undefined
    ) {
      return run.activeTargetExecutionId;
    }
  }
  return undefined;
}
export function workflowNameFromDispatchView(
  view: WorkflowSupervisorDispatchView,
  workflowExecutionId: string | undefined,
): string {
  if (workflowExecutionId === undefined) {
    return view.conversation.supervisorWorkflowName;
  }
  const run = view.managedRuns.find(
    (r) => r.activeTargetExecutionId === workflowExecutionId,
  );
  return run?.targetWorkflowName ?? view.conversation.supervisorWorkflowName;
}
export interface StickyRootManagerContext {
  readonly workflowId: string;
  readonly workflowName: string;
  /** Manager step id in the workflow bundle (same id namespace as `workflow.steps[].id`). */
  readonly managerStepId: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly options: DivedraOptions;
}
export interface StickyDispatchPlan {
  readonly sessionId: string;
  readonly options: DivedraOptions;
}
export type StickyDispatchResolution =
  | { readonly outcome: "resume"; readonly plan: StickyDispatchPlan }
  | { readonly outcome: "proceed-without-resume" }
  | { readonly outcome: "blocked-active-user-actions" };
export function stickinessLookupKeyFromContext(ctx: StickyRootManagerContext): {
  readonly workflowId: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly conversationId: string;
  readonly threadId?: string;
} {
  return {
    workflowId: ctx.workflowId,
    sourceId: ctx.sourceId,
    bindingId: ctx.bindingId,
    conversationId: ctx.conversationId,
    ...(ctx.threadId === undefined ? {} : { threadId: ctx.threadId }),
  };
}
export function dedupeNodeIds(nodeIds: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const nodeId of nodeIds) {
    if (seen.has(nodeId)) {
      continue;
    }
    seen.add(nodeId);
    deduped.push(nodeId);
  }
  return deduped;
}
export function isStickyReuseBlockedSession(
  session: WorkflowSessionState,
): boolean {
  return session.status === "failed" || session.status === "cancelled";
}
export function isStickyPersistableStatus(status: string): boolean {
  return status === "running" || status === "paused" || status === "completed";
}
export function workflowNameResultField(
  workflowName: string | undefined,
): { readonly workflowName: string } | Record<string, never> {
  const trimmed = workflowName?.trim();
  return trimmed !== undefined && trimmed.length > 0
    ? { workflowName: trimmed }
    : {};
}
export async function resolveStickyRootManagerContext(input: {
  readonly binding: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly options: WorkflowTriggerRunnerOptions;
}): Promise<StickyRootManagerContext | null> {
  if (input.options.endpoint !== undefined) {
    return null;
  }
  const conversationId = input.event.conversation?.id;
  if (conversationId === undefined) {
    return null;
  }

  const catalogWorkflowName = input.binding.workflowName?.trim();
  if (catalogWorkflowName === undefined || catalogWorkflowName.length === 0) {
    return null;
  }

  const loaded = await loadWorkflowFromCatalog(
    catalogWorkflowName,
    input.options,
  );
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }

  const managerStepId = resolveWorkflowManagerStepId(
    loaded.value.bundle.workflow,
  );
  const managerNode = getNormalizedNodePayload(
    loaded.value.bundle,
    managerStepId,
  );
  if (managerNode?.sessionPolicy?.mode !== "reuse") {
    return null;
  }

  const stickyOptions =
    loaded.value.source === undefined
      ? input.options
      : withResolvedWorkflowSourceOptions(loaded.value.source, input.options);
  return {
    workflowId: loaded.value.bundle.workflow.workflowId,
    workflowName: catalogWorkflowName,
    managerStepId,
    sourceId: input.event.sourceId,
    bindingId: input.binding.id,
    conversationId,
    ...(input.event.conversation?.threadId === undefined
      ? {}
      : { threadId: input.event.conversation.threadId }),
    options: stickyOptions,
  };
}
export async function clearStickySessionBinding(
  stickyContext: StickyRootManagerContext,
): Promise<void> {
  await deleteEventWorkflowSessionStickiness(
    stickinessLookupKeyFromContext(stickyContext),
    stickyContext.options,
  );
}
export async function resolveStickyDispatchResolution(input: {
  readonly stickyContext: StickyRootManagerContext | null;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
}): Promise<StickyDispatchResolution> {
  const { stickyContext } = input;
  if (stickyContext === null) {
    return { outcome: "proceed-without-resume" };
  }
  const stickyRecord = await loadEventWorkflowSessionStickiness(
    stickinessLookupKeyFromContext(stickyContext),
    stickyContext.options,
  );
  if (stickyRecord === null) {
    return { outcome: "proceed-without-resume" };
  }

  const existing = await loadSession(
    stickyRecord.sessionId,
    stickyContext.options,
  );
  if (!existing.ok) {
    await clearStickySessionBinding(stickyContext);
    return { outcome: "proceed-without-resume" };
  }
  if (
    existing.value.workflowName !== stickyContext.workflowName ||
    isStickyReuseBlockedSession(existing.value)
  ) {
    await clearStickySessionBinding(stickyContext);
    return { outcome: "proceed-without-resume" };
  }
  if ((existing.value.activeUserActions?.length ?? 0) > 0) {
    return { outcome: "blocked-active-user-actions" };
  }

  const {
    endedAt: _endedAt,
    lastError: _lastError,
    ...resumable
  } = existing.value;
  const updatedSession: WorkflowSessionState = {
    ...resumable,
    status: "running",
    queue: dedupeNodeIds([
      stickyContext.managerStepId,
      ...existing.value.queue,
    ]),
    currentNodeId: stickyContext.managerStepId,
    runtimeVariables: {
      ...existing.value.runtimeVariables,
      ...input.runtimeVariables,
    },
  };
  const saved = await saveSession(updatedSession, stickyContext.options);
  if (!saved.ok) {
    throw new Error(saved.error.message);
  }
  return {
    outcome: "resume",
    plan: {
      sessionId: updatedSession.sessionId,
      options: stickyContext.options,
    },
  };
}
export async function persistStickySessionBinding(input: {
  readonly stickyContext: StickyRootManagerContext | null;
  readonly workflowExecutionId: string;
  readonly workflowStatus: string;
}): Promise<void> {
  const { stickyContext } = input;
  if (stickyContext === null) {
    return;
  }
  if (!isStickyPersistableStatus(input.workflowStatus)) {
    await clearStickySessionBinding(stickyContext);
    return;
  }
  await saveEventWorkflowSessionStickiness(
    {
      ...stickinessLookupKeyFromContext(stickyContext),
      workflowName: stickyContext.workflowName,
      sessionId: input.workflowExecutionId,
      updatedAt: new Date().toISOString(),
    },
    stickyContext.options,
  );
}
export function buildWorkflowExecutionClientOptions(
  workflowName: string,
  options: WorkflowTriggerRunnerOptions,
): WorkflowExecutionClientOptions {
  const {
    readOnly: _readOnly,
    dryRun: _dryRun,
    maxSteps: _maxSteps,
    maxLoopIterations: _maxLoopIterations,
    defaultTimeoutMs: _defaultTimeoutMs,
    mockScenario: _mockScenario,
    ...divedraAndTransportOptions
  } = options;
  return { workflowName, ...divedraAndTransportOptions };
}
export function workflowTriggerLocalEngineOverrides(
  options: WorkflowTriggerRunnerOptions,
): Pick<
  WorkflowTriggerRunnerOptions,
  | "mockScenario"
  | "dryRun"
  | "maxSteps"
  | "maxConcurrency"
  | "maxLoopIterations"
  | "defaultTimeoutMs"
  | "scheduledEventManager"
> {
  return {
    ...(options.mockScenario === undefined
      ? {}
      : { mockScenario: options.mockScenario }),
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
    ...(options.maxConcurrency === undefined
      ? {}
      : { maxConcurrency: options.maxConcurrency }),
    ...(options.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: options.maxLoopIterations }),
    ...(options.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: options.defaultTimeoutMs }),
    ...(options.scheduledEventManager === undefined
      ? {}
      : { scheduledEventManager: options.scheduledEventManager }),
  };
}
