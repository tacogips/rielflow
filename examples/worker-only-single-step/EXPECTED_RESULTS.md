# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run src/main.ts workflow validate worker-only-single-step --workflow-root ./examples
```

Expected result: the workflow is valid.

## Inspect

Command:

```bash
bun run src/main.ts workflow inspect worker-only-single-step --workflow-root ./examples --output json
```

Expected stable inspection facts:

- `hasManagerNode` is `false`
- authored `entryStepId` is `main-worker`
- compatibility inspection still reports `entryNodeId` as `main-worker`
- `managerNodeId` is omitted from the authored bundle and reported as absent in user-facing summaries

## Run

Command:

```bash
bun run src/main.ts workflow run worker-only-single-step \
  --workflow-root ./examples \
  --mock-scenario ./examples/worker-only-single-step/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "worker-only-single-step",
  "workflowId": "worker-only-single-step",
  "nodeExecutions": 1,
  "transitions": 0,
  "exitCode": 0
}
```

Expected `main-worker` payload:

```json
{
  "summary": "Worker-only workflow completed from its explicit entry node.",
  "status": "ready",
  "verification": [
    "workflow validate",
    "workflow inspect",
    "workflow run --mock-scenario"
  ],
  "risks": []
}
```
