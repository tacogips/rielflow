# Project Divedra Workflows

This repository ships project-local `divedra` workflows under `.divedra/workflows`.

These workflows are discovered automatically when commands are run from the
repository root because `divedra` treats `<project>/.divedra/workflows` as the
project catalog.

## Available Workflows

- `design-and-implement-review-loop`: issue intake, design-doc update, design self-review, design review, implementation-plan creation, implementation-plan self-review, implementation-plan review, optional implementation with self-review, and final review.
- `recent-change-quality-loop`: review recent committed and uncommitted changes, fix blocking findings, and loop until only low-severity risks remain.

## Root Commands

List available workflows from this repository:

```bash
task divedra-workflows
```

Validate the bundled design-and-implement workflow:

```bash
task divedra-design-loop-validate
```

Validate the bundled recent-change workflow:

```bash
task divedra-recent-change-validate
```

Run any `divedra` command through the local submodule:

```bash
task divedra -- workflow list
task divedra -- workflow inspect design-and-implement-review-loop --output json
task divedra -- workflow usage --output json
```

Run the bundled planning and implementation workflow with its deterministic mock
scenario:

```bash
task divedra -- workflow run design-and-implement-review-loop \
  --mock-scenario .divedra/workflows/design-and-implement-review-loop/mock-scenario.json \
  --output json
```

Run the bundled recent-change workflow with its deterministic mock scenario:

```bash
task divedra -- workflow run recent-change-quality-loop \
  --mock-scenario .divedra/workflows/recent-change-quality-loop/mock-scenario.json \
  --output json
```

For direct `nix` usage without `task`, the equivalent entry point is:

```bash
nix run ./divedra -- workflow list
```
