# Workflow Web Editor and Serve Mode Design

This document defines the browser editing and execution design for `oyakata`.

## Overview

Add a local web interface so users can:

- Edit workflow structure and node payloads with the browser UI
- Start local HTTP server via `oyakata serve`
- Execute workflows from the UI and monitor session progress

The server and UI are local-first and operate on the existing `.oyakata/<workflow-name>/` directory contract.

Current-state note:

- The browser workflow editor is served as a built frontend from `ui/dist/`.
- `oyakata serve` no longer embeds or maintains a second inline browser implementation inside the Bun server.
- The checked-in UI implementation is SolidJS-based today, and the server/API boundary remains framework-agnostic at the `ui/dist/` asset contract.
- Browser workflow-definition, execution, and session flows now use `/graphql`; `/api/ui-config` remains only as bootstrap metadata.
- Legacy browser REST routes such as `/api/workflows*`, `/api/workflow-executions*`, and `/api/sessions*` are no longer served.

## Goals

1. Provide visual workflow editing without changing canonical file split.
2. Reuse existing execution engine behavior from CLI run path.
3. Keep file format deterministic and compatible with non-UI workflows.
4. Support safe local concurrent editing and reliable saves.

## Non-Goals

- Remote multi-user collaboration
- Cloud-hosted workflow execution service
- Real-time push transport (WebSocket) in first iteration

## User Flows

### Workflow Editing

1. User starts server with `oyakata serve`.
2. User chooses workflow from list or creates one from template.
3. User edits:

- Graph nodes/edges and conditions
- Workflow defaults (`maxLoopIterations`, `nodeTimeoutMs`, and optional `containerRuntime`)
- Node payload (`nodeType`, agent backend/model/prompt fields, `variables`, command/container settings, optional `durability`, and optional `timeoutMs`)
- Vertical sequence metadata (`order`)
- Structural sub-workflow metadata (`subWorkflows[].block.type`, and `block.loopId` for loop bodies)

4. User saves; server writes:

- `workflow.json`
- `workflow-vis.json`
- `node-{id}.json` files

### Workflow Execution

1. User clicks Run in browser.
2. UI calls the GraphQL `executeWorkflow` mutation with optional runtime variable overrides.
3. Server creates session and starts engine.
4. UI polls GraphQL `workflowExecutions` / `workflowExecution` queries for node progress and terminal status.
5. User can cancel run from UI.

## Server Architecture

Single-process local runtime:

- Static asset serving for the built browser app from `ui/dist/`
- GraphQL control plane for workflow-definition, execution, and session operations
- Shared workflow validation and execution services used by CLI commands
- UI bootstrap/config endpoint (`GET /api/ui-config`) for fixed-workflow, read-only, and no-exec mode flags
- Explicit unavailable response when `ui/dist/` is absent

Data safety:

- Atomic writes (`*.tmp` then rename)
- Revision check on update (`revision` or equivalent hash/version)
- Validation before save commit

## Browser Control-Plane Contract

### Bootstrap Endpoint

- `GET /api/ui-config`
  - Returns bootstrap/config state such as fixed-workflow, read-only, no-exec, and built-frontend mode metadata.

### GraphQL Queries and Mutations

- `query workflows`
  - Returns workflow names for the picker.
- `query workflowDefinition(workflowName)`
  - Returns normalized workflow data and current revision.
- `mutation createWorkflowDefinition(input)`
  - Creates a new workflow bundle and returns the normalized workflow payload.
- `mutation saveWorkflowDefinition(input)`
  - Saves the normalized workflow payload with an expected revision and returns either success or revision-conflict metadata.
- `mutation validateWorkflowDefinition(input)`
  - Returns structured validation errors and warnings.
- `query workflowExecutions(first)`
  - Returns workflow execution/session summary items for the browser execution list.
- `query workflowExecution(workflowExecutionId)`
  - Returns execution/session detail including node progress and terminal status.
- `mutation executeWorkflow(input)`
  - Starts a workflow execution. The response keeps `workflowExecutionId` as canonical and may still include `sessionId` as a compatibility alias through `2026-09-30`.
- `mutation cancelWorkflowExecution(input)`
  - Requests cancellation for an active workflow execution.

Route-removal note:

- The served browser surface no longer provides workflow/session REST routes under `/api/workflows*`, `/api/workflow-executions*`, or `/api/sessions*`.

## Browser UI Design

### Migration Strategy

1. Introduce a frontend asset boundary in `oyakata serve`.
2. Keep the frontend under `ui/` as a standalone app that consumes the GraphQL control plane plus `/api/ui-config` bootstrap metadata.
3. Port browser editor capabilities in slices:

- bootstrap/config + workflow list/loading
- create/save/validate
- structure and node payload editing
- execution/session inspection

4. Keep browser/E2E verification for the built frontend flow as the remaining quality gate.
5. Keep top-level app-shell loading and workflow/session sequencing in framework-neutral TypeScript helpers so future frontend refactors cannot drift from the server/API contract.

Supporting migration refactoring references:

- `design-docs/specs/design-refactoring-editor-session-controller.md`

### Frontend Build Contract

- Frontend source lives under `ui/src/`.
- The Vite project root is `ui/`, even when build commands are run from the repository root.
- Production assets are emitted to `ui/dist/`.
- The server serves `index.html` for `/` and `/ui` and serves any existing built file under `ui/dist/` by exact path for non-API requests.
- The frontend must not require server mode flags at build time; it must fetch `/api/ui-config` on startup.
- The build output must publish explicit frontend identity metadata under `ui/dist/frontend-mode.json`.
- The `/api/ui-config` response must derive the active frontend identity from that built metadata when available, with an explicit server-side override reserved for tests or forced deployments.
- Default built-metadata lookup must resolve from the same package root as source-entrypoint detection and built asset serving, so alternative package-root overrides cannot accidentally pair one repository's `ui/dist` bundle with another repository's source tree.
- If built frontend metadata is absent, `/api/ui-config` may fall back to checked-in entrypoint detection so unrebuild local states remain diagnosable.
- If built frontend metadata is invalid, or if fallback checked-in entrypoint detection is missing or ambiguous, `/api/ui-config` must fail explicitly instead of silently defaulting to a framework mode.
- Repository-level verification must explicitly run frontend-aware checks in addition to the Bun server tests because the root TypeScript config does not include `ui/`.
- The checked-in SolidJS UI uses the Solid/Vite toolchain plus a production bundle build.
- Repository automated UI unit-test commands must run non-interactively and must not require opening a local listening socket; any interactive Vitest UI is an opt-in developer workflow rather than the default verification contract.
- Repository automation should call framework-detecting UI verification commands so future frontend refactors can change implementation details without another package-script rewrite.
- Those repository-level UI verification commands must resolve `ui/`, `package.json`, and `node_modules/` from the checked-in script/package root rather than the caller's current working directory, so wrappers and non-root invocation paths still verify the intended frontend package.
- Those framework-detecting commands must fail fast with a clear dependency-install error when the checked-in entrypoint selects a framework whose packages are not installed in the workspace.
- Those framework-detecting commands must also fail when the required framework packages are not declared directly in the repository `package.json`, even if a developer's local `node_modules/` or a transitive dependency makes them temporarily resolvable.
- Exactly one checked-in framework-specific entrypoint may exist at a time, and the current frontend entrypoint is `ui/src/main.tsx`.
- Frontend shells and panels should continue consuming the same framework-neutral editor-action/controller helpers wherever possible, so future UI refactors replace only framework glue rather than redoing API/loading behavior.

### Editor Surface

- Vertical workflow list (top-to-bottom) with card-based node rendering
- Property panel for selected node/edge/sequence row
- Workflow defaults panel
- Node-type-aware payload editing for `agent`, `command`, and `container` nodes
- Save/validate controls

### Vertical Interaction Model

- Nodes remain cards, rendered in strict vertical order from `workflow-vis.json.nodes[].order`.
- Reordering uses row drag-handle and/or move-up/move-down controls.
- Nesting for loop/group semantics uses derived `indent` level from graph structure.
- Loop/group visual distinction uses derived semantic `color` tokens from scope metadata.
- Sub-workflow authoring includes explicit block typing:
  - `plain` for ordinary grouped sub-workflows
  - `branch-block` for branch bodies
  - `loop-body` for loop bodies, with a selectable `loops[].id`
- Local editor visualization must match backend derivation rules:
  - `branch-block` colors as a branch scope
  - `loop-body` sub-workflows take precedence over inferred loop intervals
  - typed structural scopes (`loop-body`, then `branch-block`) keep their color precedence even when they contain nested plain groups
- Reserved structure roles (`root-manager`, `sub-oyakata-manager`, `input`, `output`) are derived from workflow manager and sub-workflow boundary configuration, not assigned manually through generic node-kind editing.
- Edge creation/editing is form-driven (source/target/when), not canvas drawing.
- Validation blocks invalid links (self-loop rules, missing node, duplicate edge policy).

### Execution Surface

- Run configuration dialog
- Session timeline with current node highlight
- Structured logs/events panel
- Cancel button and terminal summary

### Validation UX

- Field-level validation (fast local checks)
- Server validation (authoritative)
- Error list links back to relevant node row/form control

## Security and Operational Constraints

- Bind default server to `127.0.0.1`.
- Optional read-only mode for review usage.
- Optional no-exec mode for editing-only usage.
- Reject path traversal in workflow-name routing.
- Input payload size limits for API endpoints.

## Compatibility and Migration

- Existing workflows remain valid.
- Legacy `workflow-vis.json` coordinate fields (`x`,`y`,`width`,`height`,`viewport`) are normalized into sequential vertical order on save.
- Missing `workflow-vis.json` is auto-generated on first save.
- Existing CLI `workflow run` and `workflow validate` remain functional.

## Open Decisions

1. Poll interval default and maximum for session status API.
2. Whether to include incremental save endpoints or only full-document save.
3. Whether to add import/export UX in first release or defer.
4. Standard palette and indentation guide width for loop/group visual clarity.
