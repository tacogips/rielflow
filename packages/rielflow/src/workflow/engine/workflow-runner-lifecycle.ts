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
  const { initializeWorkflowTelemetry } = await import("../../telemetry");
  const telemetry = initializeWorkflowTelemetry({
    ...(options.telemetry === undefined ? {} : { options: options.telemetry }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  return await telemetry.startResultSpan(
    "rielflow.workflow.run",
    {
      "workflow.name": workflowName,
      "workflow.resume": options.resumeSessionId !== undefined,
      "workflow.rerun": options.rerunFromSessionId !== undefined,
    },
    async () => {
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
        return sessionEntry.result as Result<
          WorkflowRunResult,
          WorkflowRunFailure
        >;
      }
      return (await runWorkflowQueue({
        ...setup.value,
        session: sessionEntry.session,
      })) as Result<WorkflowRunResult, WorkflowRunFailure>;
    },
  );
}
