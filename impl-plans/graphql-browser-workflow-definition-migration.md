# GraphQL Browser Workflow Definition Migration Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md, design-docs/specs/architecture.md
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Previous**: `impl-plans/graphql-browser-execution-session-migration.md`
- **Previous**: `impl-plans/graphql-manager-control-plane-surface.md`
- **Depends On**: `impl-plans/graphql-browser-execution-session-migration.md`

---

## Design Document Reference

**Source**:

- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/architecture.md`

### Summary

Migrate the browser editor's workflow-definition list/load/create/save/validate transport from REST to GraphQL while preserving the existing local workflow-json storage model and REST compatibility endpoints during the migration period.

### Scope

**Included**:

- GraphQL workflow-definition list and load queries needed by the browser editor shell
- GraphQL workflow-definition create/save/validate mutations with REST-parity validation and revision-conflict behavior
- browser-side GraphQL transport for workflow-definition loading and editing actions
- focused regression coverage for schema, HTTP transport, browser API client, and built-UI Playwright harness behavior

**Excluded**:

- removal of existing REST `/api/workflows*` endpoints
- GraphQL-authored workflow definitions that replace on-disk JSON files
- browser communication replay and manager-message UI

---

## Modules

### 1. GraphQL Workflow Definition Surface

#### `src/graphql/types.ts`, `src/graphql/schema.ts`

**Status**: COMPLETED

```typescript
interface SaveWorkflowDefinitionInput {
  readonly workflowName: string;
  readonly bundle: NormalizedWorkflowBundle;
  readonly expectedRevision?: string;
}

interface ValidateWorkflowDefinitionInput {
  readonly workflowName: string;
  readonly bundle?: NormalizedWorkflowBundle;
}
```

**Checklist**:

- [x] Add workflow-definition list/load GraphQL operations for the browser
- [x] Add create/save/validate GraphQL workflow-definition mutations
- [x] Preserve REST-parity validation, revision conflict, and response shapes
- [x] Add schema and HTTP transport tests

### 2. Browser Workflow Definition GraphQL Adoption

#### `ui/src/lib/api-client.ts`

**Status**: COMPLETED

```typescript
interface WorkflowsGraphqlData {
  readonly workflows: readonly string[];
}

interface SaveWorkflowGraphqlData {
  readonly saveWorkflowDefinition: SaveWorkflowResponse;
}
```

**Checklist**:

- [x] Route browser workflow list and load through GraphQL
- [x] Route browser workflow create/save/validate through GraphQL
- [x] Preserve existing editor-facing response shapes and conflict handling
- [x] Keep execution/session GraphQL transport behavior intact

### 3. Regression Coverage

#### `src/graphql/schema.test.ts`, `src/server/graphql.test.ts`, `ui/src/lib/api-client.test.ts`, `e2e/workflow-web-editor-file-harness.pw.cjs`

**Status**: COMPLETED

**Checklist**:

- [x] Cover workflow-definition list/load/create/save/validate over schema and HTTP transport
- [x] Cover browser GraphQL request/response mapping for workflow definition flows
- [x] Re-run browser E2E after the workflow-definition transport swap

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| GraphQL workflow-definition surface | `src/graphql/types.ts`, `src/graphql/schema.ts` | COMPLETED | Passed |
| Browser workflow-definition GraphQL adoption | `ui/src/lib/api-client.ts` | COMPLETED | Passed |
| Regression coverage | `src/graphql/schema.test.ts`, `src/server/graphql.test.ts`, `ui/src/lib/api-client.test.ts`, `e2e/workflow-web-editor-file-harness.pw.cjs` | COMPLETED | Passed |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Workflow-definition browser GraphQL load | `graphql-manager-control-plane-surface` | Available |
| Workflow-definition create/save/validate GraphQL mutations | Workflow-definition GraphQL load | Ready |
| Browser verification | Browser workflow-definition GraphQL adoption | Completed |

## Tasks

### TASK-001: Add GraphQL Workflow Definition Queries and Mutations

**Status**: Completed
**Parallelizable**: No

**Deliverables**:

- `src/graphql/types.ts`
- `src/graphql/schema.ts`
- `src/graphql/schema.test.ts`
- `src/server/graphql.test.ts`

**Completion Criteria**:

- [x] GraphQL can list and load workflow definitions for the browser
- [x] GraphQL can create/save/validate workflow definitions with REST-parity behavior
- [x] Schema and HTTP tests pass

### TASK-002: Switch Browser Workflow Definition Transport to GraphQL

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-001`

**Deliverables**:

- `ui/src/lib/api-client.ts`
- `ui/src/lib/api-client.test.ts`
- `e2e/workflow-web-editor-file-harness.pw.cjs`

**Completion Criteria**:

- [x] Browser workflow list/load/create/save/validate use GraphQL
- [x] Browser-facing editor types and conflict behavior remain unchanged
- [x] File-backed browser harness matches the migrated transport

### TASK-003: Verify the Browser Workflow Definition Migration Slice

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

- [x] Browser workflow-definition transport uses GraphQL instead of REST
- [x] Browser execution/session GraphQL transport remains stable
- [x] All tests passing
- [x] Type checking passes

## Progress Log

### Session: 2026-03-15 16:50 JST
**Tasks Completed**: Plan creation
**Tasks In Progress**: TASK-001
**Blockers**: None
**Notes**: This slice focuses only on browser workflow-definition transport. REST compatibility endpoints remain in place, and GraphQL remains a transport-layer control plane over the existing on-disk workflow JSON model rather than a replacement for it.

### Session: 2026-03-15 17:20 JST
**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Tasks In Progress**: None
**Blockers**: `agent-browser` live verification is environment-blocked with `Daemon failed to start (socket: /run/user/1000/agent-browser/default.sock)`.
**Notes**: Added GraphQL workflow-definition list/load/create/save/validate operations, switched the browser workflow-definition client transport to GraphQL, updated the file-backed Playwright harness to serve the new workflow-definition GraphQL operations, and preserved browser-side revision-conflict handling on save. Verification passed with `bun run test`, `bun run typecheck`, focused GraphQL/UI-client coverage, and `bun run test:e2e` (`1 passed`, `1 skipped`). The live `agent-browser` verification step could not complete because the local daemon socket failed to start in this environment.

### Session: 2026-03-15 18:17 JST
**Tasks Completed**: TASK-003 verification follow-up
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-ran the required verification loop in an environment where the local server and browser daemon were available. Live verification succeeded with `divedra serve --host 127.0.0.1 --port 43173`, `agent-browser open http://127.0.0.1:43173`, `agent-browser snapshot -i`, and `agent-browser screenshot --full`, so the earlier browser-daemon blocker is no longer current.
