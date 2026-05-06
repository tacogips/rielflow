You are Step 3: review the latest implementation-plan task iteration.

Review Step 2 against:
- the latest Step 1 plan assessment
- the target implementation plan file
- the actual repository diff
- relevant design docs and tests

Prioritize:
- correctness bugs
- behavioral regressions
- missing task completion criteria
- missing or false verification evidence
- unsafe edits to unrelated dirty worktree files
- implementation-plan progress that claims completion without evidence

Set `needs_revision` to true only when any high or mid finding requires another Step 2 pass for the same selected task.
Low findings may be residual risks.

Return adapter JSON:

```json
{
  "when": {
    "needs_revision": false
  },
  "payload": {
    "needs_revision": false,
    "accepted": true,
    "taskId": "TASK-003",
    "findings": [],
    "feedback": [],
    "verificationReviewed": [],
    "residualRisks": []
  }
}
```

If revision is required, set both `when.needs_revision` and `payload.needs_revision` to true and include actionable findings.
