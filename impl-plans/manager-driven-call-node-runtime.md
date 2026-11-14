# Manager-Driven Call-Node Runtime Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md`, `design-docs/specs/command.md`, `design-docs/specs/design-node-jump-and-code-manager-runtime.md`
**Created**: 2026-03-15
**Last Updated**: 2026-03-16

**Supersession (phase 133)**: The public `call-node` CLI command and `callWorkflowNode` library entrypoint were removed in favor of `call-step` and `callWorkflowStep`. Direct execution is implemented in `src/workflow/call-step-impl.ts` (internal `callNode` only used from `src/workflow/call-step.ts`). See `impl-plans/workflow-legacy-compatibility-removal.md` and `impl-plans/completed/step-addressed-workflow-runtime-cutover.md`.

## Scope

Implement the first additive slice of the manager-driven runtime without removing
the existing queue-based workflow engine. This slice adds a local `call-node`
path that lets an existing workflow session invoke one node directly, applies
runtime-owned output validation and repair, persists canonical artifacts, and
exposes the flow through the library and CLI.

Out of scope for this plan:

- Replacing `runWorkflow` scheduling
- Adding GraphQL `call-node` transport
- Redesigning browser UI flows

## Modules

### 1. Direct Node Call Runtime

#### `src/workflow/call-node.ts`

**Status**: COMPLETED

```ts
export interface CallNodeInput extends LoadOptions, SessionStoreOptions {
  readonly workflowId: string;
  readonly workflowRunId: string;
  readonly nodeId: string;
  readonly message?: unknown;
  readonly mockScenario?: MockNodeScenario;
  readonly dryRun?: boolean;
  readonly defaultTimeoutMs?: number;
}

export interface CallNodeSuccess {
  readonly session: WorkflowSessionState;
  readonly nodeExecution: NodeExecutionRecord;
  readonly output: Readonly<Record<string, unknown>>;
  readonly outputRef: OutputRef;
  readonly exitCode: 0;
}

export interface CallNodeFailure {
  readonly session: WorkflowSessionState;
  readonly nodeExecution?: NodeExecutionRecord;
  readonly exitCode: number;
  readonly message: string;
}

export async function callNode(
  input: CallNodeInput,
  adapter?: NodeAdapter,
): Promise<Result<CallNodeSuccess, CallNodeFailure>>;
```

**Checklist**:

- [x] Load and verify target workflow session
- [x] Execute one node through `NodeAdapter`
- [x] Apply runtime-owned output validation and repair loop
- [x] Persist canonical artifacts and session state
- [x] Index node execution in runtime DB

### 2. Public Library Surface

#### `src/lib.ts`

**Status**: COMPLETED

```ts
export interface CallWorkflowNodeInput extends CallNodeInput {}

export async function callWorkflowNode(input: CallWorkflowNodeInput): Promise<{
  readonly sessionId: string;
  readonly nodeExecId: string;
  readonly status: "succeeded";
  readonly exitCode: number;
  readonly output: Readonly<Record<string, unknown>>;
}>;
```

**Checklist**:

- [x] Export the additive call-node runtime
- [x] Keep existing workflow APIs unchanged
- [x] Provide a stable library entrypoint for manager-driven callers

### 3. CLI Surface

#### `src/cli.ts`

**Status**: COMPLETED

```ts
interface ParsedOptions {
  readonly messageJson?: string;
  readonly messageFile?: string;
}

// usage:
// divedra call-node <workflow-id> <workflow-run-id> <node-id> [options]
```

**Checklist**:

- [x] Add local `call-node` CLI command
- [x] Accept structured manager message via inline JSON or file
- [x] Return clear errors for unsupported remote transport
- [x] Support text and JSON output modes

### 4. Tests

#### `src/workflow/call-node.test.ts`

#### `src/cli.test.ts`

#### `src/lib.test.ts`

**Status**: COMPLETED

```ts
describe("callNode", () => {});
describe("runCli call-node", () => {});
describe("library api callWorkflowNode", () => {});
```

**Checklist**:

- [x] Cover successful direct node invocation
- [x] Cover output validation repair loop
- [x] Cover CLI manager message input path
- [x] Keep typecheck and focused tests passing

## Dependencies

| Task              | Depends On                        | Status  |
| ----------------- | --------------------------------- | ------- |
| Runtime call path | Existing workflow/session storage | Ready   |
| Library export    | Runtime call path                 | Blocked |
| CLI command       | Runtime call path                 | Blocked |
| Tests             | Runtime, library, CLI surfaces    | Blocked |

## Completion Criteria

- [x] `call-node` runtime works against an existing workflow session
- [x] Output validation failures re-enter the same node session for repair
- [x] Library exposes the new direct node call API
- [x] CLI exposes `divedra call-node ...`
- [x] `bun run typecheck` passes
- [x] Focused tests for runtime, library, and CLI pass

## Progress Log

### Session: 2026-03-15 23:00 JST

**Tasks Completed**: Created plan and began repairing the in-progress `call-node` implementation
**Tasks In Progress**: Direct node call runtime, library surface, CLI surface, focused tests
**Blockers**: None
**Notes**: The additive implementation already exists partially in `src/workflow/call-node.ts`; current work is converging that module, then wiring CLI and tests around it.

### Session: 2026-03-15 23:35 JST

**Tasks Completed**: Direct node call runtime, library surface, CLI surface, focused tests
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Implemented local `divedra call-node`, added runtime-owned output validation/repair, exported the library wrapper, and verified with `bun run typecheck` plus focused tests for runtime, CLI, and library behavior.

### Session: 2026-03-16 19:10 JST

**Tasks Completed**: Post-implementation review hardening for the additive call-node runtime
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Aligned `src/workflow/call-node.ts` with the design and queue-engine behavior by persisting per-attempt validation artifacts under each node execution, retrying adapter-level `invalid_output` failures for structured-output nodes, and rejecting direct calls against terminal workflow sessions.
