# Server Workflow Bundle Parsing Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-server-workflow-bundle-parsing.md, design-docs/specs/architecture.md#local-http-server-divedra-serve
**Created**: 2026-03-09
**Last Updated**: 2026-03-09

## Summary

Extract workflow bundle save/validate request parsing from `src/server/api.ts` into a dedicated server helper with stricter JSON-object checks and explicit malformed-request handling.

## Scope

Included:

- design record for the extraction
- server helper module under `src/server/`
- `src/server/api.ts` migration away from inline bundle parsing
- regression tests for malformed array-shaped bundle payloads

Not included:

- broader server route decomposition
- workflow schema redesign
- frontend request changes

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-refactoring-server-workflow-bundle-parsing.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record the remaining bundle-parsing responsibility concentration in `src/server/api.ts`
- [x] Define the dedicated server helper as the next extraction boundary

### 2. Server Helper Extraction

#### `src/server/api-workflow-bundle.ts`, `src/server/api.ts`

**Status**: COMPLETED

```ts
export function readWorkflowSaveRequest(body: unknown): WorkflowSaveRequestParseResult;
export function readWorkflowValidationBundle(body: unknown): WorkflowValidationBundleParseResult;
```

**Checklist**:
- [x] Move workflow bundle parsing out of `src/server/api.ts`
- [x] Enforce JSON-object checks for bundle sections
- [x] Centralize validation-time node-payload remapping

### 3. Verification

#### `src/server/api.test.ts`

**Status**: COMPLETED

**Checklist**:
- [x] Run `bun run typecheck:server`
- [x] Run `bun run typecheck:ui`
- [x] Run targeted Bun tests for the touched server modules

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Server helper extraction | server API request parsing | READY |
| Verification | server helper extraction | COMPLETED |

## Completion Criteria

- [x] Design document exists for this refactoring slice
- [x] `src/server/api.ts` no longer owns inline workflow bundle parsing for save/validate
- [x] Malformed array-shaped bundle sections are rejected at the route boundary
- [x] Validation-time node-payload remapping is centralized in one helper
- [x] Repository typechecks pass
- [x] Targeted Bun tests pass

## Progress Log

### Session: 2026-03-09 15:10
**Tasks Completed**: Design assessment, implementation plan creation, server helper extraction, verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation review found that the documented server-helper architecture still had one material mismatch: `src/server/api.ts` still owned workflow bundle request parsing and weak object checks for save/validate routes. This slice extracted that parsing into `src/server/api-workflow-bundle.ts`, tightened the route boundary to require JSON objects instead of generic objects, added regression coverage for array-shaped malformed bundle payloads, and reran the targeted typecheck and Bun test commands successfully.
