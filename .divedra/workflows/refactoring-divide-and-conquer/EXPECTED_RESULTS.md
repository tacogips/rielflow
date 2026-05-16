# Expected Results

The deterministic mock scenario exercises the package-first plan-only path:

- The manager input covers `src`, `packages`, `package.json`, `Taskfile.yml`,
  and `scripts`.
- `step1-slice-codebase` emits package-root and root-`src` compatibility review
  slices.
- The parent workflow dispatches `refactoring-slice-review` through bounded fanout.
- `step3-merge-review-plan` joins the fanout results and emits a plan-only refactoring plan with one ready task.
- The merged plan rejects provisioning package creation because no concrete
  provisioning source surface exists.
- The workflow exits through `workflow-output` without implementation, staging, committing, or pushing.

Expected final output highlights:

```json
{
  "mode": "plan-only",
  "planPath": "impl-plans/active/refactoring-package-source-ownership.md",
  "completedTasks": [],
  "remainingTasks": ["REF-001", "REF-002"],
  "residualRisks": [
    "No provisioning package is created because no concrete provisioning source surface was found."
  ]
}
```
