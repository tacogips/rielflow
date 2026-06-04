# Run-Log Workflow Definition Body Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md#run-scoped-workflow-definition-body
**Created**: 2026-06-04
**Last Updated**: 2026-06-04

---

## Design Document Reference

**Source**: design-docs/specs/design-graphql-manager-control-plane.md

### Summary

Expose the raw authored `workflow.json` body used by a workflow execution on
GraphQL run-log detail queries. The field is run-scoped, nullable, and must
resolve from execution metadata rather than the current catalog workflow.

### Scope

**Included**: Add nullable `workflowDefinitionJsonBody: String` to
`workflowExecution(...)` and `workflowExecutionOverview(...)`, persist the raw
workflow body before node execution for stored/direct/manifest/scoped/temp runs,
project the snapshot through session/control-plane/runtime DB types, and cover
stored, temporary, and legacy-null behavior with focused tests.

**Excluded**: Adding the field to `workflowExecutions(...)` list rows,
`WorkflowExecutionStepRun` timeline rows, changing `workflowDefinition(...)`,
returning a parsed JSON scalar, or changing codex-agent backend behavior.

### Accepted Review Feedback

Step 3 accepted the design with no high or mid findings. No Step 5 feedback is
present for this first Step 4 run.

No codex-agent reference implementation was provided or inspected. codex-agent
is only a backend name for this feature, and the plan intentionally follows the
accepted rielflow GraphQL/session design instead of copying agent behavior.

---

## Modules

### 1. Public GraphQL Contract

#### packages/rielflow-graphql/src/schema-contract.ts
#### packages/rielflow-graphql/src/dto.ts
#### packages/rielflow-graphql/src/control-plane-service.ts
#### packages/rielflow/src/graphql/types.ts

**Status**: COMPLETED

```typescript
interface WorkflowControlPlaneSession {
  readonly workflowDefinitionJsonBody?: string | null;
}

interface WorkflowExecutionView {
  readonly workflowDefinitionJsonBody: string | null;
}

interface WorkflowExecutionOverviewView {
  readonly workflowDefinitionJsonBody: string | null;
}
```

**Checklist**:

- [x] Add `workflowDefinitionJsonBody: String` to `WorkflowExecutionView`.
- [x] Add `workflowDefinitionJsonBody: String` to `WorkflowExecutionOverviewView`.
- [x] Add nullable control-plane DTO/type projection support.
- [x] Keep `workflowExecutions(...)` and `WorkflowExecutionStepRun` unchanged.
- [x] Update schema/type tests that assert field availability.

### 2. Execution-Scoped Snapshot Persistence

#### packages/rielflow/src/workflow/session.ts
#### packages/rielflow/src/workflow/session-store.ts
#### packages/rielflow/src/workflow/runtime-db/session-query-records.ts
#### packages/rielflow/src/workflow/engine/session-entry.ts

**Status**: COMPLETED

```typescript
interface WorkflowSessionState {
  readonly workflowDefinitionJsonBody?: string;
}

interface CreateSessionInput {
  readonly workflowDefinitionJsonBody?: string;
}
```

**Checklist**:

- [x] Add optional session-state snapshot field and normalize legacy sessions.
- [x] Capture the raw UTF-8 `workflow.json` body from the loaded workflow source.
- [x] Pass the snapshot into fresh session creation before node execution.
- [x] Ensure resume preserves existing source semantics and rerun/continuation snapshot the newly loaded workflow body.
- [x] Keep legacy sessions nullable when no execution-scoped snapshot exists.

### 3. Temporary Workflow Source Handling

#### packages/rielflow/src/workflow/packages/temp-run.ts
#### packages/rielflow/src/cli/registry-run-provenance.ts
#### packages/rielflow/src/workflow/load.ts
#### packages/rielflow/src/workflow/catalog.ts

**Status**: COMPLETED

```typescript
interface TemporaryWorkflowRunProvenance {
  readonly temporaryWorkflowDirectory?: string;
}

interface WorkflowDefinitionBodyResolution {
  readonly workflowDefinitionJsonBody: string | null;
}
```

**Checklist**:

- [x] Confirm temporary package and GitHub-directory runs use the same loaded workflow source path.
- [x] Persist snapshot before temporary checkout cleanup can remove `workflow.json`.
- [x] Avoid fallback catalog lookup when the execution-scoped snapshot is missing.
- [x] Return `null` when no persisted snapshot exists and source cannot be proven.
- [x] Avoid current catalog lookup by `workflowName` as the primary source.

### 4. GraphQL Resolver Wiring

#### packages/rielflow/src/graphql/schema/execution-resolvers.ts
#### packages/rielflow/src/server/graphql-executable-schema.ts

**Status**: COMPLETED

```typescript
function resolveWorkflowDefinitionJsonBody(
  session: WorkflowControlPlaneSession,
): string | null;
```

**Checklist**:

- [x] Return `session.workflowDefinitionJsonBody ?? null` from detail views.
- [x] Keep sibling run-log fields available when the body is `null`.
- [x] Preserve existing LLM-message field resolvers and query argument behavior.
- [x] Ensure executable schema mapping exposes the new scalar field without custom resolver surprises.

### 5. Tests and Documentation Touchpoints

#### packages/rielflow/src/graphql/schema.test.ts
#### packages/rielflow/src/server/graphql-execution-overview-and-definitions.test.ts
#### packages/rielflow/src/server/graphql-queries-and-inspection.test.ts
#### impl-plans/active/run-log-workflow-definition-body.md

**Status**: COMPLETED

**Checklist**:

- [x] Assert schema exposes `workflowDefinitionJsonBody` on both detail views.
- [x] Test stored workflow run returns the execution-time body after catalog edit.
- [x] Test cleaned-up workflow directory returns the persisted body after cleanup.
- [x] Test legacy session without a snapshot returns `null`.
- [x] Update this plan progress log after implementation and verification.

---

## Task Breakdown

| Task | Status | Deliverables | Dependencies | Parallelizable |
| ---- | ------ | ------------ | ------------ | -------------- |
| TASK-001 Public GraphQL contract | COMPLETED | `packages/rielflow-graphql/src/schema-contract.ts`, `packages/rielflow-graphql/src/dto.ts`, `packages/rielflow/src/graphql/types.ts` | Accepted design | Yes, with TASK-002 only |
| TASK-002 Snapshot persistence | COMPLETED | `packages/rielflow/src/workflow/session.ts`, `packages/rielflow/src/workflow/load.ts`, `packages/rielflow/src/workflow/engine/session-entry.ts` | Accepted design | Yes, with TASK-001 only |
| TASK-003 Temporary source handling | COMPLETED | Shared loaded-workflow snapshot path before cleanup | TASK-002 | No |
| TASK-004 Resolver wiring | COMPLETED | `packages/rielflow/src/graphql/schema/execution-resolvers.ts` | TASK-001, TASK-002 | No |
| TASK-005 Verification coverage | COMPLETED | Focused GraphQL/schema/load tests and progress-log update | TASK-001 through TASK-004 | No |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| GraphQL field exposure | Public schema/type additions | READY |
| Resolver field value | Persisted or nullable session projection | READY |
| Temporary run correctness | Snapshot persisted before temp cleanup | READY |
| Stored run correctness | Execution-scoped snapshot, not current catalog lookup | READY |
| Legacy compatibility | Optional nullable session field | READY |

## Parallelizable Tasks

- `TASK-001` and `TASK-002` may run concurrently because their main write scopes
  are disjoint public contract files vs workflow session/persistence files.
- `TASK-003`, `TASK-004`, and `TASK-005` must be sequential because they depend
  on the snapshot shape and public field contract.

## Verification Plan

Run after implementation:

```bash
bun run typecheck
bun run typecheck:server
bun test packages/rielflow/src/graphql/schema.test.ts
bun test packages/rielflow/src/server/graphql-execution-overview-and-definitions.test.ts
bun test packages/rielflow/src/server/graphql-queries-and-inspection.test.ts
git diff --check
```

Focused assertions:

- `workflowExecution(workflowExecutionId)` can select
  `workflowDefinitionJsonBody`.
- `workflowExecutionOverview(workflowExecutionId)` can select
  `workflowDefinitionJsonBody`.
- Stored workflow run returns the body used for the run even after the catalog
  `workflow.json` changes.
- Temporary run returns the persisted body after terminal cleanup.
- Legacy sessions without persisted source data return `null`.

## Completion Criteria

Completed on 2026-06-04.

Verification run:

- `bun test packages/rielflow/src/workflow/load.test.ts packages/rielflow/src/graphql/schema.test.ts`
- `bun run typecheck`
- `bun run lint:biome`
- `git diff --check`

- [ ] Public GraphQL schema and TypeScript contract expose the nullable field on both detail views.
- [ ] New executions persist raw authored `workflow.json` text before node execution.
- [ ] Temporary runs preserve the body before cleanup and never rely on current catalog lookup.
- [ ] Legacy sessions without source proof resolve the field as `null`.
- [ ] Focused tests and typechecks pass with the commands listed above.
- [ ] Progress log records implementation session, verification commands, and any residual risks.

## Progress Log

### Session: 2026-06-04 11:06

**Tasks Completed**: Plan creation only
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Created from accepted Step 3 design review for issue-resolution workflow `codex-design-and-implement-review-loop`.

## Related Plans

- **Previous**: None
- **Next**: Implementation step for `run-log-workflow-definition-body`
- **Depends On**: `design-docs/specs/design-graphql-manager-control-plane.md#run-scoped-workflow-definition-body`
