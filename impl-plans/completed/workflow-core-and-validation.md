# Workflow Core and Validation Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-data-model.md#overview, design-docs/specs/design-workflow-json.md#workflowjson, design-docs/specs/architecture.md#workflow-directory-contract
**Created**: 2026-02-23
**Last Updated**: 2026-02-23

---

## Design Document Reference

**Source**:
- `design-docs/specs/design-data-model.md`
- `design-docs/specs/design-workflow-json.md`
- `design-docs/specs/architecture.md`

### Summary
Implemented strict TypeScript domain models, JSON normalization, semantic validation, and filesystem loader utilities for workflow directories under `.divedra/<workflow-name>/`.

### Scope
**Included**:
- Canonical TypeScript models for workflow/node/vis/artifact metadata
- Read-compatible normalization for `prompt`/`variable` aliases
- Structural and semantic validators with actionable error paths
- Workflow root and artifact root resolution policy helpers
- Filesystem loader utilities to read workflow directory contract

**Excluded**:
- Execution engine traversal and runtime agent invocation
- HTTP server and browser editor APIs
- TUI runtime rendering

---

## Tasks

### TASK-001: Domain Types and Result Contracts
**Status**: Completed
**Parallelizable**: Yes
**Deliverables**:
- `src/workflow/types.ts`
- `src/workflow/result.ts`

**Completion Criteria**:
- [x] Canonical workflow/node/vis TypeScript types are defined
- [x] Runtime defaults and status union types are defined
- [x] Typed `Result<T, E>` contract is available for validation/loading

**Verification Criteria**:
- [x] `bun run typecheck` passes without `any`
- [x] No unused exports violate strict compiler rules

**Test Content**:
- [x] Compile-level usage coverage through downstream validator/loader tests

### TASK-002: Validation and Normalization
**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-001
**Deliverables**:
- `src/workflow/validate.ts`

**Completion Criteria**:
- [x] Validation covers required workflow files and required fields
- [x] Node id, node-file, manager node, edge, and loop semantic checks exist
- [x] Normalizer reads legacy aliases (`prompt` -> `promptTemplate`, `variable` -> `variables`) but emits canonical fields
- [x] Validation returns structured errors/warnings with JSON-path-like locations

**Verification Criteria**:
- [x] Invalid fixtures produce deterministic error lists
- [x] Valid fixtures normalize successfully

**Test Content**:
- [x] Unit tests for valid workflow
- [x] Unit tests for invalid node id / missing manager / bad nodeFile mapping
- [x] Unit tests for legacy alias normalization

### TASK-003: Root Resolution and Workflow Loader
**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-002
**Deliverables**:
- `src/workflow/paths.ts`
- `src/workflow/load.ts`

**Completion Criteria**:
- [x] Workflow root resolution priority implemented (`flag` > env > default)
- [x] Artifact root resolution priority implemented (`flag` > env > default)
- [x] Loader reads `workflow.json` and `node-{id}.json`
- [x] Loader validates loaded payloads and returns normalized definition

**Verification Criteria**:
- [x] Missing files return descriptive failures
- [x] Loaded workflow includes effective defaults and normalized node payloads

**Test Content**:
- [x] Unit tests for path resolution permutations
- [x] Unit tests for load success/failure over temp workflow directories

### TASK-004: Core Test Suite
**Status**: Completed
**Parallelizable**: Yes
**Dependencies**: TASK-002, TASK-003
**Deliverables**:
- `src/workflow/validate.test.ts`
- `src/workflow/load.test.ts`

**Completion Criteria**:
- [x] Validation and loader tests cover success and failure branches
- [x] All new tests run under Vitest and pass

**Verification Criteria**:
- [x] `bun run test` passes
- [x] `bun run typecheck` passes

**Test Content**:
- [x] Table-driven tests for semantic validation errors
- [x] Fixture-based tests for end-to-end load + normalize behavior

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Domain types | `src/workflow/types.ts` | COMPLETED | `validate.test.ts`, `load.test.ts` |
| Result model | `src/workflow/result.ts` | COMPLETED | `validate.test.ts`, `load.test.ts` |
| Validator | `src/workflow/validate.ts` | COMPLETED | `validate.test.ts` |
| Root/path resolver | `src/workflow/paths.ts` | COMPLETED | `load.test.ts` |
| Loader | `src/workflow/load.ts` | COMPLETED | `load.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| TASK-002 Validation | TASK-001 | SATISFIED |
| TASK-003 Loader | TASK-002 | SATISFIED |
| TASK-004 Tests | TASK-002, TASK-003 | SATISFIED |

## Completion Criteria

- [x] All tasks marked completed
- [x] `bun run typecheck` passes
- [x] `bun run test` passes
- [x] Canonical field emission confirmed in tests

## Progress Log

### Session: 2026-02-23 00:10
**Tasks Completed**: TASK-001, TASK-002
**Tasks In Progress**: TASK-003
**Blockers**: None
**Notes**: Implemented strict types/result and normalization/validation with semantic checks.

### Session: 2026-02-23 00:21
**Tasks Completed**: TASK-003, TASK-004
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Completed root resolution + loader and comprehensive core tests under Vitest.

## Related Plans

- **Previous**: N/A
- **Next**: `impl-plans/completed/workflow-cli-mvp.md`
- **Depends On**: N/A
