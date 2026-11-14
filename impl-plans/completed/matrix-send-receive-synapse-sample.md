# Matrix Send Receive Synapse Sample Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/design-event-listener-workflow-trigger.md#element--matrix`
**Created**: 2026-05-13
**Completed**: 2026-05-13

## Summary

Added a checked-in Matrix chat reply sample workflow and a Docker Compose local
Synapse verification harness. The sample receives Matrix `m.room.message`
events through the shared Matrix event adapter and sends the workflow reply
back through the shared chat reply dispatcher.

## Completed Tasks

- [x] Added `examples/matrix-chat-reply/` as a Matrix-specific
      `divedra/chat-reply-worker` workflow.
- [x] Updated the Matrix event-source binding to target `matrix-chat-reply`.
- [x] Added a Docker Compose Synapse harness under
      `examples/matrix-chat-reply/local-synapse/`.
- [x] Kept generated Synapse data and dynamic event-root files under `tmp/`.
- [x] Added mocked Matrix sample regression coverage in
      `src/events/matrix-chat-reply-example.test.ts`.
- [x] Verified live receive/send against local Synapse on
      `http://127.0.0.1:18008`.

## Verification

```bash
bash -n examples/matrix-chat-reply/local-synapse/run-local-matrix-sample.sh
bun run src/main.ts workflow validate matrix-chat-reply --workflow-definition-dir ./examples
bun run src/main.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.divedra-events
bun test src/events/adapters/matrix.test.ts src/events/matrix-chat-reply-example.test.ts
./examples/matrix-chat-reply/local-synapse/run-local-matrix-sample.sh
bun run typecheck
bun run lint:biome
```

The full `bun run test` sweep was also run after stopping the stale workflow
worker; rerun is expected to use the settled tree.
