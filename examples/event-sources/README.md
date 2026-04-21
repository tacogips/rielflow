# Event Source Fixtures

These fixtures demonstrate event source configuration outside workflow bundles.
Use them with the existing example workflow root.

Validate the source and binding configuration:

```bash
divedra events validate --workflow-root ./examples --event-root ./examples/event-sources/.divedra-events
```

For a deterministic no-server run, emit the fixture through the existing
workflow mock scenario. This dispatches locally and does not require a GraphQL
server or real agent backend:

```bash
divedra events emit example-webhook \
  --workflow-root ./examples \
  --event-root ./examples/event-sources/.divedra-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/chat-message.json \
  --mock-scenario ./examples/first-four-arithmetic-pipeline/mock-scenario.json \
  --output json
```

The `chat-reply-webhook` workflow demonstrates the built-in
`divedra/chat-reply-worker` add-on. Start a local reply sink in one shell:

```bash
bun -e 'Bun.serve({ port: 43175, async fetch(req) { console.log(await req.text()); return Response.json({ providerMessageId: "local-demo-message" }); } })'
```

Then emit the reply fixture without `--endpoint` so the local event runner can
pass its in-process reply dispatcher into the workflow:

```bash
DIVEDRA_EXAMPLE_REPLY_ENDPOINT=http://127.0.0.1:43175/reply \
divedra events emit example-reply-webhook \
  --workflow-root ./examples \
  --event-root ./examples/event-sources/.divedra-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/chat-reply-message.json \
  --output json
```

Start a workflow control-plane endpoint in another shell when you want fixture
events to dispatch real workflow executions:

```bash
divedra serve --workflow-root ./examples
```

Emit the chat-shaped webhook fixture. Use an explicit artifact root so receipt
inspection and replay commands read the same runtime database:

```bash
divedra events emit example-webhook \
  --workflow-root ./examples \
  --event-root ./examples/event-sources/.divedra-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/chat-message.json \
  --endpoint http://127.0.0.1:43173/graphql \
  --output json
```

List persisted event receipts:

```bash
divedra events list \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --source example-webhook \
  --output json
```

List persisted outbound chat reply dispatches for a workflow execution:

```bash
divedra events replies <workflow-execution-id> \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --status sent \
  --output json
```

Replay a stored receipt by replacing `<receipt-id>` with the id returned by
`events emit` or `events list`:

```bash
divedra events replay <receipt-id> \
  --workflow-root ./examples \
  --event-root ./examples/event-sources/.divedra-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --endpoint http://127.0.0.1:43173/graphql \
  --reason "operator verification" \
  --output json
```

Add `--dry-run` to the replay command to verify mapping and workflow execution
without running agent-backed nodes.

The S3 fixture is metadata-only and does not require object-store credentials.
It can be emitted with `events emit incoming-docs --event-file
./examples/event-sources/payloads/s3-object-created.json` using the same
`--workflow-root`, `--event-root`, `--artifact-root`, and `--endpoint` pattern
shown above.
