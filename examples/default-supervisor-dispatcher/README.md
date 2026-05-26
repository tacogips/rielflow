# Default supervisor dispatcher demo

This bundle documents the **supervisor-dispatch** example layout shipped across
`examples/`:

- **Supervisor workflow**: `../rielflow-default-workflow-supervisor/` (`workflowId`
  matches the design default).
- **Resolver stub**: `../dispatcher-llm-resolver-stub/` (single worker node
  `resolver-worker` referenced by event bindings).
- **Managed workflow**: `../worker-only-single-step/` (catalog entry `echo` in
  the supervisor profile).
- **Supervisor profile**: `../event-sources/.rielflow-events/supervisors/default-chat-dispatcher.json`
- **Binding**: `../event-sources/.rielflow-events/bindings/webhook-supervisor-dispatch-demo.json`
- **Fixture payloads**:
  `../event-sources/payloads/chat-supervisor-dispatch.json`,
  `../event-sources/payloads/chat-supervisor-dispatch-start-managed.json`

Local supervised lifecycle commands use the deterministic in-process runner
pool. The supervisor workflow name is the durable identity for policy and audit;
it does not cause event-source control to spawn a `rielflow` binary.

## Validate configuration

```bash
rielflow events validate \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events
```

## Emit (mock resolver + managed worker)

Direct answer (resolver mock only):

```bash
rielflow events emit example-webhook \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/chat-supervisor-dispatch.json \
  --mock-scenario ./examples/default-supervisor-dispatcher/mock-scenario-answer.json \
  --output json
```

Start the managed `echo` workflow (resolver + `main-worker` mocks). Use a
**distinct** fixture from the direct-answer demo so `eventId` (and thus the
computed `dedupeKey`) differs; otherwise the receipt ledger treats the second
emit as a duplicate within `dedupeWindowMs`.

```bash
rielflow events emit example-webhook \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/chat-supervisor-dispatch-start-managed.json \
  --mock-scenario ./examples/default-supervisor-dispatcher/mock-scenario-start-managed.json \
  --output json
```

Use a live GraphQL endpoint when you want real backends instead of mocks:

```bash
rielflow serve --workflow-definition-dir ./examples
# another shell:
rielflow events emit example-webhook \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/chat-supervisor-dispatch.json \
  --endpoint http://127.0.0.1:43173/graphql \
  --output json
```
