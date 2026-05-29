# Expected Results

- The workflow validates as a step-addressed Telegram chat bundle.
- The app icon assets are stored with the workflow:
  - `assets/icons/yui-codex.png`
  - `assets/icons/mika-claude.png`
  - `assets/icons/rina-cursor.png`
- `route-message` selects exactly one initial responder.
- Messages with no named bot route to Yui Codex.
- Messages that call Mika Trend route only to Mika.
- Messages that call Rina Cursor route only to Rina.
- If the selected persona is asked to hear another named persona too, that node
  sets a handoff flag such as `handoff_mika`, allowing a follow-up node response.
- Telegram replies are sent through `rielflow/chat-reply-worker` to the same
  conversation and thread from the normalized chat event.
- Telegram Gateway event source fixtures validate with
  `telegram-gateway-personas-to-workflow`.
- Photo fixtures expose deterministic image descriptors in
  `event.input.attachments` without requiring live Telegram downloads.
- Accepted messages can be persisted as bounded chat history and reloaded after
  an event runner restart when the same event data root is reused.
