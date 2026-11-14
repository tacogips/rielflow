# Design Notes

This document captures additional design notes for cooperative multi-agent orchestration.

## Overview

The project uses workflow-driven coordination where agent behavior is explicit and auditable.

## Notable Decisions

### Primary Agent Providers

Initial design scope includes exactly two CLI execution backends:

- `codex-agent`
- `claude-code-agent`

### Prompt Decomposition

Prompt payloads are separated into:

- `promptTemplate`: reusable template
- `variables`: runtime-resolved data
- optional workflow/node system layers: workflow-level manager/worker prompt
  templates plus node-level `systemPromptTemplate*` and
  `sessionStartPromptTemplate*`

This enables deterministic replay and easier session debugging.

Additional input assembly policy:

- Keep prompt rendering simple (`mustache`-style substitution).
- Build complex runtime payloads as structured `arguments` via explicit bindings.
- Avoid logic-heavy template engines (for example full Handlebars helper flow) in core runtime paths.

### Workflow File Split

Workflow data is intentionally split:

- `workflow.json`: workflow metadata plus the reusable node registry and step registry
- `steps/step-{id}.json`: executable step addresses, routing, and step-local overrides when file-backed
- `node-{id}.json`: reusable runtime payload (`executionBackend`, `model`, `promptTemplate`, `variables`)

This keeps derived visualization state out of separate authored files.

### Deterministic Control Flow

Workflow JSON must make control flow explicit through:

- step-local `transitions[]`
- runtime-owned output mail status
- optional validated `next.stepId` jump requests

Dedicated branch/loop authoring is removed in favor of jump-driven routing.

### Confirmed Runtime Policies

- Routing behavior: step transitions declare the legal jump graph, and worker-requested `next.stepId` remains subject to manager/runtime validation.
- Completion: auto-complete nodes are allowed; success-judgment-free nodes can be configured.
- Timeout: each step invocation may use per-invocation, step-local, node-local, or workflow-level timeout defaults in that precedence order.
- Conversation handoff: `divedra` routes by explicit `OutputRef` (`workflowExecutionId`, `outputNodeId`, `nodeExecId`) instead of implicit latest-output inference.
- Node mailbox transport: messages are persisted as hierarchical manager-routed file mailboxes with per-workflow-execution `communicationId` allocation owned by the root workflow manager. Manager-routed sends remain the authoritative cross-step transport, and a re-executed or resubmitted send always allocates a new `communicationId`; delivery retries for an already-created send keep the same `communicationId` and advance `deliveryAttemptId` (and optional `agentSessionId`).
- Node execution inbox contract: canonical mailbox transport stays manager-owned, but workers receive one compiled execution-local inbox/outbox contract under their node artifact directory. The worker-facing metadata uses mailbox-root-relative paths plus `DIVEDRA_MAILBOX_DIR`, so node implementations do not need hidden knowledge of workflow graph shape or canonical `communications/...` layout.
- GraphQL control-plane direction: GraphQL is the canonical served control-plane schema for execution, communication inspection/replay, manager send operations, and workflow/session control flows. CLI remains a thin client surface over GraphQL.
- Manager control-plane separation: a manager-issued GraphQL manager-message mutation invoked through `divedra graphql` is not itself a mailbox communication. It is a scoped control-plane request that may cause new mailbox communications, retries, planner-state changes, or node execution requests.
- Manager-message provenance: manager-authored mailbox sends now use discriminated `payloadRef` provenance so node-output-backed and manager-message-backed communications stay replay/retry compatible under one durable artifact model.
- File/image reference portability: GraphQL must use data-root-relative file references resolved under `DIVEDRA_ARTIFACT_DIR`, never host absolute paths. This is required for future container node execution with bind-mounted or synchronized data volumes regardless of whether the selected runner is Podman, Docker, nerdctl, or Apple container.
- Manager attachment scope: manager-scoped GraphQL attachments are not just root-data-relative; they must stay inside the authenticated execution's `files/{workflowId}/{workflowExecutionId}/...` namespace so manager messages cannot read unrelated workflow artifacts or session files.
- Root-data note: `DIVEDRA_ARTIFACT_DIR` is the canonical root data directory for derived workflow artifacts, session state, attachments, and the runtime database.
- Manager kind naming note: the older manager-kind simplification pass is historical only; current role-direction work is tracked by workflow role unification rather than by keeping a separate manager-kind spec.
- Workflow role unification direction: future design work should collapse authored node roles to `manager` and `worker`, make workflow managers optional, and treat called workflows as ordinary workflows rather than as structural sub-workflow boundaries. This supersedes the older manager-kind split direction.
- Workflow JSON simplification direction: the authored surface should stay step-based, keep the explicit node registry, and avoid reintroducing dedicated graph-control primitives that duplicate step transitions.
- Legacy compatibility removal direction: remaining node-addressed or structural compatibility paths are removal-only work, not precedent for new features. Refactor iterations should delete or collapse those paths rather than preserve aliases, and the active execution tracker is `impl-plans/workflow-legacy-compatibility-removal.md`.
- Legacy compatibility review note (2026-04-25, updated 2026-04-29): the repository's live runtime/API surface is now step-addressed. The public `call-node` surface is removed; CLI `workflow inspect`, GraphQL workflow views, and `buildInspectionSummary` are step-first (`entryStepId`, `managerStepId`, `stepIds`, node registry ids, `crossWorkflowDispatchIds`, `counts.crossWorkflowDispatches` for step-derived cross-workflow dispatches) without node-addressed entry/manager fields on those summaries. Manager-control no longer includes structural `start-sub-workflow` / `deliver-to-child-input` actions (those types are rejected). Cross-workflow execution uses step transitions and runtime-derived dispatch rows instead of structural child scheduling or authored top-level `workflow.workflowCalls`. Manager-control accepts `planner-note`, `retry-step`, `replay-communication`, `execute-optional-step`, and `skip-optional-step` (retry/optional actions use `stepId`; node-id action aliases are removed). `call-step` direct execution uses a step-addressed internal executor input (`stepId`). Validation rejects top-level authored `workflow.workflowCalls` on all bundles (cross-workflow calls use step transitions only). Runtime/session/output-ref metadata projection is centralized around the shared step-identity and output-ref helpers (`StepIdentityFields`, `toStepIdentityFields(...)`, `buildOutputRefForExecution(...)`). Remaining cleanup is mostly documentation and intentional negative tests for removed authored fields. Auto-improve supervision remediation is step-only (`rerunFromStepId` on the engine); workflow bundles are validated on the same strict step-addressed path as ordinary execution (no runtime projection from legacy node-graph shapes).
- Step-based workflow direction: workflows contain `steps` as the canonical execution units, while `workflow.json.nodes[]` is a reusable node registry instead of direct execution order. Different steps may intentionally share one node and optionally continue its backend session, which makes patterns such as implementation followed by self-review by the same LLM/code node explicit.
- Jump-driven routing direction: dedicated authored branch/loop primitives should be removed from the primary workflow schema in favor of runtime-owned output mail envelopes that carry status metadata plus an optional validated next-step jump request. The default manager mode should become deterministic `code`, while `llm` manager remains experimental. Revisited nodes must allocate distinct mailbox instances and may continue the same backend session with a different prompt variant.
- Auto-improve supervision direction: `divedra` supports an `auto improve mode` with two shipped paths: the default engine-owned supervision loop and an opt-in nested superviser workflow path enabled with `--nested-superviser`, both using the same persisted audit model.
- CLI variables contract: `divedra graphql --variables` accepts inline JSON or `@path/to/variables.json` for GraphQL variables. `divedra workflow run --variables` accepts inline JSON object input, explicit `@path/to/variables.json`, and the historical bare file path form such as `./vars.json` for workflow runtime variables. Both commands reject arrays, scalars, malformed JSON, and unreadable file inputs before sending a request or starting execution. `workflow inspect` should use callable input metadata to show concrete `--variables` examples in text output and preserve `callable.input.jsonSchema` as nested JSON in JSON output; this is discoverability, not schema enforcement. First-iteration attachment handling assumes files are pre-placed under the Divedra root data directory; no upload mutation is introduced yet.
- GraphQL transport contract: `/graphql` accepts standard JSON request envelopes with `query` and optional `variables`, and `divedra graphql` executes locally in-process when no endpoint is provided. `--endpoint` or `DIVEDRA_GRAPHQL_ENDPOINT` selects remote HTTP transport.
- Manager action contract: execution-affecting manager requests must use typed GraphQL actions. Freeform text may be retained for audit notes, but must not be the only source of truth for privileged control decisions.
- Manager auth/idempotency contract: GraphQL manager mutations use a runtime-issued bearer token scoped to one manager session and enforce persisted idempotency by `(mutationName, managerSessionId, idempotencyKey)`.
- Manager message identity contract: `managerMessageId` must be allocated with collision-safe opaque ids so concurrent `sendManagerMessage` requests cannot reuse the same append-only message record.
- Manager runtime session lifecycle: manager-step executions mint a scoped GraphQL manager session at runtime, pass the ambient control-plane environment only to manager-capable adapters, and expire the token when the step ends.
- Manager control-mode exclusivity: each manager execution persists one authoritative control source, so `sendManagerMessage` and payload `managerControl` cannot both drive the same manager step; the control-mode claim itself must be atomic at the storage boundary.
- Node output ingestion contract: ordinary node completion is runtime-captured in the execution path itself, not discovered by periodic scanning for `output.json` files. File watching is only an adapter-local fallback for special external backends and must still feed results back into the runtime-owned completion path.
- Timeout inspection fallback: if the normal transition/notification path fails, Divedra still needs a deterministic inspection path for node `status`, published `output.json`, `meta.json`, and timeout/failure messages via GraphQL `nodeExecution(...)` or internal runtime-db/session helpers.
- Node backend/model contract: node payloads use explicit `executionBackend` plus provider-specific `model`; new authored workflows should not encode backend selection inside `model`.
- Prompt layering contract: node payloads may provide `systemPromptTemplate*` and `sessionStartPromptTemplate*` so stable role instructions and first-session bootstrapping are separated from per-execution prompt bodies.
- External output publication contract: the externally published workflow result is selected from the latest accepted root-scope `output` node artifact in the current workflow execution, not from an arbitrary last manager or worker response.
- Handoff checkpoint contract: accepted node executions persist `handoff.json` metadata and `commit-message.txt` operator helpers so Git/Jujutsu checkpoint workflows can track exact input/output provenance without becoming runtime dependencies.
- Container runtime contract: container nodes may declare either a prebuilt `image` or a workflow-local `build` block with `contextPath` and optional `containerfilePath`, plus workflow-level runner defaults.
- User escalation contract: `nodeType: "user-action"` is a runtime-owned human interaction executor that fans out through registered message/notification tools selected by logical tool id, validates the normalized reply against the node `output` contract, and resumes the paused workflow on acceptance. Optional step execution is manager-owned scheduler policy rather than a node payload executor concern.
- Node add-on contract: `workflow.json.nodes[]` may reference built-in worker add-ons with `addon` instead of `nodeFile`; the loader resolves them into effective node payloads while save/edit surfaces preserve the authored reference. Built-in add-ons currently include `divedra/chat-reply-worker`, `divedra/codex-worker`, `divedra/claude-code-worker`, `divedra/x-gateway-read`, `divedra/x-gateway`, `divedra/mail-gateway-read`, and `divedra/mail-gateway`. `addon.inputs` supplies invocation-specific node variables, and only descriptors that consume explicit environment bindings may accept `addon.env`; required add-on env sources are runtime readiness prerequisites.

### Completion-First Progression

A node should not transition until completion criteria are evaluated.
This supports quality gates in collaborative writing workflows.

### Open Items

- See `design-docs/user-qa/README.md` for any currently tracked open decisions.

### GraphQL Redesign Decision

- The requested GraphQL-first redesign does not conflict with the current execution/mailbox architecture.
- It does conflict with the current CLI/control-surface layering if attempted as a direct in-place replacement.
- The approved direction is therefore additive and layered:
  - keep workflow/session/mailbox artifacts,
  - introduce GraphQL as the canonical control plane,
  - expose `divedra graphql` as the manager tool client over that control plane,
  - add first-class communication inspection and replay services,
  - keep CLI only as a thin GraphQL client surface,
  - keep served workflow-definition and execution flows on GraphQL rather than reintroducing parallel REST routes.

### Migration Rule

- Existing workflow-run `sessionId` in runtime/session-store code is the old name for `workflowExecutionId`.
- New design docs must use `workflowExecutionId` for workflow-run scope and `agentSessionId` for worker retry scope.
- New API and persistence changes should not introduce fresh `sessionId` surface area for workflow runs.

### Documentation Cleanup Note

- Browser-editor and browser-asset design documents were removed after the Web UI implementation was deleted from the repository.
- Historical topic-by-topic spec files were retired on 2026-04-25 after their current content was consolidated into `architecture.md`, `command.md`, and `notes.md`.
- The canonical design surface is now the three main files in `design-docs/specs/`, with `README.md`, implementation plans, and `src/` as the detailed follow-up references.
