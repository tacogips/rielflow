import { spawn } from "node:child_process";
import path from "node:path";
import { resolveConfiguredEnvValue } from "./adapters/shared";
import { resolveNodeExecutionBackend } from "./adapters/dispatch";
import {
  asAgentNodePayload,
  DEFAULT_CONTAINER_RUNNER_KIND,
  type ContainerRunnerKind,
  type LoadOptions,
  type NodeExecutionBackend,
  type NormalizedWorkflowBundle,
} from "./types";

const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;

export type WorkflowRuntimeRequirementStatus =
  | "available"
  | "unavailable"
  | "unsupported";

export interface WorkflowRuntimeRequirement {
  readonly id: string;
  readonly kind: "agent-backend" | "container-runner" | "node-executor";
  readonly label: string;
  readonly status: WorkflowRuntimeRequirementStatus;
  readonly detail: string;
  readonly sourceNodeIds: readonly string[];
}

export interface WorkflowRuntimeReadiness {
  readonly ready: boolean;
  readonly checkedAt: string;
  readonly requirements: readonly WorkflowRuntimeRequirement[];
  readonly blockers: readonly string[];
}

interface RequirementProbeOptions
  extends Pick<LoadOptions, "cwd" | "env"> {
  readonly onlyNodeIds?: ReadonlySet<string>;
}

interface AgentBackendRequirementCandidate {
  readonly backend: NodeExecutionBackend;
  readonly models: ReadonlySet<string>;
  readonly sourceNodeIds: readonly string[];
}

interface ContainerRunnerRequirementCandidate {
  readonly runnerKind: ContainerRunnerKind;
  readonly runnerPath?: string;
  readonly sourceNodeIds: readonly string[];
}

interface CommandExecutionResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly message?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toSortedArray(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function buildSourceNodeList(sourceNodeIds: readonly string[]): string {
  return sourceNodeIds.join(", ");
}

function formatRequirementBlocker(
  requirement: WorkflowRuntimeRequirement,
): string {
  return `${requirement.label}: ${requirement.detail}`;
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

async function runCommand(
  command: string,
  args: readonly string[],
  options: Pick<RequirementProbeOptions, "cwd" | "env">,
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
          stderrText.length > 0
            ? stderrText
            : `${command} failed (${reason})`,
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

async function probeCodexBackend(
  candidate: AgentBackendRequirementCandidate,
  options: Pick<RequirementProbeOptions, "cwd" | "env">,
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
    sourceNodeIds: candidate.sourceNodeIds,
  };
}

async function probeClaudeBackend(
  candidate: AgentBackendRequirementCandidate,
  options: Pick<RequirementProbeOptions, "cwd" | "env">,
): Promise<WorkflowRuntimeRequirement> {
  const commandCandidates = toSortedArray([
    path.join(resolveProbeCwd(options.cwd), "node_modules", ".bin", "claude-code-agent"),
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
      commandSummary = result.message ?? "claude-code-agent version probe failed";
      break;
    }
    try {
      const parsed = JSON.parse(result.stdout) as {
        readonly agent?: string;
        readonly tools?: Readonly<Record<string, { version: string | null; error: string | null }>>;
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
    sourceNodeIds: candidate.sourceNodeIds,
  };
}

function probeEnvConfiguredBackend(input: {
  readonly backend: "official/openai-sdk" | "official/anthropic-sdk";
  readonly envName: string;
  readonly sourceNodeIds: readonly string[];
  readonly models: ReadonlySet<string>;
  readonly env: Readonly<Record<string, string | undefined>> | undefined;
}): WorkflowRuntimeRequirement {
  const value = resolveConfiguredEnvValue(undefined, input.envName, input.env);
  return {
    id: `agent-backend:${input.backend}`,
    kind: "agent-backend",
    label: `${input.backend} backend`,
    status: value === undefined ? "unavailable" : "available",
    detail:
      `${input.envName} ${value === undefined ? "is not set" : "is configured"}; ` +
      `models=${toSortedArray(input.models).join(", ")}`,
    sourceNodeIds: input.sourceNodeIds,
  };
}

async function probeContainerRunner(
  candidate: ContainerRunnerRequirementCandidate,
  options: Pick<RequirementProbeOptions, "cwd" | "env">,
): Promise<WorkflowRuntimeRequirement> {
  const command = candidate.runnerPath ?? candidate.runnerKind;
  const versionResult = await runCommand(command, ["--version"], options);
  return {
    id: `container-runner:${candidate.runnerKind}:${candidate.runnerPath ?? "default"}`,
    kind: "container-runner",
    label: `${candidate.runnerKind} container runner`,
    status: versionResult.ok ? "available" : "unavailable",
    detail: versionResult.ok
      ? `runner ${command} is available`
      : `runner ${command} is unavailable: ${versionResult.message ?? "unknown error"}`,
    sourceNodeIds: candidate.sourceNodeIds,
  };
}

function collectRequirements(
  bundle: NormalizedWorkflowBundle,
  onlyNodeIds: ReadonlySet<string> | undefined,
): {
  readonly agentBackends: readonly AgentBackendRequirementCandidate[];
  readonly containerRunners: readonly ContainerRunnerRequirementCandidate[];
  readonly unsupportedCommandNodeIds: readonly string[];
  readonly unsupportedContainerNodeIds: readonly string[];
} {
  const agentBackends = new Map<
    NodeExecutionBackend,
    { nodeIds: Set<string>; models: Set<string> }
  >();
  const containerRunners = new Map<
    string,
    { runnerKind: ContainerRunnerKind; runnerPath?: string; nodeIds: Set<string> }
  >();
  const unsupportedCommandNodeIds = new Set<string>();
  const unsupportedContainerNodeIds = new Set<string>();
  const defaults = bundle.workflow.defaults.containerRuntime;

  for (const [nodeId, node] of Object.entries(bundle.nodePayloads)) {
    if (onlyNodeIds !== undefined && !onlyNodeIds.has(nodeId)) {
      continue;
    }

    const agentNode = asAgentNodePayload(node);
    if (agentNode !== null) {
      const backend = resolveNodeExecutionBackend(agentNode);
      const existing = agentBackends.get(backend) ?? {
        nodeIds: new Set<string>(),
        models: new Set<string>(),
      };
      existing.nodeIds.add(nodeId);
      existing.models.add(agentNode.model);
      agentBackends.set(backend, existing);
      continue;
    }

    if (node.nodeType === "command") {
      unsupportedCommandNodeIds.add(nodeId);
      continue;
    }

    if (node.nodeType === "container") {
      unsupportedContainerNodeIds.add(nodeId);
      const runnerKind =
        node.container?.runnerKind ??
        defaults?.runnerKind ??
        DEFAULT_CONTAINER_RUNNER_KIND;
      const runnerPath = node.container?.runnerPath ?? defaults?.runnerPath;
      const key = `${runnerKind}:${runnerPath ?? ""}`;
      const existing = containerRunners.get(key) ?? {
        runnerKind,
        ...(runnerPath === undefined ? {} : { runnerPath }),
        nodeIds: new Set<string>(),
      };
      existing.nodeIds.add(nodeId);
      containerRunners.set(key, existing);
    }
  }

  return {
    agentBackends: [...agentBackends.entries()].map(([backend, entry]) => ({
      backend,
      models: entry.models,
      sourceNodeIds: toSortedArray(entry.nodeIds),
    })),
    containerRunners: [...containerRunners.values()].map((entry) => ({
      runnerKind: entry.runnerKind,
      ...(entry.runnerPath === undefined ? {} : { runnerPath: entry.runnerPath }),
      sourceNodeIds: toSortedArray(entry.nodeIds),
    })),
    unsupportedCommandNodeIds: toSortedArray(unsupportedCommandNodeIds),
    unsupportedContainerNodeIds: toSortedArray(unsupportedContainerNodeIds),
  };
}

export async function inspectWorkflowRuntimeReadiness(
  bundle: NormalizedWorkflowBundle,
  options: RequirementProbeOptions = {},
): Promise<WorkflowRuntimeReadiness> {
  const collected = collectRequirements(bundle, options.onlyNodeIds);
  const requirements: WorkflowRuntimeRequirement[] = [];

  for (const candidate of collected.agentBackends) {
    switch (candidate.backend) {
      case "codex-agent":
        requirements.push(await probeCodexBackend(candidate, options));
        break;
      case "claude-code-agent":
        requirements.push(await probeClaudeBackend(candidate, options));
        break;
      case "official/openai-sdk":
        requirements.push(
          probeEnvConfiguredBackend({
            backend: candidate.backend,
            envName: "OPENAI_API_KEY",
            sourceNodeIds: candidate.sourceNodeIds,
            models: candidate.models,
            env: options.env,
          }),
        );
        break;
      case "official/anthropic-sdk":
        requirements.push(
          probeEnvConfiguredBackend({
            backend: candidate.backend,
            envName: "ANTHROPIC_API_KEY",
            sourceNodeIds: candidate.sourceNodeIds,
            models: candidate.models,
            env: options.env,
          }),
        );
        break;
    }
  }

  for (const candidate of collected.containerRunners) {
    requirements.push(await probeContainerRunner(candidate, options));
  }

  if (collected.unsupportedCommandNodeIds.length > 0) {
    requirements.push({
      id: "node-executor:command",
      kind: "node-executor",
      label: "command node execution",
      status: "unsupported",
      detail:
        `command nodes are validated but not executable in the current runtime; ` +
        `nodes=${buildSourceNodeList(collected.unsupportedCommandNodeIds)}`,
      sourceNodeIds: collected.unsupportedCommandNodeIds,
    });
  }

  if (collected.unsupportedContainerNodeIds.length > 0) {
    requirements.push({
      id: "node-executor:container",
      kind: "node-executor",
      label: "container node execution",
      status: "unsupported",
      detail:
        `container nodes are validated but not executable in the current runtime; ` +
        `nodes=${buildSourceNodeList(collected.unsupportedContainerNodeIds)}`,
      sourceNodeIds: collected.unsupportedContainerNodeIds,
    });
  }

  const blockers = requirements
    .filter((requirement) => requirement.status !== "available")
    .map(formatRequirementBlocker);

  return {
    ready: blockers.length === 0,
    checkedAt: nowIso(),
    requirements,
    blockers,
  };
}
