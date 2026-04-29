# Auto Improve Superviser Mode Design

This document defines `auto improve mode`, where `divedra` launches a target workflow together with a `divedra superviser` that monitors execution, classifies failures or stalls, decides whether a plain rerun is sufficient, and patches the workflow when structural remediation is needed before rerunning it.

This document intentionally uses the spelling `superviser` to match the requested product surface.

## Overview

The core runtime can run, resume, rerun, and inspect workflows. **Auto improve mode** adds a first-class supervised execution path. **Phase 1** (see [Implementation phasing](#implementation-phasing)) ships this as an engine-orchestrated loop with `--auto-improve`, persisted policy and incidents, stall detection from runtime timestamps, and execution-copy patch audit records. **Phase 2** runs an authored `superviserWorkflowId` as a nested step-addressed workflow when the nested driver is enabled (for example `--nested-superviser` with `--auto-improve`); the bullet list below still describes the full product shape operators expect, with Phase 1 covering the engine-driven subset when the nested path is not used.

Lifecycle supervision without workflow improvement is a separate product mode.
Event sources and web applications may need a workflow supervisor only to start,
stop, restart, and inspect a target workflow. That default mode uses the same
system-workflow direction but sets automatic improvement off and restarts failed
targets only up to a finite limit. See
`design-docs/specs/design-event-supervisor-control.md`.

In this mode:

- a target workflow execution is launched
- a `superviser` watches the target workflow state
- if the target succeeds, supervision completes
- if the target fails or stalls, the `superviser` analyzes the incident
- the `superviser` decides whether to:
  - rerun as-is,
  - rerun from a specific execution address,
  - patch the workflow and rerun,
  - stop and report non-recoverable failure
- the `superviser` persists prior incident analyses and remediation outcomes across repeated reruns within the same supervision cycle

The `superviser` itself should be expressible as an ordinary workflow using the same jump-driven runtime primitives described in `design-node-jump-and-code-manager-runtime.md`.

## Goals

- Add a first-class `auto improve mode` to workflow execution.
- Keep supervision auditable and replayable.
- Detect terminal failure and progress stalls.
- Distinguish transient failures from workflow-definition defects.
- Allow automatic workflow repair before rerun when justified.
- Preserve a durable memory of past incidents and attempted remediations during one supervision cycle.
- Reuse the same workflow/runtime architecture instead of inventing a separate orchestrator model.

## Non-Goals

- Unlimited autonomous self-modification without safety limits.
- Blind in-place mutation of the canonical source workflow as the default behavior.
- Recursive self-supervision by default.
- Guaranteeing recovery for failures caused by external systems that remain unavailable.

## Implementation phasing

The end-state goals in this document (paired `superviser` **workflow**, add-on or GraphQL control operations, and LLM-driven definition edits) are not all implemented in a single change set. The current tree may ship in phases:

- **Phase 1 (engine-orchestrated loop)**. `divedra workflow run ... --auto-improve` uses an outer `runAutoImproveLoop` in the workflow engine. It runs the **target** workflow, detects terminal **failure** and **stall** (including via persisted `sessions.updated_at` while a step is executing), records **incidents** and **remediations**, applies **attempt** and **patch** budgets, writes **patch revision** audit records under the artifact root for execution-copy bundles, and supports **targeted step rerun** when policy allows. Policy and state are **persisted** on the target session. **GraphQL** and the **library** expose `getSupervisionSummary` / `session.supervision` for inspection. The GraphQL execution mutations also carry the same auto-improve policy surface for start, resume, and rerun so remote execution is policy-equivalent to the local engine path. `superviserWorkflowId` is still stored on supervision state in this phase, but it is executed only when the nested phase-2 path is explicitly enabled.
- **Phase 2 (superviser as a workflow)**. When enabled (for example CLI `--nested-superviser` with `--auto-improve`, or library `nestedSuperviserDriver` on a new supervised start), the engine runs `superviserWorkflowId` as a nested step-addressed workflow after seeding the target session and supervision workspace. Built-in `divedra/*` add-ons invoke a runtime-scoped control surface for start/status/rerun/load/save on the paired **target** session. Resuming the **target** session with the same nested flag continues the nested superviser run when the saved nested session is not yet **completed** (for example still paused or failed). If the nested superviser session has already **completed** but the **target** session is still active, the engine starts another nested superviser round and records a new `nestedSuperviserSessionId` on the same supervision run so the operator-visible audit row stays tied to one supervision run. Without the nested flag, `--auto-improve` still uses the Phase 1 engine `runAutoImproveLoop`. GraphQL and inspection expose `nestedSuperviserSessionId` on supervision state, while execution entrypoints allow the nested flag only on supervised start and resume (not step rerun).

Phase 1 is intentionally compatible with the same session model, artifact layout, and policy contract described elsewhere in this spec so that Phase 2 can attach without reworking operator-visible audit data.

### Step ids for remediation

Supervision **remediation** is step-addressed: the engine records `rerun-step` / `rerun-workflow` with a **step id** anchor (`managerStepId ?? entryStepId`) and optional targeted `rerunFromStepId` when policy allows.

Phase 1 reloads the target workflow bundle after a failure on the same strict step-addressed validation path as ordinary execution. Authored bundles must carry `entryStepId` and `steps[]` alongside the node registry; legacy node-graph-only shapes and removed top-level compatibility fields are **rejected at validation** rather than projected or adapted at runtime.

Phase 2 nested `divedra/*` control add-ons accept only documented keys on `divedra/rerun-workflow` (auth fields, `sessionId`, and optional `rerunFromStepId`); any other argument key is rejected at parse time in `parseRerunTargetWorkflowControlArguments`. Engine `WorkflowRunOptions` also uses **`rerunFromStepId` only** for targeted `runWorkflow` reruns (no `rerunFromNodeId` field); see `impl-plans/workflow-legacy-compatibility-removal.md` and `impl-plans/completed/workflow-legacy-compatibility-removal-tail-cleanup.md`.

## Core Model

### Entities

- `target workflow`
  - the workflow the user wants to complete
- `superviser workflow`
  - the workflow that monitors and improves the target workflow
- `superviser execution`
  - one workflow execution of the superviser workflow
- `supervised attempt`
  - one execution attempt of the target workflow under a given superviser execution
- `incident`
  - one observed failure or stall of the target workflow
- `remediation`
  - one action chosen by the superviser in response to an incident

### Relationship

One `superviser execution` owns many `supervised attempts`.

Each supervised attempt may end in:

- `succeeded`
- `failed`
- `stalled`
- `cancelled`

Each non-success attempt creates an incident record, and each incident may produce one remediation decision.

## Activation Model

Preferred user-facing activation:

- `divedra workflow run <name> --auto-improve`

Target optional expansion:

- workflow-level defaults for supervision policy
- a dedicated `superviser` command family for inspection/export

Initial run-time policy should be supplied through execution input rather than requiring every workflow to author supervision fields.

## Supervision Policy

`auto improve mode` should accept a supervision policy object:

```json
{
  "enabled": true,
  "superviserWorkflowId": "divedra-default-superviser",
  "monitorIntervalMs": 5000,
  "stallTimeoutMs": 60000,
  "maxSupervisedAttempts": 5,
  "maxWorkflowPatches": 3,
  "workflowMutationMode": "execution-copy",
  "allowTargetedRerun": true
}
```

Target fields:

- `superviserWorkflowId?: string`
- `monitorIntervalMs: number`
- `stallTimeoutMs: number`
- `maxSupervisedAttempts: number`
- `maxWorkflowPatches: number`
- `workflowMutationMode: "execution-copy" | "in-place"`
- `allowTargetedRerun?: boolean`

Rules:

- `execution-copy` is the default and recommended mutation mode
- `in-place` is opt-in because it mutates the canonical workflow bundle
- supervision stops when attempt or patch budgets are exhausted
- supervision policy belongs to the superviser/runtime, not to ordinary worker output mail
- `monitorIntervalMs` controls observation cadence and should be user-configurable on the CLI because it affects operator-visible responsiveness and load
- `allowTargetedRerun` gates rerun from a specific step

## Why Execution-Copy Is The Default

Automatic workflow patching is materially riskier than node rerun.

Default behavior should therefore:

1. copy the target workflow bundle into an execution-scoped mutable workspace
2. apply superviser-authored workflow edits there
3. rerun against that mutable copy
4. preserve the original workflow bundle unchanged unless the user explicitly opts into `in-place`

This keeps autonomous repair auditable and reversible.

## Superviser Workflow Shape

The `superviser` should be representable as an ordinary workflow that uses jump-driven routing instead of special branch/loop primitives.

Recommended canonical nodes:

1. `start-target-workflow`
2. `watch-target-status`
3. `classify-incident`
4. `decide-remediation`
5. `patch-target-workflow`
6. `rerun-target-workflow`
7. `finish-supervision`

Typical jump flow:

- `start-target-workflow -> watch-target-status`
- `watch-target-status -> watch-target-status` while the target is still progressing
- `watch-target-status -> finish-supervision` when the target succeeds
- `watch-target-status -> classify-incident` when the target fails or stalls
- `classify-incident -> decide-remediation`
- `decide-remediation -> rerun-target-workflow` for transient reruns
- `decide-remediation -> patch-target-workflow` for workflow fixes
- `patch-target-workflow -> rerun-target-workflow`
- `rerun-target-workflow -> watch-target-status`
- `decide-remediation -> finish-supervision` when budgets are exhausted or the issue is not recoverable

This allows the `superviser` to use the same engine semantics as any other workflow.

## Required Superviser Capabilities

Whether implemented as built-in add-ons, code-manager actions, or GraphQL-backed control-plane operations, the superviser needs these capabilities:

- start a target workflow execution
- inspect target workflow execution status
- inspect node execution status, timeout details, and published output mail
- load the mutable target workflow definition copy
- write an updated workflow definition revision
- rerun the target workflow from the beginning or from a selected execution address
- persist supervision memory and analysis results

Recommended built-in control add-ons or equivalent internal operations:

- `divedra/start-workflow`
- `divedra/get-workflow-status`
- `divedra/get-workflow-execution-details`
- `divedra/rerun-workflow`
- `divedra/load-workflow-definition`
- `divedra/save-workflow-definition`

Analysis and patch generation may still be performed by ordinary `code` or `llm` worker nodes.

## Incident Detection

The superviser should recognize these incident classes:

- `failure`
  - the target workflow reached a terminal failed state
- `stall`
  - the target workflow remains non-terminal but has not made progress within `stallTimeoutMs`
- `budget-exhausted`
  - the target workflow or superviser exceeded an allowed retry/restart budget

### Stall Detection

Preferred stall signal:

- no new node execution completion,
- no new accepted output mail,
- no new communication consumption,
- and no target workflow status transition

within `stallTimeoutMs`.

The superviser should use persisted runtime timestamps rather than in-memory polling state so monitoring survives resume/restart.

## Incident Analysis

Each failure or stall creates an incident analysis record.

Target record shape:

```json
{
  "incidentId": "incident-0003",
  "supervisedAttemptId": "attempt-0003",
  "observedAt": "2026-04-24T14:00:00.000Z",
  "kind": "stall",
  "summary": "implementation node timed out twice after prompt expansion",
  "suspectedCause": "workflow-defect",
  "confidence": "medium",
  "evidence": {
    "failedStepId": "implement",
    "failedNodeId": "implement",
    "failedNodeExecId": "exec-000018",
    "status": "timeout"
  },
  "recommendedAction": "patch-workflow"
}
```

Required analysis outputs:

- `kind`
- `summary`
- `suspectedCause`
- `evidence`
- `recommendedAction`

### Cause Classification

The superviser should classify incidents into at least:

- `transient-execution`
  - likely fixed by plain rerun or targeted rerun
- `workflow-defect`
  - likely requires workflow edits
- `external-blocked`
  - caused by unavailable dependency, missing credential, or operator intervention need
- `unknown`
  - evidence is insufficient

Typical heuristics:

- provider hiccup, intermittent transport failure, or isolated timeout with prior success history -> `transient-execution`
- repeated timeout on the same execution address with the same prompt/timeout shape -> likely `workflow-defect`
- invalid jump target, malformed output contract, bad prompt variant, or missing workflow field -> `workflow-defect`
- missing external prerequisite or repeated environment failure without workflow evidence -> `external-blocked`

## Remediation Decision Model

The superviser should normalize remediation decisions into one structured shape:

```json
{
  "action": "rerun-workflow",
  "reason": "likely transient provider timeout",
  "targetStepId": null,
  "workflowPatchRequired": false
}
```

Supported actions:

- `wait-and-monitor`
- `rerun-workflow`
- `rerun-from-address`
- `patch-workflow-and-rerun`
- `fail-supervision`

Rules:

- `rerun-workflow` is used when the incident is likely transient
- `rerun-from-address` is used when partial replay is safe and cheaper than full rerun
- `patch-workflow-and-rerun` is used when analysis indicates workflow-definition repair is likely required
- `fail-supervision` is used when the issue is unrecoverable or budgets are exhausted
- `targetStepId` identifies the step selected for targeted rerun

## Workflow Patching Model

Workflow patching should operate on the mutable workflow copy selected by `workflowMutationMode`.

Patchable areas may include:

- `workflow.json.defaults`
- step transition definitions such as `workflow.json.steps[]` or `steps/step-*.json`
- node payload prompt templates or prompt variant references
- node timeout values
- manager type or node session policy
- output-contract guidance when the workflow definition is clearly malformed

Patching should not permit:

- edits outside the selected mutable workflow root
- arbitrary repository-wide code changes unrelated to the workflow bundle
- silent deletion of incident history

Every patch must persist:

- pre-patch workflow revision reference
- patch rationale
- changed files
- textual diff or structured patch summary
- post-patch revision reference

## Supervision Memory

The superviser must retain memory across repeated reruns within one superviser execution.

Minimum memory contents:

- all supervised attempts
- all incidents
- all remediation decisions
- all workflow patches
- the outcome of each remediation

This memory must be fed back into later analysis so the superviser can avoid pathological behavior such as:

- repeating the same failed rerun endlessly
- reapplying the same ineffective patch
- misclassifying a repeated structural issue as transient

### Scope

Required scope:

- retained for the whole superviser execution, including resume/restart

Out of scope for the first cut:

- long-lived cross-superviser learning shared across unrelated supervision runs

## Artifact Layout

Recommended supervision artifacts under the superviser execution root:

```text
{artifact-root}/{superviserWorkflowId}/executions/{superviserExecutionId}/supervision/
  config.json
  state.json
  memory.json
  attempts/
    attempt-0001.json
    attempt-0002.json
  incidents/
    incident-0001.json
    incident-0002.json
  patches/
    patch-0001/
      rationale.json
      diff.patch
      changed-files.json
  target-workflow/
    source-ref.json
    working-copy/
```

Rules:

- `memory.json` is the durable summary used by later superviser nodes
- `working-copy/` holds the execution-scoped mutable target workflow bundle when `workflowMutationMode = "execution-copy"`
- each supervised attempt records the launched target `workflowExecutionId`
- the superviser must be able to resume from these artifacts without recomputing prior analysis from scratch

## Runtime Status Inputs

The superviser should monitor at least:

- target workflow execution status
- latest node execution statuses
- timeout reasons
- latest accepted output mail
- last progress timestamp
- rerun counts and timeout counts

Preferred data sources:

- workflow session state
- runtime DB indexes
- node execution artifacts
- output mail artifacts

## Manager Model

The superviser manager should default to `managerType: "code"`.

Rationale:

- monitoring and budget checks should be deterministic
- rerun versus patch gating should be validated structurally
- the superviser should not require an LLM just to observe status or enforce budgets

`llm` analysis nodes may still participate in:

- failure explanation
- patch proposal generation
- prompt repair suggestions

But the superviser manager should remain responsible for validating those suggestions before execution.

## Safety Limits

Required limits:

- `maxSupervisedAttempts`
- `maxWorkflowPatches`
- no recursive supervision by default
- patch scope limited to the selected workflow bundle
- explicit artifact retention for every remediation step

Recommended additional guardrails:

- reject applying the same patch fingerprint twice in one superviser execution
- reject rerun storms when the last N incidents have the same root-cause classification and no new evidence
- require stronger evidence before switching from plain rerun to in-place mutation mode

## Command And Control Plane Direction

User-facing CLI direction:

- `divedra workflow run <name> --auto-improve`

Initial CLI policy mapping should expose at least:

- `--superviser-workflow`
- `--monitor-interval-ms`
- `--stall-timeout-ms`
- `--max-supervised-attempts`
- `--max-workflow-patches`
- `--workflow-mutation-mode execution-copy|in-place`
- `--no-allow-targeted-rerun` (deprecated alias: `--disable-targeted-rerun`)

Likely additional control-plane needs:

- start supervised execution
- inspect superviser execution state
- list supervised attempts
- inspect patch history
- export supervision memory

GraphQL direction should expose supervision as typed execution control, not as opaque freeform manager text.

## Testing Requirements

Add coverage for at least:

- superviser detects target workflow success and exits cleanly
- superviser detects terminal failure and records an incident
- superviser detects stall from lack of progress
- transient incident leads to rerun without workflow patch
- repeated structurally similar incident leads to workflow patch decision
- workflow patch is applied to execution-scoped working copy by default
- superviser memory survives superviser resume
- patch budget exhaustion terminates supervision deterministically
- superviser does not recurse into supervising itself unless explicitly enabled

## Open Design Choices

These choices should remain explicit in implementation:

- whether `rerun-from-address` is allowed for every workflow shape or only for validated subsets
- whether successful execution-copy patches can later be promoted automatically to the canonical workflow bundle
- how much of incident analysis is heuristic code versus LLM-authored structured output

## References

- `design-docs/specs/design-node-jump-and-code-manager-runtime.md`
- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/architecture.md`
