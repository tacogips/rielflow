import type { LoadedWorkflow } from "./load";
import {
  collectWorkflowAddonSourceSummaries,
  type WorkflowAddonSourceSummary,
} from "./addon-source-summary";
import { effectiveCrossWorkflowDispatches } from "./cross-workflow-from-steps";
import {
  inspectWorkflowRuntimeReadiness,
  type WorkflowRuntimeReadiness,
} from "./runtime-readiness";
import { collectWorkflowRevisionNodeFiles } from "./revision";
import {
  type SupervisionSummary,
  type LoadOptions,
} from "./types";
import type { WorkflowSessionState } from "./session";
export interface WorkflowInspectionCounts {
  readonly steps: number;
  readonly nodeRegistry: number;
  /** Count of step-derived cross-workflow dispatches (not authored `workflowCalls`). */
  readonly crossWorkflowDispatches: number;
}

export interface WorkflowInspectionSummary {
  readonly workflowName: string;
  readonly workflowId: string;
  readonly description: string;
  readonly hasManagerNode: boolean;
  readonly managerStepId?: string;
  readonly entryStepId?: string;
  readonly stepIds: readonly string[];
  readonly nodeRegistryIds: readonly string[];
  readonly crossWorkflowDispatchIds: readonly string[];
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
  const stepIds = workflow.steps.map((step) => step.id);
  const nodeRegistryIds = workflow.nodeRegistry.map((node) => node.id);
  const hasManagerNode = workflow.hasManagerNode !== false;
  const nodeRegistryCount = workflow.nodeRegistry.length;
  const stepCount = workflow.steps.length;
  const crossWorkflowDispatches = effectiveCrossWorkflowDispatches(workflow);
  return {
    workflowName: loaded.workflowName,
    workflowId: workflow.workflowId,
    description: workflow.description,
    hasManagerNode,
    ...(workflow.managerStepId === undefined
      ? {}
      : { managerStepId: workflow.managerStepId }),
    ...(workflow.entryStepId === undefined
      ? {}
      : { entryStepId: workflow.entryStepId }),
    stepIds,
    nodeRegistryIds,
    crossWorkflowDispatchIds: crossWorkflowDispatches.map((d) => d.id),
    defaults: {
      maxLoopIterations: workflow.defaults.maxLoopIterations,
      nodeTimeoutMs: workflow.defaults.nodeTimeoutMs,
    },
    counts: {
      steps: stepCount,
      nodeRegistry: nodeRegistryCount,
      crossWorkflowDispatches: crossWorkflowDispatches.length,
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
    ...(run.nestedSuperviserSessionId === undefined
      ? {}
      : { nestedSuperviserSessionId: run.nestedSuperviserSessionId }),
  };
}
