import type { LoadedWorkflow } from "./load";
import {
  inspectWorkflowRuntimeReadiness,
  type WorkflowRuntimeReadiness,
} from "./runtime-readiness";
import type { LoadOptions } from "./types";

export interface WorkflowInspectionSummary {
  readonly workflowName: string;
  readonly workflowId: string;
  readonly description: string;
  readonly managerNodeId: string;
  readonly defaults: {
    readonly maxLoopIterations: number;
    readonly nodeTimeoutMs: number;
  };
  readonly counts: {
    readonly nodes: number;
    readonly edges: number;
    readonly loops: number;
    readonly subWorkflows: number;
  };
  readonly nodeFiles: readonly string[];
  readonly workflowDirectory: string;
  readonly artifactWorkflowRoot: string;
  readonly runtime: WorkflowRuntimeReadiness;
}

export async function buildInspectionSummary(
  loaded: LoadedWorkflow,
  options: Pick<LoadOptions, "cwd" | "env"> = {},
): Promise<WorkflowInspectionSummary> {
  const workflow = loaded.bundle.workflow;
  return {
    workflowName: loaded.workflowName,
    workflowId: workflow.workflowId,
    description: workflow.description,
    managerNodeId: workflow.managerNodeId,
    defaults: {
      maxLoopIterations: workflow.defaults.maxLoopIterations,
      nodeTimeoutMs: workflow.defaults.nodeTimeoutMs,
    },
    counts: {
      nodes: workflow.nodes.length,
      edges: workflow.edges.length,
      loops: workflow.loops?.length ?? 0,
      subWorkflows: workflow.subWorkflows.length,
    },
    nodeFiles: workflow.nodes.map((node) => node.nodeFile),
    workflowDirectory: loaded.workflowDirectory,
    artifactWorkflowRoot: loaded.artifactWorkflowRoot,
    runtime: await inspectWorkflowRuntimeReadiness(loaded.bundle, options),
  };
}
