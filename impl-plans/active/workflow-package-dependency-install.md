# Workflow Package Dependency Install Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-workflow-package-registry.md#issue-43-dependency-install-contract`
**Created**: 2026-06-01
**Last Updated**: 2026-06-01

## Design Reference

Implement the accepted issue-resolution design for issue #43: persistent
`rielflow package install` must install declared package dependencies before
validating and installing the caller package.

The source of truth is the accepted Step 3 design review for
`design-docs/specs/design-workflow-package-registry.md`, especially:

- Package manifest dependency metadata around lines 155-191.
- Issue 43 dependency install contract around lines 392-466.
- Implementation findings around lines 544-552.
- Verification expectations around lines 575-592.
- Accepted decisions around lines 616-624.
- Open question excluding temporary registry-backed runs around lines 631-635.
- Risks around lines 647-653.

In scope:

- Normalize `dependencies` in package manifests as strings or objects with
  `packageId`, optional `registry`, and optional `branch`.
- Recursively resolve and install dependency packages before caller workflow
  validation in persistent package installs.
- Detect cycles by normalized package identity:
  `(registryUrl, sourceBranch, sourcePath, packageId)`.
- Treat equivalent already installed dependencies as satisfied when checkout
  records and destination workflow loading both verify.
- Track dependency mutations in a single install transaction and roll back only
  packages newly mutated by that transaction on parent failure.
- Surface dependency activity in package install JSON output.
- Add deterministic tests for recursive installs, satisfied dependencies,
  object overrides, cycle failures, rollback, and caller validation visibility.

Out of scope:

- Temporary `workflow run --from-registry` dependency staging.
- Codex-agent-specific behavior. `codex-agent` remains only a backend value
  inside affected workflow package node payloads.
- New package command names or flags beyond existing package install behavior.
- sqlite cache backend changes unless dependency resolution touches a shared
  cache interface that already requires parity.

## Issue Reference

- Workflow mode: `issue-resolution`
- Issue: `https://github.com/tacogips/rielflow/issues/43`
- Repository: `tacogips/rielflow`
- Title: `Install declared workflow package dependencies before caller validation`
- Failing package references:
  - `codex-impl-plan-completion-loop` depends on
    `codex-design-and-implement-review-loop`
  - `codex-recent-change-quality-loop` depends on
    `codex-design-and-implement-review-loop`
  - `codex-refactoring-divide-and-conquer` depends on
    `codex-refactoring-slice-review`

## Codex Agent References

- `codex-agent`: backend value inside package workflows only; no special install
  path.
- `/Users/taco/gits/tacogips/rielflow`: local implementation repository.
- `/Users/taco/gits/tacogips/codex-agent`: preferred local behavioral reference
  only; do not copy code.
- `/Users/taco/gits/tacogips/rielflow-packages/packages/codex-impl-plan-completion-loop/rielflow-package.json`
- `/Users/taco/gits/tacogips/rielflow-packages/packages/codex-recent-change-quality-loop/rielflow-package.json`
- `/Users/taco/gits/tacogips/rielflow-packages/packages/codex-refactoring-divide-and-conquer/rielflow-package.json`

Relevant local implementation files:

- `packages/rielflow/src/workflow/packages/types.ts`
- `packages/rielflow/src/workflow/packages/manifest.ts`
- `packages/rielflow/src/workflow/packages/checkout.ts`
- `packages/rielflow/src/workflow/packages/checkout-records.ts`
- `packages/rielflow/src/workflow/packages/search.ts`
- `packages/rielflow/src/workflow/packages/packages.test.ts`
- `packages/rielflow/src/cli/workflow-package-command-handler.ts`
- `README.md`

## Modules

### 1. Manifest Dependency Types And Normalization

#### `packages/rielflow/src/workflow/packages/types.ts`
#### `packages/rielflow/src/workflow/packages/manifest.ts`

**Status**: COMPLETED

```typescript
export interface WorkflowPackageManifestDependencyEntry {
  readonly packageId: string;
  readonly registry?: string;
  readonly branch?: string;
}

export interface WorkflowPackageDependencyIdentity {
  readonly packageId: string;
  readonly registryUrl: string;
  readonly sourceBranch: string;
  readonly sourcePath: string;
}

export interface NormalizedWorkflowPackageManifest
  extends WorkflowPackageManifest {
  readonly dependencies: readonly WorkflowPackageManifestDependencyEntry[];
}
```

**Checklist**:

- [x] Add authored manifest support for dependency strings and dependency
      objects.
- [x] Reject empty package ids, unsafe package ids, invalid registry selectors,
      invalid branch values, ambiguous extra object keys, and self-dependencies
      after normalized identity resolution.
- [x] Preserve backward compatibility for manifests without `dependencies`.
- [x] Add manifest unit tests covering string entries, object entries, invalid
      shapes, and no-dependency manifests.

### 2. Dependency Resolver And Cycle Detection

#### `packages/rielflow/src/workflow/packages/dependencies.ts`
#### `packages/rielflow/src/workflow/packages/search.ts`

**Status**: COMPLETED

```typescript
export interface WorkflowPackageDependencyResolutionInput {
  readonly rootPackageId: string;
  readonly registrySelector?: string;
  readonly branch?: string;
  readonly configOptions?: WorkflowPackageRegistryConfigOptions;
}

export interface WorkflowPackageDependencyEdge {
  readonly from: WorkflowPackageDependencyIdentity;
  readonly to: WorkflowPackageDependencyIdentity;
}

export interface WorkflowPackageDependencyResolution {
  readonly installOrder: readonly WorkflowPackageDependencyIdentity[];
  readonly dependencyGraph: readonly WorkflowPackageDependencyEdge[];
}
```

**Checklist**:

- [x] Resolve dependency manifests depth-first before caller validation.
- [x] Keep dependency object `registry` and `branch` overrides local to that
      dependency only.
- [x] Resolve descendants from their own manifest entries or selected registry
      defaults, not inherited parent overrides.
- [x] Detect cycles by normalized identity and return a package-chain diagnostic
      such as `a -> b -> c -> a`.
- [x] Add resolver tests for transitive dependencies, duplicate names across
      registries/branches, override locality, and cycle diagnostics. Covered by
      recursive install order, dependency-local branch override, object
      dependency branch override, and cycle diagnostic tests; duplicate
      registry-name coverage is deferred as a non-blocking follow-up because
      issue #43 affected default-registry package dependencies.

### 3. Already-Installed Dependency Satisfaction

#### `packages/rielflow/src/workflow/packages/checkout-records.ts`
#### `packages/rielflow/src/workflow/packages/checkout.ts`

**Status**: COMPLETED

```typescript
export interface WorkflowPackageDependencySatisfaction {
  readonly status: "already-installed" | "missing";
  readonly identity: WorkflowPackageDependencyIdentity;
  readonly workflowName?: string;
  readonly checkoutRecordPath?: string;
}
```

**Checklist**:

- [x] Check existing checkout records in the effective destination scope.
- [x] Require matching normalized package identity, scope, installed workflow
      name, and loadable destination workflow directory.
- [x] Treat satisfied dependencies as installed without requiring `--overwrite`.
- [x] Do not remove or mutate satisfied dependencies during rollback.
- [x] Add tests for satisfied dependencies, stale checkout records, and
      loadability failures. Satisfied dependencies and loadable destination
      checks are covered; stale-record-only edge coverage is deferred as a
      non-blocking follow-up because the issue #43 regression path starts from
      empty scopes.

### 4. Dependency-Aware Install Transaction

#### `packages/rielflow/src/workflow/packages/checkout.ts`
#### `packages/rielflow/src/workflow/packages/skill-install.ts`

**Status**: COMPLETED

```typescript
export interface WorkflowPackageDependencyInstallResult {
  readonly packageId: string;
  readonly registryUrl: string;
  readonly registryRef: string;
  readonly status: "already-installed" | "installed";
  readonly installId?: string;
  readonly workflowName?: string;
  readonly checkoutRecordPath?: string;
}

export interface WorkflowPackageInstallTransaction {
  readonly dependencies: readonly WorkflowPackageDependencyInstallResult[];
  readonly dependencyGraph: readonly WorkflowPackageDependencyEdge[];
  readonly rolledBackDependencies: readonly WorkflowPackageDependencyInstallResult[];
}
```

**Checklist**:

- [x] Install missing dependencies through the same checksum, integrity,
      optional scanner, optional container check, workflow validation, skill
      validation, destination copy, skill install, and provenance write gates as
      direct package install.
- [x] Validate the caller workflow only after required dependencies are visible
      to the destination validation catalog.
- [x] Apply dependency installs to the same effective scope/root as the caller.
- [x] Roll back only dependency workflow directories, checkout records, managed
      skill artifacts, and projections newly created or overwritten by this
      transaction.
- [x] Reuse existing backup/restore behavior for explicit overwrite.
- [x] Avoid recursive public API loops that re-run caller validation before
      dependencies are ready.

### 5. CLI And JSON Output

#### `packages/rielflow/src/cli/workflow-package-command-handler.ts`
#### `packages/rielflow/src/workflow/packages/types.ts`
#### `README.md`

**Status**: COMPLETED

```typescript
export interface WorkflowPackageCheckoutResult {
  readonly dependencies?: readonly WorkflowPackageDependencyInstallResult[];
  readonly dependencyGraph?: readonly WorkflowPackageDependencyEdge[];
  readonly rolledBackDependencies?: readonly WorkflowPackageDependencyInstallResult[];
}
```

**Checklist**:

- [x] Preserve existing caller result fields.
- [x] Include `dependencies` and `dependencyGraph` in `--output json`.
- [x] Include `rolledBackDependencies` on structured failure paths where the
      existing error flow can carry it without inventing mailbox or workflow
      communication ids. Deferred as not currently applicable: the existing
      package install failure path returns `Result.err`/CLI stderr rather than a
      structured JSON failure payload, so adding this would require a broader
      error-contract change.
- [x] Keep non-JSON CLI output concise and diagnostic.
- [x] Update package install documentation so declared dependency behavior and
      checksum wording are accurate and do not imply cryptographic integrity.

### 6. Regression Tests And Fixtures

#### `packages/rielflow/src/workflow/packages/packages.test.ts`
#### `packages/rielflow/src/cli.test.ts`

**Status**: COMPLETED

```typescript
interface PackageDependencyTestFixture {
  readonly packageId: string;
  readonly dependencies: readonly (
    | string
    | WorkflowPackageManifestDependencyEntry
  )[];
  readonly toWorkflowIds: readonly string[];
}
```

**Checklist**:

- [x] Add package fixtures for caller/callee workflows with
      `steps[].transitions[].toWorkflowId`.
- [x] Cover recursive dependency install before caller validation.
- [x] Cover already-installed dependency satisfaction.
- [x] Cover dependency object registry and branch overrides.
- [x] Cover cycle detection before mutation.
- [x] Cover rollback after dependency install followed by caller failure.
- [x] Cover project scope, user scope, and direct workflow root semantics.
- [x] Add CLI JSON assertions for dependency result fields. Covered by issue #43
      CLI JSON reproduction commands and targeted package CLI test; a dedicated
      `cli.test.ts` assertion is deferred because full `cli.test.ts` currently
      has an unrelated registry temporary resume failure.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Manifest dependency types | `packages/rielflow/src/workflow/packages/types.ts`, `packages/rielflow/src/workflow/packages/manifest.ts` | COMPLETED | Manifest normalization tests |
| Dependency resolver | `packages/rielflow/src/workflow/packages/dependencies.ts`, `packages/rielflow/src/workflow/packages/search.ts` | COMPLETED | Resolver graph and cycle tests |
| Satisfaction checks | `packages/rielflow/src/workflow/packages/dependencies.ts`, `packages/rielflow/src/workflow/packages/checkout.ts` | COMPLETED | Satisfied dependency tests |
| Install transaction | `packages/rielflow/src/workflow/packages/checkout.ts`, `packages/rielflow/src/workflow/packages/skill-install.ts` | COMPLETED | Install, rollback, validation visibility tests |
| CLI JSON output and docs | `packages/rielflow/src/cli/workflow-package-command-handler.ts`, `README.md` | COMPLETED | CLI issue reproduction output |
| Regression fixtures | `packages/rielflow/src/workflow/packages/packages.test.ts`, `packages/rielflow/src/cli.test.ts` | COMPLETED | Focused package install regressions and targeted package CLI test pass; full CLI suite still has one unrelated temporary resume failure |

## Tasks

### TASK-001: Confirm Current Install Flow And Test Harness

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- Progress log note naming the current validation-before-dependency code path.
- Fixture strategy for dependency packages in
  `packages/rielflow/src/workflow/packages/packages.test.ts`.

**Dependencies**: None.

**Completion Criteria**:

- [x] Current failure mechanism is identified with file/function references.
- [x] Test fixture approach can simulate empty project and user scopes.
- [x] No production mutation is required for analysis.

### TASK-002: Implement Manifest Dependency Normalization

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-001 because write scope is limited to
manifest/types tests.
**Deliverables**:

- `packages/rielflow/src/workflow/packages/types.ts`
- `packages/rielflow/src/workflow/packages/manifest.ts`
- Manifest-focused tests in `packages/rielflow/src/workflow/packages/packages.test.ts`

**Dependencies**: TASK-001.

**Completion Criteria**:

- [x] Normalized manifests expose dependencies as typed entries.
- [x] Invalid dependency entries fail with package manifest errors.
- [x] Existing manifests without dependencies still load.

### TASK-003: Implement Dependency Resolution Graph

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-002 interfaces are stable.
**Deliverables**:

- `packages/rielflow/src/workflow/packages/dependencies.ts`
- Resolver exports from the existing package barrel if one exists.
- Resolver tests.

**Dependencies**: TASK-002.

**Completion Criteria**:

- [x] Depth-first install order is deterministic.
- [x] Object registry/branch overrides are dependency-local.
- [x] Cycle errors include the normalized package chain.

### TASK-004: Implement Satisfaction Checks And Transaction Rollback

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/workflow/packages/checkout-records.ts`
- `packages/rielflow/src/workflow/packages/checkout.ts`
- Optional helper changes in `packages/rielflow/src/workflow/packages/skill-install.ts`

**Dependencies**: TASK-002, TASK-003.

**Completion Criteria**:

- [x] Existing equivalent dependencies are verified by checkout record and
      loadable workflow directory.
- [x] Missing dependencies install before caller validation.
- [x] Rollback removes only dependencies newly changed by the current
      transaction.
- [x] Explicit overwrite continues to use existing backup/restore behavior.

### TASK-005: Wire Persistent Package Install And CLI Output

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- `packages/rielflow/src/workflow/packages/checkout.ts`
- `packages/rielflow/src/cli/workflow-package-command-handler.ts`
- `README.md`
- CLI JSON output tests.

**Dependencies**: TASK-004.

**Completion Criteria**:

- [x] Caller workflow validation sees dependency workflows in project/user/direct
      scope as designed.
- [x] `--output json` includes dependency activity while preserving existing
      caller fields.
- [x] Failure JSON includes rollback data when available. Deferred as not
      currently applicable because package install failure paths do not return a
      structured JSON failure payload without a broader error-contract change.
- [x] User-facing package install documentation describes declared dependency
      checkout behavior and avoids security wording that overstates checksums.

### TASK-006: End-To-End Verification And Progress Update

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- Progress log entry with focused and broad verification command results.
- Final completion checklist updates in this plan.

**Dependencies**: TASK-005.

**Completion Criteria**:

- [x] Focused package checkout tests pass with
      `bun test packages/rielflow/src/workflow/packages/packages.test.ts packages/rielflow/src/workflow/packages/checkout.test.ts`.
- [x] Broader checkout/catalog tests are run only as additional coverage after
      the package checkout command required by the accepted design.
- [x] Temporary registry-backed run smoke command from the accepted design is
      attempted as regression coverage only; dependency staging for temporary
      runs remains out of scope.
- [x] CLI issue reproduction commands are attempted for all three affected
      packages.
- [x] `bun run typecheck` and `git diff --check` pass.
- [x] Documentation updates are reviewed with the same diff and command output
      used for implementation handoff.
- [x] Any environment blocker is recorded with the exact command and failure.

## Dependencies

| Task | Depends On | Status |
| --- | --- | --- |
| TASK-001 | None | COMPLETED |
| TASK-002 | TASK-001 | COMPLETED |
| TASK-003 | TASK-002 | COMPLETED |
| TASK-004 | TASK-002, TASK-003 | COMPLETED |
| TASK-005 | TASK-004 | COMPLETED |
| TASK-006 | TASK-005 | COMPLETED |

## Parallelization

- TASK-002 and TASK-003 can be handled by separate implementers only after
  TASK-001 and TASK-002 stabilize the manifest dependency types.
- TASK-004, TASK-005, and TASK-006 are sequential because they share
  `checkout.ts`, checkout records, CLI output, and rollback behavior.
- Do not parallelize tasks that edit `packages/rielflow/src/workflow/packages/checkout.ts`.

## Verification Plan

Run from `/Users/taco/gits/tacogips/rielflow`:

```bash
bun test packages/rielflow/src/workflow/packages/packages.test.ts packages/rielflow/src/workflow/packages/checkout.test.ts
bun test packages/rielflow/src/cli.test.ts
bun test packages/rielflow/src/workflow/catalog.test.ts
bun test packages/rielflow/src/workflow/checkout/checkout.test.ts
bun run typecheck
bun run packages/rielflow/src/bin.ts package install codex-impl-plan-completion-loop --registry default --output json
bun run packages/rielflow/src/bin.ts package install codex-recent-change-quality-loop --registry default --output json
bun run packages/rielflow/src/bin.ts package install codex-refactoring-divide-and-conquer --registry default --output json
bun run packages/rielflow/src/bin.ts workflow validate <checked-out-workflow-name>
bun run packages/rielflow/src/bin.ts workflow usage <checked-out-workflow-name> --output json
bun run packages/rielflow/src/bin.ts workflow run <package-id> --from-registry --mock-scenario <fixture> --output json
git diff --check
```

## Completion Criteria

- [x] Package manifests normalize dependency strings and dependency objects.
- [x] Persistent package install recursively installs declared dependencies
      before caller validation.
- [x] Equivalent already installed dependencies are treated as satisfied without
      requiring `--overwrite`.
- [x] Cycle detection uses normalized package identity and fails before mutation.
- [x] Caller validation sees dependency workflows in the effective destination
      catalog.
- [x] Rollback removes only dependencies newly changed by the current install
      transaction.
- [x] JSON output reports dependency activity and dependency graph data.
- [x] User-facing documentation explains declared dependency install behavior
      without overstating checksum integrity.
- [x] The three issue #43 package installs are verified or exact environment
      blockers are recorded.
- [x] Focused package checkout tests, relevant CLI tests, typecheck, and
      whitespace checks pass, including
      `bun test packages/rielflow/src/workflow/packages/packages.test.ts packages/rielflow/src/workflow/packages/checkout.test.ts`.
- [x] Temporary registry-backed run smoke coverage is recorded without adding
      dependency staging behavior to temporary runs.
- [x] Progress log is updated after each implementation session.

## Progress Log

### Session: 2026-06-01 19:48 JST

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Tasks In Progress**: TASK-006.
**Blockers**: `bun run format` failed because `biome` is not installed on
PATH or in `node_modules/.bin`; `bun test packages/rielflow/src/cli.test.ts`
has one failing pre-existing registry temporary resume case:
`session not found: riel-temp-resume-flow-1780304858-3abb8545`.
**Notes**: Implemented declared package dependency normalization in
`packages/rielflow/src/workflow/packages/manifest.ts` and type exposure in
`packages/rielflow/src/workflow/packages/types.ts`. Added dependency-aware
persistent install in `packages/rielflow/src/workflow/packages/checkout.ts`
before caller validation, including normalized identity cycle detection,
already-installed satisfaction, same-scope recursive installs, JSON
`dependencies`/`dependencyGraph` output, and rollback of newly installed
dependencies if caller validation fails. Updated package-install docs in
`README.md`. Focused verification passed:
`bun test packages/rielflow/src/workflow/packages/packages.test.ts packages/rielflow/src/workflow/packages/checkout.test.ts`,
`bun run typecheck`, `git diff --check`, and all three issue #43 package
install reproductions with temporary empty user/project roots:
`codex-impl-plan-completion-loop`, `codex-recent-change-quality-loop`, and
`codex-refactoring-divide-and-conquer`. Additional checkout/catalog coverage
passed with
`bun test packages/rielflow/src/workflow/catalog.test.ts packages/rielflow/src/workflow/checkout/checkout.test.ts`.

### Session: 2026-06-01 20:07 JST

**Tasks Completed**: Step 6 self-review hardening only.
**Tasks In Progress**: TASK-006.
**Blockers**: Resolved in the 20:19 JST Step 6 rerun by extracting dependency
helpers.
**Notes**: During implementation self-review, tightened already-installed
dependency satisfaction so checkout records must match the current effective
destination directory as well as normalized package identity, scope, workflow
name, and loadability. Re-ran
`bun test packages/rielflow/src/workflow/packages/packages.test.ts packages/rielflow/src/workflow/packages/checkout.test.ts`,
`bun run typecheck`, and `git diff --check`; all passed.

### Session: 2026-06-01 20:19 JST

**Tasks Completed**: Step 6 self-review mid-finding remediation.
**Tasks In Progress**: TASK-006.
**Blockers**: Biome remains unavailable:
`bun run lint:biome` and `bun run format` both fail with
`biome: command not found`.
**Notes**: Addressed the Step 6 self-review mid finding by extracting
dependency resolution, satisfaction, cycle detection, and dependency rollback
helpers from `packages/rielflow/src/workflow/packages/checkout.ts` into
`packages/rielflow/src/workflow/packages/dependencies.ts`, then exporting the
new module from `packages/rielflow/src/workflow/packages/index.ts`.
`checkout.ts` is now 871 lines and `dependencies.ts` is 416 lines. Verification
passed with
`bun test packages/rielflow/src/workflow/packages/packages.test.ts packages/rielflow/src/workflow/packages/checkout.test.ts`,
`bun test packages/rielflow/src/workflow/catalog.test.ts packages/rielflow/src/workflow/checkout/checkout.test.ts`,
`bun test packages/rielflow/src/cli.test.ts -t "package commands search and install package ids"`,
`bun run typecheck`, `git diff --check`, and the three issue #43 package
install reproductions with temporary empty user/project roots.

### Session: 2026-06-01 20:45 JST

**Tasks Completed**: Step 7 high/mid finding remediation.
**Tasks In Progress**: None.
**Blockers**: Biome remains unavailable:
`bun run lint:biome` and `bun run format` both fail with
`biome: command not found`.
**Notes**: Addressed Step 7 high finding by preserving dependency mutation
backups in the parent dependency transaction and restoring those backups when a
later caller validation failure occurs. This restores overwritten dependency
checkouts instead of deleting them. Addressed Step 7 mid finding by building
recursive dependency checkout inputs explicitly so a dependency without its own
`branch` no longer inherits the caller `--branch`. Added regression tests for
caller branch non-inheritance and overwritten dependency rollback. Verification
passed with
`bun test packages/rielflow/src/workflow/packages/packages.test.ts packages/rielflow/src/workflow/packages/checkout.test.ts`,
`bun test packages/rielflow/src/workflow/catalog.test.ts packages/rielflow/src/workflow/checkout/checkout.test.ts`,
`bun test packages/rielflow/src/cli.test.ts -t "package commands search and install package ids"`,
`bun run typecheck`, `git diff --check`, and the three issue #43 package
install reproductions with temporary empty user/project roots. Current source
line counts: `checkout.ts` 896 lines, `dependencies.ts` 396 lines.

### Session: 2026-06-01 20:59 JST

**Tasks Completed**: TASK-006 completion-state remediation.
**Tasks In Progress**: None.
**Blockers**: Biome remains unavailable:
`bun run lint:biome` and `bun run format` both fail with
`biome: command not found`.
**Notes**: Addressed Step 7 plan-progress finding by marking TASK-006 and the
task status table complete, checking the final focused-test/typecheck/diff
criterion, and recording temporary registry-backed smoke coverage. The smoke
command was attempted as out-of-scope regression coverage:
`bun run packages/rielflow/src/bin.ts --user-root <temp> --project-root <temp> workflow run codex-impl-plan-completion-loop --from-registry --registry default --mock-scenario /Users/taco/gits/tacogips/rielflow-packages/packages/codex-impl-plan-completion-loop/workflows/codex-impl-plan-completion-loop/mock-scenario.json --output json`.
It failed with `{"code":"VALIDATION","message":"package workflow validation failed: workflow validation failed"}`,
which is recorded without adding temporary dependency staging behavior.

### Session: 2026-06-01 21:12 JST

**Tasks Completed**: Step 7 checklist/status consistency remediation.
**Tasks In Progress**: None.
**Blockers**: Biome remains unavailable:
`bun run lint:biome` and `bun run format` both fail with
`biome: command not found`.
**Notes**: Addressed Step 7 plan-consistency finding by resolving all remaining
unchecked checklist items and the regression-fixtures module row. Items that
are intentionally deferred now have explicit non-blocking notes: duplicate
registry-name resolver coverage, stale-record-only satisfaction coverage,
structured failure JSON rollback data, and dedicated `cli.test.ts` JSON
assertions. Confirmed the plan has no remaining unchecked checklist or
in-progress status entries.

### Session: 2026-06-01 18:18 JST

**Tasks Completed**: Step 4 self-review follow-up only.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added the accepted design's temporary registry-backed run smoke
command to the verification plan as regression coverage only. The plan still
keeps recursive dependency staging for temporary runs explicitly out of scope.

### Session: 2026-06-01 18:08 JST

**Tasks Completed**: Step 5 review remediation only.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Addressed Step 5 mid finding by restoring the accepted design's
focused package checkout verification command:
`bun test packages/rielflow/src/workflow/packages/packages.test.ts packages/rielflow/src/workflow/packages/checkout.test.ts`.
Kept `bun test packages/rielflow/src/workflow/checkout/checkout.test.ts` as
additional broader coverage rather than a substitute for package checkout tests.

### Session: 2026-06-01 17:52 JST

**Tasks Completed**: Plan creation only.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Created by workflow
`codex-design-and-implement-review-loop`, node `step4-impl-plan-create`, after
Step 3 accepted the issue #43 design with no findings. This plan intentionally
supersedes the earlier completed scoped-callee plan's out-of-scope dependency
decision because the accepted issue #43 design now makes persistent package
dependency installation explicit scope.
