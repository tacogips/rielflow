# Workflow Self-Improve Shared Function Reuse Audit Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-self-improve.md#shared-function-reuse-audit`
**Created**: 2026-05-19
**Last Updated**: 2026-05-19

---

## Design Document Reference

**Source**: `design-docs/specs/design-self-improve.md`

### Summary

Audit and harden the existing workflow self-improve implementation so shared divedra behavior is reused where it owns the contract, aligned where self-improve must remain lifecycle-specific, and documented where intentional divergence is required. This plan follows the accepted Step 3 design review for the issue "Audit self-improve implementation for duplicated existing functionality".

### Scope

**Included**:

- Classify implementation areas as `reuse-required`, `align-required`, or `intentional-divergence`.
- Refactor self-improve path validation and prompt-file patching to reuse workflow-local path helpers where applicable.
- Keep canonical workflow patching distinct from invocation-scoped node patches in `src/workflow/node-patches.ts`.
- Reconcile self-improve git commit behavior with native git/add-on safety semantics without calling the node add-on executor directly.
- Reuse shared JSON object checks for marker/report reads that validate public or persisted inputs.
- Reuse session-store/runtime-db discovery semantics for source selection while keeping file-backed session state authoritative.
- Confirm CLI, library, GraphQL, and server adapters remain thin adapters over `src/workflow/self-improve/service.ts`.
- Update focused tests, README/API docs, and this plan's progress log.

**Excluded**:

- Merging self-improve with `workflow run --auto-improve` or live supervision.
- Calling `src/workflow/native-node-executor/git-and-addon-execution.ts` directly from self-improve.
- Moving report or marker storage into runtime node artifact directories.
- Copying Codex-agent rollout/session storage formats.
- Adding cross-workflow explicit source-session analysis.

### Codex-Agent Reference Trace

- `codex-agent` is an execution backend/reference only for this workflow.
- `../../codex-agent` was not available in this worktree during Step 1 through Step 3.
- Accepted design decision: no Codex source behavior is required or copied; divedra source runs come from divedra session/artifact stores and backend-specific transcript details stay behind existing adapters.

---

## Modules

### 1. Reuse Classification and Plan Tracking

#### `impl-plans/active/self-improve-shared-function-reuse-audit.md`

**Status**: COMPLETED

```ts
interface SelfImproveReuseFinding {
  readonly area: "patcher" | "artifacts" | "git" | "json" | "source-selection" | "adapters";
  readonly decision: "reuse-required" | "align-required" | "intentional-divergence";
  readonly paths: readonly string[];
  readonly remediationTask: string;
}
```

**Checklist**:

- [x] Inspect current self-improve modules against the accepted reuse audit.
- [x] Record each duplicate/inconsistent behavior in the Progress Log before implementation edits.
- [x] Confirm intentional divergences remain limited to backup/restore, report/marker storage, and local git orchestration.

### 2. Patcher and Workflow-Relative Path Reuse

#### `src/workflow/self-improve/patcher.ts`, `src/workflow/self-improve/service.ts`, `src/workflow/self-improve/patcher.test.ts`, `src/workflow/self-improve/service.test.ts`

**Status**: COMPLETED

```ts
interface WorkflowSelfImprovePatchOperation {
  readonly relativePath: string;
  readonly content: string;
}

interface WorkflowSelfImprovePatchPathDecision {
  readonly relativePath: string;
  readonly targetKind: "workflow-definition" | "node-payload" | "prompt-file";
  readonly resolvedPath: string;
}
```

**Checklist**:

- [x] Replace the local escape-only path resolver with shared workflow-relative validation where it matches the target file class.
- [x] Use `packages/divedra-core/src/prompt-template-file.ts` rules for prompt-file targets.
- [x] Preserve canonical `workflow.json` and node payload writes through loader-compatible validation, not `node-patches.ts` transient override logic.
- [x] Ensure post-write validation remains through `src/workflow/load.ts` and `src/workflow/json-schema.ts`.
- [x] Add tests for escaped paths, absolute paths, promptTemplateFile patching, workflow definition patching, rollback, and validation error messages.

### 3. Backup, Pathing, and Artifact-Root Alignment

#### `src/workflow/self-improve/backup.ts`, `src/workflow/self-improve/pathing.ts`, `src/workflow/paths.ts`, `src/workflow/self-improve/pathing.test.ts`, `src/workflow/self-improve/backup.test.ts`

**Status**: COMPLETED

```ts
interface WorkflowSelfImproveArtifactAlignment {
  readonly backupPath: string;
  readonly executionDirectory: string;
  readonly logRoot: string;
  readonly usesSharedPathSafety: boolean;
  readonly storageBoundary: "self-improve-log-root";
}
```

**Checklist**:

- [x] Audit `backup.ts` and `pathing.ts` against `src/workflow/paths.ts` conventions for home expansion, root resolution, scoped path safety, and collision-resistant directory identities.
- [x] Keep backup and report artifacts under the self-improve execution directory, not runtime node artifact directories.
- [x] Confirm `.git` metadata remains excluded from backups and preserved during rollback.
- [x] Document any no-change decision when an existing path/artifact helper is intentionally not reused because self-improve storage has a different lifecycle boundary.
- [x] Add or update focused tests for log-root resolution, workflow-directory identity collisions, backup scoping, `.git` exclusion, and rollback preservation.

### 4. JSON Marker and Report Boundary Alignment

#### `src/workflow/self-improve/marker-store.ts`, `src/workflow/self-improve/report.ts`, `src/workflow/self-improve/report.test.ts`

**Status**: COMPLETED

```ts
interface WorkflowSelfImprovePersistedJsonRead<T> {
  readonly path: string;
  readonly value: T;
}
```

**Checklist**:

- [x] Use `src/shared/json.ts` object checks when reading marker/report JSON that affects public API responses or source selection.
- [x] Preserve direct typed JSON serialization for known internal report writes.
- [x] Surface invalid report JSON as report-read failure, while list operations may skip unreadable reports consistently.
- [x] Add tests for corrupt marker JSON, non-object report JSON, and report-list skip behavior.

### 5. Source Selection Discovery Reuse

#### `src/workflow/self-improve/source-selection.ts`, `src/workflow/self-improve/source-selection.test.ts`, `src/workflow/runtime-db/session-query-records.ts`

**Status**: COMPLETED

```ts
interface WorkflowSelfImproveSourceDiscovery {
  readonly indexedSessionIds: readonly string[];
  readonly loadedSourceRuns: readonly WorkflowSelfImproveSourceRun[];
  readonly fileBackedStateAuthoritative: boolean;
}
```

**Checklist**:

- [x] Prefer existing runtime-db session summary ordering when available, then hydrate selected runs through `loadSession`.
- [x] Fall back to `listSessions` / `loadSession` when runtime-db rows are absent or stale.
- [x] Keep explicit session validation based on loaded file-backed session state and resolved `workflowName` / `workflowId`.
- [x] Preserve `since-last`, `latest`, `since-last-or-latest`, and `explicit` behavior.
- [x] Add tests for DB-indexed discovery, stale DB rows, file-only fallback, explicit session rejection, and marker cutoff ordering.

### 6. Git Safety Alignment

#### `src/workflow/self-improve/git.ts`, `src/workflow/self-improve/backup-git.test.ts`, `src/workflow/native-node-executor/git-and-addon-execution.ts`

**Status**: COMPLETED

```ts
interface WorkflowSelfImproveGitSafetyCheck {
  readonly repoRoot: string;
  readonly relativeFiles: readonly string[];
  readonly unexpectedPreStagedFiles: readonly string[];
}
```

**Checklist**:

- [x] Normalize changed files relative to the owning repo and reject absolute, escaped, empty, or directory paths.
- [x] Detect and reject pre-staged files outside the current self-improve changed-file set before staging.
- [x] Commit only when the changed-file set creates staged changes.
- [x] Preserve no-push behavior and commit messages without automated-assistant attribution.
- [x] Record git failures in the report path without rolling back validated workflow edits.
- [x] Add tests for escaped changed files, directory changed files, unexpected pre-staged files, no-op changed files, and unrelated unstaged files.

### 7. Adapter and Public Surface Parity Audit

#### `packages/divedra/src/cli/workflow-command-handler.ts`, `packages/divedra/src/index.ts`, `src/graphql/types.ts`, `src/graphql/schema/execution-resolvers.ts`, `src/server/graphql-executable-schema.ts`, `src/cli.test.ts`, `src/lib-api.test.ts`, `src/graphql/schema.test.ts`, `src/server/graphql-queries-and-inspection.test.ts`

**Status**: COMPLETED

```ts
interface WorkflowSelfImproveAdapterParity {
  readonly localCliUsesCoreService: boolean;
  readonly endpointCliUsesGraphql: boolean;
  readonly libraryUsesCoreOrGraphql: boolean;
  readonly serverModeGuardrails: readonly string[];
}
```

**Checklist**:

- [x] Confirm local CLI, library, GraphQL, and server paths all route through `executeWorkflowSelfImprove`, `getWorkflowSelfImproveReport`, or `listWorkflowSelfImproveReports`.
- [x] Confirm endpoint-backed CLI/library calls use typed GraphQL fields and not manager-message shortcuts.
- [x] Confirm `serve --read-only` and `serve --no-exec` behavior remains covered after any refactor.
- [x] Update parity tests only where gaps or regressions are found.

### 8. Documentation, Indexes, and Final Verification

#### `README.md`, `design-docs/specs/design-self-improve.md`, `impl-plans/active/self-improve-shared-function-reuse-audit.md`, `impl-plans/README.md`

**Status**: COMPLETED

```ts
interface SelfImproveReuseAuditDocumentation {
  readonly reusedHelpers: readonly string[];
  readonly alignedBehaviors: readonly string[];
  readonly intentionalDivergences: readonly string[];
}
```

**Checklist**:

- [x] Document any remaining justified new implementation in the design or README.
- [x] Update this plan's Module Status, Task Breakdown, Completion Criteria, and Progress Log.
- [x] Update implementation-plan index entries if plan status changes.
- [x] Record verification commands and any blocked verification.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Reuse classification | `impl-plans/active/self-improve-shared-function-reuse-audit.md` | COMPLETED | `git diff --check` |
| Patcher/path reuse | `src/workflow/self-improve/patcher.ts`, `src/workflow/self-improve/service.ts` | COMPLETED | `src/workflow/self-improve/patcher.test.ts`, `src/workflow/self-improve/service.test.ts` |
| Backup/pathing artifact alignment | `src/workflow/self-improve/backup.ts`, `src/workflow/self-improve/pathing.ts`, `src/workflow/paths.ts` | COMPLETED | `src/workflow/self-improve/pathing.test.ts`, `src/workflow/self-improve/backup.test.ts` |
| JSON boundaries | `src/workflow/self-improve/marker-store.ts`, `src/workflow/self-improve/report.ts` | COMPLETED | `src/workflow/self-improve/report.test.ts` |
| Source selection | `src/workflow/self-improve/source-selection.ts` | COMPLETED | `src/workflow/self-improve/source-selection.test.ts` |
| Git safety | `src/workflow/self-improve/git.ts` | COMPLETED | `src/workflow/self-improve/backup-git.test.ts` |
| Adapter parity | CLI, library, GraphQL, server self-improve adapters | COMPLETED | `src/cli.test.ts`, `src/lib-api.test.ts`, `src/graphql/schema.test.ts`, `src/server/graphql-queries-and-inspection.test.ts` |
| Documentation | `README.md`, `design-docs/specs/design-self-improve.md`, this plan | COMPLETED | `git diff --check` |

## Dependencies

| Task | Depends On | Status |
|------|------------|--------|
| TASK-001: Reuse classification audit | None | COMPLETED |
| TASK-002: Patcher/path reuse | TASK-001 | COMPLETED |
| TASK-003: Backup/pathing artifact alignment | TASK-001 | COMPLETED |
| TASK-004: JSON boundary alignment | TASK-001 | COMPLETED |
| TASK-005: Source selection discovery reuse | TASK-001 | COMPLETED |
| TASK-006: Git safety alignment | TASK-001 | COMPLETED |
| TASK-007: Adapter parity audit | TASK-001 | COMPLETED |
| TASK-008: Documentation and verification | TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007 | COMPLETED |

## Task Breakdown

### TASK-001: Classify Current Shared-Function Reuse Gaps

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `impl-plans/active/self-improve-shared-function-reuse-audit.md`
**Dependencies**: None

**Description**:
Inspect self-improve modules and tests against the accepted design's reuse classifications. Record observed duplication, intended reuse/alignment target, and files owned by later tasks.

**Completion Criteria**:

- [x] Patcher, backup/pathing artifacts, git, JSON, source selection, and adapters have explicit classifications.
- [x] Every high or mid implementation gap is mapped to TASK-002 through TASK-008.
- [x] Intentional divergences are confirmed or narrowed.

### TASK-002: Reuse Workflow Path Validation in Patcher

**Status**: Completed
**Parallelizable**: Yes, after TASK-001
**Deliverables**: `src/workflow/self-improve/patcher.ts`, `src/workflow/self-improve/service.ts`, `src/workflow/self-improve/patcher.test.ts`, `src/workflow/self-improve/service.test.ts`
**Dependencies**: TASK-001

**Description**:
Align canonical patch writes with workflow-relative path validation and loader/schema validation while preserving the boundary from transient `node-patches.ts` runtime overrides.

**Completion Criteria**:

- [x] Unsafe patch paths are rejected before writes.
- [x] Prompt-file patch targets use shared prompt-template file path rules.
- [x] Workflow and node JSON patch targets validate through existing workflow loaders/schema.
- [x] Rollback behavior and `.git` preservation still pass.

### TASK-003: Audit Backup and Pathing Artifact Alignment

**Status**: Completed
**Parallelizable**: Yes, after TASK-001
**Deliverables**: `src/workflow/self-improve/backup.ts`, `src/workflow/self-improve/pathing.ts`, `src/workflow/paths.ts`, `src/workflow/self-improve/pathing.test.ts`, `src/workflow/self-improve/backup.test.ts`
**Dependencies**: TASK-001

**Description**:
Audit backup and self-improve log pathing against existing divedra root/path helpers. Reuse shared helper behavior where it owns path safety or root resolution, and document no-change decisions where self-improve artifacts must remain outside runtime node artifact directories.

**Completion Criteria**:

- [x] `backup.ts` and `pathing.ts` have explicit reuse, alignment, or intentional-divergence decisions.
- [x] Log-root resolution and workflow-directory identity follow shared path conventions or document why not.
- [x] Backup scoping excludes `.git`, preserves rollback metadata, and does not write outside the self-improve execution directory.
- [x] Focused backup/pathing tests cover helper alignment and no-change decisions.

### TASK-004: Align JSON Marker and Report Parsing

**Status**: Completed
**Parallelizable**: Yes, after TASK-001
**Deliverables**: `src/workflow/self-improve/marker-store.ts`, `src/workflow/self-improve/report.ts`, `src/workflow/self-improve/report.test.ts`
**Dependencies**: TASK-001

**Description**:
Replace unchecked persisted JSON casts with shared JSON object checks where report and marker reads affect public behavior, without changing direct serialization for internally generated reports.

**Completion Criteria**:

- [x] Corrupt or non-object markers do not silently advance since-last behavior.
- [x] Report reads fail explicitly for invalid persisted JSON.
- [x] Report listing skips invalid report entries consistently.

### TASK-005: Reuse Runtime Session Discovery Semantics

**Status**: Completed
**Parallelizable**: Yes, after TASK-001
**Deliverables**: `src/workflow/self-improve/source-selection.ts`, `src/workflow/self-improve/source-selection.test.ts`
**Dependencies**: TASK-001

**Description**:
Use runtime-db session summaries as an ordering/index source where available and hydrate through session-store records so file-backed session state remains authoritative.

**Completion Criteria**:

- [x] DB-indexed sessions are considered in existing runtime order.
- [x] Missing/stale DB rows fall back to file-backed session discovery.
- [x] Explicit source sessions still reject cross-workflow selections.
- [x] Current marker and limit semantics remain unchanged.

### TASK-006: Align Self-Improve Git Safety Rules

**Status**: Completed
**Parallelizable**: Yes, after TASK-001
**Deliverables**: `src/workflow/self-improve/git.ts`, `src/workflow/self-improve/backup-git.test.ts`
**Dependencies**: TASK-001

**Description**:
Keep self-improve git orchestration local to self-improve while matching native git add-on safety expectations for path normalization, pre-staged file detection, scoped staging, no-op commits, and no push.

**Completion Criteria**:

- [x] Escaped, absolute, empty, and directory changed-file entries fail safely.
- [x] Unexpected pre-staged files outside the self-improve changed set block the commit.
- [x] Unrelated unstaged files remain untouched.
- [x] No-op changed-file sets do not create empty commits.

### TASK-007: Verify Adapter Parity and Remove Duplicate Paths

**Status**: Completed
**Parallelizable**: Yes, after TASK-001
**Deliverables**: `packages/divedra/src/cli/workflow-command-handler.ts`, `packages/divedra/src/index.ts`, `src/graphql/types.ts`, `src/graphql/schema/execution-resolvers.ts`, `src/server/graphql-executable-schema.ts`, `src/cli.test.ts`, `src/lib-api.test.ts`, `src/graphql/schema.test.ts`, `src/server/graphql-queries-and-inspection.test.ts`
**Dependencies**: TASK-001

**Description**:
Audit public entrypoints for duplicate self-improve execution logic. Refactor only if any adapter bypasses the provider-neutral core service or typed GraphQL transport contract.

**Completion Criteria**:

- [x] Local adapters call the core service rather than duplicating execution behavior.
- [x] Endpoint-backed CLI/library calls use typed GraphQL self-improve fields.
- [x] Server read-only and no-exec guardrails remain enforced.

### TASK-008: Refresh Docs, Plan State, and Verification

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `README.md`, `design-docs/specs/design-self-improve.md`, `impl-plans/active/self-improve-shared-function-reuse-audit.md`, `impl-plans/README.md`
**Dependencies**: TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007

**Description**:
Document final reuse decisions, update plan status/progress, and run verification for the implemented refactors.

**Completion Criteria**:

- [x] Remaining intentional divergences are documented with reasons.
- [x] User-facing docs mention observable behavior changes, if any.
- [x] Focused tests, typecheck, lint/build checks, and diff checks are recorded.

## Parallelizable Tasks

After TASK-001 completes, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, and TASK-007 may proceed concurrently because their primary write scopes are disjoint. TASK-008 must run after implementation tasks complete.

## Reuse Classification Results

| Area | Decision | Paths | Resolution |
|------|----------|-------|------------|
| Patcher workflow-relative paths | reuse-required | `src/workflow/self-improve/patcher.ts`, `src/workflow/prompt-template-file.ts` | Prompt-file writes now call shared workflow-relative path validation; canonical writes are limited to `workflow.json` and `nodes/node-*.json` and still validate by reloading the workflow bundle. |
| Backup/pathing artifacts | align-required | `src/workflow/self-improve/backup.ts`, `src/workflow/self-improve/pathing.ts`, `src/workflow/paths.ts` | Self-improve keeps its separate log-root lifecycle, but execution and workflow report directories use shared scoped-path safety; backup tests cover self-improve execution-directory scoping and `.git` exclusion. |
| JSON marker/report reads | reuse-required | `src/workflow/self-improve/marker-store.ts`, `src/workflow/self-improve/report.ts`, `src/shared/json.ts` | Persisted marker/report reads now use `isJsonObject`; invalid report reads fail and report listing skips invalid entries. |
| Source selection discovery | align-required | `src/workflow/self-improve/source-selection.ts`, `src/workflow/runtime-db/session-query-records.ts`, `src/workflow/session-store.ts` | Runtime DB summaries are used as an index when a runtime DB root is configured, then selected runs are hydrated through file-backed `loadSession`; file-only fallback remains authoritative. |
| Git commit safety | align-required | `src/workflow/self-improve/git.ts`, `src/workflow/native-node-executor/git-and-addon-execution.ts` | Self-improve does not call the node add-on executor, but now mirrors its repo-relative normalization, directory/escape rejection, unexpected pre-staged file rejection, and no-empty-commit guard. |
| CLI/library/GraphQL/server adapters | intentional-divergence | `packages/divedra/src/cli/workflow-command-handler.ts`, `packages/divedra/src/index.ts`, `src/graphql/types.ts`, `src/graphql/schema/execution-resolvers.ts`, `src/server/graphql-executable-schema.ts` | Audit confirmed existing entrypoints remain thin adapters over core service or typed GraphQL transport; no duplicate manager-message execution path was found. |

## Verification Plan

Run focused verification after each task and the full set before handoff:

```bash
bun test src/workflow/self-improve/patcher.test.ts src/workflow/self-improve/service.test.ts
bun test src/workflow/self-improve/pathing.test.ts src/workflow/self-improve/backup.test.ts
bun test src/workflow/self-improve/source-selection.test.ts src/workflow/self-improve/backup-git.test.ts src/workflow/self-improve/config.test.ts
bun test src/graphql/schema.test.ts src/server/graphql-queries-and-inspection.test.ts src/cli.test.ts src/lib-api.test.ts
bun run typecheck
bun run lint:biome
bun run build
git diff --check
```

## Completion Criteria

- [x] All accepted Step 3 reuse-audit areas have been classified and addressed.
- [x] Reuse-required behavior calls existing helpers instead of local duplicates.
- [x] Align-required behavior has tests proving semantic parity with shared helpers.
- [x] Backup and pathing behavior has explicit reuse/no-change decisions for `src/workflow/self-improve/backup.ts`, `src/workflow/self-improve/pathing.ts`, and `src/workflow/paths.ts`.
- [x] Intentional divergences are documented in design or user-facing docs.
- [x] No self-improve refactor changes report-only side-effect boundaries, marker semantics, or git no-push behavior.
- [x] Verification commands pass or blocked failures are recorded with exact command output summaries.

## Progress Log

### Session: 2026-05-19 Step 4 Plan Creation

**Tasks Completed**: Plan created after Step 3 accepted `design-docs/specs/design-self-improve.md#shared-function-reuse-audit`.

**Notes**:

- Step 3 reported no high or mid design findings.
- Existing `impl-plans/active/self-improve.md` and `impl-plans/active/self-improve-review-hardening.md` are completed historical plans; this plan scopes the new duplicated-functionality reuse audit.
- Implementation must invoke the repository's TypeScript coding and check/test workflow before modifying TypeScript files.

### Session: 2026-05-19 Step 4 Rerun After Step 5 Review

**Tasks Completed**: Addressed Step 5 mid finding by adding TASK-003 for backup/pathing artifact alignment.

**Notes**:

- Step 5 found the original plan did not include concrete deliverables or criteria for `src/workflow/self-improve/backup.ts`, `src/workflow/self-improve/pathing.ts`, and `src/workflow/paths.ts`.
- Added explicit backup/pathing module, task, dependencies, completion criteria, verification command, and final completion criterion.

### Session: 2026-05-19 Step 4 Rerun After Self-Review

**Tasks Completed**: Addressed Step 4 self-review findings on parallel write scopes and explicit adapter deliverables.

**Notes**:

- Removed `src/workflow/self-improve/patcher.test.ts` from TASK-003 and assigned backup/pathing coverage to `src/workflow/self-improve/pathing.test.ts` plus `src/workflow/self-improve/backup.test.ts`, leaving TASK-002 as the sole owner of `patcher.test.ts`.
- Replaced TASK-007's prose deliverable with explicit CLI, library, GraphQL, server, and test file paths, leaving `src/workflow/self-improve/service.ts` as a read-only parity reference owned for writes by TASK-002.

### Session: 2026-05-19 Step 6 Implementation

**Tasks Completed**: TASK-001 through TASK-008 completed for issue-resolution mode.

**Notes**:

- Patcher now reuses workflow-relative prompt-template path validation for prompt-file writes, rejects absolute/escaped paths, and keeps canonical workflow writes distinct from transient `node-patches.ts` runtime overrides.
- Self-improve pathing keeps the intentional self-improve log-root lifecycle while using shared scoped-path safety for workflow report roots and execution ids.
- Marker/report reads now use `src/shared/json.ts` object checks; invalid report reads fail explicitly and report listing skips malformed entries.
- Source discovery uses runtime DB session summaries when configured, then hydrates selected runs through `loadSession`; file-backed discovery remains the fallback and authority.
- Git commit logic now normalizes repo-relative changed files, rejects unsafe or directory entries, blocks unexpected pre-staged files, avoids empty commits, and preserves no-push/no-attribution behavior.
- Adapter parity audit found no duplicate CLI/library/GraphQL/server execution path to refactor.

**Verification Recorded**:

- `bun test src/workflow/self-improve/patcher.test.ts src/workflow/self-improve/pathing.test.ts src/workflow/self-improve/backup.test.ts src/workflow/self-improve/report.test.ts src/workflow/self-improve/source-selection.test.ts src/workflow/self-improve/backup-git.test.ts src/workflow/self-improve/config.test.ts src/workflow/self-improve/service.test.ts` passed with 30 tests.
- `bun test src/graphql/schema.test.ts src/server/graphql-queries-and-inspection.test.ts src/cli.test.ts src/lib-api.test.ts` passed with 217 tests.
- `bun run typecheck` passed.
- `bun run lint:biome` passed with existing warnings in unrelated `src/workflow/engine/*` files.
- `bun run build` passed.
- `git diff --check` passed.
