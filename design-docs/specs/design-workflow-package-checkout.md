# Workflow And Skill Package Checkout Install

Design for installing workflow packages that may contain both workflow bundles
and vendor-scoped skills resolved from Git-backed rielflow package registries.

## Overview

The package checkout install feature extends the existing scoped workflow
checkout implementation so `rielflow` can install package-selected workflow
bundles and package-selected skills from a registry entry, not only from a
direct GitHub directory URL. Package registries are GitHub repositories, with
`https://github.com/tacogips/rielflow-packages` as the default public registry
and `/Users/taco/gits/tacogips/rielflow-packages` as the local development
checkout for that registry.

This feature owns the install path after a package has been selected by package
id, search result, or explicit registry filter. Registry configuration,
metadata indexing, publish behavior, and search ranking are defined in adjacent
package design documents and should feed this installer through stable package
resolution data. Package checkout must preserve existing workflow-only behavior
while adding an explicit package layout for skill content and an update-aware
managed install record for both workflows and skills.

## Feature Contract

- Feature id: `package-checkout-skill-installation`
- Feature title: Workflow And Skill Checkout Installation
- Workflow mode: `issue-resolution`
- Issue reference: `workflowInput: Package workflows with vendor-scoped skills
  and checkout update metadata`
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
- Separate package workflow directories from package skill directories.
- Preserve the current direct GitHub directory checkout compatibility path.
- Default package checkout to project scope.
- Support explicit user scope installation under `~/.rielflow/workflows`.
- Store user-scope managed skill data under `~/.rielflow-managed` before any
  projection into vendor locations.
- Support project-scope skill installation under project-local vendor paths.
- Validate package workflow bundles before mutating project or user scope.
- Validate package skill vendors and entry structure before mutating project,
  user, or vendor scope.
- Verify package checksums, initially supporting `md5`.
- Write package provenance beside existing checkout records under
  `~/.rielflow/workflow-registry/checkouts/`.
- Keep installation deterministic by recording registry URL, branch/ref, source
  directory, package id, workflow name, installed skills, package integrity,
  version, and checksum.
- Detect changed package metadata after checkout and support clean-install
  update semantics.
- Require confirmation before overwrite/update by default, with a noninteractive
  opt-out.

## Non-Goals

- Implementing registry publish or PR creation.
- Owning search ranking or sqlite cache internals.
- Supporting non-GitHub registry backends.
- Installing workflow package dependencies or add-ons.
- Translating arbitrary vendor-specific extensions beyond the documented
  package skill projections.
- Replacing direct URL checkout behavior.
- Treating skill content as trusted merely because it came from a known vendor
  directory.

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

The checkout command keeps the current direct URL form:

```bash
rielflow cli workflow checkout https://github.com/<owner>/<repo>/tree/<ref>/<workflow-dir>
```

Registry package checkout adds package targets:

```bash
rielflow cli workflow checkout <package-id> [--registry <registry-url-or-id>] [--branch <branch>] [--user-scope] [--overwrite] [--yes] [--output json|text]
```

Behavior:

- If the target is a valid GitHub directory URL, use the existing direct
  checkout path.
- Otherwise treat the target as a package id and resolve it through selected
  registry metadata.
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
- `--endpoint` remains unsupported because package checkout is a local
  filesystem mutation.

## Direct Workflow Destination Override

When package checkout receives `--workflow-definition-dir <path>`, only the
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
7. Validate each staged workflow bundle through the existing workflow loader.
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

## Checksum Verification

Checksums are change-tracking and cache-invalidation signals, not a security
boundary. The first implementation must support values equivalent to
`md5:<hex>` and should preserve algorithm-prefixed output so stronger hashes can
be added later.

Checksum verification rules:

- If metadata includes a checksum, package checkout must verify it before
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

- `packageId`
- `version`
- `registryUrl`
- `registryRef`
- `sourceDirectory`
- `metadataPath`
- `checksum`
- `checksumAlgorithm`
- `integrity`
- `checkedOutAt`
- `destinationDirectory`
- `workflowDirectory`
- `managedSkillRoot`
- `skills`
- `packageHash`

Each skill record includes `vendor`, `name`, `sourcePath`, `managedPath`,
`projectionPath`, `installMode`, and the copied entry checksum. The record is
stored under the user root even for project-scope installs so users have one
provenance catalog for all package checkouts.

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
checked out package: <package-id>
workflow: <workflow-name>
scope: project|user
destination: <path>
registry: <registry-url>
checksum: <algorithm>:<hex>
skills: <count>
updated: true|false
```

JSON output should include:

- `packageId`
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
- local I/O failure

Existing direct checkout errors should remain compatible where command behavior
has not changed.

## Decisions

- Keep package checkout under `rielflow cli workflow checkout` rather than
  adding a separate install command.
- Detect direct GitHub directory URLs first to preserve current behavior.
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
- Require checksum verification when package metadata provides a checksum.
- Persist registry URL, workflow name, package version, package hash/integrity,
  and installed skill entries for update detection.
- Require confirmation by default for overwrite/update and provide `--yes` as
  the explicit noninteractive bypass.
- Keep sqlite optional; checkout must be testable through injected registry
  resolver/cache/fetch abstractions.

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

## Verification Commands

```bash
bun test packages/rielflow/src/workflow/packages/packages.test.ts
bun test packages/rielflow/src/workflow/checkout/checkout.test.ts
bun test packages/rielflow/src/workflow/packages/checkout.test.ts
bun test packages/rielflow/src/cli.test.ts
bun run typecheck
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
