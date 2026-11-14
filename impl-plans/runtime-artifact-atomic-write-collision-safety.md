# Runtime Artifact Atomic Write Collision Safety Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#httpgraphql-runtime-model-serve-mode, design-docs/specs/design-graphql-manager-control-plane.md#security-and-safety
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

## Related Plans

- **Previous**: `impl-plans/graphql-manager-artifact-atomic-writes.md`
- **Current Plan**: `impl-plans/runtime-artifact-atomic-write-collision-safety.md`

## Design Document Reference

**Source**:

- `design-docs/specs/architecture.md`
- `design-docs/specs/design-graphql-manager-control-plane.md`

### Summary

This corrective slice closes a remaining atomic-write safety gap:

- the shared atomic-write helper must not reuse a predictable `*.tmp` sibling path,
- runtime writers should reuse the shared helper instead of carrying duplicate temp-path logic,
- regression coverage must prove stale legacy `*.tmp` paths do not block a new write.

### Scope

**Included**:

- collision-safe unique temp-path generation in the shared helper
- adoption of the shared helper in runtime artifact writers
- regression tests for stale `*.tmp` collisions and cleanup behavior
- plan bookkeeping

**Excluded**:

- schema or API contract changes
- workflow conflict-resolution policy changes
- browser UI migration

## Modules

### 1. Collision-safe Atomic Write Helper

#### `src/shared/fs.ts`

**Status**: COMPLETED

```typescript
export async function atomicWriteTextFile(
  filePath: string,
  content: string,
): Promise<void>;

export async function atomicWriteJsonFile(
  filePath: string,
  payload: unknown,
): Promise<void>;
```

**Checklist**:

- [x] temp paths are unique per write attempt
- [x] temp files stay in the destination directory for atomic rename semantics
- [x] failed writes still clean up temp files best-effort

### 2. Runtime Writer Adoption

#### `src/workflow/engine.ts`, `src/workflow/save.ts`

**Status**: COMPLETED

**Checklist**:

- [x] engine artifact writers reuse the shared helper
- [x] workflow save reuses the shared helper
- [x] duplicate fixed `*.tmp` logic is removed from those modules

### 3. Regression Coverage

#### `src/shared/fs.test.ts`

**Status**: COMPLETED

**Checklist**:

- [x] stale legacy `*.tmp` siblings do not block writes
- [x] failed rename attempts leave no unique temp-file residue
- [x] targeted verification passes

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Collision-safe atomic writes | `src/shared/fs.ts` | COMPLETED | Passing |
| Runtime writer adoption | `src/workflow/engine.ts`, `src/workflow/save.ts` | COMPLETED | Passing |
| Regression coverage | `src/shared/fs.test.ts` | COMPLETED | Passing |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Shared helper hardening | `graphql-manager-artifact-atomic-writes` | READY |
| Runtime writer adoption | Shared helper hardening | READY |
| Regression coverage | Shared helper hardening | READY |

## Tasks

### TASK-001: Harden the Shared Atomic Write Helper

**Status**: Completed
**Parallelizable**: Yes

**Deliverables**:

- `src/shared/fs.ts`
- `src/shared/fs.test.ts`

**Completion Criteria**:

- [x] temp files use unique names per write attempt
- [x] stale legacy `*.tmp` paths no longer block writes
- [x] helper cleanup coverage remains in place

### TASK-002: Reuse the Helper in Core Runtime Writers

**Status**: Completed
**Parallelizable**: No

**Dependencies**:

- `TASK-001`

**Deliverables**:

- `src/workflow/engine.ts`
- `src/workflow/save.ts`

**Completion Criteria**:

- [x] engine artifact writers use the shared helper
- [x] workflow save uses the shared helper
- [x] duplicate fixed-temp-path logic is removed

## Completion Criteria

- [x] Atomic writes use collision-safe temp paths
- [x] Core runtime artifact writers share the same helper
- [x] Targeted tests and typecheck pass

## Progress Log

### Session: 2026-03-15 13:05 JST
**Tasks Completed**: TASK-001, TASK-002
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The earlier atomic-write follow-up made GraphQL manager artifacts atomic, but it still reused predictable `*.tmp` staging paths and left duplicate temp-write logic in core runtime modules. This slice hardens the helper and aligns the runtime writers behind it.
