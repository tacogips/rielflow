import type { NodeAdapter } from "./adapter";
import { err, ok, type Result } from "./result";
import {
  callStepExecution,
  type CallStepExecutionFailure,
  type CallStepExecutionInput,
  type DirectExecutionOverrides,
  type CallStepExecutionSuccess,
} from "./call-step-impl";

export interface CallStepOverrides extends DirectExecutionOverrides {}

export interface CallStepInput
  extends Omit<CallStepExecutionInput, "overrides"> {
  readonly overrides?: CallStepOverrides;
}

export interface CallStepSuccess extends CallStepExecutionSuccess {
  readonly stepId: string;
}

export interface CallStepFailure extends CallStepExecutionFailure {
  readonly stepId: string;
}

export async function callStep(
  input: CallStepInput,
  adapter?: NodeAdapter,
): Promise<Result<CallStepSuccess, CallStepFailure>> {
  const result = await callStepExecution(input, adapter);

  if (!result.ok) {
    return err({
      ...result.error,
      stepId: input.stepId,
    });
  }

  return ok({
    ...result.value,
    stepId: input.stepId,
  });
}
