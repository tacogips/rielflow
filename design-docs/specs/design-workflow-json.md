# Workflow JSON Design

This document defines the authored workflow bundle format. It is the authoritative schema direction for workflow definitions saved and executed by divedra.

Supporting design:
`design-docs/specs/design-workflow-steps-and-node-reuse.md`.

## Overview

A workflow bundle is a directory containing:

- `workflow.json`
- zero or more `steps/step-*.json` files when steps are file-backed
- one reusable node payload file per file-backed node registry entry
- optional prompt files referenced by node payloads

The runtime validates the authored bundle, resolves prompt files into effective prompt text, and executes the workflow.

## Directory Layout

Typical managed layout:

```text
<workflow-root>/
  <workflow-name>/
    workflow.json
    steps/
      step-manager.json
      step-implement.json
    nodes/
      node-manager.json
      node-coder.json
    prompts/
      coder.md
      coder-self-review.md
```

Notes:

- in scoped workflow lookup, `<workflow-root>` is `<scope-root>/workflows`;
  user scope defaults to `~/.divedra/workflows` and project scope defaults to
  `<project>/.divedra/workflows`
- `workflow.json.steps[]` order is canonical for editor presentation, while step transitions define legal routing.
- runtime execution artifacts are written outside the workflow-definition directory under the configured artifact root.
- the workflow keeps an explicit reusable node registry in `workflow.json.nodes[]`; node files are not inferred by filename convention.
- worker-only workflows are valid and omit `managerStepId`.

## `node-{id}.json`

Node payload files may now include a canonical node-level description:

- `id: string`
- optional `description: string`
- other node payload fields described below

`description` is intended to capture the node's authored purpose in a short human-readable sentence. It is distinct from:

- workflow-level `description`
- `output.description`, which describes the expected output contract rather than the node's overall role

Validation rules:

- when provided, `description` must be a non-empty string

## `workflow.json`

Authored shape:

```json
{
  "workflowId": "example",
  "description": "Example workflow definition showing the authored top-level fields.",
  "defaults": {
    "nodeTimeoutMs": 120000,
    "timeoutPolicy": {
      "onTimeout": "fail"
    }
  },
  "managerStepId": "manager",
  "entryStepId": "manager",
  "nodes": [
    {
      "id": "manager-runtime",
      "nodeFile": "nodes/node-manager.json"
    },
    {
      "id": "coder",
      "nodeFile": "nodes/node-coder.json"
    }
  ],
  "steps": [
    {
      "id": "manager",
      "stepFile": "steps/step-manager.json"
    },
    {
      "id": "implement",
      "stepFile": "steps/step-implement.json"
    }
  ]
}
```

Minimal worker-only authored shape:

```json
{
  "workflowId": "worker-only-example",
  "description": "One worker starts directly from an explicit entry step.",
  "defaults": {
    "nodeTimeoutMs": 120000
  },
  "entryStepId": "main-worker",
  "nodes": [
    {
      "id": "coder",
      "nodeFile": "nodes/node-main-worker.json"
    }
  ],
  "steps": [
    {
      "id": "main-worker",
      "nodeId": "coder"
    }
  ]
}
```

### Top-Level Fields

Required:

- `workflowId: string`
- `defaults.nodeTimeoutMs: number`
- `entryStepId: string`
- `nodes: WorkflowNodeRef[]`
- `steps: WorkflowStepRef[]`

Optional:

- `description: string`
- `managerStepId`
- `defaults.timeoutPolicy`

Validation rules:

- `workflowId` is a filesystem namespace key for runtime artifacts and attachments, so it must start with an alphanumeric character and then contain only letters, digits, hyphens, or underscores
- when provided, `description` must be a non-empty string
- `entryStepId` must resolve to an authored step
- `managerStepId`, when present, must resolve to an authored step
- every step must reference a node registry entry through `nodeId`
- `steps[]` must be non-empty
- dedicated authored fields such as `workflowCalls`, `edges`, `loops`, `branching`, `subWorkflows`, and `subWorkflowConversations` are not part of the schema
- cross-workflow invocation uses the same execution-address model as ordinary step calls rather than a dedicated top-level `workflowCalls` section
- calling another workflow means targeting an explicit step in that workflow; the canonical workflow-level entry is the callee workflow's `managerStepId`, or `entryStepId` when the callee is worker-only

Not part of the schema:

- `workflowType`
- `nodeGroups`
- `workflow-ref` sub-workflow definitions

Older documents mentioned those concepts, but they are not current authored fields.

## `WorkflowNodeRef`

`workflow.json.nodes[]` entries form the reusable node registry:

- `id: string`
- `nodeFile: string` when the node uses a workflow-local payload
- optional `addon` when the node uses a built-in, scoped local, or
  host-provided add-on payload
Validation rules:

- a node reference must provide exactly one of `nodeFile` or `addon`
- `divedra/*` `addon` references are resolved from the built-in node add-on
  catalog into an effective node payload during load/validation
- non-`divedra/` add-on references may resolve from scoped local add-on roots
  under `<scope-root>/addons`, or through explicit host-provided resolver
  functions passed through the library/server load, validation, save, and
  execution options
- workflow loading does not fetch third-party packages or registry metadata
- manager steps must currently reference file-backed node definitions; the
  current add-on contract is worker-only until manager-capable add-ons are
  designed explicitly
- manager/worker semantics are authored at the step or node payload level rather than through structural `kind` metadata

### `addon`

`addon` lets an authored node reference a reusable payload instead of a
workflow-local `nodeFile`. The source may be the built-in runtime catalog, a
scoped local add-on under `<scope-root>/addons`, or an explicitly registered
host resolver.

Object form:

```json
{
  "id": "reply",
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
- add-on node references participate in the same explicit registry as file-backed nodes
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

## `WorkflowStepRef`

`workflow.json.steps[]` entries declare the executable addresses of the workflow.

Each step entry provides exactly one of:

- `stepFile`
- inline step fields in `workflow.json`

File-backed example:

```json
{
  "id": "implement",
  "stepFile": "steps/step-implement.json"
}
```

Inline example:

```json
{
  "id": "self-review",
  "nodeId": "coder",
  "promptVariant": "self-review",
  "sessionPolicy": {
    "mode": "reuse",
    "inheritFromStepId": "implement"
  },
  "transitions": [
    { "toStepId": "finish", "label": "accepted" },
    { "toStepId": "implement", "label": "needs-fix" }
  ]
}
```

Required:

- `id: string`
- exactly one of `stepFile: string` or inline `nodeId: string`

Optional inline step fields:

- `description: string`
- `role: "manager" | "worker"`
- `promptVariant: string`
- `timeoutMs: number`
- `sessionPolicy`
- `transitions`

Validation rules:

- `id` values are unique within the workflow
- exactly one of `stepFile` or inline `nodeId` authoring is allowed for a given step entry
- when `stepFile` is used, the loaded step definition must resolve to the same `id`
- `nodeId` must resolve through `workflow.json.nodes[]`
- when `role` is omitted, the step named by `managerStepId` is treated as the manager execution site and all other steps default to worker execution sites
- `transitions[]` target step ids, not node ids
- `sessionPolicy.inheritFromStepId`, when present, must reference an authored step in the same workflow
- step-local `timeoutMs`, prompt, and session settings override node defaults for that step usage site only

## `StepTransition`

`transitions[]` define the legal next execution addresses for one step.

Shape:

- `toStepId: string`
- optional `toWorkflowId: string`
- optional `label: string`

Rules:

- when `toWorkflowId` is omitted, the transition stays inside the current workflow
- when `toWorkflowId` is present, the transition targets another workflow using the same execution-address contract as any other step call
- cross-workflow transitions must target the callee workflow's callable entry step, which is normally its `managerStepId`, or `entryStepId` for a worker-only workflow
- transitions always target steps, never raw node ids
- `label` is descriptive metadata and not the routing authority

## Removed Fields

The authored workflow schema does not include:

- `CompletionRule`
- `workflowCalls[]`
- top-level `edges[]`
- `LoopRule`
- `subWorkflows[]`
- `subWorkflowConversations[]`
- branch/loop judge metadata

Routing is step-addressed through `transitions[]`. Branching, repetition, and cross-workflow manager calls are all expressed through ordinary transitions between explicit execution addresses.

## `node-{id}.json`

Nodes referenced with `addon` do not author a `node-{id}.json` file. The loader
materializes their effective payload from the selected add-on descriptor,
scoped local add-on manifest, or host resolver during validation. Save/edit
surfaces preserve the `addon` reference in `workflow.json`.

Authored shape:

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

Important rules:

- omitted `nodeType` defaults to `agent`
- `systemPromptTemplateFile` is resolved into `systemPromptTemplate` during load
- `promptTemplateFile` is resolved into `promptTemplate` during load
- `sessionStartPromptTemplateFile` is resolved into `sessionStartPromptTemplate` during load
- authored JSON must use the canonical field names

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

Presentation ordering is defined directly by the array order of `workflow.json.steps[]`.
The runtime and editor derive indent/color from workflow graph structure rather than persisted visualization metadata.

## Validation Notes

- `executionBackend` is required for agent nodes; backend identifiers encoded in `model` are rejected

## Non-Goals

These are not part of the authored workflow format:

- concurrent `nodeGroups`
- `workflowType`
- workflow-ref child workflow execution

## References

- `design-docs/specs/architecture.md`
- `design-docs/specs/design-data-model.md`
