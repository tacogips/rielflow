# Scoped Workflow Source Visibility Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-user-scope-workflows.md#workflow-lookup
**Created**: 2026-04-21
**Last Updated**: 2026-04-21

---

## Design Document Reference

**Source**: design-docs/specs/design-user-scope-workflows.md

### Summary

Make command output show the resolved workflow source after scoped catalog
lookup so project/user shadowing is visible to operators.

### Scope

**Included**: local CLI validate, inspect, and run output for scoped and direct
workflow sources, plus regression coverage.

**Excluded**: GraphQL schema source metadata, TUI grouped duplicate-name
selection, scoped local add-on manifests, bootstrap/scope config files, and log
root routing.

---

## Modules

### 1. CLI Source Formatting

#### src/cli.ts

**Status**: COMPLETED

```typescript
function formatWorkflowSource(source: ResolvedWorkflowSource | undefined): string | undefined;
function workflowSourceJson(source: ResolvedWorkflowSource | undefined): WorkflowSourceJson | undefined;
```

**Checklist**:

- [x] Add a reusable source formatter for text output
- [x] Add source metadata to validate JSON output
- [x] Add source metadata to inspect JSON output
- [x] Add source metadata to local run JSON output
- [x] Print source lines in validate, inspect, and local run text output

### 2. Regression Coverage

#### src/cli.test.ts

**Status**: COMPLETED

```typescript
test("workflow commands report scoped source metadata", async () => {
  // Validates text and JSON command output for a user-scope workflow.
});
```

**Checklist**:

- [x] Cover text validate source visibility
- [x] Cover JSON inspect source metadata
- [x] Cover JSON run source metadata

## Module Status

| Module                | File Path         | Status    | Tests   |
| --------------------- | ----------------- | --------- | ------- |
| CLI source formatting | `src/cli.ts`      | COMPLETED | Passing |
| Regression coverage   | `src/cli.test.ts` | COMPLETED | Passing |

## Dependencies

| Feature                          | Depends On                            | Status    |
| -------------------------------- | ------------------------------------- | --------- |
| Scoped workflow source visibility | Scoped workflow GraphQL/server follow-up | Available |

## Completion Criteria

- [x] CLI output exposes the resolved scope
- [x] CLI output exposes the resolved workflow directory
- [x] Project/user shadowing is visible in command output
- [x] Type checking passes
- [x] Focused tests pass

## Progress Log

### Session: 2026-04-21 09:32

**Tasks Completed**: TASK-001 and TASK-002.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added this follow-up after reviewing the scoped workflow design
against the current implementation and finding that command output did not
surface the resolved source required by the design.

## Related Plans

- **Previous**: `impl-plans/scoped-workflow-graphql-server.md`
- **Next**: TUI grouped workflow selection and scoped local add-on manifests
- **Depends On**: `scoped-workflow-graphql-server`
