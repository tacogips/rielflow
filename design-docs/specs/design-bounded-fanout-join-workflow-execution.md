# Bounded Fanout Join Workflow Execution

This document defines first-class bounded fanout and join behavior for step-addressed divedra workflows.

## Overview

The cursor-agent parity workflow needs one upstream analysis step, a dynamic set of feature-local design and implementation-plan branches, and a dependency-aware implementation phase after all required branch work completes. Current runtime behavior cannot express that efficiently because `runWorkflowInternal()` drains `session.queue` one item at a time and `executeCrossWorkflowDispatchesForNode()` awaits cross-workflow dispatches sequentially.

Bounded fanout/join adds an explicit orchestration primitive while preserving the existing step-addressed model:

- a completed source step may create a fanout group from an authored static branch list or from an array in the source output payload
- each branch runs as a distinct execution work item with its own branch index, fanout item, correlation id, artifact path, and mailbox scope
- the scheduler may run multiple branch work items concurrently, up to the resolved fanout concurrency
- a join step is queued exactly once after all required branch work completes successfully
- the join step receives deterministic aggregate inputs ordered by authored branch order or source item order

The current issue scope is to complete the local form of this model. A fanout transition that targets `toStepId` without `toWorkflowId` is an inline local fanout: every branch executes in the parent workflow session, uses the same workflow definition and session store, and still receives branch-scoped runtime variables, mailbox inputs, node execution ids, artifacts, timeout handling, and fanout group records. Cross-workflow fanout remains a separate mode that creates callee workflow executions and then resumes the caller at the same caller-workflow join step.

This is a workflow-engine feature. It is not a cursor-agent backend feature. Cursor-specific behavior remains isolated to agent adapter modules such as `src/workflow/adapters/*`; the fanout scheduler only sees ordinary step executions and backend-neutral outputs.

## Reference Mapping

Local codex-agent reference root:

- `<reference-repository-root>` (for example `../../codex-agent`)

Relevant reference points:

- `<reference-repository-root>/src/group/manager.ts`: `runGroup()` uses a bounded `maxConcurrent` loop, an `inFlight` map, and `Promise.race()` to refill pending work as sessions finish.
- `<reference-repository-root>/src/group/types.ts`: `GroupRunOptions.maxConcurrent` is a small public option on the group execution boundary.
- `<reference-repository-root>/src/queue/runner.ts`: queue execution is deliberately sequential and is a useful contrast for divedra's current `session.queue` behavior.
- `<reference-repository-root>/impl-plans/completed/phase3-sqlite-group-queue.md`: documents the separation between concurrency-controlled group execution and strictly sequential queue execution.

The divedra design intentionally diverges from codex-agent in two ways:

- codex-agent runs one prompt across existing sessions, while divedra fans out workflow step work items that may share one workflow execution and must preserve mailbox, transition, retry, timeout, and artifact semantics
- codex-agent emits group events as an `AsyncGenerator`, while divedra must persist fanout group state into the workflow session and runtime artifacts so CLI, GraphQL, TUI, resume, rerun, and supervision can inspect the same source of truth

## Authoring Model

Fanout is authored on `WorkflowStepTransition`, because the source step completion is what decides whether downstream work starts.

Target transition shape:

```json
{
  "toStepId": "feature-design",
  "label": "has_features",
  "fanout": {
    "groupId": "feature-design",
    "itemsFrom": "/payload/features",
    "itemVariable": "feature",
    "concurrency": 20,
    "joinStepId": "join-feature-design",
    "failurePolicy": "fail-fast",
    "resultOrder": "input"
  }
}
```

Cross-workflow fanout uses the existing `toWorkflowId` and `resumeStepId` fields:

```json
{
  "toWorkflowId": "feature-local-plan",
  "toStepId": "divedra-manager",
  "resumeStepId": "join-feature-plans",
  "label": "has_features",
  "fanout": {
    "groupId": "feature-plans",
    "itemsFrom": "/payload/features",
    "itemVariable": "feature",
    "concurrency": 20,
    "joinStepId": "join-feature-plans",
    "failurePolicy": "fail-fast",
    "resultOrder": "input"
  }
}
```

Field meanings:

- `groupId`: stable authored id unique within the source step's outgoing fanout transitions
- `itemsFrom`: JSON Pointer into the source step output payload; the selected value must be an array
- `itemVariable`: runtime variable name exposed to each branch as `runtimeVariables[itemVariable]`
- `concurrency`: optional positive integer; defaults to workflow `defaults.fanoutConcurrency` or `20`, then clamps to the run-time `maxConcurrency` cap when provided
- `joinStepId`: current-workflow step to queue after all required branch results complete
- `failurePolicy`: initially `fail-fast` or `collect-all`; default `fail-fast`
- `resultOrder`: initially `input`; aggregate branch outputs preserve source item order

Local and cross-workflow fanout share the same authored `fanout` object:

- local inline fanout is selected when the transition has `toStepId` and no `toWorkflowId`
- cross-workflow fanout is selected when the transition has `toWorkflowId`, `toStepId`, and matching `resumeStepId`
- both modes require `joinStepId` to name a step in the caller workflow
- both modes use the same `groupId`, `itemsFrom`, `itemVariable`, `failurePolicy`, `resultOrder`, `writeOwnership`, and effective concurrency rules

Static fanout can be added later with an authored `branches[]` array, but the cursor-agent parity workflow needs dynamic classification first. The first implementation should prioritize `itemsFrom` fanout.

## Validation Rules

Workflow validation should enforce:

- `fanout.groupId` is a non-empty stable id and unique among the source step's outgoing fanout transitions
- `fanout.itemsFrom` is a valid JSON Pointer string when present
- exactly one dynamic source is selected in the initial model: `itemsFrom`
- `fanout.itemVariable`, when present, is a non-empty identifier-like string
- `fanout.concurrency`, when present, is a positive integer
- resolved concurrency must not exceed the runtime maximum fanout concurrency
- `fanout.joinStepId` must reference an existing step in the current workflow
- for cross-workflow fanout, `resumeStepId` remains required and must equal `fanout.joinStepId`
- a fanout transition may target a local step or a cross-workflow callable entry, but the join step is always in the caller workflow
- a step may have at most one matching fanout transition per completed source execution
- `fanout.failurePolicy` must be one of the supported policies
- `fanout.resultOrder` must be `input` in the initial model

The existing removed-field rule remains unchanged: fanout/join must not reintroduce authored top-level `workflowCalls`, `subWorkflows`, `edges`, `loops`, or node-addressed routing.

## Runtime State Boundary

The persisted workflow session should add an engine-owned fanout group view rather than overloading `session.queue` strings.

Required fanout group state:

- `fanoutGroupRunId`: deterministic run id derived from source step run and authored `groupId`
- `sourceStepId` and `sourceNodeExecId`
- `transitionLabel` and target step or workflow fields
- `joinStepId`
- `concurrency`
- `failurePolicy`
- branch records containing `branchIndex`, item snapshot, status, work item id, branch execution ids, output refs, workspace roots, superseded workspace roots, and error text

The scheduler should treat queue entries as execution work items internally. A plain queued step remains valid for non-fanout work, but fanout branches need distinct work item identity so the same step can run many times concurrently for different items without deduping the branch executions away.

Session mutation remains single-writer from the engine's scheduling reducer. Branch promises may run concurrently, but they report completion events back to the reducer, which serializes updates to counters, communications, queue/work-item state, transitions, runtime DB rows, and `saveSession()` writes.

## Data Flow

1. The source step succeeds and output-contract routing selects a fanout transition.
2. The engine resolves `itemsFrom` against the source output payload and creates one branch record per item.
3. The bounded scheduler starts up to `concurrency` branch work items.
4. Each branch receives normal upstream inputs plus `runtimeVariables[itemVariable]`, `runtimeVariables.fanout.groupId`, `runtimeVariables.fanout.branchIndex`, and `runtimeVariables.fanout.item`.
5. Local branch steps execute through the normal parent-session node adapter path with branch-specific work item identity. Cross-workflow branches run callee workflow sessions with the branch fanout variables included in `runtimeVariables.workflowCall`.
6. Each branch completion records its output ref and branch status under the fanout group.
7. When all required branches succeed, the engine publishes one deterministic aggregate communication to `joinStepId` and queues the join step once.
8. The join step sees `runtimeVariables.fanoutJoin` and inbox aggregate data ordered by `branchIndex`.

Aggregate payload shape:

```json
{
  "fanoutGroupRunId": "fanout-feature-design-exec-000002",
  "groupId": "feature-design",
  "sourceStepId": "classify-features",
  "resultOrder": "input",
  "results": [
    {
      "branchIndex": 0,
      "item": { "id": "session-history" },
      "status": "succeeded",
      "outputRef": { "kind": "node-output" }
    }
  ]
}
```

## Failure, Cancellation, Timeout, And Retry

Initial failure policy:

- `fail-fast`: the first branch failure stops launching new branch work, requests cancellation for running branch work where supported, marks the fanout group failed, and fails the workflow session with an error that includes `fanoutGroupRunId` and `branchIndex`
- `collect-all`: the scheduler stops only after every branch reaches a terminal state; if any branch failed, the workflow session fails with an aggregate error and does not queue the join step

Partial-success joins are out of scope for the first implementation. They can be added later by extending `failurePolicy` with an explicit partial-join policy and join payload schema.

Timeouts are applied to each branch step execution through the existing step/node timeout model. A group-level timeout can be added later, but the first implementation should avoid a second timeout policy surface.

Cancellation rules:

- cancellation of the parent workflow session prevents new branch starts
- running local branch steps and callee workflows receive the same cancellation probes used by ordinary workflow execution
- cancelled fanout groups persist terminal branch statuses before the session exits

Retry and rerun rules:

- manager `retry-step` may target the source step, a branch target step with fanout group context, or the join step only when the runtime can prove scope from persisted fanout state
- direct rerun should accept the authored step id plus optional fanout branch selector in a later control-plane extension; without that selector, rerunning a branch target step outside its fanout context is rejected
- isolated-workspace branch retries create a replacement workspace and persist the previous attempt path in `supersededWorkspaceRoot`; retry lineage must be recorded for both cross-workflow and local fanout branches before the retried group is considered complete
- `maxSteps` counts each branch node execution as one step execution, so high fanout runs must set `maxSteps` high enough for the branch count

Optional decisions and user actions are branch-scoped. If a branch pauses for user action or optional-step decision, the fanout group remains running and the join waits until that branch reaches a terminal result.

TASK-003 lifecycle semantics must be verified against the parent-session local fanout path, not inferred from cross-workflow fanout alone:

- `fail-fast` must stop admitting new local branches after the first terminal failure and must preserve the failed branch record with `fanoutGroupRunId`, `branchIndex`, item snapshot, output or error details, and any node execution ids that were already created
- `collect-all` must allow every admitted branch to reach a terminal result, persist all terminal branch records, fail the parent workflow when any branch failed, and avoid publishing or queueing the join communication
- cancellation, timeout, optional-step pause, user-action pause, and resume decisions remain scoped to the concrete branch execution; the fanout group remains inspectable while waiting for paused branches or while cancellation drains already-started work
- run-level `maxSteps` counts every local branch node execution exactly as an ordinary node execution and must not be multiplied or bypassed by fanout concurrency
- run-level `maxConcurrency` clamps both authored/default local fanout concurrency and existing cross-workflow fanout concurrency; local lifecycle work must preserve the current effective-concurrency metadata used by status and join records
- parent-session local fanout may stay serialized while session mutation is single-writer; future parallel local branch execution must report branch lifecycle events back through a serialized reducer before saving session state or publishing communications

Every branch worker execution, including local fanout branches and join steps, must receive the same structured input through both worker-facing input surfaces:

- root artifact `input.json` remains the runtime audit record for the node execution
- `mailbox/inbox/input.json` is the worker-facing resolved input and must contain the same business input shape needed by prompts, commands, and containers
- `mailbox/inbox/meta.json` declares `mailboxDirEnvVar: "DIVEDRA_MAILBOX_DIR"` and mailbox-root-relative paths such as `inbox/input.json` and `outbox/output.json`
- prompt guidance for LLM workers must tell the worker where `mailbox/inbox/input.json` is and that `DIVEDRA_MAILBOX_DIR` points at the mailbox root
- workers must not write canonical mailbox files or final `output.json`; final output publication and downstream mailbox delivery remain runtime-owned

## Cross-Workflow Dispatch

`executeCrossWorkflowDispatchesForNode()` should use the same bounded scheduler primitive as local fanout. For ordinary multiple relevant dispatches without authored fanout, the runtime may preserve current deterministic behavior by using concurrency `1`. When a dispatch has `fanout`, each source item becomes an isolated callee workflow run bounded by the fanout concurrency.

Cross-workflow recursion guards remain active per branch:

- the invocation stack includes the caller workflow id before starting each callee
- dispatch to the same workflow id remains rejected unless a future design introduces explicit recursion support
- nested fanout inherits the remaining runtime maximum concurrency budget instead of multiplying into unbounded process creation

Cross-workflow dispatch artifacts under `workflow-calls/` should include `fanoutGroupRunId` and `branchIndex` when created by fanout. Historical field names such as `workflowCall` may remain runtime variable compatibility keys, but new authored schema must stay step-addressed.

## Inspection And Control Surfaces

CLI, GraphQL, TUI, and library inspection should expose fanout state as workflow execution state:

- active fanout groups
- branch counts by status
- configured and effective concurrency
- source step and join step ids
- first failure and aggregate error summaries
- branch output refs for completed branches

The first implementation does not need new CLI flags to run fanout workflows. Existing `workflow run`, `workflow status`, `session progress`, GraphQL execution views, and TUI views should report fanout state when present.

## Shared Worktree And Code-Write Safety

Bounded fanout may run read-only analysis branches, document-generation branches, or code-writing branches. The scheduler must treat workspace mutation as a workflow safety boundary rather than assuming every branch can safely share the same repository checkout.

Default branch execution modes:

- read-only analysis and planning branches may share the parent workflow worktree when their node prompts and tool permissions do not require repository writes
- document-generation branches may share a worktree only when the implementation plan assigns disjoint output files or directories to each branch
- code-writing branches require explicit isolation when two or more branches may edit overlapping files, run formatters across shared paths, update package metadata, or mutate generated artifacts with shared names

Isolation can be provided by child workflow worktrees, branch-local workspace roots under the workflow artifact directory, or another adapter-supported checkout mechanism. The design does not require one specific isolation provider, but the fanout group state must record each branch workspace root when it differs from the parent workspace so status, review, retry, and cleanup can explain where branch work happened.

Implementation planning rules:

- every fanout branch that can write files must declare an owned file path set, directory set, or explicit isolated workspace requirement
- dependency-aware implementation should not start until the join step has aggregated branch outputs and the plan has resolved overlapping write ownership
- branch retries must reuse the same isolated workspace or create a replacement workspace with a persisted link to the superseded branch attempt
- join/review steps are responsible for integration decisions; the fanout scheduler should not auto-merge concurrently produced code changes

For the cursor-agent parity workflow, the first fanout phase should be safe to run concurrently because it produces feature-local design and implementation-plan outputs with disjoint paths. Dependency-aware implementation remains after the join unless a later plan proves branch write ownership is non-overlapping or uses isolated child worktrees.

## Current Runtime Alignment

The design is partially implemented and the remaining work must preserve the behavior already covered by tests:

- authored `fanout` validation, `defaults.fanoutConcurrency`, run-level `maxConcurrency`, persisted fanout groups, branch runtime variables, deterministic join aggregation, and fanout summaries are part of the current runtime surface
- cross-workflow fanout is supported and must keep using bounded scheduling, child workflow executions, branch-local `workflow-calls/` artifacts, nested concurrency-budget inheritance, and caller-workflow join aggregation
- isolated fanout branch workspaces are prepared outside the parent checkout when `writeOwnership.mode` is `isolated-workspace`; branch records and join results should expose `workspaceRoot`
- retrying an isolated fanout branch group must retain lineage by recording the prior attempt workspace as `supersededWorkspaceRoot` on the corresponding replacement branch
- local inline fanout now executes `toStepId` branches in the parent workflow session through the direct step execution path, records distinct branch node execution ids and artifacts, restores parent runtime variables between branches, and publishes one deterministic join communication
- local parent-session branch execution is currently serialized to preserve single-writer session mutation; remaining lifecycle work must extend coverage for failure policies, cancellation, timeout, pause/user-action behavior, and any future concurrent local branch reducer
- implementation-plan status must continue to distinguish the already-supported cross-workflow fanout path from the parent-session local fanout path; local dynamic fanout is complete only for repeated target-step execution with distinct branch context and deterministic join publication until the remaining lifecycle coverage lands

## Rollout Constraints

Implementation should be staged:

1. schema/types/validation for `WorkflowStepTransition.fanout` and `defaults.fanoutConcurrency`
2. internal execution work-item model that preserves existing sequential behavior when no fanout is present
3. cross-workflow fanout using the bounded scheduler and persisted branch artifacts
4. bounded scheduler for local inline fanout in the parent workflow session with deterministic aggregate join communication
5. shared-worktree safety checks for branch write ownership, persisted branch workspace roots, and retry lineage through `supersededWorkspaceRoot`
6. inspection and test coverage
7. update `.divedra/workflows/design-and-implement-review-loop` only after the schema is accepted and tests pass

Verification should include:

- `bun run typecheck`
- focused workflow validation tests for valid and invalid fanout authoring
- engine tests for dynamic fanout ordering, concurrency limit, join queueing, fail-fast failure, collect-all failure, cancellation, timeout, optional/user-action pause behavior, and maxSteps accounting
- cross-workflow fanout tests proving bounded concurrent callee execution, deterministic join aggregation, cycle guard preservation, and artifact/communication stability
- local inline fanout tests proving parent-session branch work items execute the same target step multiple times with distinct branch context, do not collapse through plain queue dedupe, publish one join communication, and respect `maxConcurrency`
- shared-worktree safety tests proving concurrent code-writing branches require disjoint ownership or isolated workspaces, while read-only/planning branches can share the parent workspace
- isolated fanout retry tests proving replacement branch attempts persist `supersededWorkspaceRoot` lineage for the prior branch workspace

## References

- `design-docs/specs/architecture.md`
- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/design-workflow-steps-and-node-reuse.md`
- `<reference-repository-root>/src/group/manager.ts`
- `<reference-repository-root>/src/queue/runner.ts`
