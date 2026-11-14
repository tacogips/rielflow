# Workflow Authored Boundary Alignment Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#workflow-definition-boundary, design-docs/specs/design-workflow-json.md#top-level-fields, design-docs/specs/design-data-model.md#workflowjson
**Created**: 2026-04-29
**Last Updated**: 2026-04-29

## Summary

Close the remaining authored-schema drift after legacy cleanup by rejecting the lingering top-level `managerRuntimeId` alias in the same shared boundary helper as the other removed fields, aligning the current design docs with that contract, and reducing save-path duplication around normalized-to-authored workflow projection.

## Scope

Included:

- active design docs that describe the authored workflow boundary
- `src/workflow/authored-workflow.ts` rejected-field set updates
- `src/workflow/save.ts` refactor of duplicate normalized-to-authored mapping
- regression coverage in workflow load/save/validate/type/helper tests

Not included:

- runtime/session metadata naming cleanup outside authored `workflow.json`
- workflow execution behavior changes
- GraphQL surface redesign

## Modules

### 1. Design Alignment

#### `design-docs/specs/design-workflow-json.md`, `design-docs/specs/design-data-model.md`, `design-docs/specs/design-unified-workflow-role-model.md`

**Status**: COMPLETED

**Checklist**:

- [x] Align active design docs on the current authored rejection set
- [x] Clarify that the shared authored-workflow helper owns the removed-field contract

### 2. Shared Boundary and Save Refactor

#### `src/workflow/authored-workflow.ts`, `src/workflow/save.ts`

**Status**: COMPLETED

```ts
export const REJECTED_AUTHORED_DISALLOWED_TOP_LEVEL_FIELD_KEYS = [
  "managerRuntimeId",
  "managerNodeId",
  "entryNodeId",
  "subWorkflows",
] as const;
```

**Checklist**:

- [x] Reject top-level `managerRuntimeId` through the shared authored boundary helper
- [x] Reuse one normalized-to-authored projection helper in the save path
- [x] Preserve current persisted-output behavior

### 3. Regression Coverage

#### `src/workflow/authored-workflow.test.ts`, `src/workflow/load.test.ts`, `src/workflow/save.test.ts`, `src/workflow/types.test.ts`, `src/workflow/validate.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Add regression coverage for `managerRuntimeId` rejection
- [x] Keep helper and save-path tests focused on shared boundary behavior
- [x] Run targeted typecheck and workflow test slices

## Dependencies

| Feature                 | Depends On             | Status    |
| ----------------------- | ---------------------- | --------- |
| Design alignment        | review findings        | COMPLETED |
| Boundary/save refactor  | design alignment       | COMPLETED |
| Regression verification | boundary/save refactor | COMPLETED |

## Completion Criteria

- [x] Top-level `managerRuntimeId` is rejected by the shared authored boundary contract
- [x] Active design docs describe the same removed-field set as production
- [x] Save path no longer duplicates normalized-to-authored mapping logic
- [x] Targeted typecheck and workflow tests pass

## Progress Log

### Session: 2026-04-29 23:55

**Tasks Completed**: Post-cleanup diff review, design/architecture re-check, implementation plan creation, shared rejection-set fix, save-path projection dedup, regression updates, targeted verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Review found a real authored-boundary bug rather than only documentation drift: the active type contract and prior cleanup plans treated top-level `managerRuntimeId` as removed, but the shared runtime validator no longer rejected it after the rejection constants were centralized. This slice restores that rejection in the shared helper, aligns current design docs, and removes a remaining save-path duplication that became more obvious after the legacy branches were trimmed.
