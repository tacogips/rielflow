# Workflow Status Active Session Loadability Issue 25 Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-workflow-overview-status-surface.md#active-execution-loadability-contract`, `design-docs/specs/command.md#cli-workflow-status-name`
**Created**: 2026-05-18
**Last Updated**: 2026-05-18

---

## Design Document Reference

**Source**: `design-docs/specs/design-workflow-overview-status-surface.md`, `design-docs/specs/command.md`

### Summary

Resolve `tacogips/divedra#25`, the follow-up to `tacogips/divedra#23` and `tacogips/divedra#24`: `workflow status design-and-implement-review-loop --workflow-definition-dir <ign-worktree>/divedra-workflows` must not report `aggregateStatus: running`, `activeExecutionCount: 4`, or `newestActiveExecution` from session ids that direct `session status <id>` cannot load under the same workflow-definition-dir and storage options.

The accepted design makes persisted `WorkflowSessionState` loaded through the selected session store the primary authority for active overview rows. Runtime DB `sessions` rows, session indexes, cached overview records, and previous-root records are secondary only; they may enrich a summary after primary session load succeeds, but they must never independently mark a workflow as `running` or `paused`.

### Scope

**Included**:

- overview aggregation for `workflow list`, `workflow status`, browser overview, and GraphQL `workflowCatalogOverview` / `workflowStatusOverview`
- regression fixtures for stale active candidates from missing primary session files, corrupt primary session files, and runtime DB/session-index records that outlive the session payload
- direct `--workflow-definition-dir` storage-context parity with `session status`, `session progress`, and `session step-runs`
- focused documentation/plan tracking updates required by the implemented behavior

**Excluded**:

- fallback searches across unrelated project/user/direct runtime roots
- provider adapter changes for `codex-agent`, `claude-code-agent`, OpenAI SDK, Anthropic SDK, or Cursor
- broad runtime DB cleanup or migration commands
- new user-facing stale-session diagnostic modes beyond preserving the default active-row contract

### Codex Reference Trace

- `https://github.com/tacogips/divedra/issues/25`: primary issue report and acceptance behavior.
- `https://github.com/tacogips/divedra/issues/23`: prior storage-context/loadability issue that was only partially fixed.
- `https://github.com/tacogips/divedra/pull/24`: prior implementation context.
- `codex-agent`: execution backend/reference signal only; no implementation behavior is copied.
- `../../codex-agent`: preferred local reference path recorded by design as unavailable in this worktree context.

---

## Modules

### 1. Active Candidate Collection and Loadability Boundary

#### `src/workflow/overview.ts`

**Status**: COMPLETED

```ts
interface WorkflowOverviewActiveCandidate {
  readonly sessionId: string;
  readonly source: "session-store" | "runtime-db" | "session-index";
  readonly summary?: WorkflowExecutionCompactSummary;
}

type LoadableWorkflowOverviewSession = {
  readonly session: WorkflowSessionState;
  readonly summary: WorkflowExecutionCompactSummary;
};
```

**Checklist**:

- [x] Audit every candidate source used by `buildWorkflowCatalogOverview` and `buildWorkflowStatusOverview`.
- [x] Keep `loadSession(sessionId, scopedOptions)` as the gate before a non-terminal candidate can affect `aggregateStatus`, `activeExecutionCount`, `latestExecution`, `recentExecutions`, or `newestActiveExecution`.
- [x] Ensure missing, invalid, corrupt, or wrong-workflow primary session payloads are skipped as inactive for overview purposes.
- [x] Preserve terminal history behavior from loadable persisted session files.
- [x] Keep ordering and `--limit` behavior stable after stale candidates are removed.

### 2. Workflow Overview Regression Fixtures

#### `src/workflow/overview.test.ts`

**Status**: COMPLETED

```ts
interface StaleActiveOverviewFixture {
  readonly workflowRoot: string;
  readonly sessionStoreRoot: string;
  readonly rootDataDir: string;
  readonly workflowName: string;
  readonly staleSessionIds: readonly string[];
  readonly loadableTerminalSessionId?: string;
}
```

**Checklist**:

- [x] Add a fixture where multiple running/paused candidates exist only in runtime DB/index state and the matching primary session files are absent.
- [x] Assert catalog overview returns `activeExecutionCount: 0`, no `running`/`paused` aggregate, and no stale latest active row when only stale candidates exist.
- [x] Assert status overview returns `newestActiveExecution: null` and omits stale active rows from active recent output.
- [x] Add a mixed fixture proving loadable terminal history still determines aggregate status after stale active candidates are excluded.
- [x] Keep existing corrupt session-file regression coverage intact.

### 3. CLI Direct Workflow-Definition Regression

#### `src/cli.test.ts`

**Status**: COMPLETED

```ts
interface Issue25DirectWorkflowStatusFixture {
  readonly workflowDefinitionDir: string;
  readonly userRoot: string;
  readonly rootDataDir: string;
  readonly workflowName: "design-and-implement-review-loop";
  readonly staleSessionIds: readonly string[];
}
```

**Checklist**:

- [x] Reproduce the issue shape with `workflow status design-and-implement-review-loop --workflow-definition-dir <fixture>/divedra-workflows --output json`.
- [x] Seed stale ids matching the issue pattern, including `div-design-and-implement-review-loop-1777861733-fe70502e`, without corresponding primary session payloads.
- [x] Assert `activeExecutionCount` excludes all unloadable stale ids.
- [x] Assert `newestActiveExecution` is `null` or points only to a loadable active session.
- [x] Assert `aggregateStatus` is derived from loadable terminal history or `never-run`, never from stale active candidates.
- [x] Assert `session status <stale-id> --workflow-definition-dir <same-root> --output json` fails with session-not-found semantics in the same fixture.

### 4. GraphQL and Browser Overview Parity

#### `src/graphql/schema.test.ts`, `src/server/graphql-queries-and-inspection.test.ts`

**Status**: COMPLETED

```ts
interface WorkflowOverviewParityExpectation {
  readonly aggregateStatus: "never-run" | "completed" | "failed" | "cancelled";
  readonly activeExecutionCount: 0;
  readonly newestActiveExecution: null;
}
```

**Checklist**:

- [x] Cover `workflowCatalogOverview` with stale runtime DB/index active candidates and missing primary session payloads.
- [x] Cover `workflowStatusOverview` with the same stale candidates and verify `newestActiveExecution` is not unloadable.
- [x] Verify server GraphQL/browser-backed overview remains on the shared `buildWorkflowCatalogOverview` and `buildWorkflowStatusOverview` path.
- [x] Avoid duplicating lower-level fixture logic where `src/workflow/overview.test.ts` already proves the boundary.

### 5. Documentation and Plan Tracking

#### `README.md`, `design-docs/specs/command.md`, `design-docs/specs/design-workflow-overview-status-surface.md`, `impl-plans/README.md`, `impl-plans/active/workflow-status-active-session-loadability-issue-25.md`

**Status**: COMPLETED

```ts
interface ImplementationProgressEntry {
  readonly date: string;
  readonly tasksCompleted: readonly string[];
  readonly notes: string;
  readonly verification: readonly string[];
}
```

**Checklist**:

- [x] Update this plan's progress log after each implementation session.
- [x] Refresh user-facing docs only if final operator output or diagnostics change beyond the accepted design-doc wording.
- [x] Record any intentional divergence from the accepted Step 2 design.
- [x] Keep issue references to `tacogips/divedra#25`, `#23`, and `#24` explicit.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Active candidate loadability boundary | `src/workflow/overview.ts` | COMPLETED | `src/workflow/overview.test.ts` |
| Workflow overview regressions | `src/workflow/overview.test.ts` | COMPLETED | `bun test src/workflow/overview.test.ts` |
| CLI direct workflow-definition regression | `src/cli.test.ts` | COMPLETED | `bun test src/cli.test.ts` |
| GraphQL/server parity | `src/graphql/schema.test.ts`, `src/server/graphql-queries-and-inspection.test.ts` | COMPLETED | `bun test src/graphql/schema.test.ts`, `bun test src/server/graphql-queries-and-inspection.test.ts` |
| Documentation and tracking | `README.md`, `design-docs/specs/command.md`, `design-docs/specs/design-workflow-overview-status-surface.md`, `impl-plans/README.md`, this plan | COMPLETED | `git diff --check` |

## Task Breakdown

### TASK-001: Characterize Current Active Candidate Sources

**Status**: Completed
**Parallelizable**: No
**Deliverables**: Notes in this plan progress log; targeted failing tests in `src/workflow/overview.test.ts`
**Dependencies**: None

**Description**:
Trace whether stale active rows can reach overview aggregation from `listSessions`, runtime DB `sessions`, session snapshot indexes, server/browser paths, or mismatched direct-root storage resolution. Add the smallest failing overview-level fixture that demonstrates the issue-25 stale-candidate path.

**Completion Criteria**:

- [x] Candidate sources are enumerated in the progress log.
- [x] Regression coverage proves unloadable active candidates can no longer be counted.
- [x] The regression test uses the same selected storage context for overview and direct session loadability.

### TASK-002: Enforce Primary Session Loadability Before Active Contribution

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/overview.ts`, `src/workflow/overview.test.ts`
**Dependencies**: TASK-001

**Description**:
Constrain overview aggregation so any running/paused candidate must be backed by a successful `loadSession` from the scoped session store before contributing to active status, newest active selection, or recent active rows.

**Completion Criteria**:

- [x] `aggregateStatus` cannot be `running` or `paused` solely because of unloadable candidates.
- [x] `activeExecutionCount` excludes unloadable candidates.
- [x] `newestActiveExecution` never points to an unloadable session id.
- [x] Loadable terminal sessions still determine aggregate status when stale active candidates are removed.

### TASK-003: Add Direct CLI Regression for Issue 25

**Status**: Completed
**Parallelizable**: Yes, after TASK-001 fixture shape is known
**Deliverables**: `src/cli.test.ts`
**Dependencies**: TASK-001

**Description**:
Build a direct `--workflow-definition-dir` CLI fixture for `design-and-implement-review-loop` with stale running session ids matching the issue report and verify `workflow status` and `session status` agree on loadability.

**Completion Criteria**:

- [x] `workflow status ... --output json` reports no unloadable active sessions.
- [x] Stale ids are absent from `newestActiveExecution` and active recent rows.
- [x] Direct `session status <stale-id> ... --output json` fails as not found in the same context.
- [x] The regression includes multiple stale ids so aggregate counting cannot pass accidentally.

### TASK-004: Preserve GraphQL and Browser Overview Parity

**Status**: Completed
**Parallelizable**: Yes, after TASK-002
**Deliverables**: `src/graphql/schema.test.ts`, `src/server/graphql-queries-and-inspection.test.ts`
**Dependencies**: TASK-002

**Description**:
Verify GraphQL and server/browser overview entry points remain backed by the same loadability boundary, with no resolver-specific bypass for stale runtime DB/index active rows.

**Completion Criteria**:

- [x] `workflowCatalogOverview` excludes stale active candidates.
- [x] `workflowStatusOverview` excludes stale active candidates and has `newestActiveExecution: null` when no loadable active session exists.
- [x] Server GraphQL coverage proves endpoint-backed browser/CLI consumers inherit the same behavior.

### TASK-005: Final Verification and Documentation Refresh

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `impl-plans/active/workflow-status-active-session-loadability-issue-25.md`, optional docs if behavior text changes
**Dependencies**: TASK-002, TASK-003, TASK-004

**Description**:
Run targeted and full type verification, update the progress log, and refresh user-facing docs only when implementation changes observable command output beyond the accepted design.

**Completion Criteria**:

- [x] All targeted tests pass.
- [x] Type checking passes.
- [x] `git diff --check` passes.
- [x] Progress log records completed tasks, verification commands, and any intentional design divergence.

---

## Dependencies

| Task | Depends On | Reason |
|------|------------|--------|
| TASK-001 | None | Establish the failing stale-candidate source before implementation. |
| TASK-002 | TASK-001 | The implementation boundary depends on the confirmed candidate source. |
| TASK-003 | TASK-001 | CLI fixture should reuse the confirmed stale-source shape. |
| TASK-004 | TASK-002 | GraphQL/server parity should test the final shared overview boundary. |
| TASK-005 | TASK-002, TASK-003, TASK-004 | Verification and docs depend on final behavior. |

## Parallelization

| Task | Parallelizable | Write Scope |
|------|----------------|-------------|
| TASK-001 | No | `src/workflow/overview.test.ts`, progress log |
| TASK-002 | No | `src/workflow/overview.ts`, `src/workflow/overview.test.ts` |
| TASK-003 | Yes, after TASK-001 | `src/cli.test.ts` |
| TASK-004 | Yes, after TASK-002 | `src/graphql/schema.test.ts`, `src/server/graphql-queries-and-inspection.test.ts` |
| TASK-005 | No | docs and plan tracking |

## Verification Plan

Run:

```bash
bun test src/workflow/overview.test.ts
bun test src/cli.test.ts
bun test src/graphql/schema.test.ts
bun test src/server/graphql-queries-and-inspection.test.ts
bun run tsc --noEmit
git diff --check
```

Optional manual smoke check if a fixture workflow root is available:

```bash
bun run src/main.ts workflow status design-and-implement-review-loop --workflow-definition-dir <ign-worktree>/divedra-workflows --output json
bun run src/main.ts session status div-design-and-implement-review-loop-1777861733-fe70502e --workflow-definition-dir <ign-worktree>/divedra-workflows --output json
```

## Completion Criteria

- [x] Issue `tacogips/divedra#25` acceptance signals are covered by tests.
- [x] `workflow status` excludes unloadable active candidates from `activeExecutionCount`, `newestActiveExecution`, active recent rows, and aggregate running/paused derivation.
- [x] `workflow list`, GraphQL overview, and browser overview preserve parity through shared overview builders.
- [x] Direct `session status` not-found behavior remains scoped and does not search unrelated roots.
- [x] No provider adapter behavior changes are introduced for `codex-agent` or other backends.
- [x] Verification commands pass or any blocked command is recorded with reason.

## Progress Log

### Session: 2026-05-18 Step 4 Implementation Plan Creation

**Tasks Completed**: Planning only.

**Notes**: Created issue-25-specific active implementation plan after Step 3 accepted the design. The existing `impl-plans/workflow-status-active-session-loadability.md` is issue-23 oriented and marked mostly complete, so this plan isolates the remaining stale runtime DB/session-index behavior reported by issue #25.

**Verification**:

- `git diff --check -- impl-plans/active/workflow-status-active-session-loadability-issue-25.md impl-plans/README.md` passed.

### Session: 2026-05-18 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.

**Notes**: Confirmed the active overview path in `src/workflow/overview.ts` is primary session-store based: `listSessions` provides candidate ids and `loadSession(sessionId, scopedOptions)` remains the gate before a candidate contributes to `aggregateStatus`, `activeExecutionCount`, `latestExecution`, `recentExecutions`, or `newestActiveExecution`. Runtime DB `sessions` rows from `saveSessionSnapshotToRuntimeDb` are secondary/index data and are not active overview authority without a loadable primary session payload. Refactored the overview collector to make the loadability gate explicit, added issue #25 regressions for missing primary payloads behind stale runtime DB rows, added the direct `--workflow-definition-dir` CLI fixture with the reported stale ids, and preserved GraphQL/browser parity through shared overview builders. No user-facing output or diagnostics changed beyond enforcing the accepted Step 2 design, so `README.md` did not need a Step 6 refresh. No `codex-agent` provider or backend adapter behavior was changed.

**Candidate Sources Audited**:

- `session-store`: primary candidate source for `buildWorkflowCatalogOverview` and `buildWorkflowStatusOverview`; candidates are ignored unless `loadSession` succeeds in the resolved storage context.
- `runtime-db sessions`: exercised as stale secondary/index data in overview, CLI, GraphQL schema, and server GraphQL tests; missing primary session files cannot make rows active.
- `session snapshot indexer`: writes runtime DB snapshots through `saveSessionSnapshotToRuntimeDb`; covered by the same stale runtime DB fixtures.
- GraphQL/browser overview: `workflowCatalogOverview`, `workflowStatusOverview`, and `/graphql` remain backed by `buildWorkflowCatalogOverview` and `buildWorkflowStatusOverview`.

**Addressed Feedback**: Step 5 low finding on TASK-001 wording was addressed by clarifying the completion criterion from failing-before-fix wording to passing regression coverage.

**Verification**:

- `bun test src/workflow/overview.test.ts` passed.
- `bun test src/cli.test.ts -t "workflow status excludes unloadable runtime-db active sessions"` passed.
- `bun test src/graphql/schema.test.ts -t "workflowCatalogOverview and workflowStatusOverview expose only loadable active sessions"` passed.
- `bun test src/server/graphql-queries-and-inspection.test.ts -t "routes /graphql queries through the GraphQL control-plane handler"` passed.
- `bun test src/workflow/overview.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql-queries-and-inspection.test.ts` passed.
- `biome check src/workflow/overview.ts src/workflow/overview.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql-queries-and-inspection.test.ts --diagnostic-level=warn` passed.
- `bun run check:source-filenames` passed.
- `bun run typecheck` passed.
- `git diff --check` passed.
- `bun run lint:biome` was attempted and blocked by pre-existing unrelated `noExplicitAny` diagnostics in `src/workflow/engine/*.ts`, outside the issue #25 touched files.

### Session: 2026-05-18 Step 6 Rerun After Self-Review

**Tasks Completed**: TASK-003 follow-up, TASK-005 verification refresh.

**Notes**: Addressed the high-severity Step 6 self-review finding for the exact issue #25 direct-root shape. `resolveSessionCommandStorageOptions` now treats an explicit `--workflow-definition-dir` that is not under a recognized `.divedra/workflows` scope as direct storage instead of falling through to the current working directory's project scope. Added a regression for `<fixture>/divedra-workflows` proving `workflow status` and `session status` share the same direct storage context for the reported `div-design-and-implement-review-loop-1777861733-fe70502e` id. Renamed the previous stale runtime DB CLI regression to clarify it covers the project-scoped `.divedra/workflows` path. Updated `impl-plans/README.md` status to match this plan's completed state. No `codex-agent` provider or backend adapter behavior was changed.

**Addressed Feedback**: Step 6 self-review high finding on non-scoped direct workflow-definition-dir storage mismatch was fixed in `packages/divedra/src/cli/storage-and-options.ts` and covered in `src/cli.test.ts`.

**Verification**:

- `bun test src/cli.test.ts -t "workflow status and session commands share direct workflow-definition storage outside project scopes"` passed.
- `bun test src/cli.test.ts -t "workflow status excludes unloadable runtime-db active sessions in project-scoped workflow-definition context"` passed.
- `bun test src/cli.test.ts -t "workflow status"` passed.
- `bun test src/workflow/overview.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql-queries-and-inspection.test.ts` passed.
- `biome check packages/divedra/src/cli/storage-and-options.ts src/workflow/overview.ts src/workflow/overview.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql-queries-and-inspection.test.ts --diagnostic-level=warn` passed.
- `bun run typecheck` passed.
- `git diff --check` passed.
