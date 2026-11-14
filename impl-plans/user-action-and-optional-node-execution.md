# User Action And Optional Node Execution Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-user-action-and-optional-node-execution.md
**Created**: 2026-03-18
**Last Updated**: 2026-03-18

## Summary

Implement the first runtime slice for `nodeType: "user-action"` and `workflow.nodes[].execution.mode = "optional"` so authored workflow bundles can declare the new model, validation enforces the first-iteration contract, and the runtime gains the typed state needed for later execution wiring.

## Scope

Included:

- workflow/node authored type additions for user-action and optional execution
- workflow validation for first-iteration authoring rules
- manager-control typed action support for optional-node decisions
- runtime/session record extensions for optional decisions, active user actions, and `skipped` execution status
- engine behavior to stop treating optional execution as an ad hoc skipped payload and instead use explicit typed state where feasible in this phase
- targeted tests for validation, manager-control parsing, and runtime state transitions

Not included:

- provider-specific Matrix/Discord/email integrations
- GraphQL schema and transport exposure for user-action reply collection
- browser/editor authoring UI
- webhook servers or long-lived reply listeners

## Modules

### TASK-001: Authoring Model And Validation
**Status**: COMPLETED
**Parallelizable**: No

#### `src/workflow/types.ts`

```ts
export interface WorkflowNodeExecutionPolicy {
  readonly mode?: "required" | "optional";
  readonly decisionBy?: "owning-manager";
}

export interface WorkflowNodeRef {
  readonly id: string;
  readonly nodeFile: string;
  readonly kind?: NodeKind;
  readonly completion?: CompletionRule;
  readonly execution?: WorkflowNodeExecutionPolicy;
}

export type NodeType = "agent" | "command" | "container" | "user-action";

export interface UserActionNodeConfig {
  readonly messageToolIds: readonly string[];
  readonly notificationToolIds?: readonly string[];
  readonly replyPolicy?: "first-valid-reply-wins";
  readonly allowStructuredReply?: boolean;
  readonly allowFreeTextReply?: boolean;
}
```

#### `src/workflow/validate.ts`

```ts
function normalizeWorkflowNodeExecutionPolicy(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowNodeExecutionPolicy | undefined;

function normalizeUserActionNodeConfig(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): UserActionNodeConfig | undefined;
```

**Checklist**:
- [x] Add optional execution-policy types to workflow nodes
- [x] Add `user-action` node payload type support
- [x] Reject invalid first-iteration optional-policy combinations
- [x] Reject invalid `user-action` payloads and incompatible agent/container fields
- [x] Add validation coverage in `src/workflow/validate.test.ts`

### TASK-002: Manager Control And Runtime State
**Status**: COMPLETED
**Parallelizable**: No
**Depends On**:
- `TASK-001`

#### `src/workflow/manager-control.ts`
#### `src/workflow/types.ts`
#### `src/workflow/session.ts`
#### `src/workflow/runtime-db.ts`

```ts
export type ManagerControlActionType =
  | "start-sub-workflow"
  | "deliver-to-child-input"
  | "retry-node"
  | "execute-optional-node"
  | "skip-optional-node";

export interface PendingOptionalNodeDecision {
  readonly nodeId: string;
  readonly owningManagerRuntimeId: string;
  readonly subWorkflowId?: string;
  readonly requestedAt: string;
  readonly status: "pending" | "execute" | "skip";
  readonly decidedAt?: string;
  readonly decidedByNodeExecId?: string;
}

export interface ActiveUserActionRef {
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly userActionId: string;
  readonly artifactDir: string;
  readonly status: "waiting-for-reply";
  readonly pausedAt: string;
}
```

**Checklist**:
- [x] Extend manager-control action parsing/validation for optional-node decisions
- [x] Persist typed pending-optional and active-user-action session state
- [x] Add runtime-db/session compatibility coverage if persisted schema changes are required
- [x] Add targeted tests for manager action scope and session serialization

### TASK-003: Engine Execution Wiring
**Status**: COMPLETED
**Parallelizable**: No
**Depends On**:
- `TASK-002`

#### `src/workflow/engine.ts`
#### `src/workflow/call-node.ts`
#### `src/workflow/engine.test.ts`
#### `src/workflow/call-node.test.ts`

**Checklist**:
- [x] Hold ready optional nodes behind manager-owned decisions instead of immediate queueing
- [x] Support `execute-optional-node` and `skip-optional-node`
- [x] Record `skipped` terminal status explicitly for optional-node skips
- [x] Introduce first-cut `user-action` runtime pause/record behavior with runtime-owned artifacts
- [x] Add focused engine tests for optional execute/skip and user-action pause lifecycle

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Authoring model and validation | `src/workflow/types.ts`, `src/workflow/validate.ts` | COMPLETED | `src/workflow/validate.test.ts` |
| Manager control and runtime state | `src/workflow/manager-control.ts`, `src/workflow/session.ts`, `src/workflow/runtime-db.ts` | COMPLETED | `src/workflow/manager-control.test.ts`, runtime/session tests |
| Engine wiring | `src/workflow/engine.ts`, `src/workflow/call-node.ts` | COMPLETED | `src/workflow/engine.test.ts`, `src/workflow/call-node.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| TASK-001 authoring/validation | Existing workflow schema and validation | COMPLETED |
| TASK-002 manager/runtime state | TASK-001 | COMPLETED |
| TASK-003 engine wiring | TASK-002 | COMPLETED |

## Completion Criteria

- [x] Workflow bundles may declare optional execution policy on node refs
- [x] Workflow bundles may declare `nodeType: "user-action"` with first-iteration validation rules
- [x] Managers may emit typed optional-node execute/skip actions
- [x] Runtime persists pending optional decisions and active user-action waits
- [x] Optional-node skips use explicit runtime state rather than generic skipped payload hacks
- [x] Type checking passes
- [x] Targeted tests pass

## Progress Log

### Session: 2026-03-18 12:02
**Tasks Completed**: Implementation plan creation
**Tasks In Progress**: TASK-001 planning
**Blockers**: Open product questions were tracked separately at planning time, but the design already recommends first-iteration defaults that are sufficient for authoring/validation work
**Notes**: Start with authored model and validation because no runtime primitive currently exists for either `user-action` or manager-scoped optional execution, and those schema guarantees are prerequisites for all deeper engine work.

### Session: 2026-03-18 12:02
**Tasks Completed**: TASK-001, TASK-002
**Tasks In Progress**: None
**Blockers**: TASK-003 still requires real engine/session wiring so execute/skip actions and `user-action` waits affect queue progression instead of remaining typed-but-unexecuted runtime data
**Notes**: Added workflow/node schema support for `execution.mode = "optional"` and `nodeType = "user-action"`, validated first-iteration authoring rules, extended manager-control parsing with typed optional-node actions plus scope checks, added persisted session placeholders for pending optional decisions and active user-action waits, and kept manager-message execution honest by explicitly rejecting optional-node actions until the engine wiring task lands.

### Session: 2026-03-18 12:34
**Tasks Completed**: TASK-003
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Wired optional-node scheduling into the engine so ready optional nodes pause behind owning-manager decisions, implemented execute/skip decision handling with explicit `skipped` node execution records, added first-cut `user-action` pause artifacts plus resume guard behavior, rejected direct `call-node` execution for scheduler-owned optional and `user-action` nodes, and verified the changes with `bun run typecheck`, focused workflow tests, and full `bun test`.

## Related Plans

- **Previous**: `impl-plans/node-execution-inbox-contract.md`
- **Next**: None
- **Depends On**: `impl-plans/node-output-contract-and-validation.md`, `impl-plans/divedra-manager-prompt-contract.md`, `impl-plans/manager-driven-call-node-runtime.md`
