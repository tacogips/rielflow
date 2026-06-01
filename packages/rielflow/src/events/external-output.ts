import { isJsonObject } from "../shared/json";
import type { ChatReplyDispatcher } from "../workflow/types";
import type {
  ChatReplyDispatchRequest,
  ChatReplyDispatchResult,
  ChatReplyDispatchTarget,
  LoadOptions,
  WorkflowExternalOutputContext,
} from "../workflow/types";
import {
  loadEventReplyDispatchByIdempotencyKey,
  saveEventReplyDispatchToRuntimeDb,
  type RuntimeEventReplyDispatchRecord,
} from "../workflow/runtime-db";
import { resolveChatReplyTargetFromEnvelope } from "./chat-reply-target";
import type { ResolvedEventMailboxBridgePolicy } from "./mailbox-bridge-policy";
import type {
  ExternalEventEnvelope,
  ExternalMailboxAddress,
  ExternalOutputMessage,
} from "./types";

export interface ExternalOutputDispatchTarget {
  readonly sourceId: string;
  readonly provider: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly eventId?: string;
  readonly actorId?: string;
}

export interface PublishExternalOutputMessageInput {
  readonly message: ExternalOutputMessage;
  readonly dispatchTarget?: ExternalOutputDispatchTarget;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
}

export interface ExternalOutputPublisher {
  publish(
    input: PublishExternalOutputMessageInput,
  ): Promise<ChatReplyDispatchResult | null>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isChatReplyDispatchTarget(
  value: unknown,
): value is ChatReplyDispatchTarget {
  if (!isJsonObject(value)) {
    return false;
  }
  return (
    isNonEmptyString(value["sourceId"]) &&
    isNonEmptyString(value["provider"]) &&
    isNonEmptyString(value["eventId"]) &&
    isNonEmptyString(value["conversationId"])
  );
}

/**
 * Resolves a transport dispatch target from a canonical address plus payload.
 * Prefer an embedded `chatReplyTarget` on the payload when present.
 */
export function resolveExternalOutputDispatchTarget(
  address: ExternalMailboxAddress,
  payload: Readonly<Record<string, unknown>>,
): ExternalOutputDispatchTarget | null {
  const embedded = payload["chatReplyTarget"];
  if (isChatReplyDispatchTarget(embedded)) {
    return {
      sourceId: embedded.sourceId,
      provider: embedded.provider,
      conversationId: embedded.conversationId,
      ...(embedded.threadId === undefined
        ? {}
        : { threadId: embedded.threadId }),
      ...(embedded.eventId === undefined ? {} : { eventId: embedded.eventId }),
      ...(embedded.actorId === undefined ? {} : { actorId: embedded.actorId }),
    };
  }
  if (
    !isNonEmptyString(address.sourceId) ||
    !isNonEmptyString(address.conversationId)
  ) {
    return null;
  }
  const eventId =
    address.eventId ??
    (typeof payload["eventId"] === "string" ? payload["eventId"] : undefined);
  if (eventId === undefined) {
    return null;
  }
  const providerHint =
    address.providerHint ??
    (typeof payload["providerHint"] === "string"
      ? payload["providerHint"]
      : undefined) ??
    "unknown";
  return {
    sourceId: address.sourceId,
    provider: providerHint,
    conversationId: address.conversationId,
    ...(address.threadId === undefined ? {} : { threadId: address.threadId }),
    eventId,
    ...(address.actorId === undefined
      ? typeof payload["actorId"] === "string"
        ? { actorId: payload["actorId"] }
        : {}
      : { actorId: address.actorId }),
  };
}

function dispatchTargetToChatTarget(
  target: ExternalOutputDispatchTarget,
): ChatReplyDispatchTarget {
  return {
    sourceId: target.sourceId,
    provider: target.provider,
    eventId: target.eventId ?? target.sourceId,
    conversationId: target.conversationId,
    ...(target.threadId === undefined ? {} : { threadId: target.threadId }),
    ...(target.actorId === undefined ? {} : { actorId: target.actorId }),
  };
}

export function formatExternalOutputTransportText(
  message: ExternalOutputMessage,
): string {
  if (message.outputKind === "control-status") {
    const text = message.payload["controlStatusText"];
    if (typeof text === "string" && text.length > 0) {
      return text;
    }
  }
  const explicit = message.payload["transportText"];
  if (typeof explicit === "string" && explicit.length > 0) {
    return explicit;
  }
  const workflowOutput = message.payload["workflowOutput"];
  if (workflowOutput !== undefined) {
    return typeof workflowOutput === "string"
      ? workflowOutput
      : JSON.stringify(workflowOutput);
  }
  return JSON.stringify(message.payload);
}

function persistedSuccessfulReply(
  record: RuntimeEventReplyDispatchRecord | null,
): ChatReplyDispatchResult | null {
  if (record === null) {
    return null;
  }
  if (record.status !== "sent" && record.status !== "queued") {
    return null;
  }
  return {
    status: record.status,
    provider: record.provider,
    ...(record.dispatchId === null ? {} : { dispatchId: record.dispatchId }),
    ...(record.providerMessageId === null
      ? {}
      : { providerMessageId: record.providerMessageId }),
  };
}

export function buildChatReplyRequestForExternalOutput(input: {
  readonly message: ExternalOutputMessage;
  readonly target: ChatReplyDispatchTarget;
  readonly outputDestinationId?: string;
  readonly outputDestinationIds?: readonly string[];
  readonly transportText: string;
  readonly replyAs?: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
}): ChatReplyDispatchRequest {
  return {
    target: input.target,
    ...(input.outputDestinationId === undefined
      ? {}
      : { outputDestinationId: input.outputDestinationId }),
    ...(input.outputDestinationIds === undefined
      ? {}
      : { outputDestinationIds: input.outputDestinationIds }),
    message: {
      text: input.transportText,
      ...(input.replyAs === undefined ? {} : { replyAs: input.replyAs }),
    },
    visibility: "public",
    threadPolicy: "same-thread",
    idempotencyKey: input.message.idempotencyKey,
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    nodeId: input.nodeId,
    nodeExecId: input.nodeExecId,
    dispatchAuditMetadata: {
      canonicalExternalOutput: input.message,
    },
  };
}

function resolveExternalOutputReplyAs(
  payload: Readonly<Record<string, unknown>>,
): string | undefined {
  const replyAs = payload["replyAs"];
  return typeof replyAs === "string" && replyAs.trim().length > 0
    ? replyAs.trim()
    : undefined;
}

async function persistNoDeliveryTarget(input: {
  readonly message: ExternalOutputMessage;
  readonly transportText: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly runtimeOptions: LoadOptions;
}): Promise<void> {
  const now = new Date().toISOString();
  const syntheticRequest = buildChatReplyRequestForExternalOutput({
    message: input.message,
    target: {
      sourceId: "none",
      provider: "none",
      eventId: input.message.idempotencyKey.slice(0, 120),
      conversationId: "none",
    },
    transportText: input.transportText,
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    nodeId: input.nodeId,
    nodeExecId: input.nodeExecId,
  });
  await saveEventReplyDispatchToRuntimeDb(
    {
      idempotencyKey: input.message.idempotencyKey,
      sourceId: "none",
      provider: "none",
      workflowId: input.workflowId,
      workflowExecutionId: input.workflowExecutionId,
      nodeId: input.nodeId,
      nodeExecId: input.nodeExecId,
      eventId: syntheticRequest.target.eventId,
      conversationId: "none",
      status: "no_delivery_target",
      requestJson: JSON.stringify(syntheticRequest),
      error: "no_dispatch_target",
      updatedAt: now,
      createdAt: now,
    },
    input.runtimeOptions,
  );
}

/**
 * Publishes a canonical external-output message through the chat reply
 * dispatcher when a transport target exists; otherwise persists a durable
 * `no_delivery_target` row without claiming provider delivery success.
 */
export async function publishExternalOutputMessage(input: {
  readonly dispatcher: ChatReplyDispatcher;
  readonly message: ExternalOutputMessage;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly runtimeOptions: LoadOptions;
  readonly dispatchTarget?: ExternalOutputDispatchTarget;
}): Promise<ChatReplyDispatchResult | null> {
  const { dispatcher, message, runtimeOptions } = input;
  const persisted = await loadEventReplyDispatchByIdempotencyKey(
    message.idempotencyKey,
    runtimeOptions,
  );
  if (persisted?.status === "no_delivery_target") {
    return null;
  }
  const reused = persistedSuccessfulReply(persisted);
  if (reused !== null) {
    return reused;
  }

  const target =
    input.dispatchTarget === undefined
      ? resolveExternalOutputDispatchTarget(message.address, message.payload)
      : input.dispatchTarget;
  const transportText = formatExternalOutputTransportText(message);
  if (target === null) {
    await persistNoDeliveryTarget({
      message,
      transportText,
      workflowId: input.workflowId,
      workflowExecutionId: input.workflowExecutionId,
      nodeId: input.nodeId,
      nodeExecId: input.nodeExecId,
      runtimeOptions,
    });
    return null;
  }
  const outputDestinationIds = resolveOutputDestinationIds(
    input.message.payload,
  );
  const replyAs = resolveExternalOutputReplyAs(message.payload);
  const request = buildChatReplyRequestForExternalOutput({
    message,
    target: dispatchTargetToChatTarget(target),
    ...(outputDestinationIds === undefined ? {} : { outputDestinationIds }),
    transportText,
    ...(replyAs === undefined ? {} : { replyAs }),
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    nodeId: input.nodeId,
    nodeExecId: input.nodeExecId,
  });
  return dispatcher.dispatchChatReply(request);
}

function resolveOutputDestinationIds(
  variables: Readonly<Record<string, unknown>>,
): readonly string[] | undefined {
  const destinations = variables["eventOutputDestinations"];
  if (!Array.isArray(destinations)) {
    return undefined;
  }
  const ids = destinations.filter(
    (destination): destination is string =>
      typeof destination === "string" && destination.length > 0,
  );
  return ids.length === 0 ? undefined : ids;
}

export function createExternalOutputPublisher(input: {
  readonly dispatcher: ChatReplyDispatcher;
  readonly runtimeOptions: LoadOptions;
}): ExternalOutputPublisher {
  return {
    publish: async (publishInput) =>
      publishExternalOutputMessage({
        dispatcher: input.dispatcher,
        runtimeOptions: input.runtimeOptions,
        message: publishInput.message,
        ...(publishInput.dispatchTarget === undefined
          ? {}
          : { dispatchTarget: publishInput.dispatchTarget }),
        workflowId: publishInput.workflowId,
        workflowExecutionId: publishInput.workflowExecutionId,
        nodeId: publishInput.nodeId,
        nodeExecId: publishInput.nodeExecId,
      }),
  };
}

export function buildBusinessFinalExternalOutputMessage(input: {
  readonly address: ExternalMailboxAddress;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly context: WorkflowExternalOutputContext;
}): ExternalOutputMessage {
  return {
    kind: "external-output",
    outputKind: "business-final",
    address: input.address,
    payload: input.payload,
    idempotencyKey: [
      "external-output",
      "business-final",
      input.context.workflowId,
      input.context.workflowExecutionId,
      input.context.sourceNodeExecId,
    ].join(":"),
    createdAt: input.context.createdAt,
  };
}

const FAILURE_MESSAGE_MAX_LENGTH = 360;
const FAILURE_MESSAGE_SENSITIVE_KEY_NAME = String.raw`[A-Za-z0-9_-]*(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|session[-_]?token|private[-_]?key|credential|password|secret|token)[A-Za-z0-9_-]*`;
const FAILURE_MESSAGE_DOUBLE_QUOTED_SECRET_VALUE_PATTERN = new RegExp(
  `("${FAILURE_MESSAGE_SENSITIVE_KEY_NAME}"\\s*:\\s*)"[^"]*"`,
  "gi",
);
const FAILURE_MESSAGE_SINGLE_QUOTED_SECRET_VALUE_PATTERN = new RegExp(
  `('${FAILURE_MESSAGE_SENSITIVE_KEY_NAME}'\\s*:\\s*)'[^']*'`,
  "gi",
);
const FAILURE_MESSAGE_SECRET_ASSIGNMENT_PATTERN = new RegExp(
  `\\b(${FAILURE_MESSAGE_SENSITIVE_KEY_NAME})(\\s*[=:]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;&]+)`,
  "gi",
);

export function sanitizeWorkflowFailureMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  const redacted = compact
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g, "[redacted-token]")
    .replace(
      /\b(sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
      "[redacted-token]",
    )
    .replace(
      /\b(Authorization)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(?:[A-Za-z][A-Za-z0-9_-]{2,}\s+)?[A-Za-z0-9._~+/=-]{8,})/gi,
      "$1$2[redacted]",
    )
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi, "$1 [redacted]")
    .replace(
      FAILURE_MESSAGE_DOUBLE_QUOTED_SECRET_VALUE_PATTERN,
      '$1"[redacted]"',
    )
    .replace(
      FAILURE_MESSAGE_SINGLE_QUOTED_SECRET_VALUE_PATTERN,
      "$1'[redacted]'",
    )
    .replace(FAILURE_MESSAGE_SECRET_ASSIGNMENT_PATTERN, "$1$2[redacted]");
  if (redacted.length === 0) {
    return "unknown workflow failure";
  }
  if (redacted.length <= FAILURE_MESSAGE_MAX_LENGTH) {
    return redacted;
  }
  return `${redacted.slice(0, FAILURE_MESSAGE_MAX_LENGTH - 3)}...`;
}

export function buildWorkflowFailureExternalOutputMessage(input: {
  readonly address: ExternalMailboxAddress;
  readonly context: WorkflowExternalOutputContext;
  readonly failedNodeId: string;
  readonly failureMessage: string;
  readonly idempotencyKey?: string;
  readonly transportText?: string;
  readonly replyAs?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}): ExternalOutputMessage {
  const sanitizedFailureMessage = sanitizeWorkflowFailureMessage(
    input.failureMessage,
  );
  const text =
    input.transportText === undefined
      ? `Workflow step '${input.failedNodeId}' failed: ${sanitizedFailureMessage}`
      : sanitizeWorkflowFailureMessage(input.transportText);
  return {
    kind: "external-output",
    outputKind: "control-status",
    address: input.address,
    payload: {
      ...(input.payload ?? {}),
      controlStatusText: text,
      transportText: text,
      failure: {
        nodeId: input.failedNodeId,
        message: sanitizedFailureMessage,
      },
      ...(input.replyAs === undefined ? {} : { replyAs: input.replyAs }),
    },
    idempotencyKey:
      input.idempotencyKey ??
      [
        "external-output",
        "failure",
        input.context.workflowId,
        input.context.workflowExecutionId,
        input.context.sourceNodeExecId,
      ].join(":"),
    createdAt: input.context.createdAt,
  };
}

function buildWorkflowFailureIdempotencyKey(input: {
  readonly event: ExternalEventEnvelope;
  readonly workflowId: string;
  readonly failedNodeId: string;
}): string {
  return [
    "external-output",
    "failure",
    "event",
    input.event.sourceId,
    input.event.dedupeKey,
    input.workflowId,
    input.failedNodeId,
  ].join(":");
}

export function parseEventMailboxBridgePolicyFromRuntimeVariables(
  rv: Readonly<Record<string, unknown>>,
): ResolvedEventMailboxBridgePolicy | null {
  const raw = rv["eventMailboxBridgePolicy"];
  if (!isJsonObject(raw)) {
    return null;
  }
  return raw as unknown as ResolvedEventMailboxBridgePolicy;
}

export function parseExternalEventEnvelopeFromRuntimeVariables(
  rv: Readonly<Record<string, unknown>>,
): ExternalEventEnvelope | null {
  const raw = rv["event"];
  if (!isJsonObject(raw)) {
    return null;
  }
  if (
    !isNonEmptyString(raw["sourceId"]) ||
    !isNonEmptyString(raw["eventId"]) ||
    !isNonEmptyString(raw["provider"]) ||
    !isNonEmptyString(raw["eventType"]) ||
    !isNonEmptyString(raw["receivedAt"]) ||
    !isNonEmptyString(raw["dedupeKey"])
  ) {
    return null;
  }
  const input = raw["input"];
  if (!isJsonObject(input)) {
    return null;
  }
  return {
    sourceId: raw["sourceId"],
    eventId: raw["eventId"],
    provider: raw["provider"],
    eventType: raw["eventType"],
    ...(typeof raw["occurredAt"] === "string"
      ? { occurredAt: raw["occurredAt"] }
      : {}),
    receivedAt: raw["receivedAt"],
    dedupeKey: raw["dedupeKey"],
    input,
    ...(isJsonObject(raw["actor"]) &&
    isNonEmptyString((raw["actor"] as { id?: string }).id)
      ? {
          actor: {
            id: (raw["actor"] as { id: string }).id,
            ...((raw["actor"] as { displayName?: string }).displayName ===
            undefined
              ? {}
              : {
                  displayName: (raw["actor"] as { displayName: string })
                    .displayName,
                }),
          },
        }
      : {}),
    ...(isJsonObject(raw["conversation"]) &&
    isNonEmptyString((raw["conversation"] as { id?: string }).id)
      ? {
          conversation: {
            id: (raw["conversation"] as { id: string }).id,
            ...((raw["conversation"] as { threadId?: string }).threadId ===
            undefined
              ? {}
              : {
                  threadId: (raw["conversation"] as { threadId: string })
                    .threadId,
                }),
          },
        }
      : {}),
    ...(isJsonObject(raw["rawRef"]) &&
    (raw["rawRef"] as { root?: string }).root === "artifact" &&
    typeof (raw["rawRef"] as { path?: string }).path === "string"
      ? {
          rawRef: {
            root: "artifact",
            path: (raw["rawRef"] as { path: string }).path,
          },
        }
      : {}),
  };
}

export async function publishWorkflowBusinessFinalExternalOutput(input: {
  readonly dispatcher: ChatReplyDispatcher;
  readonly runtimeOptions: LoadOptions;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly publishedNodeId: string;
  readonly publishedNodeExecId: string;
  readonly workflowOutputPayload: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}): Promise<ChatReplyDispatchResult | null> {
  const policy = parseEventMailboxBridgePolicyFromRuntimeVariables(
    input.runtimeVariables,
  );
  if (policy?.output?.reply?.mode === "none") {
    return null;
  }
  const event = parseExternalEventEnvelopeFromRuntimeVariables(
    input.runtimeVariables,
  );
  if (event === null) {
    return null;
  }
  const chatTarget = resolveChatReplyTargetFromEnvelope(event);
  if (chatTarget === null) {
    return null;
  }
  const bindingIdRaw = input.runtimeVariables["eventBindingId"];
  const bindingId =
    typeof bindingIdRaw === "string" && bindingIdRaw.length > 0
      ? bindingIdRaw
      : undefined;
  const address: ExternalMailboxAddress = {
    sourceId: event.sourceId,
    ...(bindingId === undefined ? {} : { bindingId }),
    workflowName: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    ...(event.conversation?.id === undefined
      ? {}
      : { conversationId: event.conversation.id }),
    ...(event.conversation?.threadId === undefined
      ? {}
      : { threadId: event.conversation.threadId }),
    eventId: event.eventId,
    providerHint: event.provider,
    ...(event.actor?.id === undefined ? {} : { actorId: event.actor.id }),
  };
  const message = buildBusinessFinalExternalOutputMessage({
    address,
    payload: {
      workflowOutput: input.workflowOutputPayload,
      chatReplyTarget: chatTarget,
      ...(Array.isArray(input.runtimeVariables["eventOutputDestinations"])
        ? {
            eventOutputDestinations:
              input.runtimeVariables["eventOutputDestinations"],
          }
        : {}),
      eventId: event.eventId,
    },
    context: {
      workflowId: input.workflowId,
      workflowExecutionId: input.workflowExecutionId,
      sourceNodeId: input.publishedNodeId,
      sourceNodeExecId: input.publishedNodeExecId,
      createdAt: input.createdAt,
    },
  });
  return publishExternalOutputMessage({
    dispatcher: input.dispatcher,
    runtimeOptions: input.runtimeOptions,
    message,
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    nodeId: input.publishedNodeId,
    nodeExecId: input.publishedNodeExecId,
  });
}

export async function publishWorkflowFailureExternalOutput(input: {
  readonly dispatcher: ChatReplyDispatcher;
  readonly runtimeOptions: LoadOptions;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly failedNodeId: string;
  readonly failedNodeExecId: string;
  readonly failureMessage: string;
  readonly transportText?: string;
  readonly replyAs?: string;
  readonly createdAt: string;
}): Promise<ChatReplyDispatchResult | null> {
  const policy = parseEventMailboxBridgePolicyFromRuntimeVariables(
    input.runtimeVariables,
  );
  if (policy?.output?.reply?.mode === "none") {
    return null;
  }
  const event = parseExternalEventEnvelopeFromRuntimeVariables(
    input.runtimeVariables,
  );
  if (event === null) {
    return null;
  }
  const chatTarget = resolveChatReplyTargetFromEnvelope(event);
  if (chatTarget === null) {
    return null;
  }
  const bindingIdRaw = input.runtimeVariables["eventBindingId"];
  const bindingId =
    typeof bindingIdRaw === "string" && bindingIdRaw.length > 0
      ? bindingIdRaw
      : undefined;
  const address: ExternalMailboxAddress = {
    sourceId: event.sourceId,
    ...(bindingId === undefined ? {} : { bindingId }),
    workflowName: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    ...(event.conversation?.id === undefined
      ? {}
      : { conversationId: event.conversation.id }),
    ...(event.conversation?.threadId === undefined
      ? {}
      : { threadId: event.conversation.threadId }),
    eventId: event.eventId,
    providerHint: event.provider,
    ...(event.actor?.id === undefined ? {} : { actorId: event.actor.id }),
  };
  const message = buildWorkflowFailureExternalOutputMessage({
    address,
    context: {
      workflowId: input.workflowId,
      workflowExecutionId: input.workflowExecutionId,
      sourceNodeId: input.failedNodeId,
      sourceNodeExecId: input.failedNodeExecId,
      createdAt: input.createdAt,
    },
    failedNodeId: input.failedNodeId,
    failureMessage: input.failureMessage,
    idempotencyKey: buildWorkflowFailureIdempotencyKey({
      event,
      workflowId: input.workflowId,
      failedNodeId: input.failedNodeId,
    }),
    ...(input.transportText === undefined
      ? {}
      : { transportText: input.transportText }),
    ...(input.replyAs === undefined ? {} : { replyAs: input.replyAs }),
    payload: {
      chatReplyTarget: chatTarget,
      ...(Array.isArray(input.runtimeVariables["eventOutputDestinations"])
        ? {
            eventOutputDestinations:
              input.runtimeVariables["eventOutputDestinations"],
          }
        : {}),
      eventId: event.eventId,
    },
  });
  return publishExternalOutputMessage({
    dispatcher: input.dispatcher,
    runtimeOptions: input.runtimeOptions,
    message,
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    nodeId: input.failedNodeId,
    nodeExecId: input.failedNodeExecId,
  });
}
