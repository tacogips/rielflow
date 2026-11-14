import type { WorkflowSessionState } from "../session";
import type { CallStepExecutionInput } from "./direct-step-helpers";
import { nowIso } from "./direct-step-helpers";

export function buildMissingDirectStepSession(
  input: CallStepExecutionInput,
): WorkflowSessionState {
  return {
    sessionId: input.workflowRunId,
    workflowName: "",
    workflowId: input.workflowId,
    status: "running",
    startedAt: nowIso(),
    queue: [],
    nodeExecutionCounter: 0,
    nodeExecutionCounts: {},
    transitions: [],
    nodeExecutions: [],
    communicationCounter: 0,
    communications: [],
    runtimeVariables: {},
  };
}

export function describeDirectStepFailure(
  finalOutputPayload: Readonly<Record<string, unknown>> | undefined,
): string {
  const payload = finalOutputPayload?.["payload"];
  if (typeof payload === "object" && payload !== null) {
    const providerMessage = (payload as Readonly<Record<string, unknown>>)[
      "providerErrorMessage"
    ];
    if (typeof providerMessage === "string" && providerMessage.length > 0) {
      return providerMessage;
    }
  }
  return finalOutputPayload?.["error"]?.toString() ?? "step call failed";
}
