# Architecture Design

This document describes the current runtime architecture implemented in `src/workflow/` and `src/server/`.

## Overview

`divedra` executes JSON-defined workflows by combining:

- workflow definition loading and validation
- queue-based session orchestration
- mailbox communication artifacts between nodes
- backend adapters for agent execution
- runtime-owned output validation and publication
- manager-scoped control-plane access for manager nodes

The current implementation is centered on the persisted workflow session and its queue. Manager nodes are important, but they do not replace the queue-based engine. The intended architecture is now strict step-addressed execution with no backward-compatibility requirement for node-addressed or structural sub-workflow authoring. Any remaining compatibility path in the repository should be treated as technical debt scheduled for removal, not as an active architectural mode.

Compatibility-removal rule for ongoing refactors:

- no new public surface may introduce or preserve node-addressed aliases when a
  step-addressed field already exists
- new/additive control APIs must target `stepId`, `entryStepId`, and
  `managerStepId` rather than node-addressed aliases such as `nodeId` or
  removed top-level manager fields
- compatibility paths that still exist are removal targets only; they are not
  valid precedent for new runtime or API design

Current direction:

- workflow authoring uses jump-driven routing via runtime-owned output mail instead of dedicated branch/loop primitives
- workflows use `workflow -> steps[] + nodes[]`, where steps are the canonical execution addresses and `workflow.json.nodes[]` is a reusable node registry
- manager nodes should default to a deterministic `code` manager, with `llm` manager retained as experimental
- repeated visits to the same node should materialize distinct mailbox instances and support same-session continuation with prompt variants
- new workflow starts should be supervisor-backed by default at the CLI, GraphQL, and library entrypoint layer. The default supervisor is deterministic in-process runner-pool mode: it represents supervision as a workflow boundary, but the runtime service that owns lifecycle control starts, tracks, cancels, resumes, and reruns target workflows asynchronously in the same process. The supervisor command surface is the default lifecycle boundary for event sources and operators; `runWorkflow()` remains the low-level engine primitive used by the runner pool, tests, and specialized embedding.
- `auto improve mode` persists incidents, remediations, and mutable-workspace audit data on the target session; phase 2 optionally runs a paired `divedra superviser` workflow (`nestedSuperviserDriver` / `--nested-superviser`) using the same audit model

The authoritative implementation for those behaviors lives in:

- `src/workflow/engine.ts`
- `src/workflow/call-step.ts`
- `src/workflow/superviser.ts`
- `src/workflow/superviser-control.ts` (phase-2 `SuperviserRuntimeControl` and add-on argument validation)
- `src/workflow/node-addons.ts` (native `divedra/*` supervision add-ons)
- `src/workflow/types.ts` (shared step-addressed runtime identifiers, including phase-2 superviser-control add-on names)
- `src/workflow/validate.ts`

### Default Supervisor-Backed Starts

Workflow start surfaces should prefer deterministic supervised execution without
requiring an operator to remember `--auto-improve`. The start boundary is:

- CLI `workflow run <name>` starts under deterministic in-process runner-pool
  supervision.
- CLI `workflow run <name> --endpoint ... --no-auto-improve` must forward an
  enabled lifecycle-only supervision policy with `maxWorkflowPatches: 0`,
  because `--no-auto-improve` disables patching, not supervision.
- GraphQL `executeWorkflow` synthesizes the same deterministic supervisor policy
  when `autoImprove` is omitted; callers can pass
  `autoImprove: { enabled: false }` for lifecycle-only supervision.
- Library `executeWorkflow()` uses the same default and exposes
  `disableAutoImprove` to disable workflow patching while preserving lifecycle
  supervision.
- Resume, rerun, continuation, direct `call-step`, and low-level
  `runWorkflow()` do not silently add supervision because those paths may target
  old unsupervised sessions, imported history, or isolated test fixtures.

Implementation boundaries for this default are strict:

- helper entrypoints that accept a `defaultAutoImprove` behavior toggle must
  apply it when no explicit `autoImprove` or `disableAutoImprove` option was
  supplied; ignoring the toggle is a contract violation because it silently
  reverts the default local path to unsupervised execution.
- CLI local execution, CLI endpoint execution, GraphQL `executeWorkflow`, and
  library `executeWorkflow()` must make the same default/lifecycle-only decision
  before invoking the engine or transport. Endpoint-backed CLI calls must
  serialize `--no-auto-improve` as an enabled policy with `maxWorkflowPatches: 0`.
- nested supervisor execution is valid only when the effective policy is
  supervised. Because lifecycle-only mode is still supervised, nested supervisor
  flags remain compatible with `--no-auto-improve` and `disableAutoImprove`.

This keeps the user-facing execution model supervisor-first while avoiding a
second lifecycle implementation. The default policy records
`divedra-default-workflow-supervisor` as the supervisor workflow name and uses a
deterministic runner-pool service for lifecycle control. Explicit LLM-backed
supervisor decisions remain opt-in through `intentMapping.mode = "llm-command"`
or an explicit nested supervisor mode; auto-improve patching remains opt-in and
must not be implied by ordinary deterministic lifecycle supervision.

The runner pool executes target workflow runs in-process and asynchronously. It
retains active run handles by runner-pool run id, workflow execution id,
supervised run id, optional operator alias or managed workflow key, and
event-source correlation key. Command arguments are assembled from structured
command objects, never from raw event text. Event text first passes through the
deterministic command parser: split on spaces/tabs, match the first token
against configured command strings, and preserve remaining tokens as arguments.
Text without a known first-token command routes to a command-analysis LLM node
that returns a typed command proposal; the supervisor itself remains
deterministic and validates the proposal before applying it.

Runner-pool handle storage must distinguish mutating async commands from
inspection commands. A dispatch that produces a real async task may create or
replace the active handle indexes for that supervised run. A status, progress,
inbox, logs, export, or other inspection dispatch that does not invoke
`onAsyncRun` must not overwrite an existing live handle with a non-async view.
This preserves later wait, cancel, and resume semantics for the original active
run while still allowing inspection commands to return fresh persisted state.

Current compatibility-removal sequence (see
`impl-plans/workflow-legacy-compatibility-removal.md`):

- rerun, resume, and direct-control entrypoints should accept authored `stepId`
  targets only
- workflow validation/load/save reject legacy **authored** fields outright
- normalized `WorkflowJson` no longer synthesizes compatibility companions such
  as removed top-level manager aliases, structural `subWorkflows`, `edges`, or
  repeat-driven `loops`
- cross-workflow dispatch is derived only from `steps[].transitions` with
  `toWorkflowId` / `resumeStepId` (deterministic ids `__cw:*` via
  `cross-workflow-from-steps.ts`); validation **rejects** authored top-level
  `workflow.workflowCalls` on every bundle kind, so the runtime does not execute
  merged explicit call records
- derived cross-workflow dispatch rows, readiness attribution, and new
  `workflow-calls/*.json` artifact metadata should use caller/resume **step**
  ids as the canonical addresses; node-registry ids may remain only in explicitly
  scoped compatibility payloads such as `runtimeVariables.workflowCall`, and
  new artifacts should not emit redundant plain `workflowId` mirrors alongside
  caller/callee-named fields
- workflow inspection and runtime-readiness surfaces should expose execution
  sources as `stepId`-named fields (`sourceStepIds`) rather than node-named
  aliases, because the normalized runtime scheduler is step-addressed
- runtime-readiness filtering for direct-step execution and inspection should
  also be keyed by executing **step** ids so reusable node-registry entries can
  back multiple authored steps without reintroducing node-addressed selection
  assumptions
- phase-2 superviser-control add-on identifiers are part of the runtime control
  surface and should stay centralized; duplicating the same `divedra/*`
  catalog across validation, add-on resolution, and native execution is
  implementation drift, not intended architecture
- node ids remain reusable payload registry identifiers, not execution
  addresses

## Core Architectural Boundaries

### Workflow Definition Boundary

Workflow definitions live under `<workflow-definition-dir>/<workflow-name>/` and are composed from:

- `workflow.json`
- optional `steps/step-*.json` files when steps are file-backed
- referenced node payload JSON files
  - default location: `nodes/node-{id}.json`
  - authors may also place payloads in workflow-relative nested paths such as `workflows/<lane>/nodes/node-{id}.json`
- optional prompt files referenced by `systemPromptTemplateFile`, `promptTemplateFile`, and `sessionStartPromptTemplateFile`

The loader resolves those workflow-local prompt files into effective inline template text before validation and execution.

Authored workflow boundary rules are centralized in `src/workflow/authored-workflow.ts`:

- removed top-level authored fields, their rejection messages, and canonical validation issue construction live there
- save-time persistence strips only normalized-only workflow fields from in-memory `WorkflowJson` inputs before validation and write
- `src/workflow/load.ts`, `src/workflow/validate.ts`, and `src/workflow/save.ts` should reuse that module rather than carrying separate copies of authored-schema guard logic

Workflow roots can be resolved directly or through the scoped workflow catalog.
The scoped model defines:

- project scope root: nearest project `.divedra`
- user scope root: `~/.divedra` by default
- workflow root: `<scope-root>/workflows`
- add-on root: `<scope-root>/addons`
- runtime data root: `<scope-root>/artifacts`
- log root: `<scope-root>/logs`

Project scope is searched before user scope for bare workflow names, while
`--workflow-definition-dir` and `DIVEDRA_WORKFLOW_DEFINITION_DIR` remain direct workflow-definition-dir
overrides for examples and automation. Scope resolution is implemented in
`src/workflow/catalog.ts`.

### Runtime State Boundary

The runtime persists three distinct forms of state:

- workflow session state in `{rootDataDir}/sessions/`
- node and communication artifacts in `{rootDataDir}/workflow/`
- query-oriented runtime index data in `{rootDataDir}/divedra.db`

In project-scoped catalog mode, `{rootDataDir}` defaults to
`<user-root>/projects/<project-basename>-<project-root-hash>/artifacts`.
In user-scoped catalog mode, `{rootDataDir}` defaults to `<user-root>/artifacts`.
For direct workflow-definition-dir and other non-scoped runtime entrypoints, the default
`{rootDataDir}` is `<user-root>/artifacts`.

File artifacts remain the authoritative source for execution payloads. SQLite is a best-effort index for CLI and GraphQL inspection queries.

When CLI, API, library, or catalog-aware runtime entrypoints receive explicit
artifact and/or session-store roots, they infer `rootDataDir` from those
explicit storage roots when possible so `divedra.db` stays co-located with the
selected runtime tree instead of drifting to an ambient default. An explicit
`DIVEDRA_ARTIFACT_DIR` remains the canonical root data directory override and is
not replaced by scoped defaults.

### LLM Session Message Inspection Boundary

GraphQL workflow inspection should distinguish runtime logs from backend LLM
session messages. Runtime logs describe divedra-owned execution milestones,
process output summaries, and hook metadata. LLM session messages are
provider-originated records emitted while an agent backend is executing a node.

The runtime should persist a normalized, provider-neutral message index in the
runtime SQLite database, keyed by workflow execution id and node execution id.
The record should preserve ordering, backend session id when available, provider
event type, optional role, optional text content, and a raw JSON snapshot for
debugging. This index is best-effort like other runtime DB views: canonical node
artifacts and session state must remain valid even if message indexing fails.

GraphQL should expose these records as inspection-only data on workflow
execution and node execution views. This avoids overloading `nodeLogs` with LLM
conversation content and keeps `hookEvents.transcriptPath` as metadata rather
than an arbitrary file-read API.

The `llmMessages` field on `WorkflowExecutionView`,
`WorkflowExecutionOverviewView`, and `NodeExecutionView` should support bounded
selection at the field boundary. With no arguments, each field returns the
latest one persisted message. The `order` argument is a GraphQL enum with
`ASC` and `DESC` values and defaults to `DESC`; it is not a free-form string in
the public GraphQL schema. The `limit` argument is configurable per field
selection. Resolver internals may retain full persisted message arrays while
applying the requested order and limit only at the GraphQL field resolver layer,
so one query can request different message windows for workflow-level and
node-level views.

### Session Health Inspection Boundary

`session health <session-id>` should assemble an operator-facing health snapshot
from persisted session state, runtime DB summaries, bounded recent runtime and
process logs, active-node metadata, artifact/candidate timestamps, and optional
recent LLM session messages. It is an observational diagnostic surface: it does
not mutate session state, create auto-improve incidents, rerun steps, or patch
workflow definitions.

The health surface must keep uncertainty explicit. Persisted state can prove
terminality and recent progress evidence, but it cannot always prove that a
backend process is currently alive. The optional `--live` probe can add
adapter-supported local liveness evidence, but when live process state is not
available through a supported check, health output reports an unknown or
not-proven live signal instead of inferring liveness from stale or fresh
timestamps alone.

Supporting design:

- `design-docs/specs/design-session-health.md`

### Human Workflow Overview Boundary

Non-TUI human workflow inspection should use an overview-only surface layered on
top of the scoped workflow catalog and execution-summary data.

Rules:

- humans see workflow list and selected-workflow status only
- browser mode under `serve` defaults to the same overview model
- AI and advanced tooling use GraphQL detail queries for node, communication,
  hook-event, and log inspection
- duplicate workflow names from different scopes remain distinct in human list
  surfaces
- the operator-facing status view is workflow-level aggregate state, not a dump
  of raw runtime artifacts
- direct workflow-definition-dir mode is labeled as source scope `direct`; scoped catalog
  mode uses `project` and `user`
- aggregate workflow status reuses runtime statuses and adds only `never-run`
  for workflows without executions
- active execution count is derived from non-terminal `running` and `paused`
  executions

Supporting design:

- `design-docs/specs/design-workflow-overview-status-surface.md`

### Execution Boundary

The main runtime entrypoint is `runWorkflow()` in `src/workflow/engine.ts`.

It owns:

- session creation, resume, and rerun
- queue progression
- bounded fanout work-item scheduling and join aggregation for step-addressed
  fanout transitions, with cross-workflow fanout supported and parent-session
  local fanout tracked as the remaining inline execution gap
- timeout and stuck-restart handling
- output-contract validation and retry
- communication publication and consumption
- step jump resolution and timeout-policy routing
- manager-control validation
- final workflow-output publication

It must not print normal execution progress directly. Local progress visibility
is expressed through `WorkflowRunEvent` records delivered to an optional
`WorkflowRunEventSink`; the default sink is a no-op. CLI verbose mode wires that
sink to the supervisor progress renderer, which owns stderr formatting and keeps
JSON stdout clean. The legacy `onProgress` callback is reserved for explicit
debug consumers and only fires when debug mode is enabled.

Planned extension:

- history-linked continuation from one concrete prior step run into a new
  workflow execution; see `design-docs/specs/design-step-run-history-rerun.md`
- continued runs keep `session.nodeExecutions`, `session.communications`,
  backend-session handles, and other mutable execution state local to the owning
  run; imported provenance is exposed through dedicated merged-history readers
  instead of mutating the meaning of existing local session fields
- runtime helpers that currently scan only local `session.nodeExecutions` or
  `session.communications` for upstream resolution or published workflow output
  must be reviewed explicitly during continuation work; the current hotspots are
  in `buildUpstreamOutputRefs()`, `buildUpstreamInputs()`,
  `findLatestPublishedWorkflowResult()`, and
  `findLatestWorkflowCallResultExecution()` in `src/workflow/engine.ts`

Execution-time working directory is resolved separately from workflow/artifact/session root resolution.

- default workflow execution working directory: command invocation `cwd`
- run-scoped override: explicit execution input working directory
- node-scoped override: `nodePayload.workingDirectory`, resolved from the effective workflow execution working directory

Working-directory resolution is implemented in
`src/workflow/working-directory.ts`.

### Bounded Fanout And Join Boundary

Source:

- `src/workflow/engine.ts`
- `src/workflow/cross-workflow-from-steps.ts`
- `src/workflow/types.ts`
- `src/workflow/validate.ts`

Target design:

- `design-docs/specs/design-bounded-fanout-join-workflow-execution.md`

Bounded fanout/join is a step-addressed workflow-engine capability. It lets a
completed source step create a persisted fanout group from an output payload
array, run branch work items with an effective concurrency such as `20`, and
queue a join step only after all required branch results complete.

Two target modes share the same authored `WorkflowStepTransition.fanout` model.
Cross-workflow fanout targets `toWorkflowId` and runs bounded callee workflow
executions before resuming the caller at `fanout.joinStepId`. Local inline
fanout targets only `toStepId`; its required behavior is to run every branch as
a distinct work item inside the parent workflow session, not as a child workflow
and not as a plain queue entry that could dedupe repeated target-step runs.

The fanout scheduler must not treat queue entries as bare step ids internally
when a fanout branch is active. Branch work needs distinct work-item identity
(`fanoutGroupRunId`, `branchIndex`, source step run, target step/workflow) so
the same target step can execute concurrently for multiple source items without
being collapsed by existing queue dedupe. Non-fanout workflows keep the current
single-step queue behavior.

Session mutation remains engine-owned and single-writer. Concurrent branch
promises report completion events back to the scheduler, and the scheduler
serializes updates to counters, communications, transitions, fanout group state,
runtime DB rows, and `saveSession()` writes. This keeps artifact paths,
communication ids, node execution ids, and aggregate join ordering
deterministic under concurrency.

Shared-worktree mutation is a separate safety boundary. Read-only analysis and
planning branches may share the parent worktree, but code-writing fanout branches
must either declare disjoint owned paths or run in branch-local isolated
workspaces such as child workflow worktrees. Fanout group state records branch
workspace roots when they differ from the parent workspace so retry, review,
status, and cleanup surfaces can explain where branch work happened.
When an isolated branch is retried with a replacement workspace, the new branch
record also keeps the superseded workspace root for lineage and cleanup.

Cursor-specific behavior is not part of the fanout scheduler. Cursor or Codex
process behavior remains behind ordinary agent adapter modules; fanout branches
execute the same backend-neutral node payload contract as every other step.

### Auto-Improve Supervision Boundary

Source:

- `src/workflow/engine.ts`
- `src/workflow/superviser.ts`
- `src/workflow/superviser-control.ts`
- `src/workflow/node-addons.ts`
- `src/workflow/mutable-workspace.ts`
- `src/workflow/auto-improve-policy.ts`

Current phase-1 responsibilities:

- normalize and validate `autoImprove` policy input before execution
- seed and persist supervision state on the target session
- detect terminal failure and stalled progress from persisted runtime state
- choose deterministic remediations (`rerun-workflow`, `rerun-step`, `patch-workflow`, `stop-supervision`)
- create execution-copy mutable workflow workspaces and patch audit records

**Phase 2 (optional)** is implemented as an opt-in path: with `WorkflowRunOptions.nestedSuperviserDriver` (CLI `--nested-superviser` plus `--auto-improve`), the engine runs `superviserWorkflowId` as a nested step-addressed workflow and passes a runtime `SuperviserRuntimeControl` handle to native `divedra/*` add-ons for start/status/rerun/load/save on the paired target session. Without that flag, the engine still uses the phase-1 outer `runAutoImproveLoop`. Supervision state records `nestedSuperviserSessionId` when the nested path is used; it is exposed in library/GraphQL inspection. Target-session resume with the nested flag continues the saved nested superviser session when that id is present.

### Repository Lint Policy Boundary

Repository code quality checks use Biome as the primary lint entrypoint. Local
development, task automation, and CI-oriented commands must keep the same
effective Biome lint path so repository policies cannot be bypassed by choosing
`bun run lint:biome`, `bun run lint`, `task lint`, or `task ci`.

The TypeScript source filename policy rejects numbered split-file names of the
form `part-<digits>.ts` and `part-<digits>.tsx` in the same source path scope
covered by the current Biome includes. Examples of forbidden source basenames
include `part-1.ts`, `part-01.ts`, `part-1.tsx`, and `part-01.tsx`.
Descriptive split names such as `workflow-loader.ts`,
`node-output-contract.ts`, or `session-partition.ts` remain valid because the
policy targets only a full path segment basename matching `part-<digits>`.

Biome configuration should remain the preferred home for this policy when the
installed Biome version can express an exact filename/path rule without changing
the repository's existing include set or diagnostic behavior. For Biome 2.3.15,
the local CLI/config surface does not expose a safe native rule for rejecting
arbitrary path basenames, so the design fallback is a small repository-owned
check invoked as part of the Biome lint entrypoint. The fallback check must:

- inspect only the repository source paths already covered by Biome includes
- match path basenames exactly rather than scanning arbitrary path substrings
- report every forbidden file path and exit non-zero when any are found
- avoid requiring committed forbidden fixture files; tests should create
  temporary fixture trees or exercise a pure path-matching helper
- be wired through all existing Biome lint entrypoints instead of creating a
  separate optional command that developers can skip accidentally

This rule is a repository naming policy, not an agent-adapter behavior. It has
no Codex-agent or Cursor-specific runtime mapping; any implementation should
stay in repository lint scripts/tests rather than in backend adapter modules.

## Primary Components

### Workflow Loader and Validator

Source:

- `src/workflow/load.ts`
- `src/workflow/validate.ts`

Responsibilities:

- read workflow bundle files
- resolve `promptTemplateFile`
- validate step definitions, node registry entries, transitions, and payload shapes
- share authored-schema guard rules with the save path through `src/workflow/authored-workflow.ts` so validation and persistence reject the same removed fields with the same messages

Important validation facts:

- worker-only workflows are valid when `entryStepId` is explicit
- `managerStepId`, when present, must resolve to an authored step
- every step must resolve `nodeId` through the explicit node registry in `workflow.json.nodes[]`
- node payloads distinguish `executionBackend` from `model`; model names are not used as backend selectors in newly authored workflow bundles
- step-addressed bundles reject dedicated legacy graph-control fields such as `edges`, `loops`, `branching`, and structural sub-workflow metadata
- cross-scope routing must still target the owning manager boundary

### Node Add-on Catalog

Workflow node references may use built-in add-ons as an authoring shortcut for
runtime-provided worker behavior. Add-ons are resolved by the loader into
effective node payloads before execution, while save/edit surfaces preserve the
authored add-on reference.

Initial scope:

- runtime-provided `divedra/*` add-ons
- scoped local add-on manifests under `<scope-root>/addons`, where project and
  user scopes use the same add-on directory layout as workflow scopes
- third-party add-on references through host-provided resolver functions; these
  are local process integrations and do not perform package or network
  resolution during workflow load
- no network resolution at workflow load time
- `divedra/chat-reply-worker` for provider-neutral event replies
- `divedra/codex-worker` and `divedra/claude-code-worker` for reusable
  agent-backed worker nodes
- `divedra/x-gateway-read` for read-only x-gateway GraphQL inspection through
  an explicit container runner binding
- `divedra/x-gateway` for intentional x-gateway GraphQL query or mutation
  execution, including X post mutations, through the same explicit container
  runner and environment binding model
- `divedra/mail-gateway-read` and `divedra/mail-gateway` for read-only mail
  inspection and intentional mail send mutations through the same explicit
  container runner and environment binding model
- add-on nodes remain ordinary worker nodes after resolution
- `divedra/` is reserved for runtime-provided add-ons; third-party add-ons use
  non-`divedra/` names such as `vendor/name`

The chat reply worker creates provider-neutral reply requests from
`runtimeVariables.event` and dispatches them through the event reply adapter
registry. Provider SDKs and credentials remain in the event layer, not in the
workflow engine. Add-ons that need invocation-specific values use
`addon.inputs`, and only descriptors that explicitly consume environment
bindings accept `addon.env`. Host applications can pass add-on resolvers through
workflow load, validation, save, and execution options to materialize
third-party add-on references into ordinary node payloads. The package root
exports the library API from `src/lib.ts` rather than the CLI entrypoint so
third-party add-on packages can type resolver exports from `divedra` without
deep imports.

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
- render workflow-level manager and worker prompt templates when authored
- choose the default manager system prompt by the active step-based execution model so manager guidance reflects current-workflow state and any supported cross-workflow invocation contract
- prepend node-authored session-start prompts only when a backend session is first created
- inject workflow and cross-workflow structure summaries when applicable
- keep manager mailbox/control guidance aligned with the active execution model so role-authored workflows advertise current-workflow retry/replay/optional-step actions

The runtime distinguishes:

- node `kind`: structural role
- node `nodeType`: execution flavor

That separation is still fundamental to the current runtime design, even though authored workflow design is moving toward `role` plus `control` rather than structural `kind`.

Node payloads may also separate stable role instructions from per-turn prompts
through `systemPromptTemplate*` and `sessionStartPromptTemplate*`, which lets
reused backend sessions keep a stable system prompt while applying first-turn
wrappers only when a session is first created.

### Adapter Layer

Source:

- `src/workflow/adapter.ts`
- `src/workflow/adapters/*`

Responsibilities:

- execute agent nodes against concrete backends
- propagate backend session reuse when `sessionPolicy.mode = "reuse"`
- enforce runtime timeout boundaries through adapter cancellation
- normalize common LLM response wrappers before the runtime validates candidate
  output payloads

Current implementation status:

- `agent` nodes execute
- `command` and `container` nodes execute through the native node executor

Adapter output parsing is a runtime-owned tolerance boundary, not a workflow
prompt requirement. `parseJsonObjectCandidate()` accepts only JSON objects as
candidate payloads, but it may recover an object from common structured-output
wrappers before validation:

- an exact JSON object
- a fenced JSON object, including when the fence is surrounded by prose
- the first balanced JSON object embedded in prose

The parser must still reject non-object JSON such as arrays, strings, numbers,
or partial/unbalanced object text. Backend-specific output collection remains in
`src/workflow/adapters/*`; wrapper recovery stays in the shared adapter module
so `codex-agent`, `claude-code-agent`, and SDK-backed adapters converge before
engine-level schema, completion, and manager-control validation.

For nodes with `output` configured, output-contract normalization also accepts a
valid adapter envelope from inline adapter payloads or reserved candidate files:
`when` is the transition predicate map, `payload` is the business object to
schema-validate and publish, and optional `completionPassed` overrides the
completion flag. Invalid envelope fields are validation failures. This keeps
review workers that return `when.needs_revision` from being misread as ordinary
business payloads and incorrectly routed through `!(needs_revision)`.

### Session and Communication Model

Source:

- `src/workflow/session.ts`
- `src/workflow/session-store.ts`
- `src/workflow/runtime-db.ts`

Responsibilities:

- persist queue and step/node execution history
- track step visits, restart counts, and transition decisions
- record mailbox communications and conversation turns
- expose stable session identity for CLI, TUI, GraphQL, and library consumers

The queue is deduplicated after each scheduling pass. Multiple valid transition deliveries may still target more than one next execution site, but duplicate queue entries for the same pending execution are collapsed in the queue view.

### Cross-Workflow Dispatch and Legacy Compatibility

Source:

- `src/workflow/cross-workflow-from-steps.ts` (projection of step transitions to dispatch rows)
- `src/workflow/engine.ts` (enqueue and run callee workflows; artifacts under `workflow-calls/`)
- `src/workflow/runtime-readiness.ts` (readiness checks for callee targets and dispatch chains)
- `src/workflow/manager-control.ts` (validates manager-emitted control actions)

Responsibilities:

- treat cross-workflow handoff as a normal step completion side effect: after a caller registry node succeeds, matching step-derived dispatches run against the configured workflow root
- expose callee input through runtime `workflowCall` variables (stable template key; name is historical) and deliver optional results through runtime-owned communications (`workflow-call:<dispatch-id>` prefix is historical)
- keep historical compatibility-era concepts isolated from the primary step-addressed authoring surface; new work should not reintroduce authored `workflow.edges`, `workflow.loops`, or similar node-addressed control fields
- allow validated manager override actions (`manager-control.ts` scope checks)
- reject structural manager-control actions such as `start-sub-workflow` / `deliver-to-child-input`
- when a step-derived cross-workflow transition is also a fanout transition,
  dispatch one isolated callee workflow run per fanout item through the bounded
  fanout scheduler and deliver a deterministic aggregate result to the caller's
  join step

Current behavior:

- cross-workflow invocation targets the callee workflow's callable entry step (`managerStepId` when present, otherwise `entryStepId`); there is no supported authored top-level `workflow.workflowCalls` array
- matching dispatches run after their caller step's node execution succeeds, in deterministic step order
- manager output payloads may include `managerControl.actions`; the runtime validates control scope before honoring those actions

Fanout extension:

- ordinary cross-workflow dispatches may keep deterministic sequential execution
  when no `fanout` is authored
- fanout cross-workflow dispatches resolve branch items from the source output
  payload, run callees with bounded concurrency, preserve the existing
  cross-workflow recursion guard per branch, and persist `fanoutGroupRunId` plus
  `branchIndex` in dispatch artifacts
- for cross-workflow fanout, authored `resumeStepId` remains required and must
  match `fanout.joinStepId`, because the join step is always in the caller
  workflow

### Server and GraphQL Control Plane

Source:

- `src/server/*`
- `src/graphql/*`

Responsibilities:

- expose `/graphql` for workflow-definition and execution/session control flows
- expose `/healthz` for liveness checks
- keep manager auth/session scope on the HTTP transport boundary

Serve-mode behavior:

- `divedra serve` runs the local HTTP control plane
- an optional fixed workflow name constrains GraphQL workflow-definition access to that authored bundle
- `readOnly` is enforced for write mutations
- legacy workflow/session REST routes remain removed

Manager scope rules:

- manager auth is established from request transport metadata
- HTTP server ambient environment is not trusted as manager scope
- manager sessions are minted per real manager-step execution

## Event Listener Workflow Triggers

External events are modeled as a separate trigger layer that invokes the
existing workflow execution boundary. Provider-specific cron, webhook, chat, and
UI adapters normalize incoming events into a canonical envelope, map that
envelope into workflow runtime input, persist an event receipt for idempotency,
and then dispatch through the event trigger runner (direct execution via
`createWorkflowExecutionClient()` / GraphQL `executeWorkflow`, or supervised
routing when the binding opts into lifecycle control; same pipeline powers library
`dispatchSupervisorChat` and webhook ingestion).

The workflow engine should not import provider SDKs or provider-specific event
types. Event bindings live outside workflow bundles so adding or changing an
event source does not mutate `workflow.json`. The current implementation lives
under `src/events/`.

Target architectural direction: event bindings should be understood as bridges
between provider transports and the runtime-owned `external-mailbox` boundary,
not as the only place where workflow execution semantics are defined. External
input and output mailbox surfaces exist independently of any attached event
source; adapters normalize inbound provider events into external mailbox input
and deliver provider-neutral external mailbox output back to the provider. The
detailed design for that direction is
`design-docs/specs/design-event-external-mailbox-binding.md`.

Event bindings that need ongoing lifecycle control should use the supervised
event control path rather than direct target execution. In that path, the event
listener maps an event to a structured supervisor command and routes it to the
runtime supervisor control service (library or remote GraphQL), which owns
supervised-run records and target workflow start, stop, restart, status, and
restart-budget policy for that correlation key. A packaged authored supervisor
workflow is optional and layers on the same public contract in a later phase.
The detailed design is `design-docs/specs/design-event-supervisor-control.md`.

Chat-facing dispatch where one supervisor must decide among multiple workflows
uses a supervisor conversation backed by a supervisor profile. The profile
names the supervisor workflow and the allow-list of workflows it may start,
stop, switch, inspect, or receive input for. The supervisor's dispatcher step
may be an LLM manager node, but its output is only a structured proposal;
runtime profile validation enforces all privileged lifecycle actions. The
detailed design is
`design-docs/specs/design-workflow-supervisor-dispatcher.md`.

## Runtime Node Roles

Current authored direction:

- `steps[]` are the executable addresses
- steps may be manager or worker execution sites
- reusable node definitions live in `workflow.json.nodes[]` and backing `nodes/node-*.json` files
- `entryStepId` is always explicit

Execution policies:

- `user-action` is implemented as a `nodeType`, not as a new manager boundary, so human approval/input remains a runtime-owned execution flavor rather than a second structural control-flow system
- optional step execution is implemented as scheduler policy on authored steps
- node add-ons are an authoring reuse layer, not a third role axis; after
  resolution, an add-on node executes as a normal worker with descriptor
  provenance recorded in runtime metadata
- this behavior is implemented across `src/workflow/engine.ts`,
  `src/workflow/types.ts`, and `src/events/`

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
        E->>C: publish transition and manager-planned communications
        E->>S: persist updated queue and session state
    end

    E->>C: publish final root-scope output to external mailbox
    E->>S: mark session completed
```

## Mailbox Architecture

The runtime communicates between steps/nodes through persisted communication artifacts, not only in-memory transitions.

Each communication records:

- source step id, source node id, and node execution id
- destination step id and destination node id when the route stays inside the workflow
- routing scope
- payload reference
- delivery kind
- lifecycle timestamps

Routing scopes:

- `external-mailbox`
- `intra-workflow`
- `cross-workflow`

Delivery kinds:

- `step-transition`
- `step-revisit`
- `manual-rerun`
- `conversation-turn`
- `external-input`
- `external-output`

This mailbox layer is the architectural boundary that lets one workflow execution, cross-workflow invocation, and external callers use the same handoff model.

Planned continuation extension:

- a new workflow execution may import a prefix of one prior workflow
  execution's step-run history by reference, anchored by a concrete
  `stepRunId`/`nodeExecId` plus execution ordinal, rather than by step id
  alone; see `design-docs/specs/design-step-run-history-rerun.md`

Worker nodes do not consume that canonical transport layout directly.
Before each node execution, the runtime compiles a worker-facing execution
inbox/outbox contract under the node artifact directory. That contract is the
stable node-facing ABI across `agent`, `command`, `container`, and `addon`
execution. The current implementation is centered on
`src/workflow/node-execution-mailbox.ts`.

## Output Ownership

The runtime, not the adapter, owns final publication.

That means:

- adapters may propose a candidate payload
- the runtime validates it
- the runtime writes canonical `output.json`
- the runtime publishes downstream mailbox artifacts only after acceptance
- external workflow publication selects the latest accepted root-scope `output`
  node artifact in the current workflow execution rather than any arbitrary
  "last response"

Workers may target execution-local outbox paths such as
`mailbox/outbox/output.json`, but those paths are staging surfaces only. They do
not grant authority over canonical mailbox publication.

This is especially important for nodes that declare `output.jsonSchema`.

The runtime also persists handoff-oriented audit helpers alongside accepted node
artifacts, including `handoff.json` metadata and `commit-message.txt` operator
templates used for Git/Jujutsu checkpoint workflows.

## Control-Flow Semantics

### Routing

- outgoing step transitions define the legal jump graph
- worker output may include a validated `next.stepId` request
- the manager validates requested jumps against the current step transitions

### Completion

The engine checks workflow completion after successful execution and output publication.
In the step-addressed model, terminality comes from explicit manager decisions or the absence of a valid next step, not from a separate authored `CompletionRule`.

## Manager Control Architecture

Manager nodes may return `payload.managerControl.actions`.

The runtime treats `payload.managerControl: null` the same as an absent
`managerControl` field. Nullable output from an LLM or structured-output wrapper
therefore means "no manager control action requested" and must not fail an
otherwise valid manager response. Non-null `managerControl` values must remain
objects, and `managerControl.actions`, when present, must remain an array that
passes the same scope and action validation rules.

**Target** step-addressed naming (see `impl-plans/workflow-legacy-compatibility-removal.md`) is:

- `planner-note`
- `retry-step` (replacing node-id-oriented `retry-node`)
- `replay-communication`
- `execute-optional-step` / `skip-optional-step` (replacing `execute-optional-node` / `skip-optional-node`)
- no structural child-workflow actions

**Current** implementation in `src/workflow/manager-control.ts` accepts `planner-note`, `retry-step`, `replay-communication`, `execute-optional-step`, and `skip-optional-step` (retry/optional actions use `stepId`). Removal-bound aliases `retry-node` / `execute-optional-node` / `skip-optional-node` are **rejected** (no `nodeId` field on these actions). Structural compatibility actions `start-sub-workflow` and `deliver-to-child-input` are **rejected**. Remaining follow-up work in `impl-plans/workflow-legacy-compatibility-removal.md` is now mostly naming/doc cleanup rather than live authored compatibility logic. Cross-workflow dispatch is step-derived only; the engine does not execute authored top-level `workflow.workflowCalls`.

Scope enforcement:

- managers operate only within their allowed workflow scope
- retries must stay within the manager's allowed scope
- communication replay must stay within the manager's allowed scope
- optional-step decisions must stay within the manager's allowed scope

Manager sessions are minted per manager-step execution and expire when that execution finishes.

## Current Limitations

- the main runtime remains queue-based; the local `call-step` path is not the whole orchestration model
- runtime/tooling cleanup is still needed in older internal documents that describe removed branch/loop or structural sub-workflow authoring
- some supporting materials still assume node-centric naming even though authored execution is step-addressed

## References

- `README.md`
- `src/workflow/`
- `src/events/`
- `src/graphql/`
- `src/server/`
- `design-docs/specs/design-workflow-supervisor-dispatcher.md`
