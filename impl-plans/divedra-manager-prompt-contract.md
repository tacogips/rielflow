# Divedra Manager Prompt Contract Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#prompt-and-input-assembly, design-docs/specs/notes.md, design-docs/specs/design-workflow-json.md
**Created**: 2026-03-07
**Last Updated**: 2026-03-07

## Design Document Reference

**Source**: prompt-contract guidance is now consolidated into `design-docs/specs/architecture.md` and `design-docs/specs/notes.md`

### Summary

Add the missing prompt contract that makes `divedra` manager execution aware of workflow structure, child-node purpose, expected return values, and mailbox-oriented nesting rules.

### Scope

**Included**:
- workflow-level prompt configuration for manager and worker execution
- repository default markdown asset for the `divedra system prompt`
- runtime prompt composition with workflow/sub-workflow context
- validation/tests/template updates

**Excluded**:
- fully manager-output-driven dispatch control
- replacement of structural workflow edges/loops with action-only execution

## Modules

### 1. Workflow Prompt Configuration

#### src/workflow/types.ts

**Status**: COMPLETED

```typescript
export interface WorkflowPrompts {
  readonly divedraPromptTemplate?: string;
  readonly workerSystemPromptTemplate?: string;
}
```

**Checklist**:
- [x] Add workflow-level prompt configuration types
- [x] Attach prompts to `WorkflowJson`

#### src/workflow/validate.ts

**Status**: COMPLETED

```typescript
function normalizeWorkflow(workflow: unknown, issues: ValidationIssue[]): WorkflowJson | null;
```

**Checklist**:
- [x] Validate `workflow.prompts`
- [x] Preserve normalized prompts in validated workflow bundles

### 2. Prompt Composition Runtime

#### src/workflow/prompt-composition.ts

**Status**: COMPLETED

```typescript
export interface PromptCompositionInput {
  readonly workflow: WorkflowJson;
  readonly nodeRef: WorkflowNodeRef;
  readonly node: NodePayload;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly basePromptText: string;
  readonly upstreamInputs: readonly PromptCompositionUpstreamInput[];
}

export function composeExecutionPrompt(input: PromptCompositionInput): string;
```

**Checklist**:
- [x] Add default `divedra system prompt` markdown asset
- [x] Compose manager prompt from default markdown + workflow prompt + runtime context + node prompt
- [x] Compose worker prompt from workflow system prompt + runtime context + node prompt
- [x] Include workflow purpose, reason, expected return, and mailbox/upstream summary

#### src/workflow/engine.ts

**Status**: COMPLETED

```typescript
// execution path now replaces raw assembled prompt text with composed prompt text
```

**Checklist**:
- [x] Integrate prompt composition into runtime execution
- [x] Preserve output-contract retry behavior on top of composed prompt text

### 3. Initial Manager Control Semantics

#### src/workflow/manager-control.ts

**Status**: COMPLETED

```typescript
export function parseManagerControlPayload(
  payload: Readonly<Record<string, unknown>>,
  workflow: WorkflowJson,
): ParsedManagerControl | null;
```

**Checklist**:
- [x] Define explicit manager control payload for node/sub-workflow dispatch
- [x] Define manager-driven retry/re-execution semantics
- [x] Bind mailbox nested handoff contract to sub `divedra` instruction envelopes
- [x] Keep deterministic workflow edges/loop semantics as fallback structure

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Prompt config types | `src/workflow/types.ts` | COMPLETED | Covered |
| Prompt config validation | `src/workflow/validate.ts` | COMPLETED | Covered |
| Prompt composition | `src/workflow/prompt-composition.ts` | COMPLETED | Covered |
| Engine integration | `src/workflow/engine.ts` | COMPLETED | Covered |
| Manager control payload | `src/workflow/manager-control.ts` | COMPLETED | Covered |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Prompt composition runtime | Prompt config types/validation | DONE |
| Manager control payload | Prompt composition runtime | DONE |

## Completion Criteria

- [x] Workflow schema accepts manager/worker prompt policy
- [x] Default `divedra system prompt` exists as a markdown asset in the repository
- [x] Runtime composes manager and worker prompts with workflow purpose/reason context
- [x] Tests cover validation, template generation, and runtime prompt composition
- [x] Runtime dispatch/retry semantics are directly controlled by manager output for manager-owned routing categories

## Progress Log

### Session: 2026-03-07 18:40
**Tasks Completed**: Workflow prompt configuration, prompt composition runtime, tests/docs/template updates
**Tasks In Progress**: Manager control payload design for later iteration
**Blockers**: None
**Notes**: The existing runtime already had structural mailbox/sub-workflow semantics but lacked the prompt contract requested for `divedra` orchestration. This iteration closes that prompt/model gap and records the remaining runtime-control gap explicitly.

### Session: 2026-03-07 19:15
**Tasks Completed**: Initial manager control payload runtime, prompt contract update, manager control tests
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Manager outputs can now explicitly start sub-workflows, forward sub-manager child inputs, and re-queue nodes for retry via `payload.managerControl.actions`. Structural edges, loop rules, and conversation scheduling still remain runtime-owned.

### Session: 2026-03-07 20:10
**Tasks Completed**: Tightened nested sub-workflow contract enforcement, template/sample workflow updates, validation/runtime scope-boundary fixes
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Closed review gaps from the previous iteration by requiring `subWorkflow.managerRuntimeId`, enforcing `sub-manager` ownership for `deliver-to-child-input`, and updating the default/sample workflows to route parent-to-sub-workflow work through a real sub-manager mailbox boundary.

### Session: 2026-03-07 20:45
**Tasks Completed**: Review follow-up for prompt context completeness
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Fixed a gap where prompt composition did not expose the actual assembled argument payload as explicit given data and did not recognize internal sub-workflow task ownership from `subWorkflow.nodeIds`. This keeps the prompt contract aligned with the intended workflow-aware mailbox model.

### Session: 2026-03-07 21:05
**Tasks Completed**: Review follow-up for manager child-contract visibility
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Closed the remaining prompt completeness gap by adding a manager-scoped child catalog. Root `divedra` now sees sub-workflow handoff/return contracts as child units, and sub `divedra` now sees the concrete prompt seeds and expected returns for its owned child nodes.

### Session: 2026-03-07 21:35
**Tasks Completed**: Review follow-up for ownership enforcement and manager scope boundaries
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Tightened the implementation to match the existing design requirement that every sub-workflow declares `nodeIds`. Validation now enforces that requirement, prompt composition no longer risks exposing sub-workflow boundary nodes as root-manager direct children, and `sub-manager` retry actions are limited to nodes inside the owned sub-workflow scope.

### Session: 2026-03-07 22:05
**Tasks Completed**: Review follow-up for manager given-data visibility
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Closed a remaining prompt-contract gap where root `divedra` could miss top-level `humanInput` unless a workflow author added custom manager argument bindings. Prompt composition now always surfaces runtime input context as explicit given data for manager review/planning.

### Session: 2026-03-07 22:30
**Tasks Completed**: Review follow-up for explicit sub-workflow rerun contract
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Clarified that repeating `start-sub-workflow` is the explicit root-manager path for re-invoking a sub-workflow as one child unit, updated the runtime-visible manager control guidance, and added a regression test that proves repeated explicit starts requeue the same sub-workflow through mailbox delivery.

### Session: 2026-03-07 22:55
**Tasks Completed**: Review follow-up for parent/sub-workflow retry boundary enforcement
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Closed a boundary leak where root `divedra` could still target internal sub-workflow nodes through `retry-node`. Runtime parsing now rejects that control path and requires repeated `start-sub-workflow` for parent-level sub-workflow reruns, which keeps the nested mailbox contract consistent.

### Session: 2026-03-07 23:20
**Tasks Completed**: Review follow-up for root mailbox boundary consistency
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Closed the remaining external boundary gap by delivering `humanInput` to the root manager through an external mailbox communication and by publishing the final workflow result through an external mailbox artifact. The default workflow template now declares `human-input` as the sub-workflow input source so the scaffold matches the intended nested mailbox model.

### Session: 2026-03-07 23:50
**Tasks Completed**: Review follow-up for root workflow output tracking/publication
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Closed a runtime gap where `inputSources.type = "workflow-output"` could never become ready because `runtimeVariables.workflowOutput` was never populated. The engine now records the latest successful root-scope output payload and uses that same root output result for external mailbox publication when a manager executes again after the output node.

### Session: 2026-03-08 00:00
**Tasks Completed**: Review follow-up for manager-control scope enforcement
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Tightened the manager-control contract so invalid `start-sub-workflow` actions fail during payload parsing instead of surviving until a later runtime guard. This keeps the root-only `divedra` authority boundary explicit and testable at the parser level.

### Session: 2026-03-08 00:20
**Tasks Completed**: Review follow-up for sub-manager-only child-input forwarding enforcement
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Closed a remaining contract mismatch where `deliver-to-child-input` was documented as a `sub divedra`-only action but could still pass parser validation for the root manager and fail later at runtime. The parser now rejects that action outside `sub-manager` scope and the unit tests cover the boundary directly.

### Session: 2026-03-08 00:40
**Tasks Completed**: Review follow-up for strict sub-workflow manager typing
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Closed a design/runtime mismatch where validation still accepted generic `manager` nodes as `subWorkflow.managerRuntimeId` even though the design requires dedicated `sub-manager` ownership. Removed stale optional-manager fallbacks from conversation/runtime routing and added a regression test for the stricter sub-manager contract.

### Session: 2026-03-07 16:05
**Tasks Completed**: Review follow-up for workflow-level prompt metadata binding
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Closed a prompt-contract gap where workflow-level prompt templates depended on node-local variables for `workflowId` and similar fields, which caused worker prompts in the default scaffold to render incomplete context. Prompt composition now injects workflow/node metadata directly for all nodes, and regression coverage verifies worker-system prompt rendering.
