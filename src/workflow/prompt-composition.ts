import { readFileSync } from "node:fs";
import { describeWorkflowNodeKind, isManagerNodeRef } from "./node-role";
import { buildPromptTemplateVariables } from "./prompt-template-context";
import { renderPromptTemplate } from "./render";
import {
  buildNodeExecutionMailbox,
  renderNodeExecutionMailboxPromptSections,
  type NodeExecutionMailbox,
  type PromptCompositionUpstreamInput,
} from "./node-execution-mailbox";
import type { NodePayload, WorkflowJson, WorkflowNodeRef } from "./types";

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

export interface ComposedExecutionPrompts {
  readonly systemPromptText?: string;
  readonly promptText: string;
}

/** Default manager system guidance (single path; structural alternate prompt removed). */
const DEFAULT_DIVEDRA_ROLE_SYSTEM_PROMPT = readFileSync(
  new URL("./prompts/divedra-role-system-prompt.md", import.meta.url),
  "utf8",
).trim();

function buildPromptVariables(
  input: PromptCompositionInput,
): Readonly<Record<string, unknown>> {
  const nodeKind = describeWorkflowNodeKind(input.nodeRef);
  return buildPromptTemplateVariables({
    nodeVariables: input.node.variables,
    runtimeVariables: input.runtimeVariables,
    workflowId: input.workflow.workflowId,
    workflowDescription: input.workflow.description,
    nodeId: input.nodeRef.id,
    nodeKind,
    prompt: input.basePromptText,
    args: input.assembledArguments,
    upstream: input.upstreamInputs.map((entry) => ({
      fromNodeId: entry.fromNodeId,
      transitionWhen: entry.transitionWhen,
      communicationId: entry.communicationId,
      output: entry.output,
      ...(entry.outputRaw === undefined ? {} : { outputRaw: entry.outputRaw }),
    })),
  });
}

function buildExecutionMailbox(
  input: PromptCompositionInput,
): NodeExecutionMailbox {
  return input.executionMailbox === undefined
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
}

export function composeExecutionPrompts(input: {
  readonly promptComposition: PromptCompositionInput;
  readonly includeSessionStartPrompt: boolean;
}): ComposedExecutionPrompts {
  const mergedVariables = buildPromptVariables(input.promptComposition);
  const workflowPrompt =
    input.promptComposition.workflow.prompts?.divedraPromptTemplate ===
    undefined
      ? ""
      : renderPromptTemplate(
          input.promptComposition.workflow.prompts.divedraPromptTemplate,
          mergedVariables,
        ).trim();
  const workerSystemPrompt =
    input.promptComposition.workflow.prompts?.workerSystemPromptTemplate ===
    undefined
      ? ""
      : renderPromptTemplate(
          input.promptComposition.workflow.prompts.workerSystemPromptTemplate,
          mergedVariables,
        ).trim();
  const nodeSystemPrompt =
    input.promptComposition.node.systemPromptTemplate === undefined
      ? ""
      : renderPromptTemplate(
          input.promptComposition.node.systemPromptTemplate,
          mergedVariables,
        ).trim();
  const sessionStartPrompt =
    !input.includeSessionStartPrompt ||
    input.promptComposition.node.sessionStartPromptTemplate === undefined
      ? ""
      : renderPromptTemplate(
          input.promptComposition.node.sessionStartPromptTemplate,
          mergedVariables,
        ).trim();

  const systemSections = isManagerNodeRef(input.promptComposition.nodeRef)
    ? [DEFAULT_DIVEDRA_ROLE_SYSTEM_PROMPT, workflowPrompt, nodeSystemPrompt]
    : [workerSystemPrompt, nodeSystemPrompt];

  const promptSections = [sessionStartPrompt];
  promptSections.push(
    ...renderNodeExecutionMailboxPromptSections(
      buildExecutionMailbox(input.promptComposition),
    ),
  );

  return {
    ...(systemSections.some((entry) => entry.trim().length > 0)
      ? {
          systemPromptText: systemSections
            .filter((entry) => entry.trim().length > 0)
            .join("\n\n"),
        }
      : {}),
    promptText: promptSections
      .filter((entry) => entry.trim().length > 0)
      .join("\n\n"),
  };
}

export function composeExecutionPrompt(input: PromptCompositionInput): string {
  return composeExecutionPrompts({
    promptComposition: input,
    includeSessionStartPrompt: false,
  }).promptText;
}
