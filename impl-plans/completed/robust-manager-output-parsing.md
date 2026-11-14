# Robust Manager Output Parsing Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#adapter-layer, design-docs/specs/architecture.md#manager-control-architecture
**Created**: 2026-05-04
**Last Updated**: 2026-05-04

---

## Design Document Reference

**Source**: `design-docs/specs/architecture.md`

### Summary

Make divedra core runtime parsing tolerant of common LLM output formatting without shifting responsibility to workflow prompts. Adapter output parsing should recover JSON object payloads from exact object text, prose-wrapped fenced JSON, and the first balanced object embedded in prose. Manager control parsing should treat `payload.managerControl: null` as absent while preserving strict validation for non-null malformed manager-control payloads.

### Scope

Included:

- shared adapter JSON object candidate recovery in `src/workflow/adapter.ts`
- focused parser tests in `src/workflow/adapter.test.ts`
- nullable `payload.managerControl` handling in `src/workflow/manager-control.ts`
- manager-control regression tests in `src/workflow/manager-control.test.ts`
- backend convergence audit for `codex-agent`, `claude-code-agent`, and SDK-backed adapter paths that use shared parsing
- typecheck and focused test verification

Excluded:

- provider-specific structured-output APIs
- workflow prompt changes as the primary fix
- accepting non-object JSON payloads, arrays, scalar JSON, malformed fences, or unbalanced object text
- changing GraphQL manager-control mode exclusivity semantics

## Codex Reference Trace

| Source | Reference | Plan Handling |
| ------ | --------- | ------------- |
| Workflow node | `design-and-implement-review-loop` / `step4-impl-plan-create` | Plan created for full issue resolution handoff |
| Issue | `tacogips/divedra`: "Make workflow manager/output parsing robust against nullable managerControl and wrapped JSON responses" | Direct source for task split and verification |
| Codex input | `codex-agent` backend reference from workflow runtime variables; no mailbox or upstream node payloads attached | Design accepted before this plan; no intentional divergence |
| Existing local diff | `src/workflow/adapter.ts`, `src/workflow/adapter.test.ts`, `src/workflow/manager-control.ts`, `src/workflow/manager-control.test.ts` | Treat as a manual starting patch that must be reviewed and verified |

## Modules

### 1. Shared Adapter JSON Candidate Recovery

#### `src/workflow/adapter.ts`

```ts
function extractJsonObjectCandidateText(text: string): string;
function extractBalancedJsonObject(text: string, start: number): string | null;
export function parseJsonObjectCandidate(
  text: string,
  source: string,
): Readonly<Record<string, unknown>>;
```

**Checklist**:

- [x] Preserve exact JSON object parsing behavior
- [x] Accept one fenced JSON object even when surrounded by prose
- [x] Accept the first balanced JSON object embedded in prose
- [x] Correctly handle braces inside JSON strings and escaped quotes
- [x] Continue rejecting arrays, scalar JSON, empty text, partial objects, and unbalanced objects

### 2. Adapter Parser Regression Tests

#### `src/workflow/adapter.test.ts`

**Checklist**:

- [x] Add focused positive tests for prose-wrapped fenced JSON
- [x] Add focused positive tests for balanced embedded JSON objects
- [x] Add negative tests for arrays, scalars, and unbalanced object text
- [x] Keep test assertions tied to `parseJsonObjectCandidate()` error behavior

### 3. Manager Control Null Tolerance

#### `src/workflow/manager-control.ts`

```ts
export function parseManagerControlPayload(
  payload: Readonly<Record<string, unknown>>,
  workflow: WorkflowJson,
  context: ManagerControlParseContext,
): ParsedManagerControl | null;
```

**Checklist**:

- [x] Treat `payload.managerControl === null` the same as an absent field
- [x] Keep non-null non-object `managerControl` rejected
- [x] Keep non-array `managerControl.actions` rejected
- [x] Preserve existing scope validation for supported actions

### 4. Manager Control Regression Tests

#### `src/workflow/manager-control.test.ts`

**Checklist**:

- [x] Add explicit-null regression for `parseManagerControlPayload()`
- [x] Confirm omitted `managerControl` still returns `null`
- [x] Confirm malformed non-null values still fail

### 5. Backend Convergence Audit

#### `src/workflow/adapters/codex.ts`
#### `src/workflow/adapters/claude.ts`
#### SDK-backed adapter call sites under `src/workflow/adapters/`

**Checklist**:

- [x] Confirm backend adapters converge through shared `parseJsonObjectCandidate()`
- [x] Add backend-specific tests only if a path bypasses shared parsing
- [x] Avoid duplicating wrapper recovery logic inside provider adapters

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Shared adapter parser | `src/workflow/adapter.ts` | COMPLETED | `src/workflow/adapter.test.ts` |
| Adapter parser tests | `src/workflow/adapter.test.ts` | COMPLETED | focused unit tests |
| Manager control parser | `src/workflow/manager-control.ts` | COMPLETED | `src/workflow/manager-control.test.ts` |
| Manager control tests | `src/workflow/manager-control.test.ts` | COMPLETED | focused unit tests |
| Backend convergence audit | `src/workflow/adapters/*` | COMPLETED | no parser bypass gaps found |

## Dependencies

| Task | Depends On | Write Scope | Status |
| ---- | ---------- | ----------- | ------ |
| TASK-001 Shared adapter parser | Accepted architecture adapter-layer design | `src/workflow/adapter.ts` | COMPLETED |
| TASK-002 Adapter parser tests | TASK-001 behavior contract | `src/workflow/adapter.test.ts` | COMPLETED |
| TASK-003 Manager control null tolerance | Accepted manager-control architecture design | `src/workflow/manager-control.ts` | COMPLETED |
| TASK-004 Manager control tests | TASK-003 behavior contract | `src/workflow/manager-control.test.ts` | COMPLETED |
| TASK-005 Backend convergence audit | TASK-001 | `src/workflow/adapters/*` | COMPLETED |
| TASK-006 Verification and cleanup | TASK-001 through TASK-005 | no functional write scope unless fixes are required | COMPLETED |

## Parallelizable Tasks

- `TASK-001` and `TASK-003` are parallelizable because their write scopes are disjoint.
- `TASK-002` and `TASK-004` are parallelizable after their respective implementation tasks because their test files are disjoint.
- `TASK-005` is not parallelizable with `TASK-001` if it discovers adapter parsing gaps that require shared-parser changes.
- `TASK-006` depends on all implementation and test tasks.

## Verification Plan

- `bun test src/workflow/adapter.test.ts src/workflow/manager-control.test.ts`
- `bun test src/workflow/adapters/codex.test.ts src/workflow/adapters/claude.test.ts`
- `bun run typecheck`
- Optional full regression if focused checks pass and time allows: `bun run test`

## Completion Criteria

- [x] `payload.managerControl: null` is accepted as absent manager control
- [x] non-null malformed `payload.managerControl` remains rejected
- [x] shared adapter parsing accepts exact JSON objects, prose-wrapped fenced JSON objects, and first balanced embedded JSON objects
- [x] shared adapter parsing rejects non-object, scalar, partial, and unbalanced JSON responses
- [x] relevant `codex-agent` and `claude-code-agent` adapter paths use the shared parser behavior
- [x] focused tests pass
- [x] `bun run typecheck` passes

## Progress Log Expectations

Each implementation session must append:

- completed task ids
- files changed
- verification commands run with pass/fail result
- review findings addressed, if any
- unresolved TODOs with file paths

## Progress Log

### Session: 2026-05-04 00:00

**Tasks Completed**: None yet
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004
**Blockers**: None
**Notes**: Existing manual patch already touches the shared parser and manager-control parser/test files. No mailbox or upstream node payloads were attached to this planning step. Later implementation should review that patch for edge cases, preserve unrelated local diff, and run the focused verification commands before broader regression.

### Session: 2026-05-04 10:38 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006
**Tasks In Progress**: None
**Blockers**: None
**Files Changed**: `src/workflow/adapter.ts`, `src/workflow/adapter.test.ts`, `src/workflow/manager-control.ts`, `src/workflow/manager-control.test.ts`, `impl-plans/completed/robust-manager-output-parsing.md`
**Verification**: `bun test src/workflow/adapter.test.ts src/workflow/manager-control.test.ts` passed; `env -u DIVEDRA_GRAPHQL_ENDPOINT -u DIVEDRA_WORKFLOW_ID -u DIVEDRA_WORKFLOW_EXECUTION_ID -u DIVEDRA_NODE_ID -u DIVEDRA_NODE_EXEC_ID -u DIVEDRA_AGENT_BACKEND bun test src/workflow/adapters/codex.test.ts src/workflow/adapters/claude.test.ts src/workflow/adapters/openai-sdk.test.ts src/workflow/adapters/anthropic-sdk.test.ts` passed; `bun run typecheck` passed.
**Review Findings Addressed**: None supplied to Step 6.
**Unresolved TODOs**: None.

## Related Plans

- **Depends On**: `impl-plans/node-output-contract-and-validation.md`, `impl-plans/graphql-manager-control-mode-exclusivity.md`
- **Related Design**: `design-docs/specs/architecture.md`
