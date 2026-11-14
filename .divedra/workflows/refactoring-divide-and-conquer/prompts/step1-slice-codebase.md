You are Step 1: slice the codebase for divide-and-conquer refactoring review.

Goal:
- Identify package-level or related processing-group units that can be reviewed concurrently.
- Slices must be bounded enough that a reviewer can inspect ownership, coupling, and maintainability without editing files.

Inputs:
- `runtimeVariables.workflowInput.targetPaths`: optional paths to prioritize.
- `runtimeVariables.workflowInput.excludePaths`: optional paths to avoid.
- `runtimeVariables.workflowInput.maxSlices`: optional cap. Default to 8.
- `runtimeVariables.workflowInput.refactoringMode`: optional mode such as `duplicate-scavenge`.
- `runtimeVariables.workflowInput.requestedOutcome`: optional refactoring goal.
- `runtimeVariables.workflowInput.constraints`: optional operator constraints.

Recommended slicing:
- Treat explicit `targetPaths` and the `requestedOutcome` as the first slicing
  authority. When they name a focused workflow bundle, skill, package, or
  processing group, form slices inside that requested scope before applying
  broader repository ownership heuristics.
- For broad refactors without focused targets, treat package roots as the
  primary ownership roots: `packages/*`, package manifests, workspace
  build/declaration tooling, and package-local tests.
- Treat root `src` as a temporary compatibility and dependency surface unless
  the requested outcome explicitly says otherwise. Slice `src` by the
  package-owned surface it should feed, such as CLI/public facade, workflow
  model, workflow runtime, add-ons, adapters, server/graphql, events/hooks, TUI,
  or shared utilities.
- Include workflow bundles, scripts, and build files when they are named by the
  target scope or when they encode future package-ownership behavior.
- Split very large areas into cohesive subgroups only when ownership is clear.
- Include dependency notes when a slice depends on another slice or when a root
  `src` compatibility shim depends on package-owned source moving first.
- Keep write scopes disjoint even though Step 2 review is read-only; later plan aggregation depends on clean ownership.

Duplicate-scavenge mode:
- Activate duplicate-scavenge guidance when `workflowInput.refactoringMode` is
  `"duplicate-scavenge"` or when `requestedOutcome`, constraints, or equivalent
  operator text asks to scavenge duplicates, deduplicate custom implementations,
  or consolidate repeated concepts.
- Preserve the target-path/requested-outcome slicing authority first, falling
  back to normal package or processing-group slicing when the request is broad.
  Then add duplicate-oriented `reviewQuestions`, likely counterpart paths, and
  search hints to each slice where useful.
- Search targets include repeated validation, parsing, normalization,
  serialization, path resolution, retry/idempotency, control-flow,
  mailbox/output handling, workflow validation/routing, adapter glue, and
  custom helper logic that appears to implement the same concept in parallel.
- When counterpart paths are known or likely, include them in `dependencyNotes`,
  `reviewQuestions`, or a slice-local `duplicateSearchHints` field so reviewers
  can compare repeated concepts without rediscovering the entire repository.
- Keep later write-scope ownership disjoint. Duplicate search hints may cross
  slices, but they are review context, not permission for the child reviewer to
  edit cross-slice files.

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
          "Runtime implementation files now live under packages/divedra/src/workflow.",
          "Public API callers through packages/divedra/src/index.ts and packages/divedra/src/lib.ts must keep behavior."
        ],
        "reviewQuestions": [
          "Which runtime responsibilities should move behind package-owned exports?",
          "Which packages/divedra/src/workflow imports are temporary compatibility dependencies rather than ownership roots?",
          "In duplicate-scavenge mode, are there duplicate implementations of validation, parsing, normalization, routing, or output handling that should share one existing helper?"
        ],
        "duplicateSearchHints": [
          "Compare validation and routing helper patterns against packages/divedra/src/cli, packages/divedra/src/graphql, packages/divedra/src/server, and packages/*/src.",
          "Record counterpart paths and behavioral differences before proposing consolidation."
        ],
        "suggestedVerification": ["bun test packages/divedra/src/workflow/**/*.test.ts", "bun run build"]
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
