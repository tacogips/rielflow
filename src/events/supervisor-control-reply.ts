import type {
  ChatReplyDispatchRequest,
  ChatReplyDispatchTarget,
} from "../workflow/types";
import type { SupervisedWorkflowView } from "../workflow/supervisor-client";
import type { ExternalEventEnvelope } from "./types";

function readOptionalString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const raw = value[key];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolves a chat reply target from an event envelope when the event carries
 * conversation metadata (same contract as runtimeVariables.event for chat-reply-worker).
 */
export function resolveChatReplyTargetFromEnvelope(
  event: ExternalEventEnvelope,
): ChatReplyDispatchTarget | null {
  const input = event.input as Readonly<Record<string, unknown>>;
  const replyTarget = input["replyTarget"];
  if (isRecord(replyTarget)) {
    const sourceId = readOptionalString(replyTarget, "sourceId");
    const provider = readOptionalString(replyTarget, "provider");
    const eventId = readOptionalString(replyTarget, "eventId");
    const conversationId = readOptionalString(replyTarget, "conversationId");
    if (
      sourceId !== undefined &&
      provider !== undefined &&
      eventId !== undefined &&
      conversationId !== undefined
    ) {
      const threadId = readOptionalString(replyTarget, "threadId");
      const actorId = readOptionalString(replyTarget, "actorId");
      return {
        sourceId,
        provider,
        eventId,
        conversationId,
        ...(threadId === undefined ? {} : { threadId }),
        ...(actorId === undefined ? {} : { actorId }),
      };
    }
  }

  const conversationId = event.conversation?.id;
  if (conversationId === undefined) {
    return null;
  }
  const threadId = event.conversation?.threadId;
  const actorId = event.actor?.id;
  return {
    sourceId: event.sourceId,
    provider: event.provider,
    eventId: event.eventId,
    conversationId,
    ...(threadId === undefined ? {} : { threadId }),
    ...(actorId === undefined ? {} : { actorId }),
  };
}

export function formatSupervisorControlReplyText(
  view: SupervisedWorkflowView,
  action: string,
): string {
  const run = view.supervisedRun;
  const target = run.activeTargetExecutionId;
  const targetStatus =
    view.activeTargetStatus === undefined
      ? "unknown"
      : view.activeTargetStatus;
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

export function buildSupervisorControlChatReplyRequest(input: {
  readonly event: ExternalEventEnvelope;
  readonly receiptId: string;
  readonly action: string;
  readonly view?: SupervisedWorkflowView;
  readonly skipReason?: string;
}): ChatReplyDispatchRequest | null {
  const target = resolveChatReplyTargetFromEnvelope(input.event);
  if (target === null) {
    return null;
  }
  const text =
    input.view !== undefined
      ? formatSupervisorControlReplyText(input.view, input.action)
      : `Supervisor: ${input.skipReason ?? "skipped"}`;
  const run = input.view?.supervisedRun;
  const workflowExecutionId =
    run?.activeTargetExecutionId ??
    run?.supervisedRunId ??
    `supervisor-receipt:${input.receiptId}`;
  return {
    target,
    message: { text },
    visibility: "public",
    threadPolicy: "same-thread",
    idempotencyKey: `supervisor-control:${input.receiptId}:${input.action}`,
    workflowId: run?.targetWorkflowName ?? "event-supervisor",
    workflowExecutionId,
    nodeId: "event-supervisor-control",
    nodeExecId: input.receiptId,
  };
}
