# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run src/main.ts workflow validate subworkflow-chained-simple --workflow-root ./examples
```

Expected result: the workflow is valid.

## Run

Command:

```bash
bun run src/main.ts workflow run subworkflow-chained-simple \
  --workflow-root ./examples \
  --mock-scenario ./examples/subworkflow-chained-simple/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "subworkflow-chained-simple",
  "workflowId": "subworkflow-chained-simple",
  "nodeExecutions": 9,
  "transitions": 8,
  "exitCode": 0
}
```

Expected final output node: `beta-output`

Expected final output payload:

```json
{
  "summary": "Chained lane example completed.",
  "status": "ready",
  "notes": [
    "beta-lane followed alpha-lane in ordered node flow"
  ]
}
```
