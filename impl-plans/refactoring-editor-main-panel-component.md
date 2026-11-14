# Editor Main Panel Component Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-editor-main-panel-component.md, design-docs/specs/design-workflow-web-editor.md#migration-strategy
**Created**: 2026-03-09
**Last Updated**: 2026-03-09

**Historical Note**: This plan documents the Svelte main-panel extraction completed before the SolidJS migration plan existed. After SolidJS cutover, this file should be treated as historical implementation context rather than active frontend guidance.

## Summary

Extract the Svelte workflow editor's center editing surface from `ui/src/App.svelte` into a dedicated component while keeping orchestration and state ownership in `App.svelte`.

## Scope

Included:

- design record for the new center-panel component boundary
- `WorkflowEditorPanel.svelte` extraction
- `ui/src/App.svelte` simplification away from inline center-panel markup and DOM-event parsing
- repository typecheck/build verification

Not included:

- Svelte store introduction
- further decomposition of the extracted center panel
- server API changes

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-refactoring-editor-main-panel-component.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record the remaining center-panel responsibility concentration in `ui/src/App.svelte`
- [x] Define the next safe component boundary

### 2. Center Panel Extraction

#### `ui/src/lib/components/WorkflowEditorPanel.svelte`, `ui/src/App.svelte`

**Status**: COMPLETED

```ts
export let editableBundle: EditorWorkflowBundle | null = null;
export let onUpdateNodeKind: (nodeId: string, kind: NodeKind) => void;
```

**Checklist**:
- [x] Move the workflow editor center-panel markup out of `ui/src/App.svelte`
- [x] Keep async orchestration, polling, and top-level state ownership in `ui/src/App.svelte`
- [x] Move DOM event value parsing for center-panel controls into the extracted component where safe

### 3. Verification

#### `ui/src/App.svelte`, `ui/src/lib/components/WorkflowEditorPanel.svelte`

**Status**: COMPLETED

**Checklist**:
- [x] Run `bun run typecheck:server`
- [x] Run `bun run typecheck:ui`
- [x] Run `bun run build:ui`

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Center panel extraction | editor helper/action/component refactors | READY |
| Verification | center panel extraction | COMPLETED |

## Completion Criteria

- [x] Design document exists for this refactoring slice
- [x] `ui/src/App.svelte` no longer owns the center workflow-editor markup
- [x] `ui/src/App.svelte` no longer owns low-level DOM-event parsing for center-panel controls
- [x] Repository typechecks pass
- [x] UI build passes

## Progress Log

### Session: 2026-03-09 14:42
**Tasks Completed**: Design assessment, implementation plan creation, center-panel extraction
**Tasks In Progress**: Verification
**Blockers**: None
**Notes**: Continuation review confirmed that the top-level architecture still matches the intended local-server plus replaceable-frontend design, so no architecture rewrite was required. The remaining maintainability hotspot was the center editor surface still concentrated in `ui/src/App.svelte`, so this slice extracts that markup into `WorkflowEditorPanel.svelte` and moves event-to-value translation down to the rendered controls.

### Session: 2026-03-09 14:50
**Tasks Completed**: Verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-ran `bun run typecheck:server`, `bun run typecheck:ui`, and `bun run build:ui` successfully after the extraction. The next remaining UI decomposition work, if needed later, is inside `WorkflowEditorPanel.svelte` rather than in `App.svelte`.
