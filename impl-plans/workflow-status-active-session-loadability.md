# Workflow Status Active Session Loadability Implementation Plan

**Status**: In Progress
**Design Reference**: design-docs/specs/design-workflow-overview-status-surface.md#active-execution-loadability-contract, design-docs/specs/command.md#cli-workflow-status-name
**Created**: 2026-05-17
**Last Updated**: 2026-05-17

---

## Design Document Reference

**Source**: `design-docs/specs/design-workflow-overview-status-surface.md`, `design-docs/specs/command.md`

### Summary

Resolve issue `tacogips/divedra#23`: `workflow status` and workflow catalog/list overview surfaces must not report a `running` or `paused` execution whose `sessionId` cannot be loaded by `session status`, `session progress`, and `session step-runs` under the same runtime storage context. The primary fix is shared local storage-context resolution, with defensive filtering for stale derived/indexed active candidates.

### Scope

**Included**:

- local CLI storage-context alignment between `workflow list`, `workflow status`, and `session` commands
- active overview rows sourced only from loadable persisted `WorkflowSessionState`
- GraphQL/browser catalog and status overview parity through the same overview builders
- regression coverage for `workflow list`, `workflow status`, `session status`, `session progress`, and `session step-runs`

**Excluded**:

- broad fallback search across unrelated project/user roots
- provider adapter behavior changes for `codex-agent`, `claude-code-agent`, OpenAI SDK, or Anthropic SDK
- new operator diagnostic modes beyond focused stale-row/loadability behavior

### Codex Reference Trace

- `https://github.com/tacogips/divedra/issues/23`: source behavior report and acceptance signal.
- `../../codex-agent`: unavailable locally and intentionally unused; this plan does not copy implementation behavior from `codex-agent`.

---

## Modules

### 1. CLI Runtime Storage Context

#### `packages/divedra/src/cli/storage-and-options.ts`, `packages/divedra/src/cli/workflow-command-handler.ts`

**Status**: COMPLETED

```ts
export interface CliRuntimeStorageResolution {
  readonly options: CliStorageOptions;
  readonly explicitOverride: boolean;
  readonly inferredProjectScopeRoot?: string;
}

export function hasExplicitSessionStorageOverride(
  options: CliStorageOptions,
): boolean;

export async function resolveSessionCommandStorageOptions(
  options: CliStorageOptions,
): Promise<CliStorageOptions>;

export async function resolveWorkflowOverviewStorageOptions(
  options: CliStorageOptions,
): Promise<CliStorageOptions>;
```

**Checklist**:

- [x] Make local `workflow list` and `workflow status` derive session-store options through the same project/user/direct and explicit-override rules as session commands.
- [x] Preserve explicit `--session-store`, `--root-data-dir`, `--artifact-root`, `DIVEDRA_ARTIFACT_DIR`, `DIVEDRA_ARTIFACT_ROOT`, and `DIVEDRA_SESSION_STORE` precedence.
- [x] Keep direct workflow-root inference limited to recognized scoped roots.
- [x] Add focused `workflow list` and `workflow status` tests for project cwd and workflow-definition-dir cases.

### 2. Loadable Active Overview Rows

#### `src/workflow/overview.ts`, `src/workflow/overview.test.ts`

**Status**: COMPLETED

```ts
export function isWorkflowExecutionSummaryActive(
  summary: WorkflowExecutionCompactSummary,
): boolean;

export function countActiveWorkflowExecutions(
  executions: readonly WorkflowExecutionCompactSummary[],
): number;

export function pickNewestActiveExecution(
  executions: readonly WorkflowExecutionCompactSummary[],
): WorkflowExecutionCompactSummary | null;

export async function buildWorkflowCatalogOverview(
  input: WorkflowCatalogOverviewInput,
  options?: WorkflowOverviewBuildContext,
): Promise<
  Result<WorkflowCatalogOverview, WorkflowCatalogFailure | SessionStoreFailure>
>;

export async function buildWorkflowStatusOverview(
  input: WorkflowStatusOverviewInput,
  options?: WorkflowOverviewBuildContext,
): Promise<
  Result<WorkflowStatusOverview, WorkflowCatalogFailure | SessionStoreFailure>
>;
```

**Checklist**:

- [x] Keep persisted `WorkflowSessionState` as the source of active rows.
- [x] Ensure missing, invalid, or deleted session files cannot contribute to `activeExecutionCount` or `newestActiveExecution`.
- [x] Ensure `buildWorkflowCatalogOverview` and `buildWorkflowStatusOverview` apply the same active-row loadability rule.
- [x] Verify runtime database snapshots and other derived indexes may enrich only after persisted session load succeeds.
- [x] Preserve ordering and limit behavior for recent executions.

### 3. Session Inspection Loadability

#### `packages/divedra/src/cli/session-command-handler.ts`, `packages/divedra/src/lib-sessions.ts`, `packages/divedra/src/lib-step-runs.ts`

**Status**: COMPLETED

```ts
export type DivedraSessionOptions = LoadOptions & SessionStoreOptions;

export type DivedraStepRunOptions = LoadOptions & SessionStoreOptions;

export async function listMergedWorkflowExecutionStepRuns(
  input: {
    readonly workflowExecutionId: string;
    readonly filterStepId?: string;
    readonly filterStatus?: NodeExecutionRecord["status"];
  } & DivedraStepRunOptions,
): Promise<{
  readonly workflowExecutionId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly stepRuns: readonly MergedWorkflowExecutionStepRunRow[];
}>;
```

**Checklist**:

- [x] Confirm `session status`, `session progress`, and `session step-runs` consume the shared resolved storage options.
- [x] Keep `session not found` behavior scoped; do not silently search unrelated stores.
- [x] Add or adjust diagnostic text only where it helps explain the selected storage context.
- [x] Preserve local-only behavior for `session step-runs`.

### 4. GraphQL and Browser Overview Parity

#### `src/graphql/schema/llm-run-overrides.ts`, `src/server/browser-overview.ts`, `src/graphql/schema.test.ts`, `src/server/graphql-queries-and-inspection.test.ts`

**Status**: COMPLETED

```ts
export async function workflowStatusOverviewQuery(
  input: WorkflowStatusOverviewGraphqlInput,
  context: GraphqlRequestContext,
): Promise<WorkflowStatusOverview | null>;

export async function workflowCatalogOverviewQuery(
  input: WorkflowCatalogOverviewGraphqlInput,
  context: GraphqlRequestContext,
): Promise<WorkflowCatalogOverview>;

export interface WorkflowOverviewBuildContext extends SessionStoreOptions {
  readonly fixedResolvedWorkflowSource?: ResolvedWorkflowSource;
}
```

**Checklist**:

- [x] Ensure GraphQL `workflowCatalogOverview` keeps using `buildWorkflowCatalogOverview`.
- [x] Ensure GraphQL `workflowStatusOverview` keeps using `buildWorkflowStatusOverview`.
- [x] Verify fixed-serve browser overview inherits the same server storage context.
- [x] Add tests proving active rows are loadable in GraphQL/server catalog and status overview paths.

### 5. End-to-End CLI Regression Coverage

#### `src/cli.test.ts`

**Status**: COMPLETED

```ts
interface WorkflowStatusLoadabilityFixture {
  readonly workflowName: string;
  readonly workflowDefinitionDir: string;
  readonly sessionStoreRoot: string;
  readonly sessionId: string;
}
```

**Checklist**:

- [x] Reproduce the issue with `workflow status --output json` and the same reported `sessionId`.
- [x] Assert `workflow list --output json` does not report unloadable active execution counts.
- [x] Assert `session status <session-id> --output json` loads that session.
- [x] Assert `session progress <session-id> --output json` loads that session.
- [x] Assert `session step-runs <session-id> --output json` resolves the owning workflow execution.
- [x] Assert stale/unloadable active candidates are omitted or demoted from default active status output.

### 6. Verification and Plan Closure

#### `README.md`, `design-docs/specs/command.md`, `impl-plans/workflow-status-active-session-loadability.md`, `impl-plans/PROGRESS.json`, `impl-plans/README.md`

**Status**: COMPLETED

```ts
interface VerificationCommandResult {
  readonly command: string;
  readonly expectedStatus: "pass";
}
```

**Checklist**:

- [x] Update this plan's progress log during implementation.
- [x] Keep `impl-plans/PROGRESS.json` task state in sync.
- [x] Refresh user-facing documentation or command/spec wording if the final operator behavior or diagnostics change during implementation.
- [x] Record any intentional divergence from the accepted design.
- [x] Run the targeted verification commands before review handoff.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| CLI runtime storage context | `packages/divedra/src/cli/storage-and-options.ts`, `packages/divedra/src/cli/workflow-command-handler.ts` | COMPLETED | `src/cli.test.ts` |
| Active overview loadability | `src/workflow/overview.ts` | COMPLETED | `src/workflow/overview.test.ts` |
| Session inspection loadability | `packages/divedra/src/cli/session-command-handler.ts`, `packages/divedra/src/lib-sessions.ts`, `packages/divedra/src/lib-step-runs.ts` | COMPLETED | `src/cli.test.ts` |
| GraphQL/browser parity | `src/graphql/schema/llm-run-overrides.ts`, `src/server/browser-overview.ts` | COMPLETED | `src/graphql/schema.test.ts`, `src/server/graphql-queries-and-inspection.test.ts` |
| CLI regression coverage | `src/cli.test.ts` | COMPLETED | `src/cli.test.ts` |
| Documentation and plan tracking | `README.md`, `design-docs/specs/command.md`, `impl-plans/workflow-status-active-session-loadability.md`, `impl-plans/PROGRESS.json`, `impl-plans/README.md` | COMPLETED | - |

## Task Breakdown

### TASK-001: Align Local Workflow List and Status Storage Context

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `packages/divedra/src/cli/storage-and-options.ts`, `packages/divedra/src/cli/workflow-command-handler.ts`
**Dependencies**: None

**Description**:
Make local `workflow list` and `workflow status` resolve session storage through the same rules as session commands before calling `buildWorkflowCatalogOverview` or `buildWorkflowStatusOverview`.

**Completion Criteria**:

- [x] Local `workflow list` and `workflow status` use the shared storage-context helper.
- [x] Explicit storage overrides still win.
- [x] Direct-root inference remains scoped and conservative.

### TASK-002: Enforce Active Overview Loadability

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/workflow/overview.ts`, `src/workflow/overview.test.ts`
**Dependencies**: None

**Description**:
Ensure catalog active counts, status active counts, and newest-active summaries are computed only from persisted sessions that loaded successfully in the resolved context.

**Completion Criteria**:

- [x] `running` and `paused` rows are counted only when backed by loaded `WorkflowSessionState`.
- [x] Stale derived/index rows cannot make a workflow appear active.
- [x] `buildWorkflowCatalogOverview` and `buildWorkflowStatusOverview` use the same loadability rule.
- [x] Ordering, latest execution, and limit behavior remain compatible.

### TASK-003: Confirm Session Command Loadability Surface

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/divedra/src/cli/session-command-handler.ts`, `packages/divedra/src/lib-sessions.ts`, `packages/divedra/src/lib-step-runs.ts`
**Dependencies**: TASK-001

**Description**:
Audit and adjust session inspection paths so the issue-23 loadability guarantee is explicit for status, progress, and step-runs.

**Completion Criteria**:

- [x] `session status` and `session progress` load from the same resolved storage context used by `workflow status`.
- [x] `session step-runs` resolves the same owning workflow execution id.
- [x] Missing-session behavior remains scoped and non-ambiguous.

### TASK-004: Keep GraphQL and Browser Status Overview Aligned

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/graphql/schema/llm-run-overrides.ts`, `src/server/browser-overview.ts`, `src/graphql/schema.test.ts`, `src/server/graphql-queries-and-inspection.test.ts`
**Dependencies**: TASK-002

**Description**:
Verify and adjust GraphQL/browser catalog and status overview surfaces so active rows inherit the same persisted-session loadability rule.

**Completion Criteria**:

- [x] `workflowCatalogOverview` reports no unloadable active counts.
- [x] `workflowStatusOverview` reports no unloadable active rows.
- [x] Fixed-workflow serve mode keeps using the server's resolved storage context.
- [x] Targeted GraphQL/server tests cover catalog and status active loadability.

### TASK-005: Add Issue-23 CLI Regression Tests

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli.test.ts`
**Dependencies**: TASK-001, TASK-002, TASK-003

**Description**:
Add focused regressions that link a `workflow status --output json` active `sessionId` to successful `session status`, `session progress`, and `session step-runs` commands, and ensure `workflow list --output json` does not expose unloadable active candidates.

**Completion Criteria**:

- [x] Test fails on the reported mismatch and passes after the fix.
- [x] Test covers `workflow list` active count behavior for unloadable/stale candidates.
- [x] Test covers explicit session store and project-scope/default storage as applicable.
- [x] Test asserts stale active candidates are not reported as active.

### TASK-006: Verification and Progress Tracking

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `README.md`, `design-docs/specs/command.md`, `impl-plans/workflow-status-active-session-loadability.md`, `impl-plans/PROGRESS.json`, `impl-plans/README.md`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Description**:
Run verification, update progress metadata, and prepare review handoff without committing implementation code from this planning step.

**Completion Criteria**:

- [x] Plan progress log records implementation-session results.
- [x] `impl-plans/PROGRESS.json` statuses match completed work.
- [x] User-facing docs or command/spec wording are refreshed when behavior or diagnostics change.
- [x] Verification commands and any blocked checks are recorded.

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| TASK-001 CLI list/status storage context | None | COMPLETED |
| TASK-002 active catalog/status overview loadability | None | COMPLETED |
| TASK-003 session command loadability | TASK-001 | COMPLETED |
| TASK-004 GraphQL/browser catalog/status parity | TASK-002 | COMPLETED |
| TASK-005 CLI list/status regression tests | TASK-001, TASK-002, TASK-003 | COMPLETED |
| TASK-006 verification and tracking | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005 | COMPLETED |

## Verification Plan

- `bun test src/workflow/overview.test.ts -t "workflow catalog"`
- `bun test src/workflow/overview.test.ts -t "workflow status"`
- `bun test src/cli.test.ts -t "workflow list"`
- `bun test src/cli.test.ts -t "workflow status"`
- `bun test src/cli.test.ts -t "session progress and status"`
- `bun test src/cli.test.ts -t "session step-runs"`
- `bun test src/graphql/schema.test.ts src/server/graphql-queries-and-inspection.test.ts -t "workflowCatalogOverview"`
- `bun test src/graphql/schema.test.ts src/server/graphql-queries-and-inspection.test.ts -t "workflowStatusOverview"`
- `bun run typecheck:server`

## Completion Criteria

- [x] `workflow list --output json` and GraphQL `workflowCatalogOverview` do not expose unloadable active counts.
- [x] `workflow status <name> --output json` reports active executions only when the same `sessionId` loads through session commands in the same storage context.
- [x] `session status`, `session progress`, and `session step-runs` succeed for any active session id reported by local `workflow status`.
- [x] GraphQL/browser catalog and status overview active rows obey the same persisted-session loadability rule.
- [x] Regression tests cover the issue-23 mismatch and stale active candidates.
- [x] User-facing docs/help/spec wording are refreshed if implementation changes visible behavior or diagnostics.
- [x] Type checking and targeted tests pass, or blocked commands are documented with exact reasons.

## Progress Log

### Session: 2026-05-17 20:08

**Tasks Completed**: Plan creation after Step 3 design acceptance
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Step 3 accepted the design with no findings. The implementation is intentionally left for the next worker step.

### Session: 2026-05-17 20:25

**Tasks Completed**: Step 5 revision feedback addressed in plan
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added explicit workflow list/catalog overview coverage to TASK-001, TASK-002, TASK-004, TASK-005, verification commands, and completion criteria.

### Session: 2026-05-17 23:54

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006
**Tasks In Progress**: Step 7 implementation review pending
**Blockers**: `bun run test` has pre-existing environment/build failures unrelated to issue 23: missing `packages/*/dist` artifacts, local agent-readiness timeouts, and step-derived cross-workflow readiness timeouts. Targeted issue-23 verification and `bun run typecheck` passed.
**Notes**: Implemented `resolveWorkflowOverviewStorageOptions` so local `workflow list` and `workflow status` infer project-scoped runtime storage from recognized `.divedra/workflows` roots while preserving explicit storage overrides and ordinary direct workflow roots. Added CLI regression coverage linking reported active `sessionId` values to `session status`, `session progress`, and `session step-runs`; added overview and GraphQL active-loadability tests. No codex-agent implementation code was used.

## Related Plans

- **Previous**: `impl-plans/completed/workflow-overview-status-surface.md`
- **Next**: None
- **Depends On**: None
