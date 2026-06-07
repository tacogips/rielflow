# SQLite Runtime JSON Checks Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-sqlite-message-store.md#runtime-json-validation-policy; design-docs/specs/architecture.md#runtime-storage-layout
**Created**: 2026-06-07
**Last Updated**: 2026-06-07

## Design Document Reference

The accepted design source of truth is
`design-docs/specs/design-sqlite-message-store.md`, reviewed and accepted by
Step 3 for PR #54 with no high or mid findings. `architecture.md` confirms the
provider-neutral storage boundary: malformed runtime SQLite JSON text is a
failed write, not a reader-side repair case.

Included:

- Add SQLite JSON1 `CHECK(json_valid(...))` constraints for non-null runtime
  JSON text columns.
- Add `CHECK(column IS NULL OR json_valid(column))` constraints for nullable
  runtime JSON text columns.
- Cover `workflow_messages.delivery_attempt_ids_json`,
  `workflow_messages.payload_ref_json`, `workflow_messages.payload_json`, and
  `workflow_messages.artifact_refs_json` in create-table and rebuild-migration
  paths.
- Apply the same policy to rielflow-owned runtime DB JSON text in base runtime,
  event runtime extension, supervisor, schedule, and manager control-plane
  tables.
- Add focused tests for malformed JSON rejection, valid JSON acceptance, null
  acceptance for nullable JSON columns, and migration behavior.

Excluded:

- Backward compatibility with old file-backed mailbox behavior.
- Reader-side repair of malformed historical SQLite JSON.
- JSON checks on hashes, opaque provider ids, filesystem paths, or ordinary text
  fields.
- Cursor CLI or codex-agent adapter behavior changes.

## Issue And Reference Traceability

- Workflow mode: `issue-resolution`
- Workflow ID: `codex-design-and-implement-review-loop`
- Node: `step4-impl-plan-create`
- Issue reference: GitHub PR #54,
  `https://github.com/tacogips/rielflow/pull/54`
- Accepted review: Step 3 `reviewDecision=accepted`

Codex-agent references:

- Execution provider: `codex-agent / gpt-5.5`
- Decision: no codex-agent schema behavior is copied. SQLite JSON validation is
  rielflow-owned runtime database behavior below the agent adapter layer.
- Intentional divergence: old file-mailbox compatibility remains out of scope,
  and malformed runtime SQLite JSON may fail migration explicitly.

## Modules

### 1. Runtime JSON Constraint Surface

#### packages/rielflow/src/workflow/runtime-db/schema-and-record-types.ts
#### packages/rielflow/src/workflow/runtime-db/json-schema-constraints.ts
#### packages/rielflow/src/workflow/runtime-db/message-types.ts

**Status**: COMPLETED

```typescript
type RuntimeJsonNullability = "required" | "nullable";

interface RuntimeJsonColumnPolicy {
  readonly tableName: string;
  readonly columnName: string;
  readonly nullability: RuntimeJsonNullability;
}

function requiredJsonTextColumn(columnName: string): string;
function nullableJsonTextColumn(columnName: string): string;
```

**Checklist**:

- [x] Add reusable schema helpers or constants for required and nullable JSON
      text constraints.
- [x] Update base runtime create-table SQL for `sessions`, `node_executions`,
      `node_logs`, `llm_session_messages`, `workflow_messages`, and
      `runtime_schema_metadata`.
- [x] Update `workflow_messages` rebuild SQL to recreate all JSON checks before
      copying rows.
- [x] Add JSON checks to nullable JSON columns introduced through
      `ALTER TABLE ... ADD COLUMN` when SQLite accepts that migration shape.
- [x] Preserve explicit migration failure when copied historical data is
      malformed.

### 2. Event Runtime Extension Constraints

#### packages/rielflow/src/workflow/runtime-db/schema-and-record-types.ts
#### packages/rielflow/src/workflow/runtime-db/event-records.ts
#### packages/rielflow/src/workflow/runtime-db/supervisor-records.ts

**Status**: COMPLETED

```typescript
interface EventRuntimeJsonConstraintCoverage {
  readonly eventReplyDispatches: {
    readonly requestJson: "required";
    readonly responseJson: "nullable";
  };
  readonly hookEvents: {
    readonly payloadRefJson: "nullable";
    readonly responseJson: "nullable";
  };
  readonly eventSupervisorCommands: {
    readonly argsJson: "nullable";
    readonly resultJson: "required";
  };
  readonly workflowSchedules: {
    readonly workflowSourceJson: "nullable";
    readonly workflowInputJson: "required";
  };
  readonly supervisorConversations: {
    readonly selectedManagedRunIdsByWorkflowKeyJson: "nullable";
  };
  readonly supervisorDispatchDecisions: {
    readonly proposalJson: "required";
    readonly resultSummaryJson: "nullable";
  };
}
```

**Checklist**:

- [x] Add JSON checks to event extension create-table SQL.
- [x] Keep event row serialization APIs unchanged while relying on SQLite to
      reject malformed direct writes.
- [x] Update existing extension migrations, including `args_json`, so new
      nullable JSON columns are constrained.
- [x] Add a rebuild migration only where existing extension tables require
      constraint replacement rather than nullable column addition.

### 3. Manager Control-Plane Constraints

#### packages/rielflow/src/workflow/manager-session-store.ts
#### packages/rielflow/src/workflow/manager-session-store.test.ts

**Status**: COMPLETED

```typescript
interface ManagerControlPlaneJsonConstraintCoverage {
  readonly managerMessagesParsedIntentJson: "required";
  readonly idempotentMutationsResponseJson: "required";
}

interface ManagerSessionStoreSchemaMigration {
  readonly rebuildsManagerMessagesWhenJsonChecksMissing: boolean;
  readonly rebuildsIdempotentMutationsWhenJsonChecksMissing: boolean;
  readonly malformedHistoricalRowsFailExplicitly: boolean;
}
```

**Checklist**:

- [x] Add `CHECK(json_valid(parsed_intent_json))` to `manager_messages`.
- [x] Add `CHECK(json_valid(response_json))` to `idempotent_mutations`.
- [x] Add focused migration handling for older manager-session tables that lack
      checks.
- [x] Preserve auth-token, control-mode, and idempotency semantics.

### 4. Schema And Migration Tests

#### packages/rielflow/src/workflow/runtime-db.test.ts
#### packages/rielflow/src/workflow/manager-session-store.test.ts
#### packages/rielflow/src/workflow/communication-service.test.ts

**Status**: COMPLETED

```typescript
interface JsonConstraintTestCase {
  readonly tableName: string;
  readonly columnName: string;
  readonly nullability: RuntimeJsonNullability;
  readonly validJsonAccepted: boolean;
  readonly malformedJsonRejected: boolean;
  readonly nullAcceptedWhenNullable: boolean;
}

function expectSqliteJsonCheckRejection(action: () => unknown): void;
```

**Checklist**:

- [x] Test malformed required `workflow_messages` JSON columns are rejected.
- [x] Test malformed nullable `workflow_messages` JSON columns are rejected when
      non-null.
- [x] Test nullable `workflow_messages` JSON columns accept `NULL`.
- [x] Test valid JSON remains accepted for all constrained message JSON columns.
- [x] Test the `workflow_messages` rebuild migration preserves JSON checks.
- [x] Test representative non-message runtime JSON direct inserts are rejected.
- [x] Test manager control-plane JSON columns reject malformed direct inserts.

### 5. Documentation And Progress Updates

#### impl-plans/completed/sqlite-runtime-json-checks.md
#### impl-plans/README.md
#### impl-plans/PROGRESS.json

**Status**: COMPLETED

```typescript
interface SqliteRuntimeJsonChecksProgressEntry {
  readonly workflowMode: "issue-resolution";
  readonly issueReference: "github-pr:54";
  readonly completedTasks: readonly string[];
  readonly verificationCommands: readonly string[];
  readonly residualRisks: readonly string[];
}
```

**Checklist**:

- [x] Update task/module status as implementation progresses.
- [x] Add a progress-log entry for each implementation session.
- [x] Keep issue references, workflow mode, file paths, and verification
      commands explicit.
- [x] Refresh user-facing docs only if implementation changes operator-visible
      runtime DB behavior beyond the accepted design text.

## Task Breakdown

### TASK-001: JSON Column Audit And Constraint Helpers

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `packages/rielflow/src/workflow/runtime-db/schema-and-record-types.ts`, `packages/rielflow/src/workflow/runtime-db/json-schema-constraints.ts`, `packages/rielflow/src/workflow/runtime-db/message-types.ts`
**Dependencies**: None

**Description**:
Audit runtime SQLite JSON text columns against the accepted design and introduce
small schema helpers or constants so required and nullable JSON checks are
spelled consistently.

**Completion Criteria**:

- [x] Every rielflow-owned runtime JSON text column is classified as required or
      nullable.
- [x] Non-JSON text columns are explicitly left unconstrained.
- [x] Schema helper output matches `CHECK(json_valid(column))` and
      `CHECK(column IS NULL OR json_valid(column))`.

### TASK-002: Base Runtime Schema And Migration Constraints

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/workflow/runtime-db/schema-and-record-types.ts`, `packages/rielflow/src/workflow/runtime-db/json-schema-constraints.ts`
**Dependencies**: TASK-001

**Description**:
Apply JSON checks to base runtime schema creation and migration paths, with
mandatory coverage for `workflow_messages` create and rebuild SQL.

**Completion Criteria**:

- [x] Base create-table SQL constrains `queue_json`, `supervision_json`,
      `history_imports_json`, `input_json`, `output_json`,
      `output_validation_errors_json`, `payload_json`, `raw_message_json`, and
      all `workflow_messages` JSON columns.
- [x] `workflow_messages` rebuild SQL recreates the same constraints before
      copying rows.
- [x] Existing nullable-column migrations add JSON checks where supported.
- [x] Malformed historical rows fail migration explicitly.

### TASK-003: Event Runtime Extension Constraints

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/workflow/runtime-db/schema-and-record-types.ts`, `packages/rielflow/src/workflow/runtime-db/json-schema-constraints.ts`
**Dependencies**: TASK-001

**Description**:
Apply the same JSON policy to event runtime extension tables used for replies,
hooks, event supervision, schedules, and supervisor conversations.

**Completion Criteria**:

- [x] Event extension create-table SQL constrains all JSON text columns listed
      in the design.
- [x] Extension migrations preserve or add JSON checks for new JSON columns.
- [x] Representative event/supervisor direct-insert tests reject malformed JSON.

### TASK-004: Manager Control-Plane Constraints

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/workflow/manager-session-store.ts`, `packages/rielflow/src/workflow/runtime-db/json-schema-constraints.ts`
**Dependencies**: TASK-001

**Description**:
Constrain manager control-plane JSON columns in the manager session store and
support older tables that lack the constraints.

**Completion Criteria**:

- [x] `manager_messages.parsed_intent_json` is required valid JSON.
- [x] `idempotent_mutations.response_json` is required valid JSON.
- [x] Legacy manager-session tables with valid JSON continue to load.
- [x] Legacy manager-session tables with malformed JSON fail explicitly.

### TASK-005: Focused Test Coverage

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/workflow/runtime-db.test.ts`, `packages/rielflow/src/workflow/manager-session-store.test.ts`, `packages/rielflow/src/workflow/communication-service.test.ts`
**Dependencies**: TASK-002, TASK-003, TASK-004

**Description**:
Add focused schema, migration, and direct-write tests that prove SQLite rejects
malformed JSON while accepting valid JSON and nullable `NULL` values.

**Completion Criteria**:

- [x] Required `workflow_messages` JSON malformed inserts throw.
- [x] Nullable `workflow_messages` JSON malformed non-null inserts throw.
- [x] Nullable `workflow_messages` JSON `NULL` inserts succeed.
- [x] Rebuild migration preserves checks.
- [x] Representative non-message runtime and manager JSON columns reject
      malformed direct writes.

### TASK-006: Plan, Progress, And Verification Handoff

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `impl-plans/completed/sqlite-runtime-json-checks.md`, `impl-plans/README.md`, `impl-plans/PROGRESS.json`
**Dependencies**: TASK-005

**Description**:
Update the implementation plan status, progress log, and verification evidence
after implementation.

**Completion Criteria**:

- [x] Plan task statuses reflect implementation state.
- [x] `impl-plans/PROGRESS.json` remains valid JSON.
- [x] Progress log records commands run, results, and any residual risks.

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Runtime JSON constraint surface | `packages/rielflow/src/workflow/runtime-db/schema-and-record-types.ts`, `packages/rielflow/src/workflow/runtime-db/json-schema-constraints.ts`, `packages/rielflow/src/workflow/runtime-db/message-types.ts` | COMPLETED | `runtime-db.test.ts` |
| Event runtime extension constraints | `packages/rielflow/src/workflow/runtime-db/schema-and-record-types.ts`, `packages/rielflow/src/workflow/runtime-db/json-schema-constraints.ts` | COMPLETED | `runtime-db.test.ts` |
| Manager control-plane constraints | `packages/rielflow/src/workflow/manager-session-store.ts`, `packages/rielflow/src/workflow/runtime-db/json-schema-constraints.ts` | COMPLETED | `manager-session-store.test.ts` |
| Communication write boundary | `packages/rielflow/src/workflow/communication-service.test.ts` | VERIFIED_UNCHANGED | `communication-service.test.ts` |
| Plan/progress tracking | `impl-plans/completed/sqlite-runtime-json-checks.md` | COMPLETED | `jq '.' impl-plans/PROGRESS.json` |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| JSON column audit | Accepted Step 3 design | COMPLETED |
| Base runtime constraints | JSON column audit | COMPLETED |
| Event runtime constraints | JSON column audit | COMPLETED |
| Manager control-plane constraints | JSON column audit | COMPLETED |
| Focused tests | Base, event, and manager constraints | COMPLETED |
| Progress handoff | Focused tests and verification | COMPLETED |

## Parallelizable Tasks

- `TASK-001` is standalone audit/helper work.
- After `TASK-001`, `TASK-004` may run in parallel with `TASK-002` or
  `TASK-003` because it writes
  `manager-session-store.ts` while `TASK-002` and `TASK-003` write runtime DB
  schema files.
- `TASK-002` and `TASK-003` are not marked parallelizable because both edit
  `schema-and-record-types.ts`.
- `TASK-005` and `TASK-006` are sequential verification and handoff tasks.

## Verification Plan

Run after implementation:

```bash
bun run typecheck
bun test packages/rielflow/src/workflow/runtime-db.test.ts
bun test packages/rielflow/src/workflow/manager-session-store.test.ts
bun test packages/rielflow/src/workflow/communication-service.test.ts
bun test packages/rielflow/src/workflow/runtime-db.test.ts -t "JSON"
bun test packages/rielflow/src/workflow/manager-session-store.test.ts -t "JSON"
jq '.' impl-plans/PROGRESS.json
git diff --check
git status --short
```

Focused assertions:

- `workflow_messages.delivery_attempt_ids_json` rejects malformed JSON.
- `workflow_messages.payload_ref_json` rejects malformed JSON.
- `workflow_messages.payload_json` rejects malformed non-null JSON and accepts
  `NULL`.
- `workflow_messages.artifact_refs_json` rejects malformed non-null JSON and
  accepts `NULL`.
- The `workflow_messages` rebuild migration recreates JSON checks before copying
  rows.
- Representative non-message runtime JSON columns reject malformed direct
  inserts.
- Manager `parsed_intent_json` and idempotent `response_json` reject malformed
  direct inserts.

## Completion Criteria

- [x] All in-scope runtime JSON text columns are constrained in create-table SQL.
- [x] Existing migration paths preserve or add JSON constraints where needed.
- [x] Malformed JSON direct writes fail through SQLite constraints.
- [x] Valid JSON and nullable `NULL` cases continue to work.
- [x] Focused tests and type checks pass.
- [x] Plan progress log and `impl-plans/PROGRESS.json` are updated.

## Progress Log

### Session: 2026-06-07 15:00 JST

**Tasks Completed**: Plan creation
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Created from Step 3 accepted design for PR #54. Step 5 feedback is
not present for this first Step 4 run.

### Session: 2026-06-07 15:10 JST

**Tasks Completed**: Self-review cleanup
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Corrected `TASK-004` task-level parallelizability to `No` because it
depends on `TASK-001`; kept the scheduling note that it can run alongside
runtime schema tasks after the shared audit is complete.

### Session: 2026-06-07 17:21 JST

**Workflow Mode**: `issue-resolution`
**Workflow ID**: `codex-design-and-implement-review-loop`
**Node**: `step6-implement`
**Issue Reference**: PR #54,
`https://github.com/tacogips/rielflow/pull/54`
**Codex-Agent Reference**: `codex-agent / gpt-5.5` execution provider only;
SQLite JSON validation remains rielflow-owned runtime DB behavior.
**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006
**Tasks In Progress**: None
**Blockers**: None
**Changed Files**:
`packages/rielflow/src/workflow/runtime-db/json-schema-constraints.ts`,
`packages/rielflow/src/workflow/runtime-db/message-types.ts`,
`packages/rielflow/src/workflow/runtime-db/schema-and-record-types.ts`,
`packages/rielflow/src/workflow/manager-session-store.ts`,
`packages/rielflow/src/workflow/runtime-db.test.ts`,
`packages/rielflow/src/workflow/manager-session-store.test.ts`,
`impl-plans/active/sqlite-runtime-json-checks.md`,
`impl-plans/README.md`, `impl-plans/PROGRESS.json`.
**Verification Commands**:
`bun run typecheck`; `bun run lint:biome`;
`bun test packages/rielflow/src/workflow/runtime-db.test.ts`;
`bun test packages/rielflow/src/workflow/manager-session-store.test.ts`;
`bun test packages/rielflow/src/workflow/communication-service.test.ts`;
`bun test packages/rielflow/src/workflow/runtime-db.test.ts -t "JSON|json"`;
`bun test packages/rielflow/src/workflow/manager-session-store.test.ts -t "JSON|json"`.
**Notes**: Added deterministic SQLite JSON constraint helpers and rebuild
migrations for base runtime, event runtime extension, and manager control-plane
JSON TEXT columns. Rebuild copy uses a prepared `INSERT ... SELECT` inside a
transaction so malformed historical JSON fails explicitly before the source
table is dropped.

### Session: 2026-06-07 17:26 JST

**Workflow Mode**: `issue-resolution`
**Workflow ID**: `codex-design-and-implement-review-loop`
**Node**: `step6-implement-self-review`
**Issue Reference**: PR #54,
`https://github.com/tacogips/rielflow/pull/54`
**Codex-Agent Reference**: `codex-agent / gpt-5.5` execution provider only.
**Tasks Completed**: TASK-005 self-review correction
**Tasks In Progress**: None
**Blockers**: None
**Verification Commands**:
`bun test packages/rielflow/src/workflow/runtime-db.test.ts -t "JSON|json"`;
`bun test packages/rielflow/src/workflow/runtime-db.test.ts`;
`bun run lint:biome`; `bun run typecheck`.
**Notes**: Fixed the workflow_messages nullable JSON test helper so
`payloadJson: null` stores and asserts `payload_json IS NULL` instead of falling
back to the default valid JSON payload.

### Session: 2026-06-07 17:36 JST

**Workflow Mode**: `issue-resolution`
**Workflow ID**: `codex-design-and-implement-review-loop`
**Node**: `step6-implement`
**Issue Reference**: PR #54,
`https://github.com/tacogips/rielflow/pull/54`
**Codex-Agent Reference**: `codex-agent / gpt-5.5` execution provider only.
**Review Decision Addressed**: `step7-adversarial-review`
`reviewDecision=needs_revision`
**Tasks Completed**: TASK-002, TASK-005, TASK-006 adversarial-review fix
**Tasks In Progress**: None
**Blockers**: None
**Verification Commands**:
`bun run typecheck`; `bun run lint:biome`;
`bun test packages/rielflow/src/workflow/runtime-db.test.ts`;
`bun test packages/rielflow/src/workflow/manager-session-store.test.ts`;
`bun test packages/rielflow/src/workflow/communication-service.test.ts`;
`bun test packages/rielflow/src/workflow/runtime-db.test.ts -t "legacy workflow_messages|JSON|json"`.
**Notes**: Replaced the legacy `workflow_messages.compat_artifact_dir` rebuild
multi-statement `db.exec` copy with a transaction and prepared `INSERT ...
SELECT`. Added a malformed legacy compat regression proving migration fails
explicitly and preserves the original `workflow_messages` table and row when
JSON checks reject copied data. Extended the valid legacy rebuild test to assert
row count, payload JSON, artifact refs, and artifact directory are preserved.

### Session: 2026-06-07 17:48 JST

**Workflow Mode**: `issue-resolution`
**Workflow ID**: `codex-design-and-implement-review-loop`
**Node**: `step8-impl-plan-completion-check`
**Issue Reference**: PR #54,
`https://github.com/tacogips/rielflow/pull/54`
**Codex-Agent Reference**: `codex-agent / gpt-5.5` execution provider only.
**Review Decisions Checked**: `step7-review`
`reviewDecision=accepted_requires_adversarial_review`;
`step7-adversarial-review` `reviewDecision=accepted`; `step8-docs-refresh`
`step8Decision=docs_refreshed`.
**Tasks Completed**: Plan archival after accepted implementation and docs
refresh.
**Tasks In Progress**: None
**Blockers**: None
**Archive Move**:
`impl-plans/active/sqlite-runtime-json-checks.md` to
`impl-plans/completed/sqlite-runtime-json-checks.md`.
**Verification Commands**:
`jq '.latestOutputs[] | select(.payload.implPlanPaths or .payload.reviewedFiles or .payload.documentationFiles)' "$RIEL_MAILBOX_DIR/inbox/input.json"`;
`rg -n 'sqlite-runtime-json-checks|IMPLEMENTED_AWAITING_REVIEW|Implemented - Awaiting Review' impl-plans/PROGRESS.json impl-plans/README.md impl-plans/completed/sqlite-runtime-json-checks.md`;
`jq '.' impl-plans/PROGRESS.json >/dev/null`; `git diff --check`.
**Notes**: Completion check found all TASK-001 through TASK-006 checklists
complete, Step 7 and adversarial review accepted, and Step 8 docs refreshed.
The plan was removed from active indexes and added to recently completed
indexes.
