# Matrix Event Source Decisions

This file tracks follow-up user decisions for Element/Matrix event source
support. The first implementation slice can proceed with conservative defaults
from `design-docs/specs/design-event-listener-workflow-trigger.md`.

## Decisions Needed

### Receive Transport

Default for the first slice: Matrix Client-Server `/sync` long polling.

Open decision: should a later release also support Matrix Application Service
transactions for server-to-app delivery?

Options:

- Keep `/sync` only for bot-style Element/Matrix usage.
- Add Application Service transaction support when deployment needs homeserver
  registration and namespace ownership.

### Room Content Scope

Default for the first slice: plain `m.room.message` text-like messages only.

Open decision: which rich Matrix events should be normalized later?

Options:

- Add edited-message replacement handling.
- Add attachments as data-root file refs.
- Add reactions and redactions as separate event types.
- Add encrypted-room support after key-management requirements are defined.

### Reply Threading

Default for the first slice: reply to the inbound event when an event id is
available, and include Matrix thread relation metadata when the inbound event
has a thread root.

Open decision: should divedra force all workflow replies into Matrix threads
even when the incoming message was not threaded?

Options:

- Preserve inbound context only.
- Always create or continue a Matrix thread per workflow execution.

### Token And Identity Model

Default for the first slice: one bot access token and one bot Matrix user id per
source config.

Open decision: should divedra support appservice tokens, per-room credentials,
or per-workflow identities?

Options:

- Keep one bot identity per source.
- Add appservice identity support.
- Add destination-specific credentials for outbound-only supervisor rooms.

### Sync State Retention

Default for the first slice: persist an optional Matrix `/sync` `next_batch`
token under the local event runtime state or artifact root for the source.

Open decision: should production listener deployments share sync state across
multiple divedra listener processes?

Options:

- Keep sync state process-local or artifact-root-local and require one active
  Matrix listener per source.
- Add a shared sync-state backend with leader election before supporting
  multiple active listener processes for one source.
