---
name: rielflow-event-sources
description: Use when configuring, validating, emitting, serving, listing, replaying, or troubleshooting rielflow external event sources. Applies to .rielflow-events, events validate/emit/serve/list/replay, webhook/chat/cron/sequential-list/discord-gateway bindings, event-to-workflow input mapping, supervised event execution, mock scenarios for events, ordered prompt dispatch, chat replies, and event receipt inspection.
metadata:
  short-description: Use rielflow event sources
---

# Rielflow Event Sources

Use this skill for event-driven workflow usage. For direct workflow execution use `rielflow-workflow-run`.

Supported local source kinds include webhook/chat, cron, Matrix, Chat SDK,
Discord Gateway, S3 metadata bridge, file-change directory watchers, and
sequential instruction lists. `discord-gateway` sources run under
`events serve`, listen to configured Discord channels or threads, ignore bot
and self messages by default, attach bounded recent channel or thread history
to `event.input.history`, and reply through chat destinations without requiring
an external Chat SDK Discord deployment. `file-change` sources run under
`events serve`, watch a configured directory, and emit `file.change.created`,
`file.change.modified`, or `file.change.deleted` for enabled `changeTypes`.
`sequential-list` sources run under `events serve`, emit one configured prompt
entry at a time, and wait for the previous workflow execution or supervised run
to reach a terminal state before dispatching the next entry.

## Common Flow

```bash
rielflow events validate --workflow-definition-dir <root> --event-root <event-root>
```

```bash
rielflow events emit <source-id> \
  --workflow-definition-dir <root> \
  --event-root <event-root> \
  --event-file payload.json \
  --mock-scenario <root>/<workflow-name>/mock-scenario.json
```

```bash
rielflow events serve --workflow-definition-dir <root> --event-root <event-root>
```

Read `references/events-runbook.md` for event roots, local fixtures, receipts, and replay.

## Rules

- Use `--event-root` explicitly unless the repository convention is obvious.
- Use `--mock-scenario` for deterministic local event dispatch.
- Do not combine local mock scenarios with remote `--endpoint`.
- Use `RIEL_EVENTS_READ_ONLY=true` or `--read-only` to validate and persist receipts without dispatch.
- Use `events list` and `events replay` for operator receipt workflows.
- For `discord-gateway`, keep bot token and application id as env-var references in source config, enable Discord Message Content intent when workflows need message text, and use bounded history settings instead of workflow inbox or agent transcript history.
- For `sequential-list`, inspect sequence metadata in normalized receipts; `events replay <receipt-id>` replays one persisted item and does not reset the sequence cursor.
