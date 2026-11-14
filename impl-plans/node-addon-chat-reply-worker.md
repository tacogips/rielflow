# Node Add-on Chat Reply Worker Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`
**Created**: 2026-04-20
**Last Updated**: 2026-04-20

## Design Summary

Implement the first runtime-provided node add-on: `divedra/chat-reply-worker`.
Workflow authors can declare `workflow.json.nodes[].addon` instead of a
workflow-local `nodeFile`, and the loader/validator resolves it into an
effective executable worker node.

Initial scope:

- Built-in add-ons only.
- No external package fetch or add-on lockfile.
- Chat reply worker emits provider-neutral reply output and supports dry-run or
  intent-only behavior when no provider dispatcher exists.
- Provider SDK dispatch remains future event-layer work.

## Modules

### 1. Workflow Types and Add-on Catalog

#### `src/workflow/types.ts`

**Status**: Completed

```typescript
interface WorkflowNodeAddonRef {
  readonly name: string;
  readonly version?: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

interface ResolvedNodeAddon {
  readonly name: "divedra/chat-reply-worker";
  readonly version: "1";
  readonly config: ChatReplyWorkerConfig;
}
```

**Checklist**:

- [x] Add authored add-on ref types
- [x] Add resolved add-on execution metadata
- [x] Add internal add-on node execution flavor

### 2. Loader and Validation

#### `src/workflow/validate.ts`, `src/workflow/load.ts`

**Status**: Completed

```typescript
function resolveBuiltinNodeAddonPayload(
  nodeId: string,
  addon: WorkflowNodeAddonRef,
): Result<NodePayload, readonly ValidationIssue[]>;
```

**Checklist**:

- [x] Accept exactly one of `nodeFile`, inline `node`, or `addon`
- [x] Reject manager add-on references
- [x] Validate chat reply add-on config
- [x] Materialize effective add-on payloads during validation

### 3. Native Chat Reply Execution

#### `src/workflow/native-node-executor.ts`

**Status**: Completed

```typescript
async function executeAddonNode(
  input: NativeNodeExecutionInput,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput>;
```

**Checklist**:

- [x] Render `textTemplate` with normal node template variables
- [x] Resolve provider-neutral reply target metadata
- [x] Emit `sent`, `intent-only`, or `dry-run` output payload
- [x] Fail on missing target when configured to fail

### 4. Runtime Routing and Tests

#### `src/workflow/*.test.ts`

**Status**: Completed

**Checklist**:

- [x] Route add-on payloads through native execution
- [x] Add validation coverage for add-on authoring errors
- [x] Add execution coverage for chat reply dry-run/intent-only behavior
- [x] Typecheck and targeted tests pass

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Types and catalog | `src/workflow/types.ts`, `src/workflow/node-addons.ts` | Completed | Targeted |
| Validation | `src/workflow/validate.ts`, `src/workflow/load.ts` | Completed | Targeted |
| Native execution | `src/workflow/native-node-executor.ts` | Completed | Targeted |
| Runtime routing | `src/workflow/engine.ts`, `src/workflow/call-node.ts` | Completed | Targeted |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Add-on validation | Design document | Completed |
| Chat reply executor | Add-on validation | Completed |
| Runtime routing | Chat reply executor | Completed |

## Completion Criteria

- [x] Add-on node references load and validate
- [x] Add-on node execution produces runtime-owned output
- [x] Existing nodeFile workflows remain valid
- [x] Targeted tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-04-20

**Tasks Completed**: TASK-001 through TASK-004
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Implemented the built-in add-on catalog, chat reply worker
validation, native execution, runtime routing, and save preservation. Targeted
tests and type checking pass. External provider dispatch remains future
event-layer work.
