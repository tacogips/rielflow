# Discord Persona Chat Expected Results

This workflow demonstrates the rielflow-owned `discord-gateway` event source.

Expected behavior:

- `discord-gateway-personas` validates with env-var credential references only.
- `discord-gateway-message-with-history.json` normalizes to `chat.message` with
  `event.input.history` containing bounded Discord channel or thread history.
- The current message is excluded from `event.input.history`.
- `discord-persona-chat` receives `workflowInput.history` through the event
  binding and can route replies as `yui`, `mika`, or `rina`.
- `rielflow/chat-reply-worker` sends replies through
  `discord-gateway-persona-replies` and preserves same-thread targeting.

Local validation:

```bash
rielflow events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
rielflow events emit discord-gateway-personas --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events --event-file ./examples/event-sources/payloads/discord-gateway-message-with-history.json --read-only --output json
rielflow workflow validate discord-persona-chat --workflow-definition-dir ./examples
```
