# Project Divedra Workflows

This repository ships project-local `divedra` workflows under `.divedra/workflows`.

These workflows are discovered automatically when commands are run from the
repository root because `divedra` treats `<project>/.divedra/workflows` as the
project catalog.

## Available Workflows

- `design-and-implement-review-loop`: issue intake, design-doc update, design self-review, design review, implementation-plan creation, implementation-plan self-review, implementation-plan review, optional implementation with self-review, and final review.
- `refactoring-divide-and-conquer`: divide the codebase into package or related processing-group slices, review slices concurrently through `refactoring-slice-review`, merge findings into a refactoring plan, implement one bounded task at a time, self-review, independently post-review, and loop until complete.
- `refactoring-slice-review`: read-only review workflow used as the fanout child for one refactoring slice.
- `impl-plan-completion-loop`: execute active implementation-plan tasks until the selected target plan is completed, without staging, committing, or pushing.
- `recent-change-quality-loop`: review recent committed and uncommitted changes, fix blocking findings, and loop until only low-severity risks remain.

## Root Commands

List available workflows from this repository:

```bash
bun run packages/divedra/src/bin.ts workflow list
```

Validate the bundled workflows:

```bash
bun run packages/divedra/src/bin.ts workflow validate design-and-implement-review-loop
bun run packages/divedra/src/bin.ts workflow validate refactoring-divide-and-conquer
bun run packages/divedra/src/bin.ts workflow validate refactoring-slice-review
bun run packages/divedra/src/bin.ts workflow validate impl-plan-completion-loop
bun run packages/divedra/src/bin.ts workflow validate recent-change-quality-loop
```

Inspect workflow usage:

```bash
bun run packages/divedra/src/bin.ts workflow inspect design-and-implement-review-loop --output json
bun run packages/divedra/src/bin.ts workflow usage --output json
```

Run the bundled planning and implementation workflow with its deterministic mock
scenario:

```bash
bun run packages/divedra/src/bin.ts workflow run design-and-implement-review-loop \
  --mock-scenario .divedra/workflows/design-and-implement-review-loop/mock-scenario.json \
  --output json
```

Run the refactoring workflow in deterministic plan-only mode:

```bash
bun run packages/divedra/src/bin.ts workflow run refactoring-divide-and-conquer \
  --mock-scenario .divedra/workflows/refactoring-divide-and-conquer/mock-scenario.json \
  --variables '{"workflowInput":{"executionMode":"plan-only","targetPaths":["packages/divedra/src/workflow","packages/divedra/src/cli"],"maxSlices":2}}' \
  --output json
```

Run the bundled recent-change workflow with its deterministic mock scenario:

```bash
bun run packages/divedra/src/bin.ts workflow run recent-change-quality-loop \
  --mock-scenario .divedra/workflows/recent-change-quality-loop/mock-scenario.json \
  --output json
```

For `nix` usage, the equivalent entry point is:

```bash
nix run .#divedra -- workflow list
```
