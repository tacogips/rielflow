import { describe, expect, test, vi } from "vitest";
import { createSupervisorRunnerPool } from "./supervisor-runner-pool";
import type {
  SupervisedWorkflowView,
  WorkflowSupervisorClient,
} from "./supervisor-client-types";
import type { EventBinding, EventSupervisorCommand } from "../events/types";

const binding: EventBinding = {
  id: "binding-1",
  sourceId: "source-1",
  workflowName: "workflow-a",
  inputMapping: { mode: "event-input" },
  execution: { mode: "supervised" },
};

const command: EventSupervisorCommand = {
  commandId: "cmd-1",
  sourceId: "source-1",
  bindingId: "binding-1",
  correlationKey: "conv-1",
  action: "start",
  args: ["arg-1"],
  targetWorkflowName: "workflow-a",
  receivedEventReceiptId: "receipt-1",
};

const runningView: SupervisedWorkflowView = {
  supervisedRun: {
    supervisedRunId: "run-1",
    sourceId: "source-1",
    bindingId: "binding-1",
    correlationKey: "conv-1",
    supervisorWorkflowName: "divedra-default-workflow-supervisor",
    targetWorkflowName: "workflow-a",
    activeTargetExecutionId: "session-1",
    status: "running",
    restartCount: 0,
    maxRestartsOnFailure: 3,
    autoImproveEnabled: false,
    createdAt: "2026-05-06T00:00:00.000Z",
    updatedAt: "2026-05-06T00:00:00.000Z",
  },
  activeTargetStatus: "running",
};

const completedView: SupervisedWorkflowView = {
  supervisedRun: {
    ...runningView.supervisedRun,
    status: "completed",
    updatedAt: "2026-05-06T00:02:00.000Z",
  },
  activeTargetStatus: "completed",
};

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function buildClient(input?: {
  readonly asyncTask?: Promise<SupervisedWorkflowView>;
  readonly view?: SupervisedWorkflowView;
}): WorkflowSupervisorClient {
  const view = input?.view ?? runningView;
  const stoppedView: SupervisedWorkflowView = {
    supervisedRun: {
      ...view.supervisedRun,
      status: "stopped",
      updatedAt: "2026-05-06T00:01:00.000Z",
    },
  };
  return {
    dispatchCommand: vi.fn(async (dispatchInput) => {
      if (input?.asyncTask !== undefined) {
        dispatchInput.engine?.onAsyncRun?.({
          supervisedRunId: view.supervisedRun.supervisedRunId,
          workflowExecutionId:
            view.supervisedRun.activeTargetExecutionId ?? "session-1",
          task: input.asyncTask,
        });
      }
      return view;
    }),
    status: vi.fn(async () => view),
    stop: vi.fn(async () => stoppedView),
    start: vi.fn(),
    restart: vi.fn(),
    submitInput: vi.fn(),
  };
}

describe("createSupervisorRunnerPool", () => {
  test("indexes active in-process handles by run and correlation", async () => {
    const client = buildClient({ asyncTask: new Promise(() => {}) });
    const pool = createSupervisorRunnerPool({
      client,
      newRunnerPoolRunId: () => "pool-1",
    });

    const view = await pool.dispatch({
      command,
      binding,
      runtimeVariables: {},
    });

    expect(view.supervisedRun.supervisedRunId).toBe("run-1");
    expect(pool.lookupHandle({ supervisedRunId: "run-1" })).toMatchObject({
      runnerPoolRunId: "pool-1",
      workflowExecutionId: "session-1",
    });
    expect(
      pool.lookupHandle({
        sourceId: "source-1",
        bindingId: "binding-1",
        correlationKey: "conv-1",
      }),
    ).toMatchObject({ supervisedRunId: "run-1" });
  });

  test("refuses live-handle-only cancel when no active handle exists", async () => {
    const pool = createSupervisorRunnerPool({ client: buildClient() });

    await expect(pool.cancel({ supervisedRunId: "missing" })).rejects.toThrow(
      /no active in-process supervisor runner-pool handle.*cancel/,
    );
  });

  test("wait follows the live async workflow task and prunes terminal handles", async () => {
    const deferred = createDeferred<SupervisedWorkflowView>();
    const pool = createSupervisorRunnerPool({
      client: buildClient({ asyncTask: deferred.promise }),
      newRunnerPoolRunId: () => "pool-async",
    });

    await pool.dispatch({
      command,
      binding,
      runtimeVariables: {},
    });
    const handle = pool.lookupHandle({ supervisedRunId: "run-1" });
    expect(handle).toBeDefined();

    let settled = false;
    const waitResult = handle?.wait().then((view) => {
      settled = true;
      return view;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    deferred.resolve(completedView);
    await expect(waitResult).resolves.toEqual(completedView);
    expect(settled).toBe(true);
    expect(pool.lookupHandle({ supervisedRunId: "run-1" })).toBeUndefined();
  });

  test("successful async completion prunes handles without wait", async () => {
    const deferred = createDeferred<SupervisedWorkflowView>();
    const pool = createSupervisorRunnerPool({
      client: buildClient({ asyncTask: deferred.promise }),
      newRunnerPoolRunId: () => "pool-unobserved",
    });

    await pool.dispatch({
      command,
      binding,
      runtimeVariables: {},
    });
    expect(pool.lookupHandle({ supervisedRunId: "run-1" })).toBeDefined();

    deferred.resolve(completedView);
    await deferred.promise;
    await Promise.resolve();

    expect(pool.lookupHandle({ supervisedRunId: "run-1" })).toBeUndefined();
    await expect(pool.cancel({ supervisedRunId: "run-1" })).rejects.toThrow(
      /no active in-process supervisor runner-pool handle.*cancel/,
    );
  });

  test("does not replace a live async handle with inspection dispatches", async () => {
    const deferred = createDeferred<SupervisedWorkflowView>();
    const client = buildClient({ asyncTask: deferred.promise });
    const pool = createSupervisorRunnerPool({
      client,
      newRunnerPoolRunId: () => "pool-live",
    });

    await pool.dispatch({
      command,
      binding,
      runtimeVariables: {},
    });
    const liveHandle = pool.lookupHandle({ supervisedRunId: "run-1" });
    expect(liveHandle?.runnerPoolRunId).toBe("pool-live");

    (client.dispatchCommand as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => ({
        ...runningView,
        commandResult: { kind: "status", targetStatus: "running" },
      }),
    );
    await pool.dispatch({
      command: { ...command, commandId: "cmd-status", action: "status" },
      binding,
      runtimeVariables: {},
    });

    expect(pool.lookupHandle({ supervisedRunId: "run-1" })).toBe(liveHandle);
    const waitResult = liveHandle?.wait();
    deferred.resolve(completedView);
    await expect(waitResult).resolves.toEqual(completedView);
  });

  test("rejects ambiguous mutating convenience lookups and honors strong ids", async () => {
    const first = createDeferred<SupervisedWorkflowView>();
    const second = createDeferred<SupervisedWorkflowView>();
    const secondView: SupervisedWorkflowView = {
      ...runningView,
      supervisedRun: {
        ...runningView.supervisedRun,
        supervisedRunId: "run-2",
        activeTargetExecutionId: "session-2",
      },
    };
    const firstClient = buildClient({
      asyncTask: first.promise,
      view: runningView,
    });
    const secondClient = buildClient({
      asyncTask: second.promise,
      view: secondView,
    });
    const dispatchClient: WorkflowSupervisorClient = {
      ...firstClient,
      dispatchCommand: vi
        .fn()
        .mockImplementationOnce(firstClient.dispatchCommand)
        .mockImplementationOnce(secondClient.dispatchCommand),
      status: vi.fn(async (lookup) =>
        lookup.supervisedRunId === "run-2" ? secondView : runningView,
      ),
      stop: vi.fn(async (lookup) => ({
        supervisedRun: {
          ...(lookup.supervisedRunId === "run-2"
            ? secondView.supervisedRun
            : runningView.supervisedRun),
          status: "stopped" as const,
          updatedAt: "2026-05-06T00:01:00.000Z",
        },
      })),
    };
    let sequence = 0;
    const pool = createSupervisorRunnerPool({
      client: dispatchClient,
      newRunnerPoolRunId: () => {
        sequence += 1;
        return `pool-${sequence}`;
      },
    });

    await pool.dispatch({ command, binding, runtimeVariables: {} });
    await pool.dispatch({
      command: { ...command, commandId: "cmd-2" },
      binding,
      runtimeVariables: {},
    });

    await expect(pool.cancel({ workflowKey: "workflow-a" })).rejects.toThrow(
      /ambiguous.*pool-1, pool-2/,
    );
    await expect(
      pool.cancel({
        sourceId: "source-1",
        bindingId: "binding-1",
        correlationKey: "conv-1",
      }),
    ).rejects.toThrow(/ambiguous.*pool-1, pool-2/);
    await expect(
      pool.cancel({
        supervisedRunId: "missing-run",
        sourceId: "source-1",
        bindingId: "binding-1",
        correlationKey: "conv-1",
      }),
    ).rejects.toThrow(
      /no active in-process supervisor runner-pool handle.*cancel/,
    );
    expect(dispatchClient.stop).toHaveBeenCalledTimes(0);

    await expect(
      pool.cancel({ workflowExecutionId: "session-2" }),
    ).resolves.toMatchObject({
      supervisedRun: { supervisedRunId: "run-2", status: "stopped" },
    });
    expect(pool.lookupHandle({ runnerPoolRunId: "pool-1" })).toMatchObject({
      supervisedRunId: "run-1",
    });

    first.resolve(completedView);
    second.resolve({
      ...completedView,
      supervisedRun: {
        ...secondView.supervisedRun,
        status: "completed",
        updatedAt: "2026-05-06T00:02:00.000Z",
      },
      activeTargetStatus: "completed",
    });
  });

  test("pool wait returns durable terminal status after live handle pruning", async () => {
    const deferred = createDeferred<SupervisedWorkflowView>();
    const client = buildClient({ asyncTask: deferred.promise });
    const pool = createSupervisorRunnerPool({
      client,
      newRunnerPoolRunId: () => "pool-wait",
    });

    await pool.dispatch({ command, binding, runtimeVariables: {} });
    deferred.resolve(completedView);

    await expect(pool.wait({ supervisedRunId: "run-1" })).resolves.toEqual(
      completedView,
    );
    expect(pool.lookupHandle({ supervisedRunId: "run-1" })).toBeUndefined();
    (client.status as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      completedView,
    );
    await expect(
      pool.wait({ workflowExecutionId: "session-1" }),
    ).resolves.toEqual(completedView);
  });
});
