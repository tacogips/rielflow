# Workflow Supervisor Dispatcher Implementation Plan

**Status**: Ready
**Design Reference**: `design-docs/specs/design-workflow-supervisor-dispatcher.md`
**Created**: 2026-04-30
**Last Updated**: 2026-04-30

## Related Plans

- **Previous**: `impl-plans/completed/event-supervisor-control-foundation.md`
- **Previous**: `impl-plans/completed/supervisor-natural-language-control.md`
- **Related**: `impl-plans/event-external-mailbox-binding-foundation.md`
- **Depends On**: existing event-supervisor control, external mailbox input/output persistence, and current GraphQL supervisor control transport

## Design Document Reference

**Source**: `design-docs/specs/design-workflow-supervisor-dispatcher.md`,
`design-docs/specs/design-event-supervisor-control.md`,
`design-docs/specs/design-event-external-mailbox-binding.md`,
`design-docs/specs/architecture.md#event-listener-workflow-triggers`

### Summary

Implement chat-facing multi-workflow supervision on top of the existing
single-target supervised foundation: external chat input enters one supervisor
conversation, the runtime loads a validated supervisor profile, resolves a
structured dispatch decision, then applies lifecycle changes only after
validation, idempotency, and compare-and-swap checks.

### Scope

**Included**: profile schema/validation, `supervisor-dispatch` bindings,
conversation and managed-run persistence, structured decision parsing,
profile-scoped runtime capabilities, event/library/GraphQL integration, and
default supervisor examples/tests.

**Excluded**: long-lived resumed supervisor executions, profile migration
commands, direct-answer external tools, and TUI-specific UX.

### Implementation Baseline

This plan fixes the open design choices into a concrete first delivery:

- short-lived decision executions pinned to a stored profile snapshot
- new supervisor-conversation and managed-run records instead of extending `event_supervised_runs`
- read-only direct answers using runtime-owned context only
- pinned conversation snapshots, with migration tooling deferred

## Modules

### 1. Supervisor Profile Types And Validation

#### `src/events/types.ts`, `src/events/validate.ts`, `src/events/supervisor-profiles.ts`

**Status**: NOT_STARTED

```typescript
export type EventExecutionMode = "direct" | "supervised" | "supervisor-dispatch";

export interface WorkflowSupervisorProfile {
  readonly supervisorProfileId: string;
  readonly profileRevision: string;
  readonly supervisorWorkflowName: string;
  readonly description?: string;
  readonly managedWorkflows: readonly ManagedWorkflowDefinition[];
  readonly conversationPolicy?: SupervisorConversationPolicy;
  readonly directAnswerPolicy?: SupervisorDirectAnswerPolicy;
}

export interface ManagedWorkflowDefinition {
  readonly key: string;
  readonly workflowName: string;
  readonly displayName?: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly dispatchExamples?: readonly string[];
  readonly inputContract?: Readonly<Record<string, unknown>>;
  readonly inputMapping?: EventInputMapping;
  readonly allowedActions?: readonly ManagedWorkflowAction[];
  readonly concurrency?: ManagedWorkflowConcurrencyPolicy;
  readonly lifecycle?: ManagedWorkflowLifecyclePolicy;
}

export interface EventWorkflowExecutionPolicy extends JsonObject {
  readonly mode?: EventExecutionMode;
  readonly supervisorProfileId?: string;
  readonly supervisorWorkflowName?: string;
  readonly async?: boolean;
}

export interface WorkflowSupervisorProfileStore {
  loadProfile(id: string): Promise<WorkflowSupervisorProfile | null>;
  requireProfile(id: string): Promise<WorkflowSupervisorProfile>;
}
```

**Checklist**:

- [ ] Add `supervisor-dispatch` execution mode without breaking existing bindings
- [ ] Define/export supervisor profile, managed-workflow, concurrency, and policy types
- [ ] Implement scoped profile loading and validation with tests

### 2. Dispatch Decision Contract And Resolver Context

#### `src/events/supervisor-dispatch-contract.ts`, `src/events/supervisor-llm-resolver.ts`, `src/events/supervisor-command-contract.ts`

**Status**: NOT_STARTED

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

export interface SupervisorDispatchTarget {
  readonly managedWorkflowKey: string;
  readonly managedRunId?: string;
  readonly runAlias?: string;
  readonly input?: Readonly<Record<string, unknown>>;
}

export interface SupervisorDispatchProposal {
  readonly action: SupervisorDispatchAction;
  readonly targets?: readonly SupervisorDispatchTarget[];
  readonly reply?: {
    readonly text: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  readonly confidence?: number;
  readonly reason: string;
}

export interface WorkflowSupervisorDispatchContext {
  readonly supervisorConversationId: string;
  readonly profile: WorkflowSupervisorProfile;
  readonly sourceMessageId: string;
  readonly conversationRevision: number;
  readonly selectedManagedRunId?: string;
  readonly managedRuns: readonly ManagedWorkflowRunRecord[];
}

export function parseSupervisorDispatchProposal(
  value: unknown,
): ParseResult<SupervisorDispatchProposal>;
```

**Checklist**:

- [ ] Generalize the existing supervisor command contract into a dispatcher-decision schema
- [ ] Pass managed workflow catalog, active runs, and pinned profile revision into resolver execution
- [ ] Add validation and fallback tests for malformed JSON, low confidence, and unknown workflow keys

### 3. Supervisor Conversation Persistence

#### `src/events/supervisor-conversations.ts`, `src/workflow/runtime-db.ts`

**Status**: NOT_STARTED

```typescript
export interface WorkflowSupervisorConversationRecord {
  readonly supervisorConversationId: string;
  readonly supervisorProfileId: string;
  readonly profileRevision: string;
  readonly supervisorWorkflowName: string;
  readonly sourceId: string;
  readonly bindingId?: string;
  readonly correlationKey: string;
  readonly selectedManagedRunId?: string;
  readonly selectedManagedRunIdsByWorkflowKey?: Readonly<Record<string, string>>;
  readonly conversationRevision: number;
  readonly status: "active" | "idle" | "stopped" | "failed";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ManagedWorkflowRunRecord {
  readonly managedRunId: string;
  readonly supervisorConversationId: string;
  readonly managedWorkflowKey: string;
  readonly targetWorkflowName: string;
  readonly runAlias?: string;
  readonly activeTargetExecutionId?: string;
  readonly status:
    | "starting"
    | "running"
    | "stopping"
    | "stopped"
    | "completed"
    | "failed";
  readonly restartCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SupervisorDispatchDecisionRecord {
  readonly decisionId: string;
  readonly supervisorConversationId: string;
  readonly sourceMessageId: string;
  readonly profileRevision: string;
  readonly conversationRevision: number;
  readonly status: "proposed" | "applied" | "rejected" | "superseded";
  readonly proposal: Readonly<Record<string, unknown>>;
  readonly resultSummary?: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowSupervisorConversationRepository {
  loadByCorrelation(input: {
    readonly sourceId: string;
    readonly bindingId: string;
    readonly correlationKey: string;
  }): Promise<WorkflowSupervisorConversationRecord | null>;
  saveConversation(record: WorkflowSupervisorConversationRecord): Promise<void>;
  listManagedRuns(id: string): Promise<readonly ManagedWorkflowRunRecord[]>;
  saveDecision(record: SupervisorDispatchDecisionRecord): Promise<void>;
}
```

**Checklist**:

- [ ] Add durable records for conversations, managed runs, and decision artifacts
- [ ] Persist pinned profile revision, selection state, and source-message dedupe
- [ ] Cover stale rows, duplicates, and artifact layout compatibility with tests

### 4. Runtime Dispatch Service And Scoped Capabilities

#### `src/workflow/supervisor-dispatch-client.ts`, `src/workflow/supervisor-client.ts`, `src/workflow/superviser-control.ts`, `src/lib.ts`

**Status**: NOT_STARTED

```typescript
export interface DispatchSupervisorConversationInput extends LoadOptions {
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly supervisorProfileId: string;
  readonly sourceMessageId: string;
  readonly event: ExternalEventEnvelope;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
}

export interface WorkflowSupervisorDispatchView {
  readonly conversation: WorkflowSupervisorConversationRecord;
  readonly managedRuns: readonly ManagedWorkflowRunRecord[];
  readonly decision: SupervisorDispatchDecisionRecord;
  readonly publishedReply?: ExternalOutputMessage;
}

export interface WorkflowSupervisorDispatchClient {
  dispatchExternalInput(input: DispatchSupervisorConversationInput): Promise<WorkflowSupervisorDispatchView>;
  getConversation(id: string): Promise<WorkflowSupervisorDispatchView | null>;
}

export interface SupervisorRuntimeCapabilitySet {
  startManagedWorkflow(input: StartManagedWorkflowInput): Promise<ManagedWorkflowRunRecord>;
  submitManagedInput(input: SubmitManagedWorkflowInput): Promise<ManagedWorkflowRunRecord>;
  switchManagedWorkflow(input: SwitchManagedWorkflowInput): Promise<WorkflowSupervisorConversationRecord>;
  stopManagedWorkflow(input: StopManagedWorkflowInput): Promise<ManagedWorkflowRunRecord>;
  restartManagedWorkflow(input: RestartManagedWorkflowInput): Promise<ManagedWorkflowRunRecord>;
}
```

**Checklist**:

- [ ] Implement one runtime entrypoint that validates proposals and applies compare-and-swap updates
- [ ] Scope lifecycle actions to the pinned profile snapshot and conversation-owned runs
- [ ] Reuse existing single-target supervisor client logic and add stale/ambiguity/idempotency tests

### 5. Event Trigger And External Mailbox Integration

#### `src/events/trigger-runner.ts`, `src/events/dispatch-supervisor-chat.ts`, `src/events/listener-service.ts`, `src/events/mailbox-bridge-policy.ts`

**Status**: NOT_STARTED

```typescript
export interface EventWorkflowExecutionPolicy extends JsonObject {
  readonly mode?: EventExecutionMode;
  readonly workflowName?: string;
  readonly supervisorProfileId?: string;
  readonly supervisorWorkflowName?: string;
  readonly async?: boolean;
}

export interface WorkflowTriggerResult {
  readonly workflowExecutionId?: string;
  readonly supervisedRunId?: string;
  readonly supervisorConversationId?: string;
  readonly supervisorDecisionId?: string;
}
```

**Checklist**:

- [ ] Route `supervisor-dispatch` bindings through the new dispatch client
- [ ] Keep `execution.mode = "supervised"` unchanged for compatibility
- [ ] Use the supervisor conversation as the mailbox owner and add event-path tests

### 6. GraphQL And Server Surface

#### `src/graphql/types.ts`, `src/graphql/schema.ts`, `src/server/graphql-executable-schema.ts`, `src/workflow/supervisor-graphql-client.ts`

**Status**: NOT_STARTED

```typescript
export interface DispatchSupervisorConversationGraphqlInput {
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly supervisorProfileId: string;
  readonly sourceMessageId: string;
  readonly event: Readonly<Record<string, unknown>>;
  readonly idempotencyKey?: string;
}

export interface WorkflowSupervisorConversationView {
  readonly conversation: WorkflowSupervisorConversationRecord;
  readonly managedRuns: readonly ManagedWorkflowRunRecord[];
  readonly latestDecision?: SupervisorDispatchDecisionRecord;
}

export interface DispatchSupervisorConversationPayload {
  readonly accepted: boolean;
  readonly view?: WorkflowSupervisorConversationView;
  readonly error?: string;
}
```

**Checklist**:

- [ ] Add GraphQL inputs/payloads for dispatch and conversation reads
- [ ] Expose the same dispatcher contract through local and remote clients
- [ ] Preserve auth boundaries and add schema/HTTP tests for accept/replay/reject/stale paths

### 7. Default Supervisor Workflow, Examples, And Verification

#### `examples/default-superviser/`, `examples/event-sources/`, `src/events/*.test.ts`, `src/workflow/*.test.ts`

**Status**: NOT_STARTED

**Checklist**:

- [ ] Add or rename the packaged default supervisor example for dispatcher mode
- [ ] Provide example supervisor profile plus managed workflow catalog entries
- [ ] Cover the design flow examples and concurrency rules with targeted tests

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Supervisor profile schema and loader | `src/events/types.ts`, `src/events/validate.ts`, `src/events/supervisor-profiles.ts` | NOT_STARTED | planned |
| Dispatch decision contract | `src/events/supervisor-dispatch-contract.ts`, `src/events/supervisor-llm-resolver.ts` | NOT_STARTED | planned |
| Conversation persistence | `src/events/supervisor-conversations.ts`, `src/workflow/runtime-db.ts` | NOT_STARTED | planned |
| Runtime dispatch client | `src/workflow/supervisor-dispatch-client.ts`, `src/workflow/supervisor-client.ts`, `src/workflow/superviser-control.ts` | NOT_STARTED | planned |
| Event integration | `src/events/trigger-runner.ts`, `src/events/dispatch-supervisor-chat.ts`, `src/events/listener-service.ts` | NOT_STARTED | planned |
| GraphQL/server surface | `src/graphql/types.ts`, `src/graphql/schema.ts`, `src/server/graphql-executable-schema.ts`, `src/workflow/supervisor-graphql-client.ts` | NOT_STARTED | planned |
| Examples and verification | `examples/default-superviser/`, `examples/event-sources/`, focused tests | NOT_STARTED | planned |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| TASK-001 Profile types and validation | existing event config + supervisor control types | READY |
| TASK-002 Dispatch decision contract | TASK-001 | BLOCKED |
| TASK-003 Conversation persistence | TASK-001 | READY |
| TASK-004 Runtime dispatch client | TASK-002, TASK-003 | BLOCKED |
| TASK-005 Event integration | TASK-004 | BLOCKED |
| TASK-006 GraphQL/server surface | TASK-004 | BLOCKED |
| TASK-007 Examples and verification | TASK-005, TASK-006 | BLOCKED |

## Completion Criteria

- [ ] `supervisor-dispatch` bindings validate and route through a profile-scoped dispatcher path
- [ ] Supervisor conversations persist pinned profile snapshots, selected runs, managed runs, and decision records
- [ ] Runtime lifecycle mutations require valid managed workflow keys, allowed actions, and compare-and-swap conversation revisions
- [ ] Event, library, and GraphQL entrypoints share the same dispatcher semantics and idempotency behavior
- [ ] Existing single-target supervised mode continues to pass its current test coverage unchanged
- [ ] Focused tests cover direct answer, start, submit input, switch, stop, restart, status, ambiguity rejection, and replay safety

## Progress Log

### Session: 2026-04-30 00:00
**Tasks Completed**: Authored initial implementation plan for workflow supervisor dispatcher
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Chosen first-cut baseline is short-lived decision executions with a pinned supervisor-profile snapshot and new multi-run conversation persistence, while preserving the existing single-target supervised path for compatibility.
