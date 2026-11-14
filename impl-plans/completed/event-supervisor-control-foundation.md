# Event Supervisor Control Foundation Implementation Plan

**Status**: Completed (Phase 1 foundation and operator example)
**Design Reference**: `design-docs/specs/design-event-supervisor-control.md`
**Created**: 2026-04-29
**Last Updated**: 2026-04-29

---

## Design Document Reference

**Source**:

- `design-docs/specs/design-event-supervisor-control.md`
- `design-docs/specs/design-event-listener-workflow-trigger.md`
- `design-docs/specs/design-auto-improve-superviser-mode.md`

### Summary

Implement the first lifecycle-supervision foundation for event sources. A
binding can opt into `execution.mode = "supervised"` so chat and web app events
start, stop, restart, inspect, or send input to a target workflow through a
supervised-run control service instead of direct event-to-workflow execution.

### Scope

**Included**: supervised binding schema and validation, structured intent
mapping, supervised run persistence, local library supervisor client, GraphQL
supervisor operations, event router integration, and focused tests.

**Excluded**: LLM natural-language command inference, automatic workflow
patching, full authored default supervisor workflow packaging, and hard process
kill semantics beyond existing workflow cancellation.

## Modules

### 1. Event Binding Types And Validation

#### `src/events/types.ts`, `src/events/validate.ts`

**Status**: Implemented

```typescript
type EventExecutionMode = "direct" | "supervised";
type EventSupervisorAction = "start" | "stop" | "restart" | "status" | "input";

interface EventSupervisorControlPolicy {
  readonly correlationKey?: string;
  readonly allowActions?: readonly EventSupervisorAction[];
  readonly intentMapping?: EventSupervisorIntentMapping;
  readonly startOnFirstInput?: boolean;
}

interface EventWorkflowExecutionPolicy {
  readonly mode?: EventExecutionMode;
  readonly supervisorWorkflowName?: string;
  readonly maxRestartsOnFailure?: number;
  readonly autoImprove?: boolean | AutoImprovePolicyInput;
  readonly control?: EventSupervisorControlPolicy;
}
```

**Checklist**:

- [x] Add supervised execution policy types without breaking direct mode
- [x] Validate mode, restart, action, and command-map fields
- [x] Add config validation tests

### 2. Supervised Run Repository

#### `src/events/supervised-runs.ts`, `src/workflow/runtime-db.ts`

**Status**: Implemented

```typescript
type EventSupervisedRunStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "restarting"
  | "completed"
  | "failed";

interface EventSupervisedRunRecord {
  readonly supervisedRunId: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly supervisorWorkflowName: string;
  readonly supervisorExecutionId?: string;
  readonly targetWorkflowName: string;
  readonly activeTargetExecutionId?: string;
  readonly status: EventSupervisedRunStatus;
  readonly restartCount: number;
  readonly maxRestartsOnFailure: number;
  readonly autoImproveEnabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface EventSupervisedRunRepository {
  findActiveByCorrelation(
    input: SupervisedRunCorrelationKey,
  ): Promise<EventSupervisedRunRecord | null>;
  save(record: EventSupervisedRunRecord): Promise<void>;
  recordCommand(
    command: EventSupervisorCommand,
  ): Promise<EventSupervisorCommandRecord>;
}
```

**Checklist**:

- [x] Persist supervised run and command records durably
- [x] Add SQLite indexes for correlation and active target lookup
- [x] Unit tests cover stale/malformed artifacts and duplicate commands

### 3. Intent Mapping And Event Supervisor Router

#### `src/events/supervisor-intent.ts`, `src/events/supervisor-router.ts`

**Status**: Implemented

```typescript
interface EventSupervisorCommand {
  readonly commandId: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly action: EventSupervisorAction;
  readonly targetWorkflowName: string;
  readonly targetWorkflowExecutionId?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly reason?: string;
  readonly receivedEventReceiptId: string;
}

interface EventSupervisorRouter {
  dispatch(command: EventSupervisorCommand): Promise<SupervisedWorkflowView>;
}
```

**Checklist**:

- [x] Map structured event input to supervisor actions
- [x] Implement command-token mapping and stable correlation keys
- [x] Route disallowed or ambiguous commands to skipped receipts
- [x] Unit tests cover start/stop/restart/status/input mapping

### 4. Local Workflow Supervisor Client

#### `src/workflow/supervisor-client.ts`, `src/lib.ts`

**Status**: Implemented

```typescript
interface WorkflowSupervisorClient {
  start(input: StartSupervisedWorkflowInput): Promise<SupervisedWorkflowView>;
  stop(input: StopSupervisedWorkflowInput): Promise<SupervisedWorkflowView>;
  restart(
    input: RestartSupervisedWorkflowInput,
  ): Promise<SupervisedWorkflowView>;
  status(input: SupervisedWorkflowLookup): Promise<SupervisedWorkflowView>;
  submitInput(
    input: SubmitSupervisedWorkflowInput,
  ): Promise<SupervisedWorkflowView>;
}

interface SupervisedWorkflowView {
  readonly supervisedRun: EventSupervisedRunRecord;
  readonly activeTargetStatus?: WorkflowSessionState["status"];
}
```

**Checklist**:

- [x] Add library cancel parity and supervisor client APIs
- [x] Implement lifecycle operations over current engine APIs
- [x] Enforce one active run per default correlation key
- [x] Unit tests cover idempotent commands and restart count updates

### 5. GraphQL Supervisor Surface

#### `src/graphql/types.ts`, `src/graphql/schema.ts`, `src/server/graphql-executable-schema.ts`

**Status**: Implemented

```typescript
interface StartSupervisedWorkflowInput {
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly targetWorkflowName: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly policy?: SupervisedWorkflowPolicyInput;
  readonly idempotencyKey?: string;
}

interface SupervisedWorkflowLookup {
  readonly supervisedRunId?: string;
  readonly sourceId?: string;
  readonly bindingId?: string;
  readonly correlationKey?: string;
}
```

**Checklist**:

- [x] Add typed GraphQL inputs and payloads for supervisor operations
- [x] Wire resolvers to the local supervisor client
- [x] Reject ambiguous lookup and test schema/HTTP paths

### 6. Event Trigger Integration

#### `src/events/trigger-runner.ts`, `src/events/listener-service.ts`

**Status**: Implemented

```typescript
interface WorkflowTriggerRunnerOptions {
  readonly endpoint?: string;
  readonly supervisorClient?: WorkflowSupervisorClient;
}

interface WorkflowTriggerResult {
  readonly supervisedRunId?: string;
  readonly workflowExecutionId?: string;
}
```

**Checklist**:

- [x] Keep existing direct mode unchanged
- [x] Route supervised bindings locally or through remote GraphQL
- [x] Link event receipts to supervised run and target execution ids
- [x] Listener service tests cover local and remote supervised dispatch

---

## Module Status

| Module                        | File Path                                                              | Status      | Tests           |
| ----------------------------- | ---------------------------------------------------------------------- | ----------- | --------------- |
| Binding schema and validation | `src/events/types.ts`, `src/events/validate.ts`                        | Implemented | yes             |
| Supervised run repository     | `src/events/supervised-runs.ts`, `src/workflow/runtime-db.ts`          | Implemented | yes             |
| Intent mapper and router      | `src/events/supervisor-intent.ts`, `src/events/supervisor-router.ts`   | Implemented | yes             |
| Local supervisor client       | `src/workflow/supervisor-client.ts`, `src/lib.ts`                      | Implemented | yes             |
| GraphQL supervisor surface    | `src/graphql/*`, `src/server/graphql-executable-schema.ts`             | Implemented | yes             |
| Event trigger integration     | `src/events/trigger-runner.ts`, `src/events/listener-service.ts`       | Implemented | yes             |
| Examples and operator docs    | `examples/event-sources/`, `design-docs/specs/command.md`, design spec | Implemented | manual validate |

## Dependencies

| Feature                    | Depends On                   | Status |
| -------------------------- | ---------------------------- | ------ |
| TASK-001 Binding types     | None                         | DONE   |
| TASK-002 Repository        | None                         | DONE   |
| TASK-003 Router            | TASK-001, TASK-002           | DONE   |
| TASK-004 Local client      | TASK-002                     | DONE   |
| TASK-005 GraphQL           | TASK-004                     | DONE   |
| TASK-006 Event integration | TASK-003, TASK-004, TASK-005 | DONE   |
| TASK-007 Examples          | TASK-006                     | DONE   |

## Tasks

### TASK-001: Binding Schema And Validation

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/events/types.ts`, `src/events/validate.ts`, validation tests
**Dependencies**: None

**Completion Criteria**:

- [x] Supervised execution policy is typed and validated
- [x] Direct mode remains backward compatible
- [x] Invalid mode/action/restart/correlation config is rejected

### TASK-002: Supervised Run Repository

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/events/supervised-runs.ts`, runtime DB support, repository tests
**Dependencies**: None

**Completion Criteria**:

- [x] Supervised run records persist durably
- [x] Command idempotency records persist durably
- [x] Correlation lookup and ambiguity handling are tested

### TASK-003: Intent Mapper And Router

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/supervisor-intent.ts`, `src/events/supervisor-router.ts`
**Dependencies**: TASK-001, TASK-002

**Completion Criteria**:

- [x] Structured actions and command-map tokens produce commands
- [x] Disallowed commands produce skipped receipt outcomes
- [x] Correlation keys are deterministic and tested

### TASK-004: Local Supervisor Client

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/workflow/supervisor-client.ts`, `src/lib.ts`
**Dependencies**: TASK-002

**Completion Criteria**:

- [x] Library exposes supervised start/stop/restart/status/input
- [x] Existing workflow cancel behavior is available from library API
- [x] Restart budget and active target updates are tested

### TASK-005: GraphQL Supervisor Surface

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/graphql/types.ts`, `src/graphql/schema.ts`, `src/server/graphql-executable-schema.ts`
**Dependencies**: TASK-004

**Completion Criteria**:

- [x] GraphQL exposes supervised workflow operations
- [x] Remote callers can use supervised-run id or correlation lookup
- [x] Schema and HTTP tests cover invalid and valid operations

### TASK-006: Event Trigger Integration

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/trigger-runner.ts`, `src/events/listener-service.ts`
**Dependencies**: TASK-003, TASK-004, TASK-005

**Completion Criteria**:

- [x] Direct mode behavior is unchanged
- [x] Supervised mode works in local library mode
- [x] Supervised mode works through remote GraphQL endpoint mode
- [x] Event receipts include supervised run and target execution ids

### TASK-007: Examples And Docs

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `examples/event-sources/`, `design-docs/specs/command.md` (supervised `events serve` note), design/architecture cross-links
**Dependencies**: TASK-006

**Completion Criteria**:

- [x] Example binding and payload (`webhook-supervised-arithmetic`, `chat-supervised-start`) demonstrate command-map control; README documents follow-up emits for status/stop on the same correlation
- [x] Operator docs cover local (`events emit` without `--endpoint`) and remote (`--endpoint` GraphQL) supervised paths
- [x] Configuration validates with `divedra events validate` (same event root)

## Completion Criteria

- [x] All supervised event control modules implemented (Phase 1)
- [x] Existing direct event trigger tests still pass
- [x] New unit and GraphQL tests pass
- [x] `task typecheck` passes
- [x] `task test` or focused equivalent passes

## Progress Log

### Session: 2026-04-29 21:08 JST

**Tasks Completed**: Created implementation plan.
**Notes**: Foundation scoped before authored system workflow packaging.

### Session: 2026-04-29 (implementation pass)

**Tasks Completed**: TASK-001 through TASK-006 implementation and tests.
**Tasks In Progress**: Examples and operator docs (TASK-007).

### Session: 2026-04-29 (GraphQL remote supervised path)

**Tasks Completed**: GraphQL query/mutation, HTTP client, and endpoint dispatch
tests.
**Tasks In Progress**: TASK-007 examples/docs.

### Session: 2026-04-29 (foundation closure)

**Tasks Completed**: TASK-007 and Phase 1 closure.
**Notes**: Review hardening moved to
`impl-plans/completed/event-supervisor-control-review-hardening.md`.

### Session: 2026-04-29 (architecture review)

**Tasks Completed**: Verified Phase 1 matches design intent (runtime-owned
supervised-run lifecycle without authored supervisor workflow process).
Synchronized module checklist boxes with completed work; aligned plan snippet
with `startOnFirstInput` on control policy.

## Related Plans

- **Previous**: `impl-plans/event-listener-workflow-trigger-foundation.md`,
  `impl-plans/completed/event-source-adapters.md`,
  `impl-plans/graphql-supervision-execution-parity.md`
- **Next**: `impl-plans/completed/event-supervisor-control-review-hardening.md`, default
  supervisor system workflow packaging plan
- **Depends On**: None
