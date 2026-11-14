# Editor Component Boundary Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-editor-component-boundaries.md, design-docs/specs/design-workflow-web-editor.md#migration-strategy
**Created**: 2026-03-09
**Last Updated**: 2026-03-09

**Historical Note**: This plan documents the Svelte component-boundary extraction that was completed before the SolidJS migration plan existed. After SolidJS cutover, this file should be treated as historical implementation context rather than active frontend guidance.

## Summary

Extract the Svelte workflow editor's left and right side panels from `ui/src/App.svelte` into dedicated components, and move shared shell styling into one frontend-owned stylesheet.

## Scope

Included:

- design record for the new component boundary
- `WorkflowSidebar.svelte` extraction
- `ExecutionPanel.svelte` extraction
- shared editor-shell stylesheet extraction
- `ui/src/App.svelte` simplification to consume the new components
- repository typecheck/build verification

Not included:

- Svelte store introduction
- center editor panel decomposition
- server API changes

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-refactoring-editor-component-boundaries.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record the remaining component-level responsibility concentration in `ui/src/App.svelte`
- [x] Define the next safe Svelte component boundary

### 2. Component Extraction

#### `ui/src/lib/components/WorkflowSidebar.svelte`, `ui/src/lib/components/ExecutionPanel.svelte`, `ui/src/App.svelte`

**Status**: COMPLETED

```ts
export interface WorkflowSidebarProps {
  readonly workflows: readonly string[];
  readonly selectedWorkflowName: string;
}
```

**Checklist**:
- [x] Move the workflow picker/create/save/session-refresh sidebar markup out of `ui/src/App.svelte`
- [x] Move the execution/session panel markup out of `ui/src/App.svelte`
- [x] Keep async orchestration, polling timers, and editor state ownership in `ui/src/App.svelte`

### 3. Shared Styling Extraction

#### `ui/src/lib/editor-ui.css`

**Status**: COMPLETED

**Checklist**:
- [x] Move shared shell styles out of `ui/src/App.svelte`
- [x] Keep extracted components and the app shell on one shared styling contract

### 4. Verification

#### `ui/src/App.svelte`

**Status**: COMPLETED

**Checklist**:
- [x] Run `bun run typecheck:server`
- [x] Run `bun run typecheck:ui`
- [x] Run `bun test ui/src/lib/editor-actions.test.ts ui/src/lib/editor-state.test.ts ui/src/lib/editor-field-updates.test.ts ui/src/lib/editor-execution.test.ts`
- [x] Run `bun run build:ui`

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Component extraction | editor action/data/state/helper refactors | READY |
| Shared styling extraction | refactoring-server-ui-asset-serving | READY |
| Verification | component and styling extraction | COMPLETED |

## Completion Criteria

- [x] Design document exists for this refactoring slice
- [x] `ui/src/App.svelte` no longer owns the workflow sidebar markup
- [x] `ui/src/App.svelte` no longer owns the execution/session sidebar markup
- [x] Shared editor-shell styles are centralized in one stylesheet
- [x] Repository typechecks pass
- [x] UI build passes

## Progress Log

### Session: 2026-03-09 14:30
**Tasks Completed**: Design assessment, implementation plan creation, component extraction, shared styling extraction, verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation review confirmed that the overall architecture still matches the intended local-server plus replaceable-frontend design, but `ui/src/App.svelte` remained the largest maintainability hotspot even after helper extraction. This slice extracted the workflow sidebar and execution/session sidebar into dedicated Svelte components, moved shared shell styling into `ui/src/lib/editor-ui.css`, and kept lifecycle/polling/state ownership in `App.svelte`. Verification passed with `bun run typecheck:server`, `bun run typecheck:ui`, focused editor helper tests, and `bun run build:ui`.
