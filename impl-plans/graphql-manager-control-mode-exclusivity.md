# GraphQL Manager Control-Mode Exclusivity Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md#priority-rule
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Previous**: `impl-plans/graphql-manager-control-plane.md`
- **Previous**: `impl-plans/graphql-manager-runtime-session-lifecycle.md`
- **Current Plan**: `impl-plans/graphql-manager-control-mode-exclusivity.md`

## Design Document Reference

**Source**:

- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/design-graphql-manager-runtime-session-lifecycle.md`

### Summary

This plan closes the remaining migration-mode gap in the GraphQL manager control plane:

- persist the authoritative manager control source on each manager session,
- reject mixed use of GraphQL manager messages and payload `managerControl` in one manager execution,
- preserve manager-session metadata during finalization so inspection stays accurate.

### Scope

**Included**:

- manager-session store support for persisted control-mode tracking
- session finalization behavior that preserves `lastMessageId` and control-mode
- runtime and manager-message-service exclusivity enforcement
- targeted regression coverage

**Excluded**:

- new GraphQL schema fields beyond the additive `ManagerSessionRecord` shape
- browser/editor GraphQL migration work
- cancellation model changes outside manager-session finalization accuracy

## Modules

### 1. Manager Session Control Authority

#### `src/workflow/manager-session-store.ts`

**Status**: COMPLETED

```typescript
export type ManagerControlMode =
  | "graphql-manager-message"
  | "payload-manager-control";

export interface ManagerSessionRecord {
  readonly managerSessionId: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerNodeId: string;
  readonly managerNodeExecId: string;
  readonly status: "active" | "completed" | "failed" | "cancelled";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastMessageId?: string;
  readonly controlMode?: ManagerControlMode;
  readonly authTokenHash: string;
  readonly authTokenExpiresAt: string;
}

export interface ManagerSessionStore {
  claimControlMode(input: {
    readonly managerSessionId: string;
    readonly controlMode: ManagerControlMode;
    readonly updatedAt: string;
  }): Promise<ManagerControlMode>;
}
```

**Checklist**:

- [x] Persist `controlMode` on manager sessions
- [x] Preserve `lastMessageId` and `controlMode` across finalization upserts
- [x] Add a store primitive that claims or validates the authoritative mode
- [x] Cover metadata preservation with tests

### 2. Runtime and GraphQL Enforcement

#### `src/workflow/manager-message-service.ts`, `src/workflow/engine.ts`

**Status**: COMPLETED

**Checklist**:

- [x] GraphQL manager-message flow claims `graphql-manager-message` authority
- [x] Payload `managerControl` flow claims `payload-manager-control` authority
- [x] Mixed-mode attempts fail the manager step deterministically
- [x] Manager-session terminal status reflects post-execution control validation failures

### 3. Regression Coverage

#### `src/workflow/manager-session-store.test.ts`, `src/workflow/manager-message-service.test.ts`, `src/workflow/engine.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Store tests cover control-mode claiming and finalization preservation
- [x] Manager message tests cover GraphQL control-mode claiming
- [x] Engine tests cover rejection of mixed GraphQL/payload manager control

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Manager session authority | `src/workflow/manager-session-store.ts` | COMPLETED | Passing |
| GraphQL/runtime enforcement | `src/workflow/manager-message-service.ts`, `src/workflow/engine.ts` | COMPLETED | Passing |
| Regression coverage | targeted test files | COMPLETED | Passing |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Control-mode persistence | `graphql-manager-runtime-session-lifecycle` | READY |
| Mixed-mode enforcement | Control-mode persistence | READY |
| Regression coverage | Control-mode persistence, mixed-mode enforcement | READY |

## Tasks

### TASK-001: Persist Manager Control Mode

**Status**: Completed
**Parallelizable**: Yes

**Deliverables**:

- `src/workflow/manager-session-store.ts`
- `src/workflow/manager-session-store.test.ts`

**Completion Criteria**:

- [x] manager sessions persist additive `controlMode`
- [x] finalization upserts preserve session metadata when omitted from the update input
- [x] tests cover claiming and preservation rules

### TASK-002: Enforce Exclusive Manager Control Mode

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-001`

**Deliverables**:

- `src/workflow/manager-message-service.ts`
- `src/workflow/engine.ts`
- `src/workflow/manager-message-service.test.ts`
- `src/workflow/engine.test.ts`

**Completion Criteria**:

- [x] GraphQL manager messages claim the GraphQL control mode
- [x] payload `managerControl` claims the payload control mode
- [x] mixed use fails instead of merging
- [x] manager-session terminal status reflects manager-control validation outcome

## Completion Criteria

- [x] One manager execution now uses at most one authoritative control channel
- [x] Manager-session inspection keeps `lastMessageId` and `controlMode` after finalization
- [x] Mixed GraphQL/payload control attempts fail deterministically
- [x] Targeted typecheck/tests pass

## Progress Log

### Session: 2026-03-15 13:25 JST
**Tasks Completed**: TASK-001, TASK-002
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Review of the current GraphQL manager implementation found that the design already required exclusive control-mode authority, but the runtime still allowed a manager execution to emit GraphQL manager messages and then return payload `managerControl`. The session-store upsert path also dropped `lastMessageId` during finalization. This slice adds explicit authority tracking and closes both gaps.
