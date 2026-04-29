# Event Supervisor Control Questions

These decisions affect the public event/supervisor surface. The design document
uses provisional defaults so implementation planning can be concrete, but these
items should be confirmed before public APIs are frozen.

## Questions

1. Confirm the naming policy: new public event-control documentation and config
   fields use "supervisor", while existing runtime identifiers keep
   `superviser` until a deliberate naming migration is planned.

2. Confirm the default supervised restart limit: use `3` as the built-in
   default, while still allowing per-binding override.

3. Resolved 2026-04-29: chat command input accepts structured commands,
   deterministic text command tokens, and an explicit `llm-command` mode.
   Natural-language text must be routed through a supervisor-owned LLM
   command-resolution node that emits a structured command proposal. Core
   runtime still validates the proposal before executing privileged actions.
   For chat and web-chat sources, allow `startOnFirstInput` so the first
   ordinary message can start the supervised target workflow when configured.

4. Confirm multi-run correlation: one chat conversation/thread has one active
   supervised run by default; multiple parallel runs require an explicit target
   alias or supervised run id.

5. Confirm cancellation scope for the first milestone: persisted workflow
   execution cancellation is acceptable initially, with active backend process
   abort propagation tracked as a follow-up hardening requirement.
