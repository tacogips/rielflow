import type { AgentCliCommandResult } from "./agent-cli-command-result";
import { compactAgentCliMessage } from "./agent-cli-parse-utils";

export function parseClaudeAuthVerifyOutput(result: AgentCliCommandResult): {
  readonly ok: boolean;
  readonly message: string;
} {
  const trimmedStdout = result.stdout.trim();
  if (trimmedStdout.length > 0) {
    try {
      const parsed = JSON.parse(trimmedStdout) as {
        readonly ready?: boolean;
        readonly auth?: {
          readonly state?: string;
          readonly available?: boolean;
          readonly message?: string;
        };
      };
      if (parsed.ready === true) {
        return {
          ok: true,
          message: "claude-code-agent authentication is valid",
        };
      }
      const authMessage =
        parsed.auth?.message ??
        (parsed.auth?.state === "expired"
          ? "Stored credentials are expired."
          : parsed.auth?.state === "missing"
            ? "No stored Claude Code credentials were found."
            : "claude-code-agent authentication verification failed");
      return { ok: false, message: authMessage };
    } catch {
      // Fall through to exit-code based handling.
    }
  }

  if (!result.ok) {
    return {
      ok: false,
      message: compactAgentCliMessage(result.message, "auth verify failed"),
    };
  }

  return {
    ok: true,
    message: "claude-code-agent authentication is valid",
  };
}
