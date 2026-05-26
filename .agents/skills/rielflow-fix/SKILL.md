---
name: rielflow-fix
description: Use when a rielflow workflow, CLI command, GraphQL control plane, event listener, or submodule integration appears to fail because of an upstream rielflow bug. Requires reproducing with the local submodule, filing an issue in tacogips/rielflow when the bug is real, fixing the submodule, validating it, and committing the rielflow change.
---

# Rielflow Fix Workflow

Use this skill when work in this repository indicates that `rielflow` itself may be wrong, incomplete, or misaligned with its documented behavior.

## Source Boundary

- Treat `./rielflow` as the authoritative `rielflow` checkout for this repository.
- Do not use `github:tacogips/rielflow` or a globally installed `rielflow` to diagnose or fix behavior unless comparing versions is necessary.
- Prefer `task rielflow -- <args>` from the parent repository, or `bun run src/main.ts <args>` from `./rielflow` when editing the submodule directly.

## Triage

1. Reproduce the failure with the local submodule checkout.
2. Determine whether the fault is in this repository's integration or in `./rielflow`.
3. If the fault is integration-only, fix this repository and do not file an upstream issue.
4. If the fault is in `./rielflow`, collect the command, input files, expected behavior, actual behavior, and relevant logs.

## Upstream Issue

When the fault is in `rielflow`, create an issue in `tacogips/rielflow` before or alongside the fix:

```bash
gh issue create --repo tacogips/rielflow --title "<concise bug title>" --body-file <issue-body-file>
```

The issue body should include:

- Reproduction steps using `./rielflow` or `task rielflow --`.
- Expected behavior and actual behavior.
- Environment details that affect execution, such as Bun, Nix, OS, workflow root, and relevant command flags.
- Links or paths to affected workflow fixtures when they are safe to reference.

If `gh` is unavailable or authentication fails, write the issue body to a temporary markdown file, report the blocker, and continue only if the requested fix can still be validated locally.

## Submodule Fix

1. Work inside `./rielflow`.
2. Follow `./rielflow/AGENTS.md` and its implementation-plan requirements for non-trivial TypeScript changes.
3. Keep fixes minimal and covered by targeted tests.
4. Run the smallest meaningful validation first, then broader checks when practical:
   - `bun test <targeted-test>`
   - `bun run typecheck`
   - `task ci`
5. Commit the submodule fix in `./rielflow` with no automated-assistant attribution or co-authorship trailers.
6. Return to the parent repository, stage the updated submodule pointer, and commit the parent change when the parent repository should track the fixed submodule revision.

## Reporting

In the final response, include the issue URL or issue creation blocker, the submodule commit hash, the parent repository files or submodule pointer updated, and validation commands that passed or could not be run.
