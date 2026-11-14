# Event Root Manager Session Stickiness Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-session-reuse.md`, `design-docs/specs/design-event-listener-workflow-trigger.md`, `design-docs/specs/architecture.md`
**Created**: 2026-04-22
**Last Updated**: 2026-04-22

## Summary

Allow the root `divedra manager` to opt into event-driven session stickiness using the existing node `sessionPolicy.mode = "reuse"` contract. When a compatible event source carries chat conversation identity, repeated events for the same conversation should resume the previous workflow session and continue the same manager backend session instead of starting a new workflow execution every time.

## Scope

Included:

- event-runtime detection of sticky root-manager sessions
- persisted conversation-to-workflow-session lookup for event dispatch
- local event dispatch resume path that requeues the root manager on the existing workflow session
- regression coverage for sticky and non-sticky manager behavior

Not included:

- remote GraphQL event-dispatch session migration
- user-action reply routing changes
- new authored workflow schema fields beyond existing `sessionPolicy`

## Modules

### 1. Event Session Stickiness Index

#### `src/events/session-stickiness.ts`

**Status**: COMPLETED

```typescript
export interface EventWorkflowSessionStickinessRecord {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly sourceId: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly sessionId: string;
  readonly updatedAt: string;
}
```

**Checklist**:

- [x] Persist sticky event-session lookup records under root data storage
- [x] Derive stable keys from workflow and chat conversation identity
- [x] Load prior workflow-session mappings for event dispatch

### 2. Event Dispatch Resume Wiring

#### `src/events/trigger-runner.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Detect sticky root-manager eligibility from the workflow manager node
- [x] Resume and reopen prior workflow sessions for matching chat conversations
- [x] Keep non-sticky and unsupported paths unchanged

### 3. Regression Coverage

#### `src/events/trigger-runner.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Cover same-conversation reuse for sticky root managers
- [x] Cover fresh-session behavior when manager stickiness is disabled
- [x] Assert root-manager backend session reuse metadata on resumed chat events

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Event session stickiness index | `src/events/session-stickiness.ts` | COMPLETED | `src/events/trigger-runner.test.ts` |
| Event dispatch resume wiring | `src/events/trigger-runner.ts` | COMPLETED | `src/events/trigger-runner.test.ts` |
| Regression coverage | `src/events/trigger-runner.test.ts` | COMPLETED | Passing |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Sticky-session lookup | Existing workflow/session storage | COMPLETED |
| Resume wiring | Sticky-session lookup | COMPLETED |
| Regression coverage | Resume wiring | COMPLETED |

## Tasks

### TASK-001: Add Event Sticky-Session Lookup

**Status**: Completed
**Parallelizable**: No

**Deliverables**:

- `src/events/session-stickiness.ts`

**Completion Criteria**:

- [x] Sticky lookup records can be saved and loaded
- [x] Keys distinguish workflow, source, conversation, and thread scope

### TASK-002: Resume Sticky Root-Manager Sessions From Events

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-001`

**Deliverables**:

- `src/events/trigger-runner.ts`

**Completion Criteria**:

- [x] Sticky root-manager events reopen the prior workflow session locally
- [x] Matching conversations reuse the same workflow execution id
- [x] Non-sticky dispatch keeps starting fresh workflow sessions

### TASK-003: Add Regression Tests

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-002`

**Deliverables**:

- `src/events/trigger-runner.test.ts`
- `src/workflow/adapter.ts`

**Completion Criteria**:

- [x] Tests cover sticky same-conversation reuse
- [x] Tests cover disabled stickiness behavior
- [x] Tests cover backend-session reuse metadata for the root manager

## Completion Criteria

- [x] Root manager session reuse is configurable through existing `sessionPolicy`
- [x] Chat conversation events can continue the previous workflow session when stickiness is enabled
- [x] Tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-04-22 00:00 JST

**Tasks Completed**: Plan creation
**Tasks In Progress**: TASK-001, TASK-002, TASK-003
**Blockers**: None
**Notes**: Confirmed that manager-node backend session reuse already exists within one workflow run, but event-triggered dispatch always starts a new workflow session. This implementation adds a local event-session resume path for sticky root-manager chat conversations.

### Session: 2026-04-22 00:35 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added a persisted event session-stickiness index keyed by workflow/source/conversation/thread, taught the event trigger runner to reopen and resume the prior local workflow session when the root manager uses `sessionPolicy.mode = "reuse"`, extended scenario mocks so tests can assert backend-session continuation, and verified with focused Bun tests plus `bun run typecheck`.
