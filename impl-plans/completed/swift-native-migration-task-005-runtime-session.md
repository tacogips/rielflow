# Swift Native Migration TASK-005 Runtime Session Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-swift-native-migration.md#task-005-runtime-session-message-store-and-publication-boundary`
**Created**: 2026-06-12
**Last Updated**: 2026-06-12

## Related Plans

- **Parent**: `impl-plans/active/swift-native-migration.md` (`TASK-005`)
- **Depends On**: `active/swift-native-migration:TASK-002`, `active/swift-native-migration:TASK-003`
- **Unblocks**: `active/swift-native-migration:TASK-006`, `active/swift-native-migration:TASK-007`
- **Activation Rule**: Implementation must not start until parent
  `active/swift-native-migration:TASK-002` and
  `active/swift-native-migration:TASK-003` are completed or explicitly recorded
  as stable for this TASK-005 slice in `impl-plans/PROGRESS.json` and this
  progress log.
- **Activation Note**: Step 6 proceeded after confirming the accepted design and
  current Swift model/JSON envelope contracts were stable for this additive
  in-memory slice. Parent TASK-002/TASK-003 remain active for broader Swift
  migration parity.

## Design Reference

Source of truth:

- `design-docs/specs/design-swift-native-migration.md#runtime-contracts-to-preserve`
- `design-docs/specs/design-swift-native-migration.md#task-005-runtime-session-message-store-and-publication-boundary`
- `design-docs/specs/design-swift-native-migration.md#data-flow`
- `design-docs/specs/design-swift-native-migration.md#verification-gates`
- `impl-plans/active/swift-native-migration.md#task-005-port-runtime-session-and-message-publication-boundary`

Implement the Swift runtime-owned session, workflow message store, candidate-path
publication, and output validation boundary needed for deterministic in-memory
workflow execution. This plan is additive: TypeScript/Bun remains the production
runtime and fallback until later Swift parity gates pass.

In scope:

- `RielflowCore` session, step execution, message, candidate output,
  validation, store, and publication value types and protocols.
- Deterministic in-memory runtime behavior with injectable clocks, ids, and
  message-store failure hooks.
- Runtime-owned candidate-path reading and rejection for missing, stale,
  malformed, non-object, and out-of-staging submissions.
- Runtime validation before publication, including output-contract and
  `completionPassed: false` failure paths.
- Tests proving adapters and workers never allocate communication ids, mutate
  session state, publish downstream messages, or write final workflow output.

Out of scope:

- SQLite-backed Swift persistence.
- Replacing the TypeScript/Bun runtime.
- GraphQL, server, package, event, hook, and release cutover parity.
- Cursor CLI mode, stream, auth, or `official/cursor-sdk` behavior.
- Legacy worker mailbox compatibility, including `RIEL_MAILBOX_DIR`,
  `inbox/input.json`, `outbox/output.json`, or execution-local inbox/outbox
  APIs.

## Issue Reference

- Workflow mode: `issue-resolution`
- Workflow ID: `codex-design-and-implement-review-loop`
- Workflow session: `riel-codex-design-and-implement-review-loop-1781211309-5fe4a54a`
- Planning node: `step4-impl-plan-create`
- Repository: `tacogips/rielflow`
- Issue title: `Port Swift runtime session and message publication boundary`
- Task id: `TASK-005`
- GitHub issue: none supplied by runtime input
- Risk level: high; adversarial implementation review required before cutover

## Codex Agent References

- Preferred `codex-agent` local root `../../codex-agent` remains unavailable in
  this checkout.
- `packages/rielflow-adapters/src/codex.ts`
- `packages/rielflow-adapters/src/claude.ts`
- `packages/rielflow-adapters/src/cursor.ts`
- `packages/rielflow-adapters/src/dispatch.ts`
- `packages/rielflow-adapters/src/shared.ts`
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
- `impl-plans/completed/sqlite-message-store.md`
- `impl-plans/completed/output-contract-candidate-path-prompt.md`
- Existing Swift scaffold:
  - `Sources/RielflowCore/AdapterContracts.swift`
  - `Sources/RielflowCore/JSONValue.swift`
  - `Sources/RielflowCore/WorkflowModel.swift`
  - `Sources/RielflowAdapters/AdapterUtilities.swift`
  - `Sources/RielflowCLI/main.swift`

Intentional divergences accepted by design:

- Swift starts with deterministic in-memory runtime APIs instead of partial
  SQLite writes.
- Swift adapters remain provider-output boundaries; the runtime performs final
  output validation, candidate-path handling, workflow message publication, and
  root output selection.
- CLI exposure stays minimal and scaffold-only until `TASK-007`.

## Modules

### 1. Runtime Session And Message Types

#### `Sources/RielflowCore/RuntimeSession.swift`
#### `Tests/RielflowCoreTests/RuntimeSessionTests.swift`

**Status**: COMPLETED

```swift
public enum WorkflowSessionStatus: String, Codable, Sendable {
  case created
  case running
  case completed
  case failed
}

public struct WorkflowSession: Codable, Equatable, Sendable {
  public var workflowId: String
  public var sessionId: String
  public var status: WorkflowSessionStatus
  public var entryStepId: String
  public var currentStepId: String?
  public var createdAt: Date
  public var updatedAt: Date
  public var executions: [WorkflowStepExecution]
}

public struct WorkflowStepExecution: Codable, Equatable, Sendable {
  public var executionId: String
  public var stepId: String
  public var nodeId: String
  public var attempt: Int
  public var backend: NodeExecutionBackend?
  public var status: WorkflowStepExecutionStatus
  public var acceptedOutput: WorkflowAcceptedOutputMetadata?
  public var adapterOutput: WorkflowAdapterOutputMetadata?
}
```

**Checklist**:

- [x] Define session, step execution, status, accepted output, and adapter
      output metadata types.
- [x] Define workflow message records matching the `workflow_messages`
      boundary.
- [x] Encode/decode deterministic JSON for inspection tests.
- [x] Keep adapter output metadata separate from published workflow messages.

### 2. Runtime Store Protocols And In-Memory Store

#### `Sources/RielflowCore/RuntimeStore.swift`
#### `Tests/RielflowCoreTests/RuntimeStoreTests.swift`

**Status**: COMPLETED

```swift
public protocol WorkflowRuntimeClock: Sendable {
  func now() -> Date
}

public protocol WorkflowRuntimeIDGenerating: Sendable {
  func nextSessionId(workflowId: String) throws -> String
  func nextStepExecutionId(stepId: String, attempt: Int) throws -> String
  func nextCommunicationId() throws -> String
}

public protocol WorkflowRuntimeStore: Sendable {
  func createSession(_ input: WorkflowSessionCreateInput) async throws -> WorkflowSession
  func recordStepExecution(_ input: WorkflowStepExecutionRecordInput) async throws -> WorkflowStepExecution
  func updateStepExecution(_ input: WorkflowStepExecutionUpdateInput) async throws -> WorkflowStepExecution
  func appendWorkflowMessage(_ input: WorkflowMessageAppendInput) async throws -> WorkflowMessageRecord
  func listMessages(for sessionId: String, toStepId: String?) async throws -> [WorkflowMessageRecord]
  func loadSession(id: String) async throws -> WorkflowSession?
}
```

**Checklist**:

- [x] Split session mutation from message publication so append failures are
      observable.
- [x] Implement deterministic in-memory store with monotonic created order.
- [x] Add injectable append-failure behavior for publication failure tests.
- [x] Prove failed message append prevents downstream publication success.

### 3. Candidate Output Normalization And Candidate-Path Lifecycle

#### `Sources/RielflowCore/RuntimeOutputCandidate.swift`
#### `Sources/RielflowCore/RuntimeCandidatePathStaging.swift`
#### `Tests/RielflowCoreTests/RuntimeOutputCandidateTests.swift`

**Status**: COMPLETED

```swift
public enum RuntimeOutputCandidateSource: Equatable, Sendable {
  case adapterOutput
  case inlineCandidate
  case candidatePath(URL)
}

public struct RuntimeOutputCandidate: Equatable, Sendable {
  public var source: RuntimeOutputCandidateSource
  public var payload: JSONObject
  public var completionPassed: Bool
  public var when: [String: Bool]
}

public protocol CandidatePathReading: Sendable {
  func readCandidate(
    from path: URL,
    stagingDirectory: URL,
    attemptStartedAt: Date,
    requiresObjectPayload: Bool
  ) async throws -> RuntimeOutputCandidate
}

public struct RuntimeCandidatePathReservation: Equatable, Sendable {
  public var stagingDirectory: URL
  public var candidatePath: URL
  public var attemptStartedAt: Date
  public var finalizationRootDirectory: URL?
}

public protocol RuntimeCandidatePathStaging: Sendable {
  func prepareCandidatePath(
    sessionId: String,
    stepExecutionId: String,
    attempt: Int
  ) async throws -> RuntimeCandidatePathReservation
  func finalizeCandidatePath(_ reservation: RuntimeCandidatePathReservation) async throws
}
```

**Checklist**:

- [x] Reuse the shared output-envelope normalization rules for inline and file
      candidates.
- [x] Runtime provisions the candidate staging directory and exact reserved
      candidate path before each attempt.
- [x] Runtime clears any prior candidate file at the reserved path before
      invoking an adapter or executor.
- [x] Runtime rejects unsafe session/execution path components and refuses
      cleanup outside the configured staging root.
- [x] Runtime rejects safe-looking candidate staging components that resolve
      through symlinks outside the configured staging root before returning a
      candidate path.
- [x] Reject missing, stale, malformed, non-object, and out-of-staging
      candidate-path submissions.
- [x] Reject candidate-path submissions that do not match the exact runtime
      reservation, even when the submitted file is still inside staging.
- [x] Reject ambiguous candidate sources so adapter output or inline
      candidates cannot bypass a candidate-path reservation.
- [x] Runtime deletes or ignores candidate staging state after adapter return so
      submitted files never become authoritative output storage.
- [x] Treat candidate paths as staging plumbing, not authoritative output
      storage.
- [x] Avoid exposing final `output.json` destinations to adapters.

### 4. Runtime Output Validation

#### `Sources/RielflowCore/RuntimeOutputValidation.swift`
#### `Tests/RielflowCoreTests/RuntimeOutputValidationTests.swift`

**Status**: COMPLETED

```swift
public struct WorkflowOutputContract: Codable, Equatable, Sendable {
  public var schema: JSONObject?
  public var requiredObject: Bool
}

public enum WorkflowOutputValidationStatus: String, Codable, Sendable {
  case accepted
  case rejected
}

public struct WorkflowOutputValidationResult: Codable, Equatable, Sendable {
  public var status: WorkflowOutputValidationStatus
  public var payload: JSONObject?
  public var reason: String?
}

public protocol WorkflowOutputValidating: Sendable {
  func validate(_ candidate: RuntimeOutputCandidate, contract: WorkflowOutputContract?) throws -> WorkflowOutputValidationResult
}
```

**Checklist**:

- [x] Validate output-contract business payloads before message publication.
- [x] Reject malformed envelopes, invalid JSON, non-object contracted payloads,
      schema failure, and `completionPassed: false`.
- [x] Preserve TypeScript JSON Schema subset semantics for nested object/array
      validation, additionalProperties, enum, const, numeric/string bounds,
      strict integer checks, and anyOf/oneOf/allOf combinators.
- [x] Validate output-contract schema definitions before payload validation,
      including unsupported keyword rejection and structural checks for type,
      properties, required, additionalProperties, items, enum, min/max bounds,
      pattern, and anyOf/oneOf/allOf.
- [x] Mark final-attempt validation failure as failed without publishing
      messages.
- [x] Keep retry modeling minimal and deterministic.

### 5. Runtime Publication Boundary

#### `Sources/RielflowCore/RuntimePublication.swift`
#### `Tests/RielflowCoreTests/RuntimePublicationTests.swift`

**Status**: COMPLETED

```swift
public struct WorkflowPublicationRequest: Sendable {
  public var sessionId: String
  public var stepId: String
  public var nodeId: String
  public var attempt: Int
  public var backend: NodeExecutionBackend?
  public var adapterOutput: AdapterExecutionOutput?
  public var inlineCandidate: JSONObject?
  public var candidatePath: URL?
  public var outputContract: WorkflowOutputContract?
  public var transitions: [WorkflowStepTransition]
  public var publishesRootOutput: Bool
}

public struct WorkflowPublicationResult: Equatable, Sendable {
  public var session: WorkflowSession
  public var stepExecution: WorkflowStepExecution
  public var publishedMessages: [WorkflowMessageRecord]
  public var rootOutput: JSONObject?
}

public protocol WorkflowOutputPublishing: Sendable {
  func publishAcceptedOutput(_ request: WorkflowPublicationRequest) async throws -> WorkflowPublicationResult
}
```

**Checklist**:

- [x] Publish downstream `WorkflowMessageRecord` rows only after successful
      validation.
- [x] Fail closed for unsupported transition semantics such as cross-workflow,
      resume-step, and fanout transitions instead of silently publishing them
      as direct workflow messages.
- [x] Generate communication ids and created order exclusively inside the
      runtime.
- [x] Select external root output only when runtime publication explicitly marks
      the step as root-scope/output-node metadata; terminal steps without that
      marker do not publish external workflow output.

### 6. CLI Smoke Scaffold And Progress Handoff

#### `Sources/RielflowCLI/main.swift`
#### `Tests/RielflowCoreTests/*`
#### `impl-plans/active/swift-native-migration.md`
#### `impl-plans/PROGRESS.json`

**Status**: COMPLETED

```swift
public struct RuntimeSmokeResult: Codable, Equatable, Sendable {
  public var sessionId: String
  public var publishedCommunicationIds: [String]
  public var output: JSONObject?
}
```

**Checklist**:

- [x] Add no user-facing CLI replacement unless needed for scaffold-only smoke
      verification.
- [x] Keep TypeScript/Bun documented as fallback.
- [x] Update parent plan, progress log, and progress index as implementation
      advances.
- [x] Run baseline TypeScript and Swift verification commands.

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Runtime session and message types | `Sources/RielflowCore/RuntimeSession.swift` | COMPLETED | `Tests/RielflowCoreTests/RuntimeSessionTests.swift` |
| Runtime store and in-memory behavior | `Sources/RielflowCore/RuntimeStore.swift` | COMPLETED | `Tests/RielflowCoreTests/RuntimeStoreTests.swift` |
| Candidate output normalization and staging lifecycle | `Sources/RielflowCore/RuntimeOutputCandidate.swift`, `Sources/RielflowCore/RuntimeCandidatePathStaging.swift` | COMPLETED | `Tests/RielflowCoreTests/RuntimeOutputCandidateTests.swift` |
| Runtime output validation | `Sources/RielflowCore/RuntimeOutputValidation.swift` | COMPLETED | `Tests/RielflowCoreTests/RuntimeOutputValidationTests.swift` |
| Runtime publication boundary | `Sources/RielflowCore/RuntimePublication.swift` | COMPLETED | `Tests/RielflowCoreTests/RuntimePublicationTests.swift` |
| CLI smoke scaffold and handoff | `Sources/RielflowCLI/main.swift`, plan files | COMPLETED | focused Swift tests plus baseline commands |

## Task Breakdown

### TASK-001: Define Runtime Session And Message Value Types

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCore/RuntimeSession.swift`, `Tests/RielflowCoreTests/RuntimeSessionTests.swift`
**Dependencies**: `active/swift-native-migration:TASK-002`, `active/swift-native-migration:TASK-003`

**Description**:
Define Swift runtime session, step execution, accepted output, adapter output,
and workflow message record types that mirror the TypeScript workflow message
boundary without exposing publication to adapters.

**Completion Criteria**:

- [x] Types encode/decode deterministically.
- [x] Message records include runtime-generated communication id, workflow
      execution id, from/to step ids, routing scope, delivery kind, source step
      execution id, transition condition, payload JSON, optional artifact refs,
      lifecycle state, and created order.
- [x] Adapter output metadata cannot be mistaken for published workflow
      messages.

### TASK-002: Implement Runtime Store Protocols And In-Memory Store

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCore/RuntimeStore.swift`, `Tests/RielflowCoreTests/RuntimeStoreTests.swift`
**Dependencies**: TASK-001

**Description**:
Implement deterministic in-memory session and message storage with injectable
clock, ids, and append-failure behavior.

**Completion Criteria**:

- [x] Session mutation and message append APIs are split.
- [x] Runtime-owned message input resolver converts prior
      `WorkflowMessageRecord` rows into deterministic structured execution
      input before adapter execution and applies the merged payload to the
      `AdapterExecutionInput` boundary.
- [x] Tests assert exact session ids, execution ids, communication ids,
      timestamps, created order, and lifecycle transitions.
- [x] Tests assert input-resolution ordering, `toStepId` filtering, source
      step tracking, and deterministic payload merge semantics.
- [x] Tests assert direct runtime publication creates delivered messages and
      input resolution excludes created, failed, and superseded lifecycle rows.
- [x] Injected message append failure prevents downstream publication success.

### TASK-003: Add Candidate Output Normalization And Candidate-Path Lifecycle

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCore/RuntimeOutputCandidate.swift`, `Sources/RielflowCore/RuntimeCandidatePathStaging.swift`, `Tests/RielflowCoreTests/RuntimeOutputCandidateTests.swift`
**Dependencies**: TASK-001

**Description**:
Normalize inline adapter output and runtime-provided candidate-path submissions
through one candidate path while enforcing runtime-owned staging lifecycle and
staging-directory ownership.

**Completion Criteria**:

- [x] Inline and candidate-file submissions use shared normalization.
- [x] Runtime provisions and clears the reserved candidate path before every
      attempt.
- [x] Missing, stale, malformed, non-object, and out-of-staging candidate files
      are rejected deterministically.
- [x] Runtime deletes or ignores candidate staging state after adapter return.
- [x] Adapters do not learn final output destinations or publication paths.

### TASK-004: Add Runtime Output Contract Validation

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCore/RuntimeOutputValidation.swift`, `Tests/RielflowCoreTests/RuntimeOutputValidationTests.swift`
**Dependencies**: TASK-003

**Description**:
Validate normalized business payloads before accepted output recording and
message publication.

**Completion Criteria**:

- [x] Malformed JSON, invalid envelope, schema failure, non-object contracted
      payload, and `completionPassed: false` cases fail before publication.
- [x] Provider, policy-blocked, timeout, and invalid-output failures update
      session state without fabricating successful messages.
- [x] Final-attempt failure leaves the step failed and publishes no downstream
      messages.

### TASK-005: Implement Runtime Publication Service

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCore/RuntimePublication.swift`, `Tests/RielflowCoreTests/RuntimePublicationTests.swift`
**Dependencies**: TASK-002, TASK-004

**Description**:
Connect session storage, candidate normalization, validation, accepted output
recording, downstream message generation, and root output selection behind a
runtime-owned publication API.

**Completion Criteria**:

- [x] Runtime generates all communication ids and created order values.
- [x] Published messages derive from accepted output only.
- [x] Failed publication does not report downstream delivery as published.
- [x] External root output is selected only from explicit root-scope/output-node
      publication metadata, not arbitrary adapter responses or terminal steps.

### TASK-006: Add Verification, Handoff, And Progress Tracking

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/RielflowCLI/main.swift`, `impl-plans/active/swift-native-migration.md`, `impl-plans/PROGRESS.json`
**Dependencies**: TASK-005

**Description**:
Run the focused verification suite, keep any CLI work scaffold-only, preserve
TypeScript/Bun fallback, and update plan progress for the next workflow step.

**Completion Criteria**:

- [x] Baseline TypeScript commands pass or blockers are recorded.
- [x] Xcode Swift `swift test` passes for runtime session/message tests.
- [x] `rg` checks confirm legacy inbox/outbox contracts were not added.
- [x] Parent plan and progress index reflect TASK-005 implementation state.

## Dependencies

| Task | Depends On | Reason |
| ---- | ---------- | ------ |
| TASK-001 | `active/swift-native-migration:TASK-002`, `active/swift-native-migration:TASK-003` | Runtime types depend on the accepted Swift workflow model and JSON/envelope contracts. |
| TASK-002 | TASK-001 | Store APIs persist the runtime value types. |
| TASK-003 | TASK-001 | Candidate metadata references step execution and runtime source types. |
| TASK-004 | TASK-003 | Validation consumes normalized runtime candidates. |
| TASK-005 | TASK-002, TASK-004 | Publication needs store mutation and validated candidates. |
| TASK-006 | TASK-005 | Verification and handoff require implemented publication behavior. |

## Parallelizable Tasks

No TASK-005 tasks are marked parallelizable at plan start. The write scopes
cross `RielflowCore` runtime contracts and focused `RielflowCoreTests`, and the
publication service depends on the store and validation API shapes. After
TASK-001 lands, TASK-002 and TASK-003 may be split between workers only if they
avoid touching the same files and the implementation lead keeps shared type
changes in TASK-001.

## Verification Plan

Required commands:

- `git status --short --branch`
- `git diff --check`
- `bun run typecheck:server`
- `bun run lint:biome`
- `bun run packages/rielflow/src/bin.ts workflow validate codex-design-and-implement-review-loop --scope project`
- `/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift --version`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift test`
- `rg -n "RIEL_MAILBOX_DIR|inbox/input\\.json|outbox/output\\.json|execution-local inbox|execution-local outbox" Sources Tests`
- `rg -n "WorkflowSession|WorkflowMessageRecord|CandidatePathReading|WorkflowOutputPublishing|completionPassed" Sources/RielflowCore Tests/RielflowCoreTests`
- `rg -n "RuntimeCandidatePathStaging|prepareCandidatePath|finalizeCandidatePath|RuntimeCandidatePathReservation|candidatePathDoesNotMatchReservation|RuntimeCandidatePathStagingError|adapterFailure" Sources/RielflowCore Tests/RielflowCoreTests`
- `rg -n "ambiguousCandidateSources|candidatePathReservationRequiresCandidatePath|finalizeCandidatePathIfNeeded|testPublicationFinalizesCandidatePathStagingAfter" Sources/RielflowCore Tests/RielflowCoreTests`
- `rg -n "unsupportedTransition|unsupportedTransitionReason|testUnsupportedTransitionShapesFailBeforeAcceptedOutputAndMessages" Sources/RielflowCore Tests/RielflowCoreTests`
- `rg -n "additionalProperties|enum|const|anyOf|oneOf|allOf|minItems|maxItems|minLength|maxLength|minimum|maximum" Sources/RielflowCore/RuntimeOutputValidation.swift Tests/RielflowCoreTests/RuntimeOutputValidationTests.swift`
- `rg -n "unsupported JSON Schema keyword|validateSchemaDefinition|validateSchemaNode|must be a non-empty array when provided" Sources/RielflowCore/RuntimeOutputValidation.swift Tests/RielflowCoreTests/RuntimeOutputValidationTests.swift`
- `jq empty impl-plans/PROGRESS.json`

Focused test requirements:

- Session ids, execution ids, communication ids, timestamps, and created order
  are deterministic under injected clock/id generators.
- Store append failures prevent publication success and produce no downstream
  delivery result.
- Candidate-path reader rejects missing, stale, malformed, non-object, and
  out-of-staging submissions.
- Candidate-path staging provisions the reserved path, clears stale pre-attempt
  files, and deletes or ignores staging state after adapter return.
- Publication rejects ambiguous candidate sources and finalizes candidate-path
  staging after success, validation failure, and append failure.
- Unsupported cross-workflow, resume-step, and fanout transitions fail before
  accepted output or workflow message publication.
- Validation rejects malformed envelopes, invalid JSON, non-object contracted
  payloads, schema failures, and `completionPassed: false`.
- Validation rejects malformed schema definitions before payload validation,
  including unsupported keywords, invalid properties/additionalProperties,
  empty combinators, invalid bounds, invalid patterns, malformed required
  entries, and unsupported types.
- Provider errors, `policy_blocked`, timeouts, and invalid-output failures
  update session state without publishing workflow messages.
- Published messages are runtime-generated and workers cannot supply
  communication ids.

## Completion Criteria

- [x] `RielflowCore` exposes runtime-owned session, step execution, workflow
      message, candidate output, validation, store, and publication APIs.
- [x] Deterministic in-memory tests cover accepted output publication and all
      required failure paths.
- [x] Candidate-path publication is runtime-owned and staging-scoped.
- [x] Candidate-path staging lifecycle covers runtime provisioning,
      pre-attempt clearing, and post-attempt cleanup or ignore behavior.
- [x] Runtime publication finalizes candidate-path staging after consuming a
      reserved candidate, including success, validation failure, and append
      failure paths.
- [x] Unsupported transition semantics fail closed before accepted output or
      message publication.
- [x] Adapters remain provider-output boundaries and cannot publish final
      workflow messages.
- [x] Legacy execution-local inbox/outbox contracts are not introduced.
- [x] TypeScript/Bun remains production fallback.
- [x] Parent Swift migration plan and `impl-plans/PROGRESS.json` are updated as
      implementation progresses.

## Progress Log

### Session: 2026-06-12 06:02

**Tasks Completed**: None
**Tasks In Progress**: None
**Blockers**: Parent `active/swift-native-migration:TASK-002` and
`active/swift-native-migration:TASK-003` are still recorded as in progress; this
focused plan is blocked until those dependencies are completed or explicitly
accepted as stable for TASK-005.
**Review Feedback Addressed**: Step 3 accepted the TASK-005 design update with
no findings; no Step 5 feedback exists for this run.
**Notes**: Created focused TASK-005 implementation plan for Swift runtime-owned
session/message store APIs, deterministic in-memory behavior, candidate-path
publication, output validation, and legacy inbox/outbox exclusion.

### Session: 2026-06-12 06:12

**Tasks Completed**: None
**Tasks In Progress**: None
**Blockers**: Parent `active/swift-native-migration:TASK-002` and
`active/swift-native-migration:TASK-003` remain the activation gate for TASK-005
implementation.
**Review Feedback Addressed**: Step 5 review `exec-000008` reported two mid
findings: the plan status was `Ready` despite parent blockers, and
candidate-path lifecycle covered reader/validation behavior but not runtime
provisioning, pre-attempt clearing, and post-attempt cleanup/ignore semantics.
**Notes**: Marked the focused TASK-005 plan `Blocked`, added an explicit
activation rule tied to parent TASK-002/TASK-003 stability, and expanded
TASK-003/module/checklist/verification coverage with
`RuntimeCandidatePathStaging`, `RuntimeCandidatePathReservation`,
`prepareCandidatePath`, and `finalizeCandidatePath` lifecycle expectations.

### Session: 2026-06-12 06:15

**Tasks Completed**: None
**Tasks In Progress**: None
**Blockers**: Parent `active/swift-native-migration:TASK-002` and
`active/swift-native-migration:TASK-003` remain the activation gate for TASK-005
implementation.
**Review Feedback Addressed**: Step 4 self-review found TASK-001 still said
`Not Started` in markdown while `impl-plans/PROGRESS.json` correctly marked it
`Blocked` on the parent contract dependencies.
**Notes**: Updated TASK-001 markdown status to `Blocked` so the focused plan,
progress index, and activation rule agree before renewed Step 5 review.

### Session: 2026-06-12 06:21

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006
**Tasks In Progress**: None
**Blockers**: None for this additive deterministic in-memory runtime slice.
Parent `active/swift-native-migration:TASK-002` and `TASK-003` remain active
for broader Swift parity, but their current model and JSON/envelope contracts
were explicitly accepted as stable for TASK-005 implementation.
**Review Feedback Addressed**: Step 5 `exec-000011` accepted the focused plan
with no new findings after prior blocked-status and candidate-path lifecycle
findings were addressed.
**Notes**: Implemented `Sources/RielflowCore/RuntimeSession.swift`,
`RuntimeStore.swift`, `RuntimeOutputCandidate.swift`,
`RuntimeCandidatePathStaging.swift`, `RuntimeOutputValidation.swift`, and
`RuntimePublication.swift`. Added focused `RielflowCoreTests` for deterministic
session/message encoding, runtime-generated ids and created order, append
failure behavior, candidate-path staging/clearing/finalization, candidate-path
missing/stale/malformed/non-object/out-of-staging rejection,
`completionPassed: false` and schema validation failures, no-candidate provider
failure without publication, accepted downstream message publication, and root
output selection. Verified TypeScript/Bun fallback and Swift checks; Xcode
Swift 6.3.2 `swift test` passed 77 tests.

### Session: 2026-06-12 06:39

**Tasks Completed**: Step 7 adversarial review revision for TASK-003,
TASK-004, and TASK-005 hardening.
**Tasks In Progress**: None
**Blockers**: None for this additive deterministic in-memory runtime slice.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000016`
returned `needs_revision` for the runtime publication boundary. The revision
keeps candidate-path publication tied to the exact runtime reservation and
adds an explicit adapter-failure path so provider, `policy_blocked`, timeout,
and invalid-output failures can mark step execution failed without publishing
messages.
**Notes**: Added `candidatePathDoesNotMatchReservation` rejection in
`RuntimePublication.swift`/`RuntimeOutputCandidate.swift`, added
`adapterFailure` handling to `WorkflowPublicationRequest`, and covered both
paths in `RuntimeOutputCandidateTests.swift` and
`RuntimePublicationTests.swift`. Re-ran TypeScript/Bun fallback checks and
Xcode Swift 6.3.2 `swift test`; Swift now passes 79 tests.

### Session: 2026-06-12 06:50

**Tasks Completed**: Step 7 independent review revision for TASK-003 and
TASK-004 hardening.
**Tasks In Progress**: None
**Blockers**: None for this additive deterministic in-memory runtime slice.
**Review Feedback Addressed**: Step 7 review `comm-000004` reported two mid
findings: candidate staging used unsanitized session/execution ids in
filesystem paths before recursive cleanup, and output-contract validation was
too shallow versus `packages/rielflow-core/src/json-schema.ts`.
**Notes**: Added `RuntimeCandidatePathStagingError` and safe path-component/root
containment checks to `RuntimeCandidatePathStaging.swift`. Expanded
`RuntimeOutputValidation.swift` to validate the TypeScript JSON Schema subset
used by output contracts, including additionalProperties, enum, const, nested
items/properties, numeric/string bounds, strict integer checks, and
anyOf/oneOf/allOf. Added focused regression tests for unsafe staging ids,
outside-root finalization, and the expanded schema features. Xcode Swift 6.3.2
`swift test` now passes 82 tests.

### Session: 2026-06-12 07:04

**Tasks Completed**: Step 7 independent review revision for TASK-004 schema
definition validation.
**Tasks In Progress**: None
**Blockers**: None for this additive deterministic in-memory runtime slice.
**Review Feedback Addressed**: Step 7 review `comm-000008` reported a mid
finding that Swift payload validation accepted malformed schema definitions
that TypeScript/Bun `packages/rielflow-core/src/json-schema.ts` rejects before
payload validation.
**Notes**: Added Swift schema-definition validation before `validateValue`,
including unsupported keyword rejection and structural checks for `type`,
`properties`, `required`, `additionalProperties`, `items`, `enum`, numeric and
array/string bounds, `pattern`, and `anyOf`/`oneOf`/`allOf`. Added regression
coverage for malformed definitions. Xcode Swift 6.3.2 `swift test` now passes
83 tests.

### Session: 2026-06-12 07:18

**Tasks Completed**: Step 7 adversarial review revision for candidate-path
publication ownership and cleanup.
**Tasks In Progress**: None
**Blockers**: None for this additive deterministic in-memory runtime slice.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000013`
reported two mid findings: adapter output could bypass candidate-path
reservation validation when multiple candidate sources were supplied, and
candidate-path staging was not finalized by publication after consumption.
**Notes**: Added unambiguous candidate-source enforcement in
`RuntimePublication.swift`, required candidate-path requests to use the
reserved path when a reservation is present, and finalized candidate-path
staging after runtime consumption. Added regression coverage for ambiguous
adapterOutput+candidatePath rejection and staging cleanup on success,
validation failure, and append failure. Xcode Swift 6.3.2 `swift test` now
passes 88 tests.

### Session: 2026-06-12 07:30

**Tasks Completed**: Step 7 adversarial review revision for unsupported
transition semantics.
**Tasks In Progress**: None
**Blockers**: None for this additive deterministic in-memory runtime slice.
**Review Feedback Addressed**: Step 7 adversarial review `comm-000018`
reported a mid finding that cross-workflow, resume-step, and fanout transition
fields were silently published as direct in-workflow messages.
**Notes**: Added `unsupportedTransition` fail-closed behavior before accepted
output or message append in `RuntimePublication.swift`. Added regression tests
for `toWorkflowId`, `resumeStepId`, and `fanout` transitions proving the step
fails with no accepted output and no workflow messages. Xcode Swift 6.3.2
`swift test` now passes 89 tests.

### Session: 2026-06-12 07:40

**Tasks Completed**: Step 7 review revision for message input resolution and
explicit root output publication.
**Tasks In Progress**: None
**Blockers**: None for this additive deterministic in-memory runtime slice.
**Review Feedback Addressed**: Step 7 review `comm-000022` reported two mid
findings: prior `WorkflowMessageRecord` rows were not resolved into a
structured adapter/executor input object, and terminal steps with no
transitions were implicitly treated as external root output.
**Notes**: Added `WorkflowResolvedMessageInput`,
`WorkflowMessageInputResolving`, and `DefaultWorkflowMessageInputResolver` in
`RuntimeStore.swift` with tests for ordering, `toStepId` filtering, source step
tracking, payload merge semantics, and `AdapterExecutionInput` application.
Added explicit
`publishesRootOutput` metadata to `WorkflowPublicationRequest` and regression
coverage proving non-output terminal steps do not publish external root output.
Xcode Swift 6.3.2 `swift test` now passes 91 tests.

### Session: 2026-06-12 07:51

**Tasks Completed**: Step 7 review revision for candidate staging symlink
escapes and workflow message lifecycle filtering.
**Tasks In Progress**: None
**Blockers**: None for this additive deterministic in-memory runtime slice.
**Review Feedback Addressed**: Step 7 review `comm-000026` reported two mid
findings: candidate-path staging did not verify resolved directories after
creation, and message input resolution consumed all lifecycle statuses.
**Notes**: `FileSystemRuntimeCandidatePathStaging.prepareCandidatePath` now
checks existing path components before creation and rejects resolved staging
directories that escape the configured root through a safe-named symlink
component. Runtime message appends now produce delivered messages, and
`DefaultWorkflowMessageInputResolver` includes only delivered or consumed rows.
Added regression tests for symlink escape rejection without creating escaped
subdirectories, publication-created delivered messages, and resolver exclusion
of created, failed, and superseded rows. Xcode Swift 6.3.2 `swift test` now
passes 93 tests.
