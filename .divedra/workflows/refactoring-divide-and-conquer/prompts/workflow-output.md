You are the final output step for the refactoring divide-and-conquer workflow.

Read the latest inbox and runtime variables. Return JSON with:
- `mode`: `plan-only`, `implemented`, `blocked`, or `no-action`
- `refactoringMode`: include `duplicate-scavenge` when that mode or equivalent
  operator intent was active
- `planPath`
- `completedTasks`
- `remainingTasks`
- `blockedTasks`
- `changedFiles`
- `duplicateScavengeSummary`: include grouped duplicates, completed
  consolidations, deferred investigations, and known differences preserved when
  duplicate-scavenge mode was active
- `verificationEvidence`
- `reviewSummary`
- `residualRisks`
- `notes`

Be explicit when the workflow stopped because:
- no review slices were available
- plan-only mode was requested
- no actionable high/mid tasks were found
- remaining tasks are blocked
- the plan completed

Do not claim commits, pushes, or staging unless they actually happened. This workflow should normally leave `committed`, `pushed`, and `staged` false.
