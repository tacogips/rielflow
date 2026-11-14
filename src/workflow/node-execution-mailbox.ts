import { mkdir } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJsonFile as writeJsonFile } from "../shared/fs";
import {
  normalizeManagerMessageForMailbox,
  normalizePlainTextValue,
} from "./json-boundary";
import type {
  JsonObject,
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

export interface NodeExecutionMailboxManagedChild {
  readonly kind: "sub-workflow" | "node";
  readonly id: string;
  readonly nodeKind?: string;
  readonly description?: string;
  readonly reason: string;
  readonly expectedReturn: string;
  readonly handoff?: string;
  readonly promptSeed?: string;
}

export interface NodeExecutionMailboxStructure {
  readonly type: "root-workflow" | "sub-workflow";
  readonly rootManagerNodeId?: string;
  readonly subWorkflows?: readonly {
    readonly id: string;
    readonly managerNodeId: string;
    readonly inputNodeId: string;
    readonly outputNodeId: string;
  }[];
  readonly nodes?: readonly {
    readonly id: string;
    readonly kind: string;
  }[];
  readonly subWorkflowId?: string;
  readonly description?: string;
  readonly managerNodeId?: string;
  readonly inputNodeId?: string;
  readonly outputNodeId?: string;
  readonly ownedNodeIds?: readonly string[];
}

export interface NodeExecutionMailboxMeta {
  readonly protocolVersion: 1;
  readonly mailboxDirEnvVar: "DIVEDRA_MAILBOX_DIR";
  readonly node: {
    readonly workflowId: string;
    readonly workflowDescription: string;
    readonly nodeId: string;
    readonly nodeKind: string;
  };
  readonly objective: {
    readonly reason: string;
    readonly expectedReturn: string;
    readonly instruction: string;
  };
  readonly paths: {
    readonly inputPath: "inbox/input.json";
    readonly inputFilesDir: "inbox/files";
    readonly outputPath: "outbox/output.json";
    readonly outputFilesDir: "outbox/files";
  };
  readonly input: {
    readonly kind: "json";
    readonly upstreamSources: readonly {
      readonly fromNodeId: string;
      readonly transitionWhen: string;
      readonly communicationId: string;
      readonly fromSubWorkflowId?: string;
      readonly toSubWorkflowId?: string;
    }[];
  };
  readonly output: {
    readonly kind: "json";
    readonly required: true;
    readonly path: "outbox/output.json";
    readonly filesDirectory: "outbox/files";
    readonly description?: string;
    readonly jsonSchema?: JsonObject;
  };
  readonly structure?: NodeExecutionMailboxStructure;
  readonly managedChildren?: readonly NodeExecutionMailboxManagedChild[];
  readonly managerControl?: {
    readonly preferredTransport: "divedra gql";
    readonly fallbackField: "managerControl";
    readonly supportedActions: readonly string[];
    readonly rules: readonly string[];
  };
}

export interface NodeExecutionMailboxInputPayload {
  readonly arguments: Readonly<Record<string, unknown>> | null;
  readonly humanInput?: unknown;
  readonly workflowOutput?: unknown;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly upstream: readonly PromptCompositionUpstreamInput[];
  readonly managerMessage?: unknown;
}

export interface NodeExecutionMailbox {
  readonly meta: NodeExecutionMailboxMeta;
  readonly input: NodeExecutionMailboxInputPayload;
}

export interface NodeExecutionMailboxArtifactPaths {
  readonly rootDir: string;
  readonly inboxDir: string;
  readonly outboxDir: string;
  readonly inputFilesDir: string;
  readonly outputFilesDir: string;
  readonly metaPath: string;
  readonly inputPath: string;
}

export interface BuildNodeExecutionMailboxInput {
  readonly workflow: WorkflowJson;
  readonly nodeRef: WorkflowNodeRef;
  readonly node: NodePayload;
  readonly nodePayloads: Readonly<Record<string, NodePayload>>;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly basePromptText: string;
  readonly assembledArguments: Readonly<Record<string, unknown>> | null;
  readonly upstreamInputs: readonly PromptCompositionUpstreamInput[];
  readonly managerMessage?: unknown;
}

function isManagerNodeKind(kind: NodeKind | undefined): boolean {
  return kind === "root-manager" || kind === "subworkflow-manager";
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
    case "subworkflow-manager":
      return ownedSubWorkflow === undefined
        ? "Coordinate the current sub-workflow scope."
        : `Coordinate sub-workflow '${ownedSubWorkflow.id}' and translate parent mailbox input into child-node work.`;
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
    case "subworkflow-manager":
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

function buildManagedChildren(input: {
  readonly workflow: WorkflowJson;
  readonly nodeRef: WorkflowNodeRef;
  readonly nodePayloads: Readonly<Record<string, NodePayload>>;
}): readonly NodeExecutionMailboxManagedChild[] {
  const { workflow, nodeRef, nodePayloads } = input;
  const children: NodeExecutionMailboxManagedChild[] = [];

  if (nodeRef.kind === "root-manager") {
    for (const subWorkflow of workflow.subWorkflows) {
      children.push({
        kind: "sub-workflow",
        id: subWorkflow.id,
        description: subWorkflow.description,
        reason: "Invoke this sub-workflow as one child unit that advances the workflow goal.",
        handoff:
          `Parent manager output is delivered by mailbox to manager '${subWorkflow.managerNodeId}', then translated within the child scope.`,
        expectedReturn: buildSubWorkflowExpectedReturn(
          workflow,
          subWorkflow.id,
          nodePayloads,
        ),
      });
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
      children.push({
        kind: "node",
        id: child.id,
        nodeKind: child.kind ?? "task",
        reason: buildNodeReason(child.kind, workflow, child.id),
        expectedReturn: buildExpectedReturn(child, payload),
        promptSeed: summarizeNodeExecutionSeed(payload),
      });
    }
    return children;
  }

  const ownedSubWorkflow = findOwnedSubWorkflow(workflow, nodeRef.id);
  if (ownedSubWorkflow === undefined) {
    return children;
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
    children.push({
      kind: "node",
      id: child.id,
      nodeKind: child.kind ?? "task",
      reason: buildNodeReason(child.kind, workflow, child.id),
      expectedReturn: buildExpectedReturn(child, payload),
      promptSeed: summarizeNodeExecutionSeed(payload),
    });
  }
  return children;
}

function buildMailboxStructure(input: {
  readonly workflow: WorkflowJson;
  readonly nodeId: string;
  readonly nodeKind: NodeKind | undefined;
}): NodeExecutionMailboxStructure | undefined {
  const ownedSubWorkflow = findOwnedSubWorkflow(input.workflow, input.nodeId);

  if (input.nodeKind === "root-manager") {
    return {
      type: "root-workflow",
      rootManagerNodeId: input.workflow.managerNodeId,
      subWorkflows: input.workflow.subWorkflows.map((subWorkflow) => ({
        id: subWorkflow.id,
        managerNodeId: subWorkflow.managerNodeId,
        inputNodeId: subWorkflow.inputNodeId,
        outputNodeId: subWorkflow.outputNodeId,
      })),
      nodes: input.workflow.nodes.map((node) => ({
        id: node.id,
        kind: node.kind ?? "task",
      })),
    };
  }

  if (ownedSubWorkflow !== undefined) {
    return {
      type: "sub-workflow",
      subWorkflowId: ownedSubWorkflow.id,
      description: ownedSubWorkflow.description,
      managerNodeId: ownedSubWorkflow.managerNodeId,
      inputNodeId: ownedSubWorkflow.inputNodeId,
      outputNodeId: ownedSubWorkflow.outputNodeId,
      ownedNodeIds: getSubWorkflowOwnedNodeIds(ownedSubWorkflow),
    };
  }

  return undefined;
}

export function buildNodeExecutionMailbox(
  input: BuildNodeExecutionMailboxInput,
): NodeExecutionMailbox {
  const reservedContextKeys = new Set([
    "humanInput",
    "workflowOutput",
    "workflowId",
    "workflowDescription",
    "nodeId",
    "nodeKind",
  ]);
  const contextualRuntimeVariables = Object.fromEntries(
    Object.entries(input.runtimeVariables).filter(
      ([key]) => !reservedContextKeys.has(key),
    ),
  );
  const managerControl = isManagerNodeKind(input.nodeRef.kind)
    ? {
        preferredTransport: "divedra gql" as const,
        fallbackField: "managerControl" as const,
        supportedActions: [
          "start-sub-workflow",
          "deliver-to-child-input",
          "retry-node",
        ] as const,
        rules: [
          "Use `start-sub-workflow` when the root manager chooses to invoke or re-invoke a sub-workflow as one child unit.",
          "Use `deliver-to-child-input` when a sub-workflow manager chooses to pass its instruction/output to an owned input node.",
          "Use `retry-node` when a prior child node result is insufficient and that node must run again.",
          "Root manager must not use `retry-node` for internal nodes owned by a sub-workflow; re-run that child unit with `start-sub-workflow` instead.",
          "Omit `managerControl` when no runtime control change is needed.",
        ] as const,
      }
    : undefined;
  const managedChildren = isManagerNodeKind(input.nodeRef.kind)
    ? buildManagedChildren({
        workflow: input.workflow,
        nodeRef: input.nodeRef,
        nodePayloads: input.nodePayloads,
      })
    : [];
  const structure = buildMailboxStructure({
    workflow: input.workflow,
    nodeId: input.nodeRef.id,
    nodeKind: input.nodeRef.kind,
  });

  return {
    meta: {
      protocolVersion: 1,
      mailboxDirEnvVar: "DIVEDRA_MAILBOX_DIR",
      node: {
        workflowId: input.workflow.workflowId,
        workflowDescription: input.workflow.description,
        nodeId: input.nodeRef.id,
        nodeKind: input.nodeRef.kind ?? "task",
      },
      objective: {
        reason: buildNodeReason(
          input.nodeRef.kind,
          input.workflow,
          input.nodeRef.id,
        ),
        expectedReturn: buildExpectedReturn(input.nodeRef, input.node),
        instruction: input.basePromptText.trim(),
      },
      paths: {
        inputPath: "inbox/input.json",
        inputFilesDir: "inbox/files",
        outputPath: "outbox/output.json",
        outputFilesDir: "outbox/files",
      },
      input: {
        kind: "json",
        upstreamSources: input.upstreamInputs.map((entry) => ({
          fromNodeId: entry.fromNodeId,
          transitionWhen: entry.transitionWhen,
          communicationId: entry.communicationId,
          ...(entry.fromSubWorkflowId === undefined
            ? {}
            : { fromSubWorkflowId: entry.fromSubWorkflowId }),
          ...(entry.toSubWorkflowId === undefined
            ? {}
            : { toSubWorkflowId: entry.toSubWorkflowId }),
        })),
      },
      output: {
        kind: "json",
        required: true,
        path: "outbox/output.json",
        filesDirectory: "outbox/files",
        ...(input.node.output?.description === undefined
          ? {}
          : { description: input.node.output.description }),
        ...(input.node.output?.jsonSchema === undefined
          ? {}
          : { jsonSchema: input.node.output.jsonSchema }),
      },
      ...(structure === undefined ? {} : { structure }),
      ...(managedChildren.length === 0 ? {} : { managedChildren }),
      ...(managerControl === undefined ? {} : { managerControl }),
    },
    input: {
      arguments: input.assembledArguments,
      ...(input.runtimeVariables["humanInput"] === undefined
        ? {}
        : {
            humanInput: normalizePlainTextValue(
              input.runtimeVariables["humanInput"],
            ),
          }),
      ...(input.runtimeVariables["workflowOutput"] === undefined
        ? {}
        : { workflowOutput: input.runtimeVariables["workflowOutput"] }),
      ...(Object.keys(contextualRuntimeVariables).length === 0
        ? {}
        : { runtimeVariables: contextualRuntimeVariables }),
      upstream: input.upstreamInputs,
      ...(input.managerMessage === undefined
        ? {}
        : {
            managerMessage: normalizeManagerMessageForMailbox(
              input.managerMessage,
            ),
          }),
    },
  };
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

function renderStructureSection(
  structure: NodeExecutionMailboxStructure | undefined,
): string {
  if (structure === undefined) {
    return "";
  }
  if (structure.type === "root-workflow") {
    const lines = ["Workflow structure:"];
    lines.push(`- Root manager: ${structure.rootManagerNodeId ?? ""}`);
    if ((structure.subWorkflows ?? []).length === 0) {
      lines.push("- Sub-workflows: none declared");
    } else {
      lines.push("- Sub-workflows:");
      for (const subWorkflow of structure.subWorkflows ?? []) {
        lines.push(
          `  - ${subWorkflow.id}: manager=${subWorkflow.managerNodeId}, input=${subWorkflow.inputNodeId}, output=${subWorkflow.outputNodeId}`,
        );
      }
    }
    lines.push("- Nodes:");
    for (const node of structure.nodes ?? []) {
      lines.push(`  - ${node.id} (${node.kind})`);
    }
    return lines.join("\n");
  }

  const lines = ["Current sub-workflow scope:"];
  lines.push(`- Sub-workflow: ${structure.subWorkflowId ?? ""}`);
  lines.push(`- Description: ${structure.description ?? ""}`);
  lines.push(`- Manager node: ${structure.managerNodeId ?? ""}`);
  lines.push(`- Input node: ${structure.inputNodeId ?? ""}`);
  lines.push(`- Output node: ${structure.outputNodeId ?? ""}`);
  if ((structure.ownedNodeIds ?? []).length > 0) {
    lines.push(`- Owned nodes: ${(structure.ownedNodeIds ?? []).join(", ")}`);
  }
  return lines.join("\n");
}

function renderManagedChildrenSection(
  children: readonly NodeExecutionMailboxManagedChild[] | undefined,
): string {
  if (children === undefined || children.length === 0) {
    return "";
  }
  const lines = ["Managed children in current scope:"];
  for (const child of children) {
    if (child.kind === "sub-workflow") {
      lines.push(`- Child sub-workflow: ${child.id}`);
      if (child.description !== undefined) {
        lines.push(`  description=${child.description}`);
      }
      lines.push(`  reason=${child.reason}`);
      if (child.handoff !== undefined) {
        lines.push(`  handoff=${child.handoff}`);
      }
      lines.push(`  expectedReturn=${child.expectedReturn}`);
      continue;
    }
    lines.push(`- Child node: ${child.id} (${child.nodeKind ?? "task"})`);
    lines.push(`  reason=${child.reason}`);
    lines.push(`  expectedReturn=${child.expectedReturn}`);
    if (child.promptSeed !== undefined) {
      lines.push(`  promptSeed=${child.promptSeed}`);
    }
  }
  return lines.join("\n");
}

function renderGivenDataSection(
  mailboxInput: NodeExecutionMailboxInputPayload,
): string {
  const lines = ["Given data:"];
  if (mailboxInput.arguments !== null) {
    lines.push(`- arguments=${summarizeJson(mailboxInput.arguments, 800)}`);
  }
  if (mailboxInput.humanInput !== undefined) {
    lines.push(`- humanInput=${summarizeJson(mailboxInput.humanInput, 800)}`);
  }
  if (mailboxInput.workflowOutput !== undefined) {
    lines.push(
      `- workflowOutput=${summarizeJson(mailboxInput.workflowOutput, 800)}`,
    );
  }
  if (
    mailboxInput.runtimeVariables !== undefined &&
    Object.keys(mailboxInput.runtimeVariables).length > 0
  ) {
    lines.push(
      `- runtimeVariables=${summarizeJson(mailboxInput.runtimeVariables, 800)}`,
    );
  }
  if (lines.length === 1) {
    lines.push(
      "- No assembled argument payload or runtime variables were provided for this execution.",
    );
  }
  return lines.join("\n");
}

function renderUpstreamSection(
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

function renderManagerControlSection(
  managerControl: NodeExecutionMailboxMeta["managerControl"],
): string {
  if (managerControl === undefined) {
    return "";
  }
  return [
    "Manager control payload:",
    "When `divedra gql` is available in the execution environment, prefer typed GraphQL manager actions over freeform control prose.",
    "Use payload `managerControl` only as the compatibility fallback when `divedra gql` is unavailable for that execution backend.",
    "Include workflow assessment in normal JSON fields, and place runtime control decisions under `managerControl`.",
    "Supported actions:",
    ...managerControl.supportedActions.map((action) =>
      action === "start-sub-workflow"
        ? '- `{"type":"start-sub-workflow","subWorkflowId":"<sub-workflow-id>"}`'
        : action === "deliver-to-child-input"
          ? '- `{"type":"deliver-to-child-input","inputNodeId":"<input-node-id>"}`'
          : '- `{"type":"retry-node","nodeId":"<node-id>"}`',
    ),
    "Rules:",
    ...managerControl.rules.map((rule) => `- ${rule}`),
  ].join("\n");
}

function renderManagerMessageSection(message: unknown): string {
  if (message === undefined) {
    return "";
  }
  return [
    "Manager inbox message:",
    typeof message === "string" ? message : JSON.stringify(message, null, 2),
  ].join("\n");
}

export function renderNodeExecutionMailboxPromptSections(
  mailbox: NodeExecutionMailbox,
): readonly string[] {
  const contextLines = [
    "Execution context:",
    `- Workflow ID: ${mailbox.meta.node.workflowId}`,
    `- Workflow purpose: ${mailbox.meta.node.workflowDescription}`,
    `- Node ID: ${mailbox.meta.node.nodeId}`,
    `- Node kind: ${mailbox.meta.node.nodeKind}`,
    `- Reason this node is running: ${mailbox.meta.objective.reason}`,
    `- Expected return: ${mailbox.meta.objective.expectedReturn}`,
  ];

  return [
    contextLines.join("\n"),
    renderStructureSection(mailbox.meta.structure),
    renderManagedChildrenSection(mailbox.meta.managedChildren),
    renderGivenDataSection(mailbox.input),
    renderUpstreamSection(mailbox.input.upstream),
    renderManagerControlSection(mailbox.meta.managerControl),
    renderManagerMessageSection(mailbox.input.managerMessage),
    `Node-specific instruction:\n${mailbox.meta.objective.instruction}`,
  ].filter((section) => section.trim().length > 0);
}

export function resolveNodeExecutionMailboxArtifactPaths(
  artifactDir: string,
): NodeExecutionMailboxArtifactPaths {
  const rootDir = path.join(artifactDir, "mailbox");
  const inboxDir = path.join(rootDir, "inbox");
  const outboxDir = path.join(rootDir, "outbox");
  return {
    rootDir,
    inboxDir,
    outboxDir,
    inputFilesDir: path.join(inboxDir, "files"),
    outputFilesDir: path.join(outboxDir, "files"),
    metaPath: path.join(inboxDir, "meta.json"),
    inputPath: path.join(inboxDir, "input.json"),
  };
}

export async function writeNodeExecutionMailboxArtifacts(
  artifactDir: string,
  mailbox: NodeExecutionMailbox,
): Promise<NodeExecutionMailboxArtifactPaths> {
  const paths = resolveNodeExecutionMailboxArtifactPaths(artifactDir);
  await mkdir(paths.inputFilesDir, { recursive: true });
  await mkdir(paths.outputFilesDir, { recursive: true });
  await writeJsonFile(paths.metaPath, mailbox.meta);
  await writeJsonFile(paths.inputPath, mailbox.input);
  return paths;
}
