# TUI Design

This document defines terminal UI design for workflow selection and execution in Bun.

## Overview

`divedra tui` provides:

- workflow browsing from `<workflow-root>` with a dedicated workspace screen
- historical session and node-execution inspection
- interactive workflow run, rerun, and resume flows with a dedicated new-run screen
- text or JSON runtime input editing based on workflow-definition hints
- artifact-oriented execution trace visibility aligned with runtime outputs

The TUI uses the same workflow loader and execution engine as CLI and serve mode.

## Framework Selection

Selected stack: `@opentui/core` host runtime with an `@opentui/solid`
view layer.

Why:

- Full-screen TUI primitives (list/log/input/detail panes) needed for workflow browser + execution console.
- The checked-in screen host still uses `@opentui/core` for renderer creation and low-level focus/keyboard interop inside `src/tui/opentui-screen.ts`.
- `@opentui/solid` keeps the TUI in the Bun/TypeScript runtime while allowing the checked-in screen tree to live in declarative components instead of one imperative module.
- The CLI can lazy-load the OpenTUI screen boundary and still fall back cleanly when the OpenTUI host/view packages or required `solid-js` runtime modules are unavailable.
- The repository uses the standard `solid-js` JSX runtime for `.tsx` compilation because the current `@opentui/solid` package does not ship runtime `jsx-runtime` JavaScript exports; `@opentui/solid` still owns the renderer, intrinsic element catalogue, and preload integration.

Current implementation boundary:

- `src/cli.ts` owns runtime-mode selection and lazy-loads the OpenTUI screen module only for interactive mode
- `src/tui/opentui-model.ts` owns framework-neutral TUI types plus pure helpers for filtering, pane chrome, breadcrumbs, run-status text, workflow preview/header text, and selection rows
- `src/tui/opentui-detail-content.ts` owns artifact-backed node-detail content assembly plus history-detail pane state selection so mailbox/output loading and summary/viewer/detail decisions stay reusable outside the renderer host
- `src/tui/opentui-host-view.ts` owns mounted-ref validation and pane-chrome application so host wiring is not duplicated inside the renderer loop
- `src/tui/opentui-controller.ts` owns run/rerun/resume/copy/refresh/input-format action orchestration with explicit async boundaries
- `src/tui/opentui-screen.ts` owns renderer startup, ref wiring, focus movement, keyboard dispatch, popup wiring, and host-local mutable runtime state while delegating the actual screen tree to `src/tui/opentui-solid-app.tsx`
- `src/tui/opentui-solid-app.tsx` and `src/tui/components/*.tsx` define the workspace, workflow-history, new-run, detail, and popup surfaces through `@opentui/solid`
- `package.json`, `bunfig.toml`, and `tsconfig.json` are configured so the checked-in `.tsx` TUI modules load through Bun with the OpenTUI Solid preload path
- the interactive CLI path now enters the unified workspace/history/run app directly; no separate OpenTUI selector screen remains in front of it

Not selected now:

- `Ink`: strong React model, but current Bun input compatibility concerns exist in open issue tracking.
- prompt-only libraries: insufficient for multi-pane live execution/trace experience.

Selection policy:

- Keep TUI framework swappable behind a thin CLI/runtime adapter.
- Keep screen state and actions behind framework-neutral seams so the view layer remains swappable even after the `@opentui/solid` cutover.
- Re-evaluate `Ink` after Bun compatibility issue closure.

## Interaction Model

### Startup

Command:

- `divedra tui`
- `divedra tui --workflow <name>` (skip the workspace screen and open the workflow-history screen)
- `divedra tui --resume-session <id>` (open the workflow-history screen focused on that historical session when interactive; direct-resume fallback when non-interactive, when the workflow bundle is unavailable, or when OpenTUI cannot be loaded)

Workflow root resolution:

1. `--workflow-root`
2. `DIVEDRA_WORKFLOW_ROOT`
3. `./.divedra`

### Screen Model

The TUI uses four primary screens instead of a single always-expanded multi-pane layout.

A compact breadcrumb bar stays visible at the top of the screen so nested navigation remains legible while moving across workspace, workflow history, new-run, and subworkflow views.

### Canonical Window and Pane Names

This document uses the following terminology consistently:

- `window`: an operator-facing full-screen TUI state
- `screenMode`: the internal implementation identifier for a window
- `pane`: a bordered region inside a window
- `popup`: a temporary overlay; popups are not panes and do not create a new window

Window naming is fixed as follows:

| Canonical window name | Internal `screenMode` | Purpose |
| --- | --- | --- |
| Workspace Window | `workspace` | choose a workflow before opening definition, history, or run flows |
| Workflow Definition Window | `definition` | inspect authored workflow-definition files and node payloads |
| Workflow History Window | `history` | inspect workflow runs, node executions, node detail, and reusable input |
| New Workflow Run Window | `run` | prepare input, confirm launch, and monitor the newly started run |

Pane naming is fixed as follows:

| Window | Canonical pane name | Current visible title |
| --- | --- | --- |
| Workspace Window | Workflow List Pane | `Workflows` |
| Workspace Window | Workflow Preview Pane | `Workflow Preview` |
| Workspace Window | Latest Run Result Pane | `Latest Run Result` |
| Workflow Definition Window | Workflow Definition Pane | `Workflow Definition` |
| Workflow Definition Window | Workflow Definition Nodes Pane | `Nodes` |
| Workflow History Window | Workflow Runs Pane | `Workflow Runs` |
| Workflow History Window | Node Executions Pane | `Nodes` |
| Workflow History Window | Node Detail Pane | `node detail` |
| Workflow History Window | Input Pane | `Input` plus the current mode/syntax suffix |
| Workflow History Window, subworkflow view | Workflow Nodes Pane | `Workflow Nodes` |
| Workflow History Window, subworkflow view | Workflow List Pane | `Workflow List` |
| New Workflow Run Window | Workflow Detail Pane | `Workflow Detail` |
| New Workflow Run Window | Execution Status Pane | `Execution Status` |
| New Workflow Run Window | Run Input Pane | `Run Input` plus the current mode/syntax suffix |

Shared non-pane chrome is named as follows:

- Breadcrumb Bar: top-of-window location trail across workflow and subworkflow scopes
- History Header: the titled header box shown above the history panes; its title is `Workflow` in root history mode and `Subworkflow <id>` in nested history mode
- Shortcut Footer: the single-line footer that summarizes the current window's keybindings

Subworkflow inspection terminology is fixed:

- `subworkflow view` is a mode inside the Workflow History Window, not a separate top-level window
- entering a child subworkflow changes the history pane titles from `Workflow Runs` / `Nodes` to `Workflow Nodes` / `Workflow List`
- the Node Detail Pane and Input Pane remain part of the same Workflow History Window during subworkflow inspection

Popup names are fixed as follows:

| Canonical popup name | Current visible title |
| --- | --- |
| Workflow Filter Popup | `Filter Workflows` |
| Help Popup | `Help` |
| Run Confirmation Popup | `Confirm Run` |
| Node Definition Popup | `Node Definition` |
| AI Agent Session Popup | `AI Agent Session` |

#### Workspace Screen

Default screen when `divedra tui` starts without `--workflow` or `--resume-session`.

Layout:

- Left pane: workflow list
- Top-right pane: workflow preview showing a visual node summary
- Bottom-right pane: latest run result showing the highlighted workflow's most recent run status and output, with compact execution summary context

Behavior:

1. the workspace screen is dedicated to choosing a workflow, not browsing sessions and nodes yet
2. pressing `/` opens a popup filter input and focus enters that input immediately on the first keypress
3. the popup accepts a workflow-name substring filter and immediately narrows the workflow list
4. `enter`, `ctrl-m`, or `l` opens the highlighted workflow in the workflow-definition screen
5. `n` opens the new-run screen for the highlighted workflow
6. pressing `?` opens a help popup, and `q` closes that popup

Workflow preview content:

- high-level node and subworkflow counts
- visually ordered node structure derived from `workflow-vis.json`
- the root manager remains at the top level, while subworkflow managers and their owned nodes render with deeper indentation so workflow ownership reads clearly
- per-node metadata such as workflow node kind, node type, backend/model when present, and concise node help text derived first from node-level `description`, then from output descriptions or prompt summaries
- the root manager block shows workflow id
- the preview pane should not duplicate keybinding hints; the screen footer shows the compact shortcut row while the help popup keeps the expanded guidance

Latest run result content:

- total workflow runs for the highlighted workflow
- aggregate counts for success, failure, running, paused, and cancelled sessions
- latest run snapshot including session id, status, timestamps, current node, and last error when present
- latest resolved workflow output preview from the most recent run, or an explicit unavailable note when no output exists yet

Filtering rules:

- filtering is local to the currently loaded workflow name list
- filter matching is case-insensitive substring matching
- when a filter is active, the workspace `Workflows` pane title must show that the list is filtered and display the current match count
- clearing the popup input restores the full workflow list
- cancelling the popup keeps the previously visible filtered result unchanged

#### Workflow History Screen

Shown after a workflow is selected, or immediately when `--workflow` or interactive `--resume-session` is used.

Layout:

- Top breadcrumb bar: current location such as `workspace > review-flow > history > delivery-lane`
- Top header: workflow id and optional workflow description when present, plus subworkflow scope metadata when drilled into a child workflow
- Left pane: historical workflow-run list for the selected workflow
- Right pane: node-execution list for the selected session
- Bottom large pane: node-details view for the selected node
- Bottom input area: run/rerun input editor

Nested subworkflow inspection:

- when the selected node row belongs to a subworkflow scope, the row should show the owning workflow id and node purpose
- pressing `l` on that row opens a nested subworkflow view without leaving the workflow-history screen
- the nested subworkflow view reuses the same three-pane history layout shape:
  left pane becomes workflow nodes, right pane becomes workflow list, and the bottom pane remains node detail
- nested subworkflow views may recurse; the breadcrumb bar is the authoritative location indicator

Design intent:

- keep the workflow selector mentally separate from workflow execution history
- reduce first-screen noise by not showing sessions and nodes before a workflow is chosen
- reserve the larger lower area for details because inbox/outbox and logs are multi-line artifacts
- keep a single-line shortcut footer visible for the active screen, while expanded guidance still lives in a popup opened with `?`
- render workflow runs and node executions as two-line rows so status, timestamps, ids, and node names stay readable
- use color and ASCII badges/separators to make the layout easier to scan without relying on emoji

Panel-interaction consistency:

- only the active pane shows a selected-row state; inactive panes keep their logical cursor but render without active-row emphasis
- every focused list-like or scrollable pane must accept both arrow keys and `j` / `k` for movement inside that pane
- `enter` and `ctrl-m` should have the same meaning within a given pane unless the screen explicitly documents a different action
- when `enter` or `ctrl-m` opens or deepens into another pane, the destination pane must become and remain the active pane
- deeper inspection panes should use `esc` to return focus to the immediate parent pane rather than jumping to a distant screen
- inverse navigation pairs must stay symmetric; if `enter` deepens into a pane and `esc` returns from it, or `l` moves right and `h` moves left, a deeper pane must not reuse the reverse key for unrelated global navigation

#### Workflow Definition Screen

Shown from the workspace screen via `enter`, `ctrl-m`, or `l`.

Layout:

- Top pane: compact workflow summary showing identity, location, scope, and input-mode hints without rendering raw `workflow.json` or `workflow-vis.json`
- Bottom pane: workflow node list

Behavior:

1. the screen is definition-oriented and does not mix historical runtime state into the main panes
2. focus enters on the node-list pane so `j` / `k` can immediately move across workflow nodes
3. `tab` and `shift-tab` cycle focus between the workflow-definition pane and the node-list pane
4. when the workflow-definition pane is focused, `j` / `k` and arrow keys scroll that pane
5. when the node-list pane is focused, `j` / `k` and arrow keys move across workflow nodes
6. `enter` or `ctrl-m` from the node-list pane opens a scrollable popup that shows the selected node's definition
7. the node-definition popup closes with `esc` or `q` and returns focus to the node-list pane
8. `l` opens the workflow-history screen for the same workflow
9. `n` opens the new-run screen for the same workflow
10. `h` returns to the workspace screen

#### New Workflow Run Screen

Shown from the workspace screen via `n`, from the workflow-definition screen via `n`, or from the workflow-history screen via `n`.

Layout:

- Top-left pane: compact workflow summary showing workflow description plus one-line node purposes
- Top-right pane: concise execution status for the newly launched workflow session
- Bottom input area: enlarged workflow input editor that gets the majority of the vertical space on this screen

Behavior:

1. when the screen opens, the input editor is focused immediately
2. the operator types plain text or JSON depending on detected workflow input mode
3. `enter` or `ctrl-m` from this screen opens a confirmation popup instead of dispatching immediately
4. confirming the popup starts the workflow and returns the new `sessionId` immediately to the TUI
5. the right pane polls runtime session state and log summaries while the workflow is running
6. the right pane must show both intermediate progress and final result data when available
7. `l` jumps from the new-run screen into the workflow-history screen for the same workflow
8. `h` returns to the workspace screen

### Human Input Handling

The current TUI does not wait for a runtime pause before collecting input. Instead:

1. entering the workflow-history, workflow-definition, or new-run screen inspects workflow and input-node payloads as needed for that screen
2. the editor defaults to `text` or `json` mode based on structured `human-input` hints
3. the operator can edit the input buffer at any time
4. the workflow-history screen can open the new-run screen with `n`
5. the new-run screen launches a new run only after explicit confirmation
6. `R` reruns from the selected node execution
7. `u` resumes the selected workflow session
8. interactive `--resume-session <id>` preselects the target session instead of bypassing the full-screen TUI; non-interactive and OpenTUI-unavailable fallback paths still resume immediately rather than degrading to a generic workflow prompt
9. when a workflow run is focused, pressing `l` moves focus to nodes; selecting a node shows its input/output-oriented details in the lower pane
10. within the workflow-history screen, `h` and `l` act as an inverse left/right pair across the workflow-run and node panes
11. when the node-detail pane is focused, `j` / `k` continue operating within that pane: summary mode moves across detail items, while inbox/outbox/log/message views scroll the active detail body
12. opening the full JSON/message viewer from node detail must keep node detail as the active pane; the viewer is an in-pane inspection state, not a focus transfer
13. when the selected node belongs to a subworkflow, pressing `l` from the node pane opens that subworkflow scope; within the nested scope, `l` moves from workflow nodes to workflow list and opens the selected child subworkflow from the workflow-list pane
14. within a nested subworkflow scope, `h` returns from workflow list to workflow nodes, and from workflow nodes to the immediate parent workflow-history scope

Runtime-variable mapping:

- text mode writes string values to `humanInput`, `prompt`, and `userPrompt`
- json mode writes structured values to `humanInput`, `promptJson`, and `userPromptJson`
- rerun actions also write `rerunPrompt`, plus `rerunManagerSessionId` when the selected node is a manager node

JSON-editor expectations:

- when a workflow definition implies structured human input, the editor starts in `json` mode
- the input area must accept raw JSON objects, not only plain text
- JSON mode must expose syntax validity in the status area
- JSON mode must support formatting the current buffer
- run and rerun actions must reject invalid JSON before dispatch
- when reopening a historical JSON-oriented session, the editor should prefer structured runtime values such as `promptJson` or `userPromptJson`

## Data and Artifact Integration

Per-node execution output location:

- `{DIVEDRA_ARTIFACT_DIR}/workflow/{workflow_id}/executions/{workflowExecutionId}/nodes/{nodeId}/{nodeExecId}/` (default root under `~/.divedra/project/<cwd-encoded>/divedra-artifact/`)

TUI behavior:

- displays active artifact directory for the selected node execution
- summarizes `input.json`, `output.json`, `meta.json`, mailbox `inbox/input.json`, mailbox `inbox/meta.json`, and mailbox `outbox/output.json`
- loads manager-session records from the manager-session store for manager nodes
- loads node execution and session log summaries from the runtime DB
- never mutates historical `output.json`; only appends new runs
- uses a readline selector fallback only when OpenTUI cannot be loaded; `--resume-session` preserves direct-resume semantics because readline mode cannot represent a preselected historical session; ordinary TUI logic errors must surface as failures instead of being silently downgraded
- when OpenTUI is available, workflow selection happens inside the workspace screen of the unified app rather than through a separate pre-app selector surface

## Keybindings (Initial)

Each primary screen shows a single-line footer shortcut row summarizing the screen-level keys below the main panes.

### Workspace Screen

- `j` / `k`: move selection
- `/`: open workflow filter popup
- `y`: copy the highlighted workflow id
- `?`: open help popup
- `enter` / `ctrl-m` / `l`: open the highlighted workflow in the workflow-definition screen
- `n`: open the highlighted workflow in the new-run screen
- `r`: refresh workflow list
- `q`: quit

### Workflow Definition Screen

- `j` / `k`: scroll the workflow-definition pane when it is focused, or move selection within the node-list pane when nodes are focused
- `tab` / `shift-tab`: cycle focus between workflow definition and nodes
- `enter` / `ctrl-m`: from nodes, open the selected node-definition popup
- `y`: copy the selected workflow id
- `l`: open the workflow-history screen for the current workflow
- `n`: open the new-run screen for the current workflow
- `h`: return to the workspace screen
- `r`: refresh workflow definition and cached workflow state
- `?`: open help popup
- `q`: quit

### Workflow History Screen

- `j` / `k`: move selection within the focused pane
- when the node-detail pane is focused, `j` / `k` and arrow keys stay local to that pane; summary mode moves across detail items, and non-summary detail views scroll the active body
- `tab` / `shift-tab`: cycle focus across sessions, nodes, node detail, and input
- `enter` / `ctrl-m`: from workflow runs, load the selected run and focus node detail; from nodes, focus node detail; from node detail summary, open the selected JSON/message view or AI agent session popup; from input, begin input editing
- `y`: copy the focused entity id (`workflow runs` copies `sessionId`; `nodes` copies `nodeExecId`; nested workflow nodes copy `nodeId`; nested workflow list copies `subworkflowId`)
- `l`: when the workflow-run pane is focused, move focus into nodes; when a selected node row belongs to a subworkflow, open that nested subworkflow scope; within a nested scope, move from workflow nodes to workflow list, or open the selected child subworkflow from the workflow-list pane
- `h`: when the node pane is focused, move focus back to workflow runs; within a nested subworkflow scope, move from workflow list to workflow nodes, or from workflow nodes back to the immediate parent scope
- `esc`: when node detail is focused, return focus to the pane that opened it
- when node detail is focused, pane-local keys stay active and `tab` / `shift-tab` continue the history-pane cycle; history-wide shortcuts such as `h` and `l` are ignored there
- in-pane viewers and popups opened from node detail must preserve node detail's existing parent pane so closing them does not change where `esc` returns next
- `n`: open the new-run screen for the current workflow
- `R`: rerun from the selected node execution
- `u`: resume the selected workflow session
- `d`: when workflow runs are focused, open a delete-history confirmation popup for the selected run; block the action while the selected session is `running` or `paused`; confirm with `enter` or `ctrl-m`, cancel with `esc`
- `D`: when workflow runs are focused, open a workflow history `delete-all` confirmation popup for the current workflow; block the action while any session is `running` or `paused`
- `m`: toggle input mode between text and JSON
- `f`: format JSON input when JSON mode is active
- `i` / `o` / `g` / `a` / `s`: show inbox, outbox, session logs, manager messages, or summary
- `?`: open help popup
- `h`: when workflow runs are focused, return to the workspace screen
- `r`: refresh workflow/session/runtime state
- `q`: quit

### New Workflow Run Screen

- input focus is active on entry
- `enter` / `ctrl-m`: open the confirmation popup for launch
- `m`: toggle input mode between text and JSON
- `f`: format JSON input when JSON mode is active
- `l`: open the workflow-history screen for the same workflow
- `h`: return to the workspace screen
- `r`: refresh workflow preview and current run-status pane
- `?`: open help popup
- `q`: quit

### Popups

- workflow filter popup: opened by `/`, applied by `enter` or `ctrl-m`, cancelled by `esc`
- help popup: opened by `?`, closed by `q`
- run confirmation popup: opened by `enter` or `ctrl-m` on the new-run screen, confirmed by `enter` or `ctrl-m`, cancelled by `esc`
- history delete confirmation popup: opened by `d` from the workflow-runs pane, confirmed by `enter` or `ctrl-m` as `yes`, cancelled by `esc`
- workflow history delete-all confirmation popup: opened by `D` from the workflow-runs pane, confirmed by `enter` or `ctrl-m` as `yes`, cancelled by `esc`
- workflow node-definition popup: opened by `enter` or `ctrl-m` from the workflow-definition node list, scrollable with `j` / `k` or arrows, and closed by `esc` or `q`
- node-detail JSON/message viewer: opened by `enter` or `ctrl-m` from node-detail summary as an in-pane detail state and must not steal active-pane status from node detail
- node-detail AI agent session popup: when the selected summary row points at a persisted `codex-agent` or `claude-code-agent` session, `enter` or `ctrl-m` opens a scrollable popup showing that stored chat history; the popup stays tied to node detail and closes with `esc` or `q`

## Failure and Recovery

- On terminal resize: relayout without dropping execution state.
- On non-interactive terminal: fallback to plain prompt mode with same engine.
- On TUI crash: session remains recoverable through `session resume` or `divedra tui --resume-session`.

## Implementation Notes

- Runtime: Bun
- Language: TypeScript strict mode
- UI adapter boundary: isolate direct `@opentui/core` usage in one module so replacement cost stays low.
- Do not duplicate workflow logic in the TUI; it consumes workflow definitions, session snapshots, runtime DB summaries, and mailbox artifacts exposed by existing runtime modules.

## References

- Bun runtime docs: https://bun.sh/docs
- OpenTUI package: https://www.npmjs.com/package/@opentui/core
- Ink package: https://www.npmjs.com/package/ink
- Bun + Ink compatibility issue: https://github.com/oven-sh/bun/issues/6862
