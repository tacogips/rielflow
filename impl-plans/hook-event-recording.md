# Hook Event Recording Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-hook-command.md#hook-event-recording
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

---

## Design Document Reference

**Source**: `design-docs/specs/design-hook-command.md`

### Summary

Implement workflow-aware hook event recording for `rielflow hook`. The command should keep its cross-vendor pass-through behavior while associating Claude/Codex hook `session_id` values with the ambient rielflow workflow execution and persisting hook events.

### Scope

**Included**: ambient hook context resolution, hook recording controls, redacted payload artifacts, runtime database table and queries, recorder integration in `rielflow hook`, generic node execution env injection for agent backends, focused tests
**Excluded**: new TUI screens, GraphQL schema exposure, non-noop policy decisions, generated Claude/Codex config installers

---

## Modules

### 1. Hook Context and Redaction

#### `src/hook/context.ts`, `src/hook/redaction.ts`, `src/hook/types.ts`

**Status**: COMPLETED

```typescript
interface RielflowHookContext {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly agentSessionId: string;
  readonly managerSessionId?: string;
  readonly agentBackend?: string;
}

type HookRecordingMode = "auto" | "off" | "required";
type HookPayloadCaptureMode = "redacted" | "metadata-only" | "full";
```

**Checklist**:

- [x] Resolve required context from env and hook payload
- [x] Support manager-node fallback env names
- [x] Parse recording and capture controls
- [x] Redact sensitive payload keys by default
- [x] Unit tests

### 2. Runtime Persistence

#### `src/workflow/runtime-db.ts`, `src/hook/recorder.ts`

**Status**: COMPLETED

```typescript
interface RuntimeHookEventSaveInput {
  readonly hookEventId: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly managerSessionId?: string;
  readonly vendor: string;
  readonly agentSessionId: string;
  readonly rawEventName: string;
  readonly eventName: string;
  readonly status: string;
}
```

**Checklist**:

- [x] Create `hook_events` table and indexes
- [x] Add save/list runtime DB APIs
- [x] Write redacted payload artifacts under `hooks/...`
- [x] Persist normal, blocked, and failed handler outcomes
- [x] Unit tests

### 3. Hook Command Integration

#### `src/hook/index.ts`, `src/hook/index.test.ts`, `src/cli.test.ts`

**Status**: COMPLETED

```typescript
interface HookCommandDependencies {
  readonly readStdin: () => Promise<string>;
  readonly dispatchHook?: (ctx: ParsedHookContext) => Promise<HookResponse>;
  readonly env?: Readonly<Record<string, string | undefined>>;
}
```

**Checklist**:

- [x] Add rielflow context to parsed hook dispatch context
- [x] Record events after handler response
- [x] Best-effort record handler failures and block errors
- [x] Preserve pass-through behavior outside rielflow context
- [x] Unit tests

### 4. Agent Backend Env Injection

#### `src/workflow/adapter.ts`, `src/workflow/engine.ts`, `src/workflow/call-node.ts`, `src/workflow/adapters/*.ts`

**Status**: COMPLETED

```typescript
interface AdapterRielflowHookContext {
  readonly environment: {
    readonly DIVEDRA_WORKFLOW_ID: string;
    readonly DIVEDRA_WORKFLOW_EXECUTION_ID: string;
    readonly DIVEDRA_NODE_ID: string;
    readonly DIVEDRA_NODE_EXEC_ID: string;
    readonly DIVEDRA_AGENT_BACKEND: string;
  };
}
```

**Checklist**:

- [x] Inject generic rielflow hook env for all agent backend executions
- [x] Preserve existing manager control-plane env injection
- [x] Cover Codex and Claude adapters
- [x] Unit tests

---

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Hook context and redaction | `src/hook/context.ts`, `src/hook/redaction.ts`, `src/hook/types.ts` | COMPLETED | Passed |
| Runtime persistence | `src/workflow/runtime-db.ts`, `src/hook/recorder.ts` | COMPLETED | Passed |
| Hook command integration | `src/hook/index.ts`, `src/hook/index.test.ts`, `src/cli.test.ts` | COMPLETED | Passed |
| Agent backend env injection | `src/workflow/adapter.ts`, `src/workflow/engine.ts`, `src/workflow/call-node.ts`, `src/workflow/adapters/*.ts` | COMPLETED | Passed |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Hook context and redaction | Hook recording design | Completed |
| Runtime persistence | Hook context and redaction | Completed |
| Hook command integration | Runtime persistence | Completed |
| Agent backend env injection | Hook context types | Completed |

## Completion Criteria

- [x] `rielflow hook` records workflow-associated hook events
- [x] Hook recording is pass-through outside rielflow context
- [x] Payload artifacts are redacted by default
- [x] Backend agent processes receive generic rielflow hook env
- [x] Focused hook/runtime/adapter tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-04-20 15:52 JST

**Tasks Completed**: Plan creation
**Tasks In Progress**: TASK-001 through TASK-004
**Blockers**: None
**Notes**: Implementing the complete design slice in one session because the storage, hook pipeline, and adapter env injection are tightly coupled.

### Session: 2026-04-20 16:00 JST

**Tasks Completed**: TASK-001 through TASK-004
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Implemented ambient hook context resolution, redacted payload artifacts, runtime `hook_events` persistence, hook command recording, agent backend env injection, session export hook-event inclusion, and focused regression coverage. Verified with focused tests, full `bun run test`, and `bun run typecheck:server`.

## Related Plans

- **Previous**: `impl-plans/hook-command-review-follow-up.md`
- **Next**: None
- **Depends On**: `impl-plans/hook-command.md`, `impl-plans/hook-command-hardening.md`, `impl-plans/hook-command-cross-vendor-alignment.md`, `impl-plans/hook-command-review-follow-up.md`
