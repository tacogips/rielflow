You are Step 3: delegated implementation handoff.

Prepare a delegated issue-resolution request for `design-and-implement-review-loop` from the latest Step 1 review. Do not fix the findings locally in this workflow.

Rules:
- Read the latest Step 1 and Step 2 outputs before editing.
- Build a concise delegated request that `design-and-implement-review-loop` can consume through `runtimeVariables.workflowCall.input`.
- Set the delegated workflow mode to issue resolution.
- Include the blocking findings, review window, recommended fix plan, and verification suggestions in a structured `reviewContext`.
- Keep the delegated request narrowly scoped to the blocking recent-change findings.
- Preserve any user-supplied target paths or review constraints that should survive the handoff.

Return JSON with:
- `workflowInput`
- `reviewContext`
- `handoffSummary`
