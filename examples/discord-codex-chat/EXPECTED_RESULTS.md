# Expected Results

- The workflow validates as a step-addressed worker-only bundle.
- The `answer-discord-message` step uses `codex-agent` with `gpt-5.4-mini`.
- The `send-discord-reply` step uses `rielflow/chat-reply-worker` and renders
  the Discord reply from `inbox.latest.output.payload.replyText`.
- When dispatched by the `chat-sdk-discord-to-workflow` event binding, replies
  target the same Discord conversation and thread from the normalized chat event.
