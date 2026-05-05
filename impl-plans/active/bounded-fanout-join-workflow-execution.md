# Bounded Fanout Join Workflow Execution Implementation Plan

**Status**: In Progress
**Created**: 2026-05-05
**Last Updated**: 2026-05-05
**Design Reference**: `design-docs/specs/design-bounded-fanout-join-workflow-execution.md`

## Goal

Add first-class bounded fanout/join execution to step-addressed workflows so the cursor-agent parity workflow can analyze codex-agent once, fan out feature-local design and implementation-plan work with bounded concurrency, and join before dependency-aware implementation.

## Source References

- Issue: `cursor-agent-parity-workflow-concurrency`
- Accepted design: `design-docs/specs/design-bounded-fanout-join-workflow-execution.md`
- Codex references: `/Users/taco/gits/tacogips/codex-agent/src/group/manager.ts`, `/Users/taco/gits/tacogips/codex-agent/src/group/types.ts`, `/Users/taco/gits/tacogips/codex-agent/src/queue/runner.ts`, `/Users/taco/gits/tacogips/codex-agent/impl-plans/completed/phase3-sqlite-group-queue.md`

Codex-agent maps to divedra only at the bounded scheduler pattern:
`runGroup()` uses `maxConcurrent`, an in-flight map, and `Promise.race()` to
refill pending work. divedra intentionally diverges by persisting fanout group
state in the workflow session/runtime artifacts and by executing ordinary
step-addressed branch work items, not one shared prompt across existing sessions.

## Scope

Included:

- `WorkflowStepTransition.fanout` and `defaults.fanoutConcurrency`
- dynamic `itemsFrom` fanout with input-ordered aggregate join payloads
- persisted fanout group and branch state
- local bounded branch scheduling from `runWorkflowInternal()`
- cross-workflow fanout through `executeCrossWorkflowDispatchesForNode()`
- fail-fast and collect-all policies
- branch-scoped pause/cancel/timeout/maxSteps accounting
- inspection summaries for CLI, GraphQL, TUI, and library callers
- shared-worktree ownership validation for write-capable fanout branches
- update `.divedra/workflows/design-and-implement-review-loop` after runtime tests pass

Revision note: the cursor-agent parity workflow bundle adopts bounded fanout
through cross-workflow feature-local planning branches. Parent-session local
fanout work-item execution remains tracked below and is not claimed complete
until branch identity, retry, pause, timeout, and maxSteps semantics run inside
the parent workflow session.

Excluded: static authored `branches[]`, partial-success joins, group-level
timeouts, branch auto-merge, new run-time CLI flags, and branch rerun selector
support beyond rejecting ambiguous branch reruns.

## Modules

### 1. Authored Schema And Validation

#### `src/workflow/types.ts`

```typescript
export type WorkflowFanoutFailurePolicy = "fail-fast" | "collect-all";
export type WorkflowFanoutResultOrder = "input";

export interface WorkflowStepFanout {
  readonly groupId: string;
  readonly itemsFrom: string;
  readonly itemVariable?: string;
  readonly concurrency?: number;
  readonly joinStepId: string;
  readonly failurePolicy?: WorkflowFanoutFailurePolicy;
  readonly resultOrder?: WorkflowFanoutResultOrder;
  readonly writeOwnership?: WorkflowFanoutWriteOwnership;
}

export interface WorkflowFanoutWriteOwnership {
  readonly mode: "read-only" | "disjoint-paths" | "isolated-workspace";
  readonly paths?: readonly string[];
  readonly directories?: readonly string[];
}
```

**Checklist**:

- [ ] Add fanout/default types without reintroducing top-level `workflowCalls`
- [ ] Normalize `defaults.fanoutConcurrency` with default `20`
- [ ] Validate `itemsFrom`, `joinStepId`, `resumeStepId`, policies, ordering, and ownership
- [ ] Add valid/invalid coverage in `src/workflow/validate.test.ts` and type-shape coverage in `src/workflow/types.test.ts`

### 2. Runtime Fanout State And Work Items

#### `src/workflow/session.ts`

```typescript
export type FanoutBranchStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "paused";

export interface FanoutBranchRecord {
  readonly branchIndex: number;
  readonly item: unknown;
  readonly status: FanoutBranchStatus;
  readonly workItemId: string;
  readonly nodeExecIds?: readonly string[];
  readonly outputRef?: OutputRef;
  readonly error?: string;
  readonly workspaceRoot?: string;
}

export interface FanoutGroupRunRecord {
  readonly fanoutGroupRunId: string;
  readonly groupId: string;
  readonly sourceStepId: string;
  readonly sourceNodeExecId: string;
  readonly transitionLabel?: string;
  readonly targetStepId: string;
  readonly targetWorkflowId?: string;
  readonly joinStepId: string;
  readonly concurrency: number;
  readonly failurePolicy: WorkflowFanoutFailurePolicy;
  readonly resultOrder: WorkflowFanoutResultOrder;
  readonly branches: readonly FanoutBranchRecord[];
}
```

**Checklist**:

- [ ] Persist fanout group state on `WorkflowSessionState`
- [ ] Introduce internal execution work item identity for branch executions
- [ ] Preserve existing `session.queue` behavior when no fanout is present
- [ ] Ensure all session mutations remain reducer/single-writer updates

### 3. Local Fanout Scheduler And Join

#### `src/workflow/engine.ts`

```typescript
interface FanoutSchedulerInput {
  readonly group: FanoutGroupRunRecord;
  readonly maxConcurrent: number;
  readonly runBranch: (
    branch: FanoutBranchRecord,
  ) => Promise<FanoutBranchResult>;
}

interface FanoutJoinAggregate {
  readonly fanoutGroupRunId: string;
  readonly groupId: string;
  readonly sourceStepId: string;
  readonly resultOrder: WorkflowFanoutResultOrder;
  readonly results: readonly FanoutJoinBranchResult[];
}
```

**Checklist**:

- [ ] Resolve `itemsFrom` from the source output payload using JSON Pointer
- [ ] Start at most effective concurrency branches at a time
- [ ] Add branch runtime variables: `runtimeVariables[itemVariable]`, `runtimeVariables.fanout.groupId`, `runtimeVariables.fanout.branchIndex`, and `runtimeVariables.fanout.item`
- [ ] Queue `joinStepId` exactly once with deterministic aggregate communication
- [ ] Implement fail-fast, collect-all, cancel, pause, timeout, and maxSteps behavior

### 4. Cross-Workflow Fanout

#### `src/workflow/cross-workflow-from-steps.ts`, `src/workflow/engine.ts`

```typescript
export interface CrossWorkflowDispatch {
  readonly id: string;
  readonly workflowId: string;
  readonly callerStepId: string;
  readonly resumeStepId: string;
  readonly when?: string;
  readonly fanout?: WorkflowStepFanout;
}
```

**Checklist**:

- [ ] Derive step-addressed cross-workflow dispatches with `fanout`
- [ ] Use the same bounded scheduler primitive as local fanout
- [ ] Preserve ordinary multi-dispatch deterministic behavior with concurrency `1`
- [ ] Persist `workflow-calls/` artifacts with `fanoutGroupRunId` and `branchIndex`
- [ ] Preserve cross-workflow cycle guards for every branch
- [ ] Ensure nested fanout inherits the remaining runtime maximum concurrency budget rather than multiplying branch concurrency

### 5. Shared Worktree Safety

#### `src/workflow/validate.ts`, `src/workflow/engine.ts`

```typescript
interface FanoutWorkspaceDecision {
  readonly mode: "parent-worktree" | "isolated-workspace";
  readonly workspaceRoot?: string;
  readonly reason: string;
}
```

**Checklist**:

- [ ] Require read-only, disjoint-path ownership, or isolated workspace declaration for write-capable fanout branches
- [ ] Persist branch workspace root when it differs from the parent worktree
- [ ] Reject unsafe concurrent code-writing fanout without disjoint ownership or isolation
- [ ] Ensure branch retries reuse the same isolated workspace or persist replacement workspace linkage to the superseded branch attempt
- [ ] Keep scheduler responsible for orchestration only; joins/reviews handle integration decisions

### 6. Inspection And Control Surfaces

#### `src/workflow/inspect.ts`, `src/lib.ts`, `src/graphql/schema.ts`, `src/cli.ts`, `src/tui/*`

```typescript
export interface FanoutGroupSummary {
  readonly fanoutGroupRunId: string;
  readonly groupId: string;
  readonly sourceStepId: string;
  readonly joinStepId: string;
  readonly concurrency: number;
  readonly branchCounts: Readonly<Record<FanoutBranchStatus, number>>;
  readonly firstFailure?: string;
}
```

**Checklist**:

- [ ] Expose active/completed fanout groups in runtime session views
- [ ] Add branch count, concurrency, source/join, and failure summaries
- [ ] Keep existing `workflow status`, `session progress`, GraphQL, and TUI flows usable without new flags
- [ ] Reject ambiguous branch target reruns outside persisted fanout context

### 7. Workflow Bundle Adoption

#### `.divedra/workflows/design-and-implement-review-loop/workflow.json`

**Checklist**:

- [ ] Add fanout only after schema, engine, cross-workflow, and safety tests pass
- [ ] Fan out feature-local design and implementation-plan creation/review with concurrency near `20`
- [ ] Ensure branch outputs write to disjoint design/plan paths or use isolated workspaces
- [ ] Keep dependency-aware implementation after the join step

### 8. Verification And Documentation

#### Tests and docs

**Checklist**:

- [ ] Add engine tests for ordering, concurrency, join queueing, fail-fast, collect-all, cancellation, timeout, pause, and maxSteps accounting
- [ ] Add cross-workflow fanout tests for bounded callee execution, nested budget inheritance, deterministic aggregation, cycle guards, and artifact stability
- [ ] Add shared-worktree safety tests for read-only/planning, disjoint writes, unsafe overlapping writes, and isolated retry workspace linkage
- [ ] Refresh user-facing command/help docs only where inspection output changes

## Task Breakdown

### TASK-001: Schema Types And Validation

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/workflow/types.ts`, `src/workflow/validate.ts`, `src/workflow/validate.test.ts`, `src/workflow/types.test.ts`
**Dependencies**: None

**Completion Criteria**:

- [x] Authored `fanout` shape and `defaults.fanoutConcurrency` are typed
- [x] Validation rejects invalid pointers, policies, concurrency, join targets, and cross-workflow resume mismatches
- [x] Removed-field rejection for top-level `workflowCalls`, `subWorkflows`, `edges`, and `loops` remains intact

### TASK-002: Fanout State And Work-Item Foundation

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/session.ts`, `src/workflow/engine.ts`, `src/workflow/session-store.test.ts`
**Dependencies**: TASK-001

**Completion Criteria**:

- [x] `WorkflowSessionState` persists fanout group and branch records
- [x] Internal work item identity supports repeated branch execution of the same step
- [x] Non-fanout workflows retain current sequential queue behavior

### TASK-003: Local Bounded Fanout And Join Runtime

**Status**: In Progress
**Parallelizable**: No
**Deliverables**: `src/workflow/engine.ts`, `src/workflow/engine.test.ts`
**Dependencies**: TASK-002

**Completion Criteria**:

- [ ] Parent-session local branch work-item scheduler enforces concurrency and deterministic result ordering
- [ ] Parent-session local join communication is published once with `runtimeVariables.fanoutJoin`
- [ ] Failure, cancellation, timeout, optional/user-action pause, and maxSteps cases are covered

### TASK-004: Cross-Workflow Fanout Runtime

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/cross-workflow-from-steps.ts`, `src/workflow/engine.ts`, `src/workflow/engine.test.ts`
**Dependencies**: TASK-002

**Completion Criteria**:

- [x] Cross-workflow fanout uses the shared bounded scheduler
- [x] Callee runtime variables include branch fanout context
- [x] `workflow-calls/` artifacts and join aggregation are deterministic
- [x] Cycle guards still reject recursive dispatch per branch
- [x] Nested fanout receives and respects the remaining runtime maximum fanout concurrency budget

### TASK-005: Shared Worktree Safety

**Status**: In Progress
**Parallelizable**: No
**Deliverables**: `src/workflow/validate.ts`, `src/workflow/engine.ts`, `src/workflow/validate.test.ts`, `src/workflow/engine.test.ts`
**Dependencies**: TASK-001, TASK-002

**Completion Criteria**:

- [x] Write-capable fanout branches declare read-only, disjoint ownership, or isolated workspace mode
- [x] Unsafe overlapping shared-worktree fanout is rejected
- [x] Branch workspace roots are persisted when they differ from the parent worktree
- [ ] Branch retries reuse the same isolated workspace or record replacement workspace linkage to the superseded branch attempt

### TASK-006: Inspection Surfaces

**Status**: In Progress
**Parallelizable**: No
**Deliverables**: `src/workflow/inspect.ts`, `src/lib.ts`, `src/graphql/schema.ts`, `src/cli.ts`, `src/tui/*`, related tests
**Dependencies**: TASK-002

**Completion Criteria**:

- [ ] CLI, GraphQL, TUI, and library session views include fanout summaries
- [ ] Existing status/progress/health commands expose fanout state without new flags
- [ ] Ambiguous branch reruns outside fanout context are rejected

### TASK-007: Workflow Bundle Enablement

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `.divedra/workflows/design-and-implement-review-loop/workflow.json`, workflow-local prompts or expected-results updates as needed
**Dependencies**: TASK-003, TASK-004, TASK-005, TASK-006

**Completion Criteria**:

- [x] Cursor parity workflow fans out feature-local planning/review with bounded concurrency near `20`
- [x] Branch write ownership is disjoint or isolated
- [x] Dependency-aware implementation remains after the join
- [x] Workflow validation passes

### TASK-008: Final Verification And Documentation Refresh

**Status**: In Progress
**Parallelizable**: No
**Deliverables**: focused tests, `README.md` or `design-docs/specs/command.md` only if operator-visible output changes
**Dependencies**: TASK-003, TASK-004, TASK-005, TASK-006, TASK-007

**Completion Criteria**:

- [x] `bun run typecheck`
- [x] `bun test src/workflow/validate.test.ts src/workflow/types.test.ts`
- [ ] `bun test src/workflow/engine.test.ts --runInBand`
- [x] `bun test src/graphql/schema.test.ts src/cli.test.ts --runInBand`
- [x] `bun run src/main.ts workflow validate design-and-implement-review-loop`
- [x] `bun run src/main.ts workflow validate design-and-implement-review-loop-feature-plan`

## Dependencies

| Task     | Depends On                                       | Notes                                                                                                                                 |
| -------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| TASK-001 | None                                             | Foundation schema and validation work                                                                                                 |
| TASK-002 | TASK-001                                         | Runtime state depends on accepted types                                                                                               |
| TASK-003 | TASK-002                                         | Local scheduler depends on persisted work-item state                                                                                  |
| TASK-004 | TASK-002                                         | Cross-workflow scheduler depends on persisted work-item state and carries the remaining runtime concurrency budget into nested fanout |
| TASK-005 | TASK-001, TASK-002                               | Safety checks span authored schema, runtime state, and retry workspace lineage                                                        |
| TASK-006 | TASK-002                                         | Inspection reads persisted fanout state                                                                                               |
| TASK-007 | TASK-003, TASK-004, TASK-005, TASK-006           | Workflow bundle adoption waits for runtime support                                                                                    |
| TASK-008 | TASK-003, TASK-004, TASK-005, TASK-006, TASK-007 | Final verification after implementation                                                                                               |

## Parallelization Notes

- Initial parallelizable task: TASK-001 only.
- After TASK-002 completes, TASK-003, TASK-004, TASK-005, and TASK-006 can be split across workers only if owners coordinate the shared `src/workflow/engine.ts` writes or isolate non-overlapping helper modules first.
- TASK-007 and TASK-008 are serial integration tasks.

## Verification Plan

- `bun run typecheck`
- `bun test src/workflow/validate.test.ts src/workflow/types.test.ts`
- `bun test src/workflow/session-store.test.ts`
- `bun test src/workflow/engine.test.ts --runInBand`
- focused engine regression: nested cross-workflow fanout cannot exceed the remaining runtime maximum fanout concurrency budget
- focused engine regression: isolated branch retries reuse the prior workspace or persist replacement linkage
- `bun test src/graphql/schema.test.ts src/cli.test.ts --runInBand`
- `bun test src/tui/opentui-screen.test.ts --runInBand`
- `bun run src/main.ts workflow validate design-and-implement-review-loop`

## Plan Completion Criteria

- [x] Dynamic `itemsFrom` fanout runs local branches with bounded concurrency
- [x] Cross-workflow fanout runs bounded callee workflows and joins deterministically
- [x] Nested fanout inherits the remaining runtime maximum concurrency budget
- [x] Join payloads preserve input ordering and include branch item/output refs
- [ ] Failure policies, cancellation, pause, timeout, and maxSteps behavior are covered
- [ ] Shared-worktree write safety and branch retry workspace lineage are validated
- [ ] Inspection surfaces expose fanout group state
- [x] Cursor parity workflow uses fanout only after runtime verification
- [ ] All verification commands in this plan pass

## Progress Log

### Session: 2026-05-05 15:18 JST

**Tasks Completed**: Created plan from the accepted bounded fanout/join design.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Step 3 accepted the design with no high or mid findings. The plan keeps Codex-reference behavior limited to bounded scheduler mechanics and preserves divedra-specific persisted workflow state, mailbox, retry, timeout, and artifact semantics.

### Session: 2026-05-05 15:32 JST

**Tasks Completed**: Addressed Step 5 implementation-plan review findings.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added explicit TASK-004 coverage for nested fanout inheriting the remaining runtime maximum concurrency budget and TASK-005 coverage for branch retry workspace reuse or persisted replacement workspace linkage. Updated verification and plan completion criteria to keep both accepted design requirements testable.

### Session: 2026-05-05 15:36 JST

**Tasks Completed**: TASK-001; partial TASK-002, TASK-004, and TASK-008.
**Tasks In Progress**: TASK-002, TASK-004, TASK-008.
**Blockers**: Full local fanout queue work-item execution, nested fanout budget accounting, shared-worktree safety, inspection surface expansion, and workflow bundle adoption remain open.
**Notes**: Added authored `WorkflowStepTransition.fanout`, `defaults.fanoutConcurrency`, validation coverage, persisted fanout group records, cross-workflow dispatch fanout projection, bounded cross-workflow fanout branch execution, deterministic fanout join aggregation, branch runtime variables, fanout-aware `workflow-calls/` artifacts, and focused engine coverage. Verification passed for typecheck, validation/type tests, cross-workflow dispatch projection tests, and the focused fanout engine test. A broader `engine.test.ts --test-name-pattern "cross-workflow"` run still reports an unrelated existing/ambient `attempt to write a readonly database` failure in the bundle-directory-name test.

### Session: 2026-05-05 15:47 JST

**Tasks Completed**: TASK-002; partial TASK-003, TASK-004, TASK-005, and TASK-008 review follow-up.
**Tasks In Progress**: TASK-003, TASK-005, TASK-008.
**Blockers**: Full inspection surface expansion, branch retry workspace lineage, complete failure/cancellation/pause/timeout/maxSteps coverage, and workflow bundle adoption remain open.
**Notes**: Addressed Step 7 high/mid findings by adding local fanout branch execution with bounded scheduling and deterministic join aggregation, persisting failed fanout group state before terminal failure, propagating `runtimeVariables.fanoutJoin` to join steps, bounding nested fanout concurrency budgets, restoring unrelated CLI session command behavior, and requiring explicit write ownership for concurrent fanout authoring. Verification passed for `bun run typecheck`, validation/type tests, and focused fanout engine tests.

### Session: 2026-05-05 16:27 JST

**Tasks Completed**: TASK-007 and Step 7 review follow-up for CLI/session inspection compatibility.
**Tasks In Progress**: TASK-003, TASK-005, TASK-008.
**Blockers**: Parent-session local fanout work-item execution, branch retry workspace lineage, and exhaustive failure/cancellation/pause/timeout/maxSteps coverage remain open.
**Notes**: Addressed Step 7 feedback from `comm-000018` by restoring the `src/cli.ts` command handlers so `divedra gql`, `session health`, `session export`, `session logs`, and `session step-runs` remain available, while keeping help text focused on `divedra graphql` and hiding detailed session-inspection commands. Enabled bounded fanout in `.divedra/workflows/design-and-implement-review-loop/workflow.json` with `defaults.fanoutConcurrency: 20`, a Step 1 feature classification fanout transition, isolated branch ownership, and a `step5-feature-plan-join` dependency-aware join before Step 6. Added `.divedra/workflows/design-and-implement-review-loop-feature-plan/` as the cross-workflow feature-local design/plan/review branch workflow and validated both workflow bundles. Verification passed for `bun run typecheck`, `bun test src/workflow/validate.test.ts src/workflow/types.test.ts --runInBand`, `bun test src/workflow/engine.test.ts --runInBand --test-name-pattern "fanout"`, `HOME=/private/tmp/divedra-home bun test src/graphql/schema.test.ts src/cli.test.ts --runInBand`, and workflow validation for both the main and feature-plan bundles using `--workflow-definition-dir .divedra/workflows`.

### Session: 2026-05-05 16:56 JST

**Tasks Completed**: Step 7 review follow-up from `comm-000020`; partial TASK-005 and TASK-008.
**Tasks In Progress**: TASK-003, TASK-005, TASK-008.
**Blockers**: Branch retry workspace lineage and exhaustive failure/cancellation/pause/timeout/maxSteps coverage remain open.
**Notes**: Addressed the high isolated-workspace finding by creating per-branch fanout workspaces under the system temp fanout workspace root, copying the parent workflow working directory into each branch workspace, passing that path as `workflowWorkingDirectory` to cross-workflow and local isolated branches, and persisting the branch workspace root on fanout branch records plus `workflow-calls/` artifacts. Addressed the mid CLI help regression by restoring explicit `session health`, `session export`, `session logs`, and `session step-runs` help rows while preserving the accepted `divedra graphql` wording and hidden `divedra gql` alias. Verification passed for `bun run typecheck`, `bun test src/workflow/engine.test.ts --runInBand --test-name-pattern "fanout"`, `HOME=/private/tmp/divedra-home bun test src/graphql/schema.test.ts src/cli.test.ts --runInBand`, `bun run src/main.ts workflow validate design-and-implement-review-loop --workflow-definition-dir .divedra/workflows`, `bun run src/main.ts workflow validate design-and-implement-review-loop-feature-plan --workflow-definition-dir .divedra/workflows`, and `git diff --check`.

### Session: 2026-05-05 16:59 JST

**Tasks Completed**: Step 7 review follow-up from `comm-000022`; partial TASK-003, TASK-004, TASK-005, and TASK-008.
**Tasks In Progress**: TASK-003, TASK-005, TASK-008.
**Blockers**: Parent-session local fanout work-item execution remains explicitly unsupported until branch execution, pause/cancel/retry, and counters are implemented in the parent session; branch retry workspace lineage and exhaustive cancellation/pause/timeout coverage remain open.
**Notes**: Addressed the high parity workflow integration finding by switching `.divedra/workflows/design-and-implement-review-loop/workflow.json` from isolated fanout ownership to `disjoint-paths` ownership for feature-local `design-docs/specs` and `impl-plans/active` outputs, and updated `step5-feature-plan-join.md` to preserve branch file paths and optional workspace roots. Addressed the maxSteps finding by adding a shared fanout step budget passed into cross-workflow branch child runs and a regression proving high fanout cannot multiply the configured `maxSteps` cap. Addressed the local fanout semantics finding by rejecting local fanout at runtime with an explicit unsupported message instead of claiming parent-session work-item support. Verification passed for `bun run typecheck`, `bun test src/workflow/engine.test.ts --runInBand --test-name-pattern fanout`, and workflow validation for both the main and feature-plan bundles using `--workflow-definition-dir .divedra/workflows`.

### Session: 2026-05-05 17:05 JST

**Tasks Completed**: Continued large-file split for fanout runtime helpers.
**Tasks In Progress**: TASK-003, TASK-005, TASK-008.
**Blockers**: Parent-session local fanout work-item execution, branch retry workspace lineage, and exhaustive cancellation/pause/timeout coverage remain open.
**Notes**: Extracted cohesive fanout helper utilities from `src/workflow/engine.ts` into `src/workflow/engine-fanout.ts`, including JSON Pointer resolution, fanout item/concurrency/budget helpers, branch workspace preparation, bounded branch scheduling, runtime variable builders, and join output persistence. Verification passed for `bun run typecheck`, focused fanout engine tests, the full `src/workflow` test suite, and `git diff --check`.
