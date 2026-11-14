# Workflow Authored Type Boundary Alignment Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#workflow-definition-boundary, design-docs/specs/design-workflow-json.md#workflownoderef, design-docs/specs/design-data-model.md#workflowjson
**Created**: 2026-04-29
**Last Updated**: 2026-04-29

## Summary

Continue the post-legacy-cleanup review by aligning the exported authored TypeScript contract with the strict step-addressed node-registry schema that the active design and runtime validator already enforce.

## Scope

Included:

- authored workflow type definitions in `src/workflow/types.ts`
- compile-time and runtime regression coverage for unsupported authored node-registry fields
- implementation plan and progress tracking for this cleanup slice

Not included:

- workflow execution behavior changes
- loader/save-path file-format redesign
- legacy runtime database migration work

## Modules

### 1. Authored Type Contract

#### `src/workflow/types.ts`

**Status**: COMPLETED

```ts
export interface AuthoredWorkflowNodeRef extends WorkflowNodeRegistryRef {}
```

**Checklist**:

- [x] Remove stale authored node-only fields from the exported step-addressed contract
- [x] Keep the authored node registry type name available where useful without widening the schema
- [x] Update comments so the public type surface matches the strict registry model

### 2. Regression Coverage

#### `src/workflow/types.test.ts`, `src/workflow/validate.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Add compile-time coverage for unsupported authored node-registry fields
- [x] Add runtime validation coverage for unsupported step-addressed node-registry fields
- [x] Run targeted verification after the type change

## Dependencies

| Feature                | Depends On             | Status    |
| ---------------------- | ---------------------- | --------- |
| Authored type contract | review findings        | COMPLETED |
| Regression coverage    | authored type contract | COMPLETED |

## Completion Criteria

- [x] `AuthoredWorkflowJson.nodes[]` matches the active step-addressed node-registry schema
- [x] Unsupported node-registry fields fail both compile-time and runtime regression checks
- [x] Targeted workflow tests and typecheck pass

## Progress Log

### Session: 2026-04-29 17:01

**Tasks Completed**: Follow-up review of the legacy-cleanup diff, architecture/design re-check, plan creation
**Tasks In Progress**: TASK-001 authored type contract alignment
**Blockers**: None
**Notes**: The active design and validator already agree that `workflow.json.nodes[]` is a strict registry surface, but `src/workflow/types.ts` still exports a wider authored node shape with unsupported fields such as `node`, `role`, `control`, `completion`, and `group`. This is now the highest-signal maintainability mismatch left in the authored boundary.

### Session: 2026-04-29 17:03

**Tasks Completed**: TASK-001 authored type contract alignment, TASK-002 regression coverage, targeted verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Tightened `AuthoredWorkflowNodeRef` to the strict registry shape already enforced by validation and design, added compile-time regression coverage in `src/workflow/types.test.ts`, added runtime rejection coverage in `src/workflow/validate.test.ts`, and verified with `bun test src/workflow/types.test.ts src/workflow/authored-workflow.test.ts src/workflow/validate.test.ts src/workflow/save.test.ts src/workflow/load.test.ts`, `bun run typecheck`, and `git diff --check`.
