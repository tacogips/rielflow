# SQLite Workflow Message Store

This document defines the SQLite-only persistence boundary for inbound and
outbound workflow messages that were previously exchanged through mailbox
files.

## Overview

Workflow communication remains manager-owned, but SQLite is now the canonical
message transport store. New runtime code must create, read, replay, retry,
consume, list, and inspect workflow messages through `workflow_messages`.
Session communication arrays may still exist as engine state while the broader
session model is simplified, but they are not a fallback message source.

Design goals:

- persist every new communication message in SQLite by default
- store file and binary payloads on disk, never as SQLite blobs
- store only path references for file handoffs in SQLite
- keep default storage under `~/.rielflow` through existing runtime root rules
- let operators override the runtime database and file roots with environment
  variables
- fail message publication when the SQLite write fails

## Storage Roots

Default roots use the existing runtime storage model:

- runtime database: `{rootDataDir}/rielflow.db`
- message file and binary root: `{rootDataDir}/files`

With the default user root, `{rootDataDir}` is `~/.rielflow/artifacts`, so new
message records default to `~/.rielflow/artifacts/rielflow.db` and message files
default under `~/.rielflow/artifacts/files`.

Override order:

- `RIEL_RUNTIME_DB` overrides the SQLite database path directly.
- `RIEL_ARTIFACT_DIR` overrides `{rootDataDir}` and therefore the default
  database and files roots.
- `RIEL_ATTACHMENT_ROOT` overrides only the file and binary message root.
- `--artifact-root` and `--session-store` keep existing runtime data
  co-location inference for the default database path when `RIEL_RUNTIME_DB` is
  not set.

`RIEL_ARTIFACT_ROOT` still controls non-message workflow artifacts, but it is
not the canonical message transport root.

## Message File Path Shape

SQLite path fields store normalized attachment-root-relative paths for message
files and binary handoff artifacts:

```text
{workflow_id_path_friendly}/{workflow_run_id}/messages/{communicationId}/{some_path}
```

Examples:

```text
demo-workflow/wfexec-000123/messages/comm-000004/payload.json
demo-workflow/wfexec-000123/messages/comm-000004/files/report.pdf
```

Rules:

- `workflow_id_path_friendly` is the safe workflow id segment accepted by
  `resolveWorkflowScopedPath`.
- `workflow_run_id` is the workflow execution id.
- message paths must stay under
  `{attachmentRoot}/{workflow_id_path_friendly}/{workflow_run_id}/`.
- persisted paths are relative to `resolveAttachmentRoot()`.
- path normalization rejects empty segments, `.`, `..`, path separators inside
  identifier segments, and targets that escape the scoped root.
- absolute attachment paths are rejected for new message rows.

Existing manager attachment inputs that arrive as root-data-relative paths are
materialized into the attachment root before the SQLite row is stored. The DB
row still records `pathBase: "attachment-root"`.

## SQLite Record Model

`workflow_messages` is the canonical table for message transport state.
`node_logs` may continue to receive compact communication events for CLI
observability, but message behavior does not read from logs.

Row cardinality:

- one canonical row is written per `communicationId` in a workflow execution
- the row represents both sender outbox and recipient inbox views through
  `from_node_id`, `to_node_id`, `routing_scope`, and `delivery_kind`
- outbound message reads filter by `from_node_id`
- inbound message reads filter by `to_node_id`
- replay creates a new communication row
- retry updates delivery-attempt state on the existing row

Core columns:

- `workflow_id`
- `workflow_execution_id`
- `communication_id`
- `from_node_id`
- `to_node_id`
- `routing_scope`
- `delivery_kind`
- `transition_when`
- `source_node_exec_id`
- `status`
- `active_delivery_attempt_id`
- `delivery_attempt_ids_json`
- `payload_ref_json`
- `payload_json`
- `artifact_refs_json`
- `artifact_dir`
- `created_at`
- `delivered_at`
- `consumed_by_node_exec_id`
- `consumed_at`
- `failure_reason`
- `superseded_by_communication_id`
- `superseded_at`
- `replayed_from_communication_id`
- `manager_message_id`
- `updated_at`

JSON columns use SQLite `TEXT` storage with canonical JSON strings. SQLite does
not provide a native JSON storage class; JSON1 operates on text JSON, so the
runtime stores JSON fields as text and validates them at the SQLite schema
boundary. Required JSON text columns must use `CHECK(json_valid(column))`.
Nullable JSON text columns must use
`CHECK(column IS NULL OR json_valid(column))`. The design does not promote
arbitrary JSON fields into table fields. Only values that are needed for
filtering, ordering, joining, or stable inspection should be duplicated as
ordinary typed columns while also remaining inside the canonical JSON text.
File and binary bodies remain outside SQLite regardless of JSON column shape.

## Runtime JSON Validation Policy

Every new runtime SQLite row that writes canonical JSON text must be rejected by
SQLite when the JSON text is malformed. This applies to the base runtime schema,
runtime schema migrations, and event runtime schema extensions that share the
same runtime database.

Policy:

- non-null JSON text: `TEXT NOT NULL CHECK (json_valid(column))`
- nullable JSON text: `TEXT CHECK (column IS NULL OR json_valid(column))`
- table rebuild migrations must recreate the same constraints as the create
  path before copying old rows into the replacement table
- malformed historical rows may fail migration rather than being silently
  rewritten or accepted
- newly added nullable JSON columns may use `ALTER TABLE ... ADD COLUMN` with a
  nullable JSON check when SQLite accepts the constraint for existing rows
- validation belongs in the SQLite schema in addition to TypeScript
  serialization, so direct DB writes and regression tests exercise the same
  boundary

`workflow_messages` must explicitly constrain:

- `delivery_attempt_ids_json` as non-null JSON
- `payload_ref_json` as non-null JSON
- `payload_json` as nullable JSON
- `artifact_refs_json` as nullable JSON

The same policy applies to other runtime JSON text columns where the column is
owned by rielflow runtime persistence, including session queue/supervision
state, node execution input/output and output-validation errors, node log
payloads, LLM raw message snapshots, runtime schema metadata, event reply and
hook request/response references, event supervisor command arguments/results,
workflow schedule source/input, supervisor conversation selection maps, and
supervisor dispatch decision proposal/result summaries. Manager control-plane
SQLite tables are in scope too: manager message parsed intent snapshots and
idempotent mutation response envelopes are runtime JSON text and should follow
the same required/nullable constraint rule. Columns that merely store hashes,
opaque provider identifiers, or filesystem paths are not JSON columns and must
not receive JSON checks.

Focused tests must prove:

- malformed JSON is rejected for required `workflow_messages` JSON columns
- malformed JSON is rejected for nullable `workflow_messages` JSON columns when
  non-null
- null remains accepted for nullable `workflow_messages` JSON columns
- valid JSON remains accepted for all constrained message JSON columns
- the `workflow_messages` rebuild migration preserves these checks
- representative non-message runtime JSON columns reject malformed direct
  inserts

Indexes:

- primary key on `(workflow_execution_id, communication_id)`
- `(workflow_execution_id, created_at, communication_id)` for canonical
  whole-run timeline ordering
- `(workflow_execution_id, to_node_id, status)`
- `(workflow_execution_id, to_node_id, created_at, communication_id)` for
  canonical inbound list ordering
- `(workflow_execution_id, from_node_id, created_at, communication_id)` for
  canonical outbound list ordering
- `(source_node_exec_id, created_at)`

`payload_json` is for structured, JSON-compatible payload snapshots only. When
payloads include files, binary content, or large generated artifacts,
`payload_json` stores metadata and path references, while `artifact_refs_json`
stores attachment-root-relative paths and media metadata.

## Schema Versioning And Migrations

The runtime database must include a metadata table that records the active
schema version before large schema changes are introduced. The metadata row is
the source of truth for migration decisions and should include at least:

- `schema_version`
- `created_at`
- `updated_at`
- optional migration metadata such as source database path, migration id, or
  tool version

Future large schema changes should create a new database file, create the new
schema there, migrate data from the old tables, verify the migrated row counts
and required invariants, then atomically switch the configured database path or
replace the old database file. In-place table rewrites are reserved for small,
low-risk additions.

Physical table names should carry a schema/table version for new large schema
generations, for example `workflow_messages_v1`, `sessions_v1`, and
`node_executions_v1`. Runtime code may expose logical repository methods, but
the SQLite schema metadata must map the active logical tables to their physical
versioned table names. This keeps future database-wide migrations explicit and
prevents ambiguous reads when old and new table shapes temporarily coexist
during migration.

## Write Flow

1. Resolve the runtime database path and attachment root from the effective
   execution options.
2. Allocate `communicationId` through the existing manager-owned allocator.
3. Normalize file or binary handoffs into attachment-root-relative paths.
4. Copy file/binary content under the attachment root.
5. Insert or update the `workflow_messages` row in SQLite.
6. Treat delivery as successful only after the SQLite write succeeds.

## Read Rules

Communication lists, communication detail, GraphQL manager mutations,
replay/retry selection, and consumed-state updates read from
`workflow_messages`. If a row is absent, the communication is absent.

GraphQL inspection surfaces synthesize message snapshots from the SQLite row.
They do not require per-communication mailbox files.

## PR #54 Review Boundary

PR #54 is an issue-resolution review of the SQLite message-store transition,
not a compatibility migration. The accepted behavior is that new workflow
communication reads are SQLite-backed even when legacy per-communication files
or session communication arrays are missing. Old file-backed message artifacts
are intentionally ignored by the canonical read path.

The feature boundary includes:

- workflow step publication and consumption
- failed workflow continuation after the workflow definition is fixed
- GraphQL communication list and detail views
- manager `sendManagerMessage` attachment recording
- manager-control `replay-communication` and delivery retry behavior
- runtime path override behavior for database and attachment roots

Review should reject any implementation that silently falls back to old
message files for new communication behavior, stores binary/file contents in
SQLite, accepts absolute or escaping attachment paths for new records, or lets
GraphQL/manager views diverge from `workflow_messages`.

Operational verification for this boundary must keep credentials out of logs,
artifacts, review output, and commits. Live chat gateway smoke evidence may
confirm end-to-end behavior, but credential material and private conversation
content are not design artifacts.

## Validation

Validation must cover:

- default database placement under `~/.rielflow/artifacts/rielflow.db`
- `RIEL_RUNTIME_DB` override for the SQLite path
- `RIEL_ARTIFACT_DIR` co-location of files and the default database
- `RIEL_ATTACHMENT_ROOT` file/binary message root override
- path traversal rejection for workflow ids, workflow run ids, communication
  ids, and file paths
- failed SQLite writes blocking new message publication
- one-row-per-communication SQLite cardinality
- inbound reads by `to_node_id` and outbound reads by `from_node_id`
- replay row creation and retry delivery-attempt updates
- GraphQL list/detail and manager-control behavior when session communication
  arrays are missing

History deletion and cleanup delete message file roots using workflow-scoped
attachment-root rules. No new retention policy is introduced by this design.

## References

Relevant local files:

- `packages/rielflow/src/workflow/communication-service.ts`
- `packages/rielflow/src/workflow/runtime-db/schema-and-record-types.ts`
- `packages/rielflow/src/workflow/runtime-db/workflow-message-records.ts`
- `packages/rielflow/src/workflow/runtime-db/session-query-records.ts`
- `packages/rielflow-core/src/paths.ts`
