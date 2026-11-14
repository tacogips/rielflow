# Node Execution Inbox Contract Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-execution-inbox-contract.md`, `design-docs/specs/design-node-mailbox.md`, `design-docs/specs/architecture.md`
**Created**: 2026-03-17
**Last Updated**: 2026-03-17

## Scope

Implement the first runtime slice of the universal node execution inbox/outbox
contract so worker-facing execution context no longer depends on implicit
workflow or canonical mailbox knowledge.

In scope:

- define typed execution-mailbox metadata and input payload structures
- persist `mailbox/inbox/meta.json` and `mailbox/inbox/input.json` for agent
  executions
- create execution-local `mailbox/outbox/` directories
- feed agent prompt composition from the same compiled execution-mailbox
  contract
- expose the compiled execution-mailbox contract to remote adapter wrappers
- add regression coverage for persisted mailbox artifacts and prompt derivation

Out of scope:

- command-node execution
- container-node execution
- input/output file attachment transport beyond empty mailbox file directories
- changing canonical `communications/{communicationId}/...` routing semantics

## Modules

### 1. Execution Mailbox Types and Builders

#### `src/workflow/node-execution-mailbox.ts`

**Status**: COMPLETED

```typescript
export interface NodeExecutionMailboxMeta {
  readonly protocolVersion: 1;
  readonly mailboxDirEnvVar: "DIVEDRA_MAILBOX_DIR";
  readonly node: {
    readonly workflowId: string;
    readonly workflowDescription: string;
    readonly nodeId: string;
    readonly nodeKind: string;
  };
  readonly objective: {
    readonly reason: string;
    readonly expectedReturn: string;
    readonly instruction: string;
  };
  readonly paths: {
    readonly inputPath: "inbox/input.json";
    readonly inputFilesDir: "inbox/files";
    readonly outputPath: "outbox/output.json";
    readonly outputFilesDir: "outbox/files";
  };
}

export interface NodeExecutionMailboxInputPayload {
  readonly arguments: Readonly<Record<string, unknown>> | null;
  readonly humanInput?: unknown;
  readonly workflowOutput?: unknown;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
}

export interface NodeExecutionMailbox {
  readonly meta: NodeExecutionMailboxMeta;
  readonly input: NodeExecutionMailboxInputPayload;
}
```

**Checklist**:

- [x] Add typed worker-facing mailbox metadata and input payload interfaces
- [x] Build execution-mailbox metadata from workflow/node context
- [x] Build prompt-rendering helpers from the compiled mailbox contract

### 2. Prompt Composition and Adapter Input

#### `src/workflow/prompt-composition.ts`

#### `src/workflow/adapter.ts`

#### `src/workflow/adapters/shared.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Make prompt composition render from the compiled execution-mailbox contract
- [x] Preserve current manager/worker prompt guidance headings where possible
- [x] Pass execution-mailbox metadata/input through remote adapter request bodies

### 3. Runtime Persistence

#### `src/workflow/engine.ts`

#### `src/workflow/call-step-impl.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Persist `mailbox/inbox/meta.json` and `mailbox/inbox/input.json`
- [x] Create execution-local `mailbox/outbox/` directories
- [x] Record the execution-mailbox contract in root execution `input.json`

### 4. Regression Tests

#### `src/workflow/prompt-composition.test.ts`

#### `src/workflow/engine.test.ts`

#### `src/workflow/call-step-impl.test.ts`

#### `src/workflow/adapters/codex.test.ts`

#### `src/workflow/adapters/claude.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Verify prompt composition still exposes manager/worker execution guidance
- [x] Verify execution mailbox artifacts are persisted for workflow runs
- [x] Verify direct `call-step` executions persist the same mailbox artifacts
- [x] Verify remote adapter requests include the compiled execution-mailbox contract

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Execution mailbox builders | `src/workflow/node-execution-mailbox.ts` | COMPLETED | `prompt-composition.test.ts` |
| Prompt integration | `src/workflow/prompt-composition.ts` | COMPLETED | `prompt-composition.test.ts` |
| Runtime persistence | `src/workflow/engine.ts`, `src/workflow/call-step-impl.ts` | COMPLETED | `engine.test.ts`, `call-step-impl.test.ts` |
| Adapter transport | `src/workflow/adapter.ts`, `src/workflow/adapters/shared.ts` | COMPLETED | `codex.test.ts`, `claude.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Execution mailbox builders | Existing prompt/mailbox design | COMPLETED |
| Prompt integration | Execution mailbox builders | COMPLETED |
| Runtime persistence | Prompt integration | COMPLETED |
| Regression tests | Runtime persistence, adapter transport | COMPLETED |

## Completion Criteria

- [x] Universal execution-mailbox types exist in the runtime codebase
- [x] Agent executions persist worker-facing mailbox artifacts under node artifacts
- [x] Agent prompts are derived from the same compiled mailbox contract
- [x] Remote adapter bodies include the compiled execution-mailbox contract
- [x] Focused tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-03-17 18:10 JST

**Tasks Completed**: Execution mailbox design slice, runtime persistence, prompt integration, focused regression coverage
**Tasks In Progress**: None
**Blockers**: None
**Notes**: This slice keeps canonical manager-owned communication artifacts unchanged while adding a worker-facing `mailbox/` subtree under each node execution. The prompt path now derives from the same compiled execution mailbox that future command/container executors can mount on disk.
