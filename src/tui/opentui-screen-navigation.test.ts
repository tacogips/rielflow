import { describe, expect, test } from "vitest";
import type { LoadedWorkflow } from "../workflow/load";
import type { NodePayload } from "../workflow/types";
import {
  buildDetailEscapeStatusMessage,
  buildNodeSelectOptions,
  buildOpenTuiBreadcrumb,
  buildWorkflowDefinitionNodeSelectOptions,
  resolveDirectionalNavigationAction,
  resolveHistoryAdvanceAction,
  resolveHistoryRevertAction,
  resolveNodeDetailEscape,
  resolveOpenTuiCopyTarget,
  resolveOpenTuiInternallyHandledListId,
  resolveTabFocusTarget,
} from "./opentui-model";

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
        managerNodeId: "divedra-manager",
        subWorkflows: [
          {
            id: "delivery",
            description: "delivery",
            managerNodeId: "divedra-manager",
            inputNodeId: "workflow-input",
            outputNodeId: "workflow-output",
            nodeIds: ["workflow-input", "workflow-output"],
            inputSources: [{ type: "human-input" }],
            block: { type: "plain" },
          },
        ],
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
        branching: { mode: "fan-out" },
      },
      workflowVis: {
        nodes: [
          { id: "divedra-manager", order: 0 },
          { id: "workflow-input", order: 1 },
          { id: "workflow-output", order: 2 },
        ],
      },
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

describe("resolveTabFocusTarget", () => {
  test("cycles between definition panes", () => {
    expect(
      resolveTabFocusTarget({
        direction: "next",
        navigation: {
          focusPane: "definition",
          screenMode: "definition",
        },
      }),
    ).toBe("nodes");
    expect(
      resolveTabFocusTarget({
        direction: "previous",
        navigation: {
          focusPane: "nodes",
          screenMode: "definition",
        },
      }),
    ).toBe("definition");
  });

  test("cycles forward across history panes only", () => {
    expect(
      resolveTabFocusTarget({
        direction: "next",
        navigation: {
          focusPane: "sessions",
          screenMode: "history",
        },
      }),
    ).toBe("nodes");
    expect(
      resolveTabFocusTarget({
        direction: "next",
        navigation: {
          focusPane: "nodes",
          screenMode: "history",
        },
      }),
    ).toBe("detail");
    expect(
      resolveTabFocusTarget({
        direction: "next",
        navigation: {
          focusPane: "detail",
          screenMode: "history",
        },
      }),
    ).toBe("input");
    expect(
      resolveTabFocusTarget({
        direction: "next",
        navigation: {
          focusPane: "input",
          screenMode: "history",
        },
      }),
    ).toBe("sessions");
  });

  test("cycles backward across history panes only", () => {
    expect(
      resolveTabFocusTarget({
        direction: "previous",
        navigation: {
          focusPane: "sessions",
          screenMode: "history",
        },
      }),
    ).toBe("input");
    expect(
      resolveTabFocusTarget({
        direction: "previous",
        navigation: {
          focusPane: "input",
          screenMode: "history",
        },
      }),
    ).toBe("detail");
  });

  test("ignores tab focus changes outside the history screen", () => {
    expect(
      resolveTabFocusTarget({
        direction: "next",
        navigation: {
          focusPane: "workflows",
          screenMode: "workspace",
        },
      }),
    ).toBeUndefined();
    expect(
      resolveTabFocusTarget({
        direction: "previous",
        navigation: {
          focusPane: "input",
          screenMode: "run",
        },
      }),
    ).toBeUndefined();
  });
});

describe("buildDetailEscapeStatusMessage", () => {
  test("returns to workflow runs when detail came from the session pane", () => {
    expect(
      buildDetailEscapeStatusMessage({
        detailReturnPane: "sessions",
        historyViewMode: "workflow",
      }),
    ).toBe("Focused workflow runs");
  });

  test("returns to workflow nodes when detail came from a subworkflow session pane", () => {
    expect(
      buildDetailEscapeStatusMessage({
        detailReturnPane: "sessions",
        historyViewMode: "subworkflow",
      }),
    ).toBe("Focused workflow nodes");
  });

  test("returns to nodes when detail came from the node pane", () => {
    expect(
      buildDetailEscapeStatusMessage({
        detailReturnPane: "nodes",
        historyViewMode: "workflow",
      }),
    ).toBe("Focused nodes");
  });
});

describe("resolveNodeDetailEscape", () => {
  test("closes the in-pane viewer back to node detail summary first", () => {
    expect(
      resolveNodeDetailEscape({
        detailMode: "viewer",
        detailReturnPane: "nodes",
        historyViewMode: "workflow",
      }),
    ).toEqual({
      nextDetailMode: "summary",
      nextFocusPane: "detail",
      status: "Focused node detail summary",
    });
  });

  test("returns to the parent pane from node detail summary", () => {
    expect(
      resolveNodeDetailEscape({
        detailMode: "summary",
        detailReturnPane: "nodes",
        historyViewMode: "workflow",
      }),
    ).toEqual({
      nextDetailMode: "summary",
      nextFocusPane: "nodes",
      status: "Focused nodes",
    });
  });
});

describe("resolveHistoryAdvanceAction", () => {
  test("loads the selected session into node detail", () => {
    expect(
      resolveHistoryAdvanceAction({
        navigation: {
          detailMode: "summary",
          focusPane: "sessions",
        },
      }),
    ).toEqual({
      kind: "load-session-selection",
      focusAfterSessionLoad: "detail",
    });
  });

  test("loads the selected node from the node list", () => {
    expect(
      resolveHistoryAdvanceAction({
        navigation: {
          detailMode: "summary",
          focusPane: "nodes",
        },
      }),
    ).toEqual({ kind: "load-node-selection" });
  });

  test("opens the detail-summary selection only from summary mode", () => {
    expect(
      resolveHistoryAdvanceAction({
        navigation: {
          detailMode: "summary",
          focusPane: "detail",
        },
      }),
    ).toEqual({ kind: "open-detail-summary-selection" });
    expect(
      resolveHistoryAdvanceAction({
        navigation: {
          detailMode: "viewer",
          focusPane: "detail",
        },
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("resolveDirectionalNavigationAction", () => {
  test("returns to definition from root workflow history when history was opened there", () => {
    expect(
      resolveDirectionalNavigationAction({
        direction: "revert",
        historyRootReturnScreen: "definition",
        navigation: {
          focusPane: "sessions",
          historyViewMode: "workflow",
          screenMode: "history",
        },
      }),
    ).toEqual({ kind: "open-definition" });
  });
});

describe("resolveHistoryRevertAction", () => {
  test("returns node detail to its parent focus", () => {
    expect(
      resolveHistoryRevertAction({
        navigation: {
          detailMode: "summary",
          detailReturnPane: "nodes",
          editingInput: false,
          focusPane: "detail",
          historyViewMode: "workflow",
        },
      }),
    ).toEqual({
      kind: "focus",
      focusPane: "nodes",
      nextDetailMode: "summary",
      status: "Focused nodes",
    });
  });

  test("finishes input editing from the history input pane", () => {
    expect(
      resolveHistoryRevertAction({
        navigation: {
          detailMode: "summary",
          detailReturnPane: "nodes",
          editingInput: true,
          focusPane: "input",
          historyViewMode: "workflow",
        },
      }),
    ).toEqual({
      kind: "finish-input-editing",
      status: "Input edit finished",
    });
  });
});

describe("resolveOpenTuiInternallyHandledListId", () => {
  test("maps the workflow-definition node pane to its select renderable", () => {
    expect(
      resolveOpenTuiInternallyHandledListId({
        navigation: {
          detailMode: "summary",
          focusPane: "nodes",
          screenMode: "definition",
        },
        definitionNodeSelectId: "workflow-definition-node-select",
        detailSummarySelectId: "detail-summary-select",
        nodeSelectId: "node-select",
        sessionSelectId: "sess-select",
        workflowSelectId: "wf-select",
      }),
    ).toBe("workflow-definition-node-select");
  });

  test("maps the history workflow-runs pane to the session select renderable", () => {
    expect(
      resolveOpenTuiInternallyHandledListId({
        navigation: {
          detailMode: "summary",
          focusPane: "sessions",
          screenMode: "history",
        },
        definitionNodeSelectId: "workflow-definition-node-select",
        detailSummarySelectId: "detail-summary-select",
        nodeSelectId: "node-select",
        sessionSelectId: "sess-select",
        workflowSelectId: "wf-select",
      }),
    ).toBe("sess-select");
  });

  test("maps the detail summary pane to its select renderable", () => {
    expect(
      resolveOpenTuiInternallyHandledListId({
        navigation: {
          detailMode: "summary",
          focusPane: "detail",
          screenMode: "history",
        },
        definitionNodeSelectId: "workflow-definition-node-select",
        detailSummarySelectId: "detail-summary-select",
        nodeSelectId: "node-select",
        sessionSelectId: "sess-select",
        workflowSelectId: "wf-select",
      }),
    ).toBe("detail-summary-select");
  });

  test("returns undefined for non-list run-screen focus", () => {
    expect(
      resolveOpenTuiInternallyHandledListId({
        navigation: {
          detailMode: "summary",
          focusPane: "input",
          screenMode: "run",
        },
        definitionNodeSelectId: "workflow-definition-node-select",
        detailSummarySelectId: "detail-summary-select",
        nodeSelectId: "node-select",
        sessionSelectId: "sess-select",
        workflowSelectId: "wf-select",
      }),
    ).toBeUndefined();
  });
});

describe("resolveOpenTuiCopyTarget", () => {
  test("copies the selected workflow node id from the definition node pane", () => {
    expect(
      resolveOpenTuiCopyTarget({
        focusPane: "nodes",
        loadedWorkflowId: "workflow-alpha",
        screenMode: "definition",
        selectedWorkflowNodeId: "workflow-input",
      }),
    ).toEqual({
      label: "workflow node id",
      value: "workflow-input",
    });
  });

  test("prefers the workflow id in the workspace screen", () => {
    expect(
      resolveOpenTuiCopyTarget({
        focusPane: "workflows",
        loadedWorkflowId: "workflow-alpha",
        screenMode: "workspace",
        selectedWorkflowName: "alpha",
      }),
    ).toEqual({
      label: "workflow id",
      value: "workflow-alpha",
    });
  });

  test("falls back to the workflow name when the workspace preview is unavailable", () => {
    expect(
      resolveOpenTuiCopyTarget({
        focusPane: "workflows",
        screenMode: "workspace",
        selectedWorkflowName: "alpha",
      }),
    ).toEqual({
      label: "workflow name",
      value: "alpha",
    });
  });

  test("copies the selected workflow run id from the history session pane", () => {
    expect(
      resolveOpenTuiCopyTarget({
        focusPane: "sessions",
        screenMode: "history",
        selectedSessionId: "sess-123",
      }),
    ).toEqual({
      label: "workflow run id",
      value: "sess-123",
    });
  });

  test("copies the selected node execution id from the history node pane", () => {
    expect(
      resolveOpenTuiCopyTarget({
        focusPane: "nodes",
        screenMode: "history",
        selectedNodeExecutionId: "nodeexec-42",
      }),
    ).toEqual({
      label: "node execution id",
      value: "nodeexec-42",
    });
  });

  test("copies the selected workflow node id from the subworkflow node pane", () => {
    expect(
      resolveOpenTuiCopyTarget({
        focusPane: "sessions",
        screenMode: "history",
        selectedWorkflowNodeId: "workflow-input",
      }),
    ).toEqual({
      label: "workflow node id",
      value: "workflow-input",
    });
  });
});

describe("buildOpenTuiBreadcrumb", () => {
  test("renders the workflow-definition breadcrumb", () => {
    expect(
      buildOpenTuiBreadcrumb({
        loadedWorkflow: makeLoadedWorkflow({
          id: "workflow-input",
          model: "input-model",
          promptTemplate: "Normalize the request",
          variables: {},
        }),
        screenMode: "definition",
        subworkflowPath: [],
      }),
    ).toBe("workspace > demo > definition");
  });

  test("renders a nested history breadcrumb for subworkflow navigation", () => {
    expect(
      buildOpenTuiBreadcrumb({
        loadedWorkflow: makeLoadedWorkflow({
          id: "workflow-input",
          model: "input-model",
          promptTemplate: "Normalize the request",
          variables: {},
        }),
        screenMode: "history",
        subworkflowPath: ["delivery", "child-delivery"],
      }),
    ).toBe("workspace > demo > history > delivery > child-delivery");
  });
});

describe("buildNodeSelectOptions", () => {
  test("shows the owning workflow and purpose in root-history node rows", () => {
    const loaded = makeLoadedWorkflow({
      id: "workflow-input",
      description: "Normalize the received request",
      model: "input-model",
      promptTemplate: "Normalize the request",
      variables: {},
    });

    const options = buildNodeSelectOptions(loaded, {
      sessionId: "sess-1",
      workflowName: "demo",
      workflowId: "demo",
      status: "completed",
      startedAt: "2026-03-24T00:00:00.000Z",
      endedAt: "2026-03-24T00:01:00.000Z",
      queue: [],
      currentNodeId: "workflow-output",
      nodeExecutionCounter: 1,
      nodeExecutionCounts: { "workflow-input": 1 },
      transitions: [],
      nodeExecutions: [
        {
          nodeId: "workflow-input",
          nodeExecId: "nodeexec-42",
          status: "succeeded",
          artifactDir: "/tmp/demo",
          startedAt: "2026-03-24T00:00:10.000Z",
          endedAt: "2026-03-24T00:00:20.000Z",
        },
      ],
      communicationCounter: 0,
      communications: [],
      runtimeVariables: {},
    });

    expect(options[0]?.name).toContain("workflow-input");
    expect(
      (options[0] as { statusLabel?: string } | undefined)?.statusLabel,
    ).toBe("SUCCEEDED");
    expect(options[0]?.description).toContain("INPUT | AGENT");
    expect(
      (options[0] as { detailLines?: readonly string[] } | undefined)
        ?.detailLines?.[1],
    ).toContain("scope: delivery");
    expect(
      (options[0] as { detailLines?: readonly string[] } | undefined)
        ?.detailLines?.[1],
    ).toContain("purpose: Normalize the received request");
  });
});

describe("buildWorkflowDefinitionNodeSelectOptions", () => {
  test("lists workflow nodes without requiring runtime execution data", () => {
    const loaded = makeLoadedWorkflow({
      id: "workflow-input",
      description: "Normalize the received request",
      model: "input-model",
      promptTemplate: "Normalize the request",
      variables: {},
    });

    const options = buildWorkflowDefinitionNodeSelectOptions(loaded);

    expect(options[0]?.value).toBe("divedra-manager");
    expect(options[1]?.value).toBe("workflow-input");
    expect(options[1]?.description).toContain("AGENT");
  });
});
