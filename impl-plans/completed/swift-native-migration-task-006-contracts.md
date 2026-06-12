# Swift Native Migration TASK-006 Contract Boundaries Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-swift-native-migration.md#task-006-package-add-on-event-hook-graphql-and-server-contract-boundary`
**Created**: 2026-06-12
**Last Updated**: 2026-06-12

## Related Plans

- **Parent**: `impl-plans/active/swift-native-migration.md` (`TASK-006`)
- **Depends On**: `active/swift-native-migration:TASK-002`,
  `active/swift-native-migration:TASK-003`,
  `active/swift-native-migration:TASK-005`
- **Previous**: `impl-plans/completed/swift-native-migration-task-005-runtime-session.md`
- **Unblocks**: `active/swift-native-migration:TASK-007`
- **Activation Rule**: Implementation may proceed because TASK-005 is complete
  and the accepted design explicitly scopes TASK-006 to additive contract
  surfaces. Parent TASK-002 and TASK-003 remain active for broader migration
  parity, so TASK-006 must avoid rewrites of core model or JSON envelope
  behavior unless required by a focused contract test.

## Design Reference

Source of truth:

- `design-docs/specs/design-swift-native-migration.md#runtime-contracts-to-preserve`
- `design-docs/specs/design-swift-native-migration.md#task-006-package-add-on-event-hook-graphql-and-server-contract-boundary`
- `design-docs/specs/design-swift-native-migration.md#data-flow`
- `design-docs/specs/design-swift-native-migration.md#verification-gates`
- `impl-plans/active/swift-native-migration.md#task-006-port-package-add-on-event-hook-graphql-and-server-contracts`

Implement additive Swift contract surfaces for package discovery, add-on
resolution, event dry-runs, hook recording, GraphQL inspection, and server
request routing. TypeScript/Bun remains the production fallback; this plan does
not add package installation, live gateways, live HTTP serving, or final CLI
cutover.

In scope:

- Manifest value types, parser, path safety, and deterministic validation
  diagnostics in `RielflowAddons`.
- Declarative add-on request/result types and resolver ports that do not expose
  engine internals.
- Event source, binding, external envelope, dry-run trigger, receipt, and reply
  dispatch contracts in `RielflowEvents`.
- Hook payload parsing, context extraction, recording controls, redaction, and
  hook record value types in `RielflowHook`.
- GraphQL DTO projections and control-plane result contracts in
  `RielflowGraphQL`.
- Server request/route response descriptors for `/`, `/overview`, `/graphql`,
  and `/healthz` in `RielflowServer`.

Out of scope:

- Copying packages, installing package dependencies, running package scripts, or
  mutating project/user workflow scopes.
- Running live chat gateways, polling remote APIs, sending replies, writing
  receipts, or executing workflows from event dry-runs.
- Starting a long-running HTTP server or replacing the TypeScript/Bun GraphQL
  server.
- Publishing workflow messages, allocating communication ids, accessing
  candidate paths from add-ons, or mutating runtime session state.
- Cursor-specific add-on, event, hook, GraphQL, or server behavior.

## Issue Reference

- Workflow mode: `issue-resolution`
- Workflow ID: `codex-design-and-implement-review-loop`
- Workflow session:
  `riel-codex-design-and-implement-review-loop-1781219857-4913c906`
- Planning node: `step4-impl-plan-create`
- Repository: `tacogips/rielflow`
- Issue title:
  `Port Swift package add-on event hook GraphQL and server contracts`
- Task id: `TASK-006`
- GitHub issue: none supplied by runtime input
- Risk level: high; adversarial implementation review required before Swift
  runtime/server cutover

## Codex Agent References

- Preferred `codex-agent` local root `../../codex-agent` remains unavailable in
  this checkout.
- Current adapter references stay authoritative for backend boundaries:
  `packages/rielflow-adapters/src/codex.ts`,
  `packages/rielflow-adapters/src/claude.ts`,
  `packages/rielflow-adapters/src/cursor.ts`,
  `packages/rielflow-adapters/src/dispatch.ts`, and
  `packages/rielflow-adapters/src/shared.ts`.
- Package references:
  `packages/rielflow/src/workflow/packages/manifest.ts`,
  `packages/rielflow/src/workflow/packages/types.ts`,
  `packages/rielflow/src/workflow/packages/install-validation.ts`.
- Add-on references:
  `packages/rielflow/src/workflow/addon-types.ts`,
  `packages/rielflow/src/workflow/addon-package-boundary.ts`,
  `packages/rielflow-addons/src/node-addons/*`.
- Event references:
  `packages/rielflow-events/src/types.ts`,
  `packages/rielflow-events/src/runtime-ports.ts`,
  `packages/rielflow/src/events/validate.ts`,
  `packages/rielflow/src/events/manual-emit.ts`.
- Hook references:
  `packages/rielflow-hook/src/types.ts`,
  `packages/rielflow-hook/src/parse.ts`,
  `packages/rielflow-hook/src/context.ts`,
  `packages/rielflow-hook/src/redaction.ts`,
  `packages/rielflow-hook/src/recorder-contracts.ts`.
- GraphQL/server references:
  `packages/rielflow-graphql/src/dto.ts`,
  `packages/rielflow-graphql/src/control-plane-service.ts`,
  `packages/rielflow-graphql/src/schema-contract.ts`,
  `packages/rielflow/src/server/api.ts`,
  `packages/rielflow/src/server/graphql.ts`,
  `packages/rielflow-server/src/contracts.ts`.
- Existing Swift references:
  `Sources/RielflowCore/*`,
  `Sources/RielflowAddons/RielflowAddons.swift`,
  `Sources/RielflowEvents/RielflowEvents.swift`,
  `Sources/RielflowHook/RielflowHook.swift`,
  `Sources/RielflowGraphQL/RielflowGraphQL.swift`,
  `Sources/RielflowServer/RielflowServer.swift`.

Intentional divergences accepted by design:

- Swift exposes contract-first value types and injected ports instead of live
  package installation, gateway execution, or HTTP serving.
- Add-ons may return candidate payloads or dispatch intents, but runtime-owned
  publication and communication ids remain outside `RielflowAddons`.
- GraphQL exposes DTO and schema-compatible contracts without requiring a live
  HTTP GraphQL stack.

## Modules

### 1. Package Manifest Contracts

#### `Sources/RielflowAddons/WorkflowPackageManifest.swift`
#### `Tests/RielflowAddonsTests/WorkflowPackageManifestTests.swift`

**Status**: COMPLETED

```swift
public enum WorkflowPackageKind: String, Codable, Sendable {
  case workflow
  case nodeAddon = "node-addon"
}

public struct WorkflowPackageManifest: Codable, Equatable, Sendable {
  public var name: String
  public var version: String?
  public var kind: WorkflowPackageKind
  public var workflows: [WorkflowPackageWorkflow]
  public var nodeAddons: [WorkflowPackageNodeAddon]
  public var skills: [WorkflowPackageSkill]
  public var dependencies: [WorkflowPackageDependency]
  public var integrity: WorkflowPackageIntegrity?
}

public protocol WorkflowPackageManifestLoading: Sendable {
  func loadManifest(from url: URL) async throws -> WorkflowPackageManifest
  func validate(_ manifest: WorkflowPackageManifest, packageRoot: URL) async -> [WorkflowPackageValidationIssue]
}
```

**Checklist**:

- [x] Port safe package-name validation with optional scope prefixes and
      lower-case package identifiers.
- [x] Normalize package-relative paths with POSIX separators and reject empty,
      absolute, `..`, and above-root traversal paths.
- [x] Default omitted manifest kind to `workflow`.
- [x] Model skills, workflow metadata, dependencies, add-on locks, integrity
      metadata, and add-on entries as deterministic value contracts.
- [x] Fail closed for unknown or unsupported keys where the TypeScript manifest
      validator rejects them.

### 2. Declarative Add-on Execution Contracts

#### `Sources/RielflowAddons/AddonExecutionContracts.swift`
#### `Tests/RielflowAddonsTests/AddonExecutionContractsTests.swift`

**Status**: COMPLETED

```swift
public struct AddonExecutionInput: Equatable, Sendable {
  public var addonName: String
  public var version: String?
  public var nodePayload: JSONObject
  public var variables: JSONObject
  public var source: AddonSourceMetadata
  public var options: AddonExecutionOptions
}

public struct AddonExecutionOutput: Equatable, Sendable {
  public var candidatePayload: JSONObject?
  public var dispatchIntents: [AddonDispatchIntent]
  public var diagnostics: [AddonDiagnostic]
}

public protocol AddonResolving: Sendable {
  func resolve(_ request: AddonResolveRequest) async -> AddonResolveResult
}
```

**Checklist**:

- [x] Keep add-on definitions declarative and data-driven.
- [x] Distinguish sync and async add-on boundaries so async-only add-ons cannot
      run through sync validation.
- [x] Preserve built-in add-on names and versions in authored workflow JSON.
- [x] Fail unknown third-party add-ons deterministically when no resolver is
      injected.
- [x] Exclude runtime engine internals, session stores, communication ids,
      candidate paths, mutable runtime state, and direct agent backend execution
      from resolver inputs.

### 3. Event Source Dry-run Contracts

#### `Sources/RielflowEvents/EventContracts.swift`
#### `Sources/RielflowEvents/EventDryRun.swift`
#### `Tests/RielflowEventsTests/EventDryRunTests.swift`

**Status**: COMPLETED

```swift
public struct ExternalEventEnvelope: Equatable, Sendable {
  public var sourceId: String
  public var eventId: String
  public var provider: String
  public var eventType: String
  public var receivedAt: Date
  public var dedupeKey: String?
  public var actor: JSONObject?
  public var conversation: JSONObject?
  public var input: JSONObject
  public var artifacts: [EventArtifactReference]
}

public protocol EventDryRunTriggering: Sendable {
  func dryRun(_ request: EventDryRunRequest) async -> EventDryRunResult
}
```

**Checklist**:

- [x] Model event sources, bindings, external envelopes, receipts, reply
      dispatches, and validation diagnostics.
- [x] Validate source kinds, unique ids, route conflicts, HTTP path syntax,
      secret/env var names, template references, and output destinations.
- [x] Apply matching bindings and input mappings in dry-run mode through
      injected ports only.
- [x] Return deterministic trigger summaries without opening gateways, polling
      remote APIs, writing receipts, sending replies, or running workflows.
- [x] Redact or metadata-scope raw provider payload persistence by default.

### 4. Hook Parsing And Redaction Contracts

#### `Sources/RielflowHook/HookContracts.swift`
#### `Tests/RielflowHookTests/HookContractsTests.swift`

**Status**: COMPLETED

```swift
public enum HookVendor: String, Codable, Sendable {
  case claudeCode = "claude-code"
  case codex
  case gemini
}

public struct HookContext: Equatable, Sendable {
  public var vendor: HookVendor
  public var eventName: String
  public var agentSessionId: String
  public var workingDirectory: String
  public var transcriptPath: String?
  public var model: String?
  public var backendMetadata: JSONObject
}

public protocol HookRecording: Sendable {
  func record(_ request: HookRecordRequest) async -> HookRecordResult
}
```

**Checklist**:

- [x] Normalize known hook vendor/event names while preserving unknown events
      explicitly.
- [x] Require non-empty `session_id`, `hook_event_name`, and `cwd`; accept
      optional `transcript_path` as string/null/omitted and optional string
      `model`.
- [x] Preserve `RIEL_HOOK_RECORDING=auto|off|required`,
      `RIEL_HOOK_STRICT`, and
      `RIEL_HOOK_CAPTURE_RAW=redacted|metadata-only|full`.
- [x] Implement redaction for auth, API key, secret, token, password,
      credential, private key, stdout, stderr, output, and command output
      fields.
- [x] Store payload hashes and optional refs; do not persist full raw payloads
      by default.

### 5. GraphQL DTO And Control-plane Contracts

#### `Sources/RielflowGraphQL/GraphQLContracts.swift`
#### `Tests/RielflowGraphQLTests/GraphQLContractsTests.swift`

**Status**: COMPLETED

```swift
public struct GraphQLWorkflowSessionDTO: Codable, Equatable, Sendable {
  public var workflowId: String
  public var sessionId: String
  public var status: String
  public var currentStepId: String?
  public var stepExecutions: [GraphQLStepExecutionDTO]
  public var communications: [GraphQLCommunicationDTO]
}

public protocol GraphQLControlPlaneServicing: Sendable {
  func inspectSession(_ request: GraphQLInspectSessionRequest) async -> GraphQLInspectSessionResult
  func continueSession(_ request: GraphQLContinueSessionRequest) async -> GraphQLControlPlaneResult
}
```

**Checklist**:

- [x] Project TASK-005 sessions, step executions, messages, hook events, event
      receipts, reply dispatches, logs, and LLM session messages into stable
      DTOs.
- [x] Keep runtime stores private and expose projection fields only.
- [x] Provide schema-compatible contract text or field descriptors.
- [x] Model run/continue/mutation outcomes as deterministic result contracts
      without adding final CLI parity or a live control server.

### 6. Server Request And Route Contracts

#### `Sources/RielflowServer/ServerContracts.swift`
#### `Tests/RielflowServerTests/ServerContractsTests.swift`

**Status**: COMPLETED

```swift
public struct ServerRequestEnvelope: Equatable, Sendable {
  public var method: String
  public var path: String
  public var headers: [String: String]
  public var body: Data?
}

public struct ServerResponseDescriptor: Equatable, Sendable {
  public var status: Int
  public var contentType: String
  public var body: JSONObject
}

public protocol ServerRouteHandling: Sendable {
  func route(_ request: ServerRequestEnvelope, context: ServerRequestContext) async -> ServerResponseDescriptor
}
```

**Checklist**:

- [x] Parse GraphQL JSON envelopes with object bodies, object variables,
      optional operation names, bearer tokens, and manager session ids.
- [x] Strip ambient manager execution context from inherited environment before
      request execution.
- [x] Keep `/` and `/overview` read-only, `/graphql` delegated to GraphQL
      contracts, and `/healthz` deterministic.
- [x] Return deterministic descriptors for unsupported methods, unknown paths,
      missing bodies, and non-object bodies.
- [x] Do not start long-running HTTP loops in this slice.

### 7. Fixture Parity And No-side-effect Verification

#### `Tests/RielflowAddonsTests/*`
#### `Tests/RielflowEventsTests/*`
#### `Tests/RielflowHookTests/*`
#### `Tests/RielflowGraphQLTests/*`
#### `Tests/RielflowServerTests/*`

**Status**: COMPLETED

```swift
public struct ContractFixtureCase: Equatable, Sendable {
  public var name: String
  public var fixturePath: String
  public var expectedDiagnostics: [String]
  public var requiresLiveService: Bool
}
```

**Checklist**:

- [x] Add SwiftPM test targets for add-ons, events, hook, GraphQL, and server
      contracts if missing.
- [x] Use fixture manifests, event configs, hook payloads, in-memory stores,
      injected clocks, injected filesystems, and injected service ports only.
- [x] Assert no package installation, live gateway, network, credential, local
      agent binary, live HTTP server, or workflow execution side effects.
- [x] Preserve TypeScript/Bun fallback verification during the slice.

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Package manifest contracts | `Sources/RielflowAddons/WorkflowPackageManifest.swift` | COMPLETED | `Tests/RielflowAddonsTests/WorkflowPackageManifestTests.swift`; SwiftPM passed |
| Declarative add-on execution contracts | `Sources/RielflowAddons/AddonExecutionContracts.swift` | COMPLETED | `Tests/RielflowAddonsTests/AddonExecutionContractsTests.swift`; SwiftPM passed |
| Event dry-run contracts | `Sources/RielflowEvents/EventContracts.swift`, `Sources/RielflowEvents/EventDryRun.swift` | COMPLETED | `Tests/RielflowEventsTests/EventDryRunTests.swift`; SwiftPM passed |
| Hook parsing and redaction contracts | `Sources/RielflowHook/HookContracts.swift` | COMPLETED | `Tests/RielflowHookTests/HookContractsTests.swift`; SwiftPM passed |
| GraphQL DTO/control-plane contracts | `Sources/RielflowGraphQL/GraphQLContracts.swift` | COMPLETED | `Tests/RielflowGraphQLTests/GraphQLContractsTests.swift`; SwiftPM passed |
| Server request/route contracts | `Sources/RielflowServer/ServerContracts.swift` | COMPLETED | `Tests/RielflowServerTests/ServerContractsTests.swift`; SwiftPM passed |
| Fixture parity and no-side-effect verification | `Tests/Rielflow*Tests/*` | COMPLETED | Xcode Swift 6.3.2 `swift test` passed 125 tests; TypeScript/Bun fallback passed |

## Task Breakdown

### TASK-001: Port Package Manifest Loading And Validation Contracts

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `Sources/RielflowAddons/WorkflowPackageManifest.swift`,
`Tests/RielflowAddonsTests/WorkflowPackageManifestTests.swift`
**Dependencies**: active/swift-native-migration:TASK-002,
active/swift-native-migration:TASK-003

**Description**:
Define package manifest value types, safe package names, safe package-relative
paths, kind defaults, dependency/add-on lock/integrity metadata, and validation
diagnostics.

**Completion Criteria**:

- [x] Fixture manifests decode deterministically.
- [x] Invalid names, paths, unknown keys, unsupported kinds, and malformed
      dependency/add-on entries produce deterministic diagnostics.
- [x] Validation remains a planning contract and performs no copy, install,
      script execution, or scope mutation.

### TASK-002: Port Declarative Add-on Execution Boundaries

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/RielflowAddons/AddonExecutionContracts.swift`,
`Tests/RielflowAddonsTests/AddonExecutionContractsTests.swift`
**Dependencies**: TASK-001, active/swift-native-migration:TASK-005

**Description**:
Define add-on descriptor, resolve request/result, sync/async execution, typed
built-in config DTO, unknown add-on diagnostics, candidate payload, and dispatch
intent contracts without runtime-engine leakage.

**Completion Criteria**:

- [x] Resolver inputs include only node payload, variables, source metadata, and
      explicit options.
- [x] Tests prove no session stores, communication ids, candidate paths, engine
      mutation, or direct agent backend execution are exposed.
- [x] Unknown third-party add-ons fail deterministically when no resolver is
      injected.

### TASK-003: Port Event Source Validation And Dry-run Contracts

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `Sources/RielflowEvents/EventContracts.swift`,
`Sources/RielflowEvents/EventDryRun.swift`,
`Tests/RielflowEventsTests/EventDryRunTests.swift`
**Dependencies**: active/swift-native-migration:TASK-002,
active/swift-native-migration:TASK-003

**Description**:
Define event source/binding DTOs, external envelope, validation diagnostics,
dry-run trigger request/result, receipt/reply dispatch projections, and
injected trigger/reply/receipt ports.

**Completion Criteria**:

- [x] Event validation covers supported kinds, unique ids, route conflicts,
      HTTP syntax, secrets, templates, and output destinations.
- [x] Dry-run applies bindings and input mapping through injected ports only.
- [x] Tests prove no live gateway, polling, receipt writes, replies, network, or
      workflow execution occurs.

### TASK-004: Port Hook Parsing, Context, Recording, And Redaction Contracts

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `Sources/RielflowHook/HookContracts.swift`,
`Tests/RielflowHookTests/HookContractsTests.swift`
**Dependencies**: active/swift-native-migration:TASK-002,
active/swift-native-migration:TASK-003

**Description**:
Define hook vendor/event parsing, required payload fields, environment context,
recording controls, redaction policy, payload hashes, and hook record contracts.

**Completion Criteria**:

- [x] Vendor/event normalization matches TypeScript fixture behavior and
      preserves unknown events.
- [x] Required/optional payload fields validate deterministically.
- [x] Redaction-safe recording tests cover sensitive key names and raw payload
      capture modes.

### TASK-005: Port GraphQL DTO And Control-plane Result Contracts

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/RielflowGraphQL/GraphQLContracts.swift`,
`Tests/RielflowGraphQLTests/GraphQLContractsTests.swift`
**Dependencies**: TASK-003, TASK-004, active/swift-native-migration:TASK-005

**Description**:
Project runtime sessions, step executions, workflow messages, hook records,
event receipts/replies, logs, and LLM session messages into stable GraphQL DTOs
and deterministic control-plane result contracts.

**Completion Criteria**:

- [x] DTO fields match stable TypeScript inspection surfaces.
- [x] Runtime-internal stores remain private.
- [x] Mutation/run/continue contracts return deterministic results without
      adding a live GraphQL server.

### TASK-006: Port Server Request And Route Contracts

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/RielflowServer/ServerContracts.swift`,
`Tests/RielflowServerTests/ServerContractsTests.swift`
**Dependencies**: TASK-005

**Description**:
Define request envelope parsing, GraphQL body validation, route response
descriptors, context projection, and deterministic method/path handling.

**Completion Criteria**:

- [x] GraphQL envelopes reject missing or non-object bodies and normalize
      variables to an object.
- [x] Bearer tokens and manager session ids propagate through context.
- [x] `/`, `/overview`, `/graphql`, and `/healthz` descriptors match contract
      expectations; unknown paths and unsupported methods fail
      deterministically.

### TASK-007: Wire Test Targets And Verification Commands

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Package.swift`, `Tests/RielflowAddonsTests/*`,
`Tests/RielflowEventsTests/*`, `Tests/RielflowHookTests/*`,
`Tests/RielflowGraphQLTests/*`, `Tests/RielflowServerTests/*`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006

**Description**:
Add missing SwiftPM test targets, fixture-driven tests, no-side-effect
assertions, and verification evidence for the full TASK-006 contract slice.

**Completion Criteria**:

- [x] Xcode Swift 6.3.2 `swift test` passes.
- [x] TypeScript/Bun fallback commands still pass.
- [x] Targeted `rg` checks prove no live gateways, live server loops, package
      installation side effects, communication-id allocation, candidate-path
      access from add-ons, or Cursor-specific leakage were introduced.

## Dependencies

| Task | Depends On | Reason |
| ---- | ---------- | ------ |
| TASK-001 | `active/swift-native-migration:TASK-002`, `active/swift-native-migration:TASK-003` | Manifest parsing depends on existing Swift model and JSON contracts. |
| TASK-002 | TASK-001, `active/swift-native-migration:TASK-005` | Add-on contracts use manifest descriptors and runtime-owned candidate/publication boundaries. |
| TASK-003 | `active/swift-native-migration:TASK-002`, `active/swift-native-migration:TASK-003` | Event DTOs depend on model and JSON contracts but not add-on files. |
| TASK-004 | `active/swift-native-migration:TASK-002`, `active/swift-native-migration:TASK-003` | Hook parsing depends on shared JSON and path/context contracts. |
| TASK-005 | TASK-003, TASK-004, `active/swift-native-migration:TASK-005` | GraphQL projections include runtime state plus event and hook projections. |
| TASK-006 | TASK-005 | Server routes delegate GraphQL requests and expose GraphQL-derived context. |
| TASK-007 | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006 | Verification needs all contract modules and test targets. |

## Parallelization

- `TASK-001`, `TASK-003`, and `TASK-004` are parallelizable after confirming no
  shared-file edits outside their target directories.
- `TASK-002` depends on package manifest contracts and runtime publication
  boundaries, so it is not parallel with `TASK-001`.
- `TASK-005` depends on event and hook projection shapes and must not run in
  parallel with `TASK-003` or `TASK-004`.
- `TASK-006` depends on GraphQL contracts and must run after `TASK-005`.
- `TASK-007` is final verification and package/test-target wiring, so it must
  run last.

## Verification Plan

Baseline commands:

- `git status --short --branch`
- `git diff --check`
- `bun run typecheck:server`
- `bun run lint:biome`
- `bun run packages/rielflow/src/bin.ts workflow validate codex-design-and-implement-review-loop --scope project`
- `jq empty impl-plans/PROGRESS.json`

Swift commands:

- `/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift --version`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift test`

Targeted contract checks:

- `rg -n "WorkflowPackageManifest|WorkflowPackageManifestLoading|WorkflowPackageValidationIssue" Sources/RielflowAddons Tests/RielflowAddonsTests`
- `rg -n "AddonExecutionInput|AddonResolveRequest|AddonExecutionOutput|communicationId|candidatePath|WorkflowRuntimeStore" Sources/RielflowAddons Tests/RielflowAddonsTests`
- `rg -n "ExternalEventEnvelope|EventDryRunRequest|EventDryRunResult|EventReceipt|ReplyDispatch" Sources/RielflowEvents Tests/RielflowEventsTests`
- `rg -n "HookContext|HookRecordRequest|RIEL_HOOK_RECORDING|RIEL_HOOK_CAPTURE_RAW|redact" Sources/RielflowHook Tests/RielflowHookTests`
- `rg -n "GraphQLWorkflowSessionDTO|GraphQLControlPlaneServicing|schema" Sources/RielflowGraphQL Tests/RielflowGraphQLTests`
- `rg -n "ServerRequestEnvelope|ServerResponseDescriptor|healthz|overview|GraphQL" Sources/RielflowServer Tests/RielflowServerTests`
- `rg -n "URLSession|listen|bind|accept|install|checkout|copyItem|RIEL_MAILBOX_DIR|inbox/input\\.json|outbox/output\\.json" Sources/RielflowAddons Sources/RielflowEvents Sources/RielflowHook Sources/RielflowGraphQL Sources/RielflowServer Tests`

Fixture expectations:

- Package tests use fixture manifests and injected filesystem planning only.
- Event tests use fixture event configs and injected trigger/reply/receipt ports.
- Hook tests use fixture payloads and injected clocks/stores.
- GraphQL tests use TASK-005 in-memory runtime records and synthetic hook/event
  records.
- Server tests use request envelopes and injected GraphQL service ports.

## Completion Criteria

- [x] All TASK-001 through TASK-007 criteria are complete.
- [x] `RielflowAddons`, `RielflowEvents`, `RielflowHook`, `RielflowGraphQL`,
      and `RielflowServer` expose additive Swift contract surfaces.
- [x] Package manifest loading/validation, add-on resolution, event dry-run,
      hook parsing/recording, GraphQL DTOs, and server route descriptors have
      deterministic XCTest coverage.
- [x] No package installation, gateway polling, live HTTP server, workflow
      execution, communication-id allocation, candidate-path publication, or
      runtime session mutation leaks into add-on/event/hook/GraphQL/server
      contracts.
- [x] TypeScript/Bun fallback verification remains green.
- [x] `impl-plans/PROGRESS.json`, `impl-plans/README.md`, this plan, and the
      parent progress log are updated as task status changes.

## Progress Log

### Session: 2026-06-12 08:45

**Tasks Completed**: None
**Tasks In Progress**: None
**Blockers**: None for planning. Implementation must keep TASK-006 additive and
contract-only.
**Review Feedback Addressed**: Step 3 accepted the TASK-006 design update with
no findings; no Step 5 feedback exists for this run.
**Notes**: Created focused TASK-006 implementation plan covering package
manifest validation, declarative add-on boundaries, event dry-runs, hook
redaction-safe recording, GraphQL DTO projections, server request descriptors,
TypeScript/Bun fallback, and no-side-effect verification.

### Session: 2026-06-12 08:40

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005,
TASK-006, TASK-007.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None for the additive contract slice. Parent
`active/swift-native-migration` remains in progress for broader TASK-002,
TASK-003, TASK-007, and cutover work.
**Review Feedback Addressed**: Step 5 accepted the implementation plan with no
high or mid findings; no Step 7 feedback existed for the first implementation
run.
**Notes**: Added package manifest loading/validation contracts, declarative
add-on resolver boundaries, event source validation and dry-run contracts, hook
parsing/recording/redaction contracts, GraphQL DTO/control-plane projections,
and deterministic server route descriptors. Wired SwiftPM test targets for
`RielflowAddonsTests`, `RielflowEventsTests`, `RielflowHookTests`,
`RielflowGraphQLTests`, and `RielflowServerTests`. Xcode Swift 6.3.2
`swift test` passed 113 tests; `bun run typecheck:server`, `bun run
lint:biome`, project workflow validation, `jq empty`, `git diff --check`, and
targeted `rg` contract checks passed.

### Session: 2026-06-12 08:46

**Tasks Completed**: Step 6 self-review fixes for TASK-001 package manifest
parity.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Implementation author self-review found that
package-relative path normalization rejected `"."` even though the TypeScript
reference normalizes it to `"."`, and nested manifest DTO decoders could ignore
unsupported keys that the TypeScript validator rejects.
**Notes**: Updated `WorkflowPackageManifest.swift` to preserve `"."` and
`a/..` as safe package-root paths and to reject unsupported keys in nested
skill, add-on, add-on execution, dependency, and dependency add-on lock
objects. Added regressions in `WorkflowPackageManifestTests.swift`. Xcode Swift
6.3.2 `swift test` passed 113 tests; TypeScript/Bun fallback checks passed.

### Session: 2026-06-12 08:56

**Tasks Completed**: Step 7 review revision for TASK-001 package manifest
contracts and TASK-003 event contracts.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 review `comm-000012` reported two mid
findings: Swift package manifest metadata/validation parity gaps and event
validation parity gaps versus the TypeScript contracts.
**Notes**: Added TS-compatible manifest metadata fields, dependency string
decoding, add-on capabilities/content-digest validation, node-addon metadata
validation, file-change and s3-repository event source contracts, template
reference validation, and output-destination validation. Xcode Swift 6.3.2
`swift test` passed 113 tests; TypeScript/Bun fallback checks passed.

### Session: 2026-06-12 09:01

**Tasks Completed**: Step 6 self-review fail-closed manifest decoder hardening.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Implementation author self-review found newly
added and previously uncovered nested manifest DTOs could still ignore
unsupported keys.
**Notes**: Added unsupported-key rejection for add-on capabilities, workflow
metadata, integrity metadata, and signatures, plus deterministic decoder
regressions. Xcode Swift 6.3.2 `swift test` passed 113 tests; TypeScript/Bun
fallback checks passed.

### Session: 2026-06-12 09:10

**Tasks Completed**: Step 7 review revision for add-on capability grants and
event template dry-run mapping.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 review `comm-000016` reported two mid
findings: incomplete add-on capability/capabilityGrant parity and dry-run
input mapping that did not render TypeScript-compatible event templates.
**Notes**: Added capability name, defaultPolicy, sensitive reason, duplicate,
scope, and dependency capabilityGrant validation. Added event-input/template
dry-run mapping with event, source, and binding roots, exact-reference object
preservation, array traversal, and deterministic regressions. Xcode Swift 6.3.2
`swift test` passed 115 tests.

### Session: 2026-06-12 09:21

**Tasks Completed**: Step 7 review revision for event binding match contracts
and hook event-name catalog parity.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 review `comm-000020` reported two mid
findings: event binding dry-run matching omitted enabled/match rules and hook
event normalization omitted the full TypeScript hook event catalog.
**Notes**: Added EventBindingContract enabled and match rules with eventType,
conversationId, and pathPrefix dry-run matching. Expanded hook event
normalization to the full known TypeScript HookEventName catalog and added
deterministic regressions. Xcode Swift 6.3.2 `swift test` passed 117 tests.

### Session: 2026-06-12 09:24

**Tasks Completed**: Step 6 self-review optional enabled decoding fix.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Implementation author self-review found Swift
synthesized Decodable would require `enabled` on event sources and bindings,
even though the TypeScript event config treats it as optional.
**Notes**: Added custom decoding defaults for EventSourceContract.enabled and
EventBindingContract.enabled, plus a deterministic decoding regression. Xcode
Swift 6.3.2 `swift test` passed 118 tests.

### Session: 2026-06-12 09:32

**Tasks Completed**: Step 7 review revision for HookContext backward
decoding.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 review `comm-000024` reported one mid
finding: HookContext Codable decode required newly added non-optional fields
and broke pre-TASK-006 minimal JSON.
**Notes**: Added custom HookContext decoding defaults for vendor, eventName,
workingDirectory, and backendMetadata, plus a deterministic regression for the
pre-TASK-006 shape. Xcode Swift 6.3.2 `swift test` passed 119 tests.

### Session: 2026-06-12 09:45

**Tasks Completed**: Step 7 review revision for event binding and input
mapping TypeScript parity.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 review `comm-000028` reported two mid
findings: EventBindingContract required `workflowId` instead of TypeScript
`workflowName`, and dry-run input mapping accepted unsupported merge fallback
while omitting `outputDestinations` runtime-variable evidence.
**Notes**: Added workflowName/execution-mode binding contracts, typed
event-input/template input mapping decoding, workflowName validation exceptions
for supervisor-dispatch and schedule-registration, outputDestinations dry-run
runtime variables, and deterministic regressions. Xcode Swift 6.3.2
`swift test` passed 120 tests.

### Session: 2026-06-12 09:55

**Tasks Completed**: Step 7 review revision for event runtime variables,
GraphQL schema contract, and hook context resolution parity.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 review `comm-000032` reported three mid
findings: event dry-run runtime variables omitted humanInput and
eventMailboxBridgePolicy, GraphQL schemaContract omitted DTO inspection fields
and undefined ControlPlaneResult, and hook context resolution missed Rielflow
env context plus invalid recording/capture validation.
**Notes**: Added humanInput mirroring and eventMailboxBridgePolicy runtime
variables, expanded schemaContract and schema assertions, added Rielflow hook
context resolver/env validation, and deterministic regressions. Xcode Swift
6.3.2 `swift test` passed 125 tests.

### Session: 2026-06-12 10:09

**Tasks Completed**: Step 7 review revision for add-on execution-artifact
validation and authored event mailbox bridge policy.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 review `comm-000036` reported two mid
findings: add-on manifest validation did not preserve TypeScript
execution-artifact safety, and EventBindingContract omitted authored
mailboxBridge policy overrides.
**Notes**: Tightened add-on source/execution artifact path and descriptor
validation, added authored EventMailboxBridgePolicy decoding and dry-run
application, and added deterministic regressions. Xcode Swift 6.3.2
`swift test` passed 129 tests.

### Session: 2026-06-12 10:21

**Tasks Completed**: Step 7 review revision for TypeScript-shaped event
source config, mailboxBridge validation, and GraphQL envelope parsing.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 review `comm-000040` reported three mid
findings: EventSourceContract missed TypeScript webhook/S3 keys, mailboxBridge
consumer compatibility validation was missing, and GraphQL envelope parsing
did not trim/normalize query, operationName, and variables like TypeScript.
**Notes**: Added TypeScript-shaped webhook and nested S3 event source
decode/encode support, mailboxBridge consumer mode validation, GraphQL query
and operationName trimming plus variables null normalization, and deterministic
regressions. Xcode Swift 6.3.2 `swift test` passed 131 tests.

### Session: 2026-06-12 10:32

**Tasks Completed**: Step 7 review revision for effective event HTTP route
validation and server ambient manager environment stripping.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 review `comm-000044` reported three mid
findings: event route conflict validation ignored effective S3/default HTTP
paths, webhook and S3 required-field validation was incomplete, and server
context sanitization leaked ambient workflow execution keys.
**Notes**: Added effective event HTTP path resolution for webhook and
s3-repository sources, route conflict validation across explicit and default
paths, required webhook path and S3 eventReceiver validation, ambient workflow
environment stripping in ServerRequestContext, and deterministic regressions.
Xcode Swift 6.3.2 `swift test` passed 132 tests.

### Session: 2026-06-12 10:48

**Tasks Completed**: Step 7 adversarial review revision for package bundle
existence validation and chat-sdk webhook route parity.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000049`
reported two mid findings: workflow package manifest validation ignored
`packageRoot` and accepted missing `workflow.json` bundles, and event HTTP
path resolution omitted chat-sdk webhook routes from conflict detection.
**Notes**: Added non-destructive `workflow.json` file existence validation to
`FileWorkflowPackageManifestLoader.validate`, added TypeScript-shaped
chat-sdk `webhook` decode/encode and effective route conflict validation, and
added deterministic regressions. Xcode Swift 6.3.2 `swift test` passed 135
tests.

### Session: 2026-06-12 10:52

**Tasks Completed**: Step 6 self-review hardening for chat-sdk webhook
required-field parity.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 6 self-review after `comm-000050`
confirmed `comm-000049` was fixed and tightened chat-sdk validation to reject
missing webhook configuration before independent review.
**Notes**: Added `hasChatWebhook` tracking, required chat-sdk webhook/path/auth
diagnostics, updated chat dry-run fixtures to use valid webhook contracts, and
re-ran targeted and full Swift tests. Xcode Swift 6.3.2 `swift test` passed
135 tests.

### Session: 2026-06-12 11:04

**Tasks Completed**: Step 7 adversarial review revision for hook metadata
redaction and duplicate-safe server header normalization.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000054`
reported two mid findings: `HookParsing.parse` copied raw sensitive hook
payloads into public `HookContext.backendMetadata`, and server header
normalization could trap on duplicate mixed-case headers.
**Notes**: Redacted parsed hook backendMetadata with the existing hook
redaction policy, replaced header normalization with deterministic duplicate
handling, and added focused regressions. Xcode Swift 6.3.2 `swift test`
passed 137 tests.

### Session: 2026-06-12 11:18

**Tasks Completed**: Step 7 review revision for chat-sdk provider and event
type capability validation parity.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 review `comm-000058` reported one mid
finding: chat-sdk event validation accepted missing or unsupported providers
and did not reject binding `match.eventType` values unsupported by the
TypeScript chat-sdk provider capability set.
**Notes**: Added Swift chat-sdk provider validation for the TypeScript provider
set, provider event-type capability validation for binding `match.eventType`,
and deterministic validation and dry-run regressions. Xcode Swift 6.3.2
`swift test` passed 141 tests.

### Session: 2026-06-12 11:46

**Tasks Completed**: Step 7 review revision for top-level chat-sdk binding
`eventType` capability validation.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 review `comm-000062` reported one mid
finding: chat-sdk capability validation checked only binding `match.eventType`
while dry-run matching also honors top-level `EventBindingContract.eventType`.
**Notes**: Applied the same provider capability validation to top-level
chat-sdk binding `eventType`, and added deterministic validation and dry-run
regressions for unsupported top-level chat-sdk event types. Xcode Swift 6.3.2
`swift test` passed 143 tests.

### Session: 2026-06-12 11:58

**Tasks Completed**: Step 7 adversarial review revision for local-only package
manifest loading and canonical hook payload hashes.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000067`
reported two mid findings: `FileWorkflowPackageManifestLoader` accepted
non-file URLs through `Data(contentsOf:)`, and hook payload hashes depended on
unsorted JSON encoder dictionary output.
**Notes**: Added deterministic non-file URL rejection before manifest reads,
canonicalized hook payload hash encoding with sorted JSON keys, and added
focused regressions. Xcode Swift 6.3.2 `swift test` passed 145 tests.

### Session: 2026-06-12 12:09

**Tasks Completed**: Step 7 review revision for manifest tag presence and
package-relative traversal rejection.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 review `comm-000071` reported two mid
findings: manifest decoding defaulted missing `tags` to `[]` without
validation, and `normalizePackageRelativePath` accepted `..` segments such as
`a/..`.
**Notes**: Added decoded tag-field tracking for top-level and workflow metadata
manifests, tag validation for missing and empty entries, and fail-closed
package-relative path normalization for any raw `..` segment. Added focused
regressions for missing tags, empty tags, and `a/..` plus `a/../b` traversal.
Xcode Swift 6.3.2 `swift test` passed 146 tests.

### Session: 2026-06-12 12:12

**Tasks Completed**: Step 6 self-review hardening for null tag decoding.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 6 self-review confirmed `comm-000071` was
fixed and tightened tag decoding to reject explicit JSON `null`, matching the
TypeScript manifest requirement that `tags` must be an array of strings.
**Notes**: Changed decoded tag handling to decode `[String]` when the field is
present instead of accepting `null` through `decodeIfPresent`, and added
regressions for top-level and workflow metadata `tags: null`. Xcode Swift
6.3.2 `swift test` passed 147 tests.

### Session: 2026-06-12 12:23

**Tasks Completed**: Step 7 adversarial review revision for continue-session
GraphQL input contract parity.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000076`
reported one mid finding: `schemaContract` exposed `continueSession` without a
request input payload argument even though `GraphQLContinueSessionRequest`
carries `input`.
**Notes**: Added `ContinueSessionInput` to the Swift GraphQL schema contract
with `workflowId`, `sessionId`, and `input: JSONObject!`, changed
`continueSession` to accept that structured input object, and added schema
regressions that fail if the old no-input mutation signature returns. Xcode
Swift 6.3.2 `swift test` passed 147 tests.

### Session: 2026-06-12 12:33

**Tasks Completed**: Step 7 adversarial review revision for add-on built-in
source trust and portable package-relative path validation.
**Tasks In Progress**: None for this focused TASK-006 slice.
**Blockers**: None.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000081`
reported two mid findings: `DeterministicAddonResolver` allowed package
add-ons to spoof built-in names through `allowedBuiltins`, and
`normalizePackageRelativePath` did not reject Windows absolute paths.
**Notes**: Required built-in resolution to have trusted `source.builtin`
metadata and an allowed built-in name, rejected Windows absolute paths in
general package-relative path normalization, and added focused regressions for
built-in spoofing plus `C:\...` and UNC path rejection. Xcode Swift 6.3.2
`swift test` passed 149 tests.
