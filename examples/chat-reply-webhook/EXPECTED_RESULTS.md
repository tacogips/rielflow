# Expected Results

This worker-only workflow demonstrates the built-in
`rielflow/chat-reply-worker` add-on.

Stable assertions:

- The workflow validates under `--workflow-definition-dir ./examples`.
- The authored `reply-to-chat` step targets a reusable node-registry entry that
  uses `addon.name:
"rielflow/chat-reply-worker"` without a workflow-local node implementation
  file.
- When dispatched from the `example-reply-webhook` event source with
  `RIEL_EXAMPLE_REPLY_ENDPOINT` configured, the node emits one outbound chat
  reply request.
- The reply text is rendered from the triggering event metadata and input text.
