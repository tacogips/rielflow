# GraphQL Manager HTTP Transport Context Hardening Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md#manager-send-semantics, design-docs/specs/architecture.md#local-http-server-rielflow-serve
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Previous**: `impl-plans/graphql-manager-http-context-isolation.md`
- **Current Plan**: `impl-plans/graphql-manager-http-transport-context-hardening.md`

## Design Document Reference

**Source**:

- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/architecture.md`

### Summary

This corrective slice closes the last HTTP-boundary auth fallback that still existed after ambient env stripping:

- `/graphql` must authenticate manager scope only from request transport metadata,
- caller-provided in-process `GraphqlRequestContext.authToken` and `managerSessionId` must not authorize HTTP requests,
- regression tests must prove that local fallback context is ignored without breaking header-driven manager calls.

### Scope

**Included**:

- design clarification for HTTP transport-only manager auth
- `/graphql` handler hardening to ignore local auth/session context fallback
- regression coverage for the no-header but caller-context-auth case

**Excluded**:

- direct in-process `executeGraphqlDocument(...)` execution semantics
- new GraphQL schema fields or mutations
- browser UI GraphQL migration

## Modules

### 1. HTTP Transport-Only Auth Enforcement

#### `src/server/graphql.ts`, `src/server/graphql.test.ts`

**Status**: COMPLETED

```typescript
export async function handleGraphqlRequest(
  request: Request,
  context: GraphqlRequestContext,
  deps?: GraphqlSchemaDependencies,
): Promise<Response>;
```

**Checklist**:

- [x] `/graphql` ignores caller-provided `context.authToken`
- [x] `/graphql` ignores caller-provided `context.managerSessionId`
- [x] request headers remain the only manager-scope transport on the HTTP boundary
- [x] regression coverage proves no-header local-context fallback is rejected

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| HTTP transport auth hardening | `src/server/graphql.ts`, `src/server/graphql.test.ts` | COMPLETED | Passing |
| Design/docs alignment | `design-docs/specs/design-graphql-manager-control-plane.md`, `design-docs/specs/architecture.md`, `README.md` | COMPLETED | Passing |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| HTTP transport-only auth enforcement | `graphql-manager-http-context-isolation` | READY |
| Regression coverage | HTTP transport-only auth enforcement | READY |

## Tasks

### TASK-001: Remove In-Process HTTP Auth Fallback

**Status**: Completed
**Parallelizable**: No

**Deliverables**:

- `src/server/graphql.ts`
- `src/server/graphql.test.ts`
- docs updates listed above

**Completion Criteria**:

- [x] `handleGraphqlRequest(...)` reads manager auth/session only from HTTP transport metadata
- [x] caller-provided local auth/session fields no longer authorize manager-scoped HTTP requests
- [x] targeted tests and typecheck pass

## Completion Criteria

- [x] The design now states that `/graphql` ignores both ambient env and local context auth fallback
- [x] HTTP GraphQL manager auth is fully transport-only at the request boundary
- [x] Targeted tests and typecheck pass

## Progress Log

### Session: 2026-03-15 19:10 JST
**Tasks Completed**: TASK-001
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The earlier isolation slice removed server ambient env fallback, but the exported HTTP handler still accepted caller-provided `GraphqlRequestContext` auth/session fallback. This slice makes the boundary consistent with the design by requiring transport metadata for HTTP manager scope.
