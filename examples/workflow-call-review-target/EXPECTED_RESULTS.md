# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run src/main.ts workflow validate workflow-call-review-target --workflow-definition-dir ./examples
```

Expected result: the workflow is valid.

## Inspect

Command:

```bash
bun run src/main.ts workflow inspect workflow-call-review-target --workflow-definition-dir ./examples --output json
```

Expected stable inspection facts:

- `hasManagerNode` is `false`
- authored `entryStepId` is `reviewer`
- inspection reports `entryStepId` as `reviewer` and does not surface a top-level `entryNodeId` field
- `counts.crossWorkflowDispatches` is `0`

## Run

Command:

```bash
bun run src/main.ts workflow run workflow-call-review-target \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/workflow-call-review-target/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "workflow-call-review-target",
  "workflowId": "workflow-call-review-target",
  "nodeExecutions": 1,
  "transitions": 0,
  "exitCode": 0
}
```

Expected `reviewer` payload:

```json
{
  "reviewStatus": "approved",
  "reviewSummary": "Standalone worker-only review workflow completed.",
  "reviewNotes": [
    "The incoming draft is concise.",
    "The requested checks were satisfied."
  ]
}
```
