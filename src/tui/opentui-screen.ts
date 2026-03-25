import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CliIo } from "../cli";
import { resolveNodeExecutionMailboxArtifactPaths } from "../workflow/node-execution-mailbox";
import type { LoadedWorkflow } from "../workflow/load";
import type { ManagerMessageRecord } from "../workflow/manager-session-store";
import type {
  NodeExecutionRecord,
  WorkflowSessionState,
} from "../workflow/session";
import type {
  RuntimeNodeExecutionSummary,
  RuntimeNodeLogEntry,
  RuntimeSessionSummary,
} from "../workflow/runtime-db";
import type { ArgumentBinding, NodePayload } from "../workflow/types";
import { deriveWorkflowVisualization } from "../workflow/visualization";
import {
  BoxRenderable,
  bold,
  brightCyan,
  brightGreen,
  brightMagenta,
  brightWhite,
  brightYellow,
  createCliRenderer,
  dim,
  KeyEvent,
  type OptimizedBuffer,
  type RGBA,
  ScrollBoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  StyledText,
  TextareaRenderable,
  TextRenderable,
  t,
  type SelectOption,
} from "@opentui/core";

interface RuntimeSessionView {
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

export interface OpenTuiWorkflowSelection {
  readonly type: "selected" | "quit";
  readonly workflowName?: string;
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
  readonly loadWorkflowDefinition: (workflowName: string) => Promise<LoadedWorkflow>;
  readonly listWorkflowSessions: (
    workflowName: string,
  ) => Promise<readonly RuntimeSessionSummary[]>;
  readonly loadRuntimeSessionView: (
    sessionId: string,
  ) => Promise<RuntimeSessionView>;
  readonly loadManagerSessionMessages: (
    managerSessionId: string,
  ) => Promise<readonly ManagerMessageRecord[]>;
  readonly executeWorkflow: (input: {
    readonly workflowName: string;
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
  }) => Promise<OpenTuiWorkflowExecutionHandle>;
  readonly rerunWorkflow: (input: {
    readonly sourceSessionId: string;
    readonly fromNodeId: string;
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
  }) => Promise<OpenTuiWorkflowActionResult>;
  readonly resumeWorkflow: (
    sessionId: string,
  ) => Promise<OpenTuiWorkflowActionResult>;
}

interface OpenTuiPaneWidthSpec {
  readonly minWidth: number;
  readonly width: `${number}%`;
}

export const OPEN_TUI_SELECTOR_PANE_LAYOUT = {
  details: { width: "35%", minWidth: 0 },
  timeline: { width: "35%", minWidth: 0 },
  workflows: { width: "30%", minWidth: 20 },
} as const satisfies Readonly<Record<string, OpenTuiPaneWidthSpec>>;

export const OPEN_TUI_MAIN_PANE_LAYOUT = {
  details: { width: "30%", minWidth: 0 },
  nodes: { width: "22%", minWidth: 18 },
  sessions: { width: "28%", minWidth: 18 },
  workflows: { width: "20%", minWidth: 16 },
} as const satisfies Readonly<Record<string, OpenTuiPaneWidthSpec>>;

type FocusPane = "detail" | "input" | "nodes" | "sessions" | "workflows";
type DetailMode =
  | "inbox"
  | "manager"
  | "outbox"
  | "session-logs"
  | "summary"
  | "viewer";
type ShortcutKeyEvent = Pick<KeyEvent, "ctrl" | "meta" | "name" | "shift">;
type ScreenMode = "history" | "run" | "workspace";
type HistoryPaneNavigationMode = "list" | "scroll" | "typing";

interface BlurredSelectIndicatorLayout {
  readonly fontHeight: number;
  readonly linesPerItem: number;
  readonly maxVisibleItems: number;
  readonly selectedOption: SelectOption;
  readonly scrollOffset: number;
  readonly showDescription: boolean;
  readonly selectedIndex: number;
}

interface FocusAwareSelectPrivateState {
  readonly _backgroundColor: RGBA;
  readonly _descriptionColor: RGBA;
  readonly _font: string | undefined;
  readonly _options: readonly SelectOption[];
  readonly _selectedIndex: number;
  readonly _showDescription: boolean;
  readonly _textColor: RGBA;
  readonly fontHeight: number;
  readonly linesPerItem: number;
  readonly maxVisibleItems: number;
  readonly scrollOffset: number;
}

interface BlurredSelectRedrawTarget {
  readonly descriptionY: number | undefined;
  readonly name: string;
  readonly nameY: number;
}

export function resolveBlurredSelectRedrawTarget(
  input: BlurredSelectIndicatorLayout,
): BlurredSelectRedrawTarget | undefined {
  const visibleIndex = input.selectedIndex - input.scrollOffset;
  if (visibleIndex < 0 || visibleIndex >= input.maxVisibleItems) {
    return undefined;
  }
  const nameY = visibleIndex * input.linesPerItem;
  return {
    descriptionY: input.showDescription ? nameY + input.fontHeight : undefined,
    name: `  ${input.selectedOption.name}`,
    nameY,
  };
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

class FocusAwareSelectRenderable extends SelectRenderable {
  protected override renderSelf(
    buffer: OptimizedBuffer,
    deltaTime: number,
  ): void {
    super.renderSelf(buffer, deltaTime);
    this.hideSelectionArrowWhenBlurred();
  }

  private hideSelectionArrowWhenBlurred(): void {
    if (this.focused || this.frameBuffer === null) {
      return;
    }
    const state = this as unknown as FocusAwareSelectPrivateState;
    if (state._options.length === 0 || state._font !== undefined) {
      return;
    }
    const selectedOption = state._options[state._selectedIndex];
    if (selectedOption === undefined) {
      return;
    }
    const redrawTarget = resolveBlurredSelectRedrawTarget({
      fontHeight: state.fontHeight,
      linesPerItem: state.linesPerItem,
      maxVisibleItems: state.maxVisibleItems,
      selectedOption,
      scrollOffset: state.scrollOffset,
      showDescription: state._showDescription,
      selectedIndex: state._selectedIndex,
    });
    if (redrawTarget === undefined || redrawTarget.nameY >= this.height) {
      return;
    }
    this.frameBuffer.fillRect(
      0,
      redrawTarget.nameY,
      this.width,
      Math.min(state.linesPerItem, this.height - redrawTarget.nameY),
      state._backgroundColor,
    );
    this.frameBuffer.drawText(redrawTarget.name, 1, redrawTarget.nameY, state._textColor);
    if (
      redrawTarget.descriptionY !== undefined &&
      redrawTarget.descriptionY < this.height
    ) {
      this.frameBuffer.drawText(
        selectedOption.description,
        3,
        redrawTarget.descriptionY,
        state._descriptionColor,
      );
    }
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function compactJson(value: unknown, maxLength = 140): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return "null";
  }
  return truncate(serialized, maxLength);
}

function summarizeLines(value: string | null, maxLength = 600): string {
  if (value === null) {
    return "(not found)";
  }
  return truncate(value.trim().length === 0 ? "(empty)" : value.trim(), maxLength);
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
export function resolveSelectedWorkflowName(
  selectedIndex: number,
  workflowNames: readonly string[],
): string | undefined {
  if (selectedIndex < 0 || selectedIndex >= workflowNames.length) {
    return undefined;
  }
  return workflowNames[selectedIndex];
}

function normalizeWorkflowFilterText(value: string): string {
  return value.replace(/\r?\n/g, "").trim();
}

export function filterWorkflowNames(
  workflowNames: readonly string[],
  filterText: string,
): readonly string[] {
  const normalizedFilter = normalizeWorkflowFilterText(filterText).toLowerCase();
  if (normalizedFilter.length === 0) {
    return [...workflowNames];
  }
  return workflowNames.filter((name) =>
    name.toLowerCase().includes(normalizedFilter),
  );
}

function looksLikeStructuredHumanInputBinding(binding: ArgumentBinding): boolean {
  if (binding.source !== "human-input") {
    return false;
  }
  if (binding.sourcePath === undefined || binding.sourcePath.trim().length === 0) {
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

export function detectWorkflowInputMode(
  loaded: Pick<LoadedWorkflow, "bundle" | "workflowName">,
): TuiWorkflowInputDetection {
  const workflow = loaded.bundle.workflow;
  const inputNodeIds = new Set(
    workflow.subWorkflows.map((subWorkflow) => subWorkflow.inputNodeId),
  );
  const inputPayloads = workflow.nodes
    .filter(
      (node) => node.kind === "input" || inputNodeIds.has(node.id),
    )
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
    reason: "defaulted to plain text because the workflow definition has no clear JSON-only hint",
  };
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
      ? runtimeVariables["rerunPrompt"] ??
        runtimeVariables["promptJson"] ??
        runtimeVariables["userPromptJson"] ??
        runtimeVariables["humanInput"] ??
        runtimeVariables["prompt"] ??
        runtimeVariables["userPrompt"]
      : runtimeVariables["rerunPrompt"] ??
        runtimeVariables["humanInput"] ??
        runtimeVariables["prompt"] ??
        runtimeVariables["userPrompt"] ??
        runtimeVariables["promptJson"] ??
        runtimeVariables["userPromptJson"];
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
      typeof parsedValue === "string" ? parsedValue : compactJson(parsedValue, 20_000);
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

function resolveNodeKind(
  workflow: LoadedWorkflow["bundle"]["workflow"],
  nodeId: string,
): string {
  return workflow.nodes.find((entry) => entry.id === nodeId)?.kind ?? "task";
}

function resolveManagerSessionId(
  workflow: LoadedWorkflow["bundle"]["workflow"],
  execution: NodeExecutionRecord,
): string | undefined {
  const kind = resolveNodeKind(workflow, execution.nodeId);
  if (kind !== "root-manager" && kind !== "subworkflow-manager") {
    return undefined;
  }
  return `mgrsess-${execution.nodeExecId}`;
}

const EMPTY_SELECT = "__opentui_empty__";

function workflowNamesToSelectOptions(
  workflowNames: readonly string[],
): SelectOption[] {
  if (workflowNames.length === 0) {
    return [
      { name: "(no workflows found)", description: "", value: EMPTY_SELECT },
    ];
  }
  return workflowNames.map((name) => ({
    name,
    description: "",
    value: name,
  }));
}

function summarizePromptHelp(promptTemplate: string | undefined): string | undefined {
  if (promptTemplate === undefined) {
    return undefined;
  }
  const normalized = promptTemplate
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return normalized === undefined ? undefined : truncate(normalized, 120);
}

function summarizeNodeType(
  kind: string,
  payload: NodePayload | undefined,
): string {
  const nodeType = payload?.nodeType ?? "agent";
  return `${kind}/${nodeType}`;
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

function buildWorkflowNodePreview(
  loaded: LoadedWorkflow,
): StyledText {
  const derivedNodes = deriveWorkflowVisualization({
    workflow: loaded.bundle.workflow,
    workflowVis: loaded.bundle.workflowVis,
  });
  const nodeRefById = new Map(
    loaded.bundle.workflow.nodes.map((node) => [node.id, node] as const),
  );
  const subWorkflowByNodeId = new Map<string, string>();
  const subWorkflowScopeNodeIds = new Set<string>();
  loaded.bundle.workflow.subWorkflows.forEach((subWorkflow) => {
    subWorkflowScopeNodeIds.add(subWorkflow.managerNodeId);
    subWorkflowScopeNodeIds.add(subWorkflow.inputNodeId);
    subWorkflowScopeNodeIds.add(subWorkflow.outputNodeId);
    subWorkflow.nodeIds.forEach((nodeId) => {
      subWorkflowByNodeId.set(nodeId, subWorkflow.description);
      subWorkflowScopeNodeIds.add(nodeId);
    });
  });
  const chunks: StyledText["chunks"] = [];

  const append = (value: StyledText): void => {
    chunks.push(...value.chunks);
  };

  const nodeTitle = (nodeId: string, kind: string) => {
    if (kind === "root-manager") {
      return brightMagenta(bold(nodeId));
    }
    if (kind === "subworkflow-manager") {
      return brightCyan(bold(nodeId));
    }
    if (kind === "input") {
      return brightGreen(bold(nodeId));
    }
    if (kind === "output") {
      return brightYellow(bold(nodeId));
    }
    return brightWhite(bold(nodeId));
  };

  derivedNodes.forEach((entry, index) => {
    const nodeRef = nodeRefById.get(entry.id);
    const payload =
      nodeRef === undefined
        ? undefined
        : loaded.bundle.nodePayloads[nodeRef.nodeFile];
    const kind = nodeRef?.kind ?? "task";
    const previewIndent = resolveWorkflowPreviewIndent({
      derivedIndent: entry.indent,
      inSubworkflowScope: subWorkflowScopeNodeIds.has(entry.id),
      kind,
    });
    const indent = "  ".repeat(previewIndent);
    const details = [
      `type: ${summarizeNodeType(kind, payload)}`,
      ...(payload?.executionBackend === undefined
        ? []
        : [`backend: ${payload.executionBackend}`]),
      ...(payload?.model === undefined ? [] : [`model: ${payload.model}`]),
    ].join("  ");
    const purpose =
      payload?.description ??
      payload?.output?.description ??
      subWorkflowByNodeId.get(entry.id) ??
      summarizePromptHelp(payload?.promptTemplate);

    append(t`${dim(`${indent}----------------------------------------\n`)}`);
    append(t`${indent}${nodeTitle(entry.id, kind)}\n`);
    append(t`${dim(`${indent}${details}\n`)}`);
    if (purpose !== undefined) {
      append(t`${indent}${brightWhite("purpose:")} ${purpose}\n`);
    }
    if (kind === "root-manager") {
      append(
        t`${indent}${brightWhite("workflow id:")} ${loaded.bundle.workflow.workflowId}\n`,
      );
    }
    if (index === derivedNodes.length - 1) {
      append(t`${dim(`${indent}----------------------------------------`)}`);
    }
  });

  return new StyledText(chunks);
}

function buildSessionSelectOptions(
  sessions: readonly RuntimeSessionSummary[],
): SelectOption[] {
  if (sessions.length === 0) {
    return [
      {
        name: "(no workflow runs)",
        description: "",
        value: EMPTY_SELECT,
      },
    ];
  }
  return sessions.map((session) => {
    return {
      name: `[${session.status.toUpperCase()}] ${session.startedAt}`,
      description: `run id: ${session.sessionId}`,
      value: session.sessionId,
    };
  });
}

function buildNodeSelectOptions(
  workflow: LoadedWorkflow | undefined,
  session: WorkflowSessionState | undefined,
): SelectOption[] {
  if (workflow === undefined || session === undefined) {
    return [];
  }
  if (session.nodeExecutions.length === 0) {
    return [];
  }
  return session.nodeExecutions.map((execution) => {
    const kind = resolveNodeKind(workflow.bundle.workflow, execution.nodeId);
    return {
      name: `[${execution.status.toUpperCase()}] ${execution.nodeId}`,
      description: `kind: ${kind}  exec: ${execution.nodeExecId}`,
      value: execution.nodeExecId,
    };
  });
}

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

const SUMMARY_JSON_PREVIEW_LINES = 14;

interface NodeDetailArtifactBundle {
  readonly artifactInput: string | null;
  readonly artifactOutput: string | null;
  readonly artifactMeta: string | null;
  readonly mailboxMeta: string | null;
  readonly mailboxInput: string | null;
  readonly mailboxOutput: string | null;
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

function summarizeJsonBlock(raw: string | null): { full: string; preview: string } {
  const full = formatJsonForDisplay(raw);
  const preview = takeFirstLines(full, SUMMARY_JSON_PREVIEW_LINES);
  return { full, preview };
}

function buildSummaryJsonSelectOptions(
  bundle: NodeDetailArtifactBundle,
): SelectOption[] {
  const execIn = summarizeJsonBlock(bundle.artifactInput);
  const inbox = summarizeJsonBlock(bundle.mailboxInput);
  const execOut = summarizeJsonBlock(bundle.artifactOutput);
  const mOut = summarizeJsonBlock(bundle.mailboxOutput);
  return [
    {
      name: "Execution input (input.json)",
      description: execIn.preview,
      value: execIn.full,
    },
    {
      name: "Inbox message (mailbox inbox/input.json)",
      description: inbox.preview,
      value: inbox.full,
    },
    {
      name: "Execution output (output.json)",
      description: execOut.preview,
      value: execOut.full,
    },
    {
      name: "Outbox message (mailbox outbox/output.json)",
      description: mOut.preview,
      value: mOut.full,
    },
  ];
}

async function loadNodeExecutionArtifacts(
  sessionView: RuntimeSessionView,
  selectedExecution: NodeExecutionRecord,
): Promise<NodeDetailArtifactBundle> {
  const runtimeExecution = sessionView.nodeExecutions.find(
    (entry) => entry.nodeExecId === selectedExecution.nodeExecId,
  );
  const mailboxPaths = resolveNodeExecutionMailboxArtifactPaths(
    selectedExecution.artifactDir,
  );
  const mailboxOutPath = path.join(mailboxPaths.outboxDir, "output.json");
  const [
    artifactInput,
    artifactOutputRaw,
    artifactMeta,
    mailboxMeta,
    mailboxInput,
    mailboxOutput,
  ] = await Promise.all([
    readOptionalText(path.join(selectedExecution.artifactDir, "input.json")),
    Promise.resolve(runtimeExecution?.outputJson ?? null).then(
      async (runtimeOutput) =>
        runtimeOutput ??
        readOptionalText(path.join(selectedExecution.artifactDir, "output.json")),
    ),
    readOptionalText(path.join(selectedExecution.artifactDir, "meta.json")),
    readOptionalText(mailboxPaths.metaPath),
    readOptionalText(mailboxPaths.inputPath),
    readOptionalText(mailboxOutPath),
  ]);
  return {
    artifactInput,
    artifactOutput: artifactOutputRaw,
    artifactMeta,
    mailboxMeta,
    mailboxInput,
    mailboxOutput,
  };
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

function formatCommunications(
  title: string,
  communications: readonly WorkflowSessionState["communications"][number][],
): string {
  if (communications.length === 0) {
    return `${title}:\n(none)`;
  }
  return [
    `${title}:`,
    ...communications.map(
      (communication) =>
        `- ${communication.communicationId} ${communication.fromNodeId} -> ${communication.toNodeId} ` +
        `[${communication.deliveryKind}] status=${communication.status}`,
    ),
  ].join("\n");
}

async function buildDetailContent(input: {
  readonly detailMode: DetailMode;
  readonly inputDetection: TuiWorkflowInputDetection;
  readonly loadedWorkflow: LoadedWorkflow | undefined;
  readonly managerMessages: readonly ManagerMessageRecord[];
  readonly runtimeSessionView: RuntimeSessionView | undefined;
  readonly selectedNodeExecution: NodeExecutionRecord | undefined;
}): Promise<string> {
  if (input.loadedWorkflow === undefined) {
    return "";
  }

  if (input.runtimeSessionView === undefined) {
    return "";
  }

  const sessionView = input.runtimeSessionView;
  const session = sessionView.session;

  if (input.detailMode === "session-logs") {
    return [
      `Workflow run logs for ${session.sessionId}`,
      "",
      formatLogEntries(sessionView.nodeLogs, 200),
    ].join("\n");
  }

  const selectedExecution =
    input.selectedNodeExecution ?? session.nodeExecutions.at(-1);

  if (selectedExecution === undefined) {
    return "";
  }

  if (input.detailMode === "summary") {
    return "";
  }

  const managerSessionId = resolveManagerSessionId(
    input.loadedWorkflow.bundle.workflow,
    selectedExecution,
  );
  const bundle = await loadNodeExecutionArtifacts(sessionView, selectedExecution);
  const { artifactInput, artifactOutput, artifactMeta, mailboxMeta, mailboxInput } =
    bundle;
  const inboundCommunications = session.communications.filter(
    (communication) => communication.consumedByNodeExecId === selectedExecution.nodeExecId,
  );
  const outboundCommunications = session.communications.filter(
    (communication) => communication.sourceNodeExecId === selectedExecution.nodeExecId,
  );

  if (input.detailMode === "inbox") {
    return [
      `Inbox for ${selectedExecution.nodeId} / ${selectedExecution.nodeExecId}`,
      "",
      "Mailbox meta.json:",
      summarizeLines(mailboxMeta, 8_000),
      "",
      "Mailbox inbox/input.json:",
      summarizeLines(mailboxInput, 8_000),
      "",
      "Execution input.json:",
      summarizeLines(artifactInput, 8_000),
      "",
      formatCommunications("Inbound communications", inboundCommunications),
    ].join("\n");
  }

  if (input.detailMode === "outbox") {
    return [
      `Outbox for ${selectedExecution.nodeId} / ${selectedExecution.nodeExecId}`,
      "",
      "Execution output.json:",
      summarizeLines(artifactOutput, 8_000),
      "",
      "Execution meta.json:",
      summarizeLines(artifactMeta, 8_000),
      "",
      formatCommunications("Outbound communications", outboundCommunications),
    ].join("\n");
  }

  if (input.detailMode === "manager") {
    return [
      `Manager session for ${selectedExecution.nodeId} / ${selectedExecution.nodeExecId}`,
      `managerSessionId: ${managerSessionId ?? "(not a manager node)"}`,
      "",
      input.managerMessages.length === 0
        ? "(no manager-session messages)"
        : input.managerMessages
            .map((message) => {
              const summary =
                message.message === undefined || message.message.length === 0
                  ? "(empty message)"
                  : truncate(message.message, 600);
              return [
                `- ${message.createdAt} ${message.managerMessageId}`,
                `  accepted=${String(message.accepted)} intents=${compactJson(message.parsedIntent, 500)}`,
                `  message=${summary}`,
              ].join("\n");
            })
            .join("\n"),
    ].join("\n");
  }

  return "";
}

function buildWorkflowSummaryPreview(
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

function buildWorkflowHistoryHeader(
  loadedWorkflow: LoadedWorkflow | undefined,
): StyledText {
  if (loadedWorkflow === undefined) {
    return t`${dim("No workflow loaded.")}`;
  }
  return t`${brightCyan(bold(loadedWorkflow.bundle.workflow.workflowId))}\n${brightWhite(
    loadedWorkflow.bundle.workflow.description,
  )}\n${dim(
    `nodes=${String(loadedWorkflow.bundle.workflow.nodes.length)}  subworkflows=${String(
      loadedWorkflow.bundle.workflow.subWorkflows.length,
    )}`,
  )}`;
}

function buildSummaryDetailHeaderText(input: {
  readonly session: WorkflowSessionState;
  readonly selectedExecution: NodeExecutionRecord;
  readonly loadedWorkflow: LoadedWorkflow;
  readonly inputDetection: TuiWorkflowInputDetection;
  readonly nodeLogs: readonly RuntimeNodeLogEntry[];
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

function paneTitle(label: string, active: boolean): string {
  return active ? ` >> ${label} << ` : ` ${label} `;
}

function paneBorderColor(active: boolean): string {
  return active ? "#4fd1ff" : "#5b6670";
}

function paneBackgroundColor(active: boolean): string {
  return active ? "#101a22" : "transparent";
}

function popupBackgroundColor(): string {
  return "#0d141b";
}

function resolveWorkflowFinalResult(
  runtimeSessionView: RuntimeSessionView | undefined,
): unknown {
  const workflowOutput = runtimeSessionView?.session.runtimeVariables["workflowOutput"];
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

export function buildWorkflowRunStatusContent(input: {
  readonly completionResult?: OpenTuiWorkflowActionResult;
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
    ...(session.lastError === undefined ? [] : [`Last error: ${session.lastError}`]),
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

function buildRunConfirmationContent(input: {
  readonly inputMode: TuiWorkflowInputMode;
  readonly inputSyntax: TuiWorkflowInputSyntax;
  readonly workflowName: string;
  readonly editorText: string;
}): string {
  return [
    `Start workflow '${input.workflowName}'?`,
    `Input mode: ${input.inputMode}`,
    `Input syntax: ${input.inputSyntax.summary}`,
    "",
    "Preview:",
    truncate(
      input.editorText.trim().length === 0 ? "{}" : input.editorText.trim(),
      1_600,
    ),
    "",
    "Press enter or ctrl-m to confirm. Esc cancels.",
  ].join("\n");
}

const selectJkBindings = [
  { name: "j", action: "move-down" as const },
  { name: "k", action: "move-up" as const },
];

export function isOpenTuiRefreshKey(key: ShortcutKeyEvent): boolean {
  return key.name === "r" && key.shift && !key.ctrl && !key.meta;
}

export function isOpenTuiHelpKey(key: ShortcutKeyEvent): boolean {
  return (
    !key.ctrl &&
    !key.meta &&
    ((key.name === "?" && !key.shift) || (key.name === "/" && key.shift))
  );
}

export async function renderOpenTuiWorkflowSelector(options: {
  workflowNames: readonly string[];
  refreshWorkflowNames: () => Promise<readonly string[]>;
  io: CliIo;
}): Promise<OpenTuiWorkflowSelection> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useAlternateScreen: true,
  });

  const root = new BoxRenderable(renderer, {
    flexDirection: "column",
    width: "100%",
    height: "100%",
  });

  const topRow = new BoxRenderable(renderer, {
    flexDirection: "row",
    flexGrow: 7,
    width: "100%",
  });

  const workflowPane = new BoxRenderable(renderer, {
    width: OPEN_TUI_SELECTOR_PANE_LAYOUT.workflows.width,
    minWidth: OPEN_TUI_SELECTOR_PANE_LAYOUT.workflows.minWidth,
    height: "100%",
    border: true,
    title: " Workflows ",
    flexDirection: "column",
  });
  const workflowSelect = new FocusAwareSelectRenderable(renderer, {
    id: "sel-workflow",
    showDescription: false,
    flexGrow: 1,
    width: "100%",
    height: "100%",
    keyBindings: selectJkBindings,
  });
  workflowPane.add(workflowSelect);

  const timelineBox = new BoxRenderable(renderer, {
    border: true,
    title: " Timeline ",
    width: OPEN_TUI_SELECTOR_PANE_LAYOUT.timeline.width,
    minWidth: OPEN_TUI_SELECTOR_PANE_LAYOUT.timeline.minWidth,
    height: "100%",
  });
  timelineBox.add(
    new TextRenderable(renderer, {
      flexGrow: 1,
      content: "Execution timeline will appear after run starts.",
    }),
  );

  const detailsBox = new BoxRenderable(renderer, {
    border: true,
    title: " Details ",
    width: OPEN_TUI_SELECTOR_PANE_LAYOUT.details.width,
    minWidth: OPEN_TUI_SELECTOR_PANE_LAYOUT.details.minWidth,
    height: "100%",
  });
  detailsBox.add(
    new TextRenderable(renderer, {
      flexGrow: 1,
      content: "Select workflow with j/k and press enter.",
    }),
  );

  topRow.add(workflowPane);
  topRow.add(timelineBox);
  topRow.add(detailsBox);

  const bottomRow = new BoxRenderable(renderer, {
    border: true,
    title: " Logs / Keys ",
    flexGrow: 3,
    width: "100%",
  });
  bottomRow.add(
    new TextRenderable(renderer, {
      content: "j/k: move  enter: select  r: refresh  q: quit",
    }),
  );

  root.add(topRow);
  root.add(bottomRow);
  renderer.root.add(root);

  let workflowNames = [...options.workflowNames];
  const updateWorkflows = (names: readonly string[]): void => {
    workflowNames = [...names];
    workflowSelect.options = workflowNamesToSelectOptions(workflowNames);
    workflowSelect.setSelectedIndex(0);
    renderer.requestRender();
  };
  updateWorkflows(workflowNames);

  renderer.start();
  renderer.focusRenderable(workflowSelect);

  return await new Promise<OpenTuiWorkflowSelection>((resolve) => {
    const complete = (result: OpenTuiWorkflowSelection): void => {
      renderer.keyInput.removeListener("keypress", onKey);
      renderer.destroy();
      resolve(result);
    };

    workflowSelect.on(SelectRenderableEvents.ITEM_SELECTED, (_idx, opt) => {
      const v = opt?.value;
      if (v === undefined || v === EMPTY_SELECT) {
        return;
      }
      complete({ type: "selected", workflowName: String(v) });
    });

    const onKey = (key: KeyEvent): void => {
      if (key.eventType !== "press") {
        return;
      }
      if (key.name === "q" && !key.ctrl && !key.meta) {
        key.preventDefault();
        complete({ type: "quit" });
        return;
      }
      if (key.name === "c" && key.ctrl) {
        key.preventDefault();
        complete({ type: "quit" });
        return;
      }
      if (key.name === "r" && !key.ctrl && !key.meta) {
        key.preventDefault();
        void (async () => {
          try {
            updateWorkflows(await options.refreshWorkflowNames());
          } catch (error: unknown) {
            const message =
              error instanceof Error ? error.message : "unknown error";
            options.io.stderr(`tui refresh failed: ${message}`);
          }
        })();
      }
    };

    renderer.keyInput.prependListener("keypress", onKey);
    renderer.requestRender();
  });
}

export async function runOpenTuiWorkflowApp(
  options: OpenTuiWorkflowAppOptions,
): Promise<number> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useAlternateScreen: true,
  });

  const root = new BoxRenderable(renderer, {
    flexDirection: "column",
    width: "100%",
    height: "100%",
  });

  const selectorRow = new BoxRenderable(renderer, {
    flexDirection: "row",
    flexGrow: 1,
    width: "100%",
  });
  const workflowPane = new BoxRenderable(renderer, {
    width: "40%",
    minWidth: 20,
    height: "100%",
    border: true,
    title: " Workflows ",
    borderColor: "#5b6670",
    focusedBorderColor: "#4fd1ff",
    flexDirection: "column",
  });
  const workflowSelect = new FocusAwareSelectRenderable(renderer, {
    id: "wf-select",
    showDescription: false,
    flexGrow: 1,
    width: "100%",
    height: "100%",
    keyBindings: selectJkBindings,
  });
  workflowPane.add(workflowSelect);
  const selectorPreviewScroll = new ScrollBoxRenderable(renderer, {
    id: "selector-preview-scroll",
    width: "60%",
    minWidth: 20,
    height: "100%",
    border: true,
    title: " Workflow Preview ",
    borderColor: "#5b6670",
    scrollY: true,
  });
  const selectorPreviewText = new TextRenderable(renderer, {
    id: "selector-preview-text",
    flexGrow: 1,
    width: "100%",
    content: "",
  });
  selectorPreviewScroll.content.add(selectorPreviewText);
  selectorRow.add(workflowPane);
  selectorRow.add(selectorPreviewScroll);

  const historyScreen = new BoxRenderable(renderer, {
    flexDirection: "column",
    flexGrow: 1,
    width: "100%",
  });
  const historyHeaderBox = new BoxRenderable(renderer, {
    width: "100%",
    border: true,
    title: " Workflow ",
    borderColor: "#5b6670",
    padding: 1,
    flexGrow: 4,
  });
  const historyHeaderText = new TextRenderable(renderer, {
    id: "history-header-text",
    flexGrow: 1,
    width: "100%",
    content: "",
  });
  historyHeaderBox.add(historyHeaderText);
  const historyTopRow = new BoxRenderable(renderer, {
    flexDirection: "row",
    flexGrow: 18,
    width: "100%",
  });
  const sessionPane = new BoxRenderable(renderer, {
    width: "56%",
    minWidth: 18,
    height: "100%",
    border: true,
    title: " Workflow Runs ",
    borderColor: "#5b6670",
    focusedBorderColor: "#4fd1ff",
    flexDirection: "column",
  });
  const sessionSelect = new FocusAwareSelectRenderable(renderer, {
    id: "sess-select",
    showDescription: true,
    flexGrow: 1,
    width: "100%",
    height: "100%",
    itemSpacing: 1,
    selectedBackgroundColor: "#1f3447",
    selectedTextColor: "#f7d774",
    descriptionColor: "#89a5ba",
    selectedDescriptionColor: "#d8e5f2",
    keyBindings: selectJkBindings,
  });
  sessionPane.add(sessionSelect);
  const nodePane = new BoxRenderable(renderer, {
    width: "44%",
    minWidth: 18,
    height: "100%",
    border: true,
    title: " Nodes ",
    borderColor: "#5b6670",
    focusedBorderColor: "#4fd1ff",
    flexDirection: "column",
  });
  const nodeSelect = new FocusAwareSelectRenderable(renderer, {
    id: "node-select",
    showDescription: true,
    flexGrow: 1,
    width: "100%",
    height: "100%",
    itemSpacing: 1,
    selectedBackgroundColor: "#243a2d",
    selectedTextColor: "#e8f29a",
    descriptionColor: "#8eb49a",
    selectedDescriptionColor: "#dff0e4",
    keyBindings: selectJkBindings,
  });
  nodePane.add(nodeSelect);
  historyTopRow.add(sessionPane);
  historyTopRow.add(nodePane);
  const detailScroll = new ScrollBoxRenderable(renderer, {
    id: "detail-scroll",
    width: "100%",
    minWidth: 0,
    flexGrow: 30,
    border: true,
    title: " node detail ",
    borderColor: "#5b6670",
    scrollY: true,
    focusable: true,
  });
  const detailScrollColumn = new BoxRenderable(renderer, {
    id: "detail-scroll-column",
    flexDirection: "column",
    flexGrow: 1,
    width: "100%",
  });
  const detailSummaryHeader = new TextRenderable(renderer, {
    id: "detail-summary-header",
    width: "100%",
    content: "",
  });
  const detailSummarySelect = new FocusAwareSelectRenderable(renderer, {
    id: "detail-summary-select",
    showDescription: true,
    flexGrow: 1,
    width: "100%",
    height: "100%",
    itemSpacing: 2,
    selectedBackgroundColor: "#1f3447",
    selectedTextColor: "#f7d774",
    descriptionColor: "#89a5ba",
    selectedDescriptionColor: "#d8e5f2",
    keyBindings: selectJkBindings,
  });
  const detailText = new TextRenderable(renderer, {
    id: "detail-text",
    flexGrow: 1,
    width: "100%",
    content: "",
  });
  detailScrollColumn.add(detailSummaryHeader);
  detailScrollColumn.add(detailSummarySelect);
  detailScrollColumn.add(detailText);
  detailScroll.content.add(detailScrollColumn);
  historyScreen.add(historyHeaderBox);
  historyScreen.add(historyTopRow);
  historyScreen.add(detailScroll);

  const runTopRow = new BoxRenderable(renderer, {
    flexDirection: "row",
    flexGrow: 1,
    width: "100%",
  });
  const runWorkflowPane = new ScrollBoxRenderable(renderer, {
    id: "run-workflow-scroll",
    width: "50%",
    minWidth: 24,
    height: "100%",
    border: true,
    title: " Workflow Detail ",
    borderColor: "#5b6670",
    scrollY: true,
  });
  const runWorkflowText = new TextRenderable(renderer, {
    id: "run-workflow-text",
    flexGrow: 1,
    width: "100%",
    content: "",
  });
  runWorkflowPane.content.add(runWorkflowText);
  const runStatusPane = new ScrollBoxRenderable(renderer, {
    id: "run-status-scroll",
    width: "50%",
    minWidth: 24,
    height: "100%",
    border: true,
    title: " Execution Status ",
    borderColor: "#5b6670",
    scrollY: true,
  });
  const runStatusText = new TextRenderable(renderer, {
    id: "run-status-text",
    flexGrow: 1,
    width: "100%",
    content: "",
  });
  runStatusPane.content.add(runStatusText);
  runTopRow.add(runWorkflowPane);
  runTopRow.add(runStatusPane);

  const inputRow = new BoxRenderable(renderer, {
    flexDirection: "row",
    flexGrow: 20,
    width: "100%",
  });
  const inputShell = new BoxRenderable(renderer, {
    id: "input-shell",
    border: true,
    title: " Input ",
    borderColor: "#5b6670",
    focusedBorderColor: "#4fd1ff",
    flexGrow: 1,
    height: "100%",
    focusable: true,
  });
  const inputTextarea = new TextareaRenderable(renderer, {
    id: "input-editor",
    flexGrow: 1,
    width: "100%",
    wrapMode: "char",
  });
  inputShell.add(inputTextarea);
  inputRow.add(inputShell);

  const helpPopup = new BoxRenderable(renderer, {
    id: "help-popup",
    border: true,
    title: " Help ",
    backgroundColor: popupBackgroundColor(),
    width: "70%",
    minWidth: 32,
    height: "60%",
    position: "absolute",
    top: "20%",
    left: "15%",
    zIndex: 20,
    padding: 1,
    visible: false,
    flexDirection: "column",
    focusable: true,
  });
  const helpText = new TextRenderable(renderer, {
    id: "help-text",
    flexGrow: 1,
    width: "100%",
    content: "",
  });
  helpPopup.add(helpText);

  const filterPopup = new BoxRenderable(renderer, {
    id: "workflow-filter-popup",
    border: true,
    title: " Filter Workflows ",
    backgroundColor: popupBackgroundColor(),
    width: "60%",
    minWidth: 24,
    height: 7,
    position: "absolute",
    top: "25%",
    left: "20%",
    zIndex: 20,
    flexDirection: "column",
    padding: 1,
    visible: false,
  });
  const filterHintText = new TextRenderable(renderer, {
    id: "workflow-filter-hint",
    content: "Type a substring and press enter/ctrl-m to apply. Esc cancels.",
  });
  const filterTextarea = new TextareaRenderable(renderer, {
    id: "workflow-filter-input",
    flexGrow: 1,
    width: "100%",
    wrapMode: "char",
  });
  filterPopup.add(filterHintText);
  filterPopup.add(filterTextarea);

  const confirmPopup = new BoxRenderable(renderer, {
    id: "run-confirm-popup",
    border: true,
    title: " Confirm Run ",
    backgroundColor: popupBackgroundColor(),
    width: "70%",
    minWidth: 32,
    height: "55%",
    position: "absolute",
    top: "22%",
    left: "15%",
    zIndex: 22,
    padding: 1,
    visible: false,
    flexDirection: "column",
    focusable: true,
  });
  const confirmText = new TextRenderable(renderer, {
    id: "run-confirm-text",
    flexGrow: 1,
    width: "100%",
    content: "",
  });
  confirmPopup.add(confirmText);

  root.add(selectorRow);
  root.add(historyScreen);
  root.add(runTopRow);
  root.add(inputRow);
  root.add(filterPopup);
  root.add(helpPopup);
  root.add(confirmPopup);
  renderer.root.add(root);

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
    options.initialWorkflowName === undefined && options.initialSessionId === undefined
      ? "workflows"
      : "sessions";
  let detailMode: DetailMode = "summary";
  let screenMode: ScreenMode =
    options.initialWorkflowName === undefined && options.initialSessionId === undefined
      ? "workspace"
      : "history";
  let busy = false;
  let editingInput: boolean = false;
  let filterPopupOpen = false;
  let helpPopupOpen = false;
  let confirmPopupOpen = false;
  let detailViewerTitle = "";
  let detailViewerBody = "";
  let workflowFilterText = "";
  let workflowFilterTextBeforePopup = "";
  let workflowSelectionBeforePopup: string | undefined;
  let pendingRunRuntimeVariables: Readonly<Record<string, unknown>> | undefined;
  let runSessionView: RuntimeSessionView | undefined;
  let runExecutionResult: OpenTuiWorkflowActionResult | undefined;
  let runPendingSessionId: string | undefined;
  let runStatusError: string | undefined;
  let runPollTimer: ReturnType<typeof setInterval> | undefined;
  let runPollInFlight = false;
  let isClosed = false;
  let lastStatus =
    screenMode === "workspace"
      ? "Select a workflow, then open history with enter/l or start a new run with ctrl-m."
      : "Loading TUI state...";

  const isEnterKey = (key: KeyEvent): boolean => key.name === "return";
  const isCtrlMKey = (key: KeyEvent): boolean =>
    key.name === "m" && key.ctrl && !key.meta;
  const isConfirmKey = (key: KeyEvent): boolean =>
    isEnterKey(key) || isCtrlMKey(key);

  const selectedWorkflowName = (): string | undefined => {
    const option = workflowSelect.getSelectedOption();
    if (option === null || option.value === EMPTY_SELECT) {
      return undefined;
    }
    return String(option.value);
  };

  const selectedSessionSummary = (): RuntimeSessionSummary | undefined => {
    const option = sessionSelect.getSelectedOption();
    if (option === null || option.value === EMPTY_SELECT) {
      return undefined;
    }
    return workflowSessions.find((session) => session.sessionId === option.value);
  };

  const selectedNodeExecution = (): NodeExecutionRecord | undefined => {
    if (runtimeSessionView === undefined) {
      return undefined;
    }
    const option = nodeSelect.getSelectedOption();
    if (option === null || option.value === EMPTY_SELECT) {
      return undefined;
    }
    return runtimeSessionView.session.nodeExecutions.find(
      (execution) => execution.nodeExecId === option.value,
    );
  };

  const selectedManagerSessionId = (): string | undefined => {
    const execution = selectedNodeExecution();
    if (execution === undefined || loadedWorkflow === undefined) {
      return undefined;
    }
    return resolveManagerSessionId(loadedWorkflow.bundle.workflow, execution);
  };

  const buildWorkflowSelectorPreview = (): StyledText => {
    const selected = selectedWorkflowName();
    if (selected === undefined) {
      return t`${
        workflowFilterText.length === 0
          ? "No workflow is selected."
          : `No workflows match filter '${workflowFilterText}'.`
      }`;
    }
    const previewWorkflow =
      selectorPreviewWorkflow?.workflowName === selected
        ? selectorPreviewWorkflow
        : loadedWorkflow?.workflowName === selected
          ? loadedWorkflow
          : undefined;
    const chunks: StyledText["chunks"] = [];
    chunks.push(
      ...t`${brightWhite("Workflow:")} ${bold(selected)}\n${dim(
        `Filter: ${workflowFilterText.length === 0 ? "(none)" : workflowFilterText}  Matches: ${String(filteredWorkflowNames.length)}/${String(workflowNames.length)}`,
      )}\n\n`.chunks,
    );
    chunks.push(...buildWorkflowSummaryPreview(previewWorkflow).chunks);
    return new StyledText(chunks);
  };

  const syncFilteredWorkflowNames = (
    preferredWorkflowName: string | undefined,
  ): void => {
    filteredWorkflowNames = [
      ...filterWorkflowNames(workflowNames, workflowFilterText),
    ];
    workflowSelect.options =
      filteredWorkflowNames.length === 0
        ? [
            {
              name:
                workflowFilterText.length === 0
                  ? "(no workflows found)"
                  : "(no workflows match filter)",
              description: "",
              value: EMPTY_SELECT,
            },
          ]
        : workflowNamesToSelectOptions(filteredWorkflowNames);
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
  };

  const setStatus = (message: string): void => {
    lastStatus = message;
    const inputSyntax = describeTuiWorkflowInputSyntax(
      inputTextarea.plainText,
      workflowInputDetection.mode,
    );
    if (screenMode === "workspace") {
      helpText.content = [
        message,
        "",
        `Screen=workspace  Filter=${workflowFilterText.length === 0 ? "(none)" : workflowFilterText}  Matches=${String(
          filteredWorkflowNames.length,
        )}/${String(workflowNames.length)}  Busy=${String(busy)}`,
        "j/k: move  /: filter  enter or l: history  ctrl-m: new run  R: refresh  ?: help  q: quit",
        "",
        "Press q to close this popup.",
      ].join("\n");
      return;
    }
    if (screenMode === "run") {
      helpText.content = [
        message,
        "",
        `Screen=run  Workflow=${loadedWorkflow?.workflowName ?? "-"}  InputMode=${workflowInputDetection.mode}  InputSyntax=${inputSyntax.summary}  Busy=${String(
          busy,
        )}`,
        "Type into the input editor. enter/ctrl-m: confirm run  f: format JSON  m: toggle input mode",
        "l: open history  h: workspace  R: refresh status  ?: help  q: quit",
        "",
        "Press q to close this popup.",
      ].join("\n");
      return;
    }
    helpText.content = [
      message,
      "",
      `Screen=history  Focus=${focusPane}  Detail=${detailMode}  InputMode=${workflowInputDetection.mode}  Editing=${String(
        editingInput,
      )}  Busy=${String(busy)}`,
      `Input syntax=${inputSyntax.summary}`,
      "tab: focus  enter/ctrl-m: load selection  e: edit input  f: format JSON  m: toggle input mode",
      "nodes: enter/ctrl-m to node detail  node detail: enter/ctrl-m opens the detail viewer  esc: back to nodes",
      "n: open new-run screen  r: rerun selected node  u: resume selected session  i/o/g/a/s: change detail view",
      "l: workflow runs -> nodes  h: nodes -> workflow runs, workflow runs -> workspace  R: refresh  ?: help  q: quit",
      "",
      "Press q to close this popup.",
    ].join("\n");
  };

  const render = async (): Promise<void> => {
    syncFilteredWorkflowNames(
      screenMode === "workspace"
        ? selectedWorkflowName()
        : loadedWorkflow?.workflowName ?? selectedWorkflowName(),
    );

    selectorRow.visible = screenMode === "workspace";
    historyScreen.visible = screenMode === "history";
    runTopRow.visible = screenMode === "run";
    inputRow.visible = screenMode === "history" || screenMode === "run";
    filterPopup.visible = filterPopupOpen;
    helpPopup.visible = helpPopupOpen;
    confirmPopup.visible = confirmPopupOpen;
    selectorPreviewText.content = buildWorkflowSelectorPreview();
    historyHeaderText.content = buildWorkflowHistoryHeader(loadedWorkflow);
    runWorkflowText.content = buildWorkflowSummaryPreview(loadedWorkflow);
    runStatusText.content = buildWorkflowRunStatusContent({
      loadedWorkflow,
      runtimeSessionView: runSessionView,
      ...(runExecutionResult === undefined
        ? {}
        : { completionResult: runExecutionResult }),
      ...(runPendingSessionId === undefined ? {} : { sessionId: runPendingSessionId }),
      ...(runStatusError === undefined ? {} : { statusError: runStatusError }),
    });

    sessionSelect.options = buildSessionSelectOptions(workflowSessions);
    if (workflowSessions.length === 0) {
      sessionSelect.setSelectedIndex(0);
    } else if (runtimeSessionView !== undefined) {
      selectBoundedIndex(
        sessionSelect,
        workflowSessions.findIndex(
          (session) => session.sessionId === runtimeSessionView?.session.sessionId,
        ),
        workflowSessions.length,
      );
    }

    nodeSelect.options = buildNodeSelectOptions(
      loadedWorkflow,
      runtimeSessionView?.session,
    );
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

    const workspaceWorkflowsActive =
      screenMode === "workspace" && focusPane === "workflows";
    workflowPane.title = paneTitle("Workflows", workspaceWorkflowsActive);
    workflowPane.borderColor = paneBorderColor(workspaceWorkflowsActive);
    workflowPane.backgroundColor = paneBackgroundColor(workspaceWorkflowsActive);
    selectorPreviewScroll.title = paneTitle(
      "Workflow Preview",
      screenMode === "workspace" && !workspaceWorkflowsActive,
    );
    selectorPreviewScroll.borderColor = paneBorderColor(
      screenMode === "workspace" && !workspaceWorkflowsActive,
    );

    historyHeaderBox.title = paneTitle("Workflow", screenMode === "history");
    historyHeaderBox.borderColor = paneBorderColor(screenMode === "history");
    sessionPane.title = paneTitle("Workflow Runs", screenMode === "history" && focusPane === "sessions");
    sessionPane.borderColor = paneBorderColor(
      screenMode === "history" && focusPane === "sessions",
    );
    sessionPane.backgroundColor = paneBackgroundColor(
      screenMode === "history" && focusPane === "sessions",
    );
    nodePane.title = paneTitle(
      runtimeSessionView === undefined ? "Nodes (select a run)" : "Nodes",
      screenMode === "history" && focusPane === "nodes",
    );
    nodePane.borderColor = paneBorderColor(
      screenMode === "history" && focusPane === "nodes",
    );
    nodePane.backgroundColor = paneBackgroundColor(
      screenMode === "history" && focusPane === "nodes",
    );
    detailScroll.title = paneTitle(
      "node detail",
      screenMode === "history" && focusPane === "detail",
    );
    detailScroll.borderColor = paneBorderColor(
      screenMode === "history" && focusPane === "detail",
    );

    runWorkflowPane.title = paneTitle(
      "Workflow Detail",
      screenMode === "run",
    );
    runWorkflowPane.borderColor = paneBorderColor(screenMode === "run");
    runStatusPane.title = paneTitle(
      "Execution Status",
      screenMode === "run",
    );
    runStatusPane.borderColor = paneBorderColor(screenMode === "run");

    const inputSyntax = describeTuiWorkflowInputSyntax(
      inputTextarea.plainText,
      workflowInputDetection.mode,
    );
    const syntaxSuffix =
      workflowInputDetection.mode === "json"
        ? `, ${inputSyntax.status === "invalid" ? "syntax error" : "syntax ok"}`
        : "";
    inputShell.title =
      screenMode === "run"
        ? paneTitle(`Run Input (${workflowInputDetection.mode}${syntaxSuffix})`, true)
        : paneTitle(
            `Input (${workflowInputDetection.mode}${syntaxSuffix})`,
            screenMode === "history" && focusPane === "input",
          );
    inputShell.borderColor = paneBorderColor(
      screenMode === "run" || (screenMode === "history" && focusPane === "input"),
    );
    inputShell.backgroundColor = paneBackgroundColor(
      screenMode === "run" || (screenMode === "history" && focusPane === "input"),
    );

    if (screenMode === "history") {
      if (
        detailMode === "summary" &&
        loadedWorkflow !== undefined &&
        runtimeSessionView !== undefined
      ) {
        const selected = selectedNodeExecution();
        if (selected !== undefined) {
          detailSummaryHeader.content = buildSummaryDetailHeaderText({
            session: runtimeSessionView.session,
            selectedExecution: selected,
            loadedWorkflow,
            inputDetection: workflowInputDetection,
            nodeLogs: runtimeSessionView.nodeLogs,
          });
          const bundle = await loadNodeExecutionArtifacts(
            runtimeSessionView,
            selected,
          );
          detailSummarySelect.options = buildSummaryJsonSelectOptions(bundle);
        } else {
          detailSummaryHeader.content = "Select a node execution.";
          detailSummarySelect.options = [
            {
              name: "(no node)",
              description: "",
              value: EMPTY_SELECT,
            },
          ];
        }
        detailSummaryHeader.visible = true;
        detailSummarySelect.visible = true;
        detailText.visible = false;
      } else if (detailMode === "viewer") {
        detailSummaryHeader.visible = false;
        detailSummarySelect.visible = false;
        detailText.visible = true;
        detailText.content =
          detailViewerTitle.length === 0
            ? detailViewerBody
            : `${detailViewerTitle}\n\n${detailViewerBody}`;
      } else {
        detailSummaryHeader.visible = false;
        detailSummarySelect.visible = false;
        detailText.visible = true;
        detailText.content = await buildDetailContent({
          detailMode,
          inputDetection: workflowInputDetection,
          loadedWorkflow,
          managerMessages,
          runtimeSessionView,
          selectedNodeExecution: selectedNodeExecution(),
        });
      }
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
    if (filterPopupOpen) {
      renderer.focusRenderable(filterTextarea);
    } else if (helpPopupOpen) {
      renderer.focusRenderable(helpPopup);
    } else if (confirmPopupOpen) {
      renderer.focusRenderable(confirmPopup);
    } else if (screenMode === "workspace") {
      renderer.focusRenderable(workflowSelect);
    } else if (screenMode === "run") {
      renderer.focusRenderable(inputTextarea);
    } else if (focusPane === "sessions") {
      renderer.focusRenderable(sessionSelect);
    } else if (focusPane === "nodes") {
      renderer.focusRenderable(nodeSelect);
    } else if (focusPane === "detail") {
      if (detailMode === "summary") {
        renderer.focusRenderable(detailSummarySelect);
      } else {
        renderer.focusRenderable(detailScroll);
      }
    } else if (editingInput) {
      renderer.focusRenderable(inputTextarea);
    } else {
      renderer.focusRenderable(inputShell);
    }
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
    managerMessages = await options.loadManagerSessionMessages(managerSessionId);
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
    selectorPreviewWorkflow = await options.loadWorkflowDefinition(workflowName);
  };

  const refreshSessionView = async (
    sessionId: string | undefined,
  ): Promise<void> => {
    if (sessionId === undefined) {
      runtimeSessionView = undefined;
      managerMessages = [];
      return;
    }
    runtimeSessionView = await options.loadRuntimeSessionView(sessionId);
    const nodeExecutionCount = runtimeSessionView.session.nodeExecutions.length;
    selectBoundedIndex(
      nodeSelect,
      Math.max(0, nodeExecutionCount - 1),
      nodeExecutionCount,
    );
    await refreshManagerMessages();
  };

  const refreshWorkflow = async (
    workflowName: string | undefined,
    preferredSessionId?: string,
  ): Promise<void> => {
    if (workflowName === undefined) {
      loadedWorkflow = undefined;
      selectorPreviewWorkflow = undefined;
      workflowSessions = [];
      runtimeSessionView = undefined;
      managerMessages = [];
      workflowInputDetection = {
        mode: "text",
        reason: "defaulted because no workflow is selected",
      };
      inputTextarea.setText("");
      return;
    }

    loadedWorkflow = await options.loadWorkflowDefinition(workflowName);
    selectorPreviewWorkflow = loadedWorkflow;
    workflowInputDetection = detectWorkflowInputMode(loadedWorkflow);
    workflowSessions = await options.listWorkflowSessions(workflowName);
    const targetSessionId =
      preferredSessionId ?? workflowSessions[0]?.sessionId ?? undefined;
    await refreshSessionView(targetSessionId);
    if (runtimeSessionView !== undefined) {
      inputTextarea.setText(
        deriveEditorTextFromRuntimeVariables(
          runtimeSessionView.session.runtimeVariables,
          workflowInputDetection.mode,
        ),
      );
    } else {
      inputTextarea.setText(workflowInputDetection.mode === "json" ? "{}" : "");
    }
  };

  const openFilterPopup = (): void => {
    workflowFilterTextBeforePopup = workflowFilterText;
    workflowSelectionBeforePopup = selectedWorkflowName();
    filterTextarea.setText(workflowFilterText);
    filterPopupOpen = true;
    helpPopupOpen = false;
    confirmPopupOpen = false;
    setStatus("Editing workflow filter");
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
    setStatus(
      workflowFilterText.length === 0
        ? "Workflow filter cleared"
        : `Workflow filter set to '${workflowFilterText}'`,
    );
    await withBusy("Loading workflow preview", async () => {
      await refreshSelectorPreviewWorkflow(selectedWorkflowName());
    });
    applyFocus("workflows");
  };

  const openHelpPopup = async (): Promise<void> => {
    helpPopupOpen = true;
    filterPopupOpen = false;
    confirmPopupOpen = false;
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
    confirmPopupOpen = false;
    pendingRunRuntimeVariables = undefined;
    await render();
    applyFocus("input");
  };

  const openDetailViewer = async (): Promise<void> => {
    const opt = detailSummarySelect.getSelectedOption();
    if (opt === null || opt.value === EMPTY_SELECT) {
      return;
    }
    const body = typeof opt.value === "string" ? opt.value : String(opt.value ?? "");
    detailViewerBody = body;
    const wf = loadedWorkflow?.bundle.workflow.workflowId ?? "workflow";
    const node = selectedNodeExecution()?.nodeId ?? "node";
    detailViewerTitle = `${wf} / ${node}`;
    detailMode = "viewer";
    await render();
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
      runSessionView = await options.loadRuntimeSessionView(runPendingSessionId);
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

  const switchInputMode = async (): Promise<void> => {
    const previousMode = workflowInputDetection.mode;
    const nextMode: TuiWorkflowInputMode =
      previousMode === "json" ? "text" : "json";
    try {
      const parsedValue = parseTuiEditorValue(
        inputTextarea.plainText,
        previousMode,
      );
      workflowInputDetection = {
        mode: nextMode,
        reason: "manually toggled inside the TUI",
      };
      inputTextarea.setText(formatEditorValue(parsedValue, nextMode));
      setStatus(`Input mode switched to ${workflowInputDetection.mode}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      setStatus(`Input mode toggle failed: ${message}`);
    }
    await render();
  };

  const formatJsonInput = async (): Promise<void> => {
    if (workflowInputDetection.mode !== "json") {
      setStatus("JSON formatting is only available when input mode is json");
      await render();
      return;
    }
    try {
      inputTextarea.setText(formatJsonEditorText(inputTextarea.plainText));
      setStatus("Formatted JSON input");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      setStatus(`JSON formatting failed: ${message}`);
    }
    await render();
  };

  const openWorkspaceScreen = async (): Promise<void> => {
    screenMode = "workspace";
    editingInput = false;
    confirmPopupOpen = false;
    filterPopupOpen = false;
    helpPopupOpen = false;
    setStatus("Returned to workspace");
    await render();
    applyFocus("workflows");
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
      screenMode = "history";
      detailMode = "summary";
      editingInput = false;
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
      resetRunState();
      screenMode = "run";
      editingInput = true;
      inputTextarea.setText(workflowInputDetection.mode === "json" ? "{}" : "");
      setStatus(`Opened new run for '${workflowName}'`);
    });
    applyFocus("input");
  };

  const openRunConfirmation = async (): Promise<void> => {
    const workflowName = loadedWorkflow?.workflowName ?? selectedWorkflowName();
    if (workflowName === undefined) {
      setStatus("Select a workflow before starting a run");
      await render();
      return;
    }
    try {
      pendingRunRuntimeVariables = buildTuiRuntimeVariables({
        editorText: inputTextarea.plainText,
        mode: workflowInputDetection.mode,
        purpose: "run",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      setStatus(`Cannot run workflow: ${message}`);
      await render();
      return;
    }
    confirmText.content = buildRunConfirmationContent({
      inputMode: workflowInputDetection.mode,
      inputSyntax: describeTuiWorkflowInputSyntax(
        inputTextarea.plainText,
        workflowInputDetection.mode,
      ),
      workflowName,
      editorText: inputTextarea.plainText,
    });
    confirmPopupOpen = true;
    helpPopupOpen = false;
    filterPopupOpen = false;
    setStatus(`Confirm new run for '${workflowName}'`);
    await render();
    applyFocus("input");
  };

  const confirmRunAction = async (): Promise<void> => {
    const workflowName = loadedWorkflow?.workflowName;
    if (workflowName === undefined || pendingRunRuntimeVariables === undefined) {
      setStatus("Run confirmation is unavailable");
      await render();
      return;
    }
    if (busy) {
      return;
    }
    busy = true;
    setStatus(`Starting workflow '${workflowName}'...`);
    await render();
    try {
      resetRunState();
      const handle = await options.executeWorkflow({
        workflowName,
        runtimeVariables: pendingRunRuntimeVariables,
      });
      runPendingSessionId = handle.sessionId;
      confirmPopupOpen = false;
      setStatus(`Run started: ${handle.sessionId}`);
      startRunPolling();
      void handle.completion
        .then(async (result) => {
          runExecutionResult = result;
          workflowSessions = await options.listWorkflowSessions(workflowName);
          await pollRunSessionView();
          setStatus(
            `Run finished: ${result.sessionId} status=${result.status} exitCode=${String(
              result.exitCode,
            )}`,
          );
        })
        .catch(async (error: unknown) => {
          runStatusError =
            error instanceof Error ? error.message : "unknown workflow error";
          setStatus(`Run failed: ${runStatusError}`);
          clearRunPolling();
          await render();
        });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      runStatusError = message;
      setStatus(`Failed to start workflow: ${message}`);
    } finally {
      busy = false;
      pendingRunRuntimeVariables = undefined;
      await render();
      applyFocus("input");
    }
  };

  const rerunWorkflowAction = async (): Promise<void> => {
    const session = selectedSessionSummary();
    const execution = selectedNodeExecution();
    if (session === undefined || execution === undefined) {
      setStatus("Select a historical session and node execution before rerunning");
      await render();
      return;
    }
    const managerSessionId = selectedManagerSessionId();
    let runtimeVariables: Readonly<Record<string, unknown>>;
    try {
      runtimeVariables = buildTuiRuntimeVariables(
        managerSessionId === undefined
          ? {
              editorText: inputTextarea.plainText,
              mode: workflowInputDetection.mode,
              purpose: "rerun",
            }
          : {
              editorText: inputTextarea.plainText,
              managerSessionId,
              mode: workflowInputDetection.mode,
              purpose: "rerun",
            },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      setStatus(`Cannot rerun workflow: ${message}`);
      await render();
      return;
    }
    await withBusy(
      `Rerunning '${execution.nodeId}' from ${session.sessionId}`,
      async () => {
        const result = await options.rerunWorkflow({
          sourceSessionId: session.sessionId,
          fromNodeId: execution.nodeId,
          runtimeVariables,
        });
        await refreshWorkflow(session.workflowName, result.sessionId);
        setStatus(
          `Rerun finished: ${result.sessionId} status=${result.status} exitCode=${String(
            result.exitCode,
          )}`,
        );
      },
    );
  };

  const resumeWorkflowAction = async (): Promise<void> => {
    const session = selectedSessionSummary();
    if (session === undefined) {
      setStatus("Select a session before resuming");
      await render();
      return;
    }
    await withBusy(`Resuming ${session.sessionId}`, async () => {
      const result = await options.resumeWorkflow(session.sessionId);
      await refreshWorkflow(session.workflowName, result.sessionId);
      setStatus(
        `Resume finished: ${result.sessionId} status=${result.status} exitCode=${String(
          result.exitCode,
        )}`,
      );
    });
  };

  const refreshAll = async (): Promise<void> => {
    await withBusy(
      screenMode === "workspace" ? "Refreshing workflow list" : "Refreshing TUI data",
      async () => {
        workflowNames = [...(await options.refreshWorkflowNames())];
        if (screenMode === "workspace") {
          syncFilteredWorkflowNames(
            workflowSelectionBeforePopup ?? selectedWorkflowName(),
          );
          await refreshSelectorPreviewWorkflow(selectedWorkflowName());
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

  const loadHistoryFocusedSelection = async (input?: {
    readonly focusDetailAfterSessionLoad?: boolean;
  }): Promise<void> => {
    if (focusPane === "sessions") {
      await withBusy("Loading session", async () => {
        await refreshSessionView(selectedSessionSummary()?.sessionId);
        if (runtimeSessionView !== undefined) {
          inputTextarea.setText(
            deriveEditorTextFromRuntimeVariables(
              runtimeSessionView.session.runtimeVariables,
              workflowInputDetection.mode,
            ),
          );
          setStatus(`Loaded session ${runtimeSessionView.session.sessionId}`);
        }
      });
      if (
        input?.focusDetailAfterSessionLoad === true &&
        runtimeSessionView !== undefined
      ) {
        detailMode = "summary";
        applyFocus("detail");
        setStatus(
          `Focused node detail for workflow run '${runtimeSessionView.session.sessionId}'`,
        );
        renderer.requestRender();
      }
      return;
    }
    if (focusPane === "nodes") {
      await withBusy("Loading node details", async () => {
        await refreshManagerMessages();
        const execution = selectedNodeExecution();
        setStatus(
          execution === undefined
            ? "No node execution selected"
            : `Loaded node ${execution.nodeId} details`,
        );
      });
      applyFocus("detail");
      return;
    }
    if (focusPane === "detail") {
      return;
    }
    editingInput = true;
    applyFocus("input");
    setStatus(
      workflowInputDetection.mode === "json"
        ? "Editing JSON input. Press escape to finish."
        : "Editing text input. Press escape to finish.",
    );
    renderer.requestRender();
  };

  const moveFocusedList = async (delta: number): Promise<void> => {
    const navigationMode =
      screenMode === "history"
        ? resolveHistoryPaneNavigationMode({ detailMode, focusPane })
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
          await refreshSelectorPreviewWorkflow(selectedWorkflowName());
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

    if (focusPane === "sessions") {
      if (delta < 0) {
        sessionSelect.moveUp(1);
      } else {
        sessionSelect.moveDown(1);
      }
      await withBusy("Switching session", async () => {
        await refreshSessionView(selectedSessionSummary()?.sessionId);
        detailMode = "summary";
        if (runtimeSessionView !== undefined) {
          inputTextarea.setText(
            deriveEditorTextFromRuntimeVariables(
              runtimeSessionView.session.runtimeVariables,
              workflowInputDetection.mode,
            ),
          );
          setStatus(`Selected session '${runtimeSessionView.session.sessionId}'`);
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
      await withBusy("Switching node", async () => {
        detailMode = "summary";
        await refreshManagerMessages();
        const execution = selectedNodeExecution();
        setStatus(
          execution === undefined
            ? "No node execution selected"
            : `Selected node '${execution.nodeId}' (${execution.nodeExecId})`,
        );
      });
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
      await refreshSelectorPreviewWorkflow(selectedWorkflowName());
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

      if (filterPopupOpen) {
        if (key.name === "escape") {
          key.preventDefault();
          void closeFilterPopup("cancel");
          return;
        }
        if (isConfirmKey(key)) {
          key.preventDefault();
          void closeFilterPopup("apply");
          return;
        }
        if (key.name === "c" && key.ctrl) {
          key.preventDefault();
          complete(130);
          return;
        }
        if (renderer.currentFocusedRenderable === filterTextarea) {
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
        return;
      }

      if (helpPopupOpen) {
        if (
          (key.name === "q" && !key.ctrl && !key.meta) ||
          key.name === "escape"
        ) {
          key.preventDefault();
          void closeHelpPopup();
          return;
        }
        if (key.name === "c" && key.ctrl) {
          key.preventDefault();
          complete(130);
        }
        return;
      }

      if (confirmPopupOpen) {
        if (
          (key.name === "q" && !key.ctrl && !key.meta) ||
          key.name === "escape"
        ) {
          key.preventDefault();
          void closeConfirmPopup();
          return;
        }
        if (isConfirmKey(key)) {
          key.preventDefault();
          void confirmRunAction();
          return;
        }
        if (key.name === "c" && key.ctrl) {
          key.preventDefault();
          complete(130);
        }
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

      if (screenMode === "workspace") {
        if (key.name === "/" && !key.ctrl && !key.meta) {
          key.preventDefault();
          openFilterPopup();
          return;
        }
        if (isOpenTuiRefreshKey(key)) {
          key.preventDefault();
          void refreshAll();
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
        if ((key.name === "l" && !key.ctrl) || isEnterKey(key)) {
          key.preventDefault();
          void openHistoryScreenAction(selectedWorkflowName());
          return;
        }
        if (isCtrlMKey(key)) {
          key.preventDefault();
          void openRunScreenAction();
        }
        return;
      }

      if (screenMode === "run") {
        if (isOpenTuiRefreshKey(key)) {
          key.preventDefault();
          void refreshAll();
          return;
        }
        if (key.name === "h" && !key.ctrl) {
          key.preventDefault();
          void openWorkspaceScreen();
          return;
        }
        if (key.name === "l" && !key.ctrl) {
          key.preventDefault();
          void openHistoryScreenAction(
            loadedWorkflow?.workflowName,
            runPendingSessionId ?? runSessionView?.session.sessionId,
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
        key.name === "escape"
      ) {
        key.preventDefault();
        applyFocus("nodes");
        setStatus("Focused nodes");
        void render();
        return;
      }

      if (key.name === "escape" && editingInput && focusPane === "input") {
        key.preventDefault();
        editingInput = false;
        applyFocus("input");
        setStatus("Input edit finished");
        void render();
        return;
      }

      if (editingInput && renderer.currentFocusedRenderable === inputTextarea) {
        return;
      }

      if (key.name === "tab" && !editingInput) {
        key.preventDefault();
        if (key.shift) {
          const previousFocus: Readonly<Record<FocusPane, FocusPane>> = {
            workflows: "input",
            sessions: "input",
            nodes: "sessions",
            detail: "nodes",
            input: "detail",
          };
          applyFocus(previousFocus[focusPane]);
        } else {
          const nextFocus: Readonly<Record<FocusPane, FocusPane>> = {
            workflows: "sessions",
            sessions: "nodes",
            nodes: "detail",
            detail: "input",
            input: "sessions",
          };
          applyFocus(nextFocus[focusPane]);
        }
        return;
      }

      if (key.name === "down" || (key.name === "j" && !key.ctrl)) {
        if (focusPane === "input" && !editingInput) {
          return;
        }
        key.preventDefault();
        void moveFocusedList(1);
        return;
      }
      if (key.name === "up" || (key.name === "k" && !key.ctrl)) {
        if (focusPane === "input" && !editingInput) {
          return;
        }
        key.preventDefault();
        void moveFocusedList(-1);
        return;
      }

      if (isEnterKey(key) || isCtrlMKey(key)) {
        key.preventDefault();
        if (screenMode === "history" && focusPane === "sessions") {
          void loadHistoryFocusedSelection({
            focusDetailAfterSessionLoad: true,
          });
          return;
        }
        if (
          screenMode === "history" &&
          focusPane === "detail" &&
          detailMode === "summary"
        ) {
          void openDetailViewer();
          return;
        }
        void loadHistoryFocusedSelection();
        return;
      }

      if (isOpenTuiRefreshKey(key)) {
        key.preventDefault();
        void refreshAll();
        return;
      }
      if (key.name === "n" && !key.ctrl) {
        key.preventDefault();
        void openRunScreenAction();
        return;
      }
      if (key.name === "l" && !key.ctrl && focusPane === "sessions") {
        key.preventDefault();
        detailMode = "summary";
        applyFocus("nodes");
        setStatus("Focused nodes for the selected workflow run");
        void render();
        return;
      }
      if (key.name === "r" && !key.ctrl) {
        key.preventDefault();
        void rerunWorkflowAction();
        return;
      }
      if (key.name === "u" && !key.ctrl) {
        key.preventDefault();
        void resumeWorkflowAction();
        return;
      }
      if (key.name === "h" && !key.ctrl && focusPane === "nodes") {
        key.preventDefault();
        detailMode = "summary";
        applyFocus("sessions");
        setStatus("Focused workflow runs");
        void render();
        return;
      }
      if (key.name === "h" && !key.ctrl) {
        key.preventDefault();
        void openWorkspaceScreen();
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
