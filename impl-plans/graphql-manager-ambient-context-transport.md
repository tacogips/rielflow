# GraphQL Manager Ambient Context Transport Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md#identity-and-scope
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Previous**: `impl-plans/graphql-manager-control-plane-surface.md`
- **Current Plan**: `impl-plans/graphql-manager-ambient-context-transport.md`

## Design Document Reference

**Source**: `design-docs/specs/design-graphql-manager-control-plane.md`

### Summary

This plan closes the remaining transport gap between the GraphQL manager control-plane design and the current implementation:

- `rielflow gql` must forward ambient manager-session scope, not only bearer auth
- `/graphql` must consume that forwarded session scope before falling back to server-local context
- tests and docs must prove manager-scoped mutations work without embedding `managerSessionId` in GraphQL variables

### Scope

**Included**:

- GraphQL transport header constant and request wiring
- CLI forwarding of ambient `DIVEDRA_MANAGER_SESSION_ID`
- GraphQL HTTP handler resolution of forwarded manager-session context
- targeted CLI and server transport tests
- plan/index bookkeeping for this corrective iteration

**Excluded**:

- new GraphQL mutations or schema fields
- browser UI GraphQL migration
- token minting/revocation changes

## Modules

### 1. Ambient Manager Context Transport

#### `src/graphql/transport.ts`, `src/graphql/client.ts`, `src/server/graphql.ts`, `src/cli.ts`

**Status**: COMPLETED

```typescript
export const GRAPHQL_MANAGER_SESSION_HEADER =
  "x-rielflow-manager-session-id";

export interface GraphqlClientRequest {
  readonly endpoint: string;
  readonly document: string;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly authToken?: string;
  readonly managerSessionId?: string;
  readonly fetchImpl?: typeof fetch;
}
```

**Checklist**:

- [x] `rielflow gql` forwards ambient manager session id when present
- [x] GraphQL HTTP handler resolves forwarded manager session id before server-local fallback
- [x] manager-scoped GraphQL operations work without `managerSessionId` in GraphQL input

### 2. Verification and Documentation

#### `src/cli.test.ts`, `src/server/graphql.test.ts`, `README.md`, `design-docs/specs/*.md`

**Status**: COMPLETED

**Checklist**:

- [x] CLI transport test verifies auth plus manager-session forwarding
- [x] HTTP GraphQL test verifies omitted `managerSessionId` still authenticates via forwarded header
- [x] design and command docs describe the transport contract explicitly

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Ambient manager transport | `src/graphql/transport.ts`, `src/graphql/client.ts`, `src/server/graphql.ts`, `src/cli.ts` | COMPLETED | Passing |
| Verification/docs | `src/cli.test.ts`, `src/server/graphql.test.ts`, `README.md`, `design-docs/specs/*.md` | COMPLETED | Passing |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Ambient manager-session forwarding | `graphql-manager-control-plane-surface` | READY |
| Transport verification/docs | Ambient manager-session forwarding | READY |

## Tasks

### TASK-001: Forward Ambient Manager Session Context

**Status**: Completed
**Parallelizable**: No

**Deliverables**:

- `src/graphql/transport.ts`
- `src/graphql/client.ts`
- `src/server/graphql.ts`
- `src/cli.ts`

**Completion Criteria**:

- [x] CLI GraphQL client forwards ambient manager session id when present
- [x] GraphQL HTTP handler accepts forwarded manager session id
- [x] manager-scoped mutations no longer require `managerSessionId` in GraphQL variables during normal CLI use

### TASK-002: Cover the Transport Contract

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-001`

**Deliverables**:

- `src/cli.test.ts`
- `src/server/graphql.test.ts`
- design and README updates

**Completion Criteria**:

- [x] CLI tests assert manager-session forwarding
- [x] server tests assert manager-scoped GraphQL mutations succeed with forwarded ambient context
- [x] documentation names the transport contract explicitly

## Completion Criteria

- [x] Ambient manager-session transport is implemented
- [x] Targeted tests pass
- [x] Design and command docs match the implementation

## Progress Log

### Session: 2026-03-15 10:51 JST
**Tasks Completed**: TASK-001, TASK-002
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added `X-Rielflow-Manager-Session-Id` forwarding so ambient manager sessions survive the HTTP boundary between `rielflow gql` and `/graphql`.
