# Scoped Workflow Catalog Safety Follow-up Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-user-scope-workflows.md#runtime-root-defaults
**Created**: 2026-04-21
**Last Updated**: 2026-04-21

---

## Design Document Reference

**Source**: design-docs/specs/design-user-scope-workflows.md

### Summary

Close review findings from the scoped workflow catalog implementation. Scope
selector validation and runtime-root co-location must be enforced by the shared
catalog layer, not only by CLI command parsing.

### Scope

**Included**: invalid `DIVEDRA_WORKFLOW_SCOPE` handling in catalog-backed APIs,
explicit runtime storage-root inference for scoped loads, event validation error
surfacing, and regression tests.

**Excluded**: bootstrap config files, scope config files, local add-on manifest
loading, log-root routing, and TUI duplicate-name grouped selection.

---

## Modules

### 1. Shared Catalog Validation

#### src/workflow/catalog.ts

**Status**: COMPLETED

```typescript
function resolveWorkflowScopeSelector(
  options?: LoadOptions,
): WorkflowScopeSelector;

async function resolveWorkflowSource(
  workflowName: string,
  options?: LoadOptions,
): Promise<Result<ResolvedWorkflowSource, WorkflowCatalogFailure>>;
```

**Checklist**:

- [x] Reject invalid `DIVEDRA_WORKFLOW_SCOPE` values in catalog resolution
- [x] Propagate `INVALID_SCOPE` through create and load result types
- [x] Keep direct `workflowRoot` compatibility behavior unchanged
- [x] Add catalog regression tests

### 2. Runtime Root Co-location

#### src/workflow/catalog.ts

#### src/workflow/types.ts

**Status**: COMPLETED

```typescript
interface LoadOptions {
  readonly artifactRoot?: string;
  readonly rootDataDir?: string;
  readonly sessionStoreRoot?: string;
}
```

**Checklist**:

- [x] Preserve explicit `rootDataDir`/`DIVEDRA_ARTIFACT_DIR`
- [x] Infer `rootDataDir` from explicit artifact/session roots when available
- [x] Fall back to owning scope artifacts only when no explicit runtime root applies
- [x] Add session-store-only scoped load regression test

### 3. Public Surface Regression Coverage

#### src/events/validate.ts

#### src/lib.test.ts

#### src/graphql/schema.test.ts

**Status**: COMPLETED

```typescript
async function validateEventConfiguration(
  configuration: EventConfiguration,
  options?: EventConfigLoadOptions,
): Promise<EventConfigValidationResult>;
```

**Checklist**:

- [x] Surface catalog lookup failures in event validation
- [x] Verify library wrappers reject invalid workflow scope env values
- [x] Verify GraphQL schema operations reject invalid workflow scope env values
- [x] Run focused tests and type checking

---

## Module Status

| Module                     | File Path                                                                 | Status    | Tests   |
| -------------------------- | ------------------------------------------------------------------------- | --------- | ------- |
| Shared catalog validation  | `src/workflow/catalog.ts`                                                 | COMPLETED | Passing |
| Runtime root co-location   | `src/workflow/catalog.ts`, `src/workflow/types.ts`                        | COMPLETED | Passing |
| Public regression coverage | `src/events/validate.ts`, `src/lib.test.ts`, `src/graphql/schema.test.ts` | COMPLETED | Passing |

## Dependencies

| Feature                        | Depends On                          | Status    |
| ------------------------------ | ----------------------------------- | --------- |
| Catalog safety follow-up       | `scoped-workflow-runtime-follow-up` | Available |
| Local add-on manifests         | Catalog safety follow-up            | BLOCKED   |
| TUI grouped workflow selection | Catalog safety follow-up            | BLOCKED   |

## Completion Criteria

- [x] Invalid `DIVEDRA_WORKFLOW_SCOPE` cannot silently fall back to `auto`
- [x] Catalog load/list/create paths propagate invalid scope errors
- [x] Event validation reports catalog configuration errors
- [x] Explicit session-store roots keep scoped artifact roots co-located
- [x] Type checking passes
- [x] Focused tests pass

## Progress Log

### Session: 2026-04-21 00:40

**Tasks Completed**: TASK-001 through TASK-003.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Reviewed the scoped workflow diff and found two cross-surface gaps:
invalid scope env values were guarded only by the CLI, and scoped default
runtime roots could override explicit session-store-only callers. Fixed the
shared catalog behavior, updated event validation error surfacing, and verified
with `bun run typecheck` plus focused catalog/event/library/GraphQL/CLI tests.

## Related Plans

- **Previous**: `impl-plans/scoped-workflow-source-visibility.md`
- **Next**: local add-on manifest loading and TUI grouped workflow display
- **Depends On**: `scoped-workflow-runtime-follow-up`
