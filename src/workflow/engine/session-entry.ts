import { cancelPendingWorkflowSleepScheduledEvents } from "../session";
import { workflowSessionEntryPort } from "./workflow-runner-deps";

type SupervisionRunState = any;
type WorkflowSessionState = any;

const {
  loadContinuationRelatedSnapshots,
  resolveContinuationAnchorPlacement,
  err,
  ok,
  createSessionId,
  createSessionState,
  saveSession,
  resolveWorkflowManagerStepId,
  describeAmbiguousFanoutBranchRerunTarget,
  hasPendingPausedFanoutBranch,
  workflowRunFailure,
  runNestedSuperviserSessionDriver,
  cloneSession,
  cloneSupervisionForContinuedRun,
  isTerminalStatus,
  persistExternalMailboxInputCommunication,
} = workflowSessionEntryPort;

export async function enterWorkflowSession(setup: any) {
  const {
    workflowName,
    options,
    adapter,
    guards,
    crossWorkflowInvocationStack,
    loaded,
    preloadedForBundlePath,
    precomputedSupervision,
    runtimeVariables,
    workflow,
    workflowNodes,
  } = setup;
  let session: WorkflowSessionState;
  if (options.rerunFromSessionId !== undefined) {
    if (preloadedForBundlePath === undefined) {
      return {
        kind: "result",
        result: err({
          exitCode: 1,
          message: "internal: rerun source session missing",
        }),
      };
    }
    const source = preloadedForBundlePath;
    const rerunTargetLabel = workflow.steps === undefined ? "node" : "step";
    const rerunTargetId = options.rerunFromStepId;
    if (rerunTargetId === undefined) {
      return {
        kind: "result",
        result: err({
          exitCode: 1,
          message: `rerun ${rerunTargetLabel} id is required when rerunFromSessionId is set`,
        }),
      };
    }
    const stepIdSet =
      workflow.steps === undefined
        ? undefined
        : new Set(workflow.steps.map((st: any) => st.id));
    const rerunIdKnown =
      stepIdSet === undefined
        ? workflowNodes.has(rerunTargetId)
        : stepIdSet.has(rerunTargetId);
    if (!rerunIdKnown) {
      return {
        kind: "result",
        result: err({
          exitCode: 1,
          message: `unknown rerun ${rerunTargetLabel} '${rerunTargetId}'`,
        }),
      };
    }
    const ambiguousFanoutBranchRerun = describeAmbiguousFanoutBranchRerunTarget(
      source,
      rerunTargetId,
    );
    if (ambiguousFanoutBranchRerun !== undefined) {
      return {
        kind: "result",
        result: err({ exitCode: 2, message: ambiguousFanoutBranchRerun }),
      };
    }
    const sourceWithCancelledSleep = cancelPendingWorkflowSleepScheduledEvents(
      source,
      options.scheduledEventManager,
    );
    if (sourceWithCancelledSleep !== source) {
      await saveSession(sourceWithCancelledSleep, options);
    }
    session = createSessionState({
      sessionId:
        options.sessionId ??
        createSessionId({ workflowId: workflow.workflowId }),
      workflowName,
      workflowId: workflow.workflowId,
      initialNodeId: rerunTargetId,
      runtimeVariables: { ...source.runtimeVariables, ...runtimeVariables },
    });
    if (options.supervisionLoopExecution === true) {
      session = {
        ...session,
        nodeExecutionCounter: source.nodeExecutionCounter,
        nodeExecutionCounts: { ...source.nodeExecutionCounts },
      };
    }
  } else if (options.continueFromWorkflowExecutionId !== undefined) {
    if (preloadedForBundlePath === undefined) {
      return {
        kind: "result",
        result: err({
          exitCode: 1,
          message: "internal: continuation source workflow execution missing",
        }),
      };
    }
    const sourceSession = preloadedForBundlePath;
    const continueAfterStepRunId = options.continueAfterStepRunId;
    const continueStartStepId = options.continueStartStepId;
    if (
      continueAfterStepRunId === undefined ||
      continueAfterStepRunId.trim().length === 0 ||
      continueStartStepId === undefined ||
      continueStartStepId.trim().length === 0
    ) {
      return {
        kind: "result",
        result: err({
          exitCode: 2,
          message:
            "continueAfterStepRunId and continueStartStepId are required when continueFromWorkflowExecutionId is set",
        }),
      };
    }
    const continueTargetLabel = workflow.steps === undefined ? "node" : "step";
    const trimmedStart = continueStartStepId.trim();
    const stepIdSetContinue =
      workflow.steps === undefined
        ? undefined
        : new Set(workflow.steps.map((st: any) => st.id));
    const continuationStartKnown =
      stepIdSetContinue === undefined
        ? workflowNodes.has(trimmedStart)
        : stepIdSetContinue.has(trimmedStart);
    if (!continuationStartKnown) {
      return {
        kind: "result",
        result: err({
          exitCode: 1,
          message: `unknown continuation ${continueTargetLabel} '${trimmedStart}'`,
        }),
      };
    }
    const snapshotsResult = await loadContinuationRelatedSnapshots(
      [sourceSession],
      options,
    );
    if (!snapshotsResult.ok) {
      return {
        kind: "result",
        result: err({ exitCode: 1, message: snapshotsResult.error }),
      };
    }
    const snapshotsForAnchor = snapshotsResult.value;
    const anchorResult = resolveContinuationAnchorPlacement({
      snapshots: snapshotsForAnchor,
      sourceWorkflowExecutionId: sourceSession.sessionId,
      anchorStepRunId: continueAfterStepRunId.trim(),
      expectedWorkflowId: workflow.workflowId,
    });
    if (!anchorResult.ok) {
      return {
        kind: "result",
        result: err({
          exitCode: 1,
          message: anchorResult.error.message,
        }),
      };
    }
    session = createSessionState({
      sessionId:
        options.sessionId ??
        createSessionId({ workflowId: workflow.workflowId }),
      workflowName,
      workflowId: workflow.workflowId,
      initialNodeId: trimmedStart,
      runtimeVariables: {
        ...sourceSession.runtimeVariables,
        ...runtimeVariables,
      },
    });
    session = {
      ...session,
      continuedFromWorkflowExecutionId: sourceSession.sessionId,
      continuedAfterStepRunId: anchorResult.value.anchor.stepRunId,
      continuedAfterExecutionOrdinal:
        anchorResult.value.anchor.executionOrdinal,
      continuedStartStepId: trimmedStart,
      continuationMode: "rerun-from-history",
      historyImports: anchorResult.value.flattenedHistoryImports,
    };
  } else if (options.resumeSessionId !== undefined) {
    if (preloadedForBundlePath === undefined) {
      return {
        kind: "result",
        result: err({
          exitCode: 1,
          message: "internal: resume session missing",
        }),
      };
    }
    const existing = preloadedForBundlePath;
    session = cloneSession(existing);
    if (options.autoImprove !== undefined) {
      const policy = options.autoImprove;
      if (session.supervision === undefined) {
        return {
          kind: "result",
          result: err(
            workflowRunFailure(
              2,
              "autoImprove on resume requires supervision state on the session (start with workflow run --auto-improve, or omit --auto-improve when resuming a non-supervised session)",
              existing,
            ),
          ),
        };
      }
      session = {
        ...session,
        supervision: cloneSupervisionForContinuedRun(
          session.supervision,
          policy,
        ),
      };
    }
    if (isTerminalStatus(session.status)) {
      if (options.autoImprove !== undefined) {
        await saveSession(session, options);
      }
      return {
        kind: "result",
        result: ok({
          session,
          exitCode: session.status === "completed" ? 0 : 1,
        }),
      };
    }
    if ((session.activeUserActions?.length ?? 0) > 0) {
      if (options.autoImprove !== undefined) {
        await saveSession(session, options);
      }
      return { kind: "result", result: ok({ session, exitCode: 4 }) };
    }
    if (hasPendingPausedFanoutBranch(session)) {
      if (options.autoImprove !== undefined) {
        await saveSession(session, options);
      }
      return { kind: "result", result: ok({ session, exitCode: 4 }) };
    }
    session = {
      ...session,
      status: "running",
      runtimeVariables: { ...session.runtimeVariables, ...runtimeVariables },
    };
  } else {
    session = createSessionState({
      sessionId:
        options.sessionId ??
        createSessionId({ workflowId: workflow.workflowId }),
      workflowName,
      workflowId: workflow.workflowId,
      initialNodeId:
        options.fanoutBranchStartStepId ??
        resolveWorkflowManagerStepId(workflow),
      runtimeVariables,
    });
  }
  if (
    options.autoImprove !== undefined &&
    options.continueFromWorkflowExecutionId !== undefined
  ) {
    return {
      kind: "result",
      result: err({
        exitCode: 2,
        message:
          "autoImprove cannot be combined with history-linked continuation (continueFromWorkflowExecutionId); omit autoImprove for this entry mode",
      }),
    };
  }
  if (
    options.autoImprove !== undefined &&
    options.resumeSessionId === undefined
  ) {
    const policy = options.autoImprove;
    let nextSupervision: SupervisionRunState;
    if (precomputedSupervision !== undefined) {
      nextSupervision = precomputedSupervision;
    } else if (preloadedForBundlePath?.supervision !== undefined) {
      nextSupervision = cloneSupervisionForContinuedRun(
        preloadedForBundlePath.supervision,
        policy,
      );
    } else if (options.rerunFromSessionId !== undefined) {
      return {
        kind: "result",
        result: err({
          exitCode: 2,
          message:
            "autoImprove on rerun requires supervision state on the source session (for example, use workflow run with --auto-improve first, then rerun with the same policy)",
        }),
      };
    } else {
      return {
        kind: "result",
        result: err({
          exitCode: 1,
          message:
            "internal: auto-improve supervision was not precomputed; report this as a bug",
        }),
      };
    }
    session = {
      ...session,
      supervision: nextSupervision,
    };
  }
  if (options.resumeSessionId === undefined) {
    const humanInput = session.runtimeVariables["humanInput"];
    if (humanInput !== undefined) {
      const bootstrapCommunication =
        await persistExternalMailboxInputCommunication({
          artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
          runtimeLogOptions: options,
          workflowId: workflow.workflowId,
          workflowExecutionId: session.sessionId,
          communicationCounter: session.communicationCounter,
          deliveredByNodeId: resolveWorkflowManagerStepId(workflow),
          toNodeId: resolveWorkflowManagerStepId(workflow),
          humanInput,
          createdAt: session.startedAt,
        });
      session = {
        ...session,
        communicationCounter: session.communicationCounter + 1,
        communications: [...session.communications, bootstrapCommunication],
      };
    }
  }
  await saveSession(session, options);
  if (options.nestedSuperviserDriver === true) {
    if (options.autoImprove === undefined) {
      return {
        kind: "result",
        result: err(
          workflowRunFailure(
            2,
            "nestedSuperviserDriver requires an auto-improve policy",
            session,
          ),
        ),
      };
    }
    if (options.rerunFromSessionId !== undefined) {
      return {
        kind: "result",
        result: err(
          workflowRunFailure(
            2,
            "nestedSuperviserDriver is not valid when rerunning from a source session",
            session,
          ),
        ),
      };
    }
    if (options.continueFromWorkflowExecutionId !== undefined) {
      return {
        kind: "result",
        result: err(
          workflowRunFailure(
            2,
            "nestedSuperviserDriver is not valid when continuing from imported workflow history",
            session,
          ),
        ),
      };
    }
    if (options.resumeSessionId !== undefined) {
      if (session.supervision?.nestedSuperviserSessionId === undefined) {
        return {
          kind: "result",
          result: err(
            workflowRunFailure(
              2,
              "nestedSuperviserDriver on resume requires nestedSuperviserSessionId on supervision (start the workflow with --nested-superviser first)",
              session,
            ),
          ),
        };
      }
    }
    if (session.supervision === undefined) {
      return {
        kind: "result",
        result: err(
          workflowRunFailure(
            2,
            "nestedSuperviserDriver requires seed supervision on the session",
            session,
          ),
        ),
      };
    }
    return {
      kind: "result",
      result: await runNestedSuperviserSessionDriver(
        workflowName,
        session,
        loaded.value,
        options,
        adapter,
        guards,
        crossWorkflowInvocationStack,
      ),
    };
  }
  return { kind: "session", session };
}
