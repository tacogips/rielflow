# Expected Results

Stable assertions for deterministic verification with the bundled fixtures.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run packages/rielflow/src/bin.ts workflow validate chat-event-attachment-judgement --workflow-definition-dir ./examples
```

Expected result: the workflow is valid.

## Inspect

Command:

```bash
bun run packages/rielflow/src/bin.ts workflow inspect chat-event-attachment-judgement --workflow-definition-dir ./examples --output json
```

Expected stable inspection facts:

- `workflowId` is `chat-event-attachment-judgement`
- `entryStepId` is `judge-attachments`
- the `judge-attachments` node uses `codex-agent`
- the classifier prompt is loaded from `prompts/judge-attachments.md`

## Deterministic Judgements

The image/PDF fixture in
`examples/event-sources/payloads/chat-sdk-attachment-judgement-message.json`
should classify:

- `img-release-dashboard` as a healthy release/dashboard image with
  `needsManualReview: false`
- `pdf-incident-summary` as an incident summary with no observed customer data
  exposure and `needsManualReview: false`

The unsupported fixture in
`examples/event-sources/payloads/chat-sdk-attachment-judgement-unsupported.json`
should classify `archive-unknown` as `manual-review-required` with confidence
`low` and `needsManualReview: true`.

## Emit

Command:

```bash
bun run packages/rielflow/src/bin.ts events emit chat-sdk-slack \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/chat-sdk-attachment-judgement-message.json \
  --mock-scenario ./examples/chat-event-attachment-judgement/mock-scenario.json \
  --output json
```

Expected stable result: the event is dispatched to
`chat-event-attachment-judgement` and the final payload matches the two
non-manual-review judgement objects in `mock-scenario.json`.

Unsupported/manual-review command:

```bash
bun run packages/rielflow/src/bin.ts events emit chat-sdk-slack \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --artifact-root ./tmp/event-source-demo/workflow-artifacts \
  --event-file ./examples/event-sources/payloads/chat-sdk-attachment-judgement-unsupported.json \
  --mock-scenario ./examples/chat-event-attachment-judgement/mock-scenario-unsupported.json \
  --output json
```

Expected stable result: the final payload contains `archive-unknown` with
`label: "manual-review-required"`, `confidence: "low"`, and
`needsManualReview: true`.
