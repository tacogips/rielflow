import { readFileSync } from "node:fs";
import { buildPromptTemplateVariables } from "./prompt-template-context";
import { renderPromptTemplate } from "./render";
import {
  buildNodeExecutionMailbox,
  renderNodeExecutionMailboxPromptSections,
  type NodeExecutionMailbox,
  type PromptCompositionUpstreamInput,
} from "./node-execution-mailbox";
import type { NodeKind, NodePayload, WorkflowJson, WorkflowNodeRef } from "./types";

export interface PromptCompositionInput {
  readonly workflow: WorkflowJson;
  readonly nodeRef: WorkflowNodeRef;
  readonly node: NodePayload;
  readonly nodePayloads: Readonly<Record<string, NodePayload>>;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly basePromptText: string;
  readonly assembledArguments: Readonly<Record<string, unknown>> | null;
  readonly upstreamInputs: readonly PromptCompositionUpstreamInput[];
  readonly executionMailbox?: NodeExecutionMailbox;
  readonly managerMessage?: unknown;
}

const DEFAULT_DIVEDRA_SYSTEM_PROMPT = readFileSync(
  new URL("./prompts/divedra-system-prompt.md", import.meta.url),
  "utf8",
).trim();

function isManagerNodeKind(kind: NodeKind | undefined): boolean {
  return (
    kind === "manager" ||
    kind === "root-manager" ||
    kind === "sub-divedra-manager"
  );
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
    input.workflow.prompts?.divedraPromptTemplate === undefined
      ? ""
      : renderPromptTemplate(
          input.workflow.prompts.divedraPromptTemplate,
          mergedVariables,
        ).trim();
  const workerSystemPrompt =
    input.workflow.prompts?.workerSystemPromptTemplate === undefined
      ? ""
      : renderPromptTemplate(
          input.workflow.prompts.workerSystemPromptTemplate,
          mergedVariables,
        ).trim();

  const sections = isManagerNodeKind(input.nodeRef.kind)
    ? [DEFAULT_DIVEDRA_SYSTEM_PROMPT, workflowPrompt]
    : [workerSystemPrompt];

  const executionMailbox =
    input.executionMailbox === undefined
      ? buildNodeExecutionMailbox({
          workflow: input.workflow,
          nodeRef: input.nodeRef,
          node: input.node,
          nodePayloads: input.nodePayloads,
          runtimeVariables: input.runtimeVariables,
          basePromptText: input.basePromptText,
          assembledArguments: input.assembledArguments,
          upstreamInputs: input.upstreamInputs,
          ...(input.managerMessage === undefined
            ? {}
            : { managerMessage: input.managerMessage }),
        })
      : input.managerMessage === undefined
        ? input.executionMailbox
        : {
            ...input.executionMailbox,
            input: {
              ...input.executionMailbox.input,
              managerMessage: input.managerMessage,
            },
          };
  sections.push(...renderNodeExecutionMailboxPromptSections(executionMailbox));

  return sections.filter((entry) => entry.trim().length > 0).join("\n\n");
}
