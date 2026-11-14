# Matrix Event Source Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-event-listener-workflow-trigger.md#element--matrix`
**Created**: 2026-05-13
**Last Updated**: 2026-05-13

---

## Design Document Reference

**Sources**:

- `design-docs/specs/design-event-listener-workflow-trigger.md#element--matrix`
- `design-docs/specs/design-output-destinations-and-supervisor-memory.md#destination-configuration`
- `design-docs/specs/command.md#subcommands`
- `design-docs/user-qa/qa-matrix-event-source.md`

### Summary

Add first-slice Element/Matrix event source support. Element is treated as a
Matrix client: `kind: "matrix"` receives text-like Matrix room messages through
Client-Server `/sync`, normalizes them to `chat.message`, and sends workflow
chat replies through the Matrix room `send` API using the existing
provider-neutral chat reply dispatcher.

### Scope

**Included**: Matrix source config types, validation, default adapter
registration, `/sync` receive normalization for text-like `m.room.message`
events, bot self-message filtering, Matrix `dispatchChatReply`, examples,
operator docs, and targeted tests plus webhook/cron/s3 regression coverage.

**Excluded**: Matrix Application Service transactions, encrypted rooms,
attachments, reactions, edits, redactions, membership/state events, full
Matrix SDK adoption, and new workflow-engine Matrix-specific behavior.

### Codex Reference Mapping

No codex-agent reference paths were supplied for this issue-resolution run.
The plan intentionally follows repository-local event source and chat reply
contracts instead of external reference behavior.

---

## Task Breakdown

### TASK-001: Matrix Source Config Types And Validation

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/types.ts`, `src/events/validate.ts`,
`src/events/config.test.ts`

```typescript
interface MatrixSourceConfig extends EventSourceConfigBase {
  readonly kind: "matrix";
  readonly provider?: "matrix" | string;
  readonly homeserverUrlEnv: string;
  readonly accessTokenEnv: string;
  readonly userId: string;
  readonly rooms: readonly MatrixSourceRoomConfig[];
  readonly sync?: MatrixSourceSyncConfig;
  readonly ignoreOwnMessages?: boolean;
}

interface MatrixSourceRoomConfig extends JsonObject {
  readonly roomId: string;
  readonly alias?: string;
}

interface MatrixSourceSyncConfig extends JsonObject {
  readonly pollTimeoutMs?: number;
  readonly sinceTokenPath?: string;
}
```

**Checklist**:

- [x] Add `MatrixSourceConfig` to the `EventSourceConfig` union without weakening unknown-kind validation.
- [x] Add `matrix` to supported source kinds.
- [x] Validate `homeserverUrlEnv`, `accessTokenEnv`, `userId`, `rooms`, room id shape, and bounded sync timing.
- [x] Reject malformed env var names and malformed room/user ids.
- [x] Add validation tests for valid config and each required failure mode.

### TASK-002: Matrix Adapter Runtime And Receive Normalization

**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-001
**Deliverables**: `src/events/source-adapter.ts`,
`src/events/listener-service.ts`, `src/events/adapters/matrix.ts`,
`src/events/adapters/matrix.test.ts`

```typescript
interface MatrixRoomMessageInput extends JsonObject {
  readonly text: string;
  readonly html?: string;
  readonly roomId: string;
  readonly eventId: string;
  readonly sender: string;
  readonly msgtype: string;
  readonly replyToEventId?: string;
  readonly threadRootEventId?: string;
}
```

**Checklist**:

- [x] Provide Matrix adapter access to env, fetch, and sync state inputs through existing start options or a minimal extension.
- [x] Implement `/sync` long-poll start behavior for configured rooms with abort-aware shutdown.
- [x] Normalize text-like `m.room.message` events to `chat.message` envelopes.
- [x] Map `conversation.id`, optional `conversation.threadId`, `actor`, `eventId`, `dedupeKey`, and `rawRef` per design.
- [x] Ignore unsupported Matrix event types, attachment-only messages, and own bot messages by default.
- [x] Persist only non-secret sync cursor state; do not persist access tokens or authorization headers.
- [x] Add fixture-driven receive normalization tests.

### TASK-003: Matrix Chat Reply Dispatch

**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-002
**Deliverables**: `src/events/adapters/matrix.ts`,
`src/events/adapters/matrix.test.ts`, `src/events/reply-dispatcher.test.ts`

```typescript
function dispatchMatrixChatReply(
  input: EventSourceChatReplyInput,
): Promise<ChatReplyDispatchResult>;
```

**Checklist**:

- [x] Resolve target room from explicit destination target or inbound reply target.
- [x] Derive Matrix transaction id from `ChatReplyDispatchRequest.idempotencyKey`.
- [x] Send `m.room.message` to `/_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}`.
- [x] Include `m.relates_to.m.in_reply_to` and thread metadata when target context is present.
- [x] Return provider message/event id from Matrix response without storing token-bearing request metadata.
- [x] Add tests for target resolution, idempotent txn id, reply/thread relations, error handling, and redaction expectations.

### TASK-004: Adapter Registration And Event Runtime Integration

**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-002, TASK-003
**Deliverables**: `src/events/adapter-registry.ts`,
`src/events/adapter-registry.test.ts`, `src/events/listener-service.test.ts`,
`src/events/manual-emit.test.ts`

**Checklist**:

- [x] Register Matrix in `createDefaultEventSourceRegistry`.
- [x] Assert registry list and lookup include `matrix` while preserving duplicate-kind rejection.
- [x] Cover `events serve` startup for enabled Matrix sources using mocked fetch/timers.
- [x] Cover `events emit` or equivalent fixture path for Matrix raw payload normalization.
- [x] Confirm webhook, cron, and s3-repository adapters still register and behave unchanged.

### TASK-005: Examples And User-Facing Documentation

**Status**: Completed
**Parallelizable**: Yes, after TASK-001
**Dependencies**: TASK-001
**Deliverables**: `examples/event-sources/.divedra-events/sources/team-matrix.json`,
`examples/event-sources/.divedra-events/bindings/matrix-release-chat-to-workflow.json`,
`examples/event-sources/.divedra-events/destinations/release-matrix-chat.json`,
`examples/event-sources/payloads/matrix-room-message.json`,
`examples/event-sources/README.md`, `README.md`

**Checklist**:

- [x] Add Matrix source, binding, destination, and receive fixture examples using env var references only.
- [x] Document `DIVEDRA_MATRIX_HOMESERVER_URL` and `DIVEDRA_MATRIX_ACCESS_TOKEN` as examples, not hard requirements.
- [x] Show receive, binding, and explicit chat destination reply flow.
- [x] State first-slice limits: no encrypted rooms, attachments, reactions, edits, or appservice transactions.
- [x] Ensure examples remain directly usable with `--workflow-definition-dir ./examples`.

### TASK-006: Verification And Regression Pass

**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Deliverables**: test results, progress log update, completion criteria update

**Checklist**:

- [x] Run targeted event-source, reply-dispatch, listener, and CLI tests.
- [x] Run type checking.
- [x] Run event config validation against examples.
- [x] Update this plan progress log and completion criteria.
- [x] Complete the repository post-modification check/test pass after TypeScript modifications.

---

## Module Status

| Module                       | File Path                                                                                         | Status    | Tests                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| Matrix config and validation | `src/events/types.ts`, `src/events/validate.ts`                                                   | COMPLETED | `src/events/config.test.ts`                                                                                          |
| Matrix receive adapter       | `src/events/adapters/matrix.ts`, `src/events/source-adapter.ts`, `src/events/listener-service.ts` | COMPLETED | `src/events/adapters/matrix.test.ts`                                                                                 |
| Matrix reply dispatch        | `src/events/adapters/matrix.ts`                                                                   | COMPLETED | `src/events/adapters/matrix.test.ts`, `src/events/reply-dispatcher.test.ts`                                          |
| Registry/runtime integration | `src/events/adapter-registry.ts`, `src/events/listener-service.ts`, `src/events/manual-emit.ts`   | COMPLETED | `src/events/adapter-registry.test.ts`, `src/events/listener-service.test.ts`, `src/events/manual-emit.test.ts`       |
| Examples and docs            | `examples/event-sources/**`, `README.md`                                                          | COMPLETED | `divedra events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events` |

## Dependencies

| Task     | Depends On                                       | Status |
| -------- | ------------------------------------------------ | ------ |
| TASK-001 | accepted design review                           | DONE   |
| TASK-002 | TASK-001                                         | DONE   |
| TASK-003 | TASK-002                                         | DONE   |
| TASK-004 | TASK-002, TASK-003                               | DONE   |
| TASK-005 | TASK-001                                         | DONE   |
| TASK-006 | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005 | DONE   |

## Parallelization Rules

- `TASK-005` may run in parallel with adapter implementation after `TASK-001`
  because its write scope is examples and documentation only.
- `TASK-002` and `TASK-003` are not parallelizable because both own
  `src/events/adapters/matrix.ts`.
- `TASK-004` waits for adapter behavior so registration and integration tests
  assert the final capability surface.

## Verification Commands

```bash
bun test src/events/config.test.ts src/events/adapter-registry.test.ts src/events/adapters/matrix.test.ts
bun test src/events/reply-dispatcher.test.ts src/events/listener-service.test.ts src/events/manual-emit.test.ts
bun test src/events/adapters/webhook.test.ts src/events/adapters/cron.test.ts src/events/adapters/s3-repository.test.ts
bun test src/events/chat-reply-example.test.ts src/events/external-output.test.ts
bun run tsc --noEmit
divedra events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events
rg -n "kind: \"matrix\"|DIVEDRA_MATRIX|m\\.room\\.message|dispatchChatReply|matrix-release-chat" src/events examples/event-sources README.md -S
```

## Completion Criteria

- [x] Matrix source config validates valid configs and rejects malformed homeserver env, token env, user id, room id, missing room, and invalid sync timing.
- [x] Default event source registry includes `matrix` and existing `webhook`, `cron`, and `s3-repository` behavior remains covered by tests.
- [x] Matrix receive fixtures normalize to stable `sourceId`, `provider`, `eventType`, `eventId`, `dedupeKey`, `actor`, `conversation`, `input`, and `rawRef`.
- [x] Own bot messages and unsupported Matrix event kinds do not trigger workflows.
- [x] Matrix reply dispatch sends to the Matrix Client-Server room send API with idempotent transaction ids and reply/thread metadata.
- [x] Reply dispatch records and logs do not persist access tokens, authorization headers, or sensitive Matrix response bodies.
- [x] Examples and docs cover Matrix receive, binding, explicit chat destination, and reply configuration.
- [x] Targeted tests, regression tests, event validation, and `bun run tsc --noEmit` pass.

## Progress Log

### Session: 2026-05-13

**Tasks Completed**: Plan created from accepted Step 3 design review.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implementation must use the TypeScript coding workflow and run the repository-mandated check/test pass after TypeScript edits.

### Session: 2026-05-13 12:48

**Tasks Completed**: TASK-001 through TASK-006.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: The `design-and-implement-review-loop` workflow reached Step 6 implementation and wrote the Matrix changes, then the Step 6 worker stalled before publishing its candidate output. The stalled workflow process was terminated, and final verification was completed locally: full Bun test suite passed, typecheck passed, touched-file Prettier check passed, and example event configuration validation passed.

## Related Plans

- **Depends On**: `impl-plans/completed/event-source-adapters.md`
- **Depends On**: `impl-plans/event-reply-dispatcher.md`
- **Depends On**: `impl-plans/completed/output-destinations-supervisor-memory-foundation.md`
