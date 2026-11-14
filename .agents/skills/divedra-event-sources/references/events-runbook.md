# Divedra Event Sources Runbook

## Commands

Validate:

```bash
divedra events validate --workflow-root ./examples --event-root ./examples/event-sources/.divedra-events
```

Emit fixture:

```bash
divedra events emit <source-id> \
  --workflow-root ./examples \
  --event-root ./examples/event-sources/.divedra-events \
  --event-file ./examples/event-sources/payloads/chat-message.json \
  --mock-scenario ./examples/<workflow-name>/mock-scenario.json
```

Serve listeners:

```bash
divedra events serve --workflow-root ./examples --event-root ./examples/event-sources/.divedra-events
```

List receipts:

```bash
divedra events list --source <source-id> --limit 20
```

Replay:

```bash
divedra events replay <receipt-id> --reason "operator retry"
```

## Event Root

Event source configuration is loaded from `.divedra-events` next to the workflow root unless `--event-root` is provided.

Use event fixtures to verify:

- source matching
- input mapping
- dedupe behavior
- supervised workflow dispatch
- reply adapter behavior

## Modes

Local command dispatch can start workflow execution directly.

With `--endpoint`, event dispatch goes through GraphQL and can run as a lightweight listener process.

Read-only mode validates and records incoming events without dispatching workflow execution.
