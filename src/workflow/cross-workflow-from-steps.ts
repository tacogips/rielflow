import type { WorkflowCallRef, WorkflowJson, WorkflowStepRef } from "./types";

/**
 * Cross-workflow step transitions are authored on `steps[].transitions` and executed
 * like workflow calls with deterministic ids `__cw:<callerStepId>`. They are not
 * merged onto `workflow.workflowCalls` during normalization so the bundle stays
 * authored-shape clean; runtime and readiness inspection derive this list instead.
 */
export function crossWorkflowCallsFromSteps(
  steps: readonly WorkflowStepRef[] | undefined,
): readonly WorkflowCallRef[] {
  if (steps === undefined) {
    return [];
  }
  const out: WorkflowCallRef[] = [];
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

/**
 * Explicit `workflowCalls` plus step-derived cross-workflow calls; explicit ids win on id collision.
 * Iteration order follows Map insertion (derived, then explicit-only) and is for inspection/readiness;
 * workflow-call **execution** uses {@link workflowCallsForExecutionMatch} instead.
 */
export function effectiveWorkflowCalls(
  workflow: Pick<WorkflowJson, "workflowCalls" | "steps">,
): readonly WorkflowCallRef[] {
  const explicit = workflow.workflowCalls ?? [];
  const derived = crossWorkflowCallsFromSteps(workflow.steps);
  const byId = new Map<string, WorkflowCallRef>();
  for (const d of derived) {
    byId.set(d.id, d);
  }
  for (const e of explicit) {
    byId.set(e.id, e);
  }
  return [...byId.values()];
}

/**
 * Workflow-call rows to execute for the current caller, in **engine** order: explicit
 * `workflow.workflowCalls` matches preserve their authored array order, then step-derived
 * `__cw:*` rows that match and whose ids are not already taken by an explicit match.
 *
 * Do not implement this by filtering {@link effectiveWorkflowCalls}: inspection uses a
 * different id merge order (derived first, then explicit-only) for stable summaries.
 */
export function workflowCallsForExecutionMatch(
  workflow: Pick<WorkflowJson, "workflowCalls" | "steps">,
  match: (call: WorkflowCallRef) => boolean,
): readonly WorkflowCallRef[] {
  const explicitMatches = (workflow.workflowCalls ?? []).filter(match);
  const stepDerivedMatches = crossWorkflowCallsFromSteps(workflow.steps).filter(
    match,
  );
  const seenIds = new Set(explicitMatches.map((c) => c.id));
  return [
    ...explicitMatches,
    ...stepDerivedMatches.filter((c) => !seenIds.has(c.id)),
  ];
}
