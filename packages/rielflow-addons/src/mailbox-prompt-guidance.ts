export function appendMailboxPromptGuidance(input: {
  readonly promptText: string;
}): string {
  return [
    input.promptText,
    "",
    "Runtime input/output:",
    "- Workflow communication is read from SQLite workflow_messages and supplied as resolved structured input.",
    "- Do not read legacy execution-local inbox/outbox paths for message input.",
    "- Return the node result through the adapter response, native stdout JSON, or the reserved Candidate-Path channel.",
    "- Do not write legacy execution-local inbox/outbox paths; final output publication remains runtime-owned.",
  ].join("\n");
}
