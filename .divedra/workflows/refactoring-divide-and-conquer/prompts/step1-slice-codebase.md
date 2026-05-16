You are Step 1: slice the codebase for divide-and-conquer refactoring review.

Goal:
- Identify package-level or related processing-group units that can be reviewed concurrently.
- Slices must be bounded enough that a reviewer can inspect ownership, coupling, and maintainability without editing files.

Inputs:
- `runtimeVariables.workflowInput.targetPaths`: optional paths to prioritize.
- `runtimeVariables.workflowInput.excludePaths`: optional paths to avoid.
- `runtimeVariables.workflowInput.maxSlices`: optional cap. Default to 8.
- `runtimeVariables.workflowInput.requestedOutcome`: optional refactoring goal.
- `runtimeVariables.workflowInput.constraints`: optional operator constraints.

Recommended slicing:
- Prefer package roots first: `packages/*`, `src/workflow`, `src/cli`, `src/graphql`, `src/server`, `src/events`, `src/tui`, `src/shared`, `ui`, `.divedra/workflows`.
- Split very large areas into cohesive subgroups only when ownership is clear.
- Include dependency notes when a slice depends on another slice.
- Keep write scopes disjoint even though Step 2 review is read-only; later plan aggregation depends on clean ownership.

Rules:
- Do not edit files.
- Do not include generated output directories such as `dist`, `node_modules`, or runtime artifact directories.
- Avoid creating many tiny slices that cannot produce useful findings.
- If no safe review slices can be formed, return `has_review_slices: false` and explain why.
- Mirror routing booleans in both `when` and `payload`: `has_review_slices` and `no_review_slices`.

Return adapter JSON:

```json
{
  "when": {
    "has_review_slices": true,
    "no_review_slices": false
  },
  "payload": {
    "has_review_slices": true,
    "no_review_slices": false,
    "strategy": "package-and-processing-group",
    "reviewSlices": [
      {
        "sliceId": "workflow-runtime",
        "title": "Workflow runtime",
        "ownedPaths": ["src/workflow"],
        "excludedPaths": ["src/workflow/**/*.test.ts"],
        "dependencyNotes": ["Public API callers in src/lib.ts must keep behavior."],
        "reviewQuestions": [
          "Can runtime responsibilities be separated into smaller ownership boundaries?",
          "Are validation, execution, and persistence concerns coupled unnecessarily?"
        ],
        "suggestedVerification": ["bun test src/workflow/**/*.test.ts"]
      }
    ],
    "globalConstraints": [],
    "maxSlicesApplied": 8
  }
}
```

Set `when.has_review_slices` and `payload.has_review_slices` to true only when `payload.reviewSlices` is a non-empty array. Set `no_review_slices` to the opposite value.
