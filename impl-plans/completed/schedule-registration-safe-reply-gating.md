# Schedule Registration Safe Reply Gating Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-scheduled-workflow-execution.md#schedule-registration-safety-contract`
**Created**: 2026-05-18
**Last Updated**: 2026-05-18

---

## Design Document Reference

**Source**: `design-docs/specs/design-scheduled-workflow-execution.md`

### Section Map

| Plan Area | Accepted Design Section |
| --------- | ----------------------- |
| Runtime flow | `design-docs/specs/design-scheduled-workflow-execution.md#runtime-flow` |
| Chat reply lifecycle | `design-docs/specs/design-scheduled-workflow-execution.md#chat-replies` |
| Safe reply gating | `design-docs/specs/design-scheduled-workflow-execution.md#schedule-registration-safety-contract` |
| Backend boundary | `design-docs/specs/design-scheduled-workflow-execution.md#codex-reference-mapping` |
| Verification | `design-docs/specs/design-scheduled-workflow-execution.md#verification-commands` |

### Summary

Resolve the blocking recent-change finding that schedule-registration dispatch can
send progress, clarification, or refusal chat replies even when the binding has no
safe reply destination. The implementation must compute the safe reply decision
once per schedule-registration dispatch attempt and use that exact decision to
gate every schedule-registration chat reply path.

### Scope

**Included**:

- `src/events/trigger-runner/trigger-dispatch-runner.ts` safe reply decision
  reuse for schedule-registration dispatch.
- Suppression of received progress, resolver clarification, runtime
  clarification, refusal, and confirmation replies when no safe destination
  exists.
- Focused regression coverage in `src/events/workflow-schedule-dispatch.test.ts`
  proving an unsafe schedule-registration binding with no `outputDestinations`
  does not call `eventReplyDispatcher.dispatchChatReply`.
- Progress updates in this implementation plan and `impl-plans/PROGRESS.json`
  after implementation and verification.

**Excluded**:

- The non-blocking low finding in `packages/divedra-events/src/types.ts:299`
  about `inputPath` and `timezonePath`.
- Broad event reply dispatcher, chat adapter, schedule registry, CLI, or docs
  refactors.
- Scheduling semantics from `codex-agent` or `cursor-cli-agent`.

### Issue Reference

- Workflow mode: `issue-resolution`
- Source workflow: `recent-change-quality-loop`
- Source execution: `div-recent-change-quality-loop-1779108345-5465b0c0`
- Source node: `step3-handoff`
- Source step 1 execution: `exec-000006`
- Source step 2 execution: `exec-000007`
- Blocking finding:
  - `src/events/trigger-runner/trigger-dispatch-runner.ts:195`: unsafe
    schedule-registration refusals still dispatch chat replies when
    `hasSafeReplyDestination` is false.

### Codex And Backend Reference

- `codex-agent` is a backend/workflow-authoring reference only.
- Accepted Step 3 review decision: no `codex-agent` inspection is required for
  this issue because schedule-registration reply safety is divedra runtime-owned.
- Intentional divergence: no schedule-registration reply gating behavior is
  copied from `codex-agent`; provider-specific behavior stays behind existing
  adapter modules.

---

## Modules

### 1. Schedule Registration Dispatch Reply Safety

#### `src/events/trigger-runner/trigger-dispatch-runner.ts`

**Status**: COMPLETED

```typescript
interface ScheduleRegistrationReplySafety {
  readonly hasSafeReplyDestination: boolean;
}

interface ScheduleRegistrationDispatchInput {
  readonly binding: WorkflowTriggerDispatchInput["binding"];
  readonly event: ExternalEventEnvelope;
  readonly receipt: WorkflowTriggerResult["receipt"];
  readonly artifactDir: string;
  readonly mapping: ReturnType<typeof mapEventToWorkflowInput>;
  readonly receiptStore: EventReceiptStore;
  readonly repository: WorkflowScheduleRepository;
  readonly options: WorkflowTriggerRunnerOptions;
  readonly replySafety: ScheduleRegistrationReplySafety;
}
```

**Checklist**:

- [x] Compute schedule-registration reply safety once before the received
      progress reply can be sent.
- [x] Pass the same safety decision into schedule-registration validation and
      reply dispatch handling.
- [x] Suppress the schedule-registration received progress reply when
      `hasSafeReplyDestination` is false.
- [x] Preserve receipt begin/update behavior when replies are suppressed.

### 2. Schedule Registration Outcome Reply Gating

#### `src/events/trigger-runner/trigger-dispatch-runner.ts`

**Status**: COMPLETED

```typescript
type ScheduleRegistrationReplyOutcome =
  | { readonly status: "needs-clarification"; readonly replyKind: "clarification" }
  | { readonly status: "refused"; readonly replyKind: "clarification" }
  | { readonly status: "ready"; readonly replyKind: "plan-or-question" };
```

**Checklist**:

- [x] Gate resolver clarification replies with the shared safe reply decision.
- [x] Gate runtime clarification replies with the shared safe reply decision.
- [x] Gate refusal replies with the shared safe reply decision.
- [x] Gate confirmation replies with the shared safe reply decision.
- [x] Keep skipped/refused receipt outcomes and dispatch payloads unchanged when
      replies are suppressed.
- [x] Keep valid schedule confirmations unchanged when a conversation id,
      `eventReplyDispatcher`, and `outputDestinations` are present.

### 3. Regression Tests And Progress Tracking

#### `src/events/workflow-schedule-dispatch.test.ts`
#### `impl-plans/active/schedule-registration-safe-reply-gating.md`
#### `impl-plans/PROGRESS.json`

**Status**: COMPLETED

```typescript
interface UnsafeScheduleReplyRegressionCase {
  readonly outputDestinations?: readonly string[];
  readonly hasEventReplyDispatcher: boolean;
  readonly resolverStatus: "needs-clarification" | "refused" | "ready";
  readonly expectedReplyCalls: number;
  readonly expectedReceiptStatus: "skipped" | "dispatched";
}
```

**Checklist**:

- [x] Add a focused regression test with no `outputDestinations` and an
      `eventReplyDispatcher`; assert `dispatchChatReply` is not called.
- [x] Cover the refused or clarification path that reproduced two unsafe reply
      calls before this plan.
- [x] Preserve existing happy-path schedule-registration test coverage with safe
      output destinations.
- [x] Record implementation progress and exact verification command outcomes.

---

## Task Breakdown

| Task | Deliverables | Depends On | Parallelizable | Completion Criteria |
| ---- | ------------ | ---------- | -------------- | ------------------- |
| TASK-001 Safe reply decision plumbing | `src/events/trigger-runner/trigger-dispatch-runner.ts` | None | No | One schedule-registration safe reply decision is computed before any schedule-registration reply can be dispatched and reused for validation |
| TASK-002 Outcome reply suppression | `src/events/trigger-runner/trigger-dispatch-runner.ts` | TASK-001 | No | Clarification, refusal, and confirmation replies are skipped when the shared decision is unsafe while receipt outcomes remain unchanged |
| TASK-003 Regression coverage and progress | `src/events/workflow-schedule-dispatch.test.ts`, `impl-plans/active/schedule-registration-safe-reply-gating.md`, `impl-plans/PROGRESS.json` | TASK-001, TASK-002 | No | Unsafe no-output-destination schedule-registration test proves `dispatchChatReply` is not called; progress records verification |

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Safe reply decision plumbing | `src/events/trigger-runner/trigger-dispatch-runner.ts` | COMPLETED | `src/events/workflow-schedule-dispatch.test.ts` |
| Outcome reply suppression | `src/events/trigger-runner/trigger-dispatch-runner.ts` | COMPLETED | `src/events/workflow-schedule-dispatch.test.ts` |
| Dispatch regression coverage | `src/events/workflow-schedule-dispatch.test.ts` | COMPLETED | `bun test src/events/workflow-schedule-dispatch.test.ts` |
| Progress tracking | `impl-plans/active/schedule-registration-safe-reply-gating.md`, `impl-plans/PROGRESS.json` | COMPLETED | `jq empty impl-plans/PROGRESS.json` |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Safe reply detection | `hasSafeScheduleReplyDestination()` in `src/events/trigger-runner/trigger-dispatch-runner.ts` | Available |
| Reply dispatch helper | `dispatchEventTaskPlanningReplyIfConfigured()` | Available |
| Received progress helper | `dispatchEventProgressReplyIfConfigured()` | Available |
| Schedule registration validation | `createWorkflowScheduleRegistrationValidator().validate()` | Available |
| Focused test harness | Existing `workflow schedule dispatch` tests and mock resolver workflow scenario | Available |

## Parallelizable Tasks

No tasks are parallelizable in this plan. The implementation tasks share
`src/events/trigger-runner/trigger-dispatch-runner.ts`, and the regression test
depends on the final gating shape to avoid encoding an intermediate API.

## Verification Plan

```bash
bun test src/events/workflow-schedule-dispatch.test.ts
bun test src/events/workflow-schedule-registration.test.ts src/events/workflow-schedule-dispatch.test.ts src/events/workflow-schedule-registry.test.ts
bun run typecheck
bun run lint:biome
git diff --check
```

After the delegated fix lands, rerun the parent review workflow with
`runtimeVariables.hours=24`.

## Completion Criteria

- [x] `src/events/trigger-runner/trigger-dispatch-runner.ts:195` no longer sends
      schedule-registration replies when the binding has no safe reply
      destination.
- [x] A single safe reply decision gates received progress, clarification,
      refusal, and confirmation replies for schedule-registration dispatch.
- [x] Unsafe clarification or refusal still marks the receipt skipped and records
      the validator decision.
- [x] Successful schedule creation still persists/enqueues schedules even when no
      chat reply can be delivered.
- [x] Valid schedule-registration bindings with safe output destinations still
      dispatch the expected confirmation reply.
- [x] Focused regression test asserts no `dispatchChatReply` call for no
      `outputDestinations` plus `eventReplyDispatcher`.
- [x] Targeted tests, typecheck, lint, and `git diff --check` are recorded in the
      progress log.

## Progress Log

### Session: 2026-05-18
**Tasks Completed**: Plan created after Step 3 accepted the design.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Scope is limited to the blocking recent-change finding in
`src/events/trigger-runner/trigger-dispatch-runner.ts:195`. The low
`inputPath`/`timezonePath` finding is explicitly out of scope.

### Session: 2026-05-18 Step 6 Implementation
**Tasks Completed**: TASK-001, TASK-002, TASK-003.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented one schedule-registration reply-safety decision in
`src/events/trigger-runner/trigger-dispatch-runner.ts`, reused it for validator
input and all schedule-registration reply dispatch branches, and gated received
progress before schedule-registration execution. Added
`src/events/workflow-schedule-dispatch.test.ts` coverage for unsafe refusal with
no `outputDestinations`, unsafe successful schedule creation without
confirmation replies, and safe output-destination reply dispatch.
**Verification**:

- `biome format --write src/events/trigger-runner/trigger-dispatch-runner.ts src/events/workflow-schedule-dispatch.test.ts` - passed.
- `bun test src/events/workflow-schedule-dispatch.test.ts` - passed, 10 tests.
- `bun test src/events/workflow-schedule-registration.test.ts src/events/workflow-schedule-dispatch.test.ts src/events/workflow-schedule-registry.test.ts` - passed, 21 tests.
- `bun run typecheck` - passed.
- `bun run lint:biome` - passed with 61 pre-existing unrelated warnings in `src/workflow/engine/*`.
- `git diff --check` - passed.

## Related Plans

- **Previous**: `impl-plans/active/schedule-registration-blocking-fixes.md`
  completed earlier validation fixes for schedule-registration confidence and
  timezone handling.
- **Depends On**: `design-docs/specs/design-scheduled-workflow-execution.md`
  accepted schedule-registration safety contract.
