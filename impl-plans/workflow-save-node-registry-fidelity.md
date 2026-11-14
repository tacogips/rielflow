# Workflow Save Node Registry Fidelity Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-workflow-json.md#workflowjson, design-docs/specs/design-workflow-json.md#workflownoderef, design-docs/specs/architecture.md#workflow-definition-boundary
**Created**: 2026-04-29
**Last Updated**: 2026-04-29

## Summary

Continue the post-legacy-cleanup workflow review by fixing a save-path fidelity bug: normalized step-addressed workflows currently re-project `workflow.json.nodes[]` without preserving authored registry semantics such as `kind` and `repeat`. This slice restores round-trip fidelity and narrows the risk of future projection drift.

## Scope

Included:

- save-path projection for normalized step-addressed workflow bundles
- regression coverage for node-registry round-trip fidelity
- targeted verification of workflow save/load behavior

Not included:

- workflow schema redesign
- runtime execution behavior changes
- node payload schema changes

## Modules

### 1. Save Projection Refactor

#### `src/workflow/save.ts`

**Status**: COMPLETED

```ts
function projectAuthoredWorkflowRegistryNode(
  node: WorkflowNodeRegistryRef,
): WorkflowNodeRegistryRef;
```

**Checklist**:

- [x] Confirm whether the current save projection drops authored registry fields
- [x] Preserve authored `workflow.json.nodes[]` semantics when projecting normalized workflows
- [x] Reduce the chance of future drift in the registry projection helper

### 2. Regression Coverage

#### `src/workflow/save.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Add a round-trip save regression covering node-registry `kind`
- [x] Add a round-trip save regression covering node-registry `repeat`
- [x] Keep existing removed-field rejection coverage intact

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Save projection refactor | review findings | COMPLETED |
| Regression coverage | save projection refactor | COMPLETED |

## Completion Criteria

- [x] Saving a normalized workflow preserves authored node-registry `kind`
- [x] Saving a normalized workflow preserves authored node-registry `repeat`
- [x] Targeted typecheck and workflow save/load tests pass

## Progress Log

### Session: 2026-04-29 23:59
**Tasks Completed**: Post-cleanup review of the existing diff and save/load architecture assessment
**Tasks In Progress**: TASK-001 save projection refactor
**Blockers**: None
**Notes**: Review found a concrete continuation bug in the same authored-boundary area: `save.ts` projects normalized step-addressed workflows back to authored `workflow.json`, but its `nodes[]` mapper only persists `id`, `nodeFile`/`addon`, and `execution`. That silently drops authored registry semantics (`kind`, `repeat`) that the active design still treats as part of the canonical step-addressed schema.

### Session: 2026-04-30 00:57
**Tasks Completed**: TASK-001 save projection refactor, TASK-002 regression coverage, targeted verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Updated the normalized-to-authored node-registry projection to reuse the authored registry shape directly instead of re-listing a partial field set. Added a disk-backed save regression that round-trips a valid step-addressed loop bundle and proves `workflow.json.nodes[].kind` and `workflow.json.nodes[].repeat` survive load-and-save. Verification passed with `bun test src/workflow/save.test.ts src/workflow/load.test.ts src/workflow/validate.test.ts`, `bun run typecheck`, and `git diff --check`.
