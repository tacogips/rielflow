import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { atomicWriteJsonFile } from "../shared/fs";
import { resolveRootDataDir } from "../workflow/paths";
import type { LoadOptions } from "../workflow/types";
import {
  findActiveEventSupervisedRunRow,
  findEventSupervisorCommandResultJson,
  findLatestEventSupervisedRunRow,
  insertEventSupervisorCommandRow,
  loadEventSupervisedRunRowById,
  type RuntimeEventSupervisedRunSaveInput,
  type RuntimeEventSupervisorCommandSaveInput,
  updateEventSupervisorCommandResultJson,
  upsertEventSupervisedRunToRuntimeDb,
} from "../workflow/runtime-db";
import type {
  EventSupervisedRunRecord,
  EventSupervisedRunStatus,
  EventSupervisorCommand,
} from "./types";

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96) || "run";
}

function rowToRecord(row: RuntimeEventSupervisedRunSaveInput): EventSupervisedRunRecord {
  return {
    supervisedRunId: row.supervisedRunId,
    sourceId: row.sourceId,
    bindingId: row.bindingId,
    correlationKey: row.correlationKey,
    supervisorWorkflowName: row.supervisorWorkflowName,
    ...(row.supervisorExecutionId === undefined
      ? {}
      : { supervisorExecutionId: row.supervisorExecutionId }),
    targetWorkflowName: row.targetWorkflowName,
    ...(row.activeTargetExecutionId === undefined
      ? {}
      : { activeTargetExecutionId: row.activeTargetExecutionId }),
    status: row.status as EventSupervisedRunStatus,
    restartCount: row.restartCount,
    maxRestartsOnFailure: row.maxRestartsOnFailure,
    autoImproveEnabled: row.autoImproveEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Same-process: promise chains per correlation so synchronous SQLite locking below
 * never blocks the event loop waiting on itself. Cross-process: per-correlation
 * SQLite lock files (BEGIN IMMEDIATE) serialize concurrent listeners sharing one data root.
 */
const correlationQueues = new Map<string, Promise<unknown>>();

/**
 * In-process same-correlation waiters. Exposed for tests; should be 0 when idle.
 */
export function supervisedInProcessCorrelationQueueSize(): number {
  return correlationQueues.size;
}

async function withSupervisedCorrelationQueue<T>(
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = correlationQueues.get(key) ?? Promise.resolve();
  const current = previous.then(() => work());
  const chainTail = current.then(
    () => undefined,
    () => undefined,
  );
  correlationQueues.set(key, chainTail);
  try {
    return await current;
  } finally {
    if (correlationQueues.get(key) === chainTail) {
      correlationQueues.delete(key);
    }
  }
}

function correlationLockDbPath(
  input: SupervisedRunCorrelationKey,
  loadOptions: LoadOptions,
): string {
  const raw = `${input.sourceId}\t${input.bindingId}\t${input.correlationKey}`;
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 32);
  const root = resolveRootDataDir(loadOptions);
  return path.join(
    root,
    "events",
    "supervised-correlation-locks",
    `${hash}.sqlite`,
  );
}

async function withSqliteCorrelationMutex<T>(
  input: SupervisedRunCorrelationKey,
  loadOptions: LoadOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = correlationLockDbPath(input, loadOptions);
  await mkdir(path.dirname(lockPath), { recursive: true });
  const db = new Database(lockPath);
  try {
    db.exec("PRAGMA busy_timeout = 60000");
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore rollback failures
      }
      throw error;
    }
  } finally {
    db.close();
  }
}

export interface SupervisedRunCorrelationKey {
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
}

export interface EventSupervisedRunRepository {
  findActiveByCorrelation(
    input: SupervisedRunCorrelationKey,
  ): Promise<EventSupervisedRunRecord | null>;
  findLatestByCorrelation(
    input: SupervisedRunCorrelationKey,
  ): Promise<EventSupervisedRunRecord | null>;
  save(record: EventSupervisedRunRecord, artifactDir: string): Promise<void>;
  loadById(supervisedRunId: string): Promise<EventSupervisedRunRecord | null>;
  claimCommandSlot(input: {
    readonly command: EventSupervisorCommand;
    readonly supervisedRunId: string;
  }): Promise<
    | { readonly outcome: "execute" }
    | { readonly outcome: "replay"; readonly resultJson: string }
  >;
  finalizeCommand(commandId: string, result: unknown): Promise<void>;
  withCorrelationLock<T>(
    input: SupervisedRunCorrelationKey,
    fn: () => Promise<T>,
  ): Promise<T>;
}

function isPendingSupervisorCommandEnvelope(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as {
      readonly pending?: unknown;
      readonly result?: unknown;
      readonly finalizedAt?: unknown;
    };
    return (
      parsed.pending === true &&
      parsed.result === undefined &&
      parsed.finalizedAt === undefined
    );
  } catch {
    return false;
  }
}

async function waitForSupervisorCommandResult(
  commandId: string,
  options: LoadOptions,
): Promise<string | null> {
  let latest = await findEventSupervisorCommandResultJson(commandId, options);
  if (latest === null || !isPendingSupervisorCommandEnvelope(latest)) {
    return latest;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    latest = await findEventSupervisorCommandResultJson(commandId, options);
    if (latest === null || !isPendingSupervisorCommandEnvelope(latest)) {
      return latest;
    }
  }
  return latest;
}

function recordToSaveInput(
  record: EventSupervisedRunRecord,
  artifactDir: string,
): RuntimeEventSupervisedRunSaveInput {
  return {
    supervisedRunId: record.supervisedRunId,
    sourceId: record.sourceId,
    bindingId: record.bindingId,
    correlationKey: record.correlationKey,
    supervisorWorkflowName: record.supervisorWorkflowName,
    ...(record.supervisorExecutionId === undefined
      ? {}
      : { supervisorExecutionId: record.supervisorExecutionId }),
    targetWorkflowName: record.targetWorkflowName,
    ...(record.activeTargetExecutionId === undefined
      ? {}
      : { activeTargetExecutionId: record.activeTargetExecutionId }),
    status: record.status,
    restartCount: record.restartCount,
    maxRestartsOnFailure: record.maxRestartsOnFailure,
    autoImproveEnabled: record.autoImproveEnabled,
    artifactDir,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createEventSupervisedRunRepository(
  options: LoadOptions = {},
): EventSupervisedRunRepository {
  return {
    async findActiveByCorrelation(
      input: SupervisedRunCorrelationKey,
    ): Promise<EventSupervisedRunRecord | null> {
      const row = await findActiveEventSupervisedRunRow(input, options);
      return row === null ? null : rowToRecord(row);
    },

    async findLatestByCorrelation(
      input: SupervisedRunCorrelationKey,
    ): Promise<EventSupervisedRunRecord | null> {
      const row = await findLatestEventSupervisedRunRow(input, options);
      return row === null ? null : rowToRecord(row);
    },

    async save(
      record: EventSupervisedRunRecord,
      artifactDir: string,
    ): Promise<void> {
      await atomicWriteJsonFile(
        path.join(artifactDir, "record.json"),
        record,
      );
      await upsertEventSupervisedRunToRuntimeDb(
        recordToSaveInput(record, artifactDir),
        options,
      );
    },

    async loadById(
      supervisedRunId: string,
    ): Promise<EventSupervisedRunRecord | null> {
      const row = await loadEventSupervisedRunRowById(supervisedRunId, options);
      return row === null ? null : rowToRecord(row);
    },

    async claimCommandSlot(input: {
      readonly command: EventSupervisorCommand;
      readonly supervisedRunId: string;
    }): Promise<
      | { readonly outcome: "execute" }
      | { readonly outcome: "replay"; readonly resultJson: string }
    > {
      const now = new Date().toISOString();
      const row: RuntimeEventSupervisorCommandSaveInput = {
        commandId: input.command.commandId,
        supervisedRunId: input.supervisedRunId,
        sourceId: input.command.sourceId,
        bindingId: input.command.bindingId,
        correlationKey: input.command.correlationKey,
        action: input.command.action,
        receiptId: input.command.receivedEventReceiptId,
        resultJson: JSON.stringify({ pending: true, startedAt: now }),
        createdAt: now,
      };
      const outcome = await insertEventSupervisorCommandRow(row, options);
      if (outcome === "inserted") {
        return { outcome: "execute" };
      }
      const existing = await waitForSupervisorCommandResult(
        input.command.commandId,
        options,
      );
      if (existing === null) {
        throw new Error("duplicate supervisor command without stored row");
      }
      if (isPendingSupervisorCommandEnvelope(existing)) {
        throw new Error(
          "supervisor command is already in progress for this command id",
        );
      }
      return { outcome: "replay", resultJson: existing };
    },

    async finalizeCommand(commandId: string, result: unknown): Promise<void> {
      const now = new Date().toISOString();
      await updateEventSupervisorCommandResultJson(
        commandId,
        JSON.stringify({ result, finalizedAt: now }),
        options,
      );
    },

    withCorrelationLock<T>(
      input: SupervisedRunCorrelationKey,
      fn: () => Promise<T>,
    ): Promise<T> {
      const key = `${input.sourceId}\t${input.bindingId}\t${input.correlationKey}`;
      return withSupervisedCorrelationQueue(key, () =>
        withSqliteCorrelationMutex(input, options, fn),
      );
    },
  };
}

export function resolveSupervisedRunArtifactDir(
  record: Pick<EventSupervisedRunRecord, "supervisedRunId">,
  loadOptions: LoadOptions = {},
): string {
  const root = resolveRootDataDir(loadOptions);
  return path.join(
    root,
    "events",
    "supervised-runs",
    safeSegment(record.supervisedRunId),
  );
}

export function newSupervisedRunId(): string {
  return `esv-${randomUUID().slice(0, 12)}`;
}
