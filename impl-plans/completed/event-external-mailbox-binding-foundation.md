# Event External Mailbox Binding Foundation Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-event-external-mailbox-binding.md` (`Resolved Planning Decisions`, `External Mailbox Address`, `Outbound Flow`, `First Implementation Boundary`)
**Created**: 2026-04-30
**Last Updated**: 2026-04-30

## Related Plans

- **Previous**: `impl-plans/event-listener-workflow-trigger-foundation.md`
- **Previous**: `impl-plans/completed/event-supervisor-control-foundation.md`
- **Previous**: `impl-plans/runtime-owned-external-output-publication.md`
- **Completed**: `impl-plans/completed/event-external-mailbox-binding-foundation.md`
- **Next**: follow-up plan for inbound external-input abstraction and full event/runtime convergence
- **Depends On**: existing event foundation, supervisor control foundation, runtime-owned external output publication
## Design Document Reference

**Source**: `design-docs/specs/design-event-external-mailbox-binding.md`

### Summary

Implement the first bounded slice of the external-mailbox binding design by
converging event reply/control publication on a provider-neutral external
output contract while preserving the current event receipt ledger, supervised
control flow, and execution-scoped `external-mailbox` communication artifacts.

This plan intentionally stops before the larger inbound refactor. The first
slice makes event binding policy explicit, routes final workflow business
replies through a runtime-owned external-output message shape, and re-expresses
supervisor control replies as `control-status` output messages. That creates a
stable contract for later inbound mailbox abstraction without forcing a full
event/runtime rewrite up front.

### Scope

**Included**:
- add provider-neutral external mailbox address/output message contracts
- add explicit binding output policy resolution for final/progress/control
- adapt runtime-owned final workflow publication to emit canonical external
  output messages before provider delivery
- adapt supervisor control replies to publish `control-status` messages instead
  of building provider-specific reply requests directly
- keep durable outbound delivery auditability by reusing or minimally extending
  existing reply-dispatch persistence
- add regression tests covering policy resolution, final-output publication,
  control-status publication, idempotent delivery reuse, and no-binding/no-reply
  cases

**Excluded**:
- full inbound direct/supervised dispatch refactor behind a generic external
  input message abstraction
- replacing the event receipt ledger with a new standalone mailbox store
- generic progress publication from runtime state beyond the policy surface and
  the minimum plumbing needed for later rollout
- new provider adapters, UI/editor work, or new public CLI commands

### Resolved Implementation Constraints

- execution-scoped `CommunicationRecord` artifacts with
  `routingScope: "external-mailbox"` remain the canonical runtime record once a
  workflow execution accepts input or publishes output
- pre-execution event staging remains in the event ledger/runtime DB
- direct event bindings remain supported and keep `workflowInput`, `event`, and
  optional `humanInput` runtime variables
- existing event reply dispatch persistence may be reused if it is upgraded to
  consume canonical external output messages instead of ad hoc chat reply text

## Modules

### 1. External Mailbox Contracts And Policy Resolution

#### `src/events/types.ts`, `src/events/validate.ts`

**Status**: NOT_STARTED

```typescript
interface ExternalMailboxAddress {
  readonly sourceId?: string;
  readonly bindingId?: string;
  readonly workflowName?: string;
  readonly workflowExecutionId?: string;
  readonly supervisedRunId?: string;
  readonly correlationKey?: string;
  readonly conversationId?: string;
  readonly threadId?: string;
}

type ExternalOutputKind = "business-final" | "progress" | "control-status";

interface ExternalOutputMessage {
  readonly kind: "external-output";
  readonly outputKind: ExternalOutputKind;
  readonly address: ExternalMailboxAddress;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}

interface EventMailboxBridgePolicy {
  readonly input?: {
    readonly consumer: "direct-workflow" | "supervisor";
  };
  readonly output?: {
    readonly reply?: { readonly mode: "none" | "final" };
    readonly progress?: { readonly mode: "none" | "status-only" };
    readonly control?: { readonly mode: "none" | "status-only" };
  };
}

function resolveEventMailboxBridgePolicy(
  binding: EventBinding,
): EventMailboxBridgePolicy;
```

**Implementation instructions**:
- Keep authored compatibility: existing bindings continue to load without a new
  required field.
- Resolve mailbox policy from existing direct/supervised binding intent plus
  any new explicit output-policy surface.
- Validate impossible combinations early, especially control/progress output
  policies on bindings that cannot produce a routable external address.
- Treat this as a contract layer, not a provider adapter concern.

**Checklist**:
- [ ] Canonical external mailbox address and output message types are defined
- [ ] Binding policy resolution is centralized
- [ ] Validation rejects contradictory or unroutable output policies
- [ ] Backward-compatible defaults are documented in tests

---

### 2. External Output Publication And Delivery Bridge

#### `src/events/external-output.ts`, `src/events/reply-dispatcher.ts`

**Status**: NOT_STARTED

```typescript
interface ExternalOutputDispatchTarget {
  readonly sourceId: string;
  readonly provider: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly eventId?: string;
  readonly actorId?: string;
}

interface PublishExternalOutputMessageInput {
  readonly message: ExternalOutputMessage;
  readonly dispatchTarget?: ExternalOutputDispatchTarget;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
}

interface ExternalOutputPublisher {
  publish(
    input: PublishExternalOutputMessageInput,
  ): Promise<ChatReplyDispatchResult | null>;
}

function resolveExternalOutputDispatchTarget(
  address: ExternalMailboxAddress,
  payload: Readonly<Record<string, unknown>>,
): ExternalOutputDispatchTarget | null;
```

**Implementation instructions**:
- Introduce one provider-neutral publication path for outbound event replies.
- Keep provider adapters transport-focused: they should receive a resolved
  dispatch target plus canonical payload-derived text/content, not supervisor-
  or workflow-specific ad hoc structures.
- Reuse the existing reply-dispatch persistence where possible. If storage must
  evolve, keep idempotency behavior and backward readability.
- No binding match means the canonical output message is still persisted, but no
  provider delivery is attempted.

**Checklist**:
- [ ] One publication service bridges canonical external output messages to provider delivery
- [ ] Existing reply-dispatch persistence remains idempotent
- [ ] No-binding/no-target output stays persisted without fake delivery success
- [ ] Delivery formatting is transport-specific but canonical payload storage is unchanged

---

### 3. Runtime-Owned Final Business Output Integration

#### `src/workflow/engine.ts`, `src/workflow/types.ts`

**Status**: NOT_STARTED

```typescript
interface WorkflowExternalOutputContext {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly sourceNodeId: string;
  readonly sourceNodeExecId: string;
  readonly createdAt: string;
}

function buildBusinessFinalExternalOutputMessage(input: {
  readonly address: ExternalMailboxAddress;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly context: WorkflowExternalOutputContext;
}): ExternalOutputMessage;
```

**Implementation instructions**:
- Keep the existing runtime-owned output-selection rule from
  `runtime-owned-external-output-publication.md`: only the latest succeeded
  `output`-kind execution is eligible.
- Publish canonical `business-final` output before provider delivery.
- Keep communication artifact persistence authoritative; provider delivery is a
  side effect that must not redefine the stored payload.
- Preserve the ability for workflows to complete with no provider reply when
  no eligible address or reply policy exists.

**Checklist**:
- [ ] Final workflow output is expressed as a canonical `business-final` external output message
- [ ] Runtime publication still uses the latest succeeded `output`-kind execution only
- [ ] Provider delivery does not mutate canonical persisted payloads
- [ ] Workflows can complete without outbound delivery when policy/address forbids it

---

### 4. Supervisor Control-Status Publication

#### `src/events/trigger-runner.ts`, `src/events/supervisor-control-reply.ts`

**Status**: NOT_STARTED

```typescript
function buildControlStatusExternalOutputMessage(input: {
  readonly event: ExternalEventEnvelope;
  readonly receiptId: string;
  readonly action: EventSupervisorAction | "skip" | "failed";
  readonly view?: SupervisedWorkflowView;
  readonly skipReason?: string;
  readonly createdAt: string;
}): ExternalOutputMessage | null;
```

**Implementation instructions**:
- Replace direct construction of provider-specific supervisor chat replies with
  canonical `control-status` messages.
- Preserve current operator-visible semantics for started/status/skipped/failed
  replies. The main change is the publication boundary and persistence shape.
- Keep clarification suppression/idempotency behavior for LLM ambiguity flows.
- Do not conflate supervisor control/status output with workflow final business
  output.

**Checklist**:
- [ ] Supervisor reply publication emits `control-status` messages
- [ ] Existing supervised skip/failure/status semantics remain intact
- [ ] Ambiguity suppression still emits one canonical clarification at most
- [ ] Control-status delivery remains best-effort over provider transport

---

### 5. Verification

#### `src/events/reply-dispatcher.test.ts`, `src/events/trigger-runner.test.ts`, `src/workflow/engine.test.ts`

**Status**: NOT_STARTED

```typescript
test("publishes canonical business-final output before provider delivery", async () => {});
test("does not attempt provider delivery when reply policy is none", async () => {});
test("reuses persisted outbound idempotency for canonical external output messages", async () => {});
test("publishes supervisor control replies as control-status messages", async () => {});
test("persists canonical output even when no dispatch target is available", async () => {});
```

**Implementation instructions**:
- Cover both direct and supervised event-triggered paths where applicable.
- Assert persisted canonical payload shape separately from provider formatting.
- Include negative cases: no address, no binding reply policy, unsupported
  provider reply capability, and duplicate idempotency key reuse.

**Checklist**:
- [ ] Business-final publication path is regression-tested
- [ ] Control-status publication path is regression-tested
- [ ] Delivery idempotency reuse is regression-tested
- [ ] No-target/no-policy behavior is regression-tested

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Contracts and policy resolution | `src/events/types.ts`, `src/events/validate.ts` | NOT_STARTED | `src/events/*.test.ts` |
| External output publisher | `src/events/external-output.ts`, `src/events/reply-dispatcher.ts` | NOT_STARTED | `src/events/reply-dispatcher.test.ts` |
| Runtime business-final integration | `src/workflow/engine.ts` | NOT_STARTED | `src/workflow/engine.test.ts` |
| Supervisor control-status publication | `src/events/trigger-runner.ts`, `src/events/supervisor-control-reply.ts` | NOT_STARTED | `src/events/trigger-runner.test.ts` |
| Regression verification | `src/events/*.test.ts`, `src/workflow/engine.test.ts` | NOT_STARTED | target coverage |

## Tasks

### TASK-001: Define Canonical External Output Contracts

**Status**: Ready
**Parallelizable**: Yes
**Deliverables**: `src/events/types.ts`, `src/events/validate.ts`
**Dependencies**: None

**Completion Criteria**:
- [ ] Canonical external mailbox address and output types are defined
- [ ] Binding output policy resolution is centralized
- [ ] Validation covers backward-compatible defaults and invalid combinations

### TASK-002: Build Output Publication Bridge

**Status**: Ready
**Parallelizable**: No
**Deliverables**: `src/events/external-output.ts`, `src/events/reply-dispatcher.ts`
**Dependencies**: TASK-001

**Completion Criteria**:
- [ ] Canonical external output messages can be delivered through provider adapters
- [ ] Existing idempotent delivery persistence is preserved or compatibly upgraded
- [ ] No-target outputs remain persisted without transport success

### TASK-003: Integrate Runtime Final Output Publication

**Status**: Ready
**Parallelizable**: Yes
**Deliverables**: `src/workflow/engine.ts`
**Dependencies**: TASK-001, TASK-002

**Completion Criteria**:
- [ ] Runtime final publication emits `business-final` messages
- [ ] Latest succeeded `output`-kind selection rule remains enforced
- [ ] No-policy/no-address cases skip delivery without corrupting completion

### TASK-004: Integrate Supervisor Control-Status Publication

**Status**: Ready
**Parallelizable**: Yes
**Deliverables**: `src/events/trigger-runner.ts`, `src/events/supervisor-control-reply.ts`
**Dependencies**: TASK-001, TASK-002

**Completion Criteria**:
- [ ] Supervisor replies publish `control-status` messages
- [ ] Existing skip/failure/status behavior remains stable
- [ ] Ambiguity suppression still limits clarification to one delivery

### TASK-005: Add Regression Coverage

**Status**: Ready
**Parallelizable**: No
**Deliverables**: `src/events/reply-dispatcher.test.ts`, `src/events/trigger-runner.test.ts`, `src/workflow/engine.test.ts`
**Dependencies**: TASK-003, TASK-004

**Completion Criteria**:
- [ ] Business-final and control-status publication paths are covered
- [ ] Idempotent reuse is covered
- [ ] No-policy/no-target/unsupported-adapter cases are covered

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Canonical external output contract | Existing event binding/runtime types | Available |
| Output publication bridge | TASK-001 | BLOCKED |
| Runtime final output integration | TASK-001, TASK-002 | BLOCKED |
| Supervisor control-status integration | TASK-001, TASK-002 | BLOCKED |
| Regression coverage | TASK-003, TASK-004 | BLOCKED |

## Completion Criteria

- [ ] Binding output policy is explicit and backward compatible
- [ ] Runtime final workflow publication emits canonical `business-final` messages
- [ ] Supervisor replies emit canonical `control-status` messages
- [ ] Provider delivery remains transport-focused and idempotent
- [ ] Canonical payload persistence remains authoritative over provider formatting
- [ ] Relevant tests pass
- [ ] Type checking passes

## Suggested Verification Commands

```bash
bun run typecheck
bun test src/events/reply-dispatcher.test.ts
bun test src/events/trigger-runner.test.ts
bun test src/workflow/engine.test.ts
```

If the implementation touches shared event/runtime plumbing broadly:

```bash
bun test
```

## Cursor Compose Prompt

Use the following prompt as the handoff input for Cursor Compose:

```text
You are continuing implementation in the divedra repository.

Read and follow these files first:
- AGENTS.md
- impl-plans/README.md
- impl-plans/event-external-mailbox-binding-foundation.md
- design-docs/specs/design-event-external-mailbox-binding.md

Goal:
Continuously implement the remaining work in the active implementation plan `event-external-mailbox-binding-foundation` until all tasks are complete, while preserving unrelated existing local changes.

Important repository rules:
- Think and write in English.
- Follow AGENTS.md.
- This repo is TypeScript/Bun with strict typing.
- After any TypeScript change, run typecheck and relevant tests.
- Do not revert or overwrite unrelated local modifications already present in the worktree.
- Keep commits out of scope unless explicitly requested.
- Update implementation-plan tracking as you go.

Current active plan:
- `impl-plans/event-external-mailbox-binding-foundation.md`
- Task order and dependencies:
  - TASK-001: Define canonical external output contracts
  - TASK-002: Build output publication bridge
  - TASK-003: Integrate runtime final output publication
  - TASK-004: Integrate supervisor control-status publication
  - TASK-005: Add regression coverage

Execution instructions:
1. Inspect the current code before editing, especially:
   - `src/events/types.ts`
   - `src/events/validate.ts`
   - `src/events/reply-dispatcher.ts`
   - `src/events/supervisor-control-reply.ts`
   - `src/events/trigger-runner.ts`
   - `src/workflow/engine.ts`
   - related tests in `src/events/*.test.ts` and `src/workflow/engine.test.ts`
2. Implement exactly one executable task at a time based on plan dependencies.
3. After each task:
   - run `bun run typecheck`
   - run the most relevant focused tests first
   - if broader shared plumbing changed, run `bun test`
4. After each successfully completed task:
   - update task status/checklists in `impl-plans/event-external-mailbox-binding-foundation.md`
   - append a concise progress-log entry with date, completed task IDs, blockers, and notes
   - update `impl-plans/PROGRESS.json`
   - update `impl-plans/README.md` if active/completed plan listing changes
5. Continue automatically to the next unblocked task until the whole plan is complete or you hit a real blocker.
6. If blocked, stop and report:
   - the blocking task ID
   - exact file/function/surface causing the blocker
   - the smallest decision needed to continue

Implementation intent to preserve:
- Use provider-neutral external mailbox contracts.
- Keep provider adapters transport-focused.
- Keep canonical persisted payloads authoritative over provider formatting.
- Preserve current idempotent delivery behavior.
- Preserve current runtime-owned external mailbox communication artifacts.
- Preserve existing supervisor skip/failure/status semantics.
- Do not collapse workflow final business output and supervisor control-status output into the same semantic path.

Concrete target outcomes:
- TASK-001:
  - define canonical external mailbox address/output types
  - centralize bridge policy resolution
  - validate contradictory or unroutable policy combinations
- TASK-002:
  - add a provider-neutral external output publication path
  - adapt reply dispatch persistence to canonical output messages
  - persist no-target outputs without pretending delivery succeeded
- TASK-003:
  - publish runtime final output as canonical `business-final`
  - preserve latest-succeeded-`output` selection rule
- TASK-004:
  - publish supervisor replies as canonical `control-status`
  - preserve ambiguity suppression and best-effort delivery behavior
- TASK-005:
  - add regression coverage for business-final, control-status, idempotency reuse, and no-policy/no-target cases

Worktree safety:
There are already local modifications in event/supervisor/graphql/workflow files. Read before editing and integrate with them. Do not discard or rewrite unrelated user changes.

When reporting progress after each task, use this format:
- Completed: TASK-00X
- Files changed: ...
- Verification: ...
- Next unblocked task: TASK-00Y
- Blockers: none / ...

Start by confirming the active plan, summarizing the remaining tasks, and then implementing TASK-001.
```

## Progress Log

### Session: 2026-04-30 (design)
**Tasks Completed**: Design review and implementation plan creation
**Tasks In Progress**: None
**Blockers**: None
**Notes**: The reviewed design fixes the first implementation slice to output-policy and output-publication convergence. Full inbound abstraction remains intentionally deferred to a follow-up plan because it crosses event receipt, direct dispatch, supervisor routing, and runtime communication seams simultaneously.

### Session: 2026-04-30 (implementation)
**Tasks Completed**: TASK-001 through TASK-005
**Tasks In Progress**: None
**Blockers**: None
**Notes**:
1. Added `ExternalMailboxAddress`, `ExternalOutputMessage`, optional `EventBinding.mailboxBridge`, and `ResolvedEventMailboxBridgePolicy` via `mailbox-bridge-policy.ts` plus validation in `validate.ts`.
2. Added `external-output.ts` with `publishExternalOutputMessage`, `publishWorkflowBusinessFinalExternalOutput`, `no_delivery_target` reply-dispatch status, and `dispatchAuditMetadata` on `ChatReplyDispatchRequest`.
3. Engine publishes business-final through the bridge after external mailbox communication persistence when `eventReplyDispatcher` and event runtime variables are present.
4. Supervisor control replies route through `buildControlStatusExternalOutputMessage` + `publishExternalOutputMessage`; extracted `chat-reply-target.ts` for envelope resolution.
5. Tests: `mailbox-bridge-policy.test.ts`, `external-output.test.ts`, extended `supervisor-control-reply.test.ts`.
   **Verification**: `bun run typecheck`; `bun test` on `external-output`, `mailbox-bridge-policy`, `supervisor-control-reply`, `trigger-runner`, `reply-dispatcher`, `engine` test files.

## Review Findings

### Session: 2026-04-30 (post-implementation review)

**Reviewer**: Codex
**Verification Run**:
- `bun run typecheck`: PASS
- `bun test src/events/external-output.test.ts src/events/mailbox-bridge-policy.test.ts src/events/supervisor-control-reply.test.ts src/events/trigger-runner.test.ts`: PASS
- `bun test src/workflow/engine.test.ts`: PASS

**Open Issues**:

- [ ] `src/events/validate.ts:552` / `src/events/mailbox-bridge-policy.ts:20`: `mailboxBridge.input.consumer` is not fully runtime-validated. Values other than `"direct-workflow"` or `"supervisor"` are currently accepted silently unless they happen to trigger the supervised/direct contradiction checks, and `resolveEventMailboxBridgePolicy` then copies the invalid value into runtime variables. Add explicit shape/value validation for `mailboxBridge.input.consumer` and object-shape validation for nested `input`, `output`, `reply`, `progress`, and `control` fields before resolving policy.

- [ ] `src/workflow/engine.ts:4356` / `src/workflow/engine.ts:4392` / `src/events/external-output.ts:422`: runtime final output still persists the original node `output.json` as the `external-mailbox` communication payload, while the canonical `business-final` `ExternalOutputMessage` is only stored in reply-dispatch audit metadata when provider delivery is attempted. This does not fully satisfy the plan language that final workflow output is expressed as a canonical `business-final` external output message and that canonical payload persistence is authoritative. Decide whether the execution-scoped external-output communication should store the canonical message itself, or document and test the narrower contract that only delivery audit metadata is canonical.

- [ ] `src/events/external-output.ts:445`: `publishWorkflowBusinessFinalExternalOutput` returns before calling `publishExternalOutputMessage` when the event has no resolvable chat reply target. That means the `no_delivery_target` persistence path is not exercised for event-triggered business-final output with no conversation/reply target. Add coverage for a direct event-triggered workflow with final reply policy enabled but no dispatch target, and either persist a canonical no-target dispatch row or explicitly document that the already-written external-mailbox communication is the only durable record for that case.

- [ ] `impl-plans/completed/event-external-mailbox-binding-foundation.md:74`: the plan was moved to `completed/` and the progress log says TASK-001 through TASK-005 are complete, but module statuses, task statuses, dependency statuses, and checklists still show `NOT_STARTED`, `Ready`, `BLOCKED`, and unchecked criteria. Normalize the plan metadata so future implementation agents do not treat completed work as executable.

**Residual Test Gap**:
- [ ] Add a regression test that asserts where the canonical `business-final` message is durably persisted, not only that provider dispatch receives formatted text or audit metadata.
