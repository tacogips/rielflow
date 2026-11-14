# Event Listener Workflow Trigger Design

This document defines an additive architecture for starting divedra workflow
runs from external events.

## Overview

External events should enter divedra through a trigger layer that is separate
from workflow execution. Event-specific code normalizes provider payloads into a
canonical event envelope, applies a binding-specific input mapping, records
idempotency state, and invokes the existing workflow execution boundary.

The workflow engine remains responsible only for workflow execution. It should
not learn Slack, Discord, cron, Telegram, Signal, or UI-specific semantics.

This document describes the current direct-trigger architecture and remains the
implementation baseline. The target architectural direction is refined further
in `design-docs/specs/design-event-external-mailbox-binding.md`: event sources
should conceptually bind to the runtime-owned external mailbox boundary, and
direct workflow starts should be treated as one consumer of external mailbox
input rather than as the fundamental event abstraction.

Recommended placement:

- `src/events/` owns event source configuration, normalization, dedupe, and
  trigger dispatch.
- `src/workflow/` continues to own workflow definitions, sessions, queues, and
  artifacts.
- `src/server/` may host event HTTP routes, but those routes should delegate to
  `src/events/` rather than embedding provider logic in the control plane.
- provider adapters live behind a small registry so adding a source does not
  require editing the workflow engine.

## Goals

- run workflows from external events by converting event input into workflow
  runtime input
- keep workflow JSON and the core engine loosely coupled from provider SDKs
- make new event sources easy to add through a stable adapter interface
- support cron and chat-oriented sources first
- support repository/object-storage file-created sources such as S3 object
  creation
- support webhook-style and provider event-notification sources
- preserve durable audit records for received events, mapping results, dedupe,
  and workflow execution ids
- acknowledge webhook events quickly and execute workflows asynchronously by
  default
- keep credentials, channel ids, signing secrets, and provider-specific runtime
  settings out of authored workflow bundles

## Non-Goals

- turning divedra into a full chat bot framework
- adding provider-specific fields to `workflow.json`
- making a running workflow depend on a provider SDK after it starts
- requiring chat UI output streaming before event-to-workflow triggering works
- replacing the existing GraphQL and library workflow execution APIs
- solving distributed, multi-process scheduling in the first iteration
- downloading or parsing full repository file contents unless a source binding
  explicitly opts into that behavior

## Relationship To Existing Runtime

The current public execution boundary already accepts arbitrary
`runtimeVariables` through:

- `runWorkflow()` in `src/workflow/engine.ts`
- `executeWorkflow()` and `createWorkflowExecutionClient()` in `src/lib.ts`
- GraphQL `executeWorkflow(input: ExecuteWorkflowInput!)`

The event trigger layer should call that boundary instead of constructing
sessions directly.

Canonical event-triggered runtime variables:

```typescript
interface EventTriggeredRuntimeVariables {
  readonly workflowInput: Readonly<Record<string, unknown>>;
  readonly event: ExternalEventMetadata;
  readonly humanInput?: Readonly<Record<string, unknown>>;
}
```

Rules:

- `workflowInput` is the canonical business input produced by the event binding.
- `event` contains source metadata needed for audit, routing, and replies.
- `humanInput` is a first-iteration compatibility mirror when the workflow
  expects the existing bootstrap mailbox behavior.
- provider raw payloads are not copied into runtime variables by default; they
  are stored as event artifacts and referenced by id/path.

This keeps event support compatible with existing workflows while establishing a
clearer long-term name for non-human triggers such as cron.

## Event Runtime Boundaries

### Components

```text
Provider SDK / Cron Timer / HTTP Webhook
  -> EventSourceAdapter
  -> ExternalEventEnvelope
  -> EventBindingMatcher
  -> InputMapper
  -> EventLedger
  -> WorkflowTriggerRunner or EventSupervisorRouter
  -> direct divedra workflow execution or workflow supervisor control
```

### `EventSourceAdapter`

Provider-specific boundary.

Responsibilities:

- verify incoming webhook signatures when applicable
- subscribe to or receive provider events when webhook delivery is unavailable
- normalize provider payloads into `ExternalEventEnvelope`
- expose source lifecycle methods for `events serve`
- avoid importing `src/workflow/engine.ts`

Minimal interface:

```typescript
interface EventSourceAdapter {
  readonly kind: string;
  start(input: EventSourceStartInput): Promise<EventSourceHandle>;
  normalize(input: RawExternalEvent): Promise<ExternalEventEnvelope>;
}
```

Adapter packages may depend on provider SDKs. The central event runtime should
depend only on adapter interfaces.

### `ExternalEventEnvelope`

Canonical event shape passed to matching and input mapping.

```typescript
interface ExternalEventEnvelope {
  readonly sourceId: string;
  readonly eventId: string;
  readonly provider: string;
  readonly eventType: string;
  readonly occurredAt?: string;
  readonly receivedAt: string;
  readonly dedupeKey: string;
  readonly actor?: EventActor;
  readonly conversation?: EventConversation;
  readonly input: Readonly<Record<string, unknown>>;
  readonly rawRef?: EventArtifactRef;
}
```

Rules:

- `eventId` is the provider event id when available.
- `dedupeKey` is stable across webhook retries. If the provider lacks an id, it
  is a hash of source id, event type, occurrence time bucket, actor, and input.
- `input` is provider-neutral business data, such as text, command name,
  fields, selected button value, uploaded file refs, or cron schedule context.
- `rawRef` points to an artifact, not to a host absolute path.

### `EventBinding`

A binding connects normalized events to workflow execution.

Configuration should live outside workflow bundles. Recommended default layout:

```text
.divedra-events/
  sources/
    slack-review.json
    nightly-cron.json
  bindings/
    slack-review-to-workflow.json
    nightly-cron-to-workflow.json
```

This avoids reserving names inside the workflow root, where every child
directory is currently a potential workflow bundle.

Minimal binding shape:

```typescript
interface EventBinding {
  readonly id: string;
  readonly enabled?: boolean;
  readonly sourceId: string;
  readonly match?: EventMatchRule;
  readonly workflowName: string;
  readonly inputMapping: EventInputMapping;
  readonly execution?: EventWorkflowExecutionPolicy;
}
```

Rules:

- bindings reference workflows by CLI workflow name, not by filesystem path
- omitted `enabled` means enabled
- omitted `execution.async` means true
- one event may match multiple bindings
- one direct binding starts at most one workflow run per accepted event
- one supervised binding dispatches at most one supervisor command per accepted
  event; that command may start, stop, restart, inspect, or deliver input to a
  supervised run

### `EventInputMapping`

The mapper converts a provider-neutral event envelope into workflow input.

First-iteration recommendation:

- support static JSON templates with simple variable interpolation from
  `event.*` and `source.*`
- support `mode: "event-input"` to pass `ExternalEventEnvelope.input` through
  unchanged
- do not support arbitrary JavaScript expressions in config

Example:

```json
{
  "mode": "template",
  "template": {
    "request": "{{event.input.text}}",
    "channel": "{{event.conversation.id}}",
    "user": "{{event.actor.displayName}}"
  },
  "mirrorToHumanInput": true
}
```

`mirrorToHumanInput` defaults to true for chat sources and false for cron and
repository-file sources. Operators can override it explicitly.

### `WorkflowTriggerRunner`

Execution boundary adapter.

Responsibilities:

- convert mapped input into `runtimeVariables`
- choose command, local library, or remote GraphQL execution
- set `async: true` by default
- persist workflow execution id against the event ledger record in direct mode
- persist supervisor command/run ids and target workflow execution ids against
  the event ledger record in supervised mode
- avoid provider-specific imports

Recommended in-process or remote call path:

```typescript
createWorkflowExecutionClient({
  workflowName: binding.workflowName,
  endpoint: configuredEndpoint,
  workflowRoot,
  artifactRoot,
  sessionStoreRoot,
}).execute({
  input: runtimeVariables,
  async: binding.execution?.async ?? true,
});
```

When `endpoint` is configured, the event process can run as a lightweight
listener that does not load or execute workflows locally.

For bindings that need long-lived lifecycle control, the trigger runner should
delegate to the supervised event control path instead of starting the target
workflow directly. In that mode, the listener maps the event into a structured
supervisor command and sends it to the workflow supervisor, which owns target
workflow start, stop, restart, status, and failure restart policy. See
`design-docs/specs/design-event-supervisor-control.md`.

Command dispatch is also a valid boundary for listener processes that should
only depend on the installed CLI:

```bash
divedra workflow run document-review --variables @mapped-event-input.json
```

The command dispatcher must write the mapped runtime variables to a data-root
artifact first, then pass that file path to `divedra workflow run`. Provider
payloads must not be shell-interpolated into command arguments.

## Provider Source Types

### Cron

Cron is an internal event source, not a workflow node type.

Source config:

- `kind: "cron"`
- schedule expression
- timezone
- optional jitter
- optional missed-run behavior
- optional lock key for future distributed scheduling

Normalized input should include:

- schedule id
- scheduled time
- actual fired time
- timezone
- missed run count when known

First iteration may use a single-process scheduler. Distributed locking should
be an explicit later milestone because the current runtime is local-first.

### S3 Repository File Creation

S3 repository file creation is an object-storage event source for S3-compatible
stores. The event runtime does not poll buckets. Instead, an object-store event
receiver accepts object-created notifications from the store's native event
mechanism, normalizes them, and dispatches matching bindings to workflow
execution.

The receiver is an abstraction layer between provider delivery and divedra:

```text
S3-compatible store event notification
  -> S3RepositoryEventReceiver
  -> ExternalEventEnvelope(eventType = repository.file.created)
  -> EventBinding
  -> WorkflowTriggerRunner
  -> divedra workflow run / library client / GraphQL executeWorkflow
```

Source config:

- `kind: "s3-repository"`
- provider, such as `aws-s3`, `minio`, or another S3-compatible store adapter
- endpoint URL for S3-compatible stores when not using AWS regional endpoints
- region when required by the provider
- bucket name
- optional repository id
- optional root prefix used to interpret object keys as repository paths
- optional key suffix filters such as `.md`, `.json`, or `.csv`
- event receiver configuration, such as EventBridge, SQS, SNS-to-webhook bridge,
  bucket notification webhook bridge, or provider-specific event stream
- credential environment variable names or ambient provider SDK credential chain
  selection when the receiver needs to verify or fetch object metadata
- object access policy, defaulting to metadata-only

Normalized event type:

- `repository.file.created`

Normalized input should include:

- provider, region, bucket, object key, and decoded repository-relative path
- event receiver id and delivery mechanism
- version id when available
- object size, eTag, sequencer, and content type when available
- creation event name or delivery reason, such as put, post, copy, or
  multipart completion
- user/request metadata when available from the event payload
- data-root file ref only when the binding explicitly downloads the object

Recommended runtime variable shape:

```json
{
  "workflowInput": {
    "repository": {
      "provider": "aws-s3",
      "bucket": "team-docs",
      "rootPrefix": "incoming/"
    },
    "file": {
      "path": "plans/release.md",
      "s3Key": "incoming/plans/release.md",
      "versionId": "3Lg...",
      "etag": "9b2cf535f27731c974343645a3985328",
      "size": 12842,
      "contentType": "text/markdown"
    }
  }
}
```

Rules:

- polling is not part of the S3 repository source design
- object keys are data, not filesystem paths; normalize and validate them before
  deriving repository-relative paths
- use bucket and prefix allow lists so one source cannot trigger workflows for
  unrelated objects
- default behavior passes metadata only; downloading object contents requires an
  explicit `objectAccess.mode`
- downloaded objects must be copied under the divedra data root and exposed to
  workflows through data-root-relative file refs
- dedupe should prefer `(sourceId, bucket, key, versionId)` when versioning is
  available, otherwise `(sourceId, bucket, key, sequencer)` or a provider event
  id
- object-created delivery should be treated as at-least-once; duplicate
  notifications must not start duplicate workflows for the same binding

### Chat SDK

Chat providers should initially be integrated through a Chat SDK adapter where
the provider is supported. Current Chat SDK documentation describes a unified
TypeScript API with adapters for platforms including Slack, Discord, Telegram,
Microsoft Teams, Google Chat, GitHub, Linear, and WhatsApp, plus event handlers
for messages, mentions, reactions, slash commands, buttons, and modals.

Divedra should treat Chat SDK as one adapter family:

- `kind: "chat-sdk"`
- provider adapter selected in source config
- normalized event types such as `chat.message`, `chat.mention`,
  `chat.command`, `chat.action`, and `chat.modal-submit`
- optional response target metadata for future replies

Source config should include only logical names and environment variable names,
not secret values.

### Slack, Discord, Telegram

Slack, Discord, and Telegram can be configured as Chat SDK-backed sources when
their required capabilities match the workflow trigger use case.

Minimum first-iteration event support:

- message or mention event
- slash command where the platform supports it
- action/button callback where available
- channel/conversation id
- actor id and display name when available
- text plus structured fields
- file attachments as data-root file refs when downloaded

Provider-specific capabilities should stay in adapter capability metadata, not
in workflow bindings. For example, Slack scheduled messages or native streaming
support should not change the event trigger contract.

### Signal

Signal should be modeled as a separate provider adapter unless the chosen Chat
SDK version gains a maintained Signal adapter. The event runtime should not
special-case Signal in core code.

Recommended approach:

- `kind: "signal"`
- adapter owns the selected bridge/client implementation
- normalize Signal messages to the same `chat.message` event type
- document operational requirements separately because Signal delivery often
  depends on a bridge process or device-linked account

### Vercel Chat SDK / AI Elements UI

There are two distinct concerns:

- Chat SDK is useful for shipping the same bot logic across chat platforms.
- AI Elements are React UI primitives for chat interfaces built with the Vercel
  AI SDK.

For divedra, the event-trigger layer should expose a provider-neutral HTTP/SDK
entrypoint that a web chat UI can call. A UI built with AI Elements can submit a
message as a `chat.message` event, then display workflow status and final output
through existing GraphQL session queries or future event reply APIs.

The UI should not be treated as a workflow engine dependency. It is another
source adapter:

- `kind: "web-chat"`
- transport: HTTP route or GraphQL mutation
- normalized event type: `chat.message`
- optional conversation id from the browser session
- optional attachments stored under the data-root file area

## Configuration Model

### Source Config

```json
{
  "id": "slack-review",
  "kind": "chat-sdk",
  "provider": "slack",
  "adapter": {
    "tokenEnv": "SLACK_BOT_TOKEN",
    "signingSecretEnv": "SLACK_SIGNING_SECRET"
  }
}
```

```json
{
  "id": "nightly-maintenance",
  "kind": "cron",
  "schedule": "0 2 * * *",
  "timezone": "Asia/Tokyo"
}
```

```json
{
  "id": "incoming-docs",
  "kind": "s3-repository",
  "provider": "s3-compatible",
  "endpointUrlEnv": "DOC_REPOSITORY_S3_ENDPOINT",
  "region": "ap-northeast-1",
  "bucket": "team-docs",
  "rootPrefix": "incoming/",
  "eventReceiver": {
    "mode": "webhook-bridge",
    "signingSecretEnv": "DOC_REPOSITORY_EVENT_SECRET"
  },
  "objectAccess": {
    "mode": "metadata-only"
  },
  "filters": {
    "suffixes": [".md", ".json"]
  }
}
```

### Binding Config

```json
{
  "id": "slack-review-to-release-workflow",
  "sourceId": "slack-review",
  "match": {
    "eventType": "chat.mention",
    "conversationId": "C0123456789"
  },
  "workflowName": "release-review",
  "inputMapping": {
    "mode": "template",
    "template": {
      "request": "{{event.input.text}}",
      "source": "slack",
      "channel": "{{event.conversation.id}}"
    },
    "mirrorToHumanInput": true
  },
  "execution": {
    "async": true,
    "dedupeWindowMs": 86400000,
    "maxConcurrentPerKey": 1,
    "concurrencyKey": "{{event.conversation.threadId}}"
  }
}
```

```json
{
  "id": "incoming-doc-to-review-workflow",
  "sourceId": "incoming-docs",
  "match": {
    "eventType": "repository.file.created",
    "pathPrefix": "plans/"
  },
  "workflowName": "document-review",
  "inputMapping": {
    "mode": "template",
    "template": {
      "request": "Review the new repository file.",
      "repository": "{{event.input.repository}}",
      "file": "{{event.input.file}}"
    },
    "mirrorToHumanInput": false
  },
  "execution": {
    "async": true,
    "dedupeWindowMs": 86400000,
    "maxConcurrentPerKey": 1,
    "concurrencyKey": "{{event.input.file.s3Key}}"
  }
}
```

Supervised bindings extend the existing `execution` block with
`mode: "supervised"`. Omitted mode remains `"direct"`:

```json
{
  "id": "chat-controlled-review",
  "sourceId": "web-chat",
  "workflowName": "release-review",
  "inputMapping": {
    "mode": "event-input",
    "mirrorToHumanInput": true
  },
  "execution": {
    "mode": "supervised",
    "supervisorWorkflowName": "divedra-default-workflow-supervisor",
    "maxRestartsOnFailure": 3,
    "autoImprove": false,
    "control": {
      "correlationKey": "{{event.sourceId}}:{{binding.id}}:{{event.conversation.id}}:{{event.conversation.threadId}}",
      "startOnFirstInput": true,
      "allowActions": ["start", "stop", "restart", "status", "input"]
    }
  }
}
```

In supervised mode, `workflowName` is still the target workflow. The event
listener maps each accepted event to a supervisor command and routes it through
the runtime supervisor control service (local library or remote GraphQL), which
owns supervised-run records and target lifecycle for the correlation key. Phase
1 implements that control plane directly over existing workflow execution APIs;
an authored `supervisorWorkflowName` workflow execution is not started yet, but
the name is recorded on supervised-run rows for forward-compatible Phase 2
routing. `supervisorWorkflowName` is the proposed event-layer field name;
implementation may translate it to existing `superviserWorkflowId` runtime
fields until naming is migrated deliberately.
Control-field templates may reference normalized `event.*`, `source.*`, and
`binding.*` values. `startOnFirstInput` lets chat/web-chat bindings treat the
first ordinary message in a conversation as a target workflow start instead of
requiring a separate `start` command.

## Runtime Persistence

Add an event ledger that records every accepted, skipped, duplicate, failed, and
dispatched event.

Recommended record:

```typescript
interface EventReceiptRecord {
  readonly receiptId: string;
  readonly sourceId: string;
  readonly bindingId?: string;
  readonly dedupeKey: string;
  readonly status:
    | "received"
    | "duplicate"
    | "skipped"
    | "mapped"
    | "accepted"
    | "dispatching"
    | "dispatched"
    | "failed";
  readonly workflowName?: string;
  readonly workflowExecutionId?: string;
  readonly rawRef?: EventArtifactRef;
  readonly normalizedRef?: EventArtifactRef;
  readonly inputRef?: EventArtifactRef;
  readonly error?: string;
  readonly receivedAt: string;
  readonly updatedAt: string;
}
```

Artifact layout:

```text
{DIVEDRA_ARTIFACT_DIR}/events/{sourceId}/{yyyy-mm-dd}/{receiptId}/
  raw.json
  normalized.json
  workflow-input.json
  dispatch.json
  error.json
```

SQLite remains an index. Artifact files remain the durable evidence.

## Idempotency And Concurrency

Idempotency rules:

- dedupe before workflow execution
- write the event receipt before acknowledging external webhooks
- treat provider retries with the same `dedupeKey` as duplicates
- return success for duplicate webhook retries when the original event was
  accepted
- do not start a second workflow for the same binding and dedupe key inside the
  configured dedupe window

Concurrency rules:

- default concurrency key is the dedupe key
- chat bindings should usually use conversation/thread id as the concurrency key
- cron bindings should usually use source id plus scheduled time
- S3 repository bindings should usually use bucket plus object key, or bucket
  plus object key plus version id when parallel versions should run separately
- first iteration may reject or queue new events when `maxConcurrentPerKey` is
  exceeded; the policy must be explicit in config

Recommended policies:

- `reject-new`: persist skipped event and acknowledge provider
- `queue`: persist pending event and dispatch later
- `allow`: no per-key concurrency limit

Sticky manager-session reuse rules:

- sticky-session lookup must stay binding-local, even when multiple bindings
  target the same workflow and chat conversation
- the minimum sticky-session scope is
  `workflowId + sourceId + binding.id + conversation.id + conversation.threadId`
- sticky reuse may reopen a previously completed workflow session for the same
  binding conversation, because chat-shaped event bursts are modeled as one
  long-lived manager conversation across multiple dispatches
- failed or cancelled workflow sessions must not be reused by sticky dispatch
- while a sticky workflow session has pending user-action replies, new events for
  the same binding conversation must not start a parallel workflow; dispatch
  should be skipped (or queued by a later milestone) and the sticky pointer
  must remain unchanged
- a stored sticky record that does not match the current binding scope must be
  treated as absent rather than reused opportunistically
- sticky lookup should self-heal stale records that reference a missing
  workflow session or a session that is no longer reusable for the same
  binding conversation
- this preserves the event-layer contract that bindings remain distinct
  execution entrypoints with their own mapping and policy decisions

## Acknowledgement Semantics

Webhook providers expect fast acknowledgement. The listener should:

1. verify the request
2. normalize the event
3. persist the receipt and dedupe decision
4. enqueue or asynchronously dispatch workflow execution
5. acknowledge the provider

Workflow completion should not block the HTTP response unless a binding
explicitly opts into synchronous execution for a local-only source.

## Reply Semantics

Triggering a workflow and replying to an event are separate concerns.

The target direction in
`design-docs/specs/design-event-external-mailbox-binding.md` keeps that
separation, but moves the conceptual boundary outward: provider adapters bridge
to and from the runtime-owned external mailbox, while runtime or supervisor
logic decides whether to publish final output, progress, or control/status
messages.

First iteration:

- store reply target metadata in `runtimeVariables.event`
- let workflows produce final output as usual
- do not require automatic provider replies

Reply bridge:

- a runtime-owned reply dispatcher can post provider-neutral reply requests back
  to chat threads
- `divedra/chat-reply-worker` is the workflow-visible built-in node add-on for
  creating such reply requests during a workflow run
- an optional `EventReplyPublisher` can still observe completed workflow runs
  and post configured summaries without requiring a reply node
- provider replies should use the same adapter registry but remain outside the
  workflow engine
- user-action nodes remain the correct mechanism for mid-run human decisions;
  event triggers are only the start-of-run ingestion path

Supporting design:
`design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`.

## Security Model

Rules:

- provider credentials are referenced by environment variable names or runtime
  secrets, never stored in workflow JSON or binding output artifacts
- webhook signatures must be verified before normalization
- webhook replay windows should be enforced when the provider supplies signed
  timestamps
- event HTTP endpoints must be disabled unless explicitly configured
- raw provider payloads should be artifacted with filesystem permissions
  consistent with other divedra runtime artifacts
- input mapping should copy only intentional fields into `workflowInput`
- attachments must be stored under the divedra data root and passed as
  data-root-relative refs
- event APIs should support rate limits per source id
- S3 repository sources must enforce bucket and prefix allow lists before
  dispatching workflow execution
- S3 repository sources must reject polling mode; accepted events must come
  through a configured event receiver
- S3 object content download must require explicit configuration and least
  privilege read access
- S3 object keys must never be used directly as local filesystem paths

## CLI And Server Surface

Recommended CLI additions:

- `events validate [--event-root <path>]`
- `events serve [--event-root <path>] [--endpoint <graphql-url>]`
- `events emit <source-id> --event-file <path>`
- `events list [--source <id>] [--status <status>]`
- `events replay <receipt-id>`

`events serve` should be able to run in two modes:

- local mode: invokes `createWorkflowExecutionClient()` without endpoint and
  executes workflows in-process
- remote mode: uses GraphQL `executeWorkflow` against `--endpoint`

When a binding uses `execution.mode = "supervised"`, both local and remote modes
must route through the supervisor control contract rather than direct target
execution. The same event source should then be able to start a target workflow
and later stop, restart, or inspect it by correlation key.

Recommended environment variables:

- `DIVEDRA_EVENT_ROOT`
- `DIVEDRA_EVENT_ENDPOINT_BASE_URL`
- `DIVEDRA_EVENTS_ENABLED`
- `DIVEDRA_EVENTS_READ_ONLY`

`divedra serve` may later gain `--events`, but the first implementation should
prefer a separate command to keep the control plane and event listener lifecycle
clear.

## Validation Rules

Event config validation should fail when:

- a binding references an unknown source id
- a binding references an unknown workflow name
- a source kind has no registered adapter
- a provider secret env var name is malformed
- a cron schedule cannot be parsed
- an S3 repository source omits bucket, event receiver configuration, or an
  explicit object access policy
- an S3 repository source configures polling as its receiver mode
- an S3 repository source configures a root prefix or suffix filter that cannot
  be represented as a safe repository path rule
- `match.eventType` is unsupported by the source adapter capability metadata
- `inputMapping` references paths not present in the normalized event schema
  when the schema is statically known
- `execution.maxConcurrentPerKey` is less than 1
- `execution.mode` is neither `"direct"` nor `"supervised"`
- `execution.mode = "supervised"` has no finite restart limit after defaults
  are applied
- `execution.mode = "supervised"` allows multiple active runs for the same
  correlation key without requiring an explicit target alias or supervised run id
- `execution.async: false` is used for webhook-backed sources unless explicitly
  allowed by an unsafe/local option

## Implementation Milestones

1. Event config loader and validator.
2. Event ledger artifacts plus SQLite index.
3. Generic `EventSourceAdapter` registry and manual `events emit`.
4. Cron adapter.
5. S3 repository file-created adapter with metadata-only input.
6. Generic webhook adapter for local testing.
7. Chat SDK adapter family for Slack, Discord, and Telegram.
8. Web chat adapter for AI Elements or other browser chat frontends.
9. Optional S3 object download-to-data-root support.
10. Optional reply publisher after workflow completion.
11. Signal adapter if operational requirements and dependency choice are
    accepted.
12. Supervised event control path for chat and web app lifecycle commands.

## References

See `design-docs/references/README.md` for external reference links.
