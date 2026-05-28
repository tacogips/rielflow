# Workflow Package Checkout Metadata And Clean Update

Design for checkout metadata, change detection, and clean package updates for
rielflow workflow packages.

## Overview

Workflow package checkout already installs a registry-selected workflow bundle
into project or user scope and writes basic provenance. This feature makes that
provenance package-aware enough to support later update checks and deterministic
clean reinstalls.

The update model is intentionally similar to `tacogips/ign` template checkout
and template update behavior: source metadata is persisted at checkout time,
current registry metadata is compared later, and overwrite/update paths are
confirmation-gated by default. Unlike `ign`, rielflow packages do not process
template variables; update is a clean reinstall of workflow and package-managed
skill artifacts from a validated package revision.

## Feature Contract

- Feature id: `package-checkout-update-metadata`
- Feature title: Checkout Metadata And Clean Update
- Workflow mode: `issue-resolution`
- Issue reference: `workflowInput: Package workflows with vendor-scoped skills
  and checkout update metadata`
- Implementation plan target: `impl-plans/active/workflow-package-update.md`
- Design document path:
  `design-docs/specs/design-workflow-package-update.md`
- Primary source touchpoints:
  - `packages/rielflow/src/workflow/packages/checkout.ts`
  - `packages/rielflow/src/workflow/packages/types.ts`
  - `packages/rielflow/src/workflow/packages/checksum.ts`
  - `packages/rielflow/src/workflow/packages/registry-config.ts`
  - `packages/rielflow/src/workflow/checkout/registry.ts`
  - `packages/rielflow/src/cli.ts`
- Codex-agent reference files:
  - `/Users/taco/gits/tacogips/ign/internal/app/checkout.go`
  - `/Users/taco/gits/tacogips/ign/internal/app/template_update.go`
  - `packages/rielflow/src/workflow/packages/registry-config.ts`
  - `packages/rielflow/src/workflow/packages/checksum.ts`

## Goals

- Persist enough package checkout metadata to detect whether a checked-out
  package has changed in its source registry.
- Record workflow and skill artifact identities in the same package checkout
  provenance model.
- Support update checks for project-scope and user-scope checkouts.
- Implement clean package update by staging, validating, backing up, removing,
  and reinstalling the selected package revision.
- Require interactive confirmation for destructive update/overwrite by default.
- Provide a skip-confirmation option for automation and noninteractive tests.
- Keep checksum and sha256 integrity validation before any destination mutation.

## Non-Goals

- Merging local edits inside checked-out workflow or skill directories.
- Applying template variables during update.
- Updating packages from unregistered or unsupported registry backends.
- Replacing the existing direct GitHub directory checkout record format.
- Defining vendor skill file formats; that belongs to the companion package
  skill layout design.

## Checkout Metadata Model

Package checkout writes a package provenance file inside the installed workflow
directory and a user-root checkout catalog record under the existing checkout
registry path:

```text
<workflow-destination>/.rielflow-package-provenance.json
~/.rielflow/workflow-registry/checkouts/<install-id>.json
```

The catalog record remains the lookup entry for update commands. Package
checkouts must use a collision-safe `installId`, not only
`<scope>-<workflow-name>`, because the same workflow name can be installed into
multiple project roots. The stable install id is derived from scope, normalized
destination directory, project root identity for project scope, package id, and
workflow name:

```text
<scope>-<workflow-name>-<sha256(destinationDirectory + "\0" + projectRootIdentity + "\0" + packageId)[0..16]>.json
```

User-scope installs still include the destination hash for one uniform identity
scheme. Direct URL checkout records may keep their current legacy path; package
status/update must read package records by `checkoutKind: "package"` and should
not infer package identity from legacy direct checkout keys.

For package checkouts the catalog record should be extended with package
metadata while retaining the existing direct checkout fields:

- `workflowName`
- `sourceUrl`
- `scope`
- `installId`
- `projectRootIdentity` for project scope
- `checkedOutAt`
- `destinationDirectory`
- `checkoutKind`: `direct-url` or `package`
- `packageId`
- `packageName`
- `packageVersion`
- `registryId`
- `registryUrl`
- `registryRef`
- `sourceBranch`
- `sourcePath`
- `workflowDirectory`
- `metadataPath`
- `checksum`
- `checksumAlgorithm`
- `integrityDigestAlgorithm`
- `integrityDigest`
- `installedArtifacts`

`installedArtifacts` is an array of package-managed install outputs. Initial
records should include the workflow artifact and, once package skill checkout is
implemented, each installed skill artifact:

- `kind`: `workflow` or `skill`
- `name`
- `vendor` for skill artifacts
- `scope`
- `destinationDirectory`
- `sourcePath`
- `checksum`
- `integrityDigest`

`projectRootIdentity` is a normalized project scope root path plus a short
sha256 digest of that path. It is stored for diagnostics and ambiguity
resolution; destination path safety still uses the existing scoped path
resolver.

The workflow-local `.rielflow-package-provenance.json` should mirror the package
fields needed to audit the installed directory without reading the catalog,
including `installId`, `projectRootIdentity`, and whether
`workflowDefinitionDirOverride` was used. The catalog remains authoritative for
update discovery because it can track project-scope installs from a single
user-root location without colliding when multiple repositories install the
same workflow name.

## Change Detection

An update check resolves the original registry entry and package name from the
catalog record, then loads current package metadata from the requested or
recorded registry ref.

Catalog lookup rules:

- If `--install-id` is provided, load that exact package checkout record.
- If a package checkout was installed with `--workflow-definition-dir`, status
  and update still treat it as project scope. Lookup by workflow name uses the
  current project root identity plus the recorded workflow destination
  directory; ambiguity requires `--install-id`.
- If `--scope user` is requested, match package records by user scope and
  workflow name; more than one match is an ambiguity error unless `--install-id`
  is provided.
- If `--scope project` is requested or implied, discover the current project
  scope root and match package records by workflow name plus normalized
  destination/project root identity.
- If the current directory is outside the recorded project root and more than
  one project-scope match exists, fail with an ambiguity error listing install
  ids and destination directories.
- Direct URL records and records without `checkoutKind: "package"` are reported
  as `not-package-checkout`.

Comparison rules:

- Missing package record: report `not-package-checkout`.
- Missing registry: fail with `MISSING_REGISTRY`.
- Missing package: report `missing-source-package`.
- Same `checksumAlgorithm` and `checksum`: report `up-to-date`.
- Different checksum or integrity digest: report `update-available`.
- Same checksum but different version: report `metadata-drift`.
- Different package name for the recorded source path: fail validation.
- Registry metadata without checksum is not update-safe unless explicitly
  allowed for local fixtures.

The status result should include old and new package version, checksum,
integrity digest, registry URL, registry ref, workflow name, and destination
paths. Text output should be terse; JSON output should expose the full
comparison for automation.

## Clean Update Flow

Clean update is a reinstall, not a merge:

1. Read the checkout catalog record for the target workflow and scope.
2. Resolve the package from the recorded registry id or URL and current branch.
3. Stage the complete package revision in a temporary directory.
4. Validate package checksum, sha256 integrity, signatures, workflow bundle, and
   optional pre-install checks.
5. Compute the update status against the installed record.
6. If no update is available, return without mutating unless force reinstall is
   requested.
7. If mutation is required, require confirmation unless skip confirmation is
   set.
8. Back up all package-managed installed artifacts.
9. Remove only package-managed workflow and skill destinations from the prior
   record.
10. Install staged workflow and skill artifacts into the requested scope.
11. Write updated catalog and workflow-local provenance.
12. Roll back all backed-up artifacts if any install or provenance write fails.

The backup and rollback behavior should follow the existing direct checkout
pattern in `packages/rielflow/src/workflow/checkout/index.ts`, but it must cover
multiple artifacts because future workflow packages may install both workflows
and skills.

## Confirmation Policy

Update and overwrite operations are destructive because they replace
package-managed directories. CLI behavior:

```bash
rielflow cli workflow package update <workflow-name> [--scope project|user] [--install-id <id>] [--yes] [--output json|text]
rielflow cli workflow package status <workflow-name> [--scope project|user] [--install-id <id>] [--output json|text]
```

Rules:

- `package status` never mutates and never prompts.
- `package update` prompts before replacing installed artifacts when running in
  an interactive terminal.
- `--install-id` selects an exact checkout record and is required when workflow
  name plus scope/project-root lookup is ambiguous.
- `--yes` skips confirmation for automation.
- Noninteractive update without `--yes` fails with a usage error.
- Existing `--overwrite` checkout behavior should be aligned with this policy
  when package checkout is replacing an existing package-managed install.

## Skill Artifact Interaction

This feature does not define vendor skill formats, but the metadata model must
be ready for them. Package skill checkout should append skill artifacts to
`installedArtifacts` with explicit vendor, scope, destination, source path, and
digest fields. Update removes and reinstalls only artifacts listed in the prior
record, preventing the updater from deleting unrelated user or project files.

User-scope projected skill files may live outside the managed data root in
vendor-specific locations. Such projections must still be represented as
package-managed artifacts and must be removable only when they match the
recorded checksum or a force/confirmed clean update path is used.

## Output

Update status JSON should include:

- `workflowName`
- `scope`
- `status`
- `packageId`
- `packageName`
- `registryId`
- `registryUrl`
- `registryRef`
- `installedVersion`
- `availableVersion`
- `installedChecksum`
- `availableChecksum`
- `installedIntegrityDigest`
- `availableIntegrityDigest`
- `installedArtifacts`
- `changedArtifacts`

Update execution JSON should add:

- `updated`
- `confirmationSkipped`
- `backupDirectories`
- `checkoutRecordPath`
- `installId`
- `provenancePath`
- `preInstallCheck`

## Error Cases

Use explicit failures for:

- direct URL checkout record cannot be updated as a package
- checkout catalog record missing
- ambiguous package checkout record; retry with `--install-id`
- package provenance missing or malformed
- registry missing or unsupported
- package missing or ambiguous
- checksum mismatch while staging
- sha256 integrity or signature validation failure
- package workflow validation failure
- pre-install check failure
- noninteractive update without `--yes`
- unsafe artifact destination
- artifact destination modified from recorded checksum when clean update needs
  confirmation
- rollback failure after partial install

## Decisions

- Keep package update metadata in the existing user-root checkout catalog rather
  than adding a separate package database.
- Use a stable `installId` and `<install-id>.json` catalog filename for package
  records so project-scope installs with the same workflow name cannot collide.
- Resolve package status/update by `--install-id` first, then by scope plus
  workflow name and current project root identity.
- Add `checkoutKind` so direct URL records remain distinguishable from package
  records.
- Treat update as clean reinstall because package checkout owns generated
  artifacts and package content has no template variables.
- Require confirmation by default for update and overwrite paths.
- Use `--yes` as the skip-confirmation flag for CLI consistency with common
  automation conventions.
- Preserve md5 checksum for compatibility and change detection while using
  sha256 integrity for tamper detection.
- Track workflow and skill outputs as explicit `installedArtifacts` so updates
  can safely handle multi-artifact packages.

## Addressed Feedback

- The issue requires registry URL, workflow name, package hash, integrity, and
  version metadata; the catalog and provenance model now records all of them.
- The issue requires detecting changes after checkout; the update status model
  compares recorded and current registry metadata.
- The issue requires clean install updates; the update flow stages, validates,
  backs up, removes, reinstalls, and rolls back package-managed artifacts.
- The issue requires default confirmation with an option to skip; destructive
  update paths require confirmation unless `--yes` is provided.
- The issue requires workflow and skill package support; installed artifacts are
  modeled as workflow and vendor-scoped skill outputs without defining the
  vendor format contract in this document.
- Step 3 design review required collision-safe project-scope checkout identity;
  package records now use a stable `installId`, include project root identity,
  and define ambiguous lookup behavior.

## Open Questions

Tracked in `design-docs/user-qa/qa-workflow-package-checkout.md`.

- Whether the update command should live under `workflow package update` only or
  also be exposed as `workflow checkout --update`.
- Whether `--scope project|user` should replace or merely supplement existing
  `--user-scope` checkout flags.
- Whether modified projected user-scope skill files should block clean update by
  default or be replaced after the same confirmation prompt.

## Risks

- Projected user-scope skill locations can sit outside the managed data root, so
  deletion safety must rely on recorded artifact checksums and scoped path
  validation.
- A stale local registry checkout can make status report no update when the
  remote registry has changed; status/update commands need a refresh path.
- Multi-artifact rollback is more complex than current workflow-only checkout
  rollback and must be tested with injected filesystem failures.
- Direct checkout and package checkout records sharing the same catalog path can
  cause migration edge cases unless `checkoutKind`, `installId`, and
  backward-compatible parsing are handled carefully.

## Verification Commands

```bash
bun test packages/rielflow/src/workflow/packages
bun test packages/rielflow/src/workflow/checkout
bun run typecheck
```
