# Schedule Registration Policy Surface Cleanup Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-scheduled-workflow-execution.md#event-binding-and-execution`
**Created**: 2026-05-19
**Last Updated**: 2026-05-19

---

## Design Document Reference

**Source**: `design-docs/specs/design-scheduled-workflow-execution.md`

### Section Map

| Plan Area | Accepted Design Section |
| --------- | ----------------------- |
| Resolver input ownership | `design-docs/specs/design-scheduled-workflow-execution.md#schedule-registration-workflow` |
| Schedule-registration policy boundary | `design-docs/specs/design-scheduled-workflow-execution.md#event-binding-and-execution` |
| Validation rejection | `design-docs/specs/design-scheduled-workflow-execution.md#validation-rules` |
| Rollout constraints | `design-docs/specs/design-scheduled-workflow-execution.md#rollout-constraints` |
| Codex/backend boundary | `design-docs/specs/design-scheduled-workflow-execution.md#codex-reference-mapping` |

### Summary

Remove the duplicated schedule-registration path policy surface. The active
`EventWorkflowScheduleRegistrationPolicy` type must expose only
`resolverWorkflowName`, `resolverNodeId`, and optional `minConfidence` for
schedule-registration-specific configuration. Binding `inputMapping` remains the
only operator-authored mechanism for selecting resolver workflow input and
passing timezone-relevant event fields. Legacy broad JSON config that still sets
`execution.inputPath` or `execution.timezonePath` for
`execution.mode: "schedule-registration"` must fail validation with migration
guidance to `inputMapping`.

### Scope

**Included**:

- Remove `inputPath` and `timezonePath` from the active
  `EventWorkflowScheduleRegistrationPolicy` public TypeScript surface.
- Reject `execution.inputPath` and `execution.timezonePath` in
  schedule-registration validation, even when they are non-empty strings.
- Add focused validation test coverage for both rejected fields and preserve
  successful validation for the narrow policy plus binding `inputMapping`.
- Refresh user-facing docs, examples, and implementation-plan references so they
  no longer present `inputPath` or `timezonePath` as schedule-registration
  knobs.
- Record implementation progress in this plan and `impl-plans/PROGRESS.json`.

**Excluded**:

- Replacing or modifying event binding `inputMapping`.
- Changing due schedule execution or generated
  `{{event.input.workflowInput}}` mapping in
  `src/events/workflow-schedule-dispatch.ts`.
- Replacing `ScheduledEventManager`, cron helpers, event receipts, or
  `dispatchEventToMatchingBindings`.
- Changing unrelated `inputPath` fields for supervisor intent mapping, node
  mailboxes, workflow adapters, or non-schedule event execution policies.
- Adding Codex-agent or Cursor-specific schedule behavior.

### Issue Reference

- Workflow mode: `issue-resolution`
- Workflow ID: `design-and-implement-review-loop`
- Step 4 node: `step4-impl-plan-create`
- Issue source: `workflowInput.issueTitle/requestedBehavior`
- Issue title: Remove duplicated schedule-registration path policy surface
- Accepted Step 3 decision: no revision required; remove the active
  `inputPath`/`timezonePath` schedule-registration policy surface and reject
  legacy config with guidance to `inputMapping`.

### Codex And Backend Reference

- `../../codex-agent`: unavailable during Step 3 review.
- Verification command from Step 3:
  `test -d ../../codex-agent; printf '%s\n' $?` returned `1`.
- Decision: no codex-agent reference mapping is required because
  schedule-registration policy, event `inputMapping`, validation, and dispatch
  reuse are divedra runtime surfaces. `codex-agent` remains only an execution
  backend for workflow nodes.
- Intentional divergence: no schedule-registration policy behavior is copied
  from `codex-agent` or Cursor; provider behavior remains behind adapters.

---

## Modules

### 1. Public Schedule-Registration Policy Type

#### `packages/divedra-events/src/types.ts`

**Status**: COMPLETED

```typescript
export interface EventWorkflowScheduleRegistrationPolicy extends JsonObject {
  readonly mode: "schedule-registration";
  readonly resolverWorkflowName: string;
  readonly resolverNodeId: string;
  readonly minConfidence?: number;
}
```

**Checklist**:

- [x] Remove `inputPath` from `EventWorkflowScheduleRegistrationPolicy`.
- [x] Remove `timezonePath` from `EventWorkflowScheduleRegistrationPolicy`.
- [x] Preserve unrelated `inputPath` or `timezonePath` fields outside
      schedule-registration policy types.
- [x] Confirm downstream TypeScript call sites use `inputMapping` or raw JSON
      checks rather than schedule policy path fields.

### 2. Schedule-Registration Validation Rejection

#### `src/events/validate-schedule-registration.ts`
#### `src/events/config.test.ts`

**Status**: COMPLETED

```typescript
interface RejectedScheduleRegistrationPolicyField {
  readonly field: "inputPath" | "timezonePath";
  readonly message: string;
}

function validateScheduleRegistrationBinding(
  binding: EventBinding,
  workflowNames: ReadonlySet<string>,
  issues: EventConfigValidationIssue[],
): void;
```

**Checklist**:

- [x] Detect `execution.inputPath` on raw schedule-registration execution
      objects even after the public policy type no longer declares the field.
- [x] Detect `execution.timezonePath` on raw schedule-registration execution
      objects even after the public policy type no longer declares the field.
- [x] Emit validation errors that state schedule-registration uses binding
      `inputMapping` for resolver input and timezone-relevant values.
- [x] Preserve existing validation for `resolverWorkflowName`,
      `resolverNodeId`, and `minConfidence`.
- [x] Add negative tests for `inputPath` and `timezonePath` rejection.
- [x] Add or preserve a positive test for a narrow schedule-registration policy
      with binding `inputMapping`.

### 3. Documentation, Examples, And Existing Plan Cleanup

#### `README.md`
#### `examples/event-sources/README.md`
#### `examples/event-sources/.divedra-events/bindings/chat-sdk-slack-schedule-registration.json`
#### `impl-plans/active/scheduled-workflow-execution.md`
#### `impl-plans/active/schedule-registration-policy-surface-cleanup.md`
#### `impl-plans/PROGRESS.json`

**Status**: COMPLETED

```typescript
interface ScheduleRegistrationDocsAuditResult {
  readonly checkedPaths: readonly string[];
  readonly stalePolicyFieldsRemoved: boolean;
  readonly inputMappingDocumentedAsCanonical: boolean;
}
```

**Checklist**:

- [x] Remove stale active-policy examples that include `inputPath` or
      `timezonePath` for `execution.mode: "schedule-registration"`.
- [x] Keep docs clear that resolver input and timezone-relevant values come
      through binding `inputMapping`.
- [x] Verify the checked-in schedule-registration binding example uses
      `inputMapping` and does not add path policy fields.
- [x] Update the completed broad schedule plan only to remove or annotate stale
      policy snippets; do not rewrite its historical progress log.
- [x] Record implementation status and exact verification results.

### 4. Verification And Regression Sweep

#### `src/events/config.test.ts`
#### `src/events/workflow-schedule-registration.test.ts`
#### `src/events/workflow-schedule-dispatch.test.ts`
#### `src/events/workflow-schedule-registry.test.ts`

**Status**: COMPLETED

```typescript
interface ScheduleRegistrationPolicySurfaceVerification {
  readonly validationRejectsLegacyPathFields: boolean;
  readonly narrowPolicyTypeCompiles: boolean;
  readonly inputMappingDispatchPathUnchanged: boolean;
  readonly examplesValidate: boolean;
}
```

**Checklist**:

- [x] Run focused config validation tests for rejected legacy path fields.
- [x] Run schedule-registration, dispatch, and registry regression tests to
      prove existing runtime reuse remains intact.
- [x] Run typecheck after the public type removal.
- [x] Run example event validation with `--workflow-definition-dir ./examples`.
- [x] Run `rg` audits for schedule-registration `inputPath` and `timezonePath`
      references.

---

## Task Breakdown

| Task | Deliverables | Depends On | Parallelizable | Completion Criteria |
| ---- | ------------ | ---------- | -------------- | ------------------- |
| TASK-001 Public policy type cleanup | `packages/divedra-events/src/types.ts` | None | Yes | `EventWorkflowScheduleRegistrationPolicy` no longer exposes `inputPath` or `timezonePath`; unrelated path fields remain intact |
| TASK-002 Validation rejection and tests | `src/events/validate-schedule-registration.ts`, `src/events/config.test.ts` | None | Yes | Schedule-registration config with `execution.inputPath` or `execution.timezonePath` fails validation with `inputMapping` migration guidance |
| TASK-003 Docs, examples, and stale plan references | `README.md`, `examples/event-sources/README.md`, `examples/event-sources/.divedra-events/bindings/chat-sdk-slack-schedule-registration.json`, `impl-plans/active/scheduled-workflow-execution.md` | None | Yes | User-facing docs and examples present `inputMapping` as canonical and do not advertise path policy fields |
| TASK-004 Verification and progress tracking | `impl-plans/active/schedule-registration-policy-surface-cleanup.md`, `impl-plans/PROGRESS.json` | TASK-001, TASK-002, TASK-003 | No | Focused tests, regression tests, typecheck, example validation, and diff checks pass or record blockers |

## Module Status

| Module | File Path | Status | Tests |
| ------ | --------- | ------ | ----- |
| Public policy type cleanup | `packages/divedra-events/src/types.ts` | COMPLETED | `bun run typecheck` passed |
| Validation rejection | `src/events/validate-schedule-registration.ts` | COMPLETED | `src/events/config.test.ts` passed |
| Docs and examples cleanup | `README.md`, `examples/event-sources/README.md`, `examples/event-sources/.divedra-events/bindings/chat-sdk-slack-schedule-registration.json`, `impl-plans/active/scheduled-workflow-execution.md` | COMPLETED | `rg -n "inputPath|timezonePath|inputMapping|schedule-registration" ...` reviewed |
| Verification and progress | `impl-plans/active/schedule-registration-policy-surface-cleanup.md`, `impl-plans/PROGRESS.json` | COMPLETED | `jq empty impl-plans/PROGRESS.json` passed |

## Dependencies

| Feature | Depends On | Status |
| ------- | ---------- | ------ |
| Active policy removal | Accepted design Step 3 review | Available |
| Legacy field rejection | Raw JSON validation in `validateScheduleRegistrationBinding()` | Available |
| Canonical resolver input selection | Event binding `inputMapping` in `src/events/input-mapping.ts` and config validation | Available |
| Due workflow input reuse | Generated scheduler binding in `src/events/workflow-schedule-dispatch.ts` using `{{event.input.workflowInput}}` | Must remain unchanged |
| Schedule runtime reuse | `ScheduledEventManager`, cron helpers, event receipts, `dispatchEventToMatchingBindings` | Must remain unchanged |

## Parallelizable Tasks

TASK-001, TASK-002, and TASK-003 may run in parallel because their write scopes
are disjoint. TASK-004 is not parallelizable because it depends on all code and
documentation updates and owns the final progress records.

## Verification Plan

```bash
rg -n "EventWorkflowScheduleRegistrationPolicy|execution\\.inputPath|execution\\.timezonePath|inputMapping|schedule-registration" packages src README.md examples/event-sources design-docs/specs/design-scheduled-workflow-execution.md impl-plans/active
bun test src/events/config.test.ts
bun test src/events/workflow-schedule-registration.test.ts src/events/workflow-schedule-dispatch.test.ts src/events/workflow-schedule-registry.test.ts
bun run typecheck
bun run lint:biome
bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events
jq empty impl-plans/PROGRESS.json
git diff --check
```

## Completion Criteria

- [x] `packages/divedra-events/src/types.ts` removes
      `EventWorkflowScheduleRegistrationPolicy.inputPath`.
- [x] `packages/divedra-events/src/types.ts` removes
      `EventWorkflowScheduleRegistrationPolicy.timezonePath`.
- [x] Schedule-registration validation rejects legacy
      `execution.inputPath` with migration guidance to binding `inputMapping`.
- [x] Schedule-registration validation rejects legacy
      `execution.timezonePath` with migration guidance to binding `inputMapping`.
- [x] Narrow schedule-registration policy with `resolverWorkflowName`,
      `resolverNodeId`, optional `minConfidence`, and binding `inputMapping`
      still validates.
- [x] Due scheduled execution still uses generated event binding input mapping
      and does not gain a parallel path selector.
- [x] Documentation and examples no longer advertise path policy fields for
      schedule registration.
- [x] Focused tests, regression tests, typecheck, lint, example validation, JSON
      validation, and diff checks pass or have recorded blockers.

## Progress Log

### Session: 2026-05-19 00:00
**Tasks Completed**: Plan created.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Step 3 accepted the design. This plan scopes the later
implementation to removing the duplicated schedule-registration
`inputPath`/`timezonePath` policy surface, rejecting legacy config, refreshing
docs/examples, and preserving the existing `inputMapping`, scheduled manager,
cron, receipt, and dispatch reuse paths.

### Session: 2026-05-19 07:49 JST
**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Removed `inputPath` and `timezonePath` from
`EventWorkflowScheduleRegistrationPolicy`; changed schedule-registration
validation to reject raw `execution.inputPath` and `execution.timezonePath`
with migration guidance to binding `inputMapping`; added focused config tests
for valid narrow policy and both rejected legacy fields; refreshed README,
example docs, and the broader scheduled workflow implementation plan. Due
dispatch remains on the generated `{{event.input.workflowInput}}` binding path
and no `ScheduledEventManager`, cron helper, receipt, or
`dispatchEventToMatchingBindings` behavior was changed.
**Verification**: Passed `bun test src/events/config.test.ts`; passed
`bun test src/events/workflow-schedule-registration.test.ts
src/events/workflow-schedule-dispatch.test.ts
src/events/workflow-schedule-registry.test.ts`; passed `bun run typecheck`;
passed `bun run lint:biome` with pre-existing warnings in
`src/workflow/engine/*`; passed
`bun run src/main.ts events validate --workflow-definition-dir ./examples
--event-root ./examples/event-sources/.divedra-events`; passed
`jq empty impl-plans/PROGRESS.json`; passed `git diff --check`; reviewed
`rg -n "EventWorkflowScheduleRegistrationPolicy|execution\\.inputPath|execution\\.timezonePath|inputMapping|schedule-registration" packages src README.md examples/event-sources design-docs/specs/design-scheduled-workflow-execution.md impl-plans/active`.

## Related Plans

- **Previous**: `impl-plans/active/scheduled-workflow-execution.md` implemented
  the broader scheduled workflow execution feature and contains historical
  schedule-registration context.
- **Previous**: `impl-plans/active/schedule-registration-blocking-fixes.md`
  completed confidence and wall-clock validation fixes.
- **Previous**: `impl-plans/active/schedule-registration-safe-reply-gating.md`
  completed schedule-registration reply safety fixes.
- **Depends On**: `design-docs/specs/design-scheduled-workflow-execution.md`
  accepted Step 3 design review.
