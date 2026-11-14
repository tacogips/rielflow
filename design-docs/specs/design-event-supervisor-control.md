# Event Supervisor Control Design

This document extends event listener workflow triggers so event sources can
start and control supervised workflow executions.

## Overview

The existing event listener path starts workflows directly from matched event
bindings. That remains valid for simple fire-and-forget automation.

The broader architectural direction is documented in
`design-docs/specs/design-event-external-mailbox-binding.md`: event sources
should conceptually bind to runtime-owned external mailbox input/output
surfaces, while the supervisor becomes the preferred consumer of external input
for interactive sources and the preferred publisher of control/progress output
for those same sources.

For chat, web app, and other interactive event sources, divedra also needs a
supervised control path:

```text
EventSourceAdapter
  -> ExternalEventEnvelope
  -> EventBinding + EventControlIntentMapper
  -> EventSupervisorRouter
  -> workflow supervisor system workflow
  -> target workflow start / status / restart / stop
```

In supervised mode, the event listener does not own target workflow lifecycle.
It normalizes events, records receipts, maps the event into a control command,
and sends that command to the supervisor. The supervisor is the durable owner of
the target workflow run and its restart/stop/status policy.

Under the target mailbox-oriented model, that same statement is expressed more
strictly: provider adapters bridge inbound traffic into external mailbox input,
and the supervisor owns consumption of that input plus publication of control,
progress, and optional final business output back through the external output
mailbox boundary.

Terminology note: supervised **event** bindings use `supervisorWorkflowName` on
`EventWorkflowExecutionPolicy`. The engine's nested auto-improve path still
uses `superviserWorkflowId`, `nestedSuperviserSessionId`, and flags such as
`--superviser-workflow` (legacy spelling in that subsystem). Phase 1 event
supervision stores `supervisorWorkflowName` on supervised-run rows for
correlation and future packaged supervisor workflow execution; it does not run
that bundle as the lifecycle owner yet. Natural-language control (`llm-command`
intent mapping, broadcast routing, and strict decision parsing) and the
operator-facing `supervisor` naming migration are implemented as described in
`impl-plans/completed/supervisor-natural-language-control.md` (status: completed).

## Goals

- Allow one event source conversation to start a workflow and later stop,
  restart, or inspect the same running workflow.
- Make supervisor-based execution usable from chat adapters, web-chat adapters,
  CLI event serving, GraphQL, and library clients.
- Treat the workflow supervisor itself as a divedra system workflow rather than
  a separate orchestration model.
- Provide a default supervisor policy: no automatic workflow improvement,
  restart failed target workflows up to a configured limit, and stop after the
  limit is exhausted.
- Preserve direct event-to-workflow execution for bindings that do not need
  ongoing lifecycle control.

## Non-Goals

- Direct execution of unvalidated natural-language text as privileged workflow
  control actions.
- Replacing GraphQL execution, rerun, and cancel mutations.
- Giving ordinary workflows unrestricted authority to cancel or mutate unrelated
  workflow executions.
- Enabling recursive supervision by default.

## Assumptions Pending Confirmation

`design-docs/user-qa/qa-event-supervisor-control.md` tracks the user-facing
decisions that should be confirmed before implementation planning. Until those
answers are confirmed, this design uses these provisional defaults:

- user-facing event/control documentation uses "supervisor"; existing persisted
  and GraphQL field names for auto-improve phase 2 may keep `superviser`
  spelling. The CLI accepts canonical `--supervisor-workflow` and
  `--nested-supervisor` as aliases for `--superviser-workflow` and
  `--nested-superviser` (identical semantics).
- the default supervised restart limit is `3`.
- core binding configuration accepts structured actions and deterministic text
  command tokens. The default deterministic parser splits event text on spaces
  and tabs; a known first token becomes the command and remaining tokens become
  arguments. If the first token is not a known command, the text is routed to a
  command-analysis LLM node that emits a structured command proposal. The
  supervisor remains deterministic because the runtime parses and validates that
  proposal before executing any privileged action.
- one source/binding/conversation/thread correlation key has at most one active
  supervised run unless the event supplies an explicit target alias or
  supervised run id.
- cancellation may initially mark workflow execution cancellation, with backend
  process abort propagation tracked as a hardening milestone.

## Current State

### Long-standing building blocks

- `src/events/trigger-runner.ts` maps events to runtime variables and starts
  workflows through `createWorkflowExecutionClient()` or local `runWorkflow()`.
- GraphQL exposes `executeWorkflow`, `resumeWorkflowExecution`,
  `rerunWorkflowExecution`, and `cancelWorkflowExecution`.
- Auto-improve supervision exists in two forms:
  - phase 1: engine-owned retry/patch audit loop
  - phase 2: optional nested `superviserWorkflowId` workflow when
    `nestedSuperviser` / `--nested-superviser` is enabled
- `src/workflow/superviser-control.ts` defines scoped target-workflow control
  operations for a nested superviser workflow.

### Phase 1 implementation (foundation + review hardening)

These pieces are implemented as tracked in `impl-plans/completed/event-supervisor-control-foundation.md`
and `impl-plans/completed/event-supervisor-control-review-hardening.md`:

- `execution.mode = "supervised"` on event bindings, with validation and backward-compatible direct mode.
- Durable supervised-run and command records (SQLite), correlation-key serialization across processes,
  and idempotent command replay.
- `WorkflowSupervisorClient` (`src/workflow/supervisor-client.ts`) performing start/stop/restart/status/input
  against the target workflow via the existing engine, plus GraphQL and remote GraphQL client surfaces.
- Event trigger runner and listener paths route supervised bindings through the supervisor router;
  event receipts record `supervisedRunId` and target `workflowExecutionId` where applicable.
- **Lifecycle alignment (post-review hardening)**: correlation commands reuse the latest
  `supervisedRunId` when starting again after a stopped or terminal run; terminal target sessions
  are reconciled into `completed` / `failed` / `stopped` supervised-run rows at command boundaries;
  the trigger runner resolves supervisor intent before `inputMapping` for non-`start` / non-`input`
  actions; when `planSupervisedLlmBindingsDispatch` marks destructive ambiguity across multiple supervised
  `llm-command` bindings, `dispatchEventToMatchingBindings` emits **one** router-level clarification reply and
  suppresses per-binding duplicate skip replies; successful supervised dispatches, non-ambiguous intent skips,
  supervised dispatch failures, and supervised mapping failures before control dispatch can emit
  provider-neutral chat replies when `eventReplyDispatcher` is configured and the event includes a
  conversation target (failure replies use a generic operator message; detailed errors stay on the receipt).

**Phase 1 scope note:** Lifecycle control is enforced by the **runtime supervisor client**, not by executing
the authored workflow named in `supervisorWorkflowName`. The deterministic follow-up keeps that native
runtime ownership and formalizes it as an in-process workflow-runner pool. The supervisor is still represented
by the default supervisor workflow name for policy, audit, and future packaging, but default lifecycle control
does not shell out to a `divedra` binary and does not make the supervisor itself an LLM-backed node.
LLM-backed command analysis remains an explicit fallback parser node, not the supervisor authority.

### Phase 4 implementation (natural-language supervisor control)

Implemented per `impl-plans/completed/supervisor-natural-language-control.md`:

- `intentMapping.mode = "llm-command"` with validation, optional resolver workflow/node, and multi-target policy.
- `planSupervisedLlmBindingsDispatch` for destructive ambiguity across multiple matching supervised bindings.
- `parseSupervisorChatCommandDecision` and runtime allow-list checks before command execution.
- `dispatchSupervisorChat` (library) and the GraphQL entrypoint reuse the same event pipeline as adapters.

### Remaining / follow-up (not Phase 1)

- Packaged default workflow bundle `divedra-default-workflow-supervisor` and execution path that populates
  `supervisorExecutionId` and delegates policy steps to authored nodes (see "Supervisor As A System Workflow").
- Multi-workflow chat dispatch, where one supervisor conversation chooses among
  a profile-defined catalog of manageable workflows, is specified separately in
  `design-docs/specs/design-workflow-supervisor-dispatcher.md`.
- Stronger cancel semantics (process abort propagation beyond workflow cancellation marks), as noted under assumptions.
- Optional: richer chat-reply text for destructive ambiguity (skipped receipts already record reasons).

## Supervisor As A System Workflow

The target architecture is that the workflow supervisor is a divedra workflow
stored and executed like any other workflow, with additional runtime-scoped
system capabilities.

Phase 1 implements the same **capability set** (start/status/cancel/rerun, durable supervised-run
persistence) through the runtime-owned `WorkflowSupervisorClient` service rather than by shipping and
executing the recommended workflow bundle. The next step is deterministic in-process runner-pool mode:
package `divedra-default-workflow-supervisor` as the supervisor identity, execute lifecycle control through
a native runner-pool service that calls the workflow engine in the same process, and keep authored LLM
decision nodes opt-in.

Recommended default workflow id:

- `divedra-default-workflow-supervisor`

Recommended system workflow steps:

1. `receive-control-event`
2. `resolve-supervised-target`
3. `start-target-workflow`
4. `watch-target-status`
5. `decide-recovery`
6. `rerun-target-workflow`
7. `cancel-target-workflow`
8. `publish-control-reply`
9. `finish-supervision`

Default behavior:

- `autoImprove.enabled = false`
- `workflowMutationMode = "execution-copy"` only if auto-improve is explicitly
  enabled later
- failed target workflows are restarted from the workflow entry/manager anchor
  until `maxRestartsOnFailure` is exhausted
- no workflow-definition patching is attempted
- stop requests cancel the current target workflow and mark the supervised run
  stopped
- restart requests cancel the current non-terminal target workflow when needed
  and create a new target execution linked to the same supervised run

The supervisor remains an ordinary authored workflow in shape, but its privileged
operations must be exposed through runtime-owned add-ons or control-plane calls
with scoped authorization.

### Deterministic In-Process Runner-Pool Mode

Default supervisor mode is deterministic. It is represented as the
`divedra-default-workflow-supervisor` workflow, but the lifecycle-control step is
a native in-process runner-pool service rather than an LLM manager node. The
runner pool owns command persistence, active workflow handles, progress polling,
and event-source reply materialization.

Hard boundaries:

- deterministic mode runs target workflows asynchronously in the same process
  through the workflow engine; it must not spawn a `divedra` child process for
  supervisor lifecycle, inspection, or event-source command handling
- the supervisor itself is deterministic and must not be an LLM-backed node
- command-analysis LLM execution is a fallback parser only; its output is a
  typed command or proposal that returns to the deterministic validation path
- `runWorkflow()` remains the engine primitive used by the runner pool for
  starts, resumes, and reruns; event sources and operators should target the
  supervisor command surface rather than bypassing the pool for active runs
- LLM-backed dispatch remains available only when a binding or supervisor
  profile explicitly requests `intentMapping.mode = "llm-command"` or another
  explicit LLM supervisor mode
- auto-improve patching remains separate; deterministic lifecycle supervision
  may observe failures and enforce restart budgets, but it must not mutate
  workflow definitions unless auto-improve is explicitly enabled

The runner pool should accept commands asynchronously and persist command/run
records before starting or mutating target workflow handles. Each record should
include the validated supervisor command id, event receipt id when present,
supervised run id, runner-pool run id when known, target workflow execution id
when known, command arguments, status, timestamps, and the operator-safe result
payload. Replayed event-source commands resolve through the persisted command
record rather than starting or mutating a second workflow run.

Handle replacement rules:

- mutating commands that start, resume, rerun, restart, or otherwise receive an
  `onAsyncRun` task from the supervisor client may store or replace active
  runner-pool handle indexes
- inspection commands such as status, progress, inbox/read, logs, and export
  must return the latest view without replacing an existing live handle when no
  async task was produced
- cancel, wait, and resume operations must resolve to the original live handle
  after any number of intervening inspection commands in the same process
- durable command/run rows remain the source for audit and post-restart
  inspection, but live handle indexes are the source for in-process task
  control

Workflow-run progress crosses the runner/supervisor boundary as typed
in-process events rather than runner-owned prints. `runWorkflow()` emits
`step-started`, `step-completed`, and `workflow-completed` events to an optional
`WorkflowRunEventSink`; omitting the sink keeps normal output unchanged. The
deterministic supervisor owns operator-facing rendering by consuming those
events, and CLI `--verbose` uses that supervisor renderer for stderr step-start
lines. Explicit debug mode remains the opt-in path for legacy runner progress
callbacks.

The runner pool tracks active executions by:

- `runnerPoolRunId`: process-local handle id for async task control
- `supervisedRunId`: durable event-control lifecycle id
- `workflowExecutionId` / session id: workflow-engine execution identity
- optional operator alias or managed workflow key
- source/binding/correlation key for event-source conversations

Target resolution uses those ids in the same priority order. `runnerPoolRunId`,
`supervisedRunId`, and `workflowExecutionId` are authoritative for mutating
commands. Alias, workflow key, and correlation key are convenience lookups for
operator text and event-source conversations; when any of those convenience
lookups resolves to multiple active handles, `stop`, `cancel`, `input`,
`submit`, `resume`, `restart`, and `rerun` must return an ambiguous-target
result and require a stronger id. Status and progress may either return a
multi-run summary or the same refinement requirement, but they must not mutate
or replace active handles.

Only active in-process handles are directly cancellable or resumable through the
pool. Durable records remain inspectable after process restart, but a restarted
process may need to rehydrate status from persisted session/artifact state and
refuse operations that require a live handle unless the engine supports safe
resume for that operation.

Wait is a live-handle operation with durable fallback semantics. If the target
has an active in-process handle, wait blocks on that handle, reconciles terminal
state into the supervised-run/session records, and removes the handle from all
live indexes. If no live handle exists, wait should return the durable terminal
view when the target already completed, or a not-live/not-waitable result when
the durable record is still non-terminal. This keeps cancellation and wait
truthful across process boundaries while preserving status as the durable
inspection path.

Event-source command surface:

| Supervisor action | Runner-pool operation |
| ----------------- | --------------------- |
| `reference`       | inspect workflow usage/profile metadata from the local catalog or configured remote control plane |
| `start`           | enqueue an async `runWorkflow()` start for the resolved target workflow and mapped variables |
| `status`          | read supervised-run state plus target session status |
| `progress`        | read target session queue/execution progress |
| `inbox` / `read`  | inspect runtime mailbox/artifact input and output for the active execution |
| `logs`            | read bounded runtime logs for the target session |
| `export`          | assemble a session export payload from persisted runtime artifacts |
| `stop` / `cancel` | request cancellation for the active runner-pool handle and reconcile persisted target status |
| `restart`         | cancel the active non-terminal target when needed, then start a fresh attempt for the same supervised run |
| `rerun`           | rerun from a validated step id when supplied, otherwise follow restart policy |
| `input` / `submit` / `resume` | submit validated input to a paused/resumable active execution or start-on-first-input target when configured |

The action table is a contract for runner-pool behavior, not a requirement that
event sources expose these names verbatim to users.

### Deterministic Command Parser

For event text, the default parser splits only on spaces and tabs. The first
token is interpreted as a command only when it exactly matches a configured
command string or alias. Remaining tokens are preserved, in order, as command
arguments. Empty input, whitespace-only input, or text whose first token is not
a configured command is treated as natural language and routed to the
command-analysis fallback under supervised command parsing. Non-interactive
bindings that do not want natural-language control should reject or ignore the
event before it reaches the supervisor command parser.

The default command surface should include:

- `start`
- `status` and `progress`
- `inbox` and `read`
- `logs` and `export`
- `stop` and `cancel`
- `restart`
- `rerun` with an optional step id argument
- `submit`, `input`, and `resume`

The command-analysis LLM node returns a typed command proposal, such as mapping
"stop workflow and rerun from step 2" into a cancel command plus a rerun command
with `rerunFromStepId = "step2"` when that step id can be validated. The
runtime may apply a single high-confidence safe proposal automatically only when
the binding policy allows it; otherwise it publishes a clarification or proposal
reply.

### Codex-Agent Reference Mapping

The local `../../codex-agent` repository is a behavioral reference for async
runner facade, active-session tracking, normalized streaming, cancellation, and
testable runner mocks, not a source for copied implementation.
Relevant reference paths:

- `../../codex-agent/src/sdk/session-runner.ts`
- `../../codex-agent/src/sdk/agent-runner.ts`
- `../../codex-agent/src/sdk/mock-session-runner.ts`
- `../../codex-agent/src/process/manager.ts` (negative/contrast reference only)
- `../../codex-agent/impl-plans/issue6-stable-runner-api.md`

Concepts to reuse in divedra:

- stable caller-facing runner facade hides whether a command starts new work,
  resumes existing work, or performs inspection
- active session/run sets are tracked and pruned on completion
- cancellation and interrupt controls are methods on running handles, not raw
  text commands
- streaming/progress events are normalized before being returned to callers
- mocks can exercise async runner semantics without launching a real backend

Intentional divergences:

- codex-agent manages `codex` subprocesses and Codex session events; divedra
  deterministic supervisor mode manages in-process divedra workflow executions
  and supervised workflow/event records
- divedra persists command correlation in supervised-run records, event
  receipts, workflow sessions, and runtime DB rows rather than in codex-agent
  queue/session stores
- Cursor/Codex/backend-specific behavior remains behind existing adapter
  modules; the deterministic runner pool accepts provider-neutral
  supervisor commands and emits provider-neutral status/reply payloads
- divedra may use GraphQL for remote control-plane parity, but the local
  deterministic supervisor runner pool must not shell out to the configured
  `divedra` binary for lifecycle and inspection operations

Minimum supervisor-only capabilities:

- start target workflow
- read target workflow status and execution details
- cancel target workflow
- rerun/restart target workflow
- persist supervised run association records
- publish provider-neutral replies for chat/web event sources

These capabilities must be scoped to the active supervisor run. A supervisor
workflow must not be able to stop arbitrary workflow executions outside its
owned target set.

### Relationship To Existing Auto-Improve Superviser

The existing `autoImprove` implementation is not wrong, but it is too narrow to
be the only supervisor entrypoint. It supervises because automatic remediation
needs monitoring. The event-control design needs supervision even when
remediation is disabled.

Required alignment:

- retain the existing `superviserWorkflowId` / `nestedSuperviser` implementation
  path for auto-improve compatibility
- add a lifecycle-supervision policy that can run with `autoImprove = false`
- move shared target-control operations behind a reusable runtime service so
  event-control supervision and auto-improve nested supervision do not fork
  separate start/status/rerun/cancel behavior
- keep workflow-definition patching available only when auto-improve is
  explicitly enabled

## Event Binding Extension

Existing bindings keep their current meaning. Omitted `execution.mode` means
`"direct"` for backward compatibility.

Recommended supervised binding shape:

```json
{
  "id": "chat-release-review",
  "sourceId": "team-chat",
  "workflowName": "release-review",
  "inputMapping": {
    "mode": "template",
    "template": {
      "request": "{{event.input.text}}",
      "conversationId": "{{event.conversation.id}}"
    },
    "mirrorToHumanInput": true
  },
  "execution": {
    "mode": "supervised",
    "async": true,
    "supervisorWorkflowName": "divedra-default-workflow-supervisor",
    "maxRestartsOnFailure": 3,
    "autoImprove": false,
    "control": {
      "correlationKey": "{{event.sourceId}}:{{event.conversation.id}}:{{event.conversation.threadId}}",
      "allowActions": ["start", "stop", "restart", "status", "input"],
      "startOnFirstInput": true,
      "intentMapping": {
        "mode": "command-map",
        "naturalLanguageFallback": "command-analysis"
      }
    }
  }
}
```

Rules:

- `workflowName` remains the target workflow name.
- `execution.mode = "direct"` keeps the current trigger-runner path.
- `execution.mode = "supervised"` routes the mapped event through the
  supervisor router.
- `supervisorWorkflowName` is the proposed event-layer field for the supervisor
  system workflow. The runtime may map it to existing `superviserWorkflowId`
  fields until naming is migrated.
- `supervisorWorkflowName` defaults to `divedra-default-workflow-supervisor`.
- `maxRestartsOnFailure` must be finite; recommended default is 3.
- `autoImprove` defaults to false in supervised mode.
- a supervised binding must define a stable correlation key or use the default
  `sourceId + bindingId + conversation.id + conversation.threadId` key.
- control-field templates may reference normalized `event.*`, `source.*`, and
  `binding.*` values.
- `startOnFirstInput` controls whether an `input` action with no active
  supervised run starts the target workflow with the mapped input; recommended
  default is true for chat/web-chat bindings and false for non-interactive
  sources.
- intent mapping is binding-owned. Core runtime accepts structured actions and
  simple command tokens. Natural-language text is never executed directly: when
  the deterministic parser does not recognize the first token, the command
  analysis fallback emits a structured command proposal that the runtime
  validates before dispatch. Profiles may still opt into broader LLM-backed
  dispatcher behavior, but that is separate from the required fallback parser.

## Control Command Model

The event supervisor router converts a matched event into an
`EventSupervisorCommand`.

```typescript
interface EventSupervisorCommand {
  readonly commandId: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly action:
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
  readonly targetWorkflowName: string;
  readonly targetWorkflowExecutionId?: string;
  readonly args?: readonly string[];
  readonly rerunFromStepId?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly reason?: string;
  readonly receivedEventReceiptId: string;
}
```

Action semantics:

- `start`: create or reuse a supervisor run for the correlation key, then start
  the target workflow when no active target exists.
- `input`: deliver mapped runtime input to the active supervised workflow. For a
  sticky manager chat workflow this may resume the manager conversation context;
  for a paused user-action workflow it may become a structured user reply in a
  later milestone. If no active supervised run exists, `input` may start one
  only when the binding explicitly enables `startOnFirstInput`.
- `status` / `progress` / `inbox` / `read` / `logs` / `export`: inspect the
  active supervised run or target session and publish a provider-neutral reply.
- `stop` / `cancel`: cancel the active target workflow and mark the supervised
  run stopped or cancelled according to the reconciled target status.
- `restart`: cancel the active non-terminal target if present, then start a new
  target attempt linked to the same supervised run.
- `rerun`: rerun from a validated step id when supplied; otherwise normalize to
  restart according to policy.
- `submit` / `resume`: deliver input to a paused/resumable target execution.

Every command must be idempotent by `commandId`. Replayed webhooks or repeated
chat platform deliveries must not issue duplicate starts, stops, or restarts.

### Intent Mapping Contract

Event adapters may emit structured action fields directly. Bindings may also
map deterministic command tokens from provider-neutral event input. When the
deterministic parser cannot match the first token to a configured command, the
same text is natural language and routes to the command-analysis fallback node.
The fallback node's structured output feeds back into the same runtime
validation path as other privileged actions.

Recommended accepted structured input:

```json
{
  "action": "stop",
  "target": {
    "alias": "release-review"
  },
  "reason": "requested from chat"
}
```

Command-token mapping is deterministic. Bindings may override command strings,
but the default parser always splits by spaces/tabs, treats the first exact
command token as the action, and preserves remaining tokens as `args`:

```json
{
  "intentMapping": {
    "mode": "command-map",
    "inputPath": "event.input.text",
    "commands": {
      "start": ["start"],
      "status": ["status"],
      "progress": ["progress"],
      "inbox": ["inbox", "read"],
      "logs": ["logs"],
      "export": ["export"],
      "stop": ["stop", "cancel"],
      "restart": ["restart"],
      "rerun": ["rerun"],
      "input": ["input", "submit", "resume"]
    },
    "naturalLanguageFallback": "command-analysis"
  }
}
```

Command-analysis resolver settings should be explicit in binding or supervisor
profile config, even though the fallback path is the default behavior for
unknown first-token text:

```json
{
  "intentMapping": {
    "mode": "command-map",
    "inputPath": "event.input.text",
    "resolverWorkflowName": "divedra-default-workflow-supervisor",
    "resolverNodeId": "command-analysis",
    "minConfidence": 0.8,
    "fallbackAction": "proposal",
    "allowMultiTargetCommands": false
  }
}
```

The LLM node output is a structured command proposal, not an authority boundary.
The runtime must validate at least:

- the proposed action is allowed by the binding
- the proposed workflow target matches the receiving supervisor's managed
  workflow or an explicit supervised run id
- confidence is at or above the configured threshold
- destructive multi-target actions are not ambiguous
- command idempotency is preserved per event and candidate supervisor

Unsupported or disallowed actions should be recorded as skipped event receipts
and, when the source supports replies, published as a provider-neutral rejection
reply.

## Supervised Run Persistence

Add a durable association record keyed by event source scope and supervisor run:

```typescript
interface EventSupervisedRunRecord {
  readonly supervisedRunId: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly supervisorWorkflowName: string;
  readonly supervisorExecutionId?: string;
  readonly targetWorkflowName: string;
  readonly activeTargetExecutionId?: string;
  readonly status:
    | "starting"
    | "running"
    | "stopping"
    | "stopped"
    | "restarting"
    | "completed"
    | "failed";
  readonly restartCount: number;
  readonly maxRestartsOnFailure: number;
  readonly autoImproveEnabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

Recommended artifact layout:

```text
{DIVEDRA_ARTIFACT_DIR}/events/supervised-runs/{supervisedRunId}/
  record.json
  commands/
    {commandId}.json
  attempts/
    attempt-0001.json
    attempt-0002.json
```

SQLite should index `sourceId`, `bindingId`, `correlationKey`,
`supervisorExecutionId`, and `activeTargetExecutionId` for control-plane lookup.

### Concurrency And Idempotency

The supervised run record is the lifecycle authority for a binding correlation
key. Implementations must serialize commands per
`sourceId + bindingId + correlationKey` before mutating the record.

Rules:

- create one active supervised run per correlation key by default
- persist the command record before executing the command
- treat duplicate `commandId` values as idempotent replay and return the stored
  command result
- process `stop` and `restart` commands against the active target execution id
  captured at command start, then re-check the record before saving
- reject or require an explicit target alias when a binding allows multiple
  active supervised runs for one conversation
- record all target attempts under the same `supervisedRunId`

The first implementation may use SQLite transactions or repository-level file
locks. It must not rely on in-memory maps because `events serve --endpoint` and
library/web-app usage can run in separate processes.

### Status Model

Supervisor-facing status should be distinct from raw target workflow status:

- `starting`: command accepted, supervisor or target launch in progress
- `running`: supervisor has an active non-terminal target execution
- `stopping`: stop accepted and cancellation is being applied
- `stopped`: stopped by user/operator command
- `restarting`: restart accepted and a replacement target is being launched
- `completed`: target completed successfully and no active lifecycle command
  remains
- `failed`: supervisor failed, restart budget was exhausted, or target failed
  without an allowed restart

Event replies and web-app APIs should expose both the supervisor status and the
active target workflow status when known.

## Event Flow Examples

### Chat Start Then Stop

1. User sends `start release review` in a chat thread.
2. Chat adapter emits `chat.message`.
3. Binding maps the event to `action = "start"` and
   `workflowName = "release-review"`.
4. Event supervisor router starts or resumes
   `divedra-default-workflow-supervisor` for the thread correlation key.
5. Supervisor starts the target workflow and persists the association.
6. User later sends `stop` in the same chat thread.
7. The same binding maps the event to `action = "stop"`.
8. Router finds the supervised run by the correlation key and sends the command
   to the active supervisor execution.
9. Supervisor cancels the active target workflow and publishes a reply.

### Web App Library Usage

A web app embedding divedra should prefer a supervisor client rather than
calling raw workflow execution for interactive jobs:

```typescript
interface WorkflowSupervisorClient {
  start(input: StartSupervisedWorkflowInput): Promise<SupervisedWorkflowView>;
  stop(input: StopSupervisedWorkflowInput): Promise<SupervisedWorkflowView>;
  restart(
    input: RestartSupervisedWorkflowInput,
  ): Promise<SupervisedWorkflowView>;
  status(input: SupervisedWorkflowLookup): Promise<SupervisedWorkflowView>;
  submitInput(
    input: SubmitSupervisedWorkflowInput,
  ): Promise<SupervisedWorkflowView>;
}
```

The library client should use the same runtime services as the event supervisor
router. GraphQL should expose equivalent mutations/queries so remote web apps
do not need local filesystem access.

## Control Plane Requirements

Add or expose these API-level capabilities:

- library `cancelWorkflowExecution` parity with GraphQL
- library `createWorkflowSupervisorClient(...)` and `createWorkflowSupervisorGraphqlClient(...)` for remote control-plane calls
- GraphQL `dispatchSupervisedWorkflowCommand` mutation plus read-only `supervisedWorkflowRun` query (correlation or supervised-run id lookup)
- event router support for local library mode and remote GraphQL endpoint mode
- receipt records that link event command ids to supervised run ids and target
  workflow execution ids

GraphQL may initially implement supervisor operations as a thin service over
existing execution mutations, but the public contract should be supervised-run
oriented rather than exposing chat/web clients to raw target execution
mechanics.

### API Shape

The supervisor API should be command-oriented and correlation-aware:

```typescript
interface StartSupervisedWorkflowInput {
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly targetWorkflowName: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly policy?: SupervisedWorkflowPolicyInput;
  readonly idempotencyKey?: string;
}

interface StopSupervisedWorkflowInput {
  readonly supervisedRunId?: string;
  readonly sourceId?: string;
  readonly bindingId?: string;
  readonly correlationKey?: string;
  readonly reason?: string;
  readonly idempotencyKey?: string;
}
```

The GraphQL `dispatchSupervisedWorkflowCommand` mutation enforces the same
supervised-mode invariants as the library path: `binding.execution.mode` must be
`"supervised"`, optional `runtimeVariables` must be a JSON object when present,
command-scoped `runtimeVariables` must also be objects, and the binding is
validated with the same supervised policy checks used for event configuration
(`maxRestartsOnFailure`, `intentMapping`, `allowActions`, and related fields).
Optional `command.supervisedRunId` scopes the mutation to that durable supervised
run row; when set it must match `sourceId`, `bindingId`, `correlationKey`, and
`targetWorkflowName`, and must not disagree with the correlation's currently
active supervised run (except for correlation-only `start` without a scoped id).
`supervisedWorkflowRun` rejects empty correlation-key components when querying by
correlation. The remote GraphQL supervisor client parses `supervisedRun` and
`activeTargetStatus` fields instead of accepting arbitrary JSON shapes.

Lookup by `supervisedRunId` is authoritative. Lookup by
`sourceId + bindingId + correlationKey` is allowed for event-source convenience.
If a lookup is ambiguous, the API must reject it rather than guessing.

### Remote Event Listener Mode

When `events serve --endpoint <graphql-url>` is used, supervised bindings should
not start or inspect target workflows locally. The event listener should:

1. normalize and persist the event receipt locally or in the configured runtime
   data root
2. build an `EventSupervisorCommand`
3. call the remote GraphQL supervisor operation
4. record the remote `supervisedRunId`, supervisor execution id, and active
   target execution id on the event receipt

This keeps event processes lightweight while still letting the control-plane
server own workflow state.

## Direct Mode Versus Supervised Mode

Direct mode:

- starts a target workflow directly
- records the resulting workflow execution id on the event receipt
- cannot reliably resolve later chat commands unless the caller provides an
  explicit workflow execution id
- remains appropriate for cron, object-storage, and one-shot webhook automation

Supervised mode:

- starts a supervisor workflow first or resumes an existing supervisor workflow
- stores event-source correlation state
- supports stop, restart, status, and input commands from later events
- is the recommended mode for chat and web app integrations

## Contradictions And Resolution

### Supervisor As Workflow Versus Runtime Privilege

An ordinary workflow should not be able to cancel arbitrary executions, but a
supervisor needs cancellation and rerun authority. Resolution: the supervisor is
ordinary in authored workflow shape, but it receives runtime-scoped system
capabilities limited to its supervised run.

### Default Supervision Versus Existing Auto-Improve Flag

The existing implementation couples supervision language to `autoImprove`.
The requested default is supervision without auto-improvement. Resolution:
separate "supervised lifecycle management" from "auto-improve remediation".
`autoImprove` becomes an optional policy inside supervised execution rather than
the only way to get a supervisor.

### Restart Meaning

Existing runtime has step rerun semantics. Chat users usually expect "restart"
to mean "run the workflow again from the beginning." Resolution: event-level
`restart` means cancel active target if needed, then start a new target attempt
from the workflow entry/manager anchor. Step-targeted rerun remains a lower
level operation and should require explicit structured input.

### Stop Is Not Immediate Process Kill

Current GraphQL cancellation marks a workflow execution cancelled. Backend
processes may not stop instantly unless their adapter observes abort/cancel
state. Resolution: the design should expose `stopping` and `cancelled` states
separately when needed, and implementation should harden cancellation
propagation in adapters as a follow-up task.

### Multiple Active Workflows In One Chat

A conversation/thread key may map to more than one target workflow. Resolution:
the default lookup is one active supervised run per
`sourceId + bindingId + conversation/thread`. Bindings that allow multiple
parallel runs must require an explicit `supervisedRunId` or user-facing target
alias for stop/restart/status commands.

### Natural Language Commands

The core runtime cannot safely decide by itself that arbitrary text means stop
or restart. Resolution: adapters or bindings may emit structured actions, slash
commands, buttons, or deterministic command-token mappings. When the first text
token is not a known command, the default supervised path treats the message as
natural language and routes it to a command-analysis LLM node. The node decides
whether the text targets the workflow it manages and emits a structured command
proposal. Privileged action execution still consumes only runtime-validated
structured commands, and the supervisor itself remains deterministic.

Explicit `llm-command` or broader LLM-backed dispatcher modes remain available
only as opt-in profile behavior for richer dispatch, direct answers, or
multi-workflow selection. They do not replace the required deterministic
first-token parser plus command-analysis fallback.

For multi-run chat, the default remains conservative: if multiple supervisors
return destructive actions such as `stop` or `restart` and the message does not
identify the intended workflow or supervised run, the router rejects the command
as ambiguous and publishes a clarification reply. Bindings may opt into
multi-target fanout for non-destructive actions such as `status` and `input`, or
for destructive actions only when an explicit workflow reference is present.

### Naming: Supervisor Versus Superviser

Existing engine identifiers and persisted auto-improve fields still use
`superviser` spellings for compatibility. Operator-facing event control,
canonical CLI flags (`--supervisor-workflow`, `--nested-supervisor`), and new
GraphQL/event surfaces use `supervisor` with documented legacy aliases. A broad
internal rename of auto-improve modules remains optional and deferred.

## Implementation Phasing

Phase 1 should implement a deterministic lifecycle supervisor foundation without
auto-improve patching:

- event binding schema and validation for supervised mode
- supervised run repository and command idempotency
- local library `WorkflowSupervisorClient`
- GraphQL wrapper operations
- event router integration for local and remote modes

Phase 2 should implement the deterministic in-process runner-pool default. It
packages `divedra-default-workflow-supervisor` as the supervisor identity and
routes validated lifecycle commands to a native runner-pool service that starts,
tracks, cancels, resumes, and reruns workflow executions asynchronously in the
same process. This phase must not shell out to a configured `divedra` binary for
deterministic target lifecycle, inspection, or event-source command handling.

Phase 3 should add richer chat/web examples, status replies, and optional
auto-improve handoff. Automatic workflow patching stays out of Phase 1.

Phase 4 natural-language supervisor control is implemented in-tree: the explicit
`llm-command` intent mapping, resolver workflow output under the resolver node
`output.json` payload, `resolveSupervisorIntentAsync`,
`planSupervisedLlmBindingsDispatch`, strict parsing via
`parseSupervisorChatCommandDecision`, and library/GraphQL `dispatchSupervisorChat`
(synthetic chat envelope, same dispatch pipeline as adapters). When callers pass
`threadId` without `conversationId`, the library uses `sourceId` as
`event.conversation.id` so `conversation.id` and `conversation.threadId` stay
distinct for correlation templates that mirror webhook payloads. See "Phase 4
implementation" under Current State. Optional follow-ups: tighter chat-reply
integration for ambiguity text (beyond skipped receipts), and deeper internal
`superviser` to `supervisor` renames in auto-improve modules where not already
done for public surfaces.

### Phase 1 implementation notes (current tree)

The Phase 1 codebase implements the public contract above through
`WorkflowSupervisorClient`, the SQLite-backed supervised-run repository, and
GraphQL `dispatchSupervisedWorkflowCommand` / `supervisedWorkflowRun`. Target
lifecycle in the current tree already uses existing `runWorkflow` / session
cancel paths. Phase 2 should keep that in-process execution model, formalize it
behind the runner pool, persist command/run records, and populate
`supervisorExecutionId` or its successor runner-pool identity when the durable
supervisor run is created.

## Implementation Milestones

1. Add event binding validation for `execution.mode = "supervised"` and
   supervised control policy fields.
2. Add supervised run persistence and command idempotency records.
3. Add an event supervisor router that maps events to structured
   `EventSupervisorCommand` objects.
4. Add library cancel parity and a local `WorkflowSupervisorClient`.
5. Add GraphQL supervised workflow wrappers or equivalent typed mutations.
6. Package `divedra-default-workflow-supervisor` as a system workflow.
7. Route supervised event commands through local library mode and remote GraphQL
   endpoint mode.
8. Add chat/web-chat examples that start, stop, restart, and query status from
   one conversation.
9. Harden cancellation propagation in workflow adapters if current cancel
   behavior only updates persisted workflow execution state.
10. **Completed:** explicit `llm-command` natural-language control with structured
    supervisor decisions and runtime validation (see Phase 4 section).

## References

- `design-docs/specs/design-event-listener-workflow-trigger.md`
- `design-docs/specs/design-auto-improve-superviser-mode.md`
- `design-docs/specs/design-graphql-manager-control-plane.md`
- `design-docs/specs/architecture.md`
