# Output Destinations Supervisor Memory Foundation Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-output-destinations-and-supervisor-memory.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-06

## Scope

Implement only the missing foundation around output destinations and supervisor/node contracts. Keep existing source-backed chat reply behavior working.

Out of scope: concrete S3 backup delivery, persistent LLM conversation memory implementation, and full workflow-node destination publishing.

Review clarification: this completed plan covers configuration, validation, runtime propagation, chat destination fanout, lifecycle progress replies, and targetable supervisor-to-supervisor chat routes. Non-chat delivery remains future work.

## Design and Reference Mapping

**Accepted Design**: `design-docs/specs/design-output-destinations-and-supervisor-memory.md`

**Codex-Agent References**:

- `../../codex-agent/src/types/rollout.ts`: reference for discriminated event message contracts with unknown-event fallback.
- `../../codex-agent/src/sdk/agent-runner.ts`: reference for normalizing stream events before publication.
- `../../codex-agent/src/queue/runner.ts`: reference for runner-owned deterministic progress emission.
- `../../codex-agent/design-docs/specs/design-codex-session-management.md`: reference for session event persistence boundaries.

**Intentional Divergence**: rielflow keeps outbound delivery in repository-local `src/events` adapters, runtime receipts, and workflow/supervisor contracts instead of copying Codex CLI stream delivery. Chat destinations may use a source adapter as a temporary transport bridge, but destination ids remain outbound routing hints rather than inbound source aliases.

## Modules

### 1. Event Destination Types

#### `src/events/types.ts`

**Status**: COMPLETED

```typescript
interface EventOutputDestinationConfigBase extends JsonObject {
  readonly id: string;
  readonly kind: string;
  readonly enabled?: boolean;
  readonly provider?: string;
}

interface ChatOutputDestinationConfig extends EventOutputDestinationConfigBase {
  readonly kind: "chat";
  readonly sourceId: string;
  readonly target?: {
    readonly provider?: string;
    readonly eventId?: string;
    readonly conversationId?: string;
    readonly threadId?: string;
    readonly actorId?: string;
  };
}
```

**Checklist**:

- [x] Add destination config types
- [x] Add optional chat target override fields
- [x] Add binding `outputDestinations`
- [x] Add node memory/persona contract types

### 2. Event Config Loader and Validator

#### `src/events/config.ts`, `src/events/validate.ts`

**Status**: COMPLETED

```typescript
interface EventConfiguration {
  readonly destinations: readonly EventOutputDestinationConfig[];
}
```

**Checklist**:

- [x] Load `<eventRoot>/destinations/*.json`
- [x] Validate destination ids, kinds, and source references
- [x] Validate chat destination target override shape
- [x] Validate binding destination references
- [x] Preserve implicit source-backed chat destination behavior

### 3. Output Destination Dispatch and Fanout

#### `src/events/output-destination.ts`, `src/events/reply-dispatcher.ts`

**Status**: COMPLETED

```typescript
function dispatchChatReplyToEventOutputDestination(
  input: EventOutputDestinationChatReplyInput,
): Promise<ChatReplyDispatchResult>;
```

**Checklist**:

- [x] Add destination dispatch abstraction
- [x] Implement chat destination through existing source adapter `dispatchChatReply`
- [x] Update reply dispatcher to use explicit destination when configured
- [x] Fan out destination lists sequentially to all enabled chat destinations
- [x] Apply chat destination target overrides for supervisor-to-supervisor routes
- [x] Fall back to source target for existing requests
- [x] Skip non-chat destinations until destination-specific publishers exist

### 3.1 Runtime Output Propagation

#### `src/events/input-mapping.ts`, `src/events/trigger-runner.ts`, `src/events/external-output.ts`, `src/workflow/native-node-executor.ts`

**Status**: COMPLETED

**Checklist**:

- [x] Propagate binding `outputDestinations` through `runtimeVariables.eventOutputDestinations`
- [x] Include destination ids in business-final external-output payloads
- [x] Emit request-received and execution-starting progress external outputs for chat tasks
- [x] Include destination ids in supervisor control and dispatch reply payloads
- [x] Pass destination ids through chat-reply worker dispatch requests

### 4. Tests and Examples

#### `src/events/*.test.ts`, `examples/event-sources/.rielflow-events/destinations/*.json`

**Status**: COMPLETED

**Checklist**:

- [x] Config loading test
- [x] Validation tests
- [x] Reply dispatch destination routing, target override, failed-provider attribution, and fanout tests
- [x] Example destination config

## Task Breakdown

### TASK-001: Destination Types and Node Contracts

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/events/types.ts`, `src/workflow/types.ts`
**Dependencies**: None

**Description**:
Define destination config types, binding-level destination ids, runtime destination variables, node event attachment declarations, memory contracts, and persona contracts without adding a durable memory implementation.

**Completion Criteria**:

- [x] `EventOutputDestinationConfig`, `ChatOutputDestinationConfig`, and `S3BackupOutputDestinationConfig` are defined.
- [x] `EventBinding.outputDestinations` is typed as a destination-id list.
- [x] `NodeLongTermMemoryStore` and `WorkflowNodeEventAttachment` contracts exist without runtime listener ownership.
- [x] Type checking passes.

### TASK-002: Destination Loading and Validation

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/config.ts`, `src/events/validate.ts`, `src/events/config.test.ts`
**Dependencies**: TASK-001

**Description**:
Load `<eventRoot>/destinations/*.json`, validate destination shape and references, validate binding `outputDestinations`, and preserve compatibility when bindings omit explicit destinations.

**Completion Criteria**:

- [x] Destination config files load into `EventConfiguration.destinations`.
- [x] Duplicate ids, unsupported shapes, missing source references, and missing binding destination references are validation errors.
- [x] Existing source-backed chat behavior remains available when explicit destinations are absent.
- [x] Focused config and validation tests pass.

### TASK-003: Single Effective Chat Destination Dispatch

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/output-destination.ts`, `src/events/reply-dispatcher.ts`, `src/events/reply-dispatcher.test.ts`
**Dependencies**: TASK-001, TASK-002

**Description**:
Route chat replies through the output-destination abstraction while preserving single-target compatibility and fanning out destination lists to every enabled chat target.

**Completion Criteria**:

- [x] Explicit `outputDestinationId` is preferred when present.
- [x] Ordered `outputDestinationIds` fans out sequentially to every enabled chat destination.
- [x] Source-matched chat destinations are selected before compatibility fallback.
- [x] Non-chat destinations do not receive payloads until destination-specific publishers are designed.
- [x] Reply-dispatcher tests cover explicit destination, fallback, target override, failed-destination provider attribution, and fanout behavior.

### TASK-004: Runtime Destination Propagation

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/events/input-mapping.ts`, `src/events/trigger-runner.ts`, `src/events/trigger-runner-replies.ts`, `src/events/external-output.ts`, `src/events/supervisor-control-reply.ts`, `src/workflow/native-node-executor.ts`
**Dependencies**: TASK-001, TASK-003

**Description**:
Carry binding destination ids through runtime variables and external-output paths so business-final, control-status, supervisor-dispatch, and chat-reply worker requests can dispatch through the selected destination context.

**Completion Criteria**:

- [x] Runtime variables include `eventOutputDestinations` when a binding declares destinations.
- [x] Business-final external output includes destination ids.
- [x] Progress external output includes destination ids.
- [x] Supervisor control and dispatch replies include destination ids.
- [x] Chat-reply worker dispatch receives destination ids.
- [x] Trigger-runner and reply-dispatcher tests cover propagation.

### TASK-005: Examples, Documentation, and Review Closeout

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `examples/event-sources/.rielflow-events/destinations/*.json`, `examples/event-sources/.rielflow-events/bindings/webhook-to-chat-reply.json`, `design-docs/specs/design-output-destinations-and-supervisor-memory.md`, `impl-plans/completed/output-destinations-supervisor-memory-foundation.md`
**Dependencies**: TASK-002, TASK-003, TASK-004

**Description**:
Document accepted scope, Codex-reference mapping, review decisions, future boundaries, and example destination configuration for downstream implementation and review gates.

**Completion Criteria**:

- [x] Example binding references a chat destination.
- [x] Example destination config exists under `.rielflow-events/destinations/`.
- [x] Design and plan explicitly state that S3 backup delivery, non-chat retry semantics, and durable memory stores are future work.
- [x] Review decisions and verification commands are documented.

## Module Status

| Module              | File Path                                                                                                                              | Status    | Tests                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------- |
| Destination types   | `src/events/types.ts`                                                                                                                  | COMPLETED | Typecheck                                                                  |
| Config/validation   | `src/events/config.ts`, `src/events/validate.ts`                                                                                       | COMPLETED | `src/events/config.test.ts`                                                |
| Dispatch fanout     | `src/events/output-destination.ts`, `src/events/reply-dispatcher.ts`                                                                   | COMPLETED | `src/events/reply-dispatcher.test.ts`                                      |
| Runtime propagation | `src/events/input-mapping.ts`, `src/events/trigger-runner.ts`, `src/events/external-output.ts`, `src/workflow/native-node-executor.ts` | COMPLETED | `src/events/trigger-runner.test.ts`, `src/events/reply-dispatcher.test.ts` |
| Examples            | `examples/event-sources/.rielflow-events/destinations/*.json`                                                                           | COMPLETED | Event config validation                                                    |

## Dependencies

| Task/Feature                               | Depends On                            | Status    |
| ------------------------------------------ | ------------------------------------- | --------- |
| TASK-001 destination contracts             | None                                  | COMPLETED |
| TASK-002 loading and validation            | TASK-001                              | COMPLETED |
| TASK-003 chat destination route and fanout | TASK-001, TASK-002                    | COMPLETED |
| TASK-004 runtime propagation               | TASK-001, TASK-003                    | COMPLETED |
| TASK-005 examples and closeout             | TASK-002, TASK-003, TASK-004          | COMPLETED |
| Supervisor-to-supervisor chat              | Destination dispatch target overrides | COMPLETED |
| Supervisor pre-run output                  | Destination dispatch                  | COMPLETED |
| Durable memory stores                      | Memory contract types                 | FUTURE    |

## Parallelization Plan

| Task     | Parallelizable | Reason                                                                 |
| -------- | -------------- | ---------------------------------------------------------------------- |
| TASK-001 | Yes            | Owns shared type surfaces and has no same-plan dependency.             |
| TASK-002 | No             | Depends on destination and binding types from TASK-001.                |
| TASK-003 | No             | Depends on loaded/validated destination config from TASK-001/002.      |
| TASK-004 | No             | Depends on chat dispatch request shape and output-destination routing. |
| TASK-005 | No             | Depends on completed runtime behavior and examples.                    |

## Completion Criteria

- [x] Design document added
- [x] Completed implementation plan updated
- [x] Destination config loads and validates
- [x] Chat replies can target explicit chat destinations
- [x] Chat replies can fan out to multiple chat destinations
- [x] Chat destinations can target another supervisor conversation
- [x] Chat-originated tasks receive progress lifecycle replies before workflow execution
- [x] Existing source-targeted chat replies keep working
- [x] Focused tests pass
- [x] Type checking passes
- [x] Design review clarifies deterministic supervisor routing and Codex-reference divergence

## Review Decisions

- Keep the plan in `impl-plans/completed/` because the requested foundation is implemented and this bounded run is documentation review, not new implementation.
- Do not widen scope to S3 delivery in this plan; backup destinations are schema and validation foundation only.
- Keep deterministic supervisor command ownership in `src/events/supervisor-intent.ts` and `src/events/supervisor-command-contract.ts`; LLM resolvers are explicit fallback or async resolver paths.
- Keep Codex-reference behavior as reference-only. The implementation maps Codex-style normalized event contracts to rielflow's event adapter, receipt, and external-output publisher model rather than copying Codex CLI stream handling.

## Review Verification

Commands reviewed or intended for downstream verification:

```bash
sed -n '1,260p' design-docs/specs/design-output-destinations-and-supervisor-memory.md
sed -n '1,320p' impl-plans/completed/output-destinations-supervisor-memory-foundation.md
rg -n "EventOutputDestination|outputDestinations|eventOutputDestinations|NodeMemory|persona|dispatchChatReply" src/events src/workflow examples/event-sources -S
test -d ../../codex-agent && test -f ../../codex-agent/src/types/rollout.ts && test -f ../../codex-agent/src/sdk/agent-runner.ts
bun test src/events/config.test.ts src/events/reply-dispatcher.test.ts src/events/trigger-runner.test.ts src/events/mailbox-bridge-policy.test.ts
bunx tsc --noEmit
```

## Progress Log

### Session: 2026-05-06 22:35

**Tasks Completed**: Created design and plan.
**Tasks In Progress**: Destination foundation.
**Blockers**: None.
**Notes**: Keep this as an additive foundation rather than a full event supervisor rewrite.

### Session: 2026-05-06 23:10

**Tasks Completed**: Added destination config loading, validation, chat destination dispatch, runtime destination propagation, examples, and tests.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Concrete non-chat delivery and durable memory backends remain future implementation on top of the added contracts.

### Session: 2026-05-06 23:30

**Tasks Completed**: Reviewed design and completed plan against intake constraints, source mappings, and local Codex-reference files.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Clarified that workflow output mail remains internal execution data and provider replies must be explicit external-output publications.

### Session: 2026-05-07 00:25

**Tasks Completed**: Added chat destination fanout, optional target overrides for supervisor-to-supervisor chat, lifecycle progress replies for mapped chat tasks, destination-source provider attribution for failed explicit destination dispatch, and tests.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Non-chat destinations remain validated configuration until destination-specific publishers are implemented.

### Session: 2026-05-07 00:45

**Tasks Completed**: Fixed review findings from `recent-change-quality-loop`: read-only mode now suppresses progress replies before external side effects, fanout dispatch is sequential, and idempotent fanout replay preserves `destinationResults` from persisted response audit data.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Added regression coverage for read-only progress suppression and persisted fanout replay.

### Session: 2026-05-06 23:45

**Tasks Completed**: Self-reviewed Step 4 plan output before independent implementation-plan review.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Aligned the dispatch signature snippet with `dispatchChatReplyToEventOutputDestination` and corrected the completed-plan wording in completion criteria.
