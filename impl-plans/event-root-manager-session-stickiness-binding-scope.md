# Event Root Manager Session Stickiness Binding Scope Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-event-listener-workflow-trigger.md#idempotency-and-concurrency`
**Created**: 2026-04-22
**Last Updated**: 2026-04-22

## Summary

Harden event-driven root-manager session stickiness so reuse is scoped per binding, not just per workflow/source/conversation. This avoids cross-binding session reuse when separate bindings target the same workflow and chat thread with different mapping or policy.

## Scope

Included:

- binding-local sticky-session key and persisted record updates
- stricter stickiness record parsing and stale-record rejection
- trigger-runner refactor to share sticky-context resolution
- regression coverage for same-workflow, same-conversation, different-binding dispatch

Not included:

- remote GraphQL sticky-session migration
- generalized event concurrency scheduler changes
- authored workflow schema changes

## Modules

### 1. Sticky Session Record Contract

#### `src/events/session-stickiness.ts`

**Status**: COMPLETED

```typescript
export interface EventWorkflowSessionStickinessRecord {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly sessionId: string;
  readonly updatedAt: string;
}
```

**Checklist**:

- [x] Include `bindingId` in the sticky-session key contract
- [x] Parse stored records explicitly instead of loose casting
- [x] Reject stale or mismatched records during lookup

### 2. Sticky Context Resolution

#### `src/events/trigger-runner.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Resolve sticky root-manager eligibility in one helper
- [x] Reuse the same sticky context for lookup and persistence
- [x] Keep fresh-dispatch behavior unchanged for non-sticky paths

### 3. Regression Coverage

#### `src/events/trigger-runner.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Cover different bindings targeting the same workflow conversation
- [x] Keep prior completed-session and non-sticky regressions intact

## Module Status

| Module                         | File Path                           | Status    | Tests                               |
| ------------------------------ | ----------------------------------- | --------- | ----------------------------------- |
| Sticky session record contract | `src/events/session-stickiness.ts`  | COMPLETED | `src/events/trigger-runner.test.ts` |
| Sticky context resolution      | `src/events/trigger-runner.ts`      | COMPLETED | `src/events/trigger-runner.test.ts` |
| Regression coverage            | `src/events/trigger-runner.test.ts` | COMPLETED | Passing                             |

## Dependencies

| Feature                   | Depends On                        | Status    |
| ------------------------- | --------------------------------- | --------- |
| Binding-scoped sticky key | Existing event stickiness feature | COMPLETED |
| Trigger-runner hardening  | Binding-scoped sticky key         | COMPLETED |
| Regression coverage       | Trigger-runner hardening          | COMPLETED |

## Tasks

### TASK-001: Harden Sticky Session Record Scope

**Status**: Completed
**Parallelizable**: No

**Deliverables**:

- `src/events/session-stickiness.ts`

**Completion Criteria**:

- [x] Sticky keys include `bindingId`
- [x] Stored records are parsed deterministically
- [x] Legacy mismatched records are ignored safely

### TASK-002: Refactor Sticky Context Resolution

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-001`

**Deliverables**:

- `src/events/trigger-runner.ts`

**Completion Criteria**:

- [x] Lookup and persistence share one sticky-context resolution path
- [x] Sticky reuse stays limited to the same binding conversation scope

### TASK-003: Add Binding-Scope Regression Coverage

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-002`

**Deliverables**:

- `src/events/trigger-runner.test.ts`

**Completion Criteria**:

- [x] Tests prove different bindings do not share sticky workflow sessions
- [x] Existing sticky reuse still works inside the same binding

## Completion Criteria

- [x] Sticky root-manager session reuse is binding-scoped
- [x] Stale sticky records no longer get reused across incompatible scopes
- [x] Tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-04-22 23:20 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Review found that the original sticky-session index omitted `binding.id`, which could merge separate bindings that target the same workflow/source/conversation. Updated the event-trigger design to make sticky reuse binding-local, hardened stored-record parsing, refactored sticky-context resolution in the trigger runner, and added a regression test for cross-binding isolation.
