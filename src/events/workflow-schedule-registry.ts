import { randomUUID } from "node:crypto";
import { isJsonObject, type JsonObject } from "../shared/json";
import type { DivedraOptions } from "../lib";
import { withEventRuntimeDatabase } from "../workflow/runtime-db";
import type {
  WorkflowScheduleKind,
  WorkflowScheduleRecord,
  WorkflowScheduleStatus,
} from "./types";

export interface WorkflowScheduleCreateInput {
  readonly sourceId: string;
  readonly bindingId: string;
  readonly sourceReceiptId: string;
  readonly workflowName: string;
  readonly workflowSource?: JsonObject;
  readonly kind: WorkflowScheduleKind;
  readonly timezone: string;
  readonly dueAt?: string;
  readonly cron?: string;
  readonly nextDueAt: string;
  readonly workflowInput: JsonObject;
  readonly conversationId?: string;
  readonly threadId?: string;
  readonly actorId?: string;
  readonly now?: string;
}

export interface WorkflowScheduleListInput {
  readonly sourceId?: string;
  readonly status?: WorkflowScheduleStatus;
  readonly limit?: number;
}

export interface WorkflowScheduleCancelInput {
  readonly scheduleId: string;
  readonly reason?: string;
  readonly now?: string;
}

export interface WorkflowScheduleOccurrenceInput {
  readonly scheduleId: string;
  readonly occurrenceId: string;
  readonly scheduledAt: string;
  readonly firedAt: string;
  readonly now?: string;
}

export interface WorkflowScheduleCompletionInput {
  readonly scheduleId: string;
  readonly occurrenceId: string;
  readonly workflowExecutionId?: string;
  readonly nextDueAt?: string;
  readonly now?: string;
}

export interface WorkflowScheduleFailureInput {
  readonly scheduleId: string;
  readonly occurrenceId: string;
  readonly error: string;
  readonly nextDueAt?: string;
  readonly now?: string;
}

export interface WorkflowScheduleRescheduleInput {
  readonly scheduleId: string;
  readonly nextDueAt: string;
  readonly now?: string;
}

export interface WorkflowScheduleRepository {
  create(input: WorkflowScheduleCreateInput): Promise<WorkflowScheduleRecord>;
  load(scheduleId: string): Promise<WorkflowScheduleRecord | null>;
  list(
    input?: WorkflowScheduleListInput,
  ): Promise<readonly WorkflowScheduleRecord[]>;
  loadActive(): Promise<readonly WorkflowScheduleRecord[]>;
  cancel(input: WorkflowScheduleCancelInput): Promise<WorkflowScheduleRecord>;
  markFiring(
    input: WorkflowScheduleOccurrenceInput,
  ): Promise<WorkflowScheduleRecord>;
  markCompleted(
    input: WorkflowScheduleCompletionInput,
  ): Promise<WorkflowScheduleRecord>;
  markFailed(
    input: WorkflowScheduleFailureInput,
  ): Promise<WorkflowScheduleRecord>;
  rescheduleNextDueAt(
    input: WorkflowScheduleRescheduleInput,
  ): Promise<WorkflowScheduleRecord>;
}

interface WorkflowScheduleRow {
  readonly schedule_id: string;
  readonly source_id: string;
  readonly binding_id: string;
  readonly source_receipt_id: string;
  readonly workflow_name: string;
  readonly workflow_source_json: string | null;
  readonly kind: WorkflowScheduleKind;
  readonly timezone: string;
  readonly due_at: string | null;
  readonly cron: string | null;
  readonly next_due_at: string;
  readonly status: WorkflowScheduleStatus;
  readonly workflow_input_json: string;
  readonly conversation_id: string | null;
  readonly thread_id: string | null;
  readonly actor_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_execution_id: string | null;
  readonly last_fired_at: string | null;
  readonly last_occurrence_id: string | null;
  readonly attempt_count: number;
  readonly last_error: string | null;
}

const VALID_KINDS = new Set<WorkflowScheduleKind>(["one-time", "recurring"]);
const VALID_STATUSES = new Set<WorkflowScheduleStatus>([
  "active",
  "paused",
  "completed",
  "cancelled",
  "failed",
]);

function requireIsoTimestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${label} must be a valid ISO timestamp`);
  }
  return parsed.toISOString();
}

function parseJsonObject(
  value: string | null,
  label: string,
): JsonObject | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = JSON.parse(value) as unknown;
  if (!isJsonObject(parsed)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return parsed;
}

function toRecord(row: WorkflowScheduleRow): WorkflowScheduleRecord {
  if (!VALID_KINDS.has(row.kind)) {
    throw new Error(`invalid workflow schedule kind '${String(row.kind)}'`);
  }
  if (!VALID_STATUSES.has(row.status)) {
    throw new Error(`invalid workflow schedule status '${String(row.status)}'`);
  }
  const workflowInput = parseJsonObject(
    row.workflow_input_json,
    "workflow schedule workflow_input_json",
  );
  if (workflowInput === undefined) {
    throw new Error("workflow schedule workflow_input_json is required");
  }
  const workflowSource = parseJsonObject(
    row.workflow_source_json,
    "workflow schedule workflow_source_json",
  );
  return {
    scheduleId: row.schedule_id,
    sourceId: row.source_id,
    bindingId: row.binding_id,
    sourceReceiptId: row.source_receipt_id,
    workflowName: row.workflow_name,
    ...(workflowSource === undefined ? {} : { workflowSource }),
    kind: row.kind,
    timezone: row.timezone,
    ...(row.due_at === null ? {} : { dueAt: row.due_at }),
    ...(row.cron === null ? {} : { cron: row.cron }),
    nextDueAt: row.next_due_at,
    status: row.status,
    workflowInput,
    ...(row.conversation_id === null
      ? {}
      : { conversationId: row.conversation_id }),
    ...(row.thread_id === null ? {} : { threadId: row.thread_id }),
    ...(row.actor_id === null ? {} : { actorId: row.actor_id }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_execution_id === null
      ? {}
      : { lastExecutionId: row.last_execution_id }),
    ...(row.last_fired_at === null ? {} : { lastFiredAt: row.last_fired_at }),
    ...(row.last_occurrence_id === null
      ? {}
      : { lastOccurrenceId: row.last_occurrence_id }),
    attemptCount: row.attempt_count,
    ...(row.last_error === null ? {} : { lastError: row.last_error }),
  };
}

function validateCreateInput(input: WorkflowScheduleCreateInput): void {
  if (input.workflowName.trim().length === 0) {
    throw new Error("workflowName is required");
  }
  if (input.kind === "one-time" && input.dueAt === undefined) {
    throw new Error("one-time workflow schedules require dueAt");
  }
  if (input.kind === "recurring" && input.cron === undefined) {
    throw new Error("recurring workflow schedules require cron");
  }
  requireIsoTimestamp(input.nextDueAt, "nextDueAt");
  if (input.dueAt !== undefined) {
    requireIsoTimestamp(input.dueAt, "dueAt");
  }
}

function notFound(scheduleId: string): Error {
  return new Error(`workflow schedule not found: ${scheduleId}`);
}

export function createWorkflowScheduleRepository(
  options: DivedraOptions = {},
): WorkflowScheduleRepository {
  const loadRecord = async (
    scheduleId: string,
  ): Promise<WorkflowScheduleRecord | null> =>
    withEventRuntimeDatabase(options, (db) => {
      const row = db
        .query("SELECT * FROM workflow_schedules WHERE schedule_id = ? LIMIT 1")
        .get(scheduleId) as WorkflowScheduleRow | null;
      return row === null ? null : toRecord(row);
    });

  return {
    async create(input): Promise<WorkflowScheduleRecord> {
      validateCreateInput(input);
      const now = input.now ?? new Date().toISOString();
      const scheduleId = `sched_${randomUUID().slice(0, 12)}`;
      await withEventRuntimeDatabase(options, (db) => {
        db.prepare(
          `INSERT INTO workflow_schedules (
            schedule_id, source_id, binding_id, source_receipt_id,
            workflow_name, workflow_source_json, kind, timezone, due_at, cron,
            next_due_at, status, workflow_input_json, conversation_id,
            thread_id, actor_id, created_at, updated_at, attempt_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          scheduleId,
          input.sourceId,
          input.bindingId,
          input.sourceReceiptId,
          input.workflowName.trim(),
          input.workflowSource === undefined
            ? null
            : JSON.stringify(input.workflowSource),
          input.kind,
          input.timezone,
          input.dueAt ?? null,
          input.cron ?? null,
          requireIsoTimestamp(input.nextDueAt, "nextDueAt"),
          "active",
          JSON.stringify(input.workflowInput),
          input.conversationId ?? null,
          input.threadId ?? null,
          input.actorId ?? null,
          now,
          now,
          0,
        );
      });
      const record = await loadRecord(scheduleId);
      if (record === null) {
        throw notFound(scheduleId);
      }
      return record;
    },
    load: loadRecord,
    async list(input = {}): Promise<readonly WorkflowScheduleRecord[]> {
      const limit = input.limit ?? 100;
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error("--limit must be a positive integer");
      }
      return withEventRuntimeDatabase(options, (db) => {
        const rows = db
          .query(
            `SELECT * FROM workflow_schedules
             WHERE (? IS NULL OR source_id = ?)
               AND (? IS NULL OR status = ?)
             ORDER BY updated_at DESC
             LIMIT ?`,
          )
          .all(
            input.sourceId ?? null,
            input.sourceId ?? null,
            input.status ?? null,
            input.status ?? null,
            limit,
          ) as WorkflowScheduleRow[];
        return rows.map(toRecord);
      });
    },
    async loadActive(): Promise<readonly WorkflowScheduleRecord[]> {
      return withEventRuntimeDatabase(options, (db) => {
        const rows = db
          .query(
            `SELECT * FROM workflow_schedules
             WHERE status = 'active'
             ORDER BY next_due_at ASC`,
          )
          .all() as WorkflowScheduleRow[];
        return rows.map(toRecord);
      });
    },
    async cancel(input): Promise<WorkflowScheduleRecord> {
      const now = input.now ?? new Date().toISOString();
      await withEventRuntimeDatabase(options, (db) => {
        db.prepare(
          `UPDATE workflow_schedules
           SET status = 'cancelled', updated_at = ?, last_error = ?
           WHERE schedule_id = ? AND status IN ('active', 'paused', 'failed')`,
        ).run(now, input.reason ?? null, input.scheduleId);
      });
      const record = await loadRecord(input.scheduleId);
      if (record === null) {
        throw notFound(input.scheduleId);
      }
      return record;
    },
    async markFiring(input): Promise<WorkflowScheduleRecord> {
      const now = input.now ?? new Date().toISOString();
      await withEventRuntimeDatabase(options, (db) => {
        db.prepare(
          `UPDATE workflow_schedules
           SET last_fired_at = ?, attempt_count = attempt_count + 1,
               last_occurrence_id = ?, updated_at = ?, last_error = NULL
           WHERE schedule_id = ? AND status = 'active'
             AND next_due_at = ?
             AND (last_occurrence_id IS NULL OR last_occurrence_id <> ?)`,
        ).run(
          requireIsoTimestamp(input.firedAt, "firedAt"),
          input.occurrenceId,
          now,
          input.scheduleId,
          requireIsoTimestamp(input.scheduledAt, "scheduledAt"),
          input.occurrenceId,
        );
      });
      const record = await loadRecord(input.scheduleId);
      if (record === null) {
        throw notFound(input.scheduleId);
      }
      return record;
    },
    async markCompleted(input): Promise<WorkflowScheduleRecord> {
      const now = input.now ?? new Date().toISOString();
      const nextDueAt =
        input.nextDueAt === undefined
          ? undefined
          : requireIsoTimestamp(input.nextDueAt, "nextDueAt");
      await withEventRuntimeDatabase(options, (db) => {
        db.prepare(
          `UPDATE workflow_schedules
           SET status = CASE WHEN ? IS NULL THEN 'completed' ELSE 'active' END,
               next_due_at = COALESCE(?, next_due_at),
               last_execution_id = COALESCE(?, last_execution_id),
               updated_at = ?, last_error = NULL
           WHERE schedule_id = ? AND status = 'active'
             AND last_occurrence_id = ?`,
        ).run(
          nextDueAt ?? null,
          nextDueAt ?? null,
          input.workflowExecutionId ?? null,
          now,
          input.scheduleId,
          input.occurrenceId,
        );
      });
      const record = await loadRecord(input.scheduleId);
      if (record === null) {
        throw notFound(input.scheduleId);
      }
      return record;
    },
    async markFailed(input): Promise<WorkflowScheduleRecord> {
      const now = input.now ?? new Date().toISOString();
      const nextDueAt =
        input.nextDueAt === undefined
          ? undefined
          : requireIsoTimestamp(input.nextDueAt, "nextDueAt");
      await withEventRuntimeDatabase(options, (db) => {
        db.prepare(
          `UPDATE workflow_schedules
           SET status = CASE WHEN ? IS NULL THEN 'failed' ELSE 'active' END,
               next_due_at = COALESCE(?, next_due_at),
               updated_at = ?, last_error = ?
           WHERE schedule_id = ? AND status = 'active'
             AND last_occurrence_id = ?`,
        ).run(
          nextDueAt ?? null,
          nextDueAt ?? null,
          now,
          input.error,
          input.scheduleId,
          input.occurrenceId,
        );
      });
      const record = await loadRecord(input.scheduleId);
      if (record === null) {
        throw notFound(input.scheduleId);
      }
      return record;
    },
    async rescheduleNextDueAt(input): Promise<WorkflowScheduleRecord> {
      const now = input.now ?? new Date().toISOString();
      const nextDueAt = requireIsoTimestamp(input.nextDueAt, "nextDueAt");
      await withEventRuntimeDatabase(options, (db) => {
        db.prepare(
          `UPDATE workflow_schedules
           SET next_due_at = ?, updated_at = ?
           WHERE schedule_id = ? AND status = 'active'`,
        ).run(nextDueAt, now, input.scheduleId);
      });
      const record = await loadRecord(input.scheduleId);
      if (record === null) {
        throw notFound(input.scheduleId);
      }
      return record;
    },
  };
}
