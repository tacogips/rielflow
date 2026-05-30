# Chat Gateway Trio Review Improvements Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-telegram-gateway-agent-trio.md#review-decisions-and-issue-mapping
**Created**: 2026-05-30
**Last Updated**: 2026-05-30

## Design Document Reference

This plan implements the accepted PR #39 issue-resolution review for
Telegram/Discord/Matrix chat workflow simplification. The design source of
truth is `design-docs/specs/design-telegram-gateway-agent-trio.md`, accepted by
Step 3 with no high or mid findings. Step 3 recorded one low finding for
`design-docs/specs/architecture.md:1946`: the architecture index wording should
match the expanded Discord/Telegram/Matrix chat workflow simplification scope.

The later implementation step should self-review the current PR surface first,
then make only low-risk improvements that keep provider complexity in rielflow
event adapters and built-in add-ons. Workflow examples should remain small,
provider-neutral authoring surfaces.

Out of scope:

- live provider behavior changes unless a deterministic review finding proves a
  correctness bug
- OCR, image understanding, encrypted Matrix media, webhook Telegram mode, or
  unbounded provider history
- moving Telegram, Discord, or Matrix receive/send details into persona prompts
  or agent adapter sessions
- automated-assistant attribution in any commit message

## Issue And Reference Traceability

- Workflow mode: `issue-resolution`
- Issue reference: GitHub PR #39,
  `https://github.com/tacogips/rielflow/pull/39`
- Branch: `feature/telegram-agent-trio`
- Primary design: `design-docs/specs/design-telegram-gateway-agent-trio.md`
- Existing completed implementation plan:
  `impl-plans/telegram-gateway-agent-trio.md`

Codex-agent references:

- `packages/rielflow-adapters/src/codex.ts`
- `packages/rielflow/src/workflow/adapters/codex.test.ts`
- `examples/telegram-agent-trio-chat/nodes/node-yui-codex.json`
- `examples/discord-agent-trio-chat/nodes/node-yui-codex.json`

Intentional divergences accepted in design:

- Telegram receive/send remains native `telegram-gateway` adapter behavior, not
  generic Chat SDK Telegram behavior.
- Provider chat history remains event context, not agent transcript
  continuation.
- Codex-agent and Cursor-agent adapters remain persona backends only; they do
  not own chat provider normalization, destination publishing, or reply target
  mapping.
- Matrix parity now includes a dedicated `matrix-agent-trio-chat` workflow with
  the same trio persona routing graph as Discord and Telegram. The smaller
  `matrix-chat-reply` fixture remains a focused reply-worker smoke example.

## Modules

### 1. Review Findings Record

#### impl-plans/active/chat-gateway-trio-review-improvements.md

**Status**: COMPLETED

```typescript
type ChatGatewayProvider = "discord" | "telegram" | "matrix";

type ReviewSeverity = "high" | "mid" | "low" | "none";

interface ChatGatewayReviewFinding {
  readonly severity: ReviewSeverity;
  readonly provider?: ChatGatewayProvider;
  readonly filePath: string;
  readonly line?: number;
  readonly issue: string;
  readonly recommendedAction: string;
}

interface ChatGatewayReviewDecision {
  readonly workflowMode: "issue-resolution";
  readonly issueReference: "github-pr:39";
  readonly findings: readonly ChatGatewayReviewFinding[];
  readonly implementationRequired: boolean;
}
```

**Checklist**:

- [x] Record review findings in the progress log before code changes
- [x] Identify whether fixes are needed and why
- [x] Keep any fixes scoped to accepted low-risk design boundaries

### 2. Telegram Adapter And Validation Boundary

#### packages/rielflow/src/events/adapters/telegram-gateway.ts
#### packages/rielflow/src/events/adapters/telegram-gateway-reply.ts
#### packages/rielflow/src/events/validate-source-telegram-gateway.ts

**Status**: COMPLETED

```typescript
interface TelegramGatewayBoundaryExpectation {
  readonly normalizesChatMessage: true;
  readonly persistsBoundedHistory: true;
  readonly emitsDeterministicAttachmentDescriptors: true;
  readonly redactsCredentialsHeadersRawPayloadsAndTokenBearingUrls: true;
  readonly keepsBotApiDetailsOutOfWorkflowJson: true;
}

interface TelegramGatewayValidationExpectation {
  readonly rejectsLiteralCredentialValues: true;
  readonly validatesPollingHistoryAttachmentAndReplyConfig: true;
  readonly doesNotRequireLiveCredentialsForStaticValidation: true;
}
```

**Checklist**:

- [x] Verify adapter-owned polling, offset, history, attachment, and reply logic
- [x] Verify receipts, dispatch records, logs, and examples redact bot tokens,
      access tokens, authorization headers, raw provider payloads, and
      token-bearing file URLs across Telegram, Discord, and Matrix surfaces
- [x] Add or tighten deterministic tests only if review finds a gap
- [x] Keep Telegram Bot API details out of example workflow prompt/node JSON

### 3. Built-in Chat Add-on Boundary

#### packages/rielflow-addons/src/native-node-executor/chat-and-gateway-addons.ts
#### packages/rielflow-addons/src/node-addons/chat-persona-router-config.ts
#### packages/rielflow-addons/src/node-addons/addon-payload-resolution.ts
#### packages/rielflow/src/workflow/chat-persona-router-types.ts
#### packages/rielflow/src/workflow/types.ts

**Status**: COMPLETED

```typescript
interface ChatPersonaRouterAuthoringExpectation {
  readonly addon: "rielflow/chat-persona-router";
  readonly acceptsProviderNeutralText: true;
  readonly acceptsPersonaIdsNamesAndAliases: true;
  readonly rejectsProviderSpecificPayloadConfig: true;
}

interface ChatReplyWorkerAuthoringExpectation {
  readonly addon: "rielflow/chat-reply-worker";
  readonly acceptsInboxReplyText: true;
  readonly usesRuntimeEventReplyTarget: true;
  readonly dispatchesThroughProviderDestinationPublisher: true;
}
```

**Checklist**:

- [x] Verify add-on schemas keep provider config out of persona routing
- [x] Improve diagnostics/tests only when they reduce authoring friction
- [x] Preserve shared reply worker behavior for Discord, Telegram, and Matrix

### 4. Example Workflow Authoring Surface

#### examples/discord-agent-trio-chat/
#### examples/telegram-agent-trio-chat/
#### examples/matrix-chat-reply/
#### examples/event-sources/.rielflow-events/
#### examples/README.md
#### examples/event-sources/README.md

**Status**: COMPLETED

```typescript
interface ChatWorkflowAuthoringSurface {
  readonly workflowName:
    | "discord-agent-trio-chat"
    | "telegram-agent-trio-chat"
    | "matrix-chat-reply"
    | "matrix-agent-trio-chat";
  readonly inboundEventKind: "chat.message";
  readonly providerSpecificConfigLocation: ".rielflow-events";
  readonly providerSpecificPromptLogicAllowed: false;
  readonly replyAddon: "rielflow/chat-reply-worker";
  readonly personaRouterAddon?: "rielflow/chat-persona-router";
}
```

**Checklist**:

- [x] Compare Discord and Telegram trio workflow graph shape
- [x] Add `matrix-agent-trio-chat` for full trio parity while keeping
      `matrix-chat-reply` as the smaller reply-only fixture
- [x] Fix docs/examples only where provider-neutral authoring is unclear

### 5. Codex-agent Attachment Contract And Cursor Boundary

#### packages/rielflow-adapters/src/codex.ts
#### packages/rielflow/src/workflow/adapters/codex.test.ts
#### examples/telegram-agent-trio-chat/nodes/node-yui-codex.json
#### examples/discord-agent-trio-chat/nodes/node-yui-codex.json
#### examples/telegram-agent-trio-chat/nodes/node-rina-cursor.json
#### examples/discord-agent-trio-chat/nodes/node-rina-cursor.json

**Status**: COMPLETED

```typescript
interface AgentBackendBoundaryExpectation {
  readonly backend: "codex-agent" | "cursor-cli-agent" | "claude-code-agent";
  readonly receivesNormalizedWorkflowInput: true;
  readonly ownsProviderTransport: false;
  readonly mayConsumeNormalizedAttachmentLocalPaths: true;
}
```

**Checklist**:

- [x] Verify Codex-backed persona nodes stay provider-neutral
- [x] Verify Codex attachment tests cover normalized local attachment paths
- [x] Verify Cursor persona nodes do not alter provider event semantics

### 6. Documentation Index And Verification Handoff

#### design-docs/specs/architecture.md
#### README.md
#### scripts/audit-chat-redaction-literals.ts
#### impl-plans/README.md
#### impl-plans/PROGRESS.json

**Status**: COMPLETED

```typescript
interface ChatGatewayVerificationHandoff {
  readonly requiredCommands: readonly string[];
  readonly optionalLiveSmokeTests: readonly string[];
  readonly redactionAuditCommand: "bun run scripts/audit-chat-redaction-literals.ts";
  readonly redactionAuditAllowlistedFixtures: readonly string[];
  readonly unavailableVerificationReason?: string;
  readonly commitRequiresNoAssistantAttribution: true;
}
```

**Checklist**:

- [x] Keep architecture index wording aligned with the expanded design scope
- [x] Keep user-facing docs synchronized only when review fixes change usage
- [x] Run or explicitly document an allowlisted redaction audit that fails only
      on unexpected credentials, authorization headers, raw provider payloads,
      and token-bearing file URLs
- [x] Preserve intentional redaction fixtures in
      `packages/rielflow/src/events/adapters/telegram-gateway.test.ts` and
      `packages/rielflow/src/events/adapters/matrix.test.ts`
- [x] Run required deterministic checks or record unavailable commands
- [x] Commit and push fixes without assistant attribution if implementation
      changes are made

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Review findings | `impl-plans/active/chat-gateway-trio-review-improvements.md` | COMPLETED | progress log inspection |
| Telegram boundary | `packages/rielflow/src/events/adapters/telegram-gateway*.ts`, `packages/rielflow/src/events/validate-source-telegram-gateway.ts` | COMPLETED | `telegram-gateway.test.ts`, events validation |
| Chat add-ons | `packages/rielflow-addons/src/**/chat*.ts`, `packages/rielflow/src/workflow/chat-persona-router-types.ts` | COMPLETED | `native-node-executor-addons-commands.test.ts` |
| Examples | `examples/discord-agent-trio-chat/`, `examples/telegram-agent-trio-chat/`, `examples/matrix-chat-reply/` | COMPLETED | workflow validation commands |
| Agent boundaries | `packages/rielflow-adapters/src/codex.ts`, persona node JSON | COMPLETED | `codex.test.ts` |
| Docs and handoff | `design-docs/specs/architecture.md`, `README.md`, `scripts/audit-chat-redaction-literals.ts`, implementation logs | COMPLETED | `bun run scripts/audit-chat-redaction-literals.ts`, `git diff --check` |

## Dependencies

| Task | Depends On | Status |
| --- | --- | --- |
| TASK-001 Review current PR surface | None | COMPLETED |
| TASK-002 Telegram boundary improvements | TASK-001 | COMPLETED |
| TASK-003 Built-in add-on improvements | TASK-001 | COMPLETED |
| TASK-004 Example authoring cleanup | TASK-001 | COMPLETED |
| TASK-005 Agent boundary regression coverage | TASK-001 | COMPLETED |
| TASK-006 Docs, verification, commit handoff | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005 | COMPLETED |

## Tasks

### TASK-001: Current PR Surface Review

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: progress-log finding entries in this plan
**Dependencies**: None

**Description**:
Review PR #39 against the accepted design and decide whether implementation
fixes are needed. Explicitly inspect Telegram adapter ownership, built-in add-on
ownership, Discord/Telegram/Matrix example authoring simplicity, Codex-agent
attachment behavior, and Cursor-agent isolation.

**Completion Criteria**:

- [x] Findings are ranked as high, mid, low, or none
- [x] Each needed fix maps to a file path and design section
- [x] No code change is started before the review decision is recorded

### TASK-002: Telegram Adapter Boundary Improvements

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/events/adapters/telegram-gateway.ts`, `packages/rielflow/src/events/adapters/telegram-gateway-reply.ts`, `packages/rielflow/src/events/validate-source-telegram-gateway.ts`, related tests
**Dependencies**: TASK-001

**Description**:
If review finds a deterministic gap, tighten Telegram-owned normalization,
validation, history, attachment, or reply behavior without expanding live
provider semantics.

**Completion Criteria**:

- [x] Telegram complexity remains outside workflow prompts and node JSON
- [x] Credentials, authorization headers, raw provider payloads, and
      token-bearing file URLs are redacted from receipts, dispatch records,
      logs, and examples
- [x] New or changed behavior has focused tests
- [x] Static validation does not require live Telegram credentials

### TASK-003: Built-in Add-on Authoring Improvements

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow-addons/src/native-node-executor/chat-and-gateway-addons.ts`, `packages/rielflow-addons/src/node-addons/chat-persona-router-config.ts`, `packages/rielflow-addons/src/node-addons/addon-payload-resolution.ts`, related tests
**Dependencies**: TASK-001

**Description**:
If review finds authoring or validation friction, tighten chat persona router or
chat reply worker diagnostics and schema coverage while preserving
provider-neutral contracts.

**Completion Criteria**:

- [x] Persona router accepts only provider-neutral routing input
- [x] Reply worker continues using runtime event destination context
- [x] Diagnostics identify authored config mistakes before execution

### TASK-004: Example Workflow And Documentation Cleanup

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `examples/discord-agent-trio-chat/`, `examples/telegram-agent-trio-chat/`, `examples/matrix-chat-reply/`, `examples/README.md`, `examples/event-sources/README.md`
**Dependencies**: TASK-001

**Description**:
If review finds drift, align examples and docs so Discord and Telegram trio
workflows stay structurally parallel and Matrix remains a smaller shared reply
contract example.

**Completion Criteria**:

- [x] Discord and Telegram trio examples remain easy to compare
- [x] Matrix docs state why trio routing is not required for parity
- [x] Provider credentials and transport details remain in event-source config

### TASK-005: Codex-agent And Cursor Boundary Verification

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow-adapters/src/codex.ts`, `packages/rielflow/src/workflow/adapters/codex.test.ts`, persona node JSON if needed
**Dependencies**: TASK-001

**Description**:
Verify Codex-agent attachment forwarding and persona node authoring remain
provider-neutral. Confirm Cursor persona nodes do not imply event-provider
behavior.

**Completion Criteria**:

- [x] Codex-agent references remain explicit in review output
- [x] Attachment forwarding tests cover normalized descriptors if changed
- [x] Cursor-agent boundary is documented when touched

### TASK-006: Verification, Plan Update, Commit, And Push

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `design-docs/specs/architecture.md`, `scripts/audit-chat-redaction-literals.ts`, this plan progress log, commit and push if fixes are made
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Description**:
Run required deterministic verification, update progress tracking, keep
architecture index wording aligned with the expanded design scope, and
commit/push implementation fixes without assistant attribution when changes are
made.

**Completion Criteria**:

- [x] Architecture index wording matches the expanded design scope
- [x] Redaction audit has deterministic pass/fail semantics and preserves
      intentional redaction fixtures
- [x] Required verification commands pass or unavailable commands are recorded
- [x] `git diff --check` passes
- [x] Commit message contains no assistant attribution or co-authorship trailers
- [x] Push result is recorded by the implementation step when a commit is made

## Parallelization Guidance

- `TASK-001` is the only initially parallelizable task because later work must
  follow its review findings.
- After `TASK-001`, `TASK-002`, `TASK-003`, `TASK-004`, and `TASK-005` may be
  split across agents only if their write scopes remain disjoint.
- `TASK-006` must run after all implementation tasks because it owns final docs,
  verification, progress updates, commit, and push handoff.

## Verification Plan

Required deterministic commands:

```bash
bun test packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts packages/rielflow/src/events/adapters/discord-gateway.test.ts packages/rielflow/src/events/adapters/telegram-gateway.test.ts packages/rielflow/src/events/adapters/matrix.test.ts packages/rielflow/src/workflow/adapters/codex.test.ts
bun run packages/rielflow/src/bin.ts workflow validate discord-agent-trio-chat --workflow-definition-dir ./examples
bun run packages/rielflow/src/bin.ts workflow validate telegram-agent-trio-chat --workflow-definition-dir ./examples
bun run packages/rielflow/src/bin.ts workflow validate matrix-chat-reply --workflow-definition-dir ./examples
bun run packages/rielflow/src/bin.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
bun run typecheck
bun run lint:biome
bun run build
git diff --check
bun run scripts/audit-chat-redaction-literals.ts
```

The redaction audit script must have deterministic pass/fail semantics. It
should fail only on unexpected literal credential values, authorization header
values, raw provider payload examples, or token-bearing file URLs. It must
allowlist intentional redaction fixtures in
`packages/rielflow/src/events/adapters/telegram-gateway.test.ts` and
`packages/rielflow/src/events/adapters/matrix.test.ts`, and dummy-token
fixtures in Discord Gateway and Chat SDK adapter tests, plus local sample env
assignment scaffolding that does not contain real secrets. Environment variable
names such as `tokenEnv` and `RIEL_TELEGRAM_BOT_TOKEN` are allowed only when no
literal secret value is present.

Optional live smoke tests:

```bash
bun run packages/rielflow/src/bin.ts events serve --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
```

Live smoke tests are credential-dependent and should be reported as unavailable
when Telegram, Discord, or Matrix credentials are not configured.

## Completion Criteria

- [x] PR #39 self-review findings are explicit and ranked
- [x] Telegram complexity is verified to live in rielflow adapters/validation
- [x] Discord, Telegram, and Matrix examples stay provider-neutral and easy to
      author
- [x] Built-in persona router and reply worker boundaries are verified or
      tightened
- [x] Codex-agent and Cursor-agent boundaries remain explicit
- [x] Required verification commands pass or are reported with concrete
      unavailable reasons
- [x] Redaction audit covers credentials, authorization headers, raw provider
      payloads, token-bearing file URLs, receipts, dispatch records, logs, and
      examples
- [x] Fixes are committed and pushed without assistant attribution when changes
      are made

## Progress Log

### Session: 2026-05-30 00:00

**Tasks Completed**: Plan created after Step 3 design acceptance.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Step 3 accepted the design with no high or mid findings. It recorded
one low architecture-index finding at `design-docs/specs/architecture.md:1946`.
TASK-006 should verify that architecture index wording remains aligned with the
expanded Telegram/Discord/Matrix chat workflow design while completing
implementation verification and handoff.

### Session: 2026-05-30 00:10

**Tasks Completed**: Addressed Step 4 self-review feedback.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Corrected plan traceability so Step 3 review state is explicit
before independent implementation-plan review: Step 3 accepted the design with
no high or mid findings and one low architecture-index finding, while TASK-006
still verifies architecture index wording as part of documentation handoff.

### Session: 2026-05-30 00:20

**Tasks Completed**: Addressed Step 5 implementation-plan review feedback.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added explicit TASK-002 and TASK-006 redaction expectations for bot
tokens, access tokens, authorization headers, raw provider payloads, and
token-bearing file URLs across receipts, dispatch records, logs, and examples.
Also replaced the broad raw `rg` audit with a required allowlisted audit script
so intentional redaction fixtures and local sample scaffolding are preserved
while unexpected leaks still fail deterministically.

### Session: 2026-05-30 08:50

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005,
TASK-006.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Step 6 self-review found no high or mid findings. Low finding:
`packages/rielflow/src/events/adapters/telegram-gateway.ts` was 1092 lines and
needed the temporary `noExcessiveLinesPerFile` suppression despite the accepted
design requiring Telegram complexity to stay in rielflow-owned adapter code.
Fixed by extracting adapter-owned bounded history helpers to
`packages/rielflow/src/events/adapters/telegram-gateway-history.ts`, leaving
Telegram polling, attachment normalization, and reply dispatch behavior
unchanged and under the Biome source-file limit. Added
`scripts/audit-chat-redaction-literals.ts` to provide the required allowlisted
credential/redaction audit. Verified Discord and Telegram trio workflow JSON are
structurally identical except `workflowId`, Matrix remains a smaller shared
reply-worker example, `rielflow/chat-persona-router` and
`rielflow/chat-reply-worker` stay provider-neutral, and codex-agent/Cursor
persona nodes remain normalized workflow-input consumers rather than provider
transport owners.

### Session: 2026-05-30 09:15

**Tasks Completed**: Verification pass for TASK-006.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Ran the accepted Step 5 verification set for Step 6:
focused chat/add-on/Codex tests, Discord/Telegram/Matrix workflow validation,
event-source validation, redaction literal audit, `bun run typecheck`,
`bun run lint:biome`, `bun run build`, and `git diff --check` all passed. The
only code change remains the low-risk Telegram history helper extraction plus
the deterministic redaction audit script; no live provider smoke test was run
because it requires external Telegram, Discord, or Matrix credentials.
