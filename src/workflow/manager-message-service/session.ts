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
    case "retry-step":
      return {
        kind: "retry-step",
        targetId: action.stepId,
      };
    case "replay-communication":
      return {
        kind: "replay-communication",
        targetId: action.communicationId,
        ...(action.reason === undefined ? {} : { reason: action.reason }),
      };
    case "execute-optional-step":
      return {
        kind: "execute-optional-step",
        targetId: action.stepId,
      };
    case "skip-optional-step":
      return {
        kind: "skip-optional-step",
        targetId: action.stepId,
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

export function isTerminalStatus(status: string): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

export function applyOptionalNodeDecision(input: {
  readonly session: WorkflowSessionState;
  readonly workflow: WorkflowJson;
  readonly managerStepId: string;
  readonly managerNodeExecId: string;
  readonly action: Extract<
    ManagerControlAction,
    { readonly type: "execute-optional-step" | "skip-optional-step" }
  >;
  readonly decidedAt: string;
}): WorkflowSessionState {
  const optionalTargetNoun =
    input.workflow.steps !== undefined ? "step" : "node";
  const currentDecision = findPendingOptionalNodeDecision(
    input.session,
    input.action.stepId,
  );
  if (currentDecision === undefined || currentDecision.status !== "pending") {
    throw new Error(
      `invalid manager control at '${input.managerStepId}': optional ${optionalTargetNoun} '${input.action.stepId}' is not currently pending`,
    );
  }
  if (currentDecision.owningManagerStepId !== input.managerStepId) {
    throw new Error(
      `invalid manager control at '${input.managerStepId}': optional ${optionalTargetNoun} '${input.action.stepId}' is owned by '${currentDecision.owningManagerStepId}'`,
    );
  }

  const nodeRef = input.workflow.nodes.find(
    (entry) => entry.id === input.action.stepId,
  );
  if (nodeRef?.execution?.mode !== "optional") {
    throw new Error(
      `invalid manager control at '${input.managerStepId}': ${optionalTargetNoun} '${input.action.stepId}' is not optional`,
    );
  }

  return {
    ...input.session,
    pendingOptionalNodeDecisions: upsertPendingOptionalNodeDecision(
      input.session.pendingOptionalNodeDecisions ?? [],
      {
        ...currentDecision,
        status:
          input.action.type === "execute-optional-step" ? "execute" : "skip",
        ...(input.action.type === "skip-optional-step" &&
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
