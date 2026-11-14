import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { AdapterLlmSessionMessage } from "../adapter";
import { resolveRootDataDir } from "../paths";
import type { NodeExecutionRecord, SessionStatus } from "../session";
import type { LoadOptions } from "../types";

export type RuntimeNodeLogLevel = "info" | "warning" | "error";
export const PROCESS_LOG_MESSAGE_TEXT_LIMIT = 500;
export interface RuntimeNodeExecutionRow {
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
  readonly executionOrdinal: number;
  readonly inputJson: string;
  readonly outputJson: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly llmMessages?: readonly AdapterLlmSessionMessage[];
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
  readonly executionOrdinal: number | null;
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
export interface RuntimeLlmSessionMessageRecord {
  readonly id: number;
  readonly sessionId: string;
  readonly nodeExecId: string;
  readonly nodeId: string;
  readonly provider: string;
  readonly model: string;
  readonly backendSessionId: string | null;
  readonly ordinal: number;
  readonly role: string | null;
  readonly eventType: string;
  readonly contentText: string | null;
  readonly rawMessageJson: string | null;
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
  readonly supervisedRunId: string | null;
  readonly supervisorExecutionId: string | null;
  readonly supervisorConversationId: string | null;
  readonly supervisorDecisionId: string | null;
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
  readonly supervisedRunId?: string;
  readonly supervisorExecutionId?: string;
  readonly supervisorConversationId?: string;
  readonly supervisorDecisionId?: string;
  readonly artifactDir: string;
  readonly error?: string;
  readonly receivedAt: string;
  readonly updatedAt: string;
}
export type RuntimeEventReplyDispatchStatus =
  | "dispatching"
  | "sent"
  | "queued"
  | "failed"
  | "no_delivery_target";
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
export interface RuntimeNodeLogInput {
  readonly sessionId: string;
  readonly nodeExecId?: string;
  readonly nodeId?: string;
  readonly level: RuntimeNodeLogLevel;
  readonly message: string;
  readonly payload?: unknown;
  readonly at?: string;
}
export interface PersistedRuntimeNodeLogRow {
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
export async function withDatabase<T>(
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
export interface RuntimeSessionRow {
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
export function backfillMissingNodeExecutionOrdinals(db: Database): void {
  const targets = db
    .query(
      `SELECT DISTINCT session_id AS sessionId
       FROM node_executions
       WHERE execution_ordinal IS NULL`,
    )
    .all() as readonly { sessionId: string }[];
  if (targets.length === 0) {
    return;
  }
  const selectRows = db.prepare(
    `SELECT node_exec_id AS nodeExecId
     FROM node_executions
     WHERE session_id = ?
     ORDER BY created_at ASC, node_exec_id ASC`,
  );
  const updateOrdinal = db.prepare(
    `UPDATE node_executions SET execution_ordinal = ?
     WHERE session_id = ? AND node_exec_id = ?`,
  );
  for (const row of targets) {
    const execRows = selectRows.all(row.sessionId) as readonly {
      readonly nodeExecId: string;
    }[];
    let ordinal = 1;
    for (const execution of execRows) {
      updateOrdinal.run(ordinal++, row.sessionId, execution.nodeExecId);
    }
  }
}
export function toRuntimeSessionSummary(
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
export function ensureSchema(db: Database): void {
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
      execution_ordinal INTEGER,
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
    CREATE TABLE IF NOT EXISTS llm_session_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      node_exec_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      backend_session_id TEXT,
      ordinal INTEGER NOT NULL,
      role TEXT,
      event_type TEXT NOT NULL,
      content_text TEXT,
      raw_message_json TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_llm_session_messages_session ON llm_session_messages (session_id, node_exec_id, ordinal);
    CREATE INDEX IF NOT EXISTS idx_event_receipts_dedupe ON event_receipts (source_id, binding_id, dedupe_key, received_at);
    CREATE INDEX IF NOT EXISTS idx_event_receipts_status ON event_receipts (status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_event_reply_dispatches_workflow_execution ON event_reply_dispatches (workflow_execution_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_event_reply_dispatches_status ON event_reply_dispatches (status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_hook_events_workflow_execution ON hook_events (workflow_execution_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_hook_events_agent_session ON hook_events (workflow_execution_id, agent_session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_hook_events_manager_session ON hook_events (manager_session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_hook_events_node_exec ON hook_events (node_exec_id, created_at);
    CREATE TABLE IF NOT EXISTS event_supervised_runs (
      supervised_run_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      binding_id TEXT NOT NULL,
      correlation_key TEXT NOT NULL,
      supervisor_workflow_name TEXT NOT NULL,
      supervisor_execution_id TEXT,
      target_workflow_name TEXT NOT NULL,
      active_target_execution_id TEXT,
      status TEXT NOT NULL,
      restart_count INTEGER NOT NULL,
      max_restarts_on_failure INTEGER NOT NULL,
      auto_improve_enabled INTEGER NOT NULL,
      artifact_dir TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_supervisor_commands (
      command_id TEXT PRIMARY KEY,
      supervised_run_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      binding_id TEXT NOT NULL,
      correlation_key TEXT NOT NULL,
      action TEXT NOT NULL,
      args_json TEXT,
      receipt_id TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_event_supervised_runs_correlation
      ON event_supervised_runs (source_id, binding_id, correlation_key, updated_at);
    CREATE INDEX IF NOT EXISTS idx_event_supervised_runs_active_target
      ON event_supervised_runs (active_target_execution_id);
    CREATE INDEX IF NOT EXISTS idx_event_supervisor_commands_run
      ON event_supervisor_commands (supervised_run_id, created_at);
    CREATE TABLE IF NOT EXISTS supervisor_conversations (
      supervisor_conversation_id TEXT PRIMARY KEY,
      supervisor_profile_id TEXT NOT NULL,
      profile_revision TEXT NOT NULL,
      supervisor_workflow_name TEXT NOT NULL,
      supervisor_execution_id TEXT,
      source_id TEXT NOT NULL,
      binding_id TEXT,
      correlation_key TEXT NOT NULL,
      conversation_revision INTEGER NOT NULL,
      selected_managed_run_id TEXT,
      selected_managed_run_ids_by_workflow_key_json TEXT,
      status TEXT NOT NULL,
      artifact_dir TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS supervisor_conversation_managed_runs (
      managed_run_id TEXT PRIMARY KEY,
      supervisor_conversation_id TEXT NOT NULL,
      managed_workflow_key TEXT NOT NULL,
      target_workflow_name TEXT NOT NULL,
      run_alias TEXT,
      active_target_execution_id TEXT,
      status TEXT NOT NULL,
      restart_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS supervisor_dispatch_decisions (
      decision_id TEXT PRIMARY KEY,
      supervisor_conversation_id TEXT NOT NULL,
      source_message_id TEXT NOT NULL,
      profile_revision TEXT NOT NULL,
      conversation_revision INTEGER NOT NULL,
      status TEXT NOT NULL,
      proposal_json TEXT NOT NULL,
      result_summary_json TEXT,
      receipt_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_supervisor_conversations_correlation
      ON supervisor_conversations (source_id, binding_id, correlation_key, updated_at);
    CREATE INDEX IF NOT EXISTS idx_supervisor_managed_runs_conversation
      ON supervisor_conversation_managed_runs (supervisor_conversation_id, updated_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supervisor_dispatch_decisions_dedupe
      ON supervisor_dispatch_decisions (supervisor_conversation_id, source_message_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supervisor_conversations_active_correlation
      ON supervisor_conversations (source_id, correlation_key, ifnull(binding_id, ''))
      WHERE status IN ('active', 'idle');
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supervisor_managed_runs_alias_scope
      ON supervisor_conversation_managed_runs (
        supervisor_conversation_id,
        managed_workflow_key,
        run_alias
      )
      WHERE run_alias IS NOT NULL;
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
  if (!existingNodeExecutionColumns.has("execution_ordinal")) {
    db.exec("ALTER TABLE node_executions ADD COLUMN execution_ordinal INTEGER");
  }
  const sessionColumnsFinal = db
    .query("PRAGMA table_info(sessions)")
    .all() as Array<{ name: string }>;
  const sessionColumnSet = new Set(sessionColumnsFinal.map((row) => row.name));
  if (!sessionColumnSet.has("supervision_json")) {
    db.exec("ALTER TABLE sessions ADD COLUMN supervision_json TEXT");
  }
  const sessionContinuationColumns = db
    .query("PRAGMA table_info(sessions)")
    .all() as Array<{ name: string }>;
  const sessionContinuationColumnSet = new Set(
    sessionContinuationColumns.map((column) => column.name),
  );
  if (!sessionContinuationColumnSet.has("continuation_mode")) {
    db.exec("ALTER TABLE sessions ADD COLUMN continuation_mode TEXT");
  }
  if (
    !sessionContinuationColumnSet.has("continued_from_workflow_execution_id")
  ) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN continued_from_workflow_execution_id TEXT",
    );
  }
  if (!sessionContinuationColumnSet.has("continued_after_step_run_id")) {
    db.exec("ALTER TABLE sessions ADD COLUMN continued_after_step_run_id TEXT");
  }
  if (!sessionContinuationColumnSet.has("continued_after_execution_ordinal")) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN continued_after_execution_ordinal INTEGER",
    );
  }
  if (!sessionContinuationColumnSet.has("continued_start_step_id")) {
    db.exec("ALTER TABLE sessions ADD COLUMN continued_start_step_id TEXT");
  }
  if (!sessionContinuationColumnSet.has("history_imports_json")) {
    db.exec("ALTER TABLE sessions ADD COLUMN history_imports_json TEXT");
  }
  const receiptColumns = db
    .query("PRAGMA table_info(event_receipts)")
    .all() as Array<{ name: string }>;
  const receiptColumnSet = new Set(receiptColumns.map((row) => row.name));
  if (!receiptColumnSet.has("supervised_run_id")) {
    db.exec("ALTER TABLE event_receipts ADD COLUMN supervised_run_id TEXT");
  }
  if (!receiptColumnSet.has("supervisor_execution_id")) {
    db.exec(
      "ALTER TABLE event_receipts ADD COLUMN supervisor_execution_id TEXT",
    );
  }
  if (!receiptColumnSet.has("supervisor_conversation_id")) {
    db.exec(
      "ALTER TABLE event_receipts ADD COLUMN supervisor_conversation_id TEXT",
    );
  }
  if (!receiptColumnSet.has("supervisor_decision_id")) {
    db.exec(
      "ALTER TABLE event_receipts ADD COLUMN supervisor_decision_id TEXT",
    );
  }
  const supervisorCommandColumns = db
    .query("PRAGMA table_info(event_supervisor_commands)")
    .all() as Array<{ name: string }>;
  const supervisorCommandColumnSet = new Set(
    supervisorCommandColumns.map((row) => row.name),
  );
  if (!supervisorCommandColumnSet.has("args_json")) {
    db.exec("ALTER TABLE event_supervisor_commands ADD COLUMN args_json TEXT");
  }

  backfillMissingNodeExecutionOrdinals(db);
}
export function toRuntimeEventReceiptIndexRecord(row: {
  readonly receipt_id: string;
  readonly source_id: string;
  readonly binding_id: string | null;
  readonly dedupe_key: string;
  readonly status: string;
  readonly workflow_name: string | null;
  readonly workflow_execution_id: string | null;
  readonly supervised_run_id?: string | null;
  readonly supervisor_execution_id?: string | null;
  readonly supervisor_conversation_id?: string | null;
  readonly supervisor_decision_id?: string | null;
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
    supervisedRunId: row.supervised_run_id ?? null,
    supervisorExecutionId: row.supervisor_execution_id ?? null,
    supervisorConversationId: row.supervisor_conversation_id ?? null,
    supervisorDecisionId: row.supervisor_decision_id ?? null,
    artifactDir: row.artifact_dir,
    error: row.error,
    receivedAt: row.received_at,
    updatedAt: row.updated_at,
  };
}
