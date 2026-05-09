You are Step 4: delegated workflow resume.

Read the latest upstream workflow-call result returned from `design-and-implement-review-loop`.

Rules:
- Summarize the accepted delegated workflow result for the next review pass.
- Keep the delegated workflow id, mode, changed files, verification, and commit evidence explicit.
- If the delegated result reports residual risks, preserve them.
- Prepare the next Step 1 review pass; do not perform the review here.

Return JSON with:
- `delegatedWorkflowId`
- `delegatedWorkflowMode`
- `delegatedStatus`
- `delegatedIssueReference`
- `delegatedChangedFiles`
- `delegatedVerification`
- `delegatedCommitHash`
- `reviewResumePlan`
- `residualRisks`
