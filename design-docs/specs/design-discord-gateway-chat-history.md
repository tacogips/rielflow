# Discord Gateway Chat History

This document defines rielflow-native Discord Gateway chat ingestion with
bounded recent conversation history and provider-neutral chat replies.

## Overview

Discord Gateway support is a first-class event source owned by rielflow. It is
not an external `chat-gateway` requirement and does not replace the existing
`kind: "chat-sdk"` Discord generic webhook source. The new source listens to
configured Discord channels and threads, ignores bot and self messages by
default, normalizes the current message plus bounded recent history, and starts
persona workflows through the existing event binding and trigger-runner path.

The core workflow engine remains provider-neutral. Discord-specific Gateway,
REST, history, reconnect, rate-limit, and token handling stay inside
`packages/rielflow/src/events/adapters/discord-gateway/` and validation modules.
Workflows receive only normalized `runtimeVariables.event` and mapped
`workflowInput` data.

Design status for the workflow `codex-design-and-implement-review-loop`:

- `workflowMode`: `issue-resolution`
- issue reference: workflow input only; no GitHub issue URL, repository, or
  issue number was provided
- target feature area: event sources and chat reply built-ins
- primary implementation boundary: rielflow event source adapter, validation,
  reply dispatch, examples, tests, and user-facing docs

## Goals

- Add `kind: "discord-gateway"` event source configuration and validation.
- Listen to configured Discord channel and thread messages through a Discord
  Gateway runner.
- Ignore messages from bots and from the configured application or bot user by
  default.
- Normalize each accepted `MESSAGE_CREATE` into `chat.message` with current
  message text, author, channel, thread, and reply target metadata.
- Attach bounded recent channel or thread history to the normalized event so
  persona workers can answer with context.
- Support reply dispatch through the existing `rielflow/chat-reply-worker`,
  output destinations, idempotency, and reply dispatch records.
- Preserve backward compatibility for existing `chat-sdk` sources and examples.
- Add an example workflow or binding for history-aware persona replies by Yui,
  Mika, or Rina.

## Non-Goals

- Implementing Discord support in an external chat-gateway service.
- Replacing the existing `chat-sdk-discord` generic webhook example.
- Storing unbounded Discord history or creating long-term persona memory.
- Adding Discord-specific fields to `workflow.json`.
- Supporting every Discord interaction type, component, slash command, or
  moderation event in the first slice.
- Implementing multi-shard, multi-process Gateway coordination beyond a
  single bounded runner process.

## Source Configuration

Source files live under `<eventRoot>/sources/*.json`:

```json
{
  "id": "discord-gateway-personas",
  "kind": "discord-gateway",
  "tokenEnv": "RIEL_DISCORD_BOT_TOKEN",
  "applicationIdEnv": "RIEL_DISCORD_APPLICATION_ID",
  "guildIds": ["123456789012345678"],
  "channels": [
    {
      "id": "234567890123456789",
      "includeThreads": true,
      "personas": ["yui", "mika", "rina"]
    }
  ],
  "history": {
    "maxMessages": 20,
    "maxBytes": 32768,
    "maxAgeMs": 86400000,
    "scope": "thread-or-channel",
    "includeBotMessages": false,
    "fetchOnStart": true,
    "fetchOnMessage": "when-cache-empty"
  },
  "filters": {
    "ignoreBots": true,
    "ignoreSelf": true,
    "requireMention": false
  }
}
```

Rules:

- Credential fields are environment-variable names only; token values must not
  appear in source JSON, receipts, logs, or dispatch records.
- `channels[].id` is required and must be a Discord snowflake string.
- `channels[].includeThreads` defaults to true for text channels.
- `history.maxMessages` defaults to a small bounded value and must have a hard
  maximum enforced by validation.
- `history.maxBytes` bounds the total normalized history text and metadata sent
  to a workflow input.
- `history.scope: "thread-or-channel"` means use the Discord thread id when the
  incoming message is in a thread; otherwise use the channel id.
- `history.fetchOnMessage` may be `never`, `when-cache-empty`, or `always`; the
  first implementation should prefer `when-cache-empty` to avoid per-message
  REST calls in ordinary operation.
- `filters.ignoreBots` and `filters.ignoreSelf` default to true.
- `filters.requireMention` defaults to false so configured channels can operate
  as ordinary persona rooms; bindings may still filter mentions or persona
  commands after normalization.
- The config schema must stay separate from `kind: "chat-sdk"` even when both
  sources use provider `"discord"`.

## Normalized Event Contract

The adapter emits `ExternalEventEnvelope` with:

- `sourceId`: source config id.
- `eventId`: Discord message id.
- `provider`: `"discord"`.
- `eventType`: `"chat.message"`.
- `receivedAt`: rielflow receive time.
- `occurredAt`: Discord message timestamp when present.
- `dedupeKey`: source id plus Discord message id.
- `actor`: Discord author id, display name, username, and bot flag.
- `conversation.id`: Discord channel id.
- `conversation.threadId`: Discord thread id when distinct from the parent
  channel.
- `input.text`: current message content.
- `input.history`: bounded recent messages in chronological order, excluding
  the current message unless the implementation explicitly marks it as current.
- `input.historySource`: metadata describing whether history came from memory,
  REST fetch, or a mixed source, plus the effective bounds used.
- `input.provider`: `"discord"`.
- `input.discord`: provider metadata needed for routing and audit, without raw
  token-bearing request data.
- `rawRef`: redacted artifact reference for the Gateway payload.

History item shape:

```json
{
  "messageId": "345678901234567890",
  "authorId": "456789012345678901",
  "displayName": "Mika",
  "isBot": false,
  "createdAt": "2026-05-29T10:00:00.000Z",
  "text": "I think the second option is better.",
  "conversationId": "234567890123456789",
  "threadId": "567890123456789012"
}
```

Normalization must distinguish Discord channel or thread history from:

- workflow-local inbox, which contains only data produced inside one workflow
  execution
- session-local conversation transcript, which belongs to workflow or agent
  session continuation rather than external Discord channel context

## History Model

The adapter maintains a bounded per-source history cache keyed by effective
conversation key:

```text
sourceId:channelId:threadId-or-root
```

On accepted inbound messages, the adapter:

1. resolves the effective history key from the Discord channel and thread
   metadata
2. reads recent cached messages for the key
3. optionally fetches recent messages from Discord REST when the cache is empty,
   stale, or `history.fetchOnStart`/`history.fetchOnMessage` requires it
4. trims by `maxMessages`, `maxBytes`, `maxAgeMs`, and `includeBotMessages`
5. emits the normalized event with `input.history`
6. appends the current accepted message to the cache after emitting

This order prevents the current message from appearing twice in prompts while
still making it available as `input.text`.

Restart behavior is explicitly bounded. The first implementation may use
in-memory cache plus REST fetch when configured; durable cross-restart Discord
history is a later enhancement unless the user chooses persistence in
`design-docs/user-qa/qa-discord-gateway-chat-history.md`.

The cache belongs to the event-source runtime, not the workflow session. It must
not reuse workflow inbox contents or agent transcript continuation as Discord
history. Event receipts may record the applied history bounds and source mode
for audit, but they must not persist unbounded chat bodies.

## Reply Behavior

Discord Gateway replies use the existing chat reply boundary:

- Workflows render reply text through `rielflow/chat-reply-worker`.
- The reply worker creates a provider-neutral `ChatReplyDispatchRequest`.
- The output destination layer resolves the configured `kind: "chat"`
  destination or compatibility inbound source target.
- The Discord Gateway adapter sends the message through Discord REST using the
  configured token environment variable.

Reply target mapping:

- `conversationId` maps to the Discord channel id.
- `threadId` maps to the Discord thread channel id when present.
- `threadPolicy: "same-thread"` replies in the inbound thread when one exists.
- `threadPolicy: "conversation-root"` replies to the parent channel when the
  adapter has enough parent-channel metadata; otherwise validation or dispatch
  must fail explicitly rather than silently choosing a target.

Dispatch records must persist destination id, source id, provider, channel id,
thread id, Discord response message id when available, idempotency key, status,
and redacted request metadata. They must not persist bot tokens or authorization
headers.

## Binding and Persona Routing

Bindings stay provider-neutral. Persona routing belongs in binding input
mapping, workflow input, supervisor profile metadata, or workflow prompts:

```json
{
  "id": "discord-persona-chat-to-workflow",
  "sourceId": "discord-gateway-personas",
  "outputDestinations": ["discord-persona-replies"],
  "workflowName": "discord-persona-chat",
  "match": {
    "eventType": "chat.message"
  },
  "inputMapping": {
    "mode": "template",
    "template": {
      "request": "{{event.input.text}}",
      "history": "{{event.input.history}}",
      "personaCandidates": ["yui", "mika", "rina"],
      "conversationId": "{{event.conversation.id}}",
      "threadId": "{{event.conversation.threadId}}"
    },
    "mirrorToHumanInput": true
  },
  "execution": {
    "async": true,
    "dedupeWindowMs": 86400000,
    "maxConcurrentPerKey": 1,
    "concurrencyKey": "{{event.sourceId}}:{{event.conversation.id}}:{{event.conversation.threadId}}"
  }
}
```

The example should demonstrate a prompt where a user can ask Mika for an opinion
after prior Discord context. Mika must receive bounded history through
`workflowInput.history` or `event.input.history`, not through workflow inbox or
agent transcript continuation.

## Validation Rules

Validation fails when:

- `kind: "discord-gateway"` is missing required token or application identity
  environment-variable references.
- A `discord-gateway` source is configured as a `chat-sdk` source or a
  `chat-sdk` Discord source is silently upgraded to Gateway behavior.
- Any credential field contains a literal token-like value instead of an
  environment-variable name.
- Configured channel, guild, application, or allow/deny ids are not Discord
  snowflake strings.
- `history.maxMessages`, `history.maxAgeMs`, or hard byte limits are zero,
  negative, unbounded, or above repository-defined maxima.
- `history.scope` is unrecognized.
- `filters.ignoreSelf` is false without an explicit loop-prevention decision.
- A chat destination references a Discord Gateway source that has no outbound
  send token configuration.
- A binding attempts to match Discord raw fields instead of normalized envelope
  fields.
- The source attempts to enable rich interactions that this design has not
  added to the adapter capability metadata.

## Rollout Constraints

- Keep the existing `chat-sdk-discord` source, destination, binding, examples,
  and tests passing unchanged.
- Add Discord Gateway as a separate adapter kind and registry entry.
- Keep Discord SDK or raw WebSocket/REST implementation choices inside the
  adapter module and implementation plan.
- Apply repository supply-chain review before adding a Discord SDK dependency.
- Make message content intent requirements explicit in docs because Discord may
  omit content fields without the privileged intent.
- Redact raw payloads and never store credentials in receipts, dispatch records,
  logs, or example fixtures.
- Treat Gateway reconnect/resume as bounded adapter lifecycle behavior; do not
  expand this slice into distributed sharding.
- Keep message history normalization deterministic enough for fixture tests:
  chronological order, current message exclusion, bot/self filtering, and
  history-bound metadata must be observable in the normalized event.

## Examples and Tests

Expected example updates:

- `examples/event-sources/.rielflow-events/sources/discord-gateway-personas.json`
- `examples/event-sources/.rielflow-events/destinations/discord-gateway-persona-replies.json`
- `examples/event-sources/.rielflow-events/bindings/discord-gateway-personas-to-workflow.json`
- `examples/event-sources/payloads/discord-gateway-message-with-history.json`
- `examples/discord-persona-chat/`

Verification commands for the implementation plan:

```bash
bun run typecheck
bun test packages/rielflow/src/events/config.test.ts packages/rielflow/src/events/adapter-registry.test.ts packages/rielflow/src/events/reply-dispatcher.test.ts
bun test packages/rielflow/src/events/adapters/discord-gateway.test.ts packages/rielflow/src/events/adapters/chat-sdk.test.ts
bun test packages/rielflow/src/events/chat-reply-example.test.ts
bun run packages/rielflow/src/bin.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
bun run packages/rielflow/src/bin.ts workflow validate discord-persona-chat --workflow-definition-dir ./examples
```

## Codex Reference Mapping

The active workflow is `codex-design-and-implement-review-loop` in
`issue-resolution` mode, using `codex-agent` workers. Codex-agent is a process
and design-discipline reference only; it does not define Discord provider
behavior.

Relevant repository-local references:

- `examples/event-sources/.rielflow-events/sources/chat-sdk-discord.json`:
  existing generic Chat SDK Discord webhook source that must remain compatible.
- `examples/event-sources/.rielflow-events/bindings/chat-sdk-discord-to-workflow.json`:
  existing Discord binding shape and chat reply destination contract.
- `examples/discord-codex-chat/`: current Discord reply workflow using
  `codex-agent` and `rielflow/chat-reply-worker`.
- `packages/rielflow/src/events/adapters/matrix.ts`: direct chat adapter pattern
  for receive and reply behavior.
- `packages/rielflow/src/events/adapters/chat-sdk/normalization.ts`: provider
  chat normalization reference for envelope shape.

## Review Decisions and Issue Mapping

- The request stays single-path rather than feature-fanout because event source
  config, Gateway listener lifecycle, history normalization, reply targeting,
  examples, docs, and tests all share the same normalized event contract.
- `kind: "discord-gateway"` is a new first-class rielflow event source and does
  not require an external chat-gateway Discord implementation.
- Existing `kind: "chat-sdk"` Discord webhook support remains compatible and is
  not removed, renamed, or reinterpreted.
- Bounded Discord channel/thread history is external event context. It must be
  supplied through `event.input.history` and mapped workflow input, not through
  workflow inbox or agent transcript history.
- Persona behavior for Yui, Mika, and Rina belongs in example workflow prompts,
  binding input mapping, or supervisor composition; Discord adapter code only
  normalizes messages and replies.
- Bot-aware replies use the existing provider-neutral chat reply worker and
  output destination layer. Discord REST send details remain adapter-owned.

## Cursor CLI Behavior Mapping

No Cursor CLI behavior is involved. If a future Cursor-agent workflow consumes
Discord events, Cursor-specific transcript or session behavior must remain
behind agent adapter modules and must not alter Discord event normalization or
reply dispatch contracts.

## Intentional Divergences

- Diverges from Chat SDK Discord by using rielflow-owned Discord Gateway and
  REST behavior instead of a generic external webhook/send deployment.
- Diverges from workflow inbox history because Discord channel/thread history
  is external event context, not upstream output inside one workflow run.
- Diverges from session-local conversation transcript because persona context
  must reflect bounded Discord channel or thread messages, not agent transcript
  continuation.
- Diverges from Codex-agent references by keeping provider-specific chat
  behavior in rielflow event adapters rather than in agent sessions.

## Open Questions

Tracked in `design-docs/user-qa/qa-discord-gateway-chat-history.md`.

## Risks

- Discord Gateway reconnect, resume, rate limits, and intent requirements can
  expand scope if the first slice is not bounded.
- Message content may be unavailable without the Discord privileged message
  content intent, producing empty persona context.
- Bot/self filtering mistakes can create reply loops.
- Thread target ambiguity can send replies to the wrong channel if parent and
  thread ids are not explicit.
- History can leak excessive context unless count, age, byte, and redaction
  limits are enforced.
- A new Discord dependency may require lockfile, license, and supply-chain
  review before implementation.

## References

- `design-docs/specs/design-event-listener-workflow-trigger.md`
- `design-docs/specs/design-output-destinations-and-supervisor-memory.md`
- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`
- `design-docs/specs/design-chat-sdk-event-sources.md`
- `design-docs/references/README.md`
- Discord Gateway Events: `https://docs.discord.com/developers/events/gateway-events`
- Discord Gateway: `https://docs.discord.com/developers/topics/gateway`
- Discord Message Resource: `https://docs.discord.com/developers/resources/message`
- Discord Threads: `https://docs.discord.com/developers/topics/threads`
