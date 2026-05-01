import {
  createWorkflowExecutionClient,
  type DivedraOptions,
  type WorkflowExecutionClientOptions,
} from "../lib";
import { runWorkflow } from "../workflow/engine";
import { withResolvedWorkflowSourceOptions } from "../workflow/catalog";
import { loadWorkflowFromCatalog } from "../workflow/load";
import { saveSession, loadSession } from "../workflow/session-store";
import type { WorkflowSessionState } from "../workflow/session";
import {
  getNormalizedNodePayload,
  resolveWorkflowManagerStepId,
} from "../workflow/types";
import { isEventBindingEnabled, isEventSourceEnabled } from "./config";
import {
  deleteEventWorkflowSessionStickiness,
  loadEventWorkflowSessionStickiness,
  saveEventWorkflowSessionStickiness,
} from "./session-stickiness";
import {
  buildEventRuntimeMetadata,
  mapEventToWorkflowInput,
  selectMatchingBindings,
} from "./input-mapping";
import {
  buildControlStatusExternalOutputMessage,
  buildDispatchControlExternalOutputMessage,
} from "./supervisor-control-reply";
import { beginEventReceipt, updateEventReceipt } from "./ledger";
import { publishExternalOutputMessage } from "./external-output";
import { resolveEventMailboxBridgePolicy } from "./mailbox-bridge-policy";
import { resolveEventRoot } from "./config";
import {
  buildStableSupervisorCommandId,
  resolveSupervisedCorrelationKey,
} from "./supervisor-correlation";
import {
  resolveSupervisorIntentAsync,
  type SupervisorIntentResolution,
} from "./supervisor-intent";
import { createEventSupervisorRouter } from "./supervisor-router";
import {
  createWorkflowSupervisorClient,
  type SupervisedWorkflowView,
} from "../workflow/supervisor-client";
import { createWorkflowSupervisorGraphqlClient } from "../workflow/supervisor-graphql-client";
import { createWorkflowSupervisorDispatchClient } from "../workflow/supervisor-dispatch-client";
import type { WorkflowSupervisorDispatchView } from "../workflow/supervisor-dispatch-client";
import {
  planSupervisedLlmBindingsDispatch,
  type LlmBatchPlan,
} from "./supervisor-llm-batch";
import type {
  EventBinding,
  EventConfiguration,
  EventReceiptRecord,
  EventSourceConfig,
  EventSupervisorAction,
  ExternalEventEnvelope,
} from "./types";
import type { WorkflowTriggerRunnerOptions } from "./workflow-trigger-runner-options";

export type { WorkflowTriggerRunnerOptions } from "./workflow-trigger-runner-options";

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

async function dispatchSupervisorControlReplyIfConfigured(input: {
  readonly options: WorkflowTriggerRunnerOptions;
  readonly binding?: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly receiptId: string;
  readonly action: EventSupervisorAction | "skip" | "failed";
  readonly view?: SupervisedWorkflowView;
  readonly skipReason?: string;
}): Promise<void> {
  const dispatcher = input.options.eventReplyDispatcher;
  if (dispatcher === undefined) {
    return;
  }
  if (input.binding !== undefined) {
    const policy = resolveEventMailboxBridgePolicy(input.binding);
    if (policy.output.control.mode === "none") {
      return;
    }
  }
  const message = buildControlStatusExternalOutputMessage({
    event: input.event,
    receiptId: input.receiptId,
    action: input.action,
    ...(input.view === undefined ? {} : { view: input.view }),
    ...(input.skipReason === undefined ? {} : { skipReason: input.skipReason }),
  });
  if (message === null) {
    return;
  }
  const workflowId = message.address.workflowName ?? "event-supervisor";
  const workflowExecutionId =
    message.address.workflowExecutionId ??
    `supervisor-receipt:${input.receiptId}`;
  try {
    await publishExternalOutputMessage({
      dispatcher,
      message,
      workflowId,
      workflowExecutionId,
      nodeId: "event-supervisor-control",
      nodeExecId: input.receiptId,
      runtimeOptions: input.options,
    });
  } catch {
    // Best-effort: chat reply failures must not change receipt outcome.
  }
}

async function dispatchSupervisorDispatchReplyIfConfigured(input: {
  readonly options: WorkflowTriggerRunnerOptions;
  readonly binding?: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly receiptId: string;
  readonly view: WorkflowSupervisorDispatchView;
}): Promise<void> {
  const dispatcher = input.options.eventReplyDispatcher;
  if (dispatcher === undefined) {
    return;
  }
  if (input.binding !== undefined) {
    const policy = resolveEventMailboxBridgePolicy(input.binding);
    if (policy.output.control.mode === "none") {
      return;
    }
  }
  const message = buildDispatchControlExternalOutputMessage({
    event: input.event,
    receiptId: input.receiptId,
    view: input.view,
  });
  if (message === null) {
    return;
  }
  const workflowId = message.address.workflowName ?? "event-supervisor";
  const workflowExecutionId =
    message.address.workflowExecutionId ??
    `supervisor-dispatch:${input.receiptId}`;
  try {
    await publishExternalOutputMessage({
      dispatcher,
      message,
      workflowId,
      workflowExecutionId,
      nodeId: "event-supervisor-dispatch",
      nodeExecId: input.receiptId,
      runtimeOptions: input.options,
    });
  } catch {
    // Best-effort: chat reply failures must not change receipt outcome.
  }
}

function workflowExecutionIdFromDispatchView(
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

function workflowNameFromDispatchView(
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

interface StickyRootManagerContext {
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

interface StickyDispatchPlan {
  readonly sessionId: string;
  readonly options: DivedraOptions;
}

type StickyDispatchResolution =
  | { readonly outcome: "resume"; readonly plan: StickyDispatchPlan }
  | { readonly outcome: "proceed-without-resume" }
  | { readonly outcome: "blocked-active-user-actions" };

function stickinessLookupKeyFromContext(ctx: StickyRootManagerContext): {
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

function dedupeNodeIds(nodeIds: readonly string[]): readonly string[] {
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

function isStickyReuseBlockedSession(session: WorkflowSessionState): boolean {
  return session.status === "failed" || session.status === "cancelled";
}

function isStickyPersistableStatus(status: string): boolean {
  return status === "running" || status === "paused" || status === "completed";
}

function workflowNameResultField(
  workflowName: string | undefined,
): { readonly workflowName: string } | Record<string, never> {
  const trimmed = workflowName?.trim();
  return trimmed !== undefined && trimmed.length > 0
    ? { workflowName: trimmed }
    : {};
}

async function resolveStickyRootManagerContext(input: {
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

async function clearStickySessionBinding(
  stickyContext: StickyRootManagerContext,
): Promise<void> {
  await deleteEventWorkflowSessionStickiness(
    stickinessLookupKeyFromContext(stickyContext),
    stickyContext.options,
  );
}

async function resolveStickyDispatchResolution(input: {
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

async function persistStickySessionBinding(input: {
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

function buildWorkflowExecutionClientOptions(
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

/** Options forwarded to both library `execute` and local `runWorkflow` resume paths. */
function workflowTriggerLocalEngineOverrides(
  options: WorkflowTriggerRunnerOptions,
): Pick<
  WorkflowTriggerRunnerOptions,
  | "mockScenario"
  | "dryRun"
  | "maxSteps"
  | "maxLoopIterations"
  | "defaultTimeoutMs"
> {
  return {
    ...(options.mockScenario === undefined
      ? {}
      : { mockScenario: options.mockScenario }),
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
    ...(options.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: options.maxLoopIterations }),
    ...(options.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: options.defaultTimeoutMs }),
  };
}

export function createWorkflowTriggerRunner(
  options: WorkflowTriggerRunnerOptions = {},
): WorkflowTriggerRunner {
  return {
    async dispatch(
      input: WorkflowTriggerDispatchInput,
    ): Promise<WorkflowTriggerResult> {
      const begin = await beginEventReceipt(
        {
          event: input.event,
          binding: input.binding,
          ...(input.raw === undefined ? {} : { raw: input.raw }),
        },
        options,
      );
      if (begin.duplicateOf !== undefined) {
        return {
          receipt: begin.record,
          duplicate: true,
          ...workflowNameResultField(input.binding.workflowName),
        };
      }

      const supervisedMode = input.binding.execution?.mode === "supervised";
      const supervisorDispatchMode =
        input.binding.execution?.mode === "supervisor-dispatch";

      let supervisorIntent: SupervisorIntentResolution | undefined;
      if (supervisedMode) {
        if (input.supervisorIntentPrecheckSkip !== undefined) {
          supervisorIntent = {
            outcome: "skip",
            reason: input.supervisorIntentPrecheckSkip.reason,
          };
        } else if (input.supervisorIntentOverride !== undefined) {
          supervisorIntent = input.supervisorIntentOverride;
        } else {
          supervisorIntent = await resolveSupervisorIntentAsync({
            binding: input.binding,
            event: input.event,
            ...(input.source === undefined ? {} : { source: input.source }),
            divedraOptions: options,
          });
        }
        if (supervisorIntent.outcome === "skip") {
          const skipped = await updateEventReceipt(
            {
              record: begin.record,
              artifactDir: begin.artifactDir,
              status: "skipped",
              error: supervisorIntent.reason,
            },
            options,
          );
          if (input.suppressSupervisorChatReply !== true) {
            await dispatchSupervisorControlReplyIfConfigured({
              options,
              binding: input.binding,
              event: input.event,
              receiptId: begin.record.receiptId,
              action: "skip",
              skipReason: supervisorIntent.reason,
            });
          }
          return {
            receipt: skipped,
            duplicate: false,
            ...workflowNameResultField(input.binding.workflowName),
          };
        }
      }

      const needsFullInputMapping =
        supervisorDispatchMode ||
        !supervisedMode ||
        (supervisorIntent !== undefined &&
          supervisorIntent.outcome === "action" &&
          (supervisorIntent.action === "start" ||
            supervisorIntent.action === "input"));

      let mapping: ReturnType<typeof mapEventToWorkflowInput>;
      try {
        if (needsFullInputMapping) {
          mapping = mapEventToWorkflowInput(
            input.binding,
            input.event,
            input.source,
          );
        } else {
          mapping = {
            workflowInput: {},
            runtimeVariables: {
              workflowInput: {},
              event: buildEventRuntimeMetadata(input.event),
              eventBindingId: input.binding.id,
              eventMailboxBridgePolicy: resolveEventMailboxBridgePolicy(
                input.binding,
              ),
            },
          };
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        const failed = await updateEventReceipt(
          {
            record: begin.record,
            artifactDir: begin.artifactDir,
            status: "failed",
            error: message,
          },
          options,
        );
        if (
          (supervisedMode || supervisorDispatchMode) &&
          input.suppressSupervisorChatReply !== true &&
          options.eventReplyDispatcher !== undefined
        ) {
          await dispatchSupervisorControlReplyIfConfigured({
            options,
            binding: input.binding,
            event: input.event,
            receiptId: begin.record.receiptId,
            action: "failed",
            skipReason:
              "Event payload could not be mapped for this binding. Inspect the event receipt for operator diagnostics.",
          });
        }
        return {
          receipt: failed,
          duplicate: false,
          ...workflowNameResultField(input.binding.workflowName),
        };
      }

      let receipt = await updateEventReceipt(
        {
          record: begin.record,
          artifactDir: begin.artifactDir,
          status: "mapped",
          inputPayload: mapping.runtimeVariables,
        },
        options,
      );
      if (options.readOnly === true) {
        const skipped = await updateEventReceipt(
          {
            record: receipt,
            artifactDir: begin.artifactDir,
            status: "skipped",
            error: "event dispatch skipped in read-only mode",
          },
          options,
        );
        return {
          receipt: skipped,
          duplicate: false,
          ...workflowNameResultField(input.binding.workflowName),
        };
      }

      try {
        receipt = await updateEventReceipt(
          {
            record: receipt,
            artifactDir: begin.artifactDir,
            status: "dispatching",
          },
          options,
        );
        if (input.binding.execution?.mode === "supervised") {
          if (
            supervisorIntent === undefined ||
            supervisorIntent.outcome !== "action"
          ) {
            throw new Error("internal: supervised intent was not resolved");
          }
          const intent = supervisorIntent;
          const client =
            options.supervisorClient ??
            (options.endpoint !== undefined
              ? createWorkflowSupervisorGraphqlClient({
                  endpoint: options.endpoint,
                  ...(options.authToken === undefined
                    ? {}
                    : { authToken: options.authToken }),
                  ...(options.fetchImpl === undefined
                    ? {}
                    : { fetchImpl: options.fetchImpl }),
                })
              : createWorkflowSupervisorClient(options));
          const router = createEventSupervisorRouter({ client });

          const correlationKey = resolveSupervisedCorrelationKey({
            binding: input.binding,
            event: input.event,
            ...(input.source === undefined ? {} : { source: input.source }),
          });
          const bindingTargetWorkflow = input.binding.workflowName?.trim();
          if (
            bindingTargetWorkflow === undefined ||
            bindingTargetWorkflow.length === 0
          ) {
            throw new Error("internal: supervised binding missing workflowName");
          }
          const command = {
            commandId: buildStableSupervisorCommandId({
              receiptId: receipt.receiptId,
              action: intent.action,
            }),
            sourceId: input.event.sourceId,
            bindingId: input.binding.id,
            correlationKey,
            action: intent.action,
            targetWorkflowName: bindingTargetWorkflow,
            receivedEventReceiptId: receipt.receiptId,
            ...(intent.runtimeVariables === undefined
              ? {}
              : { runtimeVariables: intent.runtimeVariables }),
            ...(intent.reason === undefined ? {} : { reason: intent.reason }),
          };
          const view = await router.dispatch({
            command,
            binding: input.binding,
            runtimeVariables: mapping.runtimeVariables,
            engine: workflowTriggerLocalEngineOverrides(options),
          });
          receipt = await updateEventReceipt(
            {
              record: receipt,
              artifactDir: begin.artifactDir,
              status: "dispatched",
              ...(view.supervisedRun.activeTargetExecutionId === undefined
                ? {}
                : {
                    workflowExecutionId:
                      view.supervisedRun.activeTargetExecutionId,
                  }),
              supervisedRunId: view.supervisedRun.supervisedRunId,
              ...(view.supervisedRun.supervisorExecutionId === undefined
                ? {}
                : {
                    supervisorExecutionId:
                      view.supervisedRun.supervisorExecutionId,
                  }),
              dispatchPayload: view,
            },
            options,
          );
          if (input.suppressSupervisorChatReply !== true) {
            await dispatchSupervisorControlReplyIfConfigured({
              options,
              binding: input.binding,
              event: input.event,
              receiptId: receipt.receiptId,
              action: intent.action,
              view,
            });
          }
          return {
            receipt,
            duplicate: false,
            workflowName: view.supervisedRun.targetWorkflowName,
            ...(view.supervisedRun.activeTargetExecutionId === undefined
              ? {}
              : {
                  workflowExecutionId:
                    view.supervisedRun.activeTargetExecutionId,
                }),
            supervisedRunId: view.supervisedRun.supervisedRunId,
            ...(view.supervisedRun.supervisorExecutionId === undefined
              ? {}
              : {
                  supervisorExecutionId:
                    view.supervisedRun.supervisorExecutionId,
                }),
          };
        }

        if (input.binding.execution?.mode === "supervisor-dispatch") {
          const profileId = input.binding.execution.supervisorProfileId?.trim();
          if (profileId === undefined || profileId.length === 0) {
            throw new Error(
              "supervisor-dispatch requires execution.supervisorProfileId",
            );
          }
          const correlationKey = resolveSupervisedCorrelationKey({
            binding: input.binding,
            event: input.event,
            ...(input.source === undefined ? {} : { source: input.source }),
          });
          const eventRoot = resolveEventRoot(options);
          const dispatchClient = createWorkflowSupervisorDispatchClient(options);
          const view = await dispatchClient.dispatchExternalInput({
            ...options,
            eventRoot,
            binding: input.binding,
            event: input.event,
            ...(input.source === undefined ? {} : { source: input.source }),
            supervisorProfileId: profileId,
            sourceMessageId: input.event.dedupeKey,
            correlationKey,
          });
          const workflowExecutionIdResolved =
            workflowExecutionIdFromDispatchView(view);
          const dispatchWorkflowName = workflowNameFromDispatchView(
            view,
            workflowExecutionIdResolved,
          );
          receipt = await updateEventReceipt(
            {
              record: receipt,
              artifactDir: begin.artifactDir,
              status: "dispatched",
              ...(workflowExecutionIdResolved === undefined
                ? {}
                : { workflowExecutionId: workflowExecutionIdResolved }),
              supervisorConversationId: view.conversation.supervisorConversationId,
              supervisorDecisionId: view.decision.decisionId,
              dispatchPayload: view,
            },
            options,
          );
          if (input.suppressSupervisorChatReply !== true) {
            await dispatchSupervisorDispatchReplyIfConfigured({
              options,
              binding: input.binding,
              event: input.event,
              receiptId: receipt.receiptId,
              view,
            });
          }
          return {
            receipt,
            duplicate: false,
            ...workflowNameResultField(dispatchWorkflowName),
            ...(workflowExecutionIdResolved === undefined
              ? {}
              : { workflowExecutionId: workflowExecutionIdResolved }),
            supervisorConversationId: view.conversation.supervisorConversationId,
            supervisorDecisionId: view.decision.decisionId,
          };
        }

        const directWorkflowName = input.binding.workflowName?.trim();
        if (directWorkflowName === undefined || directWorkflowName.length === 0) {
          const failed = await updateEventReceipt(
            {
              record: receipt,
              artifactDir: begin.artifactDir,
              status: "failed",
              error:
                "cannot dispatch direct workflow: binding.workflowName is missing",
            },
            options,
          );
          return {
            receipt: failed,
            duplicate: false,
          };
        }

        const stickyContext = await resolveStickyRootManagerContext({
          binding: input.binding,
          event: input.event,
          options,
        });
        const stickyResolution = await resolveStickyDispatchResolution({
          stickyContext,
          runtimeVariables: mapping.runtimeVariables,
        });
        if (stickyResolution.outcome === "blocked-active-user-actions") {
          const skipped = await updateEventReceipt(
            {
              record: receipt,
              artifactDir: begin.artifactDir,
              status: "skipped",
              error:
                "event dispatch skipped: sticky workflow session has pending user actions",
            },
            options,
          );
          return {
            receipt: skipped,
            duplicate: false,
            ...workflowNameResultField(directWorkflowName),
          };
        }
        const stickyPlan =
          stickyResolution.outcome === "resume" ? stickyResolution.plan : null;
        const result =
          stickyPlan === null
            ? await createWorkflowExecutionClient(
                buildWorkflowExecutionClientOptions(
                  directWorkflowName,
                  options,
                ),
              ).execute({
                input: mapping.runtimeVariables,
                ...workflowTriggerLocalEngineOverrides(options),
                async: input.binding.execution?.async ?? true,
              })
            : await (async () => {
                const resumed = await runWorkflow(directWorkflowName, {
                  ...stickyPlan.options,
                  resumeSessionId: stickyPlan.sessionId,
                  ...workflowTriggerLocalEngineOverrides(options),
                });
                if (!resumed.ok) {
                  throw new Error(resumed.error.message);
                }
                return {
                  workflowName: directWorkflowName,
                  workflowExecutionId: resumed.value.session.sessionId,
                  sessionId: resumed.value.session.sessionId,
                  status: resumed.value.session.status,
                  exitCode: resumed.value.exitCode,
                };
              })();
        await persistStickySessionBinding({
          stickyContext,
          workflowExecutionId: result.workflowExecutionId,
          workflowStatus: result.status,
        });
        receipt = await updateEventReceipt(
          {
            record: receipt,
            artifactDir: begin.artifactDir,
            status: "dispatched",
            workflowExecutionId: result.workflowExecutionId,
            dispatchPayload: result,
          },
          options,
        );
        return {
          receipt,
          duplicate: false,
          ...workflowNameResultField(result.workflowName),
          workflowExecutionId: result.workflowExecutionId,
        };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        const failed = await updateEventReceipt(
          {
            record: receipt,
            artifactDir: begin.artifactDir,
            status: "failed",
            error: message,
          },
          options,
        );
        if (
          (input.binding.execution?.mode === "supervised" ||
            input.binding.execution?.mode === "supervisor-dispatch") &&
          input.suppressSupervisorChatReply !== true
        ) {
          await dispatchSupervisorControlReplyIfConfigured({
            options,
            binding: input.binding,
            event: input.event,
            receiptId: failed.receiptId,
            action: "failed",
            skipReason:
              "Control command could not be completed. Inspect the event receipt status for operator diagnostics.",
          });
        }
        return {
          receipt: failed,
          duplicate: false,
          ...workflowNameResultField(input.binding.workflowName),
        };
      }
    },
  };
}

function resolveLlmBatchDispatchOverrides(
  plan: LlmBatchPlan,
  bindingId: string,
): {
  readonly supervisorIntentOverride?: SupervisorIntentResolution;
  readonly supervisorIntentPrecheckSkip?: { readonly reason: string };
} {
  if (plan.kind === "per-binding") {
    return {};
  }
  const precomputed = plan.intents.get(bindingId);
  if (precomputed !== undefined) {
    if (precomputed.outcome === "skip") {
      return { supervisorIntentPrecheckSkip: { reason: precomputed.reason } };
    }
    return { supervisorIntentOverride: precomputed };
  }
  if (plan.kind === "ambiguous" && plan.bindingIds.includes(bindingId)) {
    return { supervisorIntentPrecheckSkip: { reason: plan.reason } };
  }
  return {};
}

export async function dispatchEventToMatchingBindings(
  input: {
    readonly configuration: EventConfiguration;
    readonly event: ExternalEventEnvelope;
    readonly raw?: unknown;
    readonly runner: WorkflowTriggerRunner;
  },
  options: WorkflowTriggerRunnerOptions = {},
): Promise<readonly WorkflowTriggerResult[]> {
  const source = input.configuration.sources.find(
    (entry) => entry.id === input.event.sourceId && isEventSourceEnabled(entry),
  );
  const bindings = selectMatchingBindings(
    input.configuration.bindings.filter(
      (binding) =>
        binding.sourceId === input.event.sourceId &&
        isEventBindingEnabled(binding),
    ),
    input.event,
  );
  if (bindings.length === 0) {
    const skipped = await beginEventReceipt(
      {
        event: input.event,
        ...(input.raw === undefined ? {} : { raw: input.raw }),
        status: "skipped",
      },
      options,
    );
    return [{ receipt: skipped.record, duplicate: false }];
  }

  const llmBatchPlan = await planSupervisedLlmBindingsDispatch({
    bindings,
    event: input.event,
    ...(source === undefined ? {} : { source }),
    options,
  });

  if (llmBatchPlan.kind === "ambiguous") {
    const routerReceiptId = `router:${input.event.sourceId}:${input.event.dedupeKey}:supervised-llm-destructive-ambiguous`;
    await dispatchSupervisorControlReplyIfConfigured({
      options,
      ...(bindings[0] === undefined ? {} : { binding: bindings[0] }),
      event: input.event,
      receiptId: routerReceiptId,
      action: "skip",
      skipReason: llmBatchPlan.reason,
    });
  }

  const results: WorkflowTriggerResult[] = [];
  for (const binding of bindings) {
    const { supervisorIntentOverride, supervisorIntentPrecheckSkip } =
      resolveLlmBatchDispatchOverrides(llmBatchPlan, binding.id);

    const suppressSupervisorChatReply =
      llmBatchPlan.kind === "ambiguous" &&
      llmBatchPlan.bindingIds.includes(binding.id);

    results.push(
      await input.runner.dispatch({
        binding,
        event: input.event,
        ...(source === undefined ? {} : { source }),
        ...(input.raw === undefined ? {} : { raw: input.raw }),
        ...(supervisorIntentOverride === undefined
          ? {}
          : { supervisorIntentOverride }),
        ...(supervisorIntentPrecheckSkip === undefined
          ? {}
          : { supervisorIntentPrecheckSkip }),
        ...(suppressSupervisorChatReply
          ? { suppressSupervisorChatReply: true }
          : {}),
      }),
    );
  }
  return results;
}
