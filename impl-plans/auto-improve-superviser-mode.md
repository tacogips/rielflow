# Auto Improve Superviser Mode Implementation Plan

**Status**: In Progress
**Design Reference**: `design-docs/specs/design-auto-improve-superviser-mode.md`, `design-docs/specs/design-node-jump-and-code-manager-runtime.md`, `design-docs/specs/architecture.md`, `design-docs/specs/command.md`
**Created**: 2026-04-24
**Last Updated**: 2026-04-25 (unblocked from cutover TASK-005; dependency table)

## Design Document Reference

**Source**:

- `design-docs/specs/design-auto-improve-superviser-mode.md`
- `design-docs/specs/design-node-jump-and-code-manager-runtime.md`
- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`

### Summary

Add supervised `--auto-improve` execution on top of the step-addressed runtime.
The feature launches a target workflow together with a paired `divedra
superviser` workflow that watches progress, records incidents, decides rerun
versus workflow repair, patches an execution-scoped mutable workflow copy by
default, and reruns until success or supervision budget exhaustion.

This plan assumes the step-addressed cutover is the active runtime. It does not
attempt to support legacy node-ordered workflow behavior.

### Scope

**Included**:

- supervision policy types and persisted supervision-cycle records
- execution-copy mutable workflow workspaces and revision tracking for repaired
  workflow bundles
- superviser orchestration that can start runs, watch for failure/stall, decide
  remediation, patch workflow definitions, and rerun from the beginning or a
  targeted step
- CLI/library/GraphQL surfaces for `--auto-improve` policy input and inspection
- default superviser examples/docs/tests aligned with the new step-addressed
  runtime

**Excluded**:

- recursive self-supervision by default
- guaranteeing recovery from permanently failing external systems
- browser-first supervision UX work

## Modules

### 1. Supervision Policy and Persistent Records

#### `src/workflow/types.ts`, `src/workflow/session.ts`, `src/workflow/runtime-db.ts`, `src/workflow/inspect.ts`

**Status**: NOT_STARTED

```typescript
export interface AutoImprovePolicy {
  readonly enabled: true;
  readonly superviserWorkflowId?: string;
  readonly monitorIntervalMs: number;
  readonly stallTimeoutMs: number;
  readonly maxSupervisedAttempts: number;
  readonly maxWorkflowPatches: number;
  readonly workflowMutationMode: "execution-copy" | "in-place";
  readonly allowTargetedRerun?: boolean;
}

export interface SupervisionIncident {
  readonly incidentId: string;
  readonly supervisedAttemptId: string;
  readonly category: "failure" | "stall" | "budget-exhausted";
  readonly summary: string;
  readonly detectedAt: string;
}

export interface SupervisionRunState {
  readonly supervisionRunId: string;
  readonly targetWorkflowId: string;
  readonly superviserWorkflowId: string;
  readonly attemptCount: number;
  readonly workflowPatchCount: number;
  readonly incidents: readonly SupervisionIncident[];
}
```

**Checklist**:

- [ ] Add a persisted supervision policy contract and runtime state model
- [ ] Store incident history, remediation history, and budget counters in session and runtime-db state
- [ ] Expose inspection helpers for supervision status and latest incident/remediation summary
- [ ] Keep supervision records resilient across resume/restart

### 2. Mutable Workflow Workspace and Revision Plumbing

#### `src/workflow/revision.ts`, `src/workflow/load.ts`, `src/workflow/save.ts`, `src/workflow/paths.ts`, `src/shared/fs.ts`

**Status**: NOT_STARTED

```typescript
export interface MutableWorkflowWorkspace {
  readonly workflowId: string;
  readonly sourceWorkflowDir: string;
  readonly mutableWorkflowDir: string;
  readonly mutationMode: "execution-copy" | "in-place";
}

export interface WorkflowPatchRevisionInput {
  readonly supervisionRunId: string;
  readonly mutableWorkflowDir: string;
  readonly reason: string;
  readonly patchedByStepId: string;
}
```

**Checklist**:

- [ ] Create execution-scoped mutable workflow copies for supervised runs
- [ ] Track patch revisions and their provenance under the workflow artifact root
- [ ] Route load/save operations through the mutable workspace when supervision is active
- [ ] Keep in-place mutation explicit and opt-in

### 3. Superviser Orchestration and Control Operations

#### `src/workflow/superviser.ts`, `src/workflow/call-step.ts`, `src/workflow/engine.ts`, `src/workflow/node-addons.ts`, `src/workflow/local-node-addons.ts`

**Status**: NOT_STARTED

```typescript
export type SupervisionRemediationAction =
  | "rerun-workflow"
  | "rerun-step"
  | "patch-workflow"
  | "stop-supervision";

export interface SupervisionRemediationDecision {
  readonly action: SupervisionRemediationAction;
  readonly targetStepId?: string;
  readonly reason: string;
}

export interface StartSupervisedRunInput extends LoadOptions, SessionStoreOptions {
  readonly workflowId: string;
  readonly policy: AutoImprovePolicy;
}
```

**Checklist**:

- [ ] Implement the supervisory loop for start, watch, classify, remediate, and rerun
- [ ] Detect stall using persisted runtime timestamps instead of in-memory polling only
- [ ] Allow targeted rerun when enabled and the step-addressed runtime can validate the selected step
- [ ] Provide built-in control operations or add-ons for start/status/rerun/load/save workflow actions
- [ ] Keep superviser logic expressible as an ordinary workflow using the same step-call runtime

### 4. Public Surfaces

#### `src/cli.ts`, `src/lib.ts`, `src/graphql/schema.ts`, `src/graphql/types.ts`, `src/server/graphql.ts`

**Status**: NOT_STARTED

```typescript
export interface WorkflowRunOptions {
  readonly autoImprove?: AutoImprovePolicy;
}

export interface SupervisionSummary {
  readonly supervisionRunId: string;
  readonly targetWorkflowId: string;
  readonly status: "running" | "succeeded" | "failed" | "stopped";
  readonly attemptCount: number;
  readonly latestIncidentId?: string;
}
```

**Checklist**:

- [ ] Add `divedra workflow run <name> --auto-improve` with policy flags
- [ ] Expose supervision status through library and GraphQL APIs
- [ ] Keep policy parsing explicit for monitor interval, stall timeout, attempt budgets, mutation mode, and targeted rerun
- [ ] Return auditable supervision summaries rather than opaque rerun-only output

### 5. Examples, Documentation, and Verification

#### `examples/**/*`, `README.md`, `design-docs/specs/*.md`, `src/**/*.test.ts`

**Status**: NOT_STARTED

```typescript
interface SuperviserExampleBundle {
  readonly superviserWorkflowId: string;
  readonly targetWorkflowId: string;
  readonly policyDefaults: AutoImprovePolicy;
}
```

**Checklist**:

- [ ] Add a default superviser example bundle and at least one failure-to-repair scenario
- [ ] Cover incident classification, execution-copy patching, targeted rerun, and budget exhaustion with regression tests
- [ ] Document audit artifacts, mutable workspace location, and operator-visible policy behavior
- [ ] Verify the feature against the step-addressed runtime and not against removed legacy workflow surfaces

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Supervision policy and persistent records | `src/workflow/types.ts`, `src/workflow/session.ts`, `src/workflow/runtime-db.ts`, `src/workflow/inspect.ts` | NOT_STARTED | `src/workflow/runtime-db.test.ts`, new supervision-focused tests |
| Mutable workflow workspace and revision plumbing | `src/workflow/revision.ts`, `src/workflow/load.ts`, `src/workflow/save.ts`, `src/workflow/paths.ts` | NOT_STARTED | `src/workflow/revision.test.ts`, `src/workflow/load.test.ts`, `src/workflow/save.test.ts` |
| Superviser orchestration and control operations | `src/workflow/superviser.ts`, `src/workflow/call-step.ts`, `src/workflow/engine.ts` | NOT_STARTED | new supervision orchestration tests plus targeted engine coverage |
| Public surfaces | `src/cli.ts`, `src/lib.ts`, `src/graphql/schema.ts`, `src/server/graphql.ts` | NOT_STARTED | `src/cli.test.ts`, `src/lib.test.ts`, `src/graphql/schema.test.ts`, `src/server/graphql.test.ts` |
| Examples, documentation, and verification | `examples/**/*`, `README.md`, `design-docs/specs/*.md` | NOT_STARTED | targeted end-to-end and regression slices |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Supervision policy and persistent records | `step-addressed-workflow-runtime-cutover` (TASK-005 examples/docs complete; `call-step` / step graph in production use) | Ready |
| Mutable workflow workspace and revision plumbing | Supervision policy and persistent records | NOT_STARTED |
| Superviser orchestration and control operations | Cutover core runtime, mutable workspace plumbing | NOT_STARTED |
| Public surfaces | Supervision policy and orchestration | NOT_STARTED |
| Examples, documentation, and verification | All supervision modules | NOT_STARTED |

## Completion Criteria

- [ ] `workflow run --auto-improve` launches a supervised execution with explicit policy input
- [ ] Supervision survives resume/restart because incidents and remediations are persisted
- [ ] Execution-copy mutation is the default repair mode and preserves the canonical workflow bundle
- [ ] The superviser can classify failure versus stall and choose rerun, targeted rerun, workflow patch, or stop
- [ ] GraphQL/library/CLI surfaces expose auditable supervision status and artifacts
- [ ] Example bundles and tests cover success, transient rerun, workflow repair, and exhausted-budget outcomes
- [ ] `bun run typecheck:server`, targeted supervision tests, and the full regression suite pass

## Progress Log

### Session: 2026-04-25

**Tasks Completed**: Aligned the plan with `impl-plans/PROGRESS.json`: `step-addressed-workflow-runtime-cutover` **TASK-005** (shipped examples/docs slice for the step-addressed model) is **Completed**, so this plan’s **TASK-001** no longer depends on it. The dependency table above reflects that implementation can start while the parent cutover finishes TASK-001 through TASK-004 (strict-default depth, `call-step` follow-ups, engine, surfaces).

**Tasks In Progress**: TASK-001 (supervision policy and records) per `PROGRESS.json`

**Blockers**: None for the cutover gate; remaining work is implementation of supervision modules (all `NOT_STARTED` in the module table).

### Session: 2026-04-24 00:00 JST
**Tasks Completed**: Plan creation
**Tasks In Progress**: None
**Blockers**: Step-addressed runtime cutover not yet implemented
**Notes**: Split from the same 2026-04-24 design diff as a successor plan because supervised execution depends on the new step-addressed call/runtime contract and would be artificially coupled if planned as one oversized file.

## Related Plans

- **Previous**: `impl-plans/step-addressed-workflow-runtime-cutover.md`
- **Next**: None
- **Depends On**: `impl-plans/step-addressed-workflow-runtime-cutover.md`
