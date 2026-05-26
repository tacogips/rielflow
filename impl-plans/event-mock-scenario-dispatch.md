# Event Mock Scenario Dispatch Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-event-listener-workflow-trigger.md#cli-and-server-surface
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: design-docs/specs/design-event-listener-workflow-trigger.md

### Summary

Allow event-triggered workflow execution to use the existing deterministic
`--mock-scenario` runtime path. This makes event source fixtures executable
without a live GraphQL endpoint or real agent backend transports.

### Scope

**Included**: event trigger runner mock-scenario pass-through, `events emit`,
`events serve`, and `events replay` CLI option propagation, tests for local
event dispatch without endpoint, and example documentation.

**Excluded**: new mock scenario file format, provider SDK simulation, and
browser/TUI receipt views.

---

## Modules

### 1. Event Trigger Runner Mock Pass-Through

#### src/events/trigger-runner.ts

**Status**: COMPLETED

```typescript
interface WorkflowTriggerRunnerOptions extends RielflowOptions {
  readonly mockScenario?: MockNodeScenario;
}
```

**Checklist**:

- [x] Accept mock scenarios on event trigger runner options
- [x] Pass mock scenarios to local or GraphQL workflow client execution
- [x] Preserve existing endpoint behavior

### 2. CLI Event Options

#### src/cli.ts

**Status**: COMPLETED

```typescript
const eventOptions = {
  ...sharedOptions,
  ...mockScenarioOptions,
};
```

**Checklist**:

- [x] Parse `--mock-scenario` for `events emit`
- [x] Parse `--mock-scenario` for `events serve`
- [x] Parse `--mock-scenario` for `events replay`
- [x] Keep validation and list commands independent from workflow mocks

### 3. Tests And Examples

#### src/cli.test.ts and examples/event-sources/README.md

**Status**: COMPLETED

**Checklist**:

- [x] Unit test local event emit with `--mock-scenario` and no endpoint
- [x] Confirm no fetch or provider transport is required
- [x] Document no-server deterministic event fixture usage

## Tasks

### TASK-001: Trigger Runner And CLI Pass-Through

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/trigger-runner.ts`, `src/cli.ts`
**Dependencies**: `event-receipt-operator-commands:TASK-003`

### TASK-002: Local Mock Dispatch Test

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli.test.ts`
**Dependencies**: TASK-001

### TASK-003: Example Documentation

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `examples/event-sources/README.md`
**Dependencies**: TASK-001

## Completion Criteria

- [x] `events emit --mock-scenario` can dispatch locally without `--endpoint`
- [x] Event replay and serve accept the same mock scenario options through the
      shared event dispatch path
- [x] Focused event/CLI tests pass
- [x] Type checking passes
- [x] Event fixture validation still passes

## Progress Log

### Session: 2026-04-20 17:05

**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Blockers**: None
**Notes**: Wired mock scenarios through event dispatch and documented the
deterministic local fixture path.
