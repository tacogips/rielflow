# Workflow Supervisor Dispatcher Foundation Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-workflow-supervisor-dispatcher.md`
**Created**: 2026-04-30
**Last Updated**: 2026-05-01

## Related Plans

- **Previous**: `impl-plans/workflow-supervisor-dispatcher.md`
- **Next**: `impl-plans/workflow-supervisor-dispatcher-runtime.md`
- **Depends On**: `impl-plans/completed/event-supervisor-control-foundation.md`
- **Depends On**: `impl-plans/completed/supervisor-natural-language-control.md`
- **Related**: `impl-plans/completed/event-external-mailbox-binding-foundation.md`

## Design Document Reference

**Source**: `design-docs/specs/design-workflow-supervisor-dispatcher.md`,
`design-docs/specs/design-event-supervisor-control.md`,
`design-docs/specs/design-event-external-mailbox-binding.md`

### Summary

Define the dispatcher foundation: validated supervisor profiles, a structured
decision contract, and durable supervisor conversation state that can support
compare-and-swap runtime mutation.

### Scope

**Included**: `supervisor-dispatch` execution mode, profile loader/validator,
dispatcher proposal parsing, resolver context shape, supervisor conversation and
managed-run persistence, and decision dedupe primitives.

**Excluded**: runtime lifecycle mutation orchestration, event routing, GraphQL
transport, and packaged examples.

## Modules

### 1. Supervisor Profile Types And Validation

#### `src/events/types.ts`, `src/events/validate.ts`, `src/events/supervisor-profiles.ts`

**Status**: COMPLETED

```typescript
export type EventExecutionMode = "direct" | "supervised" | "supervisor-dispatch";

export interface WorkflowSupervisorProfile {
  readonly supervisorProfileId: string;
  readonly profileRevision: string;
  readonly supervisorWorkflowName: string;
  readonly managedWorkflows: readonly ManagedWorkflowDefinition[];
  readonly conversationPolicy?: SupervisorConversationPolicy;
  readonly directAnswerPolicy?: SupervisorDirectAnswerPolicy;
}

export interface ManagedWorkflowDefinition {
  readonly key: string;
  readonly workflowName: string;
  readonly aliases?: readonly string[];
  readonly allowedActions?: readonly ManagedWorkflowAction[];
  readonly concurrency?: ManagedWorkflowConcurrencyPolicy;
  readonly lifecycle?: ManagedWorkflowLifecyclePolicy;
}
```

**Checklist**:

- [x] Add `supervisor-dispatch` as a valid event execution mode
- [x] Define profile, managed-workflow, lifecycle, and concurrency types
- [x] Validate lifecycle/concurrency combinations and direct-answer policy
- [x] Implement profile loading helpers with focused tests

### 2. Dispatch Decision Contract And Resolver Context

#### `src/events/supervisor-dispatch-contract.ts`, `src/events/supervisor-llm-resolver.ts`, `src/events/supervisor-command-contract.ts`

**Status**: COMPLETED

```typescript
export type SupervisorDispatchAction =
  | "answer-directly"
  | "start-workflow"
  | "submit-input"
  | "switch-workflow"
  | "stop-workflow"
  | "restart-workflow"
  | "status"
  | "clarify"
  | "no-op";

export interface SupervisorDispatchProposal {
  readonly action: SupervisorDispatchAction;
  readonly targets?: readonly SupervisorDispatchTarget[];
  readonly confidence?: number;
  readonly reason: string;
}

export interface WorkflowSupervisorDispatchContext {
  readonly supervisorConversationId: string;
  readonly profile: WorkflowSupervisorProfile;
  readonly sourceMessageId: string;
  readonly conversationRevision: number;
  readonly managedRuns: readonly ManagedWorkflowRunRecord[];
}
```

**Checklist**:

- [x] Generalize the current supervisor command schema into dispatcher actions
- [x] Include pinned profile revision, managed workflow catalog, and run state in the resolver context
- [x] Validate `managedWorkflowKey`, `managedRunId`, and `runAlias` targeting rules
- [x] Add fallback coverage for malformed JSON, low confidence, and stale decisions

### 3. Supervisor Conversation Persistence

#### `src/events/supervisor-conversations.ts`, `src/workflow/runtime-db.ts`

**Status**: COMPLETED

```typescript
export interface WorkflowSupervisorConversationRecord {
  readonly supervisorConversationId: string;
  readonly supervisorProfileId: string;
  readonly profileRevision: string;
  readonly correlationKey: string;
  readonly selectedManagedRunId?: string;
  readonly selectedManagedRunIdsByWorkflowKey?: Readonly<Record<string, string>>;
  readonly conversationRevision: number;
}

export interface ManagedWorkflowRunRecord {
  readonly managedRunId: string;
  readonly supervisorConversationId: string;
  readonly managedWorkflowKey: string;
  readonly runAlias?: string;
  readonly status: "starting" | "running" | "stopping" | "stopped" | "completed" | "failed";
}

export interface WorkflowSupervisorConversationRepository {
  updateConversationCas(input: {
    readonly expectedConversationRevision: number;
    readonly next: WorkflowSupervisorConversationRecord;
  }): Promise<WorkflowSupervisorConversationRecord | null>;
}
```

**Checklist**:

- [x] Persist conversations, managed runs, and decision records
- [x] Store pinned profile revision, per-key selection state, and source-message dedupe keys
- [x] Add compare-and-swap repository primitives instead of caller-managed mutation
- [x] Cover stale rows, duplicates, and artifact layout compatibility with tests

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Supervisor profile schema and loader | `src/events/types.ts`, `src/events/validate.ts`, `src/events/supervisor-profiles.ts` | COMPLETED | `supervisor-profiles.test.ts` |
| Dispatch decision contract | `src/events/supervisor-dispatch-contract.ts`, `src/events/supervisor-llm-resolver.ts`, `src/events/supervisor-command-contract.ts` | COMPLETED | `supervisor-dispatch-contract.test.ts`, `supervisor-llm-resolver-dispatch.test.ts` |
| Conversation persistence | `src/events/supervisor-conversations.ts`, `src/workflow/runtime-db.ts` | COMPLETED | `supervisor-conversations.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| TASK-001 Profile types and validation | existing event config and supervisor control types | READY |
| TASK-002 Dispatch decision contract | TASK-001 | COMPLETED |
| TASK-003 Conversation persistence | TASK-001 | COMPLETED |

## Tasks

### TASK-001: Supervisor Profile Types And Validation

**Status**: Completed
**Parallelizable**: No

**Deliverables**:

- `src/events/types.ts`
- `src/events/validate.ts`
- `src/events/supervisor-profiles.ts`
- `src/events/supervisor-profiles.test.ts`
- any required event validation snapshots or fixtures

**Completion Criteria**:

- [x] `supervisor-dispatch` validates as a first-class execution mode
- [x] Supervisor profile types encode managed workflow catalog and policy fields
- [x] Invalid lifecycle/concurrency/direct-answer combinations are rejected
- [x] Profile loading and validation are test-covered

### TASK-002: Dispatch Decision Contract And Resolver Context

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-001`

**Deliverables**:

- `src/events/supervisor-dispatch-contract.ts`
- `src/events/supervisor-command-contract.ts`
- `src/events/supervisor-llm-resolver.ts`
- focused tests around proposal parsing and fallback behavior

**Completion Criteria**:

- [x] Dispatcher actions are represented by a reusable typed contract
- [x] Resolver context includes pinned profile revision and active managed-run state
- [x] Parallel-run targeting rules are validated before runtime mutation
- [x] Malformed and low-confidence proposals have deterministic parse/validation/fallback helpers (`parseSupervisorDispatchProposal`, `validateSupervisorDispatchProposalAgainstContext`, `fallbackSupervisorDispatchProposalForLowConfidence`). Compare-and-swap conversation updates are implemented in TASK-003.
- [x] Dispatcher resolver entrypoints: `runSupervisorDispatchLlmResolver` and `interpretSupervisorDispatchResolverRootJson` in `supervisor-llm-resolver.ts` (runtime trigger-runner wiring remains in the runtime plan).

### TASK-003: Supervisor Conversation Persistence

**Status**: Completed
**Parallelizable**: Yes

**Dependencies**:

- `TASK-001`

**Deliverables**:

- `src/events/supervisor-conversations.ts`
- `src/workflow/runtime-db.ts`
- repository-focused tests for conversation, managed-run, and decision persistence

**Completion Criteria**:

- [x] Conversation records pin supervisor profile identity and revision
- [x] Managed-run records support per-workflow selection and `runAlias`
- [x] Decision records support source-message dedupe and replay safety
- [x] Compare-and-swap updates are repository primitives with test coverage

## Completion Criteria

- [x] Foundation modules are specified with concrete deliverables
- [x] All foundation TODOs are mapped to executable tasks
- [x] Foundation tasks establish the contracts required by the runtime plan

## Progress Log

### Session: 2026-04-30 00:00
**Tasks Completed**: None yet
**Tasks In Progress**: Planning split from umbrella dispatcher plan
**Blockers**: None
**Notes**: This plan owns the contract and persistence work needed before any
runtime dispatch integration can begin.

### Session: 2026-05-01
**Tasks Completed**: TASK-001 (profile schema, `supervisors/` loading, binding
validation for `supervisor-dispatch`, mailbox defaults, trigger-runner guard
for dispatch mode). TASK-002 contract and validation
(`supervisor-dispatch-contract.ts`, `supervisor-command-contract.ts`, tests).
**Tasks In Progress**: TASK-003 persistence; TASK-002 resolver entrypoints
follow-up.
**Blockers**: None
**Notes**: `supervisor-dispatch` bindings fail in `trigger-runner` with an
explicit not-implemented receipt until runtime dispatch (runtime plan) lands.

### Session: 2026-05-01 (TASK-003 persistence)

**Tasks Completed**: TASK-003 (SQLite tables `supervisor_conversations`,
`supervisor_conversation_managed_runs`, `supervisor_dispatch_decisions`; runtime
DB insert/load/find/CAS/upsert/list accessors; typed repository in
`src/events/supervisor-conversations.ts`; `src/events/supervisor-conversations.test.ts`).
**Tasks In Progress**: None.
**Blockers**: None
**Notes**: Correlation lookup uses `binding_id IS ?` so optional bindings match
SQLite NULL semantics. Unique index on `(supervisor_conversation_id,
source_message_id)` enforces decision idempotency.

### Session: 2026-05-01 (TASK-002 dispatch LLM resolver)

**Tasks Completed**: TASK-002 closure: `runSupervisorDispatchLlmResolver`,
`interpretSupervisorDispatchResolverRootJson`, and
`supervisor-llm-resolver-dispatch.test.ts`.
**Tasks In Progress**: None for this plan.
**Blockers**: None
**Notes**: Foundation is complete; `trigger-runner` integration is owned by the
runtime plan (`TASK-004` / `TASK-005`).
