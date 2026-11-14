# SQLite Message Payload Attachment Snapshot Preservation Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-sqlite-message-store.md#payload-attachment-snapshot-rules`
**Created**: 2026-06-08
**Last Updated**: 2026-06-08

## Design Reference

Source of truth:

- `design-docs/specs/design-sqlite-message-store.md:206`
- `design-docs/specs/design-sqlite-message-store.md:369`

The accepted design requires `payload.attachments[]` to be treated as a mixed
descriptor array. SQLite message snapshotting must preserve JSON-compatible
non-file and unmaterialized descriptors in `workflow_messages.payload_json`,
while replacing only successfully materialized file-backed entries with
normalized `attachment-root` refs. `artifact_refs_json` remains limited to
materialized file refs.

## Issue Reference

- Workflow mode: `issue-resolution`
- Workflow ID: `codex-design-and-implement-review-loop`
- Node: `step4-impl-plan-create`
- Parent workflow ID: `codex-recent-change-quality-loop`
- Parent workflow execution ID:
  `riel-codex-recent-change-quality-loop-1780843979-7af07a4e`
- Caller node ID: `step3-handoff`
- Issue title: `Resolve SQLite message payload attachment snapshot data loss`
- Review finding: mid severity at
  `packages/rielflow/src/workflow/runtime-db/workflow-message-records.ts:613`
- Accepted design review: `step3-design-review`, `accepted: true`,
  `needs_revision: false`, `reviewDecision:
  accepted_no_high_or_mid_findings`

## Codex Agent References

- `codex-recent-change-quality-loop` `step3-handoff`: delegated the blocking
  recent-change finding and recommended preserving non-file descriptors.
- `codex-design-and-implement-review-loop` `step1-issue-intake`: narrowed the
  scope to SQLite message payload snapshotting and focused regression coverage.
- `codex-design-and-implement-review-loop` `step2-design-doc-update`: updated
  the SQLite message-store design with required preservation behavior.
- `codex-design-and-implement-review-loop` `step3-design-review`: accepted the
  design with no high or mid findings.
- `codex-agent` repository references: none provided and none required for this
  runtime-db persistence bug.

## Scope

Included:

- Update `buildWorkflowMessagePayloadSnapshot` and attachment snapshot helper
  flow in `packages/rielflow/src/workflow/runtime-db/workflow-message-records.ts`.
- Preserve non-object attachment entries and object descriptors that do not
  represent a materializable local file ref.
- Continue rewriting materialized file-backed root-data and attachment-root
  entries to normalized `attachment-root` refs.
- Add focused sqlite persistence and communication replay regression tests.

Excluded:

- CLI, adapter, examples, package metadata, or lockfile changes.
- Relaxing path traversal, absolute path, cross-workflow, cross-run, symlink,
  hardlink, or unsafe target validation.
- Mirroring non-file descriptors into `artifact_refs_json`.
- Storing raw file content, binary blobs, or host absolute paths in
  `payload_json`.

## Modules

### 1. Attachment Snapshot Classification

#### `packages/rielflow/src/workflow/runtime-db/workflow-message-records.ts`

**Status**: COMPLETED

```typescript
type WorkflowMessageAttachmentSnapshotResult =
  | {
      readonly kind: "preserve";
      readonly attachment: unknown;
    }
  | {
      readonly kind: "materialized";
      readonly ref: WorkflowMessageArtifactRef;
    };

async function snapshotAttachmentDescriptor(input: {
  readonly attachment: unknown;
  readonly communication: CommunicationRecord;
  readonly options: LoadOptions;
  readonly createdAttachmentPaths: string[];
}): Promise<WorkflowMessageAttachmentSnapshotResult>;
```

Implementation notes:

- Preserve non-object attachment array entries exactly as parsed JSON values.
- Preserve object descriptors with missing, empty, or non-string `path`.
- Preserve object descriptors that are clearly non-file provider metadata, such
  as URI/link descriptors, while keeping their JSON-compatible shape.
- Treat local file descriptors as materializable only through existing supported
  root-data, attachment-root, or relative attachment-root paths.
- Keep current rejection behavior for file-backed descriptors that violate
  security checks.
- Build `sanitizedPayload.attachments` from preserved descriptors plus
  materialized refs in original array order.
- Build `artifactRefs` from materialized refs only.

### 2. Runtime DB Persistence Regression Tests

#### `packages/rielflow/src/workflow/runtime-db.test.ts`

**Status**: COMPLETED

```typescript
interface PreservedAttachmentDescriptorCase {
  readonly name: string;
  readonly attachment: unknown;
  readonly expectedPayloadAttachment: unknown;
}

interface MixedAttachmentPersistenceExpectation {
  readonly payloadAttachments: readonly unknown[];
  readonly artifactRefs: readonly WorkflowMessageArtifactRef[];
}
```

Test notes:

- Add a non-file descriptor test near existing message attachment persistence
  coverage.
- Cover object descriptors without `path`, non-file provider/link descriptors,
  and non-object array entries.
- Add a mixed file/non-file test where one root-data file is materialized and
  adjacent non-file descriptors survive in `payload_json`.
- Assert `artifact_refs_json` contains only file refs.
- Assert original file content fields are not stored in `payload_json`.

### 3. Communication Replay Regression Tests

#### `packages/rielflow/src/workflow/communication-service.test.ts`

**Status**: COMPLETED

```typescript
interface ReplayAttachmentPreservationExpectation {
  readonly sourcePayloadAttachments: readonly unknown[];
  readonly replayedPayloadAttachments: readonly unknown[];
  readonly replayedArtifactRefs: readonly WorkflowMessageArtifactRef[];
}
```

Test notes:

- Add sqlite-backed replay coverage using `createCommunicationService`.
- Seed or create a source communication whose `payload_json` has mixed file and
  non-file attachments.
- Replay the communication and assert non-file descriptors remain in the
  replayed message payload.
- Assert materialized file refs are still copied into the replay communication
  scope and remain safe.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Attachment snapshot classification | `packages/rielflow/src/workflow/runtime-db/workflow-message-records.ts` | COMPLETED | Targeted runtime-db and communication-service tests |
| SQLite payload persistence regressions | `packages/rielflow/src/workflow/runtime-db.test.ts` | COMPLETED | `bun test packages/rielflow/src/workflow/runtime-db.test.ts` |
| SQLite replay regressions | `packages/rielflow/src/workflow/communication-service.test.ts` | COMPLETED | `bun test packages/rielflow/src/workflow/communication-service.test.ts` |

## Task Breakdown

### TASK-001: Confirm Attachment Classification Contract

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: implementation notes recorded in this plan progress log.
**Dependencies**: None.

Actions:

- Re-read `buildWorkflowMessagePayloadSnapshot` and `materializeAttachmentRef`
  in `workflow-message-records.ts`.
- Confirm which existing descriptor shapes are file-backed today:
  root-data-style paths, `pathBase: "attachment-root"`, and scoped relative
  attachment-root paths.
- Confirm preservation behavior for missing-path, non-string path, non-object,
  and URI/link/provider metadata descriptors.

Completion criteria:

- [x] Implementer has a written classification decision before code edits.
- [x] The decision distinguishes preserved business descriptors from unsafe
      file-backed descriptors that must still fail publication.

### TASK-002: Preserve Unmaterialized Attachments In Payload Snapshot

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-001, with TASK-003 and TASK-004 because write
scopes are disjoint.
**Deliverables**:
`packages/rielflow/src/workflow/runtime-db/workflow-message-records.ts`
**Dependencies**: TASK-001.

Actions:

- Update the snapshot helper flow so every attachment input contributes either a
  preserved payload descriptor or a materialized file ref.
- Replace only successfully materialized file-backed descriptors with
  normalized `attachment-root` refs.
- Preserve original order in `payload.attachments`.
- Leave existing safety helper calls in place for local file materialization.

Completion criteria:

- [x] Non-file descriptors are not filtered out.
- [x] Materialized file entries still populate `artifactRefs`.
- [x] `artifact_refs_json` excludes preserved non-file descriptors.
- [x] Existing attachment safety rejection tests remain valid.

### TASK-003: Add SQLite Payload Persistence Coverage

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-001, with TASK-002 and TASK-004 because write
scopes are disjoint.
**Deliverables**: `packages/rielflow/src/workflow/runtime-db.test.ts`
**Dependencies**: TASK-001.

Actions:

- Add focused tests for non-file-only `payload.attachments`.
- Add focused tests for mixed root-data file and non-file descriptors.
- Parse `record.payloadJson` and assert attachment array shape directly.
- Parse `record.artifactRefsJson` and assert only materialized file refs appear.

Completion criteria:

- [x] Non-file-only attachments survive in `workflow_messages.payload_json`.
- [x] Mixed attachments preserve non-file entries and rewrite only file entries.
- [x] File content fields are not persisted in `payload_json`.
- [x] Targeted runtime-db test file passes.

### TASK-004: Add SQLite Replay Coverage

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-001, with TASK-002 and TASK-003 because write
scopes are disjoint.
**Deliverables**: `packages/rielflow/src/workflow/communication-service.test.ts`
**Dependencies**: TASK-001.

Actions:

- Add a replay test for a source communication with mixed persisted
  attachments.
- Assert replay preserves non-file descriptors in the replayed payload.
- Assert materialized file refs are copied into the replay communication scope.
- Assert source communication state remains correct after replay.

Completion criteria:

- [x] SQLite-backed communication replay preserves non-file descriptors.
- [x] Materialized file refs remain safe and scoped to the replay
      communication.
- [x] Targeted communication-service test file passes.

### TASK-005: Verification And Progress Log

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: updated progress log in this plan and command results in the
implementation handoff.
**Dependencies**: TASK-002, TASK-003, TASK-004.

Actions:

- Run targeted tests first.
- Run repository typecheck and Biome lint.
- Update task statuses and the progress log before handoff.

Completion criteria:

- [x] Required verification commands pass or any unrelated blocker is recorded
      with exact output context.
- [x] This plan records implemented tasks, files touched, and residual risks.
- [x] Handoff cites the accepted design and the original mid severity finding.

## Dependencies

| Task | Depends On | Write Scope | Status |
| --- | --- | --- | --- |
| TASK-001 | None | Read-only inspection, plan progress log | COMPLETED |
| TASK-002 | TASK-001 | `packages/rielflow/src/workflow/runtime-db/workflow-message-records.ts` | COMPLETED |
| TASK-003 | TASK-001 | `packages/rielflow/src/workflow/runtime-db.test.ts` | COMPLETED |
| TASK-004 | TASK-001 | `packages/rielflow/src/workflow/communication-service.test.ts` | COMPLETED |
| TASK-005 | TASK-002, TASK-003, TASK-004 | Verification and plan progress log | COMPLETED |

Parallelizable after TASK-001:

- TASK-002 runtime snapshot implementation
- TASK-003 runtime-db persistence tests
- TASK-004 communication-service replay tests

These tasks have disjoint write scopes. TASK-005 must join all implementation
and test work.

## Verification Plan

Required:

```bash
bun test packages/rielflow/src/workflow/runtime-db.test.ts packages/rielflow/src/workflow/communication-service.test.ts
bun run typecheck
bun run lint:biome
```

Focused optional commands during implementation:

```bash
bun test packages/rielflow/src/workflow/runtime-db.test.ts -t "attachment"
bun test packages/rielflow/src/workflow/communication-service.test.ts -t "replay"
git diff --check -- packages/rielflow/src/workflow/runtime-db/workflow-message-records.ts packages/rielflow/src/workflow/runtime-db.test.ts packages/rielflow/src/workflow/communication-service.test.ts impl-plans/completed/sqlite-message-payload-attachment-snapshot-preservation.md
```

## Completion Criteria

- [x] The mid severity data-loss finding is fixed in
      `workflow-message-records.ts`.
- [x] Non-file and unmaterialized `payload.attachments[]` descriptors remain in
      `workflow_messages.payload_json`.
- [x] File-backed attachments are still materialized to safe
      `attachment-root` refs.
- [x] `artifact_refs_json` contains materialized file refs only.
- [x] SQLite persistence and communication replay regressions are covered.
- [x] Required verification commands pass or blockers are explicitly recorded.

## Addressed Feedback

- Recent-change review finding at
  `packages/rielflow/src/workflow/runtime-db/workflow-message-records.ts:613`:
  addressed by planning a snapshot flow that preserves every unmaterialized
  descriptor instead of filtering it out.
- Step 2 design feedback: incorporated the accepted distinction between mixed
  descriptor preservation and file-ref materialization.
- Step 3 design review: accepted with no findings; no revision feedback remains
  open.

## Risks

- A URI or provider descriptor with a `path` string could be misclassified as a
  missing local file instead of business metadata.
- Safety-sensitive local file refs must continue to reject traversal, absolute
  paths, cross-scope refs, symlinks, hardlinks, and unsafe preexisting targets.
- Replay tests must assert `payload_json` shape directly, not only
  `artifact_refs_json`.

## Progress Log

### 2026-06-08

- Created implementation plan from accepted design review.
- Classification decision: non-object entries, missing or empty `path`, and
  explicit URL-like `path` values are preserved as business descriptors.
  Existing file-backed refs still materialize through root-data `files/...`,
  `pathBase: "attachment-root"`, or scoped relative attachment-root paths;
  unsafe or missing file-backed refs still fail publication even when the
  descriptor also carries provider/kind/type/source metadata.
- Implemented attachment snapshot preservation in
  `packages/rielflow/src/workflow/runtime-db/workflow-message-records.ts`.
- Extracted sqlite workflow-message row conversion helpers to
  `packages/rielflow/src/workflow/runtime-db/workflow-message-record-conversion.ts`
  so touched source files satisfy Biome line-count limits.
- Added SQLite persistence regressions in
  `packages/rielflow/src/workflow/runtime-db.test.ts` for non-file-only and
  mixed file/non-file `payload.attachments`.
- Added SQLite-backed replay regression coverage in
  `packages/rielflow/src/workflow/communication-service.test.ts`.
- Rerun after `step7-adversarial-review` rejected the marker heuristic with one
  high and one mid finding. Revised classification so non-empty non-URL `path`
  values always route through existing materialization and safety checks before
  descriptor preservation.
- Added adversarial regressions for absolute paths with non-file markers and
  root-data file descriptors carrying `type: "text/plain"` metadata.
- Rerun after `step7-review` rejected `file://` URL-like preservation as a high
  finding. Excluded local file URL schemes from URL-like preservation so they
  route through existing path safety rejection, and added a regression for
  `file://` host paths.
- Rerun after `step7-review` rejected missing non-file URI coverage as a mid
  finding. Added explicit preservation for non-file URI schemes without `//`
  such as `data:`, `tel:`, `cid:`, and `magnet:` while keeping `file:` rejected.
- Rerun after `step7-review` rejected scheme allowlist coverage as a mid
  finding. Generalized URI preservation to non-`file:` multi-character schemes
  so unsupported/link descriptors such as `about:blank` remain business
  metadata while single-letter Windows drive-style prefixes still route through
  local path handling.
- Cleaned Step 7 low plan-status findings by marking persistence and replay
  module sections completed.
- Verification passed:
  `bun test packages/rielflow/src/workflow/runtime-db.test.ts packages/rielflow/src/workflow/communication-service.test.ts`;
  `bun run typecheck`; `bun run lint:biome`;
  `git diff --check -- packages/rielflow/src/workflow/runtime-db/workflow-message-records.ts packages/rielflow/src/workflow/runtime-db/workflow-message-record-conversion.ts packages/rielflow/src/workflow/runtime-db.ts packages/rielflow/src/workflow/runtime-db.test.ts packages/rielflow/src/workflow/communication-service.test.ts impl-plans/active/sqlite-message-payload-attachment-snapshot-preservation.md impl-plans/README.md design-docs/specs/design-sqlite-message-store.md`.
- Status: Completed and archived after Step 7 acceptance and Step 8 docs refresh.
