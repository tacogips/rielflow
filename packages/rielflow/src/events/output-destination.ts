import type {
  ChatReplyDispatchRequest,
  ChatReplyDispatchResult,
} from "../workflow/types";
import {
  isEventOutputDestinationEnabled,
  isEventSourceEnabled,
} from "./config";
import type { EventSourceRegistry } from "./adapter-registry";
import type {
  ChatOutputDestinationConfig,
  EventConfiguration,
  EventOutputDestinationConfig,
  EventSourceConfig,
} from "./types";

export interface EventOutputDestinationChatReplyInput {
  readonly configuration: EventConfiguration;
  readonly registry: EventSourceRegistry;
  readonly request: ChatReplyDispatchRequest;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl: typeof fetch;
}

export interface EventOutputDestinationChatDeliveryTarget {
  readonly destinationId?: string;
  readonly source: EventSourceConfig;
  readonly target?: ChatOutputDestinationConfig["target"];
}

function asEnabledChatDestination(
  destination: EventOutputDestinationConfig | undefined,
): ChatOutputDestinationConfig | undefined {
  if (
    destination?.kind === "chat" &&
    isEventOutputDestinationEnabled(destination)
  ) {
    return destination as ChatOutputDestinationConfig;
  }
  return undefined;
}

function configuredChatDestination(input: {
  readonly configuration: EventConfiguration;
  readonly sourceId: string;
}): ChatOutputDestinationConfig | undefined {
  return asEnabledChatDestination(
    input.configuration.destinations.find(
      (destination) =>
        destination.kind === "chat" &&
        (destination as ChatOutputDestinationConfig).sourceId ===
          input.sourceId,
    ),
  );
}

function resolveSource(input: {
  readonly configuration: EventConfiguration;
  readonly sourceId: string;
}): EventSourceConfig | undefined {
  return input.configuration.sources.find(
    (source) => source.id === input.sourceId && isEventSourceEnabled(source),
  );
}

function deliveryTargetForDestination(input: {
  readonly configuration: EventConfiguration;
  readonly destination: ChatOutputDestinationConfig;
}): EventOutputDestinationChatDeliveryTarget | undefined {
  const source = resolveSource({
    configuration: input.configuration,
    sourceId: input.destination.sourceId,
  });
  if (source === undefined) {
    return undefined;
  }
  return {
    destinationId: input.destination.id,
    source,
    ...(input.destination.target === undefined
      ? {}
      : { target: input.destination.target }),
  };
}

export function resolveChatReplyDeliveryTargets(input: {
  readonly configuration: EventConfiguration;
  readonly request: ChatReplyDispatchRequest;
}): readonly EventOutputDestinationChatDeliveryTarget[] {
  const destinationId = input.request.outputDestinationId;
  if (destinationId !== undefined) {
    const destination = asEnabledChatDestination(
      input.configuration.destinations.find(
        (entry) => entry.id === destinationId,
      ),
    );
    return destination === undefined
      ? []
      : [
          deliveryTargetForDestination({
            configuration: input.configuration,
            destination,
          }),
        ].filter(
          (target): target is EventOutputDestinationChatDeliveryTarget =>
            target !== undefined,
        );
  }

  const destinationIds = input.request.outputDestinationIds;
  if (destinationIds !== undefined) {
    const seen = new Set<string>();
    const targets: EventOutputDestinationChatDeliveryTarget[] = [];
    for (const id of destinationIds) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const destination = asEnabledChatDestination(
        input.configuration.destinations.find((entry) => entry.id === id),
      );
      if (destination === undefined) {
        continue;
      }
      const target = deliveryTargetForDestination({
        configuration: input.configuration,
        destination,
      });
      if (target !== undefined) {
        targets.push(target);
      }
    }
    return targets;
  }

  const configuredDestination = configuredChatDestination({
    configuration: input.configuration,
    sourceId: input.request.target.sourceId,
  });
  if (configuredDestination !== undefined) {
    const target = deliveryTargetForDestination({
      configuration: input.configuration,
      destination: configuredDestination,
    });
    return target === undefined ? [] : [target];
  }
  const source = resolveSource({
    configuration: input.configuration,
    sourceId: input.request.target.sourceId,
  });
  return source === undefined ? [] : [{ source }];
}

export async function dispatchChatReplyToResolvedEventOutputDestination(input: {
  readonly registry: EventSourceRegistry;
  readonly request: ChatReplyDispatchRequest;
  readonly target: EventOutputDestinationChatDeliveryTarget;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl: typeof fetch;
}): Promise<ChatReplyDispatchResult> {
  const adapter = input.registry.get(input.target.source.kind);
  if (adapter === undefined) {
    throw new Error(
      `no event source adapter registered for '${input.target.source.kind}'`,
    );
  }
  if (adapter.dispatchChatReply === undefined) {
    throw new Error(
      `event source adapter '${input.target.source.kind}' does not support chat replies`,
    );
  }

  return await adapter.dispatchChatReply({
    source: input.target.source,
    request: buildChatReplyRequestForDeliveryTarget(
      input.request,
      input.target,
    ),
    env: input.env,
    fetchImpl: input.fetchImpl,
  });
}

export function buildChatReplyRequestForDeliveryTarget(
  request: ChatReplyDispatchRequest,
  target: EventOutputDestinationChatDeliveryTarget,
): ChatReplyDispatchRequest {
  return {
    ...request,
    target: {
      sourceId: target.source.id,
      provider:
        target.target?.provider ?? target.source.provider ?? target.source.kind,
      eventId: target.target?.eventId ?? request.target.eventId,
      conversationId:
        target.target?.conversationId ?? request.target.conversationId,
      ...(target.target?.threadId === undefined
        ? request.target.threadId === undefined
          ? {}
          : { threadId: request.target.threadId }
        : { threadId: target.target.threadId }),
      ...(target.target?.actorId === undefined
        ? request.target.actorId === undefined
          ? {}
          : { actorId: request.target.actorId }
        : { actorId: target.target.actorId }),
    },
  };
}

export async function dispatchChatReplyToEventOutputDestination(
  input: EventOutputDestinationChatReplyInput,
): Promise<ChatReplyDispatchResult> {
  const [target] = resolveChatReplyDeliveryTargets(input);
  if (target === undefined) {
    throw new Error("no enabled chat output destination is available");
  }
  return await dispatchChatReplyToResolvedEventOutputDestination({
    registry: input.registry,
    request: input.request,
    target,
    env: input.env,
    fetchImpl: input.fetchImpl,
  });
}
