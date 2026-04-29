import { isJsonObject } from "../shared/json";

export type SupervisorChatDecisionAction =
  | "ignore"
  | "start"
  | "stop"
  | "restart"
  | "status"
  | "input";

export interface SupervisorChatCommandDecision {
  readonly action: SupervisorChatDecisionAction;
  readonly managedWorkflowName: string;
  readonly confidence: number;
  readonly reason: string;
  readonly commandText?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
}

const DECISION_ACTIONS = new Set<string>([
  "ignore",
  "start",
  "stop",
  "restart",
  "status",
  "input",
]);

function isSupervisorChatDecisionAction(
  value: unknown,
): value is SupervisorChatDecisionAction {
  return typeof value === "string" && DECISION_ACTIONS.has(value);
}

/**
 * Strict structural parse of a supervisor chat command decision from an unknown JSON value.
 * Returns ok with the validated decision, or ok=false with an error message.
 */
export function parseSupervisorChatCommandDecision(
  value: unknown,
):
  | { readonly ok: true; readonly value: SupervisorChatCommandDecision }
  | { readonly ok: false; readonly error: string } {
  if (!isJsonObject(value)) {
    return { ok: false, error: "decision must be a JSON object" };
  }

  const action = value["action"];
  if (!isSupervisorChatDecisionAction(action)) {
    return {
      ok: false,
      error: `action must be one of: ${[...DECISION_ACTIONS].join(", ")}; got ${JSON.stringify(action)}`,
    };
  }

  const managedWorkflowName = value["managedWorkflowName"];
  if (
    typeof managedWorkflowName !== "string" ||
    managedWorkflowName.trim().length === 0
  ) {
    return {
      ok: false,
      error: "managedWorkflowName must be a non-empty string",
    };
  }

  const confidence = value["confidence"];
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return { ok: false, error: "confidence must be a finite number" };
  }

  const reason = value["reason"];
  if (typeof reason !== "string") {
    return { ok: false, error: "reason must be a string" };
  }

  const commandText = value["commandText"];
  if (commandText !== undefined && typeof commandText !== "string") {
    return { ok: false, error: "commandText must be a string when present" };
  }

  const runtimeVariables = value["runtimeVariables"];
  if (runtimeVariables !== undefined && !isJsonObject(runtimeVariables)) {
    return {
      ok: false,
      error: "runtimeVariables must be an object when present",
    };
  }

  return {
    ok: true,
    value: {
      action,
      managedWorkflowName: managedWorkflowName.trim(),
      confidence,
      reason,
      ...(commandText === undefined ? {} : { commandText }),
      ...(runtimeVariables === undefined
        ? {}
        : {
            runtimeVariables: runtimeVariables as Readonly<
              Record<string, unknown>
            >,
          }),
    },
  };
}
