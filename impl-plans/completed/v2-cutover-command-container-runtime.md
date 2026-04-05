# V2 Cutover And Command/Container Runtime Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#execution-boundary, design-docs/specs/design-container-runtime-contract.md, design-docs/specs/design-node-execution-inbox-contract.md
**Created**: 2026-04-04
**Last Updated**: 2026-04-05

## Summary

This plan converges the repository onto one canonical workflow/runtime model by:

- implementing real `command` and `container` node execution
- removing transition-era schema compatibility and legacy authoring aliases
- aligning tests, examples, and docs with the canonical ordered-node schema

Out of scope:

- redesigning workflow nesting semantics
- adding new parallel scheduling semantics
- changing GraphQL transport shape beyond what is required for runtime parity

## Modules

### 1. Runtime Executors

#### `src/workflow/native-node-executor.ts`

**Status**: COMPLETED

```typescript
interface NativeNodeExecutionInput {
  readonly workflowDirectory: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly node: NodePayload;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly mergedVariables: Readonly<Record<string, unknown>>;
  readonly arguments: Readonly<Record<string, unknown>> | null;
  readonly artifactDir: string;
  readonly executionMailbox: NodeExecutionMailbox;
  readonly timeoutMs: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
}

interface NativeNodeExecutionResult {
  readonly provider: string;
  readonly model: string;
  readonly promptText: string;
  readonly completionPassed: boolean;
  readonly when: Readonly<Record<string, boolean>>;
  readonly payload: Readonly<Record<string, unknown>>;
}
```

**Checklist**:
- [x] Implement command node execution
- [x] Implement container node execution
- [x] Capture stdout/stderr logs
- [x] Read worker output from mailbox outbox
- [x] Unit tests

### 2. Engine And Call-Node Integration

#### `src/workflow/engine.ts`
#### `src/workflow/call-node.ts`
#### `src/workflow/runtime-readiness.ts`

**Status**: COMPLETED

**Checklist**:
- [x] Use native executors for `command` and `container`
- [x] Remove unsupported runtime rejection paths
- [x] Update readiness checks for command/container executors
- [x] Preserve output-validation flow
- [x] Unit tests

### 3. Canonical Schema Cleanup

#### `src/workflow/backend.ts`
#### `src/workflow/validate.ts`
#### `src/workflow/adapters/dispatch.ts`

**Status**: COMPLETED

**Checklist**:
- [x] Remove legacy backend aliases
- [x] Remove legacy prompt/variable alias normalization
- [x] Remove legacy sub-workflow alias normalization
- [x] Remove transition-only validation messaging
- [x] Unit tests

### 4. Canonical Docs And Examples

#### `README.md`
#### `examples/README.md`
#### `design-docs/specs/*.md`
#### `examples/**`

**Status**: COMPLETED

**Checklist**:
- [x] Remove “not implemented yet” command/container wording
- [x] Remove transition/legacy wording that conflicts with the canonical model
- [x] Update examples to use mailbox/outbox-compatible command/container workers
- [x] Keep docs aligned with actual runtime behavior

## Completion Criteria

- [x] `command` nodes execute in the workflow engine and `call-node`
- [x] `container` nodes execute in the workflow engine and `call-node`
- [x] Transition-era legacy authoring aliases are removed from validation
- [x] README/examples/design docs describe one canonical runtime model
- [x] Targeted tests pass

## Progress Log

### Session: 2026-04-04

**Tasks Completed**: Plan created
**Tasks In Progress**: Runtime and schema cutover analysis
**Blockers**: None
**Notes**: The repository still mixes canonical ordered-node authoring with transition-era compatibility. This pass will converge runtime, validator, tests, and docs.

### Session: 2026-04-05

**Tasks Completed**: TASK-002, TASK-003, TASK-004
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Verified the runtime cutover landed in code: native command/container execution, engine and call-node integration, stricter canonical validation, and docs/example alignment are present. Validation was confirmed with `bun test src/workflow/validate.test.ts src/workflow/adapters/dispatch.test.ts src/workflow/runtime-readiness.test.ts src/workflow/call-node.test.ts src/workflow/engine.test.ts` and `bun run typecheck`.
