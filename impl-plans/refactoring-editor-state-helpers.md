# Editor State Helpers Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-editor-state-helpers.md, design-docs/specs/architecture.md#browser-workflow-editor-svelte
**Created**: 2026-03-09
**Last Updated**: 2026-03-10

## Summary

Extract the browser editor's workflow/session state-transition helpers from `ui/src/App.svelte` into a frontend-owned helper module under `ui/src/lib/`.

## Scope

Included:

- design record for the extraction
- editor state helper module under `ui/src/lib/`
- `ui/src/App.svelte` migration away from local workflow/session reset and selection-reconciliation helpers
- fix for stale validation state surviving workflow creation/loading
- repository typecheck verification

Not included:

- component/store decomposition
- server route refactoring
- workflow schema changes

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-refactoring-editor-state-helpers.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record the remaining state-transition responsibility concentration in `ui/src/App.svelte`
- [x] Define the frontend state helper module as the next extraction boundary

### 2. Frontend State Helper Extraction

#### `ui/src/lib/editor-state.ts`, `ui/src/App.svelte`

**Status**: COMPLETED

```ts
export interface WorkflowEditorState {
  readonly workflow: WorkflowResponse | null;
  readonly editableBundle: EditorWorkflowBundle | null;
}
```

**Checklist**:
- [x] Move workflow/session reset helpers out of `ui/src/App.svelte`
- [x] Centralize loaded-workflow and selected-node reconciliation helpers
- [x] Centralize workflow-scoped session filtering and selection cleanup
- [x] Fix stale validation state after workflow create/load transitions

### 3. Verification

#### `ui/src/App.svelte`, `ui/src/lib/editor-state.ts`

**Status**: COMPLETED

**Checklist**:
- [x] Run `bun run typecheck:server`
- [x] Run `bun run typecheck:ui`
- [x] Run `bun run build:ui`

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Frontend state helper extraction | shared workflow types, API client, workflow operations, support helpers | COMPLETED |
| Verification | frontend state helper extraction | COMPLETED |

## Completion Criteria

- [x] Design document exists for this refactoring slice
- [x] `ui/src/App.svelte` no longer owns the extracted workflow/session state helpers
- [x] Frontend workflow/session state transitions are centralized in one helper module
- [x] Repository typechecks pass
- [x] UI build passes

## Progress Log

### Session: 2026-03-09 16:30
**Tasks Completed**: Design assessment, implementation plan creation
**Tasks In Progress**: Frontend state helper extraction
**Blockers**: None
**Notes**: Continuation review found that the high-level architecture still matches the intended local-server plus replaceable-frontend design, but `ui/src/App.svelte` still owns repeated workflow/session state-transition logic and inconsistent reset paths. This slice extracts those pure transitions and fixes the stale-validation path discovered during workflow create/load review.

### Session: 2026-03-09 16:45
**Tasks Completed**: Frontend state helper extraction, repository typechecks
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` fails fast because this environment does not expose a real Node.js binary in PATH
**Notes**: Added `ui/src/lib/editor-state.ts` for empty workflow/session state factories, loaded-workflow adaptation, selected-node reconciliation, and workflow-scoped session filtering. `ui/src/App.svelte` now delegates those transitions to the helper module, and workflow create/load paths explicitly clear stale validation state. `bun run typecheck:server` and `bun run typecheck:ui` both pass after the extraction.

### Session: 2026-03-10 10:35
**Tasks Completed**: Verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation verification reran `bun run typecheck:server`, `bun run typecheck:ui`, and `bun run build:ui` successfully in the current shell, so the editor state helpers slice is now complete.

## Related Plans

- **Previous**: `impl-plans/refactoring-editor-support-helpers.md`
- **Next**: none yet
- **Depends On**: `impl-plans/refactoring-editor-support-helpers.md`
