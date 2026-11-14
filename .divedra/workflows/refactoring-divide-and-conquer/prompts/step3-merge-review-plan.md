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
- When duplicate-scavenge intent is present, group duplicate findings across
  slices before creating tasks. The Step 3 duplicate group and task contract is
  the canonical downstream contract for Steps 4 through 6. Use these exact field
  concepts when recording implementation work: repeated concept, owner paths,
  counterpart duplicate paths, behavior to preserve, known differences not to
  collapse, consolidation target, dependency order, conflicts, confidence, and
  verification commands.
- Create a ready duplicate-consolidation task only when ownership, migration
  order, behavior to preserve, known differences not to collapse, write scope,
  conflicts, and verification commands are explicit.
- Convert weak or under-owned duplicate findings into blocked or investigation
  tasks instead of a broad consolidation task.
- Prefer using an existing helper, API, workflow primitive, add-on, or narrowly
  owned abstraction when it already matches the repeated concept. Do not invent a
  shared abstraction when apparent duplicates have intentional domain,
  lifecycle, error-semantics, performance, or security-boundary differences.
- Reject weak findings that are cosmetic-only, not actionable, or lack an ownership path.
- Reject package creation for a named surface when slice review or operator
  constraints say no concrete source surface exists. In particular, do not add a
  provisioning package only because provisioning was mentioned as a possible
  category.
- Convert accepted high/mid findings into a task DAG with dependencies.
- Keep each task bounded to a small write scope.
- Mark tasks parallelizable only when write scopes are disjoint.
- Preserve conflict notes and cross-slice dependency risks.
- Preserve package-first ownership intent: tasks should move source ownership
  toward packages and leave root `src` as compatibility shims until package
  entrypoints, tests, build outputs, CLI smoke checks, and library API
  compatibility pass.
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
    "duplicateGroups": [
      {
        "groupId": "DUP-001",
        "repeatedConcept": "workflow input validation",
        "ownerPaths": ["packages/divedra/src/workflow/example.ts"],
        "counterpartPaths": ["packages/divedra/src/cli/example.ts", "packages/divedra/src/graphql/example.ts"],
        "behaviorToPreserve": ["CLI usage errors", "GraphQL typed errors"],
        "knownDifferencesNotToCollapse": ["Different external error envelopes."],
        "consolidationTarget": "Existing validation helper or new narrow workflow-owned helper.",
        "conflicts": [],
        "verificationCommands": ["bun test packages/divedra/src/workflow/example.test.ts"]
      }
    ],
    "tasks": [
      {
        "taskId": "REF-001",
        "title": "Move workflow runtime ownership to package exports",
        "status": "Ready",
        "ownedPaths": ["packages/divedra-core/src", "packages/divedra-core/package.json"],
        "excludedPaths": ["packages/divedra/src/workflow/**/*.test.ts", "dist", "packages/divedra-core/dist"],
        "dependsOn": [],
        "duplicateGroupIds": ["DUP-001"],
        "repeatedConcept": "workflow input validation",
        "counterpartPaths": ["packages/divedra/src/cli/example.ts", "packages/divedra/src/graphql/example.ts"],
        "behaviorToPreserve": ["CLI usage errors", "GraphQL typed errors"],
        "knownDifferencesNotToCollapse": ["Different external error envelopes."],
        "consolidationTarget": "Existing validation helper or new narrow workflow-owned helper.",
        "conflicts": [],
        "verificationCommands": ["bun test packages/divedra/src/workflow/**/*.test.ts", "bun run build"]
      }
    ],
    "nextTaskId": "REF-001",
    "conflicts": [],
    "residualRisks": [
      "Former root workflow sources now live under packages/divedra/src/workflow.",
      "No provisioning package is planned because no concrete provisioning source surface was identified."
    ]
  }
}
```

Mirror routing booleans into payload: `plan_only`, `no_plan_tasks`, and `implementation_ready`.
Set `no_plan_tasks: true` and `has_plan_tasks: false` when every accepted finding is low-only, rejected, or blocked without a safe implementation task.
