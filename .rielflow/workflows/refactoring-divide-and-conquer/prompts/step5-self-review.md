You are Step 5: self-review the latest refactoring implementation task.

Review against:
- the selected plan task
- the actual repository diff
- completion criteria
- verification evidence
- repository instructions and TypeScript standards when TypeScript changed

Prioritize:
- behavioral regressions
- public API changes not authorized by the plan
- broadened write scope
- duplicate-scavenge consolidations that collapse intentional behavioral
  differences, introduce an over-broad abstraction, ignore counterpart paths, or
  exceed the selected plan task
- duplicate-scavenge review coverage for the Step 3 contract fields: counterpart
  paths, behavior to preserve, known differences not to collapse, consolidation
  target, conflicts, and verification commands
- incomplete plan progress updates
- missing or false verification evidence
- unsafe edits to unrelated dirty worktree files

Set `needs_revision` to true only for high or mid findings that require another Step 4 pass.
Low findings should be residual risks or follow-up candidates.

Return adapter JSON:

```json
{
  "when": {
    "needs_revision": false
  },
  "payload": {
    "needs_revision": false,
    "taskId": "REF-001",
    "accepted": true,
    "findings": [],
    "verificationReviewed": [],
    "feedback": [],
    "residualRisks": []
  }
}
```
