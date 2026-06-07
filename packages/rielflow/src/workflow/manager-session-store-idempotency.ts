import type { Database } from "bun:sqlite";
import { nullableJsonTextColumn } from "./runtime-db/json-schema-constraints";

export type IdempotentMutationStatus = "pending" | "completed" | "failed";

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

export interface IdempotentMutationClaim extends IdempotentMutationLookup {
  readonly normalizedRequestHash: string;
  readonly claimToken: string;
  readonly status: IdempotentMutationStatus;
  readonly claimedAt: string;
  readonly responseJson?: string;
  readonly errorJson?: string;
  readonly completedAt?: string;
  readonly failedAt?: string;
}

export interface ClaimIdempotentMutationInput extends IdempotentMutationLookup {
  readonly normalizedRequestHash: string;
  readonly claimToken: string;
  readonly claimedAt: string;
}

export interface CompleteIdempotentMutationInput
  extends IdempotentMutationLookup {
  readonly normalizedRequestHash: string;
  readonly claimToken: string;
  readonly responseJson: string;
  readonly completedAt: string;
}

export interface FailIdempotentMutationInput extends IdempotentMutationLookup {
  readonly normalizedRequestHash: string;
  readonly claimToken: string;
  readonly errorJson: string;
  readonly failedAt: string;
}

interface IdempotentMutationRow {
  readonly mutation_name: string;
  readonly manager_session_id: string;
  readonly idempotency_key: string;
  readonly normalized_request_hash: string;
  readonly status: IdempotentMutationStatus;
  readonly claim_token: string;
  readonly claimed_at: string;
  readonly response_json: string | null;
  readonly completed_at: string | null;
  readonly error_json: string | null;
  readonly failed_at: string | null;
}

const IDEMPOTENT_MUTATIONS_SCHEMA_SQL = `
  CREATE TABLE idempotent_mutations (
    mutation_name TEXT NOT NULL,
    manager_session_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    normalized_request_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
    claim_token TEXT NOT NULL,
    claimed_at TEXT NOT NULL,
    ${nullableJsonTextColumn("response_json")},
    completed_at TEXT,
    ${nullableJsonTextColumn("error_json")},
    failed_at TEXT,
    CHECK (
      (
        status = 'pending'
        AND response_json IS NULL
        AND completed_at IS NULL
        AND error_json IS NULL
        AND failed_at IS NULL
      )
      OR
      (
        status = 'completed'
        AND response_json IS NOT NULL
        AND completed_at IS NOT NULL
        AND error_json IS NULL
        AND failed_at IS NULL
      )
      OR
      (
        status = 'failed'
        AND response_json IS NULL
        AND completed_at IS NULL
        AND error_json IS NOT NULL
        AND failed_at IS NOT NULL
      )
    ),
    PRIMARY KEY (mutation_name, manager_session_id, idempotency_key)
  );
`;

function listTableColumns(db: Database, tableName: string): Set<string> {
  return new Set(
    (
      db.prepare(`PRAGMA table_info(${tableName})`).all() as readonly {
        readonly name: string;
      }[]
    ).map((column) => column.name),
  );
}

function tableSql(db: Database, tableName: string): string | null {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { readonly sql: string | null } | null;
  return row?.sql ?? null;
}

function hasAtomicIdempotentMutationSchema(db: Database): boolean {
  const columns = listTableColumns(db, "idempotent_mutations");
  const sql = tableSql(db, "idempotent_mutations") ?? "";
  return (
    columns.has("status") &&
    columns.has("claim_token") &&
    columns.has("claimed_at") &&
    columns.has("error_json") &&
    columns.has("failed_at") &&
    sql.includes(
      "status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed'))",
    ) &&
    sql.includes("CHECK (response_json IS NULL OR json_valid(response_json))")
  );
}

export function ensureIdempotentMutationAtomicClaimSchema(db: Database): void {
  db.exec(
    IDEMPOTENT_MUTATIONS_SCHEMA_SQL.replace(
      "CREATE TABLE",
      "CREATE TABLE IF NOT EXISTS",
    ),
  );
  if (hasAtomicIdempotentMutationSchema(db)) {
    return;
  }

  const columns = listTableColumns(db, "idempotent_mutations");
  const tempTableName = "idempotent_mutations_atomic_claim_new";
  const rebuild = db.transaction(() => {
    db.exec(`DROP TABLE IF EXISTS ${tempTableName};`);
    db.exec(
      IDEMPOTENT_MUTATIONS_SCHEMA_SQL.replace(
        "idempotent_mutations",
        tempTableName,
      ),
    );
    if (
      columns.has("status") &&
      columns.has("claim_token") &&
      columns.has("claimed_at") &&
      columns.has("error_json") &&
      columns.has("failed_at")
    ) {
      db.exec(`
        INSERT INTO ${tempTableName} (
          mutation_name,
          manager_session_id,
          idempotency_key,
          normalized_request_hash,
          status,
          claim_token,
          claimed_at,
          response_json,
          completed_at,
          error_json,
          failed_at
        )
        SELECT
          mutation_name,
          manager_session_id,
          idempotency_key,
          normalized_request_hash,
          status,
          claim_token,
          claimed_at,
          response_json,
          completed_at,
          error_json,
          failed_at
        FROM idempotent_mutations
      `);
    } else {
      db.exec(`
        INSERT INTO ${tempTableName} (
          mutation_name,
          manager_session_id,
          idempotency_key,
          normalized_request_hash,
          status,
          claim_token,
          claimed_at,
          response_json,
          completed_at,
          error_json,
          failed_at
        )
        SELECT
          mutation_name,
          manager_session_id,
          idempotency_key,
          normalized_request_hash,
          'completed',
          'legacy:' || lower(hex(randomblob(16))),
          completed_at,
          response_json,
          completed_at,
          NULL,
          NULL
        FROM idempotent_mutations
      `);
    }
    db.exec("DROP TABLE idempotent_mutations;");
    db.exec(`ALTER TABLE ${tempTableName} RENAME TO idempotent_mutations;`);
  });
  rebuild();
}

export function toIdempotentMutationClaim(
  row: IdempotentMutationRow,
): IdempotentMutationClaim {
  return {
    mutationName: row.mutation_name,
    managerSessionId: row.manager_session_id,
    idempotencyKey: row.idempotency_key,
    normalizedRequestHash: row.normalized_request_hash,
    claimToken: row.claim_token,
    status: row.status,
    claimedAt: row.claimed_at,
    ...(row.response_json === null ? {} : { responseJson: row.response_json }),
    ...(row.error_json === null ? {} : { errorJson: row.error_json }),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
    ...(row.failed_at === null ? {} : { failedAt: row.failed_at }),
  };
}

export function loadIdempotentMutationRow(
  db: Database,
  input: IdempotentMutationLookup,
): IdempotentMutationRow | null {
  return db
    .prepare(
      `
      SELECT
        mutation_name,
        manager_session_id,
        idempotency_key,
        normalized_request_hash,
        status,
        claim_token,
        claimed_at,
        response_json,
        completed_at,
        error_json,
        failed_at
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
}
