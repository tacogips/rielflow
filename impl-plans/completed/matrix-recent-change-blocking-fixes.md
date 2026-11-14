# Matrix Recent Change Blocking Fixes Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-event-listener-workflow-trigger.md#checked-in-matrix-sample-and-local-synapse-verification`
**Created**: 2026-05-13
**Last Updated**: 2026-05-13

---

## Design Document Reference

**Sources**:

- `design-docs/specs/design-event-listener-workflow-trigger.md#element--matrix`
- `design-docs/specs/design-event-listener-workflow-trigger.md#checked-in-matrix-sample-and-local-synapse-verification`
- `design-docs/specs/design-event-listener-workflow-trigger.md#binding`
- `design-docs/user-qa/qa-matrix-event-source.md`

### Summary

Resolve the three mid-severity recent-change review findings for Matrix
event-source work while preserving the verified local Synapse receive/send path.
The fixes are limited to binding alignment, implementation-plan index metadata,
and sanitized Matrix `/sync` diagnostics.

### Scope

**Included**: Matrix sample binding target correction, sample expectations and
docs reconciliation, completed-plan metadata path correction, sanitized
non-abort `/sync` diagnostics, and focused regression verification.

**Excluded**: new Matrix protocol capabilities, encrypted room support,
application-service transactions, public Matrix homeserver verification, and
large refactors outside the reviewed Matrix event-source surface.

### Issue Reference

- **Title**: Resolve blocking Matrix event-source recent-change review findings
- **URL**: Not provided
- **Repository**: Not provided
- **Issue Number**: Not provided
- **Workflow Mode**: issue-resolution

### Codex Agent Reference Mapping

No codex-agent reference repository paths were provided for this issue-resolution
run. The implementation should follow repository-local Matrix adapter, event
binding, and implementation-plan index behavior. Intentional divergence: no
external codex-agent behavior is copied or used as a compatibility target.

---

## Task Breakdown

### TASK-001: Align Matrix Sample Binding Target

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `examples/event-sources/.divedra-events/bindings/matrix-release-chat-to-workflow.json`, `examples/matrix-chat-reply/EXPECTED_RESULTS.md`, `examples/matrix-chat-reply/README.md`, `examples/event-sources/README.md`, `src/events/matrix-chat-reply-example.test.ts`
**Dependencies**: None

```typescript
interface EventBindingConfig {
  readonly id: string;
  readonly sourceId: string;
  readonly outputDestinations?: readonly string[];
  readonly workflowName: string;
  readonly inputMapping: EventInputMappingConfig;
}
```

**Description**:
Ensure the checked-in `matrix-release-chat-to-workflow` binding dispatches
`workflowName: "matrix-chat-reply"` and that all sample docs, expected results,
and mocked sample assertions name the same workflow.

**Completion Criteria**:

- [x] Binding JSON uses `workflowName: "matrix-chat-reply"`.
- [x] Sample README and expected-results text do not reference the wrong `chat-reply-webhook` workflow.
- [x] `src/events/matrix-chat-reply-example.test.ts` asserts the Matrix sample dispatches `matrix-chat-reply`.
- [x] `bun run src/main.ts workflow validate matrix-chat-reply --workflow-definition-dir ./examples` passes.
- [x] `bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events` passes.

### TASK-002: Correct Completed Matrix Plan Metadata

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `impl-plans/PROGRESS.json`, `impl-plans/README.md`
**Dependencies**: None

```typescript
interface ImplementationPlanProgressEntry {
  readonly phase: number;
  readonly status: "Ready" | "In Progress" | "Completed";
  readonly path?: string;
  readonly tasks: Record<string, ImplementationPlanTaskProgress>;
}

interface ImplementationPlanTaskProgress {
  readonly status: "Not Started" | "In Progress" | "Completed";
  readonly parallelizable: boolean;
  readonly deps: readonly string[];
}
```

**Description**:
Mark `matrix-event-source` and `matrix-send-receive-synapse-sample` as completed
in implementation-plan indexes and point their paths at
`impl-plans/completed/`.

**Completion Criteria**:

- [x] `impl-plans/PROGRESS.json` marks both existing Matrix plans as `Completed`.
- [x] `impl-plans/PROGRESS.json` points both existing Matrix plan paths under `impl-plans/completed/`.
- [x] All tasks inside those two existing plan entries are marked `Completed`.
- [x] `impl-plans/README.md` moves `matrix-send-receive-synapse-sample` out of Active Plans and lists it under Recently Completed or Completed Plans.
- [x] `impl-plans/README.md` keeps `matrix-event-source` under completed listings only.

### TASK-003: Emit Sanitized Matrix Sync Diagnostics

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/events/adapters/matrix.ts`, `src/events/adapters/matrix.test.ts`
**Dependencies**: None

```typescript
interface MatrixSyncDiagnostic {
  readonly sourceId: string;
  readonly httpStatus?: number;
  readonly errorClass: string;
}

type MatrixSyncDiagnosticSink = (diagnostic: MatrixSyncDiagnostic) => void;

function sanitizeMatrixSyncFailureDiagnostic(input: {
  readonly sourceId: string;
  readonly status?: number;
  readonly error: unknown;
}): MatrixSyncDiagnostic;
```

**Description**:
Make every non-abort Matrix `/sync` poll failure emit a sanitized diagnostic
before bounded retry behavior continues. Diagnostics must expose source id, HTTP
status when available, and normalized error class only.

**Completion Criteria**:

- [x] Non-abort `/sync` failures no longer disappear into silent retry loops.
- [x] Diagnostics include Matrix source id.
- [x] Diagnostics include HTTP status when available.
- [x] Diagnostics include a normalized error class.
- [x] Diagnostics do not include access tokens, authorization headers, full sensitive URLs, or raw provider bodies.
- [x] `src/events/adapters/matrix.test.ts` covers rejected `/sync` without leaking sensitive values.

### TASK-004: Verification And Re-Review Readiness

**Status**: Completed
**Parallelizable**: No
**Deliverables**: verification command results, progress log update, review handoff notes
**Dependencies**: TASK-001, TASK-002, TASK-003

**Description**:
Run the focused Matrix/event-source verification set and record any residual
warnings before Step 5 implementation review.

**Completion Criteria**:

- [x] Targeted Matrix/event tests pass.
- [x] Workflow validation for `matrix-chat-reply` passes.
- [x] Event config validation for examples passes.
- [x] Local Synapse script syntax check passes.
- [x] Live local Synapse receive/send harness is run or explicitly reported as not run with reason.
- [x] Typecheck passes.
- [x] Biome lint is run and any pre-existing warnings are reported separately from new failures.
- [x] Full `bun run test` is run or explicitly reported as not run with reason.

---

## Module Status

| Module                  | File Path                                                                                                                    | Status    | Tests                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------- |
| Matrix sample binding   | `examples/event-sources/.divedra-events/bindings/matrix-release-chat-to-workflow.json`                                       | COMPLETED | `src/events/matrix-chat-reply-example.test.ts` |
| Sample documentation    | `examples/matrix-chat-reply/README.md`, `examples/matrix-chat-reply/EXPECTED_RESULTS.md`, `examples/event-sources/README.md` | COMPLETED | workflow and event validation commands         |
| Plan metadata           | `impl-plans/PROGRESS.json`, `impl-plans/README.md`                                                                           | COMPLETED | index inspection                               |
| Matrix sync diagnostics | `src/events/adapters/matrix.ts`                                                                                              | COMPLETED | `src/events/adapters/matrix.test.ts`           |
| Verification            | command results and plan progress log                                                                                        | COMPLETED | targeted and full verification commands        |

## Dependencies

| Task     | Depends On                    | Status    |
| -------- | ----------------------------- | --------- |
| TASK-001 | accepted Step 3 design review | COMPLETED |
| TASK-002 | accepted Step 3 design review | COMPLETED |
| TASK-003 | accepted Step 3 design review | COMPLETED |
| TASK-004 | TASK-001, TASK-002, TASK-003  | COMPLETED |

## Parallelization Rules

- `TASK-001`, `TASK-002`, and `TASK-003` can run in parallel because their write
  scopes are disjoint.
- `TASK-004` is not parallelizable because it verifies the integrated result of
  all fix tasks.

## Verification Plan

```bash
bun test src/events/adapters/matrix.test.ts src/events/matrix-chat-reply-example.test.ts src/events/config.test.ts src/events/listener-service.test.ts src/events/manual-emit.test.ts src/events/reply-dispatcher.test.ts
bun run src/main.ts workflow validate matrix-chat-reply --workflow-definition-dir ./examples
bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events
bash -n examples/matrix-chat-reply/local-synapse/run-local-matrix-sample.sh
./examples/matrix-chat-reply/local-synapse/run-local-matrix-sample.sh
bun run typecheck
bun run lint:biome
bun run test
```

## Completion Criteria

- [x] All three mid-severity blocking findings are fixed.
- [x] The verified local Synapse receive/send path remains
      `./examples/matrix-chat-reply/local-synapse/run-local-matrix-sample.sh`.
- [x] No Matrix diagnostics leak tokens, authorization headers, sensitive URLs,
      or raw provider bodies.
- [x] Matrix completed-plan metadata points to `impl-plans/completed/` paths.
- [x] All verification commands are run or any skipped command is reported with
      an explicit reason.
- [x] Step 5 implementation review has enough file paths, commands, and test
      evidence to make a high/mid blocking decision.

## Progress Log

### Session: 2026-05-13 13:55

**Tasks Completed**: Implementation plan created.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Plan created from accepted Step 3 design review for issue-resolution
workflow `design-and-implement-review-loop`; implementation work remains pending.

### Session: 2026-05-13 14:40

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Updated the Matrix binding and test to dispatch
`matrix-chat-reply`; corrected Matrix completed-plan index paths and task
statuses; added sanitized Matrix `/sync` diagnostics via the event-source
diagnostic sink; preserved
`./examples/matrix-chat-reply/local-synapse/run-local-matrix-sample.sh`.
Focused Matrix/event tests, workflow validation, event validation, script syntax
check, typecheck, Biome, and full `bun run test` passed. The live Synapse
harness was attempted but Docker daemon access was denied by the environment.

### Session: 2026-05-13 15:20

**Tasks Completed**: Step 7 blocking feedback addressed.
**Tasks In Progress**: None.
**Blockers**: None.
**Notes**: Retained successful Matrix `/sync` HTTP status for malformed JSON and
other post-response failures so sanitized diagnostics include `httpStatus` when
available. Added invalid-JSON regression coverage and archived this completed
plan under `impl-plans/completed/`.
