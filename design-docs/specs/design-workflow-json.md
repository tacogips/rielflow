# Workflow JSON Design

This document defines the JSON model for workflow orchestration and the required file layout.

## Overview

Workflow orchestration is split into multiple files under `<workflow-root>/<workflow-name>/` with explicit completion, branching, loop, and nested workflow semantics.

Branch bodies and loop bodies should be represented as ordinary `subWorkflows` whenever they contain more than a single leaf step. The separate branch/loop fields remain the control-plane policy, while `subWorkflows` are the structural block abstraction.

A workflow may also be invoked from another workflow by `workflowId`. In that case the invoked workflow behaves as one callable execution unit from the parent workflow's perspective, while still keeping its own internal execution graph and mailbox/runtime state.

## Workflow Directory Structure

Required files per workflow:
- `workflow.json`
- `workflow-vis.json`
- `node-{id}.json` (one file per executable node, where `id` is a stable slug-like identifier)
- optional workflow-local prompt source files such as `prompts/<node-id>.md`

Example:

```text
<workflow-root>/
  writing-session/
    workflow.json
    workflow-vis.json
    node-a1b2c3d4.json
    node-e5f6a7b8.json
    prompts/
      a1b2c3d4.md
      e5f6a7b8.md
```

Workflow root resolution:
1. CLI `--workflow-root`
2. `OYAKATA_WORKFLOW_ROOT`
3. `./.oyakata` (default)

Runtime execution artifacts are written outside the workflow definition directory:
- `{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{node}/{node-exec-id}/`

Path variable mapping:
- `{artifact-root}` resolution order:
  1. CLI `--artifact-root`
  2. `OYAKATA_ARTIFACT_ROOT`
  3. `./.oyakata-datas/workflow` (default)
- `{workflow_id}` = `workflow.json.workflowId`

## workflow.json

`workflow.json` holds structural and control-flow definitions and must include:
- `description`: purpose of the workflow
- optional `workflowType`: `single` or `orchestrate` (`orchestrate` by default)
- optional workflow-level prompt policy for manager/worker execution
- node graph and connectivity
- sub-workflow definitions for node sequences and callable workflow references
- inter-sub-workflow conversation definitions
- optional concurrent `nodeGroups`
- conversation orchestration policy definitions
- mandatory `oyakata` manager node reference
- completion conditions
- branch definitions (including branch-judge node references)
- loop definitions (including loop-judge node references)
- sub-workflow block typing for ordinary groups, branch blocks, and loop bodies
- global defaults (including loop limit and node timeout)
- workflow-level container runtime defaults
- references to `node-{id}.json`

Initial default values:
- `defaults.maxLoopIterations = 3`
- `defaults.nodeTimeoutMs = 120000`
- `defaults.containerRuntime.runnerKind = "podman"`

Partial conceptual example (not copy-paste ready):
(illustrative fragment; node list and edge list are intentionally abbreviated for readability.)

```json
{
  "workflowId": "writing-session",
  "description": "Draft and review a document cooperatively.",
  "workflowType": "orchestrate",
  "defaults": {
    "maxLoopIterations": 3,
    "nodeTimeoutMs": 120000,
    "containerRuntime": {
      "runnerKind": "podman"
    }
  },
  "prompts": {
    "oyakataPromptTemplate": "Coordinate {{topic}} end-to-end.",
    "workerSystemPromptTemplate": "Execute only the assigned node role and return the requested value."
  },
  "managerNodeId": "oyakata-manager",
  "subWorkflows": [
    {
      "id": "writer-sw",
      "description": "Writer sequence.",
      "definitionType": "inline",
      "managerNodeId": "writer-sub-oyakata",
      "inputNodeId": "writer-input",
      "outputNodeId": "writer-output",
      "nodeIds": ["writer-sub-oyakata", "writer-input", "writer-draft", "writer-output"],
      "inputSources": [
        { "type": "human-input" }
      ]
    },
    {
      "id": "reviewer-sw",
      "description": "Reviewer sequence.",
      "definitionType": "workflow-ref",
      "workflowId": "reviewer-workflow",
      "inputSources": [
        { "type": "sub-workflow-output", "subWorkflowId": "writer-sw" }
      ]
    }
  ],
  "subWorkflowConversations": [
    {
      "id": "writer-reviewer-dialog",
      "participants": ["writer-sw", "reviewer-sw"],
      "maxTurns": 6,
      "stopWhen": "reviewer_accepts || turns_exhausted"
    }
  ],
  "nodes": [
    {
      "id": "oyakata-manager",
      "name": "oyakata-manager",
      "description": "Coordinates sub-workflow execution.",
      "kind": "root-manager",
      "nodeFile": "node-oyakata-manager.json",
      "completion": {
        "type": "none"
      }
    },
    {
      "id": "a1b2c3d4",
      "name": "draft",
      "description": "Write the initial document draft.",
      "nodeFile": "node-a1b2c3d4.json",
      "completion": {
        "type": "checklist",
        "required": ["draft_created"]
      }
    },
    {
      "id": "e5f6a7b8",
      "name": "branch-check",
      "description": "Judge whether the draft needs review.",
      "kind": "branch-judge",
      "nodeFile": "node-e5f6a7b8.json",
      "completion": {
        "type": "validator-result"
      }
    }
  ],
  "edges": [
    { "from": "a1b2c3d4", "to": "e5f6a7b8", "when": "always" },
    { "from": "e5f6a7b8", "to": "reviewer-sw", "when": "needs_review" },
    { "from": "e5f6a7b8", "to": "done", "when": "skip_review" }
  ],
  "branching": {
    "mode": "fan-out"
  }
}
```

## node-{id}.json

Each `node-{id}.json` contains execution payload used at runtime:
- `id`: stable slug-like identifier matching `^[a-z0-9][a-z0-9-]{1,63}$`
- `name`: human-readable node name
- `description`: brief summary of the node's purpose
- optional `nodeType`: `agent`, `command`, or `container` (`agent` by default)
- `executionBackend` (optional canonical interface selector such as `codex-agent`, `claude-code-agent`, `official/openai-sdk`, or `official/anthropic-sdk`; used by `agent` nodes)
- optional `model` (required for `agent` nodes; provider or backend-specific model name such as `gpt-5` or `claude-sonnet-4-5`)
- optional `promptTemplate` (required for `agent` nodes and manager nodes; omitted for `container` nodes unless a future execution mode explicitly uses it)
- optional `promptTemplateFile`
- `variables`
- optional `command`
  - `scriptPath`: workflow-relative path to the command/script entrypoint
  - optional `argvTemplate`: array of rendered argv entries; render context includes `{{inbox.*}}` and `{{variables.*}}`
  - optional `envTemplate`: string map rendered with the same context
  - optional `workingDirectory`: workflow-relative working directory
  - runtime must execute the rendered argv directly without implicit shell interpolation
- optional `container`
  - optional `runnerKind`: `podman` | `docker` | `nerdctl` | `apple-container`
  - optional `runnerPath`: host path to the runner CLI binary
  - optional `image`
  - optional `build`
    - `contextPath`: workflow-relative build context path
    - optional `containerfilePath`: workflow-relative Containerfile/Dockerfile path
    - optional legacy alias `dockerfilePath`
    - optional `target`
  - optional `entrypoint`: argv array passed as the container entrypoint override
  - optional `argsTemplate`: rendered argv array passed after entrypoint/image
  - optional `envTemplate`: string map rendered with the same context as command nodes
  - optional `workingDirectory`: working directory inside the container
  - optional `workspace`
    - optional `mode`: `none` | `ephemeral` (`ephemeral` by default when present)
    - optional `mountPath`: container-visible scratch path (`/workspace` by default)
  - optional `resources`
    - optional `cpuMax`
    - optional `memoryMaxMb`
    - optional `pidsMax`
  - optional `networkPolicy`: `disabled` | `egress-allowed`
- optional `sessionPolicy`
  - `mode: "new" | "reuse"`
  - omitted means `new`
  - `reuse` allows repeated executions of the same node to continue one backend-managed session within the same workflow run
- optional `durability`
  - `mode`: `disabled` | `node-persistent`
  - optional `mountPath`: container-visible durable mount path (`/durable` by default)
- optional `output` contract:
  - must define at least one of `description` or `jsonSchema`
  - `description`
  - `jsonSchema`
  - `maxValidationAttempts`
  - runtime-owned publication: contract-enabled adapters submit only a candidate JSON object or reserved temp candidate file; runtime validation and mailbox publication happen after acceptance
- optional `timeoutMs` (node execution timeout override)

Execution type policy:

- `agent` nodes call an AI/backend adapter and use `executionBackend`, `model`, prompt rendering, and optional backend session reuse.
- `command` nodes execute a local command/script and must define `command.scriptPath`.
- `container` nodes execute an opaque containerized task and must define a `container` block with an image source and optional runner override.
- `model` and prompt fields are agent-oriented metadata. They are required for `agent` nodes, not for opaque `container` nodes.
- `durability` is a node-level execution-state policy for container nodes. It allows the containerized workload to persist its own filesystem state across repeated calls of the same workflow/node identity.
- Structural `kind` in `workflow.json` remains the topology/role classifier (`root-manager`, `sub-oyakata-manager`, `branch-judge`, and so on). Execution flavor is modeled separately by `nodeType` to avoid overloading `kind`.
- `root-manager` and `sub-oyakata-manager` nodes are still expected to use `nodeType: "agent"` in the current design.

Container runtime policy:

- `workflow.json.defaults.containerRuntime` defines workflow-wide container runner defaults.
- The initial default is `runnerKind = "podman"` when no workflow-level or node-level override is present.
- `container.runnerKind` and `container.runnerPath` on a node override workflow defaults for that node only.
- Exactly one image source must be declared for a `container` node: `image` or `build`.
- `build.contextPath` and optional `build.containerfilePath` must stay workflow-relative and must not target canonical workflow definition files such as `workflow.json`, `workflow-vis.json`, or `node-*.json`.
- `dockerfilePath` remains a legacy authoring alias, but `containerfilePath` is the canonical field because the runtime may target non-Docker runners.
- `podman`, `docker`, `nerdctl`, and `apple-container` are runner kinds. Host-side environments such as Colima, OrbStack, and Lima are intentionally not modeled as runner kinds because they sit below or beside the selected runner.
- `container` nodes do not inspect other nodes' canonical mailbox artifacts directly. They receive only a runtime-prepared execution-local bind mount at `/mailbox`.
- The execution-local mailbox contract is:
  - `/mailbox/inbox` mounted read-only
  - `/mailbox/outbox` mounted read-write
- File inputs for `container` nodes use no special side channel. They are delivered only through the same inbox contract as other worker nodes.
- When inbox data references files, those references must resolve within the worker-visible `/mailbox/inbox` tree, for example through structured refs such as `{ "path": "/mailbox/inbox/files/spec.md" }`.
- `container.workspace`, when enabled, provides a writable scratch mount separate from `/mailbox`; the default mount path is `/workspace`.
- `durability.mode = "node-persistent"` mounts a writable durable volume into the container. The default container-visible mount path is `/durable`.
- The durable host path is scoped by workflow and node identity, not by workflow execution:
  - `{artifact-root}/{workflow_id}/durable/{node_id}/`
- This makes durable state reusable by later calls of the same `container` node, including later workflow executions of the same workflow.
- `container.networkPolicy` defines whether the runtime launches the container with networking disabled or normal egress-enabled behavior.
- `container.resources` expresses runner-normalized CPU, memory, and PID limits; the runtime manager/executor is responsible for mapping those limits onto the selected runner's CLI/API.
- `durability` is distinct from `sessionPolicy`:
  - `sessionPolicy` is runtime/backend-managed conversational session reuse
  - `durability` is workload-managed filesystem persistence inside the container
- Oyakata managers remain the only components that own routed message creation, delivery, and cross-node mailbox artifact management.
- The current runtime does not execute container nodes yet; this design only defines schema and validation direction for a future executor.
- V1 container nodes are one-shot job executions, not long-lived compose/service workloads.
- Container exit semantics for v1:
  - exit code `0` means execution reached the output-validation phase
  - non-zero exit codes fail the node execution
  - timeout and cancellation are distinct runtime failure classes
  - exit code `0` with missing or invalid required output still fails the node
- Container output publication is runtime-owned:
  - the container may write staged results only under `/mailbox/outbox`
  - the runtime validates and promotes accepted output into canonical execution artifacts and downstream manager-routed messages
  - `stdout` and `stderr` are logs, not workflow output channels
- Retries re-run a `container` node in a fresh container with the same immutable inbox snapshot and a fresh scratch workspace when enabled.
- When `durability.mode = "node-persistent"` is enabled, retries and later same-node calls reuse the same durable host directory mounted into the fresh container.

Prompt authoring policy:

- `workflow.json` and `node-{id}.json` remain canonical JSON workflow-definition files.
- Long multiline prompts should usually live in workflow-local text files such as `prompts/<node-id>.md`.
- `promptTemplateFile` is a workflow-relative path resolved during workflow load.
- `promptTemplateFile` must stay inside the workflow directory; path traversal outside the workflow root is invalid.
- When `promptTemplateFile` is present, the loader resolves that file and uses its contents as the effective `promptTemplate` sent to the runtime.
- Save/revision behavior treats referenced prompt files as part of the workflow definition so prompt-only edits are visible to revision checks.

## Workflow-Level Prompt Policy

`workflow.json.prompts` may define:

- `oyakataPromptTemplate`: workflow-specific manager guidance appended after the default repository `oyakata system prompt`
- `workerSystemPromptTemplate`: workflow-specific system prompt prepended to worker/input/output/judge nodes

Effective manager prompt order:

1. default `oyakata system prompt` markdown from the codebase
2. rendered `workflow.prompts.oyakataPromptTemplate`
3. runtime-generated workflow/sub-workflow context
4. rendered node `promptTemplate`

Effective worker prompt order:

1. rendered `workflow.prompts.workerSystemPromptTemplate`
2. runtime-generated node reason and expected-return context
3. rendered node `promptTemplate`

Template-variable context:

- Workflow-level prompt templates and node-level prompt templates may reference workflow metadata such as `{{workflowId}}`, `{{workflowDescription}}`, `{{nodeId}}`, and `{{nodeKind}}`.
- Node-level prompt templates may reference upstream inbox context through `{{inbox.*}}`.
- The canonical inbox shape includes `{{inbox.count}}`, `{{inbox.hasMessages}}`, `{{inbox.latest.fromNodeId}}`, `{{inbox.latest.output}}`, and `{{inbox.messages}}`.

Example:

```json
{
  "id": "a1b2c3d4",
  "name": "draft",
  "description": "Write the initial document draft.",
  "executionBackend": "codex-agent",
  "model": "gpt-5",
  "promptTemplateFile": "prompts/draft.md",
  "sessionPolicy": {
    "mode": "reuse"
  },
  "timeoutMs": 90000,
  "variables": {
    "topic": "workflow design"
  }
}
```

Illustrative `container` node example:

```json
{
  "id": "reviewer-runtime",
  "nodeType": "container",
  "variables": {},
  "durability": {
    "mode": "node-persistent",
    "mountPath": "/durable"
  },
  "container": {
    "image": "ghcr.io/example/reviewer:latest",
    "entrypoint": ["./entry.sh"],
    "argsTemplate": ["--inbox-dir", "/mailbox/inbox", "--outbox-dir", "/mailbox/outbox"],
    "workspace": {
      "mode": "ephemeral",
      "mountPath": "/workspace"
    },
    "networkPolicy": "disabled",
    "resources": {
      "memoryMaxMb": 512,
      "pidsMax": 64
    },
    "envTemplate": {
      "TASK_ID": "{{variables.taskId}}",
      "SESSION_HOME": "/durable/session"
    }
  }
}
```

Example prompt file:

```md
Write draft for {{topic}}.

Latest inbox payload:
{{inbox.latest.output}}
```

Legacy compatibility:

- Older workflows may omit `executionBackend` and encode `tacogips/codex-agent` or `tacogips/claude-code-agent` directly in `model`.
- Runtime still accepts that shape, but new workflow authoring must prefer explicit `executionBackend`.
- Older workflows may omit `workflowType` and `nodeType`; loaders should normalize them to `orchestrate` and `agent`.
- Older Podman-specific isolation metadata may be normalized into the newer `container` block during migration.
- Older workflows that do not declare `durability` behave as `durability.mode = "disabled"`.

## workflow-vis.json

`workflow-vis.json` contains browser visualization state only, for example:
- vertical node order (`order`)
- optional UI metadata (`uiMeta`)

Derived at render time (not persisted):
- nesting depth (`indent`) for loop/group visualization
- semantic color token (`color`) for loop/group visualization

This file is updated by browser-side operations and should not define runtime execution semantics.

## Runtime Execution Artifact Output

Each node run produces one execution artifact directory:
- `{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{node}/{node-exec-id}/`

Artifact payload contract:
- `input.json`: resolved input payload used for this execution
- `output.json`: resulting output payload produced by node execution
- `meta.json`: runtime metadata (status, start/end timestamps, timeout/cancel result)

Input handoff rule:
- Downstream inputs are composed by `oyakata` manager using prior execution `output.json`.
- The resolved downstream payload must be persisted as that node execution's `input.json`.

## Branching and Loop Semantics

- Branch definitions include branch condition and the branch-judge node used for evaluation.
- Loop definitions include loop condition and the loop-judge node used for continuation/termination.
- `loops[]` is the explicit workflow-level loop policy container.
- Workflow must represent both as explicit graph/control-flow elements.
- Branch matching behavior uses fan-out: all matching outbound branches are executed.

## Sub-Workflow Semantics

- Node sequences can be grouped and defined as `subWorkflows`.
- Branch blocks and loop bodies should also be authored as `subWorkflows` rather than as anonymous visual-only groups.
- Each `subWorkflow` must define `definitionType`:
  - `inline`: structural sub-workflow defined by nodes in the current workflow file set
  - `workflow-ref`: callable child workflow resolved by `workflowId`
- Each `inline` `subWorkflow` must define:
  - `managerNodeId` (node kind `sub-oyakata-manager`; the sub-workflow-local `sub oyakata`)
  - `inputNodeId` (node kind `input`)
  - `outputNodeId` (node kind `output`)
  - `nodeIds` (complete membership list of node ids owned by that sub-workflow; must include `managerNodeId`, `inputNodeId`, and `outputNodeId`)
- Each `workflow-ref` `subWorkflow` must define:
  - `workflowId` (stable identifier of the referenced workflow definition)
  - optional local alias `id` distinct from `workflowId` when the same child workflow is invoked multiple times from one parent
  - `inputSources`
- Both variants may define `inputSources`.
- `block` may classify the structural role:
  - `plain`: ordinary grouped sub-workflow
  - `branch-block`: a branch body entered from a branch decision
  - `loop-body`: a loop body paired with a `loops[].id` via `block.loopId`
- `inputSources` may reference:
  - human input (`type: "human-input"`)
  - another workflow output (`type: "workflow-output"`)
  - another node output (`type: "node-output"`, with `nodeId`)
  - another sub-workflow output (`type: "sub-workflow-output"`, with `subWorkflowId`)
- output-based sources must declare `selectionPolicy` when multiple executions are possible:
  - `explicit` (with `nodeExecId`)
  - `latest-succeeded`
  - `latest-any`
  - `by-loop-iteration` (with `loopIteration`)
- root `managerNodeId` is required and must point to a node with kind `root-manager`.
- each `inline subWorkflow.managerNodeId` is required and must point to a node with kind `sub-oyakata-manager`.
- each `inline subWorkflow.nodeIds` is required and must fully define membership for mailbox write-boundary validation.
- Parent-workflow or peer-sub-workflow deliveries must target the recipient sub-workflow manager boundary.
- For `inline` sub-workflows, the recipient boundary is `managerNodeId`.
- For `workflow-ref` sub-workflows, the recipient boundary is the child workflow's root manager node in the child workflow execution.
- The recipient sub-workflow manager orchestrates sub-workflow execution, reads that delivery, and instructs child nodes inside the sub-workflow.
- A `workflow-ref` invocation must allocate a distinct child workflow execution; the parent workflow sees only the child workflow boundary input/output contract.
- A referenced workflow with `workflowType = "single"` behaves as one lightweight callable node whose root manager performs the work directly.
- A referenced workflow with `workflowType = "orchestrate"` may call its own nodes, node groups, and further sub-workflows.
- `block` semantics (`plain`, `branch-block`, `loop-body`) are defined only for `inline` sub-workflows.
- For branch-block inline sub-workflows, at least one incoming edge to `managerNodeId` must originate from a `branch-judge`.
- For branch-block inline sub-workflows, generic root-manager auto-start planning must ignore input-source readiness; entry should come from branch routing (or explicit manager control), not eager startup.
- For loop-body inline sub-workflows, `block.loopId` must reference exactly one `loops[].id`; visualization and validation use that to treat the sub-workflow as the canonical loop block.
- For loop-body inline sub-workflows, the linked loop's `continueWhen` edge must re-enter the body through that sub-workflow `managerNodeId`.
- For loop-body inline sub-workflows, generic root-manager auto-start planning must ignore input-source readiness; entry should come from the loop judge's continue edge (or explicit manager control), not eager startup.

## Workflow Type Semantics

- `workflowType = "orchestrate"` is the default.
- `workflowType = "single"` means the workflow is a lightweight job executed only by the root `oyakata` manager node.
- `single` workflows must not depend on child worker nodes, inline sub-workflows, or concurrent node groups for their main execution path.
- Every workflow, regardless of `workflowType`, is callable as one mailbox-addressable execution unit from a parent workflow.
- Workflow-level input and output therefore form a stable boundary even when the workflow is also executed standalone.

## Concurrent Node Group Semantics

- `nodeGroups` defines explicit execution groups for work that may run concurrently.
- Each `nodeGroup` must define:
  - `id`
  - `executionMode: "concurrent"`
  - `members`:
    - `type: "node"` with `nodeId`, or
    - `type: "sub-workflow"` with `subWorkflowId`
  - optional `completionPolicy: "all" | "any"` (`all` by default)
  - optional `maxParallelism`
  - optional `failurePolicy: "fail-fast" | "wait-all"` (`fail-fast` by default)
- Group membership is structural execution metadata; it does not change individual node payload files.
- Edges may target a `nodeGroup.id`. Entering that group allows the manager/runtime to start all eligible members concurrently subject to `maxParallelism`.
- Outbound transitions from a `nodeGroup.id` evaluate only after the group's completion policy is satisfied.
- Group members should belong to the same workflow scope. Mixing unrelated scopes in one group should be rejected.

## Inter-Sub-Workflow Conversation Semantics

- `subWorkflowConversations` defines managed dialog sessions between sub-workflows.
- Each conversation must define:
  - `id`
  - `participants` (array of sub-workflow ids)
  - `maxTurns`
  - `stopWhen` (termination expression)
- `conversationPolicy` may define advanced orchestration:
  - `turnPolicy`: speaker selection strategy (`round-robin`, `judge-priority`, `score-priority`)
  - `memoryPolicy`: role context policy (`shared`, `role-local`, `hybrid`) and history window
  - `toolPolicy`: per-role allowed tools/capabilities
  - `convergencePolicy`: scoring thresholds and completion rules
  - `parallelBranches`: optional branch fan-out and merge policy (`all`, `majority`, `judge`)
  - `budgetPolicy`: token/cost ceilings and hard-stop behavior
- The manager node routes all messages between participants.
- Conversation transcript is persisted in session runtime state and available as an input source for participating sub-workflows.
- Routed conversation messages must carry an `OutputRef` that points to a concrete execution artifact (`output.json`) for deterministic replay and auditing.
- Runtime transport for those routed messages is the node mailbox defined in `design-docs/specs/design-node-mailbox.md`; conversation transcript records are orchestration views over mailbox-backed deliveries, not a second transport channel.

`OutputRef` conceptual shape:

```json
{
  "workflowExecutionId": "wfexec-20260223-001",
  "workflowId": "impl-hardening-loop",
  "subWorkflowId": "subgroup2-security",
  "outputNodeId": "sg2-output",
  "nodeExecId": "nodeexec-00017",
  "artifactDir": "{artifact-root}/impl-hardening-loop/executions/wfexec-20260223-001/nodes/sg2-output/nodeexec-00017"
}
```

## Node Input Injection and Template Policy

Node execution supports two complementary payloads:
- `promptText`: rendered from `promptTemplate` + `variables`
- `arguments`: structured object assembled from `argumentsTemplate` + `argumentBindings`

Required policy:
- For adapters that accept `ARGUMENTS` only (for example Codex/Claude skill-like handlers), pass the assembled `arguments` object.
- Use simple text templating (`mustache`) for prompt rendering.
- Do not rely on complex template logic (full Handlebars helpers/control flow) for core data assembly.
- Use explicit `argumentBindings` from artifact outputs and workflow state to maintain deterministic behavior.

## Canonical Case 1: Implementation/Review Loop

This section defines a concrete workflow pattern matching the following intent:

`oyakata` -> user implementation instruction -> implementation -> subgroup1 -> subgroup2 -> subgroup3 -> subgroup4, then loop (max 3 rounds).

Subgroup structure:
- `subgroup1`: anti-pattern review and implementation correction cycle
  - review1 (anti-pattern review)
  - counter-opinion based on review1
  - mediation between review1 and counter-opinion
  - implementation fix
  - commit execution
- `subgroup2`: security review and correction cycle
  - security review
  - rebuttal to security review
  - mediation
  - implementation fix based on mediated decision
- `subgroup3`: review whether tests are legitimate (not improper/fake)
- `subgroup4`: end-of-round consolidation and loop-judge handoff

Conceptual `workflow.json` fragment:

```json
{
  "workflowId": "impl-hardening-loop",
  "description": "Iterative implementation with anti-pattern, security, and test-integrity gates.",
  "defaults": {
    "maxLoopIterations": 3,
    "nodeTimeoutMs": 120000
  },
  "managerNodeId": "oyakata-manager",
  "subWorkflows": [
    {
      "id": "subgroup1-antipattern",
      "description": "Anti-pattern review, counter-opinion, mediation, fix, commit.",
      "managerNodeId": "sg1-sub-oyakata",
      "inputNodeId": "sg1-input",
      "outputNodeId": "sg1-output",
      "nodeIds": ["sg1-sub-oyakata", "sg1-input", "sg1-output"],
      "inputSources": [
        { "type": "node-output", "nodeId": "implementation-node" }
      ]
    },
    {
      "id": "subgroup2-security",
      "description": "Security review, rebuttal, mediation, fix.",
      "managerNodeId": "sg2-sub-oyakata",
      "inputNodeId": "sg2-input",
      "outputNodeId": "sg2-output",
      "nodeIds": ["sg2-sub-oyakata", "sg2-input", "sg2-output"],
      "inputSources": [
        { "type": "sub-workflow-output", "subWorkflowId": "subgroup1-antipattern" }
      ]
    },
    {
      "id": "subgroup3-test-integrity",
      "description": "Validate tests are legitimate and not improper.",
      "managerNodeId": "sg3-sub-oyakata",
      "inputNodeId": "sg3-input",
      "outputNodeId": "sg3-output",
      "nodeIds": ["sg3-sub-oyakata", "sg3-input", "sg3-output"],
      "inputSources": [
        { "type": "sub-workflow-output", "subWorkflowId": "subgroup2-security" }
      ]
    },
    {
      "id": "subgroup4-round-close",
      "description": "Finalize round and prepare loop-judge decision.",
      "managerNodeId": "sg4-sub-oyakata",
      "inputNodeId": "sg4-input",
      "outputNodeId": "sg4-output",
      "nodeIds": ["sg4-sub-oyakata", "sg4-input", "sg4-output"],
      "inputSources": [
        { "type": "sub-workflow-output", "subWorkflowId": "subgroup3-test-integrity" }
      ]
    }
  ],
  "subWorkflowConversations": [
    {
      "id": "sg1-sg2-alignment-dialog",
      "participants": ["subgroup1-antipattern", "subgroup2-security"],
      "maxTurns": 4,
      "stopWhen": "mediation_complete"
    },
    {
      "id": "sg2-sg3-quality-dialog",
      "participants": ["subgroup2-security", "subgroup3-test-integrity"],
      "maxTurns": 4,
      "stopWhen": "mediation_complete"
    }
  ],
  "edges": [
    { "from": "oyakata-manager", "to": "user-implementation-instruction", "when": "always" },
    { "from": "user-implementation-instruction", "to": "implementation-node", "when": "always" },
    { "from": "implementation-node", "to": "subgroup1-antipattern", "when": "always" },
    { "from": "subgroup1-antipattern", "to": "subgroup2-security", "when": "always" },
    { "from": "subgroup2-security", "to": "subgroup3-test-integrity", "when": "always" },
    { "from": "subgroup3-test-integrity", "to": "subgroup4-round-close", "when": "always" },
    { "from": "subgroup4-round-close", "to": "loop-judge-round", "when": "always" },
    { "from": "loop-judge-round", "to": "implementation-node", "when": "continue_round" },
    { "from": "loop-judge-round", "to": "done", "when": "rounds_complete" }
  ],
  "loops": [
    {
      "id": "implementation-hardening-loop",
      "judgeNodeId": "loop-judge-round",
      "maxIterations": 3,
      "continueWhen": "continue_round",
      "exitWhen": "rounds_complete"
    }
  ]
}
```

Canonical encoding note:
- The fragment above is intentionally abbreviated around the repeated round body.
- In a fully normalized `workflow.json`, the repeated body from `implementation-node` through `sg4-output` should also be represented as a `subWorkflow` with `block: { "type": "loop-body", "loopId": "implementation-hardening-loop" }`.
- In that canonical form, `loop-judge-round` re-enters the loop by routing `continue_round` to the loop-body sub-workflow manager boundary, not directly to `implementation-node`.

## Canonical Case 2: Adversarial Debate and Improvement Loop

This section defines an automated debate workflow where multiple role nodes repeatedly propose attacks/defenses and improve the implementation.

Base security pattern:
- `oyakata`
- user instruction
- blackhat attempt (round start)
- commit
- whitehat defense proposal from blackhat result
- commit
- blackhat re-penetration based on whitehat output
- commit
- whitehat hardening update
- mediation node decides:
  - finish when major issues are exhausted, or
  - continue until max rounds are reached

Conceptual `workflow.json` fragment:

```json
{
  "workflowId": "security-adversarial-loop",
  "description": "Blackhat/whitehat debate loop with mediation-driven completion.",
  "defaults": {
    "maxLoopIterations": 6,
    "nodeTimeoutMs": 120000
  },
  "managerNodeId": "oyakata-manager",
  "subWorkflows": [
    {
      "id": "blackhat-sw",
      "description": "Attempt penetration based on latest code state and prior defenses.",
      "managerNodeId": "blackhat-sub-oyakata",
      "inputNodeId": "blackhat-input",
      "outputNodeId": "blackhat-output",
      "nodeIds": ["blackhat-sub-oyakata", "blackhat-input", "blackhat-output"],
      "inputSources": [
        { "type": "node-output", "nodeId": "user-implementation-instruction" },
        { "type": "sub-workflow-output", "subWorkflowId": "whitehat-sw" }
      ]
    },
    {
      "id": "whitehat-sw",
      "description": "Design and apply defenses for discovered vulnerabilities.",
      "managerNodeId": "whitehat-sub-oyakata",
      "inputNodeId": "whitehat-input",
      "outputNodeId": "whitehat-output",
      "nodeIds": ["whitehat-sub-oyakata", "whitehat-input", "whitehat-output"],
      "inputSources": [
        { "type": "sub-workflow-output", "subWorkflowId": "blackhat-sw" }
      ]
    },
    {
      "id": "mediation-sw",
      "description": "Judge coverage and decide continue/finish.",
      "managerNodeId": "mediation-sub-oyakata",
      "inputNodeId": "mediation-input",
      "outputNodeId": "mediation-output",
      "nodeIds": ["mediation-sub-oyakata", "mediation-input", "mediation-output"],
      "inputSources": [
        { "type": "sub-workflow-output", "subWorkflowId": "blackhat-sw" },
        { "type": "sub-workflow-output", "subWorkflowId": "whitehat-sw" }
      ]
    }
  ],
  "subWorkflowConversations": [
    {
      "id": "blackhat-whitehat-dialog",
      "participants": ["blackhat-sw", "whitehat-sw"],
      "maxTurns": 8,
      "stopWhen": "mediation_ready"
    },
    {
      "id": "security-triage-dialog",
      "participants": ["blackhat-sw", "mediation-sw"],
      "maxTurns": 4,
      "stopWhen": "triage_complete"
    }
  ],
  "edges": [
    { "from": "oyakata-manager", "to": "user-implementation-instruction", "when": "always" },
    { "from": "user-implementation-instruction", "to": "blackhat-sw", "when": "always" },
    { "from": "blackhat-sw", "to": "commit-after-blackhat", "when": "always" },
    { "from": "commit-after-blackhat", "to": "whitehat-sw", "when": "always" },
    { "from": "whitehat-sw", "to": "commit-after-whitehat", "when": "always" },
    { "from": "commit-after-whitehat", "to": "blackhat-sw", "when": "re-penetration" },
    { "from": "commit-after-whitehat", "to": "mediation-sw", "when": "ready-for-mediation" },
    { "from": "mediation-sw", "to": "loop-judge-security", "when": "always" },
    { "from": "loop-judge-security", "to": "blackhat-sw", "when": "continue_round" },
    { "from": "loop-judge-security", "to": "done", "when": "issues_exhausted || max_rounds_reached" }
  ],
  "loops": [
    {
      "id": "security-adversarial-loop",
      "judgeNodeId": "loop-judge-security",
      "maxIterations": 6,
      "continueWhen": "continue_round",
      "exitWhen": "issues_exhausted || max_rounds_reached"
    }
  ]
}
```

Canonical encoding note:
- The fragment above abbreviates the repeated debate body for readability.
- In a fully normalized `workflow.json`, the repeated round from `blackhat-sw` through `mediation-sw` should be wrapped by a `subWorkflow` with `block: { "type": "loop-body", "loopId": "security-adversarial-loop" }`.
- In that canonical form, `loop-judge-security` routes `continue_round` to that loop-body sub-workflow manager boundary instead of directly to `blackhat-sw`.

Generalization rule:
- The same debate-loop structure is reusable beyond security.
- Example domains:
  - web app design improvement
  - feature quality improvement
- Reuse by changing role semantics (for example: challenger/defender/mediator) while preserving:
  - role-to-role conversation
  - commit checkpoints
  - loop-judge termination (`quality_saturated || max_rounds_reached`)

## Loop Semantics

Looping is represented by edges that target an upstream node.

Loop controls:
- `maxIterations` per loop path (optional if global default exists)
- optional backoff policy
- fallback edge when loop budget is exhausted

If loop-specific limits are omitted, `workflow.json.defaults.maxLoopIterations` is applied.

## Completion Semantics

Completion block determines whether node execution is accepted.

Supported conceptual strategies:
- `checklist`
- `score-threshold`
- `validator-result`
- `none` (no success judgment; node is treated as auto-complete after successful execution)

Completion result drives transition decisions.

## Timeout Semantics

- Each node may define `timeoutMs` in `node-{id}.json`.
- If omitted, `workflow.json.defaults.nodeTimeoutMs` is used.
- Timeout expiration should produce a timeout-specific failure result for routing/handling.

## Validation Rules (Conceptual)

- Workflow must be located under `<workflow-root>/<workflow-name>/`.
- `workflow.json` must include `description`.
- `workflowType` must be `single` or `orchestrate` when present.
- Node ids must be unique and match `^[a-z0-9][a-z0-9-]{1,63}$`.
- All edge endpoints must exist as node ids, sub-workflow ids, or node-group ids.
- Every executable node must have a valid `node-{id}.json`.
- Every node execution must persist artifacts under `{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{node}/{node-exec-id}/`.
- Every execution artifact directory must contain `input.json`, `output.json`, and `meta.json`.
- `managerNodeId` must be present and point to a node with `kind: "root-manager"`.
- Every `inline subWorkflow` must include one `sub-oyakata-manager`, one `input`, and one `output` node reference.
- Every `inline subWorkflow` must include `nodeIds`, and those node ids must be unique across sub-workflows.
- Every `workflow-ref subWorkflow` must reference an existing `workflowId`.
- Cross-sub-workflow deliveries must target the recipient sub-workflow manager boundary, not a leaf task node.
- Every `subWorkflow.inputSources[]` entry must use one of:
  - `human-input`
  - `workflow-output`
  - `node-output`
  - `sub-workflow-output`
- `workflowType = "single"` must not declare execution-time child nodes, inline sub-workflows, or `nodeGroups` on its main path.
- `nodeType` must be `agent`, `command`, or `container` when present.
- `agent` nodes must define `model`.
- `agent` nodes must define inline `promptTemplate` or a resolvable `promptTemplateFile`.
- `command` nodes must define a workflow-relative `command.scriptPath` that stays inside the workflow directory.
- `container` nodes must define exactly one image source: `container.image` or `container.build`.
- `container.runnerKind` defaults from `workflow.json.defaults.containerRuntime.runnerKind`, which defaults to `podman` when omitted.
- `container.networkPolicy` must be `disabled` or `egress-allowed` when present.
- `container.workspace.mountPath` defaults to `/workspace` when `container.workspace` is enabled.
- `container.resources` values must be positive when present.
- `durability.mode` must be `disabled` or `node-persistent` when present.
- `durability` is currently valid only for `container` nodes.
- `durability.mountPath` defaults to `/durable` when `durability.mode = "node-persistent"`.
- Every `nodeGroup.members[]` entry must reference an existing node or sub-workflow id.
- Every `nodeGroup` with `executionMode = "concurrent"` must contain at least two members.
- Every `subWorkflowConversations[].participants[]` entry must reference an existing `subWorkflow.id`.
- `subWorkflowConversations[].participants` must contain at least two distinct sub-workflow ids.
- `subWorkflowConversations[].maxTurns` must be a positive integer.
- If `conversationPolicy.turnPolicy = "score-priority"`, `convergencePolicy` must define scoring fields.
- If `conversationPolicy.parallelBranches` is set, merge policy must be one of `all`, `majority`, `judge`.
- If `conversationPolicy.budgetPolicy` is set, token/cost limits must be positive numbers.
- Loop patterns like subgroup1->subgroup2->subgroup3->subgroup4 must be bounded by `loops[].maxIterations` or workflow default.
- Adversarial debate loops (e.g. blackhat/whitehat/mediator) must define explicit termination via issue exhaustion and/or max rounds.
- `workflow-vis.json` must be treated as visualization state only.
- Looping paths must be bounded by loop-local limits or global default.
- Completion block may be omitted when node is configured as auto-complete or `completion.type = "none"`.

## References

- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`
- `design-docs/specs/design-data-model.md`
