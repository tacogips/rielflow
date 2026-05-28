# Workflow And Skill Package Checkout Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-workflow-package-checkout.md`
**Created**: 2026-05-28
**Last Updated**: 2026-05-28

## Design Reference

Implement feature-local checkout support for
`package-checkout-skill-installation`.

This plan covers registry package checkout for packages that may contain
separated `workflows/` and `skills/` directories, vendor allow-listed skill
validation, user-scope managed skill storage under `~/.rielflow-managed`, safe
vendor projection, package provenance/update metadata, clean-install update
behavior, confirmation requirements, CLI output, docs, and tests.

This plan does not implement package publish behavior, registry search ranking,
sqlite as a required cache backend, non-GitHub registry backends, workflow
package dependencies, add-on installation, or execution of package skill
scripts.

## Issue Resolution Scope

Issue reference: `workflowInput: Package workflows with vendor-scoped skills and
checkout update metadata`

Workflow mode: `issue-resolution`

Feature id: `package-checkout-skill-installation`

Fanout feature ids:

- `package-checkout-skill-installation`

Accepted review decision: `step3-design-review` accepted
`design-docs/specs/design-workflow-package-checkout.md` with one low finding:
the local provenance summary should repeat `projectRootIdentity` and
`workflowDefinitionDirOverride` for consistency with
`design-docs/specs/design-workflow-package-update.md`. No high or mid findings
block implementation planning.

## Codex Agent References

- `AGENTS.md`
- `design-docs/specs/design-workflow-package-checkout.md`
- `design-docs/specs/design-workflow-package-skills.md`
- `design-docs/specs/design-workflow-package-update.md`
- `design-docs/specs/design-workflow-package-registry.md`
- `design-docs/specs/design-workflow-package-checkout-search.md`
- `design-docs/specs/design-workflow-package-publish.md`
- `design-docs/user-qa/qa-workflow-package-checkout.md`
- `https://github.com/openai/codex/blob/main/docs/skills.md`
- `https://docs.claude.com/en/docs/claude-code/skills`
- `https://docs.cursor.com/en/context`
- `https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html`
- `packages/rielflow/src/workflow/packages/checkout.ts`
- `packages/rielflow/src/workflow/packages/types.ts`
- `packages/rielflow/src/workflow/packages/checksum.ts`
- `packages/rielflow/src/workflow/packages/manifest.ts`
- `packages/rielflow/src/workflow/packages/search.ts`
- `packages/rielflow/src/workflow/checkout/index.ts`
- `packages/rielflow/src/workflow/checkout/registry.ts`
- `packages/rielflow/src/workflow/checkout/types.ts`
- `packages/rielflow/src/cli/workflow-package-command-handler.ts`
- `packages/rielflow/src/cli/argument-parser.ts`
- `packages/rielflow/src/cli.test.ts`

## Modules

### 1. Package Skill Public Types

#### `packages/rielflow/src/workflow/packages/types.ts`

**Status**: Completed

```typescript
export type WorkflowPackageSkillVendor =
  | "agents"
  | "claude"
  | "codex"
  | "cursor"
  | "gemini";

export type WorkflowPackageSkillInstallMode = "managed-only" | "projected";

export interface WorkflowPackageSkillSelection {
  readonly vendor: WorkflowPackageSkillVendor;
  readonly name: string;
  readonly sourcePath: string;
  readonly projectionPath?: string;
  readonly installMode: WorkflowPackageSkillInstallMode;
}

export interface WorkflowPackageResolvedSelection {
  readonly packageId: string;
  readonly workflowName?: string;
  readonly version: string;
  readonly registryUrl: string;
  readonly registryRef: string;
  readonly sourceDirectory: string;
  readonly metadataPath: string;
  readonly checksum?: string;
  readonly checksumAlgorithm?: string;
  readonly workflowDirectory?: string;
  readonly skillDirectory?: string;
  readonly packageHash: string;
  readonly integrity?: string;
  readonly skills: readonly WorkflowPackageSkillSelection[];
  readonly workflowDefinitionDirOverride?: string;
  readonly projectRootIdentity?: string;
}
```

**Checklist**:

- [x] Add vendor, install-mode, skill selection, and resolved selection types.
- [x] Extend package failure codes for invalid package id, ambiguous package,
      checksum mismatch, invalid skill vendor, invalid skill entry, update
      confirmation, unsafe skill projection, ambiguous package install lookup,
      unsupported endpoint, incompatible checkout options, and unsafe
      destination.
- [x] Keep current workflow-only package fields backward compatible.
- [x] Export types from the existing package barrel if present.

### 2. Package Layout And Skill Validation

#### `packages/rielflow/src/workflow/packages/skills.ts`

**Status**: Completed

```typescript
export interface ValidateWorkflowPackageSkillsInput {
  readonly packageRoot: string;
  readonly skillDirectory?: string;
}

export interface ValidatedWorkflowPackageSkill {
  readonly vendor: WorkflowPackageSkillVendor;
  readonly name: string;
  readonly sourcePath: string;
  readonly requiredFilePath: string;
  readonly checksum: string;
}

export function validateWorkflowPackageSkills(
  input: ValidateWorkflowPackageSkillsInput,
): Promise<Result<readonly ValidatedWorkflowPackageSkill[], WorkflowPackageFailure>>;
```

**Checklist**:

- [x] Enforce immediate `skills/` children allow-list:
      `agents`, `claude`, `codex`, `cursor`, `gemini`.
- [x] Validate required vendor formats: `AGENTS.md`, `SKILL.md`,
      `.cursor/rules`-style `.mdc` files, and `GEMINI.md`.
- [x] Reject path traversal, absolute paths, symlink escapes, unknown vendors,
      empty skill names, and malformed skill entries.
- [x] Compute per-skill entry checksums for provenance and update diagnosis.
- [x] Add unit tests for valid mixed packages and each invalid vendor/entry
      error.

### 3. Package Checksum And Manifest Inputs

#### `packages/rielflow/src/workflow/packages/checksum.ts`
#### `packages/rielflow/src/workflow/packages/manifest.ts`

**Status**: Completed

```typescript
export interface WorkflowPackageChecksumInput {
  readonly packageRoot: string;
  readonly workflowDirectory?: string;
  readonly skillDirectory?: string;
}

export interface WorkflowPackageManifestSkillEntry {
  readonly vendor: WorkflowPackageSkillVendor;
  readonly name: string;
  readonly sourcePath: string;
}
```

**Checklist**:

- [x] Include workflow files, skill files, package metadata, prompts, nodes, and
      package-local files in package checksum input.
- [x] Exclude `.git`, runtime artifacts, cache files, and local staging
      artifacts.
- [x] Preserve algorithm-prefixed checksum output and continue supporting
      `md5:<hex>`.
- [x] Allow workflow-only and mixed workflow+skill package manifests while
      preserving the primary workflow requirement for checkout identity.
- [x] Add checksum tests proving skill changes alter `packageHash`.

### 4. Managed Skill Installation And Projection

#### `packages/rielflow/src/workflow/packages/skill-install.ts`

**Status**: Completed

```typescript
export interface WorkflowPackageSkillInstallTarget {
  readonly vendor: WorkflowPackageSkillVendor;
  readonly name: string;
  readonly managedPath: string;
  readonly projectionPath?: string;
  readonly installMode: WorkflowPackageSkillInstallMode;
}

export interface InstallWorkflowPackageSkillsInput {
  readonly packageId: string;
  readonly versionOrRef: string;
  readonly scope: WorkflowCheckoutScope;
  readonly projectRoot: string;
  readonly userRoot: string;
  readonly managedRoot?: string;
  readonly skills: readonly ValidatedWorkflowPackageSkill[];
  readonly overwrite: boolean;
}

export function installWorkflowPackageSkills(
  input: InstallWorkflowPackageSkillsInput,
): Promise<Result<readonly WorkflowPackageSkillInstallTarget[], WorkflowPackageFailure>>;
```

**Checklist**:

- [x] Resolve user managed root to
      `~/.rielflow-managed/packages/<package-id>/<version-or-ref>/skills/`.
- [x] Project Claude user skills to `~/.claude/skills/<skill-name>/` and Codex
      user skills to `$CODEX_HOME/skills/<skill-name>/` or
      `~/.codex/skills/<skill-name>/` only when safe.
- [x] Project project-scope `agents`, `claude`, `cursor`, and `gemini` entries
      to their design-defined project paths.
- [x] Project project-scope Codex skills to
      `<project-root>/.codex/skills/<skill-name>/` after the same containment,
      ownership, and overwrite checks used by other projected skill vendors.
- [x] Keep user-scope `agents`, `cursor`, and `gemini` projections
      managed-only by default while reporting successful managed installation.
- [x] Never follow symlinks out of the destination root.
- [x] Copy files without executing package scripts.

### 5. Atomic Package Checkout, Backups, And Rollback

#### `packages/rielflow/src/workflow/packages/checkout.ts`

**Status**: Completed

```typescript
export interface WorkflowPackageCheckoutInput {
  readonly packageId?: string;
  readonly packageName: string;
  readonly registry?: string;
  readonly branch?: string;
  readonly userScope?: boolean;
  readonly overwrite?: boolean;
  readonly yes?: boolean;
  readonly options?: WorkflowPackageRegistryConfigOptions;
  readonly workflowDefinitionDir?: string;
}

export interface WorkflowPackageCheckoutResult {
  readonly packageId: string;
  readonly workflowName?: string;
  readonly scope: WorkflowCheckoutScope;
  readonly destinationDirectory?: string;
  readonly registryUrl: string;
  readonly registryRef: string;
  readonly sourceDirectory: string;
  readonly metadataPath: string;
  readonly checksum?: string;
  readonly checksumAlgorithm?: string;
  readonly checkoutRecordPath: string;
  readonly overwritten: boolean;
  readonly updated: boolean;
  readonly skills: readonly WorkflowPackageSkillInstallTarget[];
  readonly managedSkillRoot?: string;
  readonly packageHash: string;
  readonly installId: string;
  readonly workflowDefinitionDirOverride?: string;
  readonly projectRootIdentity?: string;
}
```

**Checklist**:

- [x] Keep direct GitHub directory checkout detection before package id
      resolution.
- [x] Resolve package id, registry, branch/ref, workflow directory, and skill
      directory into one normalized selection.
- [x] Validate staged workflows and skills before mutating destinations.
- [x] Resolve `--workflow-definition-dir` as a project-scope workflow
      destination root and install the workflow to
      `<workflow-definition-dir>/<workflow-name>`.
- [x] Keep skill managed roots and vendor projections tied to the discovered
      project root when `--workflow-definition-dir` points elsewhere.
- [x] Reject `--workflow-definition-dir` with `--user-scope` for the first
      implementation and continue rejecting `--endpoint` for all checkout
      paths.
- [x] Refuse duplicate checkout, projection, or record writes unless overwrite
      and confirmation requirements are satisfied.
- [x] Backup workflow destination, managed skill root, vendor projections, and
      provenance before clean-install update.
- [x] Restore all backups when any workflow, skill, projection, or provenance
      write fails.

### 6. Provenance And Update Detection

#### `packages/rielflow/src/workflow/checkout/registry.ts`
#### `packages/rielflow/src/workflow/packages/checkout.ts`

**Status**: Completed

```typescript
export interface WorkflowPackageCheckoutSkillRecord {
  readonly vendor: WorkflowPackageSkillVendor;
  readonly name: string;
  readonly sourcePath: string;
  readonly managedPath: string;
  readonly projectionPath?: string;
  readonly installMode: WorkflowPackageSkillInstallMode;
  readonly checksum: string;
}

export interface WorkflowPackageCheckoutRegistryFields {
  readonly checkoutKind: "package";
  readonly installId: string;
  readonly packageId: string;
  readonly packageName?: string;
  readonly version: string;
  readonly registryUrl: string;
  readonly registryRef: string;
  readonly sourceDirectory: string;
  readonly metadataPath: string;
  readonly checksum?: string;
  readonly checksumAlgorithm?: string;
  readonly integrity?: string;
  readonly workflowDirectory?: string;
  readonly projectRootIdentity?: string;
  readonly workflowDefinitionDirOverride?: string;
  readonly managedSkillRoot?: string;
  readonly skills: readonly WorkflowPackageCheckoutSkillRecord[];
  readonly packageHash: string;
  readonly installedArtifacts: readonly WorkflowPackageInstalledArtifactRecord[];
}
```

**Checklist**:

- [x] Extend checkout records with package metadata while preserving direct URL
      records.
- [x] Store package records under
      `~/.rielflow/workflow-registry/checkouts/<install-id>.json`, with
      `installId` derived from scope, normalized workflow destination
      directory, project root identity for project scope, package id, and
      workflow name.
- [x] Write workflow-local `.rielflow-package-provenance.json` with
      `installId`, `projectRootIdentity`, and whether
      `workflowDefinitionDirOverride` was used.
- [x] Resolve status/update by `--install-id` first; otherwise resolve by
      scope, workflow name, current project root identity, and direct
      destination metadata, reporting ambiguity when multiple package records
      match.
- [x] Detect changed package records from registry URL/ref, version, source
      directory, metadata path, checksum algorithm/value, package hash, and
      skill list/checksums.
- [x] Remove stale package-owned skill entries on confirmed clean install.
- [x] Leave unrelated project/user files untouched.

### 7. CLI Checkout, Status, Update, Confirmation, And Output

#### `packages/rielflow/src/cli/argument-parser.ts`
#### `packages/rielflow/src/cli/workflow-package-command-handler.ts`

**Status**: Completed

```typescript
export interface WorkflowPackageCheckoutCliOptions {
  readonly registry?: string;
  readonly branch?: string;
  readonly userScope?: boolean;
  readonly workflowDefinitionDir?: string;
  readonly overwrite?: boolean;
  readonly yes?: boolean;
  readonly output?: "json" | "text";
}

export interface WorkflowPackageStatusOrUpdateCliOptions {
  readonly scope?: "project" | "user";
  readonly installId?: string;
  readonly yes?: boolean;
  readonly output?: "json" | "text";
}
```

**Checklist**:

- [x] Support `rielflow cli workflow checkout <package-id>` package targets
      without breaking direct URL checkout.
- [x] Preserve package command compatibility for
      `rielflow cli workflow package checkout <package-id>` if still exposed.
- [x] Implement `rielflow cli workflow package status <workflow-name>` lookup
      for package records only, with `--scope project|user`,
      `--install-id`, text output, and JSON output.
- [x] Implement `rielflow cli workflow package update <workflow-name>` as a
      clean reinstall path using the package record lookup, with
      `--scope project|user`, `--install-id`, `--yes`, text output, and JSON
      output.
- [x] Surface ambiguity errors when workflow name plus scope/project root or
      direct destination matches multiple package records, instructing users to
      retry with `--install-id`.
- [x] Support `--workflow-definition-dir` as a direct workflow destination root
      for package checkout and reject `--endpoint`.
- [x] Preserve workflow checkout direct URL support for
      `--workflow-definition-dir`, installing the bundle directly to
      `<workflow-definition-dir>/<workflow-name>` rather than beneath
      `.rielflow/workflows`.
- [x] Require confirmation for checkout overwrite and package update mutation
      by default, fail noninteractive update without `--yes`, and honor `--yes`
      as the noninteractive bypass.
- [x] Print text fields: package, workflow, scope, destination, registry,
      checksum, skills, updated.
- [x] Emit checkout JSON fields required by
      `design-docs/specs/design-workflow-package-checkout.md`.
- [x] Emit status/update JSON fields required by
      `design-docs/specs/design-workflow-package-update.md`: installed and
      available versions/checksums/integrity, installed artifacts, changed
      artifacts, `installId`, `checkoutRecordPath`, `provenancePath`,
      `confirmationSkipped`, and update status.

### 8. Documentation, Fixtures, And Tests

#### `README.md`
#### `design-docs/specs/design-workflow-package-checkout.md`
#### `packages/rielflow/src/workflow/packages/checkout.test.ts`
#### `packages/rielflow/src/workflow/checkout/checkout.test.ts`
#### `packages/rielflow/src/cli.test.ts`

**Status**: Completed

```typescript
interface WorkflowPackageSkillFixture {
  readonly packageId: string;
  readonly layout: "workflow-only" | "mixed";
  readonly vendors: readonly WorkflowPackageSkillVendor[];
}
```

**Checklist**:

- [x] Add fixtures for workflow-only and mixed workflow+skill packages.
- [x] Add tests for all five vendor directories and managed-only projection
      cases.
- [x] Add tests for update detection, clean install, stale skill removal, and
      rollback.
- [x] Add CLI tests for text/JSON output, confirmation refusal, and `--yes`.
- [x] Add CLI tests for `workflow package status` and
      `workflow package update`, including `--scope`, `--install-id`,
      ambiguity errors, no-op up-to-date updates, noninteractive mutation
      refusal without `--yes`, `--yes` mutation, and text/JSON output
      contracts.
- [x] Add CLI and package checkout tests proving `--workflow-definition-dir`
      installs directly to `<workflow-definition-dir>/<workflow-name>`, does
      not use the override path as the project root for skill projections, and
      rejects incompatible `--user-scope` or `--endpoint` options.
- [x] Add a focused verification or refactor task for
      `packages/rielflow/src/cli/argument-parser.ts` so the known Biome
      line-count failure no longer blocks touched-file checks.
- [x] Update user-facing docs with package layout, vendor mapping, and update
      semantics.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Package skill public types | `packages/rielflow/src/workflow/packages/types.ts` | Completed | Unit |
| Package layout and skill validation | `packages/rielflow/src/workflow/packages/skills.ts` | Completed | Unit |
| Package checksum and manifest inputs | `packages/rielflow/src/workflow/packages/checksum.ts`, `packages/rielflow/src/workflow/packages/manifest.ts` | Completed | Unit |
| Managed skill installation and projection | `packages/rielflow/src/workflow/packages/skill-install.ts` | Completed | Unit |
| Atomic package checkout | `packages/rielflow/src/workflow/packages/checkout.ts` | Completed | Unit/Integration |
| Provenance and update detection | `packages/rielflow/src/workflow/checkout/registry.ts`, `packages/rielflow/src/workflow/packages/checkout.ts` | Completed | Unit/Integration |
| CLI checkout/status/update flags and output | `packages/rielflow/src/cli/argument-parser.ts`, `packages/rielflow/src/cli/workflow-package-command-handler.ts` | Completed | CLI |
| Documentation and fixtures | `README.md`, tests | Completed | Regression |
| CLI parser size verification | `packages/rielflow/src/cli/argument-parser.ts` or extracted helper module | Completed | Biome |

## Dependencies

| Task | Depends On | Status |
|------|------------|--------|
| TASK-001 Package Skill Public Types | Accepted design | Completed |
| TASK-002 Package Layout And Skill Validation | TASK-001 | Completed |
| TASK-003 Package Checksum And Manifest Inputs | TASK-001 | Completed |
| TASK-004 Managed Skill Installation And Projection | TASK-001, TASK-002 | Completed |
| TASK-005 Atomic Package Checkout | TASK-002, TASK-003, TASK-004 | Completed |
| TASK-006 Provenance And Update Detection | TASK-001, TASK-005 | Completed |
| TASK-007 CLI Checkout, Status, Update, Confirmation, And Output | TASK-005, TASK-006 | Completed |
| TASK-008 Documentation, Fixtures, And Tests | TASK-001 through TASK-007 | Completed |
| TASK-009 CLI Parser Size Verification | TASK-007 | Completed |

## Parallelizable Tasks

- TASK-002 and TASK-003 can run in parallel after TASK-001.
- TASK-006 record-shape tests can start after TASK-001 while checkout wiring
  waits for TASK-005.
- TASK-008 fixture authoring can start after TASK-001 and TASK-002 define the
  accepted package layouts.
- TASK-009 is not parallelizable with TASK-007 because both may edit
  `packages/rielflow/src/cli/argument-parser.ts`.

## Completion Criteria

- [x] Package checkout accepts separated primary workflow and optional
      `skills/` package layouts.
- [x] Checkout rejects any skill vendor outside `agents`, `claude`, `codex`,
      `cursor`, and `gemini`.
- [x] User-scope skills are copied under `~/.rielflow-managed` and projected
      only to safe vendor locations.
- [x] Project-scope skills install to documented project-local locations, with
      Codex project projection targeting
      `<project-root>/.codex/skills/<skill-name>/`.
- [x] Package checkout and direct workflow checkout both support
      `--workflow-definition-dir` as a direct workflow destination root and
      install to `<workflow-definition-dir>/<workflow-name>`.
- [x] Package checkout keeps direct destination overrides separate from project
      root identity, managed skill roots, and vendor projection roots.
- [x] Package records use collision-safe `installId` lookup and preserve
      `projectRootIdentity` plus `workflowDefinitionDirOverride` in catalog and
      workflow-local provenance.
- [x] Registry URL, workflow name, version, integrity/hash, package hash,
      checksum, managed skill root, and skill records are persisted.
- [x] Changed package metadata is detected and clean-install update behavior
      removes stale package-owned content only after confirmation or `--yes`.
- [x] `workflow package status` and `workflow package update` support
      `--scope`, `--install-id`, package-record-only lookup, ambiguity errors,
      noninteractive update refusal without `--yes`, and design-required
      text/JSON output.
- [x] Rollback restores workflow destination, managed skill root, projections,
      and provenance on failure.
- [x] Text and JSON CLI outputs expose package, workflow, scope, destination,
      registry, checksum, skill count/list, status/update state, and updated
      status.
- [x] Documentation describes package layout, vendor mappings, projection rules,
      update behavior, and confirmation semantics.
- [x] Verification commands pass.

## Verification

```bash
bun test packages/rielflow/src/workflow/packages/checkout.test.ts
bun test packages/rielflow/src/workflow/packages/packages.test.ts
bun test packages/rielflow/src/workflow/checkout/checkout.test.ts
bun test packages/rielflow/src/cli.test.ts
bun run typecheck
bunx biome check packages/rielflow/src/workflow/packages packages/rielflow/src/workflow/checkout packages/rielflow/src/cli
git diff --check -- impl-plans/active/workflow-package-checkout.md design-docs/specs/design-workflow-package-checkout.md design-docs/specs/design-workflow-package-skills.md design-docs/specs/design-workflow-package-update.md design-docs/user-qa/qa-workflow-package-checkout.md
```

## Risks

- Vendor context files such as `AGENTS.md` and `GEMINI.md` are high-impact
  prompt material; validation and confirmation must keep their installation
  explicit and auditable.
- Rollback spans workflow directories, managed roots, vendor projections, and
  provenance records, so partial failure tests must cover each phase.
- Direct workflow destination overrides can create multiple package checkouts
  with the same workflow name, so status/update must avoid legacy
  `<scope>-<workflow-name>` identity assumptions.
- CLI parser line-count limits already fail on touched files; implementation
  must keep argument parsing maintainable enough for Biome verification.
- Some vendors do not expose safe user-level projection targets; managed-only
  records must be treated as successful installs, not silent skips.
- `md5` remains change tracking, not a security boundary; schema fields must
  preserve checksum algorithm and integrity separately.

## Progress Log

### Session: 2026-05-28 00:00

**Tasks Completed**: Created feature-local implementation plan from accepted
design.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Step 3 review accepted the design. The only low finding is handled
by carrying `projectRootIdentity` and `workflowDefinitionDirOverride` into the
plan's provenance tasks.

### Session: 2026-05-28 01:00

**Tasks Completed**: Revised plan for corrected direct
`--workflow-definition-dir` checkout destination semantics, collision-safe
package install identity, vendor skill projections, and known Biome verification
risk.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Step 3 accepted the design with no high or mid findings. Issue #35
remains unrelated; workflow input title/body are authoritative.

### Session: 2026-05-28 02:00

**Tasks Completed**: Addressed Step 5 mid finding by expanding TASK-007,
TASK-008, completion criteria, and verification coverage for
`workflow package status` and `workflow package update`.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: The plan now explicitly covers `--scope`, `--install-id`, `--yes`,
noninteractive update refusal, ambiguity errors, package-record-only lookup,
and text/JSON status/update output required by
`design-docs/specs/design-workflow-package-update.md`.

### Session: 2026-05-28 03:00

**Tasks Completed**: TASK-001 through TASK-009.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented vendor skill validation/installation, package checksum
coverage, package-specific install ids and provenance, direct
`--workflow-definition-dir` package checkout semantics, status/update lookup by
`--install-id`, noninteractive update refusal without `--yes`, CLI output,
stale package-owned skill removal, rollback tests for workflow/skill/provenance
mutation failure, and the parser split needed to satisfy Biome line-count
checks.

### Session: 2026-05-28 04:00

**Tasks Completed**: Addressed Step 7 mid findings for user-scope Claude/Codex
skill projection and project-root-aware package status lookup.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: User-scope package checkout now projects Claude skills to
`<home>/.claude/skills/<name>` and Codex skills to
`$CODEX_HOME/skills/<name>` or `<home>/.codex/skills/<name>`, while
`agents`, `cursor`, and `gemini` remain managed-only. Package status/update
lookup now narrows project-scope workflow-name matches by current
`projectRootIdentity` and optional `workflowDefinitionDirOverride` before
reporting ambiguity.

### Session: 2026-05-28 05:00

**Tasks Completed**: Addressed Step 7 follow-up findings for relative direct
workflow definition roots and overclaimed skills-only package support.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: `workflowDefinitionDirOverride` now resolves relative
`--workflow-definition-dir` values through the same configured-root semantics as
checkout destinations, including `cwd`. Plan and design text now make
skills-only packages explicitly out of scope for this issue because checkout
identity, status, update, and provenance require a primary workflow bundle.

### Session: 2026-05-28 06:00

**Tasks Completed**: Addressed Step 7 follow-up findings for package
status/update comparison output and symlink-safe skill projections.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Package status now refreshes current registry metadata, compares
installed versus available version/checksum/integrity, reports
`installedArtifacts`, `changedArtifacts`, `provenancePath`, and update state,
and package update no-ops when status is up to date before requiring `--yes`
for mutation. Skill projection now rejects symlinked project/user vendor
ancestors before copying to projected paths, with coverage for `.claude`,
`.codex`, and `.cursor` project paths.

## Related Plans

- **Depends On**: `impl-plans/active/workflow-package-registry.md`
- **Related**: `impl-plans/active/workflow-package-checkout-search.md`
- **Related**: `impl-plans/active/workflow-package-publish.md`
