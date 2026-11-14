# Event Source Fixtures

These fixtures demonstrate event source configuration outside workflow bundles.
Use them with the existing example workflow root.

Validate the source and binding configuration:

```bash
divedra events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events
```

For a deterministic no-server run, emit the fixture through the existing
workflow mock scenario. This dispatches locally and does not require a GraphQL
server or real agent backend:

```bash
divedra events emit example-webhook \
  --workflow-definition-dir ./examples \
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
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.divedra-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/chat-reply-message.json \
  --output json
```

The `team-matrix` source demonstrates first-slice Element/Matrix chat support.
Set a Matrix homeserver URL and bot access token through env vars when serving
or replying to real rooms:

```bash
export DIVEDRA_MATRIX_HOMESERVER_URL=https://matrix.example
export DIVEDRA_MATRIX_ACCESS_TOKEN=<matrix-bot-access-token>
```

For deterministic local receive tests, emit the checked-in Matrix room-message
fixture without contacting Matrix:

```bash
divedra events emit team-matrix \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.divedra-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/matrix-room-message.json \
  --output json
```

The binding `matrix-release-chat-to-workflow` runs the `matrix-chat-reply`
workflow and sends workflow replies through the explicit
`release-matrix-chat` chat destination. Matrix support currently
handles text-like `m.room.message` events from configured rooms and Matrix
Client-Server room sends; encrypted rooms, attachments, reactions, edits,
redactions, and Application Service transactions are out of scope for this
fixture.

For an end-to-end local Matrix verification, run the dedicated sample workflow
against a Docker Compose Synapse homeserver:

```bash
./examples/matrix-chat-reply/local-synapse/run-local-matrix-sample.sh
```

The script follows the Synapse Docker flow of generating a local config,
starting the homeserver, registering two users, creating a room, serving
divedra Matrix events, sending an Alice message, and waiting for the divedra
bot reply in the same room.

Start a workflow control-plane endpoint in another shell when you want fixture
events to dispatch real workflow executions:

```bash
divedra serve --workflow-definition-dir ./examples
```

Emit the chat-shaped webhook fixture. Use an explicit artifact root so receipt
inspection and replay commands read the same runtime database:

```bash
divedra events emit example-webhook \
  --workflow-definition-dir ./examples \
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
  --workflow-definition-dir ./examples \
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
`--workflow-definition-dir`, `--event-root`, `--artifact-root`, and `--endpoint` pattern
shown above.

## Supervised lifecycle control (chat-shaped webhook)

The binding `bindings/webhook-supervised-arithmetic.json` sets
`execution.mode` to `supervised` so the event runner records a supervised-run
id, maps each event to a control action, and drives the target workflow through
the supervisor client (local library when no `--endpoint`, or the remote
GraphQL supervisor mutations when `--endpoint` points at `divedra serve`).

The binding uses `intentMapping` mode `command-map`: the first token of
`event.input.text` selects `start`, `stop`, `restart`, or `status`; any other
text is treated as `input` (see `defaultAction`).

Validate including this binding:

```bash
divedra events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events
```

Emit a `start` command against the mock scenario (no live agents):

```bash
divedra events emit example-webhook \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.divedra-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/chat-supervised-start.json \
  --mock-scenario ./examples/first-four-arithmetic-pipeline/mock-scenario.json \
  --output json
```

Use the same `artifact-root` and correlation (`conversation` + `threadId` in
the payload) to emit further events with `"text": "status"` or `"stop"` in
`event.input` to exercise the same supervised run.

## Supervisor dispatch (multi-workflow LLM resolver)

Binding `bindings/webhook-supervisor-dispatch-demo.json` sets
`execution.mode` to `supervisor-dispatch`, loads profile
`supervisors/default-chat-dispatcher.json`, and resolves decisions through the
stub workflow `dispatcher-llm-resolver-stub` (`resolver-worker`). See
`examples/default-supervisor-dispatcher/README.md` for validate/emit commands,
fixture payloads, and mock scenarios (`answer-directly` vs `start-workflow`).
