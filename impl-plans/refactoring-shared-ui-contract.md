# Shared UI/API Contract Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-shared-ui-contract.md, design-docs/specs/architecture.md#local-http-server-rielflow-serve, design-docs/specs/architecture.md#browser-workflow-editor
**Created**: 2026-03-09
**Last Updated**: 2026-03-10

## Summary

Refactor the browser/API boundary so the server and browser editor consume a single shared TypeScript transport contract for browser-facing request payloads, execution/session responses, and frontend bootstrap data.

## Scope

Included:

- design update for canonical shared UI/API contracts
- shared transport type module under `src/shared/`
- server and Svelte imports migrated to the shared contract
- shared request body types for browser-owned workflow operations
- execution/session naming cleanup where the canonical contract already guarantees `workflowExecutionId`
- validation through targeted tests and repository typechecks

Not included:

- full decomposition of `src/server/api.ts`
- full decomposition of `ui/src/App.svelte`
- migration of mutable editor-local workflow models to shared domain types

## Modules

### 1. Shared Transport Contract

#### `src/shared/ui-contract.ts`

**Status**: COMPLETED

```ts
export type FrontendMode = "svelte-dist" | "solid-dist";

export interface UiConfigResponse {
  readonly fixedWorkflowName: string | null;
  readonly readOnly: boolean;
  readonly noExec: boolean;
  readonly frontend: FrontendMode;
}
```

**Checklist**:
- [x] Add shared frontend/API transport types
- [x] Add shared browser-facing request payload types
- [x] Keep frontend bootstrap typing framework-agnostic across Svelte and SolidJS built modes
- [x] Reuse existing workflow/session exported types where safe
- [x] Keep the module free of Node-only runtime dependencies

### 2. Server Alignment

#### `src/server/api.ts`

**Status**: COMPLETED

```ts
function buildUiConfigResponse(
  context: ApiContext,
  frontend: FrontendMode,
): UiConfigResponse;
```

**Checklist**:
- [x] Remove duplicated transport type declarations
- [x] Type canonical execution/session responses with shared contracts
- [x] Reuse shared browser-facing request payload types from server parsing helpers
- [x] Keep `sessionId` compatibility alias explicit in API responses

### 3. Frontend Alignment

#### `ui/src/App.svelte`

**Status**: COMPLETED

```ts
import type {
  ExecuteWorkflowResponse,
  UiConfigResponse,
  WorkflowExecutionStateResponse,
} from "../../src/shared/ui-contract";
```

**Checklist**:
- [x] Replace duplicated response interfaces with shared imports
- [x] Replace duplicated browser request interfaces with shared imports
- [x] Simplify execution id handling to canonical `workflowExecutionId`
- [x] Keep mutable editor-local workflow state separate from transport types

### 4. Verification

#### `src/server/api.test.ts`

**Status**: COMPLETED

**Checklist**:
- [x] Preserve current API behavior under tests
- [x] Run targeted server tests
- [x] Run repository typecheck including Svelte

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Shared transport contract | `src/shared/ui-contract.ts` | COMPLETED | `bun run typecheck` passes |
| Server alignment | `src/server/api.ts` | COMPLETED | `bun run typecheck` passes |
| Frontend alignment | `ui/src/App.svelte`, `ui/tsconfig.json` | COMPLETED | `bun run typecheck` passes |
| Verification | `src/server/api.test.ts` | COMPLETED | `bun test src/server/api-request.test.ts src/server/api.test.ts ui/src/lib/editor-state.test.ts ui/src/lib/editor-field-updates.test.ts ui/src/lib/editor-execution.test.ts`, `bun run typecheck:server`, and `bun run typecheck:ui` pass |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Server alignment | Shared transport contract | READY |
| Frontend alignment | Shared transport contract | READY |
| Verification | Server alignment, Frontend alignment | READY |

## Completion Criteria

- [x] Shared transport contract exists under `src/shared/`
- [x] `src/server/api.ts` consumes the shared contract
- [x] `ui/src/App.svelte` consumes the shared contract
- [x] Shared browser request payload types are reused by both the frontend client and server parsing helpers
- [x] Execution/session response handling prefers canonical `workflowExecutionId`
- [x] Targeted API tests pass
- [x] Repository typecheck passes

## Progress Log

### Session: 2026-03-09 11:35
**Tasks Completed**: Design assessment, implementation plan creation
**Tasks In Progress**: Shared transport contract, server alignment, frontend alignment, verification
**Blockers**: None
**Notes**: The current architecture matches the intended local-API-plus-replaceable-frontend model, but not the maintainability goal. The first concrete mismatch is duplicated browser/API transport typing, so this iteration focuses on consolidating that contract before larger module decomposition.

### Session: 2026-03-09 11:42
**Tasks Completed**: TASK-001, TASK-002, TASK-003, partial TASK-004
**Tasks In Progress**: TASK-004
**Blockers**: `vitest run src/server/api.test.ts` does not terminate in this environment even when scoped to a single test name
**Notes**: Added `src/shared/ui-contract.ts`, switched `src/server/api.ts` and `ui/src/App.svelte` to the shared transport types, narrowed the UI tsconfig so Svelte checking only loads the frontend-safe shared files, and removed redundant `workflowExecutionId || sessionId` fallback logic where the canonical contract now guarantees `workflowExecutionId`.

### Session: 2026-03-09 11:46
**Tasks Completed**: Additional verification hardening for TASK-004
**Tasks In Progress**: TASK-004
**Blockers**: `vitest run src/server/api.test.ts` still does not terminate in this environment; a bounded `timeout 30s ...` invocation exits with code `124`
**Notes**: Reviewed the continuation diff against the intended shared-contract slice and confirmed the architecture/design still match the local-server plus replaceable-frontend goal, so no new design rewrite was needed. Tightened `src/server/api.test.ts` to consume the same shared transport contracts as the server/UI instead of local ad hoc JSON casts, and re-ran `bun run typecheck:server` plus `bun run typecheck:ui` successfully.

### Session: 2026-03-09 11:48
**Tasks Completed**: Additional continuation cleanup for TASK-004
**Tasks In Progress**: TASK-004
**Blockers**: Bounded `timeout 25s bunx vitest run ...` invocations still exit with code `124` even for `src/workflow/adapter.test.ts`, so the remaining blocker appears to be the local Vitest execution environment rather than the shared-contract refactor itself
**Notes**: Replaced the remaining `WorkflowListResponse` ad hoc casts in `src/server/api.test.ts`, updated the rerun test to consume the canonical execute response type, and replaced `ui/src/App.svelte`'s `as unknown as WorkflowBundle` clone with a typed deep-mutable clone helper. Re-ran `bun run typecheck:server` and `bun run typecheck:ui` successfully after the cleanup.

### Session: 2026-03-09 12:02
**Tasks Completed**: Additional continuation cleanup for TASK-004
**Tasks In Progress**: TASK-004
**Blockers**: Targeted `vitest` and `vite build` executions still hang in this environment without diagnostics, so completion remains blocked on tooling/runtime behavior rather than TypeScript correctness
**Notes**: Finished the remaining shared-contract cleanup in `src/server/api.test.ts` by replacing the last ad hoc workflow/create/save response casts with `WorkflowResponse` and `SaveWorkflowResponse`, added a canonical `RerunWorkflowResponse` to `src/shared/ui-contract.ts`, and typed the rerun API response in `src/server/api.ts`. Re-ran `bun run typecheck:server` and `bun run typecheck:ui` successfully.

### Session: 2026-03-09 12:36
**Tasks Completed**: Additional continuation cleanup for TASK-004
**Tasks In Progress**: TASK-004
**Blockers**: `bun run build:ui` and `vitest run` still stall in this Bun-only environment, so completion remains blocked on tooling/runtime behavior rather than repository type correctness
**Notes**: Closed the remaining shared-contract drift in `src/server/api.ts` by typing the workflow list and save responses with `WorkflowListResponse` and `SaveWorkflowResponse`, and strengthened rerun response naming to include canonical `workflowExecutionId` fields plus legacy `sessionId` aliases. Updated `src/server/api.test.ts` to assert the canonical and compatibility fields together.

### Session: 2026-03-09 12:11
**Tasks Completed**: Verification preflight hardening
**Tasks In Progress**: TASK-004
**Blockers**: The current sandbox only exposes Bun's temporary `node` shim (`/tmp/bun-node-*`), which is insufficient for Vite/Vitest/Playwright verification even though TypeScript checks pass
**Notes**: Added `scripts/require-node-tooling.sh` and wired `package.json` UI/test scripts through it so missing real Node runtime support now fails fast with an actionable message instead of appearing as an indefinite Bun tooling hang.

### Session: 2026-03-09 13:06
**Tasks Completed**: Continuation fix for tooling guard drift
**Tasks In Progress**: TASK-004
**Blockers**: Full `bun run build:ui` and `bun run test` execution still require a real Node.js binary in PATH, so this environment remains limited to fast-fail verification plus TypeScript checks
**Notes**: Continuation review found that the repository already contained `scripts/require-node-tooling.sh` and the plan log claimed the guard was wired, but `package.json` still invoked `vite`, `vitest`, and `playwright` directly. Updated the affected scripts to route through the guard, then re-ran `bun run typecheck:server` and `bun run typecheck:ui` successfully and confirmed that `bun run build:ui` and `bun run test` now fail immediately with the intended actionable Node-runtime error instead of stalling.

### Session: 2026-03-09 22:05
**Tasks Completed**: Continuation contract unification for browser request payloads
**Tasks In Progress**: TASK-004
**Blockers**: Targeted full API/Vitest verification still requires real Node.js tooling in PATH
**Notes**: Continuation review found a remaining design/implementation mismatch inside the shared-contract slice: `src/shared/ui-contract.ts` described the canonical browser/API boundary, but execute/save/validate request bodies were still duplicated between `ui/src/lib/api-client.ts` and server parsing helpers. Extended the shared contract to cover browser-facing request payload types, switched the frontend API client and `App.svelte` to consume those shared request types, updated `src/server/api-request.ts` to reuse the same request contracts for parsed execute/rerun options, and re-ran `bun run typecheck:server`, `bun run typecheck:ui`, plus bounded Bun tests for the touched helpers.

### Session: 2026-03-10 00:20
**Tasks Completed**: TASK-004
**Tasks In Progress**: None
**Blockers**: `bun run build:ui` still requires a real Node.js binary in PATH, but that is outside this plan's completion criteria
**Notes**: Continuation verification confirmed the stale blocker notes were no longer accurate for this plan. Re-ran `bun run typecheck:server`, `bun run typecheck:ui`, and `bun test src/server/api-request.test.ts src/server/api.test.ts ui/src/lib/editor-state.test.ts ui/src/lib/editor-field-updates.test.ts ui/src/lib/editor-execution.test.ts`; all passed, so the shared-contract slice is now complete even though Node-gated frontend build verification remains pending in later UI-focused plans.

### Session: 2026-03-10 11:05
**Tasks Completed**: Post-completion continuation cleanup
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Follow-up review found one remaining DRY/type-safety gap across the shared browser/server boundary: both `ui/src/lib/editor-support.ts` and `src/server/api-request.ts` still owned duplicate JSON-object guards and local casts. Added `src/shared/json.ts` as a frontend-safe shared guard module, switched both call sites to reuse it, added `src/shared/json.test.ts`, and re-ran `bun run typecheck:server`, `bun run typecheck:ui`, `bun test src/shared/json.test.ts src/server/api-request.test.ts src/server/api.test.ts ui/src/lib/editor-actions.test.ts ui/src/lib/editor-state.test.ts ui/src/lib/editor-field-updates.test.ts ui/src/lib/editor-execution.test.ts`, plus `bun run build:ui`.

### Session: 2026-03-09 05:05
**Tasks Completed**: Post-completion plan alignment cleanup
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation review found a stale architecture description in this completed plan even though the runtime/shared contract had already moved on: the plan still documented `FrontendMode` as `\"svelte-dist\"` only and still framed the browser side as Svelte-specific. Updated the completed plan so it now matches the checked-in shared contract and the active SolidJS migration target without changing task status. Re-ran `bun test ./src/**/*.test.ts ./ui/src/**/*.test.ts ./ui/src/**/*.test.tsx`, `bun run typecheck:server`, `bun run typecheck:ui`, and `bun run build:ui`; all passed on the current Svelte entrypoint.
