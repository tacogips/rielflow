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

**Status**: NOT_STARTED

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

**Status**: NOT_STARTED

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

**Status**: NOT_STARTED

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

**Status**: NOT_STARTED

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

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Authored schema and bundle I/O | `src/workflow/types.ts`, `src/workflow/json-schema.ts`, `src/workflow/validate.ts`, `src/workflow/load.ts`, `src/workflow/save.ts`, `src/workflow/inspect.ts`, `src/workflow/create.ts` | IN_PROGRESS | `src/workflow/validate.test.ts`, `src/workflow/load.test.ts`, `src/workflow/save.test.ts`, `src/workflow/json-schema.test.ts` |
| Step execution state and unified `call-step` | `src/workflow/call-step.ts`, `src/workflow/session.ts`, `src/workflow/runtime-db.ts`, `src/workflow/node-execution-mailbox.ts` | NOT_STARTED | `src/workflow/call-step.test.ts`, `src/workflow/runtime-db.test.ts`, `src/workflow/session-store.test.ts` |
| Engine and deterministic manager runtime | `src/workflow/engine.ts`, `src/workflow/manager-control.ts`, `src/workflow/prompt-composition.ts`, `src/workflow/input-assembly.ts` | NOT_STARTED | `src/workflow/engine.test.ts`, `src/workflow/manager-control.test.ts`, `src/workflow/prompt-composition.test.ts`, `src/workflow/input-assembly.test.ts` |
| Public surfaces and inspection | `src/lib.ts`, `src/cli.ts`, `src/graphql/schema.ts`, `src/tui/**/*` | NOT_STARTED | `src/lib.test.ts`, `src/cli.test.ts`, `src/graphql/schema.test.ts`, `src/server/graphql.test.ts`, `src/tui/opentui-screen.test.ts` |
| Examples, docs, and regression replacement | `examples/**/*`, `README.md`, `design-docs/specs/*.md` | NOT_STARTED | targeted example-validation and repository regression slices |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Authored schema and bundle I/O | Existing workflow save/load foundation | READY |
| Step execution state and unified `call-step` | Authored schema and bundle I/O | BLOCKED |
| Engine and deterministic manager runtime | Authored schema and step execution state | BLOCKED |
| Public surfaces and inspection | Authored schema and step execution state | BLOCKED |
| Examples, docs, and regression replacement | Schema, runtime, and public-surface cutover | BLOCKED |

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

## Related Plans

- **Previous**: `impl-plans/workflow-role-unification-structural-cleanup.md`
- **Next**: `impl-plans/auto-improve-superviser-mode.md`
- **Depends On**: `impl-plans/workflow-role-unification.md`, `impl-plans/workflow-role-unification-structural-cleanup.md`, `impl-plans/node-session-reuse.md`, `impl-plans/manager-driven-call-node-runtime.md`
