# GraphQL Manager Control-Mode Claim Atomicity Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md#priority-rule
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Previous**: `impl-plans/graphql-manager-control-mode-exclusivity.md`
- **Current Plan**: `impl-plans/graphql-manager-control-mode-claim-atomicity.md`

## Design Document Reference

**Source**:

- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/notes.md`

### Summary

This follow-up closes a persistence-layer race in the manager control-plane implementation:

- the manager-session `controlMode` claim must be atomic,
- concurrent GraphQL/runtime claims must observe one authoritative winner,
- regression coverage must lock in the storage contract.

### Scope

**Included**:

- atomic compare-and-set semantics for `ManagerSessionStore.claimControlMode`
- design note clarifying the storage-layer atomicity requirement
- targeted regression coverage for conflicting claims

**Excluded**:

- new GraphQL schema fields
- changes to manager-session lifecycle or HTTP auth transport
- browser/editor GraphQL migration

## Modules

### 1. Atomic Manager Control Claim

#### `src/workflow/manager-session-store.ts`

**Status**: COMPLETED

```typescript
export interface ManagerSessionStore {
  claimControlMode(input: {
    readonly managerSessionId: string;
    readonly controlMode: ManagerControlMode;
    readonly updatedAt: string;
  }): Promise<ManagerControlMode>;
}
```

**Checklist**:

- [x] conflicting control-mode claims resolve through one storage-layer winner
- [x] the winner is returned to both callers after persistence
- [x] missing sessions still fail deterministically

### 2. Regression Coverage

#### `src/workflow/manager-session-store.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] targeted tests cover conflicting claims across separate store instances
- [x] persisted `controlMode` remains stable after the first claim

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Atomic manager control claim | `src/workflow/manager-session-store.ts` | COMPLETED | Passing |
| Regression coverage | `src/workflow/manager-session-store.test.ts` | COMPLETED | Passing |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Atomic control-mode claim | `graphql-manager-control-mode-exclusivity` | READY |
| Regression coverage | Atomic control-mode claim | READY |

## Tasks

### TASK-001: Make Control-Mode Claim Atomic

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `graphql-manager-control-mode-exclusivity:TASK-002`

**Deliverables**:

- `src/workflow/manager-session-store.ts`
- `src/workflow/manager-session-store.test.ts`
- design note updates

**Completion Criteria**:

- [x] `claimControlMode` uses one atomic storage transition instead of read-then-write
- [x] conflicting claims return the persisted winning mode
- [x] targeted tests pass

## Completion Criteria

- [x] Manager control-mode exclusivity is enforced atomically at persistence time
- [x] Design notes describe the atomicity requirement explicitly
- [x] Targeted tests pass

## Progress Log

### Session: 2026-03-15 14:35 JST
**Tasks Completed**: TASK-001
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Review of the dirty GraphQL manager-control-plane implementation found that `claimControlMode` still used a read-then-write sequence. That preserved sequential correctness but left a race under concurrent GraphQL/runtime claims. This slice changes the store contract to atomic compare-and-set semantics and records the requirement in design notes.
