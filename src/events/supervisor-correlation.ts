import { isJsonObject } from "../shared/json";
import type {
  EventBinding,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "./types";

const DEFAULT_SUPERVISOR_WORKFLOW = "divedra-default-workflow-supervisor";

export function defaultSupervisorWorkflowName(): string {
  return DEFAULT_SUPERVISOR_WORKFLOW;
}

function readPath(root: unknown, pathSegments: readonly string[]): unknown {
  let current = root;
  for (const segment of pathSegments) {
    if (!isJsonObject(current) && !Array.isArray(current)) {
      return undefined;
    }
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  return current;
}

function resolveTemplateReference(
  expression: string,
  event: ExternalEventEnvelope,
  source: EventSourceConfig | undefined,
  binding: EventBinding,
): unknown {
  const trimmed = expression.trim();
  const segments = trimmed.split(".");
  const root = segments[0];
  const rest = segments.slice(1);
  if (root === "event") {
    return readPath(event, rest);
  }
  if (root === "source") {
    return source === undefined ? undefined : readPath(source, rest);
  }
  if (root === "binding") {
    return readPath(binding, rest);
  }
  return undefined;
}

function renderStringTemplate(
  value: string,
  event: ExternalEventEnvelope,
  source: EventSourceConfig | undefined,
  binding: EventBinding,
): string {
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression) => {
    const resolved = resolveTemplateReference(
      String(expression),
      event,
      source,
      binding,
    );
    if (resolved === undefined || resolved === null) {
      return "";
    }
    return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
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
