# TUI Screen Transition Manager Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-tui.md#panel-interaction-consistency, design-docs/specs/design-tui.md#human-input-handling
**Created**: 2026-03-26
**Last Updated**: 2026-03-26

## Related Plans

- **Previous**: `impl-plans/tui-workflow-browser-and-json-input.md`
- **Previous**: `impl-plans/tui-workflow-definition-screen.md`
- **Depends On**: `impl-plans/tui-workflow-browser-and-json-input.md`

## Design Document Reference

**Source**:

- `design-docs/specs/design-tui.md`

### Summary

Refactor the OpenTUI navigation state so `screen`, `focus pane`, `detail mode`, and related return-path state can be passed around as one typed interface. Add a transition manager that resolves shortcut-driven screen changes from explicit `before` state plus a key/navigation intent into a typed `after` transition result, and drive both footer/help shortcut output from the same shortcut metadata so navigation help is not maintained separately.

### Scope

**Included**:

- a framework-neutral navigation state interface for OpenTUI screen/focus/detail state
- transition-resolution helpers that accept typed state input instead of loose scalar arguments
- shortcut/help metadata shared by footer rendering and help-popup rendering
- runtime wiring so key handling routes through the transition manager for screen/focus changes
- focused regression coverage for shortcut-driven transition results

**Excluded**:

- visual redesign of the TUI
- changes to non-navigation workflow execution semantics
- web UI changes

## Modules

### 1. Navigation State Types

#### `src/tui/opentui-model/types.ts`

**Status**: COMPLETED

```typescript
interface OpenTuiNavigationState {
  readonly detailMode: DetailMode;
  readonly detailReturnPane: DetailReturnPane;
  readonly editingInput: boolean;
  readonly focusPane: FocusPane;
  readonly historyViewMode: HistoryViewMode;
  readonly screenMode: ScreenMode;
}
```

**Checklist**:

- [x] Add a shared navigation-state interface
- [x] Keep the state shape aligned with current TUI guardrails
- [x] Export types for model/runtime/test use

### 2. Transition Manager Helpers

#### `src/tui/opentui-model/navigation.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Refactor shortcut transition helpers to accept the shared navigation state
- [x] Return typed transition results with explicit `before`/`after` semantics where appropriate
- [x] Preserve current `h` / `l`, `enter` / `ctrl-m`, and `esc` invariants
- [x] Derive footer/help shortcut text from shared shortcut metadata

### 3. Runtime Wiring and Regression Tests

#### `src/tui/opentui-screen/runtime.ts`, `src/tui/opentui-screen.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Runtime reads current navigation state through one helper
- [x] Runtime applies transition results without duplicating state derivation logic
- [x] Focused tests cover shortcut-driven `before` -> `after` transitions
- [x] `bun test src/tui/opentui-screen.test.ts`
- [x] `bun run typecheck`

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Navigation state types | `src/tui/opentui-model/types.ts` | COMPLETED | - |
| Transition manager helpers | `src/tui/opentui-model/navigation.ts`, `src/tui/opentui-model/pane.ts` | COMPLETED | `src/tui/opentui-screen.test.ts`, `src/tui/opentui-screen-navigation.test.ts` |
| Runtime wiring | `src/tui/opentui-screen/runtime.ts` | COMPLETED | `src/tui/opentui-screen.test.ts`, `src/tui/opentui-screen-runtime.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Typed navigation state | Existing `ScreenMode` / `FocusPane` / `DetailMode` model types | READY |
| Runtime key wiring | Typed transition helpers | COMPLETED |
| Regression verification | Runtime wiring | COMPLETED |

## Tasks

### TASK-001: Introduce a shared navigation-state interface

**Status**: Completed
**Parallelizable**: No

**Deliverables**:

- `src/tui/opentui-model/types.ts`

**Completion Criteria**:

- [x] A single interface represents screen/focus/detail navigation state
- [x] Existing helper call sites can consume the shared type without widening to `any`

### TASK-002: Refactor navigation helpers into a transition manager surface

**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-001

**Deliverables**:

- `src/tui/opentui-model/navigation.ts`

**Completion Criteria**:

- [x] Directional advance/revert helpers accept the shared navigation state
- [x] Escape and detail transitions resolve through the shared state shape
- [x] Status strings remain compatible with current TUI behavior
- [x] Footer/help shortcut text comes from shared shortcut metadata

### TASK-003: Wire runtime to the shared state and verify behavior

**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-001, TASK-002

**Deliverables**:

- `src/tui/opentui-screen/runtime.ts`
- `src/tui/opentui-screen.test.ts`

**Completion Criteria**:

- [x] Runtime exposes current navigation state through one helper
- [x] Shortcut handlers use the shared state for transition resolution
- [x] Focused navigation tests pass
- [x] `bun run typecheck` passes

## Completion Criteria

- [x] Navigation state is represented by a shared interface
- [x] Shortcut-driven screen/focus transitions resolve through typed helpers
- [x] Runtime key handling uses the new transition manager surface
- [x] Help/footer shortcut output is derived from shared shortcut metadata
- [x] `bun test src/tui/opentui-screen.test.ts` passes
- [x] `bun run typecheck` passes

## Progress Log

### Session: 2026-03-26 23:59 JST

**Tasks Completed**: Plan creation, codebase review
**Tasks In Progress**: TASK-001, TASK-002
**Blockers**: None
**Notes**: The current OpenTUI implementation already has reusable navigation action types, but state is still split across several local runtime variables. This plan narrows the refactor to a typed navigation-state interface plus helper consolidation so shortcut resolution can reason from explicit `before` state rather than ad hoc parameter bundles.

### Session: 2026-03-27 00:22 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added `OpenTuiNavigationState` and shared shortcut metadata types, refactored navigation helpers to consume typed navigation snapshots, and introduced shared shortcut-section rendering so the help popup and footer row are generated from one source. Updated runtime wiring to build a single navigation snapshot for transition/help resolution and refreshed focused TUI tests. Verified with `bun test src/tui/opentui-screen.test.ts src/tui/opentui-screen-navigation.test.ts src/tui/opentui-screen-runtime.test.ts`, `bun run typecheck`, and `git diff --check`.
