# Workflow TUI MVP Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-tui.md`
**Created**: 2026-02-25
**Last Updated**: 2026-02-25

## Scope

Implement a practical TUI MVP for `divedra tui` aligned with the design:
- start/resume execution from TUI command surface
- support non-interactive terminal fallback mode
- provide observable execution progress in terminal output
- keep TUI surface isolated for future `neo-blessed` integration

Out of scope for this plan:
- full multi-pane `neo-blessed` UI
- rich modal form schemas for human-input

## Tasks

### TASK-001: TUI command flow hardening
**Status**: Completed  
**Parallelizable**: Yes  
**Dependencies**: None

**Deliverables**:
- `src/cli.ts` (`tui` command behavior updates)
- `src/cli.test.ts` (coverage for fallback/resume flows)

**Completion Criteria**:
- [x] `--resume-session <id>` is accepted for `divedra tui`
- [x] non-interactive terminal fallback does not require readline prompts
- [x] execution still reports progress and terminal status
- [x] tests cover the new behavior

### TASK-002: TUI runtime adapter boundary
**Status**: Completed  
**Parallelizable**: Yes  
**Dependencies**: TASK-001

**Deliverables**:
- `src/tui/runtime.ts`
- `src/tui/runtime.test.ts`

**Completion Criteria**:
- [x] isolated interface for interactive screen runtime
- [x] clear fallback contract for non-interactive mode
- [x] tests for runtime mode selection

### TASK-003: Initial `neo-blessed` screen MVP
**Status**: Completed  
**Parallelizable**: No  
**Dependencies**: TASK-002

**Deliverables**:
- `src/tui/neo-blessed-screen.ts`
- optional integration wiring in `src/cli.ts`

**Completion Criteria**:
- [x] basic three-pane screen layout is created
- [x] keybindings include `q`, `j`, `k`, `enter`, `r`
- [x] workflow selection is possible in interactive mode

### TASK-004: TUI docs and command help sync
**Status**: Completed  
**Parallelizable**: Yes  
**Dependencies**: TASK-001

**Deliverables**:
- `README.md`
- `design-docs/user-qa/README.md` (if decisions changed)

**Completion Criteria**:
- [x] command examples include `--resume-session`
- [x] fallback behavior is documented

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| TUI command flow | `src/cli.ts` | COMPLETED | `src/cli.test.ts` |
| TUI runtime adapter | `src/tui/runtime.ts` | COMPLETED | `src/tui/runtime.test.ts` |
| Neo-blessed screen | `src/tui/neo-blessed-screen.ts` | COMPLETED | `src/tui/neo-blessed-screen.test.ts` |
| Docs sync | `README.md` | COMPLETED | - |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| TASK-002 runtime adapter | TASK-001 | COMPLETED |
| TASK-003 neo-blessed screen | TASK-002 | COMPLETED |
| TASK-004 docs sync | TASK-001 | COMPLETED |

## Completion Criteria

- [x] All plan tasks completed
- [x] `bun run test` passes
- [x] `bun run typecheck` passes
- [x] Plan moved to `impl-plans/completed/`

## Progress Log

### Session: 2026-02-25 21:20
**Tasks Completed**: TASK-001  
**Tasks In Progress**: None  
**Blockers**: None  
**Notes**: Added TUI resume-session and non-interactive fallback baseline before screen UI work. Verified with `bun run typecheck` and `bun run test`.

### Session: 2026-02-25 21:40
**Tasks Completed**: TASK-002  
**Tasks In Progress**: None  
**Blockers**: None  
**Notes**: Added `src/tui/runtime.ts` as mode selection boundary and wired `cli.ts` to use it. Added runtime mode selection tests.

### Session: 2026-02-25 21:45
**Tasks Completed**: TASK-004  
**Tasks In Progress**: None  
**Blockers**: None  
**Notes**: Updated README TUI interface docs to include `--resume-session` and non-interactive fallback behavior.

### Session: 2026-02-25 22:45
**Tasks Completed**: TASK-003  
**Tasks In Progress**: None  
**Blockers**: None  
**Notes**: Added `neo-blessed` screen adapter module with three-pane layout and keybindings (`q`, `j`, `k`, `enter`, `r`), integrated it into interactive `tui` workflow selection, and added selector utility tests.
