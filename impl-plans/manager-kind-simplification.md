# Manager Kind Simplification Implementation Plan

**Status**: Planning
**Design Reference**: design-docs/specs/design-manager-kind-simplification.md, design-docs/specs/design-workflow-json.md#workflownoderef
**Created**: 2026-03-18
**Last Updated**: 2026-03-18

## Design Document Reference

**Source**: `design-docs/specs/design-manager-kind-simplification.md`

### Summary

Refactor the authored workflow schema so manager structure is expressed with `root-manager` and `subworkflow-manager`, removing `sub-divedra-manager` and legacy manager-kind aliases from the authored format while preserving current runtime control-scope behavior.

### Scope

**Included**:

- shared `NodeKind` updates
- validator and loader changes for canonical manager kinds
- runtime/mailbox/editor branch updates keyed on the renamed sub-workflow manager kind
- workflow template, examples, E2E harness, and test-fixture updates
- repository verification for the schema rename

**Excluded**:

- renaming node ids such as `divedra-manager`
- package/environment variable renames
- behavioral changes to manager control semantics
- compatibility aliases for removed authored manager kinds

## Modules

### 1. Shared Schema and Validation

#### `src/workflow/types.ts`, `src/workflow/validate.ts`, `src/workflow/create.ts`

**Status**: NOT_STARTED

```typescript
export type NodeKind =
  | "task"
  | "branch-judge"
  | "loop-judge"
  | "root-manager"
  | "subworkflow-manager"
  | "input"
  | "output";

export interface WorkflowNodeRef {
  readonly id: string;
  readonly nodeFile: string;
  readonly kind?: NodeKind;
  readonly completion?: CompletionRule;
}

function normalizeNodeKind(value: unknown): NodeKind | undefined;
```

**Checklist**:
- [ ] Replace `sub-divedra-manager` with `subworkflow-manager` in shared types
- [ ] Remove authored compatibility aliases for `manager` and `sub-manager`
- [ ] Require `workflow.managerNodeId` to target `root-manager`
- [ ] Require `subWorkflows[].managerNodeId` to target `subworkflow-manager`
- [ ] Update workflow template generation to emit canonical manager kinds
- [ ] Update validator/load tests for acceptance and rejection cases

### 2. Runtime Scope and Mailbox Alignment

#### `src/workflow/engine.ts`, `src/workflow/manager-control.ts`, `src/workflow/node-execution-mailbox.ts`, `src/workflow/prompt-composition.ts`, `src/workflow/call-node.ts`

**Status**: NOT_STARTED

```typescript
interface ManagerControlParseContext {
  readonly managerNodeId: string;
  readonly managerKind: NodeKind | undefined;
}

function isManagerNodeKind(kind: NodeKind | undefined): boolean;

export function parseManagerControlActions(
  actionsRaw: readonly unknown[],
  workflow: WorkflowJson,
  context: ManagerControlParseContext,
): ParsedManagerControl;
```

**Checklist**:
- [ ] Rename sub-workflow manager branches to `subworkflow-manager`
- [ ] Keep root manager planning behavior unchanged
- [ ] Keep sub-workflow child-input forwarding behavior unchanged
- [ ] Update mailbox/prompt text that currently names `sub-divedra-manager`
- [ ] Update runtime tests covering manager control and manager planning

### 3. Editor, Examples, and Fixtures

#### `ui/src/lib/editor-workflow-operations.ts`, `ui/src/lib/editor-field-updates.ts`, `ui/src/lib/editor-mutations.ts`, `examples/**/*.json`, `e2e/**/*.cjs`

**Status**: NOT_STARTED

```typescript
export function syncSubWorkflowNodeKinds(
  bundle: EditableWorkflowBundle,
): void;

export const RESERVED_STRUCTURE_KINDS: ReadonlySet<NodeKind>;

export function updateNodeKindValue(
  bundle: EditableWorkflowBundle,
  nodeId: string,
  nextKind: NodeKind,
): UpdateNodeKindResult;
```

**Checklist**:
- [ ] Persist `subworkflow-manager` from editor structural assignment
- [ ] Update editor validation messages to the new kind name
- [ ] Update example bundles and created fixture bundles to canonical manager kinds
- [ ] Update E2E harness fixtures and assertions where kind labels are surfaced
- [ ] Update UI/editor tests that currently expect `sub-divedra-manager`

### 4. Verification and Cleanup

#### `src/**/*.test.ts`, `ui/src/**/*.test.ts`, `e2e/**/*.cjs`

**Status**: NOT_STARTED

```typescript
interface VerificationCommandSet {
  readonly typecheckServer: "bun run typecheck:server";
  readonly unitTests: "bun test";
  readonly typecheckUi: "bun run typecheck:ui";
  readonly buildUi: "bun run build:ui";
}
```

**Checklist**:
- [ ] Remove stale authored `sub-divedra-manager` fixtures outside explicit migration tests
- [ ] Run `bun run typecheck:server`
- [ ] Run targeted workflow/runtime/editor tests for manager kinds
- [ ] Run `bun run typecheck:ui`
- [ ] Run `bun run build:ui`
- [ ] Run relevant E2E/browser harness verification if UI workflow editing changed

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Shared schema and validation | `src/workflow/types.ts`, `src/workflow/validate.ts`, `src/workflow/create.ts` | NOT_STARTED | `bun test src/workflow/validate.test.ts src/workflow/load.test.ts` |
| Runtime scope and mailbox alignment | `src/workflow/engine.ts`, `src/workflow/manager-control.ts`, `src/workflow/node-execution-mailbox.ts`, `src/workflow/prompt-composition.ts`, `src/workflow/call-node.ts` | NOT_STARTED | `bun test src/workflow/engine.test.ts src/workflow/manager-control.test.ts src/workflow/prompt-composition.test.ts` |
| Editor, examples, and fixtures | `ui/src/lib/editor-*.ts`, `examples/**/*.json`, `e2e/**/*.cjs` | NOT_STARTED | `bun test ui/src/lib/*.test.ts`, targeted E2E/harness verification |
| Verification and cleanup | `src/**/*.test.ts`, `ui/src/**/*.test.ts`, `e2e/**/*.cjs` | NOT_STARTED | `bun run typecheck:server`, `bun run typecheck:ui`, `bun run build:ui` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Shared schema and validation | Existing workflow-core-and-validation baseline | READY |
| Runtime scope and mailbox alignment | Shared schema and validation | BLOCKED |
| Editor, examples, and fixtures | Shared schema and validation | BLOCKED |
| Verification and cleanup | Runtime scope and mailbox alignment, editor/examples updates | BLOCKED |

## Completion Criteria

- [ ] Authored schema uses `root-manager` and `subworkflow-manager` only
- [ ] `sub-divedra-manager` is removed from runtime/editor/example authored paths
- [ ] Root-manager and sub-workflow-manager behavior remains unchanged in tests
- [ ] Editor-created bundles persist the new canonical manager kinds
- [ ] Type checking passes
- [ ] Targeted workflow/runtime/editor tests pass
- [ ] UI build passes

## Progress Log

### Session: 2026-03-18 18:55
**Tasks Completed**: Design assessment, implementation plan creation
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The current runtime genuinely distinguishes root-manager and sub-workflow manager scopes, so the refactor should rename the nested kind to a neutral structural term rather than collapsing both roles into a single authored kind. This plan keeps the semantic split and removes branded/legacy authored aliases.

## Related Plans

- **Previous**: `impl-plans/branch-and-loop-block-subworkflows.md`
- **Next**: None
- **Depends On**: `impl-plans/branch-and-loop-block-subworkflows.md`, `impl-plans/workflow-web-editor-execution.md`
