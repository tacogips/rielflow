# Frontend Mode Package Root Alignment Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-workflow-web-editor.md#frontend-build-contract
**Created**: 2026-03-09
**Last Updated**: 2026-03-09

---

## Design Document Reference

**Source**: `design-docs/specs/design-workflow-web-editor.md`

### Summary
Align built frontend metadata lookup with the same package root used for source-entrypoint detection and built asset serving so `/api/ui-config` cannot report frontend mode from an unrelated checked-in `ui/dist`.

### Scope
**Included**: `ui/dist` root resolution alignment, regression coverage, architecture/design sync
**Excluded**: frontend mode format changes, build pipeline redesign, broader server routing changes

---

## Modules

### 1. UI Asset Root Resolution

#### src/server/ui-assets.ts

**Status**: COMPLETED

```typescript
interface UiAssetContext {
  readonly uiDistRoot?: string;
  readonly frontendMode?: "solid-dist";
  readonly frontendModeModuleUrl?: string;
}

function resolveUiDistRoot(
  context: UiAssetContext,
  moduleUrl?: string,
): string;
```

**Checklist**:
- [x] Use explicit `uiDistRoot` when provided
- [x] Otherwise resolve `ui/dist` from the same package root as `frontendModeModuleUrl`
- [x] Preserve the existing explicit frontend override behavior

### 2. Regression Coverage

#### src/server/api.test.ts

**Status**: COMPLETED

```typescript
test("scopes built frontend metadata lookup to the overridden package root", async () => {
  // ...
});
```

**Checklist**:
- [x] Cover metadata preference for overridden package roots
- [x] Keep legacy-entrypoint rejection coverage passing in the presence of checked-in repo metadata

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| UI dist root alignment | `src/server/ui-assets.ts` | COMPLETED | `src/server/api.test.ts` |
| Design sync | `design-docs/specs/design-workflow-web-editor.md`, `design-docs/specs/architecture.md` | COMPLETED | Review |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Package-root aligned frontend mode detection | `frontend-mode-built-asset-contract` | Available |

## Completion Criteria

- [x] Built frontend metadata lookup uses the same package root override as source detection
- [x] Existing legacy-entrypoint and missing-entrypoint failures are no longer masked by unrelated repo-level metadata
- [x] Focused tests pass
- [x] Design/docs reflect the aligned contract

## Progress Log

### Session: 2026-03-09 00:00
**Tasks Completed**: Plan creation, package-root alignment fix, regression coverage, design sync
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The previous built-asset contract preferred checked-in repo metadata even when tests or alternative package roots redirected source-entrypoint detection elsewhere. This slice makes the default `ui/dist` lookup follow the same package root override so served assets and reported frontend mode stay coherent.

## Related Plans

- **Previous**: `impl-plans/frontend-mode-built-asset-contract.md`
- **Next**: (none)
- **Depends On**: `impl-plans/frontend-mode-built-asset-contract.md`
