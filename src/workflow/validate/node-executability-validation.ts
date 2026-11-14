import { resolveNodeExecutionBackend } from "../adapters/dispatch";
import {
  asAgentNodePayload,
  getNormalizedNodePayload,
  type NodeExecutionBackend,
  type NodePayload,
  type NormalizedWorkflowBundle,
  type ValidationIssue,
  type WorkflowNodeRegistryRef,
} from "../types";
import {
  probeAgentBackendNodeExecutability,
  type AgentBackendPreflightCandidate,
} from "../runtime-readiness-agent-probes";
import {
  hasInvalidNodeValidationResult,
  NodeValidationResult,
} from "./node-validation-result";
import type { WorkflowValidationOptions } from "./validation-types-and-runtime-options";
import { makeIssue } from "./validation-types-and-runtime-options";

export interface NodeExecutabilityValidationInput {
  readonly bundle: NormalizedWorkflowBundle;
  readonly options: WorkflowValidationOptions;
  readonly addonValidationResults?: readonly NodeValidationResult[];
}

interface RegistryNodeCandidate {
  readonly nodeId: string;
  readonly path: string;
  readonly stepIds: readonly string[];
  readonly payload: NodePayload;
  readonly addonName?: string;
}

function toSortedArray(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function registryNodes(
  bundle: NormalizedWorkflowBundle,
): readonly WorkflowNodeRegistryRef[] {
  return bundle.workflow.nodeRegistry.length > 0
    ? bundle.workflow.nodeRegistry
    : bundle.workflow.nodes;
}

function collectRegistryNodeCandidates(
  bundle: NormalizedWorkflowBundle,
): readonly RegistryNodeCandidate[] {
  return registryNodes(bundle).flatMap((node, index) => {
    const stepIds = toSortedArray(
      bundle.workflow.steps
        .filter((step) => step.nodeId === node.id)
        .map((step) => step.id),
    );
    const payload =
      getNormalizedNodePayload(bundle, node.id) ??
      getNormalizedNodePayload(bundle, stepIds[0] ?? node.id);
    if (payload === undefined) {
      return [];
    }
    return [
      {
        nodeId: node.id,
        path: `workflow.nodes[${index}]`,
        stepIds: stepIds.length === 0 ? [node.id] : stepIds,
        payload,
        ...(node.addon?.name === undefined
          ? {}
          : { addonName: node.addon.name }),
      },
    ];
  });
}

function passiveNodeResult(
  candidate: RegistryNodeCandidate,
  executablePreflight: boolean,
): NodeValidationResult {
  const agentNode = asAgentNodePayload(candidate.payload);
  if (agentNode !== null) {
    const backend = resolveNodeExecutionBackend(agentNode);
    return new NodeValidationResult({
      status: executablePreflight ? "valid" : "unknown",
      message: executablePreflight
        ? `${backend} node payload is structurally valid; active backend preflight results are reported separately`
        : `${backend} backend executability for model '${agentNode.model}' was not actively probed; pass executablePreflight/--executable to check local readiness`,
      nodeId: candidate.nodeId,
      stepIds: candidate.stepIds,
      source: "agent-backend",
      path: candidate.path,
      backend,
    });
  }
  return new NodeValidationResult({
    status: "valid",
    message: "node payload is structurally valid for passive validation",
    nodeId: candidate.nodeId,
    stepIds: candidate.stepIds,
    source: "node",
    path: candidate.path,
    ...(candidate.addonName === undefined
      ? {}
      : { addonName: candidate.addonName }),
  });
}

function buildAgentBackendCandidates(
  candidates: readonly RegistryNodeCandidate[],
): readonly AgentBackendPreflightCandidate[] {
  const grouped = new Map<
    NodeExecutionBackend,
    {
      models: Set<string>;
      nodeIds: Set<string>;
      stepIds: Set<string>;
    }
  >();
  for (const candidate of candidates) {
    const agentNode = asAgentNodePayload(candidate.payload);
    if (agentNode === null) {
      continue;
    }
    const backend = resolveNodeExecutionBackend(agentNode);
    const entry = grouped.get(backend) ?? {
      models: new Set<string>(),
      nodeIds: new Set<string>(),
      stepIds: new Set<string>(),
    };
    entry.models.add(agentNode.model);
    entry.nodeIds.add(candidate.nodeId);
    for (const stepId of candidate.stepIds) {
      entry.stepIds.add(stepId);
    }
    grouped.set(backend, entry);
  }
  return [...grouped.entries()].map(([backend, entry]) => ({
    backend,
    models: entry.models,
    nodeIds: toSortedArray(entry.nodeIds),
    stepIds: toSortedArray(entry.stepIds),
  }));
}

function enrichAddonResults(input: {
  readonly results: readonly NodeValidationResult[];
  readonly candidates: readonly RegistryNodeCandidate[];
}): readonly NodeValidationResult[] {
  return input.results.map((result) => {
    if (result.source !== "addon") {
      return result;
    }
    const candidate = input.candidates.find(
      (entry) =>
        entry.nodeId === result.nodeId ||
        (result.addonName !== undefined &&
          entry.addonName === result.addonName),
    );
    if (candidate === undefined) {
      return result;
    }
    const addonName = result.addonName ?? candidate.addonName;
    return new NodeValidationResult({
      status: result.status,
      message: result.message,
      nodeId: result.nodeId ?? candidate.nodeId,
      stepIds: result.stepIds ?? candidate.stepIds,
      source: result.source,
      path: result.path ?? candidate.path,
      ...(result.backend === undefined ? {} : { backend: result.backend }),
      ...(addonName === undefined ? {} : { addonName }),
    });
  });
}

export async function collectNodeExecutabilityValidation(
  input: NodeExecutabilityValidationInput,
): Promise<readonly NodeValidationResult[]> {
  const candidates = collectRegistryNodeCandidates(input.bundle);
  const results: NodeValidationResult[] = [
    ...collectPassiveNodeExecutabilityValidation(input),
  ];

  if (input.options.executablePreflight !== true) {
    return results;
  }

  for (const candidate of buildAgentBackendCandidates(candidates)) {
    results.push(
      ...(await probeAgentBackendNodeExecutability(candidate, input.options)),
    );
  }

  return results;
}

export function collectPassiveNodeExecutabilityValidation(
  input: NodeExecutabilityValidationInput,
): readonly NodeValidationResult[] {
  const candidates = collectRegistryNodeCandidates(input.bundle);
  return [
    ...candidates.map((candidate) =>
      passiveNodeResult(candidate, input.options.executablePreflight === true),
    ),
    ...enrichAddonResults({
      results: input.addonValidationResults ?? [],
      candidates,
    }),
  ];
}

export function collectBlockingNodeValidationIssues(
  results: readonly NodeValidationResult[],
): readonly ValidationIssue[] {
  if (!hasInvalidNodeValidationResult(results)) {
    return [];
  }
  return results
    .filter((result) => result.status === "invalid")
    .map((result) =>
      makeIssue(
        "error",
        result.path ?? "workflow.nodes",
        `executable validation failed: ${result.message}`,
      ),
    );
}
