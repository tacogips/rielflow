# Workflow Authored Rejection Matrix Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#workflow-definition-boundary, design-docs/specs/design-workflow-json.md#top-level-fields
**Created**: 2026-04-29
**Last Updated**: 2026-04-29

## Summary

Reduce test and boundary drift around removed authored workflow top-level fields by centralizing single-field validation issue construction in the authored workflow helper and reusing that contract in workflow validation/load/save regression tests.

## Scope

Included:

- design note that authored-boundary issue construction belongs to the shared helper
- shared issue-construction helper in `src/workflow/authored-workflow.ts`
- workflow regression tests switched from duplicated inline issue objects to the shared helper

Not included:

- changes to runtime workflow behavior
- expansion of the rejected authored field set
- GraphQL input schema changes

## Modules

### 1. Authored Boundary Helper

#### `src/workflow/authored-workflow.ts`

**Status**: COMPLETED

```ts
export type RejectedAuthoredStepAddressedTopLevelField =
  (typeof REJECTED_AUTHORED_STEP_ADDRESSED_DISALLOWED_TOP_LEVEL_KEYS)[number];

export function makeStepAddressedAuthoredWorkflowFieldIssue(
  fieldName: RejectedAuthoredStepAddressedTopLevelField,
): ValidationIssue;
```

**Checklist**:

- [x] Centralize canonical validation issue construction for removed authored top-level fields
- [x] Keep bulk collection logic layered on the single-field helper

### 2. Regression Matrix Consumers

#### `src/workflow/authored-workflow.test.ts`, `src/workflow/load.test.ts`, `src/workflow/save.test.ts`, `src/workflow/validate.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Add a matrix-style helper test covering every removed top-level authored field
- [x] Replace duplicated inline validation issue expectations with the shared helper where appropriate
- [x] Keep workflow surface tests focused on behavior instead of re-encoding issue strings

## Dependencies

| Feature                   | Depends On          | Status    |
| ------------------------- | ------------------- | --------- |
| Shared issue helper       | design alignment    | COMPLETED |
| Regression matrix cleanup | shared issue helper | COMPLETED |

## Completion Criteria

- [x] Single-field authored rejection issues are constructed in one helper
- [x] Validation/load/save workflow tests reuse the shared rejection issue contract
- [x] Targeted workflow checks pass after the refactor

## Progress Log

### Session: 2026-04-29 23:10

**Tasks Completed**: Follow-up review, design note update, shared issue helper extraction, regression matrix cleanup, targeted verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Post-cleanup architecture remained correct, but negative coverage still duplicated field paths and rejection strings in several workflow tests. This slice centralizes canonical issue construction in the authored-boundary helper so behavioral tests assert against one maintained contract instead of copying issue object literals.
