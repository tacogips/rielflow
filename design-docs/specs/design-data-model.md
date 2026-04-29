# Data Model Design

This document summarizes the canonical runtime data models that the current implementation persists and exchanges.

## Overview

The runtime has three major model layers:

1. authored workflow-definition models
2. normalized load-time models
3. runtime session, execution, and communication records

The source of truth for these shapes is:

- `src/workflow/types.ts`
- `src/workflow/session.ts`
- `src/workflow/runtime-db.ts`

## Authored Workflow Models

### Workflow Bundle

A workflow bundle contains:

- `workflow.json`
- `node-{id}.json`
- optional prompt files

### `WorkflowJson`

Authoring and normalized shapes are defined in `src/workflow/types.ts` (`AuthoredWorkflowJson`, `WorkflowJson`). Step-addressed bundles use `entryStepId`, `steps`, and a parallel `nodeRegistry` (plus optional `managerStepId`). Legacy node-graph `workflow.json` may list companion fields such as `edges` / optional `loops`; top-level `managerRuntimeId` / `entryNodeId` are **rejected** by validation (use node `kind` / `role` and structural edges; the normalized `WorkflowJson` never carries those keys). Runners and UI use `resolveWorkflowManagerRuntimeId` / `resolveWorkflowEntryRuntimeId` and structural edge projection instead. Authored `subWorkflows`, `branching`, `workflowCalls`, and related structural conversation metadata are rejected by validation.

### `WorkflowDefaults`

- `maxLoopIterations: number`
- `nodeTimeoutMs: number`
- optional `containerRuntime`

### `WorkflowPrompts`

- optional `divedraPromptTemplate`
- optional `workerSystemPromptTemplate`

### `WorkflowNodeRef`

- `id`
- `nodeFile`
- optional `kind`
- optional `completion`

Current `NodeKind`:

- `task`
- `branch-judge`
- `loop-judge`
- `root-manager`
- `input`
- `output`

### Structural sub-workflows (removed from the type surface)

The legacy structural `subWorkflows` graph (`SubWorkflowRef`, nested input sources, and block metadata) is no longer modeled in `src/workflow/types.ts`. Disk bundles that still declare `workflow.subWorkflows` fail validation; tests that need a stand-in shape define local fixture types instead of importing shared types.

### `SubWorkflowConversation`

- `id`
- `participants`
- `maxTurns`
- `stopWhen`

### `WorkflowEdge`

- `from`
- `to`
- `when`
- optional `priority`

### `LoopRule`

- `id`
- `judgeNodeId`
- optional `maxIterations`
- `continueWhen`
- `exitWhen`
- optional `backoffMs`

## Node Payload Models

### `NodePayload`

Current fields:

- `id`
- optional `description`
- optional `nodeType`
- optional `model`
- optional `executionBackend`
- optional `sessionPolicy`
- optional `promptTemplate`
- optional `promptTemplateFile`
- `variables`
- optional `command`
- optional `container`
- optional `durability`
- optional `argumentsTemplate`
- optional `argumentBindings`
- optional `templateEngine`
- optional `timeoutMs`
- optional `output`

### `NodeType`

- `agent`
- `command`
- `container`

### `NodeSessionPolicy`

- `mode: "new" | "reuse"`

### `NodeOutputContract`

- optional `description`
- optional `jsonSchema`
- optional `maxValidationAttempts`

### Container-Related Shapes

Schema-level container types exist:

- `ContainerRuntimeDefaults`
- `ContainerExecution`
- `ContainerBuild`
- `ContainerWorkspace`
- `ContainerResources`
- `NodeDurability`

Current implementation note:

- these shapes are validated and persisted
- the main workflow engine executes `nodeType: "container"` through the native node executor

## Normalized Load-Time Model

`NormalizedWorkflowBundle` contains:

- `workflow: WorkflowJson`
- `nodePayloads: Record<string, NodePayload>`

Normalization behavior:

- prompt files are resolved into effective `promptTemplate`
- transition-era prompt/backend/sub-workflow aliases are rejected; legacy manager kinds are also rejected
- `workflow.json.nodes[]` order is canonical and requires no separate visualization file

## Session Model

`WorkflowSessionState` is the central persisted runtime model.

Current fields:

- `sessionId`
- `workflowName`
- `workflowId`
- `status`
- `startedAt`
- optional `endedAt`
- `queue`
- optional `currentNodeId`
- `nodeExecutionCounter`
- `nodeExecutionCounts`
- optional `loopIterationCounts`
- optional `restartCounts`
- optional `restartEvents`
- `transitions`
- `nodeExecutions`
- `communicationCounter`
- `communications`
- optional `conversationTurns`
- optional `nodeBackendSessions`
- `runtimeVariables`
- optional `lastError`

### `SessionStatus`

- `running`
- `paused`
- `completed`
- `failed`
- `cancelled`

### Queue Semantics

The queue is:

- initialized with the root manager node id
- rebuilt after each execution pass
- deduplicated by node id
- persisted to the session store after every step

The queue is the authoritative scheduler state for `workflow run`.

## Node Execution Model

`NodeExecutionRecord` fields:

- `nodeId`
- `nodeExecId`
- `status`
- `artifactDir`
- `startedAt`
- `endedAt`
- optional `attempt`
- optional `outputAttemptCount`
- optional `outputValidationErrors`
- optional `backendSessionId`
- optional `backendSessionMode`
- optional `restartedFromNodeExecId`

Current `status` values:

- `succeeded`
- `failed`
- `timed_out`
- `cancelled`

### Backend Session Reuse

`NodeBackendSessionRecord` fields:

- `nodeId`
- `backend`
- `provider`
- `sessionId`
- `createdAt`
- `updatedAt`
- `lastNodeExecId`

These records allow `sessionPolicy.mode = "reuse"` to continue provider-managed sessions within one workflow run.

## Hook Event Model

`HookEventRecord` represents a Claude Code or Codex lifecycle hook received through `divedra hook`.

Fields:

- `hookEventId`
- `workflowId`
- `workflowExecutionId`
- `nodeId`
- `nodeExecId`
- optional `managerSessionId`
- `vendor`
- `agentSessionId`
- `rawEventName`
- `eventName`
- `cwd`
- optional `transcriptPath`
- optional `model`
- optional `turnId`
- `payloadHash`
- optional `payloadRef`
- optional `responseJson`
- `status`
- optional `error`
- `createdAt`
- `updatedAt`

The identifier meanings are intentionally distinct:

- `workflowExecutionId` is the divedra workflow run/session id from `DIVEDRA_WORKFLOW_EXECUTION_ID`.
- `managerSessionId` is the divedra manager control-plane session id when the hook runs inside a manager node.
- `agentSessionId` is the Claude/Codex backend session id from the hook payload `session_id`.
- `nodeExecId` identifies the divedra node execution that launched the backend process.

Hook event records are append-only audit records. They are stored in the runtime database and indexed by workflow execution, backend agent session, manager session, and node execution. Redacted payload artifacts are stored under:

```text
hooks/<workflowExecutionId>/<nodeExecId>/<agentSessionId>/<hookEventId>/payload.json
```

Hook event records are separate from external `event_receipts`; `event_receipts` represent external triggers that may start workflows, while hook events represent lifecycle telemetry emitted by backend agent sessions during a workflow run.

## Communication Model

`CommunicationRecord` represents a mailbox delivery.

Fields:

- `workflowId`
- `workflowExecutionId`
- `communicationId`
- `fromNodeId`
- `toNodeId`
- `routingScope`
- `sourceNodeExecId`
- `payloadRef`
- `deliveryKind`
- `transitionWhen`
- `status`
- `deliveryAttemptIds`
- optional `activeDeliveryAttemptId`
- `createdAt`
- optional `deliveredAt`
- optional `consumedByNodeExecId`
- optional `consumedAt`
- optional `failureReason`
- optional `supersededByCommunicationId`
- optional `supersededAt`
- optional `replayedFromCommunicationId`
- optional `managerMessageId`
- `artifactDir`

### Routing Scopes

- `intra-workflow` — node-to-node (or step-to-step) delivery within the same workflow execution artifact root
- `external-mailbox` — human input / published workflow output and other boundary I/O

On load, `normalizeSessionState` runs each communication’s `routingScope` through `normalizeCommunicationRoutingScope`: only `external-mailbox` is kept; any other persisted string is coerced to `intra-workflow` (including obsolete labels from older builds).

### Delivery Kinds

- `edge-transition`
- `loop-back`
- `manual-rerun`
- `conversation-turn`
- `external-input`
- `external-output`

### Communication Lifecycle

Current statuses:

- `created`
- `delivered`
- `consumed`
- `delivery_failed`
- `superseded`

The main engine typically creates communications directly in `delivered` state and later marks consumed inputs as `consumed`.

## Output References

`OutputRef` currently aliases `NodeOutputRef`.

Fields:

- optional `kind: "node-output"`
- `workflowExecutionId`
- `workflowId`
- `outputNodeId`
- `nodeExecId`
- `artifactDir`

The runtime uses `OutputRef` to point at canonical published node output artifacts rather than copying large payloads into every control-plane record.

## Conversation Turn Model

`ConversationTurnRecord` fields:

- `conversationId`
- `turnIndex`
- `fromManagerRuntimeId`
- `toManagerRuntimeId`
- `communicationId`
- `outputRef`
- `sentAt`

This model tracks manager-to-manager conversation turns using the same communication and `OutputRef` identity fields as edge deliveries.

## Runtime Variables

`runtimeVariables` is a generic record, but the engine currently treats some keys specially:

- `humanInput`
  - used to create the initial external-mailbox delivery to the root manager
- `workflowOutput`
  - set when a root-scope `output` node succeeds

Prompt composition and argument binding also consume runtime variables as general template input.

## Artifact Model

### Node Execution Artifact Directory

Canonical path:

```text
{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{nodeId}/{nodeExecId}/
```

Common files:

- `input.json`
- `output.json`
- `meta.json`
- `handoff.json`
- `commit-message.txt`
- optional `output-attempts/`

### Communication Artifact Directory

Canonical path:

```text
{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/communications/{communicationId}/
```

Common files:

- `message.json`
- `meta.json`
- `outbox/<fromNodeId>/message.json`
- `outbox/<fromNodeId>/output.json`
- `inbox/<toNodeId>/message.json`
- `attempts/<deliveryAttemptId>/attempt.json`
- `attempts/<deliveryAttemptId>/receipt.json`

### External Mailbox Artifacts

The runtime also uses:

- `external-mailbox/input/`
- `external-mailbox/output/`

to represent workflow-level inbound and outbound handoff using the same communication model.

## Runtime DB Model

SQLite stores query-oriented copies of node execution data such as:

- execution status
- attempt counters
- validation errors
- backend session metadata
- input/output hashes
- input/output JSON payloads

This DB is intentionally secondary to the filesystem artifact contract.

## Current Validation and Compatibility Rules

Important current rules:

- node ids must match the repository's slug-like id pattern
- for legacy node-graph bundles, exactly one `kind: "root-manager"` node (or a single `role: "manager"` node) is required unless the flow is manager-less, with manager/entry **runtime** ids derived from the graph; normalized bundles do not carry `workflow.managerRuntimeId` as stored convenience fields
- branch/loop block semantics are validated against edges and loops
- `output` contracts reject unsupported fields
- `kind: "root-manager"` is the canonical **kind** for the workflow manager node; structural `subworkflow-manager` kind strings are rejected

Important current absences:

- no `workflowType`
- no `nodeGroups`
- no workflow-ref child execution model in the authored data model

## References

- `design-docs/specs/architecture.md`
- `design-docs/specs/design-workflow-json.md`
