# Scheduled Sleep Node Runtime

This document defines the design for a non-blocking workflow sleep node and the
shared scheduled event manager used by both sleep continuation and cron event
sources.

## Overview

Workflows need a runtime-owned sleep node that pauses execution until a future
time without blocking the executor process. When the engine reaches a sleep
node, it should register a resumable scheduled event and return control to the
runtime. A scheduled event manager owns the in-process timer for the next due
event, fires events that are already due, and re-arms itself whenever the event
pool changes.

Cron must use the same scheduled event manager. A cron source registers its next
occurrence as a scheduled event; after that event fires, cron computes and
registers the following occurrence through the same pool.

## Runtime Boundaries

Recommended ownership:

- `src/workflow/` owns sleep node validation, session pause/continuation
  semantics, and step-addressed resume targets.
- `src/events/` owns the scheduled event manager, event pool lifecycle, cron
  occurrence registration, cancellation, and due-event dispatch.
- `src/workflow/runtime-db/` should persist scheduled events when durable sleep
  and cron recovery are required.
- `src/events/listener-service.ts` should start and stop the shared event
  manager alongside event source listeners.

The workflow node executor must not implement sleep by awaiting a long timer or
blocking a worker. It should create a scheduled continuation event and mark the
session so ordinary runtime inspection can show that the workflow is waiting on
a scheduled event.

## Sleep Node Contract

Authored sleep nodes use `nodeType: "sleep"` and a `sleep` payload. The payload
supports either a relative duration or an absolute wake time with an explicit
timezone or UTC offset. Both forms are runtime scheduling requests, not agent
backend work.

Relative duration shape:

```json
{
  "id": "wait-for-window",
  "nodeType": "sleep",
  "variables": {},
  "sleep": {
    "durationMs": 30000
  }
}
```

Absolute wake-time shape:

```json
{
  "id": "wait-for-window",
  "nodeType": "sleep",
  "variables": {},
  "sleep": {
    "until": "2026-05-15T12:00:00+09:00"
  }
}
```

Validation rules:

- `nodeType: "sleep"` is worker-only and invalid for manager-role steps.
- `sleep.durationMs`, when present, must be a positive integer.
- `sleep.until`, when present, must be a parseable timestamp with an explicit
  timezone or UTC offset; local-time-only strings are invalid.
- exactly one of `sleep.durationMs` or `sleep.until` is required.
- `executionBackend`, `model`, `promptTemplate`, `command`, `container`,
  `userAction`, and `durability` are invalid on sleep nodes.
- `variables` remains required for consistency with other node payloads.

## Commit Review Hardening Scope

Commit `b93ca6ad4cf2711ec7b919056f561e35cf6681ee` introduced the scheduled
sleep runtime and made cron share the scheduled event manager. Issue-resolution
review for this commit should preserve the design above while checking these
boundaries for high and mid severity defects:

- scheduled events are owned by the session ref, event id, node id, and
  node execution id; stale timer callbacks must not resume cancelled, rerun,
  replaced, terminal, or non-owning sessions
- cancellation and terminal finalization update both the manager event status
  and the workflow session `scheduledEvents` ref when the ref is still pending
- rerun and direct-step replacement cancel stale pending sleep events only after
  the target has been validated enough to avoid losing the still-valid paused
  session on a failed rerun request
- scheduled callback failures mark the manager event `failed` and keep an
  operator-visible failed session ref instead of silently re-arming or reviving
  superseded work
- public library execution paths that can run, continue, or rerun workflows
  propagate the caller-provided `scheduledEventManager` so tests and embedding
  applications can share one manager with cron sources
- cron registration, re-arming, stop behavior, dedupe, input mapping, and event
  receipt behavior remain on the existing event-listener path after moving
  timers behind the shared manager
- validation and examples document both `durationMs` and explicit-offset
  `until` while rejecting mixed or backend-specific sleep payloads

The review should not broaden scope into unrelated chat event-source files or
implementation plans unless a scheduled sleep regression directly requires it.

## Scheduled Event Pool

The scheduled event pool stores normalized due work. Each event needs:

- stable event id
- event kind: `workflow-sleep` or `cron`
- due time in epoch milliseconds or ISO UTC
- status: pending, firing, fired, cancelled, failed
- dedupe key scoped to the source event
- target workflow execution/session id when continuing a workflow
- target step id or transition continuation metadata
- source id and binding id for cron events
- attempt and last error metadata for audit

The event manager should:

- load pending events on start
- fire every event whose due time has passed
- keep one process-local timer for the next pending due time
- re-arm the timer after registration, cancellation, replacement, and firing
- tolerate about 500ms precision
- avoid duplicate firing through stable event ids and atomic status transitions
- cancel scheduled events when the owning workflow session is cancelled, rerun,
  or reaches a terminal state

Distributed locking is out of scope for the first implementation. The design is
compatible with adding a durable lock later around the pending-to-firing status
transition.

## Workflow Sleep Lifecycle

Sleep continuation is session lifecycle state, not agent backend behavior. When
the runtime reaches a sleep node, it records the node execution and handoff
artifacts, stores the selected outbound transitions, queues the selected next
steps, and marks the workflow session as `paused` with a `scheduledEvents`
entry whose status starts as `pending`. The queued next steps are intentionally
not runnable until the scheduled event fires and the workflow is resumed through
the normal session resume path.

When the scheduled event fires, the event manager moves the event through
`firing` and calls the workflow resume boundary for the owning session. The
resume path must re-load the session before continuing. If the session is still
paused and still owns the matching pending scheduled event, the session ref is
marked `fired` and normal queued-step execution resumes. If the session was
cancelled, rerun, replaced, failed, succeeded, or otherwise made terminal before
the fire callback runs, the callback must not revive it.

First-milestone cancellation rules:

- workflow cancellation cancels all pending `workflow-sleep` events for that
  workflow execution id and marks matching session refs `cancelled`
- workflow rerun or step replacement cancels stale pending sleep events before
  registering replacement work, so an old timer cannot resume superseded state
- terminal session finalization cancels any remaining pending sleep events for
  the session
- event fire failure marks the event manager record `failed`; if the owning
  session can still be updated, the matching scheduled-event ref is marked
  `failed` with the session's existing failure reporting path carrying the
  operator-visible error
- cancellation is best-effort in the process-local manager; the resume callback
  must still treat the persisted or in-memory session state as authoritative

These rules cover the current issue-resolution scope while preserving the
future durable event-pool boundary. Restart recovery can later reload pending
records and apply the same ownership checks before firing.

## Open Questions

These are implementation-planning decisions that should be resolved before or
during Step 4 planning. They do not change the core requirement that sleep and
cron share one scheduled event manager.

User-facing confirmation items are tracked in
`design-docs/user-qa/qa-scheduled-sleep-node-runtime.md`.

- whether the first implementation must recover pending sleep and cron events
  after a process restart, or may start with process-local scheduling while
  preserving the durable event-pool interface
- exact operator-facing retry or repair controls for failed scheduled
  continuation events after the first milestone

## Cron Integration

Cron remains an event source, not a workflow node. The cron adapter should no
longer own independent long-lived timers. Instead, it computes the next
occurrence and registers a `cron` scheduled event with the manager.

When a cron event fires:

1. the event manager dispatches the normalized cron event through the existing
   event binding and workflow trigger path;
2. the cron adapter or scheduler computes the next occurrence from the schedule,
   timezone, missed-run policy, and jitter rules;
3. the next occurrence is registered in the scheduled event pool;
4. the manager re-arms the process-local timer for the earliest pending event.

Missed cron occurrences whose scheduled time is already in the past should be
handled according to existing cron missed-run policy. A due scheduled event
should execute promptly instead of waiting for a future tick.

## Rollout Constraints

- Keep sleep and cron on the same manager-backed scheduling path.
- Preserve existing cron source config, binding, input mapping, dedupe, and
  event receipt behavior.
- Keep schedule precision approximate; 500ms is acceptable.
- Keep Cursor-specific or provider-specific behavior out of the scheduled event
  manager. Agent backends such as `codex-agent` are unrelated to scheduling
  semantics.
- Add tests for sleep registration, due sleep continuation, cancellation,
  missed/due event firing, cron next-occurrence registration after firing, and
  manager re-arming after pool changes.

## References

- `design-docs/specs/design-event-listener-workflow-trigger.md`
- `design-docs/specs/design-workflow-json.md`
- `src/events/adapters/cron.ts`
- `src/events/listener-service.ts`
- `src/workflow/engine/node-execution.ts`
- `src/workflow/engine/step-transition-finalization.ts`
