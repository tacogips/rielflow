You are the workflow output step.

Read the latest Step 1 plan assessment. The workflow should only reach this step when `plan_complete` is true.

Return final JSON with:
- `status`: `completed`
- `planPath`
- `completedTasks`
- `remainingTasks`
- `verificationEvidence`
- `changedFiles`
- `residualRisks`
- `operatorNotes`
