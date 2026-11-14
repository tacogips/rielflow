---
name: git-new-branch
description: Use when creating a new Git branch for work in this repository. Requires managing new branches with git worktree and placing the worktree under ../worktrees/{packagename}/{branch_name} relative to the current worktree root.
metadata:
  short-description: Create branches in managed worktrees
---

# Git New Branch

Use this skill when the user asks to create, start, open, or switch to a new Git branch for a task.

## Required Behavior

- Create or attach branches using `git worktree`; do not use `git checkout -b` or `git switch -c` in the current worktree.
- Base a new branch on the current `HEAD` unless the user gives an explicit start point.
- Place the worktree at the package managed root:

```bash
<current-worktree-root>/../worktrees/{packagename}/{branch_name}
```

- If the current repository is already inside `worktrees/{packagename}`, reuse that existing package managed root instead of nesting another `worktrees/` directory under the branch worktree.
- Preserve slashes in `{branch_name}` so branch names like `feature/foo` create nested worktree paths.
- Determine `{packagename}` from the current package context:
  - Prefer the nearest `package.json` name from the current directory up to the repository root.
  - For a scoped npm name such as `@scope/pkg`, use `pkg`.
  - If no package name is available, use the repository root directory name.

## Standard Workflow

1. Inspect the current Git context:

```bash
git rev-parse --show-toplevel
git branch --show-current
git status --short
```

2. If the current worktree has uncommitted changes, tell the user those changes stay in the current worktree and are not automatically copied into the new branch worktree.

3. Create or attach the branch worktree with the bundled helper:

```bash
.agents/skills/git-new-branch/scripts/git-new-branch-worktree.sh <branch-name> [start-point]
```

4. Report:

- The branch name.
- Whether the branch was created or an existing branch was attached.
- The worktree path.
- The start point used.

## Manual Command Pattern

If the helper script is unavailable, use this pattern from the current worktree:

```bash
repo_root="$(git rev-parse --show-toplevel)"
package_name="<path-safe-package-name>"
branch_name="<branch-name>"
managed_root="<existing-or-adjacent-worktrees-root>/${package_name}"
target_path="${managed_root}/${branch_name}"
mkdir -p "$(dirname "${target_path}")"
git worktree add -b "${branch_name}" "${target_path}" HEAD
```

If the branch already exists, attach it instead:

```bash
git worktree add "${target_path}" "${branch_name}"
```

## Guardrails

- Validate branch names with `git check-ref-format --branch`.
- Ensure the resolved target path stays inside the managed package worktree root.
- Do not overwrite an existing target directory.
- If a branch is already checked out in another worktree, show `git worktree list --porcelain` and ask the user how to proceed.
- Do not clean, reset, stash, or move user changes unless the user explicitly asks.
