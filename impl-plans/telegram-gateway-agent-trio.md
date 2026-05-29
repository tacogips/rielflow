# Telegram Gateway Agent Trio Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-telegram-gateway-agent-trio.md
**Created**: 2026-05-29
**Last Updated**: 2026-05-29

## Design Document Reference

Implement native Telegram Gateway chat support outside the Chat SDK boundary,
plus an example workflow matching the Discord three-person persona chat.

Out of scope: OCR, binary image download, inline Telegram UI components,
commands, reactions, edits, and webhook receiver mode.

## Modules

### 1. Event Source Types

#### packages/rielflow-events/src/types.ts

**Status**: Completed

```typescript
interface TelegramGatewaySourceConfig extends EventSourceConfigBase {
  readonly kind: "telegram-gateway";
  readonly tokenEnv: string;
  readonly botIdEnv?: string;
  readonly chats?: readonly TelegramGatewayChatConfig[];
  readonly history?: TelegramGatewayHistoryConfig;
  readonly attachments?: TelegramGatewayAttachmentsConfig;
}
```

**Checklist**:
- [x] Source config type added
- [x] Polling, history, filters, attachments, and reply bot config added
- [x] Union type updated

### 2. Native Telegram Adapter

#### packages/rielflow/src/events/adapters/telegram-gateway.ts

**Status**: Completed

```typescript
interface TelegramPhotoAttachment extends JsonObject {
  readonly kind: "image";
  readonly fileId: string;
  readonly width: number;
  readonly height: number;
}
```

**Checklist**:
- [x] `getUpdates` polling implemented
- [x] `sendMessage` reply dispatch implemented
- [x] Bounded persisted history implemented
- [x] Photo attachment descriptors implemented
- [x] Adapter registered in the default registry

### 3. Validation

#### packages/rielflow/src/events/validate-source-telegram-gateway.ts

**Status**: Completed

**Checklist**:
- [x] Telegram source validation added
- [x] Chat destination validation accepts Telegram Gateway reply sources
- [x] Malformed source tests added

### 4. Example Workflow

#### examples/telegram-agent-trio-chat/

**Status**: Completed

**Checklist**:
- [x] Yui Codex, Mika Trend, and Rina Cursor workflow added
- [x] Persona prompts preserve Discord trio character specs
- [x] Telegram attachment prompt context added
- [x] Persona icons stored under the workflow assets directory
- [x] Event source, destination, binding, and payload fixtures added

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Types | `packages/rielflow-events/src/types.ts` | Completed | Typecheck |
| Adapter | `packages/rielflow/src/events/adapters/telegram-gateway.ts` | Completed | `telegram-gateway.test.ts` |
| Validation | `packages/rielflow/src/events/validate-source-telegram-gateway.ts` | Completed | `config.test.ts` |
| Examples | `examples/telegram-agent-trio-chat/` | Completed | workflow/event validation |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Adapter registration | Telegram adapter | Completed |
| Example event binding | Adapter validation | Completed |
| Live verification | Telegram bot credentials and chat membership | Pending operator credentials |

## Completion Criteria

- [x] Type checking passes
- [x] Focused adapter and config tests pass
- [x] Example workflow validates
- [x] Event source configuration validates
- [x] Deterministic image attachment fixture normalizes successfully
- [ ] Live Telegram Web verification completed with real bot credentials

## Progress Log

### Session: 2026-05-29

**Tasks Completed**: Designed and implemented `telegram-gateway`, added tests,
fixtures, docs, and the Telegram persona workflow.

**Notes**: The repository-owned rielflow implementation workflow was invoked
first but produced no output after repeated polls, so implementation continued
directly in this branch while preserving the design-plan-test-document flow.
