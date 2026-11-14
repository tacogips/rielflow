# GraphQL Manager Message ID Collision Safety Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md, design-docs/specs/notes.md
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Previous**: `impl-plans/graphql-manager-control-plane-surface.md`
- **Current Plan**: `impl-plans/graphql-manager-message-id-collision-safety.md`

## Design Document Reference

**Source**:

- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/notes.md`

### Summary

Review of the current dirty GraphQL manager-control implementation found one remaining append-only safety gap:

- `sendManagerMessage` allocated `managerMessageId` from `listMessages().length + 1`,
- concurrent requests against one manager session could race and reuse the same artifact/database id,
- the control-plane design therefore needs an explicit collision-safe id-allocation rule.

### Scope

**Included**:

- design clarification for collision-safe `managerMessageId` allocation
- opaque `managerMessageId` generation in `ManagerMessageService`
- regression coverage for concurrent `sendManagerMessage` requests

**Excluded**:

- communication id allocation changes
- new GraphQL schema fields
- browser/editor GraphQL migration

## Modules

### 1. Manager Message ID Allocation

#### `src/workflow/manager-message-service.ts`

**Status**: COMPLETED

```typescript
export interface SendManagerMessageResult {
  readonly accepted: boolean;
  readonly managerMessageId: string;
  readonly parsedIntent: readonly ManagerIntentSummary[];
  readonly createdCommunicationIds: readonly string[];
  readonly queuedNodeIds: readonly string[];
  readonly rejectionReason?: string;
}
```

**Checklist**:

- [x] manager-message ids are allocated without depending on current message count
- [x] ids remain opaque to callers and artifact readers
- [x] existing message/artifact payload shapes stay compatible

### 2. Regression Coverage

#### `src/workflow/manager-message-service.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] concurrent planner-note sends succeed for one manager session
- [x] concurrent sends persist distinct `managerMessageId` values
- [x] targeted verification passes

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Manager message id allocation | `src/workflow/manager-message-service.ts` | COMPLETED | Passing |
| Regression coverage | `src/workflow/manager-message-service.test.ts` | COMPLETED | Passing |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Collision-safe manager message ids | `graphql-manager-control-plane-surface` | READY |
| Regression coverage | Collision-safe manager message ids | READY |

## Tasks

### TASK-001: Make `managerMessageId` Allocation Collision-safe

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `graphql-manager-control-plane-surface:TASK-001`

**Deliverables**:

- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/notes.md`
- `src/workflow/manager-message-service.ts`
- `src/workflow/manager-message-service.test.ts`

**Completion Criteria**:

- [x] design states that `managerMessageId` must be collision-safe and opaque
- [x] service no longer derives `managerMessageId` from the current message count
- [x] concurrent regression coverage proves distinct ids are persisted

## Completion Criteria

- [x] Append-only manager messages no longer depend on racy count-based ids
- [x] Design and notes document the collision-safety requirement
- [x] Targeted tests and typecheck pass

## Progress Log

### Session: 2026-03-15 15:45 JST
**Tasks Completed**: TASK-001
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The GraphQL manager-control architecture already matched the intended direction overall, but review of the dirty worktree found a concurrency hole in `managerMessageId` allocation. This slice replaces count-based ids with collision-safe opaque ids and locks the behavior with a concurrent regression test.
