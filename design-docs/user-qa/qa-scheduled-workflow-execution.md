# Scheduled Workflow Execution Q&A

These user decisions refine scheduled workflow execution from chat event
sources. The implementation can proceed with the proposed defaults in the
design document unless a product decision overrides them.

## Questions

### Default Timezone For Chat Requests

When a user says `run release-review at 9:00` without a timezone, which
timezone should be used?

Options:

- Use the chat source or conversation configured timezone when present;
  otherwise ask for clarification.
- Always ask for clarification unless the user included an explicit timezone.
- Use the server timezone.

Recommended default: use configured chat source or conversation timezone only
when explicit in config; otherwise ask.

### Missed Recurring Runs

When divedra starts after downtime and a recurring schedule missed multiple
occurrences, what should happen?

Options:

- Enqueue only the next due occurrence and skip earlier missed occurrences.
- Fire one catch-up occurrence, then compute the next future occurrence.
- Fire every missed occurrence up to a configured cap.

Recommended default: enqueue only one due occurrence on startup.

### Schedule CRUD Scope

Should the first implementation include schedule creation through CLI, or only
chat/workflow registration plus operator inspection and cancellation?

Options:

- Chat/workflow creation only; CLI supports list, inspect, and cancel.
- Add manual CLI creation in the first implementation.
- Defer all CLI schedule commands.

Recommended default: chat/workflow creation only, with list/inspect/cancel for
operators.

### Result Delivery Destination

Should scheduled target workflow results automatically reply to the original
chat thread?

Options:

- Only when the schedule record or event binding explicitly carries that
  destination.
- Always reply to the original thread when available.
- Never reply automatically; scheduled runs use their workflow destinations.

Recommended default: require an explicit persisted destination or binding.

### Startup Scope

Does startup rehydration apply only to `events serve`, or also to `serve` and
library embeddings?

Options:

- `events serve` owns event-source schedule rehydration in the first slice.
- Any process that creates an event listener service rehydrates schedules.
- All divedra server and library starts rehydrate schedules.

Recommended default: any process that creates an event listener service
rehydrates schedules; plain control-plane `serve` does not unless event
listeners are enabled.
