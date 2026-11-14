# User Action And Optional Node Execution Design

This document proposes an additive design for two workflow capabilities:

- a runtime-owned `user-action` node that asks an external human for a decision
- an `optional` execution mode that lets the owning `divedra` manager decide whether a ready node should run or be skipped

## Overview

The current architecture already has the right foundations:

- `nodeType` describes execution flavor
- `kind` describes structural workflow role
- manager nodes already own scoped planning decisions through `managerControl.actions`
- GraphQL already exists as the canonical control-plane direction

The new design should preserve those boundaries rather than introduce a second planner or a one-off human-input subsystem.

Recommended placement:

- model `user-action` as a new `nodeType`
- keep `kind` unchanged unless the author wants to label the node as `task`
- model optional execution as scheduler policy on `workflow.json.nodes[]`, not as node payload executor config

Rationale:

- `user-action` changes how the runtime executes a node
- `optional` changes whether a ready node is queued at all

## Goals

- let a workflow pause and ask a real user for approval, clarification, or structured input
- support multiple message transports for one request, such as Matrix plus Discord
- allow notification-only transports in parallel with reply-capable message transports
- keep restart-safe audit artifacts and deterministic runtime ownership
- let the owning manager explicitly decide whether an optional node should execute or be skipped
- keep secrets and transport-specific credentials outside authored workflow JSON

## Non-Goals

- fixing one concrete Matrix or Discord integration now
- requiring a single inbound transport model such as polling only or webhook only
- turning the runtime into a generic chat bot framework
- allowing arbitrary worker nodes to contact users directly without runtime ownership

## Authored Model Changes

### `WorkflowNodeRef`

Add scheduler policy to `workflow.json.nodes[]`:

```typescript
interface WorkflowNodeExecutionPolicy {
  readonly mode?: "required" | "optional";
  readonly decisionBy?: "owning-manager";
}

interface WorkflowNodeRef {
  readonly id: string;
  readonly nodeFile: string;
  readonly kind?: NodeKind;
  readonly completion?: CompletionRule;
  readonly execution?: WorkflowNodeExecutionPolicy;
}
```

Rules:

- omitted `execution.mode` means `required`
- `optional` currently requires `decisionBy: "owning-manager"`
- the owning manager is the root manager for root-scope nodes and the subworkflow-manager for nodes inside one sub-workflow

### `node-{id}.json`

Add a new execution flavor:

```typescript
type NodeType = "agent" | "command" | "container" | "user-action";

interface UserActionNodeConfig {
  readonly messageToolIds: readonly string[];
  readonly notificationToolIds?: readonly string[];
  readonly replyPolicy?: "first-valid-reply-wins";
  readonly allowStructuredReply?: boolean;
  readonly allowFreeTextReply?: boolean;
}

interface NodePayload {
  readonly id: string;
  readonly nodeType?: NodeType;
  readonly promptTemplate?: string;
  readonly promptTemplateFile?: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
  readonly output?: NodeOutputContract;
  readonly userAction?: UserActionNodeConfig;
}
```

Rules:

- `nodeType: "user-action"` requires `userAction.messageToolIds.length >= 1`
- `promptTemplate` or `promptTemplateFile` becomes the user-facing request body
- `output` remains the reply contract
- `model`, `executionBackend`, and `sessionPolicy` are not used by `user-action`
- notification-only tools are additive and must not be the only configured transport unless the node is explicitly fire-and-forget in a later iteration; this design assumes a reply is required

### Why `output` is reused

The `user-action` node does not need a second schema system.
Its business result is the validated human reply, so the existing `output` contract should define the accepted reply shape.

Recommended default reply envelope when no schema is provided:

```json
{
  "replyText": "Approve the release.",
  "approved": true
}
```

When `output.jsonSchema` is present, the runtime validates the normalized reply against that schema before completing the node.

## Runtime Configuration Boundary

Workflow JSON should reference logical transport ids, not credentials or provider-specific connection details.

Recommended runtime-owned registry:

```typescript
interface UserInteractionToolDescriptor {
  readonly id: string;
  readonly kind: "notification" | "message";
  readonly provider: string;
}
```

Binding examples:

- `matrix-primary`
- `discord-review-room`
- `desktop-notify`
- `email-alert`

Actual tokens, room ids, webhook URLs, and polling/webhook settings belong in runtime config, environment variables, or a future server-side integration registry.

## User Action Runtime Model

Add a persisted runtime record separate from authored workflow JSON:

```typescript
interface UserActionRecord {
  readonly userActionId: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly artifactDir: string;
  readonly managerNodeId: string;
  readonly status:
    | "dispatching"
    | "waiting-for-reply"
    | "answered"
    | "timed_out"
    | "cancelled";
  readonly replyPolicy: "first-valid-reply-wins";
  readonly messageToolIds: readonly string[];
  readonly notificationToolIds: readonly string[];
  readonly selectedReplyId?: string;
  readonly createdAt: string;
  readonly answeredAt?: string;
}
```

Per-tool dispatch and reply artifacts:

- `request.json`
- `deliveries/{toolId}.json`
- `replies/{replyId}.json`
- `resolution.json`

Recommended artifact path:

```text
{artifactRoot}/{workflowId}/executions/{workflowExecutionId}/nodes/{nodeId}/{nodeExecId}/user-action/
```

## Session Model Changes

Recommended additive session fields:

```typescript
interface PendingOptionalNodeDecision {
  readonly nodeId: string;
  readonly owningManagerNodeId: string;
  readonly subWorkflowId?: string;
  readonly requestedAt: string;
  readonly status: "pending" | "execute" | "skip";
  readonly decidedAt?: string;
  readonly decidedByNodeExecId?: string;
}
```

Recommended additive session field:

```typescript
interface ActiveUserActionRef {
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly userActionId: string;
  readonly artifactDir: string;
  readonly status: "waiting-for-reply";
  readonly pausedAt: string;
}
```

Recommended `NodeExecutionRecord.status` addition:

- `skipped`

Meaning:

- `skipped`: an optional node was intentionally not executed by its owning manager

Important compatibility rule:

- `NodeExecutionRecord` remains terminal-only for the first iteration
- `waiting_for_user` is tracked on `UserActionRecord.status` plus `WorkflowSessionState.activeUserAction`, not as a persisted node-execution status
- the reserved `nodeExecId` is allocated before dispatch so artifacts stay stable across pause and resume, but the terminal `NodeExecutionRecord` is appended only after the reply is accepted or the wait times out/cancels

The existing session-level `paused` status is sufficient for the workflow while a `user-action` node is waiting.

## Runtime Reply Collection And Resume Ownership

The pull-style `collectReplies(...)` abstraction still needs a concrete runtime owner.

Recommended first-iteration owner:

- a runtime-owned user-action collector loop runs independently of the main execution pass
- it scans persisted `UserActionRecord.status = "waiting-for-reply"` entries
- it calls `collectReplies(...)` for each configured message tool
- it persists newly observed replies before any validation or state transition
- when a valid reply is accepted, it invokes the same internal runtime completion path that a normal node execution would use after adapter output validation

This is required so a workflow paused on `user-action` does not depend on an operator manually resuming the session at the exact moment a reply arrives.

Collector rules:

- tool implementations may source replies from polling, webhook-backed local buffers, or provider-specific caches, but the runtime collector owns dedupe, validation, and completion
- reply acceptance must be idempotent by `(userActionId, replyId)`
- successful acceptance must atomically:
  - write canonical node `output.json`
  - append the terminal `NodeExecutionRecord`
  - clear `activeUserAction`
  - set session status back to `running`
  - enqueue and route downstream edges exactly once
- if no valid reply exists yet, the session remains paused without mutating queue state
- timeout inspection may be performed by the same collector loop or by a separate runtime sweeper, but one runtime-owned path must be authoritative

## `user-action` Execution Lifecycle

### 1. Node becomes runnable

The scheduler reaches a `user-action` node in the queue just like any other node.

### 2. Runtime creates a pending node execution

The engine allocates `nodeExecId`, writes `input.json`, writes user-action request artifacts, persists `UserActionRecord`, and dispatches the request through all configured tools.

### 3. Session pauses

After successful dispatch:

- `UserActionRecord.status = "waiting-for-reply"`
- `WorkflowSessionState.activeUserAction` is populated with the reserved `nodeExecId`
- `WorkflowSessionState.status = "paused"`
- `currentNodeId` remains the user-action node

### 4. Reply ingestion

An external reply arrives through one of the configured message tools and is observed by the runtime-owned collector.
The runtime normalizes it to one canonical reply envelope, validates it against `output.jsonSchema` when present, persists it, and marks the selected reply.

### 5. Session resume

On successful reply acceptance:

- write canonical `output.json` for the node
- append terminal `NodeExecutionRecord.status = "succeeded"`
- clear `activeUserAction`
- mark the session back to `running`
- continue normal edge routing

### 6. Timeout or cancellation

If no acceptable reply arrives before `timeoutMs`:

- mark the `UserActionRecord` `timed_out`
- append terminal `NodeExecutionRecord.status = "timed_out"`
- clear `activeUserAction`
- fail or recover through normal workflow timeout/retry policy

## Reply Normalization

Every transport-specific reply should be normalized before validation:

```typescript
interface NormalizedUserActionReply {
  readonly replyId: string;
  readonly toolId: string;
  readonly externalMessageId?: string;
  readonly externalUserId?: string;
  readonly receivedAt: string;
  readonly replyText?: string;
  readonly structuredPayload?: Readonly<Record<string, unknown>>;
  readonly attachments?: readonly DataDirFileRef[];
  readonly rawPayload: Readonly<Record<string, unknown>>;
}
```

Normalization rules:

- if the tool supplies structured payload, prefer it as the validation candidate
- otherwise, wrap text replies in a stable envelope
- keep the raw provider payload for audit, but never route provider-specific shapes as the canonical node output

## Tool Abstraction

Two interfaces are enough at the core boundary.

```typescript
interface UserNotificationTool {
  readonly id: string;
  readonly provider: string;
  sendNotification(
    input: UserNotificationDispatch,
  ): Promise<UserNotificationReceipt>;
}

interface UserMessageTool {
  readonly id: string;
  readonly provider: string;
  sendRequest(input: UserMessageDispatch): Promise<UserMessageDispatchReceipt>;
  collectReplies(
    input: UserMessageCollectInput,
  ): Promise<readonly NormalizedUserActionReply[]>;
  finalizeRequest?(
    input: UserMessageFinalizeInput,
  ): Promise<void>;
}
```

Design intent:

- `sendRequest` fans out the same user-action request to Matrix, Discord, or any future interactive transport
- `collectReplies` hides whether the implementation used polling, webhook buffering, or another provider mechanism
- `finalizeRequest` is optional and can mark the thread as resolved or post a follow-up summary

Recommended dispatch types:

```typescript
interface UserMessageDispatch {
  readonly userActionId: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly title?: string;
  readonly body: string;
  readonly expectedReplySchema?: JsonObject;
  readonly timeoutAt?: string;
}
```

```typescript
interface UserMessageCollectInput {
  readonly userActionId: string;
  readonly since?: string;
}
```

```typescript
interface UserMessageFinalizeInput {
  readonly userActionId: string;
  readonly outcome: "answered" | "timed_out" | "cancelled";
  readonly selectedReplyId?: string;
}
```

This abstraction is intentionally narrow:

- workflow authors select tool ids
- the runtime orchestrates fan-out, correlation, dedupe, and validation
- tool implementations only translate between provider APIs and the normalized contract

## Multiple Message Tools

For one `user-action` node, the runtime should allow multiple `messageToolIds`.

Recommended first-iteration resolution rule:

- dispatch to every configured message tool
- accept the first valid reply that satisfies the node output contract
- persist later replies as audit artifacts but do not reopen the completed node
- optionally send finalization notices to the non-winning tools

Why this default:

- it is simple
- it avoids multi-channel consensus logic
- it matches the common case where Matrix and Discord are mirrors of the same user conversation

## Output Contract Interaction

`user-action` reply validation and optional-node skip routing do not use the exact same validation rule.

Rules:

- for an answered `user-action`, `node.output` continues to describe the accepted business reply payload
- for a skipped optional node, the runtime publishes a synthetic output envelope for control-flow only
- that synthetic skip envelope is not validated against `node.output.jsonSchema` because no human reply business payload exists on the skipped path
- skip routing must therefore rely on `when.skipped` or other runtime-owned envelope booleans, not on required business fields such as `approved`

Authoring guidance:

- if downstream logic needs to inspect human reply fields, route that logic only on non-skipped paths
- if authors want one expression that covers both paths, prefer edge conditions such as `skipped || approved`

## Optional Node Execution Design

### Scheduler Semantics

When a `required` node becomes ready, the runtime enqueues it as today.

When an `optional` node becomes ready, the runtime must not enqueue it directly.
Instead it creates a pending optional-node decision for the owning manager.

### Manager Decision Surface

Extend both manager control surfaces with:

- `execute-optional-node`
- `skip-optional-node`

Recommended shapes:

```typescript
type ManagerControlActionType =
  | "planner-note"
  | "start-sub-workflow"
  | "deliver-to-child-input"
  | "retry-node"
  | "replay-communication"
  | "execute-optional-node"
  | "skip-optional-node";
```

```typescript
interface ExecuteOptionalNodeAction {
  readonly type: "execute-optional-node";
  readonly nodeId: string;
}

interface SkipOptionalNodeAction {
  readonly type: "skip-optional-node";
  readonly nodeId: string;
  readonly reason?: string;
}
```

Scope rules mirror the existing manager ownership rules:

- root manager may decide only root-scope optional nodes
- subworkflow-manager may decide only optional nodes inside its owned sub-workflow

GraphQL parity rule:

- the canonical GraphQL manager-action schema must add typed variants equivalent to `execute-optional-node` and `skip-optional-node`
- payload `managerControl.actions` may carry the same actions only as the existing compatibility path
- both control paths must share the same validation, ownership, idempotency, and queue-materialization semantics

### Queue Behavior

When an optional decision is pending:

- the runtime should ensure the owning manager gets another planning turn if not already queued
- the optional node stays out of the runnable queue until the manager decides

When the manager chooses `execute-optional-node`:

- mark the pending decision `execute`
- enqueue the node normally

When the manager chooses `skip-optional-node`:

- create a skipped node execution artifact
- mark the pending decision `skip`
- continue routing using a runtime-generated skip output

### Skip Output Contract

A skipped node should still produce a canonical output envelope so downstream routing can branch on the skip.

Recommended runtime-generated payload:

```json
{
  "provider": "runtime-optional-skip",
  "completionPassed": true,
  "when": {
    "always": true,
    "skipped": true
  },
  "payload": {
    "optionalNodeSkipped": true,
    "reason": "manager judged unnecessary"
  }
}
```

This allows authored edges like:

- `when: "skipped"`
- `when: "!skipped"`

without inventing a second routing system.

Validation rule:

- runtime-generated skip output bypasses `node.output` business-payload schema validation and is always considered publication-valid for routing purposes

## Interaction Between The Two Features

These features should compose:

- a `user-action` node may itself be marked `optional`
- the manager may choose to skip a human-approval step when confidence is high
- if the manager executes it, the runtime pauses and waits for human reply as described above

This gives the manager a clean pattern for escalation:

1. try the automated path
2. escalate to a user only when needed
3. keep a durable audit trail either way

## Validation Rules

Recommended new validation:

- `user-action` nodes must not declare `executionBackend`
- `user-action` nodes must not declare `model`
- `user-action` nodes must declare `userAction.messageToolIds`
- `userAction.messageToolIds` and `notificationToolIds` must contain unique ids
- `workflow.nodes[].execution.mode = "optional"` must use `decisionBy: "owning-manager"` in the first iteration
- manager actions `execute-optional-node` and `skip-optional-node` must target only currently pending optional nodes in scope

## GraphQL / Control Plane Direction

This design fits the existing GraphQL-first direction.

Recommended future mutations and queries:

- `submitUserActionReply`
- `executeOptionalNode`
- `skipOptionalNode`
- `pendingUserActions`
- `resumeWorkflowExecution` as an operator fallback rather than the primary reply-ingestion path

However, the core runtime and artifact design should not depend on the exact GraphQL schema names.
The important boundary is that inbound replies become runtime-owned normalized records before they affect workflow progression.

## Example Authoring

`workflow.json`

```json
{
  "id": "security-approval",
  "nodeFile": "node-security-approval.json",
  "kind": "task",
  "execution": {
    "mode": "optional",
    "decisionBy": "owning-manager"
  }
}
```

`node-security-approval.json`

```json
{
  "id": "security-approval",
  "nodeType": "user-action",
  "promptTemplateFile": "prompts/security-approval.md",
  "variables": {},
  "timeoutMs": 86400000,
  "userAction": {
    "messageToolIds": ["matrix-primary", "discord-review-room"],
    "notificationToolIds": ["desktop-notify"],
    "replyPolicy": "first-valid-reply-wins",
    "allowStructuredReply": true
  },
  "output": {
    "description": "Return the user's approval decision.",
    "jsonSchema": {
      "type": "object",
      "properties": {
        "approved": { "type": "boolean" },
        "comment": { "type": "string" }
      },
      "required": ["approved"],
      "additionalProperties": false
    }
  }
}
```

## Recommended First Iteration

Keep the first implementation intentionally narrow:

- one reply wins
- one owning manager decides optionality
- `user-action` reuses `promptTemplate` and `output`
- workflow JSON references tool ids only
- runtime owns provider correlation, artifacts, pause/resume, and validation

That is enough to add real human escalation without collapsing the current queue-based architecture.
