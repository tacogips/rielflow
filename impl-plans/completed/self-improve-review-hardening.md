# Dedicated Workflow Self-Improve Review Hardening Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-self-improve.md#issue-resolution-hardening-criteria`
**Created**: 2026-05-18
**Last Updated**: 2026-05-18

---

## Design Document Reference

**Source**: `design-docs/specs/design-self-improve.md`

### Summary

Review and harden the existing dedicated workflow self-improve implementation while preserving its product boundary from supervisor and `workflow run --auto-improve`. The implementation pass must verify and close gaps across CLI, library, GraphQL, server guardrails, source-run evidence, since-last markers, report-only side effects, backup/rollback, prompt-file patching, git staging, validation, documentation, and tests.

### Scope

**Included**:

- Audit the current implementation against the accepted hardening criteria and update this plan's progress log with concrete gaps found.
- Preserve provider-neutral core service behavior shared by CLI, library, and GraphQL entrypoints.
- Verify endpoint-backed CLI and library paths use typed GraphQL self-improve operations.
- Verify `serve --read-only` and `serve --no-exec` reject execution while report reads remain available when allowed.
- Verify runtime validation rejects invalid public inputs and command/API overrides before report, backup, patch, marker, or git side effects.
- Verify source-run analysis includes workflow status, node execution, and output-validation evidence.
- Verify since-last markers, explicit session workflow identity checks, report-only side effects, backup/rollback, promptTemplateFile patching, and git staging boundaries.
- Refresh README/API documentation and regression tests for any corrected behavior.

**Excluded**:

- Redesigning self-improve as live supervision or merging it with auto-improve.
- Scheduled/background self-improve execution.
- Cross-workflow explicit session analysis.
- Git push from runtime self-improve.
- Copying Codex rollout storage formats into divedra.

### Codex Reference Trace

- `/Users/taco/gits/tacogips/codex-agent/src/session/index.ts`: latest-session discovery reference.
- `/Users/taco/gits/tacogips/codex-agent/src/session/sqlite.ts`: SQLite index fallback reference.
- `/Users/taco/gits/tacogips/codex-agent/src/session/search.ts`: DB-first/filesystem fallback search reference.
- `/Users/taco/gits/tacogips/codex-agent/src/rollout/reader.ts`: resilient transcript parsing reference.
- `/Users/taco/gits/tacogips/codex-agent/src/file-changes/service.ts`: file-change summary service reference.
- `/Users/taco/gits/tacogips/codex-agent/src/file-changes/extractor.ts`: file-change extraction reference.
- `/Users/taco/gits/tacogips/codex-agent/src/queue/runner.ts`: queued prompt execution and durable progress reference.
- `/Users/taco/gits/tacogips/codex-agent/src/main.ts`: library facade export reference.

Codex-agent references are structural only. Divedra source runs remain in divedra runtime session/artifact stores, and backend-specific transcript behavior remains behind existing adapters.

---

## Modules

### 1. Gap Audit and Plan Tracking

#### `impl-plans/active/self-improve-review-hardening.md`

**Status**: COMPLETED

```typescript
interface SelfImproveHardeningGap {
  readonly criterion: string;
  readonly severity: "high" | "mid" | "low";
  readonly filePaths: readonly string[];
  readonly remediationTask: string;
}
```

**Checklist**:

- [x] Inspect current self-improve code, tests, and docs against every accepted hardening criterion.
- [x] Record concrete gaps and remediation ownership in the Progress Log before implementation edits.
- [x] Keep the original completed `impl-plans/active/self-improve.md` as historical context.

### 2. Core Input Validation, Policy, and Source Selection

#### `src/workflow/self-improve/config.ts`, `src/workflow/self-improve/source-selection.ts`, `src/workflow/self-improve/marker-store.ts`, `src/workflow/self-improve/service.ts`

**Status**: COMPLETED

```typescript
interface WorkflowSelfImprovePublicInputValidation {
  readonly mode?: string;
  readonly sourceMode?: string;
  readonly limit?: number;
  readonly sessionIds?: readonly string[];
  readonly enableDisabled?: boolean;
  readonly commandApiOverrides?: readonly string[];
}
```

**Checklist**:

- [x] Validate public `mode`, `sourceMode`, `limit`, explicit session ids, and command/API overrides before side effects.
- [x] Normalize valid command/API overrides into the same core service input used by CLI, GraphQL, library, and server paths.
- [x] Preserve disabled-workflow override behavior.
- [x] Ensure `since-last-or-latest` returns no old runs when a successful marker exists and no newer runs exist.
- [x] Ensure failed, reverted, or rejected executions do not advance the marker.
- [x] Add or update focused tests in `src/workflow/self-improve/config.test.ts`, `source-selection.test.ts`, and `service.test.ts`.

### 3. Run Evidence, Report Shape, and Report-Only Side Effects

#### `src/workflow/self-improve/analyzer.ts`, `src/workflow/self-improve/report.ts`, `src/workflow/self-improve/service.ts`, `src/workflow/self-improve/types.ts`

**Status**: COMPLETED

```typescript
interface WorkflowSelfImproveEvidenceGate {
  readonly workflowStatus: string;
  readonly nodeExecutions: readonly {
    readonly nodeId: string;
    readonly status: string;
    readonly outputValidationStatus?: string;
  }[];
}
```

**Checklist**:

- [x] Include workflow-level status, node execution, and output-validation evidence in selected source runs.
- [x] Ensure purpose-achievement judgments cite concrete evidence or return `unknown`.
- [x] Ensure report-only mode never creates backups, applies patches, or creates git commits.
- [x] Keep report schema free of backend-specific auth, process flags, and rollout formats.
- [x] Add or update tests in `src/workflow/self-improve/service.test.ts` and related report coverage.

### 4. Backup, Patch, Prompt File, and Git Safety

#### `src/workflow/self-improve/backup.ts`, `src/workflow/self-improve/patcher.ts`, `src/workflow/self-improve/git.ts`

**Status**: COMPLETED

```typescript
interface WorkflowSelfImproveMutationSafetyResult {
  readonly backupCreatedBeforeWrite: boolean;
  readonly restoredAfterFailure: boolean;
  readonly changedFiles: readonly string[];
  readonly gitCommitStatus: "not-git-managed" | "committed" | "failed";
}
```

**Checklist**:

- [x] Create backup before the first canonical workflow write in `report-and-auto-improve`.
- [x] Restore from backup after validation failure or patch-time exception while preserving repository metadata such as `.git`.
- [x] Patch workflow-local `promptTemplateFile` targets directly instead of replacing them with embedded prompt templates.
- [x] Stage only files changed by the current self-improve execution.
- [x] Ensure runtime code never pushes and commit messages contain no automated-assistant attribution.
- [x] Add or update tests in `src/workflow/self-improve/patcher.test.ts` and `backup-git.test.ts`.

### 5. CLI, Library, GraphQL, and Server Parity

#### `src/lib.ts`, `packages/divedra-core/src/index.ts`, `packages/divedra/src/cli/argument-parser.ts`, `packages/divedra/src/cli/workflow-command-handler.ts`, `packages/divedra/src/index.ts`, `packages/divedra-graphql/src/schema-contract.ts`, `packages/divedra-graphql/src/dto.ts`, `src/graphql/schema/execution-resolvers.ts`, `src/server/graphql-executable-schema.ts`

**Status**: COMPLETED

```typescript
interface WorkflowSelfImproveTransportParity {
  readonly localCliUsesCoreService: boolean;
  readonly endpointCliUsesGraphql: boolean;
  readonly endpointLibraryUsesGraphql: boolean;
  readonly commandApiOverridePropagation: boolean;
  readonly serverModeGuardrails: readonly string[];
}
```

**Checklist**:

- [x] Normalize CLI, GraphQL, and library entrypoints to the same core service input and output shape.
- [x] Verify `src/lib.ts`, `packages/divedra-core/src/index.ts`, and `packages/divedra/src/index.ts` export the public self-improve execution, report lookup, and report listing APIs with aligned types.
- [x] Propagate command/API override inputs through `packages/divedra/src/cli/argument-parser.ts`, `packages/divedra/src/cli/workflow-command-handler.ts`, `packages/divedra-graphql/src/schema-contract.ts`, `packages/divedra-graphql/src/dto.ts`, `src/graphql/schema/execution-resolvers.ts`, and `src/lib.ts`.
- [x] Use typed GraphQL self-improve mutation/query contracts for endpoint-backed CLI and library calls.
- [x] Reject self-improve execution under `serve --read-only` and `serve --no-exec`.
- [x] Allow report read/list behavior only where server mode allows safe reads.
- [x] Add or update tests in `src/cli.test.ts`, `src/lib-api.test.ts`, `src/graphql/schema.test.ts`, and `src/server/graphql-queries-and-inspection.test.ts`.

### 6. Documentation, Indexes, and Final Verification

#### `README.md`, `impl-plans/README.md`, `impl-plans/PROGRESS.json`

**Status**: COMPLETED

```typescript
interface WorkflowSelfImproveDocumentationCoverage {
  readonly cliDocumented: boolean;
  readonly graphqlDocumented: boolean;
  readonly libraryDocumented: boolean;
  readonly autoImproveBoundaryDocumented: boolean;
}
```

**Checklist**:

- [x] Document corrected CLI, GraphQL, library, backup, git, and server-mode behavior.
- [x] Keep self-improve wording distinct from supervisor and `workflow run --auto-improve`.
- [x] Update plan progress and completion criteria after implementation.
- [x] Run focused tests plus full typecheck, lint, build, and diff checks.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Gap audit and tracking | `impl-plans/active/self-improve-review-hardening.md` | COMPLETED | `git diff --check` |
| Core validation and source selection | `src/workflow/self-improve/config.ts`, `source-selection.ts`, `marker-store.ts`, `service.ts` | COMPLETED | `src/workflow/self-improve/config.test.ts`, `source-selection.test.ts`, `service.test.ts` |
| Run evidence and reports | `src/workflow/self-improve/analyzer.ts`, `report.ts`, `types.ts`, `service.ts` | COMPLETED | `src/workflow/self-improve/service.test.ts` |
| Backup, patch, and git safety | `src/workflow/self-improve/backup.ts`, `patcher.ts`, `git.ts` | COMPLETED | `src/workflow/self-improve/patcher.test.ts`, `backup-git.test.ts` |
| Transport and server parity | `src/lib.ts`, `packages/divedra-core/src/index.ts`, `packages/divedra/src/**/*.ts`, `packages/divedra-graphql/src/*.ts`, `src/graphql/**/*.ts`, `src/server/**/*.ts` | COMPLETED | `src/cli.test.ts`, `src/lib-api.test.ts`, `src/graphql/schema.test.ts`, `src/server/graphql-queries-and-inspection.test.ts` |
| Documentation and verification | `README.md`, `impl-plans/README.md`, `impl-plans/PROGRESS.json` | COMPLETED | `bun run typecheck`, `bun run lint:biome`, `bun run build`, `git diff --check` |

## Task Breakdown

### TASK-001: Audit Current Self-Improve Against Accepted Gates

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `impl-plans/active/self-improve-review-hardening.md`
**Dependencies**: None

**Description**:
Inspect existing code, tests, and docs against `design-docs/specs/design-self-improve.md#issue-resolution-hardening-criteria`; record concrete gaps, severity, and task ownership before implementation.

**Completion Criteria**:

- [x] Every hardening criterion has been checked against current code/tests/docs.
- [x] Any high or mid gap is mapped to TASK-002 through TASK-006.
- [x] Progress Log records findings and intended remediation.

### TASK-002: Harden Validation, Policy, Source Selection, and Markers

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/self-improve/config.ts`, `src/workflow/self-improve/source-selection.ts`, `src/workflow/self-improve/marker-store.ts`, `src/workflow/self-improve/service.ts`, `src/workflow/self-improve/config.test.ts`, `src/workflow/self-improve/source-selection.test.ts`, `src/workflow/self-improve/service.test.ts`
**Dependencies**: TASK-001

**Description**:
Close gaps in public input validation, command/API override normalization, disabled-workflow override behavior, explicit session workflow identity checks, since-last marker semantics, and marker advancement rules.

**Completion Criteria**:

- [x] Invalid mode, source mode, limit, explicit sessions, and command/API overrides fail before side effects.
- [x] Valid command/API overrides normalize into the core self-improve service input consistently across local and remote entrypoints.
- [x] Existing markers prevent old-run fallback when no newer runs exist.
- [x] Failed, reverted, or rejected executions do not write successful markers.
- [x] Focused tests cover each corrected path.

### TASK-003: Harden Evidence Capture and Report-Only Behavior

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/self-improve/analyzer.ts`, `src/workflow/self-improve/report.ts`, `src/workflow/self-improve/service.ts`, `src/workflow/self-improve/types.ts`, `src/workflow/self-improve/service.test.ts`
**Dependencies**: TASK-001, TASK-002

**Description**:
Ensure selected run evidence, purpose judgments, report schema, and report-only side-effect limits satisfy the accepted design.

**Completion Criteria**:

- [x] Reports include concrete workflow, node, and output-validation evidence.
- [x] Purpose achievement uses `unknown` when evidence is insufficient.
- [x] Report-only mode has no backup, patch, or git side effects.
- [x] Report schema remains provider-neutral.

### TASK-004: Harden Backup, Patch, Prompt File, and Git Mutation Safety

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/workflow/self-improve/backup.ts`, `src/workflow/self-improve/patcher.ts`, `src/workflow/self-improve/git.ts`, `src/workflow/self-improve/patcher.test.ts`, `src/workflow/self-improve/backup-git.test.ts`
**Dependencies**: TASK-001

**Description**:
Verify and correct backup-before-write, rollback, prompt file patching, and git staging/commit boundaries.

**Completion Criteria**:

- [x] Backups are created before canonical workflow writes.
- [x] Validation failure and patch-time exceptions restore from backup and preserve `.git`.
- [x] `promptTemplateFile` workflows patch prompt files directly.
- [x] Git staging includes only files changed by this execution and never pushes.
- [x] Commit messages contain no automated-assistant attribution.

### TASK-005: Harden Transport, API, and Server Guardrail Parity

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/lib.ts`, `packages/divedra-core/src/index.ts`, `packages/divedra/src/cli/argument-parser.ts`, `packages/divedra/src/cli/workflow-command-handler.ts`, `packages/divedra/src/index.ts`, `packages/divedra-graphql/src/schema-contract.ts`, `packages/divedra-graphql/src/dto.ts`, `src/graphql/schema/execution-resolvers.ts`, `src/graphql/types.ts`, `src/server/graphql-executable-schema.ts`, `src/cli.test.ts`, `src/lib-api.test.ts`, `src/graphql/schema.test.ts`, `src/server/graphql-queries-and-inspection.test.ts`
**Dependencies**: TASK-002, TASK-003

**Description**:
Ensure CLI, library, GraphQL, and server paths share typed contracts and enforce read-only/no-exec guardrails consistently.

**Completion Criteria**:

- [x] Local CLI and local library execution normalize through the same core service input.
- [x] `src/lib.ts`, `packages/divedra-core/src/index.ts`, and `packages/divedra/src/index.ts` expose aligned public self-improve APIs and types.
- [x] Command/API override inputs are parsed, typed, transported, and propagated to the core service through CLI, GraphQL, library, and server paths.
- [x] Endpoint-backed CLI and library calls use typed GraphQL self-improve operations.
- [x] `serve --read-only` and `serve --no-exec` reject execution.
- [x] Report read/list tests prove safe read behavior.
- [x] DTO changes preserve CLI/library/GraphQL output parity.

### TASK-006: Refresh Documentation, Progress, and Verification

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `README.md`, `impl-plans/README.md`, `impl-plans/PROGRESS.json`, `impl-plans/active/self-improve-review-hardening.md`
**Dependencies**: TASK-002, TASK-003, TASK-004, TASK-005

**Description**:
Update user-facing documentation and implementation tracking after the code hardening pass, then run focused and broad verification.

**Completion Criteria**:

- [x] README covers CLI, GraphQL, library, backup, git, and server-mode semantics.
- [x] Documentation keeps self-improve distinct from supervisor and auto-improve.
- [x] Plan progress log is updated with completed tasks and verification results.
- [x] All verification commands pass or failures are documented with cause.

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Audit | None | COMPLETED |
| Validation/source/markers | TASK-001 | COMPLETED |
| Evidence/report-only | TASK-001, TASK-002 | COMPLETED |
| Backup/patch/git | TASK-001 | COMPLETED |
| Transport/server parity | TASK-002, TASK-003 | COMPLETED |
| Docs/verification | TASK-002, TASK-003, TASK-004, TASK-005 | COMPLETED |

## Parallelization Notes

- TASK-004 is parallelizable after TASK-001 because it owns backup, patcher, git, and focused mutation-safety tests.
- TASK-002 and TASK-003 are not parallelizable with each other because both can touch `src/workflow/self-improve/service.ts`.
- TASK-005 waits for core input/report shape stability from TASK-002 and TASK-003.
- TASK-006 waits for all implementation tasks because it records final user-facing behavior and verification.

## Verification Plan

- `bun test src/workflow/self-improve/config.test.ts src/workflow/self-improve/source-selection.test.ts src/workflow/self-improve/service.test.ts`
- `bun test src/workflow/self-improve/patcher.test.ts src/workflow/self-improve/backup-git.test.ts`
- `bun test src/lib-api.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql-queries-and-inspection.test.ts`
- `bun run typecheck`
- `bun run lint:biome`
- `bun run build`
- `git diff --check`
- `jq '.' impl-plans/PROGRESS.json >/dev/null`

## Completion Criteria

- [x] Step 3 accepted design references are reflected in concrete implementation tasks.
- [x] All high and mid gaps found during TASK-001 are addressed.
- [x] CLI, library, GraphQL, and server behavior remain equivalent over the provider-neutral core service.
- [x] Command/API override validation and propagation across CLI, GraphQL, library, and server paths has regression coverage.
- [x] Source selection, marker, report, backup, patch, git, and server-mode safety gates have regression tests.
- [x] Documentation and progress tracking are refreshed.
- [x] Verification commands pass or are recorded as blocked with exact causes.

## Progress Log

### Session: 2026-05-18 21:52

**Tasks Completed**: Implementation plan created after Step 3 accepted the design.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Plan intentionally treats the existing completed `impl-plans/active/self-improve.md` as historical implementation context and creates a focused review-hardening plan for the current issue-resolution workflow.
**Verification**: `git diff --check -- impl-plans/active/self-improve-review-hardening.md impl-plans/README.md impl-plans/PROGRESS.json`.

### Session: 2026-05-18 22:00

**Tasks Completed**: Step 5 plan-review feedback addressed.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added `src/lib.ts` and `packages/divedra-core/src/index.ts` to TASK-005 module and deliverable scope, and added explicit public library/core export parity completion criteria while keeping `src/lib-api.test.ts` in the verification plan.
**Verification**: `git diff --check -- impl-plans/active/self-improve-review-hardening.md impl-plans/README.md impl-plans/PROGRESS.json`; `git diff --no-index --check /dev/null impl-plans/active/self-improve-review-hardening.md`; `jq '.' impl-plans/PROGRESS.json >/dev/null`.

### Session: 2026-05-18 22:10

**Tasks Completed**: Second Step 5 plan-review feedback addressed.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added explicit command/API override validation, normalization, transport propagation, and regression-test expectations to TASK-002 and TASK-005. Named the CLI, GraphQL, resolver, and library files that must carry override inputs.
**Verification**: `git diff --check -- impl-plans/active/self-improve-review-hardening.md impl-plans/README.md impl-plans/PROGRESS.json`; `git diff --no-index --check /dev/null impl-plans/active/self-improve-review-hardening.md`; `jq '.' impl-plans/PROGRESS.json >/dev/null`; `rg -n "command/API override|commandApiOverride|argument-parser|schema-contract|execution-resolvers|src/lib.ts" impl-plans/active/self-improve-review-hardening.md`.

### Session: 2026-05-18 22:55

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006.
**Tasks In Progress**: None.
**Blockers**: None.
**Audit Findings**:

- High: `src/workflow/self-improve/service.ts` could attempt git commit handling and write the since-last marker even after a reverted or failed patch result. Remediated in TASK-002 and TASK-004 by committing only `applied` patches and advancing markers only for successful self-improve completion.
- Mid: Public command/API override validation for `workflowName`, `mode`, `sourceMode`, `limit`, and explicit session ids was scattered across policy/source-selection code instead of normalized before report, backup, patch, marker, or git side effects. Remediated in TASK-002 by adding `validateWorkflowSelfImprovePublicInput` and pre-load service validation.
- Mid: Endpoint-backed CLI and library GraphQL self-improve result selections omitted source-run node execution and output-validation evidence, creating output-shape drift from the core report evidence. Remediated in TASK-003 and TASK-005 by requesting nested `nodeExecutions` evidence through both typed GraphQL transport paths.
- Low: Backup restore behavior preserved `.git`, but regression coverage did not prove repository metadata stayed outside backups and survived rollback. Remediated in TASK-004 with focused patcher coverage.

**Notes**: No codex-agent implementation code was copied. Codex-agent references remained structural only for discovery/report facade patterns. Existing README self-improve documentation already covered CLI, GraphQL, library, backup, git, and server-mode semantics, so TASK-006 refreshed plan tracking rather than changing README.
**Verification**: `bun test src/workflow/self-improve/config.test.ts src/workflow/self-improve/source-selection.test.ts src/workflow/self-improve/service.test.ts src/workflow/self-improve/patcher.test.ts src/workflow/self-improve/backup-git.test.ts`; `bun test src/lib-api.test.ts src/cli.test.ts src/graphql/schema.test.ts src/server/graphql-queries-and-inspection.test.ts`; `bun run typecheck`; `bun run build`; `bunx biome check src/workflow/self-improve/config.ts src/workflow/self-improve/service.ts src/workflow/self-improve/index.ts src/workflow/self-improve/config.test.ts src/workflow/self-improve/service.test.ts src/workflow/self-improve/patcher.test.ts packages/divedra/src/cli/workflow-command-handler.ts packages/divedra/src/index.ts src/cli.test.ts src/lib-api.test.ts src/graphql/schema.test.ts --diagnostic-level=warn`; `git diff --check`; `jq '.' impl-plans/PROGRESS.json >/dev/null`.
**Verification Exception**: `bun run lint:biome` remains blocked by pre-existing unrelated `noExplicitAny` warnings in `src/workflow/engine/node-execution.ts`, `src/workflow/engine/node-output-attempts.ts`, `src/workflow/engine/run-setup.ts`, and `src/workflow/engine/session-entry.ts`; touched-file Biome passed.

## Related Plans

- **Previous**: `impl-plans/active/self-improve.md`
- **Depends On**: `design-docs/specs/design-self-improve.md#issue-resolution-hardening-criteria`
