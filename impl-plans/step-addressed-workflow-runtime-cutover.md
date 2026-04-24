# Step-addressed Workflow Runtime Cutover Implementation Plan

**Status**: In Progress
**Design Reference**: `design-docs/specs/design-workflow-json.md`, `design-docs/specs/design-node-jump-and-code-manager-runtime.md`, `design-docs/specs/design-workflow-steps-and-node-reuse.md`, `design-docs/specs/architecture.md`, `design-docs/specs/command.md`, `design-docs/user-qa/qa-step-schema-workflow-calls.md`
**Created**: 2026-04-24
**Last Updated**: 2026-04-24

## Design Document Reference

**Source**:

- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/design-node-jump-and-code-manager-runtime.md`
- `design-docs/specs/design-workflow-steps-and-node-reuse.md`
- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`
- `design-docs/user-qa/qa-step-schema-workflow-calls.md`

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
`entryNodeId`, `managerNodeId`, `workflowCalls`, `edges`, `loops`,
`subWorkflows`, `subWorkflowConversations`, branch/loop judges, and
`call-node` naming is out of scope.

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

- `--auto-improve` supervision runtime
- browser/web editor feature work beyond schema/runtime alignment
- preserving compatibility loaders or runtime branches for removed legacy
  workflow fields

## Modules

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
| Authored schema and bundle I/O               | Existing workflow save/load foundation      | READY       |
| Step execution state and unified `call-step` | Authored schema and bundle I/O              | IN_PROGRESS |
| Engine and deterministic manager runtime     | Authored schema and step execution state    | BLOCKED     |
| Public surfaces and inspection               | Authored schema and step execution state    | IN_PROGRESS |
| Examples, docs, and regression replacement   | Schema, runtime, and public-surface cutover | BLOCKED     |

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
**Notes**: Re-checked the active architecture and implementation plan against the current working-tree diff before continuing. The design still matches the intended transitional purpose, so no replacement design document or new plan was needed. Review uncovered a real schema/runtime mismatch instead of just stale example docs: the repository documentation already described `workflowCalls` as a compatibility path that can coexist with ongoing step-addressed migration work, but `normalizeStepAddressedWorkflow()` still rejected `workflowCalls` unconditionally whenever a bundle authored `steps[]`. Fixed that validation boundary so non-strict validation preserves compatibility `workflowCalls` on step-addressed bundles while strict authored-schema mode still rejects them. With that support in place, migrated `examples/workflow-call-simple` from legacy `managerNodeId`/`edges` authoring to `managerStepId`/`entryStepId` plus `steps[]`, removed unsupported node-registry `role` metadata from the example, and updated the load regression plus README/example docs to describe it as a step-addressed parent that still uses compatibility workflow-call metadata. Re-ran `bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/engine.test.ts --timeout 120000`, `bun run typecheck`, `bun run src/main.ts workflow validate workflow-call-simple --workflow-root ./examples`, `bun run src/main.ts workflow inspect workflow-call-simple --workflow-root ./examples --output json`, and `bun run src/main.ts workflow run workflow-call-simple --workflow-root ./examples --mock-scenario ./examples/workflow-call-simple/mock-scenario.json --output json` with isolated runtime roots; all passed.

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
**Notes**: Continued the requested git-diff review pass and fixed a remaining authored-schema mismatch in the step-addressed validator. Empty `workflow.steps[]` / `workflow.nodes[]` arrays now fail with direct step-addressed schema errors, and semantic validation no longer leaks compatibility-only `workflow.managerNodeId`, `workflow.entryNodeId`, or synthesized `workflow.edges[*]` diagnostics when the authored step graph is invalid. Added focused regressions covering those empty-array and diagnostic-leak scenarios, then re-ran `bun test src/workflow/validate.test.ts` and `bun run typecheck`, both passing. TASK-001 remains in progress because the broader runtime/session/public-surface cutover modules are still pending.

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
**Notes**: Reviewed the remaining shipped examples and found one unencoded repository boundary: `workflow-call-simple` was still treated as a normal example in docs/tests even though its parent bundle intentionally remains compatibility-authored through `managerNodeId`, `workflowCalls`, and authored `edges`. Updated `examples/README.md` to state that transitional status directly, and tightened `src/workflow/load.test.ts` so strict authored-schema loading now explicitly fails for the parent bundle while the worker-only callee still passes in strict mode. Re-ran `bun test src/workflow/load.test.ts` and `bun run typecheck`; both passed. TASK-001 remains in progress because the later step-addressed workflow-call/runtime cutover is still pending.

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

## Related Plans

- **Previous**: `impl-plans/workflow-role-unification-structural-cleanup.md`
- **Next**: `impl-plans/auto-improve-superviser-mode.md`
- **Depends On**: `impl-plans/workflow-role-unification.md`, `impl-plans/workflow-role-unification-structural-cleanup.md`, `impl-plans/node-session-reuse.md`, `impl-plans/manager-driven-call-node-runtime.md`
