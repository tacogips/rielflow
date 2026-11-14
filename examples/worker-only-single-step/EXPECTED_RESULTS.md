# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run src/main.ts workflow validate worker-only-single-step --workflow-definition-dir ./examples
```

Expected result: the workflow is valid.

## Inspect

Command:

```bash
bun run src/main.ts workflow inspect worker-only-single-step --workflow-definition-dir ./examples --output json
```

Expected stable inspection facts:

- `hasManagerNode` is `false`
- authored `entryStepId` is `main-worker`
- the step-first inspection summary does not emit removed top-level node-addressed entry/manager fields; `managerStepId` is absent for this worker-only bundle

## Run

Command:

```bash
bun run src/main.ts workflow run worker-only-single-step \
  --workflow-definition-dir ./examples \
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
