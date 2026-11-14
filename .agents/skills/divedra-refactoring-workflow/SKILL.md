---
name: divedra-refactoring-workflow
description: Use when planning, running, monitoring, or troubleshooting the project-local divedra divide-and-conquer refactoring workflow. Applies to `.divedra/workflows/refactoring-divide-and-conquer`, duplicate-scavenge refactoring, concurrent slice review via `refactoring-slice-review`, generated refactoring implementation plans, implementation/review loop handling, blocked verification, dependency-owned agent mocks, and final plan archival.
---

# Divedra Refactoring Workflow

Use this skill when the user asks to refactor divedra through the divide-and-conquer workflow, asks whether the refactoring workflow is progressing, or asks to create/continue a maintainability refactor using workflow review loops.

## Workflow Bundle

- Parent workflow: `.divedra/workflows/refactoring-divide-and-conquer`
- Child workflow: `.divedra/workflows/refactoring-slice-review`
- Typical generated plan path: `impl-plans/active/refactoring-runtime-boundaries.md`
- Completed plans must move to `impl-plans/completed/` and be indexed in `impl-plans/README.md`.

## Standard Run

Run from the repository root:

```bash
bun run src/main.ts workflow run refactoring-divide-and-conquer \
  --workflow-definition-dir .divedra/workflows \
  --variables '{"workflowInput":{"requestedOutcome":"Improve divedra maintainability using divide-and-conquer refactoring.","targetPaths":["src/workflow","src/cli","src/lib.ts","packages",".divedra/workflows"],"excludePaths":["dist","node_modules","/tmp","impl-plans/completed"],"maxSlices":6,"constraints":["Do not stage, commit, or push unless the user explicitly asks.","Do not revert unrelated dirty worktree changes.","Keep each implementation pass to one bounded task.","Update any generated refactoring plan progress as tasks are implemented."],"verificationPreferences":["Run narrow Bun tests for touched code first.","Run workflow validate for changed workflow bundles.","Run git diff --check before completion."]}}' \
  --output json --verbose --no-auto-improve
```

Adjust `requestedOutcome`, `targetPaths`, `excludePaths`, and `constraints` to the user's request. Keep the constraints explicit so worker nodes preserve unrelated worktree changes and do not stage/commit/push during refactoring.

## Duplicate-Scavenge Mode

Use duplicate-scavenge mode when the user asks to find duplicated
implementations, parallel custom implementations of the same concept, or code
that should be unified behind one helper, API, or abstraction.

Keep this as a mode of `refactoring-divide-and-conquer`; do not create or run a
separate duplicate-only workflow. The workflow prompts own the detailed runtime
contracts:

- Step 1 slices explicit `targetPaths` first, then broad package/processing
  groups when the request is not targeted.
- `refactoring-slice-review` owns per-slice duplicate evidence.
- Step 3 owns merged `duplicateGroups` and implementation task contracts.
- Steps 4 through 6 implement and review only the Step 3-authorized task
  fields.

Example input:

```json
{
  "workflowInput": {
    "requestedOutcome": "Run duplicate-scavenge refactoring on the selected paths and consolidate safe duplicate candidates.",
    "refactoringMode": "duplicate-scavenge",
    "targetPaths": ["src", "packages", ".divedra/workflows"],
    "excludePaths": ["dist", "node_modules", "impl-plans/completed"],
    "maxSlices": 8,
    "constraints": [
      "Do not stage, commit, or push unless the user explicitly asks.",
      "Do not revert unrelated dirty worktree changes.",
      "Preserve public behavior and public APIs unless the plan explicitly authorizes a change.",
      "Prefer consolidation only when counterpart implementations have matching semantics or documented differences."
    ],
    "verificationPreferences": [
      "Run focused tests for each consolidated behavior.",
      "Run workflow validate when workflow bundles change.",
      "Run git diff --check before completion."
    ]
  }
}
```

When reviewing results, reject broad abstractions that only remove superficial
similarity. Accepted duplicate-scavenge tasks should preserve the Step 3
contract fields: owned paths, counterpart paths, behavior to preserve, known
differences not to collapse, consolidation target, conflicts, and narrow
verification commands.

## Monitoring

Record the parent session id from workflow output. Monitor with:

```bash
bun run src/main.ts session status <session-id> --output json
```

Useful compact status query:

```bash
bun run src/main.ts session status <session-id> --output json \
  | jq '{status, queue, nodeExecutionCounter, currentStepId, counts:.nodeExecutionCounts, lastTransition:(.transitions[-1] // null), lastExec:(.nodeExecutions[-1] // null)}'
```

Implementation nodes can be quiet for several minutes while an agent backend edits and verifies. Treat silence as a stall only after checking the process/session state.

## Expected Loop

The parent workflow should:

1. Have the manager normalize scope and constraints.
2. Slice the codebase by package or related processing group.
3. Fan out concurrent child `refactoring-slice-review` runs.
4. Merge findings into an implementation plan.
5. Implement exactly one bounded task.
6. Self-review.
7. Post-review.
8. Loop to implementation when `needs_revision` or `plan_remaining` is true.
9. Stop at `workflow-output` when complete or when only accepted/blocked residual work remains.

Do not manually edit files while an implementation node is actively running unless the workflow has failed or the user explicitly redirects the task.

## Verification

After workflow completion, independently verify instead of relying only on workflow-recorded evidence:

```bash
bun run typecheck:server
bun run lint:biome
git diff --check
```

Run focused tests for touched areas. Common examples:

```bash
bun test src/workflow/adapters/codex.test.ts src/workflow/adapters/claude.test.ts
bun test src/workflow/runtime-execution-contracts.test.ts src/workflow/engine-fanout.test.ts src/workflow/adapter.test.ts
bun test src/workflow/save.test.ts src/workflow/session-store.test.ts src/workflow/manager-session-store.test.ts
bun test src/package-boundaries.test.ts
```

Validate changed workflows:

```bash
bun run src/main.ts workflow validate refactoring-divide-and-conquer --workflow-definition-dir .divedra/workflows --output json
bun run src/main.ts workflow validate refactoring-slice-review --workflow-definition-dir .divedra/workflows --output json
```

If mock scenarios changed, run them with `workflow run --mock-scenario`.

## Agent Package Mock Rule

Do not create divedra-local replacements for dependency agent mocks. divedra adapter tests should consume dependency-owned test SDK exports, such as:

- `codex-agent/sdk/testing`
- `claude-code-agent/sdk/testing`

If those exports are missing, update or fix the owning dependency package (`codex-agent`, `claude-code-agent`, or `cursor-cli-agent`) rather than teaching divedra dependency internals.

## Completion

When the plan is complete:

- Mark the plan status and exit criteria complete.
- Move the plan from `impl-plans/active/` to `impl-plans/completed/`.
- Update `impl-plans/README.md`.
- Report completed tasks, residual risks, verification results, and whether anything was staged/committed/pushed.

Only commit or push when the user explicitly asks.
