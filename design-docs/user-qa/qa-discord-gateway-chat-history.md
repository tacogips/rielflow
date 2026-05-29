# Discord Gateway Chat History Questions

This file tracks user decisions for first-class Discord Gateway chat ingestion
with bounded recent history.

## 1. Discord Dependency Policy

Should the first implementation add a Discord SDK dependency, or use a minimal
repository-owned Gateway WebSocket and REST client?

Recommended default: use the smallest maintained Discord library only after
supply-chain and Bun lockfile review; otherwise keep the first slice adapter
local and narrow.

## 2. History Persistence

Should Discord channel/thread history survive process restarts?

Decision for issue "Persist Discord gateway chat history across event server
restarts": yes. Bounded normalized Discord history must persist under the event
data root, reload on source start, and append accepted messages as they arrive.

Recommended default for implementation: use writable `eventDataRoot` storage
when available. If the adapter is started without an event data root or with
`readOnly: true`, keep bounded in-memory history plus optional REST
fetch-on-start/fetch-on-message and emit a diagnostic instead of writing outside
the event source data root.

## 3. Message Content Intent

Should the feature assume deployments have Discord's privileged message content
intent enabled?

Recommended default: document the requirement for full persona context and fail
or mark events degraded when message content is unavailable.

## 4. Persona Routing Contract

Should Yui, Mika, and Rina be selected by static workflow prompt rules, binding
metadata, or a supervisor profile route?

Recommended default: demonstrate static persona routing in
`examples/discord-persona-chat/` and keep supervisor profile routing as a later
composition option.

## 5. Bot Message History

Should prior bot messages appear in `event.input.history`?

Recommended default: exclude bot messages from history by default, with an
explicit source option to include them for rooms where assistant replies are
part of the useful context.

## 6. Credential Environment Names

Should the repository standardize Discord credential environment names in
examples as `RIEL_DISCORD_BOT_TOKEN` and `RIEL_DISCORD_APPLICATION_ID`, or use
source-specific names such as `RIEL_DISCORD_PERSONA_BOT_TOKEN`?

Recommended default: use generic names in the design and docs, while allowing
each source config to choose its own environment-variable names.

## 7. Default History Bounds

What default and maximum bounds should the first implementation enforce for
Discord history?

Recommended default: default to 20 messages, 32 KiB normalized history payload,
and 24 hours; enforce repository-defined maxima that prevent unbounded prompt
context and receipt growth.
