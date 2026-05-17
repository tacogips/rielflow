# Workflow JSON Design

This document defines the authored workflow bundle format. It is the authoritative schema direction for workflow definitions saved and executed by divedra.

Supporting design:
`design-docs/specs/design-workflow-steps-and-node-reuse.md`.

Implementation references:

- `src/workflow/types.ts` for authored and normalized workflow types
- `src/workflow/validate.ts` for validation, defaults, and normalization
- `src/workflow/authored-workflow.ts` for rejected legacy top-level fields
- `src/workflow/node-addons.ts` for built-in add-on names and versions

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
<workflow-definition-dir>/
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

- in scoped workflow lookup, `<workflow-definition-dir>` is `<scope-root>/workflows`;
  user scope defaults to `~/.divedra/workflows` and project scope defaults to
  `<project>/.divedra/workflows`
- `workflow.json.steps[]` order is canonical for editor presentation, while step transitions define legal routing.
- runtime execution artifacts are written outside the workflow-definition directory under the configured artifact root.
- the workflow keeps an explicit reusable node registry in `workflow.json.nodes[]`; node files are not inferred by filename convention.
- inline and file-backed steps are both valid; managed templates often use inline steps while larger workflows may keep step definitions under `steps/`.
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
    "maxLoopIterations": 3,
    "nodeTimeoutMs": 120000,
    "fanoutConcurrency": 20,
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
      "nodeId": "manager-runtime",
      "role": "manager",
      "transitions": [{ "toStepId": "implement" }]
    },
    {
      "id": "implement",
      "nodeId": "coder"
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
    "maxLoopIterations": 3,
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
- `managerStepId: string`
- `prompts.divedraPromptTemplate: string`
- `prompts.workerSystemPromptTemplate: string`
- `defaults.maxLoopIterations` (defaults to the runtime default when omitted)
- `defaults.fanoutConcurrency` (defaults to `20` when omitted; per-transition
  fanout may set a lower or equal effective bound)
- `defaults.timeoutPolicy`
- `defaults.containerRuntime` (defaults to the runtime container runner default when omitted)

Validation rules:

- `workflowId` is a filesystem namespace key for runtime artifacts and attachments, so it must start with an alphanumeric character and then contain only letters, digits, hyphens, or underscores
- when provided, `description` must be a non-empty string
- `entryStepId` must resolve to an authored step
- `managerStepId`, when present, must resolve to an authored step
- at most one step may declare `role: "manager"`
- if `managerStepId` is omitted and exactly one step declares `role: "manager"`, the validator infers that step as the manager step
- every step must reference a node registry entry through `nodeId`
- `nodes[]` must contain at least one node registry entry
- `steps[]` must be non-empty
- node registry ids must be unique
- step ids must be unique
- dedicated legacy top-level fields are rejected by key set: step-addressed bundles use `REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS` in `src/workflow/authored-workflow.ts` (includes `managerRuntimeId`, `managerNodeId`, `entryNodeId`, `subWorkflows`, `workflowCalls`, `subWorkflowConversations`, `edges`, `loops`, and `branching`). `src/workflow/validate.ts` re-exports those constants for compatibility
- dedicated legacy top-level field lists, rejection strings, canonical issue construction, and save-time authored-boundary stripping are centralized in `src/workflow/authored-workflow.ts`; validation re-exports those constants from `src/workflow/validate.ts` for compatibility
- the save path may strip only normalized in-memory `hasManagerNode` and redundant node `kind` fields from workflow input before writing; it does not strip `managerRuntimeId`, `managerNodeId`, `entryNodeId`, `subWorkflows`, or other disallowed keys (validation rejects them, same as for on-disk `workflow.json`)
- the validator rejects top-level `workflow.workflowCalls` whenever the bundle is treated as step-addressed (`entryStepId` with `steps[]`); use step transitions instead
- cross-workflow invocation uses the same execution-address model as ordinary step calls rather than a dedicated top-level `workflowCalls` section
- calling another workflow means targeting an explicit step in that workflow; the canonical workflow-level entry is the callee workflow's `managerStepId`, or `entryStepId` when the callee is worker-only
- derived runtime cross-workflow dispatch rows and new `workflow-calls/*.json` metadata are step-addressed (`callerStepId`, `resumeStepId`) because the authored source of truth is `steps[].transitions`

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
- optional `execution` for registry-level required/optional scheduling policy
- optional `kind` for graph semantics such as `task`, `branch-judge`,
  `loop-judge`, `input`, or `output`
- optional `repeat` for loop policy (`while`, optional `restartAt`, optional
  `maxIterations`)

Validation rules:

- a node reference must provide exactly one of `nodeFile` or `addon`
- `id` must match `^[a-z0-9][a-z0-9-]{1,63}$`
- only `id`, `nodeFile`, `addon`, `execution`, `kind`, and `repeat` are accepted on authored node registry entries
- `execution.mode`, when present, must be `required` or `optional`
- `execution.decisionBy`, when present, must be `owning-manager`
- `repeat.while` is required when `repeat` is present; `repeat.maxIterations`, when present, must be a positive integer
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

Each step entry is authored in exactly one of two forms:

- file-backed: `id` plus `stepFile`
- inline: `id`, `nodeId`, and any optional inline step fields in `workflow.json`

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

Required after step-file resolution:

- `id: string`
- `nodeId: string`

Optional inline step fields:

- `description: string`
- `role: "manager" | "worker"`
- `promptVariant: string`
- `timeoutMs: number`
- `sessionPolicy`
- `transitions`

Validation rules:

- `id` values are unique within the workflow
- a file-backed authored step contains `id` and `stepFile`; an inline authored step contains `id`, `nodeId`, and optional inline fields
- only `id`, `stepFile`, `nodeId`, `description`, `role`, `promptVariant`, `timeoutMs`, `sessionPolicy`, and `transitions` are accepted on authored step entries
- when `stepFile` is used in source authoring, the inline step fields `nodeId`, `description`, `role`, `promptVariant`, `timeoutMs`, `sessionPolicy`, and `transitions` must not be authored on the same entry; loading resolves the file into a complete step before validation
- when `stepFile` is used, the loaded step definition must resolve to the same `id`
- `nodeId` must resolve through `workflow.json.nodes[]`
- when `role` is omitted, the step named by `managerStepId` is treated as the manager execution site and all other steps default to worker execution sites
- manager-role steps must reference file-backed nodes; add-on-backed registry entries are worker-only
- `transitions[]` target step ids, not node ids
- `sessionPolicy.inheritFromStepId`, when present, must reference an authored step in the same workflow
- step-local `timeoutMs`, prompt, and session settings override node defaults for that step usage site only

## `StepTransition`

`transitions[]` define the legal next execution addresses for one step.

Shape:

- `toStepId: string`
- optional `toWorkflowId: string`
- optional `resumeStepId: string` (required when `toWorkflowId` is present)
- optional `label: string`
- optional `fanout: StepTransitionFanout`

Rules:

- when `toWorkflowId` is omitted, the transition stays inside the current workflow
- when `toWorkflowId` is present, the transition targets another workflow using the same execution-address contract as any other step call
- when `toWorkflowId` is present, `resumeStepId` must name a step in the **current** workflow to queue after the callee workflow completes (same handoff role historically associated with removed top-level `workflowCalls[].resultNodeId` authoring)
- `resumeStepId` must be omitted for local in-workflow transitions (`toWorkflowId` absent)
- a step may have at most one cross-workflow transition
- cross-workflow transitions must target the callee workflow's callable entry step, which is normally its `managerStepId`, or `entryStepId` for a worker-only workflow
- transitions always target steps, never raw node ids
- optional `label` uses the same expression grammar as the `when` field on step-derived routing edges (`getStructuralEdges` in `src/workflow/types.ts` maps omitted `label` to `always`). For cross-workflow transitions, omitted `label` means the derived cross-workflow dispatch is unconditional. When set, `label` gates both local transition selection and cross-workflow dispatch matching. Step-authored cross-workflow transitions are **not** copied onto `workflow.workflowCalls` during normalization; the engine and inspection surfaces derive the effective dispatch list (deterministic ids `__cw:<callerStepId>`) from `steps[]`

### `StepTransitionFanout`

`fanout` defines bounded parallel branch execution from one selected transition
and an explicit join back into the current workflow.

Initial dynamic shape:

```json
{
  "groupId": "feature-design",
  "itemsFrom": "/payload/features",
  "itemVariable": "feature",
  "concurrency": 20,
  "joinStepId": "join-feature-design",
  "failurePolicy": "fail-fast",
  "resultOrder": "input"
}
```

Fields:

- `groupId: string`
- `itemsFrom: string`
- optional `itemVariable: string`
- optional `concurrency: number`
- `joinStepId: string`
- optional `failurePolicy: "fail-fast" | "collect-all"`
- optional `resultOrder: "input"`

Rules:

- `itemsFrom` is a JSON Pointer into the source step output payload and must resolve to an array at runtime
- each source item creates a distinct branch work item, so the same target step may execute once per item without queue dedupe collapsing the branches
- `concurrency` defaults to `defaults.fanoutConcurrency` or `20` and must stay within the runtime maximum fanout concurrency, including a run-level `maxConcurrency` cap when provided
- `joinStepId` must reference a current-workflow step and is queued once after all required branch work succeeds
- for cross-workflow fanout, authored `resumeStepId` remains required and must equal `fanout.joinStepId`
- branch outputs are aggregated in source item order and delivered to the join step through runtime-owned communication artifacts
- partial-success joins are out of scope for the initial schema; `fail-fast` stops on first branch failure, while `collect-all` waits for terminal branch states and then fails if any branch failed

Detailed design:
`design-docs/specs/design-bounded-fanout-join-workflow-execution.md`.

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

- `description`
- `nodeType`
- `managerType`
- `workingDirectory`
- `executionBackend`
- `model`
- `sessionPolicy`
- `systemPromptTemplate`
- `systemPromptTemplateFile`
- `promptTemplate`
- `promptTemplateFile`
- `sessionStartPromptTemplate`
- `sessionStartPromptTemplateFile`
- `promptVariants`
- `command`
- `container`
- `durability`
- `userAction`
- `sleep`
- `argumentsTemplate`
- `argumentBindings`
- `templateEngine`
- `timeoutMs`
- `output`

Important rules:

- omitted `nodeType` defaults to `agent`
- `agent` nodes require `executionBackend`, `model`, and `promptTemplate` unless a manager code-path default is explicitly allowed by the loader
- manager-role nodes must stay on the agent execution path; `command`,
  `container`, `user-action`, `sleep`, and runtime-owned `addon` payloads are
  worker execution paths
- `managerType` is valid only for manager-role nodes; worker steps must not
  reference payloads that declare `managerType`
- `systemPromptTemplateFile` is resolved into `systemPromptTemplate` during load
- `promptTemplateFile` is resolved into `promptTemplate` during load
- `sessionStartPromptTemplateFile` is resolved into `sessionStartPromptTemplate` during load
- authored JSON must use the canonical field names

### `nodeType`

Supported authored values, including the scheduled sleep runtime target:

- `agent`
- `command`
- `container`
- `sleep`
- `user-action`

Target execution behavior for this schema:

- `agent`, `command`, `container`, `sleep`, and `user-action` nodes are
  accepted by the validator
- in full workflow execution, `sleep` nodes register a scheduled continuation
  event through the shared scheduled event manager instead of blocking or
  awaiting a long timer in the node executor
- in full workflow execution, `user-action` nodes persist a request artifact,
  mark the session `paused`, and wait for external/user input rather than
  running an agent, command, or container
- direct step execution rejects `user-action` nodes; they require the full
  workflow session lifecycle
- `nodeType: "addon"` is runtime-owned and must not be authored in node payload files; author add-ons through `workflow.json.nodes[].addon`

### `sleep`

`sleep` is required when `nodeType` is `sleep` and invalid for other node types.
Sleep nodes are runtime scheduling nodes: they pause the current workflow
execution and register the continuation in the shared scheduled event pool
described in `design-docs/specs/design-scheduled-sleep-node-runtime.md`.

Rules:

- exactly one wake condition is required for the first implementation
- `durationMs` must be a positive integer when present
- `until`, if supported, must be a timestamp with an explicit timezone or UTC
  offset
- `promptTemplate`, `promptTemplateFile`, `model`, `executionBackend`,
  `sessionPolicy`, `command`, `container`, `userAction`, and `durability` must
  be omitted
- `variables` remains required, as with other node payloads

Shape:

```json
{
  "durationMs": 30000
}
```

### `executionBackend`

Current backend values:

- `codex-agent`
- `claude-code-agent`
- `cursor-cli-agent`
- `official/openai-sdk`
- `official/anthropic-sdk`

`model` is backend-specific model naming. It is required for executable `agent` nodes.

For `agent` nodes, `model` must be a provider or backend-specific model name. Do not put CLI-wrapper identifiers such as `codex-agent`, `claude-code-agent`, `tacogips/codex-agent`, or `tacogips/claude-code-agent` in `model`.

### `userAction`

`userAction` is required when `nodeType` is `user-action` and invalid for other node types.

Rules:

- `messageToolIds` is required and must contain at least one tool id
- `notificationToolIds`, when present, is additive and does not replace
  `messageToolIds`
- `messageToolIds` and `notificationToolIds` entries must be non-empty strings
- only `messageToolIds`, `notificationToolIds`, `replyPolicy`,
  `allowStructuredReply`, and `allowFreeTextReply` are accepted on
  `userAction`
- `allowStructuredReply` and `allowFreeTextReply`, when present, must be
  booleans
- `promptTemplate` or `promptTemplateFile` must describe the user-facing action request
- `model`, `executionBackend`, `sessionPolicy`, `command`, `container`, and `durability` must be omitted
- `variables` remains required, as with other node payloads

Shape:

```json
{
  "messageToolIds": ["chat"],
  "notificationToolIds": ["desktop"],
  "replyPolicy": "first-valid-reply-wins",
  "allowStructuredReply": true,
  "allowFreeTextReply": true
}
```

Supported values:

- `replyPolicy: "first-valid-reply-wins"`

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
