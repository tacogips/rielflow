# Event Supervisor Control Review Hardening Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-event-supervisor-control.md#concurrency-and-idempotency`
**Created**: 2026-04-29
**Last Updated**: 2026-04-30

---

## Design Document Reference

**Source**: `design-docs/specs/design-event-supervisor-control.md`

### Summary

Code review found behavioral and API-quality risks in the implemented event
supervisor foundation. This plan hardens idempotency, cross-process
serialization, GraphQL parsing, public API idempotency, and restart-budget
semantics before the feature is treated as operator-ready beyond Phase 1.

### Scope

**Included**: targeted fixes in supervisor repository/client/GraphQL code and
regression tests.

**Excluded**: authored default supervisor workflow packaging and provider
specific chat adapters.

---

## Review Findings

1. [src/events/supervised-runs.ts](../../src/events/supervised-runs.ts:50):
   correlation serialization used an in-memory `Map` only. **Update (2026-04-29)**:
   `withCorrelationLock` now wraps work in a per-correlation dedicated SQLite
   file (`BEGIN IMMEDIATE` + `PRAGMA busy_timeout`) after the in-process promise
   chain, so separate processes sharing the same `rootDataDir` serialize on the
   same binding correlation key without relying solely on memory.
2. [src/workflow/supervisor-client.ts](../../src/workflow/supervisor-client.ts:353):
   replay of finalized failure results must always throw (including empty-string
   or non-string `error` fields). **Update**: `dispatchCommand` replay handling
   was tightened so `error` in the stored result envelope always rethrows;
   remaining idempotency work stays under durable correlation locking (finding 1).
3. [src/graphql/schema.ts](../../src/graphql/schema.ts:1238)
   and [src/workflow/supervisor-graphql-client.ts](../../src/workflow/supervisor-graphql-client.ts:34):
   GraphQL supervisor payloads are cast after shallow object checks.
4. [src/workflow/supervisor-client.ts](../../src/workflow/supervisor-client.ts:663):
   public convenience methods synthesize timestamp command ids and do not accept
   caller idempotency keys.
5. [src/workflow/supervisor-client.ts](../../src/workflow/supervisor-client.ts:491):
   restart count is incremented, but restart budget and failed-target recovery
   behavior need explicit enforcement tests.
6. [src/workflow/supervisor-client.ts](../../src/workflow/supervisor-client.ts:440):
   returning the async start helper without `await` bypassed the surrounding
   `try`/`catch`, leaving failed command rows stuck in `pending` state. The
   same area also re-dispatched `input` as `start` with the same `commandId`,
   which broke `startOnFirstInput` via a false duplicate-in-progress error.

## Follow-Up Review Feedback (2026-04-29)

1. [src/workflow/supervisor-client.ts](../../src/workflow/supervisor-client.ts:403)
   still mints a new `supervisedRunId` for `start` when there is no currently
   active target, and [src/workflow/supervisor-client.ts](../../src/workflow/supervisor-client.ts:606)
   mints a fresh run again when `input` arrives against an existing correlation
   whose target is no longer active. That does not match the design contract in
   [design-event-supervisor-control.md](../../design-docs/specs/design-event-supervisor-control.md:296),
   which says `start` should "create or reuse" a supervisor run, nor the
   lifecycle rule in the same design
   [section](../../design-docs/specs/design-event-supervisor-control.md:434)
   that target attempts should remain under the same supervised-run authority.
   **Resolved (2026-04-29)**: `start` reuses `latest.supervisedRunId` when the
   correlation already has a durable row without a live target; regression tests
   cover `start` after stop/terminal completion and `startOnFirstInput` against
   an existing stopped run (see progress log "follow-up behavioral alignment").
2. [src/workflow/supervisor-client.ts](../../src/workflow/supervisor-client.ts:511)
   never persists a `completed` terminal state, and the only explicit failure
   transition remains the command-level catch block at
   [src/workflow/supervisor-client.ts](../../src/workflow/supervisor-client.ts:692).
   As written, a target workflow can finish successfully while the supervised
   run record still says `running`, which means the record is not yet the
   lifecycle authority described in the design
   [concurrency section](../../design-docs/specs/design-event-supervisor-control.md:428).
   **Resolved (2026-04-29/30)**: `reconcileTerminalSupervisedRunRecord` runs at
   correlation-locked command boundaries and on lookups/queries; supervised-run
   rows reflect terminal target sessions before subsequent commands (see progress
   log sessions "follow-up behavioral alignment" and "authoritative supervisedRunId + query reconciliation").
3. [src/events/trigger-runner.ts](../../src/events/trigger-runner.ts:362)
   maps the event into workflow runtime variables before the supervised action
   has been resolved at
   [src/events/trigger-runner.ts](../../src/events/trigger-runner.ts:439).
   That means `status`, `stop`, or `restart` can fail on unrelated
   `inputMapping` requirements even though those actions do not need target
   runtime input. This is a control-plane/data-plane coupling that is broader
   than the intended purpose.
   **Resolved (2026-04-30)**: supervised mode resolves intent before mapping;
   full `inputMapping` runs only for `start` and `input`; other actions use
   minimal runtime variables (`buildEventRuntimeMetadata`). Covered in
   `src/events/trigger-runner.test.ts`.
4. [src/events/dispatch-supervisor-chat.ts](../../src/events/dispatch-supervisor-chat.ts:81)
   prepares an `eventReplyDispatcher`, but the supervised path in
   [src/events/trigger-runner.ts](../../src/events/trigger-runner.ts:455)
   only records skipped/dispatched receipts and returns a result object. The
   current architecture therefore does not yet satisfy the natural-language chat
   control purpose described in the design
   [status reply requirement](../../design-docs/specs/design-event-supervisor-control.md:303)
   and
   [ambiguity reply requirement](../../design-docs/specs/design-event-supervisor-control.md:644):
   users can issue chat control messages, but they do not receive the
   provider-neutral reply/clarification output the design calls for.
   **Resolved (2026-04-30)**: `buildSupervisorControlChatReplyRequest` and
   `dispatchSupervisorControlReplyIfConfigured` in `trigger-runner` dispatch
   status/skip/failure/mapping-failure replies when `eventReplyDispatcher` is set;
   destructive LLM ambiguity emits one router-level reply and per-binding skips
   use `suppressSupervisorChatReply`. See `design-event-supervisor-control.md`
   Phase 1 implementation bullets and `trigger-runner.test.ts`.

## Follow-Up Review Feedback (2026-04-30)

1. **Resolved (2026-04-30)**. Historical issue: lookup-by-`supervisedRunId` was
   folded back into correlation resolution so an explicit id could lose
   authority. **Fix**: optional `EventSupervisorCommand.supervisedRunId` (and
   GraphQL `command.supervisedRunId`) scopes dispatch to `repo.loadById`,
   validates scope against `sourceId` / `bindingId` / `correlationKey` /
   `targetWorkflowName`, rejects drift vs active/latest where required, and uses
   `effectiveRunId` for command-slot claims. Regression:
   `dispatchCommand rejects supervisedRunId when command correlation does not match the run`.
2. **Resolved (2026-04-30)**. Historical issue: `supervisedWorkflowRun` could
   show `running` while the target session was already terminal until the next
   command. **Fix**: `reconcileTerminalSupervisedRunRecord` is exported and used
   on `supervisedWorkflowRun` query rows and in `resolveLookupRecord`, aligned
   with command-path reconciliation.

## Post-Closure Review Feedback (2026-04-30)

Phase 1 architecture still matches the intended purpose documented in
`design-event-supervisor-control.md`: the runtime-owned supervisor client is the
current lifecycle authority, while authored supervisor workflow execution
remains a later packaging step. The 2026-04-30 follow-up pass closed the
recorded idempotency and public control-plane ergonomics gaps below.

1. **Resolved (2026-04-30)**. [src/events/trigger-runner.ts](../../src/events/trigger-runner.ts:817)
   now emits a single router-level destructive-ambiguity clarification, and
   [src/events/reply-dispatcher.ts](../../src/events/reply-dispatcher.ts:76)
   persistently dedupes reply sends by idempotency key. The synthetic router
   reply key now uses `sourceId + dedupeKey + ambiguity kind`, aligning the
   durable reply idempotency key with event-receipt dedupe semantics instead of
   `eventId`.
2. **Resolved (2026-04-30)**. [src/graphql/types.ts](../../src/graphql/types.ts:329)
   and [src/graphql/schema.ts](../../src/graphql/schema.ts:1512)
   previously made `dispatchSupervisorChat` accept caller-supplied `eventRoot`,
   `endpoint`, and `authToken`. That leaks server filesystem layout and
   `endpoint`, and `authToken`. The public mutation input is now narrowed to
   source identity plus chat/event payload fields; event configuration root and
   transport credentials resolve from server context/configuration.
3. **Resolved (2026-04-30)**. [src/workflow/supervisor-client.ts](../../src/workflow/supervisor-client.ts:1001)
   and [src/workflow/supervisor-graphql-client.ts](../../src/workflow/supervisor-graphql-client.ts:447)
   previously looked up an existing supervised run before `submitInput`, then
   forcibly set `startOnFirstInput: false`. The convenience clients now accept
   `targetWorkflowName` and `bindingSnapshot` so `submitInput` can create the
   first supervised run when policy allows, matching the correlation-aware
   first-input behavior from
   [design-event-supervisor-control.md](../../design-docs/specs/design-event-supervisor-control.md:275),
   while existing-run input still disables accidental first-run creation.

## Modules

### 1. Durable Correlation Locking And Command Replay

#### `src/events/supervised-runs.ts`, `src/workflow/runtime-db.ts`

**Status**: COMPLETED

```typescript
interface EventSupervisedRunRepository {
  withCorrelationLock<T>(
    input: SupervisedRunCorrelationKey,
    fn: () => Promise<T>,
  ): Promise<T>;
  claimCommandSlot(
    input: ClaimSupervisorCommandInput,
  ): Promise<CommandClaimResult>;
  finalizeCommand(
    commandId: string,
    result: SupervisorCommandResult,
  ): Promise<void>;
}
```

**Checklist**:

- [x] Replace in-memory-only queue with SQLite transaction or file lock
- [x] Store replayable success and failure command results
- [x] Tests cover duplicate and in-progress command states

### 2. GraphQL Supervisor Payload Validation

#### `src/graphql/schema.ts`, `src/workflow/supervisor-graphql-client.ts`

**Status**: COMPLETED

```typescript
function parseEventBindingForSupervisor(value: unknown): EventBinding;
function parseSupervisedWorkflowView(value: unknown): SupervisedWorkflowView;
```

**Checklist**:

- [x] Structurally parse binding, command, runtimeVariables, and view payloads
- [x] Add negative schema and HTTP tests for malformed payloads

### 3. Public Idempotency Keys

#### `src/workflow/supervisor-client.ts`, `src/workflow/supervisor-graphql-client.ts`, `src/graphql/types.ts`

**Status**: COMPLETED

```typescript
interface SupervisedWorkflowCommandOptions {
  readonly idempotencyKey?: string;
}
```

**Checklist**:

- [x] Add `idempotencyKey` to start/stop/restart/status/input inputs
- [x] Tests prove repeated public calls do not duplicate target attempts

### 4. Restart Budget And Failure Recovery

#### `src/workflow/supervisor-client.ts`

**Status**: COMPLETED

```typescript
interface SupervisedRestartDecision {
  readonly allowed: boolean;
  readonly reason?: "budget-exhausted" | "no-active-target" | "target-running";
}
```

**Checklist**:

- [x] Enforce restart budget before restart attempts
- [x] Test failed target, exhausted budget, and manual restart semantics

### 5. Verification And Plan Closeout

#### Tests and plan status

**Status**: COMPLETED

```typescript
interface SupervisorReviewVerification {
  readonly typecheck: "pass";
  readonly focusedTests: readonly string[];
}
```

**Checklist**:

- [x] Run `task typecheck`
- [x] Run focused supervisor/event/GraphQL tests
- [x] Update plan statuses when hardening completes

---

## Module Status

| Module                 | File Path                                                            | Status    | Tests |
| ---------------------- | -------------------------------------------------------------------- | --------- | ----- |
| Durable locking/replay | `src/events/supervised-runs.ts`, `src/workflow/runtime-db.ts`        | COMPLETED | yes   |
| GraphQL validation     | `src/graphql/schema.ts`, `src/workflow/supervisor-graphql-client.ts` | COMPLETED | yes   |
| Public idempotency     | `src/workflow/supervisor-client.ts`, `src/graphql/types.ts`          | COMPLETED | yes   |
| Restart budget         | `src/workflow/supervisor-client.ts`                                  | COMPLETED | yes   |
| Verification           | tests/plans                                                          | COMPLETED | yes   |

## Dependencies

| Feature                      | Depends On                                     | Status |
| ---------------------------- | ---------------------------------------------- | ------ |
| TASK-001 Durable lock/replay | `event-supervisor-control-foundation:TASK-002` | DONE   |
| TASK-002 GraphQL validation  | `event-supervisor-control-foundation:TASK-005` | DONE   |
| TASK-003 Idempotency keys    | TASK-001                                       | DONE   |
| TASK-004 Restart budget      | `event-supervisor-control-foundation:TASK-004` | DONE   |
| TASK-005 Verification        | TASK-001, TASK-002, TASK-003, TASK-004         | DONE   |

## Tasks

### TASK-001: Durable Locking And Replay

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/supervised-runs.ts`, `src/workflow/runtime-db.ts`
**Dependencies**: event-supervisor-control-foundation:TASK-002

**Completion Criteria**:

- [x] Cross-process correlation locking implemented
- [x] Failed command replay cannot re-execute a command
- [x] Regression tests cover duplicate command states

### TASK-002: GraphQL Validation Hardening

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/graphql/schema.ts`, `src/workflow/supervisor-graphql-client.ts`
**Dependencies**: event-supervisor-control-foundation:TASK-005

**Completion Criteria**:

- [x] Binding and command payloads are structurally parsed
- [x] Malformed remote payloads fail clearly
- [x] Negative tests added

### TASK-003: Public Idempotency Keys

**Status**: Completed
**Parallelizable**: No
**Deliverables**: supervisor client and GraphQL input types
**Dependencies**: TASK-001

**Completion Criteria**:

- [x] Public methods accept idempotency keys
- [x] Repeated calls with the same key replay deterministically
- [x] Tests cover local and GraphQL clients

### TASK-004: Restart Budget Semantics

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/workflow/supervisor-client.ts`
**Dependencies**: event-supervisor-control-foundation:TASK-004

**Completion Criteria**:

- [x] Restart budget enforced
- [x] Failed-target recovery behavior documented in tests
- [x] Manual restart semantics are explicit

### TASK-005: Verification And Plan Closeout

**Status**: Completed
**Parallelizable**: No
**Deliverables**: tests, `impl-plans/PROGRESS.json`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004

**Completion Criteria**:

- [x] Typecheck and focused tests pass
- [x] Plan statuses updated
- [x] Examples/docs task is unblocked

## Completion Criteria

- [x] All review findings resolved
- [x] Typecheck passes
- [x] Focused supervisor/event/GraphQL tests pass
- [x] Foundation plan remains completed

## Progress Log

### Session: 2026-04-29

**Tasks Completed**: Reviewed implementation and created hardening plan.
**Tasks In Progress**: None
**Blockers**: None
**Notes**: `task typecheck` passes before hardening; risks are behavioral and
API quality issues.

### Session: 2026-04-29 (review hardening iteration)

**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Tasks In Progress**: TASK-005
**Blockers**: TASK-004 restart-budget/failure-recovery closeout still pending
**Notes**: Fixed two missed behavioral bugs during review: failed start helper
rejections were escaping command finalization, and `input` with
`startOnFirstInput` re-entered command dispatch with the same `commandId`.
Added focused regression coverage for duplicate-pending command claims,
start-on-first-input, local and remote idempotency keys, and malformed GraphQL
payloads. Verified with `bun test src/events/supervised-runs.test.ts
src/workflow/supervisor-client.test.ts
src/workflow/supervisor-graphql-client.test.ts src/graphql/schema.test.ts
src/events/trigger-runner.test.ts` and `bun run typecheck`.

### Session: 2026-04-29 (hardening closeout)

**Tasks Completed**: TASK-004, TASK-005; plan marked **Completed**
**Notes**: Tightened `isPendingSupervisorCommandEnvelope` so finalized command
JSON (`result` + `finalizedAt`) is never mistaken for in-flight `pending` rows;
replay error detection now uses `hasOwnProperty` for the `error` field.
`dispatchSupervisedWorkflowCommand` requires supervised bindings, validates
supervised policy via `assertSupervisedBindingGraphqlPolicy`, parses optional
`runtimeVariables`, and validates lookup inputs. Full suite: 675 tests pass;
`bun run typecheck` passes.

### Session: 2026-04-29 (post-closeout review feedback)

**Tasks Completed**: Follow-up review feedback on TASK-002 and TASK-004
**Tasks In Progress**: None
**Blockers**: None
**Notes**: A post-closeout code review found two missed correctness issues. First,
public supervisor dispatch accepted a `command.targetWorkflowName` that did not
have to match `binding.workflowName`, so the GraphQL/local control surface could
mix one binding policy with another workflow target. The local supervisor client
now rejects source/binding/workflow mismatches at the dispatch boundary, and the
GraphQL regression suite covers the failure path. Second, the failure handler in
`src/workflow/supervisor-client.ts` used the original correlation context even
after restart cancellation had already cleared the active target, which could
re-persist a stale `activeTargetExecutionId`; missing `status` lookups also
created phantom failed supervised-run rows. The client now tracks the latest
transient supervised-run state, persists failure records only when a real run
already exists or startup created one, and leaves missing-lookups side-effect
free. Added regression tests for missing status lookup, failed restart state
cleanup, binding/command mismatch rejection, and the matching GraphQL negative
path. Verified with `bun test src/workflow/supervisor-client.test.ts
src/graphql/schema.test.ts` and `bun run typecheck`.

### Session: 2026-04-29 (architecture/code review feedback, superseded)

**Tasks Completed**: Reviewed current diff against the supervisor/event-source
design and recorded follow-up findings (see next progress entry for fixes).
**Tasks In Progress**: None
**Blockers**: None
**Notes (historical)**: Follow-up items tracked here (supervised-run id reuse on
`start`, terminal reconciliation, lazy `inputMapping` for lifecycle commands,
and provider-neutral chat replies) were implemented in the session dated the
same day below.

### Session: 2026-04-29 (follow-up behavioral alignment)

**Tasks Completed**: Addressed post-closeout behavioral gaps from the review
notes above: durable supervised-run id reuse on `start` after terminal/stopped
runs, terminal target reconciliation before each correlation-locked command,
lazy `inputMapping` for supervised `status` / `stop` / `restart`, and optional
chat reply dispatch for supervised outcomes when a reply target exists.
**Notes**: Verified with `bun run typecheck` and full `bun test` suite.

### Session: 2026-04-30 (router-level ambiguity reply + supervised mapping failure reply)

**Tasks Completed**: Addressed remaining 2026-04-30 review notes on reply-path alignment.
**Tasks In Progress**: None
**Blockers**: None
**Notes**:

1. `dispatchEventToMatchingBindings` now emits a single provider-neutral clarification when
   `planSupervisedLlmBindingsDispatch` returns `kind: "ambiguous"`, using a stable synthetic receipt id
   under `router:<sourceId>:<eventId>:supervised-llm-destructive-ambiguous`. Bindings in `bindingIds` pass
   `suppressSupervisorChatReply` into `dispatch` so skip replies are not duplicated per binding.
2. Supervised bindings that fail during `inputMapping` / `mapEventToWorkflowInput` before dispatch now send
   the same generic failure reply pattern as supervised command failures when `eventReplyDispatcher` is set.
3. Regression: `dispatchEventToMatchingBindings sends one chat clarification for destructive llm ambiguity`.
   **Verification**: `bun run typecheck` and full `bun test` pass.

### Session: 2026-04-30 (review feedback on reply-path alignment, superseded)

**Tasks Completed**: Reviewed the current supervisor/event-source diff against
the intended Phase 1 and Phase 4 control-reply purpose; recorded remaining
behavioral gaps (see session above for fixes).
**Tasks In Progress**: None
**Blockers**: None
**Notes (historical)**: Duplicate ambiguity replies and missing supervised mapping failure replies were
tracked here; item (2) in the original notes about command failures without replies was already addressed by
the supervised outer `catch` reply path before this iteration; remaining gap was primarily destructive
ambiguity fanout and mapping-time failures.
**Verification**: Reviewed current diff by inspection and re-ran
`bun run typecheck` plus `bun test src/workflow/supervisor-client.test.ts src/events/trigger-runner.test.ts`
(24 pass).

### Session: 2026-04-30 (authoritative supervisedRunId + query reconciliation)

**Tasks Completed**: Closed remaining design gaps from 2026-04-30 review notes on
`supervisedRunId` authority and read-only GraphQL staleness.
**Tasks In Progress**: None
**Blockers**: None
**Notes**:

1. Added optional `EventSupervisorCommand.supervisedRunId` (GraphQL input field
   `command.supervisedRunId`). `dispatchCommand` uses it to load the authoritative
   row, rejects scope drift and active-run conflicts, and uses it for command-slot
   claims. Library and GraphQL clients populate the field on stop/restart/status/input.
2. Exported `reconcileTerminalSupervisedRunRecord` and reused it in
   `supervisedWorkflowRun` plus correlation reconcile before latest lookup;
   library `resolveLookupRecord` also reconciles returned rows.
3. Documented the command-scoped field in `design-event-supervisor-control.md`.
4. Regression: `dispatchCommand rejects supervisedRunId when command correlation does not match the run`.
   **Verification**: `bun run typecheck`; `bun test` on supervisor-client, supervisor-graphql-client, graphql schema, trigger-runner.

### Session: 2026-04-30 (current diff review feedback)

**Tasks Completed**: Reviewed the staged supervisor/event-source implementation
plus the latest router-level ambiguity-reply follow-up against the intended
Phase 1 / Phase 4 architecture. Recorded remaining review items in
Post-Closure Review Feedback above.
**Tasks In Progress**: None
**Blockers**: None
**Notes**:

1. The runtime-owned supervisor client remains aligned with the design's Phase 1
   intent; no architecture reset is needed before the packaged supervisor
   workflow iteration.
2. The latest `trigger-runner` follow-up improves destructive-ambiguity UX, but
   its durable reply dedupe key is still `eventId`-scoped rather than aligned
   with receipt `dedupeKey` semantics.
3. The main remaining design mismatch is on the public GraphQL surface for
   `dispatchSupervisorChat`, which still exposes server-local configuration and
   downstream transport knobs to callers instead of keeping those decisions
   server-owned.
4. Local and remote convenience `submitInput` APIs still cannot express
   first-message supervised-run creation when `startOnFirstInput` policy is the
   intended entry path.
   **Verification**: `bun run typecheck`; `bun test src/events/trigger-runner.test.ts src/workflow/supervisor-client.test.ts src/workflow/supervisor-graphql-client.test.ts src/graphql/schema.test.ts src/events/dispatch-supervisor-chat.test.ts`

### Session: 2026-04-30 (review revalidation for supervisor/event-source continuation)

**Tasks Completed**: Re-reviewed the current staged and unstaged
supervisor/event-source work against the intended design, confirmed the open
post-closure findings still describe the live mismatches, and revalidated the
feature with targeted checks.
**Tasks In Progress**: None
**Blockers**: None
**Notes**:

1. Architecture remains aligned with the intended Phase 1 purpose: the
   runtime-owned `WorkflowSupervisorClient` is still the lifecycle authority,
   and the packaged authored supervisor workflow remains a later iteration
   rather than a prerequisite for correctness.
2. The router-level destructive-ambiguity reply still uses
   `router:<sourceId>:<eventId>:...` while durable reply dedupe persists by
   idempotency key, so duplicate deliveries that converge on the same
   event-receipt `dedupeKey` but arrive with a different `eventId` can still
   emit the clarification more than once. The existing Post-Closure Feedback
   item (1) remains open.
3. The GraphQL `dispatchSupervisorChat` surface still exposes `eventRoot`,
   `endpoint`, and `authToken` from client input instead of resolving those from
   server-owned context. The existing Post-Closure Feedback item (2) remains
   the main control-plane design mismatch.
4. Local and remote `submitInput` convenience APIs still require an existing
   supervised-run lookup and force `startOnFirstInput: false`, so the existing
   Post-Closure Feedback item (3) remains open unless the API is narrowed or
   expanded intentionally.
5. No additional behavioral regressions were identified beyond the already
   recorded follow-up items.
   **Verification**: `bun run typecheck`; `bun test src/events/trigger-runner.test.ts src/workflow/supervisor-client.test.ts src/workflow/supervisor-graphql-client.test.ts src/graphql/schema.test.ts src/events/dispatch-supervisor-chat.test.ts` (78 pass)

### Session: 2026-04-30 (supervisor/event-source review confirmation)

**Tasks Completed**: Reviewed the current staged supervisor/event-source
implementation plus the latest unstaged `trigger-runner` follow-up against the
intended architecture, then confirmed the live review state with focused
verification.
**Tasks In Progress**: None
**Blockers**: None
**Notes**:

1. Architecture still matches the intended Phase 1 purpose in
   `design-event-supervisor-control.md`: the runtime-owned
   `WorkflowSupervisorClient` remains the lifecycle authority, and packaging the
   authored supervisor workflow is still a later iteration rather than a
   prerequisite for correctness.
2. The live mismatches are unchanged from Post-Closure Review Feedback items
   (1)-(3): router-level ambiguity reply idempotency is still `eventId`-scoped,
   `dispatchSupervisorChat` still exposes server-owned configuration/transport
   knobs on GraphQL, and convenience `submitInput` APIs still cannot represent
   `startOnFirstInput` first-message creation semantics.
3. The current unstaged `src/events/trigger-runner.ts` edit only removes an
   unnecessary type cast when passing `options`; it does not alter behavior and
   does not change the existing review conclusions.
4. No additional behavioral regressions were identified in this review pass
   beyond the already recorded follow-up items.
   **Verification**: `bun run typecheck`; `bun test src/events/trigger-runner.test.ts src/workflow/supervisor-client.test.ts src/workflow/supervisor-graphql-client.test.ts src/graphql/schema.test.ts src/events/dispatch-supervisor-chat.test.ts` (78 pass)

### Session: 2026-04-30 (focused supervisor chat review pass)

**Tasks Completed**: Re-reviewed the current supervisor/event-source
implementation against the intended design, with focus on natural-language
supervisor control, reply/idempotency behavior, and the public GraphQL/control
surfaces. Recorded that the active architectural mismatches are unchanged from
the existing Post-Closure Review Feedback items.
**Tasks In Progress**: None
**Blockers**: None
**Notes**:

1. The current architecture still matches the intended Phase 1 boundary in
   `design-event-supervisor-control.md`: lifecycle ownership remains with the
   runtime `WorkflowSupervisorClient`, and authored supervisor workflow
   execution is still a later packaging step rather than a correctness
   requirement for this iteration.
2. No new implementation blocker was found in the latest staged diff. The
   remaining review items are still the existing three follow-ups already
   recorded above:
   router-level ambiguity reply idempotency remains `eventId`-scoped,
   `dispatchSupervisorChat` GraphQL still exposes server-owned
   configuration/transport knobs, and convenience `submitInput` APIs still
   cannot represent first-message `startOnFirstInput` behavior.
3. The current unstaged `src/events/trigger-runner.ts` change is still
   non-behavioral; it only removes an unnecessary cast when threading `options`
   into the LLM-batch helper and reply dispatch helper.
   **Verification**: `bun test src/events/dispatch-supervisor-chat.test.ts src/events/supervisor-llm-batch.test.ts src/workflow/supervisor-graphql-client.test.ts`; `bun test src/events/trigger-runner.test.ts -t supervised`

### Session: 2026-04-30 (requested supervisor/event-source architecture review)

**Tasks Completed**: Reviewed the current supervisor/event-source diff against
the intended design again, confirmed whether the architecture still fits the
Phase 1 purpose, and recorded the current review state for continuation.
**Tasks In Progress**: None
**Blockers**: None
**Notes**:

1. The current architecture still matches the intended Phase 1 design:
   lifecycle ownership remains with the runtime
   `WorkflowSupervisorClient`, while authored supervisor workflow packaging is
   still a later iteration rather than a missing prerequisite.
2. No new runtime bug or regression was identified in this pass beyond the
   already-open Post-Closure Review Feedback items (1)-(3).
3. The highest-impact remaining mismatch is still the public GraphQL
   `dispatchSupervisorChat` surface, which exposes `eventRoot`, `endpoint`, and
   `authToken` from client input instead of resolving those from server-owned
   context/configuration.
4. The current `submitInput` convenience APIs still cannot represent the
   design's `startOnFirstInput` first-message behavior because they require an
   existing supervised-run lookup and forcibly disable first-input creation.
5. Router-level destructive-ambiguity replies are still idempotent by
   `eventId`, not by the same delivery identity used by event-receipt dedupe,
   so duplicate deliveries with a new `eventId` can still emit the same
   clarification again.
6. The current unstaged `src/events/trigger-runner.ts` edit is non-behavioral;
   it only removes an unnecessary cast when threading `options`.
   **Verification**: `bun test src/events/dispatch-supervisor-chat.test.ts src/events/supervised-runs.test.ts src/events/supervisor-command-contract.test.ts src/events/supervisor-control-reply.test.ts src/events/supervisor-intent.test.ts src/events/supervisor-llm-batch.test.ts src/events/supervisor-llm-intent.test.ts src/events/trigger-runner.test.ts src/workflow/supervisor-client.test.ts src/workflow/supervisor-graphql-client.test.ts src/graphql/schema.test.ts` (110 pass)

### Session: 2026-04-30 (post-closure follow-up fixes)

**Tasks Completed**: Closed Post-Closure Review Feedback items 1 through 3:
router-level destructive-ambiguity reply idempotency now uses event
`dedupeKey`; GraphQL `dispatchSupervisorChat` no longer accepts caller-supplied
`eventRoot`, `endpoint`, or `authToken`; local and remote `submitInput`
convenience clients can start the first supervised run when provided
`targetWorkflowName` and `bindingSnapshot`.
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The runtime-owned supervisor client remains the lifecycle authority.
The broader internal `superviser` naming migration and deeper nested
patch/rerun matrices remain separate optional scope.
**Verification**: `bun run typecheck`; `bun test src/events/trigger-runner.test.ts src/events/supervisor-control-reply.test.ts src/workflow/supervisor-client.test.ts src/workflow/supervisor-graphql-client.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts` (101 pass)

## Related Plans

- **Previous**: `impl-plans/completed/event-supervisor-control-foundation.md`
- **Next**: default supervisor system workflow packaging plan
- **Depends On**: `event-supervisor-control-foundation:TASK-002`,
  `event-supervisor-control-foundation:TASK-004`,
  `event-supervisor-control-foundation:TASK-005`
