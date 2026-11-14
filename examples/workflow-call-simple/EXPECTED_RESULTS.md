# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run src/main.ts workflow validate workflow-call-simple --workflow-root ./examples
```

Expected result: the workflow is valid.

## Inspect

Command:

```bash
bun run src/main.ts workflow inspect workflow-call-simple --workflow-root ./examples --output json
```

Expected stable inspection facts:

- `managerNodeId` is `divedra-manager`
- `counts.workflowCalls` is `1`
- `workflowCallIds` contains `call-review`
- `subWorkflows` remains omitted from the authored bundle

## Run

Command:

```bash
bun run src/main.ts workflow run workflow-call-simple \
  --workflow-root ./examples \
  --mock-scenario ./examples/workflow-call-simple/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "workflow-call-simple",
  "workflowId": "workflow-call-simple",
  "nodeExecutions": 3,
  "transitions": 2,
  "exitCode": 0
}
```

Expected stable workflow-call facts:

- the parent session records one communication with `transitionWhen = "workflow-call:call-review"`
- that communication targets `apply-review`
- that communication payload references workflow id `workflow-call-review-target`

Expected `apply-review` payload:

```json
{
  "summary": "Workflow-call review was applied in the parent workflow.",
  "status": "ready",
  "reviewSource": "workflow-call",
  "reviewTargetWorkflowId": "workflow-call-review-target"
}
```
