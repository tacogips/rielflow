# Chat Event Sources Review Improvements Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-event-listener-workflow-trigger.md#shared-chat-source-review-invariants`; `design-docs/specs/design-chat-sdk-event-sources.md#examples-and-tests`; `design-docs/specs/design-chat-sdk-event-sources.md#codex-reference-mapping`
**Created**: 2026-05-15
**Last Updated**: 2026-05-15

---

## Design Document Reference

**Sources**:

- `design-docs/specs/design-event-listener-workflow-trigger.md#shared-chat-source-review-invariants`
- `design-docs/specs/design-chat-sdk-event-sources.md#examples-and-tests`
- `design-docs/specs/design-chat-sdk-event-sources.md#security-and-rollout-constraints`
- `design-docs/user-qa/qa-chat-sdk-event-sources.md`

### Summary

Review and improve the webhook-shaped mock chat source, chat reply webhook
fixture, Matrix chat source, and Chat SDK source as one event-source family.
Implementation should close actionable gaps in examples, fixtures, validation,
or tests while preserving deterministic local `events emit` usage and the
secure Chat SDK generic webhook/send boundary.

### Scope

**Included**:

- Cross-source audit of existing source configs, bindings, destinations,
  payload fixtures, adapter tests, and README examples.
- Focused fixes for documented `chat.message` normalization, provider-neutral
  binding fields, explicit `kind: "chat"` destinations, and deterministic
  local fixture execution.
- Security review for Chat SDK env-var-only credentials, redacted records, and
  no direct `@chat-adapter/*` runtime dependency.
- Verification command updates when examples or tests need clearer operator
  coverage.

**Excluded**:

- New provider-specific Chat SDK direct adapter modes.
- Slash commands, action callbacks, cards, postbacks, reactions, or rich
  interaction handling unless already represented by explicit capability
  metadata and focused tests.
- Live Matrix, Chat SDK, webhook, GraphQL, or agent service requirements for
  required verification.

## Codex-Agent Reference Mapping

- `../../codex-agent`: unavailable in Step 1 through Step 3; do not infer
  reference behavior from missing files.
- Accepted divergence: use divedra-local event-source contracts only.
- Accepted boundary: no Cursor-specific or Codex-specific chat behavior is
  introduced; provider details stay behind event adapter modules.

## Modules

### 1. Cross-Source Fixture And Config Audit

#### `examples/event-sources/.divedra-events/**/*.json`
#### `examples/event-sources/payloads/*.json`
#### `examples/event-sources/README.md`

**Status**: COMPLETED

```typescript
interface ChatSourceAuditResult {
  readonly sourceId: string;
  readonly sourceKind: "webhook" | "matrix" | "chat-sdk";
  readonly normalizedEventType: "chat.message";
  readonly hasExplicitChatDestination: boolean;
  readonly fixturePath: string;
  readonly deterministicEmitCommand: string;
}
```

**Checklist**:

- [x] Compare `example-webhook`, `example-reply-webhook`, `team-matrix`, and
      `chat-sdk-slack` source/binding/destination files against the shared
      invariants.
- [x] Ensure reply-capable examples document explicit `kind: "chat"`
      destinations rather than relying on fallback source routing.
- [x] Ensure fixture payloads map through provider-neutral fields such as
      `eventType`, `conversation.id`, `conversation.threadId`, `actor`, and
      `input.text`.
- [x] Record any non-actionable live-service-only gaps as optional operator
      verification, not required local test work.

### 2. Webhook Mock Chat And Reply Fixture Improvements

#### `src/events/adapters/webhook.ts`
#### `src/events/adapters/webhook.test.ts`
#### `src/events/chat-reply-example.test.ts`
#### `examples/chat-reply-webhook/`
#### `examples/event-sources/.divedra-events/sources/example-webhook.json`
#### `examples/event-sources/.divedra-events/sources/example-reply-webhook.json`
#### `examples/event-sources/.divedra-events/bindings/webhook-to-chat-reply.json`
#### `examples/event-sources/.divedra-events/destinations/example-reply-chat.json`
#### `examples/event-sources/payloads/chat-message.json`
#### `examples/event-sources/payloads/chat-reply-message.json`

**Status**: COMPLETED

```typescript
interface WebhookChatFixtureExpectation {
  readonly eventType: "chat.message";
  readonly inputTextPath: string;
  readonly conversationIdPath: string;
  readonly replyDestinationKind: "chat";
}
```

**Checklist**:

- [x] Verify webhook-shaped mock chat fixtures emit deterministic
      `chat.message` envelopes.
- [x] Verify `webhook-to-chat-reply.json` and `example-reply-chat.json`
      explicitly cover reply-capable chat routing.
- [x] Improve tests or fixtures if reply destination routing is implicit or
      provider-neutral fields are missing.
- [x] Preserve existing generic webhook behavior for non-chat events.
- [x] Keep local fixture validation independent of live HTTP services.

### 3. Matrix Chat Source Alignment

#### `src/events/adapters/matrix.ts`
#### `src/events/adapters/matrix.test.ts`
#### `src/events/matrix-chat-reply-example.test.ts`
#### `examples/matrix-chat-reply/`
#### `examples/event-sources/.divedra-events/sources/team-matrix.json`
#### `examples/event-sources/.divedra-events/bindings/matrix-release-chat-to-workflow.json`
#### `examples/event-sources/.divedra-events/destinations/release-matrix-chat.json`
#### `examples/event-sources/payloads/matrix-room-message.json`

**Status**: COMPLETED

```typescript
interface MatrixChatAlignmentExpectation {
  readonly eventType: "chat.message";
  readonly roomIdField: "conversation.id";
  readonly threadField?: "conversation.threadId";
  readonly replyDestinationKind: "chat";
}
```

**Checklist**:

- [x] Verify Matrix room message fixtures align with the shared
      `chat.message` contract.
- [x] Verify `matrix-release-chat-to-workflow.json` and
      `release-matrix-chat.json` explicitly cover Matrix chat reply routing.
- [x] Improve tests or examples if Matrix reply routing lacks explicit
      `kind: "chat"` destination coverage.
- [x] Confirm diagnostics, receipts, and dispatch records do not expose Matrix
      access tokens or authorization headers.
- [x] Keep live Synapse verification optional and separate from required local
      fixture verification.

### 4. Chat SDK Boundary And Example Alignment

#### `src/events/adapters/chat-sdk/index.ts`
#### `src/events/adapters/chat-sdk/normalization.ts`
#### `src/events/adapters/chat-sdk/reply.ts`
#### `src/events/adapters/chat-sdk.test.ts`
#### `src/events/validate-source-chat-sdk.ts`
#### `examples/event-sources/.divedra-events/sources/chat-sdk-slack.json`
#### `examples/event-sources/.divedra-events/bindings/chat-sdk-slack-to-workflow.json`
#### `examples/event-sources/.divedra-events/destinations/chat-sdk-slack-replies.json`
#### `examples/event-sources/payloads/chat-sdk-slack-message.json`

**Status**: COMPLETED

```typescript
interface ChatSdkBoundaryExpectation {
  readonly mode: "generic-webhook";
  readonly provider: "slack" | "teams" | "gchat" | "discord" | "telegram" | "github" | "linear" | "whatsapp" | "messenger" | "web";
  readonly secretsStoredAsEnvVarNames: true;
  readonly directAdapterRuntimeDependency: false;
}
```

**Checklist**:

- [x] Verify the Chat SDK source keeps generic webhook/send mode and rejects
      direct secret literals.
- [x] Verify `chat-sdk-slack-to-workflow.json` and
      `chat-sdk-slack-replies.json` explicitly cover Chat SDK chat reply
      routing.
- [x] Ensure examples require live Chat SDK deployment URLs and credentials only
      through environment-variable names.
- [x] Confirm fixtures and tests do not depend on `@chat-adapter/*` runtime
      imports.
- [x] Constrain Step 3's low finding by avoiding slash command/action callback
      scope unless explicit capability metadata and tests already exist.

### 5. Shared Verification And Documentation Closure

#### `examples/event-sources/README.md`
#### `README.md`
#### `impl-plans/active/chat-event-sources-review-improvements.md`

**Status**: COMPLETED

```typescript
interface ChatSourceVerificationPlan {
  readonly requiredCommands: readonly string[];
  readonly optionalLiveCommands: readonly string[];
  readonly deterministicLocalOnly: true;
}
```

**Checklist**:

- [x] Update documentation only where implementation or fixture changes create
      drift.
- [x] Keep required verification limited to local deterministic commands.
- [x] Add progress-log entries after each implementation session.
- [x] Keep this plan in `impl-plans/active/` for Step 7 review; archive to
      `impl-plans/completed/` after the review gate accepts the implementation.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Cross-source fixture/config audit | `examples/event-sources/.divedra-events/**/*.json` | COMPLETED | validation commands |
| Webhook mock chat/reply fixture improvements | `src/events/adapters/webhook.test.ts`, `src/events/chat-reply-example.test.ts`, `examples/event-sources/.divedra-events/bindings/webhook-to-chat-reply.json`, `examples/event-sources/.divedra-events/destinations/example-reply-chat.json` | COMPLETED | focused webhook tests |
| Matrix chat source alignment | `src/events/adapters/matrix.test.ts`, `src/events/matrix-chat-reply-example.test.ts`, `examples/event-sources/.divedra-events/bindings/matrix-release-chat-to-workflow.json`, `examples/event-sources/.divedra-events/destinations/release-matrix-chat.json` | COMPLETED | focused Matrix tests |
| Chat SDK boundary/example alignment | `src/events/adapters/chat-sdk.test.ts`, `src/events/validate-source-chat-sdk.ts`, `examples/event-sources/.divedra-events/bindings/chat-sdk-slack-to-workflow.json`, `examples/event-sources/.divedra-events/destinations/chat-sdk-slack-replies.json` | COMPLETED | focused Chat SDK tests |
| Verification/docs closure | `examples/event-sources/README.md`, `README.md` | COMPLETED | shared validation suite |

## Dependencies

| Task | Depends On | Status |
| --- | --- | --- |
| TASK-001: Cross-source audit | Accepted Step 3 design review | COMPLETED |
| TASK-002: Webhook improvements | TASK-001 | COMPLETED |
| TASK-003: Matrix alignment | TASK-001 | COMPLETED |
| TASK-004: Chat SDK alignment | TASK-001 | COMPLETED |
| TASK-005: Verification/docs closure | TASK-002, TASK-003, TASK-004 | COMPLETED |

## Parallelization

- `TASK-001` is not parallelizable because it establishes the shared gap list.
- `TASK-002`, `TASK-003`, and `TASK-004` are parallelizable after `TASK-001`
  when assigned to disjoint write scopes.
- `TASK-005` is not parallelizable because it reconciles verification and docs
  after implementation changes are known.

## Verification

Required local commands:

```bash
bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events
bun run src/main.ts workflow validate chat-reply-webhook --workflow-definition-dir ./examples
bun run src/main.ts workflow validate matrix-chat-reply --workflow-definition-dir ./examples
bun test src/events/adapters/webhook.test.ts src/events/adapters/matrix.test.ts src/events/adapters/chat-sdk.test.ts src/events/chat-reply-example.test.ts src/events/matrix-chat-reply-example.test.ts src/events/reply-dispatcher.test.ts
bun run typecheck
```

Planning/review commands:

```bash
rg -n "Shared Chat Source Review Invariants|Review closure|chat-sdk|Matrix|webhook|kind: \"chat\"" design-docs examples src README.md
git diff --stat
git status --short
```

Optional operator checks must be documented separately and must not replace the
required local commands.

## Completion Criteria

- [x] All actionable gaps from TASK-001 are either fixed or explicitly recorded
      as non-actionable optional live-service follow-up.
- [x] Webhook mock chat and chat reply webhook examples validate
      deterministically.
- [x] Matrix examples validate deterministically and keep live Synapse checks
      optional.
- [x] Chat SDK examples preserve env-var-only credentials, redaction, and no
      direct `@chat-adapter/*` runtime dependency.
- [x] Step 3 low finding remains contained: no new slash command/action callback
      implementation is added without explicit capability metadata and tests.
- [x] Required verification commands pass.
- [x] Progress log records the implementation session, changed files, commands
      run, and remaining risks.

## Progress Log

### Session: 2026-05-15 00:00

**Tasks Completed**: Plan created from accepted Step 3 design review.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implementation must start with TASK-001 and keep all required checks
deterministic/local.

### Session: 2026-05-15 00:30

**Tasks Completed**: Addressed Step 5 implementation-plan review feedback by
adding concrete source, binding, destination, payload, example workflow, and test
file paths to TASK-002, TASK-003, and TASK-004.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Accepted design remains unchanged; this revision only improves plan
concreteness for implementation ownership.

### Session: 2026-05-15 01:05

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Tasks In Progress**: None.
**Blockers**: Full-repository Biome check is blocked by pre-existing
`src/workflow/call-step-impl/direct-step-execution.ts` excessive-lines
diagnostic outside this plan's file set.
**Notes**: Added focused fixture-contract tests in
`src/events/adapters/webhook.test.ts`, `src/events/adapters/matrix.test.ts`,
and `src/events/adapters/chat-sdk.test.ts` to lock checked-in source, binding,
destination, and payload fixtures to explicit `kind: "chat"` reply routing,
Matrix room/thread normalization, and Chat SDK generic env-var-only boundary.
Required local validation, focused tests, and typecheck passed; Biome passed on
the touched test files.

## Related Plans

- **Depends On**: `impl-plans/active/chat-sdk-event-sources.md`
- **Related Completed Work**: `impl-plans/completed/matrix-event-source.md`,
  `impl-plans/event-chat-reply-webhook-example.md`,
  `impl-plans/completed/event-source-adapters.md`
