import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { resolveRootDataDir } from "./paths";
import type {
  CommunicationRecord,
  NodeExecutionRecord,
  SessionStatus,
  WorkflowSessionState,
} from "./session";
import { resolveCurrentStepId } from "./session";
import type { AdapterProcessLog } from "./adapter";
import type { LoadOptions } from "./types";

type RuntimeNodeLogLevel = "info" | "warning" | "error";
const PROCESS_LOG_MESSAGE_TEXT_LIMIT = 500;

interface RuntimeNodeExecutionRow {
  readonly sessionId: string;
  readonly nodeId: string;
  readonly stepId?: string;
  readonly nodeRegistryId?: string;
  readonly nodeExecId: string;
  readonly mailboxInstanceId?: string;
  readonly status: NodeExecutionRecord["status"];
  readonly artifactDir: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly attempt?: number;
  readonly outputAttemptCount?: number;
  readonly outputValidationErrors?: NodeExecutionRecord["outputValidationErrors"];
  readonly promptVariant?: string;
  readonly timeoutMs?: number;
  readonly backendSessionMode?: NodeExecutionRecord["backendSessionMode"];
  readonly backendSessionId?: NodeExecutionRecord["backendSessionId"];
  readonly restartedFromNodeExecId?: string;
  readonly inputJson: string;
  readonly outputJson: string;
  readonly inputHash: string;
  readonly outputHash: string;
}

export interface RuntimeSessionSummary {
  readonly sessionId: string;
  readonly workflowName: string;
  readonly workflowId: string;
  readonly status: SessionStatus;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly currentNodeId: string | null;
  readonly currentStepId?: string | null;
  readonly nodeExecutionCounter: number;
  readonly lastError: string | null;
  readonly updatedAt: string;
}

export interface RuntimeNodeExecutionSummary {
  readonly sessionId: string;
  readonly nodeExecId: string;
  readonly nodeId: string;
  readonly stepId?: string | null;
  readonly nodeRegistryId?: string | null;
  readonly mailboxInstanceId?: string | null;
  readonly status: string;
  readonly artifactDir: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly attempt: number | null;
  readonly outputAttemptCount: number | null;
  readonly outputValidationErrors:
    | NodeExecutionRecord["outputValidationErrors"]
    | null;
  readonly promptVariant?: string | null;
  readonly timeoutMs?: number | null;
  readonly backendSessionMode: NodeExecutionRecord["backendSessionMode"] | null;
  readonly backendSessionId: NodeExecutionRecord["backendSessionId"] | null;
  readonly restartedFromNodeExecId: string | null;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly inputJson: string;
  readonly outputJson: string;
  readonly createdAt: string;
}

export interface RuntimeNodeLogEntry {
  readonly id: number;
  readonly sessionId: string;
  readonly nodeExecId: string | null;
  readonly nodeId: string | null;
  readonly level: string;
  readonly message: string;
  readonly payloadJson: string | null;
  readonly at: string;
}

export interface RuntimeEventReceiptIndexRecord {
  readonly receiptId: string;
  readonly sourceId: string;
  readonly bindingId: string | null;
  readonly dedupeKey: string;
  readonly status: string;
  readonly workflowName: string | null;
  readonly workflowExecutionId: string | null;
  readonly artifactDir: string;
  readonly error: string | null;
  readonly receivedAt: string;
  readonly updatedAt: string;
}

export interface RuntimeEventReceiptSaveInput {
  readonly receiptId: string;
  readonly sourceId: string;
  readonly bindingId?: string;
  readonly dedupeKey: string;
  readonly status: string;
  readonly workflowName?: string;
  readonly workflowExecutionId?: string;
  readonly artifactDir: string;
  readonly error?: string;
  readonly receivedAt: string;
  readonly updatedAt: string;
}

export type RuntimeEventReplyDispatchStatus =
  | "dispatching"
  | "sent"
  | "queued"
  | "failed";

export interface RuntimeEventReplyDispatchRecord {
  readonly idempotencyKey: string;
  readonly sourceId: string;
  readonly provider: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly eventId: string;
  readonly conversationId: string;
  readonly threadId: string | null;
  readonly actorId: string | null;
  readonly status: RuntimeEventReplyDispatchStatus;
  readonly dispatchId: string | null;
  readonly providerMessageId: string | null;
  readonly requestJson: string;
  readonly responseJson: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RuntimeEventReplyDispatchSaveInput {
  readonly idempotencyKey: string;
  readonly sourceId: string;
  readonly provider: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly eventId: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly actorId?: string;
  readonly status: RuntimeEventReplyDispatchStatus;
  readonly dispatchId?: string;
  readonly providerMessageId?: string;
  readonly requestJson: string;
  readonly responseJson?: string;
  readonly error?: string;
  readonly createdAt?: string;
  readonly updatedAt: string;
}

export interface RuntimeHookEventRecord {
  readonly hookEventId: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly managerSessionId: string | null;
  readonly vendor: string;
  readonly agentSessionId: string;
  readonly rawEventName: string;
  readonly eventName: string;
  readonly cwd: string;
  readonly transcriptPath: string | null;
  readonly model: string | null;
  readonly turnId: string | null;
  readonly payloadHash: string;
  readonly payloadRefJson: string | null;
  readonly responseJson: string | null;
  readonly status: string;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RuntimeHookEventSaveInput {
  readonly hookEventId: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly managerSessionId?: string;
  readonly vendor: string;
  readonly agentSessionId: string;
  readonly rawEventName: string;
  readonly eventName: string;
  readonly cwd: string;
  readonly transcriptPath?: string | null;
  readonly model?: string;
  readonly turnId?: string;
  readonly payloadHash: string;
  readonly payloadRefJson?: string;
  readonly responseJson?: string;
  readonly status: string;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RuntimeNodeLogInput {
  readonly sessionId: string;
  readonly nodeExecId?: string;
  readonly nodeId?: string;
  readonly level: RuntimeNodeLogLevel;
  readonly message: string;
  readonly payload?: unknown;
  readonly at?: string;
}

interface PersistedRuntimeNodeLogRow {
  readonly sessionId: string;
  readonly nodeExecId: string | null;
  readonly nodeId: string | null;
  readonly level: RuntimeNodeLogLevel;
  readonly message: string;
  readonly payloadJson: string | null;
  readonly at: string;
}

export function resolveRuntimeDbPath(options: LoadOptions): string {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const dbPath = env["DIVEDRA_RUNTIME_DB"];
  if (typeof dbPath === "string" && dbPath.length > 0) {
    return path.isAbsolute(dbPath) ? dbPath : path.resolve(cwd, dbPath);
  }
  return path.join(resolveRootDataDir(options), "divedra.db");
}

async function withDatabase<T>(
  options: LoadOptions,
  action: (db: Database) => T,
): Promise<T> {
  const dbPath = resolveRuntimeDbPath(options);
  await mkdir(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    ensureSchema(db);
    return action(db);
  } finally {
    db.close();
  }
}

interface RuntimeSessionRow {
  readonly session_id: string;
  readonly workflow_name: string;
  readonly workflow_id: string;
  readonly status: SessionStatus;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly current_node_id: string | null;
  readonly current_step_id: string | null;
  readonly node_execution_counter: number;
  readonly last_error: string | null;
  readonly updated_at: string;
}

function toRuntimeSessionSummary(
  row: RuntimeSessionRow,
): RuntimeSessionSummary {
  return {
    sessionId: row.session_id,
    workflowName: row.workflow_name,
    workflowId: row.workflow_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    currentNodeId: row.current_node_id,
    ...(row.current_step_id === null
      ? {}
      : { currentStepId: row.current_step_id }),
    nodeExecutionCounter: row.node_execution_counter,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

function ensureSchema(db: Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      workflow_name TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      current_node_id TEXT,
      current_step_id TEXT,
      node_execution_counter INTEGER NOT NULL,
      queue_json TEXT NOT NULL,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS node_executions (
      session_id TEXT NOT NULL,
      node_exec_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      step_id TEXT,
      node_registry_id TEXT,
      mailbox_instance_id TEXT,
      status TEXT NOT NULL,
      artifact_dir TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      attempt INTEGER,
      output_attempt_count INTEGER,
      output_validation_errors_json TEXT,
      prompt_variant TEXT,
      timeout_ms INTEGER,
      backend_session_mode TEXT,
      backend_session_id TEXT,
      restarted_from_node_exec_id TEXT,
      input_hash TEXT NOT NULL,
      output_hash TEXT NOT NULL,
      input_json TEXT NOT NULL,
      output_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (session_id, node_exec_id)
    );
    CREATE TABLE IF NOT EXISTS node_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      node_exec_id TEXT,
      node_id TEXT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT,
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_receipts (
      receipt_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      binding_id TEXT,
      dedupe_key TEXT NOT NULL,
      status TEXT NOT NULL,
      workflow_name TEXT,
      workflow_execution_id TEXT,
      artifact_dir TEXT NOT NULL,
      error TEXT,
      received_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_reply_dispatches (
      idempotency_key TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      workflow_execution_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      node_exec_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      thread_id TEXT,
      actor_id TEXT,
      status TEXT NOT NULL,
      dispatch_id TEXT,
      provider_message_id TEXT,
      request_json TEXT NOT NULL,
      response_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hook_events (
      hook_event_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      workflow_execution_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      node_exec_id TEXT NOT NULL,
      manager_session_id TEXT,
      vendor TEXT NOT NULL,
      agent_session_id TEXT NOT NULL,
      raw_event_name TEXT NOT NULL,
      event_name TEXT NOT NULL,
      cwd TEXT NOT NULL,
      transcript_path TEXT,
      model TEXT,
      turn_id TEXT,
      payload_hash TEXT NOT NULL,
      payload_ref_json TEXT,
      response_json TEXT,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_workflow_name ON sessions (workflow_name);
    CREATE INDEX IF NOT EXISTS idx_node_exec_session ON node_executions (session_id, node_id);
    CREATE INDEX IF NOT EXISTS idx_node_logs_session ON node_logs (session_id, at);
    CREATE INDEX IF NOT EXISTS idx_event_receipts_dedupe ON event_receipts (source_id, binding_id, dedupe_key, received_at);
    CREATE INDEX IF NOT EXISTS idx_event_receipts_status ON event_receipts (status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_event_reply_dispatches_workflow_execution ON event_reply_dispatches (workflow_execution_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_event_reply_dispatches_status ON event_reply_dispatches (status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_hook_events_workflow_execution ON hook_events (workflow_execution_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_hook_events_agent_session ON hook_events (workflow_execution_id, agent_session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_hook_events_manager_session ON hook_events (manager_session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_hook_events_node_exec ON hook_events (node_exec_id, created_at);
  `);

  const nodeExecutionColumns = db
    .query("PRAGMA table_info(node_executions)")
    .all() as Array<{ name: string }>;
  const existingNodeExecutionColumns = new Set(
    nodeExecutionColumns.map((row) => row.name),
  );
  if (!existingNodeExecutionColumns.has("output_attempt_count")) {
    db.exec(
      "ALTER TABLE node_executions ADD COLUMN output_attempt_count INTEGER",
    );
  }
  if (!existingNodeExecutionColumns.has("output_validation_errors_json")) {
    db.exec(
      "ALTER TABLE node_executions ADD COLUMN output_validation_errors_json TEXT",
    );
  }
  if (!existingNodeExecutionColumns.has("backend_session_mode")) {
    db.exec("ALTER TABLE node_executions ADD COLUMN backend_session_mode TEXT");
  }
  if (!existingNodeExecutionColumns.has("backend_session_id")) {
    db.exec("ALTER TABLE node_executions ADD COLUMN backend_session_id TEXT");
  }
  const sessionColumns = db
    .query("PRAGMA table_info(sessions)")
    .all() as Array<{
    name: string;
  }>;
  const existingSessionColumns = new Set(sessionColumns.map((row) => row.name));
  if (!existingSessionColumns.has("current_step_id")) {
    db.exec("ALTER TABLE sessions ADD COLUMN current_step_id TEXT");
  }
  if (!existingNodeExecutionColumns.has("step_id")) {
    db.exec("ALTER TABLE node_executions ADD COLUMN step_id TEXT");
  }
  if (!existingNodeExecutionColumns.has("node_registry_id")) {
    db.exec("ALTER TABLE node_executions ADD COLUMN node_registry_id TEXT");
  }
  if (!existingNodeExecutionColumns.has("mailbox_instance_id")) {
    db.exec("ALTER TABLE node_executions ADD COLUMN mailbox_instance_id TEXT");
  }
  if (!existingNodeExecutionColumns.has("prompt_variant")) {
    db.exec("ALTER TABLE node_executions ADD COLUMN prompt_variant TEXT");
  }
  if (!existingNodeExecutionColumns.has("timeout_ms")) {
    db.exec("ALTER TABLE node_executions ADD COLUMN timeout_ms INTEGER");
  }
}

function toRuntimeEventReceiptIndexRecord(row: {
  readonly receipt_id: string;
  readonly source_id: string;
  readonly binding_id: string | null;
  readonly dedupe_key: string;
  readonly status: string;
  readonly workflow_name: string | null;
  readonly workflow_execution_id: string | null;
  readonly artifact_dir: string;
  readonly error: string | null;
  readonly received_at: string;
  readonly updated_at: string;
}): RuntimeEventReceiptIndexRecord {
  return {
    receiptId: row.receipt_id,
    sourceId: row.source_id,
    bindingId: row.binding_id,
    dedupeKey: row.dedupe_key,
    status: row.status,
    workflowName: row.workflow_name,
    workflowExecutionId: row.workflow_execution_id,
    artifactDir: row.artifact_dir,
    error: row.error,
    receivedAt: row.received_at,
    updatedAt: row.updated_at,
  };
}

function toRuntimeEventReplyDispatchRecord(row: {
  readonly idempotency_key: string;
  readonly source_id: string;
  readonly provider: string;
  readonly workflow_id: string;
  readonly workflow_execution_id: string;
  readonly node_id: string;
  readonly node_exec_id: string;
  readonly event_id: string;
  readonly conversation_id: string;
  readonly thread_id: string | null;
  readonly actor_id: string | null;
  readonly status: RuntimeEventReplyDispatchStatus;
  readonly dispatch_id: string | null;
  readonly provider_message_id: string | null;
  readonly request_json: string;
  readonly response_json: string | null;
  readonly error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}): RuntimeEventReplyDispatchRecord {
  return {
    idempotencyKey: row.idempotency_key,
    sourceId: row.source_id,
    provider: row.provider,
    workflowId: row.workflow_id,
    workflowExecutionId: row.workflow_execution_id,
    nodeId: row.node_id,
    nodeExecId: row.node_exec_id,
    eventId: row.event_id,
    conversationId: row.conversation_id,
    threadId: row.thread_id,
    actorId: row.actor_id,
    status: row.status,
    dispatchId: row.dispatch_id,
    providerMessageId: row.provider_message_id,
    requestJson: row.request_json,
    responseJson: row.response_json,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRuntimeHookEventRecord(row: {
  readonly hook_event_id: string;
  readonly workflow_id: string;
  readonly workflow_execution_id: string;
  readonly node_id: string;
  readonly node_exec_id: string;
  readonly manager_session_id: string | null;
  readonly vendor: string;
  readonly agent_session_id: string;
  readonly raw_event_name: string;
  readonly event_name: string;
  readonly cwd: string;
  readonly transcript_path: string | null;
  readonly model: string | null;
  readonly turn_id: string | null;
  readonly payload_hash: string;
  readonly payload_ref_json: string | null;
  readonly response_json: string | null;
  readonly status: string;
  readonly error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}): RuntimeHookEventRecord {
  return {
    hookEventId: row.hook_event_id,
    workflowId: row.workflow_id,
    workflowExecutionId: row.workflow_execution_id,
    nodeId: row.node_id,
    nodeExecId: row.node_exec_id,
    managerSessionId: row.manager_session_id,
    vendor: row.vendor,
    agentSessionId: row.agent_session_id,
    rawEventName: row.raw_event_name,
    eventName: row.event_name,
    cwd: row.cwd,
    transcriptPath: row.transcript_path,
    model: row.model,
    turnId: row.turn_id,
    payloadHash: row.payload_hash,
    payloadRefJson: row.payload_ref_json,
    responseJson: row.response_json,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function saveHookEventToRuntimeDb(
  row: RuntimeHookEventSaveInput,
  options: LoadOptions = {},
): Promise<void> {
  await withDatabase(options, (db) => {
    const stmt = db.prepare(`
      INSERT INTO hook_events (
        hook_event_id, workflow_id, workflow_execution_id, node_id,
        node_exec_id, manager_session_id, vendor, agent_session_id,
        raw_event_name, event_name, cwd, transcript_path, model, turn_id,
        payload_hash, payload_ref_json, response_json, status, error,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(hook_event_id) DO UPDATE SET
        workflow_id=excluded.workflow_id,
        workflow_execution_id=excluded.workflow_execution_id,
        node_id=excluded.node_id,
        node_exec_id=excluded.node_exec_id,
        manager_session_id=excluded.manager_session_id,
        vendor=excluded.vendor,
        agent_session_id=excluded.agent_session_id,
        raw_event_name=excluded.raw_event_name,
        event_name=excluded.event_name,
        cwd=excluded.cwd,
        transcript_path=excluded.transcript_path,
        model=excluded.model,
        turn_id=excluded.turn_id,
        payload_hash=excluded.payload_hash,
        payload_ref_json=excluded.payload_ref_json,
        response_json=excluded.response_json,
        status=excluded.status,
        error=excluded.error,
        updated_at=excluded.updated_at
    `);
    stmt.run(
      row.hookEventId,
      row.workflowId,
      row.workflowExecutionId,
      row.nodeId,
      row.nodeExecId,
      row.managerSessionId ?? null,
      row.vendor,
      row.agentSessionId,
      row.rawEventName,
      row.eventName,
      row.cwd,
      row.transcriptPath ?? null,
      row.model ?? null,
      row.turnId ?? null,
      row.payloadHash,
      row.payloadRefJson ?? null,
      row.responseJson ?? null,
      row.status,
      row.error ?? null,
      row.createdAt,
      row.updatedAt,
    );
  });
}

export async function listRuntimeHookEvents(
  workflowExecutionId: string,
  options: LoadOptions = {},
): Promise<readonly RuntimeHookEventRecord[]> {
  return withDatabase(options, (db) => {
    const rows = db
      .query(
        `SELECT
          hook_event_id, workflow_id, workflow_execution_id, node_id,
          node_exec_id, manager_session_id, vendor, agent_session_id,
          raw_event_name, event_name, cwd, transcript_path, model, turn_id,
          payload_hash, payload_ref_json, response_json, status, error,
          created_at, updated_at
         FROM hook_events
         WHERE workflow_execution_id = ?
         ORDER BY created_at ASC`,
      )
      .all(workflowExecutionId) as Parameters<
      typeof toRuntimeHookEventRecord
    >[0][];
    return rows.map(toRuntimeHookEventRecord);
  });
}

export async function saveEventReceiptToRuntimeDb(
  row: RuntimeEventReceiptSaveInput,
  options: LoadOptions = {},
): Promise<void> {
  await withDatabase(options, (db) => {
    const stmt = db.prepare(`
      INSERT INTO event_receipts (
        receipt_id, source_id, binding_id, dedupe_key, status, workflow_name,
        workflow_execution_id, artifact_dir, error, received_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(receipt_id) DO UPDATE SET
        source_id=excluded.source_id,
        binding_id=excluded.binding_id,
        dedupe_key=excluded.dedupe_key,
        status=excluded.status,
        workflow_name=excluded.workflow_name,
        workflow_execution_id=excluded.workflow_execution_id,
        artifact_dir=excluded.artifact_dir,
        error=excluded.error,
        received_at=excluded.received_at,
        updated_at=excluded.updated_at
    `);
    stmt.run(
      row.receiptId,
      row.sourceId,
      row.bindingId ?? null,
      row.dedupeKey,
      row.status,
      row.workflowName ?? null,
      row.workflowExecutionId ?? null,
      row.artifactDir,
      row.error ?? null,
      row.receivedAt,
      row.updatedAt,
    );
  });
}

export async function findEventReceiptByDedupeKey(
  input: {
    readonly sourceId: string;
    readonly bindingId?: string;
    readonly dedupeKey: string;
    readonly since?: string;
  },
  options: LoadOptions = {},
): Promise<RuntimeEventReceiptIndexRecord | null> {
  return withDatabase(options, (db) => {
    const row = db
      .query(
        `SELECT
          receipt_id, source_id, binding_id, dedupe_key, status, workflow_name,
          workflow_execution_id, artifact_dir, error, received_at, updated_at
         FROM event_receipts
         WHERE source_id = ?
           AND binding_id IS ?
           AND dedupe_key = ?
           AND (? IS NULL OR received_at >= ?)
         ORDER BY received_at DESC
         LIMIT 1`,
      )
      .get(
        input.sourceId,
        input.bindingId ?? null,
        input.dedupeKey,
        input.since ?? null,
        input.since ?? null,
      ) as Parameters<typeof toRuntimeEventReceiptIndexRecord>[0] | null;
    return row === null ? null : toRuntimeEventReceiptIndexRecord(row);
  });
}

export async function loadEventReceiptFromRuntimeDb(
  receiptId: string,
  options: LoadOptions = {},
): Promise<RuntimeEventReceiptIndexRecord | null> {
  return withDatabase(options, (db) => {
    const row = db
      .query(
        `SELECT
          receipt_id, source_id, binding_id, dedupe_key, status, workflow_name,
          workflow_execution_id, artifact_dir, error, received_at, updated_at
         FROM event_receipts
         WHERE receipt_id = ?
         LIMIT 1`,
      )
      .get(receiptId) as
      | Parameters<typeof toRuntimeEventReceiptIndexRecord>[0]
      | null;
    return row === null ? null : toRuntimeEventReceiptIndexRecord(row);
  });
}

export async function listEventReceiptsFromRuntimeDb(
  input: {
    readonly sourceId?: string;
    readonly status?: string;
    readonly limit?: number;
  } = {},
  options: LoadOptions = {},
): Promise<readonly RuntimeEventReceiptIndexRecord[]> {
  return withDatabase(options, (db) => {
    const rows = db
      .query(
        `SELECT
          receipt_id, source_id, binding_id, dedupe_key, status, workflow_name,
          workflow_execution_id, artifact_dir, error, received_at, updated_at
         FROM event_receipts
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
        input.limit ?? 100,
      ) as Parameters<typeof toRuntimeEventReceiptIndexRecord>[0][];
    return rows.map(toRuntimeEventReceiptIndexRecord);
  });
}

export async function saveEventReplyDispatchToRuntimeDb(
  row: RuntimeEventReplyDispatchSaveInput,
  options: LoadOptions = {},
): Promise<void> {
  await withDatabase(options, (db) => {
    const existing = db
      .query(
        "SELECT created_at FROM event_reply_dispatches WHERE idempotency_key = ? LIMIT 1",
      )
      .get(row.idempotencyKey) as { readonly created_at: string } | null;
    const createdAt = row.createdAt ?? existing?.created_at ?? row.updatedAt;
    const stmt = db.prepare(`
      INSERT INTO event_reply_dispatches (
        idempotency_key, source_id, provider, workflow_id,
        workflow_execution_id, node_id, node_exec_id, event_id,
        conversation_id, thread_id, actor_id, status, dispatch_id,
        provider_message_id, request_json, response_json, error,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET
        source_id=excluded.source_id,
        provider=excluded.provider,
        workflow_id=excluded.workflow_id,
        workflow_execution_id=excluded.workflow_execution_id,
        node_id=excluded.node_id,
        node_exec_id=excluded.node_exec_id,
        event_id=excluded.event_id,
        conversation_id=excluded.conversation_id,
        thread_id=excluded.thread_id,
        actor_id=excluded.actor_id,
        status=excluded.status,
        dispatch_id=excluded.dispatch_id,
        provider_message_id=excluded.provider_message_id,
        request_json=excluded.request_json,
        response_json=excluded.response_json,
        error=excluded.error,
        updated_at=excluded.updated_at
    `);
    stmt.run(
      row.idempotencyKey,
      row.sourceId,
      row.provider,
      row.workflowId,
      row.workflowExecutionId,
      row.nodeId,
      row.nodeExecId,
      row.eventId,
      row.conversationId,
      row.threadId ?? null,
      row.actorId ?? null,
      row.status,
      row.dispatchId ?? null,
      row.providerMessageId ?? null,
      row.requestJson,
      row.responseJson ?? null,
      row.error ?? null,
      createdAt,
      row.updatedAt,
    );
  });
}

export async function loadEventReplyDispatchByIdempotencyKey(
  idempotencyKey: string,
  options: LoadOptions = {},
): Promise<RuntimeEventReplyDispatchRecord | null> {
  return withDatabase(options, (db) => {
    const row = db
      .query(
        `SELECT
          idempotency_key, source_id, provider, workflow_id,
          workflow_execution_id, node_id, node_exec_id, event_id,
          conversation_id, thread_id, actor_id, status, dispatch_id,
          provider_message_id, request_json, response_json, error,
          created_at, updated_at
         FROM event_reply_dispatches
         WHERE idempotency_key = ?
         LIMIT 1`,
      )
      .get(idempotencyKey) as
      | Parameters<typeof toRuntimeEventReplyDispatchRecord>[0]
      | null;
    return row === null ? null : toRuntimeEventReplyDispatchRecord(row);
  });
}

export async function listEventReplyDispatchesFromRuntimeDb(
  input: {
    readonly workflowExecutionId?: string;
    readonly status?: RuntimeEventReplyDispatchStatus;
    readonly limit?: number;
  } = {},
  options: LoadOptions = {},
): Promise<readonly RuntimeEventReplyDispatchRecord[]> {
  return withDatabase(options, (db) => {
    const rows = db
      .query(
        `SELECT
          idempotency_key, source_id, provider, workflow_id,
          workflow_execution_id, node_id, node_exec_id, event_id,
          conversation_id, thread_id, actor_id, status, dispatch_id,
          provider_message_id, request_json, response_json, error,
          created_at, updated_at
         FROM event_reply_dispatches
         WHERE (? IS NULL OR workflow_execution_id = ?)
           AND (? IS NULL OR status = ?)
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(
        input.workflowExecutionId ?? null,
        input.workflowExecutionId ?? null,
        input.status ?? null,
        input.status ?? null,
        input.limit ?? 100,
      ) as Parameters<typeof toRuntimeEventReplyDispatchRecord>[0][];
    return rows.map(toRuntimeEventReplyDispatchRecord);
  });
}

function insertNodeLog(db: Database, row: PersistedRuntimeNodeLogRow): void {
  const stmt = db.prepare(`
    INSERT INTO node_logs (session_id, node_exec_id, node_id, level, message, payload_json, at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    row.sessionId,
    row.nodeExecId,
    row.nodeId,
    row.level,
    row.message,
    row.payloadJson,
    row.at,
  );
}

function toNodeLogRow(row: RuntimeNodeLogInput): PersistedRuntimeNodeLogRow {
  return {
    sessionId: row.sessionId,
    nodeExecId: row.nodeExecId ?? null,
    nodeId: row.nodeId ?? null,
    level: row.level,
    message: row.message,
    payloadJson: row.payload === undefined ? null : JSON.stringify(row.payload),
    at: row.at ?? new Date().toISOString(),
  };
}

export async function saveSessionSnapshotToRuntimeDb(
  session: WorkflowSessionState,
  options: LoadOptions = {},
): Promise<void> {
  await withDatabase(options, (db) => {
    const stmt = db.prepare(`
      INSERT INTO sessions (
        session_id, workflow_name, workflow_id, status, started_at, ended_at,
        current_node_id, current_step_id, node_execution_counter, queue_json, last_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        workflow_name=excluded.workflow_name,
        workflow_id=excluded.workflow_id,
        status=excluded.status,
        started_at=excluded.started_at,
        ended_at=excluded.ended_at,
        current_node_id=excluded.current_node_id,
        current_step_id=excluded.current_step_id,
        node_execution_counter=excluded.node_execution_counter,
        queue_json=excluded.queue_json,
        last_error=excluded.last_error,
        updated_at=excluded.updated_at
    `);
    const updatedAt = new Date().toISOString();
    const currentStepId = resolveCurrentStepId(session);
    stmt.run(
      session.sessionId,
      session.workflowName,
      session.workflowId,
      session.status,
      session.startedAt,
      session.endedAt ?? null,
      session.currentNodeId ?? null,
      currentStepId,
      session.nodeExecutionCounter,
      JSON.stringify(session.queue),
      session.lastError ?? null,
      updatedAt,
    );
  });
}

export async function saveNodeExecutionToRuntimeDb(
  row: RuntimeNodeExecutionRow,
  options: LoadOptions = {},
): Promise<void> {
  await withDatabase(options, (db) => {
    const now = new Date().toISOString();
    const nodeStmt = db.prepare(`
      INSERT OR REPLACE INTO node_executions (
        session_id, node_exec_id, node_id, step_id, node_registry_id, mailbox_instance_id, status, artifact_dir, started_at, ended_at,
        attempt, output_attempt_count, output_validation_errors_json, prompt_variant, timeout_ms, backend_session_mode, backend_session_id,
        restarted_from_node_exec_id,
        input_hash, output_hash, input_json, output_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    nodeStmt.run(
      row.sessionId,
      row.nodeExecId,
      row.nodeId,
      row.stepId ?? null,
      row.nodeRegistryId ?? null,
      row.mailboxInstanceId ?? null,
      row.status,
      row.artifactDir,
      row.startedAt,
      row.endedAt,
      row.attempt ?? null,
      row.outputAttemptCount ?? null,
      row.outputValidationErrors === undefined
        ? null
        : JSON.stringify(row.outputValidationErrors),
      row.promptVariant ?? null,
      row.timeoutMs ?? null,
      row.backendSessionMode ?? null,
      row.backendSessionId ?? null,
      row.restartedFromNodeExecId ?? null,
      row.inputHash,
      row.outputHash,
      row.inputJson,
      row.outputJson,
      now,
    );

    insertNodeLog(
      db,
      toNodeLogRow({
        sessionId: row.sessionId,
        nodeExecId: row.nodeExecId,
        nodeId: row.nodeId,
        level: row.status === "succeeded" ? "info" : "warning",
        message: `node ${row.nodeId} finished with status ${row.status}`,
        payload: {
          inputHash: row.inputHash,
          outputHash: row.outputHash,
          artifactDir: row.artifactDir,
        },
        at: row.endedAt,
      }),
    );
  });
}

function summarizeProcessLogText(text: string): string {
  const trimmed = text.trimEnd();
  if (trimmed.length <= PROCESS_LOG_MESSAGE_TEXT_LIMIT) {
    return trimmed;
  }
  const omittedCount = trimmed.length - PROCESS_LOG_MESSAGE_TEXT_LIMIT;
  return `${trimmed.slice(
    0,
    PROCESS_LOG_MESSAGE_TEXT_LIMIT,
  )}... [truncated ${String(omittedCount)} chars]`;
}

function formatProcessLogMessage(input: {
  readonly nodeId: string;
  readonly log: AdapterProcessLog;
}): string {
  const label =
    input.log.label === undefined || input.log.label.length === 0
      ? ""
      : `${input.log.label} `;
  return `node ${input.nodeId} ${label}${input.log.stream}: ${summarizeProcessLogText(input.log.text)}`;
}

export async function saveProcessLogsToRuntimeDb(
  input: {
    readonly sessionId: string;
    readonly nodeId: string;
    readonly nodeExecId: string;
    readonly processLogs: readonly AdapterProcessLog[];
    readonly at: string;
  },
  options: LoadOptions = {},
): Promise<void> {
  if (input.processLogs.length === 0) {
    return;
  }
  await withDatabase(options, (db) => {
    const insertLogs = db.transaction((logs: readonly AdapterProcessLog[]) => {
      for (const log of logs) {
        insertNodeLog(
          db,
          toNodeLogRow({
            sessionId: input.sessionId,
            nodeId: input.nodeId,
            nodeExecId: input.nodeExecId,
            level: log.stream === "stderr" ? "warning" : "info",
            message: formatProcessLogMessage({ nodeId: input.nodeId, log }),
            payload: {
              stream: log.stream,
              text: log.text,
              ...(log.label === undefined ? {} : { label: log.label }),
            },
            at: input.at,
          }),
        );
      }
    });
    insertLogs(input.processLogs);
  });
}

function formatCommunicationEventMessage(
  communication: CommunicationRecord,
): string {
  return [
    `transition ${communication.fromNodeId} -> ${communication.toNodeId}`,
    `when ${communication.transitionWhen}`,
    `communication ${communication.communicationId}`,
    `status ${communication.status}`,
    `as ${communication.deliveryKind}`,
  ].join(" ");
}

export async function saveCommunicationEventToRuntimeDb(
  communication: CommunicationRecord,
  options: LoadOptions = {},
): Promise<void> {
  await withDatabase(options, (db) => {
    insertNodeLog(
      db,
      toNodeLogRow({
        sessionId: communication.workflowExecutionId,
        nodeId: communication.fromNodeId,
        nodeExecId: communication.sourceNodeExecId,
        level: communication.status === "delivery_failed" ? "warning" : "info",
        message: formatCommunicationEventMessage(communication),
        payload: {
          eventType: "communication",
          workflowId: communication.workflowId,
          workflowExecutionId: communication.workflowExecutionId,
          communicationId: communication.communicationId,
          fromNodeId: communication.fromNodeId,
          toNodeId: communication.toNodeId,
          ...(communication.fromSubWorkflowId === undefined
            ? {}
            : { fromSubWorkflowId: communication.fromSubWorkflowId }),
          ...(communication.toSubWorkflowId === undefined
            ? {}
            : { toSubWorkflowId: communication.toSubWorkflowId }),
          routingScope: communication.routingScope,
          deliveryKind: communication.deliveryKind,
          transitionWhen: communication.transitionWhen,
          sourceNodeExecId: communication.sourceNodeExecId,
          status: communication.status,
          artifactDir: communication.artifactDir,
          createdAt: communication.createdAt,
          ...(communication.deliveredAt === undefined
            ? {}
            : { deliveredAt: communication.deliveredAt }),
        },
        at: communication.deliveredAt ?? communication.createdAt,
      }),
    );
  });
}

export async function listRuntimeSessions(
  options: LoadOptions = {},
): Promise<readonly RuntimeSessionSummary[]> {
  return withDatabase(options, (db) => {
    const rows = db
      .query(
        `SELECT
          session_id,
          workflow_name,
          workflow_id,
          status,
          started_at,
          ended_at,
          current_node_id,
          current_step_id,
          node_execution_counter,
          last_error,
          updated_at
         FROM sessions
         ORDER BY updated_at DESC`,
      )
      .all() as RuntimeSessionRow[];

    return rows.map(toRuntimeSessionSummary);
  });
}

export async function loadRuntimeSessionSummary(
  sessionId: string,
  options: LoadOptions = {},
): Promise<RuntimeSessionSummary | null> {
  return withDatabase(options, (db) => {
    const row = db
      .query(
        `SELECT
          session_id,
          workflow_name,
          workflow_id,
          status,
          started_at,
          ended_at,
          current_node_id,
          current_step_id,
          node_execution_counter,
          last_error,
          updated_at
         FROM sessions
         WHERE session_id = ?`,
      )
      .get(sessionId) as RuntimeSessionRow | null;

    return row === null ? null : toRuntimeSessionSummary(row);
  });
}

export async function listRuntimeNodeExecutions(
  sessionId: string,
  options: LoadOptions = {},
): Promise<readonly RuntimeNodeExecutionSummary[]> {
  return withDatabase(options, (db) => {
    const rows = db
      .query(
        `SELECT
          session_id,
          node_exec_id,
          node_id,
          step_id,
          node_registry_id,
          mailbox_instance_id,
          status,
          artifact_dir,
          started_at,
          ended_at,
          attempt,
          output_attempt_count,
          output_validation_errors_json,
          prompt_variant,
          timeout_ms,
          backend_session_mode,
          backend_session_id,
          restarted_from_node_exec_id,
          input_hash,
          output_hash,
          input_json,
          output_json,
          created_at
         FROM node_executions
         WHERE session_id = ?
         ORDER BY created_at ASC`,
      )
      .all(sessionId) as Array<{
      session_id: string;
      node_exec_id: string;
      node_id: string;
      step_id: string | null;
      node_registry_id: string | null;
      mailbox_instance_id: string | null;
      status: string;
      artifact_dir: string;
      started_at: string;
      ended_at: string;
      attempt: number | null;
      output_attempt_count: number | null;
      output_validation_errors_json: string | null;
      prompt_variant: string | null;
      timeout_ms: number | null;
      backend_session_mode: NodeExecutionRecord["backendSessionMode"] | null;
      backend_session_id: NodeExecutionRecord["backendSessionId"] | null;
      restarted_from_node_exec_id: string | null;
      input_hash: string;
      output_hash: string;
      input_json: string;
      output_json: string;
      created_at: string;
    }>;

    return rows.map((row) => ({
      sessionId: row.session_id,
      nodeExecId: row.node_exec_id,
      nodeId: row.node_id,
      stepId: row.step_id,
      nodeRegistryId: row.node_registry_id,
      mailboxInstanceId: row.mailbox_instance_id,
      status: row.status,
      artifactDir: row.artifact_dir,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      attempt: row.attempt,
      outputAttemptCount: row.output_attempt_count,
      outputValidationErrors:
        row.output_validation_errors_json === null
          ? null
          : (JSON.parse(
              row.output_validation_errors_json,
            ) as NodeExecutionRecord["outputValidationErrors"]),
      promptVariant: row.prompt_variant,
      timeoutMs: row.timeout_ms,
      backendSessionMode: row.backend_session_mode,
      backendSessionId: row.backend_session_id,
      restartedFromNodeExecId: row.restarted_from_node_exec_id,
      inputHash: row.input_hash,
      outputHash: row.output_hash,
      inputJson: row.input_json,
      outputJson: row.output_json,
      createdAt: row.created_at,
    }));
  });
}

export async function listRuntimeNodeLogs(
  sessionId: string,
  options: LoadOptions = {},
): Promise<readonly RuntimeNodeLogEntry[]> {
  return withDatabase(options, (db) => {
    const rows = db
      .query(
        `SELECT
          id,
          session_id,
          node_exec_id,
          node_id,
          level,
          message,
          payload_json,
          at
         FROM node_logs
         WHERE session_id = ?
         ORDER BY id ASC`,
      )
      .all(sessionId) as Array<{
      id: number;
      session_id: string;
      node_exec_id: string | null;
      node_id: string | null;
      level: string;
      message: string;
      payload_json: string | null;
      at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      nodeExecId: row.node_exec_id,
      nodeId: row.node_id,
      level: row.level,
      message: row.message,
      payloadJson: row.payload_json,
      at: row.at,
    }));
  });
}

export async function deleteRuntimeSession(
  sessionId: string,
  options: LoadOptions = {},
): Promise<void> {
  await withDatabase(options, (db) => {
    const runDelete = db.transaction((targetSessionId: string) => {
      db.prepare("DELETE FROM node_logs WHERE session_id = ?").run(
        targetSessionId,
      );
      db.prepare("DELETE FROM node_executions WHERE session_id = ?").run(
        targetSessionId,
      );
      db.prepare("DELETE FROM sessions WHERE session_id = ?").run(
        targetSessionId,
      );
    });
    runDelete(sessionId);
  });
}
