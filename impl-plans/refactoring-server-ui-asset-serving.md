# Server UI Asset Serving Refactoring Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-refactoring-server-ui-asset-serving.md, design-docs/specs/architecture.md#local-http-server-rielflow-serve
**Created**: 2026-03-10
**Last Updated**: 2026-03-09

## Summary

Extract built frontend asset serving from `src/server/api.ts` into a dedicated server helper module so the API route module remains focused on routing, mode checks, orchestration, and JSON transport responses.

## Scope

Included:

- design record for the extraction boundary
- server helper module under `src/server/`
- `src/server/api.ts` migration away from inline built-UI asset serving details
- verification through targeted server tests and typechecks

Not included:

- full route-handler decomposition for all API endpoints
- frontend asset contract changes
- browser UI behavior changes

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-refactoring-server-ui-asset-serving.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record the mixed built-UI asset responsibility remaining in `src/server/api.ts`
- [x] Define the server helper boundary for UI asset serving

### 2. Server Helper Extraction

#### `src/server/ui-assets.ts`, `src/server/api.ts`

**Status**: COMPLETED

```ts
export async function tryServeBuiltUiAsset(
  urlPath: string,
  context: UiAssetContext,
): Promise<Response | undefined>;

export function missingUiResponse(): Response;
```

**Checklist**:
- [x] Move default `ui/dist/` resolution into the helper
- [x] Move built asset path normalization and traversal rejection into the helper
- [x] Move content-type resolution into the helper
- [x] Keep `src/server/api.ts` responsible only for route decisions about when to serve the UI

### 3. Verification

#### `src/server/api.test.ts`

**Status**: COMPLETED

**Checklist**:
- [x] Run `bun run typecheck:server`
- [x] Run `bun test src/server/api.test.ts src/server/api-request.test.ts`
- [x] Preserve existing UI asset serving behavior under tests

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Server helper extraction | none | COMPLETED |
| Verification | server helper extraction | COMPLETED |

## Completion Criteria

- [x] Design document exists for this refactoring slice
- [x] `src/server/api.ts` no longer owns built-UI asset path/content-type logic
- [x] Built UI root requests still return the canonical unavailable response when assets are missing
- [x] Built UI asset serving tests still pass
- [x] Server typecheck passes

## Progress Log

### Session: 2026-03-10 11:30
**Tasks Completed**: Design assessment, implementation plan creation, server helper extraction, verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation review found that the architecture already describes `src/server/api.ts` as the routing/orchestration layer, but the module still embedded built frontend asset path normalization, content-type mapping, and missing-UI response rendering. Extracted those concerns into `src/server/ui-assets.ts`, kept route selection in `api.ts`, and re-ran the touched checks/tests.

### Session: 2026-03-09 19:45
**Tasks Completed**: Follow-up built-asset MIME hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation review of the ongoing frontend migration found a remaining replaceable-frontend risk in the asset helper: it only recognized a narrow set of extensions, which was fine for the current bundle but brittle for future Vite/Solid output. Expanded MIME coverage for common JavaScript module, source map, image, and font assets and added route-level regression tests so frontend framework cutover does not silently regress asset serving.
