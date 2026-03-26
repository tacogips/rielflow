import {
  StyledText,
  bold,
  brightCyan,
  brightWhite,
  dim,
  t,
} from "@opentui/core";
import type { LoadedWorkflow } from "../../workflow/load";
import type {
  NodeExecutionRecord,
  WorkflowSessionState,
} from "../../workflow/session";
import type {
  RuntimeNodeLogEntry,
  RuntimeSessionSummary,
} from "../../workflow/runtime-db";
import type { OpenTuiRichSelectOption } from "../opentui-view-shared";
import { resolveOpenTuiNodeTypeColor, resolveOpenTuiStatusColor } from "../opentui-view-shared";
import { detectWorkflowInputMode } from "./input";
import { resolveDirectChildSubworkflows } from "./navigation";
import {
  OPEN_TUI_EMPTY_SELECT_VALUE,
  type DetailAgentSessionSelection,
  type DetailJsonViewerSelection,
  type NodeDetailArtifactBundle,
  type RuntimeSessionView,
  type TuiWorkflowInputDetection,
} from "./types";
import {
  buildNodePreviewContextLine,
  buildNodeRowTypeLine,
  buildNodeSelectOption,
  buildPreviewFinalSeparator,
  buildPreviewLine,
  buildPreviewSeparator,
  buildPreviewTitleLine,
  buildWorkflowNodeVisualMetadata,
  compactJson,
  findLatestNodeExecution,
  formatLogEntries,
  formatStatusLabel,
  hasVisibleText,
  resolveManagerSessionId,
  resolveNodeKind,
  resolveNodePurpose,
  resolveOwningSubWorkflow,
  resolveWorkflowFinalResult,
  resolveWorkflowNodeVisualMetadata,
  summarizeJsonBlock,
  summarizePromptHelp,
  truncate,
} from "./shared";

function buildWorkflowNodePreview(loaded: LoadedWorkflow): StyledText {
  const derivedNodes = buildWorkflowNodeVisualMetadata(loaded);
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

  [...derivedNodes.keys()].forEach((nodeId, index, nodeIds) => {
    const nodeRef = nodeRefById.get(nodeId);
    const payload =
      nodeRef === undefined
        ? undefined
        : loaded.bundle.nodePayloads[nodeRef.nodeFile];
    const kind = nodeRef?.kind ?? "task";
    const visualMetadata = resolveWorkflowNodeVisualMetadata({
      nodeId,
      visualMetadataByNodeId: derivedNodes,
    });
    const purpose =
      payload?.description ??
      payload?.output?.description ??
      subWorkflowByNodeId.get(nodeId) ??
      summarizePromptHelp(payload?.promptTemplate);
    const scopeLabel = subWorkflowByNodeId.get(nodeId);

    append(buildPreviewSeparator(visualMetadata.indentPrefix));
    append(
      buildPreviewTitleLine({
        indentPrefix: visualMetadata.indentPrefix,
        kind,
        nodeId,
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
    if (index === nodeIds.length - 1) {
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
  readonly inputDetection: TuiWorkflowInputDetection;
  readonly loadedWorkflow: LoadedWorkflow;
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
