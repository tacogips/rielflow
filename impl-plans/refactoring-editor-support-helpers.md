# Editor Support Helpers Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-editor-support-helpers.md, design-docs/specs/architecture.md#browser-workflow-editor-svelte
**Created**: 2026-03-09
**Last Updated**: 2026-03-10

## Summary

Extract the browser editor's pure support helpers from `ui/src/App.svelte` into a frontend-owned helper module under `ui/src/lib/`.

## Scope

Included:

- design update for the extraction boundary
- editor support helper module under `ui/src/lib/`
- `ui/src/App.svelte` migration away from local parsing/error/status utility blocks
- repository typecheck verification

Not included:

- component/store decomposition
- server route refactoring
- workflow schema changes

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-refactoring-editor-support-helpers.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record the remaining support-helper responsibility concentration in `ui/src/App.svelte`
- [x] Define the frontend support helper module as the next extraction boundary

### 2. Frontend Support Helper Extraction

#### `ui/src/lib/editor-support.ts`, `ui/src/App.svelte`

**Status**: COMPLETED

```ts
export function parseJsonObject(
  text: string,
  fieldName: string,
  emptyValue?: Record<string, unknown>,
): Record<string, unknown>;
```

**Checklist**:
- [x] Move pure parsing and error-message helpers out of `ui/src/App.svelte`
- [x] Centralize validation merge/deduplication and session presentation helpers
- [x] Keep Svelte state mutation and lifecycle orchestration in the component

### 3. Verification

#### `ui/src/App.svelte`, `ui/src/lib/editor-support.ts`

**Status**: COMPLETED

**Checklist**:
- [x] Run `bun run typecheck:server`
- [x] Run `bun run typecheck:ui`
- [x] Run `bun run build:ui`

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Frontend support helper extraction | shared UI contracts, shared workflow types, editor API client | READY |
| Verification | frontend support helper extraction | COMPLETED |

## Completion Criteria

- [x] Design document exists for this refactoring slice
- [x] `ui/src/App.svelte` no longer owns the extracted pure support-helper block
- [x] Frontend parsing/error/status helpers are centralized in one module
- [x] Repository typechecks pass
- [x] UI build passes

## Progress Log

### Session: 2026-03-09 12:26
**Tasks Completed**: Design assessment, implementation plan creation
**Tasks In Progress**: Frontend support helper extraction, verification
**Blockers**: None
**Notes**: Continuation review found that the overall product architecture still matches the intended local-server plus replaceable-frontend design, but `ui/src/App.svelte` still concentrated a block of pure parsing, validation, error, dirty-state, and session presentation helpers. This slice extracts that support logic while keeping Svelte lifecycle and state orchestration in the component.

### Session: 2026-03-09 12:28
**Tasks Completed**: Frontend support helper extraction, repository typechecks
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` fails fast because this environment does not expose a real Node.js binary in PATH
**Notes**: Added `ui/src/lib/editor-support.ts` for frontend-owned parsing, validation merge/deduplication, dirty-state comparison, session status presentation, and unknown-error normalization helpers. `ui/src/App.svelte` now imports those helpers instead of owning the duplicated pure utility block. `bun run typecheck:server` and `bun run typecheck:ui` both pass after the extraction.

### Session: 2026-03-10 10:35
**Tasks Completed**: Verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation verification reran `bun run typecheck:server`, `bun run typecheck:ui`, and `bun run build:ui` successfully in the current shell, so the editor support helpers slice is now complete.

## Related Plans

- **Previous**: `impl-plans/refactoring-editor-workflow-operations.md`
- **Next**: none yet
- **Depends On**: `impl-plans/refactoring-shared-ui-contract.md`, `impl-plans/refactoring-editor-api-client.md`, `impl-plans/refactoring-editor-workflow-operations.md`
