# Workflow Normalized Payload Lookup Centralization Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#execution-boundary, design-docs/specs/design-data-model.md#workflowjson
**Created**: 2026-04-29
**Last Updated**: 2026-04-29

## Summary

The current architecture remains correct: normalized workflow execution is step-addressed, and validated bundles expose one runtime node payload map. This slice improves maintainability by making the remaining runtime consumers reuse the shared normalized-payload lookup helper instead of carrying ad hoc bundle indexing or local fallback logic.

## Scope

Included:

- shared normalized payload lookup helper documentation and adoption
- runtime consumers in engine, direct step execution, readiness inspection, and semantic validation
- focused regression coverage for helper fallback behavior

Not included:

- workflow schema or authored-boundary changes
- runtime artifact format changes
- broader load/save raw payload resolution refactors

## Modules

### 1. Shared Lookup Adoption

#### `src/workflow/types.ts`, `src/workflow/engine.ts`, `src/workflow/call-step-impl.ts`, `src/workflow/runtime-readiness.ts`, `src/workflow/validate.ts`

**Status**: COMPLETED

```ts
export function getNormalizedNodePayload(
  bundle: Pick<NormalizedWorkflowBundle, "workflow" | "nodePayloads">,
  nodeId: string,
): NodePayload | undefined;
```

**Checklist**:

- [x] Clarify the shared helper contract for normalized bundle payload lookup
- [x] Replace duplicated runtime payload access with the shared helper
- [x] Preserve existing error handling and step-addressed behavior

### 2. Regression Coverage

#### `src/workflow/types.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Add direct helper coverage for node-file fallback lookup
- [x] Keep existing workflow-focused runtime tests green after the refactor

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Shared lookup adoption | review findings | COMPLETED |
| Regression coverage | shared lookup adoption | COMPLETED |

## Completion Criteria

- [x] Normalized workflow runtime consumers share one payload lookup path
- [x] Step-addressed runtime behavior remains unchanged
- [x] Targeted typecheck and workflow tests pass

## Progress Log

### Session: 2026-04-29 17:42

**Tasks Completed**: Continuation diff review, architecture re-check, focused implementation plan creation, shared lookup adoption, helper regression coverage, targeted verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The dirty branch was already functionally green, so the next useful iteration was maintainability rather than behavior change. Review found an existing normalized-bundle payload lookup helper in `src/workflow/types.ts`, but the remaining runtime consumers still used a mix of direct map access and local fallback logic. This pass consolidates those call sites so future step-vs-node cleanup only has one lookup contract to maintain.
