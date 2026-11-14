# GraphQL CLI Execution Transport Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-graphql-manager-control-plane.md#canonical-api-direction, design-docs/specs/command.md#graphql-canonicalization
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Previous**: `impl-plans/graphql-manager-control-plane-surface.md`
- **Current Plan**: `impl-plans/graphql-cli-execution-transport.md`

## Design Document Reference

**Source**:
- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/command.md`

### Summary

The GraphQL control plane already exists, but the legacy CLI execution commands still bypass it. This plan implements the first bounded migration slice:

- `workflow run --endpoint` executes through GraphQL,
- `session resume --endpoint` executes through GraphQL,
- `session rerun --endpoint` executes through GraphQL,
- command documentation makes the hybrid migration state explicit.

### Scope

**Included**:

- opt-in GraphQL transport for legacy execution commands when `--endpoint` is provided
- shared CLI helpers for GraphQL execution requests and response decoding
- tests covering remote execution transport and unsupported local-only flags

**Excluded**:

- automatic transport switching from ambient `DIVEDRA_GRAPHQL_ENDPOINT` for legacy commands
- GraphQL transport for `workflow create|validate|inspect`
- GraphQL transport for `session status|progress`
- remote support for local-only `--mock-scenario`

## Modules

### 1. CLI GraphQL Execution Helpers

#### `src/cli.ts`

**Status**: COMPLETED

```typescript
interface GraphqlCliTransportOptions {
  readonly endpoint: string;
  readonly authToken?: string;
  readonly managerSessionId?: string;
  readonly fetchImpl?: typeof fetch;
}

function resolveGraphqlCliTransport(
  parsedOptions: ParsedOptions,
  env: Readonly<Record<string, string | undefined>>,
  deps: CliDependencies,
): GraphqlCliTransportOptions | null;

function readGraphqlExecutionPayload(
  response: GraphqlClientResponse,
): Readonly<Record<string, unknown>>;
```

**Checklist**:

- [x] Legacy execution commands can resolve a shared GraphQL transport config
- [x] GraphQL responses are decoded with explicit object/field validation
- [x] Remote execution errors surface clearly through CLI stderr/exit codes

### 2. Legacy Execution Command Migration Slice

#### `src/cli.ts`, `src/cli.test.ts`

**Status**: COMPLETED

```typescript
async function runRemoteWorkflowCommand(input: {
  readonly workflowName: string;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly dryRun: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
}): Promise<{
  readonly sessionId: string;
  readonly status: string;
  readonly exitCode: number;
}>;
```

**Checklist**:

- [x] `workflow run --endpoint` uses `executeWorkflow`
- [x] `session resume --endpoint` uses `resumeWorkflowExecution`
- [x] `session rerun --endpoint` uses `rerunWorkflowExecution`
- [x] `workflow run --endpoint` preserves the existing summary output shape
- [x] `--mock-scenario` is rejected clearly for remote GraphQL execution mode

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| CLI GraphQL execution helpers | `src/cli.ts` | COMPLETED | Passing |
| CLI remote execution tests | `src/cli.test.ts` | COMPLETED | Passing |
| Command/design alignment | `design-docs/specs/command.md`, `design-docs/specs/design-graphql-manager-control-plane.md` | COMPLETED | Passing |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Opt-in legacy CLI GraphQL execution | `graphql-manager-control-plane-surface` | READY |
| Wider CLI migration follow-up | This plan | READY |

## Tasks

### TASK-001: Shared CLI GraphQL Transport Resolution

**Status**: Completed
**Parallelizable**: No

**Deliverables**:

- `src/cli.ts`

**Completion Criteria**:

- [x] `--endpoint` opt-in is recognized for legacy execution commands
- [x] auth/session transport metadata reuse the existing GraphQL client path
- [x] response decoding rejects malformed GraphQL payloads defensively

### TASK-002: Remote Workflow Run / Resume / Rerun

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-001`

**Deliverables**:

- `src/cli.ts`
- `src/cli.test.ts`

**Completion Criteria**:

- [x] `workflow run --endpoint` uses GraphQL execution transport
- [x] `session resume --endpoint` uses GraphQL execution transport
- [x] `session rerun --endpoint` uses GraphQL execution transport
- [x] command outputs remain compatible with existing CLI summaries

### TASK-003: Migration Documentation Alignment

**Status**: Completed
**Parallelizable**: Yes

**Dependencies**:

- `TASK-002`

**Deliverables**:

- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/command.md`

**Completion Criteria**:

- [x] docs describe the hybrid migration state instead of claiming full CLI migration already happened
- [x] docs note that remote GraphQL execution is opt-in for legacy commands in this slice
- [x] docs note that local-only debug flags are not forwarded through GraphQL

## Completion Criteria

- [x] Opt-in legacy CLI execution transport uses the GraphQL control plane
- [x] `workflow run`, `session resume`, and `session rerun` support remote execution through `--endpoint`
- [x] unsupported local-only options fail clearly in remote mode
- [x] focused CLI tests pass

## Progress Log

### Session: 2026-03-15
**Tasks Completed**: TASK-001, TASK-002, TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The review found that the GraphQL implementation already existed, but legacy execution commands still ignored `--endpoint`. This slice keeps the migration explicit and bounded: remote transport is opt-in for execution commands, while other legacy commands remain local until a later iteration.
