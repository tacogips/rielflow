# Scoped Workflow GraphQL Server Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-user-scope-workflows.md#first-implementation-boundary
**Created**: 2026-04-21
**Last Updated**: 2026-04-21

---

## Design Document Reference

**Source**: design-docs/specs/design-user-scope-workflows.md

### Summary

Close the remaining scoped catalog gap in GraphQL/server workflow definition
and execution surfaces. Browser editor and `serve` operations must use the same
project/user catalog source as CLI, TUI, library, and event paths.

### Scope

**Included**: GraphQL workflow list, inspection, definition load, validation,
save, execution, resume/rerun execution source resolution, and regression tests.

**Excluded**: TUI duplicate-name grouped selection, local add-on manifest
loading, bootstrap/scope config files, log-root routing, and cross-scope
workflow call resolution.

---

## Modules

### 1. GraphQL Catalog Helpers

#### src/graphql/schema.ts

**Status**: COMPLETED

```typescript
async function loadWorkflowDefinitionForGraphql(
  workflowName: string,
  context: GraphqlRequestContext,
): Promise<LoadedWorkflow | null>;

async function resolveWorkflowContextForGraphql(
  workflowName: string,
  context: GraphqlRequestContext,
): Promise<GraphqlRequestContext>;
```

**Checklist**:

- [x] Resolve workflow list through `listWorkflowCatalogSources`
- [x] Resolve inspected definitions through `loadWorkflowFromCatalog`
- [x] Preserve fixed-workflow access checks
- [x] Preserve direct workflow-definition-dir compatibility

### 2. GraphQL Mutations

#### src/graphql/schema.ts

**Status**: COMPLETED

```typescript
async function saveWorkflowDefinitionMutation(
  input: SaveWorkflowDefinitionInput,
  context: GraphqlRequestContext,
): Promise<SaveWorkflowDefinitionPayload>;

async function executeWorkflowMutation(
  input: ExecuteWorkflowInput,
  context: GraphqlRequestContext,
): Promise<ExecuteWorkflowPayload>;
```

**Checklist**:

- [x] Save existing workflow definitions back to their resolved source scope
- [x] Run scoped workflows with scoped runtime defaults
- [x] Resolve resume/rerun workflow roots from the stored workflow name
- [x] Keep explicit runtime root overrides higher precedence

### 3. Regression Coverage

#### src/graphql/schema.test.ts

#### src/workflow/catalog.ts

**Status**: COMPLETED

```typescript
test("resolves scoped user workflows through GraphQL schema operations", async () => {
  // Lists, inspects, saves, and executes a user-scope workflow.
});
```

**Checklist**:

- [x] User-scope GraphQL workflow list works
- [x] User-scope GraphQL inspection and definition loading work
- [x] User-scope GraphQL save writes to `<userRoot>/workflows`
- [x] User-scope GraphQL execution completes
- [x] Catalog listing ignores unsafe workflow directory names

## Module Status

| Module                  | File Path                                               | Status    | Tests   |
| ----------------------- | ------------------------------------------------------- | --------- | ------- |
| GraphQL catalog helpers | `src/graphql/schema.ts`                                 | COMPLETED | Passing |
| GraphQL mutations       | `src/graphql/schema.ts`                                 | COMPLETED | Passing |
| Regression coverage     | `src/graphql/schema.test.ts`, `src/workflow/catalog.ts` | COMPLETED | Passing |

## Dependencies

| Feature                        | Depends On                        | Status    |
| ------------------------------ | --------------------------------- | --------- |
| GraphQL scoped catalog support | Scoped workflow runtime follow-up | Available |
| TUI grouped workflow selection | GraphQL scoped catalog support    | BLOCKED   |
| Local add-on manifests         | GraphQL scoped catalog support    | BLOCKED   |

## Completion Criteria

- [x] GraphQL queries use catalog workflow lookup
- [x] GraphQL save uses the resolved workflow source
- [x] GraphQL execution uses scoped workflow roots and runtime defaults
- [x] Direct `workflowRoot` behavior remains compatible
- [x] Type checking passes
- [x] Focused tests pass

## Progress Log

### Session: 2026-04-21 00:00

**Tasks Completed**: TASK-001 through TASK-003.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added GraphQL/server catalog source resolution after reviewing the
existing scoped workflow diff against the first implementation boundary.

## Related Plans

- **Previous**: `impl-plans/scoped-workflow-runtime-follow-up.md`
- **Next**: TUI grouped workflow selection and scoped local add-on manifests
- **Depends On**: `scoped-workflow-runtime-follow-up`
