# Editor Action Helpers Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-editor-action-helpers.md, design-docs/specs/architecture.md#browser-workflow-editor-svelte
**Created**: 2026-03-10
**Last Updated**: 2026-03-10

## Summary

Extract the browser editor's async command orchestration from `ui/src/App.svelte` into a frontend-owned helper module under `ui/src/lib/`.

## Scope

Included:

- design update for the extraction boundary
- action-helper module under `ui/src/lib/`
- `ui/src/App.svelte` migration away from inline async command orchestration where safe
- focused unit tests for command result shaping and loader composition
- repository typecheck verification

Not included:

- component/store decomposition
- server route refactoring
- browser verification beyond existing environment constraints

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-refactoring-editor-action-helpers.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record the remaining async command concentration in `ui/src/App.svelte`
- [x] Define the frontend action-helper module as the next extraction boundary

### 2. Frontend Action Helper Extraction

#### `ui/src/lib/editor-actions.ts`, `ui/src/App.svelte`

**Status**: COMPLETED

```ts
export function createEditorActions(
  deps?: EditorActionDependencies,
): EditorActions;
```

**Checklist**:
- [x] Move async bootstrap/select/create/save/execute/cancel composition out of `ui/src/App.svelte`
- [x] Keep Svelte-local state application and polling ownership in the component
- [x] Centralize validation summary and command success message shaping

### 3. Verification

#### `ui/src/lib/editor-actions.test.ts`, `ui/src/App.svelte`

**Status**: COMPLETED

**Checklist**:
- [x] Add focused unit tests for the extracted action helpers
- [x] Run `bun run typecheck:server`
- [x] Run `bun run typecheck:ui`
- [x] Run `bun test ui/src/lib/editor-actions.test.ts ui/src/lib/editor-state.test.ts ui/src/lib/editor-field-updates.test.ts ui/src/lib/editor-execution.test.ts`
- [x] Run `bun run build:ui`

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Frontend action helper extraction | editor API client, editor data loaders, editor support helpers, editor execution helpers | READY |
| Verification | frontend action helper extraction | COMPLETED |

## Completion Criteria

- [x] Design document exists for this refactoring slice
- [x] `ui/src/App.svelte` no longer owns the extracted async command orchestration block
- [x] Frontend command/result orchestration is centralized in one helper module
- [x] Focused action-helper tests pass
- [x] Repository typechecks pass
- [x] UI build passes

## Progress Log

### Session: 2026-03-10 01:05
**Tasks Completed**: Design assessment, implementation plan creation
**Tasks In Progress**: Frontend action helper extraction, verification
**Blockers**: None
**Notes**: Continuation review confirmed that the overall local-server plus replaceable-frontend architecture still matches the intended purpose, so no architecture rewrite was needed. The remaining maintainability mismatch is that `ui/src/App.svelte` still owns most async command orchestration even after transport/data/state helper extraction, so this slice introduces a frontend-owned action boundary for those flows.

### Session: 2026-03-10 01:25
**Tasks Completed**: Frontend action helper extraction, focused tests, repository typechecks
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` still requires a real Node.js binary in PATH, which is not available in this shell
**Notes**: Added `ui/src/lib/editor-actions.ts` as the command-orchestration boundary for bootstrap, workflow selection, workflow creation, validation, save, execution, and cancellation flows. `ui/src/App.svelte` now applies returned state and keeps only Svelte-local lifecycle, polling, flags, and DOM event wiring. Added `ui/src/lib/editor-actions.test.ts` and re-ran `bun run typecheck:server`, `bun run typecheck:ui`, and focused Bun tests successfully.

### Session: 2026-03-10 01:55
**Tasks Completed**: Continuation cleanup for polling-path action orchestration
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` still requires a real Node.js binary in PATH, which is not available in this shell
**Notes**: Continuation review found that `ui/src/App.svelte` still imported `loadWorkflowSessionPanelState(...)` directly for selected-session polling, which left one remaining session reload path outside the extracted action-helper boundary. Extended `editorActions.selectSession(...)` with an explicit `allowPollingOnSelectedSession` option, routed the polling reload through that helper, and added a focused regression test so the component remains responsible only for timer ownership while session reload orchestration stays centralized.

### Session: 2026-03-09 14:01
**Tasks Completed**: Continuation cleanup for component-level async action scaffolding
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` still requires a real Node.js binary in PATH, which is not available in this shell
**Notes**: Follow-up review found that `ui/src/App.svelte` still repeated the same busy/message/error wrapper around validate, save, refresh-session, select-session, execute, create, and workflow-refresh actions even after the action-helper extraction. Added shared component-local async action scaffolding and a workflow-picker state applicator so the component remains the Svelte state owner but no longer duplicates that orchestration shell. Re-ran `bun run typecheck:ui` plus the focused Bun test suite covering editor actions, state, execution, field updates, and touched server API helpers.

### Session: 2026-03-10 10:35
**Tasks Completed**: TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation verification reran `bun run typecheck:server`, `bun run typecheck:ui`, the focused Bun test suite for action/state/execution helpers and touched server helpers, plus `bun run build:ui` successfully in the current shell, so the editor action helpers slice is now complete.
