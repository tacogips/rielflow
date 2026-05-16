You are Step 3: merge concurrent slice-review outputs into a refactoring plan.

Inputs:
- `runtimeVariables.fanoutJoin` contains the ordered slice-review fanout results.
- `runtimeVariables.workflowInput.executionMode` controls plan-only behavior.
- `runtimeVariables.workflowInput.planPath` may name an existing plan to update.
- The latest Step 1 output contains slice definitions and constraints.

Plan-only mode:
- Treat `executionMode: "plan-only"`, `"planning-only"`, or `"refactor-plan-only"` as plan-only.
- In plan-only mode, create or update the plan and set `when.plan_only: true`.
- Set `implementation_ready` true only when implementation should proceed immediately.
- Set `no_plan_tasks` true only when there are no actionable implementation tasks.

Aggregation rules:
- Deduplicate overlapping findings across slices.
- Reject weak findings that are cosmetic-only, not actionable, or lack an ownership path.
- Convert accepted high/mid findings into a task DAG with dependencies.
- Keep each task bounded to a small write scope.
- Mark tasks parallelizable only when write scopes are disjoint.
- Preserve conflict notes and cross-slice dependency risks.
- Prefer writing the plan under `impl-plans/active/refactoring-<topic>.md` unless `workflowInput.planPath` is provided.

Implementation-plan requirements:
- Include task ids such as `REF-001`.
- Each task must include status, owned files/directories, excluded files, dependencies, completion criteria, verification commands, and residual risk notes.
- Include a progress log section.
- Include explicit exit criteria for high/mid findings and accepted low residual risks.

Return adapter JSON:

```json
{
  "when": {
    "plan_only": false,
    "no_plan_tasks": false,
    "implementation_ready": true
  },
  "payload": {
    "planPath": "impl-plans/active/refactoring-runtime-boundaries.md",
    "plan_only": false,
    "no_plan_tasks": false,
    "implementation_ready": true,
    "has_plan_tasks": true,
    "planOnly": false,
    "hasPlanTasks": true,
    "acceptedFindings": [],
    "rejectedFindings": [],
    "tasks": [
      {
        "taskId": "REF-001",
        "title": "Extract runtime validation boundary",
        "status": "Ready",
        "ownedPaths": ["src/workflow"],
        "excludedPaths": [],
        "dependsOn": [],
        "verificationCommands": ["bun test src/workflow/validate.test.ts"]
      }
    ],
    "nextTaskId": "REF-001",
    "conflicts": [],
    "residualRisks": []
  }
}
```

Mirror routing booleans into payload: `plan_only`, `no_plan_tasks`, and `implementation_ready`.
Set `no_plan_tasks: true` and `has_plan_tasks: false` when every accepted finding is low-only, rejected, or blocked without a safe implementation task.
