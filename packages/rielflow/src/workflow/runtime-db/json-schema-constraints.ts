import type { Database } from "bun:sqlite";

type RuntimeJsonNullability = "required" | "nullable";

interface RuntimeJsonColumnPolicy {
  readonly columnName: string;
  readonly nullability: RuntimeJsonNullability;
}

export function requiredJsonTextColumn(columnName: string): string {
  return `${columnName} TEXT NOT NULL CHECK (json_valid(${columnName}))`;
}

export function nullableJsonTextColumn(columnName: string): string {
  return `${columnName} TEXT CHECK (${columnName} IS NULL OR json_valid(${columnName}))`;
}

function tableSql(db: Database, tableName: string): string | null {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { readonly sql: string | null } | null;
  return row?.sql ?? null;
}

function hasJsonChecks(
  db: Database,
  tableName: string,
  policies: readonly RuntimeJsonColumnPolicy[],
): boolean {
  const sql = tableSql(db, tableName);
  if (sql === null) {
    return false;
  }
  return policies.every((policy) => {
    const check =
      policy.nullability === "required"
        ? `CHECK (json_valid(${policy.columnName}))`
        : `CHECK (${policy.columnName} IS NULL OR json_valid(${policy.columnName}))`;
    return sql.includes(check);
  });
}

function rebuildTableWithJsonChecks(input: {
  readonly db: Database;
  readonly tableName: string;
  readonly createSql: string;
  readonly columns: readonly string[];
  readonly policies: readonly RuntimeJsonColumnPolicy[];
}): void {
  if (hasJsonChecks(input.db, input.tableName, input.policies)) {
    return;
  }
  const tempTableName = `${input.tableName}_json_checks_new`;
  const columnsSql = input.columns.join(", ");
  const rebuild = input.db.transaction(() => {
    input.db.exec(`DROP TABLE IF EXISTS ${tempTableName};`);
    input.db.exec(input.createSql.replace(input.tableName, tempTableName));
    input.db
      .prepare(
        `
          INSERT INTO ${tempTableName} (${columnsSql})
          SELECT ${columnsSql}
          FROM ${input.tableName}
        `,
      )
      .run();
    input.db.exec(`DROP TABLE ${input.tableName};`);
    input.db.exec(`ALTER TABLE ${tempTableName} RENAME TO ${input.tableName};`);
  });
  rebuild();
}

function ensureBaseRuntimeIndexes(db: Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_workflow_name ON sessions (workflow_name);
    CREATE INDEX IF NOT EXISTS idx_node_exec_session ON node_executions (session_id, node_id);
    CREATE INDEX IF NOT EXISTS idx_node_logs_session ON node_logs (session_id, at);
    CREATE INDEX IF NOT EXISTS idx_llm_session_messages_session ON llm_session_messages (session_id, node_exec_id, ordinal);
    CREATE INDEX IF NOT EXISTS idx_workflow_messages_created ON workflow_messages (workflow_execution_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_messages_created_order ON workflow_messages (workflow_execution_id, created_at, communication_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_messages_inbound ON workflow_messages (workflow_execution_id, to_node_id, status);
    CREATE INDEX IF NOT EXISTS idx_workflow_messages_inbound_created ON workflow_messages (workflow_execution_id, to_node_id, created_at, communication_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_messages_outbound ON workflow_messages (workflow_execution_id, from_node_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_messages_outbound_created_order ON workflow_messages (workflow_execution_id, from_node_id, created_at, communication_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_messages_source_exec ON workflow_messages (source_node_exec_id, created_at);
  `);
}

function ensureEventRuntimeIndexes(db: Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_event_receipts_dedupe ON event_receipts (source_id, binding_id, dedupe_key, received_at);
    CREATE INDEX IF NOT EXISTS idx_event_receipts_status ON event_receipts (status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_event_reply_dispatches_workflow_execution ON event_reply_dispatches (workflow_execution_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_event_reply_dispatches_status ON event_reply_dispatches (status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_hook_events_workflow_execution ON hook_events (workflow_execution_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_hook_events_agent_session ON hook_events (workflow_execution_id, agent_session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_hook_events_manager_session ON hook_events (manager_session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_hook_events_node_exec ON hook_events (node_exec_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_event_supervised_runs_correlation
      ON event_supervised_runs (source_id, binding_id, correlation_key, updated_at);
    CREATE INDEX IF NOT EXISTS idx_event_supervised_runs_active_target
      ON event_supervised_runs (active_target_execution_id);
    CREATE INDEX IF NOT EXISTS idx_event_supervisor_commands_run
      ON event_supervisor_commands (supervised_run_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_schedules_status_next_due
      ON workflow_schedules (status, next_due_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_schedules_source
      ON workflow_schedules (source_id, status, updated_at);
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
}

export function ensureBaseRuntimeJsonConstraints(db: Database): void {
  rebuildTableWithJsonChecks({
    db,
    tableName: "runtime_schema_metadata",
    createSql: `
      CREATE TABLE runtime_schema_metadata (
        metadata_id TEXT PRIMARY KEY CHECK (metadata_id = 'active'),
        schema_version INTEGER NOT NULL,
        ${requiredJsonTextColumn("active_tables_json")},
        ${nullableJsonTextColumn("migration_metadata_json")},
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
    columns: [
      "metadata_id",
      "schema_version",
      "active_tables_json",
      "migration_metadata_json",
      "created_at",
      "updated_at",
    ],
    policies: [
      { columnName: "active_tables_json", nullability: "required" },
      { columnName: "migration_metadata_json", nullability: "nullable" },
    ],
  });
  rebuildTableWithJsonChecks({
    db,
    tableName: "sessions",
    createSql: `
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        workflow_name TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        current_node_id TEXT,
        current_step_id TEXT,
        node_execution_counter INTEGER NOT NULL,
        ${requiredJsonTextColumn("queue_json")},
        last_error TEXT,
        updated_at TEXT NOT NULL,
        ${nullableJsonTextColumn("supervision_json")},
        continuation_mode TEXT,
        continued_from_workflow_execution_id TEXT,
        continued_after_step_run_id TEXT,
        continued_after_execution_ordinal INTEGER,
        continued_start_step_id TEXT,
        ${nullableJsonTextColumn("history_imports_json")}
      );
    `,
    columns: [
      "session_id",
      "workflow_name",
      "workflow_id",
      "status",
      "started_at",
      "ended_at",
      "current_node_id",
      "current_step_id",
      "node_execution_counter",
      "queue_json",
      "last_error",
      "updated_at",
      "supervision_json",
      "continuation_mode",
      "continued_from_workflow_execution_id",
      "continued_after_step_run_id",
      "continued_after_execution_ordinal",
      "continued_start_step_id",
      "history_imports_json",
    ],
    policies: [
      { columnName: "queue_json", nullability: "required" },
      { columnName: "supervision_json", nullability: "nullable" },
      { columnName: "history_imports_json", nullability: "nullable" },
    ],
  });
  rebuildTableWithJsonChecks({
    db,
    tableName: "node_executions",
    createSql: `
      CREATE TABLE node_executions (
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
        ${nullableJsonTextColumn("output_validation_errors_json")},
        prompt_variant TEXT,
        timeout_ms INTEGER,
        backend_session_mode TEXT,
        backend_session_id TEXT,
        restarted_from_node_exec_id TEXT,
        execution_ordinal INTEGER,
        input_hash TEXT NOT NULL,
        output_hash TEXT NOT NULL,
        ${requiredJsonTextColumn("input_json")},
        ${requiredJsonTextColumn("output_json")},
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, node_exec_id)
      );
    `,
    columns: [
      "session_id",
      "node_exec_id",
      "node_id",
      "step_id",
      "node_registry_id",
      "mailbox_instance_id",
      "status",
      "artifact_dir",
      "started_at",
      "ended_at",
      "attempt",
      "output_attempt_count",
      "output_validation_errors_json",
      "prompt_variant",
      "timeout_ms",
      "backend_session_mode",
      "backend_session_id",
      "restarted_from_node_exec_id",
      "execution_ordinal",
      "input_hash",
      "output_hash",
      "input_json",
      "output_json",
      "created_at",
    ],
    policies: [
      { columnName: "output_validation_errors_json", nullability: "nullable" },
      { columnName: "input_json", nullability: "required" },
      { columnName: "output_json", nullability: "required" },
    ],
  });
  rebuildTableWithJsonChecks({
    db,
    tableName: "node_logs",
    createSql: `
      CREATE TABLE node_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        node_exec_id TEXT,
        node_id TEXT,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        ${nullableJsonTextColumn("payload_json")},
        at TEXT NOT NULL
      );
    `,
    columns: [
      "id",
      "session_id",
      "node_exec_id",
      "node_id",
      "level",
      "message",
      "payload_json",
      "at",
    ],
    policies: [{ columnName: "payload_json", nullability: "nullable" }],
  });
  rebuildTableWithJsonChecks({
    db,
    tableName: "llm_session_messages",
    createSql: `
      CREATE TABLE llm_session_messages (
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
        ${nullableJsonTextColumn("raw_message_json")},
        at TEXT NOT NULL
      );
    `,
    columns: [
      "id",
      "session_id",
      "node_exec_id",
      "node_id",
      "provider",
      "model",
      "backend_session_id",
      "ordinal",
      "role",
      "event_type",
      "content_text",
      "raw_message_json",
      "at",
    ],
    policies: [{ columnName: "raw_message_json", nullability: "nullable" }],
  });
  rebuildTableWithJsonChecks({
    db,
    tableName: "workflow_messages",
    createSql: `
      CREATE TABLE workflow_messages (
        workflow_id TEXT NOT NULL,
        workflow_execution_id TEXT NOT NULL,
        communication_id TEXT NOT NULL,
        from_node_id TEXT NOT NULL,
        to_node_id TEXT NOT NULL,
        routing_scope TEXT NOT NULL,
        delivery_kind TEXT NOT NULL,
        transition_when TEXT NOT NULL,
        source_node_exec_id TEXT NOT NULL,
        status TEXT NOT NULL,
        active_delivery_attempt_id TEXT,
        ${requiredJsonTextColumn("delivery_attempt_ids_json")},
        ${requiredJsonTextColumn("payload_ref_json")},
        ${nullableJsonTextColumn("payload_json")},
        ${nullableJsonTextColumn("artifact_refs_json")},
        artifact_dir TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        consumed_by_node_exec_id TEXT,
        consumed_at TEXT,
        failure_reason TEXT,
        superseded_by_communication_id TEXT,
        superseded_at TEXT,
        replayed_from_communication_id TEXT,
        manager_message_id TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workflow_execution_id, communication_id)
      );
    `,
    columns: [
      "workflow_id",
      "workflow_execution_id",
      "communication_id",
      "from_node_id",
      "to_node_id",
      "routing_scope",
      "delivery_kind",
      "transition_when",
      "source_node_exec_id",
      "status",
      "active_delivery_attempt_id",
      "delivery_attempt_ids_json",
      "payload_ref_json",
      "payload_json",
      "artifact_refs_json",
      "artifact_dir",
      "created_at",
      "delivered_at",
      "consumed_by_node_exec_id",
      "consumed_at",
      "failure_reason",
      "superseded_by_communication_id",
      "superseded_at",
      "replayed_from_communication_id",
      "manager_message_id",
      "updated_at",
    ],
    policies: [
      { columnName: "delivery_attempt_ids_json", nullability: "required" },
      { columnName: "payload_ref_json", nullability: "required" },
      { columnName: "payload_json", nullability: "nullable" },
      { columnName: "artifact_refs_json", nullability: "nullable" },
    ],
  });
  ensureBaseRuntimeIndexes(db);
}

export function ensureEventRuntimeJsonConstraints(db: Database): void {
  rebuildTableWithJsonChecks({
    db,
    tableName: "event_reply_dispatches",
    createSql: `
      CREATE TABLE event_reply_dispatches (
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
        ${requiredJsonTextColumn("request_json")},
        ${nullableJsonTextColumn("response_json")},
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
    columns: [
      "idempotency_key",
      "source_id",
      "provider",
      "workflow_id",
      "workflow_execution_id",
      "node_id",
      "node_exec_id",
      "event_id",
      "conversation_id",
      "thread_id",
      "actor_id",
      "status",
      "dispatch_id",
      "provider_message_id",
      "request_json",
      "response_json",
      "error",
      "created_at",
      "updated_at",
    ],
    policies: [
      { columnName: "request_json", nullability: "required" },
      { columnName: "response_json", nullability: "nullable" },
    ],
  });
  rebuildTableWithJsonChecks({
    db,
    tableName: "hook_events",
    createSql: `
      CREATE TABLE hook_events (
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
        ${nullableJsonTextColumn("payload_ref_json")},
        ${nullableJsonTextColumn("response_json")},
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
    columns: [
      "hook_event_id",
      "workflow_id",
      "workflow_execution_id",
      "node_id",
      "node_exec_id",
      "manager_session_id",
      "vendor",
      "agent_session_id",
      "raw_event_name",
      "event_name",
      "cwd",
      "transcript_path",
      "model",
      "turn_id",
      "payload_hash",
      "payload_ref_json",
      "response_json",
      "status",
      "error",
      "created_at",
      "updated_at",
    ],
    policies: [
      { columnName: "payload_ref_json", nullability: "nullable" },
      { columnName: "response_json", nullability: "nullable" },
    ],
  });
  rebuildTableWithJsonChecks({
    db,
    tableName: "event_supervisor_commands",
    createSql: `
      CREATE TABLE event_supervisor_commands (
        command_id TEXT PRIMARY KEY,
        supervised_run_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        binding_id TEXT NOT NULL,
        correlation_key TEXT NOT NULL,
        action TEXT NOT NULL,
        ${nullableJsonTextColumn("args_json")},
        receipt_id TEXT NOT NULL,
        ${requiredJsonTextColumn("result_json")},
        created_at TEXT NOT NULL
      );
    `,
    columns: [
      "command_id",
      "supervised_run_id",
      "source_id",
      "binding_id",
      "correlation_key",
      "action",
      "args_json",
      "receipt_id",
      "result_json",
      "created_at",
    ],
    policies: [
      { columnName: "args_json", nullability: "nullable" },
      { columnName: "result_json", nullability: "required" },
    ],
  });
  rebuildTableWithJsonChecks({
    db,
    tableName: "workflow_schedules",
    createSql: `
      CREATE TABLE workflow_schedules (
        schedule_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        binding_id TEXT NOT NULL,
        source_receipt_id TEXT NOT NULL,
        workflow_name TEXT NOT NULL,
        ${nullableJsonTextColumn("workflow_source_json")},
        kind TEXT NOT NULL,
        timezone TEXT NOT NULL,
        due_at TEXT,
        cron TEXT,
        next_due_at TEXT NOT NULL,
        status TEXT NOT NULL,
        ${requiredJsonTextColumn("workflow_input_json")},
        conversation_id TEXT,
        thread_id TEXT,
        actor_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_execution_id TEXT,
        last_fired_at TEXT,
        last_occurrence_id TEXT,
        attempt_count INTEGER NOT NULL,
        last_error TEXT
      );
    `,
    columns: [
      "schedule_id",
      "source_id",
      "binding_id",
      "source_receipt_id",
      "workflow_name",
      "workflow_source_json",
      "kind",
      "timezone",
      "due_at",
      "cron",
      "next_due_at",
      "status",
      "workflow_input_json",
      "conversation_id",
      "thread_id",
      "actor_id",
      "created_at",
      "updated_at",
      "last_execution_id",
      "last_fired_at",
      "last_occurrence_id",
      "attempt_count",
      "last_error",
    ],
    policies: [
      { columnName: "workflow_source_json", nullability: "nullable" },
      { columnName: "workflow_input_json", nullability: "required" },
    ],
  });
  rebuildTableWithJsonChecks({
    db,
    tableName: "supervisor_conversations",
    createSql: `
      CREATE TABLE supervisor_conversations (
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
        ${nullableJsonTextColumn("selected_managed_run_ids_by_workflow_key_json")},
        status TEXT NOT NULL,
        artifact_dir TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
    columns: [
      "supervisor_conversation_id",
      "supervisor_profile_id",
      "profile_revision",
      "supervisor_workflow_name",
      "supervisor_execution_id",
      "source_id",
      "binding_id",
      "correlation_key",
      "conversation_revision",
      "selected_managed_run_id",
      "selected_managed_run_ids_by_workflow_key_json",
      "status",
      "artifact_dir",
      "created_at",
      "updated_at",
    ],
    policies: [
      {
        columnName: "selected_managed_run_ids_by_workflow_key_json",
        nullability: "nullable",
      },
    ],
  });
  rebuildTableWithJsonChecks({
    db,
    tableName: "supervisor_dispatch_decisions",
    createSql: `
      CREATE TABLE supervisor_dispatch_decisions (
        decision_id TEXT PRIMARY KEY,
        supervisor_conversation_id TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        profile_revision TEXT NOT NULL,
        conversation_revision INTEGER NOT NULL,
        status TEXT NOT NULL,
        ${requiredJsonTextColumn("proposal_json")},
        ${nullableJsonTextColumn("result_summary_json")},
        receipt_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
    columns: [
      "decision_id",
      "supervisor_conversation_id",
      "source_message_id",
      "profile_revision",
      "conversation_revision",
      "status",
      "proposal_json",
      "result_summary_json",
      "receipt_id",
      "created_at",
      "updated_at",
    ],
    policies: [
      { columnName: "proposal_json", nullability: "required" },
      { columnName: "result_summary_json", nullability: "nullable" },
    ],
  });
  ensureEventRuntimeIndexes(db);
}

export function ensureManagerSessionJsonConstraints(db: Database): void {
  rebuildTableWithJsonChecks({
    db,
    tableName: "manager_messages",
    createSql: `
      CREATE TABLE manager_messages (
        manager_message_id TEXT PRIMARY KEY,
        manager_session_id TEXT NOT NULL,
        workflow_id TEXT NOT NULL,
        workflow_execution_id TEXT NOT NULL,
        manager_step_id TEXT NOT NULL,
        manager_node_exec_id TEXT NOT NULL,
        message TEXT,
        ${requiredJsonTextColumn("parsed_intent_json")},
        accepted INTEGER NOT NULL,
        rejection_reason TEXT,
        created_at TEXT NOT NULL
      );
    `,
    columns: [
      "manager_message_id",
      "manager_session_id",
      "workflow_id",
      "workflow_execution_id",
      "manager_step_id",
      "manager_node_exec_id",
      "message",
      "parsed_intent_json",
      "accepted",
      "rejection_reason",
      "created_at",
    ],
    policies: [{ columnName: "parsed_intent_json", nullability: "required" }],
  });
  rebuildTableWithJsonChecks({
    db,
    tableName: "idempotent_mutations",
    createSql: `
      CREATE TABLE idempotent_mutations (
        mutation_name TEXT NOT NULL,
        manager_session_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        normalized_request_hash TEXT NOT NULL,
        ${requiredJsonTextColumn("response_json")},
        completed_at TEXT NOT NULL,
        PRIMARY KEY (mutation_name, manager_session_id, idempotency_key)
      );
    `,
    columns: [
      "mutation_name",
      "manager_session_id",
      "idempotency_key",
      "normalized_request_hash",
      "response_json",
      "completed_at",
    ],
    policies: [{ columnName: "response_json", nullability: "required" }],
  });
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_manager_messages_session
      ON manager_messages (manager_session_id, created_at);
  `);
}
