# Divedra Troubleshooting Reference

## Workflow Not Found

Check:

- `<workflow-root>/<workflow-name>/workflow.json`
- `--workflow-root`
- `DIVEDRA_WORKFLOW_ROOT`
- `workflow list`
- project/user scope shadowing

## Validation Failed

Run:

```bash
divedra workflow validate <workflow-name> --workflow-root <root>
```

Common causes:

- legacy top-level fields such as `edges`, `loops`, `workflowCalls`, or `subWorkflows`
- step ids and node registry ids confused
- manager step references an add-on-backed node
- agent node missing `executionBackend`, `model`, `promptTemplateFile`, or `variables`

## Run Failed

Inspect:

```bash
divedra session status <session-id> --output json
divedra session progress <session-id>
```

Then check:

- failed step id
- backend exit code
- timeout status
- output contract validation errors
- communication replay/retry state

## Stalled Or Paused

Check queue, current step, and user-action state in `session status`.

For supervised runs, inspect supervision state and nested superviser session id if present.

## Backend Failure

Reproduce with `--mock-scenario` to separate workflow graph issues from backend transport/model issues.

Check environment credentials expected by the backend or add-on.

## Missing Artifacts

Check:

- `--artifact-root`
- `--session-store`
- `DIVEDRA_ARTIFACT_ROOT`
- `DIVEDRA_SESSION_STORE`
- `DIVEDRA_ARTIFACT_DIR`

Use GraphQL detail queries for portable diagnostic snapshots, logs, and
communication state.
