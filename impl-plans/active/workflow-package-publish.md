# Workflow Package Publish Implementation Plan

**Status**: In Progress
**Design Reference**: design-docs/specs/design-workflow-package-publish.md#workflow-package-publish
**Created**: 2026-05-27
**Last Updated**: 2026-05-27

---

## Design Document Reference

**Source**: `design-docs/specs/design-workflow-package-publish.md`
**Command Contract Reference**: `design-docs/specs/design-workflow-package-commands.md#publish-command`
**Workflow Mode**: issue-resolution
**Issue Reference**: workflowInput: Implement workflow package registry and package commands
**Feature ID**: package-publish-github
**Fanout Feature IDs**: package-publish-github

### Summary

Implement GitHub-backed workflow package publishing through `rielflow publish`.
The command publishes one validated workflow directory into a registry
repository, with default registry URL
`https://github.com/tacogips/rielflow-packages` and default local checkout path
`/Users/taco/gits/tacogips/rielflow-packages`. Publishing writes
`packages/<package-id>/workflow/`, `rielflow-package.json`,
`registry/index.json`, and `registry/checksums.json`, tracks changes with md5
checksums, supports branch selection, and chooses direct push or pull-request
mode according to flags and GitHub permissions.

### Scope

**Included**: top-level publish command parsing, nested package publish
compatibility routing, workflow source resolution, source workflow validation,
package metadata derivation, package staging/copying,
manifest/index/checksum writes, dirty registry worktree refusal, direct push
permission checks, PR adapter boundary, dry-run JSON output, and focused
publish tests.

**Excluded**: non-Git registry backends, sqlite search cache refresh, package
dependency resolution, external registry migration content, and replacing the
existing `workflow checkout` command.

---

## Modules

### 1. Publish Types And Result Contract

#### `packages/rielflow/src/workflow/packages/publish.ts`
#### `packages/rielflow/src/workflow/packages/types.ts`

**Status**: Completed

```typescript
export type WorkflowPackagePublishMode = "direct" | "pull-request";

export interface WorkflowPackagePublishInput {
  readonly workflowNameOrPath: string;
  readonly registryUrl?: string;
  readonly registryLocalPath?: string;
  readonly branch?: string;
  readonly packageId?: string;
  readonly sourceWorkflowDir?: string;
  readonly message?: string;
  readonly createPr?: boolean;
  readonly prBase?: string;
  readonly dryRun?: boolean;
  readonly output?: "json" | "text";
}

export interface WorkflowPackagePublishResult {
  readonly registryUrl: string;
  readonly registryRef: string;
  readonly packageId: string;
  readonly workflowName: string;
  readonly workflowDirectory: string;
  readonly packageDirectory: string;
  readonly checksum: string;
  readonly checksumAlgorithm: "md5";
  readonly commitSha?: string;
  readonly mode: WorkflowPackagePublishMode;
  readonly prUrl?: string;
  readonly dryRun: boolean;
}

export interface WorkflowPackagePublishFailure {
  readonly code:
    | "INVALID_ARGUMENT"
    | "INVALID_PACKAGE_ID"
    | "REGISTRY_UNAVAILABLE"
    | "REGISTRY_DIRTY"
    | "WORKFLOW_INVALID"
    | "PERMISSION_DENIED"
    | "PUBLISH_FAILED";
  readonly message: string;
}
```

**Checklist**:
- [x] Add publish input, output, mode, and failure types.
- [x] Keep structured output fields aligned with the design contract.
- [x] Preserve `packageName` only as a compatibility alias for nested package publish callers.
- [x] Export publish APIs from `packages/rielflow/src/workflow/packages/index.ts`.
- [x] Map invalid command usage to exit code `2` and runtime publish failures to exit code `1`.

### 2. CLI Command Surface

#### `packages/rielflow/src/cli.ts`
#### `packages/rielflow/src/cli/workflow-command-handler.ts`
#### `packages/rielflow/src/cli/workflow-package-command-handler.ts`
#### `packages/rielflow/src/cli.test.ts`

**Status**: In Progress

```typescript
interface PublishCliOptions {
  readonly registry?: string;
  readonly registryLocalPath?: string;
  readonly branch?: string;
  readonly packageId?: string;
  readonly sourceWorkflowDir?: string;
  readonly message?: string;
  readonly createPr?: boolean;
  readonly prBase?: string;
  readonly dryRun?: boolean;
  readonly output?: "json";
}

export declare function runCliWorkflowScope(
  context: RunCliScopeContext,
): Promise<number>;
```

**Checklist**:
- [x] Route top-level `rielflow publish <workflow-name-or-path>` to the package publish service.
- [x] Route nested `rielflow workflow package publish <workflow-directory> --package-name <name>` through the same service as compatibility only.
- [x] Parse implemented publish options: `--registry`, `--registry-url`, `--local-path`, `--registry-local-path`, `--branch`, `--package-id`, `--package-name`, `--create-pr`, `--dry-run`, and `--output json`.
- [x] Emit `WorkflowPackagePublishResult` unchanged for JSON output.
- [x] Render concise text output for direct and PR modes.
- [ ] Add CLI tests for remaining invalid option combinations and failure exit codes.

### 3. Registry Checkout And Git Adapter

#### `packages/rielflow/src/workflow/packages/publish.ts`
#### `packages/rielflow/src/workflow/self-improve/git.ts`

**Status**: In Progress

```typescript
export interface WorkflowPackageRegistryCheckoutInput {
  readonly registryUrl: string;
  readonly localPath?: string;
  readonly branch?: string;
}

export interface WorkflowPackageGitAdapter {
  ensureCheckout(input: WorkflowPackageRegistryCheckoutInput): Promise<string>;
  getDefaultBranch(cwd: string): Promise<string>;
  assertCleanWorktree(cwd: string): Promise<void>;
  canPushBranch(cwd: string, branch: string): Promise<boolean>;
  checkoutBranch(cwd: string, branch: string): Promise<void>;
  createBranch(cwd: string, branch: string, base: string): Promise<void>;
  commitAll(cwd: string, message: string): Promise<string>;
  pushBranch(cwd: string, branch: string): Promise<void>;
}
```

**Checklist**:
- [ ] Reuse hardened `git` subprocess patterns: argument arrays, explicit `cwd`, bounded output, and no shell interpolation.
- [x] Resolve default registry local path and personal registry local path through registry config.
- [x] Resolve explicit GitHub registry URLs with a caller-provided local checkout path.
- [ ] Clone missing registries and verify matching remote URL for existing checkouts.
- [x] Refuse dirty or staged registry worktrees before staging package files.
- [x] Probe direct push permission with non-destructive Git checks where available.
- [ ] Unit test remote mismatch, dirty worktree refusal, branch selection, and permission failure behavior with injectable adapters.

### 4. Source Workflow Resolution And Validation

#### `packages/rielflow/src/workflow/packages/publish.ts`
#### `packages/rielflow/src/workflow/checkout/index.ts`
#### `packages/rielflow/src/workflow/load.ts`

**Status**: In Progress

```typescript
export interface WorkflowPackagePublishSource {
  readonly workflowName: string;
  readonly workflowDirectory: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly backendHints: readonly string[];
}

export interface WorkflowPackageSourceResolver {
  resolve(input: WorkflowPackagePublishInput): Promise<WorkflowPackagePublishSource>;
}
```

**Checklist**:
- [ ] Resolve `--source-workflow-dir` directly when provided.
- [x] Resolve workflow names through the normal workflow catalog when no explicit source directory is provided.
- [x] Validate the source workflow with the strict loader path used by checkout and workflow validation.
- [ ] Derive backend hints such as `codex-agent` and `claude-code-agent` from node payloads when available.
- [ ] Unit test explicit path resolution, catalog name resolution, invalid workflow JSON, missing workflow, and backend hint extraction.

### 5. Package Staging, Manifest, Index, And Checksums

#### `packages/rielflow/src/workflow/packages/publish.ts`
#### `packages/rielflow/src/workflow/packages/manifest.ts`
#### `packages/rielflow/src/workflow/packages/checksum.ts`
#### `packages/rielflow/src/workflow/packages/index.ts`

**Status**: Completed

```typescript
export interface WorkflowPackagePublishStagingInput {
  readonly source: WorkflowPackagePublishSource;
  readonly registryRoot: string;
  readonly registryUrl: string;
  readonly registryRef: string;
  readonly packageId: string;
  readonly now: Date;
}

export interface WorkflowPackagePublishStagingResult {
  readonly packageDirectory: string;
  readonly workflowDirectory: string;
  readonly manifestPath: string;
  readonly indexPath: string;
  readonly checksumsPath: string;
  readonly checksum: string;
  readonly checksumAlgorithm: "md5";
  readonly changedPaths: readonly string[];
}
```

**Checklist**:
- [x] Validate package ids as safe registry path identifiers.
- [x] Copy the workflow to `packages/<package-id>/workflow/` while excluding runtime artifacts, local cache files, `.git`, and checkout provenance.
- [x] Write normalized `packages/<package-id>/rielflow-package.json` with searchable metadata and `workflowDirectory: "workflow"`.
- [x] Update `registry/index.json` for the package without requiring sqlite.
- [x] Update `registry/checksums.json` with package aggregate md5 and per-file checksum records.
- [ ] Validate copied files do not escape the package directory and registry index entries reference present package directories.
- [ ] Unit test manifest fields, checksum determinism, artifact exclusion, unsafe package ids, and checkout/search-compatible paths.

### 6. Direct Publish, PR Mode, And Dry Run

#### `packages/rielflow/src/workflow/packages/publish.ts`

**Status**: In Progress

```typescript
export interface WorkflowPackagePullRequestAdapter {
  createPullRequest(input: WorkflowPackagePullRequestInput): Promise<WorkflowPackagePullRequestResult>;
}

export interface WorkflowPackagePullRequestInput {
  readonly cwd: string;
  readonly branch: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
}

export interface WorkflowPackagePullRequestResult {
  readonly url: string;
}
```

**Checklist**:
- [x] Select direct mode by default when push permission exists and `--create-pr` is absent.
- [x] Select PR mode whenever `--create-pr` is present.
- [x] In direct mode, checkout or create the target branch, commit package changes, and push.
- [x] In PR mode, create a publish branch, push it, and create a PR through an adapter that may wrap `gh pr create`.
- [x] Implement dry run through validation and staging only, returning intended paths, metadata, checksum values, and mode without commit, push, or PR creation.
- [ ] Unit test direct permission denial, forced PR mode, PR adapter failure, dry-run no-commit behavior, and successful output shape.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Publish types and result contract | `packages/rielflow/src/workflow/packages/publish.ts`, `packages/rielflow/src/workflow/packages/types.ts` | COMPLETED | package tests, typecheck |
| CLI command surface | `packages/rielflow/src/cli.ts`, `packages/rielflow/src/cli/workflow-command-handler.ts`, `packages/rielflow/src/cli/workflow-package-command-handler.ts`, `packages/rielflow/src/cli.test.ts` | IN_PROGRESS | CLI tests |
| Registry checkout and Git adapter | `packages/rielflow/src/workflow/packages/publish.ts`, `packages/rielflow/src/workflow/self-improve/git.ts` | IN_PROGRESS | package tests |
| Source workflow resolution and validation | `packages/rielflow/src/workflow/packages/publish.ts`, `packages/rielflow/src/workflow/load.ts` | IN_PROGRESS | package tests |
| Package staging, manifest, index, checksums | `packages/rielflow/src/workflow/packages/publish.ts`, `packages/rielflow/src/workflow/packages/*.ts` | COMPLETED | package tests |
| Direct publish, PR mode, dry run | `packages/rielflow/src/workflow/packages/publish.ts` | IN_PROGRESS | package tests |

## Dependencies

| Task | Depends On | Status |
|------|------------|--------|
| TASK-001: Publish types and result contract | Accepted publish design | COMPLETED |
| TASK-002: CLI command surface | TASK-001 | IN_PROGRESS |
| TASK-003: Registry checkout and Git adapter | TASK-001, registry metadata config plan | IN_PROGRESS |
| TASK-004: Source workflow resolution and validation | TASK-001 | IN_PROGRESS |
| TASK-005: Package staging, manifest, index, checksums | TASK-001, TASK-004, registry metadata/checksum/index modules | COMPLETED |
| TASK-006: Direct publish, PR mode, dry run | TASK-003, TASK-005 | IN_PROGRESS |
| TASK-007: End-to-end verification and docs alignment | TASK-002, TASK-006 | IN_PROGRESS |

## Task Breakdown

### TASK-001: Publish Types And Result Contract

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/workflow/packages/publish.ts`, `packages/rielflow/src/workflow/packages/types.ts`, `packages/rielflow/src/workflow/packages/index.ts`

**Completion Criteria**:
- [x] Publish input/result/failure types are defined and exported.
- [x] Result fields include `registryUrl`, `registryRef`, `packageId`, `workflowName`, `workflowDirectory`, `packageDirectory`, `checksum`, `checksumAlgorithm`, `commitSha`, `mode`, `prUrl`, and `dryRun`.
- [x] Failure codes distinguish command usage from runtime publish failures.

### TASK-002: CLI Command Surface

**Status**: In Progress
**Parallelizable**: Yes, after TASK-001
**Deliverables**: `packages/rielflow/src/cli.ts`, `packages/rielflow/src/cli/workflow-command-handler.ts`, `packages/rielflow/src/cli/workflow-package-command-handler.ts`, `packages/rielflow/src/cli.test.ts`

**Completion Criteria**:
- [x] `rielflow publish <workflow-name-or-path>` invokes `publishWorkflowPackage`.
- [x] Nested compatibility publish maps `--package-name` to canonical `packageId` without changing the canonical JSON contract.
- [ ] All publish options from the design are parsed and validated.
- [x] `--output json` emits structured publish results.
- [x] Invalid usage returns exit code `2`; runtime publish failures return exit code `1`.

### TASK-003: Registry Checkout And Git Adapter

**Status**: In Progress
**Parallelizable**: Yes, after TASK-001
**Deliverables**: `packages/rielflow/src/workflow/packages/publish.ts`, optional shared Git helper extraction from `packages/rielflow/src/workflow/self-improve/git.ts`

**Completion Criteria**:
- [x] Default registry URL and local path are honored.
- [x] Personal registry local paths under `~/.rielflow` are honored through registry config.
- [x] Explicit `--registry-url` or `--registry <url>` plus `--local-path`/`--registry-local-path` is honored for unregistered GitHub registry URLs.
- [ ] Missing registry checkouts are cloned and existing checkouts verify remote URL.
- [x] Dirty and staged registry worktrees are rejected before mutation.
- [x] Direct push permission is probed before committing when possible.

### TASK-004: Source Workflow Resolution And Validation

**Status**: In Progress
**Parallelizable**: Yes, after TASK-001
**Deliverables**: `packages/rielflow/src/workflow/packages/publish.ts`, focused tests in `packages/rielflow/src/workflow/packages/packages.test.ts`

**Completion Criteria**:
- [x] Explicit workflow directories and catalog workflow names both resolve.
- [x] Source workflows pass strict workflow loading before staging.
- [x] Invalid workflows fail before registry mutation.
- [ ] Backend hints and searchable metadata can be derived without loading every registry package.

### TASK-005: Package Staging, Manifest, Index, And Checksums

**Status**: Completed
**Parallelizable**: No, depends on TASK-004 and registry metadata modules
**Deliverables**: `packages/rielflow/src/workflow/packages/publish.ts`, `packages/rielflow/src/workflow/packages/manifest.ts`, `packages/rielflow/src/workflow/packages/checksum.ts`, `packages/rielflow/src/workflow/packages/index.ts`

**Completion Criteria**:
- [x] Published workflow payload lands at `packages/<package-id>/workflow/`.
- [x] `packages/<package-id>/rielflow-package.json` is normalized for checkout/search.
- [x] `registry/index.json` and `registry/checksums.json` are updated deterministically.
- [x] md5 checksum output includes `checksumAlgorithm: "md5"`.
- [x] Runtime artifacts and local-only files are excluded.

### TASK-006: Direct Publish, PR Mode, And Dry Run

**Status**: In Progress
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/workflow/packages/publish.ts`, `packages/rielflow/src/workflow/packages/packages.test.ts`

**Completion Criteria**:
- [x] Direct publish commits and pushes to the selected branch when permission exists.
- [x] `--create-pr` always uses PR mode even when direct push is possible.
- [x] PR creation is isolated behind a replaceable adapter.
- [x] Dry run validates and stages only in temporary state, with no commit, push, or PR.
- [x] Failures preserve actionable diagnostics.

### TASK-007: End-to-End Verification And Docs Alignment

**Status**: In Progress
**Parallelizable**: No
**Deliverables**: publish tests, command help text, any necessary README/design cross-reference updates within publish scope

**Completion Criteria**:
- [x] Publish dry-run test covers JSON shape and no Git mutation.
- [ ] Permission failure test covers direct-push denial.
- [ ] PR adapter test covers success and failure output with `prUrl`.
- [ ] Dirty registry rejection test covers staged and unstaged changes.
- [x] Manifest/checksum test covers checkout/search metadata compatibility.
- [ ] `bun test packages/rielflow/src/workflow`, `bun test packages/rielflow/src/cli`, and `bun run tsc --noEmit` pass.

## Parallelizable Tasks

- TASK-002 can run in parallel with TASK-003 and TASK-004 after TASK-001.
- TASK-003 and TASK-004 can run in parallel after TASK-001.
- TASK-005 waits for TASK-004 and registry metadata/checksum/index contracts.
- TASK-006 waits for TASK-003 and TASK-005.
- TASK-007 waits for the implementation tasks it verifies.

## Verification

Required commands:

```bash
bun test packages/rielflow/src/workflow
bun test packages/rielflow/src/cli
bun run tsc --noEmit
```

Focused scenarios:

- [x] `rielflow publish <workflow> --dry-run --output json` returns package paths, metadata, checksums, and intended mode without committing.
- [ ] Direct publish fails clearly when push permission to the selected branch is unavailable.
- [ ] `--create-pr` uses the PR adapter and reports `prUrl`.
- [ ] Dirty or staged registry worktree fails before package staging.
- [x] Manifest and checksum files are deterministic and compatible with package checkout/search metadata.
- [x] Invalid source workflows and unsafe package ids fail before registry mutation.

## Completion Criteria

- [x] `rielflow publish` command is implemented for GitHub registry repositories.
- [x] Default registry URL and default local path match the design.
- [x] Personal registry config under `~/.rielflow` participates in registry resolution.
- [x] Publish validates source workflows before registry mutation.
- [x] Publish writes package payload, manifest, index, and checksum records.
- [x] Direct mode requires push permission and PR mode is adapter-backed.
- [x] Dry-run mode performs validation and reports planned changes without Git mutation.
- [x] Structured output uses `packageId`, `registryRef`, and `prUrl`; `packageName` appears only when serving nested compatibility callers.
- [ ] Tests cover dry run, permission failure, PR adapter behavior, dirty worktree rejection, manifest/checksum generation, and checkout/search compatibility.
- [ ] Required verification commands pass.

## Addressed Feedback

- Step 3 design review decision is accepted with no high or mid findings.
- Canonical command surface remains `rielflow publish <workflow-name-or-path>`.
- Nested `rielflow workflow package publish` is planned only as a compatibility route to the same service contract.
- Canonical package identity remains `packageId`; existing nested `--package-name` maps to `packageId`.
- The non-blocking low review finding about stale wording and search-command phrasing is noted as design cleanup, not an implementation blocker.

## Risks

- GitHub permission probing is advisory until final push or PR creation succeeds.
- md5 is acceptable for requested change tracking but not security integrity.
- Registry worktree mutation can conflict with user changes, so the first implementation must reject dirty worktrees.
- Metadata inferred from prompts may be low quality unless explicit package metadata is present.
- Publish depends on registry metadata/checksum/index contracts from the `registry-metadata-cache` feature slice.

## Progress Log

### Session: 2026-05-27

**Tasks Completed**: Created feature-local implementation plan for `package-publish-github`.
**Tasks In Progress**: None.
**Blockers**: Implementation depends on accepted registry metadata/cache contracts for manifest, checksum, index, and personal registry config behavior.
**Notes**: Plan reflects accepted review feedback from `step3-design-review`: proceed with `impl-plans/active/workflow-package-publish.md`, keep scope to GitHub-backed publish, add focused tests for dry-run publish, permission failures, PR adapter behavior, dirty-registry rejection, manifest/checksum generation, and checkout/search metadata compatibility.

### Session: 2026-05-27 14:08 JST Step 6 Implementation

**Tasks Completed**: Added `--package-id` compatibility for package publish and routed top-level `rielflow publish <workflow>` into the shared package publish command path.
**Tasks In Progress**: Direct permission denial tests, dirty-worktree tests, and PR adapter failure tests remain incomplete.
**Blockers**: None for the completed command alias work; remaining publish tasks require the next implementation pass.
**Notes**: The existing publish service remains a minimal Git-backed implementation and should not be considered complete against TASK-003 through TASK-007.

### Session: 2026-05-27 14:32 JST Step 6 Revision

**Tasks Completed**: Implemented publish dry-run staging without registry mutation, dirty registry refusal, non-destructive push probe before direct publish, branch checkout/create handling, `registry/index.json` and `registry/checksums.json` writes, canonical `packageId`/`registryRef`/`dryRun` output fields, artifact copy filtering, replaceable PR adapter boundary, and focused dry-run package test coverage.
**Tasks In Progress**: Direct permission-denial tests, dirty-registry tests, PR adapter failure tests, and full remote publish smoke remain.
**Blockers**: Live GitHub permission behavior requires credentials/remotes and is not exercised by local tests.
**Notes**: Focused package tests, CLI tests, typecheck, touched-file Biome, and diff whitespace checks passed after revision.

### Session: 2026-05-27 14:55 JST Step 7 Feedback Revision

**Tasks Completed**: Addressed Step 7 publish URL feedback by resolving explicit GitHub registry URLs from `--registry-url` or `--registry <url>` with `--local-path`, routing top-level `rielflow publish` through that flow, and adding focused service and CLI dry-run coverage.
**Tasks In Progress**: Remote clone/mismatch handling, permission-denial tests, dirty-registry tests, and PR adapter failure tests remain for follow-up hardening.
**Blockers**: Live push and PR behavior still require a credentialed GitHub remote.
**Notes**: Updated status/checklists to reflect implemented publish types, CLI routing, registry config resolution, package staging, metadata writes, dry-run behavior, and remaining gaps.

### Session: 2026-05-27 15:24 JST Step 7 Feedback Revision

**Tasks Completed**: Added `--registry-local-path` as a parsed alias for publish registry checkout paths and covered canonical top-level `rielflow publish <workflow> --registry <url> --registry-local-path <path> --dry-run --output json`.
**Tasks In Progress**: Remote clone/mismatch handling, permission-denial tests, dirty-registry tests, and PR adapter failure tests remain for follow-up hardening.
**Blockers**: Live push and PR behavior still require a credentialed GitHub remote.
**Notes**: This revision addresses Step 7 exec-000016 publish CLI option feedback.

### Session: 2026-05-27 15:38 JST Step 7 Feedback Revision

**Tasks Completed**: Added default package id derivation from the resolved workflow name, allowed canonical `rielflow publish` without `--package-id`, and resolved publish targets through the scoped workflow catalog when the positional target is not a direct workflow directory.
**Tasks In Progress**: Remote clone/mismatch handling, permission-denial tests, dirty-registry tests, and PR adapter failure tests remain for follow-up hardening.
**Blockers**: Live push and PR behavior still require a credentialed GitHub remote.
**Notes**: Added regression coverage for path-based publish without `--package-id` and project-scoped workflow-name publish.
