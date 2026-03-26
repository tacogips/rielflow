import { describe, expect, test, vi } from "vitest";
import type { LoadedWorkflow } from "../workflow/load";
import type { NodePayload } from "../workflow/types";
import {
  buildNodeDefinitionPopupContent,
  buildDetailEscapeStatusMessage,
  buildNodeSelectOptions,
  buildOpenTuiBreadcrumb,
  buildSummaryJsonSelectOptions,
  buildSubworkflowNodeSelectOptions,
  buildTuiRuntimeVariables,
  buildWorkflowHistoryStatusMessage,
  buildSessionSelectOptions,
  describeTuiWorkflowInputSyntax,
  deriveEditorTextFromRuntimeVariables,
  detectWorkflowInputMode,
  filterWorkflowNames,
  formatJsonEditorText,
  isAllowedNodeDetailKey,
  resolveAgentSessionSummarySelection,
  resolveOpenTuiCopyTarget,
  resolveHistoryPaneNavigationMode,
  resolveOpenTuiInternallyHandledListId,
  resolveOpenTuiPaneChrome,
  resolveTabFocusTarget,
  resolveWorkflowPreviewIndent,
  resolveSelectedWorkflowName,
  buildWorkflowHistoryHeader,
  buildWorkflowRunStatusContent,
  buildWorkflowDefinitionNodeSelectOptions,
  buildWorkflowSelectorPreview,
  resolveDirectionalNavigationAction,
  resolveHistoryAdvanceAction,
  resolveHistoryRevertAction,
  resolveOpenTuiPopupKind,
  resolveNodeDetailEscape,
  resolvePopupConfirmAction,
  resolvePopupRevertAction,
  resolvePopupScrollDelta,
} from "./opentui-model";
import {
  OPEN_TUI_MAIN_PANE_LAYOUT,
  focusOpenTuiTarget,
  isOpenTuiHelpKey,
  isOpenTuiRefreshKey,
  isOpenTuiRerunKey,
  resolveBlurredSelectRedrawTarget,
} from "./opentui-screen";

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

function plainStyledText(input: {
  readonly chunks: readonly { text: string }[];
}) {
  return input.chunks.map((chunk) => chunk.text).join("");
}

describe("resolveSelectedWorkflowName", () => {
  test("returns selected workflow when index is in range", () => {
    expect(resolveSelectedWorkflowName(1, ["a", "b", "c"])).toBe("b");
  });

  test("returns undefined when index is out of range", () => {
    expect(resolveSelectedWorkflowName(-1, ["a"])).toBeUndefined();
    expect(resolveSelectedWorkflowName(3, ["a", "b"])).toBeUndefined();
  });
});

describe("detectWorkflowInputMode", () => {
  test("detects json mode when the input node binds structured human-input fields", () => {
    const loaded = makeLoadedWorkflow({
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
    });

    expect(detectWorkflowInputMode(loaded)).toEqual({
      mode: "json",
      reason:
        "detected structured human-input bindings or JSON-oriented input prompts",
    });
  });

  test("defaults to text mode when the workflow definition gives no structured-input hint", () => {
    const loaded = makeLoadedWorkflow({
      id: "workflow-input",
      model: "input-model",
      promptTemplate: "Read the latest human input and summarize it.",
      variables: {},
    });

    expect(detectWorkflowInputMode(loaded).mode).toBe("text");
  });
});

describe("filterWorkflowNames", () => {
  test("returns all workflows when the filter is empty", () => {
    expect(filterWorkflowNames(["alpha", "beta"], "")).toEqual([
      "alpha",
      "beta",
    ]);
  });

  test("matches workflow names by case-insensitive substring", () => {
    expect(
      filterWorkflowNames(["Alpha", "beta", "release-flow"], "LEA"),
    ).toEqual(["release-flow"]);
  });
});

describe("resolveAgentSessionSummarySelection", () => {
  test("builds an available AI session link for cli-backed agent nodes", () => {
    expect(
      resolveAgentSessionSummarySelection({
        execution: {
          nodeId: "step-1",
          nodeExecId: "exec-1",
          status: "succeeded",
          artifactDir: "/tmp/demo",
          startedAt: "2026-03-25T00:00:00.000Z",
          endedAt: "2026-03-25T00:00:10.000Z",
          backendSessionId: "codex-session-1",
        },
        payload: {
          id: "step-1",
          executionBackend: "codex-agent",
          model: "tacogips/codex-agent",
          promptTemplate: "Solve the task",
          variables: {},
        },
      }),
    ).toEqual({
      available: true,
      backend: "codex-agent",
      kind: "agent-session",
      sessionId: "codex-session-1",
      title: "AI agent session (codex-agent)",
    });
  });

  test("keeps the AI session row unavailable when the execution has no stored session id", () => {
    expect(
      resolveAgentSessionSummarySelection({
        execution: {
          nodeId: "manager",
          nodeExecId: "exec-2",
          status: "succeeded",
          artifactDir: "/tmp/demo",
          startedAt: "2026-03-25T00:00:00.000Z",
          endedAt: "2026-03-25T00:00:10.000Z",
        },
        payload: {
          id: "manager",
          executionBackend: "claude-code-agent",
          model: "tacogips/claude-code-agent",
          promptTemplate: "Manage the workflow",
          variables: {},
        },
      }),
    ).toEqual({
      available: false,
      backend: "claude-code-agent",
      kind: "agent-session",
      title: "AI agent session (claude-code-agent)",
    });
  });

  test("returns undefined for non-agent nodes", () => {
    expect(
      resolveAgentSessionSummarySelection({
        execution: {
          nodeId: "build",
          nodeExecId: "exec-3",
          status: "succeeded",
          artifactDir: "/tmp/demo",
          startedAt: "2026-03-25T00:00:00.000Z",
          endedAt: "2026-03-25T00:00:10.000Z",
        },
        payload: {
          id: "build",
          nodeType: "command",
          promptTemplate: "run the command",
          variables: {},
        },
      }),
    ).toBeUndefined();
  });
});

describe("buildSummaryJsonSelectOptions", () => {
  test("prepends the AI session link row before JSON viewers", () => {
    const options = buildSummaryJsonSelectOptions({
      agentSessionSelection: {
        available: true,
        backend: "codex-agent",
        kind: "agent-session",
        sessionId: "codex-session-1",
        title: "AI agent session (codex-agent)",
      },
      bundle: {
        artifactInput: '{"input":true}',
        artifactOutput: '{"output":true}',
        artifactMeta: "{}",
        mailboxMeta: "{}",
        mailboxInput: '{"mailbox":true}',
        mailboxOutput: '{"outbox":true}',
      },
    });

    expect(options[0]?.name).toBe("AI agent session (codex-agent)");
    expect(options[0]?.description).toContain("sessionId: codex-session-1");
    expect(options[1]?.name).toBe("Execution input (input.json)");
  });
});

describe("workflow preview text helpers", () => {
  test("buildWorkflowSelectorPreview includes workflow selection metadata", () => {
    const loaded = makeLoadedWorkflow({
      id: "workflow-input",
      model: "input-model",
      promptTemplate: "Collect the request",
      variables: {},
    });

    const text = plainStyledText(
      buildWorkflowSelectorPreview({
        filteredWorkflowNamesCount: 1,
        loadedWorkflow: loaded,
        selectorPreviewWorkflow: loaded,
        selectedWorkflowName: "demo",
        workflowFilterText: "de",
        workflowNamesCount: 3,
      }),
    );

    expect(text).toContain("Workflow: demo");
    expect(text).toContain("Filter: de  Matches: 1/3");
    expect(text).toContain("Node Structure");
  });

  test("buildWorkflowHistoryHeader includes subworkflow scope metadata", () => {
    const loaded = makeLoadedWorkflow({
      id: "workflow-input",
      model: "input-model",
      promptTemplate: "Collect the request",
      variables: {},
    });

    const text = plainStyledText(
      buildWorkflowHistoryHeader(
        loaded,
        loaded.bundle.workflow.subWorkflows[0],
      ),
    );

    expect(text).toContain("demo");
    expect(text).toContain("demo workflow");
    expect(text).toContain("scope=delivery");
    expect(text).toContain("manager=divedra-manager");
  });

  test("buildWorkflowHistoryHeader omits the description line when it is absent", () => {
    const loadedWithDescription = makeLoadedWorkflow({
      id: "workflow-input",
      model: "input-model",
      promptTemplate: "Collect the request",
      variables: {},
    });
    const loaded: LoadedWorkflow = {
      ...loadedWithDescription,
      bundle: {
        ...loadedWithDescription.bundle,
        workflow: {
          ...loadedWithDescription.bundle.workflow,
          description: "",
        },
      },
    };

    const text = plainStyledText(buildWorkflowHistoryHeader(loaded, undefined));

    expect(text).toContain("demo");
    expect(text).not.toContain("demo workflow");
    expect(text).toContain("nodes=3  subworkflows=1");
    expect(text).not.toContain("demo\n\nnodes=");
  });
});

describe("buildTuiRuntimeVariables", () => {
  test("builds text-oriented runtime variables for workflow execution", () => {
    expect(
      buildTuiRuntimeVariables({
        editorText: "ship the patch",
        mode: "text",
        purpose: "run",
      }),
    ).toEqual({
      humanInput: "ship the patch",
      prompt: "ship the patch",
      userPrompt: "ship the patch",
    });
  });

  test("builds json-oriented runtime variables for rerun execution", () => {
    expect(
      buildTuiRuntimeVariables({
        editorText: '{"request":"retry"}',
        managerSessionId: "mgrsess-exec-000001",
        mode: "json",
        purpose: "rerun",
      }),
    ).toEqual({
      humanInput: { request: "retry" },
      promptJson: { request: "retry" },
      userPromptJson: { request: "retry" },
      rerunPrompt: { request: "retry" },
      rerunManagerSessionId: "mgrsess-exec-000001",
    });
  });
});

describe("deriveEditorTextFromRuntimeVariables", () => {
  test("returns raw text for text-mode values", () => {
    expect(
      deriveEditorTextFromRuntimeVariables(
        { humanInput: { text: "hello" } },
        "text",
      ),
    ).toBe("hello");
  });

  test("returns formatted json for structured values", () => {
    expect(
      deriveEditorTextFromRuntimeVariables(
        { humanInput: { request: "hello" } },
        "json",
      ),
    ).toBe('{\n  "request": "hello"\n}');
  });

  test("prefers promptJson when reopening json-oriented runtime state", () => {
    expect(
      deriveEditorTextFromRuntimeVariables(
        {
          humanInput: "fallback text",
          promptJson: { request: "hello" },
        },
        "json",
      ),
    ).toBe('{\n  "request": "hello"\n}');
  });
});

describe("formatJsonEditorText", () => {
  test("formats valid json and normalizes whitespace", () => {
    expect(formatJsonEditorText('{"a":1,"b":[2]}')).toBe(
      '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}',
    );
  });
});

describe("describeTuiWorkflowInputSyntax", () => {
  test("treats text mode as non-json input", () => {
    expect(describeTuiWorkflowInputSyntax("hello", "text")).toEqual({
      status: "not-applicable",
      summary: "plain text",
    });
  });

  test("accepts an empty json editor buffer as an empty object", () => {
    expect(describeTuiWorkflowInputSyntax("   ", "json")).toEqual({
      status: "valid-empty",
      summary: "empty buffer -> {}",
    });
  });

  test("reports valid json input", () => {
    expect(
      describeTuiWorkflowInputSyntax('{"request":"hello"}', "json"),
    ).toEqual({
      status: "valid",
      summary: "valid JSON",
    });
  });

  test("reports invalid json input with location context when available", () => {
    const syntax = describeTuiWorkflowInputSyntax('{"request":}', "json");
    expect(syntax.status).toBe("invalid");
    expect(syntax.summary).toContain("invalid JSON");
  });
});

describe("buildWorkflowHistoryStatusMessage", () => {
  test("documents the workflow-definition screen help text", () => {
    expect(
      buildWorkflowHistoryStatusMessage({
        busy: false,
        detailMode: "summary",
        editingInput: false,
        filterText: "",
        focusPane: "nodes",
        historyViewMode: "workflow",
        inputSyntax: {
          status: "valid",
          summary: "valid JSON",
        },
        matchesCount: 2,
        message: "Help",
        screenMode: "definition",
        workflowCount: 2,
        workflowInputDetection: {
          mode: "json",
          reason: "detected structured input",
        },
        workflowName: "demo-flow",
      }),
    ).toContain("nodes: enter/ctrl-m opens the node-definition popup");
  });

  test("includes the workflow name in run-screen help text", () => {
    expect(
      buildWorkflowHistoryStatusMessage({
        busy: false,
        detailMode: "summary",
        editingInput: false,
        filterText: "",
        focusPane: "input",
        historyViewMode: "workflow",
        inputSyntax: {
          status: "valid",
          summary: "valid JSON",
        },
        matchesCount: 2,
        message: "Help",
        screenMode: "run",
        workflowCount: 2,
        workflowInputDetection: {
          mode: "json",
          reason: "detected structured input",
        },
        workflowName: "demo-flow",
      }),
    ).toContain("Screen=run  Workflow=demo-flow");
  });

  test("describes the history focus cycle through node detail", () => {
    expect(
      buildWorkflowHistoryStatusMessage({
        busy: false,
        detailMode: "summary",
        editingInput: false,
        filterText: "",
        focusPane: "sessions",
        historyViewMode: "workflow",
        inputSyntax: {
          status: "valid",
          summary: "valid JSON",
        },
        matchesCount: 2,
        message: "Help",
        screenMode: "history",
        workflowCount: 2,
        workflowInputDetection: {
          mode: "json",
          reason: "detected structured input",
        },
        workflowName: "demo-flow",
      }),
    ).toContain("enter/ctrl-m: load selection");
  });

  test("documents that escape closes in-pane viewers before returning", () => {
    expect(
      buildWorkflowHistoryStatusMessage({
        busy: false,
        detailMode: "summary",
        editingInput: false,
        filterText: "",
        focusPane: "detail",
        historyViewMode: "workflow",
        inputSyntax: {
          status: "valid",
          summary: "valid JSON",
        },
        matchesCount: 2,
        message: "Help",
        screenMode: "history",
        workflowCount: 2,
        workflowInputDetection: {
          mode: "json",
          reason: "detected structured input",
        },
        workflowName: "demo-flow",
      }),
    ).toContain("esc closes in-pane viewers before returning to the opener");
  });
});

describe("isOpenTuiRefreshKey", () => {
  test("matches plain r without shift/control/meta modifiers", () => {
    expect(
      isOpenTuiRefreshKey({
        name: "r",
        shift: false,
        ctrl: false,
        meta: false,
      }),
    ).toBe(true);
  });

  test("rejects shifted and modified variants", () => {
    expect(
      isOpenTuiRefreshKey({
        name: "r",
        shift: true,
        ctrl: false,
        meta: false,
      }),
    ).toBe(false);
    expect(
      isOpenTuiRefreshKey({
        name: "r",
        shift: true,
        ctrl: true,
        meta: false,
      }),
    ).toBe(false);
    expect(
      isOpenTuiRefreshKey({
        name: "r",
        shift: true,
        ctrl: false,
        meta: true,
      }),
    ).toBe(false);
  });
});

describe("isOpenTuiRerunKey", () => {
  test("matches shifted r without control/meta modifiers", () => {
    expect(
      isOpenTuiRerunKey({
        name: "r",
        shift: true,
        ctrl: false,
        meta: false,
      }),
    ).toBe(true);
  });

  test("rejects plain r and modified variants", () => {
    expect(
      isOpenTuiRerunKey({
        name: "r",
        shift: false,
        ctrl: false,
        meta: false,
      }),
    ).toBe(false);
    expect(
      isOpenTuiRerunKey({
        name: "r",
        shift: true,
        ctrl: true,
        meta: false,
      }),
    ).toBe(false);
    expect(
      isOpenTuiRerunKey({
        name: "r",
        shift: true,
        ctrl: false,
        meta: true,
      }),
    ).toBe(false);
  });
});

describe("isOpenTuiHelpKey", () => {
  test("matches question-mark help key variants", () => {
    expect(
      isOpenTuiHelpKey({
        name: "?",
        shift: false,
        ctrl: false,
        meta: false,
      }),
    ).toBe(true);
    expect(
      isOpenTuiHelpKey({
        name: "/",
        shift: true,
        ctrl: false,
        meta: false,
      }),
    ).toBe(true);
  });

  test("rejects modified or plain slash keys", () => {
    expect(
      isOpenTuiHelpKey({
        name: "/",
        shift: false,
        ctrl: false,
        meta: false,
      }),
    ).toBe(false);
    expect(
      isOpenTuiHelpKey({
        name: "?",
        shift: false,
        ctrl: true,
        meta: false,
      }),
    ).toBe(false);
  });
});

describe("OpenTui pane layout", () => {
  test("uses explicit main pane widths with non-collapsing minima for navigation panes", () => {
    expect(OPEN_TUI_MAIN_PANE_LAYOUT.workflows.width).toBe("20%");
    expect(OPEN_TUI_MAIN_PANE_LAYOUT.sessions.width).toBe("28%");
    expect(OPEN_TUI_MAIN_PANE_LAYOUT.nodes.width).toBe("22%");
    expect(OPEN_TUI_MAIN_PANE_LAYOUT.details.width).toBe("30%");
    expect(OPEN_TUI_MAIN_PANE_LAYOUT.workflows.minWidth).toBeGreaterThan(2);
    expect(OPEN_TUI_MAIN_PANE_LAYOUT.sessions.minWidth).toBeGreaterThan(2);
    expect(OPEN_TUI_MAIN_PANE_LAYOUT.nodes.minWidth).toBeGreaterThan(2);
  });
});

describe("resolveBlurredSelectRedrawTarget", () => {
  test("returns the selected row content when the logical selection is visible", () => {
    expect(
      resolveBlurredSelectRedrawTarget({
        fontHeight: 1,
        linesPerItem: 3,
        maxVisibleItems: 4,
        selectedOption: {
          name: "selected row",
          description: "detail text",
        },
        scrollOffset: 2,
        showDescription: true,
        selectedIndex: 3,
      }),
    ).toEqual({
      descriptionY: 4,
      name: "  selected row",
      nameY: 3,
    });
  });

  test("returns undefined when the logical selection is outside the visible window", () => {
    expect(
      resolveBlurredSelectRedrawTarget({
        fontHeight: 1,
        linesPerItem: 2,
        maxVisibleItems: 3,
        selectedOption: {
          name: "hidden row",
          description: "",
        },
        scrollOffset: 4,
        showDescription: false,
        selectedIndex: 2,
      }),
    ).toBeUndefined();
  });
});

describe("resolveHistoryPaneNavigationMode", () => {
  test("treats detail summary as list navigation", () => {
    expect(
      resolveHistoryPaneNavigationMode({
        detailMode: "summary",
        focusPane: "detail",
      }),
    ).toBe("list");
  });

  test("treats non-summary detail views as scroll navigation", () => {
    expect(
      resolveHistoryPaneNavigationMode({
        detailMode: "inbox",
        focusPane: "detail",
      }),
    ).toBe("scroll");
  });

  test("treats the input pane as typing, not pane navigation", () => {
    expect(
      resolveHistoryPaneNavigationMode({
        detailMode: "summary",
        focusPane: "input",
      }),
    ).toBe("typing");
  });
});

describe("resolveDirectionalNavigationAction", () => {
  test("maps workspace forward navigation to opening definition", () => {
    expect(
      resolveDirectionalNavigationAction({
        direction: "forward",
        focusPane: "workflows",
        historyViewMode: "workflow",
        screenMode: "workspace",
      }),
    ).toEqual({ kind: "open-definition" });
  });

  test("maps definition forward navigation to opening history", () => {
    expect(
      resolveDirectionalNavigationAction({
        direction: "forward",
        focusPane: "nodes",
        historyViewMode: "workflow",
        screenMode: "definition",
      }),
    ).toEqual({ kind: "open-history" });
  });

  test("maps history workflow forward navigation from sessions to nodes", () => {
    expect(
      resolveDirectionalNavigationAction({
        direction: "forward",
        focusPane: "sessions",
        historyViewMode: "workflow",
        screenMode: "history",
      }),
    ).toEqual({
      kind: "focus",
      focusPane: "nodes",
      nextDetailMode: "summary",
      status: "Focused nodes for the selected workflow run",
    });
  });

  test("maps history subworkflow revert navigation from sessions to closing the scope", () => {
    expect(
      resolveDirectionalNavigationAction({
        direction: "revert",
        focusPane: "sessions",
        historyViewMode: "subworkflow",
        screenMode: "history",
      }),
    ).toEqual({ kind: "close-subworkflow" });
  });
});

describe("resolveOpenTuiPopupKind", () => {
  test("prefers the topmost popup in render order", () => {
    expect(
      resolveOpenTuiPopupKind({
        agentSessionPopupOpen: true,
        confirmPopupOpen: true,
        filterPopupOpen: true,
        helpPopupOpen: true,
        nodeDefinitionPopupOpen: true,
      }),
    ).toBe("filter");
  });

  test("returns node-definition when it is the topmost open popup", () => {
    expect(
      resolveOpenTuiPopupKind({
        agentSessionPopupOpen: true,
        confirmPopupOpen: false,
        filterPopupOpen: false,
        helpPopupOpen: false,
        nodeDefinitionPopupOpen: true,
      }),
    ).toBe("node-definition");
  });

  test("returns none when no popup is open", () => {
    expect(
      resolveOpenTuiPopupKind({
        agentSessionPopupOpen: false,
        confirmPopupOpen: false,
        filterPopupOpen: false,
        helpPopupOpen: false,
        nodeDefinitionPopupOpen: false,
      }),
    ).toBe("none");
  });
});

describe("resolvePopupConfirmAction", () => {
  test("maps popup confirm actions centrally", () => {
    expect(resolvePopupConfirmAction("filter")).toEqual({
      kind: "apply-filter",
    });
    expect(resolvePopupConfirmAction("run-confirm")).toEqual({
      kind: "confirm-run",
    });
    expect(resolvePopupConfirmAction("help")).toEqual({ kind: "none" });
  });
});

describe("resolvePopupRevertAction", () => {
  test("maps popup close actions centrally", () => {
    expect(resolvePopupRevertAction("filter")).toEqual({
      kind: "cancel-filter",
    });
    expect(resolvePopupRevertAction("help")).toEqual({
      kind: "close-help",
    });
    expect(resolvePopupRevertAction("run-confirm")).toEqual({
      kind: "close-run-confirm",
    });
    expect(resolvePopupRevertAction("node-definition")).toEqual({
      kind: "close-node-definition",
    });
    expect(resolvePopupRevertAction("agent-session")).toEqual({
      kind: "close-agent-session",
    });
  });
});

describe("resolvePopupScrollDelta", () => {
  test("returns popup scroll movement only for the agent-session popup", () => {
    expect(
      resolvePopupScrollDelta({
        key: {
          name: "j",
          shift: false,
          ctrl: false,
          meta: false,
        },
        popupKind: "agent-session",
      }),
    ).toBe(1);
    expect(
      resolvePopupScrollDelta({
        key: {
          name: "up",
          shift: false,
          ctrl: false,
          meta: false,
        },
        popupKind: "agent-session",
      }),
    ).toBe(-1);
    expect(
      resolvePopupScrollDelta({
        key: {
          name: "down",
          shift: false,
          ctrl: false,
          meta: false,
        },
        popupKind: "node-definition",
      }),
    ).toBe(1);
    expect(
      resolvePopupScrollDelta({
        key: {
          name: "down",
          shift: false,
          ctrl: false,
          meta: false,
        },
        popupKind: "help",
      }),
    ).toBe(0);
  });
});

describe("resolveTabFocusTarget", () => {
  test("cycles between definition panes", () => {
    expect(
      resolveTabFocusTarget({
        direction: "next",
        focusPane: "definition",
        screenMode: "definition",
      }),
    ).toBe("nodes");
    expect(
      resolveTabFocusTarget({
        direction: "previous",
        focusPane: "nodes",
        screenMode: "definition",
      }),
    ).toBe("definition");
  });

  test("cycles forward across history panes only", () => {
    expect(
      resolveTabFocusTarget({
        direction: "next",
        focusPane: "sessions",
        screenMode: "history",
      }),
    ).toBe("nodes");
    expect(
      resolveTabFocusTarget({
        direction: "next",
        focusPane: "nodes",
        screenMode: "history",
      }),
    ).toBe("detail");
    expect(
      resolveTabFocusTarget({
        direction: "next",
        focusPane: "detail",
        screenMode: "history",
      }),
    ).toBe("input");
    expect(
      resolveTabFocusTarget({
        direction: "next",
        focusPane: "input",
        screenMode: "history",
      }),
    ).toBe("sessions");
  });

  test("cycles backward across history panes only", () => {
    expect(
      resolveTabFocusTarget({
        direction: "previous",
        focusPane: "sessions",
        screenMode: "history",
      }),
    ).toBe("input");
    expect(
      resolveTabFocusTarget({
        direction: "previous",
        focusPane: "input",
        screenMode: "history",
      }),
    ).toBe("detail");
  });

  test("ignores tab focus changes outside the history screen", () => {
    expect(
      resolveTabFocusTarget({
        direction: "next",
        focusPane: "workflows",
        screenMode: "workspace",
      }),
    ).toBeUndefined();
    expect(
      resolveTabFocusTarget({
        direction: "previous",
        focusPane: "input",
        screenMode: "run",
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
        detailMode: "summary",
        focusPane: "sessions",
      }),
    ).toEqual({
      kind: "load-session-selection",
      focusAfterSessionLoad: "detail",
    });
  });

  test("loads the selected node from the node list", () => {
    expect(
      resolveHistoryAdvanceAction({
        detailMode: "summary",
        focusPane: "nodes",
      }),
    ).toEqual({ kind: "load-node-selection" });
  });

  test("opens the detail-summary selection only from summary mode", () => {
    expect(
      resolveHistoryAdvanceAction({
        detailMode: "summary",
        focusPane: "detail",
      }),
    ).toEqual({ kind: "open-detail-summary-selection" });
    expect(
      resolveHistoryAdvanceAction({
        detailMode: "viewer",
        focusPane: "detail",
      }),
    ).toEqual({ kind: "none" });
  });
});

describe("resolveHistoryRevertAction", () => {
  test("returns node detail to its parent focus", () => {
    expect(
      resolveHistoryRevertAction({
        detailMode: "summary",
        detailReturnPane: "nodes",
        editingInput: false,
        focusPane: "detail",
        historyViewMode: "workflow",
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
        detailMode: "summary",
        detailReturnPane: "nodes",
        editingInput: true,
        focusPane: "input",
        historyViewMode: "workflow",
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
        detailMode: "summary",
        definitionNodeSelectId: "workflow-definition-node-select",
        detailSummarySelectId: "detail-summary-select",
        focusPane: "nodes",
        nodeSelectId: "node-select",
        screenMode: "definition",
        sessionSelectId: "sess-select",
        workflowSelectId: "wf-select",
      }),
    ).toBe("workflow-definition-node-select");
  });

  test("maps the history workflow-runs pane to the session select renderable", () => {
    expect(
      resolveOpenTuiInternallyHandledListId({
        detailMode: "summary",
        definitionNodeSelectId: "workflow-definition-node-select",
        detailSummarySelectId: "detail-summary-select",
        focusPane: "sessions",
        nodeSelectId: "node-select",
        screenMode: "history",
        sessionSelectId: "sess-select",
        workflowSelectId: "wf-select",
      }),
    ).toBe("sess-select");
  });

  test("maps the detail summary pane to its select renderable", () => {
    expect(
      resolveOpenTuiInternallyHandledListId({
        detailMode: "summary",
        definitionNodeSelectId: "workflow-definition-node-select",
        detailSummarySelectId: "detail-summary-select",
        focusPane: "detail",
        nodeSelectId: "node-select",
        screenMode: "history",
        sessionSelectId: "sess-select",
        workflowSelectId: "wf-select",
      }),
    ).toBe("detail-summary-select");
  });

  test("returns undefined for non-list run-screen focus", () => {
    expect(
      resolveOpenTuiInternallyHandledListId({
        detailMode: "summary",
        definitionNodeSelectId: "workflow-definition-node-select",
        detailSummarySelectId: "detail-summary-select",
        focusPane: "input",
        nodeSelectId: "node-select",
        screenMode: "run",
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
      (options[0] as { detailLines?: readonly string[] } | undefined)?.detailLines?.[1],
    ).toContain("scope: delivery");
    expect(
      (options[0] as { detailLines?: readonly string[] } | undefined)?.detailLines?.[1],
    ).toContain(
      "purpose: Normalize the received request",
    );
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

    expect(options[0]?.name).toContain("2026-03-24T00:00:00.000Z");
    expect(
      (options[0] as { statusLabel?: string } | undefined)?.statusLabel,
    ).toBe("COMPLETED");
  });
});

describe("buildSubworkflowNodeSelectOptions", () => {
  test("uses workflow-node rows in the subworkflow view", () => {
    const loaded = makeLoadedWorkflow({
      id: "workflow-input",
      description: "Normalize the received request",
      model: "input-model",
      promptTemplate: "Normalize the request",
      variables: {},
    });

    const options = buildSubworkflowNodeSelectOptions(
      loaded,
      {
        sessionId: "sess-1",
        workflowName: "demo",
        workflowId: "demo",
        status: "completed",
        startedAt: "2026-03-24T00:00:00.000Z",
        endedAt: "2026-03-24T00:01:00.000Z",
        queue: [],
        currentNodeId: "workflow-output",
        nodeExecutionCounter: 2,
        nodeExecutionCounts: { "workflow-input": 1, "workflow-output": 1 },
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
      },
      "delivery",
    );

    expect(options[0]?.name).toContain("workflow-input");
    expect(options[0]?.description).toContain("AGENT");
    expect(
      (options[0] as { detailLines?: readonly string[] } | undefined)?.detailLines?.[1],
    ).toContain(
      "purpose: Normalize the received request",
    );
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
      focusPane: "nodes",
      hasRuntimeSession: false,
      historyPaneLabels: {
        header: "Workflow",
        left: "Workflow Runs",
        right: "Nodes",
      },
      inputMode: "json",
      inputSyntaxStatus: "valid",
      screenMode: "definition",
    });

    expect(chrome.workflowDefinition.title).toBe(" Workflow Definition ");
    expect(chrome.workflowDefinitionNodes.title).toBe(" >> Nodes << ");
    expect(chrome.workflowDefinitionNodes.borderColor).toBe("#4fd1ff");
  });

  test("marks node detail as active after history focus moves from nodes to detail", () => {
    const chrome = resolveOpenTuiPaneChrome({
      focusPane: "detail",
      hasRuntimeSession: true,
      historyPaneLabels: {
        header: "Workflow",
        left: "Workflow Runs",
        right: "Nodes",
      },
      inputMode: "json",
      inputSyntaxStatus: "valid",
      screenMode: "history",
    });

    expect(chrome.detail.title).toBe(" >> node detail << ");
    expect(chrome.detail.borderColor).toBe("#4fd1ff");
    expect(chrome.node.title).toBe(" Nodes ");
    expect(chrome.node.borderColor).toBe("#5b6670");
  });

  test("uses the select-a-run node title until a session is loaded", () => {
    const chrome = resolveOpenTuiPaneChrome({
      focusPane: "sessions",
      hasRuntimeSession: false,
      historyPaneLabels: {
        header: "Workflow",
        left: "Workflow Runs",
        right: "Nodes (select a run)",
      },
      inputMode: "text",
      inputSyntaxStatus: "not-applicable",
      screenMode: "history",
    });

    expect(chrome.node.title).toBe(" Nodes (select a run) ");
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
  test("keeps the root manager at indent zero", () => {
    expect(
      resolveWorkflowPreviewIndent({
        derivedIndent: 3,
        inSubworkflowScope: true,
        kind: "root-manager",
      }),
    ).toBe(0);
  });

  test("adds one indent level for nodes inside a subworkflow scope", () => {
    expect(
      resolveWorkflowPreviewIndent({
        derivedIndent: 1,
        inSubworkflowScope: true,
        kind: "subworkflow-manager",
      }),
    ).toBe(2);
  });

  test("keeps root-level non-subworkflow nodes at their derived indent", () => {
    expect(
      resolveWorkflowPreviewIndent({
        derivedIndent: 0,
        inSubworkflowScope: false,
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
  });

  test("shows running state and final workflow output when available", () => {
    const loaded = makeLoadedWorkflow({
      id: "workflow-input",
      model: "input-model",
      promptTemplate: "Read free text",
      variables: {},
    });

    expect(
      buildWorkflowRunStatusContent({
        loadedWorkflow: loaded,
        runtimeSessionView: {
          session: {
            sessionId: "sess-demo",
            workflowName: "demo",
            workflowId: "demo",
            status: "completed",
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
                nodeExecId: "exec-1",
                status: "succeeded",
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
        },
      }),
    ).toContain("Final result:");
  });
});
