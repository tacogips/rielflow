import type { ChatReplyDispatcher } from "../workflow/types";
import type {
  ChatReplyDispatchRequest,
  ChatReplyDispatchResult,
  LoadOptions,
} from "../workflow/types";
import {
  loadEventReplyDispatchByIdempotencyKey,
  saveEventReplyDispatchToRuntimeDb,
} from "../workflow/runtime-db";
import {
  createDefaultEventSourceRegistry,
  type EventSourceRegistry,
} from "./adapter-registry";
import {
  buildChatReplyRequestForDeliveryTarget,
  dispatchChatReplyToResolvedEventOutputDestination,
  resolveChatReplyDeliveryTargets,
  type EventOutputDestinationChatDeliveryTarget,
} from "./output-destination";
import {
  buildReplyDispatchSaveInput,
  persistedToDispatchResult,
  resolveReplyDispatchProvider,
} from "./reply-dispatch-record";
import type { EventConfiguration } from "./types";

export interface EventReplyDispatcherOptions {
  readonly configuration: EventConfiguration;
  readonly registry?: EventSourceRegistry;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: typeof fetch;
  readonly runtimeOptions?: LoadOptions;
}

export function createEventReplyDispatcher(
  options: EventReplyDispatcherOptions,
): ChatReplyDispatcher {
  const registry = options.registry ?? createDefaultEventSourceRegistry();
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const runtimeOptions = options.runtimeOptions ?? {};
  const pendingByIdempotencyKey = new Map<
    string,
    Promise<ChatReplyDispatchResult>
  >();

  return {
    async dispatchChatReply(
      request: ChatReplyDispatchRequest,
    ): Promise<ChatReplyDispatchResult> {
      const existing = pendingByIdempotencyKey.get(request.idempotencyKey);
      if (existing !== undefined) {
        return await existing;
      }

      const pending = dispatchChatReplyOnce({
        configuration: options.configuration,
        registry,
        env,
        fetchImpl,
        runtimeOptions,
        request,
      });
      pendingByIdempotencyKey.set(request.idempotencyKey, pending);
      try {
        return await pending;
      } catch (error: unknown) {
        throw error;
      } finally {
        pendingByIdempotencyKey.delete(request.idempotencyKey);
      }
    },
  };
}

async function dispatchChatReplyOnce(input: {
  readonly configuration: EventConfiguration;
  readonly registry: EventSourceRegistry;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl: typeof fetch;
  readonly runtimeOptions: LoadOptions;
  readonly request: ChatReplyDispatchRequest;
}): Promise<ChatReplyDispatchResult> {
  const targets = resolveChatReplyDeliveryTargets({
    configuration: input.configuration,
    request: input.request,
  });
  if (targets.length === 0) {
    throw new Error("no enabled chat output destination is available");
  }
  if (targets.length > 1) {
    const results: ChatReplyDispatchResult[] = [];
    for (const target of targets) {
      results.push(
        await dispatchChatReplyToOneTarget({
          ...input,
          request: withTargetIdempotency(input.request, target),
          target,
        }),
      );
    }
    const [first] = results;
    if (first === undefined) {
      throw new Error("no chat output destination dispatch result");
    }
    return {
      status: first.status,
      provider: first.provider,
      ...(first.dispatchId === undefined
        ? {}
        : { dispatchId: first.dispatchId }),
      ...(first.providerMessageId === undefined
        ? {}
        : { providerMessageId: first.providerMessageId }),
      destinationResults: results.flatMap(
        (result) => result.destinationResults ?? [],
      ),
    };
  }
  const [target] = targets;
  if (target === undefined) {
    throw new Error("no enabled chat output destination is available");
  }
  return stripDestinationResults(
    await dispatchChatReplyToOneTarget({ ...input, target }),
  );
}

async function dispatchChatReplyToOneTarget(input: {
  readonly configuration: EventConfiguration;
  readonly registry: EventSourceRegistry;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl: typeof fetch;
  readonly runtimeOptions: LoadOptions;
  readonly request: ChatReplyDispatchRequest;
  readonly target: EventOutputDestinationChatDeliveryTarget;
}): Promise<ChatReplyDispatchResult> {
  const request = buildChatReplyRequestForDeliveryTarget(
    input.request,
    input.target,
  );
  const persisted = await loadEventReplyDispatchByIdempotencyKey(
    request.idempotencyKey,
    input.runtimeOptions,
  );
  const persistedResult = persistedToDispatchResult(persisted);
  if (persistedResult !== null) {
    return persistedResult;
  }

  const provider = resolveReplyDispatchProvider({
    configuration: input.configuration,
    sourceId: request.target.sourceId,
    ...(input.target.destinationId === undefined
      ? {}
      : { outputDestinationId: input.target.destinationId }),
    ...(request.outputDestinationId === undefined
      ? {}
      : { outputDestinationId: request.outputDestinationId }),
    ...(request.outputDestinationIds === undefined
      ? {}
      : { outputDestinationIds: request.outputDestinationIds }),
  });

  const now = new Date().toISOString();
  await saveEventReplyDispatchToRuntimeDb(
    buildReplyDispatchSaveInput({
      request,
      provider,
      status: "dispatching",
      updatedAt: now,
    }),
    input.runtimeOptions,
  );
  try {
    const result = await dispatchChatReplyToResolvedEventOutputDestination({
      registry: input.registry,
      request,
      target: input.target,
      env: input.env,
      fetchImpl: input.fetchImpl,
    });
    const enrichedResult = enrichDestinationResult({
      result,
      request,
      target: input.target,
    });
    await saveEventReplyDispatchToRuntimeDb(
      buildReplyDispatchSaveInput({
        request,
        provider: enrichedResult.provider,
        status: enrichedResult.status,
        result: enrichedResult,
        updatedAt: new Date().toISOString(),
      }),
      input.runtimeOptions,
    );
    return enrichedResult;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    await saveEventReplyDispatchToRuntimeDb(
      buildReplyDispatchSaveInput({
        request,
        provider,
        status: "failed",
        error: message,
        updatedAt: new Date().toISOString(),
      }),
      input.runtimeOptions,
    );
    throw error;
  }
}

function withTargetIdempotency(
  request: ChatReplyDispatchRequest,
  target: EventOutputDestinationChatDeliveryTarget,
): ChatReplyDispatchRequest {
  const suffix = target.destinationId ?? target.source.id;
  return {
    ...request,
    idempotencyKey: `${request.idempotencyKey}:destination:${suffix}`,
    ...(target.destinationId === undefined
      ? {}
      : { outputDestinationId: target.destinationId }),
  };
}

function enrichDestinationResult(input: {
  readonly result: ChatReplyDispatchResult;
  readonly request: ChatReplyDispatchRequest;
  readonly target: EventOutputDestinationChatDeliveryTarget;
}): ChatReplyDispatchResult {
  return {
    status: input.result.status,
    provider: input.result.provider,
    ...(input.result.dispatchId === undefined
      ? {}
      : { dispatchId: input.result.dispatchId }),
    ...(input.result.providerMessageId === undefined
      ? {}
      : { providerMessageId: input.result.providerMessageId }),
    destinationResults: [
      {
        ...(input.target.destinationId === undefined
          ? {}
          : { destinationId: input.target.destinationId }),
        sourceId: input.target.source.id,
        idempotencyKey: input.request.idempotencyKey,
        status: input.result.status,
        provider: input.result.provider,
        ...(input.result.dispatchId === undefined
          ? {}
          : { dispatchId: input.result.dispatchId }),
        ...(input.result.providerMessageId === undefined
          ? {}
          : { providerMessageId: input.result.providerMessageId }),
      },
    ],
  };
}

function stripDestinationResults(
  result: ChatReplyDispatchResult,
): ChatReplyDispatchResult {
  return {
    status: result.status,
    provider: result.provider,
    ...(result.dispatchId === undefined
      ? {}
      : { dispatchId: result.dispatchId }),
    ...(result.providerMessageId === undefined
      ? {}
      : { providerMessageId: result.providerMessageId }),
  };
}
