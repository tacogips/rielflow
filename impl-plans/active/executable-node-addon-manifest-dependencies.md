# Executable Node Add-on Manifest Dependencies Implementation Plan

**Status**: Ready
**Design Reference**:
`design-docs/specs/design-executable-node-addon-manifest-dependencies.md`
**Created**: 2026-06-03
**Last Updated**: 2026-06-03

## Design Reference

Implement the design-plan-only contract for executable node add-on package
metadata and workflow-to-add-on dependency linkage. The accepted design is
`design-docs/specs/design-executable-node-addon-manifest-dependencies.md`.

This plan covers manifest/schema changes, dependency checkout linkage,
validation, provenance records, and fixture/test coverage. It does not implement
the final runtime process launcher, interactive permission prompt UX, or package
publish command UX.

## Issue Resolution Scope

Issue reference: `workflowInput: Design executable node add-on package checkout`

Workflow mode: `design-plan-only`

Feature id: `executable-addon-manifest-dependencies`

Feature title: Executable Add-on Manifest And Workflow Dependency Linkage

Codex-agent references:

- `AGENTS.md`
- `design-docs/specs/design-workflow-node-package-install.md`
- `packages/rielflow/src/workflow/packages/manifest.ts`
- `packages/rielflow/src/workflow/packages/dependencies.ts`
- `packages/rielflow/src/workflow/packages/types.ts`
- `packages/rielflow/src/workflow/addon-package-boundary.ts`

## Scope

In scope:

- Extend `rielflow-package.json` types and normalization for executable
  add-on metadata.
- Extend local `addon.json` manifest loading for `execution` and
  `capabilities`.
- Extend workflow package `dependencies[]` entries with exact node-addon locks.
- Install node-addon dependencies before caller workflow validation.
- Link authored `workflow.json.nodes[].addon` references to dependency locks.
- Record executable add-on provenance, capability grants, and dependency graph
  edges in checkout records.
- Add package and workflow fixtures for the yt-dlp/transcriber-style dependency
  flow.

Out of scope:

- Implementing actual container or local command execution behavior.
- Implementing registry publish UX beyond type/search metadata needed for
  checkout validation.
- Prompting users for permission grants interactively.
- Supporting semver ranges for add-on dependency locks.

## Modules

### 1. Executable Add-on Manifest Types

#### `packages/rielflow/src/workflow/packages/types.ts`
#### `packages/rielflow/src/workflow/types.ts`
#### `packages/rielflow-addons/src/local-node-addons.ts`

**Status**: NOT_STARTED

```typescript
export type WorkflowPackageAddonExecutionKind =
  | "declarative"
  | "container"
  | "local-command";

export type WorkflowAddonCapabilityName =
  | "network.egress"
  | "filesystem.read"
  | "filesystem.write"
  | "process.spawn"
  | "container.build"
  | "container.run"
  | "device.gpu"
  | "env.read";

export interface WorkflowAddonCapability {
  readonly name: WorkflowAddonCapabilityName;
  readonly required?: boolean;
  readonly scope?: string;
  readonly reason?: string;
  readonly defaultPolicy?: "deny" | "prompt" | "allow";
}

export interface WorkflowPackageAddonExecutionDescriptor {
  readonly kind: WorkflowPackageAddonExecutionKind;
  readonly entrypoint?: string;
  readonly containerfilePath?: string;
  readonly runtimeHints?: readonly string[];
}

export interface WorkflowPackageManifestAddonEntry {
  readonly name: string;
  readonly version: string;
  readonly sourcePath: string;
  readonly execution?: WorkflowPackageAddonExecutionDescriptor;
  readonly capabilities?: readonly WorkflowAddonCapability[];
  readonly contentDigest?: string;
}
```

**Checklist**:

- [ ] Add shared executable add-on descriptor and capability types.
- [ ] Extend package add-on manifest entry types without breaking declarative
      node-addon packages.
- [ ] Extend `LocalNodeAddonManifest` with optional `execution` and
      `capabilities`.
- [ ] Ensure all new types are readonly and exported through existing package
      boundaries.

### 2. Manifest Normalization And Validation

#### `packages/rielflow/src/workflow/packages/manifest.ts`
#### `packages/rielflow/src/workflow/packages/node-addon-install.ts`
#### `packages/rielflow-addons/src/local-node-addons.ts`

**Status**: NOT_STARTED

```typescript
export function normalizeWorkflowAddonCapability(
  value: unknown,
  path: string,
): Result<WorkflowAddonCapability, WorkflowPackageFailure>;

export function normalizeWorkflowPackageAddonExecution(
  value: unknown,
  path: string,
): Result<WorkflowPackageAddonExecutionDescriptor, WorkflowPackageFailure>;

export function validateExecutableAddonManifestAgreement(input: {
  readonly packageEntry: WorkflowPackageManifestAddonEntry;
  readonly localManifest: LocalNodeAddonManifest;
}): Result<void, WorkflowPackageFailure>;
```

**Checklist**:

- [ ] Reject unknown `execution.kind` and unknown capability names.
- [ ] Reject unsafe `entrypoint` and `containerfilePath` values.
- [ ] Require `capabilities[]` for executable add-ons and keep it optional for
      declarative add-ons.
- [ ] Require sensitive capability `reason` values.
- [ ] Require package manifest and `addon.json` agreement on execution kind,
      capabilities, and authored content digest.
- [ ] Require executable add-on packages to provide sha256 `integrity`.
- [ ] Keep existing rejection of `rielflow/*` package-provided add-ons.

### 3. Dependency Lock Types And Normalization

#### `packages/rielflow/src/workflow/packages/types.ts`
#### `packages/rielflow/src/workflow/packages/manifest.ts`

**Status**: NOT_STARTED

```typescript
export interface WorkflowPackageAddonCapabilityGrant {
  readonly allowed: boolean;
  readonly scope?: string;
}

export interface WorkflowPackageManifestAddonDependencyLock {
  readonly name: string;
  readonly version: string;
  readonly contentDigest: string;
  readonly capabilityGrant: Readonly<
    Partial<Record<WorkflowAddonCapabilityName, WorkflowPackageAddonCapabilityGrant>>
  >;
  readonly optional?: boolean;
}

export interface WorkflowPackageManifestDependencyEntry {
  readonly packageId: string;
  readonly registry?: string;
  readonly branch?: string;
  readonly kind?: WorkflowPackageKind;
  readonly addons?: readonly WorkflowPackageManifestAddonDependencyLock[];
}
```

**Checklist**:

- [ ] Preserve string dependency compatibility.
- [ ] Normalize `kind: "workflow" | "node-addon"` on object dependencies.
- [ ] Require non-empty `addons[]` when dependency kind is `node-addon`.
- [ ] Require `sha256:<hex>` content digest locks for executable add-ons.
- [ ] Reject grants for unknown capabilities.
- [ ] Reject package self-dependencies and dependency cycles with package kind
      included in identity checks.

### 4. Dependency Checkout And Rollback

#### `packages/rielflow/src/workflow/packages/dependencies.ts`
#### `packages/rielflow/src/workflow/packages/checkout.ts`
#### `packages/rielflow/src/workflow/packages/checkout-node-addon.ts`

**Status**: NOT_STARTED

```typescript
export interface WorkflowPackageAddonDependencyInstallResult {
  readonly packageId: string;
  readonly packageKind: "node-addon";
  readonly registryUrl: string;
  readonly registryRef: string;
  readonly installId: string;
  readonly addons: readonly WorkflowPackageManifestAddonDependencyLock[];
  readonly checkoutRecordPath: string;
}

export interface WorkflowPackageDependencyEdge {
  readonly from: WorkflowPackageDependencyIdentity;
  readonly to: WorkflowPackageDependencyIdentity;
  readonly packageKind: WorkflowPackageKind;
}
```

**Checklist**:

- [ ] Allow workflow packages to install declared node-addon dependencies.
- [ ] Allow node-addon packages to depend on other node-addon packages only
      when exact add-on locks are present.
- [ ] Reuse existing dependency installation rollback on caller validation
      failure.
- [ ] Keep node-addon package dependency install deterministic and offline after
      registry checkout.
- [ ] Fail checkout when installed add-on digests differ from dependency locks.

### 5. Workflow Validation Linkage

#### `packages/rielflow/src/workflow/load.ts`
#### `packages/rielflow/src/workflow/validate.ts`
#### `packages/rielflow/src/workflow/addon-source-summary.ts`
#### `packages/rielflow/src/workflow/packages/install-validation.ts`

**Status**: NOT_STARTED

```typescript
export interface WorkflowAddonDependencyLockSummary {
  readonly nodeId: string;
  readonly addonName: string;
  readonly addonVersion: string;
  readonly packageId: string;
  readonly installId: string;
  readonly contentDigest: string;
  readonly capabilities: readonly WorkflowAddonCapability[];
  readonly grantedCapabilities: Readonly<Record<string, WorkflowPackageAddonCapabilityGrant>>;
}

export interface ExecutableAddonValidationOptions {
  readonly allowUnpackagedExecutableAddons?: boolean;
  readonly addonDependencyLocks?: readonly WorkflowPackageManifestAddonDependencyLock[];
}
```

**Checklist**:

- [ ] Mark direct-root executable add-ons as `unpackagedExecutableAddon`.
- [ ] Reject unpackaged executable add-ons during package validation unless an
      explicit development/test option allows them.
- [ ] Match workflow node add-on references to installed package provenance by
      name, version, and content digest.
- [ ] Require capability grants to cover every required add-on capability.
- [ ] Include dependency lock summaries in validation and inspect JSON output.

### 6. Checkout Records, Status, And Search Metadata

#### `packages/rielflow/src/workflow/packages/types.ts`
#### `packages/rielflow/src/workflow/packages/checkout-records.ts`
#### `packages/rielflow/src/workflow/packages/status.ts`
#### `packages/rielflow/src/workflow/packages/search.ts`

**Status**: NOT_STARTED

```typescript
export interface WorkflowPackageExecutableAddonRecord {
  readonly addonName: string;
  readonly addonVersion: string;
  readonly executionKind: WorkflowPackageAddonExecutionKind;
  readonly capabilities: readonly WorkflowAddonCapability[];
  readonly contentDigest: string;
  readonly contentDigestAlgorithm: "sha256";
  readonly permissionGrant?: Readonly<Record<string, WorkflowPackageAddonCapabilityGrant>>;
}
```

**Checklist**:

- [ ] Add execution kind and capability metadata to node-addon checkout records.
- [ ] Add `addonDependencyLocks[]` to workflow package checkout records.
- [ ] Add `packageKind` to dependency graph output where not already present.
- [ ] Index execution kind, runtime hints, and capability names in package
      search records.
- [ ] Preserve existing list/remove behavior for declarative node-addon
      packages.

### 7. Fixtures And Tests

#### `packages/rielflow/src/workflow/packages/packages.test.ts`
#### `packages/rielflow/src/workflow/authored-workflow.test.ts`
#### `packages/rielflow/src/cli.test.ts`
#### `../rielflow-fixture/packages/*`
#### `../rielflow-packages/packages/*`

**Status**: NOT_STARTED

```typescript
interface ExecutableAddonFixtureCase {
  readonly packageId: string;
  readonly addonName: string;
  readonly addonVersion: string;
  readonly executionKind: WorkflowPackageAddonExecutionKind;
  readonly expectedCapabilities: readonly WorkflowAddonCapabilityName[];
  readonly expectedDigest: string;
}
```

**Checklist**:

- [ ] Add a passing workflow package fixture using a yt-dlp-style download
      add-on and local transcriber add-on.
- [ ] Add rejection fixtures for missing grants, changed digest, unsafe
      entrypoint, missing integrity, and unrequested capability grant.
- [ ] Add package normalization tests for executable descriptors and dependency
      locks.
- [ ] Add checkout tests for dependency install order, rollback, and provenance.
- [ ] Add validation tests linking `workflow.json.nodes[].addon` to dependency
      locks.
- [ ] Add CLI JSON smoke tests for package install/list/validate surfaces.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Executable manifest types | `packages/rielflow/src/workflow/packages/types.ts` | NOT_STARTED | Unit |
| Local add-on manifest extension | `packages/rielflow-addons/src/local-node-addons.ts` | NOT_STARTED | Unit |
| Manifest normalization | `packages/rielflow/src/workflow/packages/manifest.ts` | NOT_STARTED | Unit |
| Node-addon artifact validation | `packages/rielflow/src/workflow/packages/node-addon-install.ts` | NOT_STARTED | Unit |
| Dependency checkout | `packages/rielflow/src/workflow/packages/dependencies.ts` | NOT_STARTED | Integration |
| Workflow validation linkage | `packages/rielflow/src/workflow/validate.ts` | NOT_STARTED | Integration |
| Checkout/search/status metadata | `packages/rielflow/src/workflow/packages/*.ts` | NOT_STARTED | Unit/CLI |
| Fixtures | `rielflow-fixture/packages/*` | NOT_STARTED | Integration |

## Dependencies

| Feature | Depends On | Status |
| --- | --- | --- |
| Manifest validation | Executable manifest types | BLOCKED |
| Dependency lock normalization | Executable manifest types | BLOCKED |
| Dependency checkout | Manifest validation, dependency lock normalization | BLOCKED |
| Workflow validation linkage | Dependency checkout records | BLOCKED |
| Search/status metadata | Manifest validation, checkout records | BLOCKED |
| Fixtures and CLI smoke | All implementation modules | BLOCKED |

## Completion Criteria

- [ ] Executable add-on metadata is normalized from package manifests and
      `addon.json`.
- [ ] Workflow package dependency locks support exact node-addon identities,
      digests, and capability grants.
- [ ] Package checkout installs node-addon dependencies before validating caller
      workflows.
- [ ] Workflow validation rejects executable add-ons that lack matching
      dependency locks or required grants.
- [ ] Checkout records expose execution kind, capabilities, digests, grants, and
      dependency graph edges.
- [ ] Passing and rejecting fixtures cover yt-dlp/transcriber-style workflows.
- [ ] Focused unit, integration, CLI, typecheck, and diff verification commands
      pass.

## Verification

Run after implementation:

```bash
bun test packages/rielflow/src/workflow/packages/packages.test.ts
bun test packages/rielflow/src/workflow/addon-package-boundary.test.ts
bun test packages/rielflow/src/workflow/authored-workflow.test.ts
bun test packages/rielflow/src/cli.test.ts
bun run packages/rielflow/src/bin.ts package install media/download-and-transcribe --output json
bun run packages/rielflow/src/bin.ts workflow validate media/download-and-transcribe --output json
bun run tsc --noEmit
git diff --check
```

Design-plan-only verification for this worker:

```bash
test -f design-docs/specs/design-executable-node-addon-manifest-dependencies.md
test -f impl-plans/active/executable-node-addon-manifest-dependencies.md
git diff --check -- design-docs/specs/design-executable-node-addon-manifest-dependencies.md impl-plans/active/executable-node-addon-manifest-dependencies.md
```

## Review Decisions

Implementation plan self-review decision: accepted. The plan is consistent with
the accepted design, separates design-only and implementation scope, lists
deliverables, includes TypeScript interface targets, tracks dependencies, and
defines verification.

Independent implementation plan review decision: accepted after addressing one
medium plan-only finding: the first pass did not explicitly cover direct-root
development add-ons in validation. Module 5 now includes
`allowUnpackagedExecutableAddons` and rejection of unpackaged executable add-ons
during package validation.

## Progress Log

### Session: 2026-06-03 15:00

**Tasks Completed**: Created design document and implementation plan for
feature-local planning branch.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: No TypeScript code was implemented because workflow mode is
`design-plan-only`.
