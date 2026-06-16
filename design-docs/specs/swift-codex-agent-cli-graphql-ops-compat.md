# Swift Codex Agent CLI, GraphQL, And Operations Compatibility Design

This document defines the feature-local design for porting codex-agent CLI,
local GraphQL command execution, queue, group, bookmark, token, file-change, and
markdown contracts into Swift rielflow.

## Overview

**Workflow mode**: issue-resolution
**Issue reference**: Port codex-agent functionality and tests to Swift rielflow
**Feature ID**: codex-cli-graphql-ops
**Feature title**: CLI, GraphQL, and orchestration compatibility
**Created**: 2026-06-16

This slice owns the codex-agent operational surfaces that sit above session and
process primitives. The Swift migration should expose compatibility APIs under
`CodexAgent`, route user-facing commands through `RielflowCLI` only where the
joined migration accepts a CLI surface, and avoid confusing codex-agent's local
GraphQL command executor with rielflow's workflow manager GraphQL control plane.

## Swift Scope

Supporting Swift modules:

- `Package.swift`
- `Sources/CodexAgent`
- `Sources/RielflowCLI/RielflowCommand.swift`
- `Sources/RielflowCLI/WorkflowCommands.swift`
- `Sources/RielflowGraphQL/RielflowGraphQL.swift`
- `Tests/CodexAgentTests`
- `Tests/AgentAdapterTests`

## Public Behavior Matrix

| Reference behavior | Swift status | Migration decision |
| --- | --- | --- |
| CLI usage, parser, table/JSON formatters, version, model check, and process-option parsing | Partial rielflow CLI only | Add codex-agent compatibility parser/formatters and wire only accepted commands into `RielflowCLI`. |
| Local GraphQL `command` query/mutation/subscription with JSON scalar and shorthand CLI wrapper | Rielflow GraphQL is workflow-control-plane only | Add a CodexAgent-local command executor; do not merge command names into manager GraphQL schema by default. |
| `session.*` command execution for list/show/search/watch/run/resume/fork | Split across other branches | Wire to accepted `codex-session-rollout-search` and `codex-process-sdk` APIs after those plans land. |
| Queue repository, prompt statuses, command modes, queue runner, image persistence, move/update/mode operations | Missing | Add JSON-backed queue repository and runner over Codex process SDK. |
| Group repository and multi-session orchestration | Missing | Add JSON-backed group repository and bounded group runner over Codex process SDK. |
| Bookmark repository, validation, filters, search relevance, and type-specific fields | Missing | Add bookmark store and manager with deterministic validation. |
| Token manager: create, list metadata, verify, revoke, rotate, permissions and wildcard checks | Missing | Add secure token store with hashed secrets and metadata-only listing. |
| File-change extraction/indexing from rollout tool output and shell commands | Missing; depends on rollout parser | Add extractor and index service using session-rollout APIs. |
| Markdown parser and checkbox task extraction | Missing | Add small markdown parser utility with reference tests. |

## Current Parity Gate

The 2026-06-17 issue intake and migration parity audit reopened this design as
an active issue-resolution slice. The active implementation plan remains
authoritative for work tracking, but completed task checkboxes are not
sufficient completion evidence until the Swift implementation and tests cover
the source behavior below.

| Source reference | Target boundary | Required Swift parity evidence |
| --- | --- | --- |
| `../codex-agent/src/bin.ts`, `../codex-agent/src/main.ts`, `../codex-agent/src/cli/index.ts`, `../codex-agent/src/cli/usage.ts`, `../codex-agent/src/cli/parsing.ts`, `../codex-agent/src/cli/format.ts`, `../codex-agent/src/cli/version-model.ts` | `Sources/CodexAgent`, accepted `Sources/RielflowCLI` compatibility routes | Full command dispatcher, help/version/model handling, process-option validation, and table/JSON formatting tests equivalent to `src/cli/index.test.ts`, `src/cli/format.test.ts`, and `src/main.test.ts`. |
| `../codex-agent/src/cli/graphql.ts`, `../codex-agent/src/graphql` | `Sources/CodexAgent` only | Local command GraphQL schema/execution, shorthand query/mutation/subscription handling, variables/params parsing, and unsupported-command diagnostics covered by `src/cli/graphql.test.ts` and `src/graphql/index.test.ts` equivalents. |
| `../codex-agent/src/queue`, `../codex-agent/src/group` | `Sources/CodexAgent` repositories/runners | Persisted queue/group repositories, prompt/image status mutation, pause/resume/delete/move/mode behavior, bounded injected-runner orchestration, and tests matching `src/queue/*.test.ts` and `src/group/repository.test.ts`. |
| `../codex-agent/src/bookmark`, `../codex-agent/src/auth/token-manager.ts` | `Sources/CodexAgent` stores/managers | Bookmark validation, filtering, relevance search, token create/list/verify/revoke/rotate, permission wildcards, hashed secret storage, metadata-only listing, and tests matching `src/bookmark/manager.test.ts` and `src/auth/token-manager.test.ts`. |
| `../codex-agent/src/file-changes`, `../codex-agent/src/markdown` | `Sources/CodexAgent` file-change and markdown services | File-change summary/history/find/rebuild APIs, moved-file handling, failed/read-only command filtering, markdown section output plus checkbox tasks, and tests matching `src/file-changes/*.test.ts` and `src/markdown/parser.test.ts`. |
| `../codex-agent/src/session`, `../codex-agent/src/process`, `../codex-agent/src/sdk` | Existing accepted CodexAgent process/session APIs | Session command wiring for list/show/search/watch/run/resume/fork forwards into accepted Swift process/session surfaces without making codex-agent a runtime dependency. |

Parity status labels for implementation planning:

- `complete`: Swift behavior is implemented, reachable through the intended
  boundary, and covered by focused tests.
- `partial`: Swift behavior exists but reachability, persistence, edge cases, or
  equivalent tests are incomplete.
- `missing`: no target behavior exists.
- `deferred`: out of scope with an explicit owner, rationale, and follow-up path.

## Boundaries

Included:

- CodexAgent-local command/service contracts for CLI and GraphQL compatibility.
- Queue, group, bookmark, token, file-change, and markdown data models and JSON
  stores.
- User-facing formatting and argument parsing parity where Swift rielflow
  exposes equivalent commands.
- Local GraphQL command execution as a CodexAgent compatibility API.
- Focused no-live Swift tests cover the migrated Swift contracts.

Excluded:

- Implementing Codex process execution or session rollout parsing; this branch
  consumes the accepted `codex-process-sdk` and `codex-session-rollout-search`
  contracts.
- Changing rielflow manager GraphQL semantics or workflow-control-plane auth.
- Network GraphQL server behavior beyond local command execution.
- Live Codex credentials, live process execution, or real user config stores in
  tests.
- Cursor CLI behavior, Cursor adapter semantics, and Cursor-specific process
  options. Existing adapter tests may guard that CodexAgent compatibility work
  does not leak into Cursor modules, but this design does not add Cursor
  behavior.

## Design Decisions

1. Codex-agent operational stores default to the reference config layout but
   accept explicit config roots in every public API and test.
2. GraphQL command execution is a compatibility layer inside `CodexAgent`, not a
   replacement for `RielflowGraphQL`.
3. Queue and group runners depend on injected process/session runners so tests
   do not spawn Codex.
4. Token secrets are generated and returned only on create/rotate; list and
   storage surfaces expose hashes and metadata only.
5. File-change indexing consumes parsed rollout lines from the session-rollout
   feature and must not scrape raw terminal logs.
6. CLI commands should return structured results internally and format at the
   final boundary, preserving JSON/table output behavior.
7. Any command that cannot be mapped safely in Swift must fail with explicit
   unsupported-command diagnostics rather than silently doing less work.
8. Active-plan status must stay `In Progress` until the parity matrix above has
   no non-deferred partial or missing rows and the focused plus full Swift test
   commands pass.
9. `../codex-agent` is a build-time reference only. Swift code and tests must not
   import, shell out to, or require that repository at runtime.
10. Cursor behavior remains isolated behind existing adapter modules. Codex
    compatibility routes must not widen Cursor CLI flags, process options,
    event normalization, or test expectations except for negative isolation
    checks in `Tests/AgentAdapterTests`.

## Compatibility Details

CLI command families to preserve:

- `session list/show/watch/run/resume/fork/search/searchTranscript`
- `group create/list/show/add/remove/pause/resume/delete/run`
- `queue create/add/show/list/pause/resume/delete/update/remove/move/mode/run`
- `bookmark add/list/get/delete/search`
- `token create/list/revoke/rotate`
- `files list/patches/find/rebuild`
- `model check`, `version`, and `graphql`

GraphQL command names to preserve include `version.get`, `session.list`,
`session.show`, `session.search`, `session.searchTranscript`, `session.run`,
`session.resume`, `session.fork`, all group/queue/bookmark/token/files command
names, and subscription command `session.watch`.

Operational data values to preserve:

- queue prompt status: `pending`, `running`, `completed`, `failed`
- queue command mode: `auto`, `manual`
- bookmark type: `session`, `message`, `range`
- token permissions: `session:create`, `session:read`, `session:cancel`,
  `group:*`, `queue:*`, `bookmark:*`
- file operation: `created`, `modified`, `deleted`
- file-change source: `apply_patch`, `shell`, `exec_command`, `local_shell`

## Open Questions

- Before final session command wiring is marked complete, verify that
  `codex-process-sdk` and `codex-session-rollout-search` have accepted Swift
  APIs for the required run/resume/fork and list/show/search/watch behavior. If
  either dependency remains partial, keep this plan active and record the
  affected parity rows as `partial` instead of `complete`.

## Review Results

Design self-review: accepted. The design maps the assigned
`codex-cli-graphql-ops` item to operational surfaces only and records explicit
dependencies on process/session fanout branches.

Independent design review: pending current workflow gate. A previous placeholder
acceptance note was removed because Step 3 owns the independent review decision.
The design records target-boundary constraints that local codex-agent GraphQL
must remain separate from rielflow manager GraphQL, and Cursor behavior must
remain isolated behind adapter modules unless a later joined design explicitly
chooses otherwise.

Step 2 rerun update, 2026-06-17: addressed intake feedback that the active plan
contains completed-status contradictions by adding the Current Parity Gate,
source-to-target mapping, and an explicit active-plan completion rule. No
unresolved high or mid design-review findings were supplied to this step.

Step 2 revision after Step 3 review, 2026-06-17: addressed the mid-severity
review findings by removing the prewritten independent-review acceptance and by
adding explicit Cursor out-of-scope and adapter-isolation boundaries.

## Verification Plan

Planning verification:

- `test -f design-docs/specs/swift-codex-agent-cli-graphql-ops-compat.md`
- `rg -n "GraphQL command names|queue prompt status|token permissions|file-change source" design-docs/specs/swift-codex-agent-cli-graphql-ops-compat.md`
- `test -f impl-plans/active/swift-codex-agent-cli-graphql-ops-compat.md`

Implementation verification:

- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test --filter CodexCliGraphQLOpsCompatibilityTests`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test --filter RielflowCLITests`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk swift test`

## Risks

- Scope risk: this slice has the broadest public surface and must avoid
  reimplementing process/session behavior owned by other branches.
- Security risk: token creation, token rotation, and environment forwarding need
  redaction and metadata-only listing tests.
- Target-boundary risk: local command GraphQL can be confused with rielflow's
  manager GraphQL unless naming and target boundaries stay explicit.
