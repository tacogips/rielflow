import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveNodeExecutionMailboxArtifactPaths } from "../workflow/node-execution-mailbox";
import type { LoadedWorkflow } from "../workflow/load";
import type { ManagerMessageRecord } from "../workflow/manager-session-store";
import type {
  NodeExecutionRecord,
  WorkflowSessionState,
} from "../workflow/session";
import { getNormalizedNodePayload } from "../workflow/types";
import type {
  DetailMode,
  DetailAgentSessionSelection,
  DetailJsonViewerSelection,
  HistoryViewMode,
  NodeDetailArtifactBundle,
  RuntimeSessionView,
  TuiWorkflowInputDetection,
} from "./opentui-model";
import {
  buildSummaryDetailHeaderText,
  formatLogEntries,
  formatOptionalTimestampForDisplay,
  formatTimestampForDisplay,
  buildSummaryJsonSelectOptions,
  OPEN_TUI_EMPTY_SELECT_VALUE,
  resolveAgentSessionSummarySelection,
  resolveManagerSessionId,
  resolveSystemTimeZoneLabel,
} from "./opentui-model";

export interface OpenTuiDetailSummarySelectOption {
  readonly description: string;
  readonly name: string;
  readonly value:
    | DetailAgentSessionSelection
    | DetailJsonViewerSelection
    | typeof OPEN_TUI_EMPTY_SELECT_VALUE;
}

export interface OpenTuiHistoryDetailPaneState {
  readonly summaryHeaderText: string;
  readonly summaryHeaderVisible: boolean;
  readonly summaryOptions: readonly OpenTuiDetailSummarySelectOption[];
  readonly summaryVisible: boolean;
  readonly textContent: string;
  readonly textVisible: boolean;
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
  return truncate(
    value.trim().length === 0 ? "(empty)" : value.trim(),
    maxLength,
  );
}

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
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

export async function loadNodeExecutionArtifacts(
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
        readOptionalText(
          path.join(selectedExecution.artifactDir, "output.json"),
        ),
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

export async function buildDetailContent(input: {
  readonly detailMode: DetailMode;
  readonly loadedWorkflow: LoadedWorkflow | undefined;
  readonly managerMessages: readonly ManagerMessageRecord[];
  readonly runtimeSessionView: RuntimeSessionView | undefined;
  readonly selectedNodeExecution: NodeExecutionRecord | undefined;
}): Promise<string> {
  if (
    input.loadedWorkflow === undefined ||
    input.runtimeSessionView === undefined
  ) {
    return "";
  }

  const sessionView = input.runtimeSessionView;
  const session = sessionView.session;

  if (input.detailMode === "session-logs") {
    return [
      `Workflow run logs for ${session.sessionId}`,
      `Timezone: ${resolveSystemTimeZoneLabel()}`,
      `Start datetime: ${formatTimestampForDisplay(session.startedAt)}`,
      `End datetime: ${formatOptionalTimestampForDisplay(session.endedAt)}`,
      "",
      formatLogEntries(sessionView.nodeLogs, 200),
    ].join("\n");
  }

  const selectedExecution =
    input.selectedNodeExecution ?? session.nodeExecutions.at(-1);
  if (selectedExecution === undefined || input.detailMode === "summary") {
    return "";
  }

  const managerSessionId = resolveManagerSessionId(
    input.loadedWorkflow.bundle.workflow,
    selectedExecution,
  );
  const bundle = await loadNodeExecutionArtifacts(
    sessionView,
    selectedExecution,
  );
  const inboundCommunications = session.communications.filter(
    (communication) =>
      communication.consumedByNodeExecId === selectedExecution.nodeExecId,
  );
  const outboundCommunications = session.communications.filter(
    (communication) =>
      communication.sourceNodeExecId === selectedExecution.nodeExecId,
  );

  if (input.detailMode === "inbox") {
    return [
      `Inbox for ${selectedExecution.nodeId} / ${selectedExecution.nodeExecId}`,
      "",
      "Mailbox meta.json:",
      summarizeLines(bundle.mailboxMeta, 8_000),
      "",
      "Mailbox inbox/input.json:",
      summarizeLines(bundle.mailboxInput, 8_000),
      "",
      "Execution input.json:",
      summarizeLines(bundle.artifactInput, 8_000),
      "",
      formatCommunications("Inbound communications", inboundCommunications),
    ].join("\n");
  }

  if (input.detailMode === "outbox") {
    return [
      `Outbox for ${selectedExecution.nodeId} / ${selectedExecution.nodeExecId}`,
      "",
      "Execution output.json:",
      summarizeLines(bundle.artifactOutput, 8_000),
      "",
      "Mailbox outbox/output.json:",
      summarizeLines(bundle.mailboxOutput, 8_000),
      "",
      "Execution meta.json:",
      summarizeLines(bundle.artifactMeta, 8_000),
      "",
      formatCommunications("Outbound communications", outboundCommunications),
    ].join("\n");
  }

  if (input.detailMode === "manager") {
    return [
      `Manager session for ${selectedExecution.nodeId} / ${selectedExecution.nodeExecId}`,
      `managerSessionId: ${managerSessionId ?? "(not a manager node)"}`,
      `Timezone: ${resolveSystemTimeZoneLabel()}`,
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
                `- ${formatTimestampForDisplay(message.createdAt)} ${message.managerMessageId}`,
                `  accepted=${String(message.accepted)} intents=${compactJson(message.parsedIntent, 500)}`,
                `  message=${summary}`,
              ].join("\n");
            })
            .join("\n"),
    ].join("\n");
  }

  return "";
}

export async function buildHistoryDetailPaneState(input: {
  readonly detailMode: DetailMode;
  readonly detailViewerBody: string;
  readonly detailViewerTitle: string;
  readonly historyViewMode: HistoryViewMode;
  readonly inputDetection: TuiWorkflowInputDetection;
  readonly loadedWorkflow: LoadedWorkflow | undefined;
  readonly managerMessages: readonly ManagerMessageRecord[];
  readonly runtimeSessionView: RuntimeSessionView | undefined;
  readonly selectedNodeExecution: NodeExecutionRecord | undefined;
}): Promise<OpenTuiHistoryDetailPaneState> {
  if (input.detailMode === "viewer") {
    return {
      summaryHeaderText: "",
      summaryHeaderVisible: false,
      summaryOptions: [],
      summaryVisible: false,
      textContent:
        input.detailViewerTitle.length === 0
          ? input.detailViewerBody
          : `${input.detailViewerTitle}\n\n${input.detailViewerBody}`,
      textVisible: true,
    };
  }

  if (input.detailMode !== "summary") {
    return {
      summaryHeaderText: "",
      summaryHeaderVisible: false,
      summaryOptions: [],
      summaryVisible: false,
      textContent: await buildDetailContent({
        detailMode: input.detailMode,
        loadedWorkflow: input.loadedWorkflow,
        managerMessages: input.managerMessages,
        runtimeSessionView: input.runtimeSessionView,
        selectedNodeExecution: input.selectedNodeExecution,
      }),
      textVisible: true,
    };
  }

  if (
    input.loadedWorkflow === undefined ||
    input.runtimeSessionView === undefined ||
    input.selectedNodeExecution === undefined
  ) {
    return {
      summaryHeaderText:
        input.historyViewMode === "workflow"
          ? "Select a node execution."
          : "Select a workflow node.",
      summaryHeaderVisible: true,
      summaryOptions: [
        {
          name: "(no node)",
          description: "",
          value: OPEN_TUI_EMPTY_SELECT_VALUE,
        },
      ],
      summaryVisible: true,
      textContent: "",
      textVisible: false,
    };
  }

  const bundle = await loadNodeExecutionArtifacts(
    input.runtimeSessionView,
    input.selectedNodeExecution,
  );
  const nodeRef = input.loadedWorkflow.bundle.workflow.nodes.find(
    (entry) => entry.id === input.selectedNodeExecution?.nodeId,
  );
  const payload =
    nodeRef === undefined
      ? undefined
      : getNormalizedNodePayload(input.loadedWorkflow.bundle, nodeRef.id);
  const agentSessionSelection = resolveAgentSessionSummarySelection({
    execution: input.selectedNodeExecution,
    payload,
  });
  return {
    summaryHeaderText: buildSummaryDetailHeaderText({
      session: input.runtimeSessionView.session,
      selectedExecution: input.selectedNodeExecution,
      loadedWorkflow: input.loadedWorkflow,
      inputDetection: input.inputDetection,
      nodeLogs: input.runtimeSessionView.nodeLogs,
    }),
    summaryHeaderVisible: true,
    summaryOptions: buildSummaryJsonSelectOptions(
      agentSessionSelection === undefined
        ? { bundle }
        : { bundle, agentSessionSelection },
    ),
    summaryVisible: true,
    textContent: "",
    textVisible: false,
  };
}
