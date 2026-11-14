import { randomBytes } from "node:crypto";
import type { NodeAdapter } from "../adapter";
import {
  applyWorkflowSupervisionDefaults,
  createLifecycleSupervisionPolicyInput,
  normalizeAutoImprovePolicy,
} from "../auto-improve-policy";
import {
  loadWorkflowByIdFromDisk,
  loadWorkflowFromDisk,
  mergeLoadOptionsForSessionMutableBundle,
  type LoadedWorkflow,
} from "../load";
import { recordWorkflowPatchRevision } from "../mutable-workspace";
import { resolveEffectiveRoots } from "../paths";
import { err, ok, type Result } from "../result";
import { createSessionId, type WorkflowSessionState } from "../session";
import { loadSession, saveSession } from "../session-store";
import {
  getEngineSupervisionPatcherId,
  isSupervisionStallLastError,
  planSupervisionRemediation,
} from "../superviser";
import {
  buildSuperviserRuntimeControl,
  workflowRunBaseForSuperviserControl,
} from "../superviser-runtime-control-impl";
import type {
  SupervisionIncident,
  SupervisionRemediationRecord,
  SupervisionRunState,
} from "../types";
import type {
  EngineExecutionGuards,
  NormalizedWorkflowRunOptions,
  WorkflowRunFailure,
  WorkflowRunOptions,
  WorkflowRunResult,
} from "./types-and-session-state";
import { nowIso, workflowRunFailure } from "./types-and-session-state";
import { runWorkflowInternal } from "./mailbox-and-communications";

export async function runAutoImproveLoop(
  workflowName: string,
  options: NormalizedWorkflowRunOptions,
  adapter: NodeAdapter | undefined,
  guards: EngineExecutionGuards | undefined,
): Promise<Result<WorkflowRunResult, WorkflowRunFailure>> {
  const policy = options.autoImprove;
  if (policy === undefined) {
    return err(workflowRunFailure(1, "internal: autoImprove policy missing"));
  }
  const innerBase: NormalizedWorkflowRunOptions = {
    ...options,
    supervisionLoopExecution: true,
  };
  let current: NormalizedWorkflowRunOptions = innerBase;

  for (;;) {
    const result = await runWorkflowInternal(
      workflowName,
      current,
      adapter,
      guards,
    );

    if (result.ok) {
      const persisted = await loadSession(
        result.value.session.sessionId,
        options,
      );
      const latest = persisted.ok ? persisted.value : result.value.session;
      if (latest.status !== "completed" || result.value.exitCode !== 0) {
        return ok({ ...result.value, session: latest });
      }
      if (latest.supervision !== undefined) {
        const next: WorkflowSessionState = {
          ...latest,
          supervision: { ...latest.supervision, status: "succeeded" },
        };
        const saved = await saveSession(next, options);
        if (!saved.ok) {
          return err(workflowRunFailure(1, saved.error.message, next));
        }
        return ok({ session: next, exitCode: 0 });
      }
      return ok({ ...result.value, session: latest });
    }

    const failure = result.error;
    if (failure.sessionId === undefined) {
      return result;
    }
    if (failure.exitCode === 130) {
      return result;
    }

    const loaded = await loadSession(failure.sessionId, options);
    if (!loaded.ok) {
      return result;
    }
    const failedSession = loaded.value;
    if (failedSession.supervision === undefined) {
      return result;
    }

    const sup = failedSession.supervision;
    if (sup.attemptCount >= policy.maxSupervisedAttempts) {
      const t = nowIso();
      const lastErr = failedSession.lastError;
      const terminalIncident: SupervisionIncident = {
        incidentId: `inc-${randomBytes(6).toString("hex")}`,
        supervisedAttemptId: failedSession.sessionId,
        category: isSupervisionStallLastError(lastErr) ? "stall" : "failure",
        summary: lastErr ?? failure.message,
        detectedAt: t,
      };
      const budgetIncident: SupervisionIncident = {
        incidentId: `inc-${randomBytes(6).toString("hex")}`,
        supervisedAttemptId: failedSession.sessionId,
        category: "budget-exhausted",
        summary: `max supervised attempts (${policy.maxSupervisedAttempts}) reached`,
        detectedAt: t,
      };
      const remediation: SupervisionRemediationRecord = {
        remediationId: `rem-${randomBytes(6).toString("hex")}`,
        incidentId: budgetIncident.incidentId,
        decidedAt: t,
        action: "stop-supervision",
        reason: "supervision attempt budget exhausted",
      };
      const nextSession: WorkflowSessionState = {
        ...failedSession,
        supervision: {
          ...sup,
          status: "stopped",
          incidents: [...sup.incidents, terminalIncident, budgetIncident],
          remediations: [...(sup.remediations ?? []), remediation],
        },
      };
      const saved = await saveSession(nextSession, options);
      if (!saved.ok) {
        return err(workflowRunFailure(1, saved.error.message, nextSession));
      }
      return err(
        workflowRunFailure(
          1,
          nextSession.lastError ?? failure.message,
          nextSession,
        ),
      );
    }

    const t = nowIso();
    const lastErr = failedSession.lastError;
    const failIncident: SupervisionIncident = {
      incidentId: `inc-${randomBytes(6).toString("hex")}`,
      supervisedAttemptId: failedSession.sessionId,
      category: isSupervisionStallLastError(lastErr) ? "stall" : "failure",
      summary: lastErr ?? failure.message,
      detectedAt: t,
    };
    const nextAttempt = sup.attemptCount + 1;

    const loadOptsForTarget = mergeLoadOptionsForSessionMutableBundle(
      options,
      failedSession,
    );
    const wfForTarget = await loadWorkflowFromDisk(
      workflowName,
      loadOptsForTarget,
    );
    if (!wfForTarget.ok) {
      return err(
        workflowRunFailure(
          2,
          `supervision rerun: load workflow: ${wfForTarget.error.message}`,
          failedSession,
        ),
      );
    }
    const targetWorkflow = wfForTarget.value.bundle.workflow;
    const workflowForSupervision = targetWorkflow;
    const remediationPlan = planSupervisionRemediation({
      policy,
      sup,
      workflow: workflowForSupervision,
      session: failedSession,
      failIncident,
    });

    if (remediationPlan.kind === "stop-patch-budget") {
      const tStop = nowIso();
      const patchBudgetIncident: SupervisionIncident = {
        incidentId: `inc-${randomBytes(6).toString("hex")}`,
        supervisedAttemptId: failedSession.sessionId,
        category: "budget-exhausted",
        summary: `max workflow patches (${policy.maxWorkflowPatches}) reached; repeated supervised incident: ${lastErr ?? failure.message}`,
        detectedAt: tStop,
      };
      const patchStopRemediation: SupervisionRemediationRecord = {
        remediationId: `rem-${randomBytes(6).toString("hex")}`,
        incidentId: patchBudgetIncident.incidentId,
        decidedAt: tStop,
        action: "stop-supervision",
        reason: "workflow patch budget exhausted",
      };
      const nextSession: WorkflowSessionState = {
        ...failedSession,
        supervision: {
          ...sup,
          status: "stopped",
          incidents: [...sup.incidents, failIncident, patchBudgetIncident],
          remediations: [...(sup.remediations ?? []), patchStopRemediation],
        },
      };
      const savedP = await saveSession(nextSession, options);
      if (!savedP.ok) {
        return err(workflowRunFailure(1, savedP.error.message, nextSession));
      }
      return err(
        workflowRunFailure(
          1,
          nextSession.lastError ?? failure.message,
          nextSession,
        ),
      );
    }

    let nextPatchCount = sup.workflowPatchCount;
    if (remediationPlan.kind === "patch-then-rerun") {
      const roots = resolveEffectiveRoots(current);
      if (sup.mutableWorkflowDir === undefined) {
        return err(
          workflowRunFailure(
            2,
            "supervision: mutable workflow directory missing; cannot record patch revision",
            failedSession,
          ),
        );
      }
      const patchRec = await recordWorkflowPatchRevision({
        artifactRoot: roots.artifactRoot,
        supervisionRunId: sup.supervisionRunId,
        mutableWorkflowDir: sup.mutableWorkflowDir,
        reason: remediationPlan.patchRecordReason,
        patchedByStepId: getEngineSupervisionPatcherId(),
      });
      if (!patchRec.ok) {
        return err(
          workflowRunFailure(
            2,
            `supervision: ${patchRec.error.message}`,
            failedSession,
          ),
        );
      }
      nextPatchCount += 1;
    }

    const rem: SupervisionRemediationRecord = {
      remediationId: `rem-${randomBytes(6).toString("hex")}`,
      incidentId: failIncident.incidentId,
      decidedAt: t,
      action:
        remediationPlan.kind === "patch-then-rerun"
          ? "patch-workflow"
          : remediationPlan.remediationAction,
      reason:
        remediationPlan.kind === "patch-then-rerun"
          ? remediationPlan.patchRecordReason
          : "automatic target workflow rerun after terminal failure or stall",
      ...(remediationPlan.targetStepId === undefined
        ? {}
        : { targetStepId: remediationPlan.targetStepId }),
    };
    const withUpdates: WorkflowSessionState = {
      ...failedSession,
      supervision: {
        ...sup,
        attemptCount: nextAttempt,
        workflowPatchCount: nextPatchCount,
        incidents: [...sup.incidents, failIncident],
        remediations: [...(sup.remediations ?? []), rem],
        ...(sup.policy === undefined ? { policy } : {}),
      },
    };
    const saved2 = await saveSession(withUpdates, options);
    if (!saved2.ok) {
      return err(workflowRunFailure(1, saved2.error.message, withUpdates));
    }

    const {
      resumeSessionId: _resumeSessionId,
      rerunFromSessionId: _rerunFromSessionId,
      rerunFromStepId: _rerunFromStepId,
      ...rerunBase
    } = innerBase;
    current = {
      ...rerunBase,
      autoImprove: policy,
      supervisionLoopExecution: true,
      rerunFromSessionId: withUpdates.sessionId,
      rerunFromStepId:
        remediationPlan.targetStepId ?? remediationPlan.rerunFromStepId,
    };
  }
}
export async function runWorkflow(
  workflowName: string,
  options: WorkflowRunOptions = {},
  adapter?: NodeAdapter,
  guards?: EngineExecutionGuards,
): Promise<Result<WorkflowRunResult, WorkflowRunFailure>> {
  if (
    options.maxConcurrency !== undefined &&
    (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1)
  ) {
    return err(
      workflowRunFailure(
        2,
        `invalid maxConcurrency '${options.maxConcurrency}'; expected a positive integer`,
      ),
    );
  }

  let normalizedOptions: WorkflowRunOptions =
    options.maxConcurrency !== undefined &&
    options.fanoutConcurrencyBudget === undefined
      ? { ...options, fanoutConcurrencyBudget: options.maxConcurrency }
      : options;
  if (normalizedOptions.autoImprove?.enabled === false) {
    normalizedOptions = {
      ...normalizedOptions,
      autoImprove: createLifecycleSupervisionPolicyInput(),
    };
  }

  const freshRunForWorkflowDefaults =
    normalizedOptions.resumeSessionId === undefined &&
    normalizedOptions.rerunFromSessionId === undefined &&
    normalizedOptions.continueFromWorkflowExecutionId === undefined;
  if (
    normalizedOptions.autoImprove !== undefined &&
    freshRunForWorkflowDefaults
  ) {
    const loadedForDefaults = await loadWorkflowFromDisk(
      workflowName,
      normalizedOptions,
    );
    if (!loadedForDefaults.ok) {
      return err(
        workflowRunFailure(
          loadedForDefaults.error.code === "VALIDATION" ||
            loadedForDefaults.error.code === "INVALID_WORKFLOW_NAME"
            ? 2
            : 1,
          loadedForDefaults.error.message,
        ),
      );
    }
    normalizedOptions = {
      ...normalizedOptions,
      autoImprove: applyWorkflowSupervisionDefaults(
        normalizedOptions.autoImprove,
        loadedForDefaults.value.bundle.workflow.defaults.supervision,
      ),
    };
  }

  const { autoImprove: pendingAutoImprove, ...runOptionsBase } =
    normalizedOptions;
  let runOptions: NormalizedWorkflowRunOptions = runOptionsBase;
  if (pendingAutoImprove !== undefined) {
    const normalizedPolicy = normalizeAutoImprovePolicy(pendingAutoImprove);
    if (!normalizedPolicy.ok || normalizedPolicy.value === undefined) {
      return err(
        workflowRunFailure(
          2,
          normalizedPolicy.ok
            ? "autoImprove.enabled must be true when autoImprove is set"
            : `invalid autoImprove policy: ${normalizedPolicy.error}`,
        ),
      );
    }
    runOptions = {
      ...runOptionsBase,
      autoImprove: normalizedPolicy.value,
    };
  }

  if (runOptions.autoImprove === undefined) {
    return runWorkflowInternal(workflowName, runOptions, adapter, guards, []);
  }
  if (runOptions.supervisionLoopExecution === true) {
    return runWorkflowInternal(workflowName, runOptions, adapter, guards, []);
  }
  if (runOptions.nestedSuperviserDriver === true) {
    if (runOptions.rerunFromSessionId !== undefined) {
      return err(
        workflowRunFailure(
          2,
          "nestedSuperviserDriver cannot be combined with rerunFromSessionId",
        ),
      );
    }
    if (runOptions.continueFromWorkflowExecutionId !== undefined) {
      return err(
        workflowRunFailure(
          2,
          "nestedSuperviserDriver cannot be combined with continueFromWorkflowExecutionId",
        ),
      );
    }
    return runWorkflowInternal(workflowName, runOptions, adapter, guards, []);
  }
  return runAutoImproveLoop(workflowName, runOptions, adapter, guards);
}
export async function runNestedSuperviserSessionDriver(
  workflowName: string,
  session: WorkflowSessionState,
  loaded: LoadedWorkflow,
  options: NormalizedWorkflowRunOptions,
  adapter: NodeAdapter | undefined,
  guards: EngineExecutionGuards | undefined,
  crossWorkflowInvocationStack: readonly string[],
): Promise<Result<WorkflowRunResult, WorkflowRunFailure>> {
  const sup = session.supervision;
  if (sup === undefined || options.autoImprove === undefined) {
    return err(
      workflowRunFailure(
        2,
        "internal: nested superviser requires supervision and policy",
      ),
    );
  }
  const supLoad = await loadWorkflowByIdFromDisk(
    sup.superviserWorkflowId,
    options,
  );
  if (!supLoad.ok) {
    return err(
      workflowRunFailure(
        2,
        `nested superviser: load '${sup.superviserWorkflowId}': ${supLoad.error.message}`,
        session,
      ),
    );
  }
  const resumingTarget =
    options.resumeSessionId !== undefined &&
    options.resumeSessionId === session.sessionId;
  const existingSuperviserRunSessionId = sup.nestedSuperviserSessionId;
  let sessionWithSuperviserRunId: WorkflowSessionState;
  let superviserRunSessionId: string;
  /**
   * When true, run the phase-2 superviser bundle with `resumeSessionId` set to
   * `superviserRunSessionId` (continue an in-flight superviser run). When false, start a new
   * superviser run with a fresh `sessionId` (no structural sub-workflow tree; flat supervision).
   */
  let resumeSuperviserRunSession: boolean;
  if (resumingTarget) {
    if (existingSuperviserRunSessionId === undefined) {
      return err(
        workflowRunFailure(
          2,
          "internal: nested superviser resume requires nestedSuperviserSessionId on supervision",
          session,
        ),
      );
    }
    const superviserRunLoaded = await loadSession(
      existingSuperviserRunSessionId,
      options,
    );
    if (!superviserRunLoaded.ok) {
      return err(
        workflowRunFailure(
          1,
          `nested superviser: load session for superviser run: ${superviserRunLoaded.error.message}`,
          session,
        ),
      );
    }
    const superviserRunCompleted =
      superviserRunLoaded.value.status === "completed";
    const targetStillActive = session.status !== "completed";
    if (superviserRunCompleted && targetStillActive) {
      // The superviser bundle finished (for example a one-shot add-on) while the
      // target session is still paused or failed. Resume the target by running another
      // superviser round with a fresh superviser session id (reusing the same supervision run).
      superviserRunSessionId = createSessionId({
        workflowId: supLoad.value.bundle.workflow.workflowId,
      });
      sessionWithSuperviserRunId = {
        ...session,
        supervision: {
          ...sup,
          nestedSuperviserSessionId: superviserRunSessionId,
        },
      };
      const savedSuperviser = await saveSession(
        sessionWithSuperviserRunId,
        options,
      );
      if (!savedSuperviser.ok) {
        return err(
          workflowRunFailure(
            1,
            savedSuperviser.error.message,
            sessionWithSuperviserRunId,
          ),
        );
      }
      resumeSuperviserRunSession = false;
    } else {
      superviserRunSessionId = existingSuperviserRunSessionId;
      sessionWithSuperviserRunId = session;
      resumeSuperviserRunSession = true;
    }
  } else {
    superviserRunSessionId = createSessionId({
      workflowId: supLoad.value.bundle.workflow.workflowId,
    });
    sessionWithSuperviserRunId = {
      ...session,
      supervision: {
        ...sup,
        nestedSuperviserSessionId: superviserRunSessionId,
      },
    };
    const savedSuperviser = await saveSession(
      sessionWithSuperviserRunId,
      options,
    );
    if (!savedSuperviser.ok) {
      return err(
        workflowRunFailure(
          1,
          savedSuperviser.error.message,
          sessionWithSuperviserRunId,
        ),
      );
    }
    resumeSuperviserRunSession = false;
  }
  const baseForControl = workflowRunBaseForSuperviserControl(options);
  const runWorkflowWithAdapter = (
    name: string,
    opts: WorkflowRunOptions,
  ): Promise<Result<WorkflowRunResult, WorkflowRunFailure>> =>
    runWorkflow(name, opts, adapter, guards);
  const control = buildSuperviserRuntimeControl({
    base: baseForControl,
    runWorkflow: runWorkflowWithAdapter,
    auth: {
      supervisionRunId: sup.supervisionRunId,
      targetSessionId: session.sessionId,
    },
    targetWorkflowName: workflowName,
    targetExpectedWorkflowId: loaded.bundle.workflow.workflowId,
    defaultPolicy: options.autoImprove,
  });
  const {
    autoImprove: _ai2,
    supervisionLoopExecution: _sl2,
    nestedSuperviserDriver: _nd2,
    superviserControl: _sc2,
    ...supOptsBase
  } = baseForControl;
  const baseRv = supOptsBase.runtimeVariables ?? {};
  const supOpts: NormalizedWorkflowRunOptions = {
    ...supOptsBase,
    runtimeVariables: {
      ...baseRv,
      supervisionRunId: sup.supervisionRunId,
      targetSessionId: session.sessionId,
      superviserTargetWorkflowId: loaded.bundle.workflow.workflowId,
    },
    superviserControl: control,
    ...(resumeSuperviserRunSession
      ? { resumeSessionId: superviserRunSessionId }
      : { sessionId: superviserRunSessionId }),
  };
  const supResult = await runWorkflowInternal(
    supLoad.value.workflowName,
    supOpts,
    adapter,
    guards,
    crossWorkflowInvocationStack,
  );
  const reloaded = await loadSession(session.sessionId, options);
  const target =
    reloaded.ok && reloaded.value.supervision !== undefined
      ? reloaded.value
      : sessionWithSuperviserRunId;
  if (supResult.ok) {
    const exit = supResult.value.exitCode;
    const st: SupervisionRunState["status"] =
      exit === 0 ? "succeeded" : exit === 4 ? "stopped" : "failed";
    const nextSup: SupervisionRunState = {
      ...(target.supervision as SupervisionRunState),
      status: st,
    };
    const stamped: WorkflowSessionState = {
      ...target,
      supervision: nextSup,
    };
    const w = await saveSession(stamped, options);
    if (!w.ok) {
      return err(workflowRunFailure(1, w.error.message, stamped));
    }
    return ok({ session: stamped, exitCode: exit });
  }
  const nextSup: SupervisionRunState = {
    ...((target.supervision ?? sup) as SupervisionRunState),
    status: "failed",
  };
  const stamped: WorkflowSessionState = {
    ...target,
    supervision: nextSup,
  };
  const w = await saveSession(stamped, options);
  if (!w.ok) {
    return err(workflowRunFailure(1, w.error.message, stamped));
  }
  return err(
    workflowRunFailure(
      supResult.error.exitCode,
      supResult.error.message,
      stamped,
    ),
  );
}
