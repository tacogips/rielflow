# Self-Improve Package-Boundary Contract Reconciliation Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-self-improve.md#public-api-contract`; `design-docs/specs/architecture.md#package-boundary-architecture`
**Created**: 2026-05-19
**Last Updated**: 2026-05-19

---

## Design Document Reference

**Source**: `design-docs/specs/design-self-improve.md`, `design-docs/specs/architecture.md`

### Summary

Reconcile the package-boundary tests with the accepted self-improve ownership design. Dedicated retrospective self-improve is intentionally part of the provider-neutral `divedra-core` facade, while current package CLI self-improve imports from root `src/workflow/self-improve` remain temporary compatibility-facade imports until package-owned CLI adapters replace them.

### Issue Reference

- **Type**: recent-change-review-handoff
- **Source workflow**: `recent-change-quality-loop`
- **Source workflow execution**: `div-recent-change-quality-loop-1779155175-e6a26f7a`
- **Source node**: `step3-handoff`
- **Target workflow**: `design-and-implement-review-loop`
- **Reviewed range**: `HEAD~2..HEAD plus clean working tree`
- **Finding 1**: `packages/divedra-core/src/index.ts:17` exports self-improve APIs without the `src/package-boundaries.test.ts` core export contract being reconciled.
- **Finding 2**: `packages/divedra/src/cli/workflow-command-handler.ts:11` imports root `src/workflow/self-improve` without the temporary package-root import allowlist being reconciled.

### Scope

**Included**:

- Update `src/package-boundaries.test.ts` so intentional `divedra-core` self-improve facade exports are part of the package-boundary contract.
- Update `src/package-boundaries.test.ts` so the current `packages/divedra/src/cli/workflow-command-handler.ts` self-improve root import is listed as a temporary compatibility-facade import.
- Preserve the current public API and CLI behavior.
- Record the documentation impact explicitly: no user-facing documentation update is expected for a test-contract-only reconciliation, but update `README.md` or the affected design doc if implementation reveals a behavior or public-surface documentation gap.
- Run the focused package-boundary test and the requested broader verification commands.

**Excluded**:

- Moving self-improve implementation files between packages.
- Creating a new package-owned CLI/self-improve adapter.
- Changing workflow self-improve behavior, report schema, GraphQL behavior, Cursor adapter behavior, or Codex-agent execution behavior.
- Inspecting or applying the preserved interrupted stash or unrelated untracked workflow input file.

### Codex-Agent Reference Mapping

- `codex-agent`: execution backend reference only for workflow worker/provider context.
- `../../codex-agent`: intentionally not inspected; Step 1 through Step 3 accepted that this issue is package-boundary reconciliation, not Codex-reference behavior replication.
- Intentional divergence: divedra self-improve remains provider-neutral workflow infrastructure and does not copy Codex rollout formats.

---

## Modules

### 1. Package Boundary Test Contract

#### `src/package-boundaries.test.ts`

**Status**: COMPLETED

**Specification**:

- Add the current `packages/divedra/src/cli/workflow-command-handler.ts` import of `../../../../src/workflow/self-improve` to `TEMPORARY_COMPATIBILITY_ROOT_IMPORTS`.
- Add other current package-facade compatibility imports surfaced by the focused package-boundary test: `packages/divedra/src/cli/argument-parser.ts`, `packages/divedra/src/cli/storage-and-options.ts`, `packages/divedra/src/cli/scoped-command-handlers.ts`, and `packages/divedra-core/src/index.ts`.
- Update the `packages/divedra-core/src/index.ts` expected export contract to include the intentional self-improve service functions, policy/default constants, and public self-improve input/result/report types exported by the core facade.
- Keep assertions deterministic and sorted consistently with nearby export-contract expectations.
- Do not add broad wildcard allowlists or allow unrelated root imports.

**Checklist**:

- [x] `workflow-command-handler.ts` self-improve root import is explicitly allowlisted.
- [x] `divedra-core` expected exports include `executeWorkflowSelfImprove`.
- [x] `divedra-core` expected exports include report lookup/listing functions.
- [x] `divedra-core` expected exports include self-improve policy/default exports.
- [x] `divedra-core` expected exports include public self-improve input/result/report types at the facade source boundary; runtime `Object.keys` assertions cover value exports only.
- [x] No runtime behavior is changed.

---

### 2. Verification and Handoff Records

#### `impl-plans/active/self-improve-package-boundary-contract-reconciliation.md`
#### `impl-plans/README.md`
#### `impl-plans/PROGRESS.json`

**Status**: COMPLETED

**Specification**:

- Keep this plan as the authoritative active implementation plan for the delegated issue-resolution pass.
- Record progress after implementation and after verification.
- Keep plan and index updates scoped to this issue-resolution handoff.

**Checklist**:

- [x] Progress log records the implementation step and exact verification results.
- [x] `impl-plans/README.md` lists this plan under Active Plans.
- [x] `impl-plans/PROGRESS.json` tracks this plan and task statuses.

---

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Package boundary test contract | `src/package-boundaries.test.ts` | COMPLETED | `bun test src/package-boundaries.test.ts` |
| Plan/index tracking | `impl-plans/active/self-improve-package-boundary-contract-reconciliation.md`, `impl-plans/README.md`, `impl-plans/PROGRESS.json` | COMPLETED | `jq empty impl-plans/PROGRESS.json`, `git diff --check` |

## Task Breakdown

### TASK-001: Reconcile Package-Boundary Contract

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `src/package-boundaries.test.ts`
**Depends On**: None

Update the package-boundary test contract to match the accepted design: self-improve core exports are intentional, and the package CLI self-improve root import is a temporary compatibility-facade import.

**Completion Criteria**:

- [x] `bun test src/package-boundaries.test.ts` no longer fails on the self-improve core export contract.
- [x] `bun test src/package-boundaries.test.ts` no longer fails on `packages/divedra/src/cli/workflow-command-handler.ts` root import detection.
- [x] No unrelated package-boundary allowlist entries are added.

### TASK-002: Update Plan Progress and Documentation Impact Metadata

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `impl-plans/active/self-improve-package-boundary-contract-reconciliation.md`, `impl-plans/README.md`, `impl-plans/PROGRESS.json`, optional `README.md` or `design-docs/specs/design-self-improve.md` only if implementation reveals a documentation gap
**Depends On**: TASK-001

Record implementation completion, documentation impact, verification outcomes, and any residual risks. Keep `PROGRESS.json` valid JSON.

**Completion Criteria**:

- [x] Plan progress log includes implementation notes and verification command results.
- [x] Documentation impact is recorded as no user-facing doc change required, or the affected documentation file is updated.
- [x] `impl-plans/PROGRESS.json` task statuses match completed work.
- [x] `jq empty impl-plans/PROGRESS.json` passes.

### TASK-003: Run Required Verification

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: verification command output summaries in this plan and workflow payload
**Depends On**: TASK-001, TASK-002

Run focused and broad checks requested by the handoff. Workflow bundle validation and mock scenarios are only required if implementation changes workflow bundles.

**Completion Criteria**:

- [x] `bun test src/package-boundaries.test.ts` passes.
- [x] `bun test` passes, or any unrelated pre-existing failures are recorded with exact failing tests.
- [x] `bun run typecheck` passes.
- [x] `bun run lint:biome` passes or only retains pre-existing warnings.
- [x] If workflow bundles change, validate `refactoring-divide-and-conquer` and `refactoring-slice-review`.
- [x] If workflow bundles change, run focused mock scenarios for `refactoring-divide-and-conquer` and `refactoring-slice-review`.
- [x] `git diff --check` passes.

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| TASK-001 package-boundary reconciliation | Accepted Step 3 design review | COMPLETED |
| TASK-002 plan progress metadata | TASK-001 | COMPLETED |
| TASK-003 required verification | TASK-001, TASK-002 | COMPLETED |

## Parallelization

No implementation tasks are marked parallelizable. The blocking fix is intentionally narrow, and both accepted findings converge on `src/package-boundaries.test.ts`, so parallel writes would overlap.

## Verification Plan

Run these commands after implementation:

```bash
bun test src/package-boundaries.test.ts
bun test
bun run typecheck
bun run lint:biome
git diff --check
```

Run these only if workflow bundles under `.divedra/workflows` change:

```bash
bun run src/main.ts workflow validate refactoring-divide-and-conquer --workflow-definition-dir .divedra/workflows
bun run src/main.ts workflow validate refactoring-slice-review --workflow-definition-dir .divedra/workflows
bun run src/main.ts workflow run refactoring-divide-and-conquer --workflow-definition-dir .divedra/workflows --mock-scenario .divedra/workflows/refactoring-divide-and-conquer/mock-scenario.json --output json
bun run src/main.ts workflow run refactoring-slice-review --workflow-definition-dir .divedra/workflows --mock-scenario .divedra/workflows/refactoring-slice-review/mock-scenario.json --output json
```

## Completion Criteria

- [x] Both recent-change review mid findings are addressed.
- [x] `src/package-boundaries.test.ts` encodes the accepted self-improve package-boundary design.
- [x] Public API and CLI behavior are preserved.
- [x] Documentation impact is explicitly recorded, with docs updated only if implementation exposes a behavior or public-surface documentation gap.
- [x] Required verification commands pass or blocked failures are recorded with exact summaries.
- [x] No automated-assistant attribution or co-authorship trailers are introduced in commits.
- [x] The preserved interrupted stash and unrelated `.workflow-input-review-improve-latest-main.json` are not inspected or modified.

## Progress Log

### Session: 2026-05-19 Step 4 Plan Creation

**Tasks Completed**: Created actionable plan after Step 3 accepted the design.
**Tasks In Progress**: None.
**Blockers**: None.

**Notes**:

- Step 3 accepted `design-docs/specs/design-self-improve.md` and `design-docs/specs/architecture.md` with no high or mid findings.
- Step 5 feedback is not present for this execution attempt; no rerun feedback required addressing.
- Later TypeScript edits must follow repository TypeScript coding standards and invoke the required check/test workflow after modifying `src/package-boundaries.test.ts`.

### Session: 2026-05-19 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003.
**Tasks In Progress**: None.
**Blockers**: None.

**Notes**:

- Updated `src/package-boundaries.test.ts` to explicitly allow the current compatibility-facade root imports for self-improve and event scheduling surfaces, including `packages/divedra/src/cli/workflow-command-handler.ts` and `packages/divedra-core/src/index.ts`.
- Updated the core source facade runtime export contract to include `DEFAULT_SELF_IMPROVE_LOG_LIMIT`, `executeWorkflowSelfImprove`, `getWorkflowSelfImproveReport`, `listWorkflowSelfImproveReports`, and `resolveWorkflowSelfImprovePolicy`.
- Runtime behavior, public CLI behavior, workflow bundles, and Codex-agent behavior were not changed.
- Documentation impact: no `README.md` user-facing change was required because the implementation reconciles test contracts with the already accepted design documents.

**Verification**:

- `biome format --write src/package-boundaries.test.ts`: passed, no fixes applied.
- `bun test src/package-boundaries.test.ts`: passed, 22 tests.
- `bun test`: passed, 1226 tests.
- `bun run typecheck`: passed.
- `bun run lint:biome`: passed with existing warnings in `src/workflow/engine/*`.
- `git diff --check`: passed.

## Related Plans

- **Related**: `impl-plans/active/self-improve.md`
- **Related**: `impl-plans/active/self-improve-review-hardening.md`
- **Related**: `impl-plans/active/self-improve-shared-function-reuse-audit.md`
- **Depends On**: accepted design updates in `design-docs/specs/design-self-improve.md` and `design-docs/specs/architecture.md`
