# Swift Native Migration Implementation Plan

**Status**: In Progress
**Design Reference**: `design-docs/specs/design-swift-native-migration.md`
**Created**: 2026-06-11
**Last Updated**: 2026-06-12

## Design Reference

Source of truth:

- `design-docs/specs/design-swift-native-migration.md#goal`
- `design-docs/specs/design-swift-native-migration.md#architecture`
- `design-docs/specs/design-swift-native-migration.md#runtime-contracts-to-preserve`
- `design-docs/specs/design-swift-native-migration.md#reference-mapping`
- `design-docs/specs/design-swift-native-migration.md#official-sdk-adapter-parity-slice`
- `design-docs/specs/design-swift-native-migration.md#cursor-cli-behavior-boundary`
- `design-docs/specs/design-swift-native-migration.md#task-005-runtime-session-message-store-and-publication-boundary`
- `design-docs/specs/design-swift-native-migration.md#migration-strategy`
- `design-docs/specs/design-swift-native-migration.md#verification-gates`
- `design-docs/specs/architecture.md`
- `design-docs/user-qa/qa-swift-native-migration.md`

Implement the accepted Swift native migration design as an additive branch-local
runtime migration. The TypeScript/Bun runtime remains the production fallback
until Swift parity gates pass. The plan preserves current package and add-on
responsibilities as SwiftPM targets where practical and brings
`codex-agent`, `claude-code-agent`, and `cursor-cli-agent` into this repository
as first-class Swift targets.

In scope:

- Keep `Package.swift` and target boundaries aligned with current Rielflow
  package ownership.
- Port core workflow JSON model and validation contracts before runtime and
  adapter expansion.
- Keep backend strings stable: `codex-agent`, `claude-code-agent`,
  `cursor-cli-agent`, `official/openai-sdk`, `official/anthropic-sdk`, and
  `official/cursor-sdk`.
- Port agent adapter dispatch through `RielflowAdapters`, with backend-specific
  behavior isolated in `CodexAgent`, `ClaudeCodeAgent`, and `CursorCLIAgent`.
- Keep Cursor CLI behavior isolated from provider-neutral contracts and from
  `official/cursor-sdk`.
- Port `official/openai-sdk` and `official/anthropic-sdk` registration,
  request construction, API-key handling, retry/error normalization, and output
  normalization through `RielflowAdapters`.
- Port deterministic CLI validation, inspect, and mock run flows before release
  packaging cutover.
- Add fixture parity tests using existing workflow JSON, node JSON, package
  manifests, event bindings, and hook snippets.

Out of scope for this plan:

- Removing the TypeScript/Bun runtime before Swift parity gates pass.
- Native macOS UI work before CLI/runtime parity is testable.
- Live LLM credential tests for agent adapters.
- Porting `official/cursor-sdk` except for a separately gated compatibility
  shim if parity requires it.

## Issue Reference

- Workflow mode: `issue-resolution`
- Workflow ID: `codex-design-and-implement-review-loop`
- Current workflow session:
  `riel-codex-design-and-implement-review-loop-1781211309-5fe4a54a`
- Earlier TASK-004 workflow session:
  `riel-codex-design-and-implement-review-loop-1781203096-8dcd5023`
- Current planning nodes: `step4-impl-plan-create`,
  `step4-impl-plan-self-review`
- Repository: `tacogips/rielflow`
- Issue title: `Port Swift runtime session and message publication boundary`
- GitHub issue: none supplied by runtime input
- Branch: `swift-migration`
- Risk level: high; adversarial implementation review required before cutover

Workflow execution note:

- Current TASK-005 planning run
  `riel-codex-design-and-implement-review-loop-1781211309-5fe4a54a` scopes the
  next implementation step to the Swift runtime-owned session, workflow
  message store, candidate-path publication, and output-validation boundary.
- Step 3 design review accepted the TASK-005 design update with no findings.
- The previous TASK-004 official OpenAI/Anthropic SDK and local-agent
  command-builder/readiness slices remain completed and are not reopened by
  this plan revision.

## Codex Agent References

- `codex-agent`: preferred local root `../../codex-agent`; unavailable in this
  checkout, so use current TypeScript adapter behavior and pinned package
  metadata as the authoritative local reference until a Swift reference is
  supplied.
- `packages/rielflow-adapters/src/codex.ts`
- `packages/rielflow-adapters/src/claude.ts`
- `packages/rielflow-adapters/src/cursor.ts`
- `packages/rielflow-adapters/src/readiness.ts`
- `packages/rielflow-adapters/src/dispatch.ts`
- `packages/rielflow-adapters/src/shared.ts`
- `packages/rielflow/src/workflow/runtime-readiness-agent-probes.ts`
- `packages/rielflow/src/workflow/validate/node-executability-validation.ts`
- `packages/rielflow-adapters/src/openai-sdk.ts`
- `packages/rielflow-adapters/src/anthropic-sdk.ts`
- `packages/rielflow-adapters/src/cursor-sdk.ts`
- `packages/rielflow/src/workflow/runtime-db.ts`
- `packages/rielflow/src/workflow/runtime-db/message-types.ts`
- `packages/rielflow/src/workflow/runtime-db/workflow-message-records.ts`
- `packages/rielflow/src/workflow/runtime-execution-contracts.ts`
- `packages/rielflow/src/workflow/output-attempt-runner.ts`
- `packages/rielflow/src/workflow/adapter.ts`
- `packages/rielflow/src/workflow/engine/workflow-runner.ts`
- `packages/rielflow/src/workflow/engine/step-result-finalization.ts`
- `packages/rielflow/src/workflow/engine/result-finalization.ts`
- `packages/rielflow/src/workflow/engine/mailbox-communication-artifacts.ts`
- `design-docs/specs/design-sqlite-message-store.md`
- `design-docs/specs/design-node-output-contract.md`
- `impl-plans/completed/swift-native-migration-task-005-runtime-session.md`
- `packages/rielflow-adapters/package.json`
- Existing Swift scaffold:
  - `Package.swift`
  - `Sources/RielflowCore/AdapterContracts.swift`
  - `Sources/RielflowCore/WorkflowModel.swift`
  - `Sources/RielflowAdapters/LocalAgentProcess.swift`
  - `Sources/CodexAgent/CodexAgentAdapter.swift`
  - `Sources/ClaudeCodeAgent/ClaudeCodeAgentAdapter.swift`
  - `Sources/CursorCLIAgent/CursorCLIAgentAdapter.swift`

Intentional divergences accepted by design:

- Swift splits repository-owned agent integrations into independent SwiftPM
  targets rather than importing npm packages.
- `CursorCLIAgent` maps only `cursor-cli-agent`; `official/cursor-sdk` remains a
  separate adapter slice.
- `official/openai-sdk` and `official/anthropic-sdk` stay in
  `RielflowAdapters` as official SDK adapter infrastructure rather than in the
  repository-owned local agent targets.
- Swift adapters may normalize provider output, but runtime output publication,
  candidate-path handling, workflow message delivery, and output validation stay
  runtime-owned.

## Modules

### 1. Swift Package Boundary Scaffold

#### `Package.swift`
#### `Sources/*`
#### `Tests/*`

**Status**: COMPLETED

```swift
public enum ExecutionBackend: String, Codable, Sendable {
  case codexAgent = "codex-agent"
  case claudeCodeAgent = "claude-code-agent"
  case cursorCliAgent = "cursor-cli-agent"
  case officialOpenAISDK = "official/openai-sdk"
  case officialAnthropicSDK = "official/anthropic-sdk"
  case officialCursorSDK = "official/cursor-sdk"
}
```

**Checklist**:

- [x] Define SwiftPM targets matching current package/add-on ownership.
- [x] Add placeholder targets for package boundaries not yet ported.
- [x] Add first core model, adapter contracts, and injected process runner
      scaffold.
- [x] Add initial tests for model decoding, backend normalization, adapter
      utilities, and agent adapter injection.

### 2. Core Workflow Model And Validation

#### `Sources/RielflowCore/WorkflowModel.swift`
#### `Sources/RielflowCore/WorkflowValidation.swift`
#### `Tests/RielflowCoreTests/*`

**Status**: COMPLETED

```swift
public struct WorkflowDefinition: Codable, Equatable, Sendable {
  public var name: String
  public var nodes: [WorkflowNode]
  public var start: String?
}

public struct WorkflowValidationDiagnostic: Equatable, Sendable {
  public var severity: WorkflowValidationSeverity
  public var path: String
  public var message: String
}

public protocol WorkflowValidating: Sendable {
  func validate(_ workflow: WorkflowDefinition) -> [WorkflowValidationDiagnostic]
}
```

**Checklist**:

- [x] Port initial step-addressed workflow JSON shape from TypeScript fixtures.
- [x] Preserve backend identifiers and authored JSON field names.
- [x] Port initial validation diagnostics needed by `workflow validate`.
- [x] Add fixture compatibility tests against existing workflow examples.
- [x] Preserve addon-only workflow registry nodes without fabricated node JSON
      paths.
- [x] Reject unsafe workflow-relative `nodeFile` and `stepFile` paths before
      materialization.
- [x] Apply workflow-relative path validation to both raw data and typed
      `AuthoredWorkflowJSON` validation entrypoints.
- [x] Enforce typed workflow semantic constraints before materialization so
      unsafe node ids cannot synthesize traversal `nodeFile` paths.
- [x] Run `swift test` in a Swift-capable environment.

### 3. Prompt And JSON Boundary Contracts

#### `Sources/RielflowCore/PromptTemplate.swift`
#### `Sources/RielflowCore/JSONValue.swift`
#### `Sources/RielflowAdapters/AdapterUtilities.swift`
#### `Tests/RielflowCoreTests/*`
#### `Tests/RielflowAdaptersTests/*`

**Status**: IN_PROGRESS

```swift
public protocol PromptRendering: Sendable {
  func render(template: String, variables: JSONObject) throws -> String
}

public struct OutputContractEnvelope: Codable, Equatable, Sendable {
  public var completionPassed: Bool
  public var when: [String: Bool]
  public var payload: JSONObject
}
```

**Checklist**:

- [x] Port basic prompt template rendering for dotted JSON object paths.
- [ ] Port prompt asset loading contracts.
- [x] Preserve initial JSON boundary behavior for authored payloads and output
      envelopes.
- [ ] Add deterministic tests for escaped variables, missing variables, and
      envelope normalization.

### 4. Backend-Faithful Agent And Official SDK Adapters

#### `Sources/RielflowAdapters/DispatchingNodeAdapter.swift`
#### `Sources/RielflowAdapters/LocalAgentProcess.swift`
#### `Sources/RielflowAdapters/OfficialSDKAdapters.swift`
#### `Sources/CodexAgent/CodexAgentAdapter.swift`
#### `Sources/ClaudeCodeAgent/ClaudeCodeAgentAdapter.swift`
#### `Sources/CursorCLIAgent/CursorCLIAgentAdapter.swift`
#### `Tests/AgentAdapterTests/*`
#### `Tests/RielflowAdaptersTests/*`

**Status**: IN_PROGRESS

```swift
public protocol AgentReadinessChecking: Sendable {
  func checkReadiness(for backend: ExecutionBackend) async -> AgentReadiness
}

public protocol AgentCommandBuilding: Sendable {
  func command(for input: AdapterExecutionInput) throws -> LocalAgentProcessConfiguration
}

public protocol OfficialSDKRequestExecuting: Sendable {
  func executeSDKRequest(_ input: AdapterExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput
}

public struct OfficialSDKAdapterConfiguration: Sendable {
  public var apiKeyEnv: String?
  public var baseURL: URL?
  public var retryPolicy: RetryPolicy
}
```

**Checklist**:

- [x] Replace generic subprocess argv with backend-faithful command builders.
- [x] Drain local agent stdout/stderr concurrently and enforce
      `AdapterExecutionContext.deadline` by terminating timed-out child
      processes.
- [x] Return deadline timeouts without waiting for stdout/stderr EOF and
      schedule SIGKILL escalation for TERM-resistant children.
- [x] Launch local agent subprocesses in their own process group and signal the
      group on deadline with direct-PID fallback.
- [x] Gate output-envelope parsing on `input.node.output`; no-contract stdout
      remains text payload even when it contains JSON-looking examples.
- [x] Reject plain text stdout for output-contracted local agents by requiring
      JSON object parsing and output-envelope normalization.
- [x] Close child-unused pipe descriptors during `posix_spawn` setup so
      stdin-consuming agents can observe EOF.
- [x] Add provider-neutral official SDK adapter infrastructure under
      `RielflowAdapters`, with injected request executors/client factories and
      no dependency from `CodexAgent`, `ClaudeCodeAgent`, or `CursorCLIAgent`.
- [x] Register `official/openai-sdk` and `official/anthropic-sdk` default Swift
      adapter factories in `DispatchingNodeAdapter`, while preserving
      deterministic missing-registration behavior for unregistered backends.
- [x] Port OpenAI Responses request construction from `openai-sdk.ts`: model
      from `input.node.model`, `input` from `input.promptText`, optional
      `instructions` from `input.systemPromptText`, provider
      `official-openai-sdk`, `OPENAI_API_KEY` / configured-env lookup, optional
      base URL propagation, retry policy, deadline timeout handling, provider
      error normalization, credential redaction, response text extraction from
      `output_text` then `output[].content[].type == "output_text"`, and output
      envelope normalization.
- [x] Port Anthropic Messages request construction from `anthropic-sdk.ts`:
      model from `input.node.model`, default `max_tokens: 1024` clamped to at
      least `1`, optional `system` from `input.systemPromptText`, one user
      message from `input.promptText`, provider `official-anthropic-sdk`,
      `ANTHROPIC_API_KEY` / configured-env lookup, optional base URL
      propagation, retry policy, deadline timeout handling, provider error
      normalization, credential redaction, response text extraction from
      `content[].type == "text"`, and output envelope normalization.
- [x] Port readiness and auth failure categories from `readiness.ts`.
- [x] Port deterministic runtime-readiness probe summaries from
      `runtime-readiness-agent-probes.ts` where Swift APIs currently expose
      validation/preflight behavior.
- [x] Keep Cursor modes, stream formats, probes, and SDK compatibility inside
      `CursorCLIAgent`.
- [x] Explicitly keep `official/cursor-sdk` deferred unless a minimal
      compatibility shim is required for parity and separately reviewed.
- [x] Redact credentials from adapter failures.
- [x] Test local agents through injected process runners and official SDKs
      through injected request executors/client factories; no live credentials,
      network access, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or
      `CURSOR_API_KEY` are required.

**Completed TASK-004 Slice: Local Agent Command Builder And Readiness Parity**

| Step | Scope | Deliverables | Verification |
| ---- | ----- | ------------ | ------------ |
| TASK-004E | Shared local-agent command boundary | Replace `LocalAgentCommandAdapter`'s generic `executableName + baseArguments + --model` construction with an injectable Swift command-builder protocol/configuration in `Sources/RielflowAdapters/LocalAgentProcess.swift`. Shared code may prepare prompts, resolve image attachments from runtime arguments/merged variables, execute `LocalAgentProcessConfiguration`, normalize output contracts, enforce deadlines, and redact failures, but it must not infer backend-specific argv. | `Tests/AgentAdapterTests/*` asserts exact executable, argv, environment overlay, working directory, stdin prompt, deadline propagation, provider string, output-contract handling, image forwarding/dedupe/disabled policy, and stderr redaction through injected runners. |
| TASK-004F | Codex command builder and auth preflight | `Sources/CodexAgent/CodexAgentAdapter.swift` owns `codex exec --json`, model propagation, Codex effort as `model_reasoning_effort="<effort>"`, supported additional args from Swift input contracts, Codex auth preflight, and existing Codex JSONL final-assistant normalization. | Tests prove Codex argv/config isolation, failed login -> `policy_blocked`, no live `codex` binary or credentials required, and provider remains `codex-agent`. |
| TASK-004G | Claude and Cursor command builders | `Sources/ClaudeCodeAgent/ClaudeCodeAgentAdapter.swift` owns Claude print-mode argv (`-p`, `--output-format text`, `--model`, effort, permission mode, supported attachment directory flags, additional args) and Claude CLI/auth preflight. `Sources/CursorCLIAgent/CursorCLIAgentAdapter.swift` owns Cursor headless argv (`--print`, `--output-format stream-json`, `--model`, optional non-default mode, supported image/additional args, `--`, prompt), model probe argv (`--output-format text`), and auth/model readiness interpretation without unsupported CLI flags. | Tests prove exact Claude and Cursor argv/config shapes, unavailable CLI/auth/model probes -> `policy_blocked` preflight failures, Cursor concepts stay out of `RielflowCore`, provider-neutral adapters, `official/cursor-sdk`, add-ons, GraphQL, events, and server targets. |
| TASK-004H | Swift readiness model and runtime-readiness parity | Add deterministic Swift readiness types/APIs for `available`, `unavailable`, `unknown`, and `not_checked` tool/auth/model states, plus injectable probe operations that map the practical behavior from `packages/rielflow-adapters/src/readiness.ts` and `packages/rielflow/src/workflow/runtime-readiness-agent-probes.ts`: Codex/Git/Claude/Cursor tool summaries, source step ids, model-specific reachability messages, Codex account readiness, Claude auth/model checks, and Cursor unknown auth when no stable local auth command exists. | Unit tests use injected probe operations only; no live CLI tools, network, npm package installs, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `CURSOR_API_KEY` are required. Tests cover validation invalid/unknown results and adapter preflight `policy_blocked` failures separately. |

The implementation step must keep official SDK behavior out of this remaining
slice. `official/openai-sdk` and `official/anthropic-sdk` are already ported;
`official/cursor-sdk` remains explicitly deferred unless separately scoped and
reviewed. Backend-specific command flags and readiness interpretation belong in
`CodexAgent`, `ClaudeCodeAgent`, or `CursorCLIAgent`; `RielflowAdapters` owns
only provider-neutral runner, deadline, redaction, and output normalization
contracts.

### 5. Runtime Session, Message Store, And Output Publication

#### `Sources/RielflowCore/*`
#### `Sources/RielflowCLI/*`
#### `Tests/RielflowCoreTests/*`

**Status**: COMPLETED

```swift
public protocol WorkflowSessionStore: Sendable {
  func createSession(_ input: WorkflowSessionCreateInput) async throws -> WorkflowSession
  func appendMessage(_ message: WorkflowMessageRecord) async throws
  func loadSession(id: String) async throws -> WorkflowSession?
}
```

**Checklist**:

- [x] Port the runtime-owned session and workflow message boundary.
- [x] Preserve candidate-path handling as runtime-owned publication behavior.
- [x] Cover runtime-owned candidate-path provisioning, pre-attempt clearing,
      and post-attempt cleanup or ignore semantics.
- [x] Avoid legacy execution-local inbox/outbox message contracts.
- [x] Add tests for output validation, message publication, and failure paths.
- [x] Execute the focused plan in
      `impl-plans/completed/swift-native-migration-task-005-runtime-session.md`.

### 6. Add-on, Package, Event, Hook, GraphQL, And Server Boundaries

#### `Sources/RielflowAddons/*`
#### `Sources/RielflowEvents/*`
#### `Sources/RielflowHook/*`
#### `Sources/RielflowGraphQL/*`
#### `Sources/RielflowServer/*`
#### `Tests/*`

**Status**: NOT_STARTED

```swift
public protocol AddonExecuting: Sendable {
  func execute(_ input: AddonExecutionInput) async throws -> AddonExecutionOutput
}

public protocol WorkflowPackageLoading: Sendable {
  func loadPackageManifest(at url: URL) throws -> WorkflowPackageManifest
}
```

**Checklist**:

- [ ] Port declarative add-on execution boundaries without engine-internal
      leakage.
- [ ] Port package manifest validation and workflow package loading needed by
      parity tests.
- [ ] Port event trigger dry-run contracts and hook context parsing.
- [ ] Keep GraphQL/server inspection behavior behind the same public contracts.

### 7. CLI Parity Slice

#### `Sources/RielflowCLI/main.swift`
#### `Tests/RielflowCLITests/*`

**Status**: NOT_STARTED

```swift
public enum RielflowCLICommand: Equatable, Sendable {
  case workflowValidate(WorkflowValidateOptions)
  case workflowInspect(WorkflowInspectOptions)
  case workflowRun(WorkflowRunOptions)
}
```

**Checklist**:

- [ ] Implement `workflow validate` using Swift validation contracts.
- [ ] Implement `workflow inspect` using Swift workflow loading contracts.
- [ ] Implement deterministic `workflow run` without live agent calls.
- [ ] Keep TypeScript CLI fallback documented until parity gates pass.

### 8. Packaging And Release Cutover Readiness

#### `Package.swift`
#### `packaging/homebrew/*`
#### `README.md`
#### `design-docs/user-qa/qa-swift-native-migration.md`

**Status**: NOT_STARTED

```swift
public struct SwiftReleaseArtifact: Equatable, Sendable {
  public var executableName: String
  public var archivePath: String
  public var checksum: String
}
```

**Checklist**:

- [ ] Define Swift executable artifact path and archive naming.
- [ ] Keep Homebrew cutover blocked until validation, inspect, run, package,
      event, GraphQL, hook, adapter, and macOS archive gates pass.
- [ ] Refresh user-facing docs for the final cutover contract.
- [ ] Do not remove TypeScript release path until adversarial review accepts
      the cutover.

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Swift package boundary scaffold | `Package.swift`, `Sources/*`, `Tests/*` | COMPLETED | Initial scaffold tests present |
| Core workflow model and validation | `Sources/RielflowCore/WorkflowModel.swift`, `Sources/RielflowCore/WorkflowValidation.swift` | IN_PROGRESS | `Tests/RielflowCoreTests/*`; Xcode Swift 6.3.2 `swift test` passed for current scaffold |
| Prompt and JSON boundary contracts | `Sources/RielflowCore/PromptTemplate.swift`, `Sources/RielflowCore/JSONValue.swift`, `Sources/RielflowAdapters/AdapterUtilities.swift` | IN_PROGRESS | `Tests/RielflowCoreTests/*`, `Tests/RielflowAdaptersTests/*`; Xcode Swift 6.3.2 `swift test` passed for current scaffold |
| Backend-faithful agent and official SDK adapters | `Sources/CodexAgent/*`, `Sources/ClaudeCodeAgent/*`, `Sources/CursorCLIAgent/*`, `Sources/RielflowAdapters/*` | COMPLETED | `Tests/AgentAdapterTests/*`, `Tests/RielflowAdaptersTests/*`; Xcode Swift 6.3.2 `swift test` passed 65 tests for local-agent command builders, bounded preflights, Cursor/Codex stream normalization, Codex argv option termination, descriptor isolation, configured-secret redaction, readiness parity, and official OpenAI/Anthropic SDK scaffold |
| Runtime session and message publication | `Sources/RielflowCore/*`, `Sources/RielflowCLI/*` | COMPLETED | `Tests/RielflowCoreTests/*`; Xcode Swift 6.3.2 `swift test` passed 93 tests for TASK-005 in-memory runtime APIs |
| Add-on, package, event, hook, GraphQL, and server boundaries | `Sources/RielflowAddons/*`, `Sources/RielflowEvents/*`, `Sources/RielflowHook/*`, `Sources/RielflowGraphQL/*`, `Sources/RielflowServer/*` | NOT_STARTED | `Tests/*` |
| CLI parity slice | `Sources/RielflowCLI/main.swift` | NOT_STARTED | `Tests/RielflowCLITests/*` |
| Packaging and release cutover readiness | `packaging/homebrew/*`, `README.md`, `design-docs/user-qa/qa-swift-native-migration.md` | NOT_STARTED | macOS archive smoke checks |

## Task Breakdown

### TASK-001: Review And Stabilize Existing Swift Scaffold

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `Package.swift`, `Sources/*`, `Tests/*`
**Dependencies**: None

**Description**:
Keep the current uncommitted Swift scaffold as the additive baseline and align
it with accepted target boundaries.

**Completion Criteria**:

- [x] SwiftPM target split exists for core, add-ons, adapters, events, GraphQL,
      server, hook, CLI, and three agent targets.
- [x] Existing Swift scaffold remains additive and does not replace TypeScript
      runtime behavior.

### TASK-002: Port Core Workflow Model And Validation

**Status**: In Progress
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCore/WorkflowModel.swift`, `Sources/RielflowCore/WorkflowValidation.swift`, `Tests/RielflowCoreTests/*`
**Dependencies**: TASK-001

**Description**:
Port authored workflow JSON model and validation behavior needed by downstream
runtime, package, CLI, GraphQL, and event slices.

**Completion Criteria**:

- [x] Swift model covers representative existing workflow JSON fixture fields.
- [x] Swift validation diagnostics cover removed step-addressed top-level fields
      and broken step/node references.
- [x] Add-on-only workflow nodes remain declarative and do not require
      synthesized node JSON files.
- [x] Workflow-relative `nodeFile` and `stepFile` validation rejects absolute
      paths and `.` / `..` segments.
- [x] Public typed validation cannot bypass workflow-relative path guards.
- [x] Backend strings remain stable.
- [ ] `swift test` confirms the new fixture and diagnostic tests in a
      Swift-capable environment.

### TASK-003: Port Prompt, JSON, And Output Envelope Contracts

**Status**: In Progress
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCore/PromptTemplate.swift`, `Sources/RielflowCore/JSONValue.swift`, `Sources/RielflowAdapters/AdapterUtilities.swift`, `Tests/RielflowCoreTests/*`, `Tests/RielflowAdaptersTests/*`
**Dependencies**: TASK-001, TASK-002

**Description**:
Port prompt rendering, JSON boundary, and adapter envelope normalization so
agents and runtime output publication share one contract.

**Completion Criteria**:

- [ ] Prompt rendering fixture tests pass.
- [ ] Envelope normalization preserves `completionPassed`, `when`, and
      `payload`.
- [ ] Runtime publication remains outside backend adapters.

### TASK-004: Port Backend-Specific Agent And Official SDK Adapter Behavior

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/CodexAgent/*`, `Sources/ClaudeCodeAgent/*`, `Sources/CursorCLIAgent/*`, `Sources/RielflowAdapters/*`, `Tests/AgentAdapterTests/*`, `Tests/RielflowAdaptersTests/*`
**Dependencies**: TASK-003

**Description**:
Replace generic local command behavior with backend-faithful Codex, Claude, and
Cursor CLI adapters using injected process runners, and port
readiness/auth failure categories into deterministic Swift APIs. The
`official/openai-sdk` / `official/anthropic-sdk` parity portion of TASK-004 is
already complete; this remaining slice must not reopen it.

**Completion Criteria**:

- [x] `codex-agent`, `claude-code-agent`, and `cursor-cli-agent` command
      builders match TypeScript reference behavior.
- [x] Local CLI process runner drains stdout/stderr concurrently, honors adapter
      deadlines, terminates child process groups, closes child-unused pipe
      descriptors, cancels delayed SIGKILL only for non-timeout process reap,
      re-checks process-group liveness immediately before timeout SIGKILL,
      and redacts provider stderr before publication.
- [x] `codex-agent` local stdout normalization handles `codex exec --json` JSONL
      streams by selecting final assistant content before output-contract
      parsing.
- [x] `official/openai-sdk` and `official/anthropic-sdk` are registered in
      Swift dispatch with explicit no-live-credential tests.
- [x] OpenAI and Anthropic SDK adapters preserve request shape, API-key
      environment handling, base URL handling, retry/error normalization,
      timeout handling, output text extraction, and output envelope
      normalization.
- [x] Cursor-specific behavior does not leak into provider-neutral modules.
- [x] Readiness tests cover unavailable tools, auth failures, and policy-blocked
      states without credentials.
- [x] Runtime-readiness-style validation can report invalid or unknown Codex,
      Git, Claude, and Cursor tool/auth/model states without executing a
      workflow.

### TASK-005: Port Runtime Session And Message Publication Boundary

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCore/*`, `Sources/RielflowCLI/*`, `Tests/RielflowCoreTests/*`, `impl-plans/completed/swift-native-migration-task-005-runtime-session.md`
**Dependencies**: TASK-002, TASK-003

**Description**:
Port enough runtime session, message store, candidate-path, and output validation
behavior to support deterministic workflow execution.
Implementation detail is split into the focused TASK-005 plan so this parent
plan stays navigable while the runtime session/message boundary remains
traceable to the accepted design.

**Completion Criteria**:

- [x] Workflow messages are runtime-owned records, not adapter-owned outputs.
- [x] Runtime-owned message input resolution converts prior
      `WorkflowMessageRecord` rows into structured execution input before
      adapter execution and applies the merged payload to the
      `AdapterExecutionInput` boundary.
- [x] Candidate-path publication is tested through runtime boundaries.
- [x] Candidate-path lifecycle provisions and clears the reserved path before
      each attempt and cleans up or ignores staging after adapter return.
- [x] Runtime rejects candidate-path submissions that do not match the exact
      runtime reservation.
- [x] Runtime rejects ambiguous candidate sources so adapter output or inline
      candidates cannot bypass candidate-path reservations.
- [x] Runtime publication finalizes candidate-path staging after consuming the
      reserved candidate on success, validation failure, and append failure.
- [x] Runtime rejects unsafe candidate staging path components and refuses
      cleanup outside the configured staging root.
- [x] Runtime rejects candidate staging symlink escapes after directory
      creation resolves safe-looking path components.
- [x] Legacy execution-local inbox/outbox paths are not introduced.
- [x] Output-contract invalid JSON, invalid envelopes, schema failure, and
      `completionPassed: false` fail without publishing downstream messages.
- [x] Swift output-contract validation covers the TypeScript JSON Schema subset
      for nested objects/arrays, additionalProperties, enum, const,
      numeric/string bounds, strict integer checks, and combinators.
- [x] Swift output-contract validation rejects malformed schema definitions
      before payload validation, matching the TypeScript/Bun boundary for
      unsupported keywords, structure, bounds, pattern, and combinator checks.
- [x] Provider, `policy_blocked`, timeout, and invalid-output adapter failures
      fail the step without publishing downstream messages.
- [x] Unsupported cross-workflow, resume-step, and fanout transition semantics
      fail before accepted output or workflow message publication.
- [x] External root output publication is explicit root-scope/output-node
      metadata; terminal non-output steps do not publish workflow output.
- [x] Message input resolution includes only delivered or consumed rows and
      excludes created, failed, and superseded lifecycle rows.

### TASK-006: Port Package, Add-on, Event, Hook, GraphQL, And Server Contracts

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `Sources/RielflowAddons/*`, `Sources/RielflowEvents/*`, `Sources/RielflowHook/*`, `Sources/RielflowGraphQL/*`, `Sources/RielflowServer/*`, `Tests/*`
**Dependencies**: TASK-002, TASK-003, TASK-005

**Description**:
Port compatibility surfaces needed by parity gates while preserving add-on and
package boundaries.

**Completion Criteria**:

- [ ] Package validation and manifest loading parity tests pass.
- [ ] Event trigger dry-run and hook context parsing tests pass.
- [ ] GraphQL/server inspection contracts expose the same runtime state shape.

### TASK-007: Implement Swift CLI Parity Commands

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCLI/main.swift`, `Tests/RielflowCLITests/*`
**Dependencies**: TASK-004, TASK-005, TASK-006

**Description**:
Implement Swift `workflow validate`, `workflow inspect`, and deterministic
`workflow run` commands for parity testing.

**Completion Criteria**:

- [ ] Swift CLI validates the `codex-design-and-implement-review-loop` workflow.
- [ ] Swift CLI inspect output matches parity fixtures.
- [ ] Swift deterministic run works without live agent credentials.

### TASK-008: Wire Packaging And Documentation Cutover Gates

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: `packaging/homebrew/*`, `README.md`, `design-docs/user-qa/qa-swift-native-migration.md`
**Dependencies**: TASK-007

**Description**:
Prepare, but do not execute, release packaging cutover from TypeScript/Bun to
Swift executable artifacts.

**Completion Criteria**:

- [ ] macOS Swift archive path and executable name are documented.
- [ ] Homebrew cutover remains blocked until all parity gates pass.
- [ ] User-facing docs explain fallback and cutover constraints.

### TASK-009: Final Parity, Security, And Adversarial Review Handoff

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: verification logs, review notes, updated progress log
**Dependencies**: TASK-007, TASK-008

**Description**:
Run required verification, document residual risks, and hand the migration to
high-risk implementation review before any TypeScript removal or release switch.

**Completion Criteria**:

- [ ] TypeScript baseline verification still passes.
- [ ] Swift verification passes in a Swift-capable environment.
- [ ] Adversarial implementation review accepts the cutover plan or records
      blocking findings.

## Dependencies

| Task | Depends On | Reason |
| ---- | ---------- | ------ |
| TASK-001 | None | Existing additive scaffold baseline. |
| TASK-002 | TASK-001 | Core model depends on target scaffold. |
| TASK-003 | TASK-001, TASK-002 | Prompt and output contracts depend on core JSON model. |
| TASK-004 | TASK-003 | Backend adapters and official SDK adapters depend on prompt and envelope contracts. |
| TASK-005 | TASK-002, TASK-003 | Runtime session/message behavior depends on model and envelope contracts. |
| TASK-006 | TASK-002, TASK-003, TASK-005 | Package/add-on/event/GraphQL/server parity depends on runtime contracts. |
| TASK-007 | TASK-004, TASK-005, TASK-006 | CLI parity depends on adapters, runtime, and compatibility surfaces. |
| TASK-008 | TASK-007 | Packaging cutover readiness depends on CLI parity. |
| TASK-009 | TASK-007, TASK-008 | Final review depends on verified runtime and cutover gates. |

## Parallelization

No top-level implementation task is marked parallelizable. The accepted design
requires a single-path plan because core model, adapter contracts, agent targets,
runtime publication, package behavior, CLI parity, and release cutover are
dependency-coupled. After TASK-002 and TASK-003 are complete, subtests inside
TASK-004 may be split only after TASK-004E establishes the shared command
boundary. TASK-004F and TASK-004G may then run in parallel if write scopes stay
confined to backend-specific targets and matching `Tests/AgentAdapterTests/*`
sections. TASK-004H is not parallel with TASK-004E because shared readiness
types and adapter preflight errors cross provider-neutral boundaries.
TASK-005 is split into the focused plan
`impl-plans/completed/swift-native-migration-task-005-runtime-session.md`; that
plan starts sequential because its runtime store, candidate normalization,
validation, and publication APIs share `RielflowCore` type ownership.

## Verification Plan

Baseline commands:

- `git status --short --branch`
- `git diff --check`
- `bun run typecheck:server`
- `bun run lint:biome`
- `bun run packages/rielflow/src/bin.ts workflow validate codex-design-and-implement-review-loop --scope project`

Swift commands:

- `/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift --version`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift test`
- `swift run rielflow workflow validate codex-design-and-implement-review-loop --scope project`
- `swift run rielflow workflow inspect codex-design-and-implement-review-loop --scope project`
- `swift run rielflow workflow run examples/temporary-workflow/workflow.json --mock --output json`

Agent adapter checks:

- Unit tests must use injected process runners.
- Official SDK unit tests must use injected request executors or client
  factories and synthetic responses.
- No live LLM credentials are required.
- Failure output must redact credentials and command environment secrets.
- Dispatch tests must prove `codex-agent`, `claude-code-agent`,
  `cursor-cli-agent`, `official/openai-sdk`, and `official/anthropic-sdk`
  resolve to registered adapters.
- Official SDK tests must cover request construction, configured API-key
  environment names, base URL propagation, retry/error normalization, timeout
  handling, response text extraction, and output envelope normalization.
- TASK-004 official SDK planning check:
  `rg -n "TASK-004A|OpenAiSDKAdapter|AnthropicSDKAdapter|official/cursor-sdk"
  impl-plans/active/swift-native-migration.md`.
- TASK-004 local-agent planning check:
  `rg -n "TASK-004E|TASK-004F|TASK-004G|TASK-004H|runtime-readiness-agent-probes|AgentCommandBuilding|LocalAgentCommand" impl-plans/active/swift-native-migration.md`.
- TASK-004 implementation checks:
  `rg -n "AgentCommandBuilding|Readiness|policy_blocked|codex exec|--output-format|cursor-cli-agent" Sources Tests`.
  Add or update XCTest cases for exact backend argv, readiness categories,
  auth/model preflight failures, output-contract handling, deadline propagation,
  and credential redaction with injected runners/probes only.
- TASK-005 planning check:
  `rg -n "WorkflowSession|WorkflowMessageRecord|CandidatePathReading|RuntimeCandidatePathStaging|WorkflowOutputPublishing|completionPassed|RIEL_MAILBOX_DIR|inbox/input\\.json|outbox/output\\.json" impl-plans/completed/swift-native-migration-task-005-runtime-session.md`.
- TASK-005 implementation checks:
  `rg -n "WorkflowSession|WorkflowMessageRecord|CandidatePathReading|WorkflowOutputPublishing|completionPassed" Sources/RielflowCore Tests/RielflowCoreTests`.
  `rg -n "RuntimeCandidatePathStaging|prepareCandidatePath|finalizeCandidatePath|RuntimeCandidatePathReservation" Sources/RielflowCore Tests/RielflowCoreTests`.
  `rg -n "RIEL_MAILBOX_DIR|inbox/input\\.json|outbox/output\\.json|execution-local inbox|execution-local outbox" Sources Tests`.
  `rg -n "ambiguousCandidateSources|candidatePathReservationRequiresCandidatePath|finalizeCandidatePathIfNeeded|testPublicationFinalizesCandidatePathStagingAfter" Sources/RielflowCore Tests/RielflowCoreTests`.
  `rg -n "unsupportedTransition|unsupportedTransitionReason|testUnsupportedTransitionShapesFailBeforeAcceptedOutputAndMessages" Sources/RielflowCore Tests/RielflowCoreTests`.
  `rg -n "unsupported JSON Schema keyword|validateSchemaDefinition|validateSchemaNode|must be a non-empty array when provided" Sources/RielflowCore/RuntimeOutputValidation.swift Tests/RielflowCoreTests/RuntimeOutputValidationTests.swift`.
  Add deterministic XCTest coverage for runtime-generated communication ids,
  in-memory message append failures, candidate-path rejection, output-contract
  failure paths, candidate-path provisioning/clearing/cleanup lifecycle, and
  no-publication provider/policy/timeout failures.

Cutover checks:

- Package validation parity against existing package manifests.
- Event trigger dry-run parity.
- GraphQL manager-control inspection parity.
- Hook context parsing parity.
- macOS archive smoke test before Homebrew switch.

Current environment note:

- Xcode Swift 6.3.2 is available and `swift test` passed 45 tests with
  `DEVELOPER_DIR` and `SDKROOT` pointed at `/Applications/Xcode.app`.
- Default `swift` lookup can still point at a Nix Apple SDK path, so use the
  explicit Xcode toolchain command above until local toolchain selection is
  fixed.

## Completion Criteria

- [ ] All TASK-002 through TASK-009 criteria are complete.
- [ ] The Swift package compiles and `swift test` passes in a Swift-capable
      environment.
- [ ] TypeScript/Bun baseline verification remains green throughout migration.
- [ ] Swift CLI supports validation, inspect, and deterministic run parity.
- [ ] Agent adapters preserve backend strings, readiness behavior, output
      normalization, and credential redaction.
- [ ] `official/openai-sdk` and `official/anthropic-sdk` preserve dispatch
      registration, request construction, API-key handling, retry/error
      normalization, output normalization, and no-live-credential test coverage.
- [ ] `official/cursor-sdk` remains explicitly deferred unless separately
      scoped and reviewed.
- [ ] Cursor CLI behavior remains isolated in `CursorCLIAgent`.
- [ ] Runtime message publication and candidate-path behavior remain
      runtime-owned.
- [ ] Release/Homebrew cutover is documented and blocked until parity gates and
      adversarial review pass.
- [ ] `impl-plans/PROGRESS.json` and this progress log are updated as tasks
      change status.

## Progress Log

### Session: 2026-06-11 00:00

**Tasks Completed**: TASK-001
**Tasks In Progress**: None
**Blockers**: Swift toolchain unavailable in the current environment.
**Notes**: Step 4 revised the existing scaffold note into a task-addressed
implementation plan after Step 3 accepted the Swift migration design. No Step 5
feedback was present for this run. Step 4 self-review added the module status
table required for plan tracking before independent review.

### Session: 2026-06-11 00:30

**Tasks Completed**: None
**Tasks In Progress**: None
**Blockers**: Swift toolchain unavailable in the current environment.
**Notes**: Rerun after Step 5 review addressed the mid finding for missing
official SDK adapter parity by expanding TASK-004, module status, verification,
completion criteria, and references for `official/openai-sdk` and
`official/anthropic-sdk`. `official/cursor-sdk` remains explicitly deferred
unless separately scoped and reviewed. Step 4 self-review aligned TASK-004
deliverables and optional split guidance with the official SDK test scope.

### Session: 2026-06-11 01:10

**Tasks Completed**: None
**Tasks In Progress**: TASK-002
**Blockers**: Swift toolchain unavailable in the current environment, so
`swift test` cannot confirm TASK-002 completion locally.
**Notes**: Step 6 implemented the first Swift core workflow validation slice:
expanded `WorkflowModel.swift` for step fanout/session/prompt/registry fields,
added `WorkflowValidation.swift` with step-addressed schema diagnostics and
normalized `WorkflowDefinition` materialization, and added
`RielflowCoreTests` coverage for the project
`codex-design-and-implement-review-loop` workflow fixture plus removed
top-level `edges` and broken step/node references.

### Session: 2026-06-11 01:35

**Tasks Completed**: None
**Tasks In Progress**: TASK-002
**Blockers**: Swift toolchain unavailable in the current environment, so
`swift test` cannot confirm TASK-002 completion locally.
**Review Feedback Addressed**: Step 7 mid finding in
`Sources/RielflowCore/WorkflowValidation.swift` for fabricated `nodeFile`
paths on addon-only nodes.
**Notes**: Updated `WorkflowNodeRef.nodeFile` to be optional, changed
`materializeWorkflowDefinition` so addon-only registry entries preserve addon
metadata without synthesizing `nodes/<id>.json`, and added
`RielflowCoreTests` fixture assertions that `step10-git-commit` and
`step11-git-push` stay addon-backed in the
`codex-design-and-implement-review-loop` workflow.

### Session: 2026-06-11 02:05

**Tasks Completed**: None
**Tasks In Progress**: TASK-002
**Blockers**: Swift toolchain unavailable in the current environment, so
`swift test` cannot confirm TASK-002 completion locally.
**Review Feedback Addressed**: Step 7 adversarial mid finding in
`Sources/RielflowCore/WorkflowValidation.swift` for missing workflow-relative
path guards on `nodeFile` and `stepFile`.
**Notes**: Added Swift validation for workflow-relative file paths that rejects
absolute paths, Windows absolute paths, empty paths, and `.` / `..` segments
before materialization. Added `RielflowCoreTests` regression coverage for
unsafe `nodeFile` and `stepFile` values plus accepted safe paths.

### Session: 2026-06-11 02:30

**Tasks Completed**: None
**Tasks In Progress**: TASK-002
**Blockers**: Swift toolchain unavailable in the current environment, so
`swift test` cannot confirm TASK-002 completion locally.
**Review Feedback Addressed**: Step 7 mid finding in
`Sources/RielflowCore/WorkflowValidation.swift` for typed
`validateAuthoredWorkflowJSON` bypassing the new `nodeFile` / `stepFile` path
guards.
**Notes**: Added shared typed path-safety validation before
`materializeWorkflowDefinition` and expanded `RielflowCoreTests` to call
`validateAuthoredWorkflowJSON` directly with unsafe `nodeFile` and `stepFile`
values, asserting `workflow == nil` and matching diagnostics.

### Session: 2026-06-11 02:55

**Tasks Completed**: None
**Tasks In Progress**: TASK-002
**Blockers**: Swift toolchain unavailable in the current environment, so
`swift test` cannot confirm TASK-002 completion locally.
**Review Feedback Addressed**: Step 7 adversarial mid finding in
`Sources/RielflowCore/WorkflowValidation.swift` for typed workflows
synthesizing unsafe `nodeFile` paths from unsafe registry ids.
**Notes**: Expanded typed `AuthoredWorkflowJSON` validation to enforce
workflow id safety, safe and unique node ids, required `nodeFile` or addon
bindings, unique step ids, step node references, entry/manager references, and
typed transition/fanout diagnostics before materialization. Added
`RielflowCoreTests` coverage that an unsafe node id without `nodeFile` or addon
returns diagnostics and never materializes a workflow.

### Session: 2026-06-11 03:20

**Tasks Completed**: None
**Tasks In Progress**: TASK-002
**Blockers**: Swift toolchain unavailable in the current environment, so
`swift test` cannot confirm TASK-002 and adapter hardening locally.
**Review Feedback Addressed**: Step 7 adversarial mid finding in
`Sources/RielflowAdapters/LocalAgentProcess.swift` for subprocess pipe
deadlock and ignored `AdapterExecutionContext.deadline`.
**Notes**: Updated the local agent process runner to drain stdout and stderr on
background queues while the process is running, pass adapter deadlines into the
runner, terminate timed-out child processes, and surface timeout failures as
`AdapterExecutionError.timeout`. Added `AgentAdapterTests` regression coverage
for large stdout/stderr output and deadline termination.

### Session: 2026-06-12 00:12

**Tasks Completed**: None
**Tasks In Progress**: TASK-002
**Blockers**: Swift toolchain unavailable in the current environment, so
`swift test` cannot confirm TASK-002 and adapter hardening locally.
**Review Feedback Addressed**: Step 7 adversarial mid finding in
`Sources/RielflowAdapters/LocalAgentProcess.swift` for timeout completion
still waiting on stdout/stderr EOF when a process ignores TERM or a child keeps
pipe handles open.
**Notes**: Made timeout completion independent of process termination and pipe
EOF by closing pipe handles, resuming `AdapterExecutionError.timeout` from the
deadline work item, terminating the process, and scheduling SIGKILL escalation.
Added `AgentAdapterTests` coverage for a TERM-resistant command that keeps
stdout/stderr open and asserts timeout returns promptly.

### Session: 2026-06-12 00:32

**Tasks Completed**: None
**Tasks In Progress**: TASK-002
**Blockers**: Swift toolchain unavailable in the current environment, so
`swift test` cannot confirm TASK-002 and adapter hardening locally.
**Review Feedback Addressed**: Step 7 mid finding in
`Sources/RielflowAdapters/LocalAgentProcess.swift` for timeout cleanup only
signaling the direct process PID while spawned descendants could survive
outside workflow control.
**Notes**: Replaced the direct `Process` launch path with a `posix_spawn`
launch configured with `POSIX_SPAWN_SETPGROUP`, then changed timeout cleanup to
signal the child process group with direct-PID fallback. Added
`AgentAdapterTests` coverage that records a spawned child pid and verifies the
child process group member is terminated after adapter timeout.

### Session: 2026-06-12 00:45

**Tasks Completed**: None
**Tasks In Progress**: TASK-002
**Blockers**: Swift toolchain unavailable in the current environment, so
`swift test` cannot confirm TASK-002 and adapter hardening locally.
**Review Feedback Addressed**: Step 7 mid finding in
`impl-plans/PROGRESS.json` for reusing phase 193 and mutating the completed
manager-control-idempotency phase to `IN_PROGRESS`.
**Notes**: Restored phase 193 to `COMPLETED`, assigned
`active/swift-native-migration` to distinct phase 195, and added phase 195 as
`IN_PROGRESS` so the Swift migration progress no longer corrupts unrelated
completed-plan tracking.

### Session: 2026-06-12 00:50

**Tasks Completed**: None
**Tasks In Progress**: TASK-002
**Blockers**: Swift toolchain unavailable in the current environment, so
`swift test` cannot confirm TASK-002 and adapter hardening locally.
**Review Feedback Addressed**: Step 7 adversarial mid findings in
`Sources/RielflowAdapters/LocalAgentProcess.swift` for unconditional
JSON-looking stdout parsing without an output contract and raw stderr
publication on provider failure.
**Notes**: Gated local agent JSON envelope parsing on `input.node.output` so
no-contract `codex-agent`, `claude-code-agent`, and `cursor-cli-agent` stdout
remains a text payload, then added stderr redaction for secret-like assignments,
`sk-*` tokens, bearer/token values, and sensitive environment values before
constructing `AdapterExecutionError.providerError`. Added
`AgentAdapterTests` coverage for no-contract JSON-looking/fenced text,
contracted envelope parsing, and provider failure stderr redaction.

### Session: 2026-06-12 00:55

**Tasks Completed**: None
**Tasks In Progress**: TASK-002
**Blockers**: Swift toolchain unavailable in the current environment, so
`swift test` cannot confirm TASK-002 and adapter hardening locally.
**Review Feedback Addressed**: Step 7 mid findings in
`Sources/RielflowAdapters/LocalAgentProcess.swift` for output-contracted
plain text fallback and child pipe descriptor inheritance.
**Notes**: Removed the text-payload fallback for nodes declaring
`input.node.output`, so contracted local agents now return `invalidOutput` for
plain text stdout. Passed all pipe descriptors into `spawnProcess` and added
child-side close actions for stdin writer, stdout reader, and stderr reader to
avoid inherited descriptors blocking EOF. Added `AgentAdapterTests` coverage for
contracted plain text failure and `/bin/cat` stdin EOF completion before the
deadline.

### Session: 2026-06-12 01:10

**Tasks Completed**: None
**Tasks In Progress**: TASK-002
**Blockers**: Swift toolchain unavailable in the current environment, so
`swift test` cannot confirm TASK-002 and adapter hardening locally.
**Review Feedback Addressed**: Step 7 adversarial mid finding in
`Sources/CodexAgent/CodexAgentAdapter.swift` for accepting Codex CLI JSONL
session/event metadata instead of the final assistant result.
**Notes**: Added `codex-agent` stdout normalization before shared
output-contract parsing. `codex exec --json` JSONL streams now select the final
assistant content from `assistant.snapshot` or `response_item` / message
payloads, leaving session metadata out of both text payloads and business JSON
contracts. Added `AgentAdapterTests` coverage for contracted and text payload
Codex JSONL streams.

### Session: 2026-06-12 01:15

**Tasks Completed**: None
**Tasks In Progress**: TASK-002
**Blockers**: Swift toolchain unavailable in the current environment, so
`swift test` cannot confirm TASK-002 and adapter hardening locally.
**Review Feedback Addressed**: Step 6 self-review correction for preserving
non-Codex direct JSON stdout while still rejecting Codex event metadata.
**Notes**: Tightened `codex-agent` stdout normalization so only recognized Codex
event objects (`session_meta`, `response_item`, `assistant.snapshot`,
`session.started`, or `session.error`) enter JSONL final-assistant extraction.
Plain business JSON emitted by injected tests or future non-event Codex paths is
left for the existing output-contract parser, while Codex metadata-only streams
still cannot become a business payload.

### Session: 2026-06-12 01:20

**Tasks Completed**: None
**Tasks In Progress**: TASK-002, TASK-003, TASK-004
**Blockers**: Default `swift` lookup still resolves through the selected Nix
Apple SDK path and fails, so Swift verification must use the Xcode toolchain
and SDKROOT command shown below.
**Review Feedback Addressed**: Step 7 mid finding in
`impl-plans/active/swift-native-migration.md` and `impl-plans/PROGRESS.json`
for stale TASK-004 and backend adapter module progress after local-agent and
Codex JSONL hardening work.
**Notes**: Marked the backend-faithful agent and official SDK adapter module as
`IN_PROGRESS`, kept prompt/output-envelope contracts as `IN_PROGRESS`, changed
TASK-004 status to `In Progress`, and checked off the implemented local CLI
process hardening plus `codex-agent` JSONL final-assistant normalization
criteria while leaving official SDK and remaining backend parity criteria
incomplete.

### Session: 2026-06-12 01:35

**Tasks Completed**: None
**Tasks In Progress**: TASK-002, TASK-003, TASK-004
**Blockers**: Swift toolchain unavailable in the current environment, so
`swift test` cannot confirm TASK-002, TASK-003, TASK-004, or adapter hardening locally.
**Review Feedback Addressed**: Step 7 adversarial mid finding in
`Sources/RielflowAdapters/LocalAgentProcess.swift` for delayed timeout SIGKILL
escalation being able to target a stale PID or process group after `waitpid`
reaps the original child.
**Notes**: Refined `LocalProcessHandle` lifetime state to clear the direct PID
after reap while probing process-group liveness before preserving scheduled
SIGKILL after timeout. Normal exits and timeout reaps with no live process group
cancel delayed SIGKILL; timeout reaps with live TERM-resistant descendants keep
escalation, then re-check liveness immediately before SIGKILL so a group that
exits during the delay is not signaled. Added focused `AgentAdapterTests`
coverage with an injected signal recorder and a real shell fixture that
launches a TERM-resistant child.

### Session: 2026-06-12 02:15

**Tasks Completed**: None
**Tasks In Progress**: TASK-002, TASK-003, TASK-004
**Blockers**: TASK-003 and TASK-004 remain partial until official SDK parity and
remaining backend behavior are completed.
**Review Feedback Addressed**: Step 7 review mid finding requiring Swift
toolchain execution evidence for the high-risk local-agent process cleanup path.
**Notes**: Ran Xcode Swift 6.3.2 through
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` and
`SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk`.
`swift test` compiled the SwiftPM package and passed 28 tests, including
`AgentAdapterTests` coverage for process-group timeout cleanup,
`codex-agent` JSONL normalization, output-contract parsing, and stderr
redaction.

### Session: 2026-06-12 02:42

**Tasks Completed**: None
**Tasks In Progress**: TASK-002, TASK-003, TASK-004
**Blockers**: None for planning. Implementation still requires the Xcode Swift
toolchain command for reliable local verification.
**Review Feedback Addressed**: No new Step 5 feedback in this workflow run;
the previously addressed Step 5 mid finding for missing official SDK adapter
planning remains covered.
**Notes**: Step 4 revised TASK-004 into an implementation-ready official SDK
slice. Added explicit TASK-004A through TASK-004D substeps for shared official
SDK infrastructure, OpenAI Responses parity, Anthropic Messages parity, and
dispatch registration. The next implementation step must keep
`official/openai-sdk` and `official/anthropic-sdk` in `RielflowAdapters`, use
injected request executors or client factories for deterministic tests, preserve
public backend strings, and leave `official/cursor-sdk` explicitly deferred.

### Session: 2026-06-12 02:45

**Tasks Completed**: None
**Tasks In Progress**: TASK-002, TASK-003, TASK-004
**Blockers**: None for planning.
**Review Feedback Addressed**: Step 4 self-review found and fixed a plan-only
naming drift in the sample backend enum.
**Notes**: Aligned the plan's illustrative Swift backend enum cases with the
current `NodeExecutionBackend` names used by the Swift scaffold and accepted
design: `officialOpenAISDK`, `officialAnthropicSDK`, and
`officialCursorSDK`. Public backend strings remain unchanged.

### Session: 2026-06-12 02:55

**Tasks Completed**: TASK-004 official OpenAI/Anthropic SDK parity slice
**Tasks In Progress**: TASK-002, TASK-003, TASK-004
**Blockers**: Remaining TASK-004 command-builder and readiness parity items are
still open; `official/cursor-sdk` remains explicitly deferred.
**Review Feedback Addressed**: Step 5 accepted the implementation plan with no
high or mid findings; no Step 7 feedback was present for this Step 6 run.
**Notes**: Added `Sources/RielflowAdapters/OfficialSDKAdapters.swift` with
provider-neutral request DTOs, injected `OfficialSDKRequestExecuting`
infrastructure, configured/default API-key lookup, base URL propagation,
bounded retry, deadline timeout handling, credential-redacted error
normalization, OpenAI Responses and Anthropic Messages request construction,
provider text extraction, and shared output-envelope normalization. Updated
`DispatchingNodeAdapter` to register default Swift factories for
`official/openai-sdk` and `official/anthropic-sdk` while leaving
`official/cursor-sdk` unregistered. Added deterministic no-live-credential
tests in `Tests/RielflowAdaptersTests/OfficialSDKAdapterTests.swift` for request
shape, configured env names, base URL forwarding, retry, timeout, terminal
error redaction, `output_text`, segmented output text, Anthropic text content,
output envelopes, dispatch registration, and missing-registration behavior.
Ran Xcode Swift 6.3.2 with `DEVELOPER_DIR` and `SDKROOT`; `swift test` passed
37 tests.

### Session: 2026-06-12 02:56

**Tasks Completed**: TASK-004 official OpenAI/Anthropic SDK parity slice
**Tasks In Progress**: TASK-002, TASK-003, TASK-004
**Blockers**: Remaining TASK-004 command-builder and readiness parity items are
still open; `official/cursor-sdk` remains explicitly deferred.
**Review Feedback Addressed**: Step 6 self-review found and fixed missing retry
delay clamping coverage for the official SDK retry policy.
**Notes**: Updated `RetryPolicy` to clamp negative retry delays to `.zero` and
added `AdapterUtilitiesTests.testRetryPolicyClampsAttemptsAndDelay`. Re-ran
Xcode Swift 6.3.2 with `DEVELOPER_DIR` and `SDKROOT`; `swift test` passed 38
tests.

### Session: 2026-06-12 03:06

**Tasks Completed**: TASK-004 official OpenAI/Anthropic SDK parity slice
**Tasks In Progress**: TASK-002, TASK-003, TASK-004
**Blockers**: Remaining TASK-004 command-builder and readiness parity items are
still open; `official/cursor-sdk` remains explicitly deferred.
**Review Feedback Addressed**: Step 7 adversarial review `exec-000013` mid
finding that default `official/openai-sdk` and `official/anthropic-sdk`
dispatch factories were inert without injected request executors.
**Notes**: Replaced the default missing official SDK request executor with
`URLSessionOfficialSDKRequestExecutor`, backed by an injectable
`OfficialSDKHTTPTransporting` transport and production `URLSession` transport.
The default executor now builds OpenAI Responses and Anthropic Messages HTTP
requests, forwards configured base URLs and credentials, decodes provider JSON
responses, normalizes non-2xx provider failures through shared redaction, and
keeps deterministic tests on injected HTTP transports without live credentials
or network. Added no-live tests proving non-injected request-executor paths work
through both adapters and default `DispatchingNodeAdapter` factories. Re-ran
Xcode Swift 6.3.2 with `DEVELOPER_DIR` and `SDKROOT`; `swift test` passed 42
tests.

### Session: 2026-06-12 03:08

**Tasks Completed**: TASK-004 official OpenAI/Anthropic SDK parity slice
**Tasks In Progress**: TASK-002, TASK-003, TASK-004
**Blockers**: Remaining TASK-004 command-builder and readiness parity items are
still open; `official/cursor-sdk` remains explicitly deferred.
**Review Feedback Addressed**: Step 6 self-review fixed an official SDK base
URL edge case before Step 7 independent review.
**Notes**: Tightened official SDK endpoint construction so configured base URLs
that already include shared path prefixes, such as Anthropic `/v1`, append only
the missing terminal component instead of duplicating path segments. Updated the
default Anthropic HTTP executor test to use `https://anthropic.test/v1` and
expect `https://anthropic.test/v1/messages`. Re-ran Xcode Swift 6.3.2 with
`DEVELOPER_DIR` and `SDKROOT`; `swift test` passed 42 tests.

### Session: 2026-06-12 03:16

**Tasks Completed**: TASK-004 official OpenAI/Anthropic SDK parity slice
**Tasks In Progress**: TASK-002, TASK-003, TASK-004
**Blockers**: Remaining TASK-004 command-builder and readiness parity items are
still open; `official/cursor-sdk` remains explicitly deferred.
**Review Feedback Addressed**: Step 7 adversarial review `exec-000018` mid
finding that official SDK failure redaction did not redact exact configured
API-key values from custom `apiKeyEnv` or injected environment maps.
**Notes**: Threaded the resolved `request.apiKey` into official SDK failure
normalization and redact exact occurrences after the shared pattern-based
redaction. Added no-live tests for an OpenAI HTTP non-2xx body and an injected
Anthropic executor error that echo arbitrary configured secrets which do not
match `sk-`, bearer, or key-assignment redaction patterns. Re-ran Xcode Swift
6.3.2 with `DEVELOPER_DIR` and `SDKROOT`; `swift test` passed 44 tests.

### Session: 2026-06-12 03:18

**Tasks Completed**: TASK-004 official OpenAI/Anthropic SDK parity slice
**Tasks In Progress**: TASK-002, TASK-003, TASK-004
**Blockers**: Remaining TASK-004 command-builder and readiness parity items are
still open; `official/cursor-sdk` remains explicitly deferred.
**Review Feedback Addressed**: Step 6 self-review extended exact credential
redaction to the public `URLSessionOfficialSDKRequestExecutor` non-2xx path.
**Notes**: Redacted exact `request.apiKey` occurrences before the URLSession
request executor itself throws non-2xx provider errors, in addition to the
adapter-level normalization redaction. Added
`testURLSessionOfficialSDKRequestExecutorRedactsDirectHTTPFailures` for a direct
executor call whose HTTP body echoes a custom non-pattern secret. Re-ran Xcode
Swift 6.3.2 with `DEVELOPER_DIR` and `SDKROOT`; `swift test` passed 45 tests.

### Session: 2026-06-12 03:45

**Tasks Completed**: TASK-004 official OpenAI/Anthropic SDK parity slice
**Tasks In Progress**: TASK-002, TASK-003, TASK-004
**Blockers**: None for planning. Implementation still requires the Xcode Swift
toolchain command recorded in the verification plan.
**Review Feedback Addressed**: Step 3 accepted the updated Swift migration
design with no findings; no Step 5 implementation-plan feedback exists for this
run.
**Notes**: Revised TASK-004 planning for the remaining local-agent slice. Added
explicit TASK-004E through TASK-004H substeps for the shared command-builder
boundary, Codex command/auth parity, Claude and Cursor command/auth/model
parity, and deterministic Swift readiness/runtime-readiness APIs. The plan
keeps official OpenAI/Anthropic SDK parity complete, keeps `official/cursor-sdk`
deferred, preserves public backend strings, and requires all local-agent tests
to use injected process runners or readiness probes with no live credentials.

### Session: 2026-06-12 03:56

**Tasks Completed**: TASK-004 local-agent command-builder and readiness parity
slice
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: `official/cursor-sdk` remains explicitly deferred; TASK-005 and
later runtime/CLI/packaging slices remain unstarted until their dependencies
are complete.
**Review Feedback Addressed**: Step 5 implementation-plan review accepted the
local-agent TASK-004E through TASK-004H scope with no high or mid findings.
**Notes**: Replaced shared generic `executableName + baseArguments + --model`
construction with a provider-neutral `LocalAgentCommandBuilding` boundary and
backend-owned Swift builders for `codex-agent`, `claude-code-agent`, and
`cursor-cli-agent`. Added deterministic Swift readiness types and backend
readiness APIs for available, unavailable, unknown, and not_checked tool/auth
and model states, including Codex account/model validation, Claude auth/model
validation, and Cursor unknown auth/model reachability behavior. Added no-live
tests for exact executable/argv/environment/working-directory/stdin/deadline
propagation, policy_blocked preflight failures, stderr redaction, and
runtime-readiness-style invalid/unknown results. Re-ran Xcode Swift 6.3.2 with
`DEVELOPER_DIR` and `SDKROOT`; `swift test` passed 51 tests.

### Session: 2026-06-12 04:00

**Tasks Completed**: TASK-004 local-agent command-builder and readiness parity
slice
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for the implemented TASK-004 slice.
**Review Feedback Addressed**: Step 6 self-review found the TASK-004 status
header still said `In Progress` while TASK-004 completion criteria, progress
log, and `impl-plans/PROGRESS.json` recorded completion.
**Notes**: Corrected the active implementation plan status headers so TASK-002
and TASK-003 remain `In Progress` and TASK-004 is `Completed`, matching
`impl-plans/PROGRESS.json` and the Step 6 verification evidence. Added
explicit injected probe operation protocols/tests for Codex, Claude, and Cursor
readiness and re-ran Xcode Swift 6.3.2 with `DEVELOPER_DIR` and `SDKROOT`;
`swift test` passed 51 tests.

### Session: 2026-06-12 04:11

**Tasks Completed**: TASK-004 local-agent command-builder and readiness parity
slice
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for the implemented TASK-004 slice.
**Review Feedback Addressed**: Step 7 review `exec-000012` reported three mid
findings: Codex, Claude, and Cursor default adapter paths only ran preflight
when callers injected `checkAuthPreflight`, so default local-agent execution
could surface readiness failures as `provider_error` instead of
`policy_blocked`.
**Notes**: Added default runner-backed preflight before local agent execution:
Codex runs `auth status`, Claude checks `--version` plus `auth status`, and
Cursor checks `--version` plus a model reachability probe before spawning the
main command. Added no-live tests for default Codex login failure, Claude
unavailable CLI/auth failures, and Cursor unavailable CLI/auth/model failures.
Also corrected TASK-001 back to `Completed` to match `impl-plans/PROGRESS.json`.
Re-ran Xcode Swift 6.3.2 with `DEVELOPER_DIR` and `SDKROOT`; `swift test`
passed 54 tests. Also ran `bun run typecheck:server`,
`bun run lint:biome`,
`bun run packages/rielflow/src/bin.ts workflow validate
codex-design-and-implement-review-loop --scope project`, and
`gitleaks git --pre-commit --redact --staged --verbose`; all passed.

### Session: 2026-06-12 04:24

**Tasks Completed**: TASK-004 local-agent command-builder and readiness parity
slice
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for the implemented TASK-004 slice.
**Review Feedback Addressed**: Step 7 review `exec-000016` reported four mid
findings: Codex prompt placement used stdin instead of the final argv,
Cursor execution used unsupported stream-mode/stdin behavior, Cursor model
preflight used unsupported `--check`, and default preflights did not inherit
adapter environment overlays.
**Notes**: Updated Codex execution to append the combined prompt as the final
`codex exec --json` argv, including supported `--image` arguments and the image
separator behavior. Updated Cursor execution to match `cursor-agent --print
--output-format stream-json --model <model> ... -- <prompt>` and Cursor model
preflight to use `--output-format text -- <probe prompt>`. Threaded configured
adapter environments into Codex, Claude, and Cursor default preflights, and
expanded no-live tests to assert the same env overlays reach preflight and main
execution. Re-ran Xcode Swift 6.3.2 with `DEVELOPER_DIR` and `SDKROOT`;
`swift test` passed 54 tests.

### Session: 2026-06-12 04:33

**Tasks Completed**: TASK-004 local-agent command-builder and readiness parity
slice
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for the implemented TASK-004 slice.
**Review Feedback Addressed**: Step 7 review `exec-000020` reported one mid
finding: Codex default auth preflight used `codex auth status` while the
codex-agent readiness reference uses `codex login status`.
**Notes**: Updated Codex default preflight argv to `codex login status` while
preserving `policy_blocked` failure mapping and configured environment
propagation. Updated no-live XCTest assertions for the exact Codex preflight
argv in both command-builder and preflight-failure coverage. Re-ran Xcode Swift
6.3.2 with `DEVELOPER_DIR` and `SDKROOT`; `swift test` passed 54 tests.

### Session: 2026-06-12 04:42

**Tasks Completed**: TASK-004 local-agent command-builder and readiness parity
slice
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for the implemented TASK-004 slice.
**Review Feedback Addressed**: Step 7 review `exec-000024` reported one mid
finding: local-agent image/attachment command builders only read node variables
and missed runtime `arguments` / `mergedVariables` image attachments and
`forwardImageAttachments: false`.
**Notes**: Added shared Swift `resolveAdapterImagePaths` parity in
`Sources/RielflowAdapters/AdapterUtilities.swift`, covering runtime
`mergedVariables`, runtime `arguments`, nested image descriptors, source
descriptors, dedupe, depth limiting, and disabled forwarding. Updated Codex and
Cursor builders to use the shared resolver for `--image`; updated Claude to
merge resolved images into its attachment behavior. Added no-live tests for
merged/argument/nested/deduped image paths and for disabled forwarding across
Codex, Claude, and Cursor. Re-ran Xcode Swift 6.3.2 with `DEVELOPER_DIR` and
`SDKROOT`; `swift test` passed 56 tests.

### Session: 2026-06-12 04:49

**Tasks Completed**: TASK-004 local-agent command-builder and readiness parity
slice
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for the implemented TASK-004 slice.
**Review Feedback Addressed**: Step 7 review `exec-000028` reported three mid
findings: Codex, Claude, and Cursor still ran injected `checkAuthPreflight`
closures when `authPreflight: false` explicitly disabled auth preflight.
**Notes**: Gated injected and default auth preflight behind `authPreflight` for
all three local-agent adapters. The execution order now skips all preflight work
when disabled; otherwise it prefers injected `checkAuthPreflight` and falls back
to the default runner-backed preflight. Added no-live XCTest coverage with
throwing injected preflights and `authPreflight: false` for Codex, Claude, and
Cursor. Re-ran Xcode Swift 6.3.2 with `DEVELOPER_DIR` and `SDKROOT`;
`swift test` passed 57 tests.

### Session: 2026-06-12 05:00

**Tasks Completed**: TASK-004 local-agent command-builder and readiness parity
slice
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for the implemented TASK-004 slice.
**Review Feedback Addressed**: Step 7 review `exec-000032` reported one mid
finding: Cursor execution requested `--output-format stream-json` but returned
raw JSONL stdout through the shared local-agent adapter, so final assistant or
`session.completed` text could be missed before output-contract normalization.
**Notes**: Added Cursor stream JSON stdout normalization in
`Sources/CursorCLIAgent/CursorCLIAgentAdapter.swift`, extracting the latest
`session.assistant_message.message.displayText`/`rawText` and falling back to
`session.completed.result` before shared output normalization. Added no-live
XCTest coverage for Cursor stream JSON text payload extraction and
output-contract envelope parsing from `session.completed`. Re-ran Xcode Swift
6.3.2 with `DEVELOPER_DIR` and `SDKROOT`; `swift test` passed 59 tests. Also
ran `bun run typecheck:server`, `bun run lint:biome`,
`bun run packages/rielflow/src/bin.ts workflow validate
codex-design-and-implement-review-loop --scope project`,
`gitleaks git --pre-commit --redact --staged --verbose`, `git diff --check`,
and `jq empty impl-plans/PROGRESS.json`; all passed.

### Session: 2026-06-12 05:13

**Tasks Completed**: TASK-004 local-agent command-builder and readiness parity
slice
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for the implemented TASK-004 slice.
**Review Feedback Addressed**: Step 7 adversarial review `exec-000037`
reported one mid finding: default Codex, Claude, and Cursor auth/readiness
preflights reused `AdapterExecutionContext.deadline` and could run without an
independent bound or surface timeout instead of `policy_blocked`.
**Notes**: Added shared bounded preflight deadline and preflight-error detail
helpers in `Sources/RielflowAdapters/AdapterUtilities.swift`. Codex and Claude
default auth preflights now use 5-second bounds; Cursor default auth/model
preflight uses a 30-second bound. Runner timeout/provider errors during default
preflight are now mapped into redacted `policy_blocked` auth, CLI, or model
messages before the main agent command runs. Added no-live XCTest coverage for
nil-context bounded preflight deadlines and timeout-to-`policy_blocked` mapping
across `codex-agent`, `claude-code-agent`, and `cursor-cli-agent`. Re-ran
Xcode Swift 6.3.2 with `DEVELOPER_DIR` and `SDKROOT`; `swift test` passed 61
tests. Also ran `bun run typecheck:server`, `bun run lint:biome`,
`bun run packages/rielflow/src/bin.ts workflow validate
codex-design-and-implement-review-loop --scope project`,
`gitleaks git --pre-commit --redact --staged --verbose`, `git diff --check`,
and `jq empty impl-plans/PROGRESS.json`; all passed.

### Session: 2026-06-12 05:21

**Tasks Completed**: TASK-004 local-agent command-builder and readiness parity
slice
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for the implemented TASK-004 slice.
**Review Feedback Addressed**: Step 7 review `exec-000041` reported one mid
finding: `CodexAgentCommandBuilder` only inserted the argv option terminator
`--` before the final prompt when image paths existed, so a prompt beginning
with `--` could be parsed by `codex exec` as a CLI flag.
**Notes**: Updated `Sources/CodexAgent/CodexAgentAdapter.swift` so Codex
always appends `--` after supported flags, additional args, model, effort, and
images, and immediately before the final prompt argument. Added
`testCodexCommandBuilderTerminatesOptionsBeforeFlagLikePrompt` in
`Tests/AgentAdapterTests/AgentAdapterTests.swift` to cover a `--model other`
prompt while preserving the intended builder-owned `--model` flag. Re-ran
Xcode Swift 6.3.2 with `DEVELOPER_DIR` and `SDKROOT`; `swift test` passed 62
tests. Also ran `bun run typecheck:server`, `bun run lint:biome`,
`bun run packages/rielflow/src/bin.ts workflow validate
codex-design-and-implement-review-loop --scope project`,
`gitleaks git --pre-commit --redact --staged --verbose`, `git diff --check`,
`jq empty impl-plans/PROGRESS.json`, and targeted `rg` checks for the
terminator/test coverage; all passed.

### Session: 2026-06-12 05:35

**Tasks Completed**: TASK-004 local-agent command-builder and readiness parity
slice
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for the implemented TASK-004 slice.
**Review Feedback Addressed**: Step 7 adversarial review `exec-000046`
reported two mid findings: local-agent child processes could inherit unrelated
parent file descriptors, and local-agent/preflight failure redaction did not
include configured child environment secret values when a CLI echoed raw values.
**Notes**: Updated `Sources/RielflowAdapters/LocalAgentProcess.swift` to spawn
children with `POSIX_SPAWN_CLOEXEC_DEFAULT`, preserving explicit stdin,
stdout, and stderr duplication while closing unrelated descriptors at exec.
Updated `Sources/RielflowAdapters/AdapterUtilities.swift`,
`Sources/RielflowAdapters/AgentReadiness.swift`, and the Codex, Claude, and
Cursor default preflight paths so configured sensitive environment values such
as `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `CURSOR_CONFIG_DIR`, `*_CONFIG_DIR`, and
token/secret/password keys are redacted from provider and `policy_blocked`
failure details. Added deterministic no-live tests for inherited descriptor
closure, configured environment secret redaction in provider errors, and
configured environment secret redaction in default preflight `policy_blocked`
errors. Re-ran Xcode Swift 6.3.2 with `DEVELOPER_DIR` and `SDKROOT`;
`swift test` passed 65 tests.

### Session: 2026-06-12 06:02

**Tasks Completed**: None
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for planning. TASK-005 implementation remains gated on
stable parent TASK-002/TASK-003 runtime model and JSON/envelope contracts.
**Review Feedback Addressed**: Step 3 accepted the TASK-005 design update with
no findings; no Step 5 implementation-plan feedback exists for this run.
**Notes**: Created focused TASK-005 implementation plan at
`impl-plans/completed/swift-native-migration-task-005-runtime-session.md` covering
Swift runtime-owned session/message value types, store protocols,
deterministic in-memory behavior, candidate-path publication, output-contract
validation, no-publication failure paths, TypeScript/Bun fallback, and legacy
inbox/outbox exclusion.

### Session: 2026-06-12 06:10

**Tasks Completed**: None
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for planning self-review.
**Review Feedback Addressed**: Step 4 self-review found the parent plan's
issue-reference block still described the prior TASK-004 workflow session and
local-agent scope.
**Notes**: Updated the parent plan issue-reference block to name the current
TASK-005 workflow session, issue title, and self-review node while preserving
the earlier TASK-004 session as historical context. No design revision or
additional implementation-plan revision is required.

### Session: 2026-06-12 06:12

**Tasks Completed**: None
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: TASK-005 implementation remains blocked until parent TASK-002 and
TASK-003 are completed or explicitly accepted as stable for the runtime
session/message slice.
**Review Feedback Addressed**: Step 5 review `exec-000008` reported two mid
findings against `impl-plans/completed/swift-native-migration-task-005-runtime-session.md`:
the focused plan was marked `Ready` while parent contracts were still blockers,
and candidate-path staging lifecycle was under-specified.
**Notes**: Marked the focused TASK-005 plan `Blocked`, updated
`impl-plans/README.md` and `impl-plans/PROGRESS.json`, added an explicit
activation rule for parent TASK-002/TASK-003 stability, and expanded
candidate-path lifecycle planning with runtime provisioning, pre-attempt
clearing, post-attempt cleanup or ignore behavior, and focused verification
commands.

### Session: 2026-06-12 06:21

**Tasks Completed**: TASK-005
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for the additive TASK-005 in-memory runtime slice; parent
TASK-002/TASK-003 remain active for broader Swift migration parity but the
current model and JSON/envelope contracts were stable enough for this scoped
runtime boundary implementation.
**Review Feedback Addressed**: Step 5 accepted the focused TASK-005 plan after
the blocked-status and candidate-path lifecycle findings were addressed.
**Notes**: Added `RielflowCore` runtime session/message value types, in-memory
store protocols and implementation, candidate-path staging and reader APIs,
output validation, and runtime-owned publication service. Added deterministic
XCTest coverage for runtime-generated communication ids, append failures,
candidate-path missing/stale/malformed/non-object/out-of-staging rejection,
candidate-path provisioning/clearing/finalization, schema and
`completionPassed: false` validation failures, no-candidate provider failure,
accepted downstream message publication, and root output selection. Verified
TypeScript/Bun fallback checks and Xcode Swift 6.3.2 `swift test` with 77
tests passing.

### Session: 2026-06-12 06:39

**Tasks Completed**: TASK-005 Step 7 adversarial revision
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for the additive TASK-005 in-memory runtime slice; parent
TASK-002/TASK-003 remain active for broader Swift migration parity.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000016`
requested a revision to harden the runtime publication boundary. Candidate-path
publication now requires the exact runtime-reserved candidate path, and
adapter/provider failures now have an explicit runtime API path that marks the
step failed without creating workflow messages.
**Notes**: Updated `RuntimePublication.swift`, `RuntimeOutputCandidate.swift`,
`RuntimeOutputCandidateTests.swift`, and `RuntimePublicationTests.swift`.
Verified TypeScript/Bun fallback checks and Xcode Swift 6.3.2 `swift test`
with 79 tests passing.

### Session: 2026-06-12 06:50

**Tasks Completed**: TASK-005 Step 7 review revision
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for the additive TASK-005 in-memory runtime slice; parent
TASK-002/TASK-003 remain active for broader Swift migration parity.
**Review Feedback Addressed**: Step 7 review `comm-000004` reported two mid
findings. Candidate-path staging now rejects unsafe path components and
outside-root finalization before recursive cleanup. Runtime output validation
now covers the TypeScript JSON Schema subset from
`packages/rielflow-core/src/json-schema.ts`.
**Notes**: Updated `RuntimeCandidatePathStaging.swift`,
`RuntimeOutputValidation.swift`, `RuntimeOutputCandidateTests.swift`, and
`RuntimeOutputValidationTests.swift`. Xcode Swift 6.3.2 `swift test` passes 82
tests.

### Session: 2026-06-12 07:04

**Tasks Completed**: TASK-005 Step 7 schema-definition review revision
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for the additive TASK-005 in-memory runtime slice; parent
TASK-002/TASK-003 remain active for broader Swift migration parity.
**Review Feedback Addressed**: Step 7 review `comm-000008` reported that Swift
payload validation did not reject malformed output-contract schema definitions
before payload validation as TypeScript/Bun does in
`packages/rielflow-core/src/json-schema.ts`.
**Notes**: Updated `RuntimeOutputValidation.swift` with schema-definition
validation for unsupported keywords and structural checks over type,
properties, required, additionalProperties, items, enum, min/max bounds,
pattern, and combinators. Added malformed schema-definition regressions in
`RuntimeOutputValidationTests.swift`. Xcode Swift 6.3.2 `swift test` passes 83
tests.

### Session: 2026-06-12 07:18

**Tasks Completed**: TASK-005 Step 7 adversarial candidate-path revision
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for the additive TASK-005 in-memory runtime slice; parent
TASK-002/TASK-003 remain active for broader Swift migration parity.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000013`
reported that candidate-source precedence could bypass candidate-path
reservation validation and that publication did not finalize staging after
candidate-path consumption.
**Notes**: Updated `RuntimePublication.swift`,
`RuntimeCandidatePathStaging.swift`, and `RuntimePublicationTests.swift`.
Publication now rejects ambiguous candidate sources, requires candidate-path
requests to use the reserved path when a reservation is present, and finalizes
candidate-path staging after success, validation failure, and append failure.
Xcode Swift 6.3.2 `swift test` passes 88 tests.

### Session: 2026-06-12 07:30

**Tasks Completed**: TASK-005 Step 7 adversarial unsupported-transition
revision
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for the additive TASK-005 in-memory runtime slice; parent
TASK-002/TASK-003 remain active for broader Swift migration parity.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000018`
reported that cross-workflow, resume-step, and fanout transition fields could
be silently converted to direct in-workflow messages.
**Notes**: Updated `RuntimePublication.swift` and
`RuntimePublicationTests.swift`. Unsupported `toWorkflowId`, `resumeStepId`,
and `fanout` transitions now fail before accepted output or workflow message
publication. Xcode Swift 6.3.2 `swift test` passes 89 tests.
