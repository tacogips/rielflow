# Workflow CLI MVP Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/command.md#subcommands, design-docs/specs/command.md#exit-codes, design-docs/specs/design-workflow-json.md#workflow-directory-structure
**Created**: 2026-02-23
**Last Updated**: 2026-02-23

---

## Design Document Reference

**Source**:
- `design-docs/specs/command.md`
- `design-docs/specs/design-workflow-json.md`

### Summary
Implemented CLI MVP commands: `workflow create`, `workflow validate`, `workflow inspect`, with deterministic exit codes and integration against the core loader/validator.

### Scope
**Included**:
- Main command parser and dispatcher
- `workflow create <name>` template scaffolding
- `workflow validate <name>` validation output and exit code mapping
- `workflow inspect <name>` normalized summary output

**Excluded**:
- `workflow run`, `session *`, `serve`, and `tui`
- Execution engine and session persistence

---

## Tasks

### TASK-001: CLI Dispatcher Foundation
**Status**: Completed
**Parallelizable**: No
**Dependencies**: workflow-core-and-validation:TASK-003
**Deliverables**:
- `src/cli.ts`
- `src/main.ts`

**Completion Criteria**:
- [x] Supports `workflow create|validate|inspect <name>`
- [x] Supports `--workflow-root`, `--artifact-root`, `--output`
- [x] Returns process-style exit code from command handlers

**Verification Criteria**:
- [x] Unknown commands return code `1` with help text
- [x] Missing args return code `2`

**Test Content**:
- [x] Unit tests for argument parsing and dispatch behavior

### TASK-002: Workflow Create Command
**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-001
**Deliverables**:
- `src/workflow/create.ts`

**Completion Criteria**:
- [x] Creates workflow directory and required files
- [x] Prevents path traversal and invalid names
- [x] Creates minimal valid template files (`workflow.json`, `workflow-vis.json`, node files)

**Verification Criteria**:
- [x] Created directory validates successfully via core validator
- [x] Existing workflow directory returns deterministic error

**Test Content**:
- [x] Temp-directory integration test for create+validate roundtrip

### TASK-003: Validate and Inspect Command Handlers
**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-001, workflow-core-and-validation:TASK-004
**Deliverables**:
- `src/workflow/inspect.ts`
- Command-handler sections in `src/cli.ts`

**Completion Criteria**:
- [x] Validate command prints errors/warnings in text and json output modes
- [x] Validate command maps invalid workflow to exit code `2`
- [x] Inspect command prints normalized graph/default summary

**Verification Criteria**:
- [x] Inspect output contains defaults, manager node, node count, and edge count
- [x] Validate output stable for assertions

**Test Content**:
- [x] CLI-level tests for validate success/failure
- [x] CLI-level tests for inspect output fields

### TASK-004: CLI Test Coverage and Reliability Checks
**Status**: Completed
**Parallelizable**: Yes
**Dependencies**: TASK-002, TASK-003
**Deliverables**:
- `src/cli.test.ts`

**Completion Criteria**:
- [x] Tests cover success/failure exit codes
- [x] Tests cover json/text output modes for validation
- [x] Tests cover create -> inspect roundtrip

**Verification Criteria**:
- [x] `bun run test` passes
- [x] `bun run typecheck` passes

**Test Content**:
- [x] Integration-style tests using temporary workflow roots

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| CLI dispatcher | `src/cli.ts` | COMPLETED | `cli.test.ts` |
| Entry point | `src/main.ts` | COMPLETED | `cli.test.ts` |
| Create command | `src/workflow/create.ts` | COMPLETED | `cli.test.ts` |
| Inspect command | `src/workflow/inspect.ts` | COMPLETED | `cli.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| TASK-001 CLI base | `workflow-core-and-validation:TASK-003` | SATISFIED |
| TASK-002 Create | TASK-001 | SATISFIED |
| TASK-003 Validate/Inspect | TASK-001 + `workflow-core-and-validation:TASK-004` | SATISFIED |
| TASK-004 CLI tests | TASK-002, TASK-003 | SATISFIED |

## Completion Criteria

- [x] All tasks marked completed
- [x] `bun run typecheck` passes
- [x] `bun run test` passes
- [x] Exit-code mapping verified via tests

## Progress Log

### Session: 2026-02-23 00:22
**Tasks Completed**: TASK-001, TASK-002
**Tasks In Progress**: TASK-003
**Blockers**: None
**Notes**: Added CLI dispatch and workflow template creation command.

### Session: 2026-02-23 00:24
**Tasks Completed**: TASK-003, TASK-004
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Completed inspect/validate handlers and CLI test coverage.

## Related Plans

- **Previous**: `impl-plans/completed/workflow-core-and-validation.md`
- **Next**: N/A
- **Depends On**: `workflow-core-and-validation.md`
