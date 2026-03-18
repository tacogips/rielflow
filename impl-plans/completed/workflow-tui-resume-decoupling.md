# Workflow TUI Resume Decoupling Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-tui.md`
**Created**: 2026-02-25
**Last Updated**: 2026-02-25

## Scope

Ensure `divedra tui --resume-session <id>` is independent from workflow directory listing.

## Tasks

### TASK-001: Resume path pre-check routing
**Status**: Completed  
**Parallelizable**: Yes  
**Dependencies**: None

**Deliverables**:
- `src/cli.ts`
- `src/cli.test.ts`

**Completion Criteria**:
- [x] resume path executes before workflow listing
- [x] workflow-listing gate is bypassed for resume path
- [x] missing workflow definition surfaces execution error (not workflow-listing precheck)
- [x] tests cover resume with empty workflow root

## Completion Criteria

- [x] `bun run typecheck` passes
- [x] `bun run test` passes
- [x] Plan moved to `impl-plans/completed/`

## Progress Log

### Session: 2026-02-25 23:20
**Tasks Completed**: TASK-001  
**Tasks In Progress**: None  
**Blockers**: None  
**Notes**: Reordered TUI runtime routing so resume-session bypasses workflow discovery.
