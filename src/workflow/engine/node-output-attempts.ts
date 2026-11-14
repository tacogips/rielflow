// @ts-nocheck
// biome-ignore-all lint/correctness/noUnusedVariables: shared lifecycle dependency extraction keeps original helper names available.
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
  executeNativeNodeWithTimeout,
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
    let finalizedOutput: Readonly<Record<string, unknown>> | undefined;
    const hasOutputContract = executionNodePayload.output !== undefined;
    const maxOutputAttempts = hasOutputContract
      ? resolveOutputValidationAttempts(executionNodePayload)
      : 1;
    for (
      let outputAttempt = 1;
      outputAttempt <= maxOutputAttempts;
      outputAttempt += 1
    ) {
      outputAttemptCount = outputAttempt;
      const outputAttemptId = hasOutputContract
        ? nextOutputAttemptId(outputAttempt)
        : undefined;
      const attemptDir =
        outputAttemptId === undefined
          ? undefined
          : path.join(artifactDir, "output-attempts", outputAttemptId);
      const candidateArtifactPath =
        attemptDir === undefined
          ? undefined
          : path.join(attemptDir, "candidate.json");
      const candidatePath =
        outputAttemptId === undefined || agentNodePayload === null
          ? undefined
          : buildReservedCandidateSubmissionPath({
              workflowId: workflow.workflowId,
              workflowExecutionId: session.sessionId,
              nodeId,
              nodeExecId,
              outputAttemptId,
            });
      const requestPath =
        attemptDir === undefined
          ? undefined
          : path.join(attemptDir, "request.json");
      const validationPath =
        attemptDir === undefined
          ? undefined
          : path.join(attemptDir, "validation.json");
      if (
        attemptDir !== undefined &&
        candidatePath !== undefined &&
        requestPath !== undefined
      ) {
        await mkdir(attemptDir, { recursive: true });
        await mkdir(path.dirname(candidatePath), { recursive: true });
        await rm(candidatePath, { force: true });
      }
      const executionPromptText =
        candidatePath === undefined || agentNodePayload === null
          ? effectivePromptText
          : buildOutputPromptText({
              basePromptText: effectivePromptText,
              node: agentNodePayload,
              candidatePath,
              validationErrors: outputValidationErrors,
            });
      const retryValidationFeedback = buildRetryValidationFeedback(
        outputValidationErrors,
      );
      if (requestPath !== undefined && candidatePath !== undefined) {
        await writeJsonFile(requestPath, {
          attempt: outputAttempt,
          executionBackend:
            agentNodePayload?.executionBackend ??
            executionNodePayload.nodeType ??
            "agent",
          model: agentNodePayload?.model ?? executionNodePayload.nodeType,
          promptText: executionPromptText,
          candidatePath,
          validationErrors: retryValidationFeedback,
        });
      }
      try {
        const contractCandidatePath = hasOutputContract
          ? candidatePath
          : undefined;
        const outputCandidatePath = contractCandidatePath;
        if (
          hasOutputContract &&
          agentNodePayload !== null &&
          outputCandidatePath === undefined
        ) {
          throw new Error(
            "candidate path must exist when node.output is configured",
          );
        }
        const adapterOutputContract =
          !hasOutputContract ||
          agentNodePayload === null ||
          agentNodePayload.output === undefined
            ? undefined
            : (() => {
                if (outputCandidatePath === undefined) {
                  throw new Error(
                    "candidate path must exist when node.output is configured",
                  );
                }
                return {
                  ...(agentNodePayload.output.description === undefined
                    ? {}
                    : { description: agentNodePayload.output.description }),
                  ...(agentNodePayload.output.jsonSchema === undefined
                    ? {}
                    : { jsonSchema: agentNodePayload.output.jsonSchema }),
                  maxValidationAttempts: maxOutputAttempts,
                  attempt: outputAttempt,
                  candidatePath: outputCandidatePath,
                  validationErrors: retryValidationFeedback,
                  publication: buildOutputPublicationPolicy(),
                };
              })();
        const supervisionStall = buildSupervisionStallWatch(session, options, {
          ...(executionNodePayload.stallTimeoutMs === undefined
            ? {}
            : { stallTimeoutMs: executionNodePayload.stallTimeoutMs }),
        });
        const execution =
          agentNodePayload !== null
            ? await executeAdapterWithTimeout(
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
                  ...(systemPromptText === undefined
                    ? {}
                    : { systemPromptText }),
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
                  ...(backendSession === undefined ? {} : { backendSession }),
                  ...(ambientManagerContext === undefined
                    ? {}
                    : { ambientManagerContext }),
                  ...(adapterOutputContract === undefined
                    ? {}
                    : { output: adapterOutputContract }),
                },
                timeoutMs,
                supervisionStall,
              )
            : await executeNativeNodeWithTimeout({
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
        if (!execution.ok) {
          processLogs = [
            ...processLogs,
            ...(execution.error.processLogs ?? []),
          ];
          if (
            execution.error.code === "invalid_output" &&
            hasOutputContract &&
            validationPath !== undefined
          ) {
            outputValidationErrors = [
              { path: "$", message: execution.error.message },
            ];
            await writeJsonFile(validationPath, {
              valid: false,
              errors: outputValidationErrors,
              rejectedAt: nowIso(),
            });
            if (outputAttempt === maxOutputAttempts) {
              nodeStatus = "failed";
              finalizedOutput = {
                provider: "deterministic-local",
                model:
                  agentNodePayload?.model ??
                  executionNodePayload.nodeType ??
                  "node",
                promptText: effectivePromptText,
                completionPassed: false,
                when: {},
                payload: {},
                error: "output_validation_failed",
                validationErrors: outputValidationErrors,
              };
              break;
            }
            continue;
          }
          outputValidationErrors = [];
          nodeStatus =
            execution.error.code === "timeout" ? "timed_out" : "failed";
          finalizedOutput = {
            provider: "deterministic-local",
            model:
              agentNodePayload?.model ??
              executionNodePayload.nodeType ??
              "node",
            promptText: effectivePromptText,
            completionPassed: false,
            when: {},
            payload:
              execution.error.code === "provider_error" &&
              execution.error.message.length > 0
                ? { providerErrorMessage: execution.error.message }
                : {},
            error: execution.error.code,
          };
          break;
        }
        backendSessionProvider = execution.value.provider;
        processLogs = [...processLogs, ...(execution.value.processLogs ?? [])];
        llmMessages = [...llmMessages, ...(execution.value.llmMessages ?? [])];
        if (execution.value.backendSession?.sessionId !== undefined) {
          backendSession = {
            mode: "reuse",
            sessionId: execution.value.backendSession.sessionId,
          };
          backendSessionId = execution.value.backendSession.sessionId;
        }
        if (
          !hasOutputContract &&
          execution.value.candidateFilePath !== undefined
        ) {
          outputValidationErrors = [
            { path: "$", message: NON_CONTRACT_CANDIDATE_FILE_ERROR },
          ];
          nodeStatus = "failed";
          finalizedOutput = {
            provider: execution.value.provider,
            model: execution.value.model,
            promptText: effectivePromptText,
            completionPassed: false,
            when: {},
            payload: {},
            error: "invalid_output",
            validationErrors: outputValidationErrors,
          };
          break;
        }
        if (!hasOutputContract) {
          finalizedOutput = {
            provider: execution.value.provider,
            model: execution.value.model,
            promptText: effectivePromptText,
            completionPassed: execution.value.completionPassed,
            when: execution.value.when,
            payload: execution.value.payload,
          };
          break;
        }
        const candidateResult =
          contractCandidatePath === undefined
            ? ok(execution.value.payload)
            : await resolveCandidatePayload({
                expectedCandidatePath: contractCandidatePath,
                execution: execution.value,
              });
        if (!candidateResult.ok) {
          outputValidationErrors = [
            { path: "$", message: candidateResult.error.message },
          ];
          if (validationPath !== undefined) {
            await writeJsonFile(validationPath, {
              valid: false,
              errors: outputValidationErrors,
              rejectedAt: nowIso(),
            });
          }
          if (
            candidateResult.error.retryable &&
            outputAttempt < maxOutputAttempts
          ) {
            continue;
          }
          nodeStatus = "failed";
          finalizedOutput = {
            provider: execution.value.provider,
            model: execution.value.model,
            promptText: effectivePromptText,
            completionPassed: false,
            when: {},
            payload: {},
            error: candidateResult.error.retryable
              ? "output_validation_failed"
              : "invalid_output",
            validationErrors: outputValidationErrors,
          };
          break;
        }
        let normalizedContractPayload: ReturnType<
          typeof normalizeOutputContractEnvelope
        >;
        try {
          normalizedContractPayload = normalizeOutputContractEnvelope(
            candidateResult.value,
            "node output candidate",
            {
              completionPassed: execution.value.completionPassed,
              when: execution.value.when,
            },
          );
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : "invalid output contract envelope";
          outputValidationErrors = [{ path: "$", message }];
          if (validationPath !== undefined) {
            await writeJsonFile(validationPath, {
              valid: false,
              errors: outputValidationErrors,
              rejectedAt: nowIso(),
            });
          }
          if (outputAttempt < maxOutputAttempts) {
            continue;
          }
          nodeStatus = "failed";
          finalizedOutput = {
            provider: execution.value.provider,
            model: execution.value.model,
            promptText: effectivePromptText,
            completionPassed: false,
            when: {},
            payload: {},
            error: "output_validation_failed",
            validationErrors: outputValidationErrors,
          };
          break;
        }
        if (candidateArtifactPath !== undefined) {
          await writeJsonFile(
            candidateArtifactPath,
            normalizedContractPayload.payload,
          );
        }
        const schema = executionNodePayload.output?.jsonSchema;
        const validationErrors =
          schema === undefined
            ? []
            : validateJsonValueAgainstSchema({
                schema: schema as JsonObject,
                value: normalizedContractPayload.payload,
              });
        outputValidationErrors = validationErrors;
        if (validationPath !== undefined) {
          await writeJsonFile(validationPath, {
            valid: validationErrors.length === 0,
            errors: validationErrors,
            validatedAt: nowIso(),
          });
        }
        if (validationErrors.length === 0) {
          finalizedOutput = {
            provider: execution.value.provider,
            model: execution.value.model,
            promptText: effectivePromptText,
            completionPassed: normalizedContractPayload.completionPassed,
            when: normalizedContractPayload.when,
            payload: normalizedContractPayload.payload,
          };
          break;
        }
        if (outputAttempt === maxOutputAttempts) {
          nodeStatus = "failed";
          finalizedOutput = {
            provider: execution.value.provider,
            model: execution.value.model,
            promptText: effectivePromptText,
            completionPassed: false,
            when: {},
            payload: {},
            error: "output_validation_failed",
            validationErrors,
          };
          break;
        }
      } finally {
        if (candidatePath !== undefined) {
          await cleanupReservedCandidateSubmissionPath(candidatePath);
        }
      }
    }
    outputPayload = finalizedOutput ?? {
      provider: "deterministic-local",
      model: agentNodePayload?.model ?? executionNodePayload.nodeType ?? "node",
      promptText: effectivePromptText,
      completionPassed: false,
      when: {},
      payload: {},
      error: "provider_error",
    };
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
