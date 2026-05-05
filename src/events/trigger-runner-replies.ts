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
