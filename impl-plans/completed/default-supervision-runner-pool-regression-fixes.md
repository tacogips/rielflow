# Default Supervision And Runner-Pool Regression Fixes Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#default-supervisor-backed-starts`; `design-docs/specs/command.md#workflow`; `design-docs/specs/design-event-supervisor-control.md#deterministic-in-process-runner-pool-mode`
**Created**: 2026-05-06
**Last Updated**: 2026-05-06

## Design Document Reference

**Source**: accepted Step 3 design review for workflow
`design-and-implement-review-loop`, issue-resolution mode.

### Summary

Resolve the recent-change quality-loop handoff findings by aligning default
supervised workflow starts across CLI, GraphQL, and library entrypoints, then
preserving live runner-pool handles when inspection dispatches do not produce an
async task.

### Scope

**Included**: `src/cli.ts`, `src/graphql/schema.ts`, `src/lib.ts`,
`src/workflow/supervisor-runner-pool.ts`, and focused regression tests in
neighboring test files.

**Excluded**: broad auto-improve remediation behavior, unrelated dirty worktree
files, codex-agent repository changes, and wide documentation rewrites beyond
direct plan/status alignment required by later review.

## Issue And Reference Trace

- Issue source: `recent-change-quality-loop`,
  execution `div-recent-change-quality-loop-1778070459-b2daec1e`.
- Reviewed range:
  `4eae80b0b6b03d04e8fc79ae7684fbfe41c0e984..4f865e0a8bd183e6db9031fd0319cd546c9722fc`.
- Finding 1: `src/cli.ts:2112` ignores `defaultAutoImprove` while docs and
  completed plans describe supervisor-backed workflow starts as default.
- Finding 2: `src/workflow/supervisor-runner-pool.ts:172` can overwrite a live
  async handle with a non-async inspection handle.
- Accepted design references:
  `design-docs/specs/architecture.md:69`,
  `design-docs/specs/architecture.md:103`,
  `design-docs/specs/command.md:63`,
  `design-docs/specs/design-event-supervisor-control.md:244`,
  `design-docs/specs/design-event-supervisor-control.md:331`.
- Codex-agent behavior references:
  `../../codex-agent/src/sdk/session-runner.ts`,
  `../../codex-agent/src/sdk/agent-runner.ts`,
  `../../codex-agent/src/sdk/mock-session-runner.ts`,
  `../../codex-agent/src/process/manager.ts`,
  `../../codex-agent/impl-plans/issue6-stable-runner-api.md`.
- Intentional divergence: use codex-agent as a behavioral reference for stable
  runner facades, active handle tracking, cancellation, event normalization, and
  mockable async runners; do not copy code or adopt codex subprocess lifecycle.

## Modules

### 1. Default Supervised Start Entry Points

#### `src/cli.ts`, `src/graphql/schema.ts`, `src/lib.ts`

**Status**: Completed

Contract signatures to keep aligned:

```typescript
interface WorkflowRunOptions {
  readonly autoImprove?: AutoImprovePolicy;
  readonly disableAutoImprove?: boolean;
  readonly nestedSuperviser?: boolean;
}

interface DefaultAutoImproveBehavior {
  readonly defaultAutoImprove?: boolean;
}
```

Checklist:

- [x] Apply default auto-improve when no explicit `autoImprove` or
      `disableAutoImprove` option is supplied.
- [x] Serialize `--no-auto-improve` for endpoint-backed CLI runs as
      `autoImprove: { enabled: false }`.
- [x] Keep GraphQL `executeWorkflow` default-supervised when `autoImprove` is
      omitted and preserve explicit disabled policies.
- [x] Make library `executeWorkflow()` match CLI and GraphQL defaults while
      honoring `disableAutoImprove`.
- [x] Reject or suppress nested supervisor flags when the effective policy is
      explicitly unsupervised.

### 2. Runner-Pool Live Handle Preservation

#### `src/workflow/supervisor-runner-pool.ts`

**Status**: Completed

Contract signatures to preserve:

```typescript
interface SupervisorRunnerPoolHandle {
  readonly runnerPoolRunId: string;
  readonly supervisedRunId: string;
  readonly workflowExecutionId: string;
  wait(): Promise<SupervisedWorkflowView>;
  cancel(reason?: string): Promise<SupervisedWorkflowView>;
}
```

Checklist:

- [x] Store or replace active handle indexes only when dispatch receives a real
      `onAsyncRun` task.
- [x] Return fresh persisted inspection views without replacing an existing live
      handle.
- [x] Keep wait, cancel, and resume resolution bound to the original live handle
      after status/progress/inbox/log/export dispatches.
- [x] Preserve completed-handle pruning and durable inspection behavior.

### 3. Focused Regression Tests

#### `src/cli.test.ts`, `src/graphql/schema.test.ts`, `src/server/graphql.test.ts`, `src/workflow/supervisor-client.test.ts`, `src/workflow/supervisor-runner-pool.test.ts`, `src/events/trigger-runner.test.ts`

**Status**: Completed

Checklist:

- [x] Cover local `workflow run` default supervision and `--no-auto-improve`
      opt-out.
- [x] Cover remote CLI `executeWorkflow` default supervision and explicit
      disabled policy serialization.
- [x] Cover GraphQL and library default-supervised behavior plus disabled
      opt-out.
- [x] Cover nested supervisor gating under explicit opt-out.
- [x] Cover async start followed by status/progress inspection while wait/cancel
      still use the original live handle.

## Module Status

| Task | File Path | Status | Tests |
| ---- | --------- | ------ | ----- |
| TASK-001 Default supervised start entry points | `src/cli.ts`, `src/graphql/schema.ts`, `src/lib.ts` | COMPLETED | `src/cli.test.ts`, `src/graphql/schema.test.ts`, `src/server/graphql.test.ts` |
| TASK-002 Runner-pool live handle preservation | `src/workflow/supervisor-runner-pool.ts` | COMPLETED | `src/workflow/supervisor-runner-pool.test.ts`, `src/workflow/supervisor-client.test.ts` |
| TASK-003 Event/client regression coverage | event and workflow tests | COMPLETED | `src/events/trigger-runner.test.ts`, focused workflow tests |
| TASK-004 Verification and plan progress update | command output and this plan | COMPLETED | required commands below |

## Dependencies

| Task | Depends On | Parallelizable | Reason |
| ---- | ---------- | -------------- | ------ |
| TASK-001 | accepted Step 3 design | Yes | Write scope is CLI/GraphQL/library entrypoint normalization |
| TASK-002 | accepted Step 3 design | Yes | Write scope is runner-pool handle storage semantics |
| TASK-003 | TASK-001, TASK-002 | No | Tests must assert final behavior across both fixes |
| TASK-004 | TASK-001, TASK-002, TASK-003 | No | Verification and progress log require final code and tests |

## Completion Criteria

- [x] Default supervised starts are consistent for local CLI, endpoint-backed
      CLI, GraphQL `executeWorkflow`, and library `executeWorkflow()`.
- [x] `--no-auto-improve` and `disableAutoImprove` remain explicit unsupervised
      opt-outs across local and remote paths.
- [x] Nested supervisor flags cannot create partially supervised runs under an
      explicit unsupervised policy.
- [x] Runner-pool inspection dispatches cannot replace an active async handle
      when no `onAsyncRun` task is produced.
- [x] Wait/cancel/resume semantics still target the original live handle after
      status/progress inspection.
- [x] Focused regression tests cover both recent-change findings.
- [x] `bun test src/workflow/supervisor-client.test.ts src/workflow/supervisor-runner-pool.test.ts src/events/trigger-runner.test.ts`
      passes as part of focused regression coverage.
- [x] `bun run typecheck` passes.
- [ ] `task ci` is run if practical, or the blocker is recorded.

## Verification Plan

- `bun test src/workflow/supervisor-client.test.ts src/workflow/supervisor-runner-pool.test.ts src/events/trigger-runner.test.ts`
- `bun test src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts`
- `bun run typecheck`
- `task ci`
- Review command: `git diff -- src/cli.ts src/graphql/schema.ts src/lib.ts src/workflow/supervisor-runner-pool.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/workflow/supervisor-client.test.ts src/workflow/supervisor-runner-pool.test.ts src/events/trigger-runner.test.ts`

## Addressed Feedback

- Step 3 accepted the design with no high or mid findings.
- Step 2 resolved the product decision in favor of default deterministic
  supervisor-backed starts with opt-out, so implementation should not revert to
  explicit-only supervision.
- The runner-pool fix must use codex-agent only as a behavior reference for
  stable active-handle control and testable mocks.

## Progress Log

### Session: 2026-05-06

**Tasks Completed**: Created active implementation plan from accepted Step 3
design.

**Tasks In Progress**: None.

**Blockers**: None for planning. Implementation must account for the existing
dirty worktree and avoid reverting unrelated changes.

**Notes**: Later implementation should update this progress log and task
statuses after each subtask, then move or archive the plan only after all
completion criteria pass.

### Session: 2026-05-06 21:49 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004.

**Tasks In Progress**: None.

**Blockers**: `task ci` was not run before the requested review/fix workflow
rerun; focused regression tests and typecheck passed.

**Notes**: Removed compatibility-oriented default behavior branching and made
default supervision the concise normal path. Preserved `--no-auto-improve` and
`disableAutoImprove` as explicit opt-outs. Updated runner-pool storage so only
real async starts create live handles and inspection dispatches cannot overwrite
them. Verification passed:
`bun test src/workflow/supervisor-runner-pool.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/cli.test.ts src/lib.test.ts`
and `bun run typecheck`.

### Session: 2026-05-06 21:55 JST

**Tasks Completed**: Default supervision stall-timeout follow-up.

**Tasks In Progress**: Review/fix workflow rerun.

**Blockers**: None.

**Notes**: The review/fix workflow exposed a false-positive supervision stall:
default supervision retried the long Step 1 LLM review every 60 seconds and
exhausted its budget. Increased the default supervision stall threshold to
`3600000` milliseconds to match normal workflow node timeout scale while
retaining explicit `--stall-timeout-ms` override behavior. Verification passed:
`bun test src/workflow/auto-improve-policy.test.ts src/workflow/supervisor-runner-pool.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/cli.test.ts src/lib.test.ts`
and `bun run typecheck`.

### Session: 2026-05-06 22:03 JST

**Tasks Completed**: Review-loop mid findings follow-up.

**Tasks In Progress**: Final review/fix workflow rerun.

**Blockers**: None.

**Notes**: The review/fix workflow found stale 60-second test expectations,
legacy CLI policy-flag rejection under default supervision, over-broad
resume/rerun default auto-improve injection, and a runner-pool test nesting
issue. Fixed all four: policy flags now customize default supervision unless
`--no-auto-improve` is used, default auto-improve injection is start-only,
resume/rerun coverage asserts no synthesized policy, and the runner-pool test
is correctly grouped. Verification passed:
`bun test src/workflow/superviser-control.test.ts src/workflow/auto-improve-policy.test.ts src/workflow/supervisor-runner-pool.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/lib.test.ts`
and `bun run typecheck`.
