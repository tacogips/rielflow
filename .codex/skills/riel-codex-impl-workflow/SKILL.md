---
name: riel-codex-impl-workflow
description: Use when implementation work in a rielflow project changes behavior, adds functionality, or fixes bugs and the user has not explicitly asked to avoid workflows. Routes the work through the packaged `codex-design-and-implement-review-loop` workflow, including design/plan alignment, implementation, review, user-facing documentation refresh, commit-message generation, and built-in git commit/push steps.
---

# Riel Codex Implementation Workflow

Use this skill as the default Codex path for implementation work in this repository.

## Apply This Skill When

- fixing a bug
- adding or changing runtime behavior
- implementing a feature from a design or implementation plan
- making a non-trivial refactor that changes implementation behavior
- reviewing or hardening dedicated `workflow self-improve` implementation
  behavior, including its CLI, server, library, GraphQL, report, backup, patch,
  and git-commit integration

## Do Not Apply This Skill When

- the user explicitly says not to use a workflow
- the task is documentation-only or planning-only with no implementation
- the task is specifically to debug or repair `rielflow` itself; use the current repository's fix workflow skill
- the task is to operate or troubleshoot live `workflow run --auto-improve`
  supervision rather than implement repository behavior; use
  an auto-improve operations skill

## Default Workflow

Use the packaged workflow bundle:

- Workflow id: `codex-design-and-implement-review-loop`
- Package id: `codex-design-and-implement-review-loop`

Preferred entry point from the repository root:

```bash
bun run packages/rielflow/src/bin.ts workflow package checkout codex-design-and-implement-review-loop
bun run packages/rielflow/src/bin.ts workflow run codex-design-and-implement-review-loop --output json
```

Equivalent direct command:

```bash
rielflow workflow package checkout codex-design-and-implement-review-loop
rielflow workflow run codex-design-and-implement-review-loop --output json
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
Rielflow product branding, and should not be renamed or generalized during
product-name updates.

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
11. user-facing documentation refresh (`README.md`, mandatory workflow skill
    docs, and any directly affected user-facing skills such as event-source
    runbooks)
12. staged secret scan with `gitleaks git --pre-commit --redact --staged --verbose`
13. commit-message generation
14. built-in git commit and git push add-on steps

Because the workflow ends with commit/push, do not use it when the user has
explicitly asked to avoid workflow-driven commits or wants manual local edits
only.

Rename-related issue-resolution runs should preserve `DIVEDRA_*` environment
variables as compatibility/runtime contracts unless a design explicitly
approves a migration. Product-owned package names, CLI examples, workflow
catalog paths, and human-facing documentation should use Rielflow/`rielflow`.

Telemetry-related issue-resolution runs should keep user-facing documentation
aligned with the runtime privacy contract. OpenTelemetry tracing is opt-in via
an OTLP endpoint or `RIELFLOW_OTEL_ENABLED=true`; inbox/outbox message payloads
must remain excluded unless `RIELFLOW_OTEL_EXPORT_MESSAGES=true` is explicitly
set for trusted fixtures. Jaeger smoke checks should use the repository-owned
`compose.jaeger.yaml` file and `docker compose -f compose.jaeger.yaml`.

Workflow package checkout issue-resolution runs should refresh user-facing
docs for package manifests, direct `--workflow-definition-dir` destinations,
package status/update commands, and vendor-scoped skill layouts. Keep `Issue
#35` references explicit when that issue is present in workflow input but
unrelated, and preserve `codex-agent` as an execution-backend identifier while
documenting Codex skill projection as `.codex/skills/<name>/SKILL.md`.

Workflow definition inheritance issue-resolution runs should refresh
`README.md`, `.codex/skills/rielflow-workflow/SKILL.md`, the design workflow
JSON reference, and this workflow skill when shipped behavior changes
`workflow.json` `extends`, `agentNodePatch`, `nodePatch`,
`stringReplacements`, or same-family workflow reference rewriting. Keep
`codex-agent` references explicit as execution-backend references, and document
the accepted verification commands.

## Reporting

After the workflow finishes, report:

- workflow mode
- changed files
- verification commands
- commit message
- commit hash
- pushed remote and branch

If the workflow fails because `rielflow` appears incorrect, switch to the
current repository's fix workflow.
