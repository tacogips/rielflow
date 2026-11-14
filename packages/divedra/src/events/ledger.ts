import { randomUUID } from "node:crypto";
import path from "node:path";
import { safeArtifactPathSegment } from "../shared/artifacts";
import { atomicWriteJsonFile } from "../shared/fs";
import { resolveRootDataDir } from "../workflow/paths";
import {
  findEventReceiptByDedupeKey,
  saveEventReceiptToRuntimeDb,
} from "../workflow/runtime-db";
import type { DivedraOptions } from "../lib";
import type {
  EventArtifactRef,
  EventBinding,
  EventReceiptRecord,
  EventReceiptStatus,
  ExternalEventEnvelope,
} from "./types";

export interface EventReceiptBeginResult {
  readonly record: EventReceiptRecord;
  readonly artifactDir: string;
  readonly duplicateOf?: string;
}

function dateSegment(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

function artifactRelativePath(
  record: EventReceiptRecord,
  fileName: string,
): string {
  return path.posix.join(
    "events",
    safeArtifactPathSegment(record.sourceId, "event"),
    dateSegment(record.receivedAt),
    safeArtifactPathSegment(record.receiptId, "event"),
    fileName,
  );
}

function buildArtifactRef(
  record: EventReceiptRecord,
  fileName: string,
): EventArtifactRef {
  return {
    root: "artifact",
    path: artifactRelativePath(record, fileName),
  };
}

function artifactAbsolutePath(
  options: DivedraOptions,
  record: EventReceiptRecord,
  fileName: string,
): string {
  return path.join(
    resolveRootDataDir(options),
    artifactRelativePath(record, fileName),
  );
}

function artifactDirectory(
  options: DivedraOptions,
  record: EventReceiptRecord,
): string {
  return path.dirname(artifactAbsolutePath(options, record, "normalized.json"));
}

function buildReceiptId(receivedAt: string): string {
  const compactTime = receivedAt.replace(/[^0-9]/g, "").slice(0, 14);
  return `evt-${compactTime}-${randomUUID().slice(0, 12)}`;
}

function dedupeSince(
  binding: EventBinding | undefined,
  receivedAt: string,
): string | undefined {
  const dedupeWindowMs = binding?.execution?.dedupeWindowMs;
  if (dedupeWindowMs === undefined) {
    return undefined;
  }
  return new Date(
    new Date(receivedAt).getTime() - dedupeWindowMs,
  ).toISOString();
}

async function indexReceipt(
  record: EventReceiptRecord,
  artifactDir: string,
  options: DivedraOptions,
): Promise<void> {
  await saveEventReceiptToRuntimeDb(
    {
      receiptId: record.receiptId,
      sourceId: record.sourceId,
      ...(record.bindingId === undefined
        ? {}
        : { bindingId: record.bindingId }),
      dedupeKey: record.dedupeKey,
      status: record.status,
      ...(record.workflowName === undefined
        ? {}
        : { workflowName: record.workflowName }),
      ...(record.workflowExecutionId === undefined
        ? {}
        : { workflowExecutionId: record.workflowExecutionId }),
      ...(record.supervisedRunId === undefined
        ? {}
        : { supervisedRunId: record.supervisedRunId }),
      ...(record.supervisorExecutionId === undefined
        ? {}
        : { supervisorExecutionId: record.supervisorExecutionId }),
      ...(record.supervisorConversationId === undefined
        ? {}
        : { supervisorConversationId: record.supervisorConversationId }),
      ...(record.supervisorDecisionId === undefined
        ? {}
        : { supervisorDecisionId: record.supervisorDecisionId }),
      artifactDir,
      ...(record.error === undefined ? {} : { error: record.error }),
      receivedAt: record.receivedAt,
      updatedAt: record.updatedAt,
    },
    options,
  );
}

export async function writeEventReceiptArtifact(
  record: EventReceiptRecord,
  fileName: string,
  payload: unknown,
  options: DivedraOptions = {},
): Promise<EventArtifactRef> {
  await atomicWriteJsonFile(
    artifactAbsolutePath(options, record, fileName),
    payload,
  );
  return buildArtifactRef(record, fileName);
}

export async function beginEventReceipt(
  input: {
    readonly event: ExternalEventEnvelope;
    readonly binding?: EventBinding;
    readonly raw?: unknown;
    readonly status?: EventReceiptStatus;
  },
  options: DivedraOptions = {},
): Promise<EventReceiptBeginResult> {
  const bindingId = input.binding?.id;
  const since = dedupeSince(input.binding, input.event.receivedAt);
  const duplicate = await findEventReceiptByDedupeKey(
    {
      sourceId: input.event.sourceId,
      ...(bindingId === undefined ? {} : { bindingId }),
      dedupeKey: input.event.dedupeKey,
      ...(since === undefined ? {} : { since }),
    },
    options,
  );
  const duplicateStatus =
    duplicate === null ? (input.status ?? "received") : "duplicate";
  const now = new Date().toISOString();
  let record: EventReceiptRecord = {
    receiptId: buildReceiptId(input.event.receivedAt),
    sourceId: input.event.sourceId,
    ...(bindingId === undefined ? {} : { bindingId }),
    dedupeKey: input.event.dedupeKey,
    status: duplicateStatus,
    ...(input.binding?.workflowName === undefined
      ? {}
      : { workflowName: input.binding.workflowName }),
    receivedAt: input.event.receivedAt,
    updatedAt: now,
  };
  if (input.raw !== undefined) {
    const rawRef = await writeEventReceiptArtifact(
      record,
      "raw.json",
      input.raw,
      options,
    );
    record = { ...record, rawRef };
  }
  const normalizedRef = await writeEventReceiptArtifact(
    record,
    "normalized.json",
    input.event,
    options,
  );
  record = { ...record, normalizedRef };
  const artifactDir = artifactDirectory(options, record);
  await indexReceipt(record, artifactDir, options);
  return {
    record,
    artifactDir,
    ...(duplicate === null ? {} : { duplicateOf: duplicate.receiptId }),
  };
}

export async function updateEventReceipt(
  input: {
    readonly record: EventReceiptRecord;
    readonly artifactDir?: string;
    readonly status: EventReceiptStatus;
    readonly workflowExecutionId?: string;
    readonly supervisedRunId?: string;
    readonly supervisorExecutionId?: string;
    readonly supervisorConversationId?: string;
    readonly supervisorDecisionId?: string;
    readonly inputPayload?: unknown;
    readonly dispatchPayload?: unknown;
    readonly error?: string;
  },
  options: DivedraOptions = {},
): Promise<EventReceiptRecord> {
  let record: EventReceiptRecord = {
    ...input.record,
    status: input.status,
    ...(input.workflowExecutionId === undefined
      ? {}
      : { workflowExecutionId: input.workflowExecutionId }),
    ...(input.supervisedRunId === undefined
      ? {}
      : { supervisedRunId: input.supervisedRunId }),
    ...(input.supervisorExecutionId === undefined
      ? {}
      : { supervisorExecutionId: input.supervisorExecutionId }),
    ...(input.supervisorConversationId === undefined
      ? {}
      : { supervisorConversationId: input.supervisorConversationId }),
    ...(input.supervisorDecisionId === undefined
      ? {}
      : { supervisorDecisionId: input.supervisorDecisionId }),
    ...(input.error === undefined ? {} : { error: input.error }),
    updatedAt: new Date().toISOString(),
  };
  if (input.inputPayload !== undefined) {
    const inputRef = await writeEventReceiptArtifact(
      record,
      "workflow-input.json",
      input.inputPayload,
      options,
    );
    record = { ...record, inputRef };
  }
  if (input.dispatchPayload !== undefined) {
    const dispatchRef = await writeEventReceiptArtifact(
      record,
      "dispatch.json",
      input.dispatchPayload,
      options,
    );
    record = { ...record, dispatchRef };
  }
  if (input.error !== undefined) {
    const errorRef = await writeEventReceiptArtifact(
      record,
      "error.json",
      { error: input.error },
      options,
    );
    record = { ...record, errorRef };
  }
  await indexReceipt(
    record,
    input.artifactDir ?? artifactDirectory(options, record),
    options,
  );
  return record;
}
