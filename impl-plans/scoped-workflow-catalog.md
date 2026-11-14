# Scoped Workflow Catalog Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-user-scope-workflows.md#workflow-lookup
**Created**: 2026-04-21
**Last Updated**: 2026-04-21

---

## Design Document Reference

**Source**: design-docs/specs/design-user-scope-workflows.md

### Summary

Implement project/user scoped workflow lookup while supporting direct
`--workflow-definition-dir` mode for examples and automation.

### Scope

**Included**: scoped root resolution, catalog workflow lookup, scoped
`workflow create` destinations, CLI flags, and tests for the first local CLI
path.

**Excluded**: local add-on manifest loading, bootstrap/scope config files,
operator log routing, full TUI grouped display, GraphQL source-scope metadata,
and cross-scope workflow call resolution.

---

## Modules

### 1. Scoped Catalog Resolver

#### src/workflow/catalog.ts

**Status**: COMPLETED

```typescript
type WorkflowScopeSelector = "auto" | "project" | "user";
type WorkflowSourceScope = "project" | "user" | "direct";

interface ResolvedWorkflowSource {
  readonly scope: WorkflowSourceScope;
  readonly workflowRoot: string;
  readonly workflowName: string;
  readonly workflowDirectory: string;
  readonly scopeRoot?: string;
  readonly legacyProjectRoot?: boolean;
}

interface WorkflowCatalogOptions extends LoadOptions {
  readonly workflowScope?: WorkflowScopeSelector;
  readonly userRoot?: string;
  readonly projectRoot?: string;
}
```

**Checklist**:

- [x] Define scope selector/source types
- [x] Resolve direct workflow-definition-dir mode
- [x] Resolve project/user catalog candidates
- [x] Resolve create destinations
- [x] Produce scoped runtime defaults for loaded workflows
- [x] Unit tests

### 2. Loader Integration

#### src/workflow/load.ts

**Status**: COMPLETED

```typescript
async function loadWorkflowFromCatalog(
  workflowName: string,
  options?: WorkflowCatalogOptions,
): Promise<Result<LoadedWorkflow, LoadFailure>>;
```

**Checklist**:

- [x] Add catalog-aware load function
- [x] Keep loadWorkflowFromDisk direct-root behavior
- [x] Attach resolved source metadata to loaded workflows
- [x] Unit tests

### 3. Create Integration

#### src/workflow/create.ts

**Status**: COMPLETED

```typescript
async function createWorkflowTemplate(
  workflowName: string,
  options?: CreateWorkflowTemplateOptions,
): Promise<Result<CreateWorkflowSuccess, CreateWorkflowFailure>>;
```

**Checklist**:

- [x] Use scoped create root unless direct workflow root is supplied
- [x] Preserve existing direct-root behavior
- [x] Unit tests

### 4. CLI Wiring

#### src/cli.ts

**Status**: COMPLETED

```typescript
interface ParsedOptions {
  readonly workflowScope?: WorkflowScopeSelector;
  readonly userRoot?: string;
  readonly projectRoot?: string;
}
```

**Checklist**:

- [x] Parse `--scope`, `--user-root`, and `--project-root`
- [x] Use catalog loading for local `workflow validate|inspect|run`
- [x] Use scoped create destinations for `workflow create`
- [x] Keep remote GraphQL execution payload unchanged
- [x] CLI tests

---

## Module Status

| Module                  | File Path                 | Status    | Tests   |
| ----------------------- | ------------------------- | --------- | ------- |
| Scoped catalog resolver | `src/workflow/catalog.ts` | COMPLETED | Passing |
| Loader integration      | `src/workflow/load.ts`    | COMPLETED | Passing |
| Create integration      | `src/workflow/create.ts`  | COMPLETED | Passing |
| CLI wiring              | `src/cli.ts`              | COMPLETED | Passing |

## Dependencies

| Feature                   | Depends On                  | Status    |
| ------------------------- | --------------------------- | --------- |
| Scoped workflow catalog   | User scope workflows design | Available |
| Local add-on roots        | Scoped workflow catalog     | BLOCKED   |
| TUI grouped workflow list | Scoped workflow catalog     | BLOCKED   |

## Completion Criteria

- [x] Scoped catalog resolves project workflows before user workflows
- [x] `--scope user` and `--scope project` select only that scope
- [x] `--workflow-definition-dir` and `DIVEDRA_WORKFLOW_DEFINITION_DIR` are direct definition directory overrides
- [x] `workflow create` writes to canonical scoped layout by default
- [x] Existing example commands with `--workflow-definition-dir ./examples` still work
- [x] Type checking passes
- [x] Focused tests pass

## Progress Log

### Session: 2026-04-21 00:00

**Tasks Completed**: TASK-001 through TASK-004 first slice.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: This iteration intentionally excludes add-on manifests, config-file
resolution, log routing, and full TUI grouped display. Verified with
`bun run typecheck`, `bun test src/workflow/load.test.ts`,
`bun test src/cli.test.ts`, and `bun run test`.

## Related Plans

- **Previous**: None
- **Next**: local add-on manifest loading and TUI grouped workflow display
- **Depends On**: None
