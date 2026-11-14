# Workflow Cross-Dispatch Step Addressing Alignment Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#overview, design-docs/specs/design-unified-workflow-role-model.md#workflow-invocation, design-docs/specs/design-workflow-json.md#workflowstepref
**Created**: 2026-04-29
**Last Updated**: 2026-04-29

## Summary

Continue the post-legacy-cleanup review by removing the remaining node-addressed naming drift from derived cross-workflow dispatch metadata. The authored model is step-addressed, but `CrossWorkflowDispatch` and new `workflow-calls/*.json` artifacts still expose `callerNodeId` / `resultNodeId` names even though dispatch routing is keyed by caller step and resume step.

## Scope

Included:

- design docs that describe derived cross-workflow dispatch rows
- derived cross-workflow dispatch runtime types and helpers
- readiness and execution paths that consume those dispatch rows
- regression coverage for workflows where step ids differ from node registry ids

Not included:

- runtime variable compatibility keys under `runtimeVariables.workflowCall`
- persisted communication artifact field-name redesign outside cross-workflow dispatch metadata
- GraphQL schema expansion beyond existing dispatch id exposure

## Modules

### 1. Design Alignment

#### `design-docs/specs/architecture.md`, `design-docs/specs/design-unified-workflow-role-model.md`, `design-docs/specs/design-workflow-json.md`

**Status**: COMPLETED

**Checklist**:

- [x] Document that derived cross-workflow dispatch rows are step-addressed
- [x] Clarify that new `workflow-calls/*.json` metadata writes `callerStepId` / `resumeStepId`
- [x] Keep historical compatibility notes limited to explicitly scoped runtime-variable fields

### 2. Runtime Dispatch Surface

#### `src/workflow/cross-workflow-from-steps.ts`, `src/workflow/engine.ts`, `src/workflow/runtime-readiness.ts`

**Status**: COMPLETED

```ts
interface CrossWorkflowDispatch {
  readonly id: string;
  readonly workflowId: string;
  readonly callerStepId: string;
  readonly resumeStepId: string;
  readonly when?: string;
}
```

**Checklist**:

- [x] Make derived dispatch metadata step-addressed instead of node-addressed
- [x] Use caller step ids for readiness/source attribution
- [x] Persist new cross-workflow dispatch artifacts with step-addressed field names

### 3. Regression Coverage

#### `src/workflow/cross-workflow-from-steps.test.ts`, `src/workflow/validate.test.ts`, `src/workflow/runtime-readiness.test.ts`, `src/workflow/engine.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Update derived-dispatch expectations to use `callerStepId` / `resumeStepId`
- [x] Add a readiness regression where caller step id and node registry id differ
- [x] Verify artifact metadata no longer writes the stale node-addressed keys

## Dependencies

| Feature                  | Depends On               | Status    |
| ------------------------ | ------------------------ | --------- |
| Design alignment         | review findings          | COMPLETED |
| Runtime dispatch surface | design alignment         | COMPLETED |
| Regression coverage      | runtime dispatch surface | COMPLETED |

## Completion Criteria

- [x] Derived cross-workflow dispatch rows are step-addressed in code and design
- [x] Readiness/reporting attributes dispatches to caller step ids when step and node ids differ
- [x] New `workflow-calls/*.json` artifacts use `callerStepId` / `resumeStepId`
- [x] Targeted tests and typecheck pass

## Progress Log

### Session: 2026-04-29 17:08

**Tasks Completed**: Follow-up review of the legacy-cleanup diff, architecture/design re-check, implementation plan creation
**Tasks In Progress**: TASK-001 design and runtime dispatch alignment
**Blockers**: None
**Notes**: Review found a remaining architectural mismatch: derived cross-workflow dispatches are authored from `steps[].transitions`, but the runtime type and artifact field names still preserve node-addressed names. `resultNodeId` is especially misleading because it already stores `resumeStepId`.

### Session: 2026-04-29 17:18

**Tasks Completed**: TASK-001 design alignment, TASK-002 runtime dispatch surface, TASK-003 regression coverage, targeted verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Updated `CrossWorkflowDispatch` to use required caller/resume step ids, switched readiness attribution to caller step ids, persisted step-addressed cross-workflow artifact fields, and added regressions for bundles where the caller step id differs from the node registry id.
