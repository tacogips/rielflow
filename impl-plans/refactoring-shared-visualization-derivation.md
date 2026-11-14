# Shared Visualization Derivation Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-shared-visualization-derivation.md
**Created**: 2026-03-09
**Last Updated**: 2026-03-10

## Summary

Remove duplicated derived-visualization logic from the Svelte editor and reuse the shared workflow visualization helper already used by the backend domain layer.

## Scope

Included:

- design update for canonical shared visualization derivation
- Svelte editor migration from local derivation logic to `src/workflow/visualization.ts`
- verification through repository typechecks and bounded UI build attempts

Not included:

- algorithm changes to derived visualization semantics
- broader decomposition of `ui/src/App.svelte`
- new UI test infrastructure

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-refactoring-shared-visualization-derivation.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record the duplication between backend and UI visualization derivation
- [x] Define the shared helper as the canonical implementation

### 2. Frontend Reuse

#### `ui/src/App.svelte`

**Status**: COMPLETED

```ts
import {
  deriveWorkflowVisualization,
  type DerivedVisNode,
} from "../../src/workflow/visualization";
```

**Checklist**:
- [x] Remove frontend-local visualization derivation helpers
- [x] Reuse the shared helper for initial load and local edits
- [x] Keep editor-local mutable bundle state intact

### 3. Verification

#### `ui/src/App.svelte`, `ui/tsconfig.json`

**Status**: COMPLETED

**Checklist**:
- [x] Run server typecheck
- [x] Run UI typecheck
- [x] Run UI build

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Design alignment | `design-docs/specs/design-refactoring-shared-visualization-derivation.md` | COMPLETED | n/a |
| Frontend reuse | `ui/src/App.svelte` | COMPLETED | `bun run typecheck:ui` |
| Verification | `ui/src/App.svelte` | COMPLETED | `bun run typecheck:server`, `bun run typecheck:ui`, `bun run build:ui` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Frontend reuse | Shared pure visualization helper already present | READY |
| Verification | Frontend reuse | COMPLETED |

## Completion Criteria

- [x] Shared visualization derivation has a design record
- [x] `ui/src/App.svelte` no longer duplicates the interval/color derivation algorithm
- [x] Repository typechecks pass
- [x] UI build passes

## Progress Log

### Session: 2026-03-09 11:51
**Tasks Completed**: TASK-001, TASK-002
**Tasks In Progress**: TASK-003
**Blockers**: None
**Notes**: Continued the refactoring investigation by removing the remaining duplicated visualization derivation logic from the Svelte editor. The architecture still matches the intended local-server plus replaceable-frontend model; the concrete mismatch was duplicated pure domain derivation logic, which is now delegated to the shared workflow helper.

### Session: 2026-03-09 11:56
**Tasks Completed**: Additional type-safety alignment inside `ui/src/App.svelte`
**Tasks In Progress**: TASK-003
**Blockers**: `timeout 45s bun run build:ui` exits with code `124` and `vite build --debug` produces no diagnostics before termination in this environment
**Notes**: Importing the shared helper surfaced a drifted frontend-local `WorkflowJson` shape missing `branching`, which was corrected. Server and UI typechecks now pass, but the build step remains environment-blocked and prevents browser verification in this iteration.

### Session: 2026-03-09 12:11
**Tasks Completed**: Verification preflight hardening
**Tasks In Progress**: TASK-003
**Blockers**: The current sandbox only exposes Bun's temporary `node` shim (`/tmp/bun-node-*`), so `bun run build:ui` now fails fast instead of hanging but still cannot complete here
**Notes**: Added a repository-local Node preflight wrapper for Vite/Vitest/Playwright commands so this refactoring slice reports the real environment prerequisite rather than a misleading timeout.

### Session: 2026-03-10 10:35
**Tasks Completed**: TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation verification reran `bun run typecheck:server`, `bun run typecheck:ui`, and `bun run build:ui` successfully in the current shell, so the shared visualization derivation slice is now fully complete.
