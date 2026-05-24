import { spawn } from "node:child_process";
import type { NodeExecutionBackend, LoadOptions } from "./types";
import type { WorkflowRuntimeRequirement } from "./runtime-readiness";
import type { AgentCliCommandResult } from "./agent-cli-command-result";
import { parseAgentToolVersionsOutput } from "./agent-tool-versions-parse";
import { parseClaudeAuthVerifyOutput } from "./claude-auth-verify-parse";
import {
  buildCodexModelCheckFailureMessage,
  parseCodexLoginStatus,
} from "./codex-auth-verify-parse";
import { compactAgentCliMessage } from "./agent-cli-parse-utils";
import { NodeValidationResult } from "./validate/node-validation-result";

const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const MODEL_CHECK_COMMAND_TIMEOUT_MS = 30_000;

export interface AgentBackendRequirementCandidate {
  readonly backend: NodeExecutionBackend;
  readonly models: ReadonlySet<string>;
  readonly sourceStepIds: readonly string[];
}

export interface AgentBackendPreflightCandidate {
  readonly backend: NodeExecutionBackend;
  readonly models: ReadonlySet<string>;
  readonly nodeIds: readonly string[];
  readonly stepIds: readonly string[];
}

interface CommandExecutionResult extends AgentCliCommandResult {}

function toSortedArray(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function resolveProbeCwd(cwd: string | undefined): string {
  return cwd ?? process.cwd();
}

type AgentCliBinaryName =
  | "claude-code-agent"
  | "cursor-cli-agent"
  | "codex-agent";

function commandCandidatesFor(
  binaryName: AgentCliBinaryName,
): readonly [AgentCliBinaryName] {
  return [binaryName];
}

function hasAuthLikeFailure(value: string): boolean {
  return /auth|login|credential|unauthorized|permission|forbidden|expired/i.test(
    value,
  );
}

async function runFirstAvailableCommand(
  commands: readonly string[],
  args: readonly string[],
  options: Pick<LoadOptions, "cwd" | "env">,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
): Promise<CommandExecutionResult> {
  let lastMissing: CommandExecutionResult | undefined;
  for (const command of commands) {
    const result = await runCommand(command, args, options, timeoutMs);
    if (
      !result.ok &&
      result.message !== undefined &&
      /no such file or directory|enoent/i.test(result.message)
    ) {
      lastMissing = result;
      continue;
    }
    return result;
  }
  return (
    lastMissing ?? {
      ok: false,
      stdout: "",
      stderr: "",
      message: "command unavailable",
    }
  );
}

function resultForCandidate(input: {
  readonly candidate: AgentBackendPreflightCandidate;
  readonly status: NodeValidationResult["status"];
  readonly message: string;
  readonly path?: string;
}): NodeValidationResult {
  return new NodeValidationResult({
    status: input.status,
    message: input.message,
    nodeId: input.candidate.nodeIds.join(","),
    stepIds: input.candidate.stepIds,
    source: "agent-backend",
    backend: input.candidate.backend,
    path: input.path ?? "workflow.nodes",
  });
}

function buildProcessEnv(
  env: Readonly<Record<string, string | undefined>> | undefined,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(env === undefined ? {} : env),
  };
}

async function runCommandImpl(
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

type ExecuteAgentCliCommand = typeof runCommandImpl;

let executeAgentCliCommand: ExecuteAgentCliCommand = runCommandImpl;

export async function runCommand(
  command: string,
  args: readonly string[],
  options: Pick<LoadOptions, "cwd" | "env">,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
): Promise<CommandExecutionResult> {
  return await executeAgentCliCommand(command, args, options, timeoutMs);
}

export function setExecuteAgentCliCommandForTests(
  runner: ExecuteAgentCliCommand,
): void {
  executeAgentCliCommand = runner;
}

export function resetExecuteAgentCliCommandForTests(): void {
  executeAgentCliCommand = runCommandImpl;
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
  const commandCandidates = commandCandidatesFor("cursor-cli-agent");

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
    const parsed = parseAgentToolVersionsOutput({
      stdout: result.stdout,
      requiredTool: "cursor-agent",
      agentLabel: "cursor-cli-agent",
    });
    cursorAvailable = parsed.available;
    commandSummary = parsed.commandSummary;
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
  const commandCandidates = commandCandidatesFor("claude-code-agent");

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
    const parsed = parseAgentToolVersionsOutput({
      stdout: result.stdout,
      requiredTool: "claude",
      agentLabel: "claude-code-agent",
    });
    claudeAvailable = parsed.available;
    commandSummary = parsed.commandSummary;
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

async function checkCodexModel(input: {
  readonly candidate: AgentBackendPreflightCandidate;
  readonly model: string;
  readonly options: Pick<LoadOptions, "cwd" | "env">;
}): Promise<NodeValidationResult> {
  const result = await runFirstAvailableCommand(
    commandCandidatesFor("codex-agent"),
    ["model", "check", "--model", input.model, "--json"],
    input.options,
    MODEL_CHECK_COMMAND_TIMEOUT_MS,
  );
  if (!result.ok) {
    return resultForCandidate({
      candidate: input.candidate,
      status: "invalid",
      message: buildCodexModelCheckFailureMessage({
        model: input.model,
        result,
        accountReadiness: false,
      }),
    });
  }
  return resultForCandidate({
    candidate: input.candidate,
    status: "valid",
    message: `codex-agent model '${input.model}' is reachable`,
  });
}

async function checkCodexAccountReadiness(
  candidate: AgentBackendPreflightCandidate,
  options: Pick<LoadOptions, "cwd" | "env">,
): Promise<NodeValidationResult> {
  const firstModel = toSortedArray(candidate.models)[0];
  if (firstModel === undefined) {
    return unknownResult(
      candidate,
      "codex-agent account readiness could not be verified because no model is authored",
    );
  }
  const result = await runFirstAvailableCommand(
    commandCandidatesFor("codex-agent"),
    ["model", "check", "--model", firstModel, "--json"],
    options,
    MODEL_CHECK_COMMAND_TIMEOUT_MS,
  );
  if (!result.ok) {
    return resultForCandidate({
      candidate,
      status: "invalid",
      message: buildCodexModelCheckFailureMessage({
        model: firstModel,
        result,
        accountReadiness: true,
      }),
    });
  }
  return resultForCandidate({
    candidate,
    status: "valid",
    message: `codex-agent account readiness is valid for model '${firstModel}'`,
  });
}

async function checkCursorModel(input: {
  readonly candidate: AgentBackendPreflightCandidate;
  readonly model: string;
  readonly options: Pick<LoadOptions, "cwd" | "env">;
}): Promise<NodeValidationResult> {
  const result = await runFirstAvailableCommand(
    commandCandidatesFor("cursor-cli-agent"),
    ["model", "check", "--model", input.model, "--json"],
    input.options,
    MODEL_CHECK_COMMAND_TIMEOUT_MS,
  );
  const combined = `${result.stdout}\n${result.stderr}\n${result.message ?? ""}`;
  if (!result.ok && hasAuthLikeFailure(combined)) {
    return resultForCandidate({
      candidate: input.candidate,
      status: "invalid",
      message: `cursor-cli-agent model '${input.model}' probe reported an authentication failure: ${compactAgentCliMessage(result.message, "auth failure")}`,
    });
  }
  if (!result.ok) {
    return resultForCandidate({
      candidate: input.candidate,
      status: "invalid",
      message: `cursor-cli-agent model '${input.model}' is not reachable: ${compactAgentCliMessage(result.message, "model check failed")}`,
    });
  }
  return resultForCandidate({
    candidate: input.candidate,
    status: "valid",
    message: `cursor-cli-agent model '${input.model}' is reachable`,
  });
}

async function checkClaudeAuth(
  candidate: AgentBackendPreflightCandidate,
  options: Pick<LoadOptions, "cwd" | "env">,
): Promise<NodeValidationResult> {
  const result = await runFirstAvailableCommand(
    commandCandidatesFor("claude-code-agent"),
    ["auth", "verify", "--json"],
    options,
  );
  const parsed = parseClaudeAuthVerifyOutput(result);
  return resultForCandidate({
    candidate,
    status: parsed.ok ? "valid" : "invalid",
    message: parsed.ok
      ? parsed.message
      : `claude-code-agent authentication is unavailable: ${compactAgentCliMessage(parsed.message, "auth verify failed")}`,
  });
}

async function checkCodexAuth(
  candidate: AgentBackendPreflightCandidate,
  options: Pick<LoadOptions, "cwd" | "env">,
): Promise<NodeValidationResult> {
  const result = await runCommand("codex", ["login", "status"], options);
  const parsed = parseCodexLoginStatus(result);
  return resultForCandidate({
    candidate,
    status: parsed.ok ? "valid" : "invalid",
    message: parsed.ok
      ? "codex-agent authentication status is valid"
      : `codex-agent authentication is unavailable: ${compactAgentCliMessage(parsed.message, "codex login status failed")}`,
  });
}

function notApplicableResult(
  candidate: AgentBackendPreflightCandidate,
  message: string,
): NodeValidationResult {
  return resultForCandidate({
    candidate,
    status: "valid",
    message,
  });
}

function unknownResult(
  candidate: AgentBackendPreflightCandidate,
  message: string,
): NodeValidationResult {
  return resultForCandidate({
    candidate,
    status: "unknown",
    message,
  });
}

async function probeCodexNodeExecutability(
  candidate: AgentBackendPreflightCandidate,
  options: Pick<LoadOptions, "cwd" | "env">,
): Promise<readonly NodeValidationResult[]> {
  const readiness = await probeCodexBackend(
    {
      backend: candidate.backend,
      models: candidate.models,
      sourceStepIds: candidate.stepIds,
    },
    options,
  );
  const results: NodeValidationResult[] = [
    resultForCandidate({
      candidate,
      status: readiness.status === "available" ? "valid" : "invalid",
      message: readiness.detail,
    }),
    await checkCodexAuth(candidate, options),
    notApplicableResult(
      candidate,
      "codex-agent plan mode is not applicable unless a backend-specific plan field is authored",
    ),
    notApplicableResult(
      candidate,
      "codex-agent reasoning effort is not applicable because the inspected adapter exposes no effort field",
    ),
    notApplicableResult(
      candidate,
      "codex-agent mode options use adapter configuration; no per-node mode field is authored",
    ),
  ];
  for (const model of toSortedArray(candidate.models)) {
    results.push(await checkCodexModel({ candidate, model, options }));
  }
  return results;
}

async function probeClaudeNodeExecutability(
  candidate: AgentBackendPreflightCandidate,
  options: Pick<LoadOptions, "cwd" | "env">,
): Promise<readonly NodeValidationResult[]> {
  const readiness = await probeClaudeBackend(
    {
      backend: candidate.backend,
      models: candidate.models,
      sourceStepIds: candidate.stepIds,
    },
    options,
  );
  return [
    resultForCandidate({
      candidate,
      status: readiness.status === "available" ? "valid" : "invalid",
      message: readiness.detail,
    }),
    await checkClaudeAuth(candidate, options),
    unknownResult(
      candidate,
      "claude-code-agent model reachability has no stable local proof command",
    ),
    notApplicableResult(
      candidate,
      "claude-code-agent static plan support maps to PermissionMode 'plan'; no per-node permissionMode field is authored",
    ),
    notApplicableResult(
      candidate,
      "claude-code-agent reasoning effort is not applicable because the inspected adapter exposes no effort field",
    ),
    notApplicableResult(
      candidate,
      "claude-code-agent mode options use adapter configuration; no per-node permissionMode field is authored",
    ),
  ];
}

async function probeCursorNodeExecutability(
  candidate: AgentBackendPreflightCandidate,
  options: Pick<LoadOptions, "cwd" | "env">,
): Promise<readonly NodeValidationResult[]> {
  const readiness = await probeCursorBackend(
    {
      backend: candidate.backend,
      models: candidate.models,
      sourceStepIds: candidate.stepIds,
    },
    options,
  );
  const results: NodeValidationResult[] = [
    resultForCandidate({
      candidate,
      status: readiness.status === "available" ? "valid" : "invalid",
      message: readiness.detail,
    }),
    unknownResult(
      candidate,
      "cursor-cli-agent authentication has no stable local auth-status command",
    ),
    notApplicableResult(
      candidate,
      "cursor-cli-agent static plan support maps to mode 'plan'; no per-node mode field is authored",
    ),
    notApplicableResult(
      candidate,
      "cursor-cli-agent reasoning effort is not applicable because the inspected adapter exposes no effort field",
    ),
    notApplicableResult(
      candidate,
      "cursor-cli-agent mode options use adapter configuration; no per-node mode field is authored",
    ),
  ];
  for (const model of toSortedArray(candidate.models)) {
    results.push(await checkCursorModel({ candidate, model, options }));
  }
  return results;
}

async function probeCodexAuthReadiness(
  candidate: AgentBackendPreflightCandidate,
  options: Pick<LoadOptions, "cwd" | "env">,
): Promise<readonly NodeValidationResult[]> {
  const authResult = await checkCodexAuth(candidate, options);
  if (authResult.status !== "valid") {
    return [authResult];
  }
  return [authResult, await checkCodexAccountReadiness(candidate, options)];
}

export async function probeAgentBackendAuthReadiness(
  candidate: AgentBackendPreflightCandidate,
  options: Pick<LoadOptions, "cwd" | "env">,
): Promise<readonly NodeValidationResult[]> {
  switch (candidate.backend) {
    case "codex-agent":
      return await probeCodexAuthReadiness(candidate, options);
    case "claude-code-agent":
      return [await checkClaudeAuth(candidate, options)];
    case "cursor-cli-agent":
    case "official/openai-sdk":
    case "official/anthropic-sdk":
      return [];
  }
}

export async function probeAgentBackendNodeExecutability(
  candidate: AgentBackendPreflightCandidate,
  options: Pick<LoadOptions, "cwd" | "env">,
): Promise<readonly NodeValidationResult[]> {
  switch (candidate.backend) {
    case "codex-agent":
      return await probeCodexNodeExecutability(candidate, options);
    case "claude-code-agent":
      return await probeClaudeNodeExecutability(candidate, options);
    case "cursor-cli-agent":
      return await probeCursorNodeExecutability(candidate, options);
    case "official/openai-sdk":
    case "official/anthropic-sdk":
      return [
        unknownResult(
          candidate,
          `${candidate.backend} executable validation is covered by runtime environment readiness`,
        ),
      ];
  }
}
