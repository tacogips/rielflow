# Editor Mutation Helpers Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-editor-mutation-helpers.md, design-docs/specs/architecture.md#browser-workflow-editor-svelte
**Created**: 2026-03-09
**Last Updated**: 2026-03-10

## Summary

Extract the browser editor's bundle-mutation commands from `ui/src/App.svelte` into a frontend-owned helper module under `ui/src/lib/`.

## Scope

Included:

- design update for the extraction boundary
- editor mutation helper module under `ui/src/lib/`
- `ui/src/App.svelte` migration away from inline node/edge/loop/sub-workflow mutation rules
- cleanup hardening for stale node payload keys during node removal
- fail-fast hardening for duplicate or empty loop/sub-workflow identifier edits
- repository typecheck verification

Not included:

- component/store decomposition
- server route refactoring
- workflow schema changes

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-refactoring-editor-mutation-helpers.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record the remaining mutation-command responsibility concentration in `ui/src/App.svelte`
- [x] Define the frontend mutation-helper module as the next extraction boundary

### 2. Frontend Mutation Helper Extraction

#### `ui/src/lib/editor-mutations.ts`, `ui/src/App.svelte`

**Status**: COMPLETED

```ts
export function addNodeToBundle(
  bundle: EditorWorkflowBundle | null | undefined,
  input: { readonly nodeIdInput: string; readonly kind: NodeKind },
): { readonly ok: true; readonly nodeId: string } | { readonly ok: false; readonly error: string };
```

**Checklist**:
- [x] Move bundle-local node/edge/loop/sub-workflow mutation helpers out of `ui/src/App.svelte`
- [x] Keep read-only gating, validation clearing, and message orchestration in the component
- [x] Remove stale node payload entries keyed by either node id or legacy node file during node deletion
- [x] Reject duplicate or empty loop/sub-workflow identifiers before invalid local state is created

### 3. Verification

#### `ui/src/App.svelte`, `ui/src/lib/editor-mutations.ts`

**Status**: COMPLETED

**Checklist**:
- [x] Run `bun run typecheck:server`
- [x] Run `bun run typecheck:ui`
- [x] Run `bun run build:ui`

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Frontend mutation helper extraction | editor workflow operations, support helpers, state helpers | READY |
| Verification | frontend mutation helper extraction | COMPLETED |

## Completion Criteria

- [x] Design document exists for this refactoring slice
- [x] `ui/src/App.svelte` no longer owns the extracted bundle-mutation helper block
- [x] Frontend structure-changing mutation rules are centralized in one module
- [x] Repository typechecks pass
- [x] UI build passes

## Progress Log

### Session: 2026-03-09 12:38
**Tasks Completed**: Design assessment, implementation plan creation
**Tasks In Progress**: Frontend mutation helper extraction, verification
**Blockers**: None
**Notes**: Continuation review confirmed that the high-level architecture still matches the intended local-server plus replaceable-frontend design, but `ui/src/App.svelte` still owns a large bundle-mutation block for nodes, edges, loops, and sub-workflows. The same review found a cleanup risk around stale node payload keys when structure changes, so this slice extracts those commands and hardens payload cleanup at the same time.

### Session: 2026-03-09 12:44
**Tasks Completed**: Frontend mutation helper extraction, repository typechecks
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` fails fast because this environment still does not expose a real Node.js binary in PATH
**Notes**: Added `ui/src/lib/editor-mutations.ts` as the frontend-owned bundle-mutation boundary for node, edge, loop, and sub-workflow edits. `ui/src/App.svelte` now keeps read-only guards, dirty-state orchestration, validation clearing, and user-facing messages while delegating structure mutations to the helper module. Node removal now also deletes any stale payload entry keyed by the removed node's legacy `nodeFile`.

### Session: 2026-03-09 13:05
**Tasks Completed**: Continuation review hardening for identifier edits
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` still cannot run in this environment without a real Node.js binary in PATH
**Notes**: Follow-up review found that extracted mutation helpers still allowed empty or duplicate sub-workflow ids and loop ids, which created invalid local editor state and deferred failure until explicit validation. Centralized those fail-fast checks in `ui/src/lib/editor-mutations.ts` and simplified `ui/src/App.svelte` to consume the helper results and surface the returned error messages.

### Session: 2026-03-10 10:35
**Tasks Completed**: Verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation verification reran `bun run typecheck:server`, `bun run typecheck:ui`, and `bun run build:ui` successfully in the current shell, so the editor mutation helpers slice is now complete.

## Related Plans

- **Previous**: `impl-plans/refactoring-editor-state-helpers.md`
- **Next**: none yet
- **Depends On**: `impl-plans/refactoring-editor-workflow-operations.md`, `impl-plans/refactoring-editor-support-helpers.md`, `impl-plans/refactoring-editor-state-helpers.md`
