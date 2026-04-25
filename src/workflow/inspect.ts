import type { LoadedWorkflow } from "./load";
import {
  collectWorkflowAddonSourceSummaries,
  type WorkflowAddonSourceSummary,
} from "./addon-source-summary";
import { effectiveWorkflowCalls } from "./cross-workflow-from-steps";
import {
  inspectWorkflowRuntimeReadiness,
  type WorkflowRuntimeReadiness,
} from "./runtime-readiness";
import { collectWorkflowRevisionNodeFiles } from "./revision";
import type { SupervisionSummary, LoadOptions } from "./types";
import type { WorkflowSessionState } from "./session";

export interface WorkflowStructuralProjectionCounts {
  readonly nodes: number;
  readonly edges: number;
  readonly loops: number;
}

/**
 * For legacy node-ordered bundles, `nodes`, `edges`, and `loops` are the
 * primary structural counts. For step-addressed bundles (authored `steps[]`),
 * the primary contract uses `steps` and `nodeRegistry` instead; the runtime
 * graph sizes are reported only under `structuralProjection`.
 */
export interface WorkflowInspectionCounts {
  readonly steps: number;
  readonly nodeRegistry: number;
  readonly workflowCalls: number;
  readonly legacySubWorkflows: number;
  /** Legacy (non-step-addressed) bundles only. Omitted for step-addressed. */
  readonly nodes?: number;
  readonly edges?: number;
  readonly loops?: number;
  /** Step-addressed bundles only: internal runtime graph projection sizes. */
  readonly structuralProjection?: WorkflowStructuralProjectionCounts;
}

export interface WorkflowInspectionSummary {
  readonly workflowName: string;
  readonly workflowId: string;
  readonly description: string;
  readonly hasManagerNode: boolean;
  /** Legacy (non-step-addressed) bundles: workflow manager node id. Omitted for step-addressed. */
  readonly managerNodeId?: string;
  /** Legacy (non-step-addressed) bundles: entry node id. Omitted for step-addressed. */
  readonly entryNodeId?: string;
  readonly managerStepId?: string;
  readonly entryStepId?: string;
  readonly stepIds: readonly string[];
  readonly nodeRegistryIds: readonly string[];
  readonly workflowCallIds: readonly string[];
  readonly compatibility: {
    readonly normalizesRoleAuthoredNodesToStructuralKinds: boolean;
    readonly usesEffectiveEntryManagerNodeId: boolean;
    readonly usesLegacyStructuralSubWorkflows: boolean;
    readonly notes: readonly string[];
  };
  readonly defaults: {
    readonly maxLoopIterations: number;
    readonly nodeTimeoutMs: number;
  };
  readonly counts: WorkflowInspectionCounts;
  readonly nodeFiles: readonly string[];
  readonly workflowDirectory: string;
  readonly artifactWorkflowRoot: string;
  readonly addonSources: readonly WorkflowAddonSourceSummary[];
  readonly runtime: WorkflowRuntimeReadiness;
}

export async function buildInspectionSummary(
  loaded: LoadedWorkflow,
  options: LoadOptions = {},
): Promise<WorkflowInspectionSummary> {
  const workflow = loaded.bundle.workflow;
  const isStepAddressed = workflow.steps !== undefined;
  const stepIds = workflow.steps?.map((step) => step.id) ?? [];
  const nodeRegistryIds = workflow.nodeRegistry?.map((node) => node.id) ?? [];
  const hasManagerNode = workflow.hasManagerNode !== false;
  const usesRoleAuthoredNodes =
    workflow.steps?.some((step) => step.role !== undefined) ??
    workflow.nodes.some(
      (node) => node.role !== undefined || node.control !== undefined,
    );
  const usesEffectiveEntryManagerNodeId = !hasManagerNode;
  const usesLegacyStructuralSubWorkflows = workflow.subWorkflows.length > 0;
  const compatibilityNotes = [
    ...(usesRoleAuthoredNodes
      ? [
          "Role-authored nodes still normalize to structural runtime kinds internally for execution compatibility.",
        ]
      : []),
    ...(!isStepAddressed && usesEffectiveEntryManagerNodeId
      ? [
          "Worker-only workflows normalize entryNodeId to an internal effective managerNodeId during runtime execution.",
        ]
      : []),
    ...(usesLegacyStructuralSubWorkflows
      ? [
          "Legacy structural subWorkflows remain active for this bundle; prefer step-addressed cross-workflow transitions (steps[].transitions with toWorkflowId and resumeStepId) or explicit workflowCalls when migrating away from structural sub-workflows.",
        ]
      : []),
  ];
  const nodeRegistryCount =
    workflow.nodeRegistry === undefined
      ? workflow.nodes.length
      : workflow.nodeRegistry.length;
  const stepCount = workflow.steps?.length ?? workflow.nodes.length;
  const edgeCount = workflow.edges.length;
  const loopCount = workflow.loops?.length ?? 0;
  const structuralGraphCounts: WorkflowStructuralProjectionCounts = {
    nodes: workflow.nodes.length,
    edges: edgeCount,
    loops: loopCount,
  };
  const effectiveCalls = effectiveWorkflowCalls(workflow);
  return {
    workflowName: loaded.workflowName,
    workflowId: workflow.workflowId,
    description: workflow.description,
    hasManagerNode,
    ...(!isStepAddressed && hasManagerNode
      ? { managerNodeId: workflow.managerNodeId }
      : {}),
    ...(!isStepAddressed
      ? { entryNodeId: workflow.entryNodeId ?? workflow.managerNodeId }
      : {}),
    ...(workflow.managerStepId === undefined
      ? {}
      : { managerStepId: workflow.managerStepId }),
    ...(workflow.entryStepId === undefined
      ? {}
      : { entryStepId: workflow.entryStepId }),
    stepIds,
    nodeRegistryIds,
    workflowCallIds: effectiveCalls.map((call) => call.id),
    compatibility: {
      normalizesRoleAuthoredNodesToStructuralKinds: usesRoleAuthoredNodes,
      usesEffectiveEntryManagerNodeId,
      usesLegacyStructuralSubWorkflows,
      notes: compatibilityNotes,
    },
    defaults: {
      maxLoopIterations: workflow.defaults.maxLoopIterations,
      nodeTimeoutMs: workflow.defaults.nodeTimeoutMs,
    },
    counts: isStepAddressed
      ? {
          steps: stepCount,
          nodeRegistry: nodeRegistryCount,
          workflowCalls: effectiveCalls.length,
          legacySubWorkflows: workflow.subWorkflows.length,
          structuralProjection: structuralGraphCounts,
        }
      : {
          steps: stepCount,
          nodeRegistry: nodeRegistryCount,
          nodes: workflow.nodes.length,
          edges: edgeCount,
          loops: loopCount,
          workflowCalls: effectiveCalls.length,
          legacySubWorkflows: workflow.subWorkflows.length,
        },
    nodeFiles: collectWorkflowRevisionNodeFiles(workflow),
    workflowDirectory: loaded.workflowDirectory,
    artifactWorkflowRoot: loaded.artifactWorkflowRoot,
    addonSources: await collectWorkflowAddonSourceSummaries({
      workflow,
      options,
      ...(loaded.source === undefined ? {} : { workflowSource: loaded.source }),
    }),
    runtime: await inspectWorkflowRuntimeReadiness(loaded.bundle, options),
  };
}

/**
 * Returns a compact supervision snapshot when the session carries auto-improve state.
 */
export function getSupervisionSummary(
  session: WorkflowSessionState,
): SupervisionSummary | undefined {
  const run = session.supervision;
  if (run === undefined) {
    return undefined;
  }
  const lastIncident = run.incidents[run.incidents.length - 1];
  const rem = run.remediations;
  const lastRemediation =
    rem === undefined || rem.length === 0 ? undefined : rem[rem.length - 1];
  return {
    supervisionRunId: run.supervisionRunId,
    targetWorkflowId: run.targetWorkflowId,
    superviserWorkflowId: run.superviserWorkflowId,
    status: run.status,
    attemptCount: run.attemptCount,
    workflowPatchCount: run.workflowPatchCount,
    ...(lastIncident === undefined
      ? {}
      : { latestIncidentId: lastIncident.incidentId }),
    ...(lastRemediation === undefined
      ? {}
      : { latestRemediationId: lastRemediation.remediationId }),
    ...(run.mutableWorkflowDir === undefined
      ? {}
      : { mutableWorkflowDir: run.mutableWorkflowDir }),
  };
}
