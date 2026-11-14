# Auto Improve Supervision Review Follow-up

**Status**: Completed
**Design Reference**: `design-docs/specs/design-auto-improve-superviser-mode.md`, `design-docs/specs/architecture.md`, `design-docs/specs/command.md`
**Created**: 2026-04-25
**Last Updated**: 2026-04-25

## Summary

Follow-up review work for the phase-1 `--auto-improve` implementation.
This iteration focuses on correctness and quality gaps discovered after the
initial merge, not on the phase-2 nested superviser workflow.

## Scope

Included:

- keep the outer supervision retry loop active when operators `resume` or
  supervised-`rerun` a session with `autoImprove`
- centralize `autoImprove` policy defaults and validation to avoid invalid
  budgets / timings reaching the engine
- preserve supervision patch audit integrity by failing on malformed persisted
  patch-revision files instead of silently resetting history
- clear stale rerun selectors before follow-up supervised attempts and reject
  supervision-policy flags that would otherwise be ignored without
  `--auto-improve`
- add regression tests for the above

Excluded:

- phase-2 nested `superviserWorkflowId` execution
- new GraphQL control-plane mutations for supervision
- broader workflow runtime refactors outside the supervision path

## Modules

### TASK-001: Policy normalization and validation

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `src/workflow/auto-improve-policy.ts`
- `src/cli.ts`
- `src/workflow/engine.ts`

**Completion Criteria**:

- [x] Shared defaults exist for `AutoImprovePolicy`
- [x] Invalid intervals / budgets are rejected with deterministic messages
- [x] CLI and engine reuse the same policy normalization rules

### TASK-002: Resume/rerun supervision loop continuity

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `src/workflow/engine.ts`
- `src/workflow/engine.test.ts`

**Completion Criteria**:

- [x] `runWorkflow(..., { autoImprove, resumeSessionId })` continues using the outer supervision loop
- [x] `runWorkflow(..., { autoImprove, rerunFromSessionId })` continues using the outer supervision loop
- [x] regression coverage proves retries still happen after resume/rerun failures

### TASK-003: Patch-revision audit hardening

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `src/workflow/mutable-workspace.ts`
- `src/workflow/mutable-workspace.test.ts`

**Completion Criteria**:

- [x] malformed `patch-revisions.json` does not get silently discarded
- [x] read/write helpers return an error for corrupt persisted audit data
- [x] regression coverage protects the behavior

### TASK-004: Retry-target hygiene and CLI supervision-flag validation

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `src/workflow/engine.ts`
- `src/workflow/engine.test.ts`
- `src/cli.ts`
- `src/cli.test.ts`

**Completion Criteria**:

- [x] supervision follow-up attempts drop stale rerun selectors from the
      original entry request
- [x] step-addressed retry handoff uses `rerunFromStepId` for the next
      supervised attempt
- [x] CLI rejects supervision-policy flags when `--auto-improve` is not set

### TASK-005: CLI supervision string-flag hardening

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- `src/cli.ts`
- `src/cli.test.ts`

**Completion Criteria**:

- [x] CLI rejects `--superviser-workflow` when the value is missing
- [x] CLI rejects `--workflow-mutation-mode` when the value is missing
- [x] auto-improve CLI input typing is deduplicated instead of repeated inline

## Completion Criteria

- [x] policy validation, runtime behavior, and audit persistence fixes are implemented
- [x] targeted TypeScript tests pass
- [x] progress log documents the review findings and remediation

## Progress Log

### Session: 2026-04-25

**Tasks Completed**: TASK-001, TASK-002, TASK-003.

**Notes**:

- Review found that supervised `resume` / `rerun` currently bypass the outer
  retry loop even when the session already carries supervision state.
- Review also found that patch revision audit history can be silently reset when
  `patch-revisions.json` is corrupt or unreadable.
- Policy defaults and numeric validation are duplicated / implicit and should be
  centralized before more surfaces rely on them.
- Implemented `src/workflow/auto-improve-policy.ts` so CLI parsing and engine
  entry validation share the same defaults and positive-integer checks.
- Fixed the retry-loop handoff bug where a failed supervised `resume` still
  carried `resumeSessionId` into the next rerun attempt, which prevented
  supervision state from being reattached.
- Hardened `mutable-workspace.ts` to reject malformed persisted
  `patch-revisions.json` data instead of silently replacing the audit trail.
- Verified with `bun run typecheck:server` and
  `bun test src/workflow/engine.test.ts src/workflow/mutable-workspace.test.ts src/cli.test.ts`.

### Session: 2026-04-25

**Tasks Completed**: TASK-004.

**Notes**:

- Review found that follow-up supervised reruns could still inherit stale
  `rerunFromStepId` / `rerunFromNodeId` fields from the original entry request,
  which could override the remediation-selected retry target.
- Review also found that supervision-policy CLI flags such as
  `--monitor-interval-ms` were accepted without `--auto-improve` and then
  ignored silently.
- Updated the retry-loop handoff so each new supervised attempt clears previous
  rerun selectors and uses `rerunFromStepId` for step-addressed retry targets.
- Added CLI validation to reject supervision-policy flags unless
  `--auto-improve` is enabled.
- Verified with `bun run typecheck:server`,
  `bun test src/workflow/engine.test.ts -t "preserves supervision state on rerun when autoImprove and source session were supervised|keeps the auto-improve retry loop active on supervised rerun|clears stale rerun targets before the next supervised attempt|keeps the auto-improve retry loop active on resume|rejects invalid auto-improve policies before workflow execution starts"`,
  and targeted `src/cli.test.ts` coverage for invalid / missing `--auto-improve`
  supervision-policy flags.

### Session: 2026-04-25

**Tasks Completed**: TASK-005.

**Notes**:

- Review found that the numeric supervision flags now fail correctly, but the
  string-valued supervision flags still accepted missing values and then fell
  back to defaults silently.
- Hardened `src/cli.ts` so `--superviser-workflow` and
  `--workflow-mutation-mode` report deterministic parse errors when values are
  missing.
- Reduced repeated inline `autoImprove` CLI input typing by introducing a
  shared local `AutoImproveCliInputs` type alias.
- Verified with `bun run typecheck:server` and
  `bun test src/cli.test.ts -t "workflow run rejects --superviser-workflow without a value|workflow run rejects --workflow-mutation-mode without a value"`.

### Session: 2026-04-25

**Tasks Completed**: Additional follow-up review fix.

**Notes**:

- Review found that updating `autoImprove.superviserWorkflowId` on a supervised
  `resume` refreshed `session.supervision.policy` but left the top-level
  `session.supervision.superviserWorkflowId` field stale, which would surface
  incorrect inspection data until phase-2 nested superviser execution lands.
- Updated `cloneSupervisionForContinuedRun` in `src/workflow/engine.ts` so the
  persisted supervision state keeps the effective superviser workflow id aligned
  with the latest policy override while preserving the existing supervision run.
- Extended the resume regression in `src/workflow/engine.test.ts` to assert the
  refreshed superviser workflow id on both the in-memory result and the
  persisted session record.

### Session: 2026-04-25

**Tasks Completed**: Additional CLI parser hardening review fix.

**Notes**:

- Review found that the new `--auto-improve` flag validation was deterministic,
  but many other required string-valued CLI options still accepted missing
  values and then failed later with misleading runtime errors.
- Hardened `src/cli.ts` so representative required string options now fail
  during argument parsing instead of falling through to unrelated workflow or
  transport errors.
- Added regression coverage in `src/cli.test.ts` for missing
  `--workflow-root`, `--endpoint`, and `--message-file` values.

### Session: 2026-04-25

**Tasks Completed**: Additional CLI parser follow-up review fix.

**Notes**:

- Review found that the new deterministic parse errors still allowed the parser
  to continue scanning later flags, which meant a second invalid flag could
  overwrite the first and surface the wrong operator-facing error.
- Updated `src/cli.ts` to stop parsing after the first flag-level error.
- Added a regression in `src/cli.test.ts` covering
  `--superviser-workflow` missing its value before a later invalid
  `--workflow-mutation-mode`.

### Session: 2026-04-25

**Tasks Completed**: Additional CLI supervision-flag ordering review fix.

**Notes**:

- Review found that the new `--auto-improve` gatekeeping still chose the
  offending flag from a hard-coded priority list, not from the first
  supervision-policy flag in the operator's actual argv order.
- Updated `src/cli.ts` to record the first encountered supervision-policy flag
  during parsing and reuse that exact token when `--auto-improve` is missing.
- Added a regression in `src/cli.test.ts` proving
  `--workflow-mutation-mode execution-copy --monitor-interval-ms 1000`
  reports `--workflow-mutation-mode requires --auto-improve` instead of the
  later monitor-interval flag.

### Session: 2026-04-25

**Tasks Completed**: Additional shared-policy validation review fix.

**Notes**:

- Review found that the new CLI hardening prevented silently ignored
  supervision-policy flags, but the shared
  `src/workflow/auto-improve-policy.ts` helper still accepted
  `{ enabled: false, ...extraFields }` from untyped library or transport
  callers and quietly downgraded the payload to `undefined`.
- Hardened the shared normalizer so disabled auto-improve payloads now reject
  additional supervision settings unless `enabled` is `true`.
- Added regression coverage in `src/workflow/auto-improve-policy.test.ts` for
  the disabled-plus-overrides case.
- Follow-up validation exposed that `src/cli.ts` was still synthesizing
  `allowTargetedRerun: true` for commands that never opted into
  `--auto-improve`, so the CLI builder was updated to omit that field unless
  the operator explicitly disables targeted reruns.
- Added a focused `src/cli.test.ts` regression proving normal commands such as
  `workflow create` no longer trip the shared auto-improve validator.
