# GraphQL Manager Artifact Atomic Writes Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#mailbox-transport-contract, design-docs/specs/design-graphql-manager-control-plane.md#security-and-safety
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Previous**: `impl-plans/graphql-manager-control-plane.md`
- **Previous**: `impl-plans/graphql-manager-control-plane-surface.md`
- **Previous**: `impl-plans/graphql-manager-ambient-context-transport.md`
- **Current Plan**: `impl-plans/graphql-manager-artifact-atomic-writes.md`

## Design Document Reference

**Source**:

- `design-docs/specs/architecture.md`
- `design-docs/specs/design-graphql-manager-control-plane.md`

### Summary

This follow-up plan closes an implementation drift discovered after the GraphQL manager control-plane landed:

- manager-message artifact writes and communication replay/retry writes must be atomic,
- the new GraphQL control-plane services should reuse one shared temp-then-rename helper,
- verification must cover both successful writes and temp-file cleanup when rename fails.

### Scope

**Included**:

- shared atomic text/JSON write helpers for runtime artifact files
- migration of GraphQL manager-message and communication services to those helpers
- targeted regression tests for helper cleanup behavior
- plan bookkeeping for this corrective iteration

**Excluded**:

- schema changes
- auth/idempotency behavior changes
- browser UI GraphQL migration

## Modules

### 1. Shared Atomic Write Helper

#### `src/shared/fs.ts`

**Status**: COMPLETED

```typescript
export async function atomicWriteTextFile(
  filePath: string,
  content: string,
): Promise<void>;

export async function atomicWriteJsonFile(
  filePath: string,
  payload: unknown,
): Promise<void>;
```

**Checklist**:

- [x] text writes use temp-then-rename
- [x] JSON writes reuse the text helper
- [x] failed rename/write attempts clean up temp files

### 2. Manager Artifact Write Adoption

#### `src/workflow/communication-service.ts`, `src/workflow/manager-message-service.ts`

**Status**: COMPLETED

**Checklist**:

- [x] communication replay/retry artifacts use shared atomic writes
- [x] manager-message envelopes and payload artifacts use shared atomic writes
- [x] no behavior regressions in GraphQL manager-control tests

### 3. Verification

#### `src/shared/fs.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] helper tests cover overwrite behavior
- [x] helper tests cover temp-file cleanup on rename failure
- [x] targeted and full test runs pass

## Module Status

| Module                         | File Path                                                                          | Status    | Tests   |
| ------------------------------ | ---------------------------------------------------------------------------------- | --------- | ------- |
| Shared atomic writes           | `src/shared/fs.ts`                                                                 | COMPLETED | Passing |
| Communication/manager adoption | `src/workflow/communication-service.ts`, `src/workflow/manager-message-service.ts` | COMPLETED | Passing |
| Regression coverage            | `src/shared/fs.test.ts`                                                            | COMPLETED | Passing |

## Dependencies

| Feature                   | Depends On                         | Status |
| ------------------------- | ---------------------------------- | ------ |
| Shared atomic writes      | Existing runtime artifact contract | READY  |
| Manager artifact adoption | Shared atomic writes               | READY  |
| Verification              | Manager artifact adoption          | READY  |

## Tasks

### TASK-001: Introduce Shared Atomic Write Helpers

**Status**: Completed
**Parallelizable**: Yes

**Deliverables**:

- `src/shared/fs.ts`
- `src/shared/fs.test.ts`

**Completion Criteria**:

- [x] shared helper writes through temp path then rename
- [x] helper removes temp files on failure
- [x] helper tests pass

### TASK-002: Migrate GraphQL Manager Artifact Writers

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-001`

**Deliverables**:

- `src/workflow/communication-service.ts`
- `src/workflow/manager-message-service.ts`

**Completion Criteria**:

- [x] manager-message artifact writes are atomic
- [x] communication replay/retry artifact writes are atomic
- [x] targeted GraphQL manager-control verification passes

## Completion Criteria

- [x] GraphQL manager-control artifact writes match the architecture's atomic-write requirement
- [x] Shared helper coverage exists for success and cleanup paths
- [x] Targeted and full verification pass

## Progress Log

### Session: 2026-03-15 10:57 JST

**Tasks Completed**: TASK-001, TASK-002
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The design remained correct; the corrective work was to bring the new GraphQL manager-message and communication artifact writers back into alignment with the existing atomic-write contract.
