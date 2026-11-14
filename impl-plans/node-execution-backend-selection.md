# Node Execution Backend Selection Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md
**Created**: 2026-03-07
**Last Updated**: 2026-03-07

## Summary

Add a backward-compatible node execution backend abstraction so workflow nodes can choose how they execute:

- `tacogips/codex-agent`
- `tacogips/claude-code-agent`
- `official/openai-sdk`
- `official/anthropic-sdk`

Existing workflows must remain valid without requiring migration.

## Scope

Included:

- Node payload schema support for per-node backend selection
- Validation and defaults for backward compatibility
- Adapter dispatch layer
- Official OpenAI and Anthropic SDK-backed adapters
- Workflow editor support for choosing backend per node

Not included:

- Deep provider-specific tool calling semantics
- Streaming UI changes
- Migration of existing workflow files

## Modules

### 1. Workflow Types

#### `src/workflow/types.ts`

```ts
export type CliAgentBackend = "tacogips/codex-agent" | "tacogips/claude-code-agent";

export type NodeExecutionBackend =
  | CliAgentBackend
  | "official/openai-sdk"
  | "official/anthropic-sdk";

export interface NodePayload {
  readonly id: string;
  readonly model: string;
  readonly executionBackend?: NodeExecutionBackend;
  readonly promptTemplate: string;
  readonly variables: Readonly<Record<string, unknown>>;
}
```

**Checklist**:
- [x] Add backend selection types
- [x] Preserve backward compatibility for existing tacogips-backed workflows

### 2. Validation

#### `src/workflow/validate.ts`

```ts
function isNodeExecutionBackend(value: unknown): value is NodeExecutionBackend;
function isCliAgentBackend(value: unknown): value is CliAgentBackend;
```

**Checklist**:
- [x] Accept any non-empty `model` string
- [x] Validate optional `executionBackend`
- [x] Require `executionBackend` when `model` is not a tacogips CLI-wrapper backend

### 3. Adapter Dispatch

#### `src/workflow/adapters/dispatch.ts`

```ts
export class DispatchingNodeAdapter implements NodeAdapter {
  constructor(config?: DispatchingNodeAdapterConfig);
  execute(input: AdapterExecutionInput, context: AdapterExecutionContext): Promise<AdapterExecutionOutput>;
}
```

**Checklist**:
- [x] Resolve backend from `executionBackend` or model-derived tacogips CLI wrapper
- [x] Delegate to the correct adapter
- [x] Return stable provider/model metadata

### 4. Official SDK Adapters

#### `src/workflow/adapters/openai-sdk.ts`

```ts
export class OpenAiSdkAdapter implements NodeAdapter {}
```

#### `src/workflow/adapters/anthropic-sdk.ts`

```ts
export class AnthropicSdkAdapter implements NodeAdapter {}
```

**Checklist**:
- [x] Use official SDK packages
- [x] Support API key environment configuration
- [x] Normalize outputs into `AdapterExecutionOutput`
- [x] Map provider failures into existing adapter error taxonomy

### 5. Workflow Editor

#### `src/server/api.ts`

**Checklist**:
- [x] Add node backend selector
- [x] Keep model editable as free text
- [x] Preserve existing tacogips defaults

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Workflow types | `src/workflow/types.ts` | COMPLETED | - |
| Validation | `src/workflow/validate.ts` | COMPLETED | `src/workflow/validate.test.ts` |
| Adapter dispatch | `src/workflow/adapters/dispatch.ts` | COMPLETED | `src/workflow/adapters/dispatch.test.ts` |
| Official SDK adapters | `src/workflow/adapters/openai-sdk.ts`, `src/workflow/adapters/anthropic-sdk.ts` | COMPLETED | adapter tests |
| Workflow editor | `src/server/api.ts` | COMPLETED | existing API tests |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Validation updates | Workflow types | READY |
| Adapter dispatch | Workflow types | READY |
| Official SDK adapters | Adapter dispatch | READY |
| Editor support | Workflow types | READY |

## Completion Criteria

- [x] Node payloads can choose execution backend per node
- [x] Existing tacogips-backed workflows still validate and run
- [x] Official OpenAI and Anthropic SDK backends are selectable
- [x] Workflow editor exposes backend selection
- [x] Type checking passes
- [x] Targeted tests pass

## Progress Log

### Session: 2026-03-07 00:00
**Tasks Completed**: Plan creation
**Tasks In Progress**: Workflow types, validation, adapter dispatch
**Blockers**: Concurrent local edits in workflow files require localized patches only
**Notes**: Preserve current `tacogips/*` symbolic models while adding explicit backend selection for official SDK paths.

### Session: 2026-03-07 01:00
**Tasks Completed**: Workflow types, validation, adapter dispatch, official SDK adapters, editor support, CLI/library consistency, verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Renamed the tacogips backend classification to CLI-wrapper terminology, added `executionBackend`, wired official SDK adapters, and verified with full `bun run typecheck` and `bun test`.
