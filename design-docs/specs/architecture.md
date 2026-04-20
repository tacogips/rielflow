# Architecture Design

This document describes the current runtime architecture implemented in `src/workflow/`, `src/server/`, and `src/tui/`.

## Overview

`divedra` executes JSON-defined workflows by combining:

- workflow definition loading and validation
- queue-based session orchestration
- mailbox communication artifacts between nodes
- backend adapters for agent execution
- runtime-owned output validation and publication
- manager-scoped control-plane access for manager nodes

The current implementation is centered on the persisted workflow session and its queue. Manager nodes are important, but they do not replace the queue-based engine.

## Core Architectural Boundaries

### Workflow Definition Boundary

Workflow definitions live under `<workflow-root>/<workflow-name>/` and are composed from:

- `workflow.json`
- referenced node payload JSON files
  - default location: `nodes/node-{id}.json`
  - authors may also place payloads in workflow-relative nested paths such as `workflows/<lane>/nodes/node-{id}.json`
  - when `workflow.json.nodes[].nodeFile` is omitted, the authored inline `workflow.json.nodes[].node` payload is normalized to `nodes/node-{id}.json`
- optional prompt files referenced by `systemPromptTemplateFile`, `promptTemplateFile`, and `sessionStartPromptTemplateFile`

The loader resolves those workflow-local prompt files into effective inline template text before validation and execution, and normalizes inline-authored node payloads to stable workflow-relative paths.

### Runtime State Boundary

The runtime persists three distinct forms of state:

- workflow session state in `{DIVEDRA_ARTIFACT_DIR}/sessions/` (default: `~/.divedra/project/<encoded-project-root>/divedra-artifact/sessions/`, where `<encoded-project-root>` is the nearest ancestor containing `.divedra` when present, otherwise the current working directory, with path segments joined by `__` and path-hostile characters normalized to `_`)
- node and communication artifacts in `{DIVEDRA_ARTIFACT_DIR}/workflow/`
- query-oriented runtime index data in `{DIVEDRA_ARTIFACT_DIR}/divedra.db`

File artifacts remain the authoritative source for execution payloads. SQLite is a best-effort index for CLI, TUI, and GraphQL inspection queries.

When CLI or API entrypoints receive explicit artifact and/or session-store roots, they infer `rootDataDir` from those explicit storage roots when possible so `divedra.db` stays co-located with the selected runtime tree instead of drifting to an ambient `DIVEDRA_ARTIFACT_DIR`.

### Execution Boundary

The main runtime entrypoint is `runWorkflow()` in `src/workflow/engine.ts`.

It owns:

- session creation, resume, and rerun
- queue progression
- timeout and stuck-restart handling
- output-contract validation and retry
- communication publication and consumption
- loop transition resolution
- manager-control validation
- final workflow-output publication

Execution-time working directory is resolved separately from workflow/artifact/session root resolution.

- default workflow execution working directory: command invocation `cwd`
- run-scoped override: explicit execution input working directory
- node-scoped override: `nodePayload.workingDirectory`, resolved from the effective workflow execution working directory

Supporting design: `design-docs/specs/design-workflow-working-directory.md`.

## Primary Components

### Workflow Loader and Validator

Source:

- `src/workflow/load.ts`
- `src/workflow/validate.ts`

Responsibilities:

- read workflow bundle files
- resolve `promptTemplateFile`
- normalize inline node authoring and workflow-relative node payload paths
- validate node kinds, sub-workflow boundaries, edges, loops, and payload shapes

Important validation facts:

- authored workflows may use `role: "manager" | "worker"` plus `control`
- worker-only workflows are valid when `entryNodeId` is explicit
- authored `workflowCalls` are accepted, loaded, and executable when their target workflow bundles resolve under the configured workflow root
- non-empty authored `subWorkflows[]` are treated as legacy structural compatibility input and are rejected when combined with authored `role` / `control` nodes
- non-empty authored `subWorkflowConversations[]` are treated the same way and are rejected when combined with authored `role` / `control` nodes
- structural boundary node kinds `subworkflow-manager`, `input`, and `output` are rejected when combined with authored `role` / `control` nodes
- the validator still normalizes authored roles into legacy structural `kind` values and an effective runtime `managerNodeId` so the current engine can execute transitional bundles
- `root-manager`, `subworkflow-manager`, `input`, and `output` remain the structural roles enforced by the current runtime compatibility layer
- cross-scope edges must target manager boundaries
- `branching.mode` is currently fixed to `fan-out`

### Node Add-on Catalog

Workflow node references may use built-in add-ons as an authoring shortcut for
runtime-provided worker behavior. Add-ons are resolved by the loader into
effective node payloads before execution, while save/edit surfaces preserve the
authored add-on reference.

Initial scope:

- built-in-only `divedra/*` add-ons
- no network resolution at workflow load time
- `divedra/chat-reply-worker` as the first built-in add-on
- add-on nodes remain ordinary worker nodes after resolution

The chat reply worker creates provider-neutral reply requests from
`runtimeVariables.event` and dispatches them through the event reply adapter
registry. Provider SDKs and credentials remain in the event layer, not in the
workflow engine.

Supporting design:
`design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`.

### Prompt and Input Assembly

Source:

- `src/workflow/input-assembly.ts`
- `src/workflow/prompt-composition.ts`
- `src/workflow/prompt-template-context.ts`

Responsibilities:

- merge runtime variables with node variables
- resolve `argumentBindings`
- expose inbox/upstream payloads to templates
- compose manager and worker system prompt layers
- choose the default manager system prompt by active execution model, so role-authored workflows without structural compatibility use current-workflow and explicit-`workflowCalls` guidance while structural sub-workflow wording remains limited to compatibility bundles that still author those boundaries
- prepend node-authored session-start prompts only when a backend session is first created
- inject workflow and sub-workflow structure summaries
- keep manager mailbox/control guidance aligned with the active execution model, so role-authored workflows advertise current-workflow retry/replay/optional-node actions while legacy structural sub-workflow actions remain documented only for compatibility paths

The runtime distinguishes:

- node `kind`: structural role
- node `nodeType`: execution flavor

That separation is still fundamental to the current runtime design, even though authored workflow design is moving toward `role` plus `control` rather than structural `kind`.

### Adapter Layer

Source:

- `src/workflow/adapter.ts`
- `src/workflow/adapters/*`

Responsibilities:

- execute agent nodes against concrete backends
- propagate backend session reuse when `sessionPolicy.mode = "reuse"`
- enforce runtime timeout boundaries through adapter cancellation

Current implementation status:

- `agent` nodes execute
- `command` and `container` nodes execute through the native node executor

### Session and Communication Model

Source:

- `src/workflow/session.ts`
- `src/workflow/session-store.ts`
- `src/workflow/runtime-db.ts`

Responsibilities:

- persist queue and node execution history
- track loop counts, restart counts, and transitions
- record mailbox communications and conversation turns
- expose stable session identity for CLI, TUI, GraphQL, and library consumers

The queue is deduplicated after each scheduling pass. Multiple matched branch edges still fan out to multiple recipients, but duplicate node ids are collapsed in the queue view.

### Workflow Invocation and Legacy Structural Planning

Source:

- `src/workflow/sub-workflow.ts`
- `src/workflow/conversation.ts`
- `src/workflow/manager-control.ts`

Responsibilities:

- execute explicit authored `workflowCalls` as ordinary child workflow runs
- deliver workflow-call results back through runtime-owned communications when configured
- auto-start eligible `plain` sub-workflows
- map parent manager outputs into child input deliveries
- allow validated manager override actions
- run round-robin conversation turns between sub-workflows

Current planning behavior:

- authored `workflowCalls` execute immediately after their caller node succeeds and stay on the active role-authored path
- workflow-call result delivery is runtime-owned and uses ordinary upstream communications keyed by `workflow-call:<id>`
- root manager can auto-start `plain` sub-workflows when `inputSources` are satisfied
- sub-workflow managers can auto-deliver to their owned `input` node
- manager output payloads may include `managerControl.actions`
- the runtime validates control scope before honoring those actions
- the structural sub-workflow bullets above remain compatibility behavior for explicitly legacy-authored bundles and are the next cleanup target

### Server and GraphQL Control Plane

Source:

- `src/server/*`
- `src/graphql/*`

Responsibilities:

- expose `/graphql` for workflow-definition and execution/session control flows
- expose `/healthz` for liveness checks
- keep manager auth/session scope on the HTTP transport boundary

Serve-mode behavior:

- `divedra serve` and `divedra web serve` run the same local HTTP control plane
- `/`, `/web`, and `/ui` serve a read-only Solid workflow viewer shell
- `/assets/workflow-viewer.js` serves the bundled browser viewer asset, falling back to a source build in development
- an optional fixed workflow name constrains GraphQL workflow-definition access to that authored bundle
- `readOnly` is enforced for write mutations
- legacy workflow/session REST routes remain removed; browser data access goes through `/graphql`

Manager scope rules:

- manager auth is established from request transport metadata
- HTTP server ambient environment is not trusted as manager scope
- manager sessions are minted per real manager-node execution

### TUI Runtime Boundary

Source:

- `src/cli.ts`
- `src/tui/runtime.ts`
- `src/tui/opentui-screen.ts`
- `src/tui/opentui-model.ts`
- `src/tui/opentui-controller.ts`
- `src/tui/opentui-detail-content.ts`
- `src/tui/opentui-host-view.ts`
- `src/tui/opentui-solid-app.tsx`
- `src/tui/components/*.tsx`

Responsibilities:

- choose interactive versus fallback TUI runtime mode
- lazy-load the OpenTUI screen boundary only when interactive rendering is needed
- preserve direct resume behavior when `--resume-session` cannot use the full-screen TUI
- keep the checked-in screen host compatible with the `@opentui/solid` view layer

Current implementation status:

- `src/tui/opentui-screen.ts` now creates the renderer and orchestrates focus, key routing, popup wiring, and async workflow actions, while the rendered screen tree lives in `src/tui/opentui-solid-app.tsx` and `src/tui/components/*.tsx`
- `src/tui/opentui-model.ts` now owns the reusable workflow-preview/header and summary-selection helpers instead of duplicating that presentation logic in the host
- `src/tui/opentui-controller.ts` owns run/rerun/resume/copy/refresh/input-format orchestration so the host no longer embeds those async action bodies inline
- `src/tui/opentui-detail-content.ts` now owns mailbox/artifact-backed node-detail content loading plus history-detail pane state assembly so the host no longer embeds that file-IO and summary/viewer/detail decision tree directly
- `src/tui/opentui-host-view.ts` now owns mounted-ref validation and pane-chrome application so the host does not repeat view-wiring checks and border/title updates across render paths
- the remaining host-local helpers are renderer-specific concerns such as clipboard integration and bounded-select coordination; workflow/sub-workflow lookup helpers now live on the model seam
- CLI fallback detection now treats missing `@opentui/core`, `@opentui/solid`, and required `solid-js` runtime modules as reasons to use the non-OpenTUI path
- interactive `divedra tui` now enters the unified Solid workspace/history/run app directly instead of passing through a separate selector-only OpenTUI surface
- Bun and TypeScript are configured for the checked-in `.tsx` OpenTUI modules; JSX compilation uses the standard `solid-js` runtime while `@opentui/solid` provides the renderer and terminal component catalogue

## Event Listener Workflow Triggers

External events should be modeled as a separate trigger layer that invokes the
existing workflow execution boundary. Provider-specific cron, webhook, chat, and
UI adapters normalize incoming events into a canonical envelope, map that
envelope into workflow runtime input, persist an event receipt for idempotency,
and then call `createWorkflowExecutionClient()` or GraphQL `executeWorkflow`.

The workflow engine should not import provider SDKs or provider-specific event
types. Event bindings live outside workflow bundles so adding or changing an
event source does not mutate `workflow.json`.

Supporting design:
`design-docs/specs/design-event-listener-workflow-trigger.md`.

## Runtime Node Roles

Current authored direction:

- `role: "manager"` or `role: "worker"`
- optional `control: "branch-judge" | "loop-judge" | "none"`
- `entryNodeId` may be the authored entry when a workflow has no manager

Current structural node kinds:

- `task`
- `branch-judge`
- `loop-judge`
- `root-manager`
- `subworkflow-manager`
- `input`
- `output`

The engine still executes against these normalized structural kinds today. Manager-less authored workflows currently work by normalizing the authored `entryNodeId` into an effective runtime entry/manager identity. Explicit authored `workflowCalls` now execute as ordinary child workflow runs, but structural sub-workflow boundaries and their dedicated runtime semantics still remain and are the next removal target.

Role split:

- root manager: workflow-global coordination
- sub-workflow manager: local coordination for one sub-workflow boundary
- input: normalize inbound mailbox/runtime data
- output: publish a scope boundary result
- judge nodes: emit branch/loop decisions
- task: ordinary business work

Current execution policies:

- `user-action` is implemented as a `nodeType`, not as a new manager boundary, so human approval/input remains a runtime-owned execution flavor rather than a second structural control-flow system
- optional node execution is implemented as scheduler policy on `workflow.json.nodes[]`
- the current workflow manager may explicitly choose `execute-optional-node` or `skip-optional-node`, while legacy structural `subworkflow-manager` scope remains limited to its owned compatibility boundary
- node add-ons are an authoring reuse layer, not a third role axis; after
  resolution, an add-on node executes as a normal worker with descriptor
  provenance recorded in runtime metadata
- detailed design: `design-docs/specs/design-user-action-and-optional-node-execution.md`

## Current Execution Flow

```mermaid
sequenceDiagram
    autonumber
    actor U as Caller
    participant L as Loader
    participant S as Session Store
    participant E as Engine Queue
    participant A as Adapter
    participant V as Output Validator
    participant C as Communication Store

    U->>L: load workflow bundle
    L-->>U: validated workflow + node payloads
    U->>S: create or resume workflow session

    loop while queue not empty
        E->>S: load current session state
        E->>C: resolve upstream communications
        E->>E: compile execution inbox/outbox contract
        E->>S: persist input.json and mailbox/inbox/*
        E->>A: execute node
        A-->>E: candidate output
        E->>V: validate candidate output if contract exists
        V-->>E: accepted or rejected
        E->>S: persist output/meta/handoff
        E->>C: mark upstream communications consumed
        E->>C: publish edge and manager-planned communications
        E->>S: persist updated queue and session state
    end

    E->>C: publish final root-scope output to external mailbox
    E->>S: mark session completed
```

## Mailbox Architecture

The runtime communicates between nodes through persisted communication artifacts, not only in-memory transitions.

Each communication records:

- source node id and node execution id
- destination node id
- routing scope
- payload reference
- delivery kind
- lifecycle timestamps

Routing scopes:

- `external-mailbox`
- `parent-to-sub-workflow`
- `intra-sub-workflow`
- `cross-sub-workflow`

Delivery kinds:

- `edge-transition`
- `loop-back`
- `manual-rerun`
- `conversation-turn`
- `external-input`
- `external-output`

This mailbox layer is the architectural boundary that lets root workflows, sub-workflows, and external callers use the same handoff model.

Worker nodes do not consume that canonical transport layout directly.
Before each node execution, the runtime compiles a worker-facing execution
inbox/outbox contract under the node artifact directory. That contract is the
stable node-facing ABI across `agent`, future `command`, and future
`container` execution. See
`design-docs/specs/design-node-execution-inbox-contract.md`.

## Output Ownership

The runtime, not the adapter, owns final publication.

That means:

- adapters may propose a candidate payload
- the runtime validates it
- the runtime writes canonical `output.json`
- the runtime publishes downstream mailbox artifacts only after acceptance

Workers may target execution-local outbox paths such as
`mailbox/outbox/output.json`, but those paths are staging surfaces only. They do
not grant authority over canonical mailbox publication.

This is especially important for nodes that declare `output.jsonSchema`.

## Control-Flow Semantics

### Branching

- outgoing edges are filtered by `when`
- matching is fan-out, not priority-based single-choice routing
- expressions are evaluated against `output.when.<name>` first, then top-level booleans

### Loops

- loop rules attach to a `loop-judge`
- `continueWhen` and `exitWhen` are evaluated from the judge output
- `maxIterations` falls back to `defaults.maxLoopIterations`

### Completion

The engine checks completion after successful execution and output publication. A node can still fail the workflow after producing syntactically valid output if its completion rule does not pass.

## Manager Control Architecture

Manager nodes may return `payload.managerControl.actions`.

Currently supported actions:

- `planner-note`
- `start-sub-workflow`
- `deliver-to-child-input`
- `retry-node`
- `replay-communication`
- `execute-optional-node`
- `skip-optional-node`

Scope enforcement:

- explicit authored `workflowCalls` run automatically from their caller nodes; managers do not emit `start-sub-workflow` or `deliver-to-child-input` for the active role-authored path
- only the root manager of an explicitly legacy structural bundle may start sub-workflows
- only a legacy structural sub-workflow manager may deliver to its owned child input node
- retries must stay within the manager's allowed scope
- communication replay must stay within the manager's allowed scope
- optional-node decisions must stay within the manager's allowed scope

Manager sessions are minted per manager-node execution and expire when that node execution finishes.

## Current Limitations

- the main runtime remains queue-based; the local `call-node` path is not the whole orchestration model
- `LoopRule.backoffMs` exists in schema, but loop backoff is not currently applied directly by the main engine
- node ordering lives in `workflow.json.nodes[]`, and runtime execution derives semantics from that canonical definition

## References

- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/design-data-model.md`
- `design-docs/specs/design-node-execution-inbox-contract.md`
- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`
- `design-docs/specs/design-graphql-manager-runtime-session-lifecycle.md`
