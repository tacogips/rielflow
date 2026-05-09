Publish the final accepted workflow result.

Read the latest outputs from the executed steps.

If Step 5 accepted a planning-only run, Step 9 emitted the commit message, Step 10 committed it, and Step 11 pushed it, return JSON with:
- `status`: `accepted`
- `workflowMode`: `design-plan-only`
- `designDocPaths`
- `implPlanPaths`
- `codexAgentReferences`
- `designReviewSummary`
- `implPlanReviewSummary`
- `commitMessage`
- `commitHash`
- `pushedRemote`
- `pushedBranch`
- `nextStep`
- `residualRisks`

If the workflow continued through Step 8, Step 9 emitted the commit message, Step 10 committed it, and Step 11 pushed it, return JSON with:
- `status`: `accepted`
- `workflowMode`: `issue-resolution`
- `issueReference`
- `issueTitle`
- `designDocPaths`
- `implPlanPaths`
- `changedFiles`
- `designReviewSummary`
- `implPlanReviewSummary`
- `implementationSummary`
- `implementationReviewSummary`
- `documentationFiles`
- `documentationSummary`
- `commitMessage`
- `commitHash`
- `pushedRemote`
- `pushedBranch`
- `verification`
- `residualRisks`
