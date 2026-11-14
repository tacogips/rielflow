# Autonomous Execution Gap Closure Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-autonomous-execution-gap-closure.md
**Created**: 2026-02-24
**Last Updated**: 2026-02-24

---

## Design Document Reference

**Source**: `design-docs/specs/design-autonomous-execution-gap-closure.md`

### Summary

This plan closes high-impact gaps between current runtime behavior and declared workflow semantics. It prioritizes semantic correctness (loops/completion/cancellation), then input assembly and type hardening, then real adapters, and finally sub-workflow conversation execution.

### Scope

**Included**:
- Loop-rule semantics and completion evaluation.
- Cancellation-safe session transitions.
- Deterministic argument binding/input assembly.
- Real adapter contract and provider implementations.
- Sub-workflow/conversation runtime execution.

**Excluded**:
- Multi-host distributed scheduling.
- Generic plugin marketplace.
- Full visual editor UX polish beyond runtime parity needs.

---

## Modules

### 1. Execution Semantics Core

#### src/workflow/semantics.ts

**Status**: COMPLETED

```typescript
export interface LoopRuntimeState {
  readonly loopId: string;
  readonly iteration: number;
}

export interface CompletionEvaluationInput {
  readonly rule: CompletionRule | undefined;
  readonly output: Readonly<Record<string, unknown>>;
}

export interface CompletionEvaluationResult {
  readonly passed: boolean;
  readonly reason: string | null;
}

export interface BranchEvaluationInput {
  readonly when: string;
  readonly output: Readonly<Record<string, unknown>>;
}

export function evaluateCompletion(input: CompletionEvaluationInput): CompletionEvaluationResult;
export function evaluateBranch(input: BranchEvaluationInput): boolean;
export function resolveLoopTransition(args: {
  readonly loopRule: LoopRule;
  readonly output: Readonly<Record<string, unknown>>;
  readonly state: LoopRuntimeState;
}): "continue" | "exit" | "none";
```

**Checklist**:
- [x] Add typed completion evaluator for all supported rule types.
- [x] Add loop-rule transition evaluator.
- [x] Add branch evaluation helper with deterministic behavior.
- [x] Unit tests for loop/completion/branch semantics.

#### src/workflow/engine.ts

**Status**: COMPLETED

```typescript
export interface CancellationProbe {
  isCancelled(sessionId: string): Promise<boolean>;
}

export interface EngineExecutionGuards {
  readonly cancellationProbe: CancellationProbe;
}
```

**Checklist**:
- [x] Replace node-count loop control with loop-rule aware control.
- [x] Integrate completion evaluator from semantics module.
- [x] Add pre-step cancellation check and terminal-state guard.
- [x] Preserve artifact and session compatibility.

### 2. Input Assembly and Type Hardening

#### src/workflow/input-assembly.ts

**Status**: COMPLETED

```typescript
export interface InputAssemblyContext {
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly node: NodePayload;
  readonly upstream: readonly Readonly<Record<string, unknown>>[];
  readonly transcript: readonly Readonly<Record<string, unknown>>[];
}

export interface AssembledNodeInput {
  readonly promptText: string;
  readonly arguments: Readonly<Record<string, unknown>> | null;
}

export function assembleNodeInput(ctx: InputAssemblyContext): AssembledNodeInput;
```

**Checklist**:
- [x] Materialize `argumentsTemplate` + `argumentBindings`.
- [x] Add deterministic missing-required binding failures.
- [x] Keep prompt rendering behavior backward compatible.
- [x] Unit tests for all binding source types.

#### src/workflow/types.ts

**Status**: COMPLETED

```typescript
export interface SubWorkflowRef {
  readonly id: string;
  readonly description: string;
  readonly inputNodeId: string;
  readonly outputNodeId: string;
  readonly inputSources: readonly SubWorkflowInputSource[];
}

export interface SubWorkflowConversation {
  readonly id: string;
  readonly participants: readonly string[];
  readonly maxTurns: number;
  readonly stopWhen: string;
}
```

**Checklist**:
- [x] Replace loose `Record<string, unknown>` with typed interfaces.
- [x] Maintain read-compatible normalization for existing files.
- [x] Add compiler-safe exports for runtime modules.
- [x] Update validator tests for typed fields.

### 3. Real Agent Adapter Integration

#### src/workflow/adapter.ts

**Status**: COMPLETED

```typescript
export type AdapterFailureCode =
  | "provider_error"
  | "timeout"
  | "invalid_output"
  | "policy_blocked";

export interface AdapterExecutionContext {
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface NodeAdapter {
  execute(input: AdapterExecutionInput, context: AdapterExecutionContext): Promise<AdapterExecutionOutput>;
}
```

**Checklist**:
- [x] Extend adapter API with timeout/cancellation context.
- [x] Add normalized adapter failure mapping.
- [x] Keep deterministic/scenario adapters as test fixtures.
- [x] Unit tests for failure normalization paths.

#### src/workflow/adapters/codex.ts

**Status**: COMPLETED

```typescript
export interface CodexAdapterConfig {
  readonly endpoint?: string;
  readonly apiKeyEnv?: string;
}

export class CodexAgentAdapter implements NodeAdapter {
  constructor(config?: CodexAdapterConfig);
  execute(input: AdapterExecutionInput, context: AdapterExecutionContext): Promise<AdapterExecutionOutput>;
}
```

**Checklist**:
- [x] Implement codex provider invocation adapter.
- [x] Enforce output schema validation.
- [x] Add retry policy with bounded attempts.
- [x] Add integration-style mocked tests.

#### src/workflow/adapters/claude.ts

**Status**: COMPLETED

```typescript
export interface ClaudeAdapterConfig {
  readonly endpoint?: string;
  readonly apiKeyEnv?: string;
}

export class ClaudeCodeAgentAdapter implements NodeAdapter {
  constructor(config?: ClaudeAdapterConfig);
  execute(input: AdapterExecutionInput, context: AdapterExecutionContext): Promise<AdapterExecutionOutput>;
}
```

**Checklist**:
- [x] Implement claude provider invocation adapter.
- [x] Enforce output schema validation.
- [x] Add retry policy with bounded attempts.
- [x] Add integration-style mocked tests.

### 4. Sub-Workflow and Conversation Runtime

#### src/workflow/sub-workflow.ts

**Status**: COMPLETED

```typescript
export function planManagerSubWorkflowInputs(args: {
  readonly workflow: WorkflowJson;
  readonly session: WorkflowSessionState;
}): readonly string[];
```

**Checklist**:
- [x] Implement manager-side sub-workflow input scheduling from `inputSources`.
- [x] Enforce dependency readiness for `human-input`, `node-output`, and `sub-workflow-output`.
- [x] Avoid duplicate sub-workflow starts after input node execution.
- [x] Add deterministic tests for scheduling and dependency gating.

#### src/workflow/conversation.ts

**Status**: COMPLETED

```typescript
export interface ConversationTurn {
  readonly conversationId: string;
  readonly turnIndex: number;
  readonly fromSubWorkflowId: string;
  readonly toSubWorkflowId: string;
  readonly outputRef: Readonly<Record<string, unknown>>;
}

export interface ConversationExecutionResult {
  readonly status: "stopped" | "max_turns" | "failed";
  readonly turns: readonly ConversationTurn[];
}

export function executeConversationRound(args: {
  readonly workflow: WorkflowJson;
  readonly sessionId: string;
}): Promise<ConversationExecutionResult>;
```

**Checklist**:
- [x] Implement participant routing via manager node.
- [x] Implement `maxTurns` and `stopWhen` enforcement.
- [x] Persist transcript in deterministic order.
- [x] Add replay tests from artifact/session state.

#### src/workflow/validate.ts

**Status**: COMPLETED

```typescript
export interface ValidationIssue {
  readonly severity: "error" | "warning";
  readonly path: string;
  readonly message: string;
}
```

**Checklist**:
- [x] Enforce strict schemas for sub-workflow and conversation blocks.
- [x] Reject inert fields with no runtime support in active phase.
- [x] Add migration warnings for deprecated/legacy paths.
- [x] Extend semantic validation coverage.

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Execution semantics | `src/workflow/semantics.ts` | COMPLETED | `src/workflow/semantics.test.ts` |
| Engine loop/cancel correctness | `src/workflow/engine.ts` | COMPLETED | `src/workflow/engine.test.ts` |
| Input assembly | `src/workflow/input-assembly.ts` | COMPLETED | `src/workflow/input-assembly.test.ts`, `src/workflow/engine.test.ts` |
| Typed workflow contracts | `src/workflow/types.ts` | COMPLETED | `src/workflow/validate.test.ts` |
| Adapter contract hardening | `src/workflow/adapter.ts` | COMPLETED | `src/workflow/adapter.test.ts`, `src/workflow/engine.test.ts` |
| Codex provider adapter | `src/workflow/adapters/codex.ts` | COMPLETED | `src/workflow/adapters/codex.test.ts` |
| Claude provider adapter | `src/workflow/adapters/claude.ts` | COMPLETED | `src/workflow/adapters/claude.test.ts` |
| Sub-workflow runtime | `src/workflow/sub-workflow.ts` | COMPLETED | `src/workflow/sub-workflow.test.ts`, `src/workflow/engine.test.ts` |
| Conversation runtime | `src/workflow/conversation.ts` | COMPLETED | `src/workflow/conversation.test.ts`, `src/workflow/engine.test.ts` |
| Validation hardening | `src/workflow/validate.ts` | COMPLETED | `src/workflow/validate.test.ts` |

## Task Dependencies

| Task | Depends On | Parallelizable |
|------|------------|----------------|
| TASK-001 Semantics core | - | Yes |
| TASK-002 Engine loop/cancel fixes | TASK-001 | No |
| TASK-003 Input assembly | TASK-001 | Yes |
| TASK-004 Type hardening + validation | TASK-001 | Yes |
| TASK-005 Adapter contract and providers | TASK-002, TASK-003 | No |
| TASK-006 Sub-workflow runtime | TASK-002, TASK-004 | No |
| TASK-007 Conversation runtime | TASK-006, TASK-005 | No |
| TASK-008 End-to-end tests and docs sync | TASK-002..TASK-007 | No |

## Completion Criteria

- [x] Loop behavior uses `workflow.loops[]` semantics, not node-count proxy.
- [x] Completion rules are evaluated by type/config.
- [x] Cancellation is race-safe and terminal-state preserving.
- [x] `argumentsTemplate` and `argumentBindings` affect runtime input deterministically.
- [x] Real codex/claude adapters execute behind unified contract.
- [x] Sub-workflow conversation runtime works with deterministic replay.
- [x] `bun test` and `bun run typecheck` pass.
- [x] Specs and implementation stay in sync.

## Progress Log

### Session: 2026-02-24 00:00
**Tasks Completed**: Plan initialization
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Created plan from architecture correction assessment. Next execution should start from TASK-001.

### Session: 2026-02-24 13:50
**Tasks Completed**: TASK-001 (semantics core), TASK-002 (loop/completion/cancellation core integration)
**Tasks In Progress**: TASK-003, TASK-004
**Blockers**: None
**Notes**: Added `src/workflow/semantics.ts` with expression-based branch evaluation, completion rule evaluation, and loop transition resolution. Integrated semantics into engine control flow with loop-aware transition handling, persisted `loopIterationCounts` in session state, and added pre-step/terminal cancellation guards. Added/updated tests in `src/workflow/semantics.test.ts` and `src/workflow/engine.test.ts`. Verified with `bun test` and `bun run typecheck`.

### Session: 2026-02-24 14:10
**Tasks Completed**: TASK-003 (input assembly)
**Tasks In Progress**: TASK-004
**Blockers**: None
**Notes**: Added `src/workflow/input-assembly.ts` and integrated assembly into engine before adapter invocation so both `promptText` and structured `arguments` are persisted in `input.json` and passed through adapter input. Added deterministic required-binding failure path that fails execution before adapter call. Extended tests in `src/workflow/input-assembly.test.ts` and `src/workflow/engine.test.ts` (variables, upstream node-output, transcript, and missing-required failure). Verified with `bun test` and `bun run typecheck`.

### Session: 2026-02-24 14:25
**Tasks Completed**: TASK-004 (typed contracts + validation hardening)
**Tasks In Progress**: TASK-005
**Blockers**: None
**Notes**: Replaced loose workflow typing for `subWorkflows` and `subWorkflowConversations` with explicit interfaces in `src/workflow/types.ts`. Hardened `src/workflow/validate.ts` with strict normalization for sub-workflow input sources and conversation blocks, semantic cross-reference checks (node ids, sub-workflow ids, participant constraints), and active-phase rejection of currently inert fields (`selectionPolicy`, `conversationPolicy`). Added validator coverage in `src/workflow/validate.test.ts`. Verified with `bun test` and `bun run typecheck`.

### Session: 2026-02-24 14:45
**Tasks Completed**: TASK-005 (adapter contract + provider adapters)
**Tasks In Progress**: TASK-006
**Blockers**: None
**Notes**: Extended adapter contract with execution context (`timeoutMs`, `AbortSignal`) and normalized failure taxonomy via `AdapterExecutionError`/`AdapterFailureCode` in `src/workflow/adapter.ts`. Updated engine execution path to pass context and enforce adapter timeout via `Promise.race` with abort signaling. Added provider adapters `src/workflow/adapters/codex.ts` and `src/workflow/adapters/claude.ts` with HTTP invocation, policy/error mapping, and strict output schema normalization. Added tests `src/workflow/adapter.test.ts`, `src/workflow/adapters/codex.test.ts`, `src/workflow/adapters/claude.test.ts`, and extended `src/workflow/engine.test.ts` for policy-blocked failure mapping. Verified with `bun test` and `bun run typecheck`.

### Session: 2026-02-24 15:05
**Tasks Completed**: TASK-006 (sub-workflow runtime)
**Tasks In Progress**: TASK-007
**Blockers**: None
**Notes**: Added `src/workflow/sub-workflow.ts` to plan manager-driven sub-workflow input scheduling from typed `inputSources` with readiness checks for `human-input`, `workflow-output`, `node-output`, and `sub-workflow-output` dependencies. Integrated scheduling into `src/workflow/engine.ts` manager transitions with duplicate suppression. Added tests in `src/workflow/sub-workflow.test.ts` and an engine integration case in `src/workflow/engine.test.ts` validating ordered execution across dependent sub-workflows. Verified with `bun test` and `bun run typecheck`.

### Session: 2026-02-24 15:35
**Tasks Completed**: TASK-007 (conversation runtime)
**Tasks In Progress**: TASK-008
**Blockers**: None
**Notes**: Added `src/workflow/conversation.ts` with deterministic round planning from `subWorkflowConversations`, round-robin participant routing, `maxTurns`/`stopWhen` evaluation, and output reference routing from sender sub-workflow output artifacts. Integrated manager-side conversation round execution into `src/workflow/engine.ts`, persisted transcript turns in `session.conversationTurns`, and routed conversation target sub-workflow input nodes into the queue with deduplication. Added tests in `src/workflow/conversation.test.ts` and extended `src/workflow/engine.test.ts` to verify transcript persistence and dependency-aware execution. Verified with `bun test` and `bun run typecheck`.

### Session: 2026-02-24 16:00
**Tasks Completed**: TASK-008 (end-to-end verification + docs sync)
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Completed final hardening tasks by adding bounded retry policies to `src/workflow/adapters/codex.ts` and `src/workflow/adapters/claude.ts` with integration-style retry tests. Added migration warnings and legacy alias normalization for sub-workflow/conversation schema paths in `src/workflow/validate.ts` (`inputs` -> `inputSources`, `participantsIds` -> `participants`) with validator tests. Re-ran full verification: `bun test` and `bun run typecheck` pass.

## Related Plans

- **Previous**: `impl-plans/completed/workflow-deterministic-mock-and-rerun.md`
- **Next**: TBD (split only if this plan exceeds practical session size)
- **Depends On**: Existing completed workflow foundation plans in `impl-plans/completed/`
