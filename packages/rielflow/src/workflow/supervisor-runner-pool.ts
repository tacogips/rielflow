import type {
  SupervisedWorkflowLookup,
  SupervisedWorkflowView,
  SupervisorEngineOverrides,
  WorkflowSupervisorBinding,
  WorkflowSupervisorClient,
  WorkflowSupervisorCommand,
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
    readonly command: WorkflowSupervisorCommand;
    readonly binding: WorkflowSupervisorBinding;
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
    readonly engine?: SupervisorEngineOverrides;
  }): Promise<SupervisedWorkflowView>;
  lookup(lookup: SupervisedWorkflowLookup): Promise<SupervisedWorkflowView>;
  cancel(lookup: SupervisedWorkflowLookup): Promise<SupervisedWorkflowView>;
  wait(lookup: SupervisedWorkflowLookup): Promise<SupervisedWorkflowView>;
  lookupHandle(
    lookup: SupervisedWorkflowLookup,
  ): SupervisorRunnerPoolHandle | undefined;
  lookupHandles(
    lookup: SupervisedWorkflowLookup,
  ): readonly SupervisorRunnerPoolHandle[];
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

type SupervisorTargetResolution =
  | { readonly kind: "single"; readonly handle: SupervisorRunnerPoolHandle }
  | {
      readonly kind: "ambiguous";
      readonly matchedRunIds: readonly string[];
    }
  | { readonly kind: "not-found" };

export function createSupervisorRunnerPool(input: {
  readonly client: WorkflowSupervisorClient;
  readonly newRunnerPoolRunId?: () => string;
}): SupervisorRunnerPool {
  const byKey = new Map<string, Map<string, SupervisorRunnerPoolHandle>>();
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
      existing.delete(handle.runnerPoolRunId);
      if (existing.size === 0) {
        byKey.delete(key);
      }
    }
  }

  function addHandleKey(key: string, handle: SupervisorRunnerPoolHandle): void {
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, new Map([[handle.runnerPoolRunId, handle]]));
      return;
    }
    existing.set(handle.runnerPoolRunId, handle);
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
    void task.then(
      (finalView) => {
        if (isTerminalSupervisedView(finalView)) {
          removeHandle(handle);
        }
      },
      () => {
        removeHandle(handle);
      },
    );
    const keys = [
      indexKey("runnerPoolRunId", runnerPoolRunId),
      indexKey("supervisedRunId", supervisedRunId),
      indexKey("workflowExecutionId", workflowExecutionId),
      correlationIndexKey(view.supervisedRun),
      indexKey("workflowKey", view.supervisedRun.targetWorkflowName),
    ].filter((key): key is string => key !== undefined);
    for (const key of keys) {
      addHandleKey(key, handle);
    }
  }

  function handlesForKey(
    key: string | undefined,
  ): readonly SupervisorRunnerPoolHandle[] {
    if (key === undefined) {
      return [];
    }
    return [...(byKey.get(key)?.values() ?? [])];
  }

  function uniqueHandles(
    handles: readonly SupervisorRunnerPoolHandle[],
  ): readonly SupervisorRunnerPoolHandle[] {
    return [
      ...new Map(
        handles.map((handle) => [handle.runnerPoolRunId, handle] as const),
      ).values(),
    ];
  }

  function resolveTarget(
    lookup: SupervisedWorkflowLookup,
  ): SupervisorTargetResolution {
    const strongKeys = [
      indexKey("runnerPoolRunId", lookup.runnerPoolRunId),
      indexKey("supervisedRunId", lookup.supervisedRunId),
      indexKey("workflowExecutionId", lookup.workflowExecutionId),
    ].filter((key): key is string => key !== undefined);
    let strongHandle: SupervisorRunnerPoolHandle | undefined;
    for (const key of strongKeys) {
      const handles = handlesForKey(key);
      if (handles.length === 0) {
        return { kind: "not-found" };
      }
      if (handles.length === 1) {
        const handle = handles[0];
        if (handle !== undefined) {
          if (
            strongHandle !== undefined &&
            strongHandle.runnerPoolRunId !== handle.runnerPoolRunId
          ) {
            return {
              kind: "ambiguous",
              matchedRunIds: [
                strongHandle.runnerPoolRunId,
                handle.runnerPoolRunId,
              ],
            };
          }
          strongHandle = handle;
        }
      }
      if (handles.length > 1) {
        return {
          kind: "ambiguous",
          matchedRunIds: handles.map((handle) => handle.runnerPoolRunId),
        };
      }
    }
    if (strongHandle !== undefined) {
      return { kind: "single", handle: strongHandle };
    }
    const convenienceHandles = uniqueHandles([
      ...handlesForKey(indexKey("workflowKey", lookup.workflowKey)),
      ...handlesForKey(indexKey("workflowKey", lookup.alias)),
      ...handlesForKey(correlationIndexKey(lookup)),
    ]);
    if (convenienceHandles.length === 0) {
      return { kind: "not-found" };
    }
    if (convenienceHandles.length === 1) {
      const handle = convenienceHandles[0];
      if (handle !== undefined) {
        return { kind: "single", handle };
      }
    }
    return {
      kind: "ambiguous",
      matchedRunIds: convenienceHandles.map((handle) => handle.runnerPoolRunId),
    };
  }

  function findHandle(
    lookup: SupervisedWorkflowLookup,
  ): SupervisorRunnerPoolHandle | undefined {
    const resolution = resolveTarget(lookup);
    return resolution.kind === "single" ? resolution.handle : undefined;
  }

  function findHandles(
    lookup: SupervisedWorkflowLookup,
  ): readonly SupervisorRunnerPoolHandle[] {
    const resolution = resolveTarget(lookup);
    if (resolution.kind !== "single") {
      return [];
    }
    return [resolution.handle];
  }

  function ambiguousTargetError(
    action: "lookup" | "cancel" | "wait",
    matchedRunIds: readonly string[],
  ): Error {
    return new Error(
      `${action} target is ambiguous for active supervisor runner-pool handles; use runnerPoolRunId, supervisedRunId, or workflowExecutionId (${matchedRunIds.join(", ")})`,
    );
  }

  function notLiveError(action: "cancel" | "wait"): Error {
    return new Error(
      `no active in-process supervisor runner-pool handle matches the lookup for ${action}`,
    );
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
      const resolution = resolveTarget(lookup);
      if (resolution.kind === "ambiguous") {
        throw ambiguousTargetError("lookup", resolution.matchedRunIds);
      }
      if (resolution.kind === "single") {
        return await input.client.status({
          ...lookup,
          supervisedRunId: resolution.handle.supervisedRunId,
        });
      }
      return await input.client.status(lookup);
    },
    async cancel(lookup): Promise<SupervisedWorkflowView> {
      const resolution = resolveTarget(lookup);
      if (resolution.kind === "ambiguous") {
        throw ambiguousTargetError("cancel", resolution.matchedRunIds);
      }
      if (resolution.kind === "not-found") {
        throw notLiveError("cancel");
      }
      return await resolution.handle.cancel();
    },
    async wait(lookup): Promise<SupervisedWorkflowView> {
      const resolution = resolveTarget(lookup);
      if (resolution.kind === "ambiguous") {
        throw ambiguousTargetError("wait", resolution.matchedRunIds);
      }
      if (resolution.kind === "not-found") {
        const view = await input.client.status(lookup);
        if (isTerminalSupervisedView(view)) {
          return view;
        }
        throw notLiveError("wait");
      }
      return await resolution.handle.wait();
    },
    lookupHandle: findHandle,
    lookupHandles: findHandles,
  };
}
