# Workflow Legacy Compatibility Removal Implementation Plan

**Status**: In Progress
**Design Reference**: `design-docs/specs/design-workflow-json.md`, `design-docs/specs/design-node-jump-and-code-manager-runtime.md`, `design-docs/specs/design-unified-workflow-role-model.md`, `design-docs/specs/architecture.md`, `design-docs/specs/command.md`, `design-docs/specs/notes.md`
**Created**: 2026-04-25
**Last Updated**: 2026-04-26 (review slice: shared runtime-addressing reuse + unit coverage; prior review slices retained)

## Design Document Reference

**Source**:

- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/design-node-jump-and-code-manager-runtime.md`
- `design-docs/specs/design-unified-workflow-role-model.md`
- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`
- `design-docs/specs/notes.md`

### Summary

Recent branch work has already moved the repository toward the intended
step-addressed workflow model, and the current branch also adds new
`superviser-control` plumbing on top of that direction. The remaining problem is
that a large compatibility layer is still live in validation, runtime control,
inspection, GraphQL, CLI/TUI presentation, examples, and regression fixtures.

This plan removes that old implementation rather than extending it further. The
target end state is one active workflow model:

- authored workflows use `entryStepId`, optional `managerStepId`, `nodes[]`, and
  `steps[]`
- cross-workflow execution is derived from step transitions, not authored
  `workflowCalls`
- manager runtime/control is step-addressed and does not branch on
  `root-manager` versus `subworkflow-manager`
- public surfaces stop exposing node-addressed compatibility identities and
  structural sub-workflow counters
- stale design docs that only exist to describe removed compatibility behavior
  are deleted or absorbed

### Scope

**Included**:

- remove authored compatibility fields and their normalization/projection logic
- remove node-addressed direct execution surfaces and structural manager-control
  actions
- simplify inspection, GraphQL, CLI, TUI, and visualization output to the active
  step-addressed model
- delete or consolidate obsolete design docs, examples, fixtures, and tests that
  only describe legacy compatibility behavior
- preserve and adapt the current branch's nested superviser work so it runs on
  the cleaned runtime rather than keeping compatibility layers alive

**Excluded**:

- redesigning superviser behavior beyond the cleanup required to keep the new
  branch changes working
- unrelated add-on, event-source, or transport redesigns
- introducing a new workflow schema beyond the already documented step-addressed
  direction

## Modules

### 1. Authored Schema and Validation Cutover

#### `src/workflow/types.ts`, `src/workflow/validate.ts`, `src/workflow/load.ts`, `src/workflow/save.ts`, `src/workflow/create.ts`

**Status**: In Progress (strict `WorkflowJson` typing surfaced test cast fixes; full field removal still pending)

```typescript
export interface WorkflowJson {
  readonly workflowId: string;
  readonly description: string;
  readonly defaults: WorkflowDefaults;
  readonly entryStepId: string;
  readonly managerStepId?: string;
  readonly nodes: readonly WorkflowNodeRef[];
  readonly steps: readonly WorkflowStepRef[];
}

export interface WorkflowStepTransition {
  readonly toStepId: string;
  readonly toWorkflowId?: string;
  readonly resumeStepId?: string;
  readonly label?: string;
}
```

**Checklist**:

- [ ] Remove authored compatibility fields from the primary workflow types:
      `managerNodeId`, `entryNodeId`, `workflowCalls`, `subWorkflows`,
      `subWorkflowConversations`, `edges`, `loops`, and `branching` (partial: step-addressed
      validation rejects top-level `workflowCalls`; legacy node-graph path unchanged)
- [ ] Delete validator branches that normalize or synthesize structural
      compatibility bundles
- [ ] Stop deriving `edges`, loop projections, and manager/entry node aliases
      from authored legacy shapes
- [ ] Resolve callee start targets strictly from `managerStepId ?? entryStepId`
- [ ] Make create/save/load emit only strict step-addressed bundles

### 2. Runtime and Control Cleanup

#### `src/workflow/engine.ts`, `src/workflow/runtime-addressing.ts`, `src/workflow/manager-control.ts`, `src/workflow/call-step.ts`, `src/workflow/call-step-impl.ts`, `src/workflow/sub-workflow.ts`, `src/workflow/conversation.ts`, `src/workflow/superviser-control.ts`, `src/workflow/superviser-runtime-control-impl.ts`

**Status**: IN_PROGRESS

```typescript
export interface ExecutionAddress {
  readonly workflowId: string;
  readonly stepId: string;
}

export type ManagerControlActionType =
  | "retry-step"
  | "replay-communication"
  | "execute-optional-step"
  | "skip-optional-step";
```

**Checklist**:

- [x] Remove `call-node` as a supported execution path; internal direct execution
      lives in `call-step-impl.ts` and is only invoked from `call-step` (structural
      `manager-control` deletions and full schema cutover remain)
- [x] Delete structural manager-control actions such as
      `start-sub-workflow` and `deliver-to-child-input` (engine uses automatic
      sub-workflow planning only; GraphQL/payload control surfaces updated)
- [x] Rename node-oriented manager-control action types to step-oriented names
      (`retry-step`, `execute-optional-step`, `skip-optional-step` with `stepId`;
      legacy `retry-node` / `execute-optional-node` / `skip-optional-node` aliases
      removed from the parser)
- [ ] Remove root/sub-workflow runtime branching from engine, conversation, and
      helper layers
- [ ] Lower all cross-workflow execution through one step-transition dispatch
      path instead of unioning authored `workflowCalls`
- [ ] Keep the current branch's superviser-control features working without
      reintroducing node-addressed or structural compatibility semantics

### 3. Public API, Inspection, and Visualization Simplification

#### `src/lib.ts`, `src/cli.ts`, `src/workflow/inspect.ts`, `src/server/graphql-executable-schema.ts`, `src/graphql/schema.ts`, `src/workflow/visualization.ts`, `src/tui/**/*`

**Status**: IN_PROGRESS

```typescript
export interface WorkflowInspectionSummary {
  readonly workflowId: string;
  readonly entryStepId: string;
  readonly managerStepId?: string;
  readonly stepIds: readonly string[];
  readonly nodeRegistryIds: readonly string[];
  readonly workflowCallCount: number;
}
```

**Checklist**:

- [x] Remove `call-node` exports, CLI command wiring, and node-addressed error
      wording
- [x] Remove inspection and GraphQL compatibility fields such as
      `entryNodeId`, `managerNodeId`, `legacySubWorkflows`, and generic
      `compatibility` summaries
- [x] Simplify visualization and TUI workflow summaries to the step graph plus
      reusable node registry (step-addressed paths no longer interleave legacy
      structural `subWorkflows` labels; legacy-only loads unchanged)
- [ ] Keep node ids visible only as reusable payload references, not execution
      addresses
- [x] Reconcile rerun/resume/public API wording so execution targeting is step
      only (library `resumeWorkflowExecution` / OpenTUI rerun use `fromStepId` /
      `stepId`; CLI `session rerun` requires a step id; engine `runWorkflow`
      uses `rerunFromStepId` only; `rerunFromNodeId` removed from
      `WorkflowRunOptions`)

### 4. Examples, Tests, and Design-Doc Retirement

#### `examples/**/*`, `README.md`, `design-docs/specs/*.md`, `src/**/*.test.ts`, `impl-plans/*.md`

**Status**: NOT_STARTED

```typescript
interface LegacyRemovalDocSet {
  readonly absorbIntoArchitecture: readonly string[];
  readonly deleteAfterCutover: readonly string[];
}
```

**Checklist**:

- [ ] Replace or delete regression fixtures that exist only to preserve
      node-addressed or structural sub-workflow behavior
- [ ] Remove outdated README and example references to `call-node`,
      compatibility `workflowCalls`, structural `subWorkflows`, and
      node-addressed entry fields
- [ ] Delete or absorb stale design docs that become unnecessary after this
      cleanup, with the first review candidates being:
      `design-data-model.md`, `design-node-mailbox.md`,
      `design-user-action-and-optional-node-execution.md`, and
      `design-unified-workflow-role-model.md`
- [ ] Repoint implementation-plan references away from deleted design docs
- [ ] Leave at most the minimal design surface needed to explain the surviving
      runtime

### 5. Verification and Closeout

#### `src/workflow/*.test.ts`, `src/cli.test.ts`, `src/graphql/schema.test.ts`, `src/server/graphql.test.ts`, `src/tui/**/*.test.ts`

**Status**: NOT_STARTED

```typescript
interface VerificationCommandSet {
  readonly typecheck: "bun run typecheck:server";
  readonly targetedTests: "bun test <targeted-files> --runInBand";
  readonly fullTests: "bun test";
  readonly build: "bun run build";
}
```

**Checklist**:

- [ ] Re-run targeted validator/runtime/public-surface tests after each module
- [ ] Re-run superviser-specific tests because this branch already modifies the
      runtime control layer
- [ ] Re-run full `bun test`
- [ ] Re-run `bun run build`
- [ ] Reconcile `impl-plans/README.md` and `impl-plans/PROGRESS.json` when the
      cleanup completes

## Module Status

| Module                                                   | File Path                                                                                                                                                                                                                                                                           | Status      | Tests                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authored schema and validation cutover                   | `src/workflow/types.ts`, `src/workflow/validate.ts`, `src/workflow/load.ts`, `src/workflow/save.ts`, `src/workflow/create.ts`                                                                                                                                                       | In Progress | `bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`                                                                                                                                                |
| Runtime and control cleanup                              | `src/workflow/engine.ts`, `src/workflow/manager-control.ts`, `src/workflow/call-step.ts`, `src/workflow/call-step-impl.ts`, `src/workflow/sub-workflow.ts`, `src/workflow/conversation.ts`, `src/workflow/superviser-control.ts`, `src/workflow/superviser-runtime-control-impl.ts` | In Progress | `bun test src/workflow/engine.test.ts src/workflow/manager-control.test.ts src/workflow/call-step.test.ts src/workflow/call-step-impl.test.ts src/workflow/superviser-control.test.ts src/workflow/superviser-runtime-control-impl.test.ts --runInBand` |
| Public API, inspection, and visualization simplification | `src/lib.ts`, `src/cli.ts`, `src/workflow/inspect.ts`, `src/server/graphql-executable-schema.ts`, `src/workflow/visualization.ts`, `src/tui/**/*`                                                                                                                                   | In Progress | `bun test src/lib.test.ts src/cli.test.ts src/graphql/schema.test.ts src/tui/opentui-screen.test.ts --runInBand`                                                                                                                                        |
| Examples, tests, and design-doc retirement               | `examples/**/*`, `README.md`, `design-docs/specs/*.md`, `src/**/*.test.ts`, `impl-plans/*.md`                                                                                                                                                                                       | NOT_STARTED | targeted example, CLI, GraphQL, and workflow fixture coverage                                                                                                                                                                                           |
| Verification and closeout                                | repository-wide                                                                                                                                                                                                                                                                     | NOT_STARTED | `bun run typecheck:server`, `bun test`, `bun run build`                                                                                                                                                                                                 |

## Dependencies

| Feature                                                  | Depends On                                                                              | Status                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Authored schema and validation cutover                   | Completed `step-addressed-workflow-runtime-cutover` and current branch workflow changes | READY                                                                          |
| Runtime and control cleanup                              | Full removal of validator synthesis of legacy companions is still gated on module 1     | IN_PROGRESS (bounded slices land in parallel on this branch; see progress log) |
| Public API, inspection, and visualization simplification | Same gating as module 2 for **complete** removal of compatibility summaries             | IN_PROGRESS                                                                    |
| Examples, tests, and design-doc retirement               | Runtime cleanup, public-surface cleanup                                                 | BLOCKED                                                                        |
| Verification and closeout                                | All prior modules                                                                       | BLOCKED                                                                        |

## Completion Criteria

- [ ] Authored workflow input no longer accepts node-addressed or structural
      compatibility fields
- [ ] `call-node` is removed from code, tests, docs, and public command/API
      surfaces
- [x] runtime control no longer contains structural child-workflow action names
      (`start-sub-workflow`, `deliver-to-child-input` removed from control plane)
- [ ] remove remaining root/sub-workflow special cases outside manager-control
      where the plan calls for a single step-dispatch model
- [ ] inspection, GraphQL, CLI, TUI, and visualization surfaces describe only
      the step-addressed execution model
- [ ] obsolete design docs and plan references are removed or absorbed
- [ ] `bun run typecheck:server`, `bun test`, and `bun run build` pass after
      the cleanup

## Review Check Matrix

| Area | Check | Current Result | Follow-up |
| ---- | ----- | -------------- | --------- |
| Design direction | Runtime/control surfaces stay step-addressed rather than reintroducing node-addressed public API | PASS | Keep removing remaining compatibility fields under modules 1-4 |
| CLI surface | Removed direct-call aliases fail clearly and do not create parser ambiguity | PASS (this iteration tightened `--resume-node-exec` handling) | Delete other removed compatibility aliases as they surface |
| Error contract | `call-step` failure wording is centralized instead of growing one-off string rewrites | PASS (this iteration replaced ad hoc rewrites with a shared mapping table) | Continue shrinking leftover node-oriented internals so fewer rewrites are needed |
| Shared runtime helpers | Engine, direct-step execution, and UI/read-model helpers should resolve step addresses and root-scope ownership through one implementation | PASS (new `runtime-addressing.ts` now owns shared helper logic and this iteration reuses it from the TUI model) | Keep moving legacy-only helper branches behind shared contracts as phase 133 continues |
| DRY/SOLID | Shared parser and runtime helper logic should have one responsibility and one change point | PARTIAL (improved this iteration) | `call-step-impl` now accepts `stepId` end-to-end and shares runtime-addressing helpers with `engine.ts`, but broader legacy cleanup still spans validator/runtime/inspection layers |
| Architecture fit | Repository still matches the intended phase-133 end state | FAIL | Modules 1-4 remain open: remove authored compatibility schema, root/sub runtime branching, structural `subWorkflows`, and legacy docs/examples |

## Progress Log

### Session: 2026-04-26 (review slice: shared runtime-addressing reuse + unit coverage)

**Tasks Completed**: Continued the maintainability review after the direct-step
runtime cleanup and found one more duplicated ownership rule outside the engine:
the OpenTUI shared model still carried its own copy of "which structural
sub-workflow owns this runtime node id?" while `engine.ts` and
`call-step-impl.ts` had already moved to `src/workflow/runtime-addressing.ts`.
Replaced the TUI-local copy with the shared helper and added focused unit tests
for `resolveStepExecutionAddress`, `resolveBackendSessionSelection`,
`findOwningSubWorkflowByRuntimeNodeId`, and `isRootScopeOutputNode` so future
cleanup can validate the shared contract without relying only on large engine
and call-step integration suites. Also renamed the lingering
`createCallNodeSession` test helper in `call-step-impl.test.ts` to
`createCallStepSession` so the direct-step test surface no longer carries stale
legacy command naming.

**Tasks In Progress**: Module 2 remains in progress for broader runtime/control
cleanup; module 1 authored-schema removal, structural sub-workflow cleanup, and
public-surface/doc retirement remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`,
`bun test src/workflow/runtime-addressing.test.ts src/workflow/call-step.test.ts src/workflow/call-step-impl.test.ts src/workflow/engine.test.ts src/cli.test.ts --runInBand`,
and `git diff --check`. This iteration improves DRY by making TUI/runtime
ownership semantics share one implementation and by isolating the new helper
behavior behind direct unit coverage.

### Session: 2026-04-26 (review slice: shared runtime-addressing cleanup)

**Tasks Completed**: Reviewed the active step-runtime diff against the
phase-133 maintainability goal and found a concrete DRY violation still live
after the recent `stepId` cleanup: `engine.ts` and `call-step-impl.ts` each
kept their own copies of step execution address resolution, backend-session
selection wiring, and root-scope output ownership checks. Extracted those shared
rules into `src/workflow/runtime-addressing.ts`, removed the duplicate
implementations from both runtime entry points, and renamed the direct-step
runtime test fixtures away from historical `call-node` wording so the active
execution path reads consistently in code and tests.

**Tasks In Progress**: Module 2 remains in progress for broader runtime/control
cleanup; module 1 authored-schema removal, structural sub-workflow cleanup, and
public-surface/doc retirement remain open.

**Blockers**: None.

**Notes**: Verification for this slice: `bun run typecheck:server`,
`git diff --check`, and
`bun test src/workflow/call-step.test.ts src/workflow/call-step-impl.test.ts src/workflow/engine.test.ts src/cli.test.ts --runInBand`
(`219` pass). This slice improves maintainability by removing helper drift
between the direct-step and scheduler runtimes without changing the broader
phase-133 architecture assessment.

### Session: 2026-04-26 (review slice: direct step runtime boundary cleanup)

**Tasks Completed**: Reviewed the current direct execution path against the
phase-133 step-addressed target and found a remaining maintainability seam:
public `call-step` was step-addressed, but `call-step-impl` still exposed a
`nodeId`-shaped input boundary and then relied on wrapper rewrites to translate
several internal failures back to step wording. Refactored
`CallStepExecutionInput` and the direct execution path to accept `stepId`
end-to-end, updated direct-step runtime failures to emit step-oriented wording
at the source, and kept persisted runtime records stable by continuing to store
materialized execution ids in `nodeExecution.nodeId` while preserving the
reusable payload id separately as `nodeRegistryId`. Updated focused runtime
tests and the architecture note to record that internal boundary cleanup.

**Tasks In Progress**: Module 2 remains in progress for broader runtime/control
cleanup; module 1 authored-schema removal, structural sub-workflow cleanup, and
public-surface/doc retirement remain open.

**Blockers**: None.

**Notes**: Verification for this slice: `bun run typecheck:server` and
`bun test src/workflow/call-step.test.ts src/workflow/call-step-impl.test.ts src/cli.test.ts --runInBand`
(`114` pass). This slice improves DRY/SOLID within the direct-step executor but
does not change the larger architecture mismatch already tracked in this plan.

### Session: 2026-04-26 (review slice: shared workflow-bundle input validation)

**Tasks Completed**: Re-checked the active phase-133 target against the current
GraphQL and nested superviser save paths. No new design doc or plan split was
needed; the implementation still fits the intended step-first cleanup plan.
Removed duplicated workflow-bundle shape parsing by introducing one shared
`parseWorkflowBundleInput` helper and routing both GraphQL
save/validate mutations and nested superviser save-workflow parsing through it.
Also removed an unnecessary `WorkflowRunOptions` cast from
`workflowRunBaseForSuperviserControl` and added regression coverage for invalid
nested superviser `bundle.nodePayloads` input.

**Tasks In Progress**: Module 1 and 2 remain in progress for the broader legacy
schema/runtime removal; this slice only hardens and de-duplicates already-cut
over validation paths.

**Blockers**: None.

**Notes**: Verification for this slice: `bun run typecheck:server` and
`bun test src/graphql/schema.test.ts src/workflow/superviser-control.test.ts src/workflow/superviser-runtime-control-impl.test.ts --runInBand`
(`50` pass).

### Session: 2026-04-26 (review slice: internal direct-step naming cleanup)

**Tasks Completed**: Removed stale internal `call-node` naming from the active
direct step execution path by renaming `call-step-impl` exports to
step-addressed names (`callStepExecution`, `CallStepExecution*`). Simplified
`workflowRunBaseForSuperviserControl` by deleting an unused helper branch in
`superviser-runtime-control-impl.ts`.

**Tasks In Progress**: Module 2 remains in progress; this slice only removes
deprecated naming and dead branching from already-cut-over code paths.

**Blockers**: Full runtime/schema legacy removal still spans later iterations.

**Notes**: Focused tests and type-check should keep this cleanup bounded to the
current direct execution and nested superviser control path.

### Session: 2026-04-26 (review slice: nested superviser control contract centralization)

**Tasks Completed**: Removed brittle string slicing from the native
superviser-control executor path, centralized phase-2 add-on provider metadata
next to the canonical add-on names in `types.ts`, and refactored
`superviser-runtime-control-impl.ts` to use clearer helper functions and less
repetitive target-session loading logic.

**Tasks In Progress**: Module 2/3 cleanup remains in progress; this slice only
hardens the current phase-2 control path and its tests.

**Blockers**: Full removal of legacy cross-workflow/runtime compatibility is
still larger than this review slice.

**Notes**: Added direct native-executor regression coverage for
`divedra/start-workflow` and the missing-control rejection path so the nested
superviser add-on surface no longer relies only on parser/runtime-control
tests.

### Session: 2026-04-26 (review slice: GraphQL bundle parsing + step-addressed save cleanup)

**Tasks Completed**: Re-checked the current phase-133 design target against the working-tree behavior. No new architecture or design-plan split was needed; the implementation is still on the intended step-first cleanup path. Hardened GraphQL workflow-definition save/validate mutations so raw JSON bundle inputs are parsed explicitly instead of being trusted through `as unknown as` casts, which now returns deterministic input errors for malformed `workflow` / `nodePayloads` payloads. Removed the remaining step-addressed save fallback that tried to synthesize authored `entryStepId` from legacy `entryNodeId` during persistence, while preserving validation-first behavior for invalid normalized inputs. Replaced cast-based nested superviser `autoImprove` parsing with explicit typed field parsing and added regression coverage for malformed control arguments.

**Tasks In Progress**: TASK-001 remains in progress for full authored-schema / validation cutover and broader compatibility-path deletion.

**Blockers**: None.

**Notes**: Verification for this slice: `bun run typecheck:server` and `bun test src/graphql/schema.test.ts src/server/graphql.test.ts src/workflow/save.test.ts src/workflow/superviser-control.test.ts --runInBand` (92 pass).

### Session: 2026-04-26 (types: AuthoredWorkflowJson dual validation paths)

**Tasks Completed**: Documented on `AuthoredWorkflowJson` (in `src/workflow/types.ts`) how strict step-addressed validation rejects legacy top-level keys (aligned with `normalizeStepAddressedWorkflow` in `validate.ts`) versus the legacy `normalizeWorkflow` path still accepted until module 1 removes compatibility types. Cross-checked the working-tree diff: `superviser-runtime-control-impl.ts` nested `rerunTargetWorkflow` remains step-only (`rerunFromStepId` via `resolveNestedSuperviserAddonRerunFromStepId`); architecture and `design-auto-improve-superviser-mode.md` remain consistent with phases 130–132. **Verification**: `bun run typecheck:server`, `bun test` (1049 pass), `bun run build`.

**Tasks In Progress**: Module 1 primary `WorkflowJson` / validator companion field removal; module 2 engine union and root/sub branching; modules 4–5 fixture and design-doc retirement.

**Blockers**: None.

### Session: 2026-04-26 (types: document manager id vs step id)

**Tasks Completed**: Clarified on `WorkflowJson.managerNodeId` and `resolveWorkflowManagerRuntimeId` that normalized step-addressed bundles use the **step** id namespace for execution (`managerStepId ?? entryStepId`, same as `session.queue` and materialized `nodes[].id`), not the underlying `steps[].nodeId` registry pointer. Documented `NodeExecutionMailboxStructure.rootManagerNodeId` accordingly to prevent a future refactor from incorrectly switching engine/mailbox comparisons to raw registry node ids. Auto-improve / nested superviser (phases 130-132) remain aligned: no code behavior change. `bun run typecheck:server` and `bun test` after edits.

**Tasks In Progress**: Module 1 `WorkflowJson` / validator full legacy field removal; module 2 runtime union cleanup; modules 4-5.

**Blockers**: None.

### Session: 2026-04-26 (cross-workflow: step-only dispatch for step-addressed graphs)

**Tasks Completed**: `isStepAddressedCrossWorkflowDispatch` in `src/workflow/cross-workflow-from-steps.ts`: when `entryStepId` and non-empty `steps` are present, `effectiveWorkflowCalls` and `workflowCallsForExecutionMatch` use **only** `crossWorkflowCallsFromSteps` and ignore in-memory `workflow.workflowCalls` (aligned with step-addressed validation, which rejects top-level `workflowCalls`). Legacy node-graph objects without a step graph keep the prior explicit+derived merge. Added regression tests; clarified `executeWorkflowCallsForNode` comment in `src/workflow/engine.ts`. `bun run typecheck:server` and `bun test` (**1049** pass).

**Tasks In Progress**: Module 1 primary `WorkflowJson` / validator companion field removal; remaining module 2 engine role branching; modules 4–5 fixtures and design-doc retirement.

**Blockers**: None.

### Session: 2026-04-26 (architecture: phase 133 target vs current; engine comment)

**Tasks Completed**: Brought `design-docs/specs/architecture.md` **Current compatibility-removal sequence** in line with the tree: strict default for rejecting legacy **authorship**, while normalized `WorkflowJson` may still synthesize companions until module 1 finishes; documented the remaining engine union of explicit `workflowCalls` with step-derived `__cw:*` calls. Clarified the cross-workflow scheduling comment in `src/workflow/engine.ts` next to `workflowCallsForExecutionMatch`. Re-verified auto-improve phase 130-132 (no code change needed): `superviser.ts` supervision anchors are step-only; nested `rerunFromNodeId` remains rejected in `superviser-control.ts`. Full `bun run typecheck:server` and `bun test` (**1047** pass).

**Tasks In Progress**: Module 1 primary type/validator companion removal; module 2 single-dispatch cleanup; modules 4-5 fixtures and closeout.

**Blockers**: None.

### Session: 2026-04-26 (TUI: step-addressed Entry line without `managerNodeId` alias)

**Tasks Completed**: Added `buildWorkflowExecutionIdentityPreviewSegment` in `src/tui/opentui-model/workflow-rendering.ts` so one-line `Entry:` / `Manager:` labels for `buildWorkflowSummaryPreview` and `buildWorkflowRunPreview` share one implementation. For step-addressed bundles, Entry is `entryStepId ?? entryNodeId ?? "(unset)"` (no fallback to compatibility `managerNodeId`, which conflated manager runtime with entry). Legacy node-graph fallbacks unchanged. `bun run typecheck:server` and full `bun test` green.

**Tasks In Progress**: Module 1 primary `WorkflowJson` / validator legacy field removal; module 2 runtime union cleanup; modules 4–5.

**Blockers**: None.

### Session: 2026-04-26 (README: step-addressed vs legacy `workflowCalls`)

**Tasks Completed**: Updated README "What Is Implemented Today" and "Additional authored shapes" so they no longer read as if top-level `workflow.workflowCalls` is always a supported authoring path. Step-addressed bundles must use `steps[].transitions` with `toWorkflowId` / `resumeStepId` (validator rejects top-level `workflowCalls` on `entryStepId`+`steps`); legacy node-graph bundles may still use explicit `workflowCalls` until the non-step path is removed. Aligns public overview with `normalizeStepAddressedWorkflow` and `design-workflow-json.md`.

**Tasks In Progress**: Module 1 `WorkflowJson` / normalized legacy companion field removal; module 2 runtime union cleanup; modules 4-5 (fixtures, broader design-doc pass, closeout).

**Blockers**: None.

### Session: 2026-04-26 (event trigger: sticky `managerRuntimeId` field name)

**Tasks Completed**: Renamed internal `StickyRootManagerContext.managerNodeId` to `managerRuntimeId` in `src/events/trigger-runner.ts` so the name matches `resolveWorkflowManagerRuntimeId` semantics (step id for step-addressed graphs, not a misleading “node-only” label). No behavior change to queue seeding. Updated this progress log.

**Tasks In Progress**: Module 1 `WorkflowJson` / validator legacy companion removal; module 2 root/sub edge runtime; modules 3–5 as before.

**Blockers**: None.

### Session: 2026-04-26 (TUI + event trigger: canonical manager runtime id)

**Tasks Completed**: OpenTUI workflow summary/run preview one-line `Manager:` label for step-addressed bundles now uses `resolveWorkflowManagerRuntimeId` when `managerStepId` is omitted (still respects `hasManagerNode === false` as `none`). Event workflow trigger `resolveStickyRootManagerContext` uses the same helper for `getNormalizedNodePayload` lookup and sticky `managerNodeId` so session queue seeding matches engine routing. `bun run typecheck:server` and full `bun test` (1047 tests).

**Tasks In Progress**: Module 1 primary `WorkflowJson` / validator legacy field removal; module 2 root/sub edge runtime; modules 4–5 design-doc and closeout.

**Blockers**: None.

### Session: 2026-04-26 (engine: `resolveWorkflowManagerRuntimeId` for step-first manager id)

**Tasks Completed**: Added `resolveWorkflowManagerRuntimeId` in `src/workflow/types.ts` to return `managerStepId ?? entryStepId` for normalized step-addressed bundles and `managerNodeId` for legacy node-graph shapes. Migrated all root-workflow `workflow.managerNodeId` reads in `src/workflow/engine.ts` and the root manager line in `src/workflow/node-execution-mailbox.ts` to use the helper so the active runtime no longer **depends** on the synthesized compatibility alias for step graphs (next cuts can delete `managerNodeId` from `WorkflowJson` once remaining references are updated). Regressions in `src/workflow/validate.test.ts`. `bun run typecheck:server` and full `bun test` (1047 tests).

**Tasks In Progress**: Module 1: remove `managerNodeId` from `WorkflowJson` type and validation output after migrating remaining `bundle.workflow.managerNodeId` / inspection paths; module 2: root/sub edge runtime vs pure step graph; modules 4–5.

**Blockers**: None.

### Session: 2026-04-26 (strict validation regression for `examples/default-superviser`)

**Tasks Completed**: Added `validateWorkflowBundle` coverage that `examples/default-superviser/workflow.json` passes `rejectLegacyWorkflowAuthoring: true` (phase-2 nested superviser reference bundle remains step-addressed-only). `bun test`, `bun run typecheck:server`, and `bun run build` green (1044 tests).

**Tasks In Progress**: Module 1 `WorkflowJson` / validator full legacy field removal; module 2 root/sub-workflow union cleanup; modules 4–5 design-doc retirement and closeout.

**Blockers**: None.

### Session: 2026-04-26 (nested `divedra/rerun-workflow` without `rerunFromStepId`)

**Tasks Completed**: Fixed a runtime bug where phase-2 `rerunTargetWorkflow` passed `rerunFromSessionId` to `runWorkflow` without `rerunFromStepId` when the add-on omitted the field (the parser allows omission), but the engine always requires a rerun step id with `rerunFromSessionId`. Added `resolveNestedSuperviserAddonRerunFromStepId` in `src/workflow/superviser.ts` to default omitted reruns to the current session step when resolvable, else the manager/entry anchor. Documented `RerunWorkflowAddonInput.rerunFromStepId` in `src/workflow/types.ts`. Tests in `superviser.test.ts`. `bun run typecheck:server` and full `bun test` green.

**Tasks In Progress**: Module 1 `WorkflowJson` / validator full legacy field removal; remaining module 2 union cleanup; modules 4–5.

**Blockers**: None.

### Session: 2026-04-26 (step-addressed: reject top-level `workflowCalls`)

**Tasks Completed**: `normalizeStepAddressedWorkflow` no longer accepts `workflow.workflowCalls` (non-strict or strict): step-addressed authoring must use `steps[].transitions` with `toWorkflowId` / `resumeStepId`. Removed reserved-id and same-step collision checks that only applied when explicit calls were allowed on step bundles. Updated `validate.test.ts`; documented `AuthoredWorkflowJson.workflowCalls` and `design-workflow-json.md` / `notes.md` legacy bullets. Legacy-only node-graph validation (`normalizeWorkflow`) still normalizes explicit `workflowCalls` for existing fixtures. `bun test` and `bun run typecheck:server` green.

**Tasks In Progress**: Module 1: remove other compatibility fields from primary types; module 2: runtime union cleanup; modules 4-5.

### Session: 2026-04-26 (review slice: phase-2 superviser control cleanup)

**Tasks Completed**: Centralized the phase-2 `divedra/*` superviser-control add-on catalog in `src/workflow/types.ts` so add-on resolution and native execution stop repeating the same hardcoded names/descriptions. Simplified `parseLoadWorkflowDefinitionControlArguments` typing in `src/workflow/superviser-control.ts` by removing an unnecessary cast around the shared mutable-workflow path parser. Added integration-style coverage in `src/workflow/superviser-runtime-control-impl.test.ts` proving `rerunTargetWorkflow()` derives `rerunFromStepId` from persisted target-session state when the nested add-on omits it. Updated `design-docs/specs/architecture.md` to record that duplicate superviser-control catalogs are implementation drift, while the broader architectural mismatch remains the still-live legacy compatibility layer tracked by this plan.

**Tasks In Progress**: Module 1 primary `WorkflowJson` compatibility-field removal; module 2 runtime union cleanup beyond the nested superviser slice; modules 4-5 design-doc/example retirement and closeout.

**Blockers**: None.

### Session: 2026-04-26 (impl-plans index: repair design references after spec deletions)

**Tasks Completed**: Repointed `impl-plans/README.md` completed-plan rows that still named deleted specs (`qa-step-schema-workflow-calls`, `design-graphql-manager-runtime-session-lifecycle`) to surviving anchors (`design-workflow-json` / `design-workflow-steps-and-node-reuse` coverage via existing columns; GraphQL session lifecycle via `design-graphql-manager-control-plane` + `architecture`). Aligns module 4 checklist item “repoint implementation-plan references away from deleted design docs” for the index table.

**Tasks In Progress**: Module 1 `WorkflowJson` / validator legacy field removal; module 2 runtime union cleanup; modules 4–5 broader fixture and design-doc retirement.

**Blockers**: None.

### Session: 2026-04-26 (architecture verification + call-node plan supersession)

**Tasks Completed**: Re-checked `impl-plans/PROGRESS.json`: phases 130-132 (auto-improve superviser) remain **Completed**; phase **133** / this plan is the active target. Confirmed `design-auto-improve-superviser-mode.md` phase 1/2 match the tree (`runAutoImproveLoop`, `nestedSuperviserDriver`, `SuperviserRuntimeControl`, step-only `rerunFromStepId` on engine reruns and nested `divedra/rerun-workflow` with `rerunFromNodeId` rejected in `superviser-control.ts`). `design-docs/specs/architecture.md` **Manager Control Architecture** already describes step-only action names and removed structural actions. Full `bun run typecheck:server` and `bun test` (**1043** pass) on the current branch. Added a **Supersession** callout to `impl-plans/manager-driven-call-node-runtime.md` so the completed plan no longer reads as the live public API.

**Tasks In Progress**: Module 1 primary `WorkflowJson` / validator field removal; module 2 root/sub-workflow union cleanup and `workflowCalls` vs step-transition dispatch; modules 4-5 (fixtures, design-doc retirement, closeout).

**Blockers**: None.

### Session: 2026-04-26 (remove manager-control `*-node` parse aliases)

**Tasks Completed**: Removed `retry-node`, `execute-optional-node`, and `skip-optional-node` branches from `parseManagerControlActionInput` in `src/workflow/manager-control.ts`; updated `manager-control.test.ts` and `engine.test.ts` fixtures to use `retry-step` / `execute-optional-step` / `skip-optional-step` with `stepId`; added rejection tests for legacy action types. Updated `design-docs/specs/architecture.md` and `notes.md` Manager Control / legacy bullets. `bun run typecheck:server` and full `bun test` verified after change.

**Tasks In Progress**: Module 1 `WorkflowJson` / validator legacy field removal; module 2 root/sub-workflow runtime branching and `workflowCalls` union; modules 4–5.

**Blockers**: None.

### Session: 2026-04-25 (manager-control step-oriented action names)

**Tasks Completed**: Canonical `ManagerControlAction` types are `retry-step`, `execute-optional-step`, and `skip-optional-step` with `stepId`; `ParsedManagerControl` exposes `retryStepIds` / `executeOptionalStepIds` / `skipOptionalStepIds`; `ManagerIntentSummary.kind` updated accordingly. (As of 2026-04-26, the parser no longer accepts removal-bound `retry-node` / `execute-optional-node` / `skip-optional-node`.) Updated engine optional-decision merge, manager message service, mailbox prompt snippets, tests, and `architecture.md` / `notes.md` to match. `bun run typecheck:server` and full `bun test` pass.

**Tasks In Progress**: Module 1 `WorkflowJson` / validator legacy field removal; module 2 root/sub-workflow runtime branching; modules 4–5.

**Blockers**: None.

### Session: 2026-04-25 (architecture check + archived plan supersession notes)

**Tasks Completed**: Re-verified `design-auto-improve-superviser-mode` (phase 1/2) and `design-docs/specs/architecture.md` (Manager Control target vs current, structural actions removed) against the tree; no implementation drift in auto-improve beyond phase 133 scope. Added **Superseded** callouts in `impl-plans/completed/step-addressed-workflow-runtime-cutover.md` to two progress-log entries that still described public `rerunFromNodeId` / `fromNodeId` on `rerunWorkflow` after phase 133 moved to step-only engine and library reruns.

**Tasks In Progress**: Module 1 primary `WorkflowJson` / validator legacy field removal; module 2 `retry-node` rename and remaining engine compatibility paths; modules 4-5.

**Blockers**: None.

### Session: 2026-04-25 (module 2: remove structural manager-control actions)

**Tasks Completed**: Removed `start-sub-workflow` and `deliver-to-child-input` from `ManagerControlAction` / parsing; dropped `ParsedManagerControl` override fields and engine branches that validated or applied those lists. Engine now always uses `planRootManagerSubWorkflowStarts` and `planSubWorkflowChildInputs` (no control override). Relaxed root-manager `retry-node` so internal structural sub-workflow nodes are valid retry targets. Updated `manager-message-service`, `ManagerIntentSummary`, mailbox metadata and prompt rendering, `persistManagerMessageCommunication` transitionWhen label, tests (including communication replay via direct artifact seed), `design-docs/specs/architecture.md`, and `notes.md`. `bun run typecheck:server` and full `bun test` pass.

**Tasks In Progress**: Module 1 authored `WorkflowJson` / validator legacy field removal; optional renames `retry-node` to `retry-step`; modules 4–5.

**Blockers**: None.

### Session: 2026-04-25 (architecture review + step-addressed mixed-authorship regression)

**Tasks Completed**: Re-verified `design-docs/specs/architecture.md` (strict step-addressed intent, `superviser-control.ts` / `node-addons.ts` in the module list) against the working tree: auto-improve phase 1/2 remain aligned with the design docs; the remaining no-backcompat gap is still this plan (structural manager-control, non-step `normalizeWorkflow` path, public type surface). Added `validate.test.ts` coverage that a canonical `entryStepId`+`steps` bundle must not also carry `workflow.entryNodeId` (regression for `normalizeStepAddressedWorkflow` legacy-key rejection). Corrected a stale `auto-improve-superviser-mode.md` progress line that still mentioned `rerunFromNodeId` in CLI rerun wiring after engine step-only reruns. `bun run typecheck:server` and `bun test` after the change.

**Tasks In Progress**: Module 1 full removal of compatibility fields from `WorkflowJson` / non-step path; module 2 remaining engine role/model cleanup; modules 4-5.

**Blockers**: None.

### Session: 2026-04-26 (design alignment: manager control current vs target)

**Tasks Completed**: Re-read `impl-plans/PROGRESS.json` and `impl-plans/README.md`: phases 130–132 (auto-improve superviser) remain **Completed**; phase **133** / this plan is the active implementation target. Found `design-docs/specs/architecture.md` **Manager Control Architecture** describing only target action names (`retry-step`, …) without stating that the runtime still implements `retry-node`, `execute-optional-node`, and structural `start-sub-workflow` / `deliver-to-child-input`. Updated that section to separate **target** vs **current** and to point at this plan for the rename/removal work. Updated `design-docs/specs/notes.md` legacy bullet so it no longer claims inspection exposes `managerNodeId`/`entryNodeId` on primary summaries (those fields were removed from inspection/GraphQL); listed the real remaining debt instead. No code behavior change.

**Tasks In Progress**: Module 1 `WorkflowJson` / validator legacy field removal; module 2 structural manager-control deletion and action renames; modules 4–5.

**Blockers**: None.

### Session: 2026-04-26 (impl-plan hygiene + archived web-editor refs)

**Tasks Completed**: Corrected stale session text that still pointed at `src/workflow/call-node.ts` / `call-node.test.ts` after the rename to `call-step-impl.ts` / `call-step-impl.test.ts`. Documented the internal `callNode` export in `call-step-impl.ts` in the 2026-04-26 architecture verification log line. Marked `impl-plans/workflow-web-editor-execution.md` as a historical completed plan and annotated `impl-plans/branch-and-loop-block-subworkflows.md` module 3 with post-`remove-web-ui` context so archived plans do not imply the browser still exists. No runtime behavior change.

**Tasks In Progress**: Module 1 `WorkflowJson` / validator legacy field removal; module 2 structural manager-control and runtime legacy path reduction; modules 4–5.

**Blockers**: None.

### Session: 2026-04-25 (internal direct-call module rename)

**Tasks Completed**: Renamed `src/workflow/call-node.ts` to `src/workflow/call-step-impl.ts` and `call-node.test.ts` to `call-step-impl.test.ts` so the codebase no longer carries a `call-node` _module_ name next to the removed CLI command. `callStep` remains the only entry; `export async function callNode` is the internal address used by `call-step-impl` (unchanged). Updated this plan’s module table and the module-2 checklist item to reflect the fold into the `call-step` path.

**Tasks In Progress**: Module 1 authored-schema / validator removal; module 2 structural manager-control action deletion; modules 4–5.

**Blockers**: None.

### Session: 2026-04-25 (impl-plans index: surviving design references)

**Tasks Completed**: Synced `impl-plans/README.md` phase **133** with `PROGRESS.json` (`IN_PROGRESS`). Repointed completed-plan **Design Reference** cells away from removed specs (`design-workflow-web-editor`, `design-refactoring-*`, `design-manager-driven-call-node-runtime`, etc.) to surviving anchors (`architecture`, `command`, `notes`, and remaining `design-*` files such as `design-node-jump-and-code-manager-runtime`).

**Tasks In Progress**: Module 1 authored-schema / validator removal; module 2 runtime structural control and internal `call-node` path; modules 4–5 verification.

**Blockers**: None.

### Session: 2026-04-26 (architecture verification + internal call-node documentation)

**Tasks Completed**: Re-verified `design-auto-improve-superviser-mode.md` phase 1/2 against the tree: `runAutoImproveLoop`, `toStepAddressedWorkflowForSupervision`, nested `SuperviserRuntimeControl`, and step-only `rerunFromStepId` on `WorkflowRunOptions` / nested `divedra/rerun-workflow` (with parse-time rejection of `rerunFromNodeId` on the control add-on). Documented `src/workflow/call-step-impl.ts` (internal `callNode` entry used only from `call-step.ts`) as not a supported user entrypoint. Corrected the 2026-04-25 session log entry below that still described engine `rerunFromNodeId` as a compatibility path after it was removed. `bun run typecheck:server` and `bun test` (1045) pass.

**Tasks In Progress**: Module 1 authored-schema / validator removal; module 2 runtime cleanup (`call-node` merge, structural manager-control deletion); modules 4–5.

**Blockers**: None.

### Session: 2026-04-25 (continuation: diff review + bookkeeping)

**Tasks Completed**: Re-read `design-auto-improve-superviser-mode.md` and `src/workflow/superviser.ts` / `superviser-runtime-control-impl.ts` against the working tree: phase 1 `runAutoImproveLoop`, phase 2 `nestedSuperviserDriver` + `toStepAddressedWorkflowForSupervision` for `rerunTargetWorkflow`, and step-only `rerunFromStepId` on engine reruns and nested `divedra/rerun-workflow` still match the spec. No code defects found in that path on review. Set `impl-plans/PROGRESS.json` phase **133** to `IN_PROGRESS` (active `workflow-legacy-compatibility-removal`). Documented `examples/default-superviser/` in `examples/README.md` and added a short `EXPECTED_RESULTS.md` there so the directory matches the examples index convention. Full `bun run typecheck:server` and `bun test` (1045) verified green on the pre-edit tree.

**Tasks In Progress**: Module 1 primary `WorkflowJson` / validator legacy field removal; module 2 internal `call-node` path merge and structural manager-control deletion; modules 4–5 as in checklists.

**Blockers**: None.

### Session: 2026-04-25 (TUI: hide legacy structural sub-workflows for step-addressed)

**Tasks Completed**: `buildWorkflowDefinitionContent`, `buildWorkflowSummaryPreview`, and `buildWorkflowRunPreview` no longer show legacy structural sub-workflow counts or id lists when the loaded bundle is step-addressed (`workflow.steps` defined), including when normalized data still has `subWorkflows` entries. `appendWorkflowBoundarySections` skips the "Legacy Structural Sub-Workflows" block for the same case. Preserves full legacy lines for non-step-addressed loads. Added `opentui-screen.test.ts` coverage. `bun run typecheck:server` and full `bun test` (1045) pass.

**Tasks In Progress**: Module 1 primary `WorkflowJson` field removal; module 2 `call-node` internal path and structural manager-control deletion; module 3 visualization beyond this slice; modules 4-5 as before.

**Blockers**: None.

### Session: 2026-04-26 (engine `rerunFromNodeId` removal)

**Tasks Completed**: Removed `rerunFromNodeId` from `WorkflowRunOptions` in `src/workflow/engine.ts`; rerun with `rerunFromSessionId` now requires `rerunFromStepId` only. Updated `runWorkflow` destructure in the auto-improve supervision loop, `stripForChildRun` in `superviser-runtime-control-impl.ts`, tests, and `design-auto-improve-superviser-mode.md` (step-only engine reruns). Aligns phase 133 public/runtime story with nested superviser parse-time rejection of `rerunFromNodeId`.

**Tasks In Progress**: Module 1 authored-schema removal; module 2 `call-node` implementation path; module 3 TUI structural labels; modules 4–5 as before.

**Blockers**: None.

### Session: 2026-04-25 (design review + public rerun checklist)

**Tasks Completed**: Re-verified `design-auto-improve-superviser-mode.md` and `src/workflow/superviser.ts` against the tree: phase 1/2 (engine `runAutoImproveLoop`, `toStepAddressedWorkflowForSupervision`, phase-2 nested `SuperviserRuntimeControl` with step-only `divedra/rerun-workflow`) match the spec; the remaining broad legacy deletion is **phase 133** (this plan), not additional auto-improve features. Reviewed the working-tree diff: no supervision regressions identified; `bun run typecheck:server`, `bun test` (1045 pass), and `bun run build` are green. Marked module 3 "rerun/resume/public API wording" checklist item **done** for operator-facing surfaces (library + CLI + TUI are step-targeted; engine reruns use `rerunFromStepId` only on `WorkflowRunOptions`, as in `design-auto-improve-superviser-mode.md` and `workflow-legacy-compatibility-removal` follow-up).

**Tasks In Progress**: module 1 authored-schema removal; module 2 runtime `call-node` / structural control deletion; module 3 TUI legacy "structural sub-workflow" labels.

**Blockers**: None.

### Session: 2026-04-25 (TUI node registry vs inspection)

**Tasks Completed**: Matched OpenTUI workflow previews to `buildInspectionSummary` by resolving node registry ids with `workflow.nodeRegistry ?? workflow.nodes` (`effectiveNodeRegistryIds` in `src/tui/opentui-model/workflow-rendering.ts`). Step-addressed bundles that only list reusable payloads under `nodes[]` (no separate `nodeRegistry` field) no longer show `Node registry: 0` and a confusing duplicate “Compatibility nodes” count; definition content now includes registry lines for all step-addressed loads. Updated `opentui-screen.test.ts` expectations. `bun run typecheck:server` and full `bun test` (1045) pass.

**Tasks In Progress**: TASK-001 through TASK-003 per module checklists; broad legacy field removal unchanged.

**Blockers**: None.

### Session: 2026-04-25 (design alignment + progress bookkeeping)

**Tasks Completed**: Re-verified `design-auto-improve-superviser-mode.md` against the shipped Phase 1/2 implementation (engine loop, nested driver, step-only nested `divedra/rerun-workflow`). Added an explicit subsection documenting how Phase 1 uses `toStepAddressedWorkflowForSupervision` during phase 133 (strict step bundles, rejection of `entryStepId` without steps, legacy node-graph projection) and how Phase 2 rejects `rerunFromNodeId`. Updated this plan's dependency table and `impl-plans/PROGRESS.json` so modules 2–3 reflect **In Progress** parallel slices rather than incorrectly implying they are fully blocked until module 1 finishes.

**Tasks In Progress**: TASK-001 module 1 (full removal of authored compatibility fields from `WorkflowJson` / validator); TASK-002/003 bounded cleanup continues per checklist.

**Blockers**: None.

### Session: 2026-04-25 (architecture check + `WorkflowJson` doc alignment)

**Tasks Completed**: Confirmed `design-auto-improve-superviser-mode` (phase 1/2) and nested `SuperviserRuntimeControl` match the current engine/add-on path; the remaining gap for “single model everywhere” is this plan (phase 133), not additional auto-improve features. Documented on `WorkflowJson` how normalized output relates to step-addressed authoring and strict validation, so the type surface matches the removal roadmap without changing runtime behavior. `bun run typecheck:server` and `bun test` verified green before edit.

**Tasks In Progress**: TASK-001 module 1 (remove compatibility fields from primary types/validator; full removal still multi-iteration).

**Blockers**: None.

### Session: 2026-04-25 (nested superviser rerun vs legacy target shape)

**Tasks Completed**: Aligned phase-2 `buildSuperviserRuntimeControl.rerunTargetWorkflow` with phase-1 supervision and `runWorkflow` rerun: the control plane no longer rejects legacy node-graph targets solely because `workflow.steps` is absent. Preconditions now use `toStepAddressedWorkflowForSupervision` (same as the outer auto-improve loop), so `entryNodeId` + `nodes` bundles can be rerun under nested superviser when policy supplies a valid `rerunFromStepId` / node id. `bun run typecheck:server` and full `bun test` pass.

**Tasks In Progress**: TASK-001 authored schema and validation cutover (module 1); broader legacy field removal unchanged.

**Blockers**: None.

### Session: 2026-04-25 (supervision projection edge case)

**Tasks Completed**: Hardened `toStepAddressedWorkflowForSupervision` so an authored `entryStepId` is authoritative: missing or empty `steps` now yields `null` instead of falling through to legacy `entryNodeId`+`nodes` projection (avoids wrong remediation targets on malformed step-addressed bundles). Added regression test. `bun run typecheck:server` and full `bun test` pass.

**Tasks In Progress**: TASK-001 module 1 (full legacy field removal from `WorkflowJson` / validator) remains open.

**Blockers**: None.

### Session: 2026-04-25 (lib test cleanup + full verification)

**Tasks Completed**: Removed unused `createCallNodeFixture` from `src/lib.test.ts` (leftover after `call-node` CLI/library tests were removed or migrated to `call-step`); fixed `tsc` **TS6133** on that helper. Re-ran `bun run typecheck:server` and full `bun test` (all pass).

**Tasks In Progress**: TASK-001 module 1 (authored schema / validation cutover; primary `WorkflowJson` and validator still carry compatibility fields per checklist above).

**Blockers**: None.

### Session: 2026-04-26 (typecheck + design note)

**Tasks Completed**: Repaired `tsc` for `src/workflow/superviser.test.ts` by using `as unknown as WorkflowJson` for intentional partial fixtures after `WorkflowJson` was tightened. Adjusted `design-docs/specs/notes.md` legacy review bullet: supervision remediation is step-id only, with `toStepAddressedWorkflowForSupervision` projecting legacy node-graph bundles for planning. `bun run typecheck:server` and full `bun test` pass.

**Tasks In Progress**: TASK-001 broad removal of authored compatibility fields from types/validate/load/save (module 1).

### Session: 2026-04-26 (auto-improve loop + legacy bundle projection)

**Tasks Completed**: Fixed phase-1 `runAutoImproveLoop` supervision remediation for **legacy** target bundles (node graph only: `entryNodeId` + `nodes` without `entryStepId` / `steps`). The loop had started requiring a strict step-addressed loaded workflow, which made `planSupervisionRemediation` fail before any rerun and left supervision stuck `running` (all related `engine.test.ts` auto-improve cases red). Added `toStepAddressedWorkflowForSupervision` in `src/workflow/superviser.ts` to project the same step-id alignment the runtime already uses for legacy execution; engine uses it when planning reruns. Adjusted the resume+supervision test to expect `rerun-step` when the failure is on a non-entry step (expected once current-step resolution works). Added `superviser.test.ts` coverage for the helper. Full `bun test` and `bun run typecheck:server` green.

**Tasks In Progress**: TASK-001 broader authored-schema / validator removal of legacy fields (module 1) remains open.

**Blockers**: None.

### Session: 2026-04-25 (JSDoc alignment: supervision anchor vs engine rerun fields)

**Tasks Completed**: Re-confirmed auto-improve phase 1/2 match the design doc; `bun run typecheck:server` and `bun test` (1045 pass). Updated `resolveSupervisionRerunAnchor` documentation in `src/workflow/superviser.ts` so it matches engine behavior: step-addressed targets use `rerunFromStepId`, node-registry-only bundles use `rerunFromNodeId`, and node id fields in `WorkflowJson` are described as removal-bound compatibility fallbacks.

**Tasks In Progress**: TASK-001 authored schema and validation cutover (module 1); large legacy field removal in `types.ts` / `validate.ts` / fixtures still pending across future iterations.

**Blockers**: None.

### Session: 2026-04-25 (continuation: design check + child-run strip test)

**Tasks Completed**: Re-read `PROGRESS.json` and `impl-plans/README.md`: auto-improve superviser plans (phases 130-132) remain **Completed**; **phase 133** / `workflow-legacy-compatibility-removal` is the active next target. Confirmed `design-auto-improve-superviser-mode.md` and `architecture.md` still match the implementation (phase-1 loop, phase-2 `nestedSuperviserDriver` + `SuperviserRuntimeControl`, `nestedSuperviserSessionId`, step-only nested `divedra/rerun-workflow`). Reviewed the working-tree diff: no new defects found; `bun run typecheck:server`, `bun test` (1044 pass), and `bun run build` succeed. Added `workflowRunBaseForSuperviserControl` regression coverage so child superviser control runs do not inherit outer `sessionId` / rerun / nested-driver fields while preserving `workflowRoot` and `runtimeVariables` merge behavior from the prior `startTargetWorkflow` test.

**Tasks In Progress**: TASK-001 authored schema and validation cutover (module 1) for full legacy field removal; still multi-iteration per plan.

**Blockers**: None.

### Session: 2026-04-25 (architecture alignment)

**Tasks Completed**: Confirmed auto-improve phase 1/2 match `design-auto-improve-superviser-mode.md`; updated stale `src/workflow/superviser.ts` module commentary and patch-escalation wording; expanded `design-docs/specs/architecture.md` supervision sources to include `superviser-control.ts` and `node-addons.ts`.

**Tasks In Progress**: None (schema/runtime legacy removal modules still NOT_STARTED).

### Session: 2026-04-25 (continuation review + supervision rerun cleanup)

**Tasks Completed**: Reviewed the large working-tree diff against the active design and confirmed the repository still does not meet the intended no-backcompat target. Recorded the concrete remaining mismatch in `design-docs/specs/notes.md`: public inspection/control surfaces still expose legacy compatibility concepts, and supervised rerun planning still falls back to node-addressed identities.

**Tasks In Progress**: Runtime and control cleanup slice for supervision reruns.

**Blockers**: Broad schema/runtime/public-surface compatibility removal remains larger than one iteration; this slice only removes one legacy leak from the active supervision path.

**Notes**: This iteration intentionally targets the supervision rerun path because it is already under active modification from the nested superviser work and can be made step-addressed without waiting for the full validator/runtime cutover.

### Session: 2026-04-25 (supervision rerun slice implemented)

**Tasks Completed**: Removed legacy node-id fallback from supervision remediation planning in `src/workflow/superviser.ts`; made the auto-improve outer loop reject non-step-addressed rerun targets instead of silently dropping into compatibility semantics; updated supervision regressions to assert step-only rerun targets.

**Tasks In Progress**: None for this slice.

**Blockers**: The broader compatibility-removal plan is still incomplete. `call-node`, legacy inspection/GraphQL fields, structural sub-workflow runtime logic, and compatibility validation/load paths remain in the repository and still need follow-up iterations.

**Notes**: Verification passed with `bun test src/workflow/superviser.test.ts src/workflow/superviser-runtime-control-impl.test.ts` and `bun run typecheck:server`.

### Session: 2026-04-25 (iteration 1 baseline hardening)

**Tasks Completed**: Reviewed the in-progress branch diff against the no-backcompat target; confirmed the repository still does not match the intended single-model step-addressed architecture; added a design-note reminder that compatibility paths are removal-only; fixed a nested-superviser control regression where `divedra/start-workflow` dropped authored `runtimeVariables` when resuming the supervised target session; added focused regression coverage for that control-plane merge behavior.

**Tasks In Progress**: The broad compatibility-removal modules remain open; next iterations should delete legacy surfaces (`call-node`, node-addressed inspection fields, structural sub-workflow projections, and authored compatibility schema branches) rather than continue adding safeguards around them.

**Blockers**: None for the next cleanup slice. The targeted regression guard keeps the current nested-superviser branch work viable while the larger legacy-removal refactor proceeds.

**Notes**: `impl-plans/PROGRESS.json` marks auto-improve plans completed; phase 133 remains the next execution target for this branch direction.

### Session: 2026-04-25 21:05 JST

**Tasks Completed**: Reviewed the current in-flight diff against the strict
step-addressed design and started a bounded cleanup slice in the new
superviser/runtime-control work.

**Tasks In Progress**: TASK-001 authored schema/public-surface cutover.

**Blockers**: Core runtime compatibility remains wide; this iteration removes
new legacy leakage first instead of deleting the whole compatibility layer in
one change.

**Notes**: The review found a concrete mismatch with the intended direction:
an early nested-superviser iteration used a node-worded rerun field. The
branch now enforces step-only rerun for phase-2 control add-ons (`rerunFromStepId`
on `divedra/rerun-workflow`), rejects `rerunFromNodeId` in
`parseRerunTargetWorkflowControlArguments`, and keeps GraphQL `stepId` primary
for reruns. Broader engine/library `rerunFromNodeId` on `WorkflowRunOptions`
remains a compatibility path until the full cutover in later modules.

### Session: 2026-04-25 20:05 JST

**Tasks Completed**: Initial refactoring-plan creation
**Tasks In Progress**: None
**Blockers**: Current branch has in-flight superviser runtime changes, so the
runtime/control cleanup must be coordinated with those edits rather than
reverting them
**Notes**: The plan is intentionally a breaking cleanup pass that follows the
already-landed step-addressed cutover work. The current repository still has
heavy compatibility weight in `validate.ts`, `engine.ts`, `manager-control.ts`,
`call-node.ts`, inspection/GraphQL surfaces, examples, and tests. The plan
explicitly includes design-doc retirement so the surviving documentation matches
the runtime after cleanup instead of preserving transitional docs indefinitely.

### Session: 2026-04-25 (phase-2 superviser control hardening)

**Tasks Completed**: Confirmed `design-auto-improve-superviser-mode` phase 1/2
match the implementation (nested driver, `RerunWorkflowAddonInput.rerunFromStepId`,
`buildSuperviserRuntimeControl`); added an explicit error when nested superviser
`divedra/rerun-workflow` arguments still use `rerunFromNodeId` (must use
`rerunFromStepId`); regression test in `superviser-control.test.ts`.

**Tasks In Progress**: TASK-001 (full authored-schema / validation cutover for
`workflow-legacy-compatibility-removal`).

**Notes**: Re-ran targeted tests for superviser control, engine auto-improve,
GraphQL rerun, and library; all passed.

### Session: 2026-04-25 (design vs implementation review)

**Tasks Completed**: Re-verified `design-auto-improve-superviser-mode.md` and `architecture.md` against the shipped runtime: phase-1 `runAutoImproveLoop` vs phase-2 `nestedSuperviserDriver` + `SuperviserRuntimeControl` + `nestedSuperviserSessionId`; `buildSuperviserRuntimeControl.startTargetWorkflow` merge of base and add-on `runtimeVariables` (regression in `superviser-runtime-control-impl.test.ts`); step-only `rerunFromStepId` for nested `divedra/rerun-workflow` with explicit rejection of `rerunFromNodeId`. Full suite: `bun run typecheck:server` and `bun test` (1043 pass). Updated stale default-superviser id notes in `impl-plans/completed/auto-improve-superviser-workflow-phase-2.md` and `auto-improve-superviser-mode.md` progress logs (`divedra-default-superviser`).

**Tasks In Progress**: TASK-001 authored schema and validation cutover (module 1) for this plan; not started beyond nested-superviser hardening on this branch.

**Blockers**: None. Large legacy field removal remains a multi-iteration effort (modules 1–2) so nested superviser changes stay shippable.

**Notes**: Track `src/workflow/superviser-runtime-control-impl.test.ts` in version control with the other workflow tests. Optional follow-up: expand nested-only patch-audit coverage (called out in completed phase-2 plan).

### Session: 2026-04-25 (iteration 1: step-only rerun surfaces)

**Tasks Completed**: Re-checked the active diff against the no-backcompat target and isolated the smallest user-facing legacy seam still worth cutting immediately: rerun/control aliases that still accepted node-addressed inputs outside GraphQL. Removed `fromNodeId` / `rerunFromNodeId` from the library rerun API and shared local UI contract, trimmed the local API request parser to `fromStepId`, and updated the OpenTUI rerun flow to require an authored `stepId` instead of silently falling back to node-addressed executions.

**Tasks In Progress**: The broader compatibility-removal modules remain open; next iterations should delete `call-node`, legacy validation/load/save projections, structural sub-workflow planning, and the remaining compatibility examples/tests.

**Blockers**: None for the next cleanup slice. This iteration intentionally hardens one public boundary without pretending the deeper runtime/schema removal is finished.

### Session: 2026-04-25 (iteration 2: remove public call-node surface)

**Tasks Completed**: Removed the supported `call-node` public surface from the CLI and package-root library API so user-facing direct execution is now step-only. Updated `README.md`, `design-docs/specs/command.md`, and `design-docs/specs/notes.md` to treat `call-step` as the only supported direct-call contract and to record that `call-node` is no longer a compatibility alias. Re-ran `bun run typecheck:server` and focused CLI/library tests after the change.

**Tasks In Progress**: Public-surface cleanup remains incomplete beyond direct execution. `workflow inspect`, GraphQL workflow inspection, and TUI summaries still expose compatibility-oriented fields and counts that should be removed in later slices.

**Blockers**: Internal runtime code still uses `call-step-impl.ts` (export `callNode`) behind `call-step`, and authored/schema compatibility (`managerNodeId`, `entryNodeId`, `workflowCalls`, `subWorkflows`, structural projections) remains live elsewhere. This iteration intentionally removed only the user-facing alias first.

### Session: 2026-04-25 (inspection / GraphQL step-first surface)

**Tasks Completed**: Removed node-addressed inspection fields (`managerNodeId`, `entryNodeId`), `counts.legacySubWorkflows`, and the entire `compatibility` block from `WorkflowInspectionSummary`, CLI text/json inspect, executable GraphQL `WorkflowView` / `WorkflowCounts`, and aligned tests. `buildInspectionSummary` now fills `nodeRegistryIds` from `nodeRegistry` or runtime `nodes` so legacy bundles still list registry ids. OpenTUI history header uses `subWorkflows=` (structural count) instead of `legacySubWorkflows=`. README inspect blurb updated. `bun run typecheck:server` and full `bun test` green.

**Tasks In Progress**: TASK-001 module 1 (authored schema / validator removal); module 3 visualization/TUI drill-down may still mention structural sub-workflows in dedicated panes.

**Blockers**: None.

### Session: 2026-04-25 (design reference cleanup + plan table)

**Tasks Completed**: Reviewed the working tree against
`design-auto-improve-superviser-mode.md` (phase 1/2 still match: engine loop,
`nestedSuperviserDriver`, `SuperviserRuntimeControl`, step-only nested rerun).
Removed a duplicate `architecture.md` line in the design doc **References** section
(leftover after replacing a deleted design-doc link). Updated this plan's module
table: runtime/control cleanup and `superviser-runtime-control-impl.ts` are
**In Progress** (nested superviser and auto-improve paths already exercise the
control layer; full removal of the internal direct-call layer indirection and
structural manager-control actions remains). The module-2 test command includes
`src/workflow/call-step-impl.test.ts`. `bun run
typecheck:server` and `bun test` (1045 pass) verified green on the pre-edit tree.

**Tasks In Progress**: TASK-001 module 1 (authored `WorkflowJson` / validator
still carry compatibility fields; module 2 checklist items like folding `call-step-impl` and structural manager-control actions remain).

**Blockers**: None.

### Session: 2026-04-26 (architecture check + plan sync for completed auto-improve phase 1)

**Tasks Completed**: Re-confirmed `design-auto-improve-superviser-mode.md` and `architecture.md` match the implementation (phase-1 `runAutoImproveLoop`, phase-2 `nestedSuperviserDriver` + `SuperviserRuntimeControl`, step-only `rerunFromStepId` on engine reruns and nested `divedra/rerun-workflow`). Full verification: `bun run typecheck:server` and `bun test` (1045 pass). Reviewed the working-tree diff: no supervision or nested-driver regressions identified; the large diff is consistent with the phase 133 direction (public step-only surfaces, removed legacy inspect fields, superviser hardening). Updated `impl-plans/completed/auto-improve-superviser-mode.md` so module 3 phase-2 checklist items and dependency/completion text reflect the **Completed** `auto-improve-superviser-workflow-phase-2` work instead of leaving phase 2 marked as TBD.

**Tasks In Progress**: Module 1 authored-schema / validator cutover; module 2 internal `call-node` merge and structural manager-control removal; modules 4–5 per checklists.

**Blockers**: None.

**Notes**: Unfinished work for this branch is **phase 133** (this plan), not additional auto-improve superviser features; optional nested-only patch-audit test matrix remains deferred per the completed phase-2 plan.

### Session: 2026-04-26 (review slice: manager-control normalization)

**Tasks Completed**: Reviewed the active diff with focus on control-plane parsing consistency. Tightened `src/workflow/manager-control.ts` so `retry-step`, `execute-optional-step`, `skip-optional-step`, and `replay-communication` trim identifier fields before scope validation, and optional `reason` text is normalized instead of preserving whitespace-only strings. Added focused regressions in `src/workflow/manager-control.test.ts` for trimmed ids/reasons and whitespace-only rejection. Verification: `bun run typecheck:server` and `bun test src/workflow/manager-control.test.ts src/workflow/engine.test.ts --runInBand` (124 pass).

**Tasks In Progress**: Module 1 authored-schema / validator cutover; module 2 runtime/control cleanup beyond this parser hardening.

**Blockers**: None.

**Notes**: The architecture/design still matches the intended phase-133 direction already documented in `design-docs/specs/architecture.md` and this plan. This iteration fixed local code quality and an edge-case bug rather than introducing a new design change.

### Session: 2026-04-26 (review slice: nested superviser legacy rerun targeting)

**Tasks Completed**: Reviewed the nested superviser follow-up against the active
phase-133 direction and found one compatibility-path bug rather than a design
mismatch: when a phase-2 nested superviser rerun omitted `rerunFromStepId` for a
legacy node-addressed target workflow, `resolveNestedSuperviserAddonRerunFromStepId`
looked at the unprojected workflow and could fall back to the manager/entry
anchor instead of preserving the current node id. Updated
`src/workflow/superviser.ts` to resolve the current execution location against
the projected step-addressed supervision graph when authored `steps[]` are
absent. Added regressions in `src/workflow/superviser.test.ts` and
`src/workflow/superviser-runtime-control-impl.test.ts`, including a real legacy
bundle fixture that verifies nested rerun dispatch keeps `worker-node` as the
rerun target. Verification: `bun run typecheck:server` and `bun test
src/workflow/superviser.test.ts src/workflow/superviser-runtime-control-impl.test.ts`
(28 pass).

**Tasks In Progress**: Module 1 authored-schema / validator cutover; module 2
runtime/control cleanup beyond this legacy-target rerun hardening.

**Blockers**: None.

**Notes**: The intended design still holds: supervision remediation and nested
`divedra/rerun-workflow` are step-addressed, with legacy node-addressed bundles
projected into that model only as a transitional compatibility path. This pass
fixed the projection boundary instead of changing the architecture.

### Session: 2026-04-26 (review slice: nested superviser mutable-bundle guard rails)

**Tasks Completed**: Re-checked the nested superviser control path against
`design-auto-improve-superviser-mode.md` and `architecture.md`. No architecture
change was needed: phase-2 control is still intentionally scoped to a single
target session plus mutable workflow bundle. Hardened
`src/workflow/superviser-runtime-control-impl.ts` so
`divedra/start-workflow`, `get-workflow-status`, `get-workflow-execution-details`,
`rerun-workflow`, `load-workflow-definition`, and
`save-workflow-definition` all verify the persisted target session belongs to
the expected workflow id before operating. Also removed parser duplication and
improved variable naming in `src/workflow/superviser-control.ts` by centralizing
authenticated-argument parsing. Added direct runtime-control regressions in
`src/workflow/superviser-runtime-control-impl.test.ts` for mutable bundle load,
mutable bundle save, and persisted workflow-id mismatch rejection. Verification:
`bun run typecheck:server` and `bun test src/workflow/superviser-control.test.ts src/workflow/superviser-runtime-control-impl.test.ts --runInBand`
(22 pass).

**Tasks In Progress**: Module 1 authored-schema / validator cutover; module 2
runtime/control cleanup beyond this target-session verification hardening.

**Blockers**: None.

**Notes**: This iteration addressed code quality, DRY, and an overlooked safety
check in the active implementation. The existing step-addressed/nested-superviser
design remains the correct architectural direction for phase 133.

### Session: 2026-04-26 (review slice: removed direct-call alias leftovers)

**Tasks Completed**: Reviewed the recent public-surface cleanup against the
current tree and found two remaining phase-133 leftovers after the direct-call
deprecation work. The local `call-step` CLI/parser/test path now treats
`--resume-step-exec` as the only supported continuation flag, consumes the
removed `--resume-node-exec` value before failing, and rejects the alias with
an explicit migration error. Refactored `rewriteCallStepFailureMessage()` to use
one replacement table instead of accumulating special-case chained rewrites, and
added regression coverage for the intermediate `direct call-step execution...`
wording. Also corrected `design-docs/specs/design-container-runtime-contract.md`
so the runtime section describes `call-step` rather than the deleted
`call-node` surface.

**Tasks In Progress**: Module 1 authored-schema / validator cutover; module 2
runtime/control cleanup beyond the deprecated direct-call alias and wording
removal.

**Blockers**: None.

**Notes**: This slice intentionally cleaned up residual parser/wiring drift
rather than changing architecture. Verification: `bun run typecheck:server`
and `bun test src/cli.test.ts src/workflow/call-step.test.ts src/workflow/call-step-impl.test.ts --runInBand`
(`114` pass). The broader compatibility model (`managerNodeId`,
`entryNodeId`, `workflowCalls`, structural `subWorkflows`) still remains on the
active phase 133 checklist.

## Related Plans

- **Previous**: `impl-plans/completed/step-addressed-workflow-runtime-cutover.md`
- **Previous**: `impl-plans/workflow-role-unification-structural-cleanup.md`
- **Completed (preserve behavior)**: `impl-plans/completed/auto-improve-superviser-workflow-phase-2.md`
- **Depends On**: completed step-addressed/runtime cleanup work already landed on this branch
