# Node Session Reuse Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-node-session-reuse.md, design-docs/specs/architecture.md#node-model
**Created**: 2026-03-07
**Last Updated**: 2026-03-07

## Summary

Add opt-in node-local backend session reuse so repeated executions of the same node can continue one backend-managed session within a workflow run, including after `session resume`.

## Scope

Included:
- Node payload schema support for `sessionPolicy`
- Workflow session persistence for reusable backend session handles
- Adapter request/response extensions for opaque backend session ids
- Engine wiring for repeated node execution and output-contract retry reuse
- Tests for validation, adapter transport, and engine behavior

Not included:
- Provider-specific transcript replay inside the engine
- Cross-node shared backend sessions
- Browser editor affordances for the new field

## Modules

### 1. Workflow Types and Validation

#### `src/workflow/types.ts`

```ts
export interface NodeSessionPolicy {
  readonly mode: "new" | "reuse";
}
```

**Checklist**:
- [x] Add node session policy types
- [x] Add `sessionPolicy` to `NodePayload`

### 2. Session Persistence

#### `src/workflow/session.ts`

```ts
export interface NodeBackendSessionRecord {
  readonly nodeId: string;
  readonly sessionId: string;
}
```

**Checklist**:
- [x] Persist node backend session records in workflow session state
- [x] Preserve them through normalize/clone/create flows

### 3. Adapter Contract

#### `src/workflow/adapter.ts`

```ts
export interface AdapterBackendSessionInput {
  readonly mode: "new" | "reuse";
  readonly sessionId?: string;
}
```

**Checklist**:
- [x] Extend adapter input/output types for backend sessions
- [x] Normalize optional backend session response payload
- [x] Send backend session fields through codex/claude transport adapters

### 4. Engine Wiring

#### `src/workflow/engine.ts`

**Checklist**:
- [x] Resolve requested backend session mode from node policy and stored session state
- [x] Reuse the latest backend session id across output-contract retries
- [x] Persist returned backend session id in workflow session state and execution metadata
- [x] Reuse persisted node backend sessions after `session resume`

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Workflow types and validation | `src/workflow/types.ts`, `src/workflow/validate.ts` | COMPLETED | `src/workflow/validate.test.ts` |
| Session persistence | `src/workflow/session.ts` | COMPLETED | engine tests |
| Adapter contract | `src/workflow/adapter.ts`, `src/workflow/adapters/*.ts` | COMPLETED | adapter tests |
| Engine wiring | `src/workflow/engine.ts` | COMPLETED | `src/workflow/engine.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Session persistence | Workflow types | READY |
| Adapter contract | Workflow types | READY |
| Engine wiring | Session persistence, adapter contract | READY |

## Completion Criteria

- [x] Node payloads can opt into backend session reuse
- [x] Repeated executions of the same node receive the persisted backend session id
- [x] Output-contract retries reuse the same backend session when available
- [x] Resume path preserves reusable node backend sessions
- [x] Type checking passes
- [x] Targeted tests pass

## Progress Log

### Session: 2026-03-07 18:25
**Tasks Completed**: Plan creation, design validation
**Tasks In Progress**: Workflow types, session persistence, adapter contract, engine wiring
**Blockers**: None
**Notes**: Current runtime persists only workflow session state. Adapter protocol has no backend session field, so repeated node execution cannot resume one backend thread today.

### Session: 2026-03-07 18:45
**Tasks Completed**: Workflow types, validation, adapter contract, engine wiring, targeted verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added opt-in `sessionPolicy.mode = "reuse"`, persisted opaque backend session ids in workflow session state, forwarded backend session hints through tacogips transport adapters, and verified reuse in both same-run and `session resume` flows.

### Session: 2026-03-07 19:49
**Tasks Completed**: Post-implementation review and metadata correctness fix
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Reviewed the in-progress diff per continuation workflow, found that node execution metadata reported the first reusable-node call as `backendSessionMode: "reuse"` after the adapter returned a new session id, and corrected the engine to preserve the originally requested mode while keeping session-id persistence and resume behavior unchanged.

### Session: 2026-03-07 19:59
**Tasks Completed**: Post-implementation review follow-up, failure-path persistence fix, targeted verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Found that several post-execution failure branches still dropped `nodeBackendSessions`, which could lose a reusable backend session handle after a successful adapter call followed by manager-control or conversation bookkeeping failure. Patched those branches, added a regression test for manager-control parse failure after backend session creation, and re-ran targeted Bun tests plus `tsc --noEmit`.

### Session: 2026-03-07 20:08
**Tasks Completed**: Continuation review, explicit-`new` session-policy contract fix, targeted verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Found that `sessionPolicy.mode = "new"` was accepted by validation and documented by the adapter contract, but the engine dropped the hint instead of forwarding it. Patched engine session resolution to pass `{ mode: "new" }` explicitly, documented the behavior, and added a regression test confirming the hint is sent without persisting a reusable node backend session.

### Session: 2026-03-07 20:18
**Tasks Completed**: Continuation review, scenario validation, targeted verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Reviewed the current diff against the intended `A -> B -> C -> B` reusable-node scenario, confirmed the design and implementation already support node-local backend session continuation within one workflow run and across `session resume`, and re-ran targeted Bun tests plus `tsc --noEmit` with no additional fixes required.

### Session: 2026-03-07 20:25
**Tasks Completed**: Continuation review follow-up, rerun-boundary regression coverage
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Confirmed the current implementation already creates a fresh workflow session for `session rerun`, so reusable node backend sessions are not inherited from the source run. Added a regression test that starts a new run from the reusable node and verifies the first rerun visit requests `backendSession.mode = "new"` before establishing a new reusable handle for later visits in the rerun session.

### Session: 2026-03-07 20:33
**Tasks Completed**: Continuation review follow-up, manager-control failure execution-history fix
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Found that manager-control validation failure branches preserved reusable backend session state but dropped the just-completed `nodeExecutions` record, leaving session counters and audit history inconsistent. Patched those branches to persist the completed execution record and extended the regression test to assert both backend-session persistence and execution-history integrity.

### Session: 2026-03-07 20:45
**Tasks Completed**: Continuation review follow-up, runtime SQLite metadata parity fix, targeted verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Found that session JSON persisted `backendSessionMode` / `backendSessionId` for node executions, but the SQLite runtime index dropped those fields. Added runtime-db schema and migration support, forwarded the metadata from engine persistence, and added a regression test for reusable-node execution rows.
