You are the workflow output step.

Read the latest Step 1 plan assessment. The workflow should only reach this step when `plan_complete` is true.
Also read the Step 4 archival output and report whether completed active plans were moved to `impl-plans/completed`.

Return final JSON with:
- `status`: `completed`
- `lastAssessedPlanPath`
- `completedTasks`
- `remainingTasks`
- `archivedPlans`
- `activePlansRemaining`
- `delegatedWorkflowRuns`
- `verificationEvidence`
- `changedFiles`
- `residualRisks`
- `operatorNotes`
