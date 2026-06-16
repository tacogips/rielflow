# Swift Codex Agent Session, Rollout, And Search Compatibility Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/swift-codex-agent-session-rollout-compat.md
**Created**: 2026-06-16
**Last Updated**: 2026-06-17

## Design Document Reference

**Source**: `design-docs/specs/swift-codex-agent-session-rollout-compat.md`
**Workflow Mode**: issue-resolution
**Issue Reference**: Port codex-agent functionality and tests to Swift rielflow
**Feature ID**: codex-session-rollout-search
**Feature Title**: Session, rollout, and transcript compatibility

### Summary

Implement Swift Codex session compatibility: rollout JSONL parsing and
watching, filesystem and SQLite-backed session discovery, latest/find/list
operations, transcript message extraction and search, and activity status
derivation.

### Scope

**Included**: Codex rollout types, reader, watcher, session index, SQLite
fallback index, transcript search, session messages, activity derivation,
exports, and no-live Swift tests.

**Excluded**: Codex process spawning, `runAgent`, CLI/GraphQL operations,
queue/group/bookmark/token commands, workflow runtime session persistence, and
live Codex process inspection.

### Swift Implementation Surface

- `Sources/CodexAgent/CodexRollout.swift`
- `Sources/CodexAgent/CodexRolloutWatcher.swift`
- `Sources/CodexAgent/CodexSessionIndex.swift`
- `Sources/CodexAgent/CodexSessionSQLiteIndex.swift`
- `Tests/CodexAgentTests/CodexAgentCompatibilityTests.swift`

## Modules

### 1. Rollout Types And Parser

#### `Sources/CodexAgent/CodexRolloutTypes.swift`
#### `Sources/CodexAgent/CodexRolloutReader.swift`
#### `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export type SessionSource = "cli" | "vscode" | "exec" | "unknown";
export type MessageOrigin =
  | "user_input"
  | "system_injected"
  | "tool_generated"
  | "framework_event";

export interface RolloutLine {
  readonly timestamp: string;
  readonly type: "session_meta" | "response_item" | "event_msg" | "compacted" | "turn_context";
  readonly payload: unknown;
  readonly provenance?: {
    readonly role?: string;
    readonly origin: MessageOrigin;
    readonly display_default: boolean;
    readonly source_tag?: string;
  };
}
```

**Checklist**:
- [x] Define rollout line, session metadata, git info, provenance, response item, event message, compacted, and turn context Swift types.
- [x] Parse normalized rollout lines and derive provenance.
- [x] Normalize Codex exec `thread.started`, `item.completed`, `turn.started`, `turn.completed`, and `error` events.
- [x] Return nil for empty, invalid, missing-type, missing-payload, and unknown exec-event lines.
- [x] Port parser tests for valid/invalid lines and exec normalization.

### 2. Rollout File IO And Session Messages

#### `Sources/CodexAgent/CodexRolloutReader.swift`
#### `Sources/CodexAgent/CodexSessionMessages.swift`
#### `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export type SessionMessageCategory =
  | "assistant_tool_response"
  | "tool_user_response"
  | "other_message";

export interface SessionMessage {
  readonly timestamp: string;
  readonly category: SessionMessageCategory;
  readonly role: "assistant" | "user" | "unknown";
  readonly text?: string;
  readonly sourceType: RolloutLine["type"];
  readonly sourceTag?: string;
  readonly line: RolloutLine;
}
```

**Checklist**:
- [x] Implement `readRollout`, `parseSessionMeta`, `streamEvents`, and `extractFirstUserMessage`.
- [x] Implement `getSessionMessages` with tool-related and system-injected exclusion options.
- [x] Use `ExecCommandEnd.aggregated_output` before command fallback.
- [x] Drop unknown response and event message types from session message extraction.
- [x] Port tests for message category, role, ordering, provenance, and exclusion behavior.

### 3. Rollout Watcher

#### `Sources/CodexAgent/CodexRolloutWatcher.swift`
#### `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export interface WatchFileOptions {
  readonly startOffset?: number;
}

export interface RolloutWatcherEvent {
  readonly kind: "line" | "newSession" | "error";
  readonly path?: string;
  readonly line?: RolloutLine;
  readonly error?: string;
}
```

**Checklist**:
- [x] Watch a rollout file from current size by default and from explicit `startOffset` when provided.
- [x] Emit parsed appended lines and ignore pre-watch content by default.
- [x] Watch session directories for new `rollout-*.jsonl` files.
- [x] Implement `flush`, `stop`, `isClosed`, duplicate watch suppression, and `sessionsWatchDir`.
- [x] Add deterministic tests using injected file-event/time adapters.

### 4. Session Index And SQLite Fallback

#### `Sources/CodexAgent/CodexSessionIndex.swift`
#### `Sources/CodexAgent/CodexSessionSQLiteIndex.swift`
#### `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export interface CodexSession {
  readonly id: string;
  readonly rolloutPath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source: SessionSource;
  readonly modelProvider?: string;
  readonly cwd: string;
  readonly cliVersion: string;
  readonly title: string;
  readonly firstUserMessage?: string;
  readonly archivedAt?: string;
  readonly git?: { readonly sha?: string; readonly branch?: string; readonly origin_url?: string };
  readonly forkedFromId?: string;
}
```

**Checklist**:
- [x] Implement `resolveCodexHome`, `discoverRolloutPaths`, `buildSession`, `listSessions`, `findSession`, and `findLatestSession`.
- [x] Scan active date directories newest-first and archived sessions after active sessions.
- [x] Filter by source, cwd, and branch; support limit, offset, sortBy, and sortOrder.
- [x] Add read-only SQLite `state`/`threads` mapping behind a fallback-capable protocol.
- [x] Fall back to filesystem when SQLite DB is missing, malformed, inaccessible, or lacks `threads`.
- [x] Port filesystem and SQLite session index tests.

### 5. Transcript Search

#### `Sources/CodexAgent/CodexSessionSearch.swift`
#### `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export interface SessionTranscriptSearchOptions {
  readonly caseSensitive?: boolean;
  readonly role?: "user" | "assistant" | "both";
  readonly maxBytes?: number;
  readonly maxEvents?: number;
  readonly timeoutMs?: number;
}

export interface SessionsSearchResult {
  readonly sessionIds: readonly string[];
  readonly total: number;
  readonly scannedSessions: number;
  readonly scannedBytes: number;
  readonly scannedEvents: number;
  readonly truncated: boolean;
  readonly timedOut: boolean;
}
```

**Checklist**:
- [x] Implement `searchSessionTranscript` and `searchSessions`.
- [x] Reject empty search queries.
- [x] Support case-sensitive and role-filtered matching.
- [x] Track match counts, scanned bytes/events/sessions, truncation, timeouts, duration, offset, and limit.
- [x] Use SQLite candidates when available and filesystem candidates otherwise.
- [x] Port tests for Japanese text, deep transcripts, budgets, filters, pagination, and malformed metadata.

### 6. Activity Derivation

#### `Sources/CodexAgent/CodexActivity.swift`
#### `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export type ActivityStatus =
  | "idle"
  | "running"
  | "waiting_approval"
  | "failed";

export interface ActivityEntry {
  readonly sessionId: string;
  readonly status: ActivityStatus;
  readonly updatedAt: string;
}
```

**Checklist**:
- [x] Implement `deriveActivityEntry` from parsed rollout lines.
- [x] Implement `getSessionActivity` by session id and codexHome.
- [x] Map turn start/command begin to running and turn complete/command end to idle.
- [x] Map aborted/error events to failed.
- [x] Map local shell approval/consent statuses to waiting_approval.
- [x] Port activity manager tests.

### 7. Public Exports And Cross-Feature Contract

#### `Package.swift`
#### `Sources/CodexAgent/CodexAgent.swift`
#### `Sources/CodexAgent/CodexAgentProcess.swift`
#### `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export interface CodexSessionRolloutCompatibilitySurface {
  readonly rolloutReader: "parseRolloutLine";
  readonly rolloutWatcher: "RolloutWatcher";
  readonly sessionIndex: "listSessions";
  readonly transcriptSearch: "searchSessions";
  readonly activity: "getSessionActivity";
}
```

**Checklist**:
- [x] Export session, rollout, search, watcher, and activity APIs from `CodexAgent`.
- [x] Add or reuse a focused `CodexAgentTests` SwiftPM test target.
- [x] Keep workflow-runtime `WorkflowSession` APIs separate from Codex CLI `CodexSession`.
- [x] Expose parser/index APIs needed by `codex-process-sdk` resume and usage-stats tasks.
- [x] Verify existing `AgentAdapterTests` still pass.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Rollout types and parser | `Sources/CodexAgent/CodexRolloutTypes.swift`, `Sources/CodexAgent/CodexRolloutReader.swift` | NOT_STARTED | `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift` |
| Rollout file IO and messages | `Sources/CodexAgent/CodexRolloutReader.swift`, `Sources/CodexAgent/CodexSessionMessages.swift` | NOT_STARTED | `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift` |
| Rollout watcher | `Sources/CodexAgent/CodexRolloutWatcher.swift` | NOT_STARTED | `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift` |
| Session index and SQLite fallback | `Sources/CodexAgent/CodexSessionIndex.swift`, `Sources/CodexAgent/CodexSessionSQLiteIndex.swift` | NOT_STARTED | `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift` |
| Transcript search | `Sources/CodexAgent/CodexSessionSearch.swift` | NOT_STARTED | `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift` |
| Activity derivation | `Sources/CodexAgent/CodexActivity.swift` | NOT_STARTED | `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift` |
| Exports and contract | `Package.swift`, `Sources/CodexAgent/CodexAgent.swift`, `Sources/CodexAgent/CodexAgentProcess.swift` | NOT_STARTED | `Tests/AgentAdapterTests/AgentAdapterTests.swift`, Codex session tests |

## Dependencies

| Feature | Depends On | Status |
| --- | --- | --- |
| TASK-001 rollout types and parser | None | COMPLETED |
| TASK-002 rollout file IO and messages | TASK-001 | COMPLETED |
| TASK-003 rollout watcher | TASK-001, TASK-002 | COMPLETED |
| TASK-004 session index and SQLite fallback | TASK-001, TASK-002 | COMPLETED |
| TASK-005 transcript search | TASK-002, TASK-004 | COMPLETED |
| TASK-006 activity derivation | TASK-001, TASK-002, TASK-004 | COMPLETED |
| TASK-007 exports and cross-feature contract | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006 | COMPLETED |

## Tasks

### TASK-001: Rollout Types And Parser

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `Sources/CodexAgent/CodexRolloutTypes.swift`, `Sources/CodexAgent/CodexRolloutReader.swift`, `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift`
**Dependencies**: None

**Description**:
Define Codex rollout data types and parser normalization behavior.

**Completion Criteria**:
- [x] Known rollout item and event shapes are represented.
- [x] Unknown payload fields survive through `JSONValue`.
- [x] Parser nil and exec-normalization cases match reference tests.
- [x] Provenance is derived for session meta, user messages, assistant/tool output, and framework events.

### TASK-002: Rollout File IO And Session Messages

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/CodexAgent/CodexRolloutReader.swift`, `Sources/CodexAgent/CodexSessionMessages.swift`, `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift`
**Dependencies**: TASK-001

**Description**:
Implement file-level rollout reading, streaming, metadata extraction, first
message extraction, and session message categorization.

**Completion Criteria**:
- [x] Malformed lines are skipped.
- [x] Session metadata is read only from the first parsed session-meta line.
- [x] First user message ignores system-injected messages.
- [x] Session messages classify tool/user/assistant exchanges and exclusions.

### TASK-003: Rollout Watcher

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/CodexAgent/CodexRolloutWatcher.swift`, `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift`
**Dependencies**: TASK-001, TASK-002

**Description**:
Implement real-time rollout file and session-directory watching with
deterministic test hooks.

**Completion Criteria**:
- [x] Watch starts at current file size unless `startOffset` is provided.
- [x] Appended valid rollout lines are emitted once.
- [x] Duplicate watch requests are ignored.
- [x] `flush`, `stop`, `isClosed`, and `sessionsWatchDir` behavior is tested.

### TASK-004: Session Index And SQLite Fallback

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/CodexAgent/CodexSessionIndex.swift`, `Sources/CodexAgent/CodexSessionSQLiteIndex.swift`, `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift`
**Dependencies**: TASK-001, TASK-002

**Description**:
Implement Codex session listing and lookup through SQLite-first, filesystem
fallback indexing.

**Completion Criteria**:
- [x] Explicit codexHome and CODEX_HOME behavior is deterministic.
- [x] Active and archived rollout paths are discovered in reference order.
- [x] `buildSession`, `listSessions`, `findSession`, and `findLatestSession` match filters and pagination.
- [x] SQLite rows map git and archived metadata and fall back safely on failure.

### TASK-005: Transcript Search

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/CodexAgent/CodexSessionSearch.swift`, `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift`
**Dependencies**: TASK-002, TASK-004

**Description**:
Implement bounded transcript search across one session or many sessions.

**Completion Criteria**:
- [x] Empty query throws.
- [x] Case-sensitive, role-filtered, Unicode, and reasoning text search works.
- [x] Byte/event/time budgets produce correct truncation and timeout flags.
- [x] Cross-session filters, pagination, totals, and malformed metadata handling are tested.

### TASK-006: Activity Derivation

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/CodexAgent/CodexActivity.swift`, `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift`
**Dependencies**: TASK-001, TASK-002, TASK-004

**Description**:
Implement activity status derivation from parsed rollout events.

**Completion Criteria**:
- [x] Turn and command start/end transitions produce running and idle.
- [x] Aborted/error events produce failed.
- [x] Approval/consent shell statuses produce waiting_approval.
- [x] `getSessionActivity` returns nil for unknown sessions.

### TASK-007: Public Exports And Cross-Feature Contract

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Package.swift`, `Sources/CodexAgent/CodexAgent.swift`, `Sources/CodexAgent/CodexAgentProcess.swift`, `Tests/CodexAgentTests/CodexSessionRolloutCompatibilityTests.swift`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006

**Description**:
Export the Codex session/rollout APIs and publish the parser/index contracts
needed by process SDK resume and usage-stats work.

**Completion Criteria**:
- [x] Public APIs are exported from `CodexAgent`.
- [x] The process SDK branch can consume rollout parser, watcher, and session index APIs without duplicating them.
- [x] `WorkflowSession` and `CodexSession` remain separate concepts.
- [x] Focused and full Swift verification commands pass.

## Completion Criteria

- [x] All seven tasks are implemented or explicitly deferred with accepted rationale.
- [x] Swift tests port reference coverage for session, rollout, watcher, search, SQLite, and activity behavior.
- [x] Codex session APIs remain under `CodexAgent`.
- [x] SQLite index failures fall back to filesystem session discovery.
- [x] Watcher tests are deterministic and do not require live Codex sessions.
- [x] Verification results and residual risks are recorded in this progress log.

## Verification Commands

- `test -f design-docs/specs/swift-codex-agent-session-rollout-compat.md`
- `rg -n "Rollout parser requirements|Session index requirements|searchSessionTranscript|Activity" design-docs/specs/swift-codex-agent-session-rollout-compat.md`
- `test -f impl-plans/active/swift-codex-agent-session-rollout-compat.md`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test --filter CodexSessionRolloutCompatibilityTests`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test --filter AgentAdapterTests`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test`

## Review Results

Plan self-review: accepted. The plan maps the accepted design to deliverables,
task dependencies, completion criteria, and verification commands while keeping
process SDK and CLI/GraphQL work outside this branch.

Independent plan review: accepted. No high or mid plan-only findings remain.
SQLite is explicitly scoped behind a fallback-capable protocol, and watcher
testing is required to use deterministic injection.

## Progress Log

### Session: 2026-06-17 Full Feature Parity Audit

**Tasks Completed**: Representative Swift compatibility subset only.
**Tasks In Progress**: Rollout async streaming, type guard helpers, activity
lookup by session id, exact transcript search result fields, and watcher API
parity.
**Blockers**: None.
**Notes**: Audit against the codex-agent public exports and test files found
this plan was marked completed too early. The current Swift implementation does
not yet expose full equivalents for `streamEvents`, rollout item type guards,
`getSessionActivity`, all search metadata fields, and EventEmitter-style
watcher semantics. Keep this plan active until those gaps are implemented and
verified by focused Swift tests.

### Session: 2026-06-16 Final Verification

**Tasks Completed**: TASK-001 through TASK-007.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added focused Swift coverage for rollout parsing/messages, watcher
append/new-session behavior, SQLite-backed session lookup and filesystem
fallback, transcript role/case/budget/timeout behavior, and activity
derivation. Verified with `swift test`.
