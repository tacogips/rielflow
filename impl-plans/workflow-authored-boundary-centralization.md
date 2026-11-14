# Workflow Authored Boundary Centralization Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#workflow-definition-boundary, design-docs/specs/design-workflow-json.md#top-level-fields
**Created**: 2026-04-29
**Last Updated**: 2026-04-29

## Summary

Centralize authored workflow schema-boundary rules into one workflow helper module so validation, save, and tests all consume the same removed-field lists, rejection messages, and normalized-only persistence stripping behavior.

## Scope

Included:

- design record for the authored workflow boundary module
- shared workflow helper module under `src/workflow/`
- `src/workflow/validate.ts` and `src/workflow/save.ts` migration to the shared helper
- regression coverage for the shared helper and updated import points

Not included:

- workflow schema redesign
- runtime execution behavior changes
- GraphQL or CLI surface changes beyond consuming the shared helper

## Modules

### 1. Design Alignment

#### `design-docs/specs/architecture.md`, `design-docs/specs/design-workflow-json.md`

**Status**: COMPLETED

**Checklist**:
- [x] Record that authored workflow guard rules belong to one shared boundary module
- [x] Clarify save-time stripping semantics for normalized-only fields

### 2. Shared Authored Workflow Helper

#### `src/workflow/authored-workflow.ts`

**Status**: COMPLETED

```ts
export function collectStepAddressedAuthoredWorkflowFieldIssues(
  workflow: unknown,
): readonly ValidationIssue[];

export function stripNormalizedWorkflowFieldsForPersistence(
  workflow: unknown,
): unknown;

export function isNormalizedStepAddressedWorkflow(
  value: unknown,
): value is WorkflowJson;
```

**Checklist**:
- [x] Centralize removed authored top-level key lists and rejection messages
- [x] Centralize normalized-only workflow field stripping for persistence
- [x] Preserve existing validation exports for compatibility

### 3. Consumer Refactor and Verification

#### `src/workflow/validate.ts`, `src/workflow/save.ts`, `src/workflow/*.test.ts`

**Status**: COMPLETED

**Checklist**:
- [x] Migrate validator step-addressed top-level field checks to the shared helper
- [x] Migrate save-time authored-boundary checks to the shared helper
- [x] Add focused regression tests for the shared helper
- [x] Run targeted typecheck and workflow test suites

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Shared helper extraction | design alignment | COMPLETED |
| Consumer refactor | shared helper extraction | COMPLETED |
| Verification | consumer refactor | COMPLETED |

## Completion Criteria

- [x] Design docs describe the authored workflow boundary as a shared module
- [x] Removed authored field lists/messages exist in one workflow helper module
- [x] Save and validate reuse the same authored-boundary helpers
- [x] Targeted typechecks and workflow tests pass
- [x] Full repository test suite passes

## Progress Log

### Session: 2026-04-29 21:35
**Tasks Completed**: Design assessment, implementation plan creation, shared helper extraction, save/validate consumer refactor, regression test additions
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Continuation review after the workflow legacy cleanup found a boundary mismatch rather than a runtime bug: authored-schema constants lived in `validate.ts` while `save.ts` carried its own schema scan and persistence stripping logic. This slice centralizes that authored-workflow boundary into one helper module and leaves runtime behavior unchanged.

### Session: 2026-04-29 21:52
**Tasks Completed**: Targeted typecheck, targeted workflow test suite, full repository Bun test suite, plan completion
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Verification passed with `bun run typecheck:server`, `bun test src/workflow/authored-workflow.test.ts src/workflow/load.test.ts src/workflow/save.test.ts src/workflow/types.test.ts src/workflow/validate.test.ts --runInBand`, and `scripts/run-bun-tests.sh` (`619` pass). Marked the authored-boundary centralization slice complete.
