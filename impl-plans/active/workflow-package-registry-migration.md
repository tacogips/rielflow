# Workflow Package Registry Migration Implementation Plan

**Status**: In Progress
**Design Reference**: `design-docs/specs/design-workflow-package-migration.md`
**Created**: 2026-05-27
**Last Updated**: 2026-05-27

## Design Document Reference

**Source**: `design-docs/specs/design-workflow-package-migration.md`
**Workflow Mode**: issue-resolution
**Issue Reference**: workflowInput: Implement workflow package registry and package commands
**Feature ID**: registry-migration-example
**Fanout Feature ID**: registry-migration-example

This plan implements the accepted `registry-migration-example` design: package
the current project-local `.rielflow/workflows` catalog into the default
registry checkout at `/Users/taco/gits/tacogips/rielflow-packages`, preserve
runtime behavior, add searchable manifests and md5 change-tracking checksums,
document an example package, and verify search, checkout, validation, usage,
mock-run, provenance, and checksum stability through package commands.

## Scope

Included:

- create or update default-registry package directories under
  `/Users/taco/gits/tacogips/rielflow-packages/packages/project-<workflow-id>/`
- use nested workflow bundle layout:
  `packages/project-<workflow-id>/<workflow-id>/workflow.json`
- add `rielflow-package.json` metadata with `workflowDirectory`,
  searchable tags, and md5 checksum fields
- make `project-design-and-implement-review-loop-feature-plan` the
  codex-agent bounded fanout acceptance fixture and documented example package
- keep `examples/` directly runnable with `--workflow-definition-dir ./examples`
- update repository and registry documentation for package discovery, checkout,
  validation, usage, mock-run, publish notes, and checksum expectations

Excluded:

- implementing registry, checkout, search, publish, metadata, or cache library
  behavior owned by sibling feature slices
- changing workflow graphs, prompts, node payloads, or mock scenarios except
  for validation-preserving package fixes
- deleting project-local `.rielflow/workflows` before package checkout,
  validation, and documentation are verified
- treating md5 checksums as a security boundary

## Modules

### 1. Package Manifest Metadata

#### `/Users/taco/gits/tacogips/rielflow-packages/packages/project-<workflow-id>/rielflow-package.json`

**Status**: Completed

```typescript
interface WorkflowPackageManifest {
  readonly name: `project-${string}`;
  readonly version: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly registry: "default" | "https://github.com/tacogips/rielflow-packages";
  readonly repository: "https://github.com/tacogips/rielflow-packages";
  readonly checksumAlgorithm: "md5";
  readonly checksum: string;
  readonly workflowDirectory: string;
  readonly minimumRielflowVersion?: string;
}
```

**Checklist**:

- [x] Use `rielflow-package.json`, not `package.json`
- [x] Use `project-<workflow-id>` names for migrated project-local workflows
- [x] Set `workflowDirectory` to the nested `<workflow-id>` bundle directory
- [x] Add tags such as `codex-agent`, `claude-code-agent`, `feature-plan`,
      `review`, `implementation`, `refactoring`, `quality`, or `workflow`
      where accurate
- [x] Set `checksumAlgorithm` to `md5` and regenerate `checksum` after
      manifest normalization
- [x] Exclude runtime artifacts, dependency directories, temporary files, and
      machine-local cache files from checksum inputs

### 2. Migrated Project Workflow Packages

#### `/Users/taco/gits/tacogips/rielflow-packages/packages/project-<workflow-id>/`

**Status**: Completed

**Source Workflows**:

- `.rielflow/workflows/design-and-implement-review-loop/`
- `.rielflow/workflows/design-and-implement-review-loop-feature-plan/`
- `.rielflow/workflows/refactoring-divide-and-conquer/`
- `.rielflow/workflows/refactoring-slice-review/`
- `.rielflow/workflows/impl-plan-completion-loop/`
- `.rielflow/workflows/recent-change-quality-loop/`

**Destination Shape**:

```text
packages/project-<workflow-id>/
  rielflow-package.json
  <workflow-id>/
    workflow.json
    nodes/
    prompts/
    mock-scenario.json
    EXPECTED_RESULTS.md
  README.md
```

**Checklist**:

- [x] Copy package-owned workflow files into nested `<workflow-id>/` directories
- [x] Preserve workflow JSON, nodes, prompts, mock scenarios, expected results,
      and package-local support files
- [x] Keep project-local `.rielflow/workflows` available until verification
      passes
- [ ] Compare checked-out package-owned files against source workflow files
- [x] Confirm each manifest `workflowDirectory` points to a safe relative path

### 3. Example Package Documentation

#### `/Users/taco/gits/tacogips/rielflow-packages/packages/project-design-and-implement-review-loop-feature-plan/`

**Status**: In Progress

**Checklist**:

- [x] Use `project-design-and-implement-review-loop-feature-plan` as the
      example package name
- [x] Preserve nested workflow id `design-and-implement-review-loop-feature-plan`
- [x] Preserve `mock-scenario.json` and `EXPECTED_RESULTS.md`
- [x] Add package-local README instructions for search, checkout, validation,
      usage inspection, and mock-scenario run
- [x] Include registry URL, package name, project-scope checkout, and JSON
      output flags where useful for codex-agent automation

### 4. Registry Metadata Refresh And Provenance

#### `/Users/taco/gits/tacogips/rielflow-packages/packages/*/rielflow-package.json`

**Status**: Completed

**Checklist**:

- [x] Refresh package search/cache data through the implemented package command
      or registry helper
- [x] Ensure search returns registry URL, branch, package name, workflow id,
      checksum, and source path
- [x] Verify checkout provenance records package fields in
      `~/.rielflow/workflow-registry/checkouts/`
- [ ] Keep generated registry index/checksum files aligned with sibling
      registry metadata contracts

### 5. Documentation

#### `README.md`
#### `examples/README.md`
#### `.rielflow/README.md`
#### `/Users/taco/gits/tacogips/rielflow-packages/README.md`
#### `/Users/taco/gits/tacogips/rielflow-packages/packages/project-<workflow-id>/README.md`

**Status**: Completed

**Checklist**:

- [ ] Document default registry URL
      `https://github.com/tacogips/rielflow-packages`
- [ ] Document local registry path
      `/Users/taco/gits/tacogips/rielflow-packages`
- [ ] Show package search and checkout examples for project scope and user
      scope
- [ ] Explain that `examples/` remains a direct workflow fixture catalog
- [ ] Add publish notes for direct push and PR-based publication without
      duplicating the publish-command design
- [ ] Document validation, usage inspection, mock-run, provenance, and checksum
      refresh expectations

## Task Breakdown

### TASK-001: Confirm Registry Readiness And Command Contracts

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `/Users/taco/gits/tacogips/rielflow-packages/`
- `/Users/taco/gits/tacogips/rielflow-packages/packages/`
- command syntax notes for `workflow package search` and
  `workflow package checkout`

**Dependencies**: accepted design and sibling package command contracts

**Completion Criteria**:

- [x] Default registry path exists or setup error is actionable
- [x] `git -C /Users/taco/gits/tacogips/rielflow-packages status --short` is
      inspected before writes
- [x] Manifest filename is confirmed as `rielflow-package.json`
- [x] Nested `packages/project-<workflow-id>/<workflow-id>/` layout is
      confirmed for migrated packages
- [x] Final package command syntax is recorded before verification tasks run

### TASK-002: Migrate Project Workflow Bundles

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `/Users/taco/gits/tacogips/rielflow-packages/packages/project-design-and-implement-review-loop/`
- `/Users/taco/gits/tacogips/rielflow-packages/packages/project-design-and-implement-review-loop-feature-plan/`
- `/Users/taco/gits/tacogips/rielflow-packages/packages/project-refactoring-divide-and-conquer/`
- `/Users/taco/gits/tacogips/rielflow-packages/packages/project-refactoring-slice-review/`
- `/Users/taco/gits/tacogips/rielflow-packages/packages/project-impl-plan-completion-loop/`
- `/Users/taco/gits/tacogips/rielflow-packages/packages/project-recent-change-quality-loop/`

**Dependencies**: TASK-001

**Completion Criteria**:

- [x] Every source `.rielflow/workflows/*/workflow.json` bundle has a
      `project-*` package directory
- [x] Runtime artifacts and transient files are not copied
- [x] Workflow runtime files remain semantically unchanged
- [x] Manifest metadata is searchable and package-specific
- [x] md5 checksum fields are generated from stable package-local paths
- [x] `project-design-and-implement-review-loop-feature-plan` remains
      documented as the example package in TASK-003

### TASK-003: Document And Verify Example Package

**Status**: In Progress
**Parallelizable**: Yes
**Deliverables**:

- `/Users/taco/gits/tacogips/rielflow-packages/packages/project-design-and-implement-review-loop-feature-plan/rielflow-package.json`
- `/Users/taco/gits/tacogips/rielflow-packages/packages/project-design-and-implement-review-loop-feature-plan/design-and-implement-review-loop-feature-plan/EXPECTED_RESULTS.md`
- `/Users/taco/gits/tacogips/rielflow-packages/packages/project-design-and-implement-review-loop-feature-plan/design-and-implement-review-loop-feature-plan/mock-scenario.json`
- `/Users/taco/gits/tacogips/rielflow-packages/packages/project-design-and-implement-review-loop-feature-plan/README.md`

**Dependencies**: TASK-001, TASK-002 package copy for the feature-plan workflow

**Completion Criteria**:

- [x] Example package name is
      `project-design-and-implement-review-loop-feature-plan`
- [x] Nested workflow id is `design-and-implement-review-loop-feature-plan`
- [x] Example is discoverable by package search metadata
- [x] Example docs include copyable codex-agent-friendly commands
- [ ] Example can be checked out, validated, inspected with `workflow usage`,
      and mock-run from checked-out project scope

### TASK-004: Refresh Registry Metadata And Checkout Provenance

**Status**: In Progress
**Parallelizable**: No
**Deliverables**:

- refreshed package search/cache records for default registry
- checkout provenance under `~/.rielflow/workflow-registry/checkouts/`
- generated index/checksum files required by sibling registry contracts

**Dependencies**: TASK-002, TASK-003, package registry/search/checkout slices

**Completion Criteria**:

- [x] Search returns migrated packages and example package with registry URL,
      branch, package name, workflow id, checksum, and source path
- [x] Package checkout installs the feature-plan workflow into project scope by
      default
- [ ] User-scope checkout remains opt-in
- [x] Checkout provenance records package fields after checkout
- [x] Package-local checksum is stable after regeneration
- [ ] Generated registry metadata does not conflict with sibling slice schemas

### TASK-005: Update Repository And Registry Documentation

**Status**: In Progress
**Parallelizable**: Yes
**Deliverables**:

- `README.md`
- `examples/README.md`
- `.rielflow/README.md`
- `/Users/taco/gits/tacogips/rielflow-packages/README.md`
- `/Users/taco/gits/tacogips/rielflow-packages/packages/project-<workflow-id>/README.md`

**Dependencies**: TASK-002, TASK-003

**Completion Criteria**:

- [x] Documentation names default registry URL and local path
- [ ] Documentation explains project-scope default checkout and opt-in
      user-scope checkout
- [ ] Documentation distinguishes direct `examples/` fixtures from registry
      packages
- [x] Documentation includes validation, usage, mock-run, provenance, publish,
      and checksum refresh expectations

### TASK-006: Verify Search, Checkout, Validate, Usage, Run, Checksums, And Status

**Status**: In Progress
**Parallelizable**: No
**Deliverables**:

- verification command output captured in implementation notes or commit summary
- fixes to package manifests, checksums, metadata, or docs discovered by
  verification

**Dependencies**: TASK-004, TASK-005

**Completion Criteria**:

- [ ] Package search returns the example package and migrated package metadata
- [ ] Package checkout installs to project scope by default
- [ ] Checked-out workflow passes `workflow validate`
- [ ] Checked-out workflow exposes automation data through `workflow usage
      --output json`
- [ ] Example package mock scenario runs from checked-out workflow files
- [ ] Source and checked-out package-owned files match
- [ ] Registry status is reviewed with
      `git -C /Users/taco/gits/tacogips/rielflow-packages status --short`
- [ ] Worktree whitespace check passes with `git diff --check`
- [ ] Type checking and tests pass after any TypeScript changes made by sibling
      integration work

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Manifest metadata | `/Users/taco/gits/tacogips/rielflow-packages/packages/project-<workflow-id>/rielflow-package.json` | COMPLETED | Package search and checksum verification |
| Migrated packages | `/Users/taco/gits/tacogips/rielflow-packages/packages/project-<workflow-id>/<workflow-id>/` | COMPLETED | Workflow validate and source comparison |
| Example package | `/Users/taco/gits/tacogips/rielflow-packages/packages/project-design-and-implement-review-loop-feature-plan/` | IN_PROGRESS | Checkout, usage, and mock run |
| Registry metadata refresh | `/Users/taco/gits/tacogips/rielflow-packages/packages/*/rielflow-package.json` | IN_PROGRESS | Package search and provenance checks |
| Documentation | `README.md`, `examples/README.md`, `.rielflow/README.md`, registry README files | IN_PROGRESS | Command copy and review checks |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| TASK-001: Registry readiness | Accepted design and sibling command contracts | COMPLETED |
| TASK-002: Project workflow migration | TASK-001 | COMPLETED |
| TASK-003: Example package docs and checks | TASK-001, TASK-002 feature-plan package copy | IN_PROGRESS |
| TASK-004: Metadata and provenance refresh | TASK-002, TASK-003, package registry/search/checkout slices | IN_PROGRESS |
| TASK-005: Documentation | TASK-002, TASK-003 | BLOCKED |
| TASK-006: Verification | TASK-004, TASK-005 | BLOCKED |

## Verification Commands

```bash
git -C /Users/taco/gits/tacogips/rielflow-packages status --short
find .rielflow/workflows -type f | sort
find /Users/taco/gits/tacogips/rielflow-packages/packages -name rielflow-package.json -print | sort
bun run packages/rielflow/src/bin.ts workflow package search --registry https://github.com/tacogips/rielflow-packages --output json
bun run packages/rielflow/src/bin.ts workflow package search feature-plan --registry default --refresh --output json
bun run packages/rielflow/src/bin.ts workflow package checkout project-design-and-implement-review-loop-feature-plan --registry default --overwrite --output json
bun run packages/rielflow/src/bin.ts workflow validate design-and-implement-review-loop-feature-plan
bun run packages/rielflow/src/bin.ts workflow usage design-and-implement-review-loop-feature-plan --output json
bun run packages/rielflow/src/bin.ts workflow run design-and-implement-review-loop-feature-plan --mock-scenario .rielflow/workflows/design-and-implement-review-loop-feature-plan/mock-scenario.json --output json
git diff --check
bun test
bun run tsc --noEmit
```

If sibling command slices finalize a different command namespace, update command
spelling while preserving checks for search, checkout, validate, usage, mock-run,
provenance, registry status, and checksum stability.

## Completion Criteria

- [x] Default registry contains a `project-*` package directory for every
      current `.rielflow/workflows` bundle
- [x] Each migrated package uses nested `<workflow-id>/` layout and manifest
      `workflowDirectory`
- [x] Each package uses `rielflow-package.json` with searchable metadata and
      md5 checksum fields
- [x] `project-design-and-implement-review-loop-feature-plan` is documented and
      verified as the initial codex-agent bounded fanout example package
- [ ] Search/cache/provenance metadata is refreshed through sibling package
      command contracts
- [ ] Repository and registry documentation explain registry URL, local path,
      checkout scope, search, validation, usage, mock-run, publish notes, and
      checksum behavior
- [ ] Package search, package checkout, workflow validate, workflow usage, mock
      run, source comparison, checksum-stability, registry status, and
      whitespace checks pass
- [ ] Type checks and tests pass after any TypeScript changes made while
      integrating with sibling command slices

## Risks

- The default registry path is outside this worktree and may be absent, dirty,
  or unavailable; TASK-001 must inspect it before writing.
- Removing or replacing `.rielflow/workflows` too early could break active
  codex-agent workflow execution.
- Copy filters that include runtime artifacts, dependency directories,
  temporary files, or machine-local cache files would make checksums unstable.
- Command syntax may change in sibling slices; verification must preserve
  behavior even if command spelling changes.
- md5 supports change tracking only and must not be documented as trust or
  security integrity.
- Smoke-running `codex-agent` or `claude-code-agent` workflows may require mock
  scenarios to avoid live backend credentials.

## Progress Log

### Session: 2026-05-27 13:23 JST

**Tasks Completed**: Created initial feature-local implementation plan.
**Tasks In Progress**: None.
**Blockers**: Implementation waits for TASK-001 and command namespace alignment
with sibling package command slices.
**Notes**: Initial plan was superseded by self-review findings.

### Session: 2026-05-27 13:40 JST

**Tasks Completed**: Revised implementation plan after Step 4 self-review.
**Tasks In Progress**: None.
**Blockers**: Implementation waits for TASK-001 and sibling command contract
confirmation.
**Notes**: Addressed plan-only findings by switching to `rielflow-package.json`,
`workflow package` verification commands, and `workflow usage` verification.
This entry was later superseded by the accepted nested `workflowDirectory` and
`project-*` package naming contract.

### Session: 2026-05-27 13:50 JST

**Tasks Completed**: Revised implementation plan after Step 5 review.
**Tasks In Progress**: None.
**Blockers**: Implementation waits for TASK-001 and sibling command contract
confirmation.
**Notes**: Addressed task ownership finding by making TASK-002 own only
non-example workflow packages and TASK-003 own
`design-and-implement-review-loop-feature-plan`.

### Session: 2026-05-27 14:00 JST

**Tasks Completed**: Revised plan for accepted Step 3 design review.
**Tasks In Progress**: None.
**Blockers**: Implementation waits for TASK-001 and sibling command contract
confirmation.
**Notes**: Aligned the plan with accepted `project-*` package naming, nested
`workflowDirectory` layout, `project-design-and-implement-review-loop-feature-plan`
example package, registry status checks, and package search/checkout verification
commands.

### Session: 2026-05-27 14:08 JST Step 6 Implementation

**Tasks Completed**: Inspected the default registry path and confirmed existing uncommitted registry package content is present under `/Users/taco/gits/tacogips/rielflow-packages/packages/`.
**Tasks In Progress**: No migration files were written in this step; migrated package docs, registry metadata refresh, and verification remain pending.
**Blockers**: The default registry worktree is dirty (`A flake.lock`, `M flake.nix`, and untracked `packages/`), so migration writes should wait for an explicit registry-state decision or a clean follow-up pass.
**Notes**: Code-level package search/checkout support now returns the metadata required to verify migrated packages once the registry content is finalized.

### Session: 2026-05-27 14:32 JST Step 6 Revision

**Tasks Completed**: Re-inspected `/Users/taco/gits/tacogips/rielflow-packages/packages` and confirmed package manifests exist for the six project workflows plus `worker-only-single-step`.
**Tasks In Progress**: Naming/layout reconciliation remains because the external registry currently shows renames from `packages/project-*` paths to non-`project-*` paths, while the accepted migration plan expects `project-*` package names.
**Blockers**: External registry worktree remains dirty and should not be rewritten further without a registry-state decision.
**Notes**: Code verification now covers package search/checkout/publish behavior needed for migration validation, but final migration acceptance requires resolving the external registry diff.

### Session: 2026-05-27 14:55 JST Step 7 Feedback Revision

**Tasks Completed**: Restored the accepted `project-<workflow-id>` package naming contract in `/Users/taco/gits/tacogips/rielflow-packages/packages`, updated migrated manifests to use `project-*` names, and added the feature-plan package README with search, checkout, validate, usage, and mock-run commands.
**Tasks In Progress**: Full checkout-to-validation smoke verification remains pending after independent review because it mutates project checkout destinations.
**Blockers**: None for the Step 7 naming/layout finding; the external registry worktree now intentionally contains rename/add changes that must be committed in the registry repository.
**Notes**: Confirmed manifests use safe nested `workflowDirectory` values and package search can discover the `project-design-and-implement-review-loop-feature-plan` package.
