# Swift Codex Agent Process And SDK Compatibility Design

This document defines the feature-local design for porting the `codex-agent`
process and SDK runner contracts into Swift rielflow.

## Overview

**Workflow mode**: issue-resolution
**Issue reference**: Port codex-agent functionality and tests to Swift rielflow
**Feature ID**: codex-process-sdk
**Feature title**: Codex process and SDK runner compatibility
**Created**: 2026-06-16

The Swift migration preserves the public process and SDK behavior directly in
the `CodexAgent` Swift target. This slice owns Codex CLI subprocess contracts,
`runAgent`/session-runner event behavior, SDK readiness helpers, SDK utility
facades, deterministic mocks, and the Swift tests that prove parity.

The existing Swift `CodexAgent` target already covers the rielflow workflow node
adapter boundary: provider output, `codex exec --json`, `model_reasoning_effort`,
image forwarding, auth preflight, final assistant text extraction, output
contract parsing, deadline propagation, and redaction. This design extends that
coverage to the broader codex-agent process and SDK surface.

## Swift Scope

Supporting Swift modules:

- `Sources/CodexAgent/CodexAgentAdapter.swift`
- `Sources/CodexAgent/CodexAgentReadiness.swift`
- `Sources/RielflowAdapters/LocalAgentProcess.swift`
- `Sources/RielflowAdapters/AdapterUtilities.swift`
- `Tests/AgentAdapterTests/AgentAdapterTests.swift`

## Public Behavior Matrix

| Reference behavior | Swift status | Migration decision |
| --- | --- | --- |
| `ProcessManager.spawnExec` builds `codex exec --json`, parses JSONL rollout lines, returns exit code plus lines | Partial adapter-only coverage | Add Codex process manager API with injectable runner and focused argv/parser tests. |
| `spawnExecStream` returns process handle, async line stream, completion promise, and drains stderr | Missing public SDK surface | Add Swift running process/session stream abstraction over `LocalAgentProcessRunning`. |
| `spawnResumeStream` builds `codex exec resume --json`, watches rollout file, dedupes stdout/watcher lines, and keeps requested session id on resume | Missing; depends on session/rollout parsing | Add resume runner that consumes session/rollout APIs from the session-rollout feature and fails closed if they are unavailable. |
| `spawnFork`, `list`, `get`, `kill`, `writeInput`, `killAll`, `prune` process lifecycle | Missing public SDK surface | Add tracked process registry with deterministic mock runner tests; interactive input only when process stdin exists. |
| Codex CLI 0.137 compatibility: `approvalMode` is a no-op, `fullAuto` maps to `--dangerously-bypass-approvals-and-sandbox` | Adapter has partial coverage | Centralize process option builder and assert both adapter and SDK runner use the same compatibility rules. |
| `additionalArgs`, `configOverrides`, `images`, `sandbox`, `model`, `cwd`, `systemPrompt`, and environment forwarding | Adapter has partial coverage | Preserve exact ordering: options before prompt, image option terminator before prompt, system prompt prefix, environment overlay. |
| `SessionRunner.startSession` returns `RunningSession`, pending id updates from `session_meta`, event/char stream granularity, completion stats | Missing | Add Swift `CodexSessionRunner` and `CodexRunningSession` async-sequence API. |
| `SessionRunner.resumeSession` uses request-scoped `CODEX_HOME`, optional existing rollout replay, watcher attach after delayed session discovery | Missing; depends on session/rollout feature | Implement after the session-rollout feature exposes session lookup and rollout file streaming contracts. |
| `runAgent` stable request object supports new and resume sessions, normalized or raw streams, path/base64 attachments, and cleanup | Missing | Add Swift facade that normalizes attachments, calls session runner, yields raw or normalized events, and always cleans temporary attachment files. |
| Normalized events: `session.started`, `assistant.delta`, `assistant.snapshot`, `tool.call`, `tool.result`, `activity`, `session.completed`, `session.error` | Adapter only extracts final assistant text | Add provider-agnostic normalized SDK event mapper for Codex rollout line shapes. |
| `BasicSdkEventEmitter`, `ToolRegistry`, `MockCodexSessionRunner` | Missing | Add lightweight deterministic SDK utilities for Swift tests and embedded users. |
| `getToolVersions`, `getCodexLoginStatus`, `checkCodexModelAvailability` | Data structs and injected readiness exist; concrete operations missing | Add concrete probe operations mirroring codex-agent command shapes and bounded timeouts. |
| `getCodexUsageStats` from rollout JSONL files, token_count deltas, cache TTL, daily activity | Missing; depends on rollout parser | Add usage stats only after the session-rollout feature owns rollout line parsing. |

## Boundaries

Included:

- Public Swift contracts that mirror codex-agent process and SDK runner concepts.
- Codex CLI subprocess argv construction for exec, resume, and fork.
- Session runner and `runAgent` async event behavior.
- Normalized event mapping from Codex rollout lines.
- Concrete tool/version/auth/model probe operations behind injected process runners.
- SDK support utilities: event emitter, tool registry, mock runner, and usage stats.
- Focused no-live Swift tests using injected runners and local fixture files.

Excluded:

- CLI, GraphQL, queue, group, bookmark, token, markdown, and file-change command
  behavior; those belong to the `codex-cli-graphql-ops` branch.
- Session discovery, transcript search, rollout file parsing, and watcher
  primitives except as consumed dependencies; those belong to the
  `codex-session-rollout-search` branch.
- Live Codex credentials, network calls, or real model availability in tests.
- Removing unrelated rielflow runtime fallback paths outside the CodexAgent
  Swift compatibility surface.

## Design Decisions

1. Swift keeps adapter and SDK process contracts separate but shared at the argv
   builder level. `CodexAgentAdapter` remains the workflow node adapter; new
   SDK APIs wrap the same Codex command semantics for library users.
2. Process execution remains argv-array based through injected
   `LocalAgentProcessRunning`; no shell interpolation is introduced.
3. `approvalMode` remains accepted input for compatibility but is never emitted
   as `--ask-for-approval`.
4. `fullAuto` maps to `--dangerously-bypass-approvals-and-sandbox` for both new
   and resumed executions.
5. Resume-session implementation must depend on accepted session/rollout Swift
   APIs rather than reimplementing session search or JSONL rollout parsing in
   this slice.
6. Base64 attachments are decoded into task-scoped temporary files, forwarded as
   image paths, and cleaned after the agent stream completes or errors.
7. Normalized stream output is an additive SDK feature. Workflow output
   publication and candidate-path handling remain runtime-owned.
8. Tests must be deterministic and no-live: process runners, clocks, temp roots,
   rollout streams, and readiness probes are injected.

## Compatibility Details

The Swift process option model must preserve these codex-agent public values:

- sandbox modes: `read-only`, `workspace-write`, `danger-full-access`
- approval modes: `always`, `unless-allow-listed`, `never`, `on-failure`
- stream granularities: `event`, `char`
- process statuses: `running`, `exited`, `killed`
- agent stream modes: `raw`, `normalized`

Command construction requirements:

- New session: `codex exec --json` plus common options, image flags, optional
  `--`, then the final prompt argument.
- Resume session: `codex exec`, optional resume-level sandbox, `resume --json`,
  resume common options, image flags, optional `--`, session id, and optional
  prompt.
- Fork: `codex fork <sessionId>` plus optional `--nth-message <n>` and common
  options.
- Common options preserve model, full-auto bypass, sandbox where valid,
  config overrides as repeated `-c`, and additional args in caller order.

Normalized event requirements:

- `session_meta` can emit `session.started` and update the pending session id.
- Assistant text from event messages, response messages, and char chunks emits
  `assistant.delta` and cumulative `assistant.snapshot`.
- Function calls, function call output, local shell calls, and Codex exec event
  messages map to `tool.call` or `tool.result` with stable names.
- Reasoning and unknown event messages map to `activity`.
- Rollout error events map to `session.error`.
- Completion emits success, exit code, and stats derived from the running
  session.

## Review Results

Design self-review: accepted. The design is scoped to the assigned
`codex-process-sdk` fanout item, keeps code changes under Codex process/SDK
targets, separates dependencies on session-rollout work, and lists reference
tests that must be ported.

Independent design review: accepted after checking for branch overlap. No high
or mid design findings remain. The only review note is an implementation-order
constraint: usage stats and resume watcher work must not proceed before the
session-rollout feature exposes accepted Swift rollout/session primitives.

## Verification Plan

Planning verification:

- `test -f design-docs/specs/swift-codex-agent-process-sdk-compat.md`
- `rg -n "Codex CLI 0.137|runAgent|spawnResumeStream|Normalized event" design-docs/specs/swift-codex-agent-process-sdk-compat.md`
- `test -f impl-plans/active/swift-codex-agent-process-sdk-compat.md`

Implementation verification:

- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test --filter CodexProcessSDKCompatibilityTests`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test --filter AgentAdapterTests`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test`

## Risks

- Cross-branch dependency risk: resume and usage stats require the
  session-rollout feature's accepted Swift parsing and discovery contracts.
- Scope risk: codex-agent SDK exports include utility APIs that are not needed
  by current workflow execution but are public compatibility contracts.
- Process risk: subprocess lifecycle, stdin, deadlines, and temp attachment
  cleanup can deadlock or leak resources without focused injected-runner tests.
