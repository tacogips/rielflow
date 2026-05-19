# Schedule Registration Blocking Fixes Implementation Plan

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
| Trust boundary | `design-docs/specs/design-scheduled-workflow-execution.md#schedule-registration-safety-contract` |
| Validation failures | `design-docs/specs/design-scheduled-workflow-execution.md#validation-rules` |
| Codex/backend boundary | `design-docs/specs/design-scheduled-workflow-execution.md#codex-reference-mapping` |
| Verification | `design-docs/specs/design-scheduled-workflow-execution.md#verification-commands` |

### Summary

Fix two recent-change review blockers in schedule-registration validation:
missing resolver confidence must not satisfy a configured `minConfidence`, and
offset-less one-time `dueAt` values must resolve through the selected IANA
timezone instead of host-local `Date` parsing.

### Scope

**Included**:

- `src/events/workflow-schedule-registration.ts` confidence threshold handling.
- `src/events/workflow-schedule-registration.ts` one-time `dueAt` normalization.
- Focused tests in `src/events/workflow-schedule-registration.test.ts`.
- Progress log update in the active scheduled-workflow plan if implementation
  lands code changes there.

**Excluded**:

- Non-blocking low findings from the recent-change handoff.
- Broad schedule registry, due dispatch, CLI, or documentation refactors.
- Provider-specific schedule parsing in `codex-agent`, `cursor-cli-agent`, or
  chat adapters.

### Issue Reference

- Source workflow: `recent-change-quality-loop`
- Source execution: `div-recent-change-quality-loop-1779108345-5465b0c0`
- Source node: `step3-handoff`
- Workflow mode: `issue-resolution`
- Blocking findings:
  - `src/events/workflow-schedule-registration.ts:277`: `minConfidence` is
    bypassed when resolver `confidence` is missing.
  - `src/events/workflow-schedule-registration.ts:321`: offset-less one-time
    `dueAt` is parsed with host-local timezone semantics.

### Codex And Backend Reference

- `codex-agent` is an execution backend reference only.
- `../../codex-agent` was unavailable during design review:
  `test -d ../../codex-agent` returned exit `1`.
- Intentional divergence: no scheduling semantics are imported from
  `codex-agent` or `cursor-cli-agent`; validation remains divedra runtime-owned.

---

## Modules

### 1. Schedule Registration Validator

#### `src/events/workflow-schedule-registration.ts`

**Status**: COMPLETED

```typescript
interface WorkflowScheduleRegistrationValidationInput extends DivedraOptions {
  readonly output: unknown;
  readonly minConfidence?: number;
  readonly hasSafeReplyDestination: boolean;
  readonly now?: Date;
}

type WorkflowScheduleRegistrationValidationResult =
  | {
      readonly status: "ready";
      readonly decision: WorkflowScheduleReadyDecision;
      readonly nextDueAt: string;
      readonly workflowSource?: WorkflowScheduleRecord["workflowSource"];
    }
  | {
      readonly status: "needs-clarification";
      readonly decision: WorkflowScheduleClarificationDecision;
    }
  | {
      readonly status: "refused";
      readonly decision: WorkflowScheduleRefusalDecision;
    };

interface OneTimeDueAtResolutionInput {
  readonly dueAt: string;
  readonly timezone: string;
  readonly hasSafeReplyDestination: boolean;
}

type OneTimeDueAtResolutionResult =
  | { readonly status: "ready"; readonly nextDueAt: string }
  | {
      readonly status: "needs-clarification";
      readonly decision: WorkflowScheduleClarificationDecision;
    }
  | {
      readonly status: "refused";
      readonly decision: WorkflowScheduleRefusalDecision;
    };

interface WorkflowScheduleRegistrationValidator {
  validate(
    input: WorkflowScheduleRegistrationValidationInput,
  ): Promise<WorkflowScheduleRegistrationValidationResult>;
}
```

**Checklist**:

- [x] Treat missing `decision.confidence` as failing when `input.minConfidence`
      is configured.
- [x] Keep existing ready behavior unchanged when `input.minConfidence` is unset.
- [x] Preserve explicit `Z` and numeric-offset `dueAt` instants unchanged.
- [x] Resolve offset-less one-time wall-clock `dueAt` through
      `decision.schedule.timezone`.
- [x] Clarify when wall-clock `dueAt` is invalid, ambiguous, or unresolvable and
      `hasSafeReplyDestination` is true.
- [x] Refuse instead of clarifying when no safe reply destination exists.

### 2. Focused Regression Tests

#### `src/events/workflow-schedule-registration.test.ts`

**Status**: COMPLETED

```typescript
interface ScheduleRegistrationRegressionCase {
  readonly name: string;
  readonly minConfidence?: number;
  readonly hasSafeReplyDestination: boolean;
  readonly dueAt?: string;
  readonly timezone?: string;
  readonly expectedStatus: "ready" | "needs-clarification" | "refused";
  readonly expectedNextDueAt?: string;
}
```

**Checklist**:

- [x] Add coverage for missing `confidence` with `minConfidence` configured and
      safe reply available.
- [x] Add coverage for missing `confidence` with `minConfidence` configured and
      no safe reply destination.
- [x] Add coverage for below-threshold `confidence` to preserve existing behavior.
- [x] Add coverage for offset-less `dueAt` in a non-UTC IANA timezone.
- [x] Add coverage proving explicit `Z` and numeric-offset `dueAt` values keep
      their represented instant unchanged.
- [x] Add coverage for invalid or ambiguous wall-clock `dueAt` if helper behavior
      can identify it in the first slice.

### 3. Plan And Progress Update

#### `impl-plans/active/scheduled-workflow-execution.md`
#### `impl-plans/active/schedule-registration-blocking-fixes.md`
#### `impl-plans/PROGRESS.json`

**Status**: COMPLETED

```typescript
interface ImplementationProgressEntry {
  readonly taskId: "TASK-001" | "TASK-002" | "TASK-003";
  readonly status: "Not Started" | "In Progress" | "Completed";
  readonly verificationCommands: readonly string[];
  readonly notes: string;
}
```

**Checklist**:

- [x] Record implementation progress after code changes land.
- [x] Mark task completion only after targeted tests and typecheck pass.
- [x] Preserve the existing completed feature history in
      `impl-plans/active/scheduled-workflow-execution.md`.

---

## Task Breakdown

| Task | Deliverables | Depends On | Parallelizable | Completion Criteria |
| ---- | ------------ | ---------- | -------------- | ------------------- |
| TASK-001 Confidence threshold enforcement | `src/events/workflow-schedule-registration.ts` | None | No | Missing or below-threshold confidence clarifies/refuses when `minConfidence` is configured; unset `minConfidence` remains compatible |
| TASK-002 One-time dueAt timezone normalization | `src/events/workflow-schedule-registration.ts` | TASK-001 | No | Offset-less `dueAt` resolves through `schedule.timezone`; explicit `Z`/offset instants are unchanged |
| TASK-003 Regression tests and progress log | `src/events/workflow-schedule-registration.test.ts`, `impl-plans/active/*.md`, `impl-plans/PROGRESS.json` | TASK-001, TASK-002 | No | Focused tests cover both findings and plan progress records exact verification |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Confidence clarification/refusal | Existing `clarification()` and `refusal()` helpers | Available |
| Safe reply gating | `WorkflowScheduleRegistrationValidationInput.hasSafeReplyDestination` | Available |
| Workflow usage catalog | `src/workflow/usage.ts` | Available |
| Timezone validation | `isValidTimeZone()` in `src/events/adapters/cron.ts` | Available |
| Host-independent wall-clock conversion | Existing `Intl.DateTimeFormat` timezone patterns in `src/events/adapters/cron.ts` | Available |

## Parallelizable Tasks

No tasks are parallelizable in this plan because both code fixes share
`src/events/workflow-schedule-registration.ts` and the focused test updates
share `src/events/workflow-schedule-registration.test.ts`.

## Verification Plan

```bash
bun run typecheck
bun test src/events/workflow-schedule-registration.test.ts
bun test src/events/workflow-schedule-registration.test.ts src/events/workflow-schedule-dispatch.test.ts src/events/workflow-schedule-registry.test.ts
bun run lint:biome
bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events
git diff --check
```

## Completion Criteria

- [x] `src/events/workflow-schedule-registration.ts:277` finding is fixed:
      configured `minConfidence` requires numeric `decision.confidence`.
- [x] Missing confidence with safe reply returns `needs-clarification`.
- [x] Missing confidence without safe reply returns `refused`.
- [x] Below-threshold confidence remains blocked.
- [x] `src/events/workflow-schedule-registration.ts:321` finding is fixed:
      offset-less one-time `dueAt` is not parsed with host-local semantics.
- [x] Explicit `Z` and numeric-offset one-time `dueAt` values preserve their
      represented instant.
- [x] Targeted tests and typecheck pass.
- [x] Progress log records implementation commands and pass/fail status.

## Progress Log

### Session: 2026-05-18 22:35
**Tasks Completed**: Plan created.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Step 3 accepted the design. This focused plan scopes implementation
to the two mid-severity recent-change blockers and excludes unrelated low
findings.

### Session: 2026-05-18 22:50
**Tasks Completed**: TASK-001, TASK-002, TASK-003.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Implemented configured `minConfidence` enforcement for missing
resolver confidence, host-independent offset-less one-time `dueAt` resolution
through `decision.schedule.timezone`, explicit `Z`/numeric-offset preservation,
and invalid or ambiguous wall-clock clarification/refusal behavior. Added
focused regression tests for both recent-change blocking findings. Verification
passed: `biome format --write src/events/workflow-schedule-registration.ts src/events/workflow-schedule-registration.test.ts`; `bun test src/events/workflow-schedule-registration.test.ts`; `bun run typecheck`; `bun test src/events/workflow-schedule-registration.test.ts src/events/workflow-schedule-dispatch.test.ts src/events/workflow-schedule-registry.test.ts`; `bun run lint:biome` with only pre-existing warnings in `src/workflow/engine/*`; `bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events`; `git diff --check`.

## Progress Log Expectations

- Update this log after the implementation session.
- Keep task status aligned with `impl-plans/PROGRESS.json`.
- Record exact verification commands and pass/fail status.
- Do not move this plan to `impl-plans/completed/` until all completion
  criteria are checked.

## Related Plans

- **Parent Feature Plan**: `impl-plans/active/scheduled-workflow-execution.md`
- **Depends On**: accepted design in
  `design-docs/specs/design-scheduled-workflow-execution.md`
