import type { AutoImprovePolicyInput } from "divedra-core";
import { buildLibraryWorkflowRunOptions } from "./lib-workflow-run-options";
import { runWorkflow } from "divedra-core";
import { loadSession, type SessionStoreOptions } from "divedra-core";
import type { WorkflowSessionState } from "divedra-core";
import type { MockNodeScenario } from "./workflow/scenario-adapter";
import type { LoadOptions } from "divedra-core";

export type DivedraContinuationOptions = LoadOptions & SessionStoreOptions;

export interface ContinueWorkflowFromHistoryInput
  extends DivedraContinuationOptions {
  readonly sourceWorkflowExecutionId: string;
  /** Inclusive imported-history boundary (`nodeExecId` / step-run id). */
  readonly afterStepRunId: string;
  /** Entry step id for the new workflow execution. */
  readonly startStepId: string;
  readonly workflowWorkingDirectory?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly mockScenario?: MockNodeScenario;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly dryRun?: boolean;
  readonly autoImprove?: AutoImprovePolicyInput;
  readonly nestedSuperviserDriver?: boolean;
}

export async function continueWorkflowFromHistory(
  input: ContinueWorkflowFromHistoryInput,
): Promise<{
  readonly sessionId: string;
  readonly status: WorkflowSessionState["status"];
  readonly exitCode: number;
  readonly continuedAfterStepRunId: string;
  readonly continuedStartStepId: string;
}> {
  const source = await loadSession(input.sourceWorkflowExecutionId, input);
  if (!source.ok) {
    throw new Error(source.error.message);
  }
  const result = await runWorkflow(source.value.workflowName, {
    ...buildLibraryWorkflowRunOptions(input, {
      includeRuntimeVariables: true,
      includeExecutionLimits: true,
      includeDryRun: true,
      ...(input.autoImprove === undefined
        ? {}
        : { autoImprove: input.autoImprove }),
    }),
    continueFromWorkflowExecutionId: source.value.sessionId,
    continueAfterStepRunId: input.afterStepRunId,
    continueStartStepId: input.startStepId,
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return {
    sessionId: result.value.session.sessionId,
    status: result.value.session.status,
    exitCode: result.value.exitCode,
    continuedAfterStepRunId: input.afterStepRunId.trim(),
    continuedStartStepId: input.startStepId.trim(),
  };
}
