# Expected Results

The `matrix-chat-reply` workflow should emit one public Matrix chat reply
through the event reply dispatcher.

For an incoming Matrix text message from `@alice:localhost` with body
`hello from matrix`, the reply text should be:

```text
Matrix sample received from @alice:localhost: hello from matrix
```

The reply should target the same Matrix room and use same-thread reply metadata
when the incoming event provides a reply or thread target.
