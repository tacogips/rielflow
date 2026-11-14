import type { WorkflowJson } from "../types";
import type {
  PendingOptionalNodeDecision,
  WorkflowSessionState,
} from "../session";
import type { ManagerIntentSummary } from "../manager-session-store";
import {
  parseManagerControlActionInput,
  type ManagerControlAction,
} from "../manager-control";
import type { DataDirFileRef } from "./types";

export function normalizeManagerMessageText(
  message: string | undefined,
): string | undefined {
  const trimmed = message?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

export function toIntentSummary(
  action: ManagerControlAction,
): ManagerIntentSummary {
  switch (action.type) {
    case "planner-note":
      return { kind: "planner-note" };
    case "start-sub-workflow":
      return {
        kind: "start-sub-workflow",
        targetId: action.subWorkflowId,
      };
    case "deliver-to-child-input":
      return {
        kind: "deliver-to-child-input",
        targetId: action.inputNodeId,
      };
    case "retry-node":
      return {
        kind: "retry-node",
        targetId: action.nodeId,
      };
    case "replay-communication":
      return {
        kind: "replay-communication",
        targetId: action.communicationId,
        ...(action.reason === undefined ? {} : { reason: action.reason }),
      };
    case "execute-optional-node":
      return {
        kind: "execute-optional-node",
        targetId: action.nodeId,
      };
    case "skip-optional-node":
      return {
        kind: "skip-optional-node",
        targetId: action.nodeId,
        ...(action.reason === undefined ? {} : { reason: action.reason }),
      };
  }
}

export function normalizeActionsForIdempotency(
  actions: readonly ManagerControlAction[],
): readonly ManagerControlAction[] {
  return actions.map((action) => parseManagerControlActionInput(action));
}

export function dedupe(values: readonly string[]): readonly string[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

export function findOwnedSubWorkflow(
  workflow: WorkflowJson,
  managerNodeId: string,
) {
  return workflow.subWorkflows.find(
    (entry) => entry.managerNodeId === managerNodeId,
  );
}

function findPendingOptionalNodeDecision(
  session: WorkflowSessionState,
  nodeId: string,
): PendingOptionalNodeDecision | undefined {
  return session.pendingOptionalNodeDecisions?.find(
    (entry) => entry.nodeId === nodeId,
  );
}

function upsertPendingOptionalNodeDecision(
  decisions: readonly PendingOptionalNodeDecision[],
  decision: PendingOptionalNodeDecision,
): readonly PendingOptionalNodeDecision[] {
  return [
    ...decisions.filter((entry) => entry.nodeId !== decision.nodeId),
    decision,
  ];
}

export function queueTargetNodeIdForStartSubWorkflow(args: {
  readonly workflow: WorkflowJson;
  readonly subWorkflowId: string;
}): string {
  const subWorkflow = args.workflow.subWorkflows.find(
    (entry) => entry.id === args.subWorkflowId,
  );
  if (subWorkflow === undefined) {
    throw new Error(`unknown sub-workflow '${args.subWorkflowId}'`);
  }
  return subWorkflow.managerNodeId === args.workflow.managerNodeId
    ? subWorkflow.inputNodeId
    : subWorkflow.managerNodeId;
}

export function isTerminalStatus(status: string): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

export function applyOptionalNodeDecision(input: {
  readonly session: WorkflowSessionState;
  readonly workflow: WorkflowJson;
  readonly managerNodeId: string;
  readonly managerNodeExecId: string;
  readonly action: Extract<
    ManagerControlAction,
    { readonly type: "execute-optional-node" | "skip-optional-node" }
  >;
  readonly decidedAt: string;
}): WorkflowSessionState {
  const currentDecision = findPendingOptionalNodeDecision(
    input.session,
    input.action.nodeId,
  );
  if (currentDecision === undefined || currentDecision.status !== "pending") {
    throw new Error(
      `invalid manager control at '${input.managerNodeId}': optional node '${input.action.nodeId}' is not currently pending`,
    );
  }
  if (currentDecision.owningManagerNodeId !== input.managerNodeId) {
    throw new Error(
      `invalid manager control at '${input.managerNodeId}': optional node '${input.action.nodeId}' is owned by '${currentDecision.owningManagerNodeId}'`,
    );
  }

  const nodeRef = input.workflow.nodes.find(
    (entry) => entry.id === input.action.nodeId,
  );
  if (nodeRef?.execution?.mode !== "optional") {
    throw new Error(
      `invalid manager control at '${input.managerNodeId}': node '${input.action.nodeId}' is not optional`,
    );
  }

  return {
    ...input.session,
    pendingOptionalNodeDecisions: upsertPendingOptionalNodeDecision(
      input.session.pendingOptionalNodeDecisions ?? [],
      {
        ...currentDecision,
        status:
          input.action.type === "execute-optional-node" ? "execute" : "skip",
        ...(input.action.type === "skip-optional-node" &&
        input.action.reason !== undefined
          ? { reason: input.action.reason }
          : {}),
        decidedAt: input.decidedAt,
        decidedByNodeExecId: input.managerNodeExecId,
      },
    ),
  };
}

export type { DataDirFileRef };
