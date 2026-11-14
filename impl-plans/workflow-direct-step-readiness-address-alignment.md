# Workflow Direct Step Readiness Address Alignment Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#execution-boundary, design-docs/specs/command.md
**Created**: 2026-04-29
**Last Updated**: 2026-04-29

## Summary

Continue the post-legacy-cleanup review by fixing a direct-step readiness bug. The current architecture is still correct: `call-step` is a step-addressed execution entrypoint, and runtime readiness should validate the selected step's executable node plus any step-derived workflow features. The implementation drift is narrower: the readiness filter currently uses one `onlyNodeIds` selector for both node-backed requirements and step-derived cross-workflow dispatches, which skips backend/container validation when a step id differs from its node registry id.

## Scope

Included:

- direct-step readiness filtering in `src/workflow/runtime-readiness.ts`
- `call-step` integration with the readiness filter contract
- regression coverage for distinct step id vs node registry id bundles

Not included:

- runtime readiness response field renames
- GraphQL or CLI surface redesign
- broader workflow execution behavior changes

## Modules

### 1. Readiness Filter Contract

#### `src/workflow/runtime-readiness.ts`, `src/workflow/call-step-impl.ts`

**Status**: COMPLETED

```ts
interface RequirementProbeOptions extends LoadOptions {
  readonly onlyNodeIds?: ReadonlySet<string>;
  readonly onlyStepIds?: ReadonlySet<string>;
}
```

**Checklist**:

- [x] Separate node-backed readiness filtering from step-derived dispatch filtering
- [x] Keep direct `call-step` readiness scoped to the selected step and its resolved node
- [x] Preserve existing full-workflow readiness behavior

### 2. Regression Coverage

#### `src/workflow/call-step-impl.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Add a direct-step regression where `stepId !== nodeId`
- [x] Prove readiness still blocks missing container/back-end prerequisites for that step
- [x] Re-run targeted tests and typecheck

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Readiness filter contract | review findings | COMPLETED |
| Regression coverage | readiness filter contract | COMPLETED |

## Completion Criteria

- [x] Direct `call-step` readiness validates the resolved node even when step ids differ from node registry ids
- [x] Step-derived cross-workflow readiness remains filtered by step id
- [x] Targeted tests and typecheck pass

## Progress Log

### Session: 2026-04-29 01:35

**Tasks Completed**: Continuation diff review, architecture/design re-check, focused implementation plan creation
**Tasks In Progress**: TASK-001 readiness filter contract
**Blockers**: None
**Notes**: The high-level design still matches the intended step-addressed architecture, so no design rewrite was needed. The concrete follow-up bug is an implementation mismatch inside runtime readiness selection, not a schema or workflow-model problem.

### Session: 2026-04-29 01:48

**Tasks Completed**: TASK-001 readiness filter contract, TASK-002 regression coverage, targeted verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Split readiness selection into explicit step-id and node-id filters, updated direct `call-step` execution to pass both resolved addresses, and added a regression proving missing container runner prerequisites are still caught when the executing step id differs from the node registry id.
