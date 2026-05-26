# Matrix Chat Reply Sample

This sample receives text messages from an Element/Matrix room through the
`matrix` event source and sends a reply back to Matrix with
`rielflow/chat-reply-worker`.

Run the live local Synapse verification:

```bash
./examples/matrix-chat-reply/local-synapse/run-local-matrix-sample.sh
```

The script starts Synapse with Docker Compose, creates two local users, creates
a room, starts `rielflow events serve`, sends an Alice message, and waits until
the rielflow bot reply appears in the room.

Stop the local homeserver when finished:

```bash
docker compose -f ./examples/matrix-chat-reply/local-synapse/compose.yaml down
```
