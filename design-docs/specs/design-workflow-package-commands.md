# Workflow Package CLI Commands

Feature-local design for the user-facing rielflow package command surface that
ties registry registration, package search, package install/list/remove,
publish, refresh, and metadata inspection together.

## Overview

Rielflow packages are installable bundles published through GitHub-backed
registries. A package can contain workflows and vendor-scoped skill/context
assets, so the command layer must expose package operations without implying
that checkout only manages workflows. Existing workflow catalog commands and
direct GitHub directory checkout behavior remain separate from package
lifecycle commands.

The default public registry is
`https://github.com/tacogips/rielflow-packages`. The developer-local checkout for
that registry is `/Users/taco/gits/tacogips/rielflow-packages`. Users may add
personal registries, with registry configuration persisted under `~/.rielflow`.

This document covers the `package-commands` feature slice. It depends on the
registry metadata/cache, publish, checkout/search, and migration feature slices
for data contracts and implementation internals.

Command naming in this document supersedes older package design slices that
mention compatibility routes such as `workflow package ...`, `workflow search`,
`workflow checkout <package-id>`, or top-level `rielflow publish`.

## Feature Contract

- Feature id: `package-commands`
- Feature title: Workflow Package Commands
- Issue reference: workflowInput: Implement workflow package registry and
  package commands
- Workflow mode: `issue-resolution`
- Implementation plan target:
  `impl-plans/active/workflow-package-commands.md`
- Issue addendum: `workflowInput: Add package listing and removal for
  checkout-installed workflows and skills`
- Primary source touchpoints:
  - `packages/rielflow/src/cli.ts`
  - `packages/rielflow/src/cli/workflow-command-handler.ts`
  - `packages/rielflow/src/cli/workflow-package-command-handler.ts`
  - `packages/rielflow/src/cli/input-output-helpers.ts`
  - `packages/rielflow/src/workflow/packages/checkout.ts`
  - `packages/rielflow/src/workflow/packages/status.ts`
  - `packages/rielflow/src/workflow/packages/skills.ts`
  - `packages/rielflow/src/workflow/packages/types.ts`
  - `README.md`

## Command Map

Package lifecycle functionality should live under top-level `package` commands
because package installs can include workflows and skills. Do not add
workflow-scoped package aliases; they obscure the package lifecycle API and make
help output harder to learn.

Required command forms:

```bash
rielflow package install <package-id> [--registry <registry-url-or-alias>] [--branch <branch>] [--user-scope] [--workflow-definition-dir <path>] [--overwrite] [--yes] [--output json|text]
rielflow package search [query] [--registry <registry-url-or-alias>] [--tag <tag>] [--backend <backend>] [--limit <n>] [--refresh] [--output table|json|text]
rielflow package registry add <id> --registry-url <url> [--local-path <path>] [--branch <branch>] [--output json|text]
rielflow package registry list [--output json|text]
rielflow package list [--scope project|user|auto] [--workflow-definition-dir <path>] [--output json|text]
rielflow package remove <package-id-or-workflow-name> [--scope project|user|auto] [--install-id <id>] [--workflow-definition-dir <path>] [--output json|text]
rielflow package publish <workflow-name-or-path> [--registry <registry-url>] [--registry-local-path <path>] [--branch <branch>] [--package-id <id>] [--source-workflow-dir <path>] [--message <text>] [--create-pr] [--pr-base <branch>] [--dry-run] [--output json|text]
rielflow workflow checkout <github-directory-url> [--user-scope] [--overwrite] [--output json|text]
rielflow workflow run <package-id-or-github-directory-url> --from-registry [--registry <registry-url-or-alias>] [--branch <branch>] [--output json|text]
```

Unsupported workflow-scoped package forms include `workflow package ...`,
`workflow registry ...`, `workflow search`, and `workflow checkout
<package-id>`. New automation must use `package ...` for persistent package
operations.

## Registry Commands

`package registry add` validates that the registry URL is an HTTPS GitHub
repository URL, normalizes it, stores a local registry record under
`~/.rielflow`, and optionally records an alias, default branch, and local path.
When no registry has been configured, the default registry is available
implicitly; adding it explicitly records local preferences such as alias or
local path.

`package registry list` prints configured registries plus the implicit default
registry. JSON output must include stable fields for automation:

- `registries`
- `defaultRegistryUrl`
- `configPath`
- `cacheRoot`

## Search And Metadata Commands

`package search` discovers installable package workflows by package metadata. It
does not inspect runtime session state and should not be confused with
`workflow list` or `workflow status`.

Search behavior:

- empty query lists indexed packages with the requested limit
- `--refresh` refreshes selected registry cache before search
- filters apply before ranking
- table output uses columns `PACKAGE`, `WORKFLOW`, `REGISTRY`, `TAGS`, and
  `SUMMARY`
- JSON output includes package records, match metadata, cache metadata, and
  enough source information for a later checkout call

## Package Lifecycle Commands

`package install` is the canonical command for persistent package installation.
It renders package-oriented help, summaries, and JSON field names. It installs
workflow packages and node packages; node packages are registry packages with
`kind: "node-addon"` whose primary artifacts are local add-on manifests. See
`design-docs/specs/design-workflow-node-package-install.md`.

Install behavior:

- Package install targets resolve as package ids through the configured
  registries. Raw GitHub directory URLs remain a direct workflow checkout
  concern under `workflow checkout <github-url>`.
- Project scope is the default installation destination.
- `--user-scope` installs package workflows under `~/.rielflow/workflows` and
  package-managed skill data under `~/.rielflow-managed`.
- Node package installs write package-owned add-on artifacts under
  `<project>/.rielflow/addons` or `~/.rielflow/addons` and include
  `packageKind: "node-addon"` plus installed `addons[]` entries in JSON output.
- `--workflow-definition-dir` is allowed as a project-scope workflow
  destination override; skill projection and package ownership checks still use
  the current project root. It does not redirect node package add-on
  projection.
- `--overwrite` permits replacing an existing package-owned install after
  confirmation.
- `--yes` bypasses overwrite/update confirmation for automation.

`package list` reads the local checkout catalog only; it must not refresh
registries or require network access. It lists package checkout records with
enough metadata to make update, audit, and removal decisions without loading
remote package contents.

Required list JSON fields:

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

Text output should use compact columns for `INSTALL ID`, `PACKAGE`, `WORKFLOW`,
`SCOPE`, `VERSION`, `HASH`, and `DESTINATION`. It may truncate long ids and
hashes only in text output; JSON output must keep full values.

`package remove` removes only package-owned artifacts recorded in checkout
catalog metadata. It accepts `--install-id` as the exact selector. Without an
install id, the selector may match package id, package name, or workflow name,
then scope and project-root filters are applied. Ambiguous matches fail with a
usage error and require retrying with `--install-id`. Missing records fail
without mutating files.

Removal behavior:

- Removal reports the workflow destination, workflow-local provenance file,
  checkout record, managed skill root, and projected skill files that were
  deleted or already absent.
- Removal deletes the catalog record only after package-owned workflow and
  skill artifacts are deleted or confirmed absent.
- Direct URL checkout records are not removed by `package remove` unless the
  command explicitly identifies a package checkout record. The command should
  report `not-package-checkout` for legacy direct records.

Required remove JSON fields:

- `installId`
- `packageId`
- `packageName`
- `workflowName`
- `scope`
- `checkoutRecordPath`
- `removedPaths`
- `skippedPaths`

## Direct Workflow Checkout

The existing command remains valid:

```bash
rielflow workflow checkout https://github.com/<owner>/<repo>/tree/<ref>/<workflow-dir>
```

The checkout target must be a GitHub directory URL. Package ids are installed
through `rielflow package install <package-id>`.

Required checkout decisions:

- project scope is the default installation destination
- `--user-scope` installs under `~/.rielflow/workflows`
- duplicate destinations fail unless `--overwrite` is set
- `--workflow-definition-dir` remains a workflow destination override, not a
  project root override
- `--endpoint` remains unsupported because checkout is a local filesystem write
- direct GitHub directory checkout keeps the existing behavior and provenance
  record shape
Checkout must emit enough text and JSON output for a user or automation agent to
know exactly what was installed and from where.

## Publish Command

`rielflow package publish` publishes one validated workflow directory into a GitHub
registry repository. It must require push permission for direct publication.
When the user has permission to create pull requests but should not or cannot
push directly to the target branch, `--create-pr` creates a publishing branch and
opens a PR.

Command-layer responsibilities:

- parse and validate publish options
- resolve the source workflow by name or path
- reject ambiguous source and registry options before mutating worktrees
- pass registry URL, branch, PR mode, package id, metadata overrides, and dry-run
  settings to the publish implementation
- render structured publish results

Publish implementation details such as Git subprocess hardening, checksum
generation, registry layout, PR adapter choice, and dirty worktree refusal are
owned by `design-docs/specs/design-workflow-package-publish.md`.

## Output And Error Contracts

All package commands support `--output json` for automation. Text output should
remain compact and human-readable; table output is only required for search.

Common JSON result fields should use the same names across commands where
applicable:

- `registryUrl`
- `registryRef`
- `packageId`
- `workflowName`
- `workflowDirectory`
- `checksum`
- `checksumAlgorithm`
- `installId`
- `packageVersion`
- `packageHash`
- `skills`
- `cache`
- `provenancePath`

Usage errors return exit code `2`. Runtime failures such as fetch, validation,
permission, or filesystem errors return exit code `1`. Successful dry-run
publish returns exit code `0` and includes `dryRun: true` in JSON output.

Errors must name the rejected command option and the relevant registry, package,
install id, or path. Ambiguous package resolution must include candidate
package ids. Ambiguous installed-package removal must include candidate install
ids and destination directories.

## CLI Integration

The command parser currently routes workflow commands through
`packages/rielflow/src/cli/workflow-command-handler.ts`; top-level entry remains
`packages/rielflow/src/cli.ts`. The implementation should keep parsing and
rendering near existing workflow command handling and move package-specific data
operations into workflow package modules rather than expanding the handler with
Git, cache, or checksum logic.

`rielflow package publish` uses the package command handler and should remain
the only package publication command surface. Help and README content should
document package publishing without workflow-scoped or top-level publish
aliases.

The global output option guard must allow `--output table` for `package search`
and `package list` while keeping unsupported table output rejected for commands
that do not render tables. Existing `workflow list` and `workflow status` table
support must remain unchanged.

Help output and README examples must make these distinctions explicit:

- `package install <package-id>` installs a registry package and is the
  canonical package lifecycle command
- node packages are installed through `package install` and are exposed to
  workflows as ordinary installed add-ons
- `package list` lists locally installed package records without network access
- `package remove` removes package-owned workflows and skills by install id or
  unambiguous package/workflow selector
- `workflow checkout <github-url>` installs a direct GitHub workflow directory
- `workflow checkout <package-id>` is rejected; use `package install`
- `package search` searches package metadata, not session state
- `package publish` writes to a GitHub registry and may push or create a PR

## Decisions

- This feature id is `package-commands`; older wording that called the slice
  `package-cli-commands` is normalized to the fanout contract.
- Package lifecycle commands are top-level `package` commands because packages
  can include workflows and skills.
- Workflow-scoped package aliases are intentionally unsupported.
- `package list` reads installed checkout records locally and never refreshes
  remote registries.
- `package remove` requires exact install-id targeting when a
  package/workflow selector is ambiguous.
- `package remove` deletes only package-owned artifacts recorded in the checkout
  catalog for the selected install.
- The canonical publish command is `rielflow package publish`.
- The default registry is implicit even when the user has not created a personal
  registry record.
- `package registry list` is the canonical registry-list display command.
- Personal registry configuration is stored under `~/.rielflow`, not project
  scope.
- Checkout accepts direct GitHub workflow directory URLs only.
- Checkout defaults to project scope and requires `--user-scope` for user
  catalog installation.
- `--workflow-definition-dir` is allowed for package install and package
  workflow checkout as a workflow destination override, while remaining separate
  from project-root selection for skill projection.
- Search may use sqlite cache when available, but command correctness cannot
  depend on sqlite.
- Checksums in command output include the algorithm, initially `md5`.
- JSON command output is the stable automation contract; human text/table output
  is presentation only.

## Open Questions

- Whether registry aliases should be generated automatically from GitHub
  owner/repository names or only stored when the user supplies `--name`.
- Whether `rielflow workflow publish` should be implemented as a documented
  alias in the first release or deferred until users ask for it.
- Whether a future `package show` command should expose one normalized package
  record plus manifest path, workflow directory, checksum, registry URL, and
  searchable metadata.

## Risks

- CLI routing can become overloaded if package data operations remain inside the
  command handler; implementation should isolate registry, cache, resolver, and
  publish services.
- The current CLI arity guard expects `scope command target` for most commands,
  so package commands that omit a target need deliberate parser coverage and
  focused tests.
- Search output introduces `--output table`; parser validation must be updated
  carefully so unrelated commands do not accept unsupported output formats.
- Package ids can conflict across registries or diverge from workflow names;
  ambiguous checkout and show operations must fail loudly.
- GitHub permission checks for publish can vary by credential helper and hosting
  policy, so failures must be clear and must occur before avoidable registry
  worktree mutation.
- The default registry local path is machine-specific and should be treated as a
  development convenience, not persisted as canonical public metadata.

## Verification

Expected focused verification commands:

```bash
bun test packages/rielflow/src/cli.test.ts
bun test packages/rielflow/src/workflow/packages/packages.test.ts
bun run packages/rielflow/src/bin.ts package registry list --output json
bun test packages/rielflow/src/workflow/checkout/checkout.test.ts
bun test packages/rielflow/src/workflow/catalog.test.ts
bun run packages/rielflow/src/bin.ts package search --output json
bun run packages/rielflow/src/bin.ts package install <package-id> --output json
bun run packages/rielflow/src/bin.ts package publish <workflow-name-or-path> --registry https://github.com/tacogips/rielflow-packages --dry-run --output json
bun run tsc --noEmit
git diff --check
```

## References

- `design-docs/specs/design-workflow-package-registry.md`
- `design-docs/specs/design-workflow-package-checkout-search.md`
- `design-docs/specs/design-workflow-package-publish.md`
- `design-docs/specs/design-workflow-package-registry-migration.md`
- `packages/rielflow/src/cli.ts`
- `packages/rielflow/src/cli/workflow-command-handler.ts`
- `README.md`
