# Workflow JSON Design

This document defines the current authored workflow bundle format implemented by `src/workflow/types.ts`, `src/workflow/load.ts`, and `src/workflow/validate.ts`.

## Overview

A workflow bundle is a directory containing:

- `workflow.json`
- `workflow-vis.json`
- one `node-{id}.json` file per referenced node
- optional prompt files referenced by `promptTemplateFile`

The runtime validates the authored bundle, resolves prompt files into effective prompt text, and executes the normalized workflow.

## Directory Layout

Typical layout:

```text
<workflow-root>/
  <workflow-name>/
    workflow.json
    workflow-vis.json
    node-divedra-manager.json
    node-main-divedra.json
    node-workflow-input.json
    node-workflow-output.json
    prompts/
      divedra-manager.md
      main-divedra.md
      workflow-input.md
      workflow-output.md
```

Notes:

- `workflow-vis.json` is canonical for editor ordering but can be synthesized by the loader when missing.
- runtime execution artifacts are written outside the workflow-definition directory under the configured artifact root.

## `workflow.json`

Current authored shape:

```json
{
  "workflowId": "example",
  "description": "Example workflow",
  "defaults": {
    "maxLoopIterations": 3,
    "nodeTimeoutMs": 120000
  },
  "prompts": {
    "divedraPromptTemplate": "Coordinate {{workflowId}}.",
    "workerSystemPromptTemplate": "Work only on the current node."
  },
  "managerNodeId": "divedra-manager",
  "subWorkflows": [],
  "subWorkflowConversations": [],
  "nodes": [],
  "edges": [],
  "loops": [],
  "branching": {
    "mode": "fan-out"
  }
}
```

### Top-Level Fields

Required:

- `workflowId: string`
- `description: string`
- `defaults.maxLoopIterations: number`
- `defaults.nodeTimeoutMs: number`
- `managerNodeId: string`
- `subWorkflows: SubWorkflowRef[]`
- `nodes: WorkflowNodeRef[]`
- `edges: WorkflowEdge[]`
- `branching.mode: "fan-out"`

Optional:

- `defaults.containerRuntime`
- `prompts`
- `subWorkflowConversations`
- `loops`

Not part of the current schema:

- `workflowType`
- `nodeGroups`
- `workflow-ref` sub-workflow definitions

Older documents mentioned those concepts, but they are not current authored fields.

## `WorkflowNodeRef`

`workflow.json.nodes[]` entries:

- `id: string`
- `nodeFile: string`
- optional `kind: NodeKind`
- optional `completion: CompletionRule`

Current `NodeKind` values:

- `task`
- `branch-judge`
- `loop-judge`
- `root-manager`
- `sub-divedra-manager`
- `manager` as legacy compatibility
- `input`
- `output`

Planned simplification:

- the target authored schema is tracked in `design-docs/specs/design-manager-kind-simplification.md`
- that refactor keeps the root-vs-sub-workflow manager split but renames the nested role to `subworkflow-manager`
- `design-workflow-json.md` continues to describe the currently implemented schema until that refactor lands

Validation rules:

- `workflow.managerNodeId` must reference a node with kind `root-manager` or legacy `manager`
- only the root manager may occupy `workflow.managerNodeId`
- each sub-workflow boundary must reference `sub-divedra-manager`, `input`, and `output` nodes

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
- `promptTemplate`
- `promptTemplateFile`
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
- `promptTemplateFile` is resolved into `promptTemplate` during load
- legacy `prompt` and `variable` aliases remain read-compatible but are not canonical

### `nodeType`

Current supported authored values:

- `agent`
- `command`
- `container`

Current execution reality:

- only `agent` nodes run in `runWorkflow()`
- `command` and `container` nodes are validated but rejected during execution

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

## `workflow-vis.json`

Current shape:

```json
{
  "nodes": [
    { "id": "divedra-manager", "order": 0 }
  ],
  "uiMeta": {
    "layout": "vertical"
  }
}
```

Fields:

- `nodes: VisNode[]`
- optional `uiMeta`

`VisNode` fields:

- `id`
- `order`

The runtime does not derive execution order from `order`. It is editor-facing metadata used for vertical presentation and additional validation around sub-workflow interval layout.

## Current Compatibility Notes

- `kind: "manager"` is still accepted as a legacy root-manager value
- `kind: "sub-manager"` is normalized to `sub-divedra-manager`
- `subWorkflows[].inputs` is still read and normalized to `inputSources`
- backend inference from certain legacy `model` strings remains read-compatible, but explicit `executionBackend` is canonical

## Current Non-Goals

These are not part of the current authored workflow format:

- concurrent `nodeGroups`
- `workflowType`
- workflow-ref child workflow execution
- runtime execution of `command` nodes
- runtime execution of `container` nodes

## References

- `design-docs/specs/architecture.md`
- `design-docs/specs/design-data-model.md`
