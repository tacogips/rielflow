# Workflow ID Filesystem Safety Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-workflow-json.md#top-level-fields
**Created**: 2026-03-30
**Last Updated**: 2026-03-30

---

## Design Document Reference

**Source**: design-docs/specs/design-workflow-json.md

### Summary

Close the gap between the authored workflow schema and the runtime storage layout by making the `workflowId` contract explicitly filesystem-safe.

### Scope

**Included**: workflow-id validation, shared helper reuse, focused regression coverage, design/readme updates
**Excluded**: storage layout migration for already-invalid workflow ids, broader identifier redesign

---

## Modules

### 1. Workflow Identifier Validation

#### src/workflow/paths.ts

**Status**: COMPLETED

```typescript
declare function isSafeWorkflowId(workflowId: string): boolean;
declare function isSafeWorkflowName(workflowName: string): boolean;
```

**Checklist**:

- [x] Centralize the filesystem-safe workflow identifier rule
- [x] Keep workflow-name validation aligned with the same rule
- [x] Avoid duplicating regex logic across modules

#### src/workflow/validate.ts

**Status**: COMPLETED

```typescript
declare function validateWorkflowBundleDetailed(
  raw: RawBundle,
): Result<ValidationSuccessDetails, readonly ValidationIssue[]>;
```

**Checklist**:

- [x] Reject authored `workflow.workflowId` values that can escape runtime path namespaces
- [x] Return a specific validation issue on `workflow.workflowId`
- [x] Keep the existing authored surface otherwise unchanged

### 2. Regression Coverage and Documentation

#### src/workflow/validate.test.ts

**Status**: COMPLETED

```typescript
declare function makeValidRaw(): {
  workflow: unknown;
  workflowVis: unknown;
  nodePayloads: Record<string, unknown>;
};
```

**Checklist**:

- [x] Add a focused regression test for unsafe `workflowId`
- [x] Document the runtime/filesystem rationale in authored-schema docs

---

## Module Status

| Module                       | File Path                                                | Status    | Tests  |
| ---------------------------- | -------------------------------------------------------- | --------- | ------ |
| Workflow-id helper           | `src/workflow/paths.ts`                                  | COMPLETED | Passed |
| Authored workflow validation | `src/workflow/validate.ts`                               | COMPLETED | Passed |
| Regression coverage          | `src/workflow/validate.test.ts`                          | COMPLETED | Passed |
| Design/docs alignment        | `design-docs/specs/design-workflow-json.md`, `README.md` | COMPLETED | N/A    |

## Dependencies

| Feature                | Depends On                            | Status    |
| ---------------------- | ------------------------------------- | --------- |
| Workflow-id validation | Existing workflow validation pipeline | Available |
| Docs alignment         | Validation rule                       | Completed |

## Completion Criteria

- [x] Unsafe authored workflow ids are rejected before runtime execution
- [x] The workflow-id rule is centralized rather than duplicated
- [x] Focused tests pass
- [x] Design/docs describe why the restriction exists

## Progress Log

### Session: 2026-03-30 21:47

**Tasks Completed**: Review follow-up hardening for workflow-scoped artifact path resolution
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The review confirmed the design change itself was correct, but it also found duplicated namespace-path joining at runtime boundaries. The follow-up centralized workflow-scoped path resolution in `src/workflow/paths.ts`, reused it in workflow load/history deletion paths, removed a redundant workflow-id check, and added focused regression coverage for the helper.

### Session: 2026-03-30 21:35

**Tasks Completed**: Plan creation, workflow-id validation, regression coverage, design/readme updates
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Review of March 30 changes found a design/runtime mismatch: `workflowId` already acts as a storage namespace key in artifact and attachment paths, but validation still accepted arbitrary strings. The fix makes that filesystem contract explicit instead of relying on scattered path guards.

## Related Plans

- **Previous**: `impl-plans/tui-workflow-history-delete-all.md`
- **Next**: None
- **Depends On**: None
