# Workflow Runtime Readiness Step Surface Alignment Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#overview, design-docs/specs/design-data-model.md#runtime-readiness-model
**Created**: 2026-04-29
**Last Updated**: 2026-04-29

## Summary

Continue the post-legacy-cleanup review by removing a remaining node-named public field from workflow inspection. The runtime-readiness implementation already reports step-addressed execution ids, but the exported TypeScript and GraphQL contract still calls that field `sourceNodeIds`, which conflicts with the architecture rule that new public surfaces should prefer step-addressed names.

## Scope

Included:

- runtime-readiness TypeScript contract and detail wording
- executable GraphQL SDL for workflow inspection
- regression coverage for the renamed readiness source field
- focused design and implementation-plan updates

Not included:

- persisted session field renames such as `currentNodeId`
- workflow execution behavior changes
- runtime variable compatibility payload redesign

## Modules

### 1. Readiness Contract Alignment

#### `src/workflow/runtime-readiness.ts`, `src/server/graphql-executable-schema.ts`

**Status**: COMPLETED

```ts
export interface WorkflowRuntimeRequirement {
  readonly id: string;
  readonly kind:
    | "agent-backend"
    | "container-runner"
    | "environment-variable"
    | "node-executor"
    | "workflow-feature";
  readonly label: string;
  readonly status: WorkflowRuntimeRequirementStatus;
  readonly detail: string;
  readonly sourceStepIds: readonly string[];
}
```

**Checklist**:

- [x] Replace the node-named readiness source field with a step-addressed contract
- [x] Keep readiness detail text aligned with step-addressed execution ids
- [x] Expose the renamed field through the executable GraphQL schema

### 2. Regression Coverage

#### `src/workflow/runtime-readiness.test.ts`, `src/graphql/schema.test.ts`, `src/server/graphql.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Update readiness expectations to assert `sourceStepIds`
- [x] Verify library inspection surfaces expose the renamed field
- [x] Verify `/graphql` accepts and returns `sourceStepIds`

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Readiness contract alignment | review findings | COMPLETED |
| Regression coverage | readiness contract alignment | COMPLETED |

## Completion Criteria

- [x] Runtime readiness no longer exposes a node-named source field on current public surfaces
- [x] Design docs describe readiness sources as step-addressed execution ids
- [x] Targeted tests and typecheck pass

## Progress Log

### Session: 2026-04-29 17:29
**Tasks Completed**: Continuation review of the workflow cleanup diff, architecture/data-model re-check, focused plan creation, runtime-readiness contract rename, GraphQL SDL alignment, regression updates, targeted verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Review found a smaller but real public-surface mismatch after the larger step-addressed cleanup slices landed. `inspectWorkflowRuntimeReadiness` already reports step execution ids, but the exported field name still claimed they were node ids. This pass renames that surface to `sourceStepIds`, updates the GraphQL contract, and records the step-addressed inspection rule in the active design docs.
