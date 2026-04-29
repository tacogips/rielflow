import type { CommunicationRecord } from "./session";
import {
  resolveWorkflowManagerStepId,
  type NodeRole,
  type WorkflowJson,
} from "./types";

export type ManagerControlActionType =
  | "planner-note"
  | "retry-step"
  | "replay-communication"
  | "execute-optional-step"
  | "skip-optional-step";

export interface PlannerNoteAction {
  readonly type: "planner-note";
}

export interface RetryStepAction {
  readonly type: "retry-step";
  readonly stepId: string;
}

export interface ReplayCommunicationAction {
  readonly type: "replay-communication";
  readonly communicationId: string;
  readonly reason?: string;
}

export interface ExecuteOptionalStepAction {
  readonly type: "execute-optional-step";
  readonly stepId: string;
}

export interface SkipOptionalStepAction {
  readonly type: "skip-optional-step";
  readonly stepId: string;
  readonly reason?: string;
}

export type ManagerControlAction =
  | PlannerNoteAction
  | RetryStepAction
  | ReplayCommunicationAction
  | ExecuteOptionalStepAction
  | SkipOptionalStepAction;

export interface ParsedManagerControl {
  readonly actions: readonly ManagerControlAction[];
  readonly retryStepIds: readonly string[];
  readonly replayCommunicationIds: readonly string[];
  readonly executeOptionalStepIds: readonly string[];
  readonly skipOptionalStepIds: readonly string[];
}

export interface ManagerControlParseContext {
  readonly managerStepId: string;
  readonly managerRole?: NodeRole;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmedStringField(
  value: Readonly<Record<string, unknown>>,
  fieldName: string,
  actionLabel: string,
): string {
  const fieldValue = value[fieldName];
  if (typeof fieldValue !== "string" || fieldValue.trim().length === 0) {
    throw new Error(`${actionLabel}.${fieldName} must be a non-empty string`);
  }
  return fieldValue.trim();
}

function readOptionalTrimmedStringField(
  value: Readonly<Record<string, unknown>>,
  fieldName: string,
  actionLabel: string,
): string | undefined {
  const fieldValue = value[fieldName];
  if (fieldValue === undefined) {
    return undefined;
  }
  if (typeof fieldValue !== "string") {
    throw new Error(`${actionLabel}.${fieldName} must be a string when provided`);
  }
  const trimmed = fieldValue.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function parseManagerControlActionInput(
  value: unknown,
): ManagerControlAction {
  if (!isRecord(value)) {
    throw new Error("managerControl.actions[] must be an object");
  }

  const type = value["type"];
  if (typeof type !== "string") {
    throw new Error("managerControl.actions[].type must be a string");
  }

  switch (type) {
    case "planner-note":
      return {
        type,
      };
    case "retry-step":
      return {
        type: "retry-step",
        stepId: readTrimmedStringField(
          value,
          "stepId",
          "managerControl.actions[]",
        ),
      };
    case "execute-optional-step":
      return {
        type: "execute-optional-step",
        stepId: readTrimmedStringField(
          value,
          "stepId",
          "managerControl.actions[]",
        ),
      };
    case "skip-optional-step": {
      const reason = readOptionalTrimmedStringField(
        value,
        "reason",
        "managerControl.actions[]",
      );
      return {
        type: "skip-optional-step",
        stepId: readTrimmedStringField(
          value,
          "stepId",
          "managerControl.actions[]",
        ),
        ...(reason === undefined ? {} : { reason }),
      };
    }
    case "replay-communication": {
      const reason = readOptionalTrimmedStringField(
        value,
        "reason",
        "managerControl.actions[]",
      );
      return {
        type,
        communicationId: readTrimmedStringField(
          value,
          "communicationId",
          "managerControl.actions[]",
        ),
        ...(reason === undefined ? {} : { reason }),
      };
    }
    default:
      throw new Error(
        `managerControl.actions[].type '${type}' is not supported`,
      );
  }
}

function dedupe(values: readonly string[]): readonly string[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

function isWorkflowManagerControlContext(
  workflow: WorkflowJson,
  context: ManagerControlParseContext,
): boolean {
  return (
    context.managerStepId === resolveWorkflowManagerStepId(workflow) &&
    context.managerRole !== "worker"
  );
}

function assertOptionalStepDecisionScope(
  workflow: WorkflowJson,
  context: ManagerControlParseContext,
  stepId: string,
  actionType: "execute-optional-step" | "skip-optional-step",
): void {
  const node = workflow.nodes.find((entry) => entry.id === stepId);
  if (node === undefined) {
    throw new Error(
      `managerControl ${actionType} step '${stepId}' does not exist`,
    );
  }
  if (node.id === context.managerStepId) {
    throw new Error(
      `managerControl ${actionType} step '${stepId}' cannot target the manager itself`,
    );
  }
  if (node.execution?.mode !== "optional") {
    throw new Error(
      `managerControl ${actionType} step '${stepId}' must reference a node with workflow execution.mode 'optional'`,
    );
  }

  if (isWorkflowManagerControlContext(workflow, context)) {
    return;
  }

  throw new Error(
    `manager '${context.managerStepId}' does not have a recognized control scope`,
  );
}

export function assertCommunicationInManagerScope(
  _communication: CommunicationRecord,
  workflow: WorkflowJson,
  context: ManagerControlParseContext,
  _operationLabel = "managerControl",
): void {
  if (isWorkflowManagerControlContext(workflow, context)) {
    return;
  }

  throw new Error(
    `manager '${context.managerStepId}' does not have a recognized control scope`,
  );
}

export function parseManagerControlActions(
  actionsRaw: readonly unknown[],
  workflow: WorkflowJson,
  context: ManagerControlParseContext,
): ParsedManagerControl {
  const actions = actionsRaw.map((entry) =>
    parseManagerControlActionInput(entry),
  );
  for (const action of actions) {
    if (action.type === "planner-note") {
      continue;
    }

    if (action.type === "replay-communication") {
      continue;
    }

    if (
      action.type === "execute-optional-step" ||
      action.type === "skip-optional-step"
    ) {
      assertOptionalStepDecisionScope(
        workflow,
        context,
        action.stepId,
        action.type,
      );
      continue;
    }

    const node = workflow.nodes.find((entry) => entry.id === action.stepId);
    if (node === undefined) {
      throw new Error(
        `managerControl retry step '${action.stepId}' does not exist`,
      );
    }
    if (action.stepId === context.managerStepId) {
      throw new Error(
        `managerControl retry step '${action.stepId}' cannot target the manager itself`,
      );
    }
    if (!isWorkflowManagerControlContext(workflow, context)) {
      throw new Error(
        `manager '${context.managerStepId}' does not have a recognized control scope`,
      );
    }
  }

  const retryStepIds = dedupe(
    actions
      .filter((entry): entry is RetryStepAction => entry.type === "retry-step")
      .map((entry) => entry.stepId),
  );
  const replayCommunicationIds = dedupe(
    actions
      .filter(
        (entry): entry is ReplayCommunicationAction =>
          entry.type === "replay-communication",
      )
      .map((entry) => entry.communicationId),
  );
  const executeOptionalStepIds = dedupe(
    actions
      .filter(
        (entry): entry is ExecuteOptionalStepAction =>
          entry.type === "execute-optional-step",
      )
      .map((entry) => entry.stepId),
  );
  const skipOptionalStepIds = dedupe(
    actions
      .filter(
        (entry): entry is SkipOptionalStepAction =>
          entry.type === "skip-optional-step",
      )
      .map((entry) => entry.stepId),
  );

  return {
    actions,
    retryStepIds,
    replayCommunicationIds,
    executeOptionalStepIds,
    skipOptionalStepIds,
  };
}

export function parseManagerControlPayload(
  payload: Readonly<Record<string, unknown>>,
  workflow: WorkflowJson,
  context: ManagerControlParseContext,
): ParsedManagerControl | null {
  const managerControlRaw = payload["managerControl"];
  if (managerControlRaw === undefined) {
    return null;
  }
  if (!isRecord(managerControlRaw)) {
    throw new Error("payload.managerControl must be an object when provided");
  }

  const actionsRaw = managerControlRaw["actions"];
  if (actionsRaw === undefined) {
    return {
      actions: [],
      retryStepIds: [],
      replayCommunicationIds: [],
      executeOptionalStepIds: [],
      skipOptionalStepIds: [],
    };
  }
  if (!Array.isArray(actionsRaw)) {
    throw new Error(
      "payload.managerControl.actions must be an array when provided",
    );
  }

  return parseManagerControlActions(actionsRaw, workflow, context);
}
