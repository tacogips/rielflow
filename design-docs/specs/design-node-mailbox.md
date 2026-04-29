# Node Mailbox Design

This document defines the file-based mailbox mechanism for node-to-node communication inside a workflow execution.

## Overview

The runtime introduces a mailbox artifact layer for routed node communication.

Design goals:
- file-based and auditable
- deterministic replay across workflow re-execution
- no direct worker-to-worker transport
- clear separation between sender output production and manager-mediated delivery

The manager that owns the recipient scope is the only actor allowed to write recipient inboxes.
Worker nodes do not read canonical cross-node mailbox directories directly; they consume runtime-materialized execution-local inbox data and write execution-local outputs. Container executions may receive a runtime-prepared node-local mailbox view, but that view must not grant direct write access to canonical routed communication artifacts.

Role taxonomy:
- `manager node` (control-plane role): orchestrates routing, reads mailbox entries addressed to itself, and writes mailbox artifacts for its owned scope
- `worker node` (data-plane role): executes task/input/output/judge work and never polls mailbox directories directly
- every runtime component must classify behavior by this role taxonomy, not by whether the component happens to execute as a "node"

## Scope

This design applies to:
- node-to-node message delivery inside **one** `workflowExecutionId` (one workflow graph run)
- handoffs from a caller execution to a **separate** child workflow execution (cross-workflow calls via step transitions: each side has its own `workflowExecutionId` and manager-owned mailbox root)
- re-execution of a workflow
- re-delivery caused by re-running a message-producing node path

The runtime does **not** model nested structural sub-workflows or a second in-graph “sub-workflow manager” role. A single root manager node (see `node-role` and step-addressed `managerStepId` / `entryStepId`) owns routed communication for that execution.

This design does not introduce:
- direct worker node transport
- one global shared mailbox tree across otherwise independent workflow executions
- mutable in-place message edits after delivery

## Identifier Model

Mailbox storage and retry tracking use these identifiers:

- `workflowId`: stable identifier from `workflow.json.workflowId`
- `workflowExecutionId`: unique identifier for one workflow run; a new id is assigned on each workflow re-execution
- `nodeExecId`: unique identifier for one node execution inside a workflow execution
- `communicationId`: unique identifier for one routed node-to-node send event inside a workflow execution; every re-executed/resubmitted send allocates a new id
- `deliveryAttemptId`: unique identifier for one concrete recipient-delivery attempt for a communication
- `agentSessionId`: manager-local identifier for one concrete AI/code-agent runtime session; used only when a recipient attempt is executed by an AI/code-agent worker

Allocation authority:
- the root workflow manager for a given `workflowExecutionId` owns the monotonic `communicationId` allocator for that run
- each manager owns local `deliveryAttemptId` allocation for attempts it executes
- each manager owns local `agentSessionId` allocation for worker sessions it starts
- global uniqueness is represented by `(allocatorNodeId, agentSessionId)` tuple scoped to one `workflowExecutionId`

Allocator durability contract (when allocator logs are in use for a deployment):
- `communicationId` allocation must be linearizable per `workflowExecutionId`
- allocation must be persisted before mailbox file creation (no "speculative id" reuse)
- durable allocator log (when enabled):
  - `{artifact-root}/{workflowId}/executions/{workflowExecutionId}/allocator/communication-id.log`
  - each record: `{ leaseId, allocatorEpoch, allocatedToManagerNodeId, blockStart, blockEnd, nextUnconsumed, status, allocatedAt }`
- root manager must persist allocator state in:
  - `{artifact-root}/{workflowId}/executions/{workflowExecutionId}/allocator/state.json`
  - fields: `{ allocatorEpoch, nextCommunicationSeq, updatedAt }`
- allocator leadership change must increment `allocatorEpoch`; stale leaders must not allocate further ids
- every block-allocation request must include caller-generated `requestId`; root manager must treat duplicate `requestId` as idempotent replay and return the same block
- a manager that holds a block must stop using that block if it observes a higher `allocatorEpoch` than the block's epoch (fencing)
- `nextUnconsumed` must be advanced durably each time an id from the block is consumed to create mailbox artifacts
- recovery after crash must resume from the maximum persisted `communicationId` in the allocator log
- if allocation is requested but mailbox files are never materialized, that `communicationId` remains burned and must not be reused
- monotonic ordering requirement applies to allocator-issued numeric sequence only; it does not require wall-clock monotonic mailbox creation order across different managers consuming leased blocks

Manager scoping rules:
- the workflow manager for a run routes deliveries among nodes in **that** `workflowExecutionId`
- a callable child workflow is a **new** `workflowExecutionId` under the callee's `workflowId`; parent-to-child work crosses executions at the child manager/entry-step boundary, not as inline nested sub-graph routing inside the parent bundle
- child-internal mailbox traffic after the child run starts stays under the child execution artifact root

## Mailbox Directory Layout

Mailbox artifacts are stored under the execution artifact root:

```text
{artifact-root}/{workflowId}/executions/{workflowExecutionId}/communications/{communicationId}/
  message.json
  meta.json
  attempts/
    {deliveryAttemptId}/
      attempt.json
      receipt.json
      [agent-session.json]
  inbox/
    {toNodeId}/
      message.json
  outbox/
    {fromNodeId}/
      message.json
      output.json
```

Path rules:
- one `communicationId` targets exactly one sender node and one recipient node
- for a cross-execution handoff, `toNodeId` names the **recipient** node at the handoff boundary (for example the callee's manager or entry step id) as resolved by the runtime for that call
- for parent-to-child-workflow invocation, the parent-side recipient is the child workflow entry/manager-step boundary; the child run materializes its own execution-local state from that handoff
- fan-out to multiple downstream nodes creates one `communicationId` per recipient
- `inbox/{toNodeId}` and `outbox/{fromNodeId}` are both required, even though the sender/recipient are also present in metadata; this keeps filesystem inspection simple
- `outbox/{fromNodeId}/output.json` is a manager-written immutable snapshot copy of the sender payload at send time
- mailbox artifacts that publish raw text payloads such as `outbox/{fromNodeId}/output.json` must use the same atomic temp-file-plus-rename persistence rule as JSON artifacts; partial in-place overwrites are not acceptable
- `inbox/{toNodeId}/message.json` is the delivered transport envelope; inbox does not duplicate `output.json`
- one send event maps to one `communicationId`
- retries allocate new `deliveryAttemptId` and/or `agentSessionId` under the same `communicationId` only when retrying delivery/execution of that already-created send event

Recommended id formats:
- `workflowExecutionId`: `wfexec-000001`
- `communicationId`: `comm-000001`
- `deliveryAttemptId`: `attempt-000001`
- `agentSessionId`: `agentsess-000001`

The exact encoding can change, but ordering must be monotonic for allocator-issued sequence values within one workflow execution (not wall-clock creation order across managers).

## Message Files

### `message.json`

Canonical message envelope:

```json
{
  "workflowId": "writing-session",
  "workflowExecutionId": "wfexec-000001",
  "communicationId": "comm-000014",
  "fromNodeId": "draft-step",
  "toNodeId": "review-step",
  "routingScope": "intra-workflow",
  "sourceNodeExecId": "nodeexec-000021",
  "deliveryKind": "edge-transition",
  "payloadRef": {
    "workflowId": "writing-session",
    "workflowExecutionId": "wfexec-000001",
    "outputNodeId": "draft-step",
    "nodeExecId": "nodeexec-000021",
    "artifactDir": "{artifact-root}/writing-session/executions/wfexec-000001/nodes/draft-step/nodeexec-000021",
    "outputFile": "output.json"
  },
  "createdAt": "2026-03-06T10:00:00.000Z"
}
```

Envelope rules:
- the mailbox message references sender output; it does not replace node execution artifacts
- payload content may be embedded for convenience, but the canonical source remains the sender execution artifact
- `payloadRef` must carry the full `OutputRef` identity fields needed for deterministic replay
- `outbox/{fromNodeId}/output.json` is the canonical mailbox snapshot for filesystem inspection and must byte-match the routed payload resolved from the sender execution at send time
- `deliveryKind` should initially support `edge-transition`, `loop-back`, `manual-rerun`, and `conversation-turn`
- `routingScope` must be `intra-workflow` for deliveries within one workflow execution, or `external-mailbox` for human input / published output and similar boundary I/O
- older persisted envelopes may still contain legacy structural scope strings; session load normalizes those to `intra-workflow` (see `design-data-model.md`)

### `attempts/{deliveryAttemptId}/attempt.json`

Per-attempt session metadata:
- `workflowId`
- `workflowExecutionId`
- `communicationId`
- `deliveryAttemptId`
- `toNodeId`
- `status: "running" | "succeeded" | "failed" | "aborted"`
- `startedAt`
- `endedAt?`
- `restartOfDeliveryAttemptId?`
- `failureReason?`

### `attempts/{deliveryAttemptId}/agent-session.json` (optional)

Worker-only metadata (present only when recipient execution is AI/code-agent based):
- `workflowId`
- `workflowExecutionId`
- `communicationId`
- `deliveryAttemptId`
- `allocatorNodeId` (manager node id that allocated this `agentSessionId`)
- `agentSessionId`
- `status: "running" | "succeeded" | "failed" | "aborted"`
- `startedAt`
- `endedAt?`
- `restartOfAgentSessionId?`
- `failureReason?`

### `meta.json`

`meta.json` tracks mailbox lifecycle:
- `status: "created" | "delivered" | "consumed" | "delivery_failed" | "superseded"`
- `workflowId`
- `workflowExecutionId`
- `communicationId`
- `fromNodeId`
- `toNodeId`
- `sourceNodeExecId`
- `activeDeliveryAttemptId?`
- `deliveryAttemptIds: string[]`
- `activeAgentSessionRef?: { allocatorNodeId: string, agentSessionId: string }`
- `agentSessionRefs?: { allocatorNodeId: string, agentSessionId: string }[]`
- `createdAt`
- `deliveredAt?`
- `consumedByNodeExecId?`
- `consumedAt?`
- `supersededByCommunicationId?`
- `supersededAt?`
- `failureReason?`

### `attempts/{deliveryAttemptId}/receipt.json`

Per-attempt receipt records manager delivery and downstream consumption for one recipient attempt:
- `communicationId`
- `deliveryAttemptId`
- `deliveredByNodeId` = the manager node id that owns that recipient delivery attempt (external boundary I/O, graph routing, conversation turns, and other manager-mediated deliveries in that execution)
- `deliveredAt`
- `consumedByNodeExecId?`
- `consumedAt?`

## Write Ownership

Write permissions by component:

- worker node execution:
  - writes node execution artifacts under `{artifact-root}/{workflowId}/executions/{workflowExecutionId}/nodes/{nodeId}/{nodeExecId}/`
  - never writes mailbox inbox directories
  - never writes another node's mailbox files
  - never polls or scans canonical communications mailbox directories directly
  - may read a runtime-prepared node-local mailbox view when the runtime intentionally mounts one for an isolated execution environment
- root workflow manager (sole manager for the `workflowExecutionId` in the current product model):
  - participates in or owns `workflowExecutionId` creation for the run (per runtime wiring)
  - owns global allocation of `communicationId` for that workflow execution
  - allocates `deliveryAttemptId` for concrete recipient attempts it executes
  - allocates `agentSessionId` only when it starts AI/code-agent worker sessions
  - creates mailbox directories for every recipient delivery it owns
  - writes `outbox/*/message.json` and `outbox/*/output.json`, and `inbox/*/message.json` for deliveries it mediates, including to worker nodes, external I/O boundary pseudo-nodes, and conversation-turn paths as implemented
  - root-owned routing covers in-graph recipients, handoff targets at a callee boundary, external mailbox pseudo-nodes, and conversation turns as implemented
  - writes `meta.json` and per-attempt `attempt.json` / `receipt.json` for every recipient delivery it owns
  - resolves mailbox messages into recipient `input.json` for the deliveries it owns

This ownership rule is mandatory for auditability and to prevent accidental peer-to-peer coupling between worker nodes.

Execution-local worker mailbox view:

- Before any worker execution, the runtime must compile one execution-local
  worker mailbox contract under the node artifact directory.
- That worker mailbox contract is described in
  `design-docs/specs/design-node-execution-inbox-contract.md`.
- Future `command` and `container` executors should expose that same mailbox
  contract on disk and set `DIVEDRA_MAILBOX_DIR`.
- Any worker-visible file attachments for that node execution must appear only
  under the execution-local inbox files directory; they are not read from
  canonical `communications/...` paths.
- Those worker-visible mailbox paths are execution-scoped I/O surfaces, not the
  authoritative routed-communication store under `communications/{communicationId}/`.
- Runtime-owned validation/publication still decides when data written through
  the execution-local outbox becomes accepted node output or downstream mailbox
  traffic.

## Delivery Flow

1. Sender node execution finishes and persists normal execution artifacts.
2. The manager for the run evaluates the workflow graph and chooses downstream recipients.
3. For a call into another `workflowId`, the runtime may allocate a `communicationId` to the handoff target (callee entry / root manager as resolved) or follow the call-step path that creates a child `workflowExecutionId`; the child run then uses its own mailbox root.
4. The manager that owns a recipient delivery attempt allocates a `deliveryAttemptId`, writes `{communicationId}/message.json`, `outbox/{fromNodeId}/message.json`, `outbox/{fromNodeId}/output.json`, `inbox/{toNodeId}/message.json`, `attempts/{deliveryAttemptId}/attempt.json`, and `attempts/{deliveryAttemptId}/receipt.json`.
5. Only after the full delivered file set exists durably does the manager that owns that recipient delivery attempt write `meta.json` with `status = "delivered"` and `activeDeliveryAttemptId = {deliveryAttemptId}`.
6. When the recipient is ready to execute, the runtime allocates a concrete recipient `nodeExecId` and writes the resolved payload to that node's `input.json`.
7. The manager persists recipient execution metadata that binds the mailbox item to the concrete recipient `nodeExecId`.
8. Only after both `input.json` and recipient execution metadata are durably persisted does the owning manager mark the mailbox item as `consumed` and set `meta.json.consumedByNodeExecId`.

Atomicity requirement:
- delivery must use write-then-rename semantics for each JSON file so readers never observe partial JSON
- status transitions are multi-file transactions and must satisfy all phase invariants below before advancing `meta.json.status`

Crash-recovery phase invariants:
- `created` phase minimum set:
  - required files: `message.json`, `outbox/{fromNodeId}/message.json`, `outbox/{fromNodeId}/output.json`
  - `meta.json.status = "created"`
- `delivered` phase minimum set:
  - `created` phase files plus `inbox/{toNodeId}/message.json`, `attempts/{deliveryAttemptId}/attempt.json`, and `attempts/{deliveryAttemptId}/receipt.json`
  - `meta.json.status = "delivered"` and `meta.json.activeDeliveryAttemptId = {deliveryAttemptId}`
- `consumed` phase minimum set:
  - `delivered` phase files plus recipient `input.json` and recipient-binding metadata (`consumedByNodeExecId`, `consumedAt`) in both `meta.json` and `attempts/{deliveryAttemptId}/receipt.json`
  - `meta.json.status = "consumed"`

Recovery rules (mandatory):
- if required files for current status are missing, runtime must not progress to the next status
- if `meta.json.status = "delivered"` but `activeDeliveryAttemptId` or corresponding attempt files are missing, runtime must roll back status to `created` and schedule a new delivery attempt
- if `meta.json.status = "consumed"` but recipient binding metadata or recipient `input.json` is missing, runtime must roll back status to `delivered` and resume binding
- recovery must be idempotent: repeated repair passes must converge to the same valid status/file set

## Re-Execution Semantics

### Workflow Re-Execution

When the workflow is executed again, the runtime must allocate a new `workflowExecutionId`.
Mailbox state from a prior workflow execution remains immutable and is not reused in place.

### Message Re-Execution

Terminology:
- `delivery retry`: re-attempting delivery/execution for an already-created mailbox send event
- `send re-execution` (rerun/resend): generating a node-to-node send again from workflow logic or operator action

Identity rules:
- every `send re-execution` must allocate a new `communicationId` (mandatory)
- one `communicationId` may have multiple recipient execution attempts, each with a distinct recipient `nodeExecId`
- a `delivery retry` that launches a new recipient execution attempt must allocate a new `nodeExecId` and a new `deliveryAttemptId`, while keeping the same `communicationId`
- a worker-process restart inside the same recipient execution attempt keeps the same `deliveryAttemptId` and allocates a new `agentSessionId`

When workflow logic or an operator produces a new send, the runtime allocates a new `communicationId`.
Examples:
- a new workflow execution
- a new sender node execution producing a fresh downstream communication
- a deliberate resend treated as a distinct historical communication

Retry rules:
- inbox contents stay unchanged while retrying the same communication
- `message.json` stays unchanged while retrying the same communication
- `outbox/{fromNodeId}/output.json` stays unchanged while retrying the same communication
- only `attempts/{deliveryAttemptId}/`, optional `agent-session.json`, and active-attempt/session pointers in `meta.json` advance on retry
- a retry from `delivery_failed` must keep the same `communicationId`, allocate a new `deliveryAttemptId`, and transition through `created` before returning to `delivered`
- `consumed` advances only when a recipient attempt is durably bound to its recipient `nodeExecId`; failed restarts do not advance it
- any send re-execution must create a new `communicationId`; prior communication may be marked with `supersededByCommunicationId`, but prior inbox/outbox contents remain immutable

Mailbox status transitions:
- `created -> delivered`: recipient inbox write, `activeDeliveryAttemptId`, and attempt/receipt files completed durably
- `delivered -> consumed`: recipient `input.json` and binding metadata persisted durably
- `created|delivered -> delivery_failed`: delivery failed before durable recipient binding
- `delivery_failed -> created`: operator/runtime requests retry for the same communication; allocate a new `deliveryAttemptId`
- `created|delivered|consumed -> superseded`: a newer logical communication replaces this one; set `supersededByCommunicationId` and `supersededAt`
- `superseded` is terminal
- `consumed` is stable but may transition to `superseded` when explicitly replaced by a newer logical communication

Normative transition guards:
- `created -> delivered` requires `inbox/{toNodeId}/message.json`, `activeDeliveryAttemptId`, and both `attempt.json`/`receipt.json` for that attempt
- `delivered -> consumed` requires recipient `input.json`, `consumedByNodeExecId`, and `consumedAt`
- `delivery_failed -> created` requires `activeDeliveryAttemptId` to be replaced by a newly allocated attempt id and `failureReason` to be retained as historical metadata (not deleted)
- `* -> superseded` requires `supersededByCommunicationId` and `supersededAt`

## Input Resolution Policy

Mailbox delivery does not replace the existing node execution contract.

Rules:
- recipient node execution still receives a resolved root `input.json` in its normal node artifact directory
- recipient node execution also receives an execution-local worker mailbox contract under `mailbox/`
- mailbox inbox files are upstream transport artifacts
- `input.json` must record which mailbox items were consumed, for example through `upstreamCommunications`
- worker nodes must not discover work by reading canonical communications mailbox directories directly
- manager nodes may read mailbox files addressed to themselves because they are the owning managers for their routing scope
- canonical mailbox directories are audit/provenance storage; the execution-local worker mailbox contract is the preferred worker-facing execution contract
- `consumed` means the communication has been durably bound to a specific recipient `nodeExecId`, not merely that an agent process started
- a future `container` node may read its execution-local inbox and write its execution-local outbox, but those paths are node-local execution views prepared by the runtime rather than the shared routed-communication store
- a future `container` node must treat its execution-local inbox as its only worker-visible incoming message surface; it must not assume visibility into sibling or upstream canonical mailbox artifacts

Conceptual example:

```json
{
  "upstreamCommunications": [
    {
      "communicationId": "comm-000014",
      "fromNodeId": "parent-divedra",
      "inboxMessagePath": "{artifact-root}/writing-session/executions/wfexec-000001/communications/comm-000014/inbox/review-sub-divedra/message.json"
    }
  ]
}
```

## Validation Rules

- every workflow execution has exactly one `workflowExecutionId`
- every mailbox directory belongs to exactly one workflow execution
- every `communicationId` is unique within a workflow execution
- every `deliveryAttemptId` is unique within one `communicationId`
- every `(allocatorNodeId, agentSessionId)` tuple is unique within one `workflowExecutionId` when present
- every send re-execution allocates a new `communicationId` (no reuse)
- every mailbox item has exactly one sender node and one recipient node
- every inbox copy must have a matching outbox copy and top-level `message.json`
- every outbox directory must contain both `message.json` and `output.json`
- worker nodes must never be configured to write mailbox directories directly
- recipient input resolution must reference mailbox artifacts only from the same `workflowExecutionId`

## Relationship to Existing Conversation Model

High-level “conversation” features (when present) are expressed as orchestration
metadata. Transport for node-to-node work remains **manager-routed mailbox
deliveries** with `communicationId` and the artifact layout above. A
conversation **turn** that involves two manager nodes in the same execution is
still a pair of routed deliveries (or the dedicated conversation-turn path as
implemented), not a separate parallel sub-workflow tree inside `workflow.json`.

## Resolved Decisions

- `workflowExecutionId` is the workflow-run identifier; `sessionId` is not used in mailbox contracts.
- `communicationId` is one sender-recipient send event and is globally allocated by the root manager per workflow execution.
- delivery retries use `deliveryAttemptId`; worker restarts use `agentSessionId` when applicable.
- sender execution `output.json` remains source-of-truth payload, with immutable mailbox snapshot in `outbox/{fromNodeId}/output.json`.
- supersession is explicit via `status = "superseded"` and `supersededByCommunicationId`.

## References

See [architecture.md](./architecture.md) and [notes.md](./notes.md) for the higher-level architectural decision record.
