# TypeScript Source Module Size Boundary Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#typescript-source-module-size-boundary`
**Created**: 2026-05-13
**Last Updated**: 2026-05-13

## Source And Scope

This plan implements the accepted issue-resolution design for making local
Biome lint pass when `lint/nursery/noExcessiveLinesPerFile` enforces the
1000-line maximum for non-test TypeScript source files.

Issue reference:

- **Title**: Refactor over-1000-line TypeScript files so local Biome lint passes
- **Source**: `runtimeVariables.workflowInput`
- **Remote issue**: not available; no `issueUrl`, `issueNumber`, or
  `issueRepository` was supplied

Codex-reference mapping:

- No codex-agent reference repository, file paths, or behavior inputs were
  supplied.
- No Cursor adapter behavior is involved.
- Implementation should follow local divedra behavior, tests, and the accepted
  architecture boundary instead of importing external reference behavior.

In scope:

- Split every non-test TypeScript source file reported by Biome
  `noExcessiveLinesPerFile` into cohesive modules.
- Preserve behavior and public import paths where practical with thin facade
  files that also stay under 1000 lines.
- Use meaningful file names that describe module responsibility.
- Update repository skill or user documentation only if the refactor makes
  documented paths, responsibilities, or workflow instructions stale.

Out of scope:

- Weakening or disabling Biome line-count enforcement.
- Runtime behavior changes unrelated to module extraction.
- Large style rewrites or formatting churn outside touched modules.

## Target Files

| Area                | Current oversized file(s)                    | Planned split owner                                                     |
| ------------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| CLI                 | `src/cli.ts`                                 | `src/cli/**` command parsing, routing, and command handlers             |
| Events              | `src/events/trigger-runner.ts`               | `src/events/trigger-runner/**` event execution helpers                  |
| GraphQL             | `src/graphql/schema.ts`                      | `src/graphql/schema/**` schema, query, mutation, and resolver groups    |
| Workflow calls      | `src/workflow/call-step-impl.ts`             | `src/workflow/call-step/**` direct-step execution helpers               |
| Workflow engine     | `src/workflow/engine.ts`                     | `src/workflow/engine/**` execution orchestration helpers                |
| Native execution    | `src/workflow/native-node-executor.ts`       | `src/workflow/native-node-executor/**` native command handling          |
| Node add-ons        | `src/workflow/node-addons.ts`                | `src/workflow/node-addons/**` add-on resolution and payload guards      |
| Runtime DB          | `src/workflow/runtime-db.ts`                 | `src/workflow/runtime-db/**` persistence stores and serializers         |
| Supervisor client   | `src/workflow/supervisor-client.ts`          | `src/workflow/supervisor-client/**` supervisor session API helpers      |
| Supervisor dispatch | `src/workflow/supervisor-dispatch-client.ts` | `src/workflow/supervisor-dispatch-client/**` dispatch transport helpers |
| Validation          | `src/workflow/validate.ts`                   | `src/workflow/validate/**` validation domains and diagnostics           |

## Task Breakdown

### TASK-001: Baseline Lint And Import Audit

**Status**: Completed
**Parallelizable**: No
**Deliverables**:

- Current `bun run lint:biome` output captured in the implementation progress
  log with each `noExcessiveLinesPerFile` source file.
- Public import audit for the target files using `rg` to identify callers that
  depend on existing paths.
- Initial split map recording facade files that must keep public import
  compatibility.

**Completion Criteria**:

- [x] All current oversized non-test TypeScript source files are listed.
- [x] Public import paths that should remain stable are recorded.
- [x] Known unrelated dirty worktree changes are noted and not reverted.

### TASK-002: Split CLI Source Organization

**Status**: Completed
**Parallelizable**: Yes after TASK-001
**Deliverables**:

- `src/cli.ts` converted to a thin facade or entry router under 1000 lines.
- New `src/cli/**` modules for argument parsing, command routing, command
  handlers, output formatting, and shared CLI helpers as appropriate.
- Existing CLI imports and command behavior preserved.

**Completion Criteria**:

- [x] `src/cli.ts` is under the Biome line limit.
- [x] CLI command dispatch and option parsing behavior are unchanged.
- [x] Focused CLI tests pass, including `bun test src/cli.test.ts`.

### TASK-003: Split GraphQL Schema And Event Trigger Runner

**Status**: Completed
**Parallelizable**: Yes after TASK-001
**Deliverables**:

- `src/graphql/schema.ts` kept as a small public facade or schema assembler.
- New `src/graphql/schema/**` modules for resolver groups, GraphQL object
  definitions, manager/control-plane fields, and shared schema helpers.
- `src/events/trigger-runner.ts` split into event trigger execution modules
  under `src/events/trigger-runner/**`.
- Existing GraphQL exports and event-trigger behavior preserved.

**Completion Criteria**:

- [x] `src/graphql/schema.ts` and `src/events/trigger-runner.ts` are under the
      Biome line limit.
- [x] GraphQL schema assembly and resolver behavior remain compatible.
- [x] Focused GraphQL and event tests pass, including relevant
      `src/graphql/**/*.test.ts` and `src/events/**/*.test.ts` coverage.

### TASK-004: Split Runtime Persistence And Supervisor Clients

**Status**: Completed
**Parallelizable**: Yes after TASK-001
**Deliverables**:

- `src/workflow/runtime-db.ts` split into cohesive persistence store,
  serializer, index, and lookup modules.
- `src/workflow/supervisor-client.ts` split into session, message, attachment,
  and request helpers as appropriate.
- `src/workflow/supervisor-dispatch-client.ts` split into dispatch transport,
  payload, and response handling helpers.
- Existing exports preserved through thin facades where callers depend on the
  current file paths.

**Completion Criteria**:

- [x] The three runtime and supervisor client facade files are under the Biome
      line limit.
- [x] Persistence record shapes and supervisor dispatch semantics are
      unchanged.
- [x] Focused workflow runtime and supervisor tests pass.

### TASK-005: Split Native Executor And Node Add-On Modules

**Status**: Completed
**Parallelizable**: Yes after TASK-001
**Deliverables**:

- `src/workflow/native-node-executor.ts` split into native command dispatch,
  backend invocation, output handling, and environment helpers.
- `src/workflow/node-addons.ts` split into add-on catalog resolution,
  validation, authored-payload guards, and built-in add-on helpers.
- Adapter/backend dispatch order and add-on identifiers preserved.

**Completion Criteria**:

- [x] Both native execution and add-on facade files are under the Biome line
      limit.
- [x] Native execution and add-on resolution behavior are unchanged.
- [x] Focused add-on and native executor tests pass.

### TASK-006: Split Workflow Validation Domains

**Status**: Completed
**Parallelizable**: Yes after TASK-001
**Deliverables**:

- `src/workflow/validate.ts` kept as a small validation facade.
- New `src/workflow/validate/**` modules for workflow graph checks, node
  payload checks, step-address checks, add-on validation, event bindings,
  diagnostics, and shared validation types when needed.
- Existing validation error text and ordering preserved where tests or callers
  rely on it.

**Completion Criteria**:

- [x] `src/workflow/validate.ts` is under the Biome line limit.
- [x] Validation domains remain cohesive and avoid circular imports.
- [x] Focused workflow validation tests pass.

### TASK-007: Split Workflow Engine And Direct Step Call Implementation

**Status**: Completed
**Parallelizable**: No
**Depends On**: TASK-004, TASK-005, TASK-006
**Deliverables**:

- `src/workflow/engine.ts` split into execution orchestration, readiness,
  session state, loop/branch control, supervision, artifact, and output
  handling modules under `src/workflow/engine/**`.
- `src/workflow/call-step-impl.ts` split into call-step input resolution,
  execution dispatch, runtime variable handling, and result assembly modules
  under `src/workflow/call-step/**`.
- Initialization order, side-effect timing, and workflow runtime semantics
  preserved.

**Completion Criteria**:

- [x] `src/workflow/engine.ts` and `src/workflow/call-step-impl.ts` are under
      the Biome line limit.
- [x] Workflow execution, direct step calls, loops, branches, supervision, and
      artifact output behavior are unchanged.
- [x] Focused workflow engine and call-step tests pass.

### TASK-008: Integration Verification And Documentation Review

**Status**: Completed
**Parallelizable**: No
**Depends On**: TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007
**Deliverables**:

- Full local verification results recorded in this plan progress log.
- `impl-plans/PROGRESS.json` and this plan updated with final task statuses.
- Repository skill/documentation wording updated only if stale after file
  splits.

**Completion Criteria**:

- [x] `bun run lint:biome` passes with no `noExcessiveLinesPerFile` errors.
- [x] `bun run typecheck` passes.
- [x] Focused tests for every touched area pass, or `bun run test` passes when
      focused coverage is insufficient.
- [x] Any documentation changes are limited to stale path or responsibility
      wording caused by the refactor.

## Dependencies

| Task     | Depends On                                                 | Dependency Reason                                                                                |
| -------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| TASK-001 | None                                                       | Establishes current lint and import baseline before edits.                                       |
| TASK-002 | TASK-001                                                   | CLI split needs public import and command baseline.                                              |
| TASK-003 | TASK-001                                                   | GraphQL and event splits need export and behavior baseline.                                      |
| TASK-004 | TASK-001                                                   | Runtime and supervisor splits need public import baseline.                                       |
| TASK-005 | TASK-001                                                   | Native executor and add-on splits need backend dispatch baseline.                                |
| TASK-006 | TASK-001                                                   | Validation split needs diagnostic and caller baseline.                                           |
| TASK-007 | TASK-004, TASK-005, TASK-006                               | Engine and direct-step implementation import runtime DB, native/add-on, and validation surfaces. |
| TASK-008 | TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007 | Final verification must run after all source splits.                                             |

## Parallel Work

These tasks may run concurrently after TASK-001 because their planned write
scopes are disjoint:

- TASK-002: `src/cli.ts`, `src/cli/**`
- TASK-003: `src/graphql/schema.ts`, `src/graphql/schema/**`,
  `src/events/trigger-runner.ts`, `src/events/trigger-runner/**`
- TASK-004: `src/workflow/runtime-db.ts`, `src/workflow/runtime-db/**`,
  `src/workflow/supervisor-client.ts`, `src/workflow/supervisor-client/**`,
  `src/workflow/supervisor-dispatch-client.ts`,
  `src/workflow/supervisor-dispatch-client/**`
- TASK-005: `src/workflow/native-node-executor.ts`,
  `src/workflow/native-node-executor/**`, `src/workflow/node-addons.ts`,
  `src/workflow/node-addons/**`
- TASK-006: `src/workflow/validate.ts`, `src/workflow/validate/**`

TASK-007 is intentionally sequenced after TASK-004 through TASK-006 because the
workflow engine and direct-step implementation sit above those shared workflow
runtime surfaces.

## Verification Plan

Required commands:

- `bun run lint:biome`
- `bun run typecheck`
- `bun test src/cli.test.ts`
- Focused `bun test` commands for touched `src/events`, `src/graphql`, and
  `src/workflow` tests selected during implementation.
- `bun run test` when focused tests do not cover changed public surfaces or
  when extraction crosses multiple workflow runtime areas.

Recommended audit commands:

- `rg -n "from ['\\\"](.*cli|.*graphql/schema|.*workflow/(engine|validate|runtime-db|node-addons|native-node-executor|supervisor-client|supervisor-dispatch-client|call-step-impl))" src`
- `wc -l` or Biome diagnostics for every touched non-test TypeScript facade.

## Completion Criteria

- [x] All 11 known oversized non-test TypeScript source files are below 1000
      lines.
- [x] Public import paths remain stable where practical through thin facades.
- [x] Extracted modules have responsibility-based names and narrow import
      surfaces.
- [x] No circular imports or initialization-order regressions are introduced.
- [x] `bun run lint:biome` passes.
- [x] `bun run typecheck` passes.
- [x] Focused or full tests pass for the touched areas.
- [x] Progress log records commands run, results, residual risks, and any
      intentional documentation non-updates.

## Progress Log Expectations

Each implementation session must append:

- Date and workflow step or operator context.
- Tasks attempted and task status changes.
- Files created, moved, or left as compatibility facades.
- Verification commands run and pass/fail results.
- Any skipped verification with the concrete reason.
- Residual risks or follow-up TODOs with file paths.

## Progress Log

### Session: 2026-05-13 Step 4 Implementation-Plan Creation

**Tasks Completed**: Plan creation only.

**Notes**: Step 3 accepted the architecture design with no high or mid findings.
This plan keeps implementation under `impl-plans/active/` per workflow
instruction and records no codex-agent reference mapping because no reference
input was supplied.

### Session: 2026-05-13 Step 6 Implementation

**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005,
TASK-006, TASK-007, TASK-008.

**Files Created, Moved, Or Left As Facades**: The 11 oversized public source
files were left as thin compatibility facades under their original import
paths: `src/cli.ts`, `src/events/trigger-runner.ts`,
`src/graphql/schema.ts`, `src/workflow/call-step-impl.ts`,
`src/workflow/engine.ts`, `src/workflow/native-node-executor.ts`,
`src/workflow/node-addons.ts`, `src/workflow/runtime-db.ts`,
`src/workflow/supervisor-client.ts`,
`src/workflow/supervisor-dispatch-client.ts`, and
`src/workflow/validate.ts`. Responsibility-based extracted modules were added
under `src/cli/`, `src/events/trigger-runner/`, `src/graphql/schema/`,
`src/workflow/call-step-impl/`, `src/workflow/engine/`,
`src/workflow/native-node-executor/`, `src/workflow/node-addons/`,
`src/workflow/runtime-db/`, `src/workflow/supervisor-client/`,
`src/workflow/supervisor-dispatch-client/`, and `src/workflow/validate/`.

**Verification Commands Run**:

- `bun run lint:biome` - passed; Biome checked 298 files with no fixes applied
  and no `noExcessiveLinesPerFile` diagnostics.
- `bun run typecheck` - passed.
- `bun test src/cli.test.ts src/graphql/schema.test.ts src/server/graphql-auth.test.ts src/server/graphql-execution-overview-and-definitions.test.ts src/server/graphql-supervision-and-resume.test.ts src/server/graphql-queries-and-inspection.test.ts src/events/trigger-runner-supervised.test.ts src/events/trigger-runner-supervisor-dispatch.test.ts src/events/trigger-runner-stickiness.test.ts src/workflow/call-step.test.ts src/workflow/call-step-impl-failures.test.ts src/workflow/call-step-impl-execution.test.ts src/workflow/engine.test.ts src/workflow/validate.test.ts src/workflow/runtime-db.test.ts src/workflow/supervisor-client.test.ts src/workflow/supervisor-graphql-client.test.ts src/workflow/native-node-executor-addons-commands.test.ts src/workflow/native-node-executor-gateway.test.ts src/workflow/superviser-control.test.ts src/workflow/superviser-runtime-control-impl.test.ts src/workflow/manager-control.test.ts`
  - passed; 462 tests across 22 files.
- `bun run test` - passed; 999 tests across 100 files.

**Notes**: `wc -l` confirmed all 11 original oversized facade files are far
below the 1000-line Biome limit, and all extracted non-test TypeScript modules
under the new split directories are below 1000 lines. Documentation updates were
limited to the accepted design and TypeScript coding-standard wording that
records the Biome line-count guardrail; no user-facing command behavior changed.

**Residual Risks**: Low. This is a broad source-organization refactor, so review
should focus on public export compatibility and initialization order, but
Biome, typecheck, focused tests, and the full test suite all passed.
