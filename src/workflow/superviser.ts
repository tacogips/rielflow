/**
 * Superviser orchestration for `--auto-improve` (design-auto-improve-superviser-mode).
 * Remediation **types** and deterministic planning live here. Phase 1 runs an engine
 * supervision loop (`runAutoImproveLoop` / `runWorkflow` in `src/workflow/engine.ts`)
 * when `WorkflowRunOptions.autoImprove` is set. Phase 2 optionally runs
 * `superviserWorkflowId` as a nested step-addressed workflow when
 * `WorkflowRunOptions.nestedSuperviserDriver` is set; native `divedra/*` add-ons receive
 * {@link import("./superviser-control").SuperviserRuntimeControl} via `node-addons.ts`.
 * Stall detection uses persisted session snapshots ({@link buildSupervisionStallWatch}).
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
  overrides: { readonly stallTimeoutMs?: number } = {},
): SupervisionStallWatch | undefined {
  const p = session.supervision?.policy;
  if (p === undefined || p.enabled !== true) {
    return undefined;
  }
  const stallTimeoutMs = overrides.stallTimeoutMs ?? p.stallTimeoutMs;
  return {
    sessionId: session.sessionId,
    monitorIntervalMs: Math.min(p.monitorIntervalMs, stallTimeoutMs),
    stallTimeoutMs,
    loadOptions,
  };
}

export type StepAddressedWorkflowForSupervision = Pick<
  WorkflowJson,
  "managerStepId" | "entryStepId" | "steps"
>;

/**
 * Execution anchor id for a full supervised rerun from the manager/entry point.
 * Supervision remediation is step-addressed only.
 */
export function resolveSupervisionRerunAnchor(
  workflow: Pick<
    StepAddressedWorkflowForSupervision,
    "managerStepId" | "entryStepId"
  >,
): string {
  return workflow.managerStepId ?? workflow.entryStepId;
}

/**
 * Resolves `rerunFromStepId` for phase-2 nested `divedra/rerun-workflow` when the
 * add-on omits it. The engine requires a step id with `rerunFromSessionId`, so
 * this prefers the current step from the session (when it maps to the workflow
 * graph), then the manager/entry anchor (same as
 * {@link resolveSupervisionRerunAnchor} on the step graph).
 */
export function resolveNestedSuperviserAddonRerunFromStepId(
  requested: string | undefined,
  session: Pick<WorkflowSessionState, "currentNodeId" | "nodeExecutions">,
  workflow: StepAddressedWorkflowForSupervision,
): string {
  if (requested !== undefined) {
    return requested;
  }
  const fromSession = resolveCurrentStepIdFromWorkflow(session, workflow);
  if (fromSession !== null) {
    return fromSession;
  }
  return resolveSupervisionRerunAnchor(workflow);
}

/**
 * Chooses `rerunFromStepId` for the next supervised attempt. When
 * {@link AutoImprovePolicy.allowTargetedRerun} is not `false`, uses the
 * current/failed step from the session when it is a valid rerun target and
 * differs from the manager/entry anchor; otherwise reruns from the anchor
 * (same as {@link resolveSupervisionRerunAnchor}).
 */
export function resolveSupervisionRerunTarget(
  policy: AutoImprovePolicy,
  workflow: StepAddressedWorkflowForSupervision,
  session: Pick<WorkflowSessionState, "currentNodeId" | "nodeExecutions">,
): {
  readonly rerunFromStepId: string;
  readonly remediationAction: SupervisionRemediationAction;
  readonly targetStepId?: string;
} {
  const anchor = resolveSupervisionRerunAnchor(workflow);
  if (policy.allowTargetedRerun === false) {
    return { rerunFromStepId: anchor, remediationAction: "rerun-workflow" };
  }
  const stepId = resolveCurrentStepIdFromWorkflow(session, workflow);
  if (stepId === null) {
    return { rerunFromStepId: anchor, remediationAction: "rerun-workflow" };
  }
  const stepIds = new Set(workflow.steps.map((step) => step.id));
  if (!stepIds.has(stepId)) {
    return { rerunFromStepId: anchor, remediationAction: "rerun-workflow" };
  }
  if (stepId === anchor) {
    return { rerunFromStepId: anchor, remediationAction: "rerun-workflow" };
  }
  return {
    rerunFromStepId: stepId,
    remediationAction: "rerun-step",
    targetStepId: stepId,
  };
}

/**
 * When the same target failure message repeats across consecutive supervised attempts,
 * escalate to a `patch-workflow` remediation: record provenance and increment
 * {@link SupervisionRunState.workflowPatchCount}. The engine-owned loop may not apply
 * concrete definition edits by itself; a phase-2 superviser workflow uses
 * `saveWorkflowDefinition` on the control surface. This escalation still advances the
 * audit trail and enforces `maxWorkflowPatches` (design-auto-improve-superviser-mode).
 */
export type SupervisionRemediationPlan =
  | {
      readonly kind: "rerun";
      readonly rerunFromStepId: string;
      readonly remediationAction: SupervisionRemediationAction;
      readonly targetStepId?: string;
    }
  | {
      readonly kind: "patch-then-rerun";
      readonly rerunFromStepId: string;
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
  readonly workflow: StepAddressedWorkflowForSupervision;
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
      rerunFromStepId: base.rerunFromStepId,
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
        "(audited patch record; concrete edits via nested superviser saveWorkflowDefinition or operator)"
      : "repeated target failure with the same error: supervision escalation " +
        "(audited patch record; concrete edits via nested superviser saveWorkflowDefinition or operator)";
  return {
    kind: "patch-then-rerun",
    rerunFromStepId: base.rerunFromStepId,
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
 * Input shape for library callers that start a workflow together with supervision policy
 * (`executeWorkflow` / `runWorkflow`); not a separate runtime entrypoint.
 */
export interface StartSupervisedRunInput
  extends LoadOptions,
    SessionStoreOptions {
  readonly workflowId: string;
  readonly policy: AutoImprovePolicy;
}
