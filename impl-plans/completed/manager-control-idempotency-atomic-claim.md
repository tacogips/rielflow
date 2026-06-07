# Manager Control Idempotency Atomic Claim Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md#idempotency-contract; design-docs/specs/design-graphql-manager-control-plane.md#atomic-idempotency-claim-flow; design-docs/specs/notes.md#manager-authidempotency-contract
**Created**: 2026-06-07
**Last Updated**: 2026-06-07

## Design Document Reference

The accepted design source of truth is
`design-docs/specs/design-graphql-manager-control-plane.md`, reviewed and
accepted by Step 3 for SEC-001 with no high or mid findings. The compact
architecture note in `design-docs/specs/notes.md` repeats the storage-boundary
requirement.

Included:

- Replace load-before/action/save-after idempotency with an atomic pre-action
  claim for `(mutationName, managerSessionId, idempotencyKey)`.
- Persist pending versus completed idempotency state with a caller-owned claim
  token and normalized request hash.
- Reject same-key/different-hash requests before manager-control side effects.
- Make same-key/same-hash concurrent callers wait for or read the completed
  response instead of running the action body.
- Complete only the caller-owned pending row and avoid completed-response
  overwrite.
- Add targeted same-key concurrency regression coverage for
  `sendManagerMessage` and one communication mutation.
- Harden the built-in git commit/push add-ons so workflow completion can
  recover when this plan is archived from `impl-plans/active` to
  `impl-plans/completed` before the commit step.

Excluded:

- Dismissed scanner false positives and accepted LOW-001 runtime-artifact noise.
- Cursor CLI or codex-agent adapter behavior changes.
- New GraphQL schema fields or manager-auth scope changes.
- Broad SQLite message-store migration changes beyond the idempotent mutation
  table needed for SEC-001.

## Issue And Reference Traceability

- Workflow mode: `issue-resolution`
- Workflow ID: `codex-design-and-implement-review-loop`
- Node: `step4-impl-plan-create`
- Parent workflow: `codex-source-security-check-loop`
- Parent execution:
  `riel-codex-source-security-check-loop-1780822499-8d2b9c79`
- Caller: `fix-handoff` / `step6-fix-handoff`
- PR reference: `PR #54 / feature/sqlite-message-store`
- Finding: `SEC-001` from source finding `MED-001`
- Review decision: `delegate_fix`

Codex-agent references:

- Execution provider: `codex-agent / gpt-5.5`
- Reference repository root from upstream:
  `../../codex-agent`
- Step 1 codex-agent references: none
- Decision: no codex-agent behavior is copied. SEC-001 is rielflow
  manager-control persistence behavior below the agent adapter boundary.

## Modules

### 1. Idempotency Store Contract

#### packages/rielflow/src/workflow/manager-session-store.ts

**Status**: COMPLETED

```typescript
export type IdempotentMutationStatus = "pending" | "completed" | "failed";

export interface IdempotentMutationClaim {
  readonly mutationName: string;
  readonly managerSessionId: string;
  readonly idempotencyKey: string;
  readonly normalizedRequestHash: string;
  readonly claimToken: string;
  readonly status: IdempotentMutationStatus;
  readonly responseJson?: string;
  readonly errorJson?: string;
  readonly claimedAt: string;
  readonly completedAt?: string;
  readonly failedAt?: string;
}

export interface ClaimIdempotentMutationInput
  extends IdempotentMutationLookup {
  readonly normalizedRequestHash: string;
  readonly claimToken: string;
  readonly claimedAt: string;
}

export interface CompleteIdempotentMutationInput
  extends IdempotentMutationLookup {
  readonly normalizedRequestHash: string;
  readonly claimToken: string;
  readonly responseJson: string;
  readonly completedAt: string;
}

export interface FailIdempotentMutationInput extends IdempotentMutationLookup {
  readonly normalizedRequestHash: string;
  readonly claimToken: string;
  readonly errorJson: string;
  readonly failedAt: string;
}
```

**Checklist**:

- [x] Extend `idempotent_mutations` with `status`, `claim_token`,
      `claimed_at`, nullable `response_json`, and nullable `completed_at`
      while preserving the existing primary key.
- [x] Add migration handling for older completed-only rows so existing stored
      responses become `status='completed'`.
- [x] Add an atomic claim method that inserts a pending row only when no row
      exists and otherwise returns the existing row for hash/status handling.
- [x] Add a completion method that updates only the matching pending row by
      primary key, request hash, and caller claim token.
- [x] Add a failure method that records caller-owned pending action failures so
      same-key retries do not time out on stale pending rows.
- [x] Remove `ON CONFLICT ... DO UPDATE` behavior that can overwrite completed
      responses.

### 2. Idempotency Execution Wrapper

#### packages/rielflow/src/workflow/manager-message-service/idempotency.ts

**Status**: COMPLETED

```typescript
export interface IdempotencyStore
  extends Pick<
    ManagerSessionStore,
    | "claimIdempotentMutation"
    | "completeIdempotentMutation"
    | "failIdempotentMutation"
    | "loadIdempotentResult"
  > {}

export interface RunIdempotentMutationOptions<TResult> {
  readonly mutationName: string;
  readonly idempotencyKey: string | undefined;
  readonly managerSessionId: string | undefined;
  readonly normalizedPayload: unknown;
  readonly store: IdempotencyStore | undefined;
  readonly action: () => Promise<TResult>;
  readonly now: string;
}
```

**Checklist**:

- [x] Compute the normalized request hash before any side-effecting action.
- [x] Atomically claim the idempotency key before invoking `action`.
- [x] Return completed same-hash responses without invoking `action`.
- [x] Reject different-hash conflicts before invoking `action`.
- [x] For same-hash pending rows owned by another caller, poll/re-read briefly
      until completed or throw an explicit pending-timeout error.
- [x] Complete only the caller-owned pending row after successful action
      execution.
- [x] Store caller-owned action failures and rethrow the stored failure for
      same-key retries instead of leaving stale pending claims.

### 3. Manager And Communication Mutation Coverage

#### packages/rielflow/src/workflow/manager-message-service.test.ts
#### packages/rielflow/src/workflow/communication-service.test.ts

**Status**: COMPLETED

```typescript
interface ConcurrentIdempotencyRegressionCase {
  readonly mutationName:
    | "sendManagerMessage"
    | "replayCommunication"
    | "retryCommunicationDelivery";
  readonly idempotencyKey: string;
  readonly expectedDurableSideEffectCount: 1;
  readonly expectedResponseReuse: true;
}
```

**Checklist**:

- [x] Add concurrent same-key/same-hash `sendManagerMessage` coverage proving
      one manager message or one queued side effect persists.
- [x] Add concurrent same-key/same-hash communication coverage for
      `replayCommunication` or `retryCommunicationDelivery` proving one durable
      workflow message or one delivery-attempt update persists.
- [x] Keep existing sequential idempotent reuse/conflict tests passing.
- [x] Add a same-key/different-hash concurrent or pre-existing-row assertion
      proving conflict happens before durable side effects.

### 4. Documentation And Progress Updates

#### impl-plans/completed/manager-control-idempotency-atomic-claim.md
#### impl-plans/README.md
#### impl-plans/PROGRESS.json

**Status**: COMPLETED

```typescript
interface ManagerControlIdempotencyProgressEntry {
  readonly workflowMode: "issue-resolution";
  readonly findingId: "SEC-001";
  readonly reviewDecision: "delegate_fix";
  readonly completedTasks: readonly string[];
  readonly verificationCommands: readonly string[];
  readonly residualRisks: readonly string[];
}
```

**Checklist**:

- [x] Update this plan's module and task status during implementation.
- [x] Record verification commands and outcomes in the progress log.
- [x] Archive the plan after Step 7/security handoff accepts the implemented
      SEC-001 evidence.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Idempotency store contract | `packages/rielflow/src/workflow/manager-session-store.ts` | COMPLETED | Passed |
| Idempotency store claim helpers | `packages/rielflow/src/workflow/manager-session-store-idempotency.ts` | COMPLETED | Passed |
| Idempotency execution wrapper | `packages/rielflow/src/workflow/manager-message-service/idempotency.ts` | COMPLETED | Passed |
| Manager mutation regression coverage | `packages/rielflow/src/workflow/manager-message-service.test.ts` | COMPLETED | Passed |
| Communication mutation regression coverage | `packages/rielflow/src/workflow/communication-service.test.ts` | COMPLETED | Passed |
| Plan/progress updates | `impl-plans/completed/manager-control-idempotency-atomic-claim.md`, `impl-plans/README.md`, `impl-plans/PROGRESS.json` | COMPLETED | Passed |
| Git commit handoff recurrence guard | `packages/rielflow-addons/src/native-node-executor/git-and-addon-execution.ts`, `packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts` | COMPLETED | Passed |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Store claim/completion contract | Accepted Step 3 design | COMPLETED |
| Idempotency execution wrapper | Store claim/completion contract | COMPLETED |
| Concurrency regression tests | Store and wrapper behavior | COMPLETED |
| Security verification handoff | Implementation and tests | READY_FOR_REVIEW |

## Tasks

### TASK-001: Add Atomic Idempotency Claim Persistence

**Status**: COMPLETED
**Parallelizable**: No

**Dependencies**:

- Accepted Step 3 design.

**Deliverables**:

- `packages/rielflow/src/workflow/manager-session-store.ts`
- `packages/rielflow/src/workflow/manager-session-store-idempotency.ts`

**Completion Criteria**:

- [x] The schema distinguishes pending and completed idempotency records.
- [x] First caller atomically creates a pending claim before side effects.
- [x] Existing rows are observed without overwriting completed responses.
- [x] Completion updates only the caller-owned pending row with matching hash.
- [x] Failed action claims are marked failed with JSON error data and are reused
      by same-key retries without re-executing the action.

### TASK-002: Refactor `runIdempotentMutation`

**Status**: COMPLETED
**Parallelizable**: No

**Dependencies**:

- TASK-001

**Deliverables**:

- `packages/rielflow/src/workflow/manager-message-service/idempotency.ts`

**Completion Criteria**:

- [x] Same-key/different-hash conflicts are rejected before `action`.
- [x] Same-key/same-hash completed calls return stored response.
- [x] Same-key/same-hash pending calls do not execute `action` and either
      return completed response or fail with explicit pending-timeout error.
- [x] Successful action completion cannot overwrite a row owned by another
      caller.
- [x] Failed same-key calls reuse the stored failure and avoid pending-timeout
      retry behavior.

### TASK-003: Add Concurrent Same-Key Regression Tests

**Status**: COMPLETED
**Parallelizable**: No

**Dependencies**:

- TASK-001
- TASK-002

**Deliverables**:

- `packages/rielflow/src/workflow/manager-message-service.test.ts`
- `packages/rielflow/src/workflow/communication-service.test.ts`

**Completion Criteria**:

- [x] `sendManagerMessage` concurrent same-key callers produce one durable
      manager-control side effect and equal responses.
- [x] `replayCommunication` or `retryCommunicationDelivery` concurrent
      same-key callers produce one durable communication side effect and equal
      responses.
- [x] Existing `idempotent` tests continue to pass.
- [x] Failed first attempts followed by same-key retries are covered for
      `sendManagerMessage` and `replayCommunication`.

### TASK-004: Refresh Plan Evidence

**Status**: COMPLETED
**Parallelizable**: Yes, after TASK-003

**Dependencies**:

- TASK-003

**Deliverables**:

- `impl-plans/completed/manager-control-idempotency-atomic-claim.md`
- `impl-plans/README.md`
- `impl-plans/PROGRESS.json`

**Completion Criteria**:

- [x] Plan status/checklists reflect implementation progress.
- [x] Progress log records verification command outcomes.
- [x] No staged, committed, pushed, or unrelated reverted work is performed.

### TASK-005: Prevent Commit Handoff Path Drift Recurrence

**Status**: COMPLETED
**Parallelizable**: No

**Dependencies**:

- TASK-004

**Deliverables**:

- `packages/rielflow-addons/src/native-node-executor/git-and-addon-execution.ts`
- `packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts`

**Completion Criteria**:

- [x] `impl-plans/active/<name>` entries in `committedFiles` resolve to an
      existing `impl-plans/completed/<name>` before `git add`.
- [x] Missing unresolved committed file paths fail before `git add` with a
      precise diagnostic.
- [x] Git commit/push add-ons no longer depend only on child-process stdout for
      staged-file and commit-hash reads.
- [x] Focused regression coverage proves archived-plan commit handoff, missing
      path rejection, and git push still work.

## Parallelization Notes

- TASK-001, TASK-002, and TASK-003 are intentionally serial because the wrapper
  and tests depend on the final store contract.
- TASK-004 is parallelizable only after TASK-003 because it writes only plan
  documentation and does not overlap production/test implementation scopes.
- TASK-005 is serial after TASK-004 because it specifically protects the
  archived-plan commit handoff that occurs after plan completion.

## Verification

Required commands:

```bash
rg -n "loadIdempotentResult|runIdempotentMutation|saveIdempotentResult|claimIdempotentMutation|completeIdempotentMutation|ON CONFLICT\\(mutation_name" packages/rielflow/src/workflow/manager-message-service/idempotency.ts packages/rielflow/src/workflow/manager-session-store.ts
bun run typecheck
bun test packages/rielflow/src/workflow/communication-service.test.ts packages/rielflow/src/workflow/manager-message-service.test.ts -t 'idempotent'
bun test packages/rielflow/src/workflow/communication-service.test.ts packages/rielflow/src/workflow/manager-message-service.test.ts -t 'concurrent|same-key|race'
bun test packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts --test-name-pattern 'git commit|unresolved|git push'
rielflow workflow run codex-source-security-check-loop --variables '{"workflowInput":{"targetPath":".","runNetworkAudits":"false","maxFindings":50,"constraints":["Do not stage, commit, or push unless the user explicitly asks.","Do not revert unrelated dirty worktree changes.","Keep fixes narrowly scoped to verified security findings.","Focus on PR #54 / feature/sqlite-message-store changes, especially SQLite JSON validation, migration behavior, attachment paths, runtime DB writes, and documentation/skill edits."]}}' --output json --verbose --no-auto-improve
```

Additional focused checks:

```bash
git diff -- packages/rielflow/src/workflow/manager-message-service/idempotency.ts packages/rielflow/src/workflow/manager-session-store.ts packages/rielflow/src/workflow/communication-service.test.ts packages/rielflow/src/workflow/manager-message-service.test.ts impl-plans/completed/manager-control-idempotency-atomic-claim.md impl-plans/README.md
git status --short
```

## Completion Criteria

- [x] SEC-001 is fixed by atomically claiming
      `(mutationName, managerSessionId, idempotencyKey)` plus normalized request
      hash before side effects.
- [x] Different-hash conflicts are rejected before side effects execute.
- [x] Same-hash concurrent callers wait for or read the completed response
      instead of executing the action again.
- [x] Completed responses are not overwritten except from a caller-owned
      pending state with matching hash.
- [x] Targeted concurrent same-key regression coverage proves only one
      `sendManagerMessage` and one communication side effect persists.
- [x] Type checking passes with `bun run typecheck`.
- [x] Archived implementation-plan paths in workflow-generated
      `committedFiles` do not break the final git commit/push handoff.
- [x] Required verification commands pass or any failure is explicitly recorded.

## Progress Log

### Session: 2026-06-07 Step 4 Planning

**Tasks Completed**: Planning only
**Tasks In Progress**: None
**Blockers**: Runtime code still needs implementation in the later workflow step
**Notes**: Plan traces to accepted Step 3 design and keeps scope limited to
SEC-001. Progress updates should be appended after each implementation session
with task ids, verification commands, outcomes, and residual risks.

### Session: 2026-06-07 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004
**Tasks In Progress**: None
**Blockers**: `bun run packages/rielflow/src/bin.ts workflow run codex-source-security-check-loop --variables '{"workflowInput":{"targetPath":".","runNetworkAudits":"false","maxFindings":50,"constraints":["Do not stage, commit, or push unless the user explicitly asks.","Do not revert unrelated dirty worktree changes.","Keep fixes narrowly scoped to verified security findings.","Focus on PR #54 / feature/sqlite-message-store changes, especially SQLite JSON validation, migration behavior, attachment paths, runtime DB writes, and documentation/skill edits."]}}' --output json --verbose --no-auto-improve` started session `riel-codex-source-security-check-loop-1780824492-fb9a81ee` but stalled in Step 4 adversarial verification and was terminated to continue this assigned Step 6 handoff.
**Notes**: Implemented atomic pending/completed idempotency claims before manager-control side effects, same-hash pending wait/read behavior, different-hash conflict rejection, caller-token completion, legacy completed-row migration, and concurrent same-key regression coverage for `sendManagerMessage` and `replayCommunication`. Plan index entry was added to `impl-plans/PROGRESS.json`, addressing the Step 5 low finding about explicit progress-index handling.

Verification outcomes:

- Passed: `rg -n "loadIdempotentResult|runIdempotentMutation|saveIdempotentResult|claimIdempotentMutation|completeIdempotentMutation|ON CONFLICT\\(mutation_name" packages/rielflow/src/workflow/manager-message-service/idempotency.ts packages/rielflow/src/workflow/manager-session-store.ts`
- Passed: `bun run lint:biome`
- Passed: `bun run typecheck`
- Passed: `bun test packages/rielflow/src/workflow/communication-service.test.ts packages/rielflow/src/workflow/manager-message-service.test.ts -t 'idempotent'`
- Passed: `bun test packages/rielflow/src/workflow/communication-service.test.ts packages/rielflow/src/workflow/manager-message-service.test.ts -t 'concurrent|same-key|race'`
- Passed: `bun test packages/rielflow/src/workflow/manager-session-store.test.ts`
- Passed: `bun test packages/rielflow/src/workflow/communication-service.test.ts packages/rielflow/src/workflow/manager-message-service.test.ts`
- Partial: `bun run packages/rielflow/src/bin.ts workflow run codex-source-security-check-loop --variables '{"workflowInput":{"targetPath":".","runNetworkAudits":"false","maxFindings":50,"constraints":["Do not stage, commit, or push unless the user explicitly asks.","Do not revert unrelated dirty worktree changes.","Keep fixes narrowly scoped to verified security findings.","Focus on PR #54 / feature/sqlite-message-store changes, especially SQLite JSON validation, migration behavior, attachment paths, runtime DB writes, and documentation/skill edits."]}}' --output json --verbose --no-auto-improve` started `riel-codex-source-security-check-loop-1780824492-fb9a81ee`; Step 3 triage reported `needsFixAfterTriage=false` and no blocking findings, then Step 4 adversarial verification terminated with code `-1`.

### Session: 2026-06-07 Step 6 Adversarial Revision

**Tasks Completed**: Step 7 adversarial mid finding remediation
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed Step 7 adversarial review finding
`needs_revision_for_pending_claim_failure_recovery` by adding failed
idempotency state, `failIdempotentMutation`, stored JSON error replay, and
same-key failed-attempt regression tests for `sendManagerMessage` and
`replayCommunication`. Split idempotency schema/helpers into
`packages/rielflow/src/workflow/manager-session-store-idempotency.ts` to keep
`manager-session-store.ts` below the repository TypeScript source size limit.

Verification outcomes:

- Passed: `rg -n "loadIdempotentResult|runIdempotentMutation|saveIdempotentResult|claimIdempotentMutation|completeIdempotentMutation|failIdempotentMutation|ON CONFLICT\\(mutation_name" packages/rielflow/src/workflow/manager-message-service/idempotency.ts packages/rielflow/src/workflow/manager-session-store.ts packages/rielflow/src/workflow/manager-session-store-idempotency.ts`
- Passed: `bun run lint:biome`
- Passed: `bun run typecheck`
- Passed: `bun test packages/rielflow/src/workflow/communication-service.test.ts packages/rielflow/src/workflow/manager-message-service.test.ts -t 'failed same-key|pending timeout'`
- Passed: `bun test packages/rielflow/src/workflow/communication-service.test.ts packages/rielflow/src/workflow/manager-message-service.test.ts -t 'idempotent'`
- Passed: `bun test packages/rielflow/src/workflow/communication-service.test.ts packages/rielflow/src/workflow/manager-message-service.test.ts -t 'concurrent|same-key|race'`
- Passed: `bun test packages/rielflow/src/workflow/manager-session-store.test.ts packages/rielflow/src/workflow/communication-service.test.ts packages/rielflow/src/workflow/manager-message-service.test.ts`
- Passed: `jq empty impl-plans/PROGRESS.json`
- Passed: `git diff --check`

### Session: 2026-06-07 Step 8 Completion Check

**Tasks Completed**: Plan archive after Step 7 acceptance and Step 8 docs
refresh
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Step 7 adversarial review accepted SEC-001 as implemented with no
high or mid findings, and Step 8 documentation refresh completed. The plan was
moved from `impl-plans/active` to `impl-plans/completed`, and
`impl-plans/README.md` plus `impl-plans/PROGRESS.json` were updated so the
completed SEC-001 work no longer appears as active.

### Session: 2026-06-07 Commit Handoff Recurrence Guard

**Tasks Completed**: TASK-005
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The original workflow commit step failed because
`committedFiles` still referenced
`impl-plans/active/manager-control-idempotency-atomic-claim.md` after the plan
had been archived to `impl-plans/completed`. The built-in git commit add-on now
resolves that exact active-to-completed plan transition before `git add`,
rejects unresolved missing paths before invoking `git add`, and reads staged
file lists / commit hashes through git output files so Bun test child-process
stdout quirks do not hide git state. Git push commit hash resolution uses the
same output-file path, and branch resolution falls back to `.git/HEAD`.

Verification outcomes:

- Passed: `bun test packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts --test-name-pattern "git commit|unresolved|git push"`
- Passed: `bun run typecheck`
- Passed: `bun run lint:biome`
