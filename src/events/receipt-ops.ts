import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isJsonObject } from "../shared/json";
import type { DivedraOptions } from "../lib";
import {
  listEventReceiptsFromRuntimeDb,
  loadEventReceiptFromRuntimeDb,
  type RuntimeEventReceiptIndexRecord,
} from "../workflow/runtime-db";
import { loadEventConfiguration } from "./config";
import { createDefaultEventSourceRegistry } from "./adapter-registry";
import { createEventReplyDispatcher } from "./reply-dispatcher";
import {
  createWorkflowTriggerRunner,
  dispatchEventToMatchingBindings,
  type WorkflowTriggerResult,
  type WorkflowTriggerRunnerOptions,
} from "./trigger-runner";
import { loadAndValidateEventConfiguration } from "./validate";
import type {
  EventActor,
  EventArtifactRef,
  EventConfigLoadOptions,
  EventConversation,
  ExternalEventEnvelope,
} from "./types";

export interface ListEventReceiptsInput extends DivedraOptions {
  readonly sourceId?: string;
  readonly status?: string;
  readonly limit?: number;
}

export interface ReplayEventReceiptInput
  extends EventConfigLoadOptions,
    WorkflowTriggerRunnerOptions {
  readonly receiptId: string;
  readonly reason?: string;
}

export interface ReplayEventReceiptResult {
  readonly original: RuntimeEventReceiptIndexRecord;
  readonly replayEvent: ExternalEventEnvelope;
  readonly reason?: string;
  readonly receipts: readonly WorkflowTriggerResult[];
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`normalized event ${label} must be a non-empty string`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readOptionalActor(value: unknown): EventActor | undefined {
  if (!isJsonObject(value) || typeof value["id"] !== "string") {
    return undefined;
  }
  const displayName = readOptionalString(value["displayName"]);
  return {
    id: value["id"],
    ...(displayName === undefined ? {} : { displayName }),
  };
}

function readOptionalConversation(
  value: unknown,
): EventConversation | undefined {
  if (!isJsonObject(value) || typeof value["id"] !== "string") {
    return undefined;
  }
  const threadId = readOptionalString(value["threadId"]);
  return {
    id: value["id"],
    ...(threadId === undefined ? {} : { threadId }),
  };
}

function readOptionalArtifactRef(value: unknown): EventArtifactRef | undefined {
  if (
    !isJsonObject(value) ||
    value["root"] !== "artifact" ||
    typeof value["path"] !== "string" ||
    value["path"].length === 0
  ) {
    return undefined;
  }
  return { root: "artifact", path: value["path"] };
}

function asExternalEventEnvelope(value: unknown): ExternalEventEnvelope {
  if (!isJsonObject(value)) {
    throw new Error("normalized event artifact must contain a JSON object");
  }
  const input = value["input"];
  if (!isJsonObject(input)) {
    throw new Error("normalized event input must contain a JSON object");
  }
  const occurredAt = readOptionalString(value["occurredAt"]);
  const actor = readOptionalActor(value["actor"]);
  const conversation = readOptionalConversation(value["conversation"]);
  const rawRef = readOptionalArtifactRef(value["rawRef"]);
  return {
    sourceId: requireNonEmptyString(value["sourceId"], "sourceId"),
    eventId: requireNonEmptyString(value["eventId"], "eventId"),
    provider: requireNonEmptyString(value["provider"], "provider"),
    eventType: requireNonEmptyString(value["eventType"], "eventType"),
    ...(occurredAt === undefined ? {} : { occurredAt }),
    receivedAt: requireNonEmptyString(value["receivedAt"], "receivedAt"),
    dedupeKey: requireNonEmptyString(value["dedupeKey"], "dedupeKey"),
    ...(actor === undefined ? {} : { actor }),
    ...(conversation === undefined ? {} : { conversation }),
    input,
    ...(rawRef === undefined ? {} : { rawRef }),
  };
}

function normalizedArtifactPath(
  receipt: RuntimeEventReceiptIndexRecord,
): string {
  return path.join(receipt.artifactDir, "normalized.json");
}

function buildReplayEvent(
  event: ExternalEventEnvelope,
  receipt: RuntimeEventReceiptIndexRecord,
): ExternalEventEnvelope {
  const now = new Date().toISOString();
  const replayId = `replay-${receipt.receiptId}-${randomUUID().slice(0, 12)}`;
  return {
    ...event,
    eventId: `${event.eventId}:${replayId}`,
    receivedAt: now,
    dedupeKey: `${event.dedupeKey}:${replayId}`,
  };
}

function buildReplayAuditPayload(
  original: RuntimeEventReceiptIndexRecord,
  replayEvent: ExternalEventEnvelope,
  reason: string | undefined,
): Readonly<Record<string, unknown>> {
  return {
    replay: {
      originalReceiptId: original.receiptId,
      originalDedupeKey: original.dedupeKey,
      replayEventId: replayEvent.eventId,
      replayDedupeKey: replayEvent.dedupeKey,
      requestedAt: replayEvent.receivedAt,
      ...(reason === undefined ? {} : { reason }),
    },
  };
}

export async function listEventReceipts(
  input: ListEventReceiptsInput = {},
): Promise<readonly RuntimeEventReceiptIndexRecord[]> {
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("--limit must be a positive integer");
  }
  return listEventReceiptsFromRuntimeDb(
    {
      ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
      ...(input.status === undefined ? {} : { status: input.status }),
      limit,
    },
    input,
  );
}

export async function replayEventReceipt(
  input: ReplayEventReceiptInput,
): Promise<ReplayEventReceiptResult> {
  const validation = await loadAndValidateEventConfiguration(input);
  if (!validation.valid) {
    throw new Error(
      validation.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; "),
    );
  }
  const original = await loadEventReceiptFromRuntimeDb(input.receiptId, input);
  if (original === null) {
    throw new Error(`event receipt not found: ${input.receiptId}`);
  }
  const content = await readFile(normalizedArtifactPath(original), "utf8");
  const replayEvent = buildReplayEvent(
    asExternalEventEnvelope(JSON.parse(content) as unknown),
    original,
  );
  const configuration = await loadEventConfiguration(input);
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
  const receipts = await dispatchEventToMatchingBindings(
    {
      configuration,
      event: replayEvent,
      raw: buildReplayAuditPayload(original, replayEvent, input.reason),
      runner: createWorkflowTriggerRunner(triggerOptions),
    },
    triggerOptions,
  );
  return {
    original,
    replayEvent,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    receipts,
  };
}
