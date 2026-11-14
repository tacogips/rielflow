# Sequential List Event Source Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-event-listener-workflow-trigger.md#sequential-list; design-docs/specs/command.md#events
**Created**: 2026-05-22
**Last Updated**: 2026-05-22

---

## Design Document Reference

**Source**: design-docs/specs/design-event-listener-workflow-trigger.md

### Summary

Implement `kind: "sequential-list"` as a local event source that drains a
configured ordered prompt list through the existing event binding, input
mapping, receipt, dedupe, replay, sticky-session, and supervised dispatch
contracts. Each prompt entry becomes exactly one normalized
`sequential-list.item.ready` event, and the next item is dispatched only after
the previous item reaches a terminal workflow or supervised-run state.

### Scope

**Included**: source and entry types, config loading and validation,
adapter registration, durable sequence state, listener startup resume,
completion observation, receipt/replay/list metadata, example fixtures,
README updates, read-only behavior, and focused unit/integration tests.

**Excluded**: workflow JSON list semantics, distributed multi-process locking,
operator pause/cancel/resume commands for sequences, and Cursor or codex-agent
specific sequencing behavior.

### Accepted Design Decisions

- `sequential-list` is an event source, not workflow control flow.
- Source config uses non-empty ordered `entries`; each entry requires unique
  `id` and non-empty `prompt`, with optional JSON-object `metadata`.
- Default `startPolicy` is `on-serve-start`.
- Default `onItemFailure` is `stop`; `continue` is allowed only when failure is
  persisted before advancing.
- Terminal workflow states are completed, failed, and cancelled. Paused,
  running, pending user-action, and unknown states do not release the next item.
- When completion cannot be observed for a dispatch mode, the active item fails
  and the sequence stops rather than risking concurrent dispatch.
- Replay targets one persisted item receipt and must not reset or rerun the
  whole sequence.
- Read-only mode records receipts/state transitions without workflow dispatch
  and must not advance the durable cursor past an undispatched item.

### Codex Reference Mapping

- `AGENTS.md`: repository planning, TypeScript, documentation, and commit rules.
- `.agents/skills/rielflow-event-sources/SKILL.md`: event validation, serve,
  list, replay, receipts, and read-only behavior.
- `.agents/skills/rielflow-impl-workflow/SKILL.md`: issue-resolution workflow
  context.
- `codex-agent`: referenced only as a possible workflow node backend.
  Sequencing remains provider-neutral and is owned by rielflow events.

---

## Modules

### 1. Sequential List Config Types

#### packages/rielflow-events/src/types.ts
#### packages/rielflow/src/events/config.ts
#### packages/rielflow/src/events/validate.ts

**Status**: COMPLETED

```typescript
export interface SequentialListEntry extends JsonObject {
  readonly id: string;
  readonly prompt: string;
  readonly metadata?: JsonObject;
}

export interface SequentialListSourceConfig extends EventSourceConfigBase {
  readonly kind: "sequential-list";
  readonly entries: readonly SequentialListEntry[];
  readonly startPolicy?: "on-serve-start";
  readonly onItemFailure?: "stop" | "continue";
}
```

**Checklist**:

- [x] Add sequential-list source and entry types to the exported event config
      union.
- [x] Preserve `configFilePath` behavior from the generic source loader.
- [x] Add source validation for entries, ids, prompts, metadata, start policy,
      and failure policy.
- [x] Add validation tests for accepted and rejected source shapes.

### 2. Sequence State And Adapter

#### packages/rielflow/src/events/adapters/sequential-list.ts
#### packages/rielflow/src/events/sequential-list-state.ts
#### packages/rielflow/src/events/adapter-registry.ts

**Status**: COMPLETED

```typescript
type SequentialListItemStatus =
  | "pending"
  | "dispatching"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

interface SequentialListStateRecord {
  readonly sourceId: string;
  readonly configRevisionId: string;
  readonly runId: string;
  readonly currentIndex: number;
  readonly activeReceiptId?: string;
  readonly activeWorkflowExecutionId?: string;
  readonly activeSupervisedRunId?: string;
  readonly itemStatuses: readonly SequentialListItemState[];
  readonly lastError?: string;
}
```

**Checklist**:

- [x] Add an adapter with `kind: "sequential-list"`,
      `supportsStart: true`, and no webhook route.
- [x] Generate stable source config revisions from ordered entry ids, prompts,
      metadata, and sequencing policy.
- [x] Persist sequence state under the event runtime data root using atomic JSON
      writes or an existing runtime-store pattern.
- [x] Resume an existing state for the same source/config revision without
      redispatching completed items.
- [x] Leave the cursor on the current item in read-only mode because the item
      was not actually dispatched.
- [x] Register the adapter in `createDefaultEventSourceRegistry()`.

### 3. Dispatch Result And Completion Observation

#### packages/rielflow/src/events/source-adapter.ts
#### packages/rielflow/src/events/listener-service.ts
#### packages/rielflow/src/events/trigger-runner.ts
#### packages/rielflow/src/events/trigger-runner/trigger-dispatch-runner.ts
#### packages/rielflow/src/events/sequential-list-completion.ts

**Status**: COMPLETED

```typescript
interface EventSourceDispatchOutcome {
  readonly receipts: readonly WorkflowTriggerResult[];
}

interface SequentialListCompletionObserver {
  waitForTerminal(input: SequentialListCompletionInput): Promise<
    SequentialListTerminalResult
  >;
}
```

**Checklist**:

- [x] Return dispatch outcomes from the listener-service adapter dispatch
      callback while keeping existing adapters source-compatible.
- [x] Capture receipt id, workflow execution id, supervised run id, and
      supervisor execution id from direct, sticky, supervised, and
      supervisor-dispatch paths when available.
- [x] Add a completion observer that can resolve terminal state from runtime
      session summaries and event supervised-run records.
- [x] Treat unobservable completion as item failure and persist that failure
      before stopping or continuing according to `onItemFailure`.
- [x] Add tests proving the next item is not dispatched while the prior item is
      running, paused, pending user-action, or unknown.

### 4. Receipt, List, And Replay Semantics

#### packages/rielflow/src/events/ledger.ts
#### packages/rielflow/src/events/receipt-ops.ts
#### packages/rielflow/src/workflow/runtime-db/event-records.ts
#### packages/rielflow/src/workflow/runtime-db/schema-and-record-types.ts
#### packages/rielflow/src/cli.ts

**Status**: COMPLETED

```typescript
interface SequentialListReceiptMetadata {
  readonly sourceId: string;
  readonly bindingId: string;
  readonly configRevisionId: string;
  readonly runId: string;
  readonly itemId: string;
  readonly index: number;
  readonly total: number;
  readonly priorReceiptId?: string;
  readonly priorWorkflowExecutionId?: string;
}
```

**Checklist**:

- [x] Include sequence metadata in normalized event input for every item.
- [x] Persist enough sequence metadata for `events list` output or receipt
      artifact inspection without breaking existing receipt rows.
- [x] Ensure per-binding receipt dedupe keys include source id, binding id,
      config revision id, run id, item id, and item index.
- [x] Ensure `events replay <receipt-id>` rebuilds and dispatches only that
      receipt item with a replay-specific event id and dedupe key.
- [x] Ensure replay does not reset sequence cursor or mark completed sequence
      items pending again.
- [x] Ensure one list item matching multiple bindings creates distinct receipts
      and does not alias dedupe or replay state across bindings.
- [x] Ensure read-only mode records skipped receipt/state data without workflow
      dispatch and without advancing the durable cursor.

### 5. Examples And User Documentation

#### examples/event-sources/.rielflow-events/sources/sequential-list.json
#### examples/event-sources/.rielflow-events/bindings/sequential-list-to-arithmetic.json
#### examples/event-sources/README.md
#### README.md

**Status**: COMPLETED

```json
{
  "id": "nightly-instruction-list",
  "kind": "sequential-list",
  "entries": [
    {
      "id": "summarize-backlog",
      "prompt": "Summarize the current backlog and identify blockers."
    }
  ]
}
```

**Checklist**:

- [x] Add a runnable sequential-list source fixture under
      `examples/event-sources/.rielflow-events/sources/`.
- [x] Add a binding that maps each item prompt into workflow input.
- [x] Document configuration, validation, serving, state/resume behavior,
      receipts, list output, and single-item replay.
- [x] Keep examples usable with
      `--workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events`.

### 6. Verification Coverage

#### packages/rielflow/src/events/config.test.ts
#### packages/rielflow/src/events/adapter-registry.test.ts
#### packages/rielflow/src/events/adapters/sequential-list.test.ts
#### packages/rielflow/src/events/listener-service.test.ts
#### packages/rielflow/src/events/receipt-ops.test.ts
#### packages/rielflow/src/cli.test.ts

**Status**: COMPLETED

```typescript
interface SequentialListTestHarness {
  readonly dispatchedEvents: readonly ExternalEventEnvelope[];
  readonly completionStates: readonly string[];
  readonly receipts: readonly string[];
}
```

**Checklist**:

- [x] Cover validation acceptance and rejection cases.
- [x] Cover adapter registration and event type metadata.
- [x] Cover sequential dispatch gating with deterministic fake completion.
- [x] Cover restart resume without redispatching completed items.
- [x] Cover failure `stop` and `continue` behavior.
- [x] Cover receipt list/replay behavior for one item.
- [x] Cover one sequential-list item matching multiple bindings without dedupe
      collision.
- [x] Cover read-only behavior with no workflow dispatch and no unsafe cursor
      advancement.
- [x] Cover CLI validate/list/replay surfaces with the new fixture.

---

## Module Status

| Module | File Path | Status | Tests |
| --- | --- | --- | --- |
| Config types and validation | `packages/rielflow-events/src/types.ts`, `packages/rielflow/src/events/validate.ts` | COMPLETED | `validate-source-sequential-list.test.ts` |
| Sequence state and adapter | `packages/rielflow/src/events/adapters/sequential-list.ts`, `packages/rielflow/src/events/sequential-list-state.ts` | COMPLETED | `adapters/sequential-list.test.ts` |
| Dispatch completion gate | `packages/rielflow/src/events/listener-service.ts`, `packages/rielflow/src/events/sequential-list-completion.ts` | COMPLETED | `listener-service.test.ts`, `adapters/sequential-list.test.ts`, `sequential-list-completion.test.ts` |
| Receipt/list/replay metadata | existing receipt artifact and replay path | COMPLETED | `receipt-ops.test.ts`, `cli.test.ts` |
| Examples and docs | `examples/event-sources/README.md`, `README.md` | COMPLETED | CLI validation command |

## Dependencies

| Feature | Depends On | Status |
| --- | --- | --- |
| TASK-001 Config types and validation | Accepted design | COMPLETED |
| TASK-002 State and adapter | TASK-001 | COMPLETED |
| TASK-003 Completion observation | TASK-001, TASK-002 | COMPLETED |
| TASK-004 Receipt/list/replay semantics | TASK-002, TASK-003 | COMPLETED |
| TASK-005 Examples and documentation | TASK-001, TASK-004 | COMPLETED |
| TASK-006 Verification coverage | TASK-001 through TASK-005 as test targets become available | COMPLETED |

---

## Tasks

### TASK-001: Config Types And Validation

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow-events/src/types.ts`, `packages/rielflow/src/events/config.ts`, `packages/rielflow/src/events/validate.ts`, `packages/rielflow/src/events/validate-source-sequential-list.ts`, `packages/rielflow/src/events/validate-source-sequential-list.test.ts`
**Dependencies**: None

**Description**:
Add the source config contract and validation errors required by the accepted
design. Validation must reject missing/empty/non-array entries, non-object
entries, empty or duplicate ids, unsafe ids, missing or empty prompts,
non-object metadata, and unknown `startPolicy` or `onItemFailure` values.

**Completion Criteria**:

- [x] `sequential-list` is part of the source config union.
- [x] Supported source kinds include `sequential-list`.
- [x] Validation reports precise paths for malformed entry fields.
- [x] Existing source validation tests still pass.

### TASK-002: State Repository And Adapter Lifecycle

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/events/adapters/sequential-list.ts`, `packages/rielflow/src/events/sequential-list-state.ts`, `packages/rielflow/src/events/adapter-registry.ts`, `packages/rielflow/src/events/adapters/sequential-list.test.ts`, `packages/rielflow/src/events/adapter-registry.test.ts`
**Dependencies**: TASK-001

**Description**:
Implement the startable local adapter and durable sequence state. The adapter
must drain from the first pending item on serve startup, persist transitions
before and after dispatch, and preserve the cursor across listener restarts for
the same source/config revision.

**Completion Criteria**:

- [x] Adapter normalizes entries to `sequential-list.item.ready`.
- [x] Event input includes source id, config revision id, run id, index, total,
      item id, prompt, metadata, and prior item references.
- [x] Adapter state survives restart and does not redispatch completed items.
- [x] Registry tests prove the adapter is available by default.

### TASK-003: Completion-Gated Dispatch

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/events/source-adapter.ts`, `packages/rielflow/src/events/listener-service.ts`, `packages/rielflow/src/events/sequential-list-completion.ts`, `packages/rielflow/src/events/trigger-runner/trigger-dispatch-runner.ts`, `packages/rielflow/src/events/listener-service.test.ts`
**Dependencies**: TASK-001, TASK-002

**Description**:
Expose dispatch results to startable adapters and implement completion
observation for sequential-list items. The sequence controller must wait for
terminal completion before dispatching the next item and must stop or continue
according to persisted failure policy.

**Completion Criteria**:

- [x] Existing cron, file-change, and Matrix adapter tests remain compatible
      with the dispatch callback contract.
- [x] Direct and sticky execution paths provide enough execution ids for
      completion observation.
- [x] Supervised and supervisor-dispatch paths use supervised-run or supervisor
      execution state when workflow execution state is not sufficient.
- [x] Unknown or unobservable completion fails the active item without
      advancing unsafely.

### TASK-004: Receipts, List Output, And Replay

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `packages/rielflow/src/events/ledger.ts`, `packages/rielflow/src/events/receipt-ops.ts`, `packages/rielflow/src/workflow/runtime-db/event-records.ts`, `packages/rielflow/src/workflow/runtime-db/schema-and-record-types.ts`, `packages/rielflow/src/cli.ts`, `packages/rielflow/src/events/receipt-ops.test.ts`, `packages/rielflow/src/cli.test.ts`
**Dependencies**: TASK-002, TASK-003

**Description**:
Make sequence item receipts inspectable and replayable using existing receipt
semantics. Replay must operate on the persisted normalized item and must not
mutate sequence cursor state except by creating replay-specific receipts.

**Completion Criteria**:

- [x] Normalized item artifacts contain sequence metadata.
- [x] `events list` exposes sequence metadata for sequential-list receipts or
      points to an artifact that contains it.
- [x] Receipt dedupe keys uniquely identify one source/config/run/item/index.
- [x] Receipt dedupe keys include binding id so one item can match multiple
      bindings without aliasing.
- [x] Replay creates a new receipt for the selected item only.
- [x] Replay tests prove completed items are not redispatched as a sequence.
- [x] Read-only mode records receipts/state without dispatch and does not
      advance the cursor past the undispatched item.

### TASK-005: Examples And Documentation

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `examples/event-sources/.rielflow-events/sources/sequential-list.json`, `examples/event-sources/.rielflow-events/bindings/sequential-list-to-arithmetic.json`, `examples/event-sources/README.md`, `README.md`
**Dependencies**: TASK-001, TASK-004

**Description**:
Add user-facing configuration and command examples after the runtime behavior
is stable enough to document precisely.

**Completion Criteria**:

- [x] Example source and binding validate with existing event root commands.
- [x] README documents source shape, validation, serving, receipts, restart
      resume behavior, and replay/inspection behavior.
- [x] Example README includes explicit `events validate`, `events serve`,
      `events list`, and `events replay` commands.

### TASK-006: Final Verification And Plan Sync

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `impl-plans/active/sequential-list-event-source.md`, `impl-plans/README.md`, `impl-plans/PROGRESS.json`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Description**:
Run the complete verification set, update task checkboxes and progress log,
and keep plan indexes aligned with the final implementation state.

**Completion Criteria**:

- [x] `bun run typecheck` passes.
- [x] Targeted event-source tests pass.
- [x] Example event configuration validates.
- [x] Read-only sequential-list verification passes with
      `DIVEDRA_EVENTS_READ_ONLY=true` or `--read-only`.
- [x] Plan progress log records commands, results, and residual risks.
- [x] README and progress indexes match the implementation state.

---

## Parallelizable Tasks

Only TASK-005 is marked parallelizable, and only after TASK-004 is complete.
Its write scope is documentation and examples, separate from runtime TypeScript
files. TASK-001 through TASK-004 are intentionally serialized because the
source config, adapter lifecycle, dispatch callback contract, completion
observer, receipts, and replay semantics share runtime contracts.

## Verification Plan

- `bun run typecheck`
- `bun test packages/rielflow/src/events/validate-source-sequential-list.test.ts packages/rielflow/src/events/adapter-registry.test.ts packages/rielflow/src/events/adapters/sequential-list.test.ts packages/rielflow/src/events/sequential-list-completion.test.ts packages/rielflow/src/events/listener-service.test.ts packages/rielflow/src/events/receipt-ops.test.ts packages/rielflow/src/cli.test.ts`
- `bun run packages/rielflow/src/bin.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events`
- `DIVEDRA_EVENTS_READ_ONLY=true bun test packages/rielflow/src/events/adapters/sequential-list.test.ts`
- `bun run packages/rielflow/src/bin.ts events list --event-root ./examples/event-sources/.rielflow-events`
- `rg -n "sequential-list|Sequential List" README.md examples/event-sources/README.md design-docs/specs/command.md design-docs/specs/design-event-listener-workflow-trigger.md`

## Completion Criteria

- [x] `sequential-list` validates as a supported source kind.
- [x] `events serve` dispatches one prompt entry at a time.
- [x] The next item waits for terminal completion of the previous workflow or
      supervised run.
- [x] Restarting `events serve` resumes the durable cursor without rerunning
      completed items.
- [x] Receipts include sequence metadata and stable dedupe keys with binding id.
- [x] Replay targets one receipt item and does not reset the sequence.
- [x] One item matching multiple bindings produces distinct receipts and replay
      targets.
- [x] Read-only mode records receipts/state without workflow dispatch and does
      not advance past the undispatched item.
- [x] Fresh direct execution and sticky/session continuation behavior remain
      covered.
- [x] Existing webhook, cron, Matrix, Chat SDK, S3 repository, and file-change
      tests continue to pass.
- [x] User-facing README and example docs cover configuration, validation,
      serving, receipts/state, and replay/inspection.

## Progress Log

### Session: 2026-05-22 23:00

**Tasks Completed**: Planning only
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Created the active implementation plan after Step 3 accepted the
design with no high or mid findings. Later implementation sessions must update
task statuses, checkboxes, verification results, and residual risks before
handoff.

### Session: 2026-05-22 23:10

**Tasks Completed**: Step 5 feedback addressed in plan
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added explicit binding id coverage for sequential-list receipt
dedupe and multi-binding tests. Added explicit read-only mode implementation
and verification expectations so read-only receipt/state recording does not
dispatch workflows or advance the durable cursor past an undispatched item.

### Session: 2026-05-22 23:58

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005,
TASK-006
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Implemented the `sequential-list` source contract, validation,
default adapter registration, durable state repository, completion observer,
listener dispatch outcomes, example source/binding fixtures, and user-facing
documentation. Sequence metadata is stored in normalized receipt artifacts, so
existing `events list`/`events replay` behavior can inspect and replay one
persisted item without resetting sequence state. Verified with `bun run
typecheck`, `bun run lint:biome`, targeted event-source tests, read-only
sequential-list tests, example `events validate`, and `git diff --check`.

### Session: 2026-05-22 23:59

**Tasks Completed**: Step 6 self-review remediation
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed Step 6 self-review findings by bounding unobservable
completion polling so missing local session/supervised state fails the active
item instead of hanging, fixing skipped terminal cursor advancement so
`onItemFailure: "continue"` advances exactly once, and adding regression
coverage for both behaviors. Re-ran targeted sequential-list adapter and
completion tests before the final verification set.

### Session: 2026-05-22 23:59 Follow-up

**Tasks Completed**: Step 6 self-review restart remediation
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Addressed the follow-up Step 6 self-review finding for listener
restart during an in-flight sequential-list item. The adapter now observes
persisted workflow or supervised execution ids for a `dispatching` item before
dispatching the next prompt, and duplicate-only dispatch outcomes fail safely
instead of being treated as completed. Added regression tests for both restart
resume gating and duplicate-only outcomes.

## Related Plans

- **Previous**: `impl-plans/completed/event-source-adapters.md`
- **Previous**: `impl-plans/event-listener-workflow-trigger-foundation.md`
- **Related**: `impl-plans/event-receipt-operator-commands.md`
- **Related**: `impl-plans/event-root-manager-session-stickiness.md`
