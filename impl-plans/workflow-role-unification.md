# Workflow Role Unification Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-unified-workflow-role-model.md
**Created**: 2026-03-19
**Last Updated**: 2026-04-05

## Design Document Reference

**Source**: `design-docs/specs/design-unified-workflow-role-model.md`

### Summary

This plan delivered the transitional role-unification slice that the repository is now running on:

- authored node roles use `manager` and `worker`
- workflows may be manager-less via explicit `entryNodeId`
- manager-role nodes are restricted to the agent execution path
- authored `workflowCalls` are executable and no longer blocked at runtime readiness
- create/save/load/inspect surfaces preserve authored-minimal workflow JSON instead of leaking normalized compatibility fields
- CLI, TUI, GraphQL, README, and example bundles describe the current role-based and workflow-call-capable architecture consistently

The remaining work is narrower than this original plan. Legacy structural sub-workflow execution semantics still exist as a compatibility layer, so the unfinished cleanup has been split into `impl-plans/workflow-role-unification-structural-cleanup.md`.

### Scope

**Included**:

- authored schema changes for node roles and workflow entry
- validator and loader changes for optional managers and manager-less workflows
- manager-node payload restrictions so managers cannot be `command`, `container`, or `user-action`
- executable workflow-call runtime support and readiness probing
- authored-minimal starter/save round-trip behavior
- migration of examples, docs, CLI/TUI/GraphQL inspection, and regression coverage to the transitional role-based model

**Excluded**:

- adapter/backend redesign
- full removal of legacy structural sub-workflow runtime compatibility
- unrelated prompt-quality or UI styling changes

## Modules

### 1. Authored Schema and Validation

#### `src/workflow/types.ts`, `src/workflow/validate.ts`, `src/workflow/load.ts`

**Status**: COMPLETED

```typescript
export type NodeRole = "manager" | "worker";

export type NodeControlKind = "none" | "branch-judge" | "loop-judge";

export interface WorkflowCallRef {
  readonly id: string;
  readonly workflowId: string;
  readonly callerNodeId: string;
  readonly resultNodeId?: string;
}
```

**Checklist**:

- [x] Make `managerNodeId` optional and add `entryNodeId`
- [x] Enforce that manager-role nodes stay on the agent execution path
- [x] Add validation/load coverage for zero-manager worker-only workflows
- [x] Accept authored `workflowCalls` in the authored schema
- [x] Preserve authored-minimal top-level and node-level omission rules across load/save

### 2. Runtime Execution and Workflow Calls

#### `src/workflow/engine.ts`, `src/workflow/manager-control.ts`, `src/workflow/node-execution-mailbox.ts`, `src/workflow/prompt-composition.ts`

**Status**: COMPLETED

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

- [x] Remove root-manager-only start assumptions for manager-less workflows
- [x] Keep manager execution on the existing agent orchestration path only
- [x] Replace structural nested-workflow blocking with executable `workflowCalls`
- [x] Route role-authored manager prompts, input assembly, and manager-session setup through shared role-aware helpers
- [x] Add workflow-call runtime-readiness probing, target resolution by `workflowId`, and result-contract coverage

### 3. Templates, Examples, and Presentation

#### `src/workflow/create.ts`, `examples/**/*.json`, `src/cli.ts`, `src/tui/opentui-model/**/*.ts`, `src/graphql/schema.ts`, `README.md`

**Status**: COMPLETED

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

- [x] Replace manager-kind wording in generated templates and inspection surfaces with role-oriented wording
- [x] Support worker-only starter templates and manager-less workflow summaries
- [x] Add workflow-call examples for a managed parent and worker-only callee
- [x] Expose authored `workflowCalls` through CLI, TUI, GraphQL, and README inspection/reference surfaces

### 4. Persistence and Verification

#### `src/workflow/save.ts`, `src/workflow/save.test.ts`, `src/graphql/schema.test.ts`, `src/server/graphql.test.ts`

**Status**: COMPLETED

```typescript
interface VerificationCommandSet {
  readonly typecheck: "bun run typecheck:server";
  readonly unitTests: "bun test";
  readonly build: "bun run build";
}
```

**Checklist**:

- [x] Keep save/edit surfaces authored-minimal for managed, worker-only, legacy-kind, and migrated role-authored workflows
- [x] Clean up stale node payload and prompt-template files during save
- [x] Keep GraphQL workflow-definition mutations in parity with CLI create/save semantics
- [x] Re-run targeted regression slices plus full `bun test` / `bun run build`

## Completion Criteria

- [x] Role-authored manager/worker bundles validate, load, inspect, and save correctly
- [x] Worker-only workflows are valid and executable through `entryNodeId`
- [x] Manager nodes cannot be authored as `command`, `container`, or `user-action`
- [x] Authored `workflowCalls` execute and can deliver results back into the caller workflow
- [x] Generated templates, docs, examples, and inspection surfaces describe the current transitional role model accurately
- [x] The remaining structural compatibility cleanup is isolated to a focused successor plan

## Progress Summary

- `2026-03-19` to `2026-03-26`: established the authored role model, optional workflow entry, manager agent-path validation, and the narrowed repository scope after the browser UI removal.
- `2026-04-05` early: landed manager-less runtime execution, role-based starter generation, worker-only authoring parity, and role-aware CLI/TUI/GraphQL inspection surfaces.
- `2026-04-05` mid: hardened authored-minimal save/load behavior, GraphQL save/create parity, stale-file cleanup, optimistic locking, and legacy-kind round-trip/migration correctness.
- `2026-04-05` late: implemented executable `workflowCalls`, workflow-id-based target resolution, readiness probing, workflow-call result delivery, and workflow-call reference examples/docs.
- `2026-04-05` latest review: re-ran `bun run typecheck:server` and the active runtime/save/GraphQL regression slice, confirmed the checked-in design still matches the implemented transitional architecture, and split the remaining structural cleanup into the successor plan below because the original plan had exceeded the repository plan-size limit.

## Related Plans

- **Previous**: `impl-plans/manager-kind-simplification.md`
- **Next**: `impl-plans/workflow-role-unification-structural-cleanup.md`
- **Depends On**: `impl-plans/manager-kind-simplification.md`, `impl-plans/branch-and-loop-block-subworkflows.md`
