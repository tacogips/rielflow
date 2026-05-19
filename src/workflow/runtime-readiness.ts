import { resolveConfiguredEnvValue } from "./adapters/shared";
import { resolveNodeExecutionBackend } from "./adapters/dispatch";
import { effectiveCrossWorkflowDispatches } from "./cross-workflow-from-steps";
import { loadWorkflowByIdFromDisk } from "./load";
import {
  asAgentNodePayload,
  DEFAULT_CONTAINER_RUNNER_KIND,
  type ContainerRunnerKind,
  getNormalizedNodePayload,
  type LoadOptions,
  type NodeExecutionBackend,
  type NormalizedWorkflowBundle,
} from "./types";
import {
  probeClaudeBackend,
  probeCodexBackend,
  probeCursorBackend,
  runCommand,
  type AgentBackendRequirementCandidate,
} from "./runtime-readiness-agent-probes";

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
  readonly sourceStepIds: readonly string[];
}

export interface WorkflowRuntimeReadiness {
  readonly ready: boolean;
  readonly checkedAt: string;
  readonly requirements: readonly WorkflowRuntimeRequirement[];
  readonly blockers: readonly string[];
}

/**
 * Stable `WorkflowRuntimeRequirement.id` for cross-workflow dispatch readiness
 * (targets derived from `steps[].transitions`, not authored `workflow.workflowCalls`).
 */
export const WORKFLOW_RUNTIME_REQUIREMENT_CROSS_WORKFLOW_DISPATCH_ID =
  "workflow-feature:crossWorkflowDispatches" as const;

interface RequirementProbeOptions extends LoadOptions {
  readonly onlyStepIds?: ReadonlySet<string>;
}

interface RequirementSelection {
  readonly onlyStepIds?: ReadonlySet<string>;
}

interface ContainerRunnerRequirementCandidate {
  readonly runnerKind: ContainerRunnerKind;
  readonly runnerPath?: string;
  readonly dockerCliRequired?: boolean;
  readonly sourceStepIds: readonly string[];
}

interface CrossWorkflowDispatchRequirementCandidate {
  readonly rootWorkflowId: string;
  readonly callIds: readonly string[];
  readonly targetWorkflowIds: readonly string[];
  readonly sourceStepIds: readonly string[];
}

interface CodeManagerRequirementCandidate {
  readonly sourceStepIds: readonly string[];
}

interface AddonEnvRequirementCandidate {
  readonly envName: string;
  readonly addonEnvNames: readonly string[];
  readonly sourceStepIds: readonly string[];
}

interface ReadinessAddonEnvBinding {
  readonly fromEnv: string;
  readonly required?: boolean | undefined;
}

interface ReadinessGatewayAddon {
  readonly name: string;
  readonly config: {
    readonly runnerKind?: ContainerRunnerKind | undefined;
    readonly runnerPath?: string | undefined;
  };
  readonly env?: Readonly<Record<string, ReadinessAddonEnvBinding>> | undefined;
}

const BUILTIN_ADDON_NAMESPACE = "divedra";
const GATEWAY_ADDON_FAMILIES = ["x", "mail"] as const;
const GATEWAY_ADDON_SUFFIXES = ["gateway", "gateway-read"] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function toSortedArray(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function buildSourceStepList(sourceStepIds: readonly string[]): string {
  return sourceStepIds.join(", ");
}

function formatRequirementBlocker(
  requirement: WorkflowRuntimeRequirement,
): string {
  return `${requirement.label}: ${requirement.detail}`;
}

async function probeCrossWorkflowDispatchRuntime(
  candidate: CrossWorkflowDispatchRequirementCandidate,
  options: LoadOptions,
): Promise<WorkflowRuntimeRequirement> {
  const targetFailures = new Set<string>();
  const loadedCalleeTargetsByWorkflowId = new Map<string, readonly string[]>();

  async function visitCrossWorkflowDispatchTarget(
    workflowId: string,
    chain: readonly string[],
  ): Promise<void> {
    if (chain.includes(workflowId)) {
      targetFailures.add(
        `recursive cross-workflow dispatch chains are unsupported: ${[...chain, workflowId].join(" -> ")}`,
      );
      return;
    }

    let nextWorkflowIds = loadedCalleeTargetsByWorkflowId.get(workflowId);
    if (nextWorkflowIds === undefined) {
      const loaded = await loadWorkflowByIdFromDisk(workflowId, options);
      if (!loaded.ok) {
        targetFailures.add(`${workflowId}: ${loaded.error.message}`);
        return;
      }
      nextWorkflowIds = toSortedArray(
        effectiveCrossWorkflowDispatches(loaded.value.bundle.workflow).map(
          (call) => call.workflowId,
        ),
      );
      loadedCalleeTargetsByWorkflowId.set(workflowId, nextWorkflowIds);
    }

    for (const nextWorkflowId of nextWorkflowIds) {
      await visitCrossWorkflowDispatchTarget(nextWorkflowId, [
        ...chain,
        workflowId,
      ]);
    }
  }

  for (const workflowId of candidate.targetWorkflowIds) {
    await visitCrossWorkflowDispatchTarget(workflowId, [
      candidate.rootWorkflowId,
    ]);
  }

  return {
    id: WORKFLOW_RUNTIME_REQUIREMENT_CROSS_WORKFLOW_DISPATCH_ID,
    kind: "workflow-feature",
    label: "cross-workflow dispatch",
    status: targetFailures.size === 0 ? "available" : "unavailable",
    detail:
      targetFailures.size === 0
        ? `runtime cross-workflow dispatch is available; calls=${candidate.callIds.join(", ")}; targetWorkflows=${candidate.targetWorkflowIds.join(", ")}`
        : `cross-workflow dispatch targets must resolve to loadable, non-recursive workflows; failures=${[...targetFailures].join(" | ")}; calls=${candidate.callIds.join(", ")}`,
    sourceStepIds: candidate.sourceStepIds,
  };
}

function probeEnvConfiguredBackend(input: {
  readonly backend: "official/openai-sdk" | "official/anthropic-sdk";
  readonly envName: string;
  readonly sourceStepIds: readonly string[];
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
    sourceStepIds: input.sourceStepIds,
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
    sourceStepIds: candidate.sourceStepIds,
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
      sourceStepIds: candidate.sourceStepIds,
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
    sourceStepIds: candidate.sourceStepIds,
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
      `steps=${buildSourceStepList(candidate.sourceStepIds)}`,
    sourceStepIds: candidate.sourceStepIds,
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGatewayReadinessAddonName(name: string): boolean {
  const [namespace, addonName] = name.split("/");
  if (namespace !== BUILTIN_ADDON_NAMESPACE || addonName === undefined) {
    return false;
  }
  return GATEWAY_ADDON_FAMILIES.some((family) =>
    GATEWAY_ADDON_SUFFIXES.some(
      (suffix) => addonName === `${family}-${suffix}`,
    ),
  );
}

function isGatewayReadinessAddon(
  addon: unknown,
): addon is ReadinessGatewayAddon {
  if (!isRecord(addon) || typeof addon["name"] !== "string") {
    return false;
  }
  return (
    isGatewayReadinessAddonName(addon["name"]) && isRecord(addon["config"])
  );
}

function addContainerRunnerCandidate(
  candidates: Map<
    string,
    {
      runnerKind: ContainerRunnerKind;
      runnerPath?: string;
      dockerCliRequired?: boolean;
      stepIds: Set<string>;
    }
  >,
  input: {
    readonly stepId: string;
    readonly runnerKind: ContainerRunnerKind;
    readonly runnerPath?: string;
    readonly dockerCliRequired?: boolean;
  },
): void {
  const key = buildContainerRunnerRequirementId({
    runnerKind: input.runnerKind,
    ...(input.runnerPath === undefined ? {} : { runnerPath: input.runnerPath }),
    ...(input.dockerCliRequired === true ? { dockerCliRequired: true } : {}),
    sourceStepIds: [],
  });
  const existing = candidates.get(key) ?? {
    runnerKind: input.runnerKind,
    ...(input.runnerPath === undefined ? {} : { runnerPath: input.runnerPath }),
    ...(input.dockerCliRequired === true ? { dockerCliRequired: true } : {}),
    stepIds: new Set<string>(),
  };
  existing.stepIds.add(input.stepId);
  candidates.set(key, existing);
}

function collectRequirements(
  bundle: NormalizedWorkflowBundle,
  selection: RequirementSelection,
): {
  readonly agentBackends: readonly AgentBackendRequirementCandidate[];
  readonly containerRunners: readonly ContainerRunnerRequirementCandidate[];
  readonly addonEnvSources: readonly AddonEnvRequirementCandidate[];
  readonly codeManager?: CodeManagerRequirementCandidate;
  readonly crossWorkflowDispatch?: CrossWorkflowDispatchRequirementCandidate;
  readonly commandStepIds: readonly string[];
  readonly containerStepIds: readonly string[];
} {
  const agentBackends = new Map<
    NodeExecutionBackend,
    { stepIds: Set<string>; models: Set<string> }
  >();
  const containerRunners = new Map<
    string,
    {
      runnerKind: ContainerRunnerKind;
      runnerPath?: string;
      dockerCliRequired?: boolean;
      stepIds: Set<string>;
    }
  >();
  const addonEnvSources = new Map<
    string,
    {
      addonEnvNames: Set<string>;
      stepIds: Set<string>;
    }
  >();
  const codeManagerStepIds = new Set<string>();
  const commandStepIds = new Set<string>();
  const containerStepIds = new Set<string>();
  const defaults = bundle.workflow.defaults.containerRuntime;
  const relevantCrossWorkflowDispatches = effectiveCrossWorkflowDispatches(
    bundle.workflow,
  ).filter(
    (dispatch) =>
      selection.onlyStepIds === undefined ||
      selection.onlyStepIds.has(dispatch.callerStepId),
  );

  for (const nodeRef of bundle.workflow.nodes) {
    const stepId = nodeRef.id;
    if (
      selection.onlyStepIds !== undefined &&
      !selection.onlyStepIds.has(stepId)
    ) {
      continue;
    }

    const node = getNormalizedNodePayload(bundle, stepId) ?? null;
    if (node === null) {
      continue;
    }

    const agentNode = asAgentNodePayload(node);
    if (agentNode !== null) {
      if (
        agentNode.managerType === "code" &&
        agentNode.executionBackend === undefined
      ) {
        codeManagerStepIds.add(stepId);
        continue;
      }

      const backend = resolveNodeExecutionBackend(agentNode);
      const existing = agentBackends.get(backend) ?? {
        stepIds: new Set<string>(),
        models: new Set<string>(),
      };
      existing.stepIds.add(stepId);
      existing.models.add(agentNode.model);
      agentBackends.set(backend, existing);
      continue;
    }

    if (node.managerType === "code") {
      codeManagerStepIds.add(stepId);
      continue;
    }

    if (node.nodeType === "command") {
      commandStepIds.add(stepId);
      continue;
    }

    if (node.nodeType === "container") {
      containerStepIds.add(stepId);
      const runnerKind =
        node.container?.runnerKind ??
        defaults?.runnerKind ??
        DEFAULT_CONTAINER_RUNNER_KIND;
      const runnerPath = node.container?.runnerPath ?? defaults?.runnerPath;
      addContainerRunnerCandidate(containerRunners, {
        stepId,
        runnerKind,
        ...(runnerPath === undefined ? {} : { runnerPath }),
      });
      continue;
    }

    if (isGatewayReadinessAddon(node.addon)) {
      const runnerKind =
        node.addon.config.runnerKind ??
        defaults?.runnerKind ??
        DEFAULT_CONTAINER_RUNNER_KIND;
      const runnerPath = node.addon.config.runnerPath ?? defaults?.runnerPath;
      addContainerRunnerCandidate(containerRunners, {
        stepId,
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
          stepIds: new Set<string>(),
        };
        existing.addonEnvNames.add(addonEnvName);
        existing.stepIds.add(stepId);
        addonEnvSources.set(binding.fromEnv, existing);
      }
    }
  }

  return {
    agentBackends: [...agentBackends.entries()].map(([backend, entry]) => ({
      backend,
      models: entry.models,
      sourceStepIds: toSortedArray(entry.stepIds),
    })),
    containerRunners: [...containerRunners.values()].map((entry) => ({
      runnerKind: entry.runnerKind,
      ...(entry.runnerPath === undefined
        ? {}
        : { runnerPath: entry.runnerPath }),
      ...(entry.dockerCliRequired === true ? { dockerCliRequired: true } : {}),
      sourceStepIds: toSortedArray(entry.stepIds),
    })),
    addonEnvSources: [...addonEnvSources.entries()].map(([envName, entry]) => ({
      envName,
      addonEnvNames: toSortedArray(entry.addonEnvNames),
      sourceStepIds: toSortedArray(entry.stepIds),
    })),
    ...(codeManagerStepIds.size === 0
      ? {}
      : {
          codeManager: {
            sourceStepIds: toSortedArray(codeManagerStepIds),
          },
        }),
    ...(relevantCrossWorkflowDispatches.length === 0
      ? {}
      : {
          crossWorkflowDispatch: {
            rootWorkflowId: bundle.workflow.workflowId,
            callIds: relevantCrossWorkflowDispatches.map((d) => d.id),
            targetWorkflowIds: toSortedArray(
              relevantCrossWorkflowDispatches.map((d) => d.workflowId),
            ),
            sourceStepIds: toSortedArray(
              relevantCrossWorkflowDispatches.map((d) => d.callerStepId),
            ),
          },
        }),
    commandStepIds: toSortedArray(commandStepIds),
    containerStepIds: toSortedArray(containerStepIds),
  };
}

export async function inspectWorkflowRuntimeReadiness(
  bundle: NormalizedWorkflowBundle,
  options: RequirementProbeOptions = {},
): Promise<WorkflowRuntimeReadiness> {
  const collected = collectRequirements(bundle, options);
  const requirements: WorkflowRuntimeRequirement[] = [];

  for (const candidate of collected.agentBackends) {
    switch (candidate.backend) {
      case "codex-agent":
        requirements.push(await probeCodexBackend(candidate, options));
        break;
      case "claude-code-agent":
        requirements.push(await probeClaudeBackend(candidate, options));
        break;
      case "cursor-cli-agent":
        requirements.push(await probeCursorBackend(candidate, options));
        break;
      case "official/openai-sdk":
        requirements.push(
          probeEnvConfiguredBackend({
            backend: candidate.backend,
            envName: "OPENAI_API_KEY",
            sourceStepIds: candidate.sourceStepIds,
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
            sourceStepIds: candidate.sourceStepIds,
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

  if (collected.crossWorkflowDispatch !== undefined) {
    requirements.push(
      await probeCrossWorkflowDispatchRuntime(
        collected.crossWorkflowDispatch,
        options,
      ),
    );
  }

  if (collected.commandStepIds.length > 0) {
    requirements.push({
      id: "node-executor:command",
      kind: "node-executor",
      label: "command node execution",
      status: "available",
      detail:
        `command node execution is built into the local runtime; ` +
        `steps=${buildSourceStepList(collected.commandStepIds)}`,
      sourceStepIds: collected.commandStepIds,
    });
  }

  if (collected.containerStepIds.length > 0) {
    requirements.push({
      id: "node-executor:container",
      kind: "node-executor",
      label: "container node execution",
      status: "available",
      detail:
        `container node execution is built into the local runtime; ` +
        `steps=${buildSourceStepList(collected.containerStepIds)}`,
      sourceStepIds: collected.containerStepIds,
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
