export interface PromptTemplateUpstreamEntry {
  readonly fromNodeId: string;
  readonly transitionWhen?: string;
  readonly communicationId?: string;
  readonly status?: string;
  readonly output: Readonly<Record<string, unknown>>;
  readonly outputRaw?: string;
}

interface PromptTemplateInboxContext {
  readonly count: number;
  readonly hasMessages: boolean;
  readonly latest: PromptTemplateUpstreamEntry | null;
  readonly messages: readonly PromptTemplateUpstreamEntry[];
}

export interface PromptTemplateVariableInput {
  readonly nodeVariables: Readonly<Record<string, unknown>>;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly workflowId?: string;
  readonly workflowDescription?: string;
  readonly nodeId?: string;
  readonly nodeKind?: string;
  readonly upstream?: readonly PromptTemplateUpstreamEntry[];
  readonly prompt?: string;
  readonly args?: Readonly<Record<string, unknown>> | null;
}

function buildPromptTemplateInboxContext(
  upstream: readonly PromptTemplateUpstreamEntry[] | undefined,
): PromptTemplateInboxContext {
  const messages = upstream ?? [];

  return {
    count: messages.length,
    hasMessages: messages.length > 0,
    latest:
      messages.length === 0 ? null : (messages[messages.length - 1] ?? null),
    messages,
  };
}

export function buildPromptTemplateVariables(
  input: PromptTemplateVariableInput,
): Readonly<Record<string, unknown>> {
  const inbox = buildPromptTemplateInboxContext(input.upstream);

  return {
    ...input.nodeVariables,
    ...input.runtimeVariables,
    ...(input.workflowId === undefined ? {} : { workflowId: input.workflowId }),
    ...(input.workflowDescription === undefined
      ? {}
      : { workflowDescription: input.workflowDescription }),
    ...(input.nodeId === undefined ? {} : { nodeId: input.nodeId }),
    nodeKind: input.nodeKind ?? "task",
    inbox,
    mailbox: inbox,
    ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
    ...(input.args === undefined ? {} : { args: input.args }),
    ...(input.args === undefined ? {} : { arguments: input.args }),
  };
}
