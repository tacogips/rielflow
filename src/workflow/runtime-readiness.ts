import { spawn } from "node:child_process";
import path from "node:path";
import { resolveConfiguredEnvValue } from "./adapters/shared";
import { resolveNodeExecutionBackend } from "./adapters/dispatch";
import { effectiveWorkflowCalls } from "./cross-workflow-from-steps";
import { loadWorkflowByIdFromDisk } from "./load";
import {
  MAIL_GATEWAY_ADDON_NAME,
  MAIL_GATEWAY_READ_ADDON_NAME,
  X_GATEWAY_ADDON_NAME,
  X_GATEWAY_READ_ADDON_NAME,
} from "./node-addons";
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
  readonly kind:
    | "agent-backend"
    | "container-runner"
    | "environment-variable"
    | "node-executor"
    | "workflow-feature";
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

interface RequirementProbeOptions extends LoadOptions {
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
  readonly dockerCliRequired?: boolean;
  readonly sourceNodeIds: readonly string[];
}

interface WorkflowCallRequirementCandidate {
  readonly rootWorkflowId: string;
  readonly callIds: readonly string[];
  readonly targetWorkflowIds: readonly string[];
  readonly sourceNodeIds: readonly string[];
}

interface CodeManagerRequirementCandidate {
  readonly sourceNodeIds: readonly string[];
}

interface AddonEnvRequirementCandidate {
  readonly envName: string;
  readonly addonEnvNames: readonly string[];
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
    sourceNodeIds: candidate.sourceNodeIds,
  };
}

async function probeWorkflowCallRuntime(
  candidate: WorkflowCallRequirementCandidate,
  options: LoadOptions,
): Promise<WorkflowRuntimeRequirement> {
  const targetFailures = new Set<string>();
  const loadedWorkflowCalls = new Map<string, readonly string[]>();

  async function visitWorkflowCallTarget(
    workflowId: string,
    chain: readonly string[],
  ): Promise<void> {
    if (chain.includes(workflowId)) {
      targetFailures.add(
        `recursive workflow-call chains are unsupported: ${[...chain, workflowId].join(" -> ")}`,
      );
      return;
    }

    let nextWorkflowIds = loadedWorkflowCalls.get(workflowId);
    if (nextWorkflowIds === undefined) {
      const loaded = await loadWorkflowByIdFromDisk(workflowId, options);
      if (!loaded.ok) {
        targetFailures.add(`${workflowId}: ${loaded.error.message}`);
        return;
      }
      nextWorkflowIds = toSortedArray(
        effectiveWorkflowCalls(loaded.value.bundle.workflow).map(
          (call) => call.workflowId,
        ),
      );
      loadedWorkflowCalls.set(workflowId, nextWorkflowIds);
    }

    for (const nextWorkflowId of nextWorkflowIds) {
      await visitWorkflowCallTarget(nextWorkflowId, [...chain, workflowId]);
    }
  }

  for (const workflowId of candidate.targetWorkflowIds) {
    await visitWorkflowCallTarget(workflowId, [candidate.rootWorkflowId]);
  }

  return {
    id: "workflow-feature:workflowCalls",
    kind: "workflow-feature",
    label: "workflow-call execution",
    status: targetFailures.size === 0 ? "available" : "unavailable",
    detail:
      targetFailures.size === 0
        ? `runtime workflow-call execution is available; calls=${candidate.callIds.join(", ")}; targetWorkflows=${candidate.targetWorkflowIds.join(", ")}`
        : `workflow-call targets must resolve to loadable, non-recursive workflows; failures=${[...targetFailures].join(" | ")}; calls=${candidate.callIds.join(", ")}`,
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

function probeRequiredAddonEnv(
  candidate: AddonEnvRequirementCandidate,
  env: Readonly<Record<string, string | undefined>> | undefined,
): WorkflowRuntimeRequirement {
  const value = resolveConfiguredEnvValue(undefined, candidate.envName, env);
  const addonEnvSummary = candidate.addonEnvNames.join(", ");
  return {
    id: `environment-variable:addon:${candidate.envName}`,
    kind: "environment-variable",
    label: `${candidate.envName} add-on environment source`,
    status: value === undefined ? "unavailable" : "available",
    detail:
      value === undefined
        ? `required add-on environment source ${candidate.envName} is not set; addonEnv=${addonEnvSummary}`
        : `required add-on environment source ${candidate.envName} is configured; addonEnv=${addonEnvSummary}`,
    sourceNodeIds: candidate.sourceNodeIds,
  };
}

async function probeContainerRunner(
  candidate: ContainerRunnerRequirementCandidate,
  options: Pick<RequirementProbeOptions, "cwd" | "env">,
): Promise<WorkflowRuntimeRequirement> {
  if (
    candidate.dockerCliRequired === true &&
    !isDockerCliContainerRunner(candidate.runnerKind)
  ) {
    return {
      id: buildContainerRunnerRequirementId(candidate),
      kind: "container-runner",
      label: `${candidate.runnerKind} container runner`,
      status: "unsupported",
      detail: `runner kind '${candidate.runnerKind}' is not supported for Docker-compatible add-on execution`,
      sourceNodeIds: candidate.sourceNodeIds,
    };
  }

  const command = candidate.runnerPath ?? candidate.runnerKind;
  const versionResult = await runCommand(command, ["--version"], options);
  return {
    id: buildContainerRunnerRequirementId(candidate),
    kind: "container-runner",
    label: `${candidate.runnerKind} container runner`,
    status: versionResult.ok ? "available" : "unavailable",
    detail: versionResult.ok
      ? `runner ${command} is available`
      : `runner ${command} is unavailable: ${versionResult.message ?? "unknown error"}`,
    sourceNodeIds: candidate.sourceNodeIds,
  };
}

function probeCodeManagerRuntime(
  candidate: CodeManagerRequirementCandidate,
): WorkflowRuntimeRequirement {
  return {
    id: "workflow-feature:code-manager-runtime",
    kind: "workflow-feature",
    label: "code-manager runtime",
    status: "unsupported",
    detail:
      "managerType='code' execution is not available on the current runtime path yet; " +
      `nodes=${buildSourceNodeList(candidate.sourceNodeIds)}`,
    sourceNodeIds: candidate.sourceNodeIds,
  };
}

function isDockerCliContainerRunner(
  runnerKind: ContainerRunnerKind,
): runnerKind is "podman" | "docker" | "nerdctl" {
  return (
    runnerKind === "podman" ||
    runnerKind === "docker" ||
    runnerKind === "nerdctl"
  );
}

function buildContainerRunnerRequirementId(
  candidate: ContainerRunnerRequirementCandidate,
): string {
  return [
    "container-runner",
    candidate.runnerKind,
    candidate.runnerPath ?? "default",
    ...(candidate.dockerCliRequired === true ? ["docker-cli"] : []),
  ].join(":");
}

function addContainerRunnerCandidate(
  candidates: Map<
    string,
    {
      runnerKind: ContainerRunnerKind;
      runnerPath?: string;
      dockerCliRequired?: boolean;
      nodeIds: Set<string>;
    }
  >,
  input: {
    readonly nodeId: string;
    readonly runnerKind: ContainerRunnerKind;
    readonly runnerPath?: string;
    readonly dockerCliRequired?: boolean;
  },
): void {
  const key = buildContainerRunnerRequirementId({
    runnerKind: input.runnerKind,
    ...(input.runnerPath === undefined ? {} : { runnerPath: input.runnerPath }),
    ...(input.dockerCliRequired === true ? { dockerCliRequired: true } : {}),
    sourceNodeIds: [],
  });
  const existing = candidates.get(key) ?? {
    runnerKind: input.runnerKind,
    ...(input.runnerPath === undefined ? {} : { runnerPath: input.runnerPath }),
    ...(input.dockerCliRequired === true ? { dockerCliRequired: true } : {}),
    nodeIds: new Set<string>(),
  };
  existing.nodeIds.add(input.nodeId);
  candidates.set(key, existing);
}

function collectRequirements(
  bundle: NormalizedWorkflowBundle,
  onlyNodeIds: ReadonlySet<string> | undefined,
): {
  readonly agentBackends: readonly AgentBackendRequirementCandidate[];
  readonly containerRunners: readonly ContainerRunnerRequirementCandidate[];
  readonly addonEnvSources: readonly AddonEnvRequirementCandidate[];
  readonly codeManager?: CodeManagerRequirementCandidate;
  readonly workflowCall?: WorkflowCallRequirementCandidate;
  readonly commandNodeIds: readonly string[];
  readonly containerNodeIds: readonly string[];
} {
  const agentBackends = new Map<
    NodeExecutionBackend,
    { nodeIds: Set<string>; models: Set<string> }
  >();
  const containerRunners = new Map<
    string,
    {
      runnerKind: ContainerRunnerKind;
      runnerPath?: string;
      dockerCliRequired?: boolean;
      nodeIds: Set<string>;
    }
  >();
  const addonEnvSources = new Map<
    string,
    {
      addonEnvNames: Set<string>;
      nodeIds: Set<string>;
    }
  >();
  const codeManagerNodeIds = new Set<string>();
  const commandNodeIds = new Set<string>();
  const containerNodeIds = new Set<string>();
  const defaults = bundle.workflow.defaults.containerRuntime;
  const relevantWorkflowCalls = effectiveWorkflowCalls(bundle.workflow).filter(
    (call) => onlyNodeIds === undefined || onlyNodeIds.has(call.callerNodeId),
  );

  for (const nodeRef of bundle.workflow.nodes) {
    const nodeId = nodeRef.id;
    if (onlyNodeIds !== undefined && !onlyNodeIds.has(nodeId)) {
      continue;
    }

    const node =
      bundle.nodePayloads[nodeId] ??
      bundle.nodePayloads[nodeRef.nodeFile] ??
      null;
    if (node === null) {
      continue;
    }

    const agentNode = asAgentNodePayload(node);
    if (agentNode !== null) {
      if (
        agentNode.managerType === "code" &&
        agentNode.executionBackend === undefined
      ) {
        codeManagerNodeIds.add(nodeId);
        continue;
      }

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

    if (node.managerType === "code") {
      codeManagerNodeIds.add(nodeId);
      continue;
    }

    if (node.nodeType === "command") {
      commandNodeIds.add(nodeId);
      continue;
    }

    if (node.nodeType === "container") {
      containerNodeIds.add(nodeId);
      const runnerKind =
        node.container?.runnerKind ??
        defaults?.runnerKind ??
        DEFAULT_CONTAINER_RUNNER_KIND;
      const runnerPath = node.container?.runnerPath ?? defaults?.runnerPath;
      addContainerRunnerCandidate(containerRunners, {
        nodeId,
        runnerKind,
        ...(runnerPath === undefined ? {} : { runnerPath }),
      });
      continue;
    }

    if (
      node.addon?.name === X_GATEWAY_READ_ADDON_NAME ||
      node.addon?.name === X_GATEWAY_ADDON_NAME ||
      node.addon?.name === MAIL_GATEWAY_READ_ADDON_NAME ||
      node.addon?.name === MAIL_GATEWAY_ADDON_NAME
    ) {
      const runnerKind =
        node.addon.config.runnerKind ??
        defaults?.runnerKind ??
        DEFAULT_CONTAINER_RUNNER_KIND;
      const runnerPath = node.addon.config.runnerPath ?? defaults?.runnerPath;
      addContainerRunnerCandidate(containerRunners, {
        nodeId,
        runnerKind,
        ...(runnerPath === undefined ? {} : { runnerPath }),
        dockerCliRequired: true,
      });

      for (const [addonEnvName, binding] of Object.entries(
        node.addon.env ?? {},
      )) {
        if (binding.required === false) {
          continue;
        }
        const existing = addonEnvSources.get(binding.fromEnv) ?? {
          addonEnvNames: new Set<string>(),
          nodeIds: new Set<string>(),
        };
        existing.addonEnvNames.add(addonEnvName);
        existing.nodeIds.add(nodeId);
        addonEnvSources.set(binding.fromEnv, existing);
      }
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
      ...(entry.runnerPath === undefined
        ? {}
        : { runnerPath: entry.runnerPath }),
      ...(entry.dockerCliRequired === true ? { dockerCliRequired: true } : {}),
      sourceNodeIds: toSortedArray(entry.nodeIds),
    })),
    addonEnvSources: [...addonEnvSources.entries()].map(([envName, entry]) => ({
      envName,
      addonEnvNames: toSortedArray(entry.addonEnvNames),
      sourceNodeIds: toSortedArray(entry.nodeIds),
    })),
    ...(codeManagerNodeIds.size === 0
      ? {}
      : {
          codeManager: {
            sourceNodeIds: toSortedArray(codeManagerNodeIds),
          },
        }),
    ...(relevantWorkflowCalls.length === 0
      ? {}
      : {
          workflowCall: {
            rootWorkflowId: bundle.workflow.workflowId,
            callIds: relevantWorkflowCalls.map((call) => call.id),
            targetWorkflowIds: toSortedArray(
              relevantWorkflowCalls.map((call) => call.workflowId),
            ),
            sourceNodeIds: toSortedArray(
              relevantWorkflowCalls.map((call) => call.callerNodeId),
            ),
          },
        }),
    commandNodeIds: toSortedArray(commandNodeIds),
    containerNodeIds: toSortedArray(containerNodeIds),
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

  for (const candidate of collected.addonEnvSources) {
    requirements.push(probeRequiredAddonEnv(candidate, options.env));
  }

  if (collected.codeManager !== undefined) {
    requirements.push(probeCodeManagerRuntime(collected.codeManager));
  }

  if (collected.workflowCall !== undefined) {
    requirements.push(
      await probeWorkflowCallRuntime(collected.workflowCall, options),
    );
  }

  if (collected.commandNodeIds.length > 0) {
    requirements.push({
      id: "node-executor:command",
      kind: "node-executor",
      label: "command node execution",
      status: "available",
      detail:
        `command node execution is built into the local runtime; ` +
        `nodes=${buildSourceNodeList(collected.commandNodeIds)}`,
      sourceNodeIds: collected.commandNodeIds,
    });
  }

  if (collected.containerNodeIds.length > 0) {
    requirements.push({
      id: "node-executor:container",
      kind: "node-executor",
      label: "container node execution",
      status: "available",
      detail:
        `container node execution is built into the local runtime; ` +
        `nodes=${buildSourceNodeList(collected.containerNodeIds)}`,
      sourceNodeIds: collected.containerNodeIds,
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
