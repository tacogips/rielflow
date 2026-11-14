// @ts-nocheck
import type { NodeAdapter } from "../adapter";
import { err, type Result } from "../result";
import type {
  EngineExecutionGuards,
  NormalizedWorkflowRunOptions,
  WorkflowRunFailure,
  WorkflowRunResult,
} from "./types-and-session-state";
import { prepareWorkflowRun } from "./run-setup";
import { enterWorkflowSession } from "./session-entry";
import { runWorkflowQueue } from "./node-execution";

export async function runWorkflowInternal(
  workflowName: string,
  options: NormalizedWorkflowRunOptions,
  adapter?: NodeAdapter,
  guards?: EngineExecutionGuards,
  crossWorkflowInvocationStack: readonly string[] = [],
): Promise<Result<WorkflowRunResult, WorkflowRunFailure>> {
  const setup = await prepareWorkflowRun({
    workflowName,
    options,
    adapter,
    guards,
    crossWorkflowInvocationStack,
  });
  if (!setup.ok) {
    return err(setup.error);
  }
  const sessionEntry = await enterWorkflowSession(setup.value);
  if (sessionEntry.kind === "result") {
    return sessionEntry.result;
  }
  return await runWorkflowQueue({
    ...setup.value,
    session: sessionEntry.session,
  });
}
