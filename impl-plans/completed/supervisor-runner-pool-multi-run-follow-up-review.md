# Supervisor Runner Pool Multi-Run Follow-Up Review Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#supervisor-runner-pool-multi-run-review-contract`
**Created**: 2026-05-14
**Last Updated**: 2026-05-14

---

## Design Document Reference

**Sources**:

- `design-docs/specs/architecture.md:129`
- `design-docs/specs/architecture.md:136`
- `design-docs/specs/architecture.md:152`
- `design-docs/specs/architecture.md:170`
- `design-docs/specs/architecture.md:183`
- `impl-plans/active/supervisor-runner-pool-package-boundary.md`

### Summary

Review the current `process_pool` branch after baseline commit
`b2b00b592360aa326b59766b1c157f78c3a548d8` for supervisor runner-pool
multi-run lookup semantics, GraphQL cross-request `runnerPoolRunId` handling,
package-boundary documentation, cancellation/wait/status behavior, idempotency
compatibility, and test/documentation completeness. If implementation gaps
remain, the later implementation step should make only tightly scoped fixes
that preserve public API compatibility.

### Scope

**Included**:

- Current-branch review against accepted Step 3 design rules.
- Targeted implementation only for confirmed correctness gaps.
- Tests for strong-id precedence, ambiguous convenience lookup, GraphQL
  request-boundary behavior, live versus durable wait/cancel/status behavior,
  idempotency compatibility, and public export parity.
- Documentation refresh for user-facing or package-boundary behavior changed by
  this follow-up.

**Excluded**:

- Rewriting the accepted supervisor runner-pool architecture.
- Changing public successful request/response call shapes.
- Treating `idempotencyKey` as a live runner-pool handle key.
- Making process-local `runnerPoolRunId` durable across process restarts.
- Importing backend-specific `codex-agent` or Cursor behavior into
  provider-neutral runner-pool semantics.

## Codex-Agent Reference Mapping

No concrete `codex-agent` references are available for this workflow run. Step 1
reported no supplied `codexAgentReferences` and no local `../../codex-agent`
reference root. The accepted design intentionally keeps `codex-agent` and Cursor
behavior adapter-scoped; the implementation plan therefore traces to divedra's
core supervisor-client and runner-pool contracts instead of external code.

Intentional divergences:

- Divedra `runnerPoolRunId` remains a process-local live-handle id.
- Durable inspection uses `supervisedRunId` or `workflowExecutionId`, not
  `runnerPoolRunId`.
- Backend adapters may translate requests but do not own runner-pool lifecycle
  semantics.

## Modules

### 1. Current-Branch Contract Audit

#### `src/workflow/supervisor-runner-pool.ts`
#### `src/workflow/supervisor-client/`
#### `src/graphql/schema/supervisor-resolvers.ts`
#### `src/workflow/supervisor-graphql-client.ts`
#### `src/events/`
#### `src/lib.ts`
#### `packages/divedra-core/src/index.ts`
#### `README.md`

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
  readonly idempotencyKey?: string;
}
```

**Deliverables**:

- Compare implementation behavior to the accepted Step 3 design.
- Record any concrete correctness gaps before editing code.
- Confirm package-boundary docs and public exports match supported surfaces.

**Checklist**:

- [x] Strong-id precedence and conflict handling audited.
- [x] Ambiguous convenience lookup behavior audited.
- [x] GraphQL request-boundary `runnerPoolRunId` behavior audited.
- [x] Wait/cancel/status live-versus-durable behavior audited.
- [x] Idempotency compatibility audited.
- [x] Package-boundary documentation and exports audited.

### 2. Runner-Pool Lookup and Lifecycle Corrections

#### `src/workflow/supervisor-runner-pool.ts`
#### `src/workflow/supervisor-client/`
#### `src/events/supervised-runs.ts`
#### `src/workflow/runtime-db/`

**Status**: COMPLETED

**Deliverables**:

- Fix only confirmed mismatches in strong-id lookup, convenience ambiguity,
  live-handle pruning, cancellation, wait, or durable status fallback.
- Preserve existing successful public API shapes.
- Keep `idempotencyKey` lookup as command replay compatibility, not live-handle
  selection.

**Checklist**:

- [x] Strong ids fail on conflicting active handles instead of falling through.
- [x] Ambiguous convenience targets fail for mutating and wait operations.
- [x] Completed live handles are pruned without breaking durable inspection.
- [x] Unknown or expired `runnerPoolRunId` reports process-local not-live state.
- [x] Idempotency-only lookup remains backward compatible.

### 3. GraphQL Cross-Request and Client Corrections

#### `src/graphql/schema/supervisor-resolvers.ts`
#### `src/graphql/types.ts`
#### `src/server/graphql-schema-text.ts`
#### `src/server/graphql-executable-schema.ts`
#### `src/workflow/supervisor-graphql-client.ts`
#### `src/server/graphql-supervision-and-resume.test.ts`
#### `src/workflow/supervisor-graphql-client.test.ts`

**Status**: COMPLETED

**Deliverables**:

- Fix only confirmed mismatches in GraphQL lookup parsing, response payloads,
  stable per-process runner-pool storage, and remote client variable forwarding.
- Ensure a `runnerPoolRunId` returned by dispatch can be reused by a separate
  GraphQL request in the same server process.
- Ensure missing, unknown, expired, or foreign-process `runnerPoolRunId` does
  not fall back to latest-run or broad convenience lookup.

**Checklist**:

- [x] GraphQL lookup precedence matches core supervisor-client lookup.
- [x] Dispatch and lookup payloads expose process-local `runnerPoolRunId` when
      an active handle exists.
- [x] Cross-request HTTP GraphQL lookup by returned `runnerPoolRunId` is covered.
- [x] Remote GraphQL client forwards all supported lookup ids.

### 4. Public Surface, Documentation, and Package Boundary

#### `src/lib.ts`
#### `packages/divedra-core/src/index.ts`
#### `packages/divedra/src/cli.ts`
#### `README.md`
#### `design-docs/specs/architecture.md`

**Status**: COMPLETED

**Deliverables**:

- Refresh documentation only where the current branch still underspecifies
  process-local runner-pool ids, durable lookup ids, or package import guidance.
- Keep root and `divedra-core` supervision exports aligned.
- Confirm adapters do not create independent runner-pool semantics.

**Checklist**:

- [x] Public exports needed by embedders are available from stable boundaries.
- [x] Documentation distinguishes live `runnerPoolRunId` from durable ids.
- [x] CLI/server/event/GraphQL adapters delegate lifecycle behavior to core
      supervisor-client or runner-pool code.
- [x] No backend-specific behavior is promoted into provider-neutral docs.

### 5. Regression Verification and Progress Recording

#### `src/workflow/supervisor-runner-pool.test.ts`
#### `src/workflow/supervisor-client.test.ts`
#### `src/workflow/supervisor-graphql-client.test.ts`
#### `src/server/graphql-supervision-and-resume.test.ts`
#### `src/graphql/schema.test.ts`
#### `src/lib-supervision.test.ts`
#### `impl-plans/active/supervisor-runner-pool-multi-run-follow-up-review.md`

**Status**: COMPLETED

**Deliverables**:

- Add or update targeted tests for every confirmed gap.
- Run targeted suites plus repository checks.
- Append progress-log entries with files changed, commands run, review
  findings, and residual risks.

**Checklist**:

- [x] Targeted runner-pool and supervisor-client tests pass.
- [x] GraphQL resolver/client/server tests pass.
- [x] Public export parity tests pass.
- [x] `bun run typecheck` passes.
- [x] `bun run lint:biome` passes.
- [x] `git diff --check` passes.
- [x] Progress log records implementation and verification results.

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Current-branch contract audit | `src/workflow/`, `src/graphql/`, `src/events/`, `src/lib.ts`, `packages/divedra-core/src/index.ts`, `README.md` | COMPLETED | inspection plus targeted existing tests |
| Runner-pool lookup and lifecycle corrections | `src/workflow/`, `src/events/supervised-runs.ts`, `src/workflow/runtime-db/` | COMPLETED | `src/workflow/supervisor-runner-pool.test.ts`, `src/workflow/supervisor-client.test.ts` |
| GraphQL cross-request and client corrections | `src/graphql/`, `src/server/`, `src/workflow/supervisor-graphql-client.ts` | COMPLETED | `src/server/graphql-supervision-and-resume.test.ts`, `src/workflow/supervisor-graphql-client.test.ts`, `src/graphql/schema.test.ts` |
| Public surface and documentation | `src/lib.ts`, `packages/divedra-core/src/index.ts`, `README.md`, `design-docs/specs/architecture.md` | COMPLETED | `src/lib-supervision.test.ts` |
| Regression verification and progress recording | tests plus this plan | COMPLETED | targeted suites, typecheck, lint, diff check |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Current-branch contract audit | Accepted Step 3 design | COMPLETED |
| Runner-pool lookup and lifecycle corrections | Task 1 confirmed gap | COMPLETED |
| GraphQL cross-request and client corrections | Task 1 confirmed gap; core lookup semantics if shared types change | COMPLETED |
| Public surface and documentation | Task 1 confirmed gap or behavior/doc mismatch | COMPLETED |
| Regression verification and progress recording | Any implementation/doc changes | COMPLETED |

## Parallelization

- `Task 1` is the required blocker and should run first.
- `Task 2` and `Task 3` may run in parallel only if Task 1 confirms disjoint
  write scopes; otherwise keep them sequential because lookup shapes cross core
  and GraphQL boundaries.
- `Task 4` may run in parallel with code fixes only when it touches docs or
  package exports that do not overlap the active code edits.
- `Task 5` runs after implementation changes, except targeted existing tests may
  be run during Task 1 as audit evidence.

## Verification Plan

Run these inspection commands during Task 1:

```bash
git diff --stat b2b00b592360aa326b59766b1c157f78c3a548d8...HEAD
rg -n "runnerPoolRunId|supervisedRunId|workflowExecutionId|workflowKey|alias|idempotencyKey|cancel\\(|wait\\(" src/workflow src/graphql src/server src/events packages/divedra-core/src/index.ts src/lib.ts README.md
sed -n '129,193p' design-docs/specs/architecture.md
sed -n '1,220p' src/workflow/supervisor-runner-pool.ts
```

Run these verification commands after any implementation changes:

```bash
bun test src/workflow/supervisor-runner-pool.test.ts src/workflow/supervisor-client.test.ts src/workflow/supervisor-graphql-client.test.ts src/server/graphql-supervision-and-resume.test.ts src/graphql/schema.test.ts src/lib-supervision.test.ts
bun run typecheck
bun run lint:biome
git diff --check
```

## Completion Criteria

- [x] Current branch has been reviewed against every accepted Step 3 design
      rule.
- [x] Any high or mid correctness gap found during review has a scoped code or
      documentation fix.
- [x] Strong identifiers resolve deterministically and conflicting strong ids
      fail instead of falling through to convenience lookup.
- [x] Convenience identifiers surface ambiguity for live wait and cancellation.
- [x] GraphQL can reuse a returned `runnerPoolRunId` across requests in the same
      server process and does not imply restart durability.
- [x] Wait/cancel/status behavior is deterministic for active, terminal,
      canceled, unknown, expired, and durable-only runs.
- [x] Existing idempotency compatibility is preserved.
- [x] Root and `divedra-core` package exports remain compatible.
- [x] Documentation is refreshed where user-facing or package-boundary wording
      is stale.
- [x] Targeted tests and repository checks pass, or failures are documented with
      exact commands and reasons.

## Progress Log

### Session: 2026-05-14 18:55

**Tasks Completed**: Created follow-up review implementation plan after Step 3
accepted the design.

**Notes**:

- Step 3 accepted the design with no findings and no requested revisions.
- This plan supersedes no existing plan; it references the completed
  `impl-plans/active/supervisor-runner-pool-package-boundary.md` as prior work.
- Later implementation must first audit current branch behavior, then edit only
  confirmed gaps.
- Because no concrete `codex-agent` references are available, the plan uses the
  accepted divedra design contract as source of truth and records adapter-scope
  divergence explicitly.

### Session: 2026-05-14 17:33 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Files Changed**:

- `src/graphql/schema/supervisor-resolvers.ts`
- `src/graphql/schema.test.ts`
- `impl-plans/active/supervisor-runner-pool-multi-run-follow-up-review.md`

**Findings and Actions**:

- Audited runner-pool core lookup, supervisor-client durable lookup,
  GraphQL resolver/client handling, public exports, README guidance, and the
  accepted design-doc contract.
- Confirmed core runner-pool strong-id conflict handling, ambiguous convenience
  lookup, wait/cancel live-handle requirements, durable terminal status fallback,
  idempotency replay compatibility, and package export parity were already
  aligned with the accepted design.
- Found one GraphQL correctness gap: `supervisedWorkflowRun` validated lookup
  precedence but dropped additional supplied strong identifiers before invoking
  the core runner pool. This allowed a request containing conflicting
  `runnerPoolRunId` and `workflowExecutionId` to resolve by only the first field.
- Fixed GraphQL lookup parsing so the resolver preserves all validated lookup
  fields for shared runner-pool resolution while keeping the existing exported
  parsed-precedence helper shape.
- Added a regression assertion that a GraphQL lookup with a live
  `runnerPoolRunId` and a different active `workflowExecutionId` fails as an
  ambiguous target.
- Self-review tightened the GraphQL parser to preserve compatibility for strong
  id lookups that include incomplete lower-precedence correlation fields; those
  partial correlation fields remain ignored when a higher-precedence lookup id
  is present.

**Verification**:

- `bun test src/workflow/supervisor-runner-pool.test.ts src/workflow/supervisor-client.test.ts src/workflow/supervisor-graphql-client.test.ts src/server/graphql-supervision-and-resume.test.ts src/graphql/schema.test.ts src/lib-supervision.test.ts`
- `bun run typecheck`
- `bun run lint:biome`
- `git diff --check`
- Self-review rerun: same targeted test command, `bun run typecheck`,
  `bun run lint:biome`, and `git diff --check`.

**Residual Risks**: None known for the scoped follow-up. `runnerPoolRunId`
remains intentionally process-local; durable cross-process inspection continues
to use `supervisedRunId` or `workflowExecutionId`.
