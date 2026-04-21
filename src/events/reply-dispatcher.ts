import type { ChatReplyDispatcher } from "../workflow/types";
import type {
  ChatReplyDispatchRequest,
  ChatReplyDispatchResult,
  LoadOptions,
} from "../workflow/types";
import {
  loadEventReplyDispatchByIdempotencyKey,
  saveEventReplyDispatchToRuntimeDb,
  type RuntimeEventReplyDispatchRecord,
} from "../workflow/runtime-db";
import {
  createDefaultEventSourceRegistry,
  type EventSourceRegistry,
} from "./adapter-registry";
import { isEventSourceEnabled } from "./config";
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
  const persisted = await loadEventReplyDispatchByIdempotencyKey(
    input.request.idempotencyKey,
    input.runtimeOptions,
  );
  const persistedResult = persistedToDispatchResult(persisted);
  if (persistedResult !== null) {
    return persistedResult;
  }

  const source = input.configuration.sources.find(
    (entry) =>
      entry.id === input.request.target.sourceId && isEventSourceEnabled(entry),
  );
  if (source === undefined) {
    throw new Error(
      `event source '${input.request.target.sourceId}' is not configured or enabled`,
    );
  }

  const adapter = input.registry.get(source.kind);
  if (adapter === undefined) {
    throw new Error(`no event source adapter registered for '${source.kind}'`);
  }
  if (adapter.dispatchChatReply === undefined) {
    throw new Error(
      `event source adapter '${source.kind}' does not support chat replies`,
    );
  }

  const now = new Date().toISOString();
  await saveEventReplyDispatchToRuntimeDb(
    buildReplyDispatchSaveInput({
      request: input.request,
      provider: source.provider ?? source.kind,
      status: "dispatching",
      updatedAt: now,
    }),
    input.runtimeOptions,
  );
  try {
    const result = await adapter.dispatchChatReply({
      source,
      request: input.request,
      env: input.env,
      fetchImpl: input.fetchImpl,
    });
    await saveEventReplyDispatchToRuntimeDb(
      buildReplyDispatchSaveInput({
        request: input.request,
        provider: result.provider,
        status: result.status,
        result,
        updatedAt: new Date().toISOString(),
      }),
      input.runtimeOptions,
    );
    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    await saveEventReplyDispatchToRuntimeDb(
      buildReplyDispatchSaveInput({
        request: input.request,
        provider: source.provider ?? source.kind,
        status: "failed",
        error: message,
        updatedAt: new Date().toISOString(),
      }),
      input.runtimeOptions,
    );
    throw error;
  }
}

function persistedToDispatchResult(
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

function buildReplyDispatchSaveInput(input: {
  readonly request: ChatReplyDispatchRequest;
  readonly provider: string;
  readonly status: "dispatching" | "sent" | "queued" | "failed";
  readonly result?: ChatReplyDispatchResult;
  readonly error?: string;
  readonly updatedAt: string;
}): Parameters<typeof saveEventReplyDispatchToRuntimeDb>[0] {
  const responsePayload =
    input.result === undefined
      ? undefined
      : {
          status: input.result.status,
          provider: input.result.provider,
          ...(input.result.dispatchId === undefined
            ? {}
            : { dispatchId: input.result.dispatchId }),
          ...(input.result.providerMessageId === undefined
            ? {}
            : { providerMessageId: input.result.providerMessageId }),
        };
  return {
    idempotencyKey: input.request.idempotencyKey,
    sourceId: input.request.target.sourceId,
    provider: input.provider,
    workflowId: input.request.workflowId,
    workflowExecutionId: input.request.workflowExecutionId,
    nodeId: input.request.nodeId,
    nodeExecId: input.request.nodeExecId,
    eventId: input.request.target.eventId,
    conversationId: input.request.target.conversationId,
    ...(input.request.target.threadId === undefined
      ? {}
      : { threadId: input.request.target.threadId }),
    ...(input.request.target.actorId === undefined
      ? {}
      : { actorId: input.request.target.actorId }),
    status: input.status,
    ...(input.result?.dispatchId === undefined
      ? {}
      : { dispatchId: input.result.dispatchId }),
    ...(input.result?.providerMessageId === undefined
      ? {}
      : { providerMessageId: input.result.providerMessageId }),
    requestJson: JSON.stringify(input.request),
    ...(responsePayload === undefined
      ? {}
      : { responseJson: JSON.stringify(responsePayload) }),
    ...(input.error === undefined ? {} : { error: input.error }),
    updatedAt: input.updatedAt,
  };
}
