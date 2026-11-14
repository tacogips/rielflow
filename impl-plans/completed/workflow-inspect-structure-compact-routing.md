# Workflow Inspect Structure Compact Routing Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/command.md#subcommands`
**Created**: 2026-05-13
**Last Updated**: 2026-05-13

---

## Design Document Reference

**Source**: `design-docs/specs/command.md:30-37`

### Summary

Improve `workflow inspect <name> --structure` text output so it renders compact
structure rows directly from the loaded workflow bundle after load/validation
succeeds. The compact text path must avoid `buildInspectionSummary` and the
runtime readiness work behind the detailed inspection surface.

### Scope

**Included**: CLI routing for non-json `--structure`, focused regression tests
for the compact text path, preservation checks for `--structure --output json`
and default inspect output, documentation impact review for the unchanged
user-facing command surface, and a short progress-log update during
implementation.

**Excluded**: Changes to `deriveWorkflowStructureRows`, JSON inspection shape,
default detailed inspect text, workflow loading/validation behavior, GraphQL,
TUI behavior, or Codex-reference porting.

### Issue Reference

- **Workflow mode**: `issue-resolution`
- **Issue source**: `runtimeVariables.workflowInput`
- **Title**: Improve compact workflow inspect structure performance
- **Upstream review session**:
  `div-recent-change-quality-loop-1778646596-7cbb51be`
- **Finding severity**: low
- **Finding reference**: `src/cli.ts` around
  `workflow inspect --structure`

### Codex-Agent References

No codex-agent reference repository, issue URL, or source paths were provided.
This plan intentionally follows the accepted local divedra design only.

---

## Modules

### 1. CLI Inspect Routing

#### `src/cli.ts`

**Status**: COMPLETED

```typescript
function renderWorkflowStructureLines(
  rows: readonly WorkflowStructureRow[],
): readonly string[];

function deriveWorkflowStructureRows(
  workflow: NormalizedWorkflowBundle["workflow"],
): readonly WorkflowStructureRow[];

async function buildInspectionSummary(
  loaded: LoadedWorkflow,
  options?: LoadOptions,
): Promise<WorkflowInspectionSummary>;
```

**Checklist**:

- [x] In `workflow inspect`, keep `loadWorkflowFromCatalog` and validation
      handling before any rendering.
- [x] If `parsed.options.structure` is true and
      `parsed.options.output !== "json"`, render
      `renderWorkflowStructureLines(deriveWorkflowStructureRows(loaded.value.bundle.workflow))`
      before computing `loadedWorkflowOptions` or calling
      `buildInspectionSummary`.
- [x] Keep `--structure --output json` on the full
      `buildInspectionSummary` path and include `source` as today.
- [x] Keep default `workflow inspect <name>` on the full
      `buildInspectionSummary` path.
- [x] Avoid changes to compact row derivation, formatting, or option parsing
      unless needed by tests.

### 2. CLI Regression Coverage

#### `src/cli.test.ts`

**Status**: COMPLETED

```typescript
type WorkflowInspectStructureScenario =
  | "compact-text-no-summary"
  | "structure-json-full-summary"
  | "default-text-full-summary";
```

**Checklist**:

- [x] Add a regression proving non-json `--structure` compact text output does
      not require inspection summary/runtime readiness work.
- [x] Prefer a behavior-focused readiness side-effect assertion using existing
      test seams; use a small local test seam only if direct behavior coverage
      is not practical.
- [x] Keep or extend the existing compact output assertions for omitted
      `runtimeReady`, `nodeRegistryIds`, `workflowId`, and callable details.
- [x] Keep `--structure --output json` coverage proving full inspection JSON is
      still emitted.
- [x] Keep default inspect coverage, or add a focused assertion if the routing
      change creates risk for detailed text output.

---

## Module Status

| Module                  | File Path         | Status    | Tests             |
| ----------------------- | ----------------- | --------- | ----------------- |
| CLI inspect routing     | `src/cli.ts`      | COMPLETED | `src/cli.test.ts` |
| CLI regression coverage | `src/cli.test.ts` | COMPLETED | `src/cli.test.ts` |

## Task Breakdown

### TASK-001: Route Compact Text Before Inspection Summary

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `src/cli.ts`
**Depends On**: Accepted design in `design-docs/specs/command.md:36-37`

Completion criteria:

- [x] Non-json `workflow inspect <name> --structure` renders compact rows from
      `loaded.value.bundle.workflow` before `buildInspectionSummary`.
- [x] `loadedWorkflowOptions` is only computed for JSON/default inspect paths
      that still need `buildInspectionSummary`.
- [x] Load and validation errors behave exactly as before compact rendering.

### TASK-002: Add Regression Test for Summary-Free Compact Text

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `src/cli.test.ts`
**Depends On**: TASK-001 routing shape, existing CLI fixtures

Completion criteria:

- [x] A focused test fails on the current eager-summary implementation and
      passes after TASK-001.
- [x] The test proves compact text output is independent from runtime readiness
      probes or an equivalent inspection-summary dependency.
- [x] The test keeps output assertions compact and avoids brittle broad mocks.

### TASK-003: Verify Preservation Paths

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `src/cli.test.ts`
**Depends On**: TASK-001

Completion criteria:

- [x] Existing or updated tests prove `--structure --output json` still returns
      full inspection summary fields including `workflowId`, `nodeRegistryIds`,
      and `runtime.ready`.
- [x] Existing or updated tests prove default `workflow inspect <name>` still
      uses detailed inspection output.

### TASK-004: Review Documentation Impact

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `README.md` if user-facing docs need an update; otherwise progress-log note only
**Depends On**: TASK-001 through TASK-003

Completion criteria:

- [x] User-facing docs are reviewed for `workflow inspect --structure`
      examples or descriptions.
- [x] If docs describe implementation cost or runtime readiness behavior, update
      them to match the optimized compact path.
- [x] If no user-facing docs change is needed, record that decision in the
      progress log.

### TASK-005: Run Focused and Full Verification

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: verification command results in implementation progress log
**Depends On**: TASK-001 through TASK-004

Completion criteria:

- [x] Focused CLI tests pass.
- [x] Workflow inspect helper tests pass if touched or relevant.
- [x] Typecheck passes.
- [x] Full test suite passes.

---

## Dependencies

| Feature                     | Depends On                                        | Status    |
| --------------------------- | ------------------------------------------------- | --------- |
| Compact text routing        | Accepted Step 3 design review                     | COMPLETED |
| Regression coverage         | Compact text routing behavior                     | COMPLETED |
| Preservation verification   | Compact text routing behavior                     | COMPLETED |
| Documentation impact review | Routing behavior known                            | COMPLETED |
| Full verification           | Routing, tests, and documentation review complete | COMPLETED |

## Parallelizable Tasks

No tasks are marked parallelizable. The write scope is intentionally small and
both implementation and tests touch the same CLI behavior surface, so splitting
work would increase coordination risk more than it would reduce elapsed time.

## Verification Plan

Run these commands during implementation:

```bash
bun test src/cli.test.ts --runInBand
bun test src/workflow/inspect.test.ts --runInBand
bun run typecheck
bun test
rg -n "workflow inspect.*--structure|--structure" README.md design-docs/specs/command.md
```

Manual behavior check if needed:

```bash
bun run src/main.ts workflow inspect <workflow-name> --workflow-definition-dir ./examples --structure
bun run src/main.ts workflow inspect <workflow-name> --workflow-definition-dir ./examples --structure --output json
```

## Completion Criteria

- [x] `src/cli.ts` renders non-json `--structure` compact rows directly from
      the loaded workflow bundle before any full inspection summary work.
- [x] `--structure --output json` still emits full inspection summary JSON.
- [x] Default `workflow inspect` text still emits detailed inspection output.
- [x] Regression coverage proves the compact structure path avoids inspection
      summary/runtime readiness work or an equivalent dependency.
- [x] Focused tests, typecheck, and full tests pass.
- [x] Documentation impact is reviewed and any required docs update is made or
      explicitly recorded as unnecessary.
- [x] Progress log records commands run and any residual risk.

## Progress Log

### Session: 2026-05-13 00:00

**Tasks Completed**: Plan created after Step 3 design acceptance.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Later implementation should update this log with TASK ids completed,
verification commands, and whether any test seam was needed.

### Session: 2026-05-13 14:00 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Routed non-json `workflow inspect --structure` to render compact rows
from `loaded.value.bundle.workflow` immediately after successful load/validation,
before `loadedWorkflowOptions` or `buildInspectionSummary`. Added a narrow CLI
test seam for the summary builder and a regression proving compact text does not
call it; JSON `--structure --output json` and default inspect remain on the full
summary path. Reviewed README and command design references for
`workflow inspect --structure`; no user-facing documentation change was needed
because docs describe output shape, not implementation cost or runtime readiness.
Touched source files were already over the 1000-line TypeScript target; no split
was performed because this task required a small localized routing/test change.
Verification passed:
`bun test src/cli.test.ts -t "workflow inspect --structure"`,
`bun test src/cli.test.ts --runInBand`,
`bun test src/workflow/inspect.test.ts --runInBand`,
`bun run lint:biome` (exit 0 with pre-existing warnings outside touched files),
`bun run typecheck`, `bun test` (990 pass), and
`rg -n "workflow inspect.*--structure|--structure" README.md design-docs/specs/command.md`.

### Session: 2026-05-13 14:09 JST

**Tasks Completed**: Step 7 archival consistency revision.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Addressed Step 7 mid finding by moving this completed plan from
`impl-plans/active/` to `impl-plans/completed/`, updating `impl-plans/README.md`
so no active plans remain and this plan appears under Recently Completed, and
updating `impl-plans/PROGRESS.json` to point at the completed path. Verification
for this documentation/progress-only revision passed:
`test ! -e impl-plans/active/workflow-inspect-structure-compact-routing.md`,
`test -f impl-plans/completed/workflow-inspect-structure-compact-routing.md`,
`jq '.plans["workflow-inspect-structure-compact-routing"].path' impl-plans/PROGRESS.json`,
`rg -n "workflow-inspect-structure-compact-routing|No active implementation plans remain" impl-plans/README.md impl-plans/PROGRESS.json`,
and `git diff --check`.

## Related Plans

- **Previous**: `impl-plans/completed/workflow-inspect-structure.md`
- **Depends On**: `design-docs/specs/command.md:36-37`
