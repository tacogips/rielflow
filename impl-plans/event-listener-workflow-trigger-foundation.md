# Event Listener Workflow Trigger Foundation Implementation Plan

**Status**: Planning
**Design Reference**: design-docs/specs/design-event-listener-workflow-trigger.md
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: design-docs/specs/design-event-listener-workflow-trigger.md

### Summary

Build the provider-neutral foundation for starting workflow executions from
external events while keeping provider SDKs out of `src/workflow/`. The first
slice should validate event configuration, persist event receipts, support
manual fixture emission, and dispatch through the existing workflow execution
boundary.

### Scope

**Included**: event config loading/validation, canonical event and binding
types, ledger artifacts plus SQLite index, manual `events emit`, and command,
local library, or GraphQL workflow dispatch wiring.

**Excluded**: production Slack/Discord/Telegram adapters, automatic replies,
distributed cron locking, and object-content download. The foundation should
include S3-compatible repository-file event source types and validation for a
non-polling event receiver, while production receiver integration can remain a
later provider slice after the open decisions in
`design-docs/user-qa/qa-event-listener-workflow-trigger.md` are resolved.

### Current Blockers

- Confirm default event root location.
- Confirm canonical runtime variable names and `humanInput` mirroring behavior.
- Confirm first provider slice and async-only webhook policy.
- Confirm whether S3 metadata-only input is sufficient for the first provider
  slice or whether object download-to-data-root is required.

---

## Modules

### 1. Event Types And Config Loader

#### src/events/types.ts

**Status**: BLOCKED

```typescript
interface ExternalEventEnvelope {
  readonly sourceId: string;
  readonly eventId: string;
  readonly provider: string;
  readonly eventType: string;
  readonly occurredAt?: string;
  readonly receivedAt: string;
  readonly dedupeKey: string;
  readonly actor?: EventActor;
  readonly conversation?: EventConversation;
  readonly input: Readonly<Record<string, unknown>>;
  readonly rawRef?: EventArtifactRef;
}

interface EventBinding {
  readonly id: string;
  readonly enabled?: boolean;
  readonly sourceId: string;
  readonly match?: EventMatchRule;
  readonly workflowName: string;
  readonly inputMapping: EventInputMapping;
  readonly execution?: EventWorkflowExecutionPolicy;
}
```

**Checklist**:

- [ ] Define provider-neutral event, source, binding, match, mapping, and
      execution policy types
- [ ] Load `.divedra-events/sources/*.json` and
      `.divedra-events/bindings/*.json`
- [ ] Resolve `--event-root` and `DIVEDRA_EVENT_ROOT`
- [ ] Unit tests for missing, malformed, disabled, and duplicate config

### 2. Event Validation

#### src/events/validate.ts

**Status**: BLOCKED

```typescript
interface EventConfigValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}

function validateEventConfig(input: EventConfigValidationInput): {
  readonly valid: boolean;
  readonly issues: readonly EventConfigValidationIssue[];
};
```

**Checklist**:

- [ ] Validate source ids, binding ids, and binding source references
- [ ] Validate workflow name references against the workflow root
- [ ] Validate template path references against supported event/source scopes
- [ ] Reject unsafe sync webhook execution unless explicitly allowed
- [ ] Reject polling mode for S3-compatible repository file sources

### 3. Event Ledger

#### src/events/ledger.ts and src/workflow/runtime-db.ts

**Status**: BLOCKED

```typescript
interface EventReceiptRecord {
  readonly receiptId: string;
  readonly sourceId: string;
  readonly bindingId?: string;
  readonly dedupeKey: string;
  readonly status:
    | "received"
    | "duplicate"
    | "skipped"
    | "mapped"
    | "accepted"
    | "dispatching"
    | "dispatched"
    | "failed";
  readonly workflowName?: string;
  readonly workflowExecutionId?: string;
  readonly receivedAt: string;
  readonly updatedAt: string;
}
```

**Checklist**:

- [ ] Persist raw, normalized, workflow-input, dispatch, and error artifacts
- [ ] Add SQLite receipt index with idempotency lookup
- [ ] Deduplicate by source, binding, dedupe key, and dedupe window
- [ ] Unit tests for duplicate and failed receipt paths

### 4. Input Mapping And Dispatch

#### src/events/trigger-runner.ts

**Status**: BLOCKED

```typescript
interface WorkflowTriggerRunner {
  dispatch(input: WorkflowTriggerDispatchInput): Promise<WorkflowTriggerResult>;
}

interface WorkflowTriggerDispatchInput {
  readonly binding: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly workflowInput: Readonly<Record<string, unknown>>;
}
```

**Checklist**:

- [ ] Implement `mode: "event-input"` mapping
- [ ] Implement static JSON template mapping without JavaScript evaluation
- [ ] Build `workflowInput`, `event`, and optional `humanInput`
      runtime variables
- [ ] Dispatch through `divedra workflow run`,
      `createWorkflowExecutionClient()`, or GraphQL endpoint

### 5. CLI Surface

#### src/cli.ts

**Status**: BLOCKED

```typescript
interface EventsValidateCommand {
  readonly command: "events";
  readonly subcommand: "validate";
  readonly eventRoot?: string;
}

interface EventsEmitCommand {
  readonly command: "events";
  readonly subcommand: "emit";
  readonly sourceId: string;
  readonly eventFile: string;
}
```

**Checklist**:

- [ ] Add `events validate`
- [ ] Add `events emit <source-id> --event-file <path>`
- [ ] Add CLI tests for parse errors and JSON output shape
- [ ] Defer `events serve`, `events list`, and `events replay` to later slices

## Tasks

### TASK-001: Event Types And Config Loading

**Status**: Blocked
**Parallelizable**: Yes
**Deliverables**: `src/events/types.ts`, `src/events/config.ts`
**Dependencies**: None

**Description**:
Define provider-neutral event source, envelope, binding, match, mapping, and
execution policy types, plus event-root resolution and JSON config loading.

**Completion Criteria**:

- [ ] Canonical event and binding types are exported from `src/events/`
- [ ] `.divedra-events/sources/*.json` and
      `.divedra-events/bindings/*.json` load deterministically
- [ ] `--event-root`, `DIVEDRA_EVENT_ROOT`, and default root resolution are covered
- [ ] Missing, malformed, disabled, and duplicate config tests pass

### TASK-002: Event Validation

**Status**: Blocked
**Parallelizable**: No
**Deliverables**: `src/events/validate.ts`
**Dependencies**: TASK-001

**Description**:
Validate loaded event source and binding configuration against workflow
references, adapter capabilities, template scopes, and unsafe execution policy.

**Completion Criteria**:

- [ ] Source ids, binding ids, and binding source references are validated
- [ ] Workflow name references are validated against the workflow root
- [ ] Template references are limited to supported event/source scopes
- [ ] Unsafe synchronous webhook execution is rejected unless explicitly allowed

### TASK-003: Event Ledger

**Status**: Blocked
**Parallelizable**: No
**Deliverables**: `src/events/ledger.ts`, `src/workflow/runtime-db.ts`
**Dependencies**: TASK-001

**Description**:
Persist event receipt artifacts and SQLite receipt indexes for idempotency,
dedupe, audit, dispatch, and error records.

**Completion Criteria**:

- [ ] Raw, normalized, workflow-input, dispatch, and error artifacts are written
- [ ] SQLite receipt index supports idempotency lookup
- [ ] Dedupe uses source, binding, dedupe key, and dedupe window
- [ ] Duplicate and failed receipt path tests pass

### TASK-004: Input Mapping And Dispatch

**Status**: Blocked
**Parallelizable**: No
**Deliverables**: `src/events/trigger-runner.ts`
**Dependencies**: TASK-001, TASK-003

**Description**:
Map normalized events into workflow runtime variables and dispatch through the
existing library or GraphQL workflow execution boundary.

**Completion Criteria**:

- [ ] `mode: "event-input"` mapping is implemented
- [ ] Static JSON template mapping works without JavaScript evaluation
- [ ] Runtime variables include `workflowInput`, `event`, and optional `humanInput`
- [ ] Dispatch works through `divedra workflow run`,
      `createWorkflowExecutionClient()`, or GraphQL

### TASK-005: CLI Surface

**Status**: Blocked
**Parallelizable**: No
**Deliverables**: `src/cli.ts`, `src/cli.test.ts`
**Dependencies**: TASK-002, TASK-004

**Description**:
Expose the first event-trigger operator workflow through validation and manual
fixture emission commands.

**Completion Criteria**:

- [ ] `events validate` returns stable JSON output
- [ ] `events emit <source-id> --event-file <path>` dispatches fixtures
- [ ] CLI parse errors and output shapes have tests
- [ ] `events serve`, `events list`, and `events replay` remain deferred

## Module Status

| Module                 | File Path                       | Status  | Tests |
| ---------------------- | ------------------------------- | ------- | ----- |
| Event types/config     | `src/events/types.ts`           | BLOCKED | -     |
| Event validation       | `src/events/validate.ts`        | BLOCKED | -     |
| Event ledger           | `src/events/ledger.ts`          | BLOCKED | -     |
| Runtime DB receipt idx | `src/workflow/runtime-db.ts`    | BLOCKED | -     |
| Trigger runner         | `src/events/trigger-runner.ts`  | BLOCKED | -     |
| CLI commands           | `src/cli.ts`, `src/cli.test.ts` | BLOCKED | -     |

## Dependencies

| Feature             | Depends On                                 | Status  |
| ------------------- | ------------------------------------------ | ------- |
| Foundation planning | Event trigger design and open QA decisions | BLOCKED |
| Config validation   | Event root and runtime variable decisions  | BLOCKED |
| Manual emit         | Config validation and ledger               | BLOCKED |
| Dispatch            | Runtime variable decision                  | BLOCKED |

## Completion Criteria

- [ ] Open decisions required for the foundation are resolved
- [ ] `events validate` validates sources and bindings without dispatch
- [ ] `events emit` can dispatch a fixture event exactly once per dedupe key
- [ ] Event receipt artifacts and SQLite index are persisted
- [ ] Provider SDKs are absent from `src/workflow/`
- [ ] Type checking passes
- [ ] Focused tests pass

## Progress Log

### Session: 2026-04-20 08:15

**Tasks Completed**: Plan created
**Tasks In Progress**: None
**Blockers**: Open event-trigger product and architecture decisions
**Notes**: Created during review because the event-trigger design exists but
implementation should wait until root location, runtime input shape, provider
slice, and webhook async policy are confirmed.

### Session: 2026-04-20 13:05

**Tasks Completed**: Planning structure review
**Tasks In Progress**: None
**Blockers**: Open event-trigger product and architecture decisions
**Notes**: Added explicit `TASK-XXX` sections and aligned task dependencies with
`PROGRESS.json` so the blocked plan can move directly into implementation once
the open decisions are resolved.

## Related Plans

- **Previous**: None
- **Next**: Provider-specific adapter plans after foundation completion
- **Depends On**:
  `design-docs/user-qa/qa-event-listener-workflow-trigger.md`
