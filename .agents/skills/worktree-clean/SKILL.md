---
name: worktree-clean
description: Use when cleaning managed Git worktrees for the current package. Inspects ../worktrees/{packagename}, keeps worktrees whose branch commits are not merged into the default branch, and removes merged worktree directories with git worktree remove.
metadata:
  short-description: Clean merged package worktrees
---

# Worktree Clean

Use this skill when the user asks to clean, prune, remove, or tidy managed Git worktrees for the current package.

## Required Behavior

- Inspect only this package's managed worktrees under:

```bash
<current-worktree-root>/../worktrees/{packagename}/
```

- If cleanup is run from inside `worktrees/{packagename}`, inspect that existing package managed root instead of nesting another `worktrees/` directory under the current branch worktree.
- Determine the package name the same way branch-creation worktrees do:
  - Prefer the nearest relevant `package.json` name from the current directory up to the repository root.
  - For a scoped npm name such as `@scope/pkg`, use `pkg`.
  - If no package name is available, use the repository root directory name.
- Determine the default branch from `origin/HEAD` when available, otherwise fall back to `main`, then `master`.
- Keep any worktree whose branch commit is not an ancestor of the default branch commit.
- Keep the current worktree, dirty worktrees, detached worktrees, missing branches, and worktrees outside the current package's managed worktree root.
- Remove merged package worktrees with `git worktree remove`; do not delete branches unless the user explicitly asks.
- Dry-run first unless the user explicitly asked to apply cleanup immediately.

## Standard Workflow

1. Inspect the current Git and worktree context:

```bash
git rev-parse --show-toplevel
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || true
git worktree list --porcelain
```

2. Run a dry-run first:

```bash
.agents/skills/worktree-clean/scripts/worktree-clean-merged.sh
```

3. Review the `REMOVE` and `KEEP` lines with the user. If the user asked for actual cleanup or confirms the dry-run result, apply it:

```bash
.agents/skills/worktree-clean/scripts/worktree-clean-merged.sh --apply
```

4. Report:

- The package worktree root inspected.
- The default branch used for merge checks.
- Removed worktree paths.
- Kept worktree paths and the reason each was kept.

## Guardrails

- Do not run `git fetch`, `git reset`, `git clean`, `git branch -d`, or `git branch -D` unless the user explicitly asks.
- Treat stale default-branch refs as a reason to warn the user that merge detection may be out of date; do not fetch unless requested.
- Never force-remove a dirty worktree by default.
- Never remove the worktree that is the current working repository for the cleanup command.
- If a worktree cannot be removed cleanly, leave it in place and report the error.
