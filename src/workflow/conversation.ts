import type { OutputRef, WorkflowSessionState } from "./session";
import { evaluateBranch } from "./semantics";
import type { SubWorkflowRef, WorkflowJson } from "./types";

export interface ConversationTurn {
  readonly conversationId: string;
  readonly turnIndex: number;
  readonly fromSubWorkflowId: string;
  readonly toSubWorkflowId: string;
  readonly fromManagerNodeId: string;
  readonly toManagerNodeId: string;
  readonly outputRef: OutputRef;
}

export interface ConversationExecutionResult {
  readonly status: "stopped" | "max_turns" | "failed";
  readonly turns: readonly ConversationTurn[];
}

function findSubWorkflow(
  workflow: WorkflowJson,
  subWorkflowId: string,
): SubWorkflowRef | undefined {
  return workflow.subWorkflows.find((entry) => entry.id === subWorkflowId);
}

function managerNodeIdForSubWorkflow(
  _workflow: WorkflowJson,
  subWorkflow: SubWorkflowRef,
): string {
  return subWorkflow.managerNodeId;
}

function findLatestSucceededNodeExecution(
  session: WorkflowSessionState,
  nodeId: string,
): WorkflowSessionState["nodeExecutions"][number] | undefined {
  return [...session.nodeExecutions]
    .reverse()
    .find((entry) => entry.nodeId === nodeId && entry.status === "succeeded");
}

function conversationTurnCount(
  session: WorkflowSessionState,
  conversationId: string,
): number {
  return (session.conversationTurns ?? []).filter(
    (entry) => entry.conversationId === conversationId,
  ).length;
}

function lastSentNodeExecIdForConversationSender(
  session: WorkflowSessionState,
  conversationId: string,
  fromSubWorkflowId: string,
): string | undefined {
  const matchingTurns = (session.conversationTurns ?? []).filter(
    (entry) =>
      entry.conversationId === conversationId &&
      entry.fromSubWorkflowId === fromSubWorkflowId,
  );
  const latestTurn = matchingTurns.at(-1);
  return latestTurn?.outputRef.nodeExecId;
}

function latestReceivedTurnSentAt(
  session: WorkflowSessionState,
  conversationId: string,
  subWorkflowId: string,
): string | undefined {
  const matchingTurns = (session.conversationTurns ?? []).filter(
    (entry) =>
      entry.conversationId === conversationId &&
      entry.toSubWorkflowId === subWorkflowId,
  );
  const latestTurn = matchingTurns.at(-1);
  return latestTurn?.sentAt;
}

export async function executeConversationRound(args: {
  readonly workflow: WorkflowJson;
  readonly workflowExecutionId: string;
  readonly session: WorkflowSessionState;
}): Promise<ConversationExecutionResult> {
  const conversations = args.workflow.subWorkflowConversations ?? [];
  if (conversations.length === 0) {
    return { status: "stopped", turns: [] };
  }

  let blockedByAvailability = false;
  for (const conversation of conversations) {
    const participants = [...conversation.participants];
    if (participants.length < 2) {
      return { status: "failed", turns: [] };
    }

    const completedTurns = conversationTurnCount(args.session, conversation.id);
    if (completedTurns >= conversation.maxTurns) {
      continue;
    }

    const senderIndex = completedTurns % participants.length;
    const receiverIndex = (senderIndex + 1) % participants.length;
    const fromSubWorkflowId = participants[senderIndex];
    const toSubWorkflowId = participants[receiverIndex];
    if (fromSubWorkflowId === undefined || toSubWorkflowId === undefined) {
      return { status: "failed", turns: [] };
    }

    const sender = findSubWorkflow(args.workflow, fromSubWorkflowId);
    if (sender === undefined) {
      return { status: "failed", turns: [] };
    }
    const receiver = findSubWorkflow(args.workflow, toSubWorkflowId);
    if (receiver === undefined) {
      return { status: "failed", turns: [] };
    }
    const outputExecution = findLatestSucceededNodeExecution(
      args.session,
      sender.outputNodeId,
    );
    if (outputExecution === undefined) {
      blockedByAvailability = true;
      continue;
    }
    const lastSentNodeExecId = lastSentNodeExecIdForConversationSender(
      args.session,
      conversation.id,
      fromSubWorkflowId,
    );
    if (lastSentNodeExecId === outputExecution.nodeExecId) {
      blockedByAvailability = true;
      continue;
    }
    const latestReceivedAt = latestReceivedTurnSentAt(
      args.session,
      conversation.id,
      fromSubWorkflowId,
    );
    if (
      latestReceivedAt !== undefined &&
      outputExecution.endedAt <= latestReceivedAt
    ) {
      blockedByAvailability = true;
      continue;
    }

    const stopContext: Readonly<Record<string, unknown>> = {
      turns_exhausted: completedTurns + 1 >= conversation.maxTurns,
      has_sender_output: true,
      [fromSubWorkflowId]: true,
      [toSubWorkflowId]: true,
    };
    if (
      conversation.stopWhen.length > 0 &&
      evaluateBranch({ when: conversation.stopWhen, output: stopContext })
    ) {
      return { status: "stopped", turns: [] };
    }

    const turn: ConversationTurn = {
      conversationId: conversation.id,
      turnIndex: completedTurns + 1,
      fromSubWorkflowId,
      toSubWorkflowId,
      fromManagerNodeId: managerNodeIdForSubWorkflow(args.workflow, sender),
      toManagerNodeId: managerNodeIdForSubWorkflow(args.workflow, receiver),
      outputRef: {
        kind: "node-output",
        workflowExecutionId: args.workflowExecutionId,
        workflowId: args.workflow.workflowId,
        subWorkflowId: fromSubWorkflowId,
        outputNodeId: sender.outputNodeId,
        nodeExecId: outputExecution.nodeExecId,
        artifactDir: outputExecution.artifactDir,
      },
    };

    return {
      status:
        completedTurns + 1 >= conversation.maxTurns ? "max_turns" : "stopped",
      turns: [turn],
    };
  }

  return { status: blockedByAvailability ? "stopped" : "max_turns", turns: [] };
}
