# Data Model Design

This document defines canonical data models for workflow files and internal runtime models.

## Overview

Goal: make workflow and node structures unambiguous and reviewable by humans before implementation.

Scope:
- File models (`workflow.json`, `node-{id}.json`, `workflow-vis.json`)
- Runtime execution artifact model (`{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{node}/{node-exec-id}/`)
- Internal normalized models used by runtime
- Validation rules and review checklist

## Canonical Schema Decisions

1. Node payload uses canonical fields `promptTemplate` and `variables`.
2. Legacy aliases `prompt` and `variable` are read-compatible only and must not be emitted by normalizers/savers.
3. Node `model` is required at runtime and validation time.
4. Node ids use stable slug-like identifiers with pattern `^[a-z0-9][a-z0-9-]{1,63}$`.
5. Artifact root is configurable and resolved by:
   1. CLI `--artifact-root`
   2. `OYAKATA_ARTIFACT_ROOT`
   3. `./.oyakata-datas/workflow`
6. Conversation handoff uses explicit output references (`OutputRef`), not implicit "latest output" inference.
7. Complex node input must be assembled as structured `arguments` via bindings/mappings, not by embedding heavy logic in template syntax.

## File Data Models

### workflow.json

| Field | Type | Required | Notes |
|------|------|----------|-------|
| `workflowId` | string | Yes | Stable identifier |
| `description` | string | Yes | Human-readable purpose |
| `workflowType` | string | No | `single` or `orchestrate`; default `orchestrate` |
| `defaults.maxLoopIterations` | number | Yes | Initial default: `3` |
| `defaults.nodeTimeoutMs` | number | Yes | Initial default: `120000` |
| `defaults.containerRuntime` | object | No | Workflow-wide container runner defaults; initial `runnerKind = "podman"` |
| `managerNodeId` | string | Yes | Must reference the root `oyakata` manager node id (`kind: "root-manager"`) |
| `subWorkflows` | array of `SubWorkflowRef` | Yes | Node sequence units and callable workflow references |
| `nodeGroups` | array of `NodeGroup` | No | Concurrent execution groups |
| `subWorkflowConversations` | array of `SubWorkflowConversation` | No | Conversation sessions between sub-workflows |
| `nodes` | array of `WorkflowNodeRef` | Yes | Node definitions and references |
| `edges` | array of `WorkflowEdge` | Yes | Directed transitions |
| `loops` | array of `LoopRule` | No | Optional explicit loop policy definitions |
| `branching.mode` | string | Yes | Must be `fan-out` |

`WorkflowNodeRef`:
- `id: string`
- `nodeFile: string` (expected format: `node-{id}.json`)
- `kind?: "task" | "branch-judge" | "loop-judge" | "root-manager" | "sub-oyakata-manager" | "input" | "output"`
- `completion?: CompletionRule` (optional for auto-complete nodes)

`SubWorkflowRef`:
- `id: string`
- `description: string`
- `definitionType: "inline" | "workflow-ref"`
- `managerNodeId?: string` (required for `inline`; must reference a node with `kind: "sub-oyakata-manager"` owned by this sub-workflow)
- `inputNodeId?: string` (required for `inline`; must reference a node with `kind: "input"`)
- `outputNodeId?: string` (required for `inline`; must reference a node with `kind: "output"`)
- `nodeIds?: string[]` (required for `inline`; all node ids owned by this sub-workflow, including `managerNodeId`, `inputNodeId`, `outputNodeId`)
- `workflowId?: string` (required for `workflow-ref`; stable id of the referenced child workflow)
- `inputSources: SubWorkflowInputSource[]`
- `block?: { type: "plain" | "branch-block" | "loop-body"; loopId?: string }`

Block semantics:
- `branch-block` means the sub-workflow is a branch body and must be entered by at least one edge from a `branch-judge` to `managerNodeId`
- `loop-body` means the sub-workflow is a canonical loop body and `block.loopId` must reference `loops[].id`
- for `loop-body`, the linked loop's `continueWhen` edge must target `managerNodeId`

`SubWorkflowInputSource`:
- `type: "human-input" | "workflow-output" | "node-output" | "sub-workflow-output"`
- `workflowId?: string` (required when `type = "workflow-output"`)
- `nodeId?: string` (required when `type = "node-output"`)
- `subWorkflowId?: string` (required when `type = "sub-workflow-output"`)
- `selectionPolicy?: OutputSelectionPolicy` (required when source can resolve to multiple executions)

`OutputSelectionPolicy`:
- `mode: "explicit" | "latest-succeeded" | "latest-any" | "by-loop-iteration"`
- `nodeExecId?: string` (required when `mode = "explicit"`)
- `loopIteration?: number` (required when `mode = "by-loop-iteration"`)

`OutputRef`:
- `workflowExecutionId: string`
- `workflowId: string`
- `subWorkflowId?: string` (required when the referenced output is produced by a sub-workflow)
- `outputNodeId: string`
- `nodeExecId: string`
- `artifactDir: string`

`SubWorkflowConversation`:
- `id: string`
- `participants: string[]` (sub-workflow ids, minimum length 2)
- `maxTurns: number` (positive integer)
- `stopWhen: string` (termination expression)
- `conversationPolicy?: ConversationPolicy`

`ConversationPolicy`:
- `turnPolicy?: "round-robin" | "judge-priority" | "score-priority"`
- `memoryPolicy?: ConversationMemoryPolicy`
- `toolPolicy?: ConversationToolPolicy`
- `convergencePolicy?: ConversationConvergencePolicy`
- `parallelBranches?: ConversationParallelBranches`
- `budgetPolicy?: ConversationBudgetPolicy`

`ConversationMemoryPolicy`:
- `mode: "shared" | "role-local" | "hybrid"`
- `historyWindowTurns?: number`

`ConversationToolPolicy`:
- `allowedToolsByRole: Record<string, string[]>`

`ConversationConvergencePolicy`:
- `metric: string`
- `targetScore: number`
- `minStableTurns?: number`

`ConversationParallelBranches`:
- `enabled: boolean`
- `maxBranches?: number`
- `mergePolicy?: "all" | "majority" | "judge"`

`ConversationBudgetPolicy`:
- `maxTokens?: number`
- `maxCostUsd?: number`
- `onBudgetExceeded?: "stop" | "degrade" | "judge"`

`WorkflowEdge`:
- `from: string`
- `to: string`
- `when: string` (expression name or `always`)
- `priority?: number` (optional metadata only; fan-out still applies)

`ContainerRuntimeDefaults`:
- `runnerKind?: "podman" | "docker" | "nerdctl" | "apple-container"` (defaults to `podman`)
- `runnerPath?: string`

`NodeGroup`:
- `id: string`
- `executionMode: "concurrent"`
- `members: NodeGroupMember[]`
- `completionPolicy?: "all" | "any"`
- `maxParallelism?: number`
- `failurePolicy?: "fail-fast" | "wait-all"`

`NodeGroupMember`:
- `{ type: "node"; nodeId: string }`
- `{ type: "sub-workflow"; subWorkflowId: string }`

`LoopRule`:
- `id: string`
- `judgeNodeId: string` (must reference a node with `kind: "loop-judge"`)
- `maxIterations?: number` (positive integer; falls back to `defaults.maxLoopIterations`)
- `continueWhen: string` (expression routed from `judgeNodeId`)
- `exitWhen: string` (expression routed from `judgeNodeId`)
- `backoffMs?: number` (optional wait before next loop iteration)

### node-{id}.json

| Field | Type | Required | Notes |
|------|------|----------|-------|
| `id` | string | Yes | Must match workflow node id |
| `nodeType` | string | No | `agent`, `command`, or `container`; default `agent` |
| `executionBackend` | string | No | Canonical execution interface identifier such as `codex-agent`, `claude-code-agent`, `official/openai-sdk`, or `official/anthropic-sdk` |
| `model` | string | No | Required when `nodeType = "agent"`; provider or backend-specific model name such as `gpt-5` or `claude-sonnet-4-5` |
| `promptTemplate` | string | No* | Required when `nodeType = "agent"`; may be resolved from `promptTemplateFile` during workflow load |
| `promptTemplateFile` | string | No | Workflow-relative path to a prompt source file such as `prompts/<node-id>.md` |
| `variables` | object | Yes | Template bindings |
| `command` | object | No | Required when `nodeType = "command"` |
| `container` | object | No | Required when `nodeType = "container"` |
| `durability` | object | No | Node-level durable storage policy; currently meaningful for `container` nodes |
| `argumentsTemplate` | object | No | Structured arguments skeleton to pass to skill/tool adapters |
| `argumentBindings` | array of `ArgumentBinding` | No | Runtime mapping rules for complex input assembly |
| `templateEngine` | string | No | Default `mustache`; logic-heavy engines are out of scope |
| `timeoutMs` | number | No | Overrides workflow default timeout |

`*` Authoring rule:
- `agent` payloads may omit inline `promptTemplate` and provide `promptTemplateFile` instead.
- After workflow load, normalized `agent` payloads contain the effective `promptTemplate` string.
- `promptTemplateFile` remains on the normalized payload as provenance and authoring metadata.
- `command` and `container` payloads do not require prompt fields unless a later execution mode explicitly adopts them.

Legacy read-compatible aliases:
- `prompt` -> `promptTemplate`
- `variable` -> `variables`

Legacy compatibility mode:
- If `executionBackend` is omitted and `model` is `tacogips/codex-agent` or `tacogips/claude-code-agent`, the runtime derives the backend from `model`.
- This read path remains supported for existing workflows, but new templates and edited payloads should write explicit `executionBackend`.
- If `nodeType` is omitted, loaders normalize it to `agent`.

`ArgumentBinding`:
- `targetPath: string` (JSON pointer-like path in `argumentsTemplate`)
- `source: "variables" | "node-output" | "sub-workflow-output" | "workflow-output" | "human-input" | "conversation-transcript"`
- `sourceRef?: OutputRef | string` (required for output-based sources)
- `sourcePath?: string` (JSON path in resolved source payload)
- `required?: boolean`

`CommandExecution`:
- `scriptPath: string` (workflow-relative path; must remain inside the workflow directory)
- `argvTemplate?: string[]`
- `envTemplate?: Record<string, string>`
- `workingDirectory?: string`

`ContainerExecution`:
- `runnerKind?: "podman" | "docker" | "nerdctl" | "apple-container"` (falls back to workflow defaults, then to `podman`)
- `runnerPath?: string`
- `image?: string` (mutually exclusive with `build`)
- `build?: ContainerBuild` (mutually exclusive with `image`)
- `entrypoint?: string[]`
- `argsTemplate?: string[]`
- `envTemplate?: Record<string, string>`
- `workingDirectory?: string`
- `workspace?: ContainerWorkspace`
- `resources?: ContainerResources`
- `networkPolicy?: "disabled" | "egress-allowed"`

`ContainerBuild`:
- `contextPath: string` (workflow-relative path without `.` or `..` segments)
- `containerfilePath?: string` (workflow-relative path; must not target canonical workflow definition files)
- `dockerfilePath?: string` (legacy alias for `containerfilePath`)
- `target?: string`

`ContainerWorkspace`:
- `mode?: "none" | "ephemeral"`
- `mountPath?: string` (defaults to `/workspace`)

`ContainerResources`:
- `cpuMax?: number`
- `memoryMaxMb?: number`
- `pidsMax?: number`

`NodeDurability`:
- `mode: "disabled" | "node-persistent"`
- `mountPath?: string` (defaults to `/durable` when `mode = "node-persistent"`)

Current runtime behavior:

- `container` nodes are the only nodes that use `container` execution metadata.
- Exactly one image source must be declared: `container.image` or `container.build`.
- file inputs for `container` nodes are delivered only through inbox-visible paths under `/mailbox/inbox`
- `stdout` and `stderr` are execution logs, not workflow output channels
- accepted workflow output is runtime-promoted from staged files under `/mailbox/outbox`
- `durability.mode = "node-persistent"` indicates that the runtime should mount a writable host-backed directory into the container at `durability.mountPath` or `/durable`
- the durable host path is `{artifact-root}/{workflow_id}/durable/{node_id}/`
- The runtime currently does not execute container nodes yet; the design defines the authoring and validation contract for a future executor.

### workflow-vis.json

| Field | Type | Required | Notes |
|------|------|----------|-------|
| `nodes` | array of `VisNode` | Yes | Per-node vertical ordering metadata |
| `uiMeta` | object | No | Non-runtime UI metadata |

`VisNode`:
- `id: string`
- `order: number` (non-negative integer; unique per node)

Derived in UI/runtime presentation (not persisted in `workflow-vis.json`):
- `indent` is computed from graph structure and loop semantics.
- `color` is computed from loop/group scope.

### Runtime Execution Artifact (`{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{node}/{node-exec-id}/`)

Path variable mapping:
- `{artifact-root}` resolves via CLI/env/default policy
- `{workflow_id}` = `workflow.json.workflowId`
- `{workflowExecutionId}` = unique id for one workflow run

| Field | Type | Required | Notes |
|------|------|----------|-------|
| `input.json` | object | Yes | Fully resolved node input payload |
| `output.json` | object | Yes | Node execution output payload |
| `meta.json` | object | Yes | Status and execution metadata |

`meta.json` minimum fields:
- `nodeId: string`
- `nodeExecId: string`
- `status: "succeeded" | "failed" | "timed_out" | "cancelled"`
- `startedAt: string` (ISO timestamp)
- `endedAt: string` (ISO timestamp)

## Internal Runtime Models

These are normalized in memory after file loading and validation.

### WorkflowDefinition (normalized)

- `workflowId: string`
- `description: string`
- `workflowType: "single" | "orchestrate"`
- `defaults: RuntimeDefaults`
- `managerNodeId: NodeId`
- `subWorkflows: Map<SubWorkflowId, SubWorkflow>`
- `nodeGroups: Map<string, NodeGroup>`
- `subWorkflowConversations: Map<ConversationId, SubWorkflowConversation>`
- `nodes: Map<NodeId, WorkflowNode>`
- `adjacency: Map<string, WorkflowEdge[]>`
- `loops: Map<LoopId, LoopRule>`
- `branchMode: "fan-out"`
- `executionArtifactsRoot: string` (resolved: `{artifact-root}/{workflow_id}/executions/{workflowExecutionId}`)

### RuntimeDefaults

- `maxLoopIterations: number`
- `nodeTimeoutMs: number`
- `containerRuntime?: ContainerRuntimeDefaults`

### WorkflowNode

- `id: NodeId`
- `kind: "task" | "branch-judge" | "loop-judge" | "root-manager" | "sub-oyakata-manager" | "input" | "output"`
- `nodeType: "agent" | "command" | "container"`
- `executionBackend?: "codex-agent" | "claude-code-agent" | "official/openai-sdk" | "official/anthropic-sdk"`
- `model?: string` (`agent` nodes require it)
- `promptTemplate?: string` (`agent` nodes require it directly or via `promptTemplateFile`)
- `promptTemplateFile?: string`
- `variables: Record<string, unknown>`
- `command?: CommandExecution`
- `container?: ContainerExecution`
- `durability?: NodeDurability`
- `timeoutMs: number` (effective timeout after default merge)
- `completion: CompletionRule | null` (null means auto-complete)

Prompt-source invariants:
- Referenced prompt files must remain within the workflow directory.
- Prompt files are part of the workflow-definition revision surface.
- Long prompt bodies should prefer `promptTemplateFile` plus workflow-local Markdown/text files over large JSON string literals.

### SubWorkflow

- `id: SubWorkflowId`
- `description: string`
- `definitionType: "inline" | "workflow-ref"`
- `managerNodeId?: NodeId`
- `inputNodeId?: NodeId`
- `outputNodeId?: NodeId`
- `nodeIds?: NodeId[]`
- `workflowId?: WorkflowId`
- `inputSources: SubWorkflowInputSource[]`

### NodeGroup

- `id: string`
- `executionMode: "concurrent"`
- `members: NodeGroupMember[]`
- `completionPolicy: "all" | "any"`
- `maxParallelism: number | null`
- `failurePolicy: "fail-fast" | "wait-all"`

### SubWorkflowConversation

- `id: ConversationId`
- `participants: SubWorkflowId[]`
- `maxTurns: number`
- `stopWhen: string`
- `conversationPolicy?: ConversationPolicy`

### ConversationMessageEnvelope

- `conversationId: ConversationId`
- `fromSubWorkflowId: SubWorkflowId`
- `toSubWorkflowId: SubWorkflowId`
- `fromManagerNodeId: NodeId`
- `toManagerNodeId: NodeId`
- `outputRef: OutputRef`
- `communicationId: string` (required mailbox-backed transport reference)
- `payload?: Record<string, unknown>` (derived view only; not an independent transport source of truth)
- `sentAt: string`

### Communication (mailbox transport)

- `workflowId: WorkflowId`
- `workflowExecutionId: string`
- `communicationId: string`
- `fromNodeId: NodeId`
- `toNodeId: NodeId`
- `fromSubWorkflowId?: SubWorkflowId`
- `toSubWorkflowId?: SubWorkflowId`
- `routingScope: "parent-to-sub-workflow" | "cross-sub-workflow" | "intra-sub-workflow"`
- parent/child callable workflow handoff is represented as boundary delivery between execution-local mailbox roots, not by exposing one global mailbox tree across workflows
- `sourceNodeExecId: string`
- `payloadRef: OutputRef`
- `deliveryKind: "edge-transition" | "loop-back" | "manual-rerun" | "conversation-turn"`
- `status: "created" | "delivered" | "consumed" | "delivery_failed" | "superseded"`
- `activeDeliveryAttemptId?: string`
- `deliveryAttemptIds: string[]`
- `activeAgentSessionRef?: AgentSessionRef`
- `agentSessionRefs?: AgentSessionRef[]`
- `createdAt: string`
- `deliveredAt?: string`
- `consumedByNodeExecId?: string`
- `consumedAt?: string`
- `failureReason?: string`
- `supersededByCommunicationId?: string`
- `supersededAt?: string`

### DeliveryAttempt

- `workflowExecutionId: string`
- `communicationId: string`
- `deliveryAttemptId: string`
- `toNodeId: NodeId`
- `status: "running" | "succeeded" | "failed" | "aborted"`
- `startedAt: string`
- `endedAt?: string`
- `restartOfDeliveryAttemptId?: string`
- `failureReason?: string`

### AgentSessionRef

- `allocatorNodeId: NodeId`
- `agentSessionId: string`

### CompletionRule

- `type: "checklist" | "score-threshold" | "validator-result" | "none"`
- `config: object`

`type: "none"` or `completion: null` indicates no success judgment and auto-complete behavior.

### WorkflowEdge (normalized)

- `from: NodeId`
- `to: NodeId`
- `when: string`
- `priority: number | null`

### LoopRule (normalized)

- `id: LoopId`
- `judgeNodeId: NodeId`
- `maxIterations: number` (effective value after default merge)
- `continueWhen: string`
- `exitWhen: string`
- `backoffMs: number | null`

### NodeExecutionArtifactRef

- `nodeId: NodeId`
- `nodeExecId: string`
- `artifactDir: string` (format: `{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{node}/{node-exec-id}`)
- `inputPath: string` (`{artifactDir}/input.json`)
- `outputPath: string` (`{artifactDir}/output.json`)
- `metaPath: string` (`{artifactDir}/meta.json`)

### ResolvedInputPayload

- `promptText?: string` (rendered from `promptTemplate`)
- `arguments?: Record<string, unknown>` (assembled from `argumentsTemplate` + `argumentBindings`)
- `sourceOutputRefs: OutputRef[]`

## Model Invariants

- Every `workflow.json.nodes[].id` must be unique.
- Every node id must match `^[a-z0-9][a-z0-9-]{1,63}$`.
- Every `nodeFile` must exist in same workflow directory.
- `node-{id}.json.id` must match referenced workflow node id.
- Every executed node must create one unique `nodeExecId`.
- Every executed node must persist artifacts in `{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{node}/{node-exec-id}`.
- Every artifact directory must include `input.json`, `output.json`, and `meta.json`.
- `managerNodeId` must reference exactly one node with `kind: "root-manager"` (oyakata manager).
- `workflowType` defaults to `orchestrate`; `single` and `orchestrate` are the only valid authored values.
- Every `inline subWorkflows[]` entry must reference existing `sub-oyakata-manager`/`input`/`output` nodes.
- Every `inline subWorkflows[].nodeIds[]` entry must reference an existing node id.
- Every `inline subWorkflows[]` manager/input/output node id must be included in `subWorkflows[].nodeIds[]`.
- No node id may belong to more than one `inline subWorkflows[].nodeIds[]`.
- Every `workflow-ref subWorkflows[]` entry must reference an existing workflow definition by `workflowId`.
- Every sub-workflow boundary delivery must terminate at the recipient sub-workflow manager boundary.
- Every `Communication` must belong to exactly one `workflowExecutionId`.
- Every `Communication.communicationId` must be unique within one `workflowExecutionId`.
- Every `DeliveryAttempt.deliveryAttemptId` must be unique within one `Communication`.
- Every `AgentSessionRef` tuple (`allocatorNodeId`, `agentSessionId`) must be unique within one `workflowExecutionId`.
- Every `Communication` must reference exactly one sender node and one recipient node.
- Worker nodes must not write mailbox transport artifacts directly; only managers may materialize `Communication` and `DeliveryAttempt` records.
- Every cross-sub-workflow communication must target the recipient sub-workflow manager boundary, not a leaf node.
- `SubWorkflowInputSource.type = "workflow-output"` requires `workflowId`.
- `SubWorkflowInputSource.type = "node-output"` requires `nodeId`.
- `SubWorkflowInputSource.type = "sub-workflow-output"` requires `subWorkflowId`.
- `selectionPolicy.mode = "explicit"` requires `selectionPolicy.nodeExecId`.
- `selectionPolicy.mode = "by-loop-iteration"` requires `selectionPolicy.loopIteration`.
- Output-based input handoff must resolve to a concrete `OutputRef` before node execution.
- Every `subWorkflowConversations[].participants[]` entry must reference an existing sub-workflow.
- Every `SubWorkflowConversation.participants` set must contain at least two distinct sub-workflow ids.
- Every `SubWorkflowConversation.maxTurns` must be a positive integer.
- Every `ConversationMessageEnvelope.communicationId` must reference an existing `Communication.communicationId` in the same `workflowExecutionId`.
- If `ConversationPolicy.turnPolicy = "score-priority"`, `convergencePolicy` must be present.
- If `ConversationPolicy.parallelBranches.enabled = true`, `mergePolicy` must be present.
- `ConversationBudgetPolicy.maxTokens` and `maxCostUsd` (if present) must be positive.
- Every edge endpoint must resolve to a node id, sub-workflow id, or node-group id declared in the same workflow.
- Every `loops[].judgeNodeId` must reference an existing node with kind `loop-judge`.
- Every `loops[].maxIterations` (if present) must be a positive integer.
- Effective loop max iterations must exist for every loop (loop-local or global default).
- Every loop rule must define both `continueWhen` and `exitWhen`.
- Branch mode is always fan-out.
- Effective timeout exists for every executable node (node override or default).
- Loop execution must be bounded (explicit `loops` config or global default).
- `nodeType` defaults to `agent`; `agent`, `command`, and `container` are the valid authored values.
- `agent` nodes must define `model`.
- `agent` nodes must define inline `promptTemplate` or a resolvable `promptTemplateFile`.
- `command` nodes must define `command.scriptPath`.
- `command.scriptPath` and `command.workingDirectory` must remain inside the workflow directory.
- `container` nodes must define `container`.
- `container.image` and `container.build` are mutually exclusive, and one is required.
- `container.build.containerfilePath` and legacy `container.build.dockerfilePath` must remain inside the workflow directory and must not target canonical workflow definition files.
- `workflow.defaults.containerRuntime.runnerKind` defaults to `podman`.
- `container.networkPolicy`, when present, must be `disabled` or `egress-allowed`.
- `container.workspace.mountPath`, when present, must be an absolute container path.
- `container.resources.cpuMax`, `memoryMaxMb`, and `pidsMax`, when present, must be positive.
- `durability.mode`, when present, must be `disabled` or `node-persistent`.
- `durability.mountPath`, when present, must be an absolute container path.
- `durability` is currently valid only for `container` nodes.
- container-node file references exposed to workers must resolve under `/mailbox/inbox`; no separate arbitrary input-file mount mechanism exists in v1.
- Every `nodeGroups[]` entry with `executionMode = "concurrent"` must have at least two members.
- Every `nodeGroups[].members[]` entry must reference an existing node id or sub-workflow id.
- Every `single` workflow must keep orchestration local to the root manager and must not depend on `nodeGroups` or inline child execution scopes for its main path.
- `templateEngine` must be `mustache` when specified.
- `argumentsTemplate` with `argumentBindings` must produce valid JSON object before adapter invocation.

## Human Review Checklist

Before approving a workflow model:

1. Domain intent
- `description` clearly explains workflow goal and output expectation.

2. Graph correctness
- Start path exists.
- No unintended dead-end nodes.
- Fan-out branches are intentional and bounded downstream.
- `managerNodeId` exists and is `kind: "root-manager"` controlling all sub-workflow starts.
- Each inline sub-workflow has valid manager, input, and output boundary nodes, and a complete `nodeIds` membership list.
- Each workflow-ref sub-workflow points to the intended child `workflowId`, and the child `workflowType` matches the expected behavior (`single` vs `orchestrate`).
- Concurrent node groups are explicit where same-step fan-out is intended.
- Conversation participants map to existing sub-workflows and expected dialog topology.
- Conversation policy is explicit for turn-taking, memory, tools, convergence, branching, and budget.
- For subgroup pipelines (e.g. subgroup1->subgroup2->subgroup3->subgroup4), order and loop-back edge targets are explicit and reviewable.
- For adversarial role loops (e.g. blackhat->whitehat->mediation), role handoff edges and commit checkpoints are explicit.

3. Node runtime quality
- `executionBackend` and `model` are not conflated in newly authored nodes.
- `nodeType` correctly distinguishes agent execution, command execution, and opaque container execution.
- `promptTemplate` is understandable and deterministic.
- `variables` do not contain missing placeholders.
- Command nodes receive only the intended inbox-derived argv/env values.
- Container nodes declare the intended future image/build metadata and runner selection clearly, and current runtime behavior fails explicitly instead of silently falling back to host execution.
- Container nodes use inbox-only file input, runtime-owned output publication, and explicit resource/network policy appropriate to their task.
- Container nodes that need workload-managed persistence use explicit `durability` rather than relying on execution-artifact paths or backend session-policy semantics.
- Output handoff to downstream nodes is traceable via execution artifact references.

4. Safety controls
- Timeouts are realistic for each heavy node.
- Loop defaults and node-level overrides prevent runaway execution.
- Iterative hardening loops have explicit `maxIterations` (recommended: `3` for review/fix rounds).
- Debate loops define explicit convergence/termination conditions (for example issue exhaustion) plus max-round fallback.

5. Completion semantics
- Nodes requiring quality gates define explicit `completion`.
- Auto-complete nodes are intentionally marked.
- Sub-workflow output nodes define completion compatible with handoff requirements.

6. Visualization hygiene
- `workflow-vis.json` only contains UI state.
- No runtime behavior encoded in visualization metadata.

## Review Output Template

Use this concise format during human review:

- `Model`: Pass | Changes Required
- `Critical Issues`:
- `Ambiguous Fields`:
- `Safety Concerns`:
- `Approved Defaults`: `maxLoopIterations`, `nodeTimeoutMs`

## References

- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`
