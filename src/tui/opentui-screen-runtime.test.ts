import { describe, expect, test, vi } from "vitest";
import type { LoadedWorkflow } from "../workflow/load";
import type { NodePayload, WorkflowJson } from "../workflow/types";
import {
  buildNodeSelectOptions,
  buildNodeDefinitionPopupContent,
  buildSessionSelectOptions,
  buildWorkflowRunStatusContent,
  formatTimestampForDisplay,
  isAllowedNodeDetailKey,
  resolveOpenTuiPaneChrome,
  resolveWorkflowPreviewIndent,
} from "./opentui-model";
import { focusOpenTuiTarget } from "./opentui-screen";

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
          {
            id: "workflow-output",
            kind: "output",
            nodeFile: "node-workflow-output.json",
            completion: { type: "none" },
          },
        ],
        edges: [],
        loops: [],
      } as WorkflowJson,
      nodePayloads: {
        "node-divedra-manager.json": {
          id: "divedra-manager",
          model: "manager-model",
          promptTemplate: "Manage the workflow",
          variables: {},
        },
        "node-workflow-input.json": inputNodePayload,
        "node-workflow-output.json": {
          id: "workflow-output",
          model: "output-model",
          promptTemplate: "Return output",
          variables: {},
        },
      },
    },
  };
}

function makeRuntimeSessionView() {
  return {
    session: {
      sessionId: "sess-demo",
      workflowName: "demo",
      workflowId: "demo",
      status: "completed" as const,
      startedAt: "2026-03-24T00:00:00.000Z",
      endedAt: "2026-03-24T00:01:00.000Z",
      queue: [],
      currentNodeId: "workflow-output",
      nodeExecutionCounter: 1,
      nodeExecutionCounts: { "workflow-output": 1 },
      transitions: [],
      nodeExecutions: [
        {
          nodeId: "workflow-output",
          stepId: "publish-result",
          nodeExecId: "exec-1",
          status: "succeeded" as const,
          artifactDir: "/tmp/demo",
          startedAt: "2026-03-24T00:00:10.000Z",
          endedAt: "2026-03-24T00:00:20.000Z",
        },
      ],
      communicationCounter: 0,
      communications: [],
      runtimeVariables: {
        workflowOutput: { summary: "done" },
      },
    },
    nodeExecutions: [
      {
        sessionId: "sess-demo",
        nodeExecId: "exec-1",
        nodeId: "workflow-output",
        stepId: "publish-result",
        nodeRegistryId: "workflow-output",
        status: "succeeded",
        artifactDir: "/tmp/demo",
        startedAt: "2026-03-24T00:00:10.000Z",
        endedAt: "2026-03-24T00:00:20.000Z",
        attempt: null,
        outputAttemptCount: null,
        outputValidationErrors: null,
        backendSessionMode: null,
        backendSessionId: null,
        restartedFromNodeExecId: null,
        inputHash: "in",
        outputHash: "out",
        inputJson: "{}",
        outputJson: '{"summary":"done"}',
        createdAt: "2026-03-24T00:00:20.000Z",
      },
    ],
    nodeLogs: [
      {
        id: 1,
        sessionId: "sess-demo",
        nodeExecId: "exec-1",
        nodeId: "workflow-output",
        level: "info",
        message: "completed",
        payloadJson: null,
        at: "2026-03-24T00:00:20.000Z",
      },
    ],
  };
}

describe("buildNodeDefinitionPopupContent", () => {
  test("renders node reference and payload sections", () => {
    const loaded = makeLoadedWorkflow({
      id: "workflow-input",
      description: "Normalize the received request",
      model: "input-model",
      promptTemplate: "Normalize the request",
      variables: {},
    });

    const popup = buildNodeDefinitionPopupContent({
      loadedWorkflow: loaded,
      nodeId: "workflow-input",
    });

    expect(popup.title).toContain("workflow-input");
    expect(popup.body).toContain("workflow.json node entry");
    expect(popup.body).toContain("node payload");
  });

  test("step-addressed workflow uses registry-oriented popup labels", () => {
    const base = makeLoadedWorkflow({
      id: "workflow-input",
      description: "Normalize the received request",
      model: "input-model",
      promptTemplate: "Normalize the request",
      variables: {},
    });
    const loaded: LoadedWorkflow = {
      ...base,
      bundle: {
        ...base.bundle,
        workflow: {
          ...base.bundle.workflow,
          entryStepId: "step-in",
          managerStepId: "step-mgr",
          steps: [
            { id: "step-mgr", nodeId: "divedra-manager" },
            { id: "step-in", nodeId: "workflow-input" },
          ],
        },
      },
    };

    const popup = buildNodeDefinitionPopupContent({
      loadedWorkflow: loaded,
      nodeId: "workflow-input",
    });

    expect(popup.title).toContain("Node registry");
    expect(popup.body).toContain("workflow.json nodes[] entry");
    expect(popup.body).toContain("Registry node id:");
    expect(popup.body).toContain("node payload");
  });
});

describe("buildSessionSelectOptions", () => {
  test("separates and colors the workflow-run status label", () => {
    const options = buildSessionSelectOptions([
      {
        sessionId: "sess-1",
        workflowName: "demo",
        workflowId: "demo",
        status: "completed",
        startedAt: "2026-03-24T00:00:00.000Z",
        endedAt: "2026-03-24T00:01:00.000Z",
        currentNodeId: "workflow-output",
        nodeExecutionCounter: 2,
        lastError: null,
        updatedAt: "2026-03-24T00:01:00.000Z",
      },
    ]);

    expect(options[0]?.name).toBe(
      formatTimestampForDisplay("2026-03-24T00:00:00.000Z"),
    );
    expect(
      (options[0] as { statusLabel?: string } | undefined)?.statusLabel,
    ).toBe("COMPLETED");
  });
});

describe("buildNodeSelectOptions", () => {
  test("prefers step ids for execution row labels when they differ from node ids", () => {
    const loaded = makeLoadedWorkflow({
      id: "workflow-input",
      description: "Normalize the received request",
      model: "input-model",
      promptTemplate: "Normalize the request",
      variables: {},
    });

    const options = buildNodeSelectOptions(
      loaded,
      makeRuntimeSessionView().session,
    );

    expect(options[0]?.name).toContain("publish-result");
    expect(
      (options[0] as { detailLines?: readonly string[] } | undefined)
        ?.detailLines?.[1],
    ).toContain("node: workflow-output");
  });
});

describe("isAllowedNodeDetailKey", () => {
  test("allows arrows, j/k, tab, enter, ctrl-m, and escape in node detail", () => {
    expect(
      isAllowedNodeDetailKey({
        name: "up",
        shift: false,
        ctrl: false,
        meta: false,
      }),
    ).toBe(true);
    expect(
      isAllowedNodeDetailKey({
        name: "j",
        shift: false,
        ctrl: false,
        meta: false,
      }),
    ).toBe(true);
    expect(
      isAllowedNodeDetailKey({
        name: "k",
        shift: false,
        ctrl: false,
        meta: false,
      }),
    ).toBe(true);
    expect(
      isAllowedNodeDetailKey({
        name: "tab",
        shift: false,
        ctrl: false,
        meta: false,
      }),
    ).toBe(true);
    expect(
      isAllowedNodeDetailKey({
        name: "return",
        shift: false,
        ctrl: false,
        meta: false,
      }),
    ).toBe(true);
    expect(
      isAllowedNodeDetailKey({
        name: "m",
        shift: false,
        ctrl: true,
        meta: false,
      }),
    ).toBe(true);
    expect(
      isAllowedNodeDetailKey({
        name: "escape",
        shift: false,
        ctrl: false,
        meta: false,
      }),
    ).toBe(true);
  });

  test("rejects h/l and other history-wide shortcuts while node detail is focused", () => {
    expect(
      isAllowedNodeDetailKey({
        name: "h",
        shift: false,
        ctrl: false,
        meta: false,
      }),
    ).toBe(false);
    expect(
      isAllowedNodeDetailKey({
        name: "l",
        shift: false,
        ctrl: false,
        meta: false,
      }),
    ).toBe(false);
  });
});

describe("resolveOpenTuiPaneChrome", () => {
  test("marks workflow-definition nodes as active on the definition screen", () => {
    const chrome = resolveOpenTuiPaneChrome({
      filterText: "",
      focusPane: "nodes",
      hasRuntimeSession: false,
      historyPaneLabels: {
        header: "Workflow",
        left: "Workflow Runs",
        right: "Nodes",
      },
      inputMode: "json",
      inputSyntaxStatus: "valid",
      matchesCount: 0,
      screenMode: "definition",
      workflowCount: 0,
    });

    expect(chrome.workflowDefinition.title).toBe(" Workflow Definition ");
    expect(chrome.workflowDefinitionNodes.title).toBe(" >> Nodes << ");
    expect(chrome.workflowDefinitionNodes.borderColor).toBe("#4fd1ff");
  });

  test("marks node detail as active after history focus moves from nodes to detail", () => {
    const chrome = resolveOpenTuiPaneChrome({
      filterText: "",
      focusPane: "detail",
      hasRuntimeSession: true,
      historyPaneLabels: {
        header: "Workflow",
        left: "Workflow Runs",
        right: "Nodes",
      },
      inputMode: "json",
      inputSyntaxStatus: "valid",
      matchesCount: 0,
      screenMode: "history",
      workflowCount: 0,
    });

    expect(chrome.detail.title).toBe(" >> node detail << ");
    expect(chrome.detail.borderColor).toBe("#4fd1ff");
    expect(chrome.node.title).toBe(" Nodes ");
    expect(chrome.node.borderColor).toBe("#5b6670");
  });

  test("uses the select-a-run node title until a session is loaded", () => {
    const chrome = resolveOpenTuiPaneChrome({
      filterText: "",
      focusPane: "sessions",
      hasRuntimeSession: false,
      historyPaneLabels: {
        header: "Workflow",
        left: "Workflow Runs",
        right: "Nodes (select a run)",
      },
      inputMode: "text",
      inputSyntaxStatus: "not-applicable",
      matchesCount: 0,
      screenMode: "history",
      workflowCount: 0,
    });

    expect(chrome.node.title).toBe(" Nodes (select a run) ");
  });

  test("shows a persistent filtered indicator on the workspace workflow pane", () => {
    const chrome = resolveOpenTuiPaneChrome({
      filterText: "demo",
      focusPane: "workflows",
      hasRuntimeSession: false,
      historyPaneLabels: {
        header: "Workflow",
        left: "Workflow Runs",
        right: "Nodes",
      },
      inputMode: "text",
      inputSyntaxStatus: "not-applicable",
      matchesCount: 2,
      screenMode: "workspace",
      workflowCount: 5,
    });

    expect(chrome.workflow.title).toBe(" >> Workflows [filtered 2/5] << ");
  });

  test("includes a dedicated workspace latest-run pane title", () => {
    const chrome = resolveOpenTuiPaneChrome({
      filterText: "",
      focusPane: "workflows",
      hasRuntimeSession: false,
      historyPaneLabels: {
        header: "Workflow",
        left: "Workflow Runs",
        right: "Nodes",
      },
      inputMode: "text",
      inputSyntaxStatus: "not-applicable",
      matchesCount: 0,
      screenMode: "workspace",
      workflowCount: 3,
    });

    expect(chrome.workspaceHistory.title).toBe(" Latest Run Result ");
  });

  test("keeps workspace preview chrome inactive even when workspace focus is transiently elsewhere", () => {
    const chrome = resolveOpenTuiPaneChrome({
      filterText: "",
      focusPane: "input",
      hasRuntimeSession: false,
      historyPaneLabels: {
        header: "Workflow",
        left: "Workflow Runs",
        right: "Nodes",
      },
      inputMode: "text",
      inputSyntaxStatus: "not-applicable",
      matchesCount: 0,
      screenMode: "workspace",
      workflowCount: 3,
    });

    expect(chrome.selectorPreview.title).toBe(" Workflow Preview ");
  });
});

describe("focusOpenTuiTarget", () => {
  test("invokes the renderable focus lifecycle for keyboard-driven pane changes", () => {
    const target = {
      focus: vi.fn(),
    };

    focusOpenTuiTarget(target);

    expect(target.focus).toHaveBeenCalledTimes(1);
  });
});

describe("resolveWorkflowPreviewIndent", () => {
  test("keeps the root manager at indent zero regardless of derived indent", () => {
    expect(
      resolveWorkflowPreviewIndent({
        derivedIndent: 3,
        kind: "root-manager",
      }),
    ).toBe(0);
  });

  test("uses the visualization-derived indent for non-manager nodes", () => {
    expect(
      resolveWorkflowPreviewIndent({
        derivedIndent: 1,
        kind: "task",
      }),
    ).toBe(1);
  });

  test("uses zero derived indent for shallow task nodes", () => {
    expect(
      resolveWorkflowPreviewIndent({
        derivedIndent: 0,
        kind: "task",
      }),
    ).toBe(0);
  });
});

describe("buildWorkflowRunStatusContent", () => {
  test("shows a pre-launch hint before any session exists", () => {
    const loaded = makeLoadedWorkflow({
      id: "workflow-input",
      model: "input-model",
      promptTemplate: "Read free text",
      variables: {},
    });

    expect(
      buildWorkflowRunStatusContent({
        loadedWorkflow: loaded,
        runtimeSessionView: undefined,
      }),
    ).toContain("No run started yet.");
    expect(
      buildWorkflowRunStatusContent({
        loadedWorkflow: loaded,
        runtimeSessionView: undefined,
      }),
    ).toContain("Description: demo workflow");
  });

  test("shows concise workflow timing and final workflow output when available", () => {
    const loaded = makeLoadedWorkflow({
      id: "workflow-input",
      model: "input-model",
      promptTemplate: "Read free text",
      variables: {},
    });
    const content = buildWorkflowRunStatusContent({
      loadedWorkflow: loaded,
      runtimeSessionView: makeRuntimeSessionView(),
    });

    expect(content).toContain("Final result:");
    expect(content).toContain("Description: demo workflow");
    expect(content).toContain(
      `Started: ${formatTimestampForDisplay("2026-03-24T00:00:00.000Z")}`,
    );
    expect(content).toContain("Current step: publish-result");
    expect(content).toContain("Current node: workflow-output");
    expect(content).toContain("Latest log:");
    expect(content).not.toContain("Recent logs:");
  });
});
