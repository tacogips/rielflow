# Shared Editable Workflow Types Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-shared-editable-workflow-types.md, design-docs/specs/architecture.md#browser-workflow-editor-svelte
**Created**: 2026-03-09
**Last Updated**: 2026-03-10

## Summary

Refactor the Svelte workflow editor to consume the shared workflow domain types from `src/workflow/types.ts` instead of re-declaring matching persisted-model interfaces locally.

## Scope

Included:

- design update for shared editable workflow typing
- shared type imports in `ui/src/App.svelte`
- deep-mutable editor aliases derived from shared readonly domain types
- retention of explicit UI-only additive typing where needed
- repository typechecks and bounded UI build verification

Not included:

- component/store decomposition of `ui/src/App.svelte`
- workflow schema changes
- non-TypeScript UI behavior changes

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-refactoring-shared-editable-workflow-types.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record the remaining duplicated workflow-model typing in the Svelte editor
- [x] Define shared domain types as the canonical source for persisted workflow structures

### 2. Frontend Type Reuse

#### `ui/src/App.svelte`, `ui/src/lib/editor-workflow.ts`

**Status**: COMPLETED

```ts
type EditorWorkflowBundle = Omit<DeepMutable<NormalizedWorkflowBundle>, "workflow" | "nodePayloads"> & {
  workflow: EditorWorkflow;
  nodePayloads: Record<string, EditorNodePayload>;
};
```

**Checklist**:
- [x] Remove duplicated persisted workflow interfaces
- [x] Reuse shared domain types through local mutable aliases
- [x] Keep UI-only extensions explicit

### 3. Verification

#### `ui/src/App.svelte`, `ui/tsconfig.json`

**Status**: COMPLETED

**Checklist**:
- [x] Run `bun run typecheck:server`
- [x] Run `bun run typecheck:ui`
- [x] Run `bun run build:ui`

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Design alignment | `design-docs/specs/design-refactoring-shared-editable-workflow-types.md` | COMPLETED | n/a |
| Frontend type reuse | `ui/src/App.svelte`, `ui/src/lib/editor-workflow.ts` | COMPLETED | `bun run typecheck:server`, `bun run typecheck:ui` |
| Verification | `ui/src/App.svelte`, `ui/tsconfig.json` | COMPLETED | `bun run typecheck:server`, `bun run typecheck:ui`, `bun run build:ui` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Frontend type reuse | shared workflow domain types already exported | READY |
| Verification | frontend type reuse | COMPLETED |

## Completion Criteria

- [x] Design document exists for this refactoring slice
- [x] `ui/src/App.svelte` no longer redefines persisted workflow model interfaces already present in `src/workflow/types.ts`
- [x] UI-only extensions remain explicit and minimal
- [x] Repository typechecks pass
- [x] UI build passes

## Progress Log

### Session: 2026-03-09 12:10
**Tasks Completed**: Design assessment, implementation plan creation
**Tasks In Progress**: Frontend type reuse
**Blockers**: None
**Notes**: Continuation review found that the Svelte editor still duplicated the persisted workflow domain model even after transport-contract and visualization consolidation. This slice keeps mutable editor state frontend-owned but derives it from the shared workflow types so future schema changes do not drift.

### Session: 2026-03-09 12:24
**Tasks Completed**: Frontend type reuse, repository typechecks
**Tasks In Progress**: Verification
**Blockers**: `timeout 45s bun run build:ui` exits with code `124` without diagnostics in this environment
**Notes**: Replaced the handwritten persisted workflow interfaces in `ui/src/App.svelte` with deep-mutable aliases derived from `src/workflow/types.ts`, while keeping the editor-only `label` field on nodes and relaxed string typing for `executionBackend` explicit as additive UI concerns. `bun run typecheck:server` and `bun run typecheck:ui` both pass after the refactor.

### Session: 2026-03-09 12:11
**Tasks Completed**: Verification preflight hardening
**Tasks In Progress**: Verification
**Blockers**: The current sandbox only exposes Bun's temporary `node` shim (`/tmp/bun-node-*`), so `bun run build:ui` cannot complete here after the fail-fast preflight
**Notes**: Added a shared Node-availability guard for Vite/Vitest/Playwright scripts so the remaining verification blocker is explicit and consistent across refactoring slices.

### Session: 2026-03-09 12:15
**Tasks Completed**: Additional continuation cleanup for frontend type reuse
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` still fails fast because this environment does not expose a real Node.js binary; Bun injects only its temporary `node` shim during npm-script execution
**Notes**: Extracted the editor-local deep-mutable workflow adaptation types and clone helper from `ui/src/App.svelte` into `ui/src/lib/editor-workflow.ts` so the component now imports a single frontend-owned adapter layer instead of carrying the shared-type derivation block inline. Re-ran `bun run typecheck:server` and `bun run typecheck:ui` successfully after the extraction.

### Session: 2026-03-10 10:35
**Tasks Completed**: Verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation verification reran `bun run typecheck:server`, `bun run typecheck:ui`, and `bun run build:ui` successfully in the current shell, so the shared editable workflow typing slice is now complete.
