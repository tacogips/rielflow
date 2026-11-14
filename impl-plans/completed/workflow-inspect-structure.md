# Workflow Inspect Structure Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/command.md#subcommands`
**Created**: 2026-05-13
**Last Updated**: 2026-05-13

---

## Design Document Reference

**Source**: `design-docs/specs/command.md`

### Summary

Add compact indented structure output to the existing
`workflow inspect <name>` command through a `--structure` flag. The compact
view is human-facing text and prints only each canonical step id plus its
description. Indentation comes from the normalized workflow visualization
semantics where structure is derivable.

### Scope

**Included**: CLI parsing for `--structure`, text rendering for compact
structure output, reuse of workflow visualization indentation, focused CLI and
workflow-rendering coverage, README command documentation.

**Excluded**: New duplicate workflow structure command, changes to default
detailed inspect output, reduced JSON inspection output, GraphQL schema changes,
TUI changes, or invented hierarchy for graph shapes without derived nesting.

---

## Modules

### 1. CLI Option Parsing

#### `src/cli.ts`

**Status**: COMPLETED

```typescript
interface ParsedCliOptions {
  readonly structure: boolean;
}
```

**Checklist**:

- [x] Parse `--structure` as a boolean option with default `false`
- [x] Preserve existing `--output json|text|table` validation
- [x] Keep `--output json` as the full inspection summary even when
      `--structure` is present
- [x] Add help text for `workflow inspect <name> --structure`

### 2. Structure Row Derivation

#### `src/workflow/inspect.ts`

**Status**: COMPLETED

```typescript
interface WorkflowStructureRow {
  readonly stepId: string;
  readonly description: string;
  readonly indent: number;
}
```

**Checklist**:

- [x] Add a small structure-row helper or extend inspection summary data without
      changing the JSON contract unexpectedly
- [x] Derive rows from canonical workflow steps in step-addressed order
- [x] Fill missing or empty descriptions with `-`
- [x] Reuse `deriveWorkflowVisualization` indentation by step id
- [x] Fall back to base indent when visualization has no row for a step

### 3. Text Rendering

#### `src/cli.ts`

**Status**: COMPLETED

```typescript
interface WorkflowStructureRenderOptions {
  readonly indentUnit: string;
}
```

**Checklist**:

- [x] When `--structure` and text output are selected, print only compact
      structure rows
- [x] Render each row as `<indent><stepId> <description>`
- [x] Omit roles, runtime readiness, registry ids, callable contracts,
      transition labels, variables examples, and timeout/default details
- [x] Keep empty workflows readable with the existing `(none)` convention

### 4. Regression Tests

#### `src/cli.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Cover `workflow inspect <name> --structure` text output for a linear
      workflow
- [x] Assert compact structure output excludes role/runtime/node-registry
      details
- [x] Cover missing or empty descriptions rendering as `-`
- [x] Cover `--structure --output json` preserving full JSON inspection output

#### `src/workflow/inspect.test.ts` or `src/workflow/visualization.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Cover row indentation mapped from visualization loop scopes
- [x] Cover fallback base indentation for shapes without derived nesting

### 5. User-Facing Documentation

#### `README.md`

**Status**: COMPLETED

**Checklist**:

- [x] Add an example for compact workflow structure inspection
- [x] Keep the existing detailed JSON inspect example

---

## Module Status

| Module                   | File Path                 | Status    | Tests                          |
| ------------------------ | ------------------------- | --------- | ------------------------------ |
| CLI option parsing       | `src/cli.ts`              | COMPLETED | `src/cli.test.ts`              |
| Structure row derivation | `src/workflow/inspect.ts` | COMPLETED | `src/workflow/inspect.test.ts` |
| Compact text rendering   | `src/cli.ts`              | COMPLETED | `src/cli.test.ts`              |
| User documentation       | `README.md`               | COMPLETED | Manual command check           |

## Task Breakdown

### TASK-001: Parse and Route `--structure`

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `src/cli.ts`
**Depends On**: Accepted design in `design-docs/specs/command.md`

Completion criteria:

- [x] `parseArgs` records `structure: boolean`
- [x] `workflow inspect` dispatch can distinguish compact text output from
      detailed inspect output
- [x] `--structure --output json` keeps JSON behavior unchanged

### TASK-002: Derive Compact Structure Rows

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `src/workflow/inspect.ts`
**Depends On**: TASK-001 only for final integration; can be designed against
existing workflow summary and visualization helpers

Completion criteria:

- [x] Rows use canonical step ids and step descriptions only
- [x] Indent is sourced from `deriveWorkflowVisualization`
- [x] Missing and empty descriptions render as `-`

### TASK-003: Render Compact Inspect Text

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `src/cli.ts`
**Depends On**: TASK-001, TASK-002

Completion criteria:

- [x] `workflow inspect <name> --structure` prints only compact rows
- [x] Detailed inspect text remains the default without `--structure`
- [x] Empty workflow steps keep a readable `(none)` line

### TASK-004: Add Focused Tests

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-001 through TASK-003 APIs are stable
**Deliverables**: `src/cli.test.ts`, optional `src/workflow/inspect.test.ts`
**Depends On**: TASK-001, TASK-002, TASK-003

Completion criteria:

- [x] CLI tests cover compact structure output and omitted details
- [x] JSON preservation is tested
- [x] Indentation behavior is tested through workflow helper or CLI fixture

### TASK-005: Document Operator Usage

**Status**: COMPLETED
**Parallelizable**: Yes
**Deliverables**: `README.md`
**Depends On**: Accepted command surface from design; final wording should match
implemented output

Completion criteria:

- [x] README shows `workflow inspect <name> --structure`
- [x] README still points detailed inspection users to `--output json`

---

## Dependencies

| Feature                   | Depends On                                                                                            | Status    |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | --------- |
| Compact structure flag    | Existing `workflow inspect` parser and renderer in `src/cli.ts`                                       | Available |
| Structure indentation     | Existing `deriveWorkflowVisualization` in `src/workflow/visualization.ts`                             | Available |
| Step ids and descriptions | Existing `deriveWorkflowStepSummaries` in `src/workflow/inspect.ts`                                   | Available |
| Documentation update      | Accepted design doc lines `design-docs/specs/command.md:33-36` and `design-docs/specs/command.md:140` | Available |

## Verification Plan

- [x] `bun test src/cli.test.ts -t "workflow inspect --structure"`
- [x] `bun test src/workflow/inspect.test.ts`
- [x] `bun run test`
- [x] `bun run src/main.ts workflow inspect claude-divedra-codex-coding --workflow-definition-dir ./examples --structure`
- [x] `bun run src/main.ts workflow inspect workflow-call-simple --workflow-definition-dir ./examples --structure`
- [x] `bun run src/main.ts workflow inspect claude-divedra-codex-coding --workflow-definition-dir ./examples --structure --output json`
- [x] `bun run typecheck`

## Completion Criteria

- [x] Existing `workflow inspect <name>` detailed text output remains available
      without `--structure`
- [x] `workflow inspect <name> --structure` prints compact human-facing text
      containing only ids and descriptions
- [x] Indentation reflects derived visualization structure when available and
      stays flat otherwise
- [x] `--output json` remains the full machine-readable inspection summary
- [x] Focused tests and full type checking pass
- [x] README documents the compact structure command
- [x] Implementation step invokes the TypeScript coding agent for TypeScript
      edits and invokes the check-and-test-after-modify agent after TypeScript
      modifications, per AGENTS.md

## Progress Log

### Session: 2026-05-13

**Tasks Completed**: Created implementation plan from accepted Step 3 design
review.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Step 3 accepted the design with no high or mid findings. No
Codex-reference repository inputs were provided, so implementation should use
existing divedra command and workflow modules as the behavioral source.

### Session: 2026-05-13 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented `workflow inspect <name> --structure` as compact text
rows only, preserved full JSON inspection output with `--output json`, added
focused CLI and workflow helper coverage, and documented the new README usage.
The touched `src/cli.ts` and `src/cli.test.ts` files exceeded the preferred
source-file line target before this change; splitting them is outside this
issue scope. `bun run lint:biome` completed with pre-existing warnings outside
the touched workflow inspect files. An earlier `bun run test` failed only on
`src/hook/index.test.ts` with `hook recording failed: database is locked`; that
exact test passed when rerun in isolation, and a later full `bun run test`
passed.

### Session: 2026-05-13 Step 7 Revision

**Tasks Completed**: Addressed Step 7 mid finding by moving this completed plan
from `impl-plans/active/` to `impl-plans/completed/` and updating
`impl-plans/README.md` metadata.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Code changes were already accepted by Step 7; this revision only
corrected implementation-plan completion tracking.

### Session: 2026-05-13 Step 7 Indentation Revision

**Tasks Completed**: Addressed Step 7 mid finding for distinct step ids and
node ids in compact structure indentation.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: `deriveWorkflowStructureRows` now derives visualization indentation
from a step-addressed view of workflow nodes so repeat/loop indentation remains
addressable by step id. Added regression coverage where `steps[].id` differs
from `steps[].nodeId`. Full `bun run test` passed after this revision.

## Related Plans

- **Previous**: `impl-plans/completed/inline-workflow-variables-and-inspect-usage.md`
- **Next**: None; implementation tasks are complete
- **Depends On**: Accepted design update in `design-docs/specs/command.md`
