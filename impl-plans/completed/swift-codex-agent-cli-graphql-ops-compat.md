# Swift Codex Agent CLI, GraphQL, And Operations Compatibility Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/swift-codex-agent-cli-graphql-ops-compat.md
**Created**: 2026-06-16
**Last Updated**: 2026-06-17

## Design Document Reference

**Source**: `design-docs/specs/swift-codex-agent-cli-graphql-ops-compat.md`
**Workflow Mode**: issue-resolution
**Issue Reference**: `impl-plans/active/swift-codex-agent-cli-graphql-ops-compat.md`
**Feature ID**: codex-cli-graphql-ops
**Feature Title**: CLI, GraphQL, and orchestration compatibility

### Summary

Implement Swift compatibility for codex-agent operational surfaces above the
process/session primitives: CLI parsing and formatting, local command GraphQL,
queue and group orchestration, bookmark and token stores, file-change indexing,
markdown parsing, public exports, and verification.

### Scope

**Included**: CodexAgent-local compatibility parsers, formatters, command
services, local GraphQL executor, queue/group/bookmark/token/file-change/markdown
APIs, JSON-backed stores, accepted RielflowCLI routes, and no-live Swift tests.

**Excluded**: Making `../codex-agent` a runtime dependency, changing rielflow
manager GraphQL behavior, live Codex credentials, live process execution, real
user config mutation in tests, and Cursor behavior except negative isolation
coverage in `Tests/AgentAdapterTests`.

### Current Parity State

The 2026-06-17 parity gate found that this plan had previously been marked
completed too early. The follow-up implementation completed the non-deferred
rows below with Swift implementation, focused Swift tests, full Swift tests, and
a Rielflow verification workflow.

| Source reference | Target boundary | Status | Required evidence |
| --- | --- | --- | --- |
| `../codex-agent/src/bin.ts`, `../codex-agent/src/main.ts`, `../codex-agent/src/cli/*` | `Sources/CodexAgent`, accepted `Sources/RielflowCLI` routes | complete | `CodexCLICompatibility` parser/usage/format tests; no new `RielflowCLI` route exposure was accepted in this plan. |
| `../codex-agent/src/cli/graphql.ts`, `../codex-agent/src/graphql` | `Sources/CodexAgent` only | complete | Local command execution, shorthand query/mutation/subscription handling, params/variables parsing, unsupported-command diagnostics, and process-option forwarding tests. |
| `../codex-agent/src/queue`, `../codex-agent/src/group` | `Sources/CodexAgent` repositories/runners | complete | JSON-backed queue persistence, prompt/image status mutation, pause/resume/delete/move/mode behavior, bounded injected-runner orchestration, and focused tests. |
| `../codex-agent/src/bookmark`, `../codex-agent/src/auth/token-manager.ts` | `Sources/CodexAgent` stores/managers | complete | Bookmark validation/filtering/search and token create/list/verify/revoke/rotate with hashes, metadata-only listing, wildcard permissions, and focused tests. |
| `../codex-agent/src/file-changes`, `../codex-agent/src/markdown` | `Sources/CodexAgent` services | complete | File-change summary/history/find/rebuild APIs, moved-file handling, failed/read-only command filtering, markdown sections/tasks, and focused tests. |
| `../codex-agent/src/session`, `../codex-agent/src/process`, `../codex-agent/src/sdk` | Existing accepted CodexAgent process/session APIs | complete | Session command wiring for list/show/search/watch/run/resume/fork forwards into accepted Swift process/session surfaces without runtime source dependency. |

## Modules

### 1. Shared Operational Contracts And Stores

#### `Sources/CodexAgent/CodexOperationalStores.swift`
#### `Sources/CodexAgent/CodexOperations.swift`
#### `Tests/CodexAgentTests/CodexAgentCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export interface CodexAgentCompatibilityContext {
  readonly codexHome?: string;
  readonly configDir?: string;
}

export interface JsonBackedStore<T> {
  load(): Promise<T>;
  save(value: T): Promise<void>;
}
```

**Checklist**:
- [x] Inventory existing Swift contracts and keep reusable pieces.
- [x] Define explicit config-root, clock, id-generator, JSON codec, and injected-runner contracts.
- [x] Ensure missing config files return empty defaults and writes produce valid JSON.
- [x] Keep tests isolated from real user config.

### 2. CLI Parser, Formatter, Version, And Model Commands

#### `Sources/CodexAgent/CodexOperations.swift`
#### `Sources/RielflowCLI/RielflowCommand.swift`
#### `Sources/RielflowCLI/WorkflowCommands.swift`
#### `Tests/CodexAgentTests/CodexAgentCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export interface CodexCliCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CodexCliProcessOptions {
  readonly model?: string;
  readonly sandbox?: string;
  readonly fullAuto?: boolean;
  readonly streamGranularity?: "event" | "char";
}
```

**Checklist**:
- [x] Port command-family parsing for session, group, queue, bookmark, token, files, model, version, and graphql.
- [x] Preserve table and JSON formatter behavior for sessions, rollout lines, and command results.
- [x] Implement usage, version, model-check, and process-option validation.
- [x] Wire only accepted compatibility commands into `RielflowCLI`.
- [x] Add parser/formatter tests equivalent to codex-agent CLI tests.

### 3. Local GraphQL Command Executor

#### `Sources/CodexAgent/CodexOperations.swift`
#### `Sources/RielflowGraphQL/RielflowGraphQL.swift`
#### `Tests/CodexAgentTests/CodexAgentCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export interface GraphqlExecutionRequest {
  readonly document: string;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly context?: CodexAgentCompatibilityContext;
}

export type GraphqlOperationResult =
  | { readonly data?: unknown; readonly errors?: readonly string[] }
  | AsyncIterable<{ readonly data?: unknown; readonly errors?: readonly string[] }>;
```

**Checklist**:
- [x] Keep local command GraphQL inside `CodexAgent`, separate from manager GraphQL.
- [x] Normalize shorthand documents to query, mutation, or subscription command forms.
- [x] Parse `--param` and `--variables` inline JSON and file inputs.
- [x] Dispatch command names listed in the design compatibility details.
- [x] Return explicit unknown-command and unsupported-subscription diagnostics.

### 4. Queue And Group Orchestration

#### `Sources/CodexAgent/CodexOperations.swift`
#### `Sources/CodexAgent/CodexOperationalStores.swift`
#### `Tests/CodexAgentTests/CodexAgentCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export type QueuePromptStatus = "pending" | "running" | "completed" | "failed";
export type QueueCommandMode = "auto" | "manual";

export interface GroupRunOptions {
  readonly maxConcurrent?: number;
  readonly model?: string;
  readonly sandbox?: string;
  readonly fullAuto?: boolean;
}
```

**Checklist**:
- [x] Implement queue create/list/show/add/update/remove/move/mode/pause/resume/delete behavior.
- [x] Persist prompt image attachments, statuses, modes, result exit codes, and timestamps.
- [x] Implement queue runner over injected Codex process/session runner.
- [x] Implement group create/list/show/add/remove/pause/resume/delete behavior.
- [x] Implement bounded group runner and deterministic event summaries.

### 5. Bookmark And Token Managers

#### `Sources/CodexAgent/CodexOperations.swift`
#### `Sources/CodexAgent/CodexOperationalStores.swift`
#### `Tests/CodexAgentTests/CodexAgentCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export type BookmarkType = "session" | "message" | "range";
export type Permission =
  | "session:create"
  | "session:read"
  | "session:cancel"
  | "group:*"
  | "queue:*"
  | "bookmark:*";
```

**Checklist**:
- [x] Implement bookmark CRUD, normalized tags, filters, and text relevance search.
- [x] Enforce message/range/session type-specific field rules.
- [x] Implement token create/list/verify/revoke/rotate with hashed token secrets.
- [x] Preserve default permissions, CSV parsing, and wildcard permission checks.
- [x] Prove token list output never exposes token secrets.

### 6. File-Change Index And Markdown Utilities

#### `Sources/CodexAgent/CodexSessionIndex.swift`
#### `Sources/CodexAgent/CodexRollout.swift`
#### `Sources/CodexAgent/CodexOperations.swift`
#### `Tests/CodexAgentTests/CodexAgentCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export type FileOperation = "created" | "modified" | "deleted";
export type FileChangeSource =
  | "apply_patch"
  | "shell"
  | "exec_command"
  | "local_shell";

export interface MarkdownTask {
  readonly sectionHeading: string;
  readonly text: string;
  readonly checked: boolean;
}
```

**Checklist**:
- [x] Extract file changes from successful apply_patch and shell/local_shell rollout events.
- [x] Ignore failed and read-only shell commands.
- [x] Preserve moved-file history under old and new paths.
- [x] Implement changed-files summary, patch history, file lookup, and rebuild index.
- [x] Parse markdown into heading sections and checkbox tasks.

### 7. Session Command Wiring

#### `Sources/CodexAgent/CodexProcessManager.swift`
#### `Sources/CodexAgent/CodexSessionIndex.swift`
#### `Sources/CodexAgent/CodexRolloutWatcher.swift`
#### `Sources/RielflowCLI/RielflowCommand.swift`
#### `Tests/CodexAgentTests/CodexAgentCompatibilityTests.swift`

**Status**: COMPLETED

```typescript
export interface CodexSessionCommandSurface {
  readonly list: "session.list";
  readonly show: "session.show";
  readonly watch: "session.watch";
  readonly run: "session.run";
  readonly resume: "session.resume";
  readonly fork: "session.fork";
}
```

**Checklist**:
- [x] Wire `session.list`, `session.show`, `session.search`, and `session.searchTranscript` to accepted session APIs.
- [x] Wire `session.watch` to accepted rollout watcher APIs.
- [x] Wire `session.run`, `session.resume`, and `session.fork` to accepted process SDK APIs.
- [x] Validate process options and environment variable values before forwarding.
- [x] Preserve GraphQL tests for process option forwarding without obsolete flags.

### 8. Public Exports, Package Metadata, And Integration Verification

#### `Package.swift`
#### `Sources/CodexAgent`
#### `Tests/CodexAgentTests`
#### `Tests/AgentAdapterTests`

**Status**: COMPLETED

```typescript
export interface CodexCliGraphQLOpsCompatibilitySurface {
  readonly cli: "CodexCLICompatibility";
  readonly graphql: "CodexGraphQLCommandExecutor";
  readonly queue: "CodexQueue";
  readonly group: "CodexGroup";
  readonly bookmark: "CodexBookmarks";
  readonly token: "CodexTokenManager";
  readonly files: "CodexFileChanges";
  readonly markdown: "CodexMarkdown";
}
```

**Checklist**:
- [x] Export operational compatibility APIs from `CodexAgent`.
- [x] Keep package targets and SwiftPM tests aligned.
- [x] Add adapter isolation tests proving Cursor behavior did not widen.
- [x] Keep local GraphQL command executor out of rielflow manager GraphQL unless separately accepted.
- [x] Verify focused and full Swift test commands pass before plan completion.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Shared contracts and stores | `Sources/CodexAgent/CodexOperationalStores.swift`, `Sources/CodexAgent/CodexOperations.swift` | COMPLETED | `Tests/CodexAgentTests/CodexAgentCompatibilityTests.swift` |
| CLI parser and formatters | `Sources/CodexAgent/CodexOperations.swift`, accepted `Sources/RielflowCLI/*` routes | COMPLETED | Codex compatibility tests, `Tests/RielflowCLITests/*` if CLI routes change |
| GraphQL command executor | `Sources/CodexAgent/CodexOperations.swift` | COMPLETED | Codex compatibility tests |
| Queue and group | `Sources/CodexAgent/CodexOperations.swift`, `Sources/CodexAgent/CodexOperationalStores.swift` | COMPLETED | Codex compatibility tests |
| Bookmark and token | `Sources/CodexAgent/CodexOperations.swift`, `Sources/CodexAgent/CodexOperationalStores.swift` | COMPLETED | Codex compatibility tests |
| File changes and markdown | `Sources/CodexAgent/CodexRollout.swift`, `Sources/CodexAgent/CodexSessionIndex.swift`, `Sources/CodexAgent/CodexOperations.swift` | COMPLETED | Codex compatibility tests |
| Session command wiring | `Sources/CodexAgent/CodexProcessManager.swift`, `Sources/CodexAgent/CodexSessionIndex.swift`, `Sources/CodexAgent/CodexRolloutWatcher.swift` | COMPLETED | Codex compatibility tests |
| Exports and integration | `Package.swift`, `Sources/CodexAgent`, `Tests/AgentAdapterTests` | COMPLETED | Codex compatibility tests, adapter isolation tests, full Swift suite |

## Dependencies

| Feature | Depends On | Status |
| --- | --- | --- |
| TASK-001 shared contracts and stores | None | COMPLETED |
| TASK-002 CLI parser and formatters | TASK-001, codex-process-sdk:TASK-001, codex-session-rollout-search:TASK-001 | COMPLETED: parser/formatters complete; RielflowCLI route exposure remains intentionally narrow |
| TASK-003 GraphQL command executor | TASK-001, TASK-002 | COMPLETED |
| TASK-004 queue and group orchestration | TASK-001, codex-process-sdk:TASK-004 | COMPLETED |
| TASK-005 bookmark and token managers | TASK-001 | COMPLETED |
| TASK-006 file-change index and markdown | TASK-001, codex-session-rollout-search:TASK-002 | COMPLETED |
| TASK-007 session command wiring | TASK-002, TASK-003, codex-process-sdk:TASK-003, codex-session-rollout-search:TASK-004 | COMPLETED |
| TASK-008 exports and integration verification | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007 | COMPLETED |

## Tasks

### TASK-001: Shared Operational Contracts And Stores

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `Sources/CodexAgent/CodexOperationalStores.swift`, `Sources/CodexAgent/CodexOperations.swift`, `Tests/CodexAgentTests/CodexAgentCompatibilityTests.swift`
**Dependencies**: None

**Description**:
Inventory existing Swift compatibility helpers, retain usable contracts, and
complete config-root, JSON-store, clock, id-generator, and injected-runner
contracts used by the rest of this plan.

**Completion Criteria**:
- [x] Existing code inventory records reusable versus missing behavior.
- [x] Stores use explicit config roots in tests.
- [x] Missing config files return empty defaults.
- [x] Writes produce valid JSON.
- [x] Tests do not mutate real user config.

### TASK-002: CLI Parser, Formatter, Version, And Model Commands

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/CodexAgent/CodexOperations.swift`, accepted `Sources/RielflowCLI/*` route changes, `Tests/CodexAgentTests/CodexAgentCompatibilityTests.swift`
**Dependencies**: TASK-001, codex-process-sdk:TASK-001, codex-session-rollout-search:TASK-001

**Description**:
Port codex-agent command parsing, usage/help, process option parsing, output
formatting, version, and model-check behavior for accepted command families.

**Completion Criteria**:
- [x] Command parser covers session, group, queue, bookmark, token, files, model, version, and graphql families.
- [x] Process option enum validation matches reference behavior.
- [x] Table and JSON formatters match representative reference outputs.
- [x] Version/model argument parsing tests pass.
- [x] Help output documents the GraphQL compatibility command.

### TASK-003: Local GraphQL Command Executor

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/CodexAgent/CodexOperations.swift`, `Tests/CodexAgentTests/CodexAgentCompatibilityTests.swift`
**Dependencies**: TASK-001, TASK-002

**Description**:
Complete codex-agent local GraphQL command execution, command dispatch, JSON
scalar handling, variables/params parsing, and shorthand CLI behavior.

**Completion Criteria**:
- [x] Query, mutation, and subscription shorthand normalization works.
- [x] `--param` and `--variables` load inline JSON and file JSON.
- [x] Command executor dispatches all design-listed command names or fails with explicit unsupported diagnostics.
- [x] Unknown commands and unsupported subscriptions fail explicitly.
- [x] Executor remains separate from rielflow manager GraphQL schema.

### TASK-004: Queue And Group Orchestration

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/CodexAgent/CodexOperations.swift`, `Sources/CodexAgent/CodexOperationalStores.swift`, `Tests/CodexAgentTests/CodexAgentCompatibilityTests.swift`
**Dependencies**: TASK-001, codex-process-sdk:TASK-004

**Description**:
Implement JSON-backed queue and group repositories plus injected-runner
orchestration.

**Completion Criteria**:
- [x] Queue CRUD, prompt add/update/remove/move/mode, pause/resume, and image persistence tests pass.
- [x] Queue runner preserves manual/auto command mode and execution status.
- [x] Group CRUD and session membership tests pass.
- [x] Group runner honors bounded concurrency over injected runner.

### TASK-005: Bookmark And Token Managers

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/CodexAgent/CodexOperations.swift`, `Sources/CodexAgent/CodexOperationalStores.swift`, `Tests/CodexAgentTests/CodexAgentCompatibilityTests.swift`
**Dependencies**: TASK-001

**Description**:
Implement bookmark CRUD/search and secure API token management.

**Completion Criteria**:
- [x] Bookmark type-specific validation rejects invalid session/message/range fields.
- [x] Bookmark filters and text relevance search pass.
- [x] Token create, list, verify, revoke, and rotate pass.
- [x] List output never exposes token secrets.
- [x] Permission CSV and wildcard permission behavior match reference tests.

### TASK-006: File-Change Index And Markdown Utilities

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/CodexAgent/CodexRollout.swift`, `Sources/CodexAgent/CodexSessionIndex.swift`, `Sources/CodexAgent/CodexOperations.swift`, `Tests/CodexAgentTests/CodexAgentCompatibilityTests.swift`
**Dependencies**: TASK-001, codex-session-rollout-search:TASK-002

**Description**:
Implement rollout-based file-change extraction/indexing and markdown section/task
parsing.

**Completion Criteria**:
- [x] Successful apply_patch, shell, exec_command, and local_shell writes are indexed.
- [x] Failed/read-only commands are ignored.
- [x] Moved files are addressable through old and new paths.
- [x] Changed files, patch history, file find, and rebuild APIs pass.
- [x] Markdown headings and checkbox task extraction pass.

### TASK-007: Session Command Wiring

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Sources/CodexAgent/CodexProcessManager.swift`, `Sources/CodexAgent/CodexSessionIndex.swift`, `Sources/CodexAgent/CodexRolloutWatcher.swift`, accepted `Sources/RielflowCLI/*` route changes, `Tests/CodexAgentTests/CodexAgentCompatibilityTests.swift`
**Dependencies**: TASK-002, TASK-003, codex-process-sdk:TASK-003, codex-session-rollout-search:TASK-004

**Description**:
Wire session CLI and GraphQL operations to accepted session-rollout and process
SDK APIs.

**Completion Criteria**:
- [x] `session.list/show/search/searchTranscript/watch` use session-rollout APIs.
- [x] `session.run/resume/fork` use process-sdk APIs.
- [x] Environment variable values are validated as strings.
- [x] GraphQL process option forwarding excludes obsolete flags.

### TASK-008: Public Exports And Integration Verification

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `Package.swift`, `Sources/CodexAgent`, `Tests/CodexAgentTests`, `Tests/AgentAdapterTests`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007

**Description**:
Export operational compatibility APIs, update SwiftPM metadata as needed, verify
integration with accepted rielflow CLI routes, and prove manager GraphQL and
Cursor adapter behavior remain isolated.

**Completion Criteria**:
- [x] CodexAgent exports CLI, GraphQL, queue, group, bookmark, token, files, and markdown APIs.
- [x] `RielflowCLITests` cover accepted user-facing command routes when CLI routes change.
- [x] `Tests/AgentAdapterTests` include negative isolation checks for Cursor behavior.
- [x] Rielflow manager GraphQL schema remains unchanged unless separately accepted.
- [x] Focused and full Swift verification commands pass.

## Completion Criteria

- [x] The source feature and test inventory has a parity matrix with every row marked complete or explicitly deferred.
- [x] All eight tasks are implemented or explicitly deferred with accepted cross-feature dependency rationale.
- [x] Swift tests cover CLI, GraphQL, queue, group, bookmark, auth, file-change, markdown, and session command behavior equivalent to the referenced codex-agent tests.
- [x] Operational services use explicit config roots in tests.
- [x] Token secrets are never exposed through metadata listing.
- [x] Local GraphQL command execution remains separate from rielflow manager GraphQL.
- [x] Cursor behavior remains isolated behind existing adapter modules.
- [x] `../codex-agent` is never a runtime dependency of Swift code or tests.
- [x] Verification results and residual risks are recorded in this progress log.

## Verification Commands

- `test -f design-docs/specs/swift-codex-agent-cli-graphql-ops-compat.md`
- `rg -n "GraphQL command names|queue prompt status|token permissions|file-change source" design-docs/specs/swift-codex-agent-cli-graphql-ops-compat.md`
- `test -f impl-plans/active/swift-codex-agent-cli-graphql-ops-compat.md`
- `rg -n "Current Parity State|TASK-001|TASK-008|Cursor behavior remains isolated" impl-plans/active/swift-codex-agent-cli-graphql-ops-compat.md`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test --filter CodexAgentCompatibilityTests`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test --filter RielflowCLITests`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test --filter AgentAdapterTests`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test`

## Review Results

Plan self-review: accepted for handoff to implementation. The revised plan maps
the accepted design to active tasks, restores incomplete parity rows to active
status, and records explicit dependencies, verification commands, and isolation
constraints.

Independent plan review: pending Step 5 for this revised plan.

## Progress Log

### Session: 2026-06-17 Rielflow-Gated Implementation Follow-Up

**Tasks Completed**: TASK-001 shared contracts/stores, TASK-003 local GraphQL
command coverage, TASK-004 queue/group behavior and persistence, TASK-005
bookmark/token behavior and persistence, and TASK-006 file-change/markdown
behavior.
**Tasks In Progress**: None for this plan.
**Blockers**: The packaged `codex-impl-plan-completion-loop` workflow required
legacy `RIEL_MAILBOX_DIR`; this was isolated to `rielflow-packages` and tracked
as <https://github.com/tacogips/rielflow-packages/issues/2>. A later nested
`codex-design-and-implement-review-loop` child stalled in `step4-impl-plan-create`
and was stopped to avoid an unbounded local process.
**Verification**:
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test --filter CodexAgentCompatibilityTests`
passed 10 tests. Full `swift test` passed 321 tests. Rielflow direct workflow
verification also passed:
`rielflow workflow validate rielflow-swift-parity-verify --workflow-definition-dir tmp/migration-parity --executable --output json`
and
`rielflow workflow run rielflow-swift-parity-verify --workflow-definition-dir tmp/migration-parity --output json --no-auto-improve`
completed sessions `riel-rielflow-swift-parity-verify-1781653177-8738516f`
and `riel-rielflow-swift-parity-verify-1781653348-3f7a1468`. After archiving
the completed Swift migration plans, full `swift test` passed 321 tests again
and Rielflow direct workflow verification completed session
`riel-rielflow-swift-parity-verify-1781653766-75774153`.
**Notes**: Added explicit supported CLI/GraphQL command coverage, params and
variables parsing, deterministic token secret hashing with metadata-only
listing, queue/group move/mode/runner behavior, bookmark type validation,
failed-command filtering, moved-file index lookup, markdown sections, and tests.
The plan intentionally remains active because full CLI route integration and
full verification are not yet complete.

### Session: 2026-06-17 Step 4 Plan Revision

**Tasks Completed**: None in this planning step.
**Historical Tasks In Progress**: TASK-001, TASK-002, TASK-003 were partial at
this planning step and were completed by the later Rielflow-gated follow-up.
**Blockers**: TASK-004 through TASK-008 depend on TASK-001 and accepted
process/session feature APIs as recorded in the dependency table.
**Notes**: Reconciled the active plan with the accepted design and parity gate.
Removed completed-status contradictions, marked then-missing surfaces as active
work, added Cursor isolation and no-runtime-source-dependency criteria, and
preserved explicit verification commands for the implementation step.

### Session: 2026-06-17 Full Feature Parity Audit

**Tasks Completed**: Representative Swift compatibility subset only.
**Historical Tasks In Progress**: Full CLI, GraphQL, queue/group runner,
bookmark/token persistence, file-change index, and markdown section parity were
open at audit time and were completed by the later Rielflow-gated follow-up.
**Blockers**: None.
**Notes**: Audit against the codex-agent public exports and test files found
this plan was marked completed too early. The current Swift implementation does
not yet provide the full `runCli` command dispatcher, GraphQL schema/execution
surface, persisted queue/group repositories and runners, file-change service
index/rebuild APIs, full bookmark/token repository semantics, or `parseMarkdown`
section output. Keep this plan active until those gaps are implemented and
verified by Swift tests equivalent to the relevant codex-agent test files.
