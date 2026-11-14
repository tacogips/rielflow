# Event Reply Dispatcher Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#event-layer-responsibilities`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

## Design Summary

Add the provider-neutral outbound reply boundary used by
`rielflow/chat-reply-worker`. The first implementation routes chat reply requests
to event source adapters and adds webhook/web-chat style HTTP reply delivery via
a source-configured environment variable.

Initial scope:

- Provider-neutral `ChatReplyDispatcher` contract.
- Event-layer dispatcher with idempotent in-process result reuse.
- Webhook adapter outbound reply support using `replyEndpointEnv`.
- Workflow run option plumbing so add-on execution can use the dispatcher.
- No provider SDK integration.

## Modules

### 1. Shared Reply Types

#### `src/workflow/types.ts`

**Status**: Completed

```typescript
interface ChatReplyDispatcher {
  dispatchChatReply(
    request: ChatReplyDispatchRequest,
  ): Promise<ChatReplyDispatchResult>;
}
```

**Checklist**:

- [x] Define reply target/request/result types
- [x] Add optional dispatcher to workflow run options

### 2. Event Reply Dispatcher

#### `src/events/reply-dispatcher.ts`

**Status**: Completed

```typescript
function createEventReplyDispatcher(
  options: EventReplyDispatcherOptions,
): ChatReplyDispatcher;
```

**Checklist**:

- [x] Route by `target.sourceId`
- [x] Enforce source adapter outbound support
- [x] Reuse results by idempotency key
- [x] Unit tests

### 3. Adapter Support

#### `src/events/source-adapter.ts`, `src/events/adapters/webhook.ts`

**Status**: Completed

**Checklist**:

- [x] Add optional `dispatchChatReply` adapter method
- [x] Add `replyEndpointEnv` to webhook source config
- [x] POST reply requests to configured endpoint
- [x] Unit tests

### 4. Runtime Plumbing

#### `src/workflow/native-node-executor.ts`, `src/workflow/engine.ts`, `src/lib.ts`

**Status**: Completed

**Checklist**:

- [x] Pass optional dispatcher into native add-on execution
- [x] Use dispatcher result for `sent` / `queued` output
- [x] Preserve intent-only fallback when dispatcher is absent
- [x] Typecheck and targeted tests pass

## Module Status

| Module             | File Path                                                        | Status    | Tests                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared reply types | `src/workflow/types.ts`                                          | Completed | `bunx tsc --noEmit`                                                                                                                                                      |
| Dispatcher         | `src/events/reply-dispatcher.ts`                                 | Completed | `src/events/reply-dispatcher.test.ts`                                                                                                                                    |
| Adapter support    | `src/events/source-adapter.ts`, `src/events/adapters/webhook.ts` | Completed | `src/events/adapters/webhook.test.ts`, `src/events/config.test.ts`                                                                                                       |
| Runtime plumbing   | `src/workflow/*.ts`, `src/lib.ts`                                | Completed | `src/workflow/native-node-executor.test.ts`, `src/workflow/engine.test.ts`, `src/workflow/call-node.test.ts`, `src/graphql/schema.test.ts`, `src/server/graphql.test.ts` |

## Dependencies

| Feature          | Depends On        | Status |
| ---------------- | ----------------- | ------ |
| Dispatcher       | Chat reply add-on | Ready  |
| Adapter support  | Dispatcher types  | Ready  |
| Runtime plumbing | Dispatcher        | Ready  |

## Completion Criteria

- [x] Chat reply add-on can call a dispatcher when provided
- [x] Webhook source can send reply requests to an env-configured endpoint
- [x] Dispatcher is idempotent within one runtime process
- [x] Targeted tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-04-20

**Tasks Completed**: Shared reply types, event reply dispatcher, webhook adapter support, workflow/runtime plumbing, focused tests
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Implemented provider-neutral reply dispatch, in-process idempotency reuse, webhook outbound POST delivery via `replyEndpointEnv`, and event-trigger wiring so add-on workflows can send replies when launched from event sources.
