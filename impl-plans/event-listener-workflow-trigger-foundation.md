# Event Listener Workflow Trigger Foundation Implementation Plan

**Status**: Completed
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

### Resolved Decisions

- Default event root resolves from `--event-root`, `DIVEDRA_EVENT_ROOT`, or
  `.divedra-events` next to the workflow root.
- Runtime variables expose canonical `workflowInput`, event metadata under
  `event`, and optional compatibility `humanInput`.
- First provider-neutral slice supports manual emit, cron, generic webhook, and
  S3-compatible metadata-only repository file events.
- Webhook-backed dispatch defaults to asynchronous execution and validation
  rejects unsafe synchronous webhook bindings unless explicitly allowed.
- S3 object content download remains deferred; metadata-only input is implemented.

---

## Modules

### 1. Event Types And Config Loader

#### src/events/types.ts

**Status**: COMPLETED

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

- [x] Define provider-neutral event, source, binding, match, mapping, and
      execution policy types
- [x] Load `.divedra-events/sources/*.json` and
      `.divedra-events/bindings/*.json`
- [x] Resolve `--event-root` and `DIVEDRA_EVENT_ROOT`
- [x] Unit tests for missing, malformed, disabled, and duplicate config

### 2. Event Validation

#### src/events/validate.ts

**Status**: COMPLETED

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

- [x] Validate source ids, binding ids, and binding source references
- [x] Validate workflow name references against the workflow root
- [x] Validate template path references against supported event/source scopes
- [x] Reject unsafe sync webhook execution unless explicitly allowed
- [x] Reject polling mode for S3-compatible repository file sources

### 3. Event Ledger

#### src/events/ledger.ts and src/workflow/runtime-db.ts

**Status**: COMPLETED

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

- [x] Persist raw, normalized, workflow-input, dispatch, and error artifacts
- [x] Add SQLite receipt index with idempotency lookup
- [x] Deduplicate by source, binding, dedupe key, and dedupe window
- [x] Unit tests for duplicate and failed receipt paths

### 4. Input Mapping And Dispatch

#### src/events/trigger-runner.ts

**Status**: COMPLETED

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

- [x] Implement `mode: "event-input"` mapping
- [x] Implement static JSON template mapping without JavaScript evaluation
- [x] Build `workflowInput`, `event`, and optional `humanInput`
      runtime variables
- [x] Dispatch through `divedra workflow run`,
      `createWorkflowExecutionClient()`, or GraphQL endpoint

### 5. CLI Surface

#### src/cli.ts

**Status**: COMPLETED

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

- [x] Add `events validate`
- [x] Add `events emit <source-id> --event-file <path>`
- [x] Add CLI tests for parse errors and JSON output shape
- [x] Defer `events list` and `events replay` to later slices

## Tasks

### TASK-001: Event Types And Config Loading

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/events/types.ts`, `src/events/config.ts`
**Dependencies**: None

**Description**:
Define provider-neutral event source, envelope, binding, match, mapping, and
execution policy types, plus event-root resolution and JSON config loading.

**Completion Criteria**:

- [x] Canonical event and binding types are exported from `src/events/`
- [x] `.divedra-events/sources/*.json` and
      `.divedra-events/bindings/*.json` load deterministically
- [x] `--event-root`, `DIVEDRA_EVENT_ROOT`, and default root resolution are covered
- [x] Missing, malformed, disabled, and duplicate config tests pass

### TASK-002: Event Validation

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/validate.ts`
**Dependencies**: TASK-001

**Description**:
Validate loaded event source and binding configuration against workflow
references, adapter capabilities, template scopes, and unsafe execution policy.

**Completion Criteria**:

- [x] Source ids, binding ids, and binding source references are validated
- [x] Workflow name references are validated against the workflow root
- [x] Template references are limited to supported event/source scopes
- [x] Unsafe synchronous webhook execution is rejected unless explicitly allowed

### TASK-003: Event Ledger

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/ledger.ts`, `src/workflow/runtime-db.ts`
**Dependencies**: TASK-001

**Description**:
Persist event receipt artifacts and SQLite receipt indexes for idempotency,
dedupe, audit, dispatch, and error records.

**Completion Criteria**:

- [x] Raw, normalized, workflow-input, dispatch, and error artifacts are written
- [x] SQLite receipt index supports idempotency lookup
- [x] Dedupe uses source, binding, dedupe key, and dedupe window
- [x] Duplicate and failed receipt path tests pass

### TASK-004: Input Mapping And Dispatch

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/trigger-runner.ts`
**Dependencies**: TASK-001, TASK-003

**Description**:
Map normalized events into workflow runtime variables and dispatch through the
existing library or GraphQL workflow execution boundary.

**Completion Criteria**:

- [x] `mode: "event-input"` mapping is implemented
- [x] Static JSON template mapping works without JavaScript evaluation
- [x] Runtime variables include `workflowInput`, `event`, and optional `humanInput`
- [x] Dispatch works through `divedra workflow run`,
      `createWorkflowExecutionClient()`, or GraphQL

### TASK-005: CLI Surface

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli.ts`, `src/cli.test.ts`
**Dependencies**: TASK-002, TASK-004

**Description**:
Expose the first event-trigger operator workflow through validation and manual
fixture emission commands.

**Completion Criteria**:

- [x] `events validate` returns stable JSON output
- [x] `events emit <source-id> --event-file <path>` dispatches fixtures
- [x] CLI parse errors and output shapes have tests
- [x] `events list` and `events replay` remain deferred

## Module Status

| Module                 | File Path                       | Status | Tests |
| ---------------------- | ------------------------------- | ------ | ----- |
| Event types/config     | `src/events/types.ts`           | DONE   | Yes   |
| Event validation       | `src/events/validate.ts`        | DONE   | Yes   |
| Event ledger           | `src/events/ledger.ts`          | DONE   | Yes   |
| Runtime DB receipt idx | `src/workflow/runtime-db.ts`    | DONE   | Yes   |
| Trigger runner         | `src/events/trigger-runner.ts`  | DONE   | Yes   |
| CLI commands           | `src/cli.ts`, `src/cli.test.ts` | DONE   | Yes   |

## Dependencies

| Feature             | Depends On                                 | Status |
| ------------------- | ------------------------------------------ | ------ |
| Foundation planning | Event trigger design and open QA decisions | DONE   |
| Config validation   | Event root and runtime variable decisions  | DONE   |
| Manual emit         | Config validation and ledger               | DONE   |
| Dispatch            | Runtime variable decision                  | DONE   |

## Completion Criteria

- [x] Open decisions required for the foundation are resolved
- [x] `events validate` validates sources and bindings without dispatch
- [x] `events emit` can dispatch a fixture event exactly once per dedupe key
- [x] Event receipt artifacts and SQLite index are persisted
- [x] Provider SDKs are absent from `src/workflow/`
- [x] Type checking passes
- [x] Focused tests pass

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

### Session: 2026-04-20 15:10

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Implemented event types/config loading, validation, runtime receipt
ledger with SQLite indexing, input mapping, workflow dispatch, `events validate`,
and `events emit`. Verified with `bun run typecheck`, focused event/CLI tests,
and the full `bun test` suite.

### Session: 2026-04-20 18:06

**Tasks Completed**: Post-completion review fixes for TASK-002, TASK-004, and
TASK-005
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Tightened event HTTP route validation to reject duplicate enabled
listener paths, centralized route resolution between validation and serving,
aligned read-only event dispatch with the command design by recording mapped
skipped receipts instead of throwing before persistence, and documented the
event listener host/port/read-only environment behavior. Verified with
`bun run typecheck`, focused event/CLI tests, and the full `bun test` suite.

### Session: 2026-04-20 19:05

**Tasks Completed**: Review hardening for TASK-003 and TASK-004 listener
runtime behavior
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Reviewed the current diff against the event-listener foundation
architecture and did not find a design mismatch requiring a new design or plan.
Fixed two cleanup gaps: cron dispatch failures are now contained so a single
failed dispatch does not create an unhandled rejection or stop future scheduling,
and event listener shutdown now attempts all adapter and HTTP-server cleanup
before reporting stop failures. Added regression tests for both cases.

### Session: 2026-04-20 19:15

**Tasks Completed**: Follow-up code quality review for TASK-002 and TASK-004
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Confirmed the event trigger architecture still matches the existing
design, so no new design document or implementation plan was needed. Tightened
unsafe synchronous execution validation so every HTTP-backed event source,
including S3 repository webhook receivers, is covered by the async-by-default
policy. Also changed reply dispatch in-flight dedupe to release completed
promise entries and rely on durable idempotency afterward, avoiding unbounded
memory growth in long-lived listener processes. Added regression tests for both
changes.

## Related Plans

- **Previous**: None
- **Next**: Provider-specific adapter plans after foundation completion
- **Depends On**:
  `design-docs/user-qa/qa-event-listener-workflow-trigger.md`
