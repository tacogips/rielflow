# Workflow Cross-Dispatch Runtime Variable Address Alignment Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-unified-workflow-role-model.md#workflow-invocation, design-docs/specs/architecture.md#execution-boundary
**Created**: 2026-04-29
**Last Updated**: 2026-04-29

## Summary

The architecture still matches the intended step-addressed design. The remaining mismatch is narrower and runtime-visible: cross-workflow callee runs should receive `runtimeVariables.workflowCall.callerNodeId` as the caller's node-registry id and `workflowCall.callerStepId` as the authored step id, but the engine currently forwards the runtime step id into both slots when those ids differ.

## Scope

Included:

- cross-workflow runtime-variable metadata assembly in `src/workflow/engine.ts`
- stricter runtime step-address lookup for execution paths that require authored step metadata
- regression coverage for cross-workflow calls where step ids differ from node-registry ids

Not included:

- artifact format redesign beyond the existing caller/callee metadata contract
- GraphQL schema changes
- broader session-record field renames

## Modules

### 1. Runtime Metadata Alignment

#### `src/workflow/engine.ts`, `src/workflow/runtime-addressing.ts`, `src/workflow/call-step-impl.ts`

**Status**: COMPLETED

```ts
export function resolveRequiredStepExecutionAddress(
  workflow: WorkflowJson,
  runtimeNodeId: string,
): ResolvedStepExecutionAddress | undefined;
```

**Checklist**:

- [x] Require authored step metadata in runtime paths that derive cross-workflow caller addresses
- [x] Preserve `workflowCall.callerNodeId` as the node-registry id
- [x] Keep `workflowCall.callerStepId` as the authored step id

### 2. Regression Coverage

#### `src/workflow/runtime-addressing.test.ts`, `src/workflow/engine.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Cover the required step-address helper directly
- [x] Add a cross-workflow regression where caller step id and node-registry id differ
- [x] Verify callee runtime variables preserve both identities distinctly

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Runtime metadata alignment | review findings | COMPLETED |
| Regression coverage | runtime metadata alignment | COMPLETED |

## Completion Criteria

- [x] Cross-workflow callee runtime variables keep caller step id and node-registry id distinct
- [x] Execution paths that require authored step metadata no longer rely on optional lookup results
- [x] Targeted tests and typecheck pass

## Progress Log

### Session: 2026-04-29 17:52 JST

**Tasks Completed**: Follow-up review of the legacy-cleanup diff, focused plan creation, cross-workflow runtime-variable fix, step-address invariant tightening, regression additions, targeted verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Review found a concrete bug that the earlier naming cleanup did not cover. The design already distinguishes the caller step id from the caller node-registry id inside `runtimeVariables.workflowCall`, but the engine still forwarded the runtime step id into the historical `callerNodeId` slot. This slice restores the intended split and tightens the execution helper used to derive those addresses.
