# Node Message Transport Design

This document defines manager-owned node-to-node communication inside a
workflow execution.

## Overview

SQLite `workflow_messages` is the canonical transport store for communication
creation, reads, replay, retry, consumption, GraphQL inspection, and manager
mutation scope checks. The historical file-backed mailbox transport is removed
for new runtime behavior. Runtime code must not fall back to
`communications/...`, `inbox/input.json`, `outbox/output.json`, or
`RIEL_MAILBOX_DIR` for message delivery.

Design goals:

- persist every routed workflow message as one SQLite row
- keep manager-mediated delivery and retry semantics explicit
- avoid direct worker-to-worker transport
- keep sender output production separate from downstream message publication
- preserve non-message file and binary handoff through `RIEL_ATTACHMENT_ROOT`
  descriptors only

The manager that owns the recipient scope is the only actor allowed to route a
message. Worker nodes consume runtime-resolved execution input and return
candidate output through their backend adapter or native executor. Workers do
not poll transport storage or publish downstream messages directly.

Role taxonomy:

- `manager node` (control-plane role): orchestrates routing, reads and writes
  `workflow_messages`, and owns delivery/retry state for its workflow execution
- `worker node` (data-plane role): executes task/input/output/judge work and
  never reads or writes transport storage directly
- every runtime component must classify behavior by this role taxonomy, not by
  whether the component happens to execute as a "node"

## Scope

This design applies to:

- node-to-node message delivery inside one `workflowExecutionId`
- handoffs from a caller execution to a separate child workflow execution
- re-execution of a workflow
- re-delivery caused by retrying a message-consuming node execution
- re-sending caused by rerunning a message-producing node path

This design does not introduce:

- direct worker node transport
- one global shared mailbox tree across independent workflow executions
- mutable in-place message edits after delivery
- file-backed compatibility for message input or output

## Identifier Model

Transport storage and retry tracking use these identifiers:

- `workflowId`: stable identifier from `workflow.json.workflowId`
- `workflowExecutionId`: unique identifier for one workflow run
- `nodeExecId`: unique identifier for one node execution inside a workflow run
- `communicationId`: unique identifier for one routed send event inside a
  workflow run
- `deliveryAttemptId`: unique identifier for one concrete recipient-delivery
  attempt for a communication
- `agentSessionId`: manager-local identifier for one concrete AI/code-agent
  runtime session, used only when a recipient attempt is AI/code-agent based

Allocation authority:

- the root workflow manager for a `workflowExecutionId` owns monotonic
  `communicationId` allocation for that run
- each manager owns local `deliveryAttemptId` allocation for attempts it
  executes
- each manager owns local `agentSessionId` allocation for worker sessions it
  starts
- one `communicationId` targets exactly one sender and one recipient
- fan-out to multiple downstream nodes creates one `communicationId` per
  recipient
- a send re-execution allocates a new `communicationId`
- delivery retry for an already-created send keeps the same `communicationId`
  and advances `deliveryAttemptId`

Allocator durability contract:

- `communicationId` allocation must be linearizable per
  `workflowExecutionId`
- allocation must be persisted before inserting the corresponding
  `workflow_messages` row
- burned ids must not be reused
- recovery resumes from the maximum persisted communication sequence in
  `workflow_messages` and any allocator state table/log used by the runtime

## SQLite Transport Row

Each routed send is represented by one canonical row in
`workflow_messages`.

The row stores:

- route identity: `workflow_id`, `workflow_execution_id`,
  `communication_id`, `from_node_id`, `to_node_id`, `routing_scope`,
  `delivery_kind`, `transition_when`
- execution identity: `source_node_exec_id`, `manager_message_id`
- lifecycle state: `status`, `active_delivery_attempt_id`,
  `delivery_attempt_ids_json`, `delivered_at`, `consumed_by_node_exec_id`,
  `consumed_at`, `failure_reason`, `superseded_by_communication_id`,
  `superseded_at`, `replayed_from_communication_id`
- payload references: `payload_ref_json`, `payload_json`,
  `artifact_refs_json`, `artifact_dir`
- timestamps: `created_at`, `updated_at`

Rules:

- if a row is absent, the communication is absent
- inbound reads filter by `to_node_id`
- outbound reads filter by `from_node_id`
- replay creates a new communication row
- retry updates delivery-attempt state on the existing row
- no file or binary body is stored in SQLite
- file and binary payloads are represented by attachment-root-relative
  descriptors under `RIEL_ATTACHMENT_ROOT`
- new code must not create message files as a required transport artifact
- old file-backed message artifacts may remain on disk as historical artifacts,
  but canonical runtime behavior ignores them

See `design-docs/specs/design-sqlite-message-store.md` for schema, root, JSON
validation, attachment, and migration rules.

## Delivery Flow

1. Sender node execution finishes and the runtime publishes its final
   runtime-owned node `output.json` artifact.
2. The manager evaluates legal transitions and chooses downstream recipients.
3. The manager allocates a `communicationId` for each recipient.
4. The runtime snapshots the accepted business payload and any safe attachment
   descriptors.
5. The runtime inserts the `workflow_messages` row.
6. Delivery is successful only after the SQLite write succeeds.
7. When the recipient is ready to execute, the runtime resolves its input object
   from SQLite-backed upstream messages, runtime variables, workflow input, and
   manager messages.
8. The backend adapter or native executor passes that resolved input through a
   non-mailbox process/API boundary.
9. After accepted recipient output, downstream messages repeat this flow.

Crash recovery and retry operate on SQLite state, not on required message file
sets. Status transitions must be idempotent and must not infer successful
delivery from the presence of `outbox/output.json` or other legacy mailbox
files.

## Write Ownership

Write permissions by component:

- worker node execution:
  - may write only backend-local candidate data through the runtime-approved
    result channel
  - never writes transport inboxes or outboxes
  - never writes another node's transport state
  - never polls or scans canonical communications directories directly
  - never uses `RIEL_MAILBOX_DIR` as a message input/output contract
- root workflow manager:
  - owns global communication allocation for the workflow execution
  - owns delivery-attempt allocation for attempts it executes
  - inserts and updates `workflow_messages`
  - resolves SQLite messages into recipient execution input
  - records consumed state after recipient execution is bound

This ownership rule is mandatory for auditability and to prevent accidental
peer-to-peer coupling between worker nodes.

## Re-Execution Semantics

Workflow re-execution allocates a new `workflowExecutionId`; message state from
a prior workflow execution remains immutable and is not reused in place.

Terminology:

- `delivery retry`: re-attempting delivery/execution for an already-created
  send event
- `send re-execution`: generating a node-to-node send again from workflow logic
  or operator action

Identity rules:

- every send re-execution allocates a new `communicationId`
- one `communicationId` may have multiple recipient execution attempts, each
  with a distinct recipient `nodeExecId`
- a delivery retry that launches a new recipient execution attempt allocates a
  new `nodeExecId` and `deliveryAttemptId`, while keeping the same
  `communicationId`
- a worker-process restart inside the same recipient execution attempt keeps
  the same `deliveryAttemptId` and may allocate a new `agentSessionId`

## Relationship To Node Execution I/O

`workflow_messages` is the transport layer. It is not exposed as a file mailbox
ABI for workers.

The layering is:

1. managers route communications through `workflow_messages`
2. runtime resolves those communications into one node execution input object
3. adapters/native executors deliver the input through backend-specific
   non-mailbox boundaries
4. workers return candidate output through backend-specific result channels
5. runtime validates, publishes node artifacts, and inserts downstream
   `workflow_messages` rows

The worker-facing contract is described in
`design-docs/specs/design-node-execution-inbox-contract.md`.

## Validation

Regression coverage must prove:

- new message publication writes `workflow_messages` before delivery succeeds
- inbound and outbound reads use `workflow_messages` only
- replay and retry mutate SQLite state according to the identity rules above
- deleting legacy message files does not hide existing SQLite communications
- adding legacy `communications/...`, `inbox/input.json`, or
  `outbox/output.json` files does not create a communication
- command, container, add-on, and agent execution do not require
  `RIEL_MAILBOX_DIR` for message input or output
- file and binary attachments still materialize only under
  `RIEL_ATTACHMENT_ROOT` and are referenced by safe relative descriptors

## References

- `design-docs/specs/design-sqlite-message-store.md`
- `design-docs/specs/design-node-execution-inbox-contract.md`
- `design-docs/specs/design-node-output-contract.md`
