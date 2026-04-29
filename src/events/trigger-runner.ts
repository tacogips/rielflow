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
import type { MockNodeScenario } from "../workflow/adapter";
import type { ChatReplyDispatcher } from "../workflow/types";
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
  mapEventToWorkflowInput,
  selectMatchingBindings,
} from "./input-mapping";
import { beginEventReceipt, updateEventReceipt } from "./ledger";
import type {
  EventBinding,
  EventConfiguration,
  EventReceiptRecord,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "./types";

export interface WorkflowTriggerDispatchInput {
  readonly binding: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly source?: EventSourceConfig;
  readonly raw?: unknown;
}

export interface WorkflowTriggerResult {
  readonly receipt: EventReceiptRecord;
  readonly duplicate: boolean;
  readonly workflowName?: string;
  readonly workflowExecutionId?: string;
}

export interface WorkflowTriggerRunnerOptions extends DivedraOptions {
  readonly endpoint?: string;
  readonly authToken?: string;
  readonly fetchImpl?: typeof fetch;
  readonly mockScenario?: MockNodeScenario;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly readOnly?: boolean;
  readonly eventReplyDispatcher?: ChatReplyDispatcher;
}

export interface WorkflowTriggerRunner {
  dispatch(input: WorkflowTriggerDispatchInput): Promise<WorkflowTriggerResult>;
}

interface StickyRootManagerContext {
  readonly workflowId: string;
  readonly workflowName: string;
  /** Manager/entry runtime id: step id for step-addressed bundles, else legacy node id. */
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

  const loaded = await loadWorkflowFromCatalog(
    input.binding.workflowName,
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
    workflowName: input.binding.workflowName,
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
          workflowName: input.binding.workflowName,
        };
      }

      let mapping: ReturnType<typeof mapEventToWorkflowInput>;
      try {
        mapping = mapEventToWorkflowInput(
          input.binding,
          input.event,
          input.source,
        );
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
        return {
          receipt: failed,
          duplicate: false,
          workflowName: input.binding.workflowName,
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
          workflowName: input.binding.workflowName,
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
            workflowName: input.binding.workflowName,
          };
        }
        const stickyPlan =
          stickyResolution.outcome === "resume" ? stickyResolution.plan : null;
        const result =
          stickyPlan === null
            ? await createWorkflowExecutionClient(
                buildWorkflowExecutionClientOptions(
                  input.binding.workflowName,
                  options,
                ),
              ).execute({
                input: mapping.runtimeVariables,
                ...workflowTriggerLocalEngineOverrides(options),
                async: input.binding.execution?.async ?? true,
              })
            : await (async () => {
                const resumed = await runWorkflow(input.binding.workflowName, {
                  ...stickyPlan.options,
                  resumeSessionId: stickyPlan.sessionId,
                  ...workflowTriggerLocalEngineOverrides(options),
                });
                if (!resumed.ok) {
                  throw new Error(resumed.error.message);
                }
                return {
                  workflowName: input.binding.workflowName,
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
          workflowName: result.workflowName,
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
        return {
          receipt: failed,
          duplicate: false,
          workflowName: input.binding.workflowName,
        };
      }
    },
  };
}

export async function dispatchEventToMatchingBindings(
  input: {
    readonly configuration: EventConfiguration;
    readonly event: ExternalEventEnvelope;
    readonly raw?: unknown;
    readonly runner: WorkflowTriggerRunner;
  },
  options: DivedraOptions = {},
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
  const results: WorkflowTriggerResult[] = [];
  for (const binding of bindings) {
    results.push(
      await input.runner.dispatch({
        binding,
        event: input.event,
        ...(source === undefined ? {} : { source }),
        ...(input.raw === undefined ? {} : { raw: input.raw }),
      }),
    );
  }
  return results;
}
