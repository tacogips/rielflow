import type { CliAgentBackend, NodeExecutionBackend } from "./types";

type CliAgentBackendAlias =
  | CliAgentBackend
  | "tacogips/codex-agent"
  | "tacogips/claude-code-agent";

const CLI_AGENT_BACKEND_ALIASES = {
  "codex-agent": "codex-agent",
  "tacogips/codex-agent": "codex-agent",
  "claude-code-agent": "claude-code-agent",
  "tacogips/claude-code-agent": "claude-code-agent",
} as const satisfies Record<CliAgentBackendAlias, CliAgentBackend>;

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
  return CLI_AGENT_BACKEND_ALIASES[value as CliAgentBackendAlias] ?? null;
}

export function isCliAgentBackend(
  value: unknown,
): value is CliAgentBackendAlias {
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
