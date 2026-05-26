import type { NodeAdapter } from "../adapter";
import { DispatchingNodeAdapter } from "../adapters/dispatch";
import type { Result } from "../result";
import { ScenarioNodeAdapter } from "../scenario-adapter";
import type {
  CallStepExecutionFailure,
  CallStepExecutionInput,
  CallStepExecutionSuccess,
} from "./direct-step-helpers";
import { ExecutionDispatcher } from "./direct-step-execution";

export async function callStepExecution(
  input: CallStepExecutionInput,
  adapter?: NodeAdapter,
): Promise<Result<CallStepExecutionSuccess, CallStepExecutionFailure>> {
  const effectiveAdapter =
    adapter ??
    (input.mockScenario === undefined
      ? new DispatchingNodeAdapter()
      : new ScenarioNodeAdapter(input.mockScenario));
  return new ExecutionDispatcher(effectiveAdapter, input).dispatch(input);
}
