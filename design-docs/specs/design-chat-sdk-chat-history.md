# Chat SDK Slack/Telegram Chat History

This document defines restart-safe bounded chat history for Chat SDK Slack and
Telegram event sources.

## Overview

The feature extends the bounded normalized history model used by Discord
Gateway to the existing Chat SDK generic webhook boundary for Slack and
Telegram. The implementation remains inside the Chat SDK adapter and
provider-normalization path under `packages/rielflow/src/events/adapters/chat-sdk/`.
It does not move Slack or Telegram logic into Discord Gateway, Matrix, workflow
session history, or the provider-neutral chat reply worker.

Design status for the workflow `codex-design-and-implement-review-loop`:

- `workflowMode`: `issue-resolution`
- issue reference: workflow input title `Persist Matrix and Chat SDK chat history across event server restarts`
- feature id: `chat-sdk-slack-telegram-history`
- primary design path: `design-docs/specs/design-chat-sdk-chat-history.md`
- implementation plan path: `impl-plans/chat-source-restart-history.md`
- codex-agent references: none attached to the feature contract

## Goals

- Add bounded normalized history for `kind: "chat-sdk"` sources when
  `provider` is `slack` or `telegram`.
- Persist compact history below `EventSourceStartInput.eventDataRoot` during
  `rielflow events serve`.
- Reload prior accepted messages after an event server restart using the same
  event data root.
- Append only accepted `chat.message` events after successful normalization.
- Expose `event.input.history` and `event.input.historySource` to workflow
  input mappings.
- Keep Slack and Telegram provider details inside Chat SDK normalization and
  adapter-local persistence helpers.
- Avoid raw provider payloads, tokens, authorization headers, workflow inbox
  data, and agent transcripts in persisted history files.

## Non-Goals

- Adding restart-safe history for all Chat SDK providers in this feature slice.
- Replacing Matrix-specific history or Discord Gateway history implementations.
- Introducing direct `@chat-adapter/*` runtime dependencies.
- Storing unbounded long-term memory or workflow execution transcripts.
- Changing `rielflow/chat-reply-worker` or provider-neutral reply dispatch
  request shapes.
- Making generic manual `events emit` responsible for durable history writes.

## Source Configuration

The Chat SDK source keeps its existing generic webhook shape. History is an
optional source-level object for Slack and Telegram:

```json
{
  "id": "team-slack",
  "kind": "chat-sdk",
  "provider": "slack",
  "mode": "generic-webhook",
  "webhook": {
    "path": "chat-sdk/team-slack",
    "signingSecretEnv": "RIEL_CHAT_SDK_SLACK_WEBHOOK_SECRET"
  },
  "send": {
    "endpointUrlEnv": "RIEL_CHAT_SDK_SLACK_SEND_URL",
    "tokenEnv": "RIEL_CHAT_SDK_SLACK_SEND_TOKEN"
  },
  "history": {
    "maxMessages": 20,
    "maxBytes": 32768,
    "maxAgeMs": 86400000,
    "scope": "thread-or-conversation",
    "includeBotMessages": false
  }
}
```

Rules:

- `history` is initially valid only for `provider: "slack"` and
  `provider: "telegram"`.
- `history.maxMessages`, `history.maxBytes`, and `history.maxAgeMs` use the
  same small bounded defaults and hard maximum posture as Discord Gateway
  history.
- `history.scope: "thread-or-conversation"` uses the provider thread id when
  supplied and otherwise uses the conversation id.
- `history.scope: "conversation"` ignores thread id and stores one bounded
  stream per source conversation.
- `history.includeBotMessages` defaults to false.
- Credential values remain environment-variable names only.

## Normalized Event Contract

Slack and Telegram Chat SDK messages continue to normalize to
`ExternalEventEnvelope` with `eventType: "chat.message"`. The adapter adds:

- `input.history`: bounded prior messages in chronological order, excluding the
  current message.
- `input.historySource`: metadata with source mode, bounds, count, and effective
  provider/conversation key.

History item shape:

```json
{
  "messageId": "evt-123",
  "provider": "slack",
  "authorId": "U123",
  "displayName": "Operator",
  "isBot": false,
  "createdAt": "2026-05-29T10:00:00.000Z",
  "text": "review this branch",
  "conversationId": "C123",
  "threadId": "1720000000.000100"
}
```

`messageId` uses the normalized event id. `createdAt` prefers `occurredAt` and
falls back to `receivedAt`. Attachments may be summarized only as safe
normalized metadata if already present in `input.attachments`; raw provider
payloads are never copied into history.

`input.historySource.mode` is one of:

- `persisted`: loaded from the compact event data root file.
- `memory`: current process cache only.
- `mixed`: persisted plus current process additions.
- `empty`: no prior normalized messages.

## Persistent History Model

The effective history key is:

```text
sourceId:provider:conversationId:threadId-or-root
```

The adapter-owned file layout stays under the event data root:

```text
<eventDataRoot>/chat-sdk/history/<sourceId>/<encoded-history-key>.json
```

Persisted files contain only:

- schema version
- source id
- provider
- history key
- conversation id and optional thread id
- bounds metadata
- bounded normalized history items

The file must not contain webhook secrets, bearer tokens, send tokens,
authorization headers, raw Chat SDK request bodies, workflow inbox data,
workflow outputs, agent transcripts, or unbounded receipts.

Writes use the same safety posture as Discord Gateway history: serialize writes
per conversation key, write an atomic temp file, then rename. Corrupt or
schema-mismatched files are ignored with sanitized diagnostics and do not block
event serving.

## Processing Order

For a Slack or Telegram inbound webhook during `events serve`, the adapter:

1. verifies the configured Chat SDK webhook authentication before normalization
2. normalizes the inbound payload to `chat.message`
3. derives the effective history key from source id, provider, conversation id,
   and optional thread id
4. loads persisted history on first use for that key when a writable data root is
   available
5. trims loaded history by max messages, bytes, age, provider, conversation, and
   bot policy
6. builds `input.history` and `input.historySource` before appending the current
   message
7. dispatches the normalized event through the existing trigger runner
8. appends the accepted current message to the in-memory cache and persisted
   compact file after acceptance

This order keeps the current message available as `input.text` while preventing
the current message from appearing twice in prompt context. A later message in
the same Slack thread, Telegram chat, or configured conversation scope can see
the accepted prior message after restart.

If `eventDataRoot` is absent or `readOnly` is true, the adapter keeps bounded
in-memory history for the current process and emits a sanitized diagnostic
instead of writing elsewhere.

## Provider Boundaries

Slack and Telegram share the Chat SDK persistence helper, but provider-specific
normalization remains table-driven:

- Slack uses `conversation.id` as channel or DM id and `conversation.threadId`
  as Slack thread timestamp when supplied.
- Telegram uses `conversation.id` as chat id and `conversation.threadId` only
  when the generic boundary provides a stable topic or reply-thread id.
- Provider-specific raw fields stay inside `providerConfig` or the redacted raw
  artifact path and are not exposed as history keys.

Discord Gateway history remains in
`packages/rielflow/src/events/adapters/discord-gateway-history-persistence.ts`.
Matrix restart-safe history is a separate Matrix adapter concern. Chat SDK
history must not introduce a shared `chat-gateway` dependency.

## Examples and Tests

Expected implementation updates:

- `packages/rielflow-events/src/types.ts`
- `packages/rielflow/src/events/validate-source-chat-sdk.ts`
- `packages/rielflow/src/events/adapters/chat-sdk/types.ts`
- `packages/rielflow/src/events/adapters/chat-sdk/normalization.ts`
- `packages/rielflow/src/events/adapters/chat-history-persistence.ts`
- `packages/rielflow/src/events/adapters/chat-sdk/history.ts`
- `packages/rielflow/src/events/adapters/chat-sdk.test.ts`
- `packages/rielflow/src/events/config.test.ts`
- `packages/rielflow/src/events/listener-service.test.ts`
- `examples/event-sources/.rielflow-events/sources/chat-sdk-slack.json`
- `examples/event-sources/.rielflow-events/sources/chat-sdk-telegram.json`
- `examples/event-sources/payloads/chat-sdk-slack-message.json`
- `examples/event-sources/payloads/chat-sdk-telegram-message.json`
- `examples/event-sources/README.md`
- `README.md`

Required verification commands:

```bash
bun test packages/rielflow/src/events/adapters/chat-sdk.test.ts
bun test packages/rielflow/src/events/config.test.ts packages/rielflow/src/events/listener-service.test.ts packages/rielflow/src/events/manual-emit.test.ts
bun run typecheck
bun run packages/rielflow/src/bin.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
```

The focused tests must cover:

- Slack persisted history reload across source restarts.
- Telegram persisted history reload across source restarts.
- current message exclusion from `input.history`.
- bounded trimming by message count, byte size, and age.
- read-only or missing data root diagnostics without writes.
- rejection of `history` config on unsupported Chat SDK providers.
- persisted JSON excluding secrets, raw payloads, and agent/workflow transcript
  fields.

## Decisions

- Keep `workflowMode` as `issue-resolution` because the workflow requires
  design, plan, implementation, verification, review, commit, and push.
- Scope this feature id to Slack and Telegram only:
  `chat-sdk-slack-telegram-history`.
- Keep the implementation in the Chat SDK adapter/provider-normalization path.
- Use event data root persistence, not workflow session history or mailbox
  artifacts.
- Mirror Discord Gateway's bounded compact history behavior without sharing
  Discord-specific types or file paths.
- Expose history through normalized `event.input.history` and
  `event.input.historySource`, preserving provider-neutral workflow inputs.

## Open Questions

- Should Chat SDK `web` provider history be enabled in a later feature using the
  same helper after Slack and Telegram are verified?
- Should Slack bot-message filtering rely only on the generic boundary
  `actor.isBot` field, or should the boundary be required to supply explicit bot
  identity metadata for Slack events?

## References

Related design documents:

- `design-docs/specs/design-chat-sdk-event-sources.md`
- `design-docs/specs/design-discord-gateway-chat-history.md`
- `design-docs/specs/design-event-listener-workflow-trigger.md`

See `design-docs/references/README.md` for external Chat SDK references.
