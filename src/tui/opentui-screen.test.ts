import { describe, expect, test } from "vitest";
import type { LoadedWorkflow } from "../workflow/load";
import type { NodePayload } from "../workflow/types";
import type { RuntimeSessionView } from "./opentui-model";
import {
  buildOpenTuiFooterShortcutRow,
  buildSummaryJsonSelectOptions,
  buildTuiRuntimeVariables,
  buildWorkflowDefinitionContent,
  buildWorkflowHistoryStatusMessage,
  buildWorkflowRunPreview,
  buildWorkflowSelectorHistorySummary,
  describeTuiWorkflowInputSyntax,
  deriveEditorTextFromRuntimeVariables,
  detectWorkflowInputMode,
  filterWorkflowNames,
  formatJsonEditorText,
  resolveAgentSessionSummarySelection,
  resolveHistoryPaneNavigationMode,
  resolveSelectedWorkflowName,
  buildWorkflowHistoryHeader,
  buildWorkflowSelectorPreview,
  resolveDirectionalNavigationAction,
  resolveOpenTuiPopupKind,
  resolvePopupConfirmAction,
  resolvePopupRevertAction,
  resolvePopupScrollDelta,
} from "./opentui-model";
import {
  OPEN_TUI_MAIN_PANE_LAYOUT,
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
        "divedra-manager": {
          id: "divedra-manager",
          model: "manager-model",
          promptTemplate: "Manage the workflow",
          variables: {},
        },
        "workflow-input": inputNodePayload,
        "workflow-output": {
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

function makeWorkspaceLatestRunView(): RuntimeSessionView {
  return {
    session: {
      sessionId: "sess-3",
      workflowName: "demo",
      workflowId: "demo",
      status: "running",
      startedAt: "2026-03-26T00:02:00.000Z",
      queue: [],
      currentNodeId: "workflow-output",
      nodeExecutionCounter: 2,
      nodeExecutionCounts: {
        "workflow-input": 1,
        "workflow-output": 1,
      },
      transitions: [],
      nodeExecutions: [
        {
          nodeId: "workflow-input",
          nodeExecId: "exec-1",
          status: "succeeded",
          artifactDir: "/tmp/demo/exec-1",
          startedAt: "2026-03-26T00:02:00.000Z",
          endedAt: "2026-03-26T00:02:01.000Z",
        },
        {
          nodeId: "workflow-output",
          nodeExecId: "exec-2",
          status: "succeeded",
          artifactDir: "/tmp/demo/exec-2",
          startedAt: "2026-03-26T00:02:01.000Z",
          endedAt: "2026-03-26T00:02:02.000Z",
        },
      ],
      communicationCounter: 0,
      communications: [],
      runtimeVariables: {
        workflowOutput: {
          summary: "done",
          score: 0.9,
        },
      },
    },
    nodeExecutions: [
      {
        sessionId: "sess-3",
        nodeExecId: "exec-2",
        nodeId: "workflow-output",
        status: "succeeded",
        artifactDir: "/tmp/demo/exec-2",
        startedAt: "2026-03-26T00:02:01.000Z",
        endedAt: "2026-03-26T00:02:02.000Z",
        attempt: 1,
        outputAttemptCount: null,
        outputValidationErrors: null,
        backendSessionMode: null,
        backendSessionId: null,
        restartedFromNodeExecId: null,
        inputHash: "in",
        outputHash: "out",
        inputJson: "{\"request\":\"ship\"}",
        outputJson: "{\"summary\":\"done\",\"score\":0.9}",
        createdAt: "2026-03-26T00:02:02.000Z",
      },
    ],
    nodeLogs: [],
  };
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

describe("buildWorkflowDefinitionContent", () => {
  test("shows a concise workflow summary without dumping raw workflow json", () => {
    const loaded = makeLoadedWorkflow({
      id: "workflow-input",
      model: "input-model",
      promptTemplate: "Read the latest human input and summarize it.",
      variables: {},
    });

    const content = buildWorkflowDefinitionContent(loaded);

    expect(content).toContain("Workflow: demo");
    expect(content).toContain("Sub-workflow ids: delivery");
    expect(content).toContain(
      "Use the Nodes pane and press enter to inspect an individual node definition.",
    );
    expect(content).not.toContain("workflow.json");
    expect(content).not.toContain("workflow-vis.json");
  });
});

describe("buildWorkflowRunPreview", () => {
  test("shows workflow description and compact node purposes for the run screen", () => {
    const loaded = makeLoadedWorkflow({
      id: "workflow-input",
      description: "Normalize the received request",
      model: "input-model",
      promptTemplate: "Read the latest human input and summarize it.",
      variables: {},
    });

    const content = plainStyledText(buildWorkflowRunPreview(loaded));

    expect(content).toContain("Description");
    expect(content).toContain("demo workflow");
    expect(content).toContain(
      "- workflow-input (INPUT): Normalize the received request",
    );
    expect(content).toContain("- workflow-output (OUTPUT): Return output");
    expect(content).not.toContain("Node Structure");
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
    expect(text).toContain("Description");
    expect(text).toContain("demo workflow");
    expect(text).toContain("Node Structure");
  });

  test("buildWorkflowSelectorHistorySummary shows aggregate workflow run counts", () => {
    const text = plainStyledText(
      buildWorkflowSelectorHistorySummary({
        latestRunSessionView: makeWorkspaceLatestRunView(),
        selectedWorkflowName: "demo",
        sessions: [
          {
            sessionId: "sess-3",
            workflowName: "demo",
            workflowId: "demo",
            status: "running",
            startedAt: "2026-03-26T00:02:00.000Z",
            endedAt: null,
            currentNodeId: "workflow-input",
            nodeExecutionCounter: 1,
            lastError: null,
            updatedAt: "2026-03-26T00:02:10.000Z",
          },
          {
            sessionId: "sess-2",
            workflowName: "demo",
            workflowId: "demo",
            status: "failed",
            startedAt: "2026-03-25T00:01:00.000Z",
            endedAt: "2026-03-25T00:01:40.000Z",
            currentNodeId: "workflow-output",
            nodeExecutionCounter: 2,
            lastError: "boom",
            updatedAt: "2026-03-25T00:01:40.000Z",
          },
          {
            sessionId: "sess-1",
            workflowName: "demo",
            workflowId: "demo",
            status: "completed",
            startedAt: "2026-03-24T00:00:00.000Z",
            endedAt: "2026-03-24T00:00:50.000Z",
            currentNodeId: "workflow-output",
            nodeExecutionCounter: 2,
            lastError: null,
            updatedAt: "2026-03-24T00:00:50.000Z",
          },
        ],
        workflowFilterText: "",
      }),
    );

    expect(text).toContain("Runs: 3");
    expect(text).toContain("Success: 1");
    expect(text).toContain("Failed: 1");
    expect(text).toContain("Running: 1");
    expect(text).toContain("Latest Run");
    expect(text).toContain("sessionId: sess-3");
    expect(text).toContain("status:");
    expect(text).toContain("Output");
    expect(text).toContain("\"summary\": \"done\"");
  });

  test("buildWorkflowSelectorHistorySummary surfaces latest-run load failures clearly", () => {
    const text = plainStyledText(
      buildWorkflowSelectorHistorySummary({
        latestRunStatusError: "database temporarily unavailable",
        selectedWorkflowName: "demo",
        sessions: [
          {
            sessionId: "sess-3",
            workflowName: "demo",
            workflowId: "demo",
            status: "running",
            startedAt: "2026-03-26T00:02:00.000Z",
            endedAt: null,
            currentNodeId: "workflow-input",
            nodeExecutionCounter: 1,
            lastError: null,
            updatedAt: "2026-03-26T00:02:10.000Z",
          },
        ],
        workflowFilterText: "",
      }),
    );

    expect(text).toContain(
      "Latest run details unavailable: database temporarily unavailable",
    );
    expect(text).not.toContain("(not available yet)");
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
        filterText: "",
        inputSyntax: {
          status: "valid",
          summary: "valid JSON",
        },
        matchesCount: 2,
        message: "Help",
        navigation: {
          detailMode: "summary",
          detailReturnPane: "nodes",
          editingInput: false,
          focusPane: "nodes",
          historyViewMode: "workflow",
          screenMode: "definition",
        },
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
        filterText: "",
        inputSyntax: {
          status: "valid",
          summary: "valid JSON",
        },
        matchesCount: 2,
        message: "Help",
        navigation: {
          detailMode: "summary",
          detailReturnPane: "nodes",
          editingInput: false,
          focusPane: "input",
          historyViewMode: "workflow",
          screenMode: "run",
        },
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
        filterText: "",
        inputSyntax: {
          status: "valid",
          summary: "valid JSON",
        },
        matchesCount: 2,
        message: "Help",
        navigation: {
          detailMode: "summary",
          detailReturnPane: "nodes",
          editingInput: false,
          focusPane: "sessions",
          historyViewMode: "workflow",
          screenMode: "history",
        },
        workflowCount: 2,
        workflowInputDetection: {
          mode: "json",
          reason: "detected structured input",
        },
        workflowName: "demo-flow",
      }),
    ).toContain("enter/ctrl-m: load selection");
  });

  test("documents workflow history delete-all in the history help text", () => {
    expect(
      buildWorkflowHistoryStatusMessage({
        busy: false,
        filterText: "",
        inputSyntax: {
          status: "valid",
          summary: "valid JSON",
        },
        matchesCount: 2,
        message: "Help",
        navigation: {
          detailMode: "summary",
          detailReturnPane: "nodes",
          editingInput: false,
          focusPane: "sessions",
          historyViewMode: "workflow",
          screenMode: "history",
        },
        workflowCount: 2,
        workflowInputDetection: {
          mode: "json",
          reason: "detected structured input",
        },
        workflowName: "demo-flow",
      }),
    ).toContain("workflow runs: D runs workflow history delete-all for the current workflow");
  });

  test("documents that escape closes in-pane viewers before returning", () => {
    expect(
      buildWorkflowHistoryStatusMessage({
        busy: false,
        filterText: "",
        inputSyntax: {
          status: "valid",
          summary: "valid JSON",
        },
        matchesCount: 2,
        message: "Help",
        navigation: {
          detailMode: "summary",
          detailReturnPane: "nodes",
          editingInput: false,
          focusPane: "detail",
          historyViewMode: "workflow",
          screenMode: "history",
        },
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

describe("buildOpenTuiFooterShortcutRow", () => {
  test("returns workspace shortcuts on one line", () => {
    expect(
      buildOpenTuiFooterShortcutRow({
        navigation: {
          historyViewMode: "workflow",
          screenMode: "workspace",
        },
      }),
    ).toContain("enter/ctrl-m/l definition");
  });

  test("returns definition shortcuts on one line", () => {
    expect(
      buildOpenTuiFooterShortcutRow({
        navigation: {
          historyViewMode: "workflow",
          screenMode: "definition",
        },
      }),
    ).toContain("enter/ctrl-m node popup");
  });

  test("returns workflow-history shortcuts on one line", () => {
    expect(
      buildOpenTuiFooterShortcutRow({
        navigation: {
          historyViewMode: "workflow",
          screenMode: "history",
        },
      }),
    ).toContain("D delete-all");
  });

  test("returns subworkflow-history shortcuts on one line", () => {
    expect(
      buildOpenTuiFooterShortcutRow({
        navigation: {
          historyViewMode: "subworkflow",
          screenMode: "history",
        },
      }),
    ).toContain("h list->nodes/parent");
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
        navigation: {
          detailMode: "summary",
          focusPane: "detail",
        },
      }),
    ).toBe("list");
  });

  test("treats non-summary detail views as scroll navigation", () => {
    expect(
      resolveHistoryPaneNavigationMode({
        navigation: {
          detailMode: "inbox",
          focusPane: "detail",
        },
      }),
    ).toBe("scroll");
  });

  test("treats the input pane as typing, not pane navigation", () => {
    expect(
      resolveHistoryPaneNavigationMode({
        navigation: {
          detailMode: "summary",
          focusPane: "input",
        },
      }),
    ).toBe("typing");
  });
});

describe("resolveDirectionalNavigationAction", () => {
  test("maps workspace forward navigation to opening definition", () => {
    expect(
      resolveDirectionalNavigationAction({
        direction: "forward",
        navigation: {
          focusPane: "workflows",
          historyViewMode: "workflow",
          screenMode: "workspace",
        },
      }),
    ).toEqual({ kind: "open-definition" });
  });

  test("maps definition forward navigation to opening history", () => {
    expect(
      resolveDirectionalNavigationAction({
        direction: "forward",
        navigation: {
          focusPane: "nodes",
          historyViewMode: "workflow",
          screenMode: "definition",
        },
      }),
    ).toEqual({ kind: "open-history" });
  });

  test("maps history workflow forward navigation from sessions to nodes", () => {
    expect(
      resolveDirectionalNavigationAction({
        direction: "forward",
        navigation: {
          focusPane: "sessions",
          historyViewMode: "workflow",
          screenMode: "history",
        },
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
        navigation: {
          focusPane: "sessions",
          historyViewMode: "subworkflow",
          screenMode: "history",
        },
      }),
    ).toEqual({ kind: "close-subworkflow" });
  });
});

describe("resolveOpenTuiPopupKind", () => {
  test("prefers the topmost popup in render order", () => {
    expect(
      resolveOpenTuiPopupKind({
        agentSessionPopupOpen: true,
        confirmPopupKind: "run-confirm",
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
        confirmPopupKind: "none",
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
        confirmPopupKind: "none",
        filterPopupOpen: false,
        helpPopupOpen: false,
        nodeDefinitionPopupOpen: false,
      }),
    ).toBe("none");
  });

  test("returns delete-history-confirm when that confirmation popup is open", () => {
    expect(
      resolveOpenTuiPopupKind({
        agentSessionPopupOpen: false,
        confirmPopupKind: "delete-history-confirm",
        filterPopupOpen: false,
        helpPopupOpen: false,
        nodeDefinitionPopupOpen: false,
      }),
    ).toBe("delete-history-confirm");
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
    expect(resolvePopupConfirmAction("delete-history-confirm")).toEqual({
      kind: "confirm-delete-history",
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
      kind: "close-confirm-popup",
    });
    expect(resolvePopupRevertAction("delete-history-confirm")).toEqual({
      kind: "close-confirm-popup",
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
