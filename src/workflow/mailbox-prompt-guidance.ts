export function appendMailboxPromptGuidance(input: {
  readonly promptText: string;
}): string {
  return [
    input.promptText,
    "",
    "Runtime mailbox:",
    "- Full structured input is available at $DIVEDRA_MAILBOX_DIR/inbox/input.json.",
    "- The mailbox root is exported through DIVEDRA_MAILBOX_DIR.",
    "- Use this file when upstream payload summaries in the prompt are truncated.",
    "- Do not write mailbox outbox files directly; final output publication remains runtime-owned.",
  ].join("\n");
}
