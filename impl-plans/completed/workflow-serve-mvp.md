# Workflow Serve MVP Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-workflow-web-editor.md#api-contract-v1, design-docs/specs/architecture.md#httpapi-runtime-model-serve-mode, design-docs/specs/command.md#subcommands
**Created**: 2026-02-23
**Last Updated**: 2026-02-23

---

## Design Document Reference

**Source**:
- `design-docs/specs/design-workflow-web-editor.md`
- `design-docs/specs/architecture.md`
- `design-docs/specs/command.md`

### Summary
Implemented local HTTP serve MVP with workflow/session APIs and CLI `serve` command integration.

### Scope
**Included**:
- `divedra serve [workflow-name]`
- Workflow APIs: list/get/validate
- Execution APIs: execute/status/cancel
- Local bind defaults and read-only/no-exec safeguards

**Excluded**:
- Browser UI assets and SVG editor frontend
- Revision-conflict save APIs (PUT update deferred)

---

## Tasks

### TASK-001: HTTP API Router and Handler Layer
**Status**: Completed
**Parallelizable**: Yes
**Dependencies**: workflow-execution-and-session:TASK-005
**Deliverables**:
- `src/server/api.ts`

**Completion Criteria**:
- [x] Route matching for workflow/session endpoints implemented
- [x] JSON response helpers and error mapping implemented
- [x] Path traversal protections for workflow/session route params

**Verification Criteria**:
- [x] Handler returns deterministic status codes and payloads

**Test Content**:
- [x] Unit tests for route behavior and error responses

### TASK-002: Serve Runtime Bootstrap
**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-001
**Deliverables**:
- `src/server/serve.ts`

**Completion Criteria**:
- [x] Bun server bootstrap with host/port defaults
- [x] Read-only and no-exec policy enforcement
- [x] Graceful API response for root path

**Verification Criteria**:
- [x] Server starts/stops and handles API requests through shared handler

**Test Content**:
- [x] Unit tests around handler path execution (via API handler suite)

### TASK-003: CLI Serve Command Integration
**Status**: Completed
**Parallelizable**: No
**Dependencies**: TASK-002
**Deliverables**:
- `src/cli.ts`

**Completion Criteria**:
- [x] `serve [workflow-name]` command wired with `--host`, `--port`, `--read-only`, `--no-exec`
- [x] Startup failures map to exit code `7`
- [x] CLI text/json startup output provided

**Verification Criteria**:
- [x] Invalid port/host inputs handled gracefully

**Test Content**:
- [x] CLI tests for serve command bootstrap and mode flags

### TASK-004: API/Serve Test Coverage
**Status**: Completed
**Parallelizable**: Yes
**Dependencies**: TASK-003
**Deliverables**:
- `src/server/api.test.ts`

**Completion Criteria**:
- [x] Coverage for workflows list/get/validate
- [x] Coverage for execute/status/cancel
- [x] Typecheck and full test suite pass

**Verification Criteria**:
- [x] `bun run typecheck` passes
- [x] `bun run test` passes

**Test Content**:
- [x] Fixture-based route tests for success/error cases

---

## Completion Criteria

- [x] All tasks marked completed
- [x] `bun run typecheck` passes
- [x] `bun run test` passes
