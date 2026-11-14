import { createWorkflowExecutionClient } from "../../lib";
import { runWorkflow } from "../../workflow/engine";
import { createWorkflowSupervisorClient } from "../../workflow/supervisor-client";
import { createWorkflowSupervisorDispatchClient } from "../../workflow/supervisor-dispatch-client";
import { createWorkflowSupervisorGraphqlClient } from "../../workflow/supervisor-graphql-client";
import {
  createSupervisorRunnerPool,
  type SupervisorRunnerPool,
} from "../../workflow/supervisor-runner-pool";
import {
  isEventBindingEnabled,
  isEventSourceEnabled,
  resolveEventRoot,
} from "../config";
import {
  buildEventRuntimeMetadata,
  mapEventToWorkflowInput,
  selectMatchingBindings,
} from "../input-mapping";
import { beginEventReceipt, updateEventReceipt } from "../ledger";
import { resolveEventMailboxBridgePolicy } from "../mailbox-bridge-policy";
import {
  buildStableSupervisorCommandId,
  resolveSupervisedCorrelationKey,
} from "../supervisor-correlation";
import {
  resolveSupervisorIntentAsync,
  type SupervisorIntentResolution,
} from "../supervisor-intent";
import {
  planSupervisedLlmBindingsDispatch,
  type LlmBatchPlan,
} from "../supervisor-llm-batch";
import { createEventSupervisorRouter } from "../supervisor-router";
import { resolveEventTaskPlanningDecision } from "../task-planning";
import {
  dispatchEventProgressReplyIfConfigured,
  dispatchEventTaskPlanningReplyIfConfigured,
  dispatchSupervisorControlReplyIfConfigured,
  dispatchSupervisorDispatchReplyIfConfigured,
} from "../trigger-runner-replies";
import type { EventConfiguration, ExternalEventEnvelope } from "../types";
import type { WorkflowTriggerRunnerOptions } from "../workflow-trigger-runner-options";
import type {
  WorkflowTriggerDispatchInput,
  WorkflowTriggerResult,
  WorkflowTriggerRunner,
} from "./sticky-dispatch-planning";
import {
  buildWorkflowExecutionClientOptions,
  persistStickySessionBinding,
  resolveStickyDispatchResolution,
  resolveStickyRootManagerContext,
  workflowExecutionIdFromDispatchView,
  workflowNameFromDispatchView,
  workflowNameResultField,
  workflowTriggerLocalEngineOverrides,
} from "./sticky-dispatch-planning";

export function createWorkflowTriggerRunner(
  options: WorkflowTriggerRunnerOptions = {},
): WorkflowTriggerRunner {
  let localSupervisorRunnerPool: SupervisorRunnerPool | undefined;

  function getLocalSupervisorRunnerPool(): SupervisorRunnerPool {
    if (localSupervisorRunnerPool === undefined) {
      localSupervisorRunnerPool = createSupervisorRunnerPool({
        client: createWorkflowSupervisorClient(options),
      });
    }
    return localSupervisorRunnerPool;
  }

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
              ...(input.binding.outputDestinations === undefined
                ? {}
                : {
                    eventOutputDestinations: input.binding.outputDestinations,
                  }),
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
      if (input.suppressSupervisorChatReply !== true && needsFullInputMapping) {
        await dispatchEventProgressReplyIfConfigured({
          options,
          binding: input.binding,
          event: input.event,
          receiptId: receipt.receiptId,
          stage: "received",
          ...(input.binding.workflowName === undefined
            ? {}
            : { workflowName: input.binding.workflowName }),
        });
      }
      if (needsFullInputMapping) {
        const taskPlanningDecision = resolveEventTaskPlanningDecision({
          binding: input.binding,
          workflowInput: mapping.workflowInput,
        });
        if (taskPlanningDecision !== null) {
          if (input.suppressSupervisorChatReply !== true) {
            await dispatchEventTaskPlanningReplyIfConfigured({
              options,
              binding: input.binding,
              event: input.event,
              receiptId: receipt.receiptId,
              decision: taskPlanningDecision,
            });
          }
          if (taskPlanningDecision.status === "needs-clarification") {
            const skipped = await updateEventReceipt(
              {
                record: receipt,
                artifactDir: begin.artifactDir,
                status: "skipped",
                error: `task clarification required: ${taskPlanningDecision.missing.join(", ")}`,
              },
              options,
            );
            return {
              receipt: skipped,
              duplicate: false,
              ...workflowNameResultField(input.binding.workflowName),
            };
          }
        }
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
        if (
          input.suppressSupervisorChatReply !== true &&
          needsFullInputMapping
        ) {
          await dispatchEventProgressReplyIfConfigured({
            options,
            binding: input.binding,
            event: input.event,
            receiptId: receipt.receiptId,
            stage: "starting",
            ...(input.binding.workflowName === undefined
              ? {}
              : { workflowName: input.binding.workflowName }),
          });
        }
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
              : undefined);
          const router =
            client === undefined
              ? undefined
              : createEventSupervisorRouter({ client });

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
            throw new Error(
              "internal: supervised binding missing workflowName",
            );
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
            ...(intent.args === undefined || intent.args.length === 0
              ? {}
              : { args: intent.args }),
            ...(intent.runtimeVariables === undefined
              ? {}
              : { runtimeVariables: intent.runtimeVariables }),
            ...(intent.reason === undefined ? {} : { reason: intent.reason }),
          };
          const dispatchInput = {
            command,
            binding: input.binding,
            runtimeVariables: mapping.runtimeVariables,
            engine: workflowTriggerLocalEngineOverrides(options),
          };
          const view =
            router === undefined
              ? await getLocalSupervisorRunnerPool().dispatch(dispatchInput)
              : await router.dispatch(dispatchInput);
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
          const dispatchClient =
            createWorkflowSupervisorDispatchClient(options);
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
              supervisorConversationId:
                view.conversation.supervisorConversationId,
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
            supervisorConversationId:
              view.conversation.supervisorConversationId,
            supervisorDecisionId: view.decision.decisionId,
          };
        }

        const directWorkflowName = input.binding.workflowName?.trim();
        if (
          directWorkflowName === undefined ||
          directWorkflowName.length === 0
        ) {
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
export function resolveLlmBatchDispatchOverrides(
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
