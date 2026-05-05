# Bounded Fanout Join Workflow Execution Implementation Plan

**Status**: Ready
**Created**: 2026-05-05
**Last Updated**: 2026-05-05
**Design Reference**: `design-docs/specs/design-bounded-fanout-join-workflow-execution.md`

## Goal

Complete the remaining bounded fanout runtime gap: inline local fanout must execute branch work items inside the parent workflow session, preserve existing cross-workflow fanout behavior, keep run-level `maxConcurrency` clamping intact, fix isolated retry workspace lineage, and keep design/plan documentation aligned with actual behavior.

## Source References

- Issue source: `runtimeVariables.workflowInput`
- Issue title: `Implement inline local fanout and complete bounded fanout docs/plan alignment`
- Accepted design: `design-docs/specs/design-bounded-fanout-join-workflow-execution.md`
- Codex references: `/Users/taco/gits/tacogips/codex-agent/src/group/manager.ts`, `/Users/taco/gits/tacogips/codex-agent/src/group/types.ts`, `/Users/taco/gits/tacogips/codex-agent/src/queue/runner.ts`, `/Users/taco/gits/tacogips/codex-agent/impl-plans/completed/phase3-sqlite-group-queue.md`

Codex-agent maps only to the bounded scheduler mechanics: `runGroup()` keeps an in-flight set up to `maxConcurrent` and refills it as work completes. divedra intentionally diverges by executing step-addressed workflow work items, persisting fanout group state on workflow sessions, and preserving mailbox, retry, timeout, artifact, GraphQL, CLI, TUI, and library inspection semantics.

## Current Runtime Alignment

Already-supported behavior that must not regress:

- authored `WorkflowStepTransition.fanout`, `defaults.fanoutConcurrency`, and run-level `maxConcurrency`
- persisted fanout group/branch records and deterministic input-ordered join aggregation
- branch runtime variables: `runtimeVariables[itemVariable]`, `runtimeVariables.fanout.*`, and `runtimeVariables.fanoutJoin`
- cross-workflow fanout through bounded child workflow executions, `workflow-calls/` artifacts, branch workspace roots, nested concurrency-budget inheritance, and caller-workflow join aggregation
- shared-worktree ownership validation for read-only, disjoint-path, and isolated-workspace fanout declarations

Explicit remaining gaps:

- local inline fanout currently rejects `toStepId` fanout without `toWorkflowId`; it must run repeated target-step branches in the parent session
- isolated-workspace branch retry must persist `supersededWorkspaceRoot` for the replacement branch attempt
- local fanout lifecycle coverage must prove failure policies, cancellation, pause/user action, timeout, and `maxSteps` accounting
- docs and plan status must never count cross-workflow fanout as completion of local inline fanout

## Modules And Interfaces

### Local Fanout Work Items

#### `src/workflow/engine.ts`, `src/workflow/engine-fanout.ts`, `src/workflow/session.ts`

```typescript
interface LocalFanoutBranchInput {
  readonly fanoutGroupRunId: string;
  readonly targetStepId: string;
  readonly branchIndex: number;
  readonly item: unknown;
  readonly runtimeVariables: WorkflowRuntimeVariables;
  readonly workspaceRoot?: string;
  readonly supersededWorkspaceRoot?: string;
}

interface LocalFanoutBranchResult {
  readonly branch: FanoutBranchRecord;
  readonly communications: readonly RuntimeCommunicationRecord[];
  readonly nodeExecIds: readonly string[];
  readonly outputRef?: OutputRef;
}
```

Checklist:

- [ ] Replace the unsupported local fanout branch with parent-session branch execution.
- [ ] Give every branch a distinct work item id so repeated executions of the same target step do not collapse through queue dedupe.
- [ ] Keep session mutation single-writer; concurrent branch promises must report completion back through serialized reducer updates.
- [ ] Preserve ordinary non-fanout queue behavior.

### Retry Workspace Lineage

#### `src/workflow/engine-fanout.ts`, `src/workflow/session.ts`

```typescript
interface FanoutBranchRecord {
  readonly branchIndex: number;
  readonly workspaceRoot?: string;
  readonly supersededWorkspaceRoot?: string;
}

interface RetryLineageLookup {
  readonly groupId: string;
  readonly branchIndex: number;
  readonly priorGroups: readonly FanoutGroupRunRecord[];
}
```

Checklist:

- [ ] Locate prior isolated-workspace branch attempts by `groupId` and `branchIndex`.
- [ ] Persist the prior branch `workspaceRoot` as `supersededWorkspaceRoot` on the replacement branch.
- [ ] Include lineage in fanout group state and join output where workspace data is already surfaced.
- [ ] Cover both cross-workflow and local fanout retry paths where the runtime has persisted fanout context.

### Inspection And Operator Surfaces

#### `src/workflow/inspect.ts`, `src/lib.ts`, `src/graphql/schema.ts`, `src/cli.ts`, `src/tui/*`

```typescript
interface FanoutGroupSummary {
  readonly fanoutGroupRunId: string;
  readonly groupId: string;
  readonly sourceStepId: string;
  readonly joinStepId: string;
  readonly concurrency: number;
  readonly branchCounts: Readonly<Record<FanoutBranchStatus, number>>;
  readonly firstFailure?: string;
}
```

Checklist:

- [ ] Ensure existing session status/progress/GraphQL/library/TUI views can expose local and cross-workflow fanout groups from the same session state.
- [ ] Reject ambiguous branch target reruns unless persisted fanout scope proves the branch context.
- [ ] Keep `divedra workflow run --max-concurrency` and GraphQL/event forwarding behavior unchanged.

## Task Breakdown

### TASK-001: Documentation And Plan Alignment

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `design-docs/specs/design-bounded-fanout-join-workflow-execution.md`, `impl-plans/active/bounded-fanout-join-workflow-execution.md`, `impl-plans/PROGRESS.json`, `impl-plans/README.md`
**Dependencies**: None

Completion criteria:

- [x] Accepted design distinguishes local inline fanout from cross-workflow fanout.
- [x] Plan tracks local inline fanout as incomplete until parent-session branch work items execute.
- [x] Plan keeps Codex-reference behavior limited to bounded scheduler mechanics.

### TASK-002: Parent-Session Local Fanout Execution

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/workflow/engine.ts`, `src/workflow/engine-fanout.ts`, `src/workflow/session.ts`, `src/workflow/engine.test.ts`
**Dependencies**: TASK-001

Completion criteria:

- [ ] `toStepId` fanout without `toWorkflowId` executes branches in the parent workflow session.
- [ ] Branches receive item variables and `runtimeVariables.fanout` context.
- [ ] The same target step can execute once per branch with distinct node execution ids and artifacts.
- [ ] Join communication is published once with deterministic input-ordered `fanoutJoin` payload.
- [ ] Existing cross-workflow fanout and ordinary sequential queues do not regress.

### TASK-003: Local Fanout Lifecycle Semantics

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/workflow/engine.ts`, `src/workflow/engine-fanout.ts`, `src/workflow/engine.test.ts`
**Dependencies**: TASK-002

Completion criteria:

- [ ] `fail-fast` stops launching new branches, persists failed group state, and fails with `fanoutGroupRunId` plus `branchIndex`.
- [ ] `collect-all` waits for terminal branch results and fails without queueing the join when any branch fails.
- [ ] Cancellation, timeout, optional/user-action pause, and resume behavior remain branch-scoped.
- [ ] `maxSteps` counts local branch node executions and cannot be multiplied by fanout concurrency.
- [ ] Run-level `maxConcurrency` clamps authored/default local fanout concurrency.

### TASK-004: Isolated Retry Workspace Lineage

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/workflow/engine-fanout.ts`, `src/workflow/engine.ts`, `src/workflow/session.ts`, `src/workflow/engine.test.ts`
**Dependencies**: TASK-001

Completion criteria:

- [ ] Replacement isolated fanout branches record prior attempt workspaces as `supersededWorkspaceRoot`.
- [ ] The regression covers the failing isolated fanout retry workspace lineage case.
- [ ] Cross-workflow fanout retry lineage remains covered.
- [ ] Local fanout retry lineage is covered once TASK-002 provides local branch execution.

### TASK-005: Inspection And Control Surface Alignment

**Status**: Not Started
**Parallelizable**: Yes
**Deliverables**: `src/workflow/inspect.ts`, `src/lib.ts`, `src/graphql/schema.ts`, `src/cli.ts`, `src/tui/*`, related tests
**Dependencies**: TASK-002, TASK-004

Completion criteria:

- [ ] Fanout summaries show local and cross-workflow groups from the same persisted state.
- [ ] Branch counts, effective concurrency, source/join ids, failures, output refs, workspace roots, and superseded workspace roots are inspectable where supported.
- [ ] Ambiguous branch reruns outside persisted fanout context are rejected.
- [ ] CLI aliases/help, GraphQL schema, and library views remain backward compatible.

### TASK-006: Final Verification And Workflow Guardrails

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `src/workflow/engine.test.ts`, `src/workflow/validate.test.ts`, `src/cli.test.ts`, `src/graphql/schema.test.ts`, `.divedra/workflows/design-and-implement-review-loop/workflow.json`, user-facing docs only if output changes
**Dependencies**: TASK-002, TASK-003, TASK-004, TASK-005

Completion criteria:

- [ ] All verification commands in this plan pass or have documented environment-only blockers.
- [ ] `.divedra/workflows/design-and-implement-review-loop` continues to use cross-workflow fanout safely unless local inline fanout is intentionally adopted after tests pass.
- [ ] Documentation reflects actual supported behavior and remaining coverage.

## Dependencies

| Task | Depends On | Notes |
| --- | --- | --- |
| TASK-001 | None | Design and plan alignment for this issue |
| TASK-002 | TASK-001 | Core local fanout runtime |
| TASK-003 | TASK-002 | Lifecycle behavior depends on local branch execution |
| TASK-004 | TASK-001 | Retry lineage can start from persisted fanout state; local retry subcase depends on TASK-002 |
| TASK-005 | TASK-002, TASK-004 | Inspection needs stable local branch and lineage state |
| TASK-006 | TASK-002, TASK-003, TASK-004, TASK-005 | Integration verification |

## Parallelization Notes

- TASK-002 and TASK-003 are serial because they share `src/workflow/engine.ts` and the parent-session branch execution path.
- TASK-004 can begin after TASK-001 but must coordinate writes to `src/workflow/engine-fanout.ts` and `src/workflow/session.ts`.
- TASK-005 is parallelizable only after TASK-002 and TASK-004 stabilize the persisted state shape; its primary write scope is inspection, CLI, GraphQL, library, and TUI surfaces.
- TASK-006 is serial.

## Verification Plan

- `bun run typecheck`
- `bun test src/workflow/validate.test.ts src/workflow/types.test.ts --runInBand`
- `bun test src/workflow/engine.test.ts --runInBand --test-name-pattern fanout`
- `bun test src/workflow/engine.test.ts --runInBand --test-name-pattern "local fanout"`
- `bun test src/workflow/engine.test.ts --runInBand --test-name-pattern "retry workspace"`
- `HOME=/private/tmp/divedra-home bun test src/graphql/schema.test.ts src/cli.test.ts --runInBand`
- `bun test src/tui/opentui-screen.test.ts --runInBand`
- `bun run src/main.ts workflow validate design-and-implement-review-loop --workflow-definition-dir .divedra/workflows`
- `bun run src/main.ts workflow validate design-and-implement-review-loop-feature-plan --workflow-definition-dir .divedra/workflows`
- `git diff --check`

## Plan Completion Criteria

- [ ] Parent-session local `itemsFrom` fanout runs repeated target-step branches with bounded concurrency and distinct branch context.
- [ ] Cross-workflow fanout remains bounded and joins deterministically.
- [ ] Nested fanout continues to inherit the remaining runtime maximum concurrency budget.
- [ ] Join payloads preserve input ordering and include branch item/output refs.
- [ ] Failure policies, cancellation, pause, timeout, and `maxSteps` behavior are covered for local fanout.
- [ ] Isolated retry workspace lineage persists `supersededWorkspaceRoot`.
- [ ] Inspection surfaces expose fanout group state and workspace lineage.
- [ ] All verification commands pass or document non-code blockers.

## Progress Log

### Session: 2026-05-05 18:48 JST

**Tasks Completed**: TASK-001.
**Tasks In Progress**: None.
**Blockers**: None for planning. Implementation remains blocked on TASK-002 through TASK-006.
**Notes**: Rebased the active plan on the accepted design update for inline local fanout. The plan now separates already-supported cross-workflow fanout from the required parent-session local fanout implementation and keeps retry workspace lineage explicit.
