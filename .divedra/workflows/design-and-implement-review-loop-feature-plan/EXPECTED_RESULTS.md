# Expected Results

Stable assertions for deterministic verification with the bundled mock scenario.
Ignore `sessionId`, timestamps, and artifact paths.

## Validate

Command:

```bash
bun run packages/divedra/src/bin.ts workflow validate design-and-implement-review-loop-feature-plan --workflow-definition-dir .divedra/workflows
```

Expected result: the workflow is valid.

## Run

Accepted feature-plan command:

```bash
bun run packages/divedra/src/bin.ts workflow run design-and-implement-review-loop-feature-plan \
  --workflow-definition-dir .divedra/workflows \
  --mock-scenario .divedra/workflows/design-and-implement-review-loop-feature-plan/mock-scenario.json \
  --output json
```

Expected stable run summary:

```json
{
  "status": "completed",
  "workflowName": "design-and-implement-review-loop-feature-plan",
  "workflowId": "design-and-implement-review-loop-feature-plan",
  "nodeExecutions": 7,
  "transitions": 6,
  "exitCode": 0
}
```

Expected path: `step2-design-doc-update` -> `step2-design-self-review` -> `step3-design-review` -> `step4-impl-plan-create` -> `step4-impl-plan-self-review` -> `step5-impl-plan-review` -> `workflow-output`

Expected final output node: `workflow-output`

Expected final output payload:

```json
{
  "status": "accepted",
  "featureId": "session-history-reference",
  "designDocPaths": [
    "design-docs/specs/design-session-history-reference.md"
  ],
  "implPlanPaths": [
    "impl-plans/active/session-history-reference.md"
  ],
  "designReviewSummary": "Independent design review accepted the feature-local design.",
  "implPlanReviewSummary": "Independent implementation-plan review accepted the plan.",
  "verification": [
    "bun test packages/divedra/src/workflow/session-history.test.ts"
  ],
  "residualRisks": []
}
```
