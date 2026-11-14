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

3. Resolved 2026-05-06: chat command input accepts structured commands and
   deterministic text command tokens. Event text is split by spaces/tabs; a
   known first token is the command and remaining tokens are arguments. If the
   first token is not a known command, natural-language text routes to a
   command-analysis LLM node that emits a structured command proposal. The
   supervisor itself remains deterministic, and core runtime still validates
   the proposal before executing privileged actions. For chat and web-chat
   sources, allow `startOnFirstInput` so the first ordinary message can start
   the supervised target workflow when configured.

4. Confirm multi-run correlation: one chat conversation/thread has one active
   supervised run by default; multiple parallel runs require an explicit target
   alias or supervised run id.

5. Confirm cancellation scope for the first milestone: persisted workflow
   execution cancellation is acceptable initially, with active backend process
   abort propagation tracked as a follow-up hardening requirement.

6. Confirm command-analysis acceptance rules: use a configurable confidence
   threshold, default to proposal/clarification when confidence is below the
   threshold, and allow automatic application only for a single unambiguous
   command whose action, target, and arguments pass deterministic validation.

7. Confirm runner-pool restart semantics: after a divedra process restart,
   persisted supervised-run records and session/artifact state remain
   inspectable, but commands that require a live in-process handle are refused
   unless the engine can safely rehydrate or resume the target execution.
