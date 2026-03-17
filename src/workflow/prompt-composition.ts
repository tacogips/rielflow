import { readFileSync } from "node:fs";
import { buildPromptTemplateVariables } from "./prompt-template-context";
import { renderPromptTemplate } from "./render";
import type {
  NodeKind,
  NodePayload,
  WorkflowJson,
  WorkflowNodeRef,
} from "./types";

export interface PromptCompositionUpstreamInput {
  readonly fromNodeId: string;
  readonly fromSubWorkflowId?: string;
  readonly toSubWorkflowId?: string;
  readonly transitionWhen: string;
  readonly communicationId: string;
  readonly output: Readonly<Record<string, unknown>>;
  readonly outputRaw?: string;
}

export interface PromptCompositionInput {
  readonly workflow: WorkflowJson;
  readonly nodeRef: WorkflowNodeRef;
  readonly node: NodePayload;
  readonly nodePayloads: Readonly<Record<string, NodePayload>>;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly basePromptText: string;
  readonly assembledArguments: Readonly<Record<string, unknown>> | null;
  readonly upstreamInputs: readonly PromptCompositionUpstreamInput[];
}

const DEFAULT_OYAKATA_SYSTEM_PROMPT = readFileSync(
  new URL("./prompts/oyakata-system-prompt.md", import.meta.url),
  "utf8",
).trim();

function isManagerNodeKind(kind: NodeKind | undefined): boolean {
  return (
    kind === "manager" || kind === "root-manager" || kind === "sub-oyakata-manager"
  );
}

function getSubWorkflowOwnedNodeIds(
  subWorkflow: WorkflowJson["subWorkflows"][number],
): readonly string[] {
  return [
    ...new Set([
      subWorkflow.managerNodeId,
      subWorkflow.inputNodeId,
      subWorkflow.outputNodeId,
      ...subWorkflow.nodeIds,
    ]),
  ];
}

function findOwnedSubWorkflow(workflow: WorkflowJson, nodeId: string) {
  return workflow.subWorkflows.find((entry) =>
    getSubWorkflowOwnedNodeIds(entry).includes(nodeId),
  );
}

function summarizeJson(value: unknown, maxLength = 260): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return "null";
  }
  if (serialized.length <= maxLength) {
    return serialized;
  }
  return `${serialized.slice(0, maxLength - 3)}...`;
}

function summarizePromptTemplate(
  promptTemplate: string | undefined,
  maxLength = 220,
): string {
  if (promptTemplate === undefined || promptTemplate.length === 0) {
    return "(no prompt template)";
  }
  const compact = promptTemplate.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 3)}...`;
}

function summarizeNodeExecutionSeed(node: NodePayload): string {
  if ((node.nodeType ?? "agent") === "container") {
    return "opaque container execution";
  }
  if (node.nodeType === "command") {
    return "direct command execution";
  }
  return summarizePromptTemplate(node.promptTemplate);
}

function buildNodeReason(
  nodeKind: NodeKind | undefined,
  workflow: WorkflowJson,
  nodeId: string,
): string {
  const ownedSubWorkflow = findOwnedSubWorkflow(workflow, nodeId);

  switch (nodeKind) {
    case "root-manager":
      return "Coordinate the overall workflow plan, sub-workflow dispatch, output assessment, and retry decisions.";
    case "sub-oyakata-manager":
      return ownedSubWorkflow === undefined
        ? "Coordinate the current sub-workflow scope."
        : `Coordinate sub-workflow '${ownedSubWorkflow.id}' and translate parent mailbox input into child-node work.`;
    case "manager":
      return "Coordinate manager-owned routing and control decisions for this workflow scope.";
    case "input":
      return "Convert received mailbox/runtime input into a clean workflow-scoped input payload for downstream work.";
    case "output":
      return "Assemble the final result for the current workflow or sub-workflow boundary.";
    case "branch-judge":
      return "Judge branch conditions so downstream routing matches the workflow goal.";
    case "loop-judge":
      return "Judge whether the current work should loop for rework or exit the loop.";
    case "task":
    default:
      return "Execute the assigned work step because it contributes a required intermediate result in the workflow.";
  }
}

function buildExpectedReturn(
  nodeRef: WorkflowNodeRef,
  node: NodePayload,
): string {
  if (
    node.output?.description !== undefined &&
    node.output.description.length > 0
  ) {
    return node.output.description;
  }

  switch (nodeRef.kind) {
    case "root-manager":
    case "sub-oyakata-manager":
    case "manager":
      return "Return a manager assessment/plan JSON object that records the current state, what was judged, and what should happen next.";
    case "input":
      return "Return normalized input JSON for the owned workflow scope.";
    case "output":
      return "Return the finalized workflow or sub-workflow output JSON.";
    case "branch-judge":
      return "Return a JSON object with branch decision signals used by outgoing edges.";
    case "loop-judge":
      return "Return a JSON object with loop decision signals used by loop continue/exit edges.";
    case "task":
    default:
      return "Return the business JSON object produced by this work step for downstream consumers.";
  }
}

function buildSubWorkflowExpectedReturn(
  workflow: WorkflowJson,
  subWorkflowId: string,
  nodePayloads: Readonly<Record<string, NodePayload>>,
): string {
  const subWorkflow = workflow.subWorkflows.find(
    (entry) => entry.id === subWorkflowId,
  );
  if (subWorkflow === undefined) {
    return "Return the finalized sub-workflow output JSON to the parent workflow mailbox boundary.";
  }

  const outputNode = workflow.nodes.find(
    (entry) => entry.id === subWorkflow.outputNodeId,
  );
  const outputPayload = nodePayloads[subWorkflow.outputNodeId];
  if (outputNode !== undefined && outputPayload !== undefined) {
    return buildExpectedReturn(outputNode, outputPayload);
  }
  return "Return the finalized sub-workflow output JSON to the parent workflow mailbox boundary.";
}

function buildManagerChildCatalog(input: {
  readonly workflow: WorkflowJson;
  readonly nodeRef: WorkflowNodeRef;
  readonly nodePayloads: Readonly<Record<string, NodePayload>>;
}): string {
  const { workflow, nodeRef, nodePayloads } = input;
  const lines = ["Managed children in current scope:"];

  if (nodeRef.kind === "root-manager") {
    if (workflow.subWorkflows.length > 0) {
      for (const subWorkflow of workflow.subWorkflows) {
        lines.push(`- Child sub-workflow: ${subWorkflow.id}`);
        lines.push(`  description=${subWorkflow.description}`);
        lines.push(
          `  reason=Invoke this sub-workflow as one child unit that advances the workflow goal.`,
        );
        lines.push(
          `  handoff=Parent manager output is delivered by mailbox to manager '${subWorkflow.managerNodeId}', then translated within the child scope.`,
        );
        lines.push(
          `  expectedReturn=${buildSubWorkflowExpectedReturn(workflow, subWorkflow.id, nodePayloads)}`,
        );
      }
    }

    const ownedNodeIds = new Set(
      workflow.subWorkflows.flatMap((subWorkflow) =>
        getSubWorkflowOwnedNodeIds(subWorkflow),
      ),
    );
    const directChildren = workflow.nodes.filter(
      (entry) => entry.id !== nodeRef.id && !ownedNodeIds.has(entry.id),
    );
    for (const child of directChildren) {
      const payload = nodePayloads[child.id];
      if (payload === undefined) {
        continue;
      }
      lines.push(`- Child node: ${child.id} (${child.kind ?? "task"})`);
      lines.push(`  reason=${buildNodeReason(child.kind, workflow, child.id)}`);
      lines.push(`  expectedReturn=${buildExpectedReturn(child, payload)}`);
      lines.push(`  promptSeed=${summarizeNodeExecutionSeed(payload)}`);
    }
  } else {
    const ownedSubWorkflow = findOwnedSubWorkflow(workflow, nodeRef.id);
    if (ownedSubWorkflow === undefined) {
      return "";
    }

    const childNodeIds = getSubWorkflowOwnedNodeIds(ownedSubWorkflow).filter(
      (childNodeId) => childNodeId !== nodeRef.id,
    );
    for (const childNodeId of childNodeIds) {
      const child = workflow.nodes.find((entry) => entry.id === childNodeId);
      const payload = nodePayloads[childNodeId];
      if (child === undefined || payload === undefined) {
        continue;
      }
      lines.push(`- Child node: ${child.id} (${child.kind ?? "task"})`);
      lines.push(`  reason=${buildNodeReason(child.kind, workflow, child.id)}`);
      lines.push(`  expectedReturn=${buildExpectedReturn(child, payload)}`);
      lines.push(`  promptSeed=${summarizeNodeExecutionSeed(payload)}`);
    }
  }

  return lines.length === 1 ? "" : lines.join("\n");
}

function buildWorkflowStructureSummary(input: {
  readonly workflow: WorkflowJson;
  readonly nodeId: string;
  readonly nodeKind: NodeKind | undefined;
}): string {
  const ownedSubWorkflow = findOwnedSubWorkflow(input.workflow, input.nodeId);
  const lines: string[] = [];

  if (input.nodeKind === "root-manager") {
    lines.push("Workflow structure:");
    lines.push(`- Root manager: ${input.workflow.managerNodeId}`);
    if (input.workflow.subWorkflows.length === 0) {
      lines.push("- Sub-workflows: none declared");
    } else {
      lines.push("- Sub-workflows:");
      for (const subWorkflow of input.workflow.subWorkflows) {
        lines.push(
          `  - ${subWorkflow.id}: manager=${subWorkflow.managerNodeId}, input=${subWorkflow.inputNodeId}, output=${subWorkflow.outputNodeId}`,
        );
      }
    }
    lines.push("- Nodes:");
    for (const node of input.workflow.nodes) {
      lines.push(`  - ${node.id} (${node.kind ?? "task"})`);
    }
    return lines.join("\n");
  }

  if (ownedSubWorkflow !== undefined) {
    lines.push("Current sub-workflow scope:");
    lines.push(`- Sub-workflow: ${ownedSubWorkflow.id}`);
    lines.push(`- Description: ${ownedSubWorkflow.description}`);
    lines.push(`- Manager node: ${ownedSubWorkflow.managerNodeId}`);
    lines.push(`- Input node: ${ownedSubWorkflow.inputNodeId}`);
    lines.push(`- Output node: ${ownedSubWorkflow.outputNodeId}`);
    if (ownedSubWorkflow.nodeIds.length > 0) {
      lines.push(`- Owned nodes: ${ownedSubWorkflow.nodeIds.join(", ")}`);
    }
    return lines.join("\n");
  }

  return "";
}

function buildUpstreamSummary(
  upstreamInputs: readonly PromptCompositionUpstreamInput[],
): string {
  if (upstreamInputs.length === 0) {
    return "Upstream data:\n- No mailbox or upstream node payloads were attached to this execution.";
  }

  const lines = ["Upstream data:"];
  for (const entry of upstreamInputs) {
    const routeParts = [
      `from=${entry.fromNodeId}`,
      `when=${entry.transitionWhen}`,
      `communication=${entry.communicationId}`,
    ];
    if (entry.fromSubWorkflowId !== undefined) {
      routeParts.push(`fromSubWorkflow=${entry.fromSubWorkflowId}`);
    }
    if (entry.toSubWorkflowId !== undefined) {
      routeParts.push(`toSubWorkflow=${entry.toSubWorkflowId}`);
    }
    lines.push(`- ${routeParts.join(", ")}`);
    lines.push(`  payload=${summarizeJson(entry.output)}`);
  }
  return lines.join("\n");
}

function buildGivenDataSummary(input: {
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly assembledArguments: Readonly<Record<string, unknown>> | null;
}): string {
  const lines = ["Given data:"];
  const reservedContextKeys = new Set([
    "humanInput",
    "workflowOutput",
    "workflowId",
    "workflowDescription",
    "nodeId",
    "nodeKind",
  ]);
  const runtimeVariableKeys = Object.keys(input.runtimeVariables);

  if (input.assembledArguments !== null) {
    lines.push(`- arguments=${summarizeJson(input.assembledArguments, 800)}`);
  }

  if (runtimeVariableKeys.length === 0) {
    if (input.assembledArguments === null) {
      lines.push(
        "- No assembled argument payload or runtime variables were provided for this execution.",
      );
    }
    return lines.join("\n");
  }

  const humanInput = input.runtimeVariables["humanInput"];
  if (humanInput !== undefined) {
    lines.push(`- humanInput=${summarizeJson(humanInput, 800)}`);
  }

  const workflowOutput = input.runtimeVariables["workflowOutput"];
  if (workflowOutput !== undefined) {
    lines.push(`- workflowOutput=${summarizeJson(workflowOutput, 800)}`);
  }

  const contextualVariables = Object.fromEntries(
    Object.entries(input.runtimeVariables).filter(
      ([key]) => !reservedContextKeys.has(key),
    ),
  );
  if (Object.keys(contextualVariables).length > 0) {
    lines.push(`- runtimeVariables=${summarizeJson(contextualVariables, 800)}`);
  }

  return lines.join("\n");
}

function buildManagerControlSchemaSummary(): string {
  return [
    "Manager control payload:",
    "When `oyakata gql` is available in the execution environment, prefer typed GraphQL manager actions over freeform control prose.",
    "Use payload `managerControl` only as the compatibility fallback when `oyakata gql` is unavailable for that execution backend.",
    "Include workflow assessment in normal JSON fields, and place runtime control decisions under `managerControl`.",
    "Supported actions:",
    '- `{"type":"start-sub-workflow","subWorkflowId":"<sub-workflow-id>"}`',
    '- `{"type":"deliver-to-child-input","inputNodeId":"<input-node-id>"}`',
    '- `{"type":"retry-node","nodeId":"<node-id>"}`',
    "Rules:",
    "- Use `start-sub-workflow` when the root manager chooses to invoke or re-invoke a sub-workflow as one child unit.",
    "- Use `deliver-to-child-input` when a sub-workflow manager chooses to pass its instruction/output to an owned input node.",
    "- Use `retry-node` when a prior child node result is insufficient and that node must run again.",
    "- Root manager must not use `retry-node` for internal nodes owned by a sub-workflow; re-run that child unit with `start-sub-workflow` instead.",
    "- Omit `managerControl` when no runtime control change is needed.",
  ].join("\n");
}

export function composeExecutionPrompt(input: PromptCompositionInput): string {
  const mergedVariables = buildPromptTemplateVariables({
    nodeVariables: input.node.variables,
    runtimeVariables: input.runtimeVariables,
    workflowId: input.workflow.workflowId,
    workflowDescription: input.workflow.description,
    nodeId: input.nodeRef.id,
    ...(input.nodeRef.kind === undefined ? {} : { nodeKind: input.nodeRef.kind }),
    upstream: input.upstreamInputs.map((entry) => ({
      fromNodeId: entry.fromNodeId,
      ...(entry.fromSubWorkflowId === undefined
        ? {}
        : { fromSubWorkflowId: entry.fromSubWorkflowId }),
      ...(entry.toSubWorkflowId === undefined
        ? {}
        : { toSubWorkflowId: entry.toSubWorkflowId }),
      transitionWhen: entry.transitionWhen,
      communicationId: entry.communicationId,
      output: entry.output,
      ...(entry.outputRaw === undefined ? {} : { outputRaw: entry.outputRaw }),
    })),
  });
  const workflowPrompt =
    input.workflow.prompts?.oyakataPromptTemplate === undefined
      ? ""
      : renderPromptTemplate(
          input.workflow.prompts.oyakataPromptTemplate,
          mergedVariables,
        ).trim();
  const workerSystemPrompt =
    input.workflow.prompts?.workerSystemPromptTemplate === undefined
      ? ""
      : renderPromptTemplate(
          input.workflow.prompts.workerSystemPromptTemplate,
          mergedVariables,
        ).trim();

  const contextLines = [
    "Execution context:",
    `- Workflow ID: ${input.workflow.workflowId}`,
    `- Workflow purpose: ${input.workflow.description}`,
    `- Node ID: ${input.nodeRef.id}`,
    `- Node kind: ${input.nodeRef.kind ?? "task"}`,
    `- Reason this node is running: ${buildNodeReason(input.nodeRef.kind, input.workflow, input.nodeRef.id)}`,
    `- Expected return: ${buildExpectedReturn(input.nodeRef, input.node)}`,
  ];
  const structureSummary = buildWorkflowStructureSummary({
    workflow: input.workflow,
    nodeId: input.nodeRef.id,
    nodeKind: input.nodeRef.kind,
  });

  const sections = isManagerNodeKind(input.nodeRef.kind)
    ? [DEFAULT_OYAKATA_SYSTEM_PROMPT, workflowPrompt]
    : [workerSystemPrompt];

  sections.push(contextLines.join("\n"));
  if (structureSummary.length > 0) {
    sections.push(structureSummary);
  }
  if (isManagerNodeKind(input.nodeRef.kind)) {
    const childCatalog = buildManagerChildCatalog({
      workflow: input.workflow,
      nodeRef: input.nodeRef,
      nodePayloads: input.nodePayloads,
    });
    if (childCatalog.length > 0) {
      sections.push(childCatalog);
    }
  }
  sections.push(
    buildGivenDataSummary({
      runtimeVariables: input.runtimeVariables,
      assembledArguments: input.assembledArguments,
    }),
  );
  sections.push(buildUpstreamSummary(input.upstreamInputs));
  if (isManagerNodeKind(input.nodeRef.kind)) {
    sections.push(buildManagerControlSchemaSummary());
  }
  sections.push(`Node-specific instruction:\n${input.basePromptText.trim()}`);

  return sections.filter((entry) => entry.trim().length > 0).join("\n\n");
}
