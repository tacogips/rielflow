# Swift Native Bundle Add-ons Implementation Plan

**Status**: In Progress
**Design Reference**: https://github.com/tacogips/rielflow/issues/55
**Created**: 2026-06-12
**Last Updated**: 2026-06-13

## Related Plans

- **Depends On**: `completed/swift-native-migration-task-006-contracts:TASK-002`,
  `completed/swift-native-migration-task-007-cli-parity:TASK-003`,
  `third-party-addon-resolution:TASK-004`
- **Design**: https://github.com/tacogips/rielflow/issues/55
- **References**:
  `design-docs/specs/design-executable-node-addon-manifest-dependencies.md`,
  `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`,
  `design-docs/specs/design-swift-native-migration.md`

## Design Document Reference

Implement Swift-native executable add-ons through trusted installed macOS
`.bundle` plugins. Keep workflow authoring unchanged, extend package add-on
execution metadata with `native-bundle`, load bundles through an injected C-ABI
JSON boundary, and publish plugin output through the existing runtime-owned
publication path.

In scope:

- package manifest and add-on descriptor support for `native-bundle`;
- deterministic metadata validation for bundle path, ABI, identifier,
  code-signing requirement, capability grants, source-scope intent/materialized
  scope conflict rules, content digest requirements, and dependency-closure
  requirements;
- native bundle resolver/invoker contracts in `RielflowAddons`;
- add-on node execution path in the Swift deterministic runner;
- CLI inspection and executable preflight summaries;
- fake-loader unit tests and one optional fixture bundle smoke only if it is
  deterministic on macOS CI.

Out of scope:

- direct workflow-directory native bundles;
- native bundle marketplace trust policy;
- plugin sandboxing;
- Linux native plugins;
- passing Swift protocol objects or runtime stores across the plugin boundary.

## Modules

### 1. Manifest And Validation Surface

#### `Sources/RielflowAddons/WorkflowPackageManifest.swift`
#### `Sources/RielflowCLI/WorkflowResolution.swift`
#### `Tests/RielflowAddonsTests/WorkflowPackageManifestTests.swift`

**Status**: NOT_STARTED

```swift
public enum WorkflowPackageAddonExecutionKind: String, Codable, Sendable {
  case declarative
  case container
  case localCommand = "local-command"
  case nativeBundle = "native-bundle"
}

public struct WorkflowPackageAddonExecutionDescriptor: Codable, Equatable, Sendable {
  public var kind: WorkflowPackageAddonExecutionKind
  public var entrypoint: String?
  public var containerfilePath: String?
  public var runtimeHints: [String]
  public var abiVersion: Int?
  public var bundleIdentifier: String?
  public var codeSignatureRequirement: String?
}
```

**Checklist**:

- [ ] Add `native-bundle` decode/encode support without changing existing
      execution kinds.
- [ ] Validate `.bundle` entrypoint paths as package-relative and under
      `sourcePath`.
- [ ] Require `abiVersion == 1`, non-empty `bundleIdentifier`, explicit
      capabilities, package `integrity`, add-on `contentDigest`, and production
      `codeSignatureRequirement`.
- [ ] Reject native bundles for non-`node-addon` packages and reserved
      `rielflow/*` third-party declarations.
- [ ] Preserve installed package provenance so production CLI paths cannot load
      native bundles from direct workflow directories or unpackaged add-on
      roots.
- [ ] Require exact package/dependency-lock selection when project and user
      scopes contain duplicate executable add-on identities.
- [ ] Add regressions for unsupported keys, unsafe paths, missing digest,
      missing capability grants, missing signing requirements, duplicate
      executable identities, and valid native bundle metadata.

### 2. Native Bundle Plugin Contracts

#### `Sources/RielflowAddons/NativeBundleAddonContracts.swift`
#### `Tests/RielflowAddonsTests/NativeBundleAddonContractsTests.swift`

**Status**: NOT_STARTED

```swift
public struct NativeBundleAddonDescriptor: Codable, Equatable, Sendable {
  public var abiVersion: Int
  public var bundleIdentifier: String
  public var addons: [NativeBundleAddonExport]
}

public struct NativeBundleAddonExport: Codable, Equatable, Sendable {
  public var name: String
  public var version: String?
  public var boundary: AddonExecutionBoundary
}

public protocol NativeBundlePluginLoading: Sendable {
  func loadBundle(at url: URL) throws -> NativeBundlePluginSymbols
}

public struct NativeBundlePluginSymbols: Sendable {
  public var descriptor:
    @Sendable @convention(c) () -> UnsafeMutablePointer<CChar>?
  public var execute:
    @Sendable @convention(c) (UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>?
  public var free:
    @Sendable @convention(c) (UnsafeMutablePointer<CChar>?) -> Void
}

public struct NativeBundleCodeSignatureRequirement: Codable, Equatable, Sendable {
  public var requirement: String
  public var requirementDigest: String
  public var summary: String
}

public struct NativeBundleCacheKey: Hashable, Sendable {
  public var resolvedOrDirectSourceScope: String
  public var packageName: String
  public var packageInstallId: String
  public var addonName: String
  public var addonVersion: String?
  public var bundleIdentifier: String
  public var abiVersion: Int
  public var contentDigest: String
  public var dependencyClosureDigest: String
  public var signingRequirementDigest: String
  public var dyldImageVerificationDigest: String?
}
```

**Checklist**:

- [ ] Define descriptor/export/symbol/free/signing contracts.
- [ ] Define cache-key contracts with stale loaded-handle behavior before full
      resolver completion.
- [ ] Implement descriptor JSON decoding and strict ABI/version/add-on matching.
- [ ] Copy descriptor and execute C-string results with a bounded NUL scan and
      call plugin `free` exactly once on every success and failure path.
- [ ] Validate production bundle signatures before descriptor loading.
- [ ] Carry `dependencyClosureDigest` and signing requirement digest through
      cache-key and diagnostics contracts.
- [ ] Carry post-load dyld image verification status and taint state through
      cache-key diagnostics before descriptor execution.
- [ ] Convert malformed descriptor/output/failure states into
      `AddonDiagnostic` values.
- [ ] Keep real bundle loading behind the `NativeBundlePluginLoading` protocol.
- [ ] Cover fake-loader success, missing export, malformed JSON, ABI mismatch,
      signature failures, denied output gates, and thrown loader errors.
- [ ] Cover stale cache state and cooperative cancellation before full resolver
      completion.

### 3. Native Bundle Resolver

#### `Sources/RielflowAddons/NativeBundleAddonResolver.swift`
#### `Tests/RielflowAddonsTests/NativeBundleAddonResolverTests.swift`

**Status**: NOT_STARTED

```swift
public struct NativeBundleAddonRegistration: Equatable, Sendable {
  public var packageName: String
  public var addonName: String
  public var version: String?
  public var sourceScopeIntent: String?
  public var resolvedSourceScope: String
  public var sourceDirectory: URL
  public var bundleURL: URL
  public var bundleIdentifier: String
  public var abiVersion: Int
  public var contentDigest: String
  public var dependencyClosureDigest: String
  public var codeSignatureRequirement: String
  public var codeSignatureRequirementDigest: String
  public var installSnapshotId: String
  public var capabilities: [WorkflowAddonCapability]
}

public struct NativeBundleAddonResolver: AddonResolving {
  public init(
    registrations: [NativeBundleAddonRegistration],
    loader: any NativeBundlePluginLoading
  )

  public func resolve(_ request: AddonResolveRequest) async -> AddonResolveResult
}
```

**Checklist**:

- [ ] Index registrations by `(addonName, version)`.
- [ ] Refuse built-in `rielflow/*` names and unknown add-ons.
- [ ] Fail closed for duplicate project/user registrations unless an exact
      package id, resolved scope, digest, ABI, and signing requirement lock
      selects one.
- [ ] Build the JSON execution input from `AddonExecutionInput` without adding
      runtime internals.
- [ ] Project `attachment.read` grants into bounded value envelopes without host
      paths, descriptors, stores, or runtime APIs.
- [ ] Enforce `allowCandidatePayload` and `allowDispatchIntents` options.
- [ ] Return `restart_required` diagnostics when cached loaded handles are stale
      for the selected content digest or signing requirement.
- [ ] Revalidate immutable install snapshots, content digest, dependency closure,
      code signature, and bundle identifier immediately before descriptor load.
- [ ] Verify actual post-load dyld image bindings against the selected closure
      before descriptor execution; taint the host/cache key on mismatch.
- [ ] Normalize plugin diagnostics and output into `AddonResolveResult`.
- [ ] Add tests for duplicate registrations, denied outputs, malformed fake
      descriptors, omitted variables, and fail-closed missing resolver behavior.
- [ ] Add tests for version matching and stale cache identity before full
      resolver completion.

### 4. Runner Add-on Execution Path

#### `Sources/RielflowCore/DeterministicWorkflowRunner.swift`
#### `Sources/RielflowCore/AdapterContracts.swift`
#### `Tests/RielflowCoreTests/DeterministicWorkflowRunnerTests.swift`

**Status**: NOT_STARTED

```swift
public protocol WorkflowAddonNodeExecuting: Sendable {
  func executeAddonNode(_ input: WorkflowAddonNodeExecutionInput) async throws -> AdapterExecutionOutput
}

public struct WorkflowAddonNodeExecutionInput: Sendable {
  public var workflow: WorkflowDefinition
  public var step: WorkflowStepRef
  public var registryNode: WorkflowNodeRegistryRef
  public var variables: JSONObject
}
```

**Checklist**:

- [ ] Inject an optional add-on executor/resolver into the deterministic runner.
- [ ] Branch addon-only registry nodes away from node payload lookup.
- [ ] Convert successful add-on output into the existing publication request.
- [ ] Preserve output-contract validation, transition routing, root output
      selection, timeout handling, and failure publication behavior.
- [ ] Treat native bundle deadlines and cancellation as cooperative only; reject
      late output after control returns.
- [ ] Fail closed when an executable add-on node has no resolver.
- [ ] Add deterministic runner tests for successful native add-on output,
      resolver failure, multiple publishable transitions, and no node payload
      requirement for add-on nodes.

### 5. CLI Inspection And Executable Preflight

#### `Sources/RielflowCLI/WorkflowCommands.swift`
#### `Sources/RielflowCLI/WorkflowResolution.swift`
#### `Tests/RielflowCLITests/WorkflowCommandTests.swift`

**Status**: NOT_STARTED

```swift
public struct NativeBundleAddonInspection: Codable, Equatable, Sendable {
  public var nodeId: String
  public var addon: String
  public var sourceKind: String
  public var sourceScopeIntent: String?
  public var resolvedSourceScope: String
  public var packageName: String?
  public var bundleIdentifier: String
  public var abiVersion: Int
  public var contentDigest: String
  public var dependencyClosureDigest: String
  public var signingRequired: Bool
  public var signingVerified: Bool?
  public var dyldImageVerificationStatus: String?
  public var cacheStatus: String
  public var preflightHelperStatus: String?
}
```

**Checklist**:

- [ ] Add native bundle source summaries to `workflow inspect --output json`.
- [ ] Keep passive `workflow validate` from loading bundles.
- [ ] Let executable preflight validate descriptor metadata through a
      short-lived helper process without executing add-on bodies or populating
      execution caches.
- [ ] Report unsupported platform, missing bundle, ABI mismatch, and identifier
      mismatch as deterministic readiness diagnostics.
- [ ] Surface signing requirement summaries, duplicate-lock conflicts,
      source-scope intent/resolved scope, stale-load/restart-required status,
      dyld verification status, and cooperative-cancellation limits.
- [ ] Add CLI tests for inspect JSON, passive validation, executable preflight,
      and redacted loader failures.

### 6. Documentation And Verification

#### https://github.com/tacogips/rielflow/issues/55
#### `design-docs/specs/architecture.md`
#### `impl-plans/README.md`
#### `impl-plans/PROGRESS.json`

**Status**: NOT_STARTED

```swift
public struct NativeBundleAddonVerificationGate: Codable, Equatable, Sendable {
  public var command: String
  public var expectedEvidence: String
}
```

**Checklist**:

- [ ] Keep the GitHub design issue current as implementation constraints are discovered.
- [ ] Remove any stale architecture notes that duplicate the GitHub design issue.
- [ ] Update implementation plan status, progress log, and `PROGRESS.json`.
- [ ] Run JSON validation, targeted Swift tests, and full Swift tests before
      moving the plan out of Ready/In Progress.
- [ ] Verify no package digest refresh is required unless packaged workflow,
      prompt, script, or skill files are changed.

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Manifest and validation surface | `Sources/RielflowAddons/WorkflowPackageManifest.swift`, `Sources/RielflowCLI/WorkflowResolution.swift` | IN_PROGRESS | `WorkflowPackageManifestTests` |
| Native bundle plugin contracts | `Sources/RielflowAddons/NativeBundleAddonContracts.swift` | IN_PROGRESS | `NativeBundleAddonContractsTests` |
| Native bundle resolver | `Sources/RielflowAddons/NativeBundleAddonResolver.swift` | IN_PROGRESS | `NativeBundleAddonResolverTests` |
| Runner add-on execution path | `Sources/RielflowCore/DeterministicWorkflowRunner.swift` | IN_PROGRESS | `DeterministicWorkflowRunnerTests` |
| CLI inspection/preflight | `Sources/RielflowCLI/WorkflowCommands.swift` | IN_PROGRESS | `WorkflowCommandTests` |
| Documentation and verification | `design-docs/specs/*`, `impl-plans/*` | NOT_STARTED | `jq`, `swift test` |

## Dependencies

| Task | Depends On | Status |
| ---- | ---------- | ------ |
| TASK-001 | completed Swift add-on manifest contracts | IN_PROGRESS |
| TASK-002 | TASK-001 | IN_PROGRESS |
| TASK-003 | TASK-001, TASK-002 | IN_PROGRESS |
| TASK-004 | TASK-003 | IN_PROGRESS |
| TASK-005 | TASK-001, TASK-003 | IN_PROGRESS |
| TASK-006 | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005 | BLOCKED |

## Tasks

### TASK-001: Manifest Native Bundle Metadata

**Status**: In Progress
**Parallelizable**: Yes
**Deliverables**: `Sources/RielflowAddons/WorkflowPackageManifest.swift`,
`Sources/RielflowCLI/WorkflowResolution.swift`,
`Tests/RielflowAddonsTests/WorkflowPackageManifestTests.swift`
**Dependencies**: None

**Description**:
Extend package add-on execution metadata and validation for trusted native
bundle add-ons.

**Completion Criteria**:

- [x] `native-bundle` decodes and encodes without regressing existing kinds.
- [x] ABI, bundle identifier, digest, capability, signing requirement, and
      safe-path validation pass.
- [ ] Dependency locks and direct-run grants carry content digest,
      `dependencyClosureDigest`, signing requirement digest, authored
      `sourceScopeIntent`, materialized `resolvedSourceScope`, direct-run exact
      `sourceScope`, immutable snapshot identity, and explicit capability
      grants.
- [ ] Mach-O dependency closure validation rejects ABI v1 `@executable_path`
      dependencies and rpaths, plus unresolved, escaping, mutable, unsigned, or
      non-digested non-system dependencies.
- [ ] Runtime and preflight perform pre-load dyld collision checks and post-load
      image verification before descriptor execution; failures taint the
      host/cache key and require restart.
- [ ] Direct workflow directories and unpackaged add-on roots cannot produce
      production native bundle registrations.
- [ ] Duplicate executable add-on identities require exact package locks.
- [x] Invalid native bundle metadata produces deterministic validation issues.
- [x] Existing manifest tests still pass.

### TASK-002: Bundle ABI Contracts

**Status**: In Progress
**Parallelizable**: No
**Deliverables**: `Sources/RielflowAddons/NativeBundleAddonContracts.swift`,
`Tests/RielflowAddonsTests/NativeBundleAddonContractsTests.swift`
**Dependencies**: TASK-001

**Description**:
Create the C-ABI JSON plugin loading, pointer/free, and descriptor validation
contracts.

**Completion Criteria**:

- [x] Loader/handle protocols are testable without loading native code.
- [x] Descriptor and execute symbols use bounded C-string copy and exactly-once
      `free` ownership on success and failure.
- [x] Descriptor matching validates ABI, bundle identifier, add-on name, and
      version.
- [x] Production signature validation runs before descriptor loading.
- [x] Malformed JSON and loader failures become add-on diagnostics.
- [x] Fake-loader tests cover success and failure cases.

### TASK-003: Native Bundle Resolver

**Status**: In Progress
**Parallelizable**: No
**Deliverables**: `Sources/RielflowAddons/NativeBundleAddonResolver.swift`,
`Tests/RielflowAddonsTests/NativeBundleAddonResolverTests.swift`
**Dependencies**: TASK-001, TASK-002

**Description**:
Implement `AddonResolving` for installed native bundle registrations.

**Completion Criteria**:

- [x] Registrations resolve by `(addonName, version)`.
- [x] Built-in names and unknown add-ons fail closed.
- [x] Duplicate unlocked registrations fail closed.
- [ ] Immutable install snapshots, dependency closure digests, and signing
      requirement digests are rechecked before descriptor load.
- [ ] Stale loaded handles fail closed.
- [ ] Accepted `sourceScopeIntent` values materialize to exact
      `resolvedSourceScope` provenance during checkout/update/replay, while
      direct-run grants keep exact `sourceScope`.
- [ ] Post-load dyld image verification succeeds before descriptor execution or
      returns deterministic restart-required/tainted-host diagnostics.
- [x] Plugin outputs honor candidate and dispatch-intent option gates.
- [x] `attachment.read` grants produce only bounded host-mediated value
      projections.
- [x] Resolver tests cover duplicate, missing, malformed, and successful paths.

### TASK-004: Runner Integration

**Status**: In Progress
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCore/DeterministicWorkflowRunner.swift`,
`Sources/RielflowCore/AdapterContracts.swift`,
`Tests/RielflowCoreTests/DeterministicWorkflowRunnerTests.swift`
**Dependencies**: TASK-003

**Description**:
Run add-on-only workflow nodes through the injected resolver and publish their
outputs through the existing runtime-owned publication path.

**Completion Criteria**:

- [x] Add-on nodes no longer require `nodeFile` payloads when a resolver is
      supplied.
- [x] Output publication, validation, transition selection, and root output
      behavior remain shared with agent nodes.
- [x] Runtime-owned attachment projection runs before add-on resolver execution
      and rejects host-path descriptors before plugin invocation.
- [ ] Cancellation and deadlines are documented and enforced as cooperative
      output rejection, not hard in-process preemption.
- [x] Missing resolver or failed resolver diagnostics fail deterministically.
- [x] Runner tests prove add-on success and failure paths.

### TASK-005: CLI Inspect And Preflight

**Status**: In Progress
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCLI/WorkflowCommands.swift`,
`Sources/RielflowCLI/WorkflowResolution.swift`,
`Tests/RielflowCLITests/WorkflowCommandTests.swift`
**Dependencies**: TASK-001, TASK-003

**Description**:
Expose native bundle add-on metadata in inspection and executable validation
without loading bundles during passive validation.

**Completion Criteria**:

- [x] `workflow inspect --output json` shows native bundle source summaries.
- [x] Passive validation avoids bundle loading.
- [ ] Executable preflight validates descriptor readiness through a short-lived
      helper process without executing plugin bodies or filling execution caches.
- [ ] Inspect/preflight output includes signing, conflict, cache, and
      restart-required status, source-scope intent/resolved scope, and dyld
      verification status.
- [x] CLI tests cover JSON output and diagnostics.

### TASK-006: Documentation And Verification

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: https://github.com/tacogips/rielflow/issues/55,
`impl-plans/README.md`,
`impl-plans/PROGRESS.json`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Description**:
Keep docs and progress metadata aligned, then run deterministic validation.

**Completion Criteria**:

- [ ] Design and implementation plan reflect actual implementation decisions.
- [ ] `jq empty impl-plans/PROGRESS.json` passes.
- [ ] Targeted Swift tests pass.
- [ ] Full Swift test suite passes or any environment blocker is documented.
- [ ] No package digest refresh is needed unless package workflow/skill files
      were changed.

## Completion Criteria

- [x] Native bundle add-ons are represented in package metadata and validation.
- [x] Native bundle loader/resolver contracts are deterministic and injectable.
- [x] Add-on-only workflow nodes execute through Swift runtime publication.
- [ ] CLI inspect and executable validation expose native bundle readiness.
- [x] Passive validation does not execute or load native bundles.
- [ ] Signing requirements, duplicate installed identities, stale loaded bundle
      handles, and cooperative cancellation are covered by plan tasks.
- [ ] Tests cover success, validation failure, resolver failure, and malformed
      plugin output paths.
- [ ] `jq empty impl-plans/PROGRESS.json` passes.
- [ ] Targeted and full Swift tests pass.

## Progress Log

### Session: 2026-06-13 08:24 JST

**Tasks Completed**: Deepdesign acceptance and plan alignment.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Blockers**: SwiftPM verification is blocked in this shell because `swift`
is not installed. Helper-process executable preflight, post-load dyld image
verification, TypeScript package-tooling parity, and full restart-required
handling remain implementation tasks.
**Notes**: Ran `codex-deepdesign` successfully against the native bundle
design (now tracked in https://github.com/tacogips/rielflow/issues/55). Session
`riel-codex-deepdesign-1781305317-155feb6c` completed with 13 node executions:
deep review accepted on attempt 4, broad review accepted on attempt 2, and
adversarial review accepted on attempt 1. The accepted design added
`sourceScopeIntent`/`resolvedSourceScope` materialization semantics and
post-load dyld image verification requirements, so this plan was updated to
carry those fields through manifest/lock, resolver/cache, inspect/preflight,
and verification tasks.
**Verification**: `bun run packages/rielflow/src/bin.ts workflow run
codex-deepdesign --workflow-definition-dir ~/.rielflow/workflows
--output json --no-auto-improve --verbose --debug`; `bun run
packages/rielflow/src/bin.ts session status
riel-codex-deepdesign-1781305317-155feb6c --output json`; workflow output
reported `status: accepted`, deep/broad/adversarial `reviewSeverity: none`;
`jq empty impl-plans/PROGRESS.json`; `git diff --check`.

### Session: 2026-06-13 08:01 JST

**Tasks Completed**: Planning deliverables audit.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Blockers**: SwiftPM verification is blocked in this shell because `swift`
is not installed. The `codex-deepdesign` workflow validates from user scope,
but a fresh bounded run for this target exited with code `-1` and no
stdout/stderr, and no new session artifact was written.
**Notes**: Rechecked the current design and implementation plan against the
native-bundle design objective. The design document and architecture index are
present, the implementation plan is indexed in `impl-plans/README.md` and
`PROGRESS.json`, and the plan preserves the remaining implementation gaps
instead of claiming native-bundle support is complete. No Swift source edits
were made in this audit pass.
**Verification**: `bun run packages/rielflow/src/bin.ts workflow validate
codex-deepdesign --workflow-definition-dir ~/.rielflow/workflows
--output json`; `jq empty impl-plans/PROGRESS.json`; `git diff --check`;
`swift test --filter
'AddonExecutionContractsTests|NativeBundleAddonContractsTests|NativeBundleAddonResolverTests|WorkflowPackageManifestTests|DeterministicWorkflowRunnerTests|WorkflowCommandTests'`
blocked with `error: tool 'swift' not found`.

### Session: 2026-06-13 08:00 JST

**Tasks Completed**: None.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Blockers**: Helper-process executable preflight, Mach-O dependency closure
digest verification, restart-required handling for already-loaded stale bundle
handles, and cooperative cancellation review remain for later tasks.
**Notes**: Promoted attachment delivery from preprojected test values to an
injected Core projection port. `WorkflowAddonAttachmentProjecting` now owns
runtime descriptor-to-value materialization before any native-bundle resolver
call. The default inline projector accepts only bounded `contentText` or
`contentBase64`, computes or verifies SHA-256, checks optional size metadata,
rejects duplicate attachment sources, and fails metadata-only host fields such
as `localPath`, `path`, `pathBase`, `contentRef`, or `url` before a plugin can
load. The deterministic runner publishes projection failures as failed step
executions and passes only projected `WorkflowAddonAttachmentValue` records to
the add-on resolver.
**Verification**: `swift test --filter DeterministicWorkflowRunnerTests`.

### Session: 2026-06-13 01:35 JST

**Tasks Completed**: None.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Blockers**: Helper-process executable preflight, full runtime descriptor
materialization through a production `AttachmentProjectionPort`, Mach-O
dependency closure digest verification, and restart-required handling for
already-loaded stale bundle handles remain for later tasks.
**Notes**: Added the first Swift native-bundle `attachment.read` value
projection boundary. Core now has a `WorkflowAddonAttachmentValue` contract and
the deterministic runner can pass add-on attachments without using host paths.
`AddonExecutionInput` and `WorkflowAddonExecutionInput` keep legacy decode
compatibility by defaulting missing `attachments` to an empty map. The native
bundle resolver now accepts attachments only for registration-granted input
fields, validates bounded size, SHA-256 format and content match, exactly one
`contentText` or `contentBase64`, and injects only bounded descriptor fields
under `nodePayload.attachments`. Ungranted or malformed attachments fail before
bundle loading.
**Verification**: `swift test --filter 'AddonExecutionContractsTests|NativeBundleAddonResolverTests'`.

### Session: 2026-06-13 01:25 JST

**Tasks Completed**: None.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Blockers**: Helper-process executable preflight, bounded `attachment.read`
projection, Mach-O dependency closure digest verification, and restart-required
handling for already-loaded stale bundle handles remain for later tasks.
**Notes**: Added an install-snapshot validation port before native-bundle
signature checks and `dlopen`. `NativeBundleDynamicLibraryPluginLoader` now
requires snapshot validation before opening libraries, while the default static
validator fails closed on non-file URLs, missing install snapshot identity,
invalid content/dependency/signing digests, unsupported ABI, unsafe bundle
identifier, missing signing digest, and disappeared bundle paths. Tests inject a
fake snapshot validator to prove stale snapshots stop before signature
verification or symbol lookup, and cover default metadata failure ordering.
**Verification**: `swift test --filter NativeBundleAddonContractsTests`;
`swift test --filter 'NativeBundleAddonContractsTests|NativeBundleAddonResolverTests|WorkflowPackageManifestTests'`.

### Session: 2026-06-13 01:15 JST

**Tasks Completed**: None.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Blockers**: Helper-process executable preflight, immutable snapshot
filesystem rechecks, and full signing digest/provenance reconciliation remain
for later tasks.
**Notes**: Added pre-`dlopen` code-signature enforcement for native-bundle
loading. `NativeBundleDynamicLibraryPluginLoader` now requires a
`NativeBundleCodeSignatureVerifying` implementation and verifies the installed
bundle URL against the registration's signing requirement before opening the
library or resolving symbols. The default verifier uses macOS Security.framework
to create a static code object, parse the requirement string, and check
validity. Tests inject a fake verifier to prove successful loads verify the
requirement first and missing requirements fail before opener/symbol access.
**Verification**: `swift test --filter 'NativeBundleAddonContractsTests|NativeBundleAddonResolverTests'`.

### Session: 2026-06-13 01:05 JST

**Tasks Completed**: None.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Blockers**: Helper-process executable preflight, production code-signing
enforcement, immutable snapshot filesystem rechecks, and signature-aware loader
policy remain for later tasks.
**Notes**: Added installed native-bundle cache identity and a cache wrapper
that avoids stale handle reuse across changed native metadata. `NativeBundleCacheKey`
now includes source scope, package name, install snapshot id, add-on name and
version, bundle identifier, ABI version, content digest, dependency closure
digest, and signing requirement digest. `NativeBundleAddonRegistration` now
carries those fields and derives the cache key. `NativeBundleCachedPluginLoader`
reuses handles only for exact cache-key matches, so a changed content,
dependency, or signing digest causes a fresh load instead of reusing an older
bundle handle.
**Verification**: `swift test --filter 'NativeBundleAddonContractsTests|NativeBundleAddonResolverTests'`.

### Session: 2026-06-13 00:55 JST

**Tasks Completed**: None.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Blockers**: Helper-process executable preflight, production code-signing
enforcement, immutable snapshot rechecks, stale loaded bundle handling, and
signature-aware loader policy remain for later tasks.
**Notes**: Added dynamic-library loader wiring for native-bundle plugins.
`NativeBundleDynamicLibraryPluginLoader` now opens a bundle through an injected
`NativeBundleDynamicLibraryOpening`, requires the descriptor, execute, and
free symbols by their ABI v1 names, converts them into the C-ABI handle, and
keeps the loaded library handle alive for descriptor and execute calls. The
default opener uses `dlopen`/`dlsym` behind the same protocol, while tests use
a fake symbol table to verify successful handle creation and missing-symbol
failure before descriptor execution.
**Verification**: `swift test --filter 'NativeBundleAddonContractsTests|NativeBundleAddonResolverTests'`.

### Session: 2026-06-13 00:45 JST

**Tasks Completed**: None.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Blockers**: Real helper-process executable preflight, production
code-signing enforcement, immutable snapshot rechecks, stale loaded bundle
handling, and real native bundle loader wiring remain for later tasks.
**Notes**: Added the first C-ABI JSON boundary implementation for native
bundle plugins. `NativeBundlePluginSymbols` now models descriptor, execute,
and free function pointers; `NativeBundleCABIPluginHandle` copies descriptor
and execute returned C strings with a bounded NUL scan, decodes descriptor and
output JSON, and releases returned plugin strings exactly once on success and
malformed/missing-NUL failure paths. The resolver now reads descriptors through
the throwing handle API and converts descriptor load failures into deterministic
add-on diagnostics.
**Verification**: `swift test --filter 'NativeBundleAddonContractsTests|NativeBundleAddonResolverTests'`.

### Session: 2026-06-13 00:35 JST

**Tasks Completed**: None.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Blockers**: Real helper-process executable preflight, production
code-signing enforcement, immutable snapshot rechecks, stale loaded bundle
handling, and real native bundle loader wiring remain for later tasks.
**Notes**: Hardened native-bundle registration selection. The resolver now
rejects built-in `rielflow/*` identities before native loading, fails closed
when an add-on name/version matches multiple installed registrations without
an exact package selection, and only infers a package for bare workflow add-on
names when the installed registration is unique. Added loader-recorder tests
that prove duplicate and built-in rejection happen before descriptor or bundle
loading, plus a runner regression for ambiguous bare add-on names.
**Verification**: `swift test --filter NativeBundleAddonResolverTests`.

### Session: 2026-06-13 00:25 JST

**Tasks Completed**: None.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Blockers**: Real helper-process executable preflight, production
code-signing enforcement, duplicate installed identity resolution, stale loaded
bundle handling, and real native bundle loader wiring remain for later tasks.
**Notes**: Connected `NativeBundleAddonResolver` to the Core
`WorkflowAddonResolving` execution port so `DeterministicWorkflowRunner` can
execute native-bundle add-on nodes through the Addons resolver directly. The
adapter infers package/add-on identity from package-qualified names or known
registrations, builds plugin payloads only from explicit add-on node
configuration and resolved input payloads, keeps workflow variables out of the
native invocation boundary, maps native policy diagnostics to
`policy_blocked`, and returns candidate payloads through the existing
runtime-owned publication path.
**Verification**: `swift test --filter 'NativeBundleAddonResolverTests|DeterministicWorkflowRunnerTests'`.

### Session: 2026-06-13 00:15 JST

**Tasks Completed**: None.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.
**Blockers**: Real helper-process executable preflight, production
code-signing enforcement, duplicate installed identity resolution, stale loaded
bundle handling, and native loader wiring remain for later tasks.
**Notes**: Started the CLI inspection/preflight slice. Workflow bundle
resolution now passively reads an optional `rielflow-package.json`; dependency
add-on locks carry native-bundle identity fields; `workflow inspect --output
json` reports structured native-bundle add-on metadata from dependency locks;
passive validation keeps avoiding bundle loads; executable validation now
fails closed with a deterministic helper-unavailable diagnostic for native
bundle add-on nodes instead of attempting in-process loading.
**Verification**: `swift test --filter 'WorkflowCommandTests|WorkflowPackageManifestTests|NativeBundleAddonContractsTests|NativeBundleAddonResolverTests|DeterministicWorkflowRunnerTests'`.

### Session: 2026-06-13 00:05 JST

**Tasks Completed**: None.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003, TASK-004.
**Blockers**: CLI native-bundle inspection/preflight, production code-signing
enforcement, duplicate installed identity resolution, stale loaded bundle
handling, and real native bundle loader wiring remain for later tasks.
**Notes**: Added the Core-side `WorkflowAddonResolving` execution port and
threaded it through `DeterministicWorkflowRunner` so add-on-only workflow nodes
can execute through an injected resolver without requiring `nodeFile` payloads.
The runner now records a failed step execution when no resolver is injected,
publishes successful add-on output through the existing runtime-owned
publication path, preserves transition/root-output handling, and propagates
node deadlines to the add-on resolver. CLI executable validation now reports
that add-on-only nodes require an add-on resolver rather than claiming the
Swift runner cannot execute them.
**Verification**: `swift test --filter 'DeterministicWorkflowRunnerTests|WorkflowCommandTests|WorkflowPackageManifestTests|NativeBundleAddonContractsTests|NativeBundleAddonResolverTests'`.

### Session: 2026-06-12 23:55 JST

**Tasks Completed**: None.
**Tasks In Progress**: TASK-001, TASK-002, TASK-003.
**Blockers**: Runner integration, CLI inspection/preflight, production
code-signing enforcement, duplicate installed identity resolution, and stale
loaded bundle handling remain for later tasks.
**Notes**: Recovered after the Rielflow implementation workflow hung during
the Step 7 revision loop. Implemented the first Swift-native bundle add-on
slice: `native-bundle` manifest metadata and validation, `attachment.read`
capability recognition, native-bundle rejection of generic filesystem grants,
dependency lock execution kind/digest checks, injectable native bundle ABI
contracts, and a fake-loader resolver scaffold. Addressed the Step 7 blocker
class by excluding workflow variables from the native invocation envelope and
default-denying dispatch intents unless a registration explicitly enables them.
**Verification**: `jq empty impl-plans/PROGRESS.json && git diff --check`;
`swift test --filter 'WorkflowPackageManifestTests|NativeBundleAddonContractsTests|NativeBundleAddonResolverTests'`;
`swift test`.

### Session: 2026-06-12 23:40 JST

**Tasks Completed**: Deep-review alignment only.
**Tasks In Progress**: None.
**Blockers**: None for planning. Implementation remains not started.
**Notes**: `codex-deepdesign` Node 2 deep review for execution
`riel-codex-deepdesign-1781273580-1ae00ab3` reported two middle findings:
the design's implementation status could be read as claiming Swift
native-bundle support already exists, and this plan lagged the refined design's
C ABI ownership, dependency-closure, immutable-snapshot, attachment projection,
dispatch-intent gate, and helper-process preflight requirements. This revision
keeps all Swift source work out of scope, resets implementation tasks to
Not Started, and updates TASK-001 through TASK-005 to include those required
design constraints.
**Verification**: Pending final JSON/diff checks after review-loop cleanup.

### Session: 2026-06-12 22:00 JST

**Tasks Completed**: Design and implementation-plan creation.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: `codex-deepdesign` validates from user scope and is runtime-ready.
A full run was attempted; its Node 1 author pass updated the design document,
but the CLI invocation did not emit terminal output or create a new accepted
session artifact before the tool session became stale. The design therefore
records workflow availability plus a direct deep/broad/adversarial review pass
rather than an accepted workflow session id.

### Session: 2026-06-12 22:40 JST

**Tasks Completed**: Plan/design alignment pass.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Aligned the implementation plan with the design's production
code-signing requirement, duplicate installed add-on conflict rules, stale
loaded bundle handling, inspection fields, and cooperative cancellation limits.
Retried bounded `codex-deepdesign` runs with `timeout`; they produced no
stdout/stderr and no new accepted session artifact, while the workflow still
validates from user scope.

### Session: 2026-06-12 23:00 JST

**Tasks Completed**: Status correction after workflow author pass.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Removed inaccurate implementation-complete claims from this plan and
`PROGRESS.json`; no Swift source files were changed for this design/planning
task.
