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

const CALL_STEP_LITERAL_MESSAGE_REPLACEMENTS = [
  [
    "direct call-node execution is not supported",
    "direct step execution is not supported",
  ],
  [
    "direct call-step execution is not supported",
    "direct step execution is not supported",
  ],
  [
    "native node did not produce mailbox output",
    "native step did not produce mailbox output",
  ],
  ["native node execution", "native step execution"],
  ["cannot call node '", "cannot call step '"],
  ["node execution produced no output", "step execution produced no output"],
  ["node execution failed", "step execution failed"],
  ["node call failed", "step call failed"],
  ["executable node fields", "executable fields"],
  ["call-node", "call-step"],
  ["call node", "call step"],
] as const;

/** Rewrites leftover node-oriented failure text for {@link callStep}. */
export function rewriteCallStepFailureMessage(
  message: string,
  stepId: string,
): string {
  const stepScopedReplacements = [
    [
      `missing node definition for '${stepId}'`,
      `missing step definition for '${stepId}'`,
    ],
    [`node '${stepId}'`, `step '${stepId}'`],
    [
      `execution mailbox at '${stepId}'`,
      `execution mailbox for step '${stepId}'`,
    ],
  ] as const;
  return [...CALL_STEP_LITERAL_MESSAGE_REPLACEMENTS, ...stepScopedReplacements]
    .reduce(
      (currentMessage, [before, after]) =>
        currentMessage.replaceAll(before, after),
      message,
    );
}

export async function callStep(
  input: CallStepInput,
  adapter?: NodeAdapter,
): Promise<Result<CallStepSuccess, CallStepFailure>> {
  // Delegate straight to the internal direct-step executor. The runtime keeps
  // `nodeExecution.nodeId` in the materialized step id namespace, while
  // `nodeRegistryId` preserves the reusable payload registry id separately.
  const result = await callStepExecution(input, adapter);

  if (!result.ok) {
    const message = rewriteCallStepFailureMessage(
      result.error.message,
      input.stepId,
    );
    const session =
      result.error.session.lastError === undefined
        ? result.error.session
        : {
            ...result.error.session,
            lastError: rewriteCallStepFailureMessage(
              result.error.session.lastError,
              input.stepId,
            ),
          };
    return err({
      ...result.error,
      session,
      message,
      stepId: input.stepId,
    });
  }

  return ok({
    ...result.value,
    stepId: input.stepId,
  });
}
