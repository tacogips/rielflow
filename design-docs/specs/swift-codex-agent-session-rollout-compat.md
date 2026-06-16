# Swift Codex Agent Session, Rollout, And Search Compatibility Design

This document defines the feature-local design for porting `codex-agent`
session discovery, rollout parsing/watching, transcript search, and activity
contracts into Swift rielflow.

## Overview

**Workflow mode**: issue-resolution
**Issue reference**: Port codex-agent functionality and tests to Swift rielflow
**Feature ID**: codex-session-rollout-search
**Feature title**: Session, rollout, and transcript compatibility
**Created**: 2026-06-16

This slice owns Codex CLI session data compatibility. It must read Codex rollout
JSONL files, expose Codex session metadata, search transcripts, watch appended
rollout lines, derive activity status, and prefer Codex's read-only SQLite
thread index when available. Rielflow's existing `WorkflowSession` store is a
workflow-runtime concept and must not be conflated with Codex CLI session
history.

## Swift Scope

Supporting Swift modules:

- `Sources/CodexAgent/CodexAgentProcess.swift`
- `Sources/CodexAgent/CodexAgentAdapter.swift`
- `Sources/RielflowCore/JSONValue.swift`
- `Sources/RielflowCore/RuntimeSession.swift`
- `Tests/AgentAdapterTests/AgentAdapterTests.swift`

## Public Behavior Matrix

| Reference behavior | Swift status | Migration decision |
| --- | --- | --- |
| Rollout line model for `session_meta`, `response_item`, `event_msg`, `compacted`, and `turn_context` | Partial JSON helper use only | Add Codex-specific rollout value types using `JSONValue` for unknown payload fields. |
| `parseRolloutLine` skips empty/invalid lines and normalizes exec `thread.started`, `item.completed`, `turn.started`, `turn.completed`, and `error` events | Missing as public Swift API | Add parser with deterministic timestamp injection for tests where the reference uses current time. |
| Provenance classification for user input, system-injected instructions, tool-generated output, and framework events | Missing | Add provenance to parsed rollout lines and session messages. |
| `readRollout`, `parseSessionMeta`, `streamEvents`, `extractFirstUserMessage`, and `getSessionMessages` | Missing | Add file and async-sequence APIs that skip malformed lines and preserve order. |
| `RolloutWatcher.watchFile`, `watchDirectory`, `flush`, `stop`, `isClosed`, and `sessionsWatchDir` | Missing | Add a Swift watcher abstraction with injected file events for tests and DispatchSource-backed production implementation. |
| `resolveCodexHome`, date-ordered `discoverRolloutPaths`, archived session scan, and `buildSession` | Missing | Add filesystem session index with CODEX_HOME override and explicit codexHome parameter support. |
| Read-only SQLite session index for `state` threads table with fallback to filesystem | Missing | Add isolated SQLite index behind a protocol; fallback to filesystem on missing DB, missing table, or read errors. |
| `listSessions`, `findSession`, and `findLatestSession` filters, sorting, pagination, git info, fork source, and malformed metadata tolerance | Missing | Add Swift session index facade with SQLite-first behavior and filesystem fallback. |
| `searchSessionTranscript` and `searchSessions` with role, case sensitivity, byte/event/time budgets, session filters, pagination, and empty-query rejection | Missing | Add bounded transcript search over rollout message extraction. |
| `deriveActivityEntry` and `getSessionActivity` status derivation | Missing | Add activity status derivation from rollout lines and session lookup. |

## Boundaries

Included:

- Codex rollout JSONL types, parser, provenance, message extraction, and file
  streaming.
- Codex rollout watcher with deterministic test injection.
- Codex session index over filesystem and read-only SQLite thread rows.
- Transcript search and activity derivation APIs.
- Focused no-live Swift tests for session, rollout, search, SQLite, watcher,
  and activity behavior.

Excluded:

- Codex process spawning and `runAgent`; those belong to the
  `codex-process-sdk` branch.
- CLI, GraphQL, queue, group, bookmark, token, markdown, and file-change
  commands; those belong to the `codex-cli-graphql-ops` branch.
- Mutating Codex's SQLite state database.
- Replacing rielflow workflow session persistence.

## Design Decisions

1. Codex session data lives inside `CodexAgent`; `RielflowCore` keeps only
   provider-neutral JSON and workflow-runtime types.
2. Swift rollout parsing uses strongly named wrappers for known fields and
   `JSONValue` for unknown Codex payload data so future Codex CLI fields are not
   discarded.
3. SQLite is an optimization and must fail open to filesystem scan. Missing
   state file, missing `threads` table, malformed rows, or SQLite errors must
   not prevent filesystem discovery.
4. Filesystem discovery preserves the reference ordering: session year, month,
   day, and rollout filenames sort descending by default; archived sessions are
   scanned after active sessions.
5. Transcript search uses parsed session messages rather than raw string
   matching so role filters, tool-message exclusion, byte/event budgets, and
   provenance behavior remain testable.
6. Watcher behavior must be deterministic under test. Production can use
   DispatchSource or another file-event adapter, but tests should drive file
   changes and time explicitly.
7. Activity status is derived only from parsed rollout lines and does not run or
   inspect live Codex processes.

## Compatibility Details

Codex session and rollout types must preserve these public values:

- session source: `cli`, `vscode`, `exec`, `unknown`
- message origin: `user_input`, `system_injected`, `tool_generated`,
  `framework_event`
- session message category: `assistant_tool_response`, `tool_user_response`,
  `other_message`
- session search role: `user`, `assistant`, `both`
- activity status: `idle`, `running`, `waiting_approval`, `failed`

Rollout parser requirements:

- Empty, whitespace-only, invalid JSON, missing type, and missing payload inputs
  return nil.
- Already-normalized rollout lines pass through after provenance derivation.
- Exec `thread.started` normalizes to `session_meta`.
- Exec `item.completed` with `agent_message` normalizes to `event_msg`
  `AgentMessage`; other completed items normalize to `response_item`.
- Exec `turn.started`, `turn.completed`, and `error` normalize to corresponding
  `event_msg` payloads.
- Unknown exec events return nil.

Session index requirements:

- `CODEX_HOME` overrides default `~/.codex`, but explicit codexHome input wins
  for testable APIs.
- Sessions are read from `sessions/YYYY/MM/DD/rollout-*.jsonl` and
  `archived_sessions/rollout-*.jsonl`.
- `buildSession` requires valid session id, timestamp, cwd, and source.
- Session title prefers the first non-injected user message, then the id.
- SQLite row mapping preserves git sha, branch, origin URL, archived time, and
  first user message.

Search and activity requirements:

- Empty search queries throw.
- Search budgets report `truncated`, `timedOut`, scanned bytes, scanned events,
  scanned sessions, duration, offset, limit, and total.
- Search text includes user messages, assistant messages, assistant reasoning,
  `TurnComplete.last_agent_message`, and response message/reasoning content
  according to role filters.
- Activity becomes `running` on turn start or command begin, `idle` on turn
  complete or command end, `failed` on aborted/error events, and
  `waiting_approval` on local shell statuses containing approval or consent.

## Review Results

Design self-review: accepted. The design maps the assigned
`codex-session-rollout-search` item to Codex session/rollout files only and
keeps process SDK and CLI/GraphQL work out of scope.

Independent design review: accepted. No high or mid design findings remain.
The review note is an implementation constraint: SQLite support must remain
behind a fallback-capable index protocol so the first implementation can still
pass filesystem-session parity if platform SQLite setup needs follow-up.

## Verification Plan

Planning verification:

- `test -f design-docs/specs/swift-codex-agent-session-rollout-compat.md`
- `rg -n "Rollout parser requirements|Session index requirements|searchSessionTranscript|Activity" design-docs/specs/swift-codex-agent-session-rollout-compat.md`
- `test -f impl-plans/active/swift-codex-agent-session-rollout-compat.md`

Implementation verification:

- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test --filter CodexSessionRolloutCompatibilityTests`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test --filter AgentAdapterTests`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test`

## Risks

- SQLite binding risk: the implementation uses a small system SQLite wrapper
  and keeps filesystem fallback behavior.
- Watcher risk: macOS file-event behavior can be nondeterministic without an
  injected watcher adapter in tests.
- Search risk: byte/event/time budget accounting can drift unless edge cases
  stay covered by focused Swift tests.
