# Workflow Cross-Dispatch Artifact Contract Alignment Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#workflow-definition-boundary, design-docs/specs/design-unified-workflow-role-model.md#workflow-invocation
**Created**: 2026-04-29
**Last Updated**: 2026-04-29

## Summary

Continue the post-legacy-cleanup review by removing a remaining naming leak from new cross-workflow dispatch artifacts. The active design already treats `workflow-calls/*.json` as caller/callee-named runtime metadata, but the engine still writes a redundant plain `workflowId` field that duplicates `calleeWorkflowId` and weakens the contract.

## Scope

Included:

- design text for the runtime-owned cross-workflow artifact contract
- `src/workflow/engine.ts` artifact serialization
- regression coverage for new `workflow-calls/*.json` payloads

Not included:

- compatibility readers for historical artifacts
- runtime variable field-name redesign under `runtimeVariables.workflowCall`
- GraphQL schema changes

## Modules

### 1. Artifact Contract Alignment

#### `design-docs/specs/architecture.md`, `design-docs/specs/design-unified-workflow-role-model.md`, `src/workflow/engine.ts`

**Status**: COMPLETED

```ts
async function persistCrossWorkflowDispatchArtifact(input: {
  readonly artifactDir: string;
  readonly callId: string;
  readonly callerStepId: string;
  readonly calleeWorkflowName: string;
  readonly calleeWorkflowId: string;
  readonly calleeSession: WorkflowSessionState;
  readonly callerNodeExecId: string;
  readonly resumeStepId?: string;
  readonly resultOutputRef?: OutputRef;
}): Promise<void>;
```

**Checklist**:

- [x] Keep new `workflow-calls/*.json` payloads on caller/callee field names only
- [x] Remove the redundant plain `workflowId` mirror from new artifact writes
- [x] Document `workflowId` as historical-only artifact residue

### 2. Regression Coverage

#### `src/workflow/engine.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Assert new dispatch artifacts do not write the plain `workflowId` mirror
- [x] Keep existing legacy-field absence checks intact

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Artifact contract alignment | review findings | COMPLETED |
| Regression coverage | artifact contract alignment | COMPLETED |

## Completion Criteria

- [x] New `workflow-calls/*.json` artifacts use caller/callee field names only
- [x] The local design record matches the serialized artifact contract
- [x] Targeted tests and typecheck pass

## Progress Log

### Session: 2026-04-29 17:24

**Tasks Completed**: Continuation review of the existing workflow cleanup diff, focused design/architecture re-check, implementation plan creation, artifact serialization cleanup, regression update
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Review found a smaller but real contract mismatch after the larger step-addressed cleanup slices had landed. `workflow-calls/*.json` is already documented as caller/callee-named runtime metadata, but the engine still wrote a plain `workflowId` field that simply duplicated `calleeWorkflowId`. This pass removed the redundant field, updated the active design wording, and extended the artifact regression to keep the contract tight.
