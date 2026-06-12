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
- Runtime session and workflow message APIs remain runtime-owned. Swift adapters, command executors, and add-ons may return candidate output only; they must not allocate communication ids, mutate session state, publish downstream messages, or learn the final `output.json` destination.
- External process execution remains explicit and injectable. Backend adapters construct argv arrays directly, avoid shell interpolation, redact credentials from failures, enforce deadlines, and expose deterministic runner injection for tests.

## Reference Mapping

Step 1 intake selected a single-path workflow because this migration is dependency-coupled across core models, adapter contracts, agent targets, package behavior, and CLI/runtime parity. It also marked the change high risk and requiring adversarial review because it touches runtime migration, external command execution, package behavior, and release cutover.

The preferred `codex-agent` local reference root is `../../codex-agent`, but it is not available in this checkout. Until that reference is supplied, the authoritative references are the current TypeScript adapters and pinned package dependencies:

- `packages/rielflow-adapters/src/codex.ts` and `packages/rielflow-adapters/src/readiness.ts` define current `codex-agent` adapter execution, auth/readiness probes, output normalization, and failure mapping.
- `packages/rielflow-adapters/src/claude.ts` and `packages/rielflow-adapters/src/readiness.ts` define current `claude-code-agent` execution, auth/readiness probes, session handling, and failure mapping.
- `packages/rielflow-adapters/src/cursor.ts` and `packages/rielflow-adapters/src/readiness.ts` define current `cursor-cli-agent` behavior through the Cursor adapter SDK boundary.
- `packages/rielflow-adapters/src/dispatch.ts`, `packages/rielflow-adapters/src/shared.ts`, `packages/rielflow-adapters/src/openai-sdk.ts`, and `packages/rielflow-adapters/src/anthropic-sdk.ts` define current official SDK dispatch, API-key lookup, retry/error handling, timeout behavior, request construction, response text extraction, and output-envelope normalization.
- `packages/rielflow-core/src/render.ts`, `packages/rielflow-core/src/prompt-template-context.ts`, `packages/rielflow-core/src/prompt-template-file.ts`, `packages/rielflow-core/src/node-template-fields.ts`, `packages/rielflow/src/workflow/load.ts`, and `packages/rielflow/src/workflow/prompt-composition.ts` define current prompt rendering, prompt variable roots, template-file safety, asset loading, and composed prompt behavior.
- `packages/rielflow/src/workflow/adapter.ts`, `packages/rielflow/src/workflow/output-attempt-runner.ts`, and `packages/rielflow/src/workflow/engine/step-result-finalization.ts` define current JSON candidate extraction, output-contract retry/finalization, and runtime-owned publication behavior.
- `packages/rielflow-adapters/package.json` pins repository-owned references for `codex-agent`, `claude-code-agent`, and `cursor-cli-agent`; Swift target behavior should be mapped from those package contracts, not copied blindly.

Swift target mapping:

- `CodexAgent` maps the `codex-agent` backend only. It owns Codex CLI/session integration, Codex-specific readiness, and Codex-specific output normalization helpers that are not shared with other providers.
- `ClaudeCodeAgent` maps the `claude-code-agent` backend only. It owns Claude CLI/session integration and any Claude-specific auth/readiness behavior.
- `CursorCLIAgent` maps the `cursor-cli-agent` backend only. Cursor-specific modes, stream formats, readiness probes, and SDK compatibility must stay inside this target or a Cursor-specific adapter module.
- `RielflowAdapters` owns provider-neutral adapter contracts, dispatch, retry, prompt preparation, injected subprocess runners, deadline handling, output-envelope parsing, error categories, and the official OpenAI and Anthropic SDK adapter implementations.

Intentional divergence from the reference behavior is allowed only at the adapter boundary and must be documented in this file or the implementation plan. The current accepted divergence is structural: Swift splits the three repository-owned agent integrations into independent SwiftPM targets instead of importing npm packages, while preserving backend strings and normalized adapter envelopes.

## Local Agent Command Builder And Readiness Parity Slice

The completed TASK-004 local-agent slice replaces the generic Swift subprocess argv builder with backend-specific command builders for `codex-agent`, `claude-code-agent`, and `cursor-cli-agent`. The shared `RielflowAdapters` boundary defines the injectable process runner, command-builder protocol, deadline/error normalization, redaction, descriptor isolation, image-path resolution, and normalized output handling. Backend-specific targets own the command shape, optional flags, auth/model preflight, stream normalization, and readiness interpretation.

Command-builder requirements:

- `CodexAgent` owns Codex command construction. It must preserve provider `codex-agent`, use the Codex model from the node payload, keep Codex-only reasoning-effort and additional-argument handling inside the Codex target, and continue normalizing `codex exec --json` JSONL into final assistant text before output-contract parsing.
- `ClaudeCodeAgent` owns Claude Code command construction. It must preserve provider `claude-code-agent`, map working directory, model, effort, permission/plan mode, attachments or image path behavior only where Swift input contracts support them, and keep Claude-specific auth status checks in the Claude target.
- `CursorCLIAgent` owns Cursor CLI command construction. It must preserve provider `cursor-cli-agent`, keep Cursor mode and stream-mode options inside the Cursor target, and must not expose Cursor CLI concepts through `RielflowCore`, shared adapter dispatch, add-ons, GraphQL, events, server code, or the `official/cursor-sdk` backend.
- The old generic shape of `executableName + baseArguments + --model` is not a sufficient parity boundary. Shared code may execute a prepared `LocalAgentProcessConfiguration`, but it must not infer backend-specific argv beyond provider-neutral process execution concerns.
- Tests assert the exact executable, argv, environment overlay, working directory, stdin prompt behavior, provider string, output-contract handling, deadline propagation, descriptor isolation, and stderr/configured-secret redaction through injected process runners.

Readiness parity requirements:

- Swift readiness APIs should model the TypeScript categories from `packages/rielflow-adapters/src/readiness.ts`: `available`, `unavailable`, `unknown`, and `not_checked` for tools, auth probes, and model reachability.
- Auth and policy-blocked adapter failures should preserve current behavior: failed Codex login, unavailable Claude CLI/auth, and unavailable Cursor CLI/auth/model probes become `policy_blocked` at adapter preflight time, while runtime-readiness validation reports deterministic invalid or unknown results without running a workflow.
- Runtime-readiness probing should map the behavior from `packages/rielflow/src/workflow/runtime-readiness-agent-probes.ts`: tool summaries for Codex, Git, Claude, and Cursor; source step ids; model-specific reachability messages; Codex account readiness; Claude auth/model checks; and Cursor's explicit unknown auth result when no stable local auth-status command exists.
- Probe operations are injectable and deterministic in tests. Unit tests must not require live local CLI tools, network access, repository-owned npm package installs, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `CURSOR_API_KEY`.
- Credential-bearing stdout, stderr, thrown errors, and probe details must pass through the existing adapter redaction policy before becoming test-visible or user-visible diagnostics.

## Official SDK Adapter Parity Slice

The completed TASK-004 official SDK slice ports `official/openai-sdk` and `official/anthropic-sdk` only. Both backends remain provider-neutral official SDK adapters under `RielflowAdapters`; they must not be implemented in, or create dependencies from, `CodexAgent`, `ClaudeCodeAgent`, or `CursorCLIAgent`.

Dispatch requirements:

- `DispatchingNodeAdapter` must offer default Swift adapter factories for `NodeExecutionBackend.officialOpenAISDK` and `NodeExecutionBackend.officialAnthropicSDK`.
- Public backend strings remain `official/openai-sdk` and `official/anthropic-sdk`.
- The existing `official/cursor-sdk` enum case and authored backend string remain recognized, but its adapter implementation stays explicitly deferred unless a later, separately reviewed slice scopes it.
- Tests must prove both registered official SDK backends resolve without live credentials when injected clients or request executors are supplied, and that an intentionally missing registry entry still fails deterministically.

OpenAI parity:

- Build a Responses request with `model: input.node.model`, `input: input.promptText`, and optional system instructions from `input.systemPromptText`.
- Resolve credentials from configured `apiKeyEnv` or `OPENAI_API_KEY`; missing credentials are `policy_blocked`.
- Preserve optional base URL propagation, bounded retry defaults, retry delay clamping, context deadline/abort handling, provider-error normalization, and credential redaction in failure surfaces.
- Extract response text from `output_text` first, then from `output[].content[]` entries with `type: "output_text"`, joined by newline.
- Return provider `official-openai-sdk` and normalize text payloads or output-contract envelopes through the shared adapter envelope rules.

Anthropic parity:

- Build a Messages request with `model: input.node.model`, default `max_tokens: 1024` clamped to at least `1`, optional system text from `input.systemPromptText`, and one user message from `input.promptText`.
- Resolve credentials from configured `apiKeyEnv` or `ANTHROPIC_API_KEY`; missing credentials are `policy_blocked`.
- Preserve optional base URL propagation, bounded retry defaults, retry delay clamping, context deadline/abort handling, provider-error normalization, and credential redaction in failure surfaces.
- Extract response text from `content[]` entries with `type: "text"`, joined by newline.
- Return provider `official-anthropic-sdk` and normalize text payloads or output-contract envelopes through the shared adapter envelope rules.

Testing constraints:

- Official SDK tests use injected clients, client factories, or request executors with synthetic responses only.
- Tests must not require `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `CURSOR_API_KEY`, network access, or live SDK calls.
- Deterministic coverage must include request shape, configured API-key environment names, base URL forwarding, retry/error normalization, timeout handling, response text extraction, output-envelope normalization, and credential redaction.

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

## TASK-002/TASK-003 Prompt, JSON, And Envelope Prerequisite Closure

This prerequisite slice closes the remaining Swift migration blockers before
TASK-009. TASK-002 is implementation-complete for the current Swift model and
validation scaffold, but the active implementation plan must record fresh
Swift-capable verification evidence before marking it complete. TASK-003 remains
open until prompt rendering fixtures, prompt asset loading, escaped and missing
variable behavior, and output-envelope normalization are all covered by
deterministic Swift tests.

Prompt rendering contracts:

- Swift prompt rendering must match the TypeScript `renderPromptTemplate`
  behavior for `{{ path }}` placeholders using dotted object traversal.
- Missing, undefined, null, or non-traversable paths render as an empty string.
- String values render unchanged; booleans and numbers render as scalar text;
  object and array values render as compact JSON.
- Unmatched text and unsupported placeholder syntax remain literal text.
- Tests must include literal brace text, backslash-escaped JSON string content,
  multiple placeholders, dotted paths, object and array substitutions, falsey
  scalar values, missing variables, and null values.

Prompt asset loading contracts:

- The supported template-file fields are `systemPromptTemplateFile`,
  `promptTemplateFile`, and `sessionStartPromptTemplateFile` on node payloads and
  prompt variants.
- Template-file paths are workflow-relative only. Empty paths, absolute paths,
  `.` or `..` segments, traversal above the workflow root, and canonical
  workflow definition targets such as `workflow.json` or `node-*.json` fail
  deterministically.
- Loading a template file populates the corresponding inline template field for
  execution while preserving authored file references for save and validation
  workflows.
- Missing or unreadable template files fail during workflow loading or
  validation with field-specific diagnostics; tests must not depend on external
  package installation or live runtime state.

Output-envelope normalization contracts:

- Adapter and SDK output may be plain text when no node output contract is
  present; JSON-looking text must stay a text payload in that case.
- When a node output contract is present, provider text must yield a JSON object
  candidate or fail with `invalid_output`.
- A candidate object with `when` is an output-contract envelope. `when` must be
  an object of booleans, `payload` must be an object, and `completionPassed`
  must be a boolean when supplied. Missing `completionPassed` defaults to true.
- A candidate object without `when` is treated as the business payload with the
  default successful routing condition.
- JSON candidate extraction must ignore braces inside quoted strings and escaped
  string characters while finding the first balanced object candidate.
- Runtime-owned publication remains outside backend adapters. Swift adapters
  normalize provider text into adapter output only; candidate-path handling,
  output validation, accepted output artifacts, workflow messages,
  communication ids, and final root output selection remain runtime-owned.

Current verification evidence:

- Xcode Swift toolchain command:
  `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift --version`
- Current result: Apple Swift 6.3.2, target `arm64-apple-macosx26.0`.
- Swift test command:
  `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift test`
- Current result: 197 tests passed with 0 failures on 2026-06-12. This is the
  TASK-002 evidence to mirror into the active implementation plan; TASK-003
  must stay in progress until the prompt and envelope test gaps above are
  implemented and rerun.

## TASK-005 Runtime Session, Message Store, And Publication Boundary

TASK-005 ports the first Swift runtime-owned session and message boundary needed for deterministic workflow execution. The scope is intentionally narrower than the full SQLite runtime: Swift should expose the core value types, store protocols, publication APIs, and deterministic in-memory behavior that later SQLite, CLI, GraphQL, server, package, and event slices can reuse.

Ownership rules:

- `RielflowCore` owns session and message value types, runtime store protocols, publication request/result types, candidate output normalization, and output validation helpers that are independent of a concrete persistence backend.
- `RielflowCLI` may host a minimal deterministic runner or command surface only when it exercises those core runtime APIs without replacing the TypeScript/Bun production fallback.
- `RielflowAdapters`, `CodexAgent`, `ClaudeCodeAgent`, `CursorCLIAgent`, and official SDK adapters remain provider-output boundaries. They may return inline candidate payloads or write to a runtime-provided candidate path, but they must not publish final workflow messages.
- Candidate-path staging is an execution-attempt detail. The runtime provisions and clears the candidate path before an attempt, reads or copies the submitted candidate after the adapter returns, validates the normalized business payload, records the attempt result, then finalizes the staging location as non-authoritative plumbing. Runtime publication must reject ambiguous candidate sources so adapter output or inline candidates cannot bypass a reserved candidate path. Runtime staging must reject unsafe path components before filesystem use and must verify prepared/finalized staging directories stay under the configured staging root.
- Runtime staging must also validate existing path components before creation and the resolved staging directory after creation so safe-looking symlink components under the staging root cannot redirect candidate paths outside the root.
- Legacy worker mailbox compatibility is out of scope and must not be reintroduced. TASK-005 must not add `RIEL_MAILBOX_DIR`, `inbox/input.json`, `outbox/output.json`, or execution-local inbox/outbox message APIs.

Core API shape:

- `WorkflowSession` records the workflow id, session id, status, entry step, current step, created/updated timestamps, and accepted step execution summaries needed by deterministic inspection tests.
- `WorkflowStepExecution` records step id, node id, attempt ordinal, backend, status, accepted output metadata, and provider-owned adapter output metadata without treating adapter output as a published workflow message.
- `WorkflowMessageRecord` mirrors the TypeScript `workflow_messages` boundary: runtime-generated communication id, workflow execution id, from/to step ids, routing scope, delivery kind, source step execution id, transition condition, payload JSON, optional artifact references, lifecycle state, and created order.
- Runtime-owned message input resolution converts prior `WorkflowMessageRecord` rows for the target step into one deterministic structured execution input with ordered message records, merged payload, communication ids, and source step ids before any adapter call, then applies the merged payload to the `AdapterExecutionInput` boundary.
- Runtime-owned direct message publication creates deliverable messages, and input resolution consumes only delivered or already-consumed workflow message rows while excluding created, failed, and superseded rows.
- `WorkflowRuntimeStore` or equivalent protocols must split session mutation from message publication closely enough that later SQLite-backed persistence can fail message writes deterministically. A failed message append must prevent downstream delivery from being reported as published.
- Deterministic in-memory implementations should use injectable clocks and monotonic id generation so tests can assert exact session ids, execution ids, communication ids, created order, status transitions, and publication failure behavior without real SQLite or filesystem state.

Publication flow:

1. Runtime creates or resumes a `WorkflowSession` and records a step execution attempt.
2. Runtime resolves prior `WorkflowMessageRecord` rows into one structured adapter/executor input object.
3. Adapter or executor returns a provider-owned `AdapterExecutionOutput`, inline business candidate, or candidate-file submission.
4. Runtime normalizes the candidate using the same output-envelope rules already shared by Swift adapters.
5. If the node declares an output contract, runtime validates the schema definition and normalized business payload before publication. Malformed JSON, invalid envelopes, malformed schema definitions, schema failure, and `completionPassed: false` failure paths must be deterministic and must not publish downstream workflow messages. Swift validation must preserve the TypeScript JSON Schema subset for unsupported keyword rejection, nested properties/items, additionalProperties, enum, const, string and numeric bounds, strict integer checks, valid patterns, and anyOf/oneOf/allOf combinators.
6. After validation succeeds, runtime writes the accepted output artifact or in-memory equivalent, updates the session step execution state, and publishes downstream `WorkflowMessageRecord` rows generated from the accepted output only.
7. TASK-005 must fail closed for transition shapes it does not yet implement. Cross-workflow `toWorkflowId`, `resumeStepId`, and fanout transitions must not be silently converted into direct in-workflow messages.
8. External root output selection remains runtime-owned: published workflow output comes from the latest accepted root-scope output node metadata, not from an arbitrary adapter response or merely because a step has no downstream transitions.

Validation requirements:

- Inline adapter payloads and candidate-path file payloads must pass through one normalization and validation path.
- Candidate-path files must be rejected when they are missing, stale from a previous attempt, malformed, non-object when an output contract requires an object, or outside the runtime-provided staging location.
- Output-contract retries may be modeled minimally in TASK-005, but final-attempt failure must leave the step failed and must not create downstream messages.
- Provider errors, policy-blocked adapter failures, timeout failures, and invalid output failures must update session state deterministically without fabricating successful messages.
- Unsupported transition semantics must fail before accepted output or workflow message publication.
- Published messages must use runtime-generated ids and created order; workers never provide communication ids.

Rollout constraints:

- TypeScript/Bun remains the production runtime and fallback while Swift runtime parity is incomplete.
- TASK-005 should prefer in-memory deterministic behavior over partial SQLite writes. The SQLite-backed implementation can follow once the Swift API shape matches the existing `workflow_messages` contract.
- CLI exposure should remain minimal until TASK-007; any Swift CLI smoke command added in TASK-005 must be clearly scaffold/parity-only.
- Cursor-specific behavior remains isolated in `CursorCLIAgent`; TASK-005 adds no Cursor CLI mode, stream, auth, or `official/cursor-sdk` behavior.
- Tests must use injected adapters/stores/clocks and synthetic candidates. They must not require live LLM credentials, local agent binaries, network access, or the TypeScript runtime.

## TASK-006 Package, Add-on, Event, Hook, GraphQL, And Server Contract Boundary

TASK-006 extends the additive Swift migration beyond the core runtime session
shape into the compatibility contracts needed by package discovery, add-on
resolution, event dry-runs, hook recording, GraphQL inspection, and server
request routing. This slice is contract-first: it should expose deterministic
Swift value types, parsers, validators, projections, and injected ports without
making the Swift runtime the production server or package installer.

Scope:

- `RielflowAddons` owns workflow package manifest loading and validation
  contracts, node add-on descriptors, declarative add-on execution requests,
  add-on resolve results, and add-on failure diagnostics.
- `RielflowEvents` owns event source and binding DTOs, external event envelopes,
  event validation diagnostics, dry-run trigger requests/results, receipt
  projection contracts, and injected trigger/reply/receipt ports.
- `RielflowHook` owns hook vendor/event parsing, hook recording controls, hook
  context extraction from environment and payload, redaction-safe payload
  capture, and hook-event store records.
- `RielflowGraphQL` owns Swift DTO projections over the TASK-005 runtime session,
  step execution, workflow message, hook event, event receipt/reply dispatch,
  and control-plane result shapes. It should expose schema-compatible contract
  text or field descriptors without requiring a live GraphQL HTTP stack.
- `RielflowServer` owns request and route contracts for `/`, `/overview`,
  `/graphql`, and `/healthz`, including request envelope parsing, method
  handling, status/content-type response descriptors, and server context
  projection. It must not start long-running HTTP loops in this slice.

Package manifest compatibility:

- The Swift package manifest contract maps the TypeScript surfaces in
  `packages/rielflow/src/workflow/packages/manifest.ts`,
  `packages/rielflow/src/workflow/packages/types.ts`, and
  `packages/rielflow/src/workflow/packages/install-validation.ts`.
- Manifest names must use the same safe package-name rule, including optional
  scope prefixes and lower-case package identifiers.
- Package-relative paths must normalize using POSIX separators and reject empty
  paths, absolute paths, `..`, and traversal above the package root.
- Supported package kinds remain `workflow` and `node-addon`; omitted kind
  defaults to `workflow`.
- Skills, workflow metadata, dependency declarations, dependency add-on locks,
  integrity metadata, and add-on entries should be modeled as value contracts
  with deterministic validation issues. Unknown or unsupported keys should fail
  closed where the TypeScript validator currently rejects them.
- Validation workflow roots should be represented as an injected filesystem
  planning contract. TASK-006 must not copy directories, install packages, run
  package scripts, or mutate project/user scopes.

Add-on execution compatibility:

- The Swift add-on boundary maps
  `packages/rielflow/src/workflow/addon-types.ts`,
  `packages/rielflow/src/workflow/addon-package-boundary.ts`, and
  `packages/rielflow-addons/src/node-addons/*`.
- Add-on definitions remain declarative. Resolvers receive node payload,
  variables, source metadata, and explicit options, not workflow engine
  internals, session stores, communication ids, candidate paths, or mutable
  runtime state.
- Sync and async add-on boundaries must be distinguishable so an async-only
  add-on cannot accidentally run through a sync validation path.
- Built-in add-on names and versions should remain stable in authored workflow
  JSON. Swift may expose typed config DTOs for known built-ins, but unknown
  third-party add-ons stay data-driven and fail with deterministic diagnostics
  when no resolver is injected.
- Add-ons may construct candidate business payloads or dispatch intent records
  through injected ports. They must not publish workflow messages, allocate
  communication ids, execute agent backends directly, or reach into runtime
  internals.

Event dry-run compatibility:

- The Swift event contract maps `packages/rielflow-events/src/types.ts`,
  `packages/rielflow-events/src/runtime-ports.ts`,
  `packages/rielflow/src/events/validate.ts`,
  `packages/rielflow/src/events/manual-emit.ts`, and related input-mapping
  helpers.
- Event source validation should cover supported source kinds, unique ids,
  route path conflicts, HTTP path syntax, secret/env var names, template
  reference validation, and binding output-destination checks.
- Dry-run trigger execution should normalize an external event envelope, apply
  matching bindings and input mappings, and return deterministic trigger
  summaries through injected ports. It must not open live gateways, poll remote
  APIs, write receipts, send chat replies, or run workflows unless a test
  supplies an explicit mock port.
- Event envelopes preserve `sourceId`, `eventId`, `provider`, `eventType`,
  `receivedAt`, `dedupeKey`, actor, conversation, input, and optional artifact
  references. Raw payload persistence must use redacted or metadata-only
  contracts where the TypeScript path redacts provider payloads.

Hook compatibility:

- The Swift hook contract maps `packages/rielflow-hook/src/types.ts`,
  `packages/rielflow-hook/src/parse.ts`,
  `packages/rielflow-hook/src/context.ts`,
  `packages/rielflow-hook/src/redaction.ts`, and
  `packages/rielflow-hook/src/recorder-contracts.ts`.
- Supported hook vendors remain `claude-code`, `codex`, and `gemini`. Known
  event names should normalize case and punctuation like the TypeScript parser,
  with unknown events represented explicitly instead of rejected solely for
  being new.
- Hook payload parsing must require non-empty `session_id`,
  `hook_event_name`, and `cwd`; optional `transcript_path` may be string, null,
  or omitted; optional `model` must be a string when present.
- Recording controls preserve `RIEL_HOOK_RECORDING=auto|off|required`,
  `RIEL_HOOK_STRICT`, and `RIEL_HOOK_CAPTURE_RAW=redacted|metadata-only|full`.
  Required mode fails when workflow/node execution environment is incomplete;
  auto mode returns no Rielflow context instead of failing.
- Redaction must replace sensitive key values, including auth, API key, secret,
  token, password, credential, private key, stdout, stderr, output, and command
  output fields. Hook records store payload hashes and optional payload refs;
  they must not persist full raw payloads by default.

GraphQL and server compatibility:

- `RielflowGraphQL` maps `packages/rielflow-graphql/src/dto.ts`,
  `packages/rielflow-graphql/src/control-plane-service.ts`, and
  `packages/rielflow-graphql/src/schema-contract.ts`.
- DTO projection should be lossy only where the TypeScript control plane is
  already projection-based: runtime-internal stores remain private, while
  sessions, step executions, communications, hook events, event receipts, reply
  dispatches, logs, and LLM session messages expose stable inspection fields.
- Control-plane service protocols should be injected and deterministic. Running,
  continuing, or mutating workflows through GraphQL may be represented as result
  contracts, but TASK-006 should not add final CLI parity or a live control
  server.
- `RielflowServer` maps `packages/rielflow/src/server/api.ts`,
  `packages/rielflow/src/server/graphql.ts`, and
  `packages/rielflow-server/src/contracts.ts`.
- Server request contracts should parse GraphQL JSON envelopes, reject missing
  or non-object bodies deterministically, normalize variables to an object,
  preserve optional operation names, propagate bearer tokens and manager session
  ids through context, and strip ambient manager execution context from
  inherited environment before request execution.
- Route contracts should keep `/` and `/overview` read-only, `/graphql`
  delegated to the GraphQL contract, and `/healthz` returning a deterministic
  service/status body. Unsupported methods and unknown paths should produce
  deterministic response descriptors.

Rollout constraints:

- TypeScript/Bun remains the production fallback. TASK-006 may add Swift tests
  and library surfaces only.
- No live network chat gateways, live HTTP server loops, package installation
  side effects, package checkout mutation, or final CLI cutover belongs in this
  slice.
- Tests must use fixture manifests, fixture event configs, fixture hook payloads,
  in-memory stores, injected clocks, injected filesystems, and injected
  GraphQL/server service ports. They must not require network access, live
  chat credentials, local agent binaries, or package installation side effects.
- Cursor CLI behavior remains isolated in `CursorCLIAgent`; TASK-006 introduces
  no Cursor-specific add-on, event, GraphQL, hook, or server behavior.

## TASK-007 Swift CLI Validate, Inspect, And Deterministic Run Parity

TASK-007 introduces additive Swift `RielflowCLI` command parsing and deterministic
execution behavior for parity tests. The Swift CLI should prove that the native
targets can load, validate, inspect, and run deterministic mock workflows without
changing the production TypeScript/Bun command path or release fallback.

Command scope:

- `workflow validate <name>` loads workflows through the same direct/project/user
  resolution concepts as the TypeScript CLI. It must support `--scope
  auto|project|user`, `--workflow-definition-dir`, `--output text|json`, and
  `--node-patch <json|@file|file>` for non-persistent node setting overrides.
  Structural validation is passive by default. `--executable` may report
  deterministic readiness/preflight results through injected Swift contracts,
  but tests must not require live agent CLIs, credentials, network access, or
  package installation side effects.
- `workflow inspect <name>` loads the same resolved workflow and reports
  step-addressed structure, source scope/path, entry and manager step ids,
  reusable node ids, cross-workflow dispatch ids, counts, defaults, callable
  input/output contracts, add-on source summaries, and runtime readiness
  descriptors. `--structure` remains a text-only compact step/description view;
  `--output json` must preserve the full inspection summary rather than the
  compact structure projection.
- `workflow run <name-or-workflow-json>` is limited to deterministic local
  execution in this slice. It must accept `--variables <json|@file|file>`,
  `--node-patch <json|@file|file>`, `--mock-scenario <path>`, `--output
  text|json`, `--max-steps`, `--max-concurrency`, `--max-loop-iterations`,
  `--default-timeout-ms`, `--timeout-ms`, `--artifact-root`, `--session-store`,
  and `--working-dir` / `--working-directory` where the corresponding Swift
  runtime contracts already exist. Temporary workflow JSON may be supported for
  deterministic fixture runs, but registry-backed runs, remote `--endpoint`,
  package checkout mutation, live gateways, live HTTP server loops, and final
  release cutover remain outside TASK-007.

Deterministic run behavior:

1. CLI parsing normalizes options before workflow loading and fails malformed
   input with deterministic exit codes: usage errors return `2`; load,
   validation, and execution failures return `1`; successful validation,
   inspection, or terminal mock execution returns `0`.
2. Workflow loading must apply node patches in memory only and must not write
   `workflow.json`, `nodes/node-*.json`, package manifests, event configs, hook
   records, registry records, or scoped checkout metadata.
3. Runtime execution uses TASK-005 session, step execution, candidate
   normalization, output-contract validation, and workflow message publication
   APIs. Adapters and add-ons still return candidate payloads only; the CLI must
   not allocate communication ids or publish messages directly.
4. Mock scenario responses map by step/node execution id consistently with the
   TypeScript `ScenarioNodeAdapter`: an entry may be a single response or a
   sequence, output-contract retry attempts advance deterministically, and
   missing entries fall back to the deterministic local adapter.
5. Scenario failure, provider failure, `completionPassed: false`, invalid
   output contracts, unsupported transition semantics, and message append
   failures must leave session state deterministic and must not fabricate
   downstream workflow messages.
6. JSON stdout must remain machine parseable. Human progress, verbose/debug
   diagnostics, and validation issue text belong on stderr or text output only.

TypeScript/Bun parity references:

- `packages/rielflow/src/cli/argument-parser.ts` defines option spelling,
  value requirements, and enum validation.
- `packages/rielflow/src/cli/workflow-command-handler.ts` defines current
  `workflow validate` and `workflow inspect` text/JSON output shape.
- `packages/rielflow/src/cli/workflow-run-command.ts` defines local run,
  temporary workflow, variables, node patch, registry-run, and endpoint
  boundaries. TASK-007 implements only the deterministic local subset needed for
  Swift parity.
- `packages/rielflow/src/workflow/scenario-adapter.ts` defines mock-scenario
  response sequencing and deterministic fallback behavior.
- `packages/rielflow/src/workflow/engine/workflow-runner.ts` and
  `packages/rielflow/src/workflow/engine/step-result-finalization.ts` define
  the runtime-owned finalization behavior that Swift must preserve through
  TASK-005 APIs.

Codex-reference mapping:

- The preferred `../../codex-agent` root remains unavailable for this checkout.
  The observed adjacent `../codex-agent` repository is a reference only, not an
  implementation source.
- `../codex-agent/dist/sdk/mock-session-runner.d.ts` shows the reference
  project's deterministic mock-runner pattern: synthetic sessions, recorded
  calls, injected options, explicit completion, and no live Codex process.
  Swift TASK-007 should use the same testing principle while keeping Rielflow's
  workflow session/message semantics under `RielflowCore`.
- Cursor-specific behavior stays isolated in `CursorCLIAgent`. `RielflowCLI`
  may parse workflow options and dispatch through provider-neutral contracts,
  but it must not expose Cursor mode, stream format, or auth-probe details as
  core workflow or CLI concepts.

Rollout constraints:

- TypeScript/Bun remains the documented production fallback until Swift
  validation, inspect, deterministic run, package, event, GraphQL, hook,
  adapter, and macOS archive gates pass.
- TASK-007 must not remove, rename, or shadow existing TypeScript CLI command
  behavior in release packaging.
- Tests must exercise Swift through injected stores, clocks, scenario adapters,
  filesystems, and process/readiness probes. They must not require live local
  agent binaries, LLM credentials, network access, repository-owned npm
  installs, package checkout mutation, or long-running server loops.

## TASK-008 Packaging And Homebrew Cutover Readiness Gates

TASK-008 defines the additive Swift release artifact contract and the gates that
must remain closed before Homebrew or published release assets switch away from
the TypeScript/Bun executable. This slice prepares deterministic build and
documentation surfaces only. It must not tag a release, upload GitHub release
assets, update `tacogips/homebrew-tap`, remove the Bun archive path, or make the
Swift executable production by default.

Artifact contract:

- The Swift executable product remains named `rielflow`, matching
  `Package.swift`'s `.executable(name: "rielflow", targets: ["RielflowCLI"])`
  product and the installed command name.
- The local release executable path is the `rielflow` binary under the explicit
  Xcode SwiftPM release bin path returned by:

  ```bash
  DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
    SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk \
    /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift \
      build -c release --product rielflow --show-bin-path
  ```

- Swift Homebrew-readiness staging must copy that product to
  `dist/swift-homebrew/work/rielflow-<version>-darwin-<arch>/bin/rielflow`
  before creating an archive. The archive payload shape remains
  `bin/rielflow` plus repository README or release notes, so install behavior
  can be smoke-tested without formula logic changes.
- Pre-cutover Swift archive names must be distinct from current Bun production
  archives:

  ```text
  dist/swift-homebrew/rielflow-swift-<version>-darwin-arm64.tar.gz
  dist/swift-homebrew/rielflow-swift-<version>-darwin-x64.tar.gz
  ```

- Each Swift archive must have a sibling `.sha256` file generated by the same
  deterministic checksum policy as `scripts/build-homebrew-release.sh`.
- Current production Bun/Homebrew archives remain
  `dist/homebrew/rielflow-<version>-darwin-arm64.tar.gz`,
  `dist/homebrew/rielflow-<version>-darwin-x64.tar.gz`, and Linux variants
  until the final cutover gate is accepted.

Homebrew cutover gates:

- The TypeScript/Bun runtime remains the documented production fallback and the
  Homebrew formula source until TASK-009 accepts final parity, security, and
  adversarial implementation review.
- A Swift formula preview may be rendered or tested only against local
  `file://` archives or unpublished CI artifacts. It must not be committed to
  the tap, uploaded to GitHub releases, or described as the default install
  path.
- The cutover is blocked until Swift validation, inspect, deterministic run,
  package validation, event trigger dry-run, GraphQL manager-control, hook
  context parsing, adapter output normalization, SQLite-backed session/message
  persistence, and macOS archive smoke gates all pass in deterministic
  verification.
- Smoke verification must prove `rielflow --help`, `rielflow workflow validate
  <fixture> --output json`, `rielflow workflow inspect <fixture> --output json`,
  and deterministic `rielflow workflow run <fixture> --mock-scenario <path>
  --output json` through the archived Swift executable without live agent
  binaries, credentials, network access, package checkout mutation, release
  upload, or tap mutation.
- Any script or manifest added for Swift packaging must be dry-run friendly,
  deterministic, explicit about the artifact directory, and safe to execute on
  macOS without publishing side effects.

Codex-reference mapping:

- The preferred `../../codex-agent` reference root remains unavailable in this
  checkout; the adjacent `../codex-agent` repository is reference-only.
- `../codex-agent/package.json` shows a stable package executable contract via
  `bin`, a restricted package file list, and a prepack build step. TASK-008 uses
  that as a structural reminder to keep release artifact contents explicit, but
  does not copy codex-agent packaging code or introduce npm package publishing
  behavior.
- Cursor CLI behavior remains isolated in `CursorCLIAgent`; packaging gates do
  not add Cursor mode, stream, auth, or `official/cursor-sdk` behavior to
  provider-neutral modules or Homebrew scripts.

## TASK-009 Final Parity, Security, And Cutover Gate

TASK-009 is the final issue-resolution gate before release packaging may switch
from the TypeScript/Bun executable to the Swift executable. It must collect
fresh deterministic evidence, harden only the parity or security gaps exposed by
that evidence, update the gate manifest only for gates whose verification has
passed, and hand the result to adversarial implementation review. TASK-009 must
not remove the TypeScript/Bun runtime, publish release assets, commit tap
formula changes, replace `dist/homebrew` production archives, or make Swift the
default Homebrew source before the review gate is accepted.

Cutover gate ownership:

- `packaging/homebrew/swift-cutover-gates.json` remains the machine-readable
  cutover manifest. A gate status may move from `blocked` only when the
  implementation records the exact command, fixture or archive path, and result
  that proves the gate in the current branch.
- `allowsProductionCutover` remains `false` until every required gate is passed
  and the `task009-adversarial-review` gate records an accepted high-risk
  review decision. If any required gate remains blocked, the production runtime
  remains `typescript-bun`.
- Gate evidence must be local, deterministic, and replayable. It may use
  injected stores, clocks, process runners, dry-run adapters, local fixture
  manifests, local event fixtures, local GraphQL DTO fixtures, local hook
  fixtures, and archived Swift binaries. It must not require live LLM
  credentials, network access, package checkout mutation, GitHub release upload,
  tap mutation, or live long-running server loops.
- The archived Swift executable must prove `--help`, workflow validation,
  workflow inspect, and deterministic mock run behavior from inside the staged
  archive, not only through `swift run`.

Required TASK-009 evidence:

- TypeScript/Bun baseline: typecheck, Biome lint, and project-scope workflow
  validation must pass so Swift cutover does not hide a broken fallback runtime.
- Swift package verification: the explicit Xcode Swift toolchain must report its
  version and `swift test` must pass all Swift tests in the current branch.
- CLI parity: Swift `workflow validate`, `workflow inspect`, and deterministic
  `workflow run --mock-scenario` must pass against repository fixtures.
- Package validation parity: Swift package manifest loading and validation must
  match the local package fixture contract, including safe path handling and
  deterministic diagnostics.
- Event dry-run parity: Swift event-source dry-run mapping must preserve trigger
  payload, runtime variables, mailbox bridge policy, reply dispatch descriptors,
  and no-side-effect behavior from local fixtures.
- GraphQL manager-control parity: Swift DTO and mutation/request descriptors
  must preserve session inspection, manager-control input shapes, idempotency
  and result fields, and deterministic schema descriptors without requiring an
  HTTP server.
- Hook context parity: Swift hook parsing and recording must preserve
  `agentSessionId`, backend metadata, optional raw capture controls, and
  credential/path redaction in persisted or test-visible records.
- Adapter output normalization: Swift adapter output, JSON candidate extraction,
  output-envelope handling, invalid-output failure, and redaction must remain
  shared across local agents and official SDK adapters without giving adapters
  ownership of workflow publication.
- SQLite persistence parity: Swift SQLite-backed or SQLite-contract session and
  workflow message persistence must prove runtime-generated communication ids,
  ordered message resolution, failed-write handling, and no legacy
  inbox/outbox/mailbox publication path.
- macOS archive smoke: the Swift readiness archive must contain only the
  expected payload, have a valid `.sha256` sidecar, avoid machine-local absolute
  path leakage, and pass archived binary smoke commands.

Security and boundary checks:

- External process execution remains explicit argv execution with injectable
  runners, bounded deadlines, descriptor isolation, and credential redaction.
- Candidate-path staging, accepted-output artifacts, workflow message
  publication, communication ids, and final root output selection remain
  runtime-owned. Adapters, add-ons, event dry-runs, GraphQL descriptors, hooks,
  and packaging scripts must not publish workflow messages or invent
  communication ids.
- Cursor-specific behavior remains isolated in `CursorCLIAgent`; TASK-009 must
  not expose Cursor CLI modes, stream formats, auth assumptions, or
  `official/cursor-sdk` compatibility through provider-neutral core, add-on,
  event, GraphQL, hook, server, or packaging surfaces.
- Swift formula previews and readiness archives are pre-cutover artifacts only.
  Production Homebrew archive names under `dist/homebrew` remain TypeScript/Bun
  owned until TASK-009 review accepts the full cutover.

Codex-reference mapping:

- Step 1 for TASK-009 used `../../codex-agent` as the preferred reference root
  and found it unavailable, so TASK-009 must continue treating current Rielflow
  TypeScript adapters, runtime code, and pinned package contracts as the local
  behavioral reference.
- The adjacent `../codex-agent` checkout may remain a reference-only structural
  comparison for package executable metadata, but TASK-009 must not copy
  codex-agent code or introduce npm publishing behavior.
- Intentional Swift divergence remains structural only: repository-owned agent
  integrations are SwiftPM targets, while backend strings, normalized adapter
  envelopes, readiness categories, and runtime-owned publication semantics stay
  compatible.

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
- Swift packaging must not replace release artifacts until the Swift executable
  path, macOS archive names, Homebrew preview path, and smoke tests are updated,
  verified, and accepted by TASK-009 adversarial review.
- Swift target names can use Swift-style PascalCase, but public backend strings, workflow JSON fields, package identifiers, and documented CLI behavior must remain stable.
- The migration should not include a native macOS UI in the runtime parity milestone. UI design can begin after CLI/runtime parity is testable.

## Verification Gates

Each migrated package needs:

- Swift unit tests for the migrated public contracts.
- Fixture compatibility tests against existing workflow JSON and node JSON examples.
- CLI smoke tests for `workflow validate`, `workflow inspect`, and deterministic `workflow run` without real agent calls.
- Agent adapter tests that use injected process runners and injected readiness probes, not live LLM credentials or local CLI availability.
- Packaging verification for the Swift macOS executable artifact at the SwiftPM
  release bin path, staged under `dist/swift-homebrew/work/.../bin/rielflow`,
  archived as `rielflow-swift-<version>-darwin-arm64.tar.gz` and
  `rielflow-swift-<version>-darwin-x64.tar.gz`, and smoke-tested before any
  TypeScript removal or Homebrew switch.
- TASK-008 deterministic readiness checks for
  `packaging/homebrew/swift-cutover-gates.json`,
  `scripts/build-swift-homebrew-readiness.sh`, archive naming, `.sha256`
  sidecars, and the absence of production publishing side effects.

The current branch has been verified with Xcode Swift 6.3.2 by setting `DEVELOPER_DIR` and `SDKROOT` to `/Applications/Xcode.app`; `swift test` passed 197 tests for the current Swift scaffold, model validation, adapter, runtime publication, deterministic CLI, package/event/GraphQL/server contracts, and packaging-readiness coverage. Default `swift` lookup can still point at a Nix Apple SDK path, so use the Xcode toolchain command recorded in the implementation plan until local toolchain selection is fixed.

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
