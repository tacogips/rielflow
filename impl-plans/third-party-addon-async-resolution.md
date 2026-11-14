# Third-party Add-on Async Resolution Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#third-party-resolver-boundary`
**Created**: 2026-04-21
**Last Updated**: 2026-04-21

---

## Summary

Allow third-party add-on definitions to resolve payloads asynchronously while
preserving the existing synchronous validation API for callers that rely on it.

## Deliverables

### TASK-001: Async Type Surface

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/workflow/types.ts`, `src/lib.ts`

**Completion Criteria**:

- [x] Add-on definition resolvers may return a promise.
- [x] Async resolver type is exported from the package root.
- [x] Async registry helpers are exported from the package root.

### TASK-002: Async Resolution Runtime

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/node-addons.ts`, `src/workflow/validate.ts`

**Completion Criteria**:

- [x] Async registry helper awaits matching add-on definitions.
- [x] Async validation awaits add-on resolution.
- [x] Sync validation remains available and reports async-only resolver use as a validation issue.

### TASK-003: Async Load and API Integration

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/load.ts`, `src/workflow/save.ts`, `src/graphql/schema.ts`, `src/lib.ts`

**Completion Criteria**:

- [x] Disk workflow loading uses async validation.
- [x] Save and GraphQL validation paths use async validation.
- [x] Library execution wrappers forward async resolver options.

### TASK-004: Regression Coverage

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/validate.test.ts`, `src/workflow/load.test.ts`, `src/graphql/schema.test.ts`, `src/lib.test.ts`, `README.md`

**Completion Criteria**:

- [x] Validation covers async add-on definitions.
- [x] Disk loading covers async add-on definitions.
- [x] GraphQL validation covers async add-on definitions.
- [x] Library execution covers async add-on definitions.
- [x] README documents the async add-on surface.

## Progress Log

### Session: 2026-04-21 00:20 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added async-aware validation and registry helpers without removing
the existing synchronous validation and resolver APIs.
