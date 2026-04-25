/**
 * Superviser orchestration for `--auto-improve` (design-auto-improve-superviser-mode).
 * Remediation **types** live here. The first supervision loop (rerun on terminal target
 * failure with incident/remediation records and attempt budgets) runs in
 * `src/workflow/engine` (`runAutoImproveLoop` / `runWorkflow`) when
 * `WorkflowRunOptions.autoImprove` is set on a fresh start. Stall detection uses
 * persisted session snapshots. Running `superviserWorkflowId` as a nested workflow
 * is still a follow-up.
 */

import { resolveCurrentStepIdFromWorkflow } from "./session";
import type { WorkflowSessionState } from "./session";
import type { SessionStoreOptions } from "./session-store";
import type {
  AutoImprovePolicy,
  LoadOptions,
  SupervisionIncident,
  SupervisionRemediationAction,
  SupervisionStallWatch,
  SupervisionRunState,
  WorkflowJson,
} from "./types";

/** Prefix for {@link formatSupervisionStallError} / {@link isSupervisionStallLastError}. */
export const SUPERVISION_STALL_ERROR_PREFIX = "supervision stall:";

export function formatSupervisionStallError(stallTimeoutMs: number): string {
  return (
    `${SUPERVISION_STALL_ERROR_PREFIX} ` +
    `no persisted session progress within ${stallTimeoutMs}ms (see runtime sessions updated_at)`
  );
}

export function isSupervisionStallLastError(
  message: string | undefined,
): boolean {
  if (message === undefined) {
    return false;
  }
  return message.startsWith(SUPERVISION_STALL_ERROR_PREFIX);
}

/**
 * When the session has supervision policy, pass the result into adapter/native execution
 * so stall can be detected from persisted `sessions.updated_at` while a step executes.
 */
export function buildSupervisionStallWatch(
  session: Pick<WorkflowSessionState, "sessionId" | "supervision">,
  loadOptions: LoadOptions,
): SupervisionStallWatch | undefined {
  const p = session.supervision?.policy;
  if (p === undefined || p.enabled !== true) {
    return undefined;
  }
  return {
    sessionId: session.sessionId,
    monitorIntervalMs: p.monitorIntervalMs,
    stallTimeoutMs: p.stallTimeoutMs,
    loadOptions,
  };
}

/**
 * Execution address for a full supervised rerun from the manager/entry point. Pass as
 * {@link WorkflowRunOptions.rerunFromNodeId} when rerunning from the top (option name is
 * historical). Resolution order: {@link WorkflowJson.managerStepId} ??
 * {@link WorkflowJson.entryStepId} ?? {@link WorkflowJson.managerNodeId} ??
 * {@link WorkflowJson.entryNodeId}.
 */
export function resolveSupervisionRerunAnchor(
  workflow: Pick<
    WorkflowJson,
    "managerNodeId" | "managerStepId" | "entryStepId" | "entryNodeId"
  >,
): string {
  return (
    workflow.managerStepId ??
    workflow.entryStepId ??
    workflow.managerNodeId ??
    workflow.entryNodeId
  );
}

/**
 * Chooses `rerunFromNodeId` for the next supervised attempt. When
 * {@link AutoImprovePolicy.allowTargetedRerun} is not `false`, uses the
 * current/failed step from the session when it is a valid rerun target and
 * differs from the manager/entry anchor; otherwise reruns from the anchor
 * (same as {@link resolveSupervisionRerunAnchor}).
 */
export function resolveSupervisionRerunTarget(
  policy: AutoImprovePolicy,
  workflow: WorkflowJson,
  session: Pick<WorkflowSessionState, "currentNodeId" | "nodeExecutions">,
): {
  readonly rerunFromNodeId: string;
  readonly remediationAction: SupervisionRemediationAction;
  readonly targetStepId?: string;
} {
  const anchor = resolveSupervisionRerunAnchor(workflow);
  if (policy.allowTargetedRerun === false) {
    return { rerunFromNodeId: anchor, remediationAction: "rerun-workflow" };
  }
  const stepOrNodeId = resolveCurrentStepIdFromWorkflow(session, workflow);
  if (stepOrNodeId === null) {
    return { rerunFromNodeId: anchor, remediationAction: "rerun-workflow" };
  }
  if (workflow.steps !== undefined && workflow.steps.length > 0) {
    const stepIds = new Set(workflow.steps.map((s) => s.id));
    if (!stepIds.has(stepOrNodeId)) {
      return { rerunFromNodeId: anchor, remediationAction: "rerun-workflow" };
    }
  } else {
    const nodeIds = new Set(workflow.nodes.map((n) => n.id));
    if (!nodeIds.has(stepOrNodeId)) {
      return { rerunFromNodeId: anchor, remediationAction: "rerun-workflow" };
    }
  }
  if (stepOrNodeId === anchor) {
    return { rerunFromNodeId: anchor, remediationAction: "rerun-workflow" };
  }
  return {
    rerunFromNodeId: stepOrNodeId,
    remediationAction: "rerun-step",
    targetStepId: stepOrNodeId,
  };
}

/**
 * When the same target failure message repeats across consecutive supervised attempts,
 * escalate to a `patch-workflow` remediation: record provenance and increment
 * {@link SupervisionRunState.workflowPatchCount}. Automated file edits are reserved for
 * a future nested superviser workflow; this still advances the audit trail and enforces
 * `maxWorkflowPatches` (design-auto-improve-superviser-mode).
 */
export type SupervisionRemediationPlan =
  | {
      readonly kind: "rerun";
      readonly rerunFromNodeId: string;
      readonly remediationAction: SupervisionRemediationAction;
      readonly targetStepId?: string;
    }
  | {
      readonly kind: "patch-then-rerun";
      readonly rerunFromNodeId: string;
      readonly remediationAction: SupervisionRemediationAction;
      readonly targetStepId?: string;
      /** Text persisted on the patch revision record. */
      readonly patchRecordReason: string;
    }
  | { readonly kind: "stop-patch-budget" };

const ENGINE_SUPERVISION_PATCHER_ID = "divedra/supervision-engine" as const;

export function getEngineSupervisionPatcherId(): string {
  return ENGINE_SUPERVISION_PATCHER_ID;
}

function lastFailureIncident(
  incidents: readonly SupervisionIncident[],
): SupervisionIncident | undefined {
  for (let i = incidents.length - 1; i >= 0; i--) {
    const inc = incidents[i];
    if (inc === undefined) {
      continue;
    }
    if (inc.category === "failure") {
      return inc;
    }
  }
  return undefined;
}

function lastStallIncident(
  incidents: readonly SupervisionIncident[],
): SupervisionIncident | undefined {
  for (let i = incidents.length - 1; i >= 0; i--) {
    const inc = incidents[i];
    if (inc === undefined) {
      continue;
    }
    if (inc.category === "stall") {
      return inc;
    }
  }
  return undefined;
}

/**
 * True when the new incident matches the latest prior incident of the same
 * category (scanning backward), so an intervening incident of another category
 * does not suppress escalation (see superviser tests).
 */
function isConsecutiveSameCategoryRepeat(
  sup: SupervisionRunState,
  incident: Pick<SupervisionIncident, "category" | "summary">,
): boolean {
  if (incident.category === "failure") {
    const prior = lastFailureIncident(sup.incidents);
    return prior !== undefined && prior.summary === incident.summary;
  }
  if (incident.category === "stall") {
    const prior = lastStallIncident(sup.incidents);
    return prior !== undefined && prior.summary === incident.summary;
  }
  return false;
}

/**
 * Picks the next supervision step after a terminal target failure or stall: plain rerun,
 * patch escalation when the same category repeats with the same
 * {@link SupervisionIncident.summary} as the latest prior incident of that category
 * (failure or stall), or stop when the workflow patch budget is exhausted.
 */
export function planSupervisionRemediation(input: {
  readonly policy: AutoImprovePolicy;
  readonly sup: SupervisionRunState;
  readonly workflow: WorkflowJson;
  readonly session: Pick<
    WorkflowSessionState,
    "currentNodeId" | "nodeExecutions"
  >;
  /**
   * Newly detected failure or stall, before it is appended to `sup.incidents`. Repeat
   * detection compares this summary to the latest **prior** incident of the same
   * category (scanning backward in `sup.incidents`). Uses the same string the engine
   * would persist, typically from `lastError` or the run failure message when `lastError`
   * is unset.
   */
  readonly failIncident: Pick<SupervisionIncident, "category" | "summary">;
}): SupervisionRemediationPlan {
  const base = resolveSupervisionRerunTarget(
    input.policy,
    input.workflow,
    input.session,
  );
  if (!isConsecutiveSameCategoryRepeat(input.sup, input.failIncident)) {
    return {
      kind: "rerun",
      rerunFromNodeId: base.rerunFromNodeId,
      remediationAction: base.remediationAction,
      ...(base.targetStepId === undefined
        ? {}
        : { targetStepId: base.targetStepId }),
    };
  }
  if (input.sup.workflowPatchCount >= input.policy.maxWorkflowPatches) {
    return { kind: "stop-patch-budget" };
  }
  const patchRecordReason =
    input.failIncident.category === "stall"
      ? "repeated target stall with the same condition: supervision escalation " +
        "(audited patch record; definition edits are expected from a future superviser workflow or operator)"
      : "repeated target failure with the same error: supervision escalation " +
        "(audited patch record; definition edits are expected from a future superviser workflow or operator)";
  return {
    kind: "patch-then-rerun",
    rerunFromNodeId: base.rerunFromNodeId,
    remediationAction: "patch-workflow",
    patchRecordReason,
    ...(base.targetStepId === undefined
      ? {}
      : { targetStepId: base.targetStepId }),
  };
}

/**
 * Proposed remediation before it is recorded as {@link SupervisionRemediationRecord}.
 */
export interface SupervisionRemediationDecision {
  readonly action: SupervisionRemediationAction;
  readonly targetStepId?: string;
  readonly reason: string;
}

/**
 * Future entry point for launching a target workflow together with paired superviser control.
 */
export interface StartSupervisedRunInput
  extends LoadOptions,
    SessionStoreOptions {
  readonly workflowId: string;
  readonly policy: AutoImprovePolicy;
}
