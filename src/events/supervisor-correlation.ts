import { renderEventStringTemplate } from "divedra-events/path-resolution";
import type {
  EventBinding,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "./types";

const DEFAULT_SUPERVISOR_WORKFLOW = "divedra-default-workflow-supervisor";

export function defaultSupervisorWorkflowName(): string {
  return DEFAULT_SUPERVISOR_WORKFLOW;
}

function renderStringTemplate(
  value: string,
  event: ExternalEventEnvelope,
  source: EventSourceConfig | undefined,
  binding: EventBinding,
): string {
  return renderEventStringTemplate({
    template: value,
    roots: { binding, event, source },
    allowedRoots: ["binding", "event", "source"],
    allowArrayTraversal: true,
  });
}

export function resolveSupervisedCorrelationKey(input: {
  readonly binding: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly source?: EventSourceConfig;
}): string {
  const template = input.binding.execution?.control?.correlationKey;
  if (typeof template === "string" && template.length > 0) {
    const rendered = renderStringTemplate(
      template,
      input.event,
      input.source,
      input.binding,
    );
    if (rendered.length > 0) {
      return rendered;
    }
  }
  const conv = input.event.conversation?.id ?? "";
  const thread = input.event.conversation?.threadId ?? "";
  return `${input.event.sourceId}:${input.binding.id}:${conv}:${thread}`;
}

export function isCorrelationKeyLikelyAmbiguousWithoutConversation(input: {
  readonly binding: EventBinding;
}): boolean {
  const template = input.binding.execution?.control?.correlationKey;
  if (template === undefined) {
    return true;
  }
  return (
    typeof template === "string" &&
    !template.includes("conversation") &&
    !template.includes("threadId")
  );
}

export function buildStableSupervisorCommandId(input: {
  readonly receiptId: string;
  readonly action: string;
}): string {
  return `esv-cmd-${input.receiptId}-${input.action}`;
}
