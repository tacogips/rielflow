# Discord Gateway Chat History Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-discord-gateway-chat-history.md#overview`; `design-docs/specs/design-discord-gateway-chat-history.md#source-configuration`; `design-docs/specs/design-discord-gateway-chat-history.md#normalized-event-contract`; `design-docs/specs/design-discord-gateway-chat-history.md#persistent-history-model`; `design-docs/specs/design-discord-gateway-chat-history.md#reply-behavior`; `design-docs/specs/design-discord-gateway-chat-history.md#examples-and-tests`
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
events, persists bounded normalized history under the event data root across
`rielflow events serve` restarts, and sends replies through the existing
provider-neutral chat reply worker and chat output destination path.

### Scope

**Included**: Discord Gateway source types, validation, default adapter
registration, bounded in-memory history with optional REST fetch, persistent
bounded normalized history under `EventSourceStartInput.eventDataRoot`, Gateway
message normalization, bot/self filtering, Discord REST reply dispatch, example
persona workflow/event binding, fixtures, README updates, and focused tests.

**Excluded**: external chat-gateway Discord support, multi-shard or
multi-process Gateway coordination, slash
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
- Step 3 accepted the restart-persistence design revision for
  `EventSourceStartInput.eventDataRoot`, bounded reload, accepted-message
  append timing, REST merge/dedupe, and Discord-only adapter ownership with no
  high or mid findings.

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
- Durable restart history intentionally diverges from the earlier completed
  slice, which kept Discord history in memory and excluded cross-restart
  storage.

### Repository State Decision

The current repository already contains
`packages/rielflow/src/events/adapters/discord-gateway.ts`, and
`packages/rielflow/src/events/adapter-registry.ts` imports that file directly.
This implementation plan therefore keeps the first slice in the existing
single-file adapter module. Do not create a sibling
`packages/rielflow/src/events/adapters/discord-gateway/` directory during this
implementation unless a separate module-split task first moves the existing
file, updates imports, and updates tests.

The current issue-resolution slice extends that completed module in place. It
must not move persistence into `chat-gateway`, workflow inbox storage, agent
session transcript storage, or provider-neutral chat reply modules.

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

### TASK-007: Persistent History Store Contract

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `packages/rielflow/src/events/adapters/discord-gateway.ts`,
`packages/rielflow/src/events/adapters/discord-gateway.test.ts`
**Dependencies**: accepted Step 3 design review

```typescript
interface DiscordGatewayPersistedHistoryFile extends JsonObject {
  readonly version: 1;
  readonly sourceId: string;
  readonly historyKey: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly bounds: DiscordGatewayPersistedHistoryBounds;
  readonly messages: readonly DiscordGatewayHistoryItem[];
}

interface DiscordGatewayPersistedHistoryBounds extends JsonObject {
  readonly maxMessages: number;
  readonly maxBytes: number;
  readonly maxAgeMs: number;
  readonly scope: "thread-or-channel" | "channel";
  readonly includeBotMessages: boolean;
}

interface DiscordGatewayHistoryPersistence {
  load(key: string, receivedAt: string): Promise<readonly DiscordGatewayHistoryItem[]>;
  save(
    key: string,
    history: readonly DiscordGatewayHistoryItem[],
    receivedAt: string,
  ): Promise<void>;
  readonly enabled: boolean;
}
```

**Description**:
Define the adapter-owned persistent history file shape and helper boundary for
bounded normalized history under
`<eventDataRoot>/discord-gateway/history/<sourceId>/<encoded-conversation-key>.json`.

**Completion Criteria**:

- [x] Define internal persisted history file and bounds types in the Discord
      Gateway adapter module or an adapter-local helper without exporting them
      through provider-neutral event APIs.
- [x] Derive a filesystem-safe source id directory and encoded conversation key
      filename without allowing path traversal.
- [x] Persist only normalized `DiscordGatewayHistoryItem[]`, bounds metadata,
      source id, effective history key, and conversation identifiers.
- [x] Exclude bot tokens, authorization headers, raw Gateway payloads, workflow
      inbox data, agent transcript data, and unbounded receipts from the file
      schema.
- [x] Add unit coverage for path derivation and JSON shape using a temporary
      event data root.

### TASK-008: Startup Reload And REST Merge

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/events/adapters/discord-gateway.ts`,
`packages/rielflow/src/events/adapters/discord-gateway.test.ts`
**Dependencies**: TASK-007

```typescript
interface DiscordGatewayHistorySeedResult extends JsonObject {
  readonly mode: "persisted" | "rest" | "mixed" | "empty";
  readonly count: number;
}

interface DiscordGatewayHistoryPersistenceOptions {
  readonly eventDataRoot?: string;
  readonly readOnly?: boolean;
  readonly source: DiscordGatewaySourceConfig;
  readonly diagnosticSink?: EventSourceStartInput["diagnosticSink"];
}
```

**Description**:
Load persisted history before Gateway messages are processed and before optional
REST seeding. Merge persisted, in-memory, and REST entries by Discord
`messageId`, sort chronologically when timestamps exist, then trim using the
existing history bounds.

**Completion Criteria**:

- [x] Build persistence only when `eventDataRoot` is present and `readOnly` is
      not true; otherwise keep current memory plus REST behavior and emit a
      sanitized diagnostic.
- [x] Reload known configured channel conversation files on source start before
      optional `history.fetchOnStart` REST seeding.
- [x] Support lazy reload for a conversation key when the first accepted
      Gateway message references a persisted file that was not eagerly known at
      startup.
- [x] Merge persisted and REST history by `messageId` and preserve chronological
      ordering before trim.
- [x] Validate corrupt or wrong-version persisted files and ignore them with a
      sanitized diagnostic rather than failing source startup.
- [x] Add tests proving a second adapter start with the same event data root can
      dispatch a message whose `event.input.history` includes a prior accepted
      message without REST history.

### TASK-009: Append, Trim, And Atomic Write

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/events/adapters/discord-gateway.ts`,
`packages/rielflow/src/events/adapters/discord-gateway.test.ts`
**Dependencies**: TASK-007, TASK-008

```typescript
interface DiscordGatewayHistoryWriteInput {
  readonly key: string;
  readonly history: readonly DiscordGatewayHistoryItem[];
  readonly source: DiscordGatewaySourceConfig;
  readonly receivedAt: string;
}
```

**Description**:
Persist the bounded compact cache after each accepted-message append, inside the
existing same-conversation serialization boundary, using temp-file plus rename
atomic writes.

**Completion Criteria**:

- [x] Append the current accepted message to memory after normalized event
      construction and before awaiting dispatch completion, preserving existing
      prompt-history current-message exclusion.
- [x] Rewrite the compact persisted file after trimming by `maxMessages`,
      `maxBytes`, `maxAgeMs`, `scope`, and `includeBotMessages`.
- [x] Keep writes inside the existing effective-history-key queue so concurrent
      same-conversation messages cannot lose updates.
- [x] Write to a temporary file in the target directory and rename into place.
- [x] Surface write failures through sanitized diagnostics without leaking
      credentials and without writing outside `eventDataRoot`.
- [x] Add tests for maxMessages, maxBytes, maxAgeMs, bot-message filtering,
      same-conversation concurrent append ordering, and no write in read-only
      mode.

### TASK-010: Documentation And Example Alignment

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `README.md`, `examples/event-sources/README.md`,
`examples/discord-persona-chat/EXPECTED_RESULTS.md`
**Dependencies**: TASK-007

**Description**:
Align user-facing docs and examples with durable bounded restart history while
keeping the existing `chat-sdk` Discord path distinct.

**Completion Criteria**:

- [x] Update docs to say Discord Gateway history persists under the event data
      root during normal `events serve` operation.
- [x] Document degradation when `eventDataRoot` is absent or `readOnly` is true.
- [x] Document that persisted files contain bounded normalized conversation
      history only and are not workflow inbox, agent transcript, or long-term
      memory.
- [x] Keep `chat-sdk` Discord compatibility wording unchanged except where
      clarifying that it is separate from `discord-gateway`.
- [x] Refresh example expected-results notes to mention restart/reload coverage
      and persistence bounds.

### TASK-011: Verification And Plan Progress Update

**Status**: Completed
**Parallelizable**: No
**Deliverables**: verification command results, this plan progress-log update,
completion criteria updates
**Dependencies**: TASK-008, TASK-009, TASK-010

**Description**:
Run focused and regression verification after the persistence implementation and
documentation updates, then update this plan's task statuses and progress log.

**Completion Criteria**:

- [x] Run `bun test packages/rielflow/src/events/adapters/discord-gateway.test.ts`.
- [x] Run `bun test packages/rielflow/src/events/manual-emit.test.ts packages/rielflow/src/events/config.test.ts`.
- [x] Run `bun test packages/rielflow/src/events/adapters/chat-sdk.test.ts packages/rielflow/src/events/reply-dispatcher.test.ts`.
- [x] Run `bun run typecheck`.
- [x] Run `git diff --check`.
- [x] Update TASK-007 through TASK-011 statuses, module status rows, completion
      criteria, and progress log with verification results or documented
      blockers.

---

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Discord Gateway config and validation | `packages/rielflow-events/src/types.ts`, `packages/rielflow/src/events/validate-source-discord-gateway.ts`, `packages/rielflow/src/events/validate.ts`, `packages/rielflow/src/events/validate-destinations.ts` | COMPLETED | `packages/rielflow/src/events/config.test.ts` |
| Gateway lifecycle and transport boundary | `packages/rielflow/src/events/adapters/discord-gateway.ts`, `packages/rielflow/src/events/source-adapter.ts` | COMPLETED | `packages/rielflow/src/events/adapters/discord-gateway.test.ts`, `packages/rielflow/src/events/listener-service.test.ts` |
| History and normalization | `packages/rielflow/src/events/adapters/discord-gateway.ts` | COMPLETED | `packages/rielflow/src/events/adapters/discord-gateway.test.ts`, `packages/rielflow/src/events/manual-emit.test.ts` |
| Reply dispatch and registry | `packages/rielflow/src/events/adapters/discord-gateway.ts`, `packages/rielflow/src/events/adapter-registry.ts` | COMPLETED | `packages/rielflow/src/events/reply-dispatcher.test.ts`, `packages/rielflow/src/events/adapter-registry.test.ts` |
| Examples and docs | `examples/event-sources/**`, `examples/discord-persona-chat/**`, `examples/event-sources/README.md`, `README.md` | COMPLETED | `packages/rielflow/src/events/chat-reply-example.test.ts`, CLI validation commands |
| Persistent history store contract | `packages/rielflow/src/events/adapters/discord-gateway.ts`, `packages/rielflow/src/events/adapters/discord-gateway-history-persistence.ts` | COMPLETED | `packages/rielflow/src/events/adapters/discord-gateway.test.ts` |
| Startup reload and REST merge | `packages/rielflow/src/events/adapters/discord-gateway.ts`, `packages/rielflow/src/events/adapters/discord-gateway-history-persistence.ts` | COMPLETED | `packages/rielflow/src/events/adapters/discord-gateway.test.ts` |
| Atomic append and compact persistence | `packages/rielflow/src/events/adapters/discord-gateway.ts`, `packages/rielflow/src/events/adapters/discord-gateway-history-persistence.ts` | COMPLETED | `packages/rielflow/src/events/adapters/discord-gateway.test.ts` |
| Persistence docs and examples | `README.md`, `examples/event-sources/README.md`, `examples/discord-persona-chat/EXPECTED_RESULTS.md` | COMPLETED | `git diff --check` |

## Dependencies

| Task | Depends On | Status |
| ---- | ---------- | ------ |
| TASK-001 | accepted Step 3 design review | COMPLETED |
| TASK-002 | TASK-001 | COMPLETED |
| TASK-003 | TASK-001, TASK-002 | COMPLETED |
| TASK-004 | TASK-002, TASK-003 | COMPLETED |
| TASK-005 | TASK-001 | COMPLETED |
| TASK-006 | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005 | COMPLETED |
| TASK-007 | accepted Step 3 design review | COMPLETED |
| TASK-008 | TASK-007 | COMPLETED |
| TASK-009 | TASK-007, TASK-008 | COMPLETED |
| TASK-010 | TASK-007 | COMPLETED |
| TASK-011 | TASK-008, TASK-009, TASK-010 | COMPLETED |

## Parallelization Rules

- `TASK-005` may run in parallel with adapter implementation after `TASK-001`
  because its write scope is examples and documentation.
- `TASK-002`, `TASK-003`, and `TASK-004` are not parallelizable with each other
  because they share the existing
  `packages/rielflow/src/events/adapters/discord-gateway.ts` module and
  runtime integration behavior.
- `TASK-006` is serial and must run after all implementation and documentation
  changes are complete.
- `TASK-007` can start immediately because it defines the persistence contract
  in the Discord Gateway adapter test scope.
- `TASK-010` can run after `TASK-007` in parallel with `TASK-008` and
  `TASK-009` because its write scope is docs and examples.
- `TASK-008` and `TASK-009` are serial because both modify the same adapter
  history load, merge, append, and queue behavior.
- `TASK-011` is serial and must run after persistence implementation and docs
  are complete.

## Verification Plan

- `bun run typecheck`
- `bun test packages/rielflow/src/events/config.test.ts packages/rielflow/src/events/adapter-registry.test.ts packages/rielflow/src/events/listener-service.test.ts`
- `bun test packages/rielflow/src/events/adapters/discord-gateway.test.ts packages/rielflow/src/events/reply-dispatcher.test.ts packages/rielflow/src/events/manual-emit.test.ts`
- `bun test packages/rielflow/src/events/adapters/chat-sdk.test.ts packages/rielflow/src/events/adapters/matrix.test.ts`
- `bun test packages/rielflow/src/events/chat-reply-example.test.ts`
- `bun test packages/rielflow/src/events/manual-emit.test.ts packages/rielflow/src/events/config.test.ts`
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
- [x] Discord Gateway reloads persisted bounded normalized history from
      `EventSourceStartInput.eventDataRoot` before processing accepted Gateway
      messages.
- [x] A new `events serve` process using the same event data root can include a
      prior accepted Discord message in `event.input.history` without requiring
      REST history.
- [x] Persisted history writes are compact, atomic, per-conversation serialized,
      and trimmed by `maxMessages`, `maxBytes`, `maxAgeMs`, `scope`, and
      `includeBotMessages`.
- [x] Absence of `eventDataRoot` or `readOnly: true` keeps current in-memory and
      REST behavior with sanitized diagnostics and no fallback writes elsewhere.
- [x] Persistent files contain no credentials, raw Gateway payloads, workflow
      inbox data, agent transcripts, or unbounded receipts.

## Progress Log

### Session: 2026-05-29 18:10 +0900

**Tasks Completed**: TASK-007, TASK-008, TASK-009, TASK-010, TASK-011
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Implemented adapter-local Discord Gateway history persistence under
`EventSourceStartInput.eventDataRoot` using filesystem-safe source/key paths,
versioned compact JSON files, corrupt-file diagnostics, lazy conversation-key
reload, persisted/REST merge by `messageId`, existing per-history-key
serialization, and temp-file plus rename writes. Added restart/reload,
read-only no-write, corrupt-file, and persisted JSON shape coverage in
`packages/rielflow/src/events/adapters/discord-gateway.test.ts`. Updated
README and example notes for durable bounded restart history, read-only and
missing-root degradation, and the boundary between Discord history, workflow
inbox, agent transcripts, and long-term memory. Verification passed for Biome,
typecheck, targeted Discord Gateway tests, manual emit/config regressions,
chat-sdk/reply-dispatcher regressions, Matrix/chat-reply example regressions,
example event-source validation, workflow validation, and `git diff --check`.

### Session: 2026-05-29 18:25 +0900

**Tasks Completed**: Manual recovery verification after interrupted Step 6
worker
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The `codex-design-and-implement-review-loop` Step 6 worker stalled
after writing the implementation and docs, so the parent workflow was stopped
and the current worktree was reviewed manually. Verification passed for focused
Discord Gateway tests, typecheck, Biome lint, related event/config/add-on tests,
example event-source validation, Discord workflow validation, build, `git diff
--check`, and the full suite via GNU Bash 5, with 1392 tests passing.

### Session: 2026-05-29 17:20 +0900

**Tasks Completed**: Implementation plan revised for
`codex-design-and-implement-review-loop` Step 4 persistence issue-resolution
handoff
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Step 3 accepted the design revision with no high or mid findings.
The previous completed Discord Gateway plan has been reopened as `Ready` for a
focused persistent history addendum. New tasks TASK-007 through TASK-011 cover
the persistent file contract, startup reload and REST merge, atomic append and
trimmed writes, user-facing docs, and verification. No Step 5 rerun feedback is
present in mailbox input for this node.

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
- **Next**: None for this completed persistent Discord Gateway history slice
