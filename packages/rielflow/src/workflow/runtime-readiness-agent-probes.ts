import { spawn } from "node:child_process";
import type { NodeExecutionBackend, LoadOptions } from "./types";
import type { WorkflowRuntimeRequirement } from "./runtime-readiness";
import { buildCodexModelAvailabilityFailureMessage } from "./codex-model-check-message";
import { compactAgentCliMessage } from "./agent-cli-parse-utils";
import { NodeValidationResult } from "./validate/node-validation-result";
import {
  checkCodexBackendModelAvailability,
  checkCursorBackendModelAvailability,
  getClaudeBackendToolVersion,
  getCodexBackendLoginStatus,
  getCodexBackendToolVersions,
  getCursorBackendToolVersions,
  verifyClaudeBackendReadiness,
  type AgentBackendProbeOptions,
  type AgentBackendToolInfo,
  type CodexBackendLoginStatus,
} from "./adapters/readiness";

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

interface CommandExecutionResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly message?: string;
}

export interface AgentBackendReadinessOperations {
  readonly getCodexBackendToolVersions: typeof getCodexBackendToolVersions;
  readonly getCodexBackendLoginStatus: typeof getCodexBackendLoginStatus;
  readonly checkCodexBackendModelAvailability: typeof checkCodexBackendModelAvailability;
  readonly getClaudeBackendToolVersion: typeof getClaudeBackendToolVersion;
  readonly verifyClaudeBackendReadiness: typeof verifyClaudeBackendReadiness;
  readonly getCursorBackendToolVersions: typeof getCursorBackendToolVersions;
  readonly checkCursorBackendModelAvailability: typeof checkCursorBackendModelAvailability;
}

const defaultAgentBackendReadinessOperations: AgentBackendReadinessOperations =
  {
    getCodexBackendToolVersions,
    getCodexBackendLoginStatus,
    checkCodexBackendModelAvailability,
    getClaudeBackendToolVersion,
    verifyClaudeBackendReadiness,
    getCursorBackendToolVersions,
    checkCursorBackendModelAvailability,
  };

let agentBackendReadinessOperations: AgentBackendReadinessOperations =
  defaultAgentBackendReadinessOperations;

function toSortedArray(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function resolveProbeCwd(cwd: string | undefined): string {
  return cwd ?? process.cwd();
}

function hasAuthLikeFailure(value: string): boolean {
  return /auth|login|credential|unauthorized|permission|forbidden|expired/i.test(
    value,
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
  const nextEnv: NodeJS.ProcessEnv = { ...process.env };
  if (env === undefined) {
    return nextEnv;
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      nextEnv[key] = value;
    }
  }
  return nextEnv;
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
      shell: false,
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

export async function runCommand(
  command: string,
  args: readonly string[],
  options: Pick<LoadOptions, "cwd" | "env">,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
): Promise<CommandExecutionResult> {
  return await runCommandImpl(command, args, options, timeoutMs);
}

export function setAgentBackendReadinessOperationsForTests(
  operations: Partial<AgentBackendReadinessOperations>,
): void {
  agentBackendReadinessOperations = {
    ...defaultAgentBackendReadinessOperations,
    ...operations,
  };
}

export function resetAgentBackendReadinessOperationsForTests(): void {
  agentBackendReadinessOperations = defaultAgentBackendReadinessOperations;
}

function toProbeOptions(
  options: Pick<LoadOptions, "cwd" | "env">,
  timeoutMs?: number,
): AgentBackendProbeOptions {
  return {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

function toolIsAvailable(tool: AgentBackendToolInfo): boolean {
  return tool.status === "available" && tool.version !== null;
}

function formatToolInfo(tool: AgentBackendToolInfo): string {
  if (toolIsAvailable(tool)) {
    return `${tool.name}=${tool.version}`;
  }
  return `${tool.name}=${tool.error ?? tool.status}`;
}

function missingToolInfo(name: string, command: string): AgentBackendToolInfo {
  return {
    name,
    command,
    version: null,
    status: "unavailable",
    error: "tool was not reported by the bundled SDK",
  };
}

function findToolInfo(
  tools: readonly AgentBackendToolInfo[],
  name: string,
): AgentBackendToolInfo {
  return (
    tools.find((tool) => tool.name === name || tool.command === name) ??
    missingToolInfo(name, name)
  );
}

function codexLoginStatusMessage(status: CodexBackendLoginStatus): string {
  return compactAgentCliMessage(
    status.error ?? status.status ?? undefined,
    "codex login status failed",
  );
}

export async function probeCodexBackend(
  candidate: AgentBackendRequirementCandidate,
  options: Pick<LoadOptions, "cwd" | "env">,
): Promise<WorkflowRuntimeRequirement> {
  const toolVersions =
    await agentBackendReadinessOperations.getCodexBackendToolVersions(
      toProbeOptions(options),
    );
  const commandSummary = [
    formatToolInfo(toolVersions.codex),
    formatToolInfo(toolVersions.git),
  ].join(", ");
  return {
    id: `agent-backend:${candidate.backend}`,
    kind: "agent-backend",
    label: `${candidate.backend} backend`,
    status:
      toolIsAvailable(toolVersions.codex) && toolIsAvailable(toolVersions.git)
        ? "available"
        : "unavailable",
    detail:
      `local SDK execution; bundled sdk=codex-agent; models=${toSortedArray(candidate.models).join(", ")}; ` +
      `local tools: ${commandSummary}`,
    sourceStepIds: candidate.sourceStepIds,
  };
}

export async function probeCursorBackend(
  candidate: AgentBackendRequirementCandidate,
  options: Pick<LoadOptions, "cwd" | "env">,
): Promise<WorkflowRuntimeRequirement> {
  const toolVersions =
    await agentBackendReadinessOperations.getCursorBackendToolVersions(
      toProbeOptions(options),
    );
  const cursorAgent = findToolInfo(toolVersions.tools, "cursor-agent");
  const commandSummary =
    toolVersions.tools.length === 0
      ? formatToolInfo(cursorAgent)
      : toolVersions.tools.map(formatToolInfo).join(", ");

  return {
    id: `agent-backend:${candidate.backend}`,
    kind: "agent-backend",
    label: `${candidate.backend} backend`,
    status: toolIsAvailable(cursorAgent) ? "available" : "unavailable",
    detail:
      `local SDK execution; bundled sdk=cursor-cli-agent@${toolVersions.packageVersion}; ` +
      `models=${toSortedArray(candidate.models).join(", ")}; ` +
      `local tools: ${commandSummary}`,
    sourceStepIds: candidate.sourceStepIds,
  };
}

export async function probeClaudeBackend(
  candidate: AgentBackendRequirementCandidate,
  options: Pick<LoadOptions, "cwd" | "env">,
): Promise<WorkflowRuntimeRequirement> {
  const claudeTool =
    await agentBackendReadinessOperations.getClaudeBackendToolVersion(
      toProbeOptions(options),
    );

  return {
    id: `agent-backend:${candidate.backend}`,
    kind: "agent-backend",
    label: `${candidate.backend} backend`,
    status: toolIsAvailable(claudeTool) ? "available" : "unavailable",
    detail:
      `local SDK execution; bundled sdk=claude-code-agent; models=${toSortedArray(candidate.models).join(", ")}; ` +
      `local tools: ${formatToolInfo(claudeTool)}`,
    sourceStepIds: candidate.sourceStepIds,
  };
}

async function checkCodexModel(input: {
  readonly candidate: AgentBackendPreflightCandidate;
  readonly model: string;
  readonly options: Pick<LoadOptions, "cwd" | "env">;
}): Promise<NodeValidationResult> {
  const availability =
    await agentBackendReadinessOperations.checkCodexBackendModelAvailability({
      model: input.model,
      ...(input.options.cwd === undefined ? {} : { cwd: input.options.cwd }),
      ...(input.options.env === undefined ? {} : { env: input.options.env }),
      timeoutMs: MODEL_CHECK_COMMAND_TIMEOUT_MS,
    });
  if (!availability.ok) {
    return resultForCandidate({
      candidate: input.candidate,
      status: "invalid",
      message: buildCodexModelAvailabilityFailureMessage({
        model: input.model,
        availability,
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
  const availability =
    await agentBackendReadinessOperations.checkCodexBackendModelAvailability({
      model: firstModel,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      timeoutMs: MODEL_CHECK_COMMAND_TIMEOUT_MS,
    });
  if (!availability.ok) {
    return resultForCandidate({
      candidate,
      status: "invalid",
      message: buildCodexModelAvailabilityFailureMessage({
        model: firstModel,
        availability,
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
  const result =
    await agentBackendReadinessOperations.checkCursorBackendModelAvailability({
      model: input.model,
      ...(input.options.cwd === undefined ? {} : { cwd: input.options.cwd }),
      ...(input.options.env === undefined ? {} : { env: input.options.env }),
      timeoutMs: MODEL_CHECK_COMMAND_TIMEOUT_MS,
      probe: true,
    });
  const combined = [
    result.auth.detail,
    result.modelReachability.error,
    result.modelReachability.output,
    result.binary.error,
  ]
    .filter((value): value is string => value !== undefined)
    .join("\n");
  if (
    result.auth.status === "unavailable" ||
    (result.modelReachability.status !== "available" &&
      hasAuthLikeFailure(combined))
  ) {
    return resultForCandidate({
      candidate: input.candidate,
      status: "invalid",
      message: `cursor-cli-agent model '${input.model}' probe reported an authentication failure: ${compactAgentCliMessage(combined, "auth failure")}`,
    });
  }
  if (!toolIsAvailable(result.binary)) {
    return resultForCandidate({
      candidate: input.candidate,
      status: "invalid",
      message: `cursor-cli-agent model '${input.model}' is not reachable: ${result.binary.name} is unavailable: ${compactAgentCliMessage(result.binary.error, "tool unavailable")}`,
    });
  }
  if (result.modelReachability.status !== "available") {
    return resultForCandidate({
      candidate: input.candidate,
      status: "invalid",
      message: `cursor-cli-agent model '${input.model}' is not reachable: ${compactAgentCliMessage(result.modelReachability.error ?? result.modelReachability.output, "model check failed")}`,
    });
  }
  return resultForCandidate({
    candidate: input.candidate,
    status: "valid",
    message: `cursor-cli-agent model '${input.model}' is reachable`,
  });
}

async function checkClaudeModel(input: {
  readonly candidate: AgentBackendPreflightCandidate;
  readonly model: string;
  readonly options: Pick<LoadOptions, "cwd" | "env">;
}): Promise<NodeValidationResult> {
  const readiness =
    await agentBackendReadinessOperations.verifyClaudeBackendReadiness({
      ...toProbeOptions(input.options, MODEL_CHECK_COMMAND_TIMEOUT_MS),
      model: input.model,
    });
  if (readiness.ready && readiness.model.available) {
    return resultForCandidate({
      candidate: input.candidate,
      status: "valid",
      message: `claude-code-agent model '${input.model}' is reachable`,
    });
  }
  if (!readiness.auth.available) {
    return resultForCandidate({
      candidate: input.candidate,
      status: "invalid",
      message: `claude-code-agent model '${input.model}' probe reported an authentication failure: ${compactAgentCliMessage(readiness.auth.message, "auth failure")}`,
    });
  }
  if (!readiness.cli.available) {
    return resultForCandidate({
      candidate: input.candidate,
      status: "invalid",
      message: `claude-code-agent model '${input.model}' is not reachable: ${readiness.cli.command} is unavailable: ${compactAgentCliMessage(readiness.cli.message, "tool unavailable")}`,
    });
  }
  return resultForCandidate({
    candidate: input.candidate,
    status: "invalid",
    message: `claude-code-agent model '${input.model}' is not reachable: ${compactAgentCliMessage(readiness.model.message, "model check failed")}`,
  });
}

async function checkClaudeAuth(
  candidate: AgentBackendPreflightCandidate,
  options: Pick<LoadOptions, "cwd" | "env">,
): Promise<NodeValidationResult> {
  const readiness =
    await agentBackendReadinessOperations.verifyClaudeBackendReadiness(
      toProbeOptions(options),
    );
  return resultForCandidate({
    candidate,
    status: readiness.auth.available ? "valid" : "invalid",
    message: readiness.auth.available
      ? "claude-code-agent authentication is valid"
      : `claude-code-agent authentication is unavailable: ${compactAgentCliMessage(readiness.auth.message, "auth verify failed")}`,
  });
}

async function checkCodexAuth(
  candidate: AgentBackendPreflightCandidate,
  options: Pick<LoadOptions, "cwd" | "env">,
): Promise<NodeValidationResult> {
  const status =
    await agentBackendReadinessOperations.getCodexBackendLoginStatus(
      toProbeOptions(options, MODEL_CHECK_COMMAND_TIMEOUT_MS),
    );
  return resultForCandidate({
    candidate,
    status: status.ok ? "valid" : "invalid",
    message: status.ok
      ? "codex-agent authentication status is valid"
      : `codex-agent authentication is unavailable: ${codexLoginStatusMessage(status)}`,
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
    resultForCandidate({
      candidate,
      status: "valid",
      message:
        "codex-agent reasoning effort is supported through model_reasoning_effort config overrides",
    }),
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
    notApplicableResult(
      candidate,
      "claude-code-agent static plan support maps to PermissionMode 'plan'; no per-node permissionMode field is authored",
    ),
    resultForCandidate({
      candidate,
      status: "valid",
      message:
        "claude-code-agent reasoning effort is supported through the Claude Code --effort option",
    }),
    notApplicableResult(
      candidate,
      "claude-code-agent mode options use adapter configuration; no per-node permissionMode field is authored",
    ),
    ...(await Promise.all(
      toSortedArray(candidate.models).map((model) =>
        checkClaudeModel({ candidate, model, options }),
      ),
    )),
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
    resultForCandidate({
      candidate,
      status: "valid",
      message:
        "cursor-cli-agent reasoning effort is supported through Cursor model-id effort selection",
    }),
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
