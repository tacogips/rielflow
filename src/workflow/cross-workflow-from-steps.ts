import {
  isStepAddressedWorkflow,
  type WorkflowJson,
  type WorkflowStepRef,
} from "./types";

/**
 * Runtime/inspection projection for cross-workflow links derived from
 * step-addressed `steps[].transitions` (not authored `workflowCalls`).
 */
export interface CrossWorkflowDispatch {
  readonly id: string;
  readonly workflowId: string;
  /** Node registry id for the executing step (`WorkflowStepRef.nodeId`), not the step id. */
  readonly callerNodeId: string;
  readonly callerStepId?: string;
  readonly resultNodeId?: string;
  readonly when?: string;
}

/**
 * Cross-workflow step transitions are authored on `steps[].transitions` and executed
 * as cross-workflow dispatches with deterministic ids `__cw:<callerStepId>`. They are not
 * merged onto `workflow.workflowCalls` during normalization so the bundle stays
 * authored-shape clean; runtime and readiness inspection derive this list instead.
 */
export function crossWorkflowDispatchesFromSteps(
  steps: readonly WorkflowStepRef[] | undefined,
): readonly CrossWorkflowDispatch[] {
  if (steps === undefined) {
    return [];
  }
  const out: CrossWorkflowDispatch[] = [];
  for (const step of steps) {
    // Step-addressed validation allows at most one `toWorkflowId` transition per step.
    const cross = step.transitions?.find((t) => t.toWorkflowId !== undefined);
    if (
      cross === undefined ||
      cross.toWorkflowId === undefined ||
      cross.resumeStepId === undefined
    ) {
      continue;
    }
    const when = cross.label === undefined ? undefined : cross.label;
    out.push({
      id: `__cw:${step.id}`,
      workflowId: cross.toWorkflowId,
      callerNodeId: step.nodeId,
      callerStepId: step.id,
      resultNodeId: cross.resumeStepId,
      ...(when === undefined ? {} : { when }),
    });
  }
  return out;
}

/**
 * For step-addressed normalized workflows (`entryStepId` + `steps[]`), returns
 * only step-derived cross-workflow dispatches.
 */
export function effectiveCrossWorkflowDispatches(
  workflow: Pick<WorkflowJson, "entryStepId" | "steps">,
): readonly CrossWorkflowDispatch[] {
  if (!isStepAddressedWorkflow(workflow)) {
    return [];
  }
  return crossWorkflowDispatchesFromSteps(workflow.steps);
}

/**
 * Cross-workflow execution rows for the current caller. Step-addressed workflows
 * derive execution dispatches directly from `steps[].transitions`.
 */
export function crossWorkflowDispatchesForExecutionMatch(
  workflow: Pick<WorkflowJson, "entryStepId" | "steps">,
  match: (dispatch: CrossWorkflowDispatch) => boolean,
): readonly CrossWorkflowDispatch[] {
  if (!isStepAddressedWorkflow(workflow)) {
    return [];
  }
  return crossWorkflowDispatchesFromSteps(workflow.steps).filter(match);
}
