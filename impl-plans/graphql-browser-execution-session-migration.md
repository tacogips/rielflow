# GraphQL Browser Execution and Session Migration Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Previous**: `impl-plans/graphql-manager-control-plane-surface.md`
- **Previous**: `impl-plans/graphql-cli-execution-transport.md`
- **Depends On**: `impl-plans/graphql-manager-control-plane-surface.md`

---

## Design Document Reference

**Source**:

- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/architecture.md`

### Summary

Migrate the browser editor's workflow execution and session inspection transport from REST endpoints to GraphQL while keeping workflow-definition editing on the existing REST APIs for now.

### Scope

**Included**:

- GraphQL query support for listing workflow-execution summaries needed by the browser session panel
- GraphQL input support for browser execution options already exposed by the REST execution route
- browser-side GraphQL transport for session list/load/execute/cancel flows
- focused regression coverage for schema, HTTP transport, and browser API client behavior

**Excluded**:

- workflow-definition create/load/save/validate browser migration to GraphQL
- browser manager-message / communication replay UI
- removal of the existing REST `/api/sessions` or workflow execution routes

---

## Modules

### 1. GraphQL Workflow Execution Listing and Execute Input Parity

#### `src/graphql/types.ts`, `src/graphql/schema.ts`

**Status**: COMPLETED

```typescript
export interface WorkflowExecutionsQueryInput {
  readonly workflowName?: string;
  readonly status?: WorkflowSessionState["status"];
  readonly first?: number;
  readonly afterWorkflowExecutionId?: string;
}

export interface WorkflowExecutionConnection {
  readonly items: readonly WorkflowExecutionSummary[];
  readonly totalCount: number;
  readonly nextCursor?: string;
}

export interface ExecuteWorkflowInput {
  readonly workflowName: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly mockScenario?: MockNodeScenario;
  readonly async?: boolean;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
}
```

**Checklist**:

- [x] Add a GraphQL workflow-execution summary connection query
- [x] Add browser REST-parity execute input fields needed by the browser execution form
- [x] Keep existing GraphQL CLI and manager-control behavior compatible
- [x] Add schema-level tests

### 2. Browser GraphQL Transport Adoption

#### `ui/src/lib/api-client.ts`

**Status**: COMPLETED

```typescript
interface GraphqlEnvelope<TData> {
  readonly data?: TData;
  readonly errors?: readonly { readonly message: string }[];
}

interface WorkflowExecutionsGraphqlData {
  readonly workflowExecutions: WorkflowExecutionConnection;
}
```

**Checklist**:

- [x] Route browser session list through GraphQL
- [x] Route browser workflow-execution load through GraphQL
- [x] Route browser execute and cancel actions through GraphQL
- [x] Preserve existing browser-facing response shapes for editor code

### 3. Regression Coverage

#### `src/server/graphql.test.ts`, `src/graphql/schema.test.ts`, `ui/src/lib/api-client.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Cover the new workflow-execution list query over the GraphQL schema and HTTP transport
- [x] Cover browser GraphQL request/response mapping for sessions and execution
- [x] Re-run browser E2E after the transport swap

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| GraphQL execution list + execute parity | `src/graphql/types.ts`, `src/graphql/schema.ts` | COMPLETED | Passed |
| Browser GraphQL transport adoption | `ui/src/lib/api-client.ts` | COMPLETED | Passed |
| Regression coverage | `src/server/graphql.test.ts`, `src/graphql/schema.test.ts`, `ui/src/lib/api-client.test.ts` | COMPLETED | Passed |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Browser session list migration | `graphql-manager-control-plane-surface` | Available |
| Browser execute/cancel migration | GraphQL execute parity | Available |
| Browser verification | Browser GraphQL transport adoption | Ready |

## Tasks

### TASK-001: Add GraphQL Workflow Execution Listing and Execute Parity

**Status**: Completed
**Parallelizable**: No

**Deliverables**:

- `src/graphql/types.ts`
- `src/graphql/schema.ts`
- `src/graphql/schema.test.ts`
- `src/server/graphql.test.ts`

**Completion Criteria**:

- [x] GraphQL can list workflow execution summaries for the browser
- [x] GraphQL execute accepts browser execution options used by the editor
- [x] Schema and HTTP tests pass

### TASK-002: Switch Browser Session and Execution Transport to GraphQL

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-001`

**Deliverables**:

- `ui/src/lib/api-client.ts`
- `ui/src/lib/api-client.test.ts`

**Completion Criteria**:

- [x] Browser session list/load use GraphQL
- [x] Browser execute/cancel use GraphQL
- [x] Existing editor-facing types remain unchanged

### TASK-003: Verify the Browser Migration Slice

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-002`

**Deliverables**:

- Verification only

**Completion Criteria**:

- [x] `bun run test`
- [x] `bun run typecheck`
- [x] `bun run test:e2e`
- [x] Browser verification completed or environment blocker recorded precisely

## Completion Criteria

- [x] Browser execution/session transport uses GraphQL instead of REST
- [x] Browser workflow-definition editing remains on REST without regression
- [x] All tests passing
- [x] Type checking passes

## Progress Log

### Session: 2026-03-15 16:20 JST
**Tasks Completed**: Plan creation
**Tasks In Progress**: TASK-001
**Blockers**: None
**Notes**: This slice intentionally stops at browser execution/session transport. Workflow-definition CRUD and validation remain on REST until a separate GraphQL editor-definition design slice exists.

### Session: 2026-03-15 16:40 JST
**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added GraphQL workflow-execution listing and async execute parity, switched the browser session/execution transport to GraphQL, added schema/HTTP/UI client regression coverage, updated the file-backed Playwright harness for `/graphql`, and fixed the workflow selector to resync its native `<select>` value after workflow creation. Verification passed with `bun run test`, `bun run typecheck`, `bun run test:e2e`, and a live `agent-browser open/snapshot/screenshot` run against `http://127.0.0.1:43173`.
