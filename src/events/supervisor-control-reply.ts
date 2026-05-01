import type {
  ChatReplyDispatchRequest,
  ChatReplyDispatchTarget,
} from "../workflow/types";
import type { SupervisedWorkflowView } from "../workflow/supervisor-client";
import type { WorkflowSupervisorDispatchView } from "../workflow/supervisor-dispatch-client";
import type {
  EventSupervisorAction,
  ExternalEventEnvelope,
  ExternalOutputMessage,
} from "./types";
import {
  buildChatReplyRequestForExternalOutput,
  formatExternalOutputTransportText,
} from "./external-output";
import { resolveChatReplyTargetFromEnvelope } from "./chat-reply-target";

export { resolveChatReplyTargetFromEnvelope } from "./chat-reply-target";

function extractSupervisorDispatchProposalReplyText(
  reply: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  if (reply === undefined) {
    return undefined;
  }
  for (const key of ["text", "markdown", "body", "message"] as const) {
    const value = reply[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export function formatSupervisorDispatchControlReplyText(
  view: WorkflowSupervisorDispatchView,
): string {
  const lines = [
    `Supervisor dispatch (${view.proposal.action})`,
    `supervisorConversationId: ${view.conversation.supervisorConversationId}`,
    `decisionId: ${view.decision.decisionId}`,
    `applied: ${String(view.applied)}`,
    `profileRevision: ${view.conversation.profileRevision}`,
    ...(view.validationIssues === undefined || view.validationIssues.length === 0
      ? []
      : [
          `validationIssues: ${view.validationIssues
            .map((i) => `${i.code}: ${i.message}`)
            .join("; ")}`,
        ]),
  ];
  return lines.join("\n");
}

export function buildDispatchControlExternalOutputMessage(input: {
  readonly event: ExternalEventEnvelope;
  readonly receiptId: string;
  readonly view: WorkflowSupervisorDispatchView;
  readonly createdAt?: string;
}): ExternalOutputMessage | null {
  const target = resolveChatReplyTargetFromEnvelope(input.event);
  if (target === null) {
    return null;
  }
  const metadata = formatSupervisorDispatchControlReplyText(input.view);
  const replyLead = extractSupervisorDispatchProposalReplyText(
    input.view.proposal.reply,
  );
  const text =
    replyLead !== undefined
      ? `${replyLead}\n\n${metadata}`
      : metadata;
  const workflowExecutionId = `supervisor-conversation:${input.view.conversation.supervisorConversationId}`;
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    kind: "external-output",
    outputKind: "control-status",
    address: {
      sourceId: input.event.sourceId,
      workflowName: input.view.conversation.supervisorWorkflowName,
      workflowExecutionId,
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
      controlStatusText: text,
      eventId: input.event.eventId,
      action: "status",
      dispatchProposalAction: input.view.proposal.action,
      ...(input.view.proposal.reply === undefined
        ? {}
        : { dispatchProposalReply: input.view.proposal.reply }),
    },
    idempotencyKey: `supervisor-dispatch:${input.receiptId}:${input.view.decision.decisionId}`,
    createdAt,
  };
}

export function formatSupervisorControlReplyText(
  view: SupervisedWorkflowView,
  action: string,
): string {
  const run = view.supervisedRun;
  const target = run.activeTargetExecutionId;
  const targetStatus =
    view.activeTargetStatus === undefined ? "unknown" : view.activeTargetStatus;
  const lines = [
    `Supervised workflow control (${action})`,
    `supervisedRunId: ${run.supervisedRunId}`,
    `supervisorStatus: ${run.status}`,
    `targetWorkflow: ${run.targetWorkflowName}`,
    ...(target === undefined ? [] : [`targetExecutionId: ${target}`]),
    `targetSessionStatus: ${targetStatus}`,
  ];
  return lines.join("\n");
}

export function buildControlStatusExternalOutputMessage(input: {
  readonly event: ExternalEventEnvelope;
  readonly receiptId: string;
  readonly action: EventSupervisorAction | "skip" | "failed";
  readonly view?: SupervisedWorkflowView;
  readonly skipReason?: string;
  readonly createdAt?: string;
}): ExternalOutputMessage | null {
  const target = resolveChatReplyTargetFromEnvelope(input.event);
  if (target === null) {
    return null;
  }
  const skipReason = input.skipReason;
  const text =
    input.view !== undefined
      ? formatSupervisorControlReplyText(input.view, input.action)
      : skipReason !== undefined && skipReason.includes("ambiguous")
        ? `Supervisor needs a specific workflow target before running this command: ${skipReason}`
        : `Supervisor: ${skipReason ?? "skipped"}`;
  const run = input.view?.supervisedRun;
  const workflowExecutionId =
    run?.activeTargetExecutionId ??
    run?.supervisedRunId ??
    `supervisor-receipt:${input.receiptId}`;
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    kind: "external-output",
    outputKind: "control-status",
    address: {
      sourceId: input.event.sourceId,
      workflowName: run?.targetWorkflowName ?? "event-supervisor",
      workflowExecutionId,
      ...(run?.supervisedRunId === undefined
        ? {}
        : { supervisedRunId: run.supervisedRunId }),
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
      controlStatusText: text,
      eventId: input.event.eventId,
      action: input.action,
    },
    idempotencyKey: `supervisor-control:${input.receiptId}:${input.action}`,
    createdAt,
  };
}

export function buildSupervisorControlChatReplyRequest(input: {
  readonly event: ExternalEventEnvelope;
  readonly receiptId: string;
  readonly action: string;
  readonly view?: SupervisedWorkflowView;
  readonly skipReason?: string;
}): ChatReplyDispatchRequest | null {
  const message = buildControlStatusExternalOutputMessage({
    event: input.event,
    receiptId: input.receiptId,
    action: input.action as EventSupervisorAction | "skip" | "failed",
    ...(input.view === undefined ? {} : { view: input.view }),
    ...(input.skipReason === undefined ? {} : { skipReason: input.skipReason }),
  });
  if (message === null) {
    return null;
  }
  const transportText = formatExternalOutputTransportText(message);
  const embedded = message.payload["chatReplyTarget"];
  if (
    typeof embedded !== "object" ||
    embedded === null ||
    !("sourceId" in embedded)
  ) {
    return null;
  }
  const target = embedded as ChatReplyDispatchTarget;
  const run = input.view?.supervisedRun;
  const workflowExecutionId =
    run?.activeTargetExecutionId ??
    run?.supervisedRunId ??
    `supervisor-receipt:${input.receiptId}`;
  return buildChatReplyRequestForExternalOutput({
    message,
    target,
    transportText,
    workflowId: run?.targetWorkflowName ?? "event-supervisor",
    workflowExecutionId,
    nodeId: "event-supervisor-control",
    nodeExecId: input.receiptId,
  });
}
