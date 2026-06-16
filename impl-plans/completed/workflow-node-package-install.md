# Workflow Node Package Install Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-workflow-node-package-install.md`
**Created**: 2026-06-02
**Last Updated**: 2026-06-02

## Design Reference

Implement the accepted issue-resolution design for distributing workflow node
add-ons through the existing Git-backed package registry and installing them
with plugin-style project/user scope semantics.

The source of truth is
`design-docs/specs/design-workflow-node-package-install.md`. Supporting design
references are `design-docs/specs/design-workflow-package-registry.md`,
`design-docs/specs/design-workflow-package-commands.md`,
`design-docs/specs/design-workflow-package-integrity.md`, and
`design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`.

## Issue Resolution Scope

Issue reference: `runtimeVariables.workflowInput.issueTitle`: Implement node
package distribution and install mechanism.

Workflow mode: `issue-resolution`

Review decision: `step3-design-review` returned
`reviewDecision: accepted_for_implementation_plan`, `needs_revision: false`,
and no findings.

Codex-agent references:

- `AGENTS.md`
- `design-docs/specs/design-workflow-package-registry.md`
- `design-docs/specs/design-workflow-package-commands.md`
- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`
- `packages/rielflow/src/workflow/packages/`
- `packages/rielflow/src/workflow/node-addons.ts`
- `packages/rielflow/src/workflow/local-node-addons.ts`
- `packages/rielflow/src/workflow/addon-package-boundary.ts`
- `packages/rielflow/src/cli.ts`
- `README.md`

Intentional divergences from Atom/browser plugin behavior:

- Install only declarative node add-on manifests/templates in this iteration.
- Do not execute npm, Bun, shell, TypeScript, lifecycle, or native executor
  package code during install.
- Do not download missing node packages during workflow load, validation, or
  execution.
- Do not add codex-agent-specific, Cursor-specific, or backend-specific package
  install behavior.

## Scope

In scope:

- Extend `rielflow-package.json` with package kind support where omitted `kind`
  defaults to `workflow` and `kind: "node-addon"` describes node packages.
- Add node add-on package manifest entries, search records, install results,
  checkout records, list/remove/status output, and CLI JSON fields.
- Validate staged node add-on package artifacts before writing add-on roots.
- Install package-owned add-ons into project/user add-on roots under
  `.rielflow/addons` or `~/.rielflow/addons`.
- Preserve existing workflow package install behavior and checkout records.
- Document first-iteration declarative plugin semantics in user-facing docs.

Out of scope:

- Package publish support for authoring node packages unless type changes are
  mechanically required by manifest parsing.
- Automatic update policy beyond preserving existing package update plumbing.
- Executable extension activation, native executor registration, node add-on
  package dependency installation, or lifecycle scripts.
- New top-level `node package`, `workflow node install`, or
  `workflow package` command trees.

## Modules

### 1. Package Kind And Manifest Types

#### `packages/rielflow/src/workflow/packages/types.ts`
#### `packages/rielflow/src/workflow/packages/manifest.ts`
#### `packages/rielflow/src/workflow/packages/index.ts`
#### `packages/rielflow/src/workflow/packages/search.ts`

**Status**: Completed

```typescript
export type WorkflowPackageKind = "workflow" | "node-addon";

export interface WorkflowPackageManifestAddonEntry {
  readonly name: string;
  readonly version: string;
  readonly sourcePath: string;
}

export interface WorkflowNodeAddonPackageManifest {
  readonly kind: "node-addon";
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly registry: string;
  readonly checksum: string;
  readonly checksumAlgorithm: WorkflowPackageChecksumAlgorithm;
  readonly addons: readonly WorkflowPackageManifestAddonEntry[];
  readonly integrity?: WorkflowPackageIntegrity;
  readonly title?: string;
  readonly authors?: readonly string[];
  readonly license?: string;
  readonly homepage?: string;
  readonly repository?: string;
  readonly examples?: readonly string[];
  readonly minimumRielflowVersion?: string;
  readonly dependencies?: readonly (
    | string
    | WorkflowPackageManifestDependencyEntry
  )[];
}

export interface NormalizedWorkflowNodeAddonPackageManifest
  extends WorkflowNodeAddonPackageManifest {
  readonly addons: readonly WorkflowPackageManifestAddonEntry[];
  readonly dependencies: readonly WorkflowPackageManifestDependencyEntry[];
}

export type AnyWorkflowPackageManifest =
  | NormalizedWorkflowPackageManifest
  | NormalizedWorkflowNodeAddonPackageManifest;

export interface WorkflowPackageIndexRecord {
  readonly kind: WorkflowPackageKind;
}

export interface WorkflowPackageSearchInput {
  readonly kind?: WorkflowPackageKind;
}
```

**Checklist**:

- [x] Add `WorkflowPackageKind` and node add-on manifest/add-on entry types.
- [x] Treat omitted `kind` as `workflow` for existing package manifests.
- [x] Reject `kind: "node-addon"` manifests with workflow-only required
      metadata and reject invalid `addons[]` entries.
- [x] Preserve existing workflow manifest normalization and tests.
- [x] Add `kind` to index/search records and optional `--kind` filtering.

### 2. Node Add-on Package Artifact Validation

#### `packages/rielflow/src/workflow/packages/node-addon-install.ts`
#### `packages/rielflow/src/workflow/addon-package-boundary.ts`
#### `packages/rielflow/src/workflow/packages/pre-install-scanner.ts`

**Status**: Completed

```typescript
export interface WorkflowPackageAddonArtifact {
  readonly addonName: string;
  readonly addonVersion: string;
  readonly sourcePath: string;
  readonly sourceDirectory: string;
  readonly manifestPath: string;
  readonly allowedFiles: readonly string[];
  readonly contentDigest: string;
  readonly contentDigestAlgorithm: "sha256";
}

export interface ValidateWorkflowPackageAddonsInput {
  readonly packageRoot: string;
  readonly addons: readonly WorkflowPackageManifestAddonEntry[];
}

export function validateWorkflowPackageAddons(
  input: ValidateWorkflowPackageAddonsInput,
): Promise<Result<readonly WorkflowPackageAddonArtifact[], WorkflowPackageFailure>>;
```

**Checklist**:

- [x] Reject absolute paths, parent traversal, symlink escapes, duplicate
      `(name, version)` entries, empty `addons[]`, and `rielflow/*` names.
- [x] Load each staged `addon.json` and require name/version to match the
      package manifest entry.
- [x] Reuse local add-on structural validation where available.
- [x] Reject executable lifecycle hooks, native executor registration, package
      scripts, undeclared environment forwarding, and unsupported files.
- [x] Return package-relative allowed files and a per-add-on SHA-256 digest for
      provenance.

### 3. Node Add-on Projection And Package Checkout Records

#### `packages/rielflow/src/workflow/packages/checkout.ts`
#### `packages/rielflow/src/workflow/packages/checkout-records.ts`
#### `packages/rielflow/src/workflow/packages/status.ts`
#### `packages/rielflow/src/workflow/packages/types.ts`

**Status**: Completed

```typescript
export interface WorkflowPackageAddonInstallTarget
  extends WorkflowPackageAddonArtifact {
  readonly scope: WorkflowCheckoutScope;
  readonly destinationDirectory: string;
  readonly manifestPath: string;
}

export interface WorkflowNodeAddonPackageCheckoutResult {
  readonly packageKind: "node-addon";
  readonly packageId: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly scope: WorkflowCheckoutScope;
  readonly registryUrl: string;
  readonly registryRef: string;
  readonly sourcePath: string;
  readonly sourceDirectory: string;
  readonly metadataPath: string;
  readonly checkoutRecordPath: string;
  readonly checksum: string;
  readonly checksumAlgorithm: WorkflowPackageChecksumAlgorithm;
  readonly integrityDigest?: string;
  readonly addons: readonly WorkflowPackageAddonInstallTarget[];
  readonly installId: string;
  readonly overwritten: boolean;
  readonly updated: boolean;
}
```

**Checklist**:

- [x] Route `checkoutWorkflowPackage` by package kind after shared registry,
      staging, checksum, integrity, and pre-install checks succeed.
- [x] Install node add-ons to project scope by default and user scope when
      `--user-scope` is selected.
- [x] Keep `--workflow-definition-dir` workflow-package-only and do not redirect
      node add-on projection.
- [x] Fail duplicate add-on destination writes unless `--overwrite` is supplied
      and the existing destination is package-owned.
- [x] Write checkout records with `packageKind: "node-addon"` and `addons[]`.
- [x] Make list, status, remove, and update package-kind-aware without
      regressing workflow package checkouts.

### 4. CLI Command Surface And User Documentation

#### `packages/rielflow/src/cli/workflow-package-command-handler.ts`
#### `packages/rielflow/src/cli/argument-parser.ts`
#### `README.md`
#### `design-docs/specs/command.md`
#### `design-docs/specs/design-workflow-package-commands.md`

**Status**: Completed

```typescript
export interface WorkflowPackageCliJsonResult {
  readonly packageKind: WorkflowPackageKind;
}

export interface WorkflowPackageSearchCliResult {
  readonly packages: readonly WorkflowPackageSearchRecord[];
}
```

**Checklist**:

- [x] Keep `rielflow package install <package-id>` as the canonical install
      command for both workflow and node-addon packages.
- [x] Add `packageKind`/`kind` to JSON output for search, install, list,
      status, remove, and update surfaces where package records are emitted.
- [x] Add optional `package search --kind workflow|node-addon` parsing and
      validation if the search implementation exposes kind filtering.
- [x] Text output must name installed add-ons and scope for node packages.
- [x] README and help-facing docs must say node packages are declarative add-on
      packages, not executable plugins.

### 5. Loader Boundary And Authored Workflow Validation

#### `packages/rielflow/src/workflow/local-node-addons.ts`
#### `packages/rielflow/src/workflow/node-addons.ts`
#### `packages/rielflow/src/workflow/authored-workflow.test.ts`
#### `packages/rielflow/src/workflow/packages/packages.test.ts`

**Status**: Completed

```typescript
export interface InstalledWorkflowPackageAddonSource {
  readonly packageId: string;
  readonly packageKind: "node-addon";
  readonly addonName: string;
  readonly addonVersion: string;
  readonly scope: WorkflowCheckoutScope;
  readonly manifestPath: string;
  readonly destinationDirectory: string;
}
```

**Checklist**:

- [x] Preserve add-on lookup order: built-in, explicit root, project root, user
      root, host resolver.
- [x] Ensure installed add-ons resolve through existing local add-on roots with
      no network access during workflow load, validation, or execution.
- [x] Surface resolved add-on source paths in validation/search/install output
      where existing types support source reporting.
- [x] Add tests proving installed project/user add-ons can be referenced by
      `workflow.json.nodes[].addon`.
- [x] Add tests proving package-provided `rielflow/*` add-ons cannot shadow
      built-ins.

### 6. Focused Unit And CLI Regression Tests

#### `packages/rielflow/src/workflow/packages/packages.test.ts`
#### `packages/rielflow/src/workflow/addon-package-boundary.test.ts`
#### `packages/rielflow/src/workflow/authored-workflow.test.ts`
#### `packages/rielflow/src/cli.test.ts`

**Status**: Completed

```typescript
interface NodeAddonPackageFixtureInput {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly addons: readonly WorkflowPackageManifestAddonEntry[];
  readonly registryRoot: string;
}
```

**Checklist**:

- [x] Add fixtures for valid node-addon packages, unsafe source paths,
      duplicate add-ons, `rielflow/*` shadow attempts, executable package
      content, and checksum/integrity mismatch cases.
- [x] Assert workflow manifests with omitted `kind` still install as workflow
      packages.
- [x] Assert search/list/install JSON includes `kind` or `packageKind`.
- [x] Assert remove deletes package-owned add-on directories and does not remove
      unrelated or non-owned local add-ons.
- [x] Assert `--overwrite`, `--yes`, `--user-scope`, and
      `--workflow-definition-dir` behavior matches the accepted design.

### 7. Final Documentation And Plan Progress Update

#### `impl-plans/active/workflow-node-package-install.md`
#### `impl-plans/README.md`
#### `README.md`

**Status**: Completed

```typescript
interface WorkflowNodePackageDocumentationChecklist {
  readonly commandSurfaceDocumented: boolean;
  readonly declarativePluginBoundaryDocumented: boolean;
  readonly verificationCommandsRecorded: readonly string[];
}
```

**Checklist**:

- [x] Update this plan's task statuses and progress log after each
      implementation session.
- [x] Keep implementation documentation aligned with the accepted design and
      actual CLI JSON fields.
- [ ] Move this plan to `impl-plans/completed/` only after all completion
      criteria pass.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Package kind and manifest types | `packages/rielflow/src/workflow/packages/types.ts`, `packages/rielflow/src/workflow/packages/manifest.ts` | Completed | `packages/rielflow/src/workflow/packages/packages.test.ts` |
| Search/index kind support | `packages/rielflow/src/workflow/packages/index.ts`, `packages/rielflow/src/workflow/packages/search.ts` | Completed | `packages/rielflow/src/workflow/packages/packages.test.ts`, `packages/rielflow/src/cli.test.ts` |
| Node add-on artifact validation | `packages/rielflow/src/workflow/packages/node-addon-install.ts`, `packages/rielflow/src/workflow/addon-package-boundary.ts` | Completed | `packages/rielflow/src/workflow/addon-package-boundary.test.ts`, `packages/rielflow/src/workflow/packages/packages.test.ts` |
| Node add-on projection and records | `packages/rielflow/src/workflow/packages/checkout.ts`, `packages/rielflow/src/workflow/packages/checkout-node-addon.ts`, `packages/rielflow/src/workflow/packages/checkout-records.ts`, `packages/rielflow/src/workflow/packages/status.ts` | Completed | `packages/rielflow/src/workflow/packages/packages.test.ts` |
| CLI and docs | `packages/rielflow/src/cli/workflow-package-command-handler.ts`, `packages/rielflow/src/cli/argument-parser.ts`, `packages/rielflow/src/cli/run-cli.ts`, `README.md` | Completed | `packages/rielflow/src/cli.test.ts` |
| Authored workflow validation | `packages/rielflow/src/workflow/local-node-addons.ts`, `packages/rielflow/src/workflow/node-addons.ts` | Completed | `packages/rielflow/src/workflow/authored-workflow.test.ts`, `packages/rielflow/src/workflow/packages/packages.test.ts` |

## Dependencies

| Task | Depends On | Status |
| --- | --- | --- |
| TASK-001: Package kind and manifest types | None | Completed |
| TASK-002: Node add-on artifact validation | TASK-001 | Completed |
| TASK-003: Node add-on projection and checkout records | TASK-001, TASK-002 | Completed |
| TASK-004: CLI command surface and docs | TASK-001, TASK-003 for install/list/remove output | Completed |
| TASK-005: Loader boundary and authored workflow validation | TASK-002, TASK-003 | Completed |
| TASK-006: Focused unit and CLI regression tests | TASK-001 through TASK-005 | Completed |
| TASK-007: Final documentation and plan progress update | TASK-004, TASK-006 | Completed |

## Parallelization

- TASK-001 is the required foundation and should run first.
- TASK-002 may begin after TASK-001 and has a disjoint primary write scope from
  CLI documentation work.
- TASK-004 documentation-only edits can start after TASK-001, but CLI handler
  assertions must wait for TASK-003.
- TASK-005 can run in parallel with CLI text/README work after TASK-003 because
  its primary write scope is workflow add-on validation tests and resolver
  boundaries.
- TASK-006 should be the integration pass after feature code is present.

## Completion Criteria

- [x] Existing workflow package manifests without `kind` still parse and
      install as workflow packages.
- [x] `kind: "node-addon"` packages validate required manifest and `addons[]`
      fields.
- [x] Node add-on package install writes only validated declarative add-on files
      to project/user add-on roots.
- [x] Package checkout records include `packageKind: "node-addon"` and
      installed add-on artifact provenance.
- [x] Package search, install, list, status, remove, and update output expose
      package kind explicitly.
- [x] Missing node packages are not fetched during workflow load, validation, or
      execution.
- [x] `rielflow/*` package-provided add-ons and executable plugin behavior are
      rejected.
- [x] User-facing documentation explains the declarative plugin-style model and
      command surface.
- [x] Focused tests and type checking pass.

## Verification Plan

Required focused commands:

```bash
bun test packages/rielflow/src/workflow/packages/packages.test.ts
bun test packages/rielflow/src/workflow/addon-package-boundary.test.ts
bun test packages/rielflow/src/workflow/authored-workflow.test.ts
bun test packages/rielflow/src/cli.test.ts
bun run packages/rielflow/src/bin.ts package search --output json
bun run packages/rielflow/src/bin.ts package install <node-package-id> --output json
bun run packages/rielflow/src/bin.ts package list --output json
bun run tsc --noEmit
git diff --check
```

Manual JSON review:

- Confirm `package search --output json` includes `kind`.
- Confirm `package install <node-package-id> --output json` includes
  `packageKind: "node-addon"`, `addons[]`, `scope`, `checkoutRecordPath`,
  checksum fields, and integrity fields when present.
- Confirm `package list --output json` includes node-addon installs alongside
  workflow installs without ambiguous selectors.

## Progress Log

### Session: 2026-06-02 00:00

**Tasks Completed**: Implementation plan created after Step 3 accepted the
design.

**Tasks In Progress**: None.

**Blockers**: None.

**Notes**: Later implementation sessions must update task status checklists and
record executed verification commands before moving the plan to completed.

### Session: 2026-06-02 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005,
TASK-006, TASK-007.

**Tasks In Progress**: None.

**Blockers**: None.

**Notes**: Implemented package kind normalization, node-addon package manifest
validation, declarative add-on artifact validation and projection, package-kind
aware checkout records/list/status/remove/update/search output, CLI
`package search --kind workflow|node-addon`, user-facing README coverage, and
focused regression tests. Verification executed:
`bun install --frozen-lockfile`,
`bun run format`,
`bun run lint:biome`,
`bun run typecheck`,
`bun test packages/rielflow/src/workflow/packages/packages.test.ts packages/rielflow/src/workflow/addon-package-boundary.test.ts packages/rielflow/src/workflow/authored-workflow.test.ts packages/rielflow/src/cli.test.ts`,
`bun packages/rielflow/src/bin.ts package search --output json`,
`bun packages/rielflow/src/bin.ts package search --kind node-addon --output json`,
`bun packages/rielflow/src/bin.ts package list --output json`, and
`git diff --check`.

### Session: 2026-06-02 Step 7 Remediation

**Tasks Completed**: TASK-002, TASK-003, TASK-006 follow-up hardening.

**Tasks In Progress**: None.

**Blockers**: None.

**Notes**: Addressed Step 7 mid findings by making node-addon overwrite reject
any existing planned destination that is not present in the previous
node-addon checkout record, and by changing node-addon install projection to
copy only `addon.json` plus template files referenced from the local add-on
manifest. Added regression tests for unrelated local add-on collision,
unreferenced package files, and credential-like files. Verification executed:
`bun run format`,
`bun test packages/rielflow/src/workflow/packages/packages.test.ts`,
`bun run lint:biome`, and
`bun run typecheck`.

### Session: 2026-06-02 Step 7 Dependency Remediation

**Tasks Completed**: TASK-001, TASK-003, TASK-004, TASK-006 follow-up
hardening.

**Tasks In Progress**: None.

**Blockers**: None.

**Notes**: Addressed Step 7 mid finding that node-addon manifest dependencies
were normalized but ignored during checkout. This first iteration now rejects
node-addon packages with declared dependencies during checkout instead of
silently ignoring them, and README/design text documents that boundary. Added
regression coverage for a node-addon package with a declared dependency.

## Related Plans

- **Depends On**: `impl-plans/active/workflow-package-registry.md`,
  `impl-plans/active/workflow-package-checkout.md`,
  `impl-plans/active/workflow-package-checkout-search.md`,
  `impl-plans/scoped-local-addons.md`,
  `impl-plans/third-party-addon-resolution.md`
- **Design Source**:
  `design-docs/specs/design-workflow-node-package-install.md`
