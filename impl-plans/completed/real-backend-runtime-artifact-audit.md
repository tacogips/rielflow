# Real-Backend Runtime Artifact Audit Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-execution-inbox-contract.md#real-backend-artifact-audit-requirements`
**Created**: 2026-05-06
**Last Updated**: 2026-05-06

## Source Design

This plan implements the accepted Step 2 design update for issue-resolution
workflow mode: `Verify non-mock impl-plan implementation workflow execution`.
The source of truth is `design-docs/specs/design-node-execution-inbox-contract.md`
lines 198-227 and 249-290.

In scope:

- verify real configured LLM backend metadata is persisted for each runtime step
- preserve full `latestOutputs` in `mailbox/inbox/input.json`
- ensure prompt/request, candidate, validation, and runtime-owned publication
  artifacts are inspectable per attempt where applicable
- add focused runtime tests for artifact/session correctness

Out of scope:

- replacing canonical communication storage
- delegating divedra workflow mailbox, validation, routing, or publication to
  `codex-agent`
- changing mock-scenario semantics except where tests assert mock evidence is
  not sufficient for non-mock audit acceptance
- reverting unrelated dirty worktree changes

## Codex References

- `<reference-repository-root>/design-docs/specs/design-codex-session-management.md`:
  reference for session and rollout auditability.
- `<reference-repository-root>/src/sdk/session-runner.ts`:
  reference for `SessionConfig`, `RunningSession`, and streamed session
  messages that stay behind divedra backend adapter boundaries.

Intentional divergence: divedra keeps workflow session artifacts, mailbox
contracts, output validation, routing, and final publication runtime-owned.
`codex-agent` remains a backend adapter and auditability reference.

## Modules

### 1. Runtime Artifact Inventory

#### `src/workflow/engine.ts`
#### `src/workflow/call-step-impl.ts`
#### `src/workflow/node-execution-mailbox.ts`

**Status**: COMPLETED

```typescript
interface NodeExecutionAuditInventory {
  readonly backend: string;
  readonly model: string | null;
  readonly mailboxMetaPath: string;
  readonly mailboxInputPath: string;
  readonly attemptArtifacts: readonly NodeExecutionAttemptAudit[];
  readonly finalOutputPath: string;
  readonly finalMetaPath: string;
  readonly finalHandoffPath: string;
}

interface NodeExecutionAttemptAudit {
  readonly attemptId: string;
  readonly requestPath: string;
  readonly candidatePath: string | null;
  readonly validationPath: string | null;
}
```

**Checklist**:

- [x] Inspect current run and direct-step artifact writers before changing code.
- [x] Confirm paths for request, candidate, validation, output, meta, and handoff
      records are stable and runtime-owned.
- [x] Add or reuse a small typed helper only if it removes duplication between
      workflow-run and direct `call-step` execution paths.

### 2. Full Mailbox Input Propagation

#### `src/workflow/node-execution-mailbox.ts`
#### `src/workflow/engine.ts`
#### `src/workflow/call-step-impl.ts`

**Status**: COMPLETED

```typescript
interface NodeExecutionMailboxInputPayload {
  readonly arguments: Readonly<Record<string, unknown>> | null;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly upstream?: readonly unknown[];
  readonly latestOutputs?: readonly NodeExecutionLatestOutput[];
}

interface NodeExecutionLatestOutput {
  readonly nodeId: string;
  readonly stepId: string;
  readonly nodeExecId: string;
  readonly status: string;
  readonly artifactDir: string;
  readonly payload: unknown;
}
```

**Checklist**:

- [x] Verify prompt truncation does not truncate `mailbox/inbox/input.json`.
- [x] Ensure `latestOutputs` includes full structured payloads, node ids, step
      ids, execution ids, statuses, artifact directories, and mailbox instance ids
      when available.
- [x] Preserve current upstream input behavior for existing tests and adapters.

### 3. Backend Metadata and Request Evidence

#### `src/workflow/adapter.ts`
#### `src/workflow/adapters/codex.ts`
#### `src/workflow/adapters/claude.ts`
#### `src/workflow/engine.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Confirm each node execution records the configured `executionBackend` and
      model requested from the workflow node definition.
- [x] Ensure artifacts distinguish real `codex-agent` or other configured LLM
      backends from mock-scenario responses.
- [x] Keep Cursor-specific or process-launch details behind adapter modules.
- [x] Do not make worker prompt text the source of truth for audit metadata.

### 4. Candidate and Validation Artifact Coverage

#### `src/workflow/engine.ts`
#### `src/workflow/call-step-impl.ts`
#### `src/workflow/engine.test.ts`
#### `src/workflow/call-step-impl.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Verify every output attempt persists prompt/request data.
- [x] Verify candidate JSON is staged under the reserved candidate path before
      runtime-owned publication.
- [x] Verify validation results are persisted when an output contract applies.
- [x] Verify final `output.json`, `meta.json`, and `handoff.json` remain
      runtime-owned and are not written directly by workers.

### 5. Regression and Audit Tests

#### `src/workflow/engine.test.ts`
#### `src/workflow/call-step-impl.test.ts`
#### `src/workflow/adapters/codex.test.ts`
#### `src/workflow/adapters/claude.test.ts`
#### `README.md`
#### `.divedra/workflows/design-and-implement-review-loop/EXPECTED_RESULTS.md`

**Status**: COMPLETED

**Checklist**:

- [x] Add focused tests for full `latestOutputs` in mailbox input.
- [x] Add focused tests for backend/model metadata in persisted artifacts.
- [x] Add focused tests for request/candidate/validation/final publication
      artifact presence.
- [x] Add adapter tests only for transport/audit fields crossing backend
      boundaries.
- [x] Refresh user-facing documentation only where observable runtime artifact
      or verification behavior changes.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Runtime artifact inventory | `src/workflow/engine.ts`, `src/workflow/call-step-impl.ts`, `src/workflow/node-execution-mailbox.ts` | COMPLETED | `engine.test.ts`, `call-step-impl.test.ts` |
| Mailbox latest outputs | `src/workflow/node-execution-mailbox.ts`, `src/workflow/engine.ts`, `src/workflow/call-step-impl.ts` | COMPLETED | `engine.test.ts`, `call-step-impl.test.ts` |
| Backend audit metadata | `src/workflow/adapter.ts`, `src/workflow/adapters/codex.ts`, `src/workflow/adapters/claude.ts` | COMPLETED | `codex.test.ts`, `claude.test.ts` |
| Output attempt artifacts | `src/workflow/engine.ts`, `src/workflow/call-step-impl.ts` | COMPLETED | `engine.test.ts`, `call-step-impl.test.ts` |

## Dependencies

| Task | Depends On | Status |
|------|------------|--------|
| TASK-001 Runtime Artifact Inventory | Accepted design and current artifact inspection | COMPLETED |
| TASK-002 Full Mailbox Input Propagation | TASK-001 path inventory | COMPLETED |
| TASK-003 Backend Metadata and Request Evidence | TASK-001 path inventory | COMPLETED |
| TASK-004 Candidate and Validation Artifact Coverage | TASK-001 path inventory | COMPLETED |
| TASK-005 Regression, Documentation, and Audit Verification | TASK-002, TASK-003, TASK-004 | COMPLETED |

## Task Breakdown

### TASK-001: Audit Current Runtime Artifacts

**Parallelizable**: No
**Deliverables**: artifact inventory notes in this plan progress log; no code
unless a minimal helper is clearly needed.

**Completion Criteria**:

- [x] Real workflow-run artifact paths are inspected.
- [x] Direct `call-step` artifact paths are inspected.
- [x] Existing dirty worktree changes related to runtime artifacts are preserved.

### TASK-002: Preserve Full `latestOutputs`

**Parallelizable**: No, shares runtime mailbox writers with TASK-003 and TASK-004.
**Deliverables**: `src/workflow/node-execution-mailbox.ts`,
`src/workflow/engine.ts`, `src/workflow/call-step-impl.ts`.

**Completion Criteria**:

- [x] `mailbox/inbox/input.json` includes full structured latest completed
      outputs for downstream review and summary nodes.
- [x] Prompt summaries still point workers to `DIVEDRA_MAILBOX_DIR` and
      `mailbox/inbox/input.json`.

### TASK-003: Persist Backend and Model Evidence

**Parallelizable**: Yes after TASK-001 if it only touches adapter audit metadata
and disjoint adapter tests.
**Deliverables**: `src/workflow/adapter.ts`,
`src/workflow/adapters/codex.ts`, `src/workflow/adapters/claude.ts`,
`src/workflow/adapters/codex.test.ts`, `src/workflow/adapters/claude.test.ts`.

**Completion Criteria**:

- [x] Runtime artifacts identify configured backend and model.
- [x] Mock-scenario output cannot be mistaken for real configured LLM backend
      evidence.
- [x] Adapter boundary remains backend-specific.

### TASK-004: Persist Attempt Request, Candidate, and Validation Records

**Parallelizable**: No, shares workflow-run and direct-step publication paths.
**Deliverables**: `src/workflow/engine.ts`, `src/workflow/call-step-impl.ts`,
`src/workflow/engine.test.ts`, `src/workflow/call-step-impl.test.ts`.

**Completion Criteria**:

- [x] Each output attempt has inspectable request data.
- [x] Candidate and validation artifacts are present where output contracts
      apply.
- [x] Final output publication remains runtime-owned.

### TASK-005: Verify Non-Mock Workflow Audit and Documentation

**Parallelizable**: No, depends on implementation tasks.
**Deliverables**: focused test results, user-facing documentation refresh if
observable artifact or command behavior changes, and progress-log update.

**Completion Criteria**:

- [x] Focused tests pass.
- [x] `bun run typecheck` passes.
- [x] `README.md`, workflow `EXPECTED_RESULTS.md`, or other user-facing docs are
      updated when runtime behavior or verification instructions change.
- [x] A real-backend workflow execution artifact set can be inspected for
      mailbox guidance, latest outputs, request, candidate, validation, and
      final output records.

## Verification Plan

- `bun test src/workflow/engine.test.ts`
- `bun test src/workflow/call-step-impl.test.ts`
- `bun test src/workflow/adapters/codex.test.ts`
- `bun test src/workflow/adapters/claude.test.ts`
- `bun run typecheck`
- Run or inspect a real `design-and-implement-review-loop` issue-resolution
  execution using configured LLM backends, then verify node artifact directories
  contain `mailbox/inbox/input.json`, `mailbox/inbox/meta.json`, request,
  candidate, validation, `output.json`, `meta.json`, and `handoff.json` records.

## Completion Criteria

- [x] Accepted design lines 198-227 and 249-290 are implemented or verified.
- [x] Downstream nodes can inspect full `latestOutputs` from
      `mailbox/inbox/input.json`.
- [x] Runtime artifacts distinguish real configured LLM backend execution from
      mock-scenario responses.
- [x] Request, candidate, validation, final output, meta, and handoff artifacts
      are persisted where applicable.
- [x] Focused tests and typecheck pass.
- [x] User-facing docs are refreshed if implementation changes observable
      artifact layout, commands, or verification expectations.
- [x] Progress log records the implementation session, verification commands,
      and any unresolved TODOs.

## Progress Log

### Session: 2026-05-06

**Tasks Completed**: Created implementation plan after Step 3 accepted the
design.

**Tasks In Progress**: None

**Blockers**: None

**Notes**: Step 3 accepted the design with no high or mid findings. Later
implementation must preserve unrelated dirty worktree changes and keep edits
focused on runtime artifact/session correctness.

### Session: 2026-05-06 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005.

**Tasks In Progress**: None

**Blockers**: None

**Notes**: Preserved existing implementation work and completed the focused
runtime artifact audit changes. `src/workflow/engine.ts` and
`src/workflow/call-step-impl.ts` now persist configured `executionBackend` and
`model` in structured-output attempt `request.json` artifacts and include
`executionBackend` in node execution `input.json` for agent nodes. Existing
mailbox prompt guidance, full `latestOutputs`, candidate staging, validation
records, and runtime-owned final publication paths were verified. `README.md`
was refreshed with the observable runtime artifact layout.

**Verification Commands**:

- `bun test src/workflow/engine.test.ts`
- `bun test src/workflow/call-step-impl.test.ts`
- `env -u DIVEDRA_WORKFLOW_EXECUTION_ID -u DIVEDRA_WORKFLOW_ID -u DIVEDRA_NODE_ID -u DIVEDRA_NODE_EXEC_ID -u DIVEDRA_MAILBOX_DIR bun test src/workflow/adapters/codex.test.ts src/workflow/adapters/claude.test.ts`
- `bun run typecheck`
- `find /tmp/divedra-impl-workflow-llm.cXaS6W/workflow/design-and-implement-review-loop/executions/div-design-and-implement-review-loop-1778022566-ce05f607/nodes -path '*output-attempts*' -type f | sort | sed -n '1,160p'`
- `jq '{latestOutputsCount:(.latestOutputs|length), latestOutputIds:(.latestOutputs|map({nodeId,stepId,nodeExecId,status,artifactDir,hasPayload:(.payload!=null),mailboxInstanceId}))}' /tmp/divedra-impl-workflow-llm.cXaS6W/workflow/design-and-implement-review-loop/executions/div-design-and-implement-review-loop-1778022566-ce05f607/nodes/step6-implement/exec-000009/mailbox/inbox/input.json`

**Unresolved TODOs**: None.

### Session: 2026-05-06 Step 7 Feedback Remediation

**Tasks Completed**: TASK-005 post-change real-run artifact evidence.

**Tasks In Progress**: None

**Blockers**: None

**Notes**: Addressed Step 7 feedback by generating a post-implementation
`design-and-implement-review-loop` issue-resolution smoke execution with the
updated runtime code and real configured `codex-agent` backend. The smoke run
failed at `divedra-manager` because the `codex-agent` session exited with code
1, but it still produced post-change runtime-owned request/input artifacts that
prove the updated artifact writers include configured backend/model evidence:

- `/tmp/divedra-postchange-real.R5HRYK/artifacts/design-and-implement-review-loop/executions/div-design-and-implement-review-loop-1778023779-bfbabad2/nodes/divedra-manager/exec-000001/input.json`
- `/tmp/divedra-postchange-real.R5HRYK/artifacts/design-and-implement-review-loop/executions/div-design-and-implement-review-loop-1778023779-bfbabad2/nodes/divedra-manager/exec-000001/output-attempts/attempt-000001/request.json`
- `/tmp/divedra-postchange-real.R5HRYK/artifacts/design-and-implement-review-loop/executions/div-design-and-implement-review-loop-1778023779-bfbabad2/nodes/divedra-manager/exec-000001/mailbox/inbox/input.json`
- `/tmp/divedra-postchange-real.R5HRYK/artifacts/design-and-implement-review-loop/executions/div-design-and-implement-review-loop-1778023779-bfbabad2/nodes/divedra-manager/exec-000001/mailbox/inbox/meta.json`
- `/tmp/divedra-postchange-real.R5HRYK/artifacts/design-and-implement-review-loop/executions/div-design-and-implement-review-loop-1778023779-bfbabad2/nodes/divedra-manager/exec-000001/output.json`

The request artifact recorded `executionBackend: "codex-agent"` and
`model: "gpt-5.5"`. The node execution `input.json` also recorded
`executionBackend: "codex-agent"`, `model: "gpt-5.5"`, and the materialized
mailbox object. The failed output recorded `providerErrorMessage:
codex agent session 'pending-1778023780883' failed with exit code 1`, so the
smoke run is evidence of a real backend attempt rather than a mock scenario.

**Verification Commands**:

- `tmp=$(mktemp -d /tmp/divedra-postchange-real.XXXXXX); bun run src/main.ts workflow run design-and-implement-review-loop --workflow-definition-dir .divedra/workflows --artifact-root "$tmp/artifacts" --session-store "$tmp/sessions" --variables '{"workflowInput":{"executionMode":"issue-resolution","issueTitle":"Verify non-mock impl-plan implementation workflow execution","requestedBehavior":"Post-change audit smoke run to verify request artifacts include executionBackend and model.","targetFeatureArea":"divedra workflow runtime mailbox and session artifact audit","acceptanceSignals":["request artifacts include executionBackend and model"]}}' --max-steps 1 --output json; printf '\nPOSTCHANGE_ROOT=%s\n' "$tmp"`
- `find /tmp/divedra-postchange-real.R5HRYK -type f | sort`
- `for f in $(find /tmp/divedra-postchange-real.R5HRYK -path '*output-attempts*/request.json' -type f); do echo $f; jq '{executionBackend,model,hasPrompt:(.promptText!=null),candidatePath}' $f; done`
- `for f in $(find /tmp/divedra-postchange-real.R5HRYK -path '*/nodes/*/exec-*/input.json' -type f); do echo $f; jq '{nodeId,nodeExecId,nodeType,executionBackend,model,hasMailbox:(.executionMailbox!=null)}' $f; done`
- `jq '{provider,model,error,payload,validationErrors}' /tmp/divedra-postchange-real.R5HRYK/artifacts/design-and-implement-review-loop/executions/div-design-and-implement-review-loop-1778023779-bfbabad2/nodes/divedra-manager/exec-000001/output.json`

**Unresolved TODOs**: None.
