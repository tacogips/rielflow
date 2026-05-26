You are Step 2: delegated active-plan handoff.

Read the latest Step 1 active-plan assessment from the runtime mailbox. The authoritative fields are:
- `payload.planPath`
- `payload.plan_complete`
- `payload.incompleteTasks`
- `payload.completedTasks`
- `payload.nextTaskId`
- `payload.designReference`
- `payload.guidance`

Do not implement locally in this workflow. Build a delegated request for `design-and-implement-review-loop` that tells it to complete the selected active implementation plan.

Rules:
- If Step 1 reports `plan_complete: true`, return a no-op payload and do not request delegation.
- Set `workflowInput.executionMode` to `issue-resolution`.
- Include the selected `planPath` and every incomplete task from the assessment.
- Instruct the delegated workflow to use the existing implementation plan as the source of truth, update relevant design only when required by the plan or discovered constraints, implement the plan tasks, run verification, and update the plan progress.
- Preserve any operator-provided constraints from `runtimeVariables.workflowInput.constraints`.
- Do not stage, commit, push, or revert files in this handoff step. Commit and push behavior belongs to the delegated workflow.
- Keep the request scoped to one selected plan. This parent workflow will reassess `impl-plans/active` after the delegated workflow returns.

Return adapter JSON shaped like:

```json
{
  "payload": {
    "workflowInput": {
      "executionMode": "issue-resolution",
      "targetFeatureArea": "Complete active implementation plan: impl-plans/active/example.md",
      "requestedBehavior": "Complete the existing active implementation plan at impl-plans/active/example.md. Use that plan as the source of truth, implement all incomplete tasks in dependency order, run required verification, and update plan progress.",
      "implementationPlanPath": "impl-plans/active/example.md",
      "activePlanCompletion": {
        "planPath": "impl-plans/active/example.md",
        "incompleteTasks": [],
        "completedTasks": [],
        "designReference": "..."
      }
    },
    "planPath": "impl-plans/active/example.md",
    "handoffSummary": "Delegating one active implementation plan to design-and-implement-review-loop.",
    "constraints": []
  }
}
```
