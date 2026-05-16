# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
nix run ./divedra -- workflow validate recent-change-quality-loop
```

Expected result: the workflow is valid.

## Run

Command:

```bash
nix run ./divedra -- workflow run recent-change-quality-loop \
  --mock-scenario .divedra/workflows/recent-change-quality-loop/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "recent-change-quality-loop",
  "workflowId": "recent-change-quality-loop",
  "nodeExecutions": 8,
  "transitions": 7,
  "exitCode": 0
}
```

Expected final output node: `workflow-output`

Expected stable workflow-call facts:

- the parent session records one communication with `transitionWhen = "workflow-call:__cw:step3-handoff"`
- that communication targets `step4-post-handoff`
- that communication payload references workflow id `design-and-implement-review-loop`

Expected final output payload:

```json
{
  "status": "accepted",
  "hours": 24,
  "reviewedRange": "HEAD~3..HEAD plus clean working tree",
  "finalFindings": [],
  "fixIterations": 1,
  "delegatedWorkflowRuns": [
    {
      "workflowId": "design-and-implement-review-loop",
      "workflowMode": "issue-resolution",
      "commitHash": "fedcba9876543210fedcba9876543210fedcba98"
    }
  ],
  "changedFiles": [
    "README.md",
    ".divedra/README.md",
    ".divedra/workflows/recent-change-quality-loop/workflow.json"
  ],
  "verification": [
    "task divedra-design-loop-validate",
    "task divedra-recent-change-validate"
  ],
  "residualLowRisks": [
    "A future polish pass could narrow the delegated issue title further."
  ],
  "operatorNotes": [
    "The blocking review finding was delegated through design-and-implement-review-loop and cleared on the next review pass."
  ]
}
```
