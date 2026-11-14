# Frontend Mode Built Asset Contract Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-workflow-web-editor.md#frontend-build-contract
**Created**: 2026-03-09
**Last Updated**: 2026-03-09

---

## Design Document Reference

**Source**: `design-docs/specs/design-workflow-web-editor.md`

### Summary
Make the served `ui/dist` bundle publish its frontend identity explicitly and make `/api/ui-config` prefer that built-asset contract over source-entrypoint inference.

### Scope
**Included**: built metadata emission, server-side metadata consumption, regression tests, architecture/design sync
**Excluded**: broader execution/session persistence fixes, browser harness redesign, frontend framework replacement

---

## Modules

### 1. Built Asset Metadata

#### scripts/ui-built-assets.mjs

**Status**: COMPLETED

```typescript
export const BUILT_FRONTEND_MODE_METADATA_FILE: "frontend-mode.json";

export function parseBuiltFrontendModeMetadata(
  metadataJson: string,
): "solid-dist";

export function serializeBuiltFrontendModeMetadata(
  frontendMode: "solid-dist",
): string;
```

**Checklist**:
- [x] Define the built frontend metadata filename contract
- [x] Validate/parse metadata JSON explicitly
- [x] Serialize metadata for the UI build step
- [x] Cover parsing with focused tests

### 2. Build and Server Wiring

#### scripts/run-ui-build.mjs
#### src/server/ui-assets.ts

**Status**: COMPLETED

```typescript
interface UiAssetContext {
  readonly uiDistRoot?: string;
  readonly frontendMode?: "solid-dist";
  readonly frontendModeModuleUrl?: string;
}

function detectFrontendMode(
  context?: UiAssetContext,
  moduleUrl?: string,
): "solid-dist";
```

**Checklist**:
- [x] Emit built frontend metadata into `ui/dist/` after successful UI builds
- [x] Prefer built metadata over source-entrypoint detection in server bootstrap
- [x] Preserve explicit override behavior for tests/forced deployments
- [x] Fail explicitly on invalid built metadata

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Built frontend metadata helpers | `scripts/ui-built-assets.mjs` | COMPLETED | `src/server/ui-built-assets.test.ts` |
| UI build metadata emission | `scripts/run-ui-build.mjs` | COMPLETED | Covered by `bun run build:ui` |
| UI bootstrap frontend-mode detection | `src/server/ui-assets.ts` | COMPLETED | `src/server/api.test.ts` |
| Design sync | `design-docs/specs/design-workflow-web-editor.md`, `design-docs/specs/architecture.md`, `README.md` | COMPLETED | Review |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Built frontend mode contract | Existing SolidJS build path and UI asset serving | Available |

## Completion Criteria

- [x] Built UI publishes explicit frontend mode metadata
- [x] `/api/ui-config` prefers built metadata when available
- [x] Invalid built metadata fails explicitly
- [x] Architecture/design docs match the served-asset contract
- [x] Focused tests, typecheck, and UI build pass

## Progress Log

### Session: 2026-03-09 00:00
**Tasks Completed**: Plan creation, built metadata contract implementation, regression coverage, design sync
**Tasks In Progress**: None
**Blockers**: None
**Notes**: This slice closes the mismatch where the server reported frontend mode from source entrypoints even though it serves `ui/dist`. The new contract keeps explicit overrides, prefers built metadata when present, and falls back to source detection only for pre-rebuild local states.

## Related Plans

- **Previous**: `impl-plans/refactoring-frontend-solidjs-migration.md`
- **Next**: (none)
- **Depends On**: `impl-plans/refactoring-server-ui-asset-serving.md`
