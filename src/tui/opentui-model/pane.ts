import type {
  FocusPane,
  HistoryPaneLabels,
  HistoryViewMode,
  OpenTuiPaneChromeState,
  ScreenMode,
  TuiWorkflowInputDetection,
  TuiWorkflowInputMode,
  TuiWorkflowInputSyntax,
} from "./types";

function paneTitle(label: string, active: boolean): string {
  return active ? ` >> ${label} << ` : ` ${label} `;
}

function paneBorderColor(active: boolean): string {
  return active ? "#4fd1ff" : "#5b6670";
}

function paneBackgroundColor(active: boolean): string {
  return active ? "#101a22" : "transparent";
}

export function resolveOpenTuiPaneChrome(input: {
  readonly focusPane: FocusPane;
  readonly hasRuntimeSession: boolean;
  readonly historyPaneLabels: HistoryPaneLabels;
  readonly inputMode: TuiWorkflowInputMode;
  readonly inputSyntaxStatus: TuiWorkflowInputSyntax["status"];
  readonly screenMode: ScreenMode;
}): OpenTuiPaneChromeState {
  const workspaceWorkflowsActive =
    input.screenMode === "workspace" && input.focusPane === "workflows";
  const inputSyntaxSuffix =
    input.inputMode === "json"
      ? `, ${input.inputSyntaxStatus === "invalid" ? "syntax error" : "syntax ok"}`
      : "";
  return {
    detail: {
      backgroundColor: "transparent",
      borderColor: paneBorderColor(
        input.screenMode === "history" && input.focusPane === "detail",
      ),
      title: paneTitle(
        "node detail",
        input.screenMode === "history" && input.focusPane === "detail",
      ),
    },
    historyHeader: {
      backgroundColor: "transparent",
      borderColor: paneBorderColor(input.screenMode === "history"),
      title: paneTitle(
        input.historyPaneLabels.header,
        input.screenMode === "history",
      ),
    },
    input: {
      backgroundColor: paneBackgroundColor(
        input.screenMode === "run" ||
          (input.screenMode === "history" && input.focusPane === "input"),
      ),
      borderColor: paneBorderColor(
        input.screenMode === "run" ||
          (input.screenMode === "history" && input.focusPane === "input"),
      ),
      title:
        input.screenMode === "run"
          ? paneTitle(
              `Run Input (${input.inputMode}${inputSyntaxSuffix})`,
              true,
            )
          : paneTitle(
              `Input (${input.inputMode}${inputSyntaxSuffix})`,
              input.screenMode === "history" && input.focusPane === "input",
            ),
    },
    node: {
      backgroundColor: paneBackgroundColor(
        input.screenMode === "history" && input.focusPane === "nodes",
      ),
      borderColor: paneBorderColor(
        input.screenMode === "history" && input.focusPane === "nodes",
      ),
      title: paneTitle(
        input.historyPaneLabels.right,
        input.screenMode === "history" && input.focusPane === "nodes",
      ),
    },
    runStatus: {
      backgroundColor: "transparent",
      borderColor: paneBorderColor(input.screenMode === "run"),
      title: paneTitle("Execution Status", input.screenMode === "run"),
    },
    runWorkflow: {
      backgroundColor: "transparent",
      borderColor: paneBorderColor(input.screenMode === "run"),
      title: paneTitle("Workflow Detail", input.screenMode === "run"),
    },
    selectorPreview: {
      backgroundColor: "transparent",
      borderColor: paneBorderColor(
        input.screenMode === "workspace" && !workspaceWorkflowsActive,
      ),
      title: paneTitle(
        "Workflow Preview",
        input.screenMode === "workspace" && !workspaceWorkflowsActive,
      ),
    },
    session: {
      backgroundColor: paneBackgroundColor(
        input.screenMode === "history" && input.focusPane === "sessions",
      ),
      borderColor: paneBorderColor(
        input.screenMode === "history" && input.focusPane === "sessions",
      ),
      title: paneTitle(
        input.historyPaneLabels.left,
        input.screenMode === "history" && input.focusPane === "sessions",
      ),
    },
    workflow: {
      backgroundColor: paneBackgroundColor(workspaceWorkflowsActive),
      borderColor: paneBorderColor(workspaceWorkflowsActive),
      title: paneTitle("Workflows", workspaceWorkflowsActive),
    },
    workflowDefinition: {
      backgroundColor: paneBackgroundColor(
        input.screenMode === "definition" && input.focusPane === "definition",
      ),
      borderColor: paneBorderColor(
        input.screenMode === "definition" && input.focusPane === "definition",
      ),
      title: paneTitle(
        "Workflow Definition",
        input.screenMode === "definition" && input.focusPane === "definition",
      ),
    },
    workflowDefinitionNodes: {
      backgroundColor: paneBackgroundColor(
        input.screenMode === "definition" && input.focusPane === "nodes",
      ),
      borderColor: paneBorderColor(
        input.screenMode === "definition" && input.focusPane === "nodes",
      ),
      title: paneTitle(
        "Nodes",
        input.screenMode === "definition" && input.focusPane === "nodes",
      ),
    },
  };
}

export function buildWorkflowHistoryStatusMessage(input: {
  readonly busy: boolean;
  readonly detailMode: import("./types").DetailMode;
  readonly editingInput: boolean;
  readonly filterText: string;
  readonly focusPane: FocusPane;
  readonly historyViewMode: HistoryViewMode;
  readonly inputSyntax: TuiWorkflowInputSyntax;
  readonly matchesCount: number;
  readonly message: string;
  readonly screenMode: ScreenMode;
  readonly workflowCount: number;
  readonly workflowInputDetection: TuiWorkflowInputDetection;
  readonly workflowName?: string;
}): string {
  if (input.screenMode === "workspace") {
    return [
      input.message,
      "",
      `Screen=workspace  Filter=${input.filterText.length === 0 ? "(none)" : input.filterText}  Matches=${String(
        input.matchesCount,
      )}/${String(input.workflowCount)}  Busy=${String(input.busy)}`,
      "j/k: move  /: filter  y: copy workflow id  enter/ctrl-m/l: definition  n: new run  r: refresh  ?: help  q: quit",
      "",
      "Press q to close this popup.",
    ].join("\n");
  }
  if (input.screenMode === "definition") {
    return [
      input.message,
      "",
      `Screen=definition  Workflow=${input.workflowName ?? "-"}  Focus=${input.focusPane}  Busy=${String(
        input.busy,
      )}`,
      "tab/shift-tab: cycle definition <-> nodes  j/k or arrows: scroll/move in the focused pane",
      "nodes: enter/ctrl-m opens the node-definition popup  l: history  n: new run  h: workspace",
      "r: refresh  ?: help  q: quit",
      "",
      "Press q to close this popup.",
    ].join("\n");
  }
  if (input.screenMode === "run") {
    return [
      input.message,
      "",
      `Screen=run  Workflow=${input.workflowName ?? "-"}  InputMode=${input.workflowInputDetection.mode}  InputSyntax=${input.inputSyntax.summary}  Busy=${String(
        input.busy,
      )}`,
      "Type into the input editor. enter/ctrl-m: confirm run  f: format JSON  m: toggle input mode",
      "l: open history  h: workspace  r: refresh status  ?: help  q: quit",
      "",
      "Press q to close this popup.",
    ].join("\n");
  }
  return [
    input.message,
    "",
    `Screen=history/${input.historyViewMode}  Focus=${input.focusPane}  Detail=${input.detailMode}  InputMode=${input.workflowInputDetection.mode}  Editing=${String(
      input.editingInput,
    )}  Busy=${String(input.busy)}`,
    `Input syntax=${input.inputSyntax.summary}`,
    "tab/shift-tab: cycle sessions -> nodes -> detail -> input  enter/ctrl-m: load selection  e: edit input  f: format JSON  m: toggle input mode",
    "nodes: enter/ctrl-m to node detail  node detail: j/k or arrows stay in-pane, enter/ctrl-m opens the selected JSON viewer or AI session popup, esc closes in-pane viewers before returning to the opener",
    "n: open new-run screen  y: copy focused id  R: rerun selected node  u: resume selected session  i/o/g/a/s: change detail view",
    input.historyViewMode === "workflow"
      ? "l: workflow runs -> nodes, subworkflow row -> subworkflow view  h: nodes -> workflow runs, workflow runs -> workspace  r: refresh  ?: help  q: quit"
      : "l: workflow nodes -> workflow list, workflow list -> child subworkflow  h: workflow list -> workflow nodes, workflow nodes -> parent view  r: refresh  ?: help  q: quit",
    "",
    "Press q to close this popup.",
  ].join("\n");
}

export function buildOpenTuiFooterShortcutRow(input: {
  readonly historyViewMode: HistoryViewMode;
  readonly screenMode: ScreenMode;
}): string {
  if (input.screenMode === "workspace") {
    return [
      "j/k move",
      "/ filter",
      "enter/ctrl-m/l definition",
      "n new-run",
      "y copy workflow id",
      "r refresh",
      "? help",
      "q quit",
    ].join("  ");
  }

  if (input.screenMode === "definition") {
    return [
      "tab/shift-tab cycle panes",
      "j/k or arrows move/scroll",
      "enter/ctrl-m node popup",
      "l history",
      "n new-run",
      "h workspace",
      "y copy workflow id",
      "r refresh",
      "? help",
      "q quit",
    ].join("  ");
  }

  if (input.screenMode === "run") {
    return [
      "enter/ctrl-m confirm run",
      "m mode",
      "f format JSON",
      "l history",
      "h workspace",
      "r refresh",
      "? help",
      "q quit",
    ].join("  ");
  }

  return [
    "tab/shift-tab cycle panes",
    "j/k or arrows move/scroll",
    "enter/ctrl-m select/open",
    input.historyViewMode === "workflow"
      ? "l runs->nodes/subworkflow"
      : "l nodes->list/child",
    input.historyViewMode === "workflow"
      ? "h nodes->runs/workspace"
      : "h list->nodes/parent",
    "e edit",
    "m mode",
    "f format",
    "i/o/g/a/s detail",
    "n new-run",
    "R rerun",
    "u resume",
    "y copy id",
    "r refresh",
    "? help",
    "q quit",
  ].join("  ");
}
