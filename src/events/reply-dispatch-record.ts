import type {
  ChatReplyDispatchRequest,
  ChatReplyDispatchResult,
} from "../workflow/types";
import type {
  RuntimeEventReplyDispatchRecord,
  RuntimeEventReplyDispatchSaveInput,
} from "../workflow/runtime-db";
import type {
  ChatOutputDestinationConfig,
  EventConfiguration,
  EventOutputDestinationConfig,
} from "./types";

export function resolveReplyDispatchProvider(input: {
  readonly configuration: EventConfiguration;
  readonly sourceId: string;
  readonly outputDestinationId?: string;
  readonly outputDestinationIds?: readonly string[];
}): string {
  const provider =
    providerForDestination(input.configuration, input.outputDestinationId) ??
    input.outputDestinationIds
      ?.map((id) => providerForDestination(input.configuration, id))
      .find((entry) => entry !== undefined);
  if (provider !== undefined) {
    return provider;
  }
  const source = input.configuration.sources.find(
    (entry) => entry.id === input.sourceId,
  );
  return source?.provider ?? source?.kind ?? "unknown";
}

export function persistedToDispatchResult(
  record: RuntimeEventReplyDispatchRecord | null,
): ChatReplyDispatchResult | null {
  if (
    record === null ||
    (record.status !== "sent" && record.status !== "queued")
  ) {
    return null;
  }
  const response = parsePersistedDispatchResponse(record.responseJson);
  return {
    status: record.status,
    provider: record.provider,
    ...(record.dispatchId === null ? {} : { dispatchId: record.dispatchId }),
    ...(record.providerMessageId === null
      ? {}
      : { providerMessageId: record.providerMessageId }),
    ...(response?.destinationResults === undefined
      ? {}
      : { destinationResults: response.destinationResults }),
  };
}

export function buildReplyDispatchSaveInput(input: {
  readonly request: ChatReplyDispatchRequest;
  readonly provider: string;
  readonly status:
    | "dispatching"
    | "sent"
    | "queued"
    | "failed"
    | "no_delivery_target";
  readonly result?: ChatReplyDispatchResult;
  readonly error?: string;
  readonly updatedAt: string;
}): RuntimeEventReplyDispatchSaveInput {
  const responsePayload = dispatchResultResponsePayload(input.result);
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

function providerForDestination(
  configuration: EventConfiguration,
  destinationId: string | undefined,
): string | undefined {
  if (destinationId === undefined) {
    return undefined;
  }
  const destination = configuration.destinations.find(
    (entry) => entry.id === destinationId,
  );
  return resolveDestinationProvider(configuration, destination);
}

function resolveDestinationProvider(
  configuration: EventConfiguration,
  destination: EventOutputDestinationConfig | undefined,
): string | undefined {
  if (destination?.provider !== undefined) {
    return destination.provider;
  }
  if (destination?.kind !== "chat") {
    return undefined;
  }
  const chatDestination = destination as ChatOutputDestinationConfig;
  const source = configuration.sources.find(
    (entry) => entry.id === chatDestination.sourceId,
  );
  return source?.provider ?? source?.kind;
}

function dispatchResultResponsePayload(
  result: ChatReplyDispatchResult | undefined,
):
  | {
      readonly status: ChatReplyDispatchResult["status"];
      readonly provider: string;
      readonly dispatchId?: string;
      readonly providerMessageId?: string;
      readonly destinationResults?: ChatReplyDispatchResult["destinationResults"];
    }
  | undefined {
  if (result === undefined) {
    return undefined;
  }
  return {
    status: result.status,
    provider: result.provider,
    ...(result.dispatchId === undefined
      ? {}
      : { dispatchId: result.dispatchId }),
    ...(result.providerMessageId === undefined
      ? {}
      : { providerMessageId: result.providerMessageId }),
    ...(result.destinationResults === undefined
      ? {}
      : { destinationResults: result.destinationResults }),
  };
}

function parsePersistedDispatchResponse(responseJson: string | null):
  | {
      readonly destinationResults?: ChatReplyDispatchResult["destinationResults"];
    }
  | undefined {
  if (responseJson === null) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(responseJson) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const destinationResults = (
      parsed as { readonly destinationResults?: unknown }
    ).destinationResults;
    if (!Array.isArray(destinationResults)) {
      return undefined;
    }
    const normalized = destinationResults.filter(
      (
        entry,
      ): entry is NonNullable<
        ChatReplyDispatchResult["destinationResults"]
      >[number] =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { sourceId?: unknown }).sourceId === "string" &&
        typeof (entry as { idempotencyKey?: unknown }).idempotencyKey ===
          "string" &&
        ((entry as { status?: unknown }).status === "sent" ||
          (entry as { status?: unknown }).status === "queued") &&
        typeof (entry as { provider?: unknown }).provider === "string",
    );
    return normalized.length === 0
      ? undefined
      : { destinationResults: normalized };
  } catch {
    return undefined;
  }
}
