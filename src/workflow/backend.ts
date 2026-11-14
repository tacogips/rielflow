import type { CliAgentBackend, NodeExecutionBackend } from "./types";

const CLI_AGENT_BACKENDS = {
  "codex-agent": "codex-agent",
  "claude-code-agent": "claude-code-agent",
  "cursor-cli-agent": "cursor-cli-agent",
} as const satisfies Record<CliAgentBackend, CliAgentBackend>;

const NATIVE_NODE_EXECUTION_BACKENDS = new Set<NodeExecutionBackend>([
  "official/openai-sdk",
  "official/anthropic-sdk",
]);

export function normalizeCliAgentBackend(
  value: unknown,
): CliAgentBackend | null {
  if (typeof value !== "string") {
    return null;
  }
  return CLI_AGENT_BACKENDS[value as CliAgentBackend] ?? null;
}

export function isCliAgentBackend(value: unknown): value is CliAgentBackend {
  return normalizeCliAgentBackend(value) !== null;
}

export function normalizeNodeExecutionBackend(
  value: unknown,
): NodeExecutionBackend | null {
  const cliBackend = normalizeCliAgentBackend(value);
  if (cliBackend !== null) {
    return cliBackend;
  }
  return typeof value === "string" &&
    NATIVE_NODE_EXECUTION_BACKENDS.has(value as NodeExecutionBackend)
    ? (value as NodeExecutionBackend)
    : null;
}
