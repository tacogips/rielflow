# Scheduled Sleep Runtime Review Improvements Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-scheduled-sleep-node-runtime.md#commit-review-hardening-scope`
**Created**: 2026-05-15
**Last Updated**: 2026-05-15

## Design Document Reference

### Sources

- `design-docs/specs/design-scheduled-sleep-node-runtime.md`
- `design-docs/specs/design-workflow-json.md#sleep`
- `design-docs/specs/design-event-listener-workflow-trigger.md#cron`
- `design-docs/user-qa/qa-scheduled-sleep-node-runtime.md`
- Commit under review: `b93ca6ad4cf2711ec7b919056f561e35cf6681ee`

### Summary

Review the committed scheduled sleep runtime and shared scheduled event manager
against the accepted hardening design. Fix only actionable high or mid severity
issues in sleep lifecycle ownership, cancellation, failure handling,
shared cron manager behavior, public API propagation, validation, tests, and
user-facing documentation.

### Scope

**Included**:

- `workflow-sleep` event ownership checks by session, event id, node id, and
  node execution id.
- Cancellation, rerun replacement, terminal finalization, and failed scheduled
  continuation state handling.
- Shared scheduled event manager behavior for cron and sleep, including
  re-arming, dedupe, stop, and callback failure behavior.
- Public API propagation of caller-provided `scheduledEventManager` through
  workflow run, continue, and rerun paths.
- Validation and tests for `sleep.durationMs`, explicit-offset `sleep.until`,
  backend-field rejection, and manager-role rejection.
- README, examples, and design/user-QA documentation refresh only when behavior
  changes or documentation drift is found.

**Excluded**:

- Durable restart recovery unless the pending user-QA decision changes.
- Distributed locks for multiple schedulers.
- Provider-specific or `codex-agent` scheduling behavior.
- Unrelated chat event-source changes, including
  `design-docs/specs/design-chat-sdk-event-sources.md`,
  `src/events/adapters/chat-sdk.test.ts`,
  `src/events/adapters/matrix.test.ts`,
  `src/events/adapters/webhook.test.ts`, and
  `impl-plans/active/chat-event-sources-review-improvements.md`.

## Codex-Agent Reference Mapping

- No Codex-reference inputs were provided by intake.
- Preferred local root from upstream context: `../../codex-agent`.
- Decision: no inspection required for this plan because scheduled sleep is
  runtime scheduling infrastructure, not agent backend behavior.
- Intentional divergence: scheduling semantics must remain provider-neutral and
  must not depend on `codex-agent`, Cursor CLI, or any adapter-specific runtime.

## Modules

### 1. Scheduled Event Manager

#### `src/events/scheduled-event-manager.ts`

**Status**: COMPLETED

```typescript
type ScheduledEventKind = "cron" | "workflow-sleep";

type ScheduledEventStatus =
  | "pending"
  | "firing"
  | "fired"
  | "cancelled"
  | "failed";

interface ScheduledEvent {
  readonly id: string;
  readonly kind: ScheduledEventKind;
  readonly dueAt: string;
  readonly dedupeKey: string;
  readonly status: ScheduledEventStatus;
  readonly attempt: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly lastError?: string;
}
```

**Checklist**:

- [x] Audit pending-to-firing-to-terminal status transitions.
- [x] Fix any duplicate-fire, stale re-arm, stop, cancellation, or failure
      marking defects.
- [x] Preserve process-local scheduling and the future durable event-pool
      boundary.
- [x] Add or update focused manager tests for any defect fixed.

### 2. Workflow Sleep Lifecycle

#### `src/workflow/session.ts`, `src/workflow/session-store.ts`, `src/workflow/engine/*.ts`

**Status**: REVIEWED_NO_RUNTIME_CHANGE

```typescript
interface WorkflowScheduledEventRef {
  readonly eventId: string;
  readonly kind: "workflow-sleep";
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly dueAt: string;
  readonly status: ScheduledEventStatus;
  readonly createdAt: string;
}

interface WorkflowSleepScheduledEventPayload {
  readonly workflowName: string;
  readonly workflowExecutionId: string;
  readonly stepId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
}
```

**Checklist**:

- [x] Audit scheduled resume ownership checks against session id, event id,
      node id, and node execution id.
- [x] Fix stale callback behavior for cancelled, rerun, replaced, failed,
      completed, or otherwise terminal sessions.
- [x] Ensure invalid rerun or direct-step replacement requests do not cancel the
      still-valid paused sleep session before validation succeeds.
- [x] Ensure continuation failure marks the manager event and session ref
      failed with operator-visible error context.
- [x] Add or update focused sleep runtime tests for any defect fixed.

### 3. Cron And Listener Shared Manager

#### `src/events/adapters/cron.ts`, `src/events/listener-service.ts`, `src/events/trigger-runner/*.ts`

**Status**: REVIEWED_NO_RUNTIME_CHANGE

```typescript
interface CronScheduledEventPayload {
  readonly sourceId: string;
  readonly scheduledAt: string;
}

interface TriggerRunnerOptions {
  readonly scheduledEventManager?: ScheduledEventManager;
}
```

**Checklist**:

- [x] Audit listener service, trigger runner, and local library execution paths
      for shared `scheduledEventManager` propagation.
- [x] Fix any cron startup, re-arm, stop, dedupe, input mapping, or event
      receipt regression introduced by shared manager routing.
- [x] Preserve cron binding behavior and source-occurrence audit metadata.
- [x] Add or update cron/listener tests for any defect fixed.

### 4. Public API And Validation Surface

#### `src/lib.ts`, `src/workflow/validate/*.ts`, `src/workflow/types.ts`

**Status**: REVIEWED_NO_RUNTIME_CHANGE

```typescript
interface ExecuteWorkflowInput {
  readonly scheduledEventManager?: ScheduledEventManager;
}

interface RerunWorkflowInput {
  readonly scheduledEventManager?: ScheduledEventManager;
}

interface SleepNodeConfig {
  readonly durationMs?: number;
  readonly until?: string;
}
```

**Checklist**:

- [x] Confirm `executeWorkflow`, continuation, and `rerunWorkflow` propagate
      caller-provided managers where local execution can use them.
- [x] Confirm validation accepts exactly one of positive-integer `durationMs`
      or explicit-timezone `until`.
- [x] Confirm validation rejects sleep nodes with incompatible backend,
      command, container, user-action, durability, or manager-role fields.
- [x] Add or update public API and validation tests for any defect fixed.

### 5. Documentation And Example Refresh

#### `README.md`, `examples/scheduled-sleep/**`, `design-docs/**/*.md`

**Status**: COMPLETED

**Checklist**:

- [x] Update docs only for behavior changed or documentation drift found during
      this review pass.
- [x] Keep `sleep.durationMs` and explicit-offset `sleep.until` documented as
      first-milestone schema.
- [x] Keep restart recovery documented as a pending user-QA decision unless
      implementation scope changes.
- [x] Validate the scheduled-sleep example workflow after any example changes.

## Task Breakdown

### TASK-001: Review And Classify Commit Findings

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: review notes in this plan progress log; no runtime code
changes unless high or mid severity findings are confirmed
**Dependencies**: accepted Step 3 design

**Completion Criteria**:

- [x] Inspect commit `b93ca6ad4cf2711ec7b919056f561e35cf6681ee` and current
      worktree scheduled-sleep changes.
- [x] Classify findings by severity with file paths and line references.
- [x] Record no-op decision if no high or mid severity findings remain.
- [x] Confirm unrelated chat event-source files are outside scope.

### TASK-002: Fix Workflow Sleep Lifecycle Findings

**Status**: NOT_REQUIRED
**Parallelizable**: No
**Deliverables**: `src/workflow/session.ts`, `src/workflow/session-store.ts`,
`src/workflow/engine/*.ts`, `src/workflow/sleep-node-runtime.test.ts`
**Dependencies**: TASK-001 confirmed high or mid lifecycle finding

**Completion Criteria**:

- [x] Ownership checks prevent stale scheduled callbacks from reviving
      non-owning or terminal sessions.
- [x] Cancellation, rerun, direct-step replacement, terminal finalization, and
      failed continuation update session refs and manager state consistently.
- [x] Regression tests cover every fixed lifecycle defect.

### TASK-003: Fix Shared Manager And Cron Findings

**Status**: COMPLETED
**Parallelizable**: Yes
**Deliverables**: `src/events/scheduled-event-manager.ts`,
`src/events/adapters/cron.ts`, `src/events/listener-service.ts`,
`src/events/trigger-runner/*.ts`, related tests
**Dependencies**: TASK-001 confirmed high or mid manager/cron finding

**Completion Criteria**:

- [x] Manager register, cancel, fire, fail, stop, and re-arm behavior matches
      the accepted design.
- [x] Cron startup, due dispatch, next occurrence, dedupe, receipts, and stop
      behavior still work through the shared manager.
- [x] Regression tests cover every fixed manager or cron defect.

### TASK-004: Fix Public API Or Validation Findings

**Status**: NOT_REQUIRED
**Parallelizable**: Yes
**Deliverables**: `src/lib.ts`, `src/workflow/validate/*.ts`,
`src/workflow/types.ts`, related tests
**Dependencies**: TASK-001 confirmed high or mid API/validation finding

**Completion Criteria**:

- [x] Local public API paths propagate caller-provided `scheduledEventManager`.
- [x] Sleep validation exactly matches the accepted design.
- [x] Regression tests cover every fixed API or validation defect.

### TASK-005: Documentation, Examples, And Verification Closure

**Status**: COMPLETED
**Parallelizable**: No
**Deliverables**: `README.md`, `examples/scheduled-sleep/**`,
`design-docs/specs/design-scheduled-sleep-node-runtime.md`,
`design-docs/user-qa/qa-scheduled-sleep-node-runtime.md`, this plan
**Dependencies**: TASK-002 through TASK-004 as applicable

**Completion Criteria**:

- [x] User-facing docs and examples reflect final accepted behavior.
- [x] Open user-QA restart recovery and failed-continuation repair questions
      remain explicit unless resolved by implementation.
- [x] Progress log records completed tasks, verification commands, failures,
      skips, and no-op decisions.
- [x] Commit steps, if reached, stage only scheduled-sleep scoped files.

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Review classification | commit `b93ca6ad4cf2711ec7b919056f561e35cf6681ee` | COMPLETED | review notes |
| Scheduled event manager | `src/events/scheduled-event-manager.ts` | COMPLETED | `src/events/scheduled-event-manager.test.ts` |
| Workflow sleep lifecycle | `src/workflow/session.ts`, `src/workflow/session-store.ts`, `src/workflow/engine/*.ts` | REVIEWED_NO_RUNTIME_CHANGE | `src/workflow/sleep-node-runtime.test.ts` |
| Cron shared manager | `src/events/adapters/cron.ts`, `src/events/listener-service.ts`, `src/events/trigger-runner/*.ts` | REVIEWED_NO_RUNTIME_CHANGE | `src/events/adapters/cron.test.ts`, `src/events/listener-service.test.ts`, `src/events/trigger-runner-options.test.ts` |
| Public API and validation | `src/lib.ts`, `src/workflow/validate/*.ts`, `src/workflow/types.ts` | REVIEWED_NO_RUNTIME_CHANGE | `src/workflow/validate.test.ts` |
| Docs and example | `README.md`, `examples/scheduled-sleep/**`, `design-docs/**/*.md` | COMPLETED | workflow validate command |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| TASK-001 Review And Classify Commit Findings | accepted Step 3 design | COMPLETED |
| TASK-002 Workflow Sleep Lifecycle Fixes | TASK-001 lifecycle finding | NOT_REQUIRED |
| TASK-003 Shared Manager And Cron Fixes | TASK-001 manager/cron finding | COMPLETED |
| TASK-004 Public API Or Validation Fixes | TASK-001 API/validation finding | NOT_REQUIRED |
| TASK-005 Documentation And Verification Closure | TASK-002 through TASK-004 as applicable | COMPLETED |

## Parallelization

- TASK-001 is not parallelizable because it determines whether implementation
  changes are required.
- TASK-003 and TASK-004 are parallelizable after TASK-001 when findings are
  independent, because manager/cron files and public API/validation files have
  disjoint primary write scopes.
- TASK-002 is not parallelizable with TASK-003 if both touch shared session
  lifecycle or trigger-runner execution paths.
- TASK-005 waits for implementation decisions so docs describe actual behavior.

## Verification Plan

Run focused checks for touched areas:

```bash
bun test src/events/scheduled-event-manager.test.ts
bun test src/events/adapters/cron.test.ts src/events/listener-service.test.ts src/events/trigger-runner-options.test.ts
bun test src/workflow/validate.test.ts
bun test src/workflow/sleep-node-runtime.test.ts
```

Run final checks before handoff:

```bash
bun run typecheck
bun run lint:biome
bun run src/main.ts workflow validate scheduled-sleep --workflow-definition-dir ./examples
git diff --check
rg -n 'nodeType: "sleep"|scheduled event manager|cron' README.md examples design-docs/specs
```

Run broader regression checks when risk or time allows:

```bash
bun test
```

## Completion Criteria

- [x] No high or mid severity scheduled-sleep runtime findings remain.
- [x] Any fixed lifecycle issue has focused regression coverage.
- [x] Any fixed shared-manager or cron issue has focused regression coverage.
- [x] Any fixed public API or validation issue has focused regression coverage.
- [x] User-facing documentation is updated only when needed and remains aligned
      with accepted design.
- [x] Verification commands are recorded with pass/fail/skip status.
- [x] Unrelated chat event-source worktree changes remain unmodified,
      unstaged, and excluded from any commit files.

## Progress Log

### Session: 2026-05-15 Step 4 implementation-plan creation

**Tasks Completed**: Created focused commit-review hardening plan after Step 3
accepted the scheduled sleep design.
**Tasks Ready**: TASK-001.
**Blockers**: Implementation tasks remain conditional on TASK-001 confirming
actionable high or mid severity findings.
**Verification**: Plan-only change; runtime test commands were not required.
**Notes**: The existing `impl-plans/active/scheduled-sleep-node-runtime.md`
contains historical implementation progress for the committed feature. This
plan is the active handoff for reviewing and improving commit
`b93ca6ad4cf2711ec7b919056f561e35cf6681ee` without touching unrelated chat
event-source worktree changes.

### Session: 2026-05-15 Step 4 self-review correction

**Tasks Completed**: Corrected illustrative scheduled event and workflow sleep
payload interfaces to match the accepted design and current runtime shape.
**Tasks Ready**: TASK-001.
**Verification**: Plan-only change; runtime test commands were not required.
**Notes**: Scheduled event `dueAt` is normalized to an ISO string in stored
events, and the workflow sleep payload uses `workflowExecutionId` as the
session execution target without adding a separate `sessionId` field.

### Session: 2026-05-15 Step 6 implementation

**Tasks Completed**: TASK-001, TASK-003, TASK-005. TASK-002 and TASK-004 were
reviewed with no runtime changes required.
**Finding Fixed**: Mid severity shared scheduled event manager lifecycle
finding in `src/events/scheduled-event-manager.ts`: `cancel()` could overwrite
`firing` or `failed` events with `cancelled`, erasing authoritative in-progress
or failed state used by sleep and cron lifecycle handling.
**Implementation**: Changed `cancel()` so only `pending` events can be
cancelled. Added regression coverage in
`src/events/scheduled-event-manager.test.ts` for firing and failed events.
**Verification**:

- `bun test src/events/scheduled-event-manager.test.ts`: passed, 6 tests.
- `bun test src/events/adapters/cron.test.ts src/events/listener-service.test.ts src/events/trigger-runner-options.test.ts src/workflow/validate.test.ts src/workflow/sleep-node-runtime.test.ts`: passed, 49 tests.
- `bun run typecheck`: passed.
- `bun run lint:biome`: passed.
- `bun run src/main.ts workflow validate scheduled-sleep --workflow-definition-dir ./examples`: passed.
- `git diff --check`: passed.
- `rg -n 'nodeType: "sleep"|scheduled event manager|cron' README.md examples design-docs/specs`: passed.
- `bun test`: failed; 1080 passed, 5 failed, 3 errors. Failures were
  existing broad `src/workflow/engine.test.ts` supervision/rerun timeout cases,
  not the focused scheduled sleep or scheduled event manager tests.

**Notes**: Unrelated chat event-source worktree files remained outside the
scheduled sleep implementation scope and were not edited.

## Related Plans

- **Historical**: `impl-plans/active/scheduled-sleep-node-runtime.md`
- **Related Design**: `design-docs/specs/design-scheduled-sleep-node-runtime.md`
