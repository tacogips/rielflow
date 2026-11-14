---
name: rielflow-chat-gateway-smoke
description: Use when running live credential-backed smoke tests for rielflow Discord Gateway, Telegram Gateway, Matrix, or multi-persona chat workflows through Computer Use. Applies to opening Discord/Telegram/Element or Matrix web UIs, sending natural chat messages or attachments, checking persona routing, default responders, handoffs, history-after-restart behavior, and collecting rielflow event/session/reply evidence without exposing credentials.
---

# Rielflow Chat Gateway Smoke

## Overview

Use this skill for end-to-end live chat checks where rielflow is running real
gateway listeners and Computer Use operates the user-visible chat clients. It is
intended for credential-backed smoke tests; missing credentials are a test setup
blocker, not a reason to skip the live checks when the user has asked for them.

Use the Computer Use plugin/skill for browser or desktop UI actions. Use normal
terminal commands for starting listeners, reading event receipts, checking
sessions, and inspecting logs.

## Safety And Credentials

- Do not print, paste, commit, or screenshot bot tokens, access tokens, OAuth
  secrets, Matrix access tokens, or Kinko secret values.
- Resolve credentials through the project/user secret mechanism already in use
  for this repo. If Kinko or the password manager is locked, ask the user to
  unlock it and continue after they confirm.
- Use the task-provided Discord channel, Telegram chat, and Matrix room URLs or
  the currently visible browser state. Do not add private chat URLs or room ids
  to repo files.
- Treat CAPTCHAs and account recovery as user-handled. Ask the user to complete
  them; do not solve them yourself.
- Before sending UI chat messages or uploading files through Computer Use,
  follow the active Computer Use confirmation policy. State the exact smoke-test
  messages/files and destination if confirmation is required.

## Setup

1. Check repo state with `git status --short --branch`.
2. Start or verify the intended rielflow event listener, normally:

   ```bash
   bun run packages/rielflow/src/bin.ts events serve \
     --workflow-definition-dir ./examples \
     --event-root ./examples/event-sources/.rielflow-events
   ```

   Use the project's existing env/secret wrapper when credentials are not
   already exported.
3. Keep the listener terminal session open while testing. Record the session id
   and stop it before handoff unless the user explicitly wants it left running.
4. Open the chat clients with Computer Use:
   - Discord: use the provided Discord channel URL in Brave or the active browser.
   - Telegram: use `https://web.telegram.org/` or the provided Telegram chat URL.
   - Matrix: use the provided Element/Matrix URL or the local Matrix sample URL.

## Smoke Matrix

Run the smallest set that covers the requested provider(s). For trio workflows,
use natural Japanese or English chat, not command-like test labels unless the
user asks for that.

### Default Responder

Send a normal message without a persona name. Expected: only the default
Codex-backed persona replies.

Example intent:

```text
このチャットの流れを短くまとめて
```

### Named Persona Routing

Send one message naming each non-default persona. Expected: only the named bot
replies; the default bot and other persona do not reply.

Example intents:

```text
Mika, 最近っぽい見せ方で一言アドバイスして
Rina, 技術的に見てどう思う?
```

### Handoff Conversation

Ask one persona to answer and ask another persona for their opinion. Expected:
the first persona replies, then the requested second persona replies; no third
persona replies.

Example intent:

```text
Yui, 意見を出して、それをMikaの意見も聞いて
```

### History After Restart

1. Establish context with a short multi-turn exchange.
2. Restart the rielflow event listener using the same event data root.
3. Ask a mid-conversation question such as `Mika, どう思う?`.
4. Expected: the selected persona uses bounded provider chat history rather
   than acting as if the conversation began at that message.

Collect event receipt/session evidence showing `event.input.history` or
`historySource` is populated.

### Attachments

- Discord/Telegram image: upload a small non-sensitive image. Expected: when
  local image paths are available, the Codex-backed image-capable persona
  describes visible content rather than saying it cannot inspect the image.
- Matrix: prefer a text attachment when the configured Matrix adapter supports
  text download. Expected: attachment text appears in normalized input/history
  and the reply uses it. If image bytes are not supported for Matrix in the
  current branch, record that as the expected limitation rather than a failure.

Do not upload private or sensitive files unless the user has explicitly approved
that exact file and destination.

## Evidence To Collect

For each provider, record:

- chat URL or provider label, without secret query strings
- message timestamps or visible message snippets
- which persona replied
- whether extra bots incorrectly replied
- rielflow event receipt id from `events list` or replay output
- workflow execution id and terminal status
- reply dispatch status from `events replies` when relevant
- attachment local path presence, never token-bearing provider URLs

Useful commands:

```bash
bun run packages/rielflow/src/bin.ts events list \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --output json

bun run packages/rielflow/src/bin.ts events replies <workflow-execution-id> \
  --workflow-definition-dir ./examples \
  --event-root ./examples/event-sources/.rielflow-events \
  --output json

bun run packages/rielflow/src/bin.ts session status <workflow-execution-id> \
  --output json
```

## Troubleshooting

- No Discord text event: check Message Content intent, channel/thread id,
  bot permissions, ignore-bot/self filters, and whether the listener is using
  the expected `discord-gateway` source.
- No Telegram event: check bot membership, configured chat id, polling offset,
  bot id, and whether the message was sent by the same bot account.
- No Matrix event: check homeserver URL, access token, room id, sync token path,
  and whether own messages are ignored.
- Wrong persona: inspect `rielflow/chat-persona-router` config aliases and the
  route node output `target_<id>` flags.
- Missing history after restart: verify the same event data root was reused and
  inspect `historySource.mode`, `historyKey`, and persisted history files.
- Attachment not understood: verify `event.input.attachments`,
  `event.input.imagePaths`, adapter attachment config, local file existence,
  and local-agent image forwarding.

## Handoff

Stop listener sessions you started unless told otherwise. Summarize results by
provider with `pass`, `fail`, or `not run`, include evidence ids, and call out
credential-, CAPTCHA-, or provider-permission-dependent gaps explicitly.
