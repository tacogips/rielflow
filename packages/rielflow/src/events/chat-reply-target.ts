import type { ChatReplyDispatchTarget } from "../workflow/types";
import type { ExternalEventEnvelope } from "./types";

function readOptionalString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const raw = value[key];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolves a chat reply target from an event envelope when the event carries
 * conversation metadata (same contract as runtimeVariables.event for chat-reply-worker).
 */
export function resolveChatReplyTargetFromEnvelope(
  event: ExternalEventEnvelope,
): ChatReplyDispatchTarget | null {
  const input = event.input as Readonly<Record<string, unknown>>;
  const replyTarget = input["replyTarget"];
  if (isRecord(replyTarget)) {
    const sourceId = readOptionalString(replyTarget, "sourceId");
    const provider = readOptionalString(replyTarget, "provider");
    const eventId = readOptionalString(replyTarget, "eventId");
    const conversationId = readOptionalString(replyTarget, "conversationId");
    if (
      sourceId !== undefined &&
      provider !== undefined &&
      eventId !== undefined &&
      conversationId !== undefined
    ) {
      const threadId = readOptionalString(replyTarget, "threadId");
      const actorId = readOptionalString(replyTarget, "actorId");
      return {
        sourceId,
        provider,
        eventId,
        conversationId,
        ...(threadId === undefined ? {} : { threadId }),
        ...(actorId === undefined ? {} : { actorId }),
      };
    }
  }

  const conversationId = event.conversation?.id;
  if (conversationId === undefined) {
    return null;
  }
  const threadId = event.conversation?.threadId;
  const actorId = event.actor?.id;
  return {
    sourceId: event.sourceId,
    provider: event.provider,
    eventId: event.eventId,
    conversationId,
    ...(threadId === undefined ? {} : { threadId }),
    ...(actorId === undefined ? {} : { actorId }),
  };
}
