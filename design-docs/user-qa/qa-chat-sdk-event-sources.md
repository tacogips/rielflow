# Chat SDK Event Sources User Q&A

This file tracks decisions that may need user confirmation before expanding the
first Chat SDK event-source implementation beyond the secure generic boundary.

## Pending Decisions

1. Direct package integration:
   Should divedra add direct runtime dependencies on selected
   `@chat-adapter/*` packages after the generic boundary works, or should Chat
   SDK deployments remain external to divedra for this feature?

2. Provider rollout depth:
   Should WhatsApp and Messenger be exposed as first-class examples, or only as
   allowed provider ids covered by validation until live provider credentials
   and fixtures are available?

3. Web provider scope:
   Should the `web` provider be implemented only as an inbound browser chat
   event source in the first pass, or should it also expose a first-class
   outbound destination for browser-side progress and final-output streaming?

4. Rich interactions:
   Should provider-specific buttons, cards, postbacks, reactions, and slash
   commands normalize to `chat.action` in the first pass, or should the first
   pass accept text messages only and persist unsupported interactions as
   skipped receipts?
