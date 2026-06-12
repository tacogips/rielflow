---
name: riel-codex-impl-workflow
description: Use when implementation work in a rielflow project changes behavior, adds functionality, or fixes bugs and the user has not explicitly asked to avoid workflows. Routes the work through the packaged `codex-design-and-implement-review-loop` workflow, including design/plan alignment, implementation, review, user-facing documentation refresh, commit-message generation, and built-in git commit/push steps.
---

# Riel Codex Implementation Workflow

Use this skill as the default Codex path for implementation work in this repository.

## Apply This Skill When

- fixing a bug
- adding or changing runtime behavior
- implementing a feature from a design or implementation plan
- making a non-trivial refactor that changes implementation behavior
- reviewing or hardening dedicated `workflow self-improve` implementation
  behavior, including its CLI, server, library, GraphQL, report, backup, patch,
  and git-commit integration

## Do Not Apply This Skill When

- the user explicitly says not to use a workflow
- the task is documentation-only or planning-only with no implementation
- the task is specifically to debug or repair `rielflow` itself; use the current repository's fix workflow skill
- the task is to operate or troubleshoot live `workflow run --auto-improve`
  supervision rather than implement repository behavior; use
  an auto-improve operations skill

## Default Workflow

Use the packaged workflow bundle:

- Workflow id: `codex-design-and-implement-review-loop`
- Package id: `codex-design-and-implement-review-loop`

Preferred entry point from the repository root:

```bash
bun run packages/rielflow/src/bin.ts workflow package checkout codex-design-and-implement-review-loop
bun run packages/rielflow/src/bin.ts workflow run codex-design-and-implement-review-loop --output json
```

Equivalent direct command:

```bash
rielflow workflow package checkout codex-design-and-implement-review-loop
rielflow workflow run codex-design-and-implement-review-loop --output json
```

## Runtime Inputs

For normal implementation work, run the workflow in issue-resolution mode.

Pass structured workflow input through `--variables` when the task needs
explicit issue/reference context. Typical fields:

- `workflowInput.issueUrl`
- `workflowInput.issueNumber`
- `workflowInput.issueRepository`
- `workflowInput.issueTitle`
- `workflowInput.issueBody`
- `workflowInput.targetFeatureArea`
- `workflowInput.requestedBehavior`
- `workflowInput.codexAgentReferences`
- `workflowInput.referenceRepositoryRoot`
- `workflowInput.referenceRepositoryUrl`
- `workflowInput.reviewMode`
- `workflowInput.riskLevel`
- `workflowInput.requiresAdversarialReview`

Keep `workflowInput.codexAgentReferences` explicit when the issue depends on
Codex-specific behavior. `codex-agent` is an execution-backend identifier, not
Rielflow product branding, and should not be renamed or generalized during
product-name updates.

Planning-only mode is available via:

- `workflowInput.executionMode: "design-plan-only"`

## Expected Behavior

The workflow is responsible for:

1. issue or task intake
2. design-document updates
3. design self-review
4. design review
5. implementation-plan creation or revision
6. implementation-plan self-review
7. implementation-plan review
8. implementation work
9. implementation self-review
10. test-integrity check for inappropriate test deletion, weakened assertions,
    test-only hacks, skipped coverage, and verification shortcuts
11. implementation review
12. adversarial implementation review for high-risk accepted changes
13. user-facing documentation refresh (`README.md`, mandatory workflow skill
    docs, and any directly affected user-facing skills such as event-source
    runbooks)
14. staged secret scan with `gitleaks git --pre-commit --redact --staged --verbose`
15. commit-message generation
16. built-in git commit and git push add-on steps

The adversarial implementation review gate runs when explicitly requested with
`workflowInput.requiresAdversarialReview`, `workflowInput.reviewMode:
"adversarial"`, `workflowInput.riskLevel: "high"` / `"critical"`, or when Step
7 accepts a high-blast-radius change involving security, destructive
filesystem behavior, git commit/push, migrations, package installation,
workflow execution, manager control, event sources, external commands, or
similar automation risk.

Because the workflow ends with commit/push, do not use it when the user has
explicitly asked to avoid workflow-driven commits or wants manual local edits
only.

Rename-related issue-resolution runs should preserve `DIVEDRA_*` environment
variables as compatibility/runtime contracts unless a design explicitly
approves a migration. Product-owned package names, CLI examples, workflow
catalog paths, and human-facing documentation should use Rielflow/`rielflow`.

Swift native migration issue-resolution runs on the `swift-migration` branch
should keep the migration additive until parity gates pass. Preserve the
current TypeScript/Bun runtime as the production fallback, keep public backend
strings stable (`codex-agent`, `claude-code-agent`, `cursor-cli-agent`,
`official/openai-sdk`, `official/anthropic-sdk`, and `official/cursor-sdk`),
and map repository-owned local agent integrations into SwiftPM targets
`CodexAgent`, `ClaudeCodeAgent`, and `CursorCLIAgent` without leaking
provider-specific behavior into `RielflowCore`. Keep issue references explicit
when no GitHub issue exists, keep `codex-agent` as an execution-backend
identifier, and refresh `README.md`, this skill, the Swift migration design,
and the active implementation plan when Step 8 documentation updates are part
of an accepted Swift migration run.

For TASK-004 official SDK adapter slices, keep `official/openai-sdk` and
`official/anthropic-sdk` under `RielflowAdapters` with default
`DispatchingNodeAdapter` factories. Preserve configured/default API-key
environment lookup, optional base URL propagation, bounded retry, deadline
timeouts, provider error normalization, exact credential redaction, response
text extraction, and output-envelope normalization. Tests must stay
deterministic through injected request executors or HTTP transports and must
not require live `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `CURSOR_API_KEY`,
network access, or live SDK calls. Keep `official/cursor-sdk` explicitly
deferred unless a later issue-resolution run scopes and reviews it.

For TASK-004 local-agent command-builder and readiness slices, keep generic
subprocess execution in `RielflowAdapters` provider-neutral and put
backend-faithful argv/auth/model/readiness behavior in `CodexAgent`,
`ClaudeCodeAgent`, and `CursorCLIAgent`. Preserve public backend strings, use
injected process runners and readiness probes for deterministic tests, map
unavailable tools/auth/model probes to redacted `policy_blocked` preflight
failures, model readiness states as `available`, `unavailable`, `unknown`, and
`not_checked`, keep Cursor CLI concepts out of `RielflowCore` and
provider-neutral targets, and do not require live `codex`, `claude`,
`cursor-agent`, LLM credentials, network access, or npm package installs in
tests.

For Swift migration verification, record both the TypeScript/Bun baseline and
SwiftPM evidence. The default `swift` lookup may point at a Nix Apple SDK path,
so accepted verification can use Xcode's toolchain explicitly:

```bash
/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift --version
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  SDKROOT=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk \
  /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift test
```

For the 2026-06-12 `swift-migration` run, Step 7 adversarial review accepted
the TASK-004 local-agent command-builder and readiness parity implementation
after Swift 6.3.2 compiled the SwiftPM scaffold and `swift test` passed 65
tests. The accepted slice includes backend-owned Codex, Claude, and Cursor CLI
command builders; bounded default auth/model preflights; runtime-readiness-
style Swift validation APIs; Cursor/Codex stream normalization; Codex argv
option termination; child descriptor isolation; configured-secret redaction;
and the previously accepted official OpenAI/Anthropic SDK scaffold. Residual
low risks remained: the preferred local `../../codex-agent` reference was
unavailable, `official/cursor-sdk` stayed deferred, and default `swift` lookup
still required the Xcode `DEVELOPER_DIR`/`SDKROOT` override. TASK-002 and
TASK-003 were open during this TASK-004 run and were later closed by the
TASK-002/TASK-003 prerequisite-closure run.

For the 2026-06-12 TASK-005 `swift-migration` run, Step 7 adversarial review
accepted the runtime session and message publication boundary after Xcode
Swift 6.3.2 `swift test` passed 93 tests. The accepted slice adds additive
`RielflowCore` APIs for runtime-owned workflow sessions, step executions,
workflow message records, deterministic in-memory storage, message input
resolution, candidate-path staging, output validation, accepted output
publication, and downstream message creation. Keep adapter outputs
provider-owned until the Swift runtime publishes workflow messages: adapters
may return inline candidates or write a runtime-reserved candidate path, but
must not allocate communication ids, mutate session state, write final
workflow output, or publish downstream messages. Candidate-path publication is
runtime-owned and must reject missing, stale, malformed, outside-staging,
ambiguous, or unreserved candidate sources; staging must reject unsafe path
components and symlink escapes. Do not reintroduce legacy execution-local
mailbox contracts such as `RIEL_MAILBOX_DIR`, `inbox/input.json`, or
`outbox/output.json`. Message input resolution must include only delivered or
already consumed message rows and exclude created, failed, or superseded rows.
Output-contract handling must fail closed before publication for malformed
JSON, invalid envelopes, malformed schema definitions, schema failures,
`completionPassed: false`, provider/policy/timeout failures, and unsupported
cross-workflow, resume-step, or fanout transitions. Residual low risks remain:
the Swift TASK-005 implementation is deterministic in-memory only, SQLite
Swift persistence and CLI parity remain deferred, the preferred
`../../codex-agent` reference is unavailable, and the default `swift` lookup
may still require the Xcode `DEVELOPER_DIR`/`SDKROOT` override.

For the 2026-06-12 TASK-006 `swift-migration` run, Step 7 adversarial review
accepted the package, add-on, event, hook, GraphQL, and server compatibility
contract slice after Xcode Swift 6.3.2 `swift test` passed 149 tests,
`bun run typecheck:server` passed, `bun run lint:biome` passed, and
`bun run packages/rielflow/src/bin.ts workflow validate codex-design-and-implement-review-loop --scope project`
passed. The accepted slice adds additive Swift contracts in `RielflowAddons`,
`RielflowEvents`, `RielflowHook`, `RielflowGraphQL`, and `RielflowServer` for
workflow package manifest loading and validation, declarative add-on
resolve/execute boundaries, event source validation and dry-run mapping, hook
context parsing and redaction-safe recording, GraphQL DTO/control-plane
projections, and server request/route descriptors for `/`, `/overview`,
`/graphql`, and `/healthz`. Keep the slice contract-only until later parity
gates: do not
install packages, execute package scripts, start live gateways, send replies,
run workflows from event dry-runs, publish workflow messages, allocate
communication ids, expose candidate paths to add-ons, or replace the
TypeScript/Bun HTTP and GraphQL server. Preserve deterministic hardening from
the accepted review loop: local-file-only package manifest loading,
package-relative traversal, Windows drive-letter, and UNC path rejection,
trusted built-in source metadata for built-in add-ons, effective webhook, S3,
and chat-sdk route conflict validation, canonical hook payload hashes, redacted
hook backend metadata, duplicate-safe server header normalization, and
continue-session GraphQL input parity. Residual low risks remain: the
preferred `../../codex-agent` reference is unavailable, TypeScript/Bun remains
the production fallback, Swift SQLite/CLI/package/event/GraphQL/server/Homebrew
cutover remains deferred, and the default `swift` lookup may still require the
Xcode `DEVELOPER_DIR`/`SDKROOT` override. TASK-002 and TASK-003 were open
during this TASK-006 run and were later closed by the TASK-002/TASK-003
prerequisite-closure run.

For the 2026-06-12 TASK-007 `swift-migration` run, Step 7 adversarial review
accepted the Swift CLI validate, inspect, and deterministic mock-run parity
slice after Xcode Swift 6.3.2 `swift test` passed 188 tests, focused Swift CLI
and deterministic-runner tests passed, Swift built-executable JSON smoke tests
passed, `git diff --check` passed, and `jq empty impl-plans/PROGRESS.json`
passed. The accepted slice adds additive `RielflowCLI` parsing and behavior for
`workflow validate`, `workflow inspect`, and deterministic local
`workflow run` with direct/project/user workflow resolution, in-memory
`--node-patch`, parseable JSON failure envelopes, TASK-005 runtime-owned
publication, output-contract retry attempts, branch-expression transition
evaluation, multiple-direct-transition fail-closed handling, scoped workflow
containment with symlink checks, and TypeScript/Bun mock-scenario sequence
parity based on execution index and validation attempt. The focused TASK-007
implementation plan is archived at
`impl-plans/completed/swift-native-migration-task-007-cli-parity.md`; the
parent Swift migration plan later moved to
`impl-plans/completed/swift-native-migration.md` after TASK-009 acceptance.
Keep the slice deterministic and local until later cutover gates:
do not replace the
TypeScript/Bun production CLI, mutate package checkout or registry state, run
remote `--endpoint` workflows, start live gateways or servers, require live
agent credentials, allocate communication ids in CLI code, or move
Cursor-specific behavior into shared CLI or `RielflowCore` concepts. Residual
low risks remain: release/Homebrew cutover remains deferred to TASK-009, direct
`--workflow-definition-dir` runs remain caller-trusted local input, and default
`swift` lookup may still require the Xcode `DEVELOPER_DIR`/`SDKROOT` override.

For the 2026-06-12 TASK-008 `swift-migration` run, Step 7 adversarial review
accepted Swift packaging readiness after the checksum sidecar fix. Keep the
slice additive and local-only. The Swift executable artifact is the `rielflow`
SwiftPM product discovered with Xcode
`swift build -c release --product rielflow --show-bin-path`, staged at
`dist/swift-homebrew/work/rielflow-<version>-darwin-<arch>/bin/rielflow`, and
archived as `dist/swift-homebrew/rielflow-swift-<version>-darwin-arm64.tar.gz`
or `dist/swift-homebrew/rielflow-swift-<version>-darwin-x64.tar.gz` with
portable basename-only `.sha256` sidecars. Production Homebrew remains on the
TypeScript/Bun archives under
`dist/homebrew/rielflow-<version>-<target>.tar.gz`; do not tag, publish GitHub
release assets, update `tacogips/homebrew-tap`, run production formula
rendering, remove TypeScript/Bun packaging, or make Swift production by
default. The TASK-008 cutover manifest is
`packaging/homebrew/swift-cutover-gates.json`; TASK-008 left final Homebrew
cutover gates blocked until TASK-009 parity, security, persistence, macOS
archive smoke, and adversarial review evidence was accepted. Accepted
verification included Xcode
Swift 6.3.2 `swift test` passing 197 tests, `bun run typecheck:server`,
`bun run lint:biome`, TypeScript/Bun workflow validation, dry-run and real
`scripts/build-swift-homebrew-readiness.sh` checks, archive listing, relocated
checksum verification from `dist/swift-homebrew`, and host-path rejection in
the `.sha256` sidecar.

For the 2026-06-12 TASK-002/TASK-003 `swift-migration` prerequisite-closure
run, Step 7 adversarial review accepted the Swift prompt, JSON, and output
envelope contracts after Xcode Swift 6.3.2 `swift test` passed 209 tests.
The accepted slice completes TASK-002 and TASK-003 for the current additive
Swift scope before TASK-009. It adds Swift `renderPromptTemplate` parity for
TypeScript/Bun dotted `{{ path }}` placeholders, empty rendering for missing
or null variables, literal preservation for unsupported placeholder syntax,
compact JSON object/array substitution without slash escaping, and
TypeScript-compatible numeric display thresholds including `0.000001` for
`1e-6`, exponential output for `1e-7`, and decimal output for `1e20`.
It also adds workflow-relative prompt asset hydration for
`systemPromptTemplateFile`, `promptTemplateFile`, and
`sessionStartPromptTemplateFile` on top-level agent payloads and prompt
variants while preserving authored file-reference fields. Prompt file paths
must reject empty values, absolute paths, Windows drive-letter paths, `.` or
`..` segments, symlink escapes, `workflow.json`, and canonical `node-*.json`
targets. Output-envelope normalization must treat provider text as text when no
node output contract is present; require a JSON object candidate when a
contract exists; validate `when` as object<boolean>, `payload` as an object,
and `completionPassed` as boolean when supplied; default missing
`completionPassed` to true; and ignore quoted or escaped braces while extracting
balanced JSON candidates. Keep runtime-owned publication outside backend
adapters: Swift adapters may normalize provider output, but candidate-path
handling, output validation, accepted output artifacts, workflow messages,
communication ids, and final root output selection remain runtime-owned.
Accepted review decisions included fixing prior adversarial finding
`comm-000021` and ordinary review finding `comm-000035`; no high or mid
findings remained. Verification commands included JavaScript reference checks
for `String(number)` and `JSON.stringify(number)`, focused Swift tests for
`PromptTemplateTests`, deterministic-runner prompt rendering, adapter utility
envelope handling, and resolver prompt-file hydration, full Xcode
`swift test`, `jq empty impl-plans/PROGRESS.json`, and `git diff --check`.
At that time, residual low risks were that TASK-009 final
parity/security/cutover review had not started, TypeScript/Bun remained the
production fallback, and the preferred local `../../codex-agent` reference
remained unavailable.

For the 2026-06-12 TASK-009 `swift-migration` run, Step 7 adversarial review
accepted the final parity, security, and cutover handoff with no high or mid
findings. The accepted implementation keeps `productionRuntime` as
`typescript-bun`, `homebrewFormulaSource` as `bun-archive`, and
`allowsProductionCutover` as `false` in
`packaging/homebrew/swift-cutover-gates.json` until a dedicated release cutover
switches production Homebrew to Swift archives. The non-review gates record
deterministic evidence for Swift workflow validate, inspect, deterministic run,
package validation, event dry-run, GraphQL manager-control, hook context,
adapter output normalization, SQLite/runtime publication parity, and macOS
archive smoke. Accepted verification included `bun run typecheck:server`,
`bun run lint:biome`, TypeScript/Bun workflow validation, Xcode Swift 6.3.2
`swift test` passing 211 tests, focused GraphQL manager-control and packaging
readiness tests, `RIEL_VERSION=0.0.0-task009 scripts/build-swift-homebrew-readiness.sh darwin-arm64`,
checksum verification from `dist/swift-homebrew`, host-path rejection for the
checksum sidecar, and archived Swift binary `--help`, `workflow validate`,
`workflow inspect`, and deterministic `workflow run` smokes. Keep the
TypeScript/Bun runtime and production Homebrew formula as the user-facing
install path until the release cutover explicitly changes them.

For the 2026-06-12 dedicated `swift-migration` release cutover run, Step 7
adversarial review accepted branch-local production Homebrew packaging with no
high or mid findings after fixes for `comm-000020` and `comm-000024`. The
accepted implementation changes `packaging/homebrew/swift-cutover-gates.json`
to `productionRuntime=swift-native`,
`homebrewFormulaSource=swift-executable-archive`, and
`allowsProductionCutover=true`; renders `Formula/rielflow.rb` as a Swift-native
macOS formula for version `0.1.15`; builds production archives under
`dist/homebrew/rielflow-0.1.15-darwin-arm64.tar.gz` and
`dist/homebrew/rielflow-0.1.15-darwin-x64.tar.gz`; and keeps Linux Homebrew
fail-closed until a reviewed Swift Linux build contract exists. Release upload,
tap repository mutation, and TypeScript/Bun source removal remain excluded
operator actions. Accepted verification included
`RIEL_VERSION=0.0.0-cutover scripts/build-homebrew-release.sh --dry-run darwin-arm64 darwin-x64`,
`RIEL_VERSION=0.0.0-cutover scripts/build-homebrew-release.sh --dry-run linux-x64`,
`RIEL_VERSION=0.1.15 scripts/build-homebrew-release.sh darwin-arm64 darwin-x64`,
archive listing and checksum validation from `dist/homebrew`,
`scripts/render-homebrew-formula.sh 0.1.15 Formula/rielflow.rb`, machine-local
path leakage checks, focused Swift CLI tests, archived Swift workflow usage
smokes for arm64 and x64, and local Homebrew install/test smoke. Keep issue
references explicit when no GitHub issue number is supplied, preserve
`codex-agent` as an execution-backend identifier, and document that the
Homebrew user-facing macOS install path is now the Swift-native executable
archive while Bun commands remain source-checkout development and fallback
validation paths.

Telemetry-related issue-resolution runs should keep user-facing documentation
aligned with the runtime privacy contract. OpenTelemetry tracing is opt-in via
an OTLP endpoint or `RIELFLOW_OTEL_ENABLED=true`; workflow message payloads
stored in SQLite `workflow_messages.payload_json` must remain excluded unless
`RIELFLOW_OTEL_EXPORT_MESSAGES=true` is explicitly set for trusted fixtures.
Do not describe runtime communication payloads as inbox/outbox files; SQLite
`workflow_messages` is the source of truth. Jaeger smoke checks should use the
repository-owned
`compose.jaeger.yaml` file and `docker compose -f compose.jaeger.yaml`.

Workflow package checkout issue-resolution runs should refresh user-facing
docs for package manifests, direct `--workflow-definition-dir` destinations,
package status/update commands, and vendor-scoped skill layouts. Keep `Issue
#35` references explicit when that issue is present in workflow input but
unrelated, and preserve `codex-agent` as an execution-backend identifier while
documenting Codex skill projection as `.codex/skills/<name>/SKILL.md`.

SQLite message-store issue-resolution runs should refresh `README.md`, the
SQLite message-store design, the node-mailbox design when communication
semantics change, and this workflow skill. User-facing docs must state that
`workflow_messages` is the canonical source for communication reads, replay,
retry, GraphQL inspection, and manager mutations; legacy per-message
communication files and session communication arrays are not fallback sources.
Also state that resolved node input builds `latestOutputs` from SQLite-backed
completed communications, including delivered and already consumed
`workflow_messages` rows while excluding created, failed, or superseded rows.
For file-mailbox removal runs, also state that `RIEL_MAILBOX_DIR`
`inbox/input.json` and `outbox/output.json` are not node execution message
contracts, native command/container/add-on workers receive resolved structured
input through runtime-managed stdin/request files, and native stdout or
Candidate-Path output is published by the runtime into `workflow_messages`.
Also document that `RIEL_RUNTIME_DB`, `RIEL_ARTIFACT_DIR`, and
`RIEL_ATTACHMENT_ROOT` control the runtime database and file/binary handoff
roots, that SQLite stores only attachment-root-relative references for
file/binary handoffs, and that failed SQLite writes block message publication.
For payload attachment snapshot changes, user-facing docs must state that
`payload.attachments[]` is a mixed descriptor array: non-file descriptors
remain in `workflow_messages.payload_json`, only safely materialized
file-backed descriptors are rewritten to normalized `attachment-root` refs, and
`workflow_messages.artifact_refs_json` stays limited to materialized file refs.
When the run hardens runtime JSON TEXT columns, also document that required
JSON text uses `CHECK(json_valid(column))`, nullable JSON text uses
`CHECK(column IS NULL OR json_valid(column))`, malformed historical rows may
fail rebuild migrations explicitly, and manager/session/event/supervisor
runtime JSON columns follow the same policy as `workflow_messages`
`delivery_attempt_ids_json`, `payload_ref_json`, `payload_json`, and
`artifact_refs_json`. Keep PR references such as `PR #54`, branch names such as
`feature/sqlite-message-store`, and `codex-agent` execution references explicit
in workflow outputs.

Manager-control idempotency issue-resolution runs such as `SEC-001` in `PR #54`
/ `feature/sqlite-message-store` should refresh `README.md`, the GraphQL
manager-control design, compact architecture notes, and this workflow skill.
User-facing docs must state that GraphQL manager mutations with an
`idempotencyKey` atomically claim `(mutationName, managerSessionId,
idempotencyKey)` before side effects; same-key/same-payload callers wait for or
read the completed response or stored failure; same-key/different-payload
callers fail before side effects; and caller-owned pending claims are completed
or failed without overwriting another caller's row. Keep accepted review
decisions, residual low risks, verification commands, and `codex-agent`
execution references explicit in workflow outputs.

## Reporting

After the workflow finishes, report:

- workflow mode
- changed files
- verification commands
- commit message
- commit hash
- pushed remote and branch

If the workflow fails because `rielflow` appears incorrect, switch to the
current repository's fix workflow.
