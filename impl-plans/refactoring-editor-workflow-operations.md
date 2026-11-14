# Editor Workflow Operations Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-editor-workflow-operations.md, design-docs/specs/architecture.md#browser-workflow-editor-svelte
**Created**: 2026-03-09
**Last Updated**: 2026-03-10

## Summary

Extract the browser editor's pure workflow-structure operations from `ui/src/App.svelte` into a frontend-owned helper module under `ui/src/lib/`.

## Scope

Included:

- design update for the extraction boundary
- editor workflow operations helper module under `ui/src/lib/`
- `ui/src/App.svelte` migration away from local structural helper blocks
- repository typecheck verification

Not included:

- component/store decomposition
- server route refactoring
- workflow schema changes

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-refactoring-editor-workflow-operations.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record the remaining responsibility concentration in `ui/src/App.svelte`
- [x] Define the editor workflow operations module as the next extraction boundary

### 2. Frontend Workflow Operations Extraction

#### `ui/src/lib/editor-workflow-operations.ts`, `ui/src/App.svelte`

**Status**: COMPLETED

```ts
export function availableSubWorkflowBoundaryNodes(
  bundle: EditorWorkflowBundle | null | undefined,
  kind: "managerNodeId" | "inputNodeId" | "outputNodeId",
  currentSubWorkflowId: string,
): EditorWorkflowNode[];
```

**Checklist**:
- [x] Move pure workflow ordering and normalization helpers out of `ui/src/App.svelte`
- [x] Centralize sub-workflow boundary/member candidate logic
- [x] Keep dirty-state, selection-state, and error-message orchestration in the component

### 3. Verification

#### `ui/src/App.svelte`, `ui/src/lib/editor-workflow-operations.ts`

**Status**: COMPLETED

**Checklist**:
- [x] Run `bun run typecheck:server`
- [x] Run `bun run typecheck:ui`
- [x] Run `bun run build:ui`

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Frontend workflow operations extraction | shared workflow types and visualization helper | READY |
| Verification | frontend workflow operations extraction | COMPLETED |

## Completion Criteria

- [x] Design document exists for this refactoring slice
- [x] `ui/src/App.svelte` no longer owns the extracted pure workflow editor operations block
- [x] Frontend workflow editing rules are centralized in one helper module
- [x] Repository typechecks pass
- [x] UI build passes

## Progress Log

### Session: 2026-03-09 13:35
**Tasks Completed**: Design assessment, implementation plan creation, frontend workflow operations extraction, repository typechecks
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` cannot run in this environment because a real Node.js binary is not available in PATH
**Notes**: Continuation review found that the overall product architecture still matches the intended local-server plus replaceable-frontend design, but `ui/src/App.svelte` still concentrated a large block of pure workflow-structure mutation rules. This slice extracts those rules into `ui/src/lib/editor-workflow-operations.ts` while keeping Svelte-specific orchestration in the component.

### Session: 2026-03-09 14:05
**Tasks Completed**: Continuation integrity fixes after extraction review
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` and Vitest still require a real Node.js binary that is not available in this environment
**Notes**: Tightened the extracted workflow-operations layer so loop id renames/removals, sub-workflow renames/removals, and node deletions no longer leave stale `subWorkflowConversations`, loop-body references, or node-output input sources behind in the editable bundle. Also cleared deprecated `selectionPolicy` data when switching an input source type in the editor.

### Session: 2026-03-09 16:05
**Tasks Completed**: Additional continuation review and integrity fix
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` and Vitest still require a real Node.js binary that is not available in this environment
**Notes**: Reviewed the in-progress refactoring diff against the extracted workflow-operations boundary and found a remaining stale-reference path: deleting a loop-judge node removed the loop record but left `subWorkflows[].block.loopId` references behind. Added shared `nextLoopId` and `removeLoopsOwnedByNode` helpers in `ui/src/lib/editor-workflow-operations.ts`, updated `ui/src/App.svelte` to use them, and re-ran `bun run typecheck:server` plus `bun run typecheck:ui` successfully.

### Session: 2026-03-10 10:35
**Tasks Completed**: Verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation verification reran `bun run typecheck:server`, `bun run typecheck:ui`, and `bun run build:ui` successfully in the current shell, so the editor workflow operations slice is now complete.
