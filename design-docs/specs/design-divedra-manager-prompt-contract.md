# Divedra Manager Prompt Contract

This document defines the prompt contract for `divedra` manager execution and the gap between the current deterministic runtime and the target manager-driven orchestration model.

## Overview

The existing runtime already models:

- root and sub-workflow manager ownership,
- mailbox-based handoff,
- sub-workflow boundaries,
- conversation routing.

What was missing was the prompt contract that makes the manager LLM explicitly aware of:

- the workflow purpose,
- the workflow structure in its current scope,
- why each child node/sub-workflow is being asked to act,
- what value each child is expected to return,
- how parent/subworkflow-manager nesting should be interpreted.

The prior iteration still left one boundary mismatch: the root `divedra` received user input from `runtimeVariables.humanInput` rather than from a mailbox-visible external handoff, and completed workflow output was not published through an external mailbox artifact.

Near-term policy:

- do not add dedicated runtime state management or order-management logic just to determine the next legal node
- instead, make the manager prompt carry enough workflow structure and progress context that the manager calls nodes in authored workflow order

## Phase 1 Contract

Phase 1 adds prompt-level semantics without replacing the deterministic execution engine.

### Workflow-Level Prompt Configuration

`workflow.json` may provide:

- `prompts.divedraPromptTemplate`
- `prompts.workerSystemPromptTemplate`

The root/subworkflow-manager execution prompt becomes:

1. default `divedra system prompt` from a repository markdown asset
2. workflow-rendered `prompts.divedraPromptTemplate`
3. runtime-generated workflow context block
4. node-level `promptTemplate`

Worker/input/output/judge execution prompt becomes:

1. workflow-rendered `prompts.workerSystemPromptTemplate`
2. runtime-generated node reason/context block
3. node-level `promptTemplate`

### Runtime-Generated Context

The runtime composes prompt context that includes:

- workflow id and workflow purpose,
- explicit given data / assembled arguments for the current execution,
- top-level runtime inputs such as `humanInput` even when a manager node does not declare custom argument bindings,
- node id and node kind,
- reason the node is running,
- expected returned value,
- for manager nodes, a scoped child catalog that lists each child node or sub-workflow together with its reason, prompt seed, and expected return contract,
- current sub-workflow scope when applicable,
- root workflow structure summary for root manager nodes,
- enough progress context from prior accepted outputs/executions that the manager can infer where it is in the workflow,
- mailbox/upstream payload summary.

This ensures every node instruction contains the "why" of the work rather than only the task wording.
It also ensures `divedra` can inspect the concrete child contracts it is expected to plan, invoke, and assess.

For the near-term manager-driven runtime direction, this prompt context also carries the main workflow-order discipline:

- the manager should treat the authored workflow order, branch structure, and loop structure as binding instructions
- the manager should call the next node in that authored order rather than treating child selection as open-ended planning
- explicit repeated loops in the workflow should be followed as written
- sub-divedra managers should stay within their owned child scope

This keeps workflow awareness in the manager prompt rather than requiring a second runtime order-management subsystem.

## Phase 2 Manager Control Payload

The runtime now recognizes an optional reserved field in manager output payloads:

```json
{
  "plan": {},
  "assessment": {},
  "managerControl": {
    "actions": [
      { "type": "start-sub-workflow", "subWorkflowId": "review-sw" },
      { "type": "deliver-to-child-input", "inputNodeId": "review-input" },
      { "type": "retry-node", "nodeId": "draft-step" }
    ]
  }
}
```

Supported action semantics:

- `start-sub-workflow`
  - root `divedra` only
  - treats a sub-workflow as one child node
  - repeating the same action re-invokes that child sub-workflow as a rerun unit when the manager judges the prior result insufficient
  - the runtime always delivers the manager output through the owned `subworkflow-manager` mailbox
- `deliver-to-child-input`
  - `subworkflow-manager` only
  - forwards the current manager output through mailbox delivery to its owned input node
  - this is the nested "treat parent instruction like user input" handoff point
- `retry-node`
  - any manager node
  - re-queues a child node for re-execution after manager assessment judges prior output insufficient
  - root `divedra` may retry only root-scope direct child nodes; it must not target nodes owned by a sub-workflow
  - to re-run a sub-workflow child unit, root `divedra` repeats `start-sub-workflow` for that `subWorkflowId`

Override rule:

- when a manager returns `managerControl.actions`, the runtime treats that manager as authoritative for its manager-owned planning category in that execution:
  - root manager: sub-workflow start planning
  - subworkflow-manager: child input forwarding
- if `managerControl` is omitted, the existing deterministic fallback planners remain active

## Remaining Limitation

This iteration does not replace all execution semantics with action lists.

The runtime still uses:

- workflow edges and `when` expressions for normal node-to-node transitions,
- loop/branch rules for structural control flow,
- mailbox publication/runtime-owned delivery mechanics,
- conversation scheduling rules.

Structural constraints now enforced by validation/runtime:

- every `subWorkflow` must declare `managerNodeId`
- `managerNodeId` must reference a `subworkflow-manager`
- a `subworkflow-manager` may dispatch only to its owned `inputNodeId`
- root `divedra` may not use `retry-node` to pierce into nodes owned by a sub-workflow boundary

Manager control is therefore explicit for manager-owned dispatch/retry decisions, but not yet a full replacement for structural workflow semantics.

## Root Mailbox Boundary

The root workflow boundary now follows the same mailbox model as nested sub-workflows:

- session start with `runtimeVariables.humanInput` creates an external mailbox communication addressed to the root manager node
- the root manager therefore sees initial user instruction both as explicit given data and as consumed upstream mailbox input
- when a root-scope `output` node succeeds, its business payload becomes `runtimeVariables.workflowOutput` for later readiness/planning checks
- session completion publishes the final workflow result to an external mailbox communication artifact, preferring the latest successful root-scope `output` node result when a manager runs again afterward

This keeps parent-to-child and external-to-root handoff semantics aligned: both enter the active `divedra` scope through mailbox delivery rather than through an out-of-band runtime-only channel.
