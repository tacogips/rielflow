import {
  isStepAddressedWorkflow,
  type WorkflowJson,
  type WorkflowStepRef,
} from "./types";

/**
 * Runtime/inspection projection for cross-workflow links. Cross-workflow calls
 * are derived only from step-addressed `steps[].transitions`.
 */
export interface EffectiveWorkflowCall {
  readonly id: string;
  readonly workflowId: string;
  readonly callerNodeId: string;
  readonly callerStepId?: string;
  readonly resultNodeId?: string;
  readonly when?: string;
}

export type CrossWorkflowExecutionDispatch = EffectiveWorkflowCall;

/**
 * Cross-workflow step transitions are authored on `steps[].transitions` and executed
 * like workflow calls with deterministic ids `__cw:<callerStepId>`. They are not
 * merged onto `workflow.workflowCalls` during normalization so the bundle stays
 * authored-shape clean; runtime and readiness inspection derive this list instead.
 */
export function crossWorkflowCallsFromSteps(
  steps: readonly WorkflowStepRef[] | undefined,
): readonly EffectiveWorkflowCall[] {
  if (steps === undefined) {
    return [];
  }
  const out: EffectiveWorkflowCall[] = [];
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
      callerNodeId: step.id,
      callerStepId: step.id,
      resultNodeId: cross.resumeStepId,
      ...(when === undefined ? {} : { when }),
    });
  }
  return out;
}

function crossWorkflowDispatchesFromSteps(
  steps: readonly WorkflowStepRef[] | undefined,
): readonly CrossWorkflowExecutionDispatch[] {
  return crossWorkflowCallsFromSteps(steps);
}

/**
 * For step-addressed normalized workflows (`entryStepId` + `steps[]`), returns
 * only step-derived cross-workflow calls. Legacy node-graph bundles no longer
 * expose authored top-level `workflowCalls`.
 */
export function effectiveWorkflowCalls(
  workflow: Pick<WorkflowJson, "entryStepId" | "steps">,
): readonly EffectiveWorkflowCall[] {
  if (!isStepAddressedWorkflow(workflow)) {
    return [];
  }
  return crossWorkflowCallsFromSteps(workflow.steps);
}

/**
 * Cross-workflow execution rows for the current caller. Step-addressed workflows
 * derive execution dispatches directly from `steps[].transitions`; legacy
 * node-graph bundles do not execute authored `workflow.workflowCalls`.
 */
export function crossWorkflowDispatchesForExecutionMatch(
  workflow: Pick<WorkflowJson, "entryStepId" | "steps">,
  match: (dispatch: CrossWorkflowExecutionDispatch) => boolean,
): readonly CrossWorkflowExecutionDispatch[] {
  if (!isStepAddressedWorkflow(workflow)) {
    return [];
  }
  return crossWorkflowDispatchesFromSteps(workflow.steps).filter(match);
}
