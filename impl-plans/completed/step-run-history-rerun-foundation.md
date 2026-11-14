# Step-Run History Rerun - Foundation Implementation Plan

**Status**: Completed  
**Design Reference**: `design-docs/specs/design-step-run-history-rerun.md`  
**Created**: 2026-05-01  
**Last Updated**: 2026-05-02

---

## Related Plans

- **Next**: `impl-plans/step-run-history-rerun-runtime.md` (engine + surfaces — depends on this plan)
- **Depends On**: step-addressed runtime cutover (`impl-plans/completed/step-addressed-workflow-runtime-cutover.md`)

---

## Summary

Establish persisted identity and lineage for history-linked workflow continuation:
explicit `executionOrdinal` on step runs, continuation fields and `historyImports`
on new workflow executions, `stepRunId` as a public alias of `nodeExecId`,
SQLite/runtime-db migrations; resolution helpers for anchors, and deletion
retention rules for referenced sources.

---

## Scope

**Included**: session/runtime-db types and persistence, ordinal allocation aligned
with `nodeExecutionCounter`, flattening ancestry into `historyImports` at creation
(contract + pure functions tested without full engine loop), retention checks on delete.

**Excluded**: inbox assembly precedence, CLI/GraphQL public commands, GraphQL SDL
beyond internal types if surfaced only in runtime plan, TUI/export formatting.

---

### TASK-001: Continuation Types and Contracts

**Parallelizable**: Yes  
**Deliverables**: `WorkflowSessionState` / execution row extensions; TypeScript unions
for `continuationMode`; `HistoryImportSegment` descriptor type; naming note that
`stepRunId` equals persisted `nodeExecId`.

**Completion criteria**:

- [x] Types documented on design fields: `executionOrdinal`, lineage fields,
      `historyImports` ordered oldest-to-newest, optional fields match design
      cardinality
- [x] No second identifier column for step runs versus `nodeExecId`
- [x] Serialization round-trip tests for continuation metadata on synthetic session payloads

---

### TASK-002: Ordinal Persistence and Migration

**Parallelizable**: No (depends TASK-001)  
**Deliverables**: runtime DB / SQLite schema updates; migration for existing rows:
backfill monotonic `executionOrdinal` consistent with append order /
`nodeExecutionCounter` semantics; invariant tests.

**Completion criteria**:

- [x] New sessions allocate `executionOrdinal` with counter rule from design
- [x] Migrator handles empty and non-empty databases; idempotent where applicable
- [x] Unit/integration tests exercise migration replay

---

### TASK-003: Anchor Resolution and Flattening

**Parallelizable**: No (depends TASK-001–002)  
**Deliverables**: pure functions to resolve `afterStepRunId` into owning execution,
ordinal, flattened `historyImports` up to inclusive anchor; validation rules:
terminal status allowlist (`succeeded`, `skipped` default), anchor in merged
timeline visible from source execution, same-workflow constraint.

**Completion criteria**:

- [x] Recursive continuation flattened at creation time (no runtime recursive walks)
- [x] Rows after anchor discarded per design
- [x] Negative tests for non-terminal anchors, unknown ids, mismatched workflows

---

### TASK-004: Retention / Deletion Policy

**Parallelizable**: No (depends TASK-002)  
**Deliverables**: delete-path guardrails when dependents reference a workflow
execution via `historyImports` or lineage pointers; deterministic error surfaces.

**Completion criteria**:

- [x] Attempted delete of referenced source fails or cascades only as explicitly chosen
      (prefer fail-with-dependency-error per design)
- [x] Tests for reference chains across continued runs

---

## Module Status

| Module | Paths | Depends |
| ------ | ----- | ------- |
| Types | session / shared execution types | — |
| Migrations | runtime DB loaders | TASK-001 |
| Resolution | new module or `workflow/` helpers | TASK-001–002 |
| Retention | session store delete APIs | TASK-002 |

---

## Completion Criteria

- [x] TASK-001 through TASK-004 complete
- [x] `bun run typecheck` passes
- [x] Focused Vitest suites for new persistence and resolver logic pass

---

## Known follow-ups (runtime plan)

TASK-003 tests do not exhaust every resolver edge (`segment_boundary_not_found`,
deep recursive chains); runtime implementation should extend coverage when wiring
CLI/GraphQL. Low-level SQLite `deleteRuntimeSession` remains reachable without
dependency screening; callers should continue to use `deleteWorkflowSessionHistory`.

---

## Progress Log

### Session: 2026-05-02 (implementation landed)

**Tasks Completed**: TASK-001 through TASK-004 (types/normalization,
`history-continuation` resolution helpers + tests, SQLite `execution_ordinal` +
continuation session snapshot columns with backfill, engine/call-step ordinal
writes, continuation delete guardrails).
**Verification**: `bun run typecheck`; `bun test src/workflow/history-continuation.test.ts src/workflow/session.test.ts src/workflow/runtime-db.test.ts src/workflow/session-history.test.ts`.

### Session: 2026-05-02

**Tasks Completed**: Drafted foundation plan split from runtime/surface delivery.
**Notes**: Runtime plan owns engine inbox merge, CLI `session continue` / `step-runs`,
and GraphQL `continueWorkflowExecution` / `workflowExecutionStepRuns`.
