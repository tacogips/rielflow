# Scoped Workflow Runtime Follow-up Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-user-scope-workflows.md#first-implementation-boundary
**Created**: 2026-04-21
**Last Updated**: 2026-04-21

---

## Design Document Reference

**Source**: design-docs/specs/design-user-scope-workflows.md

### Summary

Close the first follow-up gaps from scoped workflow catalog implementation:
public local execution/inspection wrappers and event validation/dispatch must
use the same catalog semantics as CLI workflow commands, and invalid scope
selectors must fail explicitly.

### Scope

**Included**: CLI scope validation, library execution/inspection catalog
resolution, local event workflow validation catalog enumeration, event dispatch
scope option forwarding, and regression tests.

**Excluded**: TUI duplicate-name grouped selection, local add-on manifest
loading, bootstrap/scope config files, log-root routing, and cross-scope
workflow call resolution.

---

## Modules

### 1. CLI Scope Validation

#### src/cli.ts

**Status**: COMPLETED

```typescript
type WorkflowScopeSelector = "auto" | "project" | "user";

interface ParsedArgs {
  readonly positionals: string[];
  readonly options: ParsedOptions;
  readonly error?: string;
}
```

**Checklist**:

- [x] Reject invalid `--scope` values
- [x] Reject invalid `DIVEDRA_WORKFLOW_SCOPE` values
- [x] Add CLI regression tests

### 2. Library Catalog Resolution

#### src/lib.ts

**Status**: COMPLETED

```typescript
async function resolveWorkflowCatalogOptions<T extends DivedraOptions>(
  workflowName: string,
  options: T,
): Promise<T>;
```

**Checklist**:

- [x] Resolve catalog source before local library execution
- [x] Resolve catalog source before local async GraphQL-backed execution
- [x] Resolve catalog source before public inspection
- [x] Preserve direct `workflowRoot` compatibility
- [x] Add user-scope execution regression test

### 3. Event Catalog Integration

#### src/events/validate.ts
#### src/events/trigger-runner.ts

**Status**: COMPLETED

```typescript
async function listWorkflowCatalogSources(
  options?: LoadOptions,
): Promise<Result<readonly ResolvedWorkflowSource[], WorkflowCatalogFailure>>;
```

**Checklist**:

- [x] Validate event bindings against catalog workflow names
- [x] Forward scope and add-on resolver options into local event dispatch
- [x] Add user-scope event validation regression test

---

## Module Status

| Module                     | File Path                                        | Status    | Tests   |
| -------------------------- | ------------------------------------------------ | --------- | ------- |
| CLI scope validation       | `src/cli.ts`                                     | COMPLETED | Passing |
| Library catalog resolution | `src/lib.ts`                                     | COMPLETED | Passing |
| Event catalog integration  | `src/events/validate.ts`, `src/events/trigger-runner.ts` | COMPLETED | Passing |

## Dependencies

| Feature                         | Depends On                | Status    |
| ------------------------------- | ------------------------- | --------- |
| Runtime catalog follow-up       | Scoped workflow catalog   | Available |
| TUI grouped workflow selection  | Runtime catalog follow-up | BLOCKED   |
| Local add-on manifests          | Runtime catalog follow-up | BLOCKED   |

## Completion Criteria

- [x] Invalid scope selectors fail with usage errors
- [x] `inspectWorkflow` can inspect a user-scope workflow
- [x] `executeWorkflow` can execute a user-scope workflow
- [x] Event config validation recognizes user-scope workflow bindings
- [x] Type checking passes
- [x] Focused tests pass

## Progress Log

### Session: 2026-04-21 00:00

**Tasks Completed**: TASK-001 through TASK-003.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Verified with `bun run typecheck` and focused tests covering CLI,
library, and event configuration paths.

## Related Plans

- **Previous**: `impl-plans/scoped-workflow-catalog.md`
- **Next**: TUI grouped workflow selection and scoped local add-on manifests
- **Depends On**: `scoped-workflow-catalog`
