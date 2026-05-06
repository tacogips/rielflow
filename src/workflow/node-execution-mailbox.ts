import { mkdir } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJsonFile as writeJsonFile } from "../shared/fs";
import { isAdapterExecutionOutputEnvelope } from "./adapter";
import {
  normalizeManagerMessageForMailbox,
  normalizePlainTextValue,
} from "./json-boundary";
import { effectiveCrossWorkflowDispatches } from "./cross-workflow-from-steps";
import { describeWorkflowNodeKind, isManagerNodeRef } from "./node-role";
import {
  toStepIdentityFields,
  type StepIdentityFields,
} from "./runtime-addressing";
import {
  resolveWorkflowManagerStepId,
  type JsonObject,
  type NodePayload,
  type WorkflowJson,
  type WorkflowNodeRef,
} from "./types";

export interface PromptCompositionUpstreamInput {
  readonly fromNodeId: string;
  readonly transitionWhen: string;
  readonly communicationId: string;
  readonly output: Readonly<Record<string, unknown>>;
  readonly outputRaw?: string;
}

export interface PromptCompositionLatestOutput {
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly status: string;
  readonly artifactDir: string;
  readonly payload: unknown;
  readonly stepId?: string;
  readonly nodeRegistryId?: string;
  readonly mailboxInstanceId?: string;
}

export interface NodeExecutionMailboxManagedChild {
  readonly id: string;
  readonly nodeKind?: string;
  readonly reason: string;
  readonly expectedReturn: string;
  readonly promptSeed?: string;
}

/**
 * High-level view of the workflow graph for manager mailboxes for the current
 * workflow execution. Cross-workflow calls are separate executions.
 */
export interface NodeExecutionMailboxStructure {
  /** Step-addressed mailbox structure discriminant for the current workflow run. */
  readonly type: "workflow-run";
  /**
   * Manager step id (`resolveWorkflowManagerStepId`) in the same step-id space
   * as the workflow queue.
   */
  readonly managerStepId?: string;
  readonly nodes?: readonly {
    readonly id: string;
    readonly kind: string;
  }[];
}

export interface NodeExecutionMailboxMeta {
  readonly protocolVersion: 1;
  readonly mailboxDirEnvVar: "DIVEDRA_MAILBOX_DIR";
  readonly mailboxInstanceId?: string;
  readonly node: {
    readonly workflowId: string;
    readonly workflowDescription: string;
    readonly nodeId: string;
    readonly nodeKind: string;
  } & StepIdentityFields;
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
  readonly latestOutputs?: readonly PromptCompositionLatestOutput[];
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

export interface BuildNodeExecutionMailboxInput extends StepIdentityFields {
  readonly workflow: WorkflowJson;
  readonly nodeRef: WorkflowNodeRef;
  readonly node: NodePayload;
  readonly mailboxInstanceId?: string;
  readonly nodePayloads: Readonly<Record<string, NodePayload>>;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly basePromptText: string;
  readonly assembledArguments: Readonly<Record<string, unknown>> | null;
  readonly upstreamInputs: readonly PromptCompositionUpstreamInput[];
  readonly latestOutputs?: readonly PromptCompositionLatestOutput[];
  readonly managerMessage?: unknown;
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
  if (node.nodeType === "addon") {
    return "built-in add-on execution";
  }
  return summarizePromptTemplate(node.promptTemplate);
}

function buildNodeReason(
  nodeRef: Pick<WorkflowNodeRef, "kind" | "role" | "control">,
  workflow: WorkflowJson,
): string {
  if (isManagerNodeRef(nodeRef)) {
    return effectiveCrossWorkflowDispatches(workflow).length > 0
      ? "Coordinate the current workflow plan, worker execution, cross-workflow dispatch decisions, output assessment, and retry decisions."
      : "Coordinate the current workflow plan, worker execution, output assessment, and retry decisions.";
  }

  switch (nodeRef.kind ?? nodeRef.control) {
    case "input":
      return "Convert received mailbox/runtime input into a clean workflow-scoped input payload for downstream work.";
    case "output":
      return "Assemble the final result for the current workflow.";
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

  if (isManagerNodeRef(nodeRef)) {
    return "Return a manager assessment/plan JSON object that records the current state, what was judged, and what should happen next.";
  }

  switch (nodeRef.kind ?? nodeRef.control) {
    case "input":
      return "Return normalized input JSON for the owned workflow scope.";
    case "output":
      return "Return the finalized workflow output JSON.";
    case "branch-judge":
      return "Return a JSON object with branch decision signals used by outgoing edges.";
    case "loop-judge":
      return "Return a JSON object with loop decision signals used by loop continue/exit edges.";
    case "task":
    default:
      return "Return the business JSON object produced by this work step for downstream consumers.";
  }
}

function buildManagedChildren(input: {
  readonly workflow: WorkflowJson;
  readonly nodeRef: WorkflowNodeRef;
  readonly nodePayloads: Readonly<Record<string, NodePayload>>;
}): readonly NodeExecutionMailboxManagedChild[] {
  const { workflow, nodeRef, nodePayloads } = input;
  const children: NodeExecutionMailboxManagedChild[] = [];

  if (isManagerNodeRef(nodeRef)) {
    const directChildren = workflow.nodes.filter(
      (entry) => entry.id !== nodeRef.id,
    );
    for (const child of directChildren) {
      const payload = nodePayloads[child.id];
      if (payload === undefined) {
        continue;
      }
      children.push({
        id: child.id,
        nodeKind: describeWorkflowNodeKind(child),
        reason: buildNodeReason(child, workflow),
        expectedReturn: buildExpectedReturn(child, payload),
        promptSeed: summarizeNodeExecutionSeed(payload),
      });
    }
    return children;
  }
  return children;
}

function buildMailboxStructure(input: {
  readonly workflow: WorkflowJson;
  readonly nodeRef: Pick<WorkflowNodeRef, "id" | "kind" | "role" | "control">;
}): NodeExecutionMailboxStructure | undefined {
  if (isManagerNodeRef(input.nodeRef)) {
    return {
      type: "workflow-run",
      managerStepId: resolveWorkflowManagerStepId(input.workflow),
      nodes: input.workflow.nodes.map((node) => ({
        id: node.id,
        kind: describeWorkflowNodeKind(node),
      })),
    };
  }

  return undefined;
}

function buildManagerControlMetadata(input: {
  readonly workflow: WorkflowJson;
  readonly nodeRef: WorkflowNodeRef;
}): NodeExecutionMailboxMeta["managerControl"] | undefined {
  if (!isManagerNodeRef(input.nodeRef)) {
    return undefined;
  }

  return {
    preferredTransport: "divedra gql",
    fallbackField: "managerControl",
    supportedActions: [
      "retry-step",
      "replay-communication",
      "execute-optional-step",
      "skip-optional-step",
    ],
    rules: [
      "Manager scope is limited to the current workflow execution.",
      "Use `retry-step` with the execution step id when a prior worker result is insufficient and that step must run again.",
      "Use `replay-communication` to redeliver an existing communication within the current workflow execution.",
      "Use `execute-optional-step` or `skip-optional-step` only for pending optional steps owned by this manager.",
      "Cross-workflow calls (step-addressed: `steps[].transitions` with `toWorkflowId` and `resumeStepId`) run automatically from the caller step.",
      "Omit `managerControl` when no runtime control change is needed.",
    ],
  };
}

export function buildNodeExecutionMailbox(
  input: BuildNodeExecutionMailboxInput,
): NodeExecutionMailbox {
  const stepIdentityFields = toStepIdentityFields(input);
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
  const managerControl = buildManagerControlMetadata({
    workflow: input.workflow,
    nodeRef: input.nodeRef,
  });
  const managedChildren = isManagerNodeRef(input.nodeRef)
    ? buildManagedChildren({
        workflow: input.workflow,
        nodeRef: input.nodeRef,
        nodePayloads: input.nodePayloads,
      })
    : [];
  const structure = buildMailboxStructure({
    workflow: input.workflow,
    nodeRef: input.nodeRef,
  });

  return {
    meta: {
      protocolVersion: 1,
      mailboxDirEnvVar: "DIVEDRA_MAILBOX_DIR",
      ...(input.mailboxInstanceId === undefined
        ? {}
        : { mailboxInstanceId: input.mailboxInstanceId }),
      node: {
        workflowId: input.workflow.workflowId,
        workflowDescription: input.workflow.description,
        nodeId: input.nodeRef.id,
        ...stepIdentityFields,
        nodeKind: describeWorkflowNodeKind(input.nodeRef),
      },
      objective: {
        reason: buildNodeReason(input.nodeRef, input.workflow),
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
      ...(input.latestOutputs === undefined || input.latestOutputs.length === 0
        ? {}
        : { latestOutputs: input.latestOutputs }),
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
  const lines = ["Workflow structure:"];
  lines.push(`- Manager execution id: ${structure.managerStepId ?? ""}`);
  lines.push("- Nodes:");
  for (const node of structure.nodes ?? []) {
    lines.push(`  - ${node.id} (${node.kind})`);
  }
  return lines.join("\n");
}

function renderManagedChildrenSection(
  children: readonly NodeExecutionMailboxManagedChild[] | undefined,
): string {
  if (children === undefined || children.length === 0) {
    return "";
  }
  const lines = ["Other nodes in this workflow:"];
  for (const child of children) {
    lines.push(`- Node: ${child.id} (${child.nodeKind ?? "task"})`);
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
    lines.push(`- ${routeParts.join(", ")}`);
    lines.push(
      `  payload=${summarizeJson(resolvePromptSummaryPayload(entry.output))}`,
    );
  }
  return lines.join("\n");
}

function renderLatestOutputsSection(
  latestOutputs: readonly PromptCompositionLatestOutput[] | undefined,
): string {
  if (latestOutputs === undefined || latestOutputs.length === 0) {
    return "";
  }

  const lines = [
    "Latest completed step outputs:",
    "- Full structured records are available in mailbox input field `latestOutputs`.",
  ];
  for (const entry of latestOutputs) {
    const identityParts = [
      `node=${entry.nodeId}`,
      entry.stepId === undefined ? undefined : `step=${entry.stepId}`,
      `exec=${entry.nodeExecId}`,
      `status=${entry.status}`,
    ].filter((part): part is string => part !== undefined);
    lines.push(`- ${identityParts.join(", ")}`);
    lines.push(`  artifactDir=${entry.artifactDir}`);
    lines.push(`  payload=${summarizeJson(entry.payload)}`);
  }
  return lines.join("\n");
}

function resolvePromptSummaryPayload(
  output: Readonly<Record<string, unknown>>,
): unknown {
  if (!isAdapterExecutionOutputEnvelope(output)) {
    return output;
  }

  if (output.completionPassed) {
    return output.payload;
  }

  return {
    completionPassed: output.completionPassed,
    when: output.when,
    payload: output.payload,
    ...pickDefinedFields(output, ["error", "validationErrors"]),
  };
}

function pickDefinedFields(
  output: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Readonly<Record<string, unknown>> {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (output[field] !== undefined) {
      picked[field] = output[field];
    }
  }
  return picked;
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
    "Use payload `managerControl` when typed GraphQL manager actions are unavailable for that execution backend (e.g. no `divedra gql` in the environment).",
    "Include workflow assessment in normal JSON fields, and place runtime control decisions under `managerControl`.",
    "Supported actions:",
    ...managerControl.supportedActions.map((action) =>
      action === "retry-step"
        ? '- `{"type":"retry-step","stepId":"<step-id>"}`'
        : action === "replay-communication"
          ? '- `{"type":"replay-communication","communicationId":"<communication-id>","reason":"<optional-reason>"}`'
          : action === "execute-optional-step"
            ? '- `{"type":"execute-optional-step","stepId":"<step-id>"}`'
            : '- `{"type":"skip-optional-step","stepId":"<step-id>","reason":"<optional-reason>"}`',
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
    renderLatestOutputsSection(mailbox.input.latestOutputs),
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
