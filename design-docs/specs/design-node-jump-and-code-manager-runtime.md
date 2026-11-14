# Node Jump And Code Manager Runtime Design

This document defines the runtime model that replaces authored `if` / `loop` constructs with step-authored jump directives, moves execution status into the runtime-owned output mail envelope, and introduces a deterministic `code` manager as the default manager execution mode.

It updates the design direction currently described across:

- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/design-node-mailbox.md`
- `design-docs/specs/design-node-output-contract.md`
- `design-docs/specs/design-node-session-reuse.md`
- `design-docs/specs/architecture.md`

## Overview

The authored/runtime direction is:

- authored workflows do not use dedicated `if` / `loop` constructs
- a step's accepted output mail may declare the next step to run
- the runtime persists execution status (`success`, `fail`, `timeout`) in that same output mail envelope
- the same reusable node may be revisited many times in one workflow execution, with distinct mailbox instances for each visit
- node sessions should be resumable with a changed prompt so the same backend session can perform follow-up work such as self-review
- timeout behavior should be workflow-defined, overridable per node call, and executable by a deterministic engine
- manager nodes should default to `code`, with `llm` retained as an experimental alternative
- cross-workflow manager calls should use the same execution-address contract as ordinary worker-step calls

The target architecture is therefore:

- workflow authoring defines allowed jumps and timeout policy
- worker nodes return accepted output mail envelopes
- a manager engine reads those envelopes and executes the next transition
- `code` manager executes those rules deterministically
- `llm` manager may still propose actions, but only through the same validated control contract

This runtime also forms the execution substrate for `auto improve mode` supervision, where a paired `divedra superviser` workflow monitors failure/stall outcomes and decides rerun versus workflow repair. Supporting design: `design-docs/specs/design-auto-improve-superviser-mode.md`.

Authored workflow model:

- workflows use `workflow -> steps[] -> nodeId`
- `workflow.json.nodes[]` is the reusable node registry and is never derived by filename convention
- jumps are step-addressed

Supporting design: `design-docs/specs/design-workflow-steps-and-node-reuse.md`.

## Goals

- Remove authored `if` / `loop` primitives from the primary workflow schema.
- Express control flow through node output mail plus workflow-validated jump edges.
- Persist runtime-generated status metadata in the node output mail envelope.
- Support repeated visits to the same node without mailbox collision or ambiguous latest-output selection.
- Support same-session node continuation with a different prompt variant.
- Keep workflow-level default timeout plus per-step, per-node, and per-invocation overrides.
- Make timeout reaction deterministic and policy-driven.
- Make `code` manager the default manager mode.
- Keep `llm` manager available as an experimental alternative while making `code` manager authoritative.
- Treat calling another workflow manager and calling another worker step as the same runtime primitive, distinguished only by the execution address being targeted.
- Treat cross-workflow calls as ordinary step transitions (`steps[].transitions` with `toWorkflowId` / `resumeStepId`); validation rejects authored top-level `workflow.workflowCalls`, and the runtime derives deterministic dispatch from transitions rather than maintaining a parallel orchestration model.

## Non-Goals

- Freeform arbitrary jumps to nodes not declared in the workflow.
- Letting worker nodes write canonical downstream inboxes directly.
- Guaranteeing backend-session reuse after a hard timeout for every backend.
- Preserving authored `loops[]`, `branching`, `branch-judge`, or `loop-judge` in the target schema.

## Target Authored Model

### Workflow JSON

The authored workflow model is step-addressed:

- `workflow.json` defines `workflowId`, `description`, `defaults`, `nodes`, `entryStepId`, optional `managerStepId`, and `steps`
- each step defines its outgoing `transitions`
- authored `loops[]`, `branching`, and branch/loop judge metadata are not part of the schema

Rules:

- transitions define the legal jump graph
- looping is expressed by an ordinary back-edge such as `self-review -> implement`
- branching is expressed by multiple outgoing transitions from the same step
- the chosen next execution address must match one declared outgoing transition from the current step unless the runtime is performing a workflow-terminal action
- cross-workflow invocation is not a dedicated `workflowCalls` section; it is an ordinary transition or manager decision targeting another workflow's callable entry step

### Workflow Defaults

`workflow.json.defaults` remains the home of execution defaults and gains timeout-reaction policy:

```json
{
  "defaults": {
    "nodeTimeoutMs": 120000,
    "timeoutPolicy": {
      "onTimeout": "fail",
      "maxRetries": 0,
      "retryTimeoutIncrementMs": 60000
    }
  }
}
```

Target timeout policy fields:

- `onTimeout: "fail" | "retry-same-step" | "jump-to-step"`
- `maxRetries?: number`
- `retryTimeoutIncrementMs?: number`
- `jumpStepId?: string`
- `reuseBackendSession?: boolean`

Rules:

- `nodeTimeoutMs` stays the workflow default timeout
- `timeoutPolicy` is evaluated by the manager engine, not by workers
- `jumpStepId` is required when `onTimeout = "jump-to-step"`
- `retry-same-step` retries the timed-out step with a new node invocation record
- retry timeout increases by `retryTimeoutIncrementMs` unless an explicit per-call timeout override is supplied

### Node Payload

Manager-capable and worker-capable node payloads gain or retain these concepts:

- `timeoutMs?: number`
- `sessionPolicy?: { "mode": "new" | "reuse" }`
- `promptTemplate` / `promptTemplateFile`
- optional `promptVariants`
- optional `managerType`

Target additions:

```json
{
  "id": "implement",
  "sessionPolicy": { "mode": "reuse" },
  "promptTemplateFile": "prompts/implement.md",
  "promptVariants": {
    "self-review": {
      "promptTemplateFile": "prompts/implement-self-review.md"
    }
  }
}
```

```json
{
  "id": "workflow-manager",
  "managerType": "code"
}
```

Rules:

- `managerType` is valid only for manager-role nodes
- manager default is `code` when `managerType` is omitted
- `managerType: "llm"` is experimental and opt-in
- `managerType: "llm"` requires agent-style execution configuration
- `managerType: "code"` is runtime-owned and does not require LLM prompt/model fields
- `promptVariants` let the runtime resume or revisit a node with a different prompt while keeping the same node identity
- if `sessionPolicy.mode = "reuse"` and the backend supports session continuation, a revisit may continue the prior backend session for that node

## Output Mail Contract

The target model does not use a separate authored `system` mailbox for node status.
Instead, the runtime-owned accepted output mail envelope carries both business payload and system metadata.

Canonical shape:

```json
{
  "workflowId": "feature-workflow",
  "workflowExecutionId": "wfexec-000001",
  "stepId": "implement",
  "nodeId": "coder",
  "nodeExecId": "exec-000014",
  "mailboxInstanceId": "feature-workflow-implement-20260424T123456789Z-0001",
  "status": "success",
  "reason": "implementation completed",
  "startedAt": "2026-04-24T12:34:00.000Z",
  "finishedAt": "2026-04-24T12:34:56.789Z",
  "timeoutMs": 120000,
  "payload": {
    "summary": "implemented the change"
  },
  "next": {
    "stepId": "self-review",
    "promptVariant": "self-review",
    "sessionMode": "reuse"
  }
}
```

### Required Runtime Fields

- `status: "success" | "fail" | "timeout"`
- `reason?: string`
- `startedAt`
- `finishedAt`
- `timeoutMs`
- `stepId`
- `mailboxInstanceId`

### Optional Jump Directive

`next` may include:

- `stepId`
- `workflowId?`
- `promptVariant?`
- `sessionMode?: "new" | "reuse"`
- `timeoutMs?`
- `reason?`

Rules:

- `next.stepId` names the next requested step
- `next.workflowId`, when present, names the target workflow for a cross-workflow call
- the runtime validates `(next.workflowId ?? currentWorkflowId, next.stepId)` against the current step's authored transitions
- when `next.workflowId` targets another workflow, `next.stepId` must resolve to that workflow's callable entry step, normally its `managerStepId`, or `entryStepId` when the workflow is worker-only
- `next.promptVariant` selects an alternate prompt for the next invocation
- `next.sessionMode` overrides the node default for that invocation only
- `next.timeoutMs` overrides the effective timeout for that invocation only
- worker-authored `next` is a request, not final authority; manager/runtime validation still applies

### Runtime-Owned Status Production

Status metadata is runtime-owned even when the worker supplied the business payload.

Examples:

- normal completion writes `status = "success"`
- validation failure after retry exhaustion writes `status = "fail"`
- execution timeout writes `status = "timeout"`

When a node times out before producing a valid business payload, the runtime still publishes an output mail envelope with:

- `status = "timeout"`
- `reason` describing the timeout
- no business `payload`, or `payload = {}` by policy
- no worker-authored `next`

That timeout envelope is then consumed by the manager engine to decide retry, jump, or workflow failure.

## Mailbox Instance Model For Revisited Nodes

Repeated visits to the same `nodeId` must never share the same mailbox directory.

### New Identifier

Add `mailboxInstanceId` as the filesystem-visible identity for one node invocation.

Format:

- `{workflowId}-{stepId}-{timestampCompact}-{sequenceAbbrev}`

Example:

- `feature-workflow-implement-20260424T123456789Z-0001`

Rules:

- `timestampCompact` is UTC and sortable
- `sequenceAbbrev` disambiguates same-timestamp collisions
- `mailboxInstanceId` is unique within one `workflowExecutionId`
- `nodeExecId` remains the stable runtime/api execution identifier
- one `nodeExecId` maps to exactly one `mailboxInstanceId`

### Directory Layout

Target execution-local layout:

```text
{artifact-root}/{workflowId}/executions/{workflowExecutionId}/nodes/{nodeId}/{mailboxInstanceId}/
  input.json
  output.json
  meta.json
  mailbox/
    inbox/
    outbox/
```

Consequences:

- the same node may appear multiple times under its own node directory
- "latest output for node X" becomes policy-driven and cannot rely on one fixed node path
- mailbox readers must resolve by `nodeExecId`, `mailboxInstanceId`, or an explicit selection policy rather than by plain `nodeId`
- canonical routed communication artifacts under `communications/{communicationId}/` remain the source of truth for inter-node delivery; `mailboxInstanceId` disambiguates execution-local node artifacts and mailbox views only

## Same-Session Continuation And Prompt Changes

The runtime must support targeted node continuation where:

- the same node is called again
- the backend session may be reused
- a different prompt variant may be selected

This is required for flows such as:

- implementation -> same-session self-review
- timeout recovery with a stricter or narrower follow-up prompt
- manager-requested clarification pass on the same node

### Invocation Contract

The internal step-call request should support:

- `targetWorkflowId?`
- `targetStepId`
- `nodeId`
- `promptVariant?: string`
- `sessionMode?: "new" | "reuse"`
- `timeoutMs?: number`
- `managerMessage?: JsonObject`
- `resumeFromNodeExecId?: string`

Rules:

- `targetWorkflowId`, when omitted, defaults to the current workflow
- `targetStepId` plus `targetWorkflowId` form the execution address and resolve to the backing node before dispatch
- `nodeId` must match the node resolved from that execution address
- `resumeFromNodeExecId` identifies which prior node execution is being continued conceptually
- backend-session continuation remains best-effort and depends on `sessionPolicy` plus backend support
- after a hard timeout, reuse is allowed only when the adapter/backend explicitly reports that the prior backend session is still resumable
- otherwise timeout recovery starts a new backend session but still records linkage through `resumeFromNodeExecId`

## Manager Runtime Model

### Shared Manager Decision Contract

Both manager modes must produce the same decision shape:

- `action: "call-step" | "complete-workflow" | "fail-workflow"`
- `targetWorkflowId?`
- `targetStepId?`
- `promptVariant?`
- `sessionMode?`
- `timeoutMs?`
- `reason`

The execution engine validates that decision against workflow structure, node capabilities, and timeout policy before dispatch.

Rules:

- step-authored workflows populate `targetStepId`
- `targetWorkflowId`, when omitted, means the current workflow
- `targetStepId` resolves within `targetWorkflowId ?? currentWorkflowId` and then to its backing node definition before dispatch
- targeting another workflow is just a call to that workflow's callable entry step rather than a separate `start-sub-workflow` primitive
- authored `workflowCalls` is rejected at validation; cross-workflow dispatch uses `steps[].transitions` and the same normalized call contract as local jumps (no separate compatibility projection layer)

### `code` Manager

`code` manager is the default and authoritative near-term path.

Responsibilities:

- read accepted output mail envelopes
- validate jump requests against step transitions
- synthesize timeout recovery from `timeoutPolicy`
- launch node revisits with explicit `promptVariant`, `sessionMode`, and timeout overrides
- dispatch cross-workflow manager calls through the same validated `call-step` path
- keep deterministic workflow progression without asking an LLM to interpret routing rules
- keep one normalized call abstraction for local worker-step calls and cross-workflow manager-step calls (no retained compatibility wrappers for removed authored shapes)

Decision order:

1. If the current node output status is `timeout`, apply effective timeout policy.
2. If the current node output status is `fail`, fail the workflow unless workflow policy says otherwise.
3. If the output has `next.stepId`, validate that jump and call the target execution address.
4. If the current execution address has one valid authored downstream transition and no `next`, use that transition implicitly.
5. If there is no next execution address, complete the workflow when the current node is terminal; otherwise fail validation.

### `llm` Manager

`llm` manager is retained as experimental.

Responsibilities:

- propose the same normalized manager decision contract
- optionally reason about ambiguous or high-level planning tasks

Constraints:

- `llm` manager does not bypass edge validation
- `llm` manager does not own timeout policy directly
- `llm` manager uses the same mailbox/output contract as `code`
- current `llm` manager tests may remain while the repository adds equivalent `code` manager coverage

## Timeout Semantics

Timeout resolution order:

1. per-invocation override from the manager decision or node output `next.timeoutMs`
2. step-local `timeoutMs`
3. node payload `timeoutMs`
4. workflow default `defaults.nodeTimeoutMs`

Timeout reaction resolution order:

1. per-node timeout policy override, if added later
2. workflow default `defaults.timeoutPolicy`

Required behaviors:

- the runtime aborts execution at the effective timeout
- the runtime writes a timeout output mail envelope
- the manager engine evaluates timeout policy after that envelope is persisted
- timeout retry creates a fresh `nodeExecId` and `mailboxInstanceId`
- timeout retry may increase the timeout
- timeout retry may target the same node or a fallback jump node depending on policy

## Validation Rules

The target validator should enforce:

- authored `loops[]` rejected
- authored `branching` rejected
- authored `workflowCalls[]` rejected in the target schema
- authored `control: "branch-judge" | "loop-judge"` rejected in the target schema
- `next.stepId` must match an authored outgoing transition
- `next.workflowId`, when present, must resolve to an accessible workflow definition
- cross-workflow targets must resolve to the callee workflow's callable entry step
- `next.promptVariant` must exist on the target node when provided
- `managerType` allowed only on manager-role nodes
- `managerType: "llm"` flagged experimental in diagnostics and documentation
- `timeoutPolicy.jumpStepId` must name a valid step and be reachable by policy, not by undeclared free jump

## Migration Requirement

Target state (current direction): authored `workflowCalls` is rejected; cross-workflow work is expressed only through step transitions and runtime-derived dispatch rows. Local worker calls and cross-workflow calls share validation, dispatch, result publication, and retry handling through one execution-address path.

## Testing Requirements

Add `code` manager coverage for at least:

- valid jump selection from output mail `next.stepId`
- rejection of undeclared jump targets
- repeated invocation of the same node with unique `mailboxInstanceId`
- same-session revisit with `promptVariant` and `sessionMode = "reuse"`
- timeout envelope publication
- timeout retry with increased timeout
- timeout jump to fallback node
- workflow completion when no further jump is required

## Documentation Notes

- Workflow examples should author step transitions instead of explicit branch/loop constructs.
- Manager starter templates should default to `managerType: "code"` or omit the field and rely on the new default.
- Documentation should describe branch/loop control through jump-driven routing rather than through dedicated authored primitives.

## References

See also:

- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/design-node-mailbox.md`
- `design-docs/specs/design-node-output-contract.md`
- `design-docs/specs/design-node-session-reuse.md`
- `design-docs/specs/architecture.md`
- `design-docs/specs/design-auto-improve-superviser-mode.md`
- `design-docs/specs/design-workflow-steps-and-node-reuse.md`
