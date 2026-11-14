import type { LoadedWorkflow } from "./load";
import {
  collectWorkflowAddonSourceSummaries,
  type WorkflowAddonSourceSummary,
} from "./addon-source-summary";
import {
  inspectWorkflowRuntimeReadiness,
  type WorkflowRuntimeReadiness,
} from "./runtime-readiness";
import { collectWorkflowRevisionNodeFiles } from "./revision";
import type { LoadOptions } from "./types";

export interface WorkflowInspectionSummary {
  readonly workflowName: string;
  readonly workflowId: string;
  readonly description: string;
  readonly hasManagerNode: boolean;
  readonly managerNodeId?: string;
  readonly entryNodeId: string;
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
  readonly counts: {
    readonly nodes: number;
    readonly edges: number;
    readonly loops: number;
    readonly workflowCalls: number;
    readonly legacySubWorkflows: number;
  };
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
  const hasManagerNode = workflow.hasManagerNode !== false;
  const usesRoleAuthoredNodes = workflow.nodes.some(
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
    ...(usesEffectiveEntryManagerNodeId
      ? [
          "Worker-only workflows normalize entryNodeId to an internal effective managerNodeId during runtime execution.",
        ]
      : []),
    ...(usesLegacyStructuralSubWorkflows
      ? [
          "Legacy structural subWorkflows remain active for this bundle; explicit workflowCalls are the preferred cross-workflow invocation path for role-authored workflows.",
        ]
      : []),
  ];
  return {
    workflowName: loaded.workflowName,
    workflowId: workflow.workflowId,
    description: workflow.description,
    hasManagerNode,
    ...(hasManagerNode ? { managerNodeId: workflow.managerNodeId } : {}),
    entryNodeId: workflow.entryNodeId ?? workflow.managerNodeId,
    workflowCallIds: (workflow.workflowCalls ?? []).map((call) => call.id),
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
    counts: {
      nodes: workflow.nodes.length,
      edges: workflow.edges.length,
      loops: workflow.loops?.length ?? 0,
      workflowCalls: workflow.workflowCalls?.length ?? 0,
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
