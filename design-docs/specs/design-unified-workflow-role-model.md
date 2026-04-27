# Unified Workflow Role Model

This document defines the target workflow model where `manager` and `worker` are the only authored node roles, and workflow nesting is treated as ordinary workflow invocation rather than as a special structural sub-workflow boundary.

## Overview

Strict authored `workflow.json` follows the step-addressed contract in `design-workflow-json.md` (`entryStepId`, `steps`, optional `managerStepId`); top-level `managerNodeId`, `entryNodeId`, and `subWorkflows` are rejected, and role-authored bundles reject structural boundary kinds such as `subworkflow-manager`, `input`, and `output`. A narrowed legacy **node-graph** load path (non-strict validation) can still run graphs declared only as `nodes[]` with inferred entry/manager via helpers, without persisting or accepting those removed top-level aliases as the active authoring model.

The target execution semantics remain:

- a workflow is an ordinary reusable execution unit
- a called workflow is only called "sub-workflow" for convenience
- a manager of a called workflow is only called "sub-manager" for convenience
- the runtime must not branch on "sub-workflow" or "sub-manager" as special roles
- a workflow may have either one manager or no manager
- a worker-only workflow must be valid

This is therefore an execution-model redesign, not another manager-kind rename.

## Goals

- Use one authored node-role vocabulary: `manager` and `worker`
- Allow `managerStepId` to be omitted for worker-only workflows
- Keep the constraint that a workflow has at most one manager
- Treat manager nodes as fixed agent coordinators rather than generic executable node types
- Make workflow-to-workflow invocation explicit without introducing structural `subworkflow-manager`, `input`, or `output` node roles
- Treat called workflows as ordinary workflows that obey the same schema as top-level workflows
- Preserve explicit branching and looping, but stop encoding workflow nesting as a special node-role system

## Non-Goals

- Redesigning agent adapters or execution backends
- Removing branch or loop control flow from the workflow model
- Preserving removed structural authoring (`subworkflow-manager`, top-level `subWorkflows`, and other keys rejected in `design-workflow-json.md`)
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

Authoring uses the step-addressed contract from `design-workflow-json.md`: `entryStepId`, `steps[]`,
the reusable node registry in `nodes[]`, and optional `managerStepId`. Session and control-plane
APIs may still expose a field named `managerNodeId`; there it is a **step** id in the same id space
as `steps[].id`, not a legacy top-level `workflow.json` alias (those names are rejected on disk).

Shape matches `AuthoredWorkflowJson` in `src/workflow/types.ts` (see `design-workflow-json.md` for
the full field list): `workflowId`, `defaults`, `entryStepId`, `nodes[]`, `steps[]`, optional
`managerStepId`, `description`, and `prompts`.

Entry rules:

- `entryStepId` names the step where a new run starts
- when a manager exists, `managerStepId` may override which step is treated as the manager anchor;
  otherwise explicit `role: "manager"` on exactly one step (or a single manager-role step) defines it
- worker-only workflows omit `managerStepId` and still declare a valid `entryStepId`

A separate, non-strict **legacy node-graph** load path (optional `nodes[]` without `steps[]`) may
still infer a graph entry node id for execution; it does not reintroduce authored top-level
`managerNodeId` / `entryNodeId` / `subWorkflows` as valid authoring (`validate.ts`
`REJECTED_AUTHORED_*` keys).

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

Current runtime contract for this transition:

- `workflowCall.workflowId` resolves another workflow bundle under the configured workflow root
- after `callerNodeId` succeeds, matching workflow calls execute in authored order
- the callee receives a reserved `runtimeVariables.workflowCall` object containing:
  - the workflow-call id
  - the parent workflow id and execution id
  - the caller node id
  - the caller business payload as `workflowCall.input`
- runtime-owned call artifacts are written under the caller execution artifact directory
- when `resultNodeId` is present, the callee result is delivered to that node as an ordinary upstream communication with transition key `workflow-call:<id>`
- the callee result is selected from the callee's published workflow output when available, and otherwise falls back to the latest succeeded callee node execution for role-authored worker-only workflows
- recursive or self-referential workflow-call chains are unsupported in this transition runtime and should fail readiness/execution rather than re-enter indefinitely

This transport stays runtime-owned rather than reintroducing structural `input` and `output` nodes into the authored graph.

## Validation Rules

The target validator should enforce:

- `role`, when present, must be `manager` or `worker`
- `control`, when present, must be `none`, `branch-judge`, or `loop-judge`
- at most one node may use `role: "manager"`
- step-addressed bundles: `entryStepId` and `steps[]` are required; optional `managerStepId` must
  reference an existing step id when present
- authored top-level `managerNodeId`, `entryNodeId`, `subWorkflows`, `workflowCalls`, and other
  keys listed under `REJECTED_AUTHORED_*` in `validate.ts` / `design-workflow-json.md` are rejected
- manager nodes must use the agent execution path only
- structural sub-workflow authoring metadata is out of scope for the active schema (validation rejects
  top-level presence rather than normalizing it)

## Runtime Implications

Removed or retired engine behavior (historical reference; do not reintroduce):

- structural `subworkflow-manager` execution branches and child-input auto-delivery
- structural cross-boundary mailbox validation keyed on sub-workflow ownership
- manager control scope split between root versus nested structural managers
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
- role-authored examples and prompts should describe grouped lanes or explicit `workflowCalls`, not structural sub-workflow ownership terms, unless the bundle is intentionally documenting legacy compatibility

## Migration Direction

This redesign supersedes the older manager-kind simplification direction.

Migration should be treated as a schema replacement, not as another alias-normalization pass:

1. introduce the new authored schema and validator
2. redesign runtime workflow-invocation semantics around explicit calls
3. update editor, examples, and templates
4. remove structural sub-workflow boundary assumptions from runtime and docs

## References

- `design-docs/specs/architecture.md`
- `design-docs/specs/design-workflow-json.md`
- earlier manager-kind simplification notes, now consolidated into `design-docs/specs/notes.md`
