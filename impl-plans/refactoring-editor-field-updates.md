# Editor Field Update Helpers Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-editor-field-updates.md, design-docs/specs/architecture.md#browser-workflow-editor-svelte
**Created**: 2026-03-09
**Last Updated**: 2026-03-09

## Summary

Extract the browser editor's bundle and node-property update helpers from `ui/src/App.svelte` into a frontend-owned helper module under `ui/src/lib/`.

## Scope

Included:

- design record for the extraction
- field-update helper module under `ui/src/lib/`
- `ui/src/App.svelte` migration away from inline property-update handlers
- focused regression coverage for positive-integer and reserved-kind invariants
- repository typecheck verification

Not included:

- component/store decomposition
- server route refactoring
- workflow schema changes

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-refactoring-editor-field-updates.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record the remaining field-update responsibility concentration in `ui/src/App.svelte`
- [x] Define the frontend field-update helper module as the next extraction boundary

### 2. Frontend Field Update Extraction

#### `ui/src/lib/editor-field-updates.ts`, `ui/src/App.svelte`

**Status**: COMPLETED

```ts
export function updateNodeTimeoutValue(
  payload: EditorNodePayload | null | undefined,
  rawValue: string,
): MutationResult;
```

**Checklist**:
- [x] Move bundle and node-property update helpers out of `ui/src/App.svelte`
- [x] Centralize positive-integer validation for workflow defaults and node timeouts
- [x] Keep read-only gating, dirty-state clearing, and message orchestration in the component

### 3. Verification

#### `ui/src/lib/editor-field-updates.test.ts`, `ui/src/App.svelte`

**Status**: COMPLETED

**Checklist**:
- [x] Add focused regression coverage for reserved-kind and positive-integer invariants
- [x] Run `bun run typecheck:server`
- [x] Run `bun run typecheck:ui`
- [x] Run bounded relevant tests successfully in this environment

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Frontend field update extraction | editor support helpers, state helpers, mutation helpers | READY |
| Verification | frontend field update extraction | READY |

## Completion Criteria

- [x] Design document exists for this refactoring slice
- [x] `ui/src/App.svelte` no longer owns the extracted field-update helper block
- [x] Positive-integer field invariants are centralized in the helper module
- [x] Focused regression coverage exists for the extracted invariants
- [x] Repository typechecks pass
- [x] Bounded relevant tests are attempted and results recorded

## Progress Log

### Session: 2026-03-09 19:00
**Tasks Completed**: Design assessment, implementation plan creation
**Tasks In Progress**: Frontend field update extraction
**Blockers**: None
**Notes**: Continuation review found that the overall architecture still matches the intended local-server plus replaceable-frontend design, but `ui/src/App.svelte` still owns the canonical field/property mutation rules. The same review identified a concrete invariant gap: positive-only numeric edits are still normalized inconsistently in the component, so this slice extracts those rules and tightens the invariant handling.

### Session: 2026-03-09 19:12
**Tasks Completed**: TASK-002, partial TASK-003
**Tasks In Progress**: TASK-003
**Blockers**: `timeout 15s bunx vitest run ui/src/lib/editor-field-updates.test.ts` exits with code `124` in this environment
**Notes**: Added `ui/src/lib/editor-field-updates.ts` as the canonical frontend-owned field/property mutation layer for workflow description, manager node, node kind/completion, edge fields, workflow defaults, node payload strings, node timeout, and variable JSON synchronization. Migrated `ui/src/App.svelte` to delegate those updates to the helper, added focused regression tests for reserved-kind and positive-integer invariants, and re-ran `bun run typecheck:server` plus `bun run typecheck:ui` successfully.

### Session: 2026-03-09 19:45
**Tasks Completed**: Verification environment alignment, additional TASK-003 verification
**Tasks In Progress**: TASK-003
**Blockers**: This sandbox cannot access `/nix/var/nix/daemon-socket/socket`, so post-change `nix develop` verification cannot be executed from the current session even after the dev-shell fix
**Notes**: Continuation review found that the repository-level development environment no longer matched the refactoring slice's verification contract: package scripts intentionally require a real `node` binary, but `flake.nix` did not provide one. Updated `flake.nix` to include Node.js and recorded the architectural requirement in `design-docs/specs/architecture.md`. Bare-shell `bun run typecheck:server` and `bun run typecheck:ui` still pass, but the intended `nix develop` build/test verification remains blocked here by sandbox access to the Nix daemon rather than by repository configuration.

### Session: 2026-03-09 13:21
**Tasks Completed**: TASK-003
**Tasks In Progress**: None
**Blockers**: Full Node-based UI build verification still requires an environment with real Node.js tooling in PATH, but that is outside this plan's bounded-test completion scope
**Notes**: Follow-up continuation review found that several numeric inputs still used permissive `parseInt` handling and would silently accept malformed values such as `1.5` or `10ms`. Centralized strict positive-integer parsing in `ui/src/lib/editor-support.ts`, reused it from the extracted field-update and loop-mutation helpers, added regression coverage for malformed numeric input, and re-ran `bun run typecheck:server`, `bun run typecheck:ui`, and `bun test ui/src/lib/editor-field-updates.test.ts ui/src/lib/editor-state.test.ts` successfully.
