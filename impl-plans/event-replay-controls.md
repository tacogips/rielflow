# Event Replay Controls Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-event-listener-workflow-trigger.md#cli-and-server-surface
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: design-docs/specs/design-event-listener-workflow-trigger.md

### Summary

Add operator controls to event replay so users can dry-run replay dispatch and
attach an audit reason to the replay receipt artifacts.

### Scope

**Included**: `events replay --dry-run`, `events replay --reason <text>`,
event dispatch pass-through for workflow execution limits, replay audit raw
artifact metadata, CLI JSON/text output, and focused tests.

**Excluded**: UI receipt views, provider-specific replay policies, and
distributed replay approval workflows.

---

## Modules

### 1. Event Dispatch Execution Controls

#### src/events/trigger-runner.ts

**Status**: COMPLETED

```typescript
interface WorkflowTriggerRunnerOptions extends RielflowOptions {
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
}
```

**Checklist**:

- [x] Pass dry-run and execution limits to workflow client execution
- [x] Keep existing mock-scenario and endpoint behavior

### 2. Replay Reason Metadata

#### src/events/receipt-ops.ts

**Status**: COMPLETED

```typescript
interface ReplayEventReceiptInput {
  readonly reason?: string;
}
```

**Checklist**:

- [x] Accept optional replay reason
- [x] Persist replay reason in the replay receipt raw artifact
- [x] Return replay reason metadata to CLI

### 3. CLI And Tests

#### src/cli.ts and src/cli.test.ts

**Status**: COMPLETED

**Checklist**:

- [x] Parse `--reason <text>`
- [x] Include dry-run and reason in `events replay`
- [x] Cover GraphQL dry-run pass-through and replay reason output

## Tasks

### TASK-001: Dispatch Control Pass-Through

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/trigger-runner.ts`, `src/cli.ts`
**Dependencies**: `event-mock-scenario-dispatch:TASK-001`

### TASK-002: Replay Reason Audit Metadata

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/receipt-ops.ts`
**Dependencies**: TASK-001

### TASK-003: CLI Tests And Docs

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/cli.test.ts`, `src/events/receipt-ops.test.ts`, `README.md`, `design-docs/specs/command.md`
**Dependencies**: TASK-002

## Completion Criteria

- [x] `events replay --dry-run` passes dry-run to workflow execution
- [x] `events replay --reason <text>` persists audit metadata
- [x] Focused event and CLI tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-04-20 17:25

**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Blockers**: None
**Notes**: Replay dry-run and reason metadata are implemented on the existing
receipt replay path without adding provider-specific behavior.
