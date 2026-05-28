# Workflow Package CLI Commands

Feature-local design for the user-facing rielflow workflow package command
surface that ties registry registration, package search, checkout, publish,
refresh, and metadata inspection together.

## Overview

Rielflow workflow packages are workflow bundle directories published through
GitHub-backed registries. The command layer must expose package operations
without breaking the existing workflow catalog and direct GitHub directory
checkout behavior.

The default public registry is
`https://github.com/tacogips/rielflow-packages`. The developer-local checkout for
that registry is `/Users/taco/gits/tacogips/rielflow-packages`. Users may add
personal registries, with registry configuration persisted under `~/.rielflow`.

This document covers the `package-commands` feature slice. It depends on the
registry metadata/cache, publish, checkout/search, and migration feature slices
for data contracts and implementation internals.

## Feature Contract

- Feature id: `package-commands`
- Feature title: Workflow Package Commands
- Issue reference: workflowInput: Implement workflow package registry and
  package commands
- Workflow mode: `issue-resolution`
- Implementation plan target:
  `impl-plans/active/workflow-package-commands.md`
- Primary source touchpoints:
  - `packages/rielflow/src/cli.ts`
  - `packages/rielflow/src/cli/workflow-command-handler.ts`
  - `README.md`

## Command Map

Package functionality should live under `workflow` unless the action is a
top-level publish operation required by existing issue wording.

Required command forms:

```bash
rielflow workflow registry add <registry-url> [--name <alias>] [--branch <branch>] [--local-path <path>] [--output json|text]
rielflow workflow registry list [--output json|text]
rielflow workflow registry remove <registry-url-or-alias> [--output json|text]
rielflow workflow registry refresh [<registry-url-or-alias>] [--branch <branch>] [--cache json|sqlite] [--output json|text]
rielflow workflow search [query] [--registry <registry-url-or-alias>] [--tag <tag>] [--backend <backend>] [--limit <n>] [--refresh] [--cache json|sqlite] [--output table|json|text]
rielflow workflow checkout <github-directory-url-or-package-id> [--registry <registry-url-or-alias>] [--branch <branch>] [--user-scope] [--overwrite] [--output json|text]
rielflow workflow package show <package-id> [--registry <registry-url-or-alias>] [--branch <branch>] [--output json|text]
rielflow publish <workflow-name-or-path> [--registry <registry-url>] [--registry-local-path <path>] [--branch <branch>] [--package-id <id>] [--source-workflow-dir <path>] [--message <text>] [--create-pr] [--pr-base <branch>] [--dry-run] [--output json|text]
```

Current compatibility command forms:

```bash
rielflow workflow package registry list [--output json|text]
```

The top-level `workflow registry list` form is the expected user-facing surface
for displaying the remote workflow package registry list. The package-scoped
`workflow package registry list` form remains supported as a compatibility alias
because existing users and README examples may already depend on it. Both forms
must render the same registry-list data and JSON shape.

The implementation may also accept `rielflow workflow publish ...` as an alias
to `rielflow publish ...` if routing is simpler or if help output benefits from
workflow scoping. The canonical documented form remains `rielflow publish`.

## Registry Commands

`workflow registry add` validates that the registry URL is an HTTPS GitHub
repository URL, normalizes it, stores a local registry record under
`~/.rielflow`, and optionally records an alias, default branch, and local path.
When no registry has been configured, the default registry is available
implicitly; adding it explicitly records local preferences such as alias or
local path.

`workflow registry list` prints configured registries plus the implicit default
registry. It must route to the same package registry listing service used by
`workflow package registry list`, not maintain a separate registry reader or
output renderer. JSON output must include stable fields for automation:

- `registries`
- `defaultRegistryUrl`
- `configPath`
- `cacheRoot`

`workflow registry remove` removes only user-configured records. It must reject
removal of the implicit default registry unless the implementation introduces an
explicit disable flag in a later design.

`workflow registry refresh` updates registry metadata and search cache for the
selected registry or all enabled registries. It should use the registry
metadata/cache contract rather than duplicating index parsing in the command
handler.

### Registry List Issue Addendum

Issue-resolution request: support `workflow registry list --output json` while
preserving the existing working `workflow package registry list --output json`
path.

Behavioral boundary for this issue:

- `workflow registry list --output json` exits successfully and emits the same
  registry-list JSON shape as `workflow package registry list --output json`.
- `workflow package registry list --output json` continues to route exactly as
  before.
- The implementation should share command handling or a small adapter so the two
  list forms cannot drift in validation, config loading, default registry
  inclusion, or JSON rendering.
- `workflow registry add`, `workflow registry remove`, and
  `workflow registry refresh` remain part of the broader package-command design,
  but this issue only requires the top-level `list` surface.
- Help and user-facing docs should mention `workflow registry list` as the
  expected discovery surface and may keep `workflow package registry list` as a
  compatibility form.

## Search And Metadata Commands

`workflow search` discovers installable package workflows by package metadata.
It does not inspect runtime session state and should not be confused with
`workflow list` or `workflow status`.

Search behavior:

- empty query lists indexed packages with the requested limit
- `--refresh` refreshes selected registry cache before search
- filters apply before ranking
- table output uses columns `PACKAGE`, `WORKFLOW`, `REGISTRY`, `TAGS`, and
  `SUMMARY`
- JSON output includes package records, match metadata, cache metadata, and
  enough source information for a later checkout call

`workflow package show` displays one normalized package record plus its manifest
path, workflow directory, checksum, registry URL, branch/ref, and searchable
metadata. It should resolve the package using the same resolver as checkout so
ambiguous package identifiers fail consistently.

## Checkout Command

The existing command remains valid:

```bash
rielflow workflow checkout https://github.com/<owner>/<repo>/tree/<ref>/<workflow-dir>
```

When the checkout target is not a GitHub directory URL, the command treats it as
a package id and resolves it through the configured registries.

Required checkout decisions:

- project scope is the default installation destination
- `--user-scope` installs under `~/.rielflow/workflows`
- duplicate destinations fail unless `--overwrite` is set
- `--workflow-definition-dir` remains incompatible with checkout because
  checkout mutates managed project or user catalog roots
- `--endpoint` remains unsupported because checkout is a local filesystem write
- direct GitHub directory checkout keeps the existing behavior and provenance
  record shape
- package checkout adds package provenance fields such as package id, registry
  URL, branch/ref, source directory, and checksum

Checkout must emit enough text and JSON output for a user or automation agent to
know exactly what was installed and from where.

## Publish Command

`rielflow publish` publishes one validated workflow directory into a GitHub
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
- `cache`
- `provenancePath`

Usage errors return exit code `2`. Runtime failures such as fetch, validation,
permission, or filesystem errors return exit code `1`. Successful dry-run
publish returns exit code `0` and includes `dryRun: true` in JSON output.

Errors must name the rejected command option and the relevant registry, package,
or path. Ambiguous package resolution must include candidate package ids.

## CLI Integration

The command parser currently routes workflow commands through
`packages/rielflow/src/cli/workflow-command-handler.ts`; top-level entry remains
`packages/rielflow/src/cli.ts`. The implementation should keep parsing and
rendering near existing workflow command handling and move package-specific data
operations into workflow package modules rather than expanding the handler with
Git, cache, or checksum logic.

Top-level `rielflow publish` requires a parser exception before the current
scope/command/target arity guard. It should route to the same publish rendering
and service contract as a future `rielflow workflow publish` alias, but help and
README content should document `rielflow publish` as canonical.

The global output option guard must allow `--output table` for `workflow search`
while keeping unsupported table output rejected for commands that do not render
tables. Existing `workflow list` and `workflow status` table support must remain
unchanged.

`workflow registry` uses a nested command target. The parser should interpret
`rielflow workflow registry add`, `list`, `remove`, and `refresh` without
confusing the registry subcommand with a workflow name or checkout target.
For the registry-list issue, it is sufficient to add the `list` route first,
provided the parser keeps returning the existing package-registry behavior for
`rielflow workflow package registry list`.

Help output and README examples must make these distinctions explicit:

- `workflow checkout <github-url>` installs a direct GitHub workflow directory
- `workflow checkout <package-id>` installs a registry package
- `workflow search` searches package metadata, not session state
- `rielflow publish` writes to a GitHub registry and may push or create a PR

## Decisions

- This feature id is `package-commands`; older wording that called the slice
  `package-cli-commands` is normalized to the fanout contract.
- Package discovery commands are scoped under `workflow` because they install
  and describe workflow bundles.
- The canonical publish command is top-level `rielflow publish`, with optional
  `workflow publish` alias left to implementation convenience.
- The default registry is implicit even when the user has not created a personal
  registry record.
- `workflow registry list` is the canonical registry-list display command;
  `workflow package registry list` is retained as a compatibility alias with the
  same output contract.
- Personal registry configuration is stored under `~/.rielflow`, not project
  scope.
- Checkout keeps direct GitHub directory compatibility and branches into package
  resolution only for non-URL targets.
- Checkout defaults to project scope and requires `--user-scope` for user
  catalog installation.
- `--workflow-definition-dir` remains incompatible with checkout.
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
- Whether `workflow package show` should support an explicit `--version` option
  later, or rely on branch/ref plus checksum for the first implementation.

## Risks

- CLI routing can become overloaded if package data operations remain inside the
  command handler; implementation should isolate registry, cache, resolver, and
  publish services.
- The current CLI arity guard expects `scope command target` for most commands,
  so `rielflow publish <workflow>` and nested `workflow registry <action>` need
  deliberate parser coverage and focused tests.
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
bun run packages/rielflow/src/bin.ts workflow registry list --output json
bun run packages/rielflow/src/bin.ts workflow package registry list --output json
bun test packages/rielflow/src/workflow/checkout/checkout.test.ts
bun test packages/rielflow/src/workflow/catalog.test.ts
bun run packages/rielflow/src/bin.ts workflow search --output json
bun run packages/rielflow/src/bin.ts workflow checkout <package-id> --output json
bun run packages/rielflow/src/bin.ts publish <workflow-name-or-path> --registry https://github.com/tacogips/rielflow-packages --dry-run --output json
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
