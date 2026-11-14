import type {
  FocusPane,
  HistoryPaneLabels,
  OpenTuiNavigationState,
  OpenTuiPaneChromeState,
  OpenTuiShortcutEntry,
  OpenTuiShortcutSection,
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

function shortcut(
  compactLabel: string | undefined,
  helpLabel: string,
): OpenTuiShortcutEntry {
  return compactLabel === undefined ? { helpLabel } : { compactLabel, helpLabel };
}

function formatCompactShortcutSection(section: OpenTuiShortcutSection): string {
  return section.entries
    .flatMap((entry) =>
      entry.compactLabel === undefined ? [] : [entry.compactLabel],
    )
    .join("  ");
}

function formatHelpShortcutSection(section: OpenTuiShortcutSection): string {
  return section.entries.map((entry) => entry.helpLabel).join("  ");
}

export function resolveOpenTuiShortcutSections(input: {
  readonly navigation: Pick<OpenTuiNavigationState, "historyViewMode" | "screenMode">;
}): readonly OpenTuiShortcutSection[] {
  if (input.navigation.screenMode === "workspace") {
    return [
      {
        entries: [
          shortcut("j/k move", "j/k: move"),
          shortcut("/ filter", "/: filter"),
          shortcut(
            "enter/ctrl-m/l definition",
            "enter/ctrl-m/l: definition",
          ),
          shortcut("n new-run", "n: new run"),
          shortcut("y copy workflow id", "y: copy workflow id"),
          shortcut("r refresh", "r: refresh"),
          shortcut("? help", "?: help"),
          shortcut("q quit", "q: quit"),
        ],
      },
    ];
  }

  if (input.navigation.screenMode === "definition") {
    return [
      {
        entries: [
          shortcut(
            "tab/shift-tab cycle panes",
            "tab/shift-tab: cycle definition <-> nodes",
          ),
          shortcut("j/k or arrows move/scroll", "j/k or arrows: scroll/move in the focused pane"),
        ],
      },
      {
        entries: [
          shortcut(
            "enter/ctrl-m node popup",
            "nodes: enter/ctrl-m opens the node-definition popup",
          ),
          shortcut("l history", "l: history"),
          shortcut("n new-run", "n: new run"),
          shortcut("h workspace", "h: workspace"),
        ],
      },
      {
        entries: [
          shortcut("y copy workflow id", "y: copy workflow id"),
          shortcut("r refresh", "r: refresh"),
          shortcut("? help", "?: help"),
          shortcut("q quit", "q: quit"),
        ],
      },
    ];
  }

  if (input.navigation.screenMode === "run") {
    return [
      {
        entries: [
          shortcut(undefined, "Type into the input editor."),
          shortcut("enter/ctrl-m confirm run", "enter/ctrl-m: confirm run"),
          shortcut("f format JSON", "f: format JSON"),
          shortcut("m mode", "m: toggle input mode"),
        ],
      },
      {
        entries: [
          shortcut("l history", "l: open history"),
          shortcut("h workspace", "h: workspace"),
          shortcut("r refresh", "r: refresh status"),
          shortcut("? help", "?: help"),
          shortcut("q quit", "q: quit"),
        ],
      },
    ];
  }

  const historyFooterForward =
    input.navigation.historyViewMode === "workflow"
      ? "l runs->nodes/subworkflow"
      : "l nodes->list/child";
  const historyHelpForward =
    input.navigation.historyViewMode === "workflow"
      ? "l: workflow runs -> nodes, subworkflow row -> subworkflow view"
      : "l: workflow nodes -> workflow list, workflow list -> child subworkflow";
  const historyFooterRevert =
    input.navigation.historyViewMode === "workflow"
      ? "h nodes->runs/parent"
      : "h list->nodes/parent";
  const historyHelpRevert =
    input.navigation.historyViewMode === "workflow"
      ? "h: nodes -> workflow runs, workflow runs -> workspace"
      : "h: workflow list -> workflow nodes, workflow nodes -> parent view";
  return [
    {
      entries: [
        shortcut("tab/shift-tab cycle panes", "tab/shift-tab: cycle sessions -> nodes -> detail -> input"),
        shortcut("j/k or arrows move/scroll", "j/k or arrows: move/scroll"),
        shortcut("enter/ctrl-m select/open", "enter/ctrl-m: load selection"),
        shortcut("e edit", "e: edit input"),
        shortcut("f format", "f: format JSON"),
        shortcut("m mode", "m: toggle input mode"),
      ],
    },
    {
      entries: [
        shortcut(
          undefined,
          "nodes: enter/ctrl-m to node detail",
        ),
        shortcut(
          undefined,
          "node detail: j/k or arrows stay in-pane, enter/ctrl-m opens the selected JSON viewer or AI session popup, esc closes in-pane viewers before returning to the opener",
        ),
      ],
    },
    {
      entries: [
        shortcut("n new-run", "n: open new-run screen"),
        shortcut("R rerun", "R: rerun selected node"),
        shortcut("u resume", "u: resume selected session"),
        shortcut(
          input.navigation.historyViewMode === "workflow"
            ? "d delete run"
            : undefined,
          "workflow runs: d opens delete confirmation",
        ),
        shortcut(
          input.navigation.historyViewMode === "workflow"
            ? "D delete-all"
            : undefined,
          "workflow runs: D runs workflow history delete-all for the current workflow",
        ),
        shortcut("y copy id", "y: copy focused id"),
        shortcut("i/o/g/a/s detail", "i/o/g/a/s: change detail view"),
      ],
    },
    {
      entries: [
        shortcut(historyFooterForward, historyHelpForward),
        shortcut(historyFooterRevert, historyHelpRevert),
        shortcut("r refresh", "r: refresh"),
        shortcut("? help", "?: help"),
        shortcut("q quit", "q: quit"),
      ],
    },
  ];
}

export function resolveOpenTuiPaneChrome(input: {
  readonly filterText: string;
  readonly focusPane: FocusPane;
  readonly hasRuntimeSession: boolean;
  readonly historyPaneLabels: HistoryPaneLabels;
  readonly inputMode: TuiWorkflowInputMode;
  readonly inputSyntaxStatus: TuiWorkflowInputSyntax["status"];
  readonly matchesCount: number;
  readonly screenMode: ScreenMode;
  readonly workflowCount: number;
}): OpenTuiPaneChromeState {
  const workspaceWorkflowsActive =
    input.screenMode === "workspace" && input.focusPane === "workflows";
  const workflowPaneLabel =
    input.screenMode === "workspace" && input.filterText.length > 0
      ? `Workflows [filtered ${String(input.matchesCount)}/${String(
          input.workflowCount,
        )}]`
      : "Workflows";
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
      borderColor: paneBorderColor(false),
      title: paneTitle("Workflow Preview", false),
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
      title: paneTitle(workflowPaneLabel, workspaceWorkflowsActive),
    },
    workspaceHistory: {
      backgroundColor: "transparent",
      borderColor: paneBorderColor(false),
      title: paneTitle("Latest Run Result", false),
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
  readonly filterText: string;
  readonly inputSyntax: TuiWorkflowInputSyntax;
  readonly matchesCount: number;
  readonly message: string;
  readonly navigation: OpenTuiNavigationState;
  readonly workflowCount: number;
  readonly workflowInputDetection: TuiWorkflowInputDetection;
  readonly workflowName?: string;
}): string {
  const shortcutSections = resolveOpenTuiShortcutSections({
    navigation: input.navigation,
  });
  if (input.navigation.screenMode === "workspace") {
    return [
      input.message,
      "",
      `Screen=workspace  Filter=${input.filterText.length === 0 ? "(none)" : input.filterText}  Matches=${String(
        input.matchesCount,
      )}/${String(input.workflowCount)}  Busy=${String(input.busy)}`,
      ...shortcutSections.map(formatHelpShortcutSection),
      "",
      "Press q to close this popup.",
    ].join("\n");
  }
  if (input.navigation.screenMode === "definition") {
    return [
      input.message,
      "",
      `Screen=definition  Workflow=${input.workflowName ?? "-"}  Focus=${input.navigation.focusPane}  Busy=${String(
        input.busy,
      )}`,
      ...shortcutSections.map(formatHelpShortcutSection),
      "",
      "Press q to close this popup.",
    ].join("\n");
  }
  if (input.navigation.screenMode === "run") {
    return [
      input.message,
      "",
      `Screen=run  Workflow=${input.workflowName ?? "-"}  InputMode=${input.workflowInputDetection.mode}  InputSyntax=${input.inputSyntax.summary}  Busy=${String(
        input.busy,
      )}`,
      ...shortcutSections.map(formatHelpShortcutSection),
      "",
      "Press q to close this popup.",
    ].join("\n");
  }
  return [
    input.message,
    "",
    `Screen=history/${input.navigation.historyViewMode}  Focus=${input.navigation.focusPane}  Detail=${input.navigation.detailMode}  InputMode=${input.workflowInputDetection.mode}  Editing=${String(
      input.navigation.editingInput,
    )}  Busy=${String(input.busy)}`,
    `Input syntax=${input.inputSyntax.summary}`,
    ...shortcutSections.map(formatHelpShortcutSection),
    "",
    "Press q to close this popup.",
  ].join("\n");
}

export function buildOpenTuiFooterShortcutRow(input: {
  readonly navigation: Pick<OpenTuiNavigationState, "historyViewMode" | "screenMode">;
}): string {
  return resolveOpenTuiShortcutSections({
    navigation: input.navigation,
  })
    .map(formatCompactShortcutSection)
    .filter((line) => line.length > 0)
    .join("  ");
}
