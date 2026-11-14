# Workflow VCS Handoff Checkpoints Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-vcs-handoff-checkpoints.md
**Created**: 2026-02-23
**Last Updated**: 2026-02-23

---

## Design Document Reference

**Source**: `design-docs/specs/design-vcs-handoff-checkpoints.md`

### Summary
Add deterministic handoff metadata and commit-template artifacts to each node execution so output-to-next-input linkage is explicit and auditable with Git/JJ checkpoints.

### Scope
**Included**:
- Runtime generation of `handoff.json` and `commit-message.txt`
- `input.json` extension with `upstreamOutputRefs`
- Tests validating new artifact contract
- Architecture/spec updates

**Excluded**:
- Auto-commit execution from runtime
- Sub-workflow specific ID wiring beyond placeholders

---

## Modules

### 1. Engine Handoff Metadata

#### `src/workflow/engine.ts`

**Status**: COMPLETED

```typescript
interface OutputRef {
  readonly sessionId: string;
  readonly workflowId: string;
  readonly outputNodeId: string;
  readonly nodeExecId: string;
  readonly artifactDir: string;
}

interface UpstreamOutputRef extends OutputRef {
  readonly fromNodeId: string;
  readonly transitionWhen: string;
  readonly status: NodeExecutionRecord["status"];
}
```

**Checklist**:
- [x] Add deterministic input/output hashing
- [x] Write `handoff.json` per node execution
- [x] Write `commit-message.txt` template per node execution
- [x] Include `upstreamOutputRefs` in `input.json`

### 2. Engine Tests

#### `src/workflow/engine.test.ts`

**Status**: COMPLETED

```typescript
type InputJson = {
  promptText: string;
  upstreamOutputRefs: readonly { fromNodeId: string; workflowId: string }[];
};
```

**Checklist**:
- [x] Assert upstream output references are present
- [x] Assert `handoff.json` exists and contains hashes
- [x] Assert `commit-message.txt` contains checkpoint metadata

### 3. Design and Architecture Documentation

#### `design-docs/specs/design-vcs-handoff-checkpoints.md`
#### `design-docs/specs/architecture.md`

**Status**: COMPLETED

**Checklist**:
- [x] Add dedicated design spec
- [x] Add architecture contract section

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Engine handoff artifacts | `src/workflow/engine.ts` | COMPLETED | Covered by `engine.test.ts` |
| Engine tests | `src/workflow/engine.test.ts` | COMPLETED | Passing |
| Design spec | `design-docs/specs/design-vcs-handoff-checkpoints.md` | COMPLETED | N/A |
| Architecture integration | `design-docs/specs/architecture.md` | COMPLETED | N/A |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| VCS handoff checkpoints | workflow execution/session runtime | Available |

## Completion Criteria

- [x] Runtime writes explicit handoff metadata
- [x] Runtime emits commit template artifact
- [x] Upstream references are persisted into downstream input payloads
- [x] Tests pass
- [x] Design documentation updated

## Progress Log

### Session: 2026-02-23 00:00
**Tasks Completed**: TASK-001 Engine handoff artifacts, TASK-002 Engine tests, TASK-003 Design updates
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Implemented hash-based handoff metadata and per-node commit template file for Git/JJ checkpointing.

## Related Plans

- **Previous**: `impl-plans/completed/workflow-execution-and-session.md`
- **Next**: None
- **Depends On**: `workflow-execution-and-session`
