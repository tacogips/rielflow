# Frontend Tooling Package Root Alignment Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-workflow-web-editor.md#frontend-build-contract
**Created**: 2026-03-09
**Last Updated**: 2026-03-09

---

## Design Document Reference

**Source**: `design-docs/specs/design-workflow-web-editor.md`

### Summary
Make every repository-level UI tooling entrypoint resolve the package root from the checked-in script location instead of the caller's current working directory.

### Scope
**Included**: shared package-root helper, framework-status/typecheck/test/e2e script alignment, regression coverage, design sync
**Excluded**: frontend mode contract changes, browser feature work, broader repository script normalization

---

## Modules

### 1. Shared Script Package Resolution

#### scripts/ui-framework.mjs

**Status**: COMPLETED

```typescript
export function resolvePackageOptionsFromModuleUrl(moduleUrl: string): {
  readonly baseDir: string;
  readonly packageRoot: string;
  readonly uiRoot: string;
};
```

**Checklist**:
- [x] Define a shared helper for repository-root-relative UI tooling options
- [x] Keep package root and UI root aligned in one place
- [x] Cover helper behavior with focused tests

### 2. Tooling Entry Point Alignment

#### scripts/run-ui-typecheck.mjs
#### scripts/run-ui-framework-status.mjs
#### scripts/run-ui-vitest.mjs
#### scripts/run-ui-vitest-ui.mjs
#### scripts/run-ui-e2e.mjs

**Status**: COMPLETED

```typescript
const packageOptions = resolvePackageOptionsFromModuleUrl(import.meta.url);
```

**Checklist**:
- [x] Stop relying on `process.cwd()` for framework detection
- [x] Resolve workspace package binaries from the repository package root
- [x] Execute child tooling with the repository package root as `cwd`

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Shared package-root helper | `scripts/ui-framework.mjs` | COMPLETED | `src/server/ui-framework.test.ts` |
| UI tooling entrypoints | `scripts/run-ui-*.mjs` | COMPLETED | `bun run typecheck:ui`, `bun run test:ui`, `bun run build:ui` |
| Design sync | `README.md`, `design-docs/specs/architecture.md`, `design-docs/specs/design-workflow-web-editor.md` | COMPLETED | Review |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Package-root aligned UI tooling commands | `frontend-mode-package-root-alignment` | Available |

## Completion Criteria

- [x] Repository-level UI tooling entrypoints no longer depend on caller cwd
- [x] Shared helper centralizes package-root/UI-root alignment
- [x] Focused tests pass
- [x] Design/docs describe the aligned contract

## Progress Log

### Session: 2026-03-09 13:25
**Tasks Completed**: Plan creation, shared helper implementation, script alignment, regression coverage, design sync
**Tasks In Progress**: None
**Blockers**: None
**Notes**: This closes the remaining tooling mismatch after the built-asset package-root alignment work. `build:ui` had become repository-root aware, but sibling UI commands still depended on the invoker's cwd and could drift from the package root that owns `ui/`, `package.json`, and `node_modules`.

## Related Plans

- **Previous**: `impl-plans/frontend-mode-package-root-alignment.md`
- **Next**: (none)
- **Depends On**: `impl-plans/frontend-mode-package-root-alignment.md`
