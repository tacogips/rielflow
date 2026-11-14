# Editor API Client Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-editor-api-client.md
**Created**: 2026-03-09
**Last Updated**: 2026-03-10

## Summary

Extract the browser editor's typed HTTP transport logic from `ui/src/App.svelte` into a frontend-owned API client module under `ui/src/lib/`.

## Scope

Included:

- design record for the extraction
- typed fetch helpers in `ui/src/lib/`
- route and request-body helpers for workflow/session API calls
- `ui/src/App.svelte` migration away from direct raw `fetch` usage
- repository typecheck verification

Not included:

- Svelte component decomposition
- server route redesign
- workflow editor state-store migration

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-refactoring-editor-api-client.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record the responsibility concentration in `ui/src/App.svelte`
- [x] Define the frontend API client as the next extraction boundary

### 2. Frontend API Client Extraction

#### `ui/src/lib/api-client.ts`, `ui/src/App.svelte`

**Status**: COMPLETED

```ts
export interface UiApiClient {
  loadConfig(): Promise<UiConfigResponse>;
  listWorkflows(): Promise<WorkflowListResponse>;
  loadWorkflow(name: string): Promise<WorkflowResponse>;
}
```

**Checklist**:
- [x] Move typed fetch helpers out of `ui/src/App.svelte`
- [x] Centralize workflow/session request helpers
- [x] Keep revision-conflict error handling explicit

### 3. Verification

#### `ui/src/App.svelte`, `ui/src/lib/api-client.ts`

**Status**: COMPLETED

**Checklist**:
- [x] Run `bun run typecheck:server`
- [x] Run `bun run typecheck:ui`
- [x] Run `bun run build:ui`

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Frontend API client extraction | shared UI transport contracts | COMPLETED |
| Verification | frontend API client extraction | COMPLETED |

## Completion Criteria

- [x] Design document exists for this refactoring slice
- [x] `ui/src/App.svelte` no longer performs raw fetches directly
- [x] Browser/API route helpers are centralized in one frontend-owned module
- [x] Repository typechecks pass
- [x] UI build passes

## Progress Log

### Session: 2026-03-09 12:48
**Tasks Completed**: Design assessment, implementation plan creation
**Tasks In Progress**: Frontend API client extraction
**Blockers**: None
**Notes**: The product architecture still matches the intended local-server plus replaceable-frontend design. The mismatch for this iteration is intra-frontend responsibility concentration: `ui/src/App.svelte` still mixes view logic and typed transport concerns, so this slice extracts a frontend-owned API client without changing API behavior.

### Session: 2026-03-09 13:02
**Tasks Completed**: Frontend API client extraction, repository typechecks
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` fails fast because this environment does not expose a real Node.js binary
**Notes**: Added `ui/src/lib/api-client.ts` as the frontend-owned transport boundary for config, workflow, validation, save, execution, and session endpoints. `ui/src/App.svelte` now keeps UI state/orchestration while reusing the extracted client for route construction, JSON parsing, and explicit workflow revision-conflict handling. `bun run typecheck:server` and `bun run typecheck:ui` both pass after the extraction.

### Session: 2026-03-10 10:35
**Tasks Completed**: Verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation verification reran `bun run typecheck:server`, `bun run typecheck:ui`, and `bun run build:ui` successfully in the current shell, so the editor API client refactoring slice is now complete.
