import { isJsonObject, type JsonObject } from "../shared/json";
import { isEventBindingEnabled } from "./config";
import type {
  EventBinding,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "./types";

interface EventRuntimeMetadata extends JsonObject {
  readonly sourceId: string;
  readonly eventId: string;
  readonly provider: string;
  readonly eventType: string;
  readonly occurredAt?: string;
  readonly receivedAt: string;
  readonly dedupeKey: string;
  readonly input: JsonObject;
  readonly actor?: ExternalEventEnvelope["actor"];
  readonly conversation?: ExternalEventEnvelope["conversation"];
  readonly rawRef?: ExternalEventEnvelope["rawRef"];
}

export interface EventMappingResult {
  readonly workflowInput: JsonObject;
  readonly runtimeVariables: JsonObject;
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
  return undefined;
}

function renderStringTemplate(
  value: string,
  event: ExternalEventEnvelope,
  source: EventSourceConfig | undefined,
): unknown {
  const exact = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  if (exact !== null) {
    return resolveTemplateReference(exact[1] ?? "", event, source);
  }
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression) => {
    const resolved = resolveTemplateReference(
      String(expression),
      event,
      source,
    );
    if (resolved === undefined || resolved === null) {
      return "";
    }
    return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
  });
}

function renderTemplateValue(
  value: unknown,
  event: ExternalEventEnvelope,
  source: EventSourceConfig | undefined,
): unknown {
  if (typeof value === "string") {
    return renderStringTemplate(value, event, source);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => renderTemplateValue(entry, event, source));
  }
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        renderTemplateValue(entry, event, source),
      ]),
    );
  }
  return value;
}

function buildEventRuntimeMetadata(
  event: ExternalEventEnvelope,
): EventRuntimeMetadata {
  return {
    sourceId: event.sourceId,
    eventId: event.eventId,
    provider: event.provider,
    eventType: event.eventType,
    ...(event.occurredAt === undefined ? {} : { occurredAt: event.occurredAt }),
    receivedAt: event.receivedAt,
    dedupeKey: event.dedupeKey,
    input: event.input,
    ...(event.actor === undefined ? {} : { actor: event.actor }),
    ...(event.conversation === undefined
      ? {}
      : { conversation: event.conversation }),
    ...(event.rawRef === undefined ? {} : { rawRef: event.rawRef }),
  };
}

function shouldMirrorToHumanInput(
  binding: EventBinding,
  source: EventSourceConfig | undefined,
): boolean {
  const explicit = binding.inputMapping.mirrorToHumanInput;
  if (explicit !== undefined) {
    return explicit;
  }
  return source?.kind === "webhook";
}

export function mapEventToWorkflowInput(
  binding: EventBinding,
  event: ExternalEventEnvelope,
  source?: EventSourceConfig,
): EventMappingResult {
  const workflowInput =
    binding.inputMapping.mode === "event-input"
      ? event.input
      : renderTemplateValue(binding.inputMapping.template, event, source);
  const normalizedWorkflowInput = isJsonObject(workflowInput)
    ? workflowInput
    : { value: workflowInput };
  const eventMetadata = buildEventRuntimeMetadata(event);
  return {
    workflowInput: normalizedWorkflowInput,
    runtimeVariables: {
      workflowInput: normalizedWorkflowInput,
      event: eventMetadata,
      ...(shouldMirrorToHumanInput(binding, source)
        ? { humanInput: normalizedWorkflowInput }
        : {}),
    },
  };
}

export function bindingMatchesEvent(
  binding: EventBinding,
  event: ExternalEventEnvelope,
): boolean {
  if (!isEventBindingEnabled(binding)) {
    return false;
  }
  const match = binding.match;
  if (match === undefined) {
    return true;
  }
  if (match.eventType !== undefined && match.eventType !== event.eventType) {
    return false;
  }
  if (
    match.conversationId !== undefined &&
    match.conversationId !== event.conversation?.id
  ) {
    return false;
  }
  if (match.pathPrefix !== undefined) {
    const file = event.input["file"];
    const filePath =
      isJsonObject(file) && typeof file["path"] === "string"
        ? file["path"]
        : undefined;
    if (filePath === undefined || !filePath.startsWith(match.pathPrefix)) {
      return false;
    }
  }
  return true;
}

export function selectMatchingBindings(
  bindings: readonly EventBinding[],
  event: ExternalEventEnvelope,
): readonly EventBinding[] {
  return bindings.filter((binding) => bindingMatchesEvent(binding, event));
}
