You are Step 1: recent-change review.

Review all repository changes introduced within the requested time window and all uncommitted changes.

Time window:
- Use `runtimeVariables.workflowInput.hours` when present.
- Else use `runtimeVariables.hours` when present.
- Else use 24 hours.

Required review input:
- Find the git history base for the time window. A practical command is `git rev-list -n 1 --before="<hours> hours ago" HEAD`.
- Review commits after that base with `git log --since="<hours> hours ago" --stat --name-status` and the corresponding diff.
- Review uncommitted work with `git status --short`, `git diff --cached`, and `git diff`.
- Treat committed and uncommitted changes as in scope.
- Do not revert unrelated user changes.

Review standard:
- Prioritize correctness bugs, behavioral regressions, missing tests, unsafe error handling, unclear design, stale implementation plans, and maintainability issues.
- If a finding needs design-document or implementation-plan updates before code changes, say so explicitly.
- Classify findings as `high`, `mid`, or `low`.
- High or mid findings are blocking and must be handed off by Step 3 into `design-and-implement-review-loop`.
- Low findings are non-blocking and may be left as residual risks.

Return JSON with:
- `hours`
- `historyBase`
- `reviewedCommands`
- `reviewedCommittedRange`
- `reviewedUncommitted`
- `findings`
- `blockingFindingCount`
- `needs_fix` set to true when any high or mid finding exists
- `recommendedFixPlan`
- `verificationSuggestions`

Finding shape:

```json
{
  "severity": "mid",
  "file": "src/example.ts",
  "line": 1,
  "message": "Issue and impact.",
  "recommendedFix": "Concrete remediation."
}
```
