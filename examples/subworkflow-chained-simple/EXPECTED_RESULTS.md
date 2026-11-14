# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run packages/divedra/src/bin.ts workflow validate subworkflow-chained-simple --workflow-definition-dir ./examples
```

Expected result: the workflow is valid.

## Inspect

Command:

```bash
bun run packages/divedra/src/bin.ts workflow inspect subworkflow-chained-simple --workflow-definition-dir ./examples --output json
```

Expected stable inspection facts:

- authored `managerStepId` is `divedra-manager`
- authored `entryStepId` is `divedra-manager`
- `stepIds` list `divedra-manager`, `alpha-manager`, `alpha-input`, `alpha-worker`, `alpha-output`, `beta-manager`, `beta-input`, `beta-worker`, and `beta-output`

## Run

Command:

```bash
bun run packages/divedra/src/bin.ts workflow run subworkflow-chained-simple \
  --workflow-definition-dir ./examples \
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
  "notes": ["beta-lane followed alpha-lane in ordered node flow"]
}
```
