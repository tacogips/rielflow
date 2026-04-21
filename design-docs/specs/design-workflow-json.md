# Workflow JSON Design

This document defines the current authored workflow bundle format implemented by `src/workflow/types.ts`, `src/workflow/load.ts`, and `src/workflow/validate.ts`.

Important distinction:

- authored `workflow.json` files may use the newer role-based surface and may omit several fields in the simplified ordered-node form
- the normalized runtime bundle still materializes compatibility fields such as an effective `managerNodeId`, `subWorkflows`, synthesized `edges`, and `branching`
- `src/workflow/types.ts` currently models that normalized runtime shape more closely than the raw authored JSON
- save/edit surfaces should persist authored workflow JSON, not leak compatibility-only fields such as `hasManagerNode`, an effective manager id for worker-only workflows, or derived structural `kind` values for role-authored nodes
- starter templates and save round-trips should preserve that authored-minimal omission strategy rather than eagerly writing empty compatibility/default fields back into `workflow.json`
- the same omission rule applies at node level: authored bundles should not write normalized defaults such as `completion: { "type": "none" }` or `control: "none"` unless the author explicitly needs them

## Overview

A workflow bundle is a directory containing:

- `workflow.json`
- one `node-{id}.json` file per referenced node
- optional prompt files referenced by `systemPromptTemplateFile`, `promptTemplateFile`, and `sessionStartPromptTemplateFile`

The runtime validates the authored bundle, resolves prompt files into effective prompt text, and executes the normalized workflow.

## Directory Layout

Typical managed layout:

```text
<workflow-root>/
  <workflow-name>/
    workflow.json
    nodes/
      node-divedra-manager.json
      node-main-worker.json
    prompts/
      divedra-manager.md
      main-worker.md
```

Notes:

- in scoped workflow lookup, `<workflow-root>` is `<scope-root>/workflows`;
  user scope defaults to `~/.divedra/workflows` and project scope defaults to
  `<project>/.divedra/workflows`
- `workflow.json.nodes[]` order is canonical for editor and runtime vertical ordering.
- runtime execution artifacts are written outside the workflow-definition directory under the configured artifact root.
- worker-only workflows are also valid and may omit `managerNodeId` when `entryNodeId` names the first worker node.
- starter templates should prefer this minimal authored shape, so fields such as `subWorkflows`, `edges`, `loops`, `branching`, and `defaults.containerRuntime` are omitted until the author actually needs them.
- starter templates should also omit node-level normalized defaults such as `completion: { "type": "none" }`.

## `node-{id}.json`

Node payload files may now include a canonical node-level description:

- `id: string`
- optional `description: string`
- other node payload fields described below

`description` is intended to capture the node's authored purpose in a short human-readable sentence. It is distinct from:

- workflow-level `description`
- sub-workflow `description`
- `output.description`, which describes the expected output contract rather than the node's overall role

Validation rules:

- when provided, `description` must be a non-empty string

## `workflow.json`

Current authored shape:

```json
{
  "workflowId": "example",
  "description": "Example workflow definition showing the authored top-level fields.",
  "defaults": {
    "maxLoopIterations": 3,
    "nodeTimeoutMs": 120000
  },
  "prompts": {
    "divedraPromptTemplate": "Coordinate {{workflowId}}.",
    "workerSystemPromptTemplate": "Work only on the current node."
  },
  "managerNodeId": "divedra-manager",
  "entryNodeId": "divedra-manager",
  "nodes": [
    {
      "id": "divedra-manager",
      "role": "manager",
      "nodeFile": "nodes/node-divedra-manager.json"
    },
    {
      "id": "main-worker",
      "role": "worker",
      "nodeFile": "nodes/node-main-worker.json"
    }
  ]
}
```

Current minimal worker-only authored shape:

```json
{
  "workflowId": "worker-only-example",
  "description": "One worker starts directly from an explicit entry node.",
  "defaults": {
    "maxLoopIterations": 3,
    "nodeTimeoutMs": 120000
  },
  "prompts": {
    "workerSystemPromptTemplate": "Work only on the current node."
  },
  "entryNodeId": "main-worker",
  "nodes": [
    {
      "id": "main-worker",
      "role": "worker",
      "nodeFile": "nodes/node-main-worker.json"
    }
  ]
}
```

### Top-Level Fields

Required:

- `workflowId: string`
- `defaults.maxLoopIterations: number`
- `defaults.nodeTimeoutMs: number`
- `nodes: WorkflowNodeRef[]`

Optional:

- `description: string`
- `defaults.containerRuntime`
- `prompts`
- `managerNodeId`
- `entryNodeId`
- `workflowCalls`
- `subWorkflows`
- `subWorkflowConversations`
- `edges`
- `loops`
- `branching`

Validation rules:

- `workflowId` is a filesystem namespace key for runtime artifacts and attachments, so it must start with an alphanumeric character and then contain only letters, digits, hyphens, or underscores
- when provided, `description` must be a non-empty string
- when omitted, the normalized runtime bundle uses `description: ""`
- if exactly one manager-role node exists, `managerNodeId` may be inferred
- if no manager exists, `entryNodeId` is required
- omitted `edges` are synthesized sequentially from node order
- omitted `subWorkflows`, `subWorkflowConversations`, `loops`, and `workflowCalls` normalize to empty arrays
- non-empty authored `subWorkflows` and `subWorkflowConversations` are legacy structural compatibility fields and must not be combined with authored `role` / `control` nodes
- structural boundary node kinds `subworkflow-manager`, `input`, and `output` are legacy compatibility fields and must not be combined with authored `role` / `control` nodes
- omitted `branching` normalizes to `{ "mode": "fan-out" }`
- authored `workflowCalls` are executable: the caller's `output.payload` is exposed to the callee as `runtimeVariables.workflowCall.input`, and `resultNodeId` receives the callee result through a runtime-owned `workflow-call:<id>` communication when configured

Not part of the current schema:

- `workflowType`
- `nodeGroups`
- `workflow-ref` sub-workflow definitions

Older documents mentioned those concepts, but they are not current authored fields.

## `WorkflowNodeRef`

`workflow.json.nodes[]` entries:

- `id: string`
- `nodeFile: string` when the node uses a workflow-local payload
- optional `addon` when the node uses a built-in, scoped local, or
  host-provided add-on payload
- optional `role: "manager" | "worker"`
- optional `control: "none" | "branch-judge" | "loop-judge"`
- optional `kind: NodeKind`
- optional `completion: CompletionRule`
- optional `group`
- optional `repeat`

Recommended authored direction:

- use `role` for manager-versus-worker intent
- use `control` for judge semantics
- omit structural `kind` in newly authored ordered-node workflows

Current compatibility note:

- the validator still accepts structural `kind` metadata where the current runtime needs it
- the normalized runtime continues to derive structural `kind` values such as `root-manager`, `subworkflow-manager`, `input`, and `output`
- role/control-authored nodes must not author structural boundary `kind` values directly
- role-authored grouped examples should describe lanes/stages or explicit `workflowCalls`; only explicit legacy compatibility examples should foreground structural sub-workflow vocabulary

Current `NodeKind` values:

- `task`
- `branch-judge`
- `loop-judge`
- `root-manager`
- `subworkflow-manager`
- `input`
- `output`

Validation rules:

- a node reference must provide exactly one of `nodeFile` or `addon`
- `divedra/*` `addon` references are resolved from the built-in node add-on
  catalog into an effective node payload during load/validation
- non-`divedra/` add-on references may resolve from scoped local add-on roots
  under `<scope-root>/addons`, or through explicit host-provided resolver
  functions passed through the library/server load, validation, save, and
  execution options
- workflow loading does not fetch third-party packages or registry metadata
- current add-ons are worker-only; manager-role add-on references are rejected
- manager-role nodes must stay on the agent execution path
- `workflow.managerNodeId`, when present, must resolve to the effective root manager in the normalized runtime bundle
- structural sub-workflow validation still applies when `subWorkflows[]` are authored

### `addon`

`addon` lets an authored node reference a reusable payload instead of a
workflow-local `nodeFile`. The source may be the built-in runtime catalog, a
scoped local add-on under `<scope-root>/addons`, or an explicitly registered
host resolver.

Object form:

```json
{
  "id": "reply",
  "role": "worker",
  "addon": {
    "name": "divedra/chat-reply-worker",
    "version": "1",
    "config": {
      "textTemplate": "{{inbox.latest.output.payload.text}}",
      "visibility": "public"
    },
    "inputs": {
      "replyPrefix": "Answer"
    }
  }
}
```

Rules:

- saved workflows should prefer object form with explicit `version`
- string shorthand may be accepted for built-in add-ons, but should normalize to
  explicit object form in authoring tools
- unknown add-on names or unsupported versions fail validation
- `divedra/` names are reserved for built-in add-ons and are not loaded from
  scoped local add-on roots
- local add-on lookup uses `(name, version)` and searches the caller workflow's
  owning scope, then project scope, then user scope, before falling back to
  host-provided resolvers
- `addon.config` is validated by the selected add-on descriptor
- `addon.env`, when present, maps add-on environment variable names to divedra
  runtime environment variable names for add-ons whose descriptors support
  explicit environment bindings; no ambient environment variables are forwarded
  implicitly. Required source variables are reported by runtime readiness before
  execution, and empty required values are treated as unavailable; optional
  bindings set `required: false`
- `addon.inputs`, when present, is copied into the resolved node payload
  `variables`
- add-on node references must author `role: "worker"` explicitly; compatibility
  inference from `kind`, `control`, or `repeat` does not satisfy the add-on
  worker-only contract
- save/edit surfaces preserve the authored `addon` reference rather than writing
  generated node payload JSON

Initial built-in add-ons:

- `divedra/chat-reply-worker`: worker node that replies to the chat event target
  in `runtimeVariables.event` through the event reply adapter registry
- `divedra/codex-worker`: worker node that resolves to an `agent` payload using
  `executionBackend: "codex-agent"`
- `divedra/claude-code-worker`: worker node that resolves to an `agent` payload
  using `executionBackend: "claude-code-agent"`
- `divedra/x-gateway-read`: worker node that runs the read-only
  `x-gateway-reader graphql query` surface in a Docker-compatible container
- `divedra/x-gateway`: worker node that runs the full `x-gateway graphql query`
  surface for intentional query or mutation documents in a Docker-compatible
  container
- `divedra/mail-gateway-read`: worker node that runs the read-only
  `mail-gateway-reader graphql --query` surface in a Docker-compatible
  container
- `divedra/mail-gateway`: worker node that runs the full
  `mail-gateway graphql --query` surface for intentional query or send-mutation
  documents in a Docker-compatible container

Detailed design:
`design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`.

## `CompletionRule`

Current shape:

```json
{
  "type": "checklist",
  "config": {
    "required": ["ready"]
  }
}
```

Supported types:

- `none`
- `checklist`
- `score-threshold`
- `validator-result`

Current config usage:

- `checklist`: `config.required: string[]`
- `score-threshold`: `config.threshold: number`
- `validator-result`: optional `config.resultField: string`, defaults to `validatorResult`

## `WorkflowEdge`

Shape:

- `from: string`
- `to: string`
- `when: string`
- optional `priority: number`

Current semantics:

- matching remains fan-out even when `priority` is present
- `priority` is metadata only in the current runtime

### Condition Expression Language

`when` expressions support:

- identifiers such as `approved`
- literals `always`, `never`, `true`, `false`
- `!`, `&&`, `||`
- parentheses

Evaluation checks:

1. `output.when.<identifier>`
2. `output.<identifier> === true`

This expression language is used for:

- edge routing
- loop `continueWhen`
- loop `exitWhen`
- conversation `stopWhen`

## `LoopRule`

Shape:

- `id: string`
- `judgeNodeId: string`
- `continueWhen: string`
- `exitWhen: string`
- optional `maxIterations: number`
- optional `backoffMs: number`

Validation rules:

- `judgeNodeId` must reference a `loop-judge`
- `maxIterations`, when omitted, falls back to `defaults.maxLoopIterations`

Implementation note:

- `backoffMs` is validated as schema, but the current engine does not apply direct loop sleeping from that field.

## `SubWorkflowRef`

`subWorkflows[]` remains part of the current compatibility surface, but it is no longer the recommended authoring direction for new simple workflows. Prefer the ordered-node role-based form unless a feature still depends on structural grouped-lane routing.

Current shape:

- `id: string`
- `description: string`
- `managerNodeId: string`
- `inputNodeId: string`
- `outputNodeId: string`
- `nodeIds: string[]`
- `inputSources: SubWorkflowInputSource[]`
- optional `block`

There is only one sub-workflow form in the current schema: explicit boundary metadata inside the same workflow definition.

### `inputSources`

Supported types:

- `human-input`
- `workflow-output`
- `node-output`
- `sub-workflow-output`

Optional source selectors:

- `workflowId`
- `nodeId`
- `subWorkflowId`
- `selectionPolicy`

Current `selectionPolicy.mode` values:

- `explicit`
- `latest-succeeded`
- `latest-any`
- `by-loop-iteration`

### `block`

Supported values:

- `plain`
- `branch-block`
- `loop-body`

Rules:

- `plain` is the default structural grouping case
- `branch-block` must be entered from a `branch-judge` edge to the sub-workflow manager
- `loop-body` must reference a loop id and be re-entered by that loop's continue edge

## `SubWorkflowConversation`

Shape:

- `id: string`
- `participants: string[]`
- `maxTurns: number`
- `stopWhen: string`

Current implementation behavior:

- participants are ordered
- turns are round-robin by participant order
- the runtime emits at most one new turn per evaluation pass

## `node-{id}.json`

Nodes referenced with `addon` do not author a `node-{id}.json` file. The loader
materializes their effective payload from the selected add-on descriptor,
scoped local add-on manifest, or host resolver during validation. Save/edit
surfaces preserve the `addon` reference in `workflow.json`.

Current authored shape:

```json
{
  "id": "implement",
  "executionBackend": "codex-agent",
  "model": "gpt-5-nano",
  "promptTemplateFile": "prompts/implement.md",
  "variables": {},
  "sessionPolicy": {
    "mode": "reuse"
  },
  "output": {
    "description": "Return the implementation result."
  }
}
```

### Core Fields

Required:

- `id`
- `variables`

Optional:

- `nodeType`
- `executionBackend`
- `model`
- `sessionPolicy`
- `systemPromptTemplate`
- `systemPromptTemplateFile`
- `promptTemplate`
- `promptTemplateFile`
- `sessionStartPromptTemplate`
- `sessionStartPromptTemplateFile`
- `command`
- `container`
- `durability`
- `argumentsTemplate`
- `argumentBindings`
- `templateEngine`
- `timeoutMs`
- `output`

Important normalization rules:

- omitted `nodeType` defaults to `agent`
- `systemPromptTemplateFile` is resolved into `systemPromptTemplate` during load
- `promptTemplateFile` is resolved into `promptTemplate` during load
- `sessionStartPromptTemplateFile` is resolved into `sessionStartPromptTemplate` during load
- legacy prompt/variable aliases are rejected; authored JSON must use the canonical field names

### `nodeType`

Current supported authored values:

- `agent`
- `command`
- `container`

Current execution reality:

- `agent`, `command`, and `container` nodes run in `runWorkflow()`

### `executionBackend`

Current backend values:

- `codex-agent`
- `claude-code-agent`
- `official/openai-sdk`
- `official/anthropic-sdk`

`model` is backend-specific model naming. It is required for executable `agent` nodes.

### `sessionPolicy`

Shape:

```json
{
  "mode": "new"
}
```

Supported modes:

- `new`
- `reuse`

`reuse` allows the runtime to request the same backend-managed session for repeated executions of the same node within one workflow run.

When a node also declares `sessionStartPromptTemplate`, that template is rendered only on the first turn of a fresh backend session for that node.

## Structured Arguments

`argumentsTemplate` and `argumentBindings` let the runtime build structured arguments separately from prompt text.

`ArgumentBinding` fields:

- `targetPath`
- `source`
- optional `sourceRef`
- optional `sourcePath`
- optional `required`

Supported `source` values:

- `variables`
- `node-output`
- `sub-workflow-output`
- `workflow-output`
- `human-input`
- `conversation-transcript`

## Output Contracts

`output` shape:

- optional `description`
- optional `jsonSchema`
- optional `maxValidationAttempts`

Rules:

- at least one of `description` or `jsonSchema` must be present when `output` exists
- the runtime validates candidate payloads before writing final `output.json`
- candidate-file submission is only allowed when `output` is configured

## Node Order

Vertical ordering is defined directly by the array order of `workflow.json.nodes[]`.
The runtime and editor derive indent/color from workflow graph structure rather than persisted visualization metadata.

## Current Compatibility Notes

- `subWorkflows[].inputs` is rejected; authored JSON must use `inputSources`
- `subWorkflowConversations[].participantsIds` is rejected; authored JSON must use `participants`
- `executionBackend` is required for agent nodes; backend identifiers encoded in `model` are rejected

## Current Non-Goals

These are not part of the current authored workflow format:

- concurrent `nodeGroups`
- `workflowType`
- workflow-ref child workflow execution

## References

- `design-docs/specs/architecture.md`
- `design-docs/specs/design-data-model.md`
