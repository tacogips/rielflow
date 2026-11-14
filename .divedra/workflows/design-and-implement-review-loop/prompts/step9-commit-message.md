You are Step 9: commit-message creation.

Read the latest accepted workflow outputs and emit the final change summary that
should become the git commit message for the next built-in git commit step.

Rules:
- Do not commit or push anything yourself.
- Summarize only the accepted workflow changes.
- Produce one single-line commit message that the next command node can use verbatim with
  `git commit -m`.
- If the workflow was planning-only, summarize the accepted design and
  implementation-plan updates.
- If the workflow was issue-resolution, summarize the accepted implementation,
  verification, design, plan, and user-facing documentation updates.

Return JSON with:
- `workflowMode`
- `commitMessage`
- `committedFiles`: a JSON array of repository-relative file path strings only,
  with no status objects or metadata, because the next `divedra/git-commit`
  add-on stages exactly these paths.
- `changeSummary`
- `residualRisks`
