import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { resolveRootDataDir } from "./paths";
import type {
  NodeExecutionRecord,
  SessionStatus,
  WorkflowSessionState,
} from "./session";
import type { LoadOptions } from "./types";

interface RuntimeNodeExecutionRow {
  readonly sessionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly status: NodeExecutionRecord["status"];
  readonly artifactDir: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly attempt?: number;
  readonly outputAttemptCount?: number;
  readonly outputValidationErrors?: NodeExecutionRecord["outputValidationErrors"];
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
  readonly nodeExecutionCounter: number;
  readonly lastError: string | null;
  readonly updatedAt: string;
}

export interface RuntimeNodeExecutionSummary {
  readonly sessionId: string;
  readonly nodeExecId: string;
  readonly nodeId: string;
  readonly status: string;
  readonly artifactDir: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly attempt: number | null;
  readonly outputAttemptCount: number | null;
  readonly outputValidationErrors:
    | NodeExecutionRecord["outputValidationErrors"]
    | null;
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
  readonly node_execution_counter: number;
  readonly last_error: string | null;
  readonly updated_at: string;
}

function toRuntimeSessionSummary(row: RuntimeSessionRow): RuntimeSessionSummary {
  return {
    sessionId: row.session_id,
    workflowName: row.workflow_name,
    workflowId: row.workflow_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    currentNodeId: row.current_node_id,
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
      node_execution_counter INTEGER NOT NULL,
      queue_json TEXT NOT NULL,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS node_executions (
      session_id TEXT NOT NULL,
      node_exec_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      status TEXT NOT NULL,
      artifact_dir TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      attempt INTEGER,
      output_attempt_count INTEGER,
      output_validation_errors_json TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_sessions_workflow_name ON sessions (workflow_name);
    CREATE INDEX IF NOT EXISTS idx_node_exec_session ON node_executions (session_id, node_id);
    CREATE INDEX IF NOT EXISTS idx_node_logs_session ON node_logs (session_id, at);
  `);

  const nodeExecutionColumns = db
    .query("PRAGMA table_info(node_executions)")
    .all() as Array<{ name: string }>;
  const existingColumns = new Set(nodeExecutionColumns.map((row) => row.name));
  if (!existingColumns.has("output_attempt_count")) {
    db.exec(
      "ALTER TABLE node_executions ADD COLUMN output_attempt_count INTEGER",
    );
  }
  if (!existingColumns.has("output_validation_errors_json")) {
    db.exec(
      "ALTER TABLE node_executions ADD COLUMN output_validation_errors_json TEXT",
    );
  }
  if (!existingColumns.has("backend_session_mode")) {
    db.exec("ALTER TABLE node_executions ADD COLUMN backend_session_mode TEXT");
  }
  if (!existingColumns.has("backend_session_id")) {
    db.exec("ALTER TABLE node_executions ADD COLUMN backend_session_id TEXT");
  }
}

export async function saveSessionSnapshotToRuntimeDb(
  session: WorkflowSessionState,
  options: LoadOptions = {},
): Promise<void> {
  await withDatabase(options, (db) => {
    const stmt = db.prepare(`
      INSERT INTO sessions (
        session_id, workflow_name, workflow_id, status, started_at, ended_at,
        current_node_id, node_execution_counter, queue_json, last_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        workflow_name=excluded.workflow_name,
        workflow_id=excluded.workflow_id,
        status=excluded.status,
        started_at=excluded.started_at,
        ended_at=excluded.ended_at,
        current_node_id=excluded.current_node_id,
        node_execution_counter=excluded.node_execution_counter,
        queue_json=excluded.queue_json,
        last_error=excluded.last_error,
        updated_at=excluded.updated_at
    `);
    const updatedAt = new Date().toISOString();
    stmt.run(
      session.sessionId,
      session.workflowName,
      session.workflowId,
      session.status,
      session.startedAt,
      session.endedAt ?? null,
      session.currentNodeId ?? null,
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
        session_id, node_exec_id, node_id, status, artifact_dir, started_at, ended_at,
        attempt, output_attempt_count, output_validation_errors_json, backend_session_mode, backend_session_id,
        restarted_from_node_exec_id,
        input_hash, output_hash, input_json, output_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    nodeStmt.run(
      row.sessionId,
      row.nodeExecId,
      row.nodeId,
      row.status,
      row.artifactDir,
      row.startedAt,
      row.endedAt,
      row.attempt ?? null,
      row.outputAttemptCount ?? null,
      row.outputValidationErrors === undefined
        ? null
        : JSON.stringify(row.outputValidationErrors),
      row.backendSessionMode ?? null,
      row.backendSessionId ?? null,
      row.restartedFromNodeExecId ?? null,
      row.inputHash,
      row.outputHash,
      row.inputJson,
      row.outputJson,
      now,
    );

    const logStmt = db.prepare(`
      INSERT INTO node_logs (session_id, node_exec_id, node_id, level, message, payload_json, at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    logStmt.run(
      row.sessionId,
      row.nodeExecId,
      row.nodeId,
      row.status === "succeeded" ? "info" : "warning",
      `node ${row.nodeId} finished with status ${row.status}`,
      JSON.stringify({
        inputHash: row.inputHash,
        outputHash: row.outputHash,
        artifactDir: row.artifactDir,
      }),
      row.endedAt,
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
          status,
          artifact_dir,
          started_at,
          ended_at,
          attempt,
          output_attempt_count,
          output_validation_errors_json,
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
      status: string;
      artifact_dir: string;
      started_at: string;
      ended_at: string;
      attempt: number | null;
      output_attempt_count: number | null;
      output_validation_errors_json: string | null;
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
