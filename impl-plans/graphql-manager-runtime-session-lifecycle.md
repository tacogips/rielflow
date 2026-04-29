# GraphQL Manager Runtime Session Lifecycle Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md, design-docs/specs/design-graphql-manager-control-plane.md
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Previous**: `impl-plans/graphql-manager-control-plane.md`
- **Previous**: `impl-plans/graphql-manager-control-plane-surface.md`
- **Previous**: `impl-plans/graphql-manager-ambient-context-transport.md`
- **Current Plan**: `impl-plans/graphql-manager-runtime-session-lifecycle.md`

## Design Document Reference

**Source**:

- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/architecture.md`

### Summary

This plan closes the remaining runtime integration gap for the GraphQL manager control plane:

- mint and persist manager sessions when manager nodes actually execute,
- pass ambient GraphQL manager context only to manager-capable adapter executions,
- revoke the session token when the manager node execution ends.

### Scope

**Included**:

- runtime manager-session lifecycle in the workflow engine
- additive adapter request contract for ambient manager GraphQL context
- helper functions for token minting and environment construction
- targeted regression tests for engine and adapter behavior
- plan/index bookkeeping

**Excluded**:

- browser UI GraphQL migration
- mid-execution cancellation interrupts beyond the existing engine model
- new GraphQL schema fields

## Modules

### 1. Manager Session Lifecycle Helpers

#### `src/workflow/manager-session-store.ts`

**Status**: COMPLETED

```typescript
export interface AmbientManagerControlPlaneEnvironment {
  readonly DIVEDRA_GRAPHQL_ENDPOINT: string;
  readonly DIVEDRA_MANAGER_AUTH_TOKEN: string;
  readonly DIVEDRA_MANAGER_SESSION_ID: string;
  readonly DIVEDRA_WORKFLOW_ID: string;
  readonly DIVEDRA_WORKFLOW_EXECUTION_ID: string;
  readonly DIVEDRA_MANAGER_RUNTIME_ID: string;
  readonly DIVEDRA_MANAGER_NODE_EXEC_ID: string;
}

export function mintManagerAuthToken(): string;
export function buildAmbientManagerControlPlaneEnvironment(input: {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerRuntimeId: string;
  readonly managerNodeExecId: string;
  readonly managerSessionId: string;
  readonly authToken: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): AmbientManagerControlPlaneEnvironment;
```

**Checklist**:

- [x] mint auth tokens without persisting raw secrets
- [x] build the ambient manager GraphQL environment map in one place
- [x] keep the transport default consistent with the existing local GraphQL endpoint

### 2. Engine Manager Session Lifecycle

#### `src/workflow/engine.ts`, `src/workflow/adapter.ts`

**Status**: COMPLETED

**Checklist**:

- [x] manager nodes create active manager sessions before adapter execution
- [x] non-manager nodes never receive ambient manager context
- [x] manager sessions are finalized to terminal status after execution
- [x] auth tokens are not written into execution artifacts

### 3. Adapter Adoption and Regression Coverage

#### `src/workflow/adapters/claude.ts`, `src/workflow/adapters/codex.ts`, targeted tests

**Status**: COMPLETED

**Checklist**:

- [x] CLI-backed adapters forward the ambient manager context additively
- [x] adapter tests cover the new request field
- [x] engine tests cover session persistence and manager-only exposure

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Manager session helpers | `src/workflow/manager-session-store.ts` | COMPLETED | Passing |
| Engine lifecycle | `src/workflow/engine.ts`, `src/workflow/adapter.ts` | COMPLETED | Passing |
| Adapter adoption | `src/workflow/adapters/claude.ts`, `src/workflow/adapters/codex.ts` | COMPLETED | Passing |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Runtime manager-session activation | `graphql-manager-control-plane` foundation | READY |
| Adapter ambient-context forwarding | Runtime manager-session activation | READY |
| Regression coverage | Runtime lifecycle and adapter forwarding | READY |

## Tasks

### TASK-001: Add Manager Session Lifecycle Helpers

**Status**: Completed
**Parallelizable**: Yes

**Deliverables**:

- `src/workflow/manager-session-store.ts`
- `src/workflow/manager-session-store.test.ts`

**Completion Criteria**:

- [x] auth token mint helper exists
- [x] manager GraphQL environment builder exists
- [x] helper behavior is test-covered

### TASK-002: Wire Runtime Manager Session Lifecycle

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-001`

**Deliverables**:

- `src/workflow/adapter.ts`
- `src/workflow/engine.ts`
- `src/workflow/engine.test.ts`

**Completion Criteria**:

- [x] manager executions persist active sessions before adapter calls
- [x] manager executions finalize sessions after execution
- [x] worker executions do not receive manager auth context

### TASK-003: Forward Ambient Context Through CLI-backed Adapters

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-002`

**Deliverables**:

- `src/workflow/adapters/claude.ts`
- `src/workflow/adapters/codex.ts`
- `src/workflow/adapters/claude.test.ts`
- `src/workflow/adapters/codex.test.ts`

**Completion Criteria**:

- [x] adapter request bodies include ambient manager context when provided
- [x] existing request shapes remain compatible for non-manager nodes
- [x] targeted and full verification pass

## Completion Criteria

- [x] Runtime-issued manager sessions now exist for real manager-node executions
- [x] Ambient GraphQL manager context reaches manager-capable adapters only
- [x] Tokens expire immediately after the manager step ends
- [x] Typecheck and tests pass

## Progress Log

### Session: 2026-03-15 12:20 JST
**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The GraphQL surface itself was already implemented, but the runtime had not yet minted manager sessions or exposed ambient `divedra gql` context to manager-node adapter executions. This slice closes that lifecycle gap without changing worker-node behavior.
