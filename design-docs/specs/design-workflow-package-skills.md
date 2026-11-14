# Workflow Package Skills

Design for packaging workflow directories together with vendor-scoped skills
and context files.

## Overview

Workflow package checkout must support packages that contain both rielflow
workflow bundles and vendor guidance assets. Packages separate runtime
workflows from skill/context assets so checkout can validate, install, list,
update, and remove each artifact type independently.

This feature owns the package skill layout and vendor format mapping. Adjacent
package checkout, registry, integrity, command, and publish designs remain the
source of truth for package resolution, checksum calculation, CLI parsing, and
clean-install update mechanics.

## Feature Contract

- Feature id: `package-skill-layout-and-vendor-formats`
- Feature title: Package Skill Layout And Vendor Format Mapping
- Workflow mode: `issue-resolution`
- Issue reference: `workflowInput: Package workflows with vendor-scoped skills
  and checkout update metadata`
- Fanout group: `feature-local-planning`
- Fanout feature id: `package-skill-layout-and-vendor-formats`
- Design document path:
  `design-docs/specs/design-workflow-package-skills.md`
- Implementation plan target:
  `impl-plans/active/workflow-package-skills.md`
- Branch input source: `runtimeVariables.fanout.item` and
  `runtimeVariables.workflowCall.input`
- Codex-agent references:
  - `../../codex-agent` as the preferred local reference root when present.
  - `https://github.com/openai/codex/blob/main/docs/skills.md`
  - `https://docs.claude.com/en/docs/claude-code/skills`
  - `https://docs.cursor.com/en/context`
  - `https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html`

Issue #35 in `tacogips/rielflow` was inspected during intake and is unrelated
to this package checkout feature. This document intentionally uses the workflow
input title/body as the authoritative issue source for this workflow run.

## Goals

- Define a rielflow package layout for packages containing workflows and
  vendor-scoped skill/context assets.
- Whitelist package skill vendors to `agents`, `claude`, `codex`, `cursor`, and
  `gemini`.
- Map user-scope and project-scope checkouts to safe vendor-specific projection
  targets.
- Persist package, workflow, skill, registry, version, hash, and integrity
  metadata so checkout can detect changed packages.
- Support clean-install update behavior for changed package content while
  requiring confirmation by default.
- Support package removal by deleting only recorded package-owned managed skill
  files and projections.
- Keep vendor guidance assets inert until projected; never execute bundled
  scripts during checkout validation.

## Non-Goals

- Implementing a full cross-vendor skill authoring standard beyond file layout
  validation and projection.
- Supporting arbitrary vendor names or arbitrary home-directory writes.
- Resolving package variables or template interpolation. The behavior is similar
  to `tacogips/ign` template management only for checkout/update flow, not
  templating.
- Installing MCP servers, browser extensions, plugins, or executable
  dependencies as part of skill projection.
- Merging package content into existing hand-written vendor files.
- Removing vendor files that are not listed as package-owned artifacts in
  checkout metadata.

## Package Layout

Package roots use explicit top-level directories:

```text
<package>/
  rielflow-package.json
  workflows/
    <workflow-name>/
      workflow.json
      nodes/node-*.json
      prompts/
  skills/
    agents/AGENTS.md
    claude/<skill-name>/SKILL.md
    codex/<skill-name>/SKILL.md
    cursor/<rule-name>.mdc
    gemini/GEMINI.md
```

Rules:

- `workflows/` is required when the package contains workflows.
- `skills/` is optional, but if present every direct child must be one of the
  whitelisted vendors.
- Skill names and rule/context names must be safe relative path segments:
  lowercase letters, digits, hyphens, underscores, and dots where the vendor
  format requires an extension.
- Absolute paths, `..`, symlinks that escape the package root, and hidden
  vendor directories are rejected.
- Packages may contain multiple workflows and multiple vendor skill entries,
  but checkout records every installed artifact separately.

## Manifest Extensions

`rielflow-package.json` keeps existing package metadata and adds optional
skill-aware fields:

- `workflows`: array of workflow entries with `name`, `path`, optional
  `version`, and optional `integrity`.
- `skills`: array of skill entries with `vendor`, `name`, `path`, optional
  `version`, `integrity`, and `projection`.
- `packageHash`: deterministic hash covering normalized workflow and skill
  files.
- `packageIntegrity`: stronger integrity value suitable for tamper detection.
- `registryUrl`, `registryRef`, and `sourceDirectory`: copied into checkout
  records from the resolved registry selection.

The registry/cache layer may derive `skills` by scanning `skills/<vendor>/`
when authored metadata omits it. Authored entries must match files on disk.
`packageHash` and integrity inputs include `workflows/**`, `skills/**`, and the
normalized manifest with hash/integrity fields omitted.

## Vendor Format Mapping

### `agents`

`agents` is repository instruction context represented by a package-local
`skills/agents/AGENTS.md` file. Project-scope checkout may project it to
`<project>/AGENTS.md` only when the destination does not exist or
overwrite/update is explicitly confirmed. User-scope checkout keeps it in
rielflow-managed storage because there is no universally safe global
`AGENTS.md` destination.

Reference: `https://github.com/openai/agents.md`.

### `claude`

Claude Code skills are directories with required `SKILL.md`. Personal skills
live under `~/.claude/skills/<skill-name>/SKILL.md`; project skills live under
`.claude/skills/<skill-name>/SKILL.md`. Claude supports YAML frontmatter and
optional supporting files inside the skill directory. Rielflow validates only
the package file structure and safe paths; Claude-specific semantic validation
is left to Claude Code.

Reference: `https://docs.claude.com/en/docs/claude-code/skills`.

### `codex`

Codex consumes skills as `.codex/skills/<skill-name>/SKILL.md` directories with
optional resources. Codex also uses `AGENTS.md` and `AGENTS.override.md` for
repository instructions, but package checkout must not project Codex skills
into `AGENTS.md` automatically because that would merge untrusted guidance into
always-loaded project context.

Default Codex projections:

- project scope:
  `<project>/.codex/skills/<skill-name>/`
- user scope:
  `$HOME/.codex/skills/<skill-name>/`

Checkout still installs a managed copy first, then projects into the Codex
skill root only after managed-file ownership and collision checks pass. A
configured Codex skill root may override the default only when the user has
explicitly allowlisted that root; the override is not a substitute for the
documented default `$HOME/.codex/skills` user location. This differs
intentionally from generic Agent Skills roots because the issue requires Codex
vendor skill layout to use `.codex/skills/<name>/SKILL.md`.

References:

- `https://github.com/openai/codex/blob/main/docs/skills.md`
- `https://developers.openai.com/codex/skills`
- `https://developers.openai.com/codex/guides/agents-md`

### `cursor`

Cursor project rules are files under `.cursor/rules`. Package entries for
Cursor are treated as rule files, not Agent Skills. The preferred package file
extension is `.mdc`; plain `.md` may be accepted only when the projection code
can preserve a valid Cursor rule file name. User-scope projection is disabled
by default because current Cursor rule guidance is primarily project-scoped and
global instruction formats differ by product version. User-scope checkout keeps
the managed copy and reports `projection.status: skipped`.

Reference: `https://docs.cursor.com/en/context`.

### `gemini`

Gemini CLI consumes `GEMINI.md` context files from global, project ancestor, and
subdirectory locations, and supports imports using `@file.md`. Package entries
for Gemini are represented by a package-local `skills/gemini/GEMINI.md`.
Project-scope projection writes to `<project>/GEMINI.md` only when the file is
absent or overwrite/update is explicitly confirmed. User-scope projection writes
the managed copy under `~/.rielflow-managed` and does not update global Gemini
context by default.

Reference:
`https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html`.

## Scope Storage And Projection

Checkout first installs package artifacts into rielflow-managed storage, then
projects vendor files where safe.

Project scope:

- workflows: `<project>/.rielflow/workflows/<workflow-name>/`, or
  `<workflow-definition-dir>/<workflow-name>/` when package checkout receives
  `--workflow-definition-dir`
- managed skills:
  `<project>/.rielflow/managed/packages/<package-name>/skills/<vendor>/<name>/`
- projections:
  - claude: `<project>/.claude/skills/<skill-name>/`
  - codex: `<project>/.codex/skills/<skill-name>/`
  - cursor: `<project>/.cursor/rules/<rule-name>.mdc`
  - gemini: `<project>/GEMINI.md` when absent or confirmed
  - agents: `<project>/AGENTS.md` when absent or confirmed

User scope:

- workflows: `~/.rielflow/workflows/<workflow-name>/`
- managed skills:
  `~/.rielflow-managed/packages/<package-name>/skills/<vendor>/<name>/`
- projections:
  - claude: `~/.claude/skills/<skill-name>/`
  - codex: `$HOME/.codex/skills/<skill-name>/`
  - cursor: skipped by default
  - gemini: skipped by default unless the user explicitly allows updating
    global context
  - agents: managed storage only

Projection writes must be atomic where possible and must reject collisions with
non-rielflow-managed files unless overwrite/update is confirmed.
`--workflow-definition-dir` changes only the workflow destination root; project
scope managed skill storage and vendor projections still use the current
project root.
Codex user-scope overrides are allowed only for explicitly configured and
allowlisted roots; the implementation must still report the effective
projection path in checkout metadata.

## Skill Listing And Removal Metadata

Package list output should expose installed skill records exactly as stored in
checkout metadata. Each listed skill should include vendor, name, source path,
managed path, projection path, projection status, version when available, hash
or checksum, integrity fields, and install mode. List must not inspect vendor
global state to infer extra skills; the checkout catalog is the source of
truth.

Package removal must treat recorded skill artifacts as an allow-list:

- Managed skill copies under `.rielflow/managed` or `~/.rielflow-managed` may be
  removed only when their paths are recorded for the selected install id.
- Projected vendor files may be removed only when their paths are recorded for
  the selected checkout record.
- Managed-only skills are removed from managed storage and reported with
  `projection.status: skipped` or equivalent in remove output.
- Shared vendor directories, such as `.codex/skills` or `.claude/skills`, are
  never removed as a whole; only the package-owned skill entry directory or file
  may be removed.

## Checkout And Update Behavior

Checkout extends the package install flow after package resolution:

1. Resolve the package from registry metadata, including workflow and skill
   entries.
2. Stage the complete package into a temporary directory.
3. Validate workflow bundles and skill directory formats.
4. Compute and verify package hash/integrity.
5. Compare existing checkout metadata for the same package and scope.
6. If installed content differs, require confirmation unless the caller passed
   a skip-confirmation option such as `--yes`.
7. Clean-install changed workflows and skills by removing only previously
   managed artifacts for that package and scope, then installing the new staged
   content.
8. Write provenance metadata after successful filesystem mutation.

Clean install must never delete hand-written files that are outside the
previous checkout record. If a previously managed projection was edited by the
user, checkout should fail with a conflict unless overwrite/update is confirmed.

## Checkout Metadata

Package checkout records continue under the package checkout provenance root
defined by adjacent designs and add skill-specific metadata:

- `packageName`
- `registryUrl`
- `registryRef`
- `sourceDirectory`
- `scope`
- `checkedOutAt`
- `packageVersion`
- `packageHash`
- `packageIntegrity`
- `workflows`: installed workflow names, source paths, destination paths,
  versions, and integrity values
- `skills`: vendor, name, source path, managed path, projection path,
  projection status, version, hash, and integrity
- `managedFiles`: exact file list installed by rielflow for clean-update
  removal

Checkout comparison uses `packageHash` first and per-artifact hashes for precise
update reporting.

## Security And Validation

- Reject vendors outside `agents`, `claude`, `codex`, `cursor`, and `gemini`.
- Reject path traversal, absolute paths, unsafe symlinks, and executable
  projection hooks.
- Never run package skill scripts during checkout.
- Preserve file modes conservatively; do not add executable bits during
  projection.
- Require explicit confirmation before overwriting or removing any existing
  projection.
- Treat package hashes as update/integrity metadata, not a complete trust
  boundary.

## Verification Commands

Expected implementation verification:

```bash
bun test packages/rielflow/src/workflow/packages/*.test.ts packages/rielflow/src/workflow/checkout/*.test.ts packages/rielflow/src/cli.test.ts
bun run packages/rielflow/src/bin.ts package list --output json
bun run packages/rielflow/src/bin.ts package remove --install-id <install-id> --output json
bun run packages/rielflow/src/bin.ts workflow package checkout <package-id> --output json
bun run packages/rielflow/src/bin.ts workflow package checkout <package-id> --user-scope --yes --output json
git diff --check -- design-docs/specs/design-workflow-package-skills.md
```

## Decisions

- Keep `workflows/` and `skills/` as separate top-level package directories.
- Use a strict vendor whitelist: `agents`, `claude`, `codex`, `cursor`,
  `gemini`.
- Treat Cursor and Gemini package entries as context/rule projections rather
  than Agent Skills.
- Install user-scope package skills into `~/.rielflow-managed` first, then
  project only to safe or explicitly allowlisted vendor locations.
- Use clean-install update semantics scoped to the recorded managed file list.
- Require confirmation by default for overwrite/update; support a noninteractive
  skip-confirmation flag for workflow automation.
- Keep `agents` and `gemini` package layouts file-based (`AGENTS.md` and
  `GEMINI.md`) rather than directory-per-skill because the issue requires the
  current vendor context-file conventions.
- Use `.codex/skills/<name>/SKILL.md` as the Codex vendor projection target for
  this feature, even though generic Agent Skills references may use other roots.

## Open Questions

Tracked in `design-docs/user-qa/qa-workflow-package-checkout.md`.

- Should the registry index expose skills as searchable package metadata in the
  first implementation or defer search filters to a later package catalog slice?

## Risks

- Vendor formats are moving targets, especially Codex and Cursor skill/rule
  discovery.
- User-scope projection can overwrite personal agent configuration if
  allowlists and managed-file checks are too permissive.
- Clean-install updates can leave stale vendor behavior if projection cleanup
  succeeds but vendor tools cache old context.
- Hash-based update checks can miss trust problems; signed registry metadata or
  stricter pre-install checks may still be needed.
