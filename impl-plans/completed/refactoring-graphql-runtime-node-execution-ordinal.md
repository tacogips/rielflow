# GraphQL Runtime Node Execution Ordinal Refactoring Plan

**Status**: Completed
**Design Reference**: Slice review outputs from `codex-refactoring-divide-and-conquer` execution `div-codex-refactoring-divide-and-conquer-1780020218-78f21648`
**Created**: 2026-05-29
**Last Updated**: 2026-05-29

## Scope

Expose `executionOrdinal` consistently on the public GraphQL `RuntimeNodeExecutionSummary` SDL surface. The DTO and control-plane projection already carry this field, but the SDL omits it, so clients cannot query data that runtime code already supplies.

Out of scope:

- Reworking GraphQL schema generation.
- Changing runtime execution ordinal persistence.
- Consolidating unrelated event adapter parsing or redaction logic.

## Accepted Findings

### FIND-001: GraphQL runtime node execution contract drift

**Severity**: Mid
**Slice ID**: `events-graphql-server-contract-surfaces`
**Primary File**: `packages/rielflow-graphql/src/schema-contract.ts`
**Problem**: `RuntimeNodeExecutionSummary` omits `executionOrdinal` even though DTOs and control-plane code expose `GraphqlRuntimeNodeExecutionSummary.executionOrdinal`.
**Risk**: GraphQL clients cannot query populated runtime data from `workflowExecution.nodeExecutions`.
**Confidence**: High

## Duplicate Groups

### DUP-001: GraphQL runtime node execution contract

**Repeated Concept**: GraphQL runtime node execution contract maintained across SDL, DTOs, resolver types, and control-plane projection.
**Owner Paths**:

- `packages/rielflow-graphql/src/schema-contract.ts`
- `packages/rielflow/src/graphql/schema.test.ts`

**Counterpart Duplicate Paths**:

- `packages/rielflow-graphql/src/dto.ts`
- `packages/rielflow/src/graphql/control-plane-service.ts`
- `packages/rielflow/src/graphql/types.ts`
- `packages/rielflow/src/graphql/schema/llm-run-overrides.ts`

**Behavior To Preserve**:

- DTO/control-plane shape continues to expose `executionOrdinal` as `number | null`.
- Existing `WorkflowExecutionStepRun.executionOrdinal` behavior remains unchanged.
- Existing GraphQL queries remain backward compatible.

**Known Differences Not To Collapse**:

- `WorkflowExecutionStepRun.executionOrdinal` is a different query type and may have stronger non-null semantics.
- Runtime import or legacy rows may not guarantee an ordinal, so the new SDL field should remain nullable unless existing tests prove otherwise.

**Consolidation Target**: Treat `packages/rielflow-graphql/src/schema-contract.ts` as the public SDL source and add a focused query test proving DTO-backed node execution fields are queryable.

**Dependency Order**:

1. Update SDL.
2. Add or update focused GraphQL schema/query coverage.
3. Run focused tests and typecheck.

**Conflicts**: Coordinate with any concurrent GraphQL schema, DTO generation, or workflow history ordinal changes.

**Confidence**: High

**Verification Commands**:

- `bun test packages/rielflow/src/graphql/schema.test.ts`
- `bun run typecheck`

## Task DAG

### REF-001: Expose runtime node execution ordinal in GraphQL SDL

**Status**: Completed
**Parallelizable**: Yes
**Owned Files/Directories**:

- `packages/rielflow-graphql/src/schema-contract.ts`
- `packages/rielflow/src/graphql/schema.test.ts`

**Excluded Files/Directories**:

- `packages/rielflow-core/src`
- `packages/rielflow/src/workflow`
- `packages/rielflow/src/events`
- `packages/rielflow/src/telemetry`
- `dist`
- `node_modules`
- `tmp`

**Dependencies**: None

**Duplicate Group IDs**:

- `DUP-001`

**Repeated Concept**: GraphQL runtime node execution contract maintained across SDL, DTOs, resolver types, and control-plane projection.

**Counterpart Duplicate Paths**:

- `packages/rielflow-graphql/src/dto.ts`
- `packages/rielflow/src/graphql/control-plane-service.ts`
- `packages/rielflow/src/graphql/types.ts`
- `packages/rielflow/src/graphql/schema/llm-run-overrides.ts`

**Behavior To Preserve**:

- Preserve nullable `executionOrdinal` semantics for runtime node execution summaries.
- Preserve all existing GraphQL schema fields and query behavior.

**Known Differences Not To Collapse**:

- Do not alter `WorkflowExecutionStepRun.executionOrdinal`.
- Do not introduce schema generation or broader DTO refactors.

**Consolidation Target**: Add `executionOrdinal: Int` to `RuntimeNodeExecutionSummary` in the public SDL and cover it through an executable schema/query test.

**Conflicts**:

- Shared public GraphQL contract changes may conflict with concurrent schema-contract edits.

**Completion Criteria**:

- [x] `RuntimeNodeExecutionSummary` SDL includes nullable `executionOrdinal`.
- [x] Focused GraphQL test queries `workflowExecution { nodeExecutions { nodeExecId executionOrdinal } }`.
- [x] Focused GraphQL test passes.
- [x] Typecheck passes or any unrelated pre-existing typecheck failure is documented.

**Verification Commands**:

- `bun test packages/rielflow/src/graphql/schema.test.ts`
- `bun run typecheck`

**Residual Risk Notes**:

- Manual SDL and DTO synchronization remains a drift risk beyond this one field.

## Rejected Or Deferred Findings

### REJECT-001: Core step relationship validation consolidation

**Source Slice ID**: `core-contracts-package`
**Reason**: Real issue, but write scope crosses core and runtime validation ownership and is larger than the requested one bounded improvement.
**Residual Risk**: `validatePureWorkflowBundle` may remain weaker than runtime validation until a dedicated package-boundary task is planned.

### REJECT-002: Telemetry structural redaction consolidation

**Source Slice ID**: `cli-public-api-and-shared-surfaces`
**Reason**: Real issue, but safe consolidation needs package-boundary review across telemetry, hook, and shared redaction semantics; broader than this pass.
**Residual Risk**: Nested sensitive keys in structured telemetry attributes may remain insufficiently redacted until a focused security fix is planned.

### REJECT-003: Runtime path containment duplicate candidates

**Source Slice ID**: `runtime-engine-and-workflow-package`
**Reason**: Low-severity duplicate candidate with intentional domain-specific security differences.
**Residual Risk**: Minor helper duplication remains.

### REJECT-004: Event adapter actor/conversation parsing duplicate candidates

**Source Slice ID**: `events-graphql-server-contract-surfaces`
**Reason**: Low-severity duplicate candidate with intentional webhook versus chat-sdk validation differences.
**Residual Risk**: Minor parser duplication remains.

## Exit Criteria

- [x] All high/mid findings accepted for this bounded pass are completed.
- [x] `REF-001` verification commands are run.
- [x] Accepted low residual risks are recorded.
- [x] No unrelated user changes are reverted.

## Progress Log

### Session: 2026-05-29

**Tasks Completed**: Created Step 3 merged refactoring plan.
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Selected the GraphQL SDL contract drift as the single bounded high-confidence implementation task. Deferred larger core validation and telemetry redaction issues to avoid exceeding the requested scope.

### Session: 2026-05-29 Step 4

**Tasks Completed**: `REF-001`
**Tasks In Progress**: None
**Blockers**: None
**Verification Evidence**:

- `bun test packages/rielflow/src/graphql/schema.test.ts` passed: 62 tests, 0 failures.
- `bun run typecheck` passed.
- `bun run lint:biome` passed.

**Notes**: Added nullable `executionOrdinal: Int` to `RuntimeNodeExecutionSummary` in the public SDL and added executable GraphQL query coverage for `workflowExecution { nodeExecutions { nodeExecId executionOrdinal } }`. Preserved existing DTO/control-plane behavior and did not change `WorkflowExecutionStepRun.executionOrdinal`.
