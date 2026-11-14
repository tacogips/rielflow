# Editor Data Loaders Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-editor-data-loaders.md, design-docs/specs/architecture.md#browser-workflow-editor-svelte
**Created**: 2026-03-09
**Last Updated**: 2026-03-10

## Summary

Extract the browser editor's async workflow/session data-loading paths from `ui/src/App.svelte` into a frontend-owned loader module under `ui/src/lib/`.

## Scope

Included:

- design record for the extraction
- data-loader module under `ui/src/lib/`
- `ui/src/App.svelte` migration away from repeated workflow/session loading flows
- repository typecheck verification

Not included:

- component/store decomposition
- polling timer ownership changes
- server route redesign

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-refactoring-editor-data-loaders.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record the remaining async data-loading concentration in `ui/src/App.svelte`
- [x] Define the frontend loader module as the next extraction boundary

### 2. Frontend Data Loader Extraction

#### `ui/src/lib/editor-data.ts`, `ui/src/App.svelte`

**Status**: COMPLETED

```ts
export async function loadWorkflowEditorData(input: {
  readonly workflowName: string;
  readonly preferredNodeId: string;
  readonly selectedExecutionId: string;
}): Promise<LoadedWorkflowEditorData>;
```

**Checklist**:
- [x] Move workflow/session hydration paths out of `ui/src/App.svelte`
- [x] Centralize selected-workflow and selected-session reconciliation
- [x] Keep timer ownership, busy flags, and user-facing messages in the component

### 3. Verification

#### `ui/src/App.svelte`, `ui/src/lib/editor-data.ts`

**Status**: COMPLETED

**Checklist**:
- [x] Run `bun run typecheck:server`
- [x] Run `bun run typecheck:ui`
- [x] Run `bun run build:ui`

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Frontend data loader extraction | editor API client, editor state helpers | READY |
| Verification | frontend data loader extraction | COMPLETED |

## Completion Criteria

- [x] Design document exists for this refactoring slice
- [x] `ui/src/App.svelte` no longer owns the extracted workflow/session data-loading block
- [x] Frontend workflow/session hydration rules are centralized in one module
- [x] Repository typechecks pass
- [x] UI build passes

## Progress Log

### Session: 2026-03-09 16:55
**Tasks Completed**: Design assessment, implementation plan creation, frontend data loader extraction, repository typechecks
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` still requires a real Node.js binary in PATH, which is not available in this environment
**Notes**: Continuation review found that the overall architecture still matches the intended local-server plus replaceable-frontend design, but `ui/src/App.svelte` still concentrated multi-request workflow/session loading and reconciliation flows. This slice extracts those async loader paths into `ui/src/lib/editor-data.ts` while keeping Svelte-local polling timers, busy flags, and user-facing messages in the component.

### Session: 2026-03-09 17:20
**Tasks Completed**: Continuation review and loader follow-through cleanup
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` and `bun run test` still require a real Node.js binary in PATH, which is not available in this environment
**Notes**: Refined `ui/src/lib/editor-data.ts` so workflow payload loading and session summary loading happen in parallel for workflow hydration, and workflow creation now returns deterministic empty session state without a redundant `/api/sessions` fetch. This keeps the new loader boundary responsible for both selected-state reconciliation and transport efficiency, without moving polling/message ownership out of `App.svelte`.

### Session: 2026-03-09 17:38
**Tasks Completed**: Continuation bug fix for stale selected execution reconciliation
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` and `bun run test` still require a real Node.js binary in PATH, which is not available in this environment
**Notes**: Follow-up review found that the extracted loader path still treated a missing selected execution detail as a fatal workflow-load error when `/api/sessions` and `/api/workflow-executions/:id` briefly disagreed. Added typed `ApiError` status handling in `ui/src/lib/api-client.ts` and hardened `ui/src/lib/editor-data.ts` to clear the stale selection and drop the vanished summary entry instead of failing the whole editor refresh.

### Session: 2026-03-09 18:05
**Tasks Completed**: Continuation hardening for selected-session state normalization, helper regression tests
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` remains blocked because this environment does not expose `node`/`vite` in PATH
**Notes**: Follow-up review found one remaining consistency gap in the extracted state/data-loader boundary: `reconcileSessionPanelState(...)` could preserve stale selected-session details when the selected execution id had already been cleared or when the detail payload no longer matched the selected execution id. Hardened `ui/src/lib/editor-state.ts` to normalize that mismatch defensively and added focused regression tests in `ui/src/lib/editor-state.test.ts` so future loader/state refactors keep the session panel internally consistent.

### Session: 2026-03-09 18:32
**Tasks Completed**: Continuation fix for post-cancel selected-session reload guard
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` and full Vitest runs still require a real Node.js binary in PATH, which is not available in this environment
**Notes**: Continuation review found that `ui/src/App.svelte` still unconditionally called `loadSelectedSession(selectedExecutionId, false)` after `loadSessions(...)` during cancellation. When the refreshed session panel had already cleared a vanished execution selection, that follow-up reload could target an empty execution id. Guarded the post-cancel reload so it only runs when the refreshed selection remains present and otherwise just clears polling state.

### Session: 2026-03-09 20:05
**Tasks Completed**: Continuation refactor for session-panel refresh reconciliation
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` and Node-based Vitest runs remain blocked in this shell because `node` is not available in PATH
**Notes**: Follow-up review found that `App.svelte` still duplicated the "reload session summaries, reconcile the selected execution, and decide whether polling should continue" flow across multiple paths, and cancellation messages could reference a mutated or cleared `selectedExecutionId`. Extracted that refresh reconciliation into `ui/src/lib/editor-data.ts`, updated `loadSessions(...)` to consume the centralized result, and captured the cancellation target execution id before refreshing state so post-cancel messaging stays stable even when the selection is cleared.

### Session: 2026-03-09 22:35
**Tasks Completed**: Continuation cleanup for selected-session summary/detail reconciliation
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui`, `bun run test`, and browser verification still require a real Node.js binary in PATH, which is not available in this shell
**Notes**: Follow-up review found that `App.svelte` still owned direct selected-session detail fetches even after the data-loader extraction, which left summary/detail reconciliation split across the component and the loader boundary. Centralized selected-session loading through `ui/src/lib/editor-data.ts`, removed the now-redundant `selectedSession` loader inputs, and added summary upsert normalization so a newly selected execution or fresher detail status stays visible even when `/api/sessions` temporarily lags behind the detail read.

### Session: 2026-03-10 00:10
**Tasks Completed**: Continuation cleanup for redundant post-load session refreshes, bounded verification rerun
**Tasks In Progress**: Verification
**Blockers**: `bun run build:ui` still requires a real Node.js binary in PATH, which is not available in this shell
**Notes**: Continuation review found that `ui/src/App.svelte` had reintroduced sequential session reloads after manual refresh, workflow execution, and polling, even though the extracted loader already owns selected-session reconciliation and summary/detail normalization. Removed those redundant follow-up loads so the component now relies on the existing loader boundary for those flows, then re-ran `bun run typecheck:server`, `bun run typecheck:ui`, `bun test src/server/api-request.test.ts`, `bun test src/server/api.test.ts`, and `bun test ui/src/lib/editor-state.test.ts ui/src/lib/editor-field-updates.test.ts`. `bun run build:ui` remains blocked by the missing real Node.js binary enforced by `scripts/require-node-tooling.sh`.

### Session: 2026-03-10 10:35
**Tasks Completed**: Verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation verification reran `bun run typecheck:server`, `bun run typecheck:ui`, targeted Bun tests, and `bun run build:ui` successfully in the current shell, so the editor data loaders slice is now complete.

## Related Plans

- **Previous**: `impl-plans/refactoring-editor-state-helpers.md`
- **Next**: none yet
- **Depends On**: `impl-plans/refactoring-editor-api-client.md`, `impl-plans/refactoring-editor-state-helpers.md`
