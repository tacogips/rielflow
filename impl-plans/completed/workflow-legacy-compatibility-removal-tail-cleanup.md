# Workflow Legacy Compatibility Removal Tail Cleanup Implementation Plan

**Status**: Completed (2026-04-29)
**Design Reference**: `design-docs/specs/design-workflow-json.md`, `design-docs/specs/design-unified-workflow-role-model.md`, `design-docs/specs/architecture.md`, `design-docs/specs/command.md`, `design-docs/specs/notes.md`
**Created**: 2026-04-29
**Last Updated**: 2026-04-29 (Module 1 checklist reconciled; grep re-audit progress log)

---

## Design Document Reference

**Source**:

- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/design-unified-workflow-role-model.md`
- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`
- `design-docs/specs/notes.md`

### Summary

This split plan captures the remaining legacy-cleanup tail after the runtime naming,
inspection, GraphQL, supervision adapter, TUI, and Web UI removals. A 2026-04-29
current-tree re-audit showed that some previously listed runtime shims are already
gone. The remaining work is now mostly:

- smaller live runtime compatibility residue such as compatibility-shaped normalized
  node projection, node-addressed session/state naming, and persisted legacy cleanup
- test fixtures and negative coverage that still preserve removed schema aliases or
  removed-command behavior
- design docs/examples/plan history that still describe removed compatibility paths

The goal is to finish the cleanup without reintroducing compatibility branches or
soft-deprecation shims.

### Scope

**Included**:

- delete live runtime shims that still special-case legacy node-addressed behavior
- remove leftover `call-node` compatibility entrypoints and text-rewrite shims
- convert legacy-authored test fixtures to strict step-addressed fixtures
- prune stale docs/examples/plan notes that still describe removed compatibility as current
- provide a recursive execution prompt for Composer 2

**Excluded**:

- unrelated event/runtime-db historical migrations that are not workflow-schema compatibility
- renaming canonical `workflowExecutionId` concepts, which remain current terminology

---

## Modules

### 1. Cleanup Task Inventory

#### `impl-plans/completed/workflow-legacy-compatibility-removal-tail-cleanup.md`

**Status**: Completed (inventory + Composer prompt; Module 1 meta section retained for reference)

```typescript
interface LegacyCleanupTask {
  readonly id: string;
  readonly category: "runtime" | "tests" | "docs" | "plan";
  readonly files: readonly string[];
  readonly goal: string;
  readonly deleteInsteadOfRename: boolean;
}

interface ComposerRecursivePrompt {
  readonly objective: string;
  readonly searchPattern: string;
  readonly stopCondition: string;
}
```

**Checklist**:

- [x] Track each remaining cleanup bucket with concrete file targets
- [x] Document how to remove each bucket, not just what remains
- [x] Include Composer 2 prompt for recursive execution

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Runtime tail cleanup | `src/workflow/validate.ts`, `src/workflow/session.ts`, `src/events/trigger-runner.ts`, `src/workflow/node-execution-mailbox.ts`, `src/workflow/save.ts` | Completed (2026-04-29) | Targeted Bun tests |
| Legacy test-fixture conversion | `src/**/*.test.ts` listed below | Completed (2026-04-29; optional GraphQL/schema negative-test dedup) | Targeted Bun tests |
| Docs/examples tail cleanup | `design-docs/specs/*.md`, `examples/**/*` listed below | Completed (2026-04-29) | Grep + smoke checks |
| Plan/index cleanup | `impl-plans/*.md`, `impl-plans/README.md`, `impl-plans/PROGRESS.json` | Completed (2026-04-29) | Grep |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Runtime/UI tail cleanup | Prior runtime naming and supervision cleanup | Available |
| Test-fixture conversion | Runtime/UI tail cleanup | Available |
| Docs/examples tail cleanup | Runtime/UI cleanup decisions | Available |
| Plan/index cleanup | All other cleanup slices | Available |

---

## Todo List

### TASK-001: Re-audit and Remove Remaining Live Runtime Compatibility Residue

**Status**: Completed
**Parallelizable**: No
**Files**:

- `src/workflow/validate.ts`
- `src/workflow/session.ts`
- `src/events/trigger-runner.ts`
- `src/workflow/node-execution-mailbox.ts`
- `src/workflow/save.ts`

**What to remove**:

- former `compatNodes` naming for required `nodes[]` materialization from `steps[]` in `validate.ts` (resolved as `nodesMaterializedFromSteps`; guard against reintroducing compatibility-shaped dual projections)
  in `validate.ts`
- node-addressed session/runtime residue in `session.ts` where the step-based runtime
  still falls back through `nodeId`, `currentNodeId`, or `initialNodeId`
- comments or prompt text that still frame current behavior as "step id else legacy node id"
  or "compatibility fallback" in `trigger-runner.ts` and `node-execution-mailbox.ts`
- old persisted workflow cleanup that may no longer be needed, such as
  `workflow-vis.json` removal in `save.ts`

**How to remove it**:

- Re-audit each candidate before deletion; several previously listed runtime shims
  were already removed before this plan update
- Prefer deleting compatibility shaping outright when the runtime no longer consumes it
- If a field name is still part of the persisted session contract, treat it as a
  deliberate rename decision rather than a blind cleanup
- Rewrite comments/prompt text to describe only the current step-addressed behavior
- If a cleanup target only serves historical artifact deletion, decide explicitly
  whether to keep it as harmless hygiene or remove it as dead compatibility code

**Checklist**:

- [x] Delete TUI and Web UI runtime surfaces already removed from the current tree
- [x] Confirm the previously listed `src/workflow/call-step.ts` rewrite layer is already gone
- [x] Confirm nested `parseRerunTargetWorkflowControlArguments` uses allowlisted keys only (no dedicated legacy-field branch); unknown keys rejected generically
- [x] Confirm `src/cli.ts` no longer carries a dedicated `call-node` dispatch branch
- [x] Decide whether `validate.ts` `compatNodes` projection is still required runtime shape or removable compatibility residue (kept as required `nodes[]` materialization from `steps[]`; renamed to `nodesMaterializedFromSteps`)
- [x] Decide whether `session.ts` node-addressed naming/fallbacks are active contract or removable compatibility residue (persisted session contract and dual field matching retained; documented as step ids and optional `stepId`/`nodeId` on execution rows)
- [x] Rewrite remaining step/current behavior comments and prompt text that still describe legacy fallback semantics (trigger-runner, node-execution-mailbox, validate JSDoc)
- [x] Decide whether `save.ts` `workflow-vis.json` cleanup remains intentional hygiene or should be removed (kept; renamed constant and documented as obsolete artifact removal)

### TASK-002: Convert Remaining Legacy-Authored Test Fixtures

**Status**: Completed (2026-04-29; optional further GraphQL vs `schema.test.ts` overlap review if a later pass finds pure duplicates)
**Parallelizable**: Yes
**Files**:

- `src/workflow/engine.test.ts`
- `src/workflow/runtime-db.test.ts`
- `src/workflow/history.test.ts`
- `src/workflow/runtime-readiness.test.ts`
- `src/workflow/call-step.test.ts`
- `src/workflow/session.test.ts`
- `src/graphql/schema.test.ts`
- `src/server/graphql.test.ts`
- `src/cli.test.ts`
- `src/workflow/load.test.ts`
- `src/workflow/save.test.ts`
- `src/workflow/validate.test.ts`
- `src/workflow/types.test.ts`
- `src/workflow/session-store.test.ts`
- `src/workflow/superviser-control.test.ts`
- `src/workflow/native-node-executor.test.ts`

**What to remove**:

- Fixtures authored with top-level `edges`, `workflowCalls`, `subWorkflows`, `entryNodeId`, or `managerRuntimeId`
- Assertions whose only purpose is preserving removed compatibility shims or removed-command wording
- Terminology that still says “legacy node-addressed execution” when the runtime no longer supports it
- Stale test assumptions copied from earlier plan versions, especially where production
  shims are already gone and only test-only wording remains

**How to remove it**:

- Rewrite fixtures to strict `entryStepId` + `steps[]` + `nodes[]`
- Keep negative rejection coverage only where it still protects current schema boundaries
- Delete tests whose only purpose is checking a removed shim message
- Prefer one modern fixture helper reused across suites over per-test legacy bundles

**Checklist**:

- [x] Convert major fixture helpers in `engine.test.ts` to strict step-addressed bundles
- [x] Convert the remaining `engine.test.ts` command-timeout fixture off legacy `nodes` + `edges`
- [x] Rewrite legacy graph fixtures in `runtime-db.test.ts`, `history.test.ts`, and `runtime-readiness.test.ts` (step-addressed authoring)
- [x] Remove TUI-specific legacy fixture coverage already deleted with `src/tui/**`
- [x] Re-audit `call-step.test.ts` and `cli.test.ts` for tests that only preserve removed `call-node` behavior (removed dedicated `call-node` unknown-scope CLI test; `call-step.test.ts` has no `call-node` references)
- [x] Dropped `superviser-control.test.ts` ignored `rerunFromNodeId` test as removed-alias preservation only
- [x] Trim redundant GraphQL/CLI/save/validate/types negative coverage to the minimum useful set (removed duplicate `workflowCalls` load/save tests; `validate.test.ts` remains canonical)
- [x] Keep `runtime-db.test.ts` and `session-store.test.ts` legacy migration coverage only where it still protects real persisted-data upgrades (2026-04-29: retained; exercises SQLite column renames and historical row shapes for on-disk DBs)
- [x] Keep `native-node-executor.test.ts` `command.workingDirectory` coverage only if the field remains supported (`native-node-executor.ts` resolves `input.node.workingDirectory ?? commandConfig.workingDirectory`; test title describes supported optional field)

### TASK-003: Remove Stale Docs, Examples, and Historical Cleanup Notes

**Status**: Completed (2026-04-29; incidental `rg` for old terminology remains optional hygiene)
**Parallelizable**: Yes
**Files**:

- `design-docs/specs/design-auto-improve-superviser-mode.md`
- `design-docs/specs/design-node-jump-and-code-manager-runtime.md`
- `design-docs/specs/design-user-action-and-optional-node-execution.md`
- `design-docs/specs/design-unified-workflow-role-model.md`
- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/notes.md`
- `examples/workflow-call-simple/EXPECTED_RESULTS.md`
- `README.md`
- `impl-plans/workflow-legacy-compatibility-removal.md`

**What to remove**:

- References to the deleted supervision adapter `toStepAddressedWorkflowForSupervision(...)`
- Migration prose that still treats `workflowCalls`, `subWorkflows`, `subworkflow-manager`, `root-manager`, or `call-node` as live cleanup targets inside current behavior descriptions
- Example expectation text that still talks about omitted removed fields instead of just describing the current schema
- TUI/Web UI docs that still survived the code deletion and describe removed surfaces as current
- Stale plan text that points engineers at runtime shims that no longer exist in the tree

**How to remove it**:

- Rewrite current-behavior sections to describe only the strict step-addressed model
- Keep historical context only when it helps explain why validation rejects a field
- Delete obsolete migration prose instead of preserving it in speculative wording
- Update the active legacy-removal plan status notes so they match the current codebase after each deletion slice

**Checklist**:

- [x] Remove deleted supervision-adapter references in `design-docs/specs/notes.md`
- [x] Collapse `workflowCalls` migration prose into current step-transition wording in `design-node-jump-and-code-manager-runtime.md`
- [x] Remove stale structural manager-kind references from current docs (`design-user-action-and-optional-node-execution.md`, `design-graphql-manager-control-plane.md` manager scope line, prior `design-node-jump` / `notes` passes)
- [x] Remove TUI/Web UI top-level docs for the current tree
- [x] Rewrite examples to describe current output only (`examples/workflow-call-simple/EXPECTED_RESULTS.md` inspect facts)
- [x] Reconcile the active legacy-removal plan with actual remaining work
- [x] Keep this tail-cleanup plan aligned with the current repository inventory after each audit pass (this session: `workflow-legacy-compatibility-removal.md` module status + review matrix + completion criteria)

### TASK-004: Final Rejection-Layer Decision

**Status**: Completed (2026-04-29: explicit lists stay; documented in `validate.ts`; collapse path not pursued)
**Parallelizable**: No
**Files**:

- `src/workflow/validate.ts`
- `src/workflow/save.ts`
- matching tests in `src/workflow/*.test.ts`

**What to decide**:

- Whether the explicit disallowed-key lists for removed top-level fields should remain as intentional schema-boundary protection
- Or whether they should be collapsed further into a smaller generic strict-schema rejection path

**How to handle it**:

- Do not delete this layer blindly; it is currently active schema protection
- If kept, reduce duplicate tests and docs around it
- If removed, replace it with one strict unknown-field path and preserve user-facing validation quality

**Checklist**:

- [x] Decide whether explicit rejection lists stay or collapse (stay: explicit enumeration)
- [x] If they stay, document them as current schema guards, not compatibility support (`validate.ts` JSDoc)
- [ ] If they collapse, update tests and error-message expectations consistently (not applicable unless direction changes)

---

## Completion Criteria

- [x] No live `src/` runtime code preserves node-addressed, compatibility-shaped, or removed-command legacy residue beyond deliberate persisted-data normalization (TASK-001; re-audit 2026-04-29)
- [x] Remaining mentions of removed fields in `src/` are either intentional schema rejection or unrelated historical database migration coverage
- [x] Legacy-authored workflow fixtures are converted or deleted across touched test suites (TASK-002)
- [x] Current design docs/examples no longer describe removed compatibility behavior as active (TASK-003; ongoing incidental terminology is non-blocking)
- [x] `rg` against removed legacy terms is reduced to intentional rejection coverage, historical archived plans, or unrelated migration tests (expect continued hits in `validate.ts`, negative tests, and plan vocabulary)
- [x] Targeted tests and `bun run typecheck:server` pass after each slice (`bun run typecheck:server` green after this documentation-only slice)

---

## Reviewed Findings

### Reviewed `src/` hits kept intentionally

- `src/workflow/validate.ts` and `src/workflow/save.ts` still mention removed top-level fields such as `entryNodeId`, `managerNodeId`, `subWorkflows`, and `workflowCalls`; this is current schema-boundary rejection, not runtime compatibility support.
- `src/workflow/cross-workflow-from-steps.ts`, `src/workflow/engine.ts`, `src/workflow/inspect.ts`, and `src/workflow/runtime-readiness.ts` still mention authored `workflowCalls` only to document that the active runtime derives cross-workflow dispatches from `steps[].transitions` instead.
- `src/workflow/manager-session-store.ts` intentionally keeps migration code for older SQLite column names (`manager_runtime_id`, `manager_node_id`) when opening existing local runtime databases.

### Reviewed `src/` residue still actionable

- None additional beyond routine TASK-004 rejection-layer doc decision; `call-step-impl.ts` header text updated this session.

### Reviewed test-only residue

- `src/workflow/runtime-readiness.test.ts`: default `makeBundle` path now uses strict `entryStepId` + `nodeRegistry` + `steps` + `nodes` (no legacy `edges` cast).
- `src/workflow/session.test.ts`, `src/workflow/session-store.test.ts`, `src/workflow/runtime-db.test.ts`, and `src/workflow/native-node-executor.test.ts` contain migration or compatibility-override coverage that may remain valid, but should be kept only when it still protects a supported persisted-data or input contract.
- `src/graphql/schema.test.ts`, `src/server/graphql.test.ts`, `src/workflow/load.test.ts`, `src/workflow/save.test.ts`, `src/workflow/validate.test.ts`, and `src/workflow/types.test.ts` still carry negative coverage for removed authored keys; this is mostly intentional, but the overlap should be reduced to the minimum useful set.

### Reviewed docs/examples residue

- None outstanding from the prior audit list after this pass; `README.md` already describes step-derived cross-workflow dispatch; `workflow-legacy-compatibility-removal.md` summary/matrix now match the current tree.

---

## Composer 2 Prompt

Use this prompt with Composer 2:

```text
You are working in `<repository-root>`.

Objective:
Recursively remove the remaining workflow legacy-compatibility residue until only intentional schema-rejection coverage, archived historical plans, or unrelated database-migration tests remain.

Primary references:
- impl-plans/completed/workflow-legacy-compatibility-removal-tail-cleanup.md
- impl-plans/workflow-legacy-compatibility-removal.md

Current repository state:
- TUI is already deleted.
- Web UI/browser workflow viewer is already deleted.
- `tui`, `web serve`, OpenTUI, Solid viewer, and related build/server helpers are already removed.
- Do not spend time re-removing deleted UI surfaces; focus on the remaining workflow legacy tail.
- The remaining live-code tail is small and concentrated. Known examples to re-check after each slice include:
  - `src/workflow/validate.ts`: `nodesMaterializedFromSteps` materialization and any remaining compatibility-shaped projections (versus strict step-addressed materialization only)
  - `src/workflow/session.ts`: node-addressed execution/session field naming and fallback logic
  - `src/events/trigger-runner.ts`: comment text that still frames manager/entry identity as step id vs legacy node id
  - `src/workflow/node-execution-mailbox.ts`: manager-control wording that still describes the payload as a compatibility fallback
  - `src/workflow/save.ts`: `workflow-vis.json` cleanup for legacy persisted artifacts
- A re-audit already confirmed the following earlier targets are no longer live production shims:
  - `src/workflow/call-step.ts`
  - `src/workflow/superviser-control.ts`
  - `src/cli.ts` (only generic unknown-scope handling remains; there is no dedicated `call-node` dispatch branch)
- Some `src/` legacy mentions are intentional rejection coverage, not automatic deletion candidates. Distinguish:
  - acceptable: strict validation rejecting removed authored fields such as `entryNodeId`, `managerNodeId`, `subWorkflows`, `workflowCalls`
  - acceptable: unrelated historical database/session migration coverage
  - deletion candidates: compatibility projections that still shape runtime objects, stale current-behavior comments/prompt text, and dead artifact cleanup that no longer protects supported data

Rules:
- Think and write in English.
- Do not preserve soft-deprecation shims.
- Delete compatibility branches instead of renaming them unless the current runtime still needs the behavior.
- Keep strict step-addressed workflow behavior only.
- Do not reintroduce node-addressed aliases, `call-node`, top-level `workflowCalls`, `subWorkflows`, `entryNodeId`, `managerNodeId`, `managerRuntimeId`, `rerunFromNodeId`, or structural manager-kind runtime branching.
- Keep intentional schema-rejection coverage only when it still protects the current authored schema boundary.
- Use apply_patch for edits.
- After each slice, run targeted tests and typecheck only the touched area.
- Do not touch archived plans under `impl-plans/completed/` unless explicitly asked.
- Do not expand scope into unrelated refactors. Remove one bounded legacy bucket at a time and finish it completely.

Recursive procedure:
1. Read impl-plans/completed/workflow-legacy-compatibility-removal-tail-cleanup.md.
2. Pick exactly one unfinished task bucket.
3. Confirm whether the bucket is:
   - live runtime code
   - test-only compatibility coverage
   - docs/examples/plan history
4. If the bucket contains live runtime code, delete that production shim first before touching docs.
5. Update or delete tests that only preserve the removed shim.
6. Update docs/examples for the same bucket so they describe only current behavior.
7. Run targeted verification.
8. Re-run this grep and classify the remaining hits:

   rg -n "managerRuntimeId|DIVEDRA_MANAGER_RUNTIME_ID|manager_runtime_id|root-manager|subworkflow-manager|workflowCalls|subWorkflows|entryNodeId|managerNodeId|call-node|workflow-execution|legacy node-graph|node-addressed|rerunFromNodeId" src design-docs examples impl-plans --glob '!impl-plans/completed/**'

9. Repeat until remaining hits are limited to:
   - intentional negative/rejection tests
   - active/historical plan text
   - unrelated database/session migration coverage

Stop conditions:
- Stop and report if removing a compatibility branch would change the current supported step-addressed runtime behavior rather than only deleting dead or transitional code.
- Stop and report if a candidate hit is ambiguous between intentional schema-boundary rejection and removable runtime compatibility.
- Stop and report if a planned deletion would require changing archived history under `impl-plans/completed/`.

Expected output after each recursion:
- what live code was deleted
- what tests were updated or removed
- what docs/examples were updated
- what verification ran
- what remaining hits are left, grouped into:
  - live code
  - rejection-only tests
  - docs/plans/history
  - unrelated migration/history coverage
```

---

## Progress Log

### Session: 2026-04-29 12:53 JST

**Tasks Completed**: Created split tail-cleanup plan and Composer 2 recursive prompt
**Tasks In Progress**: None
**Blockers**: None
**Notes**: This file captures the post-supervision-adapter residual legacy inventory so another agent can continue deletion without re-discovering the remaining buckets.

### Session: 2026-04-29 14:25 JST

**Tasks Completed**: Updated this tail-cleanup plan for the post-TUI/post-Web-UI tree and replaced the Composer 2 prompt with the current-tree handoff version
**Tasks In Progress**: Remaining runtime/test/doc legacy buckets only
**Blockers**: None
**Notes**: TUI/Web UI deletion is no longer a remaining bucket. This file should now be treated as the current TODO/handover source for the remaining legacy workflow cleanup.

### Session: 2026-04-29 14:45 JST

**Tasks Completed**: Refined the Composer 2 handoff prompt with the currently observed live-code legacy targets and clearer stop/classification rules
**Tasks In Progress**: Remaining runtime/test/doc legacy buckets only
**Blockers**: None
**Notes**: No standalone Composer 2 instruction file exists in this repository; the active handoff prompt in this plan remains the instruction source. The prompt now distinguishes live runtime shims from intentional schema-rejection coverage and unrelated migration-history references.

### Session: 2026-04-29 15:05 JST

**Tasks Completed**: Re-audited the current tree after the legacy-code review and corrected this plan's remaining-runtime inventory
**Tasks In Progress**: TASK-001 through TASK-004 remain, but with corrected file targets and classification notes
**Blockers**: None
**Notes**: The earlier plan version overstated `src/workflow/call-step.ts`, `src/workflow/superviser-control.ts`, and `src/cli.ts` as remaining production shims. Current live-code residue is instead concentrated in `validate.ts`, `session.ts`, `trigger-runner.ts`, `node-execution-mailbox.ts`, and `save.ts`, while `cli.test.ts`, `session-store.test.ts`, and `runtime-db.test.ts` still contain intentional removed-command or migration coverage that must be classified before deletion.

### Session: 2026-04-29 (runtime tail slice)

**Tasks Completed**: **TASK-001** live shims: removed `call-node` CLI branch (unknown scope), removed `rewriteCallStepFailureMessage` / node-to-step rewrite from `call-step.ts`; kept nested superviser `rerunFromNodeId` **parse-time rejection** in `parseRerunTargetWorkflowControlArguments` (not a live alias); aligned `call-step-impl` prompt-variant error to `step`; added SQLite column rename migration `manager_runtime_id` / `manager_node_id` to `manager_step_id` in `manager-session-store` for existing local runtime DBs; updated `design-auto-improve-superviser-mode.md` remediation section to drop deleted supervision adapter prose; refreshed tests and Composer prompt bullets in this plan.
**Tasks In Progress**: TASK-002 test fixtures, TASK-003 broader doc/example prune, TASK-004 validate rejection-layer decision
**Blockers**: None
**Notes**: Targeted `bun run typecheck:server` and `bun test` on `src/cli.test.ts`, `src/workflow/call-step.test.ts`, `src/workflow/superviser-control.test.ts` passed.

### Session: 2026-04-29 (TASK-001 naming and documentation pass)

**Tasks Completed**: Renamed `compatNodes` to `nodesMaterializedFromSteps` in `validate.ts`; clarified rejection-list JSDoc; documented `currentNodeId` / `initialNodeId` / `resolveCurrentStepId` in `session.ts`; updated `trigger-runner.ts` manager step id comment; reworded manager-control prompt line in `node-execution-mailbox.ts`; renamed `workflow-vis.json` constant to `OBSOLETE_WORKFLOW_VISUALIZATION_FILE` with hygiene-oriented comment in `save.ts`; updated TASK-001 checklist items in this plan for the audited decisions.
**Tasks In Progress**: TASK-002, TASK-003, TASK-004
**Blockers**: None
**Notes**: No change to persisted session field names or execution matching logic in this pass; those remain the supported contract.

### Session: 2026-04-29 (TASK-002 fixture + registry schema slice)

**Tasks Completed**: Converted legacy `edges`/node-graph fixtures in `engine.test.ts` (`createWorkflowFixture`, optional/user-action/output/mailbox helpers), `runtime-db.test.ts`, `history.test.ts`, and `runtime-readiness.test.ts` callee bundle to strict `entryStepId` + `steps[]` + registry `nodes[]`. Extended step-addressed **node registry** (`WorkflowNodeRegistryRef`) with optional `kind` and `repeat` so loop/output metadata validates and materializes into `workflow.nodes` (with normalization in `validate.ts`). Fixed loop fixture transitions to use exit label `!(continue_round)` matching repeat-derived `exitWhen`. Switched `engine.test.ts` imports from `vitest` to `bun:test` to avoid Vitest worker load failures when Bun runs the full sorted test file list. Full `bun test` (617 tests) green.
**Tasks In Progress**: TASK-003 docs/examples, TASK-004 rejection-layer decision
**Blockers**: None
**Notes**: `call-step` message rewrite removal is unchanged; tests expect native `step` wording where applicable.

### Session: 2026-04-29 (remaining legacy review pass)

**Tasks Completed**: Reviewed the remaining legacy/compatibility references in `src/`, tests, docs, and examples after the current worktree cleanup. Classified the remaining `src/` hits into intentional schema rejection (`validate.ts`, `save.ts`), intentional runtime DB migration (`manager-session-store.ts`), comment-only historical wording (`call-step-impl.ts`), and finished runtime behavior. Recorded the reviewed test/doc residue and tightened TASK-002/TASK-003 accordingly.
**Tasks In Progress**: TASK-002 test-fixture conversion, TASK-003 docs/examples cleanup, TASK-004 rejection-layer decision
**Blockers**: None
**Notes**: The review found no additional live runtime compatibility branch that must be removed immediately beyond already-landed TASK-001 work. The remaining actionable cleanup is now concentrated in test-only removed-command coverage, a few legacy-authored fixture helpers, and historical compatibility prose in docs/examples.

### Session: 2026-04-29 (handoff: main plan reconciled with current tree)

**Tasks Completed**: Updated `workflow-legacy-compatibility-removal.md` summary, scope, review matrix, module-1 status line, and `impl-plans/README.md` active-plan notes; marked TASK-003 structural manager-kind doc checklist complete (prior spec passes + GraphQL manager scope wording).

**Tasks In Progress**: TASK-002 negative-test trim, TASK-004 rejection-layer decision

**Blockers**: None

**Notes**: Architecture matches the strict step-addressed intent in `architecture.md` and `design-unified-workflow-role-model.md`; remaining grep hits are mostly intentional rejection strings and plan vocabulary.

### Session: 2026-04-29 (tail cleanup: tests, docs, readiness helper)

**Tasks Completed**: Converted `engine.test.ts` command-timeout disk fixture to step-addressed (`entryStepId` + `nodes` + `steps`); rewrote `runtime-readiness.test.ts` in-memory `makeBundle` default branch to strict step-addressed shape with linear `transitions` (removed `LegacyEdgeWorkflow` + top-level `edges`); removed CLI test that only asserted `call-node` unknown scope; removed `superviser-control.test.ts` `rerunFromNodeId` ignore test; updated `call-step-impl.ts` file header; fixed `engine.test.ts` TS narrowing for `mutableWorkflowDir` in auto-improve supervision rerun test; updated `notes.md` (remove supervision-adapter sentence), `design-node-jump-and-code-manager-runtime.md` (current-only `workflowCalls` / migration wording), `examples/workflow-call-simple/EXPECTED_RESULTS.md`; refreshed this plan's TASK-002/TASK-003 checklists and reviewed-finding notes.
**Tasks In Progress**: TASK-003 remaining doc touch (`design-user-action-and-optional-node-execution.md` etc.), TASK-004 rejection-layer decision, TASK-002 negative-coverage trim
**Blockers**: None
**Notes**: Full `bash ./scripts/run-bun-tests.sh` passed (615 tests). One prior run flaked on `persists native command stdout in runtime node logs` (stdout log line not found); re-run green.

### Session: 2026-04-29 (negative-test dedup + TASK-004 doc)

**Tasks Completed**: Removed redundant `workflowCalls` rejection tests from `load.test.ts` and `save.test.ts` (canonical coverage stays in `validate.test.ts`); documented explicit disallowed-key lists in `validate.ts` as intentional schema guards; renamed `native-node-executor.test.ts` working-directory case to describe a supported optional field; refreshed `workflow-legacy-compatibility-removal.md` module 2/3 status lines and this plan's TASK-002/TASK-004 checklists.
**Tasks In Progress**: TASK-002 (optional further GraphQL/schema dedup), TASK-003 plan alignment after audits
**Blockers**: None
**Notes**: Run `bash ./scripts/run-bun-tests.sh` or targeted `bun test` on touched files after this slice.

### Session: 2026-04-29 (main plan + tail inventory alignment)

**Tasks Completed**: Reconciled `workflow-legacy-compatibility-removal.md` forward-looking sections with the post-TUI tree: removed `src/tui/**/*` from the module-3 file list and test command; marked completed completion-criteria rows (authored rejection, `call-node` removal, inspection/GraphQL/CLI/visualization step model, README/examples); set Examples dependency to IN_PROGRESS with tail-plan pointer; refreshed review matrix (DRY/SOLID and architecture fit: MOSTLY ALIGNED, tail debt is test/doc overlap not a second engine). Audited TASK-002: `runtime-db` / `session-store` migration tests and `native-node-executor` `workingDirectory` tests remain justified.

**Tasks In Progress**: TASK-003 incidental terminology grep; optional GraphQL/schema negative-test dedup if a later pass finds pure duplicates

**Blockers**: None

**Notes**: No production TypeScript changes in this slice.

### Session: 2026-04-29 (follow-up: plan checklist + grep re-audit)

**Tasks Completed**: Marked Module 1 inventory checklist items complete (they were implemented across earlier sessions but still showed `[ ]`); re-ran legacy-term `rg` over `src`, `design-docs`, `examples`, and active `impl-plans` (excluding `impl-plans/completed/**`). Confirmed no remaining live shims for `call-node`, `toStepAddressedWorkflowForSupervision`, or `inferLegacyNodeGraph*` in `src/`; remaining hits include nested `rerun-workflow` allowlist checks (tests may still mention legacy key names), intentional validation/save rejection strings, manager SQLite column rename migration, and plan vocabulary.
**Tasks In Progress**: None (optional future pass: trim overlapping GraphQL HTTP vs schema worker-only assertions only if a later audit finds pure duplicates).
**Blockers**: None
**Notes**: Architecture remains aligned with strict step-addressed authoring and step-derived cross-workflow dispatch per `design-workflow-json.md` and `design-unified-workflow-role-model.md`.

### Session: 2026-04-29 (post-merge review: tests + plan matrix)

**Tasks Completed**: Full `scripts/run-bun-tests.sh` re-run (**616** pass); grep audit confirmed no legacy-key JSON samples under `design-docs/` or `examples/`; fixed `workflow-legacy-compatibility-removal.md` review-matrix **Error contract** row (it still described `rewriteCallStepFailureMessage` after removal) and clarified handoff stub vs `completed/` archive paths; added iteration note to root tail-cleanup stub.

**Tasks In Progress**: None

**Blockers**: None

**Notes**: `divedra call-node ...` now reaches generic `unknown scope: call-node` (removed dedicated branch per scope); acceptable per removal-only posture. JSDoc on `buildCrossWorkflowCalleeRuntimeVariables` in `src/workflow/engine.ts` was updated to spell out `runtimeVariables.workflowCall` versus rejected authored `workflow.workflowCalls` (mirrors `architecture.md` / `design-unified-workflow-role-model.md`).

## Related Plans

- **Previous**: `impl-plans/workflow-legacy-compatibility-removal.md`
- **Next**: None required; main plan `workflow-legacy-compatibility-removal.md` is completed. Optional follow-ups: GraphQL/schema assertion dedup, naming hygiene.
- **Depends On**: `workflow-legacy-compatibility-removal.md`
