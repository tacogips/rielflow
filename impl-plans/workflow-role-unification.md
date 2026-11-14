# Workflow Role Unification Implementation Plan

**Status**: In Progress
**Design Reference**: design-docs/specs/design-unified-workflow-role-model.md
**Created**: 2026-03-19
**Last Updated**: 2026-03-26

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

**Status**: NOT_STARTED

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

- [ ] Remove root-manager-only start assumptions
- [ ] Remove subworkflow-manager child-input forwarding semantics
- [ ] Keep manager execution on the existing agent orchestration path only
- [ ] Replace structural nested-workflow planning with explicit workflow-call execution
- [ ] Redefine manager-control scope around the current workflow execution only
- [ ] Update prompt/mailbox composition to stop exposing structural input/output boundary roles

### 3. Templates, Examples, and TUI/CLI Presentation

#### `src/workflow/create.ts`, `examples/**/*.json`, `src/tui/opentui-model.ts`, `src/tui/opentui-screen.ts`, `README.md`

**Status**: NOT_STARTED

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

- [ ] Replace manager-kind wording in generated templates and TUI/CLI presentation helpers with role-oriented wording
- [ ] Support workflows with no manager in generated templates and user-facing summaries
- [ ] Add explicit workflow entry authoring to generated templates
- [ ] Replace structural sub-workflow example bundles with workflow-call-oriented examples
- [ ] Keep any future browser editor work out of scope unless a new design reintroduces that surface

### 4. Migration and Verification

#### `src/**/*.test.ts`, `design-docs/specs/*.md`, `README.md`, `examples/**/*.json`

**Status**: NOT_STARTED

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
- [ ] Add runtime tests for manager-less workflow execution
- [ ] Run targeted runtime, CLI, and TUI tests
- [ ] Run typechecks and build verification for the current TUI/CLI-only repository
- [ ] Run `bun run typecheck`, `bun test`, and `bun run build`

## Module Status

| Module                               | File Path                                                                                   | Status      | Tests                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------- |
| Authored schema and validation       | `src/workflow/types.ts`, `src/workflow/validate.ts`, `src/workflow/load.ts`                 | IN_PROGRESS | `bun test src/workflow/validate.test.ts src/workflow/load.test.ts`          |
| Runtime execution and workflow calls | `src/workflow/engine.ts`, `src/workflow/manager-control.ts`, `src/workflow/sub-workflow.ts` | NOT_STARTED | `bun test src/workflow/engine.test.ts src/workflow/manager-control.test.ts` |
| Templates, examples, and TUI/CLI presentation | `src/workflow/create.ts`, `examples/**/*.json`, `src/tui/opentui-model.ts`, `src/tui/opentui-screen.ts` | NOT_STARTED | `bun test src/tui/opentui-screen.test.ts`, targeted example/runtime tests |
| Migration and verification           | `design-docs/specs/*.md`, `README.md`, `src/**/*.test.ts`, `examples/**/*.json`             | NOT_STARTED | `bun run typecheck`, `bun test`, `bun run build`                            |

## Dependencies

| Feature                              | Depends On                           | Status  |
| ------------------------------------ | ------------------------------------ | ------- |
| Authored schema and validation       | New role model design                | READY   |
| Runtime execution and workflow calls | Authored schema and validation       | BLOCKED |
| Templates, examples, and TUI/CLI presentation | Authored schema and validation | BLOCKED |
| Migration and verification           | Runtime execution and templates/presentation updates | BLOCKED |

## Completion Criteria

- [ ] Authored schema uses `manager` and `worker` roles only
- [ ] Workflows with zero managers are valid and executable
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

## Related Plans

- **Previous**: `impl-plans/manager-kind-simplification.md`
- **Next**: None
- **Depends On**: `impl-plans/manager-kind-simplification.md`, `impl-plans/branch-and-loop-block-subworkflows.md`
