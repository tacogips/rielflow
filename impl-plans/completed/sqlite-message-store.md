# SQLite Message Store PR #54 Review Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-sqlite-message-store.md; design-docs/specs/command.md#environment-variables; design-docs/specs/design-node-mailbox.md
**Created**: 2026-06-06
**Last Updated**: 2026-06-07

## Design Document Reference

The accepted design source of truth is
`design-docs/specs/design-sqlite-message-store.md`, accepted by Step 3 with no
high or mid findings. This plan handles PR #54 issue-resolution review for the
`feature/sqlite-message-store` branch at commit
`649c48402a8d73d13b895c99ce9ad9c6f72de43f`.

The implementation step must review the current PR surface first. Code changes
are required only when review finds high or medium correctness, path-safety,
GraphQL/manager, replay/retry, workflow-continuation, documentation, or test
gaps.

Included:

- SQLite-only workflow communication reads and writes through
  `workflow_messages`
- attachment-root-relative file references stored in SQLite
- workflow/run-scoped attachment materialization and cleanup
- GraphQL communication list/detail and manager-control consistency
- replay, retry, consumed-state, and failed-workflow continuation behavior
- focused deterministic verification plus credential-safe smoke evidence when
  available
- documentation and plan/progress updates required by the review

Excluded:

- backward compatibility with old file-backed message artifacts
- storing file or binary payload bodies in SQLite
- changing manager-owned communication id allocation outside the SQLite-aware
  allocation needed to avoid stale-counter collisions with existing
  `workflow_messages` rows
- adding new storage environment variables or retention policy
- committing credentials, private live-smoke content, or assistant attribution

## Issue And Reference Traceability

- Workflow mode: `issue-resolution`
- Workflow ID: `codex-design-and-implement-review-loop`
- Node: `step4-impl-plan-create`
- Issue reference: GitHub PR #54,
  `https://github.com/tacogips/rielflow/pull/54`
- Branch: `feature/sqlite-message-store`
- Base: `main`
- Head commit under review:
  `649c48402a8d73d13b895c99ce9ad9c6f72de43f`

Codex-agent references:

- Branch: `feature/sqlite-message-store`
- PR: `https://github.com/tacogips/rielflow/pull/54`
- Commit under review: `649c484 Persist workflow communications in sqlite`
- Prior verification: `bun run typecheck`; focused
  SQLite/GraphQL/communication/manager tests; path tests; failed workflow
  continuation test; all 30 example workflows validate/inspect; 22 direct
  example mock scenarios; live Telegram and Discord gateway smoke completed
  without exposing credentials

Intentional divergences accepted in the design:

- legacy file-backed message artifacts are intentionally ignored by canonical
  communication reads
- session communication arrays may exist as transient engine state, but are not
  a fallback message source
- SQLite stores JSON-compatible snapshots and attachment references, not
  file/binary payload bodies
- Cursor CLI and codex-agent adapter behavior are unchanged by this feature

## Task Breakdown

### TASK-001: Branch And Prior Evidence Review

**Status**: COMPLETED
**Parallelizable**: false

Files:

- `impl-plans/active/sqlite-message-store.md`
- `impl-plans/PROGRESS.json`
- `design-docs/specs/design-sqlite-message-store.md`

```typescript
type ReviewSeverity = "high" | "mid" | "low" | "none";

interface SqliteMessageStoreReviewFinding {
  readonly severity: ReviewSeverity;
  readonly filePath: string;
  readonly line?: number;
  readonly issue: string;
  readonly impact: string;
  readonly recommendedAction: string;
}

interface SqliteMessageStoreReviewDecision {
  readonly workflowMode: "issue-resolution";
  readonly issueReference: "github-pr:54";
  readonly branch: "feature/sqlite-message-store";
  readonly headCommit: "649c48402a8d73d13b895c99ce9ad9c6f72de43f";
  readonly implementationRequired: boolean;
  readonly findings: readonly SqliteMessageStoreReviewFinding[];
}
```

Deliverables:

- Record the PR review decision and findings in the progress log.
- Confirm whether local changes are design/plan-only or whether code fixes are
  required.
- Preserve unrelated user or workflow changes.

Verification:

- `git status --short --branch`
- `git diff --name-only main...HEAD`
- `git diff --check`

### TASK-002: Runtime DB And Communication Service Review/Fixes

**Status**: COMPLETED
**Parallelizable**: false
**Depends On**: TASK-001

Files:

- `packages/rielflow/src/workflow/runtime-db.ts`
- `packages/rielflow/src/workflow/runtime-db/schema-and-record-types.ts`
- `packages/rielflow/src/workflow/runtime-db/workflow-message-records.ts`
- `packages/rielflow/src/workflow/runtime-db/session-query-records.ts`
- `packages/rielflow/src/workflow/communication-service.ts`

```typescript
interface WorkflowMessagePersistenceExpectation {
  readonly oneRowPerCommunicationId: true;
  readonly sqliteWriteRequiredBeforeDeliverySuccess: true;
  readonly defaultDbPathUnderUserArtifacts: true;
  readonly runtimeDbEnvOverride: true;
  readonly artifactDirDefaultDbColocation: true;
  readonly failedSqliteWriteBlocksPublication: true;
  readonly inboundReadsFilterByToNodeId: true;
  readonly outboundReadsFilterByFromNodeId: true;
  readonly inboundReadsUseCreatedAtOrderingIndex: true;
  readonly jsonColumnsStoredAsTextWithoutGeneralFieldPromotion: true;
  readonly queriedJsonKeysMayBeDuplicatedAsTypedColumns: true;
  readonly metadataTableTracksSchemaVersion: true;
  readonly futurePhysicalTablesUseVersionSuffixes: true;
  readonly noLegacyFileFallback: true;
  readonly noSessionArrayFallback: true;
}
```

Deliverables:

- Prove reads, writes, list/detail, consumption, replay source lookup, and retry
  updates use `workflow_messages`.
- Verify default SQLite placement under `~/.rielflow/artifacts/rielflow.db`.
- Verify `RIEL_RUNTIME_DB` overrides only the SQLite database path.
- Verify `RIEL_ARTIFACT_DIR` co-locates files and the default database when
  `RIEL_RUNTIME_DB` is not set.
- Verify failed SQLite writes block new message publication and do not mark
  delivery as successful.
- Add/verify a SQLite index for inbound message listing ordered by
  `created_at, communication_id`, because the existing
  `(workflow_execution_id, to_node_id, status)` index does not cover the
  `listWorkflowMessagesFromRuntimeDb({ workflowExecutionId, toNodeId })`
  query shape or its canonical ordering.
- Preserve efficient whole-run timeline and outbound list ordering by keeping
  `workflow_execution_id` leading and including order columns in message list
  indexes where needed.
- Document and implement the JSON-column policy: `*_json` columns are SQLite
  `TEXT` containing canonical JSON strings; do not promote arbitrary JSON
  fields into table fields. Only keys required for filtering, ordering,
  joining, or stable inspection may be duplicated as ordinary typed columns
  while remaining in the canonical JSON text.
- Add a runtime metadata table that stores the active schema version and
  migration metadata before future large schema changes depend on it.
- Define the forward migration policy for large schema changes: create a new
  database, create the new schema, migrate old table data, validate migrated
  invariants and counts, then atomically switch or replace the runtime database.
- Define the forward naming policy for new large schema generations: physical
  SQLite tables carry a version suffix such as `workflow_messages_v1`, while
  runtime repository methods keep logical names and read the active physical
  table names from metadata.
- Fix any fallback to legacy communication files or session-only communication
  arrays.
- Fix row cardinality, status, or delivery-attempt bugs only if review finds
  them.

Verification:

- `bun test packages/rielflow/src/workflow/runtime-db.test.ts packages/rielflow/src/workflow/communication-service.test.ts`
- `bun test packages/rielflow/src/workflow/runtime-db.test.ts -t "workflow message indexes|inbound message listing index"`
- `bun test packages/rielflow/src/workflow/runtime-db.test.ts -t "runtime metadata schema version|json column constraints|versioned table metadata"`
- `bun test packages/rielflow/src/workflow/runtime-db.test.ts -t "runtime database placement|RIEL_RUNTIME_DB|RIEL_ARTIFACT_DIR|failed SQLite writes block message publication"`
- `bun test packages/rielflow/src/workflow/communication-service.test.ts -t "failed SQLite writes block message publication|no legacy file fallback|no session array fallback"`

### TASK-003: Attachment Path Scope Review/Fixes

**Status**: COMPLETED
**Parallelizable**: false
**Depends On**: TASK-001

Files:

- `packages/rielflow/src/workflow/message-attachment-paths.ts`
- `packages/rielflow-core/src/paths.ts`
- `packages/rielflow/src/workflow/engine/mailbox-communication-artifacts.ts`
- `packages/rielflow/src/workflow/manager-message-service/artifacts.ts`
- `packages/rielflow/src/workflow/history.ts`

```typescript
interface AttachmentPathScopeExpectation {
  readonly pathBase: "attachment-root";
  readonly pathShape: "{workflowId}/{workflowRunId}/messages/{communicationId}/{relativePath}";
  readonly attachmentRootEnvOverride: true;
  readonly rejectsAbsolutePaths: true;
  readonly rejectsTraversal: true;
  readonly storesOnlyPathReferencesInSqlite: true;
  readonly cleanupUsesWorkflowScopedAttachmentRoot: true;
}
```

Deliverables:

- Verify attachment refs are normalized under workflow/run-scoped attachment
  roots.
- Verify `RIEL_ATTACHMENT_ROOT` overrides only the file/binary message root and
  keeps persisted SQLite refs attachment-root-relative.
- Fix absolute path, traversal, stale root, or cleanup gaps if found.
- Keep file and binary bodies out of SQLite.

Verification:

- `bun test packages/rielflow/src/workflow/paths.test.ts`
- `bun test packages/rielflow/src/workflow/paths.test.ts -t "RIEL_ATTACHMENT_ROOT|attachment-root-relative|path traversal"`
- focused attachment assertions in runtime-db, communication, and manager tests

### TASK-004: GraphQL, Manager, Replay, Retry, And Continuation Review/Fixes

**Status**: COMPLETED
**Parallelizable**: false
**Depends On**: TASK-002, TASK-003

Files:

- `packages/rielflow/src/graphql/schema/execution-resolvers.ts`
- `packages/rielflow/src/workflow/manager-message-service.ts`
- `packages/rielflow/src/workflow/engine/step-input.ts`
- `packages/rielflow/src/workflow/engine/step-result-finalization.ts`
- `packages/rielflow/src/workflow/engine.test.ts`
- `packages/rielflow/src/graphql/schema.test.ts`

```typescript
interface CommunicationViewConsistencyExpectation {
  readonly graphqlListFromWorkflowMessages: true;
  readonly graphqlDetailFromWorkflowMessages: true;
  readonly managerReplaySelectsSqliteSourceRow: true;
  readonly retryUpdatesExistingSqliteRow: true;
  readonly failedWorkflowContinuationReadsMiddleStepInputsFromSqlite: true;
}
```

Deliverables:

- Verify GraphQL and manager-control surfaces synthesize views from SQLite
  records.
- Verify replay creates a new communication row and retry updates delivery
  attempts on the existing row.
- Verify failed workflow continuation after definition repair does not depend
  on legacy message files.
- Fix only defects found in those surfaces.

Verification:

- `bun test packages/rielflow/src/graphql/schema.test.ts packages/rielflow/src/workflow/manager-message-service.test.ts`
- `bun test packages/rielflow/src/workflow/paths.test.ts packages/rielflow/src/workflow/engine.test.ts -t "continues from a failed workflow after the workflow definition is fixed"`

### TASK-005: Documentation, Examples, And Credential-Safe Evidence

**Status**: COMPLETED
**Parallelizable**: true
**Depends On**: TASK-001

Files:

- `README.md`
- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`
- `design-docs/specs/design-node-mailbox.md`
- `examples/recent-change-quality-loop/mock-scenario.json`

```typescript
interface SqliteMessageStoreDocumentationExpectation {
  readonly documentsDefaultDbPath: true;
  readonly documentsRuntimeDbOverride: true;
  readonly documentsArtifactDirColocation: true;
  readonly documentsAttachmentRootOverride: true;
  readonly documentsNoLegacyMessageFallback: true;
  readonly excludesCredentialsAndPrivateSmokeContent: true;
}
```

Deliverables:

- Verify user-facing docs match the accepted SQLite-only behavior.
- Update docs/examples only when code review reveals stale or misleading
  behavior descriptions.
- Record live smoke evidence only as redacted status, never as credential or
  private conversation content.

Verification:

- `git diff --check -- README.md design-docs/specs/architecture.md design-docs/specs/command.md design-docs/specs/design-node-mailbox.md examples/recent-change-quality-loop/mock-scenario.json`

### TASK-006: Final Verification, Commit, And Push Decision

**Status**: COMPLETED
**Parallelizable**: false
**Depends On**: TASK-002, TASK-003, TASK-004, TASK-005

Files:

- all touched implementation, test, documentation, and plan files

```typescript
interface FinalReviewHandoff {
  readonly focusedTestsPass: true;
  readonly typecheckPasses: true;
  readonly diffCheckPasses: true;
  readonly noHighOrMidFindingsRemain: true;
  readonly commitAndPushOnlyWhenFixesMade: true;
  readonly credentialsExcludedFromOutputAndCommits: true;
}
```

Deliverables:

- Run focused verification after any fixes.
- If no code/doc fixes are required, return a review decision without a commit.
- If fixes are made, commit and push to `feature/sqlite-message-store` with no
  assistant attribution.
- Update this progress log with findings, fixes, verification, and commit/push
  status.

Verification:

- `git diff --check`
- `bun run typecheck`
- `bun test packages/rielflow/src/workflow/runtime-db.test.ts packages/rielflow/src/workflow/communication-service.test.ts packages/rielflow/src/workflow/manager-message-service.test.ts packages/rielflow/src/graphql/schema.test.ts`
- `bun test packages/rielflow/src/workflow/runtime-db.test.ts -t "runtime database placement|RIEL_RUNTIME_DB|RIEL_ARTIFACT_DIR|failed SQLite writes block message publication"`
- `bun test packages/rielflow/src/workflow/communication-service.test.ts -t "failed SQLite writes block message publication|no legacy file fallback|no session array fallback"`
- `bun test packages/rielflow/src/workflow/paths.test.ts`
- `bun test packages/rielflow/src/workflow/paths.test.ts -t "RIEL_ATTACHMENT_ROOT|attachment-root-relative|path traversal"`
- `bun test packages/rielflow/src/workflow/paths.test.ts packages/rielflow/src/workflow/engine.test.ts -t "continues from a failed workflow after the workflow definition is fixed"`
- validate and inspect all 30 top-level example workflows when runtime-facing
  behavior changes
- run 22/22 direct example mock scenarios when runtime-facing behavior changes

## Module Status

| Task | Scope | Status | Tests |
| ---- | ----- | ------ | ----- |
| TASK-001 | Branch and prior evidence review | COMPLETED | git status/diff checks |
| TASK-002 | Runtime DB and communication service | COMPLETED | runtime-db, communication-service |
| TASK-003 | Attachment path scope | COMPLETED | paths and attachment assertions |
| TASK-004 | GraphQL, manager, replay, retry, continuation | COMPLETED | GraphQL, manager, engine focused tests |
| TASK-005 | Documentation, examples, credential-safe evidence | COMPLETED | diff checks |
| TASK-006 | Final verification, commit, push decision | COMPLETED | typecheck, focused tests, examples as needed |

## Dependencies

| Task | Depends On | Parallelizable |
| ---- | ---------- | -------------- |
| TASK-001 | none | no |
| TASK-002 | TASK-001 | no |
| TASK-003 | TASK-001 | no |
| TASK-004 | TASK-002, TASK-003 | no |
| TASK-005 | TASK-001 | yes, after finding record only |
| TASK-006 | TASK-002, TASK-003, TASK-004, TASK-005 | no |

TASK-005 is the only parallelizable task, and only when its writer limits edits
to docs/examples while another worker edits runtime code. TASK-002, TASK-003,
and TASK-004 are intentionally serialized because their write scopes share
runtime contracts and test fixtures.

## Completion Criteria

- [x] PR #54 review findings are explicitly recorded.
- [x] No high or medium findings remain for SQLite persistence, attachment
      scope, GraphQL/manager communication views, replay/retry, or failed
      workflow continuation.
- [x] Runtime validation explicitly covers default DB placement,
      `RIEL_RUNTIME_DB`, `RIEL_ARTIFACT_DIR`, `RIEL_ATTACHMENT_ROOT`, and
      failed SQLite-write publication blocking.
- [x] `workflow_messages` indexes cover canonical message list queries,
      including inbound `to_node_id` reads ordered by `created_at,
      communication_id`.
- [x] SQLite runtime schema has metadata for active schema version and future
      database-wide migrations.
- [x] Design and plan record that JSON columns use `TEXT` canonical JSON and
      avoid general JSON-field promotion; only query-critical keys may also
      exist as ordinary typed columns.
- [x] Design and plan record that future large schema generations use
      versioned physical table names and migrate by creating a new database.
- [x] New communication behavior has no legacy message-file or session-array
      fallback.
- [x] Attachment refs are workflow/run scoped, attachment-root relative, and
      traversal-safe.
- [x] Focused tests and typecheck pass after fixes, or unavailable checks are
      recorded with concrete reasons.
- [x] Credentials and private live-smoke content are absent from output,
      artifacts intended for commit, and commits.
- [x] If fixes are made, commit and push are deferred to the workflow-owned
      commit-message and VCS handoff steps for `feature/sqlite-message-store`.

## Progress Log

| Date | Session | Status | Notes |
| ---- | ------- | ------ | ----- |
| 2026-06-06 | step4-impl-plan-create exec-000009 | Ready | Created original plan from accepted design. |
| 2026-06-06 | step6-implement exec-000012..000021 | Completed | Implemented SQLite message schema, row helpers, attachment path normalization, required message writes, replay/retry/consume updates, GraphQL integration, docs, and focused tests. |
| 2026-06-06 | manual follow-up | Completed | User clarified that backward compatibility is not required. Stopped the compatibility-oriented workflow run and removed session/file fallback behavior from communication service, GraphQL, manager replay validation, docs, and tests. Focused tests passed. |
| 2026-06-07 | step4-impl-plan-create exec-000006 | Ready | Revised plan for PR #54 review/improvement pass after Step 3 accepted the design update with no high or mid findings. Next implementation step must review current PR behavior first, then fix only verified high or medium findings. |
| 2026-06-07 | step4-impl-plan-create exec-000009 | Ready | Addressed Step 5 mid finding by making runtime DB placement, `RIEL_RUNTIME_DB`, `RIEL_ARTIFACT_DIR`, `RIEL_ATTACHMENT_ROOT`, and failed SQLite-write publication blocking explicit in TASK-002, TASK-003, TASK-006, and completion criteria. |
| 2026-06-07 | step6-implement exec-000012 | Completed | Found one mid verification gap: Step 5 accepted focused `-t` filters matched no tests. Added/renamed deterministic tests for runtime DB placement, failed SQLite-write publication blocking, no legacy/session fallback, and attachment-root/path traversal coverage. Focused tests, broader SQLite/GraphQL/manager tests, paths tests, failed-continuation test, typecheck, Biome, and diff check passed. No high or medium findings remain. Commit/push is deferred to the workflow commit steps. |
| 2026-06-07 | step6-implement rerun exec-000015 | Completed | Addressed Step 7 mid findings by keeping replayed communications in transient `session.communications` for engine input assembly until that path reads SQLite directly, handling existing `attachment-root` refs during replay/save by copying them into the new communication scope, and adding focused regression coverage for replay-plus-retry and replayed attachment-root refs. Focused tests, typecheck, Biome, diff check, and 30/30 example validate/inspect checks passed. Direct mock-scenario sweep was attempted and blocked on `examples/discord-codex-chat` with `output validation failed for step 'send-discord-reply'`. |
| 2026-06-07 | step6-implement rerun exec-000019 | Completed | Addressed adversarial Step 7 high finding by rejecting existing `attachment-root` refs whose path is outside the current workflow execution before stat/copy. Added focused regression coverage for cross-workflow and cross-run `attachment-root` refs while retaining same-run replay behavior. Focused runtime-db tests, broader SQLite/GraphQL/communication/manager tests, typecheck, Biome, JSON validation, and diff check passed. |
| 2026-06-07 | step6-implement rerun exec-000023 | Completed | Addressed adversarial Step 7 high finding by rejecting root-data `files/...` refs whose path is outside the current workflow execution before stat/copy. Added focused regression coverage for cross-workflow and cross-run root-data attachment refs while preserving same-run root-data materialization. Focused runtime-db tests, broader SQLite/GraphQL/communication/manager tests, typecheck, Biome, JSON validation, and diff check passed. |
| 2026-06-07 | step6-implement rerun exec-000027 | Completed | Addressed adversarial Step 7 high finding by validating attachment source realpaths against the current workflow execution scope before copying, blocking symlink escapes for root-data and existing `attachment-root` refs. Added focused symlink regression coverage. Focused runtime-db tests, broader SQLite/GraphQL/communication/manager tests, typecheck, Biome, JSON validation, and diff check passed. |
| 2026-06-07 | step6-implement rerun exec-000029 | Completed | Addressed Step 6 self-review high finding by rejecting symlinked workflow execution scope directories under root-data and attachment-root before copying. Added focused regression coverage for symlinked scope ancestors and confirmed the prior reproduction is rejected. Focused runtime-db tests, broader SQLite/GraphQL/communication/manager tests, paths tests, typecheck, Biome, JSON validation, and diff check passed. |
| 2026-06-07 | step6-implement rerun exec-000031 | Completed | Addressed Step 6 self-review high finding by validating attachment copy destinations before writing and rejecting preexisting target symlinks under attachment-root message paths. Added focused regression coverage for root-data materialization and attachment-root replay target symlinks and confirmed the prior overwrite reproduction is rejected. Focused runtime-db tests, broader SQLite/GraphQL/communication/manager tests, paths tests, typecheck, Biome, JSON validation, and diff check passed. |
| 2026-06-07 | step6-implement rerun exec-000033 | Completed | Addressed Step 6 self-review high finding by rejecting preexisting hardlinked attachment targets before copying. Extended target-link regression coverage for root-data materialization and attachment-root replay hardlinks and confirmed the prior hardlink overwrite reproduction is rejected. Focused runtime-db tests, broader SQLite/GraphQL/communication/manager tests, paths tests, typecheck, Biome, JSON validation, and diff check passed. |
| 2026-06-07 | step6-implement rerun exec-000035 | Completed | Addressed Step 6 self-review high finding by rejecting hardlinked attachment sources before copying. Added focused regression coverage for root-data and attachment-root source hardlinks and confirmed the prior source-hardlink disclosure reproduction is rejected. Focused runtime-db tests, broader SQLite/GraphQL/communication/manager tests, paths tests, typecheck, Biome, JSON validation, and diff check passed. |
| 2026-06-07 | step6-implement rerun exec-000038 | Completed | Addressed Step 7 high finding by validating relative new attachment-root sources with lstat, realpath scope checks, and hardlink rejection before persisting SQLite refs. Added focused regression coverage for relative attachment-root symlink and hardlink sources and confirmed the prior relative symlink disclosure reproduction is rejected. Focused runtime-db tests, broader SQLite/GraphQL/communication/manager tests, paths tests, typecheck, Biome, JSON validation, and diff check passed. |
| 2026-06-07 | step6-implement rerun exec-000041 | Completed | Addressed Step 7 mid finding by avoiding recursive mkdir on untrusted attachment target parents. Target scope directories are now created segment-by-segment with symlink checks before any missing descendants are created. Added focused regression coverage proving a target parent symlink does not create outside directories. Focused runtime-db tests, broader SQLite/GraphQL/communication/manager tests, paths tests, typecheck, Biome, JSON validation, and diff check passed. |
| 2026-06-07 | step6-implement rerun exec-000045 | Completed | Addressed adversarial Step 7 mid finding by loading imported continuation communications from SQLite `workflow_messages` instead of `session.communications`. Added focused failed-workflow continuation coverage that strips the failed session communications array before continuation succeeds from SQLite-backed upstream bindings. Focused continuation test, broader SQLite/GraphQL/communication/manager tests, paths tests, typecheck, Biome, JSON validation, and diff check passed. |
| 2026-06-07 | step6-implement rerun exec-000048 | Completed | Addressed Step 7 mid finding by preserving each upstream communication owner `workflowExecutionId` through finalization and marking SQLite consumption by owner execution id instead of the continued session id. Added failed-workflow continuation coverage that verifies the source execution `workflow_messages` row becomes `consumed` with `consumed_by_node_exec_id` set to the continued step execution. Focused continuation test, broader SQLite/GraphQL/communication/manager tests, paths tests, typecheck, Biome, JSON validation, and diff check passed. |
| 2026-06-07 | manual schema/index review | Completed | User-requested schema review found a remaining index gap: `workflow_messages` had correct primary-key lookup and outbound/timeline indexes, but inbound listing by `workflow_execution_id` + `to_node_id` with canonical `ORDER BY created_at, communication_id` was not covered by `idx_workflow_messages_inbound (workflow_execution_id, to_node_id, status)`. Added `idx_workflow_messages_inbound_created` and query-plan coverage. |
| 2026-06-07 | manual schema/version review | Completed | User requested explicit schema-version planning. Design and plan now record that JSON columns remain SQLite `TEXT` with canonical JSON and no general JSON-field promotion; only query-critical keys may also be duplicated as ordinary typed columns. Added `runtime_schema_metadata` with active schema version, active table mapping JSON, migration metadata JSON, and JSON validity checks. |
| 2026-06-07 | step6-implement rerun exec-000050 | Completed | Addressed Step 6 self-review mid finding by completing the plan-listed schema/index criteria: added inbound created-order message index, active runtime schema metadata, JSON validity checks for metadata JSON, focused query-plan/schema tests, and marked the completion criteria closed. Focused schema/index test, broader SQLite/GraphQL/communication/manager tests, failed-continuation test, paths tests, typecheck, Biome, JSON validation, and diff check passed. |
| 2026-06-07 | step6-implement rerun exec-000054 | Completed | Addressed adversarial Step 7 mid finding by allocating replay and manager-message communication ids from the maximum existing SQLite `workflow_messages` id and the session counter. Added stale-counter replay coverage proving the source row is preserved and the replay row gets a distinct id, and strengthened manager-message-originated replay coverage with stale counter input. |
| 2026-06-07 | step6-implement rerun exec-000057 | Completed | Addressed Step 7 mid findings by aligning the plan header and TASK-002 status with completed module/progress evidence, and by documenting the accepted scope exception for SQLite-aware manager-message id allocation needed to fix stale-counter collisions. |
| 2026-06-07 | step6-implement rerun exec-000060 | Completed | Addressed Step 7 mid finding by loading current-execution upstream refs for the target step from SQLite `workflow_messages` instead of `session.communications`. Added same-execution resume coverage that strips session communications and verifies required node-output bindings resolve from SQLite and the source message is consumed. |
| 2026-06-07 | step6-implement rerun exec-000063 | Completed | Addressed Step 7 mid finding by allocating normal workflow transition communication ids from the maximum existing SQLite `workflow_messages` id and session counter before persisting transition rows. Added three-step stale-counter resume coverage proving `comm-000001` remains the consumed step-1 to step-2 row and step-2 to step-3 gets a distinct `comm-000002` row. |
| 2026-06-07 | step6-implement rerun exec-000067 | Completed | Addressed adversarial Step 7 mid findings by applying SQLite-aware communication id allocation to local fanout joins, cross-workflow result delivery, and cross-workflow fanout joins. Added stale-counter resume coverage proving existing `comm-000001` rows remain intact and fanout/workflow-call deliveries allocate `comm-000002`. |
| 2026-06-07 | step6-implement rerun exec-000070 | Completed | Addressed Step 7 mid finding by allocating external workflow-output publication communication ids from existing SQLite `workflow_messages` plus the session counter. Added stale-counter resume coverage proving manager-to-output `comm-000001` remains intact and external-output publication allocates `comm-000002`. |
| 2026-06-07 | step6-implement rerun exec-000073 | Completed | Addressed Step 7 mid verification finding by making external-output publication resume tests hermetic with a temp-root `rootDataDir`, preventing default runtime DB pollution from fixed session ids. Focused external-output stale-counter tests, typecheck, Biome, broader SQLite/GraphQL/communication/manager tests, JSON validation, and diff check passed. |
| 2026-06-07 | step6-implement rerun exec-000077 | Completed | Addressed adversarial Step 7 mid finding by adding an atomic per-workflow SQLite message sequence table for communication id allocation and merging replay-updated session communications from SQLite after replay writes. Added concurrent replay coverage proving unique replay ids, intact superseded source rows, replay rows, and session records. |
| 2026-06-07 | step6-implement rerun exec-000080 | Completed | Addressed Step 7 mid finding by materializing replay payloads before DB mutation, then saving the replay row and superseding the source SQLite message in one transaction. Added failure-path regression coverage proving a missing replay attachment leaves the source delivered with no superseded-by id and no phantom replay reference. |
| 2026-06-07 | step6-implement rerun exec-000083 | Completed | Addressed Step 7 mid finding by deleting `workflow_message_sequences` rows inside `deleteRuntimeSession` with the other per-session runtime tables. Extended delete-runtime-session coverage to allocate a sequence row and verify it is removed with `workflow_messages`, sessions, node executions, and logs. |
| 2026-06-07 | step6-implement rerun exec-000087 | Completed | Addressed adversarial Step 7 mid finding by scoping SQLite consumed-state updates to communications owned by the current continuation session, leaving imported failed-run `workflow_messages` delivered and reusable. Extended failed-workflow continuation coverage to strip source session communications, continue twice from the same failed source run, verify both continuations receive the step-1 input, and verify the source message remains delivered after both runs. |
| 2026-06-07 | step6-implement rerun exec-000091 | Completed | Addressed adversarial Step 7 mid finding by replacing attachment `copyFile` writes with exclusive destination creation, immediate target revalidation, and preexisting-target rejection before writing source bytes. Added controlled-race coverage for root-data materialization and attachment-root replay where a target symlink is inserted after validation; both reject without SQLite rows and leave outside files unchanged. |
| 2026-06-07 | step6-implement rerun exec-000094 | Completed | Addressed Step 7 mid finding by opening attachment sources through a stable handle, validating the opened file identity against the previously validated source, and reading bytes from that handle instead of reopening by path. Added controlled-race source-symlink coverage for root-data materialization and attachment-root replay, proving saves reject without SQLite rows or outside content copies. |
| 2026-06-07 | step6-implement rerun exec-000098 | Completed | Addressed adversarial Step 7 mid recoverability finding by tracking newly materialized attachment files and deleting them when payload materialization or the subsequent SQLite upsert fails. Added deterministic post-copy/pre-row failure coverage proving the stale target is removed and retrying the same communication succeeds with one persisted `workflow_messages` row. |
| 2026-06-07 | step6-implement rerun exec-000102 | Completed | Addressed adversarial Step 7 mid partial-write finding by cleaning the exclusive attachment target inside `copyAttachmentFileExclusive` whenever an error occurs after target creation, including forced pre-write failure and close/write failure paths. Added deterministic target-created/write-failed/retry-succeeds coverage. |
| 2026-06-07 | step6-implement rerun exec-000104 | Completed | Addressed Step 6 self-review mid finding by making target-handle close during attachment error cleanup best-effort and non-masking, preserving the original copy/write/close error while still attempting to remove the created target. Added deterministic close-path failure coverage proving the target is removed and retry persists one `workflow_messages` row. |
| 2026-06-07 | step6-implement rerun exec-000108 | Completed | Addressed adversarial Step 7 mid findings by guarding SQLite consumed-state updates to delivered rows only and streaming attachment materialization through bounded file-handle copies instead of whole-file buffering. Added stale-finalization coverage proving superseded messages stay superseded, plus large attachment coverage proving multi-buffer copies persist correct refs and content. |
| 2026-06-07 | step6-implement rerun exec-000111 | Completed | Addressed Step 7 mid finding in bounded attachment streaming by looping on `FileHandle.write` until each read chunk is fully written and throwing if writes make no progress. Added helper-level regression coverage with controlled short writes proving full content is preserved. |
| 2026-06-07 | step8-impl-plan-completion-check exec-000116 | Completed | Confirmed Step 7 and adversarial review accepted the implementation with no high or medium findings, Step 8 documentation refresh completed, and all plan tasks are complete. Archived plan from `impl-plans/active/sqlite-message-store.md` to `impl-plans/completed/sqlite-message-store.md`. |
