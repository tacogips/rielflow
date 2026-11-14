# Workflow Save Revision API Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-workflow-web-editor.md#api-contract-v1
**Created**: 2026-02-24
**Last Updated**: 2026-02-24

---

## Summary
Implemented `PUT /api/workflows/:name` with expected revision conflict protection and atomic file writes. Extended `GET /api/workflows/:name` to include current revision.

## Tasks

### TASK-001: Revision and Atomic Save Module
**Status**: Completed
**Parallelizable**: Yes
**Dependencies**: workflow-serve-mvp:TASK-004

**Completion Criteria**:
- [x] Workflow revision hash can be computed from on-disk file set
- [x] Atomic write helpers persist `workflow.json`, `workflow-vis.json`, and `node-*.json`
- [x] Save validates payload before writing

### TASK-002: API GET/PUT Integration
**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-001

**Completion Criteria**:
- [x] GET workflow includes `revision`
- [x] PUT workflow supports `expectedRevision` conflict check
- [x] PUT returns `409` on stale revision
- [x] Read-only mode blocks PUT with `403`

### TASK-003: Test Coverage
**Status**: Completed
**Parallelizable**: Yes
**Dependencies**: TASK-002

**Completion Criteria**:
- [x] API tests cover PUT success and stale revision conflict
- [x] API tests verify GET revision changes after PUT
- [x] Typecheck and test suite pass

## Completion Criteria

- [x] All tasks completed
- [x] `bun run typecheck` passes
- [x] `bun run test` passes
