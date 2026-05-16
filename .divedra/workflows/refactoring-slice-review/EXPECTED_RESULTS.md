# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run src/main.ts workflow validate refactoring-slice-review --workflow-definition-dir .divedra/workflows
```

Expected result: the workflow is valid.

## Run

Command:

```bash
bun run src/main.ts workflow run refactoring-slice-review \
  --workflow-definition-dir .divedra/workflows \
  --mock-scenario .divedra/workflows/refactoring-slice-review/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "refactoring-slice-review",
  "workflowId": "refactoring-slice-review",
  "nodeExecutions": 1,
  "transitions": 0,
  "exitCode": 0
}
```

Expected final output node: `slice-review`

Expected final output payload highlights:

```json
{
  "sliceId": "workflow-runtime-boundary",
  "findings": [
    {
      "severity": "mid",
      "file": "src/workflow/addon-package-boundary.ts"
    }
  ],
  "proposedTasks": [
    {
      "taskId": "REF-001",
      "title": "Unify add-on package boundary loading"
    }
  ],
  "residualRisks": []
}
```
