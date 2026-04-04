# V2 Cutover And Command/Container Runtime Implementation Plan

**Status**: In Progress
**Design Reference**: design-docs/specs/architecture.md#execution-boundary, design-docs/specs/design-container-runtime-contract.md, design-docs/specs/design-node-execution-inbox-contract.md
**Created**: 2026-04-04
**Last Updated**: 2026-04-04

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

**Status**: NOT_STARTED

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
- [ ] Implement command node execution
- [ ] Implement container node execution
- [ ] Capture stdout/stderr logs
- [ ] Read worker output from mailbox outbox
- [ ] Unit tests

### 2. Engine And Call-Node Integration

#### `src/workflow/engine.ts`
#### `src/workflow/call-node.ts`
#### `src/workflow/runtime-readiness.ts`

**Status**: NOT_STARTED

**Checklist**:
- [ ] Use native executors for `command` and `container`
- [ ] Remove unsupported runtime rejection paths
- [ ] Update readiness checks for command/container executors
- [ ] Preserve output-validation flow
- [ ] Unit tests

### 3. Canonical Schema Cleanup

#### `src/workflow/backend.ts`
#### `src/workflow/validate.ts`
#### `src/workflow/adapters/dispatch.ts`

**Status**: NOT_STARTED

**Checklist**:
- [ ] Remove legacy backend aliases
- [ ] Remove legacy prompt/variable alias normalization
- [ ] Remove legacy sub-workflow alias normalization
- [ ] Remove transition-only validation messaging
- [ ] Unit tests

### 4. Canonical Docs And Examples

#### `README.md`
#### `examples/README.md`
#### `design-docs/specs/*.md`
#### `examples/**`

**Status**: NOT_STARTED

**Checklist**:
- [ ] Remove “not implemented yet” command/container wording
- [ ] Remove transition/legacy wording that conflicts with the canonical model
- [ ] Update examples to use mailbox/outbox-compatible command/container workers
- [ ] Keep docs aligned with actual runtime behavior

## Completion Criteria

- [ ] `command` nodes execute in the workflow engine and `call-node`
- [ ] `container` nodes execute in the workflow engine and `call-node`
- [ ] Transition-era legacy authoring aliases are removed from validation
- [ ] README/examples/design docs describe one canonical runtime model
- [ ] Targeted tests pass

## Progress Log

### Session: 2026-04-04

**Tasks Completed**: Plan created
**Tasks In Progress**: Runtime and schema cutover analysis
**Blockers**: None
**Notes**: The repository still mixes canonical ordered-node authoring with transition-era compatibility. This pass will converge runtime, validator, tests, and docs.
