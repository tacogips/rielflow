import { randomUUID } from "node:crypto";
import { createDefaultEventSourceRegistry } from "./adapter-registry";
import { isEventSourceEnabled } from "./config";
import { createEventReplyDispatcher } from "./reply-dispatcher";
import {
  createWorkflowTriggerRunner,
  dispatchEventToMatchingBindings,
  type WorkflowTriggerRunnerOptions,
  type WorkflowTriggerResult,
} from "./trigger-runner";
import { loadAndValidateEventConfiguration } from "./validate";
import type { EventConfigLoadOptions, ExternalEventEnvelope } from "./types";

export interface DispatchSupervisorChatInput
  extends EventConfigLoadOptions,
    WorkflowTriggerRunnerOptions {
  readonly sourceId: string;
  readonly text: string;
  /**
   * Channel / room id for `event.conversation.id`. When omitted but `threadId`
   * is set, the synthetic envelope uses `sourceId` as the conversation id so
   * thread-scoped correlation keys stay aligned with webhook-shaped events.
   */
  readonly conversationId?: string;
  readonly threadId?: string;
  readonly eventId?: string;
  readonly eventType?: string;
  readonly provider?: string;
  readonly idempotencyKey?: string;
}

/**
 * Builds `event.conversation` for supervisor-chat dispatch and tests.
 * When `threadId` is set without `conversationId`, `id` defaults to `sourceId`.
 */
export function buildSupervisorChatConversation(input: {
  readonly sourceId: string;
  readonly conversationId?: string;
  readonly threadId?: string;
}): ExternalEventEnvelope["conversation"] {
  const hasConversation =
    input.conversationId !== undefined || input.threadId !== undefined;
  if (!hasConversation) {
    return undefined;
  }
  return {
    id: input.conversationId ?? input.sourceId,
    ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
  };
}

/**
 * Dispatches chat text through the same event pipeline as webhook/chat adapters:
 * loads validated event configuration, builds a synthetic {@link ExternalEventEnvelope},
 * then runs {@link dispatchEventToMatchingBindings} (including supervised and
 * `llm-command` intent paths).
 */
export async function dispatchSupervisorChat(
  input: DispatchSupervisorChatInput,
): Promise<readonly WorkflowTriggerResult[]> {
  if (typeof input.text !== "string" || input.text.trim().length === 0) {
    throw new Error("dispatchSupervisorChat requires non-empty text");
  }
  const validation = await loadAndValidateEventConfiguration(input);
  if (!validation.valid) {
    throw new Error(
      validation.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; "),
    );
  }
  const configuration = validation.configuration;
  const source = configuration.sources.find(
    (entry) => entry.id === input.sourceId && isEventSourceEnabled(entry),
  );
  if (source === undefined) {
    throw new Error(`event source not found or disabled: ${input.sourceId}`);
  }

  const receivedAt = new Date().toISOString();
  const eventId = input.eventId ?? randomUUID();
  const dedupeKey =
    input.idempotencyKey ?? `supervisor-chat:${input.sourceId}:${eventId}`;

  const conversation = buildSupervisorChatConversation({
    sourceId: input.sourceId,
    ...(input.conversationId === undefined
      ? {}
      : { conversationId: input.conversationId }),
    ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
  });

  const event: ExternalEventEnvelope = {
    sourceId: input.sourceId,
    eventId,
    provider: input.provider ?? "supervisor-chat",
    eventType: input.eventType ?? "chat.message",
    receivedAt,
    dedupeKey,
    input: {
      text: input.text,
    },
    ...(conversation === undefined ? {} : { conversation }),
  };

  const registry = createDefaultEventSourceRegistry();
  const eventReplyDispatcher =
    input.eventReplyDispatcher ??
    createEventReplyDispatcher({
      configuration,
      registry,
      env: input.env ?? process.env,
      ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
      runtimeOptions: input,
    });
  const triggerOptions: WorkflowTriggerRunnerOptions = {
    ...input,
    eventReplyDispatcher,
  };

  return dispatchEventToMatchingBindings(
    {
      configuration,
      event,
      raw: { text: input.text, conversation },
      runner: createWorkflowTriggerRunner(triggerOptions),
    },
    triggerOptions,
  );
}
