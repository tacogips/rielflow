# Workflow Role Unification Implementation Plan

**Status**: Planning
**Design Reference**: design-docs/specs/design-unified-workflow-role-model.md
**Created**: 2026-03-19
**Last Updated**: 2026-03-19

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

**Status**: NOT_STARTED

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
- [ ] Make `managerNodeId` optional and add `entryNodeId`
- [ ] Enforce that manager-role nodes stay on the agent execution path
- [ ] Remove authored structural sub-workflow boundary fields
- [ ] Add validation coverage for zero-manager worker-only workflows
- [ ] Add validation coverage for rejecting multiple managers

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

### 3. Editor, Templates, and Examples

#### `ui/src/lib/editor-*.ts`, `ui/src/lib/components/*.tsx`, `src/workflow/create.ts`, `examples/**/*.json`, `e2e/**/*.cjs`

**Status**: NOT_STARTED

```typescript
export type EditorNodeRole = "manager" | "worker";

export interface EditableWorkflowCall {
  id: string;
  workflowId: string;
  callerNodeId: string;
  resultNodeId?: string;
}
```

**Checklist**:
- [ ] Replace manager-kind UI with role UI
- [ ] Support workflows with no manager in the editor
- [ ] Hide non-agent node-type controls for manager nodes
- [ ] Add explicit workflow entry editing
- [ ] Replace sub-workflow boundary editing with workflow-call editing
- [ ] Update generated templates and example bundles to the new model

### 4. Migration and Verification

#### `src/**/*.test.ts`, `ui/src/**/*.test.ts`, `design-docs/specs/*.md`, `README.md`

**Status**: NOT_STARTED

```typescript
interface VerificationCommandSet {
  readonly typecheckServer: "bun run typecheck:server";
  readonly typecheckUi: "bun run typecheck:ui";
  readonly unitTests: "bun test";
  readonly buildUi: "bun run build:ui";
}
```

**Checklist**:
- [ ] Update architecture and workflow docs to the new role model
- [ ] Remove tests that assume structural sub-workflow manager/input/output kinds
- [ ] Add runtime tests for manager-less workflow execution
- [ ] Run targeted server and UI tests
- [ ] Run typechecks and UI build

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Authored schema and validation | `src/workflow/types.ts`, `src/workflow/validate.ts`, `src/workflow/load.ts` | NOT_STARTED | `bun test src/workflow/validate.test.ts src/workflow/load.test.ts` |
| Runtime execution and workflow calls | `src/workflow/engine.ts`, `src/workflow/manager-control.ts`, `src/workflow/sub-workflow.ts` | NOT_STARTED | `bun test src/workflow/engine.test.ts src/workflow/manager-control.test.ts` |
| Editor, templates, and examples | `ui/src/lib/editor-*.ts`, `src/workflow/create.ts`, `examples/**/*.json` | NOT_STARTED | `bun test ui/src/lib/*.test.ts`, targeted E2E |
| Migration and verification | `design-docs/specs/*.md`, `README.md`, `src/**/*.test.ts`, `ui/src/**/*.test.ts` | NOT_STARTED | `bun run typecheck:server`, `bun run typecheck:ui`, `bun run build:ui` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Authored schema and validation | New role model design | READY |
| Runtime execution and workflow calls | Authored schema and validation | BLOCKED |
| Editor, templates, and examples | Authored schema and validation | BLOCKED |
| Migration and verification | Runtime execution and editor updates | BLOCKED |

## Completion Criteria

- [ ] Authored schema uses `manager` and `worker` roles only
- [ ] Workflows with zero managers are valid and executable
- [ ] Manager nodes cannot be authored as `command`, `container`, or `user-action`
- [ ] Workflow nesting no longer relies on structural sub-workflow manager/input/output nodes
- [ ] Editor can author manager-less workflows and explicit workflow calls
- [ ] Tests and typechecks pass

## Progress Log

### Session: 2026-03-19 00:00
**Tasks Completed**: Design assessment, implementation plan creation
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The current codebase has just committed the opposite direction (`root-manager` / `subworkflow-manager` plus structural sub-workflow boundaries). This plan treats the requested `manager` / `worker` / `workflow` model as a schema-and-runtime redesign rather than as a naming cleanup. Manager nodes are now explicitly defined as agent-only coordinators, not generic executable node types.

## Related Plans

- **Previous**: `impl-plans/manager-kind-simplification.md`
- **Next**: None
- **Depends On**: `impl-plans/manager-kind-simplification.md`, `impl-plans/branch-and-loop-block-subworkflows.md`
