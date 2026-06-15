# Source Security Check Loop Package

This package contains the `codex-source-security-check-loop` workflow and a Codex skill for running it. Keep scanner behavior deterministic, portable, and evidence-driven. Refresh `rielflow-package.json` digests after workflow, prompt, script, or skill edits.

## Temporary and scratch files

Write every throwaway artifact under the repository-root `tmp/` directory, which is gitignored. This includes ad-hoc wrapper scripts, command/verification logs, evidence output, scratch inputs, and intermediate JSON. Prefer a per-task subfolder such as `tmp/<task-name>/` and remove it when the task is done.

Do not create temporary files at the repository root or inside `scripts/`. The repository root must stay free of scratch `.sh`/`.txt` wrappers, and `scripts/` is reserved for committed, reusable tooling only. Never `git add` scratch artifacts; if a temporary file must live outside `tmp/`, add an explicit ignore rule instead of committing it.
