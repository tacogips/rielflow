# Event External Mailbox Binding Design

This document defines the target architecture for integrating external event
sources with rielflow through a runtime-owned external mailbox boundary instead
of coupling provider adapters directly to workflow execution entrypoints.

## Overview

The core idea is:

- external input mailbox and external output mailbox exist as runtime-owned
  boundary surfaces independently of any specific event source
- event sources do not own workflow start, stop, reply, or progress semantics
- event bindings connect provider transports to that external mailbox boundary
- workflow runtime and workflow supervisor consume external input messages and
  publish external output messages

This keeps provider adapters simple and transport-focused:

- inbound: provider event -> normalized external mailbox input
- outbound: external mailbox output -> provider API call

The workflow engine and supervisor remain the owners of workflow lifecycle,
published output selection, and progress/control semantics.

## Goals

- decouple provider adapters from workflow execution and supervisor internals
- keep event listeners transport-focused and easy to extend
- preserve runtime-owned auditability for external input and output
- make reply and progress publication consistent across chat, webhook, web app,
  and future event transports
- allow workflows and supervisors to publish output even when no event source is
  currently attached

## Non-Goals

- exposing per-node execution-local mailbox directories directly to providers
- letting provider adapters inspect workflow node internals to decide replies
- replacing the existing canonical execution mailbox model for intra-workflow
  communication
- requiring every workflow to be event-driven

## Resolved Planning Decisions

This section fixes the implementation target for the first concrete plan so the
document can guide incremental work without implying a full mailbox rewrite.

- the first implementation slice reuses the existing event receipt ledger,
  supervised-run records, reply-dispatch persistence, and execution-scoped
  `CommunicationRecord` artifacts instead of introducing one brand-new global
  mailbox store
- pre-execution inbound staging remains outside workflow execution artifact
  trees and is persisted as runtime-owned event-ledger records until a target
  workflow execution or supervised run is known
- execution-scoped `external-mailbox` communications remain the canonical
  persisted representation once a workflow execution accepts input or publishes
  output
- direct workflow execution remains supported and keeps the current
  `workflowInput`, `event`, and optional `humanInput` runtime-variable contract
  while being reframed as one external-mailbox consumer
- provider reply delivery remains a transport-side effect with durable runtime
  records; the first migration step may keep the existing dispatcher/storage
  shape as long as it consumes provider-neutral external output messages rather
  than adapter-authored reply payloads
- event binding configuration continues to live under `.rielflow-events/`; this
  design changes binding semantics, not configuration placement

## Relationship To Existing Mailbox Model

This design extends the existing mailbox architecture; it does not replace it.

Existing distinction:

- canonical routed mailbox under `communications/{communicationId}/...` is the
  runtime-owned communication store
- per-node execution-local mailbox under node artifacts is a worker-facing view
  only

This document adds a higher-level interpretation for communications whose
`routingScope` is `external-mailbox`:

- external input messages entering a workflow or supervisor boundary
- external output messages leaving a workflow or supervisor boundary
- optional external progress/control messages that are not the final workflow
  business output

Event sources must bind to this external mailbox boundary, not to
`nodes/.../mailbox/inbox` or `nodes/.../mailbox/outbox`.

Workflow output mail and external output publication are intentionally separate.
The internal mailbox/outbox artifacts preserve step execution payloads and
manager-routed workflow data. They can be the source of a selected workflow
business result, but they are not provider delivery requests. A provider-facing
reply exists only after the runtime or supervisor creates an explicit
`external-output` message and routes it through output-destination policy.

The external mailbox boundary is a logical runtime boundary, not one global
filesystem mailbox shared by all workflow executions. When a workflow execution
exists, accepted external input and output can be represented as
execution-scoped communications. Before an execution exists, inbound provider
events must be staged as event/external-input records and later linked to the
created workflow execution or supervised run. Those pre-execution staging
records are runtime ledger records, not synthetic placeholder workflow
communications.

## Current Problem

The current event listener design and implementation are centered on:

- normalize event
- map event to workflow runtime variables
- directly execute a workflow or route a supervisor command

That works, but it couples event ingestion to execution entrypoint semantics.
It also makes reply and progress behavior feel transport-driven instead of
runtime-driven.

Examples of coupling pressure:

- provider replies are currently either explicit `rielflow/chat-reply-worker`
  actions or synthesized supervisor control messages
- final workflow business output and transport reply semantics are discussed in
  the event layer instead of one runtime-owned publication boundary
- progress and control replies risk becoming ad hoc per-adapter behavior

## Target Model

### Boundary Shape

Conceptually:

```text
Provider Adapter
  -> external input mailbox
  -> runtime / supervisor
  -> external output mailbox
  -> provider adapter
```

The external mailbox boundary is runtime-owned and always conceptually present,
even if no event source is attached.

### External Mailbox Address

The external mailbox boundary needs an explicit address so event sources,
supervisor runs, direct workflow consumers, and output publishers can agree on
the same durable target without provider-specific coupling.

Conceptual address fields:

```typescript
interface ExternalMailboxAddress {
  readonly sourceId?: string;
  readonly bindingId?: string;
  readonly workflowName?: string;
  readonly workflowExecutionId?: string;
  readonly supervisedRunId?: string;
  readonly correlationKey?: string;
  readonly conversationId?: string;
  readonly threadId?: string;
}
```

Rules:

- `sourceId` and `bindingId` identify the provider bridge that accepted input or
  is eligible for outbound delivery.
- `workflowName` and `workflowExecutionId` identify the target execution when a
  direct consumer owns the message.
- `supervisedRunId` and `correlationKey` identify the supervisor-owned
  conversation when supervised mode owns the message.
- `conversationId` and `threadId` are provider-neutral routing hints. They are
  not workflow identity.
- The address must be serialized into the persisted external mailbox message or
  its metadata so replay and inspection do not need to reconstruct it from
  adapter-local state.

For interactive sources, `(sourceId, bindingId, correlationKey)` should be the
primary stable address. Provider conversation and thread ids are inputs to
correlation resolution, not a replacement for the resolved correlation key.

### Inbound Flow

1. Provider adapter receives an event.
2. Adapter normalizes it into a provider-neutral external input message.
3. Event binding decides whether that source should be connected to a given
   external mailbox consumer.
4. Runtime persists an external input mailbox communication.
5. A consumer handles the message:
   - direct runtime consumer starts or resumes a workflow, or
   - supervisor consumer interprets it as lifecycle control or workflow input.

### Outbound Flow

1. Workflow runtime or supervisor publishes an external output mailbox message.
2. Event binding decides whether that output should be bridged to a provider.
3. Provider adapter converts the provider-neutral message into a provider API
   call.
4. Dispatch result is persisted as runtime-owned output delivery metadata.

## Message Contracts

External mailbox messages should be provider-neutral JSON objects with explicit
kind and routing metadata. The exact persistence layout can reuse the existing
`CommunicationRecord` and `event_receipts`/reply-dispatch tables, but the
contract should be clear before implementation.

### First Implementation Boundary

To keep rollout conservative, the first implementation should treat the message
contract as the stable API and the persistence layout as an adapter over
existing runtime storage:

- pre-execution inbound staging uses event-ledger/runtime-db records plus
  artifacts
- accepted workflow input uses execution-scoped
  `routingScope: "external-mailbox"` communications
- published workflow/supervisor output uses execution-scoped
  `routingScope: "external-mailbox"` communications
- provider delivery attempts reuse reply-dispatch style persistence until a
  broader external-output dispatch table becomes necessary

The initial implementation does not need a new standalone "external mailbox"
top-level directory if existing event and execution artifacts preserve the same
auditability and replay semantics.

### Pre-Execution And Execution-Scoped Records

Inbound messages can arrive before there is a `workflowExecutionId`. The design
therefore has two persistence phases:

1. Pre-execution staging records provider receipt, normalization, dedupe,
   mapping status, and the resolved external mailbox address.
2. Execution-scoped communication records the accepted external input once a
   workflow execution or supervised run exists.

Rules:

- pre-execution records must be queryable and replayable even when workflow
  execution creation fails
- an execution-scoped `external-input` communication must link back to the
  source pre-execution record
- external output messages are always associated with an existing workflow
  execution or supervised run
- output messages may remain undelivered when no event source binding is
  attached or eligible for that address

### External Input Message

Minimum conceptual fields:

```typescript
interface ExternalInputMessage {
  readonly kind: "external-input";
  readonly address: ExternalMailboxAddress;
  readonly event: ExternalEventEnvelope;
  readonly workflowInput: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly receivedAt: string;
}
```

Rules:

- `event` is the normalized provider-neutral envelope, including `rawRef` when
  raw payload artifacts are available.
- `workflowInput` is the binding-mapped business input. It should be present
  only after mapping succeeds.
- `idempotencyKey` is derived from event receipt identity, provider dedupe key,
  and binding id.
- Provider raw payloads stay artifact-referenced, not embedded by default.
- before a workflow execution exists, the same logical message may be persisted
  first as a staged event-ledger record and only later materialized as an
  execution-scoped communication linked to that receipt.

### External Output Message

Minimum conceptual fields:

```typescript
type ExternalOutputKind = "business-final" | "progress" | "control-status";

interface ExternalOutputMessage {
  readonly kind: "external-output";
  readonly outputKind: ExternalOutputKind;
  readonly address: ExternalMailboxAddress;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}
```

Rules:

- `business-final` payloads are sourced from workflow `output`-kind node
  publication.
- `progress` payloads are derived from runtime state.
- `control-status` payloads are supervisor-owned lifecycle or command replies.
- supervisor-generated chat replies are `control-status` or dispatch-specific
  external outputs before they become provider chat messages.
- The output message is provider-neutral. Provider adapters may format text for
  their transport, but formatting must not change the stored canonical payload.
- output destination ids are delivery context on the external-output message,
  not implicit bindings to workflow output mail.

## Idempotency And Ordering

Inbound idempotency:

- one provider event may match multiple bindings, so idempotency must include
  the binding id
- replayed provider deliveries should reload the existing external input message
  or event receipt instead of creating a second workflow input
- a mapping failure should persist a failed receipt without creating a valid
  external input mailbox message

Outbound idempotency:

- every external output message must have a deterministic `idempotencyKey`
- provider delivery retries use the same key
- successful provider dispatch records should be reused on replay
- failed provider dispatch attempts should remain inspectable without changing
  the workflow or supervisor state

Ordering:

- final business output must be published at most once per selected workflow
  output execution
- progress output is best-effort but must be monotonic per workflow execution or
  supervised run
- control/status output is ordered by supervisor command id or command receipt
  time

The first implementation can use persisted timestamps and existing runtime
counters; it does not need a distributed total order across unrelated mailbox
addresses.

## Binding Model

An event binding should be understood as a bridge between a source transport and
an external mailbox boundary, not as a direct "run this workflow now" rule.

Conceptual responsibilities:

- match inbound provider events
- normalize provider-specific input into a provider-neutral mailbox payload
- select the runtime consumer for the external input mailbox
- optionally select which external output streams should be bridged back to the
  same transport

This model still allows a binding to target a workflow name or supervisor
correlation key, but that target is resolved by the runtime-side consumer of the
external mailbox, not by the adapter itself.

For migration purposes, the current `EventBinding.workflowName`,
`inputMapping`, and supervised-control fields remain valid authored inputs. The
change is that runtime dispatch should construct or consume provider-neutral
external mailbox messages before starting workflows, resuming workflows, or
sending supervisor commands.

The binding should split inbound and outbound policy explicitly:

```typescript
interface EventMailboxBridgePolicy {
  readonly input?: {
    readonly consumer: "direct-workflow" | "supervisor";
  };
  readonly output?: {
    readonly reply?: { readonly mode: "none" | "final" };
    readonly progress?: { readonly mode: "none" | "status-only" };
    readonly control?: { readonly mode: "none" | "status-only" };
  };
}
```

This is a target shape, not a required immediate replacement for the current
`EventBinding.execution` surface. Existing direct and supervised bindings can be
mapped into this shape during migration.

## Consumers Of External Input

### Direct Consumer

The direct consumer is a runtime-owned bridge that:

- accepts external input mailbox messages
- maps them to workflow runtime variables
- starts a new workflow execution or resumes a compatible existing execution

This preserves the current direct execution feature, but places it behind the
same mailbox boundary as other consumers.

### Supervisor Consumer

The supervisor consumer is the preferred owner for interactive event sources.

Responsibilities:

- consume external input mailbox messages
- determine whether the message means `start`, `input`, `status`, `stop`, or
  `restart`
- own correlation, lifecycle, and progress policy for the active run
- publish control/progress/business outputs back through the external output
  mailbox

For interactive sources, the supervisor should be treated as the primary owner
of external mailbox consumption.

## Output Types

External output mailbox publication must distinguish at least these categories:

- business final output
- progress output
- control/status output

They must not be conflated.

### Business Final Output

Business final output is runtime-owned and sourced from the workflow, not from
provider-specific reply text.

Source rule:

- publish only from the latest succeeded `output`-kind node execution in the
  owning workflow execution

This keeps final external publication aligned with the existing runtime-owned
workflow output rule.

### Progress Output

Progress is not "all step responses". It is status derived from runtime
execution state.

Recommended progress sources:

- workflow session status
- current step id
- node execution lifecycle changes
- waiting-for-user-input states
- supervisor lifecycle transitions

Recommended first policy:

- `progress.mode = "none" | "status-only"`

`status-only` should publish short provider-neutral progress messages such as:

- workflow started
- current step changed
- waiting for user input
- workflow completed
- workflow failed

Progress publication should be owned by the runtime or supervisor, not by
arbitrary manager or worker payloads.

### Control/Status Output

Supervisor control replies such as:

- started
- already running
- skipped
- failed to execute command
- current run status

are separate from workflow business output.

They should be modeled as control/status external output messages, not as the
workflow's final output payload.

## Reply Policy

Workflow business reply policy should be separate from progress/control policy.

Recommended first policy:

- `reply.mode = "none" | "final"`

Definitions:

- `none`: do not bridge workflow business output back to the provider
- `final`: bridge the latest succeeded `output`-kind node result once when the
  workflow reaches a terminal state

This policy belongs to the event binding or its execution policy, because it is
transport behavior. It should not be modeled as a bare workflow-level field in
`workflow.json`.

## Synchronous Provider Acknowledgement

Webhook acknowledgement is separate from external output publication.

Rules:

- provider adapters should acknowledge accepted inbound webhook delivery as soon
  as receipt, validation, and durable event recording are complete
- synchronous HTTP responses should not wait for final workflow output unless an
  explicitly unsafe local-only policy opts into that behavior
- final business output, progress, and control/status replies should normally be
  delivered through outbound external output messages

This preserves low-latency webhook handling while still allowing chat and web
app integrations to receive later replies through the same provider transport.

## Security And Data Ownership

Provider adapters must not receive direct access to canonical workflow
communication directories or node artifact roots.

Rules:

- adapters receive normalized input and provider-neutral output messages
- provider credentials stay in source configuration or runtime secret handling
- raw provider payloads are stored as artifacts and referenced by `rawRef`
- output delivery adapters may format provider text, but must not rewrite the
  canonical external output payload
- external mailbox consumers validate authorization through binding id,
  source id, and resolved correlation or workflow execution identity
- a provider-originated message cannot target an arbitrary workflow execution
  unless the binding policy and correlation rules authorize that target

This keeps event-source integration from becoming an alternate workflow control
plane with weaker authorization than GraphQL or library APIs.

## Why This Is Simpler

This design simplifies the event layer because adapters only need to know:

- how to receive provider events
- how to normalize them
- how to deliver provider-neutral outbound messages

Adapters do not need to know:

- how workflows are started internally
- how supervisors correlate runs
- how final output is selected
- how progress is computed

That logic remains in runtime-owned consumers of the external mailbox boundary.

## Persistence And Auditability

External mailbox traffic should remain part of the same auditable communication
model used elsewhere in the runtime.

Implications:

- inbound event ingestion persists an external input communication
- outbound reply/progress/control publication persists an external output
  communication
- provider delivery attempts remain runtime-recorded side effects, not hidden
  adapter-local behavior

This preserves deterministic inspection and replay better than a model where
adapters directly invoke workflow starts and independently post replies.

Recommended persistence mapping:

- inbound event receipt records source acceptance, dedupe, normalization, and
  mapping status
- external input communication records the accepted message delivered to a
  direct or supervisor consumer
- external output communication records business-final, progress, or
  control/status publication intent
- provider reply dispatch records delivery attempts and provider message ids

The runtime may keep these as separate tables plus communication artifacts, but
inspection should present them as one external mailbox timeline.

## Relationship To Existing Event Specs

`design-docs/specs/design-event-listener-workflow-trigger.md` describes the
current direct-trigger architecture and remains useful as the implementation
baseline.

This document updates the architectural direction:

- event source bindings should be understood as bridges to the external mailbox
  boundary
- direct workflow starts are an implementation of one external-input consumer,
  not the fundamental event abstraction
- supervisor control is the preferred external-input consumer for interactive
  event sources

## Migration Direction

Short term:

- existing direct trigger runner and supervisor router can remain in place
- reply and progress hardening should avoid deepening direct adapter-to-engine
  coupling
- existing runtime-owned external input/output communication helpers in
  `src/workflow/engine.ts` remain valid building blocks; the migration should
  converge event ingestion and event reply publication onto those concepts
  rather than replacing them abruptly

Medium term:

- refactor event binding semantics around external mailbox consumers and
  publishers
- treat provider reply dispatch as a transport adapter for external output
  mailbox messages
- converge supervisor control replies, progress messages, and final workflow
  output on one external output publication boundary

Implementation order should be conservative:

1. Add reply/progress/control policy fields without changing current default
   behavior.
2. Route final business replies through a runtime-owned publisher that selects
   the latest succeeded `output`-kind node.
3. Represent supervisor control replies as `control-status` external output
   messages.
4. Move inbound direct and supervised dispatch behind an external input message
   abstraction.
5. Collapse provider reply dispatch onto external output message delivery.

Implementation planning should treat steps 1-3 as the first bounded slice.
Steps 4-5 are a follow-up convergence slice because they cross event routing,
supervised control, runtime persistence, and provider dispatch seams at once.

## Design Review Notes

Important constraints surfaced during review:

- The phrase "mailbox binding" must not mean binding providers to
  execution-local node mailboxes.
- Direct workflow execution remains useful, but it should be modeled as one
  consumer of external input rather than the core event abstraction.
- Final workflow response and progress response require separate policies.
- Progress must be runtime-state derived; publishing all step responses would
  leak internal manager and worker payloads.
- Supervisor control/status replies are not workflow business output and need a
  distinct output kind.
- Synchronous webhook acknowledgement must remain independent from final output
  publication.

## References

- `design-docs/specs/design-node-mailbox.md`
- `design-docs/specs/design-event-listener-workflow-trigger.md`
- `design-docs/specs/design-event-supervisor-control.md`
- `design-docs/specs/architecture.md`
