# GraphQL Library and REST Surface Simplification Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md, design-docs/specs/architecture.md, design-docs/specs/command.md
**Created**: 2026-03-16
**Last Updated**: 2026-03-16

---

## Related Plans

- **Previous**: `impl-plans/graphql-browser-execution-session-migration.md`
- **Previous**: `impl-plans/graphql-browser-workflow-definition-migration.md`
- **Depends On**: `impl-plans/graphql-manager-control-plane-surface.md`

---

## Design Document Reference

**Source**:

- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`

### Summary

Adopt a standard GraphQL library for request parsing and execution, and remove the now-redundant REST workflow/session execution routes from the served control-plane surface.

### Scope

**Included**:

- replace the handwritten `/graphql` parser and executor with the standard `graphql` package
- keep the existing GraphQL domain shape and browser-facing payloads stable where practical
- remove legacy REST workflow-definition and workflow/session execution routes under `/api/workflows*`, `/api/sessions*`, and `/api/workflow-executions*`
- update browser/file-harness tests, server tests, and docs to reflect the GraphQL-first served contract

**Excluded**:

- replacing `/api/ui-config` or `/healthz`
- adding browser UI features beyond the existing GraphQL-backed behavior
- redesigning the GraphQL domain model itself

---

## Modules

### 1. GraphQL Runtime Replacement

#### `src/server/graphql.ts`, `src/graphql/schema.ts`, `src/graphql/types.ts`

**Status**: COMPLETED

```typescript
interface GraphqlHttpExecutionResult {
  readonly data?: unknown;
  readonly errors?: readonly { readonly message: string }[];
}

interface GraphqlResolverContext extends GraphqlRequestContext {}
```

**Checklist**:
- [x] Add the standard `graphql` package dependency
- [x] Replace handwritten GraphQL parsing/execution with library-backed execution
- [x] Preserve existing GraphQL request envelope behavior
- [x] Keep manager auth/session transport handling intact
- [x] Update GraphQL transport tests

### 2. REST Surface Removal

#### `src/server/api.ts`, `src/server/api.test.ts`, `README.md`, `design-docs/specs/command.md`

**Status**: COMPLETED

```typescript
interface RemovedRestSurface {
  readonly routePrefix:
    | "/api/workflows"
    | "/api/sessions"
    | "/api/workflow-executions";
  readonly replacement: "/graphql";
}
```

**Checklist**:
- [x] Remove legacy REST workflow-definition routes
- [x] Remove legacy REST workflow/session execution routes
- [x] Keep static asset serving, `/api/ui-config`, and `/healthz`
- [x] Update tests to assert GraphQL-only workflow/session transport
- [x] Update docs to stop advertising the removed REST routes

### 3. Browser and Harness Verification

#### `ui/src/lib/api-client.ts`, `e2e/workflow-web-editor*.cjs`

**Status**: COMPLETED

```typescript
interface BrowserGraphqlContract {
  readonly endpoint: "/graphql";
}
```

**Checklist**:
- [x] Keep browser editor transport GraphQL-only
- [x] Remove file-harness REST compatibility behavior no longer needed
- [x] Re-run UI and E2E verification

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| GraphQL runtime replacement | `src/server/graphql.ts`, `src/graphql/schema.ts`, `src/graphql/types.ts` | COMPLETED | Passed |
| REST surface removal | `src/server/api.ts`, `src/server/api.test.ts`, `README.md` | COMPLETED | Passed |
| Browser and harness verification | `ui/src/lib/api-client.ts`, `e2e/workflow-web-editor*.cjs` | COMPLETED | Passed |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| GraphQL runtime replacement | Existing GraphQL domain schema | Completed |
| REST surface removal | GraphQL runtime replacement | Completed |
| Browser and harness verification | REST surface removal | Completed |

## Tasks

### TASK-001: Replace the handwritten GraphQL executor with a standard library

**Status**: Completed
**Parallelizable**: No

**Deliverables**:

- `package.json`
- `bun.lock`
- `src/server/graphql.ts`
- `src/graphql/schema.ts`
- `src/graphql/types.ts`
- `src/server/graphql.test.ts`

**Completion Criteria**:

- [x] `/graphql` request handling uses the standard `graphql` package
- [x] Existing GraphQL operations remain available
- [x] GraphQL server tests pass

### TASK-002: Remove legacy REST workflow/session routes

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-001`

**Deliverables**:

- `src/server/api.ts`
- `src/server/api.test.ts`
- `README.md`
- `design-docs/specs/command.md`

**Completion Criteria**:

- [x] Workflow-definition REST routes are removed
- [x] Workflow/session execution REST routes are removed
- [x] Remaining non-GraphQL serve endpoints are intentional and documented

### TASK-003: Update browser harnesses and verify

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-002`

**Deliverables**:

- `e2e/workflow-web-editor-file-harness.pw.cjs`
- `e2e/workflow-web-editor.pw.cjs`
- verification outputs only

**Completion Criteria**:

- [x] GraphQL-only browser transport remains green
- [x] Typecheck passes
- [x] Tests pass
- [x] UI build passes

## Completion Criteria

- [x] Standard GraphQL library adopted
- [x] Legacy REST workflow/session surface removed
- [x] Tests passing
- [x] Type checking passes
- [x] UI build passes

## Progress Log

### Session: 2026-03-16 00:00 JST
**Tasks Completed**: Plan creation
**Tasks In Progress**: TASK-001
**Blockers**: None
**Notes**: User requested the served control plane be simplified: remove the confusing REST compatibility routes and replace the homegrown GraphQL parser/executor with a standard library-backed implementation.

### Session: 2026-03-16 18:05 JST
**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added the standard `graphql` dependency and replaced the handwritten `/graphql` parser/executor with a library-backed schema execution path while keeping the existing domain resolvers. Removed legacy workflow/session REST routes from `serve`, updated the browser session query for spec-compliant GraphQL field selection, removed the file-harness REST compatibility paths, and verified with `bun run test`, `bun run typecheck`, `bun run build`, and a live `agent-browser open/snapshot/screenshot/close` pass against `rielflow serve`.
