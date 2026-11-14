# Workflow Role Unification Structural Cleanup Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-unified-workflow-role-model.md
**Created**: 2026-04-05
**Last Updated**: 2026-04-20

## Design Document Reference

**Source**: `design-docs/specs/design-unified-workflow-role-model.md`

### Summary

The repository has already landed the transitional role-unification slice: role-authored `manager` / `worker` bundles, worker-only execution, authored-minimal persistence, and cross-workflow dispatch via step transitions (authored top-level `workflowCalls` are legacy-rejected in current validation).

What remains is structural cleanup. Legacy `subWorkflows`, `subworkflow-manager`, `input`, and `output` execution semantics still exist as compatibility behavior in runtime control, mailbox structure summaries, examples, and regression fixtures. This follow-up plan removes those remaining structural assumptions from the active role-authored path while keeping any intentional legacy compatibility boundary explicit and narrow.

### Scope

**Included**:

- remove structural child-input forwarding from the role-authored execution path
- constrain role-authored manager control and mailbox guidance to the current workflow execution plus step-addressed cross-workflow transitions (`toWorkflowId` / `resumeStepId`; authored top-level `workflowCalls` rejected)
- reduce role-authored prompt, inspection, and example surfaces that still advertise structural sub-workflow boundaries
- replace structural example/test coverage where the same behavior can now be exercised through role-authored workflows and step-addressed cross-workflow transitions
- document the exact legacy compatibility boundary that remains after cleanup

**Excluded**:

- deleting load-time compatibility for legacy `kind`-authored bundles unless a later design explicitly removes it
- adapter/backend redesign
- unrelated UI styling or prompt-quality work

## Modules

### 1. Runtime Scope Cleanup

#### `src/workflow/engine.ts`, `src/workflow/manager-control.ts`, `src/workflow/node-execution-mailbox.ts`, `src/workflow/prompt-composition.ts`

**Status**: COMPLETED

```typescript
export type ManagerControlActionType =
  | "retry-node"
  | "replay-communication"
  | "execute-optional-node"
  | "skip-optional-node";
```

**Checklist**:

- [x] Remove subworkflow-manager child-input forwarding semantics from role-authored workflow execution
- [x] Ensure role-authored managers never need `start-sub-workflow` or `deliver-to-child-input`
- [x] Keep workflow-call result delivery as the only cross-workflow runtime handoff for role-authored bundles
- [x] Add targeted engine, mailbox, and prompt-composition coverage for the narrowed role-authored scope

### 2. Compatibility Boundary Narrowing

#### `src/workflow/types.ts`, `src/workflow/load.ts`, `src/workflow/inspect.ts`, `src/workflow/runtime-readiness.ts`

**Status**: COMPLETED

```typescript
export interface WorkflowInspectionSummary {
  readonly workflowId: string;
  readonly hasManagerNode: boolean;
  readonly entryStepId?: string;
  readonly crossWorkflowDispatchIds: readonly string[];
}
```

**Checklist**:

- [x] Keep structural `kind`/`subWorkflows` compatibility limited to explicitly legacy-authored bundles
- [x] Stop role-authored inspection and rendering helpers from falling back to structural boundary vocabulary where it is no longer needed
- [x] Document any remaining compatibility-only normalization rules in code comments and inspection output

### 3. Examples, Docs, and Test Migration

#### `examples/**/*`, `README.md`, `design-docs/specs/*.md`, `src/**/*.test.ts`

**Status**: COMPLETED

```typescript
interface RoleCleanupExampleSet {
  readonly managedParentWorkflowId: string;
  readonly workerOnlyCalleeWorkflowId: string;
  readonly legacyCompatibilityExamples: readonly string[];
}
```

**Checklist**:

- [x] Replace structural sub-workflow examples as the primary reference path with workflow-call-oriented examples
- [x] Convert tests that still rely on structural sub-workflow fixtures when equivalent role-authored fixtures now exist
- [x] Keep only a minimal, explicitly-labeled compatibility regression slice for intentional legacy behavior
- [x] Update architecture/workflow docs so the remaining legacy boundary is described accurately and narrowly

### 4. Verification and Closeout

#### `src/workflow/*.test.ts`, `src/cli.test.ts`, `src/graphql/schema.test.ts`, `src/server/graphql.test.ts`, `src/tui/opentui-screen.test.ts`

**Status**: COMPLETED

```typescript
interface VerificationCommandSet {
  readonly typecheck: "bun run typecheck:server";
  readonly targetedTests: "bun test <targeted-files> --runInBand";
  readonly unitTests: "bun test";
  readonly build: "bun run build";
}
```

**Checklist**:

- [x] Re-run the targeted runtime/prompt/save/inspection regression slice after each cleanup increment
- [x] Re-run full `bun test`
- [x] Re-run `bun run build`
- [x] Reconcile `impl-plans/PROGRESS.json` and `impl-plans/README.md` when the cleanup completes

## Module Status

| Module                             | File Path                                                                                                                                   | Status    | Tests                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Runtime scope cleanup              | `src/workflow/engine.ts`, `src/workflow/manager-control.ts`, `src/workflow/node-execution-mailbox.ts`, `src/workflow/prompt-composition.ts` | COMPLETED | `bun test src/workflow/engine.test.ts src/workflow/manager-control.test.ts src/workflow/prompt-composition.test.ts --runInBand`    |
| Compatibility boundary narrowing   | `src/workflow/types.ts`, `src/workflow/load.ts`, `src/workflow/inspect.ts`, `src/workflow/runtime-readiness.ts`                             | COMPLETED | `bun test src/workflow/load.test.ts src/workflow/runtime-readiness.test.ts src/graphql/schema.test.ts src/cli.test.ts --runInBand` |
| Examples, docs, and test migration | `examples/**/*`, `README.md`, `design-docs/specs/*.md`, `src/**/*.test.ts`                                                                  | COMPLETED | targeted example, CLI, GraphQL, and TUI regression slices                                                                          |
| Verification and closeout          | repository-wide                                                                                                                             | COMPLETED | `bun run typecheck:server`, `bun test`, `bun run build`                                                                            |

## Dependencies

| Feature                            | Depends On                                              | Status    |
| ---------------------------------- | ------------------------------------------------------- | --------- |
| Runtime scope cleanup              | Completed transitional role-unification slice           | COMPLETED |
| Compatibility boundary narrowing   | Runtime scope cleanup                                   | COMPLETED |
| Examples, docs, and test migration | Runtime scope cleanup, compatibility boundary narrowing | COMPLETED |
| Verification and closeout          | Runtime cleanup and migration updates                   | COMPLETED |

## Completion Criteria

- [x] Role-authored workflows no longer depend on structural sub-workflow manager/input/output runtime behavior
- [x] Role-authored manager guidance is scoped to the current workflow execution plus step-addressed cross-workflow transitions (`toWorkflowId` / `resumeStepId`; authored top-level `workflowCalls` rejected)
- [x] Structural sub-workflow examples/tests are no longer the primary coverage path for the active architecture
- [x] Remaining legacy compatibility behavior is explicit, narrow, and documented
- [x] `bun run typecheck:server`, `bun test`, and `bun run build` pass after the cleanup

## Progress Log

### Session: 2026-04-20 17:42 JST

**Tasks Completed**: TASK-001, TASK-003, TASK-004, final plan closeout
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Closed the remaining active-role cleanup by rejecting structural boundary node kinds `subworkflow-manager`, `input`, and `output` when they are combined with authored `role` / `control` nodes. Removed inactive `Sub-workflows: none declared` mailbox rendering from role/root manager prompts, kept structural control actions available only for explicit legacy compatibility bundles, and documented the narrowed boundary in README, architecture, and workflow JSON docs. Verification passed with the targeted role-cleanup suite (`bun test src/workflow/save.test.ts src/workflow/engine.test.ts src/workflow/load.test.ts src/workflow/validate.test.ts src/workflow/manager-control.test.ts src/workflow/prompt-composition.test.ts src/workflow/runtime-readiness.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/tui/opentui-screen.test.ts`), full `bun test`, and `bun run build`.

### Session: 2026-04-20 17:35 JST

**Tasks Completed**: Continued TASK-003, removed empty structural `subWorkflows` authoring from raw loader, CLI, and direct call-node fixtures that were not testing legacy behavior
**Tasks In Progress**: TASK-001, TASK-003
**Blockers**: Structural runtime execution semantics and their dedicated regression tests still remain for explicitly legacy `subWorkflows` / `subWorkflowConversations`
**Notes**: Updated raw workflow fixtures in `src/workflow/load.test.ts`, `src/cli.test.ts`, and `src/workflow/call-node.test.ts` to rely on omitted `subWorkflows` normalization instead of authoring empty compatibility fields. This narrows active-path test authoring without changing normalized runtime fixtures that still require the structural field. Verified with `bun test src/workflow/load.test.ts src/workflow/call-node.test.ts`, `bun test src/cli.test.ts -t "call-node|events emit dispatches locally|inspect reports worker-only|local call-node"`, and `bun run typecheck`.

### Session: 2026-04-20 17:23 JST

**Tasks Completed**: Continued TASK-003, added an automated example-boundary regression for migrated role-authored examples
**Tasks In Progress**: TASK-001, TASK-003
**Blockers**: Structural runtime execution semantics and their dedicated regression tests still remain for explicitly legacy `subWorkflows` / `subWorkflowConversations`
**Notes**: Added `loadWorkflowFromDisk` coverage that asserts every primary example bundle stays off authored `subWorkflows` / `subWorkflowConversations`, while `codex-codex-euthanasia-debate` remains the single explicit structural compatibility example. This turns the docs/example migration expectation into a regression guard without weakening the intentional legacy runtime tests. Verified with `bun test src/workflow/load.test.ts -t "workflow-call examples|structural sub-workflow authoring"` and `bun run typecheck`.

### Session: 2026-04-20 17:16 JST

**Tasks Completed**: TASK-002, node add-on validation hardening that was blocking the mixed role/add-on validation slice
**Tasks In Progress**: TASK-001, TASK-003
**Blockers**: Structural runtime execution semantics for explicitly legacy `subWorkflows` / `subWorkflowConversations` still remain, so the cleanup plan is not complete
**Notes**: Verified that the current compatibility boundary rejects role-authored bundles that also author non-empty structural `subWorkflows` or `subWorkflowConversations`, and checked off the remaining boundary-narrowing criterion. Added regression coverage for chat reply add-on normalization, non-object config rejection, and unknown built-in add-on rejection, with a small resolver typing hardening so strict TypeScript keeps add-on config as `Readonly<Record<string, unknown>>`. Advanced TASK-003 by documenting that `subworkflow-chained-simple` is a historical-name grouped-lane example and not the structural compatibility reference; `workflow-call-simple` remains the primary cross-workflow example and `codex-codex-euthanasia-debate` remains the explicit legacy structural example. Re-ran `bun test src/workflow/validate.test.ts src/workflow/native-node-executor.test.ts src/workflow/save.test.ts`, `bun run typecheck`, `bun test src/cli.test.ts src/events/*.test.ts src/events/adapters/*.test.ts`, and `bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events --output json`.

### Session: 2026-04-05 20:38 JST

**Tasks Completed**: Continued diff review, renamed the remaining active inspection/control-plane structural count from `subWorkflows` to `legacySubWorkflows` so CLI JSON/text output and GraphQL inspection no longer present legacy structural boundaries as a peer concept to authored `workflowCalls`
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: Structural runtime execution semantics for explicitly legacy `subWorkflows` / `subWorkflowConversations` still remain, so this iteration narrowed inspection vocabulary only and did not remove the compatibility runtime itself
**Notes**: Re-checked the current architecture/design against the intended role-authored purpose before editing and it still matches: manager/worker authoring plus explicit `workflowCalls` is the active path, while structural sub-workflow behavior remains legacy compatibility. The concrete mismatch found in this review was a remaining control-plane naming leak rather than a runtime bug: CLI and TUI already labeled the structural count as `legacySubWorkflows`, but `WorkflowInspectionSummary` and the GraphQL executable schema still exposed plain `subWorkflows`, which made the legacy path look first-class on inspection surfaces. This pass aligned those inspection contracts, updated README/command design notes, and verified with `bun test src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts --runInBand` plus `bun run typecheck:server`.

### Session: 2026-04-05 23:40 JST

**Tasks Completed**: Continued diff review, narrowed TUI workflow-history rendering so role-authored inspection surfaces no longer present structural sub-workflow counts as an unlabeled primary concept
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: Structural runtime execution semantics for explicitly legacy `subWorkflows` / `subWorkflowConversations` still remain, so this iteration only tightened presentation and inspection wording rather than removing the compatibility path itself
**Notes**: Re-checked the architecture/design target before editing and it still matches the intended purpose: `manager` / `worker` authoring plus explicit `workflowCalls` is the active path, while structural sub-workflow state remains legacy compatibility. This pass fixed a remaining presentation mismatch in the OpenTUI history header, which still showed raw `subworkflows=` wording even for the role-authored direction. The header now foregrounds `workflowCalls` and labels the structural count as `legacySubWorkflows`, with focused verification via `bun test src/tui/opentui-screen.test.ts --runInBand` and `bun run typecheck:server`.

### Session: 2026-04-05 20:25 JST

**Tasks Completed**: Continuation review, workflow-call readiness hardening for unsupported recursive target graphs, design note update for the runtime contract
**Tasks In Progress**: TASK-001, TASK-003
**Blockers**: Structural runtime execution semantics for explicitly legacy `subWorkflows` / `subWorkflowConversations` still remain, so this pass tightened the active workflow-call path rather than closing the structural cleanup tasks
**Notes**: Re-checked the current architecture against the intended role-authored target before editing and it still matches: explicit `workflowCalls` are the active cross-workflow path, while structural sub-workflow behavior remains compatibility-only. The concrete gap found in the current implementation was earlier failure behavior rather than architecture drift: execution already rejected recursive workflow-call chains, but runtime readiness only verified that targets loaded. This pass moved that unsupported-case detection into readiness so recursive graphs fail before execution starts, and updated the role-model design doc to record that limitation explicitly.

### Session: 2026-04-05 20:33 JST

**Tasks Completed**: Continuation review, narrowed validator boundary so role-authored bundles now reject non-empty structural `subWorkflowConversations` the same way they already reject structural `subWorkflows`
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: Structural runtime execution semantics for explicitly legacy `subWorkflows` / `subWorkflowConversations` still remain, so this iteration only tightened the authored compatibility boundary rather than removing the compatibility path itself
**Notes**: The architecture/design target still matches the intended purpose, so no new design rewrite was needed. The concrete mismatch found in this review was validator asymmetry: role-authored bundles already rejected non-empty `subWorkflows`, but could still author structural `subWorkflowConversations`, which weakened the “legacy compatibility only” boundary described by the active cleanup plan. This pass aligned the validator and docs, added focused regression coverage in `src/workflow/validate.test.ts`, and re-ran the targeted role-cleanup regression slice.

### Session: 2026-04-05 20:21 JST

**Tasks Completed**: Continued diff review, narrowed README/architecture wording so the design record matches the implemented optional-node control flow and legacy structural conversation boundary
**Tasks In Progress**: TASK-001, TASK-003
**Blockers**: Runtime compatibility behavior for explicitly legacy `subWorkflows` / `subWorkflowConversations` still remains, so this iteration only tightened the recorded architecture instead of closing the structural cleanup tasks
**Notes**: Re-checked the branch against the intended role-authored target before editing and the target still holds: `manager` / `worker` authoring plus explicit `workflowCalls` is the active path, while structural sub-workflow execution remains compatibility-only. The concrete mismatch found in this review was documentation drift rather than runtime behavior: README and `architecture.md` still described optional-node decisions as future work and did not list the implemented `execute-optional-node` / `skip-optional-node` manager-control actions. This pass corrected those high-level docs and labeled `subWorkflowConversations[]` more explicitly as legacy structural compatibility. The active targeted regression slice still passed: `bun test src/workflow/engine.test.ts src/workflow/manager-control.test.ts src/workflow/load.test.ts src/workflow/runtime-readiness.test.ts src/workflow/prompt-composition.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/tui/opentui-screen.test.ts --runInBand`.

### Session: 2026-04-05 23:24 JST

**Tasks Completed**: Continuation review, full verification rerun against the in-progress role-unification cleanup branch
**Tasks In Progress**: TASK-001, TASK-003
**Blockers**: Structural runtime execution semantics for explicitly legacy `subWorkflows` / `subWorkflowConversations` still remain, so the cleanup plan is not complete even though the current branch is stable
**Notes**: Re-reviewed the current architecture and design against the intended role-authored target before making any further changes. The existing design still matches the intended purpose: manager/worker authoring plus explicit `workflowCalls` is the active path, while structural sub-workflow behavior is now clearly a legacy compatibility layer. No additional design rewrite was needed in this iteration. Verification stayed green across the touched surfaces and the broader repository slice: `bun test src/workflow/save.test.ts src/workflow/engine.test.ts src/workflow/load.test.ts src/workflow/validate.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/cli.test.ts src/tui/opentui-screen.test.ts --runInBand`, `bun run typecheck:server`, `bun run build`, and full `bun test` all passed. The next concrete implementation work remains the same structural compatibility removal already tracked by TASK-001 and TASK-002 rather than a new architecture correction.

### Session: 2026-04-05 20:13 JST

**Tasks Completed**: Tightened TUI and doc surfaces so role-authored workflows foreground explicit `workflowCalls` while structural sub-workflows stay explicitly labeled as legacy compatibility
**Tasks In Progress**: TASK-003
**Blockers**: Structural runtime behavior for legacy `subWorkflows` and `subWorkflowConversations` still exists, so docs/tests can narrow the active surface but cannot yet remove every structural artifact
**Notes**: Re-checked the current architecture against the intended role-authored design before editing and it still matches the transitional target: active workflows are manager/worker bundles plus explicit `workflowCalls`, while structural sub-workflow behavior remains compatibility-only. This pass updated README/runtime architecture wording to reflect entry-node startup plus workflow-call execution, and extended the OpenTUI previews/tests so workflow-call ids are visible as first-class runtime information instead of only showing legacy boundary counts.

### Session: 2026-04-05 20:03 JST

**Tasks Completed**: Added explicit compatibility notes/flags to workflow inspection summaries and surfaced them through CLI/GraphQL inspection output
**Tasks In Progress**: TASK-001, TASK-002
**Blockers**: Structural runtime execution semantics still remain for explicitly legacy-authored `subWorkflows`, so the broader cleanup is not complete yet
**Notes**: Diff review and the targeted regression slice stayed green, so this pass focused on making the remaining compatibility boundary visible in code rather than only in prose docs. `buildInspectionSummary` now reports when role-authored nodes are still normalized to structural runtime kinds, when worker-only workflows rely on the internal effective manager/entry alias, and when a bundle still uses legacy structural `subWorkflows`. CLI and GraphQL inspection coverage were extended so these compatibility notes remain stable as the cleanup continues.

### Session: 2026-04-05 21:27 JST

**Tasks Completed**: Tightened authored compatibility boundary for role-based inspection surfaces, added validator guard against mixing role-authored nodes with non-empty structural `subWorkflows`
**Tasks In Progress**: TASK-001
**Blockers**: Structural runtime execution semantics for legacy `subworkflow-manager` and child-input forwarding still remain in the compatibility path, so TASK-001 is not closed yet
**Notes**: The current design and implementation still align at the high level: the active architecture is role-authored manager/worker workflows plus explicit `workflowCalls`, while structural `subWorkflows` remain compatibility only. This pass narrowed that boundary in practice by rejecting mixed authored bundles that tried to combine role/control authoring with non-empty structural `subWorkflows`, and by reducing CLI/TUI workflow inspection wording that previously foregrounded `subWorkflows` for role-authored workflows where that legacy path is inactive.

### Session: 2026-04-05 20:32 JST

**Tasks Completed**: Narrowed default role-manager system guidance, documented compatibility boundary more explicitly
**Tasks In Progress**: TASK-001
**Blockers**: Structural sub-workflow execution semantics still remain in runtime control, legacy grouped examples, and inspection/presentation helpers outside the prompt-composition path
**Notes**: The active regression slice still passed cleanly after review, but the shared default manager system prompt was still teaching role-authored workflows in structural sub-workflow terms. This iteration split the default manager system guidance so compatibility bundles that still author `subWorkflows[]` keep the structural prompt while manager/worker workflows without structural boundaries receive current-workflow plus explicit-`workflowCalls` guidance. README and architecture notes were tightened in the same pass so the documented active path matches the narrowed prompt behavior.

### Session: 2026-04-05 19:43 JST

**Tasks Completed**: Successor-plan creation, active-plan split, continuation review
**Tasks In Progress**: TASK-001
**Blockers**: Structural sub-workflow execution semantics still remain in manager-control enforcement, mailbox structure summaries, examples, and legacy regression fixtures
**Notes**: Re-checked the current git diff and the checked-in role-unification design before creating this successor plan. The design still matches the intended transitional architecture, and the active regression slice (`bun run typecheck:server` plus `bun test src/workflow/engine.test.ts src/workflow/save.test.ts src/workflow/load.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/workflow/manager-control.test.ts src/workflow/input-assembly.test.ts src/workflow/prompt-composition.test.ts src/workflow/runtime-readiness.test.ts --runInBand`) passed cleanly. The remaining work is now focused enough to split: this follow-up plan tracks only the structural compatibility cleanup that still blocks full completion of the unified-role target model.

### Session: 2026-04-05 22:18 JST

**Tasks Completed**: Continued role-authored example/doc cleanup so active reference bundles no longer teach structural sub-workflow vocabulary by default
**Tasks In Progress**: TASK-001, TASK-003
**Blockers**: Runtime compatibility behavior for legacy structural `subWorkflows` and `subWorkflowConversations` still exists, so example/test cleanup can only narrow the active reference surface rather than remove every structural artifact yet
**Notes**: The architecture still matches the intended role-authored direction, so this pass refined documentation rather than changing the design target. Role-authored example prompts now describe grouped lanes/stages or explicit `workflowCalls`, the arithmetic example no longer ships a `subworkflow-manager.md` prompt asset, and the main/example docs now label `codex-codex-euthanasia-debate` as an explicit legacy compatibility bundle instead of a peer recommendation.

## Related Plans

- **Previous**: `impl-plans/workflow-role-unification.md`
- **Next**: None
- **Depends On**: `impl-plans/workflow-role-unification.md`
