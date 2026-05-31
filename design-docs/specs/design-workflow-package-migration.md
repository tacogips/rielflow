# Workflow Package Migration

Design for migrating project-local `.rielflow` workflow bundles into the default
workflow package registry and adding a verified example package.

## Overview

This feature slice owns the content migration and verification path for the
workflow package registry feature. The source content is the current repository's
project-local workflow catalog under `.rielflow/workflows`. The destination is
the default registry checkout at `/Users/taco/gits/tacogips/rielflow-packages`,
which corresponds to `https://github.com/tacogips/rielflow-packages`.

The migration must preserve runtime workflow behavior. Registry packaging adds
`rielflow-package.json` manifests, searchable metadata, checksums, and example
documentation around existing workflow bundles; it does not rewrite workflow
graphs, prompts, node payloads, or mock-scenario semantics unless a bundle fails
validation after being copied.

This document covers the `registry-migration-example` feature slice.
Registry metadata, checksum, cache, checkout, search, and publish command
contracts are consumed from `design-docs/specs/design-workflow-package-registry.md`.

## Feature Contract

- Feature id: `registry-migration-example`
- Feature title: Registry Migration And Example Package
- Issue reference: workflowInput: Implement workflow package registry and
  package commands
- Workflow mode: issue-resolution
- Implementation plan target:
  `impl-plans/active/workflow-package-registry-migration.md`
- Primary source touchpoints:
  - `.rielflow/workflows`
  - `/Users/taco/gits/tacogips/rielflow-packages`
  - `examples/`
  - `README.md`
  - `packages/rielflow/src/workflow/load.ts`

This slice is intentionally content and verification focused. It depends on the
registry, checkout, search, publish, metadata, and cache slices for command and
library behavior. It must not redefine command semantics already owned by those
feature slices; it consumes their public contracts to migrate real workflows,
create at least one searchable example package, and verify that codex-agent
automation can discover and use the package through the package command path.

## Source Content

The migration source is the set of project-local workflow bundles currently
distributed with this repository:

- `design-and-implement-review-loop`
- `design-and-implement-review-loop-feature-plan`
- `refactoring-divide-and-conquer`
- `refactoring-slice-review`
- `impl-plan-completion-loop`
- `recent-change-quality-loop`

Each bundle is copied as a workflow package candidate only if it contains a
valid `workflow.json` and its referenced node, prompt, mock-scenario, and
expected-result files remain package-local. Files under `.rielflow` that are not
part of a workflow bundle, such as `.rielflow/README.md`, may become registry
README content but must not be treated as workflow runtime files.

Existing examples under `examples/` are reference workflow-definition fixtures
and should stay directly runnable with `--workflow-definition-dir ./examples`.
If the same workflow exists in `.rielflow/workflows` and `examples/`, the
project-local `.rielflow/workflows` bundle is the migration source for the
default package. The `examples/` copy can be used as comparison evidence during
verification, but it must not become a second package source of truth.

## Registry Layout

The default registry should use one package directory per workflow bundle. A
package directory contains its manifest and the workflow bundle files:

```text
packages/<package-name>/
  rielflow-package.json
  <workflow-id>/
    workflow.json
    nodes/
    prompts/
    mock-scenario.json
    EXPECTED_RESULTS.md
```

When a workflow bundle needs additional package-level docs or examples, those
files stay in the same package directory. Migrated project workflows use a
nested workflow root and therefore set `workflowDirectory` to the workflow id.
The manifest may omit `workflowDirectory` only when the package root is also the
workflow root. Any `workflowDirectory` value must be a safe relative path.

The registry root should include a README that describes package discovery,
search, checkout, validation, and contribution expectations. The README should
not replace package manifests as the searchable source of truth.

The repository-local `.rielflow/workflows` layout remains the runtime catalog
format after checkout. Package checkout installs workflow files into
`<project>/.rielflow/workflows/<workflow-id>` by default or into
`~/.rielflow/workflows/<workflow-id>` when the user requests user scope. Registry
package directories are source distribution units; scoped catalog directories
are installed runtime units.

## Package Manifest Metadata

Each migrated package receives `rielflow-package.json` using the metadata
contract from the registry design:

- `name`: stable package id. Migrated project-local workflows use the
  `project-<workflow-id>` prefix so they can coexist with independently authored
  examples and future third-party packages that use the raw workflow id.
- `version`: initial package metadata version, starting at `0.1.0`
- `description`: searchable summary based on workflow `description` and
  `.rielflow/README.md`
- `tags`: concise search terms such as `workflow`, `planning`, `review`,
  `refactoring`, `quality`, or `implementation`
- `registry`: registry id, initially `default`
- `checksumAlgorithm`: `md5`
- `checksum`: deterministic checksum of the package content
- `repository`: `https://github.com/tacogips/rielflow-packages`
- `workflowDirectory`: required for migrated project packages because the
  workflow bundle is nested under the package root
- `minimumRielflowVersion`: included when the implementation can determine a
  meaningful package-supported version

The manifest metadata must be useful to both humans and automation. Search
results should let a codex-agent select a package, identify its workflow id, and
call package install without reading every package file.

Each manifest should include enough searchable terms to distinguish management
workflows from worker or utility workflows. For migrated codex-agent workflows,
metadata should preserve backend expectations such as `codex-agent`,
`claude-code-agent`, `feature-plan`, `review`, `implementation`, or
`refactoring` tags when they help package search choose the correct workflow.

## Example Package

At least one package in the default registry must be marked and documented as an
example package. The recommended initial example is
`project-design-and-implement-review-loop-feature-plan`, whose workflow id is
`design-and-implement-review-loop-feature-plan`, because it exercises the
feature-local bounded fanout path used by the package implementation workflow
itself while staying smaller than the parent implementation loop.

The example package should include:

- package manifest metadata with tags that make it discoverable through package
  search
- preserved `mock-scenario.json` and `EXPECTED_RESULTS.md`
- a README section or package-local note showing search, checkout, validation,
  usage inspection, and mock-scenario run commands

The existing `examples/` directory remains a direct workflow-definition fixture
area. The registry example should be installed into project or user scope
through `package install` before validation rather than being copied into
`examples/` as a second source of truth.

The example package is also the acceptance fixture for codex-agent references in
this feature branch. Its package docs should show commands that a codex-agent
can execute without relying on hidden state, including registry URL, package
name, checkout scope, and validation commands.

The registry may also include small independently authored examples such as
`example-worker-only-single-step`. Those are useful for package mechanics, but
the project migration acceptance fixture remains
`project-design-and-implement-review-loop-feature-plan` because it proves that a
real codex-agent/claude-code-agent workflow bundle survives packaging.

## Migration Procedure

The implementation should use a deterministic migration procedure:

1. Read available source workflow bundles from `.rielflow/workflows`.
2. For each selected bundle, copy package-owned files into the corresponding
   registry package directory.
3. Generate or update `rielflow-package.json` with normalized metadata.
4. Calculate and store the package checksum after manifest normalization.
5. Validate the copied workflow bundle from the registry package directory.
6. Refresh package search/cache data for the default registry.
7. Checkout the example package into project scope by default.
8. Validate and inspect usage for the checked-out workflow.
9. Compare the checked-out workflow with the source workflow for package-owned
   files so migration did not silently alter graph, prompt, node, or mock data.

The implementation may leave the repository-local `.rielflow/workflows` content
in place until package install and command documentation are complete. Removing
or replacing project-local workflow content should happen only after the
registry package path is verified, because the current project workflows are
used to drive this implementation workflow.

After verification, migration may update documentation to point users at package
install for reusable workflow installation. It should not delete active
workflow bundles as part of this feature slice unless the implementation plan
explicitly stages a separate cleanup task and all package commands already pass.

## Checkout And Usage Verification

Verification must prove that registry content can be found, installed, and used
through the package command path:

- package search returns the example package with registry URL, branch, package
  name, workflow id, checksum, and source path
- package install installs into project scope by default and into user scope
  only when explicitly requested
- checkout provenance records package fields in
  `~/.rielflow/workflow-registry/checkouts/`
- the checked-out workflow passes `workflow validate`
- `workflow usage --output json` exposes enough callable information for
  automation to select the checked-out workflow
- the example package mock scenario can run from the checked-out workflow when
  the runtime dependencies are available
- the package-local checksum remains stable after regenerating metadata from a
  clean checkout of `/Users/taco/gits/tacogips/rielflow-packages`

## README Updates

Documentation updates should connect the existing workflow checkout guidance to
the new package registry path:

- default registry URL and local checkout path
- package search command examples
- package install command examples for project and user scope
- publish notes that explain direct push and PR-based publication at a high
  level without duplicating the publish-command design
- migration note explaining that former project-local workflows are available as
  packages in the default registry

README content in this repository should describe how users consume packages.
Detailed registry contribution guidance belongs in the default registry README.

The default registry README should describe how maintainers add or update a
package, including the requirement to validate workflow bundles and refresh
manifest checksums before publishing or opening a PR.

## Verification Commands

Expected focused verification commands:

```bash
bun run packages/rielflow/src/bin.ts package search --registry https://github.com/tacogips/rielflow-packages --output json
bun run packages/rielflow/src/bin.ts package search feature-plan --registry default --refresh --output json
bun run packages/rielflow/src/bin.ts package install project-design-and-implement-review-loop-feature-plan --registry default --overwrite --output json
bun run packages/rielflow/src/bin.ts workflow validate design-and-implement-review-loop-feature-plan
bun run packages/rielflow/src/bin.ts workflow usage design-and-implement-review-loop-feature-plan --output json
bun run packages/rielflow/src/bin.ts workflow run design-and-implement-review-loop-feature-plan --mock-scenario .rielflow/workflows/design-and-implement-review-loop-feature-plan/mock-scenario.json --output json
find /Users/taco/gits/tacogips/rielflow-packages/packages -name rielflow-package.json -print
git -C /Users/taco/gits/tacogips/rielflow-packages status --short
git diff --check
```

Additional checks should validate every migrated package directory in
`/Users/taco/gits/tacogips/rielflow-packages` and confirm checksum stability
after a clean regeneration.

## Decisions

- The default registry migration targets
  `/Users/taco/gits/tacogips/rielflow-packages` and
  `https://github.com/tacogips/rielflow-packages`.
- Registry source package directories use `packages/<package-name>/` and
  checkout installs runtime bundles into scoped `.rielflow/workflows/`
  directories.
- Migrated package directories use `project-<workflow-id>` package names with a
  nested `<workflow-id>/` bundle directory.
- `project-design-and-implement-review-loop-feature-plan` is the initial
  migrated project example package for end-to-end package search, checkout,
  validation, and usage inspection.
- Package metadata is added through `rielflow-package.json`; workflow runtime
  JSON remains authoritative and should not be semantically rewritten during
  migration.
- Project-local `.rielflow/workflows` content remains available until registry
  checkout and package-command documentation are verified.
- `examples/` remains a direct fixture catalog and is not the canonical source
  for migrated default-registry packages.
- The feature accepts command syntax changes from sibling package-command slices
  as long as the verification still proves search, checkout, validation, usage,
  mock-run, provenance, and checksum stability.

## Open Questions

- What initial package version should be used if the project release version is
  not available at migration time?
- Should package manifests record a source commit from this repository in
  addition to the registry checksum for traceability?
- Should the default registry keep one package per workflow indefinitely, or
  later allow multi-workflow packages for closely related workflow sets?

## Risks

- Moving `.rielflow` content too early could break the implementation workflow
  that is currently running from project-local workflow bundles.
- Checksums that include generated or machine-local files would cause unstable
  package search and checkout verification.
- Package command syntax may change in the command slice; migration verification
  commands should be adjusted to the implemented CLI while preserving the same
  behavioral checks.
- The default registry lives outside this worktree, so implementation and review
  must inspect both repository status outputs to avoid losing registry-side
  changes.
