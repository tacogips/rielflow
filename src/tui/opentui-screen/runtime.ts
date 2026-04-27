import { spawnSync } from "node:child_process";
import { render as renderSolid } from "@opentui/solid";
import type { CliIo } from "../../cli";
import type { AgentSessionTranscript } from "../agent-session-history";
import { buildHistoryDetailPaneState } from "../opentui-detail-content";
import {
  applyOpenTuiPaneChrome,
  requireOpenTuiMainViewRefs,
} from "../opentui-host-view";
import {
  createOpenTuiController,
  resolveEditorTextForLoadedSession,
} from "../opentui-controller";
import { OpenTuiWorkflowAppView } from "../opentui-solid-app";
import type { OpenTuiMainViewRefs } from "../opentui-solid-components";
import type { LoadedWorkflow } from "../../workflow/load";
import type { ManagerMessageRecord } from "../../workflow/manager-session-store";
import type {
  NodeExecutionRecord,
  WorkflowSessionState,
} from "../../workflow/session";
import type { RuntimeSessionSummary } from "../../workflow/runtime-db";
import { type CliAgentBackend } from "../../workflow/types";
import {
  buildNodeDefinitionPopupContent,
  buildNodeSelectOptions,
  buildOpenTuiFooterShortcutRow,
  buildOpenTuiBreadcrumb,
  buildWorkflowDefinitionContent,
  buildWorkflowDefinitionNodeSelectOptions,
  buildSessionSelectOptions,
  buildWorkflowHistoryHeader,
  buildWorkflowRunPreview,
  buildWorkflowSelectorHistorySummary,
  buildWorkflowSelectorPreview,
  buildWorkflowHistoryStatusMessage,
  buildWorkflowRunStatusContent,
  describeTuiWorkflowInputSyntax,
  detectWorkflowInputMode,
  filterWorkflowNames,
  isAllowedNodeDetailKey,
  isDetailAgentSessionSelection,
  isDetailJsonViewerSelection,
  normalizeWorkflowFilterText,
  OPEN_TUI_EMPTY_SELECT_VALUE,
  resolveDirectionalNavigationAction,
  resolveHistoryAdvanceAction,
  resolveHistoryRevertAction,
  resolveOpenTuiPopupKind,
  resolvePopupConfirmAction,
  resolvePopupRevertAction,
  resolvePopupScrollDelta,
  resolveHistoryPaneLabels,
  resolveHistoryPaneNavigationMode,
  resolveManagerSessionId,
  resolveOpenTuiInternallyHandledListId,
  resolveOpenTuiPaneChrome,
  resolveTabFocusTarget,
  workflowNamesToSelectOptions,
} from "../opentui-model";
import type {
  DetailMode,
  DetailReturnPane,
  FocusPane,
  OpenTuiNavigationState,
  RuntimeSessionView,
  ScreenMode,
  TuiWorkflowInputDetection,
} from "../opentui-model";
import {
  createCliRenderer,
  KeyEvent,
  SelectRenderable,
  SelectRenderableEvents,
} from "@opentui/core";
import {
  focusOpenTuiTarget,
  OPEN_TUI_MAIN_PANE_LAYOUT,
  resolveBlurredSelectRedrawTarget,
  type OpenTuiFocusableTarget,
  type ShortcutKeyEvent,
} from "../opentui-view-shared";

function isStepAddressedAuthoring(
  workflow: LoadedWorkflow["bundle"]["workflow"] | undefined,
): boolean {
  return workflow?.steps !== undefined;
}

/** Step-addressed UIs should show the step id when present, not only the registry node id. */
function primaryStepOrNodeLabel(execution: NodeExecutionRecord): string {
  return execution.stepId ?? execution.nodeId;
}

export interface OpenTuiWorkflowActionResult {
  readonly exitCode: number;
  readonly sessionId: string;
  readonly status: WorkflowSessionState["status"];
}

export interface OpenTuiWorkflowExecutionHandle {
  readonly sessionId: string;
  readonly completion: Promise<OpenTuiWorkflowActionResult>;
}

export interface OpenTuiWorkflowAppOptions {
  readonly initialWorkflowName?: string;
  readonly initialSessionId?: string;
  readonly io: CliIo;
  readonly workflowNames: readonly string[];
  readonly refreshWorkflowNames: () => Promise<readonly string[]>;
  readonly loadWorkflowDefinition: (
    workflowName: string,
  ) => Promise<LoadedWorkflow>;
  readonly listWorkflowSessions: (
    workflowName: string,
  ) => Promise<readonly RuntimeSessionSummary[]>;
  readonly loadRuntimeSessionView: (
    sessionId: string,
  ) => Promise<RuntimeSessionView>;
  readonly deleteWorkflowSession?: (input: {
    readonly sessionId: string;
    readonly workflowId: string;
    readonly workflowName: string;
  }) => Promise<void>;
  readonly deleteWorkflowHistory?: (input: {
    readonly workflowId: string;
    readonly workflowName: string;
  }) => Promise<{
    readonly deletedSessionCount: number;
    readonly workflowId: string;
    readonly workflowName: string;
  }>;
  readonly loadManagerSessionMessages: (
    managerSessionId: string,
  ) => Promise<readonly ManagerMessageRecord[]>;
  readonly loadAgentSessionTranscript: (input: {
    readonly backend: CliAgentBackend;
    readonly sessionId: string;
  }) => Promise<AgentSessionTranscript>;
  readonly executeWorkflow: (input: {
    readonly workflowName: string;
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
  }) => Promise<OpenTuiWorkflowExecutionHandle>;
  readonly rerunWorkflow: (input: {
    readonly sourceSessionId: string;
    readonly fromStepId: string;
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
  }) => Promise<OpenTuiWorkflowActionResult>;
  readonly resumeWorkflow: (
    sessionId: string,
  ) => Promise<OpenTuiWorkflowActionResult>;
}

const WORKFLOW_SELECT_ID = "wf-select";
const DEFINITION_NODE_SELECT_ID = "workflow-definition-node-select";
const SESSION_SELECT_ID = "sess-select";
const NODE_SELECT_ID = "node-select";
const DETAIL_SUMMARY_SELECT_ID = "detail-summary-select";
export {
  focusOpenTuiTarget,
  OPEN_TUI_MAIN_PANE_LAYOUT,
  resolveBlurredSelectRedrawTarget,
};

function buildOsc52CopySequence(value: string): string {
  return `\u001b]52;c;${Buffer.from(value, "utf8").toString("base64")}\u0007`;
}

function tryCopyWithExternalCommand(
  command: string,
  args: readonly string[],
  value: string,
): boolean {
  const result = spawnSync(command, args, {
    input: value,
    stdio: ["pipe", "ignore", "ignore"],
  });
  return result.error === undefined && result.status === 0;
}

function tryCopyToClipboard(value: string): boolean {
  const wroteOsc52 =
    process.stdout.isTTY === true &&
    process.env["TERM"] !== "dumb" &&
    (() => {
      try {
        process.stdout.write(buildOsc52CopySequence(value));
        return true;
      } catch {
        return false;
      }
    })();

  const commandCandidates: ReadonlyArray<
    readonly [command: string, args: readonly string[]]
  > = [
    ["pbcopy", []],
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard", "-in"]],
    ["xsel", ["--clipboard", "--input"]],
    ["clip.exe", []],
  ];

  if (
    commandCandidates.some(([command, args]) =>
      tryCopyWithExternalCommand(command, args, value),
    )
  ) {
    return true;
  }

  return wroteOsc52;
}

function selectBoundedIndex(
  list: SelectRenderable,
  index: number,
  total: number,
): number {
  if (total <= 0) {
    list.setSelectedIndex(0);
    return -1;
  }
  const bounded = Math.max(0, Math.min(index, total - 1));
  list.setSelectedIndex(bounded);
  return bounded;
}

export function isOpenTuiRefreshKey(key: ShortcutKeyEvent): boolean {
  return key.name === "r" && !key.shift && !key.ctrl && !key.meta;
}

export function isOpenTuiRerunKey(key: ShortcutKeyEvent): boolean {
  return key.name === "r" && key.shift && !key.ctrl && !key.meta;
}

export function isOpenTuiHelpKey(key: ShortcutKeyEvent): boolean {
  return (
    !key.ctrl &&
    !key.meta &&
    ((key.name === "?" && !key.shift) || (key.name === "/" && key.shift))
  );
}

export async function runOpenTuiWorkflowApp(
  options: OpenTuiWorkflowAppOptions,
): Promise<number> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useAlternateScreen: true,
  });
  const viewRefs: OpenTuiMainViewRefs = {};
  await renderSolid(() => OpenTuiWorkflowAppView({ refs: viewRefs }), renderer);
  const mountedRefs = (() => {
    try {
      return requireOpenTuiMainViewRefs(viewRefs);
    } catch (error) {
      renderer.destroy();
      throw error;
    }
  })();
  const {
    agentSessionPopup,
    agentSessionPopupText,
    breadcrumbText,
    confirmPopup,
    confirmText,
    definitionScreen,
    detailScroll,
    detailSummaryHeader,
    detailSummarySelect,
    detailText,
    footerText,
    filterPopup,
    filterTextarea,
    helpPopup,
    helpText,
    historyHeaderText,
    historyScreen,
    inputRow,
    inputShell,
    inputTextarea,
    nodeDefinitionPopup,
    nodeDefinitionPopupText,
    nodeSelect,
    runStatusText,
    runTopRow,
    runWorkflowText,
    selectorPreviewText,
    workspaceHistoryText,
    selectorRow,
    sessionSelect,
    workflowDefinitionNodeSelect,
    workflowDefinitionText,
    workflowSelect,
  } = mountedRefs;

  let workflowNames = [...options.workflowNames];
  let filteredWorkflowNames = [...workflowNames];
  let loadedWorkflow: LoadedWorkflow | undefined;
  let selectorPreviewWorkflow: LoadedWorkflow | undefined;
  let workflowInputDetection: TuiWorkflowInputDetection = {
    mode: "text",
    reason: "defaulted before loading a workflow",
  };
  let workflowSessions: readonly RuntimeSessionSummary[] = [];
  let runtimeSessionView: RuntimeSessionView | undefined;
  let managerMessages: readonly ManagerMessageRecord[] = [];
  let focusPane: FocusPane =
    options.initialWorkflowName === undefined &&
    options.initialSessionId === undefined
      ? "workflows"
      : "sessions";
  let detailMode: DetailMode = "summary";
  let screenMode: ScreenMode =
    options.initialWorkflowName === undefined &&
    options.initialSessionId === undefined
      ? "workspace"
      : "history";
  let busy = false;
  let editingInput: boolean = false;
  let filterPopupOpen = false;
  let helpPopupOpen = false;
  let confirmPopupKind: "delete-history-confirm" | "none" | "run-confirm" =
    "none";
  let confirmPopupTitle = " Confirm Run ";
  let pendingDeleteScope: "none" | "session" | "workflow" = "none";
  let agentSessionPopupOpen = false;
  let nodeDefinitionPopupOpen = false;
  let agentSessionPopupTextContent = "";
  let agentSessionPopupTitle = " AI Agent Session ";
  let nodeDefinitionPopupTextContent = "";
  let nodeDefinitionPopupTitle = " Node Definition ";
  let detailReturnPane: DetailReturnPane = "nodes";
  let detailViewerTitle = "";
  let detailViewerBody = "";
  let historyReturnsToDefinition = false;
  let workflowFilterText = "";
  let workflowFilterTextBeforePopup = "";
  let workflowSelectionBeforePopup: string | undefined;
  let pendingRunRuntimeVariables: Readonly<Record<string, unknown>> | undefined;
  let runSessionView: RuntimeSessionView | undefined;
  let runExecutionResult: OpenTuiWorkflowActionResult | undefined;
  let runPendingSessionId: string | undefined;
  let runStatusError: string | undefined;
  let workspaceLatestRunView: RuntimeSessionView | undefined;
  let workspaceLatestRunError: string | undefined;
  let runPollTimer: ReturnType<typeof setInterval> | undefined;
  let runPollInFlight = false;
  let isClosed = false;
  let suppressNodeSelectionChange = false;
  let suppressDefinitionNodeSelectionChange = false;
  let suppressSessionSelectionChange = false;
  let suppressWorkflowSelectionChange = false;
  let lastStatus =
    screenMode === "workspace"
      ? "Select a workflow, then open definition with enter/ctrl-m/l or start a new run with n."
      : "Loading TUI state...";

  const navigationState = (): OpenTuiNavigationState => ({
    detailMode,
    detailReturnPane,
    editingInput,
    focusPane,
    screenMode,
  });
  const historyRootReturnScreen = (): "definition" | "workspace" =>
    historyReturnsToDefinition ? "definition" : "workspace";

  const isEnterKey = (key: KeyEvent): boolean => key.name === "return";
  const isCtrlMKey = (key: KeyEvent): boolean =>
    key.name === "m" && key.ctrl && !key.meta;
  const isConfirmKey = (key: KeyEvent): boolean =>
    isEnterKey(key) || isCtrlMKey(key);
  const isDeleteHistoryAllowed = (): boolean =>
    screenMode === "history" && focusPane === "sessions";

  const selectedWorkflowName = (): string | undefined => {
    const option = workflowSelect.getSelectedOption();
    if (option === null || option.value === OPEN_TUI_EMPTY_SELECT_VALUE) {
      return undefined;
    }
    return String(option.value);
  };

  const selectedSessionSummary = (): RuntimeSessionSummary | undefined => {
    const option = sessionSelect.getSelectedOption();
    if (option === null || option.value === OPEN_TUI_EMPTY_SELECT_VALUE) {
      return undefined;
    }
    return workflowSessions.find(
      (session) => session.sessionId === option.value,
    );
  };

  const describeDeleteHistoryConfirmation = (
    session: RuntimeSessionSummary,
  ): string =>
    [
      `Delete workflow run '${session.sessionId}'?`,
      "",
      `Workflow: ${session.workflowName}`,
      `Status: ${session.status}`,
      `Started: ${session.startedAt}`,
      `Ended: ${session.endedAt ?? "-"}`,
      "",
      "Yes: enter or ctrl-m",
      "No: esc",
      "",
      "This removes the saved history entry, runtime index rows, and stored artifacts for this run.",
    ].join("\n");

  const describeDeleteWorkflowHistoryConfirmation = (
    workflowName: string,
    workflowId: string,
    sessions: readonly RuntimeSessionSummary[],
  ): string =>
    [
      `Delete all workflow history for '${workflowName}'?`,
      "",
      `Workflow-ID: ${workflowId}`,
      `Stored runs: ${String(sessions.length)}`,
      `Latest run: ${sessions[0]?.sessionId ?? "-"}`,
      "",
      "Yes: enter or ctrl-m",
      "No: esc",
      "",
      "This runs workflow history delete-all and removes saved session files, runtime index rows, and stored artifacts for this workflow.",
    ].join("\n");

  const selectedNodeExecution = (): NodeExecutionRecord | undefined => {
    if (runtimeSessionView === undefined) {
      return undefined;
    }
    const option = nodeSelect.getSelectedOption();
    if (option === null || option.value === OPEN_TUI_EMPTY_SELECT_VALUE) {
      return undefined;
    }
    return runtimeSessionView.session.nodeExecutions.find(
      (execution) => execution.nodeExecId === option.value,
    );
  };

  const selectedManagerSessionId = (): string | undefined => {
    const execution = selectedHistoryExecution();
    if (execution === undefined || loadedWorkflow === undefined) {
      return undefined;
    }
    return resolveManagerSessionId(loadedWorkflow.bundle.workflow, execution);
  };

  const selectedDefinitionNodeId = (): string | undefined => {
    const option = workflowDefinitionNodeSelect.getSelectedOption();
    if (option === null || option.value === OPEN_TUI_EMPTY_SELECT_VALUE) {
      return undefined;
    }
    return String(option.value);
  };

  const selectedHistoryExecution = (): NodeExecutionRecord | undefined =>
    selectedNodeExecution();

  const selectedWorkspaceWorkflowId = (): string | undefined => {
    const selected = selectedWorkflowName();
    if (selected === undefined) {
      return undefined;
    }
    if (selectorPreviewWorkflow?.workflowName === selected) {
      return selectorPreviewWorkflow.bundle.workflow.workflowId;
    }
    if (loadedWorkflow?.workflowName === selected) {
      return loadedWorkflow.bundle.workflow.workflowId;
    }
    return undefined;
  };

  const syncFilteredWorkflowNames = (
    preferredWorkflowName: string | undefined,
  ): void => {
    filteredWorkflowNames = [
      ...filterWorkflowNames(workflowNames, workflowFilterText),
    ];
    suppressWorkflowSelectionChange = true;
    try {
      workflowSelect.options =
        filteredWorkflowNames.length === 0
          ? [
              {
                name:
                  workflowFilterText.length === 0
                    ? "(no workflows found)"
                    : "(no workflows match filter)",
                description: "",
                value: OPEN_TUI_EMPTY_SELECT_VALUE,
              },
            ]
          : [...workflowNamesToSelectOptions(filteredWorkflowNames)];
      if (filteredWorkflowNames.length === 0) {
        workflowSelect.setSelectedIndex(0);
        return;
      }
      const nextIndex = filteredWorkflowNames.findIndex(
        (workflowName) => workflowName === preferredWorkflowName,
      );
      selectBoundedIndex(
        workflowSelect,
        nextIndex >= 0 ? nextIndex : 0,
        filteredWorkflowNames.length,
      );
    } finally {
      suppressWorkflowSelectionChange = false;
    }
  };

  const setStatus = (message: string): void => {
    lastStatus = message;
    helpText.content = buildWorkflowHistoryStatusMessage({
      busy,
      filterText: workflowFilterText,
      inputSyntax: describeTuiWorkflowInputSyntax(
        inputTextarea.plainText,
        workflowInputDetection.mode,
      ),
      matchesCount: filteredWorkflowNames.length,
      message,
      navigation: navigationState(),
      workflowCount: workflowNames.length,
      workflowInputDetection,
      ...(loadedWorkflow?.workflowName === undefined
        ? {}
        : { workflowName: loadedWorkflow.workflowName }),
    });
  };

  const render = async (): Promise<void> => {
    const navigation = navigationState();
    const preferredDefinitionNodeId = selectedDefinitionNodeId();
    const historyPaneLabels = resolveHistoryPaneLabels({
      hasRuntimeSession: runtimeSessionView !== undefined,
    });

    syncFilteredWorkflowNames(
      screenMode === "workspace"
        ? selectedWorkflowName()
        : (loadedWorkflow?.workflowName ?? selectedWorkflowName()),
    );

    selectorRow.visible = screenMode === "workspace";
    definitionScreen.visible = screenMode === "definition";
    historyScreen.visible = screenMode === "history";
    runTopRow.visible = screenMode === "run";
    inputRow.visible = screenMode === "history" || screenMode === "run";
    runTopRow.flexGrow = screenMode === "run" ? 8 : 1;
    inputRow.flexGrow = screenMode === "run" ? 32 : 20;
    filterPopup.visible = filterPopupOpen;
    helpPopup.visible = helpPopupOpen;
    confirmPopup.visible = confirmPopupKind !== "none";
    confirmPopup.title = confirmPopupTitle;
    agentSessionPopup.visible = agentSessionPopupOpen;
    agentSessionPopup.title = agentSessionPopupTitle;
    agentSessionPopupText.content = agentSessionPopupTextContent;
    nodeDefinitionPopup.visible = nodeDefinitionPopupOpen;
    nodeDefinitionPopup.title = nodeDefinitionPopupTitle;
    nodeDefinitionPopupText.content = nodeDefinitionPopupTextContent;
    const currentSelectedWorkflowName = selectedWorkflowName();
    breadcrumbText.content = buildOpenTuiBreadcrumb({
      loadedWorkflow,
      screenMode,
      ...(currentSelectedWorkflowName === undefined
        ? {}
        : { selectedWorkflowName: currentSelectedWorkflowName }),
    });
    selectorPreviewText.content = buildWorkflowSelectorPreview({
      filteredWorkflowNamesCount: filteredWorkflowNames.length,
      loadedWorkflow,
      selectorPreviewWorkflow,
      workflowFilterText,
      workflowNamesCount: workflowNames.length,
      ...(currentSelectedWorkflowName === undefined
        ? {}
        : { selectedWorkflowName: currentSelectedWorkflowName }),
    });
    workspaceHistoryText.content = buildWorkflowSelectorHistorySummary({
      ...(workspaceLatestRunError === undefined
        ? {}
        : { latestRunStatusError: workspaceLatestRunError }),
      ...(workspaceLatestRunView === undefined
        ? {}
        : { latestRunSessionView: workspaceLatestRunView }),
      sessions: workflowSessions,
      workflowFilterText,
      stepAddressedAuthoring: isStepAddressedAuthoring(
        loadedWorkflow?.bundle.workflow,
      ),
      ...(currentSelectedWorkflowName === undefined
        ? {}
        : { selectedWorkflowName: currentSelectedWorkflowName }),
    });
    footerText.content = buildOpenTuiFooterShortcutRow({
      navigation,
    });
    historyHeaderText.content = buildWorkflowHistoryHeader(loadedWorkflow);
    workflowDefinitionText.content =
      buildWorkflowDefinitionContent(loadedWorkflow);
    runWorkflowText.content = buildWorkflowRunPreview(loadedWorkflow);
    runStatusText.content = buildWorkflowRunStatusContent({
      loadedWorkflow,
      runtimeSessionView: runSessionView,
      ...(runExecutionResult === undefined
        ? {}
        : { completionResult: runExecutionResult }),
      ...(runPendingSessionId === undefined
        ? {}
        : { sessionId: runPendingSessionId }),
      ...(runStatusError === undefined ? {} : { statusError: runStatusError }),
    });

    suppressSessionSelectionChange = true;
    try {
      sessionSelect.options = [...buildSessionSelectOptions(workflowSessions)];
      if (workflowSessions.length === 0) {
        sessionSelect.setSelectedIndex(0);
      } else if (runtimeSessionView !== undefined) {
        selectBoundedIndex(
          sessionSelect,
          workflowSessions.findIndex(
            (session) =>
              session.sessionId === runtimeSessionView?.session.sessionId,
          ),
          workflowSessions.length,
        );
      }
    } finally {
      suppressSessionSelectionChange = false;
    }

    suppressDefinitionNodeSelectionChange = true;
    try {
      workflowDefinitionNodeSelect.options = [
        ...buildWorkflowDefinitionNodeSelectOptions(loadedWorkflow),
      ];
      if (workflowDefinitionNodeSelect.options.length === 0) {
        workflowDefinitionNodeSelect.setSelectedIndex(0);
      } else {
        const selectedIndex = workflowDefinitionNodeSelect.options.findIndex(
          (option) => option.value === preferredDefinitionNodeId,
        );
        selectBoundedIndex(
          workflowDefinitionNodeSelect,
          selectedIndex < 0 ? 0 : selectedIndex,
          workflowDefinitionNodeSelect.options.length,
        );
      }
    } finally {
      suppressDefinitionNodeSelectionChange = false;
    }

    suppressNodeSelectionChange = true;
    try {
      nodeSelect.options = [
        ...buildNodeSelectOptions(loadedWorkflow, runtimeSessionView?.session),
      ];
      if (nodeSelect.options.length === 0) {
        nodeSelect.setSelectedIndex(0);
      } else {
        const sessionView = runtimeSessionView;
        if (sessionView === undefined) {
          nodeSelect.setSelectedIndex(0);
        } else {
          const selectedExecution = selectedNodeExecution();
          const selectedIndex =
            selectedExecution === undefined
              ? sessionView.session.nodeExecutions.length - 1
              : sessionView.session.nodeExecutions.findIndex(
                  (entry) => entry.nodeExecId === selectedExecution.nodeExecId,
                );
          selectBoundedIndex(
            nodeSelect,
            selectedIndex < 0
              ? sessionView.session.nodeExecutions.length - 1
              : selectedIndex,
            sessionView.session.nodeExecutions.length,
          );
        }
      }
    } finally {
      suppressNodeSelectionChange = false;
    }

    const inputSyntax = describeTuiWorkflowInputSyntax(
      inputTextarea.plainText,
      workflowInputDetection.mode,
    );
    const paneChrome = resolveOpenTuiPaneChrome({
      filterText: workflowFilterText,
      focusPane,
      hasRuntimeSession: runtimeSessionView !== undefined,
      historyPaneLabels,
      inputMode: workflowInputDetection.mode,
      inputSyntaxStatus: inputSyntax.status,
      matchesCount: filteredWorkflowNames.length,
      screenMode,
      workflowCount: workflowNames.length,
    });
    applyOpenTuiPaneChrome(mountedRefs, paneChrome);

    if (screenMode === "history") {
      const detailPaneState = await buildHistoryDetailPaneState({
        detailMode,
        detailViewerBody,
        detailViewerTitle,
        inputDetection: workflowInputDetection,
        loadedWorkflow,
        managerMessages,
        runtimeSessionView,
        selectedNodeExecution: selectedHistoryExecution(),
      });
      detailSummaryHeader.content = detailPaneState.summaryHeaderText;
      detailSummaryHeader.visible = detailPaneState.summaryHeaderVisible;
      detailSummarySelect.options = [...detailPaneState.summaryOptions];
      detailSummarySelect.visible = detailPaneState.summaryVisible;
      detailText.content = detailPaneState.textContent;
      detailText.visible = detailPaneState.textVisible;
      detailScroll.scrollTop = 0;
    } else {
      detailText.content = "";
      detailSummaryHeader.visible = false;
      detailSummarySelect.visible = false;
      detailText.visible = true;
    }

    setStatus(lastStatus);
    renderer.requestRender();
  };

  const applyFocus = (nextFocusPane: FocusPane): void => {
    focusPane = nextFocusPane;
    const historyPaneLabels = resolveHistoryPaneLabels({
      hasRuntimeSession: runtimeSessionView !== undefined,
    });
    const paneChrome = resolveOpenTuiPaneChrome({
      filterText: workflowFilterText,
      focusPane,
      hasRuntimeSession: runtimeSessionView !== undefined,
      historyPaneLabels,
      inputMode: workflowInputDetection.mode,
      inputSyntaxStatus: describeTuiWorkflowInputSyntax(
        inputTextarea.plainText,
        workflowInputDetection.mode,
      ).status,
      matchesCount: filteredWorkflowNames.length,
      screenMode,
      workflowCount: workflowNames.length,
    });
    applyOpenTuiPaneChrome(mountedRefs, paneChrome);
    const focusTarget: OpenTuiFocusableTarget = filterPopupOpen
      ? filterTextarea
      : helpPopupOpen
        ? helpPopup
        : confirmPopupKind !== "none"
          ? confirmPopup
          : nodeDefinitionPopupOpen
            ? nodeDefinitionPopup
            : agentSessionPopupOpen
              ? agentSessionPopup
              : screenMode === "workspace"
                ? workflowSelect
                : screenMode === "definition"
                  ? focusPane === "definition"
                    ? mountedRefs.workflowDefinitionPane
                    : workflowDefinitionNodeSelect
                  : screenMode === "run"
                    ? inputTextarea
                    : focusPane === "sessions"
                      ? sessionSelect
                      : focusPane === "nodes"
                        ? nodeSelect
                        : focusPane === "detail"
                          ? detailMode === "summary"
                            ? detailSummarySelect
                            : detailScroll
                          : editingInput
                            ? inputTextarea
                            : inputShell;
    focusOpenTuiTarget(focusTarget);
    renderer.requestRender();
  };

  const withBusy = async (
    label: string,
    action: () => Promise<void>,
  ): Promise<void> => {
    if (busy) {
      return;
    }
    busy = true;
    setStatus(`${label}...`);
    renderer.requestRender();
    try {
      await action();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      setStatus(`${label} failed: ${message}`);
      options.io.stderr(`tui ${label.toLowerCase()} failed: ${message}`);
    } finally {
      busy = false;
      await render();
    }
  };

  const isSelectionChangeUiBlocked = (): boolean =>
    busy ||
    filterPopupOpen ||
    helpPopupOpen ||
    confirmPopupKind !== "none" ||
    nodeDefinitionPopupOpen;

  const clearRunPolling = (): void => {
    if (runPollTimer !== undefined) {
      clearInterval(runPollTimer);
      runPollTimer = undefined;
    }
  };

  const refreshManagerMessages = async (): Promise<void> => {
    const managerSessionId = selectedManagerSessionId();
    if (managerSessionId === undefined) {
      managerMessages = [];
      return;
    }
    managerMessages =
      await options.loadManagerSessionMessages(managerSessionId);
  };

  const refreshSelectorPreviewWorkflow = async (
    workflowName: string | undefined,
  ): Promise<void> => {
    if (workflowName === undefined) {
      selectorPreviewWorkflow = undefined;
      return;
    }
    if (loadedWorkflow?.workflowName === workflowName) {
      selectorPreviewWorkflow = loadedWorkflow;
      return;
    }
    if (selectorPreviewWorkflow?.workflowName === workflowName) {
      return;
    }
    selectorPreviewWorkflow =
      await options.loadWorkflowDefinition(workflowName);
  };

  const refreshWorkspaceSelectionData = async (
    workflowName: string | undefined,
  ): Promise<void> => {
    if (workflowName === undefined) {
      selectorPreviewWorkflow = undefined;
      workflowSessions = [];
      workspaceLatestRunView = undefined;
      workspaceLatestRunError = undefined;
      return;
    }
    workflowSessions = [];
    workspaceLatestRunView = undefined;
    workspaceLatestRunError = undefined;
    const nextSessionsPromise = options.listWorkflowSessions(workflowName);
    await refreshSelectorPreviewWorkflow(workflowName);
    workflowSessions = await nextSessionsPromise;
    const latestSessionId = workflowSessions[0]?.sessionId;
    if (latestSessionId === undefined) {
      workspaceLatestRunView = undefined;
      workspaceLatestRunError = undefined;
      return;
    }
    try {
      workspaceLatestRunView =
        await options.loadRuntimeSessionView(latestSessionId);
      workspaceLatestRunError = undefined;
    } catch (error: unknown) {
      workspaceLatestRunView = undefined;
      workspaceLatestRunError =
        error instanceof Error
          ? error.message
          : "unknown latest run refresh error";
    }
  };

  const refreshSessionView = async (
    sessionId: string | undefined,
  ): Promise<void> => {
    if (sessionId === undefined) {
      runtimeSessionView = undefined;
      agentSessionPopupOpen = false;
      nodeDefinitionPopupOpen = false;
      managerMessages = [];
      return;
    }
    runtimeSessionView = await options.loadRuntimeSessionView(sessionId);
    agentSessionPopupOpen = false;
    const nodeExecutionCount = runtimeSessionView.session.nodeExecutions.length;
    suppressNodeSelectionChange = true;
    try {
      selectBoundedIndex(
        nodeSelect,
        Math.max(0, nodeExecutionCount - 1),
        nodeExecutionCount,
      );
    } finally {
      suppressNodeSelectionChange = false;
    }
    await refreshManagerMessages();
  };

  const syncInputEditorToLoadedSession = (): void => {
    inputTextarea.setText(
      resolveEditorTextForLoadedSession({
        detection: workflowInputDetection,
        runtimeSessionView,
      }),
    );
  };

  const refreshWorkflow = async (
    workflowName: string | undefined,
    preferredSessionId?: string,
  ): Promise<void> => {
    if (workflowName === undefined) {
      loadedWorkflow = undefined;
      selectorPreviewWorkflow = undefined;
      workflowSessions = [];
      workspaceLatestRunView = undefined;
      workspaceLatestRunError = undefined;
      runtimeSessionView = undefined;
      managerMessages = [];
      workflowInputDetection = {
        mode: "text",
        reason: "defaulted because no workflow is selected",
      };
      agentSessionPopupOpen = false;
      nodeDefinitionPopupOpen = false;
      inputTextarea.setText("");
      return;
    }

    const nextLoadedWorkflow =
      await options.loadWorkflowDefinition(workflowName);
    loadedWorkflow = nextLoadedWorkflow;
    selectorPreviewWorkflow = loadedWorkflow;
    workflowInputDetection = detectWorkflowInputMode(loadedWorkflow);
    workflowSessions = await options.listWorkflowSessions(workflowName);
    const targetSessionId =
      preferredSessionId ?? workflowSessions[0]?.sessionId ?? undefined;
    await refreshSessionView(targetSessionId);
    syncInputEditorToLoadedSession();
  };

  const handleWorkflowSelectionChanged = async (): Promise<void> => {
    if (
      suppressWorkflowSelectionChange ||
      screenMode !== "workspace" ||
      focusPane !== "workflows" ||
      isSelectionChangeUiBlocked()
    ) {
      return;
    }
    await withBusy("Loading workflow preview", async () => {
      await refreshWorkspaceSelectionData(selectedWorkflowName());
      setStatus(
        selectedWorkflowName() === undefined
          ? "No workflow selected"
          : `Selected workflow '${selectedWorkflowName()}'`,
      );
    });
  };

  const handleSessionSelectionChanged = async (): Promise<void> => {
    if (
      suppressSessionSelectionChange ||
      screenMode !== "history" ||
      focusPane !== "sessions" ||
      isSelectionChangeUiBlocked()
    ) {
      return;
    }
    await withBusy("Switching session", async () => {
      await refreshSessionView(selectedSessionSummary()?.sessionId);
      detailMode = "summary";
      agentSessionPopupOpen = false;
      if (runtimeSessionView !== undefined) {
        syncInputEditorToLoadedSession();
        setStatus(`Selected session '${runtimeSessionView.session.sessionId}'`);
      }
    });
  };

  const handleDefinitionNodeSelectionChanged = async (): Promise<void> => {
    if (
      suppressDefinitionNodeSelectionChange ||
      screenMode !== "definition" ||
      focusPane !== "nodes" ||
      isSelectionChangeUiBlocked()
    ) {
      return;
    }
    const stepAddr = isStepAddressedAuthoring(loadedWorkflow?.bundle.workflow);
    await withBusy(
      stepAddr ? "Switching node definition" : "Switching workflow node",
      async () => {
        nodeDefinitionPopupOpen = false;
        const nodeId = selectedDefinitionNodeId();
        setStatus(
          nodeId === undefined
            ? stepAddr
              ? "No node definition selected"
              : "No workflow node selected"
            : stepAddr
              ? `Selected node definition '${nodeId}'`
              : `Selected workflow node '${nodeId}'`,
        );
      },
    );
  };

  const handleNodeSelectionChanged = async (): Promise<void> => {
    if (
      suppressNodeSelectionChange ||
      screenMode !== "history" ||
      focusPane !== "nodes" ||
      isSelectionChangeUiBlocked()
    ) {
      return;
    }
    const stepAddr = isStepAddressedAuthoring(loadedWorkflow?.bundle.workflow);
    await withBusy(stepAddr ? "Switching step" : "Switching node", async () => {
      detailMode = "summary";
      agentSessionPopupOpen = false;
      await refreshManagerMessages();
      const execution = selectedNodeExecution();
      setStatus(
        execution === undefined
          ? stepAddr
            ? "No step execution selected"
            : "No node execution selected"
          : stepAddr
            ? `Selected step '${primaryStepOrNodeLabel(execution)}' (${execution.nodeExecId})`
            : `Selected node '${execution.nodeId}' (${execution.nodeExecId})`,
      );
    });
  };

  workflowSelect.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
    void handleWorkflowSelectionChanged();
  });
  workflowDefinitionNodeSelect.on(
    SelectRenderableEvents.SELECTION_CHANGED,
    () => {
      void handleDefinitionNodeSelectionChanged();
    },
  );
  sessionSelect.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
    void handleSessionSelectionChanged();
  });
  nodeSelect.on(SelectRenderableEvents.SELECTION_CHANGED, () => {
    void handleNodeSelectionChanged();
  });

  const openFilterPopup = async (): Promise<void> => {
    workflowFilterTextBeforePopup = workflowFilterText;
    workflowSelectionBeforePopup = selectedWorkflowName();
    filterTextarea.setText(workflowFilterText);
    filterPopupOpen = true;
    helpPopupOpen = false;
    confirmPopupKind = "none";
    pendingDeleteScope = "none";
    nodeDefinitionPopupOpen = false;
    setStatus("Editing workflow filter");
    await render();
    applyFocus("workflows");
  };

  const closeFilterPopup = async (mode: "apply" | "cancel"): Promise<void> => {
    workflowFilterText =
      mode === "apply"
        ? normalizeWorkflowFilterText(filterTextarea.plainText)
        : workflowFilterTextBeforePopup;
    filterTextarea.setText(workflowFilterText);
    filterPopupOpen = false;
    syncFilteredWorkflowNames(workflowSelectionBeforePopup);
    workflowFilterTextBeforePopup = workflowFilterText;
    workflowSelectionBeforePopup = undefined;
    setStatus(
      workflowFilterText.length === 0
        ? "Workflow filter cleared"
        : `Workflow filter set to '${workflowFilterText}'`,
    );
    await withBusy("Loading workflow preview", async () => {
      await refreshWorkspaceSelectionData(selectedWorkflowName());
    });
    applyFocus("workflows");
  };

  const openHelpPopup = async (): Promise<void> => {
    helpPopupOpen = true;
    filterPopupOpen = false;
    confirmPopupKind = "none";
    pendingDeleteScope = "none";
    nodeDefinitionPopupOpen = false;
    setStatus("Help");
    await render();
    applyFocus(focusPane);
  };

  const closeHelpPopup = async (): Promise<void> => {
    helpPopupOpen = false;
    await render();
    applyFocus(focusPane);
  };

  const closeConfirmPopup = async (): Promise<void> => {
    const returnFocusPane =
      confirmPopupKind === "run-confirm" ? "input" : "sessions";
    if (confirmPopupKind === "run-confirm") {
      pendingRunRuntimeVariables = undefined;
    }
    confirmPopupKind = "none";
    confirmPopupTitle = " Confirm Run ";
    pendingDeleteScope = "none";
    await render();
    applyFocus(returnFocusPane);
  };

  const openDeleteHistoryConfirmation = async (): Promise<void> => {
    if (!isDeleteHistoryAllowed()) {
      return;
    }
    if (options.deleteWorkflowSession === undefined) {
      setStatus("History deletion is unavailable in this TUI mode");
      await render();
      return;
    }
    const session = selectedSessionSummary();
    if (session === undefined) {
      setStatus("Select a workflow run before deleting history");
      await render();
      return;
    }
    if (session.status === "paused" || session.status === "running") {
      setStatus(`Cannot delete a workflow run while it is ${session.status}`);
      await render();
      return;
    }
    confirmPopupKind = "delete-history-confirm";
    confirmPopupTitle = " Confirm Delete ";
    pendingDeleteScope = "session";
    confirmText.content = describeDeleteHistoryConfirmation(session);
    setStatus(`Confirm deleting workflow run '${session.sessionId}'`);
    await render();
    applyFocus("sessions");
  };

  const openDeleteWorkflowHistoryConfirmation = async (): Promise<void> => {
    if (!isDeleteHistoryAllowed()) {
      return;
    }
    const workflowName = loadedWorkflow?.workflowName ?? selectedWorkflowName();
    const workflowId = loadedWorkflow?.bundle.workflow.workflowId;
    if (
      workflowName === undefined ||
      workflowId === undefined ||
      options.deleteWorkflowHistory === undefined
    ) {
      setStatus("Workflow history delete-all is unavailable in this TUI mode");
      await render();
      return;
    }
    const activeSessions = workflowSessions.filter(
      (session) => session.status === "paused" || session.status === "running",
    );
    if (activeSessions.length > 0) {
      setStatus(
        `Cannot delete workflow history while sessions are active: ${activeSessions
          .map((session) => session.sessionId)
          .join(", ")}`,
      );
      await render();
      return;
    }
    confirmPopupKind = "delete-history-confirm";
    confirmPopupTitle = " Confirm Delete-All ";
    pendingDeleteScope = "workflow";
    confirmText.content = describeDeleteWorkflowHistoryConfirmation(
      workflowName,
      workflowId,
      workflowSessions,
    );
    setStatus(`Confirm workflow history delete-all for '${workflowName}'`);
    await render();
    applyFocus("sessions");
  };

  const closeAgentSessionPopup = async (): Promise<void> => {
    agentSessionPopupOpen = false;
    agentSessionPopupTitle = " AI Agent Session ";
    agentSessionPopupTextContent = "";
    await render();
    applyFocus("detail");
  };

  const closeNodeDefinitionPopup = async (): Promise<void> => {
    nodeDefinitionPopupOpen = false;
    nodeDefinitionPopupTitle = " Node Definition ";
    nodeDefinitionPopupTextContent = "";
    await render();
    applyFocus("nodes");
  };

  const openNodeDefinitionPopup = async (): Promise<void> => {
    const popupContent = buildNodeDefinitionPopupContent({
      loadedWorkflow,
      nodeId: selectedDefinitionNodeId(),
    });
    nodeDefinitionPopupOpen = true;
    nodeDefinitionPopupTitle = popupContent.title;
    nodeDefinitionPopupTextContent = popupContent.body;
    nodeDefinitionPopup.scrollTop = 0;
    const stepAddr = isStepAddressedAuthoring(loadedWorkflow?.bundle.workflow);
    setStatus(
      selectedDefinitionNodeId() === undefined
        ? stepAddr
          ? "No node definition selected"
          : "No workflow node selected"
        : stepAddr
          ? `Opened node definition for '${selectedDefinitionNodeId()}'`
          : `Opened definition for workflow node '${selectedDefinitionNodeId()}'`,
    );
    await render();
    applyFocus("nodes");
  };

  const openDetailSummarySelection = async (): Promise<void> => {
    const opt = detailSummarySelect.getSelectedOption();
    if (opt === null || opt.value === OPEN_TUI_EMPTY_SELECT_VALUE) {
      return;
    }
    if (isDetailJsonViewerSelection(opt.value)) {
      const selection = opt.value;
      detailViewerBody = selection.body;
      const wf = loadedWorkflow?.bundle.workflow.workflowId ?? "workflow";
      const stepAddr = isStepAddressedAuthoring(
        loadedWorkflow?.bundle.workflow,
      );
      const execution = selectedHistoryExecution();
      const placeholder = stepAddr ? "step" : "node";
      const id =
        execution === undefined
          ? placeholder
          : stepAddr
            ? primaryStepOrNodeLabel(execution)
            : execution.nodeId;
      detailViewerTitle = `${wf} / ${id} / ${selection.title}`;
      detailMode = "viewer";
      await render();
      applyFocus("detail");
      return;
    }
    if (!isDetailAgentSessionSelection(opt.value)) {
      return;
    }
    const selection = opt.value;
    if (
      selection.available !== true ||
      selection.backend === undefined ||
      selection.sessionId === undefined
    ) {
      const stepAddr = isStepAddressedAuthoring(
        loadedWorkflow?.bundle.workflow,
      );
      setStatus(
        stepAddr
          ? "AI agent session is unavailable for the selected step execution"
          : "AI agent session is unavailable for the selected node execution",
      );
      await render();
      applyFocus("detail");
      return;
    }
    const backend = selection.backend;
    const sessionId = selection.sessionId;
    await withBusy("Loading AI agent session history", async () => {
      const transcript = await options.loadAgentSessionTranscript({
        backend,
        sessionId,
      });
      agentSessionPopupOpen = true;
      agentSessionPopupTitle = ` AI Agent Session: ${backend} `;
      agentSessionPopupTextContent = transcript.content;
      agentSessionPopup.scrollTop = 0;
      setStatus(`Opened AI agent session history for ${backend} ${sessionId}`);
    });
    applyFocus("detail");
  };

  const rerenderHistoryDetailIfFocused = async (): Promise<void> => {
    await render();
    if (screenMode === "history" && focusPane === "detail") {
      applyFocus("detail");
    }
  };

  const pollRunSessionView = async (): Promise<void> => {
    if (runPendingSessionId === undefined || runPollInFlight || isClosed) {
      return;
    }
    runPollInFlight = true;
    try {
      runSessionView =
        await options.loadRuntimeSessionView(runPendingSessionId);
      runStatusError = undefined;
    } catch (error: unknown) {
      runStatusError =
        error instanceof Error ? error.message : "unknown status refresh error";
    } finally {
      runPollInFlight = false;
      await render();
      if (
        runExecutionResult !== undefined &&
        runSessionView?.session.status !== "running"
      ) {
        clearRunPolling();
      }
    }
  };

  const startRunPolling = (): void => {
    clearRunPolling();
    void pollRunSessionView();
    runPollTimer = setInterval(() => {
      void pollRunSessionView();
    }, 800);
  };

  const resetRunState = (): void => {
    clearRunPolling();
    runSessionView = undefined;
    runExecutionResult = undefined;
    runPendingSessionId = undefined;
    runStatusError = undefined;
    pendingRunRuntimeVariables = undefined;
  };

  const switchInputModeImpl = async (): Promise<void> => {
    await controller.switchInputMode();
  };

  const formatJsonInputImpl = async (): Promise<void> => {
    await controller.formatJsonInput();
  };

  const openWorkspaceScreen = async (): Promise<void> => {
    const workspaceWorkflowName =
      loadedWorkflow?.workflowName ?? selectedWorkflowName();
    screenMode = "workspace";
    historyReturnsToDefinition = false;
    editingInput = false;
    confirmPopupKind = "none";
    confirmPopupTitle = " Confirm Run ";
    filterPopupOpen = false;
    helpPopupOpen = false;
    agentSessionPopupOpen = false;
    nodeDefinitionPopupOpen = false;
    await withBusy("Loading workflow preview", async () => {
      await refreshWorkspaceSelectionData(workspaceWorkflowName);
      setStatus("Returned to workspace");
    });
    pendingDeleteScope = "none";
    applyFocus("workflows");
  };

  const openDefinitionScreenAction = async (): Promise<void> => {
    const workflowName = selectedWorkflowName();
    if (workflowName === undefined) {
      setStatus("Select a workflow before opening definition");
      await render();
      return;
    }
    await withBusy(`Loading workflow '${workflowName}'`, async () => {
      await refreshWorkflow(workflowName);
      historyReturnsToDefinition = false;
      screenMode = "definition";
      detailMode = "summary";
      editingInput = false;
      pendingDeleteScope = "none";
      agentSessionPopupOpen = false;
      nodeDefinitionPopupOpen = false;
      setStatus(`Opened definition for '${workflowName}'`);
    });
    applyFocus("nodes");
  };

  const openHistoryScreenAction = async (
    workflowName: string | undefined,
    preferredSessionId?: string,
  ): Promise<void> => {
    if (workflowName === undefined) {
      setStatus("Select a workflow before opening history");
      await render();
      return;
    }
    await withBusy(`Loading workflow '${workflowName}'`, async () => {
      await refreshWorkflow(workflowName, preferredSessionId);
      historyReturnsToDefinition = screenMode === "definition";
      screenMode = "history";
      detailMode = "summary";
      editingInput = false;
      pendingDeleteScope = "none";
      agentSessionPopupOpen = false;
      nodeDefinitionPopupOpen = false;
      setStatus(`Opened history for '${workflowName}'`);
    });
    applyFocus("sessions");
  };

  const openRunScreenAction = async (): Promise<void> => {
    const workflowName = selectedWorkflowName();
    if (workflowName === undefined) {
      setStatus("Select a workflow before opening a new run");
      await render();
      return;
    }
    await withBusy(`Loading workflow '${workflowName}'`, async () => {
      await refreshWorkflow(workflowName);
      historyReturnsToDefinition = false;
      resetRunState();
      screenMode = "run";
      editingInput = true;
      pendingDeleteScope = "none";
      agentSessionPopupOpen = false;
      nodeDefinitionPopupOpen = false;
      inputTextarea.setText(workflowInputDetection.mode === "json" ? "{}" : "");
      setStatus(`Opened new run for '${workflowName}'`);
    });
    applyFocus("input");
  };

  const openRunConfirmationImpl = async (): Promise<void> => {
    await controller.openRunConfirmation();
  };

  const confirmRunActionImpl = async (): Promise<void> => {
    await controller.confirmRun();
  };

  const confirmDeleteHistoryActionImpl = async (): Promise<void> => {
    const workflowName = loadedWorkflow?.workflowName ?? selectedWorkflowName();
    if (pendingDeleteScope === "workflow") {
      const workflowId = loadedWorkflow?.bundle.workflow.workflowId;
      if (
        workflowName === undefined ||
        workflowId === undefined ||
        options.deleteWorkflowHistory === undefined
      ) {
        setStatus("Workflow history delete-all is unavailable");
        await render();
        return;
      }

      await withBusy("Deleting workflow history", async () => {
        const deleted = await options.deleteWorkflowHistory?.({
          workflowId,
          workflowName,
        });
        confirmPopupKind = "none";
        confirmPopupTitle = " Confirm Run ";
        pendingDeleteScope = "none";
        await refreshWorkflow(workflowName);
        setStatus(
          `Deleted ${String(deleted?.deletedSessionCount ?? 0)} workflow history entr${
            deleted?.deletedSessionCount === 1 ? "y" : "ies"
          } for '${workflowName}'`,
        );
      });
      applyFocus("sessions");
      return;
    }

    const session = selectedSessionSummary();
    if (
      session === undefined ||
      workflowName === undefined ||
      options.deleteWorkflowSession === undefined
    ) {
      setStatus("History deletion is unavailable");
      await render();
      return;
    }

    const selectedSessionIndex = workflowSessions.findIndex(
      (entry) => entry.sessionId === session.sessionId,
    );
    const preferredSessionId =
      workflowSessions[selectedSessionIndex + 1]?.sessionId ??
      workflowSessions[selectedSessionIndex - 1]?.sessionId;

    await withBusy("Deleting workflow history", async () => {
      await options.deleteWorkflowSession?.({
        sessionId: session.sessionId,
        workflowId: session.workflowId,
        workflowName: session.workflowName,
      });
      confirmPopupKind = "none";
      confirmPopupTitle = " Confirm Run ";
      pendingDeleteScope = "none";
      await refreshWorkflow(workflowName, preferredSessionId);
      setStatus(`Deleted workflow run '${session.sessionId}'`);
    });
    applyFocus("sessions");
  };

  const rerunWorkflowActionImpl = async (): Promise<void> => {
    await controller.rerunWorkflow();
  };

  const resumeWorkflowActionImpl = async (): Promise<void> => {
    await controller.resumeWorkflow();
  };

  const refreshAllImpl = async (): Promise<void> => {
    await withBusy(
      screenMode === "workspace"
        ? "Refreshing workflow list"
        : "Refreshing TUI data",
      async () => {
        workflowNames = [...(await options.refreshWorkflowNames())];
        if (screenMode === "workspace") {
          syncFilteredWorkflowNames(selectedWorkflowName());
          await refreshWorkspaceSelectionData(selectedWorkflowName());
          setStatus("Workflow list refreshed");
          return;
        }
        if (screenMode === "run") {
          if (loadedWorkflow !== undefined) {
            loadedWorkflow = await options.loadWorkflowDefinition(
              loadedWorkflow.workflowName,
            );
            selectorPreviewWorkflow = loadedWorkflow;
            workflowSessions = await options.listWorkflowSessions(
              loadedWorkflow.workflowName,
            );
          }
          await pollRunSessionView();
          setStatus("Run screen refreshed");
          return;
        }
        if (screenMode === "definition") {
          const preferredWorkflow =
            loadedWorkflow?.workflowName !== undefined &&
            workflowNames.includes(loadedWorkflow.workflowName)
              ? loadedWorkflow.workflowName
              : workflowNames[0];
          await refreshWorkflow(
            preferredWorkflow,
            runtimeSessionView?.session.sessionId,
          );
          setStatus("Workflow definition refreshed");
          return;
        }
        const preferredWorkflow =
          loadedWorkflow?.workflowName !== undefined &&
          workflowNames.includes(loadedWorkflow.workflowName)
            ? loadedWorkflow.workflowName
            : workflowNames[0];
        await refreshWorkflow(
          preferredWorkflow,
          runtimeSessionView?.session.sessionId,
        );
        setStatus("TUI state refreshed");
      },
    );
  };

  const copyActiveValueImpl = async (): Promise<void> => {
    await controller.copyActiveValue();
  };

  const controller = createOpenTuiController({
    applyFocus,
    copyToClipboard: tryCopyToClipboard,
    executeWorkflow: options.executeWorkflow,
    getFocusPane: () => focusPane,
    getInputText: () => inputTextarea.plainText,
    getLoadedWorkflow: () => loadedWorkflow,
    getPendingRunRuntimeVariables: () => pendingRunRuntimeVariables,
    getRuntimeSessionView: () => runtimeSessionView,
    getScreenMode: () => screenMode,
    getSelectedDefinitionNodeId: selectedDefinitionNodeId,
    getSelectedHistoryExecution: selectedHistoryExecution,
    getSelectedManagerSessionId: selectedManagerSessionId,
    getSelectedNodeExecution: selectedNodeExecution,
    getSelectedSessionSummary: selectedSessionSummary,
    getSelectedWorkflowName: selectedWorkflowName,
    getSelectedWorkspaceWorkflowId: selectedWorkspaceWorkflowId,
    getWorkflowInputDetection: () => workflowInputDetection,
    refreshAll: refreshAllImpl,
    refreshWorkflow,
    render,
    rerunWorkflow: options.rerunWorkflow,
    resetRunState,
    resumeWorkflow: options.resumeWorkflow,
    setInputText: (value) => inputTextarea.setText(value),
    setPendingRunRuntimeVariables: (value) => {
      pendingRunRuntimeVariables = value;
    },
    setRunConfirmationContent: (content) => {
      confirmText.content = content;
    },
    setRunConfirmationOpen: (open) => {
      confirmPopupKind = open ? "run-confirm" : "none";
      confirmPopupTitle = " Confirm Run ";
      if (open) {
        helpPopupOpen = false;
        filterPopupOpen = false;
      }
    },
    setRunExecutionResult: (result) => {
      runExecutionResult = result;
    },
    setRunPendingSessionId: (sessionId) => {
      runPendingSessionId = sessionId;
    },
    setRunStatusError: (message) => {
      runStatusError = message;
    },
    setStatus,
    setWorkflowInputDetection: (detection) => {
      workflowInputDetection = detection;
    },
    startRunPolling,
    stopRunPolling: clearRunPolling,
    withBusy,
  });

  const switchInputMode = async (): Promise<void> => switchInputModeImpl();

  const formatJsonInput = async (): Promise<void> => formatJsonInputImpl();

  const openRunConfirmation = async (): Promise<void> =>
    openRunConfirmationImpl();

  const confirmRunAction = async (): Promise<void> => confirmRunActionImpl();

  const rerunWorkflowAction = async (): Promise<void> =>
    rerunWorkflowActionImpl();

  const resumeWorkflowAction = async (): Promise<void> =>
    resumeWorkflowActionImpl();

  const refreshAll = async (): Promise<void> => controller.refreshAll();

  const copyActiveValue = async (): Promise<void> => copyActiveValueImpl();

  const startHistoryInputEditing = (): void => {
    editingInput = true;
    applyFocus("input");
    setStatus(
      workflowInputDetection.mode === "json"
        ? "Editing JSON input. Press escape to finish."
        : "Editing text input. Press escape to finish.",
    );
    renderer.requestRender();
  };

  const loadHistoryFocusedSelection = async (input?: {
    readonly focusAfterSessionLoad?: "detail";
  }): Promise<void> => {
    if (focusPane === "sessions") {
      await withBusy("Loading session", async () => {
        await refreshSessionView(selectedSessionSummary()?.sessionId);
        if (runtimeSessionView !== undefined) {
          syncInputEditorToLoadedSession();
          setStatus(`Loaded session ${runtimeSessionView.session.sessionId}`);
        }
      });
      if (
        input?.focusAfterSessionLoad !== undefined &&
        runtimeSessionView !== undefined
      ) {
        detailMode = "summary";
        detailReturnPane = "sessions";
        applyFocus("detail");
        const stepAddr = isStepAddressedAuthoring(
          loadedWorkflow?.bundle.workflow,
        );
        setStatus(
          stepAddr
            ? `Focused step detail for workflow run '${runtimeSessionView.session.sessionId}'`
            : `Focused node detail for workflow run '${runtimeSessionView.session.sessionId}'`,
        );
        renderer.requestRender();
      }
      return;
    }
    if (focusPane === "nodes") {
      const stepAddr = isStepAddressedAuthoring(
        loadedWorkflow?.bundle.workflow,
      );
      await withBusy(
        stepAddr ? "Loading step details" : "Loading node details",
        async () => {
          await refreshManagerMessages();
          const execution = selectedNodeExecution();
          setStatus(
            execution === undefined
              ? stepAddr
                ? "No step execution selected"
                : "No node execution selected"
              : stepAddr
                ? `Loaded step ${primaryStepOrNodeLabel(execution)} details`
                : `Loaded node ${execution.nodeId} details`,
          );
        },
      );
      detailReturnPane = "nodes";
      applyFocus("detail");
      return;
    }
    if (focusPane === "detail") {
      return;
    }
    startHistoryInputEditing();
  };

  const moveFocusedList = async (delta: number): Promise<void> => {
    const navigationMode =
      screenMode === "history"
        ? resolveHistoryPaneNavigationMode({
            navigation: navigationState(),
          })
        : "list";
    if (navigationMode === "scroll") {
      detailScroll.scrollBy(delta, "content");
      renderer.requestRender();
      return;
    }
    if (navigationMode === "typing") {
      return;
    }
    if (screenMode === "workspace" || focusPane === "workflows") {
      if (delta < 0) {
        workflowSelect.moveUp(1);
      } else {
        workflowSelect.moveDown(1);
      }
      if (screenMode === "workspace") {
        await withBusy("Loading workflow preview", async () => {
          await refreshWorkspaceSelectionData(selectedWorkflowName());
          setStatus(
            selectedWorkflowName() === undefined
              ? "No workflow selected"
              : `Selected workflow '${selectedWorkflowName()}'`,
          );
        });
        return;
      }
      await render();
      return;
    }

    if (screenMode === "definition" && focusPane === "definition") {
      mountedRefs.workflowDefinitionPane.scrollBy(delta, "content");
      renderer.requestRender();
      return;
    }

    if (screenMode === "definition" && focusPane === "nodes") {
      if (delta < 0) {
        workflowDefinitionNodeSelect.moveUp(1);
      } else {
        workflowDefinitionNodeSelect.moveDown(1);
      }
      const stepAddr = isStepAddressedAuthoring(
        loadedWorkflow?.bundle.workflow,
      );
      await withBusy(
        stepAddr ? "Switching node definition" : "Switching workflow node",
        async () => {
          nodeDefinitionPopupOpen = false;
          const nodeId = selectedDefinitionNodeId();
          setStatus(
            nodeId === undefined
              ? stepAddr
                ? "No node definition selected"
                : "No workflow node selected"
              : stepAddr
                ? `Selected node definition '${nodeId}'`
                : `Selected workflow node '${nodeId}'`,
          );
        },
      );
      return;
    }

    if (focusPane === "sessions") {
      if (delta < 0) {
        sessionSelect.moveUp(1);
      } else {
        sessionSelect.moveDown(1);
      }
      await withBusy("Switching session", async () => {
        await refreshSessionView(selectedSessionSummary()?.sessionId);
        detailMode = "summary";
        agentSessionPopupOpen = false;
        if (runtimeSessionView !== undefined) {
          syncInputEditorToLoadedSession();
          setStatus(
            `Selected session '${runtimeSessionView.session.sessionId}'`,
          );
        }
      });
      return;
    }

    if (focusPane === "nodes") {
      if (delta < 0) {
        nodeSelect.moveUp(1);
      } else {
        nodeSelect.moveDown(1);
      }
      const stepAddr = isStepAddressedAuthoring(
        loadedWorkflow?.bundle.workflow,
      );
      await withBusy(
        stepAddr ? "Switching step" : "Switching node",
        async () => {
          detailMode = "summary";
          agentSessionPopupOpen = false;
          await refreshManagerMessages();
          const execution = selectedNodeExecution();
          setStatus(
            execution === undefined
              ? stepAddr
                ? "No step execution selected"
                : "No node execution selected"
              : stepAddr
                ? `Selected step '${primaryStepOrNodeLabel(execution)}' (${execution.nodeExecId})`
                : `Selected node '${execution.nodeId}' (${execution.nodeExecId})`,
          );
        },
      );
      return;
    }

    if (focusPane === "detail") {
      if (delta < 0) {
        detailSummarySelect.moveUp(1);
      } else {
        detailSummarySelect.moveDown(1);
      }
      renderer.requestRender();
      return;
    }

    applyFocus("input");
  };

  const executeDirectionalNavigationAction = async (
    action: ReturnType<typeof resolveDirectionalNavigationAction>,
  ): Promise<void> => {
    switch (action.kind) {
      case "none":
        return;
      case "open-definition":
        await openDefinitionScreenAction();
        return;
      case "open-history":
        await openHistoryScreenAction(
          screenMode === "workspace"
            ? selectedWorkflowName()
            : loadedWorkflow?.workflowName,
          runPendingSessionId ?? runSessionView?.session.sessionId,
        );
        return;
      case "open-workspace":
        await openWorkspaceScreen();
        return;
      case "focus":
        if (action.nextDetailMode !== undefined) {
          detailMode = action.nextDetailMode;
        }
        applyFocus(action.focusPane);
        setStatus(action.status);
        await render();
        return;
    }
  };

  const executePopupRevertAction = async (
    action: ReturnType<typeof resolvePopupRevertAction>,
  ): Promise<void> => {
    switch (action.kind) {
      case "cancel-filter":
        await closeFilterPopup("cancel");
        return;
      case "close-help":
        await closeHelpPopup();
        return;
      case "close-confirm-popup":
        await closeConfirmPopup();
        return;
      case "close-agent-session":
        await closeAgentSessionPopup();
        return;
      case "close-node-definition":
        await closeNodeDefinitionPopup();
        return;
      case "none":
        return;
    }
  };

  const executePopupConfirmAction = async (
    action: ReturnType<typeof resolvePopupConfirmAction>,
  ): Promise<void> => {
    switch (action.kind) {
      case "apply-filter":
        await closeFilterPopup("apply");
        return;
      case "confirm-delete-history":
        await confirmDeleteHistoryActionImpl();
        return;
      case "confirm-run":
        await confirmRunAction();
        return;
      case "none":
        return;
    }
  };

  syncFilteredWorkflowNames(options.initialWorkflowName);

  if (screenMode === "history") {
    await withBusy("Loading workflow state", async () => {
      const initialWorkflowName =
        options.initialWorkflowName !== undefined &&
        workflowNames.includes(options.initialWorkflowName)
          ? options.initialWorkflowName
          : workflowNames[0];
      await refreshWorkflow(initialWorkflowName, options.initialSessionId);
    });
    applyFocus("sessions");
    if (options.initialSessionId !== undefined) {
      setStatus(
        `Loaded resume session ${options.initialSessionId}. Press u to resume or inspect the session first.`,
      );
      await render();
    }
  } else {
    await withBusy("Loading workflow preview", async () => {
      await refreshWorkspaceSelectionData(selectedWorkflowName());
    });
    applyFocus("workflows");
    await render();
  }

  renderer.start();

  return await new Promise<number>((resolve) => {
    const complete = (exitCode: number): void => {
      isClosed = true;
      clearRunPolling();
      renderer.keyInput.removeListener("keypress", onKey);
      renderer.destroy();
      resolve(exitCode);
    };

    const onKey = (key: KeyEvent): void => {
      if (key.eventType !== "press") {
        return;
      }

      const popupKind = resolveOpenTuiPopupKind({
        agentSessionPopupOpen,
        confirmPopupKind,
        filterPopupOpen,
        helpPopupOpen,
        nodeDefinitionPopupOpen,
      });

      if (popupKind !== "none") {
        if (
          key.name === "escape" ||
          (key.name === "q" && !key.ctrl && !key.meta && popupKind !== "filter")
        ) {
          key.preventDefault();
          void executePopupRevertAction(resolvePopupRevertAction(popupKind));
          return;
        }
        if (isConfirmKey(key)) {
          const confirmAction = resolvePopupConfirmAction(popupKind);
          if (confirmAction.kind !== "none") {
            key.preventDefault();
            void executePopupConfirmAction(confirmAction);
            return;
          }
        }
        if (key.name === "c" && key.ctrl) {
          key.preventDefault();
          complete(130);
          return;
        }
        if (
          popupKind === "filter" &&
          renderer.currentFocusedRenderable === filterTextarea
        ) {
          queueMicrotask(() => {
            workflowFilterText = normalizeWorkflowFilterText(
              filterTextarea.plainText,
            );
            syncFilteredWorkflowNames(workflowSelectionBeforePopup);
            setStatus(
              `Filtering workflows (${String(filteredWorkflowNames.length)}/${String(
                workflowNames.length,
              )} matches)`,
            );
            void render();
          });
        }
        const popupScrollDelta = resolvePopupScrollDelta({
          key,
          popupKind,
        });
        if (popupScrollDelta !== 0) {
          key.preventDefault();
          if (popupKind === "node-definition") {
            nodeDefinitionPopup.scrollBy(popupScrollDelta, "content");
          } else {
            agentSessionPopup.scrollBy(popupScrollDelta, "content");
          }
          renderer.requestRender();
          return;
        }
        key.preventDefault();
        return;
      }

      if (key.name === "q" && !key.ctrl && !key.meta) {
        key.preventDefault();
        complete(0);
        return;
      }
      if (isOpenTuiHelpKey(key)) {
        key.preventDefault();
        void openHelpPopup();
        return;
      }
      if (key.name === "c" && key.ctrl) {
        key.preventDefault();
        complete(130);
        return;
      }

      if (busy) {
        return;
      }

      if (
        isOpenTuiRefreshKey(key) &&
        !(editingInput && renderer.currentFocusedRenderable === inputTextarea)
      ) {
        key.preventDefault();
        void refreshAll();
        return;
      }

      if (screenMode === "workspace") {
        if (key.name === "/" && !key.ctrl && !key.meta) {
          key.preventDefault();
          void openFilterPopup();
          return;
        }
        if (key.name === "y" && !key.ctrl && !key.meta) {
          key.preventDefault();
          void copyActiveValue();
          return;
        }
        if (key.name === "down" || (key.name === "j" && !key.ctrl)) {
          key.preventDefault();
          void moveFocusedList(1);
          return;
        }
        if (key.name === "up" || (key.name === "k" && !key.ctrl)) {
          key.preventDefault();
          void moveFocusedList(-1);
          return;
        }
        if (
          (key.name === "l" && !key.ctrl) ||
          isEnterKey(key) ||
          isCtrlMKey(key)
        ) {
          key.preventDefault();
          void executeDirectionalNavigationAction(
            resolveDirectionalNavigationAction({
              direction: "forward",
              historyRootReturnScreen: historyRootReturnScreen(),
              navigation: navigationState(),
            }),
          );
          return;
        }
        if (key.name === "n" && !key.ctrl) {
          key.preventDefault();
          void openRunScreenAction();
          return;
        }
        return;
      }

      if (screenMode === "definition") {
        if (key.name === "h" && !key.ctrl) {
          key.preventDefault();
          void executeDirectionalNavigationAction(
            resolveDirectionalNavigationAction({
              direction: "revert",
              historyRootReturnScreen: historyRootReturnScreen(),
              navigation: navigationState(),
            }),
          );
          return;
        }
        if (key.name === "l" && !key.ctrl) {
          key.preventDefault();
          void executeDirectionalNavigationAction(
            resolveDirectionalNavigationAction({
              direction: "forward",
              historyRootReturnScreen: historyRootReturnScreen(),
              navigation: navigationState(),
            }),
          );
          return;
        }
        if (key.name === "n" && !key.ctrl) {
          key.preventDefault();
          void openRunScreenAction();
          return;
        }
        if (key.name === "y" && !key.ctrl && !key.meta) {
          key.preventDefault();
          void copyActiveValue();
          return;
        }
        if (isConfirmKey(key)) {
          key.preventDefault();
          if (focusPane === "nodes") {
            void openNodeDefinitionPopup();
          }
          return;
        }
      }

      if (screenMode === "run") {
        if (key.name === "h" && !key.ctrl) {
          key.preventDefault();
          void executeDirectionalNavigationAction(
            resolveDirectionalNavigationAction({
              direction: "revert",
              historyRootReturnScreen: historyRootReturnScreen(),
              navigation: navigationState(),
            }),
          );
          return;
        }
        if (key.name === "l" && !key.ctrl) {
          key.preventDefault();
          void executeDirectionalNavigationAction(
            resolveDirectionalNavigationAction({
              direction: "forward",
              historyRootReturnScreen: historyRootReturnScreen(),
              navigation: navigationState(),
            }),
          );
          return;
        }
        if (key.name === "m" && !key.ctrl) {
          key.preventDefault();
          void switchInputMode();
          return;
        }
        if (key.name === "f" && !key.ctrl) {
          key.preventDefault();
          void formatJsonInput();
          return;
        }
        if (isConfirmKey(key)) {
          key.preventDefault();
          void openRunConfirmation();
          return;
        }
        return;
      }

      if (
        screenMode === "history" &&
        focusPane === "detail" &&
        !isAllowedNodeDetailKey(key)
      ) {
        key.preventDefault();
        return;
      }

      if (key.name === "escape") {
        const revertAction =
          screenMode === "history"
            ? resolveHistoryRevertAction({
                navigation: navigationState(),
              })
            : { kind: "none" as const };
        if (revertAction.kind !== "none") {
          key.preventDefault();
          if (revertAction.kind === "finish-input-editing") {
            editingInput = false;
            applyFocus("input");
            setStatus(revertAction.status);
            void render();
            return;
          }
          detailMode = revertAction.nextDetailMode;
          applyFocus(revertAction.focusPane);
          setStatus(revertAction.status);
          void render();
          return;
        }
      }

      if (editingInput && renderer.currentFocusedRenderable === inputTextarea) {
        return;
      }

      if (key.name === "tab" && !editingInput) {
        key.preventDefault();
        const nextFocus = resolveTabFocusTarget({
          direction: key.shift ? "previous" : "next",
          navigation: navigationState(),
        });
        if (nextFocus !== undefined) {
          applyFocus(nextFocus);
        }
        return;
      }

      if (key.name === "down" || (key.name === "j" && !key.ctrl)) {
        const internallyHandledListId = resolveOpenTuiInternallyHandledListId({
          navigation: navigationState(),
          detailSummarySelectId: DETAIL_SUMMARY_SELECT_ID,
          definitionNodeSelectId: DEFINITION_NODE_SELECT_ID,
          nodeSelectId: NODE_SELECT_ID,
          sessionSelectId: SESSION_SELECT_ID,
          workflowSelectId: WORKFLOW_SELECT_ID,
        });
        if (
          key.name === "down" &&
          internallyHandledListId !== undefined &&
          renderer.currentFocusedRenderable?.id === internallyHandledListId
        ) {
          return;
        }
        if (focusPane === "input" && !editingInput) {
          return;
        }
        key.preventDefault();
        void moveFocusedList(1);
        return;
      }
      if (key.name === "up" || (key.name === "k" && !key.ctrl)) {
        const internallyHandledListId = resolveOpenTuiInternallyHandledListId({
          navigation: navigationState(),
          detailSummarySelectId: DETAIL_SUMMARY_SELECT_ID,
          definitionNodeSelectId: DEFINITION_NODE_SELECT_ID,
          nodeSelectId: NODE_SELECT_ID,
          sessionSelectId: SESSION_SELECT_ID,
          workflowSelectId: WORKFLOW_SELECT_ID,
        });
        if (
          key.name === "up" &&
          internallyHandledListId !== undefined &&
          renderer.currentFocusedRenderable?.id === internallyHandledListId
        ) {
          return;
        }
        if (focusPane === "input" && !editingInput) {
          return;
        }
        key.preventDefault();
        void moveFocusedList(-1);
        return;
      }

      if (isEnterKey(key) || isCtrlMKey(key)) {
        key.preventDefault();
        if (screenMode !== "history") {
          return;
        }
        const advanceAction = resolveHistoryAdvanceAction({
          navigation: navigationState(),
        });
        switch (advanceAction.kind) {
          case "load-session-selection":
            void loadHistoryFocusedSelection({
              focusAfterSessionLoad: advanceAction.focusAfterSessionLoad,
            });
            return;
          case "load-node-selection":
            void loadHistoryFocusedSelection();
            return;
          case "open-detail-summary-selection":
            void openDetailSummarySelection();
            return;
          case "start-input-editing":
            startHistoryInputEditing();
            return;
          case "none":
            return;
        }
      }

      if (key.name === "y" && !key.ctrl && !key.meta) {
        key.preventDefault();
        void copyActiveValue();
        return;
      }
      if (key.name === "n" && !key.ctrl) {
        key.preventDefault();
        void openRunScreenAction();
        return;
      }
      if (key.name === "d" && key.shift && !key.ctrl && !key.meta) {
        key.preventDefault();
        void openDeleteWorkflowHistoryConfirmation();
        return;
      }
      if (key.name === "d" && !key.ctrl && !key.meta) {
        key.preventDefault();
        void openDeleteHistoryConfirmation();
        return;
      }
      if (
        key.name === "l" &&
        !key.ctrl &&
        (focusPane === "sessions" || focusPane === "nodes")
      ) {
        key.preventDefault();
        void executeDirectionalNavigationAction(
          resolveDirectionalNavigationAction({
            direction: "forward",
            historyRootReturnScreen: historyRootReturnScreen(),
            navigation: navigationState(),
          }),
        );
        return;
      }
      if (isOpenTuiRerunKey(key)) {
        key.preventDefault();
        void rerunWorkflowAction();
        return;
      }
      if (key.name === "u" && !key.ctrl) {
        key.preventDefault();
        void resumeWorkflowAction();
        return;
      }
      if (key.name === "h" && !key.ctrl) {
        key.preventDefault();
        void executeDirectionalNavigationAction(
          resolveDirectionalNavigationAction({
            direction: "revert",
            historyRootReturnScreen: historyRootReturnScreen(),
            navigation: navigationState(),
          }),
        );
        return;
      }
      if (key.name === "e" && !key.ctrl) {
        key.preventDefault();
        void loadHistoryFocusedSelection();
        return;
      }
      if (key.name === "m" && !key.ctrl) {
        key.preventDefault();
        void switchInputMode();
        return;
      }
      if (key.name === "f" && !key.ctrl) {
        key.preventDefault();
        void formatJsonInput();
        return;
      }
      if (key.name === "i" && !key.ctrl) {
        key.preventDefault();
        detailMode = "inbox";
        setStatus("Showing node inbox view");
        void rerenderHistoryDetailIfFocused();
        return;
      }
      if (key.name === "o" && !key.ctrl) {
        key.preventDefault();
        detailMode = "outbox";
        setStatus("Showing node outbox view");
        void rerenderHistoryDetailIfFocused();
        return;
      }
      if (key.name === "g" && !key.ctrl) {
        key.preventDefault();
        detailMode = "session-logs";
        setStatus("Showing workflow execution logs");
        void rerenderHistoryDetailIfFocused();
        return;
      }
      if (key.name === "a" && !key.ctrl) {
        key.preventDefault();
        detailMode = "manager";
        void withBusy("Loading manager session", async () => {
          await refreshManagerMessages();
          setStatus("Showing manager-session messages");
        }).then(() => {
          if (screenMode === "history" && focusPane === "detail") {
            applyFocus("detail");
          }
        });
        return;
      }
      if (key.name === "s" && !key.ctrl) {
        key.preventDefault();
        detailMode = "summary";
        setStatus("Showing node summary");
        void rerenderHistoryDetailIfFocused();
      }
    };

    renderer.keyInput.prependListener("keypress", onKey);
    void render();
  });
}
