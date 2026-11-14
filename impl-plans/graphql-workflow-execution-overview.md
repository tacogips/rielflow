# GraphQL Workflow Execution Overview Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

---

## Design Document Reference

**Source**:

- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/architecture.md`

### Summary

Add a GraphQL query that accepts only `workflowExecutionId` and returns a single overview payload for browser/CLI inspection of executed nodes plus mailbox inbox/outbox snapshots.

### Scope

**Included**:

- GraphQL input/output types for a workflow-execution overview query
- schema resolver composition that derives `workflowId` from the session and aggregates node execution detail plus communication snapshots
- schema and HTTP transport regression tests
- README example for the new query

**Excluded**:

- Browser UI adoption of the new query
- manager-scoped mutations or communication replay changes
- removal of existing `workflowExecution`, `communications`, or `nodeExecution` queries

---

## Modules

### 1. GraphQL Overview Surface

#### `src/graphql/types.ts`, `src/graphql/schema.ts`

**Status**: COMPLETED

```typescript
export interface WorkflowExecutionOverviewLookupInput {
  readonly workflowExecutionId: string;
  readonly recentLogLimit?: number;
  readonly firstCommunications?: number;
  readonly afterCommunicationId?: string;
}

export interface WorkflowExecutionOverviewView {
  readonly workflowExecutionId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly status: WorkflowSessionState["status"];
  readonly session: WorkflowSessionState;
  readonly nodes: readonly NodeExecutionView[];
  readonly communications: CommunicationConnection;
  readonly nodeLogs: readonly RuntimeNodeLogEntry[];
}
```

**Checklist**:

- [x] Add the overview lookup input type
- [x] Add the overview view type
- [x] Add a schema resolver that aggregates session, node detail, and communication snapshots
- [x] Keep existing GraphQL queries backward compatible

### 2. Regression Coverage

#### `src/graphql/schema.test.ts`, `src/server/graphql.test.ts`

**Status**: COMPLETED

```typescript
test("exposes workflow execution overview keyed by workflowExecutionId", async () => {
  // schema and HTTP transport coverage
});
```

**Checklist**:

- [x] Add schema-level overview query coverage
- [x] Add HTTP `/graphql` overview query coverage
- [x] Assert inbox/outbox snapshot fields are present

### 3. Documentation

#### `README.md`

**Status**: COMPLETED

```bash
bun run src/main.ts gql 'query ($workflowExecutionId: String!) { ... }' --variables '{...}'
```

**Checklist**:

- [x] Document the new overview query with a CLI example

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| GraphQL overview surface | `src/graphql/types.ts`, `src/graphql/schema.ts` | COMPLETED | Passed |
| Regression coverage | `src/graphql/schema.test.ts`, `src/server/graphql.test.ts` | COMPLETED | Passed |
| Documentation | `README.md` | COMPLETED | N/A |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Workflow execution overview query | `graphql-browser-execution-session-migration.md` | Available |

## Completion Criteria

- [x] Overview query available over schema and HTTP
- [x] Inbox/outbox snapshots retrievable with only `workflowExecutionId`
- [x] Tests passing
- [x] Type checking passes

## Progress Log

### Session: 2026-03-15 22:32 JST
**Tasks Completed**: Plan creation
**Tasks In Progress**: GraphQL overview surface
**Blockers**: None
**Notes**: This slice adds a convenience aggregation query rather than changing existing execution/session GraphQL fields.

### Session: 2026-03-15 22:38 JST
**Tasks Completed**: GraphQL overview surface, regression coverage, documentation
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added `workflowExecutionOverview(workflowExecutionId)` with node detail and communication snapshot aggregation, covered it in schema and HTTP tests, and documented a CLI query example. Verified with `bun test src/graphql/schema.test.ts src/server/graphql.test.ts` and `bun run typecheck`.

## Related Plans

- **Previous**: `impl-plans/graphql-browser-execution-session-migration.md`
- **Next**: None
- **Depends On**: `impl-plans/graphql-browser-execution-session-migration.md`
