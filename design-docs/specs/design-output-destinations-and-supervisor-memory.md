# Output Destinations and Supervisor Memory

This document defines the missing outbound half of event supervision: output destinations, supervisor-managed routing, and node memory/persona contracts.

## Overview

Event sources are inbound adapters. Output destinations are outbound adapters. A supervisor can bind a source event, workflow result, progress message, or control status to destination ids without making the inbound source own outbound policy.

Workflow output mail remains internal step execution data. It is the runtime's
record of node outputs and routed in-graph communication, not the asynchronous
delivery surface for event integrations. External delivery starts only when the
runtime or supervisor constructs an explicit `external-output` publication and
hands that publication to the output-destination publisher.

The near-term implementation keeps runtime behavior compatible by modeling the current chat reply path as a `chat` destination backed by the source adapter. Future destination kinds, such as S3 backup or webhook callback, plug into the same outbound interface after the publisher grows delivery fanout.

## Technical Details

### Destination Configuration

Destination files live under `<eventRoot>/destinations/*.json`:

```json
{
  "id": "example-chat",
  "kind": "chat",
  "sourceId": "example-reply-webhook"
}
```

Bindings can name destinations explicitly:

```json
{
  "id": "webhook-to-chat-reply",
  "sourceId": "example-reply-webhook",
  "outputDestinations": ["example-chat"]
}
```

When a binding omits `outputDestinations`, the effective reply destination defaults to the source-backed chat destination when the source adapter supports chat replies.

Destination ids are outbound routing hints, not event-source aliases. A `chat` destination may reference a source adapter only as a transport bridge until chat providers have independent destination adapters.

Chat destinations may optionally pin a provider-side target:

```json
{
  "id": "architect-supervisor-chat",
  "kind": "chat",
  "sourceId": "supervisor-chat",
  "target": {
    "conversationId": "architect-supervisor",
    "threadId": "spec-brainstorm"
  }
}
```

Matrix chat destinations use the same `chat` destination kind. The Matrix
transport is selected by the referenced source adapter:

```json
{
  "id": "release-matrix-chat",
  "kind": "chat",
  "sourceId": "team-matrix",
  "target": {
    "provider": "matrix",
    "conversationId": "!release-room:example.org"
  }
}
```

When `target` is omitted, the destination replies to the inbound event conversation. When `target` is set, the destination addresses another chat conversation, which allows supervisor workflows to communicate with each other through normal event/destination plumbing.

The current foundation resolves chat delivery targets as follows:

1. Prefer an explicit `outputDestinationId`.
2. Otherwise scan `outputDestinationIds` in order and fan out sequentially to every enabled `chat` destination.
3. Otherwise select an enabled `chat` destination whose `sourceId` matches the inbound target source.
4. Otherwise fall back to the inbound source target for compatibility.

Non-chat destinations, including `s3-backup`, are config and validation foundation only in this iteration. They may appear in `outputDestinations`, but they do not receive payloads until a future non-chat publisher implements retry and destination-specific delivery semantics.

### Supervisor Routing

Supervisor event handling is deterministic:

1. For `structured-only`, read `event.input.action` and reject unknown or disallowed actions.
2. For `structured-or-command`, prefer `event.input.action`; otherwise use the configured default action.
3. For `command-map`, read the configured text path, split by spaces/tabs, and match only the first token against configured command aliases.
4. If deterministic `command-map` parsing does not recognize the first token and a resolver is configured, call the command-analysis node as a bounded fallback.
5. For `llm-command`, require async resolution through the configured resolver workflow and node.

The supervisor remains the owner of command/event handling. LLM calls may classify ambiguous text or select task-routing proposals, but they do not own listener lifecycle, destination selection, receipt updates, or control action execution.

External outputs carry `eventOutputDestinations` through runtime variables into business-final, progress, control-status, supervisor-dispatch, and chat-reply worker dispatch paths. Chat delivery fans out across enabled chat destinations when a destination list is present. Fanout is sequential to preserve authored destination order and stable audit behavior.

For Matrix-backed chat destinations, the output publisher should pass the same
provider-neutral `ChatReplyDispatchRequest` contract to the Matrix source
adapter. The destination layer resolves the source and target only; Matrix
message formatting, access-token lookup, transaction id construction, and
Client-Server API calls stay inside the Matrix adapter. Reply dispatch records
must persist the destination id, provider message id or event id, status, and
redacted request metadata without storing access tokens or authorization
headers.

The provider-neutral target passed to Matrix must retain enough context for
idempotent replies: source id, provider, Matrix room id as `conversationId`,
optional inbound event id, optional thread id, and the reply idempotency key.
Adapters may derive provider transaction ids from that idempotency key, but the
publisher must not pre-format Matrix relation payloads or expose Matrix-specific
request bodies outside the adapter boundary.

### Chat Task Lifecycle Replies

A chat-originated task should feel conversational without making chat transport part of workflow execution:

1. The event runner acknowledges the mapped request with a `progress` external-output message.
2. Before dispatching the workflow or supervisor route, the runner emits a second `progress` external-output message indicating that execution is starting.
3. Supervisor command results are emitted as `control-status` external-output messages.
4. Workflow business results are emitted as `business-final` external-output messages after the runtime selects the accepted output-kind node payload.

The default mailbox bridge policy enables `progress.status-only` so chat sources receive natural lifecycle replies unless the binding opts out with `mailboxBridge.output.progress.mode: "none"`.

Read-only event runs never publish progress, control, or final external outputs. They may map and persist receipt/input diagnostics, but provider-facing delivery is suppressed before any progress acknowledgement is sent.

### Supervisor-To-Supervisor Chat

Multiple workflow supervisors can collaborate by using chat destinations as addressable external peers. For example:

- Workflow A and Workflow B receive the same brainstorm task through a shared chat source.
- Each supervisor uses its persona/system prompt and memory context to produce role-specific ideas.
- Their outputs are delivered to a chat destination whose target conversation is watched by Workflow C.
- Workflow C converts the discussion into a specification and implementation plan, runs implementation, and publishes review requests back to the Workflow A and Workflow B destinations.

This pattern intentionally uses external-output messages and event receipts. A supervisor does not read another supervisor's internal output mail directly; it observes provider-neutral chat events produced through configured destinations.

### Internal Output Mail vs External Output Publication

There are two separate output surfaces:

- **Workflow output mail**: internal execution data written under node artifacts
  and routed communications. Workers and managers use this for step-to-step
  data flow, review gates, final selected workflow output, and audit. Event
  adapters must not treat these files as outbound delivery requests.
- **External output publication**: a runtime-owned message with
  `kind: "external-output"`, an `outputKind`, an address, payload,
  idempotency key, and destination context. Output destinations consume this
  publication contract, not arbitrary node mailbox files.

Business-final event output is therefore a derived publication: after the
workflow reaches a terminal state, the runtime selects the latest succeeded
`output`-kind node execution, reads its accepted payload, wraps that payload in
a `business-final` external-output message, and publishes it through the
destination publisher when the binding reply policy allows delivery.

Supervisor-generated chat replies are also explicit publications. A supervisor
control reply, dispatch reply, or chat-reply worker request must produce a
provider-neutral external-output or chat-dispatch request that carries
`outputDestinationIds`. It must not rely on the presence of upstream output mail
as an implicit binding to a provider reply.

The compatibility fallback to an inbound source-backed chat target is a
transport bridge only. It preserves existing behavior when no destination id is
configured, but it is not the primary contract for new event integrations.

Matrix should follow the explicit destination contract whenever examples or
bindings can name a destination. The inbound source-backed fallback remains
valid for simple chat-reply-worker flows, but new Matrix examples should include
an explicit `chat` destination so receive and send behavior are independently
inspectable.

### Matrix Local Sample Reply Verification

The Matrix send/receive sample should verify outbound delivery through the
normal destination publisher and Matrix source adapter boundary. It should not
special-case Matrix sends inside the workflow or script around the
`divedra/chat-reply-worker` add-on.

The expected local sample mapping is:

- source: `examples/event-sources/.divedra-events/sources/team-matrix.json`
- binding:
  `examples/event-sources/.divedra-events/bindings/matrix-release-chat-to-workflow.json`
- destination:
  `examples/event-sources/.divedra-events/destinations/release-matrix-chat.json`
- workflow: `examples/chat-reply-webhook`
- live verification root: `examples/event-sources/matrix/`

The verification should assert that a Matrix reply dispatch record is written
with `destinationId = "release-matrix-chat"`, `provider = "matrix"`, and a sent
status or provider event id from the local Synapse server. The record may include
redacted request metadata, destination id, source id, conversation id, and
idempotency key. It must not persist Matrix access tokens, authorization
headers, generated local passwords, or raw response bodies that could contain
credentials.

If live verification exposes a Matrix send or receive bug, fix the shared
Matrix adapter or reply dispatcher so the example and production path continue
to use the same code. Do not introduce an example-only send path.

### External Output Kinds

External output publications use distinct kinds so runtime behavior and
provider delivery policy stay explicit:

- `business-final`: runtime-selected workflow business result from an
  `output`-kind node execution.
- `control-status`: supervisor-owned lifecycle, command, or dispatch status
  reply, including supervisor-generated chat replies.
- `progress`: runtime or supervisor status updates, including request received
  and execution starting lifecycle replies for chat-originated tasks.

Output destinations are destination-owned delivery decisions for these
publications. They are not alternate names for workflow output mail, and they do
not grant event adapters read or write access to execution-local mailbox paths.

### Node Attachment Contract

Workflow nodes may declare event attachments later without owning listener lifecycle:

```typescript
interface WorkflowNodeEventAttachment {
  eventSourceIds?: readonly string[];
  outputDestinationIds?: readonly string[];
}
```

For now, supervisor nodes are the primary owner of external event routing. Ordinary workflow nodes receive event and destination context as runtime variables and may publish through the runtime-owned output publisher. Node attachments are declarations of required context, not permission for a node to start listeners or bypass the event receipt model.

### Memory and Persona

Long-term memory is a node-level service behind an abstract interface:

```typescript
interface NodeLongTermMemoryStore {
  read(scope: NodeMemoryScope): Promise<readonly NodeMemoryRecord[]>;
  write(record: NodeMemoryWrite): Promise<NodeMemoryRecord>;
}
```

Concrete stores are swappable. Initial implementations may be local file or runtime database backed. Persona is configured as a node or supervisor profile system prompt and is passed to LLM-backed command-analysis and task-routing nodes.

The foundation adds only contract types for memory and persona. No runtime component should assume durable memory exists unless a concrete `NodeLongTermMemoryStore` is configured.

## Codex Reference Mapping

This output-destination foundation previously used the local `../../codex-agent`
repository as a behavioral reference only:

- `../../codex-agent/src/types/rollout.ts` shows discriminated event message contracts with generic fallback for unknown event types.
- `../../codex-agent/src/sdk/agent-runner.ts` shows normalized stream events separated from raw session messages.
- `../../codex-agent/src/queue/runner.ts` is a reference for deterministic runner-owned progress emission.
- `../../codex-agent/design-docs/specs/design-codex-session-management.md` is a reference for session event persistence boundaries.

Divedra intentionally diverges by routing external event outputs through repository-local event adapters, runtime receipts, and workflow/supervisor contracts instead of mirroring Codex CLI session streams directly.

The Matrix send/receive sample issue has no Codex-reference input. Step 4 should
therefore treat the repository-local event-source and output-destination design
as the implementation source of truth, keep `codexAgentReferences` empty, and
avoid introducing new codex-agent or Cursor-specific adapter behavior for this
scope.

## Review Decisions

- Keep `workflowMode` as `issue-resolution`; this scope requires checked-in
  Matrix send/receive sample assets and Docker Compose local Synapse
  verification, not a documentation-only handoff.
- Keep this as a single design path because the Matrix receive binding,
  explicit chat destination, chat reply worker, and Matrix reply dispatch share
  the same event-source and output-destination boundaries.
- Preserve deterministic supervisor ownership. LLM-backed analysis remains an explicit resolver path for ambiguous commands or task routing.
- Treat `s3-backup` destinations as unrelated existing foundation scope; the
  current issue should not expand non-chat delivery behavior.
- Treat earlier completed Matrix foundation plans as historical context only.
  They do not close this issue, because Step 4 must still plan the Matrix
  sample workflow/config/scripts/docs and live Docker Compose verification.
- Treat workflow output mail as internal execution data only. Supervisor chat
  replies and workflow business-final event outputs must be modeled as explicit
  external-output publications before any destination delivery occurs.

## Scope Boundaries

This foundation adds config, validation, examples, runtime variable propagation, chat fanout, lifecycle progress replies, targetable chat destinations, and a dispatch abstraction. It does not yet implement S3 backup delivery, durable LLM conversation memory, or full node-authored destination publication.

The foundation also does not reinterpret node outbox or workflow output mail as
external delivery queues. Any future publisher expansion must continue to accept
explicit external-output messages and persist provider delivery attempts as
runtime-owned side effects.

## Verification Commands

```bash
sed -n '1,260p' design-docs/specs/design-output-destinations-and-supervisor-memory.md
sed -n '1,320p' impl-plans/completed/output-destinations-supervisor-memory-foundation.md
rg -n "EventOutputDestination|outputDestinations|eventOutputDestinations|NodeMemory|persona|dispatchChatReply" src/events src/workflow examples/event-sources -S
test -d ../../codex-agent && test -f ../../codex-agent/src/types/rollout.ts && test -f ../../codex-agent/src/sdk/agent-runner.ts
bun test src/events/config.test.ts src/events/reply-dispatcher.test.ts src/events/trigger-runner.test.ts src/events/mailbox-bridge-policy.test.ts
bunx tsc --noEmit
```

## References

See `design-docs/specs/design-event-supervisor-control.md` and `design-docs/specs/design-event-external-mailbox-binding.md`.
