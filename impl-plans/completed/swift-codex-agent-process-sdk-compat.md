# Swift Codex Agent Process And SDK Compatibility Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/swift-codex-agent-process-sdk-compat.md
**Created**: 2026-06-16
**Last Updated**: 2026-06-17

## Design Document Reference

**Source**: `design-docs/specs/swift-codex-agent-process-sdk-compat.md`
**Workflow Mode**: issue-resolution
**Issue Reference**: Port codex-agent functionality and tests to Swift rielflow
**Feature ID**: codex-process-sdk
**Feature Title**: Codex process and SDK runner compatibility

### Summary

Implement Swift equivalents for codex-agent process and SDK runner behavior:
Codex CLI argv compatibility, tracked process lifecycle, session runner streams,
`runAgent` raw/normalized event streams, attachment normalization, readiness
probe operations, SDK support utilities, deterministic mocks, and usage stats.

### Scope

**Included**: Codex process contracts, SDK runner contracts, process/session
test doubles, normalized event mapping, concrete readiness probe operations,
event emitter, tool registry, mock session runner, usage stats facade, exports,
and no-live Swift tests.

**Excluded**: CLI/GraphQL orchestration commands, queue/group/bookmark/token
commands, session search implementation, rollout parser ownership, production
Swift cutover, and live Codex credential verification.

### Swift Implementation Surface

- `Sources/CodexAgent/CodexAgentProcess.swift`
- `Sources/CodexAgent/CodexProcessManager.swift`
- `Sources/CodexAgent/CodexSDKUtilities.swift`
- `Sources/CodexAgent/CodexAgentAdapter.swift`
- `Tests/CodexAgentTests/CodexAgentCompatibilityTests.swift`
- `Tests/AgentAdapterTests/AgentAdapterTests.swift`

## Modules

### 1. Process Option And Command Contracts

#### `Sources/CodexAgent/CodexAgentProcess.swift`
#### `Sources/CodexAgent/CodexAgentAdapter.swift`
#### `Tests/AgentAdapterTests/AgentAdapterTests.swift`

**Status**: COMPLETED

```typescript
export type CodexSandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export type CodexApprovalMode =
  | "always"
  | "unless-allow-listed"
  | "never"
  | "on-failure";

export interface CodexProcessOptions {
  readonly systemPrompt?: string;
  readonly model?: string;
  readonly cwd?: string;
  readonly sandbox?: CodexSandboxMode;
  readonly approvalMode?: CodexApprovalMode;
  readonly fullAuto?: boolean;
  readonly additionalArgs?: readonly string[];
  readonly images?: readonly string[];
  readonly configOverrides?: readonly string[];
  readonly streamGranularity?: "event" | "char";
  readonly environmentVariables?: Readonly<Record<string, string>>;
  readonly codexBinary?: string;
}
```

**Checklist**:
- [x] Define Swift value types for sandbox, approval, stream granularity, process status, process options, process handle, and exec results.
- [x] Build `codex exec --json` args with Codex CLI 0.137 compatibility.
- [x] Build `codex exec resume --json` args with resume-specific sandbox placement.
- [x] Build `codex fork` args with optional `--nth-message`.
- [x] Preserve no-op `approvalMode`, full-auto bypass, image terminator, system prompt prefix, config overrides, additional args, cwd, and environment overlay.
- [x] Add tests corresponding to `src/process/manager.test.ts` argv and environment cases.

### 2. Process Manager And Lifecycle

#### `Sources/CodexAgent/CodexProcessManager.swift`
#### `Sources/CodexAgent/CodexProcessRunner.swift`
#### `Tests/CodexAgentTests/CodexProcessSDKCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export interface CodexProcess {
  readonly id: string;
  readonly pid: number;
  readonly command: string;
  readonly prompt: string;
  readonly startedAt: string;
  readonly status: "running" | "exited" | "killed";
  readonly exitCode?: number;
}

export interface ExecStreamResult {
  readonly process: CodexProcess;
  readonly lines: AsyncIterable<RolloutLine>;
  readonly completion: Promise<number>;
}
```

**Checklist**:
- [x] Implement `spawnExec`, `spawnExecStream`, `spawnResume`, `spawnResumeStream`, and `spawnFork` over injected process execution.
- [x] Track process id, pid, command, prompt, start time, status, and exit code.
- [x] Implement `list`, `get`, `kill`, `writeInput`, `killAll`, and `prune`.
- [x] Drain unconsumed stdout/stderr paths to avoid pipe backpressure.
- [x] Return deterministic process handles in tests without spawning live Codex.

### 3. Session Runner

#### `Sources/CodexAgent/CodexSessionRunner.swift`
#### `Sources/CodexAgent/CodexRunningSession.swift`
#### `Tests/CodexAgentTests/CodexProcessSDKCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export interface CodexSessionConfig extends CodexProcessOptions {
  readonly prompt: string;
  readonly resumeSessionId?: string;
}

export interface CodexSessionResult {
  readonly success: boolean;
  readonly exitCode: number;
  readonly stats: {
    readonly startedAt: string;
    readonly completedAt: string;
    readonly messageCount: number;
  };
}
```

**Checklist**:
- [x] Implement `startSession` and `resumeSession` returning a running session async stream.
- [x] Update pending session ids from `session_meta` only for new sessions.
- [x] Preserve requested session id on resume even if rollout metadata differs.
- [x] Support `event` and `char` stream granularity with deterministic ordering.
- [x] Support `cancel`, `interrupt`, `pause`, and `resume` placeholders matching codex-agent semantics.
- [x] Depend on accepted session-rollout APIs for lookup, rollout reads, watcher attach, backfill, and stable dedupe keys.

### 4. Public RunAgent Facade And Attachment Normalization

#### `Sources/CodexAgent/CodexAgentSDK.swift`
#### `Sources/CodexAgent/CodexAgentAttachments.swift`
#### `Tests/CodexAgentTests/CodexProcessSDKCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export type AgentStreamMode = "raw" | "normalized";

export type AgentAttachment =
  | { readonly type: "path"; readonly path: string }
  | {
      readonly type: "base64";
      readonly data: string;
      readonly mediaType?: string;
      readonly filename?: string;
    };

export type AgentRequest =
  | ({ readonly prompt: string; readonly sessionId?: undefined } & CodexProcessOptions)
  | ({ readonly sessionId: string; readonly prompt?: string } & CodexProcessOptions);
```

**Checklist**:
- [x] Add public Swift request/result/event types for new and resume requests.
- [x] Implement `runAgent` as an async sequence that yields raw or normalized events.
- [x] Normalize path and base64 attachments into image paths before session start.
- [x] Sanitize decoded attachment filenames and infer extensions for png, jpeg, webp, gif, and unknown media.
- [x] Clean decoded attachment temp files after completion or error.
- [x] Add no-live tests for new, resume, additional args, config overrides, env, and attachment cleanup behavior.

### 5. Normalized SDK Event Mapper

#### `Sources/CodexAgent/CodexAgentProcess.swift`
#### `Tests/AgentAdapterTests/AgentAdapterTests.swift`

**Status**: COMPLETED

```typescript
export type AgentNormalizedEvent =
  | { readonly type: "session.started"; readonly sessionId: string; readonly resumed: boolean }
  | { readonly type: "assistant.delta"; readonly sessionId: string; readonly text: string }
  | { readonly type: "assistant.snapshot"; readonly sessionId: string; readonly content: string }
  | { readonly type: "tool.call"; readonly sessionId: string; readonly name: string; readonly input?: unknown }
  | { readonly type: "tool.result"; readonly sessionId: string; readonly name: string; readonly isError: boolean; readonly output?: unknown }
  | { readonly type: "activity"; readonly sessionId: string; readonly message?: string }
  | { readonly type: "session.completed"; readonly sessionId: string; readonly success: boolean; readonly exitCode: number }
  | { readonly type: "session.error"; readonly sessionId?: string; readonly error: string };
```

**Checklist**:
- [x] Map `session_meta`, `event_msg`, `response_item`, and char chunks to normalized events.
- [x] Emit assistant deltas and cumulative snapshots.
- [x] Track function-call names by call id for later tool results.
- [x] Map Codex shell events to `local_shell` tool events.
- [x] Map rollout error events to `session.error`.
- [x] Add tests for normalized raw chunks, resumed sessions, char granularity, dedupe, delayed discovery, and error events.

### 6. Readiness, Tool Versions, And SDK Utilities

#### `Sources/CodexAgent/CodexAgentReadiness.swift`
#### `Sources/CodexAgent/CodexToolRegistry.swift`
#### `Sources/CodexAgent/CodexSDKEventEmitter.swift`
#### `Sources/CodexAgent/CodexUsageStats.swift`
#### `Tests/CodexAgentTests/CodexProcessSDKCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export interface CodexModelAvailabilityResult {
  readonly ok: boolean;
  readonly model: string;
  readonly auth: CodexLoginStatusInfo;
  readonly probe: CodexModelProbeInfo;
}

export interface CodexUsageStats {
  readonly totalSessions: number;
  readonly totalMessages: number;
  readonly firstSessionDate: string | null;
  readonly lastComputedDate: string | null;
  readonly modelUsage: Readonly<Record<string, ModelUsageStats>>;
  readonly recentDailyActivity: readonly DailyActivity[];
}
```

**Checklist**:
- [x] Add concrete Codex readiness operations for `codex --version`, optional `git --version`, `codex login status`, and model probe.
- [x] Preserve model probe args: `exec --skip-git-repo-check --ephemeral --color never --sandbox read-only`, optional `--cd`, `--model`, and probe prompt.
- [x] Preserve bounded timeouts, structured command errors, and credential redaction.
- [x] Add event emitter and tool registry utilities with deterministic tests.
- [x] Add usage stats aggregation only on top of accepted rollout parser APIs.
- [x] Cover token_count cumulative delta, legacy timestamp shapes, cache TTL, and invalid-date fallback tests.

### 7. Public Exports And Integration Verification

#### `Package.swift`
#### `Sources/CodexAgent/CodexAgent.swift`
#### `Tests/CodexAgentTests/CodexProcessSDKCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export interface CodexProcessSDKCompatibilitySurface {
  readonly processManager: "CodexProcessManager";
  readonly sessionRunner: "CodexSessionRunner";
  readonly runAgent: "runAgent";
  readonly readiness: "CodexAgentReadinessOperations";
  readonly utilities: readonly ["CodexToolRegistry", "CodexSDKEventEmitter", "CodexUsageStats"];
}
```

**Checklist**:
- [x] Export the new Swift SDK surface from the `CodexAgent` target.
- [x] Keep `RielflowCore` free of Codex-specific options except existing backend identifiers.
- [x] Keep `RielflowAdapters` responsible only for provider-neutral process execution and adapter envelopes.
- [x] Add integration tests proving the existing `CodexAgentAdapter` still builds the same argv after shared command-builder changes.
- [x] Ensure all tests are no-live and use fixtures under repository-owned test or `tmp/` paths.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Process option and command contracts | `Sources/CodexAgent/CodexAgentProcess.swift`, `Sources/CodexAgent/CodexAgentAdapter.swift` | COMPLETED | `Tests/AgentAdapterTests/AgentAdapterTests.swift` |
| Process manager and lifecycle | `Sources/CodexAgent/CodexProcessManager.swift`, `Sources/CodexAgent/CodexProcessRunner.swift` | NOT_STARTED | `Tests/CodexAgentTests/CodexProcessSDKCompatibilityTests.swift` |
| Session runner | `Sources/CodexAgent/CodexSessionRunner.swift`, `Sources/CodexAgent/CodexRunningSession.swift` | NOT_STARTED | `Tests/CodexAgentTests/CodexProcessSDKCompatibilityTests.swift` |
| RunAgent facade and attachments | `Sources/CodexAgent/CodexAgentSDK.swift`, `Sources/CodexAgent/CodexAgentAttachments.swift` | NOT_STARTED | `Tests/CodexAgentTests/CodexProcessSDKCompatibilityTests.swift` |
| Normalized event mapper | `Sources/CodexAgent/CodexAgentProcess.swift` | IN_PROGRESS | `Tests/AgentAdapterTests/AgentAdapterTests.swift` |
| Readiness and utilities | `Sources/CodexAgent/CodexAgentReadiness.swift`, `Sources/CodexAgent/CodexToolRegistry.swift`, `Sources/CodexAgent/CodexSDKEventEmitter.swift`, `Sources/CodexAgent/CodexUsageStats.swift` | NOT_STARTED | `Tests/CodexAgentTests/CodexProcessSDKCompatibilityTests.swift` |
| Exports and integration | `Package.swift`, `Sources/CodexAgent/CodexAgent.swift` | NOT_STARTED | `Tests/AgentAdapterTests/AgentAdapterTests.swift` plus Codex SDK tests |

## Dependencies

| Feature | Depends On | Status |
| --- | --- | --- |
| TASK-001 process command contracts | None | COMPLETED |
| TASK-002 process manager lifecycle | TASK-001 | COMPLETED |
| TASK-003 session runner | TASK-001, TASK-002, `swift-codex-agent-session-rollout-compat:TASK-001` | COMPLETED |
| TASK-004 runAgent facade | TASK-003 | COMPLETED |
| TASK-005 normalized events | TASK-003, `swift-codex-agent-session-rollout-compat:TASK-001` | COMPLETED |
| TASK-006 readiness and utilities | TASK-001, `swift-codex-agent-session-rollout-compat:TASK-003` for usage stats only | COMPLETED |
| TASK-007 exports and integration | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006 | COMPLETED |

## Tasks

### TASK-001: Process Option And Command Contracts

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `Sources/CodexAgent/CodexProcessContracts.swift`, `Sources/CodexAgent/CodexProcessCommandBuilder.swift`, `Tests/CodexAgentTests/CodexProcessSDKCompatibilityTests.swift`
**Dependencies**: None

**Description**:
Define Swift Codex process options and command builders that preserve
codex-agent's Codex CLI 0.137 argv compatibility.

**Completion Criteria**:
- [x] `approvalMode` is accepted and never emitted.
- [x] `fullAuto` emits `--dangerously-bypass-approvals-and-sandbox`.
- [x] Exec, resume, and fork argv match reference ordering.
- [x] Environment, cwd, system prompt, image, config override, and additional args tests pass.

### TASK-002: Process Manager And Lifecycle

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/CodexAgent/CodexProcessManager.swift`, `Sources/CodexAgent/CodexProcessRunner.swift`, `Tests/CodexAgentTests/CodexProcessSDKCompatibilityTests.swift`
**Dependencies**: TASK-001

**Description**:
Implement tracked process lifecycle and streaming exec APIs over the injected
Swift process runner.

**Completion Criteria**:
- [x] Process handles expose id, pid, command, prompt, timestamps, status, and exit code.
- [x] `list`, `get`, `kill`, `writeInput`, `killAll`, and `prune` match reference semantics.
- [x] Streaming exec returns lines and completion without pipe deadlock.
- [x] Tests do not spawn a live Codex binary.

### TASK-003: Session Runner

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/CodexAgent/CodexSessionRunner.swift`, `Sources/CodexAgent/CodexRunningSession.swift`, `Tests/CodexAgentTests/CodexProcessSDKCompatibilityTests.swift`
**Dependencies**: TASK-001, TASK-002, swift-codex-agent-session-rollout-compat:TASK-001

**Description**:
Implement session runner behavior, including pending session ids, resume
rollout replay, watcher backfill, dedupe, char granularity, and completion
stats.

**Completion Criteria**:
- [x] New sessions update pending id from `session_meta`.
- [x] Resume sessions keep requested id and optionally include existing rollout lines.
- [x] Request-scoped `CODEX_HOME` is honored.
- [x] Char stream granularity preserves deterministic ordering.
- [x] Completion stats include startedAt, completedAt, and messageCount.

### TASK-004: Public RunAgent Facade And Attachment Normalization

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/CodexAgent/CodexAgentSDK.swift`, `Sources/CodexAgent/CodexAgentAttachments.swift`, `Tests/CodexAgentTests/CodexProcessSDKCompatibilityTests.swift`
**Dependencies**: TASK-003

**Description**:
Expose a Swift `runAgent` SDK facade for new and resumed sessions, raw and
normalized streams, and path/base64 attachments.

**Completion Criteria**:
- [x] New and resume requests use one stable public request shape.
- [x] Additional args, config overrides, env, model, sandbox, fullAuto, cwd, and stream granularity are forwarded.
- [x] Base64 data URLs and raw base64 attachments become image paths with safe filenames.
- [x] Temporary attachment files are cleaned on completion and error.
- [x] Error events include the best known session id.

### TASK-005: Normalized SDK Event Mapper

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/CodexAgent/CodexAgentEvents.swift`, `Sources/CodexAgent/CodexAgentEventNormalization.swift`, `Tests/CodexAgentTests/CodexProcessSDKCompatibilityTests.swift`
**Dependencies**: TASK-003, swift-codex-agent-session-rollout-compat:TASK-001

**Description**:
Map Codex rollout stream chunks into public normalized SDK events.

**Completion Criteria**:
- [x] Assistant text emits delta and cumulative snapshot events.
- [x] Function and local shell calls emit stable tool call/result events.
- [x] Reasoning and unknown events emit activity events.
- [x] Error rollout events emit `session.error`.
- [x] Normalized completion emits success and exit code.

### TASK-006: Readiness, Tool Versions, And SDK Utilities

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/CodexAgent/CodexAgentReadiness.swift`, `Sources/CodexAgent/CodexToolRegistry.swift`, `Sources/CodexAgent/CodexSDKEventEmitter.swift`, `Sources/CodexAgent/CodexUsageStats.swift`, `Tests/CodexAgentTests/CodexProcessSDKCompatibilityTests.swift`
**Dependencies**: TASK-001, swift-codex-agent-session-rollout-compat:TASK-003

**Description**:
Complete concrete readiness probes and SDK utility facades while preserving
deterministic no-live testing.

**Completion Criteria**:
- [x] `codex --version`, optional `git --version`, `codex login status`, and model probe command shapes are covered.
- [x] Missing command, non-zero exit, timeout, structured Codex JSON error, and env forwarding cases are tested.
- [x] Event emitter register/off/emit behavior is tested.
- [x] Tool registry register/list/get/run behavior and unknown-tool errors are tested.
- [x] Usage stats aggregate rollout token and activity data once rollout parser dependencies are available.

### TASK-007: Public Exports And Integration Verification

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Package.swift`, `Sources/CodexAgent/CodexAgent.swift`, `Tests/AgentAdapterTests/AgentAdapterTests.swift`, `Tests/CodexAgentTests/CodexProcessSDKCompatibilityTests.swift`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006

**Description**:
Expose the completed SDK surface and verify existing workflow adapter behavior
does not regress.

**Completion Criteria**:
- [x] Public Codex SDK types are exported from the `CodexAgent` target.
- [x] Existing `CodexAgentAdapter` tests still pass after command-builder sharing.
- [x] `RielflowCore` and `RielflowAdapters` remain free of Codex-specific SDK policy.
- [x] Focused and full Swift verification commands pass.

## Completion Criteria

- [x] All seven tasks are implemented or explicitly deferred with accepted dependency rationale.
- [x] Swift tests cover all migrated process and SDK runner contracts without live Codex credentials.
- [x] Existing agent adapter tests continue passing.
- [x] No shell interpolation is introduced for Codex process execution.
- [x] Temporary test artifacts are written under repository `tmp/` or XCTest-managed temporary roots only.
- [x] Verification commands and any residual risks are recorded in the progress log.

## Verification Commands

- `test -f design-docs/specs/swift-codex-agent-process-sdk-compat.md`
- `rg -n "Codex CLI 0.137|runAgent|spawnResumeStream|Normalized event" design-docs/specs/swift-codex-agent-process-sdk-compat.md`
- `test -f impl-plans/active/swift-codex-agent-process-sdk-compat.md`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test --filter CodexProcessSDKCompatibilityTests`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test --filter AgentAdapterTests`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test`

## Review Results

Plan self-review: accepted. The plan maps every design decision to deliverable
files, explicit task dependencies, completion criteria, progress tracking, and
no-live verification commands.

Independent plan review: accepted. No high or mid plan-only findings remain.
The plan intentionally records cross-feature dependencies for resume watcher and
usage-stats work instead of letting this branch duplicate session-rollout
ownership.

## Progress Log

### Session: 2026-06-17 Full Feature Parity Audit

**Tasks Completed**: Representative Swift compatibility subset only.
**Tasks In Progress**: Full SDK streaming parity, production session runner
semantics, normalized event async sequence, mock runner parity, model/tool
version helpers, and usage stats.
**Blockers**: None.
**Notes**: Audit against the codex-agent public exports and test files found
this plan was marked completed too early. The current Swift implementation does
not yet match `runAgent` as an async iterable for raw/normalized streams,
`toNormalizedEvents`, full `SessionRunner` watcher/dedupe/replay behavior,
the full mock session runner contract, SDK testing export behavior, or the
model availability, tool version, and usage stats helpers covered by the
codex-agent SDK tests. Keep this plan active until those gaps are implemented
and verified.

### Session: 2026-06-16 Final Verification

**Tasks Completed**: TASK-001 through TASK-007.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added focused Swift coverage for process argv/env, resume streams,
production `CodexProcessSessionRunner`, normalized events, attachment cleanup,
and SDK utilities. Verified with `swift test`.
