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
  getNormalizedNodePayload,
  type SupervisionSummary,
  type LoadOptions,
  type NodeInputContract,
  type NodeOutputContract,
  type NodeRole,
  type WorkflowNodeRef,
  type NormalizedWorkflowBundle,
} from "./types";
import { deriveWorkflowVisualization } from "./visualization";
import type {
  FanoutBranchRecord,
  FanoutBranchStatus,
  FanoutGroupRunRecord,
  OutputRef,
  WorkflowSessionState,
} from "./session";
export interface WorkflowInspectionCounts {
  readonly steps: number;
  readonly nodeRegistry: number;
  /** Count of step-derived cross-workflow dispatches (not authored `workflowCalls`). */
  readonly crossWorkflowDispatches: number;
}

export interface WorkflowCallableContractSummary {
  readonly stepId: string;
  readonly role: NodeRole;
  readonly input?: NodeInputContract;
  readonly output?: NodeOutputContract;
}

export interface WorkflowStepSummary {
  readonly stepId: string;
  readonly role: NodeRole;
  readonly description?: string;
}

export interface WorkflowStructureRow {
  readonly stepId: string;
  readonly description: string;
  readonly indent: number;
}

export interface FanoutBranchSummary {
  readonly branchIndex: number;
  readonly status: FanoutBranchStatus;
  readonly workItemId: string;
  readonly nodeExecIds: readonly string[];
  readonly outputRef?: OutputRef;
  readonly error?: string;
  readonly workspaceRoot?: string;
  readonly supersededWorkspaceRoot?: string;
}

export interface FanoutGroupSummary {
  readonly fanoutGroupRunId: string;
  readonly groupId: string;
  readonly sourceStepId: string;
  readonly sourceNodeExecId: string;
  readonly joinStepId: string;
  readonly targetStepId: string;
  readonly targetWorkflowId?: string;
  readonly concurrency: number;
  readonly failurePolicy: FanoutGroupRunRecord["failurePolicy"];
  readonly resultOrder: FanoutGroupRunRecord["resultOrder"];
  readonly branchCounts: Readonly<Record<FanoutBranchStatus, number>>;
  readonly branches: readonly FanoutBranchSummary[];
  readonly firstFailure?: string;
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
  readonly callable: WorkflowCallableContractSummary;
  readonly steps: readonly WorkflowStepSummary[];
  readonly runtime: WorkflowRuntimeReadiness;
}

export function deriveWorkflowCallableContractSummary(
  bundle: Pick<NormalizedWorkflowBundle, "workflow" | "nodePayloads">,
): WorkflowCallableContractSummary {
  const workflow = bundle.workflow;
  const stepId = workflow.managerStepId ?? workflow.entryStepId;
  const step = workflow.steps.find((entry) => entry.id === stepId);
  const payload = getNormalizedNodePayload(bundle, stepId);
  return {
    stepId,
    role:
      step?.role ?? (workflow.managerStepId === stepId ? "manager" : "worker"),
    ...(payload?.input === undefined ? {} : { input: payload.input }),
    ...(payload?.output === undefined ? {} : { output: payload.output }),
  };
}

export function deriveWorkflowStepSummaries(
  workflow: Pick<
    NormalizedWorkflowBundle["workflow"],
    "managerStepId" | "steps"
  >,
): readonly WorkflowStepSummary[] {
  return workflow.steps.map((step) => ({
    stepId: step.id,
    role:
      step.role ?? (workflow.managerStepId === step.id ? "manager" : "worker"),
    ...(step.description === undefined
      ? {}
      : { description: step.description }),
  }));
}

export function deriveWorkflowStructureRows(
  workflow: NormalizedWorkflowBundle["workflow"],
): readonly WorkflowStructureRow[] {
  const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const stepAddressedWorkflow = {
    ...workflow,
    nodes: workflow.steps.map((step) => {
      const sourceNode = nodeById.get(step.id) ?? nodeById.get(step.nodeId);
      return {
        ...(sourceNode ?? {
          nodeFile: step.stepFile ?? `nodes/node-${step.id}.json`,
        }),
        id: step.id,
      } satisfies WorkflowNodeRef;
    }),
  };
  const indentationByStepId = new Map(
    deriveWorkflowVisualization({ workflow: stepAddressedWorkflow }).map(
      (node) => [node.id, node.indent],
    ),
  );

  return workflow.steps.map((step) => ({
    stepId: step.id,
    description:
      step.description === undefined || step.description.length === 0
        ? "-"
        : step.description,
    indent: indentationByStepId.get(step.id) ?? 0,
  }));
}

function emptyFanoutBranchCounts(): Record<FanoutBranchStatus, number> {
  return {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    paused: 0,
  };
}

function buildFanoutBranchSummary(
  branch: FanoutBranchRecord,
): FanoutBranchSummary {
  return {
    branchIndex: branch.branchIndex,
    status: branch.status,
    workItemId: branch.workItemId,
    nodeExecIds: branch.nodeExecIds ?? [],
    ...(branch.outputRef === undefined ? {} : { outputRef: branch.outputRef }),
    ...(branch.error === undefined ? {} : { error: branch.error }),
    ...(branch.workspaceRoot === undefined
      ? {}
      : { workspaceRoot: branch.workspaceRoot }),
    ...(branch.supersededWorkspaceRoot === undefined
      ? {}
      : { supersededWorkspaceRoot: branch.supersededWorkspaceRoot }),
  };
}

export function buildFanoutGroupSummary(
  group: FanoutGroupRunRecord,
): FanoutGroupSummary {
  const branchCounts = emptyFanoutBranchCounts();
  let firstFailure: string | undefined;
  for (const branch of group.branches) {
    branchCounts[branch.status] += 1;
    if (
      firstFailure === undefined &&
      (branch.status === "failed" || branch.status === "cancelled") &&
      branch.error !== undefined
    ) {
      firstFailure = `branch ${branch.branchIndex}: ${branch.error}`;
    }
  }
  return {
    fanoutGroupRunId: group.fanoutGroupRunId,
    groupId: group.groupId,
    sourceStepId: group.sourceStepId,
    sourceNodeExecId: group.sourceNodeExecId,
    joinStepId: group.joinStepId,
    targetStepId: group.targetStepId,
    ...(group.targetWorkflowId === undefined
      ? {}
      : { targetWorkflowId: group.targetWorkflowId }),
    concurrency: group.concurrency,
    failurePolicy: group.failurePolicy,
    resultOrder: group.resultOrder,
    branchCounts,
    branches: group.branches.map((branch) => buildFanoutBranchSummary(branch)),
    ...(firstFailure === undefined ? {} : { firstFailure }),
  };
}

export function buildFanoutGroupSummaries(
  session: Pick<WorkflowSessionState, "fanoutGroups">,
): readonly FanoutGroupSummary[] {
  return (session.fanoutGroups ?? []).map((group) =>
    buildFanoutGroupSummary(group),
  );
}

export async function buildInspectionSummary(
  loaded: LoadedWorkflow,
  options: LoadOptions = {},
): Promise<WorkflowInspectionSummary> {
  const workflow = loaded.bundle.workflow;
  const stepIds = workflow.steps.map((step) => step.id);
  const nodeRegistryIds = workflow.nodeRegistry.map((node) => node.id);
  const hasManagerNode =
    workflow.hasManagerNode ?? workflow.managerStepId !== undefined;
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
    callable: deriveWorkflowCallableContractSummary(loaded.bundle),
    steps: deriveWorkflowStepSummaries(workflow),
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
