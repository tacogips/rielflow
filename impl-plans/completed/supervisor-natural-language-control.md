# Supervisor Natural Language Control Implementation Plan

**Status**: Completed (optional follow-up: broader rename of legacy `superviser` identifiers inside the auto-improve engine and GraphQL persisted fields; not required for event supervisor control)
**Design Reference**: `design-docs/specs/design-event-supervisor-control.md#natural-language-commands`
**Created**: 2026-04-29
**Last Updated**: 2026-04-29

---

## Design Document Reference

**Source**:

- `design-docs/specs/design-event-supervisor-control.md`
- `design-docs/specs/design-auto-improve-superviser-mode.md`
- User direction from 2026-04-29: standardize `superviser` to `supervisor`,
  allow natural-language supervisor-control chat commands through an LLM node,
  and deliver each chat message to all workflow supervisors so each supervisor
  decides whether the command is for its managed workflow.

### Summary

Implement the follow-up control layer for chat-driven workflow supervision.
Supervisor-control chat input may be natural language. The runtime sends the
chat text to supervisor-owned LLM command-resolution nodes, validates their
structured output, and executes commands only when the decision is scoped to the
workflow managed by that supervisor.

This plan also migrates naming from `superviser` to `supervisor` across
operator-facing code, docs, examples, and public APIs, while retaining explicit
legacy compatibility where persisted data or old CLI flags need a migration
path.

### Scope

**Included**: supervisor spelling migration plan, natural-language intent
mapping mode, LLM command-resolution output contract, broadcast routing to all
candidate workflow supervisors, multi-target safety policy, GraphQL/library
surface updates, examples, and tests.

**Excluded**: broad redesign of auto-improve remediation logic, provider-specific
chat bot UX beyond provider-neutral replies, and unrestricted LLM execution of
privileged commands without runtime validation.

## Related Plans

- **Previous**: `impl-plans/completed/event-supervisor-control-foundation.md`
- **Concurrent Hardening**: `impl-plans/completed/event-supervisor-control-review-hardening.md`
- **Depends On**: foundation supervisor client, supervised-run repository, and
  event router from `event-supervisor-control-foundation`

## Modules

### 1. Supervisor Naming Migration

#### `src/workflow/*`, `src/events/*`, `src/graphql/*`, CLI/docs/examples

**Status**: COMPLETED (operator-facing: CLI aliases, help, `command.md`, event-layer `supervisorWorkflowName`; engine nested auto-improve keeps `superviser*` per compatibility)

```typescript
interface SupervisorNamingCompatibility {
  readonly canonicalTerm: "supervisor";
  readonly acceptedLegacyConfigKeys: readonly [
    "superviserWorkflowId",
    "nestedSuperviser",
  ];
  readonly acceptedLegacyCliFlags: readonly [
    "--superviser-workflow",
    "--nested-superviser",
  ];
  readonly persistedAliasesMigratedOnWrite: boolean;
}
```

**Checklist**:

- [x] Add canonical CLI flags `--supervisor-workflow` and `--nested-supervisor`
      (legacy spellings remain aliases)
- [x] Event supervised bindings and docs use `supervisor` terminology where
      applicable
- [ ] Optional: rename internal auto-improve modules from `superviser` to
      `supervisor` (large breaking surface; deferred)
- [x] Regression tests for GraphQL forwarding and nested-driver guardrails

### 2. Natural-Language Intent Mapping Contract

#### `src/events/types.ts`, `src/events/validate.ts`, `src/events/supervisor-intent.ts`

**Status**: COMPLETED

```typescript
interface EventSupervisorIntentMappingLlm extends JsonObject {
  readonly mode: "llm-command";
  readonly inputPath?: string;
  readonly resolverWorkflowName?: string;
  readonly resolverNodeId?: string;
  readonly minConfidence?: number;
  readonly defaultAction?: "input" | "ignore";
  readonly allowMultiTargetCommands?: boolean;
}

type EventSupervisorIntentMapping =
  | EventSupervisorIntentMappingStructuredOrCommand
  | EventSupervisorIntentMappingCommandMap
  | EventSupervisorIntentMappingStructuredOnly
  | EventSupervisorIntentMappingLlm;
```

**Checklist**:

- [x] Add `llm-command` as an explicit supervised intent mapping mode
- [x] Validate resolver workflow/node references, confidence threshold, and
      multi-target policy fields
- [x] Preserve deterministic mapping behavior for non-LLM modes
- [x] Record unresolved or low-confidence LLM decisions as skipped receipts with
      provider-neutral replies

### 3. Supervisor LLM Command Output Contract

#### `src/events/supervisor-command-contract.ts`, default supervisor prompts

**Status**: COMPLETED

```typescript
type SupervisorChatDecisionAction =
  | "ignore"
  | "start"
  | "stop"
  | "restart"
  | "status"
  | "input";

interface SupervisorChatCommandRequest {
  readonly messageId: string;
  readonly sourceId: string;
  readonly conversationId?: string;
  readonly threadId?: string;
  readonly text: string;
  readonly supervisorWorkflowName: string;
  readonly managedWorkflowName: string;
  readonly activeSupervisedRunId?: string;
  readonly allowedActions: readonly EventSupervisorAction[];
}

interface SupervisorChatCommandDecision {
  readonly action: SupervisorChatDecisionAction;
  readonly managedWorkflowName: string;
  readonly confidence: number;
  readonly reason: string;
  readonly commandText?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
}
```

**Checklist**:

- [x] Define a strict JSON output schema for LLM command-resolution nodes
- [x] Reject decisions whose `managedWorkflowName` does not match the receiving
      supervisor's managed workflow
- [x] Treat `ignore` as a normal non-error decision
- [x] Require runtime-side allow-list checks before executing any returned action
- [x] Parser tests and negative coverage in `supervisor-command-contract.test.ts`

### 4. Broadcast Chat Routing To Workflow Supervisors

#### `src/events/supervisor-llm-batch.ts`, `src/events/trigger-runner.ts`

**Status**: COMPLETED

```typescript
interface SupervisorChatBroadcastEnvelope {
  readonly event: ExternalEventEnvelope;
  readonly source: EventSourceConfig;
  readonly text: string;
  readonly candidateSupervisors: readonly SupervisorChatCandidate[];
}

interface SupervisorChatCandidate {
  readonly bindingId: string;
  readonly supervisorWorkflowName: string;
  readonly managedWorkflowName: string;
  readonly correlationKey: string;
  readonly activeSupervisedRunId?: string;
}

interface SupervisorChatBroadcastResult {
  readonly decisions: readonly SupervisorChatDecisionResult[];
  readonly executedCommandIds: readonly string[];
}
```

**Checklist**:

- [x] Enumerate all supervised `llm-command` bindings that match the event
- [x] Deliver the same natural-language text to each candidate resolver path
      (`planSupervisedLlmBindingsDispatch` + `trigger-runner` integration)
- [x] Execute commands only for validated non-`ignore` decisions scoped to the
      managed workflow
- [x] Preserve idempotency with event dedupe keys and command ids
- [x] Support local supervisor client and remote GraphQL endpoint modes

### 5. Multi-Target Command Safety

#### `src/events/supervisor-llm-batch.ts`, `src/events/supervisor-llm-batch.test.ts`

**Status**: COMPLETED

```typescript
interface SupervisorMultiTargetPolicy {
  readonly allowMultiTargetCommands: boolean;
  readonly destructiveActions: readonly ["stop", "restart"];
  readonly requireExplicitWorkflowRefForDestructiveFanout: boolean;
}
```

**Checklist**:

- [x] Default `allowMultiTargetCommands` to false for destructive actions
- [x] Reject ambiguous `stop` or `restart` when multiple bindings match without
      disambiguation (substring / `targetWorkflowName` heuristics)
- [x] Allow configured fanout when every matching binding sets
      `allowMultiTargetCommands: true`
- [x] Optional: richer chat-reply integration for ambiguity text (chat replies
      now ask for a specific workflow target when destructive commands are
      ambiguous)
- [x] Tests for ambiguity and disambiguation paths

### 6. API, Examples, And Verification

#### GraphQL/library APIs, examples, tests

**Status**: COMPLETED

```typescript
interface DispatchSupervisorChatInput {
  readonly sourceId: string;
  readonly eventId: string;
  readonly conversationId?: string;
  readonly threadId?: string;
  readonly text: string;
  readonly idempotencyKey?: string;
}
```

**Checklist**:

- [x] Add library and GraphQL entrypoints for dispatching supervisor chat text
      (`dispatchSupervisorChat`, `dispatch-supervisor-chat.ts`)
- [x] Example binding and payloads under `examples/event-sources/` for supervised
      control (structured example); LLM resolver wiring is binding-config driven
- [x] Design doc Phase 4 and `command.md` aligned with supervisor chat dispatch
- [x] Full `bun test` and `bun run typecheck` pass
- [x] `impl-plans/PROGRESS.json` and README index updated on closeout

---

## Module Status

| Module                          | File Path                                                        | Status      | Tests |
| ------------------------------- | ---------------------------------------------------------------- | ----------- | ----- |
| Supervisor naming migration     | CLI/docs/event surfaces; engine auto-improve keeps `superviser*` | Completed   | yes   |
| Natural-language intent mapping | `src/events/types.ts`, `validate.ts`, `supervisor-intent.ts`     | Implemented | yes   |
| LLM command output contract     | `src/events/supervisor-command-contract.ts`                      | Implemented | yes   |
| Broadcast / batch routing       | `supervisor-llm-batch.ts`, `trigger-runner.ts`                   | Implemented | yes   |
| Multi-target command safety     | `supervisor-llm-batch.ts`, tests                                 | Implemented | yes   |
| API, examples, verification     | `dispatch-supervisor-chat.ts`, GraphQL, `lib.ts`, tests          | Implemented | yes   |

## Dependencies

| Feature                      | Depends On                                       | Status |
| ---------------------------- | ------------------------------------------------ | ------ |
| TASK-001 Naming migration    | current supervisor-control foundation            | DONE   |
| TASK-002 Intent mapping      | TASK-001 public naming decisions                 | DONE   |
| TASK-003 LLM output contract | TASK-002                                         | DONE   |
| TASK-004 Broadcast routing   | TASK-002, TASK-003                               | DONE   |
| TASK-005 Multi-target safety | TASK-004                                         | DONE   |
| TASK-006 API/examples/verify | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005 | DONE   |

## Tasks

### TASK-001: Canonical Supervisor Naming

**Status**: Completed
**Parallelizable**: No
**Deliverables**: workflow/events/GraphQL naming migration, docs, examples
**Dependencies**: event supervisor foundation

**Completion Criteria**:

- [x] Canonical operator surfaces use `supervisor` (CLI aliases, event binding fields)
- [x] Legacy `superviser` spellings are accepted only through documented aliases
- [x] New event supervised examples and GraphQL/event layers use supervisor spelling

### TASK-002: LLM Intent Mapping Mode

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: event intent types, validation, resolver selection
**Dependencies**: TASK-001

**Completion Criteria**:

- [x] `llm-command` mapping is typed and validated
- [x] Non-LLM mappings retain current behavior
- [x] Low-confidence decisions are skipped safely

### TASK-003: LLM Decision Contract And Runtime Validation

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: command decision parser, prompt templates, negative tests
**Dependencies**: TASK-002

**Completion Criteria**:

- [x] LLM node output is parsed through a strict schema
- [x] Runtime verifies ownership, allowed action, and target workflow match
- [x] `ignore` decisions are recorded without failure

### TASK-004: Broadcast Router

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `planSupervisedLlmBindingsDispatch`, trigger-runner integration
**Dependencies**: TASK-002, TASK-003

**Completion Criteria**:

- [x] Each chat message reaches all candidate `llm-command` supervised bindings
      that match the event
- [x] Each binding can independently return `ignore` or an executable command
- [x] Local and remote GraphQL dispatch paths share the same contract

### TASK-005: Multi-Target Policy

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: ambiguity handling, fanout policy, replies, tests
**Dependencies**: TASK-004

**Completion Criteria**:

- [x] Ambiguous destructive natural-language commands are rejected by default
- [x] Explicit opt-in fanout is supported for configured bindings
- [x] Ambiguity surfaces as skip reasons on affected bindings (optional richer replies deferred)

### TASK-006: API, Examples, And Verification

**Status**: Completed
**Parallelizable**: No
**Deliverables**: GraphQL/library APIs, examples, docs, verification
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005

**Completion Criteria**:

- [x] GraphQL and library surfaces can dispatch supervisor chat text
- [x] Examples demonstrate supervised event control; LLM mode is config-driven
- [x] `bun run typecheck` passes
- [x] Full test suite passes

## Completion Criteria

- [x] Supervisor spelling is canonical across new public surfaces
- [x] Natural-language chat commands are resolved through supervisor-owned LLM
      nodes and strict runtime validation
- [x] Broadcast routing delivers chat text to all candidate workflow supervisors
- [x] Multi-target behavior is explicit and safe by default
- [x] Tests cover naming aliases, LLM output validation, routing, idempotency,
      and ambiguity handling

## Progress Log

### Session: 2026-04-29

**Tasks Completed**: Created implementation plan and registered it in the plan
index.

**Notes**: The plan intentionally treats LLM output as a structured command
proposal. Runtime-owned supervisor control remains responsible for authorization,
idempotency, and execution.

### Session: 2026-04-29 (CLI canonical supervisor spellings)

**Tasks Completed**: Partial TASK-001: `divedra` CLI accepts `--supervisor-workflow`
and `--nested-supervisor` as aliases for legacy `--superviser-workflow` and
`--nested-superviser`; help text and `command.md` updated; regression tests for
GraphQL forwarding and nested-driver guardrail.
**Tasks In Progress**: TASK-001 remainder (internal module renames, persisted
field canonicalization on write, broader migration tests).

### Session: 2026-04-29 (llm-command runtime and batch ambiguity)

**Tasks Completed**: TASK-002 through TASK-005 core: `llm-command` types and
validation, `supervisor-command-contract` parser, `runSupervisorLlmResolver`,
`resolveSupervisorIntentAsync`, `planSupervisedLlmBindingsDispatch` with
destructive disambiguation and cached intents on ambiguous plans, trigger-runner
integration, contract and batch tests.
**Tasks In Progress**: TASK-006 (GraphQL/library `dispatchSupervisorChat` if
still desired), TASK-001 naming sweep, optional `defaultAction` fallback when
resolver output is missing, chat-reply wiring for ambiguity messages.

### Session: 2026-04-29 (dispatchSupervisorChat and resolver hardening)

**Tasks Completed**: GraphQL + library `dispatchSupervisorChat`, `activeSupervisedRunId` lookup for LLM resolver variables, `defaultAction` fallback when resolver JSON is invalid or fails strict parse, design doc Phase 4 alignment.
**Notes**: Full test suite passes. Optional: ambiguity replies via chat-reply dispatcher, TASK-001 naming sweep.

### Session: 2026-04-29 (plan tracking and README closeout)

**Tasks Completed**: Marked all tasks **Completed** in `impl-plans/PROGRESS.json`
(phase 149), moved supervisor/event-supervisor plans from Active to Completed in
`impl-plans/README.md`, refreshed this plan's module and task checklists to match
the tree, minor cleanup in `supervisor-llm-batch.ts` disambiguation.
**Notes**: `bun run typecheck` and `bun test` verified after TS edit.

### Session: 2026-04-30 (ambiguity reply follow-up)

**Tasks Completed**: Closed the optional richer ambiguity chat-reply item:
destructive multi-supervisor ambiguity replies now ask for a specific workflow
target, and their idempotency key is aligned with event `dedupeKey` via the
event-supervisor hardening follow-up.
**Tasks In Progress**: None
**Blockers**: None
**Verification**: `bun run typecheck`; `bun test src/events/trigger-runner.test.ts src/events/supervisor-control-reply.test.ts src/workflow/supervisor-client.test.ts src/workflow/supervisor-graphql-client.test.ts src/graphql/schema.test.ts src/server/graphql.test.ts` (101 pass)
