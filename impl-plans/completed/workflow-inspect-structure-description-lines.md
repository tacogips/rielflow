# Workflow Inspect Structure Description Lines Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/command.md#subcommands`
**Created**: 2026-05-13
**Last Updated**: 2026-05-13

---

## Design Document Reference

**Source**: `design-docs/specs/command.md:30-37`,
`design-docs/specs/command.md:141`

### Summary

Change non-json `workflow inspect <name> --structure` text output from one line
per step to two physical lines per logical step row. The first line renders the
canonical step id at the existing derived structure indentation. The second line
renders the step description, or `-` when missing or empty, one compact indent
unit deeper.

### Scope

**Included**: Compact text renderer formatting, focused CLI expectations for
two-line output, missing-description dash coverage on the description line,
README wording/example refresh, and verification records.

**Excluded**: Changes to compact row derivation or traversal order, workflow
loading or validation, non-json compact fast-path routing, JSON inspection
output, default detailed inspect output, GraphQL, TUI, or Codex-reference
porting.

### Issue Reference

- **Workflow mode**: `issue-resolution`
- **Issue source**: `runtimeVariables.workflowInput issueTitle/issueBody`
- **Title**: Render compact workflow structure descriptions on the next
  indented line
- **Issue URL**: none provided
- **Issue repository/number**: none provided

### Codex-Agent References

No codex-agent reference repository, source path, or issue reference was
provided. This plan follows the accepted local divedra design only. There are no
intentional divergences from external Codex-reference behavior.

---

## Modules

### 1. Compact Structure Text Renderer

#### `src/cli.ts`

**Status**: COMPLETED

```typescript
function renderWorkflowStructureLines(
  rows: readonly WorkflowStructureRow[],
  options?: { readonly indentUnit: string },
): string[];
```

**Checklist**:

- [x] Keep `(none)` output unchanged for workflows with no structure rows.
- [x] For each row, emit the step id line as
      `indentUnit.repeat(row.indent) + row.stepId`.
- [x] Emit the description line immediately after the id line as
      `indentUnit.repeat(row.indent + 1) + row.description`.
- [x] Preserve the current default compact indent unit of two spaces.
- [x] Do not move compact non-json `--structure` back onto
      `buildInspectionSummary`.

### 2. CLI Regression Coverage

#### `src/cli.test.ts`

**Status**: COMPLETED

```typescript
type WorkflowInspectStructureDescriptionLineScenario =
  | "compact-two-line-row"
  | "missing-description-dash-line"
  | "structure-json-preserved";
```

**Checklist**:

- [x] Update the existing compact text test to expect two physical lines per
      workflow step.
- [x] Keep the assertion that non-json `--structure` does not call
      `buildInspectionSummary`.
- [x] Add or update coverage for missing or empty descriptions rendering as `-`
      on the indented description line.
- [x] Preserve coverage that `--structure --output json` emits full inspection
      JSON with runtime, callable, workflow id, and node registry fields.
- [x] Preserve default inspect tests that prove detailed text output is
      unchanged.

### 3. User-Facing Documentation

#### `README.md`

**Status**: COMPLETED

**Checklist**:

- [x] Update wording that says compact structure prints each step id and
      description together.
- [x] Document the two-line shape: id line, then an indented description or
      dash line.
- [x] Preserve the guidance that compact text structure output avoids the full
      inspection summary and runtime readiness checks.
- [x] Keep JSON inspection guidance unchanged.

### 4. Progress and Verification Notes

#### `impl-plans/active/workflow-inspect-structure-description-lines.md`

**Status**: COMPLETED

**Checklist**:

- [x] During implementation, update task statuses and checklists as work
      completes.
- [x] Record verification command outcomes in the progress log before handoff.
- [x] If implementation discovers stale docs outside `README.md`, record the
      file path and action in the progress log.

---

## Module Status

| Module                          | File Path                                                           | Status    | Tests             |
| ------------------------------- | ------------------------------------------------------------------- | --------- | ----------------- |
| Compact structure text renderer | `src/cli.ts`                                                        | COMPLETED | `src/cli.test.ts` |
| CLI regression coverage         | `src/cli.test.ts`                                                   | COMPLETED | `src/cli.test.ts` |
| User documentation              | `README.md`                                                         | COMPLETED | Manual review     |
| Progress tracking               | `impl-plans/active/workflow-inspect-structure-description-lines.md` | COMPLETED | n/a               |

## Task Breakdown

### TASK-001: Render Two Physical Lines Per Compact Structure Row

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `src/cli.ts`
**Dependencies**: None

**Description**:
Update only the compact text renderer so each derived structure row becomes an
id line followed by one deeper-indented description line.

Completion criteria:

- [x] `workflow inspect <name> --structure` prints each step id on its own
      line.
- [x] Each description is printed on the next line one compact indent unit
      deeper than its id line.
- [x] Existing row order and row indentation from `deriveWorkflowStructureRows`
      are unchanged.
- [x] Empty workflow output remains `(none)`.
- [x] Non-json compact structure path still avoids `buildInspectionSummary`.

### TASK-002: Update Focused CLI Tests

**Status**: COMPLETED
**Parallelizable**: Yes
**Deliverables**: `src/cli.test.ts`
**Dependencies**: None

**Description**:
Update and extend CLI assertions for the accepted two-line compact structure
contract while retaining fast-path and JSON preservation coverage.

Completion criteria:

- [x] Existing compact output expectations change from `id description` to
      alternating id and indented description lines.
- [x] Missing or empty descriptions are asserted as indented `-` lines.
- [x] Fast-path spy coverage still proves `buildInspectionSummary` is not used
      for non-json `--structure`.
- [x] JSON preservation coverage remains full-summary JSON, not compact rows.

### TASK-003: Refresh README Command Guidance

**Status**: COMPLETED
**Parallelizable**: Yes
**Deliverables**: `README.md`
**Dependencies**: None

**Description**:
Refresh user-facing command guidance to match the accepted two-line compact
structure format.

Completion criteria:

- [x] README describes compact structure output as id lines followed by
      deeper-indented description lines.
- [x] README preserves compact fast-path explanation.
- [x] README preserves full JSON inspect guidance.

### TASK-004: Verify and Record Outcomes

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: progress-log update in this plan
**Dependencies**: TASK-001, TASK-002, TASK-003

**Description**:
Run focused verification and update the plan progress log with command outcomes
before implementation handoff.

Completion criteria:

- [x] Focused CLI tests pass.
- [x] Workflow inspect helper tests pass or are documented as unaffected.
- [x] Typecheck passes.
- [x] Manual example command confirms the displayed two-line shape.
- [x] Progress log records commands, results, and any remaining TODOs.

---

## Dependencies

| Feature                        | Depends On                                                          | Status    |
| ------------------------------ | ------------------------------------------------------------------- | --------- |
| Compact two-line rendering     | Existing `renderWorkflowStructureLines` in `src/cli.ts`             | Available |
| Row order and indentation      | Existing `deriveWorkflowStructureRows` in `src/workflow/inspect.ts` | Available |
| Fast-path preservation         | Existing compact inspect routing in `src/cli.ts`                    | Available |
| Missing-description dash value | Existing row derivation normalization                               | Available |
| Documentation refresh          | Accepted design in `design-docs/specs/command.md`                   | Available |

## Parallelizable Tasks

- `TASK-002` can be prepared in parallel with `TASK-001` because it writes only
  `src/cli.test.ts`; final success depends on the renderer change.
- `TASK-003` can be prepared in parallel with implementation because it writes
  only `README.md`.
- `TASK-004` is not parallelizable because verification depends on all code,
  test, and documentation changes.

## Verification Plan

- `bun test src/cli.test.ts -t "workflow inspect --structure"`
- `bun test src/workflow/inspect.test.ts`
- `bun run tsc --noEmit`
- `bun run src/main.ts workflow inspect claude-divedra-codex-coding --workflow-definition-dir ./examples --structure`
- `bun run src/main.ts workflow inspect claude-divedra-codex-coding --workflow-definition-dir ./examples --structure --output json`
- `git diff --check -- src/cli.ts src/cli.test.ts README.md impl-plans/active/workflow-inspect-structure-description-lines.md`

## Completion Criteria

- [x] Compact text `workflow inspect <name> --structure` emits two lines per
      logical step row.
- [x] Description lines are exactly one compact indent unit deeper than their id
      lines.
- [x] Missing or empty descriptions render as `-` on the description line.
- [x] Compact traversal/order semantics are unchanged.
- [x] Non-json compact fast path still avoids `buildInspectionSummary`.
- [x] `--structure --output json` remains full inspection JSON.
- [x] Default `workflow inspect` behavior remains detailed inspect output.
- [x] README and implementation plan progress log are updated.
- [x] Focused tests and typecheck pass.

## Progress Log

### Session: 2026-05-13 Step 4 Implementation Plan Creation

**Tasks Completed**: Plan created after accepted Step 3 design review.

**Notes**: No Step 5 review feedback exists for this first Step 4 run. The
implementation step should update this log after code, test, docs, and
verification work.

### Session: 2026-05-13 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004.

**Notes**: Updated compact non-json `workflow inspect --structure` text
rendering so each derived row emits an id line followed by a one-level-deeper
description line. Updated focused CLI tests for the two-line shape, preserved
the fast-path spy assertion, added loader-valid missing-description dash
coverage, refreshed README wording, and updated this progress log. Empty
description normalization remains covered by `src/workflow/inspect.test.ts`
because empty strings are rejected by workflow validation before CLI rendering.

**Verification**:

- `bun test src/cli.test.ts -t "workflow inspect --structure"`: passed.
- `bun test src/workflow/inspect.test.ts`: passed.
- `bun run typecheck`: passed.
- `bun run lint:biome`: passed with pre-existing warnings outside touched code.
- `bun run src/main.ts workflow inspect claude-divedra-codex-coding --workflow-definition-dir ./examples --structure`: passed and showed two-line compact rows.
- `bun run src/main.ts workflow inspect claude-divedra-codex-coding --workflow-definition-dir ./examples --structure --output json`: passed and emitted full inspection JSON.
- `git diff --check -- src/cli.ts src/cli.test.ts README.md impl-plans/active/workflow-inspect-structure-description-lines.md`: passed.
