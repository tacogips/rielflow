# Event Source Fixtures

These fixtures demonstrate event source configuration outside workflow bundles.
Use them with the existing example workflow root.

Validate the source and binding configuration:

```bash
rielflow events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
```

For a deterministic no-server run, emit the fixture through the existing
workflow mock scenario. This dispatches locally and does not require a GraphQL
server or real agent backend:

```bash
rielflow events emit example-webhook \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/chat-message.json \
  --mock-scenario ./examples/first-four-arithmetic-pipeline/mock-scenario.json \
  --output json
```

The `chat-reply-webhook` workflow demonstrates the built-in
`rielflow/chat-reply-worker` add-on. Start a local reply sink in one shell:

```bash
bun -e 'Bun.serve({ port: 43175, async fetch(req) { console.log(await req.text()); return Response.json({ providerMessageId: "local-demo-message" }); } })'
```

Then emit the reply fixture without `--endpoint` so the local event runner can
pass its in-process reply dispatcher into the workflow:

```bash
RIEL_EXAMPLE_REPLY_ENDPOINT=http://127.0.0.1:43175/reply \
rielflow events emit example-reply-webhook \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/chat-reply-message.json \
  --output json
```

The `team-matrix` source demonstrates first-slice Element/Matrix chat support.
Set a Matrix homeserver URL and bot access token through env vars when serving
or replying to real rooms:

```bash
export RIEL_MATRIX_HOMESERVER_URL=https://matrix.example
export RIEL_MATRIX_ACCESS_TOKEN=<matrix-bot-access-token>
```

For deterministic local receive tests, emit the checked-in Matrix room-message
fixture without contacting Matrix:

```bash
rielflow events emit team-matrix \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/matrix-room-message.json \
  --output json
```

The binding `matrix-release-chat-to-workflow` runs the `matrix-chat-reply`
workflow and sends workflow replies through the explicit
`release-matrix-chat` chat destination. Matrix support currently
handles text-like `m.room.message` events from configured rooms, optional
bounded text-compatible attachment downloads, and Matrix Client-Server room
sends; encrypted rooms, encrypted attachments, binary OCR, audio/video
transcription, reactions, edits, redactions, and Application Service
transactions are out of scope for this fixture.

For an end-to-end local Matrix verification, run the dedicated sample workflow
against a Docker Compose Synapse homeserver:

```bash
./examples/matrix-chat-reply/local-synapse/run-local-matrix-sample.sh
```

The script follows the Synapse Docker flow of generating a local config,
starting the homeserver, registering two users, creating a room, serving
rielflow Matrix events, sending an Alice message, and waiting for the rielflow
bot reply in the same room.

The Matrix source fixture enables bounded room/thread history. During
`events serve`, accepted Matrix messages are persisted as compact normalized
history under the event data root and reloaded after restart. Workflows can read
that context from `event.input.history` and `event.input.historySource`;
persisted files do not store Matrix access tokens or raw `/sync` payloads.
The fixture also enables bounded text attachment downloads for text, markdown,
and JSON files. Extracted text is appended to `event.input.text` and exposed as
`event.input.attachmentText` plus `event.input.attachments` metadata.

The `chat-sdk-slack` and `chat-sdk-telegram` sources demonstrate the shared
Chat SDK generic boundary.
The provider allow-list is `slack`, `teams`, `gchat`, `discord`, `telegram`,
`github`, `linear`, `whatsapp`, `messenger`, and `web`. This first pass does
not import `@chat-adapter/*` packages directly; an operator-owned Chat SDK
deployment posts normalized webhook payloads to rielflow and receives replies
through the configured send endpoint. Slack and Telegram fixtures enable
bounded conversation/thread history with the same `event.input.history` and
`event.input.historySource` workflow contract.

Serve the source with env-var references only:

```bash
export RIEL_CHAT_SDK_SLACK_WEBHOOK_SECRET=<shared-webhook-secret>
export RIEL_CHAT_SDK_SLACK_BEARER_TOKEN=<inbound-bearer-token>
export RIEL_CHAT_SDK_SLACK_SEND_URL=https://chat-sdk.example.test/send
export RIEL_CHAT_SDK_SLACK_SEND_TOKEN=<outbound-send-token>
rielflow events serve --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
```

For deterministic local checks, emit the generic-boundary payload fixture:

```bash
rielflow events emit chat-sdk-slack \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/chat-sdk-slack-message.json \
  --mock-scenario ./examples/first-four-arithmetic-pipeline/mock-scenario.json \
  --output json
```

Telegram uses the same Chat SDK contract:

```bash
export RIEL_CHAT_SDK_TELEGRAM_WEBHOOK_SECRET=<shared-webhook-secret>
export RIEL_CHAT_SDK_TELEGRAM_BEARER_TOKEN=<inbound-bearer-token>
export RIEL_CHAT_SDK_TELEGRAM_SEND_URL=https://chat-sdk.example.test/send
export RIEL_CHAT_SDK_TELEGRAM_SEND_TOKEN=<outbound-send-token>
rielflow events emit chat-sdk-telegram \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/chat-sdk-telegram-message.json \
  --mock-scenario ./examples/first-four-arithmetic-pipeline/mock-scenario.json \
  --output json
```

The `chat-sdk-discord` source uses the same generic boundary for Discord and
dispatches messages to the `discord-codex-chat` workflow, which generates a
reply with `codex-agent` model `gpt-5.4-mini` before sending it back to the same
Discord thread through `rielflow/chat-reply-worker`.

Serve the Discord source with env-var references only:

```bash
export RIEL_CHAT_SDK_DISCORD_WEBHOOK_SECRET=<shared-webhook-secret>
export RIEL_CHAT_SDK_DISCORD_BEARER_TOKEN=<inbound-bearer-token>
export RIEL_CHAT_SDK_DISCORD_SEND_URL=https://chat-sdk.example.test/send
export RIEL_CHAT_SDK_DISCORD_SEND_TOKEN=<outbound-send-token>
rielflow events serve --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
```

For deterministic local checks, emit the Discord payload fixture:

```bash
rielflow events emit chat-sdk-discord \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/chat-sdk-discord-message.json \
  --mock-scenario ./examples/discord-codex-chat/mock-scenario.json \
  --output json
```

The `discord-gateway-personas` source demonstrates rielflow-owned Discord
Gateway ingestion. It is separate from the `chat-sdk-discord` generic webhook
path and does not require an external Chat SDK Discord deployment. The Gateway
runner uses Discord bot credentials from environment-variable names in the
source config, listens to configured channels and threads, ignores bot and self
messages by default, and attaches bounded recent channel or thread history to
`event.input.history`. During normal `events serve` operation, accepted
messages are also written as compact bounded normalized history under the event
data root, so a restart with the same root can reload prior channel or thread
context without requiring a Discord REST history fetch.

Serve the Gateway source with a Discord bot token and application id. The bot
must have access to the configured channels and the Discord Message Content
intent must be enabled when workflows need message text:

```bash
export RIEL_DISCORD_BOT_TOKEN=<discord-bot-token>
export RIEL_DISCORD_APPLICATION_ID=<discord-application-id>
rielflow events serve --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
```

For deterministic local checks, emit the checked-in Gateway payload without
contacting Discord. The payload includes bounded prior Discord history so the
`discord-persona-chat` workflow can answer as Yui, Mika, or Rina with context:

```bash
rielflow events emit discord-gateway-personas \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/discord-gateway-message-with-history.json \
  --read-only \
  --output json
```

If `events serve` has no event data root or runs with `--read-only`, the
Gateway adapter keeps its in-memory plus optional REST history behavior and
emits a diagnostic instead of writing fallback files. Persisted files contain
only bounded normalized Discord conversation items and history bounds; they are
not workflow inbox, agent transcript, raw Gateway payload, credential, or
long-term memory storage. The first Gateway slice does not provide multi-shard
coordination, slash commands, components, moderation events, or attachment
ingestion. History is bounded by `maxMessages`, `maxBytes`, and `maxAgeMs`,
and it is Discord channel/thread context rather than workflow inbox or agent
transcript history.

The `local-docs` source demonstrates local filesystem notifications. It
watches `examples/event-sources/watched-docs` for `create`, `modify`, and
`delete` changes to `.md` and `.json` files. The source emits
`file.change.created`, `file.change.modified`, or `file.change.deleted` with
safe relative file metadata only; file contents are not read.

Serve it and create a matching file:

```bash
rielflow events serve --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
mkdir -p ./examples/event-sources/watched-docs/plans
printf 'release notes\n' > ./examples/event-sources/watched-docs/plans/release.md
```

For deterministic local checks without a watcher, emit the fixture payload:

```bash
rielflow events emit local-docs \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/file-change-created.json \
  --mock-scenario ./examples/first-four-arithmetic-pipeline/mock-scenario.json \
  --output json
```

The `nightly-instruction-list` source demonstrates ordered prompt dispatch
with `kind: "sequential-list"`. The source stores an ordered `entries` array;
each entry has a stable `id`, a non-empty `prompt`, and optional JSON-object
`metadata`. `events serve` emits one `sequential-list.item.ready` event for the
first pending entry, waits until that item's workflow or supervised run reaches
a terminal state, then emits the next entry. Restarting `events serve` resumes
from the persisted cursor for the same source/config revision and does not
rerun completed entries.

```bash
rielflow events validate \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events

rielflow events serve \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts
```

The binding `sequential-list-to-arithmetic` maps `event.input.prompt` into the
workflow input and also passes `event.input.sequence`, which contains the
source id, config revision id, run id, item id, index, total, and prior item
references when available. Receipts are normal event receipts; inspect them
with `events list` and replay one stored item without resetting the whole
sequence:

```bash
rielflow events list \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --source nightly-instruction-list \
  --output json

rielflow events replay <receipt-id> \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --reason "replay one sequential-list item" \
  --output json
```

Use `--read-only` or `RIEL_EVENTS_READ_ONLY=true` with `events serve` to
persist skipped receipts and sequence state without dispatching workflow
executions. The durable cursor remains on the undispatched item so a later
non-read-only serve can process it.

The binding `chat-sdk-slack-schedule-registration` demonstrates chat-created
workflow schedules. It listens only to conversation `schedule-demo`, runs the
resolver workflow `dispatcher-llm-resolver-stub` at node `resolver-worker`, and
expects the resolver output to be one of these structured decisions. The
binding sets `minConfidence: 0.8`, so a ready decision must include numeric
`confidence` at or above that threshold before a schedule can be persisted:

Resolver input, including timezone-relevant chat fields, is selected through
the binding `inputMapping` block. Do not configure `execution.inputPath` or
`execution.timezonePath` for schedule-registration bindings.

```json
{
  "status": "ready",
  "workflowName": "worker-only-single-step",
  "confidence": 0.95,
  "schedule": {
    "kind": "one-time",
    "timezone": "UTC",
    "dueAt": "2026-05-19T09:00:00.000Z"
  },
  "workflowInput": {
    "topic": "release"
  },
  "confirmationText": "Scheduled worker-only-single-step."
}
```

For recurring schedules, return `"kind": "recurring"` with a five-field
`cron` string and `timezone`. For one-time schedules, `dueAt` may be an
absolute timestamp with `Z` or a numeric UTC offset, or an offset-less wall
clock value such as `2026-05-19T09:00:00` that is resolved using the provided
IANA `timezone`. Invalid, ambiguous, or unresolvable wall-clock times are not
persisted. Return `status: "needs-clarification"` with `missing` and `question`
when the workflow, confidence, time, timezone, recurrence, or workflow input is
ambiguous; no schedule is persisted for clarification or refusal decisions.
Clarification replies require a safe chat reply destination; without one, the
request is refused instead of persisted.

Inspect and cancel persisted schedules with the operator commands:

```bash
rielflow events schedules list \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --source chat-sdk-slack \
  --status active \
  --output json

rielflow events schedules inspect <schedule-id> \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --output json

rielflow events schedules cancel <schedule-id> \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --reason "operator cleanup" \
  --output json
```

Start a workflow control-plane endpoint in another shell when you want fixture
events to dispatch real workflow executions:

```bash
rielflow serve --workflow-definition-dir ./examples
```

Emit the chat-shaped webhook fixture. Use an explicit artifact root so receipt
inspection and replay commands read the same runtime database:

```bash
rielflow events emit example-webhook \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/chat-message.json \
  --endpoint http://127.0.0.1:43173/graphql \
  --output json
```

List persisted event receipts:

```bash
rielflow events list \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --source example-webhook \
  --output json
```

List persisted outbound chat reply dispatches for a workflow execution:

```bash
rielflow events replies <workflow-execution-id> \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --status sent \
  --output json
```

Replay a stored receipt by replacing `<receipt-id>` with the id returned by
`events emit` or `events list`:

```bash
rielflow events replay <receipt-id> \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
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
GraphQL supervisor mutations when `--endpoint` points at `rielflow serve`).

The binding uses `intentMapping` mode `command-map`: the first token of
`event.input.text` selects `start`, `stop`, `restart`, or `status`; any other
text is treated as `input` (see `defaultAction`).

Validate including this binding:

```bash
rielflow events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
```

Emit a `start` command against the mock scenario (no live agents):

```bash
rielflow events emit example-webhook \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
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
