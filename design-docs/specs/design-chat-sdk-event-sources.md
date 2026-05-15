# Chat SDK Event Sources

This document defines the divedra event-source design for Vercel Chat SDK
platform adapters.

## Overview

divedra currently has event-source coverage for cron, generic webhook, Matrix,
and S3 repository events. The Chat SDK event-source family adds one shared
`kind: "chat-sdk"` adapter boundary for Chat SDK-supported chat platforms that
are not already implemented directly:

- `slack`
- `teams`
- `gchat`
- `discord`
- `telegram`
- `github`
- `linear`
- `whatsapp`
- `messenger`
- `web`

The adapter family must normalize inbound provider messages to the existing
`ExternalEventEnvelope` contract with `eventType: "chat.message"` by default,
and must dispatch provider-neutral chat replies through the output-destination
publisher. Provider-specific SDKs and webhook details stay behind the
`src/events/adapters/chat-sdk/` boundary.

The preferred first implementation is a secure generic Chat SDK deployment
boundary rather than direct runtime imports from every `@chat-adapter/*`
package. divedra should be able to receive a normalized webhook from an
operator-owned Chat SDK deployment and send replies to that deployment through a
configured send endpoint. Direct package integration remains a later option
only when dependency stability, credential surface, and provider verification
requirements are reviewed.

## Goals

- Add an explicit provider allow-list for every current Chat SDK chat platform
  adapter listed above.
- Normalize inbound provider events into divedra `chat.message` events.
- Preserve source id, event id, provider, actor, conversation, thread, text,
  attachments, dedupe key, and raw artifact reference.
- Dispatch chat replies through the same provider-neutral output destination
  path used by Matrix and other chat sources.
- Keep workflow definitions, bindings, and supervisor logic provider-neutral.
- Validate unsafe paths, unsupported providers, ambiguous reply configuration,
  and missing environment-variable references before listeners start.
- Keep cron, Matrix, webhook, and S3 repository event-source behavior backward
  compatible.

## Non-Goals

- Replacing Matrix-specific event source support with Chat SDK.
- Embedding provider SDK credentials or token values in workflow bundles,
  example files, event receipts, or runtime artifacts.
- Making workflow execution depend on Chat SDK packages after an event has been
  normalized.
- Supporting every provider-specific rich interaction in the first iteration.
- Treating Chat SDK as a workflow engine, supervisor, or mailbox implementation.

## Source Configuration

The source kind is shared and the provider is closed by allow-list:

```json
{
  "id": "team-slack",
  "kind": "chat-sdk",
  "provider": "slack",
  "mode": "generic-webhook",
  "webhook": {
    "path": "chat-sdk/team-slack",
    "signingSecretEnv": "DIVEDRA_CHAT_SDK_SLACK_WEBHOOK_SECRET"
  },
  "send": {
    "endpointUrlEnv": "DIVEDRA_CHAT_SDK_SLACK_SEND_URL",
    "tokenEnv": "DIVEDRA_CHAT_SDK_SLACK_SEND_TOKEN"
  }
}
```

Rules:

- `provider` must be one of the allowed provider ids.
- `mode` defaults to `generic-webhook`; direct package modes require an
  implementation-plan decision before use.
- `webhook.path` must be event-root local, relative to the event server route
  prefix, and must reject absolute paths, empty paths, duplicate paths, and path
  traversal.
- Secrets are referenced only by environment-variable names.
- `send` is required only when the source or any destination using the source
  supports outbound replies.
- Provider-specific fields may be added under `providerConfig`, but bindings
  cannot match provider-specific raw fields directly.

## Generic Chat SDK Boundary

The generic boundary lets divedra integrate with a deployed Chat SDK bot without
depending on the Chat SDK package graph in the divedra runtime.

Inbound request contract:

```json
{
  "provider": "slack",
  "eventId": "evt-123",
  "eventType": "message",
  "occurredAt": "2026-05-14T00:00:00.000Z",
  "actor": {
    "id": "U123",
    "displayName": "Operator"
  },
  "conversation": {
    "id": "C123",
    "threadId": "1720000000.000100"
  },
  "message": {
    "text": "review this branch",
    "attachments": []
  }
}
```

The adapter verifies the configured shared signature or bearer token, rejects
provider mismatches, persists the raw request as a redacted artifact, and
normalizes the request to `ExternalEventEnvelope`.

Outbound send contract:

```json
{
  "provider": "slack",
  "target": {
    "conversationId": "C123",
    "threadId": "1720000000.000100"
  },
  "message": {
    "text": "Workflow accepted the request."
  },
  "idempotencyKey": "reply-123"
}
```

The source adapter sends this request to `send.endpointUrlEnv` with the
configured credential reference. Dispatch records store source id, destination
id, provider, target ids, idempotency key, status, and redacted request
metadata. They must not store tokens, authorization headers, or full raw
provider bodies.

## Normalized Event Contract

Every supported provider produces `ExternalEventEnvelope` with:

- `sourceId`: source config id.
- `eventId`: provider event id or generic-boundary event id.
- `provider`: one of the Chat SDK provider ids.
- `eventType`: `chat.message` unless capability metadata maps a supported
  mention, command, or action event to a narrower event type.
- `receivedAt`: divedra receive time.
- `occurredAt`: provider occurrence time when supplied.
- `dedupeKey`: stable provider event id plus source id; if no event id is
  supplied, a hash over source id, provider, conversation, thread, actor, time
  bucket, and message text.
- `actor`: provider-neutral user/bot identity.
- `conversation`: provider-neutral conversation and optional thread identity.
- `input`: provider-neutral message data.
- `rawRef`: redacted raw artifact reference.

Minimum `input` shape:

```json
{
  "provider": "slack",
  "text": "review this branch",
  "format": "plain",
  "attachments": [],
  "action": null,
  "rawEventType": "message"
}
```

Attachments are passed as data-root-relative refs only after explicit download
configuration. The first iteration may preserve attachment metadata without
downloading content.

## Provider Capability Matrix

Capability metadata is table-driven per provider and lives with the adapter.
Bindings see only normalized events and declared capabilities.

| Provider | Required inbound capability | Reply capability |
| --- | --- | --- |
| `slack` | message or mention, conversation/thread ids | thread or channel message |
| `teams` | message or mention, conversation/thread ids | conversation reply |
| `gchat` | message or mention, space/thread ids | space or thread message |
| `discord` | message or slash-command style input, channel/thread ids | channel or thread message |
| `telegram` | direct/group message, chat id | chat message |
| `github` | issue or pull request comment/mention | issue or pull request comment |
| `linear` | issue comment/mention | issue comment |
| `whatsapp` | direct business message | direct message |
| `messenger` | direct message or postback | direct message |
| `web` | AI SDK `useChat` style message | browser conversation message |

Provider-specific rich interactions such as Slack buttons, Discord components,
Messenger postbacks, or Google Chat cards can normalize to `chat.action` only
after capability metadata and tests exist. Until then, they should either be
ignored with an event receipt reason or included as intentional metadata inside
`input.action` when the generic boundary supplies a safe shape.

## Binding and Destination Behavior

Chat SDK sources use the existing event binding and output destination model:

```json
{
  "id": "team-slack-to-review",
  "sourceId": "team-slack",
  "outputDestinations": ["team-slack-replies"],
  "match": {
    "eventType": "chat.message",
    "conversationId": "C123"
  },
  "workflowName": "release-review",
  "inputMapping": {
    "mode": "event-input",
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

```json
{
  "id": "team-slack-replies",
  "kind": "chat",
  "sourceId": "team-slack"
}
```

Rules:

- `mirrorToHumanInput` defaults to true for `chat-sdk` sources.
- Default concurrency for interactive chat is source plus conversation plus
  thread.
- Destination fallback to the inbound source remains available for compatibility
  but examples should prefer explicit `chat` destinations.
- Reply dispatch must preserve the inbound provider, conversation id, and
  thread id unless the destination pins a target.
- Supervised bindings use the same deterministic supervisor control path as
  other chat sources.

## Validation Rules

Validation fails when:

- `kind: "chat-sdk"` uses a provider outside the allow-list.
- `mode` is not a supported Chat SDK integration mode.
- webhook and send endpoint paths are absolute, empty, duplicate, or contain
  path traversal.
- credential fields contain token values instead of environment-variable names.
- outbound reply support is enabled without an unambiguous send endpoint or
  direct adapter send capability.
- a destination references a Chat SDK source whose provider does not advertise
  reply support.
- a binding matches an event type not declared in the provider capability
  metadata.
- provider-specific config tries to bypass normalized event mapping.
- generic inbound payload provider does not match the configured source
  provider.

## Security and Rollout Constraints

- Prefer generic webhook/send integration for the first issue-resolution pass.
- Add direct `@chat-adapter/*` dependencies only after supply-chain review,
  Bun lockfile review, and provider-specific signature verification design.
- Verify inbound signatures before normalization or receipt acceptance.
- Redact tokens, authorization headers, full webhook URLs with embedded secrets,
  and raw request bodies from logs and dispatch records.
- Rate-limit inbound HTTP routes per source id.
- Acknowledge duplicate provider retries as successful only after dedupe has
  confirmed the original accepted receipt.
- Keep examples secret-free and use placeholder environment-variable names.

## Examples and Tests

Expected repository updates:

- `examples/event-sources/.divedra-events/sources/chat-sdk-slack.json`
- `examples/event-sources/.divedra-events/bindings/chat-sdk-slack-to-workflow.json`
- `examples/event-sources/.divedra-events/destinations/chat-sdk-slack-replies.json`
- `examples/event-sources/payloads/chat-sdk-slack-message.json`
- `examples/event-sources/README.md`

The Slack example can stand in for the shared adapter family as long as config
tests cover every allowed provider. Provider-specific fixture payloads should be
added when normalization differs materially.

The Chat SDK example must stay aligned with the existing webhook-shaped mock
chat and Matrix examples:

- it uses the same `chat.message` normalized event contract as
  `example-webhook`, `example-reply-webhook`, and `team-matrix`
- it uses explicit `kind: "chat"` output destinations for reply routing
- it keeps deterministic fixture execution under
  `examples/event-sources/payloads/chat-sdk-slack-message.json`
- it requires live Chat SDK deployment URLs and credentials only through
  environment-variable names
- it does not introduce direct `@chat-adapter/*` dependencies in divedra runtime
  code for the generic-boundary implementation

Review closure for this source should include the shared event source
validation command and the focused Chat SDK adapter test:

```bash
bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events
bun test src/events/adapters/chat-sdk.test.ts
```

Verification commands for the implementation plan:

```bash
rg -n "chat-sdk|chat\\.message|Chat SDK|outputDestinations" design-docs examples src README.md
bun run typecheck
bun test src/events/adapter-registry.test.ts src/events/config.test.ts src/events/listener-service.test.ts src/events/manual-emit.test.ts src/events/reply-dispatcher.test.ts
```

## Codex Reference Mapping

No local `../../codex-agent` reference repository was available during this
design update. The active references are the Chat SDK documentation URLs from
workflow intake:

- `https://chat-sdk.dev/docs/adapters`
- `https://chat-sdk.dev/adapters`
- `https://chat-sdk.dev/docs/contributing`

These are adapter behavior references only. divedra intentionally keeps Chat
SDK and any Cursor- or Codex-specific behavior isolated behind event adapter
modules, runtime receipts, and provider-neutral external mailbox/output
contracts.

## Review Decisions

- Keep `workflowMode` as `issue-resolution`; the request requires design,
  implementation, examples, tests, review, commit, and push workflow steps.
- Keep the provider work as one shared adapter family because config schema,
  normalization, listener routing, reply dispatch, docs, and tests are shared.
- Prefer a generic Chat SDK deployment boundary for the first implementation to
  reduce dependency and credential blast radius.
- Treat `web` as a Chat SDK provider for browser conversation ingress and reply
  delivery; it should use the same `chat.message` and `chat` destination
  contracts as external chat platforms.
- Treat WhatsApp and Messenger as allowed providers because they are listed in
  the current Chat SDK adapter catalog, but require generic-boundary operation
  unless direct adapter stability is reviewed.

## Open Questions

Tracked in `design-docs/user-qa/qa-chat-sdk-event-sources.md`.

## References

See `design-docs/references/README.md` for external references.
