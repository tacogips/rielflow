import type { WorkflowTriggerRunnerOptions } from "./workflow-trigger-runner-options";
import type {
  EventBinding,
  EventSupervisorAction,
  ExternalEventEnvelope,
} from "./types";
import type { SupervisedWorkflowView } from "../workflow/supervisor-client";
import type { WorkflowSupervisorDispatchView } from "../workflow/supervisor-dispatch-client";
import {
  buildControlStatusExternalOutputMessage,
  buildDispatchControlExternalOutputMessage,
} from "./supervisor-control-reply";
import { publishExternalOutputMessage } from "./external-output";
import { resolveEventMailboxBridgePolicy } from "./mailbox-bridge-policy";
import { resolveChatReplyTargetFromEnvelope } from "./chat-reply-target";
import type { EventTaskPlanningDecision } from "./task-planning";

export async function dispatchEventProgressReplyIfConfigured(input: {
  readonly options: WorkflowTriggerRunnerOptions;
  readonly binding: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly receiptId: string;
  readonly stage: "received" | "starting";
  readonly workflowName?: string;
}): Promise<void> {
  const dispatcher = input.options.eventReplyDispatcher;
  if (dispatcher === undefined) {
    return;
  }
  const policy = resolveEventMailboxBridgePolicy(input.binding);
  if (policy.output.progress.mode === "none") {
    return;
  }
  const target = resolveChatReplyTargetFromEnvelope(input.event);
  if (target === null) {
    return;
  }
  const text =
    input.stage === "received"
      ? "I received the request and am preparing the execution plan."
      : `I am starting the workflow${input.workflowName === undefined ? "." : `: ${input.workflowName}`}`;
  try {
    await publishExternalOutputMessage({
      dispatcher,
      message: {
        kind: "external-output",
        outputKind: "progress",
        address: {
          sourceId: input.event.sourceId,
          bindingId: input.binding.id,
          ...(input.workflowName === undefined
            ? {}
            : { workflowName: input.workflowName }),
          ...(input.event.conversation?.id === undefined
            ? {}
            : { conversationId: input.event.conversation.id }),
          ...(input.event.conversation?.threadId === undefined
            ? {}
            : { threadId: input.event.conversation.threadId }),
          eventId: input.event.eventId,
          providerHint: input.event.provider,
          ...(input.event.actor?.id === undefined
            ? {}
            : { actorId: input.event.actor.id }),
        },
        payload: {
          chatReplyTarget: target,
          transportText: text,
          progressStage: input.stage,
          eventId: input.event.eventId,
          ...(input.binding.outputDestinations === undefined
            ? {}
            : { eventOutputDestinations: input.binding.outputDestinations }),
        },
        idempotencyKey: `event-progress:${input.receiptId}:${input.stage}`,
        createdAt: new Date().toISOString(),
      },
      workflowId: input.workflowName ?? "event-supervisor",
      workflowExecutionId: `event-progress:${input.receiptId}`,
      nodeId: "event-progress",
      nodeExecId: input.receiptId,
      runtimeOptions: input.options,
    });
  } catch {
    // Best-effort: progress replies must not affect event dispatch.
  }
}

export async function dispatchEventTaskPlanningReplyIfConfigured(input: {
  readonly options: WorkflowTriggerRunnerOptions;
  readonly binding: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly receiptId: string;
  readonly decision: EventTaskPlanningDecision;
}): Promise<void> {
  const dispatcher = input.options.eventReplyDispatcher;
  if (dispatcher === undefined) {
    return;
  }
  const target = resolveChatReplyTargetFromEnvelope(input.event);
  if (target === null) {
    return;
  }
  try {
    await publishExternalOutputMessage({
      dispatcher,
      message: {
        kind: "external-output",
        outputKind: "control-status",
        address: {
          sourceId: input.event.sourceId,
          bindingId: input.binding.id,
          ...(input.binding.workflowName === undefined
            ? {}
            : { workflowName: input.binding.workflowName }),
          ...(input.event.conversation?.id === undefined
            ? {}
            : { conversationId: input.event.conversation.id }),
          ...(input.event.conversation?.threadId === undefined
            ? {}
            : { threadId: input.event.conversation.threadId }),
          eventId: input.event.eventId,
          providerHint: input.event.provider,
          ...(input.event.actor?.id === undefined
            ? {}
            : { actorId: input.event.actor.id }),
        },
        payload: {
          chatReplyTarget: target,
          controlStatusText: input.decision.text,
          taskPlanningStatus: input.decision.status,
          replyKind: input.decision.replyKind,
          eventId: input.event.eventId,
          ...(input.decision.status === "needs-clarification"
            ? { requiredInfoMissing: input.decision.missing }
            : {}),
          ...(input.binding.outputDestinations === undefined
            ? {}
            : { eventOutputDestinations: input.binding.outputDestinations }),
        },
        idempotencyKey: `event-task-planning:${input.receiptId}:${input.decision.replyKind}`,
        createdAt: new Date().toISOString(),
      },
      workflowId: input.binding.workflowName ?? "event-supervisor",
      workflowExecutionId: `event-task-planning:${input.receiptId}`,
      nodeId: "event-task-planning",
      nodeExecId: input.receiptId,
      runtimeOptions: input.options,
    });
  } catch {
    // Best-effort: planning replies must not affect event dispatch.
  }
}

export async function dispatchSupervisorControlReplyIfConfigured(input: {
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
    ...(input.binding?.outputDestinations === undefined
      ? {}
      : { outputDestinationIds: input.binding.outputDestinations }),
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

export async function dispatchSupervisorDispatchReplyIfConfigured(input: {
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
    ...(input.binding?.outputDestinations === undefined
      ? {}
      : { outputDestinationIds: input.binding.outputDestinations }),
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
