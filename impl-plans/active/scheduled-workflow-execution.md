# Scheduled Workflow Execution Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-scheduled-workflow-execution.md#runtime-flow`
**Created**: 2026-05-18
**Last Updated**: 2026-05-18

---

## Design Document Reference

**Source**: `design-docs/specs/design-scheduled-workflow-execution.md`

### Section Map

| Plan Area | Accepted Design Section |
| --------- | ----------------------- |
| Runtime sequence | `design-docs/specs/design-scheduled-workflow-execution.md#runtime-flow` |
| Chat registration workflow | `design-docs/specs/design-scheduled-workflow-execution.md#schedule-registration-workflow` |
| Workflow name resolution | `design-docs/specs/design-scheduled-workflow-execution.md#workflow-catalog-resolution` |
| Schedule persistence | `design-docs/specs/design-scheduled-workflow-execution.md#schedule-registry` |
| Due event contract | `design-docs/specs/design-scheduled-workflow-execution.md#scheduled-event-contract` |
| Due dispatch route | `design-docs/specs/design-scheduled-workflow-execution.md#event-binding-and-execution` |
| Chat replies and clarification safety | `design-docs/specs/design-scheduled-workflow-execution.md#chat-replies`, `design-docs/specs/design-scheduled-workflow-execution.md#validation-rules` |
| CLI/operator commands | `design-docs/specs/design-scheduled-workflow-execution.md#cli-and-operator-surface` |
| Restart policy | `design-docs/specs/design-scheduled-workflow-execution.md#missed-runs-and-restart-policy` |

### Summary

Implement chat-created workflow schedules. A chat event starts a schedule-registration workflow, the runtime validates the structured schedule intent against the workflow catalog, persists a durable schedule record, enqueues the next `workflow-schedule` occurrence, and later dispatches due executions through the existing event receipt and trigger-runner path.

### Scope

**Included**:

- Durable workflow schedule registry under the runtime data root.
- `workflow-schedule` support in the shared scheduled event manager.
- Runtime validation for one-time and recurring schedule intents.
- Event trigger-runner integration for schedule-registration workflow output.
- `workflow.schedule.due` envelope construction and due dispatch through event receipts.
- Startup rehydration for processes that create the event listener service.
- `events schedules list|inspect|cancel` operator commands.
- Focused tests and docs/examples refresh.

**Excluded**:

- Manual CLI schedule creation.
- Distributed multi-process locking.
- Provider-specific slash command/button semantics.
- Any `codex-agent` or `cursor-cli-agent` scheduling behavior.
- Catch-up of every missed recurring occurrence.

### Review Feedback Addressed

- Step 3 low finding: verification now consistently uses `events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events` so checked-in example workflows are available during event validation.
- Step 5 mid finding: TASK-005 now picks generated internal scheduler bindings as the concrete due-dispatch route and assigns receipt, dedupe, input mapping, replay/read-only, and recurring re-arm ownership.
- Step 5 mid finding: TASK-003 and TASK-004 now require safe clarification reply destination validation before schedule persistence.
- Step 5 low finding: section-level design references are listed above for implementer traceability.

---

## Codex And Backend Reference

- `../../codex-agent`: unavailable; `test -d ../../codex-agent` failed in Step 3.
- Decision: scheduling is provider-neutral divedra event-runtime behavior. `codex-agent` remains only an execution backend for target workflow nodes and is not a source of schedule semantics.
- Intentional divergence: no Cursor-specific or Codex-specific schedule parsing, persistence, or execution rules are introduced.

---

## Modules

### 1. Schedule Registry And Runtime Types

#### `packages/divedra-events/src/types.ts`
#### `src/events/workflow-schedule-registry.ts`
#### `src/workflow/runtime-db/schema-and-record-types.ts`
#### `src/workflow/runtime-db/event-records.ts`
#### `src/events/index.ts`

**Status**: COMPLETED

```typescript
export type WorkflowScheduleKind = "one-time" | "recurring";

export type WorkflowScheduleStatus =
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export interface WorkflowScheduleRecord {
  readonly scheduleId: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly sourceReceiptId: string;
  readonly workflowName: string;
  readonly workflowSource?: WorkflowUsageSource;
  readonly kind: WorkflowScheduleKind;
  readonly timezone: string;
  readonly dueAt?: string;
  readonly cron?: string;
  readonly nextDueAt: string;
  readonly status: WorkflowScheduleStatus;
  readonly workflowInput: Readonly<Record<string, unknown>>;
  readonly conversationId?: string;
  readonly threadId?: string;
  readonly actorId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastExecutionId?: string;
  readonly lastFiredAt?: string;
  readonly attemptCount: number;
  readonly lastError?: string;
}

export interface WorkflowScheduleRepository {
  create(input: WorkflowScheduleCreateInput): Promise<WorkflowScheduleRecord>;
  load(scheduleId: string): Promise<WorkflowScheduleRecord | null>;
  list(input?: WorkflowScheduleListInput): Promise<readonly WorkflowScheduleRecord[]>;
  loadActive(): Promise<readonly WorkflowScheduleRecord[]>;
  cancel(input: WorkflowScheduleCancelInput): Promise<WorkflowScheduleRecord>;
  markFiring(input: WorkflowScheduleOccurrenceInput): Promise<WorkflowScheduleRecord>;
  markCompleted(input: WorkflowScheduleCompletionInput): Promise<WorkflowScheduleRecord>;
  markFailed(input: WorkflowScheduleFailureInput): Promise<WorkflowScheduleRecord>;
}
```

**Checklist**:

- [x] Add schedule status/kind and registry input/output interfaces.
- [x] Add runtime DB table, indexes, migrations, and record mappers.
- [x] Persist JSON workflow input/source metadata with validation on read/write.
- [x] Export public event schedule registry helpers from `src/events/index.ts`.
- [x] Unit tests cover create, list, load active, cancel, mark firing/completed/failed.

### 2. Shared Scheduled Event Manager Extension

#### `src/events/scheduled-event-manager.ts`
#### `src/events/workflow-schedule-dispatch.ts`
#### `src/events/adapters/cron.ts`
#### `src/workflow/engine/step-input.ts`

**Status**: COMPLETED

```typescript
export type ScheduledEventKind = "cron" | "workflow-sleep" | "workflow-schedule";

export interface WorkflowScheduleDuePayload {
  readonly scheduleId: string;
  readonly occurrenceId: string;
  readonly workflowName: string;
  readonly scheduledAt: string;
  readonly timezone: string;
  readonly kind: WorkflowScheduleKind;
  readonly sourceId: string;
  readonly bindingId: string;
}

export interface WorkflowScheduleDueRegistration {
  readonly schedule: WorkflowScheduleRecord;
  readonly occurrenceId: string;
  readonly dueAt: string;
  readonly dispatch: (event: ExternalEventEnvelope) => Promise<void>;
}
```

**Checklist**:

- [x] Extend scheduled event kind set with `workflow-schedule`.
- [x] Build stable occurrence ids and dedupe keys from schedule id plus due timestamp.
- [x] Add helper to register the next due event for one schedule.
- [x] Preserve existing cron and workflow-sleep behavior.
- [x] Unit tests cover event ordering, replacement, cancellation, duplicate id behavior, and failure status.

### 3. Schedule Intent Validation And Workflow Resolution

#### `src/events/workflow-schedule-registration.ts`
#### `src/events/supervisor-llm-resolver.ts`
#### `src/workflow/usage.ts`
#### `src/workflow/catalog.ts`

**Status**: COMPLETED

```typescript
export type WorkflowScheduleRegistrationDecision =
  | WorkflowScheduleReadyDecision
  | WorkflowScheduleClarificationDecision
  | WorkflowScheduleRefusalDecision;

export interface WorkflowScheduleReadyDecision {
  readonly status: "ready";
  readonly workflowName: string;
  readonly confidence?: number;
  readonly schedule: WorkflowScheduleIntent;
  readonly workflowInput: Readonly<Record<string, unknown>>;
  readonly confirmationText: string;
}

export interface WorkflowScheduleClarificationDecision {
  readonly status: "needs-clarification";
  readonly missing: readonly string[];
  readonly candidates?: readonly WorkflowScheduleCandidate[];
  readonly question: string;
}

export interface WorkflowScheduleRegistrationValidator {
  validate(input: WorkflowScheduleRegistrationValidationInput): Promise<WorkflowScheduleRegistrationValidationResult>;
}
```

**Checklist**:

- [x] Parse adapter-wrapped or raw resolver `payload` output.
- [x] Validate workflow resolution against `buildWorkflowUsageCatalog()` and `buildWorkflowUsageSummary()`.
- [x] Require clarification for ambiguous workflow, missing timezone, invalid cron, missing required workflow input, and unsafe input shape.
- [x] Reject schedule persistence when clarification may be needed but the source/binding cannot resolve a safe reply destination.
- [x] Reuse existing cron parser/timezone helpers for recurring schedules.
- [x] Unit tests cover ready, clarification, refusal, invalid output, ambiguous workflow, and missing safe reply destination cases.

### 4. Chat Registration Trigger-Runner Integration

#### `packages/divedra-events/src/types.ts`
#### `src/events/trigger-runner/trigger-dispatch-runner.ts`
#### `src/events/trigger-runner/sticky-dispatch-planning.ts`
#### `src/events/trigger-runner-replies.ts`
#### `src/events/validate.ts`
#### `src/events/validate-task-planning.ts`

**Status**: COMPLETED

```typescript
export interface EventWorkflowScheduleRegistrationPolicy extends JsonObject {
  readonly mode: "schedule-registration";
  readonly resolverWorkflowName: string;
  readonly resolverNodeId: string;
  readonly minConfidence?: number;
}

export type EventExecutionMode =
  | "direct"
  | "supervised"
  | "supervisor-dispatch"
  | "schedule-registration";
```

**Checklist**:

- [x] Add validation for `execution.mode = "schedule-registration"`.
- [x] Keep resolver input and timezone-relevant event fields on binding
      `inputMapping`; do not expose `execution.inputPath` or
      `execution.timezonePath` as schedule-registration policy fields.
- [x] Run the configured resolver workflow and read the configured resolver node `output.json`.
- [x] Persist schedules only after runtime validation succeeds.
- [x] Check safe clarification reply destination before persistence: the inbound event must have a usable conversation target and an enabled chat output destination or equivalent explicit destination policy.
- [x] Send clarification or confirmation replies through existing reply dispatcher.
- [x] Mark event receipts as skipped for clarification/refusal and dispatched for successful registration.
- [x] Ensure read-only event mode never mutates the schedule registry.

### 5. Due Event Dispatch And Startup Rehydration

#### `src/events/listener-service.ts`
#### `src/events/workflow-schedule-dispatch.ts`
#### `src/events/input-mapping.ts`
#### `src/events/receipt-ops.ts`

**Status**: COMPLETED

**Chosen Due-Dispatch Route**:

Use generated internal scheduler bindings. `src/events/workflow-schedule-dispatch.ts` should build an in-memory `EventConfiguration` for each due occurrence with:

- source id `divedra-scheduler`
- provider `divedra-scheduler`
- event type `workflow.schedule.due`
- binding id `workflow-schedule:<scheduleId>`
- `workflowName` from the persisted schedule
- `inputMapping` that maps the persisted schedule `workflowInput` from the due event input
- `execution.mode` matching the schedule record's selected dispatch policy, defaulting to direct async workflow execution when no stronger policy is persisted

This is the smaller concrete route because it reuses `dispatchEventToMatchingBindings()` and `createWorkflowTriggerRunner()` without adding a timer-to-engine path or authored `.divedra-events` files.

Ownership rules:

- The generated due envelope owns `eventId` and `dedupeKey`; both include schedule id and occurrence id or scheduled timestamp.
- `beginEventReceipt()` owns receipt creation and duplicate detection from the generated binding and due envelope.
- `mapEventToWorkflowInput()` owns runtime-variable mapping from the generated binding.
- `createWorkflowTriggerRunner()` owns direct/supervised workflow dispatch and dispatch artifact persistence.
- `WorkflowScheduleRepository.markFiring()` runs only after read-only mode is rejected and before dispatch.
- `markCompleted()` completes one-time schedules only after accepted due dispatch.
- Recurring re-arm happens only after the current occurrence is accepted or terminally failed and a next future occurrence is computed.
- `replayEventReceipt()` must not call schedule registry mutation helpers for ordinary replayed due receipts; replay verifies mapping/dispatch only unless a future explicit replay mutation option is added.

```typescript
export interface WorkflowScheduleDispatcher {
  rehydrateActiveSchedules(input: WorkflowScheduleRehydrateInput): Promise<readonly ScheduledEvent[]>;
  dispatchDueOccurrence(input: WorkflowScheduleDueDispatchInput): Promise<WorkflowScheduleDueDispatchResult>;
}

export interface WorkflowScheduleDueDispatchResult {
  readonly schedule: WorkflowScheduleRecord;
  readonly receiptId?: string;
  readonly workflowExecutionId?: string;
  readonly nextDueAt?: string;
}
```

**Checklist**:

- [x] Rehydrate active schedules when `createEventListenerService().start()` creates the shared scheduled event manager.
- [x] Build provider `divedra-scheduler`, event type `workflow.schedule.due` envelopes.
- [x] Dispatch due occurrences through generated internal scheduler bindings passed to `dispatchEventToMatchingBindings()`.
- [x] Verify receipt creation, dedupe, and input mapping use the generated binding and due envelope.
- [x] Reject registry mutation in read-only mode before `markFiring()`.
- [x] Complete one-time schedules after accepted due dispatch.
- [x] Re-arm recurring schedules to the next future occurrence only.
- [x] Ensure ordinary event replay does not mutate the schedule registry.

### 6. Operator CLI

#### `packages/divedra/src/cli/scoped-command-handlers.ts`
#### `packages/divedra/src/cli/input-output-helpers.ts`
#### `src/cli.test.ts`

**Status**: COMPLETED

```typescript
export interface ListWorkflowSchedulesInput extends DivedraOptions {
  readonly sourceId?: string;
  readonly status?: WorkflowScheduleStatus;
  readonly limit?: number;
}

export interface CancelWorkflowScheduleInput extends DivedraOptions {
  readonly scheduleId: string;
  readonly reason?: string;
}
```

**Checklist**:

- [x] Add `events schedules list [--source <id>] [--status <status>] [--limit <n>]`.
- [x] Add `events schedules inspect <schedule-id> [--output json]`.
- [x] Add `events schedules cancel <schedule-id> [--reason <text>]`.
- [x] Cancel pending `workflow-schedule` events owned by the schedule where available.
- [x] CLI tests cover text/json output, missing ids, invalid status, not found, and cancel behavior.

### 7. Examples And Documentation

#### `examples/event-sources/README.md`
#### `examples/event-sources/.divedra-events/**`
#### `README.md`
#### `design-docs/specs/design-scheduled-workflow-execution.md`

**Status**: COMPLETED

**Checklist**:

- [x] Add a minimal schedule-registration chat binding example.
- [x] Document the schedule resolver output JSON contract.
- [x] Document schedule list/inspect/cancel commands.
- [x] Correct the design verification command to use `events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events`.
- [x] Keep examples runnable with `--event-root ./examples/event-sources/.divedra-events`.

### 8. Verification And Regression Tests

#### `src/events/*.test.ts`
#### `src/events/adapters/cron.test.ts`
#### `src/events/listener-service.test.ts`
#### `src/cli.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Add focused unit tests for registry, validation, rehydration, due dispatch, and CLI.
- [x] Add integration coverage for chat registration to durable schedule to due workflow receipt.
- [x] Verify existing cron and workflow-sleep tests still pass.
- [x] Run full typecheck and targeted event test suites.

---

## Task Breakdown

| Task | Deliverables | Depends On | Parallelizable | Completion Criteria |
| ---- | ------------ | ---------- | -------------- | ------------------- |
| TASK-001 Registry foundation | Runtime schedule types, DB table, repository API | None | No | Registry CRUD and persistence tests pass |
| TASK-002 Scheduler event kind | `workflow-schedule` event kind and due registration helpers | TASK-001 | No | Existing cron/sleep tests and new scheduled-manager tests pass |
| TASK-003 Intent validation | Structured resolver parser, workflow catalog resolver, schedule validator | TASK-001 | Yes, after TASK-001 | Validator tests pass for ready/clarify/refuse and safe-reply cases |
| TASK-004 Chat registration path | `schedule-registration` execution mode, receipt/reply handling | TASK-001, TASK-003 | No | Chat registration tests persist or clarify correctly |
| TASK-005 Rehydration and due dispatch | Listener startup rehydration, generated scheduler binding dispatch, recurring re-arm | TASK-002, TASK-004 | No | Due dispatch creates receipts through generated internal bindings and re-arms/completes schedules |
| TASK-006 CLI operator surface | `events schedules list|inspect|cancel` | TASK-001 | Yes, if TASK-004/005 avoid CLI files | CLI tests pass |
| TASK-007 Docs/examples | README, example config, design command correction | TASK-004 | Yes, if code files are stable | `events validate --workflow-definition-dir ./examples --event-root ...` passes |
| TASK-008 Final verification | Typecheck and targeted test suites | All tasks | No | All listed verification commands pass |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Persistent schedules | Runtime DB event storage patterns | Available |
| Workflow resolution | `src/workflow/catalog.ts`, `src/workflow/usage.ts` | Available |
| Recurring schedule math | `computeNextCronFireTime()`, `isValidTimeZone()` | Available |
| Chat replies | `src/events/trigger-runner-replies.ts`, reply dispatcher | Available |
| Due workflow execution | Event receipts and trigger runner | Available |
| Startup rehydration | `src/events/listener-service.ts` shared scheduled manager | Available |

## Parallelizable Tasks

- `TASK-003` can run after `TASK-001` because it writes validator/resolution files and does not need scheduler/listener edits.
- `TASK-006` can run after `TASK-001` if implementation reserves CLI files to that task.
- `TASK-007` can run after `TASK-004` if examples/docs are the only write scope.

## Verification Plan

```bash
bun run typecheck
bun test src/events/scheduled-event-manager.test.ts src/events/adapters/cron.test.ts src/events/listener-service.test.ts
bun test src/events/trigger-runner*.test.ts src/events/*task-planning*.test.ts src/events/*supervisor*.test.ts
bun test src/cli.test.ts
bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events
bun run src/main.ts workflow list --workflow-definition-dir ./examples --output json
```

Additional focused commands to add once tests exist:

```bash
bun test src/events/workflow-schedule-registry.test.ts src/events/workflow-schedule-registration.test.ts src/events/workflow-schedule-dispatch.test.ts
```

## Completion Criteria

- [x] Chat schedule registration can persist a one-time workflow schedule after catalog validation.
- [x] Chat schedule registration can persist a recurring cron workflow schedule after timezone and cron validation.
- [x] Missing workflow, time, timezone, recurrence, or required workflow input returns clarification and does not persist a schedule.
- [x] A schedule is not persisted when a clarification may be required but no safe chat reply destination is available.
- [x] Schedule registration, recurring re-arm, and event listener startup enqueue the next due `workflow-schedule` event.
- [x] Due executions dispatch through generated internal scheduler bindings, event receipts, and trigger-runner workflow execution, not direct timer-to-engine calls.
- [x] Due event receipt dedupe keys include schedule id and occurrence id or scheduled timestamp.
- [x] Ordinary event replay of due receipts does not mutate schedule registry state.
- [x] One-time schedules complete after accepted due dispatch; recurring schedules re-arm one next occurrence.
- [x] `events schedules list|inspect|cancel` works in text and JSON modes.
- [x] Existing cron, workflow-sleep, event replay, receipt, and chat reply behavior remains compatible.
- [x] Verification commands pass.

## Progress Log

### Session: 2026-05-18 00:00
**Tasks Completed**: Plan created.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Step 3 accepted the design with one low verification-command finding; this plan addresses it in the verification and docs tasks.

### Session: 2026-05-18 00:20
**Tasks Completed**: Addressed Step 5 implementation-plan review findings.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added section-level design references, safe clarification reply destination validation, and a concrete generated-internal-binding route for due dispatch ownership.

### Session: 2026-05-18 20:05
**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented durable workflow schedule records, shared `workflow-schedule` event registration, schedule-registration resolver validation, generated internal due dispatch, listener startup rehydration, `events schedules list|inspect|cancel`, example binding/docs, and focused regression coverage. Verification passed: `bun run typecheck`; `bun run lint:biome` (with pre-existing warnings in `src/workflow/engine/*`); `bun test src/events/workflow-schedule-registry.test.ts src/events/workflow-schedule-registration.test.ts src/events/workflow-schedule-dispatch.test.ts src/events/scheduled-event-manager.test.ts src/events/adapters/cron.test.ts src/events/listener-service.test.ts`; `bun test src/events/supervisor-dispatch-contract.test.ts src/events/trigger-runner-stickiness.test.ts src/events/trigger-runner-supervisor-dispatch.test.ts src/events/supervisor-intent.test.ts src/events/trigger-runner-supervised.test.ts src/events/trigger-runner-options.test.ts src/events/supervisor-control-reply.test.ts src/events/supervisor-llm-batch.test.ts src/events/supervisor-profiles.test.ts src/events/supervisor-conversations.test.ts src/events/supervisor-command-contract.test.ts src/events/supervisor-llm-resolver-dispatch.test.ts src/events/dispatch-supervisor-chat.test.ts src/events/supervisor-llm-intent.test.ts`; `bun test src/cli.test.ts`; `bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events`; `bun run src/main.ts workflow list --workflow-definition-dir ./examples --output json`; `git diff --check`.

### Session: 2026-05-18 20:35
**Tasks Completed**: TASK-005 self-review fix.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Addressed Step 6 self-review high finding by aborting due dispatch when a schedule is no longer active and by checking the post-`markFiring()` record before workflow execution. Added regression coverage for cancelled schedule due occurrences. Verification passed: `bun test src/events/workflow-schedule-dispatch.test.ts`; `bun test src/events/workflow-schedule-registry.test.ts src/events/workflow-schedule-registration.test.ts src/events/workflow-schedule-dispatch.test.ts src/events/scheduled-event-manager.test.ts src/events/adapters/cron.test.ts src/events/listener-service.test.ts`; `bun run typecheck`; `bun run lint:biome` (with pre-existing warnings in `src/workflow/engine/*`); `git diff --check`.

### Session: 2026-05-18 21:05
**Tasks Completed**: Step 7 review fixes for TASK-003, TASK-005, TASK-007, and TASK-008.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Addressed Step 7 high and mid findings by recording schedule occurrence ids, guarding firing/completion/failure mutations by active status and occurrence identity, ignoring resolver-supplied recurring `nextDueAt` in favor of runtime cron computation, and correcting event validation commands to include `--workflow-definition-dir ./examples`. Added regression coverage for stale recurring due occurrences, cancellation during in-flight completion/failure, and recurring `nextDueAt` computation. Verification passed: `bun test src/events/workflow-schedule-registry.test.ts src/events/workflow-schedule-registration.test.ts src/events/workflow-schedule-dispatch.test.ts`; `bun test src/events/workflow-schedule-registry.test.ts src/events/workflow-schedule-registration.test.ts src/events/workflow-schedule-dispatch.test.ts src/events/scheduled-event-manager.test.ts src/events/adapters/cron.test.ts src/events/listener-service.test.ts`; `bun run typecheck`; `bun run lint:biome` (with pre-existing warnings in `src/workflow/engine/*`); `bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events`; `bun run src/main.ts workflow list --workflow-definition-dir ./examples --output json`; `git diff --check`.

### Session: 2026-05-18 21:20
**Tasks Completed**: Step 7 startup rehydration fix for TASK-005.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Addressed Step 7 high finding by normalizing stale active recurring schedules to the next future cron occurrence during startup rehydration before registering `workflow-schedule` timers. The normalized `nextDueAt` is persisted so the registered occurrence identity matches later due dispatch validation and missed recurring runs are not caught up. Added regression coverage for stale recurring startup rehydration. Verification passed: `bun test src/events/workflow-schedule-dispatch.test.ts`; `bun test src/events/workflow-schedule-registry.test.ts src/events/workflow-schedule-registration.test.ts src/events/workflow-schedule-dispatch.test.ts src/events/scheduled-event-manager.test.ts src/events/adapters/cron.test.ts src/events/listener-service.test.ts`; `bun run typecheck`; `bun run lint:biome` (with pre-existing warnings in `src/workflow/engine/*`); `bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events`; `git diff --check`.

### Session: 2026-05-18 21:35
**Tasks Completed**: Step 7 due dispatch failure and input mapping fixes for TASK-005.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Addressed Step 7 mid findings by wrapping generated due dispatch in failure handling that marks the occurrence failed and re-arms recurring schedules when dispatch or receipt persistence throws. Generated scheduler bindings now map target workflow input to exactly the persisted `schedule.workflowInput` via a template reference while preserving schedule metadata under runtime event metadata. Added regression coverage for exact target workflow input shape and receipt-store failure after `markFiring()`. Verification passed: `bun test src/events/workflow-schedule-dispatch.test.ts`; `bun test src/events/workflow-schedule-registry.test.ts src/events/workflow-schedule-registration.test.ts src/events/workflow-schedule-dispatch.test.ts src/events/scheduled-event-manager.test.ts src/events/adapters/cron.test.ts src/events/listener-service.test.ts`; `bun run typecheck`; `bun run lint:biome` (with pre-existing warnings in `src/workflow/engine/*`); `bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events`; `git diff --check`.

### Session: 2026-05-18 21:50
**Tasks Completed**: Step 7 schedule-registration failure and safe-clarification fixes for TASK-003 and TASK-004.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Addressed Step 7 mid findings by catching schedule-registration resolver, validation, reply, and persistence exceptions after the event receipt reaches `mapped`, updating the receipt to `failed` instead of leaving it stuck. Runtime-derived schedule clarifications now use the same safe reply destination gate as resolver-authored clarifications and refuse when no safe reply path exists. Added regression coverage for schedule persistence failure receipt status and unsafe runtime clarification refusal. Verification passed: `bun test src/events/workflow-schedule-dispatch.test.ts src/events/workflow-schedule-registration.test.ts`; `bun test src/events/workflow-schedule-registry.test.ts src/events/workflow-schedule-registration.test.ts src/events/workflow-schedule-dispatch.test.ts src/events/scheduled-event-manager.test.ts src/events/adapters/cron.test.ts src/events/listener-service.test.ts`; `bun run typecheck`; `bun run lint:biome` (with pre-existing warnings in `src/workflow/engine/*`); `bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events`; `git diff --check`.

### Session: 2026-05-18 22:50
**Tasks Completed**: Recent-change blocking fixes for TASK-003 schedule registration validation.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Preserved completed feature history while recording the focused `active/schedule-registration-blocking-fixes` follow-up. Configured `minConfidence` now requires numeric resolver confidence, and offset-less one-time `dueAt` values resolve through `decision.schedule.timezone` instead of host-local `Date` parsing. Verification passed: `bun test src/events/workflow-schedule-registration.test.ts`; `bun run typecheck`; `bun test src/events/workflow-schedule-registration.test.ts src/events/workflow-schedule-dispatch.test.ts src/events/workflow-schedule-registry.test.ts`; `bun run lint:biome` with only pre-existing warnings in `src/workflow/engine/*`; `bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events`; `git diff --check`.

## Progress Log Expectations

- Update this log after each implementation session.
- Mark task rows and module checklists as work lands.
- Record exact verification commands and pass/fail status.
- Move the plan to `impl-plans/completed/` only after all completion criteria are checked.

## Related Plans

- **Previous**: `impl-plans/completed/scheduled-sleep-node-runtime.md`
- **Previous**: `impl-plans/completed/chat-sdk-event-sources.md`
- **Previous**: `impl-plans/completed/event-listener-workflow-trigger-foundation.md`
- **Depends On**: accepted design in `design-docs/specs/design-scheduled-workflow-execution.md`
