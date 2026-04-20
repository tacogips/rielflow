# Node Add-on Catalog and Chat Reply Worker

This document defines an authored workflow add-on mechanism and the first
built-in add-on: a worker node that can reply to the chat event that started a
workflow.

## Overview

Workflow authors often need common nodes whose behavior is operational rather
than business-specific. A chat reply worker is one such node: it should take the
current workflow result, target the chat conversation from the triggering event,
and send a provider-neutral reply through the configured event source adapter.

Authors should be able to reference that node as a built-in add-on from
`workflow.json` without writing a `nodes/node-*.json` payload or maintaining
provider-specific reply code in each workflow.

The add-on mechanism is an authoring and resolution layer. It does not replace
node roles, `nodeType`, output contracts, or the runtime-owned mailbox model.

## Goals

- let `workflow.json.nodes[]` reference reusable built-in worker nodes
- keep add-on resolution deterministic, inspectable, and validation-friendly
- ship `divedra/chat-reply-worker` as a built-in worker add-on
- keep provider SDKs and credentials outside workflow bundles
- make chat replies runtime-owned and idempotent
- preserve authored workflow round-trips; save/edit surfaces should keep the
  add-on reference rather than expanding it into generated node JSON
- allow future external add-on distribution without designing network fetching
  into the first iteration

## Non-Goals

- turning workflow bundles into package manifests
- downloading third-party add-ons at workflow load time
- allowing arbitrary add-on code execution from a workflow definition
- adding Slack, Discord, Telegram, or web-chat fields to `workflow.json`
- replacing `user-action` nodes, which remain the mechanism for mid-run human
  replies and approvals
- replacing ordinary `nodeFile` payloads for custom business workers

## Authoring Model

`workflow.json.nodes[]` gains an alternative to `nodeFile`: `addon`.

```json
{
  "workflowId": "chat-answer",
  "description": "Answer a chat message and post the answer back to the thread.",
  "defaults": {
    "maxLoopIterations": 3,
    "nodeTimeoutMs": 120000
  },
  "entryNodeId": "answer",
  "nodes": [
    {
      "id": "answer",
      "role": "worker",
      "nodeFile": "nodes/node-answer.json"
    },
    {
      "id": "reply",
      "role": "worker",
      "addon": {
        "name": "divedra/chat-reply-worker",
        "version": "1",
        "config": {
          "textTemplate": "{{inbox.latest.output.payload.text}}",
          "visibility": "public"
        }
      }
    }
  ]
}
```

Rules:

- a node reference must provide exactly one of `nodeFile` or `addon`
- `addon` may be a string shorthand for the latest compatible built-in major
  version, but saved workflows should use the object form with an explicit
  `version`
- add-on nodes still participate in normal node ordering, edges, loops,
  completion rules, and role validation
- add-on nodes must declare `role: "worker"` unless a future add-on descriptor
  explicitly allows manager resolution
- manager nodes must not use add-ons in the first iteration
- an add-on reference is part of authored workflow JSON; it is not copied into a
  `nodes/node-*.json` file during normal save/edit round-trips

## Add-on Descriptor

Each add-on is defined by a descriptor owned by the runtime build.

```typescript
interface BuiltinNodeAddonDescriptor {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly allowedRoles: readonly ["worker"];
  readonly configSchema: JsonSchemaObject;
  readonly execution:
    | { readonly kind: "node-payload-template" }
    | { readonly kind: "native-addon-executor"; readonly executor: string };
  readonly output: NodeOutputContract;
}
```

The descriptor may also contain an internal payload template, prompt template,
or native executor binding. Those implementation details are not authored in
workflow bundles.

Descriptor rules:

- `name` is namespaced; built-ins use the `divedra/` prefix
- `version` is a catalog version, not a provider model version
- major versions are compatibility boundaries
- `configSchema` validates `addon.config` before the workflow can execute
- descriptor resolution must produce one effective node payload with the
  authored node id overlaid onto the descriptor template
- descriptor templates must not be allowed to change graph structure; they
  produce only the payload for the single referenced node
- native add-on executors may appear in the normalized runtime shape as
  add-on execution metadata, but authored node payloads should not write that
  internal executor binding directly in the first iteration

## Loader and Validation Flow

Add-on resolution belongs between workflow JSON validation and runtime bundle
normalization:

1. Load authored `workflow.json`.
2. Validate each `WorkflowNodeRef` has exactly one source: `nodeFile` or
   `addon`.
3. Resolve `addon.name` and `addon.version` from the built-in catalog.
4. Validate `addon.config` against the descriptor schema.
5. Materialize an effective node payload in memory for execution,
   inspection, and validation.
6. Mark the payload provenance as add-on resolved metadata.

The normalized runtime bundle should expose enough metadata for inspection:

```json
{
  "nodeId": "reply",
  "source": {
    "kind": "builtin-addon",
    "name": "divedra/chat-reply-worker",
    "version": "1"
  }
}
```

Persistence rules:

- runtime execution artifacts should include the resolved descriptor identity in
  `meta.json`
- final `output.json` and mailbox outputs stay ordinary node outputs
- workflow save/edit APIs preserve `addon` references and do not write generated
  `nodeFile` payloads unless an explicit future `workflow vendor-addon` command
  asks for that

## Built-in `divedra/chat-reply-worker`

### Purpose

`divedra/chat-reply-worker` sends a reply to the chat conversation associated
with `runtimeVariables.event`.

It is intended for workflows started by chat-like event sources such as:

- `chat.message`
- `chat.mention`
- `chat.command`
- web-chat messages

The add-on is still valid in non-chat test runs, but it should complete in
`dry-run` or `intent-only` mode rather than attempting provider dispatch when no
reply target exists.

### Resolved Node Behavior

The add-on resolves to a runtime-owned native worker executor. The direct
authored `nodeType` surface does not need a provider-specific value; internally
the descriptor binds the node to the chat reply add-on executor. The normalized
runtime payload may use an internal add-on execution binding, but workflow
authors should continue to use `workflow.json.nodes[].addon`.

The executor:

1. reads the execution-local inbox contract
2. renders `config.textTemplate` against the normal node template context
3. extracts provider-neutral reply target metadata from
   `runtimeVariables.event`
4. creates a deterministic `ChatReplyRequest`
5. dispatches the request through the event reply adapter registry
6. writes a normal runtime-owned node output envelope

The workflow engine should depend only on a small reply dispatch interface. The
provider adapter implementation remains in the event layer, not in
`src/workflow/`.

### Configuration

Initial config:

```typescript
interface ChatReplyWorkerConfig {
  readonly textTemplate: string;
  readonly visibility?: "public" | "ephemeral";
  readonly threadPolicy?: "same-thread" | "conversation-root";
  readonly onMissingTarget?: "fail" | "intent-only" | "dry-run";
}
```

Defaults:

- `visibility`: `"public"`
- `threadPolicy`: `"same-thread"`
- `onMissingTarget`: `"fail"` during normal execution and `"dry-run"` when the
  workflow run is explicitly using a mock scenario

Validation rules:

- `textTemplate` is required and must render to a non-empty string
- `visibility: "ephemeral"` is accepted only when the source adapter declares
  ephemeral replies are supported
- provider-specific formatting fields are intentionally omitted from the first
  version

### Reply Target Metadata

The event trigger layer should expose reply target data in
`runtimeVariables.event`.

Provider-specific event adapters normalize their incoming data into a
provider-neutral shape:

```typescript
interface EventReplyTarget {
  readonly sourceId: string;
  readonly provider: string;
  readonly eventId: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly actorId?: string;
  readonly capabilities?: readonly ChatReplyCapability[];
}
```

Rules:

- credentials, channel secrets, and webhook signing data are never copied into
  `runtimeVariables.event`
- adapters may store provider raw payloads as event artifacts and expose only
  stable references
- missing reply target metadata is a configuration/runtime error unless
  `onMissingTarget` allows intent-only or dry-run behavior

### Reply Request

The executor submits this provider-neutral request:

```typescript
interface ChatReplyRequest {
  readonly target: EventReplyTarget;
  readonly message: {
    readonly text: string;
  };
  readonly visibility: "public" | "ephemeral";
  readonly idempotencyKey: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
}
```

The idempotency key must be stable for the node execution. A retry of the same
node execution must not post duplicate chat messages.

### Output Contract

The add-on publishes an ordinary node output payload:

```json
{
  "reply": {
    "status": "sent",
    "target": {
      "sourceId": "web-chat",
      "provider": "web-chat",
      "conversationId": "thread-123"
    },
    "message": {
      "text": "The workflow result is ready."
    },
    "providerMessageId": "msg-456",
    "dispatchId": "reply-789"
  },
  "when": {
    "replied": true
  }
}
```

Allowed `reply.status` values:

- `sent`: provider dispatch completed successfully
- `queued`: provider adapter accepted the request for asynchronous delivery
- `intent-only`: the node produced a reply intent but did not dispatch it
- `dry-run`: no provider dispatch was attempted

Failure rules:

- provider rejection fails the node unless a future config explicitly allows
  best-effort replies
- an invalid rendered message fails the node
- duplicate dispatch for the same idempotency key must return the original
  dispatch result when the adapter can determine it

## Event Layer Responsibilities

The event layer owns provider reply dispatch.

Required service boundary:

```typescript
interface EventReplyDispatcher {
  dispatchChatReply(request: ChatReplyRequest): Promise<ChatReplyDispatchResult>;
}
```

Responsibilities:

- route by `target.sourceId` to the configured event source adapter
- enforce source adapter capabilities
- apply credentials and provider-specific endpoint details from event source
  configuration, not workflow JSON
- persist reply receipts for audit and idempotency
- normalize provider response metadata into `ChatReplyDispatchResult`

The chat reply worker add-on consumes that interface. It does not import Slack,
Discord, Telegram, or web-chat SDKs directly.

## Security and Supply Chain

First iteration rules:

- only built-in `divedra/*` add-ons are resolvable
- no network access occurs during workflow load or validation
- unknown add-on names fail validation
- add-on descriptors are part of the installed runtime and are covered by the
  same release integrity model as the rest of `divedra`
- external add-on registries, package downloads, and lockfiles are future work

Future external add-on support must require:

- an explicit add-on lockfile with resolved package identity and integrity
- no install scripts by default
- a local cache populated by an explicit operator command
- descriptor schema validation before any executable payload is trusted

## Compatibility

Existing workflows using `nodeFile` continue unchanged.

Add-on nodes are additive:

- authored `nodeFile` nodes remain the default
- normalized runtime payloads can use the same execution, output validation, and
  artifact publication paths as ordinary nodes
- GraphQL and TUI surfaces should display add-on provenance alongside node type
  and role
- examples can introduce add-on usage without changing existing bundle layout

## Test Expectations

The implementation should cover:

- validation rejects a node reference with both `nodeFile` and `addon`
- validation rejects a node reference with neither `nodeFile` nor `addon`
- validation rejects unknown built-in add-on names and unsupported versions
- validation rejects invalid chat reply add-on config
- loader materializes an effective payload with the authored node id
- workflow save/edit preserves the authored `addon` reference
- chat reply worker renders text from upstream output
- chat reply worker fails when no reply target exists and `onMissingTarget` is
  `fail`
- chat reply worker emits `intent-only` or `dry-run` output when configured
- reply dispatch is idempotent across node retry/resume
- provider-specific adapter code stays outside `src/workflow/`

## References

- `design-docs/specs/design-event-listener-workflow-trigger.md`
- `design-docs/specs/design-node-execution-inbox-contract.md`
- `design-docs/specs/design-node-output-contract.md`
- `design-docs/specs/design-workflow-json.md`
