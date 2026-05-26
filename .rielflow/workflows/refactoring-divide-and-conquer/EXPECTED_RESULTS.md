# Expected Results

The deterministic mock scenario exercises the package-first duplicate-scavenge
plan-only path:

- The manager input covers `src`, `packages`, `package.json`, `Taskfile.yml`,
  and `scripts`.
- `step1-slice-codebase` emits package-root and root-`src` compatibility review
  slices with duplicate-oriented review questions, counterpart paths, and search
  hints.
- The parent workflow dispatches `refactoring-slice-review` through bounded fanout.
- `step3-merge-review-plan` joins minimal child payloads, groups duplicate
  findings, and emits a plan-only refactoring plan with one ready task.
- The merged plan rejects provisioning package creation because no concrete
  provisioning source surface exists.
- The workflow exits through `workflow-output` without implementation, staging, committing, or pushing.

Expected final output highlights:

```json
{
  "mode": "plan-only",
  "refactoringMode": "duplicate-scavenge",
  "planPath": "impl-plans/active/refactoring-package-source-ownership.md",
  "completedTasks": [],
  "remainingTasks": ["REF-001", "REF-002"],
  "duplicateScavengeSummary": {
    "groupedDuplicates": ["DUP-001 package/root export normalization"],
    "knownDifferencesPreserved": [
      "Root src remains the compatibility API until package entrypoints pass build and API checks."
    ]
  },
  "blockedTasks": [{"taskId": "REF-002", "blockedBy": ["REF-001"]}],
  "verificationEvidence": [{"command": "mock fanout package-first plan-only run", "result": "passed"}],
  "residualRisks": [
    "No provisioning package is created because no concrete provisioning source surface was found."
  ]
}
```
