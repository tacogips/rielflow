# Expected Results

- The workflow validates as a step-addressed worker-only bundle.
- The `answer-discord-message` step uses `codex-agent` with `gpt-5.4-mini`.
- The `send-discord-reply` step uses `rielflow/chat-reply-worker` and renders
  the Discord reply from `inbox.latest.output.payload.replyText`.
- Direct local mock runs without an event reply target complete as a dry run
  instead of attempting to send to Discord.
- When dispatched by the `chat-sdk-discord-to-workflow` event binding, replies
  target the same Discord conversation and thread from the normalized chat event.
