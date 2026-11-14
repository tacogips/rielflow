# Agent Worker Add-ons Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md#add-on-descriptor`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

## Design Document Reference

This plan extends the existing built-in node add-on catalog so reusable agent
worker nodes can be authored as add-on references. The first agent-backed add-ons
are `rielflow/codex-worker` and `rielflow/claude-code-worker`.

Scope:

- Add authored `addon.inputs` for invocation-specific variable values.
- Resolve `rielflow/codex-worker` into an `agent` node using `codex-agent`.
- Resolve `rielflow/claude-code-worker` into an `agent` node using
  `claude-code-agent`.
- Preserve authored add-on references during save/edit round trips.

Out of scope:

- External add-on package resolution.
- Per-add-on environment mapping for agent worker add-ons.
- Third-party add-on execution.
- Replacing `executionBackend` as the low-level agent adapter field.

## Modules

### 1. Add-on Type Surface

#### `src/workflow/types.ts`

**Status**: Completed

```typescript
interface WorkflowNodeAddonRef {
  readonly name: string;
  readonly version?: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
}
```

**Checklist**:

- [x] Add `inputs` to authored add-on refs.
- [x] Add resolved agent add-on metadata types.
- [x] Keep existing chat reply add-on compatibility.

### 2. Built-in Add-on Resolver

#### `src/workflow/node-addons.ts`

**Status**: Completed

```typescript
type BuiltinAgentWorkerAddonName =
  | "rielflow/codex-worker"
  | "rielflow/claude-code-worker";
```

**Checklist**:

- [x] Validate `config` and `inputs` as objects when provided.
- [x] Reject `addon.env` for agent worker add-ons because version `1` does not
      consume environment bindings.
- [x] Validate agent worker config fields.
- [x] Resolve agent worker add-ons to `NodePayload` with `executionBackend`.
- [x] Preserve resolved add-on provenance metadata.

### 3. Validation, Save, and Tests

#### `src/workflow/validate.ts`

#### `src/workflow/validate.test.ts`

#### `src/workflow/save.test.ts`

**Status**: Completed

```typescript
function normalizeWorkflowNodeAddonRef(...): WorkflowNodeAddonRef | undefined;
```

**Checklist**:

- [x] Normalize authored `addon.inputs`.
- [x] Add validation coverage for both agent worker add-ons.
- [x] Add rejection coverage for invalid input/config shapes.
- [x] Verify save preserves authored add-on refs.

### 4. Design Notes

#### `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`

**Status**: Completed

**Checklist**:

- [x] Document `addon.inputs`.
- [x] Document `rielflow/codex-worker`.
- [x] Document `rielflow/claude-code-worker`.

## Module Status

| Module                | File Path                                                              | Status    | Tests              |
| --------------------- | ---------------------------------------------------------------------- | --------- | ------------------ |
| Add-on type surface   | `src/workflow/types.ts`                                                | Completed | Typecheck          |
| Built-in resolver     | `src/workflow/node-addons.ts`                                          | Completed | `validate.test.ts` |
| Validation/save tests | `src/workflow/validate.test.ts`, `src/workflow/save.test.ts`           | Completed | Vitest             |
| Design notes          | `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md` | Completed | Review             |

## Dependencies

| Feature               | Depends On              | Status |
| --------------------- | ----------------------- | ------ |
| Agent worker resolver | Existing add-on catalog | DONE   |
| Tests                 | Resolver implementation | DONE   |
| Documentation         | Final authored shape    | DONE   |

## Completion Criteria

- [x] `rielflow/codex-worker` validates and resolves to a `codex-agent` agent node.
- [x] `rielflow/claude-code-worker` validates and resolves to a
      `claude-code-agent` agent node.
- [x] `addon.inputs` is accepted, validated, preserved, and mapped into resolved
      node variables.
- [x] Existing chat reply add-on behavior remains compatible.
- [x] Targeted tests pass.
- [x] Type checking passes.

## Progress Log

### Session: 2026-04-20 20:05

**Tasks Completed**: None
**Tasks In Progress**: Type surface and resolver implementation
**Blockers**: None
**Notes**: User confirmed add-on names `codex-worker` and
`claude-code-worker`.

### Session: 2026-04-20 20:30

**Tasks Completed**: Type surface, resolver implementation, validation/save
tests, design notes, verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added `addon.inputs`, `rielflow/codex-worker`, and
`rielflow/claude-code-worker`. Verified with targeted Vitest coverage, Prettier
check, and TypeScript typecheck.

### Session: 2026-04-20 21:05

**Tasks Completed**: Review follow-up for descriptor-gated environment support
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Confirmed agent worker add-ons do not consume `addon.env` in version
`1`; validation now rejects those mappings instead of preserving a no-op.
