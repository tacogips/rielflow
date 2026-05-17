# Workflow Overview Status Surface

Design for the non-TUI workflow overview surface used by human operators.

## Overview

Human operators need a small status surface that answers three questions:

- Which workflows are available?
- Which scoped workflow did I select?
- What is its current aggregate state?

Detailed runtime inspection stays in GraphQL for AI agents, automation, and
advanced tools. The human surface is intentionally limited to a workflow list,
workflow selection, and compact status overview. It must not become a node-log,
mailbox, hook-event, or communication payload browser.

This design adds an overview layer above the existing scoped workflow catalog
and execution/session history. It does not replace detailed GraphQL queries such
as `workflowExecutionOverview`, `workflowExecutions`, `nodeExecution`, or
`communications`.

## Decision Summary

- Add `workflow list` for catalog discovery.
- Add `workflow status <name>` for compact selected-workflow status.
- Make `divedra serve` browser mode default to the same overview-only model.
- Add workflow-level aggregate status `never-run` alongside existing runtime
  execution statuses.
- Keep duplicate workflow names visible by source scope in human-facing lists.
- Keep node logs, communication payloads, hook events, and reply dispatch detail
  out of the default human overview.
- Use GraphQL summary queries for the overview instead of having browser or CLI
  clients stitch together low-level detail queries.
- Treat loadability by session commands as part of the active-execution
  contract: a `running` or `paused` execution shown by workflow status must be
  loadable from the same runtime storage context by `session status`,
  `session progress`, and session step-run inspection.

## Goals

- provide a non-TUI workflow browser for humans
- support `workflow list` and selected-workflow status inspection
- keep the human surface intentionally overview-only
- preserve GraphQL as the canonical machine-readable control plane
- reuse scoped workflow catalog resolution, including project/user shadowing
- make duplicate workflow names visible by source scope rather than hiding them

## Non-Goals

- exposing node logs, communication payloads, hook events, mailbox detail, or
  reply dispatch detail to the default human workflow overview
- replacing `session status <session-id>` for execution-specific debugging
- replacing `workflow inspect <name>` for authored workflow structure review
- introducing a new TUI flow
- making real-time streaming a requirement for the first slice
- adding workflow mutation controls to the overview page

## Terminology

Source scope:

- `project`: workflow loaded from the project scoped catalog
- `user`: workflow loaded from the user scoped catalog
- `direct`: workflow loaded from an explicit workflow root override

Workflow list identity:

- Use `(sourceScope, workflowName, workflowDirectory)` as the stable row
  identity.
- Do not use workflow name alone as a UI key because project and user scopes can
  contain the same name.

Aggregate workflow status:

- A summary status derived from executions for one workflow.
- It is not a replacement for persisted execution/session status.
- The only aggregate-only value is `never-run`.

Active execution count:

- Count executions in non-terminal states: `running` and `paused`.
- Count only active executions that are inspectable from the runtime session
  store used by the selected workflow source. Runtime database snapshots may
  enrich summaries, but they must not create active overview rows that cannot be
  loaded by the session inspection surfaces.

Recent execution order:

- Sort newest first by `startedAt`, then by execution id as a deterministic
  tie-breaker when timestamps are equal or absent.

## Primary User Experience

The human workflow is intentionally small:

1. Open a non-TUI overview surface.
2. See available workflows with source scope and summary state.
3. Choose one workflow.
4. Read compact status and recent-run summary.
5. If deeper diagnosis is needed, use AI or tooling that calls detailed GraphQL
   inspection queries.

This keeps the human surface focused on "what is happening?" rather than
"inspect every runtime artifact."

## Human-Facing Surfaces

### Browser Overview

The primary human surface should be a simple read-only browser page served by
`divedra serve`.

Layout:

- left pane: workflow list
- right pane: selected workflow status overview

Workflow list row fields:

- workflow name
- source scope: `project`, `user`, or `direct`
- short description from `workflow.json.description`
- aggregate workflow status
- active execution count
- latest execution status when one exists
- latest execution start time when one exists

Selected workflow status fields:

- workflow name
- resolved source scope
- workflow directory
- description
- aggregate workflow status
- active execution count
- latest execution status
- latest execution id
- latest execution start/end time
- current step id of the newest active execution when one exists
- recent executions table with a fixed default limit of 10

Default selection:

- If `divedra serve [workflow-name]` constrains access to one workflow, open
  with that workflow selected.
- Otherwise, select the first `running` workflow when present.
- If no workflow is running, select the workflow with the newest execution.
- If no workflow has executions, select the first catalog row in stable catalog
  order.

The browser overview must not render:

- node graphs
- node logs
- communication payload detail
- mailbox payload detail
- hook event detail
- reply dispatch detail

Those remain machine-facing GraphQL data.

### CLI Parity

The same overview model should be available in the CLI.

Add:

- `workflow list`
- `workflow status <name>`

`workflow list` is for discovery. `workflow status <name>` is for the
selected-workflow overview after discovery.

`session status <session-id>`, `session progress <session-id>`, and detailed
GraphQL queries remain the execution-specific diagnostic surfaces.

## Command Design

### `workflow list`

Purpose:

- list catalog-visible workflows for humans
- show only compact per-workflow overview data
- make scoped duplicates visible

Behavior:

- resolves workflows through the same scoped catalog as other workflow commands
- shows duplicate names as separate rows when they come from different scopes
- prints the resolved source scope in every human row using explicit labels such
  as `project scope`, `user scope`, or `direct root`
- emits a warning when the same workflow name exists in both project and user
  scope, because bare-name commands resolve the project-scoped workflow first
- bases project/user duplicate warnings on the scoped catalog, not on the
  status-filtered or limit-truncated visible rows
- uses source scope and workflow directory to keep rows distinct
- in direct `--workflow-definition-dir` mode, lists only workflows in that root and labels
  their human source scope as `direct root`
- does not call detail queries for node logs, communication payloads, hook
  events, or reply dispatches

Options:

- `--scope auto|project|user`
- `--status running|paused|completed|failed|cancelled|never-run`
- `--limit <n>`
- `--output table|json`

Default text output should be table-oriented and optimized for human scanning.
The status filter applies to aggregate workflow status, not to individual
execution status rows.

### `workflow status <name>`

Purpose:

- show a compact status summary for one workflow
- provide session ids that can be used directly with session inspection
  commands under the same storage context

Behavior:

- resolves the workflow through the same scope rules as `workflow run`
- follows project-before-user resolution for bare names in `auto` scope
- supports explicit `--scope project|user` to inspect a shadowed workflow
- in direct `--workflow-definition-dir` mode, resolves only within that root and labels
  source scope as `direct`
- prints the resolved source scope and workflow directory
- shows workflow-level aggregate status plus a short recent execution list
- reports `newestActiveExecution`, `activeExecutionCount`, and active
  `recentExecutions` only from persisted workflow sessions that can be loaded by
  the same session store context used for `session status`, `session progress`,
  and `session step-runs`
- ignores or demotes stale active candidates that exist only in secondary
  indexes, cached overview state, runtime database snapshots, or old storage
  roots when the primary session file cannot be loaded from the selected
  context
- does not print node logs, communication details, mailbox payloads, hook
  events, or reply dispatches by default

Options:

- `--scope auto|project|user`
- `--limit <n>` for recent executions, default 10
- `--output text|json`

If a workflow exists in both project and user scope, bare-name resolution follows
the existing rule: project first, then user. The output must make the resolved
source explicit so the operator can see which workflow was selected.

## Workflow-Level Status Model

The runtime already exposes execution/session statuses:

- `running`
- `paused`
- `completed`
- `failed`
- `cancelled`

The workflow overview surface adds one aggregate workflow-level status:

- `never-run`

Aggregate status derivation:

1. If any execution for the workflow is currently `running`, status is
   `running`.
2. Otherwise, if any execution is currently `paused`, status is `paused`.
3. Otherwise, if there is a latest terminal execution, status is that terminal
   status: `completed`, `failed`, or `cancelled`.
4. Otherwise, status is `never-run`.

When multiple active executions exist, `running` takes precedence over `paused`
because it indicates live work. The latest execution summary is still reported
separately so operators can see which run produced the displayed timestamp.

This preserves the runtime vocabulary instead of inventing a separate status
taxonomy for humans.

### Active Execution Loadability Contract

Workflow status and session inspection share one operator-facing invariant:

- any non-terminal execution exposed as active by `workflow list`,
  `workflow status`, browser overview, or GraphQL `workflowStatusOverview` must
  be loadable as a workflow session from the same resolved runtime storage
  context
- the `sessionId` and `workflowExecutionId` fields in compact summaries remain
  aliases for the same workflow execution id during this migration period
- `session status <session-id> --output json` is the minimum loadability check
  for active entries; `session progress <session-id>` and
  `session step-runs <session-id>` must then resolve against the same persisted
  session identity

The primary source of truth for active overview rows is the persisted
`WorkflowSessionState` file loaded through the session store. A runtime database
snapshot or other derived index can provide ordering, counters, or dashboard
optimization only after it has been reconciled with a loadable session. If a
candidate active row cannot be loaded from the selected context, the overview
must not count it as active or surface it as `newestActiveExecution`.

The preferred fix for a mismatch is shared storage-context resolution, not
papering over an incorrect root by filtering. Local `workflow status` and local
session commands should derive their session-store options through the same
project/user/direct scope rules, explicit storage overrides, and environment
variables. Filtering stale rows is still required as a defensive boundary for
deleted session files or obsolete runtime database rows.

Session inspection commands remain the detailed diagnostic surface. They may
add clear storage-context diagnostics when a session id is not found, but they
must not silently search unrelated project/user roots because that can attach an
operator command to the wrong workflow execution.

## GraphQL Design

GraphQL remains the canonical machine-readable API. The human overview surface
should consume dedicated summary queries rather than stitching together multiple
detailed queries on the client.

### Summary Queries

Add:

- `workflowCatalogOverview`
- `workflowStatusOverview`

Intent:

- `workflowCatalogOverview` returns one row per catalog-visible workflow with
  source metadata and aggregate status.
- `workflowStatusOverview` returns the selected workflow's compact status view
  and recent execution summaries.

Inputs should mirror CLI selection:

- scope selector: `auto`, `project`, or `user`
- optional workflow name for selected status
- optional aggregate status filter for catalog listing
- optional limit for catalog rows or recent executions

Direct workflow-definition-dir behavior is a server/runtime option rather than a GraphQL
scope value. When the server is started with a direct workflow root, summary
queries should label returned rows as `direct`.

### Summary Shapes

`workflowCatalogOverview` should expose:

- workflow name
- source scope
- workflow directory
- description
- aggregate workflow status
- active execution count
- latest execution status
- latest execution id
- latest execution start/end timestamps

`workflowStatusOverview` should expose:

- workflow name
- source scope
- workflow directory
- description
- aggregate workflow status
- active execution count
- latest execution summary
- recent execution summaries

Each recent execution summary should reuse the existing compact execution
summary fields where possible:

- workflow execution id
- session id
- status
- current step id
- started at
- ended at
- node execution counter

For active rows, these summary fields carry a loadability guarantee. The server
resolver must build them from the same storage context that backs session
inspection for that request. Endpoint-backed CLI calls inherit the remote
server's storage context; local CLI calls inherit local scope and storage
options.

### JSON Output Contract

CLI `--output json` should map directly to the summary GraphQL shape. JSON
output must include `sourceScope` and `workflowDirectory` so automation can
distinguish duplicate workflow names without parsing human text.

Duplicate project/user scope warnings are emitted on stderr so JSON stdout stays
parseable.

### Explicit Detail Separation

The new overview queries are for humans and lightweight dashboards.

Detailed queries remain available for AI and advanced tooling:

- `workflowExecutionOverview`
- `workflowExecutions`
- `workflowExecution`
- `nodeExecution`
- `communications`

The browser overview and default CLI commands should not automatically call the
detailed queries.

Detailed session queries may use richer runtime database data, but they must
begin from a loadable workflow session or return an explicit not-found result.
They must not treat a derived snapshot row as a full replacement for the
session file unless the corresponding command contract is intentionally expanded
to support that fallback for all affected session subcommands.

## Data Resolution Rules

### Catalog Resolution

Workflow list resolution must follow the existing scoped catalog behavior:

- project scope first in `auto`
- then user scope
- direct workflow root when explicitly supplied

Unlike bare-name command resolution, the human list must show duplicate names as
separate entries so shadowing is visible. The CLI must also emit a warning for
project/user name collisions to make the shadowing risk visible even when the
operator is not reading every row.

List identity:

- `(sourceScope, workflowName, workflowDirectory)`

This avoids collapsing `project/review` and `user/review` into one row.

### Selected Workflow Resolution

When the browser view or CLI status command targets one workflow:

- bare-name selection follows the existing resolution order
- explicit scope selection narrows the lookup
- direct workflow-definition-dir mode bypasses project/user scope lookup
- the rendered result always prints the resolved source scope

### Runtime Storage Resolution

Workflow overview resolution has two linked parts:

- workflow bundle resolution selects the authored workflow source
- runtime storage resolution selects the session store, artifact root, runtime
  database, and derived indexes for that source

Those parts must stay coupled for status surfaces. Once a workflow source is
resolved, overview builders and session commands should use a common
storage-context helper so `workflow status <name>` and
`session status <session-id>` do not diverge between project scope, user scope,
direct workflow roots, `DIVEDRA_ARTIFACT_DIR`, `DIVEDRA_ARTIFACT_ROOT`, or
`DIVEDRA_SESSION_STORE`.

Explicit storage overrides win. When an operator provides an explicit session
store or artifact/data root, workflow status and session commands must respect
that same override rather than recomputing a scoped default. In scoped catalog
mode without overrides, project/user source scope determines the default runtime
data root. In direct workflow-definition-dir mode, a direct root under
`<scope-root>/workflows` may infer that scope root; otherwise the operator must
use explicit storage options to inspect runs from a nonstandard direct root.

### Fixed Workflow Serve Mode

When `divedra serve [workflow-name]` constrains access to one workflow:

- the overview page should open with that workflow preselected
- the workflow list may collapse to a single visible row
- GraphQL summary queries should not expose other workflows from the catalog

## Empty and Error States

No workflows:

- show an empty catalog message
- return an empty list from `workflowCatalogOverview`
- make `workflow list` exit successfully with no rows

Workflow exists but has never run:

- show aggregate status `never-run`
- show active execution count `0`
- show no latest execution
- show no recent executions

Active candidate is not loadable:

- do not report it as active in aggregate status, active execution count, or
  `newestActiveExecution`
- omit it from active recent-execution rows or show it only as a non-active
  stale diagnostic if a future explicit diagnostic mode is added
- keep default `workflow status` output focused on actionable, inspectable
  sessions

Selection target not found:

- return a not-found state in GraphQL
- make `workflow status <name>` exit non-zero with a direct message
- show a clear missing-workflow state in the browser

Detail requested from the overview:

- do not expand the overview surface
- direct the operator to `session status`, `session progress`, or GraphQL detail
  queries

## Implementation Criteria

The first implementation slice is complete when:

- `workflow list` displays scoped workflow rows with aggregate status
- `workflow status <name>` displays compact selected-workflow status
- duplicate project/user workflow names are visible and distinguishable
- `never-run` is shown for workflows with no executions
- browser mode under `serve` uses the same overview data model
- default human surfaces omit node logs, communication payloads, hook events,
  mailbox payloads, and reply dispatch detail
- JSON output includes enough source metadata to distinguish duplicate names
- active execution ids reported by workflow status are loadable by
  `session status`, `session progress`, and `session step-runs` under the same
  runtime storage context
- stale runtime database or cached active records cannot make a workflow appear
  running when the corresponding persisted session is unavailable

## Why This Split

This design intentionally splits human and AI/tooling responsibilities:

- humans get a small catalog and status overview
- AI agents and advanced tooling get detailed GraphQL inspection

That separation matches the requirement that humans only need the overview,
while detailed retrieval remains available through GraphQL.
