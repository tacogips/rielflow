# Telegram Gateway Agent Trio

This document records the design for native Telegram chat ingestion and the
three-person Telegram persona workflow.

## Overview

Telegram support is a native rielflow event source named `telegram-gateway`.
It is intentionally separate from the generic `chat-sdk` provider path. The
transport uses the Telegram Bot API directly:

- `getUpdates` long polling receives message updates.
- `sendMessage` delivers workflow replies back to the same chat.
- `getFile` can resolve photo `file_id` values into provider file paths for
  deterministic attachment descriptors.

The checked-in example `telegram-agent-trio-chat` mirrors the Discord persona
workflow:

- Yui Codex: default responder, refined secretary, `codex-agent`.
- Mika Trend: gyaru entertainment and trends specialist, `claude-code-agent`.
- Rina Cursor: intellectual otaku technical analyst, `cursor-cli-agent`.

## Technical Details

`telegram-gateway` normalizes Telegram updates into the shared
`chat.message` envelope contract. Workflows receive:

- `event.input.text` from message text or photo caption.
- `event.input.replyTarget` for `rielflow/chat-reply-worker`.
- `event.input.history` and `event.input.historySource` when bounded history is
  configured.
- `event.input.attachments[]` containing metadata for the largest photo in a
  Telegram photo set.

History persistence uses the existing compact event-source history store under
the event data root. A restarted `events serve` process can reload accepted
Telegram chat history from the same root without storing raw Bot API payloads or
bot tokens.

Photo handling is metadata-first. The adapter records dimensions, file ids,
file size, caption, and optional `getFile` path. It does not download image
bytes, perform OCR, or infer image content; persona prompts are instructed to
use only deterministic descriptors unless another workflow stage provides image
analysis.

## Usage Examples

Validate the example workflow and event configuration:

```bash
bun run packages/rielflow/src/bin.ts workflow validate telegram-agent-trio-chat --workflow-definition-dir ./examples
bun run packages/rielflow/src/bin.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
```

Serve with Telegram bot credentials:

```bash
export RIEL_TELEGRAM_BOT_TOKEN=<telegram-bot-token>
export RIEL_TELEGRAM_BOT_ID=<telegram-bot-id>
bun run packages/rielflow/src/bin.ts events serve --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
```

## References

See `design-docs/references/README.md` for external references.
