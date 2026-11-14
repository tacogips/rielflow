# Workflow Runner Event Channel Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-event-supervisor-control.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-06

## Summary

Implement workflow-run event delivery so the workflow runner does not print
internal logs unless debug mode is enabled. When verbose step progress is
requested, the runner emits typed workflow-run events through an in-process
channel-like interface, and the deterministic supervisor owns display.

## Scope

- In scope: typed workflow-run events, runner emission, supervisor consumption,
  CLI verbose display through supervisor-owned rendering, tests, docs.
- Out of scope: external event-source transport changes, LLM command-analysis
  behavior, and unrelated supervisor command semantics.

## Modules

### TASK-001: Workflow Run Event Contract

**Status**: Completed
**Dependencies**: None
**Deliverables**:

```typescript
interface WorkflowRunEventSink {
  emit(event: WorkflowRunEvent): void | Promise<void>;
}

type WorkflowRunEvent =
  | {
      type: "step-started";
      workflowExecutionId: string;
      stepId: string;
      nodeExecId: string;
    }
  | {
      type: "step-completed";
      workflowExecutionId: string;
      stepId: string;
      nodeExecId: string;
      status: string;
    }
  | { type: "workflow-completed"; workflowExecutionId: string; status: string };
```

**Completion Criteria**:

- [x] Add event contract in the workflow runtime layer.
- [x] Support no-op/default sinks without changing normal output behavior.
- [x] Add unit coverage for event sink invocation shape.

### TASK-002: Runner Quiet/Debug/Verbose Emission

**Status**: Completed
**Dependencies**: TASK-001
**Deliverables**:

```typescript
interface WorkflowRunEventOptions {
  readonly eventSink?: WorkflowRunEventSink;
  readonly debug?: boolean;
}
```

**Completion Criteria**:

- [x] Ensure runner internals do not print progress in non-debug mode.
- [x] Keep debug logging explicit and opt-in.
- [x] Emit step-progress events instead of writing verbose progress directly.
- [x] Preserve JSON stdout cleanliness for CLI `--output json`.

### TASK-003: Supervisor-Owned Verbose Display

**Status**: Completed
**Dependencies**: TASK-001, TASK-002
**Deliverables**:

```typescript
interface SupervisorProgressRenderer {
  readonly verbose: boolean;
  handle(event: WorkflowRunEvent): void;
}
```

**Completion Criteria**:

- [x] Route CLI verbose progress through a supervisor-owned event consumer.
- [x] Keep rendering behavior equivalent to existing verbose step-progress UX.
- [x] Add focused CLI/runtime tests proving verbose output is event-driven.

### TASK-004: Verification And Documentation

**Status**: Completed
**Dependencies**: TASK-001, TASK-002, TASK-003
**Deliverables**:

```typescript
interface WorkflowRunEventVerification {
  readonly typecheck: "passed";
  readonly tests: readonly string[];
}
```

**Completion Criteria**:

- [x] Update design/command docs where the runner/supervisor boundary is described.
- [x] Run `bun run typecheck`.
- [x] Run focused workflow runner, supervisor, and CLI tests.
- [x] Update this plan progress log and mark completed tasks accurately.

## Progress Log

### Session: 2026-05-06

**Tasks Completed**: None.

**Tasks In Progress**: None.

**Blockers**: None.

**Notes**: Created so `impl-plan-completion-loop` can continuously implement and
review the latest runner-event/logging requirement as an active plan.

### Session: 2026-05-06 20:33 JST

**Tasks Completed**: TASK-001.

**Tasks In Progress**: None.

**Blockers**: None.

**Notes**: Added `WorkflowRunEventSink`, typed workflow-run events, an explicit
no-op sink, runtime event emission for step start/completion and workflow
completion, public exports, and focused engine unit coverage. Verified with
`bun test src/workflow/engine.test.ts`.

### Session: 2026-05-06 20:41 JST

**Tasks Completed**: TASK-002.

**Tasks In Progress**: None.

**Blockers**: None.

**Notes**: Added `WorkflowRunEventOptions.debug`, kept legacy `onProgress`
callbacks quiet unless debug is enabled, enriched step-started workflow-run
events with local rendering metadata, routed CLI `--verbose` through
`WorkflowRunEventSink`, added `--debug` option plumbing, and verified JSON
stdout remains clean for verbose JSON workflow runs. Verified with
`bun test src/workflow/engine.test.ts`, `bun test src/cli.test.ts`, and
`bun run typecheck`.

### Session: 2026-05-06 20:46 JST

**Tasks Completed**: TASK-003.

**Tasks In Progress**: None.

**Blockers**: None.

**Notes**: Added a supervisor-owned workflow-run progress renderer and event
sink adapter, routed CLI `--verbose` workflow progress through that renderer,
preserved the existing verbose step-start output shape, exported the renderer
API, and added focused runtime coverage for event-driven rendering. Verified
with `bun test src/workflow/supervisor-progress-renderer.test.ts`,
`bun test src/cli.test.ts --grep verbose`, `bun test src/cli.test.ts`, and
`bun run typecheck`.

### Session: 2026-05-06 20:50 JST

**Tasks Completed**: TASK-004.

**Tasks In Progress**: None.

**Blockers**: None.

**Notes**: Updated design and command documentation to describe the workflow
runner event channel, no-op default event sink, supervisor-owned verbose
rendering boundary, and explicit debug-only progress callbacks. Verified with
`bun test src/workflow/supervisor-progress-renderer.test.ts`,
`bun test src/workflow/engine.test.ts --grep "workflow-run event|progress callbacks"`,
`bun test src/cli.test.ts --grep verbose`, `bun run typecheck`, and
`git diff --check -- design-docs/specs/command.md design-docs/specs/architecture.md design-docs/specs/design-event-supervisor-control.md impl-plans/active/workflow-runner-event-channel.md`.
