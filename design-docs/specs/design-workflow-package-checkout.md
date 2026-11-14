# Workflow And Skill Package Install

Design for installing, listing, and removing workflow packages that may contain
both workflow bundles and vendor-scoped skills resolved from Git-backed
rielflow package registries.

## Overview

The package install feature extends the existing scoped workflow checkout
implementation so `rielflow` can install package-selected workflow
bundles and package-selected skills from a registry entry, not only from a
direct GitHub directory URL. The package lifecycle also needs local listing and
removal because installed package records can own both workflow files and
projected or managed skill files. Package registries are GitHub repositories,
with `https://github.com/tacogips/rielflow-packages` as the default public
registry and an operator-provided local checkout path for development.

This feature owns the install path after a package has been selected by package
id, search result, or explicit registry filter. Registry configuration,
metadata indexing, publish behavior, and search ranking are defined in adjacent
package design documents and should feed this installer through stable package
resolution data. Package install must preserve existing workflow-only behavior
while adding an explicit package layout for skill content and an update-aware
managed install record for both workflows and skills.

## Feature Contract

- Feature id: `package-checkout-skill-installation`
- Feature title: Workflow And Skill Checkout Installation
- Workflow mode: `issue-resolution`
- Issue reference: `workflowInput: Package workflows with vendor-scoped skills
  and checkout update metadata`
- Issue addendum: `workflowInput: Add package listing and removal for
  checkout-installed workflows and skills`
- GitHub issue inspection: `https://github.com/tacogips/rielflow/issues/35`
  was inspected and found unrelated to this package checkout request; the
  workflow input title/body remain authoritative for this design update.
- Implementation plan target: `impl-plans/active/workflow-package-checkout.md`
- Design document path:
  `design-docs/specs/design-workflow-package-checkout.md`
- Primary source touchpoints:
  - `packages/rielflow/src/workflow/packages/checkout.ts`
  - `packages/rielflow/src/workflow/checkout/index.ts`
  - `packages/rielflow/src/cli/workflow-package-command-handler.ts`

## Goals

- Install workflow bundles selected from registry package metadata.
- Install whitelisted vendor skill/context entries from package metadata.
- List locally installed packages with version, hash, registry, scope,
  destination, workflow, and skill metadata.
- Remove installed packages by install id or unambiguous
  package/workflow selector.
- Separate package workflow directories from package skill directories.
- Preserve the current direct GitHub directory checkout compatibility path.
- Default package install to project scope.
- Support explicit user scope installation under `~/.rielflow/workflows`.
- Store user-scope managed skill data under `~/.rielflow-managed` before any
  projection into vendor locations.
- Support project-scope skill installation under project-local vendor paths.
- Validate package workflow bundles before mutating project or user scope.
- Validate package workflow bundles with the same scoped cross-workflow callee
  visibility they will have after installation.
- Validate package skill vendors and entry structure before mutating project,
  user, or vendor scope.
- Verify package checksums, initially supporting `md5`.
- Write package provenance beside existing checkout records under
  `~/.rielflow/workflow-registry/checkouts/`.
- Keep installation deterministic by recording registry URL, branch/ref, source
  directory, package id, workflow name, installed skills, package integrity,
  version, and checksum.
- Keep removal deterministic by deleting only package-owned artifacts recorded
  in checkout metadata.
- Detect changed package metadata after checkout and support clean-install
  update semantics.
- Require confirmation before overwrite/update by default, with a noninteractive
  opt-out.

## Non-Goals

- Implementing registry publish or PR creation.
- Owning search ranking or sqlite cache internals.
- Supporting non-GitHub registry backends.
- Fetching or installing missing workflow package dependencies or add-ons
  automatically.
- Installing or projecting package skills as part of temporary registry-backed
  workflow execution.
- Translating arbitrary vendor-specific extensions beyond the documented
  package skill projections.
- Replacing direct URL checkout behavior.
- Treating skill content as trusted merely because it came from a known vendor
  directory.
- Removing arbitrary workflow directories or vendor skill files that are not
  recorded as package-owned artifacts.
- Refreshing remote registry metadata during local package listing.

## Package Layout

A workflow package may contain workflows only or workflows plus skills. Package
content must keep the two domains separate so checkout can validate and install
them independently:

```text
<package-root>/
  rielflow-package.json
  workflows/
    <workflow-name>/
      workflow.json
      nodes/node-<id>.json
      prompts/*.md
  skills/
    agents/
      AGENTS.md
    claude/
      <skill-name>/SKILL.md
    codex/
      <skill-name>/SKILL.md
    cursor/
      <rule-name>.mdc
    gemini/
      GEMINI.md
```

The only allowed immediate children under `skills/` are:

- `agents`
- `claude`
- `codex`
- `cursor`
- `gemini`

Checkout must reject any other skill vendor directory. This issue keeps package
checkout workflow-centered: a package must contain a primary workflow bundle and
may omit `skills/`. Skills-only packages are deferred to a future design because
checkout status, update, and provenance currently use the primary workflow as
the package installation identity. Registry metadata continues identifying that
primary workflow while also listing skill entries that checkout can install and
record.

## Vendor Skill And Context Formats

Vendor mappings are intentionally conservative:

- `agents`: repository instruction context represented as Markdown
  `AGENTS.md`. Project scope writes to `<project-root>/AGENTS.md` only when the
  file does not already exist unless overwrite/update is confirmed. User scope
  stores managed data only; there is no universally safe user projection.
- `claude`: Claude Code skills are directories containing required `SKILL.md`
  with YAML frontmatter and Markdown content. Project scope projects to
  `<project-root>/.claude/skills/<skill-name>/`; user scope projects from
  managed data to `~/.claude/skills/<skill-name>/` when safe.
- `codex`: Codex skills use `.codex/skills/<skill-name>/SKILL.md` directories
  with optional resources, scripts, assets, and references. Project scope
  projects to `<project-root>/.codex/skills/<skill-name>/`; user scope projects
  from managed data to `~/.codex/skills/<skill-name>/` when projection is safe.
- `cursor`: Cursor project rules are files under
  `<project-root>/.cursor/rules/`. Package support maps Cursor entries as rule
  files, not SKILL.md directories. User scope stores managed data only unless a
  future Cursor global-rule target is explicitly supported.
- `gemini`: Gemini CLI consumes `GEMINI.md` context files from the current and
  parent directories. Project scope projects to `<project-root>/GEMINI.md` only
  when overwrite/update is confirmed or the file is absent. User scope stores
  managed data only because a safe global projection target is not part of the
  package contract.

Skill entries must be copied without executing package scripts. Validation
checks file presence, directory containment, vendor allow-list membership,
path-traversal resistance, and vendor-specific required filenames.

## Managed Skill Installation

User-scope skill checkout writes canonical package-owned content under:

```text
~/.rielflow-managed/packages/<package-id>/<version-or-ref>/skills/<vendor>/...
```

That managed copy is the source of truth for update detection, rollback, and
uninstall. Projection into vendor locations is a separate step and must be
skipped when checkout cannot prove the target is safe to create, replace, or
restore. Project-scope checkout writes canonical content under project-local
vendor paths because those files are intended to be versioned and inspected
with the project.

Projection must never follow symlinks out of the intended destination root.
When overwrite or update is confirmed, checkout creates a backup of each
existing projected target before replacement and restores it if any later
workflow, skill, or provenance write fails.

## Command Behavior

The package installer is the canonical persistent install command:

```bash
rielflow package install <package-id> [--registry <registry-url-or-id>] [--branch <branch>] [--user-scope] [--workflow-definition-dir <path>] [--overwrite] [--yes] [--output json|text]
```

The workflow checkout command keeps the current direct URL form:

```bash
rielflow workflow checkout https://github.com/<owner>/<repo>/tree/<ref>/<workflow-dir>
```

Behavior:

- `workflow checkout` requires a valid GitHub directory URL and uses the direct
  checkout path.
- `package install` treats the target as a package id and resolves it through
  selected registry metadata.
- `--registry` restricts resolution to a registered registry id or GitHub URL.
- `--branch` selects the registry branch/ref used for metadata and content.
- Project scope is the default destination.
- `--user-scope` installs under the configured user root, normally
  `~/.rielflow/workflows` for workflows and `~/.rielflow-managed` for managed
  skill data.
- `--overwrite` permits replacing an existing workflow, skill projection, or
  checkout record after confirmation.
- `--yes` bypasses overwrite/update confirmation for noninteractive use.
- `--workflow-definition-dir <path>` may be supplied as a direct workflow
  destination root. Checkout writes the workflow bundle to
  `<path>/<workflow-name>` while package provenance remains in the configured
  user root checkout registry.
- `--workflow-definition-dir` is a project-scope workflow destination override,
  not a project-root override. It is incompatible with `--user-scope` for the
  first implementation because user scope already has a fixed workflow root.
- `--endpoint` remains unsupported because package install is a local
  filesystem mutation.

Local package lifecycle commands:

```bash
rielflow package list [--scope project|user|auto] [--workflow-definition-dir <path>] [--output json|text]
rielflow package status <package-id-or-workflow-name> [--scope project|user|auto] [--install-id <id>] [--workflow-definition-dir <path>] [--output json|text]
rielflow package remove <package-id-or-workflow-name> [--scope project|user|auto] [--install-id <id>] [--workflow-definition-dir <path>] [--output json|text]
```

Workflow-scoped package commands such as `workflow package list` and
`workflow package remove` are unsupported; help and README content should direct
users to the top-level `package` commands.

## Direct Workflow Destination Override

When package install receives `--workflow-definition-dir <path>`, only the
workflow bundle destination changes. All skill projection and package ownership
roots still derive from the current project root, resolved with the same
project-scope root discovery used by normal checkout.

Destination data flow:

- checkout scope: `project`
- workflow destination root: normalized `--workflow-definition-dir`
- workflow destination directory:
  `<workflow-definition-dir>/<workflow-name>`
- project root: current project root discovered from the working directory
- project managed skill root:
  `<project-root>/.rielflow/managed/packages/<package-id>/skills/`
- vendor projection roots:
  - agents: `<project-root>/AGENTS.md` when absent or confirmed
  - claude: `<project-root>/.claude/skills/<skill-name>/`
  - codex: `<project-root>/.codex/skills/<skill-name>/`
  - cursor: `<project-root>/.cursor/rules/<rule-name>.mdc`
  - gemini: `<project-root>/GEMINI.md` when absent or confirmed
- checkout catalog root:
  `~/.rielflow/workflow-registry/checkouts/`
- install id inputs: scope, normalized workflow destination directory,
  normalized project root identity, package id, and workflow name
- status/update lookup: `--install-id` first; otherwise project-scope lookup
  uses current project root identity plus workflow name and reports an
  ambiguity if multiple direct-destination installs match.

The supplied workflow-definition directory must not be used as a vendor
projection root unless it is also the discovered project root. This prevents a
custom workflow collection directory from unexpectedly receiving `AGENTS.md`,
`GEMINI.md`, `.claude/`, `.codex/`, or `.cursor/` files.

## Temporary Registry Run Checkout

`workflow run --from-registry <target>` uses the package resolver,
GitHub directory checkout support, and validation flow without creating a
persistent project or user installation. It is an npx-like execution path for
online workflow content that should behave like an ordinary local `workflow run`
after the temporary bundle has been prepared.

Supported targets:

- package id, preserving existing `workflow run <package-id> --from-registry`
  behavior
- GitHub workflow directory URL, including
  `https://github.com/<owner>/<repo>/tree/<ref>/<workflow-dir>` and
  `https://github.com/<owner>/<repo>/<workflow-dir>`
- registered shorthand, written as `<registry-owner>/<workflow-dir>` and
  resolved from configured registries only

Temporary run checkout data flow:

- classify the target as a package id, GitHub directory URL, or registered
  shorthand before any network or filesystem mutation
- resolve package id through registry metadata using optional `--registry` and
  `--branch`; resolve shorthand by filtering registered GitHub registries by
  owner and requiring a single matching package name, workflow name, or source
  path terminal segment
- resolve GitHub URL targets through the existing GitHub directory fetcher;
  branchless URL targets use `--branch` when supplied, then a matching
  registered registry default branch, then the repository default branch from
  GitHub metadata; fail with a usage error before staging if no ref can be
  resolved
- fetch or copy the package root into a command-owned temporary staging root
- validate `rielflow-package.json`, checksum/integrity metadata, and the
  selected workflow bundle through the same validation path used by persistent
  package install when package metadata exists
- for direct GitHub directory URL targets without `rielflow-package.json`,
  validate only the workflow bundle and mark provenance as reduced because
  package checksum, integrity, and signature verification did not run
- copy only the workflow bundle into a temporary workflow-definition directory
  whose shape is `<temp-workflow-root>/<workflow-name>/workflow.json`
- execute the existing local `workflow run` path with
  `--workflow-definition-dir <temp-workflow-root>` and all ordinary run options
  forwarded unchanged
- remove the temporary package staging root and temporary workflow-definition
  root after the run reaches a terminal result or fails before start

The temporary run checkout must not write normal checkout provenance under
`~/.rielflow/workflow-registry/checkouts/`, must not mutate project or user
workflow catalogs, and must not install or project package skills. Package skill
content may be staged for checksum verification only; it is not made visible to
agent vendors during the run unless a future explicit design adds isolated
skill projection.

Execution artifacts should record source provenance separately from checkout
provenance so a removed temporary directory remains auditable. Required
provenance fields are:

- `targetKind`: `package-id`, `github-directory-url`, or
  `registered-shorthand`
- `originalTarget`
- `packageId`
- `workflowName`
- `registryUrl`
- `registryRef`
- `repositoryUrl`
- `sourceDirectory`
- `metadataPath`
- `checksum`
- `checksumAlgorithm`
- `integrityVerified`
- `temporaryWorkflowDirectory`

Fields that are not available for raw GitHub directory URL targets should be
omitted or reported as `null` in JSON output. The output must not synthesize a
package id, checksum, or integrity result for content that was validated only as
a workflow bundle.

Temporary cleanup is best-effort after terminal run completion. If cleanup
fails, the command must report the remaining temporary path and cleanup error in
text output and JSON output while preserving the workflow execution result.
Cleanup must not run before all workflow-local files needed by prompts, scripts,
add-ons, or container contexts have been read by the runtime.

Paused registry-backed runs are the exception to immediate temporary checkout
removal. When `workflow run --from-registry` leaves the session in a resumable
non-terminal state, the command must retain the temporary workflow-definition
directory and persist registry-run provenance under the runtime store so later
local session lifecycle commands can find the retained workflow bundle. The
provenance record is execution metadata, not normal checkout catalog metadata,
and must remain separate from `~/.rielflow/workflow-registry/checkouts/`.

Required retained-run provenance records contain a top-level session id and a
registry package or directory payload with the same nullable-field rules as
execution output provenance:

- `targetKind`
- `originalTarget`
- `packageId`
- `workflowName`
- `registryId`
- `registryUrl`
- `registryRef`
- `repositoryUrl`
- `sourcePath`
- `sourceDirectory`
- `metadataPath`
- `checksum`
- `checksumAlgorithm`
- `integrityVerified`
- `temporaryWorkflowDirectory`

`session resume <session-id>` and local `session continue <session-id> ...`
must consult retained registry-run provenance when the caller did not supply an
explicit `--workflow-definition-dir`. If provenance exists for the source
workflow execution id, the command uses the parent workflow-definition
directory of the retained `temporaryWorkflowDirectory` as the effective
workflow root and then executes through the normal local resume or continuation
path. Explicit
operator input has higher precedence: a caller-provided workflow-definition
directory must not be silently overridden by registry provenance.

Terminal cleanup responsibility moves to the lifecycle command that observes
the terminal result. A resumed or continued registry-backed session must remove
the retained temporary checkout after the resulting execution reaches a
terminal status (`completed`, `failed`, or `cancelled`). Cleanup must not run
when the lifecycle command returns another paused or running state. Cleanup
failure is reported in text and JSON output without changing the session
result. JSON output reports the registry source and cleanup result so operators
can diagnose and manually remove a path when cleanup fails.

Continuation uses the source session's retained checkout to load workflow-local
files for the new continued execution. The initial implementation does not need
to create a second package checkout for the continuation; it may share the
retained source checkout until the continued execution reaches a terminal
state. If multiple resumable descendants require the same retained checkout in
the future, the provenance model must add reference ownership before cleanup is
broadened.

Registry-backed run is local-only for the initial implementation. Combining
`--from-registry` with `--endpoint` is a usage error because a remote server
cannot access the caller's temporary checkout path. Remote execution should use
a workflow already installed or explicitly exposed by that remote server.

The positional run target remains unambiguous: `workflow run <name>` resolves
local project/user/direct workflows only. The caller must pass
`--from-registry` to trigger registry resolution, so an unknown local workflow
does not unexpectedly fetch and execute remote package content.

Package-id resolution keeps the current behavior and output shape except for
the added `targetKind` and `originalTarget` provenance fields. Slash-containing
registered shorthand values are never treated as bare local workflow names, and
they are never fetched unless `--from-registry` is present. Ambiguous shorthand
matches across registries or packages fail before checkout staging begins.

## Package Resolution Input

The installer should receive a resolved package selection from the registry
metadata/search layer. Required fields:

- `packageId`
- `workflowName`
- `version`
- `registryUrl`
- `registryRef`
- `sourceDirectory`
- `metadataPath`
- `checksum`
- `checksumAlgorithm`
- `workflowDirectory`
- `skillDirectory`
- `dependencies`
- `packageHash`
- `integrity`
- `skills`

Each skill entry must include:

- `vendor`
- `name`
- `sourcePath`
- `projectionPath`
- `installMode`

`installMode` is `managed-only` when checkout records the skill under
`~/.rielflow-managed` without projecting to a vendor location, and `projected`
when checkout also writes to a vendor-specific location.

The installer may initiate resolution for CLI convenience, but install behavior
must depend on this normalized selection so tests can bypass network access with
an injected resolver.

## Install Flow

1. Parse the checkout target and branch to direct GitHub URL checkout when
   applicable.
2. Resolve package id, registry filter, and branch/ref into a single package
   selection.
3. Reject missing or ambiguous packages before creating checkout staging
   directories.
4. Resolve the destination with the existing checkout destination rules:
   project scope by default, user scope only when explicitly requested, and
   `--workflow-definition-dir` as a project-scope workflow destination override.
5. Fail on an existing destination, projection, or checkout record unless the
   operation is an explicit overwrite/update and confirmation is satisfied.
6. Fetch or copy the selected package root into a temporary staging root.
7. Validate each staged workflow bundle through the existing workflow loader
   using install-time workflow roots that include the staged package workflow
   and the destination scoped workflow catalog.
8. Validate each staged skill entry against the vendor allow-list and
   vendor-specific file requirements.
9. Compute the staged package checksum and compare it with registry metadata
   when a checksum is present.
10. Move the validated staged workflow into the destination atomically where
    possible.
11. Copy managed skill data and then project vendor files where safe.
12. Write checkout provenance after destination moves and skill projections,
    rolling back workflows, managed skill data, projections, and records when
    provenance writing fails.

This mirrors the existing direct checkout safety model: validation happens
before mutation, overwrite uses a backup, and unsafe destinations are rejected.

## Scoped Cross-Workflow Validation During Install

Package install validation must model the workflow resolution environment that
will exist after the package is installed. A staged package workflow may call
another workflow through `steps[].transitions[].toWorkflowId`; that callee may
already be installed in project or user scope and should not need to be copied
into the package source directory. The install validator therefore cannot
validate the package workflow with only `path.dirname(sourceDirectory)` as the
workflow root.

Install-time validation should use a composite resolver with these ordered
workflow roots:

1. the staged package workflow root, so the candidate workflow and any
   package-local sibling workflows remain visible before mutation
2. the resolved destination workflow root for the selected install scope
3. the remaining scoped workflow roots that ordinary runtime resolution would
   consult for the same command context, preserving direct override, project,
   and user precedence

The staged workflow root must shadow installed workflows with the same
workflow id during validation because the package candidate is the artifact
being installed. Other callees should resolve through the scoped catalog exactly
as they would for a runtime call from the installed workflow. For the default
project-scope install this means project scope is checked before user scope.
For `--user-scope`, user scope is the destination and the validator must not
silently prefer project-local callees that a later user-scope runtime would not
see when run outside that project. When `--workflow-definition-dir` is supplied,
that direct destination root participates as the installed root, and skill or
project-root resolution remains governed by the existing destination override
rules.

Missing or invalid callees remain hard validation failures before destination
mutation. The error should name the caller workflow, the unresolved
`toWorkflowId`, the transition path, and the workflow roots that were searched.
This keeps install safety intact while allowing package authors to depend on
already installed workflow packages such as `codex-design-and-implement-review-loop`
or `codex-refactoring-slice-review` without vendoring those callees into every
package.

This design does not introduce package dependency installation metadata in the
current fix. If package dependency metadata is added later, it should build on
the same install-time resolver by declaring which callees are expected to
resolve from installed packages, then failing with dependency-oriented
diagnostics when they do not.

## Checksum Verification

Checksums are change-tracking and cache-invalidation signals, not a security
boundary. The first implementation must support values equivalent to
`md5:<hex>` and should preserve algorithm-prefixed output so stronger hashes can
be added later.

Checksum verification rules:

- If metadata includes a checksum, package install must verify it before
  installing.
- A mismatch fails the checkout and leaves the destination unchanged.
- If metadata lacks a checksum, checkout may install only when the registry
  resolver marks the package as trusted for compatibility or test fixtures.
- The checksum input should match the registry metadata/cache contract:
  workflow files, prompts, nodes, package metadata, and included package-local
  files; no `.git` data, runtime artifacts, or local cache files.
- Skill files must contribute to the package hash and each skill record should
  carry its own entry checksum for update diagnosis.

## Provenance Record

Direct URL checkouts can keep the existing record shape. Package checkout
extends the record written to the user-root checkout registry. The preferred
package record name is a collision-safe install id derived from scope,
destination directory, package id, and workflow name; legacy
`<scope>-<workflow-name>.json` records remain readable for compatibility.

```text
~/.rielflow/workflow-registry/checkouts/<install-id>.json
```

Additional package fields:

- `checkoutKind`: `package`
- `installId`
- `packageId`
- `packageName`
- `version`
- `packageVersion`
- `registryUrl`
- `registryRef`
- `sourcePath`
- `sourceDirectory`
- `metadataPath`
- `checksum`
- `checksumAlgorithm`
- `integrity`
- `checkedOutAt`
- `destinationDirectory`
- `workflowDirectory`
- `workflowDefinitionDirOverride`
- `projectRootIdentity`
- `managedSkillRoot`
- `skills`
- `packageHash`

Each skill record includes `vendor`, `name`, `sourcePath`, `managedPath`,
`projectionPath`, `installMode`, and the copied entry checksum. The record is
stored under the user root even for project-scope installs so users have one
provenance catalog for all package checkouts.

The checkout record fields for destination, managed skill root, and each
installed skill's managed/projection path are the removal and clean-update
source of truth.
- `scope`
- `destinationPath`
- `sourcePath`
- `checksum`
- `checksumAlgorithm`
- `contentDigestAlgorithm`
- `contentDigest`

## Update Detection And Clean Install

Checkout compares the current registry selection with the existing provenance
record. A package has changed when any of these fields differ:

- `registryUrl`
- `registryRef`
- `version`
- `sourceDirectory`
- `metadataPath`
- `checksum`
- `checksumAlgorithm`
- `packageHash`
- skill entry list or per-entry checksum

When changed, checkout should report that an update is available and refuse to
mutate by default. A confirmed overwrite/update performs a clean install:

1. Stage and validate the new package content.
2. Backup existing workflow destination, managed skill root, vendor
   projections, and provenance record.
3. Remove package-owned installed content.
4. Install the new staged content and write a new provenance record.
5. Restore all backups if any step fails.

Clean install must remove stale package-owned skill entries that are no longer
present in the updated package, while leaving unrelated user or project files
untouched.

## Output

Text output should include:

```text
installed package: <package-id>
workflow: <workflow-name>
scope: project|user
destination: <path>
registry: <registry-url>
checksum: <algorithm>:<hex>
skills: <count>
updated: true|false
```

JSON output should include:

- `installId`
- `packageId`
- `packageName`
- `workflowName`
- `scope`
- `destinationDirectory`
- `registryUrl`
- `registryRef`
- `sourceDirectory`
- `metadataPath`
- `checksum`
- `checksumAlgorithm`
- `checkoutRecordPath`
- `overwritten`
- `updated`
- `skills`
- `managedSkillRoot`
- `packageHash`

## Installed Package Listing And Raw Checkout Boundary

Installed package listing reads checkout catalog records from
`~/.rielflow/workflow-registry/checkouts/` and does not contact registries.
This keeps list output fast, deterministic, and available offline. The listing
service should expose all package checkout records by default and allow command
filters for project scope, user scope, current project root identity, and
`--workflow-definition-dir`.

List must include package version and hash data from the installed record, not
from current registry metadata. If a legacy package record lacks a field, JSON
output should report `null` or omit the field consistently rather than
refreshing the registry to backfill it.

The checkout catalog also contains raw workflow checkout records written by
`rielflow workflow checkout`. Those records are intentionally not package-owned
and may lack `checkoutKind`; they carry workflow provenance fields such as
`workflowName`, `sourceUrl`, `scope`, `destinationDirectory`,
`contentDigestAlgorithm`, `contentDigest`, and `includedFiles`.

Package listing must keep package records and raw workflow checkout records
separate:

- `packages` remains the package-owned list derived from records with
  `checkoutKind: "package"`.
- `workflowCheckouts` lists matching raw workflow checkout records with
  `installType: "workflow-checkout"`.
- scope, project-root, and workflow-definition-dir filters apply before both
  record sets are rendered.
- registry refresh, registry search, and package-id inference are never
  performed while listing local records.

This preserves package lifecycle semantics while preventing a user-scope raw
checkout from looking absent when `package list --scope user --output json` is
used for diagnosis.

Required list result fields:

- `installId`
- `packageId`
- `packageName`
- `workflowName`
- `scope`
- `destinationDirectory`
- `packageVersion`
- `packageHash`
- `checksum`
- `checksumAlgorithm`
- `integrityDigest`
- `registryUrl`
- `registryRef`
- `checkoutRecordPath`
- `skills`
- `checkedOutAt`

Text output should show at least install id, package id/name, workflow name,
scope, version, hash/checksum, and destination. Long hashes may be shortened in
text output only.

Raw workflow checkout list entries should include at least workflow name, scope,
destination, source URL, digest algorithm, digest, checkout record path, and
suggested workflow commands. Text output should label this section as raw
workflow checkouts or direct workflow checkouts so it is not mistaken for
registry-managed package state.

## Package Status For Raw Workflow Checkouts

`rielflow package status <name>` is a package-boundary diagnostic as well as an
update-status command. It must avoid the generic `package checkout record not
found` failure when the local checkout catalog contains a matching raw workflow
checkout.

Resolution order:

1. Select matching package checkout records by `--install-id`, selector,
   `--scope`, current project root identity, and workflow-definition-dir.
2. If one package checkout record matches, return normal package status.
3. If multiple package checkout records match, keep the existing ambiguous
   package failure and require `--install-id`.
4. If no package record matches, select matching raw workflow checkout records
   with the same scope and destination filters.
5. If one raw workflow checkout matches, return explanatory workflow-checkout
   status.
6. If multiple raw workflow checkouts match, return an ambiguity diagnostic that
   includes matching checkout record paths and requires a narrower scope or
   workflow-definition-dir.
7. If nothing matches, return a missing-package diagnostic that states no
   package checkout or raw workflow checkout record was found.

Raw workflow checkout status is successful, read-only, and non-updatable. JSON
output uses:

- `installType`: `workflow-checkout`
- `managedBy`: `workflow checkout`
- `packageManaged`: `false`
- `workflowName`
- `scope`
- `destinationDirectory`
- `sourceUrl`
- `contentDigestAlgorithm`
- `contentDigest`
- `checkoutRecordPath`
- `checkedOutAt`
- `suggestedCommands`

The suggested commands should point to workflow commands, especially
`rielflow workflow usage <workflow-name> --scope <scope>`. If the user wants
package lifecycle commands such as list/status/update/remove, status should
explain that the workflow must be installed through `rielflow package install`
from a registry package instead of raw `workflow checkout`.

## Package Removal

Package removal is a local cleanup operation for checkout-installed packages.
It must not remove remote registry records, source package files, or legacy
direct URL checkouts unless the selected record has `checkoutKind: "package"`.

Selector rules:

- `--install-id` selects one exact checkout catalog record and bypasses
  package/workflow name ambiguity.
- Without `--install-id`, the positional selector may match `packageId`,
  `packageName`, or `workflowName`.
- Scope, project root identity, and workflow-definition-dir filters apply
  before ambiguity checks.
- Zero matches return a usage error without mutation.
- Multiple matches return a usage error and require retrying with
  `--install-id`.

Deletion rules:

- Use destination, provenance, managed skill, and skill projection paths from
  the checkout record as the deletion allow-list.
- Delete workflow-local `.rielflow-package-provenance.json` with the workflow
  directory.
- Delete the checkout catalog record only after package-owned artifacts are
  deleted or already absent.

Required remove JSON fields:

- `installId`
- `packageId`
- `packageName`
- `workflowName`
- `scope`
- `checkoutRecordPath`
- `removedPaths`
- `skippedPaths`

Removal should tolerate absent package-owned paths so interrupted previous
removals can be retried. Ambiguous selectors remain hard failures.

## Error Cases

Package checkout should surface explicit failure codes for:

- invalid package id
- unknown package
- ambiguous package
- unsupported or unregistered registry
- registry fetch failure
- invalid remote package directory
- checksum mismatch
- invalid workflow bundle
- invalid skill vendor
- invalid skill entry
- duplicate checkout without `--overwrite`
- update requires confirmation
- unsafe skill projection
- unsafe destination
- ambiguous installed package selector
- package checkout record not found
- selected checkout is not a package checkout
- removal confirmation required
- package-owned artifact digest mismatch
- unsafe package removal path
- temporary run checkout failure
- temporary run cleanup failure
- unsupported endpoint with registry-backed run
- local I/O failure

Existing direct checkout errors should remain compatible where command behavior
has not changed.

## Decisions

- Add `rielflow package install` as the canonical package install command and
  reject workflow-scoped package checkout forms.
- Keep direct GitHub directory URL checkout on `rielflow workflow checkout`.
- Use `workflows/` and `skills/` as the package-level content separation.
- Allow only `agents`, `claude`, `codex`, `cursor`, and `gemini` under package
  `skills/`.
- Use project scope as the default install destination.
- Support `--workflow-definition-dir` for local checkout destination selection
  and continue rejecting only `--endpoint` for checkout.
- Use the existing checkout staging, validation, backup, and provenance pattern
  for package installs.
- Store user-scope managed skills below `~/.rielflow-managed` and treat vendor
  projection as a safe secondary copy.
- Store package checkout provenance under
  `~/.rielflow/workflow-registry/checkouts/`.
- Make `rielflow package install` the canonical package lifecycle command.
- Make `rielflow package list` a local catalog read that reports installed
  version and hash metadata without registry refresh.
- Keep package-owned entries and raw workflow checkout entries separate in
  package list output; raw entries use `installType: "workflow-checkout"` and
  do not become package-managed.
- Make `rielflow package status <workflow>` return explanatory
  workflow-checkout status when no package record matches but a raw workflow
  checkout record exists.
- Make `rielflow package remove` a checkout-record-driven deletion operation
  that requires `--install-id` when selectors are ambiguous.
- Require checksum verification when package metadata provides a checksum.
- Persist registry URL, workflow name, package version, package hash/integrity,
  and installed skill entries for update detection.
- Require confirmation by default for overwrite/update and provide `--yes` as
  the explicit noninteractive bypass.
- Keep sqlite optional; checkout must be testable through injected registry
  resolver/cache/fetch abstractions.
- Make registry-backed execution explicit with `workflow run --from-registry`
  so local workflow names and registry package ids do not collide.
- Treat temporary registry-backed run checkout as non-persistent: no project/user
  catalog writes, no normal checkout provenance record, and no package skill
  projection.
- Preserve ordinary `workflow run` behavior by forwarding execution through the
  existing direct workflow-definition directory path after temporary checkout.

## Open Questions

Tracked in `design-docs/user-qa/qa-workflow-package-checkout.md`.

- Whether the CLI flag should remain `--user-scope` for consistency or gain a
  more general `--scope project|user` alias.

## Risks

- Package ids and workflow names can diverge, so duplicate checks must use the
  destination workflow name while provenance also records package id.
- Stale registry cache can point to old checksums; outputs and records must
  include registry ref and checksum for diagnosis.
- Overwrite rollback must protect project/user workflow directories, managed
  skill roots, vendor projections, and the provenance record together.
- The default registry local path is machine-specific and must not become the
  canonical source URL in package records.
- md5 satisfies change tracking but is weak for security; the schema must keep
  `checksumAlgorithm` explicit.
- Vendor context files such as `AGENTS.md` and `GEMINI.md` are high-impact
  prompt material; package validation should keep their installation explicit
  and update-aware.
- Some vendors do not expose safe user-level projection targets; managed-only
  install records avoid unsafe writes while still enabling package update and
  audit.
- Retained temporary registry-backed checkouts must be cleaned only by the
  lifecycle command that observes a terminal result; cleaning at pause time
  breaks resume/continue, while never cleaning leaks package staging data.
- Package skill projection during temporary execution could unexpectedly mutate
  user or project vendor state, so the first implementation rejects that
  behavior.
- Package removal can become destructive if records are incomplete or stale;
  checkout-record-scoped deletion and install-id disambiguation are required
  safeguards.

## Verification Commands

```bash
bun test packages/rielflow/src/workflow/packages/packages.test.ts
bun test packages/rielflow/src/workflow/checkout/checkout.test.ts
bun test packages/rielflow/src/workflow/packages/checkout.test.ts
bun test packages/rielflow/src/cli.test.ts
bun test packages/rielflow/src/cli.test.ts -t "package list"
bun test packages/rielflow/src/cli.test.ts -t "package remove"
bun test packages/rielflow/src/cli.test.ts -t "registry"
bun run typecheck
bun run packages/rielflow/src/bin.ts package list --output json
bun run packages/rielflow/src/bin.ts package remove --install-id <install-id> --output json
bun run packages/rielflow/src/bin.ts workflow run <package-id> --from-registry --mock-scenario <fixture> --output json
bunx biome check packages/rielflow/src/workflow/packages packages/rielflow/src/cli
git diff --check -- design-docs/specs/design-workflow-package-checkout.md design-docs/specs/design-workflow-package-skills.md design-docs/specs/design-workflow-package-update.md
```

## References

- Claude Code skills: `https://docs.claude.com/en/docs/claude-code/skills`
- Codex skills: `https://github.com/openai/codex/blob/main/docs/skills.md`
- Cursor rules: `https://docs.cursor.com/en/context`
- Gemini CLI context files:
  `https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html`
- AGENTS.md format: `https://github.com/openai/agents.md`
- `design-docs/specs/design-workflow-package-registry.md`
- `design-docs/specs/design-workflow-package-checkout-search.md`
- `design-docs/specs/design-workflow-package-publish.md`
- `packages/rielflow/src/workflow/packages/checkout.ts`
- `packages/rielflow/src/workflow/checkout/index.ts`
- `packages/rielflow/src/workflow/checkout/registry.ts`
- `packages/rielflow/src/workflow/checkout/types.ts`
