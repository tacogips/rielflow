import { workflowStepResultFinalizationPort } from "./workflow-runner-deps";

import { finalizeStepTransitions } from "./step-transition-finalization";

type CommunicationRecord = any;
type LoopRule = any;
type NodeExecutionRecord = any;
type WorkflowSessionState = any;

const {
  path,
  writeJsonFile,
  writeRawTextFile,
  parseManagerControlPayload,
  hashManagerAuthToken,
  isManagerNodeRef,
  err,
  isWorkflowOutputKindNode,
  saveNodeExecutionToRuntimeDb,
  saveProcessLogsToRuntimeDb,
  evaluateCompletion,
  resolveLoopTransition,
  buildOutputRefForExecution,
  persistNodeBackendSession,
  saveSession,
  isSupervisionStallLastError,
  resolveWorkflowManagerStepId,
  dedupeNodeIds,
  emitWorkflowRunEvent,
  evaluateEdge,
  nowIso,
  resolveTimeoutRestartBudget,
  sha256Hex,
  sleep,
  stableJson,
  workflowRunFailure,
  applyOptionalManagerDecisions,
  buildCommitMessageTemplate,
  markCommunicationsConsumed,
  persistCommunicationArtifact,
  readBusinessPayload,
} = workflowStepResultFinalizationPort;

export async function finalizeExecutedNode(input: any) {
  let {
    session,
    options,
    workflow,
    loaded,
    queue,
    nodeId,
    nodeRef,
    nodeExecId,
    stepIdentityFields,
    nextExecutionCounter,
    mailboxInstanceId,
    nodeStatus,
    artifactDir,
    startedAt,
    restartAttempt,
    outputAttemptCount,
    outputValidationErrors,
    backendSessionId,
    backendSessionIdentityFields,
    backendSessionSelection,
    backendSessionProvider,
    backendSession,
    requestedBackendSessionMode,
    previousNodeExecId,
    stepExecutionAddress,
    timeoutMs,
    managerSessionId,
    ambientManagerContext,
    managerSessionStore,
    executionTargetNoun,
    outputPayload,
    updatedCounts,
    outgoingEdges,
    maxLoopIterations,
    loopRule,
    effectiveAdapter,
    guards,
    crossWorkflowInvocationStack,
    workflowName,
    workflowNodes,
    nodeMap,
    isOptionalExecutionNode,
    inputJson,
    executionNodePayload,
    upstreamCommunicationIds,
    stuckRestartBackoffMs,
    agentNodePayload,
    processLogs,
    llmMessages,
  } = input;
  const endedAt = nowIso();
  try {
    await saveProcessLogsToRuntimeDb(
      {
        sessionId: session.sessionId,
        nodeId,
        nodeExecId,
        processLogs,
        at: endedAt,
        ...(stepExecutionAddress.stepId === undefined
          ? {}
          : { executionLogTarget: "step" as const }),
      },
      options,
    );
  } catch {}
  const nextNodeBackendSessions =
    agentNodePayload === null
      ? (session.nodeBackendSessions ?? {})
      : persistNodeBackendSession({
          session,
          node: agentNodePayload,
          nodeExecId,
          ...(backendSessionIdentityFields ?? {}),
          ...(backendSessionSelection?.inheritFromStepId === undefined
            ? {}
            : {
                inheritFromStepId: backendSessionSelection.inheritFromStepId,
              }),
          provider:
            backendSessionProvider ??
            outputPayload["provider"]?.toString() ??
            "unknown-provider",
          endedAt,
          backendSession,
          ...(backendSessionId === undefined
            ? {}
            : { returnedSessionId: backendSessionId }),
        });
  const buildNodeExecutionRecord = (
    status: NodeExecutionRecord["status"] = nodeStatus,
  ): NodeExecutionRecord => ({
    nodeId,
    ...stepIdentityFields,
    nodeExecId,
    executionOrdinal: nextExecutionCounter,
    mailboxInstanceId,
    status,
    artifactDir,
    startedAt,
    endedAt,
    ...(restartAttempt === 0 ? {} : { attempt: restartAttempt + 1 }),
    ...(outputAttemptCount === 1 ? {} : { outputAttemptCount }),
    ...(outputValidationErrors.length === 0 ? {} : { outputValidationErrors }),
    ...(backendSessionId === undefined ? {} : { backendSessionId }),
    ...(requestedBackendSessionMode === undefined
      ? {}
      : { backendSessionMode: requestedBackendSessionMode }),
    ...(previousNodeExecId === undefined
      ? {}
      : { restartedFromNodeExecId: previousNodeExecId }),
    ...(stepExecutionAddress.promptVariant === undefined
      ? {}
      : { promptVariant: stepExecutionAddress.promptVariant }),
    timeoutMs,
  });
  const buildNodeExecutions = (
    status: NodeExecutionRecord["status"] = nodeStatus,
  ): readonly NodeExecutionRecord[] => [
    ...session.nodeExecutions,
    buildNodeExecutionRecord(status),
  ];
  const finalizeManagerSession = async (
    finalStatus: "completed" | "failed" | "cancelled",
  ): Promise<void> => {
    if (managerSessionId === undefined || ambientManagerContext === undefined) {
      return;
    }
    await managerSessionStore.createOrResumeSession({
      managerSessionId,
      workflowId: workflow.workflowId,
      workflowExecutionId: session.sessionId,
      managerStepId: nodeId,
      managerNodeExecId: nodeExecId,
      status: finalStatus,
      createdAt: startedAt,
      updatedAt: endedAt,
      authTokenHash: hashManagerAuthToken(
        ambientManagerContext.environment.DIVEDRA_MANAGER_AUTH_TOKEN,
      ),
      authTokenExpiresAt: endedAt,
    });
  };
  let managerControl = null;
  if (isManagerNodeRef(nodeRef)) {
    try {
      const businessPayload = readBusinessPayload(outputPayload);
      managerControl =
        businessPayload === null
          ? null
          : parseManagerControlPayload(businessPayload, workflow, {
              managerStepId: nodeId,
              ...(nodeRef.role === undefined
                ? {}
                : { managerRole: nodeRef.role }),
            });
    } catch (error: unknown) {
      nodeStatus = "failed";
      const nodeExecutions = buildNodeExecutions();
      try {
        await finalizeManagerSession("failed");
      } catch (finalizationError: unknown) {
        const message =
          finalizationError instanceof Error
            ? finalizationError.message
            : "unknown manager session finalization failure";
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt,
          nodeExecutionCounter: nextExecutionCounter,
          nodeExecutionCounts: updatedCounts,
          nodeExecutions,
          communicationCounter: session.communicationCounter,
          communications: session.communications,
          nodeBackendSessions: nextNodeBackendSessions,
          lastError: `failed to finalize manager session for ${executionTargetNoun} '${nodeId}': ${message}`,
        };
        await saveSession(failed, options);
        return err({
          exitCode: 1,
          message: failed.lastError ?? "failed to finalize manager session",
        });
      }
      const message =
        error instanceof Error
          ? error.message
          : "unknown manager control parsing failure";
      const failed: WorkflowSessionState = {
        ...session,
        queue,
        status: "failed",
        currentNodeId: nodeId,
        endedAt,
        nodeExecutionCounter: nextExecutionCounter,
        nodeExecutionCounts: updatedCounts,
        nodeExecutions,
        communicationCounter: session.communicationCounter,
        communications: session.communications,
        nodeBackendSessions: nextNodeBackendSessions,
        lastError: `invalid manager control for ${executionTargetNoun} '${nodeId}': ${message}`,
      };
      await saveSession(failed, options);
      return err({
        exitCode: 5,
        message: failed.lastError ?? "invalid manager control",
      });
    }
    if (managerControl !== null && managerSessionId !== undefined) {
      try {
        const claimedMode = await managerSessionStore.claimControlMode({
          managerSessionId,
          controlMode: "payload-manager-control",
          updatedAt: endedAt,
        });
        if (claimedMode !== "payload-manager-control") {
          nodeStatus = "failed";
          const nodeExecutions = buildNodeExecutions();
          try {
            await finalizeManagerSession("failed");
          } catch (finalizationError: unknown) {
            const message =
              finalizationError instanceof Error
                ? finalizationError.message
                : "unknown manager session finalization failure";
            const failed: WorkflowSessionState = {
              ...session,
              queue,
              status: "failed",
              currentNodeId: nodeId,
              endedAt,
              nodeExecutionCounter: nextExecutionCounter,
              nodeExecutionCounts: updatedCounts,
              nodeExecutions,
              communicationCounter: session.communicationCounter,
              communications: session.communications,
              nodeBackendSessions: nextNodeBackendSessions,
              lastError: `failed to finalize manager session for ${executionTargetNoun} '${nodeId}': ${message}`,
            };
            await saveSession(failed, options);
            return err({
              exitCode: 1,
              message: failed.lastError ?? "failed to finalize manager session",
            });
          }
          const failed: WorkflowSessionState = {
            ...session,
            queue,
            status: "failed",
            currentNodeId: nodeId,
            endedAt,
            nodeExecutionCounter: nextExecutionCounter,
            nodeExecutionCounts: updatedCounts,
            nodeExecutions,
            communicationCounter: session.communicationCounter,
            communications: session.communications,
            nodeBackendSessions: nextNodeBackendSessions,
            lastError: `invalid manager control for ${executionTargetNoun} '${nodeId}': manager execution cannot mix GraphQL manager messages with payload managerControl`,
          };
          await saveSession(failed, options);
          return err({
            exitCode: 5,
            message: failed.lastError ?? "invalid manager control",
          });
        }
      } catch (error: unknown) {
        nodeStatus = "failed";
        const nodeExecutions = buildNodeExecutions();
        try {
          await finalizeManagerSession("failed");
        } catch (finalizationError: unknown) {
          const message =
            finalizationError instanceof Error
              ? finalizationError.message
              : "unknown manager session finalization failure";
          const failed: WorkflowSessionState = {
            ...session,
            queue,
            status: "failed",
            currentNodeId: nodeId,
            endedAt,
            nodeExecutionCounter: nextExecutionCounter,
            nodeExecutionCounts: updatedCounts,
            nodeExecutions,
            communicationCounter: session.communicationCounter,
            communications: session.communications,
            nodeBackendSessions: nextNodeBackendSessions,
            lastError: `failed to finalize manager session for ${executionTargetNoun} '${nodeId}': ${message}`,
          };
          await saveSession(failed, options);
          return err({
            exitCode: 1,
            message: failed.lastError ?? "failed to finalize manager session",
          });
        }
        const message =
          error instanceof Error
            ? error.message
            : "unknown manager control mode claim failure";
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt,
          nodeExecutionCounter: nextExecutionCounter,
          nodeExecutionCounts: updatedCounts,
          nodeExecutions,
          communicationCounter: session.communicationCounter,
          communications: session.communications,
          nodeBackendSessions: nextNodeBackendSessions,
          lastError: `invalid manager control for ${executionTargetNoun} '${nodeId}': ${message}`,
        };
        await saveSession(failed, options);
        return err({
          exitCode: 5,
          message: failed.lastError ?? "invalid manager control",
        });
      }
    }
  }
  const optionalManagerDecisionsResult = applyOptionalManagerDecisions({
    managerControl,
    session,
    workflow,
    managerStepId: nodeId,
    managerNodeExecId: nodeExecId,
    decidedAt: endedAt,
  });
  if (!optionalManagerDecisionsResult.ok) {
    nodeStatus = "failed";
    const nodeExecutions = buildNodeExecutions();
    try {
      await finalizeManagerSession("failed");
    } catch (finalizationError: unknown) {
      const message =
        finalizationError instanceof Error
          ? finalizationError.message
          : "unknown manager session finalization failure";
      const failed: WorkflowSessionState = {
        ...session,
        queue,
        status: "failed",
        currentNodeId: nodeId,
        endedAt,
        nodeExecutionCounter: nextExecutionCounter,
        nodeExecutionCounts: updatedCounts,
        nodeExecutions,
        communicationCounter: session.communicationCounter,
        communications: session.communications,
        nodeBackendSessions: nextNodeBackendSessions,
        lastError: `failed to finalize manager session for ${executionTargetNoun} '${nodeId}': ${message}`,
      };
      await saveSession(failed, options);
      return err({
        exitCode: 1,
        message: failed.lastError ?? "failed to finalize manager session",
      });
    }
    await saveSession(
      {
        ...session,
        queue,
        status: "failed",
        currentNodeId: nodeId,
        endedAt,
        nodeExecutionCounter: nextExecutionCounter,
        nodeExecutionCounts: updatedCounts,
        nodeExecutions,
        communicationCounter: session.communicationCounter,
        communications: session.communications,
        nodeBackendSessions: nextNodeBackendSessions,
        lastError: optionalManagerDecisionsResult.error,
      },
      options,
    );
    return err({
      exitCode: 5,
      message: optionalManagerDecisionsResult.error,
    });
  }
  const queuedOptionalDecisionNodeIds =
    optionalManagerDecisionsResult.value.queuedNodeIds;
  const pendingOptionalNodeDecisionsAfterManagerActions =
    optionalManagerDecisionsResult.value.pendingOptionalNodeDecisions;
  const nodeExecutions = buildNodeExecutions();
  const currentNodeExecutionCounter = nextExecutionCounter;
  const currentNodeExecutionCounts = updatedCounts;
  const currentNodeExecutions = nodeExecutions;
  const currentNodeBackendSessions = nextNodeBackendSessions;
  try {
    await finalizeManagerSession(
      nodeStatus === "succeeded" ? "completed" : "failed",
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "unknown manager session finalization failure";
    const failed: WorkflowSessionState = {
      ...session,
      queue,
      status: "failed",
      currentNodeId: nodeId,
      endedAt,
      nodeExecutionCounter: nextExecutionCounter,
      nodeExecutionCounts: updatedCounts,
      nodeExecutions,
      communicationCounter: session.communicationCounter,
      communications: session.communications,
      nodeBackendSessions: nextNodeBackendSessions,
      lastError: `failed to finalize manager session for ${executionTargetNoun} '${nodeId}': ${message}`,
    };
    await saveSession(failed, options);
    return err(
      workflowRunFailure(
        1,
        failed.lastError ?? "failed to finalize manager session",
        failed,
      ),
    );
  }
  const edges = outgoingEdges.get(nodeId) ?? [];
  const matched = edges.filter((edge: any) =>
    evaluateEdge(edge, outputPayload),
  );
  const loopIterationCounts = session.loopIterationCounts ?? {};
  let selected = matched;
  let updatedLoopIterationCounts = loopIterationCounts;
  if (loopRule !== undefined) {
    const effectiveLoopRule: LoopRule = {
      ...loopRule,
      maxIterations: loopRule.maxIterations ?? maxLoopIterations,
    };
    const iteration = loopIterationCounts[loopRule.id] ?? 0;
    const transition = resolveLoopTransition({
      loopRule: effectiveLoopRule,
      output: outputPayload,
      state: { loopId: loopRule.id, iteration },
    });
    if (transition === "continue") {
      selected = edges.filter(
        (edge: any) => edge.when === effectiveLoopRule.continueWhen,
      );
      updatedLoopIterationCounts = {
        ...loopIterationCounts,
        [loopRule.id]: iteration + 1,
      };
    } else if (transition === "exit") {
      selected = edges.filter(
        (edge: any) => edge.when === effectiveLoopRule.exitWhen,
      );
    } else {
      selected = matched.filter(
        (edge: any) =>
          edge.when !== effectiveLoopRule.continueWhen &&
          edge.when !== effectiveLoopRule.exitWhen,
      );
    }
    if (selected.length === 0 && transition !== "none") {
      const failed: WorkflowSessionState = {
        ...session,
        queue,
        status: "failed",
        currentNodeId: nodeId,
        endedAt,
        nodeExecutionCounter: nextExecutionCounter,
        nodeExecutionCounts: updatedCounts,
        nodeExecutions: [...session.nodeExecutions, buildNodeExecutionRecord()],
        loopIterationCounts: updatedLoopIterationCounts,
        nodeBackendSessions: nextNodeBackendSessions,
        lastError: `loop transition '${transition}' has no matching edge for ${executionTargetNoun} '${nodeId}'`,
      };
      await saveSession(failed, options);
      return err({
        exitCode: 4,
        message: failed.lastError ?? "invalid loop transition",
      });
    }
  }
  const localFanoutEdges = selected.filter(
    (edge: any) => edge.fanout !== undefined,
  );
  const regularSelected = selected.filter(
    (edge: any) => edge.fanout === undefined,
  );
  const nextNodes = regularSelected.map((edge: any) => edge.to);
  const outputJson = stableJson(outputPayload);
  const outputRaw = `${outputJson}\n`;
  const metaPayload = {
    nodeId,
    ...stepIdentityFields,
    nodeExecId,
    mailboxInstanceId,
    status: nodeStatus,
    startedAt,
    endedAt,
    model: executionNodePayload.model,
    timeoutMs,
    ...(stepExecutionAddress.promptVariant === undefined
      ? {}
      : { promptVariant: stepExecutionAddress.promptVariant }),
    restartAttempt,
    outputAttemptCount,
    ...(backendSessionId === undefined ? {} : { backendSessionId }),
    ...(requestedBackendSessionMode === undefined
      ? {}
      : { backendSessionMode: requestedBackendSessionMode }),
    ...(outputValidationErrors.length === 0 ? {} : { outputValidationErrors }),
    ...(previousNodeExecId === undefined
      ? {}
      : { restartedFromNodeExecId: previousNodeExecId }),
  };
  const outputRef = buildOutputRefForExecution({
    workflow,
    session: { ...session, workflowId: workflow.workflowId },
    execution: {
      nodeId,
      ...stepIdentityFields,
      nodeExecId,
      mailboxInstanceId,
      status: nodeStatus,
      artifactDir,
      startedAt,
      endedAt,
      ...(stepExecutionAddress.promptVariant === undefined
        ? {}
        : { promptVariant: stepExecutionAddress.promptVariant }),
      timeoutMs,
    },
  });
  const inputHash = sha256Hex(inputJson);
  const outputHash = sha256Hex(outputJson);
  let currentCommunications: readonly CommunicationRecord[] =
    session.communications;
  let currentCommunicationCounter = session.communicationCounter;
  const currentRuntimeVariables = isWorkflowOutputKindNode(workflow, nodeId)
    ? {
        ...session.runtimeVariables,
        workflowOutput: outputPayload["payload"],
      }
    : session.runtimeVariables;
  const handoffPayload = {
    schemaVersion: 1,
    generatedAt: endedAt,
    nodeId,
    ...stepIdentityFields,
    mailboxInstanceId,
    outputRef,
    inputHash: `sha256:${inputHash}`,
    outputHash: `sha256:${outputHash}`,
    nextNodes,
  };
  const commitMessageTemplate = buildCommitMessageTemplate(
    inputHash,
    outputHash,
    outputRef,
    nextNodes,
  );
  await writeRawTextFile(path.join(artifactDir, "output.json"), outputRaw);
  await writeJsonFile(path.join(artifactDir, "meta.json"), metaPayload);
  await writeJsonFile(path.join(artifactDir, "handoff.json"), handoffPayload);
  await writeRawTextFile(
    path.join(artifactDir, "commit-message.txt"),
    `${commitMessageTemplate}\n`,
  );
  try {
    await saveNodeExecutionToRuntimeDb(
      {
        sessionId: session.sessionId,
        nodeId,
        ...stepIdentityFields,
        nodeExecId,
        executionOrdinal: nextExecutionCounter,
        mailboxInstanceId,
        status: nodeStatus,
        artifactDir,
        startedAt,
        endedAt,
        ...(restartAttempt === 0 ? {} : { attempt: restartAttempt + 1 }),
        ...(outputAttemptCount === 1 ? {} : { outputAttemptCount }),
        ...(outputValidationErrors.length === 0
          ? {}
          : { outputValidationErrors }),
        ...(stepExecutionAddress.promptVariant === undefined
          ? {}
          : { promptVariant: stepExecutionAddress.promptVariant }),
        timeoutMs,
        ...(requestedBackendSessionMode === undefined
          ? {}
          : { backendSessionMode: requestedBackendSessionMode }),
        ...(backendSessionId === undefined ? {} : { backendSessionId }),
        ...(previousNodeExecId === undefined
          ? {}
          : { restartedFromNodeExecId: previousNodeExecId }),
        ...(llmMessages.length === 0 ? {} : { llmMessages }),
        inputJson,
        outputJson,
        inputHash: `sha256:${inputHash}`,
        outputHash: `sha256:${outputHash}`,
      },
      options,
    );
  } catch {}
  await emitWorkflowRunEvent(options, {
    type: "step-completed",
    workflowExecutionId: session.sessionId,
    stepId: stepExecutionAddress.stepId,
    nodeExecId,
    status: nodeStatus,
  });
  if (nodeStatus === "timed_out") {
    const authoredTimeoutPolicy = workflow.defaults.timeoutPolicy;
    if (
      options.restartOnStuck !== false &&
      authoredTimeoutPolicy?.onTimeout === "jump-to-step" &&
      authoredTimeoutPolicy.jumpStepId !== undefined
    ) {
      const retriesBeforeJump = authoredTimeoutPolicy.maxRetries ?? 0;
      if (restartAttempt >= retriesBeforeJump) {
        const jumpId = authoredTimeoutPolicy.jumpStepId;
        if (!workflowNodes.has(jumpId)) {
          const failed: WorkflowSessionState = {
            ...session,
            queue,
            status: "failed",
            currentNodeId: nodeId,
            endedAt,
            nodeExecutionCounter: nextExecutionCounter,
            nodeExecutionCounts: updatedCounts,
            nodeExecutions,
            communicationCounter: currentCommunicationCounter,
            communications: currentCommunications,
            nodeBackendSessions: nextNodeBackendSessions,
            lastError: `${executionTargetNoun} timeout at '${nodeId}': timeout policy jump target '${jumpId}' is not a known workflow ${executionTargetNoun}`,
          };
          await saveSession(failed, options);
          return err({
            exitCode: 6,
            message: failed.lastError ?? `${executionTargetNoun} timeout`,
          });
        }
        session = {
          ...session,
          status: "running",
          queue: [...dedupeNodeIds([jumpId, ...queue])],
          currentNodeId: nodeId,
          nodeExecutionCounter: nextExecutionCounter,
          nodeExecutionCounts: updatedCounts,
          nodeExecutions,
          communicationCounter: currentCommunicationCounter,
          communications: currentCommunications,
          nodeBackendSessions: nextNodeBackendSessions,
          lastError: `${executionTargetNoun} timeout at '${nodeId}', jumping to '${jumpId}'`,
        };
        await saveSession(session, options);
        return { kind: "done", session };
      }
    }
    const { allowRestart, maxRestarts } = resolveTimeoutRestartBudget(
      authoredTimeoutPolicy,
      options,
      restartAttempt,
    );
    if (allowRestart && restartAttempt < maxRestarts) {
      const restartCountForNode = (session.restartCounts?.[nodeId] ?? 0) + 1;
      const restartEvents = [
        ...(session.restartEvents ?? []),
        {
          nodeId,
          fromNodeExecId: nodeExecId,
          restartAttempt: restartAttempt + 1,
          reason: "stuck_timeout" as const,
          at: endedAt,
        },
      ];
      session = {
        ...session,
        status: "running",
        queue,
        currentNodeId: nodeId,
        nodeExecutionCounter: nextExecutionCounter,
        nodeExecutionCounts: updatedCounts,
        restartCounts: {
          ...(session.restartCounts ?? {}),
          [nodeId]: restartCountForNode,
        },
        restartEvents,
        nodeExecutions,
        communicationCounter: currentCommunicationCounter,
        communications: currentCommunications,
        nodeBackendSessions: nextNodeBackendSessions,
        lastError: `stuck detected for ${executionTargetNoun} '${nodeId}', restarting attempt ${restartAttempt + 1}`,
      };
      await saveSession(session, options);
      previousNodeExecId = nodeExecId;
      restartAttempt += 1;
      if (stuckRestartBackoffMs > 0) {
        await sleep(stuckRestartBackoffMs);
      }
      return { kind: "restart", session, previousNodeExecId, restartAttempt };
    }
    const failed: WorkflowSessionState = {
      ...session,
      queue,
      status: "failed",
      currentNodeId: nodeId,
      endedAt,
      nodeExecutionCounter: nextExecutionCounter,
      nodeExecutionCounts: updatedCounts,
      nodeExecutions,
      communicationCounter: currentCommunicationCounter,
      communications: currentCommunications,
      nodeBackendSessions: nextNodeBackendSessions,
      lastError: `${executionTargetNoun} timeout at '${nodeId}'`,
    };
    await saveSession(failed, options);
    return err(
      workflowRunFailure(
        6,
        failed.lastError ?? `${executionTargetNoun} timeout`,
        failed,
      ),
    );
  }
  if (nodeStatus === "failed") {
    const providerErrMessage = (() => {
      const p = outputPayload["payload"];
      if (typeof p !== "object" || p === null) {
        return undefined;
      }
      const m = (p as Readonly<Record<string, unknown>>)[
        "providerErrorMessage"
      ];
      return typeof m === "string" && m.length > 0 ? m : undefined;
    })();
    const failureReason: string =
      providerErrMessage !== undefined &&
      isSupervisionStallLastError(providerErrMessage)
        ? providerErrMessage
        : outputPayload["error"] === "invalid_output"
          ? `invalid adapter output for ${executionTargetNoun} '${nodeId}'`
          : outputValidationErrors.length > 0
            ? `output validation failed for ${executionTargetNoun} '${nodeId}'`
            : `adapter failure for ${executionTargetNoun} '${nodeId}'`;
    const failed: WorkflowSessionState = {
      ...session,
      queue,
      status: "failed",
      currentNodeId: nodeId,
      endedAt,
      nodeExecutionCounter: nextExecutionCounter,
      nodeExecutionCounts: updatedCounts,
      nodeExecutions,
      communicationCounter: currentCommunicationCounter,
      communications: currentCommunications,
      nodeBackendSessions: nextNodeBackendSessions,
      lastError: failureReason,
    };
    await saveSession(failed, options);
    return err(
      workflowRunFailure(5, failed.lastError ?? "adapter failure", failed),
    );
  }
  const completion = evaluateCompletion({
    rule: nodeRef.completion,
    output: outputPayload,
  });
  if (!completion.passed) {
    const failed: WorkflowSessionState = {
      ...session,
      queue,
      status: "failed",
      currentNodeId: nodeId,
      endedAt,
      nodeExecutionCounter: nextExecutionCounter,
      nodeExecutionCounts: updatedCounts,
      nodeExecutions,
      loopIterationCounts: updatedLoopIterationCounts,
      communicationCounter: currentCommunicationCounter,
      communications: currentCommunications,
      nodeBackendSessions: nextNodeBackendSessions,
      lastError:
        completion.reason === null
          ? `completion condition not met for ${executionTargetNoun} '${nodeId}'`
          : `completion condition not met for ${executionTargetNoun} '${nodeId}': ${completion.reason}`,
    };
    await saveSession(failed, options);
    return err(
      workflowRunFailure(
        3,
        failed.lastError ?? "completion condition not met",
        failed,
      ),
    );
  }
  const consumedCommunicationsResult = await markCommunicationsConsumed(
    { ...session, communications: currentCommunications },
    upstreamCommunicationIds,
    nodeExecId,
    endedAt,
  );
  if (!consumedCommunicationsResult.ok) {
    const failed: WorkflowSessionState = {
      ...session,
      queue,
      status: "failed",
      currentNodeId: nodeId,
      endedAt,
      nodeExecutionCounter: nextExecutionCounter,
      nodeExecutionCounts: updatedCounts,
      nodeExecutions,
      loopIterationCounts: updatedLoopIterationCounts,
      communicationCounter: currentCommunicationCounter,
      communications: currentCommunications,
      nodeBackendSessions: nextNodeBackendSessions,
      lastError: consumedCommunicationsResult.error,
    };
    await saveSession(failed, options);
    return err(
      workflowRunFailure(
        1,
        failed.lastError ?? "mailbox consumption persistence failed",
        failed,
      ),
    );
  }
  currentCommunications = consumedCommunicationsResult.value;
  const transitionCommunications = await Promise.all(
    regularSelected.map((edge: any, index: number) => {
      return persistCommunicationArtifact({
        artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
        runtimeLogOptions: options,
        workflowId: workflow.workflowId,
        workflowExecutionId: session.sessionId,
        communicationCounter: currentCommunicationCounter + index,
        fromNodeId: edge.from,
        toNodeId: edge.to,
        routingScope: "intra-workflow",
        deliveryKind: edge.to === edge.from ? "loop-back" : "edge-transition",
        transitionWhen: edge.when,
        sourceNodeExecId: nodeExecId,
        payloadRef: outputRef,
        outputRaw,
        deliveredByNodeId: resolveWorkflowManagerStepId(workflow),
        createdAt: endedAt,
      });
    }),
  );
  currentCommunications = [
    ...currentCommunications,
    ...transitionCommunications,
  ];
  currentCommunicationCounter += transitionCommunications.length;
  const transitionFinalization = await finalizeStepTransitions({
    session,
    workflowName,
    workflow,
    nextExecutionCounter,
    updatedCounts,
    nodeExecutions,
    currentCommunicationCounter,
    currentCommunications,
    nextNodeBackendSessions,
    currentRuntimeVariables,
    options,
    loaded,
    nodeId,
    stepExecutionAddress,
    nodeExecId,
    artifactDir,
    outputPayload,
    endedAt,
    effectiveAdapter,
    guards,
    crossWorkflowInvocationStack,
    nodeMap,
    localFanoutEdges,
    queue,
    updatedLoopIterationCounts,
    currentNodeExecutionCounter,
    currentNodeExecutionCounts,
    currentNodeExecutions,
    currentNodeBackendSessions,
    outputRaw,
    regularSelected,
    outputRef,
    managerControl,
    queuedOptionalDecisionNodeIds,
    isOptionalExecutionNode,
    pendingOptionalNodeDecisionsAfterManagerActions,
  });
  return transitionFinalization;
}
