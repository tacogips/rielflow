# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run src/main.ts workflow validate node-combinations-showcase --workflow-root ./examples
```

Expected result: the workflow is valid.

## Run

Command:

```bash
bun run src/main.ts workflow run node-combinations-showcase \
  --workflow-root ./examples \
  --mock-scenario ./examples/node-combinations-showcase/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "node-combinations-showcase",
  "workflowId": "node-combinations-showcase",
  "nodeExecutions": 22,
  "transitions": 21,
  "exitCode": 0
}
```

Expected key execution counts:

```json
{
  "command-worker": 1,
  "container-worker": 1,
  "foreach-manager": 3,
  "foreach-input": 3,
  "foreach-worker": 3,
  "foreach-judge": 3,
  "foreach-output": 1
}
```

Expected lane terminal payloads:

```json
{
  "command-output": {
    "lane": "command",
    "summary": "Command lane completed through the authored command node path.",
    "result": "command showcase lane"
  },
  "container-output": {
    "lane": "container",
    "summary": "Container lane completed through the authored container node path.",
    "result": "container showcase lane"
  },
  "foreach-output": {
    "summary": "Node combination showcase exercised command, container, and repeat-based foreach authoring with deterministic outputs.",
    "status": "ready",
    "commandLane": {
      "result": "command showcase lane"
    },
    "containerLane": {
      "result": "container showcase lane"
    },
    "foreachLane": {
      "iterations": [
        "processed-alpha",
        "processed-beta",
        "processed-gamma"
      ],
      "totalIterations": 3
    }
  }
}
```
