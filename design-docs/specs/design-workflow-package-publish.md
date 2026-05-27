# Workflow Package Publish

Design for publishing workflow package entries into Git-backed rielflow workflow
package registries.

## Overview

`rielflow publish` publishes one validated workflow name or directory path into
a GitHub registry repository. The default registry is
`https://github.com/tacogips/rielflow-packages`; the default local working copy
for that registry is `/Users/taco/gits/tacogips/rielflow-packages`. Users can
register additional personal registries under `~/.rielflow` and can publish to
any registry URL for which they have sufficient Git permissions.

The publish operation is intentionally repository-backed instead of service API
backed. It stages package files in a local clone or configured registry checkout,
updates searchable metadata and checksums, validates the resulting package, then
uses Git push or pull-request creation according to permissions and flags.

## Feature Contract

- Feature id: `package-publish-github`
- Feature title: GitHub Package Publish
- Issue reference: workflowInput: Implement workflow package registry and
  package commands
- Workflow mode: `issue-resolution`
- Fanout group: `feature-local-planning`
- Fanout branch: `1`
- Implementation plan target: `impl-plans/active/workflow-package-publish.md`
- Primary source touchpoints:
  - `packages/rielflow/src/cli.ts`
  - `packages/rielflow/src/cli/workflow-command-handler.ts`
  - `packages/rielflow/src/cli/workflow-package-command-handler.ts`
  - `packages/rielflow/src/workflow/packages/publish.ts`
  - `packages/rielflow/src/workflow/self-improve/git.ts`
- Related implementation touchpoints:
  - `packages/rielflow/src/workflow/packages/checksum.ts`
  - `packages/rielflow/src/workflow/packages/manifest.ts`
  - `packages/rielflow/src/workflow/packages/registry-config.ts`
  - `packages/rielflow/src/workflow/packages/search.ts`
  - `packages/rielflow/src/shared/fs.ts`

## Branch Inputs And Review State

This feature-local design is derived from the workflow call input for
`package-publish-github`. No upstream mailbox payloads or review feedback were
attached to this design step, so the document records the initial publish design
contract and does not address reviewer-requested revisions.

The design remains scoped to the declared feature document path:
`design-docs/specs/design-workflow-package-publish.md`. Adjacent package
registry, checkout/search, command, and migration documents are referenced as
integration contracts but are not modified by this branch.

## Goals

- Publish a workflow directory into a GitHub registry repository.
- Require push permission for direct publication.
- Support branch selection for registry updates.
- Support PR creation when the user has pull-request permission but direct push
  is not desired or not available.
- Validate workflow bundles before registry mutation.
- Track package changes with deterministic checksums, initially including md5.
- Store searchable workflow metadata alongside package contents.
- Reuse the existing `workflow checkout` validation model where possible.

## Non-Goals

- Publishing non-Git registry backends.
- Executing registry package lifecycle code during publish.
- Solving package dependency resolution for workflow add-ons.
- Replacing the existing `workflow checkout` command in the first publish
  implementation.

## Command Surface

Primary command:

```bash
rielflow publish <workflow-name-or-path> [options]
```

Recommended options:

- `--registry <registry-url>`: GitHub repository URL. Defaults to
  `https://github.com/tacogips/rielflow-packages`.
- `--registry-local-path <path>`: Existing or desired local checkout path.
  Defaults to `/Users/taco/gits/tacogips/rielflow-packages` for the default
  registry and otherwise to a registry cache path under `~/.rielflow`.
- `--branch <name>`: Registry branch to update. Defaults to the registry's
  current default branch.
- `--package-id <id>`: Explicit stable package id. Defaults to a safe id derived
  from package metadata or the workflow name.
- `--source-workflow-dir <path>`: Explicit workflow directory source when the
  positional value is a workflow name or when the caller wants to avoid catalog
  resolution.
- `--message <text>`: Commit message summary.
- `--create-pr`: Push to a publishing branch and create a pull request.
- `--pr-base <branch>`: Base branch for PR creation. Defaults to the registry
  default branch.
- `--dry-run`: Validate, compute metadata, and print the planned registry
  changes without committing or pushing.
- `--output json`: Emit structured publish result data.

The command must reject simultaneous direct publish and PR-only states that
cannot be satisfied. For example, if the user lacks push permission and does not
request or allow PR creation, publish fails before mutating the registry worktree.

Structured JSON output for successful publish should include:

- `registryUrl`
- `registryRef`
- `packageId`
- `packageName` as a compatibility alias when the nested package command path is
  used
- `workflowName`
- `workflowDirectory`
- `packageDirectory`
- `checksum`
- `checksumAlgorithm`
- `commitSha`
- `mode`: `direct` or `pull-request`
- `prUrl` when a PR is created
- `dryRun`

The top-level `rielflow publish` command is canonical for the accepted issue and
the package command design. The existing nested
`rielflow workflow package publish <workflow-directory> --package-name <name>`
path may remain as a compatibility route, but it must call the same publish
service contract and emit the same canonical JSON fields. The nested
`--package-name` option maps to canonical `packageId` unless implementation
keeps both names for backward-compatible output.

## Current Implementation Baseline

The repository already contains an initial nested package publish path in
`packages/rielflow/src/workflow/packages/publish.ts` and CLI dispatch in
`packages/rielflow/src/cli/workflow-package-command-handler.ts`. The
implementation plan should treat the following as existing baseline behavior:

- `workflow package publish <workflow-directory> --package-name <name>` exists.
- It loads the personal registry configuration from the workflow package config
  layer and requires the selected registry to have `localPath`.
- It validates the source workflow through `loadWorkflowFromDisk`.
- It writes `rielflow-package.json`, computes an md5 checksum through
  `computeWorkflowPackageChecksum`, commits package files, pushes to `origin`,
  and can attempt a PR through `gh pr create` after push failure when
  `--create-pr` is set.

The baseline is incomplete against this design. Required follow-up work includes
top-level `rielflow publish` routing, workflow name-or-path resolution, registry
URL and local-path option handling, `--package-id` support with nested
`--package-name` compatibility mapping, dry-run support, explicit permission
probing before worktree mutation, dirty registry rejection, direct branch
checkout/update behavior, deterministic PR branch naming with base selection,
registry index refresh compatibility, canonical structured output, and tests for
permission-failure modes.

## Registry Layout

Registry repositories store packages with a stable package id:

```text
packages/<package-id>/
  <workflow-directory>/
    workflow.json
    nodes/
    prompts/
    ...
  rielflow-package.json
registry/index.json
registry/checksums.json
```

`packages/<package-id>/<workflow-directory>/` contains the installable workflow
directory. The preferred normalized directory name is `workflow` for newly
published packages, but checkout and search must honor the manifest
`workflowDirectory` field because current packages may use the source workflow
directory name. `rielflow-package.json` contains package-level searchable
metadata and follows the registry metadata contract from
`design-docs/specs/design-workflow-package-registry.md`:

- `name`
- `workflowName`
- `title`
- `description`
- `tags`
- `summary`
- `version`
- `workflowDirectory`
- `source`
- `publishedAt`
- `registry`
- `checksum`
- `checksumAlgorithm`

`workflowDirectory` identifies the package-relative installable workflow
directory. Publish may accept existing source metadata, but the registry copy
must normalize and validate the manifest path before checksums are computed.

`registry/index.json` is the search index consumed by checkout/search/cache
features. It should duplicate only the metadata needed for fast search and
selection, not the complete workflow bundle.

`registry/checksums.json` maps package ids and package file paths to checksums.
The first implementation should support md5 because the issue requests it, but
the schema must include `algorithm` so a stronger digest can be added without a
registry layout break.

Publish owns writing the package manifest, package payload, registry index entry,
and checksum records for the package it publishes. Registry-wide cache refresh
and sqlite search acceleration remain owned by the registry/search features; a
successful publish may report that cache refresh is recommended, but it should
not require sqlite to be present.

## Publish Flow

1. Resolve the registry URL and local checkout path from CLI options, defaults,
   and personal registry configuration under `~/.rielflow`.
2. Ensure the local registry checkout exists and points to the requested remote.
   Clone if missing; otherwise fetch and verify the remote URL.
3. Resolve the source workflow directory from `--source-workflow-dir`, from a
   positional path, or by looking up the positional workflow name in the normal
   workflow catalog.
4. Validate the source workflow with the same strict loader path used by
   `workflow checkout` and `workflow validate`.
5. Derive package metadata from explicit package metadata, workflow description,
   workflow usage metadata, and CLI overrides.
6. Copy the workflow directory into a temporary staging location inside the
   registry worktree, excluding runtime artifacts and local-only files.
7. Write normalized `rielflow-package.json` metadata in the package root.
8. Compute file checksums and package aggregate checksum.
9. Update `packages/<package-id>/<workflowDirectory>/`,
   `packages/<package-id>/rielflow-package.json`, `registry/index.json`, and
   `registry/checksums.json` atomically where possible.
10. Run registry consistency validation against the staged registry state.
11. Commit the registry changes.
12. Publish the commit by direct push or by PR branch and PR creation.

Rollback should remove staged registry changes when validation or commit fails.
After a successful commit, rollback is no longer automatic because Git history is
the source of truth.

Dry run executes steps 1 through 10 and returns the exact package paths,
metadata fields, checksum values, permission-probe results, and intended Git
mode without committing, pushing, or creating a PR.

## Permission Model

Direct publish requires push permission to the target branch. The implementation
should test permission without relying on a destructive push:

- confirm the local remote is reachable;
- inspect configured credentials by attempting `git ls-remote`;
- for direct mode, attempt a dry-run push to the selected branch when supported;
- fail with a clear diagnostic before committing when permission is obviously
  missing.

PR mode requires permission to push a branch to a fork or to the registry
repository plus permission to create a GitHub pull request. The first
implementation may shell out to `gh pr create` when available, but this should
be isolated behind a PR adapter so a GitHub REST implementation can replace it.

Permission detection is advisory until the final push or PR API call succeeds.
The command must preserve clear failure modes:

- direct publish fails when the selected branch cannot be pushed;
- `--create-pr` fails when neither a publish branch push nor PR creation is
  available;
- dry run reports the intended mode and permission probes without creating a
  commit.

Direct push is the default when the user has push permission and `--create-pr`
is absent. `--create-pr` always selects PR mode, even when the user also has
direct push permission, so automation can force review-based publication.

## Git Behavior

The publish module should reuse the existing subprocess-hardening patterns from
`packages/rielflow/src/workflow/self-improve/git.ts`: invoke `git` with
argument arrays, explicit `cwd`, bounded output buffers, and no shell
interpolation.

Branch behavior:

- direct mode checks out or creates the target branch from the registry remote
  state, commits, and pushes to that branch;
- PR mode creates a deterministic branch name such as
  `rielflow/publish/<package-id>-<timestamp>`, commits there, pushes it, and
  opens a PR against `--pr-base`.

The command must refuse to run when the registry worktree has unrelated dirty or
staged changes unless an implementation plan explicitly introduces a safe
worktree isolation strategy.

Publish should use the existing registry checkout when a matching local path is
configured. If it clones into a cache path under `~/.rielflow`, that path belongs
to workflow package registry state and must not be confused with installed
workflow checkout records under `~/.rielflow/workflow-registry/checkouts/`.

## Search Metadata

Published packages must include enough metadata for
`rielflow workflow package search` to answer without loading every workflow
bundle:

- package id and workflow name;
- title and short summary;
- tags and feature categories;
- supported backend hints such as `codex-agent` or `claude-code-agent` when
  inferable from node payloads;
- input/output summary when available from workflow usage metadata;
- source URL and registry URL;
- checksum and published timestamp.

Metadata generation should prefer explicit package metadata when present, then
fall back to workflow `description`, `rielflowPromptTemplate`, node prompt
summaries, and usage discovery. Search ranking and sqlite cache behavior are
owned by the package-search feature, but publish must write a stable source
index for it.

## Integration With Checkout

`workflow checkout` already validates a public GitHub workflow directory in a
temporary staging directory before scoped installation. Publish should produce
registry URLs and metadata compatible with that installer. A package checkout
feature can later resolve package ids through `registry/index.json` and install
`packages/<package-id>/<workflowDirectory>/` using the same scoped destination
and provenance write behavior.

The published manifest and index must be sufficient for package checkout to
resolve these stable fields without loading every workflow bundle:

- registry URL and branch/ref;
- package id/name;
- workflow directory path;
- checksum and checksum algorithm;
- searchable package/workflow metadata.

The output package paths must preserve the registry layout expected by checkout:
`packages/<package-id>/<workflowDirectory>/` is the installable workflow
directory and `packages/<package-id>/rielflow-package.json` is the package
manifest used for search and provenance.

## Validation

Publish validation includes:

- source workflow exists and passes strict workflow loading;
- package id is safe for path use and registry lookup;
- package metadata is valid JSON and contains searchable fields;
- copied files do not escape the package directory;
- ignored runtime artifacts are not included;
- checksum index matches copied package files;
- registry index references only packages present in `packages/`.
- direct and PR publish modes have a satisfiable Git permission path before
  committing registry changes.

Validation failures should return CLI exit code `1` for runtime failures and
exit code `2` for invalid command usage, matching the package command contract.

## Verification Commands

The implementation plan should verify the publish slice with commands scoped to
the touched package:

```bash
bun test packages/rielflow/src/workflow
bun test packages/rielflow/src/cli
bun run tsc --noEmit
```

Feature tests should include dry-run publish, direct-push permission failure,
PR-mode adapter behavior, dirty-registry rejection, manifest/checksum generation,
and compatibility with package checkout/search metadata.

## Decisions

- GitHub repositories are the only publish registry backend for this feature
  slice.
- The default registry URL is `https://github.com/tacogips/rielflow-packages`.
- The default local registry checkout path is
  `/Users/taco/gits/tacogips/rielflow-packages`.
- Personal registry configuration is read from `~/.rielflow` through the
  registry metadata layer.
- The canonical publish command is top-level `rielflow publish`; nested
  `workflow package publish` remains only as a compatibility route if retained.
- Publish output standardizes on `packageId`, with `packageName` allowed only as
  a compatibility alias for existing nested package command callers.
- Direct publish requires push permission to the selected branch.
- PR publish uses a separate publish branch and a PR adapter, initially allowed
  to wrap `gh pr create`.
- Published package metadata uses `rielflow-package.json`, not npm
  `package.json`.
- Checksums initially support md5 for change tracking, with algorithm fields
  reserved for future stronger digests.

## Risks

- GitHub permission detection can vary by credential helper and hosting policy;
  dry-run push and PR creation failures must produce actionable errors.
- md5 is requested for change tracking but is weak as an integrity algorithm;
  schema versioning should make stronger hashes easy to add.
- Registry worktree mutation can conflict with user changes; publish should
  reject dirty worktrees initially.
- Metadata inferred from prompts may be low quality; explicit package metadata
  should override inference.

## Implementation References

- `design-docs/specs/design-workflow-package-registry.md`
- `design-docs/specs/design-workflow-package-checkout-search.md`
- `packages/rielflow/src/cli/workflow-command-handler.ts`
- `packages/rielflow/src/workflow/checkout/index.ts`
- `packages/rielflow/src/workflow/checkout/registry.ts`
- `packages/rielflow/src/workflow/self-improve/git.ts`
- `packages/rielflow/src/workflow/native-node-executor/git-and-addon-execution.ts`
- `README.md`
