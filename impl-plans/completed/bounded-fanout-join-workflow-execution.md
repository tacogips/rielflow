# Bounded Fanout Join Workflow Execution Implementation Plan

**Status**: Completed
**Created**: 2026-05-05
**Last Updated**: 2026-05-06
**Design Reference**: `design-docs/specs/design-bounded-fanout-join-workflow-execution.md`, `design-docs/specs/design-node-execution-inbox-contract.md`

## Goal

Complete the remaining bounded fanout runtime gap after parent-session local fanout execution landed: verify and implement TASK-003 lifecycle semantics for inline local fanout, preserve existing cross-workflow fanout behavior, keep run-level `maxConcurrency` clamping intact, prove every LLM step receives structured input through root `input.json` and `mailbox/inbox/input.json`, keep `DIVEDRA_MAILBOX_DIR` guidance intact, fix isolated retry workspace lineage, and keep design/plan documentation aligned with actual behavior.

## Source References

- Issue source: `runtimeVariables.workflowInput`
- Issue title: `Continue bounded fanout inline subworkflow implementation and mailbox input verification`
- Accepted design: `design-docs/specs/design-bounded-fanout-join-workflow-execution.md`
- Accepted inbox contract: `design-docs/specs/design-node-execution-inbox-contract.md`
- Codex references: `<reference-repository-root>/src/group/manager.ts`, `<reference-repository-root>/src/group/types.ts`, `<reference-repository-root>/src/queue/runner.ts`, `<reference-repository-root>/impl-plans/completed/phase3-sqlite-group-queue.md`

Codex-agent maps only to the bounded scheduler mechanics: `runGroup()` keeps an in-flight set up to `maxConcurrent` and refills it as work completes. divedra intentionally diverges by executing step-addressed workflow work items, persisting fanout group state on workflow sessions, and preserving mailbox, retry, timeout, artifact, GraphQL, CLI, TUI, and library inspection semantics.

## Review Feedback Addressed

- Step 5 review feedback from `comm-000008` is plan-only; the accepted design remains the source of truth.
- Tasks with blocking dependencies are no longer marked parallelizable even when their later write scopes could be split after the depended-on state shape stabilizes.
- Retry workspace lineage now depends on local parent-session branch execution when local retry coverage is part of the task completion criteria.
- Verification now calls out persisted retry lineage, local fanout regressions, cross-workflow fanout preservation, and run-level `maxConcurrency` regressions separately.
- Step 5 review feedback from `comm-000008` is addressed by making the requested server typecheck and LLM input/mailbox adapter test commands explicit in the verification plan.
- Step 5 review feedback from `comm-000011` is addressed by treating TASK-002 parent-session local fanout as landed and focusing the remaining plan text on TASK-003 lifecycle and mailbox verification.

## Current Runtime Alignment

Already-supported behavior that must not regress:

- authored `WorkflowStepTransition.fanout`, `defaults.fanoutConcurrency`, and run-level `maxConcurrency`
- persisted fanout group/branch records and deterministic input-ordered join aggregation
- branch runtime variables: `runtimeVariables[itemVariable]`, `runtimeVariables.fanout.*`, and `runtimeVariables.fanoutJoin`
- cross-workflow fanout through bounded child workflow executions, `workflow-calls/` artifacts, branch workspace roots, nested concurrency-budget inheritance, and caller-workflow join aggregation
- shared-worktree ownership validation for read-only, disjoint-path, and isolated-workspace fanout declarations

Explicit remaining gaps:

- local inline fanout now executes repeated `toStepId` branches in the parent workflow session; TASK-003 must verify and complete lifecycle semantics on that parent-session path
- isolated-workspace branch retry must persist `supersededWorkspaceRoot` for the replacement branch attempt
- local fanout lifecycle coverage must prove failure policies, cancellation, pause/user action, timeout, and `maxSteps` accounting
- LLM node execution coverage must prove root artifact `input.json` and worker-facing `mailbox/inbox/input.json` carry the same structured business input needed by prompts, while `mailbox/inbox/meta.json` declares `DIVEDRA_MAILBOX_DIR` and mailbox-root-relative paths
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

- [x] Land parent-session branch execution for local inline fanout.
- [x] Give every branch a distinct work item id so repeated executions of the same target step do not collapse through queue dedupe.
- [x] Complete TASK-003 lifecycle handling for fail-fast, collect-all, cancellation, pause/user action, timeout, `maxSteps`, and `maxConcurrency` on the parent-session local path.
- [x] Verify local branch, join, and non-fanout LLM executions write root `input.json`, `mailbox/inbox/input.json`, and `mailbox/inbox/meta.json` with `DIVEDRA_MAILBOX_DIR` guidance.
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

- [x] Locate prior isolated-workspace branch attempts by `groupId` and `branchIndex`.
- [x] Persist the prior branch `workspaceRoot` as `supersededWorkspaceRoot` on the replacement branch.
- [x] Include lineage in fanout group state and join output where workspace data is already surfaced.
- [x] Cover both cross-workflow and local fanout retry paths where the runtime has persisted fanout context.

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

- [x] Ensure existing session status/progress/GraphQL/library/TUI views can expose local and cross-workflow fanout groups from the same session state.
- [x] Reject ambiguous branch target reruns unless persisted fanout scope proves the branch context.
- [x] Keep `divedra workflow run --max-concurrency` and GraphQL/event forwarding behavior unchanged.

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

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/engine.ts`, `src/workflow/engine-fanout.ts`, `src/workflow/session.ts`, `src/workflow/engine.test.ts`
**Dependencies**: TASK-001

Completion criteria:

- [x] `toStepId` fanout without `toWorkflowId` executes branches in the parent workflow session.
- [x] Branches receive item variables and `runtimeVariables.fanout` context.
- [x] The same target step can execute once per branch with distinct node execution ids and artifacts.
- [x] Join communication is published once with deterministic input-ordered `fanoutJoin` payload.
- [x] Existing cross-workflow fanout, nested fanout concurrency-budget inheritance, and ordinary sequential queues do not regress.

### TASK-003: Local Fanout Lifecycle Semantics

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/engine.ts`, `src/workflow/engine-fanout.ts`, `src/workflow/adapter.ts`, `src/workflow/call-step-impl.ts`, `src/workflow/mailbox-prompt-guidance.ts`, `src/workflow/engine.test.ts`, `src/workflow/call-step-impl.test.ts`, `src/workflow/adapters/codex.test.ts`, `src/workflow/adapters/claude.test.ts`
**Dependencies**: TASK-002

Completion criteria:

- [x] `fail-fast` stops launching new branches, persists failed group state, and fails with `fanoutGroupRunId` plus `branchIndex`.
- [x] `collect-all` waits for terminal branch results and fails without queueing the join when any branch fails.
- [x] Cancellation, timeout, optional/user-action pause, and resume behavior remain branch-scoped.
- [x] `maxSteps` counts local branch node executions and cannot be multiplied by fanout concurrency.
- [x] Run-level `maxConcurrency` clamps authored/default local fanout concurrency and existing cross-workflow fanout concurrency.
- [x] Local fanout branch LLM executions, join LLM executions, and non-fanout LLM executions write structured root artifact `input.json`.
- [x] The same executions write worker-facing `mailbox/inbox/input.json` with the resolved business input shape required by prompts and containers.
- [x] `mailbox/inbox/meta.json` uses `mailboxDirEnvVar: "DIVEDRA_MAILBOX_DIR"` plus relative `inbox/input.json` and `outbox/output.json` paths.
- [x] Codex and Claude prompt composition includes mailbox path guidance without allowing workers to publish canonical mailbox files directly.

### TASK-004: Isolated Retry Workspace Lineage

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/engine-fanout.ts`, `src/workflow/engine.ts`, `src/workflow/session.ts`, `src/workflow/session-store.test.ts`, `src/workflow/engine.test.ts`
**Dependencies**: TASK-002

Completion criteria:

- [x] Replacement isolated fanout branches record prior attempt workspaces as `supersededWorkspaceRoot`.
- [x] The regression covers the failing isolated fanout retry workspace lineage case.
- [x] Cross-workflow fanout retry lineage remains covered.
- [x] Local fanout retry lineage is covered through parent-session branch context from TASK-002.
- [x] Persisted session reload preserves `workspaceRoot` and `supersededWorkspaceRoot` for replacement branch attempts.

### TASK-005: Inspection And Control Surface Alignment

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/inspect.ts`, `src/lib.ts`, `src/graphql/schema.ts`, `src/cli.ts`, `src/tui/*`, related tests
**Dependencies**: TASK-002, TASK-004

Completion criteria:

- [x] Fanout summaries show local and cross-workflow groups from the same persisted state.
- [x] Branch counts, effective concurrency, source/join ids, failures, output refs, workspace roots, and superseded workspace roots are inspectable where supported.
- [x] Ambiguous branch reruns outside persisted fanout context are rejected.
- [x] CLI aliases/help, GraphQL schema, and library views remain backward compatible.

### TASK-006: Final Verification And Workflow Guardrails

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/engine.test.ts`, `src/workflow/validate.test.ts`, `src/cli.test.ts`, `src/graphql/schema.test.ts`, `.divedra/workflows/design-and-implement-review-loop/workflow.json`, user-facing docs only if output changes
**Dependencies**: TASK-002, TASK-003, TASK-004, TASK-005

Completion criteria:

- [x] All verification commands in this plan pass or have documented environment-only blockers.
- [x] `.divedra/workflows/design-and-implement-review-loop` continues to use cross-workflow fanout safely unless local inline fanout is intentionally adopted after tests pass.
- [x] LLM execution artifacts prove structured input delivery through root `input.json`, `mailbox/inbox/input.json`, and `DIVEDRA_MAILBOX_DIR` metadata guidance.
- [x] Documentation reflects actual supported behavior and remaining coverage.

## Dependencies

| Task     | Depends On                             | Notes                                                                |
| -------- | -------------------------------------- | -------------------------------------------------------------------- |
| TASK-001 | None                                   | Design and plan alignment for this issue                             |
| TASK-002 | TASK-001                               | Core local fanout runtime                                            |
| TASK-003 | TASK-002                               | Lifecycle behavior depends on local branch execution                 |
| TASK-004 | TASK-002                               | Retry lineage completion includes local fanout branch retry coverage |
| TASK-005 | TASK-002, TASK-004                     | Inspection needs stable local branch and lineage state               |
| TASK-006 | TASK-002, TASK-003, TASK-004, TASK-005 | Integration verification                                             |

## Parallelization Notes

- TASK-002 and TASK-003 are serial because they share `src/workflow/engine.ts` and the parent-session branch execution path.
- TASK-004 is serial behind TASK-002 because its completion criteria include local fanout retry lineage, not only existing cross-workflow retry lineage.
- TASK-005 can be split later by operator surface after TASK-002 and TASK-004 stabilize persisted state, but this plan keeps it serial because the listed task has blocking dependencies.
- TASK-006 is serial.

## Verification Plan

- `bun run typecheck:server`
- `bun test src/workflow/validate.test.ts src/workflow/types.test.ts --runInBand`
- `bun test src/workflow/engine.test.ts --runInBand --test-name-pattern fanout`
- `bun test src/workflow/engine.test.ts --runInBand --test-name-pattern "local fanout"`
- `bun test src/workflow/engine.test.ts --runInBand --test-name-pattern "cross-workflow fanout"`
- `bun test src/workflow/engine.test.ts --runInBand --test-name-pattern maxConcurrency`
- `bun test src/workflow/engine.test.ts --runInBand --test-name-pattern "retry workspace"`
- `bun test src/workflow/call-step-impl.test.ts src/workflow/adapters/codex.test.ts src/workflow/adapters/claude.test.ts`
- `bun test src/workflow/session-store.test.ts --runInBand --test-name-pattern fanout`
- `HOME=/private/tmp/divedra-home bun test src/graphql/schema.test.ts src/cli.test.ts --runInBand`
- `test ! -d src/tui`
- `bun run src/main.ts workflow validate design-and-implement-review-loop --workflow-definition-dir .divedra/workflows`
- `bun run src/main.ts workflow validate design-and-implement-review-loop-feature-plan --workflow-definition-dir .divedra/workflows`
- `git diff --check`

## Plan Completion Criteria

- [x] Parent-session local `itemsFrom` fanout runs repeated target-step branches with distinct branch context.
- [x] Cross-workflow fanout remains bounded and joins deterministically.
- [x] Nested fanout continues to inherit the remaining runtime maximum concurrency budget.
- [x] Join payloads preserve input ordering and include branch item/output refs.
- [x] Failure policies, cancellation, pause, timeout, and `maxSteps` behavior are covered for local fanout.
- [x] Isolated retry workspace lineage persists `supersededWorkspaceRoot`.
- [x] Inspection surfaces expose fanout group state and workspace lineage.
- [x] All verification commands pass or document non-code blockers.

## Progress Log

### Session: 2026-05-05 18:48 JST

**Tasks Completed**: TASK-001.
**Tasks In Progress**: None.
**Blockers**: None for planning. Implementation remains blocked on TASK-002 through TASK-006.
**Notes**: Rebased the active plan on the accepted design update for inline local fanout. The plan now separates already-supported cross-workflow fanout from the required parent-session local fanout implementation and keeps retry workspace lineage explicit.

### Session: 2026-05-05 20:05 JST

**Tasks Completed**: TASK-001 review-feedback revision.
**Tasks In Progress**: None.
**Blockers**: None for planning. Implementation remains blocked on TASK-002 through TASK-006.
**Notes**: Addressed Step 5 plan-only feedback by tightening task dependencies, removing the parallelizable flag from dependency-blocked inspection work, and adding explicit persisted retry-lineage verification.

### Session: 2026-05-05 20:24 JST

**Tasks Completed**: TASK-001 review-feedback revision.
**Tasks In Progress**: None.
**Blockers**: None for planning. Implementation remains blocked on TASK-002 through TASK-006.
**Notes**: Reconciled the plan with Step 5 `comm-000008` for the inline/local fanout issue by making cross-workflow fanout preservation and run-level `maxConcurrency` regression coverage explicit alongside local fanout and retry-lineage work.

### Session: 2026-05-05 20:44 JST

**Tasks Completed**: TASK-002.
**Tasks In Progress**: None.
**Blockers**: TASK-003 through TASK-006 remain open.
**Notes**: Implemented inline local fanout by executing each `toStepId` branch through the parent workflow execution's direct step path, restoring parent runtime variables between branch attempts, persisting branch node executions/artifacts on the parent session, and publishing one deterministic fanout join communication. Cross-workflow fanout continues to use the existing bounded scheduler; local branch execution is serialized through the current single-writer parent-session mutation path until TASK-003 expands lifecycle/concurrency semantics.

### Session: 2026-05-05 21:05 JST

**Tasks Completed**: Step 4 plan revision for the current issue-resolution run.
**Tasks In Progress**: TASK-003 is the next implementation target.
**Blockers**: None for planning; implementation must self-review existing input/mailbox changes before editing lifecycle behavior.
**Notes**: Rebased the active plan on the accepted Step 3 design review for `Continue bounded fanout inline subworkflow implementation and mailbox input verification`. TASK-003 now explicitly includes local fanout lifecycle semantics and LLM structured-input artifact/mailbox verification, including `DIVEDRA_MAILBOX_DIR` guidance and adapter prompt boundaries.

### Session: 2026-05-05 21:16 JST

**Tasks Completed**: Step 4 revision for Step 5 `comm-000008` feedback.
**Tasks In Progress**: TASK-003 remains the next implementation target.
**Blockers**: None for planning.
**Notes**: Replaced generic typecheck verification with `bun run typecheck:server` and added the explicit LLM input/mailbox adapter verification command covering `call-step-impl`, Codex, and Claude adapters.

### Session: 2026-05-05 21:26 JST

**Tasks Completed**: Step 4 revision for Step 5 `comm-000011` feedback.
**Tasks In Progress**: TASK-003 remains the next implementation target.
**Blockers**: None for planning.
**Notes**: Removed stale pre-TASK-002 local fanout wording, updated the local fanout module checklist to point at TASK-003 lifecycle and mailbox verification, and kept cross-workflow fanout preservation plus effective `maxConcurrency` verification explicit.

### Session: 2026-05-06 10:22 JST

**Tasks Completed**: TASK-003 partial lifecycle and mailbox verification.
**Tasks In Progress**: TASK-003.
**Blockers**: Cancellation and optional/user-action pause/resume behavior still need explicit local fanout implementation/coverage before TASK-003 can be completed.
**Notes**: Added local fanout regression coverage for fail-fast, collect-all, timeout, `maxSteps`, local `maxConcurrency` clamping, and branch/join/non-fanout root `input.json` plus `mailbox/inbox/input.json` and `mailbox/inbox/meta.json` artifacts. Verified Codex/Claude prompt guidance and direct step mailbox contract tests with ambient workflow env vars cleared for isolation.

### Session: 2026-05-06 10:29 JST

**Tasks Completed**: TASK-003.
**Tasks In Progress**: None for TASK-003; TASK-004 through TASK-006 remain open.
**Blockers**: None for TASK-003. Broader plan work remains blocked on later task dependencies.
**Notes**: Addressed Step 3 revision feedback by adding parent-session local fanout cancellation handling that persists cancelled branch records and exits with cancellation status, plus local fanout coverage for branch-scoped optional and user-action lifecycle boundaries. Re-ran local fanout tests, server typecheck, whitespace checks, and adapter/mailbox tests with workflow ambient env vars cleared for isolation.

### Session: 2026-05-06 10:39 JST

**Tasks Completed**: TASK-003 review-feedback revision.
**Tasks In Progress**: None for TASK-003; TASK-004 through TASK-006 remain open.
**Blockers**: None for TASK-003. Broader plan work remains blocked on later task dependencies.
**Notes**: Reworked parent-session local fanout optional and user-action lifecycle handling so these branches persist `paused` records, leave later branches pending, skip the join, and return a paused workflow result instead of failing direct-step execution. Resume without an external decision remains branch-scoped and paused. Re-ran local fanout tests, broader fanout tests, server typecheck, and whitespace checks.

### Session: 2026-05-06 10:46 JST

**Tasks Completed**: TASK-004.
**Tasks In Progress**: None for TASK-004; TASK-005 and TASK-006 remain open.
**Blockers**: None for TASK-004. TASK-005 is now unblocked by retry workspace lineage completion.
**Notes**: Added local isolated fanout retry workspace lineage coverage that reloads the persisted session and verifies replacement branches retain new `workspaceRoot` values plus prior-attempt `supersededWorkspaceRoot` values. Added a session-store roundtrip regression for fanout branch workspace lineage fields. Re-ran retry workspace tests, full fanout-focused engine tests, session-store tests, and server typecheck.

### Session: 2026-05-06 10:54 JST

**Tasks Completed**: TASK-005.
**Tasks In Progress**: None for TASK-005; TASK-006 remains open.
**Blockers**: None for TASK-005.
**Notes**: Extended fanout summaries with source node execution id, failure policy, result order, and branch-level node execution ids, output refs, workspace roots, and superseded workspace roots so CLI, GraphQL, and library runtime views expose local and cross-workflow fanout groups from the same persisted session state. Added a rerun guard that rejects ambiguous direct reruns of multi-branch fanout target steps without branch context. Re-ran fanout-focused engine tests, rerun/GraphQL/CLI focused tests, and server typecheck.

### Session: 2026-05-06 11:01 JST

**Tasks Completed**: TASK-006.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Completed the final verification pass. Verified typecheck, workflow schema validation, local and cross-workflow fanout regressions, max concurrency, retry workspace lineage, mailbox/adapter artifact contracts, session persistence, GraphQL/CLI surfaces, workflow bundle validation, and whitespace checks. Confirmed `.divedra/workflows/design-and-implement-review-loop` still uses bounded cross-workflow fanout to `design-and-implement-review-loop-feature-plan` with `resumeStepId` and `joinStepId` set to `step5-feature-plan-join`; local inline fanout was not adopted for that workflow. Replaced the stale TUI test command with an explicit `test ! -d src/tui` guard because this checkout has no `src/tui` module.
