import type { NodeAdapter } from "./adapter";
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

function escapeRegExpChars(value: string): string {
  return value.replace(/[\\^$*+?.()|[\]{}]/g, "\\$&");
}

/** Rewrites `call-node` failure text when the entrypoint was {@link callStep}. */
export function rewriteCallStepFailureMessage(
  message: string,
  stepId: string,
): string {
  const promptVariantPattern = new RegExp(
    `node '${escapeRegExpChars(stepId)}' does not define prompt variant`,
    "g",
  );
  message = message.replace(
    promptVariantPattern,
    `step '${stepId}' does not define prompt variant`,
  );
  return message
    .replaceAll("native node execution", "native step execution")
    .replaceAll(
      "native node did not produce mailbox output",
      "native step did not produce mailbox output",
    )
    .replaceAll("cannot call node '", "cannot call step '")
    .replaceAll("node execution failed", "step execution failed")
    .replaceAll("node call failed", "step call failed")
    .replaceAll(
      "node execution produced no output",
      "step execution produced no output",
    )
    .replaceAll("executable node fields", "executable fields")
    .replaceAll(
      `missing node definition for '${stepId}'`,
      `missing step definition for '${stepId}'`,
    )
    .replaceAll(`node '${stepId}'`, `step '${stepId}'`)
    .replaceAll(
      `execution mailbox at '${stepId}'`,
      `execution mailbox for step '${stepId}'`,
    )
    .replaceAll("call-node", "call-step")
    .replaceAll("call node", "call step");
}

export async function callStep(
  input: CallStepInput,
  adapter?: NodeAdapter,
): Promise<Result<CallStepSuccess, CallStepFailure>> {
  // Step-addressed validation materializes each step as a runtime node ref with
  // `nodes[].id === step.id` (see `normalizeStepAddressedWorkflow`), and node
  // payloads are keyed the same way in the loaded bundle. Delegate to `callNode`
  // using that execution address without re-resolving `step.nodeId` here.
  const result = await callNode(
    {
      ...input,
      nodeId: input.stepId,
    },
    adapter,
  );

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
