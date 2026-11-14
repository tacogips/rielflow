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
- `workflow-vis.json`
- `node-{id}.json`
- optional prompt files

### `WorkflowJson`

Current fields:

- `workflowId`
- `description`
- `defaults`
- optional `prompts`
- `managerNodeId`
- `subWorkflows`
- optional `subWorkflowConversations`
- `nodes`
- `edges`
- optional `loops`
- `branching`

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
- `subworkflow-manager`
- `input`
- `output`

### `SubWorkflowRef`

- `id`
- `description`
- `managerNodeId`
- `inputNodeId`
- `outputNodeId`
- `nodeIds`
- `inputSources`
- optional `block`

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
- the main workflow engine still rejects `nodeType: "container"` during execution

## Normalized Load-Time Model

`NormalizedWorkflowBundle` contains:

- `workflow: WorkflowJson`
- `workflowVis: WorkflowVisJson`
- `nodePayloads: Record<string, NodePayload>`

Normalization behavior:

- prompt files are resolved into effective `promptTemplate`
- selected legacy non-manager fields may be normalized during load, but legacy manager kinds are rejected
- if `workflow-vis.json` is absent, a default ordered `WorkflowVisJson` is synthesized

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

## Communication Model

`CommunicationRecord` represents a mailbox delivery.

Fields:

- `workflowId`
- `workflowExecutionId`
- `communicationId`
- `fromNodeId`
- `toNodeId`
- optional `fromSubWorkflowId`
- optional `toSubWorkflowId`
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

- `parent-to-sub-workflow`
- `cross-sub-workflow`
- `intra-sub-workflow`
- `external-mailbox`

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
- optional `subWorkflowId`
- `outputNodeId`
- `nodeExecId`
- `artifactDir`

The runtime uses `OutputRef` to point at canonical published node output artifacts rather than copying large payloads into every control-plane record.

## Conversation Turn Model

`ConversationTurnRecord` fields:

- `conversationId`
- `turnIndex`
- `fromSubWorkflowId`
- `toSubWorkflowId`
- `fromManagerNodeId`
- `toManagerNodeId`
- `communicationId`
- `outputRef`
- `sentAt`

This model tracks cross-sub-workflow conversation routing after manager-node execution.

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
- `workflow.managerNodeId` must point at the root manager
- sub-workflow boundaries must be internally consistent and non-overlapping
- branch/loop block semantics are validated against edges and loops
- `output` contracts reject unsupported fields
- `kind: "root-manager"` and `kind: "subworkflow-manager"` are the canonical manager roles

Important current absences:

- no `workflowType`
- no `nodeGroups`
- no workflow-ref child execution model in the authored data model

## References

- `design-docs/specs/architecture.md`
- `design-docs/specs/design-workflow-json.md`
