# Auto Improve Superviser Workflow Phase 2 Implementation Plan

**Status**: Completed (core deliverables and regression tests shipped; extra nested patch-audit matrices remain optional)
**Design Reference**: `design-docs/specs/design-auto-improve-superviser-mode.md#implementation-phasing`, `design-docs/specs/architecture.md#auto-improve-supervision-boundary`, `design-docs/specs/command.md#subcommands`
**Created**: 2026-04-25
**Last Updated**: 2026-04-25 (closure session: PROGRESS sync, design overview wording)

---

## Design Document Reference

**Source**:

- `design-docs/specs/design-auto-improve-superviser-mode.md`
- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`

### Summary

Implement phase 2 of `auto improve mode` by running `superviserWorkflowId` as a
normal step-addressed workflow instead of keeping remediation policy only inside
the engine loop. The existing phase-1 supervision state, incident history, and
patch-audit records remain the durable audit contract.

### Scope

**Included**:

- nested superviser workflow launch and lifecycle wiring
- runtime control operations the superviser workflow can call for target-run
  start/status/rerun/load/save
- supervision-state handoff between the target session and nested superviser
  execution
- CLI/library/inspection updates required to surface nested superviser session
  identity and status
- regression coverage and examples for the nested superviser path

**Excluded**:

- recursive self-supervision
- autonomous free-form workflow editing outside the constrained control surface
- browser-first supervision UX

---

## Modules

### 1. Superviser Workflow Runtime Control Surface

#### `src/workflow/node-addons.ts`, `src/workflow/native-node-executor.ts`, `src/workflow/superviser-control.ts`, `src/workflow/types.ts`

**Status**: Complete (types, validators, `divedra/*` built-ins, native execution; `save` add-on `arguments` include `bundle`)

```typescript
export interface StartWorkflowAddonInput {
  readonly workflowId: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly autoImprove?: AutoImprovePolicy;
}

export interface GetWorkflowStatusAddonInput {
  readonly sessionId: string;
}

export interface SaveWorkflowDefinitionAddonInput {
  readonly workflowId: string;
  readonly mutableWorkflowDir: string;
}
```

**Checklist**:

- [x] Define control-operation input/output types for target workflow actions
- [x] Expose runtime-owned add-ons or equivalent internal actions for start/status/rerun/load/save
- [x] Keep target-session authorization scoped to the owning supervision run
- [x] Add unit tests for control-surface validation

### 2. Nested Superviser Session Orchestration

#### `src/workflow/engine.ts`, `src/workflow/superviser.ts`, `src/workflow/session.ts`

**Status**: Complete (`runNestedSuperviserSessionDriver`: if nested session is completed while the target is not, mint a new `nestedSuperviserSessionId` and run a fresh nested superviser round; otherwise resume the nested session as before)

```typescript
export interface NestedSuperviserLaunch {
  readonly superviserWorkflowId: string;
  readonly targetSessionId: string;
  readonly supervisionRunId: string;
}

export interface SupervisionRunState {
  readonly supervisionRunId: string;
  readonly targetWorkflowId: string;
  readonly superviserWorkflowId: string;
  readonly nestedSuperviserSessionId?: string;
}
```

**Checklist**:

- [x] Start the nested superviser workflow when phase-2 supervision is enabled (`WorkflowRunOptions.nestedSuperviserDriver` + driver before target queue)
- [x] Persist nested superviser session identity on the target supervision state (`nestedSuperviserSessionId`)
- [x] Resume nested supervision (target session resume + `nestedSuperviserDriver` continues `nestedSuperviserSessionId`; engine-only rerun path still rejected for nested driver)
- [x] Preserve phase-1 audit records and mutable-workspace behavior (execution-copy + nested `startTargetWorkflow` now runs `runAutoImprove` loop for parity with phase 1; see `buildSuperviserRuntimeControl` and `runNestedSuperviserSessionDriver` runtime variable injection)

### 3. Public Surfaces and Operator Inspection

#### `src/cli.ts`, `src/lib.ts`, `src/graphql/schema.ts`, `src/server/graphql-executable-schema.ts`

**Status**: Complete

```typescript
export interface SupervisionSummary {
  readonly supervisionRunId: string;
  readonly targetWorkflowId: string;
  readonly superviserWorkflowId: string;
  readonly nestedSuperviserSessionId?: string;
  readonly status: "running" | "succeeded" | "failed" | "stopped";
}
```

**Checklist**:

- [x] Surface nested superviser session identity in CLI, library summary, and GraphQL supervision state
- [x] Keep existing `--auto-improve` policy flags stable; added `--nested-superviser` / `ExecuteWorkflowInput.nestedSuperviserDriver`
- [x] Document the difference between phase-1 engine loop and phase-2 nested superviser execution (see `examples/auto-improve/README.md`, `design-auto-improve-superviser-mode.md` policy id)
- [x] Add regression coverage for inspection output (summary + GraphQL field; nested driver paths covered in `engine.test.ts`)

### 4. Examples and End-to-End Verification

#### `examples/auto-improve/`, `examples/supervised-mock-retry/`, `src/workflow/*.test.ts`

**Status**: Complete for phase-2 closure (optional larger nested patch/rerun matrix deferred)

```typescript
interface NestedSuperviserExample {
  readonly targetWorkflowId: string;
  readonly superviserWorkflowId: string;
  readonly expectedRemediationActions: readonly string[];
}
```

**Checklist**:

- [x] Add an example bundle that includes an authored superviser workflow (`examples/default-superviser/`, id `divedra-default-superviser`)
- [x] Cover nested success + supervised-mock target retry in `engine.test.ts` (rerun/patch/stop matrix still optional)
- [x] Verify resume/restart behavior for both target and superviser sessions (including nested-superviser **completed** + target still active: new nested round; see `engine.test.ts`)
- [x] Document operator-visible behavior for the nested path in `examples/auto-improve/README.md` (per-run artifacts follow existing supervision layout)

---

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Superviser workflow runtime control surface | `src/workflow/node-addons.ts`, `src/workflow/native-node-executor.ts`, `src/workflow/superviser-control.ts`, `src/workflow/superviser-runtime-control-impl.ts`, `src/workflow/types.ts` | Complete | `superviser-control.test.ts` |
| Nested superviser session orchestration | `src/workflow/engine.ts`, `src/workflow/superviser.ts`, `src/workflow/session.ts` | Complete | `engine.test.ts` (nested + resume fork) |
| Public surfaces and operator inspection | `src/cli.ts`, `src/lib.ts`, `src/server/graphql-executable-schema.ts` | Complete | `schema.test`, `lib.test` |
| Examples and end-to-end verification | `examples/default-superviser/`, `examples/auto-improve/`, nested tests in `engine.test.ts` | Complete (optional extra matrices deferred) | `engine.test` |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Phase-2 nested superviser workflow | `auto-improve-superviser-mode`, `auto-improve-supervision-review-follow-up` | Completed |

## Completion Criteria

- [x] `superviserWorkflowId` executes as a nested step-addressed workflow (when `nestedSuperviserDriver` and policies align)
- [x] Target-session supervision state records nested superviser session identity
- [x] Runtime-owned control operations let the nested superviser inspect and rerun the target workflow safely (after superviser start)
- [x] CLI/library/GraphQL inspection surfaces expose nested superviser session id on supervision state
- [x] Regression tests cover nested supervision success and supervised target retry (`nestedSuperviserDriver runs examples default-superviser...`)
- [ ] Additional nested path patch-audit coverage (optional; phase-1 patch tests already exercise execution-copy policy)

## Progress Log

### Session: 2026-04-25 00:00 (historical)
**Notes**: Initial plan creation and early scope notes (superseded by implementation sessions below).

### Session: 2026-04-25 (follow-up)
**Tasks Completed**: Module-1 control surface (types, six `divedra/*` built-in add-ons, argument/auth validation, native executor wiring, optional `superviserControl` on `CallNodeInput` and `WorkflowRunOptions`; `nestedSuperviserSessionId` on `SupervisionRunState`; tests)
**Tasks In Progress**: (superseded by orchestration session)
**Blockers**: None
**Notes**: Control add-ons return `policy_blocked` when executed without `superviserControl` (normal runs).

### Session: 2026-04-25 (orchestration)
**Tasks Completed**: `buildSuperviserRuntimeControl` in `src/workflow/superviser-runtime-control-impl.ts`; `runNestedSuperviserSessionDriver` in `src/workflow/engine.ts` (seed target session, pre-assign `nestedSuperviserSessionId`, `runWorkflowInternal` on superviser bundle, stamp supervision from superviser exit); `WorkflowRunOptions.nestedSuperviserDriver`; `runWorkflow` routes nested before `runAutoImproveLoop`; CLI `--nested-superviser` + `ExecuteWorkflowInput.nestedSuperviserDriver`; `SaveWorkflowDefinitionAddonInput` requires `bundle`; parse/save path updated.
**Tasks In Progress** (superseded; finished in follow-on sessions): GraphQL exposure; `examples/default-superviser` bundle; nested engine tests; resume nested supervision.
**Blockers**: None
**Notes**: Default superviser id is `divedra-default-superviser` (`DEFAULT_SUPERVISER_WORKFLOW_ID`); a matching bundle under `--workflow-root` is required unless `--superviser-workflow` points elsewhere. Phase-1 `runAutoImproveLoop` remains the default when `--nested-superviser` is omitted.

### Session: 2026-04-25 (inspection + resume)
**Tasks Completed**: GraphQL `nestedSuperviserSessionId` on `SupervisionRunState`; `resumeWorkflow` + target-session resume with `nestedSuperviserDriver` re-enters nested superviser via `resumeSessionId` on the superviser session; `design-auto-improve-superviser-mode` Phase 2 paragraph updated; `getSupervisionSummary` + schema/lib tests
**Tasks In Progress**: Example superviser bundle under `examples/`; engine/e2e tests for full nested path; operator doc for phase 1 vs 2
**Blockers**: None

### Session: 2026-04-25 (example + control parity)
**Tasks Completed**: Default superviser id aligned with strict `workflowId` rules (`divedra-default-superviser`); `examples/default-superviser/`; engine injects `supervisionRunId` / `targetSessionId` / `superviserTargetWorkflowId` for nested runs; add-on `config` may carry `argumentsTemplate` + `argumentBindings` for `divedra/*` superviser control; `startTargetWorkflow` / `rerunTargetWorkflow` no longer set `supervisionLoopExecution` so the target uses `runAutoImproveLoop` like phase 1; `runNestedSuperviserSessionDriver` passes a `runWorkflow` closure that always forwards the outer `NodeAdapter` + guards so `mockScenario` / scenario adapters work for target runs; `engine.test.ts` nested path with `worker-only-single-step` from `examples/`; `examples/auto-improve/README.md` phase 1 vs 2; design policy example id updated
**Tasks In Progress**: Optional nested-resume and patch end-to-end tests
**Blockers**: None

### Session: 2026-04-25 (resume fork + README)

**Tasks Completed**: When the saved nested superviser session is `completed` but the target session is not, `runNestedSuperviserSessionDriver` mints a new `nestedSuperviserSessionId` and runs a fresh nested superviser execution; `engine.test.ts` covers this with a two-step `managerless` fixture, `maxSteps: 1`, and a temp `default-superviser` copy; Phase 2 design paragraph updated; README active-design bullet links the active phase-2 plan; module table and checklists updated
**Tasks In Progress**: Optional nested patch-audit matrices
**Blockers**: None
**Notes**: Resuming a **completed** target session still returns early in `runWorkflowInternal` before nested orchestration; nested re-entry applies when the target remains non-completed.

### Session: 2026-04-25 (closure)
**Tasks Completed**: Marked plan and `impl-plans/PROGRESS.json` phase 132 complete; moved this file to `impl-plans/completed/`; aligned `design-auto-improve-superviser-mode` overview with shipped Phase 2; full `bun test` green.
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Optional nested-only patch-audit matrix remains a future test hardening item. Follow-on structural cleanup is tracked under `impl-plans/workflow-legacy-compatibility-removal.md` (separate plan).

## Related Plans

- **Previous**: `impl-plans/completed/auto-improve-superviser-mode.md`
- **Next**: `impl-plans/workflow-legacy-compatibility-removal.md` (independent; not a strict prerequisite)
- **Depends On**: `impl-plans/completed/auto-improve-supervision-review-follow-up.md`
