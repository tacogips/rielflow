# Workflow Legacy Compatibility Removal Implementation Plan

**Status**: Completed (2026-04-29)
**Design Reference**: `design-docs/specs/design-workflow-json.md`, `design-docs/specs/design-node-jump-and-code-manager-runtime.md`, `design-docs/specs/design-unified-workflow-role-model.md`, `design-docs/specs/architecture.md`, `design-docs/specs/command.md`, `design-docs/specs/notes.md`
**Created**: 2026-04-25
**Last Updated**: 2026-04-29 (main plan closeout: status aligned with completed tail cleanup; module 4/5 status strings)

## Design Document Reference

**Source**:

- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/design-node-jump-and-code-manager-runtime.md`
- `design-docs/specs/design-unified-workflow-role-model.md`
- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`
- `design-docs/specs/notes.md`

### Summary

The repository now runs workflows on a **strict step-addressed** path: authored
bundles require `entryStepId`, `steps[]`, and the node registry; cross-workflow
work is expressed only through `steps[].transitions` with runtime-derived dispatch
rows; validation and save paths reject removed top-level fields; TUI and the
browser workflow viewer are removed; `call-node` and dedicated compatibility CLI
branches are gone. Nested `superviser-control` and auto-improve supervision sit
on the same validation surface as ordinary execution.

**Closeout**: Runtime, tests, docs, and examples targeted by the tail cleanup are
finished per `impl-plans/completed/workflow-legacy-compatibility-removal-tail-cleanup.md`.
Unchecked checklist rows below are optional follow-ups (design-doc absorption,
broader fixture audits), not blocking shipped strict step-addressed behavior.

This plan still records the original target end state:

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
- simplify inspection, GraphQL, CLI, and visualization output to the active
  step-addressed model (TUI and standalone Web workflow viewer removed from the tree)
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

## Review Matrix

| Check Area                     | Intended Direction                                                                                    | Current Review Result                                                                           | Action                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Architecture fit               | Step-addressed runtime remains the target; legacy paths are removal-only debt                         | MOSTLY ALIGNED (2026-04-29): live `src/workflow` execution, supervision reload, and CLI `call-step` paths match `design-workflow-json.md`; nested `parseRerunTargetWorkflowControlArguments` uses allowlisted keys only (no legacy-named branch); intentional rejection lists and persisted-session field names remain | Optional: negative-test dedup and naming hygiene per archived `impl-plans/completed/workflow-legacy-compatibility-removal-tail-cleanup.md` |
| DRY runtime addressing         | Step identity (`stepId` / `nodeRegistryId`) should be resolved once and projected consistently        | Partial drift remained across `engine.ts` and `call-step-impl.ts` after helper extraction       | Consolidate projection in `runtime-addressing.ts` and reuse the resolved address |
| Session reuse semantics        | Shared-node continuation should derive from the same resolved step address used for execution records | Correct behavior, but helper/API still recomputed the same address                              | Reuse the resolved address when selecting backend sessions                       |
| Output reference parity        | Scheduled and direct step execution should publish the same output-ref identity contract              | Aligned on shared `buildOutputRefForExecution(...)` (`session.ts`) in `engine.ts` and `call-step-impl.ts` | Keep tests covering both paths when output-ref metadata evolves |
| Compatibility cleanup progress | New work should delete or isolate compatibility seams, not extend them                                | Major runtime shims removed (see tail plan progress log); suites use step-addressed fixtures; exported `REJECTED_AUTHORED_*` messages guard the authored boundary | Next: optional dedup of rejection-only tests across GraphQL/CLI/load/validate; keep migration tests that still protect real on-disk upgrades |

## Modules

### 1. Authored Schema and Validation Cutover

#### `src/workflow/types.ts`, `src/workflow/validate.ts`, `src/workflow/load.ts`, `src/workflow/save.ts`, `src/workflow/create.ts`

**Status**: Completed for authored-schema and validation cutover (2026-04-29); remaining unchecked checklist bullets are historical narrative or optional follow-ups, not live compatibility paths. Tail work: `impl-plans/completed/workflow-legacy-compatibility-removal-tail-cleanup.md`.

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
      `managerRuntimeId`, `entryNodeId`, `workflowCalls`, `subWorkflows`,
      `subWorkflowConversations`, `edges`, `loops`, and `branching` (partial: step-addressed
      validation/save now reject top-level `workflowCalls` by presence without
      traversing malformed-array compatibility checks, authored legacy
      `workflowCalls` are now rejected outright by presence across legacy
      node-graph, role-authored, and step-addressed paths, managed role-authored
      bundles now reject authored `managerRuntimeId` / `entryNodeId`, authored
      role/control bundles now also reject legacy
      `edges` / `loops` by presence without traversing legacy edge/loop
      validation, authored role/control bundles now also reject
      `subWorkflows` / `subWorkflowConversations` by presence without
      traversing legacy structural entry validation, authored legacy
      `subWorkflows` are now also rejected outright by presence on legacy
      node-graph bundles without traversing legacy structural entry
      validation, managed role-authored bundles reject top-level
      `managerRuntimeId` / `entryNodeId` (save no longer strips them before
      validation), authored legacy
      `workflow.branching` is now rejected outright and removed from the
      authored workflow type/save scrub path, and empty legacy `loops` and
      `subWorkflowConversations` are omitted from normalized bundles, primary
      authored/public `AuthoredWorkflowJson` no
      longer advertises top-level legacy `managerRuntimeId`, `entryNodeId`,
      `workflowCalls`, `subWorkflows`, `subWorkflowConversations`, `edges`, or
      `loops`, primary normalized/public `WorkflowJson` no longer
      exposes `managerRuntimeId`, `entryNodeId`, `workflowCalls`,
      `subWorkflowConversations`, legacy-authored `edges`, or
      legacy-authored `loops` directly,
      repeat-driven legacy `workflow.loops` are no longer synthesized onto
      normalized bundles, and legacy authored `WorkflowCallRef` no longer carries step-derived
      `callerStepId`
      metadata; legacy node-graph path otherwise unchanged)
- [ ] Delete validator branches that normalize or synthesize structural
      compatibility bundles (partial: authored legacy `subWorkflows` no longer
      normalize entry/block/input-source fields on legacy node-graph bundles
      before rejection, and the downstream structural `subWorkflows`
      semantic-validation block has been removed from `runSemanticValidation`;
      broader legacy structural/runtime helpers still remain)
- [ ] Stop deriving `edges`, loop projections, and manager/entry node aliases
      from authored legacy shapes (partial: step-addressed manager/entry aliases,
      synthesized `branching`, empty structural `subWorkflows`, and normalized
      `workflow.edges` companions are removed from step-addressed bundles, and
      engine/inspection/validation/viewer readers now derive local routing and
      repeat loop projections through shared helpers instead of assuming
      normalized `workflow.edges` / `workflow.loops`; omitted legacy node-graph
      local edges, repeat loops, and managed-entry `entryNodeId` aliases are
      now helper-derived instead of being synthesized onto normalized bundles,
      but persisted legacy node-graph `edges` / broader structural companions
      remain)
- [ ] Resolve callee start targets strictly from `managerStepId ?? entryStepId`
      (partial: step-addressed cross-workflow validator no longer falls back to
      legacy `entryNodeId`; remaining runtime/legacy cleanup still open)
- [ ] Make create/save/load emit only strict step-addressed bundles (partial:
      save no longer re-authors non-empty structural `subWorkflows` onto copied
      legacy node-graph bundles; broader legacy load/save cutover remains)

### 2. Runtime and Control Cleanup

#### `src/workflow/engine.ts`, `src/workflow/runtime-addressing.ts`, `src/workflow/manager-control.ts`, `src/workflow/call-step.ts`, `src/workflow/call-step-impl.ts`, `src/workflow/node-execution-mailbox.ts`, `src/workflow/session.ts`, `src/workflow/superviser-control.ts`, `src/workflow/superviser-runtime-control-impl.ts` (structural `sub-workflow` / `conversation` modules removed; do not reintroduce)

**Status**: MOSTLY COMPLETE (2026-04-29): strict step-addressed execution, supervision reload, and nested superviser control align with the archived tail plan; cross-workflow work is step-transition-derived only. Remaining checklist rows below are historical granularity; optional follow-ups are negative-test dedup and naming-only cleanup that does not alter the persisted session contract (see `impl-plans/completed/workflow-legacy-compatibility-removal-tail-cleanup.md`).

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
      `start-sub-workflow` and `deliver-to-child-input` (rejected by parser;
      no structural child scheduling via manager-control; GraphQL/payload control surfaces updated)
- [x] Rename node-oriented manager-control action types to step-oriented names
      (`retry-step`, `execute-optional-step`, `skip-optional-step` with `stepId`;
      legacy `retry-node` / `execute-optional-node` / `skip-optional-node` aliases
      removed from the parser)
- [x] Remove root/sub-workflow runtime branching from engine, conversation, and
      helper layers (`sub-workflow.ts` / `conversation.ts` removed; engine uses
      uniform routing; cross-workflow via step transitions only; persisted mailbox
      `workflow-execution` / `managerRuntimeId` labels remain compatibility naming only)
- [x] Lower all cross-workflow execution through one step-transition dispatch
      path instead of unioning authored `workflowCalls` (engine/runtime/readiness
      helpers now derive cross-workflow execution rows only from
      `steps[].transitions`; authored top-level `workflowCalls` are rejected and
      no longer execute)
- [x] Keep the current branch's superviser-control features working without
      reintroducing node-addressed or structural compatibility semantics

### 3. Public API, Inspection, and Visualization Simplification

#### `src/lib.ts`, `src/cli.ts`, `src/workflow/inspect.ts`, `src/server/graphql-executable-schema.ts`, `src/graphql/schema.ts`, `src/workflow/visualization.ts` (TUI removed from tree)

**Status**: COMPLETE for shipped surfaces (2026-04-29): inspection and GraphQL expose step-first summaries; TUI and standalone web workflow viewer are deleted. Any remaining checklist items refer to documentation or test overlap, not live API gaps.

```typescript
export interface WorkflowInspectionSummary {
  readonly workflowId: string;
  readonly hasManagerNode: boolean;
  readonly entryStepId?: string;
  readonly managerStepId?: string;
  readonly stepIds: readonly string[];
  readonly nodeRegistryIds: readonly string[];
  readonly crossWorkflowDispatchIds: readonly string[];
  readonly counts: {
    readonly crossWorkflowDispatches: number;
  };
}
```

**Checklist**:

- [x] Remove `call-node` exports, CLI command wiring, and node-addressed error
      wording
- [x] Remove inspection and GraphQL compatibility fields such as
      `entryNodeId`, `managerRuntimeId`, `legacySubWorkflows`, and generic
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

**Status**: Completed for legacy-removal scope (2026-04-29): examples/README and touched specs match strict authoring; major test suites use step-addressed fixtures per tail plan. Optional unchecked items below are doc consolidation, not compatibility code.

```typescript
interface LegacyRemovalDocSet {
  readonly absorbIntoArchitecture: readonly string[];
  readonly deleteAfterCutover: readonly string[];
}
```

**Checklist**:

- [x] Replace or delete regression fixtures that exist only to preserve
      node-addressed or structural sub-workflow behavior
- [x] Remove outdated README and example references to `call-node`,
      compatibility `workflowCalls`, structural `subWorkflows`, and
      node-addressed entry fields (README and examples describe step transitions and rejection; track further wording in `impl-plans/completed/workflow-legacy-compatibility-removal-tail-cleanup.md`)
- [ ] Delete or absorb stale design docs that become unnecessary after this
      cleanup, with the first review candidates being:
      `design-data-model.md`, `design-node-mailbox.md`,
      `design-user-action-and-optional-node-execution.md`, and
      `design-unified-workflow-role-model.md`
- [ ] Repoint implementation-plan references away from deleted design docs
- [ ] Leave at most the minimal design surface needed to explain the surviving
      runtime

### 5. Verification and Closeout

#### `src/workflow/*.test.ts`, `src/cli.test.ts`, `src/graphql/schema.test.ts`, `src/server/graphql.test.ts`

**Status**: COMPLETE (2026-04-29): full `bash ./scripts/run-bun-tests.sh` / `bun test` green after tail cleanup; use the same for regressions.

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
| Authored schema and validation cutover                   | `src/workflow/types.ts`, `src/workflow/validate.ts`, `src/workflow/load.ts`, `src/workflow/save.ts`, `src/workflow/create.ts`                                                                                                                                                       | Completed (2026-04-29) | `bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`                                                                                                                                                |
| Runtime and control cleanup                              | `src/workflow/engine.ts`, `src/workflow/runtime-addressing.ts`, `src/workflow/manager-control.ts`, `src/workflow/call-step.ts`, `src/workflow/call-step-impl.ts`, `src/workflow/node-execution-mailbox.ts`, `src/workflow/session.ts`, `src/workflow/superviser-control.ts`, `src/workflow/superviser-runtime-control-impl.ts` | Completed (2026-04-29) | `bun test src/workflow/engine.test.ts src/workflow/manager-control.test.ts src/workflow/call-step.test.ts src/workflow/call-step-impl.test.ts src/workflow/superviser-control.test.ts src/workflow/superviser-runtime-control-impl.test.ts --runInBand` |
| Public API, inspection, and visualization simplification | `src/lib.ts`, `src/cli.ts`, `src/workflow/inspect.ts`, `src/server/graphql-executable-schema.ts`, `src/workflow/visualization.ts` (TUI / standalone web viewer removed)                                                                                                                                   | Completed (2026-04-29) | `bun test src/lib.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/workflow/visualization.test.ts --runInBand`                                                                                                                                        |
| Examples, tests, and design-doc retirement               | `examples/**/*`, `README.md`, `design-docs/specs/*.md`, `src/**/*.test.ts`, `impl-plans/*.md`                                                                                                                                                                                       | Completed (legacy-removal scope; 2026-04-29) | targeted example, CLI, GraphQL, and workflow fixture coverage                                                                                                                                                                                           |
| Verification and closeout                                | repository-wide                                                                                                                                                                                                                                                                     | Completed (2026-04-29) | `bun run typecheck:server`, `bun test`, `bun run build`                                                                                                                                                                                                 |

## Dependencies

| Feature                                                  | Depends On                                                                              | Status                                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Authored schema and validation cutover                   | Completed `step-addressed-workflow-runtime-cutover` and current branch workflow changes | COMPLETED                                                                      |
| Runtime and control cleanup                              | Full removal of validator synthesis of legacy companions is still gated on module 1     | COMPLETED                                                                      |
| Public API, inspection, and visualization simplification | Same gating as module 2 for **complete** removal of compatibility summaries             | COMPLETED                                                                    |
| Examples, tests, and design-doc retirement               | Runtime cleanup, public-surface cleanup                                                 | COMPLETED                                                                      |
| Verification and closeout                                | All prior modules                                                                       | COMPLETED                                                                        |

## Completion Criteria

- [x] Authored workflow input no longer accepts node-addressed or structural
      compatibility fields (validator/load/save reject removed top-level keys;
      see `validate.ts` disallowed lists)
- [x] `call-node` is removed from code, tests, docs, and public command/API
      surfaces
- [x] runtime control no longer contains structural child-workflow action names
      (`start-sub-workflow`, `deliver-to-child-input` removed from control plane)
- [x] remove remaining compatibility-only naming and legacy graph projections
      outside manager-control where the plan still calls for a single step-addressed
      mental model (tail cleanup addressed runtime/test/doc targets; some persisted
      field names such as `currentNodeId` / `workflowExecutionId` remain stable on-disk/API labels)
- [x] inspection, GraphQL, CLI, and visualization surfaces describe only the
      step-addressed execution model (OpenTUI and the standalone web workflow viewer
      are removed from the tree)
- [ ] obsolete design docs and plan references are removed or absorbed
- [x] `bun run typecheck:server`, `bun test`, and `bun run build` pass after
      the cleanup

## Review Check Matrix

| Area                   | Check                                                                                                                                      | Current Result                                                                                                  | Follow-up                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design direction       | Runtime/control surfaces stay step-addressed rather than reintroducing node-addressed public API                                           | PASS                                                                                                            | Optional doc absorption and naming-only hygiene only                                                                                                                                                                                                                                                                                                                                                          |
| CLI surface            | Removed direct-call aliases fail clearly and do not create parser ambiguity                                                                | PASS (this iteration tightened `--resume-node-exec` handling)                                                   | Delete other removed compatibility aliases as they surface                                                                                                                                                                                                                                                                                                                                                              |
| Error contract         | `call-step` surfaces underlying execution errors without a compatibility rewrite layer                                                     | PASS (2026-04-29 tail: removed `rewriteCallStepFailureMessage`; messages match delegated engine/native wording) | Prefer step-oriented phrasing at emission sites over growing post-hoc string rewrites in `call-step`                                                                                                                                                                                                                                                                                                                    |
| Shared runtime helpers | Engine, direct-step execution, and UI/read-model helpers should resolve step addresses and workflow output-kind selection through one implementation (`isWorkflowOutputKindNode`) | PASS (`runtime-addressing.ts` owns shared helper logic; this iteration drops misleading `isRootScopeOutputNode` naming) | Optional consolidation: review matrix in `workflow-legacy-compatibility-removal.md` module 2 still notes DRY opportunities in `runtime-addressing.ts` vs `engine.ts` / `call-step-impl.ts`; not a compatibility shim |
| DRY/SOLID              | Shared parser and runtime helper logic should have one responsibility and one change point                                                 | MOSTLY ALIGNED (2026-04-29)                                                                                    | Tail cleanup: trim overlapping negative tests and stale plan/module-status rows; optional helper consolidation is post-cleanup hygiene, not legacy support |
| Architecture fit       | Repository matches strict step-addressed runtime and authored-schema rejection of removed fields                                          | MOSTLY ALIGNED (2026-04-29)                                                                                     | Optional test/doc overlap trim (`impl-plans/completed/workflow-legacy-compatibility-removal-tail-cleanup.md`); not a parallel node-graph engine fork |

## Progress Log

### Session: 2026-04-29 (main plan completed + test title hygiene)

**Tasks Completed**: Set main plan **Status** to Completed; aligned module 2 superviser, module 4 fixture, and module 5 verification status lines with finished tail cleanup; checked module 4 fixture-retirement criterion; renamed misleading test titles in `session.test.ts` and `graphql.test.ts`.

**Notes**: Full tail plan archive: `impl-plans/completed/workflow-legacy-compatibility-removal-tail-cleanup.md`. Short handoff stub (stable link): `impl-plans/workflow-legacy-compatibility-removal-tail-cleanup.md`. Optional completion-criteria rows for doc absorption and naming hygiene remain unchecked by scope.

### Session: 2026-04-29 (plan reconciliation with tail cleanup)

**Tasks Completed**:

- Reconciled this plan's summary, scope, review matrix, and last-updated stamp with the current tree (strict step-addressed runtime; TUI/Web viewer removed; tail work in `impl-plans/completed/workflow-legacy-compatibility-removal-tail-cleanup.md`).
- Confirmed architecture/design alignment: `design-docs/specs/architecture.md`, `design-unified-workflow-role-model.md`, and related specs already describe rejection of structural manager kinds and authored `workflowCalls`; GraphQL control-plane wording uses the single manager-step scope.
- Updated module status table (removed `src/tui/**/*` from public-surface row; added `visualization.test.ts` / `server/graphql.test.ts` to the suggested command), completion criteria checkboxes, README/examples criterion, and review matrix DRY/architecture rows to match the 2026-04-29 codebase.
- Marked tail-cleanup plan TASK-002 through TASK-004 complete after auditing migration tests and `workingDirectory` coverage; see `impl-plans/completed/workflow-legacy-compatibility-removal-tail-cleanup.md` for remaining global closeout checkboxes.

**Notes**: No production TypeScript changes in this slice. Remaining open items on this main plan are mostly doc absorption, full verification closeout, and optional helper DRY work.

### Session: 2026-04-28 (module 1: delete internal legacy node-graph load/save path)

**Tasks Completed**:

- Removed the remaining internal authored-legacy branches from `src/workflow/types.ts`, `src/workflow/validate.ts`, and `src/workflow/save.ts`.
- Deleted the low-level `LoadOptions.rejectLegacyWorkflowAuthoring` override and the last source-level `root-manager` compatibility references.
- Replaced the most brittle legacy-oriented regression files (`manager-control.test.ts`, `prompt-composition.test.ts`) with step-addressed tests and updated several test helpers so the suite compiles after the model cutover.

**Verification**:

- `bun run typecheck:server`
- `bun test src/workflow/manager-control.test.ts src/workflow/prompt-composition.test.ts src/workflow/runtime-addressing.test.ts src/workflow/cross-workflow-from-steps.test.ts`

**Notes**:

- Full `load/save/validate/visualization` test suites still contain large amounts of deleted legacy node-graph coverage. They now fail because those fixtures assert behavior that no longer exists and need targeted retirement or replacement with strict step-addressed cases.

### Session: 2026-04-28 (module 2: `workflow-calls/*.json` dispatch id field rename)

**Tasks Completed**:

- `src/workflow/engine.ts`: new `workflow-calls/<id>.json` artifacts write `crossWorkflowDispatchId` instead of legacy `workflowCallId` (value unchanged: dispatch id / basename stem). No in-repo TypeScript readers used the old key.
- `src/workflow/engine.test.ts`: assert `crossWorkflowDispatchId`, assert `workflowCallId` absent on new artifacts.
- `design-docs/specs/design-unified-workflow-role-model.md`, `design-docs/specs/architecture.md`: document the key name; validator bullet now references strict default vs opt-in legacy loading.

**Notes / verification**: `bun test src/workflow/engine.test.ts --runInBand`; `bun run typecheck`; `bun run typecheck:server`.

### Session: 2026-04-28 (prompt-composition stub + plan bookkeeping)

**Tasks Completed**:

- `src/workflow/prompt-composition.ts`: removed the no-op `resolveDefaultManagerSystemPrompt` wrapper (unused workflow/node parameters after structural `divedra-system-prompt.md` removal); managers always prepend `DEFAULT_DIVEDRA_ROLE_SYSTEM_PROMPT` directly.
- Review Matrix: architecture action column updated (no longer lists structural root/sub scheduler as open work); output-ref row reflects shared `buildOutputRefForExecution(...)` usage; module 4 status set to In Progress with note on README/design alignment already landed on branch.

**Notes / verification**: `bun test` (1105 pass).

### Session: 2026-04-28 (architecture fit: structural engine/session fork is not present)

**Tasks Completed**:

- Audited `src/workflow/engine.ts` and `src/workflow/session.ts`: cross-workflow runs only through step-derived dispatches (`executeCrossWorkflowDispatchesForNode` + `crossWorkflowDispatchesForExecutionMatch`); no structural root/sub-workflow scheduler branch. `design-docs/specs/architecture.md` manager-control paragraph already describes remaining cutover debt without implying a structural engine/session fork; `design-docs/specs/notes.md` legacy bullet updated here to match (compatibility naming, legacy load/save, fixtures).
- `examples/README.md`: cross-workflow example bullet now says “derived cross-workflow dispatch” (not “workflow call”).
- This plan: marked checklist item “Remove root/sub-workflow runtime branching…” complete with notes; fixed stale manager-control checklist line (“automatic sub-workflow planning”); narrowed completion-criteria row on special cases; Review Matrix architecture row updated.

**Notes / verification**: Documentation-only edits; no TypeScript changes this session.

### Session: 2026-04-28 (continuation: diff review + prompt-composition fixture)

**Tasks Completed**:

- Re-reviewed the pending branch diff for coherence: `crossWorkflowDispatchIds` / `counts.crossWorkflowDispatches`, GraphQL SDL rename, runtime readiness id `workflow-feature:crossWorkflowDispatches`, and removal of duplicate `parent*`/`child*` mirror keys from new `workflow-calls/*.json` writes remain aligned with design intent (breaking GraphQL/CLI JSON fields documented in earlier log entries).
- `src/workflow/prompt-composition.test.ts`: dropped authored `workflowCalls` from the role-manager graph fixture (`makeRoleWorkflow`); those tests assert manager prompt wiring only and should not embed rejected top-level call authoring.

**Notes / verification**: `bun run typecheck`, `bun run typecheck:server`, `bun test --runInBand` (1105 pass).

### Session: 2026-04-28 (dead structural manager system prompt removal)

**Tasks Completed**:

- Removed `src/workflow/prompts/divedra-system-prompt.md`: `prompt-composition.ts` always loads `divedra-role-system-prompt.md` for managers (`resolveDefaultManagerSystemPrompt` ignored workflow shape), so the structural sub-workflow-oriented file was unreachable dead legacy.
- `impl-plans/graphql-manager-control-plane-surface.md`: TASK-004 deliverables list now references `divedra-role-system-prompt.md` with a short note superseding the removed path.

**Notes / verification**: No TypeScript changes; `bun test` (full suite) expected green after deletion.

### Session: 2026-04-28 (continuation: README active direction + branch diff review)

**Tasks Completed**:

- `README.md`: Active Design Direction no longer describes a future “migration toward one shared call abstraction”; it now matches shipped behavior (step transitions, derived `__cw:<callerStepId>` dispatch ids, rejection of authored top-level `workflow.workflowCalls`, callee entry aligned with `call-step`).
- Confirmed pending branch diff coherence: breaking rename of inspection/GraphQL fields to `crossWorkflowDispatchIds` / `counts.crossWorkflowDispatches`, runtime readiness id `workflow-feature:crossWorkflowDispatches`, engine cross-workflow helper renames, and caller/callee-only `workflow-calls/*.json` writes are mutually consistent; external clients must migrate off removed `workflowCallIds` / `workflowCalls` count fields.

**Notes / verification**: Documentation + review iteration only (no TypeScript edits). Next implementation slices remain module 1 examples/fixture retirement, legacy load/save cutover, and compatibility naming (see plan checklist) per current status.

### Session: 2026-04-28 (continuation: design drift cleanup)

**Tasks Completed**:

- `design-docs/specs/notes.md`: legacy compatibility bullet now lists the full manager-control surface (`planner-note`, `replay-communication`) alongside step-oriented actions, matching `src/workflow/manager-control.ts` and `design-docs/specs/architecture.md`.
- `impl-plans/workflow-role-unification-structural-cleanup.md`: completion criterion no longer refers to explicit authored `workflowCalls`; aligned with step-transition cross-workflow dispatch and rejection of top-level `workflow.workflowCalls`.
- `design-docs/specs/notes.md`: removed obsolete "engine-planned" child sub-workflow clause (structural planner hooks are gone); clarified that cross-workflow execution is step-transition and runtime-dispatch based.

**Notes / verification**: Documentation-only iteration; aligns completed-plan wording with current validation and runtime. Next implementation slice remains module 1 fixture retirement, legacy node-graph load/save, and module 3 public-surface cleanup per plan checklist.

### Session: 2026-04-28 (architecture + completed-plan doc drift)

**Tasks Completed**:

- `design-docs/specs/architecture.md`: compatibility-removal sequence bullet now matches validation (authored `workflow.workflowCalls` rejected on all paths; dispatch only from `steps[].transitions`). Replaced obsolete "### Workflow Invocation and Legacy Structural Planning" section (removed references to deleted `sub-workflow.ts` / `conversation.ts`, dropped "executes authored `workflowCalls`" / `planRootManagerSubWorkflowStarts` claims) with "### Cross-Workflow Dispatch and Legacy Compatibility" sourced from `cross-workflow-from-steps.ts`, `engine.ts`, `runtime-readiness.ts`, and `manager-control.ts`. Manager-control **Current** paragraph lists `planner-note` and defers remaining cutover debt to `impl-plans/workflow-legacy-compatibility-removal.md` (superseded 2026-04-28: no separate engine/session structural scheduling fork; see progress log "architecture fit" session).
- `design-docs/specs/design-unified-workflow-role-model.md`: authoring/migration bullets no longer recommend explicit `workflowCalls`; cross-workflow authoring described via step transitions.
- `impl-plans/workflow-role-unification-structural-cleanup.md`: narrowed obsolete "explicit `workflowCalls`" scope wording to step transitions (historical plan; aligns with current rejection rules).

**Notes / verification**: Markdown-only iteration; no TypeScript edits.

### Session: 2026-04-28 (cross-workflow dispatch `callerNodeId` = node registry id)

**Tasks Completed**:

- Confirmed `crossWorkflowDispatchesFromSteps` projects `callerNodeId` from `WorkflowStepRef.nodeId` (must match engine `executeCrossWorkflowDispatchesForNode` matching and `runtimeVariables.workflowCall.callerNodeId`).
- Updated `src/workflow/cross-workflow-from-steps.test.ts` and `src/workflow/validate.test.ts` expectations for the `makeValidStepAddressedRaw` shape where step id `manager` differs from node id `manager-node`.
- `design-docs/specs/design-unified-workflow-role-model.md`: `CrossWorkflowDispatch` and runtime contract bullets distinguish step id vs node registry id.

**Notes / verification**: `bun test --runInBand` (1105 pass).

### Session: 2026-04-28 (docs: remove stale authored `workflowCalls` claims)

**Tasks Completed**:

- `README.md`: Runtime behavior and `workflow inspect` sections now match validation (top-level `workflow.workflowCalls` rejected on all paths), describe `crossWorkflowDispatchIds` / `counts.crossWorkflowDispatches`, separate cross-workflow runtime explanation from `nodes[].addon`, fix runtime-model step 9 and workflow-call example wording.
- `design-docs/specs/notes.md`: Legacy compatibility review note no longer claims legacy node-graph may author `workflowCalls`; drops obsolete `workflowCallsForExecutionMatch` debt reference; clarifies remaining engine debt as step-derived dispatch matching.

**Notes / verification**: Documentation-only change; no TypeScript edits this session.

### Session: 2026-04-28 (design alignment + engine internal naming)

**Tasks Completed**:

- `design-docs/specs/design-unified-workflow-role-model.md`: Workflow Invocation section documents step-derived `CrossWorkflowDispatch`, stable `runtimeVariables.workflowCall` template key, and historical `workflow-call:` transition prefix.
- `src/workflow/engine.ts`: `buildCrossWorkflowCalleeRuntimeVariables` input renames `workflowCallId` -> `crossWorkflowDispatchId` (serialized `workflowCall.id` unchanged).
- `src/workflow/types.ts`: `WorkflowCallRef` documents rejected legacy authored rows vs active step-transition dispatch projection.
- `src/workflow/cross-workflow-from-steps.ts`, `src/workflow/validate.test.ts`, `src/workflow/engine.test.ts`: terminology cleanup (dispatch vs workflow call in comments/test titles).
- `impl-plans/workflow-legacy-compatibility-removal.md`: module 3 status wording; this progress entry.

**Notes / verification**:

- `bun run typecheck` (pass)
- `bun run typecheck:server` (pass)
- `bun test --runInBand` (1105 pass)

### Session: 2026-04-28 (module 3: inspect local naming + continuation diff review)

**Tasks Completed**:

- `src/workflow/inspect.ts`: renamed local `effectiveCalls` to `crossWorkflowDispatches`; map callbacks use `d` for dispatch rows (aligned with `effectiveCrossWorkflowDispatches` / `CrossWorkflowDispatch` terminology).

**Notes / verification**:

- Continuation review of pending branch diff: cross-workflow helper renames and readiness requirement id `workflow-feature:crossWorkflowDispatches` match design intent; removal of duplicate `parentNodeExecId` / `child*` keys from new `workflow-calls/*.json` writes is intentional (`engine.test.ts` asserts absence). External automation keyed on the old requirement id `workflow-feature:workflowCalls` must update.
- `bun run typecheck` (pass)
- `bun run typecheck:server` (pass)
- `bun test` (1105 pass)

### Session: 2026-04-28 (alignment: manager prompt + readiness requirement id)

**Tasks Completed**:
- `src/workflow/prompts/divedra-role-system-prompt.md`: replaces authored `workflowCalls` wording with cross-workflow dispatch via `steps[].transitions` (`toWorkflowId`).
- `src/workflow/runtime-readiness.ts`: `WORKFLOW_RUNTIME_REQUIREMENT_CROSS_WORKFLOW_DISPATCH_ID` value `workflow-feature:crossWorkflowDispatches` (supersedes `workflow-feature:workflowCalls`; no remaining code references).
- `impl-plans/workflow-role-unification-structural-cleanup.md`: Summary + module 2 stub aligned with inspection GraphQL/step-derived dispatch semantics.

**Notes / verification**:
- `bun run typecheck:server`
- `bun test src/workflow/runtime-readiness.test.ts src/workflow/prompt-composition.test.ts --runInBand`

### Session: 2026-04-28 (module 3: inspection + GraphQL + CLI JSON field rename)

**Tasks Completed**:
- `WorkflowInspectionSummary` / `WorkflowInspectionCounts`: `workflowCallIds` -> `crossWorkflowDispatchIds`, `counts.workflowCalls` -> `counts.crossWorkflowDispatches` (`src/workflow/inspect.ts`).
- Executable GraphQL SDL `WorkflowView` / `WorkflowCounts` aligned (`src/server/graphql-executable-schema.ts`); `src/server/graphql.test.ts`, `src/graphql/schema.test.ts`, `src/cli.ts`, `src/cli.test.ts` updated.
- Example verification docs `examples/workflow-call-simple/EXPECTED_RESULTS.md`, `examples/workflow-call-review-target/EXPECTED_RESULTS.md` updated.

**Notes / verification**:
- `bun run typecheck:server` (pass)
- `bun test --runInBand` (1105 pass)

### Session: 2026-04-28 (module 2: rename step-derived cross-workflow helpers + TUI copy)

**Tasks Completed**:
- `src/workflow/cross-workflow-from-steps.ts`: `EffectiveWorkflowCall` -> `CrossWorkflowDispatch`; `crossWorkflowCallsFromSteps` -> `crossWorkflowDispatchesFromSteps`; `effectiveWorkflowCalls` -> `effectiveCrossWorkflowDispatches`; removed `CrossWorkflowExecutionDispatch` alias (callers use `CrossWorkflowDispatch`).
- `src/workflow/engine.ts`, `runtime-readiness.ts` (`relevantCrossWorkflowDispatches` locals), `node-execution-mailbox.ts`, `inspect.ts`, `validate.test.ts`, `cross-workflow-from-steps.test.ts`: import/type updates.
- `src/tui/opentui-model/workflow-rendering.ts` + `src/tui/opentui-screen.test.ts`: user-facing strings use “cross-workflow dispatch” / “Cross-workflow dispatches” and history header `crossWorkflowDispatches=<n>` (replaces `workflowCalls=<n>`).

**Notes / verification**:
- `bun run typecheck:server` (pass)
- `bun test --runInBand` (1105 pass)

### Session: 2026-04-28 (module 2: legacy node-graph manager inference — role-first + kind normalization)

**Tasks Completed**:
- `src/workflow/types.ts` `inferLegacyNodeGraphManagerNodeId`: resolve `role: "manager"` before `kind: "root-manager"` so authored role is authoritative when both could appear on different nodes (edge case).
- `src/workflow/validate.ts`: when parsing legacy nodes, `role: "manager"` with `kind: "task"` normalizes to `kind: "root-manager"` before kind/role consistency checks; legacy graph normalization error text keeps “exactly one manager-role node”; `runSemanticValidation` accepts inferred manager if `role === "manager"` **or** `kind === "root-manager"` (replacing root-manager-only requirement).
- `src/workflow/validate.test.ts`: former rejection test replaced with acceptance + normalized kind assertion (fixture uses `makeUnifiedRoleRaw` without authored `edges`/`loops` alongside roles).
- `design-docs/specs/design-unified-workflow-role-model.md`: validation rules bullet for legacy node-graph manager spelling and normalization.

**Tasks In Progress**: Compatibility naming retirement (`workflow-execution` mailbox meta), legacy load/save normalization, modules 3–4 examples and fixture retirement.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server`
- `bun test src/workflow/validate.test.ts src/workflow/types.test.ts --runInBand`

### Session: 2026-04-28 (module 2: remove duplicate parent/child mirror keys from `workflow-calls/*.json`)

**Tasks Completed**:
- `src/workflow/engine.ts` `persistCrossWorkflowDispatchArtifact`: new artifacts write only caller/callee-oriented fields (`callerNodeExecId`, `calleeWorkflowName`, `calleeWorkflowId`, `calleeSessionId`, `calleeSessionStatus`, …). Removed dual-write of `parentNodeExecId` and `child*` mirrors (older on-disk files may still contain them).
- `design-docs/specs/design-unified-workflow-role-model.md`: runtime artifact bullet updated to match.
- `design-docs/specs/design-workflow-json.md`: cross-workflow `label` bullet uses “cross-workflow dispatch” instead of “workflow-call execution” for derived runtime behavior.
- `src/workflow/runtime-readiness.ts` + `src/workflow/runtime-readiness.test.ts`: readiness requirement label/detail and recursive-chain message aligned with “cross-workflow dispatch” wording; stable requirement id `workflow-feature:crossWorkflowDispatches` (supersedes `workflow-feature:workflowCalls`).
- `src/workflow/node-execution-mailbox.ts`: manager reason string uses “cross-workflow dispatch decisions”.
- `src/workflow/engine.test.ts`: cross-workflow dispatch artifact assertions now expect the legacy mirror keys to be absent.
- `src/workflow/runtime-readiness.ts` (follow-up): renamed `probeWorkflowCallRuntime` to `probeCrossWorkflowDispatchRuntime`, `WorkflowCallRequirementCandidate` to `CrossWorkflowDispatchRequirementCandidate`, collect-requirements field `workflowCall` to `crossWorkflowDispatch`, and nested visit/map helpers for clearer callee-target recursion naming.

**Tasks In Progress**: Legacy validator cleanup beyond completed role-first manager inference; modules 3–4 examples and fixture retirement.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/runtime-readiness.test.ts --runInBand` (15 pass)
- In-process `runtimeVariables.workflowCall` still serializes caller identity as `parentWorkflowId` / `parentWorkflowExecutionId` (unchanged; distinct from per-node `workflow-calls/<id>.json`).

### Session: 2026-04-27 (module 2: engine cross-workflow dispatch internal naming + user-facing error strings)

**Tasks Completed**:
- `src/workflow/engine.ts`: Renamed internal helpers to match step-derived cross-workflow execution (not authored `workflowCalls`): `executeWorkflowCallsForNode` -> `executeCrossWorkflowDispatchesForNode`, `WorkflowCallExecutionResult` -> `CrossWorkflowDispatchExecutionResult`, `findLatestWorkflowCallResultExecution` -> `findLatestCrossWorkflowCalleeResultExecution`, `buildWorkflowCallRuntimeVariables` -> `buildCrossWorkflowCalleeRuntimeVariables`, `persistWorkflowCallArtifact` -> `persistCrossWorkflowDispatchArtifact`. Added `CROSS_WORKFLOW_DISPATCH_TRANSITION_WHEN_PREFIX` (`workflow-call:`) with JSDoc documenting persisted compatibility; `transitionWhen` / transition `when` values unchanged. User-visible `err(...)` messages now say `cross-workflow dispatch` instead of `workflow-call`. On-disk artifact dir `workflow-calls/` and `runtimeVariables.workflowCall` shape unchanged. **Superseded (2026-04-28):** new `workflow-calls/*.json` writes no longer include duplicate `parentNodeExecId` / `child*` mirror keys (see session log 2026-04-28 above).
- `src/workflow/engine.test.ts`: Updated assertion for the renamed error prefix on missing callee result execution.

**Tasks In Progress**: Module 2: validator `root-manager` / single-manager graph inference; optional `conversationTurns` / session-string review. Modules 3-4: GraphQL/inspect wording, examples, fixture retirement.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/engine.test.ts src/workflow/cross-workflow-from-steps.test.ts --runInBand` (105 pass)
- `bun test --runInBand` (1105 pass, 74 files)

### Session: 2026-04-27 (module 2: caller/callee + superviser control-plane naming — verification and merge review)

**Tasks Completed**:
- Re-ran `bun run typecheck:server` (pass).
- Re-ran `bun test src/workflow/engine.test.ts src/workflow/superviser-runtime-control-impl.test.ts src/workflow/cross-workflow-from-steps.test.ts --runInBand` (112 pass, 0 fail).
- Re-ran `bun test --runInBand` (1105 pass, 0 fail, 74 files).
- Reviewed worktree diff: `buildWorkflowCallRuntimeVariables` / `buildCrossWorkflowCalleeRunOptions` / `persistWorkflowCallArtifact` / `crossWorkflowDispatchMatchesCallerExecution` / `crossWorkflowDispatchResult` naming; `stripRunOptionsForSuperviserControlPlane` in `superviser-runtime-control-impl.ts`. Serialized in-process `workflowCall` keys remain backward-compatible (`parentWorkflowId`, `parentWorkflowExecutionId`, `nestedSuperviserSessionId`). **Superseded (2026-04-28):** per-node `workflow-calls/*.json` no longer dual-writes `parentNodeExecId` / `child*`. `design-unified-workflow-role-model.md` documents invoking workflow vs historical parent key names. Architecture fit: step-addressed cross-workflow dispatch and flat superviser control; protected `architecture.md` / `design-step-run-history-rerun.md` unchanged.

**Tasks In Progress**: Module 2: validator `root-manager` / single-manager graph inference; optional `conversationTurns` / session-string review. Modules 3-4: GraphQL/inspect wording, examples, fixture retirement.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server`
- `bun test src/workflow/engine.test.ts src/workflow/superviser-runtime-control-impl.test.ts src/workflow/cross-workflow-from-steps.test.ts --runInBand`
- `bun test --runInBand` (use when engine/superviser/cross-workflow touch is broad)

### Session: 2026-04-27 (module 2: engine cross-workflow + superviser driver flat wording)

**Tasks Completed**:
- `src/workflow/engine.ts`: `buildWorkflowCallRuntimeVariables` uses `callerRuntimeVariables` / `callerWorkflowId` / `callerWorkflowExecutionId` (serialized `workflowCall.parentWorkflowId` / `parentWorkflowExecutionId` unchanged). `buildNestedCrossWorkflowRunOptions` renamed to `buildCrossWorkflowCalleeRunOptions` with JSDoc (sibling bundle invocation, not structural child). `persistWorkflowCallArtifact` inputs `callerNodeExecId`, `calleeWorkflowName`, `calleeWorkflowId`, `calleeSession`; **superseded 2026-04-28:** new `workflow-calls/*.json` writes caller/callee keys only (no `parentNodeExecId` / `child*` mirrors). JSDoc on `findLatestWorkflowCallResultExecution` for callee output handoff vs manager-less fallback. Renamed `workflowCallMatchesCallerExecution` to `crossWorkflowDispatchMatchesCallerExecution`. Post-node completion uses local `crossWorkflowDispatchResult`; rare fallback message `cross-workflow dispatch execution failed`. `crossWorkflowInvocationStack` JSDoc describes call-stack cycle guard (not structural nesting). `runNestedSuperviserSessionDriver` locals renamed away from `nested`/`WithNested` session phrasing to `superviserRunSessionId` / `sessionWithSuperviserRunId` / `resumeSuperviserRunSession`; load failure prefix `nested superviser: load session for superviser run:` (no structural sub-workflow implication; distinct from loading the superviser bundle by id); persisted `nestedSuperviserSessionId` field unchanged.
- `src/workflow/superviser-runtime-control-impl.ts`: internal `stripForChildRun` renamed to `stripRunOptionsForSuperviserControlPlane`; JSDoc and locals `baseForTargetRun` replace misleading “child” run naming for supervised target invocations.
- `design-docs/specs/design-unified-workflow-role-model.md`: `workflowCall` runtime-variable bullet — invoking workflow vs serialized parent key names (protected `architecture.md` / `design-step-run-history-rerun.md` untouched).
- `src/workflow/engine.test.ts`: test title uses callee workflow results (not child).

**Tasks In Progress**: Module 2: validator `root-manager` / single-manager graph inference; optional deeper `conversationTurns` / session-string review. Modules 3-4: GraphQL/inspect wording, examples, fixture retirement.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/engine.test.ts src/workflow/superviser-runtime-control-impl.test.ts src/workflow/cross-workflow-from-steps.test.ts --runInBand` (112 pass)
- `bun test --runInBand` (1105 pass, 74 files)

### Session: 2026-04-27 (module 2: unified cross-workflow dispatch invocation path)

**Tasks Completed**: `src/workflow/engine.ts`: removed the post-node-completion `isStepAddressedWorkflow(workflow)` conditional around `executeWorkflowCallsForNode`; cross-workflow execution rows are still empty for non-step-addressed bundles inside `crossWorkflowDispatchesForExecutionMatch`, so the helper already no-ops. Engine now uses one unconditional `await executeWorkflowCallsForNode(...)` after transitions (same runtime behavior as the prior inline `ok({...})` branch). Removed unused `isStepAddressedWorkflow` import from `engine.ts`. Updated `executeWorkflowCallsForNode` JSDoc to describe the single call path instead of optional skipping.

**Tasks In Progress**: Module 2: validator `root-manager` / single-manager graph inference; modules 3-4: GraphQL/inspect wording, examples, fixture retirement.

**Blockers**: None.

**Notes / verification commands**:

- `bun run typecheck:server` (pass)
- `bun test src/workflow/engine.test.ts src/workflow/cross-workflow-from-steps.test.ts --runInBand` (105 pass)
- `bun test --runInBand` (1105 pass, 74 files)

### Session: 2026-04-27 (module 2: engine cross-workflow naming and no-op dispatch skip)

**Tasks Completed**: `src/workflow/engine.ts`: renamed nested cross-workflow cycle stack parameter from `workflowCallAncestors` to `crossWorkflowInvocationStack` (through `runWorkflowInternal` / `runNestedSuperviserSessionDriver` / `executeWorkflowCallsForNode`); renamed `buildChildWorkflowCallOptions` to `buildNestedCrossWorkflowRunOptions` with JSDoc; replaced internal `loadedChild` / `childResult` / `childWorkflow` / related locals with callee-oriented names in `executeWorkflowCallsForNode` (persisted workflow-call artifact JSON keys unchanged: `childWorkflowName`, `childSessionId`, etc.). After node completion, `executeWorkflowCallsForNode` is only awaited when `isStepAddressedWorkflow(workflow)`; legacy node-graph runs use an inline `ok({...})` empty result matching prior no-op behavior (`crossWorkflowDispatchesForExecutionMatch` already returned no rows). Added JSDoc on `executeWorkflowCallsForNode` documenting the skip. Imported `isStepAddressedWorkflow` from `./types`. Protected `design-docs/specs/architecture.md` and `design-step-run-history-rerun.md` not modified.

**Tasks In Progress**: Module 2: validator `root-manager` / single-manager graph inference and any deeper runtime branches; modules 3-4: GraphQL/inspect wording, examples, fixture retirement.

**Blockers**: None.

**Notes / verification commands**:

- `bun run typecheck:server` (pass)
- `bun test src/workflow/engine.test.ts --runInBand` (96 pass)
- `bun test --runInBand` (1105 pass, 74 files)

### Session: 2026-04-27 (module 2: engine root-wording cleanup, manager-control test titles)

**Tasks Completed**: Renamed `runWorkflowInternal` flag `isFreshRootStart` to `isNotResumingOrRerunning` with JSDoc clarifying it gates session continuation (resume/rerun), not structural root/sub-workflow scope. Updated `manager-control.test.ts` titles that incorrectly implied structural "non-root" or nested-manager semantics; tests still assert the same `resolveWorkflowManagerRuntimeId` / control-scope behavior. Protected `design-docs/specs/architecture.md` and `design-step-run-history-rerun.md` not modified.

**Tasks In Progress**: Module 2: validator legacy `root-manager` single-manager graph inference and any remaining runtime branches; modules 3-4: public/read-model wording, examples, fixture retirement.

**Blockers**: None.

**Notes / verification commands**:

- `bun run typecheck:server`
- `bun test src/workflow/engine.test.ts src/workflow/manager-control.test.ts --runInBand`

### Session: 2026-04-27 (module 2 slice — code review, typecheck, full test run)

**Tasks Completed**: Reviewed pending engine/mailbox/runtime-addressing slice: removed `mailboxDeliveryManagerNodeId` in favor of `resolveWorkflowManagerRuntimeId` for `deliveredByNodeId` on intra-workflow transition communications (aligned with removal of per-lane structural sub-managers; one manager runtime id per workflow). Renamed `isRootScopeOutputNode` to `isWorkflowOutputKindNode` with JSDoc clarifying it is `nodes[].kind === "output"`, not structural scope. Mailbox copy uses `isManagerNodeRef` and non-structural peer listings. `impl-plans/runtime-owned-external-output-publication.md` terminology aligned. Protected `design-docs/specs/architecture.md` and `design-step-run-history-rerun.md` unchanged.

**Tasks In Progress**: Module 2: validator `root-manager` / single-manager graph inference cleanup; modules 3-4: GraphQL/inspect wording, `examples/`, fixture retirement.

**Blockers**: None.

**Notes / verification commands**:

- `bun run typecheck:server` (pass)
- `bun test src/workflow/runtime-addressing.test.ts src/workflow/prompt-composition.test.ts src/workflow/call-step-impl.test.ts src/workflow/engine.test.ts --runInBand` (128 pass)
- `bun test --runInBand` (1105 pass, 74 files)

### Session: 2026-04-27 (module 2: design cross-check, plan alignment, diff review, verification)

**Tasks Completed**:
- Confirmed intended behavior: external publication and `workflowOutput` are driven by `nodes[].kind === "output"` via `isWorkflowOutputKindNode` in `src/workflow/runtime-addressing.ts` (not removed structural sub-workflow scope). `impl-plans/runtime-owned-external-output-publication.md` Summary/Scope/Purpose/Last Updated now use output-**kind** wording and reference `isWorkflowOutputKindNode` in the open paragraphs (modules already had checklist updates).
- `impl-plans/workflow-legacy-compatibility-removal.md` module-2 file list: removed deleted `sub-workflow.ts` / `conversation.ts`; added `node-execution-mailbox.ts` and `session.ts`; note not to reintroduce structural modules.
- Review Check Matrix: **Architecture fit** follow-up now mentions the landed engine/mailbox slice and runtime-owned plan alignment (still PARTIAL for phase-133 end state).
- Re-read `AGENTS.md` and this plan; reviewed full unstaged workflow diff: coherent continuation of prior task; no further production edits required. Protected `design-docs/specs/architecture.md` and `design-step-run-history-rerun.md` not modified.

**Tasks In Progress**: Module 2: validator `root-manager` single-manager graph inference; modules 3-4: GraphQL/inspect public wording, `examples/`, fixture retirement.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/runtime-addressing.test.ts src/workflow/prompt-composition.test.ts src/workflow/engine.test.ts src/workflow/call-step-impl.test.ts --runInBand` (128 pass)
- `bun test --runInBand` (1105 pass, 74 files)

### Session: 2026-04-27 (module 2: engine, runtime-addressing, node-execution-mailbox)

**Tasks Completed**:
- `src/workflow/node-execution-mailbox.ts`: `buildNodeReason` / `buildExpectedReturn` / `buildManagedChildren` / `buildMailboxStructure` gate on `isManagerNodeRef` (from `node-role.ts`) so legacy `root-manager` and role `manager` share one path; manager prompt headings avoid structural parent/child framing; persisted `meta.structure.type` stays `workflow-execution` and `managerRuntimeId` field name unchanged for meta compatibility. `src/workflow/prompt-composition.test.ts` updated.
- `src/workflow/engine.ts` / `src/workflow/call-step-impl.ts`: removed dead `mailboxDeliveryManagerNodeId`; `deliveredByNodeId` uses `resolveWorkflowManagerRuntimeId` directly. Renamed `isRootScopeOutputNode` to `isWorkflowOutputKindNode` in `runtime-addressing.ts` with JSDoc; `runtime-addressing.test.ts` updated. External mailbox `promptText`: "workflow input mailbox delivery". Historical progress log (~2026-04-26) in this file references the rename. No `CommunicationRoutingScope` change.

**Tasks In Progress**: Same as prior session (validator inference; modules 3-4).

**Blockers**: None.

**Notes / verification commands** (from prior combined runs; full suite recommended before release): `bun run typecheck:server` (pass); `bun test src/workflow/runtime-addressing.test.ts src/workflow/call-step-impl.test.ts src/workflow/engine.test.ts --runInBand` (113 pass); prior full `bun test --runInBand` (1105 pass) when the broader branch is green.

### Session: 2026-04-27 (module 1 authored-schema tail: cross-check, full `bun test`, no code delta)

**Tasks Completed**: Re-read `AGENTS.md` and this plan. Cross-checked `design-docs/specs/design-workflow-json.md` (lines 147–156) with production: `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS`, composed `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE`, and generic `REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE` in `validate.ts`; `normalizeStepAddressedWorkflow` and legacy node-graph `normalizeWorkflow` iterate those exports; `save.ts` `collectStepAddressedSaveLegacyFieldIssues` reuses the composed list with the same edges-vs-generic message split; `stripNormalizedOnlyWorkflowTopLevelFields` strips only `hasManagerNode`. Confirmed `types.ts` / `LoadOptions` JSDoc still distinguish authored-schema rejection from runtime/session uses of identifiers named `managerRuntimeId`. No architecture pivot; protected `design-docs/specs/architecture.md` and `design-step-run-history-rerun.md` not modified; no new implementation plan file. Dirty `src/workflow` slice reviewed as continuation of prior task: coherent; no additional production edits required in this pass.

**Tasks In Progress**: Module 1 residual outside this slice (examples + broader fixture retirement per checklist); module 2 root/sub runtime branching; modules 3–4 public-surface cleanup.

**Blockers**: None.

**Notes / verification commands**:

- `bun run typecheck:server` (pass)
- `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand` (304 pass)
- `bun test src/workflow/superviser.test.ts --runInBand` (23 pass)
- `bun test --runInBand` (1105 pass)

### Session: 2026-04-27 (module 1 tail: executable verification, design fit, diff review)

**Tasks Completed**: Re-read `AGENTS.md` and this plan. Confirmed `design-docs/specs/design-workflow-json.md` (authored top-level rejection sets, save-only `hasManagerNode` strip) matches production: `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE` in `validate.ts`; `save.ts` `collectStepAddressedSaveLegacyFieldIssues` reuses the composed list; `stripNormalizedOnlyWorkflowTopLevelFields` drops only in-memory `hasManagerNode` (no silent strip of disallowed `managerRuntimeId` / `entryNodeId` / `subWorkflows`). No architecture change; no new implementation plan file; did not modify protected `design-docs/specs/architecture.md` or `design-step-run-history-rerun.md`. Reviewed the unstaged `src/workflow` diff: centralized rejection constants, save pre-scan, removal of save-path top-level `managerRuntimeId`/`entryNodeId` deletion and redundant `edges` duplicate issue, `load.test` fixture slimming and duplicate `expect` cleanup, `validate.test` step-addressed `workflow.edges` negative case, `types.test` composition guard for rejection key lists. No further production edits required in this pass.

**Tasks In Progress**: Module 1: examples and non-`src/workflow` fixture retirement; module 2: root/sub runtime branching; modules 3-4: public-surface cleanup.

**Blockers**: None.

**Notes / verification commands**:

- `bun run typecheck:server` (pass)
- `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts src/workflow/superviser.test.ts --runInBand` (327 pass)

### Session: 2026-04-27 (module 1 authored-schema tail: design fit, diff review, verification)

**Tasks Completed**: Re-read `AGENTS.md` and this plan. Confirmed `design-docs/specs/design-workflow-json.md` still matches production: `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS`, composed `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE`, save pre-scan sharing the composed list, and save stripping only in-memory `hasManagerNode` (no silent strip of disallowed top-level keys). No architecture pivot; protected `design-docs/specs/architecture.md` and `design-step-run-history-rerun.md` not modified; no separate implementation plan beyond this file. Reviewed dirty module-1 tail (`types.ts`, `validate.ts`, `save.ts`, `load.test.ts`, `save.test.ts`, `types.test.ts`, `validate.test.ts`, `superviser.test.ts`): centralized rejection constants; `isStrictWorkflowAuthorshipValidation` JSDoc matches step-shaped vs node-graph routing; save no longer strips authored `managerRuntimeId` / `entryNodeId`; fixtures use minimal `subWorkflows` stubs and stable `REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE`; duplicate `subWorkflows` negative coverage removed in favor of top-level presence-only rejection; cross-workflow tests assert callees must declare `entryStepId` or `managerStepId` without relying on rejected top-level node aliases; step-addressed `workflow.edges` negative coverage uses the dedicated edges message.

**Tasks In Progress**: Module 1 examples and non-`src/workflow` fixture retirement; module 2 root/sub runtime branching; modules 3-4 public-surface cleanup.

**Blockers**: None.

**Notes / verification commands**:

- `bun run typecheck:server` (pass)
- `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts src/workflow/superviser.test.ts --runInBand` (327 pass)

### Session: 2026-04-27 (module 1: design vs code confirmation, review-matrix consistency, diff review)

**Tasks Completed**: Re-read `AGENTS.md` and this plan. Confirmed `design-docs/specs/design-workflow-json.md` still matches production for authored top-level rejection (`REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE`) and save behavior (`stripNormalizedOnlyWorkflowTopLevelFields` drops only `hasManagerNode`). No architecture pivot; protected `design-docs/specs/architecture.md` and `design-step-run-history-rerun.md` not modified; no additional implementation plan file. Reconciled the **opening** Review Matrix "Architecture fit" row with the later Review Check Matrix (both now PARTIAL for phase-133 end state; module 1 code path is aligned). Reviewed unstaged diffs: `save.ts` / `validate.ts` / `types.ts` and tests are coherent; `superviser.test.ts` only removes inert top-level `entryNodeId` / `managerRuntimeId` from fixtures that do not model authored `workflow.json`.

**Tasks In Progress**: Module 1 examples and non-`src/workflow` fixture retirement; module 2 root/sub runtime branching; modules 3-4 public-surface cleanup.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/types.test.ts src/workflow/validate.test.ts src/workflow/save.test.ts src/workflow/load.test.ts src/workflow/superviser.test.ts --runInBand` (327 pass)

### Session: 2026-04-27 (module 1: design alignment, checklist fix, verify dirty authored-schema tail)

**Tasks Completed**: Re-read `AGENTS.md` and this plan. Confirmed `design-docs/specs/design-workflow-json.md` still matches production: `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE`, save pre-scan sharing the composed list, and save stripping only in-memory `hasManagerNode` (no silent strip of disallowed top-level keys). No architecture pivot; protected `design-docs/specs/architecture.md` and `design-step-run-history-rerun.md` not modified; no separate implementation plan required beyond this file. Reviewed the unstaged module-1 tail (`types.ts` / `validate.ts` / `save.ts` / matching tests): centralized rejection constants, save path uses `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS` with the same `edges` message as validation, legacy save no longer strips top-level `managerRuntimeId` / `entryNodeId`, fixtures use minimal `subWorkflows` stubs for fail-fast rejection. Corrected one stale Module 1 checklist sentence that still claimed managed role-authored bundles *ignore* legacy manager/entry aliases during semantic validation (current behavior is top-level *rejection*, consistent with save/load tests).

**Tasks In Progress**: Module 1: examples and non-`src/workflow` fixture retirement; module 2: root/sub runtime branching; modules 3-4: public-surface cleanup.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/types.test.ts src/workflow/validate.test.ts src/workflow/save.test.ts src/workflow/load.test.ts src/workflow/superviser.test.ts --runInBand` (327 pass)

### Session: 2026-04-27 (module 1: verify dirty tail, design fit, no extra edits)

**Tasks Completed**: Re-read `AGENTS.md` and this plan. Confirmed `design-docs/specs/design-workflow-json.md` still matches production: `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE`, save pre-scan reusing the composed list, and save stripping only `hasManagerNode` (per lines 153-154 in that doc). No architecture pivot; protected `design-docs/specs/architecture.md` and `design-step-run-history-rerun.md` not modified. Reviewed the full unstaged diff for module 1: production code already centralizes disallowed keys; `save.ts` no longer strips top-level `managerRuntimeId` / `entryNodeId` or duplicates `edges` issues; tests use minimal `subWorkflows` stubs, stable `REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE` / edges message imports, and removed redundant `subWorkflows` duplicate assertions. No additional code fixes were required in this pass.

**Tasks In Progress**: Module 1: examples and non-`src/workflow` fixture retirement; module 2: root/sub runtime branching; modules 3-4: public-surface cleanup.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/types.test.ts src/workflow/validate.test.ts src/workflow/save.test.ts src/workflow/load.test.ts src/workflow/superviser.test.ts --runInBand` (327 pass)

### Session: 2026-04-27 (module 1: JSDoc fix for `isStrictWorkflowAuthorshipValidation` vs step-shaped routing)

**Tasks Completed**: Re-read `AGENTS.md` and this plan. Confirmed `design-docs/specs/design-workflow-json.md` still matches production (`REJECTED_AUTHORED_*` lists, `rejectLegacyWorkflowAuthoring` / env default); no architecture pivot. Protected `design-docs/specs/architecture.md` and `design-step-run-history-rerun.md` not modified. Reviewed dirty module-1 diff: production slice for centralized rejection keys, save pre-scan, and tests was already complete; one overlooked inaccuracy: `isStrictWorkflowAuthorshipValidation` JSDoc implied only strict mode uses `normalizeStepAddressedWorkflow`, but `normalizeWorkflow` also routes step-shaped bundles there when `rejectLegacyWorkflowAuthoring: false`. Updated the JSDoc in `src/workflow/validate.ts` to state that the legacy **node-graph** branch is gated by strictness while step-shaped inputs always use the step-addressed normalizer.

**Tasks In Progress**: Module 1: examples and non-`src/workflow` fixture retirement; module 2: root/sub runtime branching; modules 3-4: public-surface cleanup.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/types.test.ts src/workflow/validate.test.ts src/workflow/save.test.ts src/workflow/load.test.ts --runInBand` (pass)

### Session: 2026-04-27 (module 1 tail: final verification, design fit, no further code changes)

**Tasks Completed**: Re-read `AGENTS.md` and this plan. Confirmed `design-docs/specs/design-workflow-json.md` still matches production: `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`, and `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE` in `validate.ts`; `save.ts` `collectStepAddressedSaveLegacyFieldIssues` and `normalizeStepAddressedWorkflow` use the same composed list and edges message; `stripNormalizedOnlyWorkflowTopLevelFields` strips only `hasManagerNode`. No architecture pivot; no additional implementation plan file (this plan remains authoritative). Protected `design-docs/specs/architecture.md` and `design-step-run-history-rerun.md` not modified. Reviewed the unstaged module-1 diff: coherent tail for minimal `subWorkflows` stubs, stable rejection messages, removal of duplicate negative tests and redundant `entryNodeId` on callee/cross-workflow fixtures, and `types.test.ts` list-composition guard. No bugs found; no production edits required in this pass.

**Tasks In Progress**: Module 1: examples and non-`src/workflow` fixture retirement; module 2: root/sub runtime branching; modules 3–4: public-surface cleanup.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/ --runInBand` (full workflow package; pass)

### Session: 2026-04-27 (module 1 sign-off: typecheck, focused tests, design fit, full diff review)

**Tasks Completed**: Re-read `AGENTS.md` and this plan. Confirmed phase-133 design fit: authored top-level legacy keys are rejected via exported `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS`, and composed `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS` in `validate.ts`; step-addressed `edges` uses `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE`; `save.ts` reuses the same key lists for the step-addressed pre-validation scan and strips only in-memory `hasManagerNode` via `stripNormalizedOnlyWorkflowTopLevelFields` (no silent strip of disallowed `managerRuntimeId` / `entryNodeId` / `subWorkflows`). `types.ts` JSDoc distinguishes authored rejection from session/runtime `managerRuntimeId`. Reviewed the full uncommitted diff (including `superviser.test.ts` removal of inert `entryNodeId` / `managerRuntimeId` on supervision test fixtures) for bugs and inconsistencies; no code fixes required. Protected `design-docs/specs/architecture.md` and `design-step-run-history-rerun.md` not modified. Updated this plan's Review Matrix "Architecture fit" follow-up to record module-1 `src/workflow` verification.

**Tasks In Progress**: Module 1: examples and non-workflow fixture retirement; module 2: root/sub runtime branching; modules 3-4: public-surface cleanup.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/load.test.ts src/workflow/validate.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/superviser.test.ts --runInBand` (327 pass)

### Session: 2026-04-27 (module 1: design fit confirmation, duplicate subWorkflows negative tests removed)

**Tasks Completed**: Re-checked `design-docs/specs/design-workflow-json.md` against production: step-addressed authoring, `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS` / `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`, edges-specific `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE`, and save stripping only `hasManagerNode` remain aligned; no change to protected `design-docs/specs/architecture.md` or `design-step-run-history-rerun.md`; no separate implementation plan beyond this file. Reviewed uncommitted module-1 diff: coherent end state for authored-schema rejection and save pre-scan. Removed redundant `subWorkflows` negative tests in `load.test.ts` and `validate.test.ts` that duplicated the same fixture and expectations after fail-fast top-level rejection; retained single tests with titles that state top-level-only behavior.

**Tasks In Progress**: Module 1 examples/fixture retirement; optional DRY of remaining validator strings; module 2 root/sub runtime branching.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server`
- `bun test src/workflow/load.test.ts src/workflow/validate.test.ts src/workflow/save.test.ts src/workflow/types.test.ts --runInBand`

### Session: 2026-04-27 (module 1 tail: verify dirty worktree, design alignment, review-matrix hygiene)

**Tasks Completed**: Re-validated phase-133 direction against `design-docs/specs/design-workflow-json.md` (rejected top-level keys via `REJECTED_AUTHORED_*`, save strips only `hasManagerNode`); no architecture pivot; protected `design-docs/specs/architecture.md` and `design-step-run-history-rerun.md` untouched. Confirmed the unstaged module-1 tail is coherent: `validate.ts` exports composed key lists and the step-addressed `edges` message; `save.ts` pre-scan and `normalizeStepAddressedWorkflow` share those constants; save no longer strips disallowed top-level `managerRuntimeId` / `entryNodeId` / structural keys; `types.ts` JSDoc distinguishes authored rejection from runtime/session `managerRuntimeId`. Tests: `load.test.ts` / `save.test.ts` use minimal `subWorkflows` stubs for fail-fast rejection and stable `REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE` expectations; duplicate `subWorkflows` assertions removed. Updated this plan’s Review Matrix “Compatibility cleanup progress” cell (removed stale “bespoke workflow.edges copy”; save and validator now share `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE`).

**Tasks In Progress**: Module 1 examples/fixture retirement; module 2 root/sub runtime branching; modules 3–4 public-surface cleanup.

**Blockers**: None.

**Notes / verification commands**: `bun run typecheck:server` (pass); `bun test src/workflow/types.test.ts src/workflow/validate.test.ts src/workflow/save.test.ts src/workflow/load.test.ts src/workflow/superviser.test.ts --runInBand` (329 pass).

### Session: 2026-04-27 (module 1 slice: diff review, test hygiene, verification)

**Tasks Completed**: Reviewed uncommitted module-1 work: centralized `REJECTED_AUTHORED_*` key lists in `validate.ts`; `normalizeStepAddressedWorkflow` and `collectStepAddressedSaveLegacyFieldIssues` share `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS` with the same `edges`-specific message as validator; legacy node-graph branch uses `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`; save `stripNormalizedOnlyWorkflowTopLevelFields` drops only `hasManagerNode` (no silent strip of disallowed top-level `managerRuntimeId` / `entryNodeId` / `subWorkflows`). Confirmed `design-workflow-json.md` already documents those exports and save behavior (no change to protected `architecture.md` or `design-step-run-history-rerun.md`). Removed redundant legacy top-level key churn from `validate.test.ts` manager-less worker-only fixture (`makeUnifiedRoleRaw` never authored those keys).

**Tasks In Progress**: Module 1 legacy node-graph disk/runtime surface; module 2 root/sub runtime branching; modules 3–4 example and fixture retirement.

**Blockers**: None.

**Notes / verification commands**: `bun run typecheck:server`; `bun test src/workflow/types.test.ts src/workflow/validate.test.ts src/workflow/save.test.ts src/workflow/load.test.ts src/workflow/superviser.test.ts --runInBand`

### Session: 2026-04-27 (module 1 follow-up: cross-workflow callee tests — remove redundant `entryNodeId` fixture)

**Tasks Completed**: Confirmed `design-workflow-json.md` / phase-133 intent unchanged: callee entry for cross-workflow checks is resolved from raw `workflow.json` via `managerStepId` / `entryStepId` / single manager-role step only (`resolveCalleeWorkflowEntry`); rejected top-level `entryNodeId` is not consulted. No architecture pivot; protected `architecture.md` and `design-step-run-history-rerun.md` untouched. Cleaned `src/workflow/validate.test.ts` async/sync cross-workflow tests that previously authored `entryNodeId` on a callee disk fixture even though that field does not participate in callee entry resolution (misleading “legacy entryNodeId-only callee” naming). Fixtures now use a minimal node-graph callee without step entry fields; transition `toStepId` renamed to a neutral placeholder.

**Tasks In Progress**: Module 1 legacy node-graph disk/runtime surface; module 2 root/sub runtime branching; modules 3–4 example and public-surface retirement.

**Blockers**: None.

**Notes / verification commands**: `bun run typecheck:server`; `bun test src/workflow/validate.test.ts --runInBand`

### Session: 2026-04-27 (module 1 slice: export extra rejected keys; align unified role-model doc; strict-validation JSDoc)

**Tasks Completed**: Exported `REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS` from `validate.ts` (composition with `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS` remains the single definition of `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`). Clarified `isStrictWorkflowAuthorshipValidation` JSDoc (return value vs `normalizeStepAddressedWorkflow` routing). Added `types.test.ts` runtime guard that the step-addressed disallowed list equals legacy rejects plus extras. Updated `design-docs/specs/design-unified-workflow-role-model.md`: Workflow Entry and validation rules now describe `entryStepId` / `managerStepId` / session `managerRuntimeId` disambiguation; removed stale `WorkflowJson` snippet with top-level `managerRuntimeId` / `entryNodeId` / `workflowCalls` / `branching`; tightened Non-Goals and Runtime Implications to past-tense structural removal. Protected `architecture.md` and `design-step-run-history-rerun.md` untouched.

**Tasks In Progress**: Module 1 legacy node-graph disk/runtime surface; module 2 root/sub runtime branching; modules 3-4 example and public-surface retirement.

**Blockers**: None.

**Notes / verification commands**: `bun run typecheck:server`; `bun test src/workflow/types.test.ts src/workflow/validate.test.ts src/workflow/save.test.ts src/workflow/load.test.ts --runInBand`

### Session: 2026-04-27 (module 1: tighten authored-rejection JSDoc; simplify step-addressed save negative test)

**Tasks Completed**: Confirmed `design-workflow-json.md` / phase-133 intent still match (rejected top-level keys via `REJECTED_AUTHORED_*` in `validate.ts`, save strips only `hasManagerNode`); no change to protected `design-docs/specs/architecture.md` or `design-step-run-history-rerun.md`. Condensed JSDoc on `AuthoredWorkflowJson`, `LoadOptions.rejectLegacyWorkflowAuthoring`, `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, and `stripNormalizedOnlyWorkflowTopLevelFields` to remove duplicated key-list prose while keeping the session-vs-authored `managerRuntimeId` distinction. Simplified `save.test.ts` step-addressed save rejection so it only adds `entryNodeId` to an otherwise valid bundle (removed the extra `entryStepId: undefined` failure that was only needed to assert two issues in one test).

**Tasks In Progress**: Module 1 legacy node-graph disk/runtime surface; module 2 root/sub runtime branching; modules 3-4 example and public-surface retirement.

**Blockers**: None.

**Notes / verification commands**: `bun run typecheck:server`; `bun test src/workflow/types.test.ts src/workflow/validate.test.ts src/workflow/save.test.ts --runInBand`

### Session: 2026-04-27 (module 1: test fixture hygiene; align types JSDoc with rejection exports)

**Tasks Completed**: Confirmed phase-133 direction still matches `design-workflow-json.md` and this plan (no change to protected `design-docs/specs/architecture.md`). Removed redundant authored `entryNodeId` from fixtures that only assert other rejection paths: `validate.test.ts` (legacy node-graph `workflowCalls` presence test) and `save.test.ts` (role-authored invalid non-array structural field table). Updated `types.ts` JSDoc: `inferLegacyNodeGraphGraphEntryNodeId` now contrasts step-addressed `entryStepId` with edge-inference instead of naming removed top-level authored aliases; `LoadOptions.rejectLegacyWorkflowAuthoring` now points at the exported `REJECTED_AUTHORED_*` key lists by name.

**Tasks In Progress**: Module 1 legacy node-graph disk/runtime surface; module 2 root/sub runtime branching; modules 3–4 example and public-surface retirement.

**Blockers**: None.

**Notes / verification commands**: `bun run typecheck:server`; `bun test src/workflow/types.test.ts src/workflow/validate.test.ts src/workflow/save.test.ts --runInBand`

### Session: 2026-04-27 (module 1: design + types.test alignment with centralized rejection keys; clarify validate JSDoc)

**Tasks Completed**: Confirmed phase-133 direction: authored `workflow.json` rejects legacy top-level keys via shared exports in `validate.ts`, with save stripping only `hasManagerNode`. Updated `design-docs/specs/design-workflow-json.md` to name `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS` and `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS` (protected `design-docs/specs/architecture.md` unchanged). Extended `src/workflow/types.test.ts` so every key in the step-addressed disallowed set has a matching `@ts-expect-error` excess-property check (`subWorkflowConversations`, `loops`, `branching` added). Tightened the JSDoc on `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS` in `validate.ts` to separate authored-workflow rejection from runtime session `managerRuntimeId` usage. Refreshed the review-matrix architecture-fit follow-up line in this plan.

**Tasks In Progress**: Module 1 legacy node-graph disk persistence; module 2 root/sub runtime branching; modules 3-4 public-surface and example/fixture retirement.

**Blockers**: None.

**Notes / verification commands**: `bun run typecheck:server`; `bun test src/workflow/types.test.ts src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`

### Session: 2026-04-27 (module 1 follow-up: validate.test fixture hygiene after rejected-key centralization)

**Tasks Completed**: Confirmed the in-flight module-1 slice (central `REJECTED_AUTHORED_*` keys in `validate.ts`, save reuse of `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`, and removal of save-time stripping for disallowed top-level `managerRuntimeId` / `entryNodeId` / structural companions) matches `design-workflow-json.md` and requires no architecture pivot (protected `architecture.md` unchanged). Cleaned `src/workflow/validate.test.ts` step-addressed fixtures for `resolveWorkflowEntryRuntimeId` / `resolveWorkflowManagerRuntimeId` so they no longer inject unused `entryNodeId` / `managerRuntimeId` fields on the cast objects. Replaced invalid-node-kind table value `subworkflow-manager` with `orphan-manager-kind` so coverage no longer names removed structural kind vocabulary.

**Tasks In Progress**: Module 1 legacy node-graph persistence; module 2 residual runtime branching; modules 3–4 fixture/example retirement.

**Blockers**: None.

**Notes**: Verification: `bun run typecheck:server` (pass); `bun test src/workflow/types.test.ts src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand` (305 pass); `bun test --runInBand` (1106 pass).

### Session: 2026-04-27 (module 1 follow-up: design alignment check, diff review, verification)

**Tasks Completed**: Confirmed `design-docs/specs/design-workflow-json.md` already documents
rejected top-level keys and that save may strip only normalized `hasManagerNode` (no
change to protected `design-docs/specs/architecture.md`). No competing implementation plan
required; phase-133 direction still matches the active spec and this plan. Reviewed the
uncommitted diff for `validate.ts` / `save.ts` / `types.ts` and related tests: shared
`REJECTED_AUTHORED_*` lists are the single source for step-addressed and legacy
node-graph top-level rejection; `collectStepAddressedSaveLegacyFieldIssues` must stay
before validation because `createPersistedWorkflowJson` drops unknown keys, so the
post-`validateWorkflowBundleAsync` `stepAddressedLegacyIssues` check remains necessary.
Trimmed `superviser.test.ts` expectations aligned with the slice.

**Tasks In Progress**: Module 1 legacy node-graph persistence; module 2 residual runtime
branching; modules 3–4 fixture and example retirement (per main plan checklists).

**Blockers**: None.

**Notes**: Verification: `bun run typecheck:server` (pass);
`bun test src/workflow/types.test.ts src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand` (305 pass);
`bun test --runInBand` (1106 pass).

### Session: 2026-04-27 (module 1 slice: centralize rejected authored top-level keys; stop save-path stripping of legacy manager/entry)

**Tasks Completed**: Re-checked phase-133 design direction against
`design-docs/specs/design-workflow-json.md` and this plan: strict step-addressed
authorship with explicit rejection of legacy top-level node aliases still
matches; the spec now documents `managerRuntimeId` / `entryNodeId` /
`subWorkflows` among rejected keys and that save strips only normalized
`hasManagerNode`. Implemented module-1 cleanup in production code:
`src/workflow/validate.ts` now exports `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`
and `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`, and both
`normalizeStepAddressedWorkflow` and legacy `normalizeWorkflow` iterate those
constants instead of duplicating string lists. `src/workflow/save.ts`
`collectStepAddressedSaveLegacyFieldIssues` reuses the step-addressed key list
and `REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE` (still special-casing
`workflow.edges` with the transitions-only message). Removed save-path behavior
that deleted `managerRuntimeId` / `entryNodeId` during
`prepareAuthoredWorkflowForSave` and the `hasManagerNode === false` branch that
stripped `managerRuntimeId` in `stripNormalizedOnlyWorkflowTopLevelFields`;
disallowed keys now fail validation like on-disk `workflow.json`. Renamed
internal save helpers to `stripNormalizedOnlyWorkflowTopLevelFields` and
`stripRedundantKindWhenRolePresentOnNode` and dropped unused manager-role
detection helpers. `src/workflow/types.ts` JSDoc for `AuthoredWorkflowJson`,
`WorkflowJson`, and `LoadOptions.rejectLegacyWorkflowAuthoring` now point at the
shared rejection constants instead of vague compatibility wording.

**Tasks In Progress**: Module 1 broader legacy node-graph persistence/runtime;
module 2 root/sub runtime branching; modules 3–4 public-surface and fixture
retirement.

**Blockers**: None.

**Notes**: Verification:
`bun run typecheck:server`;
`bun test src/workflow/types.test.ts src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand` (305 pass);
`bun test --runInBand` (1106 pass).

### Session: 2026-04-27 07:55 JST (module 1 slice: delete dead structural `subWorkflows` semantic validation)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended strict step-addressed
authorship/runtime direction still matches the active design docs and this
implementation plan, so no replacement design or competing plan was needed.
Continued module 1 by deleting the remaining dead structural `subWorkflows`
semantic-validation block from `src/workflow/validate.ts`. Because authored
`subWorkflows` are already rejected by top-level presence across legacy
node-graph, role-authored, and step-addressed validate/load/save entrypoints,
the old downstream checks for structural sub-workflow ownership, boundary node
typing, cross-scope edges, loop-body grouping, and crossing group/loop
intervals were unreachable from supported authored input. The surviving loop
semantic validation now reasons only about actual legacy `workflow.loops`, and
the focused validator/load/save suites remained green without further test
changes.

**Tasks In Progress**: Module 1 still remains open for the broader node-graph
compatibility runtime/helper surface, since structural sub-workflow ownership
and manager/input/output semantics are still present outside validation in
`engine.ts`, `sub-workflow.ts`, mailbox/routing helpers, manager-control, TUI,
visualization, and related tests. Module 2 still remains open for root/sub
runtime branching cleanup. Module 3 and module 4 broader public-surface,
example, and doc retirement remain blocked on those deeper deletions.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`299` pass)
and
`bun run typecheck:server`
(`tsc --noEmit` passed). This remains an incremental phase-133 slice, not plan
completion, so `PROGRESS.json` status does not change and remains
`In Progress`.

### Session: 2026-04-27 06:40 JST (module 1 slice: reject authored legacy `subWorkflows` on node-graph bundles)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended strict step-addressed
authorship/runtime direction still matches the active design docs and this
implementation plan, so no replacement design or competing plan was needed.
Continued module 1 by cutting off authored legacy `workflow.subWorkflows` at
the schema boundary on legacy node-graph bundles instead of continuing to
normalize and semantically validate those structural entries. In
`src/workflow/validate.ts`, top-level `subWorkflows` presence now fails fast on
legacy node-graph bundles with the same legacy-only messaging used for the
other remaining authored compatibility companions, and the dead legacy
sub-workflow entry normalization helpers were removed. Focused regressions were
updated in `src/workflow/validate.test.ts`, `src/workflow/load.test.ts`, and
`src/workflow/save.test.ts` so the surviving behavior is asserted directly:
legacy authored `subWorkflows` now fail on validate/load/save without
traversing removed nested entry validation, while obsolete acceptance-era
structural semantic tests and load-copy save regressions were deleted.

**Tasks In Progress**: Module 1 still remains open for deeper node-graph
compatibility cleanup beyond authored-input rejection, especially the remaining
legacy structural runtime/helper surface and any save-path raw-input
canonicalization that still exists only to support transitional node-graph
bundles. Module 2 still remains open for root/sub-workflow runtime branching
cleanup in `engine.ts`, `sub-workflow.ts`, and related helpers. Module 3 and
module 4 broader public-surface/example/doc retirement remain blocked on those
deeper runtime deletions.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`299` pass)
and
`bun run typecheck:server`
(`tsc --noEmit` passed). This remains an incremental phase-133 slice, not plan
completion, so `PROGRESS.json` status does not change and remains
`In Progress`.

### Session: 2026-04-26 20:14 JST (module 1 slice: stop re-authoring redundant legacy `entryNodeId` on save)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended strict
step-addressed direction, so no new design document or replacement
implementation plan was needed. Continued module 1 by deleting another
unnecessary legacy save-path alias in `src/workflow/save.ts`: legacy
node-graph bundles no longer persist `workflow.entryNodeId` when it is only a
redundant mirror of the persisted `workflow.managerRuntimeId`. This keeps the
remaining legacy runtime path intact for manager-less workflows, but trims the
public/persisted compatibility surface instead of carrying a duplicate entry
alias forward on copied legacy bundles. Updated `src/workflow/save.test.ts`
accordingly: legacy copy regressions now assert that redundant `entryNodeId`
is omitted, and a focused manager-less regression confirms a distinct authored
`entryNodeId` still survives when it remains the only entry alias.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader legacy companion removal and rejection of the
remaining node-graph-only structural fields. Module 2 runtime/control cleanup
still remains open for root/sub branching and other legacy node-graph special
cases. Module 3 public-surface cleanup still remains open beyond the current
GraphQL/TUI step-addressing changes.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/save.test.ts src/workflow/load.test.ts --runInBand`.
This remains an incremental phase-133 slice, not plan completion, so
`PROGRESS.json` status does not change and remains `In Progress`.

### Session: 2026-04-26 20:01 JST (module 1 slice: stop re-authoring structural legacy `subWorkflows` on save)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended strict
step-addressed direction, so no new design document or replacement
implementation plan was needed. Continued module 1 by deleting the save-path
branch in `src/workflow/save.ts` that re-authored non-empty legacy
`workflow.subWorkflows` back into persisted `workflow.json` when copying or
re-saving a loaded legacy bundle. The runtime helper surface remains
step-addressed-first, but the persistence surface now removes another obsolete
structural compatibility companion instead of preserving it. Updated
`src/workflow/save.test.ts` with a focused regression that loads a legacy
node-graph bundle containing a structural sub-workflow, saves it under a new
name, and asserts the surviving behavior only: the copied workflow keeps the
legacy manager/entry ids and explicit legacy `edges` still needed by the
remaining node-graph path, but no longer re-authors `subWorkflows`.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader legacy companion removal (`subWorkflows` input
rejection, remaining non-step structural branches, and deeper legacy
node-graph load/save input paths). Module 2 runtime/control cleanup still
remains open for root/sub branching and the remaining legacy node-graph
dispatch union path. Module 3 public-surface cleanup still remains open beyond
the current GraphQL/TUI step-addressing updates.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/save.test.ts --runInBand`
(`51` pass). This remains an incremental phase-133
slice, not plan completion, so `PROGRESS.json` status does not change and
remains `In Progress`.

### Session: 2026-04-26 19:57 JST (module 1/2 slice: remove authored legacy `subWorkflowConversations` end-to-end)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended step-addressed runtime/public
surface still matches the active design docs and this implementation plan, so
no design pivot or replacement plan was needed. Continued modules 1 and 2 by
removing authored top-level `workflow.subWorkflowConversations` end-to-end
instead of keeping the remaining legacy structural conversation branch alive.
In `src/workflow/types.ts`, the legacy `SubWorkflowConversation` type and
helper reader were deleted. In `src/workflow/validate.ts`, authored
`subWorkflowConversations` are now rejected outright by top-level presence on
legacy node-graph bundles as well as role-authored bundles, and the dead legacy
conversation-entry normalization/semantic-validation branches were removed. In
`src/workflow/save.ts`, save no longer preserves or canonicalizes authored
`subWorkflowConversations`. In `src/workflow/engine.ts`, the legacy
conversation-turn execution branch was deleted, and
`src/workflow/conversation.ts` plus its dedicated test file were removed as
unreachable compatibility code. Focused workflow tests were updated to the
surviving behavior only: validator/load/save coverage now expects top-level
rejection without traversing removed conversation-entry fields, and the
sub-workflow engine fixture no longer authors conversations while transcript
bindings remain empty.

**Tasks In Progress**: Module 1 still remains open for the other legacy
structural companions (`subWorkflows`, `edges`, `loops`, manager/entry node
aliases) on the remaining node-graph path. Module 2 still remains open for
deeper root/sub-workflow runtime branching cleanup outside the removed
conversation-turn path. Module 3 broader node-id/public-surface cleanup and
module 4 examples/docs retirement both remain open.

**Blockers**: `src/workflow/engine.test.ts` is already broadly red on the
current branch outside this slice. After the removal landed, a targeted engine
run still failed across many unrelated cases with generic `workflow validation
failed` results that are not specific to the removed conversation path, so this
iteration kept verification focused on the validator/load/save suites plus a
direct runtime repro.

**Notes**: Verification for this slice:
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`311` pass),
`bun run typecheck:server`
(`tsc --noEmit` passed),
and a direct `bun` runtime repro of a legacy structural sub-workflow fixture
confirmed load/run success without authored `subWorkflowConversations`.
Plan status remains `In Progress`, so `impl-plans/PROGRESS.json` did not
require a status update in this slice.

### Session: 2026-04-26 22:11 JST (module 3 slice: remove remaining legacy structural sub-workflow preview lines from the TUI)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended step-addressed runtime/public
surface still matches the active design docs and this implementation plan, so
no design pivot or replacement plan was needed. Continued module 3 by deleting
the remaining legacy structural `subWorkflows` text from the TUI preview
surfaces that still rendered it for non-step-addressed loads. In
`src/tui/opentui-model/workflow-rendering.ts`, workflow summary/run preview,
definition content, workflow boundary sections, and the history header no
longer include legacy structural sub-workflow counts, ids, or dedicated
sections. This keeps the surviving TUI model focused on the active
step-addressed execution/read-model surface while leaving deeper
subworkflow-history navigation unchanged for a later runtime cleanup slice.
`src/tui/opentui-screen.test.ts` was updated to assert the removed preview copy
and the surviving subworkflow-scope history metadata separately.

**Tasks In Progress**: Module 1 still remains open for the remaining authored
legacy schema companions on the node-graph path. Module 2 still remains open
for deeper root/sub-workflow runtime branching cleanup. Module 3 broader
node-id/public-surface cleanup still remains open beyond these removed preview
lines, and module 4 examples/docs retirement remains blocked on the deeper
runtime cleanup.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun test src/tui/opentui-screen.test.ts --runInBand`
(`72` pass)
and
`bun run typecheck:server`
(`tsc --noEmit` passed). Plan status remains `In Progress`, so
`impl-plans/PROGRESS.json` did not require a status update in this slice.

### Session: 2026-04-26 19:46 JST (module 1/2 slice: remove authored legacy workflowCalls end-to-end)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended step-addressed runtime/public
surface still matches the active design docs and this implementation plan, so
no design pivot or replacement plan was needed. Continued modules 1 and 2 by
removing authored top-level `workflow.workflowCalls` end-to-end instead of
preserving the remaining legacy node-graph execution branch. In
`src/workflow/validate.ts`, authored `workflowCalls` are now rejected outright
by top-level presence across legacy node-graph, role-authored, and
step-addressed save/load validation paths, and the old authored
`workflowCalls` entry-normalization / semantic-validation branches were
deleted. In `src/workflow/save.ts`, re-save projection no longer re-persists
legacy `workflowCalls`. In `src/workflow/cross-workflow-from-steps.ts` and
`src/workflow/engine.ts`, runtime/readiness/inspection dispatch now derives
cross-workflow calls only from step-addressed `steps[].transitions`, so the
legacy node-graph authored `workflowCalls` execution path is gone. Follow-up
cleanup updated `src/workflow/node-execution-mailbox.ts` to stop documenting
removed legacy `workflowCalls`, converted the GraphQL HTTP/runtime-readiness
fixtures that still covered cross-workflow behavior to step-derived
step-addressed calls, and updated TUI/prompt-composition tests so removed
legacy `workflowCalls` are ignored rather than surfaced.

**Tasks In Progress**: Module 1 still remains open for the other legacy
structural companions (`subWorkflows`, `subWorkflowConversations`, `edges`,
`loops`, manager/entry node aliases) on the node-graph path. Module 2 still
remains open for root/sub-workflow runtime branching cleanup outside the
removed `workflowCalls` path. Module 3 broader node-id/public-surface cleanup
and module 4 examples/docs retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/cross-workflow-from-steps.test.ts`
(`319` pass),
`bun test src/workflow/runtime-readiness.test.ts src/server/graphql.test.ts src/graphql/schema.test.ts src/tui/opentui-screen.test.ts src/workflow/prompt-composition.test.ts src/workflow/manager-control.test.ts`
(`178` pass),
and
`bun run typecheck:server`
(`tsc --noEmit` passed). Plan status remains `In Progress`, so
`impl-plans/PROGRESS.json` did not require a status update in this slice.

### Session: 2026-04-26 19:27 JST (module 2 slice: require step-addressed supervision reruns)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended step-addressed runtime/public
surface still matches the active design docs and this implementation plan, so
no design pivot or replacement plan was needed. Continued module 2 by removing
the supervision-specific legacy fallback that still projected node-addressed
workflows into synthetic steps. `src/workflow/superviser.ts` now accepts only
authored `entryStepId` plus non-empty `steps` for supervision rerun planning,
and both `src/workflow/engine.ts` and
`src/workflow/superviser-runtime-control-impl.ts` now fail with step-addressed
precondition errors instead of advertising legacy `entryNodeId` support. The
focused runtime-control regression in
`src/workflow/superviser-runtime-control-impl.test.ts` was inverted so a valid
legacy node-graph target now fails fast and never reaches `runWorkflow`, while
`src/workflow/superviser.test.ts` focuses on step-addressed rerun resolution only
(the later-removed `toStepAddressedWorkflowForSupervision` helper is not present in current `src/`).

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for the remaining runtime-visible legacy node-graph schema
branches, especially validator/runtime handling for actual legacy structural
companions and authored workflow-call execution. Module 2 runtime/control
cleanup still remains open for deeper root/sub branching cleanup and the
remaining explicit legacy node-graph workflow-call execution path. Module 3
broader public-surface cleanup and module 4 examples/docs retirement both
remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun test src/workflow/superviser.test.ts src/workflow/superviser-runtime-control-impl.test.ts`
(`30` pass)
and
`bun run typecheck:server`
(`tsc --noEmit` passed). Plan status remains `In Progress`, so
`impl-plans/PROGRESS.json` did not require a status update in this slice.

### Session: 2026-04-26 19:22 JST (module 3 slice: remove GraphQL `sendManagerMessage.managerRuntimeId`)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended step-addressed runtime/public
surface still matches the active design docs and this implementation plan, so
no design pivot or replacement plan was needed. Continued module 3 by removing
the caller-supplied `managerRuntimeId` compatibility field from the public
GraphQL `SendManagerMessageInput` contract in
`src/server/graphql-executable-schema.ts`, `src/graphql/types.ts`, and
`src/graphql/schema.ts`. Manager-scoped GraphQL mutations now rely on the
authenticated manager session plus optional `managerNodeExecId` consistency
checks instead of accepting a node-addressed execution identity from the
caller. While verifying this slice, the targeted server GraphQL suite exposed a
stale fixture in `src/server/graphql.test.ts` that still authored top-level
`workflowCalls` on a role-authored bundle; that fixture was corrected to the
surviving legacy node-graph form (`kind`-authored nodes) so the test continues
to cover the remaining compatibility behavior without weakening the new
validation rules. Added a focused HTTP regression asserting that legacy
`managerRuntimeId` is now rejected as an unknown GraphQL input field.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for the remaining runtime-visible legacy node-graph schema
branches, especially validator/runtime handling for actual legacy structural
companions and authored workflow-call execution. Module 2 runtime/control
cleanup still remains open for root/sub branching cleanup and the remaining
explicit legacy node-graph workflow-call execution path. Module 3 broader
public-surface cleanup and module 4 examples/docs retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun test src/server/graphql.test.ts src/graphql/schema.test.ts --runInBand`
(`56` pass)
and
`bun run typecheck:server`
(`tsc --noEmit` passed). Plan status remains `In Progress`, so
`impl-plans/PROGRESS.json` did not require a status update in this slice.

### Session: 2026-04-26 19:17 JST (module 1 slice: reject step-addressed legacy `workflowCalls` by top-level presence)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended step-addressed runtime/public
surface still matches the active design docs and this implementation plan, so
no design pivot or replacement plan was needed. Continued module 1 by
removing the last dead step-addressed compatibility branch that still treated
top-level `workflow.workflowCalls` specially in `src/workflow/validate.ts` and
`src/workflow/save.ts`. Step-addressed bundles now reject `workflowCalls`
purely by top-level presence, matching the rest of the banned legacy
companions, instead of first traversing legacy array-shape checks and emitting
different wording for malformed values. Updated the focused regressions in
`src/workflow/validate.test.ts` and `src/workflow/save.test.ts` so the
surviving behavior is asserted directly: malformed step-addressed
`workflowCalls` inputs now fail with the same schema-level incompatibility
diagnostic as populated ones.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for the remaining runtime-visible legacy node-graph schema
branches, especially validator/runtime handling for actual legacy structural
companions and authored workflow-call execution. Module 2 runtime/control
cleanup still remains open for root/sub branching cleanup and the remaining
explicit legacy node-graph workflow-call execution path. Module 3
public-surface cleanup and module 4 examples/docs retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun test src/workflow/validate.test.ts src/workflow/save.test.ts`
(`233` pass)
and
`bun run typecheck:server`
(`tsc --noEmit` passed). Plan status remains `In Progress`, so
`impl-plans/PROGRESS.json` did not require a status update in this slice.

### Session: 2026-04-26 19:14 JST (module 1 slice: reject malformed role-authored legacy structural companions by top-level presence)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended step-addressed runtime/public
surface still matches the active design docs and this implementation plan, so
no design pivot or replacement plan was needed. Continued module 1 by
tightening `src/workflow/validate.ts` so role-authored bundles now reject any
top-level presence of legacy `workflowCalls`, `edges`, `loops`,
`subWorkflows`, and `subWorkflowConversations`, even when those authored values
are malformed non-array shapes. That removes the remaining dead validator
branches that were still reporting legacy array-shape errors (`must be an
array when provided`) for role-authored bundles instead of failing immediately
on the unsupported compatibility field. Updated the focused regressions in
`src/workflow/validate.test.ts`, `src/workflow/load.test.ts`, and
`src/workflow/save.test.ts` so validation, load, and save all assert the
surviving behavior only: malformed role-authored legacy structural companions
fail on the top-level compatibility field and do not fall back into legacy
shape-validation wording.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for the remaining runtime-visible legacy node-graph schema
branches, especially the validator/runtime handling for real legacy structural
companions and authored workflow-call execution. Module 2 runtime/control
cleanup still remains open for root/sub branching cleanup and the remaining
explicit legacy node-graph workflow-call execution path. Module 3
public-surface cleanup and module 4 examples/docs retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`310` pass)
and
`bun run typecheck:server`
(`tsc --noEmit` passed). Plan status remains `In Progress`, so
`impl-plans/PROGRESS.json` did not require a status update in this slice.

### Session: 2026-04-26 19:10 JST (module 1 slice: tighten the primary authored workflow type surface)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended step-addressed runtime/public
surface still matches the active design docs and this implementation plan, so
no design pivot or replacement plan was needed. Continued module 1 by
tightening the primary authored workflow type surface in `src/workflow/types.ts`:
`AuthoredWorkflowJson` no longer inherits a permissive string index signature
and no longer advertises legacy top-level compatibility keys such as
`managerRuntimeId`, `entryNodeId`, `workflowCalls`, `subWorkflows`,
`subWorkflowConversations`, `edges`, and `loops`. In `src/workflow/save.ts`,
the remaining save-time compatibility inspection was kept explicit by routing
those raw authored-key reads through a local record-typed alias instead of the
public authored type. Added `src/workflow/types.test.ts` as a compile-time
guardrail so `typecheck` now fails if those legacy keys are accidentally
reintroduced onto `AuthoredWorkflowJson`.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for the remaining runtime-visible legacy node-graph schema
branches, especially the validator/runtime handling for legacy structural
companions and authored workflow-call execution. Module 2 runtime/control
cleanup still remains open for root/sub branching cleanup and the remaining
explicit legacy node-graph workflow-call execution path. Module 3
public-surface cleanup and module 4 examples/docs retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun test src/workflow/types.test.ts src/workflow/save.test.ts --runInBand`
(`50` pass)
and
`bun run typecheck:server`
(`tsc --noEmit` passed). Plan status remains `In Progress`, so
`impl-plans/PROGRESS.json` did not require a status update in this slice.

### Session: 2026-04-26 18:57 JST (module 1 slice: remove authored legacy `branching` support)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended step-addressed runtime/public
surface still matches the active design docs and this implementation plan, so
no design pivot or replacement plan was needed. Continued module 1 by
removing authored legacy `workflow.branching` support end-to-end:
`AuthoredWorkflowJson` in `src/workflow/types.ts` no longer advertises the
field, `src/workflow/validate.ts` now rejects any authored top-level
`workflow.branching` instead of still accepting it on the legacy node-graph
path, and `src/workflow/save.ts` no longer strips `branching` before
validation in a way that would have hidden the unsupported field during save.
Updated `src/workflow/load.test.ts`, `src/workflow/save.test.ts`, and
`src/workflow/validate.test.ts` so positive fixtures no longer depend on
authored `branching`, and the focused regressions now assert the surviving
behavior only: authored `workflow.branching` is rejected outright.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for the broader legacy node-graph schema branches, especially the
remaining authored/public compatibility fields and deeper structural validator
paths. Module 2 runtime/control cleanup still remains open for root/sub
branching cleanup and the remaining explicit legacy node-graph workflow-call
execution path. Module 3 public-surface cleanup and module 4
examples/docs retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`307` pass)
and
`bun run typecheck:server`
(`tsc --noEmit` passed). Plan status remains `In Progress`, so
`impl-plans/PROGRESS.json` did not require a status update in this slice.

### Session: 2026-04-26 18:52 JST (module 1 slice: remove normalized legacy `entryNodeId` from the primary workflow surface)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended step-addressed runtime/public
surface still matches the active design docs and the existing phase-133
implementation plan, so no design pivot or replacement plan was needed.
Continued module 1 by removing `entryNodeId` from the primary normalized
`WorkflowJson` surface in `src/workflow/types.ts`, adding
`getLegacyEntryNodeId(...)` for the remaining legacy node-graph access, and
switching the remaining persistence, semantic validation, and supervision
projection reads to that helper. Updated the focused workflow and GraphQL
tests so they assert the surviving helper-based legacy behavior instead of
reaching through the normalized/public workflow type.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for the remaining compatibility identifiers, especially the
still-exposed normalized `managerRuntimeId` alias and the broader legacy
node-graph normalization branches. Module 2 runtime/control cleanup still
remains open for root/sub branching cleanup and the remaining explicit legacy
node-graph workflow-call execution path. Module 3 public-surface cleanup and
module 4 example/doc retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/superviser.test.ts src/workflow/runtime-addressing.test.ts src/graphql/schema.test.ts --runInBand`
(`373` pass)
and
`bun run typecheck:server`
(`tsc --noEmit` passed). Plan status remains `In Progress`, so
`impl-plans/PROGRESS.json` did not require a status update in this slice.

### Session: 2026-04-26 19:06 JST (module 1/3 slice: reject role-authored legacy `edges` / `loops`)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended step-addressed runtime/public
surface remains correct, and the active phase-133 plan is still the right
implementation plan, so no replacement design or new plan split was needed.
Continued module 1 by tightening `src/workflow/validate.ts` so role-authored
bundles now reject legacy top-level `edges` and `loops` the same way they
already reject legacy `workflowCalls`, `branching`, and structural companions.
The validator now fails on top-level presence and no longer descends into
legacy edge/loop entry normalization for that path. Updated the focused
load/save/validate regressions and trimmed surviving role-authored fixtures so
they stop carrying empty compatibility `edges` / `loops`.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for the remaining compatibility identifiers and the broader legacy
node-graph normalization branches. Module 2 runtime/control cleanup still
remains open for root/sub branching cleanup and the remaining explicit legacy
node-graph workflow-call execution path. Module 3 public-surface cleanup and
module 4 example/doc retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts`
and
`bun run typecheck:server`

### Session: 2026-04-26 18:38 JST (module 1/3 slice: remove normalized legacy `loops` from the primary workflow surface)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed-first cleanup, so no replacement design or new implementation
plan was needed. Continued the legacy field removal by deleting `loops` from
the primary normalized `WorkflowJson` type in `src/workflow/types.ts`, adding
`getLegacyAuthoredLoops(...)` for the remaining raw legacy node-graph read
path, and updating `src/workflow/save.ts` so legacy persistence reads authored
loop companions through that helper instead of the primary normalized/public
workflow surface. Aligned the affected workflow tests so they assert surviving
helper-based legacy behavior rather than direct public-property access.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of the remaining legacy compatibility fields
from the normalized/public workflow surface, especially the still-exposed
manager/entry compatibility ids and the validator branches that still
materialize broader structural legacy bundles. Module 2 runtime/control cleanup
still remains open for root/sub branching cleanup and the remaining explicit
legacy node-graph workflow-call execution path. Module 3 public-surface cleanup
and module 4 example/doc retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts src/workflow/conversation.test.ts src/workflow/manager-control.test.ts src/workflow/prompt-composition.test.ts src/workflow/sub-workflow.test.ts src/workflow/visualization.test.ts --runInBand`
(`361` pass). Plan status remains `In Progress`, so `impl-plans/PROGRESS.json`
did not require a status update in this slice.

### Session: 2026-04-26 18:35 JST (module 1/3 slice: remove normalized legacy `edges` from the primary workflow surface)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed-first cleanup, so no replacement design or new implementation
plan was needed. Continued the legacy field removal by deleting `edges` from
the primary normalized `WorkflowJson` type in `src/workflow/types.ts` and
keeping the remaining legacy node-graph authored-edge access behind the new
`getLegacyAuthoredEdges(...)` helper only. Updated `src/workflow/save.ts` so
legacy persistence reads authored edge companions through that helper instead
of the primary normalized workflow surface, and aligned the affected workflow
and TUI fixture tests so legacy node-graph bundles explicitly opt into the
helper-only edge companion rather than treating `workflow.edges` as part of the
default normalized/public type.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of the remaining legacy compatibility fields
from the normalized/public workflow surface, especially the still-exposed
legacy `loops`, manager/entry compatibility ids, and the validator branches
that still materialize broader structural legacy bundles. Module 2
runtime/control cleanup still remains open for root/sub branching cleanup and
the remaining explicit legacy node-graph workflow-call execution path. Module 3
public-surface cleanup and module 4 example/doc retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts src/workflow/conversation.test.ts src/workflow/manager-control.test.ts src/workflow/prompt-composition.test.ts src/workflow/runtime-addressing.test.ts src/workflow/runtime-readiness.test.ts src/workflow/sub-workflow.test.ts src/workflow/visualization.test.ts src/tui/opentui-controller.test.ts src/tui/opentui-detail-content.test.ts src/tui/opentui-screen.test.ts --runInBand`
(`471` pass). Plan status remains `In Progress`, so `impl-plans/PROGRESS.json`
did not require a status update in this slice.

### Session: 2026-04-26 18:22 JST (module 1/3 slice: remove normalized `workflowCalls` from the primary workflow surface)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed-first cleanup, so no replacement design or new implementation
plan was needed. Continued the legacy field removal by deleting
`workflowCalls` from the primary normalized `WorkflowJson` type in
`src/workflow/types.ts` and routing the remaining legacy node-graph access
through `getLegacyWorkflowCalls(...)` only. Updated
`src/workflow/save.ts` and `src/workflow/cross-workflow-from-steps.ts` so
legacy persistence and dispatch helpers read compatibility workflow-call data
through that helper instead of the primary normalized surface. Aligned the
affected tests in `src/workflow/*.test.ts` and `src/tui/opentui-screen.test.ts`
so they assert surviving helper-based legacy behavior rather than direct public
property access on normalized workflows.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of the remaining legacy compatibility fields
from the normalized/public workflow surface, especially the still-persisted
legacy node-graph `edges` / `loops` companions and broader validator branches
that still materialize structural legacy bundles. Module 2 runtime/control
cleanup still remains open for root/sub branching cleanup and the remaining
explicit legacy node-graph workflow-call execution path. Module 3
public-surface cleanup and module 4 example/doc retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/cross-workflow-from-steps.test.ts src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/runtime-readiness.test.ts src/workflow/manager-control.test.ts src/workflow/prompt-composition.test.ts src/tui/opentui-screen.test.ts --runInBand`
(`427` pass). Plan status remains `In Progress`, so `impl-plans/PROGRESS.json`
did not require a status update in this slice.

### Session: 2026-04-26 18:17 JST (module 1/3 slice: remove normalized `subWorkflows` from the primary workflow surface)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed-first cleanup, so no replacement design or new implementation
plan was needed. Continued the legacy field removal by deleting
`subWorkflows` from the primary normalized `WorkflowJson` type in
`src/workflow/types.ts` and routing the remaining legacy persistence/read paths
through `getStructuralSubWorkflows(...)` instead of direct normalized-property
access. Updated `src/workflow/save.ts` to persist structural sub-workflows only
through that helper, removed compatibility-only empty `subWorkflows: []`
fixtures from step-addressed/public-surface tests, and aligned the remaining
legacy structural tests so they assert helper-based behavior rather than direct
public access to the compatibility field.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of the remaining legacy compatibility fields
from the normalized/public workflow surface, especially `workflowCalls`, the
still-persisted legacy node-graph `edges` / `loops`, and broader validator
branches that still materialize structural companions for legacy bundles.
Module 2 runtime/control cleanup still remains open for root/sub branching
cleanup and the remaining explicit legacy node-graph workflow-call execution
path. Module 3 public-surface cleanup and module 4 example/doc retirement both
remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/conversation.test.ts src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts src/workflow/manager-control.test.ts src/workflow/prompt-composition.test.ts src/workflow/runtime-addressing.test.ts src/workflow/runtime-readiness.test.ts src/workflow/sub-workflow.test.ts src/workflow/visualization.test.ts src/tui/opentui-controller.test.ts src/tui/opentui-detail-content.test.ts src/tui/opentui-screen-navigation.test.ts src/tui/opentui-screen-runtime.test.ts src/tui/opentui-screen.test.ts --runInBand`
(`516` pass). Plan status remains `In Progress`, so `impl-plans/PROGRESS.json`
did not require a status update in this slice.

### Session: 2026-04-26 18:12 JST (module 1/3 slice: remove normalized `subWorkflowConversations` from the primary workflow surface)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed-first cleanup, so no replacement design or new implementation
plan was needed. Continued the legacy field removal by deleting
`subWorkflowConversations` from the primary normalized `WorkflowJson` type in
`src/workflow/types.ts` and keeping the legacy runtime/save path behind
`getLegacySubWorkflowConversations(...)` only. Updated
`src/workflow/save.ts` so legacy re-save persistence reads conversation
companions through that helper instead of the primary workflow surface, and
aligned the focused workflow tests so they assert the surviving helper-based
behavior rather than direct public access to the compatibility field.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of the remaining legacy compatibility fields
from the normalized/public workflow surface, especially `workflowCalls`,
`subWorkflows`, and the still-persisted legacy node-graph structural
companions. Module 2 runtime/control cleanup still remains open for root/sub
branching cleanup and the remaining explicit legacy node-graph workflow-call
execution path. Module 3 public-surface cleanup and module 4 example/doc
retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/conversation.test.ts src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts --runInBand`
(`304` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 16:16 JST (module 1 slice: ignore stale legacy manager-entry aliases during managed role-authored validation)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed-first cleanup, so no replacement design or new implementation
plan was needed. Continued the authored-schema/validation cutover by tightening
`src/workflow/validate.ts` so managed role-authored bundles no longer let stale
legacy `managerRuntimeId` / `entryNodeId` aliases drive downstream manager-entry
inference or semantic validation once those top-level compatibility fields have
already been rejected. Added focused regressions in
`src/workflow/validate.test.ts` and `src/workflow/load.test.ts` to prove that
direct validation and load-time validation now stop at the intended top-level
compatibility errors instead of leaking secondary legacy manager-entry
diagnostics. Also added a save-path regression in `src/workflow/save.test.ts`
to pin the existing canonicalization contract: save strips those stale aliases
before validation rather than persisting them back out.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of legacy compatibility fields and the
remaining normalization branches around legacy node-graph bundles, especially
non-empty authored `workflowCalls`, structural `subWorkflows`, and other direct
node-addressed companions that are still part of the legacy schema/type
surface. Module 2 runtime/control cleanup still remains open for root/sub
branching cleanup and the remaining explicit legacy node-graph workflow-call
execution path. Module 3 public-surface cleanup and module 4 example/doc
retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`296` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 16:09 JST (module 1 slice: stop traversing legacy structural entry validation on role-authored bundles)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed-first cleanup, so no replacement design or new implementation
plan was needed. Continued the authored-schema/validation cutover by tightening
`src/workflow/validate.ts` so role-authored bundles that carry legacy
`subWorkflows` or `subWorkflowConversations` now fail only on the top-level
compatibility-presence rule instead of also traversing nested legacy structural
entry validation. Added focused regression coverage in
`src/workflow/validate.test.ts` and `src/workflow/save.test.ts` to prove that
malformed legacy structural entries on role-authored bundles no longer leak
secondary nested diagnostics through direct validation or save-time validation.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of legacy compatibility fields and the
remaining normalization branches around legacy node-graph bundles, especially
non-empty authored `workflowCalls`, structural `subWorkflows`, and other direct
node-addressed companions that are still part of the legacy schema/type
surface. Module 2 runtime/control cleanup still remains open for root/sub
branching cleanup and the remaining explicit legacy node-graph workflow-call
execution path. Module 3 public-surface cleanup and module 4 example/doc
retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`293` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 16:02 JST (module 1 slice: drop dead normalized branching companion from runtime/save surface)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed-first cleanup, so no replacement design or new implementation
plan was needed. Continued the authored-schema cleanup by removing the dead
normalized `WorkflowJson.branching` compatibility companion from
`src/workflow/types.ts` and deleting the unreachable legacy save passthrough in
`src/workflow/save.ts`. This matches current runtime behavior: validation may
still accept authored legacy `branching` as compatibility input, but normalized
bundles already omit it and save canonicalization already strips it. Updated the
affected workflow/TUI fixture suites so typed normalized `WorkflowJson` test
objects no longer construct that dead field, while the remaining assertions now
check the runtime object shape through plain record access where needed.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of legacy compatibility fields and the
remaining normalization branches around legacy node-graph bundles, especially
non-empty authored `workflowCalls`, structural `subWorkflows`, and other direct
node-addressed companions that are still part of the legacy schema/type
surface. Module 2 runtime/control cleanup still remains open for root/sub
branching cleanup and the remaining explicit legacy node-graph workflow-call
execution path. Module 3 public-surface cleanup and module 4 example/doc
retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`286` pass),
plus
`bun test src/workflow/conversation.test.ts src/workflow/manager-control.test.ts src/workflow/prompt-composition.test.ts src/workflow/runtime-addressing.test.ts src/workflow/runtime-readiness.test.ts src/workflow/sub-workflow.test.ts src/workflow/visualization.test.ts src/tui/opentui-controller.test.ts src/tui/opentui-detail-content.test.ts src/tui/opentui-screen-navigation.test.ts src/tui/opentui-screen-runtime.test.ts src/tui/opentui-screen.test.ts --runInBand`
(`220` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 15:57 JST (module 1/3 slice: isolate legacy subWorkflowConversations behind helper readers)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed-first cleanup, so no replacement design or new implementation
plan was needed. While reviewing the remaining runtime and validation seams, I
found that `subWorkflowConversations` was still being read directly from
`WorkflowJson` even though step-addressed bundles reject that authored
compatibility companion. Added
`getLegacySubWorkflowConversations(...)` in `src/workflow/types.ts` and routed
the remaining runtime/validation readers through it in
`src/workflow/conversation.ts` and `src/workflow/validate.ts`, so the active
step-addressed model no longer relies on the primary workflow surface exposing
that legacy field. Added focused regression coverage in
`src/workflow/conversation.test.ts` to assert that step-addressed workflows
ignore legacy conversation companions entirely.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of legacy compatibility fields and the
remaining normalization branches around legacy node-graph bundles, especially
non-empty authored `workflowCalls`, structural `subWorkflows`, and other direct
node-addressed companions that are still part of the legacy schema/type
surface. Module 2 runtime/control cleanup still remains open for root/sub
branching cleanup and the remaining explicit legacy node-graph workflow-call
execution path. Module 3 public-surface cleanup and module 4 example/doc
retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/conversation.test.ts src/workflow/validate.test.ts src/workflow/engine.test.ts --runInBand`
(`287` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 15:53 JST (module 1/2 review slice: remove mixed workflowCalls helper input shapes)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed-first cleanup, so no replacement design or new implementation
plan was needed. Continued the cleanup by tightening
`src/workflow/cross-workflow-from-steps.ts` so the shared cross-workflow
projection helpers now take an explicit step-addressed-or-legacy source shape
instead of advertising a mixed `steps + workflowCalls` contract that validated
step-addressed bundles can never expose. Simplified the focused helper tests in
`src/workflow/cross-workflow-from-steps.test.ts` so they no longer construct
impossible hybrid step-addressed bundles with authored top-level
`workflowCalls`, leaving rejection coverage to `src/workflow/validate.test.ts`.
While rerunning focused verification, I also found and fixed an outdated
continuation fixture in `src/workflow/runtime-readiness.test.ts` that still
mixed legacy `workflowCalls` with role-authored nodes; it now uses true legacy
kind-authored node-graph fixtures so the recursive workflow-call readiness test
exercises the intended compatibility path again.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of legacy compatibility fields and the
remaining normalization branches around legacy node-graph bundles, especially
non-empty authored `workflowCalls`, structural `subWorkflows`, and other direct
node-addressed companions that are still part of the legacy schema/type
surface. Module 2 runtime/control cleanup still remains open for root/sub
branching cleanup and the remaining explicit legacy node-graph workflow-call
execution path. Module 3 public-surface cleanup and module 4 example/doc
retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/cross-workflow-from-steps.test.ts src/workflow/runtime-readiness.test.ts src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`310` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 15:48 JST (module 1 slice: stop normalizing implicit legacy entryNodeId aliases)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed-first cleanup, so no replacement design or new implementation
plan was needed. While reviewing the dirty continuation diff, I found another
remaining legacy companion synthesis seam: managed legacy node-graph bundles
were still normalizing `entryNodeId` even when the author only declared
`managerRuntimeId`. Tightened `src/workflow/validate.ts` so normalized legacy
bundles now keep authored `entryNodeId` only when it was actually present in
the source workflow, while shared entry resolution continues to flow through
`resolveWorkflowEntryRuntimeId(...)`. Updated the focused load/save/validate
regressions so they assert runtime entry resolution through the helper instead
of depending on the synthesized compatibility alias.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of legacy compatibility fields and the
remaining normalization branches around legacy node-graph bundles, especially
non-empty authored `workflowCalls`, structural `subWorkflows`, and other direct
node-addressed companions that are still part of the legacy schema/type
surface. Module 2 runtime/control cleanup still remains open for root/sub
branching cleanup and the remaining explicit legacy node-graph workflow-call
execution path. Module 3 public-surface cleanup and module 4 example/doc
retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`286` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 15:44 JST (module 1/2 slice: isolate legacy workflowCalls from step-addressed readers)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed-first cleanup, so no replacement design or new implementation
plan was needed. While reviewing the continuation diff, I found one remaining
shape-drift seam: shared helpers and semantic validation still treated
`workflow.workflowCalls` as if it were part of the active step-addressed model,
even though step-addressed validation/load already reject that authored field.
Narrowed that seam by adding shared `isStepAddressedWorkflow(...)` and
`getLegacyWorkflowCalls(...)` helpers in `src/workflow/types.ts`, routing
cross-workflow projections and inspection through the shared shape guard, and
limiting semantic `workflowCalls` checks in `src/workflow/validate.ts` to the
legacy node-graph path only. Also corrected the stale architecture note that
still described step-addressed runtime execution as a mixed union with explicit
legacy `workflowCalls`.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of legacy compatibility fields and the
remaining normalization branches around legacy node-graph bundles, especially
non-empty authored `workflowCalls`, structural `subWorkflows`, and other direct
node-addressed companions that are still part of the legacy schema/type
surface. Module 2 runtime/control cleanup still remains open for root/sub
branching cleanup and the remaining explicit legacy node-graph workflow-call
execution path. Module 3 public-surface cleanup and module 4 example/doc
retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/cross-workflow-from-steps.test.ts src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`295` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 15:38 JST (module 2 slice: rename manager-control parser/runtime context to step-safe runtime ids)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed-first cleanup, so no replacement design or new implementation
plan was needed. While reviewing the active diff for remaining direct
node-addressed assumptions, I found that manager-control parsing and optional
decision application still threaded a `managerRuntimeId` context name even on the
active step-addressed runtime path where the value is a runtime step id. Narrowed
that seam by renaming the parser/control context to `managerRuntimeId`,
removing local "manager node" wording from manager-control diagnostics, and
updating the engine, manager-message-service, and GraphQL manager-mutation
callers to pass the shared runtime id rather than a node-addressed alias.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of legacy compatibility fields and the
remaining normalization branches around legacy node-graph bundles, especially
non-empty authored `workflowCalls`, structural `subWorkflows`, and other direct
node-addressed companions that are still part of the legacy schema/type
surface. Module 2 runtime/control cleanup still remains open for root/sub
branching cleanup and the remaining explicit legacy node-graph workflow-call
execution path. Module 3 public-surface cleanup and module 4 example/doc
retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/manager-control.test.ts src/workflow/manager-message-service.test.ts src/graphql/schema.test.ts --runInBand`
(`60` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 15:32 JST (module 2 slice: remove dead mixed workflow-call union helper path)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended architecture still matches the
active plan, so no replacement design or new implementation plan was needed.
Reviewed the remaining cross-workflow helper seam and found that
`src/workflow/cross-workflow-from-steps.ts` still carried a mixed union path
that tried to merge explicit legacy `workflow.workflowCalls` with step-derived
`steps[].transitions` rows on the same normalized workflow object. That shape is
no longer a meaningful validated load target: current validation/load now treat
bundles as either step-addressed (`entryStepId` + `steps[]`, explicit
`workflowCalls` rejected/ignored) or legacy node-graph (`workflowCalls`
compatibility only). Simplified `effectiveWorkflowCalls(...)` and
`crossWorkflowDispatchesForExecutionMatch(...)` so step-addressed bundles use
only derived `__cw:*` transitions while legacy node-graph bundles preserve only
their authored top-level `workflowCalls`. Updated the focused helper tests and
the engine comment to match the actual architecture.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of legacy compatibility fields and the
remaining normalization branches around legacy node-graph bundles, especially
non-empty authored `workflowCalls`, structural `subWorkflows`, and other direct
node-addressed companions that are still part of the legacy schema/type
surface. Module 2 runtime/control cleanup still remains open for root/sub
branching cleanup and the remaining explicit legacy node-graph workflow-call
execution path. Module 3 public-surface cleanup and module 4 example/doc
retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/cross-workflow-from-steps.test.ts src/workflow/engine.test.ts --runInBand`
(`114` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 15:28 JST (module 1 slice: canonicalize raw legacy save no-op companions)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended architecture still matches the
active plan, so no replacement design or new implementation plan was needed.
While reviewing the dirty continuation diff, I found a save-path gap rather
than a design gap: raw legacy workflow saves could still preserve no-op
compatibility companions (`workflowCalls: []`, structural empty arrays, default
`branching`, and synthesized `edges`) when those keys were present in the
incoming JSON, even though loaded/normalized legacy bundles already omitted
them. Tightened `src/workflow/save.ts` so this canonicalization now runs only
for true legacy node-graph save candidates, preserving validation failures for
step-addressed or role/control-authored inputs. Added a focused regression in
`src/workflow/save.test.ts` that exercises the existing-bundle raw-save path and
asserts those no-op companions are stripped while structural routing still
reloads through `getStructuralEdges(...)`.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of legacy compatibility fields and the
remaining normalization branches around legacy node-graph bundles, especially
non-empty authored `workflowCalls`, structural `subWorkflows`, and other direct
node-addressed companions that are still part of the legacy schema/type
surface. Module 2 runtime/control cleanup still remains open for root/sub
branching cleanup and the remaining legacy node-graph cross-workflow dispatch
union path. Module 3 public-surface cleanup and module 4 example/doc retirement
both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`286` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 15:24 JST (module 1/3 slice: route remaining entry/sub-workflow compatibility reads through shared helpers)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended architecture still matches the
active plan, so no replacement design or new implementation plan was needed.
Reviewed the active diff and ran a broader continuation sweep
(`bun run typecheck:server` plus
`bun test src/workflow/engine.test.ts src/tui/opentui-screen.test.ts src/workflow/visualization.test.ts --runInBand`)
to confirm there was no hidden regression to fix first. Continued the cleanup
with a small helper-oriented slice: `src/workflow/types.ts` now exposes
`resolveWorkflowEntryRuntimeId(...)` alongside the existing manager runtime-id
helper, `src/tui/opentui-model/workflow-rendering.ts` now uses those shared
helpers for legacy entry/manager preview text instead of raw
`entryNodeId`/`managerRuntimeId` fallbacks, and `src/workflow/validate.ts` now
uses `getStructuralSubWorkflows(...)` for semantic validation instead of
re-reading the optional compatibility field directly. Added focused helper
coverage in `src/workflow/validate.test.ts` so step-addressed and legacy entry
resolution semantics are asserted explicitly.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of legacy compatibility fields and the
remaining normalization branches around legacy node-graph bundles, especially
`workflowCalls`, structural `subWorkflows`, and direct node-addressed
companions that are still persisted or publicly exposed. Module 2
runtime/control cleanup still remains open for root/sub branching cleanup and
the remaining legacy node-graph cross-workflow dispatch union path. Module 3
public-surface cleanup and module 4 example/doc retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/tui/opentui-screen.test.ts --runInBand`
(`246` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 15:18 JST (module 1 slice: stop synthesizing repeat-driven legacy `workflow.loops` companions)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended architecture still matches the
active plan, so no replacement design or new implementation plan was needed.
Continued module 1 by removing another normalized legacy companion:
`src/workflow/validate.ts` no longer synthesizes repeat-driven
`workflow.loops` onto normalized legacy bundles. Added
`getStructuralLoops(...)` in `src/workflow/types.ts` so runtime, inspection,
validation, and visualization now derive repeat loop projections from authored
`workflow.loops` plus node-local `repeat` metadata at read time instead of
depending on a materialized normalized field. During verification I found two
real continuation gaps in `src/workflow/engine.test.ts`: workflow-call runtime
fixtures were still authored with legacy `workflowCalls` on role-authored
parents that the current validator now correctly rejects, and one runtime DB
assertion relied on implicit root-data-dir inference. I converted those
workflow-call parents/callees to the active step-addressed cross-workflow form,
aligned the missing-callee expectation with the earlier validation failure, and
made the runtime DB assertion use an explicit `rootDataDir`.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of legacy compatibility fields and the
remaining normalization branches around legacy node-graph bundles, especially
`workflowCalls`, structural `subWorkflows`, and direct node-addressed
companions that are still persisted or publicly exposed. Module 2
runtime/control cleanup still remains open for root/sub branching cleanup and
the remaining legacy node-graph cross-workflow dispatch union path. Module 3
public-surface cleanup and module 4 example/doc retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/engine.test.ts src/workflow/visualization.test.ts --runInBand`
(`394` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 15:10 JST (module 1 slice: stop synthesizing omitted legacy `workflow.edges` companions)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. The intended architecture still matches the
active plan, so no replacement design or new implementation plan was needed,
but `design-docs/specs/architecture.md` had a stale implementation note that
still claimed step-addressed normalization could synthesize compatibility
`managerRuntimeId` / `subWorkflows` / `edges`; I corrected that note to match the
current code. Continued module 1 by removing another normalized compatibility
companion from the legacy node-graph path: when a legacy bundle omits authored
top-level `workflow.edges`, `src/workflow/validate.ts` now keeps the normalized
bundle free of synthesized `edges` and uses `getStructuralEdges(...)` as the
shared reader-time projection for sequential/repeat routing instead. Preserved
legacy validation diagnostics for invalid repeat/restart authoring, added a
focused helper regression in `src/workflow/validate.test.ts`, and updated the
legacy reload/save regressions in `src/workflow/save.test.ts` so they assert
derived edges through the shared helper rather than relying on a normalized
compatibility field.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of legacy compatibility fields and the
remaining normalization branches around legacy node-graph bundles, especially
`workflowCalls`, `loops`, structural `subWorkflows`, and other direct
node-addressed companions. Module 2 runtime/control cleanup still remains open
for root/sub branching cleanup and the remaining legacy node-graph
cross-workflow dispatch union path. Module 3 public-surface cleanup and module
4 example/doc retirement both remain open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`280` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 15:05 JST (module 3/4 follow-up slice: convert stale GraphQL/load fixtures to strict step-addressed bundles)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed-first cleanup, so no new design document or replacement
implementation plan was needed. While reviewing the active diff and running a
broader verification sweep, I found a real continuation gap in tests that were
not supposed to preserve compatibility behavior: worker-only add-on fixtures in
`src/workflow/load.test.ts` and `src/graphql/schema.test.ts` were still authored
as legacy `entryNodeId`/`edges`/`branching` bundles, and a GraphQL workflow
inspection fixture still depended on authored top-level `workflowCalls` on a
role-authored parent. Converted those fixtures to strict step-addressed
worker-only/managed bundles with `entryStepId`, `steps[]`, and step-transition
cross-workflow dispatch (`__cw:main-worker`), and removed stale
`edges: []` companions from the GraphQL worker-only save-conversion bundles that
the current save validator now correctly rejects.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of legacy compatibility fields and the
remaining normalization branches around legacy node-graph bundles. Module 2
runtime/control cleanup still remains open for root/sub branching cleanup and
the remaining legacy node-graph cross-workflow dispatch union path. Module 3
public-surface cleanup still remains open for production callers that still
expose or describe legacy compatibility surfaces beyond these aligned tests and
fixtures. Module 4 broader example/doc retirement still remains open.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/load.test.ts src/graphql/schema.test.ts --runInBand`
(`178` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 14:57 JST (module 1 slice: stop synthesizing step-addressed `workflow.edges` companions)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed-first cleanup, so no new design document or replacement
implementation plan was needed. Continued module 1 by removing normalized
step-addressed `workflow.edges` synthesis from `src/workflow/validate.ts` and
making `getStructuralEdges(...)` the authoritative reader path for local
step-to-step routing. Tightened `src/workflow/save.ts` so step-addressed saves
now reject any top-level `workflow.edges` companion, even when it exactly
matches the step graph, instead of silently tolerating a copied legacy field.
During verification this exposed a real continuation bug in the worker-only
conversion save tests: those fixtures were still carrying `edges: []` from the
old normalized shape, so I updated them to use the strict step-addressed bundle
they are actually meant to model and added a focused regression that matched
top-level `edges` are rejected too.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of legacy compatibility fields and the
remaining normalization branches around legacy node-graph bundles. Module 2
runtime/control cleanup still remains open for root/sub branching cleanup and
the remaining legacy node-graph cross-workflow dispatch union path. Module 3
public-surface cleanup still remains open for callers that still expose or
describe legacy compatibility surfaces.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`279` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 14:52 JST (module 1/2 slice: split legacy authored workflowCalls from step-derived projections)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed-first cleanup, so no new design document or replacement
implementation plan was needed. Continued the compatibility-removal work by
separating authored legacy `workflow.workflowCalls` from step-derived helper
projections: `src/workflow/types.ts` no longer models authored
`WorkflowCallRef` with step-only `callerStepId`, and
`src/workflow/cross-workflow-from-steps.ts` now returns dedicated
source-tagged derived rows for inspection/runtime helpers instead of reusing the
legacy authored type. Updated the focused workflow-call helper tests plus the
step-addressed validation expectations so derived step-transition projections
explicitly report `source: "step-transition"` while legacy authored
`workflowCalls` remain labeled as compatibility-only projections.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader removal of top-level legacy compatibility fields and
their remaining normalization branches. Module 2 runtime/control cleanup still
remains open for root/sub branching cleanup and the remaining legacy node-graph
cross-workflow dispatch union path. Module 3 public-surface cleanup still
remains open for callers that still expose or describe legacy compatibility
surfaces beyond this helper/type split.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/cross-workflow-from-steps.test.ts src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`289` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 14:19 JST (module 1 slice: centralize structural edge projection for step-addressed readers)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed-first cleanup, so no new design document or replacement
implementation plan was needed. Continued module 1 by adding a shared
`getStructuralEdges(...)` helper in `src/workflow/types.ts` that derives local
step-addressed routing from `steps[].transitions` instead of assuming
step-addressed bundles must expose the legacy `workflow.edges` companion.
Switched `src/workflow/engine.ts`, `src/workflow/validate.ts`,
`src/workflow/inspect.ts`, `src/workflow/visualization.ts`, and
`src/web/workflow-viewer.tsx` to use that helper, and added focused regression
coverage in `src/workflow/validate.test.ts` proving that step-addressed readers
prefer derived edges while legacy node-graph bundles still use authored
`workflow.edges`.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for actual removal of synthesized `edges`, `loops`, and other
legacy structural companions from normalized bundles. Module 2 runtime/control
cleanup still remains open for the broader root/sub branching cleanup and the
remaining legacy node-graph cross-workflow union path. Module 3 public-surface
cleanup still remains open beyond the structural-edge reader isolation landed
here.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/cross-workflow-from-steps.test.ts src/workflow/sub-workflow.test.ts --runInBand`
(`298` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 (review slice: shared runtime-addressing reuse + unit coverage)

**Tasks Completed**: Continued the maintainability review after the direct-step
runtime cleanup and found one more duplicated ownership rule outside the engine:
the OpenTUI shared model still carried its own copy of "which structural
sub-workflow owns this runtime node id?" while `engine.ts` and
`call-step-impl.ts` had already moved to `src/workflow/runtime-addressing.ts`.
Replaced the TUI-local copy with the shared helper and added focused unit tests
for `resolveStepExecutionAddress`, `resolveBackendSessionSelection`, and the
shared workflow output-kind helper (`isWorkflowOutputKindNode`, formerly
`isRootScopeOutputNode`) so future
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

**Tasks Completed**: Clarified on `WorkflowJson.managerRuntimeId` and `resolveWorkflowManagerRuntimeId` that normalized step-addressed bundles use the **step** id namespace for execution (`managerStepId ?? entryStepId`, same as `session.queue` and materialized `nodes[].id`), not the underlying `steps[].nodeId` registry pointer. Documented `NodeExecutionMailboxStructure.managerRuntimeId` accordingly to prevent a future refactor from incorrectly switching engine/mailbox comparisons to raw registry node ids. Auto-improve / nested superviser (phases 130-132) remain aligned: no code behavior change. `bun run typecheck:server` and `bun test` after edits.

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

### Session: 2026-04-26 (TUI: step-addressed Entry line without `managerRuntimeId` alias)

**Tasks Completed**: Added `buildWorkflowExecutionIdentityPreviewSegment` in `src/tui/opentui-model/workflow-rendering.ts` so one-line `Entry:` / `Manager:` labels for `buildWorkflowSummaryPreview` and `buildWorkflowRunPreview` share one implementation. For step-addressed bundles, Entry is `entryStepId ?? entryNodeId ?? "(unset)"` (no fallback to compatibility `managerRuntimeId`, which conflated manager runtime with entry). Legacy node-graph fallbacks unchanged. `bun run typecheck:server` and full `bun test` green.

**Tasks In Progress**: Module 1 primary `WorkflowJson` / validator legacy field removal; module 2 runtime union cleanup; modules 4–5.

**Blockers**: None.

### Session: 2026-04-26 (README: step-addressed vs legacy `workflowCalls`)

**Tasks Completed**: Updated README "What Is Implemented Today" and "Additional authored shapes" so they no longer read as if top-level `workflow.workflowCalls` is always a supported authoring path. Step-addressed bundles must use `steps[].transitions` with `toWorkflowId` / `resumeStepId` (validator rejects top-level `workflowCalls` on `entryStepId`+`steps`); legacy node-graph bundles may still use explicit `workflowCalls` until the non-step path is removed. Aligns public overview with `normalizeStepAddressedWorkflow` and `design-workflow-json.md`.

**Tasks In Progress**: Module 1 `WorkflowJson` / normalized legacy companion field removal; module 2 runtime union cleanup; modules 4-5 (fixtures, broader design-doc pass, closeout).

**Blockers**: None.

### Session: 2026-04-26 (event trigger: sticky `managerRuntimeId` field name)

**Tasks Completed**: Renamed internal `StickyRootManagerContext.managerRuntimeId` to `managerRuntimeId` in `src/events/trigger-runner.ts` so the name matches `resolveWorkflowManagerRuntimeId` semantics (step id for step-addressed graphs, not a misleading “node-only” label). No behavior change to queue seeding. Updated this progress log.

**Tasks In Progress**: Module 1 `WorkflowJson` / validator legacy companion removal; module 2 root/sub edge runtime; modules 3–5 as before.

**Blockers**: None.

### Session: 2026-04-26 (TUI + event trigger: canonical manager runtime id)

**Tasks Completed**: OpenTUI workflow summary/run preview one-line `Manager:` label for step-addressed bundles now uses `resolveWorkflowManagerRuntimeId` when `managerStepId` is omitted (still respects `hasManagerNode === false` as `none`). Event workflow trigger `resolveStickyRootManagerContext` uses the same helper for `getNormalizedNodePayload` lookup and sticky `managerRuntimeId` so session queue seeding matches engine routing. `bun run typecheck:server` and full `bun test` (1047 tests).

**Tasks In Progress**: Module 1 primary `WorkflowJson` / validator legacy field removal; module 2 root/sub edge runtime; modules 4–5 design-doc and closeout.

**Blockers**: None.

### Session: 2026-04-26 (engine: `resolveWorkflowManagerRuntimeId` for step-first manager id)

**Tasks Completed**: Added `resolveWorkflowManagerRuntimeId` in `src/workflow/types.ts` to return `managerStepId ?? entryStepId` for normalized step-addressed bundles and `managerRuntimeId` for legacy node-graph shapes. Migrated all workflow-execution `workflow.managerRuntimeId` reads in `src/workflow/engine.ts` and the root manager line in `src/workflow/node-execution-mailbox.ts` to use the helper so the active runtime no longer **depends** on the synthesized compatibility alias for step graphs (next cuts can delete `managerRuntimeId` from `WorkflowJson` once remaining references are updated). Regressions in `src/workflow/validate.test.ts`. `bun run typecheck:server` and full `bun test` (1047 tests).

**Tasks In Progress**: Module 1: remove `managerRuntimeId` from `WorkflowJson` type and validation output after migrating remaining `bundle.workflow.managerRuntimeId` / inspection paths; module 2: root/sub edge runtime vs pure step graph; modules 4–5.

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

**Tasks Completed**: Re-read `impl-plans/PROGRESS.json` and `impl-plans/README.md`: phases 130–132 (auto-improve superviser) remain **Completed**; phase **133** / this plan is the active implementation target. Found `design-docs/specs/architecture.md` **Manager Control Architecture** describing only target action names (`retry-step`, …) without stating that the runtime still implements `retry-node`, `execute-optional-node`, and structural `start-sub-workflow` / `deliver-to-child-input`. Updated that section to separate **target** vs **current** and to point at this plan for the rename/removal work. Updated `design-docs/specs/notes.md` legacy bullet so it no longer claims inspection exposes `managerRuntimeId`/`entryNodeId` on primary summaries (those fields were removed from inspection/GraphQL); listed the real remaining debt instead. No code behavior change.

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

**Blockers**: Internal runtime code still uses `call-step-impl.ts` (export `callNode`) behind `call-step`, and authored/schema compatibility (`managerRuntimeId`, `entryNodeId`, `workflowCalls`, `subWorkflows`, structural projections) remains live elsewhere. This iteration intentionally removed only the user-facing alias first.

### Session: 2026-04-25 (inspection / GraphQL step-first surface)

**Tasks Completed**: Removed node-addressed inspection fields (`managerRuntimeId`, `entryNodeId`), `counts.legacySubWorkflows`, and the entire `compatibility` block from `WorkflowInspectionSummary`, CLI text/json inspect, executable GraphQL `WorkflowView` / `WorkflowCounts`, and aligned tests. `buildInspectionSummary` now fills `nodeRegistryIds` from `nodeRegistry` or runtime `nodes` so legacy bundles still list registry ids. OpenTUI history header uses `subWorkflows=` (structural count) instead of `legacySubWorkflows=`. README inspect blurb updated. `bun run typecheck:server` and full `bun test` green.

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
(`114` pass). The broader compatibility model (`managerRuntimeId`,
`entryNodeId`, `workflowCalls`, structural `subWorkflows`) still remains on the
active phase 133 checklist.

### Session: 2026-04-26 (review slice: runtime step-identity consolidation)

**Tasks Completed**: Re-reviewed the current compatibility-removal branch for
DRY/SOLID drift instead of schema changes. The architecture still matches the
intended step-addressed direction, so no new design doc or alternate plan was
needed. The concrete maintainability issue was repeated projection of
`stepId` / `nodeRegistryId` plus repeated address resolution for backend-session
selection after `src/workflow/runtime-addressing.ts` had already been
introduced. Consolidated the shared projection helper in
`src/workflow/runtime-addressing.ts`, changed backend-session selection to
accept the already-resolved step address, and reused that helper across
`src/workflow/engine.ts` and `src/workflow/call-step-impl.ts`. Added focused
unit coverage for the shared projection helper.

**Tasks In Progress**: Module 1 authored-schema / validator cutover; module 2
runtime/control cleanup beyond shared address projection, especially
`workflowCalls` dispatch union and structural sub-workflow compatibility.

**Blockers**: None.

**Notes**: This slice improves maintainability without changing behavior. The
remaining architecture mismatch is still the larger compatibility surface, not
the step-addressed direction itself. Verification for this slice is the focused
TypeScript/runtime test and typecheck pass recorded after the code edit.

### Session: 2026-04-26 (review slice: shared step-identity type + targeted verification)

**Tasks Completed**: Tightened the same runtime-addressing cleanup after the
previous consolidation review. The remaining maintainability drift was that the
shared `stepId` / `nodeRegistryId` payload still existed as duplicated shapes
inside `StepExecutionAddress`, `BackendSessionSelection`, and repeated
`toStepIdentityFields(...)` calls within the same execution scope. Promoted
`StepIdentityFields` to the exported shared contract, made both runtime helper
types extend it, and hoisted one identity payload per execution scope in
`src/workflow/engine.ts` and `src/workflow/call-step-impl.ts` so the runtime
reuses a single projection instead of rebuilding it at each write/persist site.

**Tasks In Progress**: Module 1 authored-schema / validator cutover; module 2
runtime/control cleanup beyond shared address and identity projection,
especially `workflowCalls` dispatch union and structural sub-workflow
compatibility.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server` and
`bun test src/workflow/runtime-addressing.test.ts src/workflow/call-step.test.ts src/workflow/call-step-impl.test.ts src/workflow/engine.test.ts --runInBand`
(`132` pass). The architecture assessment did not change: the design direction
is still correct, while the remaining mismatch is the unfinished compatibility
surface tracked by modules 1-4.

### Session: 2026-04-26 (review slice: session helper identity-contract reuse)

**Tasks Completed**: Continued the DRY/SOLID review against the current diff
rather than opening a new design track. The architecture assessment stayed the
same: the intended step-addressed design is still correct, while the remaining
mismatch is unfinished compatibility-removal work already tracked by this plan.
Within the current refactor, the remaining maintainability drift was duplicated
`stepId` / `nodeRegistryId` shape definitions and projection logic in
`src/workflow/session.ts` and `MailboxPublisher`. Reused the shared
`StepIdentityFields` contract plus `toStepIdentityFields(...)` across those
helpers so runtime/session metadata now has one authoritative projection rule.

**Tasks In Progress**: Module 1 authored-schema / validator cutover; module 2
runtime/control cleanup beyond shared address and identity projection,
especially `workflowCalls` dispatch union and structural sub-workflow
compatibility.

**Blockers**: None.

**Notes**: Verification for this slice covers the existing runtime-address,
session, and call-step tests plus typecheck. The progress metadata file is also
normalized to the actual review timestamp so the ledger reflects this slice
instead of carrying a stale timestamp change.

### Session: 2026-04-26 (review slice: shared output-ref helper reuse)

**Tasks Completed**: Re-reviewed the active runtime cleanup for remaining
duplicate contracts after the step-identity consolidation. The architecture
still matches the intended step-addressed design, so no new design document or
alternate implementation plan was needed. The remaining DRY issue in this slice
was that scheduled execution (`engine.ts`) and direct execution
(`call-step-impl.ts`) still built `OutputRef` payloads separately, which let the
engine omit the same step/node-registry/mailbox metadata that direct execution
already emitted. Centralized output-ref construction in
`src/workflow/session.ts` with `buildOutputRefForExecution(...)`, reused the
shared step-identity helper in mailbox metadata assembly, and added regression
coverage proving the engine handoff artifacts now publish the same step
identity contract as direct step execution.

**Tasks In Progress**: Module 1 authored-schema / validator cutover; module 2
runtime/control cleanup beyond shared address, identity, and output-ref
projection, especially `workflowCalls` dispatch union and structural
sub-workflow compatibility.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`,
`bun test src/workflow/runtime-addressing.test.ts src/workflow/session.test.ts src/workflow/call-step.test.ts src/workflow/call-step-impl.test.ts src/workflow/engine.test.ts --runInBand`,
and `git diff --check` (`142` pass). The design assessment is unchanged: the
remaining mismatch is the unfinished compatibility-removal surface already
tracked by modules 1-4, not the step-addressed architecture itself.

### Session: 2026-04-26 12:29 JST (module 1 slice: remove step-addressed manager/entry compatibility aliases)

**Tasks Completed**: Normalized step-addressed workflows no longer synthesize
compatibility `managerRuntimeId` / `entryNodeId` in
`src/workflow/validate.ts`; the shared `WorkflowJson` typing in
`src/workflow/types.ts` now treats `managerRuntimeId` as legacy-only optional
state and keeps `resolveWorkflowManagerRuntimeId(...)` as the canonical runtime
helper for step-addressed execution. Updated root-manager scope checks in
`src/workflow/manager-control.ts` and root-vs-child startup handling in
`src/workflow/sub-workflow.ts` to compare against the step-aware runtime helper
instead of direct compatibility aliases. Adjusted the OpenTUI summary/run
preview plus load/save expectations so shipped strict step-addressed bundles
now expose `entryStepId` / `managerStepId` without requiring the old node-id
aliases.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for the broader legacy companion set (`workflowCalls`,
`subWorkflows`, `edges`, `loops`, `branching`) and the remaining legacy
node-graph validation branches. Module 2 runtime/control cleanup still remains
open for root/sub branching and cross-workflow dispatch unification.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`247` pass). This is an incremental phase-133 slice, not plan completion, so
the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 12:49 JST (module 1 slice: remove legacy callee entry fallback from step-addressed cross-workflow validation)

**Tasks Completed**: Re-checked the current architecture against the intended
phase-133 target before changing code. The design still matches the intended
purpose, so no new design document or replacement implementation plan was
needed. In `src/workflow/validate.ts`, step-addressed cross-workflow callee
alignment now resolves the callee start contract strictly through
`managerStepId`, inferred single manager-role step, or `entryStepId`; it no
longer accepts legacy `entryNodeId` when validating authored step transitions.
Updated the sync/async diagnostics to describe the step-addressed start
contract explicitly and added focused regression coverage in
`src/workflow/validate.test.ts` proving that entry-node-only legacy callees are
rejected for step-addressed cross-workflow transitions.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for the broader legacy companion set (`workflowCalls`,
`subWorkflows`, `edges`, `loops`, `branching`) and the remaining legacy
node-graph validation branches. Module 2 runtime/control cleanup still remains
open for root/sub branching and cross-workflow dispatch unification.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`249` pass). This is an incremental phase-133 slice, not plan completion, so
the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 12:54 JST (module 2 slice: execute step-addressed cross-workflow dispatches directly from step transitions)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 intent before implementation. It still matches the intended
step-addressed target, so no design rewrite or replacement implementation plan
was needed. In `src/workflow/cross-workflow-from-steps.ts`, engine-only
cross-workflow execution now uses a dedicated `CrossWorkflowExecutionDispatch`
shape and derives step-addressed dispatch rows directly from
`steps[].transitions` instead of synthesizing `WorkflowCallRef` compatibility
records first. In `src/workflow/engine.ts`, the child-workflow execution path
now consumes those dispatch rows while preserving the existing legacy
`workflow.workflowCalls` compatibility behavior and artifact ids
(`workflow-call:__cw:<stepId>`). Added focused regression coverage in
`src/workflow/cross-workflow-from-steps.test.ts` for step-addressed dispatch
source labeling plus the preserved legacy compatibility labeling.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for the broader legacy companion set (`workflowCalls`,
`subWorkflows`, `edges`, `loops`, `branching`) and the remaining legacy
node-graph validation branches. Module 2 runtime/control cleanup still remains
open for root/sub branching and the legacy node-graph cross-workflow dispatch
union path.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/cross-workflow-from-steps.test.ts src/workflow/engine.test.ts --runInBand`
(`115` pass). This is an incremental phase-133 slice, not plan completion, so
the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 12:59 JST (module 1 slice: stop synthesizing legacy branching on step-addressed normalized workflows)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before implementation. It still matches the intended
step-addressed direction, so no design rewrite or replacement implementation
plan was needed. In `src/workflow/validate.ts`, step-addressed normalization no
longer synthesizes the legacy `branching: { mode: "fan-out" }` companion onto
normalized workflows. In `src/workflow/types.ts`, `WorkflowJson.branching` is
now optional so the normalized contract matches that cleanup, while legacy
node-graph bundles may still carry authored branching metadata. Added focused
regression assertions in `src/workflow/validate.test.ts`,
`src/workflow/load.test.ts`, and `src/workflow/save.test.ts` proving that
strict step-addressed validation, load, and save/reload flows keep
`workflow.branching` absent.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for the broader legacy companion set (`workflowCalls`,
`subWorkflows`, `edges`, `loops`) and the remaining legacy node-graph
validation branches. Module 2 runtime/control cleanup still remains open for
root/sub branching and the legacy node-graph cross-workflow dispatch union
path.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/cross-workflow-from-steps.test.ts --runInBand`
(`259` pass). This is an incremental phase-133 slice, not plan completion, so
the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 13:03 JST (module 3 follow-up slice: align GraphQL worker-only expectations with strict step-addressed bundles)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before implementation. It still matches the intended
step-addressed direction, so no design rewrite or replacement implementation
plan was needed. Updated `src/graphql/schema.test.ts` and
`src/server/graphql.test.ts` so GraphQL create/save worker-only coverage now
asserts `entryStepId` plus the absence of compatibility `managerRuntimeId` /
`entryNodeId` on normalized step-addressed bundles instead of expecting the
removed aliases. Also dropped the stale `entryNodeId` injection from the
worker-only save-mutation conversion fixtures so the tests exercise the current
strict step-addressed input shape rather than a compatibility-leaning variant.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for the broader legacy companion set (`workflowCalls`,
`subWorkflows`, `edges`, `loops`) and the remaining legacy node-graph
validation branches. Module 2 runtime/control cleanup still remains open for
root/sub branching and the legacy node-graph cross-workflow dispatch union
path. Module 3 public-surface cleanup still remains open beyond this follow-up
test realignment.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/graphql/schema.test.ts src/server/graphql.test.ts --runInBand`
(`55` pass). This remains an incremental phase-133 slice, not plan completion,
so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 13:08 JST (module 3 follow-up slice: derive TUI history workflow-call counts from step transitions)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before implementation. It still matches the intended
step-addressed direction, so no design rewrite or replacement implementation
plan was needed. In `src/tui/opentui-model/workflow-rendering.ts`, the history
header now counts effective cross-workflow calls through
`effectiveWorkflowCalls(...)` instead of reading only authored
`workflow.workflowCalls`, so step-addressed workflows with
`steps[].transitions` no longer display a stale `workflowCalls=0` summary. In
`src/tui/opentui-screen.test.ts`, the step-addressed TUI fixture no longer
injects removed `managerRuntimeId` / `entryNodeId` compatibility aliases, and new
coverage asserts that step-derived cross-workflow transitions surface as
`workflowCalls=1` in the history header.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for the broader legacy companion set (`workflowCalls`,
`subWorkflows`, `edges`, `loops`) and the remaining legacy node-graph
validation branches. Module 2 runtime/control cleanup still remains open for
root/sub branching and the legacy node-graph cross-workflow dispatch union
path. Module 3 public-surface cleanup still remains open beyond this TUI
parity fix.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/tui/opentui-screen.test.ts src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`321` pass). This remains an incremental phase-133 slice, not plan completion,
so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 13:10 JST (module 1 follow-up slice: fail fast on broken legacy manager runtime ids)

**Tasks Completed**: Re-checked the active architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed direction, so no replacement design document or new
implementation plan was needed. During git-diff review I found a real runtime
contract risk in the prior slice: `resolveWorkflowManagerRuntimeId(...)` had
started falling back to `workflow.workflowId` when a legacy normalized bundle
carried neither `managerRuntimeId` nor `entryNodeId`, which can invent a fake
runtime address and hide a broken compatibility bundle. Tightened the helper in
`src/workflow/types.ts` so step-addressed bundles still resolve
`managerStepId ?? entryStepId`, legacy bundles still resolve
`managerRuntimeId`/`entryNodeId`, and malformed legacy bundles now throw with an
explicit contract error instead of routing on a fabricated id. Added focused
coverage in `src/workflow/validate.test.ts` for the new fail-fast behavior.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for the broader legacy companion set (`workflowCalls`,
`subWorkflows`, `edges`, `loops`) and the remaining legacy node-graph
validation branches. Module 2 runtime/control cleanup still remains open for
root/sub branching and the legacy node-graph cross-workflow dispatch union
path. Module 3 public-surface cleanup still remains open beyond this runtime-id
contract fix.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/engine.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`355` pass). This remains an incremental phase-133 slice, not plan completion,
so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 13:14 JST (module 2 follow-up slice: execute cross-workflow step transitions through explicit dispatch rows)

**Tasks Completed**: Re-checked the active architecture/design against the
phase-133 target before extending the runtime cleanup. It still matches the
intended step-addressed direction, so no replacement design document or new
implementation plan was needed. During git-diff review I found that the engine
still framed cross-workflow execution in terms of `WorkflowCallRef`, even after
step-addressed normalization stopped materializing compatibility
`workflow.workflowCalls` for `steps[].transitions`. Tightened
`src/workflow/cross-workflow-from-steps.ts` and `src/workflow/engine.ts` so
step-addressed execution now consumes explicit `CrossWorkflowExecutionDispatch`
rows derived directly from step transitions, while legacy node-graph bundles
still label authored `workflowCalls` as compatibility-only dispatches on the
fallback path. Added focused coverage in
`src/workflow/cross-workflow-from-steps.test.ts` for dispatch ordering/source
tags, and re-checked adjacent worker-only GraphQL/TUI/load/save expectations so
they no longer assume removed compatibility manager/entry aliases on strict
step-addressed bundles.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for the broader legacy companion set (`workflowCalls`,
`subWorkflows`, `edges`, `loops`) and the remaining legacy node-graph
validation branches. Module 2 runtime/control cleanup still remains open for
root/sub branching and the remaining legacy node-graph dispatch union path
outside this execution-row cutover. Module 3 public-surface cleanup still
remains open beyond the worker-only GraphQL/TUI expectation realignment.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/cross-workflow-from-steps.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/tui/opentui-screen.test.ts --runInBand`
(targeted suites passed). This remains an incremental phase-133 slice, not
plan completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 13:22 JST (module 1 follow-up slice: omit empty structural `subWorkflows` on step-addressed bundles)

**Tasks Completed**: Re-checked the active architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed direction, so no replacement design document or new
implementation plan was needed. Continued the bounded module-1 cleanup by
removing the empty structural `subWorkflows` companion from
`normalizeStepAddressedWorkflow` in `src/workflow/validate.ts`; step-addressed
normalized bundles now omit that legacy structural field instead of
synthesizing `[]`. Added `getStructuralSubWorkflows(...)` in
`src/workflow/types.ts` and migrated runtime / OpenTUI / visualization readers
to treat structural sub-workflow metadata as optional legacy state rather than a
required normalized array. This keeps legacy node-graph bundles unchanged while
stopping step-addressed consumers from depending on the compatibility field.
Updated focused expectations in load/validate/TUI/sub-workflow tests and one
prompt-composition test for the new optional field contract.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for the broader legacy companion set (`workflowCalls`, `edges`,
`loops`, and remaining non-step structural branches). Module 2 runtime/control
cleanup still remains open for root/sub branching and the remaining legacy
node-graph dispatch union path. Module 3 public-surface cleanup still remains
open beyond the structural sub-workflow optionalization.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/sub-workflow.test.ts src/tui/opentui-screen.test.ts --runInBand`
(`332` pass). This remains an incremental phase-133 slice, not plan completion,
so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 13:26 JST (module 1 follow-up slice: reject authored workflowCalls.callerStepId)

**Tasks Completed**: Re-checked the active architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed direction, so no replacement design document or new
implementation plan was needed. Continued the bounded module-1 validator
cleanup by treating top-level authored `workflow.workflowCalls` as legacy
node-addressed metadata only: `src/workflow/validate.ts` now rejects authored
`workflowCalls[*].callerStepId` instead of carrying the dead step-addressed
branch, while derived step-transition dispatches still use `callerStepId`
through `cross-workflow-from-steps.ts`. Updated `src/workflow/types.ts` to
document that split explicitly and added focused validate/load/save coverage
proving authored legacy bundles fail when they attempt to carry step-scoped
workflow-call metadata.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader legacy companion removal (`workflowCalls` itself,
`edges`, `loops`, and remaining non-step structural branches). Module 2
runtime/control cleanup still remains open for root/sub branching and the
remaining legacy node-graph dispatch union path. Module 3 public-surface
cleanup still remains open beyond the current validation tightening.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`253` pass). This remains an incremental phase-133 slice, not plan completion,
so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 13:30 JST (module 1 follow-up slice: reject role-authored legacy workflowCalls)

**Tasks Completed**: Re-checked the active architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed direction, so no replacement design document or new
implementation plan was needed. Continued the bounded module-1 validator
cleanup by rejecting non-empty authored `workflow.workflowCalls` whenever a
bundle already uses authored `role` / `control` nodes:
`src/workflow/validate.ts` now treats those mixed bundles the same way it
already treats structural `subWorkflows` and `subWorkflowConversations`,
keeping `workflowCalls` on the pure legacy node-graph path only. Updated
focused coverage in `src/workflow/validate.test.ts`,
`src/workflow/load.test.ts`, and `src/workflow/save.test.ts` so accepted
workflow-call fixtures stay explicitly legacy (`kind`-authored nodes) while
role-authored load/save surfaces now fail with the new compatibility-removal
diagnostic.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader legacy companion removal (`workflowCalls` itself,
`edges`, `loops`, and remaining non-step structural branches). Module 2
runtime/control cleanup still remains open for root/sub branching and the
remaining legacy node-graph dispatch union path. Module 3 public-surface
cleanup still remains open beyond the current validation tightening.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`256` pass). This remains an incremental phase-133 slice, not plan completion,
so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 13:33 JST (module 1 follow-up slice: omit empty structural `subWorkflows` on legacy normalization)

**Tasks Completed**: Re-checked the active architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed direction, so no replacement design document or new
implementation plan was needed. Continued the bounded module-1 compatibility
cleanup by removing the remaining normalized `subWorkflows: []` synthesis from
the legacy node-graph validator path in `src/workflow/validate.ts`; empty
structural sub-workflow metadata is now omitted on both strict step-addressed
and legacy normalized bundles unless a real structural boundary is authored.
Updated `src/workflow/types.ts` commentary to match the narrower compatibility
surface and added focused load/validate/save coverage proving that legacy
workflows still load, but normalized and re-saved bundles no longer keep the
empty structural companion.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader legacy companion removal (`workflowCalls`, `edges`,
`loops`, and remaining non-step structural branches). Module 2 runtime/control
cleanup still remains open for root/sub branching and the remaining legacy
node-graph dispatch union path. Module 3 public-surface cleanup still remains
open beyond the structural compatibility-field shrinkage.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`257` pass). This remains an incremental phase-133 slice, not plan completion,
so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 13:37 JST (module 1 follow-up slice: treat authored workflowCalls as legacy-only and omit empty companions)

**Tasks Completed**: Re-checked the active architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed direction, so no replacement design document or new
implementation plan was needed. Continued the bounded module-1 compatibility
cleanup in `src/workflow/validate.ts` by tightening top-level
`workflow.workflowCalls` handling on the remaining legacy validator path:
role-authored bundles now reject the field even when authored as an empty
array, and normalized legacy bundles now omit empty `workflowCalls` instead of
preserving a compatibility-only `[]` companion. Updated focused regressions in
`src/workflow/validate.test.ts`, `src/workflow/load.test.ts`, and
`src/workflow/save.test.ts` to cover the stricter role-authored rejection and
the load/save cleanup path for legacy bundles that previously carried empty
workflow-call metadata.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader legacy companion removal (`workflowCalls`, `edges`,
`loops`, and remaining non-step structural branches). Module 2 runtime/control
cleanup still remains open for root/sub branching and the remaining legacy
node-graph dispatch union path. Module 3 public-surface cleanup still remains
open beyond the current validator/persistence tightening.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`262` pass). This remains an incremental phase-133 slice, not plan completion,
so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 13:43 JST (module 1 follow-up slice: omit empty legacy loops and sub-workflow conversation companions)

**Tasks Completed**: Re-checked the active architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed direction, so no replacement design document or new
implementation plan was needed. Continued the bounded module-1 compatibility
cleanup in `src/workflow/validate.ts` by making legacy normalization omit two
more empty compatibility-only companions: authored `loops: []` and authored
`subWorkflowConversations: []` now normalize away instead of surviving as
empty arrays on legacy node-graph bundles. Added focused regressions in
`src/workflow/validate.test.ts`, `src/workflow/load.test.ts`, and
`src/workflow/save.test.ts` to cover the normalized omission and the
load/save round trip for legacy bundles that previously preserved those empty
arrays.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader legacy companion removal (`edges` and remaining
non-step structural branches). Module 2 runtime/control cleanup still remains
open for root/sub branching and the remaining legacy node-graph dispatch union
path. Module 3 public-surface cleanup still remains open beyond the current
validator/persistence tightening.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`265` pass). This remains an incremental phase-133 slice, not plan completion,
so the plan and `PROGRESS.json` remain `In Progress`.

## Related Plans

- **Previous**: `impl-plans/completed/step-addressed-workflow-runtime-cutover.md`
- **Previous**: `impl-plans/workflow-role-unification-structural-cleanup.md`
- **Completed (preserve behavior)**: `impl-plans/completed/auto-improve-superviser-workflow-phase-2.md`
- **Depends On**: completed step-addressed/runtime cleanup work already landed on this branch

### Session: 2026-04-26 13:47 JST (module 1 follow-up slice: avoid re-authoring synthesized legacy save companions)

**Tasks Completed**: Re-checked the active architecture/design against the
phase-133 target before editing. It still matches the intended
step-addressed direction, so no replacement design document or new
implementation plan was needed. Continued the bounded module-1 compatibility
cleanup in `src/workflow/save.ts` by tightening the legacy save canonicalizer
for the case where a **loaded normalized legacy bundle** is saved into a fresh
workflow directory with no existing authored file to diff against. That path
previously treated synthesized/default compatibility companions as if they had
been authored and would re-persist sequential `edges` plus default
`branching: { "mode": "fan-out" }` just because those fields existed on the
normalized object. Save now keeps the core legacy entry/manager identifiers but
only re-authors those legacy companion fields when they remain meaningful
instead of synthesized defaults. Added a focused regression in
`src/workflow/save.test.ts` that loads a legacy bundle, saves it under a new
workflow name, and verifies the fresh `workflow.json` no longer re-authors
synthesized `edges` / default `branching` while reload semantics stay intact.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader legacy companion removal (`workflowCalls`, `edges`,
`loops`, and remaining non-step structural branches). Module 2 runtime/control
cleanup still remains open for root/sub branching and the remaining legacy
node-graph dispatch union path. Module 3 public-surface cleanup still remains
open beyond the current validator/persistence tightening.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`266` pass). This remains an incremental phase-133 slice, not plan completion,
so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 13:54 JST (module 1 slice: reject managed role-authored manager/entry compatibility ids)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 intent before editing. It still matches the intended step-addressed
target, so no new design document or replacement implementation plan was
needed. Continued module 1 in `src/workflow/validate.ts` by rejecting authored
`managerRuntimeId` / `entryNodeId` when a legacy node-graph bundle already
declares manager-role nodes, keeping those compatibility ids authored only for
manager-less worker-only legacy bundles that still need an explicit entry.
Updated `src/workflow/save.ts` so save canonicalization strips those two fields
when migrating a loaded managed legacy bundle to role-authored nodes, which
prevents fresh role-authored saves from re-persisting managed compatibility ids
just because they were present on the normalized input object. Adjusted focused
load/save/validate coverage so managed role-authored fixtures omit the legacy
fields, migration saves assert they stay omitted on disk, and explicit
manager-role compatibility-id authoring now fails validation.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader legacy companion removal (`edges`, `loops`, remaining
non-step structural branches, and broader strict step-addressed persistence
cleanup). Module 2 runtime/control cleanup still remains open for root/sub
branching and the remaining legacy node-graph dispatch union path. Module 3
public-surface cleanup still remains open beyond the current
validator/persistence tightening.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`267` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 14:00 JST (module 1 slice: reject legacy-only top-level fields on step-addressed save input)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 intent before editing. It still matches the intended step-addressed
target, so no new design document or replacement implementation plan was
needed. Continued module 1 in `src/workflow/save.ts` by tightening the
step-addressed save path: instead of silently discarding stale legacy-only
top-level fields from an in-memory step-addressed workflow object,
`saveWorkflowToDisk(...)` now reports validation issues when callers try to
save `managerRuntimeId`, `entryNodeId`, top-level `workflowCalls`, or other
structural legacy companions on a step-addressed bundle. Kept the existing
save-time projection of normalized runtime companions such as `edges` and
materialized `nodes[]` so legitimate re-saves of loaded step-addressed bundles
still work, but the legacy-only authored fields now fail fast instead of being
masked by persistence. Updated focused save coverage so worker-only step
conversion fixtures stop reintroducing `entryNodeId`, the existing invalid
step-addressed save test now asserts the new `entryNodeId` rejection, and a
new regression test covers stale top-level `workflowCalls` on step-addressed
save input.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader legacy companion removal (`edges`, `loops`, remaining
non-step structural branches, and stricter removal of legacy node-graph input
paths beyond the save seam). Module 2 runtime/control cleanup still remains
open for root/sub branching and the remaining legacy node-graph dispatch union
path. Module 3 public-surface cleanup still remains open beyond the current
validator/persistence tightening.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`268` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 14:04 JST (module 1 slice: stop synthesizing default legacy branching on normalized node-graph bundles)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 intent before editing. It still matches the intended step-addressed
target, so no new design document or replacement implementation plan was
needed. Continued module 1 in `src/workflow/validate.ts` by removing the last
default `branching: { mode: "fan-out" }` projection from normalized legacy
node-graph bundles. The runtime does not consume `workflow.branching`, and
save/load canonicalization had already stopped re-authoring the default field,
so continuing to synthesize it in normalized validator output was pure
compatibility residue. Added focused validation coverage proving a legacy
workflow without authored `branching` now keeps the field absent after
normalization, and updated the legacy save/reload regression in
`src/workflow/save.test.ts` so a copied legacy workflow no longer expects the
default branch companion to reappear on reload.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader legacy companion removal (`edges`, `loops`, remaining
non-step structural branches, and stricter removal of legacy node-graph input
paths beyond the current save/validate seams). Module 2 runtime/control cleanup
still remains open for root/sub branching and the remaining legacy node-graph
dispatch union path. Module 3 public-surface cleanup still remains open beyond
the current validator/persistence tightening.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`269` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 14:06 JST (module 1 slice: reject stale legacy `edges` on step-addressed save input)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 intent before editing. It still matches the intended step-addressed
target, so no new design document or replacement implementation plan was
needed. Continued module 1 in `src/workflow/save.ts` by aligning the
step-addressed save-time legacy-field guard with strict validation without
breaking normal re-saves of normalized bundles: save now tolerates the
validator-derived local `edges[]` companion that already matches the current
step graph, but rejects stale or mutated top-level `workflow.edges` data
instead of silently dropping it during save projection. Added focused save
coverage in `src/workflow/save.test.ts` proving that a loaded step-addressed
workflow cannot be re-saved after a stale compatibility `edges[]` array is
reattached in memory with routing that diverges from `steps[].transitions`.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader legacy companion removal (`workflowCalls`, `loops`,
remaining non-step structural branches, and deeper legacy node-graph save/load
input paths). Module 2 runtime/control cleanup still remains open for root/sub
branching and the remaining legacy node-graph dispatch union path. Module 3
public-surface cleanup still remains open beyond the current
validator/persistence tightening.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`270` pass). This remains an incremental phase-133 slice, not plan completion,
so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 14:13 JST (module 1 slice: reject authored empty structural companions on role-authored bundles)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended step-addressed
direction, so no new design document or replacement implementation plan was
needed. Continued module 1 in `src/workflow/validate.ts` by tightening the
role-authored compatibility guard for structural legacy companions:
`workflow.subWorkflows` and `workflow.subWorkflowConversations` are now rejected
by authored-field presence, not only when the arrays are non-empty. This closes
the remaining empty-array loophole that still allowed role/control bundles to
carry those legacy structural fields during validation, load, and save.
Added focused regression coverage in `src/workflow/validate.test.ts`,
`src/workflow/load.test.ts`, and `src/workflow/save.test.ts` proving that empty
authored arrays now fail on role-authored bundles while legacy node-graph
round-trip cleanup still omits empty structural companions on re-save/load.
While verifying the slice, `bun run typecheck:server` also surfaced a local
typing gap in `src/workflow/save.ts`; tightened
`createStepAddressedLocalEdges(...)` to preserve the narrowed string step id
through the `flatMap` path.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader legacy companion removal (`edges`, `loops`, remaining
non-step structural branches, and deeper legacy node-graph save/load input
paths). Module 2 runtime/control cleanup still remains open for root/sub
branching and the remaining legacy node-graph dispatch union path. Module 3
public-surface cleanup still remains open beyond the current
validator/persistence tightening.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`276` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 16:06 JST (module 1 slice: stop traversing legacy workflow-call entry validation on role-authored bundles)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended step-addressed
direction, so no new design document or replacement implementation plan was
needed. Continued module 1 in `src/workflow/validate.ts` by isolating the
remaining legacy `workflowCalls` normalization path away from role-authored
bundles: once authored role/control nodes are present, validation now rejects
top-level `workflow.workflowCalls` by presence without descending into legacy
per-entry normalization such as `callerStepId` checks. This keeps the active
role-authored path from traversing deeper legacy workflow-call branches while
preserving legacy node-graph validation for actual compatibility bundles.
Added focused regressions in `src/workflow/validate.test.ts`,
`src/workflow/load.test.ts`, and `src/workflow/save.test.ts` proving that
role-authored bundles with legacy `workflowCalls` fail on the top-level field
only and no longer surface nested legacy-call entry diagnostics.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader legacy companion removal (`edges`, `loops`, remaining
non-step structural branches, and deeper legacy node-graph save/load input
paths). Module 2 runtime/control cleanup still remains open for root/sub
branching and the remaining legacy node-graph dispatch union path. Module 3
public-surface cleanup still remains open beyond the current
validator/persistence tightening.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`289` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 18:29 JST (module 1 slice: reject authored legacy `branching` on role-authored bundles)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended strict
step-addressed direction, so no new design document or replacement
implementation plan was needed. Continued module 1 in `src/workflow/validate.ts`
by isolating another legacy-authored top-level field away from role/control
bundles: authored `workflow.branching` is now rejected by presence once a
bundle uses authored role/control nodes, and validation no longer descends into
legacy `workflow.branching.mode` checks for that path. Updated
`src/workflow/validate.test.ts`, `src/workflow/load.test.ts`, and
`src/workflow/save.test.ts` to remove obsolete tolerated `branching` noise from
positive role-authored fixtures and to add focused regressions proving that
role-authored load/save/validate fail on the top-level field only.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader legacy companion removal (`edges`, `loops`, remaining
non-step structural branches, and deeper legacy node-graph save/load input
paths). Module 2 runtime/control cleanup still remains open for root/sub
branching and the remaining legacy node-graph dispatch union path. Module 3
public-surface cleanup still remains open beyond the current
validator/persistence tightening.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts --runInBand`
(`300` pass). This remains an incremental phase-133 slice, not plan
completion, so the plan and `PROGRESS.json` remain `In Progress`.

### Session: 2026-04-26 19:04 JST (module 1 slice: remove normalized legacy `managerRuntimeId` from the primary workflow surface)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended strict
step-addressed direction, so no new design document or replacement
implementation plan was needed. Continued module 1 by removing
`managerRuntimeId` from the primary normalized/public `WorkflowJson` surface in
`src/workflow/types.ts` and moving the remaining legacy node-graph access
behind a new `getLegacyManagerNodeId(...)` helper. Updated
`src/workflow/validate.ts`, `src/workflow/save.ts`, and
`src/workflow/superviser.ts` so validation, persistence, and supervision
projection use the helper or the existing runtime-id resolvers instead of
depending on the compatibility field directly. Updated the affected tests in
`src/workflow/load.test.ts`, `src/workflow/save.test.ts`,
`src/workflow/validate.test.ts`, and `src/graphql/schema.test.ts` to assert the
surviving behavior only, and tightened several legacy-only test fixture helper
types (`conversation`, `manager-control`, `prompt-composition`,
`runtime-addressing`, `sub-workflow`, and `visualization`) so they opt into the
removed alias explicitly rather than assuming the primary workflow surface still
carries it. As part of the same cleanup, removed a stale legacy
`workflow.branching` fixture from the grouped GraphQL manager-scope test so it
matches the new authored-schema rejection behavior already enforced by module 1.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader legacy companion removal (`subWorkflows`, remaining
non-step structural branches, and deeper legacy node-graph save/load input
paths). Module 2 runtime/control cleanup still remains open for root/sub
branching and the remaining legacy node-graph dispatch union path. Module 3
public-surface cleanup still remains open beyond the current
type-surface/helper cutover.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts src/workflow/superviser.test.ts src/graphql/schema.test.ts --runInBand`
(`365` pass). This remains an incremental phase-133 slice, not plan
completion, so `PROGRESS.json` status does not change and remains
`In Progress`.

### Session: 2026-04-26 19:32 JST (module 2 slice: require explicit communication sub-workflow scope for replay)

**Tasks Completed**: Re-checked the current architecture/design against the
phase-133 target before editing. It still matches the intended strict
step-addressed direction, so no new design document or replacement
implementation plan was needed. Continued module 2 by removing the
manager-control replay fallback that inferred sub-workflow ownership from
`communication.fromNodeId` / `communication.toNodeId` when
`fromSubWorkflowId` / `toSubWorkflowId` were absent. `assertCommunicationInManagerScope(...)`
in `src/workflow/manager-control.ts` now trusts only explicit communication
scope metadata for subworkflow-manager replay and additionally rejects
communications whose explicit sub-workflow ids do not match the owning nodes.
Updated `src/workflow/manager-control.test.ts` so the surviving behavior is
asserted directly: explicit sub-workflow scope passes, missing scope metadata is
rejected, and malformed explicit scope/node combinations are also rejected.

**Tasks In Progress**: Module 1 authored-schema / validator cutover still
remains open for broader legacy companion removal (`subWorkflows`, remaining
non-step structural branches, and deeper legacy node-graph save/load input
paths). Module 2 runtime/control cleanup still remains open for root/sub
branching in other helper/runtime paths and the remaining legacy node-graph
dispatch union path. Module 3 public-surface cleanup still remains open beyond
the current type-surface/helper cutover.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/manager-control.test.ts --runInBand`
(`19` pass). This remains an incremental phase-133 slice, not plan
completion, so `PROGRESS.json` status does not change and remains
`In Progress`.

### Session: 2026-04-27 09:35 JST (module 2 slice: collapse dead structural sub-workflow runtime/helper branches)

**Tasks Completed**: Continued module 2 by deleting the remaining dead
structural sub-workflow planner/runtime path that still assumed authored
`subWorkflows` could execute after the validator cutover. Removed
`src/workflow/sub-workflow.ts` and `src/workflow/sub-workflow.test.ts`,
deleted the engine-side root/sub planner hooks from `src/workflow/engine.ts`,
collapsed communication boundary derivation to the active single-scope runtime
path, and stopped output publication / optional-decision ownership from
projecting structural sub-workflow ids. Followed through on the same removal in
shared helpers: `src/workflow/runtime-addressing.ts` no longer exposes
structural ownership lookup, `src/workflow/session.ts` no longer stamps
`subWorkflowId` on new output refs, `src/workflow/prompt-composition.ts` no
longer selects the structural manager system prompt, `src/workflow/node-execution-mailbox.ts`
no longer renders structural child-scope/owned-node sections, and
`src/workflow/manager-control.ts` / `src/workflow/manager-message-service.ts`
now reject legacy structural replay scope instead of honoring it. Updated the
affected focused tests in `src/workflow/runtime-addressing.test.ts`,
`src/workflow/manager-control.test.ts`,
`src/workflow/prompt-composition.test.ts`, and
`src/workflow/manager-message-service.test.ts` so the surviving behavior is
asserted directly: no structural scope rendering, no structural manager prompt
path, no subworkflow-manager replay scope, and no legacy grouped manager-message
fixtures.

**Tasks In Progress**: Module 2 still remains open for the broader legacy
runtime/helper surface outside this slice, especially TUI/visualization readers
and remaining legacy-engine fixtures that still author structural sub-workflow
or manager-less node-graph bundles. Module 1 still remains open for the other
legacy node-graph authored fields and save/load seams beyond the already
removed `subWorkflows` boundary traversal. Module 3 public-surface cleanup
still remains open beyond the prompt/mailbox text simplification completed
here.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/runtime-addressing.test.ts src/workflow/manager-control.test.ts src/workflow/prompt-composition.test.ts src/workflow/manager-message-service.test.ts --runInBand`
(`47` pass). A broader `bun test src/workflow/engine.test.ts --runInBand`
still exposes older legacy-fixture assumptions (for example manager-less
node-graph fixtures and other compatibility-oriented engine cases) and needs a
separate cleanup slice rather than reintroducing the deleted structural
runtime path.

### Session: 2026-04-27 10:05 JST (module 3 slice: remove structural sub-workflow read-model/TUI grouping)

**Tasks Completed**: Continued module 3 by deleting structural sub-workflow
grouping from the surviving visualization and OpenTUI read-model layers.
`src/workflow/visualization.ts` now derives indentation/color only from the
active loop graph and ignores legacy `subWorkflows` grouping/branch-block/
loop-body metadata. `src/tui/opentui-model/shared.ts`,
`src/tui/opentui-model/input.ts`, `src/tui/opentui-model/navigation.ts`,
`src/tui/opentui-model/workflow-rendering.ts`, and
`src/tui/opentui-screen/runtime.ts` now treat structural sub-workflows as
absent: no structural input-node heuristics, no structural preview scope
indentation, no subworkflow child lists, no subworkflow-node select rows, and
no history-view branch that depends on structural subworkflow existence.
Updated focused regressions in `src/workflow/visualization.test.ts`,
`src/tui/opentui-screen-navigation.test.ts`, and
`src/tui/opentui-screen-runtime.test.ts` so they assert the surviving root/
loop-only visualization behavior and empty structural-subworkflow selections.

**Tasks In Progress**: Module 2 still remains open for the broader engine/test
cleanup outside the already-removed structural planner path, especially the
remaining manager-less/legacy-fixture assumptions in `src/workflow/engine.test.ts`.
Module 3 still remains open for the last public-surface readers that continue
to expose compatibility metadata such as structural subworkflow header copy and
communication scope fields. Module 1 still remains open for the remaining
node-graph authored/save/load compatibility seams outside the removed
`subWorkflows` validation/runtime path.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/visualization.test.ts src/tui/opentui-screen.test.ts src/tui/opentui-screen-navigation.test.ts src/tui/opentui-screen-runtime.test.ts --runInBand`
(`129` pass). This remains an incremental phase-133 slice, not plan
completion.

### Session: 2026-04-27 (module 2 slice: remove communication `fromSubWorkflowId` / `toSubWorkflowId`)

**Tasks Completed**: Confirmed the intended direction remains strict step-addressed
runtime and removal of structural sub-workflow compatibility metadata (see
`design-docs/specs/design-data-model.md`, `design-docs/specs/design-node-mailbox.md`,
and `design-docs/specs/design-graphql-manager-control-plane.md` for updates). Removed
optional `fromSubWorkflowId` / `toSubWorkflowId` from `CommunicationRecord`,
upstream prompt/mailbox plumbing, engine persistence and `UpstreamOutputRef` wiring,
`persistManagerMessageCommunication` (including the unused `subWorkflowId` parameter
for envelope stamping), runtime DB log payloads, communication replay artifact
reconstruction, and the GraphQL `CommunicationRecord` type. Dropped
`manager-control` assertions that only existed to reject these fields, removed the
obsolete focused test, and adjusted `src/workflow/engine.test.ts` to assert
`routingScope` only. Removed the same two fields from `ConversationTurnRecord` and
from transcript mapping in `call-step-impl` / `engine`. Updated design specs listed
above so public documentation matches the code.

**Tasks In Progress**: Module 1 (`managerRuntimeId` / `entryNodeId` / remaining
node-graph save surfaces), module 2 (root/sub branching and legacy engine fixture
assumptions beyond this communication-metadata slice), module 3 (node-id as display
only), and module 4 (examples/tests retirement) per the main plan checklists.

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/manager-control.test.ts src/workflow/communication-service.test.ts src/workflow/prompt-composition.test.ts --runInBand`
(`38` pass). The manager-message replay test no longer depends on
`createCompletedSubworkflowFixture` (rejected `workflow.subWorkflows`); it now
reuses the step-addressed `createWorkflowTemplate("demo", ...)` completion path.
Focused
`bun test src/workflow/engine.test.ts -t "manager schedules sub-workflow" --runInBand`
and
`bun test src/workflow/engine.test.ts -t "does not duplicate a sub-workflow manager handoff" --runInBand`
still fail at `runWorkflow` (`result.ok` false) because those cases rely on
`createSubWorkflowRuntimeFixture` legacy structural bundles; that is separate
from this slice and should be handled in a follow-up fixture migration (same
class of issue as the pre-existing `engine.test.ts` legacy assumptions called out
in the prior plan log).

### Session: 2026-04-27 (module 3 slice: remove `subworkflow-manager` node kind)

**Tasks Completed**: Removed the legacy `subworkflow-manager` value from the
`NodeKind` union and from all production normalization (`validate.ts`,
`save.ts`), manager detection (`node-role.ts` / `isManagerNodeRef`, deleted
`isSubworkflowManagerNodeRef`), mailbox prompt seed copy (`node-execution-mailbox.ts`),
OpenTUI kind labels and manager-session id resolution (`shared.ts` uses
`isManagerNodeRef`; `opentui-view-shared.ts` maps `manager` and drops the old
kind color key). Added `validate.test.ts` coverage for invalid
`subworkflow-manager` strings on role-authored bundles. Updated or retired
focused tests across `manager-control`, `prompt-composition`, `visualization`,
`runtime-addressing`, `load`/`save`, `opentui-screen-runtime`, and `graphql/schema`.
Deleted structural sub-workflow engine integration tests and helpers
(`createSubWorkflowRuntimeFixture`, `createWorkflowOutputDrivenSubWorkflowFixture`)
plus the GraphQL grouped-workflow replay-scope test whose fixture required authored
`subWorkflows` (no longer valid to load). Adjusted prompt-composition expectations
for non-manager task mailboxes and inbox-on-root-manager behavior.

**Tasks In Progress**: Module 1 (legacy `managerRuntimeId` / `entryNodeId` / node-graph
save surfaces), module 2 (root/sub runtime branching and **migrating `engine.test.ts`
fixtures** off forbidden role-authored `edges` / `branching` combinations -- the
full `engine.test.ts` suite still fails `runWorkflow` at load/validation for many
managerless/role fixtures independent of this slice), module 3 (remaining display
surfaces), module 4 (examples retirement).

**Blockers**: None for this slice; `src/workflow/engine.test.ts` remains red on the
branch until fixtures align with current validation (e.g. managerless harness
using `edges` + `branching` with role nodes).

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/validate.test.ts src/workflow/manager-control.test.ts src/workflow/prompt-composition.test.ts src/workflow/visualization.test.ts src/workflow/runtime-addressing.test.ts src/tui/opentui-screen-runtime.test.ts src/graphql/schema.test.ts src/workflow/save.test.ts src/workflow/load.test.ts src/workflow/communication-service.test.ts src/workflow/manager-message-service.test.ts --runInBand`
(`410` pass). Broader
`bun test src/workflow/engine.test.ts --runInBand` still fails broadly because
fixtures such as `createManagerlessWorkflowFixture` combine role-authored nodes
with legacy `edges` / `branching`, which validation now rejects; treat as a
follow-up harness migration, not a revert of the node-kind removal.

### Session: 2026-04-27 (module 3/4 slice: remove `getStructuralSubWorkflows` and structural TUI read-model shims)

**Tasks Completed**: Deleted the `getStructuralSubWorkflows` helper from
`src/workflow/types.ts` (normalized bundles do not carry structural
`subWorkflows`; tests now assert the field is absent via `"subWorkflows" in
workflow` checks or existing JSON expectations). Simplified the OpenTUI
history read model: removed `resolveOwningSubWorkflow` (stub), dropped the
`SubWorkflowRef` parameter from `buildWorkflowHistoryHeader`, removed the
subworkflow header scope lines, simplified `resolveHistoryPaneLabels` to
workflow-only labels, and removed the unused `resolveDirectChildSubworkflows`
export. Updated `src/tui/opentui-screen/runtime.ts` to stop importing dead
`SubWorkflowRef` / `resolveOwningSubWorkflow` wiring. Adjusted
`load`/`save`/`validate`/`prompt-composition` and `opentui-screen` tests; removed
the obsolete "buildWorkflowHistoryHeader includes subworkflow scope metadata"
test and stripped default structural `subWorkflows` from the shared
`makeLoadedWorkflow` test helper.

**Tasks In Progress**: Module 1 (legacy `managerRuntimeId` / `entryNodeId` /
node-graph save surfaces and `SubWorkflowRef` type retention for
validation/legacy tests), module 2 (`engine.test.ts` fixture migration off
incompatible `edges`/`branching` harness), module 3 (remaining
sub-workflow-**named** TUI state such as `HistoryViewMode` `"subworkflow"` and
`subworkflowPath` stack as dead code), module 4 (examples retirement).

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts src/workflow/prompt-composition.test.ts src/tui/opentui-screen.test.ts src/tui/opentui-screen-runtime.test.ts src/tui/opentui-screen-navigation.test.ts --runInBand`
(full pass; last run: `436` tests across 7 files). The broader
`bun test src/workflow/engine.test.ts --runInBand` failure mode described in
earlier log entries is unchanged and remains a separate fixture-migration
slice.

### Session: 2026-04-27 (module 3 slice: remove TUI `subworkflowPath`, `HistoryViewMode`, and structural history navigation shims)

**Tasks Completed**: Removed dead structural sub-workflow navigation from the OpenTUI history screen. Dropped `HistoryViewMode`, `subworkflowPath` breadcrumb segments, `OpenTuiDirectionalAction` `open-subworkflow` / `close-subworkflow`, stub `buildSubworkflowNodeSelectOptions` / `buildSubworkflowListOptions`, and all runtime branches that never activated (`subworkflowPath` was never pushed). `resolveDirectionalNavigationAction` now maps history forward from **nodes** to **detail** (run detail) instead of a no-op subworkflow open; history **l**/**h** help lines describe runs → nodes → detail. Simplified `OpenTuiNavigationState`, copy-target plumbing (`selectedSubworkflowId` removed), `buildHistoryDetailPaneState` placeholders, and `OpenTuiControllerContext`. Updated TUI unit tests; deleted the obsolete `buildSubworkflowNodeSelectOptions` test block.

**Tasks In Progress**: Module 1 (legacy `managerRuntimeId` / `entryNodeId` / node-graph save surfaces), module 2 (`engine.test.ts` fixture migration), module 4 (examples retirement). Residual TUI copy: `resolveWorkflowPreviewIndent` tests still mention "subworkflow scope" for indent metadata only (not structural runtime).

**Blockers**: None.

**Notes**: Verification for this slice:
`bun run typecheck:server`
and
`bun test src/tui/opentui-screen.test.ts src/tui/opentui-screen-navigation.test.ts src/tui/opentui-screen-runtime.test.ts src/tui/opentui-controller.test.ts src/tui/opentui-detail-content.test.ts --runInBand`
(`133` pass). Broader
`bun test src/workflow/engine.test.ts --runInBand` was not re-run; it remains red for unrelated legacy fixture reasons documented in prior log entries.

### Session: 2026-04-27 (module 2 slice: `engine.test.ts` harness – validation-aligned fixtures)

**Tasks Completed**: Aligned `src/workflow/engine.test.ts` load-time fixtures with current validation: removed forbidden authored `subWorkflows` (including empty `[]`) and `branching: { mode: "fan-out" }` from legacy node-graph helper workflows and command-node inline bundles; updated `createRoleManagedWorkflowFixture` to `kind: "root-manager"` / `kind: "task"` plus `managerRuntimeId` (replaces node-level `role` + invalid `edges` co-authoring). Replaced `createManagerlessWorkflowFixture` with a **step-addressed** two-step linear bundle (`entryStepId` + `steps` transitions) so auto-improve / supervision policy paths can build `StepAddressedWorkflowForSupervision` (legacy node-graph `entryNodeId`-only graphs no longer project for supervision; this was the root cause of the six `autoImprove` + resume/rerun test failures). Renamed/retargeted the GraphQL ambient-context test to assert `Node kind: root-manager` (matches `describeWorkflowNodeKind` for `kind: "root-manager"`) instead of the removed `role: "manager"` string.

**Tasks In Progress**: Module 1 (remaining `managerRuntimeId` / `entryNodeId` on legacy save paths), module 2 (any other test files outside `engine.test.ts` that still author `branching` in fixtures: `call-step-impl.test.ts`, `cli.test.ts`, `lib.test.ts`, `runtime-db.test.ts`, `trigger-runner.test.ts`, `history.test.ts` per repo grep), module 3 (residual display copy), module 4 (examples).

**Blockers**: None for this slice.

**Notes**: Verification: `bun run typecheck:server` and `bun test src/workflow/engine.test.ts --runInBand` (`96` pass). Other suites not re-run; they may still contain legacy `branching` in fixtures and fail until migrated in a follow-up slice.

### Session: 2026-04-27 (module 2 slice: remove `branching` and obsolete `workflowCalls` from non-engine test fixtures)

**Tasks Completed**: Confirmed `fromSubWorkflowId` / `toSubWorkflowId` are already removed from `src/**` (no production matches); this session targeted the follow-on module-2 list: disk fixtures that still authored `branching: { mode: "fan-out" }` (now rejected by validation). Migrated `src/workflow/call-step-impl.test.ts` to legacy node-graph `edges` (no `branching` / empty `loops`) and `kind: "root-manager"` / `task` for the role-managed helper; updated prompt expectation to `Node kind: root-manager`. Migrated `src/workflow/runtime-db.test.ts` and `src/workflow/history.test.ts` graph fixtures the same way. `src/events/trigger-runner.test.ts`: removed empty `subWorkflows: []` and `branching` from the manager-only sticky workflow. Migrated `src/lib.test.ts` add-on disk fixtures to step-addressed `entryStepId` + `steps` with add-on resolution via **addon ref only** (no disallowed `role` / `completion` on step-addressed registries) and a setup→addon two-step path for resume/rerun. Migrated `src/cli.test.ts`: `createManagerlessWorkflowFixture` to step-addressed two-step linear; local add-on inspect fixture to add-on-only nodes with `entryStepId`/`step` id `addon-worker` for stable add-on source `nodeId`; `createWorkflowCallInspectFixture` to step-addressed `steps[].transitions` with `toWorkflowId` / `resumeStepId` and callee `review` as `entryStepId`+`steps` (dropped rejected top-level `workflowCalls`); retitled/repointed the inspect test to `workflowCallIds: ["__cw:main-worker"]`; adjusted worker-only inspect expectations to `WorkflowInspectionCounts` for step-addressed (`nodeRegistry`, `steps`, `structuralProjection`).

**Tasks In Progress**: Module 1 (legacy `getLegacyManagerNodeId` / `getLegacyEntryNodeId` and normalized **node-graph** alias surfaces in `types.ts` / `validate.ts` / `save.ts`); module 2 (any remaining `branching` **assertions** only in `validate.test.ts` / `load.test.ts` / `save.test.ts` that intentionally test rejection, plus other suites outside this run if new legacy keys appear); module 3 (TUI "subworkflow" **wording** in preview-indent tests per prior log); module 4 (examples retirement).

**Blockers**: None for this slice.

**Notes / verification commands**:
`bun run typecheck:server`
`bun test src/workflow/call-step-impl.test.ts src/cli.test.ts src/lib.test.ts src/workflow/runtime-db.test.ts src/events/trigger-runner.test.ts src/workflow/history.test.ts --runInBand`
(149 pass)
`bun test src/workflow/engine.test.ts --runInBand` (96 pass; confirms no regression vs prior engine harness slice).
`fromSubWorkflowId` / `toSubWorkflowId` were not part of this edit set (already removed in earlier work).

### Session: 2026-04-27 (module 1 slice: drop exported structural `SubWorkflowRef` types)

**Tasks Completed**: Removed `SubWorkflowInputSourceType`, `SubWorkflowInputSource`, `SubWorkflowBlockType`, `SubWorkflowBlock`, and `SubWorkflowRef` from `src/workflow/types.ts` so the public type surface no longer advertises structural sub-workflow authoring shapes (validation already rejects `workflow.subWorkflows`). Replaced imports in focused tests (`manager-control`, `prompt-composition`, `visualization`, `runtime-addressing`, OpenTUI screen/navigation/runtime tests) with local `LegacyStructuralSubworkflowFixture` aliases for obsolete fixture objects only. Aligned `design-docs/specs/design-data-model.md`: refreshed the `WorkflowJson` / `NodeKind` summary, removed `subworkflow-manager`, and documented that structural sub-workflows are not modeled in `types.ts`.

**Tasks In Progress**: Module 1 (remove `getLegacyManagerNodeId` / `getLegacyEntryNodeId` helpers and stop materializing legacy `managerRuntimeId` / `entryNodeId` on normalized bundles); module 2 (residual legacy fixture wording / branching assertion-only tests); module 3 (TUI copy mentioning subworkflow scope where it is indent-only); module 4 (examples retirement).

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server`
`bun test src/workflow/manager-control.test.ts src/workflow/prompt-composition.test.ts src/workflow/visualization.test.ts src/workflow/runtime-addressing.test.ts src/tui/opentui-screen.test.ts src/tui/opentui-screen-navigation.test.ts src/tui/opentui-screen-runtime.test.ts --runInBand`
(166 pass). Full repo test sweep not re-run.

### Session: 2026-04-27 (module 1 slice: remove legacy `getLegacyManagerNodeId` / `getLegacyEntryNodeId` and non-materialized manager/entry)

**Tasks Completed**:
- Removed public `getLegacyManagerNodeId` and `getLegacyEntryNodeId` from `src/workflow/types.ts`.
- Added `inferLegacyNodeGraphGraphEntryNodeId` and `inferLegacyNodeGraphManagerNodeId`; `resolveWorkflowEntryRuntimeId` and `resolveWorkflowManagerRuntimeId` now use graph/kind/role inference for legacy node graphs instead of top-level `managerRuntimeId` / `entryNodeId` on `WorkflowJson`.
- Stopped materializing `managerRuntimeId` / `entryNodeId` on normalized legacy node-graph output in `src/workflow/validate.ts` (`normalizeWorkflow`); semantic validation and `runSemanticValidation` use the same infer helpers.
- Extended legacy normalize-time manager resolution: single `root-manager` node, else graph entry via structural edges, so manager-less multi-node flows validate after save strips top-level `entryNodeId` from disk.
- Stopped re-persisting legacy `managerRuntimeId` / `entryNodeId` in `createPersistedWorkflowJson` (`src/workflow/save.ts`).
- Updated `validate.test.ts`, `save.test.ts`, `load.test.ts`, and `src/graphql/schema.test.ts` to assert runtime ids via `resolveWorkflow*` and key-presence on workflow objects where appropriate; legacy copy/save tests no longer expect `managerRuntimeId` in JSON; manager-less save test no longer requires persisted `entryNodeId` if graph inference is sufficient.
- JSDoc on `WorkflowJson` updated in `types.ts` to state normalized bundles do not carry top-level `managerRuntimeId` / `entryNodeId`.

**Tasks In Progress**: Module 1 (authored on-disk `workflow.json` for legacy flows may still **parse** `managerRuntimeId` / `entryNodeId` in validate until those keys are fully rejected; `prepareAuthoredWorkflowForSave` and intentional rejection tests still refer to these paths; examples retirement module 4; residual TUI "subworkflow" **wording** in preview-indent tests per prior log).

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test --runInBand` (1107 pass, full tree)
Focus slices also run during development: `bun test src/workflow/validate.test.ts src/workflow/save.test.ts` and `bun test src/workflow/load.test.ts` (pass).
Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`.

### Session: 2026-04-27 (module 1 slice: reject top-level `managerRuntimeId` / `entryNodeId` in legacy `normalizeWorkflow`)

**Tasks Completed**:
- **Production**: Legacy node-graph `normalizeWorkflow` in `src/workflow/validate.ts` now **rejects** any authored top-level `workflow.managerRuntimeId` or `workflow.entryNodeId` (with explicit messages) instead of parsing them into `effectiveManager` / `entry`. Inference-only path: `hasManagerNode` is derived from manager-role nodes or a `root-manager` kind node; `effectiveManager` / entry use role, single `root-manager`, or `inferLegacyNodeGraphGraphEntryNodeId` for manager-less graphs. Early-return and duplicate role-bundle error branches for those keys were removed as redundant.
- **Semantic validation**: `runSemanticValidation` issues for inferred legacy manager/entry mismatches now use path `workflow` and updated messages (no `workflow.managerRuntimeId` / `workflow.entryNodeId` paths for inference diagnostics).
- **Types / design**: JSDoc on `AuthoredWorkflowJson` / `WorkflowJson` in `src/workflow/types.ts` and a short note in `design-docs/specs/design-data-model.md` state that top-level `managerRuntimeId` / `entryNodeId` are rejected and not carried on normalized bundles.
- **Tests**: Migrated `makeValidRaw`, load/save disk fixtures, `engine.test.ts` (including restoring `managerRuntimeId` on `createOrResumeSession` for SQLite only), TUI/manager/prompt/compose/communicate/call-step/runtime-db/trigger/validate/save/load/superviser/runtime-readiness tests to **omit** top-level `managerRuntimeId` / `entryNodeId` from workflow JSON where they were only compatibility; updated expectations for strict step-addressed diagnostics, role-bundle rejection copy, and semantic root-manager errors. Script-assisted removal of duplicate top-level `managerRuntimeId: "divedra-manager"` lines only when the next sibling key is `nodes` / `subWorkflows` / `workflowCalls` (avoids stripping `createOrResumeSession` `managerRuntimeId`).

**Tasks In Progress**:
- Module 1: any remaining on-disk **examples** or external fixtures outside `src/**` that still author `managerRuntimeId` / `entryNodeId` (examples/ sweep per module 4); residual TUI copy mentioning “legacy manager/entry” in previews if any.
- Module 2–4: unchanged from prior log (structural/branching examples, TUI indent wording-only, etc.).

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server`
`bun test src/workflow/ --runInBand` (pass)
`bun test src/graphql/schema.test.ts src/tui/opentui-screen.test.ts --runInBand` (pass)
Full repo `bun test` not re-run in this session after the last green `src/workflow/` sweep.

Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`.

### Session: 2026-04-27 (module 1 slice: remove `ArgumentBinding` source `sub-workflow-output`)

**Tasks Completed**:
- **Inventory**: `fromSubWorkflowId` / `toSubWorkflowId` are already absent from `src/**`; next coherent deletion was the redundant binding source left over from structural sub-workflows.
- **Production**: Dropped `sub-workflow-output` from `ArgumentBinding["source"]` in `src/workflow/types.ts`; `resolveBindingSource` in `src/workflow/input-assembly.ts` now treats only `node-output` and `workflow-output` as upstream-based sources (same resolution path as before for the removed alias); `normalizeNodePayload` in `src/workflow/validate.ts` no longer accepts that string as a valid binding source.
- **Design**: Updated `design-docs/specs/design-workflow-json.md` structured-arguments section to list only supported sources.
- **Tests**: Added `validate.test.ts` coverage that `sub-workflow-output` in `argumentBindings` is rejected with `must be a valid binding source`.

**Tasks In Progress** (unchanged directionally from prior log):
- Module 1: any remaining legacy **wording** in examples `EXPECTED_RESULTS.md` (e.g. stale mentions of normalized `entryNodeId` / `managerRuntimeId`) and other docs outside the two protected specs.
- Module 2–4: as in prior entries (full-repo test sweeps optional; examples retirement).

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server`
`bun test src/workflow/ --runInBand` (`699` pass after this slice)
Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`.

### Session: 2026-04-27 (communication routingScope: drop structural labels, add `intra-workflow`)

**Tasks Completed**:
- **Inventory**: `fromSubWorkflowId` / `toSubWorkflowId` remain absent from `src/**`; `resolveCommunicationBoundary` already returned a single non–external scope for all in-graph edge deliveries. The public union still carried dead `parent-to-sub-workflow` / `cross-sub-workflow` / `intra-sub-workflow` values.
- **Production**: Introduced `CommunicationRoutingScope` (`intra-workflow` | `external-mailbox`) on `CommunicationRecord` in `src/workflow/session.ts`; added `normalizeCommunicationRoutingScope` and applied it in `normalizeSessionState` so persisted session JSON with legacy scope strings loads as `intra-workflow` (except `external-mailbox`). `resolveCommunicationBoundary` in `src/workflow/engine.ts` and manager-message replay reconstruction in `src/workflow/manager-message-service/artifacts.ts` now stamp `intra-workflow`.
- **Design**: Updated `design-docs/specs/design-data-model.md` (routing scopes + conversation blurb), `design-docs/specs/design-graphql-manager-control-plane.md` (replay/retry scope bullets), and `design-docs/specs/design-node-mailbox.md` (canonical `message.json` example + envelope rules for `routingScope`). Partial structural allocator language remains elsewhere in the mailbox spec for a future doc-only pass.
- **Examples**: Refreshed `examples/worker-only-single-step/EXPECTED_RESULTS.md` and `examples/workflow-call-review-target/EXPECTED_RESULTS.md` to match strict inspect output (no top-level `entryNodeId`).
- **Tests**: `src/workflow/session.test.ts` normalization coverage; `src/workflow/runtime-db.test.ts` payload expectations updated to `intra-workflow`.

**Tasks In Progress**:
- Module 1: broader `design-node-mailbox.md` de-structuralization (allocator / sub-workflow manager sections still describe retired shapes); other example docs if new drift appears.
- Module 2–4: unchanged from prior log.

**Blockers**: None. Historical runtime DB log rows may still show legacy `routingScope` strings in stored JSON payloads until new events are written; behavior is display/history-only.

**Notes / verification commands**:
`bun run typecheck:server`
`bun test src/workflow/session.test.ts src/workflow/runtime-db.test.ts src/workflow/engine.test.ts src/workflow/communication-service.test.ts src/workflow/manager-message-service.test.ts --runInBand` (`130` pass)
`bun test src/workflow/ --runInBand` (`700` pass)
Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`.

### Session: 2026-04-27 (module 1 slice: mailbox meta dead structural types + `design-node-mailbox` de-structuralization)

**Tasks Completed**:
- **Inventory**: `NodeExecutionMailboxStructure` in production still carried a `sub-workflow` union variant, structural `subWorkflows` / `subWorkflowId` fields, and `NodeExecutionMailboxManagedChild` still allowed `kind: "sub-workflow"`, but `buildMailboxStructure` / `buildManagedChildren` only ever emitted the root graph and `node` children. Checkpoint commit messages still printed a `Subworkflow-ID` line that was always unset (`buildOutputRefForExecution` does not set `subWorkflowId`). `design-node-mailbox.md` still described nested sub-workflow managers and parent/sub routing at odds with the step-addressed engine.
- **Production**: Simplified `NodeExecutionMailboxStructure` to `type: "workflow-execution"` with only `managerRuntimeId` + `nodes` list. Removed `NodeExecutionMailboxManagedChild.kind` and the unused sub-workflow render branch. Dropped the `Subworkflow-ID` line from `buildCommitMessageTemplate` in `src/workflow/engine.ts` and `src/workflow/call-step-impl.ts`.
- **Design**: Reworked `design-docs/specs/design-node-mailbox.md` (Scope, allocation/scoping, path rules, write ownership, delivery flow, relationship to conversation model) to describe a single manager per `workflowExecutionId`, cross-execution handoffs, and no structural nested sub-workflow graph in `workflow.json`. Does **not** change `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`.

**Tasks In Progress**:
- Module 1: residual example/docs wording outside protected specs; module 2–4 unchanged.

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/workflow/prompt-composition.test.ts src/workflow/engine.test.ts src/workflow/call-step-impl.test.ts --runInBand` (`123` pass)
`bun test src/workflow/ --runInBand` (`700` pass)
Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`.

### Session: 2026-04-27 (module 1 slice: remove `subWorkflowId` from session output refs and optional-node decisions)

**Tasks Completed**:
- **Production**: Removed optional `subWorkflowId` from `NodeOutputRef`, `ManagerMessagePayloadRef`, and `PendingOptionalNodeDecision` in `src/workflow/session.ts`. `normalizeSessionState` now strips legacy `subWorkflowId` from communication `payloadRef`, `conversationTurns[].outputRef`, and `pendingOptionalNodeDecisions` so older on-disk session JSON still loads without preserving the field. Dropped the unused `subWorkflowId` parameter from `prepareManagerMessageArtifacts` in `src/workflow/manager-message-service/artifacts.ts` and the always-`undefined` call site in `src/workflow/manager-message-service.ts`.
- **Design (non-protected specs)**: Aligned `design-docs/specs/design-data-model.md`, `design-docs/specs/design-graphql-manager-control-plane.md` (payload ref bullets), `design-docs/specs/design-user-action-and-optional-node-execution.md`, and `design-docs/specs/notes.md` with the removal of `subWorkflowId` from the public ref shapes.
- **Tests**: `src/workflow/session.test.ts` coverage for load-time stripping; `src/workflow/communication-service.test.ts` updated for the slimmed artifact API.

**Tasks In Progress**:
- Module 1: TUI / prompt **wording** still mentioning sub-workflow scope in a few places; `design-graphql-manager-control-plane.md` “Typed Action Envelope” still lists removed actions such as `start-sub-workflow` (doc-only drift, separate pass).
- Module 1: reject or fully delete authored `subWorkflows` / top-level keys in `validate`/`types` / examples per broader module-1 list.
- Module 2–4: unchanged.

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/workflow/session.test.ts src/workflow/communication-service.test.ts src/workflow/manager-message-service.test.ts --runInBand` (`22` pass)
`bun test src/workflow/ --runInBand` (`701` pass)
Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`.

### Session: 2026-04-27 (module 1 slice: unified `subWorkflows` / `subWorkflowConversations` rejection copy + README / GraphQL design alignment)

**Tasks Completed**:
- **Production**: `normalizeWorkflow` (legacy node-graph path) in `src/workflow/validate.ts` now emits a **single** error message for `workflow.subWorkflows` and `workflow.subWorkflowConversations`, removing the `usesAuthoredRoleModel` branch that produced a different “cannot be combined with role/control” string. Behavior remains: any presence of these keys is an error; only the diagnostic text is unified.
- **Tests**: Updated expected issue messages in `src/workflow/validate.test.ts`, `src/workflow/save.test.ts`, and `src/workflow/load.test.ts` to match.
- **Docs**: `README.md` — replaced stale “reserved / do not combine” bullets for `subWorkflows` / `subWorkflowConversations` with “rejected by validation”; clarified `subworkflow-manager` / `input` / `output` as rejected for role bundles; tightened the role-authoring note on `kind`. `design-docs/specs/design-graphql-manager-control-plane.md` — removed root/subworkflow-manager scope split; rephrased `deliver-to-child-input` paragraph without nested structural sub-workflow ownership (did **not** edit `architecture.md` or `design-step-run-history-rerun.md`).

**Tasks In Progress**:
- Module 1: broader README “Legacy/compatibility” section still lists top-level keys (e.g. `managerRuntimeId`) as “may still include” while validation rejects them — full README accuracy pass deferred.
- Module 1: TUI/prompt residual “sub-workflow” wording; GraphQL doc “Typed Action Envelope” list if it still references removed actions.
- Module 2–4: unchanged.

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/workflow/validate.test.ts src/workflow/save.test.ts src/workflow/load.test.ts --runInBand` (`301` pass)

### Session: 2026-04-27 (module 1 slice: README + GraphQL control-plane doc accuracy; manager-control test title)

**Tasks Completed**:
- **Inventory**: `fromSubWorkflowId` / `toSubWorkflowId` remain absent from `src/**` (no further production deletion in that cluster this session). Highest remaining doc debt from the prior log was README listing rejected top-level keys as if they were still valid legacy fields, and `design-graphql-manager-control-plane.md` “Typed Action Envelope” still documenting removed structural actions.
- **Docs**: `README.md` — split “may still use” vs “rejected” for legacy node-graph authoring; removed the obsolete “Legacy structural conversation support” subsection; aligned “What Is Implemented Today” entry/manager bullets with strict rejection of top-level `managerRuntimeId` / `entryNodeId` and inference-only entry; trimmed the `kind` list to match `NodeKind` (dropped a standalone `subworkflow-manager` line in favor of “rejected string” wording). `design-docs/specs/design-graphql-manager-control-plane.md` — replaced Typed Action Envelope with the real `ManagerControlAction` set (`retry-step`, optional-step actions, `replay-communication`, `planner-note`); updated runtime processing bullets; de-emphasized retired `start-sub-workflow` / `deliver-to-child-input` provenance narrative; neutralized “sub-workflow managers” phrasing in the provenance list.
- **Tests**: Renamed one misleading `manager-control` unit test (no behavior change).
- **Protected specs**: Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`.

**Tasks In Progress**:
- Module 1: TUI/prompt residual “sub-workflow” wording in preview/indent tests (cosmetic); any other design docs that still embed historical union members in prose-only sections (e.g. `design-user-action-and-optional-node-execution.md` history blocks).
- Module 2–4: unchanged (examples retirement, optional full-repo `bun test` sweeps).

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server`
`bun test src/workflow/manager-control.test.ts --runInBand`

### Session: 2026-04-27 (module 1 slice: TUI preview indent — remove dead structural `inSubworkflowScope`)

**Tasks Completed**:
- **Inventory**: `fromSubWorkflowId` / `toSubWorkflowId` remain absent from `src/**` (prior sessions). Next high-value deletion was TUI-only: `resolveWorkflowPreviewIndent` accepted `inSubworkflowScope`, but the only production caller (`buildWorkflowNodeVisualMetadata` in `src/tui/opentui-model/shared.ts`) always passed `false`, so the `inSubworkflowScope === true` branch (+1 indent) was dead after structural sub-workflow removal.
- **Production**: Dropped `inSubworkflowScope` from `resolveWorkflowPreviewIndent`; non–`root-manager` nodes now use visualization `derivedIndent` only (aligns preview indentation with `deriveWorkflowVisualization` and single-workflow graph scope).
- **Tests**: Rewrote `resolveWorkflowPreviewIndent` unit tests in `src/tui/opentui-screen-runtime.test.ts` to match the slimmer API (no “subworkflow scope” wording).
- **Protected specs**: Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`.

**Tasks In Progress**:
- Module 1: TUI test modules still declare `LegacyStructuralSubworkflowFixture` / `LegacyStructuralWorkflow` types for preview fixtures that inject raw `subWorkflows` shapes (validation rejects these on disk; tests only exercise “omit legacy lines from previews”); optional follow-on to delete those fixture types if previews no longer need synthetic `subWorkflows` blobs.
- Module 1: broader `subWorkflows` / `managerRuntimeId` rejection tests and examples retirement; module 2–4 unchanged.

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/tui/opentui-screen-runtime.test.ts --runInBand` (`18` pass)
`bun test src/tui/ --runInBand` (`141` pass)
Full-repo `bun test` not re-run this session.

### Session: 2026-04-27 (module 1 slice: test fixtures — remove synthetic `subWorkflows` + `LegacyStructuralSubworkflowFixture` aliases)

**Tasks Completed**:
- **Inventory**: Communication `fromSubWorkflowId` / `toSubWorkflowId` remain absent from `src/**`. Next coherent cleanup was the duplicated per-file `LegacyStructuralSubworkflowFixture` / `LegacyStructuralWorkflow` types and invalid-on-disk `subWorkflows: [...]` blobs in unit-test fixtures, left over after structural sub-workflow removal from production; `deriveWorkflowVisualization` and manager-control parsing never consumed `subWorkflows` metadata.
- **Tests**: Dropped `subWorkflows` blocks from TUI and workflow test helpers (`opentui-screen-runtime.test.ts`, `opentui-screen-navigation.test.ts`, `opentui-screen.test.ts` still casts one in-memory `subWorkflows` array as `WorkflowJson` for the “omit legacy preview lines” test), `manager-control.test.ts`, `prompt-composition.test.ts` (removed redundant `subWorkflows: []` test; `makeWorkflow` no longer authors structural keys), `visualization.test.ts` (replaced `LegacyStructuralSubworkflowFixture` with `NodeGraphWorkflow`; removed all `subWorkflows` arrays; renamed tests to describe graph behavior without structural metadata), and `runtime-addressing.test.ts` (fixture is plain `WorkflowJson` without `subWorkflows` / `managerRuntimeId` / `entryNodeId` / `edges`). Introduced `LegacyNodeGraphFixture` only where an explicit node-graph `edges`/`loops` companion is still needed for the parser under test.
- **Design / architecture**: No change. Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`.

**Tasks In Progress**:
- Module 1: `validate` / `load` / `save` tests and examples that intentionally author rejected `subWorkflows` (validation-path coverage) remain; examples retirement and README accuracy sweeps as in prior log.
- Module 2–4: unchanged (optional full-repo `bun test` sweeps).

**Blockers**: None. Full `src/workflow/**` and full-repo test suites not re-run this session (focused slice only).

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/tui/opentui-screen-runtime.test.ts src/tui/opentui-screen-navigation.test.ts src/tui/opentui-screen.test.ts src/workflow/manager-control.test.ts src/workflow/prompt-composition.test.ts src/workflow/visualization.test.ts src/workflow/runtime-addressing.test.ts --runInBand` (`165` pass)

### Session: 2026-04-27 (module 2 slice: remove structural communication scope plumbing from `engine.ts`)

**Tasks Completed**:
- **Inventory**: `CommunicationRecord` / session types already omitted `fromSubWorkflowId` / `toSubWorkflowId` in `src/workflow/session.ts`. `src/**` had no remaining grep hits for those fields before this pass; legacy gap was **engine-local** optional fields, artifact spreads, and a residual `resolveCommunicationBoundary` shim (the index had already staged most of the structural branch deletion inside that helper).
- **Production (`src/workflow/engine.ts`)**: Deleted the remaining `resolveCommunicationBoundary` helper and inlined `routingScope: "intra-workflow"` for workflow-call result delivery and both edge-transition paths. Removed optional `fromSubWorkflowId` / `toSubWorkflowId` from `UpstreamOutputRef` and `CreateCommunicationInput`, dropped conditional spreads when persisting communications and when building upstream output refs, removed the `Subworkflow-ID` line from `buildCommitMessageTemplate`, and removed stale `fromSubWorkflowId` from the manager transcript projection (turn type no longer carries it). Replaced remaining `intra-sub-workflow` routing literals with `intra-workflow` to match `CommunicationRoutingScope`.
- **Tests**: No expectation changes required. **Design**: Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`.

**Tasks In Progress**:
- Module 1: TUI `opentui-screen.test.ts` still injects in-memory `subWorkflows` / `managerRuntimeId` / `entryNodeId` via casts for preview-only scenarios.
- Module 1: `validate` / `load` / `save` / examples for rejected `subWorkflows` and top-level `managerRuntimeId` / `entryNodeId`.
- Staged vs unstaged: larger `engine.ts` deletions may still be split across index and worktree from multi-step editing; consolidate before commit if desired.

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/workflow/engine.test.ts src/workflow/session.test.ts src/workflow/communication-service.test.ts src/workflow/runtime-db.test.ts --runInBand` (`125` pass)
`bun test` full repo (`1109` pass, 74 files) after final `engine.ts` state

### Session: 2026-04-27 (module 1 slice: TUI tests — drop invalid in-memory `managerRuntimeId` / `entryNodeId` / `subWorkflows` fixtures)

**Tasks Completed**:
- **Inventory**: `fromSubWorkflowId` / `toSubWorkflowId` remain absent from `src/**` (prior sessions). Coherent follow-on from the last log was preview tests that still embedded **rejected** top-level workflow keys purely to drive TUI copy; `WorkflowJson` and `buildLegacy*DisplayLine` already infer manager/entry from `root-manager` / roles / edges (`src/workflow/types.ts`, `src/tui/opentui-model/workflow-rendering.ts`).
- **Tests**: `src/tui/opentui-screen.test.ts` — removed `managerRuntimeId` / `entryNodeId` from worker-only fixtures (two tests); removed redundant top-level `managerRuntimeId` from the workflow-call preview fixture; **deleted** the test that injected a synthetic `subWorkflows` array into step-addressed workflows (coverage redundant with existing “no Legacy structural” assertions on valid bundles). `src/tui/opentui-detail-content.test.ts` — removed `managerRuntimeId` from the shared `makeLoadedWorkflow` helper (manager still resolved via `kind: "root-manager"`).
- **Design / protected specs**: Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`. Behavior matches the documented model: normalized bundles do not persist those keys; previews use runtime resolution helpers.

**Tasks In Progress**:
- Module 1: `prompt-composition.test.ts` / `manager-control.test.ts` still declare optional `managerRuntimeId` on local fixture types where unnecessary; `validate` / `load` / `save` / examples for rejected `subWorkflows` and top-level ids (intentional validation coverage).
- Module 2–4: `subworkflow-manager` string handling in node-role/TUI/readers; `engine.test.ts` and other tests asserting historical structural sub-workflow behavior.

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/tui/opentui-screen.test.ts src/tui/opentui-detail-content.test.ts --runInBand` (`78` pass)
`bun test src/tui/ --runInBand` (`140` pass)
Full-repo `bun test` not re-run this session.

### Session: 2026-04-27 (module 2 slice: drop `normalizeSessionState` `subWorkflowId` stripping; test fixture cleanup on branch)

**Tasks Completed**:
- **Inventory**: `fromSubWorkflowId` / `toSubWorkflowId` remain absent from `src/**` (no reintroduction). Load-time stripping of optional `subWorkflowId` on communication `payloadRef` values, conversation-turn `outputRef` values, and `pendingOptionalNodeDecisions` was redundant after types dropped that field; removing it tightens the normalization surface.
- **Production (`src/workflow/session.ts`)**: Removed `stripLegacySubWorkflowIdFromNodeOutputRef`, `stripLegacySubWorkflowIdFromManagerMessageRef`, `normalizeCommunicationPayloadRef`, and `stripLegacySubWorkflowIdFromPendingOptionalDecision`. `normalizeSessionState` no longer rewrites `payloadRef` or strips extra keys from optional decisions; it still normalizes `communications[].routingScope` via `normalizeCommunicationRoutingScope` and shallow-clones conversation turns and pending optional decisions. Tightened the doc comment for `normalizeCommunicationRoutingScope` (any non-`external-mailbox` value maps to `intra-workflow`).
- **Tests (`src/workflow/session.test.ts`)**: Deleted `"strips legacy subWorkflowId from communications, turns, and pending optional decisions on load"`. Kept routing-scope legacy normalization coverage where present.
- **Tests (same branch worktree)**: `prompt-composition.test.ts` and `manager-control.test.ts` — drop structural `subWorkflows` / `subworkflow-manager` / `getStructuralSubWorkflows` / top-level `managerRuntimeId` from local fixtures, remove the `assertCommunicationInManagerScope` replay test that depended on removed communication fields, and treat nested coordinator nodes as `task` / `root-manager` as appropriate so tests match current `NodeKind` and validation (no reintroduction of structural runtime behavior).
- **Protected specs**: Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`.

**Tasks In Progress**:
- Module 1: `validate` / `load` / `save` / examples for rejected `subWorkflows` and top-level `managerRuntimeId` / `entryNodeId` (intentional coverage); optional full-repo `bun test` sweep.
- Module 2–4: any remaining `engine.test.ts` / integration tests tied to pre-migration behavior outside current slices; `subworkflow-manager` rejection tests in `validate.test.ts` (keep as negative tests).

**Blockers**: None. **Caveat**: Extremely old on-disk session JSON that still embeds a `subWorkflowId` key on output refs is no longer stripped on `normalizeSessionState`; extra keys are ignored by typed code paths. If a future strict JSON round-trip test requires a canonical shape, reintroduce an explicit whitelisted ref serializer instead of ad-hoc strip.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/workflow/session.test.ts src/workflow/prompt-composition.test.ts src/workflow/manager-control.test.ts --runInBand` (`44` pass)
`bun test src/workflow/communication-service.test.ts src/workflow/manager-message-service.test.ts --runInBand` (`10` pass)
Full-repo `bun test` not re-run this session.

### Session: 2026-04-27 (module 2 slice: communication routingScope — tests + data-model spec aligned with generic coercion)

**Tasks Completed**:
- **Inventory**: Production already exposes only `intra-workflow` | `external-mailbox` for `CommunicationRoutingScope`; `fromSubWorkflowId` / `toSubWorkflowId` remain absent from `src/**`. Remaining debt was **named** removed routing enums still appearing in `session.test.ts` and `design-data-model.md` even though `normalizeCommunicationRoutingScope` treats any non-`external-mailbox` value uniformly.
- **Production (`src/workflow/session.ts`)**: Clarified JSDoc on `normalizeCommunicationRoutingScope` (obsolete structural labels and typos coerce to `intra-workflow`).
- **Tests (`src/workflow/session.test.ts`)**: Replaced fixtures that spelled old `intra-sub-workflow` / `cross-sub-workflow` strings with a single opaque obsolete label; renamed the test to describe non-external coercion; kept `external-mailbox` preservation assertion.
- **Design**: `design-docs/specs/design-data-model.md` — Routing Scopes section now documents load-time coercion in terms of `normalizeCommunicationRoutingScope` without enumerating removed enum members. Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`.

**Tasks In Progress**:
- Module 1: `validate` / `load` / `save` / examples for rejected `subWorkflows` and top-level `managerRuntimeId` / `entryNodeId` (intentional coverage).
- Module 2–4: `subworkflow-manager` negative tests in `validate.test.ts`; any residual `engine.test.ts` / integration coverage tied to pre-migration wording (low priority if behavior already migrated).

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/workflow/session.test.ts --runInBand` (pass)
Did **not** run full-repo `bun test` this session.

### Session: 2026-04-27 (module 2 slice: removed structural manager-control action test debt)

**Tasks Completed**:
- **Inventory**: `fromSubWorkflowId` / `toSubWorkflowId` remain **absent** from `src/**` (no production change in that cluster). `parseManagerControlActionInput` already maps all non-supported `type` strings to a single `"is not supported"` error; redundant coverage paths were the main remaining debt.
- **Tests (`src/workflow/manager-control.test.ts`)**: Replaced three overlapping negative tests (`start-sub-workflow` via payload + duplicate `start-sub-workflow` + `deliver-to-child-input` via payload) with one test, `rejects removed structural manager control action types`, that loops `start-sub-workflow` and `deliver-to-child-input` through `parseManagerControlActions` on a role-authored workflow (same parser entry as `parseManagerControlPayload`).
- **Tests (`src/workflow/manager-message-service.test.ts`)**: Deleted `rejects removed start-sub-workflow action type in manager messages` — behavior is fully covered by `manager-control` unit tests; `sendManagerMessage` delegates to `parseManagerControlActions`.
- **Tests (`src/workflow/prompt-composition.test.ts`)**: Renamed a misleading test title that still said "subworkflow compatibility bundles" (no fixture or behavior change).
- **Architecture / design**: No design doc edits. Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`. Intended direction (no structural sub-workflow manager actions) is unchanged; this pass only trimmed duplicate regression tests.

**Tasks In Progress**:
- Module 1: `validate` / `load` / `save` / examples for rejected `subWorkflows` and top-level `managerRuntimeId` / `entryNodeId` (intentional coverage); optional README accuracy for the same keys.
- Module 2–4: `subworkflow-manager` negative tests in `validate.test.ts`; `engine.test.ts` non-regression strings for removed action types in manager prompts (keep); optional full-repo `bun test` sweep.

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/workflow/manager-control.test.ts src/workflow/manager-message-service.test.ts src/workflow/prompt-composition.test.ts --runInBand` (`36` pass)
Full-repo `bun test` not re-run this session.

### Session: 2026-04-27 (module 3 / module 1 slice: consolidate removed node-kind `subworkflow-manager` test debt; fix misleading test titles)

**Tasks Completed**:
- **Inventory**: `fromSubWorkflowId` / `toSubWorkflowId` remain **absent** from `src/**` (no production code in that cluster in this pass). The highest-value remaining work in the “legacy node-kind / test debt” column was `validate.test.ts`: a dedicated `subworkflow-manager` negative test duplicated the existing `expectInvalidNodeKind` helper and three sibling tests.
- **Tests (`src/workflow/validate.test.ts`)**: Replaced the four separate invalid-kind tests (including the extra role-authored `subworkflow-manager` block) with a single `test.each` over `["sub-manager", "manager", "sub-divedra-manager", "subworkflow-manager"]`, reusing `expectInvalidNodeKind` (legacy node-graph fixture). Renamed two tests that still referenced `workflow.managerRuntimeId` in their titles even though the fixtures no longer set that field (`rejects manager-role node with task kind; inferred manager must be root-manager`, `rejects additional root-manager nodes when a single manager is already defined`).
- **Design / protected specs**: Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`. Behavior is unchanged: unknown `kind` strings fail `normalizeNodeKind` and surface `must be a valid node kind` at `workflow.nodes[1].kind`.

**Tasks In Progress**:
- Module 1: `validate` / `load` / `save` / examples for rejected `subWorkflows` and top-level `managerRuntimeId` / `entryNodeId` (intentional negative coverage; optional README sweep).
- Module 2: any remaining `engine.test.ts` prompt non-regressions (strings only, low priority if unchanged).

**Blockers**: None. No production `src/**` change this session: structural communication IDs and GraphQL `CommunicationRecord` were already free of `fromSubWorkflowId` / `toSubWorkflowId`; this pass only reduced redundant tests around the removed `subworkflow-manager` kind string.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/workflow/validate.test.ts --runInBand` (`170` pass)
Full-repo `bun test` not re-run this session.

### Session: 2026-04-27 (module 1 / cross-workflow slice: drop dead `EffectiveWorkflowCall.source`; README vs validation alignment)

**Tasks Completed**:
- **Inventory**: `fromSubWorkflowId` / `toSubWorkflowId` remain absent from `src/**` (no change in that cluster). Remaining high-value debt was a **never-instantiated** `legacy-workflow-call` label on `EffectiveWorkflowCall` (only `step-transition` was ever produced) and README text that still implied authored top-level `workflowCalls` / `branching` were valid on any path while validation rejects them.
- **Production (`src/workflow/cross-workflow-from-steps.ts`)**: Removed the `source` field from `EffectiveWorkflowCall` and from objects built in `crossWorkflowCallsFromSteps` (all rows are step-transition-derived; there is no second source).
- **Tests**: Updated `cross-workflow-from-steps.test.ts` and `validate.test.ts` expected objects to match the slimmer type.
- **README.md**: Replaced the contradictory “legacy bundles may still use workflowCalls/branching” block with: explicit rejected top-level keys (including `workflowCalls`, `branching`, and step-addressed `edges`/`loops`), a single statement that cross-workflow calls are only via `steps[].transitions`, and tightened the legacy node-graph vs step-addressed split. Clarified the closing paragraph (prefer step-addressed for new work).
- **Protected specs**: Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`. Intended architecture (step-addressed runtime, no structural sub-workflows, no authored `workflowCalls`) already matches; README was the drift.

**Tasks In Progress**:
- Module 1: deeper `types.ts` / `save.ts` / `load.ts` trimming of internal legacy record aliases; examples retirement; optional full-repo `bun test` sweep.
- Module 2–4: any residual engine/TUI test strings that only guard removed features (low priority if behavior already migrated).

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/workflow/cross-workflow-from-steps.test.ts src/workflow/validate.test.ts --runInBand` (`179` pass)
Full-repo `bun test` not re-run this session.

**Review matrix note**: Cross-workflow inspection/runtime rows are step-derived only; the removed `source` field was legacy labeling debt, not behavior.

### Session: 2026-04-27 (module 1 slice: stop silently dropping empty `subWorkflows` on legacy save; validate rejects key)

**Tasks Completed**:
- **Inventory**: `fromSubWorkflowId` / `toSubWorkflowId` remain absent from `src/**` (prior work). Next coherent deletion was save-path **special casing** that removed empty `subWorkflows` arrays before validation, which hid the same top-level key that `normalizeWorkflow` already rejects (`workflow.subWorkflows` — structural sub-workflows unsupported).
- **Production (`src/workflow/save.ts`)**: Removed `subWorkflows` from the legacy no-op companion empty-array cleanup and from the `shouldPersistTopLevelField` persistence loop (companion keys are now `workflowCalls` and `loops` only). Any authored `subWorkflows` (including `[]`) now reaches validation and fails consistently.
- **Tests (`src/workflow/save.test.ts`)**: Dropped `subWorkflows: []` from the “drops no-op legacy compatibility companions” raw fixture (still asserts output omits `subWorkflows`). Added `rejects legacy node-graph save when raw input includes empty subWorkflows` to lock the stricter behavior.
- **Protected specs**: Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`.

**Tasks In Progress**:
- Module 1: further `save.ts` / `validate.ts` overlap for other legacy top-level keys (optional consolidation); `types.ts` docstrings that still describe “compatibility” stripping; examples retirement; optional full-repo `bun test` sweep.
- Module 2–4: residual `engine.test.ts` / TUI strings for removed manager actions (low priority).

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/workflow/save.test.ts --runInBand` (`53` pass)
Full-repo `bun test` not re-run this session.

**Behavior note**: Legacy saves that only differed by an empty on-disk `subWorkflows: []` companion are now invalid until the key is removed from `workflow.json` (same as role-authored and non-empty cases).

### Session: 2026-04-27 (module 1 slice: `workflow.subWorkflows` rejection message + types docstrings)

**Tasks Completed**:
- **Inventory**: `fromSubWorkflowId` / `toSubWorkflowId` remain absent from `src/**` (no change in that area). The legacy node-graph path still rejected `workflow.subWorkflows` with a long "legacy compatibility only" string duplicated across `validate` and many tests; step-addressed validation already uses the generic "not part of the step-addressed schema" string for the same key.
- **Production (`src/workflow/validate.ts`)**: Added exported `WORKFLOW_SUBWORKFLOWS_UNSUPPORTED_MESSAGE` (`"top-level subWorkflows are not supported"`) and used it for the single legacy-path `workflow.subWorkflows` error. Replaced the historical "Phase 133" note on `validateCrossWorkflowCalleeEntryAlignmentSync` with a neutral one-liner (legacy `entryNodeId` is not used for callee entry alignment).
- **Production (`src/workflow/types.ts`)**: Shortened `AuthoredWorkflowJson` and `WorkflowJson` JSDoc to remove redundant "compatibility" narration while keeping the same intent (rejected top-level keys; normalized graph uses resolver helpers).
- **Tests**: `save.test.ts`, `load.test.ts`, `validate.test.ts` import the shared message constant instead of spelling the long literal; structural-rejection tests that used `.includes("legacy compatibility only")` for `subWorkflows` now assert equality to the constant.
- **Protected specs**: Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`.

**Tasks In Progress**:
- Module 1: optional DRY of the step-addressed disallowed top-level key list between `save.ts` and `validate.ts`; further trimming of `prepareAuthoredWorkflowForSave` / other legacy save comments; examples retirement; optional full-repo `bun test` sweep.
- Module 2–4: any remaining engine/test strings for removed features (low priority).

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server`
`bun test src/workflow/validate.test.ts src/workflow/save.test.ts src/workflow/load.test.ts --runInBand`

### Session: 2026-04-27 (module 1 slice: unconditional strip of authored `managerRuntimeId` / `entryNodeId` on legacy save path)

**Tasks Completed**:
- **Inventory**: Authored `workflow.json` validation already rejects top-level `managerRuntimeId`, `entryNodeId`, and `subWorkflows` on every path (`normalizeWorkflow` legacy branch and step-addressed branch). `prepareAuthoredWorkflowForSave` still carried persistence rules (`shouldPersistTopLevelField`, manager-role heuristics) that could only produce output consistent with validation by stripping those keys; `preparedWorkflow["hasManagerNode"] === false` was **dead** after `stripPersistedWorkflowCompatibilityFields` removed `hasManagerNode` first.
- **Production (`src/workflow/save.ts`)**: `stripPersistedWorkflowCompatibilityFields` now always drops top-level `managerRuntimeId` and `entryNodeId` (in addition to `hasManagerNode`). Removed `hasManagerRoleNode` / `hasAuthoredManagerRoleNode`. `prepareAuthoredWorkflowForSave` always deletes `managerRuntimeId` and `entryNodeId` after node preparation instead of branching on manager-role and existing-disk presence.
- **Production (`src/workflow/types.ts`, `src/workflow/validate.ts`)**: Tightened JSDoc for `AuthoredWorkflowJson`, `WorkflowJson`, and `REJECTED_AUTHORED_TOP_LEVEL_NODE_GRAPH_FIELD_KEYS` to describe current behavior without redundant “compatibility carrier” framing.
- **Tests (`src/workflow/types.test.ts`)**: Renamed the strict-type regression test and `@ts-expect-error` comments to refer to disallowed schema keys rather than “legacy compatibility”.
- **Protected specs**: Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`. `design-workflow-json.md` and the active impl plan already match the step-addressed / rejected-keys direction; no new implementation plan was required.

**Tasks In Progress**:
- Module 1: optional further DRY between `collectStepAddressedSaveLegacyFieldIssues` and `validate` for remaining step-addressed-only keys (`edges` message remains save-specific); examples retirement; full-repo `bun test` sweep.
- Module 2–4: residual test/fixture strings tied to removed structural behavior (low priority).

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand` (`225` pass)
`check-and-test-after-modify` subagent re-ran typecheck + tests (pass)
Full-repo `bun test` not re-run this session.

### Session: 2026-04-27 (module 1: dedupe `prepareAuthoredWorkflowForSave` after `stripPersistedWorkflowCompatibilityFields`)

**Tasks Completed**:
- **Reviewed** continuing work from the prior slice (shared rejected-key constants in `validate.ts` / `save.ts`, unconditional strip of top-level `managerRuntimeId` / `entryNodeId` in `stripPersistedWorkflowCompatibilityFields`, removal of manager-role persistence heuristics). Confirmed alignment with `design-docs/specs/design-workflow-json.md` (rejected keys; step-addressed surface); no new design doc or parallel plan.
- **Production (`src/workflow/save.ts`)**: Removed redundant `delete` of `managerRuntimeId` / `entryNodeId` after node preparation in `prepareAuthoredWorkflowForSave`, since `stripPersistedWorkflowCompatibilityFields` already removes them before the prepared workflow object is built (single locus, same behavior).
- **Protected specs**: Did **not** modify `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`.

**Tasks In Progress**:
- Module 1: optional rename of `REJECTED_AUTHORED_TOP_LEVEL_NODE_GRAPH_FIELD_KEYS` (name reflects rejection on all authored paths, not only node-graph); optional DRY for step-addressed-only legacy keys vs `validate`; examples retirement; full-repo `bun test` sweep.
- Module 2–4: unchanged.

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/workflow/save.test.ts src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/types.test.ts --runInBand` (`304` pass)
Full `bun test` (`1105` pass, `74` files).

### Session: 2026-04-27 (module 1: DRY + rename for rejected top-level keys)

**Tasks Completed**:
- **Inventory**: Confirmed `design-docs/specs/design-workflow-json.md` already states step-addressed direction and disallowed top-level fields; `architecture.md` / `design-step-run-history-rerun.md` not modified. Extended that design doc to name `managerRuntimeId` and `entryNodeId` as rejected legacy top-level fields and to point at `src/workflow/validate.ts` for the exact key sets and messages.
- **Production (`src/workflow/validate.ts`)**: Renamed `REJECTED_AUTHORED_TOP_LEVEL_NODE_GRAPH_FIELD_KEYS` to `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS` (legacy `normalizeWorkflow` branch). Introduced `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS` as the single list for the step-addressed branch (three disallowed keys plus `workflowCalls`, `subWorkflowConversations`, `edges`, `loops`, `branching`). Clarified JSDoc for cross-workflow callee entry validation.
- **Production (`src/workflow/save.ts`)**: `collectStepAddressedSaveLegacyFieldIssues` now iterates `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`, skipping `edges` so the save-specific `edges` error text is unchanged; all other keys use `REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE` as before.
- **Production (`src/workflow/types.ts`)**: `AuthoredWorkflowJson` JSDoc now references the new validator export names instead of “compatibility” / “wider Record” phrasing.
- **Tests**: None required; behavior and messages unchanged.

**Tasks In Progress**:
- Module 1: examples retirement; optional full-repo `bun test` sweep.
- Module 2-4: residual strings tied to removed structural behavior (low priority).

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/workflow/validate.test.ts src/workflow/save.test.ts src/workflow/load.test.ts src/workflow/types.test.ts --runInBand` (`304` pass)
Full-repo `bun test` not re-run this session.

### Session: 2026-04-27 (module 1: review + DRY exports + test label cleanup)

**Tasks Completed**:
- **Review (worktree / prior commits)**: Confirmed the intended split remains: **load/validate** of on-disk `workflow.json` still **rejects** top-level `managerRuntimeId`, `entryNodeId`, and `subWorkflows` via `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS` in the legacy `normalizeWorkflow` branch; **save** runs `stripNormalizedOnlyWorkflowTopLevelFields` first so in-memory inputs may drop normalized-only `hasManagerNode` before validation. Disallowed authored keys (`managerRuntimeId`, `entryNodeId`, `subWorkflows`, etc.) are **not** stripped on save; they fail validation like on-disk `workflow.json`.
- **Production (already in worktree)**: Single exported key lists in `validate.ts` (`REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`); legacy + step-addressed validators and `save.ts` pre-scan DRY; `isStrictWorkflowAuthorshipValidation` / callee-entry JSDoc clarified; `save.ts` renames `stripRedundantKindWhenRolePresentOnNode`, `stripNormalizedOnlyWorkflowTopLevelFields`; `types.ts` JSDoc for `AuthoredWorkflowJson`, `WorkflowJson`, and `LoadOptions.rejectLegacyWorkflowAuthoring` aligned with validator exports.
- **Design fit**: `design-docs/specs/design-workflow-json.md` (in worktree) remains consistent with step-addressed authoring and disallowed top-level fields; `design-docs/specs/architecture.md` and `design-docs/specs/design-step-run-history-rerun.md` were not modified (protected). No new parallel implementation plan required.
- **Tests (this session)**: Renamed a few `save.test.ts` / `validate.test.ts` test titles and one helper comment to drop redundant “compatibility” wording (behavior unchanged).

**Tasks In Progress**:
- Module 1: examples retirement; optional full-repo `bun test` sweep; optional DRY of role-authored / validate error strings that still say `legacy compatibility only` (large churn unless done with shared constants in `validate.ts`).
- Module 2–4: residual engine/TUI strings (low priority).

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/workflow/save.test.ts src/workflow/validate.test.ts --runInBand` (`223` pass; subset after title edits)
Prior wider run: `bun test src/workflow/save.test.ts src/workflow/load.test.ts src/workflow/validate.test.ts src/workflow/types.test.ts --runInBand` (`304` pass)
Full-repo `bun test` not re-run this session.

### Session: 2026-04-27 (module 1: explicit save-strip key list, remove derived filter)

**Tasks Completed**:
- **Inventory**: `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS` / `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS` remain the rejection source of truth. `SAVE_STRIP_LEGACY_TOP_LEVEL_ALIAS_KEYS` was a filter-derived exclude of `subWorkflows`, with an exported `RejectedAuthoredDisallowedTopLevelFieldKey` only used to type that derivation; after legacy removal this indirection is unnecessary.
- **Production (`src/workflow/validate.ts`)**: `SAVE_STRIP_LEGACY_TOP_LEVEL_ALIAS_KEYS` is now an explicit `as const` tuple `["managerRuntimeId", "entryNodeId"]` with JSDoc stating why `subWorkflows` is not included. Removed `RejectedAuthoredDisallowedTopLevelFieldKey` (no other references). Rejection loops unchanged.
- **Production (`src/workflow/types.ts`)**: Tightened `AuthoredWorkflowJson` JSDoc to one pointer line (rejected keys + save strip in `validate.ts`). No behavior change.
- **Design**: `design-docs/specs/design-workflow-json.md` already documents strip vs reject; no edit. Protected specs unchanged.

**Tasks In Progress**:
- Module 1: optional shared constants for remaining "legacy compatibility only" error strings; examples retirement; full-repo `bun test` sweep.
- Module 2–4: residual test/engine strings (low priority).

**Blockers**: None.

**Notes / verification commands**:
`bun run typecheck:server` (pass)
`bun test src/workflow/validate.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/load.test.ts --runInBand` (`304` pass)
Full-repo `bun test` not re-run this session.

### Session: 2026-04-27 (module 1: stop stripping legacy `managerRuntimeId` / `entryNodeId` on save)

**Tasks Completed**:
- **Production (`src/workflow/validate.ts`)**: Removed `SAVE_STRIP_LEGACY_TOP_LEVEL_ALIAS_KEYS` (rejection lists unchanged).
- **Production (`src/workflow/save.ts`)**: `stripNormalizedOnlyWorkflowTopLevelFields` now drops only `hasManagerNode`; disallowed top-level `managerRuntimeId` / `entryNodeId` are no longer removed before validation (aligned with on-disk `workflow.json` and `subWorkflows` handling).
- **Production (`src/workflow/types.ts`)**: JSDoc for `AuthoredWorkflowJson` and `LoadOptions` no longer reference save-strip keys for node ids.
- **Design (`design-docs/specs/design-workflow-json.md`)**: Save bullet updated to match (protected `architecture.md` / `design-step-run-history-rerun.md` untouched).
- **Tests (`src/workflow/save.test.ts`)**: Replaced the former “strip then succeed” role-authored alias test with a rejection test using `REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE`.

**Tasks In Progress**:
- Module 1: examples retirement; optional “legacy compatibility only” string DRY in `validate.ts`; full-repo `bun test` sweep.
- Module 2: residual engine/conversation root/sub strings (per plan checklists).

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/save.test.ts src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/types.test.ts --runInBand` (`304` pass)

### Session: 2026-04-27 (module 1/3 slice: superviser tests + impl-plan factual correction)

**Tasks Completed**:
- **Design / architecture**: Re-checked `design-docs/specs/design-workflow-json.md` and this plan against current code: step-addressed authoring with rejected legacy top-level keys and save stripping only `hasManagerNode` remains the documented behavior; no change to protected `architecture.md` or `design-step-run-history-rerun.md`.
- **Tests (`src/workflow/superviser.test.ts`)**: `toStepAddressedWorkflowForSupervision` only inspects `entryStepId` and `steps`; removed misleading top-level `entryNodeId` / `managerRuntimeId` from fixtures so tests do not imply those keys exist on `WorkflowJson`.
- **Plan hygiene (`impl-plans/workflow-legacy-compatibility-removal.md`)**: Corrected an earlier progress-log bullet that incorrectly stated save stripped `managerRuntimeId` / `entryNodeId` (current behavior: validation rejects them; only `hasManagerNode` is dropped before validation).

**Tasks In Progress**:
- Module 1: examples retirement; optional DRY of remaining “legacy compatibility only” strings in `validate.ts`; full-repo `bun test` sweep.
- Module 2–4: residual engine/TUI strings and fixture wording (low priority).

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/superviser.test.ts --runInBand` (`23` pass)
- `bun test src/workflow/save.test.ts src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/types.test.ts --runInBand` (`304` pass)
- `bun test --runInBand` (`1105` pass)

### Session: 2026-04-27 (module 1 slice: unify step-addressed `workflow.edges` rejection copy)

**Tasks Completed**:
- **Production (`src/workflow/validate.ts`)**: Exported `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE` and used it in `normalizeStepAddressedWorkflow` when rejecting top-level `workflow.edges`, so validate/load now match the save pre-scan wording (transitions-only guidance) instead of the generic step-addressed schema sentence.
- **Production (`src/workflow/save.ts`)**: `collectStepAddressedSaveLegacyFieldIssues` now iterates `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS` in one loop with the same edges vs other-key message selection (removed duplicate second pass).
- **Tests (`src/workflow/validate.test.ts`)**: Added regression coverage for a strict step-addressed bundle that incorrectly authors `workflow.edges`.

**Tasks In Progress**:
- Module 1: examples retirement; broader DRY of remaining role-authored “legacy compatibility only” strings in `validate.ts`.
- Module 2–4: residual engine/root-sub and public-surface cleanup per plan.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/validate.test.ts src/workflow/save.test.ts --runInBand` (`224` pass)
- `bun test --runInBand` (`1106` pass)

### Session: 2026-04-27 (module 1: verify in-flight worktree, trim legacy helper JSDoc, align save test title)

**Tasks Completed**:
- **Architecture / design fit**: `design-docs/specs/design-workflow-json.md` (in tree) still matches the implementation: disallowed top-level key sets in `src/workflow/validate.ts`, `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE` for `workflow.edges` on step-addressed bundles, and save pre-validation that only strips normalized `hasManagerNode` (rejected `managerRuntimeId` / `entryNodeId` / `subWorkflows` are not stripped). No change to protected `design-docs/specs/architecture.md` or `design-docs/specs/design-step-run-history-rerun.md`. No separate implementation plan beyond this active plan.
- **Inherited worktree review (uncommitted)**: `save.ts` DRYs step-addressed pre-scan and `normalizeStepAddressedWorkflow` on `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS` + shared messages; `stripNormalizedOnlyWorkflowTopLevelFields` no longer drops `managerRuntimeId` when `hasManagerNode === false`; `prepareAuthoredWorkflowForSave` no longer strips or canonicalizes top-level `managerRuntimeId` / `entryNodeId` (validation rejects disallowed keys like on-disk `workflow.json`); tests simplified to top-level `subWorkflows` presence without structural sub-workflow field assertions. Aligns with prior session log intent; full diff reviewed for consistency.
- **Production (`src/workflow/types.ts`)**: Shortened JSDoc on `getLegacyAuthoredEdges` and `getLegacyAuthoredLoops` to describe persisted node-graph fields and point to `getStructuralEdges` / `getStructuralLoops` (removed redundant “compatibility” boilerplate while keeping accurate legacy node-graph meaning).
- **Tests (`src/workflow/save.test.ts`)**: Renamed the manager-less legacy save test to reflect that the fixture never authors `entryNodeId` and asserts no top-level manager/entry ids after save plus inferred entry at runtime.

**Tasks In Progress**:
- Module 1: optional examples retirement; DRY of “legacy compatibility only” strings in `validate.ts` (large churn unless using shared exports).
- Module 2: residual engine/conversation root/sub string cleanup (per plan).

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/save.test.ts src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/types.test.ts --runInBand` (`305` pass)
- `bun test --runInBand` (`1106` pass)

### Session: 2026-04-27 (module 1: resume dirty worktree, design fit, DRY test assertions on rejection exports)

**Tasks Completed**:
- **Design / architecture**: Re-read `design-docs/specs/design-workflow-json.md`: step-addressed required fields, `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS` / `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE`, and save stripping only `hasManagerNode` match the uncommitted `validate.ts` / `save.ts` / `types.ts` changes. No pivot; protected `design-docs/specs/architecture.md` and `design-docs/specs/design-step-run-history-rerun.md` not modified. No additional implementation plan beyond this file.
- **Worktree review**: The production slice (central `REJECTED_AUTHORED_*` lists, single-loop step-addressed pre-validation in `save.ts`, `stripNormalizedOnlyWorkflowTopLevelFields` dropping only `hasManagerNode`, no save-time strip of disallowed `managerRuntimeId` / `entryNodeId` / `subWorkflows`, renamed node/top-level strippers) is coherent; runtime/session `managerRuntimeId` remains a separate concern from authored top-level rejection (per JSDoc in `types.ts` / `validate.ts`).
- **Tests (`src/workflow/validate.test.ts`, `src/workflow/save.test.ts`)**: Replaced duplicated string literals in step-addressed `workflow.entryNodeId` / `workflow.edges` failure expectations with `REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE` and `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE` so tests track `validate.ts` as the single source of truth; user-visible messages unchanged.

**Tasks In Progress**:
- Module 1: examples retirement; optional DRY of remaining role-authored `legacy compatibility only` validator strings; optional checklist trim for the long module-1 status line.
- Module 2–4: per plan (low priority).

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/validate.test.ts src/workflow/save.test.ts --runInBand` (`224` pass)
- `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand` (`306` pass)
- `bun test --runInBand` (`1107` pass)

### Session: 2026-04-27 (module 1: architecture/design fit vs dirty worktree, no further code changes)

**Tasks Completed**:
- **Design / architecture**: `design-docs/specs/design-workflow-json.md` (staged/dirty) already describes `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`, `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, the step-addressed `workflow.edges` message, and save-time stripping of only `hasManagerNode`. No conflict with the uncommitted `validate.ts` / `save.ts` / `types.ts` slice. Protected `design-docs/specs/architecture.md` and `design-docs/specs/design-step-run-history-rerun.md` not modified. No separate implementation plan added beyond this file.
- **Worktree / diff review**: Central rejection exports, single-loop step-addressed pre-scan in `save.ts` and `normalizeStepAddressedWorkflow`, `stripNormalizedOnlyWorkflowTopLevelFields` (only `hasManagerNode`), and removal of save-time `managerRuntimeId` / `entryNodeId` canonicalization are consistent with negative tests. Runtime/session `managerRuntimeId` remains distinct from authored top-level keys (JSDoc in `types.ts` / `validate.ts`).

**Tasks In Progress**:
- Module 1: optional examples retirement; trim long module-1 checklist line in this plan; optional DRY of remaining role-authored “legacy compatibility only” strings in `validate.ts`.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand` (`304` pass)
- `bun test --runInBand` (`1105` pass)

### Session: 2026-04-27 (module 1: design/architecture fit, finalize dirty authored-schema tail, full verification)

**Tasks Completed**:
- **Design / architecture**: `design-docs/specs/design-workflow-json.md` (in tree) matches the dirty implementation: exported `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE`, strict vs legacy node-graph branching described by `isStrictWorkflowAuthorshipValidation`, and save stripping only `hasManagerNode`. No pivot; protected `design-docs/specs/architecture.md` and `design-docs/specs/design-step-run-history-rerun.md` not modified. No additional implementation plan beyond this file.
- **Worktree review (production)**: `validate.ts` uses the shared key lists in `normalizeStepAddressedWorkflow` and legacy node-graph top-level rejection; `save.ts` pre-scan matches the same list and edges-specific message; `types.ts` `AuthoredWorkflowJson` / `LoadOptions` docs distinguish authored rejection from runtime step id fields named `managerRuntimeId` where applicable.
- **Worktree review (tests)**: `load.test.ts` / `validate.test.ts` use minimal `subWorkflows` fixtures for top-level presence rejection and drop redundant duplicate expectations; cross-workflow callee tests assert missing `entryStepId`/`managerStepId` on disk instead of relying on removed top-level `entryNodeId`; `types.test.ts` locks list composition and extends compile-time exclusions for step-only rejects (`subWorkflowConversations`, `loops`, `branching`); `resolveWorkflow*` tests no longer cast fake top-level `entryNodeId`/`managerRuntimeId` onto `WorkflowJson`; invalid kind table uses `orphan-manager-kind` instead of removed structural manager kind string.

**Tasks In Progress**:
- Module 1: examples retirement (if any bundles still reference rejected keys); optional trim of the long module-1 checklist line; optional DRY of remaining role-authored “legacy compatibility only” strings in `validate.ts`.
- Module 2–4: engine/conversation root-sub and public-surface cleanup per plan.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand` (`304` pass)
- `bun test --runInBand` (`1105` pass)

### Session: 2026-04-27 (module 1: independent re-verify dirty slice and design match)

**Tasks Completed**:
- **Design / architecture**: Re-checked `design-docs/specs/design-workflow-json.md` (validation key sets, Removed Fields) against `src/workflow/validate.ts` exports and `src/workflow/save.ts` behavior; consistent. No new implementation plan file; protected docs unchanged.
- **Code / tests**: Re-reviewed unstaged `types.ts` / `validate.ts` / `save.ts` and matching tests; `superviser.test.ts` change removes invalid top-level `entryNodeId` / `managerRuntimeId` from `WorkflowJson` test fixtures. No further production edits required for this slice.
- **Verification**: `bun run typecheck:server` (pass); focused workflow tests (`304` pass); full `bun test --runInBand` (`1105` pass).

**Tasks In Progress**:
- Module 1: optional examples scan for rejected keys; optional plan checklist trim.
- Module 2+ per plan.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server`
- `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand`
- `bun test --runInBand`

### Session: 2026-04-28 (module 1: retire remaining legacy workflow regression/docs tail)

**Tasks Completed**:
- Replaced the legacy-heavy workflow regression suites in `src/workflow/load.test.ts`, `src/workflow/save.test.ts`, `src/workflow/validate.test.ts`, and `src/workflow/visualization.test.ts` with step-addressed-only coverage. The new suites verify current runtime identity helpers, step-derived routing/loops, load/save rejection of removed top-level authored fields, cross-workflow dispatch derivation, and visualization behavior without node-graph compatibility fixtures.
- Updated repository-facing workflow docs in `README.md`, `design-docs/specs/architecture.md`, `design-docs/specs/design-unified-workflow-role-model.md`, and `design-docs/specs/design-workflow-json.md` so they no longer describe a live legacy node-graph load/save path.

**Tasks In Progress**:
- Optional repo-wide naming cleanup for historical runtime/session field names such as `managerRuntimeId` where they still mean step ids rather than authored workflow compatibility.
- Broader non-workflow docs/example review only if those files still imply deleted compatibility behavior.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server`
- `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts src/workflow/visualization.test.ts`

### Session: 2026-04-27 (module 1: close authored-schema dirty slice, design fit, verification)

**Tasks Completed**:
- **Design / architecture**: `design-docs/specs/design-workflow-json.md` already documents `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`, step-addressed `workflow.edges` wording, and save stripping only `hasManagerNode`; no doc edit required for this slice. Protected `design-docs/specs/architecture.md` and `design-docs/specs/design-step-run-history-rerun.md` not modified.
- **Production (uncommitted)**: `validate.ts` exports consolidated disallowed top-level key lists (`REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`), `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE`, and uses them in `normalizeStepAddressedWorkflow` and legacy node-graph rejection; `isStrictWorkflowAuthorshipValidation` JSDoc clarified (strict vs legacy **node-graph** branch only). `save.ts` pre-scan uses the same list/messages as validate. `types.ts` JSDoc distinguishes authored-schema rejection from runtime/session step ids named `managerRuntimeId`; `LoadOptions.rejectLegacyWorkflowAuthoring` points at `REJECTED_AUTHORED_*` exports.
- **Tests**: `load.test.ts` uses minimal `subWorkflows` presence fixtures, drops duplicate `expect("subWorkflows" in …)` lines, aligns strict role-authored `managerRuntimeId`/`entryNodeId` expectations with `REJECTED_AUTHORED_TOP_LEVEL_SCHEMA_FIELD_MESSAGE`; removes the extra malformed-`subWorkflows` load test (validate still covers legacy node-graph top-level rejection without structural traversal). `validate.test.ts` / `save.test.ts` trimmed per prior sessions; `types.test.ts` asserts list composition and compile-time exclusions.
- **Diff review**: No bugs found; removal of the second subWorkflows load test is acceptable because `validate.test.ts` retains `rejects authored subWorkflows by top-level presence on legacy node-graph bundles (no structural entry validation)`.

**Tasks In Progress**:
- Module 1: optional examples retirement / scan for rejected top-level keys; optional trim of long module-1 checklist line; optional DRY of role-authored “legacy compatibility only” strings in `validate.ts`.
- Module 2–4: engine root/sub, public surfaces, per plan.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand` (`304` pass)
- `bun test --runInBand` (`1105` pass)

### Session: 2026-04-27 (module 1: continuation — design fit, diff review, full verification)

**Tasks Completed**:
- **Design / architecture**: Confirmed `design-docs/specs/design-workflow-json.md` (dirty) lists the same `REJECTED_AUTHORED_*` key sets and save-only `hasManagerNode` strip as `src/workflow/validate.ts` / `save.ts`. Step-addressed `workflow.edges` uses `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE`. No pivot; protected `design-docs/specs/architecture.md` and `design-docs/specs/design-step-run-history-rerun.md` not modified. No separate implementation plan beyond this file.
- **Diff review**: The unstaged authored-schema tail is coherent: shared rejection exports; `save.ts` pre-scan matches validate; `stripNormalizedOnlyWorkflowTopLevelFields` drops only `hasManagerNode`; no save-time strip of disallowed `managerRuntimeId` / `entryNodeId` / `subWorkflows`. `src/workflow/superviser.test.ts` removes misleading top-level `entryNodeId` / `managerRuntimeId` from `WorkflowJson` fixtures (runtime step ids are not those keys). No further production edits required for this slice.
- **Verification**: `bun run typecheck:server` (pass); `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand` (`304` pass); `bun test --runInBand` (`1105` pass).

**Tasks In Progress**:
- Module 1: optional examples scan for rejected top-level keys; optional DRY of remaining role-authored “legacy compatibility only” strings in `validate.ts`; optional trim of the long module-1 status line in this plan.
- Module 2–4: engine/conversation root-sub strings, public surfaces, per plan Review Matrix.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server`
- `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand`
- `bun test --runInBand`

### Session: 2026-04-27 (module 1: authored-schema tail — design fit, diff review, superviser tests, no further code edits)

**Tasks Completed**:
- **Design / architecture**: `design-docs/specs/design-workflow-json.md` (dirty tree) remains aligned with `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`, step-addressed `workflow.edges` messaging via `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE`, and save stripping only `hasManagerNode`. Protected `design-docs/specs/architecture.md` and `design-docs/specs/design-step-run-history-rerun.md` not touched. No new implementation plan file.
- **Diff review**: Uncommitted slice is coherent — `validate.ts` centralizes lists and uses the edges-specific message in `normalizeStepAddressedWorkflow`; legacy node-graph branch rejects only `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`; `save.ts` `collectStepAddressedSaveLegacyFieldIssues` uses the same step-addressed list and message branching; `types.ts` documents authored vs runtime `managerRuntimeId` naming; tests use exported messages where appropriate; `superviser.test.ts` drops fake top-level `entryNodeId` / `managerRuntimeId` from `WorkflowJson` fixtures.
- **Verification**: `bun run typecheck:server` (pass); `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand` (`304` pass); `bun test src/workflow/superviser.test.ts --runInBand` (`23` pass); `bun test --runInBand` (`1105` pass).

**Tasks In Progress**:
- Module 1: optional examples retirement / scan for rejected top-level keys; optional trim of long module-1 status line; optional DRY of role-authored “legacy compatibility only” strings in `validate.ts`.
- Module 2–4: per plan (engine/conversation root-sub, public surfaces).

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server`
- `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand`
- `bun test src/workflow/superviser.test.ts --runInBand`
- `bun test --runInBand`

### Session: 2026-04-27 (module 1: authored-schema tail — architecture fit, diff review, full verification)

**Tasks Completed**:
- **Design / architecture**: `design-docs/specs/design-workflow-json.md` (dirty in worktree) already documents `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS`, step-addressed `workflow.edges` wording, and save stripping only `hasManagerNode`. No conflict with production intent (authored top-level `managerRuntimeId` / `entryNodeId` / `subWorkflows` rejected; runtime/session step ids unchanged). Protected `design-docs/specs/architecture.md` and `design-docs/specs/design-step-run-history-rerun.md` not modified. No new implementation plan beyond this file.
- **Diff review (uncommitted `src/workflow/*`)**: `validate.ts` exports and loops use shared lists; step-addressed path uses `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE` only for `edges`; legacy node-graph branch rejects `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS` only. `save.ts` `collectStepAddressedSaveLegacyFieldIssues` mirrors the same keys and message branching. `types.ts` / `LoadOptions` JSDoc keep authored-schema rejection distinct from runtime naming. Tests assert exported messages and list composition; `superviser.test.ts` drops invalid top-level `entryNodeId` / `managerRuntimeId` from `WorkflowJson` fixtures. No additional code edits required for this slice.
- **Verification**: `bun run typecheck:server` (pass); `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand` (`304` pass); `bun test src/workflow/superviser.test.ts --runInBand` (`23` pass); `bun test --runInBand` (`1105` pass).

**Tasks In Progress**:
- Module 1: optional examples scan / retirement for rejected top-level keys; optional trim of long module-1 checklist line; optional DRY of role-authored “legacy compatibility only” strings in `validate.ts`.
- Module 2–4: engine/conversation root-sub cleanup, public surfaces, per plan.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server`
- `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand`
- `bun test src/workflow/superviser.test.ts --runInBand`
- `bun test --runInBand`

### Session: 2026-04-27 (module 1: independent verification pass; typecheck, focused and full tests)

**Tasks Completed**:
- Re-read `AGENTS.md` and this plan. Confirmed `design-docs/specs/design-workflow-json.md` still matches the dirty `src/workflow` slice: `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS` (`managerRuntimeId`, `entryNodeId`, `subWorkflows`), `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS` (superset for step graphs), `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE`, and save stripping only in-memory `hasManagerNode` via `stripNormalizedOnlyWorkflowTopLevelFields`. No separate implementation plan; protected `architecture.md` and `design-step-run-history-rerun.md` not modified.
- Reviewed uncommitted `validate.ts`, `save.ts`, `types.ts`, and test diffs: no bugs found; `superviser.test.ts` fixture cleanup avoids faking authored top-level node aliases on `WorkflowJson`. Authored-schema tail production behavior is complete; remaining work is outside this slice (examples, module 2+).
- **Verification** (this session): `bun run typecheck:server` (pass); `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand` (`304` pass); `bun test --runInBand` (`1105` pass, `74` files).

**Tasks In Progress**:
- Module 1: optional examples and `EXPECTED_RESULTS` updates when in scope; optional validator string DRY; optional plan checklist trim.
- Module 2-4: per plan (engine root/sub, public surfaces).

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server`
- `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand`
- `bun test --runInBand`

### Session: 2026-04-27 (module 1 authored-schema tail: Cursor agent — design vs code, diff review, no new TS edits)

**Tasks Completed**:
- Re-read `AGENTS.md` and this plan. Confirmed `design-docs/specs/design-workflow-json.md` (worktree) matches production intent: exported `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS` / `REJECTED_AUTHORED_STEP_ADDRESSED_*` in `validate.ts`, step-addressed `edges` message, save pre-scan sharing the composed list, save stripping only `hasManagerNode`. No architecture or protected-doc changes; no additional implementation plan file.
- Reviewed dirty `src/workflow` slice (`types.ts`, `validate.ts`, `save.ts`, `*.test.ts`, `superviser.test.ts`): authored top-level `managerRuntimeId` / `entryNodeId` / `subWorkflows` rejection is centralized; runtime/session `managerRuntimeId` remains valid elsewhere in the repo. No bugs or follow-up fixes identified for this slice in this pass.
- **Verification**: `bun run typecheck:server` (pass); `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand` (`304` pass); `bun test src/workflow/superviser.test.ts --runInBand` (`23` pass); `bun test --runInBand` (`1105` pass, `74` files).

**Tasks In Progress**:
- Module 1 residual: examples / `EXPECTED_RESULTS` / broader design-doc alignment (separate commits); optional trim of the long module-1 status paragraph in this plan.
- Modules 2–4: per Review Matrix (engine/conversation, public surfaces, fixture retirement).

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server`
- `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand`
- `bun test src/workflow/superviser.test.ts --runInBand`
- `bun test --runInBand`

### Session: 2026-04-27 (module 1: authored-schema tail — architecture fit, diff review, independent verification)

**Tasks Completed**:
- **Design / architecture**: `design-docs/specs/design-workflow-json.md` (dirty worktree) documents the same exported key sets and messaging as `validate.ts` / `save.ts`; authored top-level `managerRuntimeId` / `entryNodeId` / `subWorkflows` remain rejected while runtime/session uses of the name `managerRuntimeId` for step ids stay out of scope. Protected `design-docs/specs/architecture.md` and `design-docs/specs/design-step-run-history-rerun.md` not modified. No new implementation plan file.
- **Diff review (uncommitted workflow slice)**: `REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS`, `REJECTED_AUTHORED_STEP_ADDRESSED_EXTRA_TOP_LEVEL_KEYS`, and composed `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS` are single-source in `validate.ts`; `normalizeStepAddressedWorkflow` uses `REJECTED_AUTHORED_STEP_ADDRESSED_EDGES_FIELD_MESSAGE` only for `edges`; legacy node-graph branch rejects the legacy subset only; `save.ts` `collectStepAddressedSaveLegacyFieldIssues` mirrors keys and message branching; `types.ts` / `LoadOptions` JSDoc keep authored rejection distinct from runtime naming. No production bugs identified; no additional TS edits in this pass.
- **Verification** (this session): `bun run typecheck:server` (pass); `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand` (`304` pass); `bun test src/workflow/superviser.test.ts --runInBand` (`23` pass); `bun test --runInBand` (`1105` pass, `74` files).

**Tasks In Progress**:
- Module 1 residual: examples / `EXPECTED_RESULTS` when explicitly in scope; optional dedupe of repeated session blocks in this plan; optional DRY of role-authored strings in `validate.ts`.
- Modules 2–4: engine/conversation root-sub cleanup, public surfaces, per Review Matrix.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server`
- `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand`
- `bun test src/workflow/superviser.test.ts --runInBand`
- `bun test --runInBand`

### Session: 2026-04-27 (module 2: manager-control parse context — drop unused `managerKind`)

**Tasks Completed**:
- Removed `managerKind` from `ManagerControlParseContext` in `src/workflow/manager-control.ts`; scope checks already use `managerRuntimeId` plus optional `managerRole` against `resolveWorkflowManagerRuntimeId(workflow)` (no `root-manager` vs structural sub-manager branching).
- Updated call sites: `src/workflow/engine.ts` (`parseManagerControlPayload`), `src/workflow/manager-message-service.ts` (dropped redundant manager node lookup used only for kind), `src/graphql/schema.ts` (`assertCommunicationInManagerScope`).
- Trimmed `src/workflow/manager-control.test.ts` fixtures accordingly.

**Tasks In Progress**:
- Module 2: deeper engine/session cleanup (e.g. cross-workflow helper naming `parent`/`child` where still misleading, `conversationTurns` transcript path if retired safely), validator legacy `root-manager` graph inference per plan checklist.
- Modules 3–4: GraphQL/inspect wording beyond this slice, examples and fixture retirement.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/manager-control.test.ts src/workflow/manager-message-service.test.ts --runInBand` (21 pass)
- `bun test src/graphql/schema.test.ts --runInBand` (33 pass)

### Session: 2026-04-27 (module 2: cross-workflow artifact JSON — caller/callee field names)

**Historical note:** This session added preferred caller/callee fields on `workflow-calls/*.json` while still dual-writing legacy `parentNodeExecId` / `child*` mirrors; **2026-04-28** removed those mirror writes (new artifacts caller/callee only).

**Tasks Completed**:
- **Production (`src/workflow/engine.ts`)**: `persistCrossWorkflowDispatchArtifact` introduced preferred `callerNodeExecId`, `calleeWorkflowName`, `calleeWorkflowId`, `calleeSessionId`, and `calleeSessionStatus` (legacy mirror keys were added the same day and removed 2026-04-28).
- **Design (`design-docs/specs/design-unified-workflow-role-model.md`)**: Workflow invocation bullet documents `workflow-calls/<call-id>.json` caller/callee fields (protected `architecture.md` / `design-step-run-history-rerun.md` unchanged).
- **Tests (`src/workflow/engine.test.ts`)**: Cross-workflow integration test asserted artifact path content for canonical and legacy key parity (superseded 2026-04-28: tests now expect mirrors absent on new writes).

**Tasks In Progress**:
- Module 2: validator `root-manager` / single-manager graph inference; optional `conversationTurns` / session-string review; optional rename of `runtimeVariables.workflowCall` serialized keys (would require callee prompt/template migration if pursued).
- Modules 3–4: GraphQL/inspect `workflowCall*` read-model wording, examples and fixture retirement.

**Blockers**: None.

**Notes / verification commands**:
- `bun run typecheck:server` (pass)
- `bun test src/workflow/engine.test.ts --runInBand` (`96` pass)
- `bun test --runInBand` (full suite pass)

### Session: 2026-04-29 (module 3: remove inspection structural projection compatibility counts)

**Tasks Completed**:
- `src/workflow/inspect.ts`: removed `WorkflowStructuralProjectionCounts` and the leftover `counts.nodes` / `counts.edges` / `counts.loops` / `counts.structuralProjection` compatibility fields from inspection summaries.
- `src/cli.ts`, `src/server/graphql-executable-schema.ts`, `src/lib.ts`: CLI inspect output, GraphQL workflow counts, and library exports now expose only the step-addressed count surface (`steps`, `nodeRegistry`, `crossWorkflowDispatches`).
- `src/cli.test.ts`, `src/graphql/schema.test.ts`, `src/lib.test.ts`, `src/server/graphql.test.ts`: updated regression coverage to assert the simplified inspection contract.

**Tasks In Progress**:
- Module 3 broader cleanup still remains for other public/runtime naming carryover tracked in this plan (`managerRuntimeId`, mailbox metadata labels, legacy source labeling).

**Blockers**: None.

**Notes / verification commands**:
- `bun test src/cli.test.ts src/graphql/schema.test.ts src/lib.test.ts src/server/graphql.test.ts --runInBand`
- `bun run typecheck:server`
