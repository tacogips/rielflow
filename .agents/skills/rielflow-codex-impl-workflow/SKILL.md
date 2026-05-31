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

During documentation refresh, keep issue-resolution behavior visible at the
same surface where users or future agents would discover it. For example,
event-source or chat-reply built-in changes should refresh `README.md`,
`examples/*` README coverage, and `.agents/skills/rielflow-event-sources/`
guidance before commit-message generation.

Chat gateway trio issue-resolution runs should keep the provider boundary
visible in user-facing docs. Telegram Bot API polling, history, photo
descriptors, and replies belong in rielflow event adapters and built-in
add-ons, not workflow prompt nodes or `codex-agent` persona behavior. Discord,
Telegram, and Matrix examples should remain authorable through normalized
`chat.message` input, `rielflow/chat-persona-router` when persona selection is
needed, persona workers such as `codex-agent`, and `rielflow/chat-reply-worker`.
Documentation refresh should cover `README.md`, `examples/README.md`,
`examples/event-sources/README.md`, and this skill when those surfaces change,
and should keep verification commands explicit:
`workflow validate discord-agent-trio-chat`, `workflow validate
telegram-agent-trio-chat`, `workflow validate matrix-chat-reply`, `events
validate`, focused adapter/add-on tests, `bun run typecheck`, `bun run
lint:biome`, `bun run build`, and any deterministic redaction audit script.

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

Event-source or example-workflow issue-resolution runs should keep the shipped
behavior discoverable from user-facing docs. Refresh the root `README.md`, the
directly affected example README such as `examples/README.md` or
`examples/event-sources/README.md`, and workflow-local `EXPECTED_RESULTS.md`
when deterministic fixtures, event payloads, or validation commands change.

Temporary workflow issue-resolution runs should keep local one-off execution
behavior explicit in user-facing docs. Refresh `README.md`,
`.agents/skills/rielflow-workflow-run/SKILL.md`, and this skill when changes
affect `workflow run --workflow-json`, `workflow run --workflow-json-file`,
embedded prompt/content validation, `temporary-workflow-payload/` artifact
logging, or resume/rerun/continue reload from persisted temporary payloads.
Temporary workflow behavior is provider-neutral: `codex-agent` may appear in a
node payload, but command parsing, validation, payload persistence, and session
reload must not special-case the Codex backend. Verification should keep these
commands explicit: `bun run packages/rielflow/src/bin.ts workflow run --help`,
focused temporary workflow CLI/API/session tests, inline JSON and JSON-file
smoke runs, a normal scoped/direct run proving no `temporary-workflow-payload/`
directory is created, `bun run typecheck`, and `bun run biome check .`.

Built-in add-on package boundary issue-resolution runs should keep
source-tree-versus-dist behavior explicit in design, implementation plans,
tests, and user-facing docs. When `rielflow` executes from
`packages/rielflow/src`, validation must resolve built-in `rielflow/*` add-ons
from `packages/rielflow-addons/src/index.ts` before stale
`packages/rielflow-addons/dist/index.js`; packaged or dist execution keeps built
output first with source fallback for missing local development artifacts.
Verification should include
`bun test packages/rielflow/src/workflow/addon-package-boundary.test.ts`,
`bun test packages/rielflow/src/workflow/validate.test.ts`, and
`bun run typecheck`.

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
