# Workflow Package Registry Migration

Design for moving project-local workflow bundles into the default workflow
package registry and adding a small verified example package.

## Overview

The workflow package feature introduces Git repository-backed registries. This
feature slice covers the migration and example-package portion of that work:

- migrate the current project `.rielflow/workflows/` catalog into the default
  registry repository at `/Users/taco/gits/tacogips/rielflow-packages`
- keep the default remote registry URL as
  `https://github.com/tacogips/rielflow-packages`
- add one example workflow package that demonstrates the registry metadata
  contract
- verify that the migrated and example packages can be checked out, validated,
  and smoke-run from a scoped install location

This document does not define the full registry command implementation. It
records the migration contract that implementation plans and package commands
must preserve.

## Goals

- preserve all current project workflow bundles as registry packages
- make migrated workflows searchable through authored package metadata
- retain workflow bundle portability: every registered workflow remains a
  directory containing `workflow.json`, `nodes/node-{id}.json`, and any
  workflow-local support files
- record package content checksums so changes can be detected without relying
  only on Git history
- make the default registry usable both from its local path and from its GitHub
  URL
- provide one minimal example package with documented checkout, validate, and
  run behavior

## Non-Goals

- changing workflow runtime semantics
- rewriting workflow prompts or step graphs during migration
- publishing non-workflow executable add-ons from registry packages
- designing every `rielflow package` command option; those belong in the command
  and registry architecture slices

## Source And Destination

Migration source:

- project workflows: `.rielflow/workflows/`
- project workflow index notes: `.rielflow/README.md`

Default registry destination:

- local registry root: `/Users/taco/gits/tacogips/rielflow-packages`
- default remote URL: `https://github.com/tacogips/rielflow-packages`

Recommended registry layout:

```text
rielflow-packages/
  packages/
    <package-id>/
      package.json
      workflows/
        <workflow-name>/
          workflow.json
          nodes/
            node-<id>.json
          prompts/
          scripts/
          EXPECTED_RESULTS.md
          mock-scenario.json
      README.md
  registry.json
```

`package.json` here is a rielflow package manifest, not an npm package manifest.
The filename is intentionally familiar but its schema is owned by rielflow.

## Package Identity

Each migrated workflow package must have stable metadata:

- `packageId`: globally unique within a registry; prefer the workflow name for
  one-workflow packages
- `name`: human-readable package name
- `description`: concise searchable summary
- `version`: package metadata version, initially `0.1.0` unless an existing
  workflow-specific version exists
- `workflows`: one or more workflow directory registrations
- `keywords`: terms used by search
- `source`: registry URL and optional source path
- `checksums`: deterministic content hashes for registered workflow files

The package manifest should avoid embedding large prompt bodies or duplicating
workflow JSON. It points at workflow directories and records metadata needed for
search, installation, and change detection.

## Checksum Contract

The migration must compute checksums over the registered workflow directory
contents. The requested behavior allows checksums such as md5; this slice accepts
md5 for initial compatibility, with room for stronger algorithms later.

Checksum rules:

- hash normalized file bytes for every file that is part of the workflow package
- include `workflow.json`, `nodes/`, prompt files, scripts, mock scenarios, and
  expected results documents
- exclude `.git/`, local runtime artifacts, temporary files, and dependency
  directories
- store per-file checksums and an aggregate package checksum
- use stable relative paths from the package root in checksum records

Checkout and search cache code can use the aggregate checksum to decide whether a
local cache entry is stale. Publish code can use the per-file checksums to show
what changed inside a package.

## Example Package

Add a minimal example package that is intentionally separate from the migrated
project workflows. The package should demonstrate:

- a short workflow description suitable for search results
- a small input/output contract if the workflow has a callable entrypoint
- `EXPECTED_RESULTS.md` with copyable verification commands
- `mock-scenario.json` when the workflow can be run deterministically without
  external credentials

The example should be simple enough to validate and smoke-run in CI-style local
verification. A good candidate is a worker-only workflow or a small
manager/worker workflow that uses mock-mode inputs and writes a structured
output.

## Checkout Verification

The migration is complete only when package install can prove the package works
from a fresh scoped install.

Required verification commands:

```bash
bun run packages/rielflow/src/bin.ts package search --registry https://github.com/tacogips/rielflow-packages --output json
bun run packages/rielflow/src/bin.ts package install <package-id> --registry https://github.com/tacogips/rielflow-packages --overwrite
bun run packages/rielflow/src/bin.ts workflow validate <workflow-name> --workflow-definition-dir ./.rielflow/workflows
bun run packages/rielflow/src/bin.ts workflow run <workflow-name> --workflow-definition-dir ./.rielflow/workflows --mock-scenario <path-to-mock-scenario>
```

Persistent package commands are top-level `package ...` commands; workflow
checkout remains direct-URL only.

## Documentation Updates

The migration must update repository-facing documentation:

- `README.md`: default registry URL, local registry path, checkout/search
  examples, package metadata expectations
- `examples/README.md`: distinction between local example bundles and registry
  packages
- `.rielflow/README.md`: note that project-local workflows are source material
  for the default registry and may be checked out from it after migration
- default registry package README files under
  `/Users/taco/gits/tacogips/rielflow-packages/packages/<package-id>/README.md`

Documentation must keep package commands explicit about scope. Checkout defaults
to project scope, while user-scope install remains opt-in.

## Risks

- The local default registry path may be absent or dirty on another developer's
  machine, so implementation must detect it and report actionable setup errors.
- Migrating project workflows can accidentally copy runtime artifacts unless the
  package file filter is strict.
- md5 is acceptable for change tracking but not a security boundary; future
  registry trust work should use stronger integrity checks.
- Search metadata quality depends on authored package summaries and keywords;
  poor migrated metadata will make registry search less useful.
- Smoke runs for codex-agent or claude-code-agent workflows may require mock
  scenarios to avoid live backend credentials.

## Open Questions

- Should migrated package versions start at `0.1.0`, `1.0.0`, or a registry-level
  migration version?
- Should the package manifest filename remain `package.json`, or should it use a
  rielflow-specific name such as `rielflow-package.json` to avoid npm ambiguity?
- Which migrated workflow should become the canonical example package if the
  new minimal example duplicates existing `examples/` coverage?
