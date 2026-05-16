// @ts-nocheck
// biome-ignore-all lint/correctness/noUnusedVariables: shared lifecycle dependency extraction keeps original helper names available.
import { runOutputAttempts } from "../output-attempt-runner";
import { workflowRunnerDeps } from "./workflow-runner-deps";

const {
  mkdir,
  rm,
  path,
  writeJsonFile,
  writeRawTextFile,
  buildAdapterDivedraHookContext,
  normalizeOutputContractEnvelope,
  executeAdapterWithTimeout,
  executePackageNodeWithTimeout,
  DispatchingNodeAdapter,
  claimFanoutStepBudget,
  loadContinuationRelatedSnapshots,
  resolveContinuationAnchorPlacement,
  assembleNodeInput,
  validateJsonValueAgainstSchema,
  loadWorkflowFromDisk,
  appendMailboxPromptGuidance,
  parseManagerControlPayload,
  buildAmbientManagerControlPlaneEnvironment,
  createManagerSessionStore,
  hashManagerAuthToken,
  mintManagerAuthToken,
  createExecutionCopyMutableWorkspace,
  buildNodeExecutionMailbox,
  writeNodeExecutionMailboxArtifacts,
  describeWorkflowNodeKind,
  isManagerNodeRef,
  resolveEffectiveRoots,
  composeExecutionPrompts,
  err,
  ok,
  isWorkflowOutputKindNode,
  resolveBackendSessionSelection,
  resolveRequiredStepExecutionAddress,
  toStepIdentityFields,
  saveNodeExecutionToRuntimeDb,
  saveProcessLogsToRuntimeDb,
  inspectWorkflowRuntimeReadiness,
  ScenarioNodeAdapter,
  evaluateCompletion,
  resolveLoopTransition,
  buildOutputRefForExecution,
  createSessionId,
  createSessionState,
  persistNodeBackendSession,
  resolveRequestedBackendSession,
  loadSession,
  saveSession,
  buildSupervisionStallWatch,
  isSupervisionStallLastError,
  getNormalizedNodePayload,
  getStructuralEdges,
  getStructuralLoops,
  resolveWorkflowManagerStepId,
  resolveNodeExecutionWorkingDirectory,
  resolveWorkflowExecutionWorkingDirectory,
  NON_CONTRACT_CANDIDATE_FILE_ERROR,
  addMillisecondsToIso,
  buildOptionalSkipOutput,
  buildOutputPromptText,
  buildOutputPublicationPolicy,
  buildReservedCandidateSubmissionPath,
  buildRetryValidationFeedback,
  cleanupReservedCandidateSubmissionPath,
  dedupeNodeIds,
  describeAmbiguousFanoutBranchRerunTarget,
  emitWorkflowRunEvent,
  evaluateEdge,
  findOwningManagerNodeId,
  findPendingOptionalNodeDecision,
  hasPendingPausedFanoutBranch,
  mergeVariables,
  nextManagerSessionId,
  nextNodeExecId,
  nextOutputAttemptId,
  notifyWorkflowProgress,
  nowIso,
  removePendingOptionalNodeDecision,
  resolveCandidatePayload,
  resolveOutputValidationAttempts,
  resolveTimeoutMs,
  resolveTimeoutRestartBudget,
  sha256Hex,
  sleep,
  stableJson,
  upsertPendingOptionalNodeDecision,
  workflowRunFailure,
  applyOptionalManagerDecisions,
  executeCrossWorkflowDispatchesForNode,
  executeLocalFanoutTransition,
  runNestedSuperviserSessionDriver,
  buildLatestOutputMailboxIndex,
  buildCommitMessageTemplate,
  buildScenarioExecutableNodePayload,
  buildUpstreamInputs,
  cloneSession,
  cloneSupervisionForContinuedRun,
  createInitialSupervisionRunState,
  isTerminalStatus,
  markCommunicationsConsumed,
  persistCommunicationArtifact,
  persistExternalMailboxInputCommunication,
  readBusinessPayload,
  finalizeCompletedWorkflowRun,
} = workflowRunnerDeps;

export async function resolveNodeExecutionOutput(input) {
  let {
    options,
    agentNodePayload,
    executionNodePayload,
    systemPromptText,
    effectivePromptText,
    outputPayload,
    nodeStatus,
    outputValidationErrors,
    outputAttemptCount,
    processLogs,
    llmMessages,
    finalizedOutput,
    backendSessionProvider,
    backendSession,
    backendSessionId,
    workflow,
    session,
    nodeId,
    nodeExecId,
    artifactDir,
    loaded,
    workflowWorkingDirectory,
    mergedVariables,
    assembledArguments,
    upstreamCommunicationIds,
    executionMailbox,
    mailboxDir,
    ambientManagerContext,
    effectiveAdapter,
    timeoutMs,
    assembledPromptText,
    nextCount,
  } = input;
  if (options.dryRun === true) {
    outputPayload = {
      provider: "dry-run",
      model:
        agentNodePayload?.model ??
        `${executionNodePayload.nodeType ?? "agent"}-dry-run`,
      ...(systemPromptText === undefined ? {} : { systemPromptText }),
      promptText: effectivePromptText,
      completionPassed: true,
      when: { always: true },
      payload: { skippedExecution: true },
    };
  } else {
    const attemptResult = await runOutputAttempts({
      workflowId: workflow.workflowId,
      workflowExecutionId: session.sessionId,
      nodeId,
      nodeExecId,
      artifactDir,
      agentNodePayload,
      executionNodePayload,
      basePromptText: effectivePromptText,
      ...(systemPromptText === undefined ? {} : { systemPromptText }),
      initialOutputValidationErrors: outputValidationErrors,
      initialProcessLogs: processLogs,
      initialLlmMessages: llmMessages,
      ...(backendSession === undefined
        ? {}
        : { initialBackendSession: backendSession }),
      clearValidationErrorsOnExecutionFailure: true,
      executeAttempt: async ({
        executionPromptText,
        outputContract,
        backendSession: currentBackendSession,
      }) => {
        const supervisionStall = buildSupervisionStallWatch(session, options, {
          ...(executionNodePayload.stallTimeoutMs === undefined
            ? {}
            : { stallTimeoutMs: executionNodePayload.stallTimeoutMs }),
        });
        if (agentNodePayload !== null) {
          return await executeAdapterWithTimeout(
            effectiveAdapter,
            {
              workflowId: workflow.workflowId,
              workflowExecutionId: session.sessionId,
              nodeId,
              nodeExecId,
              node: agentNodePayload,
              workingDirectory: resolveNodeExecutionWorkingDirectory(
                workflowWorkingDirectory,
                agentNodePayload.workingDirectory,
              ),
              mergedVariables,
              ...(systemPromptText === undefined ? {} : { systemPromptText }),
              promptText: executionPromptText,
              arguments: assembledArguments,
              executionIndex: nextCount,
              artifactDir,
              upstreamCommunicationIds,
              executionMailbox,
              divedraHookContext: buildAdapterDivedraHookContext({
                workflowId: workflow.workflowId,
                workflowExecutionId: session.sessionId,
                nodeId,
                nodeExecId,
                mailboxDir,
                ...(agentNodePayload.executionBackend === undefined
                  ? {}
                  : {
                      agentBackend: agentNodePayload.executionBackend,
                    }),
              }),
              ...(currentBackendSession === undefined
                ? {}
                : { backendSession: currentBackendSession }),
              ...(ambientManagerContext === undefined
                ? {}
                : { ambientManagerContext }),
              ...(outputContract === undefined
                ? {}
                : { output: outputContract }),
            },
            timeoutMs,
            supervisionStall,
          );
        }
        return await executePackageNodeWithTimeout({
          workflowDirectory: loaded.value.workflowDirectory,
          workflowWorkingDirectory,
          artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
          workflowId: workflow.workflowId,
          workflowDescription: workflow.description,
          workflowExecutionId: session.sessionId,
          nodeId,
          nodeExecId,
          node: executionNodePayload,
          workflowDefaults: workflow.defaults,
          runtimeVariables: session.runtimeVariables,
          mergedVariables,
          arguments: assembledArguments,
          artifactDir,
          executionMailbox,
          ...(options.eventReplyDispatcher === undefined
            ? {}
            : { chatReplyDispatcher: options.eventReplyDispatcher }),
          ...(options.env === undefined ? {} : { env: options.env }),
          ...(options.superviserControl === undefined
            ? {}
            : { superviserControl: options.superviserControl }),
          timeoutMs,
          ...(supervisionStall === undefined ? {} : { supervisionStall }),
        });
      },
    });
    outputPayload = attemptResult.outputPayload;
    nodeStatus = attemptResult.nodeStatus;
    outputValidationErrors = attemptResult.outputValidationErrors;
    outputAttemptCount = attemptResult.outputAttemptCount;
    processLogs = attemptResult.processLogs;
    llmMessages = attemptResult.llmMessages;
    backendSessionProvider = attemptResult.backendSessionProvider;
    backendSession = attemptResult.backendSession;
    backendSessionId = attemptResult.backendSessionId;
  }
  return {
    outputPayload,
    nodeStatus,
    outputValidationErrors,
    outputAttemptCount,
    processLogs,
    llmMessages,
    backendSessionProvider,
    backendSession,
    backendSessionId,
  };
}
