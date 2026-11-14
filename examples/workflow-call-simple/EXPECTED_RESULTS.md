# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run src/main.ts workflow validate workflow-call-simple --workflow-definition-dir ./examples
```

Expected result: the workflow is valid.

## Inspect

Command:

```bash
bun run src/main.ts workflow inspect workflow-call-simple --workflow-definition-dir ./examples --output json
```

Expected stable inspection facts:

- `managerStepId` is `divedra-manager`
- `entryStepId` is `divedra-manager`
- `stepIds` are `["divedra-manager", "draft-write", "apply-review"]`
- `counts.crossWorkflowDispatches` is `1`
- `crossWorkflowDispatchIds` contains `__cw:draft-write` (derived from the cross-workflow step transition)
- the authored bundle does not include structural `subWorkflows` (validation rejects that field)

## Run

Command:

```bash
bun run src/main.ts workflow run workflow-call-simple \
  --workflow-definition-dir ./examples \
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

- the parent session records one communication with `transitionWhen = "workflow-call:__cw:draft-write"`
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
