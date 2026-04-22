# Event Root Manager Session Stickiness Record Lifecycle Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-event-listener-workflow-trigger.md#idempotency-and-concurrency`
**Created**: 2026-04-22
**Last Updated**: 2026-04-22

## Summary

Harden binding-scoped sticky-session reuse so the persisted stickiness index stays aligned with reusable workflow sessions. Stale records should be cleared when they point at missing or blocked sessions, and trigger dispatch should reuse one sticky-context resolution path across lookup and persistence.

## Scope

Included:

- sticky-record deletion support in the event session-stickiness store
- trigger-runner cleanup of stale sticky records before falling back to a fresh dispatch
- shared sticky-context flow inside one dispatch to reduce duplicate workflow loading
- regression coverage proving stale records are cleared even when the follow-up dispatch fails

Not included:

- remote GraphQL sticky-session resume support
- event concurrency scheduler changes
- authored workflow schema changes

## Modules

### 1. Sticky Record Lifecycle Helpers

#### `src/events/session-stickiness.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Add explicit sticky-record deletion support
- [x] Reuse one path helper for sticky-record file resolution
- [x] Use error-code-based missing-file handling instead of string matching

### 2. Trigger Runner Lifecycle Hardening

#### `src/events/trigger-runner.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Resolve sticky root-manager context once per dispatch path
- [x] Clear stale sticky records when the referenced session is missing or blocked
- [x] Keep active user-action sessions non-reusable without deleting their sticky binding

### 3. Regression Coverage

#### `src/events/trigger-runner.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Cover stale sticky-record cleanup when the referenced session file is missing
- [x] Prove cleanup still happens when the next fresh dispatch fails before a new sticky record can be written

## Module Status

| Module                             | File Path                           | Status    | Tests                               |
| ---------------------------------- | ----------------------------------- | --------- | ----------------------------------- |
| Sticky record lifecycle helpers    | `src/events/session-stickiness.ts`  | COMPLETED | `src/events/trigger-runner.test.ts` |
| Trigger runner lifecycle hardening | `src/events/trigger-runner.ts`      | COMPLETED | `src/events/trigger-runner.test.ts` |
| Regression coverage                | `src/events/trigger-runner.test.ts` | COMPLETED | Passing                             |

## Dependencies

| Feature                | Depends On                         | Status    |
| ---------------------- | ---------------------------------- | --------- |
| Sticky-record deletion | Existing binding-scoped stickiness | COMPLETED |
| Dispatch cleanup       | Sticky-record deletion             | COMPLETED |
| Regression coverage    | Dispatch cleanup                   | COMPLETED |

## Tasks

### TASK-001: Add Sticky Record Lifecycle Helpers

**Status**: Completed
**Parallelizable**: No

**Deliverables**:

- `src/events/session-stickiness.ts`

**Completion Criteria**:

- [x] Sticky-session records can be deleted explicitly
- [x] Missing sticky files are detected without brittle message matching

### TASK-002: Clear Stale Sticky Records During Dispatch

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-001`

**Deliverables**:

- `src/events/trigger-runner.ts`

**Completion Criteria**:

- [x] Missing-session sticky records are cleared before falling back to a fresh dispatch
- [x] Failed or cancelled sticky sessions clear the stored binding record
- [x] Sticky-context resolution is not duplicated inside the same dispatch flow

### TASK-003: Add Lifecycle Regression Coverage

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-002`

**Deliverables**:

- `src/events/trigger-runner.test.ts`

**Completion Criteria**:

- [x] Tests prove stale sticky records are cleared before a failed follow-up dispatch
- [x] Tests keep successful sticky reuse behavior intact

## Completion Criteria

- [x] Sticky-session records no longer linger after the referenced session becomes unusable
- [x] Trigger dispatch self-heals stale sticky state before attempting a fresh run
- [x] Tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-04-22 23:55 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Review of the binding-scoped sticky-session follow-up found that the stickiness index could still point at missing or blocked sessions, and the runner reloaded sticky metadata twice in one dispatch. Added explicit sticky-record deletion helpers, taught the trigger runner to clear stale records before a fresh dispatch attempt, shared sticky-context resolution across the dispatch path, and added a regression test that proves cleanup survives a failed retry.
