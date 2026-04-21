import { StyledText, bold, dim, fg, t } from "@opentui/core";
import { normalizeCliAgentBackend } from "../../workflow/backend";
import type { LoadedWorkflow } from "../../workflow/load";
import type {
  NodeExecutionRecord,
  WorkflowSessionState,
} from "../../workflow/session";
import type { RuntimeNodeLogEntry } from "../../workflow/runtime-db";
import type {
  ArgumentBinding,
  CliAgentBackend,
  NodePayload,
} from "../../workflow/types";
import { describeWorkflowNodeKind } from "../../workflow/node-role";
import { deriveWorkflowVisualization } from "../../workflow/visualization";
import type { OpenTuiRichSelectOption } from "../opentui-view-shared";
import {
  resolveOpenTuiNodeKindColor,
  resolveOpenTuiNodeTypeColor,
  resolveOpenTuiStatusColor,
  resolveOpenTuiWorkflowScopeColor,
} from "../opentui-view-shared";
import type {
  DetailAgentSessionSelection,
  NodeDetailArtifactBundle,
  RuntimeSessionView,
} from "./types";

const SUMMARY_JSON_PREVIEW_LINES = 14;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function hasVisibleText(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

export function compactJson(value: unknown, maxLength = 140): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return "null";
  }
  return truncate(serialized, maxLength);
}

export function extractTextValue(value: unknown): string | undefined {
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

export function extractJsonParseLocation(
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

export function resolveNodeKind(
  workflow: LoadedWorkflow["bundle"]["workflow"],
  nodeId: string,
): string {
  const node = workflow.nodes.find((entry) => entry.id === nodeId);
  return node === undefined ? "task" : describeWorkflowNodeKind(node);
}

export function findLatestNodeExecution(
  session: WorkflowSessionState,
  nodeId: string,
): NodeExecutionRecord | undefined {
  return [...session.nodeExecutions]
    .reverse()
    .find((entry) => entry.nodeId === nodeId);
}

export function summarizePromptHelp(
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

export function resolveNodePurpose(input: {
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

export function buildNodeRowDescription(input: {
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

export function buildNodeRowName(input: {
  readonly indentPrefix?: string;
  readonly nodeId: string;
}): string {
  return `${input.indentPrefix ?? ""}${input.nodeId}`;
}

export function formatNodeKindLabel(kind: string): string {
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

export function formatStatusLabel(status: string): string {
  return status.replace(/_/g, " ").toUpperCase();
}

function padTwoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  return `UTC${sign}${padTwoDigits(hours)}:${padTwoDigits(minutes)}`;
}

export function resolveSystemTimeZoneLabel(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "system-local";
}

export function formatTimestampForDisplay(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }
  return (
    `${parsed.getFullYear()}-${padTwoDigits(parsed.getMonth() + 1)}-${padTwoDigits(parsed.getDate())} ` +
    `${padTwoDigits(parsed.getHours())}:${padTwoDigits(parsed.getMinutes())}:${padTwoDigits(parsed.getSeconds())} ` +
    `${formatUtcOffset(-parsed.getTimezoneOffset())} (${resolveSystemTimeZoneLabel()})`
  );
}

export function formatOptionalTimestampForDisplay(
  timestamp: string | null | undefined,
): string {
  return timestamp === undefined || timestamp === null
    ? "-"
    : formatTimestampForDisplay(timestamp);
}

function formatNodeTypeLabel(nodeType: string): string {
  if (nodeType === "user-action") {
    return "USER ACTION";
  }
  return nodeType.toUpperCase();
}

function buildNodeTypeDetail(
  payload: NodePayload | undefined,
): string | undefined {
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

export function buildNodeRowTypeLine(input: {
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

export interface WorkflowNodeVisualMetadata {
  readonly indentPrefix: string;
  readonly scopeColor: string;
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

export function buildWorkflowNodeVisualMetadata(
  loaded: LoadedWorkflow,
): ReadonlyMap<string, WorkflowNodeVisualMetadata> {
  const derivedNodes = deriveWorkflowVisualization({
    workflow: loaded.bundle.workflow,
  });
  const nodeKindById = new Map(
    loaded.bundle.workflow.nodes.map(
      (node) => [node.id, describeWorkflowNodeKind(node)] as const,
    ),
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

export function resolveWorkflowNodeVisualMetadata(input: {
  readonly nodeId: string;
  readonly visualMetadataByNodeId?: ReadonlyMap<
    string,
    WorkflowNodeVisualMetadata
  >;
}): WorkflowNodeVisualMetadata {
  return (
    input.visualMetadataByNodeId?.get(input.nodeId) ?? {
      indentPrefix: "",
      scopeColor: resolveOpenTuiWorkflowScopeColor(undefined),
    }
  );
}

export function buildNodePreviewContextLine(input: {
  readonly purpose?: string;
  readonly scopeLabel?: string;
}): string {
  return buildNodeRowDescription({
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    ...(input.scopeLabel === undefined ? {} : { scopeLabel: input.scopeLabel }),
  });
}

export function buildPreviewLine(input: {
  readonly color: string;
  readonly indentPrefix: string;
  readonly text: string;
}): StyledText {
  return t`${input.indentPrefix}${fg(input.color)(input.text)}\n`;
}

export function buildPreviewSeparator(indentPrefix: string): StyledText {
  return t`${dim(`${indentPrefix}----------------------------------------\n`)}`;
}

export function buildPreviewFinalSeparator(indentPrefix: string): StyledText {
  return t`${dim(`${indentPrefix}----------------------------------------`)}`;
}

export function buildPreviewTitleLine(input: {
  readonly indentPrefix: string;
  readonly kind: string;
  readonly nodeId: string;
}): StyledText {
  return t`${input.indentPrefix}${fg(resolveOpenTuiNodeKindColor(input.kind))(
    bold(input.nodeId),
  )}\n`;
}

export function buildNodeSelectOption(input: {
  readonly execution?: NodeExecutionRecord;
  readonly kind: string;
  readonly nodeId: string;
  readonly payload: NodePayload | undefined;
  readonly purpose?: string;
  readonly scopeLabel?: string;
  readonly value: string;
  readonly visualMetadataByNodeId?: ReadonlyMap<
    string,
    WorkflowNodeVisualMetadata
  >;
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
    statusColor: resolveOpenTuiStatusColor(
      input.execution?.status ?? "pending",
    ),
    statusLabel: formatStatusLabel(input.execution?.status ?? "pending"),
    textColor: kindColor,
    value: input.value,
  };
}

export function resolveCliAgentBackendForNode(
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

export function formatJsonForDisplay(raw: string | null): string {
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

export function takeFirstLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) {
    return text;
  }
  return [
    ...lines.slice(0, maxLines),
    `... (${String(lines.length - maxLines)} more lines)`,
  ].join("\n");
}

export function summarizeJsonBlock(raw: string | null): {
  readonly full: string;
  readonly preview: string;
} {
  const full = formatJsonForDisplay(raw);
  const preview = takeFirstLines(full, SUMMARY_JSON_PREVIEW_LINES);
  return { full, preview };
}

export function formatLogEntries(
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
      return `[${formatTimestampForDisplay(entry.at)}] [${entry.level}] ${scope}: ${entry.message}`;
    })
    .join("\n");
}

export function resolveWorkflowFinalResult(
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

export function buildDetailAgentSessionDescription(
  selection: DetailAgentSessionSelection,
): string {
  return selection.available !== true
    ? "backend session id is unavailable for this node execution"
    : `sessionId: ${selection.sessionId ?? "(missing)"}`;
}

export type { ArgumentBinding, CliAgentBackend, NodeDetailArtifactBundle };
