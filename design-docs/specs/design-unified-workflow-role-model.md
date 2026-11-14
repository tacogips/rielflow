# Unified Workflow Role Model

This document defines the target workflow model where `manager` and `worker` are the only authored node roles, and workflow nesting is treated as ordinary workflow invocation rather than as a special structural sub-workflow boundary.

## Overview

The current implementation uses structural node kinds such as `root-manager`, `subworkflow-manager`, `input`, and `output`, plus `subWorkflows[]` boundary metadata. That model makes nested workflow execution a first-class structural concept.

The requested direction is different:

- a workflow is an ordinary reusable execution unit
- a called workflow is only called "sub-workflow" for convenience
- a manager of a called workflow is only called "sub-manager" for convenience
- the runtime must not branch on "sub-workflow" or "sub-manager" as special roles
- a workflow may have either one manager or no manager
- a worker-only workflow must be valid

This is therefore an execution-model redesign, not another manager-kind rename.

## Goals

- Use one authored node-role vocabulary: `manager` and `worker`
- Allow `workflow.managerNodeId` to be optional
- Keep the constraint that a workflow has at most one manager
- Treat manager nodes as fixed agent coordinators rather than generic executable node types
- Make workflow-to-workflow invocation explicit without introducing structural `subworkflow-manager`, `input`, or `output` node roles
- Treat called workflows as ordinary workflows that obey the same schema as top-level workflows
- Preserve explicit branching and looping, but stop encoding workflow nesting as a special node-role system

## Non-Goals

- Redesigning agent adapters or execution backends
- Removing branch or loop control flow from the workflow model
- Preserving backward compatibility for the just-landed `root-manager` / `subworkflow-manager` authored schema
- Defining every migration script detail in this document

## Core Model

### Workflow

A workflow remains the unit of definition, validation, execution, and persisted results.

It may have:

- zero or one manager
- one or more workers
- explicit branch and loop control
- explicit workflow-to-workflow calls

### Node Roles

Node role expresses responsibility, not structural nesting.

```typescript
type NodeRole = "manager" | "worker";

type NodeControlKind = "none" | "branch-judge" | "loop-judge";

interface WorkflowNodeRef {
  readonly id: string;
  readonly nodeFile: string;
  readonly role?: NodeRole;
  readonly control?: NodeControlKind;
  readonly completion?: CompletionRule;
  readonly execution?: WorkflowNodeExecutionPolicy;
}
```

Implications:

- `manager` is the only manager role
- `worker` is the default non-manager role
- manager nodes are always agent-backed coordinators for the workflow
- branch/loop behavior moves off the role axis and onto a separate control axis
- `input` and `output` are no longer structural node roles

### Manager Execution Constraint

Manager nodes are not generic execution nodes.

They always:

- execute through the agent path
- coordinate worker execution according to the workflow definition
- reject `command`, `container`, and other non-agent execution flavors

The target payload rule is:

```typescript
interface NodePayload {
  readonly id: string;
  readonly nodeType?: "agent" | "command" | "container" | "user-action";
  readonly executionBackend?: NodeExecutionBackend;
  readonly model?: string;
  readonly promptTemplate?: string;
  readonly variables: Readonly<Record<string, unknown>>;
}
```

Validation semantics:

- `role: "manager"` implies agent execution
- a manager node must not author `nodeType: "command"`, `nodeType: "container"`, or `nodeType: "user-action"`
- the editor should not offer non-agent execution-type controls for manager nodes
- worker nodes may continue to use agent or non-agent execution flavors where supported by the runtime

### Workflow Entry

The current runtime uses `managerNodeId` as the mandatory root entry. That is too strict for worker-only workflows.

The target model should use:

```typescript
interface WorkflowJson {
  readonly workflowId: string;
  readonly description: string;
  readonly defaults: WorkflowDefaults;
  readonly prompts?: WorkflowPrompts;
  readonly managerNodeId?: string;
  readonly entryNodeId?: string;
  readonly workflowCalls?: readonly WorkflowCallRef[];
  readonly nodes: readonly WorkflowNodeRef[];
  readonly edges: readonly WorkflowEdge[];
  readonly loops?: readonly LoopRule[];
  readonly branching: {
    readonly mode: "fan-out";
  };
}
```

Entry rules:

- if `managerNodeId` is present, it is the default entry node
- if `managerNodeId` is absent, `entryNodeId` must be present
- a workflow may never declare more than one manager

This document intentionally prefers explicit `entryNodeId` over implicit graph inference when no manager exists. That keeps worker-only workflows deterministic and validation-friendly.

### Workflow Invocation

Workflow nesting becomes an invocation relationship rather than a structural ownership boundary.

```typescript
interface WorkflowCallRef {
  readonly id: string;
  readonly workflowId: string;
  readonly callerNodeId: string;
  readonly resultNodeId?: string;
}
```

Principles:

- a called workflow is just another workflow execution
- the callee may itself have one manager or no manager
- no special runtime branch exists because the callee is "sub"
- "sub-workflow" and "sub-manager" remain descriptive terms only

The exact argument/result transport contract for workflow calls should be implemented as runtime-owned call artifacts and bindings, not as structural `input` and `output` nodes embedded into the authored graph.

## Validation Rules

The target validator should enforce:

- `role`, when present, must be `manager` or `worker`
- `control`, when present, must be `none`, `branch-judge`, or `loop-judge`
- at most one node may use `role: "manager"`
- `managerNodeId`, when present, must reference that manager node
- `entryNodeId` is required when `managerNodeId` is absent
- `entryNodeId` and `managerNodeId` must reference existing nodes
- manager nodes must use the agent execution path only
- structural `subWorkflows[].managerNodeId`, `inputNodeId`, `outputNodeId`, and boundary `nodeIds` metadata are removed from the authored schema

## Runtime Implications

The current engine behavior that must be removed or redesigned includes:

- root-manager-only workflow start assumptions
- subworkflow-manager-owned child-input auto-delivery
- structural cross-boundary mailbox validation keyed on sub-workflow ownership
- manager control rules that distinguish root-manager versus subworkflow-manager scope
- prompt/mailbox rendering that enumerates structural child input/output boundaries

The replacement direction is:

- manager scope is local to the current workflow execution only
- manager execution always uses the agent orchestration path
- workflow invocation is an explicit spawn/join operation
- called workflow input/output is handled by call contracts and runtime artifacts, not by special boundary nodes

## Authoring and Template Implications

Workflow authoring tools and template generators should move to:

- node role picker: `manager` or `worker`
- separate control selector for branch/loop judges
- optional workflow manager selection
- manager nodes hide non-agent execution-type configuration
- explicit workflow entry selection for manager-less workflows
- explicit workflow-call authoring instead of sub-workflow boundary editing

## Migration Direction

This redesign supersedes `design-docs/specs/design-manager-kind-simplification.md`.

Migration should be treated as a schema replacement, not as another alias-normalization pass:

1. introduce the new authored schema and validator
2. redesign runtime workflow-invocation semantics around explicit calls
3. update editor, examples, and templates
4. remove structural sub-workflow boundary assumptions from runtime and docs

## References

- `design-docs/specs/architecture.md`
- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/design-manager-kind-simplification.md`
