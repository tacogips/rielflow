# Expected Results

- The workflow validates as a simple step-addressed Telegram trio chat bundle.
- `route-message` uses `rielflow/chat-persona-router` to select Yui, Mika, or
  Rina from a normalized Telegram message.
- `yui-codex-sdk` uses `rielflow/codex-sdk-worker`, which resolves to
  `official/openai-sdk` and requires `OPENAI_API_KEY` for live execution.
- `mika-claude-sdk` uses `rielflow/claude-sdk-worker`, which resolves to
  `official/anthropic-sdk` and requires `ANTHROPIC_API_KEY` for live execution.
- `rina-cursor-sdk` uses `rielflow/cursor-sdk-worker`, which resolves to
  `official/cursor-sdk`, runs model `gpt-5.5`, and requires `CURSOR_API_KEY`
  for live execution.
- Each SDK worker returns visible reply text in `payload.text`.
- `rielflow/chat-reply-worker` sends the selected persona reply to the same
  Telegram conversation and thread, dry-running when a local run has no chat
  target.
- The bundled mock scenario routes a Telegram-style message to Rina and
  completes without requiring live API keys.
