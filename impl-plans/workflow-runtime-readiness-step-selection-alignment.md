# Workflow Runtime Readiness Step Selection Alignment Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#overview, design-docs/specs/design-data-model.md#runtime-readiness-model
**Created**: 2026-04-29
**Last Updated**: 2026-04-29

## Summary

Continue the post-legacy-cleanup review by removing a remaining node-addressed
implementation detail from runtime-readiness selection. The public readiness
surface now reports `sourceStepIds`, but the internal probe filter still uses
`onlyNodeIds` naming even though the normalized scheduler, direct-step
execution, and reusable-node semantics are step-addressed.

## Scope

Included:

- design updates for step-scoped runtime-readiness filtering
- runtime-readiness probe selection and requirement aggregation cleanup
- direct-step call-site alignment
- regression coverage for shared node-registry reuse across multiple steps

Not included:

- persisted session field renames outside readiness probes
- GraphQL schema changes (the public readiness field already uses `sourceStepIds`)
- runtime variable compatibility payload redesign

## Modules

### 1. Design Alignment

#### `design-docs/specs/architecture.md`, `design-docs/specs/design-data-model.md`

**Status**: COMPLETED

**Checklist**:

- [x] Document that readiness filtering is scoped by executing step ids
- [x] Clarify why reusable node-registry entries require step-based selection

### 2. Runtime Readiness Selection

#### `src/workflow/runtime-readiness.ts`, `src/workflow/call-step-impl.ts`

**Status**: COMPLETED

```ts
interface RequirementProbeOptions extends LoadOptions {
  readonly onlyStepIds?: ReadonlySet<string>;
}
```

**Checklist**:

- [x] Remove the stale node-named readiness selection path
- [x] Keep requirement attribution and filtering aligned on step ids
- [x] Simplify direct-step readiness preflight to pass step ids only

### 3. Regression Coverage

#### `src/workflow/runtime-readiness.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Verify shared reusable nodes attribute backend requirements to all authored steps
- [x] Verify `onlyStepIds` filters readiness requirements to the requested step

## Dependencies

| Feature                     | Depends On                  | Status    |
| --------------------------- | --------------------------- | --------- |
| Design alignment            | review findings             | COMPLETED |
| Runtime readiness selection | design alignment            | COMPLETED |
| Regression coverage         | runtime readiness selection | COMPLETED |

## Completion Criteria

- [x] Runtime-readiness filtering uses step ids consistently
- [x] Shared node-registry reuse remains attributable per authored step
- [x] Targeted tests and typecheck pass

## Progress Log

### Session: 2026-04-29 17:36

**Tasks Completed**: Diff review follow-up, design and plan update, runtime-readiness step-selection refactor, shared-node regression coverage, targeted verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Review found the public readiness rename was only partially internalized. The code still filtered probes through `onlyNodeIds` naming even though the normalized runtime node list is step-addressed and reusable node-registry entries can back multiple steps. This pass removes that stale selection path and locks the intended semantics with a shared-node regression.
