# Workflow Supervisor Dispatcher Runtime Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-workflow-supervisor-dispatcher.md`
**Created**: 2026-04-30
**Last Updated**: 2026-05-02

## Related Plans

- **Previous**: `impl-plans/workflow-supervisor-dispatcher-foundation.md`
- **Depends On**: `impl-plans/workflow-supervisor-dispatcher-foundation.md`
- **Related**: `impl-plans/workflow-supervisor-dispatcher.md`
- **Related**: `impl-plans/completed/event-external-mailbox-binding-foundation.md`

## Design Document Reference

**Source**: `design-docs/specs/design-workflow-supervisor-dispatcher.md`,
`design-docs/specs/design-event-external-mailbox-binding.md`,
`design-docs/specs/architecture.md#event-listener-workflow-triggers`

### Summary

Build the runtime path that consumes the dispatcher foundation: apply validated
supervisor decisions, route `supervisor-dispatch` event bindings, expose local
and GraphQL entrypoints, and add examples and focused verification.

### Scope

**Included**: runtime dispatch service and scoped capabilities, mailbox/event
integration, GraphQL/server/library dispatcher entrypoints, packaged dispatcher
examples, and focused tests.

**Excluded**: TUI surfacing, profile migration tooling, and long-lived resumed
supervisor executions.

## Modules

### 1. Runtime Dispatch Service And Scoped Capabilities

#### `src/workflow/supervisor-dispatch-client.ts`, `src/workflow/supervisor-client.ts`, `src/workflow/superviser-control.ts`, `src/lib.ts`

**Status**: COMPLETED (supervisor-client / superviser-control unchanged; library exports added)

```typescript
export interface DispatchSupervisorConversationInput extends LoadOptions {
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly supervisorProfileId: string;
  readonly sourceMessageId: string;
  readonly event: ExternalEventEnvelope;
}

export interface WorkflowSupervisorDispatchClient {
  dispatchExternalInput(
    input: DispatchSupervisorConversationInput,
  ): Promise<WorkflowSupervisorDispatchView>;
}

export interface SupervisorRuntimeCapabilitySet {
  startManagedWorkflow(input: StartManagedWorkflowInput): Promise<ManagedWorkflowRunRecord>;
  submitManagedInput(input: SubmitManagedWorkflowInput): Promise<ManagedWorkflowRunRecord>;
  stopManagedWorkflow(input: StopManagedWorkflowInput): Promise<ManagedWorkflowRunRecord>;
}
```

**Checklist**:

- [x] Implement one dispatcher entrypoint that validates proposals and applies compare-and-swap updates
- [x] Scope lifecycle actions to the pinned profile snapshot and conversation-owned runs
- [x] Normalize terminal-run `submit-input` behavior in one runtime layer
- [x] Enforce alias uniqueness and selection updates for `single-selected` and `multiple-active` (SQLite partial unique index on non-null `run_alias` per conversation and key; upsert surfaces a clear duplicate-alias error)

### 2. Event Trigger And External Mailbox Integration

#### `src/events/trigger-runner.ts`, `src/events/dispatch-supervisor-chat.ts`, `src/events/listener-service.ts`, `src/events/mailbox-bridge-policy.ts`

**Status**: COMPLETED (TASK-005: trigger-runner `supervisor-dispatch` path, receipts, replies; replay/ambiguity/direct-answer coverage in `trigger-runner.test.ts`)

```typescript
export interface WorkflowTriggerResult {
  readonly workflowExecutionId?: string;
  readonly supervisedRunId?: string;
  readonly supervisorConversationId?: string;
  readonly supervisorDecisionId?: string;
}
```

**Checklist**:

- [x] Route `supervisor-dispatch` bindings through the new dispatch client
- [x] Preserve `execution.mode = "supervised"` behavior unchanged
- [x] Use supervisor conversation ownership for runtime-published external output
- [x] Test replay, ambiguous parallel-run targeting, and duplicate-source suppression (`trigger-runner.test.ts` supervisor-dispatch describe); stale-decision rejection remains stronger at repository/dispatch-client layers than in trigger-runner assertions

### 3. GraphQL, Library Surface, And Verification Assets

#### `src/graphql/types.ts`, `src/graphql/schema.ts`, `src/server/graphql-executable-schema.ts`, `src/workflow/supervisor-graphql-client.ts`, `examples/default-supervisor-dispatcher/`

**Status**: COMPLETED (GraphQL mutation/query + remote `postDispatchSupervisorConversationThroughGraphql`; TASK-007 example bundle + fixtures landed 2026-05-02)

```typescript
export interface DispatchSupervisorConversationGraphqlInput {
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly supervisorProfileId: string;
  readonly sourceMessageId: string;
  readonly event: Readonly<Record<string, unknown>>;
}

export interface DispatchSupervisorConversationPayload {
  readonly accepted: boolean;
  readonly view?: WorkflowSupervisorConversationView;
  readonly error?: string;
}
```

**Checklist**:

- [x] Add GraphQL inputs and payloads for dispatch and conversation reads
- [x] Expose the same dispatcher contract through local and remote clients (`postDispatchSupervisorConversationThroughGraphql`)
- [x] Package a default dispatcher example with supervisor profile files and managed workflow examples (`examples/default-supervisor-dispatcher/`, `divedra-default-workflow-supervisor`, `dispatcher-llm-resolver-stub`, event fixtures)
- [x] Cover direct answer and start managed runs via mock scenarios; ambiguity rejection and replay safety covered in `trigger-runner.test.ts` / contract tests (`switch-workflow` supports `lifecycle.startOnSwitch` without `managedRunId` and `stopOnSwitch` on the prior selection; optional `runAlias`-only switch remains a narrow follow-up).

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Runtime dispatch client | `src/workflow/supervisor-dispatch-client.ts`, `src/workflow/supervisor-client.ts`, `src/workflow/superviser-control.ts`, `src/lib.ts` | COMPLETED | in-client behavior covered by foundation/dispatch-contract tests; dedicated dispatch-client integration tests still optional |
| Event integration | `src/events/trigger-runner.ts`, `src/events/dispatch-supervisor-chat.ts`, `src/events/listener-service.ts`, `src/events/mailbox-bridge-policy.ts` | COMPLETED (TASK-005) | `trigger-runner.test.ts` supervisor-dispatch bindings + existing supervised regressions |
| GraphQL/library surface and examples | `src/graphql/types.ts`, `src/graphql/schema.ts`, `src/server/graphql-executable-schema.ts`, `src/workflow/supervisor-graphql-client.ts`, `examples/default-supervisor-dispatcher/` | COMPLETED | `schema.test.ts`, `supervisor-graphql-client.test.ts`, dispatcher demo fixtures |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| TASK-004 Runtime dispatch service and scoped capabilities | foundation `TASK-002`, foundation `TASK-003` | READY (foundation complete) |
| TASK-005 Event binding routing for `supervisor-dispatch` | TASK-004 | COMPLETED |
| TASK-006 GraphQL and library dispatcher entrypoints | TASK-004 | COMPLETED |
| TASK-007 Examples and focused test coverage | TASK-005, TASK-006 | COMPLETED |

## Tasks

### TASK-004: Runtime Dispatch Service And Scoped Capabilities

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- foundation `TASK-002`
- foundation `TASK-003`

**Deliverables**:

- `src/workflow/supervisor-dispatch-client.ts`
- `src/workflow/supervisor-client.ts`
- `src/workflow/superviser-control.ts`
- `src/lib.ts`
- focused runtime tests for idempotency, stale state, and alias selection

**Completion Criteria**:

- [x] One runtime entrypoint validates and applies dispatch proposals
- [x] Lifecycle actions are limited to conversation-owned runs within the pinned profile
- [x] Terminal-run follow-up input is normalized as clarify/restart/fork in one place
- [x] `runAlias` uniqueness and selection updates are deterministic and test-covered (partial unique index + repository test; runtime selection still first-match when duplicates existed pre-migration)

### TASK-005: Event Binding Routing For `supervisor-dispatch`

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-004`

**Deliverables**:

- `src/events/trigger-runner.ts`
- `src/events/dispatch-supervisor-chat.ts`
- `src/events/listener-service.ts`
- `src/events/mailbox-bridge-policy.ts`
- event-path tests for replay and ambiguity handling

**Completion Criteria**:

- [x] Dispatcher mode routes through the new runtime client
- [x] Existing supervised mode remains backward compatible
- [x] External output ownership stays bound to the supervisor conversation
- [x] Replay, ambiguous target failures, and duplicate replay paths covered by tests (stale-decision rejection primarily enforced pre-mutation in dispatch client + SQLite constraints)

### TASK-006: GraphQL And Library Dispatcher Entrypoints

**Status**: Completed
**Parallelizable**: Yes

**Dependencies**:

- `TASK-004`

**Deliverables**:

- `src/graphql/types.ts`
- `src/graphql/schema.ts`
- `src/server/graphql-executable-schema.ts`
- `src/workflow/supervisor-graphql-client.ts`
- GraphQL schema and HTTP transport tests

**Completion Criteria**:

- [x] GraphQL exposes dispatcher mutation and conversation read surfaces
- [x] Local and remote clients share the same dispatcher semantics (`dispatchSupervisorConversation` / `supervisorDispatchConversation` + `postDispatchSupervisorConversationThroughGraphql`)
- [x] Auth boundary and replay semantics are covered through GraphQL transport tests (`dispatchSupervisorConversation` rejects non-dispatch bindings; same `sourceMessageId` replays the stored dispatch decision without invoking the resolver again). Dispatch idempotency remains enforced in the runtime client and persistence layer.
- [x] Terminal-input normalization is observable through GraphQL payloads (mutation returns full `DispatchSupervisorConversationPayload` including `proposal` / `applied`)

### TASK-007: Examples And Focused Test Coverage

**Status**: Completed
**Parallelizable**: Yes

**Dependencies**:

- `TASK-005`
- `TASK-006`

**Deliverables**:

- `examples/default-supervisor-dispatcher/`
- `examples/event-sources/`
- focused tests under `src/events/*.test.ts` and `src/workflow/*.test.ts`

**Completion Criteria**:

- [x] Packaged examples include supervisor profiles and managed workflow catalog entries
- [x] Example flows document `single-active` managed runs and mock-backed terminal/direct-answer paths
- [x] Focused tests cover replay, ambiguity rejection, and dispatcher replies (`trigger-runner.test.ts`, contract tests); exhaustive stop/restart/status matrix remains optional follow-up
- [x] Parallel-run alias rules and replay safety covered in targeted repository/trigger tests

## Completion Criteria

- [x] Runtime, event, GraphQL, and example TODOs are mapped to executable tasks
- [x] Runtime tasks describe the concrete files and tests needed for delivery
- [x] The runtime plan depends only on the foundation contracts defined upstream

## Progress Log

### Session: 2026-05-01 (idempotency hardening)

**Tasks Completed**: Partial unique index for active supervisor conversations per correlation; partial unique index for `(conversation, managed_workflow_key, run_alias)` when `run_alias` is set; `updateDispatchDecisionFromProposed` + dispatch-client **claim row** (`proposed` with `__dispatch_claim__`) before resolver/apply, wait loop for concurrent `proposed`, finalize to `applied`/`rejected`; cross-process duplicate source-message guard; alias duplicate upsert error mapping; repository tests.
**Tasks In Progress**: TASK-005 replay/ambiguity trigger-runner tests; TASK-006 GraphQL.
**Blockers**: None
**Notes**: Resolver failures still throw on first attempt after persisting `rejected` so receipts stay failed; a later redispatch with the same `sourceMessageId` can return the stored rejected view without throwing.

### Session: 2026-05-01 (TASK-005 trigger-runner integration tests)

**Tasks Completed**: Supervisor-dispatch integration tests in `src/events/trigger-runner.test.ts`: receipt dedupe window vs supervisor `sourceMessageId` replay (spy on `runSupervisorDispatchLlmResolver`), `proposal.reply` in chat replies, ambiguous parallel-run `submit-input` via mocked resolver sequence + `dispatch.json` artifact assertions.
**Tasks In Progress**: TASK-006 GraphQL; TASK-007 examples (unblocked from TASK-005 only).
**Blockers**: None
**Notes**: Resolver workflow mock arrays cannot advance across separate dispatch invocations (each resolver run resets scenario indices); multi-step dispatch scenarios use `mockResolvedValueOnce` on `runSupervisorDispatchLlmResolver`. Profiles with `multiple-active` must set `requiresAliasForParallelRuns: true` per `supervisor-profiles` validation.

### Session: 2026-05-01 (TASK-005 targeting, replies, receipt index)

**Tasks Completed**: Ambiguous key-only `submit-input` / `stop-workflow` / `restart-workflow` rejected in `validateSupervisorDispatchProposalAgainstContext` when multiple same-key runs lack `managedRunId`, `runAlias`, or per-key selection; `switch-workflow` requires `managedRunId`; validation context includes conversation selection fields from the dispatch client; `buildDispatchControlExternalOutputMessage` surfaces `proposal.reply` (`text` / `markdown` / `body` / `message`) ahead of control metadata and adds `dispatchProposalReply` to the payload; `event_receipts` persists `supervisor_conversation_id` and `supervisor_decision_id`; dispatch trigger results use the managed target `workflowName` when a managed `workflowExecutionId` is present; listener webhook responses include `workflowName` and supervisor ids. Added contract tests for ambiguity, selection disambiguation, and `switch-workflow`.
**Tasks In Progress**: TASK-005 replay/stale-decision trigger-runner tests; TASK-006 GraphQL.
**Blockers**: None
**Notes**: Replay-focused supervisor-dispatch trigger-runner tests now cover applied-decision replay, rejected-decision replay, ambiguous targeting, and proposal reply publication.

### Session: 2026-05-01

**Tasks Completed**: TASK-004 (runtime dispatch client + `lib` exports); TASK-005 partial (trigger-runner `supervisor-dispatch` path, external-output helper `buildDispatchControlExternalOutputMessage`, `WorkflowTriggerResult` supervisor fields)
**Tasks In Progress**: TASK-005 (focused event-path tests for replay and ambiguous targets)
**Blockers**: None
**Notes**: Extracted `WorkflowTriggerRunnerOptions` to `src/events/workflow-trigger-runner-options.ts` to avoid import cycles between `supervisor-dispatch-client` and `trigger-runner`.

### Session: 2026-05-02 (TASK-006 GraphQL)

**Tasks Completed**: GraphQL `dispatchSupervisorConversation` / `supervisorDispatchConversation`; `parseExternalEventEnvelopeFromGraphql`; optional `workflowName` for `supervisor-dispatch` in `parseEventBindingFromGraphql`; `postDispatchSupervisorConversationThroughGraphql`; schema and graphql-client tests; `lib` export.
**Tasks In Progress**: TASK-007 examples bundle only.
**Blockers**: None
**Notes**: Example directory `examples/default-supervisor-dispatcher/` still pending per TASK-007.

### Session: 2026-05-02 (TASK-007 examples bundle)

**Tasks Completed**: Shipped `examples/default-supervisor-dispatcher/` (README, mock scenarios), workflows `divedra-default-workflow-supervisor` and `dispatcher-llm-resolver-stub`, profile `event-sources/.divedra-events/supervisors/default-chat-dispatcher.json`, binding `webhook-supervisor-dispatch-demo.json`, payloads `chat-supervisor-dispatch*.json`; documented dedupe behavior across sequential emits; validated `events validate` / mock emits end-to-end.
**Tasks In Progress**: None.
**Blockers**: None
**Notes**: See Session 2026-05-01 (design-aligned switch-workflow) for `startOnSwitch` / `stopOnSwitch` closure.

### Session: 2026-05-01 (design-aligned switch-workflow)

**Tasks Completed**: `switch-workflow` without `managedRunId` when `lifecycle.startOnSwitch` is true: validation allows key-only switch when at most one running/starting run exists for the key; runtime selects that run or starts a new managed run (with concurrency checks) and always updates per-key selection; `lifecycle.stopOnSwitch` on the previously selected run's managed workflow stops that run before retargeting; shared `persistStoppedManagedRun` for `stop-workflow` and switch stop path; contract tests for startOnSwitch and ambiguity.
**Tasks In Progress**: None.
**Blockers**: None
**Notes**: Added trigger-runner coverage for replay of a **rejected** dispatch decision (same supervisor `sourceMessageId` / event `dedupeKey`, new receipt after binding dedupe window). Optional follow-up remains: richer `switch-workflow` with `runAlias`-only disambiguation without `managedRunId`.

### Session: 2026-05-02 (rejected-decision replay trigger-runner test)

**Tasks Completed**: `src/events/trigger-runner.test.ts` asserts `runSupervisorDispatchLlmResolver` is not invoked again when a validation-rejected dispatch row already exists for the same source message and a later webhook creates a fresh receipt outside `dedupeWindowMs`.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Complements the applied-decision replay test; clarifies that “stale” supervisor replay includes rejected outcomes stored by `finalizeDispatchDecisionFromProposed(..., rejected)`.

### Session: 2026-05-02 (TASK-006 verification wording closure)

**Tasks Completed**: Closed the stale TASK-006 verification wording TODO by tying
the checklist to the current GraphQL coverage: non-dispatch binding rejection in
`src/graphql/schema.test.ts` and same-`sourceMessageId` dispatcher replay in the
`dispatchSupervisorConversation GraphQL integration` test.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: No runtime behavior change; this only resolves the lingering plan
wording mismatch recorded in the umbrella review log.
