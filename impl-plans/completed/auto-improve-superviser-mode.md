# Auto Improve Superviser Mode Implementation Plan

**Status**: Completed (phase 1)
**Design Reference**: `design-docs/specs/design-auto-improve-superviser-mode.md`, `design-docs/specs/design-node-jump-and-code-manager-runtime.md`, `design-docs/specs/architecture.md`, `design-docs/specs/command.md`
**Created**: 2026-04-24
**Last Updated**: 2026-04-26 (sync: phase-2 nested superviser shipped in `impl-plans/completed/auto-improve-superviser-workflow-phase-2.md`; this file documents phase 1 only)

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

**Status**: SHIPPED (policy types, session field, runtime-db `supervision_json`, `getSupervisionSummary`, supervision `policy` + `remediations` on `SupervisionRunState`, GraphQL `session.supervision`; engine `runAutoImproveLoop` for phase-1 orchestration)

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

- [x] Add a persisted supervision policy contract and runtime state model
- [x] Store incident history, remediation history, and budget counters in session and runtime-db state
- [x] Expose inspection helpers for supervision status and latest incident/remediation summary
- [x] Keep supervision records resilient across resume/restart

### 2. Mutable Workflow Workspace and Revision Plumbing

#### `src/workflow/revision.ts`, `src/workflow/load.ts`, `src/workflow/save.ts`, `src/workflow/paths.ts`, `src/workflow/mutable-workspace.ts`, `src/shared/fs.ts`

**Status**: SHIPPED (routing, execution-copy reload in engine, patch revision file API; phase-1 engine loop shipped; nested superviser workflow is phase 2)

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

- [x] Create execution-scoped mutable workflow copies for supervised runs (see `src/workflow/mutable-workspace.ts` + `resolveSupervisionMutableWorkflowDirectory` in `paths.ts`)
- [x] Track patch revisions and their provenance under the workflow artifact root (`recordWorkflowPatchRevision` / `readWorkflowPatchRevisionsFromArtifact` under `supervision/<id>/patch-revisions.json`)
- [x] Route load/save operations through the mutable workspace when supervision is active (engine + `loadWorkflowFromDisk` / `saveWorkflowToDisk` with `LoadOptions.workflowBundleDirectoryOverride`, `session.supervision.mutableWorkflowDir`, `mergeLoadOptionsForSessionMutableBundle` for the direct-call path / manager-message)
- [x] Keep in-place mutation explicit and opt-in (`buildMutableWorkflowWorkspace` / policy `workflowMutationMode`)

### 3. Superviser Orchestration and Control Operations

#### `src/workflow/superviser.ts`, `src/workflow/call-step.ts`, `src/workflow/engine.ts`, `src/workflow/node-addons.ts`, `src/workflow/local-node-addons.ts`

**Status**: SHIPPED (phase 1): `superviser.ts` + `runAutoImproveLoop` (stall watch, repeat-failure `patch-workflow` audit, targeted rerun, budgets). **Phase 2** (nested `superviserWorkflowId` workflow, `divedra/*` control add-ons, `nestedSuperviserSessionId`) is **Completed** in `impl-plans/completed/auto-improve-superviser-workflow-phase-2.md`.

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

- [x] Implement the outer supervision loop for start, watch on terminal target failure, remediate, and rerun (engine `runAutoImproveLoop`); in-flight **stall** from persisted `updated_at` while a step is executing (`executeAdapterWithTimeout` / `executeNativeNodeWithTimeout` + `buildSupervisionStallWatch`)
- [x] Detect stall using persisted runtime timestamps (`loadRuntimeSessionSummary` poll + abort) instead of in-memory only
- [x] Allow targeted rerun when enabled and the step-addressed runtime can validate the selected step (`resolveSupervisionRerunTarget` in `superviser.ts` + `runAutoImproveLoop` remediation `rerun-step` / `targetStepId`)
- [x] Record `patch-workflow` remediation and `patch-revisions.json` on **consecutive** target failures with the same **failure** `SupervisionIncident.summary` as the latest prior failure incident (engine stores this from `lastError` / failure message; `maxWorkflowPatches` / `stop-patch-budget`)
- [x] (phase 1) Control-plane **surface** for target session status and reruns: existing `runWorkflow` / `resumeWorkflow` / `rerun` / GraphQL session + `getSupervisionSummary`; no separate superviser add-on API yet
- [x] (phase 2) Built-in add-ons (`divedra/start-workflow`, `get-workflow-status`, `rerun-workflow`, `load-workflow-definition`, `save-workflow-definition`, etc.) invoked from the nested superviser workflow for the **target** run (`src/workflow/node-addons.ts`, `superviser-runtime-control-impl.ts`; see phase-2 plan)
- [x] (phase 2) Run `superviserWorkflowId` as a nested step-addressed workflow when `--nested-superviser` / `nestedSuperviserDriver` is enabled; phase-1 `runAutoImproveLoop` remains the default without that flag

### 4. Public Surfaces

#### `src/cli.ts`, `src/lib.ts`, `src/graphql/schema.ts`, `src/graphql/types.ts`, `src/server/graphql.ts`

**Status**: SHIPPED (phase 1): `WorkflowRunOptions.autoImprove`, CLI flags, `executeWorkflow` / `rerunWorkflow` / `resumeWorkflow` pass-through; engine seeds `session.supervision`; GraphQL + `getSupervisionSummary` + `session.supervision`

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

- [x] Add `divedra workflow run <name> --auto-improve` with policy flags
- [x] Expose supervision status through library and GraphQL APIs (summary helper + `session.supervision`; execution client parity TBD)
- [x] Keep policy parsing explicit for monitor interval, stall timeout, attempt budgets, mutation mode, and targeted rerun
- [x] `getSupervisionSummary` and GraphQL expose incident/remediation ids, `workflowPatchCount`, `mutableWorkflowDir`, and `status` (including `succeeded` / `stopped` from the engine loop)

### 5. Examples, Documentation, and Verification

#### `examples/**/*`, `README.md`, `design-docs/specs/*.md`, `src/**/*.test.ts`

**Status**: SHIPPED (phase 1)

```typescript
interface SuperviserExampleBundle {
  readonly superviserWorkflowId: string;
  readonly targetWorkflowId: string;
  readonly policyDefaults: AutoImprovePolicy;
}
```

**Checklist**:

- [x] Add a default superviser example bundle and at least one failure-to-repair scenario (`examples/supervised-mock-retry`: mock sequence fail-then-succeed with `--auto-improve`)
- [x] Cover incident classification, execution-copy patching, targeted rerun, and budget exhaustion with regression tests (`engine.test.ts`, `superviser.test.ts`)
- [x] Document audit artifacts, mutable workspace location, and operator-visible policy behavior (`examples/auto-improve/README.md`, design phasing in `design-auto-improve-superviser-mode.md`)
- [x] Verify the feature against the step-addressed runtime and not against removed legacy workflow surfaces

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Supervision policy and persistent records | `src/workflow/types.ts`, `src/workflow/session.ts`, `src/workflow/runtime-db.ts`, `src/workflow/inspect.ts` | SHIPPED | `src/workflow/runtime-db.test.ts`, `session.test.ts`, `session-store.test.ts`, `lib.test.ts` |
| Mutable workflow workspace and revision plumbing | `src/workflow/mutable-workspace.ts`, `src/workflow/paths.ts`, `src/workflow/revision.ts`, `src/workflow/load.ts`, `src/workflow/save.ts` | SHIPPED | `src/workflow/mutable-workspace.test.ts`, `src/workflow/engine.test.ts` (auto-improve copy + load), `src/workflow/revision.test.ts`, `load.test.ts` / `save.test.ts` as existing coverage |
| Superviser orchestration and control operations | `src/workflow/superviser.ts`, `src/workflow/adapter-execution.ts`, `src/workflow/call-step.ts` (delegates to `call-step-impl.ts` internally), `src/workflow/engine.ts` | SHIPPED (phase 1); phase 2 nested + add-ons: see phase-2 plan | `engine.test.ts`, `superviser.test.ts`, `superviser-control.test.ts`, `superviser-runtime-control-impl.test.ts` |
| Public surfaces | `src/cli.ts`, `src/lib.ts`, `src/graphql/schema.ts`, `src/server/graphql-executable-schema.ts` | SHIPPED (phase 1) | `src/lib.test.ts`, `src/graphql/schema.test.ts` |
| Examples, documentation, and verification | `examples/auto-improve/README.md`, `examples/supervised-mock-retry/`, `examples/README.md` | SHIPPED | `engine.test.ts`, `superviser.test.ts`, manual run per `EXPECTED_RESULTS.md` |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Supervision policy and persistent records | `step-addressed-workflow-runtime-cutover` (phase **129** **Completed** in `impl-plans/PROGRESS.json`; `call-step` / step graph in production use) | Ready |
| Mutable workflow workspace and revision plumbing | Supervision policy and persistent records | SHIPPED |
| Superviser orchestration and control operations | Cutover core runtime, mutable workspace plumbing | SHIPPED (phase 1); phase 2 **Completed** (`auto-improve-superviser-workflow-phase-2`) |
| Public surfaces | Supervision policy and orchestration | SHIPPED (phase 1) |
| Examples, documentation, and verification | All supervision modules | SHIPPED (phase 1) |

## Completion Criteria

- [x] `workflow run --auto-improve` launches a supervised execution with explicit policy input
- [x] Supervision survives resume/restart because incidents and remediations are persisted
- [x] Execution-copy mutation is the default repair mode and preserves the canonical workflow bundle
- [x] The superviser can classify failure versus stall and choose rerun, targeted rerun, workflow patch, or stop (failure + stall + rerun + stop + **engine repeat-failure `patch-workflow` audit** shipped; **nested** superviser workflow optional via `--nested-superviser`, documented in phase-2 plan)
- [x] GraphQL/library/CLI surfaces expose auditable supervision status and artifacts
- [x] Example bundle `examples/supervised-mock-retry` demonstrates fail-then-succeed mock sequence with `--auto-improve`
- [x] `bun run typecheck:server`, targeted supervision tests, and the full regression suite pass

## Progress Log

### Session: 2026-04-25 (repeat-failure patch escalation hygiene)

**Tasks Completed**: `planSupervisionRemediation` now compares the new failure to the **latest prior failure** incident (scan backward), not merely the last incident, so an intervening **stall** (or other non-failure) incident no longer suppresses repeat-failure `patch-workflow` escalation. Added `superviser.test.ts` coverage. **Type hygiene**: `runLocalTuiWorkflow` passes `rerunFromStepId` (step-only) into `runWorkflow` options (`cli.ts`); `lastFailureIncident` guards possibly-undefined array access (`superviser.ts`).

**Verification**: `bun run typecheck:server`, `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh`.

### Session: 2026-04-26 (TASK-005: supervised mock example + docs)

**Tasks Completed**: Added `examples/supervised-mock-retry/` (step-addressed one-worker bundle, two-entry `mock-scenario.json` with `fail: true` then success). Expanded `examples/auto-improve/README.md` and `examples/README.md`. Marked plan phase 1 **Completed**; `PROGRESS.json` phase 130 and TASK-005 **Completed**.

**Verification**: `bun run typecheck:server`, `bash scripts/run-bun-tests.sh` (or project test script), `workflow validate` / `workflow run` for `supervised-mock-retry` as in `EXPECTED_RESULTS.md`.

### Session: 2026-04-26 (design alignment + TASK-004 / TASK-005 tracking)

**Tasks Completed**: Added `## Implementation phasing` to `design-docs/specs/design-auto-improve-superviser-mode.md` (phase 1 engine loop vs phase 2 nested superviser). Updated this plan: phase-1 module statuses, checklist split for add-ons / nested workflow, dependency table, completion criteria. Staged/tracked `src/workflow/superviser.ts` and `superviser.test.ts`, `examples/auto-improve/README.md`. `PROGRESS.json`: `auto-improve-superviser-mode` TASK-004 **Completed**, TASK-005 **In Progress** (unblocked).

**Verification**: `bun run typecheck:server`, `bash scripts/run-bun-tests.sh`.

### Session: 2026-04-26 (TASK-004: repeat-failure `patch-workflow` + patch revision)

**Tasks Completed**: `planSupervisionRemediation` / `getEngineSupervisionPatcherId` in `superviser.ts`. `runAutoImproveLoop` escalates to `patch-workflow` when the new failure matches the last stored **failure** incident `summary` (and patch budget allows); calls `recordWorkflowPatchRevision` under the supervision run; increments `workflowPatchCount`; on exhausted patch budget, `stop-supervision` with a `budget-exhausted` incident. Tests: `superviser.test.ts`, `engine.test.ts` (patch-revisions file).

**Verification**: `bun run typecheck:server`, `bash scripts/run-bun-tests.sh`.

### Session: 2026-04-26 (TASK-004: stall watch teardown race)

**Tasks Completed**: `attachSupervisionStallToAbort` sets `done` when `clear()` runs (adapter/native finished) and re-checks `done` after `loadRuntimeSessionSummary` so a late poll cannot reject the stall promise after the race has already completed (avoids unhandled rejection).

**Verification**: `bun run typecheck:server`, `bash scripts/run-bun-tests.sh`.

### Session: 2026-04-26 (TASK-004: persisted stall watch + session lastError for supervision)

**Tasks Completed**: `SupervisionStallWatch` in `types.ts`; `buildSupervisionStallWatch`, `formatSupervisionStallError`, `isSupervisionStallLastError` in `superviser.ts`; `adapter-execution` races `loadRuntimeSessionSummary` (poll) against adapter/native with shared `AbortController`; engine and `call-node` pass the watch when supervision policy is set; on `provider_error`, preserve `providerErrorMessage` in output payload; failed-session `lastError` uses the full stall string for supervision incidents with `category: "stall"` on the `runAutoImproveLoop` path. Tests: `engine.test.ts` (hang + stall), `superviser.test.ts`.

**Verification**: `bun run typecheck:server`, `bash scripts/run-bun-tests.sh`.

### Session: 2026-04-25 (TASK-004 increment: rerun anchor helper, step rerun validation, budget test)

**Tasks Completed**: Exported `resolveSupervisionRerunAnchor` from `superviser.ts` (used by `runAutoImproveLoop`); rerun validation uses `workflow.steps` id set when present; CLI help clarifies shipped retry loop vs pending stall/superviser workflow; regression test for `maxSupervisedAttempts` exhaustion; `superviser.test.ts` for anchor resolution.

**Verification**: `bun run typecheck:server`, `bash scripts/run-bun-tests.sh`.

### Session: 2026-04-26 (TASK-004 increment: superviser types, `resumeWorkflow` parity, engine guard)

**Tasks Completed**: Added `src/workflow/superviser.ts` with `SupervisionRemediationDecision` and `StartSupervisedRunInput`; re-exported from `lib.ts`. Fixed `resumeWorkflow` to forward `autoImprove` (was only on `executeWorkflow` / `rerunWorkflow`). Replaced unreachable `auto-improve` else branch in `runWorkflowInternal` with an internal error instead of seeding supervision without a precomputed workspace. Test: `lib.test.ts` asserts `resumeWorkflow` passes `autoImprove` into `runWorkflow`.

**Verification**: `bun run typecheck:server`, `bash scripts/run-bun-tests.sh`.

### Session: 2026-04-26 (TASK-003 close: resume + `autoImprove` policy)

**Tasks Completed**: Resume path now merges CLI/library `autoImprove` policy into an existing `session.supervision` (requires prior supervised run), persists the snapshot when resume would early-return (`completed` or paused with `activeUserActions`), and rejects resume + `autoImprove` when the session has no supervision record. Tests: `engine.test.ts` (policy update + rejection).

**Verification**: `bun run typecheck:server`, `bash scripts/run-bun-tests.sh`.

### Session: 2026-04-26 (TASK-003: supervision inheritance on `rerunFromSessionId` + `autoImprove`)

**Tasks Completed**: Engine: when resuming a supervised run via `rerunFromSessionId` with `autoImprove`, clone `preloaded` session `supervision` (mutable bundle path, `supervisionRunId`, incidents/remediations) and apply the requested `policy`; reject `autoImprove` on rerun if the source session has no `supervision` (clear error). Tests: `engine.test.ts` coverage for the preserve and reject paths.

**Verification**: `bun run typecheck:server`, `bash scripts/run-bun-tests.sh`.

### Session: 2026-04-26 (TASK-002: load/save routing, patch file, session.mutableWorkflowDir)

**Tasks Completed**: `LoadOptions.workflowBundleDirectoryOverride`; `SupervisionRunState.mutableWorkflowDir`; engine preloads session for resume/rerun, seeds execution copy and reloads from mutable dir on fresh `autoImprove` runs; `saveWorkflowToDisk` honors override; `recordWorkflowPatchRevision` / `readWorkflowPatchRevisionsFromArtifact`; `mergeLoadOptionsForSessionMutableBundle` in call-node and manager-message; GraphQL + `SupervisionSummary` expose `mutableWorkflowDir`.

**Verification**: `bun run typecheck:server`, `bash scripts/run-bun-tests.sh`.

### Session: 2026-04-25 (TASK-002: execution-copy workspace utilities)

**Tasks Completed**: Added `MutableWorkflowWorkspace`, `WorkflowPatchRevisionInput` in `types.ts`. `paths.ts`: `isSafeSupervisionRunId`, `resolveSupervisionMutableWorkflowDirectory`. New `mutable-workspace.ts` with `buildMutableWorkflowWorkspace` and `createExecutionCopyMutableWorkspace` (fs `cp`), tests in `mutable-workspace.test.ts`. Library re-exports. Marked `PROGRESS.json` TASK-001 completed, TASK-002 in progress.

**Verification**: `bun run typecheck:server`, `bash scripts/run-bun-tests.sh` (947 pass).

### Session: 2026-04-25 (engine + CLI entry: autoImprove)

**Tasks Completed**: `WorkflowRunOptions.autoImprove`; on new runs (not `resumeSessionId`), engine seeds `SupervisionRunState` with default `divedra-default-superviser`, policy, empty incidents/remediations. `cloneSession` deep-clones `supervision`. CLI: `--auto-improve`, `--superviser-workflow`, `--monitor-interval-ms`, `--stall-timeout-ms`, `--max-supervised-attempts`, `--max-workflow-patches`, `--workflow-mutation-mode`, `--no-allow-targeted-rerun`; `buildLocalWorkflowRunOverrides` passes policy. Library: `ExecuteWorkflowInput.autoImprove`, `RerunWorkflowInput.autoImprove`. Test: `engine.test.ts` seeds supervision. Help text updated.

**Verification**: `bun run typecheck:server`, `bash scripts/run-bun-tests.sh`.

### Session: 2026-04-25 (TASK-001 follow-up: policy, remediation memory, GraphQL)

**Tasks Completed**: Extended `SupervisionRunState` with optional `policy` (`AutoImprovePolicy`) and `remediations` (`SupervisionRemediationRecord` / `SupervisionRemediationAction`); `normalizeSessionState` clones remediations; `SupervisionSummary` and `getSupervisionSummary` include `superviserWorkflowId`, `workflowPatchCount`, and `latestRemediationId`. Added GraphQL SDL types and resolvers for `session.supervision` (`graphql-executable-schema.ts`). Tests: `session.test.ts`, `lib.test.ts`, `schema.test.ts`.

**Verification**: `bun run typecheck:server`, `bash scripts/run-bun-tests.sh`.

### Session: 2026-04-25 (TASK-001: supervision model and persistence)

**Tasks Completed**: Landed `AutoImprovePolicy`, `SupervisionIncident`, `SupervisionRunState`, and `SupervisionSummary` in `src/workflow/types.ts`; optional `session.supervision` on `WorkflowSessionState` with `normalizeSessionState` cloning; `sessions.supervision_json` in the runtime DB via schema migration and `saveSessionSnapshotToRuntimeDb`; `getSupervisionSummary()` in `src/workflow/inspect.ts` and library exports. Tests: `session.test.ts`, `session-store.test.ts`, `runtime-db.test.ts`, `lib.test.ts`.

**Tasks In Progress**: TASK-001 remainder (orchestration wiring, policy on `WorkflowRunOptions`, GraphQL) per module table rows 2+; TASK-002+ still blocked on supervision orchestration.

**Verification**: `bun run typecheck:server`, `bash scripts/run-bun-tests.sh` (936 pass).

### Session: 2026-04-25 (dependency alignment)

**Tasks Completed**: Aligned the plan with `impl-plans/PROGRESS.json`: `step-addressed-workflow-runtime-cutover` **TASK-005** (shipped examples/docs slice for the step-addressed model) is **Completed**, so this plan’s **TASK-001** no longer depends on it. The parent cutover plan is now **Completed** in `impl-plans/PROGRESS.json` (phase **129**); see `impl-plans/completed/step-addressed-workflow-runtime-cutover.md` for long-term completion criteria still open in that document.

**Tasks In Progress**: TASK-001 (supervision policy and records) per `PROGRESS.json`

**Blockers**: None for the cutover gate; remaining work is implementation of supervision modules (all `NOT_STARTED` in the module table).

### Session: 2026-04-24 00:00 JST
**Tasks Completed**: Plan creation
**Tasks In Progress**: None
**Blockers**: Step-addressed runtime cutover not yet implemented
**Notes**: Split from the same 2026-04-24 design diff as a successor plan because supervised execution depends on the new step-addressed call/runtime contract and would be artificially coupled if planned as one oversized file.

## Related Plans

- **Previous**: `impl-plans/completed/step-addressed-workflow-runtime-cutover.md`
- **Next (phase 2, Completed)**: `impl-plans/completed/auto-improve-superviser-workflow-phase-2.md`
- **Active follow-on (schema/runtime cleanup)**: `impl-plans/workflow-legacy-compatibility-removal.md`
- **Depends On**: `impl-plans/completed/step-addressed-workflow-runtime-cutover.md`
