# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run src/main.ts workflow validate same-node-session-echo --workflow-root ./examples
```

Expected result: the workflow is valid.

## Run

Command:

```bash
bun run src/main.ts workflow run same-node-session-echo \
  --workflow-root ./examples \
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

Expected key execution count:

```json
{
  "echo-session": 2
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
    "The ordered node list revisits the same node id via repeat.",
    "The node payload opts into sessionPolicy.mode = reuse.",
    "The mock scenario demonstrates the two-turn repeat shape; live backend session continuity still depends on the configured backend returning a reusable session id."
  ]
}
```
