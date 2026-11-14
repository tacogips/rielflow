# Expected results: default supervisor dispatcher demo

## Configuration validation

`divedra events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events`
must exit successfully with no errors for:

- supervisor profile `default-chat-dispatcher`
- binding `webhook-supervisor-dispatch-demo`
- workflows `divedra-default-workflow-supervisor`, `dispatcher-llm-resolver-stub`,
  and `worker-only-single-step`

## Mock emit (answer-directly)

With `mock-scenario-answer.json`, the trigger runner should record a **dispatched**
receipt, persist supervisor conversation/decision identifiers when enabled, and
produce outbound chat metadata that includes the proposal reply body from the
fixture.

## Mock emit (start managed workflow)

With `mock-scenario-start-managed.json`, the runner should apply `start-workflow`
for managed key `echo` and exercise the managed worker mock (`main-worker`).

Exact JSON snapshots are intentionally not pinned here; use repository tests for
contract stability.
