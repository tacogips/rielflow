# Telegram Gateway Agent Trio and Chat Workflow Simplification

This document records the design for native Telegram chat ingestion, the
three-person chat persona workflow, and the cross-provider authoring boundary
shared by the Discord, Telegram, and Matrix chat examples.

## Overview

Telegram support is a native rielflow event source named `telegram-gateway`.
It is intentionally separate from the generic `chat-sdk` provider path. The
transport uses the Telegram Bot API directly:

- `getUpdates` long polling receives message updates.
- `sendMessage` delivers workflow replies back to the same chat.
- `getFile` can resolve photo `file_id` values into provider file paths for
  deterministic attachment descriptors.

The checked-in trio examples for Discord and Telegram establish the target
workflow shape. Matrix must expose the same three-persona shape through
`matrix-agent-trio-chat` while continuing to keep `matrix-chat-reply` as the
minimal reply-only smoke example.

- Yui Codex: default responder, refined secretary, `codex-agent`.
- Mika Trend: gyaru entertainment and trends specialist, `claude-code-agent`.
- Rina Cursor: intellectual otaku technical analyst, `cursor-cli-agent`.

Initial persona selection is owned by the provider-neutral
`rielflow/chat-persona-router` built-in add-on. Transport-specific ingestion,
history, attachments, and reply targets stay in event adapters; the workflow
only configures persona ids, display names, and aliases.

Design status for the workflow `codex-design-and-implement-review-loop`:

- `workflowMode`: `issue-resolution`
- issue reference: `Add Matrix trio chat parity and stubbed unit tests`,
  supplied through `runtimeVariables.workflowInput`; no GitHub issue URL or
  issue number was provided
- target feature area: Telegram/Discord/Matrix chat gateway trio workflows and
  built-in chat persona routing
- primary review question: whether provider complexity has moved into rielflow
  adapters and built-in add-ons while workflow authors keep a small,
  provider-neutral JSON surface

## Goals

- Keep Telegram Bot API polling, offset persistence, history bounds, photo
  metadata/file resolution, and reply dispatch inside the `telegram-gateway`
  event adapter and validation layer.
- Keep Discord Gateway and Matrix receive/send behavior inside their own event
  adapters while sharing provider-neutral event, destination, and reply
  contracts.
- Let Discord, Telegram, and Matrix trio workflows use the same graph shape:
  `rielflow/chat-persona-router`, three persona workers, and
  `rielflow/chat-reply-worker`.
- Keep `examples/matrix-chat-reply` as a minimal reply workflow that
  demonstrates the same chat reply worker and destination boundary while adding
  `examples/matrix-agent-trio-chat` for full trio parity.
- Let Matrix use optional `replyBots` access-token env mapping so
  `replyAsTemplate` can select Yui, Mika, or Rina bot accounts like the
  Discord and Telegram gateway adapters.
- Make validation catch provider-specific configuration errors at the event
  source or add-on descriptor boundary rather than inside persona prompts.

## Non-Goals

- Adding Telegram-specific fields to `workflow.json` or persona node payloads.
- Replacing the existing Chat SDK provider path for providers that still use it.
- Turning workflow prompts into transport parsers, history stores, attachment
  downloaders, or reply target mappers.
- Implementing OCR, image understanding, encrypted Matrix media decryption, or
  unbounded chat memory in this slice.
- Making Codex-agent, Cursor-agent, or Claude-agent adapters responsible for
  provider receive/send behavior.

## Technical Details

`telegram-gateway` normalizes Telegram updates into the shared
`chat.message` envelope contract. Workflows receive:

- `event.input.text` from message text or photo caption.
- `event.input.replyTarget` for `rielflow/chat-reply-worker`.
- `event.input.history` and `event.input.historySource` when bounded history is
  configured.
- `event.input.attachments[]` containing metadata for the largest photo in a
  Telegram photo set.

History persistence uses the existing compact event-source history store under
the event data root. A restarted `events serve` process can reload accepted
Telegram chat history from the same root without storing raw Bot API payloads or
bot tokens.

Photo handling is metadata-first. The adapter records dimensions, file ids,
file size, caption, and optional `getFile` path. It does not download image
bytes, perform OCR, or infer image content; persona prompts are instructed to
use only deterministic descriptors unless another workflow stage provides image
analysis.

When photo download is explicitly enabled by source configuration, downloaded
files remain event-adapter artifacts referenced through normalized attachment
descriptors. Agent adapters may consume local paths only through the normal
attachment forwarding contract; workflow authors do not write Telegram Bot API
file URLs or token-bearing paths into prompts.

## Cross-provider Authoring Boundary

The Discord, Telegram, and Matrix trio examples should remain intentionally
parallel:

- inbound providers emit `chat.message`
- binding input maps provider-neutral text, history, attachments, and persona
  candidates into workflow input
- `rielflow/chat-persona-router` selects one initial persona from configured
  ids, names, and aliases
- persona nodes produce JSON with `payload.replyText`
- `rielflow/chat-reply-worker` sends the reply through the event destination
  publisher and the source-specific adapter

The Matrix trio example must copy the provider-neutral authoring pattern from
the Discord and Telegram trio examples without copying provider parsing or
Matrix Client-Server API details into workflow prompts. The existing
`matrix-chat-reply` sample remains valuable as a smaller proof of the same
destination/reply contract.

Workflow JSON should describe business routing and persona composition only.
The following provider details are adapter-owned and must not appear in
workflow prompts or node JSON except as normalized `event` or `workflowInput`
fields:

- Telegram update ids, chat ids, Bot API method names, file ids, offset files,
  and bot token environment variables
- Discord Gateway opcodes, intents, channel/thread REST behavior, snowflakes,
  and bot token environment variables
- Matrix homeserver URLs, access tokens, sync tokens, room event relation
  payloads, and transaction ids

## Built-in Add-on Responsibilities

`rielflow/chat-persona-router` owns reusable initial persona selection. It
accepts provider-neutral text plus configured persona ids, display names, and
aliases. It must not inspect Telegram, Discord, or Matrix raw provider payloads.

`rielflow/chat-reply-worker` owns reusable reply construction from inbox output
and runtime event context. It creates a provider-neutral dispatch request,
including reply text, visibility, thread policy, optional `replyAsTemplate`,
destination ids, and idempotency metadata. Provider adapters convert that
request into Telegram `sendMessage`, Discord REST send, or Matrix Client-Server
API calls.

Add-on descriptors must validate authored config before execution. Workflow
validation should report bad persona definitions, invalid reply templates, or
unsupported add-on env bindings without requiring live provider credentials.

## Validation and Rollout Rules

Validation should fail when:

- a `telegram-gateway` source uses literal credentials instead of environment
  variable names
- Telegram polling, history, attachment, reply-bot, or provider fields exceed
  supported bounds or use unsupported values
- a chat destination references a provider source that cannot dispatch replies
- an add-on node omits an explicit compatible version or supplies provider
  config to an add-on schema that does not accept it

Rollout constraints:

- Keep `examples/discord-agent-trio-chat`,
  `examples/telegram-agent-trio-chat`, and
  `examples/matrix-agent-trio-chat` structurally parallel so authors can copy
  the business workflow pattern between providers.
- Keep `examples/matrix-chat-reply` smaller by design; Matrix parity now
  requires a separate trio workflow and event binding rather than expanding the
  minimal reply-only workflow.
- Keep live provider smoke tests optional because credentials may be absent, but
  keep deterministic adapter, validation, and workflow validation tests required.
- Redact bot tokens, access tokens, authorization headers, raw provider payloads,
  and token-bearing file URLs from receipts, dispatch records, logs, and
  examples.
- Treat trio workflows that duplicate provider parsing or reply dispatch in
  prompts as review failures; deterministic validation should cover the
  adapter, destination, add-on, and example-structure surfaces.

## Codex Reference Mapping

The active workflow is `codex-design-and-implement-review-loop` in
`issue-resolution` mode, using `codex-agent` workers. Codex-agent is a worker
backend and adapter-behavior reference only; it does not define Telegram,
Discord, or Matrix provider behavior.

Relevant repository-local references:

- `packages/rielflow-adapters/src/codex.ts`: attachment/image forwarding and
  passthrough argument behavior for Codex-backed persona nodes.
- `packages/rielflow/src/workflow/adapters/codex.test.ts`: regression coverage
  for Codex adapter behavior that can receive normalized attachment local paths.
- `examples/telegram-agent-trio-chat/nodes/node-yui-codex.json`: Telegram trio
  Codex persona node, which should stay provider-neutral.
- `examples/discord-agent-trio-chat/nodes/node-yui-codex.json`: Discord trio
  Codex persona node, which should stay provider-neutral.
- `examples/matrix-agent-trio-chat/nodes/node-yui-codex.json`: Matrix trio
  Codex persona node, which should stay provider-neutral.
- `packages/rielflow/src/events/adapters/telegram-gateway.ts`: Telegram
  provider boundary for receive, history, attachments, polling, and offset
  handling.
- `packages/rielflow/src/events/adapters/telegram-gateway-reply.ts`: Telegram
  provider boundary for reply dispatch.
- `packages/rielflow-addons/src/native-node-executor/chat-and-gateway-addons.ts`:
  native add-on execution boundary for chat persona routing and chat replies.

## Review Decisions and Issue Mapping

- The Matrix trio parity issue remains a single issue-resolution path because
  workflow shape, event binding, reply destinations, docs, and deterministic
  tests all depend on the same provider-neutral chat workflow contract.
- Telegram support is a native rielflow adapter capability, not a workflow
  prompt pattern and not a dependency on an external chat gateway.
- Discord, Telegram, and Matrix trio workflows should be easy to author by
  editing persona ids, aliases, prompts, and reply templates; provider setup
  belongs in `.rielflow-events` source, destination, and binding config.
- Matrix trio parity should reuse the existing `matrix` event source and Matrix
  reply destination adapter. Add a trio-specific binding and destination when
  needed to avoid changing the semantics of the existing `matrix-chat-reply`
  fixture.
- Low-risk review improvements should prefer docs, examples, validation
  diagnostics, and narrow tests over changes to live provider semantics.

Concrete low-risk review targets for the follow-up implementation/review steps:

- Confirm `examples/discord-agent-trio-chat/workflow.json`,
  `examples/telegram-agent-trio-chat/workflow.json`, and
  `examples/matrix-agent-trio-chat/workflow.json` keep the same authored graph
  shape: router add-on, three persona workers, and one reply-worker add-on per
  persona.
- Confirm provider credentials, raw provider ids, Telegram Bot API method
  details, Discord Gateway details, and Matrix Client-Server details appear only
  in event source, destination, adapter, or validation files, not in persona
  prompts.
- Confirm Telegram and Discord attachment paths enter agent adapters through
  normalized attachment descriptors and Codex/local-agent attachment forwarding,
  not token-bearing provider URLs.
- Prefer missing validation diagnostics, example docs, or focused regression
  tests as fixes before changing live polling, reply dispatch, or agent adapter
  behavior.

## Cursor CLI Behavior Mapping

Rina Cursor is a persona worker in the trio examples, but Cursor-specific
session, transcript, or CLI behavior is isolated behind the Cursor agent
adapter. The event layer must not special-case Cursor, and Cursor-agent
behavior must not alter Telegram/Discord/Matrix event normalization, reply
target mapping, destination publishing, or chat add-on validation.

## Intentional Divergences

- Diverges from Chat SDK Telegram by using a native `telegram-gateway` event
  source for Bot API long polling, offset persistence, photo descriptors, and
  replies.
- Diverges from workflow inbox history because provider chat history is external
  event context supplied through `event.input.history` or mapped workflow input.
- Diverges from agent transcript continuation because persona context must come
  from bounded provider conversation history rather than a backend-specific
  session transcript.
- Diverges from Codex-agent references by keeping provider-specific receive/send
  behavior in rielflow adapters and built-in add-ons rather than in agent
  prompts or sessions.
- Diverges from the earlier Matrix sample-only design by requiring a dedicated
  Matrix trio workflow and event binding while retaining `matrix-chat-reply` as
  a focused reply-worker fixture.

## Usage Examples

Validate the example workflow and event configuration:

```bash
bun run packages/rielflow/src/bin.ts workflow validate telegram-agent-trio-chat --workflow-definition-dir ./examples
bun run packages/rielflow/src/bin.ts workflow validate matrix-agent-trio-chat --workflow-definition-dir ./examples
bun run packages/rielflow/src/bin.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
```

Serve with Telegram bot credentials:

```bash
export RIEL_TELEGRAM_BOT_TOKEN=<telegram-bot-token>
export RIEL_TELEGRAM_BOT_ID=<telegram-bot-id>
bun run packages/rielflow/src/bin.ts events serve --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
```

## Verification Commands

Review and implementation steps should run or explicitly report inability to
run these commands:

```bash
bun test packages/rielflow/src/workflow/native-node-executor-addons-commands.test.ts packages/rielflow/src/events/adapters/discord-gateway.test.ts packages/rielflow/src/events/adapters/telegram-gateway.test.ts packages/rielflow/src/events/adapters/matrix.test.ts packages/rielflow/src/workflow/adapters/codex.test.ts
bun run packages/rielflow/src/bin.ts workflow validate discord-agent-trio-chat --workflow-definition-dir ./examples
bun run packages/rielflow/src/bin.ts workflow validate telegram-agent-trio-chat --workflow-definition-dir ./examples
bun run packages/rielflow/src/bin.ts workflow validate matrix-agent-trio-chat --workflow-definition-dir ./examples
bun run packages/rielflow/src/bin.ts workflow validate matrix-chat-reply --workflow-definition-dir ./examples
bun run packages/rielflow/src/bin.ts events validate --workflow-definition-dir ./examples --event-root ./examples/event-sources/.rielflow-events
bun test packages/rielflow/src/events/matrix-chat-reply-example.test.ts packages/rielflow/src/events/adapters/matrix.test.ts packages/rielflow/src/events/reply-dispatcher.test.ts
bun run typecheck
bun run lint:biome
bun run build
git diff --check
bun run scripts/audit-chat-redaction-literals.ts
```

## Open Questions

No unresolved user decisions are required for this design update. Live Telegram,
Discord, or Matrix smoke testing remains environment-dependent and should be
reported as verification availability rather than a design decision.

## Risks

- Telegram offset, history, and photo handling can hide edge cases if tests only
  validate text messages.
- Discord, Telegram, and Matrix trio examples can drift if parity is not
  covered by workflow validation and stubbed example tests.
- Agent attachment forwarding can accidentally become provider-specific unless
  local paths and metadata continue to flow through normalized attachment
  descriptors.
- Live-provider fixes can widen PR scope; prefer low-risk validation, docs, and
  deterministic test improvements unless review finds a correctness bug.

## References

- `design-docs/specs/design-node-addon-catalog-and-chat-reply-worker.md`
- `design-docs/specs/design-discord-gateway-chat-history.md`
- `design-docs/specs/design-output-destinations-and-supervisor-memory.md`
- `design-docs/specs/design-matrix-attachment-text.md`
- `design-docs/specs/design-chat-sdk-chat-history.md`
- `design-docs/references/README.md`
