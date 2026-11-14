# Matrix Restart-Safe Chat History

This document defines bounded, restart-safe Matrix chat history for the
rielflow Matrix event source.

## Overview

The Matrix source already normalizes Matrix `m.room.message` timeline events to
rielflow `chat.message` envelopes. This feature extends that adapter-owned
normalization path so recent Matrix room or thread context survives
`rielflow events serve` restarts.

Design status for the workflow `codex-design-and-implement-review-loop`:

- `workflowMode`: `issue-resolution`
- feature id: `matrix-chat-history`
- issue reference: workflow input, "Persist Matrix and Chat SDK chat history
  across event server restarts"
- target feature area: `events/matrix-chat-sdk-history`
- codex-agent references: none supplied by the branch input
- primary implementation boundary:
  `packages/rielflow/src/events/adapters/matrix.ts`, Matrix source
  validation, Matrix adapter tests, Matrix examples, and event input mapping

## Goals

- Add bounded normalized history to Matrix `chat.message` events as
  `event.input.history`.
- Add `event.input.historySource` metadata so workflows can tell whether
  history came from memory, persisted storage, sync timeline bootstrap, or a
  mixed source.
- Persist compact per-source, per-room, per-thread history under the event data
  root so restarts reload prior accepted Matrix messages.
- Reload persisted history on Matrix source start and on event normalization
  paths that process a raw Matrix event without a long-running source handle.
- Append only accepted Matrix `m.room.message` events after building the
  current normalized event, so the current message remains in
  `event.input.text` and does not duplicate in `event.input.history`.
- Keep Matrix history implementation inside the Matrix adapter boundary.
- Avoid raw Matrix payloads, access tokens, authorization headers, workflow
  inbox contents, and agent transcripts in persisted history.

## Non-Goals

- Moving Matrix history into the Chat SDK adapter or shared chat-gateway code.
- Implementing Slack or Telegram history; those belong to the Chat SDK
  adapter/provider-normalization feature branch.
- Persisting unbounded Matrix room archives or long-term persona memory.
- Treating workflow session continuation, node inboxes, or agent transcripts as
  external chat history.
- Adding Matrix-specific history fields to `workflow.json` or workflow runtime
  contracts outside `runtimeVariables.event.input`.
- Fetching historical Matrix messages from arbitrary homeserver history APIs in
  the first slice. The first slice can use local persisted history and the
  received `/sync` timeline.

## Source Configuration

Matrix source config may add a bounded `history` block:

```json
{
  "id": "team-matrix",
  "kind": "matrix",
  "provider": "matrix",
  "homeserverUrlEnv": "RIEL_MATRIX_HOMESERVER_URL",
  "accessTokenEnv": "RIEL_MATRIX_ACCESS_TOKEN",
  "userId": "@rielflow-bot:example.org",
  "rooms": [{ "roomId": "!release-room:example.org" }],
  "sync": {
    "pollTimeoutMs": 30000,
    "sinceTokenPath": "matrix/team-matrix/since.json"
  },
  "history": {
    "maxMessages": 20,
    "maxBytes": 32768,
    "maxAgeMs": 86400000,
    "scope": "thread-or-room",
    "includeOwnMessages": false
  },
  "ignoreOwnMessages": true
}
```

Rules:

- `history.maxMessages` defaults to a small bounded value and must have a hard
  validation maximum.
- `history.maxBytes` limits the serialized normalized history attached to
  workflow input.
- `history.maxAgeMs` removes old messages by Matrix `origin_server_ts` when
  present.
- `history.scope: "thread-or-room"` uses the Matrix thread root event id when
  present; otherwise it uses the room id root history.
- `history.includeOwnMessages` defaults to false and must not override the
  existing inbound `ignoreOwnMessages` loop-prevention default.
- Existing Matrix credential fields remain environment-variable names only.

## Normalized Event Contract

The Matrix adapter continues to emit `ExternalEventEnvelope` with:

- `sourceId`: Matrix source config id.
- `eventId`: Matrix `event_id`.
- `provider`: Matrix provider id, defaulting to `"matrix"`.
- `eventType`: `"chat.message"`.
- `dedupeKey`: source id plus Matrix room id plus Matrix event id.
- `actor`: Matrix sender id and display name.
- `conversation.id`: Matrix room id.
- `conversation.threadId`: Matrix thread root event id or reply target event id
  when available.
- `input.text`: current message `content.body`.
- `input.html`: trusted `content.formatted_body` only when `format` is
  `org.matrix.custom.html`.
- `input.history`: bounded recent Matrix history in chronological order,
  excluding the current message.
- `input.historySource`: source mode and effective bounds.
- `input.replyTarget`: provider-neutral reply target metadata for Matrix reply
  dispatch.
- `rawRef`: redacted artifact reference for the Matrix event when present.

History item shape:

```json
{
  "eventId": "$event-1",
  "sender": "@alice:example.org",
  "displayName": "@alice:example.org",
  "createdAt": "2026-05-29T10:00:00.000Z",
  "text": "Can you review the release plan?",
  "roomId": "!release-room:example.org",
  "threadId": "$thread-root",
  "msgtype": "m.text"
}
```

`historySource` shape:

```json
{
  "mode": "persisted",
  "historyKey": "team-matrix:!release-room:example.org:$thread-root",
  "maxMessages": 20,
  "maxBytes": 32768,
  "maxAgeMs": 86400000,
  "messageCount": 12
}
```

Allowed `mode` values are `memory`, `persisted`, `sync`, `mixed`, and
`unavailable`.

## Persistent History Model

The Matrix adapter maintains a bounded in-memory cache backed by compact JSON
files under `EventSourceStartInput.eventDataRoot`:

```text
<eventDataRoot>/matrix/history/<sourceId>/<encoded-history-key>.json
```

The effective history key is:

```text
sourceId:roomId:threadId-or-root
```

Rules:

- The persisted file contains source id, history key, bounds metadata, and
  normalized Matrix history items only.
- It must not contain Matrix access tokens, authorization headers, full raw
  `/sync` payloads, homeserver response bodies, workflow inbox contents, agent
  transcripts, or event receipts.
- Startup loads persisted history before processing `/sync` timeline events.
- Raw event normalization paths, including manual emit and replay-style
  normalization that do not call `start`, must lazily load the same persisted
  history before constructing `event.input.history` when an event data root is
  available.
- `/sync` timeline bootstrap and persisted history merge by Matrix `eventId`,
  sort chronologically when timestamps are available, and trim by
  `maxMessages`, `maxBytes`, `maxAgeMs`, and `includeOwnMessages`.
- Writes use atomic temp-file plus rename semantics under the event data root.
- If `eventDataRoot` is unavailable or read-only, the adapter keeps bounded
  in-memory behavior, sets `historySource.mode` to `memory` or `unavailable`,
  and emits a sanitized diagnostic rather than writing elsewhere.

On accepted inbound Matrix messages, the adapter:

1. resolves room and thread history key from Matrix room id and relation
   metadata
2. reads cached history that was seeded from persisted storage and current
   `/sync` timeline context
3. trims and attaches bounded history to the normalized event
4. dispatches the normalized event through existing bindings
5. appends the current accepted message to the cache after event construction
6. persists the trimmed compact cache when the event data root is writable

This ordering keeps prompt context restart-safe while preventing the current
message from appearing twice.

## Adapter Boundaries

Matrix history belongs in the Matrix source adapter:

- `packages/rielflow/src/events/adapters/matrix.ts` owns Matrix event
  normalization, history key derivation, cache lifecycle, and Matrix-specific
  item projection.
- `packages/rielflow/src/events/validate-source-matrix.ts` validates Matrix
  history bounds and rejects unsafe values.
- `packages/rielflow/src/events/adapters/matrix.test.ts` proves restart reload,
  bounded trimming, current-message exclusion, and secret redaction.
- Shared helper extraction is allowed only for generic bounded history file
  persistence mechanics that do not encode provider semantics.

Slack and Telegram history are intentionally not implemented here. They remain
inside `packages/rielflow/src/events/adapters/chat-sdk/normalization.ts` or a
provider-local Chat SDK history module because their conversation ids, threads,
and webhook payload semantics differ from Matrix.

## Workflow Input Mapping

Bindings using `inputMapping.mode: "event-input"` automatically expose:

- `workflowInput.history` when the event input is mirrored directly
- `runtimeVariables.event.input.history`
- `runtimeVariables.event.input.historySource`

Template mappings may explicitly reference:

```json
{
  "request": "{{event.input.text}}",
  "history": "{{event.input.history}}",
  "historySource": "{{event.input.historySource}}"
}
```

No workflow changes are required for existing Matrix chat reply examples unless
the sample wants to display or assert history.

## Verification Requirements

Implementation verification should include:

- `bun test packages/rielflow/src/events/adapters/matrix.test.ts`
- `bun test packages/rielflow/src/events/config.test.ts packages/rielflow/src/events/input-mapping.test.ts`
- `bun test packages/rielflow/src/events/matrix-chat-reply-example.test.ts`
- `bun run src/main.ts workflow validate matrix-chat-reply --workflow-definition-dir ./examples`
- `bun run typecheck`
- `bun run lint`
- `bun run build`

Tests must cover:

- restart-safe reload from the same `eventDataRoot`
- persisted reload during raw Matrix event normalization when a source start
  lifecycle is not present
- separate histories for different Matrix rooms and thread roots
- current accepted message excluded from `event.input.history` and included in
  the next same-conversation event
- bounded trimming by message count, byte count, and age
- no persisted or logged Matrix access token, authorization header, raw provider
  body, workflow inbox, or agent transcript

## Risks

- Matrix `/sync` timelines may deliver historical events on startup; merge and
  dedupe by `eventId` are required so persisted history does not duplicate.
- Matrix relation metadata is inconsistent across homeservers and clients; the
  first slice should use existing thread/reply extraction and keep room-level
  fallback stable.
- Atomic history writes add filesystem work to event processing; keep files
  compact and bounded.
- If event data roots are shared across multiple server processes, last-writer
  wins can lose recent history. Multi-process coordination is out of scope for
  this slice.
