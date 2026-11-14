# Expected Results

Live-agent reference workflow for topic-driven debate. The exact debate content
depends on the configured `codex-agent` account and model, so stable assertions
focus on validation and runtime shape rather than fixed text.

## Validate

Command:

```bash
bun run packages/divedra/src/bin.ts workflow validate codex-codex-topic-debate --workflow-definition-dir ./examples
```

Expected result: the workflow is valid.

## Run

Command:

```bash
bun run packages/divedra/src/bin.ts workflow run codex-codex-topic-debate \
  --workflow-definition-dir ./examples \
  --variables '{"humanInput":{"request":"Debate immigration policy. The affirmative side should argue for more open immigration with managed legal pathways, and the negative side should argue for stricter border and asylum controls."}}' \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "codex-codex-topic-debate",
  "workflowId": "codex-codex-topic-debate",
  "exitCode": 0
}
```

Expected runtime behavior:

- `affirmative-input` publishes a structured payload with the supplied topic.
- speaker and output nodes publish structured debate turns.
- `debate-judge` publishes branch booleans through the top-level `when` envelope.
- `continue_debate` routes back to `affirmative-manager`; `!(continue_debate)` routes to `debate-summary`.
