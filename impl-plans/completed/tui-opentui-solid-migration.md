# TUI OpenTUI Solid Migration Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-tui.md`, `design-docs/specs/command.md`
**Created**: 2026-03-25
**Last Updated**: 2026-03-26

## Design Document Reference

**Source**: `design-docs/specs/design-tui.md`, `design-docs/specs/command.md`

### Summary

Replace the current imperative `@opentui/core` TUI screen implementation with an `@opentui/solid` implementation while preserving the existing `divedra tui` behavior contract: screen model, focus rules, keybindings, resume/fallback semantics, runtime-variable editing, and CLI integration.

This plan treats `@opentui/solid` as a view-layer refactor on top of the existing OpenTUI renderer, not as a product-scope expansion and not as a browser-UI reintroduction.

Current reassessment:

- the Solid view-layer cutover is real and working
- the interactive CLI now routes directly into the unified workspace/history/run app, so the old selector-only OpenTUI path is obsolete and must stay removed
- reusable workflow preview/header helpers now live in `src/tui/opentui-model.ts`
- mailbox/artifact-backed node-detail content loading and history-detail pane state assembly now live in `src/tui/opentui-detail-content.ts`
- `src/tui/opentui-screen.ts` remains stateful because it owns renderer refs, focus/key routing, and popup/runtime orchestration, but it no longer duplicates the extracted preview/detail-content builders
- the workflow-history header now omits empty workflow descriptions so the TUI stays aligned with the latest optional-description workflow schema
- local CLI/TUI/API execution now infers `rootDataDir` from explicit artifact/session roots when possible so runtime-db writes stay co-located with the selected storage tree during migration verification
- history-mode `tab` / `shift-tab` cycling now consistently traverses sessions, nodes, node detail, and input; detail no longer acts like a one-way trap in the keyboard focus loop

### Scope

**Included**:

- repository dependency and TypeScript config changes required for `@opentui/solid` and `.tsx`
- extraction of framework-neutral TUI state, navigation, and action orchestration from the current monolithic screen file
- Solid componentization of workspace, workflow-history, new-run, popup, and node-detail surfaces
- preservation of current CLI entrypoints, runtime selection rules, and fallback behavior
- TUI help text, design-doc, and tests needed to keep navigation behavior aligned with repository guardrails

**Excluded**:

- workflow runtime or GraphQL behavior changes
- new TUI product features beyond parity-preserving cleanup needed for the migration
- reintroduction of the removed browser UI
- replacing OpenTUI itself with another terminal renderer

## Task Breakdown

### TASK-001: Tooling and Framework Boundary Preparation

**Status**: COMPLETED
**Parallelizable**: No
**Depends On**: None
**Deliverables**:

- `package.json`
- `bunfig.toml`
- `tsconfig.json`
- `src/tui/opentui-screen.ts`
- `src/cli.ts`
  **Completion Criteria**:
- [x] `@opentui/solid`, `solid-js`, and any required JSX tooling dependencies are declared directly in `package.json`
- [x] `bunfig.toml` preloads `@opentui/solid/preload` for the interactive TUI runtime
- [x] TypeScript configuration includes `.tsx` sources and Solid JSX settings without weakening strictness
- [x] the public TUI entry surface remains stable for `src/cli.ts`
- [x] missing-package fallback detection handles both `@opentui/core` and `@opentui/solid` availability failures

### TASK-002: Framework-Neutral State and Action Extraction

**Status**: COMPLETED
**Parallelizable**: No
**Depends On**: `TASK-001`
**Deliverables**:

- `src/tui/opentui-model.ts`
- `src/tui/opentui-controller.ts`
- `src/tui/opentui-detail-content.ts`
- `src/tui/opentui-screen.ts`
  **Completion Criteria**:
- [x] screen state, navigation state, popup state, and derived pane chrome are represented in framework-neutral types
- [x] workflow execution, rerun, resume, refresh, copy, and JSON-format actions are exposed as controller actions rather than inline UI event bodies
- [x] helper functions currently covered by `src/tui/opentui-screen.test.ts` remain reusable from non-UI modules where practical
- [x] imperative renderer coordination is reduced to a thin host layer

### TASK-003: Solid Screen and Pane Port

**Status**: COMPLETED
**Parallelizable**: Yes
**Depends On**: `TASK-002`
**Deliverables**:

- `src/tui/opentui-solid-app.tsx`
- `src/tui/components/WorkspaceScreen.tsx`
- `src/tui/components/WorkflowHistoryScreen.tsx`
- `src/tui/components/NewRunScreen.tsx`
- `src/tui/components/NodeDetailPane.tsx`
- `src/tui/components/PopupLayer.tsx`
  **Completion Criteria**:
- [x] workspace, workflow-history, and new-run screens render through `@opentui/solid`
- [x] node detail, viewer state, and popup rendering stay in-pane and preserve existing focus semantics
- [x] focused-pane rendering rules remain aligned with `design-tui.md`
- [x] keyboard interactions preserve `enter`/`ctrl-m`, `h`/`l`, and `esc` symmetry required by the TUI guardrails

### TASK-004: OpenTUI Host and CLI Integration Cutover

**Status**: COMPLETED
**Parallelizable**: No
**Depends On**: `TASK-003`
**Deliverables**:

- `src/tui/opentui-screen.ts`
- `src/cli.ts`
- `src/tui/runtime.ts`
  **Completion Criteria**:
- [x] `runOpenTuiWorkflowApp()` is the single interactive OpenTUI entry surface used by the CLI contract
- [x] interactive and fallback runtime selection remains unchanged
- [x] refresh, copy, and long-running execution updates work correctly through the Solid host
- [x] CLI tests do not need a new command surface to exercise the migrated TUI

### TASK-005: Navigation Parity and Help-Text Hardening

**Status**: COMPLETED
**Parallelizable**: Yes
**Depends On**: `TASK-002`
**Deliverables**:

- `src/tui/opentui-screen.ts`
- `src/tui/opentui-screen.test.ts`
- `design-docs/specs/design-tui.md`
  **Completion Criteria**:
- [x] visible help text matches the migrated key handling
- [x] tests cover focused-pane rendering rules, drill-down behavior, and reverse-navigation invariants
- [x] the design doc replaces the current `@opentui/core`-only implementation description with an explicit `@opentui/core` host plus `@opentui/solid` view-layer boundary
- [x] the design doc preserves current navigation and fallback semantics while documenting the new implementation stack

### TASK-006: Verification and Repository Alignment

**Status**: COMPLETED
**Parallelizable**: No
**Depends On**: `TASK-004`, `TASK-005`
**Deliverables**:

- `src/tui/opentui-screen.test.ts`
- `src/tui/opentui-controller.test.ts`
- `src/tui/runtime.test.ts`
- `src/cli.test.ts`
- `README.md`
  **Completion Criteria**:
- [x] focused TUI, CLI, and runtime tests pass against the migrated implementation
- [x] `bun run typecheck` passes with `.tsx` sources included
- [x] README references to the current TUI implementation are accurate
- [x] migration notes call out any residual imperative host code that remains intentionally unported

## Modules

### 1. Tooling and Public Entry Surface

#### `package.json`, `bunfig.toml`, `tsconfig.json`, `src/tui/opentui-screen.ts`, `src/cli.ts`

**Status**: COMPLETED

```typescript
export interface OpenTuiWorkflowActionResult {
  readonly exitCode: number;
  readonly sessionId: string;
  readonly status: WorkflowSessionState["status"];
}

export interface OpenTuiWorkflowExecutionHandle {
  readonly sessionId: string;
  readonly completion: Promise<OpenTuiWorkflowActionResult>;
}

export interface OpenTuiWorkflowAppOptions {
  readonly initialWorkflowName?: string;
  readonly initialSessionId?: string;
  readonly io: CliIo;
  readonly workflowNames: readonly string[];
  readonly refreshWorkflowNames: () => Promise<readonly string[]>;
  readonly loadWorkflowDefinition: (
    workflowName: string,
  ) => Promise<LoadedWorkflow>;
  readonly listWorkflowSessions: (
    workflowName: string,
  ) => Promise<readonly RuntimeSessionSummary[]>;
  readonly loadRuntimeSessionView: (
    sessionId: string,
  ) => Promise<RuntimeSessionView>;
  readonly loadManagerSessionMessages: (
    managerSessionId: string,
  ) => Promise<readonly ManagerMessageRecord[]>;
  readonly loadAgentSessionTranscript: (input: {
    readonly backend: CliAgentBackend;
    readonly sessionId: string;
  }) => Promise<AgentSessionTranscript>;
  readonly executeWorkflow: (input: {
    readonly workflowName: string;
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
  }) => Promise<OpenTuiWorkflowExecutionHandle>;
  readonly rerunWorkflow: (input: {
    readonly sourceSessionId: string;
    readonly fromNodeId: string;
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
  }) => Promise<OpenTuiWorkflowActionResult>;
  readonly resumeWorkflow: (
    sessionId: string,
  ) => Promise<OpenTuiWorkflowActionResult>;
}
```

**Checklist**:

- [x] add Solid/OpenTUI dependencies without reintroducing browser-only tooling
- [x] add the required OpenTUI Solid preload hook in `bunfig.toml`
- [x] extend root TypeScript config to include `.tsx` and Solid JSX settings
- [x] preserve the exported workflow-app function signatures used by CLI tests
- [x] keep dependency-availability fallback logic aligned with the current CLI behavior

### 2. Framework-Neutral Screen Model and Controller

#### `src/tui/opentui-model.ts`, `src/tui/opentui-controller.ts`, `src/tui/opentui-detail-content.ts`

**Status**: COMPLETED

```typescript
export type TuiScreenMode = "workspace" | "history" | "run";

export type FocusPane = "detail" | "input" | "nodes" | "sessions" | "workflows";

export type DetailMode =
  | "inbox"
  | "manager"
  | "outbox"
  | "session-logs"
  | "summary"
  | "viewer";

export interface TuiPopupState {
  readonly filterOpen: boolean;
  readonly helpOpen: boolean;
  readonly runConfirmationOpen: boolean;
}

export interface TuiScreenState {
  readonly screenMode: TuiScreenMode;
  readonly focusPane: FocusPane;
  readonly detailMode: DetailMode;
  readonly selectedWorkflowIndex: number;
  readonly selectedSessionIndex: number;
  readonly selectedNodeIndex: number;
  readonly workflowFilter: string;
  readonly popup: TuiPopupState;
}

export interface TuiScreenController {
  readonly focusNextPane: () => void;
  readonly focusPreviousPane: () => void;
  readonly moveSelectionDown: () => void;
  readonly moveSelectionUp: () => void;
  readonly openFocusedTarget: () => Promise<void>;
  readonly escapeFocusedTarget: () => Promise<void>;
  readonly refreshCurrentView: () => Promise<void>;
  readonly toggleInputMode: () => Promise<void>;
}
```

**Checklist**:

- [x] define framework-neutral screen, focus, detail, and popup state
- [x] move action orchestration into controller methods with explicit async boundaries
- [x] keep derived breadcrumb, pane chrome, and copy-target helpers outside component bodies
- [x] make `src/tui/opentui-screen.ts` consume the extracted model/controller helpers instead of maintaining duplicate implementations
- [x] move workflow preview/header builders and artifact-backed node-detail content loading behind reusable non-host modules
- [x] keep history-detail summary/viewer/detail state assembly behind reusable non-host modules
- [x] separate action/state tests from renderer-specific assertions

### 3. Solid Screen Composition

#### `src/tui/opentui-solid-app.tsx`, `src/tui/components/*.tsx`

**Status**: COMPLETED

```typescript
export interface OpenTuiSolidAppProps {
  readonly options: OpenTuiWorkflowAppOptions;
  readonly controller: TuiScreenController;
  readonly state: TuiScreenState;
}

export interface WorkspaceScreenProps {
  readonly state: TuiScreenState;
  readonly workflowNames: readonly string[];
}

export interface WorkflowHistoryScreenProps {
  readonly state: TuiScreenState;
  readonly loadedWorkflow?: LoadedWorkflow;
  readonly sessionView?: RuntimeSessionView;
}

export interface NewRunScreenProps {
  readonly state: TuiScreenState;
  readonly loadedWorkflow?: LoadedWorkflow;
  readonly pendingExecution?: OpenTuiWorkflowExecutionHandle;
}

export interface PopupLayerProps {
  readonly state: TuiScreenState;
}
```

**Checklist**:

- [x] split the monolithic screen into Solid components by screen and pane responsibility
- [x] keep long-scroll detail viewers and popups in dedicated components
- [x] ensure focused and blurred list rendering matches the current UX contract
- [x] keep component props typed through explicit OpenTUI ref interfaces while framework-neutral model/controller helpers stay outside component bodies

### 4. Host Runtime and Input Wiring

#### `src/tui/opentui-screen.ts`, `src/tui/runtime.ts`, `src/cli.ts`

**Status**: COMPLETED

```typescript
export interface OpenTuiHostRuntime {
  readonly runWorkflowApp: (
    options: OpenTuiWorkflowAppOptions,
  ) => Promise<number>;
}

export interface TuiRuntimeSelection {
  readonly mode: "interactive" | "fallback";
  readonly reason:
    | "resume-session"
    | "interactive-terminal"
    | "non-interactive-terminal";
  readonly requiresWorkflowArgument: boolean;
}
```

**Checklist**:

- [x] keep the CLI-facing TUI runtime boundary stable
- [x] keep non-interactive fallback behavior unchanged
- [x] preserve current startup selection behavior for `--workflow` and `--resume-session`
- [x] ensure renderer teardown and async completion handling remain explicit and leak-free

### 5. Verification and Documentation

#### `src/tui/opentui-screen.test.ts`, `src/tui/runtime.test.ts`, `src/cli.test.ts`, `design-docs/specs/design-tui.md`, `README.md`

**Status**: COMPLETED

```typescript
export interface TuiVerificationCommandSet {
  readonly typecheck: "bun run typecheck";
  readonly tuiTests: "bun test src/tui/opentui-screen.test.ts src/tui/runtime.test.ts";
  readonly cliTests: "bun test src/cli.test.ts";
}
```

**Checklist**:

- [x] extend tests for navigation and parity-sensitive behavior
- [x] keep CLI tests validating fallback behavior when OpenTUI packages are unavailable
- [x] update `design-tui.md` to describe the current implementation stack accurately
- [x] update README language only where it reflects the active TUI implementation

## Module Status

| Module                                        | File Path                                                                                 | Status    | Tests                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------ |
| Tooling and public entry surface              | `package.json`, `bunfig.toml`, `tsconfig.json`, `src/tui/opentui-screen.ts`, `src/cli.ts` | COMPLETED | `bun test src/cli.test.ts`                                                                             |
| Framework-neutral screen model and controller | `src/tui/opentui-model.ts`, `src/tui/opentui-controller.ts`, `src/tui/opentui-detail-content.ts` | COMPLETED | `bun test src/tui/opentui-controller.test.ts src/tui/opentui-screen.test.ts`                          |
| Solid screen composition                      | `src/tui/opentui-solid-app.tsx`, `src/tui/components/*.tsx`                               | COMPLETED | `bun test src/tui/opentui-screen.test.ts`                                                              |
| Host runtime and input wiring                 | `src/tui/opentui-screen.ts`, `src/tui/runtime.ts`, `src/cli.ts`                           | COMPLETED | `bun test src/tui/runtime.test.ts src/cli.test.ts`                                                     |
| Verification and documentation                | `src/tui/opentui-controller.test.ts`, `src/tui/opentui-screen.test.ts`, `design-docs/specs/design-tui.md`, `README.md` | COMPLETED | `bun run typecheck`, `bun test src/tui/opentui-controller.test.ts src/tui/opentui-screen.test.ts src/tui/runtime.test.ts src/cli.test.ts` |

## Dependencies

| Feature                                       | Depends On                         | Status    |
| --------------------------------------------- | ---------------------------------- | --------- |
| Tooling and framework boundary preparation    | Current OpenTUI TUI implementation | COMPLETED |
| Framework-neutral state and action extraction | TASK-001                           | COMPLETED |
| Solid screen and pane port                    | TASK-002                           | COMPLETED |
| OpenTUI host and CLI integration cutover      | TASK-003                           | COMPLETED |
| Navigation parity and help-text hardening     | TASK-002                           | COMPLETED |
| Verification and repository alignment         | TASK-004, TASK-005                 | COMPLETED |

## Completion Criteria

- [x] the checked-in interactive TUI uses `@opentui/solid` rather than direct imperative screen composition as the primary view layer
- [x] CLI command behavior and fallback semantics remain backward compatible
- [x] focused-pane rendering, drill-down navigation, and keybinding symmetry remain aligned with repository TUI guardrails
- [x] typecheck and targeted TUI/CLI tests pass with `.tsx` sources included
- [x] `design-tui.md` and README accurately describe the migrated TUI implementation
- [x] the remaining imperative host responsibilities are documented as renderer/runtime orchestration rather than leftover duplicated preview/detail-content glue

## Progress Log

### Session: 2026-03-26 20:40

**Tasks Completed**: Completed-plan review follow-up, repository-command alignment
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-reviewed the completed Solid/OpenTUI migration against the current post-web-UI-removal tree and found one remaining repository-alignment regression outside the runtime tests: `package.json` still hard-coded `scripts/**/*.mjs` in the Prettier commands even though the remaining checked-in script surface is shell-based, so `bun run format:check` failed before it could report actual style drift. Switched the format commands to `--ignore-unknown` over `scripts/**/*` so the command remains valid through the Solid/TUI-only layout. Re-verified `bun run typecheck`, `bun test src/tui/opentui-controller.test.ts src/tui/opentui-screen.test.ts src/tui/runtime.test.ts src/cli.test.ts`, and `git diff --check`; all passed. `bun run format:check` now reaches real repository formatting drift instead of failing on a missing-glob configuration error.

### Session: 2026-03-26 21:35

**Tasks Completed**: Completed-plan review follow-up, history-pane focus-cycle hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-reviewed the completed Solid/OpenTUI migration against the checked-in focus helpers and found a real parity bug: the history focus-cycle helper already modeled `tab` / `shift-tab` as `sessions -> nodes -> detail -> input`, but the detail-pane key gate still rejected `tab`, so once focus entered node detail the keyboard cycle became asymmetric. Allowed `tab` through the detail key gate, updated help text plus `design-tui.md` to document the actual four-pane cycle, and expanded `src/tui/opentui-screen.test.ts` so the focus-cycle and help-text contract are both asserted directly. Re-verified with `bun run typecheck`, `bun test src/tui/opentui-screen.test.ts src/tui/opentui-controller.test.ts src/tui/runtime.test.ts src/cli.test.ts`, `bun run build`, and full `bun test`.

### Session: 2026-03-26 01:42

**Tasks Completed**: Completed-plan review verification and plan-index cleanup
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-reviewed the completed Solid/OpenTUI migration against the current architecture/design intent and did not find a new mismatch that warrants reopening scope. Re-ran `bun run typecheck`, `bun test src/tui/opentui-screen.test.ts src/tui/runtime.test.ts src/cli.test.ts`, `bun run build`, `bun test`, and `git diff --check`; all passed. Corrected implementation-plan bookkeeping so `impl-plans/PROGRESS.json` no longer reports phase 71 as completed while `workflow-role-unification` is still in progress, and refreshed `impl-plans/README.md` so phase 71 includes the already-completed `tui-workflow-browser-and-json-input` dependency that this migration actually builds on.

### Session: 2026-03-26 15:20

**Tasks Completed**: Completed-plan review follow-up
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-reviewed the completed Solid migration against the latest workflow-schema change that makes `workflow.description` optional. Updated the TUI header helper and tests so empty descriptions no longer consume a blank line, aligned `design-tui.md` with that optional-field behavior, and re-ran `bun run typecheck`, `bun run build`, and full `bun test` so the migration record no longer depends on the earlier historical runtime-db blocker.

### Session: 2026-03-26 14:10

**Tasks Completed**: Verification closeout
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-ran the migration verification from the checked-in plan state and confirmed the Solid/OpenTUI cutover still matches the intended TUI architecture: focused TUI/CLI tests and `bun run typecheck` all pass, and the interactive CLI still enters the unified workspace/history/run app directly. Broadened verification to `bun test`, found the previously documented unrelated SQLite collision in `src/workflow/runtime-db.test.ts`, and fixed the test harness to use an explicit per-test `rootDataDir` so host `DIVEDRA_ARTIFACT_DIR` environment settings no longer leak into runtime-db path resolution. Updated `impl-plans/README.md` so the migration is indexed as completed and phase 72 now matches the plan/`PROGRESS.json` state.

### Session: 2026-03-26 12:20

**Tasks Completed**: TASK-002 closeout, TASK-006 closeout
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-reviewed the post-cutover host boundary against the updated design and found the main remaining mismatch was duplicated preview/detail-content assembly inside `src/tui/opentui-screen.ts`. Extracted reusable workflow preview/header builders into `src/tui/opentui-model.ts`, added `src/tui/opentui-detail-content.ts` for mailbox/artifact-backed node-detail loading, rewired the host to consume those modules, and reduced the checked-in host surface by another ~450 lines without changing the CLI/TUI contract. Updated README and design/architecture docs so the repository now describes the remaining imperative host responsibilities accurately as renderer/focus/popup/runtime orchestration rather than leftover presentation/data-loading glue. Verified with `bun run typecheck` and `bun test src/tui/opentui-screen.test.ts src/tui/runtime.test.ts src/cli.test.ts`.

### Session: 2026-03-26 14:30

**Tasks Completed**: Completed-plan review hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-checked the completed Solid/OpenTUI migration against the current worktree and did not find a new design mismatch that requires reopening the plan. I did find one remaining thin-host cleanup item: `src/tui/opentui-screen.ts` still duplicated the empty-select sentinel plus sub-workflow and latest-node-execution helpers already embodied in the framework-neutral model layer. Consolidated those helpers into `src/tui/opentui-model.ts`, refreshed the architecture doc to describe the thinner host boundary accurately, and re-verified with `bun run typecheck`, `bun test src/tui/opentui-screen.test.ts src/tui/runtime.test.ts src/cli.test.ts`, `bun run build`, `bun run test`, and `git diff --check`.

### Session: 2026-03-26 17:05

**Tasks Completed**: Post-completion storage-root alignment fix and regression coverage
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-reviewed the completed Solid/OpenTUI migration against the full repository test run and found a remaining runtime-boundary bug: explicit `--artifact-root` and `--session-store` paths did not also realign `rootDataDir`, so `divedra.db` could still drift to an ambient `DIVEDRA_ARTIFACT_DIR` during CLI/TUI/API execution. Added shared inference for explicit storage roots, wired the CLI and API entrypoints to use it, documented the corrected architecture, and added regression coverage so full-suite verification no longer depends on the ambient dev-shell runtime-data path.

### Session: 2026-03-26 10:30

**Tasks Completed**: TASK-002, TASK-003, TASK-004, TASK-005, TASK-006
**Tasks In Progress**: None
**Blockers**: Manual interactive smoke coverage remains outside the current automated test slice; the known unrelated full-suite `src/workflow/runtime-db.test.ts` SQLite collision still exists
**Notes**: Cut the TUI view tree over to `@opentui/solid` by adding `src/tui/opentui-solid-app.tsx`, `src/tui/components/*.tsx`, shared OpenTUI Solid wrapper components, and a shared focus-aware select renderable module. `src/tui/opentui-screen.ts` now mounts the Solid selector/app trees into the existing renderer and keeps the orchestration, focus, and keyboard logic at the host boundary. Resolved a Bun/OpenTUI package integration issue by compiling `.tsx` through the standard `solid-js` JSX runtime while continuing to render through `@opentui/solid`. Reviewed the migration against the TUI guardrails, fixed the spec/implementation mismatch for node-detail `j` / `k` handling, refreshed help text and docs, and verified with `bun run typecheck`, `bun test src/tui/opentui-screen.test.ts`, `bun test src/tui/runtime.test.ts`, and `bun test src/cli.test.ts`.

### Session: 2026-03-26 03:00

**Tasks Completed**: TASK-004 unified-entry cleanup, TASK-006 repo/doc alignment follow-up
**Tasks In Progress**: TASK-002, TASK-006
**Blockers**: `src/tui/opentui-screen.ts` still contains host-local presentation/data-loading glue beyond the intended thin-host boundary; manual interactive smoke coverage remains outside the current automated slice
**Notes**: Re-reviewed the post-cutover architecture and found that the CLI/runtime contract still carried an obsolete selector-only OpenTUI entry path even though interactive `divedra tui` already launches the unified workspace/history/run app. Removed that dead selector surface from the runtime/CLI contract, deleted the unused selector Solid view and selector layout test coverage, added a CLI regression test that asserts the unified app is the interactive entrypoint, and updated README/design/architecture/plan text so the repository now documents the real state: Solid is the active TUI view layer, readline remains only as the unavailable-OpenTUI fallback, and the remaining migration work is host-thinning rather than another surface-level cutover. Verified with `bun run typecheck`, `bun test src/tui/opentui-screen.test.ts`, `bun test src/tui/runtime.test.ts`, and `bun test src/cli.test.ts`.

### Session: 2026-03-26 00:00

**Tasks Completed**: TASK-002 partial extraction
**Tasks In Progress**: TASK-002
**Blockers**: None
**Notes**: Added `src/tui/opentui-model.ts` for reusable input, navigation, copy-target, pane-chrome, breadcrumb, node-row, and run-status helpers; added `src/tui/opentui-controller.ts` for run/rerun/resume/refresh/copy/input-format action orchestration; rewired `src/tui/opentui-screen.ts` to use the new controller for parity-sensitive actions and to source reopened input text through the extracted helper; updated `src/tui/opentui-screen.test.ts` so the reusable helper coverage exercises the extracted model module directly. Verified with `bun run typecheck` and `bun test src/tui/opentui-screen.test.ts src/tui/runtime.test.ts src/cli.test.ts`. Remaining TASK-002 work is to collapse more host-local mutable state into the framework-neutral controller/model so `src/tui/opentui-screen.ts` becomes a thinner renderer boundary before the `.tsx` cutover.

### Session: 2026-03-25 16:30

**Tasks Completed**: TASK-001
**Tasks In Progress**: None
**Blockers**: Full repository `bun test` still reproduces the pre-existing `src/workflow/runtime-db.test.ts` failure (`SQLiteError: table sessions already exists`), so the Solid migration verification remains focused on TUI/CLI slices for now
**Notes**: Reviewed the staged TUI/CLI diff before adding migration work and found a real boundary bug: `src/cli.ts` still statically imported the OpenTUI screen module even though fallback behavior was supposed to handle missing renderer packages. Fixed that by lazy-loading the screen module for interactive mode, expanded fallback detection to include both `@opentui/core` and `@opentui/solid`, installed the Solid runtime dependencies, enabled Bun preload plus Solid JSX settings, extended repo formatting/test discovery to future `.tsx` files, and updated design/README text so the checked-in architecture is described accurately. Verified with `bun run typecheck`, `bun test src/cli.test.ts src/tui/runtime.test.ts`, and `bun test src/tui/opentui-screen.test.ts`.

### Session: 2026-03-26 02:00

**Tasks Completed**: TASK-002 host/model consolidation
**Tasks In Progress**: TASK-002
**Blockers**: None
**Notes**: Reviewed the extracted TUI seam and found an architectural mismatch: `src/tui/opentui-model.ts` and `src/tui/opentui-controller.ts` already existed, but `src/tui/opentui-screen.ts` still carried its own copies of many pure helpers. Rewired the host to import the extracted helpers directly, centralized help-text assembly in the model, exported workflow-filter normalization for host reuse, and updated the focused tests to treat the model module as the authoritative helper surface. Corrected the plan status so TASK-003 stays `NOT_STARTED` until `.tsx` components actually exist. Verified with `bun run typecheck` and `bun test src/tui/opentui-screen.test.ts src/tui/runtime.test.ts src/cli.test.ts`.

### Session: 2026-03-25 00:00

**Tasks Completed**: Plan creation
**Tasks In Progress**: None
**Blockers**: No dedicated design doc exists yet for an `@opentui/solid` migration; `design-tui.md` and `command.md` remain the authoritative behavior contract
**Notes**: The current TUI is concentrated in `src/tui/opentui-screen.ts` and already uses `@opentui/core`, so this migration is scoped as a view-layer refactor with framework-neutral state/controller extraction before cutover; browser-UI concerns remain out of scope because that surface is removed

### Session: 2026-03-26 18:10

**Tasks Completed**: Completed-plan review follow-up, host-boundary hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-reviewed the completed Solid/OpenTUI migration against the current worktree and found one remaining navigation regression plus one last host-boundary cleanup worth landing without reopening scope. Fixed the in-pane AI agent session popup so it no longer overwrites node detail's existing return pane, which restores the `esc` immediate-parent rule after closing the popup. Added `src/tui/opentui-host-view.ts` so mounted-ref validation and pane-chrome application no longer live inline in `src/tui/opentui-screen.ts`, updated the TUI/architecture docs to describe that refined boundary, and added regression coverage for the detail-return status messaging. Verified with `bun run typecheck`, `bun test src/tui/opentui-screen.test.ts src/tui/runtime.test.ts src/cli.test.ts`, `bun run build`, `bun test`, and `git diff --check`.

### Session: 2026-03-26 19:00

**Tasks Completed**: Completed-plan review follow-up, controller-boundary hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-reviewed the completed Solid/OpenTUI migration against the latest commit and current worktree and did not find a new architecture/design mismatch that warrants reopening scope. I did find one verification gap inside the extracted host boundary: `src/tui/opentui-controller.ts` had become the primary action seam for the Solid/OpenTUI cutover, but it still lacked direct regression coverage, and its run-confirmation cleanup path could drop pending runtime variables even when workflow startup failed. Fixed the controller so pending confirmation state is only cleared after a successful start, added `src/tui/opentui-controller.test.ts` for run-confirmation and editor-text rehydration coverage, and re-verified with `bun run typecheck`, `bun run build`, `bun test src/tui/opentui-controller.test.ts src/tui/opentui-screen.test.ts src/tui/runtime.test.ts src/cli.test.ts`, full `bun test`, and `git diff --check`.

### Session: 2026-03-26 20:10

**Tasks Completed**: Completed-plan review follow-up, async-run failure cleanup hardening
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Performed another post-completion review against the current latest commit plus the in-progress migration diff and still did not find a design mismatch that requires reopening scope. I did find one controller regression that the previous focused tests missed: when a workflow run started successfully but its background completion promise later rejected, the extracted controller path no longer stopped the run-status polling loop, so the Solid/OpenTUI host could keep polling indefinitely after surfacing the failure. Added an explicit polling-stop callback to the controller seam, restored the failure cleanup path, and expanded `src/tui/opentui-controller.test.ts` with coverage for background completion rejection. Re-verified with `bun run typecheck`, `bun test src/tui/opentui-controller.test.ts src/tui/opentui-screen.test.ts src/tui/runtime.test.ts src/cli.test.ts`, full `bun test`, `bun run build`, and `git diff --check`.

### Session: 2026-03-26 21:10

**Tasks Completed**: Completed-plan archive alignment
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-reviewed the completed Solid/OpenTUI migration plan against the repository implementation-plan layout and found one bookkeeping inconsistency: the plan was already marked completed in `impl-plans/README.md` and `impl-plans/PROGRESS.json`, but the markdown file still lived at the top level of `impl-plans/` instead of the completed-plan archive. Archived the plan under `impl-plans/completed/` and updated the README phase mapping so repository bookkeeping matches the completed implementation state verified by `bun run typecheck`, `bun run build`, `bun test`, and `git diff --check`.

### Session: 2026-03-26 23:10

**Tasks Completed**: Completed-plan reassessment, history-detail host thinning, regression coverage, doc sync
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-reviewed the completed Solid migration against the current implementation and found one remaining host-thinning opportunity that still fit the plan's intended boundary: `src/tui/opentui-screen.ts` owned the history-detail summary/viewer/detail decision tree even though artifact loading had already moved into `src/tui/opentui-detail-content.ts`. Moved that pane-state assembly into `buildHistoryDetailPaneState(...)`, added direct regression coverage for empty-summary, selected-summary, and viewer cases, and updated README/design/architecture text so the documented module boundary now matches the thinner host. Verified with `bun run typecheck`, `bun test src/tui/opentui-detail-content.test.ts`, and the repository-standard `bun test` pass after the refactor.

### Session: 2026-03-26 23:40

**Tasks Completed**: Completed-plan reassessment, CLI/runtime boundary cleanup
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-reviewed the completed Solid/OpenTUI migration against the current branch and did not find a new architecture/design mismatch that requires reopening scope. I did find one maintainability gap at the CLI boundary: `runTui()` still assembled the full OpenTUI app dependency object inline even though the documented architecture now treats the CLI/runtime adapter as a thin seam. Extracted that wiring into `createOpenTuiWorkflowAppOptions(...)`, factored HOME resolution into `resolveCliHomeDir(...)`, added direct regression coverage for runtime-variable merging through the extracted OpenTUI app options, and corrected the repository package description so checked-in metadata matches the current README purpose. Verified with `bun run typecheck` and `bun test src/cli.test.ts`.

### Session: 2026-03-26 23:55

**Tasks Completed**: Completed-plan revalidation against latest commit and current worktree
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Re-reviewed the Solid/OpenTUI migration after the latest workflow-schema follow-up commit and the current plan-index cleanup. The checked-in architecture still matches the intended design and this completed plan: `src/cli.ts` lazy-loads the interactive OpenTUI boundary, `src/tui/opentui-screen.ts` remains the renderer/host seam, the declarative view tree stays in `src/tui/opentui-solid-app.tsx` plus `src/tui/components/*.tsx`, and the extracted model/controller/detail-content helpers still line up with the documented navigation and fallback contracts. Re-verified with `bun run typecheck`, `bun run build`, `bun test`, and `git diff --check`; no additional Solid migration code patch was required in this review pass.

## Related Plans

- **Previous**: `impl-plans/completed/workflow-tui-mvp.md`, `impl-plans/completed/workflow-tui-cli-parity.md`, `impl-plans/completed/workflow-tui-resume-decoupling.md`
- **Next**: None
- **Depends On**: `impl-plans/tui-resume-runtime-variable-merge.md`, `impl-plans/tui-workflow-browser-and-json-input.md`
