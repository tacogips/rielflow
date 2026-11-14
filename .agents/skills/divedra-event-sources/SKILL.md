---
name: divedra-event-sources
description: Use when configuring, validating, emitting, serving, listing, replaying, or troubleshooting divedra external event sources. Applies to .divedra-events, events validate/emit/serve/list/replay, webhook/chat/cron/sequential-list bindings, event-to-workflow input mapping, supervised event execution, mock scenarios for events, ordered prompt dispatch, and event receipt inspection.
metadata:
  short-description: Use divedra event sources
---

# Divedra Event Sources

Use this skill for event-driven workflow usage. For direct workflow execution use `divedra-workflow-run`.

Supported local source kinds include webhook/chat, cron, Matrix, Chat SDK,
S3 metadata bridge, file-change directory watchers, and sequential instruction
lists. `file-change` sources run under `events serve`, watch a configured
directory, and emit `file.change.created`, `file.change.modified`, or
`file.change.deleted` for enabled `changeTypes`. `sequential-list` sources run
under `events serve`, emit one configured prompt entry at a time, and wait for
the previous workflow execution or supervised run to reach a terminal state
before dispatching the next entry.

## Common Flow

```bash
divedra events validate --workflow-root <root> --event-root <event-root>
```

```bash
divedra events emit <source-id> \
  --workflow-root <root> \
  --event-root <event-root> \
  --event-file payload.json \
  --mock-scenario <root>/<workflow-name>/mock-scenario.json
```

```bash
divedra events serve --workflow-root <root> --event-root <event-root>
```

Read `references/events-runbook.md` for event roots, local fixtures, receipts, and replay.

## Rules

- Use `--event-root` explicitly unless the repository convention is obvious.
- Use `--mock-scenario` for deterministic local event dispatch.
- Do not combine local mock scenarios with remote `--endpoint`.
- Use `DIVEDRA_EVENTS_READ_ONLY=true` or `--read-only` to validate and persist receipts without dispatch.
- Use `events list` and `events replay` for operator receipt workflows.
- For `sequential-list`, inspect sequence metadata in normalized receipts; `events replay <receipt-id>` replays one persisted item and does not reset the sequence cursor.
