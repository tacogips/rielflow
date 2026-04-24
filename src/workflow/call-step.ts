import { err, ok, type Result } from "./result";
import {
  callNode,
  type CallNodeFailure,
  type CallNodeInput,
  type DirectExecutionOverrides,
  type CallNodeSuccess,
} from "./call-node";

export interface CallStepOverrides extends DirectExecutionOverrides {}

export interface CallStepInput
  extends Omit<CallNodeInput, "nodeId" | "overrides"> {
  readonly stepId: string;
  readonly overrides?: CallStepOverrides;
}

export interface CallStepSuccess extends CallNodeSuccess {
  readonly stepId: string;
}

export interface CallStepFailure extends CallNodeFailure {
  readonly stepId: string;
}

function rewriteCallStepFailureMessage(
  message: string,
  stepId: string,
): string {
  return message
    .replaceAll(
      `missing node definition for '${stepId}'`,
      `missing step definition for '${stepId}'`,
    )
    .replaceAll(`node '${stepId}'`, `step '${stepId}'`)
    .replaceAll("call-node", "call-step")
    .replaceAll("call node", "call step");
}

export async function callStep(
  input: CallStepInput,
): Promise<Result<CallStepSuccess, CallStepFailure>> {
  const result = await callNode({
    ...input,
    nodeId: input.stepId,
  });

  if (!result.ok) {
    return err({
      ...result.error,
      message: rewriteCallStepFailureMessage(
        result.error.message,
        input.stepId,
      ),
      stepId: input.stepId,
    });
  }

  return ok({
    ...result.value,
    stepId: input.stepId,
  });
}
