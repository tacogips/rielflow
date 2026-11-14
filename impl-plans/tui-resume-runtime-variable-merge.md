# TUI Resume Runtime Variable Merge Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-tui.md#failure-and-recovery, design-docs/specs/command.md#subcommands
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Previous**: `impl-plans/workflow-tui-resume-decoupling.md`
- **Current Plan**: `impl-plans/tui-resume-runtime-variable-merge.md`

## Design Document Reference

**Source**:

- `design-docs/specs/design-tui.md`
- `design-docs/specs/command.md`

### Summary

This corrective slice aligns `divedra tui --resume-session` with the TUI recovery intent:

- resumed TUI runs must preserve the persisted session runtime variables,
- `--variables` must layer additive overrides onto that persisted runtime state,
- regression coverage must prove the resumed session keeps both old and new values.

### Scope

**Included**:

- TUI resume runtime-variable merge behavior in `src/cli.ts`
- regression coverage in `src/cli.test.ts`
- plan/index bookkeeping

**Excluded**:

- `session resume` command behavior changes
- interactive TUI prompt flow changes
- workflow engine runtime-variable semantics

## Modules

### 1. TUI Resume Variable Merge

#### `src/cli.ts`, `src/cli.test.ts`

**Status**: COMPLETED

```typescript
interface ResumedTuiRuntimeVariables extends Record<string, unknown> {
  readonly resumedFromSessionId: string;
}
```

**Checklist**:

- [x] resumed TUI runs start from persisted `session.runtimeVariables`
- [x] `--variables` values override or extend the persisted runtime variables
- [x] `resumedFromSessionId` remains injected for resumed runs
- [x] regression test proves persisted values survive the resume path

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| TUI resume variable merge | `src/cli.ts`, `src/cli.test.ts` | COMPLETED | Passing |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| TUI resume variable preservation | Existing session persistence | READY |
| Regression coverage | TUI resume variable preservation | READY |

## Tasks

### TASK-001: Preserve Persisted Runtime Variables on TUI Resume

**Status**: Completed
**Parallelizable**: No

**Deliverables**:

- `src/cli.ts`
- `src/cli.test.ts`

**Completion Criteria**:

- [x] TUI resume reads persisted runtime variables from the saved session
- [x] `--variables` merges on top during TUI resume
- [x] targeted CLI regression test passes

## Completion Criteria

- [x] Resumed TUI sessions preserve previous runtime state
- [x] Additive `--variables` overrides still work
- [x] Targeted tests pass

## Progress Log

### Session: 2026-03-15 14:30 JST
**Tasks Completed**: TASK-001
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The GraphQL manager-control work matched the intended design, but the current worktree review found a separate resume-path regression in the TUI: resumed runs were rebuilding runtime variables from only `--variables` plus `resumedFromSessionId`, dropping the persisted session state. This slice restores additive merge semantics.
