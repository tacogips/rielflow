# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run packages/divedra/src/bin.ts workflow validate same-node-session-echo --workflow-definition-dir ./examples
```

Expected result: the workflow is valid.

## Run

Command:

```bash
bun run packages/divedra/src/bin.ts workflow run same-node-session-echo \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/same-node-session-echo/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "same-node-session-echo",
  "workflowId": "same-node-session-echo",
  "nodeExecutions": 6,
  "transitions": 5,
  "exitCode": 0
}
```

Expected shared-node execution visits:

```json
{
  "echo-request": 1,
  "answer-request": 1
}
```

Expected final output node: `workflow-output`

Expected final output payload:

```json
{
  "summary": "The reusable worker echoed the request on its first visit and returned the answer on its second visit.",
  "status": "ready",
  "echoText": "What is the capital of France?",
  "finalAnswer": "The capital of France is Paris.",
  "notes": [
    "Distinct step ids revisit the same reusable node registry entry.",
    "The answer step inherits the backend session from echo-request and swaps to the answer prompt variant.",
    "Live backend session continuity still depends on the configured backend returning a reusable session id."
  ]
}
```
