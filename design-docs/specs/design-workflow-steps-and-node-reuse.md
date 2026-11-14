# Workflow Steps And Reusable Node Definitions

This document defines the authored workflow model where a workflow contains `steps`, each step references a reusable `node` definition through an explicit node registry, and multiple steps may intentionally reuse the same node with optional backend-session continuation.

## Overview

The authored model is:

- a workflow should contain `steps` as the canonical execution addresses
- a workflow should keep a reusable node registry instead of treating node order as execution order
- each `step` points at a reusable `node`
- different steps may reference the same node
- when steps share a node, the later step may optionally continue the prior backend session for that node
- this makes patterns such as "implement, then ask the same coding node to self-review" explicit

This creates a clean separation:

- `workflow`
  - orchestration structure
- `step`
  - one addressable execution position inside a workflow
- `node`
  - reusable execution implementation and prompt/backend definition

## Goals

- Make `step` the canonical authored execution/routing unit.
- Make `node` reusable across multiple steps.
- Allow different steps to share one LLM/code node definition intentionally.
- Preserve same-session continuation across steps when requested.
- Keep routing, mailbox artifacts, and jump validation unambiguous even when many steps point at the same node.

## Non-Goals

- Implicitly reusing sessions across all steps that happen to share a node.
- Removing standalone node definitions from the workflow bundle.

## Core Model

### Workflow

A workflow defines:

- metadata
- defaults
- manager selection
- reusable node registry
- step ordering / step jump graph

A workflow owns a reusable node registry, but execution order lives in steps rather than in node ordering.

Cross-workflow invocation is not a separate top-level schema feature in this model. It uses the same execution-address contract as any other step call: calling another workflow means targeting its callable entry step, normally the manager step.

### Step

A step is one executable position in a workflow.

A step defines:

- `id`
- `nodeId`
- optional `description`
- optional step-local timeout/session/prompt overrides
- outgoing transitions to other execution addresses

Steps are unique per workflow execution and are the canonical jump targets.

### Node

A node is a reusable implementation definition.

A node defines:

- backend / runtime type
- prompt template(s)
- output contract
- session policy defaults
- timeout defaults

Nodes may be referenced by many steps in the same workflow.

## Authored Bundle Layout

Target layout:

```text
<workflow-definition-dir>/<workflow-name>/
  workflow.json
  steps/
    step-plan.json
    step-implement.json
    step-self-review.json
  nodes/
    node-manager.json
    node-coder.json
  prompts/
    coder.md
    coder-self-review.md
```

Alternative compact authoring may inline step definitions in `workflow.json`, but node payloads remain reusable definitions referenced through the explicit node registry rather than by filename convention.

## Target `workflow.json`

Example:

```json
{
  "workflowId": "feature-workflow",
  "description": "Plan, implement, and self-review using a reusable coding node.",
  "defaults": {
    "nodeTimeoutMs": 120000
  },
  "managerStepId": "manager",
  "entryStepId": "manager",
  "nodes": [
    { "id": "manager-runtime", "nodeFile": "nodes/node-manager.json" },
    { "id": "coder", "nodeFile": "nodes/node-coder.json" }
  ],
  "steps": [
    { "id": "manager", "stepFile": "steps/step-manager.json" },
    { "id": "plan", "stepFile": "steps/step-plan.json" },
    { "id": "implement", "stepFile": "steps/step-implement.json" },
    { "id": "self-review", "stepFile": "steps/step-self-review.json" }
  ]
}
```

Target top-level fields:

- `workflowId`
- `description?`
- `defaults`
- `managerStepId?`
- `entryStepId`
- `nodes: WorkflowNodeRegistryRef[]`
- `steps: WorkflowStepRef[]`

The canonical authored structure is now:

- `workflow -> steps[] + nodes[]`
- `step -> nodeId`
- `node registry entry -> nodeFile | addon`

### Reusable Node Registry

`workflow.json.nodes[]` remains in the bundle, but its meaning changes.

It is no longer the canonical execution order. It is the reusable node registry that steps reference by `nodeId`.

Target registry entry shapes:

```json
{ "id": "coder", "nodeFile": "nodes/node-coder.json" }
```

```json
{
  "id": "reply-worker",
  "addon": {
    "name": "divedra/chat-reply-worker",
    "version": "1"
  }
}
```

Rules:

- registry entry `id` values are unique within the workflow bundle
- each registry entry provides exactly one of `nodeFile` or `addon`
- steps reference registry entry ids through `step.nodeId`
- registry declaration does not imply execution order
- keeping a registry preserves explicit validation and add-on resolution instead of relying on filename conventions

## Step Definition

Target `step-{id}.json` shape:

```json
{
  "id": "self-review",
  "nodeId": "coder",
  "description": "Ask the same coding node to review its own prior implementation.",
  "promptVariant": "self-review",
  "sessionPolicy": {
    "mode": "reuse",
    "inheritFromStepId": "implement"
  },
  "timeoutMs": 180000,
  "transitions": [
    { "toStepId": "finish", "label": "accepted" },
    { "toStepId": "implement", "label": "needs-fix" }
  ]
}
```

Target step fields:

- `id: string`
- `nodeId: string`
- `description?: string`
- `role?: "manager" | "worker"`
- `promptVariant?: string`
- `timeoutMs?: number`
- `sessionPolicy?: StepSessionPolicy`
- `transitions?: StepTransition[]`

Rules:

- `nodeId` must resolve through the workflow's reusable node registry
- `id` is unique within the workflow
- when `role` is omitted, the workflow's `managerStepId` names the manager step and all other steps default to worker execution sites
- `transitions[]` point to execution addresses identified by step id, with an optional workflow id for cross-workflow calls
- step-local fields may override node defaults for that usage site only

## Node Definition

File-backed nodes remain reusable payload definitions under `nodes/`.
The workflow registry may also point at add-on-backed reusable nodes.

Example:

```json
{
  "id": "coder",
  "executionBackend": "codex-agent",
  "model": "gpt-5",
  "promptTemplateFile": "prompts/coder.md",
  "promptVariants": {
    "self-review": {
      "promptTemplateFile": "prompts/coder-self-review.md"
    }
  },
  "sessionPolicy": {
    "mode": "new"
  }
}
```

Rules:

- node definitions are reusable implementation templates
- workflow registry entries are the canonical resolution source for `step.nodeId`
- step-local prompt/session/timeout choices override node defaults
- a single node may back many steps without duplicating prompt/backend configuration

## Why Step Is The Canonical Execution Unit

If multiple steps share one node, node id alone is no longer enough to answer:

- which execution position is running
- which transition targets are legal next
- which timeout or prompt override applies
- whether this visit is the implementation pass or the self-review pass

Therefore:

- jumps target `stepId`
- mailbox artifacts record both `stepId` and the backing registry `nodeId`
- scheduling and routing use `stepId` as the canonical execution position; `nodeId` remains the template and backend-session identity for artifacts and reuse

## Step Reuse And Session Continuation

The main requested behavior is:

- two different steps may use the same node
- the later step may continue the earlier step's backend session

This should be explicit, not implicit.

### Step Session Policy

Target shape:

```json
{
  "sessionPolicy": {
    "mode": "reuse",
    "inheritFromStepId": "implement"
  }
}
```

Fields:

- `mode: "new" | "reuse"`
- `inheritFromStepId?: string`

Rules:

- `mode = "new"` forces a fresh backend session for this step execution
- `mode = "reuse"` requests session continuation
- when `inheritFromStepId` is omitted, the runtime may reuse the latest compatible session for the same node within the workflow execution
- when `inheritFromStepId` is present, the runtime should prefer the latest compatible session created by that source step
- if no reusable session exists, execution falls back to a new backend session
- reusable session records therefore need to retain source-step provenance rather than being keyed only by `nodeId`; see `design-docs/specs/design-node-session-reuse.md`

### Example: Self Review

Example structure:

- step `implement` uses node `coder`
- step `self-review` also uses node `coder`
- `self-review.sessionPolicy = { "mode": "reuse", "inheritFromStepId": "implement" }`
- `self-review.promptVariant = "self-review"`

Meaning:

- the same coding backend session may continue
- the runtime switches to the self-review prompt variant
- the node can review its own earlier work with prior context available

## Step-Addressed Jump Model

With a step-based workflow, the jump contract should become step-addressed.

Target output mail `next` shape:

```json
{
  "next": {
    "stepId": "self-review",
    "promptVariant": "self-review",
    "sessionMode": "reuse"
  }
}
```

Rules:

- `next.stepId` is the canonical jump target
- `next.workflowId`, when present, identifies a cross-workflow jump target
- the runtime validates `(next.workflowId ?? currentWorkflowId, next.stepId)` against the current step's declared transitions
- `next.nodeId` should not be the canonical routing field in the step-based model
- the runtime resolves the referenced workflow/step and then its backing `nodeId`

This supersedes direct node-addressed jumps for workflows authored in the step model.

## Artifact Model

Execution artifacts should record both step and node identity.

Recommended execution-local directory layout:

```text
{artifact-root}/{workflowId}/executions/{workflowExecutionId}/steps/{stepId}/{stepInstanceId}/
  input.json
  output.json
  meta.json
  mailbox/
```

`meta.json` should include:

- `workflowId`
- `workflowExecutionId`
- `stepId`
- `stepInstanceId`
- `nodeId`
- `nodeExecId`
- `promptVariant?`
- `sourceStepId?` when session inheritance is requested

Rules:

- `stepId` is the canonical authored execution address
- `nodeId` records which reusable node implementation backed that step
- multiple steps may map to the same node without artifact collision

## Validation Rules

The target validator should enforce:

- workflows author `steps[]` as execution units and `nodes[]` as a reusable registry in the new model
- every step references an existing workflow node-registry entry
- every registry entry resolves to a valid file-backed node payload or add-on definition
- `entryStepId` and `managerStepId`, when present, must resolve to authored steps
- step transitions target step ids, with optional cross-workflow scope through `toWorkflowId`
- `sessionPolicy.inheritFromStepId`, when present, must resolve to a step that uses the same `nodeId`
- `promptVariant`, when present, must exist on the referenced node

## Runtime Consequences

The engine should treat:

- workflow progression state as step progression
- backend-session reuse state as node-backed session state, optionally indexed by source step

Recommended session-store keying direction:

- primary reusable backend session lookup by `(workflowExecutionId, nodeId)`
- optional refinement by `sourceStepId` so later steps can request a specific prior step's session lineage

This allows:

- same-step revisits
- different-step same-node continuation
- deterministic fallback to new sessions when reuse is unavailable

## Testing Requirements

Add coverage for at least:

- step references resolve through the reusable node registry rather than filename conventions
- two different steps reference the same node successfully
- step-local prompt variant override works on a shared node
- step-local session reuse inherits the previous step's backend session
- step-addressed jumps validate against step transitions
- artifacts record both step id and node id
- invalid `inheritFromStepId` is rejected

## References

- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/design-node-session-reuse.md`
- `design-docs/specs/design-node-jump-and-code-manager-runtime.md`
- `design-docs/specs/architecture.md`
