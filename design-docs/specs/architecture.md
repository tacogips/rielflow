# Architecture Design

This document defines the architecture for cooperative multi-agent workflow execution.

## Overview

`oyakata` manages writing sessions by executing JSON-defined workflows across multiple execution backends, primarily:

- `codex-agent`
- `claude-code-agent`

The architecture focuses on deterministic orchestration, explicit completion conditions, and controlled branching/looping. Structural blocks such as grouped steps, branch bodies, and loop bodies are all modeled as sub-workflow scopes. A workflow may itself be invoked as a callable child workflow by `workflowId`, so workflow boundaries are also execution boundaries.

Near-term runtime direction:

- The longer-term queue-based runtime remains documented in this file.
- The current simplification target is a manager-driven execution model where a long-lived manager session explicitly calls child nodes through a dedicated runtime API.
- In that simplified model, workflow-order adherence is carried mainly by the manager prompt contract instead of a second runtime order-state machine.
- Near-term policy: do not add dedicated runtime state/order management for next-step legality; instead, make the manager LLM explicitly aware of the workflow and instruct it to call nodes in authored workflow order.
- That near-term direction, including the approved component names `Oyakata Session Driver`, `Call-Node API`, `Execution Dispatcher`, `Node Adapter`, `Output Validator`, and `Mailbox Publisher`, is specified in `design-docs/specs/design-manager-driven-call-node-runtime.md`.

## System Context

Inputs:

- Workflow directory under `<workflow-root>/<workflow-name>/` (default `./.oyakata`)
- Session metadata
- Runtime variables for prompt rendering

Outputs:

- Session artifacts (drafts, reviews, decisions)
- Node execution logs and completion status
- Branch/loop trace for reproducibility

## Core Components

1. Workflow Loader

- Loads `workflow.json`
- Resolves referenced `node-{id}.json`
- Validates schema and node file integrity

2. Workflow Visualization State Manager

- Loads/saves `workflow-vis.json`
- Preserves browser-edited vertical node sequence (`order`)
- Computes grouping presentation (`indent`, `color`) from graph + loop semantics
- Keeps visualization state separate from runtime control logic

3. Prompt Renderer

- Resolves `promptTemplate` with `variables`
- Produces provider-ready prompt payloads

4. Execution Adapter Layer

- Distinguishes executable `nodeType` from structural node `kind`
- Runs `agent` nodes through backend adapters selected by `executionBackend`
- Runs `command` nodes through direct process execution today
- Plans a dedicated container runtime manager/executor for `container` nodes with workflow-level runner defaults and per-node container definitions
- Sends node `model` through the selected agent backend as the provider/backend-specific model name
- Initial agent targets: `codex-agent`, `claude-code-agent`
- Current runtime direction keeps `container` schema explicit but rejects execution until a container executor exists

5. Execution Engine

- Traverses workflow graph
- Expands and executes inline node sequences defined as sub-workflows
- Invokes callable child workflows by `workflowId` and tracks them as node-like execution units in the parent workflow
- Honors `workflowType = "single"` by executing only the root manager path for that workflow
- Honors explicit concurrent `nodeGroups` and dispatches their members in parallel subject to group policy
- Evaluates completion conditions
- Applies branch rules (including branch-judge node results)
- Enforces loop limits (including loop-judge node results)
- Treats branch bodies and loop bodies as normal sub-workflow scopes when the workflow author declares those blocks with `subWorkflows[].block`
- Applies fan-out transitions when multiple branch conditions match
- Enforces node execution timeout (node override or workflow default)
- Composes execution prompts from workflow-level manager/worker prompt policy, runtime context, and node-level prompt text
- Rejects container-node executions explicitly before dispatch today; a future container executor may prepare node-local mailbox mount views at that point

6. Session State Store

- Persists per-node input/output
- Tracks completion evidence
- Stores transition history
- Writes node execution artifacts to `{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{node}/{node-exec-id}/`
- Persists routed communications and, in the GraphQL redesign direction, manager-session control-plane state used by GraphQL manager-message mutations invoked through `oyakata gql`

7. Local HTTP Server (`oyakata serve`)

- Hosts the built browser UI and local API on one process
- Serves the built frontend bundle from `ui/dist/`
- Exposes the canonical GraphQL control-plane endpoint at `/graphql`
- Accepts forwarded ambient manager-session context for GraphQL manager calls via `Authorization` plus `X-Oyakata-Manager-Session-Id`, so `oyakata gql` can stay transport-thin while the server still resolves the correct manager scope
- Treats server-local ambient manager execution variables as non-authoritative on the HTTP boundary; `/graphql` must derive manager auth/scope from request transport metadata rather than inheriting `OYAKATA_MANAGER_*` or `OYAKATA_WORKFLOW_*` from the server process environment
- Treats caller-provided in-process auth/session fallbacks as non-authoritative on the HTTP boundary as well; `handleGraphqlRequest(...)` must not authenticate manager scope from local `context.authToken` or `context.managerSessionId`
- Mints runtime-scoped manager sessions for real manager-node executions and passes ambient GraphQL manager context only to manager-capable adapter backends; see `design-docs/specs/design-graphql-manager-runtime-session-lifecycle.md`
- Persists the authoritative manager control source on each manager session so one manager execution cannot mix GraphQL manager messages with payload `managerControl`
- Enforces manager communication replay/retry scope so root managers stay at root scope and sub-oyakata-managers stay within their owned sub-workflow, with node-ownership fallback for legacy records missing boundary ids
- Returns an explicit setup error page when the built frontend bundle is unavailable instead of embedding a second browser implementation in the server
- Exposes a small UI bootstrap/config endpoint so frontend assets do not need server mode baked in at build time
- Keeps `/api/ui-config` as that bootstrap endpoint and does not serve browser workflow/session REST routes anymore
- Derives the reported frontend mode for that bootstrap/config endpoint from explicit metadata published under `ui/dist/` when available, while still allowing an explicit override for tests or forced deployments
- Resolves that default `ui/dist/` metadata path from the same package root used for frontend entrypoint detection and built-asset serving, so overrides cannot mix one package's source tree with another package's built bundle
- Falls back to checked-in frontend entrypoint detection only when built frontend metadata is absent, so local development and pre-rebuild states still remain diagnosable
- Fails the UI bootstrap/config request explicitly when built frontend metadata is invalid, or when fallback source-entrypoint detection is missing or ambiguous, rather than silently defaulting to a stale framework mode
- Owns the canonical JSON transport contract consumed by the browser UI through shared TypeScript definitions under `src/shared/`, rather than duplicating response shapes inside frontend components
- Keeps repeated request-body normalization and workflow-run option parsing in server-owned helpers under `src/server/` so route handlers stay focused on routing, mode checks, orchestration, and responses
- Keeps browser workflow bundle save/validate request parsing and validation-time node-payload remapping in dedicated server-owned helpers under `src/server/`, so the main API route module does not own ad hoc bundle shape checks
- Keeps built frontend asset resolution, path-safety checks, content-type mapping, and explicit missing-UI responses in a dedicated server-owned helper under `src/server/`, so the main API route module does not mix static-asset concerns with workflow/session endpoints
- Supports workflow listing/loading/saving/validation
- Supports workflow execution start/observe/cancel
- Restricts by default to local interface (`127.0.0.1`)

GraphQL-first redesign direction:

- GraphQL becomes the canonical domain API for execution, communication inspection/replay, and manager control-plane messaging
- CLI commands become thin clients over the same application services/GraphQL contract for domain operations
- GraphQL file/image parameters use data-root-relative file references resolved under the configured Oyakata root data directory instead of host absolute paths
- the served browser workflow-definition, execution, and session surfaces now use GraphQL directly; `/api/ui-config` remains the only browser bootstrap endpoint outside `/graphql`

8. Browser Workflow Editor

- Vertical workflow editing for nodes, edges, branch/loop rules, and defaults
- Ordered list interaction for reorder, indent, and color-based group/loop expression
- Node payload editing (`nodeType`, `executionBackend`, `model`, `promptTemplate`, `variables`, command/isolation settings, `timeoutMs`)
- Layout editing persisted to `workflow-vis.json`
- Run controls and execution trace view for local sessions
- Uses the GraphQL control plane for workflow-definition, execution, and session flows, plus `/api/ui-config` for bootstrap metadata; frontend build output is treated as replaceable static assets rather than inline server-rendered HTML
- Consumes shared transport contracts from `src/shared/` for API/bootstrap/session payloads; mutable editor-local state remains frontend-owned
- Reuses shared workflow domain types from `src/workflow/types.ts` for persisted workflow structures; any editor-only fields must be modeled as explicit additive extensions
- The current checked-in browser implementation is SolidJS-based and is served from the built `ui/dist/` bundle
- Keeps pure editor workflow-structure operations in frontend-owned helper modules under `ui/src/lib/`; the top-level app component is the orchestration layer for UI state, requests, and user-facing messages
- Keeps pure editor support helpers such as parsing, validation merging, status presentation, and error-message normalization in frontend-owned helper modules under `ui/src/lib/`; the top-level app component should not be the canonical home for those pure utilities
- Keeps pure workflow/session state-transition helpers such as reset-state factories, loaded-workflow adaptation, selected-node reconciliation, and workflow-scoped session filtering in frontend-owned helper modules under `ui/src/lib/`
- Keeps bundle-local editor mutation commands for nodes, edges, loops, and sub-workflows in frontend-owned helper modules under `ui/src/lib/`; the top-level app component should orchestrate edits, not remain the canonical home for structure-changing mutation rules
- Keeps multi-request workflow/session hydration and selection-reconciliation flows in frontend-owned loader modules under `ui/src/lib/`; the top-level app component should coordinate loading, polling, and messages, but not duplicate those async data-loading rules
- Keeps bundle and node-property update rules such as node kind/completion changes, edge/default numeric updates, payload string updates, and variable JSON synchronization in frontend-owned helper modules under `ui/src/lib/`; the top-level app component should bind events and orchestrate UI state rather than remain the canonical home for those pure editing rules
- Keeps pure execution-form parsing and execute-request assembly in frontend-owned helper modules under `ui/src/lib/`; the top-level app component should dispatch execution requests and own messages/polling, not remain the canonical home for request-shaping rules
- Keeps the workflow editor center-panel markup in dedicated frontend components under `ui/src/lib/components/`; the top-level app component should own orchestration and state, not the full editor surface markup
- The legacy inline browser editor has been removed; `oyakata serve` now expects the built frontend assets
- The frontend build is a separate project rooted at `ui/`; repository automation must invoke explicit UI verification because the root Bun/TypeScript pipeline does not discover frontend framework sources automatically
- UI verification is framework-specific and routes through framework-detecting repository commands; the current checked-in SolidJS path resolves to the Solid/Vite toolchain while preserving the same repository-level typecheck/build commands plus browser checks
- Those repository-level UI tooling commands must resolve `ui/`, `package.json`, and `node_modules/` from the checked-in script/package root rather than the caller's current working directory, so wrapper scripts and non-root invocation paths cannot silently change the active frontend context
- Repository Bun unit-test commands must scope discovery to source roots (`src/`, `ui/src/`) rather than repository-wide default discovery, so generated `dist/` artifacts cannot re-run stale compiled tests during migration work
- Framework-detecting UI verification must fail with an explicit dependency-install message when the detected frontend framework is not actually installed, so migration-time failures stay actionable instead of surfacing as opaque plugin/import errors
- Repository development environments such as `flake.nix` must provide a real `node` binary in addition to Bun, because Vite, Vitest, and Playwright remain Node-owned tooling in this architecture
- Reserved structure node roles (`root-manager`, `sub-oyakata-manager`, `input`, `output`) are assigned from workflow structure metadata and sub-workflow boundaries, not treated as freeform node-kind values

9. TUI Runtime (Bun + `neo-blessed`)

- Full-screen terminal workflow selector and execution console
- Supports node-by-node execution visibility and log streaming
- Supports interactive user input collection for human-input nodes
- Invokes the same execution engine and artifact contract as CLI/serve paths

## Workflow Execution Model

### Workflow Directory Contract

Each workflow exists in its own directory under `<workflow-root>`:

- `<workflow-root>/<workflow-name>/workflow.json`
- `<workflow-root>/<workflow-name>/workflow-vis.json`
- `<workflow-root>/<workflow-name>/node-{id}.json` (one per executable node)

`workflow.json` must contain `description` to state the workflow objective.

Workflow root resolution:

1. CLI `--workflow-root`
2. `OYAKATA_WORKFLOW_ROOT`
3. `./.oyakata` (default)

### Node Execution Artifact Contract

Each node execution must persist artifacts under:

- `{artifact-root}/{workflow_id}/executions/{workflowExecutionId}/nodes/{node}/{node-exec-id}/`

Where:

- `{artifact-root}` resolution order:
  1. CLI `--artifact-root`
  2. `OYAKATA_ARTIFACT_ROOT`
  3. `./.oyakata-datas/workflow` (default)
- `{workflow_id}` is `workflow.json.workflowId`.
- `{workflowExecutionId}` is the unique id for the enclosing workflow run.
- `{node}` is the workflow node id.
- `{node-exec-id}` is a unique execution id for that node run.

Required artifact files per execution:

- `input.json`: fully resolved runtime input passed to the node
- `output.json`: node execution output payload
- `meta.json`: execution metadata (timestamps, status, model, timeout result)

Node output acceptance contract:

- the Oyakata runtime must capture node completion in the same execution path that launched or awaited that node
- node output becomes accepted only when the runtime marks the node execution complete and publishes runtime-owned artifacts
- after acceptance, the runtime immediately persists `output.json` / `meta.json`, updates session state, and decides the next orchestration step
- if the next step requires manager involvement, the runtime itself starts or queues the manager execution from that transition
- a periodic filesystem watcher must not be the primary mechanism for detecting ordinary node completion
- file watching may exist only inside a backend-specific adapter when an external system can publish results solely through a shared file drop, and even then the adapter must hand the accepted result back into the normal runtime-owned completion path

Timeout/missed-notification inspection contract:

- if the expected manager wake-up or downstream transition does not occur and the workflow times out or appears stuck, operators must be able to inspect the last known node execution state without depending on the original notification path
- the runtime must preserve enough information in session state, runtime DB rows, logs, and node execution artifacts to recover:
  - node execution `status`
  - timeout/failure message
  - `artifactDir`
  - published `output.json` when present
  - published `meta.json`
- GraphQL should expose this through `nodeExecution(...)`
- internal/library inspection should expose the same information through session/runtime-db helpers

`oyakata` manager node responsibilities for chaining:

- read `output.json` from prior node execution artifacts
- resolve and compose next-node input payload
- persist composed input to next node `input.json` before execution

When a downstream input source is `human-input`, the manager requests input through the active UI channel:

- TUI mode: modal/input pane in terminal UI
- non-TUI mode: CLI prompt or API-provided input payload

### Hierarchical Workflow Model

Node sequences may be represented as reusable `sub-workflow` units.

Rules:

- There are two sub-workflow forms:
  - `inline`: declared by nodes in the current workflow definition
  - `workflow-ref`: declared by referencing another workflow via `workflowId`
- An inline sub-workflow must include exactly one `input` node, one `output` node, and one `sub-oyakata-manager` node (`sub oyakata`).
- An inline sub-workflow must declare explicit `nodeIds` membership; mailbox writes from that sub-workflow manager are restricted to those `nodeIds`.
- Sub-workflow `input` may receive data from:
  - direct human input
  - another workflow output
  - another node output
  - another sub-workflow output
- Every workflow has a callable boundary and may therefore behave as one node from a parent workflow's perspective.
- `workflowType = "single"` means the callable workflow executes only its root manager as a lightweight job.
- `workflowType = "orchestrate"` means the callable workflow may invoke nodes, inline sub-workflows, node groups, and further child workflows.
- A workflow must contain exactly one `oyakata` manager node.
- The root workflow manager node (`kind: "root-manager"`) is distinct from sub-workflow manager nodes (`kind: "sub-oyakata-manager"`).
- The `oyakata` manager node is responsible for:
  - selecting and triggering sub-workflow execution
  - writing mailbox deliveries only to the recipient sub-workflow manager boundary for parent-to-sub-workflow or cross-sub-workflow handoff
  - collecting each sub-workflow `output` node result for downstream routing
  - routing messages between sub-workflows during conversation sessions
  - mapping execution artifact outputs to downstream sub-workflow manager inputs
  - emitting plan/assessment instructions that include workflow purpose, given data, and expected child return values
- Each inline sub-workflow manager node is responsible for:
  - reading parent-workflow or peer-sub-workflow mailbox deliveries addressed to that sub-workflow
  - resolving input bindings into child nodes inside the sub-workflow
  - writing mailbox deliveries only to nodes that belong to the same sub-workflow
  - collecting the sub-workflow `output` node result and returning it to the parent workflow manager
- Each `workflow-ref` invocation allocates a distinct child workflow execution. The child workflow's root manager becomes the receiving boundary for the parent mailbox handoff.
- Concurrently executable work should be modeled explicitly as `nodeGroups` rather than inferred from arbitrary sibling edges.

### Inter-Sub-Workflow Conversation

Two or more sub-workflows may exchange messages as a managed conversation.

Rules:

- Sub-workflows do not communicate directly; all messages are routed by the `oyakata` manager node.
- Cross-sub-workflow transport terminates at the recipient sub-workflow manager node, never at a leaf task node inside that sub-workflow.
- After receipt, the recipient sub-workflow manager node is solely responsible for routing the message to child nodes inside that sub-workflow.
- Workflow validation must reject cross-scope edges that bypass those manager boundaries, including root-to-child and child-to-root-worker direct edges.
- Prompt composition details for this nested manager model are defined in `design-docs/specs/design-oyakata-manager-prompt-contract.md`.
- Conversation participants are declared in workflow configuration.
- Each conversation enforces termination controls:
  - max turn count
  - explicit stop condition
- Routed messages are persisted in session state as an ordered transcript.
- Conversation orchestration policy may enforce:
  - turn-taking strategy
  - role memory scope/window
  - role-level tool permissions
  - convergence thresholds
  - parallel branch and merge behavior
  - token/cost budget caps

Deterministic handoff contract:

- `oyakata` routes messages using explicit `OutputRef` metadata.
- `OutputRef` must include at least: `workflowExecutionId`, `workflowId`, `outputNodeId`, `nodeExecId`, and `artifactDir` (`subWorkflowId` is required when the source output belongs to a sub-workflow).
- Downstream consumers resolve input from `OutputRef` instead of implicit "latest output" behavior.
- If an explicit `nodeExecId` is not provided in config, selection policy must be declared (`latest-succeeded`, `latest-any`, or `by-loop-iteration`).

VCS checkpoint contract:

- Each node execution artifact directory additionally writes `handoff.json` and `commit-message.txt`.
- `handoff.json` includes stable `outputRef` and `sha256` hashes for input/output payloads.
- `input.json` includes `upstreamOutputRefs` so downstream input provenance is explicit.
- `commit-message.txt` provides a machine-friendly metadata template for Git/JJ checkpoints.
- Detailed format is defined in `design-docs/specs/design-vcs-handoff-checkpoints.md`.

Mailbox transport contract:

- routed node-to-node delivery uses a file-based mailbox artifact under `{artifact-root}/{workflowId}/executions/{workflowExecutionId}/communications/{communicationId}/`
- each communication has manager-written `inbox/` and `outbox/` directories
- only the manager that owns the recipient scope writes recipient inbox files
- the parent workflow manager may write only to a sub-workflow manager boundary for cross-boundary delivery
- a sub-workflow manager may write only to nodes that belong to that same sub-workflow
- worker nodes never perform direct peer-to-peer delivery
- worker nodes consume manager-resolved `input.json`; they do not poll mailbox directories
- callable child workflows keep their own execution-local mailbox roots; parent/child handoff is a boundary translation, not one shared mailbox tree across workflows
- when a `container` node runs, the container runtime manager/executor exposes a node-local mailbox view at `/mailbox/inbox` and `/mailbox/outbox`; `/mailbox/inbox` is read-only and `/mailbox/outbox` is writable
- those mounts are execution-scoped views, not direct write access to canonical cross-node routing directories
- the root workflow manager owns global `communicationId` allocation within one `workflowExecutionId`
- one communication may have multiple `deliveryAttemptId` retries and optional AI/code-agent `agentSessionId` restarts
- any send re-execution/rerun/resend must allocate a new `communicationId`
- communication delivery retry and communication replay are distinct operations:
  - delivery retry keeps the same `communicationId` and allocates a new `deliveryAttemptId`
  - replay/resend allocates a new `communicationId` and may supersede the prior communication
- when a node declares an output contract, external LLM adapters must receive only the reserved candidate staging path for structured-output submission, not the final publish path
- detailed storage and replay rules are defined in `design-docs/specs/design-node-mailbox.md`
- node output contract and schema-validation publication rules are defined in `design-docs/specs/design-node-output-contract.md`
- external workflow result publication is runtime-owned and must resolve from the latest accepted root-scope `output` node artifact, never from an arbitrary last session response; see `design-docs/specs/design-runtime-owned-external-output-publication.md`

Root data directory contract:

- Oyakata must have one canonical root data directory resolved from env/config
- artifact storage, session storage, attachment storage, and future container-mounted work paths may be derived from that root when more specific overrides are absent
- GraphQL file references must be relative to that root, not host absolute paths
- recommended attachment path layout is `files/{workflowId}/{workflowExecutionId}/attachments/{fileName}`
- this is required so future Podman/container execution can bind-mount the same logical data root without changing GraphQL-visible paths
- `OYAKATA_RUNTIME_ROOT` remains a compatibility alias while `OYAKATA_ROOT_DATA_DIR` becomes the canonical setting
- precedence for each derived path is:
  1. explicit CLI flag
  2. explicit surface-specific environment variable
  3. derived path from `OYAKATA_ROOT_DATA_DIR`
  4. built-in default

Manager control-plane contract:

- manager-to-runtime control messages are distinct from mailbox communications
- mailbox artifacts remain the durable node-to-node transport record
- manager control-plane messages are append-only commands scoped to one manager session and may result in mailbox writes, node starts, retries, or replay requests
- the long-term primary manager interaction path for CLI-backed managers is GraphQL manager-message mutation execution through `oyakata gql`, with payload-embedded `managerControl.actions` retained as compatibility mode
- manager-authored mailbox sends now use discriminated communication payload provenance so manager-message artifacts and node-output artifacts remain replay-compatible under one durable model
- detailed design is defined in `design-docs/specs/design-graphql-manager-control-plane.md`

### Node Model

Execution node payload is externalized in `node-{id}.json`:

- `nodeType`: execution flavor (`agent` by default; `command` for script/process execution; `container` for opaque runner-launched container execution)
- `containerRuntime` workflow defaults: default runner selection for `container` nodes (`podman` by default)
- `executionBackend`: adapter/interface identifier
- `model`: provider or backend-specific model name
- `promptTemplate`: template text
- `variables`: runtime bindings
- optional `command`: workflow-relative script path plus inbox-derived argv/env templates
- optional `container`: runner override plus image/build, entrypoint, args, env, and working-directory config for opaque container execution
- optional `sessionPolicy`: backend session handling policy (`new` by default, `reuse` for node-local backend session continuation)
- optional `durability`: node-level durable storage policy for container workloads
- optional `argumentsTemplate`: structured argument skeleton
- optional `argumentBindings`: deterministic mapping rules from runtime sources to `argumentsTemplate`
- optional `templateEngine`: rendering engine for prompt text (default: `mustache`)

Node input injection policy:

- For skill/tool adapters that accept `ARGUMENTS` only, `oyakata` must pass assembled `arguments` object.
- Complex data composition must be done via `argumentBindings` and source references, not logic-heavy template syntax.
- Keep template engine intentionally simple for prompt text rendering; avoid full Handlebars-style execution semantics in core runtime.
- `command` nodes should prefer explicit argv/env templates over shell string concatenation; inbox-derived values must be passed as direct argv entries rather than through implicit shell parsing.
- `container` nodes are intentionally opaque execution units: Oyakata launches the declared image/build with runtime-provided argv/env, but does not introspect whether the container internally runs an agent, a shell script, or another process model.
- The container runtime manager/executor owns runner dispatch, mailbox bind-mount preparation, and runner-specific process invocation so workflow orchestration code does not branch on individual container CLI details.
- That manager/executor also owns normalized exit handling, timeout/cancellation cleanup, and persistence of `stdout.log` / `stderr.log` in the node artifact directory.
- When `durability.mode = "node-persistent"` is enabled for a container node, that manager/executor also mounts a stable durable directory from `{artifact-root}/{workflow_id}/durable/{node_id}/` into the container, typically at `/durable`.
- This durable storage contract is independent from `sessionPolicy`; it exists so workloads inside the container can persist their own state such as an embedded agent session home across later calls of the same node.
- Container runner choice is modeled separately from the host-side environment. Runner kinds include `podman`, `docker`, `nerdctl`, and `apple-container`; environments such as Colima, OrbStack, and Lima are out of scope for the runner enum.

Node backend session reuse:

- Workflow session persistence and backend session persistence are separate concerns.
- By default, each node execution starts a fresh backend session.
- When `node.sessionPolicy.mode = "reuse"`, the engine may resume an opaque backend-managed session for later executions of the same node within one workflow run.
- Reusable backend session handles are persisted in workflow session state so `session resume` can continue them.
- Detailed request/response shape is defined in [design-node-session-reuse.md](/g/gits/tacogips/oyakata/design-docs/specs/design-node-session-reuse.md).
- Canonical backend/model separation is defined in [design-node-backend-model-separation.md](/g/gits/tacogips/oyakata/design-docs/specs/design-node-backend-model-separation.md).

`workflow.json` contains structural information:

- node set and connectivity
- completion criteria
- branch/loop conditions
- workflow defaults (`maxLoopIterations`, `nodeTimeoutMs`)
- references to node payload files

### Connectivity

Edges define control flow:

- unconditional transitions
- conditional branching (`when` expression)
- loop-back edges for retries/iterations

### Completion Conditions

A node may define explicit completion criteria, such as:

- checklist satisfaction
- score threshold
- validator pass/fail

If completion is omitted, or `completion.type = "none"`, the node is treated as auto-complete after successful execution.
The engine does not advance until completion is met (or auto-complete is accepted) or a terminal failure path is selected.

Sub-workflow execution is complete when its `output` node completes and returns an output payload to the `oyakata` manager node.

### Branching

Branching uses evaluated conditions over:

- node output
- branch-judge node output
- session state

All matching branches should be selected (fan-out).

When a branch path contains multiple internal nodes, the branch body should be entered through a `subWorkflow` boundary rather than by wiring the judge directly to individual leaf nodes. In that pattern, the judge routes to the branch sub-workflow manager node, validation should reject `branch-block` declarations that are not actually entered from a `branch-judge`, and generic root-manager eager-start planning should not auto-start that branch block based only on input-source readiness.

### Looping

Looping is allowed via backward edges and must include safeguards:

- max iteration count per loop
- loop timeout or retry budget
- fallback branch on exhaustion
- loop-judge node based continuation/termination

If loop-local limits are omitted, workflow-level global defaults are applied.

When a loop body contains multiple internal nodes, that body should be declared as a `subWorkflow` with `block.type = "loop-body"` and `block.loopId = loops[].id`. The loop judge remains the control-plane decision point, while the repeated body remains a normal sub-workflow scope. Validation should reject loop-body declarations whose linked loop does not continue back into that sub-workflow manager boundary, and generic root-manager eager-start planning should not auto-start that loop body outside the loop judge's continue path.

### Reference Pattern: Multi-Subgroup Hardening Loop

A representative execution pattern is:

- `oyakata` manager receives user implementation instruction.
- Implementation node produces initial change set.
- `subgroup1` executes anti-pattern review -> counter-opinion -> mediation -> implementation fix -> commit.
- `subgroup2` executes security review -> rebuttal -> mediation -> implementation fix.
- `subgroup3` validates test integrity.
- `subgroup4` closes the round and passes control to loop-judge.
- Loop-judge either:
  - continues from implementation node, or
  - exits when round objective is satisfied.

Recommended bound for this pattern is `maxIterations = 3`.

### Reference Pattern: Adversarial Debate Loop

A second representative execution pattern is:

- `oyakata` manager starts with user instruction.
- `blackhat` node attempts penetration and records findings.
- commit checkpoint is executed.
- `whitehat` node proposes/implements defense.
- commit checkpoint is executed.
- `blackhat` attempts re-penetration against new defenses.
- `mediation` node decides whether unresolved issues remain.
- loop-judge either continues another round or terminates when:
  - major issues are exhausted, or
  - maximum rounds are reached.

This architecture pattern also applies to non-security domains by replacing role semantics (for example challenger/defender/mediator in web app design refinement).

### Timeout

Node execution supports timeout configuration:

- node-level timeout via `node-{id}.json.timeoutMs`
- fallback to `workflow.json.defaults.nodeTimeoutMs`

Timeout events are treated as explicit execution results for downstream routing.

## HTTP/GraphQL Runtime Model (Serve Mode)

`oyakata serve` runs a local web application and GraphQL endpoint for editing/execution.

Primary GraphQL groups:

- workflow definition queries and mutations
- workflow execution queries and mutations
- communication inspection, replay, and retry mutations
- manager-session queries and `sendManagerMessage` mutation

Migration note:

- existing REST endpoints under `/api/*` remain active for browser/editor flows until the corresponding GraphQL workflow-definition/editor surfaces are implemented
- GraphQL is canonical first for execution, communication inspection/replay, and manager control-plane messaging

Design constraints:

- File writes must be atomic (same-directory unique temp file + rename) to avoid JSON corruption and temp-path collisions between concurrent writers.
- Concurrent edits are conflict-protected via revision token or last-write detection.
- GraphQL execution services reuse the same engine as CLI run path.

## TUI Runtime Model

`oyakata tui` runs a local terminal UI application (Bun runtime) for selection and execution.

Core screens:

- Workflow selector: list workflows discovered under `<workflow-root>`
- Execution view: current node, status, loop counters, branch decisions, recent logs
- Input prompt: capture user responses for `human-input` nodes
- Artifact trace: quick view of current execution artifact paths

Design constraints:

- TUI must be non-destructive and keyboard-first.
- TUI must handle terminal resize without losing execution context.
- TUI must degrade to plain prompt mode when interactive terminal capabilities are unavailable.

## UI/Execution Separation

The browser editor is a control surface only:

- UI state and vertical ordering metadata are saved in `workflow-vis.json`.
- Runtime control data remains in `workflow.json` and `node-{id}.json`.
- Execution records remain session artifacts; no runtime state is persisted in visualization file.

## Non-Goals (Current Scope)

- Distributed multi-host scheduling
- Fully generic plugin marketplace

## Related Detail Document

See `design-docs/specs/design-workflow-json.md` for the JSON model design.
See `design-docs/specs/design-data-model.md` for canonical file/runtime data models and human review checklist.
See `design-docs/specs/design-tui.md` for TUI framework selection and interaction design.
See `design-docs/specs/design-autonomous-execution-gap-closure.md` for phase-by-phase correction of spec/implementation gaps toward autonomous execution.
