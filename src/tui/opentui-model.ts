import type { LoadedWorkflow } from "../workflow/load";
import type {
  NodeExecutionRecord,
  WorkflowSessionState,
} from "../workflow/session";
import type {
  RuntimeNodeExecutionSummary,
  RuntimeNodeLogEntry,
  RuntimeSessionSummary,
} from "../workflow/runtime-db";
import type {
  ArgumentBinding,
  CliAgentBackend,
  NodePayload,
} from "../workflow/types";
import { normalizeCliAgentBackend } from "../workflow/backend";
import { deriveWorkflowVisualization } from "../workflow/visualization";
import {
  StyledText,
  bold,
  brightCyan,
  brightWhite,
  dim,
  fg,
  t,
} from "@opentui/core";
import type { OpenTuiRichSelectOption } from "./opentui-view-shared";
import {
  resolveOpenTuiNodeKindColor,
  resolveOpenTuiNodeTypeColor,
  resolveOpenTuiStatusColor,
  resolveOpenTuiWorkflowScopeColor,
} from "./opentui-view-shared";

export interface RuntimeSessionView {
  readonly session: WorkflowSessionState;
  readonly nodeExecutions: readonly RuntimeNodeExecutionSummary[];
  readonly nodeLogs: readonly RuntimeNodeLogEntry[];
}

export type TuiWorkflowInputMode = "json" | "text";

export interface TuiWorkflowInputDetection {
  readonly mode: TuiWorkflowInputMode;
  readonly reason: string;
}

export interface TuiWorkflowInputSyntax {
  readonly column?: number;
  readonly line?: number;
  readonly status: "not-applicable" | "valid" | "valid-empty" | "invalid";
  readonly summary: string;
}

export type FocusPane =
  | "definition"
  | "detail"
  | "input"
  | "nodes"
  | "sessions"
  | "workflows";

export type DetailMode =
  | "inbox"
  | "manager"
  | "outbox"
  | "session-logs"
  | "summary"
  | "viewer";

export type DetailReturnPane = "nodes" | "sessions";

export type ScreenMode = "definition" | "history" | "run" | "workspace";

export type HistoryPaneNavigationMode = "list" | "scroll" | "typing";

export type HistoryViewMode = "subworkflow" | "workflow";

export type OpenTuiDirectionalAction =
  | {
      readonly kind: "close-subworkflow";
    }
  | {
      readonly kind: "focus";
      readonly focusPane: FocusPane;
      readonly nextDetailMode?: DetailMode;
      readonly status: string;
    }
  | {
      readonly kind: "none";
    }
  | {
      readonly kind: "open-definition";
    }
  | {
      readonly kind: "open-history";
    }
  | {
      readonly kind: "open-workspace";
    }
  | {
      readonly kind: "open-subworkflow";
    };

export type OpenTuiHistoryAdvanceAction =
  | {
      readonly focusAfterSessionLoad: "detail";
      readonly kind: "load-session-selection";
    }
  | {
      readonly kind: "load-node-selection";
    }
  | {
      readonly kind: "none";
    }
  | {
      readonly kind: "open-detail-summary-selection";
    }
  | {
      readonly kind: "start-input-editing";
    };

export type OpenTuiHistoryRevertAction =
  | {
      readonly kind: "finish-input-editing";
      readonly status: string;
    }
  | {
      readonly kind: "focus";
      readonly focusPane: FocusPane;
      readonly nextDetailMode: DetailMode;
      readonly status: string;
    }
  | {
      readonly kind: "none";
    };

export type OpenTuiPopupKind =
  | "agent-session"
  | "filter"
  | "help"
  | "node-definition"
  | "none"
  | "run-confirm";

export type OpenTuiPopupConfirmAction =
  | {
      readonly kind: "apply-filter";
    }
  | {
      readonly kind: "confirm-run";
    }
  | {
      readonly kind: "none";
    };

export type OpenTuiPopupRevertAction =
  | {
      readonly kind: "cancel-filter";
    }
  | {
      readonly kind: "close-agent-session";
    }
  | {
      readonly kind: "close-node-definition";
    }
  | {
      readonly kind: "close-help";
    }
  | {
      readonly kind: "close-run-confirm";
    }
  | {
      readonly kind: "none";
    };

export type OpenTuiPopupScrollDelta = -1 | 0 | 1;

export interface OpenTuiCopyTarget {
  readonly label: string;
  readonly value: string;
}

export interface OpenTuiCopyTargetInput {
  readonly focusPane: FocusPane;
  readonly loadedWorkflowId?: string;
  readonly screenMode: ScreenMode;
  readonly selectedNodeExecutionId?: string;
  readonly selectedSessionId?: string;
  readonly selectedSubworkflowId?: string;
  readonly selectedWorkflowName?: string;
  readonly selectedWorkflowNodeId?: string;
}

export interface OpenTuiPaneChrome {
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly title: string;
}

export interface OpenTuiPaneChromeState {
  readonly detail: OpenTuiPaneChrome;
  readonly historyHeader: OpenTuiPaneChrome;
  readonly input: OpenTuiPaneChrome;
  readonly node: OpenTuiPaneChrome;
  readonly runStatus: OpenTuiPaneChrome;
  readonly runWorkflow: OpenTuiPaneChrome;
  readonly selectorPreview: OpenTuiPaneChrome;
  readonly session: OpenTuiPaneChrome;
  readonly workflow: OpenTuiPaneChrome;
  readonly workflowDefinition: OpenTuiPaneChrome;
  readonly workflowDefinitionNodes: OpenTuiPaneChrome;
}

export interface HistoryPaneLabels {
  readonly header: string;
  readonly left: string;
  readonly right: string;
}

export interface DetailJsonViewerSelection {
  readonly body: string;
  readonly kind: "json-viewer";
  readonly title: string;
}

export interface DetailAgentSessionSelection {
  readonly available: boolean;
  readonly backend?: CliAgentBackend;
  readonly kind: "agent-session";
  readonly sessionId?: string;
  readonly title: string;
}

export interface NodeDetailArtifactBundle {
  readonly artifactInput: string | null;
  readonly artifactOutput: string | null;
  readonly artifactMeta: string | null;
  readonly mailboxMeta: string | null;
  readonly mailboxInput: string | null;
  readonly mailboxOutput: string | null;
}

export interface ShortcutKeyLike {
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly name: string;
  readonly shift: boolean;
}

export const OPEN_TUI_EMPTY_SELECT_VALUE = "__opentui_empty__";
const SUMMARY_JSON_PREVIEW_LINES = 14;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDetailJsonViewerSelection(
  value: unknown,
): value is DetailJsonViewerSelection {
  return (
    isRecord(value) &&
    value["kind"] === "json-viewer" &&
    typeof value["title"] === "string" &&
    typeof value["body"] === "string"
  );
}

export function isDetailAgentSessionSelection(
  value: unknown,
): value is DetailAgentSessionSelection {
  return (
    isRecord(value) &&
    value["kind"] === "agent-session" &&
    typeof value["title"] === "string" &&
    typeof value["available"] === "boolean" &&
    (value["backend"] === undefined ||
      value["backend"] === "codex-agent" ||
      value["backend"] === "claude-code-agent") &&
    (value["sessionId"] === undefined || typeof value["sessionId"] === "string")
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function hasVisibleText(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function compactJson(value: unknown, maxLength = 140): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return "null";
  }
  return truncate(serialized, maxLength);
}

function extractTextValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (
    isRecord(value) &&
    typeof value["text"] === "string" &&
    Object.keys(value).length === 1
  ) {
    return value["text"];
  }
  return undefined;
}

function extractJsonParseLocation(
  message: string,
): Readonly<{ column?: number; line?: number }> {
  const matched = /line\s+(\d+)\s+column\s+(\d+)/i.exec(message);
  if (matched === null) {
    return {};
  }
  const [, lineText, columnText] = matched;
  const line = Number(lineText);
  const column = Number(columnText);
  return {
    ...(Number.isFinite(line) ? { line } : {}),
    ...(Number.isFinite(column) ? { column } : {}),
  };
}

function resolveNodeKind(
  workflow: LoadedWorkflow["bundle"]["workflow"],
  nodeId: string,
): string {
  return workflow.nodes.find((entry) => entry.id === nodeId)?.kind ?? "task";
}

export function findLatestNodeExecution(
  session: WorkflowSessionState,
  nodeId: string,
): NodeExecutionRecord | undefined {
  return [...session.nodeExecutions]
    .reverse()
    .find((entry) => entry.nodeId === nodeId);
}

function summarizePromptHelp(
  promptTemplate: string | undefined,
): string | undefined {
  if (promptTemplate === undefined) {
    return undefined;
  }
  const normalized = promptTemplate
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return normalized === undefined ? undefined : truncate(normalized, 120);
}

export function resolveOwningSubWorkflow(
  workflow: LoadedWorkflow["bundle"]["workflow"],
  nodeId: string,
): LoadedWorkflow["bundle"]["workflow"]["subWorkflows"][number] | undefined {
  return workflow.subWorkflows.find(
    (entry) =>
      entry.managerNodeId === nodeId ||
      entry.inputNodeId === nodeId ||
      entry.outputNodeId === nodeId ||
      entry.nodeIds.includes(nodeId),
  );
}

function resolveNodePurpose(input: {
  readonly nodeId: string;
  readonly payload: NodePayload | undefined;
  readonly workflow: LoadedWorkflow["bundle"]["workflow"];
}): string | undefined {
  const owningSubWorkflow = resolveOwningSubWorkflow(
    input.workflow,
    input.nodeId,
  );
  return (
    input.payload?.description ??
    input.payload?.output?.description ??
    owningSubWorkflow?.description ??
    summarizePromptHelp(input.payload?.promptTemplate)
  );
}

function buildNodeRowDescription(input: {
  readonly purpose?: string;
  readonly scopeLabel?: string;
}): string {
  const parts = [
    `scope: ${input.scopeLabel ?? "root"}`,
    ...(input.purpose === undefined
      ? []
      : [`purpose: ${truncate(input.purpose, 56)}`]),
  ];
  return parts.join("  ");
}

function buildNodeRowName(input: {
  readonly indentPrefix?: string;
  readonly nodeId: string;
}): string {
  return `${input.indentPrefix ?? ""}${input.nodeId}`;
}

function formatNodeKindLabel(kind: string): string {
  if (kind === "root-manager") {
    return "ROOT MANAGER";
  }
  if (kind === "subworkflow-manager") {
    return "SUBFLOW MANAGER";
  }
  if (kind === "input") {
    return "INPUT";
  }
  if (kind === "output") {
    return "OUTPUT";
  }
  if (kind === "task") {
    return "TASK";
  }
  return kind.replace(/-/g, " ").toUpperCase();
}

function formatStatusLabel(status: string): string {
  return status.replace(/_/g, " ").toUpperCase();
}

function formatNodeTypeLabel(nodeType: string): string {
  if (nodeType === "user-action") {
    return "USER ACTION";
  }
  return nodeType.toUpperCase();
}

function buildNodeTypeDetail(payload: NodePayload | undefined): string | undefined {
  const nodeType = payload?.nodeType ?? "agent";
  if (nodeType === "agent") {
    return (
      resolveCliAgentBackendForNode(payload) ??
      payload?.executionBackend ??
      payload?.model
    );
  }
  if (nodeType === "command") {
    return payload?.command?.scriptPath;
  }
  if (nodeType === "container") {
    return (
      payload?.container?.image ??
      payload?.container?.build?.contextPath ??
      payload?.container?.runnerKind
    );
  }
  if (nodeType === "user-action") {
    return "operator reply";
  }
  return undefined;
}

function buildNodeRowTypeLine(input: {
  readonly kind: string;
  readonly payload: NodePayload | undefined;
}): string {
  const kindLabel = formatNodeKindLabel(input.kind);
  const nodeType = input.payload?.nodeType ?? "agent";
  const typeLabel = formatNodeTypeLabel(nodeType);
  const detail = buildNodeTypeDetail(input.payload);
  return detail === undefined
    ? `${kindLabel} | ${typeLabel}`
    : `${kindLabel} | ${typeLabel}  ${truncate(detail, 40)}`;
}

interface WorkflowNodeVisualMetadata {
  readonly indentPrefix: string;
  readonly scopeColor: string;
}

function buildWorkflowNodeVisualMetadata(
  loaded: LoadedWorkflow,
): ReadonlyMap<string, WorkflowNodeVisualMetadata> {
  const derivedNodes = deriveWorkflowVisualization({
    workflow: loaded.bundle.workflow,
    workflowVis: loaded.bundle.workflowVis,
  });
  const nodeKindById = new Map(
    loaded.bundle.workflow.nodes.map((node) => [node.id, node.kind ?? "task"] as const),
  );
  const subworkflowScopeNodeIds = new Set<string>();
  loaded.bundle.workflow.subWorkflows.forEach((subworkflow) => {
    subworkflowScopeNodeIds.add(subworkflow.managerNodeId);
    subworkflowScopeNodeIds.add(subworkflow.inputNodeId);
    subworkflowScopeNodeIds.add(subworkflow.outputNodeId);
    subworkflow.nodeIds.forEach((nodeId) => {
      subworkflowScopeNodeIds.add(nodeId);
    });
  });
  return new Map(
    derivedNodes.map((entry) => {
      const kind = nodeKindById.get(entry.id) ?? "task";
      const indentLevel = resolveWorkflowPreviewIndent({
        derivedIndent: entry.indent,
        inSubworkflowScope: subworkflowScopeNodeIds.has(entry.id),
        kind,
      });
      return [
        entry.id,
        {
          indentPrefix: "  ".repeat(indentLevel),
          scopeColor: resolveOpenTuiWorkflowScopeColor(entry.color),
        },
      ] as const;
    }),
  );
}

function resolveWorkflowNodeVisualMetadata(input: {
  readonly nodeId: string;
  readonly visualMetadataByNodeId?: ReadonlyMap<string, WorkflowNodeVisualMetadata>;
}): WorkflowNodeVisualMetadata {
  return (
    input.visualMetadataByNodeId?.get(input.nodeId) ?? {
      indentPrefix: "",
      scopeColor: resolveOpenTuiWorkflowScopeColor(undefined),
    }
  );
}

function buildNodePreviewContextLine(input: {
  readonly purpose?: string;
  readonly scopeLabel?: string;
}): string {
  return buildNodeRowDescription({
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    ...(input.scopeLabel === undefined ? {} : { scopeLabel: input.scopeLabel }),
  });
}

function buildPreviewLine(input: {
  readonly color: string;
  readonly indentPrefix: string;
  readonly text: string;
}): StyledText {
  return t`${input.indentPrefix}${fg(input.color)(input.text)}\n`;
}

function buildPreviewSeparator(indentPrefix: string): StyledText {
  return t`${dim(`${indentPrefix}----------------------------------------\n`)}`;
}

function buildPreviewFinalSeparator(indentPrefix: string): StyledText {
  return t`${dim(`${indentPrefix}----------------------------------------`)}`;
}

function buildPreviewTitleLine(input: {
  readonly indentPrefix: string;
  readonly kind: string;
  readonly nodeId: string;
}): StyledText {
  return t`${input.indentPrefix}${fg(resolveOpenTuiNodeKindColor(input.kind))(bold(
    input.nodeId,
  ))}\n`;
}

function buildNodeSelectOption(input: {
  readonly kind: string;
  readonly nodeId: string;
  readonly payload: NodePayload | undefined;
  readonly purpose?: string;
  readonly scopeLabel?: string;
  readonly value: string;
  readonly visualMetadataByNodeId?: ReadonlyMap<string, WorkflowNodeVisualMetadata>;
  readonly execution?: NodeExecutionRecord;
}): OpenTuiRichSelectOption {
  const nodeType = input.payload?.nodeType ?? "agent";
  const visualMetadata = resolveWorkflowNodeVisualMetadata({
    nodeId: input.nodeId,
    ...(input.visualMetadataByNodeId === undefined
      ? {}
      : { visualMetadataByNodeId: input.visualMetadataByNodeId }),
  });
  const kindColor = resolveOpenTuiNodeKindColor(input.kind);
  const typeColor = resolveOpenTuiNodeTypeColor(nodeType);
  const contextLine = buildNodePreviewContextLine({
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    ...(input.scopeLabel === undefined ? {} : { scopeLabel: input.scopeLabel }),
  });
  return {
    description: buildNodeRowTypeLine({
      kind: input.kind,
      payload: input.payload,
    }),
    detailLineColors: [typeColor, visualMetadata.scopeColor],
    detailLines: [
      `${visualMetadata.indentPrefix}${buildNodeRowTypeLine({
        kind: input.kind,
        payload: input.payload,
      })}`,
      `${visualMetadata.indentPrefix}${contextLine}`,
    ],
    labelText: buildNodeRowName({
      indentPrefix: visualMetadata.indentPrefix,
      nodeId: input.nodeId,
    }),
    name: input.nodeId,
    statusColor: resolveOpenTuiStatusColor(input.execution?.status ?? "pending"),
    statusLabel: formatStatusLabel(input.execution?.status ?? "pending"),
    textColor: kindColor,
    value: input.value,
  };
}

function resolveCliAgentBackendForNode(
  payload: NodePayload | undefined,
): CliAgentBackend | undefined {
  if ((payload?.nodeType ?? "agent") !== "agent") {
    return undefined;
  }
  return (
    normalizeCliAgentBackend(payload?.executionBackend ?? payload?.model) ??
    undefined
  );
}

function formatJsonForDisplay(raw: string | null): string {
  if (raw === null || raw.trim().length === 0) {
    return "(no data)";
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

function takeFirstLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) {
    return text;
  }
  return [
    ...lines.slice(0, maxLines),
    `... (${String(lines.length - maxLines)} more lines)`,
  ].join("\n");
}

function summarizeJsonBlock(raw: string | null): {
  full: string;
  preview: string;
} {
  const full = formatJsonForDisplay(raw);
  const preview = takeFirstLines(full, SUMMARY_JSON_PREVIEW_LINES);
  return { full, preview };
}

function formatLogEntries(
  logEntries: readonly RuntimeNodeLogEntry[],
  limit: number,
): string {
  if (logEntries.length === 0) {
    return "(no logs)";
  }
  return logEntries
    .slice(Math.max(0, logEntries.length - limit))
    .map((entry) => {
      const scope =
        entry.nodeId === null
          ? "workflow"
          : `${entry.nodeId}${entry.nodeExecId === null ? "" : `/${entry.nodeExecId}`}`;
      return `[${entry.at}] [${entry.level}] ${scope}: ${entry.message}`;
    })
    .join("\n");
}

function resolveWorkflowFinalResult(
  runtimeSessionView: RuntimeSessionView | undefined,
): unknown {
  const workflowOutput =
    runtimeSessionView?.session.runtimeVariables["workflowOutput"];
  if (workflowOutput !== undefined) {
    return workflowOutput;
  }
  const latestOutput = runtimeSessionView?.nodeExecutions.at(-1)?.outputJson;
  if (latestOutput === undefined || latestOutput.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(latestOutput) as unknown;
  } catch {
    return latestOutput;
  }
}

function looksLikeStructuredHumanInputBinding(
  binding: ArgumentBinding,
): boolean {
  if (binding.source !== "human-input") {
    return false;
  }
  if (
    binding.sourcePath === undefined ||
    binding.sourcePath.trim().length === 0
  ) {
    return false;
  }
  const normalized = binding.sourcePath.trim().toLowerCase();
  return normalized !== "text" && normalized !== "value";
}

function promptHintsJsonInput(promptTemplate: string | undefined): boolean {
  if (promptTemplate === undefined || promptTemplate.trim().length === 0) {
    return false;
  }
  const normalized = promptTemplate.toLowerCase();
  const positiveSignals = [
    "json",
    "structured",
    "object",
    "fields",
    "keys",
    "schema",
  ];
  const negativeSignals = [
    "plain text",
    "free text",
    "space-separated",
    "natural language",
    "human request",
  ];
  return (
    positiveSignals.some((signal) => normalized.includes(signal)) &&
    !negativeSignals.some((signal) => normalized.includes(signal))
  );
}

function payloadExpectsJsonInput(payload: NodePayload | undefined): boolean {
  if (payload === undefined) {
    return false;
  }
  if (
    (payload.argumentBindings ?? []).some(looksLikeStructuredHumanInputBinding)
  ) {
    return true;
  }
  if (
    payload.argumentsTemplate !== undefined &&
    (payload.argumentBindings ?? []).some(
      (binding) => binding.source === "human-input",
    )
  ) {
    return true;
  }
  return promptHintsJsonInput(payload.promptTemplate);
}

function paneTitle(label: string, active: boolean): string {
  return active ? ` >> ${label} << ` : ` ${label} `;
}

function paneBorderColor(active: boolean): string {
  return active ? "#4fd1ff" : "#5b6670";
}

function paneBackgroundColor(active: boolean): string {
  return active ? "#101a22" : "transparent";
}

export function isOpenTuiEmptySelectValue(value: unknown): boolean {
  return value === OPEN_TUI_EMPTY_SELECT_VALUE;
}

export function resolveHistoryPaneNavigationMode(input: {
  readonly detailMode: DetailMode;
  readonly focusPane: FocusPane;
}): HistoryPaneNavigationMode {
  if (input.focusPane === "input") {
    return "typing";
  }
  if (input.focusPane === "detail") {
    return input.detailMode === "summary" ? "list" : "scroll";
  }
  return "list";
}

export function resolveTabFocusTarget(input: {
  readonly direction: "next" | "previous";
  readonly focusPane: FocusPane;
  readonly screenMode: ScreenMode;
}): FocusPane | undefined {
  if (input.screenMode === "definition") {
    if (input.direction === "next") {
      return input.focusPane === "definition" ? "nodes" : "definition";
    }
    return input.focusPane === "nodes" ? "definition" : "nodes";
  }
  if (input.screenMode !== "history") {
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
    return input.focusPane === "definition"
      ? undefined
      : nextFocus[input.focusPane];
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
  return input.focusPane === "definition"
    ? undefined
    : previousFocus[input.focusPane];
}

export function resolveDirectionalNavigationAction(input: {
  readonly direction: "forward" | "revert";
  readonly focusPane: FocusPane;
  readonly historyViewMode: HistoryViewMode;
  readonly screenMode: ScreenMode;
}): OpenTuiDirectionalAction {
  if (input.screenMode === "workspace") {
    return input.direction === "forward"
      ? { kind: "open-definition" }
      : { kind: "none" };
  }

  if (input.screenMode === "definition") {
    return input.direction === "forward"
      ? { kind: "open-history" }
      : { kind: "open-workspace" };
  }

  if (input.screenMode === "run") {
    return input.direction === "forward"
      ? { kind: "open-history" }
      : { kind: "open-workspace" };
  }

  if (input.direction === "forward") {
    if (input.focusPane === "sessions") {
      return {
        kind: "focus",
        focusPane: "nodes",
        nextDetailMode: "summary",
        status:
          input.historyViewMode === "workflow"
            ? "Focused nodes for the selected workflow run"
            : "Focused child workflow list",
      };
    }
    if (input.focusPane === "nodes") {
      return {
        kind: "open-subworkflow",
      };
    }
    return { kind: "none" };
  }

  if (input.focusPane === "nodes") {
    return {
      kind: "focus",
      focusPane: "sessions",
      nextDetailMode: "summary",
      status:
        input.historyViewMode === "workflow"
          ? "Focused workflow runs"
          : "Focused workflow nodes",
    };
  }
  if (input.focusPane === "sessions") {
    return input.historyViewMode === "subworkflow"
      ? { kind: "close-subworkflow" }
      : { kind: "open-workspace" };
  }
  return { kind: "none" };
}

export function resolveOpenTuiPopupKind(input: {
  readonly agentSessionPopupOpen: boolean;
  readonly confirmPopupOpen: boolean;
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
  if (input.confirmPopupOpen) {
    return "run-confirm";
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
    case "run-confirm":
      return { kind: "close-run-confirm" };
    case "node-definition":
      return { kind: "close-node-definition" as const };
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
  readonly detailMode: DetailMode;
  readonly detailSummarySelectId: string;
  readonly focusPane: FocusPane;
  readonly definitionNodeSelectId: string;
  readonly nodeSelectId: string;
  readonly screenMode: ScreenMode;
  readonly sessionSelectId: string;
  readonly workflowSelectId: string;
}): string | undefined {
  if (input.screenMode === "workspace") {
    return input.workflowSelectId;
  }
  if (input.screenMode === "definition") {
    return input.focusPane === "nodes" ? input.definitionNodeSelectId : undefined;
  }
  if (input.screenMode !== "history") {
    return undefined;
  }
  if (input.focusPane === "sessions") {
    return input.sessionSelectId;
  }
  if (input.focusPane === "nodes") {
    return input.nodeSelectId;
  }
  if (input.focusPane === "detail" && input.detailMode === "summary") {
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
    if (input.focusPane === "nodes" && input.selectedWorkflowNodeId !== undefined) {
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

export function detectWorkflowInputMode(
  loaded: Pick<LoadedWorkflow, "bundle" | "workflowName">,
): TuiWorkflowInputDetection {
  const workflow = loaded.bundle.workflow;
  const inputNodeIds = new Set(
    workflow.subWorkflows.map((subWorkflow) => subWorkflow.inputNodeId),
  );
  const inputPayloads = workflow.nodes
    .filter((node) => node.kind === "input" || inputNodeIds.has(node.id))
    .map((node) => loaded.bundle.nodePayloads[node.nodeFile])
    .filter((payload): payload is NodePayload => payload !== undefined);

  if (inputPayloads.some(payloadExpectsJsonInput)) {
    return {
      mode: "json",
      reason:
        "detected structured human-input bindings or JSON-oriented input prompts",
    };
  }

  return {
    mode: "text",
    reason:
      "defaulted to plain text because the workflow definition has no clear JSON-only hint",
  };
}

export function formatEditorValue(
  value: unknown,
  mode: TuiWorkflowInputMode,
): string {
  if (value === undefined) {
    return mode === "json" ? "{}" : "";
  }
  if (mode === "text") {
    const textValue = extractTextValue(value);
    return textValue ?? compactJson(value, 10_000);
  }
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value) as unknown, null, 2);
    } catch {
      return JSON.stringify({ text: value }, null, 2);
    }
  }
  return JSON.stringify(value, null, 2);
}

export function deriveEditorTextFromRuntimeVariables(
  runtimeVariables: Readonly<Record<string, unknown>>,
  mode: TuiWorkflowInputMode,
): string {
  const preferredValue =
    mode === "json"
      ? (runtimeVariables["rerunPrompt"] ??
        runtimeVariables["promptJson"] ??
        runtimeVariables["userPromptJson"] ??
        runtimeVariables["humanInput"] ??
        runtimeVariables["prompt"] ??
        runtimeVariables["userPrompt"])
      : (runtimeVariables["rerunPrompt"] ??
        runtimeVariables["humanInput"] ??
        runtimeVariables["prompt"] ??
        runtimeVariables["userPrompt"] ??
        runtimeVariables["promptJson"] ??
        runtimeVariables["userPromptJson"]);
  return formatEditorValue(preferredValue, mode);
}

export function parseTuiEditorValue(
  editorText: string,
  mode: TuiWorkflowInputMode,
): unknown {
  if (mode === "text") {
    return editorText;
  }
  const trimmed = editorText.trim();
  if (trimmed.length === 0) {
    return {};
  }
  return JSON.parse(trimmed) as unknown;
}

export function buildTuiRuntimeVariables(input: {
  readonly editorText: string;
  readonly managerSessionId?: string;
  readonly mode: TuiWorkflowInputMode;
  readonly purpose: "rerun" | "run";
}): Readonly<Record<string, unknown>> {
  const parsedValue = parseTuiEditorValue(input.editorText, input.mode);
  if (input.mode === "text") {
    const textValue =
      typeof parsedValue === "string"
        ? parsedValue
        : compactJson(parsedValue, 20_000);
    return {
      humanInput: textValue,
      prompt: textValue,
      userPrompt: textValue,
      ...(input.purpose === "rerun" ? { rerunPrompt: textValue } : {}),
      ...(input.managerSessionId === undefined
        ? {}
        : { rerunManagerSessionId: input.managerSessionId }),
    };
  }
  return {
    humanInput: parsedValue,
    promptJson: parsedValue,
    userPromptJson: parsedValue,
    ...(input.purpose === "rerun" ? { rerunPrompt: parsedValue } : {}),
    ...(input.managerSessionId === undefined
      ? {}
      : { rerunManagerSessionId: input.managerSessionId }),
  };
}

export function formatJsonEditorText(editorText: string): string {
  const trimmed = editorText.trim();
  if (trimmed.length === 0) {
    return "{}";
  }
  return JSON.stringify(JSON.parse(trimmed) as unknown, null, 2);
}

export function describeTuiWorkflowInputSyntax(
  editorText: string,
  mode: TuiWorkflowInputMode,
): TuiWorkflowInputSyntax {
  if (mode === "text") {
    return {
      status: "not-applicable",
      summary: "plain text",
    };
  }

  const trimmed = editorText.trim();
  if (trimmed.length === 0) {
    return {
      status: "valid-empty",
      summary: "empty buffer -> {}",
    };
  }

  try {
    JSON.parse(trimmed) as unknown;
    return {
      status: "valid",
      summary: "valid JSON",
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    const location = extractJsonParseLocation(message);
    return {
      status: "invalid",
      summary:
        location.line === undefined || location.column === undefined
          ? `invalid JSON: ${message}`
          : `invalid JSON at line ${String(location.line)}, column ${String(location.column)}`,
      ...location,
    };
  }
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
  readonly detailMode: DetailMode;
  readonly focusPane: FocusPane;
}): OpenTuiHistoryAdvanceAction {
  if (input.focusPane === "sessions") {
    return {
      kind: "load-session-selection",
      focusAfterSessionLoad: "detail",
    };
  }
  if (input.focusPane === "nodes") {
    return { kind: "load-node-selection" };
  }
  if (input.focusPane === "detail") {
    return input.detailMode === "summary"
      ? { kind: "open-detail-summary-selection" }
      : { kind: "none" };
  }
  if (input.focusPane === "input") {
    return { kind: "start-input-editing" };
  }
  return { kind: "none" };
}

export function resolveHistoryRevertAction(input: {
  readonly detailMode: DetailMode;
  readonly detailReturnPane: DetailReturnPane;
  readonly editingInput: boolean;
  readonly focusPane: FocusPane;
  readonly historyViewMode: HistoryViewMode;
}): OpenTuiHistoryRevertAction {
  if (input.focusPane === "detail") {
    const escapeResult = resolveNodeDetailEscape({
      detailMode: input.detailMode,
      detailReturnPane: input.detailReturnPane,
      historyViewMode: input.historyViewMode,
    });
    return {
      kind: "focus",
      focusPane: escapeResult.nextFocusPane,
      nextDetailMode: escapeResult.nextDetailMode,
      status: escapeResult.status,
    };
  }
  if (input.focusPane === "input" && input.editingInput) {
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

export function resolveWorkflowPreviewIndent(input: {
  readonly derivedIndent: number;
  readonly inSubworkflowScope: boolean;
  readonly kind: string;
}): number {
  if (input.kind === "root-manager") {
    return 0;
  }
  if (input.inSubworkflowScope) {
    return input.derivedIndent + 1;
  }
  return input.derivedIndent;
}

function buildWorkflowNodePreview(loaded: LoadedWorkflow): StyledText {
  const derivedNodes = deriveWorkflowVisualization({
    workflow: loaded.bundle.workflow,
    workflowVis: loaded.bundle.workflowVis,
  });
  const visualMetadataByNodeId = buildWorkflowNodeVisualMetadata(loaded);
  const nodeRefById = new Map(
    loaded.bundle.workflow.nodes.map((node) => [node.id, node] as const),
  );
  const subWorkflowByNodeId = new Map<string, string>();
  loaded.bundle.workflow.subWorkflows.forEach((subWorkflow) => {
    subWorkflow.nodeIds.forEach((nodeId) => {
      subWorkflowByNodeId.set(nodeId, subWorkflow.description);
    });
  });
  const chunks: StyledText["chunks"] = [];

  const append = (value: StyledText): void => {
    chunks.push(...value.chunks);
  };

  derivedNodes.forEach((entry, index) => {
    const nodeRef = nodeRefById.get(entry.id);
    const payload =
      nodeRef === undefined
        ? undefined
        : loaded.bundle.nodePayloads[nodeRef.nodeFile];
    const kind = nodeRef?.kind ?? "task";
    const visualMetadata = resolveWorkflowNodeVisualMetadata({
      nodeId: entry.id,
      visualMetadataByNodeId,
    });
    const purpose =
      payload?.description ??
      payload?.output?.description ??
      subWorkflowByNodeId.get(entry.id) ??
      summarizePromptHelp(payload?.promptTemplate);
    const scopeLabel = subWorkflowByNodeId.get(entry.id);

    append(buildPreviewSeparator(visualMetadata.indentPrefix));
    append(
      buildPreviewTitleLine({
        indentPrefix: visualMetadata.indentPrefix,
        kind,
        nodeId: entry.id,
      }),
    );
    append(
      buildPreviewLine({
        color: resolveOpenTuiNodeTypeColor(payload?.nodeType),
        indentPrefix: visualMetadata.indentPrefix,
        text: buildNodeRowTypeLine({
          kind,
          payload,
        }),
      }),
    );
    append(
      buildPreviewLine({
        color: visualMetadata.scopeColor,
        indentPrefix: visualMetadata.indentPrefix,
        text: buildNodePreviewContextLine({
          ...(purpose === undefined ? {} : { purpose }),
          ...(scopeLabel === undefined ? {} : { scopeLabel }),
        }),
      }),
    );
    if (kind === "root-manager") {
      append(
        buildPreviewLine({
          color: "#dff0e4",
          indentPrefix: visualMetadata.indentPrefix,
          text: `workflow id: ${loaded.bundle.workflow.workflowId}`,
        }),
      );
    }
    if (index === derivedNodes.length - 1) {
      append(buildPreviewFinalSeparator(visualMetadata.indentPrefix));
    }
  });

  return new StyledText(chunks);
}

export function buildWorkflowSummaryPreview(
  loadedWorkflow: LoadedWorkflow | undefined,
): StyledText {
  if (loadedWorkflow === undefined) {
    return t`${dim("Loading workflow detail...")}`;
  }

  const chunks: StyledText["chunks"] = [];
  const append = (value: StyledText): void => {
    chunks.push(...value.chunks);
  };

  append(
    t`${dim(
      `Nodes: ${String(
        loadedWorkflow.bundle.workflow.nodes.length,
      )}  Sub-workflows: ${String(
        loadedWorkflow.bundle.workflow.subWorkflows.length,
      )}`,
    )}\n\n`,
  );
  append(t`${brightWhite(bold("Node Structure"))}\n`);
  append(buildWorkflowNodePreview(loadedWorkflow));
  return new StyledText(chunks);
}

function stringifyJsonForDisplay(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function buildWorkflowDefinitionContent(
  loadedWorkflow: LoadedWorkflow | undefined,
): string {
  if (loadedWorkflow === undefined) {
    return "No workflow loaded.";
  }
  return [
    `Workflow: ${loadedWorkflow.bundle.workflow.workflowId}`,
    `Workflow name: ${loadedWorkflow.workflowName}`,
    `Workflow directory: ${loadedWorkflow.workflowDirectory}`,
    `Artifact root: ${loadedWorkflow.artifactWorkflowRoot}`,
    "",
    "workflow.json",
    stringifyJsonForDisplay(loadedWorkflow.bundle.workflow),
    "",
    "workflow-vis.json",
    stringifyJsonForDisplay(loadedWorkflow.bundle.workflowVis),
  ].join("\n");
}

export function buildWorkflowSelectorPreview(input: {
  readonly filteredWorkflowNamesCount: number;
  readonly loadedWorkflow: LoadedWorkflow | undefined;
  readonly selectorPreviewWorkflow: LoadedWorkflow | undefined;
  readonly selectedWorkflowName?: string;
  readonly workflowFilterText: string;
  readonly workflowNamesCount: number;
}): StyledText {
  if (input.selectedWorkflowName === undefined) {
    return t`${
      input.workflowFilterText.length === 0
        ? "No workflow is selected."
        : `No workflows match filter '${input.workflowFilterText}'.`
    }`;
  }
  const previewWorkflow =
    input.selectorPreviewWorkflow?.workflowName === input.selectedWorkflowName
      ? input.selectorPreviewWorkflow
      : input.loadedWorkflow?.workflowName === input.selectedWorkflowName
        ? input.loadedWorkflow
        : undefined;
  const chunks: StyledText["chunks"] = [];
  chunks.push(
    ...t`${brightWhite("Workflow:")} ${bold(input.selectedWorkflowName)}\n${dim(
      `Filter: ${input.workflowFilterText.length === 0 ? "(none)" : input.workflowFilterText}  Matches: ${String(
        input.filteredWorkflowNamesCount,
      )}/${String(input.workflowNamesCount)}`,
    )}\n\n`.chunks,
  );
  chunks.push(...buildWorkflowSummaryPreview(previewWorkflow).chunks);
  return new StyledText(chunks);
}

export function buildWorkflowDefinitionNodeSelectOptions(
  workflow: LoadedWorkflow | undefined,
): ReadonlyArray<OpenTuiRichSelectOption> {
  if (workflow === undefined) {
    return [];
  }
  const visualMetadataByNodeId = buildWorkflowNodeVisualMetadata(workflow);
  return workflow.bundle.workflow.nodes.map((nodeRef) => {
    const payload = workflow.bundle.nodePayloads[nodeRef.nodeFile];
    const purpose = resolveNodePurpose({
      nodeId: nodeRef.id,
      payload,
      workflow: workflow.bundle.workflow,
    });
    return buildNodeSelectOption({
      kind: nodeRef.kind ?? "task",
      nodeId: nodeRef.id,
      payload,
      ...(purpose === undefined ? {} : { purpose }),
      value: nodeRef.id,
      visualMetadataByNodeId,
    });
  });
}

export function buildNodeDefinitionPopupContent(input: {
  readonly loadedWorkflow: LoadedWorkflow | undefined;
  readonly nodeId: string | undefined;
}): { readonly body: string; readonly title: string } {
  if (input.loadedWorkflow === undefined || input.nodeId === undefined) {
    return {
      title: " Node Definition ",
      body: "No workflow node is selected.",
    };
  }
  const nodeRef = input.loadedWorkflow.bundle.workflow.nodes.find(
    (entry) => entry.id === input.nodeId,
  );
  if (nodeRef === undefined) {
    return {
      title: ` Node Definition: ${input.nodeId} `,
      body: `Workflow node '${input.nodeId}' was not found.`,
    };
  }
  const payload = input.loadedWorkflow.bundle.nodePayloads[nodeRef.nodeFile];
  return {
    title: ` Node Definition: ${input.nodeId} `,
    body: [
      `Workflow: ${input.loadedWorkflow.bundle.workflow.workflowId}`,
      `Node: ${input.nodeId}`,
      `Node file: ${nodeRef.nodeFile}`,
      "",
      "workflow.json node entry",
      stringifyJsonForDisplay(nodeRef),
      "",
      "node payload",
      stringifyJsonForDisplay(payload ?? null),
    ].join("\n"),
  };
}

export function buildWorkflowHistoryHeader(
  loadedWorkflow: LoadedWorkflow | undefined,
  subworkflow:
    | LoadedWorkflow["bundle"]["workflow"]["subWorkflows"][number]
    | undefined,
): StyledText {
  if (loadedWorkflow === undefined) {
    return t`${dim("No workflow loaded.")}`;
  }
  const workflowDescription = hasVisibleText(
    loadedWorkflow.bundle.workflow.description,
  )
    ? loadedWorkflow.bundle.workflow.description
    : undefined;
  const scopeLines =
    subworkflow === undefined
      ? []
      : [
          `scope=${subworkflow.id}`,
          ...(hasVisibleText(subworkflow.description)
            ? [subworkflow.description]
            : []),
          `nodes=${String(subworkflow.nodeIds.length)}  manager=${subworkflow.managerNodeId}`,
        ];
  const chunks: StyledText["chunks"] = [];
  chunks.push(
    ...t`${brightCyan(bold(loadedWorkflow.bundle.workflow.workflowId))}`.chunks,
  );
  if (workflowDescription !== undefined) {
    chunks.push(...t`\n${brightWhite(workflowDescription)}`.chunks);
  }
  chunks.push(
    ...t`\n${dim(
      `nodes=${String(loadedWorkflow.bundle.workflow.nodes.length)}  subworkflows=${String(
        loadedWorkflow.bundle.workflow.subWorkflows.length,
      )}`,
    )}`.chunks,
  );
  if (scopeLines.length > 0) {
    chunks.push(...t`\n${scopeLines.join("\n")}`.chunks);
  }
  return new StyledText(chunks);
}

export function buildSessionSelectOptions(
  sessions: readonly RuntimeSessionSummary[],
): ReadonlyArray<OpenTuiRichSelectOption> {
  if (sessions.length === 0) {
    return [
      {
        name: "(no workflow runs)",
        description: "",
        value: OPEN_TUI_EMPTY_SELECT_VALUE,
      },
    ];
  }
  return sessions.map((session) => ({
    labelText: session.startedAt,
    name: session.startedAt,
    description: `run id: ${session.sessionId}`,
    statusColor: resolveOpenTuiStatusColor(session.status),
    statusLabel: formatStatusLabel(session.status),
    value: session.sessionId,
  }));
}

export function buildNodeSelectOptions(
  workflow: LoadedWorkflow | undefined,
  session: WorkflowSessionState | undefined,
): ReadonlyArray<OpenTuiRichSelectOption> {
  if (workflow === undefined || session === undefined) {
    return [];
  }
  if (session.nodeExecutions.length === 0) {
    return [];
  }
  const visualMetadataByNodeId = buildWorkflowNodeVisualMetadata(workflow);
  return session.nodeExecutions.map((execution) => {
    const kind = resolveNodeKind(workflow.bundle.workflow, execution.nodeId);
    const payload =
      workflow.bundle.nodePayloads[
        workflow.bundle.workflow.nodes.find(
          (entry) => entry.id === execution.nodeId,
        )?.nodeFile ?? ""
      ];
    const owningSubworkflow = resolveOwningSubWorkflow(
      workflow.bundle.workflow,
      execution.nodeId,
    );
    const purpose = resolveNodePurpose({
      nodeId: execution.nodeId,
      payload,
      workflow: workflow.bundle.workflow,
    });
    return buildNodeSelectOption({
      execution,
      kind,
      nodeId: execution.nodeId,
      payload,
      ...(purpose === undefined ? {} : { purpose }),
      value: execution.nodeExecId,
      visualMetadataByNodeId,
      ...(owningSubworkflow === undefined
        ? {}
        : { scopeLabel: owningSubworkflow.id }),
    });
  });
}

export function buildSubworkflowNodeSelectOptions(
  workflow: LoadedWorkflow | undefined,
  session: WorkflowSessionState | undefined,
  subworkflowId: string | undefined,
): ReadonlyArray<OpenTuiRichSelectOption> {
  if (
    workflow === undefined ||
    session === undefined ||
    subworkflowId === undefined
  ) {
    return [];
  }
  const subworkflow = workflow.bundle.workflow.subWorkflows.find(
    (entry) => entry.id === subworkflowId,
  );
  if (subworkflow === undefined) {
    return [];
  }
  const visualMetadataByNodeId = buildWorkflowNodeVisualMetadata(workflow);
  return subworkflow.nodeIds.map((nodeId) => {
    const kind = resolveNodeKind(workflow.bundle.workflow, nodeId);
    const execution = findLatestNodeExecution(session, nodeId);
    const payload =
      workflow.bundle.nodePayloads[
        workflow.bundle.workflow.nodes.find((entry) => entry.id === nodeId)
          ?.nodeFile ?? ""
      ];
    const purpose = resolveNodePurpose({
      nodeId,
      payload,
      workflow: workflow.bundle.workflow,
    });
    return buildNodeSelectOption({
      ...(execution === undefined ? {} : { execution }),
      kind,
      nodeId,
      payload,
      ...(purpose === undefined ? {} : { purpose }),
      scopeLabel: subworkflow.id,
      value: nodeId,
      visualMetadataByNodeId,
    });
  });
}

export function buildSubworkflowListOptions(
  workflow: LoadedWorkflow | undefined,
  subworkflowId: string | undefined,
): ReadonlyArray<{
  readonly description: string;
  readonly name: string;
  readonly value: string;
}> {
  if (workflow === undefined || subworkflowId === undefined) {
    return [];
  }
  return resolveDirectChildSubworkflows({
    parentSubworkflowId: subworkflowId,
    workflow: workflow.bundle.workflow,
  }).map((entry) => ({
    name: entry.id,
    description: `${truncate(entry.description, 92)}  manager: ${entry.managerNodeId}`,
    value: entry.id,
  }));
}

export function buildSummaryJsonSelectOptions(input: {
  readonly agentSessionSelection?: DetailAgentSessionSelection;
  readonly bundle: NodeDetailArtifactBundle;
}): ReadonlyArray<{
  readonly description: string;
  readonly name: string;
  readonly value: DetailAgentSessionSelection | DetailJsonViewerSelection;
}> {
  const execIn = summarizeJsonBlock(input.bundle.artifactInput);
  const inbox = summarizeJsonBlock(input.bundle.mailboxInput);
  const execOut = summarizeJsonBlock(input.bundle.artifactOutput);
  const mOut = summarizeJsonBlock(input.bundle.mailboxOutput);
  return [
    ...(input.agentSessionSelection === undefined
      ? []
      : [
          {
            name: input.agentSessionSelection.title,
            description:
              input.agentSessionSelection.available !== true
                ? "backend session id is unavailable for this node execution"
                : `sessionId: ${input.agentSessionSelection.sessionId ?? "(missing)"}`,
            value: input.agentSessionSelection,
          },
        ]),
    {
      name: "Execution input (input.json)",
      description: execIn.preview,
      value: {
        kind: "json-viewer",
        title: "Execution input (input.json)",
        body: execIn.full,
      },
    },
    {
      name: "Inbox message (mailbox inbox/input.json)",
      description: inbox.preview,
      value: {
        kind: "json-viewer",
        title: "Inbox message (mailbox inbox/input.json)",
        body: inbox.full,
      },
    },
    {
      name: "Execution output (output.json)",
      description: execOut.preview,
      value: {
        kind: "json-viewer",
        title: "Execution output (output.json)",
        body: execOut.full,
      },
    },
    {
      name: "Outbox message (mailbox outbox/output.json)",
      description: mOut.preview,
      value: {
        kind: "json-viewer",
        title: "Outbox message (mailbox outbox/output.json)",
        body: mOut.full,
      },
    },
  ];
}

export function buildSummaryDetailHeaderText(input: {
  readonly loadedWorkflow: LoadedWorkflow;
  readonly inputDetection: TuiWorkflowInputDetection;
  readonly nodeLogs: readonly RuntimeNodeLogEntry[];
  readonly selectedExecution: NodeExecutionRecord;
  readonly session: WorkflowSessionState;
}): string {
  const kind = resolveNodeKind(
    input.loadedWorkflow.bundle.workflow,
    input.selectedExecution.nodeId,
  );
  const managerSessionId = resolveManagerSessionId(
    input.loadedWorkflow.bundle.workflow,
    input.selectedExecution,
  );
  const nodeLogs = input.nodeLogs.filter(
    (entry) => entry.nodeExecId === input.selectedExecution.nodeExecId,
  );
  return [
    `Workflow run: ${input.session.sessionId} status=${input.session.status}`,
    `Node: ${input.selectedExecution.nodeId} [${kind}] status=${input.selectedExecution.status}`,
    `Node execution: ${input.selectedExecution.nodeExecId}`,
    `Artifact dir: ${input.selectedExecution.artifactDir}`,
    `Backend session: ${input.selectedExecution.backendSessionId ?? "(none)"}`,
    `Manager session: ${managerSessionId ?? "(not a manager node)"}`,
    `Current node: ${input.session.currentNodeId ?? "-"}`,
    `Queue: ${input.session.queue.join(",") || "-"}`,
    `Input mode: ${input.inputDetection.mode}`,
    `Input hint: ${input.inputDetection.reason}`,
    "",
    "Recent node logs:",
    formatLogEntries(nodeLogs, 12),
  ].join("\n");
}

export function resolveManagerSessionId(
  workflow: LoadedWorkflow["bundle"]["workflow"],
  execution: NodeExecutionRecord,
): string | undefined {
  const kind = resolveNodeKind(workflow, execution.nodeId);
  if (kind !== "root-manager" && kind !== "subworkflow-manager") {
    return undefined;
  }
  return `mgrsess-${execution.nodeExecId}`;
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

export function buildWorkflowRunStatusContent(input: {
  readonly completionResult?: {
    readonly exitCode: number;
    readonly sessionId: string;
    readonly status: WorkflowSessionState["status"];
  };
  readonly loadedWorkflow: LoadedWorkflow | undefined;
  readonly runtimeSessionView: RuntimeSessionView | undefined;
  readonly sessionId?: string;
  readonly statusError?: string;
}): string {
  if (input.loadedWorkflow === undefined) {
    return "Select a workflow before starting a run.";
  }

  if (input.runtimeSessionView === undefined) {
    return [
      `Workflow: ${input.loadedWorkflow.workflowName}`,
      `Input mode: ${detectWorkflowInputMode(input.loadedWorkflow).mode}`,
      `Pending session: ${input.sessionId ?? "(not started)"}`,
      input.statusError ?? "No run started yet.",
      "Press enter or ctrl-m from the input area to review and confirm the launch.",
    ].join("\n");
  }

  const session = input.runtimeSessionView.session;
  const finalResult = resolveWorkflowFinalResult(input.runtimeSessionView);

  return [
    `Workflow: ${session.workflowName}`,
    `Session: ${session.sessionId} status=${session.status}`,
    `Current node: ${session.currentNodeId ?? "-"}`,
    `Queue: ${session.queue.join(",") || "-"}`,
    `Node executions: ${String(session.nodeExecutions.length)}`,
    ...(session.lastError === undefined
      ? []
      : [`Last error: ${session.lastError}`]),
    ...(input.statusError === undefined
      ? []
      : [`Status refresh note: ${input.statusError}`]),
    ...(input.completionResult === undefined
      ? []
      : [
          `Completion: exitCode=${String(
            input.completionResult.exitCode,
          )} status=${input.completionResult.status}`,
        ]),
    "",
    "Recent logs:",
    formatLogEntries(input.runtimeSessionView.nodeLogs, 18),
    ...(finalResult === undefined
      ? []
      : ["", "Final result:", compactJson(finalResult, 4_000)]),
  ].join("\n");
}

export function buildWorkflowHistoryStatusMessage(input: {
  readonly busy: boolean;
  readonly detailMode: DetailMode;
  readonly editingInput: boolean;
  readonly filterText: string;
  readonly focusPane: FocusPane;
  readonly inputSyntax: TuiWorkflowInputSyntax;
  readonly matchesCount: number;
  readonly screenMode: ScreenMode;
  readonly workflowCount: number;
  readonly workflowInputDetection: TuiWorkflowInputDetection;
  readonly historyViewMode: HistoryViewMode;
  readonly message: string;
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
