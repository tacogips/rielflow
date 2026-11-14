---
name: divedra-event-sources
description: Use when configuring, validating, emitting, serving, listing, replaying, or troubleshooting divedra external event sources. Applies to .divedra-events, events validate/emit/serve/list/replay, webhook/chat/cron bindings, event-to-workflow input mapping, supervised event execution, mock scenarios for events, and event receipt inspection.
metadata:
  short-description: Use divedra event sources
---

# Divedra Event Sources

Use this skill for event-driven workflow usage. For direct workflow execution use `divedra-workflow-run`.

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
