# Rielflow Swift Native Migration Design

## Status

Active migration design for the `swift-migration` branch.

## Goal

Migrate Rielflow from a TypeScript/Bun runtime into a macOS-native Swift implementation while preserving the existing responsibility split:

- `rielflow-core` -> `RielflowCore`
- `rielflow-addons` -> `RielflowAddons`
- `rielflow-adapters` -> `RielflowAdapters`
- `rielflow-events` -> `RielflowEvents`
- `rielflow-graphql` -> `RielflowGraphQL`
- `rielflow-server` -> `RielflowServer`
- `rielflow-hook` -> `RielflowHook`
- `rielflow` CLI/runtime -> `RielflowCLI`
- external agent packages `codex-agent`, `claude-code-agent`, and `cursor-cli-agent` -> first-class Swift targets `CodexAgent`, `ClaudeCodeAgent`, and `CursorCLIAgent`

The initial migration is additive. TypeScript remains in place until the Swift targets reach feature parity and the packaging/release path can switch safely.

## Architecture

The Swift package is rooted at repository top level with one SwiftPM target per existing package boundary. Cross-target dependencies point inward:

- `RielflowCore` owns JSON boundary types, authored workflow model types, backend identifiers, adapter contracts, and validation-independent helpers.
- `RielflowAdapters` owns dispatching, retry, shared prompt construction, local process execution, and official SDK adapter infrastructure.
- `CodexAgent`, `ClaudeCodeAgent`, and `CursorCLIAgent` own backend-specific local agent command integration.
- `RielflowAddons`, `RielflowEvents`, `RielflowGraphQL`, `RielflowServer`, and `RielflowHook` stay separate so migration can proceed by package without collapsing responsibilities.
- `RielflowCLI` is the executable target and should become the only command-line entry point after parity.

The migration must keep the Swift package additive until parity gates pass. The TypeScript/Bun packages remain the production runtime during the migration, and Swift targets should be allowed to depend on fixture data and contract definitions from the existing repository, not on private runtime state.

## Runtime Contracts To Preserve

- Execution backend strings remain stable: `codex-agent`, `claude-code-agent`, `cursor-cli-agent`, `official/openai-sdk`, `official/anthropic-sdk`, and `official/cursor-sdk`.
- Authored workflows remain step-addressed and file-backed.
- Add-on nodes stay declarative and isolated from runtime engine internals.
- Agent adapters return a normalized provider/model/prompt/completion/payload envelope.
- Hook context keeps `agentSessionId` and optional backend metadata.
- Existing workflow package, event source, GraphQL manager-control, and session inspection surfaces remain compatibility targets for parity tests.
- Runtime output publication remains runtime-owned. Swift adapters may parse provider output into a normalized envelope, but final workflow message delivery, candidate-path handling, and output validation belong to the workflow engine boundary.
- External process execution remains explicit and injectable. Backend adapters construct argv arrays directly, avoid shell interpolation, redact credentials from failures, enforce deadlines, and expose deterministic runner injection for tests.

## Reference Mapping

Step 1 intake selected a single-path workflow because this migration is dependency-coupled across core models, adapter contracts, agent targets, package behavior, and CLI/runtime parity. It also marked the change high risk and requiring adversarial review because it touches runtime migration, external command execution, package behavior, and release cutover.

The preferred `codex-agent` local reference root is `../../codex-agent`, but it is not available in this checkout. Until that reference is supplied, the authoritative references are the current TypeScript adapters and pinned package dependencies:

- `packages/rielflow-adapters/src/codex.ts` and `packages/rielflow-adapters/src/readiness.ts` define current `codex-agent` adapter execution, auth/readiness probes, output normalization, and failure mapping.
- `packages/rielflow-adapters/src/claude.ts` and `packages/rielflow-adapters/src/readiness.ts` define current `claude-code-agent` execution, auth/readiness probes, session handling, and failure mapping.
- `packages/rielflow-adapters/src/cursor.ts` and `packages/rielflow-adapters/src/readiness.ts` define current `cursor-cli-agent` behavior through the Cursor adapter SDK boundary.
- `packages/rielflow-adapters/package.json` pins repository-owned references for `codex-agent`, `claude-code-agent`, and `cursor-cli-agent`; Swift target behavior should be mapped from those package contracts, not copied blindly.

Swift target mapping:

- `CodexAgent` maps the `codex-agent` backend only. It owns Codex CLI/session integration, Codex-specific readiness, and Codex-specific output normalization helpers that are not shared with other providers.
- `ClaudeCodeAgent` maps the `claude-code-agent` backend only. It owns Claude CLI/session integration and any Claude-specific auth/readiness behavior.
- `CursorCLIAgent` maps the `cursor-cli-agent` backend only. Cursor-specific modes, stream formats, readiness probes, and SDK compatibility must stay inside this target or a Cursor-specific adapter module.
- `RielflowAdapters` owns provider-neutral adapter contracts, dispatch, retry, prompt preparation, injected subprocess runners, deadline handling, output-envelope parsing, and error categories.

Intentional divergence from the reference behavior is allowed only at the adapter boundary and must be documented in this file or the implementation plan. The current accepted divergence is structural: Swift splits the three repository-owned agent integrations into independent SwiftPM targets instead of importing npm packages, while preserving backend strings and normalized adapter envelopes.

## Cursor CLI Behavior Boundary

Cursor CLI behavior must remain isolated behind `CursorCLIAgent` and Cursor-specific readiness helpers. No `Cursor`-specific mode, stream normalization, binary probe, auth probe, or SDK compatibility assumption should leak into `RielflowCore`, provider-neutral `RielflowAdapters`, add-on validation, GraphQL, events, or server targets.

The Swift migration should preserve these Cursor contracts:

- backend string: `cursor-cli-agent`
- default executable lookup remains backend-owned, not core-owned
- prompt construction uses the shared adapter prompt preparation contract before entering Cursor-specific execution
- Cursor mode and stream-mode options are Cursor adapter configuration, not workflow engine concepts
- provider responses normalize into the same `AdapterExecutionOutput` envelope used by Codex and Claude
- readiness checks report unavailable tools, auth failures, model reachability, and policy-blocked states without requiring live workflow execution

The `official/cursor-sdk` backend is a separate official SDK adapter and must not be conflated with `cursor-cli-agent`. Any Swift port of `official/cursor-sdk` should be a later, separately gated adapter slice unless implementation parity requires a minimal compatibility shim.

## Data Flow

The Swift runtime should keep the same high-level execution flow as the TypeScript runtime:

1. `RielflowCLI`, GraphQL, server, or library entrypoints resolve a workflow through the same direct/project/user/package discovery rules.
2. `RielflowCore` decodes authored workflow JSON, validates step-addressed structure, resolves backend identifiers, and exposes value types with stable JSON encoding.
3. Runtime orchestration creates or resumes a persisted session, owns queue state, owns workflow messages, and selects the next step.
4. Native node execution and add-on execution stay behind explicit engine boundaries. Add-ons receive declarative config and runtime-provided context, not engine internals.
5. Agent nodes dispatch through `RielflowAdapters` into one backend-specific target. Provider output is normalized to `provider`, `model`, `promptText`, `completionPassed`, `when`, and `payload`.
6. The runtime validates the output contract, publishes messages, updates session state, and exposes status through CLI, GraphQL, and server inspection.

Swift code should avoid introducing a second workflow contract. Existing workflow JSON fixtures, node JSON fixtures, package manifests, event bindings, and hook snippets are the migration compatibility source.

## Migration Strategy

1. Establish a compiling SwiftPM package with target boundaries matching the current workspace.
2. Port `rielflow-core` model and validation code first, because every other package depends on it.
3. Port adapter dispatch and local agent subprocess wrappers, including `codex-agent`, `claude-code-agent`, and `cursor-cli-agent` as independent Swift targets.
4. Port runtime storage, workflow execution, node add-ons, and event sources behind the same public contracts.
5. Replace the CLI entry point only after Swift runtime can validate, inspect, and run deterministic mock workflows.
6. Switch release packaging and Homebrew artifacts to the Swift executable after parity gates pass.

Cutover constraints:

- TypeScript/Bun remains the fallback runtime until Swift can pass fixture parity for validation, inspect, deterministic run, package validation, event trigger dry-runs, GraphQL manager control, hook context parsing, and adapter output normalization.
- Swift packaging must not replace release artifacts until the Homebrew archive path, executable name, and smoke tests are updated and verified.
- Swift target names can use Swift-style PascalCase, but public backend strings, workflow JSON fields, package identifiers, and documented CLI behavior must remain stable.
- The migration should not include a native macOS UI in the runtime parity milestone. UI design can begin after CLI/runtime parity is testable.

## Verification Gates

Each migrated package needs:

- Swift unit tests for the migrated public contracts.
- Fixture compatibility tests against existing workflow JSON and node JSON examples.
- CLI smoke tests for `workflow validate`, `workflow inspect`, and deterministic `workflow run` without real agent calls.
- Agent adapter tests that use injected process runners, not live LLM credentials.
- Packaging verification for macOS executable artifacts before TypeScript removal.

The current branch has been verified with Xcode Swift 6.3.2 by setting `DEVELOPER_DIR` and `SDKROOT` to `/Applications/Xcode.app`; `swift test` passed 28 tests. Default `swift` lookup can still point at a Nix Apple SDK path, so use the Xcode toolchain command recorded in the implementation plan until local toolchain selection is fixed.

Additional required verification:

- `git status --short --branch`
- `bun run typecheck:server`
- `bun run lint:biome`
- `bun run packages/rielflow/src/bin.ts workflow validate codex-design-and-implement-review-loop --scope project`
- `/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift --version`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift test`

## Open Decisions

Open user decisions are tracked in `design-docs/user-qa/qa-swift-native-migration.md`.

Known unresolved decisions:

- whether the replacement milestone is CLI/runtime parity only, or also includes a native macOS UI
- the exact parity threshold for switching release packaging from TypeScript/Bun to Swift
- whether to vendor local source from the three repository-owned agent packages or continue mapping behavior from package pins and TypeScript adapters until dedicated Swift references exist
