# Chat Source Restart History Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-matrix-chat-history.md`; `design-docs/specs/design-chat-sdk-chat-history.md`
**Created**: 2026-05-29
**Last Updated**: 2026-05-29

## Design Reference

Implement restart-safe bounded chat history for Matrix and Chat SDK Slack /
Telegram event sources. This extends the Discord Gateway history posture without
moving Matrix, Slack, or Telegram provider semantics into chat-gateway or the
workflow runtime.

Scope boundaries:

- Matrix key derivation and message projection stay in the Matrix adapter.
- Slack and Telegram key derivation and message projection stay in the Chat SDK
  adapter boundary.
- Persisted files contain compact normalized chat history only, not raw
  provider payloads, credentials, workflow inboxes, or agent transcripts.
- History is attached to `event.input.history` and `event.input.historySource`
  before the current event is dispatched, then the accepted current event is
  appended after dispatch.

## Modules

### 1. Generic Compact History Persistence

#### `packages/rielflow/src/events/adapters/chat-history-persistence.ts`

**Status**: COMPLETED

```typescript
interface GenericChatHistoryItem {
  readonly messageId: string;
  readonly authorId: string;
  readonly text: string;
  readonly conversationId: string;
}

interface ChatHistoryPersistence {
  load(key: string): Promise<readonly GenericChatHistoryItem[]>;
  save(key: string, history: readonly GenericChatHistoryItem[]): Promise<void>;
}
```

**Checklist**:

- [x] Bounded history limits and defaults
- [x] Atomic JSON persistence under event data root
- [x] Sanitized diagnostics for unavailable/read-only/corrupt storage
- [x] In-memory cache with persisted/memory/mixed/empty source modes

### 2. Matrix Adapter Integration

#### `packages/rielflow/src/events/adapters/matrix.ts`

**Status**: COMPLETED

```typescript
interface MatrixHistoryConfig {
  readonly scope?: "room" | "thread-or-room";
  readonly includeOwnMessages?: boolean;
}
```

**Checklist**:

- [x] Matrix source config type and validation
- [x] Room/thread history key derivation
- [x] History attachment before dispatch
- [x] Accepted-message append after dispatch
- [x] Restart reload test coverage

### 3. Chat SDK Slack/Telegram Integration

#### `packages/rielflow/src/events/adapters/chat-sdk/`

**Status**: COMPLETED

```typescript
interface ChatSdkHistoryConfig {
  readonly scope?: "conversation" | "thread-or-conversation";
  readonly includeBotMessages?: boolean;
}
```

**Checklist**:

- [x] Slack and Telegram history config type and validation
- [x] Provider/conversation/thread key derivation
- [x] HTTP listener passes event data root into webhook normalization
- [x] Accepted-message append after successful dispatch
- [x] Restart reload tests for Slack and Telegram

### 4. Examples and Documentation

#### `examples/event-sources/`, `README.md`

**Status**: COMPLETED

**Checklist**:

- [x] Matrix and Slack source fixtures include bounded history config
- [x] Telegram Chat SDK source, destination, binding, and payload fixtures
- [x] Bindings expose `history` and `historySource`
- [x] User-facing docs explain restart-safe bounded history behavior

## Module Status

| Module              | File Path                                                           | Status    | Tests                                          |
| ------------------- | ------------------------------------------------------------------- | --------- | ---------------------------------------------- |
| Generic persistence | `packages/rielflow/src/events/adapters/chat-history-persistence.ts` | COMPLETED | Adapter tests                                  |
| Matrix adapter      | `packages/rielflow/src/events/adapters/matrix.ts`                   | COMPLETED | `matrix.test.ts`                               |
| Chat SDK adapter    | `packages/rielflow/src/events/adapters/chat-sdk/`                   | COMPLETED | `chat-sdk.test.ts`, `listener-service.test.ts` |
| Config validation   | `packages/rielflow/src/events/validate-source-*.ts`                 | COMPLETED | `config.test.ts`                               |
| Examples/docs       | `examples/event-sources/`, `README.md`                              | COMPLETED | Event config validation                        |

## Dependencies

| Feature                        | Depends On                                    | Status    |
| ------------------------------ | --------------------------------------------- | --------- |
| Matrix restart history         | Generic persistence                           | COMPLETED |
| Slack/Telegram restart history | Generic persistence and HTTP listener context | COMPLETED |
| Example bindings               | Adapter event input contract                  | COMPLETED |

## Completion Criteria

- [x] Matrix can reload prior accepted room/thread history after source restart.
- [x] Slack and Telegram Chat SDK sources can reload prior accepted
      conversation/thread history after adapter restart.
- [x] `event.input.history` excludes the current message.
- [x] Persisted history files exclude raw payloads, tokens, workflow inboxes, and
      agent transcripts.
- [x] Typecheck, focused event tests, lint, build, secret scan, commit, and push
      are completed.

## Progress Log

### Session: 2026-05-29

**Tasks Completed**: Rielflow design workflow generated Matrix and Chat SDK
history design documents. The workflow was stopped after the design/review loop
stalled, then implementation continued manually from those generated designs.

**Notes**: Added compact shared persistence mechanics, Matrix start-time
history handling, Chat SDK HTTP normalization/accepted-record hooks, source
validation, example fixtures, and regression tests for restart reload behavior.

### Session: 2026-05-29 Matrix attachment follow-up

**Tasks Completed**: Confirmed Matrix attachments were not read: the adapter
accepted only text-like `msgtype` values and rejected `m.image`/attachment
messages. Added `design-docs/specs/design-matrix-attachment-text.md`, Matrix
source attachment config, bounded Matrix media download for text-compatible
attachments, event payload fields `attachmentText` and `attachments`, example
config, and focused tests.

**Notes**: Attachment extraction is opt-in through
`source.attachments.downloadText`, bounded by `maxBytes`, and limited to text
MIME types or conservative text-like extensions. Binary OCR, audio/video
transcription, encrypted attachment decrypt, and manual emit media downloads
remain out of scope.
