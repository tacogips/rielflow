# Expected Results

- The workflow validates as a step-addressed Telegram scheduled-reply bundle.
- `telegram-time-signal-cron` fires with the six-field cron schedule
  `*/30 * * * * *`.
- `prepare-time-signal` runs on every tick but sets `when.should_announce` only
  when the scheduled local time is exactly on a five-minute boundary.
- `send-time-signal` sends a Yui reply through
  `telegram-gateway-persona-replies` only for `should_announce` ticks.
- The cron source carries a static Telegram `replyTarget` so scheduled
  messages can use the same `rielflow/chat-reply-worker` and Telegram Gateway
  reply path as normal trio chat replies.
- Deterministic checks can emit
  `examples/event-sources/payloads/telegram-time-signal-cron.json` and verify
  a Telegram `sendMessage` request without live Telegram credentials.
