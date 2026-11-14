# Fixed Workflow Execution Client Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/command.md#graphql-canonicalization, design-docs/specs/design-graphql-manager-control-plane.md#canonical-api-direction
**Created**: 2026-03-30
**Last Updated**: 2026-03-30

---

## Design Document Reference

**Source**:
- `design-docs/specs/command.md`
- `design-docs/specs/design-graphql-manager-control-plane.md`

### Summary
Add a TypeScript execution client library API that binds to a single workflow at
construction time and exposes option-based execution without requiring callers
to compose raw GraphQL documents.

### Scope
**Included**: fixed-workflow client creation, local or endpoint-backed
execution, input-to-runtimeVariables mapping, and regression coverage.
**Excluded**: new server routes, workflow-id lookup APIs, and multi-workflow
client authorization.

---

## Modules

### 1. Fixed Workflow Library Client

#### src/lib.ts

**Status**: COMPLETED

**Checklist**:
- [x] Add a bound workflow execution client interface
- [x] Support local execution through the existing library/runtime path
- [x] Support endpoint-backed execution through the existing GraphQL client
- [x] Keep request shape option-based instead of raw GraphQL document based

#### src/lib.test.ts

**Status**: COMPLETED

**Checklist**:
- [x] Cover local fixed-workflow execution
- [x] Cover endpoint-backed fixed-workflow execution
- [x] Cover invalid mixed `input` and `runtimeVariables` usage

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Fixed workflow client API | `src/lib.ts` | COMPLETED | Passing |
| Library regression tests | `src/lib.test.ts` | COMPLETED | Passing |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Fixed workflow client execution | Existing library execution helpers and GraphQL client | Available |

## Completion Criteria

- [x] Library users can create a client bound to one workflow
- [x] Callers can execute with options and input without raw GraphQL documents
- [x] Endpoint-backed execution still reuses the existing GraphQL transport internally
- [x] Focused tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-03-30
**Tasks Completed**: Planned and implemented the fixed-workflow library client slice
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The API is intentionally narrow: workflow selection happens once at
client creation, and per-call execution accepts only runtime input and execution
options. This keeps the surface aligned with the user's request without adding a
broader workflow authorization system.

## Related Plans

- **Previous**: `impl-plans/graphql-cli-execution-transport.md`
- **Next**: (continue in this plan if workflow-id lookup becomes necessary)
- **Depends On**: `impl-plans/graphql-cli-execution-transport.md`
