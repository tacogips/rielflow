# Chat SDK Event Sources Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-chat-sdk-event-sources.md#overview`; `design-docs/specs/design-chat-sdk-event-sources.md#validation-rules`; `design-docs/specs/design-chat-sdk-event-sources.md#security-and-rollout-constraints`; `design-docs/specs/design-chat-sdk-event-sources.md#examples-and-tests`; `design-docs/specs/design-event-listener-workflow-trigger.md#chat-sdk`
**Created**: 2026-05-14
**Last Updated**: 2026-05-14

---

## Design Document Reference

**Sources**:

- `design-docs/specs/design-chat-sdk-event-sources.md#overview`
- `design-docs/specs/design-chat-sdk-event-sources.md#validation-rules`
- `design-docs/specs/design-chat-sdk-event-sources.md#security-and-rollout-constraints`
- `design-docs/specs/design-chat-sdk-event-sources.md#examples-and-tests`
- `design-docs/specs/design-event-listener-workflow-trigger.md#chat-sdk`
- `design-docs/references/README.md`
- `design-docs/user-qa/qa-chat-sdk-event-sources.md`

### Summary

Add a shared `kind: "chat-sdk"` event source adapter family for Chat
SDK-supported providers: `slack`, `teams`, `gchat`, `discord`, `telegram`,
`github`, `linear`, `whatsapp`, `messenger`, and `web`. The implementation
uses the accepted generic webhook/send boundary first, normalizes inbound chat
messages to `ExternalEventEnvelope` with `eventType: "chat.message"`, and sends
chat replies through provider-neutral `chat` output destinations.

### Scope

**Included**:

- Closed Chat SDK provider allow-list and source config types.
- Generic webhook inbound contract validation and normalization.
- Chat SDK send endpoint reply dispatch with redacted dispatch records.
- Default adapter registration, event HTTP route handling, manual emit/replay
  support, and backward-compatible cron, Matrix, webhook, and s3-repository
  behavior.
- Examples, README updates, and focused tests for all allowed providers and the
  Slack example flow.

**Excluded**:

- Direct runtime imports from `@chat-adapter/*` packages.
- Provider-specific rich interactions beyond safe `input.action` metadata.
- Attachment downloading.
- Dedicated browser chat UI for `web`; this pass treats `web` as a provider
  using the same normalized event and chat destination contracts.

## Codex-Agent Reference Mapping

- `../../codex-agent`: missing locally during design; not used as a source.
- `https://chat-sdk.dev/docs/adapters`: provider adapter behavior reference.
- `https://chat-sdk.dev/adapters`: provider catalog reference for the allow-list.
- `https://chat-sdk.dev/docs/contributing`: adapter boundary reference.

Intentional divergences:

- rielflow will not copy Codex-agent code or add Cursor/Codex-specific chat
  behavior.
- rielflow will not directly depend on every Chat SDK provider package in this
  first implementation.
- Provider-specific payloads stay behind `src/events/adapters/chat-sdk/`; event
  bindings and workflow input mapping see only normalized contracts.

---

## Task Breakdown

### TASK-001: Chat SDK Source Types And Validation

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/events/types.ts`, `src/events/validate.ts`,
`src/events/validate-source-chat-sdk.ts`, `src/events/config.test.ts`
**Dependencies**: None

```typescript
type ChatSdkProvider =
  | "slack"
  | "teams"
  | "gchat"
  | "discord"
  | "telegram"
  | "github"
  | "linear"
  | "whatsapp"
  | "messenger"
  | "web";

interface ChatSdkSourceConfig extends EventSourceConfigBase {
  readonly kind: "chat-sdk";
  readonly provider: ChatSdkProvider;
  readonly mode?: "generic-webhook";
  readonly webhook: ChatSdkWebhookConfig;
  readonly send?: ChatSdkSendConfig;
  readonly providerConfig?: JsonObject;
}

interface ChatSdkWebhookConfig extends JsonObject {
  readonly path: string;
  readonly signingSecretEnv?: string;
  readonly bearerTokenEnv?: string;
}

interface ChatSdkSendConfig extends JsonObject {
  readonly endpointUrlEnv: string;
  readonly tokenEnv?: string;
}
```

**Checklist**:

- [x] Add `ChatSdkSourceConfig` and provider types without weakening unknown
      source-kind handling.
- [x] Add `chat-sdk` to supported source kinds.
- [x] Validate the closed provider allow-list.
- [x] Validate relative webhook paths, duplicate path detection, and traversal
      rejection according to the accepted design.
- [x] Reject token values where env-var names are required.
- [x] Reject unsupported `mode` values and ambiguous outbound reply config.
- [x] Add config tests for every allowed provider and every required failure
      mode.

### TASK-002: Generic Boundary Normalization Adapter

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/adapters/chat-sdk/index.ts`,
`src/events/adapters/chat-sdk/types.ts`,
`src/events/adapters/chat-sdk/normalization.ts`,
`src/events/adapters/chat-sdk.test.ts`
**Dependencies**: TASK-001

```typescript
interface ChatSdkGenericInboundPayload extends JsonObject {
  readonly provider: ChatSdkProvider;
  readonly eventId?: string;
  readonly eventType?: string;
  readonly occurredAt?: string;
  readonly actor?: ChatSdkActorPayload;
  readonly conversation?: ChatSdkConversationPayload;
  readonly message?: ChatSdkMessagePayload;
  readonly action?: JsonObject | null;
}

interface ChatSdkActorPayload extends JsonObject {
  readonly id: string;
  readonly displayName?: string;
}

interface ChatSdkConversationPayload extends JsonObject {
  readonly id: string;
  readonly threadId?: string;
}

interface ChatSdkMessagePayload extends JsonObject {
  readonly text: string;
  readonly attachments?: readonly JsonObject[];
}

interface ChatSdkMessageInput extends JsonObject {
  readonly provider: ChatSdkProvider;
  readonly text: string;
  readonly format: "plain" | "markdown";
  readonly attachments: readonly JsonObject[];
  readonly action?: JsonObject | null;
  readonly rawEventType?: string;
}
```

**Checklist**:

- [x] Implement `createChatSdkEventSourceAdapter()` for generic webhook mode.
- [x] Normalize accepted inbound payloads to `chat.message` envelopes.
- [x] Preserve provider, source id, event id, actor, conversation, thread,
      message text, attachments metadata, and redacted `rawRef`.
- [x] Derive stable dedupe keys when `eventId` is absent.
- [x] Reject payloads whose provider does not match the configured source.
- [x] Verify signatures or bearer tokens before normalization is accepted.
- [x] Add fixture tests for provider mismatch, missing text, optional thread,
      fallback dedupe, and redacted raw metadata.

### TASK-003: Runtime Route, Manual Emit, And Replay Integration

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/http-routes.ts`,
`src/events/listener-service.ts`, `src/events/manual-emit.ts`,
`src/events/source-rate-limit.ts`,
`src/events/listener-service.test.ts`, `src/events/manual-emit.test.ts`
**Dependencies**: TASK-001, TASK-002

```typescript
function resolveEventSourceHttpPath(source: EventSourceConfig): string | undefined;

function normalizeChatSdkRawEvent(
  input: RawExternalEvent,
): Promise<ExternalEventEnvelope>;

interface EventSourceRateLimitPolicy {
  readonly sourceId: string;
  readonly windowMs: number;
  readonly maxRequests: number;
}
```

**Checklist**:

- [x] Route `chat-sdk.webhook.path` under the existing event HTTP server without
      changing existing webhook, s3-repository, Matrix, or cron routes.
- [x] Add inbound HTTP rate limiting per Chat SDK source id before normalization
      or receipt acceptance.
- [x] Ensure raw request artifact handling stays redacted before receipts or
      dispatch records reference it.
- [x] Keep manual emit and replay able to normalize Chat SDK raw payloads.
- [x] Add listener-service tests for route registration, auth rejection,
      duplicate retry handling, rate-limit rejection, and successful
      `chat.message` dispatch.
- [x] Add manual emit/replay tests using the Chat SDK payload fixture.

### TASK-004: Chat Reply Dispatch

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/adapters/chat-sdk/reply.ts`,
`src/events/adapters/chat-sdk.test.ts`, `src/events/reply-dispatcher.test.ts`
**Dependencies**: TASK-001, TASK-002

```typescript
interface ChatSdkSendRequest extends JsonObject {
  readonly provider: ChatSdkProvider;
  readonly target: ChatSdkReplyTarget;
  readonly message: { readonly text: string };
  readonly idempotencyKey: string;
}

interface ChatSdkReplyTarget extends JsonObject {
  readonly conversationId: string;
  readonly threadId?: string;
}
```

**Checklist**:

- [x] Send provider-neutral chat replies to `send.endpointUrlEnv`.
- [x] Use `send.tokenEnv` only as a credential lookup; never persist token
      values or authorization headers.
- [x] Preserve inbound provider, conversation id, and thread id unless a
      destination target override is configured.
- [x] Return provider message ids from generic send responses when supplied.
- [x] Persist redacted dispatch metadata through the existing reply dispatcher.
- [x] Add reply tests for target resolution, idempotency key propagation, unset
      endpoint env rejection, HTTP failure, and redaction.

### TASK-005: Registry And Provider Capability Coverage

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/adapter-registry.ts`,
`src/events/adapter-registry.test.ts`, `src/events/validate-destinations.ts`,
`src/events/config.test.ts`
**Dependencies**: TASK-001, TASK-002, TASK-004

```typescript
interface ChatSdkProviderCapability extends JsonObject {
  readonly provider: ChatSdkProvider;
  readonly eventTypes: readonly string[];
  readonly reply: boolean;
}

type ChatSdkNormalizedEventType =
  | "chat.message"
  | "chat.mention"
  | "chat.command"
  | "chat.action"
  | "chat.modal-submit";
```

**Checklist**:

- [x] Register `chat-sdk` in the default event source registry.
- [x] Keep registry sorting and duplicate-kind rejection unchanged.
- [x] Add table-driven capability coverage for all ten requested providers.
- [x] Validate chat destinations against Chat SDK reply support.
- [x] Validate binding event types against declared provider capabilities.
- [x] Add provider capability tests that reject unsupported binding event types,
      including undeclared `chat.mention`, `chat.command`, `chat.action`, and
      `chat.modal-submit` cases.
- [x] Confirm existing cron, Matrix, webhook, and s3-repository registry tests
      still pass.

### TASK-006: Examples And User-Facing Documentation

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**:
`examples/event-sources/.rielflow-events/sources/chat-sdk-slack.json`,
`examples/event-sources/.rielflow-events/bindings/chat-sdk-slack-to-workflow.json`,
`examples/event-sources/.rielflow-events/destinations/chat-sdk-slack-replies.json`,
`examples/event-sources/payloads/chat-sdk-slack-message.json`,
`examples/event-sources/README.md`, `README.md`
**Dependencies**: TASK-001

**Checklist**:

- [x] Add a secret-free Slack Chat SDK source using env-var references only.
- [x] Add binding and explicit chat destination examples for replies.
- [x] Add a generic-boundary inbound payload fixture.
- [x] Document the full provider allow-list and first-pass generic boundary.
- [x] State that direct `@chat-adapter/*` dependency integration is future scope.
- [x] Keep examples directly usable with `--workflow-definition-dir ./examples`.

### TASK-007: Verification And Progress Closeout

**Status**: Completed
**Parallelizable**: No
**Deliverables**: test results, progress log update, completion criteria update
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006

**Checklist**:

- [x] Run focused event-source tests.
- [x] Run repository type checking.
- [x] Run example event config validation.
- [x] Update this implementation plan progress log.
- [x] Update completion criteria checkboxes.
- [x] Complete the repository post-modification check/test pass required after
      TypeScript changes.

---

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Chat SDK config and validation | `src/events/types.ts`, `src/events/validate.ts`, `src/events/validate-source-chat-sdk.ts` | COMPLETED | `src/events/config.test.ts` |
| Generic normalization adapter | `src/events/adapters/chat-sdk/**` | COMPLETED | `src/events/adapters/chat-sdk.test.ts` |
| Runtime route and replay integration | `src/events/http-routes.ts`, `src/events/listener-service.ts`, `src/events/manual-emit.ts`, `src/events/source-rate-limit.ts` | COMPLETED | `src/events/listener-service.test.ts`, `src/events/manual-emit.test.ts` |
| Chat reply dispatch | `src/events/adapters/chat-sdk/reply.ts` | COMPLETED | `src/events/adapters/chat-sdk.test.ts`, `src/events/reply-dispatcher.test.ts` |
| Registry and capabilities | `src/events/adapter-registry.ts`, `src/events/validate-destinations.ts` | COMPLETED | `src/events/adapter-registry.test.ts`, `src/events/config.test.ts` |
| Examples and docs | `examples/event-sources/**`, `README.md` | COMPLETED | `rielflow events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events` |

## Dependencies

| Task | Depends On | Status |
| --- | --- | --- |
| TASK-001 | accepted Step 3 design review | COMPLETED |
| TASK-002 | TASK-001 | COMPLETED |
| TASK-003 | TASK-001, TASK-002 | COMPLETED |
| TASK-004 | TASK-001, TASK-002 | COMPLETED |
| TASK-005 | TASK-001, TASK-002, TASK-004 | COMPLETED |
| TASK-006 | TASK-001 | COMPLETED |
| TASK-007 | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006 | COMPLETED |

## Parallelization Rules

- `TASK-001` is the first implementation task and owns shared types and
  validation.
- `TASK-006` can run after `TASK-001` in parallel with adapter/runtime work
  because its write scope is examples and documentation only.
- `TASK-003` and `TASK-004` may run concurrently after `TASK-002` only if
  workers keep their ownership split between listener/manual-emit files and
  chat reply files.
- `TASK-005` must wait for reply-dispatch contracts because destination
  validation depends on provider capability and reply-support semantics.

## Verification Plan

```bash
rg -n "chat-sdk|chat\\.message|Chat SDK|outputDestinations" design-docs examples src README.md
rg -n "rate-limit|chat\\.mention|chat\\.command|chat\\.action|chat\\.modal-submit|capability" impl-plans/active/chat-sdk-event-sources.md design-docs/specs/design-chat-sdk-event-sources.md design-docs/specs/design-event-listener-workflow-trigger.md
bun run typecheck
bun test src/events/adapter-registry.test.ts src/events/config.test.ts src/events/listener-service.test.ts src/events/manual-emit.test.ts src/events/reply-dispatcher.test.ts src/events/adapters/chat-sdk.test.ts
bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
```

## Completion Criteria

- [x] `chat-sdk` source kind validates with the closed provider allow-list.
- [x] Unsupported providers, unsafe paths, duplicate paths, token literals, and
      ambiguous reply config fail validation.
- [x] Inbound generic payloads normalize to `chat.message` envelopes for all
      allowed providers through table-driven tests.
- [x] Chat SDK inbound HTTP routes enforce rate limits per source id before
      normalization or receipt acceptance.
- [x] Chat replies dispatch through configured send endpoints with preserved
      conversation/thread targeting and redacted records.
- [x] Binding event-type validation rejects event types not declared by each
      provider capability, including `chat.mention`, `chat.command`,
      `chat.action`, and `chat.modal-submit` cases.
- [x] Default registry includes `chat-sdk` without regressing cron, Matrix,
      webhook, or s3-repository.
- [x] Examples and README cover source, binding, payload, destination, providers,
      security constraints, and first-pass limitations.
- [x] Focused tests, typecheck, and example validation pass.

## Progress Log

### Session: 2026-05-14 Step 4 Implementation Planning

**Tasks Completed**: Plan created from accepted Step 3 design review; Step 5
review feedback addressed for rate-limit planning, provider capability event
type tests, and design-reference section anchors.
**Tasks In Progress**: None.
**Blockers**: None for first-pass generic webhook/send boundary.
**Notes**: Direct `@chat-adapter/*` package integration remains out of scope
until dependency stability and provider-specific verification are reviewed.

### Session: 2026-05-14 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005,
TASK-006, TASK-007.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented the accepted generic Chat SDK webhook/send boundary,
closed provider allow-list, inbound normalization, per-source HTTP rate
limiting, bearer/signature auth, reply dispatch, registry/capability
validation, examples, and focused tests. Verification passed with
`bun run lint:biome`, `bun run typecheck`, focused event-source tests, and
example event config validation.

### Session: 2026-05-14 Step 6 Review Revision

**Tasks Completed**: TASK-001 validation hardening regression fixes.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Addressed Step 7 mid findings by making Chat SDK HTTP path
resolution defensive for malformed non-string `webhook.path` values, skipping
provider capability lookup when `provider` is outside the allow-list, and adding
regression tests that ensure invalid configuration returns structured validation
issues instead of throwing. Verification passed with `bun run lint:biome`,
`bun run typecheck`, focused event-source tests, and example event config
validation.

### Session: 2026-05-14 Step 6 Authentication Revision

**Tasks Completed**: TASK-001 inbound authentication validation hardening.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Addressed Step 7 mid finding by requiring every Chat SDK HTTP
webhook source to configure at least one inbound authentication mechanism:
`webhook.signingSecretEnv` or `webhook.bearerTokenEnv`. Added regression
coverage for missing auth and kept manual emit coverage valid by adding an env
reference to the file-based Chat SDK fixture. Verification passed with
`bun run lint:biome`, `bun run typecheck`, focused event-source tests, example
event config validation, and a CLI invalid-config check for missing auth.
