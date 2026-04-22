import { createWorkflowExecutionClient, type DivedraOptions } from "../lib";
import { runWorkflow } from "../workflow/engine";
import { withResolvedWorkflowSourceOptions } from "../workflow/catalog";
import { loadWorkflowFromCatalog } from "../workflow/load";
import { saveSession, loadSession } from "../workflow/session-store";
import type { WorkflowSessionState } from "../workflow/session";
import type { MockNodeScenario } from "../workflow/adapter";
import type { ChatReplyDispatcher } from "../workflow/types";
import { getNormalizedNodePayload } from "../workflow/types";
import { isEventBindingEnabled, isEventSourceEnabled } from "./config";
import {
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

interface StickyDispatchPlan {
  readonly sessionId: string;
  readonly options: DivedraOptions;
}

function isTerminalSessionForStickyReuse(
  session: WorkflowSessionState,
): boolean {
  return session.status === "failed" || session.status === "cancelled";
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

async function resolveStickyDispatchPlan(input: {
  readonly binding: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly options: WorkflowTriggerRunnerOptions;
}): Promise<StickyDispatchPlan | null> {
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

  const managerNode = getNormalizedNodePayload(
    loaded.value.bundle,
    loaded.value.bundle.workflow.managerNodeId,
  );
  if (managerNode?.sessionPolicy?.mode !== "reuse") {
    return null;
  }

  const stickyOptions =
    loaded.value.source === undefined
      ? input.options
      : withResolvedWorkflowSourceOptions(loaded.value.source, input.options);
  const stickyRecord = await loadEventWorkflowSessionStickiness(
    {
      workflowId: loaded.value.bundle.workflow.workflowId,
      sourceId: input.event.sourceId,
      conversationId,
      ...(input.event.conversation?.threadId === undefined
        ? {}
        : { threadId: input.event.conversation.threadId }),
    },
    stickyOptions,
  );
  if (stickyRecord === null) {
    return null;
  }

  const existing = await loadSession(stickyRecord.sessionId, stickyOptions);
  if (!existing.ok) {
    return null;
  }
  if (
    existing.value.workflowName !== input.binding.workflowName ||
    isTerminalSessionForStickyReuse(existing.value) ||
    (existing.value.activeUserActions?.length ?? 0) > 0
  ) {
    return null;
  }

  const { endedAt: _endedAt, lastError: _lastError, ...resumable } =
    existing.value;
  const updatedSession: WorkflowSessionState = {
    ...resumable,
    status: "running",
    queue: dedupeNodeIds([
      loaded.value.bundle.workflow.managerNodeId,
      ...existing.value.queue,
    ]),
    currentNodeId: loaded.value.bundle.workflow.managerNodeId,
    runtimeVariables: {
      ...existing.value.runtimeVariables,
      ...input.runtimeVariables,
    },
  };
  const saved = await saveSession(updatedSession, stickyOptions);
  if (!saved.ok) {
    throw new Error(saved.error.message);
  }
  return {
    sessionId: updatedSession.sessionId,
    options: stickyOptions,
  };
}

async function persistStickySessionBinding(input: {
  readonly binding: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly workflowExecutionId: string;
  readonly options: WorkflowTriggerRunnerOptions;
}): Promise<void> {
  const conversationId = input.event.conversation?.id;
  if (input.options.endpoint !== undefined || conversationId === undefined) {
    return;
  }
  const loaded = await loadWorkflowFromCatalog(
    input.binding.workflowName,
    input.options,
  );
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }
  const managerNode = getNormalizedNodePayload(
    loaded.value.bundle,
    loaded.value.bundle.workflow.managerNodeId,
  );
  if (managerNode?.sessionPolicy?.mode !== "reuse") {
    return;
  }
  const stickyOptions =
    loaded.value.source === undefined
      ? input.options
      : withResolvedWorkflowSourceOptions(loaded.value.source, input.options);
  await saveEventWorkflowSessionStickiness(
    {
      workflowId: loaded.value.bundle.workflow.workflowId,
      workflowName: input.binding.workflowName,
      sourceId: input.event.sourceId,
      conversationId,
      ...(input.event.conversation?.threadId === undefined
        ? {}
        : { threadId: input.event.conversation.threadId }),
      sessionId: input.workflowExecutionId,
      updatedAt: new Date().toISOString(),
    },
    stickyOptions,
  );
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
        const stickyPlan = await resolveStickyDispatchPlan({
          binding: input.binding,
          event: input.event,
          runtimeVariables: mapping.runtimeVariables,
          options,
        });
        const result =
          stickyPlan === null
            ? await createWorkflowExecutionClient({
                workflowName: input.binding.workflowName,
                ...(options.workflowRoot === undefined
                  ? {}
                  : { workflowRoot: options.workflowRoot }),
                ...(options.workflowScope === undefined
                  ? {}
                  : { workflowScope: options.workflowScope }),
                ...(options.userRoot === undefined
                  ? {}
                  : { userRoot: options.userRoot }),
                ...(options.projectRoot === undefined
                  ? {}
                  : { projectRoot: options.projectRoot }),
                ...(options.artifactRoot === undefined
                  ? {}
                  : { artifactRoot: options.artifactRoot }),
                ...(options.rootDataDir === undefined
                  ? {}
                  : { rootDataDir: options.rootDataDir }),
                ...(options.sessionStoreRoot === undefined
                  ? {}
                  : { sessionStoreRoot: options.sessionStoreRoot }),
                ...(options.env === undefined ? {} : { env: options.env }),
                ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
                ...(options.nodeAddons === undefined
                  ? {}
                  : { nodeAddons: options.nodeAddons }),
                ...(options.asyncNodeAddonResolvers === undefined
                  ? {}
                  : { asyncNodeAddonResolvers: options.asyncNodeAddonResolvers }),
                ...(options.nodeAddonResolvers === undefined
                  ? {}
                  : { nodeAddonResolvers: options.nodeAddonResolvers }),
                ...(options.endpoint === undefined
                  ? {}
                  : { endpoint: options.endpoint }),
                ...(options.authToken === undefined
                  ? {}
                  : { authToken: options.authToken }),
                ...(options.fetchImpl === undefined
                  ? {}
                  : { fetchImpl: options.fetchImpl }),
                ...(options.eventReplyDispatcher === undefined
                  ? {}
                  : { eventReplyDispatcher: options.eventReplyDispatcher }),
              }).execute({
                input: mapping.runtimeVariables,
                ...(options.mockScenario === undefined
                  ? {}
                  : { mockScenario: options.mockScenario }),
                ...(options.dryRun === undefined
                  ? {}
                  : { dryRun: options.dryRun }),
                ...(options.maxSteps === undefined
                  ? {}
                  : { maxSteps: options.maxSteps }),
                ...(options.maxLoopIterations === undefined
                  ? {}
                  : { maxLoopIterations: options.maxLoopIterations }),
                ...(options.defaultTimeoutMs === undefined
                  ? {}
                  : { defaultTimeoutMs: options.defaultTimeoutMs }),
                async: input.binding.execution?.async ?? true,
              })
            : await (async () => {
                const resumed = await runWorkflow(
                  input.binding.workflowName,
                  {
                    ...stickyPlan.options,
                    resumeSessionId: stickyPlan.sessionId,
                    ...(options.mockScenario === undefined
                      ? {}
                      : { mockScenario: options.mockScenario }),
                    ...(options.dryRun === undefined
                      ? {}
                      : { dryRun: options.dryRun }),
                    ...(options.maxSteps === undefined
                      ? {}
                      : { maxSteps: options.maxSteps }),
                    ...(options.maxLoopIterations === undefined
                      ? {}
                      : { maxLoopIterations: options.maxLoopIterations }),
                    ...(options.defaultTimeoutMs === undefined
                      ? {}
                      : { defaultTimeoutMs: options.defaultTimeoutMs }),
                  },
                );
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
          binding: input.binding,
          event: input.event,
          workflowExecutionId: result.workflowExecutionId,
          options,
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
