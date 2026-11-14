# Workflow Supervisor Dispatcher Implementation Plan

**Status**: Completed (split execution plans + tracked runtime closure through TASK-007)
**Design Reference**: `design-docs/specs/design-workflow-supervisor-dispatcher.md`
**Created**: 2026-04-30
**Last Updated**: 2026-05-02

## Related Plans

- **Completed Plan**: `impl-plans/workflow-supervisor-dispatcher.md`
- **Completed Split Plan**: `impl-plans/workflow-supervisor-dispatcher-foundation.md`
- **Completed Split Plan**: `impl-plans/workflow-supervisor-dispatcher-runtime.md`
- **Previous**: `impl-plans/completed/event-supervisor-control-foundation.md`
- **Previous**: `impl-plans/completed/supervisor-natural-language-control.md`
- **Related**: `impl-plans/completed/event-external-mailbox-binding-foundation.md`

## Design Document Reference

**Source**: `design-docs/specs/design-workflow-supervisor-dispatcher.md`,
`design-docs/specs/design-event-supervisor-control.md`,
`design-docs/specs/design-event-external-mailbox-binding.md`,
`design-docs/specs/architecture.md#event-listener-workflow-triggers`

### Summary

Implement chat-facing multi-workflow supervision on top of the existing
single-target supervised flow. External input should enter one supervisor
conversation, resolve to a structured dispatch decision, and apply lifecycle
changes only after validation, idempotency, and compare-and-swap checks.

### Scope

**Included**: supervisor profile schema/validation, dispatcher decision
contract, conversation persistence, runtime dispatch service, event routing,
GraphQL/library entrypoints, examples, and focused tests.

**Excluded**: long-lived resumed supervisor executions, profile migration
commands, direct-answer external tool calls, and TUI-specific UX.

### Delivery Breakdown

The original unresolved TODOs are now split into execution-ready plans:

| Original TODO | Split Plan | Task |
|---------------|------------|------|
| line 99: supervisor profile types and validation | `workflow-supervisor-dispatcher-foundation.md` | `TASK-001` |
| line 155: dispatch decision contract and resolver context | `workflow-supervisor-dispatcher-foundation.md` | `TASK-002` |
| line 228: supervisor conversation persistence | `workflow-supervisor-dispatcher-foundation.md` | `TASK-003` |
| line 272: runtime dispatch service and scoped capabilities | `workflow-supervisor-dispatcher-runtime.md` | `TASK-004` |
| line 301: event binding routing for `supervisor-dispatch` | `workflow-supervisor-dispatcher-runtime.md` | `TASK-005` |
| line 337: GraphQL and library dispatcher entrypoints | `workflow-supervisor-dispatcher-runtime.md` | `TASK-006` |
| line 349: examples and focused test coverage | `workflow-supervisor-dispatcher-runtime.md` | `TASK-007` |

## Dependencies

| Plan | Depends On | Status |
|------|------------|--------|
| `workflow-supervisor-dispatcher-foundation` | completed supervisor/event foundation plans | COMPLETED |
| `workflow-supervisor-dispatcher-runtime` | `workflow-supervisor-dispatcher-foundation` | COMPLETED |

## Completion Criteria

- [x] Foundation types, validation, decision parsing, and persistence are
      specified in a dedicated execution plan
- [x] Runtime dispatch, event routing, GraphQL/library surface, and verification
      are specified in a dedicated execution plan
- [x] Every unresolved dispatcher TODO is mapped to a task with deliverables,
      dependencies, and completion criteria

## Progress Log

### Session: 2026-04-30 00:00
**Tasks Completed**: Authored initial implementation plan for workflow
supervisor dispatcher
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Chosen first-cut baseline is short-lived decision executions with a
pinned supervisor-profile snapshot and new multi-run conversation persistence,
while preserving the existing single-target supervised path for compatibility.

### Session: 2026-04-30 00:00 (review follow-up)
**Tasks Completed**: Reviewed and tightened the implementation plan against the
updated dispatcher design
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Filled missing concrete types for direct-answer/concurrency/lifecycle
policy, made compare-and-swap and source-message dedupe explicit in repository
contracts, aligned the plan with `runAlias` and
`selectedManagedRunIdsByWorkflowKey`, corrected the related-plan path, and
renamed the example target to `default-supervisor-dispatcher`.

### Session: 2026-04-30 00:00 (task split)
**Tasks Completed**: Split the oversized umbrella plan into foundation and
runtime execution plans
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Converted the unresolved dispatcher TODO list into concrete task IDs
and moved implementation detail into split plans so each file stays within the
repository impl-plan size guidance.

### Session: 2026-04-30 00:30 (architecture review feedback)
**Tasks Completed**: Reviewed the current dispatcher-plan diff against the
shipped event/supervisor architecture and recorded follow-up feedback
**Tasks In Progress**: None
**Blockers**: None
**Notes**:
- The current architecture does not yet match the intended dispatcher purpose.
  The shipped event path is still shaped around a single binding-owned target
  workflow or a single supervised target chosen before dispatch, while the
  dispatcher design requires late target selection inside a supervisor-owned
  multi-run conversation.
- Add a new dispatcher example bundle instead of renaming
  `examples/default-superviser/`; the existing bundle is still referenced by
  the nested auto-improve superviser path, tests, and docs.
- Add an explicit binding-contract task for `src/events/types.ts` and
  `src/events/validate.ts`, plus loader updates in `src/events/config.ts`;
  today `EventExecutionMode` only supports `"direct"` / `"supervised"`,
  `EventWorkflowExecutionPolicy` has no `supervisorProfileId`,
  `EventBinding.workflowName` is required, `asBinding()` rejects missing
  `workflowName` before validation, and binding validation always resolves that
  workflow name, but the dispatcher design requires
  `execution.mode = "supervisor-dispatch"`,
  `execution.supervisorProfileId`, and optional `workflowName`.
- Add an explicit mailbox-bridge follow-up for
  `src/events/mailbox-bridge-policy.ts` and the related validation path; the
  current architecture only treats `execution.mode = "supervised"` as
  supervisor-owned input/output, so dispatcher bindings would otherwise fall
  back to `direct-workflow`, which conflicts with the external mailbox design.
- Add an explicit trigger-runner follow-up for `src/events/trigger-runner.ts`
  and related receipt/result semantics. The current event path still assumes
  `binding.workflowName` exists before dispatch for duplicate/skipped/failed
  returns and for the direct execution branch, but dispatcher mode intentionally
  defers target workflow selection until after the supervisor decision. The
  next plan revision should define what `WorkflowTriggerResult.workflowName`,
  receipt payloads, and sticky-session behavior mean before a managed target is
  chosen.
- Reflect those architecture mismatches in the split-plan deliverables instead
  of leaving them implicit. `workflow-supervisor-dispatcher-foundation.md`
  `TASK-001` currently omits `src/events/config.ts`, and
  `workflow-supervisor-dispatcher-runtime.md` `TASK-005` currently omits
  `src/events/ledger.ts` and `src/events/receipt-ops.ts` even though replay,
  receipt persistence, and listener response payloads all depend on the new
  dispatcher result shape.
- Keep plan tracking coherent when the split lands: the umbrella plan and
  `impl-plans/README.md` now point at
  `workflow-supervisor-dispatcher-foundation.md` and
  `workflow-supervisor-dispatcher-runtime.md`, but those files are still
  untracked in the current working tree and `impl-plans/PROGRESS.json` has no
  corresponding entries even though repository guidance treats it as the status
  source of truth.
- Avoid keeping three active plans for the same scope. If the split is the new
  source of truth, the umbrella plan should become a review/index document or
  otherwise stop presenting itself as a separate ready-to-execute active plan in
  `impl-plans/README.md`.
- Define one canonical direct-answer policy field, or an explicit precedence
  rule, before validation and runtime behavior are implemented. The design text
  uses default-policy language like `allowDirectAnswer = true`, while the
  example profile shape uses `directAnswerPolicy.enabled` and
  `allowedDecisionKinds`.
- Recommended next implementation order for the next iteration: first land the
  event-binding schema changes (`supervisor-dispatch`, optional
  `workflowName`, required `supervisorProfileId`), then mailbox-bridge
  ownership/defaults, then conversation/persistence contracts, and only after
  that wire runtime dispatch, GraphQL, and packaged examples.

### Session: 2026-04-30 00:45 (architecture review refinement)
**Tasks Completed**: Verified the review feedback against the current source
tree and added concrete follow-up items that were still implicit
**Tasks In Progress**: None
**Blockers**: None
**Notes**:
- The current architecture mismatch is confirmed in code, not just in the
  design: `src/events/config.ts` still rejects bindings without
  `workflowName`, `src/events/validate.ts` still validates every binding
  against a concrete workflow name, and `src/events/types.ts` still limits
  `EventExecutionMode` to `"direct"` / `"supervised"`.
- The dispatcher split should explicitly treat current
  `supervisor-intent` / `supervisor-llm-resolver` behavior as single-target
  only. Both paths currently derive or validate one target from
  `binding.workflowName`, so `TASK-002` is not a small extension of the
  shipped contract; it is a deliberate contract generalization away from
  target-name equality with the binding itself.
- Add dispatcher receipt/index plumbing to the plan, not just trigger routing.
  `src/workflow/runtime-db.ts`, `src/events/ledger.ts`,
  `src/events/receipt-ops.ts`, and `src/events/listener-service.ts` currently
  expose only `workflowExecutionId`, `supervisedRunId`, and
  `supervisorExecutionId`. The dispatcher design also needs a durable
  `supervisorConversationId` and likely a `supervisorDecisionId` so replay,
  inspection, and webhook/listener responses can point at the supervisor-owned
  conversation before or even without a selected target execution.
- The split-plan deliverables should reflect those storage and surface changes
  explicitly:
  `workflow-supervisor-dispatcher-foundation.md` `TASK-003` should mention
  `src/workflow/runtime-db.ts` receipt-index shape changes alongside the new
  conversation repository, and `workflow-supervisor-dispatcher-runtime.md`
  `TASK-005` should mention `src/events/ledger.ts`,
  `src/events/receipt-ops.ts`, and listener response shaping alongside
  `trigger-runner.ts`.
- The umbrella-plan review should keep the example guidance strict: the new
  dispatcher example should be additive. `examples/default-superviser/` is
  still the documented nested auto-improve bundle, and the repository
  references that exact path in `examples/README.md` and
  `examples/auto-improve/README.md`.
- `impl-plans/PROGRESS.json` still has no dispatcher entries at all, while
  `impl-plans/README.md` now lists three active dispatcher plans. If the split
  remains, the next planning iteration should update the progress tracker in
  the same change set or clearly state that the tracker update is intentionally
  deferred.

### Session: 2026-05-01 (TASK-002 dispatch LLM resolver + foundation closure)
**Tasks Completed**: Foundation plan `workflow-supervisor-dispatcher-foundation`
  complete: `runSupervisorDispatchLlmResolver`,
  `interpretSupervisorDispatchResolverRootJson`,
  `supervisor-llm-resolver-dispatch.test.ts`; `PROGRESS.json` phase 151 and
  foundation tasks marked completed.
**Tasks In Progress**: Runtime plan `TASK-004` dispatch client and
  `trigger-runner` supervisor-dispatch path.
**Blockers**: None
**Notes**: Prior TASK-003 persistence notes unchanged; next implementation chunk
  is runtime dispatch service (`supervisor-dispatch-client` per runtime plan).

### Session: 2026-05-01 (TASK-003 persistence)
**Tasks Completed**: SQLite persistence for supervisor dispatcher conversations:
  new tables and `runtime-db` accessors, `supervisor-conversations` repository
  with CAS conversation updates, managed-run upsert/list, decision insert dedupe
  by `(supervisorConversationId, sourceMessageId)`, and
  `supervisor-conversations.test.ts`.
**Tasks In Progress**: Foundation TASK-002 resolver wiring with runtime; runtime
  plan TASK-004+ after dispatch client.
**Blockers**: None
**Notes**: Receipt index columns for `supervisorConversationId` /
  `supervisorDecisionId` remain for the runtime plan (TASK-005/006).

### Session: 2026-05-01 (current diff review feedback)
**Tasks Completed**: Same change set as TASK-003 persistence above; prior review
  bullets below are retained as open design follow-ups where still applicable.
**Tasks In Progress**: Runtime TASK-004+ only; foundation plan is complete and
  runtime integration owns the remaining dispatcher wiring.
**Blockers**: None
**Notes**:
- Correlation uniqueness: `supervisor_conversations` currently has only a
  lookup index on `(source_id, binding_id, correlation_key, updated_at)`, and
  `findSupervisorConversationByCorrelationInRuntimeDb` returns the newest
  active/idle row. Add a deterministic single-conversation rule for concurrent
  first-message races, ideally with a repository/runtime-level guard and, if
  feasible in SQLite, a partial uniqueness constraint for active/idle rows.
- Atomic mutation path: combine decision dedupe, conversation CAS, and
  managed-run updates in one transaction boundary for runtime dispatch (still
  open; repository primitives are separate calls today).
- Alias uniqueness: consider a partial unique index or deterministic conflict
  rule for `(supervisor_conversation_id, managed_workflow_key, run_alias)` when
  `run_alias` IS NOT NULL.
- Receipt/index propagation: extend `event_receipts` and related surfaces with
  `supervisorConversationId` / `supervisorDecisionId` in the runtime plan
  (TASK-005/006).
- Repository tests: `supervisor-conversations.test.ts` covers CAS stale
  rejection, decision dedupe, managed-run upsert, and correlation lookup; extend
  for duplicate-correlation races, alias conflicts, and malformed selection JSON
  when those rules land.
- Plan/tracker consistency: `impl-plans/PROGRESS.json` now contains the
  foundation entry, so the remaining tracker work is to update the runtime plan
  itself when TASK-004 actually begins (`Last Updated`, task status, and
  progress log are still pre-implementation).

### Session: 2026-05-01 (review follow-up against current runtime diff)
**Tasks Completed**: Reviewed the current dispatcher runtime implementation
  diff and re-checked the new repository/resolver tests.
**Tasks In Progress**: `workflow-supervisor-dispatcher-runtime.md` `TASK-004`
  is substantively in progress in the worktree; `TASK-005+` remain blocked on
  closing the runtime idempotency and targeting gaps below.
**Blockers**: None
**Notes**:
- Cross-process correlation races remain unresolved. The new runtime path still
  does `findConversationByCorrelation` followed by `insertConversation`, while
  `supervisor_conversations` has only a lookup index on
  `(source_id, binding_id, correlation_key, updated_at)`. That means two
  workers handling the same first message can create separate active
  conversations and later reads silently pick the newest row.
- Source-message replay is not yet a true mutation guard. In the current
  dispatch client, runtime side effects are applied before
  `insertDispatchDecisionIfAbsent` records the `(supervisorConversationId,
  sourceMessageId)` claim, so duplicate deliveries racing outside the in-process
  queue can still start/stop/restart workflows twice before the decision dedupe
  row exists. `TASK-004` should define a single transaction or reservation step
  that claims the source message before mutating managed runs/conversation
  state.
- Alias targeting is still ambiguous. Runtime lookup resolves
  `(managedWorkflowKey, runAlias)` by first match, but persistence does not
  enforce uniqueness for `(supervisor_conversation_id, managed_workflow_key,
  run_alias)`. Add a unique constraint or explicit conflict error before
  parallel alias-based targeting is treated as deterministic.
- Runtime-plan bookkeeping is now behind the code. The worktree already
  contains `src/workflow/supervisor-dispatch-client.ts`, but
  `workflow-supervisor-dispatcher-runtime.md` still says `Status: Ready`,
  module `NOT_STARTED`, and `TASK-004` `Ready`. Update that plan's status,
  `Last Updated`, and progress log in the same change stream so plan state
  matches the implementation state.

### Session: 2026-05-01 (current diff review refresh after runtime updates)
**Tasks Completed**: Re-reviewed the latest dispatcher runtime diff after the
  follow-up changes in `runtime-db`, `supervisor-dispatch-client`, the runtime
  split plan, and `PROGRESS.json`.
**Tasks In Progress**: Runtime `TASK-005` / `TASK-007` follow-ups for
  user-visible replies, ambiguous-target rejection, and receipt-surface
  propagation.
**Blockers**: None
**Notes**:
- The latest diff closes several earlier concerns: `src/workflow/runtime-db.ts`
  now adds partial uniqueness for active conversations and scoped run aliases,
  `src/workflow/supervisor-dispatch-client.ts` now reserves each
  `(supervisorConversationId, sourceMessageId)` with a `proposed` decision row
  before lifecycle side effects, and
  `workflow-supervisor-dispatcher-runtime.md` now reflects active runtime work.
- User-visible dispatcher replies are still incomplete. The new
  `src/events/supervisor-control-reply.ts`
  `buildDispatchControlExternalOutputMessage()` path always emits generic
  control metadata and ignores `view.proposal.reply`, while
  `src/events/trigger-runner.ts` uses only that helper for
  `supervisor-dispatch`. `answer-directly` / `status` therefore do not yet
  publish the supervisor-authored reply body or managed-run summary promised by
  the design.
- Ambiguous multi-run targeting is still not rejected deterministically.
  `src/events/supervisor-dispatch-contract.ts`
  `validateSupervisorDispatchProposalAgainstContext()` checks key existence and
  direct-answer policy, but it does not reject `submit-input` /
  `restart-workflow` / `stop-workflow` / `switch-workflow` proposals that name
  only `managedWorkflowKey` when multiple runs for that key exist.
  `src/workflow/supervisor-dispatch-client.ts` `findRunForTarget()` then falls
  back to the selected run or the first `running` / `starting` run, which is
  only deterministic for single-selected conversations.
- Dispatcher identities are still transient at the receipt layer.
  `src/events/trigger-runner.ts` now returns `supervisorConversationId` /
  `supervisorDecisionId`, but `src/events/types.ts` `EventReceiptRecord` and
  `src/events/ledger.ts` `updateEventReceipt()` still persist only
  `workflowExecutionId`, `supervisedRunId`, and `supervisorExecutionId`.
  Replay/listing/listener surfaces therefore cannot recover the supervisor
  conversation / decision ids without re-reading `dispatch.json`.
- Result identity semantics are mixed on the dispatch branch.
  `src/events/trigger-runner.ts` returns
  `workflowName = view.conversation.supervisorWorkflowName` while
  `workflowExecutionId` is derived from the selected managed run. Any consumer
  that treats `(workflowName, workflowExecutionId)` as one execution identity
  will see a supervisor workflow name paired with a managed target execution id.
  Define whether dispatcher mode should return the managed target workflow name,
  leave `workflowName` unset, or expose separate supervisor-vs-target fields.
- Focused event-path tests are still missing for the remaining dispatcher
  runtime behavior. The current additions cover repository persistence and
  resolver parsing, but there is still no trigger-runner coverage for replay,
  ambiguous targeting, or direct-answer/status reply publication.

### Session: 2026-05-01 (review refresh against latest worktree)
**Tasks Completed**: Re-checked the umbrella plan against the current
  implementation diff, including `runtime-db`, `trigger-runner`,
  `supervisor-dispatch-contract`, `supervisor-control-reply`, and the runtime
  split plan.
**Tasks In Progress**: Runtime `TASK-005` event-path closure and any follow-up
  runtime work needed to align `switch-workflow` behavior with the design spec.
**Blockers**: None
**Notes**:
- Design/runtime mismatch remains on `switch-workflow`. The design explicitly
  allows `switch-workflow` to start the target when the profile permits
  `startOnSwitch`, and to optionally stop the previously selected run via
  `stopOnSwitch`
  (`design-docs/specs/design-workflow-supervisor-dispatcher.md`:547-550).
  The current contract/runtime instead require
  `targets[0].managedRunId` and fail if the run does not already exist
  (`src/events/supervisor-dispatch-contract.ts`,
  `src/workflow/supervisor-dispatch-client.ts`). This should be tracked as an
  open runtime gap rather than treating `switch-workflow` as fully delivered.
- Several older review bullets in this umbrella plan are now stale and should be
  read as historical only, not current blockers. The current diff already:
  adds receipt/index propagation for `supervisorConversationId` /
  `supervisorDecisionId`; rejects ambiguous key-only managed-run targeting;
  includes `proposal.reply` in dispatch control output; and returns a target
  workflow name when a managed target execution id is available.
- Focused `trigger-runner` coverage is still missing for the
  `supervisor-dispatch` path. The current tests cover repository and contract
  behavior, but there is still no event-path test proving replay handling,
  ambiguous-target rejection, or dispatcher reply publication from
  `createWorkflowTriggerRunner`.
- Follow-up commit in the same stream: SQLite `event_receipts` columns
  `supervisor_conversation_id` / `supervisor_decision_id`, `ledger`/`listener`
  wiring, managed-target `workflowName` on the dispatch result when an
  execution id is present, and contract tests for ambiguous targeting plus
  `switch-workflow` `managedRunId` enforcement.

### Session: 2026-05-02 (TASK-007 closure)

**Tasks Completed**: Example bundle and fixtures for supervisor dispatch (`examples/default-supervisor-dispatcher/`, new workflows, event-source profile/binding/payloads); `workflow-supervisor-dispatcher-runtime` plan + `PROGRESS.json` phase 152 marked completed.
**Tasks In Progress**: None for dispatcher umbrella scope.
**Blockers**: None
**Notes**: `switch-workflow` with `startOnSwitch` / `stopOnSwitch` is implemented in runtime and contract tests. Trigger-runner covers rejected-decision replay (same supervisor `sourceMessageId`, new receipt after binding `dedupeWindowMs`). Optional: GraphQL transport tests for dispatcher replay/stale semantics.

### Session: 2026-05-01 (TASK-005 closure + trigger-runner tests)
**Tasks Completed**: Runtime plan `TASK-005` marked completed in `PROGRESS.json`;
  `workflow-supervisor-dispatcher-runtime.md` updated; added supervisor-dispatch
  coverage in `src/events/trigger-runner.test.ts` (replay via `dedupeWindowMs`,
  `proposal.reply` chat output, ambiguous parallel-run `submit-input`).
**Tasks In Progress**: TASK-006 GraphQL/library entrypoints; TASK-007 examples.
**Blockers**: None
**Notes**:
- Subsequent sessions landed design-aligned `switch-workflow` (`startOnSwitch` / `stopOnSwitch`) and expanded trigger-runner coverage (rejected-decision replay).

### Session: 2026-05-01 (review feedback against current diff)
**Tasks Completed**: Re-reviewed the umbrella/runtime plan changes against the
  current dispatcher implementation diff and refreshed the still-open feedback.
**Tasks In Progress**: None
**Blockers**: None
**Notes**:
- `switch-workflow` is still not design-complete. The design allows
  `startOnSwitch` / `stopOnSwitch` behavior without requiring a pre-existing
  managed run, but the current contract/runtime continue to require
  `targets[0].managedRunId` and only retarget an existing run. Keep this as an
  open runtime follow-up rather than treating dispatcher delivery as fully
  closed.
- The plan status is now overstated. Both this umbrella file and
  `workflow-supervisor-dispatcher-runtime.md` say `Completed`, while the latest
  notes still acknowledge the unresolved design/runtime gap above. Either keep
  the status open or split the remaining `switch-workflow` behavior into an
  explicit follow-up task.
- `workflow-supervisor-dispatcher-runtime.md` also overstates dispatcher
  GraphQL verification. The current dispatcher GraphQL tests cover mode
  rejection, missing-conversation failure, and happy-path payload parsing, but
  they do not yet exercise dispatcher replay/stale behavior or dispatcher auth
  boundaries end-to-end. Narrow the checklist wording or add those transport
  tests before treating TASK-006 verification as complete.

### Session: 2026-05-01 (review refresh against latest git diff)
**Tasks Completed**: Re-reviewed `impl-plans/workflow-supervisor-dispatcher.md`
  against the current dispatcher worktree diff, including the runtime split
  plan, `supervisor-dispatch-client`, `supervisor-dispatch-contract`, and the
  GraphQL/schema tests.
**Tasks In Progress**: None
**Blockers**: None
**Notes**:
- The older `switch-workflow` blocker immediately above is now stale. The
  current contract/runtime supports `lifecycle.startOnSwitch` without a
  pre-existing `managedRunId` and applies `stopOnSwitch` to the previously
  selected run when configured
  (`src/events/supervisor-dispatch-contract.ts`,
  `src/workflow/supervisor-dispatch-client.ts`). Future readers should treat
  that earlier bullet as historical review context, not a current gap.
- The remaining plan-level mismatch is verification wording, not runtime
  behavior. `workflow-supervisor-dispatcher-runtime.md` `TASK-006` still marks
  "`Auth boundaries and stale/replay semantics are preserved through transport
  tests`" as complete, but the current dispatcher GraphQL coverage only proves
  mode rejection and missing-conversation failure in
  `src/graphql/schema.test.ts`, plus happy-path payload parsing in
  `src/workflow/supervisor-graphql-client.test.ts`. There is still no
  dispatcher-specific GraphQL replay/stale transport test and no dispatcher
  auth-boundary test, so either narrow that checklist line or add the missing
  transport coverage before using it as evidence for closure.

### Session: 2026-05-02 (unresolved TODO closure)
**Tasks Completed**: Closed the stale unresolved-TODO trail from recent
dispatcher commits. The split plans and `impl-plans/PROGRESS.json` already mark
foundation `TASK-001` through `TASK-003` and runtime `TASK-004` through
`TASK-007` completed. Current tests include dispatcher GraphQL replay coverage
for same-`sourceMessageId` decisions and GraphQL rejection of non-dispatch
bindings, so the older review note above is historical rather than an active
implementation gap.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: `workflow-supervisor-dispatcher-runtime.md` TASK-006 wording now
names the concrete GraphQL coverage instead of overstating unspecified
stale/auth-boundary tests. No dispatcher implementation TODO remains open in
this umbrella scope.
