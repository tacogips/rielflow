# Workflow Package Registry

Design for the feature-local registry metadata and cache contract behind
workflow package publish, checkout, and search commands.

## Overview

Rielflow workflow packages are workflow bundle directories registered through Git
repositories. A registry is a GitHub repository that contains package manifests
and workflow bundle paths. The default registry is
`https://github.com/tacogips/rielflow-packages`, with the local development
checkout expected at `/Users/taco/gits/tacogips/rielflow-packages`.

The registry feature extends the existing scoped workflow catalog:

- project scope remains `<project>/.rielflow/workflows`
- user scope remains `~/.rielflow/workflows`
- personal registry configuration is persisted under `~/.rielflow`
- checkout defaults to project scope and supports explicit user scope
- package search reads registry metadata, with an optional sqlite-backed cache

This document covers the `registry-metadata-cache` feature slice. Command
syntax, publish transport, checkout installation mechanics, and temporary
registry-backed workflow runs should consume these contracts rather than
redefining package identity, metadata, or cache semantics.

## Feature Contract

- Feature id: `registry-metadata-cache`
- Feature title: Registry Metadata And Cache
- Issue reference: workflowInput: Implement workflow package registry and
  package commands
- Workflow mode: `issue-resolution`
- Fanout group: `feature-local-planning`
- Fanout branch: `0`
- Design document path:
  `design-docs/specs/design-workflow-package-registry.md`
- Implementation plan target:
  `impl-plans/active/workflow-package-registry.md`
- Codex-agent references:
  - `AGENTS.md`
  - `packages/rielflow/src/workflow/catalog.ts`
  - `packages/rielflow/src/workflow/packages/`
  - `packages/rielflow/src/cli/workflow-package-command-handler.ts`
- Primary source touchpoints:
  - `packages/rielflow/src/workflow/catalog.ts`
  - `packages/rielflow/src/workflow/usage.ts`
  - `packages/rielflow/src/workflow/runtime-db.ts`
  - `packages/rielflow/src/workflow/packages/types.ts`
  - `packages/rielflow/src/workflow/packages/registry-config.ts`
  - `packages/rielflow/src/workflow/packages/manifest.ts`
  - `packages/rielflow/src/workflow/packages/checksum.ts`
  - `packages/rielflow/src/workflow/packages/cache.ts`
  - `packages/rielflow/src/workflow/packages/search.ts`
  - `README.md`

## Branch Inputs And Review State

This feature-local design is derived from the workflow call input for
`registry-metadata-cache` in workflow mode `issue-resolution`. No upstream
mailbox payloads or review feedback were attached to this design step, so this
update records the initial branch contract and implementation findings without
claiming reviewer-requested revisions.

The design remains scoped to the declared feature document path:
`design-docs/specs/design-workflow-package-registry.md`. Adjacent publish,
checkout/search, command, and migration documents are integration contracts for
their own feature ids and are not modified by this branch.

## Module Boundary

The registry metadata/cache slice should live under
`packages/rielflow/src/workflow/packages/` and expose small typed services that
command, publish, checkout, and migration slices can compose:

- registry config: load, validate, register, save, and resolve registry entries
- manifest: load and normalize `rielflow-package.json`
- checksum: compute deterministic package checksums
- cache: read, write, clear, and refresh package indexes
- search: build normalized package index records and filter them by metadata

The slice must not own CLI flag parsing, GitHub PR creation, or final checkout
mutation. Those callers should pass explicit inputs such as registry selector,
branch/ref, refresh behavior, cache backend, and scoped root options.

Public TypeScript surfaces should use existing `Result` conventions and typed
failure codes rather than throwing for validation failures. IO exceptions may be
converted to `WorkflowPackageFailure` values at module boundaries.

## Registry Model

A registry entry represents a GitHub repository that rielflow can use for
package discovery and publishing.

Required registry fields:

- `id`: stable local registry id, safe for filenames and CLI references
- `url`: canonical GitHub repository URL
- `defaultBranch`: branch used for search and checkout when no branch is
  specified
- `registeredAt`: ISO timestamp for the local registration
- `updatedAt`: ISO timestamp for the latest local metadata refresh

Optional registry fields:

- `localPath`: local checkout path for development or offline refresh
- `description`: human-readable registry note
- `priority`: search ordering hint when multiple registries are enabled

Personal registry configuration is stored under
`~/.rielflow/workflow-packages/registries.json`. This keeps registry state out of
project catalogs while allowing checkout records to remain in the existing
`~/.rielflow/workflow-registry/checkouts/` location for provenance.

The default registry should be present in effective configuration even when the
user has not written `registries.json`. User-registered entries override only by
matching `id` or canonical URL; they must not silently shadow the default under a
different id.

Registry config persistence should be atomic and should tolerate a missing
parent directory by creating `~/.rielflow/workflow-packages/`. Invalid JSON or
invalid registry records should fail closed with a typed validation error rather
than falling back to an empty registry list.

## Package Manifest

Each workflow package has a manifest named `rielflow-package.json` at the
package root inside the registry repository. `workflowDirectory` is optional: if
it is omitted, the package root is the workflow bundle root and must directly
contain `workflow.json`; if it is present, it must be a safe relative path from
the package root to the workflow bundle.

Required package manifest fields:

- `name`: package name and default checkout workflow name
- `version`: package metadata version; not a workflow execution model version
- `description`: searchable summary
- `tags`: searchable keywords
- `registry`: source registry URL at publish time
- `checksum`: content checksum for change detection
- `checksumAlgorithm`: initially `md5`

Recommended package metadata fields:

- `workflowDirectory`: relative path to the workflow bundle when the package
  root is not the workflow root; omitted means `.`
- `title`
- `authors`
- `license`
- `homepage`
- `repository`
- `examples`
- `minimumRielflowVersion`
- `backends`: searchable execution backend ids used by the workflow

The workflow bundle remains authoritative for runtime behavior. Package metadata
is discovery and provenance data; loading, validation, and execution continue to
use the existing workflow bundle validator.

Package identity is `(registryUrl, sourceBranch, sourcePath, name)`. `name`
alone is a display and default checkout name, so search results must preserve
the registry and path fields needed to disambiguate duplicate package names
across personal registries.

Manifest validation must reject unsafe relative paths, absolute paths, empty
names, non-array `tags`, unsupported checksum algorithms, and package roots that
resolve outside the registry checkout. Metadata fields used for search should be
normalized to strings and string arrays before indexing.

`backends` is optional in authored package manifests because it can be derived
from the workflow bundle. Index generation should inspect the validated
workflow nodes, collect each distinct node `executionBackend`, sort the values,
and write the normalized array into package index records. If an authored
manifest also contains `backends`, it must be an array of non-empty strings and
must be reconciled with the derived values during normalization so search and
checkout do not rely on stale manual metadata.

## Checksums

Registry change tracking uses a deterministic package checksum. The initial
algorithm is `md5` because the issue explicitly names md5-style checksums. The
checksum is an integrity and cache invalidation signal, not a security boundary.

Checksum input must include:

- normalized `rielflow-package.json` content with `checksum` and
  `checksumAlgorithm` omitted before hashing
- `workflow.json`
- `nodes/**`
- `prompts/**`
- other package-local files included by the workflow bundle

Checksum input must exclude:

- `.git/**`
- generated runtime artifacts
- local cache files
- checkout provenance files

File paths are normalized with POSIX separators and sorted before hashing so the
same package produces the same checksum across platforms.

The checksum written into `rielflow-package.json` is computed from the normalized
package payload before the checksum fields are added. Verification must repeat
the same normalization step. This avoids a self-referential manifest hash while
keeping the published manifest self-contained for search and provenance.

## Search Index

Search consumes normalized package index records. A package index record is the
flattened registry view of one `rielflow-package.json` plus selected workflow
bundle metadata.

Index fields:

- `registryId`
- `registryUrl`
- `packageName`
- `version`
- `title`
- `description`
- `tags`
- `backends`
- `workflowId`
- `workflowDescription`
- `workflowDirectory`
- `sourceBranch`
- `sourcePath`
- `checksum`
- `checksumAlgorithm`
- `updatedAt`

Search must match against package name, title, description, tags, backends,
workflow id, and workflow description. JSON output should include enough source
fields for an automation agent to select a package and call checkout without
another discovery round trip.

Registry-backed run uses the same normalized package index record as checkout.
The index record must preserve enough fields for a temporary run resolver to
fetch and validate the package without consulting a persistent checkout record:
`registryId`, `registryUrl`, `packageName`, `workflowId`, `workflowDirectory`,
`sourceBranch`, `sourcePath`, `checksum`, and `checksumAlgorithm`.

Temporary `workflow run --from-registry` also uses registry metadata to resolve
registered shorthand targets such as `<registry-owner>/<workflow-dir>`. The
resolver must derive the registry owner from each registered GitHub registry
URL, filter by optional `--registry`, and require exactly one package whose
`packageName`, `workflowId`, or terminal `sourcePath` segment matches
`<workflow-dir>`. Package-id lookup remains unchanged and exact package-name
matches keep the existing package resolution behavior. Ambiguous shorthand
matches must fail before content checkout begins.

Index generation should scan the registry working tree for
`rielflow-package.json`, load the referenced workflow bundle, validate it through
the existing workflow loader/validator path, and then emit only valid packages.
Invalid package records should be reported with package path and validation code
so `search --refresh` can explain skipped entries without making unrelated
packages unavailable.

## Cache Semantics

Registry and search cache data is stored under
`~/.rielflow/workflow-packages/cache/`.

The default cache backend is JSON files because it has no extra runtime
dependency and is easy to inspect. A sqlite backend is optional and may be used
when available for faster multi-registry search.

Suggested JSON cache layout:

- `registries/<encoded-registry-id>/<encoded-branch>/index.json`: normalized
  package index records for a branch
- `registries/<encoded-registry-id>/<encoded-branch>/meta.json`: registry URL,
  branch, refreshed timestamp, source revision when known, and cache schema
  version
- `packages/<checksum>.json`: optional package detail snapshot for checkout and
  provenance display

The sqlite cache, when enabled, is an acceleration layer over the same normalized
records and cache keys. It must be rebuildable from registry content or JSON
cache files and must not become the only durable source of registry metadata.

Cache backends share the same logical interface:

- `readIndex({ registryId, registryUrl, branch })`
- `writeIndex({ registryId, registryUrl, branch, records, refreshedAt,
  sourceRevision, schemaVersion })`
- `clearRegistry({ registryId, registryUrl })`

The JSON backend should persist metadata separately from records so stale-cache
decisions do not require trusting record payloads. A minimal first
implementation may collapse this into one file only if the same logical fields
are present and the path encoding rules below are still met.

Any value used as a cache path segment must be path-safe encoded rather than
written raw. This includes registry ids, registry URLs, branch names such as
`feature/workflow-packages`, and package source paths. Encoded names must round
trip to their original values through cache metadata, and cache lookup must use
the canonical unencoded values as the logical keys.

Cache records are keyed by:

- registry URL
- branch
- package source path
- checksum

Refresh behavior:

- `search` may use cache by default and should refresh when cache metadata is
  missing or stale
- explicit refresh bypasses stale cached index data and rewrites cache records
- checkout validates the selected package checksum against the fetched package
  before installation when the index supplied a checksum
- publish updates the registry package manifest and should refresh the local
  cache entry after a successful push or PR branch update

Cache staleness should be configurable through CLI flags in the command slice,
but the metadata layer should expose deterministic inputs: registry, branch,
stale-after duration, and backend selection.

Cache schema versions should be explicit. A cache reader that encounters an
unknown newer schema version should refresh rather than attempting partial reads.
Older supported schema versions may be migrated in place during refresh.

## Search Behavior

Search helpers should be deterministic and side-effect limited. Building an
index from a registry working tree may refresh cache records, but filtering an
already loaded record set must be pure.

Baseline matching:

- query text matches package name, title, description, tags, backends, workflow
  id, and workflow description
- tag filters are exact matches after normalization
- backend filters are exact matches against normalized `backends` values derived
  from workflow node `executionBackend` fields
- registry and branch filters are resolved before scanning or cache lookup
- result order is priority, package name, registry id, source branch, and source
  path unless the command slice later adds explicit ranking

The indexer should retain invalid package findings in refresh diagnostics while
returning valid packages. A single invalid manifest must not hide unrelated
packages from the same registry.

## Checkout Integration

Package checkout builds on the existing workflow checkout behavior in
`packages/rielflow/src/workflow/checkout/`.

Required integration points:

- default destination scope is project scope
- explicit user scope installs under `~/.rielflow/workflows`
- `--workflow-definition-dir` remains incompatible with checkout
- checkout provenance continues to write under
  `~/.rielflow/workflow-registry/checkouts/`
- provenance records should add package fields when available:
  `registryUrl`, `packageName`, `version`, `checksum`, and
  `checksumAlgorithm`

Package checkout must stage the remote package in a temporary directory, validate
the workflow bundle, verify checksum when available, and only then mutate the
project or user catalog.

## Temporary Run Integration

`workflow run --from-registry <target>` consumes registry metadata like checkout
when the target is a package id or registered shorthand, but produces no
persistent install. The registry layer should expose a resolver that returns the
same package selection fields used by checkout: package identity, registry
URL/id, branch/ref, source path, workflow directory, manifest path, checksum,
checksum algorithm, and derived workflow id. Direct GitHub directory URL targets
that are not backed by package metadata bypass package resolution and use the
GitHub directory checkout path with reduced provenance.

The temporary run caller owns lifecycle and cleanup. Registry metadata services
must remain side-effect limited to registry config reads, cache reads/refreshes
when requested, and package fetch/copy into caller-provided staging paths. They
must not write checkout records, project workflow catalogs, user workflow
catalogs, or vendor skill projections on behalf of a run.

Validation rules are identical to persistent checkout before execution:

- package id must resolve to exactly one package after registry and branch
  filters
- manifest paths and workflow directories must be safe relative paths
- workflow bundles must load and validate through the existing workflow
  validator
- checksum/integrity metadata must be verified when present
- invalid package records should fail the run before any workflow execution

Temporary run output and artifacts should retain package source provenance
because the temporary checkout path is removed after execution. Registry
metadata should therefore keep package identity stable across cache refreshes
and branch refs so later diagnostics can explain which registry package was
executed.

## Publish Integration

Publish writes package manifests into a GitHub registry repository. Push
permission is required for direct branch publication. When the user has PR
permission but cannot push to the target branch, publish may create or update a
branch and open a pull request.

The metadata layer must provide:

- manifest creation and normalization
- deterministic checksum generation
- local registry lookup by id or URL
- package path validation
- post-publish cache update hooks

Authentication, branch push, and PR creation belong to the publish command slice.

## Implementation Findings

The in-progress package implementation already introduces
`packages/rielflow/src/workflow/packages/` with registry config, manifest,
checksum, cache, search, checkout, and publish modules. The design decisions in
this document remain the source of truth for this slice. Review/implementation
should close these gaps before the feature is accepted:

- cache file paths must encode registry ids and branch names; raw
  `<registryId>-<branch>.json` filenames are unsafe for branch names such as
  `feature/workflow-packages`
- checksum computation must omit `checksum` and `checksumAlgorithm` from the
  manifest content before hashing, otherwise publish and verification become
  self-referential
- package search should report skipped invalid packages instead of silently
  dropping them during refresh
- optional sqlite support must be either implemented behind the shared cache
  interface or rejected with an explicit unsupported-backend failure; it should
  not silently use JSON behavior when `sqlite` is requested
- checkout should verify the selected package checksum against staged package
  content before mutating project or user workflow catalogs
- temporary registry-backed run should reuse the checkout resolver and checksum
  verification path while avoiding checkout provenance writes and package skill
  projection

## Migration

After implementation, current-dir `.rielflow` workflow content should be moved
into the default registry as package content. The migration must preserve
workflow bundle layout and add package manifests without changing runtime
workflow semantics.

The default registry should include at least one example workflow package, and
that package must be verified by search, checkout, validation, and run-oriented
usage inspection.

## Verification

Expected focused verification commands:

```bash
bun test packages/rielflow/src/workflow/catalog.test.ts
bun test packages/rielflow/src/workflow/usage.test.ts
bun test packages/rielflow/src/workflow/checkout/checkout.test.ts
bun test packages/rielflow/src/workflow/runtime-db.test.ts
bun test packages/rielflow/src/workflow/packages
bun run packages/rielflow/src/bin.ts workflow validate <checked-out-workflow-name>
bun run packages/rielflow/src/bin.ts workflow usage <checked-out-workflow-name> --output json
bun run packages/rielflow/src/bin.ts workflow run <package-id> --from-registry --mock-scenario <fixture> --output json
git diff --check
```

Additional implementation tests should cover registry config persistence, package
manifest validation, checksum stability, JSON cache refresh, sqlite cache parity
when enabled, search ranking/filtering, and package checkout provenance.

## Decisions

- GitHub repositories are the only registry type for this feature.
- The default registry URL is
  `https://github.com/tacogips/rielflow-packages`.
- Personal registries are persisted under `~/.rielflow`, not project scope.
- Checkout defaults to project scope and must require an explicit user-scope
  option for user catalog installation.
- `md5` is the initial checksum algorithm for registry change tracking.
- `workflowDirectory` is optional and defaults to the package root (`.`) when
  omitted.
- Package metadata is discovery/provenance data and must not bypass workflow
  bundle validation.
- Temporary registry-backed workflow runs use package metadata for source
  resolution and audit only; runtime behavior remains owned by the workflow
  bundle and existing `workflow run` engine path.
- JSON cache is the baseline backend; sqlite is optional and must preserve the
  same index record contract.
- The `packages/rielflow/src/workflow/packages/` module is the feature-local
  home for metadata, registry config, checksum, cache, and search behavior.
- Cache keys are logical registry/branch/package keys; filesystem paths are an
  encoded representation and must not be treated as canonical identity.

## Open Questions

- Exact package command names and flags are owned by the command design slice.
- GitHub authentication source and PR creation strategy are owned by the publish
  design slice.
- The final sqlite dependency choice should be made during implementation based
  on existing Bun/package constraints.

## Risks

- md5 checksums are suitable for change detection but not tamper-proof
  integrity; documentation and naming must avoid implying security guarantees.
- Registry cache can become stale when branches are force-pushed; explicit
  refresh and checksum verification reduce the blast radius.
- Moving current-dir `.rielflow` content into the registry can disrupt local
  workflows if migration does not preserve project catalog behavior.
- GitHub PR creation can vary by token permission; publish must report clear
  permission failures.
