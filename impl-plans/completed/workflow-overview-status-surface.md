# Workflow Overview Status Surface Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-workflow-overview-status-surface.md`
**Created**: 2026-05-01
**Last Updated**: 2026-05-01

## Related Plans

- **Depends On**: existing scoped workflow catalog and execution/session summary surfaces
- **Related**: `impl-plans/graphql-workflow-execution-overview.md`
- **Related**: `impl-plans/completed/root-data-dir-project-root-scoping.md`
- **Related**: `impl-plans/completed/workflow-serve-mvp.md`

## Design Document Reference

**Source**: `design-docs/specs/design-workflow-overview-status-surface.md`,
`design-docs/specs/architecture.md#human-workflow-overview-boundary`,
`design-docs/specs/command.md`

### Summary

Add a human-facing workflow overview layer for catalog discovery and selected
workflow status. The surface must show scoped workflow identity, aggregate
workflow status, active execution count, latest execution summary, and recent
execution summaries without exposing node logs, communication payloads, hook
events, or reply dispatch detail.

### Review Constraints

- Reuse existing `WorkflowSourceScope`; do not create a parallel source-scope
  taxonomy.
- Build execution summaries with `withResolvedWorkflowSourceOptions(source,
  options)` so project/user artifact roots and session stores do not bleed
  into each other.
- GraphQL summary queries accept the same scope selector as CLI commands;
  direct workflow-root behavior stays server/context-driven.
- Existing `serve` exposes API/GraphQL routes only, so the browser task must
  add the root overview response or static-page entrypoint before wiring data.

### Scope

**Included**: shared overview model, aggregate status derivation, GraphQL summary
queries, `workflow list`, `workflow status <name>`, browser default overview
data, and regression tests for scoped duplicates and `never-run`.

**Excluded**: new TUI flows, mutation controls, real-time streaming, node-level
debugging detail, and replacement of existing execution-specific queries.

## Modules

### 1. Shared Workflow Overview Model

#### `src/workflow/overview.ts`, `src/shared/ui-contract.ts`

**Status**: COMPLETED

```typescript
import type { WorkflowExecutionCompactSummary } from "../shared/ui-contract";

export type WorkflowOverviewSourceScope = WorkflowSourceScope;

export type WorkflowOverviewStatus =
  | WorkflowSessionState["status"]
  | "never-run";

export interface WorkflowOverviewRow {
  readonly workflowName: string;
  readonly sourceScope: WorkflowOverviewSourceScope;
  readonly workflowDirectory: string;
  readonly description: string;
  readonly aggregateStatus: WorkflowOverviewStatus;
  readonly activeExecutionCount: number;
  readonly latestExecution: WorkflowExecutionCompactSummary | null;
}

export interface WorkflowStatusOverview extends WorkflowOverviewRow {
  readonly recentExecutions: readonly WorkflowExecutionCompactSummary[];
  readonly newestActiveExecution: WorkflowExecutionCompactSummary | null;
}

export interface WorkflowOverviewQueryOptions extends LoadOptions {
  readonly status?: WorkflowOverviewStatus;
  readonly limit?: number;
  readonly fixedWorkflowName?: string;
}

export function deriveWorkflowOverviewStatus(
  executions: readonly WorkflowExecutionCompactSummary[],
): WorkflowOverviewStatus;
```

**Checklist**:

- [x] Define overview status, row, selected-status, and compact execution summary types
- [x] Implement aggregate status precedence: `running`, `paused`, latest terminal, `never-run`
- [x] Preserve list identity as `(sourceScope, workflowName, workflowDirectory)` via `WorkflowOverviewRow`
- [x] Sort recent executions newest first by `startedAt`, then execution id
- [x] Re-export compact summary alias on the UI contract (`WorkflowExecutionCompactSummary` in `ui-contract.ts`)

### 2. Catalog And Execution Summary Builder

#### `src/workflow/overview.ts`, `src/workflow/overview.test.ts`

**Status**: COMPLETED

```typescript
export interface WorkflowCatalogOverviewInput {
  readonly workflowScope?: WorkflowScopeSelector;
  readonly status?: WorkflowOverviewStatus;
  readonly limit?: number;
}

export interface WorkflowStatusOverviewInput {
  readonly workflowName: string;
  readonly workflowScope?: WorkflowScopeSelector;
  readonly limit?: number;
}

export interface WorkflowCatalogOverview {
  readonly workflows: readonly WorkflowOverviewRow[];
}

export function buildWorkflowCatalogOverview(
  input: WorkflowCatalogOverviewInput,
  options?: LoadOptions & SessionStoreOptions,
): Promise<Result<WorkflowCatalogOverview, WorkflowCatalogFailure | SessionStoreFailure>>;

export function buildWorkflowStatusOverview(
  input: WorkflowStatusOverviewInput,
  options?: LoadOptions & SessionStoreOptions,
): Promise<Result<WorkflowStatusOverview, WorkflowCatalogFailure | SessionStoreFailure>>;

export function pickNewestActiveExecution(
  executions: readonly WorkflowExecutionCompactSummary[],
): WorkflowExecutionCompactSummary | null;
```

**Checklist**:

- [x] Reuse `listWorkflowCatalogSources` so scoped duplicates remain visible
- [x] Reuse `resolveWorkflowSource` for selected workflow status resolution
- [x] Load workflow descriptions from canonical workflow bundles (`workflow.json` lightweight read)
- [x] Derive execution summaries from session history without loading node logs or communications
- [x] Use per-source scoped storage options before calling `listSessions` / `loadSession`
- [x] Label direct workflow-root rows as `direct`

### 3. GraphQL Summary Queries

#### `src/graphql/types.ts`, `src/graphql/schema.ts`, `src/server/graphql-executable-schema.ts`

**Status**: COMPLETED

```typescript
export interface WorkflowCatalogOverviewGraphqlInput {
  readonly workflowScope?: WorkflowScopeSelector;
  readonly status?: WorkflowOverviewStatus;
  readonly limit?: number;
}

export interface WorkflowStatusOverviewGraphqlInput {
  readonly workflowName: string;
  readonly workflowScope?: WorkflowScopeSelector;
  readonly limit?: number;
}

export interface WorkflowCatalogOverviewGraphqlPayload {
  readonly workflows: readonly WorkflowOverviewRow[];
}

export interface WorkflowStatusOverviewGraphqlPayload extends WorkflowStatusOverview {}
```

**Checklist**:

- [x] Add `workflowCatalogOverview(workflowScope, status, limit)` query
- [x] Add `workflowStatusOverview(workflowName, workflowScope, limit)` query
- [x] Ensure `fixedWorkflowName` serve context restricts overview visibility
- [x] Keep existing detail queries backward compatible and separate
- [x] SDL exposes overview object types without reusing node/log detail types
- [x] Add schema and HTTP transport tests for fixed-mode boundary cases and status-overview shapes

### 4. CLI Overview Commands

#### `src/cli.ts`, `src/cli.test.ts`

**Status**: COMPLETED

```typescript
interface WorkflowOverviewCliOptions {
  readonly workflowScope?: WorkflowScopeSelector;
  readonly workflowRoot?: string;
  readonly status?: WorkflowOverviewStatus;
  readonly limit?: number;
  readonly output: "table" | "json";
}

function renderWorkflowOverviewTable(
  rows: readonly WorkflowOverviewRow[],
): readonly string[];

function renderWorkflowStatusOverviewText(
  overview: WorkflowStatusOverview,
): readonly string[];
```

**Checklist**:

- [x] Implement `workflow list` with `--status`, `--limit`, and `--output table|json`
- [x] Implement `workflow status <name>` with `--limit` and `--output table|json`
- [x] Print source scope and workflow directory so shadowing is visible
- [x] Return success for an empty workflow list and non-zero for missing selected workflow
- [x] `--output table` renders the table-oriented human view; `--output json` emits the GraphQL-shaped payload
- [x] Use summary GraphQL queries for remote CLI execution paths

### 5. Browser Overview Default

#### `src/server/api.ts`, `src/server/serve.ts`, `src/server/serve.test.ts`, `src/server/api.test.ts`

**Status**: COMPLETED

```typescript
export interface BrowserWorkflowOverviewViewModel {
  readonly workflows: readonly WorkflowOverviewRow[];
  readonly selectedWorkflow: WorkflowStatusOverview | null;
}

export interface SelectDefaultWorkflowOverviewRowOptions {
  readonly fixedWorkflowName?: string;
  readonly fixedResolvedWorkflowSource?: ResolvedWorkflowSource;
}

export function selectDefaultWorkflowOverviewRow(
  rows: readonly WorkflowOverviewRow[],
  options?: SelectDefaultWorkflowOverviewRowOptions,
): WorkflowOverviewRow | null;
```

**Checklist**:

- [x] Add the root browser/overview entrypoint under `serve`
- [x] Default browser mode under `serve` to workflow list plus selected workflow status
- [x] Select fixed workflow first when `serve [workflow-name]` constrains access
- [x] Otherwise prefer first running workflow, newest execution, then first stable catalog row
- [x] Keep node graphs, node logs, communications, hook events, and reply dispatches out of the default page
- [x] Cover empty catalog, never-run workflow, and fixed-workflow serve mode (overview route and selection helpers)

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Shared overview model | `src/workflow/overview.ts`, `src/shared/ui-contract.ts` | COMPLETED | `src/workflow/overview.test.ts` passing |
| Catalog and status builders | `src/workflow/overview.ts` | COMPLETED | `src/workflow/overview.test.ts` |
| GraphQL summary queries | `src/graphql/types.ts`, `src/graphql/schema.ts`, `src/server/graphql-executable-schema.ts` | COMPLETED | `src/graphql/schema.test.ts`, `src/server/graphql.test.ts` |
| CLI overview commands | `src/cli.ts` | COMPLETED | `src/cli.test.ts` |
| Browser overview default | `src/server/api.ts` | COMPLETED | `src/server/serve.test.ts`, `src/server/api.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| TASK-001 Shared model | existing catalog/session summary types | READY |
| TASK-002 Summary builders | TASK-001 | COMPLETED |
| TASK-003 GraphQL summary queries | TASK-002 | COMPLETED |
| TASK-004 CLI commands | TASK-002, TASK-003 | COMPLETED |
| TASK-005 Browser overview | TASK-002, TASK-003 | COMPLETED |

## Tasks

### TASK-001: Shared Overview Types And Status Derivation

**Status**: Completed
**Parallelizable**: Yes
**Dependencies**: None

**Deliverables**:

- `src/workflow/overview.ts`
- `src/shared/ui-contract.ts`
- focused aggregate-status unit tests

**Completion Criteria**:

- [x] Overview status includes existing runtime statuses plus `never-run`
- [x] Active execution count includes only `running` and `paused`
- [x] Latest and recent execution ordering is deterministic
- [x] Type checking passes under strict TypeScript settings

### TASK-002: Catalog And Selected Workflow Summary Builders

**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-001

**Deliverables**:

- `src/workflow/overview.ts`
- `src/workflow/overview.test.ts`

**Completion Criteria**:

- [x] Catalog overview returns one row per visible scoped workflow
- [x] Duplicate project/user workflow names remain distinct
- [x] Direct workflow-root rows use source scope `direct`
- [x] Never-run workflows return null latest/recent executions (empty `recentExecutions` for status overview)
- [x] Project/user/direct session summaries are read through source-scoped options
- [x] No node logs, communication payloads, hook events, or reply dispatches are loaded
- [x] `newestActiveExecution` is derived from full execution history (not only the `recentExecutions` slice)

### TASK-003: GraphQL Overview Query Surface

**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-002

**Deliverables**:

- `src/graphql/types.ts`
- `src/graphql/schema.ts`
- `src/server/graphql-executable-schema.ts`
- `src/graphql/schema.test.ts`
- `src/server/graphql.test.ts`

**Completion Criteria**:

- [x] `workflowCatalogOverview` returns scoped rows and accepts scope/status/limit filters
- [x] `workflowStatusOverview` resolves one workflow and returns recent executions
- [x] `workflowStatusOverview` exposes nullable `newestActiveExecution` alongside recent executions
- [x] Fixed-workflow server context hides unrelated workflows
- [x] JSON shape includes `sourceScope` and `workflowDirectory`
- [x] HTTP GraphQL tests cover duplicate names and `never-run`

### TASK-004: CLI Workflow List And Status Commands

**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-002, TASK-003

**Deliverables**:

- `src/cli.ts`
- `src/cli.test.ts`

**Completion Criteria**:

- [x] `workflow list` supports table-style text output and JSON output
- [x] `workflow list --status` filters aggregate status
- [x] `workflow status <name>` prints compact selected workflow status
- [x] Missing selected workflow exits non-zero with a direct message
- [x] Remote CLI mode uses overview GraphQL queries instead of detail queries
- [x] Human `workflow status` output includes latest `endedAt` and a `newestActiveExecution` summary line when GraphQL supplies it

### TASK-005: Browser Overview Default Surface

**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-002, TASK-003

**Deliverables**:

- `src/server/api.ts`
- `src/server/serve.ts`
- `src/server/serve.test.ts`
- `src/server/api.test.ts`

**Completion Criteria**:

- [x] `divedra serve` exposes a root overview entrypoint backed by overview-only data
- [x] Default selection follows fixed workflow, running workflow, newest execution, stable catalog order
- [x] Empty and missing-workflow states are explicit
- [x] Default page omits node/runtime detail surfaces
- [x] Tests cover fixed workflow and unconstrained catalog modes
- [x] HTML overview renders description, latest execution start/end, and newest active execution step for the selection

## Completion Criteria

- [x] All overview model, GraphQL, CLI, and browser modules implemented
- [x] Duplicate scoped names are visible in human list surfaces
- [x] `never-run` appears for workflows without executions
- [x] `workflow list` and `workflow status` do not expose detailed runtime artifacts
- [x] `bun run typecheck` passes
- [x] Relevant Vitest suites pass

## Review Feedback

### Review: 2026-05-01

**Reviewed**: Current git diff, untracked overview implementation, and plan.

- [x] Align CLI output vocabulary with design (`command.md`): `workflow list` uses
  `--output table|json` (human table vs JSON); existing global `--output text|json`
  remains for other GraphQL-backed commands unless TASK-004 introduces a dedicated flag.
- [x] Keep GraphQL overview SDL intentionally compact; the current
  `WorkflowExecutionCompactSummary` alias is acceptable for TASK-001, but must
  not leak future node/log/detail fields if `WorkflowExecutionSummary` grows.
- [x] TASK-001 helpers match aggregate-status and active-count rules.
- [x] Verified `bun test src/workflow/overview.test.ts` and `bun run typecheck`.
- [x] TASK-002 catalog/status builders implemented (`buildWorkflowCatalogOverview`, `buildWorkflowStatusOverview`, lightweight `workflow.json` meta read, `workflowId` disambiguation).
- [x] TASK-004 CLI and TASK-005 browser surfaces implemented (`workflow list` / `workflow status`, GET `/` and `/overview`).

### Review: 2026-05-01 GraphQL Overview Diff

**Reviewed**: Current git diff including `src/graphql/schema.ts`,
`src/graphql/types.ts`, `src/server/graphql-executable-schema.ts`,
`src/graphql/schema.test.ts`, `src/server/graphql.test.ts`, the untracked
`src/workflow/overview.ts` / `src/workflow/overview.test.ts`, and design-doc
updates.

**Findings** (historical — all resolved before 2026-05-02; see **Resolved Prior
Findings** below):

- [x] Fixed-mode catalog build filtered source-aware pinned workflow before heavy
      catalog reads (`buildWorkflowCatalogOverview` fixed resolved source).
- [x] Fixed-mode scoped duplicate rows resolved via pinned resolved workflow
      source alignment with GraphQL/serve selection.
- [x] Regression tests: malformed sibling bundles skipped when pinned;
      duplicate-name pinning (`schema.test.ts`, `overview.test.ts`).
- [x] HTTP GraphQL transport covers `workflowStatusOverview` with scoped fields.
- [x] Focused verification passed:
  `bun test src/workflow/overview.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts`
  and `bun run typecheck`.
- [x] GraphQL query/resolver wiring is present and backward-compatible with the
  existing detail query surface.

### Review: 2026-05-01 Current Diff Follow-up

**Reviewed**: Additional current worktree changes in `src/cli.ts` and
`src/server/api.ts` that appeared after the GraphQL review pass.

**Findings** (historical — addressed in **Follow-up resolution (2026-05-02)**
above and current tree; typecheck/tests green):

- [x] CLI/API compile and import issues resolved.
- [x] Fixed overview API aligns with pinned source and `selectDefaultWorkflowOverviewRow`.
- [x] GET `/` serves HTML overview; `/overview` serves JSON (`src/server/api.ts`).
- [x] `bun run typecheck` and focused overview suites re-verified on final diff.

### Review: 2026-05-01 Current Implementation Review

**Reviewed**: Full current git diff for the workflow overview/status surface,
including CLI, GraphQL, server API, overview model/tests, design-doc updates,
and implementation-plan tracking files.

**Follow-up resolution (2026-05-02)**:

- [x] Command-specific guard: `--output table` is rejected outside
  `workflow list` and `workflow status` (`src/cli.ts`).
- [x] Browser default: GET `/` serves a minimal read-only two-pane HTML page
  that loads JSON from GET `/overview`; machine clients use `/overview` for the
  structured view model (`src/server/api.ts`).
- [x] Browser recent-execution cap set to `10` with regression coverage
  (`BROWSER_WORKFLOW_OVERVIEW_RECENT_LIMIT`, `serve.test.ts`).
- [x] Plan tracking: phase `153` set to `COMPLETED` in `impl-plans/PROGRESS.json`,
  `impl-plans/README.md` updated, plan archived under `impl-plans/completed/`.

**Optional**:

- [x] `workflow list --output text` renders the human table formatting; document
      if that alias should narrow to `--output table` only. (Resolved: `--output text`
      and `--output table` are equivalent for `workflow list` / `workflow status`;
      documented in `command.md`, CLI help text, default remains `text`.)

**Resolved Prior Findings**:

- [x] The fixed resolved workflow source is now carried through serve/GraphQL
  context and `buildWorkflowCatalogOverview`, preventing pinned fixed-mode
  catalog reads from loading sibling malformed bundles.
- [x] Fixed-mode scoped duplicate handling is covered by the new GraphQL schema
  regression test and source-aware default-row selection test.
- [x] HTTP GraphQL transport now covers `workflowStatusOverview` with
  `recentExecutions`, `sourceScope`, and `workflowDirectory`.

**Verification**:

- [x] `bun run typecheck`
- [x] `bun test src/workflow/overview.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/server/api.test.ts src/server/serve.test.ts src/cli.test.ts`

### Review: 2026-05-01 Current Diff Review

**Reviewed**: Current git diff for the completed workflow overview/status
surface, including the staged overview implementation, unstaged CLI/help text
updates, GraphQL schema/HTTP transport wiring, browser overview API/page, and
plan/progress metadata.

**Findings**:

- [x] `selectDefaultWorkflowOverviewRow` prefers a `running` workflow before any
  `paused` workflow (running pass, then paused pass), covered by
  `overview.test.ts`; browser default selection aligns with design default
  selection rules.
- [x] Browser overview detail and `/overview` JSON include latest execution
  start/end times plus `newestActiveExecution` (newest running/paused from
  full history) for the active step line; `serve.test` / `overview.test` cover
  regression cases.

**Verification**:

- [x] `bun run typecheck`
- [x] `bun test src/workflow/overview.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/server/serve.test.ts src/server/api.test.ts src/cli.test.ts`

### Review: 2026-05-01 Final Current Diff Review

**Reviewed**: Workflow overview/status staged and unstaged diff, including
`src/workflow/overview.ts`, `src/graphql/schema.ts`,
`src/server/graphql-executable-schema.ts`, `src/server/api.ts`, `src/cli.ts`,
the matching tests, and plan/progress metadata. Later step-run-history rerun
worktree changes are reviewed separately in
`impl-plans/step-run-history-rerun-foundation.md`.

**Findings**:

- [x] `CliDependencies.startServe` now reuses `ServeStartOptions`, so the fixed
  workflow source pin is part of the declared injected contract instead of an
  undeclared extra field on the CLI dependency surface.

**Confirmed**:

- [x] Fixed-source catalog overview filters the pinned source before per-bundle
  metadata reads, so hidden malformed sibling bundles do not break fixed-mode
  overview.
- [x] Session summaries are built through source-scoped options and filtered by
  canonical workflow id, preserving project/user duplicate isolation.
- [x] GraphQL, CLI, and browser surfaces expose compact overview/status data
  without node logs, communications, hook events, or reply dispatch details.
- [x] `/` serves the read-only HTML shell and `/overview` serves the structured
  JSON view model with the browser recent-execution cap.

**Residual Risk**:

- [ ] Browser rendering is covered by HTML/API assertions rather than a real
  browser visual test. This is acceptable for this slice, but a richer browser
  UI should add Playwright coverage.

**Verification**:

- [x] `bun run typecheck`
- [x] `bun test src/workflow/overview.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/server/api.test.ts src/server/serve.test.ts src/cli.test.ts`
- [ ] Current full worktree typecheck is blocked by separate step-run-history
  rerun foundation changes; see
  `impl-plans/step-run-history-rerun-foundation.md`.

## Progress Log

### Session: 2026-05-01 Final Current Diff Review

**Tasks Completed**: Reviewed the workflow overview/status implementation diff,
including overview builders, GraphQL schema/resolvers, CLI local/remote overview
commands, browser overview API/page, tests, and plan metadata. Recorded one
minor type-contract follow-up for `CliDependencies.startServe`; separate
step-run-history rerun changes are reviewed in their foundation plan.
**Tasks In Progress**: None.
**Blockers**: None; the remaining item is a low-risk typing cleanup, not a
runtime blocker.
**Verification**: Overview-focused verification passed before the separate
step-run-history rerun diff was included in the worktree:
`bun test src/workflow/overview.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/server/api.test.ts src/server/serve.test.ts src/cli.test.ts`.

### Session: 2026-05-01 Review follow-up (default selection + browser detail)

**Tasks Completed**: `selectDefaultWorkflowOverviewRow` now prefers `running` before
`paused`; `WorkflowStatusOverview` includes `newestActiveExecution` from full
execution history; GraphQL SDL + CLI query/parse + browser HTML + list row
latest-started alignment; tests in `overview.test.ts` and `schema.test.ts`.
**Verification**: `bun run typecheck`, full Vitest (818 tests).

### Session: 2026-05-01 Current Diff Review

**Tasks Completed**: Reviewed the current implementation and current git diff,
including unstaged CLI/help-text updates; recorded two design-alignment findings
in this completed plan.
**Tasks In Progress**: Follow-up fixes for browser default selection precedence
and selected-workflow browser detail rendering.
**Blockers**: None; focused tests and typecheck pass.
**Notes**: No TypeScript production code was changed during this review.

### Session: 2026-05-02

**Tasks Completed**: Addressed outstanding review items for TASK-004/TASK-005:
CLI `--output table` scoping; HTML overview at `/` with JSON at `/overview`;
browser recent limit `10` + regression test; `PROGRESS.json` phase 153 /
`README.md` normalization; archived plan to `impl-plans/completed/`.

**Verification**: `bun run typecheck`, full Vitest suite (813 tests).

### Session: 2026-05-01 Review
**Tasks Completed**: Reviewed implementation and diff; verified TASK-001 helpers
**Tasks In Progress**: TASK-002 through TASK-005 remain pending (superseded below)
**Blockers**: Resolve CLI output contract mismatch before TASK-004
**Notes**: Current implementation covers shared types, sorting, active-count,
and aggregate-status helpers only.

### Session: 2026-05-01 TASK-002
**Tasks Completed**: Catalog and status overview builders, integration tests, NOT_FOUND for direct-root missing bundles after `resolveWorkflowSource`.
**Tasks In Progress**: TASK-003 GraphQL summary queries next.
**Blockers**: CLI `--output table|json` vs `text|json` wording before TASK-004.
**Notes**: `workflowExecutionCompactSummaryFromSession` resolves `currentStepId` from session only (no bundle load). Full test suite green.

### Session: 2026-05-01 TASK-003
**Tasks Completed**: GraphQL `workflowCatalogOverview` / `workflowStatusOverview` queries,
SDL overview types (`WorkflowExecutionCompactSummary`, row/payload types), fixed-workflow
filtering on catalog overview, schema + HTTP tests.
**Tasks In Progress**: TASK-004 CLI `workflow list` / `workflow status` next (deps satisfied).
**Blockers**: None.
**Notes**: `workflowStatusOverview` returns null on workflow catalog `NOT_FOUND` (distinct from
session-store `session not found`). Targeted Vitest suites green; full suite may occasionally hit an
unrelated engine stall-timeout flake.

### Session: 2026-05-01 GraphQL Review
**Tasks Completed**: Reviewed TASK-003 implementation diff and untracked
overview files; verified focused tests and typecheck.
**Tasks In Progress**: TASK-003 needs fixed-workflow boundary hardening and
additional coverage before unblocking TASK-004/TASK-005.
**Blockers**: Fixed-mode source restriction for duplicate names and hidden
unrelated workflow metadata failures.
**Notes**: No production code was changed during this review; feedback was
recorded in this plan.

### Session: 2026-05-01 Current Diff Follow-up
**Tasks Completed**: Re-reviewed the newer CLI/API diff and reran typecheck.
**Tasks In Progress**: TASK-003 fixed-mode hardening, plus partial TASK-004/TASK-005
worktree changes that currently do not compile.
**Blockers**: `bun run typecheck` fails on the current diff; see Review Feedback
for file/line details.
**Notes**: Feedback only; no production code fixes were applied.

### Session: 2026-05-01 Implementation
**Tasks Completed**: TASK-001 code in `src/workflow/overview.ts`, `overview.test.ts`, `WorkflowExecutionCompactSummary` in `ui-contract.ts`
**Tasks In Progress**: TASK-002 next
**Blockers**: Same as prior review (CLI `--output` vocabulary) before TASK-004
**Notes**: Full Vitest suite green after changes

### Session: 2026-05-01
**Tasks Completed**: Plan creation and review hardening from current design diff
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Review clarified source scope, storage, GraphQL, CLI, and browser constraints.

### Session: 2026-05-01 TASK-004 and TASK-005
**Tasks Completed**: CLI `workflow list` / `workflow status` (local builders + remote GraphQL), `--output` extended with `table`, top-level CLI guard for optional target on list only, GET `/` and `/overview` overview JSON in `handleApiRequest`, selection helpers and browser view-model builder, tests (`cli`, `serve`, `api`, `overview`), `api.test` updated for root route.
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Full `bun test` and `bun run typecheck` green. Outstanding review items in this file (fixed-mode duplicate rows, extra HTTP cases) remain documented above if product wants follow-up.

### Session: 2026-05-01 Current Implementation Review
**Tasks Completed**: Reviewed current implementation and git diff; verified
typecheck and focused overview/GraphQL/API/CLI suites.
**Tasks In Progress**: TASK-004/TASK-005 need review follow-up for output
format scoping, browser page vs JSON-only behavior, and browser recent-limit
alignment.
**Blockers**: None for compilation; remaining issues are contract/design
alignment items recorded in Review Feedback.
**Notes**: No production code fixes were applied during this review; feedback
was recorded in this plan.
