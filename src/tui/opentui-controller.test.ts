import { describe, expect, test, vi } from "vitest";
import type { LoadedWorkflow } from "../workflow/load";
import type {
  NodeExecutionRecord,
  WorkflowSessionState,
} from "../workflow/session";
import type { RuntimeSessionSummary } from "../workflow/runtime-db";
import type { NodePayload, WorkflowJson } from "../workflow/types";
import {
  createOpenTuiController,
  resolveEditorTextForLoadedSession,
} from "./opentui-controller";
import type {
  FocusPane,
  RuntimeSessionView,
  ScreenMode,
  TuiWorkflowInputDetection,
} from "./opentui-model";

type LegacyEdgeWorkflow = WorkflowJson & {
  readonly edges?: readonly { from: string; to: string; when: string }[];
};

function makeLoadedWorkflow(inputNodePayload: NodePayload): LoadedWorkflow {
  return {
    workflowName: "demo",
    workflowDirectory: "/tmp/demo",
    artifactWorkflowRoot: "/tmp/artifacts/demo",
    bundle: {
      workflow: {
        workflowId: "demo",
        description: "demo workflow",
        defaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120_000,
        },
        nodes: [
          {
            id: "divedra-manager",
            kind: "root-manager",
            nodeFile: "node-divedra-manager.json",
            completion: { type: "none" },
          },
          {
            id: "workflow-input",
            kind: "input",
            nodeFile: "node-workflow-input.json",
            completion: { type: "none" },
          },
        ],
        edges: [],
        loops: [],
      } as LegacyEdgeWorkflow,
      nodePayloads: {
        "node-divedra-manager.json": {
          id: "divedra-manager",
          model: "manager-model",
          promptTemplate: "Manage the workflow",
          variables: {},
        },
        "node-workflow-input.json": inputNodePayload,
      },
    },
  };
}

function makeRuntimeSessionView(
  runtimeVariables: Readonly<Record<string, unknown>>,
): RuntimeSessionView {
  const session: WorkflowSessionState = {
    sessionId: "sess-1",
    workflowName: "demo",
    workflowId: "demo",
    status: "running",
    startedAt: "2026-03-26T00:00:00.000Z",
    queue: [],
    nodeExecutionCounter: 0,
    nodeExecutionCounts: {},
    loopIterationCounts: {},
    restartCounts: {},
    restartEvents: [],
    transitions: [],
    nodeExecutions: [],
    communicationCounter: 0,
    communications: [],
    conversationTurns: [],
    nodeBackendSessions: {},
    pendingOptionalNodeDecisions: [],
    activeUserActions: [],
    runtimeVariables,
  };
  return {
    session,
    nodeExecutions: [],
    nodeLogs: [],
  };
}

interface ControllerHarnessState {
  focusPane: FocusPane;
  inputText: string;
  lastStatus: string;
  loadedWorkflow: LoadedWorkflow | undefined;
  pendingRunRuntimeVariables: Readonly<Record<string, unknown>> | undefined;
  runConfirmationContent: string;
  runConfirmationOpen: boolean;
  runExecutionResult:
    | {
        readonly exitCode: number;
        readonly sessionId: string;
        readonly status: WorkflowSessionState["status"];
      }
    | undefined;
  runPendingSessionId: string | undefined;
  runStatusError: string | undefined;
  runtimeSessionView: RuntimeSessionView | undefined;
  screenMode: ScreenMode;
  selectedHistoryExecution: NodeExecutionRecord | undefined;
  selectedSessionSummary: RuntimeSessionSummary | undefined;
  selectedWorkflowName: string | undefined;
  workflowInputDetection: TuiWorkflowInputDetection;
}

interface ControllerHarnessOverrides {
  executeWorkflow?: (input: {
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
    readonly workflowName: string;
  }) => Promise<{
    readonly completion: Promise<{
      readonly exitCode: number;
      readonly sessionId: string;
      readonly status: WorkflowSessionState["status"];
    }>;
    readonly sessionId: string;
  }>;
  rerunWorkflow?: (input: {
    readonly sourceSessionId: string;
    readonly fromStepId: string;
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
  }) => Promise<{
    readonly exitCode: number;
    readonly sessionId: string;
    readonly status: WorkflowSessionState["status"];
  }>;
  withBusy?: (label: string, action: () => Promise<void>) => Promise<void>;
  state?: Partial<ControllerHarnessState>;
}

function createControllerHarness(overrides: ControllerHarnessOverrides = {}) {
  const state: ControllerHarnessState = {
    focusPane: "input",
    inputText: "",
    lastStatus: "",
    loadedWorkflow: makeLoadedWorkflow({
      id: "workflow-input",
      model: "input-model",
      promptTemplate: "Normalize the structured request",
      variables: {},
      argumentsTemplate: {
        request: {},
      },
      argumentBindings: [
        {
          targetPath: "request.title",
          source: "human-input",
          sourcePath: "title",
        },
      ],
    }),
    pendingRunRuntimeVariables: undefined,
    runConfirmationContent: "",
    runConfirmationOpen: false,
    runExecutionResult: undefined,
    runPendingSessionId: undefined,
    runStatusError: undefined,
    runtimeSessionView: undefined,
    screenMode: "run",
    selectedHistoryExecution: undefined,
    selectedSessionSummary: undefined,
    selectedWorkflowName: "demo",
    workflowInputDetection: {
      mode: "json",
      reason:
        "detected structured human-input bindings or JSON-oriented input prompts",
    },
    ...overrides.state,
  };

  const applyFocus = vi.fn((pane: FocusPane) => {
    state.focusPane = pane;
  });
  const render = vi.fn(async () => {});
  const refreshAll = vi.fn(async () => {});
  const refreshWorkflow = vi.fn(async () => {});
  const resetRunState = vi.fn(() => {
    state.runExecutionResult = undefined;
    state.runPendingSessionId = undefined;
    state.runStatusError = undefined;
  });
  const startRunPolling = vi.fn(() => {});
  const stopRunPolling = vi.fn(() => {});
  const executeWorkflow = vi.fn(
    overrides.executeWorkflow ??
      (async () => ({
        sessionId: "sess-started",
        completion: Promise.resolve({
          exitCode: 0,
          sessionId: "sess-started",
          status: "completed" as const,
        }),
      })),
  );
  const rerunWorkflow = vi.fn(
    overrides.rerunWorkflow ??
      (async () => ({
        exitCode: 0,
        sessionId: "rerun-1",
        status: "completed" as const,
      })),
  );
  const withBusy = vi.fn(
    overrides.withBusy ??
      (async (_label: string, action: () => Promise<void>) => {
        await action();
      }),
  );

  const controller = createOpenTuiController({
    applyFocus,
    copyToClipboard: () => true,
    executeWorkflow,
    getFocusPane: () => state.focusPane,
    getInputText: () => state.inputText,
    getLoadedWorkflow: () => state.loadedWorkflow,
    getPendingRunRuntimeVariables: () => state.pendingRunRuntimeVariables,
    getRuntimeSessionView: () => state.runtimeSessionView,
    getScreenMode: () => state.screenMode,
    getSelectedDefinitionNodeId: () => undefined,
    getSelectedHistoryExecution: () => state.selectedHistoryExecution,
    getSelectedManagerSessionId: () => undefined,
    getSelectedNodeExecution: () => undefined,
    getSelectedSessionSummary: () => state.selectedSessionSummary,
    getSelectedWorkflowName: () => state.selectedWorkflowName,
    getSelectedWorkspaceWorkflowId: () => undefined,
    getWorkflowInputDetection: () => state.workflowInputDetection,
    refreshAll,
    refreshWorkflow,
    render,
    rerunWorkflow,
    resetRunState,
    resumeWorkflow: async () => ({
      exitCode: 0,
      sessionId: "resume-1",
      status: "completed" as const,
    }),
    setInputText: (value) => {
      state.inputText = value;
    },
    setPendingRunRuntimeVariables: (value) => {
      state.pendingRunRuntimeVariables = value;
    },
    setRunConfirmationContent: (content) => {
      state.runConfirmationContent = content;
    },
    setRunConfirmationOpen: (open) => {
      state.runConfirmationOpen = open;
    },
    setRunExecutionResult: (result) => {
      state.runExecutionResult = result;
    },
    setRunPendingSessionId: (sessionId) => {
      state.runPendingSessionId = sessionId;
    },
    setRunStatusError: (message) => {
      state.runStatusError = message;
    },
    setStatus: (message) => {
      state.lastStatus = message;
    },
    setWorkflowInputDetection: (detection) => {
      state.workflowInputDetection = detection;
    },
    startRunPolling,
    stopRunPolling,
    withBusy,
  });

  return {
    applyFocus,
    controller,
    executeWorkflow,
    refreshWorkflow,
    render,
    rerunWorkflow,
    resetRunState,
    startRunPolling,
    stopRunPolling,
    state,
    withBusy,
  };
}

describe("createOpenTuiController", () => {
  test("openRunConfirmation captures runtime variables and focuses the input pane", async () => {
    const harness = createControllerHarness({
      state: {
        inputText: '{ "title": "Ship it" }',
      },
    });

    await harness.controller.openRunConfirmation();

    expect(harness.state.pendingRunRuntimeVariables).toEqual({
      humanInput: { title: "Ship it" },
      promptJson: { title: "Ship it" },
      userPromptJson: { title: "Ship it" },
    });
    expect(harness.state.runConfirmationOpen).toBe(true);
    expect(harness.state.runConfirmationContent).toContain(
      "Start workflow 'demo'?",
    );
    expect(harness.state.lastStatus).toBe("Confirm new run for 'demo'");
    expect(harness.applyFocus).toHaveBeenCalledWith("input");
  });

  test("confirmRun keeps pending confirmation state when workflow startup fails", async () => {
    const harness = createControllerHarness({
      executeWorkflow: async () => {
        throw new Error("boom");
      },
      state: {
        pendingRunRuntimeVariables: {
          humanInput: { title: "Ship it" },
          promptJson: { title: "Ship it" },
          userPromptJson: { title: "Ship it" },
        },
        runConfirmationOpen: true,
      },
      withBusy: async (_label, action) => {
        try {
          await action();
        } catch {
          return;
        }
      },
    });

    await harness.controller.confirmRun();

    expect(harness.executeWorkflow).toHaveBeenCalledTimes(1);
    expect(harness.state.pendingRunRuntimeVariables).toEqual({
      humanInput: { title: "Ship it" },
      promptJson: { title: "Ship it" },
      userPromptJson: { title: "Ship it" },
    });
    expect(harness.state.runConfirmationOpen).toBe(true);
    expect(harness.applyFocus).not.toHaveBeenCalled();
  });

  test("confirmRun clears pending confirmation state only after startup succeeds", async () => {
    const harness = createControllerHarness({
      state: {
        pendingRunRuntimeVariables: {
          humanInput: { title: "Ship it" },
          promptJson: { title: "Ship it" },
          userPromptJson: { title: "Ship it" },
        },
        runConfirmationOpen: true,
      },
    });

    await harness.controller.confirmRun();

    expect(harness.executeWorkflow).toHaveBeenCalledWith({
      workflowName: "demo",
      runtimeVariables: {
        humanInput: { title: "Ship it" },
        promptJson: { title: "Ship it" },
        userPromptJson: { title: "Ship it" },
      },
    });
    expect(harness.resetRunState).toHaveBeenCalledTimes(1);
    expect(harness.startRunPolling).toHaveBeenCalledTimes(1);
    expect(harness.state.pendingRunRuntimeVariables).toBeUndefined();
    expect(harness.state.runConfirmationOpen).toBe(false);
    expect(harness.state.runPendingSessionId).toBe("sess-started");
    expect(harness.applyFocus).toHaveBeenCalledWith("input");
  });

  test("confirmRun stops polling when the background run completion fails", async () => {
    const harness = createControllerHarness({
      executeWorkflow: async () => ({
        sessionId: "sess-started",
        completion: Promise.reject(new Error("background boom")),
      }),
      state: {
        pendingRunRuntimeVariables: {
          humanInput: { title: "Ship it" },
          promptJson: { title: "Ship it" },
          userPromptJson: { title: "Ship it" },
        },
        runConfirmationOpen: true,
      },
    });

    await harness.controller.confirmRun();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.startRunPolling).toHaveBeenCalledTimes(1);
    expect(harness.stopRunPolling).toHaveBeenCalledTimes(1);
    expect(harness.state.runStatusError).toBe("background boom");
    expect(harness.state.lastStatus).toBe("Run failed: background boom");
  });

  test("rerunWorkflow prefers step-addressed execution targets when available", async () => {
    const harness = createControllerHarness({
      state: {
        inputText: '{ "request": "retry" }',
        runtimeSessionView: makeRuntimeSessionView({}),
        selectedHistoryExecution: {
          artifactDir: "/tmp/demo/executions/step-1",
          endedAt: "2026-03-26T00:00:10.000Z",
          nodeExecId: "exec-1",
          nodeId: "shared-worker",
          startedAt: "2026-03-26T00:00:05.000Z",
          status: "succeeded",
          stepId: "review-step",
        },
      },
    });

    await harness.controller.rerunWorkflow();

    expect(harness.withBusy).toHaveBeenCalledWith(
      "Rerunning step 'review-step' from sess-1",
      expect.any(Function),
    );
    expect(harness.rerunWorkflow).toHaveBeenCalledWith({
      sourceSessionId: "sess-1",
      fromStepId: "review-step",
      runtimeVariables: {
        humanInput: { request: "retry" },
        promptJson: { request: "retry" },
        rerunPrompt: { request: "retry" },
        userPromptJson: { request: "retry" },
      },
    });
    expect(harness.refreshWorkflow).toHaveBeenCalledWith("demo", "rerun-1");
    expect(harness.state.lastStatus).toBe(
      "Rerun finished: rerun-1 status=completed exitCode=0",
    );
  });

  test("rerunWorkflow rejects legacy node-addressed executions without a step id", async () => {
    const harness = createControllerHarness({
      state: {
        inputText: '{ "request": "retry" }',
        runtimeSessionView: makeRuntimeSessionView({}),
        selectedHistoryExecution: {
          artifactDir: "/tmp/demo/executions/node-1",
          endedAt: "2026-03-26T00:00:10.000Z",
          nodeExecId: "exec-1",
          nodeId: "shared-worker",
          startedAt: "2026-03-26T00:00:05.000Z",
          status: "succeeded",
        },
      },
    });

    await harness.controller.rerunWorkflow();

    expect(harness.rerunWorkflow).not.toHaveBeenCalled();
    expect(harness.state.lastStatus).toBe(
      "Cannot rerun a legacy node-addressed execution; this surface requires an authored stepId",
    );
  });
});

describe("resolveEditorTextForLoadedSession", () => {
  test("falls back to mode-specific empty editor text when no session is loaded", () => {
    expect(
      resolveEditorTextForLoadedSession({
        detection: { mode: "json", reason: "manual" },
        runtimeSessionView: undefined,
      }),
    ).toBe("{}");
    expect(
      resolveEditorTextForLoadedSession({
        detection: { mode: "text", reason: "manual" },
        runtimeSessionView: undefined,
      }),
    ).toBe("");
  });

  test("rehydrates loaded runtime variables using the active input mode", () => {
    expect(
      resolveEditorTextForLoadedSession({
        detection: { mode: "text", reason: "manual" },
        runtimeSessionView: makeRuntimeSessionView({
          humanInput: "hello world",
        }),
      }),
    ).toBe("hello world");
    expect(
      resolveEditorTextForLoadedSession({
        detection: { mode: "json", reason: "manual" },
        runtimeSessionView: makeRuntimeSessionView({
          promptJson: { title: "Ship it" },
        }),
      }),
    ).toBe('{\n  "title": "Ship it"\n}');
  });
});
