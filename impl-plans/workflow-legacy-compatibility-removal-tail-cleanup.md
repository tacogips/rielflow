# Workflow Legacy Compatibility Removal Tail Cleanup Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-workflow-json.md`, `design-docs/specs/design-unified-workflow-role-model.md`, `design-docs/specs/architecture.md`, `design-docs/specs/command.md`, `design-docs/specs/notes.md`
**Created**: 2026-04-29
**Last Updated**: 2026-04-29

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
inspection, GraphQL, supervision adapter, TUI, and Web UI removals. The remaining work is now mostly:

- live runtime shims that still mention or guard legacy node-addressed behavior
- test fixtures and negative coverage that still preserve removed schema aliases
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

#### `impl-plans/workflow-legacy-compatibility-removal-tail-cleanup.md`

**Status**: READY

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

- [ ] Track each remaining cleanup bucket with concrete file targets
- [ ] Document how to remove each bucket, not just what remains
- [ ] Include Composer 2 prompt for recursive execution

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Runtime tail cleanup | `src/workflow/call-step.ts`, `src/workflow/superviser-control.ts`, `src/cli.ts` | READY | Targeted Bun tests |
| Legacy test-fixture conversion | `src/**/*.test.ts` listed below | READY | Targeted Bun tests |
| Docs/examples tail cleanup | `design-docs/specs/*.md`, `examples/**/*` listed below | READY | Grep + smoke checks |
| Plan/index cleanup | `impl-plans/*.md`, `impl-plans/README.md`, `impl-plans/PROGRESS.json` | READY | Grep |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Runtime/UI tail cleanup | Prior runtime naming and supervision cleanup | Available |
| Test-fixture conversion | Runtime/UI tail cleanup | Available |
| Docs/examples tail cleanup | Runtime/UI cleanup decisions | Available |
| Plan/index cleanup | All other cleanup slices | Available |

---

## Todo List

### TASK-001: Delete Remaining Live Runtime Legacy Shims

**Status**: Ready
**Parallelizable**: No
**Files**:

- `src/workflow/superviser-control.ts`
- `src/workflow/call-step.ts`
- `src/cli.ts`

**What to remove**:

- `rerunFromNodeId` rejection shim in `superviser-control.ts`
- `call-node`/node-oriented failure-message rewrite layer in `call-step.ts`
- Removed-command shim for `call-node` in `cli.ts`

**How to remove it**:

- Assume only strict step-addressed workflows in runtime/UI code paths
- Delete helper functions rather than keeping dead wrappers
- Replace node-addressed error text with direct step-only wording
- Remove `call-node` dispatch branches entirely instead of preserving “removed” command handling
- If a test exists only to assert the removed shim, delete or rewrite the test to assert current step-only behavior

**Checklist**:

- [x] Delete TUI and Web UI runtime surfaces already removed from the current tree
- [ ] Remove `rerunFromNodeId` parser branch from nested superviser control
- [ ] Remove `call-step` compatibility rewrite layer
- [ ] Remove `call-node` CLI shim

### TASK-002: Convert Remaining Legacy-Authored Test Fixtures

**Status**: Ready
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

**What to remove**:

- Fixtures authored with top-level `edges`, `workflowCalls`, `subWorkflows`, `entryNodeId`, or `managerRuntimeId`
- Assertions whose only purpose is preserving removed compatibility shims
- Terminology that still says “legacy node-addressed execution” when the runtime no longer supports it

**How to remove it**:

- Rewrite fixtures to strict `entryStepId` + `steps[]` + `nodes[]`
- Keep negative rejection coverage only where it still protects current schema boundaries
- Delete tests whose only purpose is checking a removed shim message
- Prefer one modern fixture helper reused across suites over per-test legacy bundles

**Checklist**:

- [ ] Rewrite legacy graph fixtures in `engine.test.ts`
- [ ] Rewrite legacy graph fixtures in runtime/history/readiness tests
- [x] Remove TUI-specific legacy fixture coverage already deleted with `src/tui/**`
- [ ] Update `call-step.test.ts` to stop expecting `call-node` wording
- [ ] Trim redundant GraphQL/CLI/save/validate/types negative coverage to the minimum useful set

### TASK-003: Remove Stale Docs, Examples, and Historical Cleanup Notes

**Status**: Ready
**Parallelizable**: Yes
**Files**:

- `design-docs/specs/design-auto-improve-superviser-mode.md`
- `design-docs/specs/design-node-jump-and-code-manager-runtime.md`
- `design-docs/specs/design-user-action-and-optional-node-execution.md`
- `design-docs/specs/design-unified-workflow-role-model.md`
- `examples/workflow-call-simple/EXPECTED_RESULTS.md`
- `impl-plans/workflow-legacy-compatibility-removal.md`

**What to remove**:

- References to the deleted supervision adapter `toStepAddressedWorkflowForSupervision(...)`
- Migration prose that still treats `workflowCalls`, `subWorkflows`, `subworkflow-manager`, `root-manager`, or `call-node` as live cleanup targets inside current behavior descriptions
- Example expectation text that still talks about omitted removed fields instead of just describing the current schema
- TUI/Web UI docs that still survived the code deletion and describe removed surfaces as current

**How to remove it**:

- Rewrite current-behavior sections to describe only the strict step-addressed model
- Keep historical context only when it helps explain why validation rejects a field
- Delete obsolete migration prose instead of preserving it in speculative wording
- Update the active legacy-removal plan status notes so they match the current codebase after each deletion slice

**Checklist**:

- [ ] Remove deleted supervision-adapter references
- [ ] Collapse `workflowCalls` migration prose into current step-transition wording
- [ ] Remove stale structural manager-kind references from current docs
- [x] Remove TUI/Web UI top-level docs for the current tree
- [ ] Rewrite examples to describe current output only
- [ ] Reconcile the active legacy-removal plan with actual remaining work

### TASK-004: Final Rejection-Layer Decision

**Status**: Ready
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

- [ ] Decide whether explicit rejection lists stay or collapse
- [ ] If they stay, document them as current schema guards, not compatibility support
- [ ] If they collapse, update tests and error-message expectations consistently

---

## Completion Criteria

- [ ] No live `src/` runtime code preserves node-addressed or `call-node` compatibility shims
- [ ] Remaining mentions of removed fields in `src/` are either intentional schema rejection or unrelated historical database migration coverage
- [ ] Legacy-authored workflow fixtures are converted or deleted across touched test suites
- [ ] Current design docs/examples no longer describe removed compatibility behavior as active
- [ ] `rg` against removed legacy terms is reduced to intentional rejection coverage, historical archived plans, or unrelated migration tests
- [ ] Targeted tests and `bun run typecheck:server` pass after each slice

---

## Composer 2 Prompt

Use this prompt with Composer 2:

```text
You are working in /g/gits/tacogips/divedra.

Objective:
Recursively remove the remaining workflow legacy-compatibility residue until only intentional schema-rejection coverage, archived historical plans, or unrelated database-migration tests remain.

Primary references:
- impl-plans/workflow-legacy-compatibility-removal-tail-cleanup.md
- impl-plans/workflow-legacy-compatibility-removal.md

Current repository state:
- TUI is already deleted.
- Web UI/browser workflow viewer is already deleted.
- `tui`, `web serve`, OpenTUI, Solid viewer, and related build/server helpers are already removed.
- Do not spend time re-removing deleted UI surfaces; focus on the remaining workflow legacy tail.

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

Recursive procedure:
1. Read impl-plans/workflow-legacy-compatibility-removal-tail-cleanup.md.
2. Pick exactly one unfinished task bucket.
3. Delete the production/runtime shims in that bucket first.
4. Update or delete tests that only preserve the removed shim.
5. Update docs/examples for the same bucket.
6. Run targeted verification.
7. Re-run this grep and classify the remaining hits:

   rg -n "managerRuntimeId|DIVEDRA_MANAGER_RUNTIME_ID|manager_runtime_id|root-manager|subworkflow-manager|workflowCalls|subWorkflows|entryNodeId|managerNodeId|call-node|workflow-execution|legacy node-graph|node-addressed|rerunFromNodeId" src design-docs examples impl-plans --glob '!impl-plans/completed/**'

8. Repeat until remaining hits are limited to:
   - intentional negative/rejection tests
   - active/historical plan text
   - unrelated database/session migration coverage

Expected output after each recursion:
- what live code was deleted
- what tests were updated or removed
- what docs/examples were updated
- what verification ran
- what remaining hits are left, grouped into:
  - live code
  - rejection-only tests
  - docs/plans/history
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

## Related Plans

- **Previous**: `impl-plans/workflow-legacy-compatibility-removal.md`
- **Next**: Continue deleting buckets from this split plan until the main plan can be marked completed
- **Depends On**: `workflow-legacy-compatibility-removal.md`
