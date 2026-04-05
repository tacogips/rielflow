# Workflow Role Unification Implementation Plan

**Status**: In Progress
**Design Reference**: design-docs/specs/design-unified-workflow-role-model.md
**Created**: 2026-03-19
**Last Updated**: 2026-04-05

## Design Document Reference

**Source**: `design-docs/specs/design-unified-workflow-role-model.md`

### Summary

Replace the structural root-manager/subworkflow-manager/input/output workflow model with a unified role model where node roles are `manager` or `worker`, workflow managers are optional, manager nodes are always agent-backed coordinators, and workflow nesting becomes explicit workflow invocation rather than structural sub-workflow ownership.

### Scope

**Included**:

- authored schema changes for node roles and workflow entry
- validator and loader changes for optional managers and manager-less workflows
- manager-node payload restrictions so managers cannot be `command`/`container`/`user-action`
- runtime redesign for explicit workflow invocation instead of structural sub-workflow boundaries
- editor and template updates for manager/worker roles and workflow-call authoring
- migration of examples, docs, and tests

**Excluded**:

- adapter/backend redesign
- a compatibility alias layer for the current `root-manager` / `subworkflow-manager` schema
- unrelated prompt-quality or UI styling changes

## Modules

### 1. Authored Schema and Validation

#### `src/workflow/types.ts`, `src/workflow/validate.ts`, `src/workflow/load.ts`

**Status**: IN_PROGRESS

```typescript
export type NodeRole = "manager" | "worker";

export type NodeControlKind = "none" | "branch-judge" | "loop-judge";

export interface WorkflowNodeRef {
  readonly id: string;
  readonly nodeFile: string;
  readonly role?: NodeRole;
  readonly control?: NodeControlKind;
  readonly completion?: CompletionRule;
  readonly execution?: WorkflowNodeExecutionPolicy;
}

export interface WorkflowCallRef {
  readonly id: string;
  readonly workflowId: string;
  readonly callerNodeId: string;
  readonly resultNodeId?: string;
}

export interface WorkflowJson {
  readonly workflowId: string;
  readonly description: string;
  readonly defaults: WorkflowDefaults;
  readonly prompts?: WorkflowPrompts;
  readonly managerNodeId?: string;
  readonly entryNodeId?: string;
  readonly workflowCalls?: readonly WorkflowCallRef[];
  readonly nodes: readonly WorkflowNodeRef[];
  readonly edges: readonly WorkflowEdge[];
  readonly loops?: readonly LoopRule[];
  readonly branching: {
    readonly mode: "fan-out";
  };
}
```

**Checklist**:

- [ ] Replace structural node `kind` usage with `role` and `control`
- [x] Make `managerNodeId` optional and add `entryNodeId`
- [x] Enforce that manager-role nodes stay on the agent execution path
- [ ] Remove authored structural sub-workflow boundary fields
- [x] Add validation coverage for zero-manager worker-only workflows
- [x] Add validation coverage for rejecting multiple managers

### 2. Runtime Execution and Workflow Calls

#### `src/workflow/engine.ts`, `src/workflow/manager-control.ts`, `src/workflow/sub-workflow.ts`, `src/workflow/conversation.ts`, `src/workflow/node-execution-mailbox.ts`, `src/workflow/prompt-composition.ts`

**Status**: IN_PROGRESS

```typescript
interface WorkflowCallRequest {
  readonly workflowCallId: string;
  readonly workflowId: string;
  readonly callerNodeId: string;
  readonly parentWorkflowExecutionId: string;
}

interface WorkflowEntryResolution {
  readonly workflowId: string;
  readonly entryNodeId: string;
  readonly managerNodeId?: string;
}
```

**Checklist**:

- [x] Remove root-manager-only start assumptions
- [ ] Remove subworkflow-manager child-input forwarding semantics
- [ ] Keep manager execution on the existing agent orchestration path only
- [ ] Replace structural nested-workflow planning with explicit workflow-call execution
- [ ] Redefine manager-control scope around the current workflow execution only
- [ ] Update prompt/mailbox composition to stop exposing structural input/output boundary roles

### 3. Templates, Examples, and TUI/CLI Presentation

#### `src/workflow/create.ts`, `examples/**/*.json`, `src/tui/opentui-model.ts`, `src/tui/opentui-screen.ts`, `README.md`

**Status**: IN_PROGRESS

```typescript
export type PresentedNodeRole = "manager" | "worker";

export interface AuthoredWorkflowCallTemplate {
  id: string;
  workflowId: string;
  callerNodeId: string;
  resultNodeId?: string;
}
```

**Checklist**:

- [x] Replace manager-kind wording in generated templates and TUI/CLI presentation helpers with role-oriented wording
- [x] Support workflows with no manager in generated templates and user-facing summaries
- [x] Add explicit workflow entry authoring to generated templates
- [ ] Replace structural sub-workflow example bundles with workflow-call-oriented examples
- [ ] Keep any future browser editor work out of scope unless a new design reintroduces that surface

### 4. Migration and Verification

#### `src/**/*.test.ts`, `design-docs/specs/*.md`, `README.md`, `examples/**/*.json`

**Status**: IN_PROGRESS

```typescript
interface VerificationCommandSet {
  readonly typecheck: "bun run typecheck";
  readonly unitTests: "bun test";
  readonly build: "bun run build";
}
```

**Checklist**:

- [ ] Update architecture and workflow docs to the new role model
- [ ] Remove tests that assume structural sub-workflow manager/input/output kinds
- [x] Add runtime tests for manager-less workflow execution
- [x] Run targeted runtime, CLI, and TUI tests
- [x] Run typechecks and build verification for the current TUI/CLI-only repository
- [x] Run `bun run typecheck`, `bun test`, and `bun run build`

## Module Status

| Module                               | File Path                                                                                   | Status      | Tests                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------- |
| Authored schema and validation       | `src/workflow/types.ts`, `src/workflow/validate.ts`, `src/workflow/load.ts`                 | IN_PROGRESS | `bun test src/workflow/validate.test.ts src/workflow/load.test.ts`          |
| Runtime execution and workflow calls | `src/workflow/engine.ts`, `src/workflow/manager-control.ts`, `src/workflow/sub-workflow.ts` | IN_PROGRESS | `bun test src/workflow/engine.test.ts src/workflow/manager-control.test.ts` |
| Templates, examples, and TUI/CLI presentation | `src/workflow/create.ts`, `examples/**/*.json`, `src/tui/opentui-model.ts`, `src/tui/opentui-screen.ts` | IN_PROGRESS | `bun test src/tui/opentui-screen.test.ts`, targeted example/runtime tests |
| Migration and verification           | `design-docs/specs/*.md`, `README.md`, `src/**/*.test.ts`, `examples/**/*.json`             | IN_PROGRESS | `bun run typecheck:server`, `bun test`, `bun run build`                     |

## Dependencies

| Feature                              | Depends On                           | Status  |
| ------------------------------------ | ------------------------------------ | ------- |
| Authored schema and validation       | New role model design                | IN_PROGRESS |
| Runtime execution and workflow calls | Authored schema and validation       | IN_PROGRESS |
| Templates, examples, and TUI/CLI presentation | Authored schema and validation | IN_PROGRESS |
| Migration and verification           | Runtime execution and templates/presentation updates | IN_PROGRESS |

## Completion Criteria

- [ ] Authored schema uses `manager` and `worker` roles only
- [x] Workflows with zero managers are valid and executable
- [ ] Manager nodes cannot be authored as `command`, `container`, or `user-action`
- [ ] Workflow nesting no longer relies on structural sub-workflow manager/input/output nodes
- [ ] Generated templates and the checked-in TUI/CLI text can describe manager-less workflows and explicit workflow calls
- [ ] Tests and typechecks pass

## Progress Log

### Session: 2026-03-19 00:00

**Tasks Completed**: Design assessment, implementation plan creation
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The current codebase has just committed the opposite direction (`root-manager` / `subworkflow-manager` plus structural sub-workflow boundaries). This plan treats the requested `manager` / `worker` / `workflow` model as a schema-and-runtime redesign rather than as a naming cleanup. Manager nodes are now explicitly defined as agent-only coordinators, not generic executable node types.

### Session: 2026-03-19 12:10

**Tasks Completed**: Partial TASK-001
**Tasks In Progress**: TASK-001
**Blockers**: Runtime execution still assumes structural root/subworkflow manager boundaries, so authored schema changes remain in compatibility mode until TASK-002 rewires execution.
**Notes**: Added authored `role`, `control`, `entryNodeId`, and `workflowCalls` support in validation/loading while preserving legacy `kind`-based runtime compatibility. Added validation coverage for manager-less worker-only workflows, multiple manager rejection, workflow call references, and manager agent-path enforcement. Verified with `bun test src/workflow/validate.test.ts src/workflow/load.test.ts` and `bun run typecheck:server`.

### Session: 2026-03-20 00:00

**Tasks Completed**: TASK-001 review hardening
**Tasks In Progress**: TASK-001
**Blockers**: `workflowCalls` and manager-less execution remain blocked on TASK-002 runtime work; validation now rejects those authored bundles during the compatibility phase instead of silently accepting them.
**Notes**: Review found that the runtime still boots from `workflow.managerNodeId` and has no execution path for explicit `workflowCalls`, so the transitional validator now reports those shapes as non-executable. Updated `src/workflow/validate.test.ts` and `src/workflow/load.test.ts` to keep unified role coverage while preventing unsupported bundles from loading as runnable workflows. Verified with `bun test src/workflow/validate.test.ts src/workflow/load.test.ts` and `bun run typecheck:server`.

### Session: 2026-03-26 22:40

**Tasks Completed**: Active-plan scope reassessment
**Tasks In Progress**: TASK-001, TASK-002
**Blockers**: Runtime execution still assumes the structural root/subworkflow manager model, and the repository no longer contains the previously referenced browser editor surface
**Notes**: Re-reviewed this active plan against the current repository architecture after the checked-in web UI was removed and the TUI moved to OpenTUI Solid. The role-unification design intent still stands, but the plan had become stale because it referenced deleted `ui/` and E2E deliverables plus UI-only verification commands. Narrowed the plan to the current repository surfaces: runtime/schema work first, then generated templates/examples and any necessary TUI/CLI presentation updates. If a browser editor is reintroduced later, that should happen under a new design and implementation plan instead of silently reviving the deleted paths here.

### Session: 2026-04-05 00:00

**Tasks Completed**: Manager-less workflow runtime support slice
**Tasks In Progress**: TASK-001, TASK-002
**Blockers**: Explicit `workflowCalls` execution and structural sub-workflow removal remain unimplemented in the runtime
**Notes**: Removed the transitional validator rejection for manager-less worker-only workflows, added load coverage for explicit `entryNodeId`, and verified that `runWorkflow` now executes a manager-less workflow from its entry node. Verified with `bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/engine.test.ts` and `bun run typecheck:server`.

### Session: 2026-04-05 00:30

**Tasks Completed**: Partial TASK-003 template modernization
**Tasks In Progress**: TASK-001, TASK-002, TASK-003
**Blockers**: Runtime still exposes structural sub-workflow semantics, so examples and broader TUI/README presentation cannot fully move to workflow-call language yet
**Notes**: Updated `createWorkflowTemplate` to scaffold a role-based workflow with explicit `entryNodeId` and no structural sub-workflow bundle. Updated load coverage to assert the new template shape and re-verified with `bun test src/workflow/load.test.ts src/workflow/engine.test.ts src/workflow/validate.test.ts` and `bun run typecheck:server`.

### Session: 2026-04-05 02:15

**Tasks Completed**: TASK-003 presentation hardening, migration/doc follow-up slice
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004
**Blockers**: Explicit `workflowCalls` execution and structural sub-workflow removal still block full replacement of the legacy runtime vocabulary
**Notes**: Review of the current diff found stale CLI/template expectations after the role-based template cutover. Updated CLI/TUI inspection surfaces so worker-only workflows report `entryNodeId` and do not pretend an authored manager exists, refreshed README and architecture notes to describe the current transitional architecture accurately, and fixed CLI tests that still assumed the removed `main-divedra` / `workflow-input` / `workflow-output` template nodes. Verification: `bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/engine.test.ts src/cli.test.ts src/tui/opentui-screen.test.ts src/tui/opentui-screen-runtime.test.ts src/tui/opentui-screen-navigation.test.ts src/tui/opentui-controller.test.ts src/tui/opentui-detail-content.test.ts` and `bun run typecheck:server`.

### Session: 2026-04-05 04:30

**Tasks Completed**: TASK-003 template backend alignment, TASK-004 verification follow-up
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004
**Blockers**: Explicit `workflowCalls` execution and structural sub-workflow removal still block full replacement of the legacy runtime vocabulary
**Notes**: Reviewed the remaining diff for stale assumptions after the role-based starter template change and found that the generated workflow still scaffolded both manager and worker nodes on `codex-agent`, which contradicted the repository's intended manager-on-`claude-code-agent` / worker-on-`codex-agent` split. Updated `createWorkflowTemplate`, refreshed the direct template assertions and command/README docs, and fixed stale regression tests that still depended on the removed legacy starter shape by separating role-based template fixtures from explicit subworkflow-manager fixtures. Verification: `bun test src/workflow/validate.test.ts src/workflow/load.test.ts src/workflow/engine.test.ts src/workflow/save.test.ts src/workflow/communication-service.test.ts src/workflow/manager-message-service.test.ts src/cli.test.ts src/tui/opentui-screen.test.ts` and `bun run typecheck:server`.

### Session: 2026-04-05 06:15

**Tasks Completed**: Additional TASK-003 manager-less template authoring support
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004
**Blockers**: Explicit `workflowCalls` execution and structural sub-workflow removal still block full replacement of the legacy runtime vocabulary
**Notes**: The architecture and current implementation already supported manager-less authored workflows at validation, load, execution, and inspect time, but `workflow create` still could not scaffold one. Added a `--worker-only` starter mode so the generated bundle can now match the intended worker-only authoring path without manual edits, updated command/README docs, and refreshed the active plan checklist/table entries that had become stale relative to the already-landed manager-less runtime slice. Verification: targeted `bun test src/workflow/load.test.ts src/cli.test.ts` and `bun run typecheck:server`, followed by the broader role-unification regression slice and a full `bun test` / `bun run build` pass if this plan moves into verification completion later.

### Session: 2026-04-05 09:45

**Tasks Completed**: TASK-004 verification hardening slice, diff-review regression fixes
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004
**Blockers**: Explicit `workflowCalls` execution and structural sub-workflow removal still block completion of the unified role model
**Notes**: Repository-wide verification after the manager-less starter/template work exposed stale library and GraphQL fixtures that still assumed the removed four-node starter shape and the `workflow-input` retry target. Updated those fixtures to the role-based `divedra-manager` / `main-worker` starter, kept the root-manager communication-scope assertions on an explicit grouped-workflow fixture, and re-ran verification cleanly with `bun test src/lib.test.ts src/server/graphql.test.ts src/graphql/schema.test.ts`, `bun run typecheck:server`, full `bun test`, and `bun run build`.

### Session: 2026-04-05 16:35

**Tasks Completed**: Additional TASK-004 GraphQL inspection contract alignment
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004
**Blockers**: Explicit `workflowCalls` execution and structural sub-workflow removal still block completion of the unified role model
**Notes**: Diff review found that the manager-less workflow slice had updated CLI/TUI inspection, but the GraphQL `WorkflowView` schema still required `managerNodeId: String!`, which would break worker-only workflow inspection over the control plane. Made `managerNodeId` nullable, exposed `hasManagerNode` and `entryNodeId` through the executable schema, and added direct-schema plus HTTP regression coverage for worker-only workflows. Verification: `bun test src/graphql/schema.test.ts src/server/graphql.test.ts` and `bun run typecheck:server`.

### Session: 2026-04-05 16:45

**Tasks Completed**: Additional TASK-003/TASK-004 GraphQL workflow-definition authoring parity
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004
**Blockers**: Explicit `workflowCalls` execution and structural sub-workflow removal still block completion of the unified role model
**Notes**: Diff review found that `workflow create --worker-only` had been added only on the CLI path, while the GraphQL `createWorkflowDefinition` mutation still always scaffolded the managed starter. Added GraphQL template-mode normalization so direct schema calls can use `worker-only` and HTTP GraphQL callers can use `WORKER_ONLY`, updated the executable schema input, documented the new control-plane parity in `README.md`, and added schema plus HTTP regression coverage that verifies the authored `workflow.json` omits `managerNodeId` for worker-only starters. Verification: `bun test src/graphql/schema.test.ts src/server/graphql.test.ts`, `bun run typecheck:server`, and `bun run build`.

### Session: 2026-04-05 18:10

**Tasks Completed**: Additional TASK-003/TASK-004 worker-only example and workflow-json design alignment
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004
**Blockers**: Explicit `workflowCalls` execution and structural sub-workflow removal still block completion of the unified role model
**Notes**: Re-checked the current architecture against the intended role-unified purpose and found that the implementation had moved ahead of `design-workflow-json.md`: the repository now accepts role-based authored bundles and manager-less `entryNodeId` workflows, but the design doc still described the older mandatory-manager structural schema. Updated the workflow-json design to distinguish raw authored input from normalized runtime shape, added a checked-in `examples/worker-only-single-step` bundle so the manager-less path is exercised as a first-class example, and added load coverage for that example. Verification: `bun test src/workflow/load.test.ts` plus the broader role-unification regression slice.

### Session: 2026-04-05 19:05

**Tasks Completed**: Additional TASK-003/TASK-004 authored-save round-trip hardening
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004
**Blockers**: Explicit `workflowCalls` execution and structural sub-workflow removal still block completion of the unified role model
**Notes**: Diff review found a compatibility leak in `saveWorkflowToDisk`: worker-only workflows and other role-authored definitions loaded through the normalized runtime bundle would persist internal fields back into `workflow.json` on save, including `hasManagerNode`, an effective `managerNodeId`, and derived structural `kind` values. Updated the save path to persist authored workflow JSON instead of the fully normalized runtime workflow for these fields, added save-regression coverage for managed and worker-only templates, and added a GraphQL save-mutation regression that keeps worker-only definitions manager-less across control-plane round trips. Verification: targeted save and GraphQL schema tests.

### Session: 2026-04-05 20:10

**Tasks Completed**: Additional TASK-001/TASK-004 workflow-call authored-schema admission slice
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004
**Blockers**: Explicit `workflowCalls` execution and structural sub-workflow removal still block completion of the unified role model
**Notes**: Re-checked the current architecture against the intended purpose and found the validator/runtime boundary was still misaligned: the design already treats `workflowCalls` as part of the authored schema, but the implementation rejected them at validation time instead of accepting them and surfacing the real blocker at execution. Updated validation/load to accept authored `workflowCalls`, moved the executability failure to `inspectWorkflowRuntimeReadiness`, documented the transitional behavior in README and design docs, and added regression coverage that verifies load-time acceptance plus early runtime failure when a workflow-call-enabled bundle is run before workflow-call execution exists.

### Session: 2026-04-05 16:58 JST

**Tasks Completed**: Additional TASK-004 authored-save persistence alignment
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004
**Blockers**: Explicit `workflowCalls` execution and structural sub-workflow removal still block completion of the unified role model
**Notes**: Re-reviewed the active diff against the intended role-unified architecture and found the remaining mismatch was in persistence rather than design: `saveWorkflowToDisk` still serialized normalized compatibility state back into `workflow.json`, which leaked omitted authored fields such as inferred manager/entry wiring, default container runtime, synthesized edges/branching, and derived node role/control metadata. Updated the save path to preserve the authored optional-shape decisions while still round-tripping through the normalized runtime bundle, added focused regression coverage for omitted top-level fields plus node-level derived metadata, and re-verified the save/load plus API-facing workflow-definition surfaces with `bun test src/workflow/save.test.ts src/workflow/load.test.ts`, `bun test src/cli.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts`, and `bun run typecheck`.

## Related Plans

- **Previous**: `impl-plans/manager-kind-simplification.md`
- **Next**: None
- **Depends On**: `impl-plans/manager-kind-simplification.md`, `impl-plans/branch-and-loop-block-subworkflows.md`
