import { timingSafeEqual, createHash, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { DEFAULT_GRAPHQL_ENDPOINT } from "../graphql/endpoint";
import { resolveRuntimeDbPath } from "./runtime-db";
import type { LoadOptions } from "./types";

export interface ManagerIntentSummary {
  readonly kind:
    | "planner-note"
    | "retry-step"
    | "replay-communication"
    | "execute-optional-step"
    | "skip-optional-step"
    | "wait"
    | "invalid";
  readonly targetId?: string;
  readonly reason?: string;
}

export type ManagerControlMode =
  | "graphql-manager-message"
  | "payload-manager-control";

export interface ManagerSessionRecord {
  readonly managerSessionId: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerStepId: string;
  readonly managerNodeExecId: string;
  readonly status: "active" | "completed" | "failed" | "cancelled";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastMessageId?: string;
  readonly controlMode?: ManagerControlMode;
  readonly authTokenHash: string;
  readonly authTokenExpiresAt: string;
}

export interface ManagerMessageRecord {
  readonly managerMessageId: string;
  readonly managerSessionId: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerStepId: string;
  readonly managerNodeExecId: string;
  readonly message?: string;
  readonly parsedIntent: readonly ManagerIntentSummary[];
  readonly accepted: boolean;
  readonly rejectionReason?: string;
  readonly createdAt: string;
}

export interface IdempotentMutationRecord {
  readonly mutationName: string;
  readonly managerSessionId: string;
  readonly idempotencyKey: string;
  readonly normalizedRequestHash: string;
  readonly responseJson: string;
  readonly completedAt: string;
}

export interface IdempotentMutationLookup {
  readonly mutationName: string;
  readonly managerSessionId: string;
  readonly idempotencyKey: string;
}

export interface AmbientManagerExecutionContext {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerStepId: string;
  readonly managerNodeExecId: string;
  readonly managerSessionId?: string;
  readonly authToken?: string;
}

export interface AmbientManagerControlPlaneEnvironment {
  readonly DIVEDRA_GRAPHQL_ENDPOINT: string;
  readonly DIVEDRA_MANAGER_AUTH_TOKEN: string;
  readonly DIVEDRA_MANAGER_SESSION_ID: string;
  readonly DIVEDRA_WORKFLOW_ID: string;
  readonly DIVEDRA_WORKFLOW_EXECUTION_ID: string;
  readonly DIVEDRA_MANAGER_STEP_ID: string;
  readonly DIVEDRA_MANAGER_NODE_EXEC_ID: string;
}

const AMBIENT_MANAGER_ENV_KEYS = [
  "DIVEDRA_MANAGER_AUTH_TOKEN",
  "DIVEDRA_MANAGER_SESSION_ID",
  "DIVEDRA_WORKFLOW_ID",
  "DIVEDRA_WORKFLOW_EXECUTION_ID",
  "DIVEDRA_MANAGER_STEP_ID",
  "DIVEDRA_MANAGER_NODE_EXEC_ID",
] as const;

export interface ManagerSessionStore {
  createOrResumeSession(
    input: ManagerSessionRecord,
  ): Promise<ManagerSessionRecord>;
  deleteByWorkflowId(workflowId: string): Promise<void>;
  deleteByWorkflowExecutionId(workflowExecutionId: string): Promise<void>;
  claimControlMode(input: {
    readonly managerSessionId: string;
    readonly controlMode: ManagerControlMode;
    readonly updatedAt: string;
  }): Promise<ManagerControlMode>;
  appendMessage(input: ManagerMessageRecord): Promise<ManagerMessageRecord>;
  loadSession(managerSessionId: string): Promise<ManagerSessionRecord | null>;
  listMessages(
    managerSessionId: string,
  ): Promise<readonly ManagerMessageRecord[]>;
  saveIdempotentResult(
    input: IdempotentMutationRecord,
  ): Promise<IdempotentMutationRecord>;
  loadIdempotentResult(
    input: IdempotentMutationLookup,
  ): Promise<IdempotentMutationRecord | null>;
  validateAuthToken(input: {
    readonly managerSessionId: string;
    readonly authToken: string;
    readonly now?: string;
  }): Promise<ManagerSessionRecord | null>;
}

interface ManagerSessionRow {
  readonly manager_session_id: string;
  readonly workflow_id: string;
  readonly workflow_execution_id: string;
  readonly manager_step_id: string;
  readonly manager_node_exec_id: string;
  readonly status: ManagerSessionRecord["status"];
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_message_id: string | null;
  readonly control_mode: ManagerControlMode | null;
  readonly auth_token_hash: string;
  readonly auth_token_expires_at: string;
}

interface ManagerMessageRow {
  readonly manager_message_id: string;
  readonly manager_session_id: string;
  readonly workflow_id: string;
  readonly workflow_execution_id: string;
  readonly manager_step_id: string;
  readonly manager_node_exec_id: string;
  readonly message: string | null;
  readonly parsed_intent_json: string;
  readonly accepted: number;
  readonly rejection_reason: string | null;
  readonly created_at: string;
}

interface IdempotentMutationRow {
  readonly mutation_name: string;
  readonly manager_session_id: string;
  readonly idempotency_key: string;
  readonly normalized_request_hash: string;
  readonly response_json: string;
  readonly completed_at: string;
}

function readEnvValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toManagerSessionRecord(row: ManagerSessionRow): ManagerSessionRecord {
  return {
    managerSessionId: row.manager_session_id,
    workflowId: row.workflow_id,
    workflowExecutionId: row.workflow_execution_id,
    managerStepId: row.manager_step_id,
    managerNodeExecId: row.manager_node_exec_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_message_id === null
      ? {}
      : { lastMessageId: row.last_message_id }),
    ...(row.control_mode === null ? {} : { controlMode: row.control_mode }),
    authTokenHash: row.auth_token_hash,
    authTokenExpiresAt: row.auth_token_expires_at,
  };
}

function toManagerMessageRecord(row: ManagerMessageRow): ManagerMessageRecord {
  return {
    managerMessageId: row.manager_message_id,
    managerSessionId: row.manager_session_id,
    workflowId: row.workflow_id,
    workflowExecutionId: row.workflow_execution_id,
    managerStepId: row.manager_step_id,
    managerNodeExecId: row.manager_node_exec_id,
    ...(row.message === null ? {} : { message: row.message }),
    parsedIntent: JSON.parse(
      row.parsed_intent_json,
    ) as readonly ManagerIntentSummary[],
    accepted: row.accepted === 1,
    ...(row.rejection_reason === null
      ? {}
      : { rejectionReason: row.rejection_reason }),
    createdAt: row.created_at,
  };
}

function toIdempotentMutationRecord(
  row: IdempotentMutationRow,
): IdempotentMutationRecord {
  return {
    mutationName: row.mutation_name,
    managerSessionId: row.manager_session_id,
    idempotencyKey: row.idempotency_key,
    normalizedRequestHash: row.normalized_request_hash,
    responseJson: row.response_json,
    completedAt: row.completed_at,
  };
}

export function hashManagerAuthToken(authToken: string): string {
  return createHash("sha256").update(authToken, "utf8").digest("hex");
}

export function mintManagerAuthToken(): string {
  return randomBytes(24).toString("base64url");
}

export function verifyManagerAuthToken(
  authToken: string,
  authTokenHash: string,
): boolean {
  const actual = new Uint8Array(
    Buffer.from(hashManagerAuthToken(authToken), "hex"),
  );
  const expected = new Uint8Array(Buffer.from(authTokenHash, "hex"));
  if (actual.length !== expected.length || expected.length === 0) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

export function resolveAmbientManagerExecutionContext(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AmbientManagerExecutionContext | null {
  const workflowId = readEnvValue(env, "DIVEDRA_WORKFLOW_ID");
  const workflowExecutionId = readEnvValue(
    env,
    "DIVEDRA_WORKFLOW_EXECUTION_ID",
  );
  const managerStepId = readEnvValue(env, "DIVEDRA_MANAGER_STEP_ID");
  const managerNodeExecId = readEnvValue(env, "DIVEDRA_MANAGER_NODE_EXEC_ID");

  if (
    workflowId === undefined ||
    workflowExecutionId === undefined ||
    managerStepId === undefined ||
    managerNodeExecId === undefined
  ) {
    return null;
  }

  const managerSessionId = readEnvValue(env, "DIVEDRA_MANAGER_SESSION_ID");
  const authToken = readEnvValue(env, "DIVEDRA_MANAGER_AUTH_TOKEN");
  return {
    workflowId,
    workflowExecutionId,
    managerStepId,
    managerNodeExecId,
    ...(managerSessionId === undefined ? {} : { managerSessionId }),
    ...(authToken === undefined ? {} : { authToken }),
  };
}

export function resolveManagerGraphqlEndpoint(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return (
    readEnvValue(env, "DIVEDRA_GRAPHQL_ENDPOINT") ?? DEFAULT_GRAPHQL_ENDPOINT
  );
}

export function buildAmbientManagerControlPlaneEnvironment(input: {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerStepId: string;
  readonly managerNodeExecId: string;
  readonly managerSessionId: string;
  readonly authToken: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): AmbientManagerControlPlaneEnvironment {
  return {
    DIVEDRA_GRAPHQL_ENDPOINT: resolveManagerGraphqlEndpoint(input.env),
    DIVEDRA_MANAGER_AUTH_TOKEN: input.authToken,
    DIVEDRA_MANAGER_SESSION_ID: input.managerSessionId,
    DIVEDRA_WORKFLOW_ID: input.workflowId,
    DIVEDRA_WORKFLOW_EXECUTION_ID: input.workflowExecutionId,
    DIVEDRA_MANAGER_STEP_ID: input.managerStepId,
    DIVEDRA_MANAGER_NODE_EXEC_ID: input.managerNodeExecId,
  };
}

export function stripAmbientManagerExecutionContext(
  env: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  const sanitized: Record<string, string | undefined> = { ...env };
  for (const key of AMBIENT_MANAGER_ENV_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
}

function ensureSchema(db: Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS manager_sessions (
      manager_session_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      workflow_execution_id TEXT NOT NULL,
      manager_step_id TEXT NOT NULL,
      manager_node_exec_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_message_id TEXT,
      control_mode TEXT,
      auth_token_hash TEXT NOT NULL,
      auth_token_expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS manager_messages (
      manager_message_id TEXT PRIMARY KEY,
      manager_session_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      workflow_execution_id TEXT NOT NULL,
      manager_step_id TEXT NOT NULL,
      manager_node_exec_id TEXT NOT NULL,
      message TEXT,
      parsed_intent_json TEXT NOT NULL,
      accepted INTEGER NOT NULL,
      rejection_reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS idempotent_mutations (
      mutation_name TEXT NOT NULL,
      manager_session_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      normalized_request_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      PRIMARY KEY (mutation_name, manager_session_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_manager_messages_session
      ON manager_messages (manager_session_id, created_at);
  `);

  const managerSessionColumns = new Set(
    (
      db.prepare("PRAGMA table_info(manager_sessions)").all() as readonly {
        readonly name: string;
      }[]
    ).map((column) => column.name),
  );
  if (!managerSessionColumns.has("control_mode")) {
    db.exec("ALTER TABLE manager_sessions ADD COLUMN control_mode TEXT");
  }
  // Migrate from older column names to manager_step_id
  if (!managerSessionColumns.has("manager_step_id")) {
    if (managerSessionColumns.has("manager_runtime_id")) {
      db.exec(
        "ALTER TABLE manager_sessions RENAME COLUMN manager_runtime_id TO manager_step_id",
      );
      db.exec(
        "ALTER TABLE manager_messages RENAME COLUMN manager_runtime_id TO manager_step_id",
      );
    } else if (managerSessionColumns.has("manager_node_id")) {
      db.exec(
        "ALTER TABLE manager_sessions RENAME COLUMN manager_node_id TO manager_step_id",
      );
      db.exec(
        "ALTER TABLE manager_messages RENAME COLUMN manager_node_id TO manager_step_id",
      );
    } else {
      throw new Error(
        "manager_sessions table is missing manager_step_id, manager_runtime_id, and manager_node_id columns; table may be corrupted or created with unexpected schema",
      );
    }
  }
}

async function withManagerDatabase<T>(
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

export function createManagerSessionStore(
  options: LoadOptions = {},
): ManagerSessionStore {
  const deleteManagerSessions = (
    db: Database,
    query: string,
    parameter: string,
    deleteManagerSessionsSql: string,
  ): void => {
    const managerSessionIds = (
      db.prepare(query).all(parameter) as Array<{
        readonly manager_session_id: string;
      }>
    ).map((row) => row.manager_session_id);

    for (const managerSessionId of managerSessionIds) {
      db.prepare(
        "DELETE FROM idempotent_mutations WHERE manager_session_id = ?",
      ).run(managerSessionId);
      db.prepare(
        "DELETE FROM manager_messages WHERE manager_session_id = ?",
      ).run(managerSessionId);
    }

    db.prepare(deleteManagerSessionsSql).run(parameter);
  };

  return {
    async createOrResumeSession(input) {
      await withManagerDatabase(options, (db) => {
        db.prepare(
          `
          INSERT INTO manager_sessions (
            manager_session_id, workflow_id, workflow_execution_id, manager_step_id,
            manager_node_exec_id, status, created_at, updated_at, last_message_id,
            control_mode, auth_token_hash, auth_token_expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(manager_session_id) DO UPDATE SET
            workflow_id=excluded.workflow_id,
            workflow_execution_id=excluded.workflow_execution_id,
            manager_step_id=excluded.manager_step_id,
            manager_node_exec_id=excluded.manager_node_exec_id,
            status=excluded.status,
            created_at=excluded.created_at,
            updated_at=excluded.updated_at,
            last_message_id=COALESCE(
              excluded.last_message_id,
              manager_sessions.last_message_id
            ),
            control_mode=COALESCE(
              excluded.control_mode,
              manager_sessions.control_mode
            ),
            auth_token_hash=excluded.auth_token_hash,
            auth_token_expires_at=excluded.auth_token_expires_at
        `,
        ).run(
          input.managerSessionId,
          input.workflowId,
          input.workflowExecutionId,
          input.managerStepId,
          input.managerNodeExecId,
          input.status,
          input.createdAt,
          input.updatedAt,
          input.lastMessageId ?? null,
          input.controlMode ?? null,
          input.authTokenHash,
          input.authTokenExpiresAt,
        );
      });
      return input;
    },
    async deleteByWorkflowId(workflowId) {
      await withManagerDatabase(options, (db) => {
        const runDeleteByWorkflowId = db.transaction(
          (targetWorkflowId: string) => {
            deleteManagerSessions(
              db,
              `
              SELECT manager_session_id
              FROM manager_sessions
              WHERE workflow_id = ?
            `,
              targetWorkflowId,
              "DELETE FROM manager_sessions WHERE workflow_id = ?",
            );
          },
        );
        runDeleteByWorkflowId(workflowId);
      });
    },
    async deleteByWorkflowExecutionId(workflowExecutionId) {
      await withManagerDatabase(options, (db) => {
        const runDeleteByWorkflowExecutionId = db.transaction(
          (targetWorkflowExecutionId: string) => {
            deleteManagerSessions(
              db,
              `
                SELECT manager_session_id
                FROM manager_sessions
                WHERE workflow_execution_id = ?
              `,
              targetWorkflowExecutionId,
              "DELETE FROM manager_sessions WHERE workflow_execution_id = ?",
            );
          },
        );
        runDeleteByWorkflowExecutionId(workflowExecutionId);
      });
    },
    async claimControlMode(input) {
      return await withManagerDatabase(options, (db) => {
        db.prepare(
          `
          UPDATE manager_sessions
          SET control_mode = ?, updated_at = ?
          WHERE manager_session_id = ?
            AND control_mode IS NULL
        `,
        ).run(input.controlMode, input.updatedAt, input.managerSessionId);
        const persisted = db
          .prepare(
            `
            SELECT control_mode
            FROM manager_sessions
            WHERE manager_session_id = ?
          `,
          )
          .get(input.managerSessionId) as {
          readonly control_mode: ManagerControlMode | null;
        } | null;
        if (persisted === null) {
          throw new Error(
            `manager session '${input.managerSessionId}' was not found`,
          );
        }
        if (persisted.control_mode === null) {
          throw new Error(
            `manager session '${input.managerSessionId}' has no persisted control mode after claim`,
          );
        }
        return persisted.control_mode;
      });
    },
    async appendMessage(input) {
      await withManagerDatabase(options, (db) => {
        db.prepare(
          `
          INSERT INTO manager_messages (
            manager_message_id, manager_session_id, workflow_id, workflow_execution_id,
            manager_step_id, manager_node_exec_id, message, parsed_intent_json,
            accepted, rejection_reason, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          input.managerMessageId,
          input.managerSessionId,
          input.workflowId,
          input.workflowExecutionId,
          input.managerStepId,
          input.managerNodeExecId,
          input.message ?? null,
          JSON.stringify(input.parsedIntent),
          input.accepted ? 1 : 0,
          input.rejectionReason ?? null,
          input.createdAt,
        );
        db.prepare(
          `
          UPDATE manager_sessions
          SET last_message_id = ?, updated_at = ?
          WHERE manager_session_id = ?
        `,
        ).run(input.managerMessageId, input.createdAt, input.managerSessionId);
      });
      return input;
    },
    async loadSession(managerSessionId) {
      return await withManagerDatabase(options, (db) => {
        const row = db
          .prepare(
            `
            SELECT
              manager_session_id,
              workflow_id,
              workflow_execution_id,
              manager_step_id,
              manager_node_exec_id,
              status,
              created_at,
              updated_at,
              last_message_id,
              control_mode,
              auth_token_hash,
              auth_token_expires_at
            FROM manager_sessions
            WHERE manager_session_id = ?
          `,
          )
          .get(managerSessionId) as ManagerSessionRow | null;
        return row === null ? null : toManagerSessionRecord(row);
      });
    },
    async listMessages(managerSessionId) {
      return await withManagerDatabase(options, (db) => {
        const rows = db
          .prepare(
            `
            SELECT
              manager_message_id,
              manager_session_id,
              workflow_id,
              workflow_execution_id,
              manager_step_id,
              manager_node_exec_id,
              message,
              parsed_intent_json,
              accepted,
              rejection_reason,
              created_at
            FROM manager_messages
            WHERE manager_session_id = ?
            ORDER BY created_at ASC, manager_message_id ASC
          `,
          )
          .all(managerSessionId) as ManagerMessageRow[];
        return rows.map((row) => toManagerMessageRecord(row));
      });
    },
    async saveIdempotentResult(input) {
      await withManagerDatabase(options, (db) => {
        db.prepare(
          `
          INSERT INTO idempotent_mutations (
            mutation_name, manager_session_id, idempotency_key,
            normalized_request_hash, response_json, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(mutation_name, manager_session_id, idempotency_key)
          DO UPDATE SET
            normalized_request_hash=excluded.normalized_request_hash,
            response_json=excluded.response_json,
            completed_at=excluded.completed_at
        `,
        ).run(
          input.mutationName,
          input.managerSessionId,
          input.idempotencyKey,
          input.normalizedRequestHash,
          input.responseJson,
          input.completedAt,
        );
      });
      return input;
    },
    async loadIdempotentResult(input) {
      return await withManagerDatabase(options, (db) => {
        const row = db
          .prepare(
            `
            SELECT
              mutation_name,
              manager_session_id,
              idempotency_key,
              normalized_request_hash,
              response_json,
              completed_at
            FROM idempotent_mutations
            WHERE mutation_name = ?
              AND manager_session_id = ?
              AND idempotency_key = ?
          `,
          )
          .get(
            input.mutationName,
            input.managerSessionId,
            input.idempotencyKey,
          ) as IdempotentMutationRow | null;
        return row === null ? null : toIdempotentMutationRecord(row);
      });
    },
    async validateAuthToken(input) {
      const session = await this.loadSession(input.managerSessionId);
      if (session === null) {
        return null;
      }
      const now = input.now ?? new Date().toISOString();
      if (session.authTokenExpiresAt <= now) {
        return null;
      }
      return verifyManagerAuthToken(input.authToken, session.authTokenHash)
        ? session
        : null;
    },
  };
}
