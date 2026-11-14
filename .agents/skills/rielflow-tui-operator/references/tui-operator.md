# Rielflow TUI Operator Reference

## Operator Model

The UI is for human-facing workflow overview and selected workflow/session status. Detailed machine diagnostics remain available through CLI JSON and GraphQL.

## Navigation Expectations

- Focus determines which pane responds to movement.
- Use arrows or `j` / `k` in list-like panes.
- Use `enter` or `ctrl-m` for the pane's primary action.
- Use `esc` to return from a detail pane to its parent pane.

## CLI Fallbacks

Workflow overview:

```bash
rielflow workflow list --workflow-root <root>
rielflow workflow status <workflow-name> --workflow-root <root>
```

Session detail:

```bash
rielflow session status <session-id> --output json
rielflow session progress <session-id>
```

GraphQL detail:

```bash
rielflow graphql 'query { workflows(input: {}) }'
```
