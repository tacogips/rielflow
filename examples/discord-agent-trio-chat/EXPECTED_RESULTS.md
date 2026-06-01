# Expected Results

- The workflow validates as a step-addressed Discord chat bundle.
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
- Each persona reads only its own recent markdown memory before replying, using
  `workflowInput.memoryRoot`, `RIEL_TRIO_MEMORY_ROOT`, or the example fallback
  `/tmp/riflow-tribot`.
- Each persona can return `memoryEntries` for explicit remember requests,
  corrections, durable preferences, important events, or refreshed old memories;
  the workflow writes them to `{memoryRoot}/{personaId}/{YYYY-MM-DD_HH}.md`.
- Discord replies are sent through `rielflow/chat-reply-worker` to the same
  conversation and thread from the normalized chat event.
