# GraphQL Manager Communication Scope Enforcement Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md#manager-scope-enforcement-for-replay-and-retry
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Previous**: `impl-plans/graphql-manager-control-plane-surface.md`
- **Previous**: `impl-plans/graphql-manager-runtime-session-lifecycle.md`
- **Current Plan**: `impl-plans/graphql-manager-communication-scope-enforcement.md`

## Design Document Reference

**Source**:

- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/architecture.md`

### Summary

This corrective slice closes a manager-scope authorization gap in the GraphQL control plane:

- replay/retry mutations must enforce root-manager versus sub-manager communication ownership,
- `sendManagerMessage` replay actions must use the same scope rule as direct GraphQL mutations,
- legacy communication records that omitted boundary ids must still be scoped correctly via node ownership.

### Scope

**Included**:

- shared communication-scope evaluation helpers
- manager-message replay validation
- direct GraphQL replay/retry validation
- regression coverage for root/sub-manager boundary violations

**Excluded**:

- GraphQL query-side authorization changes
- retroactive migration of already persisted communication records
- broader workflow editor or REST surface changes

## Modules

### 1. Shared Scope Evaluation

#### `src/workflow/manager-control.ts`

**Status**: COMPLETED

```typescript
export function assertCommunicationInManagerScope(
  communication: CommunicationRecord,
  workflow: WorkflowJson,
  context: ManagerControlParseContext,
  operationLabel?: string,
): void;
```

**Checklist**:

- [x] Resolve effective communication scope from persisted sub-workflow ids
- [x] Fall back to workflow node ownership when legacy records omit boundary ids
- [x] Enforce distinct root-manager and sub-manager replay/retry boundaries

### 2. Manager Mutation Adoption

#### `src/workflow/manager-message-service.ts`, `src/graphql/schema.ts`

**Status**: COMPLETED

**Checklist**:

- [x] `sendManagerMessage` rejects replay actions outside manager scope
- [x] direct GraphQL `replayCommunication` rejects out-of-scope communications
- [x] direct GraphQL `retryCommunicationDelivery` rejects out-of-scope communications

### 3. Regression Coverage

#### `src/workflow/manager-control.test.ts`, `src/workflow/manager-message-service.test.ts`, `src/graphql/schema.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Shared helper tests cover legacy boundary-id fallback
- [x] Sub-manager replay tests reject root-scope communications
- [x] Root-manager replay/retry tests reject child sub-workflow communications

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Shared scope evaluation | `src/workflow/manager-control.ts` | COMPLETED | Passing |
| Manager mutation adoption | `src/workflow/manager-message-service.ts`, `src/graphql/schema.ts` | COMPLETED | Passing |
| Regression coverage | `src/workflow/manager-control.test.ts`, `src/workflow/manager-message-service.test.ts`, `src/graphql/schema.test.ts` | COMPLETED | Passing |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Shared communication scope helper | `graphql-manager-control-plane-surface` | READY |
| Manager mutation adoption | Shared communication scope helper | READY |
| Regression coverage | Manager mutation adoption | READY |

## Tasks

### TASK-001: Add Shared Communication Scope Validation

**Status**: Completed
**Parallelizable**: Yes

**Deliverables**:

- `src/workflow/manager-control.ts`
- `src/workflow/manager-control.test.ts`

**Completion Criteria**:

- [x] root-manager scope is limited to effective root-scope communications
- [x] sub-manager scope is limited to effective owned-sub-workflow communications
- [x] legacy records without boundary ids are evaluated by node ownership fallback

### TASK-002: Adopt Scope Validation in Manager Control Paths

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-001`

**Deliverables**:

- `src/workflow/manager-message-service.ts`
- `src/graphql/schema.ts`

**Completion Criteria**:

- [x] manager-message replay validates communication ownership before mutation
- [x] direct GraphQL replay validates communication ownership before mutation
- [x] direct GraphQL retry validates communication ownership before mutation

### TASK-003: Verify Corrective Coverage

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-002`

**Deliverables**:

- `src/workflow/manager-message-service.test.ts`
- `src/graphql/schema.test.ts`

**Completion Criteria**:

- [x] regression tests cover rejected out-of-scope replay
- [x] regression tests cover rejected out-of-scope retry
- [x] targeted verification passes

## Completion Criteria

- [x] Communication replay/retry now respects manager scope boundaries
- [x] `sendManagerMessage` replay and direct GraphQL replay/retry share one rule
- [x] Legacy records without boundary ids are handled safely
- [x] Targeted tests pass

## Progress Log

### Session: 2026-03-15 18:15 JST
**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The existing implementation authenticated manager mutations but only constrained them to the workflow execution, which allowed root/sub-manager boundary violations for replay/retry. This slice makes communication ownership explicit and applies the same rule across manager-message and direct GraphQL mutations.
