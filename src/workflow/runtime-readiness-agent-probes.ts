import { spawn } from "node:child_process";
import path from "node:path";
import type { NodeExecutionBackend, LoadOptions } from "./types";
import type { WorkflowRuntimeRequirement } from "./runtime-readiness";

const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;

export interface AgentBackendRequirementCandidate {
  readonly backend: NodeExecutionBackend;
  readonly models: ReadonlySet<string>;
  readonly sourceStepIds: readonly string[];
}

interface CommandExecutionResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly message?: string;
}

function toSortedArray(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function resolveProbeCwd(cwd: string | undefined): string {
  return cwd ?? process.cwd();
}

function buildProcessEnv(
  env: Readonly<Record<string, string | undefined>> | undefined,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(env === undefined ? {} : env),
  };
}

export async function runCommand(
  command: string,
  args: readonly string[],
  options: Pick<LoadOptions, "cwd" | "env">,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
): Promise<CommandExecutionResult> {
  return await new Promise<CommandExecutionResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: resolveProbeCwd(options.cwd),
      env: buildProcessEnv(options.env),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (result: CommandExecutionResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "unknown spawn error";
      settle({
        ok: false,
        stdout,
        stderr,
        message,
      });
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        settle({
          ok: true,
          stdout,
          stderr,
        });
        return;
      }
      const reason =
        signal !== null
          ? `signal ${signal}`
          : `exit code ${String(code ?? "unknown")}`;
      const stderrText = stderr.trim();
      settle({
        ok: false,
        stdout,
        stderr,
        message:
          stderrText.length > 0 ? stderrText : `${command} failed (${reason})`,
      });
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      settle({
        ok: false,
        stdout,
        stderr,
        message: `${command} timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
  });
}

export async function probeCodexBackend(
  candidate: AgentBackendRequirementCandidate,
  options: Pick<LoadOptions, "cwd" | "env">,
): Promise<WorkflowRuntimeRequirement> {
  const [codexVersion, gitVersion] = await Promise.all([
    runCommand("codex", ["--version"], options),
    runCommand("git", ["--version"], options),
  ]);
  const commandSummary = [
    codexVersion.ok
      ? `codex=${codexVersion.stdout.trim()}`
      : `codex=${codexVersion.message ?? "unavailable"}`,
    gitVersion.ok
      ? `git=${gitVersion.stdout.trim()}`
      : `git=${gitVersion.message ?? "unavailable"}`,
  ].join(", ");
  return {
    id: `agent-backend:${candidate.backend}`,
    kind: "agent-backend",
    label: `${candidate.backend} backend`,
    status: codexVersion.ok && gitVersion.ok ? "available" : "unavailable",
    detail:
      `local SDK execution; models=${toSortedArray(candidate.models).join(", ")}; ` +
      `local tools: ${commandSummary}`,
    sourceStepIds: candidate.sourceStepIds,
  };
}

export async function probeCursorBackend(
  candidate: AgentBackendRequirementCandidate,
  options: Pick<LoadOptions, "cwd" | "env">,
): Promise<WorkflowRuntimeRequirement> {
  const commandCandidates = toSortedArray([
    path.join(
      resolveProbeCwd(options.cwd),
      "node_modules",
      ".bin",
      "cursor-cli-agent",
    ),
    path.join(process.cwd(), "node_modules", ".bin", "cursor-cli-agent"),
    "cursor-cli-agent",
  ]);

  let commandSummary = "cursor-cli-agent version probe unavailable";
  let cursorAvailable = false;
  for (const command of commandCandidates) {
    const result = await runCommand(
      command,
      ["tool", "versions", "--json"],
      options,
    );
    if (!result.ok) {
      if (
        result.message !== undefined &&
        /no such file or directory|enoent/i.test(result.message)
      ) {
        continue;
      }
      commandSummary =
        result.message ?? "cursor-cli-agent version probe failed";
      break;
    }
    try {
      const parsed = JSON.parse(result.stdout) as {
        readonly agent?: string;
        readonly tools?: Readonly<
          Record<string, { version: string | null; error: string | null }>
        >;
      };
      const cursorAgentTool = parsed.tools?.["cursor-agent"];
      cursorAvailable =
        cursorAgentTool?.version !== null &&
        cursorAgentTool?.version !== undefined;
      const toolSummary = Object.entries(parsed.tools ?? {})
        .map(([name, value]) =>
          value.version === null
            ? `${name}=${value.error ?? "unavailable"}`
            : `${name}=${value.version}`,
        )
        .join(", ");
      commandSummary =
        `agent=${parsed.agent ?? "unknown"}` +
        (toolSummary.length === 0 ? "" : `, ${toolSummary}`);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "unknown JSON parse error";
      commandSummary = `cursor-cli-agent version output was invalid JSON: ${message}`;
    }
    break;
  }

  return {
    id: `agent-backend:${candidate.backend}`,
    kind: "agent-backend",
    label: `${candidate.backend} backend`,
    status: cursorAvailable ? "available" : "unavailable",
    detail:
      `local SDK execution; models=${toSortedArray(candidate.models).join(", ")}; ` +
      `local tools: ${commandSummary}`,
    sourceStepIds: candidate.sourceStepIds,
  };
}

export async function probeClaudeBackend(
  candidate: AgentBackendRequirementCandidate,
  options: Pick<LoadOptions, "cwd" | "env">,
): Promise<WorkflowRuntimeRequirement> {
  const commandCandidates = toSortedArray([
    path.join(
      resolveProbeCwd(options.cwd),
      "node_modules",
      ".bin",
      "claude-code-agent",
    ),
    path.join(process.cwd(), "node_modules", ".bin", "claude-code-agent"),
    "claude-code-agent",
  ]);

  let commandSummary = "claude-code-agent version probe unavailable";
  let claudeAvailable = false;
  for (const command of commandCandidates) {
    const result = await runCommand(command, ["version", "--json"], options);
    if (!result.ok) {
      if (
        result.message !== undefined &&
        /no such file or directory|enoent/i.test(result.message)
      ) {
        continue;
      }
      commandSummary =
        result.message ?? "claude-code-agent version probe failed";
      break;
    }
    try {
      const parsed = JSON.parse(result.stdout) as {
        readonly agent?: string;
        readonly tools?: Readonly<
          Record<string, { version: string | null; error: string | null }>
        >;
      };
      claudeAvailable =
        parsed.tools?.["claude"]?.version !== null &&
        parsed.tools?.["claude"]?.version !== undefined;
      const toolSummary = Object.entries(parsed.tools ?? {})
        .map(([name, value]) =>
          value.version === null
            ? `${name}=${value.error ?? "unavailable"}`
            : `${name}=${value.version}`,
        )
        .join(", ");
      commandSummary =
        `agent=${parsed.agent ?? "unknown"}` +
        (toolSummary.length === 0 ? "" : `, ${toolSummary}`);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "unknown JSON parse error";
      commandSummary = `claude-code-agent version output was invalid JSON: ${message}`;
    }
    break;
  }

  return {
    id: `agent-backend:${candidate.backend}`,
    kind: "agent-backend",
    label: `${candidate.backend} backend`,
    status: claudeAvailable ? "available" : "unavailable",
    detail:
      `local SDK execution; models=${toSortedArray(candidate.models).join(", ")}; ` +
      `local tools: ${commandSummary}`,
    sourceStepIds: candidate.sourceStepIds,
  };
}
