# SQLite Message Store Regression Repair Review Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-sqlite-message-store.md#regression-repair-review-addendum; design-docs/specs/design-workflow-node-executability-validation.md#installed-codex-cli-compatibility
**Created**: 2026-06-07
**Last Updated**: 2026-06-07

---

## Design Document Reference

**Sources**:

- `design-docs/specs/design-sqlite-message-store.md`
- `design-docs/specs/design-workflow-node-executability-validation.md`

### Summary

Adversarially review and improve the current `feature/sqlite-message-store`
repair after commit `b6bcfde8579a89328dd8bdd28d22e011be752978`, including the
local Codex readiness compatibility fix for installed `codex-cli 0.137.0`.
Implementation must preserve SQLite-only communication semantics, runtime DB
placement, process I/O diagnostics, and adapter smoke-test behavior while
removing obsolete Codex `--ask-for-approval` probe usage.

### Scope

**Included**:

- Review local changes after `b6bcfde8579a89328dd8bdd28d22e011be752978`.
- Preserve SQLite-backed `workflow_messages` as the canonical message store.
- Verify `artifactRoot` and `sessionStoreRoot` default database co-location
  inference when `rootDataDir` and `RIEL_RUNTIME_DB` are absent.
- Verify readiness subprocess stdout/stderr capture through temporary files
  across nonzero exit, spawn error, and timeout paths.
- Verify installed Codex CLI compatibility: `codex exec --model <model>
  --skip-git-repo-check --sandbox read-only <prompt>`.
- Verify fake Codex tests reject obsolete `--ask-for-approval` and missing
  `--sandbox read-only`.
- Preserve Cursor-specific behavior behind Cursor adapter boundaries.
- Run deterministic full-suite verification.

**Excluded**:

- Backward compatibility with legacy per-communication message files or session
  communication arrays.
- Storing file or binary message bodies in SQLite.
- New Cursor schema, mode, or auth behavior.
- Persisting credential-bearing probe output in logs, fixtures, artifacts, or
  user-facing documentation.

---

## Issue And Reference Traceability

- Workflow mode: `issue-resolution`
- Workflow ID: `codex-design-and-implement-review-loop`
- Node: `step4-impl-plan-create`
- Issue reference: `tacogips/rielflow`, title
  `Review and improve SQLite message-store regression repair`; no issue URL or
  issue number provided.
- Branch: `feature/sqlite-message-store`
- Commit under review:
  `b6bcfde8579a89328dd8bdd28d22e011be752978`
- Review mode: `adversarial`
- Risk level: `high`
- Accepted design review: Step 3, `needs_revision: false`, `accepted: true`

Codex-agent references:

- `branch feature/sqlite-message-store`
- `commit b6bcfde Fix sqlite test regressions and process IO capture`
- `../../codex-agent` unavailable locally
- installed `codex-cli 0.137.0` accepts `--sandbox read-only` and rejects
  removed `--ask-for-approval`
- prior reported verification: `bun run test`, `bun run typecheck`,
  `bun run lint:biome`

Intentional divergences accepted in the design:

- Rielflow uses the installed Codex CLI directly for readiness when the local
  `codex-agent` reference checkout is unavailable.
- Rielflow intentionally removes `--ask-for-approval never` from Codex model
  probes and uses `--sandbox read-only`.
- No backward compatibility is preserved for legacy message read fallback.
- Cursor behavior remains isolated and unchanged.

---

## Task Breakdown

### TASK-001: Branch Diff And Finding Record

**Status**: COMPLETED
**Parallelizable**: false

Files:

- `impl-plans/active/sqlite-message-store-regression-repair-review.md`
- current local diff on `feature/sqlite-message-store`

```typescript
type RegressionRepairSeverity = "high" | "mid" | "low" | "none";

interface RegressionRepairFinding {
  readonly severity: RegressionRepairSeverity;
  readonly filePath: string;
  readonly line?: number;
  readonly issue: string;
  readonly impact: string;
  readonly recommendedAction: string;
}

interface RegressionRepairReviewDecision {
  readonly workflowMode: "issue-resolution";
  readonly branch: "feature/sqlite-message-store";
  readonly baseCommit: "b6bcfde8579a89328dd8bdd28d22e011be752978";
  readonly implementationRequired: boolean;
  readonly findings: readonly RegressionRepairFinding[];
}
```

Deliverables:

- Inspect `git diff b6bcfde8579a89328dd8bdd28d22e011be752978...HEAD` and
  unstaged local changes.
- Record any high, mid, or low finding in the progress log before fixes.
- Keep unrelated dirty worktree changes intact.

Verification:

- `git status --short --branch`
- `git diff --name-only b6bcfde8579a89328dd8bdd28d22e011be752978...HEAD`
- `git diff --check`

### TASK-002: SQLite Store And Runtime DB Placement Review

**Status**: COMPLETED
**Parallelizable**: false
**Depends On**: TASK-001

Files:

- `packages/rielflow/src/workflow/runtime-db/schema-and-record-types.ts`
- `packages/rielflow/src/workflow/runtime-db/workflow-message-records.ts`
- `packages/rielflow/src/workflow/runtime-db/session-query-records.ts`
- `packages/rielflow/src/workflow/communication-service.ts`
- focused runtime DB and communication tests

```typescript
interface SqliteRegressionRepairExpectation {
  readonly sqliteOnlyCommunicationReads: true;
  readonly noLegacyMessageFileFallback: true;
  readonly noSessionArrayFallback: true;
  readonly jsonValidityConstraintsPreserved: true;
  readonly runtimeDbEnvOverrideWins: true;
  readonly artifactRootCanInferDefaultDbPath: true;
  readonly sessionStoreRootCanInferDefaultDbPath: true;
}
```

Deliverables:

- Verify full-suite repairs did not restore legacy message-file or
  session-array communication reads.
- Verify JSON validity checks on runtime JSON text columns were not weakened.
- Verify explicit `artifactRoot` and `sessionStoreRoot` infer the default DB
  path only when `rootDataDir` and `RIEL_RUNTIME_DB` are absent.
- Add focused tests or fixes only where the review finds gaps.

Verification:

- `bun test packages/rielflow/src/workflow/runtime-db.test.ts`
- `bun test packages/rielflow/src/workflow/communication-service.test.ts`
- `bun test packages/rielflow/src/workflow/runtime-db.test.ts -t "runtime database placement|artifactRoot|sessionStoreRoot|RIEL_RUNTIME_DB|json column constraints"`

### TASK-003: Process I/O Capture And Readiness Probe Review

**Status**: COMPLETED
**Parallelizable**: false
**Depends On**: TASK-001

Files:

- `packages/rielflow-adapters/src/readiness.ts`
- `packages/rielflow/src/workflow/runtime-readiness-agent-probes.ts`
- `packages/rielflow/src/workflow/runtime-readiness.ts`
- readiness and adapter tests

```typescript
interface ProbeIoCaptureExpectation {
  readonly stdoutCapturedFromUniqueTempFile: true;
  readonly stderrCapturedFromUniqueTempFile: true;
  readonly logsReadAfterCloseErrorOrTimeout: true;
  readonly tempDirectoryRemovedAfterRead: true;
  readonly timeoutTerminatesChild: true;
  readonly capturedLogsAreDiagnosticsOnly: true;
}
```

Deliverables:

- Verify subprocess helper behavior for nonzero exit, spawn error, and timeout.
- Verify captured stdout/stderr are included in failure parsing without
  persisting credential-bearing diagnostics.
- Preserve deterministic diagnostics when child pipe events race with process
  exit.
- Add focused coverage if an I/O path lacks assertions.

Verification:

- `bun test packages/rielflow/src/workflow/adapters/readiness.test.ts`
- `bun test packages/rielflow/src/workflow/runtime-readiness-backends.test.ts`
- `bun test packages/rielflow/src/workflow/runtime-readiness.test.ts`

### TASK-004: Codex CLI 0.137.0 Compatibility Fix Review

**Status**: COMPLETED
**Parallelizable**: false
**Depends On**: TASK-003

Files:

- `packages/rielflow-adapters/src/readiness.ts`
- `packages/rielflow/src/workflow/adapters/readiness.test.ts`

```typescript
interface CodexCliReadinessExpectation {
  readonly authProbe: "codex login status";
  readonly modelProbeArgv: readonly [
    "exec",
    "--model",
    string,
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    string,
  ];
  readonly obsoleteApprovalFlagForbidden: true;
  readonly modelDiagnosticJsonPreserved: true;
}
```

Deliverables:

- Keep `codex login status` before model reachability.
- Keep model probe argv on `--sandbox read-only`.
- Ensure no readiness code still passes `--ask-for-approval`.
- Ensure fake Codex tests fail when obsolete flags appear or sandbox is absent.
- Preserve `ERROR: {...}` JSON diagnostics after progress text.

Verification:

- `rg -n -- "--ask-for-approval|--sandbox|codex login status|codex exec" packages/rielflow-adapters/src/readiness.ts packages/rielflow/src/workflow/adapters/readiness.test.ts packages/rielflow/src/workflow/runtime-readiness-agent-probes.ts`
- `bun test packages/rielflow/src/workflow/adapters/readiness.test.ts -t "codex"`
- `codex --version`

### TASK-005: Adapter Live Smoke And Full Verification

**Status**: COMPLETED
**Parallelizable**: false
**Depends On**: TASK-002, TASK-003, TASK-004

Files:

- adapter live-smoke tests
- repository verification outputs
- progress log in this plan

```typescript
interface RegressionRepairVerificationResult {
  readonly testsPass: boolean;
  readonly typecheckPasses: boolean;
  readonly biomePasses: boolean;
  readonly liveSmokeCredentialsRequired: boolean;
  readonly credentialMaterialPublished: false;
  readonly reviewFindingsResolved: boolean;
}
```

Deliverables:

- Run deterministic repository verification.
- Run credential-gated live smoke tests only when credentials are already
  configured, and record skipped status explicitly when not available.
- Confirm no high or mid findings remain before handoff.
- Update the progress log with commands, outcomes, and residual low risks.

Verification:

- `bun run test`
- `bun run typecheck`
- `bun run lint:biome`
- credential-gated adapter smoke command(s), only when required environment is
  present

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Review and finding record | `impl-plans/completed/sqlite-message-store-regression-repair-review.md` | COMPLETED | `git diff --check` |
| SQLite runtime store | `packages/rielflow/src/workflow/runtime-db/*.ts`; `packages/rielflow/src/workflow/communication-service.ts` | COMPLETED | runtime DB and communication tests |
| Probe I/O capture | `packages/rielflow-adapters/src/readiness.ts`; `packages/rielflow/src/workflow/runtime-readiness-agent-probes.ts` | COMPLETED | readiness tests |
| Codex CLI compatibility | `packages/rielflow-adapters/src/readiness.ts`; `packages/rielflow/src/workflow/adapters/readiness.test.ts` | COMPLETED | Codex readiness tests |
| Full verification | repository test, typecheck, and Biome surfaces | COMPLETED | full-suite commands |

## Dependencies

| Task | Depends On | Status |
|------|------------|--------|
| TASK-001 Branch Diff And Finding Record | Step 3 accepted design | COMPLETED |
| TASK-002 SQLite Store And Runtime DB Placement Review | TASK-001 | COMPLETED |
| TASK-003 Process I/O Capture And Readiness Probe Review | TASK-001 | COMPLETED |
| TASK-004 Codex CLI 0.137.0 Compatibility Fix Review | TASK-003 | COMPLETED |
| TASK-005 Adapter Live Smoke And Full Verification | TASK-002, TASK-003, TASK-004 | COMPLETED |

## Parallelization

No implementation tasks are marked parallelizable. The write scopes overlap
across runtime readiness, adapter readiness tests, and high-risk SQLite
regression verification; a single sequential path avoids conflicting fixes and
keeps adversarial finding resolution traceable.

## Verification Plan

Required commands:

```bash
git status --short --branch
git diff --check
rg -n -- "--ask-for-approval|--sandbox read-only|codex-cli 0.137.0|runtime database placement|artifactRoot|sessionStoreRoot" design-docs/specs/design-sqlite-message-store.md design-docs/specs/design-workflow-node-executability-validation.md packages/rielflow-adapters/src/readiness.ts packages/rielflow/src/workflow/adapters/readiness.test.ts
bun test packages/rielflow/src/workflow/adapters/readiness.test.ts
bun test packages/rielflow/src/workflow/runtime-db.test.ts
bun test packages/rielflow/src/workflow/communication-service.test.ts
bun run test
bun run typecheck
bun run lint:biome
codex --version
```

Credential-gated smoke tests must be recorded as passed or skipped with the
missing credential reason. Do not publish tokens, private chat content, or raw
credential-bearing process logs.

## Completion Criteria

- [x] All high and mid adversarial findings are fixed or proven absent.
- [x] SQLite communication reads remain backed by `workflow_messages` only.
- [x] JSON validity checks are not weakened.
- [x] Runtime DB placement honors `RIEL_RUNTIME_DB`, `artifactRoot`, and
      `sessionStoreRoot` precedence described in the design.
- [x] Readiness stdout/stderr capture remains deterministic across nonzero
      exit, spawn error, and timeout.
- [x] Codex readiness uses `--sandbox read-only` and no code path passes
      `--ask-for-approval`.
- [x] Cursor behavior remains unchanged and adapter-isolated.
- [x] `bun run test`, `bun run typecheck`, and `bun run lint:biome` pass.
- [x] Progress log records review findings, fixes, verification commands, and
      skipped live-smoke reasons.

## Progress Log Expectations

Each implementation session must append:

- reviewed diff range and files
- findings by severity, including `none` when applicable
- fixes applied, grouped by task id
- verification commands run and their pass/fail/skipped outcome
- residual low risks or explicit "none"

## Progress Log

### Session: 2026-06-07 Step 4 Plan Creation

**Tasks Completed**: Created active implementation plan from accepted Step 3
design review.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Step 3 reported no high or mid design findings. Later
implementation must still adversarially verify no SQLite fallback, no weakened
JSON checks, no lost process diagnostics, and no obsolete `--ask-for-approval`
usage.

### Session: 2026-06-07 Review And Implementation

**Tasks Completed**: TASK-001 through TASK-005.
**Reviewed Diff Range**:
`b6bcfde8579a89328dd8bdd28d22e011be752978..feature/sqlite-message-store`
plus local Codex readiness compatibility changes.
**Findings**:

- High: none.
- Mid: none.
- Low: workflow package execution unexpectedly produced mock-scenario output
  during the review run, so final acceptance relied on direct diff review and
  deterministic repository verification rather than trusting that mock output.

**Fixes Applied**:

- TASK-004: Replaced Codex model readiness probe argv from removed
  `--ask-for-approval never` to `--sandbox read-only`.
- TASK-004: Hardened the fake Codex readiness test to fail if the obsolete
  approval flag is passed or if `--sandbox read-only` is absent.
- TASK-001/TASK-003/TASK-004: Documented the regression repair review boundary,
  process I/O capture expectations, and installed Codex CLI 0.137.0
  compatibility behavior.

**Verification**:

- `bun run packages/rielflow/src/bin.ts workflow validate codex-design-and-implement-review-loop --workflow-definition-dir $HOME/.rielflow/workflows --executable`: pass.
- `codex exec --model gpt-5.5 --skip-git-repo-check --sandbox read-only --ignore-rules "Reply with ok."`: pass.
- `bun test packages/rielflow/src/workflow/adapters/readiness.test.ts`: pass.
- `bun run typecheck`: pass.
- `bun run lint:biome`: pass.
- `bun run test`: pass, 1580 pass, 6 skip, 0 fail.

**Live Smoke Status**: Official SDK and CLI-agent live smoke tests remain
explicit opt-in and were skipped in the deterministic full suite. No credential
values or private chat content were published.
**Residual Risks**: Low: the packaged review workflow run itself should be
investigated separately because the observed node execution rows used
`scenario-mock` output despite not passing `--mock-scenario`.

## Related Plans

- **Previous**: `impl-plans/completed/sqlite-message-store.md`
- **Related**: `impl-plans/completed/sqlite-runtime-json-checks.md`
- **Related**: `impl-plans/completed/workflow-node-executability-validation.md`
