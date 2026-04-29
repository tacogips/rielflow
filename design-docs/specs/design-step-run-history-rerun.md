# Step-Run History Rerun Design

This document defines a restart model for step-addressed workflows that can
start a new workflow execution from the middle while reusing prior successful
execution history by reference rather than by cloning artifacts.

## Overview

Current repository state already has:

- workflow-level rerun by `session rerun <workflowExecutionId> <stepId>`
- persisted per-execution records in `session.nodeExecutions[]`
- a stable per-execution id `nodeExecId`
- ordered execution history through `nodeExecutionCounter` plus append order
- GraphQL and export surfaces that can inspect node executions

Current repository state does **not** have:

- workflow rerun anchored to a specific prior step execution id
- a new workflow execution that inherits prior step results by reference
- an operator surface dedicated to browsing step-run history and selecting the
  restart anchor

As implemented today, rerun creates a fresh workflow execution seeded from the
source workflow execution's runtime variables and a chosen `stepId`; prior `nodeExecutions`,
communications, and accepted outputs are not attached to the new run.

## Problem

For jump-based workflows, `stepId` alone is not a sufficient restart anchor.

Example execution order:

1. `step-1`
2. `step-2`
3. `step-3`
4. `step-1`

If the workflow later fails and the operator wants to restart from `step-2`,
the runtime must know **which** `step-1` output is the intended upstream state.
The answer is temporal, not structural.

The restart anchor must therefore be a concrete step execution inside one prior
workflow execution, not only a logical step id.

## Goals

- Allow operators to start a new workflow execution from a chosen step while
  reusing source-history outputs up to a chosen prior execution anchor.
- Keep prior history immutable and shared by reference.
- Preserve full execution ordering across loops, jumps, and repeated visits.
- Make the restart anchor operator-visible and queryable.
- Keep step-addressed workflows step-first on public surfaces.

## Non-Goals

- Cloning prior artifacts into the new workflow execution.
- Mutating the source workflow execution.
- Reusing failed source-step outputs implicitly.
- Replacing ordinary `session resume`; paused/incomplete session continuation
  remains a separate path.

## Terminology

- `workflowExecutionId`: the persisted workflow run id (`sessionId` today).
- `stepRunId`: the operator-facing id of one concrete step execution in a
  workflow execution.
- `history segment`: one ordered imported prefix owned by a specific workflow
  execution and referenced from a continued run.
- `source history`: the ordered accepted execution history imported from a prior
  workflow execution.
- `owning execution`: the workflow execution that originally created one
  persisted step run row and its artifacts.
- `timeline`: a derived merged view made from imported source-history rows plus
  locally executed rows in the current workflow execution.

## Identity Model

The repository already persists a unique per-execution `nodeExecId` together
with `stepId`. For step-addressed workflows, this is already the correct
concrete execution identity.

Design decision:

- treat existing `nodeExecId` as the canonical persisted execution id
- expose a step-addressed alias `stepRunId` on public inspection/restart
  surfaces
- define `stepRunId` as exactly the same stored value as `nodeExecId`, not a
  second translated identifier namespace
- keep `nodeExecId` in low-level/runtime compatibility paths until broader
  naming cleanup is done

This avoids inventing a second identifier for the same execution.

## Required Data-Model Changes

### 1. Explicit owning-execution ordinal

Add an explicit per-workflow-execution ordinal to each execution record:

- `executionOrdinal: number`

Requirements:

- monotonic within the owning workflow execution
- allocated from the same sequence as `nodeExecutionCounter`
- persisted in session state and runtime-db execution rows
- used to resolve "all history through this step run"

Rationale:

- append order is currently implied, not modeled explicitly on each row
- restart semantics need a stable inclusive prefix boundary

Design note:

- `executionOrdinal` is owned by the workflow execution that created the row
- for ordinary non-continued runs, `executionOrdinal` is also the visible order
- for continued runs, merged-history views must expose a derived
  `timelineOrdinal` so imported rows and local rows form one operator-visible
  sequence without rewriting source rows

### 2. Workflow continuation lineage

Add continuation metadata to the new workflow execution:

- `continuedFromWorkflowExecutionId?: string`
- `continuedAfterStepRunId?: string`
- `continuedAfterExecutionOrdinal?: number`
- `continuedStartStepId?: string`
- `continuationMode?: "fresh-run" | "resume" | "rerun-from-history"`

This identifies:

- the source workflow execution
- the exact imported-history boundary
- the step where the new execution starts

### 3. Imported history descriptors

Persist ordered import descriptors on the new workflow execution:

- `historyImports?: [{ sourceWorkflowExecutionId, throughStepRunId, throughExecutionOrdinal }]`

Descriptor rules:

- `historyImports` is an ordered oldest-to-newest list of imported history
  segments, not a single pointer
- each entry describes the inclusive imported prefix for one owning workflow
  execution
- the last entry may reference the immediate `sourceWorkflowExecutionId` when
  the chosen anchor belongs to that execution's local rows
- if the chosen anchor belongs to imported ancestry, later source-local segments
  are omitted instead of being represented recursively

Only boundaries are stored. The actual historical rows stay owned by their
source workflow executions.

### 4. Source-workflow-execution retention rule

A workflow execution that is referenced by `historyImports` must not be deleted
until all dependent continued runs are deleted, or deletion must fail with a
dependency error.

### 5. Flattened continuation ancestry

Continuation must support continuing from a workflow execution that is itself a
continued run.

Normalization rule:

- at continuation creation time, the runtime resolves and flattens the full
  source ancestry into ordered `historyImports`
- execution-time history reads operate on this flattened descriptor rather than
  recursively walking parent executions on every lookup

This avoids recursive hot-path lookups and makes export/inspection deterministic.

## Restart Semantics

### New operator inputs

History-linked continuation requires both:

- `startStepId`: where the new workflow execution begins
- `afterStepRunId`: the last source step run whose history is shared with the
  new execution

`afterStepRunId` should normally be the last successful step run before the
failure point.

Validation rules:

- `sourceWorkflowExecutionId` must exist
- `startStepId` must be a valid step in the current workflow definition
- `afterStepRunId` must resolve inside the merged step-run history visible from
  `sourceWorkflowExecutionId`
- `afterStepRunId` must resolve to a step-addressed execution row
- only terminal source rows are allowed
- default allowed statuses: `succeeded`, `skipped`
- the source workflow id must match the target workflow id unless a later
  cross-workflow continuation mode is explicitly designed
- step ids used by the restarted path must remain stable across the workflow
  repair; continuation after incompatible step-id renames is out of scope for
  this iteration

Anchor-resolution rule:

- resolving `afterStepRunId` yields both the owning workflow execution and the
  owning `executionOrdinal`
- the immediate `sourceWorkflowExecutionId` is the timeline being inspected, not
  necessarily the owner of the chosen anchor row
- continuation creation must flatten imported ancestry only through that
  resolved anchor, dropping any newer imported or local rows that appear later
  in the source timeline

### History window

Imported source history is the ordered concatenation of `historyImports`
segments.

For a fresh continuation from a non-continued source run, that reduces to one
inclusive prefix:

- all execution rows in the source workflow execution
- where `executionOrdinal <= continuedAfterExecutionOrdinal`

For the example `step-1, step-2, step-3, step-1`, choosing the final `step-1`
run as `afterStepRunId` imports all four rows.

Import rule:

- all rows in the prefix remain visible for audit/history, including failed or
  timed-out intermediate attempts that happened before the anchor
- when the source workflow execution is itself continued, imported rows are
  flattened into ordered segments up to the chosen anchor rather than looked up
  recursively at execution time
- upstream output resolution only considers rows that actually published usable
  output refs under the existing runtime rules

### Read precedence during the new run

When the new workflow execution resolves upstream outputs:

1. Prefer outputs created in the new workflow execution.
2. Fall back to imported source-history rows.
3. Never search later-than-anchor rows from the source workflow execution.

This lets the new run override imported history naturally as it progresses.

If the source workflow execution already had imported ancestry, fallback must
use the flattened `historyImports` order from oldest imported segment to newest
source segment before considering local rows in the current workflow execution.

### Communication visibility

Imported step runs must make their canonical output refs and communication refs
available by reference.

Requirements:

- no file copying
- output refs continue to point at the source workflow execution's artifact
  directories
- communication inspection must indicate whether a record is local or imported
- replay/retry remains valid only for records owned by the current workflow
  execution unless an explicit cross-execution replay mode is later added
- imported communications and executions are read-only; the continued run must
  not mutate source workflow execution consumption, supersession, or retry state
- imported backend-session handles, manager sessions, and local conversation
  transcript state are not reused across workflow executions
- readiness for a continued run must fail if required imported artifacts are
  missing or corrupt

## Public Surface Changes

### CLI

Keep current `session rerun <workflowExecutionId> <stepId>` as the simple fresh
rerun mode.

Add a new history-linked continuation command:

```bash
divedra session continue <source-workflow-execution-id> \
  --start-step <step-id> \
  --after-step-run <step-run-id>
```

Reasons to use a new command instead of silently changing `session rerun`:

- current rerun behavior already exists and is simpler
- the new mode has materially different semantics
- the operator must think in terms of source-history reuse, not only step jump

Add a history listing command:

```bash
divedra session step-runs <workflowExecutionId> [--step <step-id>] [--status <status>]
```

Expected output fields:

- `timelineOrdinal`
- `executionOrdinal`
- `stepRunId`
- `stepId`
- `nodeRegistryId`
- `status`
- `startedAt`
- `endedAt`
- `imported`
- `sourceWorkflowExecutionId`
- `continuedInWorkflowExecutionIds[]` when present

### GraphQL

Add:

- `continueWorkflowExecution(input: ContinueWorkflowExecutionInput!)`
- `workflowExecutionStepRuns(workflowExecutionId: String!, ...)`

`ContinueWorkflowExecutionInput`:

- `sourceWorkflowExecutionId: String!`
- `startStepId: String!`
- `afterStepRunId: String!`
- optional runtime overrides already supported by execute/rerun

`StepRunView` should expose:

- `workflowExecutionId`
- `timelineOrdinal`
- `executionOrdinal`
- `stepRunId`
- `stepId`
- `nodeRegistryId`
- `status`
- `imported: Boolean!`
- `sourceWorkflowExecutionId`

Compatibility rule for existing inspection queries:

- persisted `WorkflowSessionState.nodeExecutions` remains local-only state for
  the owning workflow execution
- merged imported-history inspection uses the new step-run history query rather
  than silently changing the meaning of `session.nodeExecutions`
- `workflowExecutionOverview` may later add an explicit
  `includeImportedHistory` flag, but imported-history merging must not be
  hidden behind an unversioned behavior change

### Session export / TUI

- `session export` must include continuation lineage and `historyImports`
- TUI/browser history views should show execution ordinals and step-run ids
- continued runs should display their source workflow execution and anchor

## Runtime Execution Changes

### Session initialization

A continued run creates a fresh workflow execution id, then persists:

- empty local `nodeExecutions`
- empty local `communications`
- empty local `conversationTurns`
- empty local `nodeBackendSessions`
- the continuation lineage/import descriptor
- queue seeded with `startStepId`
- merged runtime variables using the current rerun behavior

Counter rule:

- `nodeExecutionCounter` and restart budgets remain local to the continued run
- imported history does not count as newly executed work for `maxSteps`,
  restart limits, or other execution guards
- backend session reuse stays execution-local even when the source step used a
  reuse policy inside its original workflow execution
- merged-history inspection derives `timelineOrdinal` from imported history plus
  local `executionOrdinal`; it does not overwrite local counters

### Input assembly

Execution inbox assembly must read from:

- local rows in the continued run
- imported source-history rows from the referenced workflow execution prefix

This is the key implementation change. Restart value comes from input assembly
and output-ref resolution, not from copying old rows into the new session.

The same rule applies to any runtime helper that currently resolves "latest
usable upstream output" by scanning only `session.nodeExecutions`: continued
runs must switch those helpers to a merged-history reader.

Hidden implementation hotspots already present in the current codebase:

- `src/workflow/engine.ts`
  - `buildUpstreamOutputRefs()`
  - `buildUpstreamInputs()`
  - `findLatestPublishedWorkflowResult()`
  - `findLatestWorkflowCallResultExecution()`
- `src/graphql/schema.ts`
  - node-execution view assembly currently scans `session.nodeExecutions`
  - workflow-execution overview currently maps only local `session.nodeExecutions`
- `src/cli.ts`
  - progress summaries currently count only local `session.nodeExecutions`

Implementation rule:

- existing local-only surfaces may stay local-only when that is their documented
  contract
- any surface meant to present restartable operator history must use the merged
  step-run reader instead of ad hoc local-session scans

### Runtime-db helpers

Add helpers that can:

- resolve one step run by id inside a workflow execution
- list step runs in ordinal order
- read the imported prefix for a continuation descriptor
- mark imported rows in inspection responses
- build merged-history timeline views with derived `timelineOrdinal`

## Failure-Recovery Flow

Recommended operator flow:

1. Inspect the failed workflow execution history.
2. Choose the last successful `stepRunId` that defines the desired upstream
   state.
3. Choose `startStepId` for the first step that should execute again.
4. Start a continued run that imports history through that anchor.
5. Inspect the new workflow execution independently from the source run.

If the failure happened in `step-2`, a common pattern is:

- `afterStepRunId =` the last successful upstream step run before `step-2`
- `startStepId = step-2`

If the workflow definition was repaired before restart, the operator is
responsible for selecting a `startStepId` that still exists in the repaired
workflow and is semantically compatible with the imported upstream history.

## Compatibility Notes

- The storage/runtime model may continue to persist `nodeExecId`, but new
  step-addressed operator surfaces should prefer `stepRunId`.
- Existing `session rerun` remains valid as a fresh rerun path.
- `call-step --resume-step-exec <id>` is related but narrower; it continues one
  direct step execution context, not a whole workflow execution with imported
  history.

## Implementation Outline

Primary modules expected to change:

- `src/workflow/session.ts`
- `src/workflow/runtime-db.ts`
- `src/workflow/engine.ts`
- `src/workflow/session-history.ts`
- `src/graphql/schema.ts`
- `src/server/graphql-executable-schema.ts`
- `src/cli.ts`

Suggested implementation phases:

1. Add execution ordinal and continuation lineage persistence.
2. Add step-run listing and inspection surfaces.
3. Add flattened ancestry resolution for chained continuations.
4. Add `continueWorkflowExecution` / `session continue`.
5. Teach input assembly and output-ref resolution to read imported history.
6. Add retention/deletion guards for referenced source workflow executions.

## References

- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`
- `src/workflow/engine.ts`
- `src/workflow/session.ts`
- `src/workflow/runtime-db.ts`
