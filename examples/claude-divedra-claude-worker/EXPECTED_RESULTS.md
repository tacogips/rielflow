# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run src/main.ts workflow validate claude-divedra-claude-worker --workflow-definition-dir ./examples
```

Expected result: the workflow is valid.

## Run

Command:

```bash
bun run src/main.ts workflow run claude-divedra-claude-worker \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/claude-divedra-claude-worker/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "claude-divedra-claude-worker",
  "workflowId": "claude-divedra-claude-worker",
  "nodeExecutions": 5,
  "transitions": 4,
  "exitCode": 0
}
```

Expected final output node: `workflow-output`

Expected final output payload:

```json
{
  "summary": "The all-Claude reference workflow completed successfully.",
  "status": "ready",
  "notes": [
    "Manager nodes used claude-code-agent.",
    "The task node also used claude-code-agent."
  ]
}
```
