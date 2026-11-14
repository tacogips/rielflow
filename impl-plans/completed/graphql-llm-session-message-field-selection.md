# GraphQL LLM Session Message Field Selection Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#llm-session-message-inspection-boundary`
**Created**: 2026-05-04
**Last Updated**: 2026-05-04

---

## Design Document Reference

**Source**: `design-docs/specs/architecture.md#llm-session-message-inspection-boundary`

### Summary

Finish GitHub issue `tacogips/divedra#5` by completing the GraphQL
`llmMessages` field selection surface for persisted LLM session messages.
Persisted adapter/runtime message capture already exists locally; this plan
targets the remaining public GraphQL selection gap.

### Scope

**Included**: field-level `llmMessages(limit:, order:)` arguments on
`WorkflowExecutionView`, `WorkflowExecutionOverviewView`, and
`NodeExecutionView`; public GraphQL enum `LlmSessionMessageOrder` with `ASC`
and `DESC`; default latest one message; per-field selection independence; HTTP
GraphQL regression coverage.

**Excluded**: new adapter transcript capture, runtime DB schema changes,
arbitrary transcript-file reads, CLI formatting changes, and official SDK
message capture expansion.

---

## Codex-Agent Reference Mapping

Codex-reference behavior is accepted as diagnostic guidance only:

- `<reference-repository-root>/src/rollout/reader.ts`: separates
  displayable session messages from process/runtime events.
- `<reference-repository-root>/src/session/search.ts`: uses bounded
  message retrieval windows.

Divedra intentionally diverges by serving provider-neutral runtime DB records
through GraphQL field resolvers instead of reading Codex rollout files directly.

---

## Modules

### 1. GraphQL Selection Types

#### `src/graphql/types.ts`

**Status**: COMPLETED

```typescript
type LlmSessionMessageOrder = "ASC" | "DESC";

interface LlmSessionMessagesSelectionInput {
  readonly order?: LlmSessionMessageOrder | null;
  readonly limit?: number | null;
}
```

**Checklist**:

- [x] Align public selection input with enum values `ASC` and `DESC`.
- [x] Keep default behavior centralized as `limit = 1` and `order = DESC`.
- [x] Preserve internal resolver type safety under strict TypeScript settings.

### 2. In-Memory Resolver Selection

#### `src/graphql/schema.ts`

**Status**: COMPLETED

```typescript
interface GraphqlLlmSessionMessagesArgs {
  readonly order?: LlmSessionMessageOrder | null;
  readonly limit?: number | null;
}
```

**Checklist**:

- [x] Normalize absent arguments to latest one message in descending order.
- [x] Accept only enum-backed `ASC` and `DESC` values at the resolver boundary.
- [x] Apply sorting and limiting at field selection time so workflow-level and
      node-level `llmMessages` selections can request different windows in the
      same query.
- [x] Preserve node filtering by `nodeExecId` before applying node field
      selection arguments.

### 3. Executable GraphQL Schema Surface

#### `src/server/graphql-executable-schema.ts`

**Status**: COMPLETED

```graphql
enum LlmSessionMessageOrder {
  ASC
  DESC
}

type WorkflowExecutionView {
  llmMessages(limit: Int, order: LlmSessionMessageOrder = DESC): [RuntimeLlmSessionMessageRecord!]!
}
```

**Checklist**:

- [x] Add the enum to the public SDL.
- [x] Add `limit` and enum `order` arguments to `llmMessages` on
      `WorkflowExecutionView`.
- [x] Add the same arguments to `WorkflowExecutionOverviewView.llmMessages`.
- [x] Add the same arguments to `NodeExecutionView.llmMessages`.
- [x] Wire field resolvers so GraphQL selection arguments are not modeled as
      query-level free-form strings.

### 4. Regression Tests

#### `src/graphql/schema.test.ts`, `src/server/graphql.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Unit-test default selection returns exactly the latest one persisted
      message.
- [x] Unit-test `order: ASC` and `order: DESC` return stable ordered windows.
- [x] Unit-test configurable `limit`, including `0`.
- [x] HTTP GraphQL-test schema accepts enum arguments on all three field
      locations.
- [x] HTTP GraphQL-test rejects invalid free-form order strings before resolver
      execution.
- [x] Test one query with different workflow-level and node-level message
      windows to prove field-local selection.

---

## Task Breakdown

| Task | Scope | Deliverables | Dependencies | Parallelizable |
| ---- | ----- | ------------ | ------------ | -------------- |
| TASK-001 | Shared enum/input alignment | `src/graphql/types.ts`, resolver selection type updates | Accepted design | No |
| TASK-002 | Resolver selection behavior | `src/graphql/schema.ts` selection helper and view assembly updates | TASK-001 | No |
| TASK-003 | Public SDL and field resolvers | `src/server/graphql-executable-schema.ts` enum, field args, resolver wiring | TASK-002 | No |
| TASK-004 | Focused tests | `src/graphql/schema.test.ts`, `src/server/graphql.test.ts` | TASK-001 through TASK-003 | No |

No tasks are marked parallelizable because each task depends on the previous
GraphQL type and resolver contract, and the write scopes converge on the same
GraphQL files.

---

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Field argument selection | Completed `impl-plans/graphql-llm-session-messages.md` runtime persistence | READY |
| Enum SDL | Accepted architecture design for `ASC`/`DESC` enum order | READY |
| HTTP tests | Executable schema field resolver wiring | BLOCKED |

---

## Verification

Run after implementation:

```bash
bun test src/graphql/schema.test.ts src/server/graphql.test.ts
bun run typecheck
git diff --check
```

Optional broader check when time permits:

```bash
bun test
```

---

## Completion Criteria

- [x] `WorkflowExecutionView.llmMessages` supports `limit` and enum `order`.
- [x] `WorkflowExecutionOverviewView.llmMessages` supports `limit` and enum
      `order`.
- [x] `NodeExecutionView.llmMessages` supports `limit` and enum `order`.
- [x] Default field selection returns the latest one persisted message.
- [x] Public GraphQL schema exposes `LlmSessionMessageOrder` enum with only
      `ASC` and `DESC`.
- [x] Invalid free-form order strings are rejected by GraphQL validation.
- [x] Different `llmMessages` fields in one query can use different limits and
      orders.
- [x] Focused GraphQL tests, typecheck, and diff whitespace checks pass.

---

## Progress Log

### Session: 2026-05-04 (plan revision)

**Tasks Completed**: Created focused active plan for the remaining issue #5
GraphQL field-argument gap after Step 5 requested revision.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: The earlier persistence plan remains as background context. This
plan is the source for the next implementation step and intentionally avoids
adapter/runtime DB changes.

### Session: 2026-05-04 (step6 implementation)

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented GraphQL `llmMessages(order:, limit:)` field arguments on
`WorkflowExecutionView`, `WorkflowExecutionOverviewView`, and
`NodeExecutionView`. Added `LlmSessionMessageOrder` SDL enum values `ASC` and
`DESC`, moved executable GraphQL message slicing to field resolvers so
workflow-level and node-level selections can request independent windows, kept
direct schema defaults at latest-one behavior, and verified with focused tests,
typecheck, and diff whitespace checks. Optional full `bun test` was also
attempted and failed outside this GraphQL slice with existing environment /
runtime-root issues: readonly runtime DB writes, hook artifact writes under
`$HOME/.divedra`, one timeout, and ambient workflow environment leakage.
