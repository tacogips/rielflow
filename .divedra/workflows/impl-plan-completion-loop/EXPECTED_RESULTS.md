# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

The mock scenario covers the no-incomplete-active-plan exit path. The normal
implementation path is `step1-plan-assess` -> `step2-handoff` ->
`design-and-implement-review-loop` -> `step3-post-handoff` ->
`step1-plan-assess`, repeating until Step 1 reports `plan_complete`.

## Validate

Command:

```bash
bun run packages/divedra/src/bin.ts workflow validate impl-plan-completion-loop --workflow-definition-dir .divedra/workflows
```

Expected result: the workflow is valid.

## Run

Completed-plan command:

```bash
bun run packages/divedra/src/bin.ts workflow run impl-plan-completion-loop \
  --workflow-definition-dir .divedra/workflows \
  --mock-scenario .divedra/workflows/impl-plan-completion-loop/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "impl-plan-completion-loop",
  "workflowId": "impl-plan-completion-loop",
  "nodeExecutions": 4,
  "transitions": 3,
  "exitCode": 0
}
```

Expected path: `divedra-manager` -> `step1-plan-assess` -> `step4-archive-completed-plans` -> `workflow-output`

Expected final output node: `workflow-output`

Expected final output payload:

```json
{
  "planPath": "impl-plans/completed/example-complete-plan.md",
  "completedTaskIds": ["TASK-001"],
  "verificationEvidence": [
    {
      "command": "mock completed-plan assessment and archive",
      "result": "passed"
    }
  ],
  "changedFiles": [
    "impl-plans/completed/example-complete-plan.md",
    "impl-plans/README.md"
  ],
  "residualRisks": []
}
```
