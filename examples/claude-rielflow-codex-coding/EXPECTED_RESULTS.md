# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run packages/rielflow/src/bin.ts workflow validate claude-rielflow-codex-coding --workflow-definition-dir ./examples
```

Expected result: the workflow is valid.

## Run

Command:

```bash
bun run packages/rielflow/src/bin.ts workflow run claude-rielflow-codex-coding \
  --workflow-definition-dir ./examples \
  --mock-scenario ./examples/claude-rielflow-codex-coding/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "claude-rielflow-codex-coding",
  "workflowId": "claude-rielflow-codex-coding",
  "nodeExecutions": 6,
  "transitions": 5,
  "exitCode": 0
}
```

Expected final output node: `workflow-output`

Expected final output payload:

```json
{
  "summary": "Reference workflow bundle is ready under examples/ with an explicit claude-code and codex split.",
  "status": "ready",
  "changedFiles": [
    "examples/README.md",
    "examples/claude-rielflow-codex-coding/"
  ],
  "verification": [
    "workflow validate",
    "workflow inspect",
    "workflow run --mock-scenario"
  ],
  "risks": []
}
```
