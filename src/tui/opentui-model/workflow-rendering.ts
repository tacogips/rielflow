import {
  StyledText,
  bold,
  brightCyan,
  brightGreen,
  brightRed,
  brightWhite,
  dim,
  fg,
  t,
} from "@opentui/core";
import { effectiveWorkflowCalls } from "../../workflow/cross-workflow-from-steps";
import type { LoadedWorkflow } from "../../workflow/load";
import type {
  NodeExecutionRecord,
  WorkflowSessionState,
} from "../../workflow/session";
import { resolveCurrentStepId } from "../../workflow/session";
import type {
  RuntimeNodeLogEntry,
  RuntimeSessionSummary,
} from "../../workflow/runtime-db";
import { describeWorkflowNodeKind } from "../../workflow/node-role";
import {
  getNormalizedNodePayload,
  resolveWorkflowEntryRuntimeId,
  resolveWorkflowManagerRuntimeId,
  getStructuralEdges,
} from "../../workflow/types";
import type { OpenTuiRichSelectOption } from "../opentui-view-shared";
import {
  resolveOpenTuiNodeTypeColor,
  resolveOpenTuiStatusColor,
} from "../opentui-view-shared";
import { detectWorkflowInputMode } from "./input";
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
  formatLogEntries,
  formatOptionalTimestampForDisplay,
  formatNodeKindLabel,
  formatTimestampForDisplay,
  formatStatusLabel,
  hasVisibleText,
  resolveManagerSessionId,
  resolveNodeKind,
  resolveNodePurpose,
  resolveSystemTimeZoneLabel,
  resolveWorkflowFinalResult,
  resolveWorkflowNodeVisualMetadata,
  summarizeJsonBlock,
  summarizePromptHelp,
  takeFirstLines,
  truncate,
} from "./shared";

const WORKSPACE_LATEST_RESULT_PREVIEW_LINES = 18;

/**
 * Check if a legacy workflow has an explicitly marked manager node.
 * Returns the node id if found, or undefined if the manager node is not explicitly identified.
 */
function findExplicitLegacyManagerNode(
  workflow: LoadedWorkflow["bundle"]["workflow"],
): string | undefined {
  const rootManager = workflow.nodes.find((n) => n.kind === "root-manager");
  if (rootManager !== undefined) {
    return rootManager.id;
  }
  const roleManager = workflow.nodes.find((n) => n.role === "manager");
  if (roleManager !== undefined) {
    return roleManager.id;
  }
  return undefined;
}

/**
 * Check if a legacy workflow has an explicitly marked entry node via edges.
 * Returns the node id if found, or undefined if not explicitly identified.
 */
function findExplicitLegacyEntryNode(
  workflow: LoadedWorkflow["bundle"]["workflow"],
): string | undefined {
  if (workflow.nodes.length === 0) {
    return undefined;
  }
  const edges = getStructuralEdges(workflow);
  const toTargets = new Set(edges.map((e) => e.to));
  // Only return as entry if there's a single candidate or the workflow structure is clear
  const candidateIds = workflow.nodes
    .map((n) => n.id)
    .filter((id) => !toTargets.has(id));
  // Only return if there's exactly one entry candidate (not ambiguous)
  if (candidateIds.length === 1) {
    return candidateIds[0];
  }
  return undefined;
}

function buildLegacyManagerNodeDisplayLine(
  workflow: LoadedWorkflow["bundle"]["workflow"],
): string {
  // If hasManagerNode is true, require an explicit manager indicator
  if (workflow.hasManagerNode === true) {
    const explicit = findExplicitLegacyManagerNode(workflow);
    if (explicit !== undefined) {
      return explicit;
    }
    return "(not set; check workflow authorship)";
  }
  // If hasManagerNode is false, try inference as fallback for display
  try {
    return resolveWorkflowManagerRuntimeId(workflow);
  } catch {
    return "(not set; check workflow authorship)";
  }
}

function buildLegacyEntryNodeDisplayLine(
  workflow: LoadedWorkflow["bundle"]["workflow"],
): string {
  // For workflows with a manager, entry must be explicitly resolvable
  if (workflow.hasManagerNode === true) {
    // In manager workflows with only one node, entry isn't explicit
    if (workflow.nodes.length === 1) {
      return "(not set; check workflow authorship)";
    }
    // Try to find it from edge structure
    const explicit = findExplicitLegacyEntryNode(workflow);
    if (explicit !== undefined) {
      return explicit;
    }
    return "(not set; check workflow authorship)";
  }
  // For worker-only workflows, infer the entry node
  const explicit = findExplicitLegacyEntryNode(workflow);
  if (explicit !== undefined) {
    return explicit;
  }
  // Try inference as fallback for display
  try {
    return resolveWorkflowEntryRuntimeId(workflow);
  } catch {
    return "(not set; check workflow authorship)";
  }
}

function resolveWorkflowRuntimePreviewId(input: {
  readonly workflow: LoadedWorkflow["bundle"]["workflow"];
  readonly kind: "entry" | "manager";
  readonly fallback: string;
}): string {
  try {
    return input.kind === "entry"
      ? resolveWorkflowEntryRuntimeId(input.workflow)
      : resolveWorkflowManagerRuntimeId(input.workflow);
  } catch {
    return input.fallback;
  }
}

/**
 * Compact Entry/Manager labels for summary and run one-liners. Step-addressed
 * bundles use step ids only; legacy node graphs keep the node-id fallbacks.
 */
function buildWorkflowExecutionIdentityPreviewSegment(input: {
  readonly workflow: LoadedWorkflow["bundle"]["workflow"];
  readonly isStepAddressed: boolean;
}): { readonly entry: string; readonly manager: string } {
  const { workflow, isStepAddressed } = input;
  if (isStepAddressed) {
    return {
      entry: workflow.entryStepId ?? "(unset)",
      manager:
        workflow.managerStepId ??
        (workflow.hasManagerNode === false
          ? "none"
          : resolveWorkflowManagerRuntimeId(workflow)),
    };
  }
  return {
    entry: resolveWorkflowRuntimePreviewId({
      workflow,
      kind: "entry",
      fallback: "(unset)",
    }),
    manager:
      workflow.managerStepId ??
      (workflow.hasManagerNode === false
        ? "none"
        : resolveWorkflowRuntimePreviewId({
            workflow,
            kind: "manager",
            fallback: "(unset)",
          })),
  };
}

/** Matches {@link buildInspectionSummary}: optional `nodeRegistry` else `nodes` ids. */
function effectiveNodeRegistryIds(
  workflow: LoadedWorkflow["bundle"]["workflow"],
): readonly string[] {
  return (
    workflow.nodeRegistry?.map((entry) => entry.id) ??
    workflow.nodes.map((entry) => entry.id)
  );
}

function appendWorkflowBoundarySections(input: {
  readonly append: (value: StyledText) => void;
  readonly workflow: LoadedWorkflow["bundle"]["workflow"];
}): void {
  const workflowCallIds = effectiveWorkflowCalls(input.workflow).map(
    (entry) => entry.id,
  );

  if (workflowCallIds.length > 0) {
    input.append(
      t`\n\n${brightWhite("Workflow Calls")}\n- ${workflowCallIds.join(", ")}`,
    );
  }
}

function formatLatestRunResultForDisplay(input: {
  readonly latestRunStatusError?: string;
  readonly result: unknown;
}): string {
  if (input.latestRunStatusError !== undefined && input.result === undefined) {
    return `Latest run details unavailable: ${truncate(input.latestRunStatusError, 120)}`;
  }
  if (input.result === undefined) {
    return "(not available yet)";
  }
  if (typeof input.result === "string") {
    return takeFirstLines(input.result, WORKSPACE_LATEST_RESULT_PREVIEW_LINES);
  }
  const serialized = JSON.stringify(input.result, null, 2);
  return takeFirstLines(
    serialized ?? String(input.result),
    WORKSPACE_LATEST_RESULT_PREVIEW_LINES,
  );
}

function buildCurrentExecutionLines(input: {
  readonly currentNodeId: string | null | undefined;
  readonly currentStepId: string | null | undefined;
  readonly nodeLabel: string;
  readonly stepLabel: string;
}): readonly string[] {
  const currentNodeId = input.currentNodeId ?? "-";
  if (input.currentStepId === null || input.currentStepId === undefined) {
    return [`${input.nodeLabel}: ${currentNodeId}`];
  }
  return input.currentStepId === currentNodeId
    ? [`${input.stepLabel}: ${input.currentStepId}`]
    : [
        `${input.stepLabel}: ${input.currentStepId}`,
        `${input.nodeLabel}: ${currentNodeId}`,
      ];
}

function buildWorkflowNodePreview(loaded: LoadedWorkflow): StyledText {
  const derivedNodes = buildWorkflowNodeVisualMetadata(loaded);
  const nodeRefById = new Map(
    loaded.bundle.workflow.nodes.map((node) => [node.id, node] as const),
  );
  const chunks: StyledText["chunks"] = [];

  const append = (value: StyledText): void => {
    chunks.push(...value.chunks);
  };

  [...derivedNodes.keys()].forEach((nodeId, index, nodeIds) => {
    const nodeRef = nodeRefById.get(nodeId);
    const payload =
      nodeRef === undefined
        ? undefined
        : getNormalizedNodePayload(loaded.bundle, nodeRef.id);
    const kind =
      nodeRef === undefined ? "task" : describeWorkflowNodeKind(nodeRef);
    const visualMetadata = resolveWorkflowNodeVisualMetadata({
      nodeId,
      visualMetadataByNodeId: derivedNodes,
    });
    const purpose =
      payload?.description ??
      payload?.output?.description ??
      summarizePromptHelp(payload?.promptTemplate);
    const scopeLabel = undefined;

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

  const workflow = loadedWorkflow.bundle.workflow;
  const isStepAddressed = workflow.steps !== undefined;
  const { entry: entryExecutionId, manager: managerExecutionLabel } =
    buildWorkflowExecutionIdentityPreviewSegment({
      workflow,
      isStepAddressed,
    });
  const workflowCallIds = effectiveWorkflowCalls(workflow).map(
    (entry) => entry.id,
  );
  const stepIds = workflow.steps?.map((entry) => entry.id) ?? [];
  const nodeRegistryIds = effectiveNodeRegistryIds(workflow);
  const chunks: StyledText["chunks"] = [];
  const append = (value: StyledText): void => {
    chunks.push(...value.chunks);
  };

  append(
    t`${dim(
      `${
        isStepAddressed
          ? `Steps: ${String(stepIds.length)}  Node registry: ${String(
              nodeRegistryIds.length,
            )}`
          : `Nodes: ${String(workflow.nodes.length)}`
      }  Workflow calls: ${String(
        workflowCallIds.length,
      )}  Entry: ${entryExecutionId}  Manager: ${managerExecutionLabel}`,
    )}`,
  );
  if (hasVisibleText(workflow.description)) {
    append(t`\n\n${brightWhite("Description")}\n${workflow.description}`);
  }
  if (isStepAddressed) {
    append(t`\n\n${brightWhite("Step Graph")}`);
    append(
      t`\n- Entry step: ${workflow.entryStepId ?? "(unset)"}\n- Manager step: ${
        workflow.managerStepId ?? "(implicit or worker-only)"
      }`,
    );
    append(
      t`\n- Step ids: ${stepIds.length === 0 ? "(none)" : stepIds.join(", ")}`,
    );
    append(
      t`\n- Node registry ids: ${
        nodeRegistryIds.length === 0 ? "(none)" : nodeRegistryIds.join(", ")
      }`,
    );
  }
  appendWorkflowBoundarySections({
    append,
    workflow,
  });
  append(t`\n\n`);
  append(t`${brightWhite(bold("Node Structure"))}\n`);
  append(buildWorkflowNodePreview(loadedWorkflow));
  return new StyledText(chunks);
}

export function buildWorkflowRunPreview(
  loadedWorkflow: LoadedWorkflow | undefined,
): StyledText {
  if (loadedWorkflow === undefined) {
    return t`${dim("Loading workflow detail...")}`;
  }

  const workflow = loadedWorkflow.bundle.workflow;
  const inputDetection = detectWorkflowInputMode(loadedWorkflow);
  const isStepAddressed = workflow.steps !== undefined;
  const { entry: entryExecutionId, manager: managerExecutionLabel } =
    buildWorkflowExecutionIdentityPreviewSegment({
      workflow,
      isStepAddressed,
    });
  const workflowCallIds = effectiveWorkflowCalls(workflow).map(
    (entry) => entry.id,
  );
  const stepIds = workflow.steps?.map((entry) => entry.id) ?? [];
  const nodeRegistryIds = effectiveNodeRegistryIds(workflow);
  const chunks: StyledText["chunks"] = [];
  const append = (value: StyledText): void => {
    chunks.push(...value.chunks);
  };

  append(
    t`${brightWhite("Workflow:")} ${bold(loadedWorkflow.workflowName)}\n${dim(
      `ID: ${workflow.workflowId}  Entry: ${entryExecutionId}  Manager: ${managerExecutionLabel}  Input: ${inputDetection.mode}  ${
        isStepAddressed
          ? `Steps: ${String(stepIds.length)}  Node registry: ${String(
              nodeRegistryIds.length,
            )}`
          : `Nodes: ${String(workflow.nodes.length)}`
      }  Workflow calls: ${String(
        workflowCallIds.length,
      )}`,
    )}`,
  );

  if (hasVisibleText(workflow.description)) {
    append(t`\n\n${brightWhite("Description")}\n${workflow.description}`);
  }
  if (isStepAddressed) {
    append(
      t`\n\n${brightWhite("Step Graph")}\n- Entry step: ${
        workflow.entryStepId ?? "(unset)"
      }\n- Manager step: ${
        workflow.managerStepId ?? "(implicit or worker-only)"
      }\n- Step ids: ${
        stepIds.length === 0 ? "(none)" : stepIds.join(", ")
      }\n- Node registry ids: ${
        nodeRegistryIds.length === 0 ? "(none)" : nodeRegistryIds.join(", ")
      }`,
    );
  }
  appendWorkflowBoundarySections({
    append,
    workflow,
  });

  append(t`\n\n${brightWhite("Nodes")}`);
  workflow.nodes.forEach((nodeRef) => {
    const payload = getNormalizedNodePayload(loadedWorkflow.bundle, nodeRef.id);
    const purpose =
      payload?.description ??
      payload?.output?.description ??
      summarizePromptHelp(payload?.promptTemplate) ??
      resolveNodePurpose({
        nodeId: nodeRef.id,
        payload,
        workflow,
      });
    append(
      t`\n- ${nodeRef.id} (${formatNodeKindLabel(describeWorkflowNodeKind(nodeRef))})${
        purpose === undefined ? "" : `: ${truncate(purpose, 88)}`
      }`,
    );
  });

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
  const workflow = loadedWorkflow.bundle.workflow;
  const inputDetection = detectWorkflowInputMode(loadedWorkflow);
  const workflowCallIds = effectiveWorkflowCalls(workflow).map(
    (entry) => entry.id,
  );
  const stepIds = workflow.steps?.map((entry) => entry.id) ?? [];
  const nodeRegistryIds = effectiveNodeRegistryIds(workflow);
  const isStepAddressed = workflow.steps !== undefined;
  const identityLines = isStepAddressed
    ? [
        `Manager step: ${workflow.managerStepId ?? "(implicit or worker-only)"}`,
        `Entry step: ${workflow.entryStepId ?? "(not set; check workflow authorship)"}`,
      ]
    : [
        `Manager node: ${
          workflow.hasManagerNode === false
            ? "(none; worker-only workflow)"
            : buildLegacyManagerNodeDisplayLine(workflow)
        }`,
        `Entry node: ${
          buildLegacyEntryNodeDisplayLine(workflow)
        }`,
        ...(workflow.entryStepId === undefined
          ? []
          : [`Entry step: ${workflow.entryStepId}`]),
        ...(workflow.managerStepId === undefined
          ? []
          : [`Manager step: ${workflow.managerStepId}`]),
      ];
  return [
    `Workflow: ${workflow.workflowId}`,
    `Workflow name: ${loadedWorkflow.workflowName}`,
    ...(hasVisibleText(workflow.description)
      ? [`Description: ${workflow.description}`]
      : []),
    `Workflow directory: ${loadedWorkflow.workflowDirectory}`,
    `Artifact root: ${loadedWorkflow.artifactWorkflowRoot}`,
    ...identityLines,
    ...(workflow.steps === undefined
      ? []
      : [
          `Steps: ${String(stepIds.length)}`,
          `Step ids: ${stepIds.join(", ") || "(none)"}`,
        ]),
    ...(isStepAddressed || workflow.nodeRegistry !== undefined
      ? [
          `Node registry: ${String(nodeRegistryIds.length)}`,
          `Node registry ids: ${nodeRegistryIds.join(", ") || "(none)"}`,
        ]
      : []),
    `Workflow calls: ${String(workflowCallIds.length)}`,
    ...(workflowCallIds.length === 0
      ? []
      : [`Workflow call ids: ${workflowCallIds.join(", ")}`]),
    `Nodes: ${String(workflow.nodes.length)}`,
    `Input mode hint: ${inputDetection.mode}`,
    "",
    "Use the Nodes pane and press enter to inspect an individual node definition.",
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

export function buildWorkflowSelectorHistorySummary(input: {
  readonly latestRunSessionView?: RuntimeSessionView;
  readonly latestRunStatusError?: string;
  readonly selectedWorkflowName?: string;
  readonly sessions: readonly RuntimeSessionSummary[];
  readonly workflowFilterText: string;
  /** When true, execution-count copy refers to steps (step-addressed `workflow.json`). */
  readonly stepAddressedAuthoring?: boolean;
}): StyledText {
  if (input.selectedWorkflowName === undefined) {
    return t`${
      input.workflowFilterText.length === 0
        ? "No workflow is selected."
        : `No workflows match filter '${input.workflowFilterText}'.`
    }`;
  }

  const counts = input.sessions.reduce(
    (acc, session) => {
      switch (session.status) {
        case "completed":
          acc.success += 1;
          break;
        case "failed":
          acc.failed += 1;
          break;
        case "running":
          acc.running += 1;
          break;
        case "paused":
          acc.paused += 1;
          break;
        case "cancelled":
          acc.cancelled += 1;
          break;
      }
      return acc;
    },
    {
      cancelled: 0,
      failed: 0,
      paused: 0,
      running: 0,
      success: 0,
    },
  );

  const chunks: StyledText["chunks"] = [];
  const append = (value: StyledText): void => {
    chunks.push(...value.chunks);
  };

  append(
    t`${brightWhite("Workflow:")} ${bold(input.selectedWorkflowName)}\n${dim(
      `Runs: ${String(input.sessions.length)}`,
    )}\n\n`,
  );
  append(
    t`${brightWhite("Summary")}\n${brightGreen(
      `Success: ${String(counts.success)}`,
    )}  ${brightRed(`Failed: ${String(counts.failed)}`)}  ${fg("#7fc8ff")(
      `Running: ${String(counts.running)}`,
    )}\n${dim(
      `Paused: ${String(counts.paused)}  Cancelled: ${String(counts.cancelled)}`,
    )}`,
  );

  if (input.sessions.length === 0) {
    append(t`\n\n${dim("No recorded workflow runs for this workflow yet.")}`);
    return new StyledText(chunks);
  }

  const latestSession = input.sessions[0];
  if (latestSession === undefined) {
    return new StyledText(chunks);
  }
  const currentExecutionLines = buildCurrentExecutionLines({
    currentNodeId: latestSession.currentNodeId,
    currentStepId:
      input.latestRunSessionView === undefined
        ? (latestSession.currentStepId ?? null)
        : resolveCurrentStepId(input.latestRunSessionView.session),
    nodeLabel: "current node",
    stepLabel: "current step",
  });
  const latestRunResult = resolveWorkflowFinalResult(
    input.latestRunSessionView,
  );
  const executionCountLabel =
    input.stepAddressedAuthoring === true
      ? "step executions"
      : "node executions";
  append(
    t`\n\n${brightWhite("Latest Run")}\n${dim(
      [
        `sessionId: ${latestSession.sessionId}`,
        `status: ${formatStatusLabel(latestSession.status)}`,
        `started: ${formatTimestampForDisplay(latestSession.startedAt)}`,
        `updated: ${formatTimestampForDisplay(latestSession.updatedAt)}`,
        `ended: ${formatOptionalTimestampForDisplay(latestSession.endedAt)}`,
        ...currentExecutionLines,
        `${executionCountLabel}: ${String(latestSession.nodeExecutionCounter)}`,
      ].join("\n"),
    )}`,
  );

  if (hasVisibleText(latestSession.lastError ?? undefined)) {
    append(t`\nlast error: ${truncate(latestSession.lastError ?? "", 120)}`);
  }
  if (input.latestRunStatusError !== undefined) {
    append(t`\nstatus refresh note: ${input.latestRunStatusError}`);
  }
  append(
    t`\n\n${brightWhite("Output")}\n${formatLatestRunResultForDisplay({
      ...(input.latestRunStatusError === undefined
        ? {}
        : { latestRunStatusError: input.latestRunStatusError }),
      result: latestRunResult,
    })}`,
  );

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
    const payload = getNormalizedNodePayload(workflow.bundle, nodeRef.id);
    const purpose = resolveNodePurpose({
      nodeId: nodeRef.id,
      payload,
      workflow: workflow.bundle.workflow,
    });
    return buildNodeSelectOption({
      kind: describeWorkflowNodeKind(nodeRef),
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
  const stepAddr = input.loadedWorkflow?.bundle.workflow.steps !== undefined;
  if (input.loadedWorkflow === undefined || input.nodeId === undefined) {
    return {
      title: stepAddr ? " Node registry entry " : " Node Definition ",
      body: stepAddr
        ? "No node registry entry is selected."
        : "No workflow node is selected.",
    };
  }
  const nodeRef = input.loadedWorkflow.bundle.workflow.nodes.find(
    (entry) => entry.id === input.nodeId,
  );
  if (nodeRef === undefined) {
    return {
      title: stepAddr
        ? ` Node registry: ${input.nodeId} `
        : ` Node Definition: ${input.nodeId} `,
      body: stepAddr
        ? `Node registry entry '${input.nodeId}' was not found.`
        : `Workflow node '${input.nodeId}' was not found.`,
    };
  }
  const payload = getNormalizedNodePayload(
    input.loadedWorkflow.bundle,
    nodeRef.id,
  );
  return {
    title: stepAddr
      ? ` Node registry: ${input.nodeId} `
      : ` Node Definition: ${input.nodeId} `,
    body: [
      `Workflow: ${input.loadedWorkflow.bundle.workflow.workflowId}`,
      ...(stepAddr
        ? [
            `Registry node id: ${input.nodeId}`,
            `Node file: ${nodeRef.nodeFile}`,
            "",
            "workflow.json nodes[] entry",
          ]
        : [
            `Node: ${input.nodeId}`,
            `Node file: ${nodeRef.nodeFile}`,
            "",
            "workflow.json node entry",
          ]),
      stringifyJsonForDisplay(nodeRef),
      "",
      "node payload",
      stringifyJsonForDisplay(payload ?? null),
    ].join("\n"),
  };
}

export function buildWorkflowHistoryHeader(
  loadedWorkflow: LoadedWorkflow | undefined,
): StyledText {
  if (loadedWorkflow === undefined) {
    return t`${dim("No workflow loaded.")}`;
  }
  const workflowDescription = hasVisibleText(
    loadedWorkflow.bundle.workflow.description,
  )
    ? loadedWorkflow.bundle.workflow.description
    : undefined;
  const workflow = loadedWorkflow.bundle.workflow;
  const workflowCallCount = effectiveWorkflowCalls(workflow).length;
  const chunks: StyledText["chunks"] = [];
  chunks.push(
    ...t`${brightCyan(bold(loadedWorkflow.bundle.workflow.workflowId))}`.chunks,
  );
  if (workflowDescription !== undefined) {
    chunks.push(...t`\n${brightWhite(workflowDescription)}`.chunks);
  }
  chunks.push(
    ...t`\n${dim(
      `nodes=${String(workflow.nodes.length)}  workflowCalls=${String(workflowCallCount)}`,
    )}`.chunks,
  );
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
  return sessions.map((session) => {
    const startedAtLabel = formatTimestampForDisplay(session.startedAt);
    return {
      labelText: startedAtLabel,
      name: startedAtLabel,
      description: `run id: ${session.sessionId}`,
      statusColor: resolveOpenTuiStatusColor(session.status),
      statusLabel: formatStatusLabel(session.status),
      value: session.sessionId,
    };
  });
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
    const payload = getNormalizedNodePayload(workflow.bundle, execution.nodeId);
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
    });
  });
}

export function buildSummaryJsonSelectOptions(input: {
  readonly agentSessionSelection?: DetailAgentSessionSelection;
  readonly bundle: NodeDetailArtifactBundle;
  /** When true, unavailable-session copy refers to a step execution. */
  readonly stepAddressedAuthoring?: boolean;
}): ReadonlyArray<{
  readonly description: string;
  readonly name: string;
  readonly value: DetailAgentSessionSelection | DetailJsonViewerSelection;
}> {
  const execIn = summarizeJsonBlock(input.bundle.artifactInput);
  const inbox = summarizeJsonBlock(input.bundle.mailboxInput);
  const execOut = summarizeJsonBlock(input.bundle.artifactOutput);
  const mOut = summarizeJsonBlock(input.bundle.mailboxOutput);
  const execNoun =
    input.stepAddressedAuthoring === true ? "step execution" : "node execution";
  return [
    ...(input.agentSessionSelection === undefined
      ? []
      : [
          {
            name: input.agentSessionSelection.title,
            description:
              input.agentSessionSelection.available !== true
                ? `backend session id is unavailable for this ${execNoun}`
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
  const currentExecutionLines = buildCurrentExecutionLines({
    currentNodeId: input.session.currentNodeId,
    currentStepId: resolveCurrentStepId(input.session),
    nodeLabel: "Current node",
    stepLabel: "Current step",
  });
  const nodeLogs = input.nodeLogs.filter(
    (entry) => entry.nodeExecId === input.selectedExecution.nodeExecId,
  );
  return [
    `Workflow run: ${input.session.sessionId} status=${input.session.status}`,
    `Timezone: ${resolveSystemTimeZoneLabel()}`,
    `Workflow start: ${formatTimestampForDisplay(input.session.startedAt)}`,
    `Workflow end: ${formatOptionalTimestampForDisplay(input.session.endedAt)}`,
    `Node: ${input.selectedExecution.nodeId} [${kind}] status=${input.selectedExecution.status}`,
    ...(input.selectedExecution.stepId === undefined
      ? []
      : [`Step: ${input.selectedExecution.stepId}`]),
    ...(input.selectedExecution.nodeRegistryId === undefined
      ? []
      : [`Node registry: ${input.selectedExecution.nodeRegistryId}`]),
    `Node execution: ${input.selectedExecution.nodeExecId}`,
    `Node start: ${formatTimestampForDisplay(input.selectedExecution.startedAt)}`,
    `Node end: ${formatTimestampForDisplay(input.selectedExecution.endedAt)}`,
    `Artifact dir: ${input.selectedExecution.artifactDir}`,
    `Backend session: ${input.selectedExecution.backendSessionId ?? "(none)"}`,
    `Manager session: ${managerSessionId ?? "(not a manager node)"}`,
    ...currentExecutionLines,
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
      ...(hasVisibleText(input.loadedWorkflow.bundle.workflow.description)
        ? [`Description: ${input.loadedWorkflow.bundle.workflow.description}`]
        : []),
      `Input mode: ${detectWorkflowInputMode(input.loadedWorkflow).mode}`,
      `Pending session: ${input.sessionId ?? "(not started)"}`,
      input.statusError ?? "No run started yet.",
      "Press enter or ctrl-m from the input area to review and confirm the launch.",
    ].join("\n");
  }

  const session = input.runtimeSessionView.session;
  const finalResult = resolveWorkflowFinalResult(input.runtimeSessionView);
  const latestLog = input.runtimeSessionView.nodeLogs.at(-1);
  const currentExecutionLines = buildCurrentExecutionLines({
    currentNodeId: session.currentNodeId,
    currentStepId: resolveCurrentStepId(session),
    nodeLabel: "Current node",
    stepLabel: "Current step",
  });

  return [
    `Workflow: ${session.workflowName}`,
    `Session: ${session.sessionId}`,
    `Status: ${formatStatusLabel(session.status)}`,
    ...(hasVisibleText(input.loadedWorkflow.bundle.workflow.description)
      ? [`Description: ${input.loadedWorkflow.bundle.workflow.description}`]
      : []),
    `Started: ${formatTimestampForDisplay(session.startedAt)}`,
    `Ended: ${formatOptionalTimestampForDisplay(session.endedAt)}`,
    ...currentExecutionLines,
    `Node executions: ${String(session.nodeExecutions.length)}`,
    ...(session.lastError === undefined
      ? []
      : [`Last error: ${session.lastError}`]),
    ...(latestLog === undefined
      ? []
      : [
          `Latest log: ${formatTimestampForDisplay(latestLog.at)} ${latestLog.level.toUpperCase()} ${truncate(latestLog.message, 120)}`,
        ]),
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
    ...(finalResult === undefined
      ? []
      : ["Final result:", compactJson(finalResult, 800)]),
  ].join("\n");
}
