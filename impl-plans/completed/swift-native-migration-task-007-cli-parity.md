# Swift Native Migration TASK-007 CLI Parity Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-swift-native-migration.md#task-007-swift-cli-validate-inspect-and-deterministic-run-parity`
**Created**: 2026-06-12
**Last Updated**: 2026-06-12

## Related Plans

- **Parent**: `impl-plans/active/swift-native-migration.md` (`TASK-007`)
- **Depends On**: `impl-plans/completed/swift-native-migration-task-005-runtime-session.md`
- **Depends On**: `impl-plans/completed/swift-native-migration-task-006-contracts.md`
- **Unblocks**: `impl-plans/active/swift-native-migration.md` (`TASK-008`, `TASK-009`)

## Design Reference

Source of truth:

- `design-docs/specs/design-swift-native-migration.md#task-007-swift-cli-validate-inspect-and-deterministic-run-parity`
- `design-docs/specs/design-swift-native-migration.md#data-flow`
- `design-docs/specs/design-swift-native-migration.md#verification-gates`
- `design-docs/specs/command.md#swift-native-migration-cli-parity`
- `design-docs/specs/command.md#workflow-validate-name`
- `design-docs/specs/command.md#workflow-inspect-name`
- `design-docs/specs/command.md#workflow-run-name-or-registry-target`
- `impl-plans/active/swift-native-migration.md`
- `impl-plans/completed/swift-native-migration-task-005-runtime-session.md`
- `impl-plans/completed/swift-native-migration-task-006-contracts.md`

Implement additive Swift `RielflowCLI` parity for `workflow validate`,
`workflow inspect`, and deterministic local `workflow run` / mock execution.
TypeScript/Bun remains the production fallback, and release packaging cutover
is not part of this plan.

In scope:

- Parse `workflow validate`, `workflow inspect`, and deterministic local
  `workflow run` options under `Sources/RielflowCLI`.
- Resolve direct, project, and user workflow bundles without mutating checkout,
  package, event, hook, or registry metadata.
- Apply `--node-patch` in memory only for validate and run.
- Render text and JSON outputs that preserve TypeScript/Bun intent for the
  supported subset.
- Execute deterministic mock scenarios through TASK-005 runtime session,
  message publication, output validation, and candidate normalization APIs.
- Add Swift CLI tests with injected filesystems, stores, clocks, adapters,
  readiness probes, and deterministic fixtures.

Out of scope:

- Replacing the TypeScript/Bun executable, release artifacts, or Homebrew
  formula.
- Registry-backed `workflow run --from-registry`, remote `--endpoint`, package
  checkout/install mutation, live gateway/server loops, live agent credential
  requirements, or live local agent process smoke tests.
- Allocating workflow communication ids in CLI code or bypassing runtime-owned
  output publication.
- Moving Cursor-specific mode, stream format, or auth details into shared CLI
  or `RielflowCore` concepts.

## Issue Reference

- Workflow mode: `issue-resolution`
- Workflow ID: `codex-design-and-implement-review-loop`
- Node: `step4-impl-plan-create`
- Repository: `tacogips/rielflow`
- Issue title: `Implement Swift CLI parity commands for workflow validate inspect and deterministic mock run`
- GitHub issue: none supplied by runtime input
- Target feature area: `Swift native migration TASK-007 CLI parity slice`
- Requested behavior: implement additive Swift CLI command parsing and
  deterministic behavior under `RielflowCLI` while preserving TypeScript/Bun
  fallback and Swift package boundaries.

## Codex Agent References

- Preferred local root `../../codex-agent`: unavailable in this checkout.
- Observed adjacent reference only: `../codex-agent/dist/sdk/mock-session-runner.d.ts`
- Relevant principle from the adjacent reference: deterministic mock sessions
  use synthetic sessions, recorded calls, injected options, explicit
  completion, and no live Codex process.
- TypeScript/Bun local references:
  - `packages/rielflow/src/cli/argument-parser.ts`
  - `packages/rielflow/src/cli/workflow-command-handler.ts`
  - `packages/rielflow/src/cli/workflow-run-command.ts`
  - `packages/rielflow/src/workflow/scenario-adapter.ts`
  - `packages/rielflow/src/workflow/engine/workflow-runner.ts`
  - `packages/rielflow/src/workflow/engine/step-result-finalization.ts`

Intentional divergences accepted by design:

- Swift implements only deterministic local CLI parity in this slice.
- Swift CLI tests must use injected deterministic probes and adapters instead
  of live Codex, Claude, Cursor, OpenAI, Anthropic, network, or credential
  dependencies.
- Swift can introduce CLI-local DTOs and renderers, but workflow/session/message
  semantics remain owned by `RielflowCore`.

## Modules

### 1. CLI Parser And Test Target

#### `Package.swift`
#### `Sources/RielflowCLI/RielflowCommand.swift`
#### `Sources/RielflowCLI/CLIOptions.swift`
#### `Tests/RielflowCLITests/CommandParsingTests.swift`

**Status**: COMPLETED

```swift
public enum RielflowCommand: Equatable, Sendable {
  case version
  case workflow(WorkflowCommand)
}

public enum WorkflowCommand: Equatable, Sendable {
  case validate(WorkflowValidateOptions)
  case inspect(WorkflowInspectOptions)
  case run(WorkflowRunOptions)
}

public enum WorkflowOutputFormat: String, Codable, Sendable {
  case text
  case json
}

public enum CLIExitCode: Int32, Sendable {
  case success = 0
  case failure = 1
  case usage = 2
}

public protocol CLIArgumentParsing: Sendable {
  func parse(_ arguments: [String]) throws -> RielflowCommand
}
```

**Checklist**:

- [x] Add `RielflowCLITests` to `Package.swift`.
- [x] Preserve public option spellings and value requirements from
      TypeScript/Bun for the supported subset.
- [x] Reject malformed enum values, missing option values, unknown options, and
      unsupported endpoint/registry flags with usage exit code `2`.
- [x] Keep JSON stdout parseable; verbose/debug/progress diagnostics must not
      be written to JSON stdout.

### 2. Workflow Loading And In-Memory Patch Resolution

#### `Sources/RielflowCLI/WorkflowResolution.swift`
#### `Sources/RielflowCLI/NodePatchOptions.swift`
#### `Tests/RielflowCLITests/WorkflowResolutionTests.swift`

**Status**: COMPLETED

```swift
public enum WorkflowScope: String, Codable, Sendable {
  case auto
  case project
  case user
  case direct
}

public struct WorkflowResolutionOptions: Equatable, Sendable {
  public var workflowName: String
  public var scope: WorkflowScope
  public var workflowDefinitionDir: String?
  public var workingDirectory: String
}

public struct ResolvedWorkflowBundle: Equatable, Sendable {
  public var workflow: WorkflowDefinition
  public var sourceScope: WorkflowScope
  public var workflowDirectory: String
  public var diagnostics: [WorkflowValidationDiagnostic]
}

public protocol WorkflowBundleResolving: Sendable {
  func resolve(_ options: WorkflowResolutionOptions) throws -> ResolvedWorkflowBundle
}

public protocol WorkflowNodePatchApplying: Sendable {
  func applyNodePatch(_ patch: JSONObject, to workflow: WorkflowDefinition) throws -> WorkflowDefinition
}
```

**Checklist**:

- [x] Load direct `--workflow-definition-dir` bundles and scoped
      project/user/auto bundles through the same conceptual resolution path.
- [x] Apply `--node-patch <json|@file|file>` to reusable node ids in memory
      only.
- [x] Reject unknown node ids, arrays/scalars, malformed JSON, unreadable files,
      and patch fields other than `executionBackend`, `model`, and `effort`.
- [x] Prove patch application does not write `workflow.json`, node JSON,
      package manifests, event configs, hook records, registry records, or
      checkout metadata.

### 3. `workflow validate` Command

#### `Sources/RielflowCLI/WorkflowValidateCommand.swift`
#### `Sources/RielflowCLI/WorkflowValidationOutput.swift`
#### `Tests/RielflowCLITests/WorkflowValidateCommandTests.swift`

**Status**: COMPLETED

```swift
public struct WorkflowValidateOptions: Equatable, Sendable {
  public var workflowName: String
  public var resolution: WorkflowResolutionOptions
  public var output: WorkflowOutputFormat
  public var executable: Bool
  public var nodePatch: String?
}

public struct WorkflowValidationCommandResult: Codable, Equatable, Sendable {
  public var valid: Bool
  public var workflowId: String
  public var sourceScope: WorkflowScope
  public var workflowDirectory: String
  public var diagnostics: [WorkflowValidationDiagnostic]
  public var nodeValidationResults: [NodeValidationResult]
}

public protocol WorkflowExecutablePreflighting: Sendable {
  func preflight(_ workflow: WorkflowDefinition) async throws -> [NodeValidationResult]
}
```

**Checklist**:

- [x] Keep structural validation passive by default.
- [x] Support `--executable` through injected deterministic readiness/preflight
      probes only.
- [x] Return exit code `0` for valid workflows, `1` for load/validation
      failures, and `2` for usage errors.
- [x] Preserve loaded add-on node validation results before adding active
      backend preflight results.
- [x] Cover text and JSON output for direct and scoped resolution.

### 4. `workflow inspect` Command

#### `Sources/RielflowCLI/WorkflowInspectCommand.swift`
#### `Sources/RielflowCLI/WorkflowInspectionSummary.swift`
#### `Sources/RielflowCLI/WorkflowInspectionRendering.swift`
#### `Tests/RielflowCLITests/WorkflowInspectCommandTests.swift`

**Status**: COMPLETED

```swift
public struct WorkflowInspectOptions: Equatable, Sendable {
  public var workflowName: String
  public var resolution: WorkflowResolutionOptions
  public var output: WorkflowOutputFormat
  public var structure: Bool
}

public struct WorkflowInspectionSummary: Codable, Equatable, Sendable {
  public var workflowId: String
  public var sourceScope: WorkflowScope
  public var workflowDirectory: String
  public var entryStepId: String
  public var managerStepId: String?
  public var stepIds: [String]
  public var nodeRegistryIds: [String]
  public var crossWorkflowDispatchIds: [String]
  public var counts: WorkflowInspectionCounts
  public var callable: WorkflowCallableInspection
}

public protocol WorkflowInspectionRendering: Sendable {
  func renderText(_ summary: WorkflowInspectionSummary) -> String
  func renderStructure(_ workflow: WorkflowDefinition) -> String
  func renderJSON(_ summary: WorkflowInspectionSummary) throws -> Data
}
```

**Checklist**:

- [x] Report step-addressed structure, source scope/path, entry/manager step
      ids, node registry ids, counts, callable contracts, add-on source
      summaries, defaults, and readiness descriptors.
- [x] Keep `--structure` text-only and compact: step id line followed by a
      description line or `-`.
- [x] Ensure `--output json --structure` still returns the full inspection
      summary, not the compact projection.
- [x] Preserve nested callable `input.jsonSchema` in JSON without stringifying.
- [x] Include copyable variables examples in full text output when callable
      input metadata is present.

### 5. Deterministic Mock Scenario And Runtime Runner

#### `Sources/RielflowAdapters/ScenarioNodeAdapter.swift`
#### `Sources/RielflowCore/DeterministicWorkflowRunner.swift`
#### `Tests/RielflowAdaptersTests/ScenarioNodeAdapterTests.swift`
#### `Tests/RielflowCoreTests/DeterministicWorkflowRunnerTests.swift`

**Status**: COMPLETED

```swift
public struct WorkflowMockScenario: Codable, Equatable, Sendable {
  public var responses: [String: [AdapterExecutionOutput]]
}

public protocol MockScenarioLoading: Sendable {
  func loadScenario(at path: String) throws -> WorkflowMockScenario
}

public actor ScenarioNodeAdapter: NodeAdapter {
  public init(scenario: WorkflowMockScenario, fallback: any NodeAdapter)
}

public struct DeterministicWorkflowRunRequest: Sendable {
  public var workflow: WorkflowDefinition
  public var variables: JSONObject
  public var maxSteps: Int?
  public var maxConcurrency: Int?
  public var maxLoopIterations: Int?
  public var defaultTimeoutMs: Int?
}

public protocol DeterministicWorkflowRunning: Sendable {
  func run(_ request: DeterministicWorkflowRunRequest) async throws -> WorkflowRunResult
}
```

**Checklist**:

- [x] Match TypeScript `ScenarioNodeAdapter` response lookup by step/node
      execution id and sequence consumption.
- [x] Fall back to deterministic local adapter behavior for missing scenario
      entries.
- [x] Advance output-contract retry attempts deterministically.
- [x] Use TASK-005 session, message input resolution, output validation,
      candidate normalization, and publication APIs.
- [x] Fail deterministic sessions without fabricated downstream messages for
      provider failure, scenario failure, `completionPassed: false`, invalid
      contracts, unsupported transitions, and message append failures.

### 6. `workflow run` Deterministic Local Command

#### `Sources/RielflowCLI/WorkflowRunCommand.swift`
#### `Sources/RielflowCLI/WorkflowRunOutput.swift`
#### `Tests/RielflowCLITests/WorkflowRunCommandTests.swift`

**Status**: COMPLETED

```swift
public struct WorkflowRunOptions: Equatable, Sendable {
  public var target: String
  public var resolution: WorkflowResolutionOptions?
  public var variables: String?
  public var nodePatch: String?
  public var mockScenarioPath: String?
  public var output: WorkflowOutputFormat
  public var maxSteps: Int?
  public var maxConcurrency: Int?
  public var maxLoopIterations: Int?
  public var defaultTimeoutMs: Int?
  public var timeoutMs: Int?
  public var artifactRoot: String?
  public var sessionStore: String?
  public var workingDirectory: String
}

public struct WorkflowRunResult: Codable, Equatable, Sendable {
  public var workflowId: String
  public var session: WorkflowSession
  public var rootOutput: JSONObject?
  public var exitCode: CLIExitCode
}
```

**Checklist**:

- [x] Accept `--variables <json|@file|file>` and reject arrays, scalars,
      malformed JSON, and unreadable files before execution.
- [x] Accept bounded run options from the design and reject remote endpoint or
      registry-backed execution in this slice.
- [x] Support deterministic temporary workflow JSON fixture runs where the
      existing Swift model can load them.
- [x] Keep `--output json` stdout machine parseable.
- [x] Return exit code `0` for terminal successful mock execution, `1` for
      load/validation/execution failures, and `2` for usage errors.

### 7. Parity Fixtures, Documentation Notes, And Progress Closure

#### `Tests/RielflowCLITests/Fixtures/*`
#### `impl-plans/active/swift-native-migration.md`
#### `impl-plans/PROGRESS.json`
#### `impl-plans/README.md`

**Status**: COMPLETED

```swift
public struct CLISmokeCommand: Equatable, Sendable {
  public var arguments: [String]
  public var expectedExitCode: CLIExitCode
  public var expectedStdoutContains: [String]
  public var expectedStderrContains: [String]
}
```

**Checklist**:

- [x] Add fixture-level Swift CLI smoke tests for validate, inspect, and
      deterministic run.
- [x] Keep TypeScript/Bun validation command in the verification matrix.
- [x] Update parent progress logs as implementation advances.
- [x] Record any intentional parity gaps and keep packaging cutover blocked
      until TASK-008.

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| CLI parser and tests | `Sources/RielflowCLI/*`, `Tests/RielflowCLITests/*`, `Package.swift` | COMPLETED | Command parser tests |
| Workflow resolution and node patch | `Sources/RielflowCLI/WorkflowResolution.swift`, `Sources/RielflowCLI/NodePatchOptions.swift` | COMPLETED | Resolution and non-mutation tests |
| Validate command | `Sources/RielflowCLI/WorkflowValidateCommand.swift` | COMPLETED | Validate text/JSON tests |
| Inspect command | `Sources/RielflowCLI/WorkflowInspectCommand.swift` | COMPLETED | Inspect text/JSON/structure tests |
| Deterministic mock runner | `Sources/RielflowCore/DeterministicWorkflowRunner.swift`, `Sources/RielflowAdapters/ScenarioNodeAdapter.swift` | COMPLETED | Scenario and runner tests |
| Run command | `Sources/RielflowCLI/WorkflowRunCommand.swift` | COMPLETED | Deterministic run tests |
| Progress and docs closure | `impl-plans/*` | COMPLETED | `jq empty impl-plans/PROGRESS.json`, `git diff --check` |

## Tasks

### TASK-001: CLI Parser And Test Target

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `Package.swift`, `Sources/RielflowCLI/RielflowCommand.swift`, `Sources/RielflowCLI/CLIOptions.swift`, `Tests/RielflowCLITests/CommandParsingTests.swift`
**Dependencies**: None

**Description**:
Add testable command parsing and option DTOs for `workflow validate`,
`workflow inspect`, and deterministic local `workflow run`.

**Completion Criteria**:

- [x] Supported options parse to typed Swift values.
- [x] Usage errors map to exit code `2`.
- [x] Unsupported endpoint/registry/live side-effect options are rejected in
      Swift TASK-007.

### TASK-002: Workflow Resolution And Node Patch Boundary

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCLI/WorkflowResolution.swift`, `Sources/RielflowCLI/NodePatchOptions.swift`, `Tests/RielflowCLITests/WorkflowResolutionTests.swift`
**Dependencies**: TASK-001

**Description**:
Resolve direct/project/user workflow bundles and apply non-persistent node
patches for validate and run.

**Completion Criteria**:

- [x] Direct, project, user, and auto resolution are covered by tests.
- [x] Node patch errors are deterministic.
- [x] Patch application does not modify fixture files.

### TASK-003: Validate Command Parity

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCLI/WorkflowValidateCommand.swift`, `Sources/RielflowCLI/WorkflowValidationOutput.swift`, `Tests/RielflowCLITests/WorkflowValidateCommandTests.swift`
**Dependencies**: TASK-001, TASK-002

**Description**:
Implement passive structural validation and injected executable preflight output.

**Completion Criteria**:

- [x] Text and JSON validate output include source scope/path and diagnostics.
- [x] `--executable` uses injected deterministic readiness probes.
- [x] Validation failures return exit code `1`.

### TASK-004: Inspect Command Parity

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCLI/WorkflowInspectCommand.swift`, `Sources/RielflowCLI/WorkflowInspectionSummary.swift`, `Sources/RielflowCLI/WorkflowInspectionRendering.swift`, `Tests/RielflowCLITests/WorkflowInspectCommandTests.swift`
**Dependencies**: TASK-001, TASK-002

**Description**:
Implement full inspection summary rendering and compact `--structure` text
rendering without reducing JSON output.

**Completion Criteria**:

- [x] Full JSON inspection preserves nested callable contracts.
- [x] Compact structure text omits readiness, defaults, and callable details.
- [x] Source scope/path, step ids, manager/entry ids, counts, and node registry
      ids are present in full output.

### TASK-005: Deterministic Mock Scenario Runner

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `Sources/RielflowAdapters/ScenarioNodeAdapter.swift`, `Sources/RielflowCore/DeterministicWorkflowRunner.swift`, `Tests/RielflowAdaptersTests/ScenarioNodeAdapterTests.swift`, `Tests/RielflowCoreTests/DeterministicWorkflowRunnerTests.swift`
**Dependencies**: None

**Description**:
Add deterministic mock scenario response sequencing and a local runtime runner
that uses TASK-005 publication contracts.

**Completion Criteria**:

- [x] Scenario responses map by step/node execution id and support sequences.
- [x] Missing scenario responses use deterministic local fallback behavior.
- [x] Failed scenarios and invalid outputs do not publish downstream messages.

### TASK-006: Deterministic Run Command

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCLI/WorkflowRunCommand.swift`, `Sources/RielflowCLI/WorkflowRunOutput.swift`, `Tests/RielflowCLITests/WorkflowRunCommandTests.swift`
**Dependencies**: TASK-001, TASK-002, TASK-005

**Description**:
Wire `workflow run` to variables parsing, node patching, deterministic mock
scenario loading, and runtime result rendering.

**Completion Criteria**:

- [x] Variables parsing accepts inline object JSON, `@file`, and bare file path.
- [x] Deterministic mock run completes without credentials or live agent CLIs.
- [x] JSON stdout remains parseable on success and failure.

### TASK-007: Parity Verification And Progress Closure

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Tests/RielflowCLITests/Fixtures/*`, `impl-plans/active/swift-native-migration.md`, `impl-plans/PROGRESS.json`, `impl-plans/README.md`
**Dependencies**: TASK-003, TASK-004, TASK-006

**Description**:
Add fixture smoke coverage, run required verification, update progress records,
and document residual risks before implementation review.

**Completion Criteria**:

- [x] Swift validate, inspect, and deterministic run fixture tests pass.
- [x] TypeScript/Bun fallback validation still passes.
- [x] Parent plan progress log records completed TASK-007 work and any
      intentional parity gaps.

## Dependencies

| Task | Depends On | Reason |
| ---- | ---------- | ------ |
| TASK-001 | None | Parser/test target can start from current CLI scaffold. |
| TASK-002 | TASK-001 | Resolution options depend on typed parser DTOs. |
| TASK-003 | TASK-001, TASK-002 | Validate command needs parser and resolver. |
| TASK-004 | TASK-001, TASK-002 | Inspect command needs parser and resolver. |
| TASK-005 | None | Mock scenario runner uses existing TASK-005 runtime APIs and disjoint Core/Adapter files. |
| TASK-006 | TASK-001, TASK-002, TASK-005 | Run command needs parser, resolver, and deterministic runner. |
| TASK-007 | TASK-003, TASK-004, TASK-006 | Final verification needs all command surfaces. |

Cross-plan dependencies:

- `active/swift-native-migration:TASK-004` is completed and provides adapter
  dispatch/readiness contracts.
- `active/swift-native-migration:TASK-005` is completed and provides runtime
  session/message/publication contracts.
- `active/swift-native-migration:TASK-006` is completed and provides package,
  add-on, event, hook, GraphQL, and server DTO surfaces.

## Parallelization

- `TASK-001` and `TASK-005` are parallelizable because their write scopes are
  disjoint: CLI parser/test target versus Core/Adapter deterministic mock
  runner files.
- `TASK-003` and `TASK-004` may be implemented in parallel only after
  `TASK-002` is accepted, and only if their write scopes stay in separate
  validate versus inspect command/rendering files.
- `TASK-006` is not parallel with `TASK-005` because it consumes the mock
  scenario runner.
- `TASK-007` is final closure and must run after validate, inspect, and run.

## Verification Plan

Baseline commands:

- `git status --short --branch`
- `git diff --check`
- `jq empty impl-plans/PROGRESS.json`
- `bun run typecheck:server`
- `bun run lint:biome`
- `bun run packages/rielflow/src/bin.ts workflow validate codex-design-and-implement-review-loop --scope project`

Swift toolchain commands:

- `/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift --version`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift test`

Focused Swift commands after implementation:

- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift test --filter RielflowCLITests`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift run rielflow workflow validate codex-design-and-implement-review-loop --scope project --output json`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift run rielflow workflow inspect codex-design-and-implement-review-loop --scope project --output json`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift run rielflow workflow run worker-only-single-step --workflow-definition-dir ./examples --mock-scenario ./examples/worker-only-single-step/mock-scenario.json --output json`

## Completion Criteria

- [x] `workflow validate` supports the TASK-007 option subset with
      deterministic text/JSON output and exit codes.
- [x] `workflow inspect` supports full summary text/JSON and compact
      `--structure` text behavior.
- [x] `workflow run` supports deterministic local mock execution without live
      agent credentials, network access, package checkout mutation, or runtime
      message publication bypasses.
- [x] Swift CLI tests cover parser, resolver, validate, inspect, scenario, and
      deterministic run failure/success paths.
- [x] TypeScript/Bun fallback validation remains passing.
- [x] Parent plan and `impl-plans/PROGRESS.json` reflect TASK-007 progress.

## Progress Log

### Session: 2026-06-12 13:05

**Tasks Completed**: Plan creation for TASK-007.
**Tasks In Progress**: None in this focused plan.
**Blockers**: None for planning. Implementation still requires Xcode Swift
6.3.2 environment variables recorded in verification.
**Notes**: Step 3 accepted the TASK-007 design update with no revision needed.
This plan scopes Swift CLI parity to additive deterministic local behavior and
keeps TypeScript/Bun as production fallback.

### Session: 2026-06-12 13:24

**Tasks Completed**: TASK-001 through TASK-007 implementation. Added Swift CLI
command parsing, direct/project/user workflow resolution, in-memory
`--node-patch`, `workflow validate`, `workflow inspect`, deterministic
scenario loading, a scenario-backed adapter, an in-memory deterministic runner,
Swift executable wiring, and focused CLI parity tests.
**Tasks In Progress**: None in this focused plan.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production fallback
and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 5 implementation-plan review accepted the
plan with no high or mid findings; no Step 7 rerun feedback was present for
this Step 6 implementation.
**Notes**: Verification passed with Xcode Swift 6.3.2:
`swift test --filter RielflowCLITests`, full `swift test` with 155 tests,
Swift `workflow validate codex-design-and-implement-review-loop --scope project
--output json`, Swift `workflow inspect codex-design-and-implement-review-loop
--scope project --output json`, Swift deterministic `workflow run
worker-only-single-step --workflow-definition-dir ./examples --mock-scenario
./examples/worker-only-single-step/mock-scenario.json --output json`,
`git diff --check`, `jq empty impl-plans/PROGRESS.json`,
`bun run typecheck:server`, `bun run lint:biome`, and TypeScript/Bun fallback
`workflow validate codex-design-and-implement-review-loop --scope project`.

### Session: 2026-06-12 13:42

**Tasks Completed**: Step 7 review revision for TASK-007 runtime publication
and run-option parity.
**Tasks In Progress**: None in this focused plan.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 review `comm-000012` reported two mid
findings: adapter/scenario failures bypassed TASK-005 failed-step publication,
and Swift run options were accepted without being applied or rejected.
**Notes**: Deterministic runner failures now publish failed executions through
`WorkflowPublicationRequest(adapterFailure:)` before throwing, timeout options
propagate to adapter deadlines, `maxLoopIterations` bounds deterministic runs,
and unsupported `--artifact-root`, `--session-store`, and `--max-concurrency`
return usage errors. Added focused runtime regressions for scenario adapter
failure, completion failure, output-contract failure, unsupported transition
failure, message append failure, timeout propagation, and loop bounding, plus
CLI usage rejection coverage. Focused Swift tests passed for
`DeterministicWorkflowRunnerTests` and `RielflowCLITests`; full
`swift test` passed 163 tests, Swift validate/inspect/run smokes passed,
unsupported run-option smoke returned usage exit code 2, and Bun fallback
checks passed.

### Session: 2026-06-12 13:55

**Tasks Completed**: Step 7 review revision for validate/inspect unsupported
remote flags and deterministic JSON run failures.
**Tasks In Progress**: None in this focused plan.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 review `comm-000016` reported two mid
findings: `workflow validate` and `workflow inspect` silently ignored
`--endpoint`/`--from-registry`, and `workflow run --output json` returned
empty stdout on failures.
**Notes**: Validate and inspect parsing now reject remote resolution flags with
usage errors. Deterministic `workflow run --output json` now returns a
parseable `WorkflowRunFailureResult` envelope for usage/load/validation/
execution failures while text output keeps diagnostics on stderr. Added parser
and command regressions for unsupported flags plus an invalid-variables JSON
failure envelope. Focused `RielflowCLITests` passed 10 tests, full
`swift test` passed 166 tests, Swift success/failure smokes passed, and Bun
fallback checks passed.

### Session: 2026-06-12 14:04

**Tasks Completed**: Step 7 review revision for deterministic output-contract
retry attempts.
**Tasks In Progress**: None in this focused plan.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 review `comm-000020` reported one mid
finding: deterministic run ignored `NodeOutputContract.maxValidationAttempts`,
so scenario response sequences could not advance after output-contract
rejection.
**Notes**: `DeterministicWorkflowRunner` now retries adapter execution and
runtime publication through the node output contract validation attempt budget,
passes the real attempt number to `WorkflowPublicationRequest`, and retries
only output validation rejection while preserving failure behavior for adapter,
transition, and message append errors. Added a Swift regression proving an
invalid scenario response is recorded as failed attempt 1, the valid response is
accepted as attempt 2, and only the accepted attempt publishes the downstream
message. Focused `RielflowCLITests` passed 11 tests, full `swift test` passed
167 tests, Swift validate/inspect/run smokes passed, and Bun fallback checks
passed.

### Session: 2026-06-12 14:15

**Tasks Completed**: Step 7 adversarial review revision for multiple direct
transition handling in the sequential deterministic runner.
**Tasks In Progress**: None in this focused plan.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000025`
reported one mid finding: deterministic run published every matching direct
transition but executed only the first downstream message, allowing misleading
completion with unexecuted work.
**Notes**: TASK-007 sequential deterministic runner now fails closed when an
adapter output would publish more than one direct transition. The failure is
recorded through TASK-005 publication as a failed execution and no downstream
messages are appended. Added a Swift regression for a two-transition workflow.
Focused `DeterministicWorkflowRunnerTests` passed 8 tests, focused
`RielflowCLITests` passed 11 tests, full `swift test` passed 168 tests, Swift
validate/inspect/run smokes passed, and Bun fallback checks passed.

### Session: 2026-06-12 14:23

**Tasks Completed**: Step 7 review revision for normalized multi-transition
fail-closed handling.
**Tasks In Progress**: None in this focused plan.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 review `comm-000029` reported one mid
finding: multiple-transition fail-closed handling checked
`AdapterExecutionOutput.when` before output-contract envelope normalization, so
envelope `when` labels could still publish multiple direct messages while the
sequential runner advanced only to the first.
**Notes**: `DeterministicWorkflowRunner` now normalizes adapter output to
`RuntimeOutputCandidate` before counting publishable transitions, matching the
runtime publication `when` map. Added a Swift regression where adapter metadata
disables labeled transitions but the normalized envelope enables two labels and
the runner records a failed execution without accepted output or messages.
Focused `DeterministicWorkflowRunnerTests` passed 9 tests, full `swift test`
passed 169 tests, `git diff --check` passed, and
`jq empty impl-plans/PROGRESS.json` passed.

### Session: 2026-06-12 14:32

**Tasks Completed**: Step 7 review revision for parseable validate JSON
failures.
**Tasks In Progress**: None in this focused plan.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 review `comm-000033` reported one mid
finding: `workflow validate --output json` returned resolver and validation
failures only on stderr, so stdout was not machine-readable JSON.
**Notes**: `WorkflowValidateCommand` now renders a
`WorkflowValidationFailureResult` JSON envelope for load, invalid workflow,
malformed node-patch, and preflight errors when `--output json` is selected,
while text output keeps diagnostics on stderr. Added Swift CLI regressions for
missing workflows, invalid workflow diagnostics, and malformed node-patch JSON.
Focused `RielflowCLITests` passed 14 tests, full `swift test` passed 172
tests, the missing-workflow JSON smoke parsed with `jq`, `git diff --check`
passed, and `jq empty impl-plans/PROGRESS.json` passed.

### Session: 2026-06-12 14:42

**Tasks Completed**: Step 7 adversarial review revision for parseable inspect
JSON failures.
**Tasks In Progress**: None in this focused plan.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000038`
reported one mid finding: `workflow inspect --output json` still returned
empty stdout and plain stderr on resolution or validation failures.
**Notes**: `WorkflowInspectCommand` now renders a
`WorkflowInspectionFailureResult` JSON envelope for inspect failures when
`--output json` is selected, including error text, exit code, source
scope/directory metadata when available, and invalid workflow diagnostics.
Added Swift CLI regressions for missing workflow and invalid workflow
diagnostics on inspect JSON failures. Focused `RielflowCLITests` passed 16
tests, full `swift test` passed 174 tests, the missing-workflow inspect JSON
smoke parsed with `jq`, `git diff --check` passed, and
`jq empty impl-plans/PROGRESS.json` passed.

### Session: 2026-06-12 14:54

**Tasks Completed**: Step 7 adversarial review revision for parser-stage JSON
failure envelopes.
**Tasks In Progress**: None in this focused plan.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000043`
reported one mid finding: `RielflowCLIApplication` caught parser
`CLIUsageError` before validate/inspect/run renderers could honor
`--output json`, leaving parser-stage failures as stderr-only diagnostics.
**Notes**: `RielflowCLIApplication` now detects raw workflow arguments that
request `--output json` and renders parser-stage usage failures as
command-specific JSON envelopes for validate, inspect, and run while
preserving usage exit code 2 and text stderr behavior. Added Swift CLI
regressions for unsupported run `--endpoint`, validate unknown option, and
inspect missing option value parser failures with parseable JSON stdout.
Focused `RielflowCLITests` passed 19 tests, full `swift test` passed 177
tests, built-executable parser JSON smokes passed with empty stderr, and
`git diff --check` plus `jq empty impl-plans/PROGRESS.json` passed.

### Session: 2026-06-12 15:07

**Tasks Completed**: Step 7 review revision for inspect callable contract
parity.
**Tasks In Progress**: None in this focused plan.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 review `comm-000047` reported one mid
finding: Swift `workflow inspect --output json` returned `callable: null` for
the project design-and-implement workflow because Swift node payload decoding
ignored input contracts and inspect only surfaced output jsonSchema contracts.
**Notes**: Swift `AgentNodePayload` now decodes node `input` contracts, and
inspect summaries always report the callable step id, role, input contract,
and output contract for the manager or entry step. Added Swift CLI coverage for
the `codex-design-and-implement-review-loop` manager callable input/output
descriptions and verified the Swift inspect JSON callable shape with `jq`.
Focused `RielflowCLITests` passed 20 tests, full `swift test` passed 178
tests, `git diff --check` and `jq empty impl-plans/PROGRESS.json` passed, and
the Swift inspect callable smoke parsed with `jq`.

### Session: 2026-06-12 15:22

**Tasks Completed**: Step 7 adversarial review revision for scoped workflow
name safety and addon-only executable preflight parity.
**Tasks In Progress**: None in this focused plan.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000052`
reported two mid findings: scoped project/user workflow resolution allowed
`../` traversal outside `.rielflow/workflows`, and `workflow validate
--executable` reported addon-only nodes valid even though deterministic run
cannot execute addon-only nodes.
**Notes**: Swift scoped workflow parsing and resolver containment now reject
unsafe scoped names using the TypeScript/Bun workflow token rule before scoped
catalog reads. Deterministic executable preflight now reports addon-only nodes
unsupported unless a payload exists, aligning validate with deterministic run
failure behavior. Added Swift CLI regressions for traversal/slash scoped names
across validate, inspect, and run, plus addon-only validate/run consistency.
Focused `RielflowCLITests` passed 22 tests, full `swift test` passed 180
tests, built-executable traversal/addon smokes passed with parseable JSON and
empty stderr, and `git diff --check` plus `jq empty impl-plans/PROGRESS.json`
passed.

### Session: 2026-06-12 15:34

**Tasks Completed**: Step 7 review revision for symlink-safe scoped workflow
containment.
**Tasks In Progress**: None in this focused plan.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 review `comm-000056` reported one mid
finding: scoped project/user containment used standardized paths without
resolving symlinks, allowing a safe-name symlink under `.rielflow/workflows`
to validate, inspect, or run an external workflow.
**Notes**: `FileSystemWorkflowBundleResolver` now resolves both scope roots
and candidate directories through symlinks before containment checks and reads
`workflow.json` and node files only from the contained resolved directory.
Added Swift CLI regressions proving validate, inspect, and run reject scoped
symlink escapes with JSON failure envelopes and empty stderr. Focused
`RielflowCLITests` passed 23 tests, full `swift test` passed 181 tests,
built-executable symlink smokes passed, and `git diff --check` plus
`jq empty impl-plans/PROGRESS.json` passed.

### Session: 2026-06-12 15:43

**Tasks Completed**: Step 7 review revision for symlink-safe workflow and node
payload file reads.
**Tasks In Progress**: None in this focused plan.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 review `comm-000060` reported two mid
findings: scoped resolution still followed symlinked `workflow.json` files and
symlinked node payload files outside the project/user workflow root before
validation or execution.
**Notes**: `FileSystemWorkflowBundleResolver` now resolves `workflow.json` and
each `nodeFile` target through symlinks before reading and rejects resolved
file targets that escape the resolved scoped workflow directory for project and
user scopes. Added Swift CLI regressions proving validate, inspect, and run
reject symlinked `workflow.json` and node payload escapes with JSON failure
envelopes and empty stderr. Focused `RielflowCLITests` passed 25 tests, full
`swift test` passed 183 tests, built-executable symlink file smokes passed, and
`git diff --check` plus `jq empty impl-plans/PROGRESS.json` passed.

### Session: 2026-06-12 16:01

**Tasks Completed**: Step 7 adversarial review revision for transition branch
expression parity.
**Tasks In Progress**: None in this focused plan.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000065`
reported one mid finding: deterministic mock runs used exact `when[label]`
lookup and did not evaluate existing branch expressions such as
`!(has_feature_fanout)` or `!(needs_revision)`.
**Notes**: Added a shared Swift `WorkflowBranchEvaluator` matching the
TypeScript branch semantics for bare labels, negation, parentheses, `&&`,
`||`, `always`, `never`, and payload boolean fallback. `RuntimePublication`
and `DeterministicWorkflowRunner` now use the same evaluator so publication
and multiple-transition fail-closed checks cannot diverge. Added Swift core
regressions for negated transition publication, expression precedence, payload
fallback, and multiple expression transitions failing closed. Focused core
tests passed 13 tests, full `swift test` passed 187 tests, a built-executable
negated-transition smoke passed, and `git diff --check` plus
`jq empty impl-plans/PROGRESS.json` passed.

### Session: 2026-06-12 16:21

**Tasks Completed**: Step 7 adversarial review revision for mock scenario
sequence parity across repeated step executions.
**Tasks In Progress**: None in this focused plan.
**Blockers**: None for TASK-007. TypeScript/Bun remains the production
fallback and release/Homebrew cutover remains deferred to TASK-008.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000070`
reported one mid finding: Swift `ScenarioNodeAdapter` advanced response
sequences by per-step call count instead of the TypeScript
`executionIndex`/`maxValidationAttempts`/`attempt` formula, so repeated steps
with validation retry budgets could consume unused retry slots.
**Notes**: `AdapterExecutionInput` now carries `executionIndex` plus output
attempt context. `DeterministicWorkflowRunner` populates those fields for each
step execution and output attempt, and `ScenarioNodeAdapter` now uses the
TypeScript scenario sequence formula. Added Swift regression coverage for a
repeated step where the first execution succeeds without retry and the second
execution skips the unused retry slot. Focused Swift tests passed 39 tests,
full `swift test` passed 188 tests, the built-executable retry-slot smoke
passed, and `git diff --check` plus `jq empty impl-plans/PROGRESS.json`
passed.
