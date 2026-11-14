# Workflow TUI CLI Parity Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-tui.md`
**Created**: 2026-02-25
**Last Updated**: 2026-02-25

## Scope

Align `divedra tui` command-line surface with design startup forms.

In scope:
- `divedra tui --workflow <name>` support
- conflict handling when both positional workflow name and `--workflow` are given
- tests and docs updates

Out of scope:
- changes to runtime execution engine
- additional UI behavior beyond startup routing

## Tasks

### TASK-001: Add `--workflow` option support
**Status**: Completed  
**Parallelizable**: Yes  
**Dependencies**: None

**Deliverables**:
- `src/cli.ts`
- `src/cli.test.ts`

**Completion Criteria**:
- [x] `--workflow <name>` is parsed for `tui`
- [x] `tui` resolves workflow name from either positional or flag
- [x] conflicting positional and flag values return argument error
- [x] tests cover success and conflict paths

### TASK-002: Docs/help sync
**Status**: Completed  
**Parallelizable**: Yes  
**Dependencies**: TASK-001

**Deliverables**:
- `src/cli.ts` help text
- `README.md`

**Completion Criteria**:
- [x] help text includes `--workflow`
- [x] README TUI usage includes `--workflow`

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| TUI CLI parsing | `src/cli.ts` | COMPLETED | `src/cli.test.ts` |
| TUI docs/help | `README.md` | COMPLETED | - |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| TASK-002 docs/help sync | TASK-001 | COMPLETED |

## Completion Criteria

- [x] All plan tasks completed
- [x] `bun run test` passes
- [x] `bun run typecheck` passes
- [x] Plan moved to `impl-plans/completed/`

## Progress Log

### Session: 2026-02-25 23:00
**Tasks Completed**: TASK-001, TASK-002  
**Tasks In Progress**: None  
**Blockers**: None  
**Notes**: Implemented `--workflow` startup parity and argument conflict handling with tests.
