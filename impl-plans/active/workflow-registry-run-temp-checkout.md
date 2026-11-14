# Workflow Registry Run Temporary Checkout Implementation Plan

**Status**: In Progress
**Design Reference**: `design-docs/specs/command.md#command-surface`, `design-docs/specs/design-workflow-package-checkout.md#temporary-registry-run-checkout`, `design-docs/specs/design-workflow-package-registry.md#temporary-run-integration`
**Created**: 2026-05-28
**Last Updated**: 2026-05-29

## Design Reference

Issue-resolution plan for workflow
`codex-design-and-implement-review-loop`, Step 4
`step4-impl-plan-create`.

Accepted design sources:

- `design-docs/specs/command.md`
- `design-docs/specs/design-workflow-package-checkout.md#temporary-registry-run-checkout`
- `design-docs/specs/design-workflow-package-registry.md#temporary-run-integration`
- `design-docs/user-qa/qa-workflow-package-checkout.md`

Step 3 accepted the revised design with no remaining high or mid findings.
The implementation extends `workflow run --from-registry <target>` from
package ids only to three explicit online target forms:

- existing registry package ids, preserving current behavior;
- GitHub workflow directory URLs, including tree URLs and branchless directory
  URLs;
- registered shorthand values written as `<registry-owner>/<workflow-dir>`.

## Scope

Included:

- Preserve current `workflow run <package-id> --from-registry` behavior.
- Accept GitHub tree URLs like
  `https://github.com/<owner>/<repo>/tree/<ref>/<workflow-dir>`.
- Accept branchless GitHub directory URLs like
  `https://github.com/<owner>/<repo>/<workflow-dir>`.
- Resolve branchless URL refs by `--branch`, then matching registered registry
  default branch, then GitHub repository default branch metadata, otherwise
  usage error before staging.
- Resolve shorthand only through configured registries, narrowed by
  `--registry` when supplied, and fail on missing or ambiguous matches.
- Allow raw GitHub directory URLs without `rielflow-package.json` only after
  workflow-bundle validation and with reduced provenance.
- Keep package-backed metadata validation, checksum/integrity validation,
  provenance, and cleanup behavior.
- Keep `--from-registry` local-only and reject `--endpoint` before staging.
- Preserve retained temporary checkout cleanup for local `session resume` and
  `session continue`.
- Refresh tests, README, and `.agents/skills/rielflow-workflow-run/SKILL.md`.

Excluded:

- Bare `workflow run <name>` remote fetching.
- Remote GraphQL registry temporary run starts.
- Persistent install/catalog mutation for temporary runs.
- Package skill installation or vendor projection for temporary runs.
- Cursor CLI behavior or codex-agent backend behavior changes.

## Codex Agent References

- Workflow ID: `codex-design-and-implement-review-loop`
- Workflow mode: `issue-resolution`
- Node ID: `step4-impl-plan-create`
- Worker backend reference: `codex-agent`
- `AGENTS.md`
- `packages/rielflow/src/workflow/adapters/codex.ts`
- `../../codex-agent` unavailable per Step 1 and Step 3; no external
  codex-agent behavior is imported.

Intentional divergence: codex-agent remains only an execution backend string.
This plan changes rielflow CLI/package-resolution behavior before the existing
local workflow execution path starts.

## Issue Reference

- Source: `workflowInput`
- Title: `Support running online registry workflows by GitHub directory URL or registered shorthand`
- Issue URL: none supplied
- Issue repository/number: none supplied

## Modules And Contracts

### `packages/rielflow/src/cli/workflow-run-command.ts`

Expected contract:

```typescript
type RegistryRunTargetKind =
  | "package-id"
  | "github-directory-url"
  | "registered-shorthand";

interface RegistryBackedWorkflowRunContext {
  readonly targetKind: RegistryRunTargetKind;
  readonly workflowName: string;
  readonly workflowDefinitionDir: string;
  readonly provenance: WorkflowRegistryRunSourceOutput;
  readonly cleanup: () => Promise<RegistryRunCleanupOutput>;
}
```

### `packages/rielflow/src/workflow/packages/temp-run.ts`

Expected contract:

```typescript
interface TemporaryRegistryRunCheckoutInput {
  readonly target: string;
  readonly registry?: string;
  readonly branch?: string;
  readonly registryConfigRoot?: string;
  readonly fetchImpl?: typeof fetch;
}

interface TemporaryRegistryRunCheckoutResult {
  readonly targetKind: RegistryRunTargetKind;
  readonly workflowName: string;
  readonly workflowDefinitionDir: string;
  readonly temporaryWorkflowDirectory: string;
  readonly provenance: WorkflowRegistryRunSourceOutput;
  cleanup(): Promise<RegistryRunCleanupOutput>;
}
```

### `packages/rielflow/src/workflow/checkout/github-directory.ts`

Expected contract:

```typescript
interface GitHubDirectoryUrl {
  readonly owner: string;
  readonly repository: string;
  readonly ref: string;
  readonly directoryPath: string;
}

interface BranchlessGitHubDirectoryUrl {
  readonly owner: string;
  readonly repository: string;
  readonly directoryPath: string;
}
```

Implementation may extend existing parsing/fetch helpers or add a small
resolver module if that keeps URL parsing and default-branch lookup isolated.

### `packages/rielflow/src/cli/registry-run-provenance.ts`

Expected contract:

```typescript
interface WorkflowRegistryRunSourceOutput {
  readonly source: "registry";
  readonly originalTarget: string;
  readonly targetKind: RegistryRunTargetKind;
  readonly package?: WorkflowPackageRunProvenance;
  readonly github?: GitHubDirectoryRunProvenance;
  readonly retained?: RetainedRegistryRunProvenance;
  readonly cleanup?: RegistryRunCleanupOutput;
}

interface GitHubDirectoryRunProvenance {
  readonly originalTarget: string;
  readonly owner: string;
  readonly repository: string;
  readonly ref: string;
  readonly directoryPath: string;
  readonly sourceUrl: string;
  readonly sourcePath: string;
  readonly sourceDirectory: string;
  readonly temporaryWorkflowDirectory: string;
  readonly verification: "package-integrity" | "workflow-bundle-only";
}

interface WorkflowPackageRunProvenance {
  readonly originalTarget: string;
  readonly packageId: string;
  readonly workflowName: string;
  readonly registryId: string;
  readonly registryUrl: string;
  readonly registryRef: string;
  readonly sourcePath: string;
  readonly sourceDirectory: string;
  readonly metadataPath: string;
  readonly checksum: string;
  readonly checksumAlgorithm: string;
  readonly integrityVerified: boolean;
  readonly temporaryWorkflowDirectory: string;
}

interface RetainedRegistryRunProvenance {
  readonly sessionId: string;
  readonly retainedForStatus: "paused" | "running" | "waiting";
  readonly temporaryWorkflowDirectory: string;
  readonly retainedProvenancePath: string;
  readonly cleanupOwner: "workflow-run" | "session-resume" | "session-continue";
}
```

## Task Breakdown

### TASK-001: Classify Registry Run Targets

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/cli/workflow-run-command.ts`
- `packages/rielflow/src/workflow/packages/temp-run.ts`
- `packages/rielflow/src/workflow/packages/types.ts`

**Dependencies**: Existing `--from-registry`, `--registry`, and `--branch`
parsing.

**Completion Criteria**:

- [x] Package ids still route through the existing package temporary checkout.
- [x] GitHub URL targets are detected only when `--from-registry` is present.
- [x] Shorthand targets are detected as registry-resolved
      `<registry-owner>/<workflow-dir>` only when `--from-registry` is present.
- [x] Unknown/ambiguous target errors are usage errors before execution.

### TASK-002: Resolve GitHub Directory URL Temporary Checkouts

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/workflow/checkout/github-directory.ts`
- `packages/rielflow/src/workflow/checkout/checkout.test.ts`
- `packages/rielflow/src/workflow/packages/temp-run.ts`

**Dependencies**: TASK-001 target classification.

**Completion Criteria**:

- [x] Tree URLs preserve explicit refs and directory paths.
- [x] Branchless URLs resolve refs by `--branch`, matching registered registry
      default branch, GitHub repository default branch metadata, or fail before
      staging.
- [x] Fetch failures and unresolved default branches produce actionable errors.
- [x] Raw URL checkouts validate the staged workflow bundle.
- [x] Raw URL checkouts without package metadata produce reduced provenance.

### TASK-003: Resolve Registered Shorthand Through Registries

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/workflow/packages/search.ts`
- `packages/rielflow/src/workflow/packages/registry-config.ts`
- `packages/rielflow/src/workflow/packages/temp-run.ts`
- `packages/rielflow/src/workflow/packages/packages.test.ts`

**Dependencies**: TASK-001 target classification.

**Completion Criteria**:

- [x] Shorthand searches configured registries and honors `--registry`.
- [x] Matching considers package name, workflow id, and terminal source path
      segment as accepted by the design.
- [x] Missing matches fail with no checkout staging.
- [x] Multiple matches fail with candidates listed.
- [x] Successful shorthand runs use package-backed checksum/integrity
      validation and package provenance.

### TASK-004: Preserve Run Integration, Provenance, And Cleanup

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/cli/workflow-run-command.ts`
- `packages/rielflow/src/cli/registry-run-provenance.ts`
- `packages/rielflow/src/cli/session-command-handler.ts`
- `packages/rielflow/src/cli/storage-and-options.ts`

**Dependencies**: TASK-002 and TASK-003.

**Completion Criteria**:

- [x] `--endpoint` with `--from-registry` remains rejected before network or
      staging work.
- [x] Existing local run options are forwarded unchanged for all target kinds.
- [x] Terminal initial runs clean temporary checkout and report cleanup.
- [x] Non-terminal runs retain temporary checkout and persisted provenance.
- [x] Local `session resume` and `session continue` continue consuming retained
      provenance and cleaning only after terminal resumed/continued results.
- [x] JSON/text output distinguishes package integrity provenance from reduced
      raw GitHub workflow-bundle-only provenance.
- [x] JSON/text output and retained provenance include `originalTarget`,
      registry identity, source path/source directory, checksum algorithm,
      `integrityVerified`, and session-retention cleanup metadata where
      applicable.

### TASK-005: Add CLI And Package Regression Coverage

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/cli.test.ts`
- `packages/rielflow/src/workflow/checkout/checkout.test.ts`
- `packages/rielflow/src/workflow/packages/packages.test.ts`

**Dependencies**: TASK-002, TASK-003, TASK-004.

**Completion Criteria**:

- [x] Package-id behavior remains covered.
- [x] GitHub tree URL temporary run succeeds with fake fetch.
- [x] Branchless URL uses `--branch`, registered default branch, and GitHub
      default branch metadata in separate tests.
- [x] Branchless URL failure occurs before staging when no ref can resolve.
- [x] Registered shorthand success, no-match, and ambiguous-match cases are
      covered.
- [x] Raw URL reduced provenance and package-backed provenance are asserted.
- [x] Output and retained-run provenance assertions cover `originalTarget`,
      `registryId`, `registryUrl`, `sourcePath`, `sourceDirectory`,
      `checksumAlgorithm`, `integrityVerified`, session id, retained path, and
      cleanup owner.
- [x] Endpoint rejection, cleanup retention, resume cleanup, and continue
      cleanup remain covered.
- [x] Tests avoid real network access by injecting fake fetch or local caches.

### TASK-006: Refresh User-Facing Documentation

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**:

- `README.md`
- `.agents/skills/rielflow-workflow-run/SKILL.md`
- `design-docs/user-qa/qa-workflow-package-checkout.md` if examples need QA
  alignment

**Dependencies**: TASK-001 final target grammar and TASK-004 final provenance
field names.

**Completion Criteria**:

- [x] README documents package id, GitHub URL, and shorthand examples.
- [x] README states `--from-registry` is required and `--endpoint` is rejected.
- [x] README states raw GitHub URLs may have reduced provenance.
- [x] Workflow-run skill docs include the new target forms and cleanup
      behavior for operators.
- [x] Documentation keeps codex-agent references unchanged.

## Dependencies

| Task | Depends On | Status |
|------|------------|--------|
| TASK-001 | Existing package-id temporary run implementation | Completed |
| TASK-002 | TASK-001 | Completed |
| TASK-003 | TASK-001 | Completed |
| TASK-004 | TASK-002, TASK-003 | Completed |
| TASK-005 | TASK-002, TASK-003, TASK-004 | Completed |
| TASK-006 | TASK-001, TASK-004 field names | Completed |

## Parallelizable Tasks

- TASK-006 can begin after target grammar/output field names are confirmed
  because its write scope is documentation-only.
- TASK-002 and TASK-003 are conceptually separable but both write
  `packages/rielflow/src/workflow/packages/temp-run.ts`; run them sequentially
  unless one implementation first extracts disjoint helper modules.
- TASK-004 and TASK-005 are sequential because they share CLI output,
  lifecycle, and regression-test surfaces.

## Verification Plan

- `bun test packages/rielflow/src/workflow/checkout/checkout.test.ts packages/rielflow/src/workflow/packages/packages.test.ts packages/rielflow/src/cli.test.ts`
- `bun run packages/rielflow/src/bin.ts workflow run <package-id> --from-registry --registry default --output json`
- `bun run packages/rielflow/src/bin.ts workflow run https://github.com/user/workflow-repo/tree/main/workflow-dir --from-registry --output json`
- `bun run packages/rielflow/src/bin.ts workflow run https://github.com/user/workflow-repo/workflow-dir --from-registry --branch main --output json`
- `bun run packages/rielflow/src/bin.ts workflow run user/workflow-dir --from-registry --registry default --output json`
- `bun run packages/rielflow/src/bin.ts workflow run user/workflow-dir --from-registry --endpoint http://127.0.0.1:43173/graphql`
- `bun run typecheck`
- `bun run lint:biome`
- `git diff --check`

## Completion Criteria

- [x] `workflow run <package-id> --from-registry` remains compatible.
- [x] `workflow run <github-directory-url> --from-registry` stages and runs a
      temporary checkout without installation.
- [x] Branchless GitHub URLs follow the accepted ref-resolution order and fail
      before staging when unresolved.
- [x] `workflow run <registry-owner>/<workflow-dir> --from-registry` resolves
      through configured registries and rejects ambiguity.
- [x] Package-backed runs preserve metadata, checksum/integrity validation,
      provenance, and cleanup behavior.
- [x] Package-backed and retained-run provenance explicitly includes
      `originalTarget`, registry id/url, source path/source directory, checksum
      algorithm, `integrityVerified`, and session-retention cleanup metadata.
- [x] Raw GitHub directory runs validate workflow bundles and report reduced
      provenance.
- [x] `--from-registry --endpoint` remains a local-only usage error.
- [x] Resume/continue cleanup behavior remains correct for retained temporary
      checkouts.
- [x] README, workflow-run skill docs, and tests are updated.
- [x] Typecheck, Biome lint, targeted tests, and `git diff --check` pass.

## Addressed Feedback

- Step 3 accepted the revised design with no remaining high or mid findings.
- Step 4 self-review high finding: the prior on-disk plan was package-id-only
  and did not map to GitHub URL or shorthand targets. This revision replaces it
  with accepted-design coverage for package ids, GitHub URLs, shorthand,
  provenance, endpoint rejection, cleanup, tests, and docs.
- Step 4 self-review high finding: the prior on-disk plan was marked
  `Completed` with completed checkboxes. This revision resets the plan to
  `Ready`, marks implementation tasks `Not Started`, and keeps completion
  criteria unchecked.
- Step 4 self-review mid finding: required test and documentation coverage was
  incomplete. TASK-005 and TASK-006 now name CLI/package/checkout tests,
  README, workflow-run skill docs, and QA alignment.
- Step 5 mid finding: the provenance contract omitted `originalTarget` and
  retained-run provenance fields required by the accepted design. The contract,
  TASK-004 criteria, TASK-005 assertions, and completion criteria now name
  original target, registry id/url, source path/source directory, checksum
  algorithm, integrity verification, session-retention path, and cleanup owner.
- Step 7 mid finding: legacy retained package-id provenance files were no
  longer readable after adding required provenance fields. The reader now
  normalizes the legacy file shape with package-id target kind, `originalTarget`
  from `packageId`, `integrityVerified: true`, and
  `verification: "package-integrity"`, with a resume cleanup regression test.
- Step 7 mid finding: branchless GitHub URL resolution ignored explicit invalid
  `--registry` selectors and fell through to GitHub default-branch metadata.
  The resolver now returns `INVALID_REGISTRY` before any GitHub fetch, with
  regression coverage.
- Step 7 low finding: branchless default-branch failure-before-staging coverage
  was incomplete. Tests now assert malformed GitHub default-branch metadata
  fails before contents fetch and invalid registry selectors fail before any
  fetch.
- Step 2 intentional divergences are preserved: raw GitHub URLs may use reduced
  provenance, shorthand is registry-qualified and ambiguity-rejecting, and no
  Cursor/codex-agent behavior is introduced.

## Risks

- GitHub default-branch metadata lookup can accidentally start staging too
  early unless resolver ordering is explicit.
- Shorthand matching can run the wrong workflow if ambiguity detection misses
  package-name, workflow-id, or terminal-path duplicates.
- Raw URL reduced provenance can be misread as package integrity unless output
  fields are explicit.
- Temporary checkout cleanup can regress resume/continue if new target-kind
  provenance is not compatible with retained registry-run records.
- Fake-fetch tests must cover branchless/default-branch behavior without
  depending on live GitHub availability.

## Progress Log

### Session: 2026-05-29 08:10

**Tasks Completed**: Revised the prior completed package-id temporary run plan
after Step 4 self-review required revision.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Later TypeScript implementation must use repository TypeScript
coding standards and must run check/test verification after TypeScript edits.

### Session: 2026-05-29 08:25

**Tasks Completed**: Addressed Step 5 implementation-plan review feedback by
making original-target, package provenance, and retained-run cleanup metadata
explicit in contracts, TASK-004, TASK-005, and completion criteria.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Accepted design did not require revision; this was a plan
completeness fix.

### Session: 2026-05-29 07:55

**Tasks Completed**: TASK-001 through TASK-006.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented package-id preservation, GitHub directory URL temporary
checkout, branchless ref resolution, registered shorthand resolution,
package-backed and raw-GitHub provenance, retained-run compatibility,
README/workflow-run skill refresh, and targeted regression coverage. Typecheck,
Biome, package/checkout tests, focused CLI registry/resume/continue tests, and
`git diff --check` pass. The broader `cli.test.ts` targeted suite still exposes
an unrelated pre-existing failure in `workflow status and session commands share
direct workflow-definition storage outside project scopes`.

### Session: 2026-05-29 08:03

**Tasks Completed**: Step 7 revision pass for raw GitHub URL correctness.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Addressed Step 7 mid findings by wrapping GitHub default-branch
metadata JSON parsing in a typed fetch failure and by constructing raw GitHub
run provenance from the resolver-selected `fetchGitHubDirectoryToStaging`
result. Added regression coverage for malformed default-branch metadata and
slash-containing tree refs. Typecheck, Biome, package/checkout tests, focused
CLI registry/resume/continue tests, and `git diff --check` pass.

### Session: 2026-05-29 08:08

**Tasks Completed**: Second Step 7 revision pass for package-id compatibility
and branchless URL precedence.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Preserved scoped package ids such as `@scope/name` by classifying
valid package names before shorthand fallback, and changed branchless GitHub URL
resolution to honor explicit `--branch` before consulting registry default
branches. Added regression coverage for scoped package-id temporary runs and
`--branch` precedence over an invalid `--registry`. Typecheck, Biome,
package/checkout tests, focused CLI registry/resume/continue tests, and
`git diff --check` pass.

### Session: 2026-05-29 09:05

**Tasks Completed**: Step 6 implementation verification rerun.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Reconfirmed accepted Step 5 plan alignment and reran required
checks. Checkout/package tests, focused CLI registry temporary-run tests,
typecheck, Biome, and `git diff --check` pass. Full `cli.test.ts` still has the
same unrelated failure in `workflow status and session commands share direct
workflow-definition storage outside project scopes`.

### Session: 2026-05-29 09:35

**Tasks Completed**: Step 7 review remediation for retained provenance
compatibility and explicit registry selector handling.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added legacy package provenance normalization, invalid branchless
GitHub `--registry` rejection before fallback/fetch, and regression coverage for
legacy resume cleanup plus branchless failure-before-staging behavior. Checkout
and package tests, focused CLI registry/resume tests, typecheck, Biome, and
`git diff --check` pass.

## Related Plans

- **Depends On**: `impl-plans/active/workflow-package-registry.md`
- **Depends On**: `impl-plans/active/workflow-package-checkout.md`
- **Related**: `impl-plans/active/workflow-package-checkout-search.md`
- **Related**: `impl-plans/active/workflow-registry-run-resume-cleanup.md`
