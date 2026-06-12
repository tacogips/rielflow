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
- `design-docs/specs/design-swift-native-migration.md#task-007-swift-cli-validate-inspect-and-deterministic-run-parity`
- `design-docs/specs/design-swift-native-migration.md#task-008-packaging-and-homebrew-cutover-readiness-gates`
- `design-docs/specs/design-swift-native-migration.md#task-002task-003-prompt-json-and-envelope-prerequisite-closure`
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
  `riel-codex-design-and-implement-review-loop-1781255384-68cdb70c`
- Earlier TASK-008 workflow session:
  `riel-codex-design-and-implement-review-loop-1781250760-faba89fb`
- Earlier TASK-005 workflow session:
  `riel-codex-design-and-implement-review-loop-1781211309-5fe4a54a`
- Earlier TASK-004 workflow session:
  `riel-codex-design-and-implement-review-loop-1781203096-8dcd5023`
- Current planning node: `step4-impl-plan-create`
- Repository: `tacogips/rielflow`
- Issue title:
  `Complete Swift prompt JSON envelope contracts and close migration prerequisites`
- GitHub issue: none supplied by runtime input
- Branch: `swift-migration`
- Risk level: high; adversarial implementation review required before cutover

Workflow execution note:

- Current TASK-002/TASK-003 prerequisite closure planning run
  `riel-codex-design-and-implement-review-loop-1781255384-68cdb70c` scopes the
  next implementation step to Swift prompt rendering, prompt template asset
  loading, escaped and missing variable behavior, JSON candidate extraction, and
  output-envelope normalization before TASK-009.
- Step 3 design review accepted the TASK-002/TASK-003 design update with no
  high or mid findings in the supplied workflow input.
- TASK-002 is now completion-evidenced by current Xcode Swift 6.3.2
  verification: `swift test` passed 197 tests with 0 failures on 2026-06-12.
- The previous TASK-004 adapter parity, TASK-005 runtime publication,
  TASK-006 contract, TASK-007 CLI parity, and TASK-008 packaging readiness
  slices remain completed and are not reopened by this plan revision.

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
- `packages/rielflow-core/src/render.ts`
- `packages/rielflow-core/src/prompt-template-context.ts`
- `packages/rielflow-core/src/prompt-template-file.ts`
- `packages/rielflow-core/src/node-template-fields.ts`
- `packages/rielflow/src/workflow/load.ts`
- `packages/rielflow/src/workflow/prompt-composition.ts`
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
- TASK-008 Swift readiness archives intentionally use
  `rielflow-swift-<version>-darwin-<arch>.tar.gz` names under
  `dist/swift-homebrew/` so they cannot be confused with Bun production
  `dist/homebrew/rielflow-<version>-...` archives before cutover.
- Current TASK-003 closure keeps Swift adapters limited to provider-output
  normalization; candidate-path handling, output validation, accepted-output
  artifacts, workflow messages, communication ids, and final root output
  selection remain runtime-owned.

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

**Status**: COMPLETED

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
- [x] Port prompt asset loading contracts.
- [x] Preserve initial JSON boundary behavior for authored payloads and output
      envelopes.
- [x] Add prompt rendering fixture tests for literal brace text,
      backslash-escaped JSON string content, multiple placeholders, dotted
      paths, object and array substitutions, falsey scalar values, missing
      variables, and null values.
- [x] Add prompt asset loading tests for `systemPromptTemplateFile`,
      `promptTemplateFile`, and `sessionStartPromptTemplateFile` on node
      payloads and prompt variants.
- [x] Reject empty, absolute, traversal, `.` / `..`, canonical workflow
      definition, missing, and unreadable prompt template asset paths with
      field-specific diagnostics.
- [x] Add output-envelope tests for no-contract JSON-looking text, contracted
      plain text rejection, default `completionPassed`, strict boolean `when`,
      object-only `payload`, business-payload fallback, and escaped-string brace
      candidate extraction.
- [x] Keep runtime-owned publication outside backend adapters.

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

**Status**: COMPLETED

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

- [x] Implement `workflow validate` using Swift validation contracts.
- [x] Implement `workflow inspect` using Swift workflow loading contracts.
- [x] Implement deterministic `workflow run` without live agent calls.
- [x] Keep TypeScript CLI fallback documented until parity gates pass.

### 8. Packaging And Release Cutover Readiness

#### `Package.swift`
#### `packaging/homebrew/*`
#### `README.md`
#### `design-docs/user-qa/qa-swift-native-migration.md`
#### `.codex/skills/riel-codex-impl-workflow/SKILL.md`
#### `impl-plans/completed/swift-native-migration-task-008-packaging-cutover-readiness.md`

**Status**: COMPLETED

```swift
public struct SwiftReleaseArtifact: Equatable, Sendable {
  public var executableName: String
  public var archivePath: String
  public var checksum: String
}
```

**Checklist**:

- [x] Create focused TASK-008 implementation plan for packaging readiness.
- [x] Define Swift executable artifact path and archive naming.
- [x] Keep Homebrew cutover blocked until validation, inspect, run, package,
      event, GraphQL, hook, adapter, and macOS archive gates pass.
- [x] Refresh user-facing docs for the final cutover contract.
- [x] Do not remove TypeScript release path until adversarial review accepts
      the cutover.

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Swift package boundary scaffold | `Package.swift`, `Sources/*`, `Tests/*` | COMPLETED | Initial scaffold tests present |
| Core workflow model and validation | `Sources/RielflowCore/WorkflowModel.swift`, `Sources/RielflowCore/WorkflowValidation.swift` | COMPLETED | `Tests/RielflowCoreTests/*`; Xcode Swift 6.3.2 `swift test` passed 197 tests with 0 failures on 2026-06-12 |
| Prompt and JSON boundary contracts | `Sources/RielflowCore/PromptTemplate.swift`, `Sources/RielflowCore/PromptTemplateAssets.swift`, `Sources/RielflowCore/JSONValue.swift`, `Sources/RielflowAdapters/AdapterUtilities.swift`, `Sources/RielflowCore/DeterministicWorkflowRunner.swift` | COMPLETED | `Tests/RielflowCoreTests/PromptTemplateTests.swift`, `Tests/RielflowCoreTests/DeterministicWorkflowRunnerTests.swift`, `Tests/RielflowAdaptersTests/AdapterUtilitiesTests.swift`, `Tests/RielflowCLITests/WorkflowCommandTests.swift`; Xcode Swift 6.3.2 `swift test` passed 209 tests with 0 failures on 2026-06-12 |
| Backend-faithful agent and official SDK adapters | `Sources/CodexAgent/*`, `Sources/ClaudeCodeAgent/*`, `Sources/CursorCLIAgent/*`, `Sources/RielflowAdapters/*` | COMPLETED | `Tests/AgentAdapterTests/*`, `Tests/RielflowAdaptersTests/*`; Xcode Swift 6.3.2 `swift test` passed 65 tests for local-agent command builders, bounded preflights, Cursor/Codex stream normalization, Codex argv option termination, descriptor isolation, configured-secret redaction, readiness parity, and official OpenAI/Anthropic SDK scaffold |
| Runtime session and message publication | `Sources/RielflowCore/*`, `Sources/RielflowCLI/*` | COMPLETED | `Tests/RielflowCoreTests/*`; Xcode Swift 6.3.2 `swift test` passed 93 tests for TASK-005 in-memory runtime APIs |
| Add-on, package, event, hook, GraphQL, and server boundaries | `Sources/RielflowAddons/*`, `Sources/RielflowEvents/*`, `Sources/RielflowHook/*`, `Sources/RielflowGraphQL/*`, `Sources/RielflowServer/*` | COMPLETED | `Tests/RielflowAddonsTests/*`, `Tests/RielflowEventsTests/*`, `Tests/RielflowHookTests/*`, `Tests/RielflowGraphQLTests/*`, `Tests/RielflowServerTests/*`; Xcode Swift 6.3.2 `swift test` passed 125 tests |
| CLI parity slice | `Sources/RielflowCLI/main.swift` | COMPLETED | `Tests/RielflowCLITests/*`; Xcode Swift 6.3.2 `swift test` passed 188 tests for TASK-007 |
| Packaging and release cutover readiness | `packaging/homebrew/*`, `README.md`, `design-docs/user-qa/qa-swift-native-migration.md`, `.codex/skills/riel-codex-impl-workflow/SKILL.md`, `impl-plans/completed/swift-native-migration-task-008-packaging-cutover-readiness.md` | COMPLETED | TASK-008 readiness script, gate manifest, deterministic Swift tests, and macOS archive smoke checks passed |

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

**Status**: Completed
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
- [x] `swift test` confirms the new fixture and diagnostic tests in a
      Swift-capable environment.

### TASK-003: Port Prompt, JSON, And Output Envelope Contracts

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCore/PromptTemplate.swift`, `Sources/RielflowCore/PromptTemplateAssets.swift`, `Sources/RielflowCore/JSONValue.swift`, `Sources/RielflowAdapters/AdapterUtilities.swift`, `Sources/RielflowCLI/WorkflowResolution.swift`, `Tests/RielflowCoreTests/*`, `Tests/RielflowAdaptersTests/*`, `Tests/RielflowCLITests/*`
**Dependencies**: TASK-001, TASK-002

**Description**:
Port prompt rendering, JSON boundary, and adapter envelope normalization so
agents and runtime output publication share one contract.
This closure slice must use the TypeScript fallback references
`packages/rielflow-core/src/render.ts`,
`packages/rielflow-core/src/prompt-template-context.ts`,
`packages/rielflow-core/src/prompt-template-file.ts`,
`packages/rielflow-core/src/node-template-fields.ts`,
`packages/rielflow/src/workflow/load.ts`,
`packages/rielflow/src/workflow/prompt-composition.ts`,
`packages/rielflow/src/workflow/adapter.ts`,
`packages/rielflow/src/workflow/output-attempt-runner.ts`, and
`packages/rielflow/src/workflow/engine/step-result-finalization.ts` because
`../../codex-agent` is unavailable in this checkout.

**Completion Criteria**:

- [x] Prompt rendering fixture tests cover literal brace text,
      backslash-escaped JSON string content, multiple placeholders, dotted
      paths, object and array substitutions, falsey scalar values, missing
      variables, and null values.
- [x] Prompt asset loading covers `systemPromptTemplateFile`,
      `promptTemplateFile`, and `sessionStartPromptTemplateFile` on node
      payloads and prompt variants.
- [x] Prompt asset loading rejects empty paths, absolute paths, `.` / `..`
      segments, traversal above the workflow root, canonical workflow
      definition targets such as `workflow.json` and `node-*.json`, and missing
      or unreadable files with field-specific diagnostics.
- [x] Loaded template files populate the corresponding inline template fields
      for execution while preserving authored file references for save and
      validation workflows.
- [x] No-contract adapter output preserves JSON-looking text as text payload.
- [x] Contracted provider text yields a JSON object candidate or fails with
      `invalid_output`.
- [x] Envelope normalization preserves `completionPassed`, `when`, and
      `payload`; defaults missing `completionPassed` to true; rejects non-boolean
      `when` entries and non-object `payload`; and treats objects without
      `when` as business payloads.
- [x] JSON candidate extraction ignores braces inside quoted strings and
      escaped string characters while finding the first balanced object.
- [x] Runtime publication remains outside backend adapters; candidate-path
      handling, workflow messages, communication ids, output validation, and
      final root output selection stay runtime-owned.
- [x] Xcode Swift 6.3.2 `swift test` passes after TASK-003 closure.

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

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/RielflowAddons/*`, `Sources/RielflowEvents/*`, `Sources/RielflowHook/*`, `Sources/RielflowGraphQL/*`, `Sources/RielflowServer/*`, `Tests/*`
**Dependencies**: TASK-002, TASK-003, TASK-005

**Description**:
Port compatibility surfaces needed by parity gates while preserving package,
add-on, event, hook, GraphQL, and server ownership boundaries.
Implementation detail is split into the focused TASK-006 plan so this parent
plan stays navigable while the contract slice remains traceable to the accepted
design.

**Completion Criteria**:

- [x] Package validation and manifest loading parity tests pass.
- [x] Declarative add-on execution boundaries expose resolver inputs without
      engine internals, session stores, communication ids, candidate paths, or
      direct agent backend execution.
- [x] Event trigger dry-run and hook context parsing tests pass.
- [x] GraphQL/server inspection contracts expose the same runtime state shape.
- [x] Focused plan exists at
      `impl-plans/completed/swift-native-migration-task-006-contracts.md`.

### TASK-007: Implement Swift CLI Parity Commands

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCLI/*`, `Tests/RielflowCLITests/*`, `impl-plans/completed/swift-native-migration-task-007-cli-parity.md`
**Dependencies**: TASK-004, TASK-005, TASK-006

**Description**:
Implement Swift `workflow validate`, `workflow inspect`, and deterministic
`workflow run` commands for parity testing. Implementation detail is split into
the focused TASK-007 plan so the parent migration plan stays navigable while
CLI parser, workflow resolution, validation, inspection, mock scenario, and
deterministic run work remains traceable to the accepted design.

**Completion Criteria**:

- [x] Swift CLI validates the `codex-design-and-implement-review-loop` workflow.
- [x] Swift CLI inspect output matches parity fixtures.
- [x] Swift deterministic run works without live agent credentials.
- [x] Focused plan exists at
      `impl-plans/completed/swift-native-migration-task-007-cli-parity.md`.

### TASK-008: Wire Packaging And Documentation Cutover Gates

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packaging/homebrew/*`, `README.md`, `design-docs/user-qa/qa-swift-native-migration.md`, `.codex/skills/riel-codex-impl-workflow/SKILL.md`, `impl-plans/completed/swift-native-migration-task-008-packaging-cutover-readiness.md`
**Dependencies**: TASK-007

**Description**:
Prepare, but do not execute, release packaging cutover from TypeScript/Bun to
Swift executable artifacts. Implementation detail is split into the focused
TASK-008 plan so the parent migration plan stays navigable while artifact
paths, archive naming, Homebrew preview gates, fallback docs, and deterministic
packaging checks remain traceable to the accepted design.

**Completion Criteria**:

- [x] Focused plan exists at
      `impl-plans/completed/swift-native-migration-task-008-packaging-cutover-readiness.md`.
- [x] macOS Swift archive path and executable name are documented.
- [x] Homebrew cutover remains blocked until all parity gates pass.
- [x] User-facing docs explain fallback and cutover constraints.

### TASK-009: Final Parity, Security, And Adversarial Review Handoff

**Status**: Not Started
**Parallelizable**: No
**Deliverables**: verification logs, review notes, updated progress log
**Dependencies**: TASK-003, TASK-007, TASK-008

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
| TASK-009 | TASK-003, TASK-007, TASK-008 | Final review depends on TASK-003 closure, verified runtime, and cutover gates. |

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
TASK-006 is split into the focused plan
`impl-plans/completed/swift-native-migration-task-006-contracts.md`. Within that
plan, package manifest (`RielflowAddons`), event (`RielflowEvents`), and hook
(`RielflowHook`) contract tasks may run in parallel only if write scopes remain
confined to their target and test directories. Add-on execution depends on
manifest contracts, GraphQL depends on event and hook projections, server
depends on GraphQL, and final verification runs last.
TASK-007 is split into the focused plan
`impl-plans/completed/swift-native-migration-task-007-cli-parity.md`. Within that
plan, CLI parser setup and deterministic mock runner work may run in parallel
because their write scopes are disjoint. Validate and inspect command work may
run in parallel only after shared workflow resolution is accepted.
TASK-008 is split into the focused plan
`impl-plans/completed/swift-native-migration-task-008-packaging-cutover-readiness.md`.
Within that plan, docs/skill fallback guidance and gate manifest work may run
in parallel only if write scopes stay disjoint. Archive builder or dry-run
surface work, deterministic readiness tests, and progress evidence are
sequential because they share the artifact contract and verification outputs.
Current TASK-003 closure is sequential because prompt rendering, template asset
loading, and output-envelope candidate extraction share `RielflowCore` JSON and
adapter-contract behavior. Focused tests may be grouped by file, but no task is
parallelizable until the shared prompt/template loading API shape is accepted.

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

TASK-002/TASK-003 prerequisite closure checks:

- TASK-002 evidence check:
  `rg -n "TASK-002|197 tests|Swift 6.3.2" impl-plans/active/swift-native-migration.md design-docs/specs/design-swift-native-migration.md`.
- TASK-003 planning check:
  `rg -n "renderPromptTemplate|promptTemplateFile|systemPromptTemplateFile|sessionStartPromptTemplateFile|completionPassed|candidate-path|runtime-owned" impl-plans/active/swift-native-migration.md design-docs/specs/design-swift-native-migration.md`.
- TASK-003 implementation checks:
  `rg -n "renderPromptTemplate|PromptTemplate|promptTemplateFile|systemPromptTemplateFile|sessionStartPromptTemplateFile" Sources/RielflowCore Tests/RielflowCoreTests`.
  `rg -n "normalizeOutputContractEnvelope|parseJSONObjectCandidate|extractBalancedJSONObject|completionPassed|usedEnvelope" Sources/RielflowCore Sources/RielflowAdapters Tests/RielflowAdaptersTests Tests/AgentAdapterTests`.
  `rg -n "candidatePath|WorkflowMessageRecord|communicationId|WorkflowOutputPublishing" Sources/RielflowAdapters Tests/RielflowAdaptersTests Tests/AgentAdapterTests` must not show backend adapters taking runtime-owned publication responsibilities.
- Add or update XCTest coverage for prompt literal braces, escaped string
  content, multiple placeholders, dotted paths, object/array substitutions,
  falsey scalar values, missing and null variables, template-file loading and
  rejection diagnostics, no-contract JSON-looking text, contracted plain text
  rejection, strict envelope validation, business-payload fallback, and escaped
  brace candidate extraction.

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
- TASK-006 planning check:
  `rg -n "WorkflowPackageManifest|AddonExecutionInput|ExternalEventEnvelope|HookContext|GraphQLWorkflowSessionDTO|ServerRequestEnvelope" impl-plans/completed/swift-native-migration-task-006-contracts.md`.
- TASK-006 implementation checks:
  `rg -n "WorkflowPackageManifest|WorkflowPackageManifestLoading|WorkflowPackageValidationIssue" Sources/RielflowAddons Tests/RielflowAddonsTests`.
  `rg -n "AddonExecutionInput|AddonResolveRequest|AddonExecutionOutput|communicationId|candidatePath|WorkflowRuntimeStore" Sources/RielflowAddons Tests/RielflowAddonsTests`.
  `rg -n "ExternalEventEnvelope|EventDryRunRequest|EventDryRunResult|EventReceipt|ReplyDispatch" Sources/RielflowEvents Tests/RielflowEventsTests`.
  `rg -n "HookContext|HookRecordRequest|RIEL_HOOK_RECORDING|RIEL_HOOK_CAPTURE_RAW|redact" Sources/RielflowHook Tests/RielflowHookTests`.
  `rg -n "GraphQLWorkflowSessionDTO|GraphQLControlPlaneServicing|schema" Sources/RielflowGraphQL Tests/RielflowGraphQLTests`.
  `rg -n "ServerRequestEnvelope|ServerResponseDescriptor|healthz|overview|GraphQL" Sources/RielflowServer Tests/RielflowServerTests`.
  `rg -n "URLSession|listen|bind|accept|install|checkout|copyItem|RIEL_MAILBOX_DIR|inbox/input\\.json|outbox/output\\.json" Sources/RielflowAddons Sources/RielflowEvents Sources/RielflowHook Sources/RielflowGraphQL Sources/RielflowServer Tests`.

Cutover checks:

- Package validation parity against existing package manifests.
- Event trigger dry-run parity.
- GraphQL manager-control inspection parity.
- Hook context parsing parity.
- macOS archive smoke test before Homebrew switch.
- TASK-008 planning check:
  `rg -n "TASK-008|rielflow-swift-|dist/swift-homebrew|TypeScript/Bun remains" impl-plans/active/swift-native-migration.md impl-plans/completed/swift-native-migration-task-008-packaging-cutover-readiness.md README.md packaging/homebrew/README.md design-docs/user-qa/qa-swift-native-migration.md .codex/skills/riel-codex-impl-workflow/SKILL.md`.
- TASK-008 implementation checks:
  `RIEL_VERSION=0.0.0-task008 scripts/build-swift-homebrew-readiness.sh --dry-run darwin-arm64`;
  `RIEL_VERSION=0.0.0-task008 scripts/build-swift-homebrew-readiness.sh darwin-arm64`;
  `tar -tzf dist/swift-homebrew/rielflow-swift-0.0.0-task008-darwin-arm64.tar.gz`;
  `(cd dist/swift-homebrew && shasum -a 256 -c rielflow-swift-0.0.0-task008-darwin-arm64.tar.gz.sha256)`;
  `! rg -n "/Users/|/home/|$(pwd)" dist/swift-homebrew/rielflow-swift-0.0.0-task008-darwin-arm64.tar.gz.sha256`;
  archived `bin/rielflow --help`, `workflow validate`, `workflow inspect`, and
  deterministic `workflow run --mock-scenario` smokes.
- No-publish side-effect check:
  `rg -n "gh release|git push|brew tap|render-homebrew-formula|Formula/rielflow.rb" scripts/build-swift-homebrew-readiness.sh packaging/homebrew/swift-cutover-gates.json packaging/homebrew/README.md`
  with any matches confirmed as documentation-only preview or explicit
  forbidden-action text.

Current environment note:

- Xcode Swift 6.3.2 is available and `swift test` passed 197 tests with
  0 failures on 2026-06-12 using `DEVELOPER_DIR` and `SDKROOT` pointed at
  `/Applications/Xcode.app`.
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

### Session: 2026-06-12 20:35

**Tasks Completed**: TASK-003 Step 7 review revision for JavaScript decimal
threshold numeric rendering.
**Tasks In Progress**: None before TASK-009.
**Blockers**: TASK-009 final parity/security/cutover review remains not
started; TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 7 review `comm-000035` found one mid
issue: Swift numeric prompt rendering left `1.0e-6` as `1e-6`, while
TypeScript/Bun `String(number)` and `JSON.stringify` render `1e-6` as
`0.000001`.
**Notes**: Prompt numeric rendering now expands negative exponents for finite
values whose absolute value is within JavaScript's fixed-decimal display range
`>= 1.0e-6 && < 1.0e21`, while keeping `1.0e-7` exponential. Scalar and nested
prompt JSON regressions now cover `1.0e-6` alongside `1.0e20` and
slash-preserving strings. Verification passed: JavaScript reference evidence,
focused prompt tests, and full Xcode `swift test` passed 209 tests with 0
failures.

### Session: 2026-06-12 20:30

**Tasks Completed**: TASK-003 Step 6 self-review revision for slash-preserving
nested prompt JSON string rendering.
**Tasks In Progress**: None before TASK-009.
**Blockers**: TASK-009 final parity/security/cutover review remains not
started; TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 6 self-review `comm-000031` found one mid
issue: the recursive prompt JSON renderer used default JSONEncoder string
encoding, which escaped forward slashes inside nested array/object strings and
diverged from TypeScript/Bun `JSON.stringify`.
**Notes**: Prompt JSON string rendering now uses `.withoutEscapingSlashes`,
preserving URL-like string values inside nested object and array variables.
The nested large-number regression also asserts slash-preserving string output.
Verification passed: JavaScript `JSON.stringify` reference evidence, focused
nested prompt JSON test, and full Xcode `swift test` passed 209 tests with 0
failures.

### Session: 2026-06-12 20:25

**Tasks Completed**: TASK-003 Step 6 self-review revision for nested
TypeScript-compatible JSON number rendering.
**Tasks In Progress**: None before TASK-009.
**Blockers**: TASK-009 final parity/security/cutover review remains not
started; TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 6 self-review `comm-000029` found one mid
issue: array/object prompt rendering still used JSONEncoder compact JSON for
nested numbers, so nested `1.0e20` rendered as `1e+20` instead of TypeScript/Bun
`JSON.stringify` decimal output.
**Notes**: Prompt JSON rendering now recursively uses the same
TypeScript-compatible numeric formatter for array and object values while
preserving deterministic sorted object keys. Added regression coverage for
nested object and array variables containing `1.0e20`. Verification passed:
JavaScript `JSON.stringify` reference evidence and focused nested prompt JSON
test; full Xcode `swift test` passed 209 tests with 0 failures.

### Session: 2026-06-12 20:20

**Tasks Completed**: TASK-003 Step 6 self-review revision for broader
TypeScript-compatible number formatting.
**Tasks In Progress**: None before TASK-009.
**Blockers**: TASK-009 final parity/security/cutover review remains not
started; TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 6 self-review `comm-000027` found one mid
issue: the `1.0e20` formatting fix still used `Decimal(value)` for ordinary
finite numbers, exposing binary approximation tails unlike TypeScript/Bun
`String(number)`.
**Notes**: Numeric prompt rendering now starts from Swift's shortest
round-tripping `String(Double)` output, expands positive exponents below
`1.0e21` to match JavaScript's decimal range, normalizes exponent zero padding,
and strips `.0` from whole numbers. The regression now covers `1.0e20`,
`0.30000000000000004`, `1.2345678901234567`, `1.0e21`, `1.0e-7`, and `0`.
Verification passed: focused number-format test, full Xcode `swift test`
passed 208 tests, and `git diff --check`.

### Session: 2026-06-12 20:15

**Tasks Completed**: TASK-003 Step 7 review revision for TypeScript-compatible
large numeric prompt rendering.
**Tasks In Progress**: None before TASK-009.
**Blockers**: TASK-009 final parity/security/cutover review remains not
started; TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 7 review `comm-000025` reported one mid
finding that the large-number crash fix used compact JSON numeric formatting
instead of the TypeScript/Bun `String(number)` prompt rendering contract.
**Notes**: Prompt rendering now formats finite numbers using TypeScript-like
display rules, including decimal output for `1.0e20` and exponent normalization
for exponential notation. The large-number regression now expects
`100000000000000000000`, matching JavaScript `String(1.0e20)`, while still
avoiding unchecked `Int64` conversion. Verification passed: JavaScript
number-format evidence, focused large-number prompt rendering test, full Xcode
`swift test` passed 208 tests, and `git diff --check`.

### Session: 2026-06-12 20:05

**Tasks Completed**: TASK-003 Step 7 adversarial review revision for numeric
prompt rendering.
**Tasks In Progress**: None before TASK-009.
**Blockers**: TASK-009 final parity/security/cutover review remains not
started; TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000021`
reported one mid finding that large integral JSON numbers could trap during
prompt rendering because `formatTemplateValue` converted integral `Double`
values through unchecked `Int64`.
**Notes**: Prompt rendering now avoids unchecked integer conversion for numeric
`JSONValue` values. Added regression coverage for `{{ total }}` with `1.0e20`.
Verification passed: focused large-number prompt rendering test, full Xcode
`swift test` passed 208 tests, and `git diff --check`.

### Session: 2026-06-12 19:55

**Tasks Completed**: TASK-003 Step 7 review revision for empty configured
prompt templates.
**Tasks In Progress**: None before TASK-009.
**Blockers**: TASK-009 final parity/security/cutover review remains not
started; TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 7 review `comm-000016` reported one mid
finding that configured prompt templates rendering to an empty string were
replaced with step or workflow fallback instructions.
**Notes**: `DeterministicWorkflowRunner` now uses fallback prompt text only when
no `promptTemplate` is configured. Authored configured templates that render
empty after missing/null variable substitution remain empty instead of silently
executing fallback instructions. Added deterministic runner coverage for
`{{ missing.path }}` with a non-empty step description. Verification passed:
focused empty-template runner test, full Xcode `swift test` passed 207 tests,
and `git diff --check`.

### Session: 2026-06-12 19:45

**Tasks Completed**: TASK-003 Step 7 review revision for Swift prompt
composition and prompt variants.
**Tasks In Progress**: None before TASK-009.
**Blockers**: TASK-009 final parity/security/cutover review remains not
started; TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 7 review `comm-000012` reported one mid
finding that deterministic Swift execution still built adapter prompt text from
step or workflow descriptions and never rendered hydrated prompt templates or
applied `WorkflowStepRef.promptVariant`.
**Notes**: `DeterministicWorkflowRunner` now applies prompt variants before
adapter execution, renders session-start, prompt, and system templates with
merged payload/request/message variables, and sends the composed prompt fields
through `AdapterExecutionInput`. Added deterministic regression coverage that
asserts the adapter receives the hydrated variant prompt instead of fallback
text. Verification passed: focused Xcode Swift 6.3.2 runner test, full Xcode
`swift test` passed 206 tests, and `git diff --check`.

### Session: 2026-06-12 19:20

**Tasks Completed**: TASK-003 prompt, JSON, and output envelope closure.
**Tasks In Progress**: None before TASK-009.
**Blockers**: TASK-009 final parity/security/cutover review remains not
started; TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 5 implementation-plan review
`comm-000008` accepted the TASK-002/TASK-003 plan with no high or mid
findings. Low stale TASK-006/TASK-007 module-row cleanup remains unrelated to
the accepted TASK-003 scope.
**Notes**: Added Swift prompt template asset contracts and resolver hydration
for `systemPromptTemplateFile`, `promptTemplateFile`,
`sessionStartPromptTemplateFile`, and prompt variants while preserving authored
file references. Added deterministic Swift tests for prompt rendering fixtures,
template asset loading and rejection diagnostics, output-envelope defaults and
strict validation, business-payload fallback, and escaped-brace JSON candidate
extraction. Runtime-owned publication remains outside backend adapters.
Verification passed: Xcode Swift 6.3.2 `swift --version`, full Xcode
`swift test` passed 205 tests, `bun run typecheck:server`,
`bun run lint:biome`, TypeScript/Bun workflow validation, and
`git diff --check`.

### Session: 2026-06-12 19:05

**Tasks Completed**: TASK-002 verification evidence alignment in the active
plan.
**Tasks In Progress**: TASK-003.
**Blockers**: TASK-003 implementation still must add deterministic Swift prompt
rendering, prompt asset loading, escaped/missing variable, JSON candidate
extraction, and output-envelope normalization coverage before TASK-009.
**Review Feedback Addressed**: Step 3 design review
`riel-codex-design-and-implement-review-loop-1781255384-68cdb70c`
accepted the TASK-002/TASK-003 design update with no high or mid findings.
**Notes**: The plan now mirrors current Xcode Swift 6.3.2 evidence
(`swift test` passed 197 tests with 0 failures on 2026-06-12) and narrows the
next implementation step to TASK-003 contracts while preserving TypeScript/Bun
as production fallback and keeping runtime-owned publication outside backend
adapters.

### Session: 2026-06-12 18:35

**Tasks Completed**: TASK-008 Step 8 documentation refresh after accepted
implementation and adversarial review.
**Tasks In Progress**: None for TASK-008 implementation.
**Blockers**: None for TASK-008. Final Homebrew cutover remains blocked until
TASK-009 accepts parity, security, SQLite persistence, macOS archive smoke, and
adversarial review.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000022`
accepted the checksum-sidecar remediation with no remaining high or mid
findings.
**Notes**: README and workflow skill guidance now record accepted TASK-008
verification: Xcode Swift 6.3.2 `swift test` passed 197 tests, TypeScript/Bun
fallback checks passed, the Swift readiness archive verified from
`dist/swift-homebrew`, and checksum sidecars reject host paths.

### Session: 2026-06-12 18:22

**Tasks Completed**: TASK-008 Step 7 adversarial review revision for portable
checksum sidecars.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-008 implementation.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000017`
reported one mid finding: generated `.sha256` sidecars recorded absolute host
archive paths.
**Notes**: The readiness script now writes checksum sidecars from the archive
directory with the archive basename, and verification covers relocated
`shasum -c` from `dist/swift-homebrew` plus absence of `/Users/`, `/home/`, and
repository-absolute paths in the sidecar.

### Session: 2026-06-12 18:05

**Tasks Completed**: TASK-008 Step 7 review revision for unsafe
`RIEL_VERSION` path construction.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-008 implementation.
**Review Feedback Addressed**: Step 7 review `comm-000012` reported one mid
finding: malformed `RIEL_VERSION` could escape the Swift readiness release
directory before `rm -rf`, copy, tar, or checksum writes.
**Notes**: The readiness script now validates versions, checks containment, and
has deterministic Swift and shell verification for rejected version and
release-directory traversal values.

### Session: 2026-06-12 17:55

**Tasks Completed**: TASK-008 self-review status alignment.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-008 implementation.
**Review Feedback Addressed**: Self-review found stale TASK-008 status rows in
the parent plan module table and `impl-plans/README.md`; both now show
`In Review` instead of pre-implementation `Ready`.
**Notes**: No high or mid self-review findings remain for TASK-008.

### Session: 2026-06-12 17:45

**Tasks Completed**: TASK-008 implementation. Added local-only Swift readiness
archive planning and build surfaces, blocked cutover gate manifest,
deterministic Swift packaging readiness tests, README/Homebrew/QA/design/skill
documentation updates, and parent/focused plan progress updates.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-008 implementation. Final Swift Homebrew cutover
remains blocked until TASK-009 parity, security, persistence, macOS archive
smoke, and adversarial review pass.
**Review Feedback Addressed**: Step 5 implementation-plan review accepted
TASK-008 with no high or mid findings in the supplied workflow input.
**Notes**: Swift readiness artifacts are distinct from Bun production archives:
`dist/swift-homebrew/rielflow-swift-<version>-darwin-arm64.tar.gz` and
`dist/swift-homebrew/rielflow-swift-<version>-darwin-x64.tar.gz` stage
`bin/rielflow` from Xcode SwiftPM. TypeScript/Bun remains the documented
production fallback and Homebrew source.

### Session: 2026-06-12 17:10

**Tasks Completed**: TASK-008 focused implementation plan creation.
**Tasks In Progress**: TASK-008 parent plan/progress alignment.
**Blockers**: None for planning. Implementation must still preserve the
TypeScript/Bun production fallback and avoid release/tap mutation.
**Review Feedback Addressed**: Step 3 design review accepted the TASK-008
design update with no high or mid findings in the supplied workflow input. No
Step 5 implementation-plan feedback was present for this first TASK-008
planning attempt.

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

### Session: 2026-06-12 08:45

**Tasks Completed**: None
**Tasks In Progress**: TASK-002, TASK-003
**Blockers**: None for planning. TASK-006 implementation must remain additive
and contract-only while TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 3 accepted the TASK-006 design update with
no findings; no Step 5 implementation-plan feedback exists for this run.
**Notes**: Created focused TASK-006 implementation plan at
`impl-plans/completed/swift-native-migration-task-006-contracts.md` covering Swift
package manifest validation, declarative add-on execution boundaries, event
trigger dry-run contracts, hook parsing and redaction-safe recording, GraphQL
DTO/control-plane contracts, server request descriptors, no-side-effect
constraints, and verification commands.

### Session: 2026-06-12 08:40

**Tasks Completed**: TASK-006.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 5 accepted the TASK-006 focused
implementation plan with no high or mid findings; no Step 7 feedback exists
for this implementation run.
**Notes**: Implemented the focused TASK-006 contract slice across
`RielflowAddons`, `RielflowEvents`, `RielflowHook`, `RielflowGraphQL`, and
`RielflowServer`. Added deterministic XCTest coverage for manifest validation,
add-on resolver isolation, event dry-runs, hook parsing/redaction, GraphQL DTO
projection, and server descriptors. Xcode Swift 6.3.2 `swift test` passed 113
tests; TypeScript/Bun fallback checks and targeted no-side-effect probes
passed.

### Session: 2026-06-12 08:46

**Tasks Completed**: TASK-006 self-review fixes.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None.
**Review Feedback Addressed**: Step 6 self-review found package manifest parity
gaps before independent review: `"."` package-relative paths were rejected and
nested manifest objects did not fail closed on unsupported keys.
**Notes**: Tightened `RielflowAddons` manifest decoding and added focused
regressions. Xcode Swift 6.3.2 `swift test` passed 113 tests; TypeScript/Bun
fallback checks passed.

### Session: 2026-06-12 08:56

**Tasks Completed**: TASK-006 Step 7 review revision.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 7 review `comm-000012` reported two mid
findings: Swift package manifest metadata/validation parity gaps and event
validation parity gaps versus the TypeScript contracts.
**Notes**: Added TS-compatible manifest metadata fields, dependency string
decoding, add-on capabilities/content-digest validation, node-addon metadata
validation, file-change and s3-repository event source contracts, template
reference validation, and output-destination validation. Xcode Swift 6.3.2
`swift test` passed 113 tests; TypeScript/Bun fallback checks passed.

### Session: 2026-06-12 09:01

**Tasks Completed**: TASK-006 Step 6 self-review decoder hardening.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Implementation author self-review found newly
added and previously uncovered nested package manifest DTOs could still ignore
unsupported keys.
**Notes**: Added unsupported-key rejection for add-on capabilities, workflow
metadata, integrity metadata, and signatures, plus deterministic decoder
regressions. Xcode Swift 6.3.2 `swift test` passed 113 tests; TypeScript/Bun
fallback checks passed.

### Session: 2026-06-12 09:10

**Tasks Completed**: TASK-006 Step 7 review revision for capability grants and
event template dry-run mapping.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 7 review `comm-000016` reported two mid
findings: incomplete add-on capability/capabilityGrant parity and dry-run
input mapping that did not render TypeScript-compatible event templates.
**Notes**: Added capability name, defaultPolicy, sensitive reason, duplicate,
scope, and dependency capabilityGrant validation. Added event-input/template
dry-run mapping with event, source, and binding roots, exact-reference object
preservation, array traversal, and deterministic regressions. Xcode Swift 6.3.2
`swift test` passed 115 tests.

### Session: 2026-06-12 09:21

**Tasks Completed**: TASK-006 Step 7 review revision for event binding match
contracts and hook event-name catalog parity.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 7 review `comm-000020` reported two mid
findings: event binding dry-run matching omitted enabled/match rules and hook
event normalization omitted the full TypeScript hook event catalog.
**Notes**: Added EventBindingContract enabled and match rules with eventType,
conversationId, and pathPrefix dry-run matching. Expanded hook event
normalization to the full known TypeScript HookEventName catalog and added
deterministic regressions. Xcode Swift 6.3.2 `swift test` passed 117 tests.

### Session: 2026-06-12 09:24

**Tasks Completed**: TASK-006 Step 6 self-review optional enabled decoding
fix.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Implementation author self-review found Swift
synthesized Decodable would require `enabled` on event sources and bindings,
even though the TypeScript event config treats it as optional.
**Notes**: Added custom decoding defaults for EventSourceContract.enabled and
EventBindingContract.enabled, plus a deterministic decoding regression. Xcode
Swift 6.3.2 `swift test` passed 118 tests.

### Session: 2026-06-12 09:32

**Tasks Completed**: TASK-006 Step 7 review revision for HookContext backward
decoding.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 7 review `comm-000024` reported one mid
finding: HookContext Codable decode required newly added non-optional fields
and broke pre-TASK-006 minimal JSON.
**Notes**: Added custom HookContext decoding defaults for vendor, eventName,
workingDirectory, and backendMetadata, plus a deterministic regression for the
pre-TASK-006 shape. Xcode Swift 6.3.2 `swift test` passed 119 tests.

### Session: 2026-06-12 09:45

**Tasks Completed**: TASK-006 Step 7 review revision for event binding and
input mapping TypeScript parity.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
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

**Tasks Completed**: TASK-006 Step 7 review revision for event runtime
variables, GraphQL schema contract, and hook context resolution parity.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
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

**Tasks Completed**: TASK-006 Step 7 review revision for add-on
execution-artifact validation and authored event mailbox bridge policy.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 7 review `comm-000036` reported two mid
findings: add-on manifest validation did not preserve TypeScript
execution-artifact safety, and EventBindingContract omitted authored
mailboxBridge policy overrides.
**Notes**: Tightened add-on source/execution artifact path and descriptor
validation, added authored EventMailboxBridgePolicy decoding and dry-run
application, and added deterministic regressions. Xcode Swift 6.3.2
`swift test` passed 129 tests.

### Session: 2026-06-12 10:21

**Tasks Completed**: TASK-006 Step 7 review revision for TypeScript-shaped
event source config, mailboxBridge validation, and GraphQL envelope parsing.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 7 review `comm-000040` reported three mid
findings: EventSourceContract missed TypeScript webhook/S3 keys, mailboxBridge
consumer compatibility validation was missing, and GraphQL envelope parsing
did not trim/normalize query, operationName, and variables like TypeScript.
**Notes**: Added TypeScript-shaped webhook and nested S3 event source
decode/encode support, mailboxBridge consumer mode validation, GraphQL query
and operationName trimming plus variables null normalization, and deterministic
regressions. Xcode Swift 6.3.2 `swift test` passed 131 tests.

### Session: 2026-06-12 10:32

**Tasks Completed**: TASK-006 Step 7 review revision for effective event HTTP
route validation and server ambient manager environment stripping.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
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

**Tasks Completed**: TASK-006 Step 7 adversarial review revision for package
bundle existence validation and chat-sdk webhook route parity.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
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

**Tasks Completed**: TASK-006 Step 6 self-review hardening for chat-sdk
webhook required-field parity.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 6 self-review after `comm-000050`
confirmed `comm-000049` was fixed and tightened chat-sdk validation to reject
missing webhook configuration before independent review.
**Notes**: Added `hasChatWebhook` tracking, required chat-sdk webhook/path/auth
diagnostics, updated chat dry-run fixtures to use valid webhook contracts, and
re-ran targeted and full Swift tests. Xcode Swift 6.3.2 `swift test` passed
135 tests.

### Session: 2026-06-12 11:04

**Tasks Completed**: TASK-006 Step 7 adversarial review revision for hook
metadata redaction and duplicate-safe server header normalization.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000054`
reported two mid findings: `HookParsing.parse` copied raw sensitive hook
payloads into public `HookContext.backendMetadata`, and server header
normalization could trap on duplicate mixed-case headers.
**Notes**: Redacted parsed hook backendMetadata with the existing hook
redaction policy, replaced header normalization with deterministic duplicate
handling, and added focused regressions. Xcode Swift 6.3.2 `swift test`
passed 137 tests.

### Session: 2026-06-12 11:18

**Tasks Completed**: TASK-006 Step 7 review revision for chat-sdk provider and
event type capability validation parity.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 7 review `comm-000058` reported one mid
finding: chat-sdk event validation accepted missing or unsupported providers
and did not reject binding `match.eventType` values unsupported by the
TypeScript chat-sdk provider capability set.
**Notes**: Added Swift chat-sdk provider validation for the TypeScript provider
set, provider event-type capability validation for binding `match.eventType`,
and deterministic validation and dry-run regressions. Xcode Swift 6.3.2
`swift test` passed 141 tests.

### Session: 2026-06-12 11:46

**Tasks Completed**: TASK-006 Step 7 review revision for top-level chat-sdk
binding `eventType` capability validation.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 7 review `comm-000062` reported one mid
finding: chat-sdk capability validation checked only binding `match.eventType`
while dry-run matching also honors top-level `EventBindingContract.eventType`.
**Notes**: Applied the same provider capability validation to top-level
chat-sdk binding `eventType`, and added deterministic validation and dry-run
regressions for unsupported top-level chat-sdk event types. Xcode Swift 6.3.2
`swift test` passed 143 tests.

### Session: 2026-06-12 11:58

**Tasks Completed**: TASK-006 Step 7 adversarial review revision for local-only
package manifest loading and canonical hook payload hashes.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000067`
reported two mid findings: `FileWorkflowPackageManifestLoader` accepted
non-file URLs through `Data(contentsOf:)`, and hook payload hashes depended on
unsorted JSON encoder dictionary output.
**Notes**: Added deterministic non-file URL rejection before manifest reads,
canonicalized hook payload hash encoding with sorted JSON keys, and added
focused regressions. Xcode Swift 6.3.2 `swift test` passed 145 tests.

### Session: 2026-06-12 12:09

**Tasks Completed**: TASK-006 Step 7 review revision for manifest tag presence
and package-relative traversal rejection.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
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

**Tasks Completed**: TASK-006 Step 6 self-review hardening for null tag
decoding.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 6 self-review confirmed `comm-000071` was
fixed and tightened tag decoding to reject explicit JSON `null`, matching the
TypeScript manifest requirement that `tags` must be an array of strings.
**Notes**: Changed decoded tag handling to decode `[String]` when the field is
present instead of accepting `null` through `decodeIfPresent`, and added
regressions for top-level and workflow metadata `tags: null`. Xcode Swift
6.3.2 `swift test` passed 147 tests.

### Session: 2026-06-12 12:23

**Tasks Completed**: TASK-006 Step 7 adversarial review revision for
continue-session GraphQL input contract parity.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
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

**Tasks Completed**: TASK-006 Step 7 adversarial review revision for add-on
built-in source trust and portable package-relative path validation.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-006. The migration remains additive and
TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000081`
reported two mid findings: `DeterministicAddonResolver` allowed package
add-ons to spoof built-in names through `allowedBuiltins`, and
`normalizePackageRelativePath` did not reject Windows absolute paths.
**Notes**: Required built-in resolution to have trusted `source.builtin`
metadata and an allowed built-in name, rejected Windows absolute paths in
general package-relative path normalization, and added focused regressions for
built-in spoofing plus `C:\...` and UNC path rejection. Xcode Swift 6.3.2
`swift test` passed 149 tests.

### Session: 2026-06-12 13:05

**Tasks Completed**: TASK-007 implementation plan creation.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-007 planning. The migration remains additive and
TypeScript/Bun remains the production fallback.
**Review Feedback Addressed**: Step 3 design review accepted the TASK-007
design update with no findings; no Step 5 implementation-plan feedback exists
for this first TASK-007 planning attempt.
**Notes**: Added focused plan
`impl-plans/completed/swift-native-migration-task-007-cli-parity.md` covering
Swift CLI parser/test target, workflow resolution, in-memory node patching,
validate, inspect, deterministic mock scenario, local run, verification, and
progress closure. The plan preserves TASK-005 runtime publication ownership,
TASK-006 contract surfaces, TypeScript/Bun fallback, and no-live-credential
test constraints.

### Session: 2026-06-12 13:24

**Tasks Completed**: TASK-007 implementation. Added additive Swift
`workflow validate`, `workflow inspect`, and deterministic local `workflow run`
parity under `RielflowCLI`, with scenario-backed mock execution through the
Swift in-memory runtime publication boundary.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback, and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 5 implementation-plan review accepted
TASK-007 with no high or mid findings; no Step 7 rerun feedback was supplied
for this implementation attempt.
**Notes**: Swift CLI parser, resolver, node patch, validate, inspect, scenario step-id lookup,
and deterministic run coverage was added in `Tests/RielflowCLITests`. Xcode
Swift 6.3.2 `swift test` passed 155 tests. TypeScript/Bun fallback validation,
`bun run typecheck:server`, `bun run lint:biome`, `git diff --check`, and
`jq empty impl-plans/PROGRESS.json` passed.

### Session: 2026-06-12 13:42

**Tasks Completed**: TASK-007 Step 7 review revision for deterministic Swift
CLI run publication and option handling.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback, and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 review `comm-000012` reported two mid
findings: deterministic run failures bypassed TASK-005 failed-step publication,
and Swift run options were silently ignored.
**Notes**: TASK-007 now records adapter, scenario, completion, contract, and
unsupported-transition failures via the runtime publication boundary, applies
`maxLoopIterations`, propagates timeout deadlines, and rejects unsupported
artifact/session-store/concurrency options with usage errors. Added focused
Swift core and CLI regressions; `swift test --filter
DeterministicWorkflowRunnerTests` and `swift test --filter RielflowCLITests`
passed under Xcode Swift 6.3.2. Full `swift test` passed 163 tests, Swift
validate/inspect/run smokes passed, unsupported run-option smoke returned
usage exit code 2, and TypeScript/Bun fallback checks passed.

### Session: 2026-06-12 13:55

**Tasks Completed**: TASK-007 Step 7 review revision for Swift CLI remote flag
rejection and JSON failure output.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback, and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 review `comm-000016` reported two mid
findings: validate/inspect ignored unsupported remote resolution flags, and run
JSON failures were not parseable from stdout.
**Notes**: Added validate/inspect endpoint/registry rejection with usage exit
coverage and a deterministic run failure JSON envelope for `--output json`.
Focused Swift CLI and deterministic runner tests passed under Xcode Swift
6.3.2. Full `swift test` passed 166 tests, Swift success/failure smokes
passed, and TypeScript/Bun fallback checks passed.

### Session: 2026-06-12 14:04

**Tasks Completed**: TASK-007 Step 7 review revision for deterministic
output-contract retry attempts.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback, and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 review `comm-000020` reported one mid
finding: deterministic run did not honor `NodeOutputContract.maxValidationAttempts`
or advance scenario sequence responses across output validation retries.
**Notes**: `DeterministicWorkflowRunner` now retries output validation attempts
deterministically, records real attempt numbers through TASK-005 publication,
and preserves no-message behavior for rejected attempts. Added Swift coverage
for invalid-then-valid scenario sequence output contract retry. Focused Swift
CLI and deterministic runner tests passed; full `swift test` passed 167 tests;
TypeScript/Bun fallback checks passed.

### Session: 2026-06-12 14:15

**Tasks Completed**: TASK-007 Step 7 adversarial review revision for multiple
direct transition handling.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback, and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000025`
reported one mid finding: deterministic run could append multiple downstream
messages but execute only the first, creating misleading completion.
**Notes**: The TASK-007 sequential runner now fails closed before publication
when more than one direct transition is publishable from one adapter output,
records the failure through TASK-005 publication, and appends no downstream
messages. Added Swift regression coverage. Full `swift test` passed 168 tests;
TypeScript/Bun fallback checks passed.

### Session: 2026-06-12 14:23

**Tasks Completed**: TASK-007 Step 7 review revision for normalized
multi-transition fail-closed handling.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback, and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 review `comm-000029` reported one mid
finding: the TASK-007 sequential runner counted publishable transitions before
normalizing output-contract envelopes, leaving an envelope `when` path that
could still publish multiple direct messages while only the first downstream
step ran.
**Notes**: `DeterministicWorkflowRunner` now normalizes adapter output before
the multiple-direct-transition check and uses the same `when` map as runtime
publication. Added Swift coverage for envelope-overridden labels causing a
fail-closed failed execution with no accepted output and no messages. Focused
`DeterministicWorkflowRunnerTests` passed 9 tests; full `swift test` passed
169 tests; `git diff --check` and `jq empty impl-plans/PROGRESS.json` passed.

### Session: 2026-06-12 14:32

**Tasks Completed**: TASK-007 Step 7 review revision for parseable validate
JSON failures.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback, and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 review `comm-000033` reported one mid
finding: `workflow validate --output json` did not keep load, invalid workflow,
node-patch, or preflight failures machine-readable on stdout.
**Notes**: `WorkflowValidateCommand` now returns a
`WorkflowValidationFailureResult` JSON envelope for validate failures when
JSON output is requested, preserving text stderr behavior. Added Swift CLI
coverage for missing workflows, invalid workflow diagnostics, and malformed
node-patch JSON. Focused `RielflowCLITests` passed 14 tests; full `swift test`
passed 172 tests; the missing-workflow JSON smoke parsed with `jq`;
`git diff --check` and `jq empty impl-plans/PROGRESS.json` passed.

### Session: 2026-06-12 14:42

**Tasks Completed**: TASK-007 Step 7 adversarial review revision for parseable
inspect JSON failures.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback, and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000038`
reported one mid finding: `workflow inspect --output json` still returned no
structured stdout on resolver or validation failures.
**Notes**: `WorkflowInspectCommand` now mirrors validate/run failure behavior
with a `WorkflowInspectionFailureResult` JSON envelope for inspect failures
when JSON output is requested. Added Swift CLI coverage for missing workflow
and invalid workflow diagnostics inspect failure paths. Focused
`RielflowCLITests` passed 16 tests; full `swift test` passed 174 tests; the
missing-workflow inspect JSON smoke parsed with `jq`; `git diff --check` and
`jq empty impl-plans/PROGRESS.json` passed.

### Session: 2026-06-12 14:54

**Tasks Completed**: TASK-007 Step 7 adversarial review revision for
parser-stage JSON failure envelopes.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback, and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000043`
reported one mid finding: parser-stage workflow usage errors still bypassed
JSON failure rendering even when raw arguments requested `--output json`.
**Notes**: `RielflowCLIApplication` now renders parser-stage usage failures as
command-specific JSON envelopes for workflow validate, inspect, and run when
`--output json` is present, keeping exit code 2 and empty stderr. Added Swift
CLI coverage for run `--endpoint`, validate unknown option, and inspect
missing value parser failures with parseable JSON stdout.
Focused `RielflowCLITests` passed 19 tests, full `swift test` passed 177
tests, built-executable parser JSON smokes passed with empty stderr, and
`git diff --check` plus `jq empty impl-plans/PROGRESS.json` passed.

### Session: 2026-06-12 15:07

**Tasks Completed**: TASK-007 Step 7 review revision for inspect callable
contract parity.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback, and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 review `comm-000047` reported one mid
finding: Swift inspect did not preserve callable step id, role, input, and
output contracts from node payloads.
**Notes**: Swift node payloads now decode `input` contracts alongside
`output`, and `WorkflowInspectCommand` derives the callable contract from the
workflow manager or entry step instead of requiring an output jsonSchema. Added
Swift CLI regression coverage for the project workflow manager callable
input/output descriptions and verified Swift inspect JSON with `jq`.
Focused `RielflowCLITests` passed 20 tests, full `swift test` passed 178
tests, `git diff --check` and `jq empty impl-plans/PROGRESS.json` passed, and
the Swift inspect callable smoke parsed with `jq`.

### Session: 2026-06-12 15:22

**Tasks Completed**: TASK-007 Step 7 adversarial review revision for scoped
workflow name safety and addon-only executable preflight parity.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback, and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000052`
reported two mid findings: scoped resolution could escape project/user
workflow roots, and executable validation marked addon-only workflows runnable
even though deterministic run failed immediately.
**Notes**: Scoped project/user workflow names now use the TypeScript/Bun safe
token rule and candidate directories are standardized and containment-checked.
Swift executable preflight now reports addon-only nodes unsupported unless a
payload is available. Added Swift CLI regression coverage for traversal/slash
scoped targets and addon-only validate/run consistency.
Focused `RielflowCLITests` passed 22 tests, full `swift test` passed 180
tests, built-executable traversal/addon smokes passed with parseable JSON and
empty stderr, and `git diff --check` plus `jq empty impl-plans/PROGRESS.json`
passed.

### Session: 2026-06-12 15:34

**Tasks Completed**: TASK-007 Step 7 review revision for symlink-safe scoped
workflow containment.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback, and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 review `comm-000056` reported one mid
finding: scoped project/user workflow containment did not resolve symlinks
before accepting candidate directories.
**Notes**: Swift scoped workflow resolution now resolves symlink targets for
candidate directories and scope roots before containment checks, then loads
workflow and node files only from the accepted resolved directory. Added Swift
CLI regression coverage for validate, inspect, and run rejecting a safe-name
symlink that points outside `.rielflow/workflows`.
Focused `RielflowCLITests` passed 23 tests, full `swift test` passed 181
tests, built-executable symlink smokes passed with parseable JSON and empty
stderr, and `git diff --check` plus `jq empty impl-plans/PROGRESS.json`
passed.

### Session: 2026-06-12 15:43

**Tasks Completed**: TASK-007 Step 7 review revision for symlink-safe workflow
and node payload file reads.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback, and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 review `comm-000060` reported two mid
findings: scoped resolution still followed symlinked `workflow.json` and node
payload files outside the project/user workflow root.
**Notes**: Swift scoped workflow resolution now resolves `workflow.json` and
node payload file targets before reading and containment-checks the resolved
file paths for project/user scopes. Added Swift CLI regression coverage for
validate, inspect, and run rejecting symlinked `workflow.json` and symlinked
node payload file escapes under `.rielflow/workflows/<safe-name>`.
Focused `RielflowCLITests` passed 25 tests, full `swift test` passed 183
tests, built-executable symlink file smokes passed with parseable JSON and
empty stderr, and `git diff --check` plus `jq empty impl-plans/PROGRESS.json`
passed.

### Session: 2026-06-12 16:01

**Tasks Completed**: TASK-007 Step 7 adversarial review revision for
transition branch expression parity.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback, and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000065`
reported one mid finding: Swift deterministic run did not evaluate existing
transition branch expressions such as `!(needs_revision)`.
**Notes**: Added shared Swift branch expression evaluation and wired it into
runtime publication plus the deterministic runner's multiple-transition safety
check. Added Swift core coverage for negated labels, compound expressions,
payload fallback, successful negated-transition runs, and expression-based
multiple transition fail-closed behavior.
Focused core tests passed 13 tests, full `swift test` passed 187 tests, a
built-executable negated-transition smoke passed with parseable JSON and empty
stderr, and `git diff --check` plus `jq empty impl-plans/PROGRESS.json`
passed.

### Session: 2026-06-12 16:21

**Tasks Completed**: TASK-007 Step 7 adversarial review revision for mock
scenario sequence parity across repeated step executions.
**Tasks In Progress**: TASK-002, TASK-003.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback, and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000070`
reported one mid finding: Swift mock scenario sequence selection used per-step
call counts instead of the TypeScript execution index and validation attempt
formula.
**Notes**: Swift adapter inputs now carry `executionIndex` and output attempt
context; the deterministic runner fills them per step execution and output
attempt; and the scenario adapter selects mock responses with the
TypeScript/Bun formula. Added regression coverage for repeated step execution
with `maxValidationAttempts > 1` and an unused retry-slot scenario response.
Focused Swift tests passed 39 tests, full `swift test` passed 188 tests, the
built-executable retry-slot smoke passed with parseable JSON and empty stderr,
and `git diff --check` plus `jq empty impl-plans/PROGRESS.json` passed.
