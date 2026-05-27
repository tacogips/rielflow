# Workflow Package Checkout Install

Design for installing workflow packages resolved from Git-backed rielflow
package registries.

## Overview

The package checkout install feature extends the existing scoped workflow
checkout implementation so `rielflow` can install a package-selected workflow
bundle from a registry entry, not only from a direct GitHub directory URL.
Package registries are GitHub repositories, with
`https://github.com/tacogips/rielflow-packages` as the default public registry
and `/Users/taco/gits/tacogips/rielflow-packages` as the local development
checkout for that registry.

This feature owns the install path after a package has been selected by package
id, search result, or explicit registry filter. Registry configuration,
metadata indexing, publish behavior, and search ranking are defined in adjacent
package design documents and should feed this installer through stable package
resolution data.

## Feature Contract

- Feature id: `package-checkout-install`
- Feature title: Package Checkout Install
- Workflow mode: `issue-resolution`
- Issue reference: `workflowInput: Implement workflow package registry and
  package commands`
- Implementation plan target: `impl-plans/active/workflow-package-checkout.md`
- Design document path:
  `design-docs/specs/design-workflow-package-checkout.md`
- Primary source touchpoints:
  - `packages/rielflow/src/workflow/checkout/`
  - `packages/rielflow/src/workflow/checkout/registry.ts`
  - `packages/rielflow/src/workflow/checkout/types.ts`

## Goals

- Install workflow bundles selected from registry package metadata.
- Preserve the current direct GitHub directory checkout compatibility path.
- Default package checkout to project scope.
- Support explicit user scope installation under `~/.rielflow/workflows`.
- Validate package workflow bundles before mutating project or user scope.
- Verify package checksums, initially supporting `md5`.
- Write package provenance beside existing checkout records under
  `~/.rielflow/workflow-registry/checkouts/`.
- Keep installation deterministic by recording registry URL, branch/ref, source
  directory, package id, workflow name, and checksum.

## Non-Goals

- Implementing registry publish or PR creation.
- Owning search ranking or sqlite cache internals.
- Supporting non-GitHub registry backends.
- Installing workflow package dependencies or add-ons.
- Replacing direct URL checkout behavior.

## Command Behavior

The checkout command keeps the current direct URL form:

```bash
rielflow cli workflow checkout https://github.com/<owner>/<repo>/tree/<ref>/<workflow-dir>
```

Registry package checkout adds package targets:

```bash
rielflow cli workflow checkout <package-id> [--registry <registry-url-or-id>] [--branch <branch>] [--user-scope] [--overwrite] [--output json|text]
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
  `~/.rielflow/workflows`.
- `--workflow-definition-dir` remains unsupported because checkout writes to
  managed scope roots.
- `--endpoint` remains unsupported because package checkout is a local
  filesystem mutation.

## Package Resolution Input

The installer should receive a resolved package selection from the registry
metadata/search layer. Required fields:

- `packageId`
- `workflowName`
- `registryUrl`
- `registryRef`
- `sourceDirectory`
- `metadataPath`
- `checksum`
- `checksumAlgorithm`

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
   project scope by default, user scope only when explicitly requested.
5. Fail on an existing destination or checkout record unless `--overwrite` is
   set.
6. Fetch or copy the selected package workflow directory into a temporary
   staging root.
7. Validate the staged workflow bundle through the existing workflow loader.
8. Compute the staged package checksum and compare it with registry metadata
   when a checksum is present.
9. Move the validated staged workflow into the destination atomically where
   possible.
10. Write checkout provenance after the destination move, rolling back the
    destination when provenance writing fails.

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

## Provenance Record

Direct URL checkouts can keep the existing record shape. Package checkout
extends the record written to:

```text
~/.rielflow/workflow-registry/checkouts/<scope>-<workflow-name>.json
```

Additional package fields:

- `packageId`
- `registryUrl`
- `registryRef`
- `sourceDirectory`
- `metadataPath`
- `checksum`
- `checksumAlgorithm`
- `checkedOutAt`
- `destinationDirectory`

The record is stored under the user root even for project-scope installs so
users have one provenance catalog for all package checkouts.

## Output

Text output should include:

```text
checked out package: <package-id>
workflow: <workflow-name>
scope: project|user
destination: <path>
registry: <registry-url>
checksum: <algorithm>:<hex>
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
- duplicate checkout without `--overwrite`
- unsafe destination
- local I/O failure

Existing direct checkout errors should remain compatible where command behavior
has not changed.

## Decisions

- Keep package checkout under `rielflow cli workflow checkout` rather than
  adding a separate install command.
- Detect direct GitHub directory URLs first to preserve current behavior.
- Use project scope as the default install destination.
- Continue rejecting `--workflow-definition-dir` and `--endpoint` for checkout.
- Use the existing checkout staging, validation, backup, and provenance pattern
  for package installs.
- Store package checkout provenance under
  `~/.rielflow/workflow-registry/checkouts/`.
- Require checksum verification when package metadata provides a checksum.
- Keep sqlite optional; checkout must be testable through injected registry
  resolver/cache/fetch abstractions.

## Open Questions

- Whether package checkout should allow a checksumless package from a remote
  registry, or reserve checksumless installs only for local test fixtures.
- Whether the CLI flag should remain `--user-scope` for consistency or gain a
  more general `--scope project|user` alias.
- Whether checkout should support explicit package version selection in the
  first release or rely on registry branch/ref plus checksum.

## Risks

- Package ids and workflow names can diverge, so duplicate checks must use the
  destination workflow name while provenance also records package id.
- Stale registry cache can point to old checksums; outputs and records must
  include registry ref and checksum for diagnosis.
- Overwrite rollback must protect project/user workflow directories and the
  provenance record together.
- The default registry local path is machine-specific and must not become the
  canonical source URL in package records.
- md5 satisfies change tracking but is weak for security; the schema must keep
  `checksumAlgorithm` explicit.

## Verification Commands

```bash
bun test packages/rielflow/src/workflow/checkout/checkout.test.ts
bun test packages/rielflow/src/cli.test.ts
bun run tsc --noEmit
git diff --check
```

## References

- `design-docs/specs/design-workflow-package-registry.md`
- `design-docs/specs/design-workflow-package-checkout-search.md`
- `design-docs/specs/design-workflow-package-publish.md`
- `packages/rielflow/src/workflow/checkout/index.ts`
- `packages/rielflow/src/workflow/checkout/registry.ts`
- `packages/rielflow/src/workflow/checkout/types.ts`
