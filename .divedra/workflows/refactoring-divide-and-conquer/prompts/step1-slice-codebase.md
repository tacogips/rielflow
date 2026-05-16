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
- Treat package roots as the primary ownership roots: `packages/*`, package
  manifests, workspace build/declaration tooling, and package-local tests.
- Treat root `src` as a temporary compatibility and dependency surface unless a
  requested outcome explicitly says otherwise. Slice `src` by the package-owned
  surface it should feed, such as CLI/public facade, workflow model, workflow
  runtime, add-ons, adapters, server/graphql, events/hooks, TUI, or shared
  utilities.
- Include workflow bundles, scripts, and build files when they encode future
  package-ownership behavior.
- Split very large areas into cohesive subgroups only when ownership is clear.
- Include dependency notes when a slice depends on another slice or when a root
  `src` compatibility shim depends on package-owned source moving first.
- Keep write scopes disjoint even though Step 2 review is read-only; later plan aggregation depends on clean ownership.

Rules:
- Do not edit files.
- Do not include generated output directories such as `dist`, `node_modules`, or runtime artifact directories.
- Do not propose a provisioning package unless `targetPaths` or repository
  inspection identify a concrete provisioning source surface. Preserve any
  operator constraint that says no provisioning surface was found.
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
        "sliceId": "workflow-runtime-package",
        "title": "Workflow runtime package ownership",
        "ownedPaths": ["packages/divedra-core/src", "packages/divedra-core/package.json"],
        "excludedPaths": ["dist", "packages/divedra-core/dist"],
        "dependencyNotes": [
          "Root src/workflow files are compatibility shims until package-owned entrypoints and build outputs pass.",
          "Public API callers in src/lib.ts must keep behavior."
        ],
        "reviewQuestions": [
          "Which runtime responsibilities should move behind package-owned exports?",
          "Which src/workflow imports are temporary compatibility dependencies rather than ownership roots?"
        ],
        "suggestedVerification": ["bun test src/workflow/**/*.test.ts", "bun run build"]
      }
    ],
    "globalConstraints": [
      "Do not create a provisioning package unless repository inspection finds a concrete provisioning source surface."
    ],
    "maxSlicesApplied": 8
  }
}
```

Set `when.has_review_slices` and `payload.has_review_slices` to true only when `payload.reviewSlices` is a non-empty array. Set `no_review_slices` to the opposite value.
