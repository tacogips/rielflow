# Workflow Runner Module Split Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#workflow-runner-module-split`
**Created**: 2026-05-13
**Last Updated**: 2026-05-13

## Design Document Reference

This plan implements the accepted architecture update for splitting
`src/workflow/engine/workflow-runner-lifecycle.ts`, the remaining oversized
workflow engine source file, into responsibility-named TypeScript modules under
`src/workflow/engine/`.

Scope includes only local semantic extraction needed to make Biome
`lint/nursery/noExcessiveLinesPerFile` pass without suppressions. The public
facade `src/workflow/engine.ts`, the internal runner facade
`src/workflow/engine/workflow-runner.ts`, and the public runner entrypoint
`src/workflow/engine/auto-improve-and-runner.ts` must keep their existing
behavior.

Out of scope:

- changing workflow runtime behavior, queue semantics, retry behavior, manager
  control semantics, or external output publication behavior
- creating ordinal files such as `part-01.ts`
- adding `biome-ignore` comments or disabling `noExcessiveLinesPerFile`
- reconstructing modules through source strings, `eval`, `Function`, or
  `globalThis.Function`
- reverting unrelated dirty working-tree changes

## Codex Reference Mapping

No Codex-reference repository, issue URL, issue repository, or issue number was
provided. Step 1 attempted the preferred local root `../../codex-agent`, but it
was unavailable. This plan therefore traces to the workflow input, local design
documents, and local source paths only.

There are no intentional divergences from Codex-reference behavior because no
reference behavior was available for comparison.

## Modules

### 1. Runner Orchestration Shell

#### `src/workflow/engine/workflow-runner-lifecycle.ts`

**Status**: COMPLETED

```typescript
export async function runWorkflowInternal(
  workflowName: string,
  options: NormalizedWorkflowRunOptions,
  adapter?: NodeAdapter,
  guards?: EngineExecutionGuards,
  crossWorkflowInvocationStack?: readonly string[],
): Promise<Result<WorkflowRunResult, WorkflowRunFailure>>;
```

**Checklist**:

- [x] Keep only queue-loop sequencing and phase orchestration in this file.
- [x] Delegate setup, session entry, step input, node execution, and
      finalization to typed helpers.
- [x] Keep the file below 1000 lines.

### 2. Shared Runner Context

#### `src/workflow/engine/workflow-runner-deps.ts`

**Status**: COMPLETED

```typescript
interface WorkflowRunnerBaseContext {
  workflowName: string;
  options: NormalizedWorkflowRunOptions;
  adapter?: NodeAdapter;
  guards?: EngineExecutionGuards;
  crossWorkflowInvocationStack: readonly string[];
}

interface WorkflowRunnerLoadedContext extends WorkflowRunnerBaseContext {
  workflowWorkingDirectory: string;
  loaded: LoadedWorkflow;
  workflow: WorkflowJson;
}
```

**Checklist**:

- [x] Define only the context records needed by at least two extracted modules.
- [x] Keep mutable state explicit on context objects.
- [x] Avoid circular imports by keeping runtime helper functions in their
      responsibility modules.

### 3. Run Setup

#### `src/workflow/engine/run-setup.ts`

**Status**: COMPLETED

```typescript
interface PrepareWorkflowRunInput {
  workflowName: string;
  options: NormalizedWorkflowRunOptions;
  adapter?: NodeAdapter;
  guards?: EngineExecutionGuards;
  crossWorkflowInvocationStack: readonly string[];
}

async function prepareWorkflowRun(
  input: PrepareWorkflowRunInput,
): Promise<Result<WorkflowRunSetupContext, WorkflowRunFailure>>;
```

**Checklist**:

- [x] Move working-directory resolution and mutually exclusive entry-mode
      validation.
- [x] Move source-session preload for resume, rerun, and continuation.
- [x] Move workflow loading, auto-improve execution-copy reload, runtime
      readiness checks, adapter selection, cancellation probe setup, manager
      session store creation, and static workflow maps.
- [x] Keep this file below 1000 lines.

### 4. Session Entry

#### `src/workflow/engine/session-entry.ts`

**Status**: COMPLETED

```typescript
interface EnterWorkflowSessionInput {
  setup: WorkflowRunSetupContext;
}

async function enterWorkflowSession(
  input: EnterWorkflowSessionInput,
): Promise<Result<WorkflowSessionEntryContext, WorkflowRunFailure>>;
```

**Checklist**:

- [x] Move fresh-run, resume, rerun, and history-linked continuation setup.
- [x] Move auto-improve supervision state attachment and bootstrap human input
      communication.
- [x] Move nested superviser handoff and early paused/completed returns.
- [x] Keep this file below 1000 lines.

### 5. Step Input

#### `src/workflow/engine/step-input.ts`

**Status**: COMPLETED

```typescript
interface PrepareStepInput {
  runner: WorkflowRunnerLoopContext;
  session: WorkflowSessionState;
  stepId: string;
}

async function prepareStepExecution(
  input: PrepareStepInput,
): Promise<Result<PreparedStepExecution, WorkflowRunFailure>>;
```

**Checklist**:

- [x] Move missing-step failure handling and optional-step decision gating.
- [x] Move scenario/dry-run payload resolution, execution id allocation, and
      artifact directory setup.
- [x] Move workflow-run event emission, upstream/latest-output mailbox input
      resolution, prompt/input assembly, and candidate path preparation.
- [x] Keep this file below 1000 lines.

### 6. Node Execution

#### `src/workflow/engine/node-execution.ts`

**Status**: COMPLETED

```typescript
interface ExecutePreparedStepInput {
  runner: WorkflowRunnerLoopContext;
  prepared: PreparedStepExecution;
}

async function executePreparedStep(
  input: ExecutePreparedStepInput,
): Promise<Result<NodeExecutionPhaseResult, WorkflowRunFailure>>;
```

**Checklist**:

- [x] Move user-action pause handling and optional skip execution.
- [x] Move agent/native execution, manager control-plane environment setup,
      timeout and stall policy, output-contract candidate attempts, schema
      validation, process/LLM log capture, backend session persistence, and
      execution-log normalization.
- [x] Keep this file below 1000 lines.

### 7. Result Finalization

#### `src/workflow/engine/result-finalization.ts`

**Status**: COMPLETED

```typescript
interface FinalizeStepResultInput {
  runner: WorkflowRunnerLoopContext;
  phaseResult: NodeExecutionPhaseResult;
}

async function finalizeStepResult(
  input: FinalizeStepResultInput,
): Promise<Result<WorkflowRunnerTransitionResult, WorkflowRunFailure>>;
```

**Checklist**:

- [x] Keep existing `finalizeCompletedWorkflowRun()` behavior intact.
- [x] Move input/output/meta/handoff artifact writing and runtime DB
      persistence.
- [x] Move manager session finalization, optional manager decisions,
      completion-rule evaluation, communication consumption, edge/loop
      transition selection, local fanout dispatch, cross-workflow dispatch,
      retry queue updates, workflow output runtime-variable updates, terminal
      failure mapping, and final external output publication.
- [x] Keep this file below 1000 lines.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Orchestration shell | `src/workflow/engine/workflow-runner-lifecycle.ts` | COMPLETED | Targeted workflow engine tests |
| Shared dependencies | `src/workflow/engine/workflow-runner-deps.ts` | COMPLETED | Typecheck and targeted workflow engine tests |
| Run setup | `src/workflow/engine/run-setup.ts` | COMPLETED | Targeted workflow engine tests |
| Session entry | `src/workflow/engine/session-entry.ts` | COMPLETED | Resume/rerun/continuation tests |
| Step input | `src/workflow/engine/step-input.ts` | COMPLETED | Call-step and mailbox-adjacent tests |
| Node execution | `src/workflow/engine/node-execution.ts` | COMPLETED | Call-step implementation and manager-control tests |
| Result finalization | `src/workflow/engine/result-finalization.ts` | COMPLETED | Workflow completion, fanout, and supervisor tests |

## Task Breakdown

### TASK-001: Baseline Inspection And Rejected Pattern Guard

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- Record current line counts for `src/workflow/engine/*.ts`.
- Confirm no dynamic source reconstruction is present or introduced.
- Identify existing extracted stubs and partial finalization helper boundaries.

**Completion Criteria**:

- [x] `find src/workflow/engine -maxdepth 1 -type f -name '*.ts' -print | sort | xargs wc -l | sort -nr` is recorded in the progress log.
- [x] `rg "globalThis\\.Function|WORKFLOW_RUNNER_.*_SOURCE|eval\\(|Function\\(" src/workflow/engine` returns no implementation blockers.

### TASK-002: Extract Run Setup

**Status**: COMPLETED
**Parallelizable**: No
**Depends On**: TASK-001
**Deliverables**:

- `src/workflow/engine/workflow-runner-deps.ts`
- `src/workflow/engine/run-setup.ts`
- smaller `src/workflow/engine/workflow-runner-lifecycle.ts`

**Completion Criteria**:

- [x] Setup helper returns typed success/failure instead of throwing for normal
      run setup failures.
- [x] `runWorkflowInternal()` delegates setup without changing error messages.
- [x] No touched source file exceeds 1000 lines.

### TASK-003: Extract Session Entry

**Status**: COMPLETED
**Parallelizable**: No
**Depends On**: TASK-002
**Deliverables**:

- `src/workflow/engine/session-entry.ts`
- smaller `src/workflow/engine/workflow-runner-lifecycle.ts`

**Completion Criteria**:

- [x] Fresh, resume, rerun, and continuation entry paths preserve session
      status and queue behavior.
- [x] Auto-improve and nested superviser entry handling remain behaviorally
      identical.
- [x] No touched source file exceeds 1000 lines.

### TASK-004: Extract Step Input

**Status**: COMPLETED
**Parallelizable**: No
**Depends On**: TASK-003
**Deliverables**:

- `src/workflow/engine/step-input.ts`
- smaller `src/workflow/engine/workflow-runner-lifecycle.ts`

**Completion Criteria**:

- [x] Prepared step records contain all fields needed for execution and
      finalization.
- [x] Mailbox input, prompt assembly, candidate path, and scenario/dry-run
      semantics match the pre-split behavior.
- [x] No touched source file exceeds 1000 lines.

### TASK-005: Extract Node Execution

**Status**: COMPLETED
**Parallelizable**: No
**Depends On**: TASK-004
**Deliverables**:

- `src/workflow/engine/node-execution.ts`
- smaller `src/workflow/engine/workflow-runner-lifecycle.ts`

**Completion Criteria**:

- [x] Agent and native node execution paths preserve timeout, stall, log,
      candidate-output, and backend-session behavior.
- [x] Optional skip and user-action pause behavior remain unchanged.
- [x] No touched source file exceeds 1000 lines.

### TASK-006: Extract Result Finalization And Transitions

**Status**: COMPLETED
**Parallelizable**: No
**Depends On**: TASK-005
**Deliverables**:

- expanded `src/workflow/engine/result-finalization.ts`
- smaller `src/workflow/engine/workflow-runner-lifecycle.ts`

**Completion Criteria**:

- [x] Artifact writes, runtime DB persistence, manager decisions,
      communication consumption, completion evaluation, edge/loop transition,
      fanout, cross-workflow dispatch, retry, runtime-variable, terminal
      failure, and external-output publication paths preserve behavior.
- [x] No touched source file exceeds 1000 lines.

### TASK-007: Import Surface And Verification Closure

**Status**: COMPLETED
**Parallelizable**: No
**Depends On**: TASK-006
**Deliverables**:

- stable exports through `src/workflow/engine.ts`,
  `src/workflow/engine/workflow-runner.ts`, and
  `src/workflow/engine/auto-improve-and-runner.ts`
- documentation check for README and exposed workflow skill references if any
  public file path, module responsibility, or workflow instruction becomes
  stale after extraction
- progress-log update with verification results

**Completion Criteria**:

- [x] `bun run format` passes.
- [x] `bun run typecheck` passes.
- [x] `bun run lint:biome` passes with no `noExcessiveLinesPerFile` errors.
- [x] Targeted workflow tests pass.
- [x] Line-count and rejected-pattern checks pass.
- [x] Documentation changes are either unnecessary because no public reference
      became stale, or are completed in the later user-facing documentation
      refresh step.

## Dependencies

| Task | Depends On | Status |
| --- | --- | --- |
| TASK-001 | None | COMPLETED |
| TASK-002 | TASK-001 | COMPLETED |
| TASK-003 | TASK-002 | COMPLETED |
| TASK-004 | TASK-003 | COMPLETED |
| TASK-005 | TASK-004 | COMPLETED |
| TASK-006 | TASK-005 | COMPLETED |
| TASK-007 | TASK-006 | COMPLETED |

No tasks are marked parallelizable. Although files have distinct target
responsibilities, each extraction changes the same orchestration shell and
shared context shape, so the write scopes are not disjoint.

## Verification Plan

Run these commands before closing the implementation:

```bash
bun run format
bun run typecheck
bun run lint:biome
bun test src/workflow/engine.test.ts src/workflow/call-step.test.ts src/workflow/call-step-impl-execution.test.ts src/workflow/call-step-impl-failures.test.ts src/workflow/history-continuation.test.ts src/workflow/manager-control.test.ts src/workflow/manager-message-service.test.ts src/workflow/manager-session-store.test.ts src/workflow/superviser.test.ts src/workflow/auto-improve-policy.test.ts src/workflow/supervisor-runner-pool.test.ts
find src -name '*.ts' -not -name '*.test.ts' -print | xargs wc -l | sort -nr | sed -n '1,40p'
rg "globalThis\\.Function|WORKFLOW_RUNNER_.*_SOURCE|eval\\(|part-[0-9]+|biome-ignore.*noExcessiveLinesPerFile|noExcessiveLinesPerFile" src/workflow/engine design-docs/specs/architecture.md impl-plans/active/workflow-runner-module-split.md
```

The final `rg` command is expected to show only legitimate design/plan
references to `noExcessiveLinesPerFile`; it must not show implementation
suppression comments, disabled lint rules, source-string reconstruction, or
ordinal split filenames.

## Completion Criteria

- [x] `src/workflow/engine/workflow-runner-lifecycle.ts` is below 1000 lines.
- [x] Every non-test TypeScript source file under `src` is below 1000 lines.
- [x] Responsibility-named modules own setup, session entry, step input, node
      execution, and result finalization behavior.
- [x] Public facade imports remain stable.
- [x] No Biome suppressions or lint-rule disabling are added.
- [x] No source-string, `eval`, `Function`, or `globalThis.Function` runner
      reconstruction exists.
- [x] README and exposed workflow skill references are checked for stale public
      paths or instructions after the split.
- [x] Required verification commands pass or any failure is documented with a
      concrete blocker.

## Addressed Review Feedback

- Step 3 design review accepted the design with low feedback.
- This plan explicitly includes `bun run format`, `bun run typecheck`, and
  `bun run lint:biome` as required verification commands.
- This plan keeps implementation scoped to
  `src/workflow/engine/workflow-runner-lifecycle.ts` semantic extraction under
  `src/workflow/engine/` while preserving facade behavior.
- No Step 5 implementation-plan review feedback exists for this execution.

## Progress Log

### Session: 2026-05-13

**Tasks Completed**: Step 4 implementation-plan creation.
**Tasks In Progress**: TASK-001 baseline inspection was scheduled for Step 6.
**Blockers**: None for implementation planning.
**Notes**: Created an actionable Step 4 implementation plan tied to the
accepted architecture design and Step 3 review feedback. Later implementation
sessions must update task statuses, completion criteria, line-count results,
and verification outcomes here before handoff.

### Session: 2026-05-13 Step 6 implementation baseline

**Tasks Completed**: TASK-001.
**Tasks In Progress**: None.
**Blockers**: The semantic extraction tasks remain to be implemented; Biome
still fails on `src/workflow/engine/workflow-runner-lifecycle.ts` at 3192
lines.
**Notes**: Recorded the current engine line-count baseline:

```text
  6860 total
  3192 src/workflow/engine/workflow-runner-lifecycle.ts
   767 src/workflow/engine/fanout-dispatch.ts
   736 src/workflow/engine/cross-workflow-dispatch.ts
   707 src/workflow/engine/mailbox-communication-artifacts.ts
   663 src/workflow/engine/types-and-session-state.ts
   634 src/workflow/engine/auto-improve-and-runner.ts
   146 src/workflow/engine/result-finalization.ts
     3 src/workflow/engine/step-input.ts
     3 src/workflow/engine/session-entry.ts
     3 src/workflow/engine/run-setup.ts
     3 src/workflow/engine/node-execution.ts
     2 src/workflow/engine/mailbox-and-communications.ts
     1 src/workflow/engine/workflow-runner.ts
```

The rejected-pattern scan found no implementation blockers in
`src/workflow/engine`; matches were limited to design/plan references for the
guardrail text. `bun run lint:biome` was run and failed only with
`lint/nursery/noExcessiveLinesPerFile` for
`src/workflow/engine/workflow-runner-lifecycle.ts`.

### Session: 2026-05-13 Step 4 plan consistency refresh

**Tasks Completed**: TASK-001 remains completed from the recorded baseline.
**Tasks In Progress**: TASK-002 is ready for immediate TypeScript extraction
work in the next implementation step.
**Blockers**: None for implementation-plan handoff.
**Notes**: Aligned this plan with `impl-plans/PROGRESS.json`: plan status is
`In Progress`, TASK-001 is `COMPLETED`, TASK-002 is `IN_PROGRESS`, and later
tasks remain blocked by the sequential lifecycle-shell extraction dependency.

### Session: 2026-05-13 completion closure

**Tasks Completed**: TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Completed the semantic split of `src/workflow/engine/workflow-runner-lifecycle.ts` into responsibility-named modules. Verification passed with `bun run format`, `bun run typecheck`, `bun run lint:biome`, `find src -name '*.ts' -not -name '*.test.ts' -print | xargs wc -l | sort -nr | sed -n '1,40p'`, the rejected-pattern scan, and the targeted workflow test command from this plan. A split regression where `llmMessages` was not passed into `finalizeExecutedNode()` caused runtime DB execution rows to be skipped; it was fixed and the previously failing `persists step-addressed execution metadata for shared-node workflow runs` test now passes in the full targeted suite.
