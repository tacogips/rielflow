import { loadSession } from "../workflow/session-store";
import { createEventSupervisedRunRepository } from "./supervised-runs";
import type {
  SequentialListCompletionInput,
  SequentialListCompletionObserver,
  SequentialListTerminalResult,
} from "./source-adapter";
import type { WorkflowTriggerRunnerOptions } from "./workflow-trigger-runner-options";

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_MISSING_OBSERVATION_ATTEMPTS = 3;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function terminalSessionResult(input: {
  readonly status: string;
  readonly workflowExecutionId: string;
}): SequentialListTerminalResult | undefined {
  if (input.status === "completed") {
    return {
      status: "completed",
      workflowExecutionId: input.workflowExecutionId,
    };
  }
  if (input.status === "failed") {
    return {
      status: "failed",
      workflowExecutionId: input.workflowExecutionId,
      error: "workflow execution failed",
    };
  }
  if (input.status === "cancelled") {
    return {
      status: "cancelled",
      workflowExecutionId: input.workflowExecutionId,
      error: "workflow execution cancelled",
    };
  }
  return undefined;
}

function terminalSupervisedResult(input: {
  readonly status: string;
  readonly supervisedRunId: string;
  readonly workflowExecutionId?: string;
  readonly supervisorExecutionId?: string;
}): SequentialListTerminalResult | undefined {
  if (input.status === "completed") {
    return {
      status: "completed",
      supervisedRunId: input.supervisedRunId,
      ...(input.workflowExecutionId === undefined
        ? {}
        : { workflowExecutionId: input.workflowExecutionId }),
      ...(input.supervisorExecutionId === undefined
        ? {}
        : { supervisorExecutionId: input.supervisorExecutionId }),
    };
  }
  if (input.status === "failed" || input.status === "stopped") {
    return {
      status: input.status === "failed" ? "failed" : "cancelled",
      supervisedRunId: input.supervisedRunId,
      ...(input.workflowExecutionId === undefined
        ? {}
        : { workflowExecutionId: input.workflowExecutionId }),
      ...(input.supervisorExecutionId === undefined
        ? {}
        : { supervisorExecutionId: input.supervisorExecutionId }),
      error:
        input.status === "failed"
          ? "supervised run failed"
          : "supervised run stopped",
    };
  }
  return undefined;
}

export function createSequentialListCompletionObserver(
  options: WorkflowTriggerRunnerOptions = {},
): SequentialListCompletionObserver {
  return {
    async waitForTerminal(
      input: SequentialListCompletionInput,
    ): Promise<SequentialListTerminalResult> {
      if (
        input.workflowExecutionId === undefined &&
        input.supervisedRunId === undefined &&
        input.supervisorExecutionId === undefined
      ) {
        return {
          status: "failed",
          error: "sequential-list item completion cannot be observed",
        };
      }

      const repository = createEventSupervisedRunRepository(options);
      let missingObservationAttempts = 0;
      while (!input.signal.aborted) {
        let observedState = false;
        if (input.supervisedRunId !== undefined) {
          const supervised = await repository.loadById(input.supervisedRunId);
          if (supervised !== null) {
            observedState = true;
            const terminal = terminalSupervisedResult({
              status: supervised.status,
              supervisedRunId: supervised.supervisedRunId,
              ...(supervised.activeTargetExecutionId === undefined
                ? {}
                : { workflowExecutionId: supervised.activeTargetExecutionId }),
              ...(supervised.supervisorExecutionId === undefined
                ? {}
                : { supervisorExecutionId: supervised.supervisorExecutionId }),
            });
            if (terminal !== undefined) {
              return terminal;
            }
          }
        }

        if (input.workflowExecutionId !== undefined) {
          const session = await loadSession(input.workflowExecutionId, options);
          if (session.ok) {
            observedState = true;
            const terminal = terminalSessionResult({
              status: session.value.status,
              workflowExecutionId: input.workflowExecutionId,
            });
            if (terminal !== undefined) {
              return terminal;
            }
          }
        }

        if (!observedState) {
          missingObservationAttempts += 1;
          if (
            missingObservationAttempts >= DEFAULT_MISSING_OBSERVATION_ATTEMPTS
          ) {
            return {
              status: "failed",
              ...(input.workflowExecutionId === undefined
                ? {}
                : { workflowExecutionId: input.workflowExecutionId }),
              ...(input.supervisedRunId === undefined
                ? {}
                : { supervisedRunId: input.supervisedRunId }),
              ...(input.supervisorExecutionId === undefined
                ? {}
                : { supervisorExecutionId: input.supervisorExecutionId }),
              error: "sequential-list item completion could not be observed",
            };
          }
        } else {
          missingObservationAttempts = 0;
        }

        await delay(DEFAULT_POLL_INTERVAL_MS, input.signal);
      }

      return {
        status: "cancelled",
        ...(input.workflowExecutionId === undefined
          ? {}
          : { workflowExecutionId: input.workflowExecutionId }),
        ...(input.supervisedRunId === undefined
          ? {}
          : { supervisedRunId: input.supervisedRunId }),
        ...(input.supervisorExecutionId === undefined
          ? {}
          : { supervisorExecutionId: input.supervisorExecutionId }),
        error: "sequential-list completion wait was cancelled",
      };
    },
  };
}
