# Event Reply Dispatch Persistence Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#event-layer-responsibilities`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

## Design Summary

Persist outbound chat reply dispatch attempts in the runtime database so
`rielflow/chat-reply-worker` replies have an audit trail and can reuse successful
idempotent results beyond a single in-process dispatcher instance.

## Modules

### 1. Runtime DB Records

#### `src/workflow/runtime-db.ts`

**Status**: Completed

**Checklist**:

- [x] Add `event_reply_dispatches` schema
- [x] Add save/load/list helpers
- [x] Preserve existing DB migration compatibility

### 2. Dispatcher Persistence

#### `src/events/reply-dispatcher.ts`

**Status**: Completed

**Checklist**:

- [x] Save `dispatching` before adapter call
- [x] Save `sent` / `queued` on success
- [x] Save `failed` on adapter error
- [x] Reuse persisted successful results by idempotency key

### 3. Verification

#### `src/events/reply-dispatcher.test.ts`

**Status**: Completed

**Checklist**:

- [x] Assert successful dispatch persists a runtime record
- [x] Assert a second dispatcher instance reuses persisted idempotent result
- [x] Assert failed dispatches are recorded
- [x] Run typecheck and targeted tests

### 4. Operator/API Surface

#### `src/cli.ts`, `src/lib.ts`, `src/graphql/*`

**Status**: Completed

**Checklist**:

- [x] Add CLI listing for persisted reply dispatches
- [x] Include reply dispatches in library runtime session views
- [x] Include reply dispatches in GraphQL execution views
- [x] Add focused CLI and GraphQL tests

## Completion Criteria

- [x] Reply dispatch attempts are queryable from runtime DB helpers
- [x] Sent/queued idempotent results survive dispatcher recreation
- [x] Failed dispatches are auditable
- [x] Reply dispatches are visible from CLI/library/GraphQL runtime views
- [x] Targeted tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-04-20

**Tasks Completed**: Runtime DB schema/helpers, dispatcher persistence, idempotent persisted reuse, failure audit, CLI/API visibility, tests
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Reply dispatches now persist to `event_reply_dispatches`; sent/queued records short-circuit future dispatcher instances with the same idempotency key.
