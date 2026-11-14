# Step-addressed Workflow Runtime Cutover Implementation Plan

**Status**: Completed (PROGRESS phase **129**; TASK-001 through TASK-005). The long-term [Completion Criteria](#completion-criteria) checklists in this file remain open for the full breaking cutover until design and code remove remaining transitional paths.
**Design Reference**: `design-docs/specs/design-workflow-json.md`, `design-docs/specs/design-node-jump-and-code-manager-runtime.md`, `design-docs/specs/design-workflow-steps-and-node-reuse.md`, `design-docs/specs/architecture.md`, `design-docs/specs/command.md`
**Created**: 2026-04-24
**Last Updated**: 2026-04-29 (phase 129 closed; plan archived under `impl-plans/completed/`; full-suite verification)

## Design Document Reference

**Source**:

- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/design-node-jump-and-code-manager-runtime.md`
- `design-docs/specs/design-workflow-steps-and-node-reuse.md`
- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`

### Summary

Replace the current node-ordered transitional workflow model with the new
step-addressed runtime:

- `workflow.json.steps[]` becomes the canonical execution graph
- `workflow.json.nodes[]` becomes a reusable node registry
- routing is driven by step `transitions[]` plus validated output `next.stepId`
- manager execution defaults to deterministic `managerType: "code"`
- repeated visits to one node use distinct mailbox instances and may reuse the
  same backend session with prompt variants
- cross-workflow invocation uses the same `(workflowId, stepId)` execution
  address as local step calls

This plan is intentionally a breaking cutover. Backward compatibility with
`entryNodeId`, `managerRuntimeId`, `workflowCalls`, `edges`, `loops`,
`subWorkflows`, `subWorkflowConversations`, branch/loop judges, and
`call-node` naming is out of scope.

### Current repository posture (execution vs. target)

The bullets above describe the **target** end state after the cutover is
finished. The tree still ships **incrementally** relative to that target: where
`workflow.json` authors `steps[]`, public inspection (CLI, library, GraphQL,
TUI) is **step-first** and omits legacy-only identity fields from summaries;
the engine and loader may still use compatibility projections and mixed
validation paths where the transitional model requires them (**TASK-001** through
**TASK-005** in `impl-plans/PROGRESS.json` are **Completed** for their scoped
deliverables; see [Completion Criteria](#completion-criteria) for the remaining
long pole). Shipped
`node-combinations-showcase` now uses strict step-addressed authoring (judge
step transitions replace node-local `repeat`); `workflow-call-simple` invokes a
sibling workflow via authored `toWorkflowId` step transitions executed as derived
workflow calls (`__cw:<callerStepId>`) without persisting them on
`workflow.workflowCalls`. `codex-codex-euthanasia-debate` is now step-addressed
(judge step + labeled transitions; six rounds in the bundled mock, 56 node
executions). **Production / operator paths** default to strict authorship (`rejectLegacyWorkflowAuthoring` omitted means strict) via `isStrictWorkflowAuthorshipValidation`; unit tests pass explicit `rejectLegacyWorkflowAuthoring: false` (or, for `runCli` integration cases, `withLegacyWorkflowAuthorshipForCli` setting `DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT=true` only for that subprocess contract) so the suite no longer relies on a global test harness env export. All **shipped** `examples/*` bundles still load under explicit strict in `load.test.ts`. This does not abandon the breaking cutover
goal; it sequences it so surfaces and runtime do not silently diverge mid-migration.

### PROGRESS.json subtasks (phase 129)

These align `impl-plans/PROGRESS.json` entries for `step-addressed-workflow-runtime-cutover` with concrete scope. They are **incremental** slices; the [Completion Criteria](#completion-criteria) and module checklists above remain the full breaking cutover.

| Task      | Scope |
| --------- | ----- |
| **TASK-001** | Strict production authorship default; unit/integration tests set `rejectLegacyWorkflowAuthoring` explicitly (or use `withLegacyWorkflowAuthorshipForCli` for subprocess CLI cases) instead of depending on a global `DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT`. |
| **TASK-002** | `call-step` public path: `rewriteCallStepFailureMessage`, delegation to `callNode` with step id as normalized address, and consistent step-oriented error text for native/adapter/user-action failures. |
| **TASK-003** | Engine step-native follow-ups: step-first `lastError` and logging (runtime DB, external output, optional manager, timeout wording) where the transitional engine still emitted node-oriented strings. |
| **TASK-004** | Public surfaces: CLI / library / GraphQL / OpenTUI step-first user strings, JSDoc for rerun/resume (`rerunFromStepId` / `fromStepId` vs historical node options), and copy-to-clipboard labels. |
| **TASK-005** | Examples and top-level docs: step-addressed example bundles, `EXPECTED_RESULTS`, README alignment with the transitional runtime. |

**Status** (see `impl-plans/PROGRESS.json`): TASK-001 through TASK-005 **Completed** for the incremental scopes in this table. End-state [Completion Criteria](#completion-criteria) and module checklists 1–4 may still be open until the full breaking cutover is finished in code and design.

### Scope

**Included**:

- authored schema cutover to `entryStepId`, optional `managerStepId`, reusable
  node registry entries, and step definitions
- loader/save/validator/json-schema changes that reject removed legacy authored
  fields
- runtime state changes for step ids, mailbox instance ids, prompt variants,
  step-local timeout overrides, and unified `call-step`
- deterministic code-manager decision path for transitions, timeout policy, and
  workflow completion/failure
- cross-workflow dispatch unification so former workflow-level calls lower into
  the same step-call primitive
- CLI/library/GraphQL/TUI inspection and command wording updates from
  node-centric to step-centric language
- example, README, and regression migration to the step-addressed model

**Excluded**:

- work tracked in `impl-plans/completed/auto-improve-superviser-mode.md` (engine
  auto-improve loop, supervision policy, and mutable execution bundles; that plan
  assumes this cutover’s runtime; nested `superviserWorkflowId` as a second
  workflow is phase 2 there)
- browser/web editor feature work beyond schema/runtime alignment
- preserving compatibility loaders or runtime branches for removed legacy
  workflow fields

## Modules

Per-module **Status** values below describe progress toward the full breaking cutover (see [Completion Criteria](#completion-criteria)), not the archived PROGRESS phase **129** task slices.

### 1. Authored Schema and Bundle I/O

#### `src/workflow/types.ts`, `src/workflow/json-schema.ts`, `src/workflow/validate.ts`, `src/workflow/load.ts`, `src/workflow/save.ts`, `src/workflow/inspect.ts`, `src/workflow/create.ts`

**Status**: IN_PROGRESS

```typescript
export interface WorkflowTimeoutPolicy {
  readonly onTimeout: "fail" | "retry-same-step" | "jump-to-step";
  readonly maxRetries?: number;
  readonly retryTimeoutIncrementMs?: number;
  readonly jumpStepId?: string;
  readonly reuseBackendSession?: boolean;
}

export interface WorkflowStepTransition {
  readonly toStepId: string;
  readonly toWorkflowId?: string;
  readonly resumeStepId?: string;
  readonly label?: string;
}

export interface WorkflowStepSessionPolicy {
  readonly mode?: "new" | "reuse";
  readonly inheritFromStepId?: string;
}

export interface WorkflowStepRef {
  readonly id: string;
  readonly stepFile?: string;
  readonly nodeId?: string;
  readonly description?: string;
  readonly role?: "manager" | "worker";
  readonly promptVariant?: string;
  readonly timeoutMs?: number;
  readonly sessionPolicy?: WorkflowStepSessionPolicy;
  readonly transitions?: readonly WorkflowStepTransition[];
}

export interface WorkflowJson {
  readonly workflowId: string;
  readonly description: string;
  readonly defaults: WorkflowDefaults;
  readonly entryStepId: string;
  readonly managerStepId?: string;
  readonly nodes: readonly WorkflowNodeRef[];
  readonly steps: readonly WorkflowStepRef[];
}
```

**Checklist**:

- [ ] Remove legacy authored fields and types from the primary workflow schema
- [ ] Add file-backed and inline `steps[]` support with strict validation
- [ ] Make `workflow.json.nodes[]` a pure reusable registry rather than ordered execution
- [ ] Reject removed fields such as `workflowCalls`, `edges`, `loops`, and structural sub-workflow metadata
- [ ] Update create/save/load/inspect surfaces to emit only the new step-addressed shape

### 2. Step Execution State and Unified `call-step`

#### `src/workflow/call-step.ts`, `src/workflow/session.ts`, `src/workflow/session-store.ts`, `src/workflow/runtime-db.ts`, `src/workflow/node-execution-mailbox.ts`, `src/workflow/communication-service.ts`

**Status**: IN_PROGRESS

```typescript
export interface ExecutionAddress {
  readonly workflowId: string;
  readonly stepId: string;
}

export interface StepCallOverrides {
  readonly promptVariant?: string;
  readonly sessionMode?: "new" | "reuse";
  readonly timeoutMs?: number;
}

export interface CallStepInput extends LoadOptions, SessionStoreOptions {
  readonly workflowId: string;
  readonly workflowRunId: string;
  readonly stepId: string;
  readonly overrides?: StepCallOverrides;
  readonly message?: unknown;
  readonly defaultTimeoutMs?: number;
}

export interface AcceptedOutputMail {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly stepId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly mailboxInstanceId: string;
  readonly status: "success" | "fail" | "timeout";
  readonly reason?: string;
  readonly next?: {
    readonly workflowId?: string;
    readonly stepId: string;
    readonly promptVariant?: string;
    readonly sessionMode?: "new" | "reuse";
    readonly timeoutMs?: number;
  };
  readonly payload: Readonly<Record<string, unknown>>;
}
```

**Checklist**:

- [ ] Replace `call-node` with `call-step` and make step id the public execution target
- [ ] Persist step-addressed execution history, mailbox instance ids, and step-local overrides in session state
- [ ] Update runtime-db rows and mailbox artifacts to store `stepId` as a first-class field
- [ ] Keep backend-session reuse keyed by step/node policy without collapsing repeated step visits
- [ ] Remove old node-only execution assumptions from direct-call plumbing

### 3. Engine and Deterministic Manager Runtime

#### `src/workflow/engine.ts`, `src/workflow/manager-control.ts`, `src/workflow/prompt-composition.ts`, `src/workflow/input-assembly.ts`, `src/workflow/node-role.ts`, `src/workflow/semantics.ts`, `src/workflow/sub-workflow.ts`, `src/workflow/conversation.ts`

**Status**: IN_PROGRESS

```typescript
export interface ManagerRuntimeDecision {
  readonly action: "call-step" | "complete-workflow" | "fail-workflow";
  readonly target?: ExecutionAddress;
  readonly promptVariant?: string;
  readonly sessionMode?: "new" | "reuse";
  readonly timeoutMs?: number;
  readonly reason?: string;
}

export type ManagerControlActionType =
  | "planner-note"
  | "retry-step"
  | "replay-communication"
  | "execute-optional-step"
  | "skip-optional-step";
```

**Checklist**:

- [ ] Replace edge/loop/sub-workflow planning with validated step-transition execution
- [ ] Make `managerType: "code"` the default manager behavior and keep `llm` explicitly opt-in
- [ ] Apply workflow/step timeout policy deterministically from manager/runtime code
- [ ] Resolve prompt variants and same-session continuation when revisiting shared nodes
- [ ] Delete obsolete structural sub-workflow and branch/loop runtime paths instead of preserving them

### 4. Public Surfaces and Inspection

#### `src/lib.ts`, `src/cli.ts`, `src/graphql/schema.ts`, `src/graphql/types.ts`, `src/server/graphql.ts`, `src/tui/opentui-model/**/*.ts`, `src/tui/components/WorkflowDefinitionScreen.tsx`

**Status**: IN_PROGRESS

```typescript
export interface WorkflowInspectionSummary {
  readonly workflowId: string;
  readonly entryStepId: string;
  readonly managerStepId?: string;
  readonly stepIds: readonly string[];
  readonly nodeRegistryIds: readonly string[];
}

export interface SessionRerunInput {
  readonly sessionId: string;
  readonly stepId: string;
  readonly workflowWorkingDirectory?: string;
}
```

**Checklist**:

- [ ] Rename CLI/library/GraphQL public execution surfaces from node to step where the user targets execution
- [ ] Replace `call-node` documentation and command text with `call-step`
- [ ] Update `session progress`, `session rerun`, and workflow inspection output to report step-centric state
- [ ] Reflect reusable node registry versus step graph separation in TUI and GraphQL summaries
- [ ] Keep any remaining node wording limited to reusable payload definitions, not execution addresses

### 5. Examples, Documentation, and Regression Replacement

#### `examples/**/*`, `README.md`, `design-docs/specs/*.md`, `src/workflow/*.test.ts`, `src/cli.test.ts`, `src/graphql/schema.test.ts`, `src/server/graphql.test.ts`, `src/tui/**/*.test.ts`

**Status**: IN_PROGRESS

```typescript
interface StepAddressedExampleSet {
  readonly workflowId: string;
  readonly stepIds: readonly string[];
  readonly sharedNodeIds: readonly string[];
  readonly crossWorkflowTargets: readonly ExecutionAddress[];
}
```

**Checklist**:

- [ ] Replace legacy example bundles with step-addressed bundles and reusable-node examples
- [ ] Add regression coverage for prompt variants, shared-node revisits, timeout-policy routing, and unified cross-workflow step calls
- [ ] Remove tests that only protect deleted branch/loop/sub-workflow authoring
- [ ] Align README, architecture, command docs, and notes with the new cutover
- [ ] Verify no shipped example still depends on removed compatibility fields

## Module Status

| Module                                       | File Path                                                                                                                                                                               | Status      | Tests                                                                                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authored schema and bundle I/O               | `src/workflow/types.ts`, `src/workflow/json-schema.ts`, `src/workflow/validate.ts`, `src/workflow/load.ts`, `src/workflow/save.ts`, `src/workflow/inspect.ts`, `src/workflow/create.ts` | IN_PROGRESS | `src/workflow/validate.test.ts`, `src/workflow/load.test.ts`, `src/workflow/save.test.ts`, `src/workflow/json-schema.test.ts`                           |
| Step execution state and unified `call-step` | `src/workflow/call-step.ts`, `src/workflow/session.ts`, `src/workflow/runtime-db.ts`, `src/workflow/node-execution-mailbox.ts`                                                          | IN_PROGRESS | `src/workflow/call-step.test.ts`, `src/workflow/runtime-db.test.ts`, `src/workflow/session-store.test.ts`, `src/cli.test.ts`, `src/lib.test.ts`         |
| Engine and deterministic manager runtime     | `src/workflow/engine.ts`, `src/workflow/manager-control.ts`, `src/workflow/prompt-composition.ts`, `src/workflow/input-assembly.ts`                                                     | IN_PROGRESS | `src/workflow/engine.test.ts`, `src/workflow/manager-control.test.ts`, `src/workflow/prompt-composition.test.ts`, `src/workflow/input-assembly.test.ts` |
| Public surfaces and inspection               | `src/lib.ts`, `src/cli.ts`, `src/graphql/schema.ts`, `src/tui/**/*`                                                                                                                     | IN_PROGRESS | `src/lib.test.ts`, `src/cli.test.ts`, `src/graphql/schema.test.ts`, `src/server/graphql.test.ts`, `src/tui/opentui-screen.test.ts`                      |
| Examples, docs, and regression replacement   | `examples/**/*`, `README.md`, `design-docs/specs/*.md`                                                                                                                                  | IN_PROGRESS | targeted example-validation and repository regression slices                                                                                            |

## Dependencies

| Feature                                      | Depends On                                  | Status      |
| -------------------------------------------- | ------------------------------------------- | ----------- |
| Authored schema and bundle I/O               | Existing workflow save/load foundation      | IN_PROGRESS |
| Step execution state and unified `call-step` | Authored schema and bundle I/O              | IN_PROGRESS |
| Engine and deterministic manager runtime     | Authored schema and step execution state    | IN_PROGRESS |
| Public surfaces and inspection               | Authored schema and step execution state    | IN_PROGRESS |
| Examples, docs, and regression replacement   | Schema, runtime, and public-surface cutover | IN_PROGRESS (TASK-005 completed; follow-ups on TASK-001-004) |

## Completion Criteria

- [ ] The repository accepts only the step-addressed authored workflow model on the primary path
- [ ] `workflow.json.nodes[]` is treated only as a reusable node registry
- [ ] Runtime execution, mailbox artifacts, and runtime-db state are step-addressed
- [ ] `call-step` is the single direct execution primitive for local and cross-workflow calls
- [ ] Code manager is the default manager runtime and timeout policy is deterministic
- [ ] Prompt-variant revisits and shared-node session reuse work with distinct mailbox instances
- [ ] CLI, GraphQL, TUI, examples, and README all describe the step-addressed model consistently
- [ ] `bun run typecheck:server`, targeted runtime tests, and the full regression suite pass

## Progress Log

### Session: 2026-04-29 (close phase 129; archive plan)

**Tasks Completed**: Verified incremental deliverables for **TASK-002** (`call-step` + `rewriteCallStepFailureMessage` + delegation), **TASK-003** (engine/runtime-db/external-output step-first `lastError` and logging via `executionTargetNoun` / `stepAddressedExecution` and related paths), and **TASK-004** (CLI / `lib` / GraphQL / OpenTUI step-first strings, rerun JSDoc, copy labels) against the working tree; `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**996** pass, 0 fail); `bun run typecheck:server`. Updated `impl-plans/PROGRESS.json` (phase **129** `COMPLETED`; all tasks **Completed**), moved this file to `impl-plans/completed/`, refreshed `impl-plans/README.md` Active/Completed tables and phase dependency footnotes.

**Follow-up**: [Completion Criteria](#completion-criteria) checkboxes remain for future iterations (strict primary-path schema-only model, fully step-native internals, and checklist closure in modules 1–4).

### Session: 2026-04-28 (PROGRESS subtask table; full-suite verification, architecture)

**Tasks Completed**: Documented **PROGRESS.json** subtask mapping (TASK-001 through TASK-005) in this file so phase **129** task ids match incremental scope vs. the long end-state [Completion Criteria](#completion-criteria). Re-verified: `auto-improve-superviser-mode` (phase **130**) is **Completed** and Phase 1 of `design-auto-improve-superviser-mode.md` still matches the engine-orchestrated `runAutoImproveLoop` + execution-copy / patch-revision audit; nested `superviserWorkflowId` remains Phase 2. No code or design change required. `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**996** pass, 0 fail).

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 unchanged.

### Session: 2026-04-25 (TASK-004: `rerunWorkflow` forwards both `rerunFrom*` ids when step + node)

**Tasks Completed**: When both `fromStepId` and `fromNodeId` are set on `RerunWorkflowInput`, `rerunWorkflow` now passes both `rerunFromStepId` and `rerunFromNodeId` into `runWorkflow` (the engine already prefers the step id; the node id is companion bookkeeping and must not be dropped). Strengthened the existing `lib.test.ts` spy to require `rerunFromNodeId` in the `runWorkflow` call. `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**996** pass, 0 fail), `bun run typecheck`, `bun run typecheck:server`.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004; end-state [Completion Criteria](#completion-criteria) and module checklists 1-4 remain the long pole.

**Superseded (phase 133, `workflow-legacy-compatibility-removal`)**: The public `rerunWorkflow` path and `WorkflowRunOptions` later removed companion `rerunFromNodeId` / node-targeted reruns; `runWorkflow` resume reruns require `rerunFromStepId` only. The following session’s `RerunWorkflowInput.fromNodeId` JSDoc is historical for the same reason.

### Session: 2026-04-28 (TASK-004: `RerunWorkflowInput` JSDoc for step vs node)

**Tasks Completed**: Added JSDoc on `RerunWorkflowInput.fromStepId` and `.fromNodeId` in `src/lib.ts` documenting engine precedence and reusable-node cases (matches `WorkflowRunOptions` / engine behavior; no API change). Ran `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**996** pass, 0 fail) and `bun run typecheck:server` after the change.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004; end-state [Completion Criteria](#completion-criteria) and module checklists 1-4 remain the long pole.

**Superseded (phase 133)**: `RerunWorkflowInput` is `fromStepId` only; the JSDoc described here no longer applies.

### Session: 2026-04-25 (verification: full suite, architecture, no code delta)

**Tasks Completed**: Ran `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**994** pass, 0 fail) and `bun run typecheck:server` on the current branch. Re-confirmed `impl-plans/PROGRESS.json`: this plan is **In Progress** (phase **129**; **TASK-002** through **TASK-004**); `auto-improve-superviser-mode` (phase **130**) is **Completed**. The tree still matches *Current repository posture* in this file and the transitional `design-workflow-json.md` model: step-first inspection, `callStep` as the documented public direct primitive, compatibility projections where the transitional runtime still requires them, strict production authorship with explicit `rejectLegacyWorkflowAuthoring` or CLI subprocess helpers in tests. No design split or new implementation plan; no code changes in this pass.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004; end-state [Completion Criteria](#completion-criteria) and module checklists 1-4 remain the long pole.

### Session: 2026-04-28 (TASK-003/004: external output publication errors step-first)

**Tasks Completed**: In `runWorkflow`, terminal failure strings for `failed to publish selected external output` / `failed to persist external output publication` now use the same `executionTargetNoun` as other engine `lastError` lines (`step` when `steps[]` is present) and prefer `NodeExecutionRecord.stepId` in the message when set. Ran `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (994 pass, 0 fail) and `bun run typecheck`.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004; end-state [Completion Criteria](#completion-criteria) and module checklists remain the long pole.

### Session: 2026-04-27 (agent: suite verification, diff review, architecture)

**Tasks Completed**: Ran `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**994** pass, 0 fail), `bun run typecheck`, and `bun run typecheck:server` on the current working tree. **Architecture / design**: Still matches the *Current repository posture* and `design-workflow-json.md` transitional model: step-first inspection and CLI/GraphQL/TUI language, `callStep` as the public direct primitive delegating to normalized `callNode` addresses, engine retaining legacy graph paths only where the transitional runtime requires. `impl-plans/auto-improve-superviser-mode` remains **Completed** (Phase 1); no design split or new implementation plan was required. **Diff review** (engine, `call-step`, session/runtime-db, TUI, GraphQL, CLI, `superviser`, examples): no defect or follow-up that required a code change in this pass; continuation of the cutover and `--resume-step-exec` / `--no-allow-targeted-rerun` naming is consistent.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004; end-state [Completion Criteria](#completion-criteria) and module checklists remain the long pole.

### Session: 2026-04-25 (TASK-004: `call-step` `--resume-step-exec`)

**Tasks Completed**: Documented and implemented `--resume-step-exec <id>` as the step-first flag for resuming a prior execution record on `call-step`; `--resume-node-exec` remains an alias. Parser rejects conflicting values when both appear. Updated `printHelp`, `design-docs/specs/command.md`, and `README.md`. Added `src/cli.test.ts` coverage. Ran full tests and typechecks (994 pass, 0 fail).

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (long module checklists and end-state completion criteria unchanged).

### Session: 2026-04-26 (continuation: PROGRESS metadata, architecture check)

**Tasks Completed**: Restored monotonic `impl-plans/PROGRESS.json` `lastUpdated` after an accidental regression (must not move backward vs prior committed value). Re-validated *Current repository posture*: only this plan stays **In Progress** (phase **129**, TASK-002 through TASK-004); `auto-improve-superviser-mode` remains **Completed** (phase **130**). No code change required beyond metadata; `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**992** pass, 0 fail).

**Tasks In Progress**: TASK-002, TASK-003, TASK-004; end-state [Completion Criteria](#completion-criteria) and module checklists remain open.

### Session: 2026-04-25 (TASK-004: README workflow.json + manager inference)

**Tasks Completed**: `README.md` `workflow.json` role line now describes the step graph (`steps[]` transitions) as primary and ordered `nodes[]`/synthesized edges as legacy. Documented that a single manager-role step allows inferred `managerStepId` (parallel to legacy `managerRuntimeId` inference). Re-ran `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**992** pass, 0 fail); no code changes.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004; phase **129** unchanged.

### Session: 2026-04-25 (TASK-002/004: `rewriteCallStepFailureMessage` exit paths; `SupervisionStallWatch` JSDoc)

**Tasks Completed**: Extended `src/workflow/call-step.test.ts` so `rewriteCallStepFailureMessage` regressions include native child-process exit code and signal messages from `native-node-executor` (covered by the existing `native node execution` to `native step execution` replace). `SupervisionStallWatch` JSDoc in `src/workflow/types.ts` now says native **step** execution, matching the step-addressed stall watch. `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**992** pass, 0 fail), `bun run typecheck`, `bun run typecheck:server`.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004; phase **129** unchanged; end-state [Completion Criteria](#completion-criteria) and module checklists not closed.

### Session: 2026-04-25 (TASK-004: `lib` re-export JSDoc for `callNode` / `callStep`)

**Tasks Completed**: Added documentation on the public `src/lib.ts` re-exports so API consumers see when to use `callStep` / `callWorkflowStep` vs the historical `callNode` shape. `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**992** pass, 0 fail), `bun run typecheck`, `bun run typecheck:server`.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004; phase **129** unchanged.

### Session: 2026-04-25 (verification: full suite, architecture, TASK-002-004)

**Tasks Completed**: Ran `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**992** pass, 0 fail). Confirmed the *Current repository posture* (step-first inspection, `callStep` as the public direct primitive with documented delegation to `callNode` for normalized step ids, transitional engine/loader paths, strict production authorship with explicit legacy opt-in in tests) still matches the tree; no design doc change required. `rewriteCallStepFailureMessage` + `call-step.test.ts` already cover optional-step and `user-action` call-node error shapes.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004; phase **129** remains `IN_PROGRESS` in `impl-plans/PROGRESS.json` until the end-state [Completion Criteria](#completion-criteria) and module checklists in this plan are satisfied (not a single-iteration close).

### Session: 2026-04-25 (TASK-004: supervised-mock example system prompt; architecture review)

**Tasks Completed**: `examples/supervised-mock-retry/workflow.json` `workerSystemPromptTemplate` now refers to the current **step** responsibility (not **node**), matching the step-addressed model and the rest of the example docs. `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**992** pass, 0 fail).

**Architecture / design check**: The tree still matches the plan *Current repository posture* and `design-workflow-json.md` transitional model: step-first public surfaces, strict default authorship, `callStep` as the preferred direct primitive (`callNode` remains internal/compatibility), engine retains legacy graph paths only where the transitional runtime requires them. `impl-plans/auto-improve-superviser-mode` remains **Completed** in `impl-plans/PROGRESS.json` (Phase 1); nested `superviserWorkflowId` is Phase 2. End-state [Completion Criteria](#completion-criteria) and module checklists are not closed; they remain the long pole after this iteration.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004; phase **129** remains `IN_PROGRESS` in `impl-plans/PROGRESS.json`.

### Session: 2026-04-26 (TASK-004: TUI history status uses step id when distinct from node id)

**Tasks Completed**: `src/tui/opentui-screen/runtime.ts` now uses `primaryStepOrNodeLabel` (`stepId ?? nodeId`) anywhere the UI said "step" but showed `execution.nodeId` only, including JSON viewer titles in subworkflow history. Aligns with `opentui-controller` rerun wording. `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**992** pass), `bun run typecheck`.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (transitional cutover; full module checklists remain end-state goals).

### Session: 2026-04-25 (TASK-003/004: runtime sqlite logs use `step` when `stepId` is present)

**Tasks Completed**: `saveNodeExecutionToRuntimeDb` now writes the completion line as `step <id> finished…` when a `stepId` is stored (step-addressed execution rows). `saveProcessLogsToRuntimeDb` accepts optional `executionLogTarget: "step"`; `call-node` and `engine` pass it when `resolveStepExecutionAddress` provides a `stepId`, so adapter/native process log lines match step-first execution addressing. Added `runtime-db.test.ts` coverage. `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**991** pass), `bun run typecheck`, `bun run typecheck:server`.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (transitional cutover; full module checklists remain end-state goals).

### Session: 2026-04-25 (TASK-002: `rewriteCallStepFailureMessage` native mailbox read path)

**Tasks Completed**: Extended `rewriteCallStepFailureMessage` in `src/workflow/call-step.ts` so `native node did not produce mailbox output` from `native-node-executor.ts` (missing outbox file) maps to **native step** when the entrypoint is `call-step`. Added unit coverage in `src/workflow/call-step.test.ts`. `bun run typecheck`, `bun run typecheck:server`, `bun test src/workflow/call-step.test.ts`.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (transitional cutover; full module checklists remain end-state goals).

### Session: 2026-04-25 (TASK-002/TASK-004: `call-step` rewrites native executor errors)

**Tasks Completed**: Extended `rewriteCallStepFailureMessage` in `src/workflow/call-step.ts` so delegated failures that use `native node execution` / `unknown native node execution failure` (from `adapter-execution.ts` / `native-node-executor.ts`) read as **native step execution** when the entrypoint is `call-step`. Added unit coverage in `src/workflow/call-step.test.ts`. `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**989** pass), `bun run typecheck`, `bun run typecheck:server`.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (transitional cutover; full module checklists and completion criteria remain end-state goals).

### Session: 2026-04-25 (TASK-004: supervision README stall wording; example manager field names)

**Tasks Completed**: Aligned `examples/auto-improve/README.md` stall description with step-execution semantics (`while a step is executing` instead of `while a node runs`). Updated `examples/README.md` worker-only and chat-reply sections to refer to `managerStepId` (step-addressed authoring) instead of removed `managerRuntimeId`. Re-ran `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (989 pass) and `bun run typecheck` / `bun run typecheck:server`.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (transitional cutover; full module checklists and completion criteria remain end-state goals).

### Session: 2026-04-28 (TASK-004: `call-step` continuation flag docs; architecture review)

**Tasks Completed**: Clarified `call-step` continuation controls in `design-docs/specs/command.md` (step-oriented wording for `--prompt-variant` / `--continue-session`, and `--resume-node-exec` as the prior execution record id with a historical flag name), the `printHelp` line in `src/cli.ts`, and the README options list. Re-ran `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**989** pass) and `bun run typecheck:server` after changes.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (transitional cutover; full module checklists and completion criteria remain end-state goals).

**Architecture**: Unchanged: step-first public surfaces, strict production authorship default, `auto-improve-superviser-mode` phase 1 complete in code; this plan remains the only active cutover with TASK-002 through TASK-004 in `impl-plans/PROGRESS.json` phase 129.

### Session: 2026-04-27 (TASK-004: copy-to-clipboard label for node vs step execution id)

**Tasks Completed**: `resolveOpenTuiCopyTarget` + `buildCopyTargetInput` in `opentui-controller.ts` now pass `stepAddressedAuthoring` when the loaded bundle has `steps[]`, so the history **nodes** pane copy shortcut labels the selection **step execution id** instead of **node execution id**. Added `opentui-screen-navigation.test.ts` coverage. `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**989** pass); `bun run typecheck:server` pass.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (broader module checklists); TASK-001 and TASK-005 completed for their PROGRESS slices.

### Session: 2026-04-25 (TASK-003: engine failure fallback strings)

**Tasks Completed**: When `stepAddressedExecution` is true, defensive `workflowRunFailure` fallbacks (if `lastError` were ever missing) now use `invalid step execution payload` instead of node/agent-oriented wording in both missing-executable-field paths in `src/workflow/engine.ts`. `buildDetailAgentSessionDescription` in `src/tui/opentui-model/shared.ts` accepts optional `stepAddressedAuthoring` so its copy matches `buildSummaryJsonSelectOptions` if used. Ran `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**988** pass) and `bun run typecheck`.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (module checklists); TASK-001 and TASK-005 completed.

### Session: 2026-04-25 (architecture + terminology hygiene)

**Tasks Completed**: Re-validated `design-auto-improve-superviser-mode` Phase 1 (engine `runAutoImproveLoop`, execution-copy patches, stall prefix, `planSupervisionRemediation`) against the tree; Phase 2 nested `superviserWorkflowId` remains out of scope as documented. Confirmed `auto-improve-superviser-mode` is **Completed** in `impl-plans/PROGRESS.json` and this cutover plan stays **In Progress** with **TASK-002 through TASK-004** (transitional posture; module checklists 1 to 4). Ran `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**988** pass, 0 fail) and `bun run typecheck`. **Hygiene**: supervision stall doc comments now say *step* execution instead of *node* in `engine.ts`, `superviser.ts`, and `types.ts` (stall watch is step-addressed).

**Tasks In Progress**: TASK-002, TASK-003, TASK-004; TASK-001 and TASK-005 completed.

### Session: 2026-04-25 (TASK-004: workspace history + detail summary step-first copy)

**Tasks Completed**: `buildWorkflowSelectorHistorySummary` labels the latest-run counter as `step executions` when `stepAddressedAuthoring` is true (wired from OpenTUI runtime via `isStepAddressedAuthoring`). `buildSummaryJsonSelectOptions` uses `step execution` in the unavailable-backend-session description when step-addressed; history detail empty-select placeholder uses `(no step)` vs `(no node)`. `openDetailSummarySelection` status text uses step wording when the loaded workflow is step-addressed. Tests: `opentui-screen.test.ts`, `opentui-detail-content.test.ts`. Verified `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**987** pass).

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (remaining module checklists); TASK-001 and TASK-005 completed.

### Session: 2026-04-25 (working-tree review: full suite, CLI flag alignment, progress metadata)

**Tasks Completed**: Re-ran `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**985** pass, 0 fail) and `bun run typecheck` / `typecheck:server`. Reviewed uncommitted diff: `--no-allow-targeted-rerun` is consistent across `src/cli.ts`, `design-docs/specs/command.md`, and `design-docs/specs/design-auto-improve-superviser-mode.md`; `examples/supervised-mock-retry` matches auto-improve Phase 1 docs; phase **130** (`auto-improve-superviser-mode`) completion and phase **129** transitional cutover posture match `PROGRESS.json` and *Current repository posture* above. Updated `impl-plans/PROGRESS.json` `lastUpdated` and `impl-plans/README.md` completed date for the superviser plan.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (end-state module checklists remain open).

### Session: 2026-04-25 (TASK-002/004: `callStep` failure `session.lastError` and optional adapter)

**Tasks Completed**: On `callStep` failure, `session.lastError` is now rewritten with `rewriteCallStepFailureMessage` (alongside the top-level `message`) so persisted-style error text stays step-oriented for embedders. Added an optional `adapter` second parameter to `callStep`, passed through to `callNode` (parity for tests and injected adapters). Added `call-step.test.ts` regression (mailbox persistence failure). `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh`: **985** pass; `bun run typecheck` / `typecheck:server` pass.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (long module checklists); TASK-001 and TASK-005 completed.

### Session: 2026-04-25 (TASK-003: step-first wording for optional manager and upstream errors)

**Tasks Completed**: When `workflow.steps` is authored, invalid optional-manager control and upstream communication resolution errors now use **step** vs **node** in user-facing strings (`applyOptionalManagerDecisions`, `buildUpstreamInputs` in `src/workflow/engine.ts`; `applyOptionalNodeDecision` in `src/workflow/manager-message-service/session.ts`). Timeout fallback message uses `${executionTargetNoun} timeout` instead of a hardcoded `node timeout`. Full suite **984** pass; `bun run typecheck` and `bun run typecheck:server` pass.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (remaining cutover checklist); TASK-001 and TASK-005 completed.

**Verification**: `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh`, `bun run typecheck`, `bun run typecheck:server`.

### Session: 2026-04-25 (verification: full suite, typecheck, plan posture)

**Tasks Completed**: Ran `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (984 pass, 0 fail) and `bun run typecheck`. Confirmed this plan remains the only **Active** entry in `impl-plans/README.md` with **TASK-002 through TASK-004** still **In Progress** in `impl-plans/PROGRESS.json` (phase 129), while `auto-improve-superviser-mode` (phase 130) is **Completed** and matches Phase 1 of `design-auto-improve-superviser-mode.md` (transitional step-addressed runtime; nested `superviserWorkflowId` = Phase 2). Architecture matches the *Current repository posture* section: step-first public surfaces, incremental engine/loader compatibility, strict production defaults, explicit test-only legacy opt-in. No code or design changes were required in this pass.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (module checklists 1 to 4 remain the long-pole; completion criteria are end-state, not the transitional milestone); TASK-001 and TASK-005 completed.

**Verification**: `bun run typecheck`, `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh`.

### Session: 2026-04-25 (TASK-004: library re-exports for `callStep` result types)

**Tasks Completed**: Re-exported `CallStepInput`, `CallStepSuccess`, `CallStepFailure`, and `CallStepOverrides` from `src/lib.ts` (alongside `callStep`) so embedders can type `Result` / promise results without deep-importing `./workflow/call-step`. `CallWorkflowStepInput` already extended `CallStepInput`; this completes public-surface typing parity with `callNode` / `CallNodeInput` patterns. `bun run typecheck` and full `scripts/run-bun-tests.sh` pass.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (long module checklists); TASK-001 and TASK-005 completed.

**Verification**: `bun run typecheck`, `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh`.

### Session: 2026-04-25 (TASK-004: TUI step-first status and definition popup)

**Tasks Completed**: When `workflow.steps` is authored, OpenTUI status/busy strings and history detail placeholders now prefer **step** execution wording vs **node definition** / registry labels for the definition pane (`src/tui/opentui-screen/runtime.ts`, `src/tui/opentui-model/workflow-rendering.ts`, `src/tui/opentui-detail-content.ts`). Added regression tests; full suite **984** pass (`env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh`).

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (long module checklists); TASK-001 and TASK-005 completed.

**Verification**: `bun test src/tui/opentui-detail-content.test.ts src/tui/opentui-screen-runtime.test.ts`, full `scripts/run-bun-tests.sh`.

### Session: 2026-04-26 (TASK-004: mock-scenario shape error is step-first)

**Tasks Completed**: Documented why `callStep` delegates to `callNode` with `nodeId: stepId` (step-addressed normalization in `normalizeStepAddressedWorkflow`). Updated `readMockScenario` validation error in `src/cli.ts` to describe keys as step id for step-addressed workflows (legacy: node id). Full suite **981** pass, 0 fail (`env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh`).

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (long module checklists); TASK-001 and TASK-005 completed.

**Verification**: `bun test src/workflow/call-step.test.ts`, `bun test src/cli.test.ts`, full `scripts/run-bun-tests.sh`.

### Session: 2026-04-25 (TASK-002 hygiene: track supervision path tests)

**Tasks Completed**: Added `src/workflow/paths.test.ts` to the repository (was present on disk but untracked) for `isSafeSupervisionRunId`, `resolveSupervisionRunDirectory`, and `resolveSupervisionMutableWorkflowDirectory` regression coverage aligned with `SUPERVISION_RUN_ID_PATTERN` and traversal rejection. Re-ran `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**981** pass, 0 fail). **Architecture check**: `auto-improve-superviser-mode` Phase 1 (engine supervision loop, execution-copy patches) remains the shipped slice; this cutover plan’s **TASK-002–004** remain the long-pole **step-addressed** follow-ups (transitional posture unchanged).

**Tasks In Progress**: TASK-002, TASK-003, TASK-004; TASK-001 and TASK-005 completed.

**Verification**: `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh`, `bun test src/workflow/paths.test.ts`.

### Session: 2026-04-25 (iteration: full-suite verification, architecture check)

**Tasks Completed**: Re-validated `design-auto-improve-superviser-mode.md` Phase 1 against `runAutoImproveLoop`, `planSupervisionRemediation`, `mutable-workspace` / patch-revision audit, and `superviser.ts`; Phase 2 nested `superviserWorkflowId` remains correctly future work. Confirmed `step-addressed-workflow-runtime-cutover` is still the active plan with **TASK-002 through TASK-004** in `impl-plans/PROGRESS.json` (transitional posture; long module checklists in this file not closed). **Hygiene**: corrected *Current repository posture* above so it no longer claims **TASK-001** is in progress. Ran `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**978** pass, 0 fail).

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (unchanged).

**Verification**: `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh`.

### Session: 2026-04-26 (review: impl-plan status, diff hygiene)

**Tasks Completed**: Confirmed `impl-plans/completed/auto-improve-superviser-mode.md` is **Completed** in `impl-plans/PROGRESS.json` (all tasks) and that Phase 1 (engine `runAutoImproveLoop`, execution-copy patches, incident/remediation model) still matches `design-auto-improve-superviser-mode.md`; Phase 2 nested `superviserWorkflowId` remains explicitly future work. **Active** plan remains **step-addressed-workflow-runtime-cutover** with **TASK-002 through TASK-004** in progress (transitional runtime per *Current repository posture*; long module checklists not closed). **Hygiene**: restored `impl-plans/PROGRESS.json` `lastUpdated` to a monotonic value after an accidental earlier timestamp in the working tree; no task status changes in this pass.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004; TASK-001 and TASK-005 completed.

**Verification**: `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (978 pass).

### Session: 2026-04-25 (docs: `resolveSupervisionRerunAnchor` JSDoc)

**Tasks Completed**: Clarified the comment above `SUPERVISION_STALL_ERROR_PREFIX` in `src/workflow/superviser.ts` so it no longer reads as if `managerRuntimeId` is assigned from `managerStepId`/`entryStepId`. Documents that `rerunFromNodeId` is a historical option name, that the value is the step or node execution id, and that anchor resolution matches `resolveSupervisionRerunAnchor` (manager step, then entry step, then legacy manager node).
Re-validated architecture: `auto-improve-superviser-mode` Phase 1 engine loop remains the intended product slice; `step-addressed-workflow-runtime-cutover` TASK-002 to TASK-004 still carry the long checklist.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (per `impl-plans/PROGRESS.json`); TASK-001 and TASK-005 completed.

**Verification**: `bun test src/workflow/superviser.test.ts` (14 pass), `bun run typecheck`, `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (978 pass).

### Session: 2026-04-25 (review: phase dependencies, architecture vs auto-improve design)

**Tasks Completed**: Corrected `impl-plans/README.md` Phase Dependencies so phase **130** (`auto-improve-superviser-mode`) no longer lists a hard dependency on completing phase **129** while 129 remains `IN_PROGRESS`; phase 130 is documented as shipping on the transitional step-addressed runtime (foundations through phases **125** and **128**). Re-validated `design-auto-improve-superviser-mode.md` Phase 1 vs code: engine-orchestrated `runAutoImproveLoop`, execution-copy / patch-revision audit, stall handling, and remediation policy remain aligned; Phase 2 nested `superviserWorkflowId` workflow stays out of scope.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (per `impl-plans/PROGRESS.json`); TASK-001 and TASK-005 completed.

**Verification**: `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (978 pass).

### Session: 2026-04-25 (TASK-004: GraphQL rerun missing-target message is step-first)

**Tasks Completed**: `rerunWorkflowExecution` now throws a step-first validation message when both `stepId` and `nodeId` are omitted (`src/graphql/schema.ts`), keeping `nodeId` as a documented compatibility path per the transitional cutover posture. Added `src/graphql/schema.test.ts` coverage for the missing-target case.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (broader module checklists); TASK-005 completed.

**Verification**: `bash scripts/run-bun-tests.sh` (977 pass).

### Session: 2026-04-25 (supervision audit: attempt budget preserves terminal incident)

**Tasks Completed**: `runAutoImproveLoop` now records the terminal **failure** or **stall** incident before the **budget-exhausted** incident when `attemptCount >= maxSupervisedAttempts`, so a single-attempt policy (`maxSupervisedAttempts: 1`) still leaves an auditable failure trail (aligns with `design-auto-improve-superviser-mode` incident model). Extended `engine.test.ts` (two-attempt case expects two failure incidents; new max-1 case).

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 unchanged.

**Verification**: `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (977 pass).

### Session: 2026-04-26 (TASK-003/TASK-004: engine `lastError` uses step vs node noun)

**Tasks Completed**: `runWorkflowInternal` already had `stepAddressedExecution`; added `executionTargetNoun` (`step` | `node`) and aligned persisted/runtime failure strings (input assembly, mailbox persistence, manager session finalize, invalid manager control, loop edge miss, timeout/stuck/adapter/completion paths) so step-addressed runs no longer emit generic `node` wording for execution-address failures. Subworkflow dispatch message uses `steps` vs `nodes` when `steps[]` is authored. Updated legacy `engine.test.ts` expectation for adapter failure text. Aligns with design intent: execution address is step-first when the bundle is step-addressed.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (broader cutover checklist); TASK-005 completed.

**Verification**: `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (976 pass).

### Session: 2026-04-25 (TASK-004: GraphQL executable schema rerun typing)

**Tasks Completed**: `src/server/graphql-executable-schema.ts` `rerunWorkflowExecution` resolver now types `args.input` as `RerunWorkflowExecutionInput` (optional `stepId` / `nodeId`, plus rerun options) instead of an incorrect required `nodeId: string`, and forwards the input without `as never`. Aligns the Yoga HTTP schema path with `createGraphqlSchema` / SDL for step-first reruns.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004 (remaining tail); TASK-005 completed.

**Verification**: `bun run typecheck`, `bun run typecheck:server`, `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bun test src/server/graphql.test.ts`.

### Session: 2026-04-26 (review: auto-improve vs design, cutover continuation)

**Tasks Completed**: Confirmed `design-auto-improve-superviser-mode.md` Phase 1 matches the shipped engine-orchestrated loop (`runAutoImproveLoop`, execution-copy / patch-revision audit, stall prefix detection, `planSupervisionRemediation` repeat-failure escalation); Phase 2 nested `superviserWorkflowId` remains correctly out of scope. `auto-improve-superviser-mode` stays **Completed** in `impl-plans/PROGRESS.json`; active work remains this plan’s **TASK-002–004**. Added `superviser.test.ts` coverage: a **different** failure summary after a prior failure yields **rerun** only (no `patch-then-rerun`).

**Tasks In Progress**: TASK-002 (`call-step` depth / `call-node` delegation), TASK-003 (step-native engine follow-ups), TASK-004 (public-surface tail).

**Verification**: `bun test src/workflow/superviser.test.ts`, full `bun test`, `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh`.

### Session: 2026-04-26 (TASK-002: `rewriteCallStepFailureMessage` follow-ups)

**Tasks Completed**: Extended `rewriteCallStepFailureMessage` for optional-node, `user-action`, and execution-mailbox persistence errors delegated from `call-node` so `call-step` reports step-oriented wording; regression tests in `call-step.test.ts`.

**Tasks In Progress**: TASK-002 through TASK-004 (unchanged scope beyond this slice).

**Verification**: `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (976 pass).

### Session: 2026-04-26 (TASK-001 closure: legacy authorship env no longer required)

**Tasks Completed**: Re-validated architecture vs. design: `design-auto-improve-superviser-mode.md` Phase 1 remains aligned with the shipped engine-orchestrated supervision loop; nested `superviserWorkflowId` stays Phase 2. For this cutover plan, closed **PROGRESS.json** **TASK-001** as the **strictness / explicit legacy opt-in** slice (production defaults strict; tests do not require `DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT`; legacy fixtures use explicit `rejectLegacyWorkflowAuthoring: false` or `withLegacyWorkflowAuthorshipForCli`). Verified with `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (**972** pass). This does **not** complete the long Module 1 checklist in this file (primary-path schema still transitional). Updated `impl-plans/PROGRESS.json`: **TASK-001** → **Completed**, `lastUpdated` refreshed.

**Tasks In Progress**: TASK-002 (`call-step` depth vs `call-node` delegation), TASK-003 (step-native engine follow-ups), TASK-004 (public-surface tail). TASK-005 completed.

**Verification**: `bash scripts/run-bun-tests.sh`, `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh`, `bun run typecheck`, `bun run typecheck:server`.

### Session: 2026-04-25 (iteration: plan execution, full-suite verification, architecture)

**Tasks Completed**: Confirmed the active cutover plan remains the right scope: `auto-improve-superviser-mode` is **Completed** in `impl-plans/PROGRESS.json` (phase 130) and only `step-addressed-workflow-runtime-cutover` stays **In Progress**; `impl-plans/README.md` Active/Completed tables match. Re-read `design-workflow-json.md` *Current repository posture*: step-first inspection, `workflowCallsForExecutionMatch` for execution, derived `__cw:*` cross-workflow calls still match the code. No design split or new implementation plan was required. No additional code changes after diff review in this pass.

**Tasks In Progress**: TASK-001 (strict-primary-path / explicit `rejectLegacyWorkflowAuthoring` in legacy fixture loads), TASK-002 (`call-step` depth vs `call-node` delegation), TASK-003 (step-native engine follow-ups), TASK-004 (public-surface tail). TASK-005 completed.

**Verification**: `bun run typecheck`, `bun run typecheck:server`, `bash scripts/run-bun-tests.sh` (972 pass, 0 fail).

### Session: 2026-04-25 (TASK-001: ambiguous callee manager inference guard)

**Tasks Completed**: Re-checked the working tree against the plan’s *Current repository posture* and `design-workflow-json.md`; no design rewrite or new implementation plan was needed. Diff review found a concrete validation bug in the new cross-workflow callee-entry alignment helpers: when a callee omitted `managerStepId` but authored more than one manager-role step, sync/async validation inferred the callee start step by taking the first manager id instead of treating the callee entry as ambiguous. `src/workflow/validate.ts` now rejects that case unless the callee declares `managerStepId` explicitly, and `src/workflow/validate.test.ts` adds sync + async regressions.

**Tasks In Progress**: TASK-001 (strict-primary-path and remaining legacy-fixture follow-ups), TASK-002 (`call-step` depth), TASK-003 (remaining step-native engine follow-ups), TASK-004 (public surfaces). TASK-005 completed.

**Verification**: `bun test src/workflow/validate.test.ts`, `bun run typecheck`, `bun run typecheck:server`, `bash scripts/run-bun-tests.sh` (928 pass).

### Session: 2026-04-25 (TASK-001/TASK-003: file-backed callee manager-step validation)

**Tasks Completed**: Re-checked the working tree against the plan’s *Current repository posture* and `design-workflow-json.md`; no design rewrite was needed. Found and fixed a validation gap in the new cross-workflow step-transition callee-entry check: it inferred an implicit manager step only from inline `workflow.json.steps[]`, so valid callees that omitted `managerStepId` but declared their single manager-role step in `steps/*.json` could be rejected incorrectly. `src/workflow/validate.ts` now resolves file-backed step definitions while inferring the callee start step for both sync and async validation paths, and `src/workflow/validate.test.ts` adds regressions covering async + sync validation for that authored shape. Full-suite verification then exposed an unrelated library-test isolation issue: `src/lib.test.ts` relied on implicit runtime-db/session-store roots and could observe ambient process state during repository-wide runs, so the test now passes explicit `rootDataDir` and `sessionStoreRoot`.

**Tasks In Progress**: TASK-001 (strict-primary-path / legacy fixture follow-ups), TASK-002 (`call-step` depth), TASK-003 (remaining step-native engine follow-ups), TASK-004 (public surfaces). TASK-005 completed.

**Verification**: `bun test src/workflow/validate.test.ts`, `bun run typecheck`, `bun run typecheck:server`, `bash scripts/run-bun-tests.sh`.

### Session: 2026-04-25 (impl iteration: diff review, test script executable, auto-improve deps)

**Tasks Completed**: Re-checked the working tree against the plan’s *Current repository posture* and `design-workflow-json.md` (transitional model unchanged; no design update required). **Diff / hygiene**: `scripts/run-bun-tests.sh` was mode `644`, so `./scripts/run-bun-tests.sh` failed with *Permission denied*; repository now records the script as executable (`755`) so both `./scripts/...` and `bash scripts/...` work. **PROGRESS**: `auto-improve-superviser-mode` **TASK-001** and **TASK-003** no longer list a dependency on `step-addressed-workflow-runtime-cutover:TASK-005` (that cutover task is **Completed**); **TASK-001** `deps: []`, **TASK-003** `deps: ["TASK-002"]` only.

**Tasks In Progress**: TASK-001 (strict-primary-path / test legacy default), TASK-002 (`call-step` depth), TASK-003 (step-native engine follow-ups), TASK-004 (public-surface items). TASK-005 completed.

**Verification**: `bash scripts/run-bun-tests.sh` (922 pass), `bun run typecheck`, `bun run typecheck:server`.

### Session: 2026-04-25 (TASK-004: engine lastError step wording)

**Tasks Completed**: Aligned `runWorkflowInternal` failure strings with the existing `workflow.steps === undefined ? "node" : "step"` rerun convention: when a bundle authors `steps[]`, missing-target and non-executable payload failures now say `step` / `executable fields` / `missing step definition` instead of node-only phrasing (matches `rewriteCallStepFailureMessage` / direct `call-step` UX). **Architecture**: still matches the plan’s transitional posture; no design doc change.

**Tasks In Progress**: TASK-001 (strict-primary-path / legacy test default), TASK-002 (`call-step` depth), TASK-003 (step-native engine follow-ups), TASK-004 (remaining public-surface items). TASK-005 completed.

**Verification**: `bun run typecheck`, `bun run typecheck:server`, `bash scripts/run-bun-tests.sh` (922 pass).

### Session: 2026-04-25 (README phase table, TASK-001 explicit load flags)

**Tasks Completed**: Aligned `impl-plans/README.md` Phase Dependencies rows for phases **129** and **130** with `impl-plans/PROGRESS.json` (both **IN_PROGRESS**, not READY/PLANNING). **TASK-001** increment: `runtime-readiness.test.ts` now passes explicit `rejectLegacyWorkflowAuthoring` on disk loads—the step-addressed readiness fixture uses **strict** (`true`); the recursive `workflow-call` legacy bundle uses **legacy-compatible** (`false`) on `loadWorkflowFromDisk`. Workflow-call readiness cases that load legacy-shaped on-disk callees via `inspectWorkflowRuntimeReadiness` now pass `rejectLegacyWorkflowAuthoring: false` in probe options so `loadWorkflowByIdFromDisk` inside `probeWorkflowCallRuntime` succeeds without relying on `DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT`.

**Tasks In Progress**: TASK-001 (broader per-test explicit flags / drop `DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT`), TASK-002, TASK-003, TASK-004. TASK-005 completed.

**Verification**: `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bun test src/workflow/runtime-readiness.test.ts`, full `bash scripts/run-bun-tests.sh`, `bun run typecheck`, `bun run typecheck:server`.

### Session: 2026-04-25 (iteration: implementation-plan execution and diff review)

**Tasks Completed**: Re-checked the working tree against the plan’s *Current repository posture* and `design-workflow-json.md` (no design rewrite needed). **Diff / code review**: (1) `loadWorkflowFromDisk` no longer re-spreads `rejectLegacyWorkflowAuthoring: true` when forwarding options into async validation, since `...options` already carries the flag. (2) `impl-plans/README.md` Active Plans table now matches `PROGRESS.json` (`step-addressed-workflow-runtime-cutover` and `auto-improve-superviser-mode` as in progress, not "Ready/Planning" alone). (3) `crossWorkflowCallsFromSteps` documents that `.find` is well-defined because the validator rejects more than one `toWorkflowId` transition on the same step.

**Tasks In Progress**: TASK-001 (strict-primary-path / test legacy default, legacy-only code paths), TASK-002 (`call-step` / session depth), TASK-003 (step-native engine follow-ups; queue still compatibility-backed in places), TASK-004 (public-surface tail items). TASK-005 completed.

**Verification**: `bash scripts/run-bun-tests.sh` (922 pass), `bun run typecheck`, `bun run typecheck:server`.

### Session: 2026-04-25 (TASK-003: cross-workflow lowering + execution-merge regressions)

**Tasks Completed**: Re-checked architecture against the plan’s *Current repository posture*: step-derived `__cw:*` rows remain off normalized `workflow.workflowCalls`; engine unions explicit and derived calls via `workflowCallsForExecutionMatch` with `when` gating in `workflowCallMatchesCallerExecution`; queue/`resolveStepExecutionAddress` treat the runtime `nodeId` as the step id when `steps[]` is authored, so derived `callerNodeId: step.id` stays aligned with `executeWorkflowCallsForNode`. Added `cross-workflow-from-steps.test.ts` coverage for (1) `label` → `when` on lowered cross-workflow refs (matches `design-workflow-json` / engine `evaluateBranch` path) and (2) execution merge omitting a derived row when an explicit matching call already owns the same `__cw:` id.

**Tasks In Progress**: TASK-001 (strict-primary-path / test legacy default), TASK-002 (`call-step` depth), TASK-003 (step-native engine follow-ups beyond merged workflow-call execution), TASK-004 (public-surface checklist). TASK-005 completed.

**Verification**: `bun test src/workflow/cross-workflow-from-steps.test.ts`, `bun run typecheck`, `bun run typecheck:server`; full suite via `bash scripts/run-bun-tests.sh` after this change.

### Session: 2026-04-25 (TASK-002/TASK-004: call-step terminal-session failure wording)

**Tasks Completed**: Extended `rewriteCallStepFailureMessage` in `src/workflow/call-step.ts` so delegated `call-node` errors that use `cannot call node '` (terminal session guard) read as `cannot call step '` when the entrypoint is `call-step`. Added unit coverage on the rewriter plus a `callStep` regression that persists a completed session and asserts the surfaced message is step-oriented. Verified `bun run typecheck`, `bun run typecheck:server`, and full `bash scripts/run-bun-tests.sh` (920 pass).

**Tasks In Progress**: TASK-001 (strict-primary-path / test legacy default), TASK-003 (step-native engine follow-ups), TASK-004 (remaining public-surface checklist); TASK-002/TASK-004 deepen incrementally. TASK-005 completed.

### Session: 2026-04-25 (diff review: PROGRESS deps, call-node usage parity)

**Tasks Completed**: Corrected `impl-plans/PROGRESS.json` so `step-addressed-workflow-runtime-cutover` **TASK-005** has `deps: []` (examples/docs slice was completed independently; prior `TASK-002`–`TASK-004` deps contradicted recorded status). **TASK-004** follow-up: `call-node` missing-argument usage line now matches `printHelp` by appending the compatibility note to prefer `call-step` for step-addressed workflows; added `cli.test.ts` regression.

**Tasks In Progress**: TASK-001–004 unchanged. Re-verified architecture vs. plan: transitional posture still intentional; full breaking cutover (strict-only tests, step-native engine queue without `workflowCalls` merge) remains future work.

**Verification**: `bun test src/cli.test.ts -t "call-node usage on missing"` and full suite via project script (post-edit).

### Session: 2026-04-26 (TASK-002/TASK-004: call-step failure wording)

**Tasks Completed**: Extended `rewriteCallStepFailureMessage` in `src/workflow/call-step.ts` so delegated `call-node` errors that still used generic “node execution …” / “executable node fields” phrasing are rewritten when the entrypoint is `call-step`. Exported the helper for a focused unit test in `src/workflow/call-step.test.ts`. Re-checked architecture: still matches the plan’s transitional posture (step-first surfaces, `call-step` delegates through `call-node` with step id as execution key).

**Tasks In Progress**: TASK-001 (strict-primary-path depth / test legacy default), TASK-002 (`call-step` depth), TASK-003 (step-native engine follow-ups), TASK-004 (public surfaces); TASK-005 completed.

### Session: 2026-04-26 (diff review: examples copy, load regression title)

**Tasks Completed**: Re-reviewed the working tree against the plan posture (step-derived `__cw:*` workflow calls, `workflowCallsForExecutionMatch` execution order, strict default via `isStrictWorkflowAuthorshipValidation` outside tests). Aligned `examples/README.md` intro with migrated shipped bundles (no longer claims examples are "mixed" mid-cutover; notes test-only legacy loading). Renamed a stale `load.test.ts` case that still mentioned compatibility `workflowCalls` on the parent though `workflow-call-simple` has none. Full `bash scripts/run-bun-tests.sh` green.

**Tasks In Progress**: TASK-001 (strict-only primary path / test harness legacy default), TASK-002 (`call-step` depth), TASK-003 (step-native engine follow-ups), TASK-004 (public-surface tail items); TASK-005 completed.

### Session: 2026-04-25 (architecture check, CLI help: call-node vs call-step)

**Tasks Completed**: Re-verified implementation against the plan’s transitional posture: `normalizeStepAddressedWorkflow` keeps only **explicit** `workflow.workflowCalls` on the normalized bundle; cross-workflow step transitions are **not** merged into that array (runtime uses `crossWorkflowCallsFromSteps` plus `workflowCallsForExecutionMatch` for execution order). Confirmed production authorship defaults remain strict via `isStrictWorkflowAuthorshipValidation` while Vitest keeps `DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT=true`. Ran full `bash scripts/run-bun-tests.sh` (917 pass). **TASK-004** follow-up: `printHelp` now labels `call-node` as compatibility and points operators to `call-step` for step-addressed workflows; extended `cli.test.ts` unknown-scope help regression.

**Tasks In Progress**: TASK-001 (strict-primary-path depth / test harness legacy default), TASK-002 (`call-step` session depth), TASK-003 (step-native engine paths beyond the workflow-call primitive), TASK-004 (remaining public-surface checklist items); TASK-005 completed.

### Session: 2026-04-26 (architecture check, `LoadOptions` JSDoc vs strict default)

**Tasks Completed**: Re-verified the working tree against the plan’s transitional posture (step-first inspection; engine uses `workflowCallsForExecutionMatch`; cross-workflow step transitions execute as derived `__cw:*` workflow calls). Ran full `bash scripts/run-bun-tests.sh` (917 pass). Fixed inaccurate `rejectLegacyWorkflowAuthoring` documentation on `LoadOptions` in `src/workflow/types.ts`: an omitted option is not unconditionally strict—it follows `isStrictWorkflowAuthorshipValidation` and `DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT` in the test harness.

**Tasks In Progress**: TASK-001–004 unchanged (strict-primary-path depth, `call-step` vs `call-node`, step-native engine follow-ups, public surfaces); TASK-005 completed.

### Session: 2026-04-26 (TASK-003 hygiene: `workflowCallsForExecutionMatch`)

**Tasks Completed**: Extracted the explicit-then-step-derived workflow-call merge used by `executeWorkflowCallsForNode` into `workflowCallsForExecutionMatch()` in `src/workflow/cross-workflow-from-steps.ts`, with JSDoc cross-links to `effectiveWorkflowCalls` so inspection vs execution ordering cannot drift silently. Added unit coverage for explicit array order preservation plus trailing `__cw:*` rows. Synced this plan’s dependency table with actual module progress (no longer marks engine/examples as `BLOCKED`). Full `bash scripts/run-bun-tests.sh`, `bun run typecheck`, `bun run typecheck:server`.

**Tasks In Progress**: TASK-001 (strict authorship / legacy test default), TASK-002 (`call-step` depth), TASK-003 (remaining step-native engine paths), TASK-004 (public surfaces).

### Session: 2026-04-26 (architecture check: workflow-call execution order vs `effectiveWorkflowCalls`)

**Tasks Completed**: Diff review of `executeWorkflowCallsForNode`: the explicit-then-step-derived merge is **not** equivalent to filtering `effectiveWorkflowCalls` because the latter uses Map insertion order (derived entries then explicit-only ids) while **runtime** must keep authored `workflow.workflowCalls` order for matching explicit calls. Documented in `src/workflow/engine.ts` and on `effectiveWorkflowCalls` in `src/workflow/cross-workflow-from-steps.ts` so refactors do not conflate inspection vs execution ordering. Full `bash scripts/run-bun-tests.sh` (916 pass), `bun run typecheck`, `bun run typecheck:server`.

**Tasks In Progress**: TASK-001 (remove validation legacy-env escape hatch in tests / finish strict-only paths), TASK-002 (`call-step` session depth), TASK-003 (further step-native engine paths), TASK-004 (public surfaces). TASK-005 remains completed (examples/docs slice).

### Session: 2026-04-25 (TASK-001: production default strict authorship validation)

**Tasks Completed**: Introduced `isStrictWorkflowAuthorshipValidation()` so omitted `rejectLegacyWorkflowAuthoring` is **strict** outside tests (rejects legacy authored fields on the primary validate/load path). Test and transitional runs set `DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT=true` via `scripts/run-bun-tests.sh` and `vitest.config.ts`. Aligned `saveWorkflowToDisk` strict gate with the same helper. Simplified `loadWorkflowFromDisk` validation forwarding. Extended `validate.test.ts` with explicit `legacyWorkflowAuthorshipOk` on compatibility-path cases and a regression that strict default applies when the env var is unset. Ran `bash scripts/run-bun-tests.sh` (916 pass), `bun run typecheck`, `bun run typecheck:server`.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004; TASK-001 checklist items that require removing the test env escape hatch or finishing legacy-only code paths.

### Session: 2026-04-26 (close TASK-005: track assets, unblock dependent plan)

**Tasks Completed**: Staged previously untracked `cross-workflow-from-steps.test.ts`, debate `nodes/node-debate-*.json`, and `prompts/debate-*.md` for `codex-codex-euthanasia-debate` so the strict-load example and bundle are complete in git. Marked `step-addressed-workflow-runtime-cutover` **TASK-005** (examples/docs/regressions) **Completed** in `impl-plans/PROGRESS.json`. Unblocked `auto-improve-superviser-mode` **TASK-001** (was waiting on cutover TASK-005); set phase 130 to in progress. Re-ran `bun test` (915 pass), `bun test src/workflow/cross-workflow-from-steps.test.ts` (4 pass). **Remaining cutover work** stays on TASK-001 (repository-wide `rejectLegacyWorkflowAuthoring: true` default), TASK-002 (call-step/session depth), TASK-003 (step-native engine queue vs `effectiveWorkflowCalls` merge), TASK-004 (public surfaces); architecture still matches the plan’s *Current repository posture*.

**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004

### Session: 2026-04-26 (TASK-005: migrate `codex-codex-euthanasia-debate` off structural sub-workflows)

**Tasks Completed**: Replaced authored `subWorkflows` / `subWorkflowConversations` / `edges` with `managerStepId`, `entryStepId`, registry `nodes[]`, and `steps[]` (affirmative chain, negative chain, `debate-judge` with `continue_debate` / `!(continue_debate)` labels, `debate-summary`). Added `nodes/node-debate-judge.json`, `nodes/node-debate-summary.json`, prompts, sixth-round mock entries for the negative lane, and fixed `debate-judge` mock to publish branch booleans via adapter `when` (same contract as `foreach-judge`). Updated `EXPECTED_RESULTS.md` (55 transitions, `conversationTurns: 0`), READMEs, consolidated prompt-layering docs, and `load.test.ts` (strict load list + all examples omit structural fields). Verified `workflow validate`, mock `workflow run` (56 executions), pending full CI test run.

**Tasks In Progress**: TASK-001 (global strict default / remaining checklist), TASK-002, TASK-003, TASK-004; TASK-005 closer (docs checklist may still have tail items).

**Blockers**: TASK-003 depth (step-native queue vs compatibility merge); TASK-001 if any code path still assumes mixed defaults.

### Session: 2026-04-26 (effectiveWorkflowCalls unit coverage, architecture check)

**Tasks Completed**: Added `src/workflow/cross-workflow-from-steps.test.ts` covering `effectiveWorkflowCalls` (union of explicit and step-derived ids, explicit override on `__cw:` id collision) and `crossWorkflowCallsFromSteps` (undefined steps, missing `resumeStepId`). Confirmed design posture: step-first inspection via `effectiveWorkflowCalls` in `buildInspectionSummary`, runtime/engine still unioning explicit matches with `crossWorkflowCallsFromSteps` in `executeWorkflowCallsForNode`—aligned with "Current repository posture". Full `bun run typecheck`, `bun run typecheck:server`, `bun test` (915 pass).

**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004; TASK-005 still blocked on `codex-codex-euthanasia-debate` / strict default until structural example migrates or is replaced.

**Blockers**: Unchanged long pole: legacy debate bundle; repository-wide `rejectLegacyWorkflowAuthoring: true` default; full step-native queue without compatibility `workflowCalls` merge (TASK-003 depth).

### Session: 2026-04-25 (iteration: track cross-workflow helper, diff review, verification)

**Tasks Completed**: Ensured `src/workflow/cross-workflow-from-steps.ts` is tracked in git (was `??` while already imported from `validate.ts`, `engine.ts`, `inspect.ts`, `runtime-readiness.ts`, `node-execution-mailbox.ts`, TUI rendering, and tests). Re-read design posture vs. code: step-first inspection, explicit `workflowCalls` only on normalized bundles when authored, cross-workflow step transitions executed via `crossWorkflowCallsFromSteps` / `effectiveWorkflowCalls` union with explicit calls—matches `design-workflow-json.md` and the plan’s “Current repository posture”. No code defects found requiring changes in this pass.

**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004; TASK-005 remains blocked on `codex-codex-euthanasia-debate` / strict default sweep.

**Verification**: `bun run typecheck`, `bun run typecheck:server`, full `bun test` (911 pass).

### Session: 2026-04-25 (TASK-003: step-derived cross-workflow calls without normalized-bundle merge)

**Tasks Completed**: Cross-workflow `steps[].transitions` are no longer merged into `workflow.workflowCalls` during `normalizeStepAddressedWorkflow`. Added `src/workflow/cross-workflow-from-steps.ts` (`crossWorkflowCallsFromSteps`, `effectiveWorkflowCalls`). `executeWorkflowCallsForNode` unions explicit `workflowCalls` with step-derived calls using shared caller/`when` matching. Runtime readiness recursion, `buildInspectionSummary`, TUI workflow rendering, and manager mailbox reasons use `effectiveWorkflowCalls`. Validation still uses derived ids for collision checks with explicit `workflowCalls`. Updated `validate.test.ts`, `load.test.ts`, `design-workflow-json.md` (StepTransition `label` / cross-workflow execution note), READMEs, and `workflow-call-simple` EXPECTED_RESULTS wording. Full `bun run typecheck`, `bun run typecheck:server`, and `bun test` green.

**Tasks In Progress**: TASK-001, TASK-002, TASK-004, TASK-005 (TASK-003 closer: queue still compatibility-backed in other areas; full `call-step` primitive unification remains).

**Blockers**: TASK-001 strict default and TASK-005 full example sweep still gated on `codex-codex-euthanasia-debate`; deeper TASK-003 items (if any) per plan checklists (obsolete structural runtime paths, etc.).

### Session: 2026-04-25 (TASK-001: validation regression — cross-workflow + explicit `workflowCalls` edge cases)

**Tasks Completed**: Added `validate.test.ts` coverage for two previously untested `normalizeStepAddressedWorkflow` boundaries that matter whenever transitional bundles allow top-level `workflowCalls` (`rejectLegacyWorkflowAuthoring: false`): (1) explicit `workflowCalls` targeting the same caller step as an authored `toWorkflowId` step transition is rejected; (2) an explicit `workflowCall.id` that collides with a lowered `__cw:<callerStepId>` id is rejected even when the explicit call is attributed to a different step (reserved-id guard). `bun run typecheck`, `bun run typecheck:server`, and full `bun test` (911 pass).

**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Blockers**: Unchanged: TASK-003 step-native queue without merged compatibility `workflowCalls`; TASK-001 strict default and TASK-005 full example sweep still gated on `codex-codex-euthanasia-debate` (structural `subWorkflows` / `subWorkflowConversations`).

### Session: 2026-04-25 (TASK-001: regression for lowered transition `label` to `when`)

**Tasks Completed**: Added `validate.test.ts` coverage that a cross-workflow step transition with `label` lowers to `workflowCalls[]` carrying the same string as `when`, matching `design-workflow-json.md` and `normalizeStepAddressedWorkflow`. Ran `bun test src/workflow/validate.test.ts -t "lowers cross-workflow step transition label"` and full `bun test` (909 pass), `bun run typecheck`, `bun run typecheck:server`.

**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Blockers**: Unchanged: TASK-003 step-native execution without merged compatibility `workflowCalls`; TASK-001 repository-wide strict default and TASK-005 full example sweep still gated on `codex-codex-euthanasia-debate` (structural `subWorkflows` / `subWorkflowConversations`).

### Session: 2026-04-25 (diff review, workflow-call `when` regression, verification)

**Tasks Completed**: Re-checked the cutover design references and the working tree: transitional architecture (step-first inspection, lowered `workflowCalls` for cross-workflow step transitions) still matches the plan; no new design document or split implementation plan. **Correction (historical log)**: an older 2026-04-24 progress entry still states `node-combinations-showcase` uses legacy ordered-node `repeat`; that is **superseded** by the 2026-04-25 migration in this plan log (`steps[]` + judge-step transitions, strict load coverage). Uncommitted diff review: `executeWorkflowCallsForNode` `when` gating is easy to break without a focused test; added `runWorkflow` regression `skips a workflow call when \`when\` does not match caller output` in `src/workflow/engine.test.ts` using `createWhenGatedWorkflowCallFixture` and `when: "need_review"` (deterministic adapter output does not set it, so the callee is not run and no `workflow-call:*` communication is recorded). Ran `bun test src/workflow/engine.test.ts -t "skips a workflow call when"`, full `bun test` (908 pass), `bun run typecheck`, and `bun run typecheck:server`.

**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Blockers** (unchanged for the long pole): TASK-003 step-native execution without merged compatibility `workflowCalls`; repository-wide `rejectLegacyWorkflowAuthoring` default and TASK-005 full example sweep still blocked on `codex-codex-euthanasia-debate` (structural `subWorkflows` / `subWorkflowConversations`).

### Session: 2026-04-26 (architecture check, uncommitted diff review, verification)

**Tasks Completed**: Re-read `design-workflow-json.md` and the active plan against the working tree: the **Current repository posture** (step-first public surfaces, validate-time projection/lowering, engine still consuming merged `workflowCalls` including `__cw:<callerStepId>`) remains the intended incremental ship model toward the breaking cutover; no new design document or replacement plan. Independently reviewed the uncommitted diff: cross-workflow step transitions, callee entry alignment in sync/async validation, `executeWorkflowCallsForNode` `when` gating, example migrations (`workflow-call-simple`, `node-combinations-showcase`), and inspection/CLI/GraphQL/TUI alignment are consistent; no defects found that required a code fix in this pass. Ran full `bun test` (907 pass), `bun run typecheck`, and `bun run typecheck:server`.

**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Blockers**: Unchanged: TASK-003 step-native execution queue without merged compatibility `workflowCalls`; TASK-001 strict default loading and TASK-005 full example/doc cutover still gated on `codex-codex-euthanasia-debate` and remaining runtime work.

### Session: 2026-04-25 (sync validation: cross-workflow callee entry alignment)

**Tasks Completed**: TASK-001 follow-up: `validateWorkflowBundleDetailed` (sync) now runs the same cross-workflow `toStepId` vs callee entry check as `validateWorkflowBundleDetailedAsync` when `workflowRoot` is set, via shared `parseCalleeWorkflowEntryFromJsonText` and `validateCrossWorkflowCalleeEntryAlignmentSync`. Eliminates a footgun where `validateWorkflowBundle()` could accept mismatched callee targets that async load/save/GraphQL validation would reject. Added `validate.test.ts` regression. `bun run typecheck`, `bun run typecheck:server`, and full `bun test` (907 pass).

**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Blockers**: Unchanged: TASK-003 step-native queue without merged compatibility `workflowCalls`; TASK-001 strict default and TASK-005 full example migration still blocked on `codex-codex-euthanasia-debate` and remaining runtime work.

### Session: 2026-04-25 (design alignment: step transition `label` vs routing)

**Tasks Completed**: Verified the working tree against the cutover plan: transitional step-first inspection plus compatibility projections and lowered cross-workflow calls still match the intended posture; full `bun run typecheck`, `bun run typecheck:server`, and `bun test` (906 pass). Fixed a real spec drift in `design-docs/specs/design-workflow-json.md`: `StepTransition.label` is not merely descriptive—the loader/validator projects local transitions onto compatibility `edges[]` with `when: label ?? "always"` and maps optional `label` on cross-workflow transitions to lowered `workflowCalls[].when`, consistent with `src/workflow/validate.ts`.

**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Blockers**: Unchanged: TASK-003 step-native queue without merged compatibility `workflowCalls`; TASK-001 repository-wide strict default and TASK-005 complete example/doc replacement still blocked on `codex-codex-euthanasia-debate` (structural `subWorkflows` + `subWorkflowConversations` required for alternating debate turns until a step-native conversation primitive exists or the demo is simplified).

**Notes**: Migrating the euthanasia debate bundle to pure step-addressed authoring without `subWorkflowConversations` would drop or require re-engineering `executeConversationRound` semantics; the explicit legacy example boundary in `src/workflow/load.test.ts` remains intentional.

### Session: 2026-04-25 (TASK-004/TASK-005 copy: cross-workflow step transitions)

**Tasks Completed**: Aligned user-facing guidance with the lowered cross-workflow model: `buildInspectionSummary` compatibility note for structural `subWorkflows` now points authors to `steps[].transitions` with `toWorkflowId` + `resumeStepId` (or explicit `workflowCalls`) instead of naming only workflowCalls. Updated `buildNodeExecutionMailbox` role-authored rules, `parseManagerControlActions` error text, and matching tests (`manager-control`, `prompt-composition`, `engine`). Full `bun run typecheck`, `bun run typecheck:server`, and `bun test` (906 pass). Architecture unchanged: runtime still executes lowered `workflowCalls`; TASK-003 step-native queue without merged calls remains future work.

**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Blockers**: Unchanged (TASK-003 engine step-native cross-workflow path; TASK-001 strict default and TASK-005 legacy debate example migration).

### Session: 2026-04-26 (examples README drift after node-combinations migration)

**Tasks Completed**: Diff review follow-up: `examples/README.md` still claimed `node-combinations-showcase` depended on ordered-node `repeat` metadata even though that bundle was migrated to strict step-addressed authoring (judge-step transitions). Updated the intro bullets to describe the current boundary: step-addressed `workflow-call-simple`, structural `subWorkflows` limited to `codex-codex-euthanasia-debate`, removed stale repeat/ordered-node wording. Re-ran `bun run typecheck`, `bun run typecheck:server`, and full `bun test` (906 pass). Architecture/design unchanged; transitional cutover posture still matches the plan opening.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Unchanged: TASK-003 step-native queue without compat `workflowCalls` merge; TASK-005 / TASK-001 strict default blocked on `codex-codex-euthanasia-debate` and remaining runtime work.

### Session: 2026-04-26 (callee entry alignment for cross-workflow transitions)

**Tasks Completed**: TASK-001/TASK-003 follow-up: `validateWorkflowBundleDetailedAsync` now checks cross-workflow step transitions when `workflowRoot` is set: reads each callee’s `workflow.json` and requires `toStepId` to match the callee’s effective start step (`managerStepId` if present, else `entryStepId` or `entryNodeId`), aligned with `runWorkflowInternal`’s `initialNodeId: workflow.managerRuntimeId` and `design-workflow-json.md` StepTransition rules. Skips the check when `workflowRoot` is absent (in-memory / sync-only validation). Added `validate.test.ts` coverage for mismatch vs match. Full `bun run typecheck`, `bun run typecheck:server`, and `bun test` green.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Remaining: full step-native queue without compat `workflowCalls` merge; `codex-codex-euthanasia-debate`; other legacy examples for TASK-001 strict default.
**Notes**: Supersedes the prior “callee toStepId not yet enforced” blocker for disk-backed validation; sync `validateWorkflowBundleDetailed` now applies the same callee FS checks when `workflowRoot` is set (see session “sync validation: cross-workflow callee entry alignment”).

### Session: 2026-04-26 (cross-workflow step transition lowering)

**Tasks Completed**: TASK-003/TASK-005 slice: implemented authored cross-workflow step transitions (`toWorkflowId` + `toStepId` + required `resumeStepId`, optional `label` mapped to runtime gating). Step-addressed validation now lowers each such transition into a deterministic runtime `workflowCall` (`id` `__cw:<callerStepId>`), merges it into the normalized bundle, forbids mixing explicit `workflowCalls` on the same caller step, and caps one cross-workflow transition per step. `executeWorkflowCallsForNode` honors optional `when` on `WorkflowCallRef` via `evaluateBranch`. Migrated `examples/workflow-call-simple` off top-level `workflowCalls` so it loads under `rejectLegacyWorkflowAuthoring: true`; updated docs (`design-docs/specs/design-workflow-json.md`, READMEs, EXPECTED_RESULTS) and tests (`validate`, `load`, `engine`). Ran `bun run typecheck`, `bun run typecheck:server`, and full `bun test`.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers** (at the time of this sub-session): callee entry alignment for `toStepId` was still pending; later implemented in the “callee entry alignment” session above. Remaining: full step-native queue without compat `workflowCalls` merge; `codex-codex-euthanasia-debate`; other legacy examples for TASK-001 strict default.
**Notes**: Replaces the short-lived “reject toWorkflowId” validation: authors use step transitions; runtime still executes through the workflow-call path until call-step fully subsumes it.

### Session: 2026-04-25 (node-combinations-showcase copy alignment)

**Tasks Completed**: TASK-005 follow-up: aligned manager prompt template, `EXPECTED_RESULTS.md`, `mock-scenario.json` foreach-output summary, and foreach-lane prompts (`divedra-manager`, `foreach-manager`, `foreach-output`) with step-addressed foreach wording (judge transitions / labeled edges) instead of legacy “repeat-based foreach” phrasing. Re-ran `workflow validate`, mock `workflow run` for the bundle, and confirmed prior full `bun test` / typecheck green on the pre-change tree; re-validated mock run after edits.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Unchanged: TASK-003 engine/`toWorkflowId` transition lowering and step-native queue; TASK-005 `codex-codex-euthanasia-debate` structural migration and remaining `workflowCalls` docs touch-ups; TASK-001 strict default until the legacy debate bundle migrates.
**Notes**: Architecture still matches “Current repository posture”; no design doc fork. Independent diff review of the prior inspection/TUI/GraphQL slice found no defects requiring code changes in this pass.

### Session: 2026-04-25 (node-combinations-showcase step-addressed migration)

**Tasks Completed**: TASK-001/TASK-005 slice: migrated `examples/node-combinations-showcase/workflow.json` from legacy ordered `nodes[]` with node-local `repeat` to canonical `managerStepId` / `entryStepId`, reusable registry entries (`id` + `nodeFile` only), and explicit `steps[]` transitions. The foreach judge step now declares two transitions with labels `continue_items` and `!(continue_items)` so runtime edge evaluation matches the former synthesized repeat edges without `workflow.loops`. Extended `src/workflow/load.test.ts` strict `rejectLegacyWorkflowAuthoring: true` coverage to include this bundle; updated `examples/README.md` and root `README.md` catalog notes. Verified `workflow validate`, mock `workflow run` (still 22 executions / 21 transitions), `bun test src/workflow/load.test.ts`, `bun run typecheck`, and full `bun test`.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Unchanged at the program level: TASK-003 engine/step-native cross-workflow lowering; TASK-005 remaining docs and `workflowCalls` / structural debate example; TASK-001 strict default until those fixtures migrate.

### Session: 2026-04-25 (TUI legacy inspect identity alignment)

**Tasks Completed**: TASK-004 follow-up: `buildWorkflowDefinitionContent` legacy branch now uses the same authorship fallbacks as `workflow inspect` text mode for missing `managerRuntimeId` / `entryNodeId` (`(not set; check workflow authorship)`), avoiding empty or misleading `undefined` display when optional fields are absent on in-memory bundles. Added a regression that loads a deliberately incomplete legacy-shaped `WorkflowJson` (via test-only assertion) and expects both lines. Re-ran `bun run typecheck` and full `bun test`; all green.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Unchanged: TASK-001 strict global loading (mixed examples), TASK-003 engine/cross-workflow cutover, TASK-005 example and doc migration.

### Session: 2026-04-25 (diff review, verification, architecture)

**Tasks Completed**: Independent review of the working-tree diff for the inspection contract slice: `buildInspectionSummary` (step-first counts, `structuralProjection`, compatibility note gating for effective-entry on legacy-only paths), `workflow inspect` text mode (`isStepAddressedInspect` from authored `steps`, invariant on `structuralProjection`, single `compatibility:` line with three booleans), executable GraphQL `WorkflowCompatibility` on `WorkflowView`, TUI `buildWorkflowDefinitionContent` step-first `identityLines`. Re-ran `bun run typecheck`, `bun run typecheck:server`, and full `bun test`; all green. Transitional design still matches the plan opening plus "Current repository posture"; no design fork or additional implementation plan required. No further code changes needed in this pass.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Unchanged: TASK-001 strict global step-addressed loading (mixed examples), TASK-003 engine/step-native queue and cross-workflow lowering, TASK-005 strict example and doc replacement.

### Session: 2026-04-25 (CLI inspect compatibility flags, text/json parity)

**Tasks Completed**: TASK-004 follow-up: `workflow inspect` text mode now always prints a single `compatibility:` line with the same three booleans as JSON/GraphQL (`normalizesRoleAuthoredNodesToStructuralKinds`, `usesEffectiveEntryManagerNodeId`, `usesLegacyStructuralSubWorkflows`), so operator text output is not silent when `compatibility.notes` is empty. Follow-up notes use a `compatibility notes:` header with the existing bullet list. Extended `create --worker-only` and workflow-call inspect text regressions accordingly.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Unchanged: TASK-003 engine/cross-workflow cutover, TASK-005 strict example migration, TASK-001 strict global loading.
**Notes**: `bun run typecheck`, `bun run typecheck:server`, and full `bun test` green.

### Session: 2026-04-25 (GraphQL HTTP workflow compatibility)

**Tasks Completed**: TASK-004 follow-up: added `WorkflowCompatibility` to the executable GraphQL schema and `compatibility: WorkflowCompatibility!` on `WorkflowView`, matching `buildInspectionSummary` and the in-process GraphQL tests (which already read `workflow.compatibility`). Extended the worker-only `/graphql` inspection regression to query `compatibility { usesEffectiveEntryManagerNodeId notes }` and assert step-addressed worker-only bundles omit the legacy-only effective-entry normalization note.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Unchanged: TASK-003 engine/cross-workflow cutover, TASK-005 strict example migration, TASK-001 strict global loading.
**Notes**: `bun run typecheck`, `bun run typecheck:server`, and full `bun test` green.

### Session: 2026-04-25 (architecture note and verification)

**Tasks Completed**: Added a "Current repository posture" subsection to align the plan opening (target breaking cutover) with the shipped transitional model (step-first inspection when `steps[]` is authored, compatibility runtime still active until deeper tasks land). Ran full `bun run typecheck`, `bun run typecheck:server`, and `bun test` on the working tree; all green. Reviewed the uncommitted inspection-contract slice (`buildInspectionSummary`, CLI/GraphQL/TUI, tests): consistent with the posture above; no additional code fixes required in this pass.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Unchanged: TASK-003 engine/cross-workflow cutover, TASK-005 strict example migration, and TASK-001 strict global loading remain the long pole; TASK-004 inspection alignment continues to receive small follow-ups as needed.

### Session: 2026-04-25 (CLI inspect step-addressed predicate)

**Tasks Completed**: Small TASK-004 follow-up: `workflow inspect` text mode now derives step-vs-legacy branching from `loaded.bundle.workflow.steps !== undefined`, matching `buildInspectionSummary` instead of inferring from `counts.structuralProjection` (avoids accidental drift if count shapes change). Added an explicit `structuralProjection` guard in the text counts line so strict TypeScript narrowing stays sound and a broken summary fails fast instead of printing `undefined`.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Unchanged: TASK-003 engine/cross-workflow cutover, TASK-005 strict example migration, and TASK-001 strict global loading remain blocked on legacy/compat fixtures and deeper runtime work.
**Notes**: `bun run typecheck`, `bun run typecheck:server`, and full `bun test` green after the change.

### Session: 2026-04-24 (impl verification and CLI inspect DRY)

**Tasks Completed**: Architecture/design review against the cutover plan (transitional step-first inspection plus compatibility runtime remains the intended ship posture; no new design document or replacement plan). Full `bun run typecheck`, `bun run typecheck:server`, and `bun test` verification; diff review of the inspection-contract slice (`WorkflowInspectionCounts`, `structuralProjection`, library re-exports, CLI/GraphQL/TUI). Small TASK-004 follow-up: `workflow inspect` text mode now uses a single `isStepAddressedInspect` flag derived from `counts.structuralProjection` instead of duplicating the same predicate.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Unchanged: TASK-003 engine/cross-workflow cutover, TASK-005 strict example migration, and TASK-001 strict global loading remain blocked on remaining legacy/compat examples and deeper runtime work.
**Notes**: After `src/cli.ts` DRY, `bun test src/cli.test.ts`, `bun run typecheck`, and `bun run typecheck:server` green.

### Session: 2026-04-24 (library inspection type exports)

**Tasks Completed**: Small TASK-004 follow-up: re-exported `WorkflowInspectionSummary`, `WorkflowInspectionCounts`, and `WorkflowStructuralProjectionCounts` from `src/lib.ts` so library consumers can type `inspectWorkflow()` and nested count shapes without importing from `workflow/inspect` internals.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Unchanged: TASK-003 engine/cross-workflow cutover, TASK-005 strict example migration, and TASK-001 strict global loading remain blocked on mixed legacy fixtures and deeper runtime work.
**Notes**: Architecture still matches the transitional step-first inspection contract; no design doc changes. `bun run typecheck`, `bun run typecheck:server`, and full `bun test` green after the export addition.

### Session: 2026-04-24 (CLI inspect legacy fallback)

**Tasks Completed**: Small TASK-004 follow-up: legacy `workflow inspect` text mode now uses the same `entryNodeId` missing-value fallback as step-addressed `entryStepId` (`(not set; check workflow authorship)`) instead of printing an empty value after `entryNodeId:`.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Unchanged: TASK-005 and strict example migration still blocked on TASK-003 engine/cross-workflow cutover and remaining legacy fixtures; TASK-001 strict global loading still blocked on mixed examples.
**Notes**: Re-checked the plan against the working tree: transitional “step-first inspection, compatibility runtime projection” remains aligned with design references; no new design doc or plan fork required. `bun run typecheck`, `bun run typecheck:server`, and full `bun test` green after the CLI tweak.

### Session: 2026-04-24 (architecture and diff review)

**Tasks Completed**: Independent review of the working-tree inspection-contract slice (`WorkflowInspectionCounts`, `structuralProjection`, optional legacy `entryNodeId` / `managerRuntimeId`) against the active cutover plan and design references
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Unchanged. `node-combinations-showcase` remains on legacy ordered-node authoring with node-local `repeat` (strict step-addressed registry still rejects that pattern; see prior progress notes). `codex-codex-euthanasia-debate` remains on structural `subWorkflows`. TASK-003 engine/step-native queue and full cross-workflow lowering remain pending.
**Notes**: Design intent (transitional runtime with step-first public inspection) still matches the plan; no replacement design or new plan was required. Confirmed CLI legacy vs step-addressed branches, GraphQL SDL nullability, and TUI definition pane identity lines are mutually consistent with `buildInspectionSummary`. Worker-only **legacy** fixtures still surface top-level node counts and the effective-entry compatibility note; worker-only **scaffolded** step-addressed bundles use `entryStepId` and `structuralProjection` only (see `src/cli.test.ts`). Re-ran `bun run typecheck`, `bun run typecheck:server`, and full `bun test`; all green. No code changes in this pass beyond this log entry.

### Session: 2026-04-24 (agent verification)

**Tasks Completed**: Review and verification of in-progress inspection-contract slice (no additional code changes required)
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Unchanged: TASK-003 engine/deterministic manager cutover and TASK-005 examples/docs replacement remain blocked on deeper runtime work; TASK-001 strict global loading still blocked on remaining legacy fixtures.
**Notes**: Re-read design references and the active plan against the working-tree diff. The transitional architecture still matches the plan: step-authored bundles keep compatibility runtime projections while inspection surfaces are step-first. Confirmed `WorkflowInspectionCounts` / `structuralProjection` alignment across `buildInspectionSummary`, CLI text/json, executable GraphQL SDL, TUI definition pane, and tests. Ran `bun run typecheck`, `bun run typecheck:server`, and full `bun test`; all green. No defect found that required a follow-up patch in this pass.

### Session: 2026-04-24 (TUI definition pane)

**Tasks Completed**: Partial TASK-004 OpenTUI workflow definition text alignment with step-addressed inspection contract (`buildWorkflowDefinitionContent` omits legacy manager/entry node lines when `steps[]` is authored; step-first labels with CLI-consistent fallbacks)
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Unchanged: TASK-005 blocked on engine/cross-workflow cutover; TASK-003 engine and TASK-001 strict loading still pending.
**Notes**: Regressions in `src/tui/opentui-screen.test.ts`; `bun run typecheck` and full `bun test` green.

### Session: 2026-04-24 (continuation)

**Tasks Completed**: Partial TASK-001 / TASK-004 step-addressed inspection summary contract (`WorkflowInspectionCounts`, `structuralProjection`, optional legacy `entryNodeId` / `managerRuntimeId`)
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Unchanged: TASK-005 remains blocked on broader engine/cross-workflow cutover; TASK-003 engine work and TASK-001 strict global loading still pending mixed fixtures.
**Notes**: Tightened `buildInspectionSummary` so step-addressed bundles no longer surface synthetic `entryNodeId` and expose internal graph sizes only under `counts.structuralProjection` while keeping top-level `steps` / `nodeRegistry` as the primary counts. Updated CLI text output, executable GraphQL SDL (`WorkflowCounts`, nullable `entryNodeId`), and regressions. Added library `inspectWorkflow` assertions for the step-addressed scaffold shape. Re-ran `bun run typecheck` and `bun test` (full suite green).

### Session: 2026-04-24 (cursor continuation)

**Tasks Completed**: Partial TASK-001/TASK-003 workflow-call caller step disambiguation (`callerStepId` authoring + validation + engine dispatch + artifacts/runtime variables)
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Blockers**: Full cross-workflow lowering to step `transitions[].toWorkflowId` remains pending; `workflowCalls` compatibility path is still required for strict-schema rejection cases and non-step bundles.
**Notes**: Added optional `callerStepId` on `WorkflowCallRef` with semantic checks (step-addressed bundles require `callerNodeId === callerStepId` because compat execution ids are step ids), tightened `executeWorkflowCallsForNode` matching when `callerStepId` is authored, persisted the field on workflow-call artifacts and `workflowCall` runtime variables, migrated `examples/workflow-call-simple` to author `callerStepId`, and added focused validation regressions plus load expectation updates. Updated the plan module status table so the engine row reflects `IN_PROGRESS` instead of `NOT_STARTED`.

### Session: 2026-04-24 22:24 JST

**Tasks Completed**: Review/fix follow-up for TASK-002/TASK-004 call-step user-facing wording alignment
**Tasks In Progress**: TASK-001, TASK-002, TASK-004, TASK-005
**Blockers**: The broader blocker boundary is unchanged. The repository still intentionally supports a mixed transitional state while TASK-003 and the remaining TASK-005 migration work are pending, so cross-workflow lowering and a few compatibility examples are still not fully step-native.
**Notes**: Re-checked the current architecture and active cutover plan against the working-tree diff before changing anything. The design still matches the intended transitional purpose, so no replacement design document or new implementation plan was needed. Review found a real public-surface consistency gap in the direct `call-step` wrapper: it returned several node-oriented failure messages because the implementation delegates through the compatibility `call-node` path and only added `stepId` to the result shape. Updated `src/workflow/call-step.ts` so direct step failures now rewrite the user-facing wording to `step` / `call-step` where the surfaced target is the requested step id, and added focused regressions in `src/workflow/call-step.test.ts` for missing prompt variants and missing step targets. Also corrected the TASK-005 examples/docs module header in this plan from `NOT_STARTED` to `IN_PROGRESS` so the top-level module section matches the existing status table and progress log. Verification for this slice is covered by focused `call-step` tests and typecheck.

### Session: 2026-04-24 21:41 JST

**Tasks Completed**: Review/fix follow-up for TASK-005 command/container example documentation alignment
**Tasks In Progress**: TASK-001, TASK-002, TASK-004, TASK-005
**Blockers**: The broader blocker boundary is unchanged. The repository still intentionally supports a mixed transitional state while TASK-003 and the remaining TASK-005 migration work are pending, so cross-workflow lowering and a few compatibility examples are still not fully step-native.
**Notes**: Re-checked the current architecture and active cutover plan against the working-tree diff before editing. The design still matches the intended transitional purpose, so no replacement design document or new implementation plan was needed. Review found a concrete documentation drift in `examples/README.md`: the example notes still claimed live `workflow run` could not execute real `command` or `container` nodes, but the shipped runtime already executes those node types through the native executor and reports any missing local tooling through runtime-readiness blockers. Updated the example docs for `node-combinations-showcase` and `first-four-arithmetic-pipeline` so they now describe live execution as supported when local shell/container prerequisites are present and position the bundled mock scenarios as the deterministic verification path instead of a workaround for missing runtime support. TASK-005 remains in progress because the workflow-call compatibility example and the remaining legacy references are still outstanding.

### Session: 2026-04-24 18:36 JST

**Tasks Completed**: Partial TASK-001/TASK-005 workflow-call parent example step-addressed migration and compatibility-validation alignment
**Tasks In Progress**: TASK-001, TASK-002, TASK-004, TASK-005
**Blockers**: The broader blocker boundary is unchanged. TASK-003 still represents the deeper engine/runtime cutover, and TASK-005 still has remaining legacy references after this example migration. Cross-workflow dispatch continues to rely on compatibility `workflowCalls` even though the parent example now uses step-addressed authoring.
**Notes**: Re-checked the active architecture and implementation plan against the current working-tree diff before continuing. The design still matches the intended transitional purpose, so no replacement design document or new plan was needed. Review uncovered a real schema/runtime mismatch instead of just stale example docs: the repository documentation already described `workflowCalls` as a compatibility path that can coexist with ongoing step-addressed migration work, but `normalizeStepAddressedWorkflow()` still rejected `workflowCalls` unconditionally whenever a bundle authored `steps[]`. Fixed that validation boundary so non-strict validation preserves compatibility `workflowCalls` on step-addressed bundles while strict authored-schema mode still rejects them. With that support in place, migrated `examples/workflow-call-simple` from legacy `managerRuntimeId`/`edges` authoring to `managerStepId`/`entryStepId` plus `steps[]`, removed unsupported node-registry `role` metadata from the example, and updated the load regression plus README/example docs to describe it as a step-addressed parent that still uses compatibility workflow-call metadata. Re-ran `bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/engine.test.ts --timeout 120000`, `bun run typecheck`, `bun run src/main.ts workflow validate workflow-call-simple --workflow-root ./examples`, `bun run src/main.ts workflow inspect workflow-call-simple --workflow-root ./examples --output json`, and `bun run src/main.ts workflow run workflow-call-simple --workflow-root ./examples --mock-scenario ./examples/workflow-call-simple/mock-scenario.json --output json` with isolated runtime roots; all passed.

### Session: 2026-04-24 18:29 JST

**Tasks Completed**: Review/fix follow-up for TASK-004 step-addressed OpenTUI rerun target alignment
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The blocker boundary is unchanged. The repository still intentionally supports a mixed transitional state while TASK-003 and TASK-005 remain pending, so the queue engine, cross-workflow lowering, and remaining compatibility examples are still not fully step-native.
**Notes**: Re-checked the active architecture and implementation plan against the current working-tree diff before changing anything. The current design still matches the intended transitional purpose, so no replacement design document or new implementation plan was needed. Review found a concrete TASK-004 gap in the interactive TUI rerun path: the controller still labeled reruns by `nodeId` and always forwarded `fromNodeId`, even when the selected execution already carried step-addressed metadata and the rest of the public rerun surface treated `stepId` as primary. Updated the OpenTUI controller/runtime bridge and CLI TUI wiring so reruns now prefer `fromStepId` plus step-oriented status text when `execution.stepId` is available, while preserving node-targeted fallback for compatibility sessions. Added focused regressions in `src/tui/opentui-controller.test.ts` and `src/cli.test.ts`, then re-ran `bun test src/tui/opentui-controller.test.ts src/cli.test.ts --timeout 120000`, `bun run typecheck`, and `git diff --check`; all passed. TASK-004 remains in progress because other public surfaces and the deeper runtime cutover are still pending, but the interactive rerun flow no longer lags behind the step-addressed rerun contract already exposed by the CLI, library, GraphQL, and server request layers.

### Session: 2026-04-24 18:14 JST

**Tasks Completed**: Review/fix follow-up for TASK-002 direct call-step session-policy override preservation
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The blocker boundary is unchanged. The repository still intentionally supports a mixed transitional state while TASK-003 and TASK-005 remain pending, so queue advancement, cross-workflow lowering, and the remaining compatibility examples are still not fully step-native.
**Notes**: Re-checked the active architecture and implementation plan against the working-tree diff before changing anything; the current design still matches the intended transitional purpose, so no replacement design document or new implementation plan was needed. Review found a concrete TASK-002 defect in the new direct `call-step` path: direct execution overrides replaced the authored `sessionPolicy` object, which dropped `inheritFromStepId` on shared-node steps and could make `--continue-session` reuse the newest compatible backend session instead of the step's intended inherited lineage. Updated `src/workflow/call-node.ts` so direct session-mode overrides merge with the authored policy instead of replacing it, added a focused regression in `src/workflow/call-step.test.ts` that proves inherited-step reuse still selects the requested source-step session under overrides, and re-ran `bunx prettier --write src/workflow/call-node.ts src/workflow/call-step.test.ts`, `bun test src/workflow/call-step.test.ts`, `bun run typecheck`, and `git diff --check`; all passed. TASK-002 remains in progress because the broader step-native runtime/session cutover is still pending, but direct step execution no longer loses authored reuse lineage when callers request session continuation explicitly.

### Session: 2026-04-24 18:11 JST

**Tasks Completed**: Review pass for active cutover continuation
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The blocker boundary is unchanged. TASK-003 and TASK-005 still depend on the deeper queue-engine and cross-workflow cutover, while the current tree remains an intentionally mixed transitional state.
**Notes**: Re-checked the current architecture and design docs against the intended step-addressed cutover purpose before continuing. The active design and implementation plan still match that purpose, so no replacement design document or new plan was needed. Reviewed the existing working-tree diff, ran `bun run typecheck`, and ran the full `bun test` suite; all passed (`879` tests). This pass did not uncover a concrete defect or overlooked continuation item that justified another code change, so task/module statuses remain unchanged and the iteration is recorded as verification rather than speculative implementation.

### Session: 2026-04-24 18:01 JST

**Tasks Completed**: Review/fix follow-up for TASK-004 local rerun wording alignment
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The blocker boundary is unchanged. The repository still intentionally supports a mixed transitional state while TASK-003 and TASK-005 remain pending, so queue advancement, cross-workflow lowering, and the remaining compatibility examples are still not fully step-native.
**Notes**: Re-checked the active architecture and implementation plan against the working-tree diff before changing code. The current design still matches the intended transitional purpose, so no replacement design document or new implementation plan was needed. Review found a smaller but real step-cutover mismatch in rerun validation: local `session rerun` and the step-addressed GraphQL surface already present step ids to users, but `runWorkflow()` still surfaced unknown-target failures as `node` errors because the compatibility rerun option name leaked into user-visible messages. Updated the engine to emit step-oriented rerun validation messages when the loaded workflow uses `workflow.json.steps[]`, added a focused regression in `src/workflow/engine.test.ts`, and kept the task/module statuses unchanged because this is a public-surface consistency hardening pass rather than a deeper runtime cutover. Verification for this slice is covered by focused engine tests, typecheck, and the full repository test suite.

### Session: 2026-04-24 17:56 JST

**Tasks Completed**: Partial TASK-002 runtime execution metadata persistence, partial TASK-004 step-centric inspection consistency
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The blocker boundary is unchanged. TASK-003 and TASK-005 still depend on the broader deterministic manager and cross-workflow cutover, so this pass stayed inside workflow-run execution recording and inspection-facing state persistence.
**Notes**: Review found a real gap between direct `call-step` execution and ordinary `runWorkflow()` execution: direct calls already persisted `stepId`, `nodeRegistryId`, `mailboxInstanceId`, prompt variants, and timeout metadata, but engine-driven workflow runs still dropped those fields from session history, runtime-db rows, and execution artifacts. That made step-centric surfaces rely on partial fallbacks and prevented shared-node workflows from exposing stable step metadata through normal runs. Updated `src/workflow/engine.ts` so workflow-run executions now persist the same step-aware metadata path as direct calls across mailbox artifacts, session execution records, output refs, and runtime-db writes. Added a shared-node regression in `src/workflow/engine.test.ts` that verifies engine-produced session/runtime records carry the expected step and node-registry metadata, then re-ran `bun run typecheck`, `bun test src/workflow/engine.test.ts`, and `bun test src/workflow/runtime-db.test.ts src/lib.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts`; all passed.

### Session: 2026-04-24 17:46 JST

**Tasks Completed**: Partial TASK-002 runtime session-index step-state persistence, partial TASK-004 TUI history fallback alignment
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The blocker boundary is unchanged. TASK-003 and TASK-005 still depend on the deeper queue-engine and cross-workflow runtime cutover, so this pass stayed within runtime-state persistence and public-surface fallback alignment.
**Notes**: Continued the active cutover instead of creating a replacement design or implementation plan because the existing step-addressed architecture and plan still match the repository's intended transitional purpose. Review found a concrete gap between the newer step-addressed execution records and the session-level runtime index: `node_executions` already persisted `stepId`, but `sessions` summaries remained node-only, which meant summary-only consumers could lose the current step when the full session file was unavailable. Added `current_step_id` persistence and migration handling to the runtime SQLite session index, exposed it through `RuntimeSessionSummary`, and updated the TUI history preview to fall back to that summary field when `latestRunSessionView` cannot be loaded. Added regressions for the runtime-db round-trip and the TUI fallback path, then re-ran `bun test src/workflow/runtime-db.test.ts src/tui/opentui-screen.test.ts` and `bun run typecheck`; all passed.

### Session: 2026-04-24 17:40 JST

**Tasks Completed**: Review pass for active cutover continuation
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The blocker boundary is unchanged. TASK-003 and TASK-005 still depend on the deeper queue-engine and cross-workflow runtime cutover, while TASK-001/TASK-002/TASK-004 remain the active in-progress tracks for authored schema hardening, direct step execution, and public-surface alignment.
**Notes**: Re-checked the current architecture and working-tree diff against the intended step-addressed cutover purpose before changing anything. The existing design docs and active implementation plan still match the repository's intended transitional direction, so no replacement design document or new implementation plan was needed for this iteration. Ran `bun run typecheck`, a focused regression slice covering schema/load/save/call-step/session/CLI/GraphQL/runtime-readiness/library paths, and a full `bun test` pass; all completed successfully with no new failures. A manual review of the newly introduced step/session/runtime seams did not surface a concrete defect worth patching in this pass, so the correct continuation outcome was to keep the current task/module statuses unchanged and record the verification result rather than making speculative runtime changes.

### Session: 2026-04-24 15:50 JST

**Tasks Completed**: Partial TASK-004 library session-listing reliability hardening
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The blocker boundary is unchanged. The repository still has mixed compatibility/runtime internals while TASK-003 and TASK-005 remain pending, so this pass stayed inside the public-surface reliability lane rather than claiming deeper runtime cutover.
**Notes**: Re-checked the active architecture/design against the current working-tree diff before continuing. The cutover plan still matched the intended transitional direction, so no replacement design document or new implementation plan was needed. A full repository `bun test` run then exposed one real public-surface defect outside the narrower focused slice: the library `listSessions()` wrapper was reading the best-effort runtime SQLite index instead of the authoritative session-store files, so it could miss valid sessions whenever runtime-db snapshot writes were skipped or failed under broader test concurrency. Updated `src/lib.ts` so library session listing now derives `WorkflowExecutionSummary` rows from persisted session files and still exposes derived `currentStepId`, added a deterministic regression in `src/lib.test.ts` covering a valid session file whose runtime-db index write is forced to fail, and re-ran `bun test src/lib.test.ts`, `bun run typecheck`, and the full `bun test` suite; all passed (870 tests). TASK-004 remains in progress because broader public-surface and runtime cutover work is still pending.

### Session: 2026-04-24 15:45 JST

**Tasks Completed**: Partial TASK-004 shared session-view correctness hardening
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The overall blocker boundary is unchanged. The repository still has mixed compatibility/runtime internals while TASK-003 and TASK-005 remain pending, so this pass stayed within a shared inspection/public-surface correctness lane rather than claiming full runtime cutover.
**Notes**: Continued the requested diff review against the active step-addressed cutover plan instead of creating a replacement design or implementation plan, because the current architecture still matches the intended transitional direction. Review found a subtle cross-surface reporting risk in the new `currentStepId` helper: once a session had any step-addressed executions, the fallback path could report `currentNodeId` as if it were a step id even when that value still represented a node id during mixed/transitional runtime states. Tightened `resolveCurrentStepId()` so it now falls back only when the current identifier is itself known to be a recorded step id, added a regression that proves node ids are no longer misreported as step ids, and re-ran `bun run typecheck` plus `bun test src/workflow/session.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/lib.test.ts`; all passed (125 tests). TASK-004 remains in progress because broader public-surface and runtime cutover work is still pending.

### Session: 2026-04-24 15:41 JST

**Tasks Completed**: Partial TASK-004 library runtime-session step-state alignment
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The blocker boundary is unchanged. Runtime scheduling, queue advancement, and the remaining mixed compatibility internals are still pending under TASK-003/TASK-005, so this pass stayed within the public-surface continuation lane.
**Notes**: Re-checked the active design and implementation plan against the current working-tree diff before changing code. The cutover plan still matches the intended direction, so no replacement design document or new implementation plan was created. Continued TASK-004 by closing another public-surface gap: the library `getRuntimeSessionView()` wrapper now returns the same derived `currentStepId` that CLI and GraphQL already expose for step-addressed sessions, and `src/lib.test.ts` now locks that behavior through the direct `callWorkflowStep()` path. Re-ran `bun test src/lib.test.ts`, `bun run typecheck`, and a repository-wide `bun test` review pass; all passed.

### Session: 2026-04-24 15:37 JST

**Tasks Completed**: Partial TASK-004 GraphQL session-view step-state exposure
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The remaining blocker boundary is unchanged. The repository still intentionally supports a mixed transitional state while TASK-003 and TASK-005 remain pending, so engine scheduling, queue advancement, and remaining compatibility examples are still not fully step-native.
**Notes**: Continued the requested review-and-implementation pass against the active cutover plan instead of creating a replacement design or plan, because the current architecture still matches the intended transitional purpose. Review of the current diff found a public-surface mismatch: CLI session summaries and workflow-execution summary lists already derived `currentStepId`, but GraphQL `workflowExecution.session` and `workflowExecutionOverview.session` still exposed only raw node-addressed session state. Added a dedicated GraphQL session-view type carrying derived `currentStepId`, wired both session-view resolvers through the shared `resolveCurrentStepId` helper, exposed the new field in the executable GraphQL schema, and added both in-process schema and HTTP GraphQL regressions covering a real `stepId != nodeId` session. Re-ran `bunx prettier --write src/graphql/types.ts src/graphql/schema.ts src/server/graphql-executable-schema.ts src/graphql/schema.test.ts src/server/graphql.test.ts`, `bun run typecheck`, and `bun test src/graphql/schema.test.ts src/server/graphql.test.ts`; all passed (42 tests). TASK-004 remains in progress because other public surfaces and the deeper runtime cutover are still pending.

### Session: 2026-04-24 15:25 JST

**Tasks Completed**: Partial TASK-004 TUI runtime/detail step-state cutover
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The runtime still retains compatibility-only `workflowCalls`, ordered-node `repeat`, and node-addressed queue internals, so the broader cutover remains mixed even though TUI inspection now prefers step-local state where it is available.
**Notes**: Re-checked the active design against the current architecture and working-tree diff before changing the TUI layer. The intended direction still matched the existing plan, so no replacement design document or new implementation plan was needed. Continued TASK-004 by moving the TUI history/runtime text from node-only progress wording toward the step-addressed contract: the latest-run summary, run-status pane, and node-detail summary now surface `Current step` when runtime execution metadata includes `stepId`, while still showing the backing node id when it differs. The node-detail header also exposes per-execution `Step` and `Node registry` metadata so shared-node revisits are no longer flattened into node-only labels. Re-ran `bunx prettier --write src/tui/opentui-model/workflow-rendering.ts src/tui/opentui-screen-runtime.test.ts src/tui/opentui-screen.test.ts src/tui/opentui-detail-content.test.ts`, `bun test src/tui/opentui-screen-runtime.test.ts src/tui/opentui-screen.test.ts src/tui/opentui-detail-content.test.ts src/tui/opentui-screen-navigation.test.ts`, and `bun run typecheck`; all passed. TASK-004 remains in progress because the TUI still contains compatibility-backed history lists and node-oriented affordances outside these summary surfaces.

### Session: 2026-04-24 15:19 JST

**Tasks Completed**: Partial TASK-004/TASK-005 documentation and plan alignment review
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The runtime still retains compatibility-only `workflowCalls`, ordered-node `repeat`, and node-addressed queue internals, so docs must describe a mixed transitional state rather than claiming a full step-addressed cutover.
**Notes**: Re-checked the active design intent against the current working-tree diff and repository behavior after the step-centric CLI/GraphQL/TUI changes landed. The implementation plan itself remained the correct plan, but the human-facing architecture text had drifted: `README.md` still described ordered `nodes[]` and `workflowCalls` as if they were the primary authored/runtime model, and the plan section statuses for public surfaces and docs were still marked `NOT_STARTED` despite the in-progress code and regression work. Updated the README and architecture doc to describe the repository accurately as a mixed transitional state with step-addressed authoring as the primary direction, `call-step` as the preferred direct execution surface, and compatibility-only node/workflow-call paths retained underneath. Marked the public-surface and documentation modules as `IN_PROGRESS` in the active plan. Verification for the current cutover slice remains green.

### Session: 2026-04-24 00:00 JST

**Tasks Completed**: Plan creation
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Created from the 2026-04-24 design-document diff that converges architecture, workflow JSON, command docs, and QA notes on the step-addressed runtime. Per user instruction, backward compatibility is not part of this cutover plan; the intent is replacement, not migration-layer expansion.

### Session: 2026-04-24 16:00 JST

**Tasks Completed**: Partial TASK-001 implementation
**Tasks In Progress**: TASK-001
**Blockers**: None
**Notes**: Added a step-addressed authoring path across workflow types, validation, load, save, create, inspect, and focused regression coverage. The loader now resolves file-backed `steps/step-*.json`, the validator accepts `workflow.json.steps[]` plus reusable `workflow.json.nodes[]`, and save/create now emit the new shape. Internal runtime compatibility projections remain in place so later runtime tasks can cut over engine/session/call semantics without breaking the repository mid-plan. Legacy node-ordered authoring has not been fully removed yet, so TASK-001 remains in progress rather than complete.

### Session: 2026-04-24 17:26 JST

**Tasks Completed**: Partial TASK-001 hardening and review follow-up
**Tasks In Progress**: TASK-001
**Blockers**: None
**Notes**: Tightened the authored step-addressed path after reviewing the in-progress diff. Save now preserves file-backed `steps/step-*.json` bundles instead of collapsing them inline, step files participate in revision and stale-file cleanup, the loader rejects `stepFile` id mismatches instead of silently overriding them, and validation now flags duplicate step ids plus duplicate node-registry ids. TypeScript authored-step types were split from resolved runtime step types so the schema model matches the design, and `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts` plus `bun run typecheck` both pass. TASK-001 still remains in progress because the internal compatibility projections and legacy runtime-facing fields are not fully removed yet.

### Session: 2026-04-24 17:33 JST

**Tasks Completed**: Partial TASK-001 review-driven schema alignment
**Tasks In Progress**: TASK-001
**Blockers**: None
**Notes**: Closed a design mismatch in the step-addressed authoring path: manager-role steps now default to `managerType: "code"` even when the reusable node payload omits LLM execution fields, matching the current design docs instead of forcing manager nodes through the worker-style agent schema. Validation now rejects `managerType` when a reusable node is referenced by worker-role steps, and load/save regressions cover minimal file-backed manager node payloads so the authored bundle round-trips without injecting unnecessary `executionBackend` or `promptTemplate` fields. Focused workflow tests and `bun run typecheck` pass after the change. TASK-001 remains in progress because the broader runtime/session/public-surface cutover is still pending.

### Session: 2026-04-24 17:37 JST

**Tasks Completed**: Partial TASK-001 save-path hardening
**Tasks In Progress**: TASK-001
**Blockers**: None
**Notes**: Reviewed the in-progress step-addressed schema/save diff and fixed an authored-minimal persistence bug: re-saving a workflow that omits top-level `managerStepId` and identifies the manager through a single `role: "manager"` step no longer leaks `managerStepId` back into `workflow.json`. Added a regression covering load/save round-tripping of that shape and re-ran `bun test src/workflow/save.test.ts src/workflow/load.test.ts src/workflow/validate.test.ts` plus `bun run typecheck`, both passing. TASK-001 remains in progress because the repository still keeps internal runtime compatibility projections and later runtime/public-surface cutover modules are pending.

### Session: 2026-04-24 17:45 JST

**Tasks Completed**: Partial TASK-001 validator hardening
**Tasks In Progress**: TASK-001
**Blockers**: None
**Notes**: Per the requested review pass, hardened two overlooked step-addressed schema gaps before continuing broader cutover work. Validation now classifies any authored `steps` field as step-addressed input even when malformed, so users receive direct `workflow.steps` / `entryStepId` errors instead of falling back into legacy node-schema diagnostics. Step prompt-variant resolution now replaces the base prompt/template-file pair for each template channel instead of leaking mixed base and variant fields into the resolved step payload. Added focused regressions for both cases and re-ran `bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/save.test.ts` plus `bun run typecheck`, all passing. TASK-001 remains in progress because the authored schema still feeds internal compatibility projections and the later runtime/public-surface modules are not yet cut over.

### Session: 2026-04-24 17:47 JST

**Tasks Completed**: Partial TASK-001 prompt-variant file lifecycle hardening
**Tasks In Progress**: TASK-001
**Blockers**: None
**Notes**: Review of the in-progress step-addressed diff found that `promptVariants` support had only been wired through validation, leaving file-backed variant prompts outside the workflow bundle I/O lifecycle. Shared node-template traversal now covers top-level prompt fields and `promptVariants.*` fields during workflow load, save, revision hashing, stale-file cleanup, inline-node payload merges, and local add-on template resolution. Added focused regressions for loading step-addressed variant prompt files, saving and cleaning up renamed variant prompt files, and revision changes driven solely by variant prompt files. Re-ran `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/revision.test.ts` plus `bun run typecheck`, all passing. TASK-001 remains in progress because the broader authored-schema cutover still retains internal runtime compatibility projections for later tasks.

### Session: 2026-04-24 20:35 JST

**Tasks Completed**: Review-driven regression cleanup and runtime DB lock hardening
**Tasks In Progress**: TASK-001
**Blockers**: None
**Notes**: A repository-wide verification pass surfaced follow-up issues outside the narrow workflow schema tests. Updated GraphQL and HTTP GraphQL regression coverage so worker-only authored bundles assert the new `entryStepId` shape and managed-to-worker-only save mutations mutate the step-addressed fields (`entryStepId`, `steps`, `nodeRegistry`) instead of stale compatibility-only node projections. Full-suite execution also exposed deterministic SQLite lock failures when manager sessions were created against the shared runtime database; `manager-session-store` now initializes the shared DB with WAL and a busy timeout so manager-session writes no longer fail under normal workflow/test concurrency. Re-ran `bun run typecheck` and the full `bun test` suite, both passing. TASK-001 remains in progress because the later runtime/public-surface cutover modules are still pending.

### Session: 2026-04-24 21:04 JST

**Tasks Completed**: Partial TASK-001 save-path review fix
**Tasks In Progress**: TASK-001
**Blockers**: None
**Notes**: Review of the in-progress step-addressed save path found an authored-bundle corruption risk when a reusable node registry id collided with a step id that carried step-local payload overrides such as `promptVariant`. Save previously preferred the id-keyed payload for persistence, which could write a derived step payload back into the shared node file. The save path now keeps ordinary node-id edits authoritative, but detects collision cases that carry step-local overrides and preserves the node-file-backed payload for registry persistence instead. Added a regression covering that collision scenario and re-ran `bun run typecheck`, `bun test src/workflow/save.test.ts`, and the full `bun test` suite, all passing. TASK-001 remains in progress because authored-schema compatibility projections and the later runtime/public-surface cutover modules are still pending.

### Session: 2026-04-24 21:08 JST

**Tasks Completed**: Partial TASK-001 validation diagnostic cleanup
**Tasks In Progress**: TASK-001
**Blockers**: None
**Notes**: Continued the requested git-diff review pass and fixed a remaining authored-schema mismatch in the step-addressed validator. Empty `workflow.steps[]` / `workflow.nodes[]` arrays now fail with direct step-addressed schema errors, and semantic validation no longer leaks compatibility-only `workflow.managerRuntimeId`, `workflow.entryNodeId`, or synthesized `workflow.edges[*]` diagnostics when the authored step graph is invalid. Added focused regressions covering those empty-array and diagnostic-leak scenarios, then re-ran `bun test src/workflow/validate.test.ts` and `bun run typecheck`, both passing. TASK-001 remains in progress because the broader runtime/session/public-surface cutover modules are still pending.

### Session: 2026-04-24 21:12 JST

**Tasks Completed**: Partial TASK-001 add-on contract hardening
**Tasks In Progress**: TASK-001
**Blockers**: None
**Notes**: Continued review of the in-progress step-addressed schema cutover found a contract gap: manager-role steps could still reference built-in worker add-ons such as `divedra/codex-worker`, which normalized into an invalid code-manager shape despite the add-on catalog being worker-only. Validation now rejects add-on-backed node registry entries for manager steps, regression coverage locks the behavior, and the workflow JSON design now states that manager steps must stay file-backed until manager-capable add-ons are designed explicitly. Focused workflow tests and `bun run typecheck` pass after the change. TASK-001 remains in progress because broader runtime/session/public-surface cutover work is still pending.

### Session: 2026-04-24 21:18 JST

**Tasks Completed**: Partial TASK-001 save-path review hardening
**Tasks In Progress**: TASK-001
**Blockers**: None
**Notes**: Another review-driven follow-up found that re-saving a loaded step-addressed managed workflow could persist the derived manager-step payload back into the shared node file when the manager step id matched the node registry id. That leaked synthesized `managerType: "code"` into authored node JSON and risked treating runtime-derived step state as authored node state on later saves. Save now compares the id-keyed payload against the node-file-backed payload plus the colliding step projection, and keeps the node-file payload authoritative when the id-keyed payload is only a derived step view. Added a regression covering managed-template load/save/load round-tripping and re-ran `bun run typecheck` plus `bun test src/workflow/save.test.ts src/workflow/load.test.ts`, all passing. TASK-001 remains in progress because the broader runtime/session/public-surface cutover modules are still pending.

### Session: 2026-04-24 21:22 JST

**Tasks Completed**: Partial TASK-001 validator contract hardening
**Tasks In Progress**: TASK-001
**Blockers**: None
**Notes**: Continued the requested git-diff review pass and found that direct step-addressed validation still accepted authored `workflow.steps[]` entries that mixed `stepFile` with inline fields such as `nodeId` and `role`, even though the loader and design reject that shape. Validation now enforces the authored contract for raw step-file entries, while load/save continue to validate resolved step definitions through an explicit internal option. Added regression coverage for the mixed-authoring case and re-ran `bun run typecheck` plus the full `bun test` suite, both passing. TASK-001 remains in progress because the broader runtime/session/public-surface cutover modules are still pending.

### Session: 2026-04-24 21:27 JST

**Tasks Completed**: TASK-001 review and verification pass
**Tasks In Progress**: TASK-001
**Blockers**: None
**Notes**: Reviewed the current step-addressed authored-schema diff against the active design and implementation plan instead of forcing speculative follow-up edits. The current architecture remains aligned with the intended TASK-001 scope: authored bundles use `entryStepId` / optional `managerStepId`, reusable node registry entries remain separate from executable steps, file-backed steps round-trip correctly, and step-addressed validation rejects removed legacy authored fields. Re-ran `bun run typecheck` and the full `bun test` suite; both passed. No additional concrete TASK-001 defects were identified in this review pass, so the task stays in progress pending the later runtime/public-surface cutover modules rather than another authored-schema patch.

### Session: 2026-04-24 12:22 JST

**Tasks Completed**: Partial TASK-001 validator strict-mode groundwork
**Tasks In Progress**: TASK-001
**Blockers**: Repository fixtures/examples are still mixed between legacy node-addressed authoring and the target step-addressed model, so flipping the primary load/save path to strict rejection in this pass would create broad authored-fixture churn.
**Notes**: Re-checked the active design against the current architecture and confirmed the target direction remains the same: step-addressed authoring is still the intended primary workflow model, while the repository has not yet completed the authored-bundle migration needed to enforce that path everywhere. Added an explicit `rejectLegacyWorkflowAuthoring` validation option so strict step-addressed-only authoring can now be exercised without disturbing the still-mixed load/save path. Added focused regression coverage proving that canonical step-addressed bundles pass in strict mode while legacy node-addressed bundles fail with direct step-addressed diagnostics. Re-ran `bun test src/workflow/validate.test.ts`, `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts`, and `bun run typecheck`, all passing. TASK-001 remains in progress because the next iteration still needs to migrate authored fixtures/examples and then enable strict rejection on the primary load/save path.

### Session: 2026-04-24 12:25 JST

**Tasks Completed**: Partial TASK-001 save-path strict-schema enforcement
**Tasks In Progress**: TASK-001
**Blockers**: Full repository cutover is still blocked by legacy runtime/tests/examples that author node-addressed workflows, so strict rejection cannot yet be enabled on every load path.
**Notes**: Continued the in-progress review by closing a remaining gap in the authored schema path: step-addressed saves now validate their persisted authored bundle under `rejectLegacyWorkflowAuthoring`, so save-side regressions cannot silently reintroduce removed top-level fields while TASK-001 is still in progress. Added a regression that re-validates a persisted step-addressed managed bundle directly from `workflow.json` and saved node files in strict mode. Re-ran `bun test src/workflow/save.test.ts` and `bun run typecheck`; both passed. TASK-001 remains in progress because the broader runtime/public-surface migration and legacy authored-fixture cleanup are still pending.

### Session: 2026-04-24 12:29 JST

**Tasks Completed**: Partial TASK-001 primary load-path strict-schema follow-up
**Tasks In Progress**: TASK-001
**Blockers**: Repository defaults still cannot flip to strict step-addressed-only loading globally because many runtime/tests/examples remain intentionally legacy-authored until the broader cutover lands.
**Notes**: Continued the requested git-diff review by closing the next authored-schema gap instead of only asserting strict validation through direct validator calls. `loadWorkflowFromDisk` now accepts the same `rejectLegacyWorkflowAuthoring` option, so the primary bundle load path can exercise strict step-addressed-only authoring without breaking the mixed repository default. Updated load/save regressions to use that real load path in strict mode, including a failure case for legacy node-addressed authoring and a success case for file-backed step-addressed bundles. Re-ran `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts` and `bun run typecheck`; both passed. TASK-001 remains in progress because global authored-fixture migration and the later runtime/public-surface cutover modules are still pending.

### Session: 2026-04-24 12:32 JST

**Tasks Completed**: Partial TASK-001 strict save-path entry-step hardening
**Tasks In Progress**: TASK-001
**Blockers**: Repository defaults still cannot flip to strict step-addressed-only loading globally because many runtime/tests/examples remain intentionally legacy-authored until the broader cutover lands.
**Notes**: Continued the requested git-diff review and found that strict step-addressed save validation still synthesized `entryStepId` from legacy compatibility `entryNodeId`. That fallback can hide an invalid step-addressed normalized workflow and becomes unsafe once one reusable node is addressed by multiple steps. Removed the fallback from the strict save-validation projection so step-addressed saves now require a real `entryStepId`, and added a regression proving that save fails with a direct `workflow.entryStepId` validation error even if a stale compatibility `entryNodeId` is still present. Re-ran `bun test src/workflow/save.test.ts` and `bun run typecheck`; both passed. TASK-001 remains in progress because authored-fixture migration and the later runtime/public-surface cutover modules are still pending.

### Session: 2026-04-24 12:34 JST

**Tasks Completed**: Partial TASK-001 strict load-path option propagation fix
**Tasks In Progress**: TASK-001
**Blockers**: Repository defaults still cannot flip to strict step-addressed-only loading globally because many runtime/tests/examples remain intentionally legacy-authored until the broader cutover lands.
**Notes**: Another review pass found the strict authored-schema load path was still incomplete: `loadWorkflowFromDisk` exposed `rejectLegacyWorkflowAuthoring` through `LoadOptions`, but did not forward that option into `validateWorkflowBundleAsync`. That meant the newly added strict load regression would fail and legacy node-addressed bundles could still pass through the primary load path in mixed-mode repositories. Forwarded the option into load-time validation, re-ran `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts`, and re-ran `bun run typecheck`; all passed. TASK-001 remains in progress because authored-fixture migration and the later runtime/public-surface cutover modules are still pending.

### Session: 2026-04-24 12:38 JST

**Tasks Completed**: Partial TASK-001 strict save-path option propagation fix
**Tasks In Progress**: TASK-001
**Blockers**: Repository defaults still cannot flip to strict step-addressed-only loading globally because many runtime/tests/examples remain intentionally legacy-authored until the broader cutover lands.
**Notes**: Continued the requested git-diff review and found the strict authored-schema save path still only rejected legacy authoring when the caller passed a normalized step-addressed workflow object. That left a gap for callers that save raw authored workflow JSON through the public save surface with `rejectLegacyWorkflowAuthoring: true`. The save path now propagates strict rejection whenever the caller explicitly requests it, and `src/workflow/save.test.ts` now covers legacy raw authored input failing with step-addressed diagnostics under strict save mode. Re-ran `bun test src/workflow/save.test.ts src/workflow/load.test.ts src/workflow/validate.test.ts` and `bun run typecheck`; both passed. TASK-001 remains in progress because authored-fixture migration and the later runtime/public-surface cutover modules are still pending.

### Session: 2026-04-24 12:41 JST

**Tasks Completed**: Partial TASK-001 starter-template design-alignment fix
**Tasks In Progress**: TASK-001
**Blockers**: Repository defaults still cannot flip to strict step-addressed-only loading globally because many runtime/tests/examples remain intentionally legacy-authored until the broader cutover lands.
**Notes**: Re-checked the active design against the current scaffold/public surface and found one remaining authored-schema mismatch rather than a new architecture branch: `workflow create` still generated a `claude-code-agent` manager node even though the step-addressed design now says starter templates should rely on the default code-manager behavior. Updated `createWorkflowTemplate` so the managed starter keeps the same step-addressed shape and prompt files, but no longer authors `executionBackend` / `model` for the manager node. Updated focused load/save expectations plus README wording, then re-ran `bun test src/workflow/load.test.ts src/workflow/save.test.ts`, targeted CLI/GraphQL workflow-definition regression slices, and `bun run typecheck`; all passed. TASK-001 remains in progress because the broader runtime/session/public-surface cutover modules are still pending.

### Session: 2026-04-24 12:48 JST

**Tasks Completed**: Partial TASK-001 starter-template runtime regression fix
**Tasks In Progress**: TASK-001
**Blockers**: The full deterministic `managerType: "code"` runtime is still part of the later engine/public-surface cutover, so non-mock execution remains intentionally unsupported for backend-less code-manager nodes.
**Notes**: Another git-diff review pass found that the new starter template shape was ahead of the runtime: managed templates now author backend-less code-manager nodes, but `workflow run` and direct `call-node` still treated those nodes as non-executable and failed with `node '<id>' is missing executable node fields`. Instead of reverting the authored-schema change, I closed the immediate runtime gap in a way that matches the active plan state. Backend-less `managerType: "code"` nodes now synthesize an executable agent payload only for `--mock-scenario` and `--dry-run`, which restores the starter-template regression paths used by CLI/TUI tests without pretending the deterministic code-manager runtime is complete. I also updated runtime readiness to report backend-less code-manager execution as an explicit unsupported workflow feature on normal runs, and updated CLI inspection expectations accordingly. Re-ran `bun test src/workflow/runtime-readiness.test.ts`, `bun test src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts`, `bun test src/cli.test.ts`, and `bun run typecheck`; all passed. TASK-001 remains in progress because authored fixture migration plus the broader runtime/public-surface cutover modules are still pending.

### Session: 2026-04-24 12:50 JST

**Tasks Completed**: Review-only TASK-001 continuation check
**Tasks In Progress**: TASK-001
**Blockers**: No new authored-schema blocker was found in this pass; the remaining blocker is still the planned later cutover work for runtime/session/public-surface step addressing and repository-wide authored fixture migration.
**Notes**: Re-checked the active design references against the current architecture and the latest working-tree diff instead of forcing another speculative patch. The current starter-template and readiness behavior still matches the intended transitional state in the plan: authored managed templates now default to backend-less code-manager nodes, mock-scenario and dry-run paths remain available for those nodes, and normal runtime inspection explicitly reports backend-less code-manager execution as unsupported until TASK-002/TASK-003 land. Re-ran `bun test src/workflow/runtime-readiness.test.ts src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts src/cli.test.ts` and `bun run typecheck`; both passed. No additional concrete defect requiring code changes was identified in this review pass, so TASK-001 remains in progress.

### Session: 2026-04-24 12:56 JST

**Tasks Completed**: Partial TASK-001 mock-scenario fallback hardening
**Tasks In Progress**: TASK-001
**Blockers**: The full deterministic `managerType: "code"` runtime is still deferred to TASK-002/TASK-003, so this pass only hardens the existing mock/dry transitional path rather than enabling normal backend-less manager execution.
**Notes**: A git-diff continuation review found that the transitional code-manager bridge was still narrower than the intended authored-template behavior: backend-less scaffolded manager nodes worked for `--dry-run`, but `--mock-scenario` only accepted them when the scenario file contained an explicit manager entry. That contradicted the existing Scenario adapter fallback semantics for normal agent nodes and made a newly created starter fail on `workflow run --mock-scenario {}` with `node 'divedra-manager' is missing executable node fields`. Updated both `runWorkflow` and direct `callNode` to allow backend-less `managerType: "code"` nodes to use the existing Scenario adapter fallback whenever mock-scenario mode is active, and added focused regressions for both paths. Re-ran `bun test src/workflow/call-node.test.ts src/workflow/engine.test.ts`, re-ran `bun run typecheck`, and reproduced the original CLI path with `workflow run --mock-scenario '{}' --max-steps 1`; all passed. TASK-001 remains in progress because the broader step-addressed runtime/session/public-surface cutover is still pending.

### Session: 2026-04-24 13:01 JST

**Tasks Completed**: Partial TASK-001 runtime-readiness crash hardening
**Tasks In Progress**: TASK-001
**Blockers**: The repository still has not finished the broader step-addressed runtime/session/public-surface cutover, so TASK-001 remains focused on authoring-path and transitional-runtime correctness rather than completing the full code-manager runtime.
**Notes**: Another git-diff review pass found a concrete inspection-path bug in the transitional code-manager bridge. `inspectWorkflowRuntimeReadiness` already treated backend-less `managerType: "code"` nodes as an unsupported runtime feature, but if such a node also carried a resolved `model` and `promptTemplate`, the readiness collector hit the generic agent path first and threw on missing `executionBackend` instead of returning a clean blocker. Updated readiness collection so backend-less code managers are classified as the intended unsupported workflow feature before backend probing, and added a regression covering the resolved-prompt shape. Re-ran `bun run typecheck` plus `bun test src/workflow/runtime-readiness.test.ts src/workflow/call-node.test.ts src/workflow/engine.test.ts src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts src/cli.test.ts`; all passed. TASK-001 remains in progress because repository-wide strict step-addressed enforcement and the later step-addressed runtime/public-surface tasks are still pending.

### Session: 2026-04-24 13:04 JST

**Tasks Completed**: Review-only TASK-001 continuation check
**Tasks In Progress**: TASK-001
**Blockers**: No new authored-schema or transitional-runtime blocker was identified in this pass; the remaining blocker is still the planned repository-wide fixture/example migration plus the later step-addressed runtime/public-surface cutover tasks.
**Notes**: Re-checked the current architecture/design references against the active `step-addressed-workflow-runtime-cutover` diff instead of forcing speculative edits. The current authored-schema and transitional runtime behavior still match the intended purpose for TASK-001: step-addressed authoring remains the target model, managed starter templates normalize to backend-less default code-manager nodes, strict authored-schema rejection remains opt-in until repository fixtures are migrated, and normal runtime readiness continues to report backend-less code-manager execution as unsupported until TASK-002/TASK-003 land. Re-ran `bun run typecheck` and `bun test src/workflow/runtime-readiness.test.ts src/workflow/call-node.test.ts src/workflow/engine.test.ts src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts src/cli.test.ts`; all passed. No additional concrete defect requiring code changes was identified in this review pass, so TASK-001 remains in progress.

### Session: 2026-04-24 13:06 JST

**Tasks Completed**: Review-only TASK-001 verification pass
**Tasks In Progress**: TASK-001
**Blockers**: No new authored-schema or transitional-runtime blocker was identified in this pass; the remaining blocker is still the planned repository-wide fixture/example migration plus the later step-addressed runtime/public-surface cutover tasks.
**Notes**: Re-checked the active design references (`design-workflow-json`, `design-workflow-steps-and-node-reuse`, `design-node-jump-and-code-manager-runtime`, `architecture`, and the workflow-calls QA resolution) against the current implementation and working-tree diff. The current architecture still matches the intended TASK-001 transitional state: step-addressed authoring is the target schema, scaffolded managed starters now rely on backend-less default code-manager nodes, mock-scenario and dry-run continue to cover that starter shape, and normal runtime readiness reports backend-less code-manager execution as an explicit unsupported feature until TASK-002/TASK-003 land. Re-ran `bun run typecheck`, `git diff --check`, and `bun test src/workflow/runtime-readiness.test.ts src/workflow/call-node.test.ts src/workflow/engine.test.ts src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts src/cli.test.ts`; all passed. No additional concrete defect requiring code changes was identified in this review pass, so TASK-001 remains in progress.

### Session: 2026-04-24 13:10 JST

**Tasks Completed**: Partial TASK-001 cross-surface inspection alignment
**Tasks In Progress**: TASK-001
**Blockers**: The remaining blocker is still the planned repository-wide fixture/example migration plus the later step-addressed runtime/public-surface cutover tasks; the deterministic `managerType: "code"` runtime is not complete on the normal execution path yet.
**Notes**: Performed another continuation review against the active design references and the current working-tree diff. The architecture still matches the intended TASK-001 transitional state, so no design-doc or new implementation-plan update was needed in this pass. One concrete regression remained outside the previously updated CLI and GraphQL inspection surfaces: `src/lib.test.ts` still expected a freshly scaffolded managed starter to inspect as runtime-ready, even though the current design and readiness implementation now report backend-less default code-manager execution as explicitly unsupported on the normal runtime path until TASK-002/TASK-003 land. Updated the library inspection regression to assert the same readiness blocker as the CLI and GraphQL surfaces. Re-ran `bun run typecheck`, `git diff --check`, and `bun test src/lib.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/workflow/runtime-readiness.test.ts src/workflow/call-node.test.ts src/workflow/engine.test.ts src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts`; all passed. TASK-001 remains in progress.

### Session: 2026-04-24 13:16 JST

**Tasks Completed**: Partial TASK-001 GraphQL HTTP inspection contract alignment
**Tasks In Progress**: TASK-001
**Blockers**: The remaining blocker is still the planned repository-wide fixture/example migration plus the later step-addressed runtime/public-surface cutover tasks; the deterministic `managerType: "code"` runtime is not complete on the normal execution path yet.
**Notes**: Performed another continuation review against the active design references and the current working-tree diff. The architecture still matches the intended TASK-001 transitional state, so no design-doc or new implementation-plan update was needed in this pass. A concrete public-surface inconsistency remained in the GraphQL HTTP contract: the in-process schema query and library inspection path already returned `runtime` readiness data for workflow inspection, but the executable GraphQL SDL for `WorkflowView` did not expose `runtime`, so `/graphql` rejected runtime-blocker queries with `Cannot query field "runtime" on type "WorkflowView"`. Added regression coverage for scaffolded managed starters through both the in-process GraphQL schema and the HTTP `/graphql` transport, then updated `src/server/graphql-executable-schema.ts` to expose `WorkflowRuntimeReadiness` and `WorkflowRuntimeRequirement` on `WorkflowView`. Re-ran `bun run typecheck`, `git diff --check`, and `bun test src/graphql/schema.test.ts src/server/graphql.test.ts src/lib.test.ts src/cli.test.ts src/workflow/runtime-readiness.test.ts src/workflow/call-node.test.ts src/workflow/engine.test.ts src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/validate.test.ts`; all passed (432 tests). TASK-001 remains in progress.

### Session: 2026-04-24 13:18 JST

**Tasks Completed**: Review-only TASK-001 documentation alignment follow-up
**Tasks In Progress**: TASK-001
**Blockers**: The remaining blocker is still the planned repository-wide fixture/example migration plus the later step-addressed runtime/public-surface cutover tasks; the deterministic `managerType: "code"` runtime is not complete on the normal execution path yet.
**Notes**: Re-checked the active design references against the current implementation and working-tree diff after the GraphQL contract fix. The architecture still matches the intended TASK-001 transitional state, so no new design document or implementation plan was needed. One documentation drift remained in `README.md`: it still described manager-less authored entry in `entryNodeId` terms without clarifying that step-addressed bundles now use `entryStepId`. Updated the README wording so the shipped transitional state is explicit: legacy compatibility bundles remain node-addressed, while step-addressed bundles use `entryStepId` / `managerStepId` plus reusable node registry and steps. Re-ran `bun run typecheck`, `git diff --check`, and the focused runtime/public-surface regression slice (`src/graphql/schema.test.ts`, `src/server/graphql.test.ts`, `src/lib.test.ts`, `src/cli.test.ts`, `src/workflow/runtime-readiness.test.ts`, `src/workflow/call-node.test.ts`, `src/workflow/engine.test.ts`, `src/workflow/load.test.ts`, `src/workflow/save.test.ts`, `src/workflow/validate.test.ts`); all passed (432 tests). TASK-001 remains in progress.

### Session: 2026-04-24 13:22 JST

**Tasks Completed**: Partial TASK-001 shipped example migration
**Tasks In Progress**: TASK-001
**Blockers**: The repository still ships other compatibility-authored examples and runtime-facing tests, so strict step-addressed rejection cannot become the default path yet; the later step-addressed runtime/public-surface cutover tasks are still pending.
**Notes**: Continued the requested implementation/review pass by removing a concrete part of the remaining fixture/example blocker instead of adding more speculative schema plumbing. Migrated the shipped worker-only example bundles `worker-only-single-step` and `workflow-call-review-target` from legacy `entryNodeId` authoring to canonical step-addressed `entryStepId` plus `steps[]`, updated their deterministic example documentation, and updated `examples/README.md` to describe the repository's mixed transitional example set accurately. Tightened `src/workflow/load.test.ts` so those shipped examples now load under `rejectLegacyWorkflowAuthoring: true`, which exercises real repository bundles in strict mode rather than only synthetic fixtures. Re-ran `bunx prettier --write src/workflow/load.test.ts`, `bun run typecheck`, `git diff --check`, `bun test src/workflow/load.test.ts`, and direct example CLI validate/inspect/run commands for both migrated bundles; all passed. TASK-001 remains in progress because other shipped examples and the later runtime/session/public-surface step-addressed cutover work are still outstanding.

### Session: 2026-04-24 13:26 JST

**Tasks Completed**: Partial TASK-001 shipped example migration follow-up
**Tasks In Progress**: TASK-001
**Blockers**: The repository still ships other compatibility-authored examples and runtime-facing tests, so strict step-addressed rejection cannot become the default path yet; the later step-addressed runtime/public-surface cutover tasks are still pending.
**Notes**: Continued the same fixture/example migration track with another low-risk shipped worker-only bundle. Migrated `examples/chat-reply-webhook/workflow.json` from legacy `entryNodeId` authoring to canonical `entryStepId` plus `steps[]`, kept the reusable node registry on the built-in `divedra/chat-reply-worker` add-on reference, and updated `examples/chat-reply-webhook/EXPECTED_RESULTS.md`, `examples/README.md`, and the root `README.md` so the shipped example catalog reflects the step-addressed example accurately. Tightened `src/workflow/load.test.ts` so `chat-reply-webhook` now loads under `rejectLegacyWorkflowAuthoring: true`, and added an assertion that the shipped bundle keeps its authored add-on contract instead of depending on a resolved runtime-only projection. Re-ran `bun run typecheck`, `git diff --check`, `bun test src/workflow/load.test.ts`, `bun run src/main.ts workflow validate chat-reply-webhook --workflow-root ./examples`, and `bun run src/main.ts workflow inspect chat-reply-webhook --workflow-root ./examples --output json`; all passed. TASK-001 remains in progress because other shipped examples and the later runtime/session/public-surface step-addressed cutover work are still outstanding.

### Session: 2026-04-24 13:40 JST

**Tasks Completed**: Partial TASK-001 compatibility-example boundary hardening
**Tasks In Progress**: TASK-001
**Blockers**: `workflow-call-simple` and other managed examples still rely on legacy compatibility authoring until the later workflow-call and step-addressed runtime cutover lands, so strict step-addressed rejection cannot become the default repository path yet.
**Notes**: Reviewed the remaining shipped examples and found one unencoded repository boundary: `workflow-call-simple` was still treated as a normal example in docs/tests even though its parent bundle intentionally remains compatibility-authored through `managerRuntimeId`, `workflowCalls`, and authored `edges`. Updated `examples/README.md` to state that transitional status directly, and tightened `src/workflow/load.test.ts` so strict authored-schema loading now explicitly fails for the parent bundle while the worker-only callee still passes in strict mode. Re-ran `bun test src/workflow/load.test.ts` and `bun run typecheck`; both passed. TASK-001 remains in progress because the later step-addressed workflow-call/runtime cutover is still pending.

### Session: 2026-04-24 13:41 JST

**Tasks Completed**: Partial TASK-001 inspection surface alignment
**Tasks In Progress**: TASK-001
**Blockers**: `workflow-call-simple` and other managed examples still rely on legacy compatibility authoring until the later workflow-call and step-addressed runtime cutover lands, so strict step-addressed rejection cannot become the default repository path yet. The normal deterministic `managerType: "code"` runtime also remains intentionally incomplete until TASK-002/TASK-003.
**Notes**: Re-checked the active design references against the current architecture and working-tree diff before making further changes. The design still matches the intended transitional purpose, so no new design document or implementation plan was needed. One concrete public-surface gap remained: inspection already computed step-addressed fields (`managerStepId`, `entryStepId`, `stepIds`, `nodeRegistryIds`, `counts.steps`, and `counts.nodeRegistry`), but the CLI text output and executable GraphQL SDL still exposed only the older node-centric subset. Updated `workflow inspect` text output to report those step-addressed fields when present, extended the executable GraphQL `WorkflowView` / `WorkflowCounts` schema to expose the same data over `/graphql`, and tightened CLI plus GraphQL regressions around a scaffolded managed starter. Re-ran `bun run typecheck`, `git diff --check`, and `bun test src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts`; all passed (98 tests). TASK-001 remains in progress because the broader runtime/session/public-surface cutover and repository-wide strict step-addressed enforcement are still pending.

### Session: 2026-04-24 13:42 JST

**Tasks Completed**: Partial TASK-001 managed example migration
**Tasks In Progress**: TASK-001
**Blockers**: `workflow-call-simple`, `same-node-session-echo`, grouped-lane compatibility examples, and the later step-addressed runtime/public-surface tasks still keep the repository on a mixed authored-model boundary. Strict step-addressed rejection cannot become the default primary path until those remaining compatibility-authored bundles and runtime-facing paths are cut over.
**Notes**: Continued the active plan by removing more shipped example compatibility surface that no longer depended on blocked runtime work. Migrated `examples/claude-divedra-codex-coding/workflow.json` and `examples/claude-divedra-claude-worker/workflow.json` from legacy ordered `nodes[]` authoring to canonical `managerStepId` / `entryStepId` plus explicit `steps[]` transitions while keeping `workflow.json.nodes[]` as the reusable registry. Updated example and root README wording to describe those starters in step-addressed terms, and tightened `src/workflow/load.test.ts` so both bundles now load under `rejectLegacyWorkflowAuthoring: true`. Re-ran `bunx prettier --write` on the touched files, `bun test src/workflow/load.test.ts`, `bun run typecheck`, and direct `workflow validate` / `workflow inspect --output json` / `workflow run --mock-scenario --output json` commands for both migrated bundles; all passed. TASK-001 remains in progress because the repository still ships other intentional compatibility examples and the later runtime/session cutover tasks are still pending.

### Session: 2026-04-24 13:45 JST

**Tasks Completed**: Partial TASK-001 additional shipped example migration
**Tasks In Progress**: TASK-001
**Blockers**: `workflow-call-simple` still intentionally depends on compatibility-only `workflowCalls`, and repeat-based examples such as `same-node-session-echo` and `node-combinations-showcase` still rely on compatibility-only authored metadata (`node`, `group`, `repeat`) that the strict step-addressed node registry rejects today. The later runtime/session/public-surface cutover tasks also remain pending.
**Notes**: Continued the active plan by migrating the remaining low-risk shipped examples whose authored schema no longer needed compatibility-only fields. `examples/subworkflow-chained-simple/workflow.json` and `examples/first-four-arithmetic-pipeline/workflow.json` now use canonical `managerStepId` / `entryStepId` plus explicit `steps[]` transitions, while keeping `workflow.json.nodes[]` as the reusable registry and preserving their nested node payload files. Tightened `src/workflow/load.test.ts` so both bundles load under `rejectLegacyWorkflowAuthoring: true`, and updated `examples/README.md`, the root `README.md`, and the relevant `EXPECTED_RESULTS.md` files to describe the stricter migration boundary accurately. During verification, a review pass found that repeat-based examples could not yet follow the same migration because strict step-addressed validation still rejects inline node wrappers and node-local `repeat` metadata in `workflow.json`; those examples were intentionally left compatibility-authored and documented as such instead of forcing a design-breaking schema change. Re-ran `bun run typecheck`, `git diff --check`, `bun test src/workflow/load.test.ts`, strict `workflow validate` / `workflow inspect --output json` / `workflow run --mock-scenario --output json` commands for `subworkflow-chained-simple` and `first-four-arithmetic-pipeline`, plus ordinary `workflow validate` checks for `same-node-session-echo` and `node-combinations-showcase`; all passed. TASK-001 remains in progress because the repository still ships compatibility-authored repeat and workflow-call examples, and the later step-addressed runtime/public-surface modules are still blocked on the subsequent plan tasks.

### Session: 2026-04-24 13:52 JST

**Tasks Completed**: Partial TASK-002 / TASK-004 `call-step` compatibility surface
**Tasks In Progress**: TASK-002, TASK-004
**Blockers**: This iteration adds a real step-centric direct-call surface, but it still lowers into the compatibility `call-node` runtime. Session state, runtime-db rows, mailbox instance identities, and cross-workflow dispatch remain node-addressed internally until the later engine/session cutover lands.
**Notes**: Re-checked the active design against the current architecture before making new changes. The design still matches the intended purpose, so no new design document or replacement implementation plan was needed. Added `src/workflow/call-step.ts` as a compatibility wrapper that exposes a step-addressed direct-call primitive today by lowering `stepId` to the existing local runtime path, then exposed that surface through the library (`callWorkflowStep`, `callStep`) and CLI (`divedra call-step ...`) while retaining `call-node` as a compatibility command. Tightened `src/cli.test.ts` and `src/lib.test.ts` with direct step-addressed execution coverage and working-directory forwarding checks, and updated the root `README.md` to describe `call-step` as the primary direct-call surface while the cutover continues. Re-ran `bunx prettier --write src/workflow/call-step.ts src/lib.ts src/cli.ts src/cli.test.ts src/lib.test.ts README.md`, `bun run typecheck`, `git diff --check`, and `bun test src/cli.test.ts src/lib.test.ts`; all passed (77 tests). TASK-002 and TASK-004 are now in progress, but the underlying runtime/session conversion is still pending.

### Session: 2026-04-24 13:57 JST

**Tasks Completed**: Partial TASK-004 inspection/readiness review follow-up
**Tasks In Progress**: TASK-002, TASK-004
**Blockers**: The broader step-addressed runtime/session cutover is still pending, so public inspection remains compatibility-backed in several deeper paths even after this correction.
**Notes**: Continued the requested git-diff review pass against the active cutover instead of starting a new plan because the current design still matches the intended purpose. Inspection review found that `runtime-readiness` was attributing requirements from every `bundle.nodePayloads` key, which leaked non-executable node-file and node-registry identifiers into `sourceNodeIds` once the new step-addressed inspection surfaces were exposed. Tightened `src/workflow/runtime-readiness.ts` to derive requirements from executable workflow nodes only, preserving step-addressed execution ids instead of file-path aliases, and added a regression in `src/workflow/runtime-readiness.test.ts` covering workflows where `step.id !== node.id`. Re-ran `bun test src/workflow/runtime-readiness.test.ts`, `bun run typecheck`, and `git diff --check`; all passed. TASK-004 remains in progress because the wider public-surface/runtime cutover is not complete yet.

### Session: 2026-04-24 14:03 JST

**Tasks Completed**: Partial TASK-002 targeted `call-step` continuation overrides
**Tasks In Progress**: TASK-002, TASK-004
**Blockers**: `call-step` now accepts invocation-local prompt/session/timeout overrides, but it still lowers into the compatibility `call-node` runtime. Session history, mailbox identities, runtime-db rows, and cross-workflow dispatch remain node-addressed internally until the later engine/session cutover lands.
**Notes**: Re-checked the active design/command docs against the current implementation and found a concrete mismatch: the documented `call-step` continuation controls (`--prompt-variant`, `--continue-session`, `--timeout-ms`, `--resume-node-exec`) were not wired into the actual runtime. Added direct-execution override plumbing in `src/workflow/call-node.ts` and `src/workflow/call-step.ts` so step-targeted calls can now apply prompt-variant projection, request backend-session reuse, override timeout per invocation, and record the continued `nodeExecId` in the persisted input artifact. Exposed the same controls through the CLI help/parser and updated README wording, added a new `src/workflow/call-step.test.ts` regression covering the runtime behavior plus a CLI forwarding regression in `src/cli.test.ts`, and prepared the branch for focused verification. TASK-002 remains in progress because the direct-call surface is still compatibility-backed and the deeper step-addressed runtime/session conversion is still pending.

### Session: 2026-04-24 14:06 JST

**Tasks Completed**: Review-only TASK-002 / TASK-004 verification pass
**Tasks In Progress**: TASK-002, TASK-004
**Blockers**: No new blocker was found in this pass. The remaining blockers are unchanged: `call-step` still lowers into the compatibility `call-node` runtime, and deeper step-addressed session/runtime-db/mailbox/cross-workflow execution state is still pending in later cutover work.
**Notes**: Reviewed the current architecture/design references against the active working-tree diff instead of forcing speculative changes. The repository still matches the intended transitional purpose of the active cutover plan, so no new design-doc or replacement implementation-plan update was needed in this iteration. Verified the new `call-step` surface and adjacent step-addressed inspection/runtime behavior with `bun run typecheck`, `git diff --check`, and a focused regression slice covering `src/workflow/call-step.test.ts`, `src/cli.test.ts`, `src/lib.test.ts`, `src/workflow/call-node.test.ts`, `src/workflow/engine.test.ts`, `src/workflow/runtime-readiness.test.ts`, `src/workflow/load.test.ts`, `src/workflow/save.test.ts`, `src/workflow/validate.test.ts`, `src/graphql/schema.test.ts`, and `src/server/graphql.test.ts`; all passed (441 tests). No concrete defect requiring code changes was identified in this pass, so task status remains unchanged.

### Session: 2026-04-24 14:18 JST

**Tasks Completed**: Partial TASK-002 runtime metadata persistence
**Tasks In Progress**: TASK-002, TASK-004
**Blockers**: `call-step` now persists step-addressed execution metadata explicitly, but it still executes through the compatibility `call-node` dispatcher. Full engine scheduling, session queue state, mailbox routing, and cross-workflow execution remain compatibility-backed until TASK-003 and later cutover work land.
**Notes**: Continued the active blocker implementation instead of only reviewing the diff. Direct step execution now persists first-class step metadata through session/runtime artifacts: `NodeExecutionRecord`, output refs, mailbox metadata, and runtime DB rows now carry `stepId`, `nodeRegistryId`, and `mailboxInstanceId`, with direct-call overrides also recording `promptVariant` and `timeoutMs`. Exposed the same additional execution fields through the executable GraphQL schema and GraphQL execution views so public surfaces can consume the richer step-addressed state instead of reconstructing it from compatibility node ids. Added focused regression coverage in `src/workflow/call-step.test.ts` and re-ran `bun test src/workflow/call-step.test.ts src/workflow/call-node.test.ts src/workflow/engine.test.ts src/cli.test.ts src/lib.test.ts`, `bun test src/graphql/schema.test.ts src/server/graphql.test.ts`, and `bun run typecheck`; all passed. TASK-002 remains in progress because the direct-call surface still lowers into the compatibility runtime, but this removes part of the remaining metadata blocker instead of leaving step identity implicit.

### Session: 2026-04-24 14:27 JST

**Tasks Completed**: Partial TASK-002 / TASK-004 step-centric session summary hardening
**Tasks In Progress**: TASK-002, TASK-004
**Blockers**: The remaining blocker boundary is unchanged: `call-step` still lowers into the compatibility `call-node` dispatcher, and engine scheduling, queue advancement, mailbox routing, and cross-workflow execution are still not fully step-native until TASK-003 lands. TASK-001 also remains in progress because strict step-addressed rejection is not yet the repository-wide default while compatibility-authored fixtures/examples still exist.
**Notes**: Hardened the newly exposed step-centric public surfaces so they are verified against a real `stepId != nodeId` runtime shape instead of only template workflows where the ids happen to match. Added CLI regression coverage for `session progress` / `session status` `currentStepId` and `stepSummaries`, added in-process GraphQL and HTTP GraphQL workflow-execution summary coverage for `currentStepId`, and corrected the direct `call-step` runtime-DB regression to use the explicit `rootDataDir` storage contract. Re-ran `bun test src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/workflow/call-step.test.ts --timeout 120000` and `bun run typecheck`; both passed. TASK-004 remains in progress because TUI and broader user-facing wording/runtime cutover work are still pending, but the CLI/GraphQL summary ambiguity is now concretely covered.

### Session: 2026-04-24 14:46 JST

**Tasks Completed**: Partial TASK-004 step-centric rerun public-surface cutover
**Tasks In Progress**: TASK-002, TASK-004
**Blockers**: The remaining blocker boundary is still below the public API layer: `session rerun` now presents a step-centric contract, but the underlying runtime still lowers reruns into `rerunFromNodeId` and the engine remains compatibility-backed until TASK-003 lands. TASK-001 also remains in progress because repository-wide strict step-addressed rejection still depends on the remaining compatibility-authored fixtures/examples.
**Notes**: Continued the blocker reduction on the public-surface track by moving rerun targeting toward the new step-addressed contract instead of leaving another node-worded execution entrypoint in place. The library, CLI, shared UI contract, GraphQL schema types, and executable GraphQL SDL now accept/report `stepId` / `rerunFromStepId` as the primary public rerun field while retaining `nodeId` / `rerunFromNodeId` as compatibility fallbacks underneath. Local CLI reruns still lower into the current engine `rerunFromNodeId` path, and GraphQL rerun mutations now validate the `stepId`/`nodeId` compatibility contract explicitly instead of exposing a node-only shape. Added focused regression coverage in `src/lib.test.ts`, `src/cli.test.ts`, `src/graphql/schema.test.ts`, and `src/server/graphql.test.ts`, then re-ran `bun test src/lib.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts --timeout 120000` and `bun run typecheck`; both passed. TASK-004 remains in progress because TUI and the remaining step-native runtime/public wording cutover work are still pending.

### Session: 2026-04-24 15:18 JST

**Tasks Completed**: Partial TASK-002 shared-step session inheritance hardening
**Tasks In Progress**: TASK-002, TASK-004
**Blockers**: `call-step` and the scheduler now honor `workflow.steps[].sessionPolicy.inheritFromStepId` for backend-session reuse, but they still execute through the compatibility runtime model. Full step-native queue advancement, mailbox routing, and cross-workflow execution remain pending until the later engine/session cutover lands. TASK-001 also remains in progress because repository-wide strict step-addressed rejection still depends on the remaining compatibility-authored fixtures/examples.
**Notes**: Continued the active cutover by fixing a concrete design/runtime mismatch instead of only reviewing the diff. The step-addressed validator already accepted `sessionPolicy.inheritFromStepId`, but the runtime dropped that information and only reused backend sessions under the current step id, which broke the intended "implement, then revisit the same reusable node through a review step" continuation pattern whenever `step.id !== nodeId`. Updated both direct step execution and the main workflow engine to resolve reusable backend sessions through the inherited step id when a step requests `sessionPolicy.mode = "reuse"` plus `inheritFromStepId`. Added focused regressions in `src/workflow/call-step.test.ts` and `src/workflow/engine.test.ts` covering real shared-node step chains with `step.id != nodeId`, then re-ran `bunx prettier --write src/workflow/call-node.ts src/workflow/engine.ts src/workflow/call-step.test.ts src/workflow/engine.test.ts`, `bun run typecheck`, `git diff --check`, `bun test src/workflow/call-step.test.ts src/workflow/engine.test.ts`, and the broader workflow slice `bun test src/workflow/call-node.test.ts src/workflow/call-step.test.ts src/workflow/engine.test.ts src/workflow/runtime-readiness.test.ts`; all passed (109 tests in the broader slice). TASK-002 remains in progress because the direct-call and scheduler paths are still compatibility-backed overall, but same-session continuation across distinct step ids is now implemented rather than only documented.

### Session: 2026-04-24 15:10 JST

**Tasks Completed**: Partial TASK-004 TUI workflow-definition summary cutover
**Tasks In Progress**: TASK-002, TASK-004
**Blockers**: The TUI now surfaces step-addressed summary fields, but deeper execution/runtime views still inherit compatibility node-centric structures underneath. Full step-native session/runtime state and remaining TUI history/detail wording are still blocked on the later engine/runtime cutover tasks. TASK-001 also remains in progress because repository-wide strict step-addressed rejection still depends on the remaining compatibility-authored fixtures/examples.
**Notes**: Re-checked the current design against the architecture and working-tree diff before changing the TUI layer; the active cutover plan still matches the intended purpose, so no replacement design document or implementation plan was needed. Continued TASK-004 by updating the OpenTUI workflow-definition/rendering layer to report step-addressed execution metadata explicitly when available instead of summarizing everything through node-only labels. `buildWorkflowDefinitionContent`, `buildWorkflowSummaryPreview`, and `buildWorkflowRunPreview` now surface `entryStepId`, `managerStepId`, `steps[]`, and `workflow.nodeRegistry[]` alongside the compatibility node projection, and focused TUI regressions now cover a real step-addressed bundle where step ids differ from node-registry ids. Re-ran `bunx prettier --write src/tui/opentui-model/workflow-rendering.ts src/tui/opentui-screen.test.ts`, `bun test src/tui/opentui-screen.test.ts`, `bun run typecheck`, and `git diff --check`; all passed. TASK-004 remains in progress because the TUI still has compatibility-backed history/detail surfaces that have not been cut over yet.

### Session: 2026-04-24 15:15 JST

**Tasks Completed**: Partial TASK-001 shipped-example migration hardening
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: Repository-wide strict step-addressed rejection still cannot become the default because `workflow-call-simple` remains intentionally compatibility-authored through `workflowCalls`, `node-combinations-showcase` still depends on ordered-node `repeat`, and the explicit legacy debate example still depends on structural `subWorkflows` / `subWorkflowConversations`. The step-native engine/runtime cutover tracked by TASK-003 is also still pending.
**Notes**: Re-checked the active design against the current architecture before extending the example migration track. The intended direction remains unchanged, so no new design document or replacement implementation plan was needed. Continued TASK-001 by migrating `examples/same-node-session-echo` off compatibility-only ordered-node `repeat` and into the step-addressed authored model: the bundle now declares `managerStepId` / `entryStepId`, uses `steps[]` to revisit the shared node-registry entry `echo-session` through distinct `echo-request` and `answer-request` steps, and makes second-visit continuation explicit through `promptVariant: "answer"` plus `sessionPolicy.inheritFromStepId`. Updated the shipped mock scenario and example docs to match the new contract, added strict-load regression coverage in `src/workflow/load.test.ts`, and verified the example end to end with `bun test src/workflow/load.test.ts`, `bun run typecheck`, `git diff --check`, `bun run src/main.ts workflow validate same-node-session-echo --workflow-root ./examples`, `bun run src/main.ts workflow inspect same-node-session-echo --workflow-root ./examples --output json`, and `bun run src/main.ts workflow run same-node-session-echo --workflow-root ./examples --mock-scenario ./examples/same-node-session-echo/mock-scenario.json --output json`; all passed. TASK-001 remains in progress because the remaining compatibility-authored examples and broader runtime/public-surface cutover work are still outstanding.

### Session: 2026-04-24 16:02 JST

**Tasks Completed**: Review/fix follow-up for TASK-004 step-centric session summaries
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The remaining blocker boundary is unchanged. The repository still intentionally supports a mixed transitional state while TASK-003 and TASK-005 remain pending, so the engine, queue advancement, and remaining compatibility examples are still not fully step-native.
**Notes**: Re-checked the architecture and active cutover diff instead of creating a replacement design or plan; the current design still matches the intended transitional purpose. Found a maintainability gap rather than a failing runtime behavior: `currentStepId` derivation had been duplicated in the CLI, GraphQL schema layer, and OpenTUI rendering, which risked future drift across the step-centric public surfaces. Centralized that logic in `src/workflow/session.ts` via a shared `resolveCurrentStepId` helper, replaced the duplicate call sites, and added focused unit coverage in `src/workflow/session.test.ts` for legacy node-addressed sessions, step-addressed sessions, and the compatibility case where `currentNodeId` still carries a node id while execution records carry step ids. Re-ran `bunx prettier --write src/workflow/session.ts src/workflow/session.test.ts src/cli.ts src/graphql/schema.ts src/tui/opentui-model/workflow-rendering.ts`, `bun test src/workflow/session.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts src/tui/opentui-screen.test.ts --timeout 120000`, `bun run typecheck`, and `git diff --check`; all passed (175 tests in the focused slice). TASK-004 remains in progress because broader public-surface and runtime cutover work is still pending, but the step-summary computation now has one authoritative implementation instead of three drifting copies.

### Session: 2026-04-24 16:02 JST

**Tasks Completed**: Review/fix follow-up for TASK-002 inherited backend-session provenance
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The overall blocker boundary is unchanged. The repository still intentionally supports a mixed transitional state while TASK-003 and TASK-005 remain pending, so queue advancement, cross-workflow lowering, and remaining compatibility examples are still not fully step-native.
**Notes**: Re-checked the active architecture/design against the working-tree diff before continuing and did not find a design-level mismatch requiring a replacement document or new implementation plan. The concrete defect was lower-level runtime state: inherited reusable backend sessions preserved the latest `sessionId` only under the current step key, but they did not preserve source-step provenance well enough when a later inheriting step rotated the backend session id. That meant a third step inheriting from the original source step could fall back to an older session handle even though a newer compatible continuation already existed. Fixed the shared session helpers in `src/workflow/session.ts` so reusable session records now retain `sourceStepId` / `lastStepId`, selection prefers the latest compatible candidate for the requested source step, and step-addressed selection still falls back to older persisted records that do not yet carry `nodeRegistryId`. Updated both the engine and direct-call runtime paths to use the shared helpers, added focused regressions in `src/workflow/session.test.ts`, `src/workflow/call-step.test.ts`, and `src/workflow/engine.test.ts`, then re-ran `bun run typecheck`, `git diff --check`, the focused workflow/session slice, and the full `bun test` suite; all passed (`874 pass`, `0 fail`). TASK-002 remains in progress because the broader step-native engine/session cutover is still pending, but inherited session lineage now matches the current design instead of depending on stale per-step snapshots.

### Session: 2026-04-24 16:07 JST

**Tasks Completed**: Review/fix follow-up for TASK-004 step-centric rerun request parsing
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The broader blocker boundary is unchanged. The repository still intentionally supports a mixed transitional state while TASK-003 and TASK-005 remain pending, so the queue engine and remaining compatibility examples are still not fully step-native.
**Notes**: Re-checked the active architecture and implementation plan against the current diff before changing anything; the intended transitional direction still matches the current design, so no replacement design document or implementation plan was needed. Found a concrete public-surface gap in the server request layer instead: `src/server/api-request.ts` still parsed rerun targets only from `fromNodeId`, even though the shared request contract and the rest of the cutover already accept `fromStepId` as the primary step-addressed rerun field. Updated rerun request parsing to accept trimmed `fromStepId` alongside the compatibility `fromNodeId`, and added focused regressions in `src/server/api-request.test.ts` covering both fields and blank-value handling. Re-ran `bun test src/server/api-request.test.ts`, `bun run typecheck`, and `git diff --check`; all passed. TASK-004 remains in progress because deeper runtime/TUI/public-surface cutover work is still pending, but the server-facing rerun request contract no longer lags behind the step-addressed interfaces.

### Session: 2026-04-24 21:28 JST

**Tasks Completed**: Review/fix follow-up for TASK-004 promptless TUI progress step-state alignment
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The blocker boundary is unchanged. The repository still intentionally supports a mixed transitional state while TASK-003 and TASK-005 remain pending, so the queue engine, cross-workflow lowering, and remaining compatibility examples are still not fully step-native.
**Notes**: Re-checked the active architecture and implementation plan against the current working-tree diff before changing anything. The current design still matches the intended transitional purpose, so no replacement design document or new implementation plan was needed. Review found a smaller but real public-surface mismatch in the promptless TUI fallback path: the polled `[progress]` line still centered everything on node ids, and it could not label a queued authored step as the current step until that step had already produced an execution record. Updated `src/cli.ts` so promptless fallback progress now emits step execution summaries and treats the queued current target as `currentStep` when the loaded workflow definitively identifies it as an authored step, while still preserving the existing node summary for compatibility context. Added a focused CLI regression in `src/cli.test.ts` covering the non-interactive TUI path, then re-ran `bunx prettier --write src/cli.ts src/cli.test.ts`, `bun test src/cli.test.ts`, and `bun run typecheck`; all passed. TASK-004 remains in progress because other public surfaces and the deeper runtime cutover are still pending.

### Session: 2026-04-24 18:23 JST

**Tasks Completed**: Review/fix follow-up for TASK-004 queued current-step derivation across CLI, library, and GraphQL surfaces
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The blocker boundary is unchanged. The repository still intentionally supports a mixed transitional state while TASK-003 and TASK-005 remain pending, so the queue engine, cross-workflow lowering, and remaining compatibility examples are still not fully step-native.
**Notes**: Re-checked the active architecture/design against the current working-tree diff before extending the public surfaces. The current design still matches the intended transitional purpose, so no replacement design document or new implementation plan was needed. Review found a remaining TASK-004 inconsistency after the promptless TUI fix: when a step-addressed session had already advanced its queued `currentNodeId` to the next authored step but that step had not yet produced an execution record, CLI `session status/progress`, library session views, and GraphQL session summaries still dropped `currentStepId` even though the workflow definition could prove the queued target was an authored step. Added `resolveCurrentStepIdFromWorkflow` in `src/workflow/session.ts`, wired the CLI, library, and GraphQL session-summary/session-view paths to consult the authored workflow definition when execution-history-only derivation returns `null`, and added focused regressions in `src/workflow/session.test.ts`, `src/cli.test.ts`, `src/lib.test.ts`, `src/graphql/schema.test.ts`, and `src/server/graphql.test.ts`. Re-ran `bunx prettier --write src/workflow/session.ts src/workflow/session.test.ts src/cli.ts src/cli.test.ts src/lib.ts src/lib.test.ts src/graphql/schema.ts src/graphql/schema.test.ts src/server/graphql.test.ts`, `bun run typecheck:server`, `git diff --check`, and `bun test src/workflow/session.test.ts src/cli.test.ts src/lib.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts`; all passed (134 tests in the focused slice). TASK-004 remains in progress because deeper runtime/public-surface cutover work is still pending, but queued authored steps now report consistent step ids across the shipped inspection surfaces instead of only in the promptless TUI path.

### Session: 2026-04-24 18:40 JST

**Tasks Completed**: Review/fix follow-up for TASK-004 reusable-node rerun target compatibility
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The blocker boundary is unchanged. The repository still intentionally supports a mixed transitional state while TASK-003 and TASK-005 remain pending, so the queue engine, cross-workflow lowering, and remaining compatibility examples are still not fully step-native.
**Notes**: Re-checked the active architecture/design against the current working-tree diff before changing the rerun surfaces. The current design still matches the intended transitional purpose, so no replacement design document or new implementation plan was needed. Review found a concrete TASK-004 contract bug in the shared rerun entrypoints instead: the library helper and GraphQL mutation both rejected requests where `stepId` and `nodeId` differed, even though reusable-node step-addressed workflows legitimately use different authored step ids and node registry ids for the same rerun target. Updated `src/lib.ts` and `src/graphql/schema.ts` so reruns now treat `stepId` as the execution target while preserving `nodeId` as compatibility metadata when both are supplied, then added focused regressions in `src/lib.test.ts` and `src/graphql/schema.test.ts` covering a real `stepId != nodeId` shape. Re-ran `bun test src/lib.test.ts src/graphql/schema.test.ts --timeout 120000`, `bun run typecheck`, and `git diff --check`; all passed. TASK-004 remains in progress because deeper runtime/public-surface cutover work is still pending, but reusable-node reruns no longer fail validation when callers provide both step-oriented and compatibility node-oriented identifiers.

### Session: 2026-04-24 18:50 JST

**Tasks Completed**: Review/fix follow-up for TASK-004 TUI execution-target wording
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The blocker boundary is unchanged. The repository still intentionally supports a mixed transitional state while TASK-003 and TASK-005 remain pending, so the queue engine, cross-workflow lowering, and remaining compatibility examples are still not fully step-native.
**Notes**: Re-checked the active TUI design constraints and current working-tree diff before changing the history/detail presentation. The navigation contract still matched the current design, so no TUI behavior or focus changes were needed. One remaining TASK-004 wording gap was still visible in the history/detail layer: execution rows and mailbox detail titles kept presenting node ids as the primary execution target even when a distinct authored `stepId` already existed. Updated `src/tui/opentui-model/shared.ts` so history execution rows prefer `stepId` as the visible label and keep the backing node id in the secondary context line, and updated `src/tui/opentui-detail-content.ts` so outbox/manager detail titles prefer the step-oriented execution target as well. Added focused regressions in `src/tui/opentui-screen-runtime.test.ts` and `src/tui/opentui-detail-content.test.ts`, then re-ran `bun test src/tui/opentui-screen-runtime.test.ts src/tui/opentui-detail-content.test.ts src/tui/opentui-screen.test.ts --timeout 120000` and `bun run typecheck`; both passed. TASK-004 remains in progress because other public surfaces and the deeper runtime cutover are still pending, but the shipped TUI history/detail layer no longer defaults to node ids when a step-addressed execution target is already known.

### Session: 2026-04-24 22:27 JST

**Tasks Completed**: Review/fix follow-up for TASK-003 timeout-policy semantics on the workflow-run path
**Tasks In Progress**: TASK-001, TASK-002, TASK-004
**Blockers**: The blocker boundary is unchanged. The repository still intentionally supports a mixed transitional state while TASK-003 and TASK-005 remain pending, so the queue engine, cross-workflow lowering, and remaining compatibility examples are still not fully step-native.
**Notes**: Re-checked the active architecture/design against the current diff before making further changes and did not find a design-level mismatch requiring a replacement document or new implementation plan. Review found a concrete semantic regression in the prior timeout patch instead: `runWorkflow()` had started treating `options.defaultTimeoutMs` as if it were a per-invocation timeout override, even though the documented contract is only a workflow-default override and the engine does not yet thread true invocation-local timeout overrides through manager decisions or queue advancement. Updated `src/workflow/engine.ts` so the workflow-run path now keeps the correct precedence `step-local timeout -> node timeout -> options.defaultTimeoutMs/workflow default`, while preserving the useful step-local timeout support added in this slice. Replaced the invalid regression in `src/workflow/engine.test.ts` with focused coverage that proves `defaultTimeoutMs` does not override authored step/node timeouts and that retry timeout increments still apply when the effective base timeout came from `defaultTimeoutMs`. Re-ran `bun test src/workflow/engine.test.ts`, `bun run typecheck`, and `git diff --check`; all passed. TASK-003 remains in progress because the engine still does not carry true per-invocation timeout overrides through normal workflow scheduling, but the current workflow-run semantics now match the documented transitional architecture instead of implying a capability that does not exist yet.

### Session: 2026-04-26 (TASK-001 probe: strict default in tests, Bun vs Vitest env)

**Tasks Completed**: Confirmed the working tree still matches the plan’s *Current repository posture* (step-first surfaces, derived `__cw:*` cross-workflow calls off normalized `workflow.workflowCalls`, `workflowCallsForExecutionMatch` for engine order). Probed **TASK-001** by removing `DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT` from `vitest.config.ts` and `scripts/run-bun-tests.sh`: **159** unit tests failed because they construct legacy-shaped fixtures without passing `rejectLegacyWorkflowAuthoring: false`. Restored the env in both places and added an explicit comment in `vitest.config.ts` that the escape hatch exists until call sites are migrated. Clarified `isStrictWorkflowAuthorshipValidation` JSDoc in `src/workflow/validate.ts` that `bun test` (via `run-bun-tests.sh`) does not read Vitest `env`, so the shell `export` is required for parity with editor Vitest runs. Re-ran `bash scripts/run-bun-tests.sh` (**922** pass), `bun run typecheck`, `bun run typecheck:server`.

**Tasks In Progress**: TASK-001 (next step: opt tests into `rejectLegacyWorkflowAuthoring: false` or migrate fixtures, then drop the global env), TASK-002, TASK-003, TASK-004. TASK-005 completed.

**Blockers**: TASK-001 full strict-by-default in tests remains a large fixture/refactor; no design doc change required for this session.

### Session: 2026-04-25 (architecture match and working-tree review)

**Tasks Completed**: Re-validated the **target** cutover (strict step-addressed authoring, step-native engine throughout, `call-step` as the only direct primitive) against the **current** **transitional** tree described in *Current repository posture* and `design-workflow-json.md` (step transitions, `toWorkflowId` + `resumeStepId`, `label` gating of derived cross-workflow calls, deterministic `__cw:<callerStepId>` ids, no persistence of derived rows on `workflow.workflowCalls`). Reviewed the pending git diff: `workflowCallsForExecutionMatch` correctly orders explicit matches then non-colliding step-derived matches; `workflowCallMatchesCallerExecution` applies `when` / `label` via `evaluateBranch` consistently with the design; `loadWorkflowFromDisk` no longer redundantly re-spreads `rejectLegacyWorkflowAuthoring: true` because `...options` already carries the flag; TUI and GraphQL inspection paths align with `effectiveWorkflowCalls` for visible workflow-call lists.

**Tasks In Progress**: TASK-001 (159 tests still depend on the legacy test env until call sites pass `rejectLegacyWorkflowAuthoring: false`); TASK-002, TASK-003, TASK-004; TASK-005 completed.

**Verification (this review)**: `bash scripts/run-bun-tests.sh` (922 pass), `bun run typecheck`, `bun run typecheck:server`.

**Blockers**: None for documentation; TASK-001 scope remains the same.

### Session: 2026-04-25 (TASK-001 increment + child run options; diff review)

**Tasks Completed**: Re-checked architecture vs. plan: still **transitional** (step-first inspection, `workflowCallsForExecutionMatch`, no derived cross-workflow rows on normalized `workflow.workflowCalls`); no design rewrite. **TASK-001**: Added explicit `rejectLegacyWorkflowAuthoring: false` to legacy disk fixtures in `src/workflow/call-node.test.ts` and broadly in `src/workflow/engine.test.ts` so those tests pass under `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT` (fail count reduced materially; full suite without env still has remaining files). Removed the same flag from **step-addressed** and **template** scenarios in `engine.test.ts` so they exercise strict authorship when the env is unset. **Bug fix / TASK-003 alignment**: `buildChildWorkflowCallOptions` in `src/workflow/engine.ts` now forwards parent `LoadOptions` used for loading children (`rejectLegacyWorkflowAuthoring`, scope/addon roots, resolved source, node addon resolvers) so nested `runWorkflowInternal` loads inherit the parent’s validation/catalog context (fixes callee load failures when the parent opts into legacy-compatible validation).

**Tasks In Progress**: TASK-001 (remaining test files still need explicit flags or fixture migration before dropping `DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT`), TASK-002, TASK-003, TASK-004. TASK-005 completed.

**Verification**: `bun run typecheck`, `bun run typecheck:server`, `bash scripts/run-bun-tests.sh` (922 pass); `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bun test src/workflow/engine.test.ts src/workflow/call-node.test.ts` (all pass).

### Session: 2026-04-26 (TASK-001: full suite without `DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT`)

**Tasks Completed**: **Architecture** unchanged (transitional posture in plan *Current repository posture*). **TASK-001** progress: (1) `load.test.ts` uses shared `testLegacyAuthorshipOk` for legacy/compat disk and catalog loads; step-strict and `rejectLegacyWorkflowAuthoring: true` cases unchanged. (2) `save.test.ts` opts legacy/migration save+load paths into `rejectLegacyWorkflowAuthoring: false`. (3) `lib.test.ts` spreads the same for `callWorkflowNode` and add-on `executeWorkflow` / resume+rerun paths. (4) **Bug fix**: `executeWorkflow`, `resumeWorkflow`, and `rerunWorkflow` in `src/lib.ts` now forward `rejectLegacyWorkflowAuthoring` into `WorkflowRunOptions` (was dropped, so `loadWorkflowFromCatalog` always saw strict default). (5) `cli.test.ts`, `graphql/schema.test.ts`, `server/graphql.test.ts`, `communication-service.test.ts`, `history.test.ts`, `manager-message-service.test.ts`, `runtime-db.test.ts`, and `events/trigger-runner.test.ts` use `beforeEach` to set `DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT` to `"true"` only when the outer harness left it **unset**, matching `run-bun-tests.sh` for legacy-shaped CLI/GraphQL/integration fixtures without reintroducing a global process dependency for explicitly migrated tests.

**Tasks In Progress**: TASK-001 (further opt-in or migrate remaining inline legacy), TASK-002, TASK-003, TASK-004. TASK-005 completed.

**Verification**: `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bun test` (922 pass), `bun run typecheck`, `bun run typecheck:server`.

### Session: 2026-04-25 (TASK-001: drop global legacy-validation env; explicit test opt-in)

**Tasks Completed**: Removed `DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT` from `vitest.config.ts` and `scripts/run-bun-tests.sh`. Dropped per-file `beforeEach` env injection in favor of explicit `rejectLegacyWorkflowAuthoring: false` on load/run options in `history`, `runtime-db`, `manager-message-service`, `communication-service`, `graphql/schema.test.ts`, `server/graphql.test.ts`, and `events/trigger-runner.test.ts`. Added `withLegacyWorkflowAuthorshipForCli` in `cli.test.ts` for integration tests that exercise the real CLI entrypoint against legacy disk bundles (no `LoadOptions` threading). Updated `isStrictWorkflowAuthorshipValidation` / `LoadOptions` documentation in code to match.

**Tasks In Progress**: TASK-001 (remaining checklist: primary-path-only strict authoring in production is already true; broader removal of legacy fixture shapes is still future work), TASK-002, TASK-003, TASK-004. TASK-005 completed.

**Verification**: `bash scripts/run-bun-tests.sh`, `bun test`, `bun run typecheck:server` (922 pass).

### Session: 2026-04-26 (TASK-001: local-transition `resumeStepId` guard)

**Tasks Completed**: Re-checked the working tree against the current step-addressed design and cutover posture; no replacement design doc or new implementation plan was needed. Diff review found a concrete authored-schema gap instead: `normalizeWorkflowStepTransition()` accepted `resumeStepId` even when `toWorkflowId` was absent, silently allowing a cross-workflow-only field on ordinary local transitions. Tightened `src/workflow/validate.ts` so local transitions now reject `resumeStepId`, added a focused regression in `src/workflow/validate.test.ts`, and clarified `design-docs/specs/design-workflow-json.md` that `resumeStepId` must be omitted unless the transition targets another workflow.

**Tasks In Progress**: TASK-001 (remaining checklist: primary-path-only strict authoring in production is already true; broader removal of legacy fixture shapes is still future work), TASK-002, TASK-003, TASK-004. TASK-005 completed.

**Verification**: `bun test src/workflow/validate.test.ts`, `bun run typecheck`, `bun run typecheck:server`.

### Session: 2026-04-26 (TASK-001: cross-workflow callee `workflowId` resolution parity)

**Tasks Completed**: Re-checked the working tree against the current step-addressed design and cutover posture; no design rewrite or replacement implementation plan was needed. Diff review found a runtime/validation mismatch in the new cross-workflow callee-entry alignment helper: `runWorkflowInternal` resolves child workflows by authored `workflowId` via catalog/root lookup, but `src/workflow/validate.ts` still assumed `toWorkflowId` matched the callee directory name (`<workflowRoot>/<toWorkflowId>/workflow.json`). That incorrectly rejected valid bundles when a callee lived in a differently named directory but still authored the requested `workflowId`. Updated sync + async callee-entry validation to scan the workflow root by `workflowId` in the same order the runtime uses (preferred direct directory, then other directories), then infer the start step from the resolved callee bundle. Added focused regressions in `src/workflow/validate.test.ts` for async + sync validation with a directory-name / `workflowId` mismatch.

**Tasks In Progress**: TASK-001 (remaining checklist: primary-path-only strict authoring in production is already true; broader removal of legacy fixture shapes is still future work), TASK-002, TASK-003, TASK-004. TASK-005 completed.

**Verification**: `bun test src/workflow/validate.test.ts`, `bun run typecheck`.

### Session: 2026-04-25 (TASK-003: engine regression — cross-workflow callee resolution)

**Tasks Completed**: Added `src/workflow/engine.test.ts` integration coverage for step-addressed cross-workflow execution when the callee bundle directory name differs from authored `workflow.json` `workflowId`, so the runtime workflow-call path exercises the same `loadWorkflowByIdFromDisk` resolution order as validation (`validate.ts` callee-entry alignment).

**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004 (checklist depth unchanged); TASK-005 completed.

**Verification**: `bash scripts/run-bun-tests.sh` (972 pass), `bun run typecheck:server`.

### Session: 2026-04-25 (agent: architecture check, test verification)

**Tasks Completed**: Confirmed `design-auto-improve-superviser-mode.md` Phase 1 (engine `runAutoImproveLoop`, incident/remediation budgets, execution-copy patch revision audit, reserved `superviserWorkflowId` for Phase 2) matches the current `engine` / `superviser` / `mutable-workspace` implementation. Re-checked the cutover plan *Current repository posture*: step-first inspection with transitional compatibility runtime remains the intended ship posture until TASK-001 through TASK-004 complete. Re-ran `bash scripts/run-bun-tests.sh` and `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bun test` (972 pass), `bun run typecheck`, `bun run typecheck:server`.

**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004; TASK-005 completed.

### Session: 2026-04-25 (agent: suite verification, architecture, doc precision)

**Tasks Completed**: Ran `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (984 pass, 0 fail) and `bun run typecheck` on the current branch. Re-confirmed `impl-plans/PROGRESS.json`: `auto-improve-superviser-mode` **Completed** (phase 130); this plan **In Progress** with **TASK-002–TASK-004** (phase 129). **Architecture**: Phase 1 auto-improve (`runAutoImproveLoop`, `planSupervisionRemediation` with prior-failure scan, execution-copy patch audit) remains aligned with `design-docs/specs/design-auto-improve-superviser-mode.md` Phase 1; step-addressed cutover stays **transitional** per *Current repository posture* until TASK-002–004 module checklists close. **Docs**: `impl-plans/completed/auto-improve-superviser-mode.md` patch-escalation checklist line now describes repeat detection via **failure** incident `summary` (not a loose `lastError` label).

**Tasks In Progress**: TASK-002, TASK-003, TASK-004; TASK-001 and TASK-005 **Completed** in `PROGRESS.json`.

### Session: 2026-04-25 (agent: follow-up -- full suite, active plan, working-tree review)

**Tasks Completed**: Re-ran `env -u DIVEDRA_VALIDATION_LEGACY_AUTH_DEFAULT bash scripts/run-bun-tests.sh` (988 pass, 0 fail) and `bun run typecheck` on the current tree. Confirmed `auto-improve-superviser-mode` remains **Completed** in `impl-plans/PROGRESS.json` and Phase 1 (engine `runAutoImproveLoop`, execution-copy patch audit, `planSupervisionRemediation`) still matches `design-auto-improve-superviser-mode.md`; only `step-addressed-workflow-runtime-cutover` is **In Progress** with **TASK-002–TASK-004** (end-state module checklists; transitional *Current repository posture*). Reviewed the working diff (workflow engine/call-step/superviser, TUI, GraphQL, CLI, session paths): no bugs or follow-ups that required a code or design change in this iteration.

**Tasks In Progress**: TASK-002, TASK-003, TASK-004. TASK-001 and TASK-005 **Completed** in `PROGRESS.json`.

## Related Plans

- **Previous**: `impl-plans/workflow-role-unification-structural-cleanup.md`
- **Next**: `impl-plans/completed/auto-improve-superviser-mode.md` (phase 1 complete; plan retains phase 2 follow-ups)
- **Depends On**: `impl-plans/workflow-role-unification.md`, `impl-plans/workflow-role-unification-structural-cleanup.md`, `impl-plans/node-session-reuse.md`, `impl-plans/manager-driven-call-node-runtime.md`
