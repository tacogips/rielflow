# Scheduled Workflow Execution From Chat

This document defines the design for chat-originated schedule registration and
later workflow execution through the existing divedra event runtime.

## Overview

A chat event such as `run release-review at 9:00` should not execute workflow
code directly from provider-specific chat logic. The chat source should
normalize the message, route it through a schedule-registration workflow, and
persist a user schedule that later enqueues due workflow execution through the
shared scheduled event manager.

The same event pool is the runtime boundary for three scheduled work kinds:

- `workflow-sleep`: resume a paused workflow session.
- `cron`: dispatch a configured cron event source occurrence.
- `workflow-schedule`: dispatch a user-created scheduled workflow run.

Schedule registration, schedule execution re-arming, and `divedra events serve`
startup must all enqueue the next due `workflow-schedule` event into the shared
event pool. Provider adapters, agent backends, Codex, and Cursor do not own
schedule semantics.

## Goals

- Let chat users register one-time and recurring workflow executions by natural
  language.
- Resolve the requested workflow name against the divedra workflow catalog and
  usage summaries before scheduling.
- Ask for clarification when workflow, time, timezone, recurrence, or required
  workflow input is missing or ambiguous.
- Persist schedule definitions separately from authored workflow bundles and
  event-source config.
- Enqueue the next due execution on schedule registration, after each recurring
  schedule fires, and when the event listener service starts.
- Dispatch due scheduled workflow executions through the existing event binding,
  receipt, dedupe, runtime-variable mapping, and supervised execution path.
- Keep existing cron and workflow-sleep behavior compatible.

## Non-Goals

- Adding provider-specific slash command or button semantics in the first slice.
- Letting arbitrary chat text become shell arguments or workflow names.
- Replacing authored cron sources; cron remains the static configured schedule
  mechanism.
- Distributed multi-process locking in the first implementation.
- Making `codex-agent` or `cursor-cli-agent` define schedule parsing,
  persistence, or execution semantics.

## Runtime Flow

Complete schedule registration:

```text
chat provider event
  -> chat source adapter normalizes chat.message
  -> event binding starts schedule-registration workflow
  -> LLM planner returns structured schedule intent
  -> runtime validates workflow reference, time, timezone, recurrence, input
  -> schedule registry persists a workflow schedule
  -> scheduled event manager receives the next workflow-schedule event
  -> chat reply confirms the selected workflow and next due time
```

Incomplete or unsafe schedule registration:

```text
chat provider event
  -> schedule-registration workflow
  -> structured decision needs clarification or refuses
  -> safe reply destination check
  -> if safe, chat reply asks the smallest missing question or refusal reason
  -> if unsafe, no chat reply is dispatched
  -> no schedule is persisted
```

Due schedule execution:

```text
scheduled event manager fires workflow-schedule
  -> schedule registry marks an execution attempt
  -> external event envelope eventType = workflow.schedule.due
  -> existing event binding / trigger runner path
  -> supervised workflow execution by workflowName
  -> one-time schedule completes or recurring schedule computes next due event
```

Startup recovery:

```text
events serve startup
  -> load persisted active schedules
  -> compute next due occurrence for each schedule
  -> enqueue due or next future workflow-schedule events
  -> start event sources and shared scheduled event manager
```

## Schedule Registration Workflow

The schedule-registration workflow is an ordinary divedra workflow invoked from
a chat event binding. Its output must be structured. A ready decision includes:

- selected workflow name and workflow source scope or directory when available
- confidence and candidate list used for workflow resolution
- schedule kind: `one-time` or `recurring`
- timezone
- next due time for one-time schedules or cron expression for recurring
  schedules
- optional end policy for recurring schedules
- workflow runtime input object
- human-readable confirmation text

The binding-level schedule-registration execution policy is intentionally
narrow. It identifies the resolver workflow and resolver node, and may set a
minimum confidence threshold. It must not grow a second path-selection language
for resolver input or timezone lookup.

Event binding `inputMapping` remains the only operator-authored mechanism for
selecting which event fields are delivered to the resolver workflow. When an
operator wants the resolver to see a timezone, channel preference, command
argument, or nested provider field, that value must be mapped into the resolver
workflow input through the existing `inputMapping` template or `event-input`
mode. The resolver decision then carries the selected schedule timezone in its
structured `schedule.timezone` field, which the runtime validates before
persistence.

Clarification decisions include:

- missing or ambiguous fields
- candidate workflows when name matching is ambiguous
- a concise question to ask the chat user
- no schedule mutation

Validation is runtime-owned. The LLM may propose a schedule, but the runtime
must reject invalid workflow names, unsafe runtime input, local-time-only
timestamps without a chosen timezone, invalid cron expressions, ambiguous
workflow matches, and schedules whose next due time cannot be computed.

## Workflow Catalog Resolution

The planner should receive compact workflow usage data rather than filesystem
paths. Use existing catalog and usage surfaces:

- `src/workflow/catalog.ts`
- `src/workflow/usage.ts`
- `workflow usage [name]`
- `workflow list --output json`

Resolution rules:

- Exact workflow-name matches win.
- Scoped catalog resolution follows existing project/user/direct precedence.
- Fuzzy or semantic matches may be suggested only as candidates; they require
  clarification unless one candidate is clearly dominant and the reply confirms
  the selected workflow before persistence.
- Hidden filesystem paths and raw workflow bundle contents are not exposed to
  chat users.
- Required callable input should come from workflow usage metadata when
  available; missing required input produces clarification.

## Schedule Registry

Persist schedules as runtime state, not authored event-source configuration.
The registry can be backed by the same runtime data root used for event
receipts and sessions. Records should be JSON-serializable and include:

- schedule id
- source chat event receipt id and conversation/thread correlation
- selected workflow name and resolved source metadata
- schedule kind: `one-time` or `recurring`
- timezone
- one-time due timestamp or recurring cron expression
- next due timestamp
- status: `active`, `paused`, `completed`, `cancelled`, or `failed`
- workflow runtime input
- dedupe material for due executions
- created/updated timestamps and actor metadata
- last execution id, last fired time, attempt count, and last error

The first implementation should expose a narrow repository/API surface for
create, load active, list, cancel, mark firing, mark completed, mark failed, and
compute/register next due event. Updating arbitrary schedule fields can remain a
later extension.

## Scheduled Event Contract

The shared scheduled event manager should add `workflow-schedule` to the event
kind set. A registered due event payload should include:

- schedule id
- occurrence id
- workflow name and source metadata
- scheduledAt and timezone
- schedule kind
- event root and binding id used for dispatch when applicable

The fired normalized envelope uses:

```json
{
  "provider": "divedra-scheduler",
  "eventType": "workflow.schedule.due",
  "input": {
    "scheduleId": "sched_123",
    "workflowName": "release-review",
    "scheduledAt": "2026-05-19T00:00:00.000Z",
    "timezone": "Asia/Tokyo"
  }
}
```

Dedupe keys must include schedule id and occurrence id or scheduled timestamp.
Recurring schedules re-arm only after the current occurrence has been accepted
or terminally failed according to the missed-run policy.

## Event Binding And Execution

Due schedule execution should reuse the event trigger path rather than calling
the workflow engine directly from the timer callback. This preserves:

- event receipts
- replay and read-only behavior
- input mapping
- output destination routing
- supervised execution policy
- duplicate detection

The internal scheduler source can be represented as a runtime-owned source with
provider `divedra-scheduler` and event type `workflow.schedule.due`. Bindings
may be generated internally from the persisted schedule record, or routed
through a dedicated scheduler dispatch binding. The implementation plan should
pick the smaller change that still records normal event receipts.

Schedule-registration bindings must follow the same boundary:

- source event data is first normalized into an event envelope;
- binding `inputMapping` converts that envelope into resolver
  `runtimeVariables.workflowInput`;
- the trigger runner invokes the resolver workflow with that mapped input;
- the runtime validator consumes only the resolver's structured decision plus
  binding policy such as `minConfidence`;
- due scheduled executions use the persisted schedule `workflowInput` through
  the generated `{{event.input.workflowInput}}` mapping.

`inputPath` and `timezonePath` are not valid schedule-registration policy
fields. They duplicate `inputMapping`, make configuration appear active even
when the runtime ignores it, and split timezone ownership between the binding
and the resolver decision. Implementations should remove these fields from the
active `EventWorkflowScheduleRegistrationPolicy` surface. If compatibility
requires accepting older broad policy objects, validation must reject
`execution.inputPath` and `execution.timezonePath` when
`execution.mode === "schedule-registration"` with a migration message that
points operators to `inputMapping`.

## Chat Replies

Schedule registration replies use the chat task-planning lifecycle:

- `received`: chat event accepted, only when the binding has a safe reply
  destination.
- `plan-or-question`: selected workflow and schedule proposal, or question.
- `clarification`: missing workflow, time, timezone, recurrence, or input, only
  when the binding has a safe reply destination.
- `starting`: only for the schedule-registration workflow itself, not for the
  later scheduled target workflow.
- confirmation: schedule persisted with schedule id and next due time, only
  when the binding has a safe reply destination.

A later scheduled execution may publish ordinary workflow outputs through the
selected target workflow's configured destinations. It should not assume the
original chat thread is always the final result destination unless the schedule
record or binding explicitly carries that destination.

## Schedule Registration Safety Contract

Schedule registration is a trust boundary between resolver output and durable
runtime state. A `ready` resolver decision is only a proposal until the runtime
validator proves the workflow, confidence, time, timezone, recurrence, input
shape, and reply-safety requirements.

When a schedule-registration binding sets `minConfidence`, the resolver decision
must include a numeric `confidence`. Missing confidence is not equivalent to a
passing score. If confidence is missing or below the configured threshold, the
runtime must not persist a schedule. It should ask the smallest workflow
selection clarification when a safe reply destination exists, and otherwise
refuse the registration.

The trigger runner must compute schedule-registration reply safety once per
dispatch attempt and use that same decision for every chat reply path. When the
binding has no safe reply destination, the runner must suppress received
progress replies, resolver clarification replies, runtime clarification replies,
refusal replies, and confirmation replies. Suppression must not change the
receipt outcome: unsafe clarification or refusal still records a skipped receipt
with the validator decision, and successful schedule creation still records and
enqueues the schedule without assuming a chat reply can be delivered.

One-time `dueAt` validation must be independent of the host process timezone:

- `dueAt` values with `Z` or a numeric UTC offset represent an absolute instant
  and must keep that instant unchanged.
- offset-less wall-clock values such as `2026-05-19T09:00:00` are valid only
  with a valid `schedule.timezone`; the runtime resolves them as local wall time
  in that IANA timezone before storing canonical UTC `nextDueAt`.
- invalid, ambiguous, or unresolvable wall-clock values produce clarification
  when a safe reply destination exists and refusal otherwise.

The persisted schedule should keep the user-facing schedule timezone alongside
the canonical UTC due/next-due timestamp so later inspection can show both the
requested local time context and the runtime execution instant.

## CLI And Operator Surface

The first operator surface should be inspection and cancellation, not a parallel
manual scheduler authoring language. Chat/workflow registration remains the
primary schedule creation path.

Recommended commands:

- `events schedules list [--source <id>] [--status <status>] [--limit <n>]`
- `events schedules inspect <schedule-id> [--output json]`
- `events schedules cancel <schedule-id> [--reason <text>]`

Validation remains on:

- `events validate --event-root <path>`
- `workflow usage [name]`
- `workflow list --output json`

## Validation Rules

Schedule creation fails when:

- the selected workflow cannot be resolved through the catalog
- the workflow match is ambiguous
- `minConfidence` is configured and resolver confidence is missing or below the
  configured threshold
- the requested due time is local-only and no timezone is known
- a one-time offset-less due time cannot be resolved in the selected IANA
  timezone
- the timezone is invalid
- a recurring schedule has an invalid five-field cron expression
- no future occurrence can be computed
- required workflow input is missing
- mapped workflow input is not a JSON object
- a schedule-registration binding sets `execution.inputPath` or
  `execution.timezonePath` instead of using binding `inputMapping`
- the chat source lacks a safe reply destination for clarification
- the runtime is in read-only event mode

Schedule firing fails or records a failed attempt when:

- the persisted schedule no longer exists or is inactive
- the occurrence id has already fired
- event receipt creation fails
- workflow dispatch fails before a supervised run id or workflow execution id is
  recorded

## Missed Runs And Restart Policy

The first design default is conservative:

- one-time schedules whose due time passed while divedra was stopped fire once
  on startup, then complete
- recurring schedules enqueue only the next due occurrence on startup by
  default; catch-up of every missed occurrence is out of scope
- duplicate startup or replay attempts are blocked by occurrence dedupe keys
- failed occurrences keep the schedule active only when a next recurrence can
  be computed and the failure happened after receipt creation

Alternative missed-run policies are tracked in user Q&A.

## Rollout Constraints

- Keep `workflow-schedule`, `cron`, and `workflow-sleep` on one scheduled event
  manager.
- Do not store schedules under workflow definition directories or authored
  `.divedra-events` config.
- Do not add or preserve a parallel schedule-registration path policy for
  resolver input or timezone selection; use event binding `inputMapping`
  instead.
- Preserve existing cron source config and receipt behavior.
- Preserve event replay semantics; replaying a due schedule receipt must not
  mutate the schedule registry unless replay explicitly requests it.
- Keep provider-specific chat behavior behind adapter modules.
- Keep Cursor-specific behavior behind Cursor adapter/readiness modules.
- Treat `codex-agent` only as a backend and workflow-authoring reference.

## Codex Reference Mapping

The expected local reference root is `../../codex-agent`. It was not available
during this design update, so no codex-agent files were inspected. This feature
does not intentionally diverge from Codex behavior because Codex does not own
event scheduling semantics in divedra. Relevant backend references remain
limited to preserving agent backend isolation for `codex-agent` and
`cursor-cli-agent` when scheduled workflows eventually execute worker nodes.

## Open Questions

User-facing confirmation items are tracked in
`design-docs/user-qa/qa-scheduled-workflow-execution.md`.

## Verification Commands

```bash
rg -n "workflow-schedule|workflow.schedule.due|events schedules" design-docs src examples README.md
bun run typecheck
bun test src/events/workflow-schedule-registration.test.ts src/events/workflow-schedule-dispatch.test.ts src/events/workflow-schedule-registry.test.ts
bun run lint:biome
bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events
bun test src/events/scheduled-event-manager.test.ts src/events/adapters/cron.test.ts src/events/listener-service.test.ts
bun test src/events/trigger-runner*.test.ts src/events/*task-planning*.test.ts src/events/*supervisor*.test.ts
bun test src/cli.test.ts
bun run src/main.ts workflow list --workflow-definition-dir ./examples --output json
```

## References

- `design-docs/specs/design-scheduled-sleep-node-runtime.md`
- `design-docs/specs/design-event-listener-workflow-trigger.md`
- `design-docs/specs/design-chat-task-planning-lifecycle.md`
- `design-docs/specs/design-chat-sdk-event-sources.md`
- `src/events/scheduled-event-manager.ts`
- `src/events/adapters/cron.ts`
- `src/events/task-planning.ts`
- `src/workflow/catalog.ts`
- `src/workflow/usage.ts`
