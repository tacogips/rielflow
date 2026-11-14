# Editor Execution Helpers Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-editor-execution-helpers.md, design-docs/specs/architecture.md#browser-workflow-editor-svelte
**Created**: 2026-03-09
**Last Updated**: 2026-03-09

## Summary

Extract the browser editor's pure execution-request assembly logic from `ui/src/App.svelte` into a frontend-owned helper module under `ui/src/lib/`.

## Scope

Included:

- design record for the extraction
- execution helper module under `ui/src/lib/`
- `ui/src/App.svelte` migration away from inline execute-request parsing
- focused regression coverage for request assembly
- repository typecheck verification

Not included:

- polling timer redesign
- rerun flow extraction
- server route changes

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-refactoring-editor-execution-helpers.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record the remaining execution-request parsing concentration in `ui/src/App.svelte`
- [x] Define the frontend execution helper module as the next extraction boundary

### 2. Frontend Execution Helper Extraction

#### `ui/src/lib/editor-execution.ts`, `ui/src/App.svelte`

**Status**: COMPLETED

```ts
export function buildExecuteWorkflowRequest(input: {
  readonly runtimeVariablesText: string;
  readonly mockScenarioText: string;
  readonly maxStepsText: string;
  readonly maxLoopIterationsText: string;
  readonly defaultTimeoutText: string;
  readonly runAsync: boolean;
  readonly runDryRun: boolean;
}): ExecuteWorkflowRequest;
```

**Checklist**:
- [x] Move pure execute-request parsing out of `ui/src/App.svelte`
- [x] Centralize optional field inclusion rules for execute requests
- [x] Keep request dispatch, busy flags, and messages in the component

### 3. Verification

#### `ui/src/lib/editor-execution.test.ts`, `ui/src/App.svelte`

**Status**: COMPLETED

**Checklist**:
- [x] Add focused regression coverage for execute-request assembly
- [x] Run `bun run typecheck:server`
- [x] Run `bun run typecheck:ui`
- [x] Run bounded relevant tests successfully in this environment

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Frontend execution helper extraction | editor support helpers, editor API client | READY |
| Verification | frontend execution helper extraction | READY |

## Completion Criteria

- [x] Design document exists for this refactoring slice
- [x] `ui/src/App.svelte` no longer owns the extracted execute-request assembly block
- [x] Execute request parsing is centralized in one helper module
- [x] Focused regression coverage exists for execute-request assembly
- [x] Repository typechecks pass
- [x] Bounded relevant tests are attempted and results recorded

## Progress Log

### Session: 2026-03-09 23:05
**Tasks Completed**: Design assessment, implementation plan creation, execution helper extraction, focused verification
**Tasks In Progress**: None
**Blockers**: Full UI build and browser verification still require a real Node.js binary in PATH, which is not available in this shell
**Notes**: Continuation review found that the overall architecture still matches the intended local-server plus replaceable-frontend design, but `ui/src/App.svelte` still owned the canonical execute-request assembly path. Extracted that pure parsing and request-shaping logic into `ui/src/lib/editor-execution.ts`, added focused regression coverage, and re-ran `bun run typecheck:server`, `bun run typecheck:ui`, `bun test src/server/api-request.test.ts`, and `bun test src/server/api.test.ts ui/src/lib/editor-state.test.ts ui/src/lib/editor-field-updates.test.ts ui/src/lib/editor-execution.test.ts` successfully.

## Related Plans

- **Previous**: `impl-plans/refactoring-editor-data-loaders.md`
- **Next**: none yet
- **Depends On**: `impl-plans/refactoring-editor-api-client.md`, `impl-plans/refactoring-editor-support-helpers.md`
