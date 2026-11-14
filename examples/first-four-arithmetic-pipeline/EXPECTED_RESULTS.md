# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run src/main.ts workflow validate first-four-arithmetic-pipeline --workflow-root ./examples
```

Expected result: the workflow is valid.

## Run

Command:

```bash
bun run src/main.ts workflow run first-four-arithmetic-pipeline \
  --workflow-root ./examples \
  --mock-scenario ./examples/first-four-arithmetic-pipeline/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "first-four-arithmetic-pipeline",
  "workflowId": "first-four-arithmetic-pipeline",
  "nodeExecutions": 13,
  "transitions": 12,
  "exitCode": 0
}
```

Expected final output node: `divide-output`

Expected final output payload:

```json
{
  "firstFour": [10, 20, 3, 2],
  "finalResult": 45,
  "summary": "(10 + 20) * 3 / 2 = 45",
  "operations": [
    {
      "operation": "add",
      "result": 30
    },
    {
      "operation": "multiply",
      "result": 90
    },
    {
      "operation": "divide",
      "result": 45
    }
  ]
}
```
