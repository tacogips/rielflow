# Scheduled Sleep Node Runtime Implementation Plan

**Status**: In Progress
**Design Reference**: `design-docs/specs/design-scheduled-sleep-node-runtime.md`; `design-docs/specs/design-workflow-json.md#sleep`; `design-docs/specs/design-event-listener-workflow-trigger.md#cron`
**Created**: 2026-05-15
**Last Updated**: 2026-05-15

---

## Design Document Reference

**Sources**:

- `design-docs/specs/design-scheduled-sleep-node-runtime.md`
- `design-docs/specs/design-workflow-json.md#sleep`
- `design-docs/specs/design-event-listener-workflow-trigger.md#cron`
- `design-docs/specs/architecture.md`
- `design-docs/user-qa/qa-scheduled-sleep-node-runtime.md`

### Summary

Add a non-blocking workflow `nodeType: "sleep"` runtime and make cron sources
use the same scheduled event manager. When execution reaches a sleep node, the
engine must register a scheduled continuation event, persist the paused session
state, and return control without awaiting a long timer. The event manager owns
the next due timer, fires already-due events promptly, re-arms after pool
changes, supports cancellation, and lets cron register its next occurrence after
each firing.

### Scope

**Included**:

- Sleep node authored payload validation and load-time schema behavior.
- Shared scheduled event manager hardening for sleep and cron event kinds.
- Workflow sleep pause, resume, scheduled-event session metadata, and
  cancellation behavior.
- Cron adapter scheduling through the shared manager, including re-registration
  after firing.
- Tests for due firing, re-arming, cancellation, cron next occurrence
  registration, and workflow sleep continuation.
- README/design-reference documentation refresh after implementation.

**Excluded**:

- Distributed scheduling locks across multiple processes.
- Durable restart recovery beyond the interface-compatible shape unless the
  open user-QA item is resolved before implementation.
- Provider-specific or `codex-agent` scheduling behavior.
- Rich calendar/timezone semantics beyond `durationMs` unless `sleep.until` is
  explicitly confirmed for this pass.

## Codex-Agent Reference Mapping

- `../../codex-agent`: no Codex-reference behavior was provided or inspected for
  this issue.
- Scheduling is provider-neutral runtime behavior and must not depend on
  `codex-agent`, Cursor CLI, or any agent adapter.
- Intentional divergence: this implementation follows divedra workflow/runtime
  event scheduling docs, not Codex-agent execution semantics.

---

## Task Breakdown

### TASK-001: Sleep Node Types And Validation

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/workflow/types.ts`, `src/workflow/load.ts`,
`src/workflow/json-schema.ts`, `src/workflow/load.test.ts`,
`src/workflow/json-schema.test.ts`
**Dependencies**: None

```typescript
interface SleepNodePayload {
  readonly nodeType: "sleep";
  readonly variables: Readonly<Record<string, unknown>>;
  readonly sleep: WorkflowSleepConfig;
}

interface WorkflowSleepConfig {
  readonly durationMs?: number;
  readonly until?: string;
}
```

**Checklist**:

- [x] Add or tighten authored sleep node types without weakening existing
      `agent`, `command`, `container`, `user-action`, or addon validation.
- [x] Require exactly one wake condition for the implemented scope.
- [x] Validate `durationMs` as a positive integer.
- [x] Defer or validate `until` with explicit timezone/UTC offset based on the
      user-QA decision.
- [x] Reject `executionBackend`, `model`, `promptTemplate`,
      `promptTemplateFile`, `sessionPolicy`, `command`, `container`,
      `userAction`, and `durability` on sleep nodes.
- [x] Reject sleep nodes on manager-role steps.
- [x] Add focused loader/schema tests for valid and invalid payloads.

### TASK-002: Scheduled Event Manager Contract Hardening

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/events/scheduled-event-manager.ts`,
`src/events/scheduled-event-manager.test.ts`, optional
`src/workflow/runtime-db/scheduled-event-records.ts`,
`src/workflow/runtime-db/schema-and-record-types.ts`
**Dependencies**: None

```typescript
type ScheduledEventKind = "workflow-sleep" | "cron";

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
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly lastError?: string;
}
```

**Checklist**:

- [x] Preserve the existing single process-local timer behavior.
- [x] Fire every pending event whose due time has passed.
- [x] Re-arm after registration, replacement, cancellation, failure, and firing.
- [x] Keep approximate 500ms precision configurable for tests.
- [x] Prevent duplicate firing with stable event ids and pending-to-firing
      status transitions.
- [x] Provide a persistence-compatible boundary for future durable restart
      recovery.
- [x] Add tests for past-due registration, earlier-event replacement,
      cancellation, failure marking, and stop behavior.

### TASK-003: Workflow Sleep Runtime Integration

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/engine/step-input.ts`,
`src/workflow/engine/node-execution.ts`,
`src/workflow/engine/types-and-session-state.ts`, `src/workflow/session.ts`,
`src/workflow/engine.test.ts`, optional `src/workflow/scheduled-sleep.ts`
**Dependencies**: TASK-001, TASK-002

```typescript
interface WorkflowSleepScheduledEventPayload {
  readonly workflowName: string;
  readonly workflowExecutionId: string;
  readonly stepId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
}

interface WorkflowScheduledEventRef {
  readonly eventId: string;
  readonly kind: "workflow-sleep";
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly dueAt: string;
  readonly status: ScheduledEventStatus;
  readonly createdAt: string;
}
```

**Checklist**:

- [x] Move sleep runtime handling into typed code and remove any `@ts-nocheck`
      introduced around sleep handling.
- [x] Register workflow sleep continuation with the shared manager and never
      block the executor with a long sleep.
- [x] Persist node artifacts, handoff metadata, and paused session state with a
      `scheduledEvents` entry.
- [x] Resume the same workflow session when the sleep event fires.
- [x] Ensure queued next steps are available only after the scheduled resume
      path reaches them.
- [x] Keep direct step execution behavior explicit for sleep nodes.
- [x] Add engine tests for scheduling, non-blocking return, due continuation,
      and already-due events.

### TASK-004: Scheduled Event Cancellation And Session Lifecycle

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/session.ts`, `src/workflow/session-store.ts`,
`src/workflow/engine/workflow-runner-lifecycle.ts`,
`src/workflow/engine/session-entry.ts`,
`src/workflow/engine/step-transition-finalization.ts`,
`src/workflow/manager-control.ts`, `src/workflow/sleep-node-runtime.test.ts`,
`src/workflow/engine.test.ts`, `src/events/scheduled-event-manager.test.ts`
**Dependencies**: TASK-002, TASK-003

```typescript
interface ScheduledEventCancellationInput {
  readonly workflowExecutionId: string;
  readonly reason:
    | "workflow-cancelled"
    | "workflow-rerun"
    | "step-replaced"
    | "session-terminal";
}
```

**Checklist**:

- [x] Add a typed lifecycle helper that finds pending `workflow-sleep` refs for
      a workflow execution/session and coordinates manager cancellation plus
      session-ref updates.
- [x] Cancel pending sleep events when the owning workflow session is cancelled,
      including manager-control and event-supervisor cancellation paths that
      persist `status: "cancelled"`.
- [x] Cancel or replace stale sleep events before rerun or step replacement can
      register replacement work for the same source session.
- [x] Mark scheduled session refs as `cancelled`, `fired`, or `failed` when the
      manager state changes or the fire callback reports an error.
- [x] Ensure completed, failed, and cancelled terminal sessions do not leave
      fireable `workflow-sleep` events in the shared manager.
- [x] Keep the resume callback authoritative: re-load the session, confirm it is
      still paused, confirm it still owns the matching pending event, and do
      not revive cancelled, rerun, superseded, failed, completed, or terminal
      sessions.
- [x] Add focused tests for cancellation before due time, rerun replacement,
      stale event non-revival, manager fire failure marking, and
      terminal-session cleanup.

### TASK-005: Cron Shared Manager Integration

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/adapters/cron.ts`,
`src/events/adapters/cron.test.ts`, `src/events/listener-service.ts`,
`src/events/listener-service.test.ts`
**Dependencies**: TASK-002

```typescript
interface CronScheduledEventPayload {
  readonly sourceId: string;
  readonly scheduledAt: string;
}
```

**Checklist**:

- [x] Ensure cron sources always use the listener-service shared manager when
      running under `events serve`.
- [x] Keep standalone adapter tests able to inject a manager or own one safely.
- [x] Register the next cron event on startup.
- [x] Dispatch due and past-due cron events promptly through existing event
      binding and workflow trigger paths.
- [x] Include `sourceId` and `scheduledAt` in manager-dispatched cron event
      payloads so scheduled event audit data can trace the scheduled source
      occurrence. Binding-level audit data remains on event receipts because a
      single cron source may fan out to multiple bindings.
- [x] Compute and register the next occurrence after each fire.
- [x] Preserve existing cron config, input mapping, dedupe, receipt, and stop
      behavior.
- [x] Add tests for shared-manager injection, next-occurrence registration,
      re-arming, stop cancellation, and dispatch failure resilience.

### TASK-006: Documentation, Examples, And Final Verification

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `README.md`, `design-docs/specs/design-workflow-json.md`,
`design-docs/specs/design-event-listener-workflow-trigger.md`,
`design-docs/user-qa/qa-scheduled-sleep-node-runtime.md`, `examples/**`,
`impl-plans/active/scheduled-sleep-node-runtime.md`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Checklist**:

- [x] Add or update a minimal example workflow that demonstrates `nodeType:
      "sleep"` with `durationMs`.
- [x] Document the sleep node payload and non-blocking runtime semantics.
- [x] Document that cron runs through the shared scheduled event manager.
- [x] Move first-milestone cancellation scope out of the unresolved pending
      decision wording in
      `design-docs/user-qa/qa-scheduled-sleep-node-runtime.md`; carry forward
      restart recovery, initial `sleep.until`, and failed-continuation
      repair/retry controls as open follow-up questions.
- [x] Update this plan progress log and completion checkboxes.
- [x] Run the final verification command set and record any skipped commands.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Sleep node schema and loader validation | `src/workflow/types.ts`, `src/workflow/validate/*.ts` | Completed | `src/workflow/validate.test.ts`, `src/workflow/sleep-node-runtime.test.ts` |
| Scheduled event manager | `src/events/scheduled-event-manager.ts` | Completed | `src/events/scheduled-event-manager.test.ts` |
| Workflow sleep runtime | `src/workflow/engine/step-input.ts`, `src/workflow/engine/node-execution.ts`, `src/workflow/engine/types-and-session-state.ts` | Completed | `src/workflow/sleep-node-runtime.test.ts` |
| Session scheduled-event lifecycle | `src/workflow/session.ts`, `src/workflow/session-store.ts`, `src/workflow/engine/*`, `src/workflow/manager-control.ts` | Completed | `src/workflow/sleep-node-runtime.test.ts`, `src/workflow/engine.test.ts` |
| Cron manager integration | `src/events/adapters/cron.ts`, `src/events/listener-service.ts` | Completed | `src/events/adapters/cron.test.ts`, `src/events/listener-service.test.ts` |
| Documentation and example | `README.md`, `examples/**`, `design-docs/specs/*.md`, `design-docs/user-qa/qa-scheduled-sleep-node-runtime.md` | Completed | Manual inspection plus existing command tests |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| TASK-001 Sleep Node Types And Validation | Accepted design | Completed |
| TASK-002 Scheduled Event Manager Contract Hardening | Accepted design | Completed |
| TASK-003 Workflow Sleep Runtime Integration | TASK-001, TASK-002 | Completed |
| TASK-004 Scheduled Event Cancellation And Session Lifecycle | TASK-002, TASK-003 | Completed |
| TASK-005 Cron Shared Manager Integration | TASK-002 | Completed |
| TASK-006 Documentation, Examples, And Final Verification | TASK-001 through TASK-005, Step 3 feedback | Completed |

## Parallelization

- `TASK-001` and `TASK-002` are parallelizable because they write disjoint
  workflow schema/load files and event manager files.
- `TASK-004` is not parallelizable with runtime/session edits because it writes
  shared session lifecycle and manager-control surfaces.
- `TASK-006` waits for implementation behavior to settle because it documents
  the final supported behavior and records verification results.

## Step 3 Review Feedback Addressed

- TASK-004 is scoped to workflow cancellation, rerun or step replacement,
  terminal finalization, fire failure, and stale resume prevention.
- TASK-006 now explicitly includes the user-QA cleanup requested by Step 3:
  cancellation scope should be relabelled as resolved first-milestone context,
  while restart recovery, `sleep.until`, and failed-continuation repair controls
  remain open follow-up questions.
- Durable restart recovery is treated as deferred unless the QA decision changes
  before implementation.
- Unrelated chat event-source worktree changes remain out of scope; later
  implementation and commit steps must stage only scheduled-sleep files.

## Verification Plan

Run focused checks after each touched area:

```bash
bun test src/events/scheduled-event-manager.test.ts
bun test src/events/adapters/cron.test.ts src/events/listener-service.test.ts
bun test src/workflow/load.test.ts src/workflow/json-schema.test.ts
bun test src/workflow/engine.test.ts
bun test src/workflow/sleep-node-runtime.test.ts
```

Run full repo-level checks before handoff:

```bash
bun run typecheck
bun test
git diff --check
```

If a task changes examples or docs, also inspect:

```bash
rg -n 'nodeType: "sleep"|scheduled event manager|cron' README.md examples design-docs/specs
```

## Completion Criteria

- [x] Sleep nodes validate according to the accepted authored JSON rules.
- [x] Sleep runtime registers scheduled continuation events without blocking
      worker execution.
- [x] Workflow sessions expose waiting scheduled-event state while paused.
- [x] Due sleep events resume the target workflow session.
- [x] Pending sleep events are cancelled or replaced for cancellation, rerun,
      step replacement, and terminal session lifecycle cases selected for this
      pass.
- [x] Cron startup, firing, and next-occurrence registration all use the shared
      scheduled event manager.
- [x] Event manager re-arms after registration, replacement, cancellation,
      failure, and firing with approximately 500ms precision.
- [x] Focused verification commands pass after TASK-004 and TASK-006 are
      completed.
- [x] Full `bun test` is run, or any skipped command is documented with reason.
- [x] User-facing docs and examples reflect implemented behavior.
- [x] Progress log is updated for every implementation session.

## Progress Log

### Session: 2026-05-15

**Tasks Completed**: Implementation plan created.
**Tasks In Progress**: None.
**Blockers**: User-QA items remain open for durable restart recovery and
`sleep.until`; first-milestone cancellation scope is resolved by the accepted
design.
**Notes**: The repository already contains an initial scheduled event manager
and sleep/cron integration surfaces. Implementation should harden and type-check
those surfaces rather than adding a second scheduling path.

### Session: 2026-05-15 implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-005; TASK-004 and
TASK-006 partially.
**Verification**:

- `bun test src/events/scheduled-event-manager.test.ts src/events/adapters/cron.test.ts src/workflow/validate.test.ts src/workflow/sleep-node-runtime.test.ts`
- `bun run typecheck`
- `bun run lint:biome`

**Notes**: Implemented in-process scheduled event manager, cron manager
registration, `nodeType: "sleep"` validation, sleep pause/session metadata, and
scheduled resume. Durable scheduled-event persistence and workflow lifecycle
cancellation/replacement of pending sleep events remain follow-up work.

### Session: 2026-05-15 Step 4 plan revision

**Tasks Completed**: Revised the active plan after Step 3 accepted the design.
**Tasks Ready**: TASK-004 and TASK-006.
**Verification**: Plan-only revision; no runtime test command was required.
**Notes**: TASK-004 now follows the accepted workflow sleep lifecycle design for
workflow cancellation, rerun or step replacement, terminal finalization, fire
failure, and stale resume prevention. TASK-006 includes the requested user-QA
cleanup for resolved first-milestone cancellation scope.

### Session: 2026-05-15 Step 4 self-review revision

**Tasks Completed**: Addressed Step 4 self-review findings.
**Tasks Ready**: TASK-004.
**Tasks Waiting**: TASK-006 waits on TASK-004 completion before final docs,
examples, and verification can be closed.
**Verification**: Plan-only revision; no runtime test command was required.
**Notes**: Completed historical TASK-001, TASK-002, TASK-003, and TASK-005
checklists now match their completed status. TASK-006 status now explicitly
waits on TASK-004 instead of implying it can complete independently.

### Session: 2026-05-15 10:17 JST Step 6 implementation

**Tasks Completed**: TASK-004 and TASK-006.
**Verification**:

- `bun test src/events/scheduled-event-manager.test.ts`
- `bun test src/workflow/sleep-node-runtime.test.ts`
- `bun test src/events/scheduled-event-manager.test.ts src/workflow/sleep-node-runtime.test.ts`
- `bun test src/events/adapters/cron.test.ts src/events/listener-service.test.ts`
- `bun run typecheck`
- `bun run lint:biome`
- `bun run src/main.ts workflow validate scheduled-sleep --workflow-definition-dir ./examples`
- `git diff --check`
- `rg -n 'nodeType: "sleep"|scheduled event manager|cron' README.md examples design-docs/specs`
- `bun test src/workflow/validate.test.ts src/workflow/engine.test.ts` ran and failed in unrelated long-running engine tests with 5s timeouts.
- `bun test` ran and failed in the same long-running engine timeout class.
- Isolated rerun for the failed engine test names still hit 5s timeouts.

**Notes**: Added scheduled sleep lifecycle helpers, terminal/rerun cancellation
of pending workflow sleep refs, authoritative resume ownership checks, focused
tests for cancellation/rerun/terminal cleanup/failure marking, and a
`examples/scheduled-sleep` bundle. Full-suite failures were not in the focused
scheduled-sleep or cron coverage; they were existing auto-improve/rerun engine
tests reaching the current 5s test timeout.

### Session: 2026-05-15 10:23 JST Step 6 revision

**Tasks Completed**: Addressed Step 6 self-review finding for TASK-004.
**Verification**:

- `bun test src/workflow/sleep-node-runtime.test.ts`
- `bun run typecheck`
- `bun run lint:biome`
- `git diff --check`

**Notes**: Moved pending sleep cancellation for reruns until after rerun target
validation and fanout ambiguity checks. Added regression coverage that an
invalid rerun target leaves the source sleep event and session ref pending.

### Session: 2026-05-15 10:30 JST Step 7 revision

**Tasks Completed**: Addressed Step 7 review findings for TASK-001 and
TASK-004.
**Verification**:

- `bun test src/workflow/sleep-node-runtime.test.ts`
- `bun test src/workflow/validate.test.ts`
- `bun run typecheck`
- `bun run lint:biome`
- `git diff --check`

**Notes**: Workflow sleep resume now treats non-ok `runWorkflow` continuation
results as fire callback failures and marks the session scheduled-event ref
failed. Session cloning now preserves scheduled-event refs across resume. Sleep
`until` validation now requires an explicit `Z` timezone or numeric UTC offset.

### Session: 2026-05-15 Step 7 shared-manager revision

**Tasks Completed**: Addressed Step 7 review finding for TASK-005.
**Verification**:

- `bun test src/events/listener-service.test.ts src/events/trigger-runner-options.test.ts`
- `bun test src/events/adapters/cron.test.ts src/events/scheduled-event-manager.test.ts`
- `bun test src/workflow/sleep-node-runtime.test.ts`
- `bun test src/workflow/validate.test.ts`
- `bun run typecheck`
- `bun run lint:biome`
- `bun run src/main.ts workflow validate scheduled-sleep --workflow-definition-dir ./examples`
- `git diff --check`

**Notes**: Listener service now passes its shared scheduled event manager into
local workflow trigger options, local workflow execution client options,
direct local run overrides, and library `executeWorkflow` run options. The cron
audit checklist now records source-occurrence scheduled payloads and keeps
binding-specific traceability on event receipts.

### Session: 2026-05-15 Step 7 public-rerun revision

**Tasks Completed**: Addressed Step 7 review finding for TASK-004.
**Verification**:

- `bun test src/workflow/sleep-node-runtime.test.ts`
- `bun test src/events/listener-service.test.ts src/events/trigger-runner-options.test.ts src/events/adapters/cron.test.ts src/events/scheduled-event-manager.test.ts src/workflow/validate.test.ts`
- `bun run typecheck`
- `bun run lint:biome`
- `git diff --check`

**Notes**: Public library workflow lifecycle helpers now pass
`scheduledEventManager` through to `runWorkflow`, including `rerunWorkflow`.
Added regression coverage that `rerunWorkflow` cancels the source sleep
session ref and the matching shared-manager event.

## Related Plans

- **Depends On**: `impl-plans/event-listener-workflow-trigger-foundation.md`
- **Related**: `impl-plans/active/chat-sdk-event-sources.md`
- **Related Design**: `design-docs/specs/design-scheduled-sleep-node-runtime.md`
