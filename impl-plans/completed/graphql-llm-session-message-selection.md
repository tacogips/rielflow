# GraphQL LLM Session Message Selection

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#llm-session-message-inspection-boundary`
**Issue**: `tacogips/divedra#5`

## Purpose

Finish the GraphQL selection surface for persisted LLM session messages. The runtime already stores normalized LLM session message records; this plan covers the remaining public GraphQL contract for selecting those records from workflow and node execution views.

## Scope

- Add `llmMessages(order, limit)` field arguments to `WorkflowExecutionView`, `WorkflowExecutionOverviewView`, and `NodeExecutionView`.
- Expose `order` as a GraphQL enum with `ASC` and `DESC` only.
- Default `order` to `DESC` and `limit` to `1`, so no-argument `llmMessages` returns the latest one message.
- Allow independent limits and ordering for workflow-level and node-level selections in the same GraphQL query.
- Keep provider-specific transcript parsing out of scope; GraphQL exposes normalized runtime DB records only.

## Non-Goals

- Do not add raw transcript file reading through GraphQL.
- Do not change adapter persistence unless tests expose a regression in existing persisted message records.
- Do not expose free-form string ordering in the public GraphQL schema.

## Tasks

### TASK-001: Public GraphQL SDL Contract

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/server/graphql-executable-schema.ts`

**Completion Criteria**:

- [x] Define `enum LlmSessionMessageOrder { ASC DESC }`.
- [x] Add `llmMessages(order: LlmSessionMessageOrder = DESC, limit: Int = 1)` to `WorkflowExecutionView`.
- [x] Add `llmMessages(order: LlmSessionMessageOrder = DESC, limit: Int = 1)` to `WorkflowExecutionOverviewView`.
- [x] Add `llmMessages(order: LlmSessionMessageOrder = DESC, limit: Int = 1)` to `NodeExecutionView`.
- [x] Ensure invalid free-form order strings fail GraphQL validation.

### TASK-002: Selection Types And Resolver Defaults

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/graphql/types.ts`, `src/graphql/schema.ts`, `src/server/graphql-executable-schema.ts`

**Completion Criteria**:

- [x] Keep internal selection type bounded to `ASC` and `DESC`.
- [x] Normalize public `ASC` and `DESC` enum arguments before calling shared selection helpers.
- [x] Apply default selection at field resolution time, not before nested field resolvers can request different windows.
- [x] Preserve full persisted message arrays internally for parent execution views.
- [x] Apply node-level filtering for `NodeExecutionView.llmMessages`.

### TASK-003: Direct GraphQL Schema Tests

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/graphql/schema.test.ts`

**Completion Criteria**:

- [x] Cover default latest-one behavior.
- [x] Cover `DESC` ordering with configurable `limit`.
- [x] Cover `ASC` ordering with configurable `limit`.
- [x] Cover `limit: 0`.
- [x] Cover node execution filtering.

### TASK-004: Executable GraphQL Tests

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/server/graphql.test.ts`

**Completion Criteria**:

- [x] Cover SDL enum exposure for `LlmSessionMessageOrder`.
- [x] Cover field arguments on all three public view types.
- [x] Cover one query requesting different workflow-level and node-level `llmMessages` windows.
- [x] Cover invalid free-form string order rejection through GraphQL validation.

### TASK-005: Documentation And Progress

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `impl-plans/completed/graphql-llm-session-message-selection.md`, optional existing docs touched by implementation

**Completion Criteria**:

- [x] Update this progress log with implementation and verification results.
- [x] Move this plan to `impl-plans/completed/` when all tasks and verification pass.

## Verification

- `bun test src/graphql/schema.test.ts`
- `bun test src/server/graphql.test.ts`
- `bun run typecheck`
- `git diff --check`

## Risks

- Field-level arguments require the executable GraphQL layer to avoid pre-slicing messages too early.
- Direct TypeScript selection APIs may use lowercase internal order values while public GraphQL exposes uppercase enum values; tests must cover this normalization boundary.

## Progress Log

### Session: 2026-05-04 15:47 JST

**Tasks Completed**: Plan created to unblock `design-and-implement-review-loop` issue-resolution workflow after Step 5 repeatedly rejected the absence of an active implementation plan.

**Notes**: The workflow remains responsible for code implementation and review. This plan records the accepted issue #5 scope for GraphQL `llmMessages(order, limit)` selection behavior.

### Session: 2026-05-04 16:30 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.

**Notes**: Implemented issue #5 GraphQL field selection for persisted LLM
session messages on `WorkflowExecutionView`, `WorkflowExecutionOverviewView`,
and `NodeExecutionView`. Public HTTP GraphQL uses `LlmSessionMessageOrder`
enum values `ASC` and `DESC`; no-argument and explicit-null limit selections
return the default one-message window; executable schema root resolvers retain
full parent message arrays internally so sibling field selections can request
independent limits and orders. Verified with focused GraphQL tests, typecheck,
and diff whitespace checks.
