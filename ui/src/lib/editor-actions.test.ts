import { describe, expect, test, vi } from "vitest";
import type {
  ExecuteWorkflowResponse,
  SessionStatus,
  UiConfigResponse,
  WorkflowExecutionStateResponse,
  WorkflowExecutionSummary,
  WorkflowResponse,
} from "../../../src/shared/ui-contract";
import type {
  NormalizedWorkflowBundle,
  ValidationIssue,
} from "../../../src/workflow/types";
import {
  createEditorActions,
  type EditorActionDependencies,
} from "./editor-actions";
import { cloneEditableValue } from "./editor-workflow";
import {
  emptySessionPanelState,
  emptyWorkflowEditorState,
} from "./editor-state";

function makeWorkflowBundle(): NormalizedWorkflowBundle {
  return {
    workflow: {
      workflowId: "demo",
      description: "Demo workflow",
      defaults: {
        maxLoopIterations: 3,
        nodeTimeoutMs: 120000,
      },
      managerNodeId: "divedra-manager",
      subWorkflows: [],
      nodes: [
        {
          id: "divedra-manager",
          kind: "root-manager",
          nodeFile: "node-divedra-manager.json",
          completion: { type: "none" },
        },
        {
          id: "worker-1",
          kind: "task",
          nodeFile: "node-worker-1.json",
          completion: { type: "none" },
        },
      ],
      edges: [{ from: "divedra-manager", to: "worker-1", when: "always" }],
      loops: [],
      branching: { mode: "fan-out" },
    },
    workflowVis: {
      nodes: [
        { id: "divedra-manager", order: 0 },
        { id: "worker-1", order: 1 },
      ],
    },
    nodePayloads: {
      "divedra-manager": {
        id: "divedra-manager",
        model: "gpt-5",
        promptTemplate: "Coordinate",
        variables: {},
      },
      "worker-1": {
        id: "worker-1",
        model: "gpt-5",
        promptTemplate: "Work",
        variables: {},
      },
    },
  };
}

function makeWorkflowResponse(): WorkflowResponse {
  return {
    workflowName: "demo",
    revision: "rev-1",
    bundle: makeWorkflowBundle(),
    derivedVisualization: [],
  };
}

function makeSessionSummary(
  status: SessionStatus = "running",
): WorkflowExecutionSummary {
  return {
    workflowExecutionId: "exec-1",
    sessionId: "exec-1",
    workflowName: "demo",
    status,
    currentNodeId: "worker-1",
    nodeExecutionCounter: 1,
    startedAt: "2026-03-10T01:00:00.000Z",
    endedAt: status === "running" ? null : "2026-03-10T01:01:00.000Z",
  };
}

function makeSessionState(
  status: SessionStatus = "running",
): WorkflowExecutionStateResponse {
  return {
    workflowExecutionId: "exec-1",
    sessionId: "exec-1",
    workflowName: "demo",
    workflowId: "demo",
    status,
    startedAt: "2026-03-10T01:00:00.000Z",
    ...(status === "running" ? {} : { endedAt: "2026-03-10T01:01:00.000Z" }),
    queue: [],
    currentNodeId: "worker-1",
    nodeExecutionCounter: 1,
    nodeExecutionCounts: {},
    transitions: [],
    nodeExecutions: [],
    communicationCounter: 0,
    communications: [],
    runtimeVariables: {},
  };
}

function makeDependencies(
  overrides: Partial<EditorActionDependencies> = {},
): EditorActionDependencies {
  const config: UiConfigResponse = {
    fixedWorkflowName: null,
    readOnly: false,
    noExec: false,
    frontend: "solid-dist",
  };

  const runningStatus: SessionStatus = "running";

  return {
    loadConfig: vi.fn(async () => config),
    loadWorkflowPickerState: vi.fn(async () => ({
      workflows: ["demo"],
      selectedWorkflowName: "demo",
    })),
    loadWorkflowEditorData: vi.fn(async () => ({
      workflowState: {
        ...emptyWorkflowEditorState(),
        workflow: makeWorkflowResponse(),
        editableBundle: cloneEditableValue(makeWorkflowBundle()),
      },
      sessionPanelState: {
        sessions: [makeSessionSummary()],
        selectedExecutionId: "exec-1",
        selectedSession: makeSessionState(),
      },
      selectedSessionPollStatus: runningStatus,
    })),
    createWorkflowEditorData: vi.fn(async () => ({
      workflowName: "demo",
      workflowState: emptyWorkflowEditorState(),
      sessionPanelState: emptySessionPanelState(),
    })),
    loadWorkflowSessionPanelState: vi.fn(
      async (input: {
        workflowName: string;
        selectedExecutionId: string;
        allowPollingOnSelectedSession?: boolean;
      }) => ({
        sessionPanelState: {
          sessions: [makeSessionSummary()],
          selectedExecutionId: input.selectedExecutionId,
          selectedSession:
            input.selectedExecutionId.length > 0 ? makeSessionState() : null,
        },
        selectedSessionPollStatus:
          input.selectedExecutionId.length > 0 ? runningStatus : null,
      }),
    ),
    validateWorkflowBundle: vi.fn(async () => ({
      valid: true,
      issues: [],
      warnings: [
        {
          severity: "warning",
          path: "workflow.nodes[0]",
          message: "warn",
        } satisfies ValidationIssue,
      ],
    })),
    saveWorkflowBundle: vi.fn(async () => ({
      workflowName: "demo",
      revision: "rev-2",
    })),
    executeWorkflow: vi.fn(
      async (): Promise<ExecuteWorkflowResponse> => ({
        workflowExecutionId: "exec-2",
        sessionId: "exec-2",
        status: "running",
        accepted: true,
      }),
    ),
    cancelWorkflowExecution: vi.fn(async () => ({
      accepted: true,
      status: "cancelled" as const,
      workflowExecutionId: "exec-1",
      sessionId: "exec-1",
    })),
    ...overrides,
  };
}

describe("editor-actions", () => {
  test("returns empty editor state when refresh resolves no selectable workflow", async () => {
    const actions = createEditorActions(
      makeDependencies({
        loadWorkflowPickerState: vi.fn(async () => ({
          workflows: [],
          selectedWorkflowName: "",
        })),
      }),
    );

    const result = await actions.refresh({
      selectedWorkflowName: "",
      preferredNodeId: "",
      selectedExecutionId: "",
    });

    expect(result.workflowPickerState).toEqual({
      workflows: [],
      selectedWorkflowName: "",
    });
    expect(result.workflowState).toEqual(emptyWorkflowEditorState());
    expect(result.sessionPanelState).toEqual(emptySessionPanelState());
    expect(result.selectedSessionPollStatus).toBeNull();
  });

  test("builds validation summaries from merged validation issues", async () => {
    const actions = createEditorActions(makeDependencies());

    const result = await actions.validateWorkflow({
      workflowName: "demo",
      bundle: cloneEditableValue(makeWorkflowBundle()),
    });

    expect(result.validationIssues).toHaveLength(1);
    expect(result.validationSummary).toBe("Validation passed with 1 warning.");
    expect(result.infoMessage).toBe(result.validationSummary);
  });

  test("reloads the selected execution after execute and returns the accepted message", async () => {
    const deps = makeDependencies();
    const actions = createEditorActions(deps);

    const result = await actions.executeWorkflow({
      workflowName: "demo",
      request: {
        runtimeVariables: {},
        async: true,
      },
    });

    expect(result.sessionPanelState.selectedExecutionId).toBe("exec-2");
    expect(result.selectedSessionPollStatus).toBe("running");
    expect(result.infoMessage).toBe(
      "Execution accepted for 'demo' as execution exec-2.",
    );
    expect(deps.loadWorkflowSessionPanelState).toHaveBeenCalledWith({
      workflowName: "demo",
      selectedExecutionId: "exec-2",
      allowPollingOnSelectedSession: true,
    });
  });

  test("allows selected-session reloads to disable polling during follow-up refreshes", async () => {
    const deps = makeDependencies();
    const actions = createEditorActions(deps);

    await actions.selectSession({
      workflowName: "demo",
      workflowExecutionId: "exec-1",
      allowPollingOnSelectedSession: false,
    });

    expect(deps.loadWorkflowSessionPanelState).toHaveBeenCalledWith({
      workflowName: "demo",
      selectedExecutionId: "exec-1",
      allowPollingOnSelectedSession: false,
    });
  });

  test("reloads workflow data after save and returns the revision message", async () => {
    const deps = makeDependencies();
    const actions = createEditorActions(deps);

    const result = await actions.saveWorkflow({
      workflowName: "demo",
      bundle: cloneEditableValue(makeWorkflowBundle()),
      expectedRevision: "rev-1",
      preferredNodeId: "worker-1",
      selectedExecutionId: "exec-1",
    });

    expect(result.infoMessage).toBe("Saved workflow 'demo' at revision rev-2.");
    expect(deps.loadWorkflowEditorData).toHaveBeenCalledWith({
      workflowName: "demo",
      preferredNodeId: "worker-1",
      selectedExecutionId: "exec-1",
      allowPollingOnSelectedSession: true,
    });
  });
});
