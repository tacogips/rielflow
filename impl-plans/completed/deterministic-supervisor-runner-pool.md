# Deterministic In-Process Supervisor Runner Pool Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-event-supervisor-control.md#deterministic-in-process-runner-pool-mode`; `design-docs/specs/design-event-supervisor-control.md#deterministic-command-parser`; `design-docs/specs/design-workflow-supervisor-dispatcher.md#core-invariants`; `design-docs/specs/architecture.md`; `design-docs/specs/command.md`
**Created**: 2026-05-06
**Last Updated**: 2026-05-06

## Design Document Reference

Step 3 accepted the revised issue-resolution design. This plan replaces the
stale process-manager plan with the clarified deterministic in-process
supervisor runner-pool model.

Source-of-truth behavior:

- The default supervisor is deterministic and represented by
  `divedra-default-workflow-supervisor`.
- Event text is split only on spaces and tabs. A first token maps to a command
  only when it exactly matches a configured command string or alias; remaining
  tokens are preserved as ordered args.
- Empty text, whitespace-only text, or an unknown first token is natural
  language and routes to the command-analysis fallback node.
- Command-analysis returns a typed command or proposal. Runtime validation, not
  the LLM, remains the authority boundary for privileged actions.
- Target workflows start, resume, rerun, cancel, and inspect asynchronously
  in-process through `runWorkflow()`-compatible engine services.
- The runner pool tracks active workflow handles by runner-pool run id,
  supervised run id, workflow execution/session id, alias/workflow key, and
  event-source correlation.
- Durable run and command records are persisted before starting or mutating
  target workflow handles. Duplicate command ids replay stored command results.
- The local deterministic supervisor must not spawn a configured `divedra`
  binary for lifecycle, inspection, or event-source command handling.
- Auto-improve remains separate: deterministic lifecycle supervision may enforce
  restart budgets, while workflow-definition patching occurs only when
  auto-improve is explicitly enabled.

Out of scope:

- Reintroducing `DIVEDRA_BINARY_PATH` or child-process supervisor lifecycle
  control.
- Broad `superviser` to `supervisor` renames outside touched control surfaces.
- Copying implementation from `../../codex-agent`.
- Provider adapter rewrites outside the supervisor command and runner-pool
  integration boundary.

## Codex-Agent Reference Mapping

Use local `../../codex-agent` references as behavior only:

- `../../codex-agent/src/sdk/session-runner.ts`: running-session lifecycle,
  active-session tracking, wait/cancel/interrupt facade, active-set pruning.
- `../../codex-agent/src/sdk/agent-runner.ts`: stable caller-facing async runner
  API and normalized event streaming.
- `../../codex-agent/src/sdk/mock-session-runner.ts`: deterministic async runner
  tests without real backend execution.
- `../../codex-agent/src/process/manager.ts`: negative/contrast reference only;
  do not implement divedra workflow control by spawning a binary.
- `../../codex-agent/impl-plans/issue6-stable-runner-api.md`: stable runner API
  boundary planning.

Intentional divergences:

- Divedra manages in-process workflow executions and supervised event/runtime
  records instead of Codex subprocesses.
- Divedra persists command correlation in supervised-run records, event
  receipts, workflow sessions, and runtime DB rows.
- Cursor/Codex/backend-specific behavior remains behind existing workflow
  adapter modules.

## Modules

### 1. Deterministic Command Contract And Parser

#### `src/events/supervisor-command-contract.ts`

#### `src/events/supervisor-intent.ts`

#### `src/events/supervisor-command-contract.test.ts`

#### `src/events/supervisor-intent.test.ts`

**Status**: Completed

```typescript
type EventSupervisorAction =
  | "start"
  | "status"
  | "progress"
  | "inbox"
  | "read"
  | "logs"
  | "export"
  | "stop"
  | "cancel"
  | "restart"
  | "rerun"
  | "input"
  | "submit"
  | "resume";

interface ParsedSupervisorCommand {
  readonly action: EventSupervisorAction;
  readonly args: readonly string[];
  readonly parserMode: "deterministic-token";
}

interface SupervisorCommandAnalysisRequest {
  readonly text: string;
  readonly reason: "empty" | "unknown-first-token";
  readonly configuredCommands: Readonly<Record<string, readonly string[]>>;
}
```

Checklist:

- [x] Split text only on spaces and tabs.
- [x] Match the first token exactly against configured command strings/aliases.
- [x] Preserve remaining tokens in order as args.
- [x] Route empty, whitespace-only, and unknown-first-token text to
      command-analysis.
- [x] Cover aliases for status/progress, inbox/read, logs/export, stop/cancel,
      restart/rerun, and submit/input/resume.

### 2. In-Process Runner Pool Core

#### `src/workflow/supervisor-runner-pool.ts`

#### `src/workflow/supervisor-runner-pool.test.ts`

#### `src/workflow/supervisor-client-types.ts`

**Status**: Completed

```typescript
interface SupervisorRunnerPool {
  dispatch(command: EventSupervisorCommand): Promise<SupervisedWorkflowView>;
  lookup(lookup: SupervisedWorkflowLookup): Promise<SupervisedWorkflowView>;
  cancel(lookup: SupervisedWorkflowLookup): Promise<SupervisedWorkflowView>;
}

interface SupervisorRunnerPoolHandle {
  readonly runnerPoolRunId: string;
  readonly supervisedRunId: string;
  readonly workflowExecutionId: string;
  wait(): Promise<SupervisedWorkflowView>;
  cancel(reason?: string): Promise<SupervisedWorkflowView>;
}
```

Checklist:

- [x] Create async in-process runner handles around `runWorkflow()`-compatible
      execution.
- [x] Track handles by runner-pool run id, supervised run id, workflow
      execution id, alias/workflow key, and correlation key.
- [x] Prune completed handles while keeping durable records inspectable.
- [x] Refuse live-handle-only operations after restart when no safe handle
      exists.
- [x] Provide deterministic mockable runner-pool behavior for tests.

### 3. Durable Run And Command Records

#### `src/events/types.ts`

#### `src/events/supervised-runs.ts`

#### `src/events/supervisor-correlation.ts`

#### `src/workflow/runtime-db.ts`

#### `src/events/supervised-runs.test.ts`

**Status**: Completed

```typescript
interface EventSupervisorCommandRecord {
  readonly commandId: string;
  readonly supervisedRunId: string;
  readonly runnerPoolRunId?: string;
  readonly activeTargetExecutionId?: string;
  readonly args: readonly string[];
  readonly status: "pending" | "running" | "succeeded" | "failed" | "replayed";
  readonly resultPayload?: Readonly<Record<string, unknown>>;
}
```

Checklist:

- [x] Persist command/run records before starts, cancels, reruns, or input
      submission.
- [x] Serialize command mutation per `sourceId + bindingId + correlationKey`.
- [x] Replay duplicate command ids from stored results without duplicate
      lifecycle mutation.
- [x] Index lookup by supervised run id, workflow execution id, alias/workflow
      key, and event-source correlation.
- [x] Reconcile terminal target sessions into supervised-run status.

### 4. Supervisor Client And Engine Integration

#### `src/workflow/supervisor-client.ts`

#### `src/workflow/supervisor-graphql-client.ts`

#### `src/workflow/engine.ts`

#### `src/workflow/superviser-runtime-control-impl.ts`

#### `src/lib.ts`

#### `src/workflow/supervisor-client.test.ts`

#### `src/workflow/engine.test.ts`

**Status**: Completed

Checklist:

- [x] Route local supervised lifecycle operations through
      `SupervisorRunnerPool`.
- [x] Keep remote GraphQL supervisor operations available for endpoint mode.
- [x] Share start/status/progress/inbox/logs/export/cancel/restart/rerun/input
      behavior with existing runtime control helpers where practical.
- [x] Preserve explicit LLM/nested-superviser and auto-improve paths.
- [x] Ensure deterministic local lifecycle paths do not spawn a `divedra`
      binary.

### 5. Event Router And Command-Analysis Fallback

#### `src/events/supervisor-router.ts`

#### `src/events/trigger-runner.ts`

#### `src/events/dispatch-supervisor-chat.ts`

#### `src/events/supervisor-llm-resolver.ts`

#### `src/events/supervisor-control-reply.ts`

#### `src/events/trigger-runner.test.ts`

#### `src/events/dispatch-supervisor-chat.test.ts`

#### `src/events/supervisor-llm-resolver-dispatch.test.ts`

#### `src/events/supervisor-control-reply.test.ts`

**Status**: Completed

Checklist:

- [x] Route unknown first-token text to command-analysis by default in
      supervised command parsing.
- [x] Validate command-analysis proposals against allowed actions, target
      scope, confidence, ambiguity, and command idempotency.
- [x] Publish provider-neutral proposal, clarification, rejection, accepted,
      running, and final replies.
- [x] Preserve direct event mode and explicit `llm-command` bindings.
- [x] Cover multi-binding ambiguity without duplicate destructive replies.

### 6. CLI, GraphQL, Server, Examples, And Docs

#### `src/cli.ts`

#### `src/graphql/schema.ts`

#### `src/server/graphql.ts`

#### `src/server/api.ts`

#### `examples/divedra-default-workflow-supervisor/`

#### `examples/default-supervisor-dispatcher/`

#### `README.md`

#### `design-docs/specs/command.md`

#### `impl-plans/README.md`

**Status**: Completed

Checklist:

- [x] Expose runner-pool backed supervisor commands through CLI, GraphQL,
      server, and library surfaces.
- [x] Resolve runs by run id, alias, workflow key, workflow execution id, or
      event-source correlation.
- [x] Keep `--auto-improve` as remediation on top of lifecycle supervision and
      preserve explicit opt-out behavior.
- [x] Update examples to advertise deterministic in-process lifecycle ownership.
- [x] Document that local supervisor lifecycle does not use a binary
      process-manager.

### 7. Verification And Review Handoff

#### Verification commands

**Status**: Completed

Checklist:

- [x] Run focused parser, router, supervised-run, runner-pool, supervisor-client,
      GraphQL/server, CLI, and engine tests.
- [x] Run `bun run typecheck`.
- [x] Run example validation for `examples/divedra-default-workflow-supervisor`
      and `examples/default-supervisor-dispatcher`.
- [x] Run stale-text checks for forbidden process-manager/binary assumptions.
- [x] Update this plan progress log after each implementation session.

## Module Status

| Task                               | File Path                                                                                                  | Status    | Tests                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------- |
| TASK-001 Command contract/parser   | `src/events/supervisor-command-contract.ts`, `src/events/supervisor-intent.ts`                             | Completed | `src/events/supervisor-command-contract.test.ts`, `src/events/supervisor-intent.test.ts` |
| TASK-002 Runner pool core          | `src/workflow/supervisor-runner-pool.ts`, `src/workflow/supervisor-client-types.ts`                        | Completed | `src/workflow/supervisor-runner-pool.test.ts`                                            |
| TASK-003 Durable records           | `src/events/types.ts`, `src/events/supervised-runs.ts`, `src/workflow/runtime-db.ts`                       | Completed | `src/events/supervised-runs.test.ts`                                                     |
| TASK-004 Client/engine integration | `src/workflow/supervisor-client.ts`, `src/workflow/engine.ts`, `src/lib.ts`                                | Completed | `src/workflow/supervisor-client.test.ts`, `src/workflow/engine.test.ts`                  |
| TASK-005 Event router/fallback     | `src/events/supervisor-router.ts`, `src/events/trigger-runner.ts`, `src/events/supervisor-llm-resolver.ts` | Completed | event supervisor tests                                                                   |
| TASK-006 Control surfaces/docs     | `src/cli.ts`, `src/graphql/schema.ts`, `src/server/*`, examples, docs                                      | Completed | CLI, GraphQL, server, example validation                                                 |
| TASK-007 Verification handoff      | command output                                                                                             | Completed | required commands                                                                        |

## Dependencies

| Task     | Depends On                                                 | Parallelizable | Reason                                                                            |
| -------- | ---------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------- |
| TASK-001 | Step 3 accepted design                                     | Yes            | Parser/contract files are disjoint from runner-pool and persistence write scopes  |
| TASK-002 | Step 3 accepted design                                     | Yes            | New runner-pool core can be developed against existing client types and mocks     |
| TASK-003 | Step 3 accepted design                                     | Yes            | Persistence layer changes are isolated from parser and new runner-pool files      |
| TASK-004 | TASK-001, TASK-002, TASK-003                               | No             | Client integration depends on final command, runner, and durable-record contracts |
| TASK-005 | TASK-001, TASK-003, TASK-004                               | No             | Router fallback must dispatch through the integrated client and persistence paths |
| TASK-006 | TASK-004, TASK-005                                         | No             | Public surfaces and examples must match final integrated behavior                 |
| TASK-007 | TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006 | No             | Verification runs after implementation                                            |

Parallelizable tasks: TASK-001, TASK-002, TASK-003.

## Verification Plan

- `bun test src/events/supervisor-intent.test.ts src/events/supervisor-command-contract.test.ts src/events/supervised-runs.test.ts src/events/trigger-runner.test.ts`
- `bun test src/events/dispatch-supervisor-chat.test.ts src/events/supervisor-llm-resolver-dispatch.test.ts src/events/supervisor-control-reply.test.ts`
- `bun test src/workflow/supervisor-runner-pool.test.ts src/workflow/supervisor-client.test.ts src/workflow/engine.test.ts`
- `bun test src/graphql/schema.test.ts src/server/graphql.test.ts src/server/api.test.ts src/cli.test.ts`
- `bun run typecheck`
- `bun run src/main.ts workflow validate --workflow-definition-dir ./examples divedra-default-workflow-supervisor`
- `bun run src/main.ts events validate --event-root ./examples/default-supervisor-dispatcher`
- `rg -n "DIVEDRA_BINARY_PATH|child-process manager|supervisor-process-manager|deterministic-process-manager" src examples README.md design-docs/specs`

## Completion Criteria

- [x] Deterministic in-process runner-pool mode is the default local supervisor
      lifecycle path.
- [x] Event text parsing follows exact first-token command matching and ordered
      args preservation.
- [x] Unknown first-token text routes to command-analysis fallback and returns
      validated typed commands/proposals.
- [x] Event-source command surface covers start, status/progress, inbox/read,
      logs/export, stop/cancel, restart/rerun, and submit/input/resume.
- [x] Runner-pool starts, resumes, reruns, cancels, and inspects target workflows
      through in-process workflow-engine services.
- [x] Command/run records persist before mutation and support idempotent replay.
- [x] Run lookup works by supervised run id, alias, workflow key, workflow
      execution id, and event-source correlation.
- [x] Auto-improve patching remains explicit and separate from deterministic
      lifecycle supervision.
- [x] Required focused tests, typecheck, example validation, and stale-text
      checks pass.
- [x] Progress log is updated after each implementation session.

## Addressed Feedback

- Step 3 accepted the revised design with no remaining high or mid findings.
- Step 4 replaces the stale active process-manager plan because the accepted
  design explicitly rejects `divedra` binary child-process lifecycle control.
- Step 2/3 feedback is carried into TASK-001 and TASK-005: unknown first-token
  text routes to command-analysis by default, while the supervisor remains
  deterministic.
- Step 2/3 feedback is carried into TASK-002 and TASK-004: local lifecycle
  control uses an in-process runner pool over `runWorkflow()`-compatible engine
  services.
- Step 2/3 feedback is carried into TASK-006: docs and examples must state that
  local deterministic lifecycle control does not shell out to a binary.
- Step 7 high finding on implicit auto-improve defaults is addressed by keeping
  library, CLI, and GraphQL execution auto-improve policy injection explicit
  only.
- Step 7 high finding on runner-pool liveness is addressed by starting
  `runWorkflow()` work through async engine hooks, storing the live task promise
  in runner-pool handles, and pruning terminal or rejected handles.
- Step 7 mid finding on command-map natural-language fallback is addressed by
  routing unknown first-token text to the default
  `divedra-default-workflow-supervisor` `command-analysis` node when resolver
  settings are omitted.
- Step 7 follow-up high finding on async cancellation semantics is addressed by
  preserving stopped supervised-run records when background target execution
  observes cancellation.
- Step 7 follow-up mid finding on rerun/restart-from-step is addressed by
  interpreting the first command arg as `rerunFromStepId`, honoring
  `targetWorkflowExecutionId`, and passing an explicit target session id into
  `runWorkflow()`.
- Step 7 follow-up mid finding on progress/inbox/logs/export behavior is
  addressed by returning distinct typed command-result payloads for progress,
  inbox/read, and logs/export inspection commands.

## Risks

- Cancellation and resume semantics for live in-process handles may require
  engine hardening beyond status marking.
- Post-restart live-handle behavior is provisional: durable records remain
  inspectable, but live-only operations may need to refuse until safe resume is
  available.
- Command-analysis auto-apply thresholds are still tracked in user-QA and must
  remain policy-gated during implementation.
- Shared control paths with nested auto-improve superviser code may expose
  spelling and compatibility constraints.
- Concurrent event delivery can duplicate destructive actions unless command
  serialization and idempotency are implemented before router integration.

## Progress Log

### Session: 2026-05-06

**Tasks Completed**: Step 4 revised the active implementation plan after Step 3
accepted the deterministic in-process runner-pool design.

**Tasks In Progress**: None.

**Blockers**: Implementation and verification remain for later workflow steps.

**Notes**: Later TypeScript implementation must use the repository TypeScript
coding agent and must invoke check/test review after TypeScript file changes.

### Session: 2026-05-06 Step 6 Implementation

**Tasks Completed**: TASK-001 through TASK-007.

**Tasks In Progress**: None.

**Blockers**: None.

**Notes**: Implemented deterministic space/tab command parsing with ordered
args, command-analysis fallback dispatch, expanded supervisor action aliases,
runner-pool handle indexing/cancel refusal, command args persistence, local
event and GraphQL command dispatch through the runner-pool facade, library
exports, and example documentation. Verification passed with focused event,
workflow, GraphQL/server, CLI, example validation, typecheck, and stale-text
checks.

### Session: 2026-05-06 Step 6 Revision After Step 7 Review

**Tasks Completed**: TASK-002, TASK-005, TASK-006, TASK-007 revision pass.

**Tasks In Progress**: None.

**Blockers**: None.

**Notes**: Removed implicit default auto-improve injection from library, CLI,
and GraphQL execution paths; converted local and GraphQL supervised command
dispatch to persistent in-process runner-pool instances; made supervisor-client
start/input/restart paths publish running records immediately and execute target
workflows in background tasks when invoked through the runner pool; stored live
task promises in runner-pool handles with wait/cancel and terminal pruning; and
added default command-analysis fallback coverage for command-map natural
language.

### Session: 2026-05-06 Step 6 Second Revision After Step 7 Review

**Tasks Completed**: TASK-002, TASK-004, TASK-006, TASK-007 follow-up revision
pass.

**Tasks In Progress**: None.

**Blockers**: None.

**Notes**: Preserved stopped/cancelled supervised-run semantics for background
runner-pool task failures, implemented rerun-from-step dispatch using command
args and `targetWorkflowExecutionId`, allowed explicit session ids for engine
rerun/continuation entry points, and added typed command-result payloads for
progress, inbox/read, and logs/export commands with targeted tests.
