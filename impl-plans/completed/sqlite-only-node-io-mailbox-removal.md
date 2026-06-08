# SQLite-Only Node I/O Mailbox Removal Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-execution-inbox-contract.md#contract-shape`; `design-docs/specs/design-node-execution-inbox-contract.md#backend-application`; `design-docs/specs/design-node-execution-inbox-contract.md#output-ownership`; `design-docs/specs/design-sqlite-message-store.md#node-execution-io-boundary`; `design-docs/specs/design-sqlite-message-store.md#file-mailbox-removal-boundary`; `design-docs/specs/architecture.md#current-execution-flow`; `design-docs/specs/architecture.md#message-architecture`; `design-docs/specs/design-node-output-contract.md#runtime-artifact-model`; `design-docs/specs/design-graphql-manager-control-plane.md#communication-query-model`
**Created**: 2026-06-08
**Last Updated**: 2026-06-08

## Design Document Reference

**Source**:

- `design-docs/specs/design-node-execution-inbox-contract.md#contract-shape`
- `design-docs/specs/design-node-execution-inbox-contract.md#backend-application`
- `design-docs/specs/design-node-execution-inbox-contract.md#output-ownership`
- `design-docs/specs/design-node-execution-inbox-contract.md#file-and-binary-attachments`
- `design-docs/specs/design-sqlite-message-store.md#node-execution-io-boundary`
- `design-docs/specs/design-sqlite-message-store.md#file-mailbox-removal-boundary`
- `design-docs/specs/design-sqlite-message-store.md#read-rules`
- `design-docs/specs/design-node-output-contract.md#runtime-artifact-model`
- `design-docs/specs/design-node-output-contract.md#execution-model`
- `design-docs/specs/architecture.md#current-execution-flow`
- `design-docs/specs/architecture.md#message-architecture`
- `design-docs/specs/architecture.md#output-ownership`
- `design-docs/specs/architecture.md#opentelemetry-runtime-instrumentation`
- `design-docs/specs/command.md#environment-variables`
- `design-docs/specs/design-graphql-manager-control-plane.md#communication-query-model`
- `design-docs/specs/design-graphql-manager-control-plane.md#communication-retry-and-replay`
- `design-docs/specs/design-graphql-manager-control-plane.md#manager-send-semantics`
- `design-docs/specs/design-container-runtime-contract.md#runtime-behavior`
- `design-docs/specs/design-executable-node-addon-manifest-dependencies.md#local-command-add-on-resolution`
- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#built-in-rielflowworkflow-package-sandbox-review`

### Summary

Remove the remaining worker-facing `RIEL_MAILBOX_DIR` node execution file ABI.
SQLite `workflow_messages` becomes the only runtime communication path for
workflow and node handoff. Agent, command, container, and add-on workers receive
resolved semantic input through their adapter or native executor boundary and
return candidate output through runtime-owned channels, not by reading
`inbox/input.json` or writing `outbox/output.json`.

`RIEL_ATTACHMENT_ROOT` remains supported for non-message file and binary
attachment handoff. Runtime-owned `output.json` artifacts remain publication and
audit records after validation; they are not worker outbox files.

### Scope

**Included**:

- Remove `RIEL_MAILBOX_DIR`, `inbox/input.json`, and `outbox/output.json` from
  node execution input/output contracts.
- Preserve SQLite `workflow_messages` reads/writes as the only communication
  source for node handoff, replay, resume, manager control, and GraphQL
  inspection.
- Update codex-agent, Cursor, SDK, command, container, and add-on execution
  boundaries to consume resolved input and candidate output without mailbox
  files.
- Replace user-facing prompt, skill, docs, example, and test guidance that tells
  agents or scripts to read/write node mailbox files.
- Keep `RIEL_ATTACHMENT_ROOT` as the attachment-only file handoff boundary.
- Refresh `rielflow-package.json` digests if packaged workflow, prompt, script,
  or skill files are edited.

**Excluded**:

- Backward compatibility for worker-facing mailbox files.
- A migration that reads legacy `inbox/input.json` or `outbox/output.json` to
  repair missing `workflow_messages`.
- Changing codex-agent or Cursor storage internals.
- Removing runtime-owned final `output.json` artifacts.
- Removing attachment materialization under `RIEL_ATTACHMENT_ROOT`.

## Issue Reference

- Issue source: `runtimeVariables.workflowInput`
- Issue URL: none provided
- Workflow ID: `codex-design-and-implement-review-loop`
- Node ID: `step4-impl-plan-create`
- Workflow mode: `issue-resolution`
- Review mode: `adversarial`
- Risk level: `high`
- Accepted design source: `step2-design-doc-update`, exec `exec-000008`,
  accepted by `step3-design-review`, exec `exec-000012`, with low cleanup only.
- Current plan revision: `step4-impl-plan-create`, exec `exec-000014`,
  accepted by `step5-impl-plan-review`, exec `exec-000016`, after
  `step4-impl-plan-self-review`, exec `exec-000015`.

## Codex Agent References

- `step1-issue-intake`, exec `exec-000002`: requested behavior, acceptance
  signals, impacted areas, constraints, and verification commands.
- `step2-design-doc-update`, exec `exec-000008`: accepted design source of
  truth and decisions that remove the mailbox file ABI.
- `step2-design-self-review`, exec `exec-000010`: accepted the Step 2 design
  revision with no high or mid findings.
- `step3-design-review`, exec `exec-000012`: accepted the design with low
  cleanup only; required replacing ambiguous "mailbox inputs" wording and
  tracking `mailboxInstanceId` naming in this plan.
- `step4-impl-plan-create`, exec `exec-000014`: revised plan with complete
  task, dependency, completion, and verification coverage.
- `step4-impl-plan-self-review`, exec `exec-000015`: accepted the plan before
  independent review.
- `step5-impl-plan-review`, exec `exec-000016`: accepted the implementation
  plan and carried a low traceability cleanup.
- `step6-implement`, exec `exec-000017`: implemented the runtime, tests,
  docs, prompts, examples, and progress updates.
- Workflow input codex-agent reference: "The prior assumption that native node
  outbox/output.json should remain is wrong. Remove that contract unless a
  design proves a distinct non-message file/binary attachment path needs to
  remain."
- `../../codex-agent`: unavailable to Step 2. No concrete file-backed mailbox
  behavior is copied. Codex-agent remains execution backend terminology only.

## Modules

### 1. Resolved Node Execution Input Contract

#### `packages/rielflow/src/workflow/node-execution-mailbox.ts`
#### `packages/rielflow/src/workflow/engine/step-input.ts`
#### `packages/rielflow/src/workflow/engine/node-execution.ts`
#### `packages/rielflow/src/workflow/call-step-impl/direct-step-execution.ts`

**Status**: COMPLETED

```typescript
interface ResolvedNodeExecutionInput {
  readonly arguments: JsonValue | null;
  readonly runtimeVariables: Readonly<Record<string, JsonValue>>;
  readonly upstream: readonly WorkflowCommunicationView[];
  readonly latestOutputs: readonly PromptCompositionLatestOutput[];
  readonly managerMessage?: ManagerMessageView;
  readonly attachmentRoot?: string;
}

interface NodeExecutionInputArtifacts {
  readonly artifactDir: string;
  readonly resolvedInputSnapshotPath: string;
}
```

**Checklist**:

- [x] Replace worker-facing mailbox metadata with resolved input semantics.
- [x] Stop creating `mailbox/inbox/input.json` for node execution.
- [x] Keep any input snapshot under artifact naming that is not a worker ABI.
- [x] Remove `RIEL_MAILBOX_DIR` instructions from prompt composition.
- [x] Preserve `latestOutputs`, upstream payload summaries, and attachment
      descriptors sourced from `workflow_messages`.

### 2. SQLite Communication Handoff And Finalization

#### `packages/rielflow/src/workflow/engine/mailbox-communication-artifacts.ts`
#### `packages/rielflow/src/workflow/engine/result-finalization.ts`
#### `packages/rielflow/src/workflow/engine/step-result-finalization.ts`
#### `packages/rielflow/src/workflow/engine/node-output-attempts.ts`
#### `packages/rielflow/src/workflow/communication-artifact-persistence.ts`

**Status**: COMPLETED

```typescript
interface WorkflowMessagePublicationResult {
  readonly communicationIds: readonly string[];
  readonly workflowMessagesOnly: true;
  readonly outputArtifactPath: string;
}

interface RuntimeCandidateOutput {
  readonly payload: JsonObject;
  readonly outputRaw: string;
  readonly candidateSource: "adapter" | "stdout" | "candidate-path" | "addon-return";
}
```

**Checklist**:

- [x] Ensure downstream delivery is created only by validated runtime writes to
      `workflow_messages`.
- [x] Remove any output discovery from `mailbox/outbox/output.json`.
- [x] Keep runtime final `artifactDir/output.json` publication after validation.
- [x] Preserve replay, retry, resume, manager-control, and GraphQL inspection on
      SQLite records.
- [x] Add negative handling so legacy mailbox files cannot create or override a
      communication.

### 3. Native Command And Container I/O

#### `packages/rielflow-addons/src/native-node-executor/template-env-and-containers.ts`
#### `packages/rielflow/src/workflow/native-node-executor.ts`
#### `packages/rielflow/src/workflow/native-node-executor/template-env-and-containers.ts`

**Status**: COMPLETED

```typescript
interface NativeProcessExecutionRequest {
  readonly resolvedInput: ResolvedNodeExecutionInput;
  readonly artifactDir: string;
  readonly attachmentRoot?: string;
  readonly environment: Readonly<Record<string, string>>;
}

interface NativeProcessExecutionResult {
  readonly payload: JsonObject;
  readonly stdoutPath: string;
  readonly stderrPath: string;
}
```

**Checklist**:

- [x] Remove `RIEL_MAILBOX_DIR` env injection for command and container nodes.
- [x] Stop mounting `/mailbox` into containers.
- [x] Pass resolved input through JSON stdin or executor-private request files
      that are not named `inbox/input.json`.
- [x] Parse structured candidate output from stdout or an executor-private result
      channel, never `outbox/output.json`.
- [x] Keep stderr diagnostic-only.
- [x] Preserve `RIEL_ATTACHMENT_ROOT` only for attachment descriptors.

### 4. Agent, SDK, And Add-on Output Boundaries

#### `packages/rielflow/src/workflow/adapter.ts`
#### `packages/rielflow/src/workflow/adapter-execution.ts`
#### `packages/rielflow/src/workflow/runtime-execution-contracts.ts`
#### `packages/rielflow-addons/src/mailbox-prompt-guidance.ts`
#### `packages/rielflow/src/workflow/mailbox-prompt-guidance.ts`
#### `packages/rielflow-addons/src/native-node-executor/git-and-addon-execution.ts`

**Status**: COMPLETED

```typescript
interface RuntimeExecutionContract {
  readonly inputSource: "resolved-workflow-messages";
  readonly outputPublication: "runtime-owned-after-validation";
  readonly candidatePath?: string;
}

interface AddonExecutionRequest {
  readonly input: ResolvedNodeExecutionInput;
  readonly attachmentRoot?: string;
}
```

**Checklist**:

- [x] Remove adapter support for `RIEL_MAILBOX_DIR`.
- [x] Replace mailbox prompt guidance with SQLite/resolved-input guidance.
- [x] Keep `Candidate-Path` only for runtime-owned candidate submission.
- [x] Ensure codex-agent and Cursor wording remains backend terminology, not
      transport behavior.
- [x] Ensure native add-ons receive input in process and return candidate
      objects through APIs.

### 5. User-Facing Docs, Skills, Prompts, And Examples

#### `README.md`
#### `.codex/skills/**`
#### `examples/**`
#### `packages/rielflow/src/workflow/prompts/rielflow-role-system-prompt.md`
#### `design-docs/specs/design-container-runtime-contract.md`
#### `design-docs/specs/design-executable-node-addon-manifest-dependencies.md`
#### `design-docs/specs/design-graphql-manager-control-plane.md`

**Status**: COMPLETED

```typescript
interface DocumentationCleanupTarget {
  readonly path: string;
  readonly replacementConcept: "resolved-input" | "workflow_messages" | "attachment-handoff";
  readonly requiresDigestRefresh: boolean;
}
```

**Checklist**:

- [x] Replace instructions to read `$RIEL_MAILBOX_DIR/inbox/input.json`.
- [x] Replace instructions to write `$RIEL_MAILBOX_DIR/outbox/output.json`.
- [x] Update examples to use stdin/stdout or executor-private request/result
      channels.
- [x] Replace ambiguous "mailbox inputs" wording called out by Step 3.
- [x] Audit `mailboxInstanceId` references and either rename new telemetry
      fields or document them as historical execution-attempt identifiers.
- [x] Refresh package digests after workflow, prompt, script, or skill edits.

### 6. Regression Tests And Search Gates

#### `packages/rielflow/src/workflow/adapter.test.ts`
#### `packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts`
#### `packages/rielflow/src/workflow/native-node-executor-gateway.test.ts`
#### `packages/rielflow/src/workflow/engine.test.ts`
#### `packages/rielflow/src/workflow/communication-service.test.ts`
#### `packages/rielflow/src/workflow/runtime-db.test.ts`
#### `packages/rielflow/src/workflow/paths.test.ts`

**Status**: COMPLETED

```typescript
interface MailboxRemovalRegressionCase {
  readonly fixtureName: string;
  readonly createsLegacyMailboxFiles: boolean;
  readonly expectedWorkflowMessageRows: number;
  readonly expectedLegacyFileEffect: "ignored";
}
```

**Checklist**:

- [x] Update existing mailbox-file assertions to SQLite message assertions.
- [x] Add command/container tests that pass resolved input without
      `RIEL_MAILBOX_DIR`.
- [x] Add negative tests proving legacy `inbox/input.json` and
      `outbox/output.json` files are ignored for communication.
- [x] Add docs/skills/examples search gates for removed user-facing patterns.
- [x] Run focused workflow, database, adapter, native executor, and typecheck
      verification.

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Resolved node input contract | `packages/rielflow/src/workflow/node-execution-mailbox.ts`; engine/direct-step input files | COMPLETED | `engine.test.ts`, `adapter.test.ts` |
| SQLite handoff/finalization | `packages/rielflow/src/workflow/engine/*finalization*`; `communication-artifact-persistence.ts` | COMPLETED | `communication-service.test.ts`, `runtime-db.test.ts`, `engine.test.ts` |
| Native command/container I/O | `packages/rielflow-addons/src/native-node-executor/template-env-and-containers.ts` | COMPLETED | `native-node-executor-*.test.ts` |
| Agent/SDK/add-on boundary | `adapter.ts`; `adapter-execution.ts`; `runtime-execution-contracts.ts`; prompt guidance files | COMPLETED | `adapter.test.ts`, adapter dispatch tests |
| Docs/skills/prompts/examples | `README.md`; `.codex/skills/**`; `examples/**`; prompt markdown | COMPLETED | `rg` search gates, digest verification |
| Regression gates | workflow/runtime test suites | COMPLETED | focused `bun test`, `bun run typecheck` |

## Tasks

### TASK-001: Inventory Runtime And User-Facing Mailbox Contracts

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- Current hit list for `RIEL_MAILBOX_DIR`, `inbox/input.json`,
  `outbox/output.json`, and user-facing mailbox read/write guidance.
- Classification of each hit as remove, rename, internal persisted label, or
  attachment-only path.

**Dependencies**: None.

**Completion Criteria**:

- [x] Inventory includes `packages/`, `.codex/skills/`, `examples/`,
      `README.md`, `design-docs/`, and `impl-plans/`.
- [x] No implementation starts from an incomplete hit list.
- [x] Existing dirty files are noted before editing and not reverted.

### TASK-002: Replace Node Input Artifact Contract With Resolved Input

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- Runtime input assembly returns semantic input to adapters/executors without
  writing `mailbox/inbox/input.json`.
- Prompt composition names resolved input and SQLite `workflow_messages`, not
  mailbox files.

**Dependencies**: TASK-001.

**Completion Criteria**:

- [x] Node execution no longer exports `RIEL_MAILBOX_DIR` for worker input.
- [x] Input snapshots, if retained, are audit artifacts only.
- [x] Direct step execution follows the same input path.

### TASK-003: Replace Native Output Discovery With Runtime Candidate Channels

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- Command/container nodes return structured candidate output via stdout or a
  private result channel.
- Native add-ons return candidate objects in process.
- Runtime finalization writes SQLite `workflow_messages` after validation.

**Dependencies**: TASK-002.

**Completion Criteria**:

- [x] No executor reads `mailbox/outbox/output.json`.
- [x] Containers do not mount `/mailbox`.
- [x] Runtime `artifactDir/output.json` remains intact.

### TASK-004: Update Adapter, Prompt, Skill, Docs, And Example Guidance

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-001, if assigned separately from runtime
code edits.
**Deliverables**:

- User-facing guidance describes resolved input, `workflow_messages`, stdout or
  Candidate-Path candidate output, and attachment-only file handoff.
- Examples no longer require `RIEL_MAILBOX_DIR`.
- Step 3 low terminology findings are corrected or explicitly tracked.

**Dependencies**: TASK-001.

**Completion Criteria**:

- [x] No skill, prompt, README, or example tells users or agents to read/write
      node mailbox files.
- [x] Package digests are refreshed when edited packaged skill/workflow/prompt
      files require it.
- [x] `mailboxInstanceId` is not introduced as a new public message transport
      concept; remaining references are historical/internal only.
- [x] Remaining "mailbox" references are intentional non-file labels or
      historical design context.

### TASK-005: Update Tests For SQLite-Only Communication

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- Unit and integration tests assert SQLite-only message handoff.
- Negative tests prove legacy mailbox files do not affect communication.
- Native command/container tests cover stdin/stdout or private result channel
  behavior.

**Dependencies**: TASK-002, TASK-003.

**Completion Criteria**:

- [x] Existing mailbox-file tests are removed or rewritten.
- [x] Focused tests pass.
- [x] Search gates fail on reintroduced worker file ABI strings.

### TASK-006: Final Verification And Progress Logging

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**:

- Completed verification command log in this plan.
- Residual risks and intentional remaining references documented.

**Dependencies**: TASK-004, TASK-005.

**Completion Criteria**:

- [x] `bun run typecheck` passes.
- [x] Focused workflow tests pass.
- [x] `git diff --check` passes for changed files.
- [x] Progress Log records implementation date, commands, results, and any
      blockers.

## Dependencies

| Feature | Depends On | Status |
| --- | --- | --- |
| Runtime resolved input contract | TASK-001 | COMPLETED |
| Native command/container output channel | TASK-002 | COMPLETED |
| Runtime SQLite finalization cleanup | TASK-002, TASK-003 | COMPLETED |
| Docs/skills/examples cleanup | TASK-001 | COMPLETED |
| Regression tests | TASK-002, TASK-003, TASK-004 | COMPLETED |
| Final verification | TASK-004, TASK-005 | COMPLETED |

## Parallelizable Tasks

| Task | Parallelizable | Disjoint Write Scope |
| --- | --- | --- |
| TASK-001 | No | Establishes shared inventory. |
| TASK-002 | No | Core runtime input files overlap with later tests. |
| TASK-003 | No | Depends on runtime input boundary. |
| TASK-004 | Yes | Docs, skills, prompts, and examples can be edited separately after the inventory is frozen. |
| TASK-005 | No | Tests depend on final runtime behavior. |
| TASK-006 | No | Final join and verification. |

## Verification

Run these commands before handoff:

```bash
rg -n "RIEL_MAILBOX_DIR|inbox/input\\.json|outbox/output\\.json" packages examples .codex design-docs README.md impl-plans
rg -n "mailboxInstanceId|mailbox inputs" packages design-docs impl-plans
bun test packages/rielflow/src/workflow/adapter.test.ts packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts packages/rielflow/src/workflow/native-node-executor-gateway.test.ts packages/rielflow/src/workflow/engine.test.ts
bun test packages/rielflow/src/workflow/communication-service.test.ts packages/rielflow/src/workflow/runtime-db.test.ts packages/rielflow/src/workflow/paths.test.ts
bun run typecheck
git diff --check -- packages/rielflow packages/rielflow-addons README.md examples .codex design-docs impl-plans
```

Search output is acceptable only when each remaining hit is a negative
requirement, historical design context, runtime-owned final artifact reference,
attachment-only reference, or this implementation plan.

## Completion Criteria

- [x] SQLite `workflow_messages` is the only runtime workflow/node message
      handoff path.
- [x] Workers do not receive `RIEL_MAILBOX_DIR`.
- [x] Workers do not read `inbox/input.json`.
- [x] Workers do not write `outbox/output.json`.
- [x] Native command, container, and add-on execution use non-mailbox input and
      candidate output channels.
- [x] `RIEL_ATTACHMENT_ROOT` remains available only for non-message file and
      binary attachment descriptors.
- [x] Skills, prompts, docs, examples, and tests no longer instruct mailbox-file
      communication.
- [x] Focused tests, typecheck, search gates, and diff checks pass.
- [x] Progress Log records implementation notes and verification results.

## Progress Log

- 2026-06-08: Plan revised after `step5-impl-plan-review` exec `exec-000016`;
  added `impl-plans/PROGRESS.json` registration, replaced broad design-doc
  references with section anchors, restored accepted execution lineage
  (`step2-design-doc-update` exec `exec-000008`, `step3-design-review` exec
  `exec-000012`, `step4-impl-plan-create` exec `exec-000014`,
  `step4-impl-plan-self-review` exec `exec-000015`), and kept the
  `../../codex-agent` missing behavioral-only mapping. No implementation tasks
  started.
- 2026-06-08: Step 6 implementation completed for
  `codex-design-and-implement-review-loop` exec `exec-000017`. Runtime node
  input snapshots now use `resolved-input/`, adapter hook context no longer
  exposes `RIEL_MAILBOX_DIR`, native command/container nodes no longer mount
  `/mailbox`, and native candidate output is parsed from stdout. Skills, docs,
  prompts, examples, and tests were updated so worker message handoff is
  SQLite `workflow_messages` only while `RIEL_ATTACHMENT_ROOT` remains
  attachment-only. Verification passed: `bun test
  packages/rielflow/src/workflow/adapter.test.ts
  packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts
  packages/rielflow/src/workflow/native-node-executor-gateway.test.ts
  packages/rielflow/src/workflow/engine.test.ts`; `bun test
  packages/rielflow/src/workflow/communication-service.test.ts
  packages/rielflow/src/workflow/runtime-db.test.ts
  packages/rielflow/src/workflow/paths.test.ts`; `bun run typecheck`;
  `bun run lint:biome`; `bun test
  packages/rielflow/src/workflow/prompt-composition.test.ts
  packages/rielflow/src/workflow/input-assembly.test.ts`;
  `git diff --check -- packages/rielflow-core packages/rielflow
  packages/rielflow-addons README.md examples .codex design-docs impl-plans`.
  Search gates show remaining `RIEL_MAILBOX_DIR`, `inbox/input.json`, and
  `outbox/output.json` hits only in negative assertions, removal requirements,
  historical design context, or this implementation plan. `rg --files -g
  'rielflow-package.json'` and `find . -name rielflow-package.json -print`
  found no package manifest to refresh.
- 2026-06-08: Step 6 follow-up verification removed the remaining
  runtime-persisted communication `inbox`/`outbox` mirror files from
  `packages/rielflow/src/workflow/communication-artifact-persistence.ts`.
  GraphQL/service inspection continues to synthesize snapshots from SQLite
  `workflow_messages`, while tests assert no communication mirror files are
  materialized. Verification passed: `bun test
  packages/rielflow/src/workflow/communication-service.test.ts`; production
  search gate for legacy node/mailbox paths returned no active-code hits.
- 2026-06-08: Step 7 rerun feedback from `step7-review` exec `exec-000020`
  addressed. Native command and container execution now strip ambient
  `RIEL_MAILBOX_DIR`, command workers receive resolved input through
  `RIEL_RESOLVED_INPUT_PATH` plus stdin where supported, and containers mount an
  executor-private resolved-input request file at
  `/rielflow-input/resolved-input.json`. Local Codex, Claude, and Cursor agent
  execution now strip legacy mailbox env during worker/session startup while
  preserving approved manager and workflow env. Regression coverage added for
  ambient mailbox env leakage and native resolved-input request channels.
- 2026-06-08: Step 7 review exec `exec-000020` required revision. Addressed
  native command/container resolved input by passing `executionMailbox.input`
  JSON on stdin, restored supported `cursor-cli-agent` and
  `official/cursor-sdk` documentation, restored the `extends`-only derived
  workflow source contract in the workflow format reference, and refreshed this
  plan lineage to latest outputs.
- 2026-06-08: Step 6 rerun exec `exec-000021` completed the Step 7
  `needs_revision` feedback. Native command workers now receive
  `RIEL_RESOLVED_INPUT_PATH` pointing at the artifact-local
  `resolved-input/native-request.json`; container workers receive the same
  request file through a read-only `/rielflow-input/resolved-input.json` mount,
  `RIEL_RESOLVED_INPUT_PATH`, and `-i` stdin. Added command and container
  regressions proving arguments, upstream records, and `latestOutputs` are
  available without `RIEL_MAILBOX_DIR`. Restored `cursor-cli-agent`,
  `official/cursor-sdk`, and `extends`-only workflow docs. Verification passed:
  `bun test packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts`;
  `bun test packages/rielflow/src/workflow/adapter.test.ts
  packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts
  packages/rielflow/src/workflow/native-node-executor-gateway.test.ts
  packages/rielflow/src/workflow/engine.test.ts`; `bun test
  packages/rielflow/src/workflow/communication-service.test.ts
  packages/rielflow/src/workflow/runtime-db.test.ts
  packages/rielflow/src/workflow/paths.test.ts`; `bun test
  packages/rielflow/src/workflow/prompt-composition.test.ts
  packages/rielflow/src/workflow/input-assembly.test.ts`; `bun run
  typecheck`; `bun run lint:biome`; `git diff --check -- packages/rielflow-core
  packages/rielflow packages/rielflow-addons README.md examples .codex
  design-docs impl-plans`.
- 2026-06-08: Step 6 rerun exec `exec-000026` addressed
  `step7-adversarial-review` exec `exec-000025` mid findings. Native command
  and container stdout parsing then accepted a valid JSON object across
  multiple lines; Step 7 review exec `exec-000028` later tightened stdout
  handling as recorded below. X follower digest scripts and
  Discord/Matrix/Telegram persona memory scripts
  now read resolved runtime input from `RIEL_RESOLVED_INPUT_PATH` or stdin
  instead of replacing input with empty stubs, while continuing to write JSON
  candidates to stdout. `packages/rielflow/src/workflow/examples-script-contract.test.ts`
  proves digest upstream payloads, summary validation, persisted state, persona
  `workflowInput.memoryRoot`, and memory entries work without
  `RIEL_MAILBOX_DIR`; `native-node-executor-addons-commands.test.ts` now covers
  pretty-printed JSON stdout. Verification passed: `bun test
  packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts`;
  `bun test packages/rielflow/src/workflow/examples-script-contract.test.ts`;
  `bun test packages/rielflow/src/workflow/adapter.test.ts
  packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts
  packages/rielflow/src/workflow/native-node-executor-gateway.test.ts
  packages/rielflow/src/workflow/engine.test.ts
  packages/rielflow/src/workflow/examples-script-contract.test.ts`; `bun test
  packages/rielflow/src/workflow/communication-service.test.ts
  packages/rielflow/src/workflow/runtime-db.test.ts
  packages/rielflow/src/workflow/paths.test.ts`; `bun test
  packages/rielflow/src/workflow/prompt-composition.test.ts
  packages/rielflow/src/workflow/input-assembly.test.ts`; `bun run typecheck`;
  `bun run lint:biome`; `git diff --check -- packages/rielflow-core
  packages/rielflow packages/rielflow-addons README.md examples .codex
  design-docs impl-plans`; review search gates for empty input stubs and
  mailbox file references returned only allowed removal/history/test guard hits.
- 2026-06-08: Step 6 rerun exec `exec-000030` addressed `step7-review` exec
  `exec-000029` feedback. Verified `buildContainerEnv` strips
  `RIEL_MAILBOX_DIR` from rendered container env and added a direct regression
  next to the existing fake-runner regression where `container.envTemplate`
  includes `RIEL_MAILBOX_DIR` but docker run args do not contain it. Native
  command/container stdout parsing requires the full trimmed stdout stream to
  be one top-level JSON object; diagnostics must go to stderr and leading
  stdout log text plus trailing JSON is rejected. Updated
  `native-node-executor-addons-commands.test.ts` so pretty-printed JSON stdout
  has no diagnostic preamble, process-log coverage keeps diagnostics on stderr,
  and a regression rejects stdout diagnostic preambles. Verification passed:
  `bun test packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts
  packages/rielflow/src/workflow/examples-script-contract.test.ts`; `bun run
  typecheck`; `bun run lint:biome`; `git diff --check -- packages/rielflow
  packages/rielflow-addons packages/rielflow-adapters examples .codex
  design-docs impl-plans`; production mailbox removal `rg` gate showed only
  `RIEL_MAILBOX_DIR` deletion/blocklist hits; example empty-input-stub gate
  returned no hits.
- 2026-06-08: Step 6 rerun exec `exec-000033` addressed `step7-review` exec
  `exec-000032` mid findings. Updated `engine.test.ts` and
  `call-step-impl-failures.test.ts` command fixtures so stdout contains only
  the structured JSON candidate and command diagnostics are emitted on stderr.
  Assertions now prove JSON stdout process logs and stderr diagnostic logs are
  persisted for normal workflow runs and direct step calls under the full-stream
  JSON stdout contract. Verification passed: `bun test
  packages/rielflow/src/workflow/engine.test.ts -t "persists native command
  stdout in runtime node logs"`; `bun test
  packages/rielflow/src/workflow/call-step-impl-failures.test.ts -t "persists
  native command process logs for direct step calls"`; `bun test
  packages/rielflow/src/workflow/adapter.test.ts
  packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts
  packages/rielflow/src/workflow/native-node-executor-gateway.test.ts
  packages/rielflow/src/workflow/engine.test.ts
  packages/rielflow/src/workflow/call-step-impl-failures.test.ts
  packages/rielflow/src/workflow/examples-script-contract.test.ts`; `bun test
  packages/rielflow/src/workflow/communication-service.test.ts
  packages/rielflow/src/workflow/runtime-db.test.ts
  packages/rielflow/src/workflow/paths.test.ts`; `bun run typecheck`;
  `bun run lint:biome`; `git diff --check -- packages/rielflow
  packages/rielflow-addons packages/rielflow-adapters examples .codex
  design-docs impl-plans`; production mailbox removal `rg` gate found no
  active mailbox file I/O.
- 2026-06-08: Step 6 rerun exec `exec-000034` addressed `step7-review` exec
  `exec-000033` feedback. Runtime output-contract prompts now describe
  runtime-owned workflow message publication without mailbox file terminology.
  Discord, Matrix, Telegram, subworkflow, and debate example prompts now refer
  to resolved workflow message input/context or upstream payloads instead of
  mailbox data/context. Example event docs now describe automatic final/error
  replies without mailbox wording. Verification included TypeScript, Biome,
  focused prompt/composition tests, diff whitespace checks, and stale-prompt
  search gates.
- 2026-06-08: Step 6 rerun exec `exec-000037` addressed `step7-review` exec
  `exec-000036` mid finding. `buildUpstreamInputs` now hydrates downstream
  handoff payloads from SQLite `workflow_messages.payload_json` instead of
  `artifactDir/output.json`, and latest-output prompt context also resolves
  from delivered workflow message rows so runtime-owned `output.json` remains
  publication/audit evidence only. Added a regression proving a delivered
  SQLite workflow message still feeds a downstream step after the source
  `output.json` artifact is removed, with no legacy `mailbox/inbox/input.json`
  or `mailbox/outbox/output.json` fallback. Verification passed: focused
  upstream payload regression, runtime-owned publication prompt regression,
  TypeScript, Biome, workflow communication/runtime-db/path subsets, and diff
  plus mailbox-removal search gates.
- 2026-06-08: Step 6 rerun exec `exec-000038` addressed `step7-review` exec
  `exec-000037` feedback. Superseded
  `impl-plans/node-execution-inbox-contract.md` so it no longer gives positive
  implementation guidance for the removed worker-facing file contract. The
  historical plan now points to this active SQLite-only plan and documents
  resolved input, SQLite `workflow_messages`, runtime-owned publication,
  native `RIEL_RESOLVED_INPUT_PATH`/stdin, and attachment-only
  `RIEL_ATTACHMENT_ROOT` behavior. Verification passed: `rg` scoped to
  `impl-plans/node-execution-inbox-contract.md` found no stale legacy node I/O
  terms; `bun test packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts
  packages/rielflow/src/workflow/communication-service.test.ts`; `bun run
  typecheck`; `bun run lint:biome`; `git diff --check -- packages/rielflow-core
  packages/rielflow packages/rielflow-addons README.md examples .codex
  design-docs impl-plans`.
- 2026-06-08: Step 6 rerun exec `exec-000042` addressed `step7-review` exec
  `exec-000041` feedback. Updated
  `design-docs/specs/design-event-external-mailbox-binding.md` so external
  provider binding guidance identifies SQLite `workflow_messages`,
  runtime-owned output publication, and selected root output state as the
  source of workflow business results, and no longer describes node artifact
  inbox/outbox paths as preserving or sourcing message payloads. Verification
  passed: focused stale-design `rg`; `bun test
  packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts
  packages/rielflow/src/workflow/communication-service.test.ts`; `bun run
  typecheck`; `bun run lint:biome`; `git diff --check -- packages/rielflow-core
  packages/rielflow packages/rielflow-addons README.md examples .codex
  design-docs impl-plans`.
- 2026-06-08: Step 6 rerun exec `exec-000047` addressed
  `step7-adversarial-review` exec `exec-000046` feedback. Latest completed
  output context now indexes SQLite `workflow_messages` rows in either
  `delivered` or `consumed` status so later steps retain prior completed
  outputs after downstream consumption, while still excluding created, failed,
  or superseded messages. Expanded the engine regression to run a three-step
  managerless workflow and prove step 3 sees both step 1 and step 2
  `latestOutputs` after the step 1 message has status `consumed`. Verification
  passed: `bun test packages/rielflow/src/workflow/engine.test.ts -t "persists
  latest completed outputs"`; `bun test
  packages/rielflow/src/workflow/engine.test.ts`; `bun run typecheck`; `bun run
  lint:biome`; `git diff --check --
  packages/rielflow/src/workflow/engine/mailbox-communication-artifacts.ts
  packages/rielflow/src/workflow/engine.test.ts impl-plans`.
