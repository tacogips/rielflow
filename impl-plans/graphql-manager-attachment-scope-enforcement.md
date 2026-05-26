# GraphQL Manager Attachment Scope Enforcement Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md#file-and-image-reference-contract
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Previous**: `impl-plans/graphql-manager-control-plane-surface.md`
- **Previous**: `impl-plans/graphql-manager-communication-scope-enforcement.md`
- **Current Plan**: `impl-plans/graphql-manager-attachment-scope-enforcement.md`

## Design Document Reference

**Source**:

- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/command.md`
- `design-docs/specs/notes.md`

### Summary

Review of the current dirty GraphQL manager-control implementation found one remaining attachment-scope gap:

- manager message attachments were validated only as data-root-relative paths under `RIEL_ROOT_DATA_DIR`,
- that allowed a manager-scoped mutation to reference unrelated files elsewhere under the root data directory,
- the intended manager-session boundary is narrower: attachments must stay inside the current execution's `files/{workflowId}/{workflowExecutionId}/...` namespace.

### Scope

**Included**:

- design clarification for execution-scoped manager attachments
- execution-prefix validation in the manager-message service
- regression coverage for direct service and HTTP GraphQL behavior

**Excluded**:

- new GraphQL schema fields
- upload mutations or attachment creation flows
- broader query-side authorization changes

## Modules

### 1. Execution-Scoped Attachment Validation

#### `src/workflow/manager-message-service.ts`

**Status**: COMPLETED

```typescript
export interface SendManagerMessageInput {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerSessionId: string;
  readonly attachments?: readonly DataDirFileRef[];
}
```

**Checklist**:

- [x] attachments remain root-data-relative and path-safe
- [x] attachments must also start with `files/{workflowId}/{workflowExecutionId}/`
- [x] validation still checks that the referenced file exists

### 2. Regression Coverage

#### `src/workflow/manager-message-service.test.ts`, `src/server/graphql.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] direct service calls reject attachments outside the current execution namespace
- [x] `/graphql` returns a mutation error for the same out-of-scope attachment
- [x] existing in-scope attachment behavior remains covered

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Attachment validation | `src/workflow/manager-message-service.ts` | COMPLETED | Passing |
| Regression coverage | `src/workflow/manager-message-service.test.ts`, `src/server/graphql.test.ts` | COMPLETED | Passing |
| Design alignment | `design-docs/specs/design-graphql-manager-control-plane.md`, `design-docs/specs/command.md`, `design-docs/specs/notes.md` | COMPLETED | Passing |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Execution-scoped attachment validation | `graphql-manager-control-plane-surface` | READY |
| HTTP regression coverage | Execution-scoped attachment validation | READY |

## Tasks

### TASK-001: Enforce Execution-Scoped Attachment Prefix

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `graphql-manager-control-plane-surface:TASK-001`

**Deliverables**:

- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/command.md`
- `design-docs/specs/notes.md`
- `src/workflow/manager-message-service.ts`
- `src/workflow/manager-message-service.test.ts`
- `src/server/graphql.test.ts`

**Completion Criteria**:

- [x] out-of-scope manager attachments are rejected before message persistence
- [x] the required attachment namespace is documented
- [x] targeted typecheck/tests pass

## Completion Criteria

- [x] Manager attachments can no longer reference unrelated files elsewhere under `RIEL_ROOT_DATA_DIR`
- [x] The design and command docs describe the narrower execution-scoped attachment contract
- [x] Targeted verification passes

## Progress Log

### Session: 2026-03-15 18:55 JST
**Tasks Completed**: TASK-001
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The broader GraphQL manager control-plane architecture remained correct. The corrective work was to tighten attachment validation to the authenticated workflow execution namespace so manager messages cannot read arbitrary root-data files.
