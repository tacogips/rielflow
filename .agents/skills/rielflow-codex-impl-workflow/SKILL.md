---
name: rielflow-codex-impl-workflow
description: Use when Codex-agent implementation work in this repository changes behavior, adds functionality, or fixes bugs and the user has not explicitly asked to avoid workflows. Routes the work through the user-scope Codex development workflow `~/.rielflow/workflows/codex-design-and-implement-review-loop` (executionBackend codex-agent), including design/plan alignment, implementation, review, user-facing documentation refresh, commit-message generation, and built-in git commit/push steps.
---

# Rielflow Codex Implementation Workflow

Use this skill as the Codex-agent path for implementation work in this
repository.

## Apply This Skill When

- fixing a bug with Codex-agent implementation work
- adding or changing runtime behavior through the Codex-agent workflow
- implementing a feature from a design or implementation plan
- making a non-trivial refactor that changes implementation behavior

## Do Not Apply This Skill When

- the user explicitly says not to use a workflow
- the task is documentation-only or planning-only with no implementation
- the task is specifically to debug or repair `rielflow` itself; use
  `rielflow-fix`
- the task is to operate or troubleshoot live `workflow run --auto-improve`
  supervision rather than implement repository behavior; use
  `rielflow-auto-improve`

## Default Codex Workflow

Use the user-scope Codex-agent workflow bundle:

- Workflow id: `codex-design-and-implement-review-loop`
- Catalog path: `~/.rielflow/workflows/codex-design-and-implement-review-loop`

Run from the repository root:

```bash
rielflow workflow run codex-design-and-implement-review-loop --scope user --output json
```

## Runtime Inputs

For normal implementation work, run the workflow in issue-resolution mode.

Pass structured workflow input through `--variables` when the task needs
explicit issue/reference context. Typical fields:

- `workflowInput.issueUrl`
- `workflowInput.issueNumber`
- `workflowInput.issueRepository`
- `workflowInput.issueTitle`
- `workflowInput.issueBody`
- `workflowInput.targetFeatureArea`
- `workflowInput.requestedBehavior`
- `workflowInput.codexAgentReferences`
- `workflowInput.referenceRepositoryRoot`
- `workflowInput.referenceRepositoryUrl`

Keep `workflowInput.codexAgentReferences` explicit when the issue depends on
Codex-specific behavior. `codex-agent` is an execution-backend identifier, not
Rielflow product branding, and should not be renamed or generalized.

Planning-only mode is available via:

- `workflowInput.executionMode: "design-plan-only"`

## Expected Behavior

The workflow is responsible for:

1. issue or task intake
2. design-document updates
3. design self-review
4. design review
5. implementation-plan creation or revision
6. implementation-plan self-review
7. implementation-plan review
8. implementation work
9. implementation self-review
10. implementation review
11. user-facing documentation refresh (`README.md`, this workflow skill, and any
    directly affected user-facing skills)
12. staged secret scan with `gitleaks git --pre-commit --redact --staged --verbose`
13. commit-message generation
14. built-in git commit and git push add-on steps

Because the workflow ends with commit/push, do not use it when the user has
explicitly asked to avoid workflow-driven commits or wants manual local edits
only.

Local-agent adapter issue-resolution runs should keep prompt-splitting behavior
explicit in design, implementation plans, tests, and user-facing docs. For
`codex-agent` and `cursor-cli-agent`, starts and reused-session resumes pass the
per-turn user prompt as the backend prompt and forward `systemPromptText`
through the backend `systemPrompt` option. Do not combine the stable system
prompt into resumed user prompt text when the backend runner already appends
`systemPrompt`; stall-watch resume nudges keep the watcher-supplied nudge prompt
while still forwarding the stable system prompt option. Verification should
include the focused Codex and Cursor adapter tests and `bun run typecheck`.

## Reporting

After the workflow finishes, report:

- workflow mode
- changed files
- verification commands
- commit message
- commit hash
- pushed remote and branch

If the workflow fails because `rielflow` appears incorrect, switch to the
`rielflow-fix` skill.
