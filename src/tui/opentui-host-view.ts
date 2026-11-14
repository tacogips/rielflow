import type { OpenTuiPaneChromeState } from "./opentui-model";
import type { OpenTuiMainViewRefs } from "./opentui-solid-components";

type RequiredOpenTuiMainViewRefKey = keyof OpenTuiMainViewRefs;

export type MountedOpenTuiMainViewRefs = {
  readonly [Key in RequiredOpenTuiMainViewRefKey]-?: Exclude<
    OpenTuiMainViewRefs[Key],
    undefined
  >;
};

const REQUIRED_OPEN_TUI_MAIN_VIEW_REF_KEYS = [
  "agentSessionPopup",
  "agentSessionPopupText",
  "breadcrumbText",
  "confirmPopup",
  "confirmText",
  "definitionScreen",
  "detailScroll",
  "detailSummaryHeader",
  "detailSummarySelect",
  "detailText",
  "footerBox",
  "footerText",
  "filterPopup",
  "filterTextarea",
  "helpPopup",
  "helpText",
  "historyHeaderBox",
  "historyHeaderText",
  "historyScreen",
  "inputRow",
  "inputShell",
  "inputTextarea",
  "nodeDefinitionPopup",
  "nodeDefinitionPopupText",
  "nodePane",
  "nodeSelect",
  "runStatusPane",
  "runStatusText",
  "runTopRow",
  "runWorkflowPane",
  "runWorkflowText",
  "workspaceHistoryScroll",
  "workspaceHistoryText",
  "selectorPreviewScroll",
  "selectorPreviewText",
  "selectorRow",
  "sessionPane",
  "sessionSelect",
  "workflowPane",
  "workflowDefinitionNodePane",
  "workflowDefinitionNodeSelect",
  "workflowDefinitionPane",
  "workflowDefinitionText",
  "workflowSelect",
] as const satisfies readonly RequiredOpenTuiMainViewRefKey[];

export function requireOpenTuiMainViewRefs(
  refs: OpenTuiMainViewRefs,
): MountedOpenTuiMainViewRefs {
  const missing = REQUIRED_OPEN_TUI_MAIN_VIEW_REF_KEYS.filter(
    (key) => refs[key] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(
      `OpenTUI Solid workflow app failed to mount refs: ${missing.join(", ")}`,
    );
  }
  return refs as MountedOpenTuiMainViewRefs;
}

export function applyOpenTuiPaneChrome(
  refs: Pick<
    MountedOpenTuiMainViewRefs,
    | "detailScroll"
    | "historyHeaderBox"
    | "inputShell"
    | "nodePane"
    | "runStatusPane"
    | "runWorkflowPane"
    | "workspaceHistoryScroll"
    | "selectorPreviewScroll"
    | "sessionPane"
    | "workflowPane"
    | "workflowDefinitionNodePane"
    | "workflowDefinitionPane"
  >,
  paneChrome: OpenTuiPaneChromeState,
): void {
  refs.workflowPane.title = paneChrome.workflow.title;
  refs.workflowPane.borderColor = paneChrome.workflow.borderColor;
  refs.workflowPane.backgroundColor = paneChrome.workflow.backgroundColor;

  refs.workflowDefinitionPane.title = paneChrome.workflowDefinition.title;
  refs.workflowDefinitionPane.borderColor =
    paneChrome.workflowDefinition.borderColor;
  refs.workflowDefinitionPane.backgroundColor =
    paneChrome.workflowDefinition.backgroundColor;

  refs.workflowDefinitionNodePane.title =
    paneChrome.workflowDefinitionNodes.title;
  refs.workflowDefinitionNodePane.borderColor =
    paneChrome.workflowDefinitionNodes.borderColor;
  refs.workflowDefinitionNodePane.backgroundColor =
    paneChrome.workflowDefinitionNodes.backgroundColor;

  refs.selectorPreviewScroll.title = paneChrome.selectorPreview.title;
  refs.selectorPreviewScroll.borderColor =
    paneChrome.selectorPreview.borderColor;

  refs.workspaceHistoryScroll.title = paneChrome.workspaceHistory.title;
  refs.workspaceHistoryScroll.borderColor =
    paneChrome.workspaceHistory.borderColor;

  refs.historyHeaderBox.title = paneChrome.historyHeader.title;
  refs.historyHeaderBox.borderColor = paneChrome.historyHeader.borderColor;

  refs.sessionPane.title = paneChrome.session.title;
  refs.sessionPane.borderColor = paneChrome.session.borderColor;
  refs.sessionPane.backgroundColor = paneChrome.session.backgroundColor;

  refs.nodePane.title = paneChrome.node.title;
  refs.nodePane.borderColor = paneChrome.node.borderColor;
  refs.nodePane.backgroundColor = paneChrome.node.backgroundColor;

  refs.detailScroll.title = paneChrome.detail.title;
  refs.detailScroll.borderColor = paneChrome.detail.borderColor;

  refs.runWorkflowPane.title = paneChrome.runWorkflow.title;
  refs.runWorkflowPane.borderColor = paneChrome.runWorkflow.borderColor;

  refs.runStatusPane.title = paneChrome.runStatus.title;
  refs.runStatusPane.borderColor = paneChrome.runStatus.borderColor;

  refs.inputShell.title = paneChrome.input.title;
  refs.inputShell.borderColor = paneChrome.input.borderColor;
  refs.inputShell.backgroundColor = paneChrome.input.backgroundColor;
}
