# Event Receipt Operator Commands Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-event-listener-workflow-trigger.md#cli-and-server-surface
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: design-docs/specs/design-event-listener-workflow-trigger.md

### Summary

Complete the remaining operator-facing event source commands by exposing the
persisted event receipt index and a replay path for already-normalized receipt
artifacts. This closes the deferred `events list` and `events replay` command
surface from the foundation slice.

### Scope

**Included**: receipt lookup by id, filtered receipt listing, replay from
`normalized.json`, CLI text and JSON output, and offline unit tests with mocked
workflow dispatch.

**Excluded**: provider SDK integration, production chat-source adapters,
distributed replay locks, and automatic provider replies.

---

## Modules

### 1. Runtime Receipt Lookup

#### src/workflow/runtime-db.ts

**Status**: COMPLETED

```typescript
function loadEventReceiptFromRuntimeDb(
  receiptId: string,
  options?: LoadOptions,
): Promise<RuntimeEventReceiptIndexRecord | null>;
```

**Checklist**:

- [x] Load receipt records by primary key
- [x] Preserve existing list and dedupe behavior
- [x] Use the existing runtime DB schema

### 2. Receipt Operations

#### src/events/receipt-ops.ts

**Status**: COMPLETED

```typescript
function listEventReceipts(
  input: ListEventReceiptsInput,
): Promise<readonly RuntimeEventReceiptIndexRecord[]>;

function replayEventReceipt(
  input: ReplayEventReceiptInput,
): Promise<ReplayEventReceiptResult>;
```

**Checklist**:

- [x] List receipts with source, status, and limit filters
- [x] Load normalized receipt artifacts for replay
- [x] Validate replay artifact shape before dispatch
- [x] Generate replay-specific event id and dedupe key
- [x] Dispatch through the existing workflow trigger runner

### 3. CLI Surface

#### src/cli.ts

**Status**: COMPLETED

```typescript
interface EventsListCommand {
  readonly command: "events";
  readonly subcommand: "list";
  readonly sourceId?: string;
  readonly status?: string;
  readonly limit?: number;
}

interface EventsReplayCommand {
  readonly command: "events";
  readonly subcommand: "replay";
  readonly receiptId: string;
}
```

**Checklist**:

- [x] Add `events list [--source <id>] [--status <status>] [--limit <n>]`
- [x] Add `events replay <receipt-id>`
- [x] Support JSON and text output
- [x] Return non-zero exit code on failed replay dispatch

## Tasks

### TASK-001: Runtime Receipt Lookup

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/workflow/runtime-db.ts`
**Dependencies**: None

### TASK-002: Receipt Operations

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/receipt-ops.ts`
**Dependencies**: TASK-001

### TASK-003: CLI Commands And Tests

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli.ts`, `src/events/receipt-ops.test.ts`, `src/cli.test.ts`
**Dependencies**: TASK-002

### TASK-004: Operator Documentation

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `README.md`, `examples/event-sources/README.md`, `design-docs/specs/command.md`
**Dependencies**: TASK-003

## Completion Criteria

- [x] `events list` reads persisted receipts without external services
- [x] `events replay` re-dispatches stored normalized events with mockable runtime
- [x] Tests cover replay without chat API or provider SDKs
- [x] Type checking passes
- [x] Focused event and CLI tests pass
- [x] Event source examples document validate, emit, list, and replay flow

## Progress Log

### Session: 2026-04-20 16:45

**Tasks Completed**: TASK-004
**Blockers**: None
**Notes**: Documented receipt inspection and replay in the event source fixture
README, README CLI surface, and command spec.

### Session: 2026-04-20 16:25

**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Blockers**: None
**Notes**: Implemented receipt listing and replay as an operator slice. Replay
uses a replay-specific event id and dedupe key so it intentionally bypasses the
original receipt dedupe record while still persisting a new receipt.
