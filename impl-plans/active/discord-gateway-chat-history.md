# Discord Gateway Chat History Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-discord-gateway-chat-history.md#overview`; `design-docs/specs/design-discord-gateway-chat-history.md#source-configuration`; `design-docs/specs/design-discord-gateway-chat-history.md#normalized-event-contract`; `design-docs/specs/design-discord-gateway-chat-history.md#history-model`; `design-docs/specs/design-discord-gateway-chat-history.md#reply-behavior`; `design-docs/specs/design-discord-gateway-chat-history.md#examples-and-tests`
**Created**: 2026-05-29
**Last Updated**: 2026-05-29

---

## Design Document Reference

**Sources**:

- `design-docs/specs/design-discord-gateway-chat-history.md`
- `design-docs/specs/design-chat-sdk-event-sources.md`
- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`
- `design-docs/specs/design-output-destinations-and-supervisor-memory.md`
- `design-docs/user-qa/qa-discord-gateway-chat-history.md`
- `design-docs/references/README.md`

### Summary

Add `kind: "discord-gateway"` as a rielflow-owned event source that listens to
configured Discord channels and threads, filters bot and self messages by
default, attaches bounded channel or thread history to normalized `chat.message`
events, and sends replies through the existing provider-neutral chat reply
worker and chat output destination path.

### Scope

**Included**: Discord Gateway source types, validation, default adapter
registration, bounded in-memory history with optional REST fetch, Gateway
message normalization, bot/self filtering, Discord REST reply dispatch, example
persona workflow/event binding, fixtures, README updates, and focused tests.

**Excluded**: external chat-gateway Discord support, durable cross-restart
history storage, multi-shard or multi-process Gateway coordination, slash
commands, interactions, components, moderation events, attachments, long-term
persona memory, and Discord-specific workflow.json fields.

### Accepted Review Decisions

- Step 3 accepted the design for `codex-design-and-implement-review-loop` in
  `issue-resolution` mode with no high or mid findings.
- Existing `kind: "chat-sdk"` Discord examples and behavior must remain
  compatible and distinct from the new `kind: "discord-gateway"` source.
- Discord channel/thread history is external event context and must be surfaced
  through `event.input.history` or mapped workflow input, not workflow inbox or
  agent transcript continuation.
- Persona behavior for Yui, Mika, and Rina belongs in bindings, example
  workflow prompts, or supervisor composition; adapter code only normalizes
  events and dispatches replies.
- Codex-agent references are process and workflow references only; provider
  behavior remains in rielflow event source adapters.

### Codex-Agent Reference Mapping

- `examples/event-sources/.rielflow-events/sources/chat-sdk-discord.json`:
  keep existing generic Chat SDK Discord webhook support unchanged.
- `examples/event-sources/.rielflow-events/bindings/chat-sdk-discord-to-workflow.json`:
  reuse provider-neutral binding and destination concepts without upgrading
  chat-sdk configs to Gateway semantics.
- `examples/discord-codex-chat/`: compatibility reference for
  `codex-agent` reply workflows using `rielflow/chat-reply-worker`.
- `packages/rielflow/src/events/adapters/matrix.ts`: reference for direct chat
  receive/reply adapter structure, env access, fetch use, and redaction.
- `packages/rielflow/src/events/adapters/chat-sdk/normalization.ts`: reference
  for provider chat normalization into `ExternalEventEnvelope`.

Intentional divergences from the references:

- Discord Gateway uses rielflow-owned Gateway/REST behavior rather than the
  external Chat SDK generic webhook/send boundary.
- History comes from bounded Discord channel/thread context, not workflow inbox
  messages or agent session transcripts.
- Discord-specific transport details stay under
  the repository's Discord Gateway adapter module.

### Repository State Decision

The current repository already contains
`packages/rielflow/src/events/adapters/discord-gateway.ts`, and
`packages/rielflow/src/events/adapter-registry.ts` imports that file directly.
This implementation plan therefore keeps the first slice in the existing
single-file adapter module. Do not create a sibling
`packages/rielflow/src/events/adapters/discord-gateway/` directory during this
implementation unless a separate module-split task first moves the existing
file, updates imports, and updates tests.

---

## Task Breakdown

### TASK-001: Discord Gateway Config Types And Validation

**Status**: COMPLETED
**Parallelizable**: Yes
**Deliverables**: `packages/rielflow-events/src/types.ts`,
`packages/rielflow/src/events/validate.ts`,
`packages/rielflow/src/events/validate-source-discord-gateway.ts`,
`packages/rielflow/src/events/validate-destinations.ts`,
`packages/rielflow/src/events/config.test.ts`
**Dependencies**: accepted Step 3 design review

```typescript
export interface DiscordGatewaySourceConfig extends EventSourceConfigBase {
  readonly kind: "discord-gateway";
  readonly provider?: "discord" | string;
  readonly tokenEnv: string;
  readonly applicationIdEnv: string;
  readonly guildIds?: readonly string[];
  readonly channels: readonly DiscordGatewayChannelConfig[];
  readonly history?: DiscordGatewayHistoryConfig;
  readonly filters?: DiscordGatewayFilterConfig;
  readonly reply?: DiscordGatewayReplyConfig;
}

export interface DiscordGatewayChannelConfig extends JsonObject {
  readonly id: string;
  readonly includeThreads?: boolean;
  readonly personas?: readonly string[];
}

export interface DiscordGatewayHistoryConfig extends JsonObject {
  readonly maxMessages?: number;
  readonly maxBytes?: number;
  readonly maxAgeMs?: number;
  readonly scope?: "thread-or-channel" | "channel";
  readonly includeBotMessages?: boolean;
  readonly fetchOnStart?: boolean;
  readonly fetchOnMessage?: "never" | "when-cache-empty" | "always";
}

export interface DiscordGatewayFilterConfig extends JsonObject {
  readonly ignoreBots?: boolean;
  readonly ignoreSelf?: boolean;
  readonly requireMention?: boolean;
}

export interface DiscordGatewayReplyConfig extends JsonObject {
  readonly threadPolicy?: "same-thread" | "conversation-root";
}
```

**Checklist**:

- [x] Add Discord Gateway config types to the exported event config union.
- [x] Add `discord-gateway` to supported source kinds without changing
      `chat-sdk` behavior.
- [x] Validate env-var names for token and application id, rejecting literal
      token-like values.
- [x] Validate Discord snowflake ids for guilds, channels, application ids,
      target ids, and deny malformed channel entries.
- [x] Enforce bounded history defaults and hard maxima for message count, byte
      count, and age.
- [x] Default `filters.ignoreBots` and `filters.ignoreSelf` to true in adapter
      behavior, and warn or reject unsafe loop-prevention combinations per
      accepted design.
- [x] Validate chat destinations that reference a Discord Gateway source can
      dispatch replies through that source.
- [x] Add config tests for valid source shapes, invalid credentials, invalid
      snowflakes, unbounded history, unsafe filters, and chat-sdk compatibility.

### TASK-002: Gateway Adapter Lifecycle And Transport Boundary

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:
`packages/rielflow/src/events/adapters/discord-gateway.ts`,
`packages/rielflow/src/events/adapters/discord-gateway.test.ts`,
`packages/rielflow/src/events/source-adapter.ts`
**Dependencies**: TASK-001

```typescript
interface DiscordGatewayTransport {
  connect(input: DiscordGatewayConnectInput): Promise<DiscordGatewayConnection>;
}

interface DiscordGatewayConnection {
  readonly botUserId?: string;
  stop(): Promise<void>;
}

interface DiscordGatewayRestClient {
  fetchRecentMessages(input: DiscordFetchRecentMessagesInput): Promise<
    readonly DiscordGatewayHistoryItem[]
  >;
  sendMessage(input: DiscordSendMessageInput): Promise<DiscordSendMessageResult>;
}
```

**Checklist**:

- [x] Extend the existing `packages/rielflow/src/events/adapters/discord-gateway.ts`
      adapter factory with `kind: "discord-gateway"`, `supportsStart: true`,
      no webhook route, and `chatReply: true`.
- [x] Preserve the existing `adapter-registry.ts` import path unless an
      explicit module split is implemented in this task.
- [x] Define narrow Gateway and REST transport ports so tests can use fixtures
      without real Discord network access.
- [x] Implement abort-aware startup and shutdown through `EventSourceStartInput`
      using env, fetch, dispatch, diagnostic sink, and clock inputs.
- [x] Handle configured channel/thread filtering before event dispatch.
- [x] Emit sanitized diagnostics for connection, REST, parse, and dispatch
      failures without credentials.
- [x] Keep dependency choice local to this adapter; if a Discord SDK is added,
      perform supply-chain review and update lockfile intentionally.
- [x] Add lifecycle tests for startup, shutdown, missing env, ignored channels,
      sanitized diagnostics, and no credential leakage.

### TASK-003: History Cache And Event Normalization

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:
`packages/rielflow/src/events/adapters/discord-gateway.ts`,
`packages/rielflow/src/events/adapters/discord-gateway.test.ts`,
`packages/rielflow/src/events/manual-emit.test.ts`
**Dependencies**: TASK-001, TASK-002

```typescript
interface DiscordGatewayMessageInput extends JsonObject {
  readonly provider: "discord";
  readonly text: string;
  readonly history: readonly DiscordGatewayHistoryItem[];
  readonly historySource: DiscordGatewayHistorySource;
  readonly discord: JsonObject;
  readonly replyTarget: {
    readonly sourceId: string;
    readonly provider: "discord";
    readonly eventId: string;
    readonly conversationId: string;
    readonly threadId?: string;
    readonly actorId: string;
  };
}

interface DiscordGatewayHistoryItem extends JsonObject {
  readonly messageId: string;
  readonly authorId: string;
  readonly displayName?: string;
  readonly isBot: boolean;
  readonly createdAt: string;
  readonly text: string;
  readonly conversationId: string;
  readonly threadId?: string;
}

interface DiscordGatewayHistorySource extends JsonObject {
  readonly mode: "memory" | "rest" | "mixed" | "empty";
  readonly maxMessages: number;
  readonly maxBytes: number;
  readonly maxAgeMs: number;
}
```

**Checklist**:

- [x] Normalize accepted Discord `MESSAGE_CREATE` events to
      `ExternalEventEnvelope` with `provider: "discord"` and
      `eventType: "chat.message"`.
- [x] Map event id, dedupe key, occurred time, actor, conversation, thread id,
      current text, Discord metadata, and provider-neutral reply target.
- [x] Maintain a bounded per-source history cache keyed by
      `sourceId:channelId:threadId-or-root`.
- [x] Exclude the current message from `input.history` and append it to the
      cache only after dispatch.
- [x] Trim history by max message count, bytes, age, and bot-message policy.
- [x] Support REST history fetch on start or message according to
      `fetchOnStart` and `fetchOnMessage`.
- [x] Distinguish Discord history from workflow inbox and session transcript in
      tests and fixture names.
- [x] Add fixture tests for chronological order, thread/channel scoping,
      cache-empty REST fetch, current-message exclusion, bot/self filtering,
      maxBytes trimming, and redacted raw refs.

### TASK-004: Reply Dispatch And Runtime Registration

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:
`packages/rielflow/src/events/adapters/discord-gateway.ts`,
`packages/rielflow/src/events/adapter-registry.ts`,
`packages/rielflow/src/events/reply-dispatcher.test.ts`,
`packages/rielflow/src/events/adapter-registry.test.ts`,
`packages/rielflow/src/events/listener-service.test.ts`
**Dependencies**: TASK-002, TASK-003

```typescript
function dispatchDiscordGatewayChatReply(
  input: EventSourceChatReplyInput,
): Promise<ChatReplyDispatchResult>;

interface DiscordSendMessageInput {
  readonly channelId: string;
  readonly threadId?: string;
  readonly content: string;
  readonly idempotencyKey: string;
}
```

**Checklist**:

- [x] Resolve reply target from explicit chat destination target or inbound
      event reply target.
- [x] Respect `threadPolicy: "same-thread"` and fail explicitly when
      `conversation-root` cannot be resolved safely.
- [x] Send Discord replies through REST using the configured token env value.
- [x] Return Discord response message id when available and persist only
      redacted request metadata in dispatch records.
- [x] Register the adapter in `createDefaultEventSourceRegistry()`.
- [x] Keep `adapter-registry.ts` importing
      `./adapters/discord-gateway` from the existing file-backed module.
- [x] Cover registry lookup, duplicate-kind protection, listener startup, reply
      target resolution, idempotency key propagation, REST errors, and redaction
      expectations.
- [x] Keep chat-sdk Discord dispatch tests passing unchanged.

### TASK-005: Persona Example, Fixtures, And User-Facing Docs

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-001
**Deliverables**:
`examples/event-sources/.rielflow-events/sources/discord-gateway-personas.json`,
`examples/event-sources/.rielflow-events/destinations/discord-gateway-persona-replies.json`,
`examples/event-sources/.rielflow-events/bindings/discord-gateway-personas-to-workflow.json`,
`examples/event-sources/payloads/discord-gateway-message-with-history.json`,
`examples/discord-persona-chat/workflow.json`,
`examples/discord-persona-chat/nodes/node-*.json`,
`examples/discord-persona-chat/prompts/*.md`,
`examples/discord-persona-chat/EXPECTED_RESULTS.md`,
`examples/event-sources/README.md`,
`README.md`
**Dependencies**: TASK-001

**Checklist**:

- [x] Add source, destination, binding, and payload examples using env-var
      references only.
- [x] Add a history-aware `discord-persona-chat` workflow demonstrating Yui,
      Mika, and Rina persona routing with Mika receiving bounded prior context.
- [x] Use `promptTemplateFile` for long persona prompts.
- [x] Keep examples directly usable with `--workflow-definition-dir ./examples`.
- [x] Document required Discord bot token, application id env vars, privileged
      message content intent, configured channels, history limits, and first
      slice exclusions.
- [x] State that chat-sdk Discord remains a separate generic webhook path.
- [x] Add expected-results notes for validation, mock payloads, reply dispatch,
      and no-token fixtures.

### TASK-006: Verification And Progress Update

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: verification command results, this plan progress-log update,
completion criteria updates
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Checklist**:

- [x] Run type checking after TypeScript changes.
- [x] Run targeted config, adapter, registry, listener, reply-dispatch, manual
      emit, and example tests.
- [x] Run event config validation against `examples/event-sources/.rielflow-events`.
- [x] Run workflow validation for `examples/discord-persona-chat`.
- [x] Run chat-sdk and Matrix event source regressions to verify compatibility.
- [x] Update this plan's task statuses, module status table, completion
      criteria, and progress log.

---

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Discord Gateway config and validation | `packages/rielflow-events/src/types.ts`, `packages/rielflow/src/events/validate-source-discord-gateway.ts`, `packages/rielflow/src/events/validate.ts`, `packages/rielflow/src/events/validate-destinations.ts` | COMPLETED | `packages/rielflow/src/events/config.test.ts` |
| Gateway lifecycle and transport boundary | `packages/rielflow/src/events/adapters/discord-gateway.ts`, `packages/rielflow/src/events/source-adapter.ts` | COMPLETED | `packages/rielflow/src/events/adapters/discord-gateway.test.ts`, `packages/rielflow/src/events/listener-service.test.ts` |
| History and normalization | `packages/rielflow/src/events/adapters/discord-gateway.ts` | COMPLETED | `packages/rielflow/src/events/adapters/discord-gateway.test.ts`, `packages/rielflow/src/events/manual-emit.test.ts` |
| Reply dispatch and registry | `packages/rielflow/src/events/adapters/discord-gateway.ts`, `packages/rielflow/src/events/adapter-registry.ts` | COMPLETED | `packages/rielflow/src/events/reply-dispatcher.test.ts`, `packages/rielflow/src/events/adapter-registry.test.ts` |
| Examples and docs | `examples/event-sources/**`, `examples/discord-persona-chat/**`, `examples/event-sources/README.md`, `README.md` | COMPLETED | `packages/rielflow/src/events/chat-reply-example.test.ts`, CLI validation commands |

## Dependencies

| Task | Depends On | Status |
| ---- | ---------- | ------ |
| TASK-001 | accepted Step 3 design review | COMPLETED |
| TASK-002 | TASK-001 | COMPLETED |
| TASK-003 | TASK-001, TASK-002 | COMPLETED |
| TASK-004 | TASK-002, TASK-003 | COMPLETED |
| TASK-005 | TASK-001 | COMPLETED |
| TASK-006 | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005 | COMPLETED |

## Parallelization Rules

- `TASK-005` may run in parallel with adapter implementation after `TASK-001`
  because its write scope is examples and documentation.
- `TASK-002`, `TASK-003`, and `TASK-004` are not parallelizable with each other
  because they share the existing
  `packages/rielflow/src/events/adapters/discord-gateway.ts` module and
  runtime integration behavior.
- `TASK-006` is serial and must run after all implementation and documentation
  changes are complete.

## Verification Plan

- `bun run typecheck`
- `bun test packages/rielflow/src/events/config.test.ts packages/rielflow/src/events/adapter-registry.test.ts packages/rielflow/src/events/listener-service.test.ts`
- `bun test packages/rielflow/src/events/adapters/discord-gateway.test.ts packages/rielflow/src/events/reply-dispatcher.test.ts packages/rielflow/src/events/manual-emit.test.ts`
- `bun test packages/rielflow/src/events/adapters/chat-sdk.test.ts packages/rielflow/src/events/adapters/matrix.test.ts`
- `bun test packages/rielflow/src/events/chat-reply-example.test.ts`
- `bun run packages/rielflow/src/bin.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events`
- `bun run packages/rielflow/src/bin.ts workflow validate discord-persona-chat --workflow-definition-dir ./examples`
- `git diff --check`

## Completion Criteria

- [x] `kind: "discord-gateway"` config loads and validates with bounded
      history and safe defaults.
- [x] Existing `kind: "chat-sdk"` Discord config, tests, and examples remain
      compatible and unchanged in semantics.
- [x] Gateway receive path ignores bot/self messages by default and emits
      deterministic `chat.message` envelopes.
- [x] `event.input.history` contains bounded chronological Discord channel or
      thread history, excludes the current message, and records effective
      history bounds.
- [x] Discord replies dispatch through provider-neutral chat reply requests and
      redacted Discord REST send behavior.
- [x] Persona example demonstrates Yui, Mika, and Rina routing with bounded
      history available to Mika.
- [x] User-facing docs cover setup, intents, env vars, history limits,
      compatibility, and first-slice exclusions.
- [x] Verification commands in this plan pass or any failures are documented
      with concrete follow-up.
- [x] Progress log records each implementation session and task status updates.

## Progress Log

### Session: 2026-05-29 16:02 +0900

**Tasks Completed**: Plan created from accepted Step 3 design review
**Tasks In Progress**: None
**Blockers**: None
**Notes**: No Step 5 rerun feedback was present. Implementation should start
with TASK-001, then proceed through adapter lifecycle, history normalization,
reply dispatch, examples, and verification.

### Session: 2026-05-29 16:12 +0900

**Tasks Completed**: Addressed Step 5 implementation-plan review feedback
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Revised adapter deliverables to use the existing
`packages/rielflow/src/events/adapters/discord-gateway.ts` file-backed module
and documented that a directory split requires an explicit move/import/test
update task.

### Session: 2026-05-29 16:25 +0900

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Implemented first-class `discord-gateway` config validation,
default registry wiring, Gateway receive lifecycle, bounded memory/REST
history normalization, `event.input.replyTarget`, Discord REST reply dispatch,
bot/self filtering defaults, example event bindings, `discord-persona-chat`
workflow, and user-facing docs. Verification passed for typecheck, Biome,
targeted event-source tests, chat-sdk and Matrix regressions, example event
validation, workflow validation, build, package-boundary rerun, and isolated
GraphQL inspection rerun. Full `bun run test` passed 1379 tests and had one
known isolated-pass GraphQL HTTP transport timeout in the full parallel suite.

### Session: 2026-05-29 16:37 +0900

**Tasks Completed**: Step 7 implementation review revision for TASK-002 and
TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed Step 7 mid findings by enforcing
`channels[].includeThreads: false` for messages whose configured match is the
parent channel, and by dropping any single history entry whose serialized size
exceeds `history.maxBytes`. Added focused regression tests for both review
findings. Requested verification was rerun for the Discord Gateway/config
tests, typecheck, Biome lint, and full test suite behavior is documented in the
Step 6 return payload.

### Session: 2026-05-29 16:46 +0900

**Tasks Completed**: Step 7 implementation review revision for TASK-002 and
TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed Step 7 mid findings by preferring exact configured thread
channel matches before parent-channel fallback, and by fetching REST history
from the effective history conversation id so `history.scope: "channel"` uses
the parent channel for thread messages. Added regression tests for explicit
thread precedence and channel-scope REST history targeting.

### Session: 2026-05-29 16:55 +0900

**Tasks Completed**: Step 7 implementation review revision for TASK-002 and
TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed Step 7 mid findings by resolving real Discord thread
messages that omit `parent_channel_id` through Gateway thread metadata or REST
channel lookup, and by appending accepted messages to the history cache before
awaiting workflow dispatch. Added regressions for parent-channel thread routing
without synthetic parent metadata and for immediate back-to-back message
history while the first dispatch remains blocked.

### Session: 2026-05-29 17:04 +0900

**Tasks Completed**: Step 7 implementation review revision for TASK-001,
TASK-002, and TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed Step 7 mid finding by serializing `MESSAGE_CREATE`
processing per effective history key across REST history fetch, event
normalization, cache append, and dispatch. Tightened Discord snowflake
validation to reject short numeric ids and updated config tests to cover short
guild, channel, and destination conversation ids.

### Session: 2026-05-29 17:10 +0900

**Tasks Completed**: Step 7 implementation review revision for TASK-002,
TASK-003, and TASK-004
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed Step 7 mid finding by serializing same-channel Gateway
messages before thread parent REST lookup, then serializing effective history
processing after parent resolution. Added regression coverage for blocked
thread-parent lookup ordering, Discord `replyBots` token selection through
`replyAs`, and chat reply worker `replyAsTemplate` propagation.

## Related Plans

- **Depends On**: `impl-plans/completed/chat-sdk-event-sources.md`,
  `impl-plans/completed/matrix-event-source.md`,
  `impl-plans/node-addon-chat-reply-worker.md`,
  `impl-plans/event-reply-dispatcher.md`
- **Next**: Implementation step for
  `codex-design-and-implement-review-loop` issue-resolution mode
