# Boundary Add-on Source-Tree Loading Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-workflow-json.md#built-in-add-on-package-boundary`
**Created**: 2026-05-29
**Last Updated**: 2026-05-29

## Design Reference

Implement the accepted source-tree built-in add-on package boundary behavior from
`design-docs/specs/design-workflow-json.md`.

This plan covers the issue-resolution fix for boundary add-on package loading so
workflow validation resolves newly added built-in `rielflow/*` add-ons from the
source tree instead of accepting stale `packages/rielflow-addons/dist/index.js`
output.

This plan does not change third-party add-on resolver behavior, scoped local
add-on lookup, authored workflow JSON shape, package checkout behavior, or
packaged distribution layout.

## Issue Resolution Scope

Issue reference: `workflowCall.input.workflowInput.issue`

Workflow mode: `issue-resolution`

Parent review workflow: `codex-recent-change-quality-loop`

Parent review execution:
`div-codex-recent-change-quality-loop-1780013847-84379cb0`

Blocking finding:
`packages/rielflow/src/workflow/addon-package-boundary.ts:82` imports
`packages/rielflow-addons/dist/index.js` before source when rielflow runs from
`packages/rielflow/src`; stale dist output hides newly added built-in add-ons
such as `rielflow/workflow-package-sandbox-review`.

Accepted Step 3 review decision: `accepted_for_step4_implementation_planning`

Step 3 findings: none.

## Codex Agent References

- Workflow ID: `codex-design-and-implement-review-loop`
- Worker backend: `codex-agent`
- Node ID creating this plan: `step4-impl-plan-create`
- No external Codex reference repository input was supplied.
- Runtime target files:
  - `packages/rielflow/src/workflow/addon-package-boundary.ts`
  - `packages/rielflow/src/workflow/addon-package-boundary.test.ts`
  - `packages/rielflow/src/workflow/validate.test.ts`

## Modules

### 1. Boundary Add-on Package Loader

#### `packages/rielflow/src/workflow/addon-package-boundary.ts`

**Status**: COMPLETED

**Deliverables**:

- Detect whether the rielflow entrypoint URL is under
  `packages/rielflow/src`.
- For source-tree execution, prefer
  `packages/rielflow-addons/src/index.ts` before
  `packages/rielflow-addons/dist/index.js`.
- Preserve current missing-dist fallback behavior for packaged or dist
  execution.
- Keep error wrapping in `loadBoundaryAddonPackage` intact so callers still see
  `unable to load add-on package...`.
- Keep sync resolver behavior for third-party resolvers unchanged.

**Checklist**:

- [x] `resolveDefaultBoundaryAddonPackageEntrypoints` exposes enough
      information for the loader to know the intended preference order.
- [x] `createBoundaryAddonPackageLoader` imports source first when the
      rielflow entrypoint is under `packages/rielflow/src`.
- [x] Packaged/dist entrypoints continue to import built output first and fall
      back to source only when built output is missing.
- [x] Non-missing import failures from the first selected entrypoint are not
      silently swallowed.

### 2. Boundary Loader Regression Tests

#### `packages/rielflow/src/workflow/addon-package-boundary.test.ts`

**Status**: COMPLETED

**Deliverables**:

- Add a unit test proving source-tree entrypoints prefer
  `packages/rielflow-addons/src/index.ts` even when a built entrypoint URL is
  present.
- Keep existing missing-dist fallback coverage.
- Keep existing packaged/root CLI entrypoint path coverage.

**Checklist**:

- [x] Test asserts source-tree preference order explicitly.
- [x] Test asserts dist/package preference order remains built-first.
- [x] Existing fallback and exported-function assertions remain passing.

### 3. Workflow Validation Regression

#### `packages/rielflow/src/workflow/validate.test.ts`

**Status**: COMPLETED

**Deliverables**:

- Preserve or strengthen coverage showing
  `validateWorkflowBundleDetailedAsync` resolves
  `rielflow/workflow-package-sandbox-review`.
- Preserve rejection coverage for unsupported backends on the same built-in
  add-on.
- Ensure tests fail if stale dist output is selected before source during
  source-tree validation.

**Checklist**:

- [x] Built-in `rielflow/workflow-package-sandbox-review` validation succeeds
      with a materialized LLM-backed worker payload.
- [x] Unsupported backend validation still fails at
      `workflow.nodes[0].addon.config.executionBackend`.
- [x] Add-on node validation result remains present with source `addon` and
      addon name `rielflow/workflow-package-sandbox-review`.

### 4. Typecheck And Documentation Handoff

#### `package.json`
#### `design-docs/specs/design-workflow-json.md`

**Status**: COMPLETED

**Deliverables**:

- Run repository TypeScript typecheck after TypeScript implementation changes.
- Confirm no additional user-facing documentation changes are required beyond
  the accepted design update for this issue-resolution scope.
- If implementation changes reveal a behavior difference from the accepted
  design, update `design-docs/specs/design-workflow-json.md` before review.

**Checklist**:

- [x] `bun run typecheck` passes after implementation.
- [x] Accepted design remains accurate after implementation.
- [x] Any documentation change is recorded in this plan's progress log.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Boundary add-on package loader | `packages/rielflow/src/workflow/addon-package-boundary.ts` | COMPLETED | `addon-package-boundary.test.ts`, `validate.test.ts` |
| Boundary loader regression tests | `packages/rielflow/src/workflow/addon-package-boundary.test.ts` | COMPLETED | `bun test packages/rielflow/src/workflow/addon-package-boundary.test.ts` |
| Workflow validation regression | `packages/rielflow/src/workflow/validate.test.ts` | COMPLETED | `bun test packages/rielflow/src/workflow/validate.test.ts` |
| Typecheck and documentation handoff | `package.json`, `design-docs/specs/design-workflow-json.md` | COMPLETED | `bun run typecheck` |

## Dependencies

| Task | Depends On | Status |
|------|------------|--------|
| TASK-001 Boundary loader source-tree preference | Accepted Step 3 design review | COMPLETED |
| TASK-002 Boundary loader regression tests | TASK-001 behavior shape | COMPLETED |
| TASK-003 Workflow validation regression | TASK-001 behavior shape | COMPLETED |
| TASK-004 Typecheck and documentation handoff | TASK-001, TASK-002, TASK-003 | COMPLETED |
| TASK-005 Verification and review handoff | TASK-001, TASK-002, TASK-003, TASK-004 | COMPLETED |

## Task Breakdown

### TASK-001: Implement Source-Tree Loader Preference

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/workflow/addon-package-boundary.ts`

Update boundary loader selection so source-tree execution imports source first,
while packaged/dist execution remains built-first with missing-dist fallback.

**Completion Criteria**:

- [x] Source-tree `packages/rielflow/src` entrypoint resolves source before
      dist.
- [x] Packaged/dist entrypoints preserve built-first behavior.
- [x] Import errors that are not missing-entrypoint errors still surface.

### TASK-002: Add Boundary Loader Tests

**Status**: COMPLETED
**Parallelizable**: No, shares the same behavioral surface as TASK-001
**Deliverables**: `packages/rielflow/src/workflow/addon-package-boundary.test.ts`

Add focused unit coverage for source-tree preference order and preserve existing
fallback expectations.

**Completion Criteria**:

- [x] Source-tree preference order is asserted without relying on stale local
      build artifacts.
- [x] Existing path-resolution assertions remain explicit.
- [x] `bun test packages/rielflow/src/workflow/addon-package-boundary.test.ts`
      passes.

### TASK-003: Preserve Validation Regression Coverage

**Status**: COMPLETED
**Parallelizable**: No, depends on loader behavior from TASK-001
**Deliverables**: `packages/rielflow/src/workflow/validate.test.ts`

Keep the `rielflow/workflow-package-sandbox-review` validation tests aligned
with the fixed loader behavior.

**Completion Criteria**:

- [x] `validateWorkflowBundleDetailedAsync` resolves
      `rielflow/workflow-package-sandbox-review`.
- [x] Unsupported backend rejection remains covered.
- [x] `bun test packages/rielflow/src/workflow/validate.test.ts` passes.

### TASK-004: Typecheck And Documentation Handoff

**Status**: COMPLETED
**Parallelizable**: No, depends on implementation and tests
**Deliverables**: `package.json`, `design-docs/specs/design-workflow-json.md`

Run repository typecheck and confirm documentation remains aligned with the
implemented behavior.

**Completion Criteria**:

- [x] `bun run typecheck` passes.
- [x] Accepted design still describes the implemented source-tree and packaged
      dist behavior.
- [x] Any required documentation adjustment is made before Step 5 review.
- [x] Progress log records implementation, verification, and documentation
      outcomes.

### TASK-005: Verification And Review Handoff

**Status**: COMPLETED
**Parallelizable**: No, depends on implementation, tests, typecheck, and
documentation handoff
**Deliverables**: verification output for Step 5 review

Run required targeted verification and collect failures, if any, for review.

**Completion Criteria**:

- [x] `bun test packages/rielflow/src/workflow/validate.test.ts` passes.
- [x] `bun test packages/rielflow/src/workflow/addon-package-boundary.test.ts`
      passes.
- [x] `bun test packages/rielflow/src/cli.test.ts` passes or any failure is
      shown to be unrelated.

## Verification Plan

Required commands:

```bash
bun run typecheck
bun test packages/rielflow/src/workflow/validate.test.ts
bun test packages/rielflow/src/workflow/addon-package-boundary.test.ts
bun test packages/rielflow/src/cli.test.ts
```

Optional broader checks when time allows:

```bash
bun test packages/rielflow/src/workflow/packages/checkout.test.ts packages/rielflow/src/workflow/packages/packages.test.ts
bun test packages/rielflow/src/workflow/adapters/codex.test.ts packages/rielflow/src/workflow/adapters/cursor.test.ts
```

## Completion Criteria

- [x] Boundary loader follows the accepted design for source-tree versus
      packaged/dist execution.
- [x] Newly added built-in add-ons exported from
      `packages/rielflow-addons/src/index.ts` are visible during source-tree
      validation even when dist exists.
- [x] Third-party and scoped local add-on resolution remain unchanged.
- [x] Type checking passes with `bun run typecheck`.
- [x] Accepted design documentation remains accurate or is updated before
      review.
- [x] Required verification commands pass.
- [x] Step 5 review has no high or mid findings.

## Progress Log

### Session: 2026-05-29 Step 4

**Tasks Completed**: Created implementation plan.

**Notes**: Step 3 accepted the design with no findings. Implementation remains
pending for Step 6 or later worker execution.

### Session: 2026-05-29 Step 6

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Blockers**: None

**Verification**:

- PASS: `bun run lint:biome`
- PASS: `bun run typecheck`
- PASS: `bun test packages/rielflow/src/workflow/addon-package-boundary.test.ts packages/rielflow/src/workflow/validate.test.ts packages/rielflow/src/cli.test.ts`

**Notes**: `packages/rielflow/src/workflow/addon-package-boundary.ts` now
derives an explicit import order from the rielflow entrypoint path, preferring
`packages/rielflow-addons/src/index.ts` for `packages/rielflow/src` execution
and preserving built-first behavior elsewhere. Regression tests assert both
orders without relying on local stale build artifacts. The accepted design in
`design-docs/specs/design-workflow-json.md` remains accurate; no additional
documentation update was required in Step 6.
