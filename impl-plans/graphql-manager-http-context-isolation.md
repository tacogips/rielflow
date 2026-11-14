# GraphQL Manager HTTP Context Isolation Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md#manager-send-semantics, design-docs/specs/architecture.md#local-http-server-divedra-serve
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Previous**: `impl-plans/graphql-manager-ambient-context-transport.md`
- **Previous**: `impl-plans/graphql-manager-runtime-session-lifecycle.md`
- **Current Plan**: `impl-plans/graphql-manager-http-context-isolation.md`

## Design Document Reference

**Source**:

- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/architecture.md`

### Summary

This corrective slice closes a transport/auth mismatch in the GraphQL manager control plane:

- HTTP GraphQL requests must derive manager scope only from request transport metadata,
- the `/graphql` handler must not inherit ambient manager execution scope from the server process environment,
- regression coverage must prove that server-local ambient env no longer authorizes manager-scoped HTTP requests.

### Scope

**Included**:

- explicit design clarification for HTTP manager-context isolation
- shared helper to strip ambient manager execution env on the HTTP boundary
- `/graphql` handler adoption of the isolation helper
- targeted regression tests and plan bookkeeping

**Excluded**:

- new GraphQL mutations or schema fields
- direct in-process `executeGraphqlDocument(...)` changes
- browser UI GraphQL migration

## Modules

### 1. HTTP Context Isolation Helper

#### `src/workflow/manager-session-store.ts`

**Status**: COMPLETED

```typescript
export function stripAmbientManagerExecutionContext(
  env: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>>;
```

**Checklist**:

- [x] removes ambient manager auth/session/scope keys
- [x] preserves unrelated environment values
- [x] helper behavior is unit-tested

### 2. GraphQL HTTP Boundary Adoption

#### `src/server/graphql.ts`, `src/server/graphql.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] `/graphql` sanitizes ambient manager execution env before schema execution
- [x] header/bearer-driven manager mutations keep working
- [x] server-local ambient env no longer authorizes manager-scoped HTTP calls

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| HTTP context isolation helper | `src/workflow/manager-session-store.ts` | COMPLETED | Passing |
| GraphQL HTTP adoption | `src/server/graphql.ts`, `src/server/graphql.test.ts` | COMPLETED | Passing |
| Design/docs alignment | `design-docs/specs/design-graphql-manager-control-plane.md`, `design-docs/specs/architecture.md`, `README.md` | COMPLETED | Passing |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| HTTP manager-context isolation | `graphql-manager-ambient-context-transport`, `graphql-manager-runtime-session-lifecycle` | READY |
| Regression coverage | HTTP manager-context isolation | READY |

## Tasks

### TASK-001: Isolate HTTP GraphQL Manager Context

**Status**: Completed
**Parallelizable**: No

**Deliverables**:

- `src/workflow/manager-session-store.ts`
- `src/server/graphql.ts`
- `src/workflow/manager-session-store.test.ts`
- `src/server/graphql.test.ts`

**Completion Criteria**:

- [x] HTTP GraphQL execution strips server-local ambient manager scope
- [x] direct request transport still authenticates manager-scoped operations
- [x] regression tests cover the no-header/no-bearer ambient-env case

## Completion Criteria

- [x] The design explicitly forbids server-local ambient manager auth fallback on `/graphql`
- [x] HTTP GraphQL manager auth is transport-only
- [x] Targeted tests and typecheck pass

## Progress Log

### Session: 2026-03-15 11:15 JST
**Tasks Completed**: TASK-001
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The control-plane design already said HTTP manager scope should travel through transport metadata, but the server handler still passed ambient env through to schema auth fallback. This slice isolates the HTTP boundary so only request metadata can authorize manager-scoped GraphQL operations.
