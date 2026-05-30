# Expected Results

- The workflow validates as a step-addressed Matrix chat bundle.
- The app icon assets are stored with the workflow:
  - `assets/icons/yui-codex.png`
  - `assets/icons/mika-claude.png`
  - `assets/icons/rina-cursor.png`
- `route-message` uses `rielflow/chat-persona-router` to select exactly one initial responder without a provider-specific routing prompt.
- Messages with no named bot route to Yui Codex.
- Messages that call Mika Trend route only to Mika.
- Messages that call Rina Cursor route only to Rina.
- If the selected persona is asked to hear another named persona too, that node
  sets a handoff flag such as `handoff_mika`, allowing a follow-up node response.
- Matrix replies are sent through `rielflow/chat-reply-worker` to the same
  conversation and thread from the normalized chat event.
- Matrix event source fixtures validate with `matrix-agent-trio-to-workflow`.
- Text-compatible Matrix attachments can be downloaded into deterministic
  descriptors when the Matrix source attachment settings allow the MIME type.
- Accepted messages can be persisted as bounded chat history and reloaded after
  an event runner restart when the same event data root is reused.
