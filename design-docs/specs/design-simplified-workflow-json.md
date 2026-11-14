# Simplified Workflow JSON

This document proposes a simplified authored `workflow.json` model for Divedra.
It is a vNext design proposal, not a description of the current implementation.

## Overview

The current authored model has two sources of complexity that are expensive for
users to understand:

1. explicit graph edges are required even for workflows that are conceptually
   just top-to-bottom sequences
2. `subWorkflows[]` introduces a second structural layer outside node
   definitions, even though most users think in terms of "this node calls or
   belongs to another workflow phase"

This proposal narrows the authored model around one principle:

- a workflow is linear by default

The authored schema should therefore optimize for:

- ordered node execution
- node-local skip/repeat decisions
- explicit workflow-call nodes for nested execution
- optional visual grouping metadata on nodes

It should stop optimizing for:

- general graph authoring in every workflow
- a separate top-level `subWorkflows[]` structure for ordinary nested work

## Problem Statement

### Current `edges[]` Cost

Today every non-trivial transition is expressed through `edges[]`, even when the
author only wants:

- run A, then B, then C
- optionally skip B
- repeat C until done

That forces users to think in graph-routing terms when their mental model is a
sequence with a small amount of conditional control.

### Current `subWorkflows[]` Cost

Today `subWorkflows[]` stores:

- boundary membership
- manager ownership
- input/output boundary nodes
- input source rules
- loop/block structure

This makes nested execution feel like a special second DSL layered on top of the
node list. For many workflows, the actual user intent is simpler:

- this node calls another workflow
- these nodes belong to the same phase/lane

That intent should live on nodes, not in a separate top-level structure.

## Goals

- Make linear top-to-bottom execution the default authored behavior.
- Remove required explicit `edges[]` from ordinary sequential workflows.
- Remove required top-level `subWorkflows[]` from ordinary nested execution.
- Express most control flow as node-local policy:
  - run
  - skip
  - repeat
  - call another workflow
- Keep the authored schema readable in one pass without reconstructing a graph.
- Preserve enough explicit structure for deterministic runtime execution.

## Non-Goals

- Preserving backward compatibility for the current authored schema.
- Supporting arbitrary graph fan-out as a first-class requirement in the
  simplified model.
- Reproducing every current `branch-judge` and `subworkflow-manager` capability
  in the first simplified schema.

## Design Direction

### 1. Ordered Nodes Become Canonical

The primary authored control flow should be the order of `workflow.json.nodes[]`.

Example:

```json
{
  "workflowId": "example",
  "description": "Linear workflow example",
  "defaults": {
    "nodeTimeoutMs": 120000
  },
  "entryNodeId": "manager",
  "nodes": [
    { "id": "manager", "nodeFile": "node-manager.json", "role": "manager" },
    { "id": "plan", "nodeFile": "node-plan.json" },
    { "id": "implement", "nodeFile": "node-implement.json" },
    { "id": "review", "nodeFile": "node-review.json" }
  ]
}
```

Semantics:

- default next node = the next node in array order
- `workflow-vis.json` remains visual/editor metadata only
- authored execution order no longer depends on reconstructing an edge graph

### 2. `edges[]` Is Removed From the Default Schema

The simplified model should not require `edges[]` for ordinary sequential flow.

Instead, each node may declare optional local control policy:

```typescript
interface WorkflowNodeRef {
  readonly id: string;
  readonly nodeFile: string;
  readonly role?: "manager" | "worker";
  readonly runWhen?: string;
  readonly skipWhen?: string;
  readonly repeat?: {
    readonly while: string;
    readonly maxIterations?: number;
  };
  readonly call?: WorkflowCallPolicy;
  readonly group?: string;
}
```

Intended meaning:

- `runWhen`: run this node only when the condition is true
- `skipWhen`: skip this node when the condition is true
- `repeat.while`: re-run this node while the condition is true
- `call`: this node invokes another workflow
- `group`: optional phase/lane label for readability and UI grouping

### 3. Branching Is Narrowed To Skip/Run Conditions

The current general branch graph is more powerful than most authored workflows
need.

The simplified model should intentionally support only the common cases:

- conditional omission of a step
- conditional repetition of a step
- manager-driven decision written into node output

This means:

- no first-class `branch-judge` node kind in the simplified authored schema
- no authored multi-target fan-out graph as a default feature

Rationale:

- a large portion of practical branching is just "should this next step run?"
- that can be expressed by `runWhen` or `skipWhen`
- this is easier to read than a detached boolean-emitting judge plus multiple
  outgoing edges

Limitation:

- skip-based control does not fully replace arbitrary graph branching
- it cannot naturally express one-of-many dynamic jumps or true concurrent
  fan-out

That limitation is acceptable if the product explicitly chooses a
linear-first workflow model.

### 4. Replace `subWorkflows[]` With Node-Owned Workflow Calls

The top-level `subWorkflows[]` structure should be removed from the simplified
authored schema.

There are two different concepts currently mixed under `subWorkflows[]`:

1. reusable nested execution
2. visual or conceptual grouping inside one workflow

They should be separated.

#### 4a. Reusable Nested Execution

Reusable nested execution should be represented by a call node:

```typescript
interface WorkflowCallPolicy {
  readonly workflowId: string;
  readonly input?: {
    readonly from?: "runtime" | "previous-node" | "manager";
    readonly bindings?: Readonly<Record<string, unknown>>;
  };
  readonly resultKey?: string;
}
```

Example:

```json
{
  "id": "implement-feature",
  "nodeFile": "node-implement-feature.json",
  "call": {
    "workflowId": "feature-implementation",
    "input": {
      "from": "previous-node"
    },
    "resultKey": "implementationResult"
  }
}
```

Meaning:

- this node invokes another workflow execution
- the callee is an ordinary workflow, not a structural "sub-workflow" concept
- the call result is returned to this node's output contract

#### 4b. Conceptual Grouping Inside One Workflow

If the goal is only to show that nodes belong to the same lane or phase, that
should live on the nodes themselves:

```json
{ "id": "draft", "group": "writing" }
{ "id": "review", "group": "qa" }
```

or in `workflow-vis.json`.

This grouping should not affect runtime routing by itself.

### 5. Remove Structural `input` / `output` / `subworkflow-manager` Roles

In the simplified model:

- a workflow may have zero or one manager
- workers are the ordinary executable steps
- nested workflow transport is a runtime-owned call boundary

Therefore the authored schema should not need special structural node roles for:

- `subworkflow-manager`
- `input`
- `output`

Those roles exist today because `subWorkflows[]` is a structural execution
boundary. Once nested execution becomes a call-node concept, those boundary
nodes are unnecessary in most workflows.

## Proposed Authored Shape

```json
{
  "workflowId": "example",
  "description": "Simplified linear workflow",
  "defaults": {
    "nodeTimeoutMs": 120000
  },
  "entryNodeId": "manager",
  "nodes": [
    {
      "id": "manager",
      "nodeFile": "node-manager.json",
      "role": "manager"
    },
    {
      "id": "plan",
      "nodeFile": "node-plan.json",
      "group": "planning"
    },
    {
      "id": "implement",
      "nodeFile": "node-implement.json",
      "group": "execution",
      "runWhen": "needs_changes"
    },
    {
      "id": "rerun-tests",
      "nodeFile": "node-rerun-tests.json",
      "group": "qa",
      "repeat": {
        "while": "tests_failed",
        "maxIterations": 3
      }
    },
    {
      "id": "feature-call",
      "nodeFile": "node-feature-call.json",
      "call": {
        "workflowId": "shared-feature-workflow",
        "resultKey": "featureResult"
      }
    }
  ]
}
```

## Runtime Implications

The runtime would need to change in these ways:

### Scheduler

- default scheduler becomes ordered-list progression
- "next node" is implicit unless node-local control overrides it
- queue remains an implementation detail, not the authored model

### Condition Evaluation

- `runWhen` and `skipWhen` evaluate against the latest available workflow state
- `repeat.while` evaluates against the current node output
- no graph-wide edge resolution is needed for the normal case

### Workflow Calls

- workflow-call nodes create child workflow executions explicitly
- child input/output transport is runtime-owned call state
- no separate sub-workflow manager boundary is authored

### Grouping

- `group` is UI/documentation metadata unless the runtime later adopts
  group-scoped policies

## Tradeoffs

### Gains

- authored workflows become much easier to read
- most workflows can be understood top-to-bottom without reconstructing a graph
- nested execution intent becomes local to the node that performs it
- users no longer need a separate top-level `subWorkflows[]` concept

### Losses

- general graph branching becomes unavailable or deferred
- fan-out and arbitrary re-entry are no longer first-class
- some current advanced patterns would need redesign as manager policy or
  workflow-call composition

## Recommendation

Adopt a two-tier direction:

1. make the simplified ordered-node schema the default authored model
2. keep the current graph/sub-workflow model only as a legacy or advanced mode
   during migration

If the project wants maximum conceptual simplicity, it should go further:

- deprecate `edges[]`
- deprecate `subWorkflows[]`
- deprecate structural `input` / `output` / `subworkflow-manager` node roles
- keep only manager/worker roles plus node-local control policy

## Open Questions

- Should `runWhen` and `skipWhen` both exist, or should one canonical field be
  used?
- Should workflow-call nodes be a node-ref field or a node payload `nodeType`?
- Should `group` live in `workflow.json.nodes[]` or only in `workflow-vis.json`?
- Is true fan-out intentionally out of scope, or should there be a later
  advanced control extension?

## References

- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/design-data-model.md`
- `design-docs/specs/design-unified-workflow-role-model.md`
