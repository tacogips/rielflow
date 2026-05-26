# Server API Request Parsing Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-server-api-request-parsing.md, design-docs/specs/architecture.md#local-http-server-rielflow-serve
**Created**: 2026-03-09
**Last Updated**: 2026-03-09

## Summary

Extract repeated request-body normalization and workflow-run option parsing from `src/server/api.ts` into a focused server helper module under `src/server/`.

## Scope

Included:

- design record for the extraction
- server-owned request parsing helper module
- `src/server/api.ts` migration away from repeated inline body casts
- focused regression coverage for parsed workflow-run options
- repository server typecheck and relevant tests

Not included:

- route redesign
- response contract changes
- frontend/UI changes

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-refactoring-server-api-request-parsing.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record the repeated request-parsing responsibility in `src/server/api.ts`
- [x] Define a server-owned parsing helper boundary

### 2. Server Parsing Helper Extraction

#### `src/server/api-request.ts`, `src/server/api.ts`

**Status**: COMPLETED

```ts
export function readWorkflowRunRequestOptions(body: unknown): WorkflowRunRequestOptions;
```

**Checklist**:
- [x] Centralize unknown-body to object normalization
- [x] Centralize workflow execute/rerun option parsing
- [x] Keep route matching and HTTP responses in `src/server/api.ts`

### 3. Verification

#### `src/server/api-request.test.ts`, `src/server/api.ts`

**Status**: COMPLETED

**Checklist**:
- [x] Run `bun run typecheck:server`
- [x] Run bounded relevant server tests successfully in this environment

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Server parsing helper extraction | none | COMPLETED |
| Verification | server parsing helper extraction | COMPLETED |

## Completion Criteria

- [x] Design document exists for this refactoring slice
- [x] `src/server/api.ts` no longer repeats the extracted request-parsing block
- [x] Workflow execute/rerun request option parsing is centralized in one helper module
- [x] Repository server typecheck passes
- [x] Focused relevant tests are attempted and results recorded

## Progress Log

### Session: 2026-03-09 21:05
**Tasks Completed**: Design assessment, implementation plan creation, parsing helper extraction, focused verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation review found that the top-level architecture still matches the intended local-server plus replaceable-frontend design, but `src/server/api.ts` still duplicated cast-heavy request parsing for create/save/validate/execute/rerun routes. Extracted server-owned request parsing helpers, reused them across those routes, added focused parsing tests, and re-ran server typecheck plus bounded relevant tests successfully.

### Session: 2026-03-09 21:30
**Tasks Completed**: Continuation type-safety hardening for request parsing
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Follow-up review found an overlooked weak boundary in `src/server/api-request.ts`: array values were still being normalized as generic object records, which meant `runtimeVariables` could silently become an array despite the helper's record-shaped contract. Tightened whole-body and nested-object parsing to accept only non-array JSON objects and added focused regression coverage.

### Session: 2026-03-09 22:25
**Tasks Completed**: Continuation type-safety hardening for `mockScenario` parsing, focused regression coverage
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Follow-up review found one remaining cast-heavy hole in the extracted parsing boundary: `mockScenario` was still accepted via a direct cast from `Record<string, unknown>` to `MockNodeScenario`. Replaced that cast with explicit normalization that keeps only valid mock response objects or sequences, ignores malformed scenario entries without failing the whole request, and added focused tests to lock the behavior down.
