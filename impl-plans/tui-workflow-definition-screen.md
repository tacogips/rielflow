# TUI Workflow Definition Screen Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-tui.md#workflow-definition-screen
**Created**: 2026-03-26
**Last Updated**: 2026-03-26

## Related Plans

- **Previous**: `impl-plans/tui-workflow-browser-and-json-input.md`
- **Depends On**: `impl-plans/tui-workflow-browser-and-json-input.md`

## Design Document Reference

**Source**:

- `design-docs/specs/design-tui.md`

### Summary

Add a workflow-definition inspection screen between the workspace selector and the existing history/new-run flows. The new screen should:

- open from the workspace on `enter`, `ctrl-m`, or `l`,
- show workflow-level definition details in the top pane,
- show workflow nodes in the bottom pane,
- open a popup with the selected node's definition on `enter` or `ctrl-m`,
- preserve the existing history and new-run screens as deeper follow-up flows.

### Scope

**Included**:

- new OpenTUI screen state and view wiring for workflow-definition inspection
- workflow-definition and node-definition formatting helpers
- node-definition popup handling and focus/escape behavior
- focused regression coverage for the new screen model and popup routing

**Excluded**:

- workflow execution/history semantics beyond the navigation entrypoint changes
- web UI changes

## Modules

### 1. Workflow Definition Screen

#### `src/tui/opentui-screen.ts`, `src/tui/opentui-model.ts`, `src/tui/opentui-solid-app.tsx`, `src/tui/components/*.tsx`

**Status**: COMPLETED

**Checklist**:

- [x] Workspace `enter` / `ctrl-m` / `l` open the workflow-definition screen
- [x] Workflow-definition screen renders top workflow detail and bottom node list
- [x] Definition screen navigation honors the repository TUI guardrails
- [x] `l`, `h`, and `n` route to history, workspace, and new-run correctly

### 2. Node Definition Popup

#### `src/tui/opentui-screen.ts`, `src/tui/opentui-model.ts`, `src/tui/components/PopupLayer.tsx`

**Status**: COMPLETED

**Checklist**:

- [x] Node popup shows the selected node's definition
- [x] Popup scrolls with `j` / `k` and arrows
- [x] Popup closes with `esc` / `q` and returns to the node-list pane

### 3. Regression Coverage

#### `src/tui/opentui-screen.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Screen-mode helpers cover the new workflow-definition state
- [x] Popup helper coverage includes the node-definition popup
- [x] Help text coverage reflects the new keybinding contract

## Tasks

### TASK-001: Add the workflow-definition screen and navigation model

**Status**: Completed
**Parallelizable**: No

**Deliverables**:

- `src/tui/opentui-screen.ts`
- `src/tui/opentui-model.ts`
- `src/tui/opentui-solid-app.tsx`
- `src/tui/components/WorkflowDefinitionScreen.tsx`

**Completion Criteria**:

- [x] Workspace selection opens workflow-definition instead of history/new-run on `enter` / `ctrl-m`
- [x] Definition screen exposes workflow detail and node list panes
- [x] Definition screen can open history and new-run without losing the selected workflow context

### TASK-002: Add node-definition popup rendering and behavior

**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-001

**Deliverables**:

- `src/tui/components/PopupLayer.tsx`
- `src/tui/opentui-screen.ts`
- `src/tui/opentui-model.ts`

**Completion Criteria**:

- [x] Selected nodes open a popup with node-definition content
- [x] Popup uses repository-consistent close and scroll behavior

### TASK-003: Update regression coverage and verification

**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-001, TASK-002

**Deliverables**:

- `src/tui/opentui-screen.test.ts`

**Completion Criteria**:

- [x] Helper tests cover the definition screen and popup state
- [x] `bun test src/tui/opentui-screen.test.ts` passes
- [x] `bun run typecheck` passes

## Progress Log

### Session: 2026-03-26 23:30 JST

**Tasks Completed**: Plan creation, design-contract update
**Tasks In Progress**: TASK-001, TASK-002, TASK-003
**Blockers**: None
**Notes**: The existing TUI already separates workspace, history, and run screens, so the cleanest path is to add a dedicated workflow-definition screen between workspace and history/new-run rather than overloading the runtime-oriented history screen. The node-definition viewer will be implemented as a popup tied to that definition screen.

### Session: 2026-03-26 23:55 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added a new workflow-definition screen to the OpenTUI app, changed workspace `enter`/`ctrl-m`/`l` to open that screen, added a scrollable node-definition popup, and updated the screen-model helpers plus focused tests for the new navigation and popup contract. Verified with `bun test src/tui/opentui-screen.test.ts src/tui/opentui-controller.test.ts`, `bun run typecheck`, and `git diff --check`.
