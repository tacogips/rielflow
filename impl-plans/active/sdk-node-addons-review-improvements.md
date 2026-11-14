# SDK Node Add-ons Review Improvements Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#sdk-backed-agent-adapter-boundary; design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#built-in-agent-worker-add-ons; design-docs/specs/design-telegram-gateway-agent-trio.md#cross-provider-authoring-boundary
**Created**: 2026-06-02
**Last Updated**: 2026-06-02

---

## Design Document Reference

**Sources**:

- `design-docs/specs/architecture.md:1343`
- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md:532`
- `design-docs/specs/design-telegram-gateway-agent-trio.md:118`

### Summary

Review and harden the current `feature/sdk-node-addons` branch changes for
SDK-backed agent worker add-ons, the official Cursor SDK Bun child-process
boundary, credential-gated live tests, and the Telegram SDK trio chat example.
The plan follows the Step 3 accepted design and keeps non-SDK Discord,
Telegram, and Matrix examples intact.

### Scope

**Included**:

- Branch review against base commit `1bdd2f9e90aeaa3aee7bb9eeb2a3e1bf1dd84a54`
- Cursor SDK adapter and Bun child-process behavior hardening
- SDK-backed built-in worker add-on registration, runtime readiness, and package
  boundary checks
- Deterministic tests plus explicit credential-gated live smoke test behavior
- `telegram-sdk-trio-chat` workflow and event binding validation
- Non-SDK Discord, Telegram, Matrix trio, and Matrix reply-only example
  preservation checks
- Provider-neutral chat add-on, event adapter, reply-dispatch, Codex attachment,
  and redaction regression coverage
- Documentation and examples that clarify SDK add-ons without changing non-SDK
  example semantics

**Excluded**:

- Replacing `codex-agent`, `claude-code-agent`, or `cursor-cli-agent` examples
- Moving Telegram provider behavior into agent prompts or SDK adapters
- Making live OpenAI, Anthropic, Cursor, or Telegram credentials mandatory for
  deterministic validation
- Reworking unrelated chat provider adapters or non-SDK workflow behavior
- Commit-message assistant attribution or co-authorship trailers

---

## Issue And Reference Traceability

- Workflow mode: `issue-resolution`
- Workflow ID: `codex-design-and-implement-review-loop`
- Node: `step4-impl-plan-create`
- Issue reference: branch review for `feature/sdk-node-addons`
- Repository root:
  `/Users/taco/gits/tacogips/worktrees/rielflow-workspace/feature/sdk-node-addons`
- Accepted design review: Step 3, `needs_revision: false`, `accepted: true`

Codex-agent references:

- `packages/rielflow-adapters/src/codex.ts`
- `packages/rielflow/src/workflow/adapters/codex.test.ts`
- `examples/telegram-agent-trio-chat/nodes/node-yui-codex.json`
- `examples/discord-agent-trio-chat/nodes/node-yui-codex.json`
- `examples/matrix-agent-trio-chat/nodes/node-yui-codex.json`

Intentional divergences accepted in the design:

- `official/cursor-sdk` does not emulate `cursor-cli-agent` transcript, spawn
  flags, or resume behavior.
- Cursor SDK prompt handling may combine `systemPromptText` and user prompt for
  the SDK message API.
- SDK worker add-ons are compact authoring aliases for ordinary `agent` payloads
  and do not introduce new workflow roles.
- `examples/telegram-sdk-trio-chat` diverges from the non-SDK Telegram trio only
  at persona worker backend selection.

---

## Modules

### 1. Branch Review And Finding Record

#### impl-plans/active/sdk-node-addons-review-improvements.md

**Status**: COMPLETED

```typescript
type SdkNodeAddonReviewSeverity = "high" | "mid" | "low" | "none";

interface SdkNodeAddonReviewFinding {
  readonly severity: SdkNodeAddonReviewSeverity;
  readonly filePath: string;
  readonly line?: number;
  readonly issue: string;
  readonly recommendedAction: string;
}

interface SdkNodeAddonReviewDecision {
  readonly workflowMode: "issue-resolution";
  readonly branch: "feature/sdk-node-addons";
  readonly baseCommit: "1bdd2f9e90aeaa3aee7bb9eeb2a3e1bf1dd84a54";
  readonly findings: readonly SdkNodeAddonReviewFinding[];
  readonly implementationRequired: boolean;
}
```

**Checklist**:

- [x] Inspect branch diff against base commit before code edits
- [x] Record high, mid, and low findings in the progress log
- [x] Prefer concrete low-risk fixes over broad refactors
- [x] Preserve user or workflow changes unrelated to this branch review

### 2. Cursor SDK Bun Child-process Boundary

#### packages/rielflow-adapters/src/cursor-sdk.ts
#### packages/rielflow/src/workflow/adapters/cursor-sdk.ts
#### packages/rielflow/src/workflow/adapters/cursor-sdk.test.ts

**Status**: COMPLETED

```typescript
interface CursorSdkBunChildBoundary {
  readonly backend: "official/cursor-sdk";
  readonly apiKeyEnv: "CURSOR_API_KEY";
  readonly childReceivesModelId: true;
  readonly childReceivesWorkingDirectory: true;
  readonly childReceivesJsonlStoreRoot: true;
  readonly childReceivesPromptMessage: true;
  readonly childReturnsMinimalJsonEnvelope: true;
  readonly childDoesNotReceiveWorkflowInternals: true;
}
```

**Checklist**:

- [x] Verify Bun child input excludes workflow internals, credentials in payload,
      and provider-specific process details
- [x] Verify child stdout parsing rejects malformed envelopes and reports stderr
      without leaking secrets
- [x] Verify abort/timeout cancellation reaches the child run and process
- [x] Keep Cursor SDK output normalization aligned with OpenAI and Anthropic SDK
      adapter output-contract behavior
- [x] Add or tighten deterministic adapter tests when review identifies brittle
      behavior

### 3. SDK Worker Add-on Catalog And Readiness

#### packages/rielflow-addons/src/node-addons/addon-constants-and-agent-config.ts
#### packages/rielflow-addons/src/node-addons/gateway-and-git-config.ts
#### packages/rielflow-core/src/workflow-model.ts
#### packages/rielflow-core/src/index.ts
#### packages/rielflow/src/workflow/addon-types.ts
#### packages/rielflow/src/workflow/types.ts
#### packages/rielflow/src/workflow/runtime-readiness-agent-probes.ts
#### packages/rielflow/src/workflow/runtime-readiness.ts

**Status**: COMPLETED

```typescript
type SdkWorkerAddonName =
  | "rielflow/codex-sdk-worker"
  | "rielflow/claude-sdk-worker"
  | "rielflow/cursor-sdk-worker";

type SdkWorkerExecutionBackend =
  | "official/openai-sdk"
  | "official/anthropic-sdk"
  | "official/cursor-sdk";

interface SdkWorkerAddonResolution {
  readonly addonName: SdkWorkerAddonName;
  readonly executionBackend: SdkWorkerExecutionBackend;
  readonly model: string;
  readonly promptTemplate: string;
  readonly systemPromptTemplate?: string;
  readonly timeoutMs?: number;
  readonly variablesFromAddonInputs: true;
  readonly addonEnvUnsupportedInVersionOne: true;
}
```

**Checklist**:

- [x] Verify all three SDK add-ons resolve to ordinary `agent` node payloads
- [x] Verify SDK credentials are adapter/readiness requirements, not add-on env
      bindings
- [x] Verify unsupported SDK backend or missing credential diagnostics are
      explicit and do not silently fall back to CLI-agent add-ons
- [x] Keep exported types and package boundaries synchronized
- [x] Add or adjust tests only within SDK add-on and readiness surfaces

### 4. Deterministic, Skipped, And Live Test Coverage

#### packages/rielflow/src/workflow/node-addons/sdk-agent-workers.test.ts
#### packages/rielflow/src/workflow/adapters/dispatch.test.ts
#### packages/rielflow/src/workflow/adapters/official-sdk-live-smoke.test.ts
#### packages/rielflow/src/workflow/adapters/cli-agent-live-smoke.test.ts
#### packages/rielflow/src/workflow/runtime-readiness-backends.test.ts
#### packages/rielflow/src/package-boundaries.test.ts
#### packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts
#### packages/rielflow/src/events/adapters/discord-gateway.test.ts
#### packages/rielflow/src/events/adapters/telegram-gateway.test.ts
#### packages/rielflow/src/events/adapters/matrix.test.ts
#### packages/rielflow/src/workflow/adapters/codex.test.ts
#### packages/rielflow/src/events/matrix-chat-reply-example.test.ts
#### packages/rielflow/src/events/reply-dispatcher.test.ts
#### scripts/audit-chat-redaction-literals.ts

**Status**: COMPLETED

```typescript
interface SdkVerificationPolicy {
  readonly deterministicTestsRequired: true;
  readonly liveOpenAiSmokeRequires: "OPENAI_API_KEY";
  readonly liveAnthropicSmokeRequires: "ANTHROPIC_API_KEY";
  readonly liveCursorSmokeRequires: "CURSOR_API_KEY";
  readonly liveTelegramSmokeRequires:
    | "RIEL_TELEGRAM_BOT_TOKEN"
    | "RIEL_TELEGRAM_BOT_ID";
  readonly skippedLiveTestsMustBeExplicit: true;
  readonly providerNeutralChatAddonTestsRequired: true;
  readonly eventAdapterRedactionAuditRequired: true;
  readonly codexAttachmentBehaviorRequired: true;
}
```

**Checklist**:

- [x] Keep deterministic tests independent of live SDK or Telegram credentials
- [x] Run accepted design coverage for provider-neutral chat add-ons, Discord
      Gateway, Telegram Gateway, Matrix adapter, Matrix reply dispatch, and
      Codex attachment behavior
- [x] Run redaction audit for bot tokens, access tokens, authorization headers,
      raw provider payloads, and token-bearing file URLs
- [x] Verify live SDK tests use `test.skipIf` or equivalent explicit credential
      gates
- [x] Verify skipped tests still exercise deterministic branches when credentials
      are absent
- [x] Run targeted tests and record skipped-live status in the progress log

### 5. Telegram SDK Trio And Non-SDK Example Preservation

#### examples/telegram-sdk-trio-chat/workflow.json
#### examples/telegram-sdk-trio-chat/mock-scenario.json
#### examples/telegram-sdk-trio-chat/EXPECTED_RESULTS.md
#### examples/event-sources/.rielflow-events/bindings/telegram-gateway-sdk-trio-to-workflow.json
#### examples/discord-agent-trio-chat/workflow.json
#### examples/telegram-agent-trio-chat/workflow.json
#### examples/matrix-agent-trio-chat/workflow.json
#### examples/matrix-chat-reply/workflow.json
#### examples/README.md
#### examples/event-sources/README.md

**Status**: COMPLETED

```typescript
interface TelegramSdkTrioAuthoringSurface {
  readonly workflowId: "telegram-sdk-trio-chat";
  readonly sourceBinding: "telegram-gateway-sdk-trio-to-workflow";
  readonly routerAddon: "rielflow/chat-persona-router";
  readonly yuiWorkerAddon: "rielflow/codex-sdk-worker";
  readonly mikaWorkerAddon: "rielflow/claude-sdk-worker";
  readonly rinaWorkerAddon: "rielflow/cursor-sdk-worker";
  readonly replyAddon: "rielflow/chat-reply-worker";
  readonly providerBoundarySharedWithNonSdkTelegramTrio: true;
}

interface NonSdkExamplePreservationSurface {
  readonly discordTrioWorkflowId: "discord-agent-trio-chat";
  readonly telegramTrioWorkflowId: "telegram-agent-trio-chat";
  readonly matrixTrioWorkflowId: "matrix-agent-trio-chat";
  readonly matrixReplyWorkflowId: "matrix-chat-reply";
  readonly codexPersonaNodesRemainProviderNeutral: true;
}
```

**Checklist**:

- [x] Validate SDK trio graph shape matches the non-SDK Telegram trio router,
      persona, and reply-worker pattern
- [x] Validate non-SDK Discord, Telegram, Matrix trio, and Matrix reply-only
      workflow examples from `./examples`
- [x] Verify Telegram provider credentials, Bot API method names, and raw ids
      remain in event-source or adapter configuration rather than persona prompts
- [x] Verify `telegram-agent-trio-chat`, `discord-agent-trio-chat`,
      `matrix-agent-trio-chat`, and `matrix-chat-reply` remain intact and are not
      replaced by the SDK example
- [x] Validate SDK trio workflow and event binding from `./examples`
- [x] Update example docs only when review finds unclear SDK-vs-non-SDK
      authoring guidance

### 6. Final Documentation, Package Boundary, And Handoff

#### README.md
#### package.json
#### packages/rielflow-adapters/package.json
#### packages/rielflow-adapters/src/dispatch.ts
#### packages/rielflow-adapters/src/index.ts
#### scripts/sync-package-declarations.ts
#### impl-plans/active/sdk-node-addons-review-improvements.md

**Status**: COMPLETED

```typescript
interface SdkNodeAddonsCompletionHandoff {
  readonly deterministicVerificationCommands: readonly string[];
  readonly credentialGatedVerificationCommands: readonly string[];
  readonly preservedNonSdkExamples: readonly string[];
  readonly unresolvedTodos: readonly string[];
  readonly commitRequiresNoAssistantAttribution: true;
}
```

**Checklist**:

- [x] Keep documentation aligned with accepted design doc terminology
- [x] Verify adapter package dependencies and exports include Cursor SDK support
- [x] Verify non-SDK examples still validate
- [x] Run final formatting, typecheck, lint, build, and targeted validation or
      record unavailable commands
- [x] Update this plan progress log and completion criteria after implementation

---

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Branch review and finding record | `impl-plans/active/sdk-node-addons-review-improvements.md` | COMPLETED | `git diff --check` |
| Cursor SDK Bun child boundary | `packages/rielflow-adapters/src/cursor-sdk.ts`; `packages/rielflow/src/workflow/adapters/cursor-sdk.ts` | COMPLETED | `packages/rielflow/src/workflow/adapters/cursor-sdk.test.ts` |
| SDK worker add-on catalog and readiness | `packages/rielflow-addons/src/node-addons/`; `packages/rielflow/src/workflow/runtime-readiness*.ts` | COMPLETED | `sdk-agent-workers.test.ts`; `runtime-readiness-backends.test.ts` |
| Test gating and live smoke coverage | `packages/rielflow/src/workflow/adapters/*live-smoke.test.ts`; event adapter and reply-dispatch tests | COMPLETED | targeted SDK, CLI, provider-neutral chat, Codex attachment, and redaction tests |
| Telegram SDK trio and non-SDK example preservation | `examples/telegram-sdk-trio-chat/`; `examples/discord-agent-trio-chat/`; `examples/telegram-agent-trio-chat/`; `examples/matrix-agent-trio-chat/`; `examples/matrix-chat-reply/`; `examples/event-sources/.rielflow-events/bindings/telegram-gateway-sdk-trio-to-workflow.json` | COMPLETED | workflow and events validation |
| Documentation and package boundary handoff | `README.md`; `package.json`; adapter exports | COMPLETED | typecheck, lint, build, package-boundary tests |

## Dependencies

| Feature | Depends On | Status |
| --- | --- | --- |
| Task 1: Branch review | Step 3 accepted design | COMPLETED |
| Task 2: Cursor SDK boundary | Task 1 review findings | COMPLETED |
| Task 3: SDK add-on catalog/readiness | Task 1 review findings | COMPLETED |
| Task 4: Deterministic and live tests | Tasks 2 and 3 | COMPLETED |
| Task 5: Telegram SDK trio and non-SDK example preservation | Task 3 add-on catalog/readiness | COMPLETED |
| Task 6: Documentation and final handoff | Tasks 2, 3, 4, and 5 | COMPLETED |

## Parallelizable Tasks

- Task 2 and Task 3 can proceed in parallel after Task 1 only if Task 2 stays
  within Cursor SDK adapter files and Task 3 stays within add-on/readiness/type
  files.
- Task 4 is not parallelizable with Tasks 2 or 3 because it verifies and may
  update tests for both surfaces.
- Task 5 can proceed in parallel with Task 2 after Task 3 is stable because its
  write scope is limited to examples and example docs.
- Task 6 is not parallelizable because it is the final synchronization and
  verification handoff.

## Verification Plan

Required deterministic commands:

```bash
git diff --check -- design-docs/specs/architecture.md design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md design-docs/specs/design-telegram-gateway-agent-trio.md impl-plans/active/sdk-node-addons-review-improvements.md
bun test packages/rielflow/src/workflow/adapters/cursor-sdk.test.ts packages/rielflow/src/workflow/adapters/dispatch.test.ts packages/rielflow/src/workflow/node-addons/sdk-agent-workers.test.ts
bun test packages/rielflow/src/workflow/runtime-readiness-backends.test.ts packages/rielflow/src/package-boundaries.test.ts
bun test packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts packages/rielflow/src/events/adapters/discord-gateway.test.ts packages/rielflow/src/events/adapters/telegram-gateway.test.ts packages/rielflow/src/events/adapters/matrix.test.ts packages/rielflow/src/workflow/adapters/codex.test.ts
bun test packages/rielflow/src/events/matrix-chat-reply-example.test.ts packages/rielflow/src/events/adapters/matrix.test.ts packages/rielflow/src/events/reply-dispatcher.test.ts
bun run scripts/audit-chat-redaction-literals.ts
bun run packages/rielflow/src/bin.ts workflow validate discord-agent-trio-chat --workflow-definition-dir ./examples
bun run packages/rielflow/src/bin.ts workflow validate telegram-sdk-trio-chat --workflow-definition-dir ./examples
bun run packages/rielflow/src/bin.ts workflow validate telegram-agent-trio-chat --workflow-definition-dir ./examples
bun run packages/rielflow/src/bin.ts workflow validate matrix-agent-trio-chat --workflow-definition-dir ./examples
bun run packages/rielflow/src/bin.ts workflow validate matrix-chat-reply --workflow-definition-dir ./examples
bun run packages/rielflow/src/bin.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
bun run typecheck
bun run lint:biome
bun run build
```

Credential-gated commands to run when credentials are available, otherwise
record as explicitly skipped:

```bash
bun test packages/rielflow/src/workflow/adapters/official-sdk-live-smoke.test.ts
bun test packages/rielflow/src/workflow/adapters/cli-agent-live-smoke.test.ts
bun run packages/rielflow/src/bin.ts events serve --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
```

## Completion Criteria

- [x] Step 1 branch review findings are recorded with severity and actions
- [x] Cursor SDK Bun child-process behavior is deterministic, abort-aware, and
      covered by focused tests
- [x] SDK add-ons resolve to expected official SDK backends without provider
      config leaking into workflow JSON
- [x] Runtime readiness and package-boundary tests cover SDK backend availability
      and exports
- [x] Provider-neutral chat add-ons, Discord Gateway, Telegram Gateway, Matrix
      adapter, Matrix reply dispatch, Codex attachment behavior, and redaction
      audit coverage are run or documented with reasons
- [x] Live smoke tests are credential-gated and skipped state is explicit
- [x] `telegram-sdk-trio-chat` validates with the example event binding
- [x] Existing non-SDK `discord-agent-trio-chat`, `telegram-agent-trio-chat`,
      `matrix-agent-trio-chat`, and `matrix-chat-reply` examples remain intact
      and validate
- [x] Typecheck, lint, build, and targeted tests pass or unavailable commands are
      documented with reasons
- [x] Progress log is updated before handoff

## Progress Log

### Session: 2026-06-02 Step 7 Revision

**Tasks Completed**: TASK-002 revision, TASK-004 regression tests,
TASK-006 verification refresh
**Tasks In Progress**: None
**Blockers**: None
**Addressed Step 7 Findings**:

- Mid: `packages/rielflow-adapters/src/cursor-sdk.ts` defaulted Cursor SDK
  `local.cwd` to `process.cwd()` instead of the workflow execution working
  directory. Fixed by defaulting to `AdapterExecutionInput.workingDirectory`
  unless adapter config explicitly overrides `cwd`.
- Mid: `packages/rielflow-adapters/src/cursor-sdk.ts` spawned the Bun child from
  the Cursor local workspace, tying `@cursor/sdk` import and native binding
  resolution to arbitrary workflow directories. Fixed by spawning the child from
  the adapter module runtime directory while passing workflow `cwd`, JSONL store
  root, model, and prompt through stdin.

**Verification**:

- Passed: `bun test packages/rielflow/src/workflow/adapters/cursor-sdk.test.ts packages/rielflow/src/workflow/adapters/dispatch.test.ts packages/rielflow/src/workflow/node-addons/sdk-agent-workers.test.ts`
- Passed: `bun run typecheck`
- Passed: `bun test packages/rielflow/src/workflow/runtime-readiness-backends.test.ts packages/rielflow/src/package-boundaries.test.ts`
- Passed: `bun test packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts packages/rielflow/src/events/adapters/discord-gateway.test.ts packages/rielflow/src/events/adapters/telegram-gateway.test.ts packages/rielflow/src/events/adapters/matrix.test.ts packages/rielflow/src/workflow/adapters/codex.test.ts`
- Passed: `bun test packages/rielflow/src/events/matrix-chat-reply-example.test.ts packages/rielflow/src/events/adapters/matrix.test.ts packages/rielflow/src/events/reply-dispatcher.test.ts`
- Passed: `bun run scripts/audit-chat-redaction-literals.ts`
- Passed with explicit skips: `bun test packages/rielflow/src/workflow/adapters/official-sdk-live-smoke.test.ts packages/rielflow/src/workflow/adapters/cli-agent-live-smoke.test.ts`
- Passed: `bun run packages/rielflow/src/bin.ts workflow validate discord-agent-trio-chat --workflow-definition-dir ./examples`
- Passed: `bun run packages/rielflow/src/bin.ts workflow validate telegram-sdk-trio-chat --workflow-definition-dir ./examples`
- Passed: `bun run packages/rielflow/src/bin.ts workflow validate telegram-agent-trio-chat --workflow-definition-dir ./examples`
- Passed: `bun run packages/rielflow/src/bin.ts workflow validate matrix-agent-trio-chat --workflow-definition-dir ./examples`
- Passed: `bun run packages/rielflow/src/bin.ts workflow validate matrix-chat-reply --workflow-definition-dir ./examples`
- Passed: `bun run packages/rielflow/src/bin.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events`
- Passed: `bun run lint:biome`
- Passed: `bun run build`

**Notes**: Added deterministic Cursor SDK tests for default workflow cwd
selection and Bun child spawn cwd decoupling from workflow workspace.

### Session: 2026-06-02 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005,
TASK-006
**Tasks In Progress**: None
**Blockers**: None
**Findings**:

- Low: `packages/rielflow-adapters/src/cursor-sdk.ts` normalized Cursor SDK
  provider failures without redacting the configured `CURSOR_API_KEY` value.
  Fixed by redacting the API key from Cursor adapter error messages and process
  logs before retry/error propagation.
- Low: `packages/rielflow-adapters/src/cursor-sdk.ts` did not explicitly cancel
  a just-created SDK run when the abort signal became true immediately after
  `agent.send` returned and before `run.wait`. Fixed by checking the signal
  after `agent.send`, cancelling the run, and throwing the timeout error.
- Low: `packages/rielflow/src/events/adapters/matrix.test.ts` contained a
  hard-coded Matrix persona reply token and bearer header literal that caused
  `scripts/audit-chat-redaction-literals.ts` to fail. Fixed by asserting the
  bearer header through a local token variable.

**Verification**:

- Passed: `bun test packages/rielflow/src/workflow/adapters/cursor-sdk.test.ts packages/rielflow/src/workflow/adapters/dispatch.test.ts packages/rielflow/src/workflow/node-addons/sdk-agent-workers.test.ts`
- Passed: `bun test packages/rielflow/src/workflow/runtime-readiness-backends.test.ts packages/rielflow/src/package-boundaries.test.ts`
- Passed: `bun test packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts packages/rielflow/src/events/adapters/discord-gateway.test.ts packages/rielflow/src/events/adapters/telegram-gateway.test.ts packages/rielflow/src/events/adapters/matrix.test.ts packages/rielflow/src/workflow/adapters/codex.test.ts`
- Passed: `bun test packages/rielflow/src/events/matrix-chat-reply-example.test.ts packages/rielflow/src/events/adapters/matrix.test.ts packages/rielflow/src/events/reply-dispatcher.test.ts`
- Passed: `bun run scripts/audit-chat-redaction-literals.ts`
- Passed: `bun run packages/rielflow/src/bin.ts workflow validate discord-agent-trio-chat --workflow-definition-dir ./examples`
- Passed: `bun run packages/rielflow/src/bin.ts workflow validate telegram-sdk-trio-chat --workflow-definition-dir ./examples`
- Passed: `bun run packages/rielflow/src/bin.ts workflow validate telegram-agent-trio-chat --workflow-definition-dir ./examples`
- Passed: `bun run packages/rielflow/src/bin.ts workflow validate matrix-agent-trio-chat --workflow-definition-dir ./examples`
- Passed: `bun run packages/rielflow/src/bin.ts workflow validate matrix-chat-reply --workflow-definition-dir ./examples`
- Passed: `bun run packages/rielflow/src/bin.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events`
- Passed with explicit skips: `bun test packages/rielflow/src/workflow/adapters/official-sdk-live-smoke.test.ts packages/rielflow/src/workflow/adapters/cli-agent-live-smoke.test.ts`
  skipped OpenAI, Anthropic, Cursor SDK, Codex CLI, Claude CLI, and Cursor CLI
  live smoke tests because credentials or `RIELFLOW_RUN_CLI_AGENT_LIVE_SMOKE=1`
  were not configured.
- Passed: `bun run typecheck`
- Passed: `bun run lint:biome`
- Passed: `bun run build`

**Notes**: No high or mid severity findings were found. Existing non-SDK
Discord, Telegram, Matrix trio, and Matrix reply-only examples remain distinct
from `examples/telegram-sdk-trio-chat` and validate successfully.

### Session: 2026-06-02 Step 5 Revision

**Tasks Completed**: Addressed Step 5 implementation-plan review findings
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added non-SDK Discord, Telegram, Matrix trio, and Matrix reply-only
workflow validation to the verification plan and completion criteria. Added
accepted provider-neutral chat add-on, event adapter, Codex attachment,
reply-dispatch, and redaction audit verification commands.

### Session: 2026-06-02

**Tasks Completed**: Step 4 implementation plan creation
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Step 3 accepted the design with no high or mid findings. Later
implementation should start with Task 1 branch review, then update this progress
log after each implemented task and verification run.

## Related Plans

- **Previous**: `impl-plans/node-execution-backend-selection.md`
- **Previous**: `impl-plans/node-addon-chat-reply-worker.md`
- **Previous**: `impl-plans/telegram-gateway-agent-trio.md`
- **Related**: `impl-plans/active/chat-gateway-trio-review-improvements.md`
- **Depends On**: Accepted design updates in
  `design-docs/specs/architecture.md`,
  `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`, and
  `design-docs/specs/design-telegram-gateway-agent-trio.md`
