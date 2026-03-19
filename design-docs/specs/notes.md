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

This enables deterministic replay and easier session debugging.

Additional input assembly policy:

- Keep prompt rendering simple (`mustache`-style substitution).
- Build complex runtime payloads as structured `arguments` via explicit bindings.
- Avoid logic-heavy template engines (for example full Handlebars helper flow) in core runtime paths.

### Workflow File Split

Workflow data is intentionally split:

- `workflow.json`: structure/control and workflow `description`
- `node-{id}.json`: runtime payload (`executionBackend`, `model`, `promptTemplate`, `variables`)
- `workflow-vis.json`: browser visualization state (`order`, etc.; `indent`/`color` are derived)

This avoids coupling runtime semantics with browser UI state.

### Deterministic Control Flow

Workflow JSON must make control flow explicit:

- graph edges for transitions
- branch conditions
- loop policies and loop-judge nodes

Implicit transitions are avoided.

### Confirmed Runtime Policies

- Branch behavior: fan-out to all matched branches.
- Loop limit fallback: use workflow global default when loop-local limit is omitted.
- Completion: auto-complete nodes are allowed; success-judgment-free nodes can be configured.
- Timeout: each node can define execution timeout, with workflow-level default fallback.
- Conversation handoff: `divedra` routes by explicit `OutputRef` (`workflowExecutionId`, `outputNodeId`, `nodeExecId`, and optional `subWorkflowId` for sub-workflow outputs) instead of implicit latest-output inference.
- Node mailbox transport: messages are persisted as hierarchical manager-routed file mailboxes with per-workflow-execution `communicationId` allocation owned by the root workflow manager. The parent workflow manager writes only to the recipient sub-workflow manager inbox, and the recipient sub-workflow manager writes only to nodes inside that sub-workflow (validated via `subWorkflows[].nodeIds`). A re-executed/resubmitted send always allocates a new `communicationId`; delivery retries for an already-created send keep the same `communicationId` and advance `deliveryAttemptId` (and optional `agentSessionId`). See `design-docs/specs/design-node-mailbox.md`.
- Node execution inbox contract: canonical mailbox transport stays manager-owned, but workers receive one compiled execution-local inbox/outbox contract under their node artifact directory. The worker-facing metadata uses mailbox-root-relative paths plus `DIVEDRA_MAILBOX_DIR`, so node implementations do not need hidden knowledge of workflow graph shape or canonical `communications/...` layout. See `design-docs/specs/design-node-execution-inbox-contract.md`.
- GraphQL control-plane direction: GraphQL is now the canonical served control-plane schema for execution, communication inspection/replay, manager send operations, and browser workflow/session flows. CLI may remain as a thin client surface over GraphQL, while `/api/ui-config` remains only as bootstrap metadata outside `/graphql`. See `design-docs/specs/design-graphql-manager-control-plane.md`.
- Manager control-plane separation: a manager-issued GraphQL manager-message mutation invoked through `divedra gql` is not itself a mailbox communication. It is a scoped control-plane request that may cause new mailbox communications, retries, planner-state changes, or node execution requests.
- Manager-message provenance: manager-authored mailbox sends now use discriminated `payloadRef` provenance so node-output-backed and manager-message-backed communications stay replay/retry compatible under one durable artifact model.
- File/image reference portability: GraphQL must use data-root-relative file references resolved under `DIVEDRA_ROOT_DATA_DIR`, never host absolute paths. This is required for future container node execution with bind-mounted or synchronized data volumes regardless of whether the selected runner is Podman, Docker, nerdctl, or Apple container.
- Manager attachment scope: manager-scoped GraphQL attachments are not just root-data-relative; they must stay inside the authenticated execution's `files/{workflowId}/{workflowExecutionId}/...` namespace so manager messages cannot read unrelated workflow artifacts or session files.
- Root-data migration note: `DIVEDRA_ROOT_DATA_DIR` is the canonical setting for derived artifact/session/file paths, while `DIVEDRA_RUNTIME_ROOT` remains an implementation compatibility alias until older flows are migrated.
- Manager kind naming direction: the authored workflow schema should keep an explicit root-vs-sub-workflow manager split, but the nested kind should be neutral (`subworkflow-manager`) instead of product-branded (`sub-divedra-manager`). Detailed scope is tracked in `design-docs/specs/design-manager-kind-simplification.md`.
- Workflow role unification direction: future design work should collapse authored node roles to `manager` and `worker`, make workflow managers optional, and treat called workflows as ordinary workflows rather than as structural sub-workflow boundaries. This supersedes the manager-kind split direction for future architecture work. Detailed scope is tracked in `design-docs/specs/design-unified-workflow-role-model.md`.
- `divedra gql` variables contract: GraphQL variables are passed through `--variables`, which accepts inline JSON or `@path/to/variables.json`. First-iteration attachment handling assumes files are pre-placed under the Divedra root data directory; no upload mutation is introduced yet.
- GraphQL transport contract: `/graphql` accepts standard JSON request envelopes with `query` and optional `variables`, and `divedra gql` defaults to the local serve endpoint at `http://127.0.0.1:43173/graphql` unless `--endpoint` or `DIVEDRA_GRAPHQL_ENDPOINT` overrides it.
- Manager action contract: execution-affecting manager requests must use typed GraphQL actions. Freeform text may be retained for audit notes, but must not be the only source of truth for privileged control decisions.
- Manager auth/idempotency contract: GraphQL manager mutations use a runtime-issued bearer token scoped to one manager session and enforce persisted idempotency by `(mutationName, managerSessionId, idempotencyKey)`.
- Manager message identity contract: `managerMessageId` must be allocated with collision-safe opaque ids so concurrent `sendManagerMessage` requests cannot reuse the same append-only message record.
- Manager runtime session lifecycle: manager-node executions mint a scoped GraphQL manager session at runtime, pass the ambient control-plane environment only to manager-capable adapters, and expire the token when the step ends. See `design-docs/specs/design-graphql-manager-runtime-session-lifecycle.md`.
- Manager control-mode exclusivity: each manager execution persists one authoritative control source, so `sendManagerMessage` and payload `managerControl` cannot both drive the same manager step; the control-mode claim itself must be atomic at the storage boundary.
- Node output ingestion contract: ordinary node completion is runtime-captured in the execution path itself, not discovered by periodic scanning for `output.json` files. File watching is only an adapter-local fallback for special external backends and must still feed results back into the runtime-owned completion path.
- Timeout inspection fallback: if the normal transition/notification path fails, Divedra still needs a deterministic inspection path for node `status`, published `output.json`, `meta.json`, and timeout/failure messages via GraphQL `nodeExecution(...)` or internal runtime-db/session helpers.
- Container runtime contract: future container nodes may declare either a prebuilt `image` or a workflow-local `build` block with `contextPath` and optional `containerfilePath`/legacy `dockerfilePath`, plus workflow-level runner defaults. The additive authoring and validation rules are specified in `design-docs/specs/design-container-runtime-contract.md`.
- User escalation contract: add `nodeType: "user-action"` as a runtime-owned human interaction executor that fans out through registered message/notification tools selected by logical tool id, validates the normalized reply against the node `output` contract, and resumes the paused workflow on acceptance. Optional node execution should be modeled separately as manager-owned scheduler policy on `workflow.json.nodes[]` rather than as a node payload executor concern. See `design-docs/specs/design-user-action-and-optional-node-execution.md`.

### Completion-First Progression

A node should not transition until completion criteria are evaluated.
This supports quality gates in collaborative writing workflows.

### Open Items

- See `design-docs/qa.md` for current decision status and any remaining confirmation items.

### GraphQL Redesign Decision

- The requested GraphQL-first redesign does not conflict with the current execution/mailbox architecture.
- It does conflict with the current CLI/control-surface layering if attempted as a direct in-place replacement.
- The approved direction is therefore additive and layered:
  - keep workflow/session/mailbox artifacts,
  - introduce GraphQL as the canonical control plane,
  - expose `divedra gql` as the manager tool client over that control plane,
  - add first-class communication inspection and replay services,
  - keep CLI only as a thin GraphQL client surface,
  - keep browser workflow-definition, execution, and session flows on GraphQL rather than reintroducing parallel REST routes.

### Migration Rule

- Existing workflow-run `sessionId` in runtime/session-store code is the old name for `workflowExecutionId`.
- New design docs must use `workflowExecutionId` for workflow-run scope and `agentSessionId` for worker retry scope.
- Bare `sessionId` is allowed only as a temporary compatibility alias in existing APIs and persisted workflow-run state.
- Compatibility window is fixed: keep `sessionId` alias support through `2026-09-30`, then remove it in the first subsequent minor release.

### Refactoring Investigation Plan

- Repository-wide refactoring investigation is tracked in `design-docs/specs/design-refactoring-investigation-plan.md`.
- The investigation is intentionally split into multiple passes so architectural, type-safety, DRY, hardcoding, and test-safety concerns can be analyzed separately before implementation planning.
- Shared browser/server transport typing is tracked in `design-docs/specs/design-refactoring-shared-ui-contract.md`.
- Shared derived visualization reuse is tracked in `design-docs/specs/design-refactoring-shared-visualization-derivation.md`.
- Shared editable workflow typing is tracked in `design-docs/specs/design-refactoring-shared-editable-workflow-types.md`.
- Frontend browser/API client extraction is tracked in `design-docs/specs/design-refactoring-editor-api-client.md`.
- Frontend workflow-structure operations extraction is tracked in `design-docs/specs/design-refactoring-editor-workflow-operations.md`.
- Frontend support-helper extraction is tracked in `design-docs/specs/design-refactoring-editor-support-helpers.md`.
- Frontend state-helper extraction is tracked in `design-docs/specs/design-refactoring-editor-state-helpers.md`.
- Frontend mutation-helper extraction is tracked in `design-docs/specs/design-refactoring-editor-mutation-helpers.md`.
- Frontend workflow/session data-loader extraction is tracked in `design-docs/specs/design-refactoring-editor-data-loaders.md`.
- Frontend async action-helper extraction is tracked in `design-docs/specs/design-refactoring-editor-action-helpers.md`.
- Frontend field/property update helper extraction is tracked in `design-docs/specs/design-refactoring-editor-field-updates.md`.
- Frontend execution-form request helper extraction is tracked in `design-docs/specs/design-refactoring-editor-execution-helpers.md`.
- Frontend center-panel component extraction is tracked in `design-docs/specs/design-refactoring-editor-main-panel-component.md`.
- Server API request-parsing helper extraction is tracked in `design-docs/specs/design-refactoring-server-api-request-parsing.md`.
- Server UI asset-serving helper extraction is tracked in `design-docs/specs/design-refactoring-server-ui-asset-serving.md`.
- Frontend verification still requires framework-aware UI tooling to validate dependency availability explicitly before build/typecheck execution, even though the checked-in browser implementation is SolidJS today, because future framework swaps should preserve the same package-root and tooling guarantees.
