import type { AgentCliCommandResult } from "./agent-cli-command-result";
import {
  compactAgentCliMessage,
  firstNonEmptyLine,
} from "./agent-cli-parse-utils";

function looksUnauthenticatedCodexLoginStatus(status: string): boolean {
  return /not\s+logged|logged\s*out|unauthenticated|no\s+stored\s+credentials/iu.test(
    status,
  );
}

function hasCodexAccountFailure(value: string): boolean {
  return /subscription|not enabled|quota|billing|plan|expired|usage limit/i.test(
    value,
  );
}

function parseCodexModelCheckJsonDetail(stdout: string): string | undefined {
  const trimmedStdout = stdout.trim();
  if (trimmedStdout.length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmedStdout) as {
      readonly probe?: { readonly error?: string | null };
      readonly auth?: { readonly error?: string | null };
    };
    const probeError = parsed.probe?.error?.trim();
    if (probeError !== undefined && probeError.length > 0) {
      return probeError;
    }
    const authError = parsed.auth?.error?.trim();
    if (authError !== undefined && authError.length > 0) {
      return authError;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function parseCodexLoginStatus(result: AgentCliCommandResult): {
  readonly ok: boolean;
  readonly status: string | null;
  readonly message: string;
} {
  const status =
    firstNonEmptyLine(result.stdout) ?? firstNonEmptyLine(result.stderr);
  if (!result.ok) {
    return {
      ok: false,
      status,
      message:
        status !== null && looksUnauthenticatedCodexLoginStatus(status)
          ? status
          : compactAgentCliMessage(result.message, "codex login status failed"),
    };
  }
  if (status === null) {
    return {
      ok: false,
      status: null,
      message: "login status command succeeded but produced no output",
    };
  }
  if (looksUnauthenticatedCodexLoginStatus(status)) {
    return {
      ok: false,
      status,
      message: status,
    };
  }
  return {
    ok: true,
    status,
    message: status,
  };
}

export function buildCodexModelCheckFailureMessage(input: {
  readonly model: string;
  readonly result: AgentCliCommandResult;
  readonly accountReadiness: boolean;
}): string {
  const jsonDetail = parseCodexModelCheckJsonDetail(input.result.stdout);
  const detail = compactAgentCliMessage(
    jsonDetail ??
      input.result.message ??
      firstNonEmptyLine(input.result.stderr) ??
      firstNonEmptyLine(input.result.stdout) ??
      undefined,
    "model check failed",
  );
  const combined = `${input.result.stdout}\n${input.result.stderr}\n${detail}`;
  if (hasCodexAccountFailure(combined)) {
    return input.accountReadiness
      ? `codex-agent account is not usable: ${detail}`
      : `codex-agent model '${input.model}' account is not usable: ${detail}`;
  }
  return input.accountReadiness
    ? `codex-agent account readiness check failed for model '${input.model}': ${detail}`
    : `codex-agent model '${input.model}' is not reachable: ${detail}`;
}
