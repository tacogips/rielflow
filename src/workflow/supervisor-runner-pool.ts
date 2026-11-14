import type { EventBinding, EventSupervisorCommand } from "../events/types";
import type {
  SupervisedWorkflowLookup,
  SupervisedWorkflowView,
  SupervisorEngineOverrides,
  WorkflowSupervisorClient,
} from "./supervisor-client-types";

export interface SupervisorRunnerPoolHandle {
  readonly runnerPoolRunId: string;
  readonly supervisedRunId: string;
  readonly workflowExecutionId: string;
  wait(): Promise<SupervisedWorkflowView>;
  cancel(reason?: string): Promise<SupervisedWorkflowView>;
}

export interface SupervisorRunnerPool {
  dispatch(input: {
    readonly command: EventSupervisorCommand;
    readonly binding: EventBinding;
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
    readonly engine?: SupervisorEngineOverrides;
  }): Promise<SupervisedWorkflowView>;
  lookup(lookup: SupervisedWorkflowLookup): Promise<SupervisedWorkflowView>;
  cancel(lookup: SupervisedWorkflowLookup): Promise<SupervisedWorkflowView>;
  lookupHandle(
    lookup: SupervisedWorkflowLookup,
  ): SupervisorRunnerPoolHandle | undefined;
}

function indexKey(
  label: string,
  value: string | undefined,
): string | undefined {
  return value === undefined || value.length === 0
    ? undefined
    : `${label}:${value}`;
}

function correlationIndexKey(input: {
  readonly sourceId?: string;
  readonly bindingId?: string;
  readonly correlationKey?: string;
}): string | undefined {
  if (
    input.sourceId === undefined ||
    input.bindingId === undefined ||
    input.correlationKey === undefined
  ) {
    return undefined;
  }
  return `correlation:${input.sourceId}\t${input.bindingId}\t${input.correlationKey}`;
}

function isTerminalSupervisedView(view: SupervisedWorkflowView): boolean {
  return (
    view.supervisedRun.status === "completed" ||
    view.supervisedRun.status === "failed" ||
    view.supervisedRun.status === "stopped" ||
    view.activeTargetStatus === "completed" ||
    view.activeTargetStatus === "failed" ||
    view.activeTargetStatus === "cancelled"
  );
}

export function createSupervisorRunnerPool(input: {
  readonly client: WorkflowSupervisorClient;
  readonly newRunnerPoolRunId?: () => string;
}): SupervisorRunnerPool {
  const byKey = new Map<string, SupervisorRunnerPoolHandle>();
  let sequence = 0;

  function nextRunnerPoolRunId(): string {
    if (input.newRunnerPoolRunId !== undefined) {
      return input.newRunnerPoolRunId();
    }
    sequence += 1;
    return `spr-${String(sequence).padStart(6, "0")}`;
  }

  function removeHandle(handle: SupervisorRunnerPoolHandle): void {
    for (const [key, existing] of byKey) {
      if (existing.runnerPoolRunId === handle.runnerPoolRunId) {
        byKey.delete(key);
      }
    }
  }

  function storeHandle(
    view: SupervisedWorkflowView,
    task: Promise<SupervisedWorkflowView>,
  ): void {
    const workflowExecutionId = view.supervisedRun.activeTargetExecutionId;
    if (workflowExecutionId === undefined || isTerminalSupervisedView(view)) {
      return;
    }
    const runnerPoolRunId = nextRunnerPoolRunId();
    const supervisedRunId = view.supervisedRun.supervisedRunId;
    const handle: SupervisorRunnerPoolHandle = {
      runnerPoolRunId,
      supervisedRunId,
      workflowExecutionId,
      wait: async () => {
        try {
          const finalView = await task;
          if (isTerminalSupervisedView(finalView)) {
            removeHandle(handle);
          }
          return finalView;
        } catch (error: unknown) {
          removeHandle(handle);
          throw error;
        }
      },
      cancel: async (reason?: string) => {
        const stopped = await input.client.stop({
          supervisedRunId,
          ...(reason === undefined ? {} : { reason }),
        });
        removeHandle(handle);
        return stopped;
      },
    };
    void task.catch(() => {
      removeHandle(handle);
    });
    const keys = [
      indexKey("runnerPoolRunId", runnerPoolRunId),
      indexKey("supervisedRunId", supervisedRunId),
      indexKey("workflowExecutionId", workflowExecutionId),
      correlationIndexKey(view.supervisedRun),
      indexKey("workflowKey", view.supervisedRun.targetWorkflowName),
    ].filter((key): key is string => key !== undefined);
    for (const key of keys) {
      byKey.set(key, handle);
    }
  }

  function findHandle(
    lookup: SupervisedWorkflowLookup,
  ): SupervisorRunnerPoolHandle | undefined {
    const keys = [
      indexKey("runnerPoolRunId", lookup.runnerPoolRunId),
      indexKey("supervisedRunId", lookup.supervisedRunId),
      indexKey("workflowExecutionId", lookup.workflowExecutionId),
      indexKey("workflowKey", lookup.workflowKey ?? lookup.alias),
      correlationIndexKey(lookup),
    ].filter((key): key is string => key !== undefined);
    for (const key of keys) {
      const handle = byKey.get(key);
      if (handle !== undefined) {
        return handle;
      }
    }
    return undefined;
  }

  return {
    async dispatch(dispatchInput): Promise<SupervisedWorkflowView> {
      let asyncTask: Promise<SupervisedWorkflowView> | undefined;
      const view = await input.client.dispatchCommand({
        ...dispatchInput,
        engine: {
          ...dispatchInput.engine,
          asyncRun: true,
          onAsyncRun: (run) => {
            asyncTask = run.task;
          },
        },
      });
      if (asyncTask !== undefined) {
        storeHandle(view, asyncTask);
      }
      return view;
    },
    async lookup(lookup): Promise<SupervisedWorkflowView> {
      return await input.client.status(lookup);
    },
    async cancel(lookup): Promise<SupervisedWorkflowView> {
      const handle = findHandle(lookup);
      if (handle === undefined) {
        throw new Error(
          "no active in-process supervisor runner-pool handle matches the lookup",
        );
      }
      return await handle.cancel();
    },
    lookupHandle: findHandle,
  };
}
