import type { LoadedWorkflow } from "../../workflow/load";
import type { NodeExecutionRecord } from "../../workflow/session";
import type { NodePayload } from "../../workflow/types";
import {
  OPEN_TUI_EMPTY_SELECT_VALUE,
  type DetailAgentSessionSelection,
  type DetailMode,
  type DetailReturnPane,
  type FocusPane,
  type HistoryPaneLabels,
  type HistoryPaneNavigationMode,
  type HistoryViewMode,
  type OpenTuiNavigationState,
  type OpenTuiCopyTarget,
  type OpenTuiCopyTargetInput,
  type OpenTuiDirectionalAction,
  type OpenTuiHistoryAdvanceAction,
  type OpenTuiHistoryRevertAction,
  type OpenTuiPopupConfirmAction,
  type OpenTuiPopupKind,
  type OpenTuiPopupRevertAction,
  type OpenTuiPopupScrollDelta,
  type ScreenMode,
  type ShortcutKeyLike,
} from "./types";
import { resolveCliAgentBackendForNode } from "./shared";

export function isOpenTuiEmptySelectValue(value: unknown): boolean {
  return value === OPEN_TUI_EMPTY_SELECT_VALUE;
}

export function resolveHistoryPaneNavigationMode(input: {
  readonly navigation: Pick<OpenTuiNavigationState, "detailMode" | "focusPane">;
}): HistoryPaneNavigationMode {
  if (input.navigation.focusPane === "input") {
    return "typing";
  }
  if (input.navigation.focusPane === "detail") {
    return input.navigation.detailMode === "summary" ? "list" : "scroll";
  }
  return "list";
}

export function resolveTabFocusTarget(input: {
  readonly direction: "next" | "previous";
  readonly navigation: Pick<OpenTuiNavigationState, "focusPane" | "screenMode">;
}): FocusPane | undefined {
  if (input.navigation.screenMode === "definition") {
    if (input.direction === "next") {
      return input.navigation.focusPane === "definition"
        ? "nodes"
        : "definition";
    }
    return input.navigation.focusPane === "nodes" ? "definition" : "nodes";
  }
  if (input.navigation.screenMode !== "history") {
    return undefined;
  }
  if (input.direction === "next") {
    const nextFocus: Readonly<
      Record<Exclude<FocusPane, "definition">, FocusPane>
    > = {
      workflows: "sessions",
      sessions: "nodes",
      nodes: "detail",
      detail: "input",
      input: "sessions",
    };
    return input.navigation.focusPane === "definition"
      ? undefined
      : nextFocus[input.navigation.focusPane];
  }
  const previousFocus: Readonly<
    Record<Exclude<FocusPane, "definition">, FocusPane>
  > = {
    workflows: "input",
    sessions: "input",
    nodes: "sessions",
    detail: "nodes",
    input: "detail",
  };
  return input.navigation.focusPane === "definition"
    ? undefined
    : previousFocus[input.navigation.focusPane];
}

export function resolveDirectionalNavigationAction(input: {
  readonly direction: "forward" | "revert";
  readonly historyRootReturnScreen?: "definition" | "workspace";
  readonly navigation: Pick<
    OpenTuiNavigationState,
    "focusPane" | "historyViewMode" | "screenMode"
  >;
}): OpenTuiDirectionalAction {
  if (input.navigation.screenMode === "workspace") {
    return input.direction === "forward"
      ? { kind: "open-definition" }
      : { kind: "none" };
  }

  if (input.navigation.screenMode === "definition") {
    return input.direction === "forward"
      ? { kind: "open-history" }
      : { kind: "open-workspace" };
  }

  if (input.navigation.screenMode === "run") {
    return input.direction === "forward"
      ? { kind: "open-history" }
      : { kind: "open-workspace" };
  }

  if (input.direction === "forward") {
    if (input.navigation.focusPane === "sessions") {
      return {
        kind: "focus",
        focusPane: "nodes",
        nextDetailMode: "summary",
        status:
          input.navigation.historyViewMode === "workflow"
            ? "Focused nodes for the selected workflow run"
            : "Focused child workflow list",
      };
    }
    if (input.navigation.focusPane === "nodes") {
      return {
        kind: "open-subworkflow",
      };
    }
    return { kind: "none" };
  }

  if (input.navigation.focusPane === "nodes") {
    return {
      kind: "focus",
      focusPane: "sessions",
      nextDetailMode: "summary",
      status:
        input.navigation.historyViewMode === "workflow"
          ? "Focused workflow runs"
          : "Focused workflow nodes",
    };
  }
  if (input.navigation.focusPane === "sessions") {
    return input.navigation.historyViewMode === "subworkflow"
      ? { kind: "close-subworkflow" }
      : input.historyRootReturnScreen === "definition"
        ? { kind: "open-definition" }
        : { kind: "open-workspace" };
  }
  return { kind: "none" };
}

export function resolveOpenTuiPopupKind(input: {
  readonly agentSessionPopupOpen: boolean;
  readonly confirmPopupKind: "delete-history-confirm" | "none" | "run-confirm";
  readonly filterPopupOpen: boolean;
  readonly helpPopupOpen: boolean;
  readonly nodeDefinitionPopupOpen: boolean;
}): OpenTuiPopupKind {
  if (input.filterPopupOpen) {
    return "filter";
  }
  if (input.helpPopupOpen) {
    return "help";
  }
  if (input.confirmPopupKind !== "none") {
    return input.confirmPopupKind;
  }
  if (input.nodeDefinitionPopupOpen) {
    return "node-definition";
  }
  if (input.agentSessionPopupOpen) {
    return "agent-session";
  }
  return "none";
}

export function resolvePopupConfirmAction(
  popupKind: OpenTuiPopupKind,
): OpenTuiPopupConfirmAction {
  switch (popupKind) {
    case "filter":
      return { kind: "apply-filter" };
    case "delete-history-confirm":
      return { kind: "confirm-delete-history" };
    case "run-confirm":
      return { kind: "confirm-run" };
    default:
      return { kind: "none" };
  }
}

export function resolvePopupRevertAction(
  popupKind: OpenTuiPopupKind,
): OpenTuiPopupRevertAction {
  switch (popupKind) {
    case "filter":
      return { kind: "cancel-filter" };
    case "help":
      return { kind: "close-help" };
    case "delete-history-confirm":
    case "run-confirm":
      return { kind: "close-confirm-popup" };
    case "node-definition":
      return { kind: "close-node-definition" };
    case "agent-session":
      return { kind: "close-agent-session" };
    default:
      return { kind: "none" };
  }
}

export function resolvePopupScrollDelta(input: {
  readonly key: ShortcutKeyLike;
  readonly popupKind: OpenTuiPopupKind;
}): OpenTuiPopupScrollDelta {
  if (
    input.popupKind !== "agent-session" &&
    input.popupKind !== "node-definition"
  ) {
    return 0;
  }
  if (
    input.key.name === "down" ||
    (input.key.name === "j" && !input.key.ctrl && !input.key.meta)
  ) {
    return 1;
  }
  if (
    input.key.name === "up" ||
    (input.key.name === "k" && !input.key.ctrl && !input.key.meta)
  ) {
    return -1;
  }
  return 0;
}

export function resolveOpenTuiInternallyHandledListId(input: {
  readonly navigation: Pick<
    OpenTuiNavigationState,
    "detailMode" | "focusPane" | "screenMode"
  >;
  readonly detailSummarySelectId: string;
  readonly definitionNodeSelectId: string;
  readonly nodeSelectId: string;
  readonly sessionSelectId: string;
  readonly workflowSelectId: string;
}): string | undefined {
  if (input.navigation.screenMode === "workspace") {
    return input.workflowSelectId;
  }
  if (input.navigation.screenMode === "definition") {
    return input.navigation.focusPane === "nodes"
      ? input.definitionNodeSelectId
      : undefined;
  }
  if (input.navigation.screenMode !== "history") {
    return undefined;
  }
  if (input.navigation.focusPane === "sessions") {
    return input.sessionSelectId;
  }
  if (input.navigation.focusPane === "nodes") {
    return input.nodeSelectId;
  }
  if (
    input.navigation.focusPane === "detail" &&
    input.navigation.detailMode === "summary"
  ) {
    return input.detailSummarySelectId;
  }
  return undefined;
}

export function resolveOpenTuiCopyTarget(
  input: OpenTuiCopyTargetInput,
): OpenTuiCopyTarget | undefined {
  if (input.screenMode === "workspace") {
    if (input.loadedWorkflowId !== undefined) {
      return {
        label: "workflow id",
        value: input.loadedWorkflowId,
      };
    }
    if (input.selectedWorkflowName !== undefined) {
      return {
        label: "workflow name",
        value: input.selectedWorkflowName,
      };
    }
    return undefined;
  }

  if (input.screenMode === "definition") {
    if (
      input.focusPane === "nodes" &&
      input.selectedWorkflowNodeId !== undefined
    ) {
      return {
        label: "workflow node id",
        value: input.selectedWorkflowNodeId,
      };
    }
    if (input.loadedWorkflowId !== undefined) {
      return {
        label: "workflow id",
        value: input.loadedWorkflowId,
      };
    }
    return undefined;
  }

  if (input.screenMode === "run") {
    return undefined;
  }

  if (input.focusPane === "sessions" && input.selectedSessionId !== undefined) {
    return {
      label: "workflow run id",
      value: input.selectedSessionId,
    };
  }

  if (
    input.focusPane === "nodes" &&
    input.selectedNodeExecutionId !== undefined
  ) {
    return {
      label: "node execution id",
      value: input.selectedNodeExecutionId,
    };
  }

  if (
    input.focusPane === "sessions" &&
    input.selectedWorkflowNodeId !== undefined
  ) {
    return {
      label: "workflow node id",
      value: input.selectedWorkflowNodeId,
    };
  }

  if (
    input.focusPane === "nodes" &&
    input.selectedSubworkflowId !== undefined
  ) {
    return {
      label: "workflow id",
      value: input.selectedSubworkflowId,
    };
  }

  return undefined;
}

export function isAllowedNodeDetailKey(input: ShortcutKeyLike): boolean {
  return (
    input.name === "up" ||
    input.name === "down" ||
    input.name === "tab" ||
    (input.name === "j" && !input.ctrl && !input.meta) ||
    (input.name === "k" && !input.ctrl && !input.meta) ||
    input.name === "left" ||
    input.name === "right" ||
    input.name === "escape" ||
    input.name === "return" ||
    (input.name === "m" && input.ctrl && !input.meta)
  );
}

export function resolveSelectedWorkflowName(
  selectedIndex: number,
  workflowNames: readonly string[],
): string | undefined {
  if (selectedIndex < 0 || selectedIndex >= workflowNames.length) {
    return undefined;
  }
  return workflowNames[selectedIndex];
}

export function normalizeWorkflowFilterText(value: string): string {
  return value.replace(/\r?\n/g, "").trim();
}

export function filterWorkflowNames(
  workflowNames: readonly string[],
  filterText: string,
): readonly string[] {
  const normalizedFilter =
    normalizeWorkflowFilterText(filterText).toLowerCase();
  if (normalizedFilter.length === 0) {
    return [...workflowNames];
  }
  return workflowNames.filter((name) =>
    name.toLowerCase().includes(normalizedFilter),
  );
}

export function resolveHistoryPaneLabels(input: {
  readonly hasRuntimeSession: boolean;
  readonly subworkflow:
    | LoadedWorkflow["bundle"]["workflow"]["subWorkflows"][number]
    | undefined;
}): HistoryPaneLabels {
  if (input.subworkflow === undefined) {
    return {
      header: "Workflow",
      left: "Workflow Runs",
      right: input.hasRuntimeSession ? "Nodes" : "Nodes (select a run)",
    };
  }
  return {
    header: `Subworkflow ${input.subworkflow.id}`,
    left: "Workflow Nodes",
    right: "Workflow List",
  };
}

export function buildDetailEscapeStatusMessage(input: {
  readonly detailReturnPane: DetailReturnPane;
  readonly historyViewMode: HistoryViewMode;
}): string {
  if (input.detailReturnPane === "nodes") {
    return "Focused nodes";
  }
  return input.historyViewMode === "workflow"
    ? "Focused workflow runs"
    : "Focused workflow nodes";
}

export function resolveNodeDetailEscape(input: {
  readonly detailMode: DetailMode;
  readonly detailReturnPane: DetailReturnPane;
  readonly historyViewMode: HistoryViewMode;
}): {
  readonly nextDetailMode: DetailMode;
  readonly nextFocusPane: FocusPane;
  readonly status: string;
} {
  if (input.detailMode === "viewer") {
    return {
      nextDetailMode: "summary",
      nextFocusPane: "detail",
      status: "Focused node detail summary",
    };
  }

  return {
    nextDetailMode: input.detailMode,
    nextFocusPane: input.detailReturnPane,
    status: buildDetailEscapeStatusMessage({
      detailReturnPane: input.detailReturnPane,
      historyViewMode: input.historyViewMode,
    }),
  };
}

export function resolveHistoryAdvanceAction(input: {
  readonly navigation: Pick<OpenTuiNavigationState, "detailMode" | "focusPane">;
}): OpenTuiHistoryAdvanceAction {
  if (input.navigation.focusPane === "sessions") {
    return {
      kind: "load-session-selection",
      focusAfterSessionLoad: "detail",
    };
  }
  if (input.navigation.focusPane === "nodes") {
    return { kind: "load-node-selection" };
  }
  if (input.navigation.focusPane === "detail") {
    return input.navigation.detailMode === "summary"
      ? { kind: "open-detail-summary-selection" }
      : { kind: "none" };
  }
  if (input.navigation.focusPane === "input") {
    return { kind: "start-input-editing" };
  }
  return { kind: "none" };
}

export function resolveHistoryRevertAction(input: {
  readonly navigation: Pick<
    OpenTuiNavigationState,
    | "detailMode"
    | "detailReturnPane"
    | "editingInput"
    | "focusPane"
    | "historyViewMode"
  >;
}): OpenTuiHistoryRevertAction {
  if (input.navigation.focusPane === "detail") {
    const escapeResult = resolveNodeDetailEscape({
      detailMode: input.navigation.detailMode,
      detailReturnPane: input.navigation.detailReturnPane,
      historyViewMode: input.navigation.historyViewMode,
    });
    return {
      kind: "focus",
      focusPane: escapeResult.nextFocusPane,
      nextDetailMode: escapeResult.nextDetailMode,
      status: escapeResult.status,
    };
  }
  if (input.navigation.focusPane === "input" && input.navigation.editingInput) {
    return {
      kind: "finish-input-editing",
      status: "Input edit finished",
    };
  }
  return { kind: "none" };
}

export function resolveDirectChildSubworkflows(input: {
  readonly parentSubworkflowId: string;
  readonly workflow: LoadedWorkflow["bundle"]["workflow"];
}): readonly LoadedWorkflow["bundle"]["workflow"]["subWorkflows"][number][] {
  const parent = input.workflow.subWorkflows.find(
    (entry) => entry.id === input.parentSubworkflowId,
  );
  if (parent === undefined) {
    return [];
  }
  const descendants = input.workflow.subWorkflows.filter((candidate) => {
    if (candidate.id === parent.id) {
      return false;
    }
    return candidate.nodeIds.every((nodeId) => parent.nodeIds.includes(nodeId));
  });
  return descendants.filter(
    (candidate) =>
      !descendants.some((other) => {
        if (other.id === candidate.id) {
          return false;
        }
        return candidate.nodeIds.every((nodeId) =>
          other.nodeIds.includes(nodeId),
        );
      }),
  );
}

export function buildOpenTuiBreadcrumb(input: {
  readonly loadedWorkflow: LoadedWorkflow | undefined;
  readonly screenMode: ScreenMode;
  readonly selectedWorkflowName?: string;
  readonly subworkflowPath: readonly string[];
}): string {
  const workflowLabel =
    input.loadedWorkflow?.bundle.workflow.workflowId ??
    input.selectedWorkflowName;
  const segments =
    input.screenMode === "workspace" && workflowLabel === undefined
      ? ["workspace"]
      : [
          "workspace",
          ...(workflowLabel === undefined ? [] : [workflowLabel]),
          ...(input.screenMode === "workspace"
            ? []
            : input.screenMode === "definition"
              ? ["definition"]
              : input.screenMode === "run"
                ? ["new-run"]
                : ["history", ...input.subworkflowPath]),
        ];
  return segments.join(" > ");
}

export function workflowNamesToSelectOptions(
  workflowNames: readonly string[],
): ReadonlyArray<{
  readonly description: string;
  readonly name: string;
  readonly value: string;
}> {
  return workflowNames.map((name) => ({
    description: "press enter/ctrl-m for definition, n for a new run",
    name,
    value: name,
  }));
}

export function resolveAgentSessionSummarySelection(input: {
  readonly execution: NodeExecutionRecord;
  readonly payload: NodePayload | undefined;
}): DetailAgentSessionSelection | undefined {
  const backend = resolveCliAgentBackendForNode(input.payload);
  if (backend === undefined) {
    return undefined;
  }
  return {
    available:
      input.execution.backendSessionId !== undefined &&
      input.execution.backendSessionId.length > 0,
    ...(input.execution.backendSessionId === undefined
      ? {}
      : { sessionId: input.execution.backendSessionId }),
    backend,
    kind: "agent-session",
    title: `AI agent session (${backend})`,
  };
}
