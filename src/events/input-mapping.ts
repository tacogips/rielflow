import { isJsonObject, type JsonObject } from "../shared/json";
import { isEventBindingEnabled } from "./config";
import { resolveEventMailboxBridgePolicy } from "./mailbox-bridge-policy";
import { renderEventTemplateValue } from "divedra-events/path-resolution";
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

function renderWorkflowInputTemplateValue(
  value: unknown,
  event: ExternalEventEnvelope,
  source: EventSourceConfig | undefined,
): unknown {
  return renderEventTemplateValue({
    value,
    roots: { event, source },
    allowedRoots: ["event", "source"],
    allowArrayTraversal: true,
  });
}

export function buildEventRuntimeMetadata(
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
      : renderWorkflowInputTemplateValue(
          binding.inputMapping.template,
          event,
          source,
        );
  const normalizedWorkflowInput = isJsonObject(workflowInput)
    ? workflowInput
    : { value: workflowInput };
  const eventMetadata = buildEventRuntimeMetadata(event);
  const mailboxPolicy = resolveEventMailboxBridgePolicy(binding);
  return {
    workflowInput: normalizedWorkflowInput,
    runtimeVariables: {
      workflowInput: normalizedWorkflowInput,
      event: eventMetadata,
      eventBindingId: binding.id,
      ...(binding.outputDestinations === undefined
        ? {}
        : { eventOutputDestinations: binding.outputDestinations }),
      eventMailboxBridgePolicy: mailboxPolicy,
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
