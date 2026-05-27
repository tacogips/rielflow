# Workflow Package Registry Implementation Plan

**Status**: In Progress
**Design Reference**: design-docs/specs/design-workflow-package-registry.md#workflow-package-registry
**Created**: 2026-05-27
**Last Updated**: 2026-05-27

## Design Document Reference

**Source**: `design-docs/specs/design-workflow-package-registry.md`
**Workflow Mode**: issue-resolution
**Issue Reference**: workflowInput: Implement workflow package registry and package commands
**Feature ID**: registry-metadata-cache
**Fanout Feature IDs**: registry-metadata-cache

### Summary

Implement the registry metadata and cache foundation for workflow package
publish, checkout, and search. Registries are GitHub repositories. The default
registry is `https://github.com/tacogips/rielflow-packages`, with a local
development checkout at `/Users/taco/gits/tacogips/rielflow-packages`.
Personal registry configuration is stored under `~/.rielflow`, package
manifests are named `rielflow-package.json`, package changes are tracked with
deterministic md5 checksums, and search consumes normalized cache/index records.

### Scope

**Included**: registry config persistence, package manifest validation and
normalization, safe `workflowDirectory` handling, derived searchable `backends`,
checksum calculation, package index records, JSON cache backend, optional sqlite
cache adapter seam, search matching helpers, checkout provenance metadata
fields, and publish metadata hooks.

**Excluded**: final CLI command syntax, GitHub authentication, branch push
implementation, pull request creation, full remote checkout install mechanics,
and migration of repository contents into the external
`tacogips/rielflow-packages` repository. Those are owned by package command,
publish, checkout/search, and migration feature slices.

## Modules

### 1. Registry Config

#### `packages/rielflow/src/workflow/packages/registry-config.ts`

**Status**: Completed

```typescript
export interface WorkflowPackageRegistryEntry {
  readonly id: string;
  readonly url: string;
  readonly defaultBranch: string;
  readonly registeredAt: string;
  readonly updatedAt: string;
  readonly localPath?: string;
  readonly description?: string;
  readonly priority?: number;
}

export interface WorkflowPackageRegistryConfig {
  readonly registries: readonly WorkflowPackageRegistryEntry[];
  readonly defaultRegistryId: string;
}
```

**Checklist**:
- [x] Add default registry constants for URL, id, branch, local path, and config paths.
- [x] Load missing config as effective default config under `~/.rielflow/workflow-packages/registries.json`.
- [x] Validate registry ids as safe local identifiers and URLs as GitHub repository URLs.
- [x] Persist registry config with atomic JSON writes.
- [x] Unit test default config, user root override, invalid records, localPath preservation, and priority ordering.

### 2. Package Manifest

#### `packages/rielflow/src/workflow/packages/manifest.ts`

**Status**: Completed

```typescript
export interface WorkflowPackageManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly registry: string;
  readonly checksum: string;
  readonly checksumAlgorithm: "md5";
  readonly workflowDirectory?: string;
  readonly title?: string;
  readonly authors?: readonly string[];
  readonly license?: string;
  readonly homepage?: string;
  readonly repository?: string;
  readonly examples?: readonly string[];
  readonly minimumRielflowVersion?: string;
  readonly backends?: readonly string[];
}

export interface NormalizedWorkflowPackageManifest
  extends WorkflowPackageManifest {
  readonly workflowDirectory: string;
  readonly backends: readonly string[];
}
```

**Checklist**:
- [x] Parse and normalize `rielflow-package.json` with `workflowDirectory` defaulting to `"."`.
- [x] Reject unsafe relative paths, absolute paths, parent traversal, and missing `workflow.json`.
- [x] Validate optional authored `backends` as non-empty strings and reconcile with derived workflow node `executionBackend` values.
- [x] Keep package metadata separate from workflow runtime validation.
- [x] Unit test omitted workflowDirectory, nested workflowDirectory, unsafe paths, malformed tags, and stale authored backends.

### 3. Checksum Service

#### `packages/rielflow/src/workflow/packages/checksum.ts`

**Status**: Completed

```typescript
export type WorkflowPackageChecksumAlgorithm = "md5";

export interface WorkflowPackageChecksumInput {
  readonly packageRoot: string;
  readonly workflowDirectory: string;
  readonly algorithm?: WorkflowPackageChecksumAlgorithm;
}

export interface WorkflowPackageChecksumResult {
  readonly checksum: string;
  readonly checksumAlgorithm: WorkflowPackageChecksumAlgorithm;
  readonly includedFiles: readonly string[];
}
```

**Checklist**:
- [x] Compute md5 over deterministic package-local inputs.
- [x] Include normalized manifest content, `workflow.json`, `nodes/**`, `prompts/**`, and workflow-local files.
- [x] Omit `checksum` and `checksumAlgorithm` from normalized manifest content before hashing.
- [x] Exclude `.git/**`, runtime artifacts, local cache files, and checkout provenance.
- [x] Sort POSIX-normalized relative paths before hashing.
- [x] Unit test stable hashes across filesystem ordering, content changes, excluded files, and nested workflowDirectory packages.

### 4. Search Index And Cache

#### `packages/rielflow/src/workflow/packages/index.ts`
#### `packages/rielflow/src/workflow/packages/cache.ts`

**Status**: In Progress

```typescript
export interface WorkflowPackageIndexRecord {
  readonly registryId: string;
  readonly registryUrl: string;
  readonly packageName: string;
  readonly version: string;
  readonly title?: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly backends: readonly string[];
  readonly workflowId: string;
  readonly workflowDescription: string;
  readonly workflowDirectory: string;
  readonly sourceBranch: string;
  readonly sourcePath: string;
  readonly checksum: string;
  readonly checksumAlgorithm: "md5";
  readonly updatedAt: string;
}

export interface WorkflowPackageCacheBackend {
  readIndex(input: WorkflowPackageCacheKey): Promise<readonly WorkflowPackageIndexRecord[] | undefined>;
  writeIndex(input: WorkflowPackageCacheWrite): Promise<void>;
  clearRegistry(input: WorkflowPackageRegistryCacheSelector): Promise<void>;
}
```

**Checklist**:
- [x] Build index records from manifests, validated workflow bundle metadata, and derived workflow node backends.
- [x] Store JSON cache under `~/.rielflow/workflow-packages/cache/`.
- [x] Encode registry ids, registry URLs, branch names, and source paths before using them as cache path segments.
- [x] Key records by registry URL, branch, package source path, and checksum.
- [ ] Return invalid package refresh diagnostics with skipped package path and validation code.
- [x] Fail explicitly when sqlite is requested but unsupported, unless sqlite parity is implemented behind the shared interface.
- [x] Unit test cache miss, stale refresh overwrite, branch isolation, checksum keying, encoded path round trip, and JSON record round trip.

### 5. Search Matching

#### `packages/rielflow/src/workflow/packages/search.ts`

**Status**: Completed

```typescript
export interface WorkflowPackageSearchInput {
  readonly query?: string;
  readonly registryIds?: readonly string[];
  readonly tags?: readonly string[];
  readonly backends?: readonly string[];
  readonly branch?: string;
  readonly refresh?: boolean;
  readonly cacheBackend?: "json" | "sqlite";
}

export interface WorkflowPackageSearchResult {
  readonly records: readonly WorkflowPackageIndexRecord[];
  readonly diagnostics: readonly WorkflowPackageRefreshDiagnostic[];
  readonly cacheUsed: boolean;
  readonly refreshed: boolean;
}
```

**Checklist**:
- [x] Match package name, title, description, tags, backends, workflow id, and workflow description.
- [x] Support exact tag and backend filters after normalization.
- [x] Return enough source fields for automation agents to invoke checkout without a second discovery step.
- [x] Respect registry priority when multiple registries are enabled.
- [x] Preserve refresh diagnostics so invalid package records do not hide valid packages.
- [x] Unit test query matching, tag filtering, backend filtering, empty query behavior, registry filter behavior, and output source completeness.

### 6. Checkout And Publish Integration Metadata

#### `packages/rielflow/src/workflow/checkout/registry.ts`
#### `packages/rielflow/src/workflow/packages/publish-metadata.ts`

**Status**: In Progress

```typescript
export interface WorkflowPackageCheckoutProvenance {
  readonly registryUrl: string;
  readonly packageName: string;
  readonly version: string;
  readonly checksum: string;
  readonly checksumAlgorithm: "md5";
}

export interface WorkflowPackagePublishMetadataInput {
  readonly packageRoot: string;
  readonly registryUrl: string;
  readonly branch: string;
  readonly workflowDirectory?: string;
}
```

**Checklist**:
- [x] Extend checkout registry records with optional package provenance fields.
- [x] Provide package checksum verification helper that compares selected package metadata against staged package content before catalog mutation.
- [x] Provide publish metadata preparation that creates or normalizes manifests and recomputes checksums.
- [ ] Provide post-publish cache refresh hook input contracts.
- [x] Unit test backward-compatible checkout records, package provenance writing, checksum mismatch failure, and publish metadata normalization.

### 7. Public Exports And Documentation

#### `packages/rielflow/src/workflow/packages/index.ts`
#### `packages/rielflow/src/lib.ts`
#### `README.md`

**Status**: In Progress

```typescript
export interface WorkflowPackageRegistryFeatureSurface {
  readonly registries: WorkflowPackageRegistryConfig;
  readonly search: (input: WorkflowPackageSearchInput) => Promise<WorkflowPackageSearchResult>;
}
```

**Checklist**:
- [x] Export stable types/functions for command slices to consume.
- [x] Avoid exposing command-owned GitHub auth or PR behavior from the metadata layer.
- [x] Document registry defaults, manifest fields, backend metadata derivation, checksum caveat, cache location, and checkout scope defaults.
- [x] Add README examples for package metadata/search/checkout flow once command slices expose final commands.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Registry config | `packages/rielflow/src/workflow/packages/registry-config.ts` | COMPLETED | Focused package tests |
| Package manifest | `packages/rielflow/src/workflow/packages/manifest.ts` | COMPLETED | Focused package tests |
| Checksum service | `packages/rielflow/src/workflow/packages/checksum.ts` | COMPLETED | Focused package tests |
| Search index/cache | `packages/rielflow/src/workflow/packages/index.ts`, `packages/rielflow/src/workflow/packages/cache.ts` | IN_PROGRESS | Focused package tests |
| Search matching | `packages/rielflow/src/workflow/packages/search.ts` | COMPLETED | Focused package tests |
| Checkout/publish metadata | `packages/rielflow/src/workflow/packages/checkout.ts`, `packages/rielflow/src/workflow/packages/publish.ts` | IN_PROGRESS | Focused package tests |
| Public exports/docs | `packages/rielflow/src/workflow/packages/index.ts`, `README.md` | IN_PROGRESS | Typecheck and docs review |

## Task Breakdown

### TASK-001: Registry Config Persistence

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `packages/rielflow/src/workflow/packages/registry-config.ts`, `packages/rielflow/src/workflow/packages/registry-config.test.ts`
**Dependencies**: None

**Completion Criteria**:
- [x] Default registry config resolves to `https://github.com/tacogips/rielflow-packages`.
- [x] Personal registry config persists under `~/.rielflow/workflow-packages/registries.json`.
- [x] Registry id, URL, defaultBranch, localPath, and priority validation are covered by tests.

### TASK-002: Manifest Parser, Validator, And Backend Metadata

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `packages/rielflow/src/workflow/packages/manifest.ts`, `packages/rielflow/src/workflow/packages/manifest.test.ts`
**Dependencies**: None

**Completion Criteria**:
- [x] `workflowDirectory` is optional and normalizes to `"."` when omitted.
- [x] Unsafe workflowDirectory values are rejected.
- [x] Authored `backends` metadata is validated and reconciled with workflow node `executionBackend` values.
- [x] Package metadata validation does not bypass existing workflow validation.

### TASK-003: Deterministic Package Checksums

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/workflow/packages/checksum.ts`, `packages/rielflow/src/workflow/packages/checksum.test.ts`
**Dependencies**: TASK-002

**Completion Criteria**:
- [x] md5 checksum calculation is deterministic across directory ordering.
- [x] Included and excluded path rules match the accepted design, including checksum field omission before hashing.
- [x] Tests make clear md5 is a change-detection checksum, not a security guarantee.

### TASK-004: Package Index And JSON Cache Backend

**Status**: In Progress
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/workflow/packages/index.ts`, `packages/rielflow/src/workflow/packages/cache.ts`, related tests
**Dependencies**: TASK-001, TASK-002, TASK-003

**Completion Criteria**:
- [x] Index records include all design-required registry, package, workflow, backend, source, checksum, and timestamp fields.
- [x] JSON cache stores records under `~/.rielflow/workflow-packages/cache/`.
- [x] Cache keys include registry URL, branch, package source path, and checksum.
- [x] Cache filesystem paths use encoded segments and round-trip through cache metadata.
- [ ] Invalid package refresh diagnostics include skipped package path and validation code.

### TASK-005: Search API And Matching

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/workflow/packages/search.ts`, `packages/rielflow/src/workflow/packages/search.test.ts`
**Dependencies**: TASK-004

**Completion Criteria**:
- [x] Search matches package name, title, description, tags, backends, workflow id, and workflow description.
- [x] Search supports exact tag and backend filters.
- [x] Search results include checkout-ready source fields.
- [x] Registry priority and registry filters are deterministic.
- [x] Unsupported sqlite backend requests fail with a typed unsupported-backend result unless sqlite parity is implemented.

### TASK-006: Checkout Provenance And Publish Metadata Hooks

**Status**: In Progress
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/workflow/checkout/registry.ts`, `packages/rielflow/src/workflow/packages/publish-metadata.ts`, related tests
**Dependencies**: TASK-002, TASK-003, TASK-004

**Completion Criteria**:
- [x] Existing checkout registry records remain backward-compatible.
- [x] Package provenance fields are written when checkout receives package metadata.
- [x] Checksum verification compares selected package metadata against staged package content and fails before any project/user catalog mutation.
- [x] Publish metadata preparation can create/normalize manifests and recompute checksums without owning GitHub auth or PR behavior.

### TASK-007: Public Exports, Documentation, And Verification

**Status**: In Progress
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/workflow/packages/index.ts`, `packages/rielflow/src/lib.ts`, `README.md`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006

**Completion Criteria**:
- [x] Public exports are available for package command slices.
- [x] README documents registry defaults, config/cache paths, manifest fields, backend metadata, checksum caveat, and checkout scope defaults.
- [x] Focused tests, type checking, and diff checks pass.

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| TASK-001 Registry Config Persistence | Accepted design | COMPLETED |
| TASK-002 Manifest Parser, Validator, And Backend Metadata | Accepted design | COMPLETED |
| TASK-003 Deterministic Package Checksums | TASK-002 | COMPLETED |
| TASK-004 Package Index And JSON Cache Backend | TASK-001, TASK-002, TASK-003 | IN_PROGRESS |
| TASK-005 Search API And Matching | TASK-004 | COMPLETED |
| TASK-006 Checkout Provenance And Publish Metadata Hooks | TASK-002, TASK-003, TASK-004 | IN_PROGRESS |
| TASK-007 Public Exports, Documentation, And Verification | TASK-001 through TASK-006 | IN_PROGRESS |

## Parallelizable Tasks

- TASK-001 Registry Config Persistence
- TASK-002 Manifest Parser, Validator, And Backend Metadata

## Verification

Run these commands during implementation and before handoff:

```bash
git diff --check -- impl-plans/active/workflow-package-registry.md packages/rielflow/src/workflow packages/rielflow/src/lib.ts README.md
bun test packages/rielflow/src/workflow/packages/registry-config.test.ts
bun test packages/rielflow/src/workflow/packages/manifest.test.ts
bun test packages/rielflow/src/workflow/packages/checksum.test.ts
bun test packages/rielflow/src/workflow/packages/cache.test.ts
bun test packages/rielflow/src/workflow/packages/search.test.ts
bun test packages/rielflow/src/workflow/checkout/checkout.test.ts
bun test packages/rielflow/src/workflow/catalog.test.ts
bun test packages/rielflow/src/workflow/usage.test.ts
bun test packages/rielflow/src/workflow/runtime-db.test.ts
bun run packages/rielflow/src/bin.ts workflow validate <checked-out-workflow-name>
bun run packages/rielflow/src/bin.ts workflow usage <checked-out-workflow-name> --output json
bunx tsc --noEmit
```

## Completion Criteria

- [x] Registry config persistence under `~/.rielflow/workflow-packages/registries.json` is implemented and tested.
- [x] `rielflow-package.json` parsing, normalization, safe `workflowDirectory` handling, and backend metadata derivation are implemented and tested.
- [x] md5 checksum tracking is deterministic and documented as change detection only.
- [x] Search index records include all accepted design fields, including `backends`.
- [x] JSON cache backend works under `~/.rielflow/workflow-packages/cache/`.
- [x] Cache path encoding works for branch names such as `feature/workflow-packages`.
- [x] Optional sqlite cache support has a stable backend seam or is explicitly deferred without changing cache record contracts.
- [ ] Search refresh reports skipped invalid package records with path and validation code.
- [x] Search helpers return checkout-ready source metadata and support tag/backend filters.
- [x] Checkout provenance accepts package fields without breaking existing checkout records.
- [x] Checkout verifies selected package checksums against staged content before catalog mutation.
- [x] Publish metadata hooks create/normalize manifests and recompute checksums without owning GitHub auth/PR behavior.
- [x] README documents defaults, metadata, cache, checksum caveat, and scope behavior.
- [x] Focused tests, `git diff --check`, and `bunx tsc --noEmit` pass.

## Addressed Feedback

- Step 2 design update feedback is carried into TASK-002, TASK-004, and TASK-005: derived `backends` metadata is part of manifest normalization, index records, query matching, and exact backend filters.
- Step 3 low finding about integration boundaries is addressed by excluding command syntax, GitHub auth, branch push, PR creation, and final install mechanics from this metadata/cache plan.
- Step 3 feedback about registry config, manifest normalization, md5 checksums, normalized records, JSON/sqlite cache contracts, and helper APIs is mapped to TASK-001 through TASK-007.
- Known implementation findings are reflected in task criteria: encoded cache paths, checksum field omission, invalid-package diagnostics, explicit sqlite unsupported handling, and staged checkout checksum verification.

## Risks

- md5 satisfies the requested checksum style for change detection but must not be presented as a security integrity guarantee.
- Registry/search cache can become stale after branch force-pushes; explicit refresh and checkout checksum verification are required mitigations.
- Moving current-dir `.rielflow` content into the default registry can disrupt local workflow usage if project catalog behavior is not preserved by the migration slice.
- GitHub publish and PR behavior depends on token permissions and must report clear permission failures in the publish command slice.
- Optional sqlite support may add dependency and packaging complexity; the JSON backend must remain the baseline.

## Progress Log

### Session: 2026-05-27 Step 4 Implementation Plan Creation

**Tasks Completed**: Created feature-local implementation plan for featureId `registry-metadata-cache`.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Plan is based on accepted design review from `step3-design-review`, keeps scope limited to registry metadata/cache contracts, and leaves TASK-001 through TASK-007 pending for implementation routing.

### Session: 2026-05-27 14:08 JST Step 6 Implementation

**Tasks Completed**: Implemented registry config, manifest normalization with backend metadata, md5 checksum service, JSON/sqlite cache seam, encoded cache keys, package search records, and package checkout provenance fields.
**Tasks In Progress**: Invalid-package refresh diagnostics and publish metadata hook extraction remain for follow-up.
**Blockers**: Full repository Biome check is blocked by unrelated pre-existing formatting issues outside this feature slice and `packages/rielflow/src/workflow/validate/node-payload-validation.ts` exceeding 1000 lines.
**Notes**: Focused verification passed with `bun test packages/rielflow/src/workflow/packages/packages.test.ts`, `bun run typecheck`, and touched-file `bunx biome check --diagnostic-level=warn ...`. Step 6 self-review tightened authored backend validation and derived backend indexing from workflow node payloads.

### Session: 2026-05-27 15:12 JST Step 7 Feedback Revision

**Tasks Completed**: Reconciled stale registry implementation-plan progress after Step 7 review. Marked implemented registry config, manifest, checksum, search matching, cache safety, checkout provenance, public exports, README coverage, and focused verification as complete or in progress according to actual code state.
**Tasks In Progress**: Invalid-package refresh diagnostics, full sqlite parity, and a separated publish metadata helper remain explicit follow-up work rather than stale NOT_STARTED/BLOCKED entries.
**Blockers**: Full repository Biome remains blocked by unrelated pre-existing diagnostics.
**Notes**: This revision updates plan tracking only; no TypeScript behavior changed.

## Related Plans

- **Depends On**: `design-docs/specs/design-workflow-package-registry.md`
- **Related**: `design-docs/specs/design-workflow-package-checkout-search.md`
- **Related**: `design-docs/specs/design-workflow-package-publish.md`
- **Related**: `design-docs/specs/design-workflow-package-registry-migration.md`
