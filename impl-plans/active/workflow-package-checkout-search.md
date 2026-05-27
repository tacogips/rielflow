# Workflow Package Checkout And Search Implementation Plan

**Status**: In Progress
**Design Reference**: `design-docs/specs/design-workflow-package-checkout-search.md`
**Created**: 2026-05-27
**Last Updated**: 2026-05-27

## Design Reference

Implement feature-local checkout and search behavior for
`package-checkout-search`.

This plan covers registry-aware package id checkout, package metadata search,
project/user scope installation, checksum/provenance output, direct GitHub URL
checkout compatibility, CLI rendering, and the issue-resolution update for
optional checkout-time pre-install security checks.

This plan does not implement registry configuration ownership, package publish
or PR creation, migration of current `.rielflow` content into the default
registry, sqlite as a required cache backend, registry policy defaults for
pre-install checks, workflow-node execution during scanning, or any weakening
of existing md5 compatibility, sha256 integrity, or Ed25519 signature gates.

## Issue Resolution Scope

Issue title: Add optional sandbox pre-install checks for workflow package
checkout.

The accepted design adds opt-in package checkout scanning before project/user
destination writes and before checkout provenance/registry mutation. The first
implementation must preserve current package registry, metadata, md5/sha256
integrity, and signature behavior. It must run integrity and workflow bundle
validation before content-risk scanning, then run the static scanner and
optional Docker/Podman no-network inspection over the staged package only.

## Codex Agent References

- `AGENTS.md`
- `design-docs/specs/design-workflow-package-checkout-search.md`
- `packages/rielflow/src/cli.ts`
- `packages/rielflow/src/cli/argument-parser.ts`
- `packages/rielflow/src/cli/input-output-helpers.ts`
- `packages/rielflow/src/cli/workflow-command-handler.ts`
- `packages/rielflow/src/cli/workflow-package-command-handler.ts`
- `packages/rielflow/src/workflow/checkout/`
- `packages/rielflow/src/workflow/packages/cache.ts`
- `packages/rielflow/src/workflow/packages/checkout.ts`
- `packages/rielflow/src/workflow/packages/pre-install-check.ts`
- `packages/rielflow/src/workflow/packages/pre-install-scanner.ts`
- `packages/rielflow/src/workflow/packages/pre-install-container.ts`
- `packages/rielflow/src/workflow/packages/search.ts`
- `packages/rielflow/src/workflow/packages/types.ts`
- `packages/rielflow/src/workflow/load.ts`
- `packages/rielflow/src/workflow/validate/`
- `design-docs/specs/design-workflow-package-integrity.md`
- `design-docs/specs/command.md`

## Modules

### 1. Package Public Types

#### `packages/rielflow/src/workflow/packages/types.ts`

**Status**: Completed

```typescript
export interface WorkflowPackageSearchRecord {
  readonly packageId: string;
  readonly workflowName: string;
  readonly title?: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly backends: readonly string[];
  readonly registryUrl: string;
  readonly registryRef: string;
  readonly workflowDirectory: string;
  readonly metadataPath: string;
  readonly checksum: string;
  readonly updatedAt: string;
}

export interface WorkflowPackageSearchCliResult {
  readonly query?: string;
  readonly registryFilters: readonly string[];
  readonly packages: readonly WorkflowPackageSearchRecord[];
  readonly cache: {
    readonly backend: WorkflowPackageCacheBackendKind;
    readonly used: boolean;
    readonly refreshed: boolean;
  };
}

export interface WorkflowPackageCheckoutCliResult {
  readonly packageId: string;
  readonly workflowName: string;
  readonly scope: WorkflowCheckoutScope;
  readonly destinationDirectory: string;
  readonly registryUrl: string;
  readonly registryRef: string;
  readonly sourceDirectory: string;
  readonly checksum: string;
  readonly metadataPath: string;
  readonly checkoutRecordPath: string;
}
```

**Checklist**:

- [x] Add `packageId`-first public CLI result types.
- [x] Keep `packageName` only as internal index compatibility where needed.
- [x] Include `registryUrl`, `registryRef`, `sourceDirectory`,
      `metadataPath`, and checksum fields needed by checkout JSON.
- [x] Keep failure codes aligned with existing package service errors.

### 2. Cache Key Safety

#### `packages/rielflow/src/workflow/packages/cache.ts`

**Status**: Completed

```typescript
export interface WorkflowPackageCacheKey {
  readonly registryId: string;
  readonly registryUrl?: string;
  readonly branch: string;
  readonly sourcePath?: string;
}

export function encodeWorkflowPackageCacheSegment(value: string): string;
```

**Checklist**:

- [x] Encode registry ids, registry URLs, branch names, and source paths before
      creating cache file paths.
- [x] Preserve logical registry/ref/source values inside cached records.
- [x] Ensure branch names such as `feature/workflow-packages` cannot create
      nested or escaping paths.
- [x] Add unit tests for cache segment round-trip and unsafe path rejection.

### 3. Package Search Service

#### `packages/rielflow/src/workflow/packages/search.ts`

**Status**: Completed

```typescript
export interface WorkflowPackageSearchInput {
  readonly query?: string;
  readonly registry?: string;
  readonly tags?: readonly string[];
  readonly backend?: string;
  readonly branch?: string;
  readonly limit?: number;
  readonly refresh?: boolean;
  readonly cacheBackend?: WorkflowPackageCacheBackendKind;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}

export interface WorkflowPackageSearchResult {
  readonly query?: string;
  readonly registryFilters: readonly string[];
  readonly packages: readonly WorkflowPackageSearchRecord[];
  readonly cache: {
    readonly backend: WorkflowPackageCacheBackendKind;
    readonly used: boolean;
    readonly refreshed: boolean;
  };
}
```

**Checklist**:

- [x] Normalize manifest `name`, index `packageName`, and command `packageId`
      into one stable public identity.
- [x] Index metadata fields required by the design: title, description, tags,
      backends, registry URL/ref, workflow directory, metadata path, checksum,
      and updated timestamp.
- [x] Apply query, registry, tag, backend, and limit filters before rendering.
- [x] Use cache on normal search and force refresh on `--refresh` or
      `--no-cache`.
- [x] Return JSON shape with `query`, `registryFilters`, `packages`, and
      `cache`.

### 4. Package Checkout Service

#### `packages/rielflow/src/workflow/packages/checkout.ts`

**Status**: In Progress

```typescript
export interface WorkflowPackageCheckoutInput {
  readonly packageId: string;
  readonly registry?: string;
  readonly branch?: string;
  readonly userScope?: boolean;
  readonly overwrite?: boolean;
  readonly options?: WorkflowPackageRegistryConfigOptions;
}

export interface WorkflowPackageCheckoutResult {
  readonly packageId: string;
  readonly workflowName: string;
  readonly scope: WorkflowCheckoutScope;
  readonly destinationDirectory: string;
  readonly registryUrl: string;
  readonly registryRef: string;
  readonly sourceDirectory: string;
  readonly checksum: string;
  readonly metadataPath: string;
  readonly checkoutRecordPath: string;
}
```

**Checklist**:

- [x] Resolve exact package id matches through selected registry metadata.
- [x] Support exact workflow-name fallback only when one package matches.
- [x] Return usage errors with candidate package ids for missing or ambiguous
      matches.
- [x] Validate the workflow bundle before writing destination files.
- [x] Default to project scope and support `--user-scope`.
- [x] Preserve overwrite semantics consistent with direct GitHub checkout.
- [x] Write checkout record package fields under
      `~/.rielflow/workflow-registry/checkouts/<scope>-<workflow-name>.json`.
- [x] Write local installed workflow provenance when checkout succeeds.

### 5. Direct Checkout Compatibility

#### `packages/rielflow/src/workflow/checkout/`

**Status**: Completed

```typescript
export function parseGitHubDirectoryUrl(
  sourceUrl: string,
): Result<ParsedGitHubDirectoryUrl, WorkflowCheckoutFailure>;
```

**Checklist**:

- [x] Keep HTTPS GitHub directory URLs on the existing direct checkout path.
- [x] Reuse destination and registry-record helpers from direct checkout in
      package checkout where possible.
- [x] Ensure direct checkout record shape remains backward compatible.
- [x] Add regression coverage showing direct URL checkout still works after
      package checkout/search changes.

### 6. CLI Command Wiring

#### `packages/rielflow/src/cli/argument-parser.ts`
#### `packages/rielflow/src/cli/input-output-helpers.ts`
#### `packages/rielflow/src/cli/workflow-command-handler.ts`
#### `packages/rielflow/src/cli/workflow-package-command-handler.ts`

**Status**: In Progress

```typescript
type WorkflowSearchOutput = "table" | "json" | "text";

async function runCliWorkflowScope(
  context: RunCliScopeContext,
): Promise<number>;
```

**Checklist**:

- [x] Accept `rielflow cli workflow checkout <package-id>` when the target is
      not a GitHub directory URL.
- [x] Keep `rielflow cli workflow checkout <github-url>` compatible.
- [x] Add `rielflow cli workflow search [query]` with `--registry`, `--tag`,
      `--backend`, `--limit`, `--refresh`, and `--output table|json|text`.
- [x] Keep package subcommands compatible where sibling fanout features already
      use `workflow package ...`.
- [x] Verify canonical `workflow search` and
      `workflow checkout <package-id>` aliases delegate to the same resolver and
      renderer as `workflow package search` and `workflow package checkout`.
- [x] Reject `--endpoint` and `--workflow-definition-dir` for package checkout.
- [x] Emit checkout text lines for package id, workflow, scope, destination,
      registry, and checksum.
- [x] Emit search table columns `PACKAGE`, `WORKFLOW`, `REGISTRY`, `TAGS`,
      `SUMMARY`.
- [x] Update output option validation so `--output table` is accepted for
      search without widening unrelated commands.

### 7. Tests

#### `packages/rielflow/src/workflow/packages/packages.test.ts`
#### `packages/rielflow/src/workflow/checkout/checkout.test.ts`
#### `packages/rielflow/src/cli.test.ts`

**Status**: In Progress

```typescript
describe("workflow package checkout and search", () => {
  test("search returns packageId metadata and cache status", async () => {});
  test("checkout installs package id into project scope by default", async () => {});
  test("checkout rejects ambiguous workflow-name fallback", async () => {});
});
```

**Checklist**:

- [x] Cover search query, tag, backend, registry, limit, refresh, and cache use.
- [x] Cover package checkout project scope, user scope, overwrite, provenance,
      checkout record, checksum, and validation failure.
- [x] Cover direct GitHub URL checkout compatibility.
- [x] Cover CLI JSON and text/table output fields.
- [x] Cover unsafe package id and unsafe cache segment handling.

### 8. Pre-Install Check Types And Result Contract

#### `packages/rielflow/src/workflow/packages/types.ts`

**Status**: Completed

```typescript
export type WorkflowPackagePreInstallCheckMode = "warn" | "reject";
export type WorkflowPackagePreInstallCheckStatus =
  | "passed"
  | "warned"
  | "failed"
  | "skipped";
export type WorkflowPackagePreInstallFindingSeverity =
  | "info"
  | "low"
  | "medium"
  | "high"
  | "critical";

export interface WorkflowPackagePreInstallFinding {
  readonly id: string;
  readonly severity: WorkflowPackagePreInstallFindingSeverity;
  readonly relativePath: string;
  readonly evidence: string;
  readonly ruleName: string;
  readonly remediation: string;
}

export interface WorkflowPackagePreInstallCheckResult {
  readonly enabled: boolean;
  readonly mode: WorkflowPackagePreInstallCheckMode;
  readonly status: WorkflowPackagePreInstallCheckStatus;
  readonly scannerVersion: string;
  readonly containerRuntime?: "docker" | "podman";
  readonly findings: readonly WorkflowPackagePreInstallFinding[];
}
```

**Checklist**:

- [x] Add option and result types without replacing existing checkout result
      fields.
- [x] Include `preInstallCheck` on checkout JSON only when configured or
      requested.
- [x] Treat `high` and `critical` static findings as default blocking
      severities in reject mode.
- [x] Keep finding evidence package-relative and free of expanded secret
      values.

### 9. Built-In Static Scanner

#### `packages/rielflow/src/workflow/packages/pre-install-scanner.ts`
#### `packages/rielflow/src/workflow/packages/packages.test.ts`

**Status**: Completed

```typescript
export interface WorkflowPackageStaticScanInput {
  readonly packageDirectory: string;
  readonly workflowDirectory: string;
  readonly mode: WorkflowPackagePreInstallCheckMode;
}

export interface WorkflowPackageStaticScanner {
  scan(
    input: WorkflowPackageStaticScanInput,
  ): Promise<WorkflowPackagePreInstallCheckResult>;
}
```

**Checklist**:

- [x] Scan staged package files without executing prompts, scripts, hooks, or
      workflow nodes.
- [x] Detect instruction-override prompt-injection patterns.
- [x] Detect credential/token/SSH-key/environment exfiltration instructions.
- [x] Detect workflow-local scripts or command templates that combine sensitive
      local file reads with network transfer instructions.
- [x] Report suspicious executable files or shell scripts outside documented
      package support paths.
- [x] Add focused tests for blocking, warning-only, clean, and evidence
      redaction cases.

### 10. Optional No-Network Container Check

#### `packages/rielflow/src/workflow/packages/pre-install-container.ts`
#### `packages/rielflow/src/workflow/packages/packages.test.ts`

**Status**: Completed

```typescript
export type WorkflowPackageContainerRuntimeRequest =
  | "docker"
  | "podman"
  | "auto";

export interface WorkflowPackageContainerCheckInput {
  readonly packageDirectory: string;
  readonly runtime: WorkflowPackageContainerRuntimeRequest;
  readonly mode: WorkflowPackagePreInstallCheckMode;
}
```

**Checklist**:

- [x] Resolve `auto` as Docker first, then Podman.
- [x] Run requested container checks with network disabled, read-only staged
      package mount, temporary writable work directory, no privileged mode, and
      no host credential/user/project root mounts.
- [x] Filter secret environment variables from container execution.
- [x] Treat unavailable requested runtimes as check failures only when a
      container check was requested.
- [x] Do not execute workflow nodes through declared agent backends.
- [x] Add command-construction tests that assert no-network and mount/env
      constraints without requiring Docker/Podman in normal unit tests.

### 11. Checkout Ordering Integration

#### `packages/rielflow/src/workflow/packages/checkout.ts`
#### `packages/rielflow/src/workflow/packages/integrity.ts`
#### `packages/rielflow/src/workflow/packages/packages.test.ts`

**Status**: Completed

```typescript
export interface WorkflowPackageCheckoutInput {
  readonly preInstallCheck?: boolean;
  readonly preInstallCheckMode?: WorkflowPackagePreInstallCheckMode;
  readonly preInstallCheckContainer?: WorkflowPackageContainerRuntimeRequest;
}
```

**Checklist**:

- [x] Preserve ordering: resolve/stage, md5 compatibility, sha256/signature
      validation, workflow bundle validation, static scanner, optional
      container check, destination copy, checkout record write.
- [x] Ensure static or container failure before step 6 leaves destination and
      checkout records unchanged.
- [x] Ensure `--overwrite` removes an existing destination only after selected
      checks pass.
- [x] Keep direct GitHub checkout behavior unchanged unless package checkout
      is explicitly selected.
- [x] Add regression tests proving integrity/signature validation still runs
      before scanner execution.

### 12. CLI Flags, Rendering, Docs, And Help

#### `packages/rielflow/src/cli/argument-parser.ts`
#### `packages/rielflow/src/cli/input-output-helpers.ts`
#### `packages/rielflow/src/cli/workflow-command-handler.ts`
#### `packages/rielflow/src/cli/workflow-package-command-handler.ts`
#### `packages/rielflow/src/cli.test.ts`
#### `README.md`

**Status**: Completed

```typescript
interface WorkflowPackageCheckoutCliOptions {
  readonly preInstallCheck?: boolean;
  readonly preInstallCheckMode?: "warn" | "reject";
  readonly preInstallCheckContainer?: "docker" | "podman" | "auto";
  readonly noPreInstallCheck?: boolean;
}
```

**Checklist**:

- [x] Parse `--pre-install-check`.
- [x] Parse `--pre-install-check-mode warn|reject`, defaulting to `reject`
      when `--pre-install-check` is present.
- [x] Parse `--pre-install-check-container docker|podman|auto`.
- [x] Accept `--no-pre-install-check` only as an override for future
      environment/config defaults; it must not be required for current default
      checkout.
- [x] Render text check status and blocking finding count.
- [x] Render stable JSON `preInstallCheck` fields only when configured or
      requested.
- [x] Update checkout help and README package checkout documentation.
- [x] Add CLI tests for reject, warn, container request, help text, and JSON
      output shape.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Package public types | `packages/rielflow/src/workflow/packages/types.ts` | COMPLETED | `packages/rielflow/src/workflow/packages/packages.test.ts` |
| Cache key safety | `packages/rielflow/src/workflow/packages/cache.ts` | COMPLETED | `packages/rielflow/src/workflow/packages/packages.test.ts` |
| Package search service | `packages/rielflow/src/workflow/packages/search.ts` | COMPLETED | `packages/rielflow/src/workflow/packages/packages.test.ts` |
| Package checkout service | `packages/rielflow/src/workflow/packages/checkout.ts` | IN_PROGRESS | `packages/rielflow/src/workflow/packages/packages.test.ts` |
| Direct checkout compatibility | `packages/rielflow/src/workflow/checkout/` | COMPLETED | existing checkout and CLI coverage |
| CLI command wiring | `packages/rielflow/src/cli/argument-parser.ts`, `packages/rielflow/src/cli/input-output-helpers.ts`, `packages/rielflow/src/cli/workflow-command-handler.ts`, `packages/rielflow/src/cli/workflow-package-command-handler.ts` | IN_PROGRESS | `packages/rielflow/src/cli.test.ts` |
| Pre-install check contract | `packages/rielflow/src/workflow/packages/types.ts` | READY | `packages/rielflow/src/workflow/packages/packages.test.ts` |
| Static scanner | `packages/rielflow/src/workflow/packages/pre-install-scanner.ts` | READY | `packages/rielflow/src/workflow/packages/packages.test.ts` |
| Container check | `packages/rielflow/src/workflow/packages/pre-install-container.ts` | READY | `packages/rielflow/src/workflow/packages/packages.test.ts` |
| Checkout ordering integration | `packages/rielflow/src/workflow/packages/checkout.ts`, `packages/rielflow/src/workflow/packages/integrity.ts` | READY | `packages/rielflow/src/workflow/packages/packages.test.ts` |
| Security CLI/docs | `packages/rielflow/src/cli/*`, `README.md` | READY | `packages/rielflow/src/cli.test.ts` |

## Dependencies

| Task | Depends On | Status |
|------|------------|--------|
| TASK-001: Public package identities and cache keys | Accepted design | COMPLETED |
| TASK-002: Search service shape and filters | TASK-001 | COMPLETED |
| TASK-003: Checkout service package-id resolution | TASK-001, TASK-002 | IN_PROGRESS |
| TASK-004: Direct checkout compatibility reuse | TASK-003 | COMPLETED |
| TASK-005: CLI workflow checkout/search wiring | TASK-002, TASK-003, TASK-004 | IN_PROGRESS |
| TASK-006: Regression and integration tests | TASK-001 through TASK-005 | IN_PROGRESS |
| TASK-007: Pre-install check types and result contract | TASK-003, accepted security design | READY |
| TASK-008: Built-in static scanner | TASK-007 | READY |
| TASK-009: Optional no-network container check | TASK-007 | READY |
| TASK-010: Checkout security ordering integration | TASK-007, TASK-008, TASK-009, existing integrity/signature gates | READY |
| TASK-011: Security CLI flags, rendering, docs, and help | TASK-007, TASK-010 | READY |
| TASK-012: Security regression verification | TASK-008, TASK-009, TASK-010, TASK-011 | READY |

## Task Breakdown

### TASK-001: Public Package Identities And Cache Keys

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**:

- `packages/rielflow/src/workflow/packages/types.ts`
- `packages/rielflow/src/workflow/packages/cache.ts`

**Completion Criteria**:

- [x] Public CLI/service result types expose `packageId`.
- [x] Internal `packageName` remains same-value compatibility only.
- [x] Cache filenames encode registry/ref/source path segments.
- [x] Unsafe package ids and unsafe cache keys fail before filesystem writes.

### TASK-002: Search Service Shape And Filters

**Status**: Completed
**Parallelizable**: No
**Depends On**: TASK-001
**Deliverables**:

- `packages/rielflow/src/workflow/packages/search.ts`
- `packages/rielflow/src/workflow/packages/packages.test.ts`

**Completion Criteria**:

- [x] Search returns `query`, `registryFilters`, `packages`, and `cache`.
- [x] Search records include metadata fields listed in the design.
- [x] Query, registry, tag, backend, limit, and refresh behavior are tested.
- [x] JSON cache fallback remains sufficient for tests and small registries.

### TASK-003: Checkout Service Package Resolution

**Status**: In Progress
**Parallelizable**: No
**Depends On**: TASK-001, TASK-002
**Deliverables**:

- `packages/rielflow/src/workflow/packages/checkout.ts`
- `packages/rielflow/src/workflow/packages/packages.test.ts`

**Completion Criteria**:

- [x] Package id exact resolution succeeds.
- [x] Single workflow-name fallback succeeds only when unambiguous.
- [x] Missing and ambiguous packages return usage errors with candidates.
- [x] Bundle validation occurs before destination mutation.
- [x] Project scope is default and user scope is explicit.
- [x] Checkout output includes registry URL/ref, source directory, checksum,
      metadata path, and checkout record path.

### TASK-004: Direct Checkout Compatibility And Shared Semantics

**Status**: Completed
**Parallelizable**: Yes
**Depends On**: TASK-003
**Deliverables**:

- `packages/rielflow/src/workflow/checkout/`
- `packages/rielflow/src/workflow/checkout/checkout.test.ts`

**Completion Criteria**:

- [x] Direct GitHub URL checkout behavior remains unchanged.
- [x] Package checkout and direct checkout share destination resolution.
- [x] Overwrite and duplicate handling are consistent.
- [x] Existing direct checkout tests pass without weakening assertions.

### TASK-005: CLI Workflow Checkout And Search

**Status**: In Progress
**Parallelizable**: No
**Depends On**: TASK-002, TASK-003, TASK-004
**Deliverables**:

- `packages/rielflow/src/cli/argument-parser.ts`
- `packages/rielflow/src/cli/input-output-helpers.ts`
- `packages/rielflow/src/cli/workflow-command-handler.ts`
- `packages/rielflow/src/cli/workflow-package-command-handler.ts`
- `packages/rielflow/src/cli.test.ts`

**Completion Criteria**:

- [x] `workflow checkout <github-url>` uses direct checkout.
- [x] `workflow checkout <package-id>` uses package checkout.
- [x] `workflow search [query]` uses package metadata search.
- [x] `workflow package checkout <package-id>` and
      `workflow package search [query]` remain compatible aliases of the same
      service and renderer paths.
- [x] `--output table` is valid for search only where intended.
- [x] CLI JSON uses stable `packageId` fields.
- [x] CLI text/table output matches design column and line contracts.

### TASK-006: End-To-End Verification

**Status**: In Progress
**Parallelizable**: No
**Depends On**: TASK-001 through TASK-005
**Deliverables**:

- `packages/rielflow/src/workflow/packages/packages.test.ts`
- `packages/rielflow/src/workflow/checkout/checkout.test.ts`
- `packages/rielflow/src/cli.test.ts`

**Completion Criteria**:

- [x] Local temporary registry can be registered, searched, and checked out.
- [x] Installed package workflow loads through existing workflow loader.
- [x] Direct GitHub URL checkout regression remains covered.
- [x] Verification commands pass.

### TASK-007: Pre-Install Check Types And Result Contract

**Status**: Completed
**Parallelizable**: Yes
**Depends On**: TASK-003, accepted security design
**Deliverables**:

- `packages/rielflow/src/workflow/packages/types.ts`
- `packages/rielflow/src/workflow/packages/packages.test.ts`

**Completion Criteria**:

- [ ] Checkout input accepts optional pre-install check settings.
- [ ] Checkout output can include `preInstallCheck` without changing existing
      success fields.
- [ ] Findings include id, severity, package-relative path, redacted evidence,
      rule name, and remediation.
- [ ] Reject mode blocks `high` and `critical` findings by default.

### TASK-008: Built-In Static Scanner

**Status**: Ready
**Parallelizable**: No
**Depends On**: TASK-007
**Deliverables**:

- `packages/rielflow/src/workflow/packages/pre-install-scanner.ts`
- `packages/rielflow/src/workflow/packages/packages.test.ts`

**Completion Criteria**:

- [ ] Scanner reads staged package files without executing package content.
- [ ] Rules cover prompt instruction override, credential exfiltration,
      sensitive-file plus network transfer patterns, and unexpected executable
      files.
- [ ] Warn mode reports findings without rejecting checkout.
- [ ] Reject mode fails on blocking severities before install.
- [ ] Unit tests cover clean, warning, blocking, and redaction paths.

### TASK-009: Optional No-Network Container Check

**Status**: Ready
**Parallelizable**: Yes
**Depends On**: TASK-007
**Deliverables**:

- `packages/rielflow/src/workflow/packages/pre-install-container.ts`
- `packages/rielflow/src/workflow/packages/packages.test.ts`

**Completion Criteria**:

- [ ] Docker, Podman, and auto runtime selection are modeled.
- [ ] Generated command disables network and privileged mode.
- [ ] Staged package is mounted read-only with no project/user root or
      credential mounts.
- [ ] Secret-like environment variables are not forwarded.
- [ ] Tests assert command construction and unavailable-runtime behavior
      without requiring Docker/Podman.

### TASK-010: Checkout Security Ordering Integration

**Status**: Ready
**Parallelizable**: No
**Depends On**: TASK-007, TASK-008, TASK-009, existing integrity/signature gates
**Deliverables**:

- `packages/rielflow/src/workflow/packages/checkout.ts`
- `packages/rielflow/src/workflow/packages/integrity.ts`
- `packages/rielflow/src/workflow/packages/packages.test.ts`

**Completion Criteria**:

- [ ] Existing md5 compatibility, sha256 integrity, and trusted signature
      validation remain before scanner execution.
- [ ] Workflow bundle validation remains before scanner execution.
- [ ] Static scan and container failures leave destination and checkout records
      unchanged.
- [ ] `--overwrite` deletes existing destinations only after selected checks
      pass.
- [ ] Direct GitHub checkout regressions remain unchanged.

### TASK-011: Security CLI Flags, Rendering, Docs, And Help

**Status**: Ready
**Parallelizable**: No
**Depends On**: TASK-007, TASK-010
**Deliverables**:

- `packages/rielflow/src/cli/argument-parser.ts`
- `packages/rielflow/src/cli/input-output-helpers.ts`
- `packages/rielflow/src/cli/workflow-command-handler.ts`
- `packages/rielflow/src/cli/workflow-package-command-handler.ts`
- `packages/rielflow/src/cli.test.ts`
- `README.md`

**Completion Criteria**:

- [x] `--pre-install-check` enables the built-in static scanner.
- [x] `--pre-install-check-mode warn|reject` defaults to `reject` when the
      check is enabled.
- [x] `--pre-install-check-container docker|podman|auto` requests the
      additional no-network container check.
- [x] `--no-pre-install-check` is accepted only as a future config/policy
      override.
- [x] Text and JSON rendering expose check status without leaking secrets.
- [x] README and command help document security flags and optional behavior.

### TASK-012: Security Regression Verification

**Status**: Completed
**Parallelizable**: No
**Depends On**: TASK-008, TASK-009, TASK-010, TASK-011
**Deliverables**:

- `packages/rielflow/src/workflow/packages/packages.test.ts`
- `packages/rielflow/src/cli.test.ts`
- `README.md`

**Completion Criteria**:

- [x] Tests prove suspicious packages are rejected before destination writes
      and checkout record writes in reject mode.
- [x] Tests prove warn mode reports findings while allowing install.
- [x] Tests prove ordinary checkout still works when no security flag is used.
- [x] Tests prove Docker/Podman absence does not break static-only or default
      checkout.
- [x] Focused package and CLI verification commands pass.

## Parallelizable Tasks

- TASK-001 can run independently after design acceptance.
- TASK-004 test audit can begin once TASK-003 identifies shared checkout
  semantics, while TASK-005 CLI wiring waits for service outputs.
- TASK-007 can be implemented in parallel with documentation drafting because
  it only extends package types/tests.
- TASK-009 can run in parallel with TASK-008 after TASK-007 because container
  command construction and static scanner rules live in disjoint files.

## Verification

Run after implementation:

```bash
bun test packages/rielflow/src/workflow/packages/packages.test.ts
bun test packages/rielflow/src/workflow/packages
bun test packages/rielflow/src/workflow/checkout/checkout.test.ts
bun test packages/rielflow/src/cli.test.ts
bun run packages/rielflow/src/bin.ts workflow package checkout <package-id> --help
bun run packages/rielflow/src/bin.ts workflow package checkout <package-id> --pre-install-check
bun run tsc --noEmit
git diff --check
```

Optional manual smoke tests with a local registry:

```bash
rielflow cli workflow package registry add local --registry-url https://github.com/example/rielflow-packages --local-path /tmp/rielflow-packages --output json
rielflow cli workflow package search example --registry local --refresh --output json
rielflow cli workflow package checkout example-flow --registry local --overwrite --output json
rielflow cli workflow package checkout example-flow --registry local --overwrite --pre-install-check --output json
rielflow cli workflow package checkout example-flow --registry local --overwrite --pre-install-check --pre-install-check-mode warn --output json
rielflow cli workflow search example --registry local --refresh --output json
rielflow cli workflow checkout example-flow --registry local --overwrite --output json
```

## Completion Criteria

- [x] Feature-local design contract is implemented without expanding sibling
      registry, publish, or migration scope.
- [x] Direct GitHub URL checkout remains backward compatible.
- [x] Package checkout resolves `packageId` deterministically and fails loudly
      for ambiguous matches.
- [x] Search returns stable metadata JSON and table/text output.
- [x] Project-scope install is the default and `--user-scope` is explicit.
- [x] Registry ref, source path, metadata path, checksum, and checkout record
      path are visible in outputs or records.
- [x] Cache paths encode unsafe URL/ref/source path segments.
- [x] Tests and type checking pass for the focused package/search/checkout slice.
- [x] Optional `--pre-install-check` runs static scanning before install.
- [x] Reject mode blocks high/critical scanner findings before destination or
      checkout record mutation.
- [x] Warn mode reports findings without blocking checkout.
- [x] Optional Docker/Podman container check runs with network disabled,
      read-only staged package mount, no credential/user/project root mounts,
      filtered environment, and no privileged mode.
- [x] Existing md5 compatibility, sha256 integrity, and signature behavior is
      preserved and runs before scanning.
- [x] README and checkout help document the new optional security flags.

## Addressed Review Feedback

- Step 3 design review accepted the feature design with no blocking findings.
- Step 3 low-severity feedback requested explicit verification for canonical
  `workflow search` and `workflow checkout <package-id>` aliases; TASK-005 and
  manual smoke commands now cover those routes.
- The plan makes `packageId` the stable CLI JSON output field.
- The plan explicitly keeps registry configuration, publish/PR flow, metadata
  ownership, and migration as sibling fanout responsibilities.
- The plan includes direct URL checkout compatibility and shared
  destination/overwrite semantics to reduce drift.
- The plan calls out global output guard updates for search table output.
- Step 3 design review for the pre-install security update accepted the design
  with no high or mid findings.
- The security update keeps `codex-agent` as workflow execution context only;
  no Codex-reference implementation behavior was copied.
- The plan traces intentional divergences from the issue: checks remain
  opt-in, container checks do not execute workflow nodes, and Docker/Podman
  absence does not affect default checkout.

## Risks

- CLI command shape may drift between `workflow checkout <package-id>` and
  existing `workflow package checkout`; TASK-005 must keep both paths coherent.
- Search table output may require output guard updates outside package modules.
- Registry URL, branch, and source path cache encoding must be consistent across
  checkout and search.
- Direct URL checkout and package checkout can diverge unless destination and
  overwrite helpers stay shared.
- Existing sibling fanout changes already touched package modules, so
  implementers must preserve unrelated registry/publish work in the dirty
  worktree.
- Static scanner findings are heuristic and can produce false positives or
  false negatives.
- Container runtime availability varies by host; normal checkout and
  static-only checkout must not depend on Docker/Podman being installed.
- Credential exposure is possible if container mounts, environment filtering,
  or network disabling are implemented incorrectly.
- Checkout ordering bugs could weaken existing md5 compatibility, sha256
  integrity, or signature gates if scanner integration bypasses them.

## Progress Log

### Session: 2026-05-27

**Tasks Completed**: Plan created.

**Notes**:

- Created feature-local plan at
  `impl-plans/active/workflow-package-checkout-search.md`.
- Source of truth is accepted design
  `design-docs/specs/design-workflow-package-checkout-search.md`.

### Session: 2026-05-27 14:08 JST Step 6 Implementation

**Tasks Completed**: Implemented packageId-compatible search and checkout output contracts, backend filters, encoded cache keys, canonical `workflow search` and `workflow checkout <package-id>` aliases, and focused regression tests.

**Tasks In Progress**: Full CLI table rendering polish remains to broaden the existing JSON/text coverage.

**Blockers**: Full `bun run lint:biome` is blocked by unrelated pre-existing format/noExcessiveLinesPerFile diagnostics.

**Notes**: Focused verification passed with `bun test packages/rielflow/src/workflow/packages/packages.test.ts`, `bun run typecheck`, and touched-file Biome checks.

### Session: 2026-05-27 14:32 JST Step 6 Revision

**Tasks Completed**: Added CLI regression coverage for canonical `workflow search` and `workflow checkout <package-id>` package aliases and added package checksum verification before checkout mutation.

**Tasks In Progress**: Table-specific rendering polish remains.

**Blockers**: Full `bun run lint:biome` remains blocked by unrelated pre-existing diagnostics.

**Notes**: `bun test packages/rielflow/src/cli.test.ts`, package tests, typecheck, touched-file Biome, and diff whitespace checks passed.

### Session: 2026-05-27 15:12 JST Step 7 Feedback Revision

**Tasks Completed**: Reconciled stale checkout/search implementation-plan progress after Step 7 review. Marked implemented packageId result contracts, cache-safe path encoding, search filters/results, checkout provenance/checksum verification, direct checkout compatibility, CLI aliases, table output allowance, and regression verification as complete or in progress according to actual code state.

**Tasks In Progress**: Broader table rendering polish and additional ambiguity/error-path tests remain explicit follow-up work rather than stale NOT_STARTED/BLOCKED entries.

**Blockers**: Full `bun run lint:biome` remains blocked by unrelated pre-existing diagnostics.

**Notes**: This revision updates plan tracking only; no TypeScript behavior changed.

### Session: 2026-05-27 15:24 JST Step 7 Feedback Revision

**Tasks Completed**: Updated the global output guard so `workflow package search --output table` reaches the package search handler and added CLI regression coverage for the package-scoped table route.

**Tasks In Progress**: Additional ambiguity/error-path tests remain explicit follow-up work.

**Blockers**: Full `bun run lint:biome` remains blocked by unrelated pre-existing diagnostics.

**Notes**: This revision addresses Step 7 exec-000016 package search table feedback.

### Session: 2026-05-27 Step 4 Pre-Install Security Planning

**Tasks Completed**: Revised this active implementation plan for the accepted
issue-resolution design "Add optional sandbox pre-install checks for workflow
package checkout."

**Tasks Ready**: TASK-007 through TASK-012 cover pre-install result contracts,
built-in static scanning, optional Docker/Podman no-network checks, checkout
ordering, CLI/docs, and regression verification.

**Blockers**: None for planning. Implementation must preserve existing package
registry, metadata, md5 compatibility, sha256 integrity, and signature behavior.

**Notes**: Step 3 design review accepted the design with no high or mid
findings; no Step 5 feedback was present for this planning run.

### Session: 2026-05-27 Step 6 Pre-Install Security Implementation

**Tasks Completed**: TASK-007, TASK-008, TASK-009, TASK-010, TASK-011, and
TASK-012.

**Tasks In Progress**: None for the accepted pre-install security issue.

**Blockers**: Full `bun run lint:biome` remains blocked by unrelated
pre-existing repository diagnostics outside this change set.

**Notes**: Implemented opt-in static scanning, reject/warn mode behavior,
optional Docker/Podman no-network container command execution, checkout ordering
before destination and checkout-record mutation, CLI flags/help, README
documentation, and focused package/CLI regression tests.
