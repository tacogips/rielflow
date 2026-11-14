import { publishWorkflowFailureExternalOutput } from "../../events/external-output";
import { renderPromptTemplate } from "../render";
import type { WorkflowSessionState } from "../session";
import type { NodePayload, WorkflowJson } from "../types";
import type { WorkflowRunOptions } from "./types-and-session-state";

type SaveWorkflowSession = (
  session: WorkflowSessionState,
  options: WorkflowRunOptions,
) => Promise<unknown>;

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function normalizeReplyAs(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length === 0 || trimmed.includes("{{") ? undefined : trimmed;
}

function normalizeTemplate(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : value;
}

export function inferFailureReplyAs(
  nodeId: string,
  nodePayload: NodePayload,
): string | undefined {
  const nodeRecord = nodePayload as unknown as Readonly<
    Record<string, unknown>
  >;
  const addonConfig = asRecord(asRecord(nodeRecord["addon"])?.["config"]);
  const addonReplyAs = normalizeReplyAs(addonConfig?.["replyAsTemplate"]);
  if (addonReplyAs !== undefined) {
    return addonReplyAs;
  }

  const variablesReplyAs = normalizeReplyAs(
    asRecord(nodeRecord["variables"])?.["shortName"],
  );
  if (variablesReplyAs !== undefined) {
    return variablesReplyAs;
  }

  const [prefix] = nodeId.split("-");
  return normalizeReplyAs(prefix);
}

export function renderChatFailureMessage(input: {
  readonly workflow: Pick<WorkflowJson, "workflowId" | "prompts">;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly nodePayload: NodePayload;
  readonly failureMessage: string;
  readonly replyAs?: string;
}): string | undefined {
  const template =
    normalizeTemplate(input.nodePayload.chatFailureMessageTemplate) ??
    normalizeTemplate(input.workflow.prompts?.chatFailureMessageTemplate);
  if (template === undefined) {
    return undefined;
  }
  const rendered = renderPromptTemplate(template, {
    workflow: {
      id: input.workflow.workflowId,
      workflowId: input.workflow.workflowId,
      executionId: input.workflowExecutionId,
      workflowExecutionId: input.workflowExecutionId,
    },
    node: {
      id: input.nodeId,
      nodeId: input.nodeId,
      execId: input.nodeExecId,
      nodeExecId: input.nodeExecId,
      variables: input.nodePayload.variables,
    },
    failure: {
      message: input.failureMessage,
      diagnosticMessage: input.failureMessage,
    },
    error: {
      message: input.failureMessage,
    },
    ...(input.replyAs === undefined ? {} : { replyAs: input.replyAs }),
  }).trim();
  return rendered.length === 0 ? undefined : rendered;
}

export async function publishNodeFailureReplyIfConfigured(input: {
  readonly options: WorkflowRunOptions;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly failureMessage: string;
  readonly chatFailureMessage?: string;
  readonly replyAs?: string;
  readonly createdAt: string;
}): Promise<void> {
  if (input.options.eventReplyDispatcher === undefined) {
    return;
  }
  try {
    await publishWorkflowFailureExternalOutput({
      dispatcher: input.options.eventReplyDispatcher,
      runtimeOptions: input.options,
      workflowId: input.workflowId,
      workflowExecutionId: input.workflowExecutionId,
      runtimeVariables: input.runtimeVariables,
      failedNodeId: input.nodeId,
      failedNodeExecId: input.nodeExecId,
      failureMessage: input.failureMessage,
      ...(input.chatFailureMessage === undefined
        ? {}
        : { transportText: input.chatFailureMessage }),
      ...(input.replyAs === undefined ? {} : { replyAs: input.replyAs }),
      createdAt: input.createdAt,
    });
  } catch {
    // Best-effort: surfacing the failure in chat must not mask the workflow failure.
  }
}

export async function saveFailedSessionAndPublishNodeFailureReply(input: {
  readonly saveSession: SaveWorkflowSession;
  readonly failed: WorkflowSessionState;
  readonly options: WorkflowRunOptions;
  readonly workflowId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly failureMessage: string;
  readonly chatFailureMessage?: string;
  readonly replyAs?: string;
  readonly createdAt: string;
}): Promise<void> {
  await input.saveSession(input.failed, input.options);
  await publishNodeFailureReplyIfConfigured({
    options: input.options,
    workflowId: input.workflowId,
    workflowExecutionId: input.failed.sessionId,
    runtimeVariables: input.failed.runtimeVariables,
    nodeId: input.nodeId,
    nodeExecId: input.nodeExecId,
    failureMessage: input.failureMessage,
    ...(input.chatFailureMessage === undefined
      ? {}
      : { chatFailureMessage: input.chatFailureMessage }),
    ...(input.replyAs === undefined ? {} : { replyAs: input.replyAs }),
    createdAt: input.createdAt,
  });
}
