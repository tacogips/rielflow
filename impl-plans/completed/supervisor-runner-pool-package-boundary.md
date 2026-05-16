# Supervisor Runner Pool Package Boundary Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#supervisor-runner-pool-package-boundary`; `design-docs/specs/design-event-supervisor-control.md#codex-agent-reference-mapping`
**Created**: 2026-05-14
**Last Updated**: 2026-05-14

---

## Design Document Reference

**Sources**:

- `design-docs/specs/architecture.md:108`
- `design-docs/specs/architecture.md:118`
- `design-docs/specs/architecture.md:1098`
- `design-docs/specs/design-event-supervisor-control.md:267`
- `design-docs/specs/design-event-supervisor-control.md:291`
- `design-docs/specs/design-event-supervisor-control.md:348`
- `design-docs/user-qa/qa-event-supervisor-control.md:26`

### Summary

Review and harden the existing deterministic in-process supervisor runner pool
for multiple active workflow runs. The later implementation step must preserve
public API compatibility while making target resolution, cancellation, wait,
status/progress inspection, and package-boundary ownership match the accepted
design.

### Scope

**Included**:

- Multi-active-run targeting keyed by `runnerPoolRunId`, `supervisedRunId`,
  `workflowExecutionId`, workflow key/alias, and source/binding/correlation key.
- Explicit ambiguous-target handling for mutating convenience lookups.
- Live-handle-only cancellation and wait semantics with durable status/progress
  fallback.
- Protection against inspection commands replacing async live handles.
- Public supervision export parity between `src/lib.ts` and
  `packages/divedra-core/src/index.ts`.
- GraphQL/event/CLI translation paths that call core supervisor-client or
  runner-pool operations without owning independent runner-pool state.
- Focused regression coverage for concurrent active runs and package exports.

**Excluded**:

- Replacing the in-process runner pool with child-process lifecycle management.
- Copying code from `../../codex-agent`; it is unavailable locally and remains
  a behavioral reference only.
- Introducing Cursor CLI behavior into provider-neutral runner-pool contracts.
- Broad package source movement beyond export or facade corrections required
  for this issue.
- Full backend process abort propagation if existing adapters cannot support it;
  persisted cancellation/status reconciliation remains acceptable for this
  milestone per `design-docs/user-qa/qa-event-supervisor-control.md`.

## Codex-Agent Reference Mapping

- `../../codex-agent/src/sdk/session-runner.ts`: behavioral reference for active
  run lifecycle, wait/cancel facade, and active-set pruning.
- `../../codex-agent/src/sdk/agent-runner.ts`: behavioral reference for stable
  caller-facing async runner API shape.
- `../../codex-agent/src/sdk/mock-session-runner.ts`: behavioral reference for
  deterministic async runner tests.
- `../../codex-agent/src/process/manager.ts`: negative reference only; divedra
  must not model supervisor workflow control as local binary process spawning.
- `../../codex-agent/impl-plans/issue6-stable-runner-api.md`: unavailable local
  planning reference; use only if a later step gains access.

Intentional divergences:

- Divedra manages in-process workflow executions and durable supervised-run
  records rather than Codex subprocesses.
- Runner-pool ids and workflow session ids are divedra runtime identities, not
  codex-agent session ids.
- Cursor/Codex/backend-specific behavior stays behind adapter modules.

## Modules

### 1. Runner-Pool Target Indexing and Ambiguity

#### `src/workflow/supervisor-runner-pool.ts`
#### `src/workflow/supervisor-client-types.ts`
#### `src/workflow/supervisor-runner-pool.test.ts`

**Status**: COMPLETED

```typescript
interface SupervisedWorkflowLookup {
  readonly runnerPoolRunId?: string;
  readonly supervisedRunId?: string;
  readonly workflowExecutionId?: string;
  readonly workflowKey?: string;
  readonly alias?: string;
  readonly sourceId?: string;
  readonly bindingId?: string;
  readonly correlationKey?: string;
}

type SupervisorTargetResolution =
  | { readonly kind: "single"; readonly handle: SupervisorRunnerPoolHandle }
  | { readonly kind: "ambiguous"; readonly matchedRunIds: readonly string[] }
  | { readonly kind: "not-found" };
```

**Deliverables**:

- Preserve strongest-id-first lookup for authoritative ids:
  `runnerPoolRunId`, `supervisedRunId`, and `workflowExecutionId`.
- Change alias/workflow-key/correlation indexes to support multiple live handles
  instead of silently overwriting one handle with another.
- Return explicit ambiguous-target results for mutating convenience lookups that
  match more than one active handle.
- Keep read-only status/progress behavior deterministic by either returning a
  multi-run summary or requiring stronger target refinement.
- Ensure inspection dispatches do not replace an existing async handle with a
  non-async view.

**Checklist**:

- [x] Active handle indexes retain all matching handles for convenience keys.
- [x] Strong ids resolve a single handle before convenience keys are considered.
- [x] Mutating alias/workflow-key/correlation lookups reject ambiguity.
- [x] Inspection commands never overwrite active async handles.
- [x] Tests cover two active runs sharing alias/workflow key/correlation keys.

### 2. Cancellation and Wait Semantics

#### `src/workflow/supervisor-runner-pool.ts`
#### `src/workflow/supervisor-client.ts`
#### `src/workflow/supervisor-client/supervisor-client-operations.ts`
#### `src/workflow/supervisor-client.test.ts`

**Status**: COMPLETED

```typescript
interface SupervisorRunnerPool {
  dispatch(command: EventSupervisorCommand): Promise<SupervisedWorkflowView>;
  lookup(lookup: SupervisedWorkflowLookup): Promise<SupervisedWorkflowView>;
  cancel(lookup: SupervisedWorkflowLookup): Promise<SupervisedWorkflowView>;
  wait(lookup: SupervisedWorkflowLookup): Promise<SupervisedWorkflowView>;
}
```

**Deliverables**:

- Treat cancellation as a live-handle operation that targets only the matching
  in-process handle.
- Reconcile cancellation results into supervised-run/session records without
  pretending durable-only records are still cancellable.
- Treat wait as a live-handle operation when a handle exists; on terminal
  completion, reconcile state and prune all live indexes for that handle.
- Return durable terminal views for already completed records and explicit
  not-live/not-waitable results for durable non-terminal records with no live
  handle.

**Checklist**:

- [x] Cancel affects only the resolved live handle.
- [x] Cancel reports not-live when only durable records remain.
- [x] Wait prunes all indexes after terminal completion.
- [x] Wait returns durable terminal view when no live handle remains.
- [x] Tests cover cancel/wait/status interleavings for concurrent runs.

### 3. Durable Status, Progress, and Transport Surfaces

#### `src/events/supervised-runs.ts`
#### `src/events/trigger-runner.ts`
#### `src/graphql/schema/supervisor-resolvers.ts`
#### `src/workflow/supervisor-client/supervisor-client-helpers.ts`
#### `src/server/graphql-supervision-and-resume.test.ts`

**Status**: COMPLETED

**Deliverables**:

- Keep status/progress inspection available through persisted supervised-run
  and workflow session/artifact records after live handles complete or after
  process restart.
- Ensure GraphQL lookup parsing preserves all supported ids and does not collapse
  ambiguous convenience targets into one arbitrary run.
- Ensure event-source command routing forwards structured ids to core
  supervisor-client operations.
- Confirm CLI/event/GraphQL surfaces do not instantiate independent runner-pool
  state outside core-owned creation points.

**Checklist**:

- [x] Durable status/progress works after live handle pruning.
- [x] GraphQL cancel/wait/status honor strongest-id and ambiguity semantics.
- [x] Event-source commands preserve source/binding/correlation targeting.
- [x] No adapter path bypasses core runner-pool semantics for mutating actions.
- [x] Tests cover GraphQL and event/client lookup behavior.

### 4. Package Boundary and Public API Compatibility

#### `src/lib.ts`
#### `packages/divedra-core/src/index.ts`
#### `packages/divedra/src/cli.ts`
#### `packages/divedra-core/package.json`
#### `packages/divedra/package.json`
#### `src/lib-supervision.test.ts`

**Status**: COMPLETED

**Deliverables**:

- Keep runner-pool lifecycle types, client request/response shapes, and
  deterministic in-process implementation owned by `divedra-core`.
- Keep `divedra` as a compatibility facade and CLI package; it may re-export
  core APIs but must not own independent runner-pool state.
- Preserve existing successful public API call shapes while adding clearer
  failure modes and exported types when needed.
- Verify `src/lib.ts` and `packages/divedra-core/src/index.ts` expose the same
  stable supervision client surface needed by embedders.

**Checklist**:

- [x] Public supervision exports remain available from `src/lib.ts`.
- [x] Matching public supervision exports remain available from
      `packages/divedra-core/src/index.ts`.
- [x] Compatibility facade does not introduce independent runner-pool state.
- [x] Package manifests expose stable entrypoints only.
- [x] Export parity tests cover newly needed types/results.

### 5. Regression Verification and Documentation Notes

#### `src/workflow/supervisor-runner-pool.test.ts`
#### `src/workflow/supervisor-client.test.ts`
#### `src/lib-supervision.test.ts`
#### `src/server/graphql-supervision-and-resume.test.ts`
#### `README.md` or affected command docs if user-facing behavior text changes

**Status**: COMPLETED

**Deliverables**:

- Add focused tests for shared alias/workflow-key/correlation ambiguity,
  strongest-id targeting, cancellation not-live responses, wait pruning, and
  durable status fallback.
- Refresh user-facing documentation only if command output, public API wording,
  or package import guidance changes.
- Record implementation progress in this plan after each implementation session.

**Checklist**:

- [x] Focused test suite passes.
- [x] `bun run typecheck` passes.
- [x] User-facing documentation is updated or explicitly deemed unnecessary.
- [x] Progress log records files changed, commands run, and residual risks.

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Runner-pool target indexing and ambiguity | `src/workflow/supervisor-runner-pool.ts` | COMPLETED | `src/workflow/supervisor-runner-pool.test.ts` |
| Cancellation and wait semantics | `src/workflow/supervisor-runner-pool.ts`, `src/workflow/supervisor-client.ts` | COMPLETED | `src/workflow/supervisor-client.test.ts` |
| Durable status and transport surfaces | `src/events/`, `src/graphql/schema/supervisor-resolvers.ts` | COMPLETED | `src/server/graphql-supervision-and-resume.test.ts`, `src/graphql/schema.test.ts` |
| Package boundary and public API | `src/lib.ts`, `packages/divedra-core/src/index.ts`, `packages/divedra/src/cli.ts` | COMPLETED | `src/lib-supervision.test.ts` |
| Regression verification and docs | tests plus docs if needed | COMPLETED | focused suite, Biome, typecheck, full test |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Runner-pool target indexing and ambiguity | Accepted Step 3 design | COMPLETED |
| Cancellation and wait semantics | Runner-pool target resolution | COMPLETED |
| Durable status and transport surfaces | Target resolution result shape | COMPLETED |
| Package boundary and public API | Confirmed result/export shapes | COMPLETED |
| Regression verification and docs | All implementation modules | COMPLETED |

## Parallelization

- `Module 1` is a blocker for all semantic changes and should start first.
- `Module 3` and `Module 4` may run in parallel after the target-resolution
  result shape is stable because their write scopes are disjoint.
- `Module 2` should not run in parallel with `Module 1` because both modify
  `src/workflow/supervisor-runner-pool.ts`.
- `Module 5` should run after behavior and public surfaces stabilize.

## Verification Plan

Run these commands after implementation:

```bash
bun test src/workflow/supervisor-runner-pool.test.ts src/workflow/supervisor-client.test.ts src/lib-supervision.test.ts src/server/graphql-supervision-and-resume.test.ts
bun run typecheck
```

Use these inspection commands during implementation:

```bash
rg -n "runnerPoolRunId|supervisedRunId|workflowExecutionId|workflowKey|correlationKey|cancel\\(|wait\\(" src/workflow src/events src/graphql packages/divedra-core/src/index.ts src/lib.ts
rg -n "createSupervisorRunnerPool|SupervisorRunnerPool|SupervisedWorkflowLookup" src packages
```

## Completion Criteria

- [x] Strong-id targeting is deterministic and takes priority over convenience
      lookups.
- [x] Mutating alias/workflow-key/correlation lookups fail explicitly when they
      match multiple active runs.
- [x] Cancellation and wait operate only on live handles and report durable-only
      states truthfully.
- [x] Wait completion prunes all live indexes without breaking later durable
      status/progress inspection.
- [x] Inspection commands do not replace existing active async handles.
- [x] Core-owned supervisor APIs remain exported from `src/lib.ts` and
      `packages/divedra-core/src/index.ts`.
- [x] `divedra` remains a compatibility facade and does not own independent
      runner-pool state.
- [x] Focused supervisor, GraphQL, and public API tests pass.
- [x] `bun run typecheck` passes.

## Progress Log

### Session: 2026-05-14 15:30

**Tasks Completed**: Created implementation plan after Step 3 accepted the
design.

**Notes**:

- Step 3 accepted the design with no high or mid findings.
- Low review note retained: `design-docs/user-qa/qa-event-supervisor-control.md`
  has relevant confirmations for multi-run correlation, cancellation scope, and
  restart semantics even though the Step 2 payload listed no open questions.
- Later implementation must use TypeScript coding standards and run the
  required check/test pass after TypeScript modifications.

### Session: 2026-05-14 16:45

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.

**Files Changed**:

- `src/workflow/supervisor-runner-pool.ts`
- `src/workflow/supervisor-runner-pool.test.ts`
- `src/workflow/supervisor-client/workflow-supervisor-client-factory.ts`
- `src/workflow/supervisor-client.test.ts`
- `src/events/supervised-runs.ts`
- `src/workflow/runtime-db/session-query-records.ts`
- `src/graphql/schema/supervisor-resolvers.ts`
- `src/graphql/types.ts`
- `src/graphql/schema.test.ts`
- `src/server/graphql-schema-text.ts`
- `src/server/graphql-executable-schema.ts`
- `src/server/graphql-supervision-and-resume.test.ts`
- `src/lib-supervision.test.ts`

**Commands Run**:

- `biome format --write ...`
- `bun test src/workflow/supervisor-runner-pool.test.ts src/workflow/supervisor-client.test.ts src/lib-supervision.test.ts src/server/graphql-supervision-and-resume.test.ts src/graphql/schema.test.ts`
- `bun run lint:biome`
- `bun run typecheck`
- `bun run test`

**Notes**:

- Runner-pool indexes now retain multiple handles per convenience key while
  resolving `runnerPoolRunId`, `supervisedRunId`, and `workflowExecutionId`
  first.
- `cancel` and `wait` reject ambiguous convenience lookups and keep cancellation
  live-handle-only.
- `wait` prunes live indexes after terminal completion and can return durable
  terminal status through the supervisor client.
- GraphQL lookup input now preserves runner-pool, workflow-execution,
  workflow-key, alias, correlation, and idempotency fields instead of collapsing
  everything to correlation.
- Runtime supervised-run storage can resolve active records by active target
  workflow execution id for status/transport lookup while preserving existing
  terminal reconciliation behavior.
- Public API compatibility is preserved by adding methods/fields without
  removing existing call shapes; the compatibility `divedra` package continues
  to re-export root `src/lib.ts`.

**Residual Risks**:

- Terminal reconciliation still clears `activeTargetExecutionId` on completed
  supervised-run records, so durable terminal inspection after live pruning
  should use `supervisedRunId` or correlation lookup rather than only a historic
  workflow execution id.
- Backend adapter cancellation remains best-effort through persisted session
  status; no new provider-level abort propagation was added.

### Session: 2026-05-14 17:10

**Tasks Completed**: Step 7 review revision for TASK-002, TASK-003, TASK-005.

**Files Changed**:

- `src/workflow/supervisor-graphql-client.ts`
- `src/workflow/supervisor-graphql-client.test.ts`
- `src/workflow/supervisor-client-types.ts`
- `src/workflow/supervisor-client/workflow-supervisor-client-factory.ts`
- `src/workflow/supervisor-client/workflow-supervisor-client-lookup.ts`
- `src/workflow/runtime-db/session-query-records.ts`
- `src/events/supervised-runs.ts`

**Commands Run**:

- `biome format --write src/workflow/supervisor-client/workflow-supervisor-client-factory.ts src/workflow/supervisor-client/workflow-supervisor-client-lookup.ts src/workflow/supervisor-graphql-client.ts src/workflow/supervisor-graphql-client.test.ts src/workflow/supervisor-client-types.ts src/workflow/runtime-db/session-query-records.ts src/events/supervised-runs.ts`
- `bun test src/workflow/supervisor-graphql-client.test.ts src/workflow/supervisor-client.test.ts src/server/graphql-supervision-and-resume.test.ts src/graphql/schema.test.ts`
- `bun run typecheck`
- `bun run lint:biome`
- `bun run test`

**Notes**:

- Addressed Step 7 mid-severity feedback by forwarding every supported
  supervisor lookup field through the GraphQL client lookup variables.
- Added remote-client coverage for `status`, `stop`, `restart`, and
  `submitInput` preserving `workflowExecutionId`, `runnerPoolRunId`, and command
  idempotency lookup fields before dispatching follow-up mutations.
- Added local durable command-id lookup so the public client semantics match the
  remote GraphQL lookup surface after idempotency lookup forwarding.

### Session: 2026-05-14 17:35

**Tasks Completed**: Step 7 review revision for TASK-001 and TASK-003.

**Files Changed**:

- `src/workflow/supervisor-runner-pool.ts`
- `src/workflow/supervisor-runner-pool.test.ts`
- `src/workflow/supervisor-client/supervisor-client-helpers.ts`
- `src/workflow/supervisor-client.test.ts`

**Commands Run**:

- `biome format --write src/workflow/supervisor-runner-pool.ts src/workflow/supervisor-runner-pool.test.ts src/workflow/supervisor-client/supervisor-client-helpers.ts src/workflow/supervisor-client.test.ts`
- `bun test src/workflow/supervisor-runner-pool.test.ts src/workflow/supervisor-client.test.ts src/server/graphql-supervision-and-resume.test.ts src/graphql/schema.test.ts`
- `bun run typecheck`
- `bun run lint:biome`

**Notes**:

- Addressed Step 7 strong-id targeting feedback by making any supplied
  `runnerPoolRunId`, `supervisedRunId`, or `workflowExecutionId` authoritative
  for live runner-pool resolution instead of falling back to convenience lookup
  fields.
- Added regression coverage proving a stale strong id plus matching correlation
  key cannot cancel a different live handle.
- Preserved `activeTargetExecutionId` during terminal reconciliation so durable
  status lookup by workflow execution id continues after the target session is
  completed and the live handle is pruned.

### Session: 2026-05-14 17:55

**Tasks Completed**: Step 7 review revision for TASK-001, TASK-002, and TASK-003.

**Files Changed**:

- `src/workflow/runtime-db.ts`
- `src/workflow/runtime-db/supervised-run-query-records.ts`
- `src/events/supervised-runs.ts`
- `src/workflow/supervisor-client/workflow-supervisor-client-lookup.ts`
- `src/workflow/supervisor-client.test.ts`

**Commands Run**:

- `biome format --write src/workflow/runtime-db.ts src/workflow/runtime-db/supervised-run-query-records.ts src/events/supervised-runs.ts src/workflow/supervisor-client/workflow-supervisor-client-lookup.ts src/workflow/supervisor-client.test.ts`
- `bun test src/workflow/supervisor-runner-pool.test.ts src/workflow/supervisor-client.test.ts src/server/graphql-supervision-and-resume.test.ts src/graphql/schema.test.ts`
- `bun run typecheck`
- `bun run lint:biome`

**Notes**:

- Addressed Step 7 workflow-key and alias feedback by adding durable
  target-workflow-name lookup for active and latest supervised-run records.
- Direct supervisor-client lookup now supports `workflowKey` and `alias` before
  falling back to command-id or correlation lookup; ambiguous active matches
  produce an explicit refinement error.
- Added regression coverage for public `status` by workflow key, `stop` by
  alias, and ambiguous active workflow-key/alias lookups.

### Session: 2026-05-14 18:10

**Tasks Completed**: Step 7 review revision for TASK-001 and TASK-002.

**Files Changed**:

- `src/workflow/supervisor-runner-pool.ts`
- `src/workflow/supervisor-runner-pool.test.ts`

**Commands Run**:

- `biome format --write src/workflow/supervisor-runner-pool.ts src/workflow/supervisor-runner-pool.test.ts`
- `bun test src/workflow/supervisor-runner-pool.test.ts src/workflow/supervisor-client.test.ts src/server/graphql-supervision-and-resume.test.ts src/graphql/schema.test.ts`
- `bun run typecheck`
- `bun run lint:biome`
- `git diff --check`

**Notes**:

- Addressed Step 7 stale-successful-async-handle feedback by attaching a
  success handler to each stored async task and pruning the live handle when the
  resolved view is terminal.
- Added regression coverage proving a completed async task is pruned even when
  no caller invokes `wait`, and subsequent cancellation by `supervisedRunId`
  reports the not-live handle error.

### Session: 2026-05-14 18:25

**Tasks Completed**: Step 7 review revision for TASK-002, TASK-003, and TASK-005.

**Files Changed**:

- `src/workflow/supervisor-client/workflow-supervisor-client-lookup.ts`
- `src/graphql/schema/supervisor-resolvers.ts`
- `src/workflow/supervisor-client.test.ts`
- `src/graphql/schema.test.ts`

**Commands Run**:

- `biome format --write src/workflow/supervisor-client/workflow-supervisor-client-lookup.ts src/graphql/schema/supervisor-resolvers.ts src/workflow/supervisor-client.test.ts src/graphql/schema.test.ts`
- `bun test src/workflow/supervisor-runner-pool.test.ts src/workflow/supervisor-client.test.ts src/workflow/supervisor-graphql-client.test.ts src/server/graphql-supervision-and-resume.test.ts src/graphql/schema.test.ts`
- `bun run typecheck`
- `bun run lint:biome`
- `git diff --check`

**Notes**:

- Addressed Step 7 idempotency-key precedence feedback by making
  source/binding/correlation lookup take precedence over new command
  idempotency keys in both the library lookup path and GraphQL lookup parser.
- Preserved command-id lookup for idempotency-key-only requests.
- Added regression coverage for library correlation lookup with new
  idempotency keys and GraphQL supervised-run status lookup with correlation
  plus a new idempotency key.

### Session: 2026-05-14 18:45

**Tasks Completed**: Step 7 review revision for TASK-001, TASK-002, and TASK-005.

**Files Changed**:

- `src/graphql/schema/supervisor-resolvers.ts`
- `src/graphql/types.ts`
- `src/server/graphql-schema-text.ts`
- `src/server/graphql-executable-schema.ts`
- `src/server/graphql-supervision-and-resume.test.ts`

**Commands Run**:

- `biome format --write src/graphql/schema/supervisor-resolvers.ts src/graphql/types.ts src/server/graphql-schema-text.ts src/server/graphql-executable-schema.ts src/server/graphql-supervision-and-resume.test.ts`
- `bun test src/workflow/supervisor-runner-pool.test.ts src/workflow/supervisor-client.test.ts src/workflow/supervisor-graphql-client.test.ts src/server/graphql-supervision-and-resume.test.ts src/graphql/schema.test.ts`
- `bun run typecheck`
- `bun run lint:biome`
- `git diff --check`

**Notes**:

- Addressed Step 7 HTTP GraphQL runner-pool feedback by keying GraphQL
  supervisor runner pools by stable runtime context roots instead of exact
  per-request context object identity.
- Added `runnerPoolRunId` to the supervised workflow GraphQL payload so clients
  can capture live in-process handle ids from dispatch and lookup responses.
- Added HTTP GraphQL regression coverage proving a second request can resolve a
  live supervised run by the `runnerPoolRunId` captured from the first request.
