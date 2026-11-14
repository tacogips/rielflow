# GraphQL LLM Session Messages Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#llm-session-message-inspection-boundary`
**Created**: 2026-05-04
**Last Updated**: 2026-05-04

## Summary

Implement GitHub issue #5 by persisting provider-neutral LLM/backend session messages emitted during node execution and exposing them through workflow GraphQL inspection views.

## Scope

In scope:

- Runtime DB table and query helpers for ordered LLM session message records.
- Adapter output shape for captured backend messages.
- Codex and Claude local agent adapter capture.
- Engine and direct `call-step` persistence paths.
- GraphQL schema/types/resolvers for workflow and node execution views.
- Focused tests for adapter capture, runtime persistence, and GraphQL exposure.

Out of scope:

- Reading arbitrary transcript files from `hookEvents.transcriptPath`.
- Full official SDK request/response transcript capture.
- CLI formatting changes outside existing GraphQL output.

## Modules

### 1. Adapter Capture Types

#### `src/workflow/adapter.ts`

**Status**: Completed

```typescript
interface AdapterLlmSessionMessage {
  readonly ordinal: number;
  readonly role?: string;
  readonly eventType: string;
  readonly contentText?: string;
  readonly rawMessageJson?: string;
  readonly backendSessionId?: string;
  readonly at?: string;
}
```

**Checklist**:

- [x] Add provider-neutral message type.
- [x] Add optional `llmMessages` to `AdapterExecutionOutput`.
- [x] Preserve existing adapter output behavior.

### 2. Runtime Persistence

#### `src/workflow/runtime-db.ts`

**Status**: Completed

```typescript
interface RuntimeLlmSessionMessageRecord {
  readonly id: number;
  readonly sessionId: string;
  readonly nodeExecId: string;
  readonly nodeId: string;
  readonly provider: string;
  readonly model: string;
  readonly backendSessionId: string | null;
  readonly ordinal: number;
  readonly role: string | null;
  readonly eventType: string;
  readonly contentText: string | null;
  readonly rawMessageJson: string | null;
  readonly at: string;
}
```

**Checklist**:

- [x] Add `llm_session_messages` schema and indexes.
- [x] Save messages alongside node execution runtime rows.
- [x] Add list query by workflow execution id.
- [x] Delete message rows during runtime session deletion.

### 3. GraphQL Exposure

#### `src/graphql/types.ts`, `src/graphql/schema.ts`, `src/server/graphql-executable-schema.ts`

**Status**: Completed

```typescript
interface WorkflowExecutionView {
  readonly llmMessages: readonly RuntimeLlmSessionMessageRecord[];
}

interface NodeExecutionView {
  readonly llmMessages: readonly RuntimeLlmSessionMessageRecord[];
}
```

**Checklist**:

- [x] Add GraphQL record type.
- [x] Add `llmMessages` to workflow execution, overview, and node execution views.
- [x] Filter node view messages by `nodeExecId`.

### 4. Tests

#### `src/workflow/adapters/*.test.ts`, `src/workflow/runtime-db.test.ts`, `src/graphql/schema.test.ts`

**Status**: Completed

**Checklist**:

- [x] Codex adapter captures assistant snapshots.
- [x] Claude adapter captures assistant messages.
- [x] Runtime DB persists and lists ordered records.
- [x] GraphQL node/overview views expose persisted messages.
- [x] Typecheck passes.

## Module Status

| Module              | File Path                                                  | Status    | Tests   |
| ------------------- | ---------------------------------------------------------- | --------- | ------- |
| Adapter capture     | `src/workflow/adapter.ts`, `src/workflow/adapters/*.ts`    | Completed | Passing |
| Runtime persistence | `src/workflow/runtime-db.ts`                               | Completed | Passing |
| GraphQL exposure    | `src/graphql/*`, `src/server/graphql-executable-schema.ts` | Completed | Passing |
| Verification        | focused tests and typecheck                                | Completed | Passing |

## Dependencies

| Feature             | Depends On                 | Status |
| ------------------- | -------------------------- | ------ |
| Runtime persistence | Adapter capture type       | READY  |
| GraphQL exposure    | Runtime list helper        | READY  |
| Tests               | All implementation modules | READY  |

## Completion Criteria

- [x] Issue #5 has a persisted design and implementation plan.
- [x] GraphQL can return ordered LLM/backend session messages for a workflow execution.
- [x] GraphQL can return ordered LLM/backend session messages for a node execution.
- [x] Codex and Claude local adapter tests cover message capture.
- [x] Runtime DB and GraphQL tests pass.
- [x] `bun run typecheck` passes.

## Progress Log

### Session: 2026-05-04

**Tasks Completed**: Created issue #5, attempted `design-and-implement-review-loop`, documented design boundary, started implementation.
**Tasks In Progress**: Adapter capture, runtime persistence, GraphQL exposure, tests.
**Blockers**: The divedra workflow run failed at the first manager step because backend output did not satisfy the workflow JSON contract.
**Notes**: Continuing implementation manually in the same repository workflow because the requested workflow did not reach design or implementation stages.

### Session: 2026-05-04 (completion)

**Tasks Completed**: Adapter capture, runtime persistence, GraphQL exposure, HTTP GraphQL coverage, focused verification.
**Tasks In Progress**: None.
**Blockers**: None for the manual implementation path.
**Notes**: Verification passed with focused adapter/runtime/GraphQL tests, HTTP GraphQL tests, `bun run typecheck`, and `git diff --check`.
