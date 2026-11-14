// @ts-nocheck
// biome-ignore-all lint/correctness/noUnusedVariables: shared lifecycle dependency extraction keeps original helper names available.
import { workflowRunnerDeps } from "./workflow-runner-deps";
import { resolveNodeExecutionOutput } from "./node-output-attempts";
import { handlePreparedStepInput } from "./step-input";
import { finalizeExecutedNode } from "./step-result-finalization";

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

export async function runWorkflowQueue(input) {
  let {
    session,
    workflow,
    options,
    loaded,
    loopRuleByJudgeNodeId,
    cancellationProbe,
    workflowNodes,
    nodeMap,
    stepAddressedExecution,
    executionTargetNoun,
    workflowName,
    workflowWorkingDirectory,
    effectiveAdapter,
    managerSessionStore,
    guards,
    crossWorkflowInvocationStack,
  } = input;
  const outgoingEdges = new Map<string, WorkflowEdge[]>();
  getStructuralEdges(workflow).forEach((edge) => {
    const current = outgoingEdges.get(edge.from);
    if (current) {
      current.push(edge);
      return;
    }
    outgoingEdges.set(edge.from, [edge]);
  });
  const maxLoopIterations =
    options.maxLoopIterations ?? workflow.defaults.maxLoopIterations;
  const maxSteps = options.maxSteps;
  const stuckRestartBackoffMs = options.stuckRestartBackoffMs ?? 250;
  if (
    (session.activeUserActions?.length ?? 0) > 0 &&
    session.status === "paused"
  ) {
    return ok({ session, exitCode: 4 });
  }
  let continuationSnapshotsForMergedReads:
    | ReadonlyMap<string, WorkflowSessionState>
    | undefined;
  if (
    session.historyImports !== undefined &&
    session.historyImports.length > 0
  ) {
    const snapLoad = await loadContinuationRelatedSnapshots([session], options);
    if (!snapLoad.ok) {
      return err(
        workflowRunFailure(
          1,
          `history-linked continuation snapshot load failed: ${snapLoad.error}`,
          session,
        ),
      );
    }
    continuationSnapshotsForMergedReads = snapLoad.value;
  }
  while (session.queue.length > 0) {
    const persisted = await loadSession(session.sessionId, options);
    if (persisted.ok && isTerminalStatus(persisted.value.status)) {
      if (persisted.value.status === "completed") {
        return ok({ session: persisted.value, exitCode: 0 });
      }
      const exitCode = persisted.value.status === "cancelled" ? 130 : 1;
      return err(
        workflowRunFailure(
          exitCode,
          persisted.value.lastError ?? `session ${persisted.value.status}`,
          persisted.value,
        ),
      );
    }
    if (await cancellationProbe.isCancelled(session.sessionId)) {
      const cancelled: WorkflowSessionState = {
        ...session,
        status: "cancelled",
        ...(session.queue[0] === undefined
          ? {}
          : { currentNodeId: session.queue[0] }),
        endedAt: nowIso(),
        lastError: "cancelled by external request",
      };
      await saveSession(cancelled, options);
      return err(
        workflowRunFailure(130, cancelled.lastError ?? "cancelled", cancelled),
      );
    }
    if (maxSteps !== undefined && session.nodeExecutionCounter >= maxSteps) {
      const paused: WorkflowSessionState = {
        ...session,
        status: "paused",
        ...(session.queue[0] === undefined
          ? {}
          : { currentNodeId: session.queue[0] }),
        endedAt: nowIso(),
        lastError: `max steps reached (${maxSteps})`,
      };
      await saveSession(paused, options);
      return ok({ session: paused, exitCode: 4 });
    }
    if (!claimFanoutStepBudget(options.fanoutStepBudget)) {
      const paused: WorkflowSessionState = {
        ...session,
        status: "paused",
        ...(session.queue[0] === undefined
          ? {}
          : { currentNodeId: session.queue[0] }),
        endedAt: nowIso(),
        lastError:
          maxSteps === undefined
            ? "fanout step budget reached"
            : `fanout max steps reached (${maxSteps})`,
      };
      await saveSession(paused, options);
      return ok({ session: paused, exitCode: 4 });
    }
    const queue = [...session.queue];
    const nodeId = queue.shift();
    if (nodeId === undefined) {
      break;
    }
    const nodeRef = workflowNodes.get(nodeId);
    const nodePayload = getNormalizedNodePayload(loaded.value.bundle, nodeId);
    if (!nodeRef || !nodePayload) {
      const failed: WorkflowSessionState = {
        ...session,
        queue,
        status: "failed",
        currentNodeId: nodeId,
        endedAt: nowIso(),
        lastError: stepAddressedExecution
          ? `missing step definition for '${nodeId}'`
          : `missing node definition for '${nodeId}'`,
      };
      await saveSession(failed, options);
      return err(
        workflowRunFailure(
          1,
          failed.lastError ??
            (stepAddressedExecution
              ? "missing step definition"
              : "missing node definition"),
          failed,
        ),
      );
    }
    const pendingOptionalDecision = findPendingOptionalNodeDecision(
      session,
      nodeId,
    );
    const isOptionalExecutionNode = nodeRef.execution?.mode === "optional";
    if (
      isOptionalExecutionNode &&
      (pendingOptionalDecision === undefined ||
        pendingOptionalDecision.status === "pending")
    ) {
      const requestedAt = nowIso();
      const owningManagerStepId = findOwningManagerNodeId(workflow, nodeId);
      session = {
        ...session,
        status: "running",
        queue: dedupeNodeIds([...queue, owningManagerStepId]),
        currentNodeId: owningManagerStepId,
        pendingOptionalNodeDecisions: upsertPendingOptionalNodeDecision(
          session.pendingOptionalNodeDecisions ?? [],
          {
            nodeId,
            owningManagerStepId,
            requestedAt,
            status: "pending",
          },
        ),
      };
      await saveSession(session, options);
      continue;
    }
    const skipOptionalNode =
      isOptionalExecutionNode && pendingOptionalDecision?.status === "skip";
    const executableNodePayload = buildScenarioExecutableNodePayload(
      nodePayload,
      options.mockScenario?.[nodeId] !== undefined,
      options.mockScenario !== undefined,
      options.dryRun === true,
    );
    const agentNodePayload = executableNodePayload;
    const nativeNodePayload =
      executableNodePayload === null &&
      (nodePayload.nodeType === "command" ||
        nodePayload.nodeType === "container" ||
        nodePayload.nodeType === "addon")
        ? nodePayload
        : null;
    if (
      agentNodePayload === null &&
      nativeNodePayload === null &&
      nodePayload.nodeType !== "user-action" &&
      !skipOptionalNode
    ) {
      const failed: WorkflowSessionState = {
        ...session,
        queue,
        status: "failed",
        currentNodeId: nodeId,
        endedAt: nowIso(),
        lastError: stepAddressedExecution
          ? `step '${nodeId}' is missing executable fields`
          : `node '${nodeId}' is missing executable node fields`,
      };
      await saveSession(failed, options);
      return err(
        workflowRunFailure(
          1,
          failed.lastError ??
            (stepAddressedExecution
              ? "invalid step execution payload"
              : "invalid node execution payload"),
          failed,
        ),
      );
    }
    let restartAttempt = 0;
    let previousNodeExecId: string | undefined;
    for (;;) {
      const nextCount = (session.nodeExecutionCounts[nodeId] ?? 0) + 1;
      const updatedCounts = {
        ...session.nodeExecutionCounts,
        [nodeId]: nextCount,
      };
      const loopRule = loopRuleByJudgeNodeId.get(nodeId);
      const nextExecutionCounter = session.nodeExecutionCounter + 1;
      const nodeExecId = nextNodeExecId(nextExecutionCounter);
      const workflowExecutionRoot = path.join(
        loaded.value.artifactWorkflowRoot,
        "executions",
        session.sessionId,
      );
      const artifactDir = path.join(
        workflowExecutionRoot,
        "nodes",
        nodeId,
        nodeExecId,
      );
      await mkdir(artifactDir, { recursive: true });
      const executionNodePayload = agentNodePayload ?? nodePayload;
      const stepExecutionAddress = resolveRequiredStepExecutionAddress(
        workflow,
        nodeId,
      );
      if (stepExecutionAddress === undefined) {
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt: nowIso(),
          lastError: `normalized workflow runtime node '${nodeId}' is missing its authored step definition`,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            1,
            failed.lastError ?? "missing step execution address",
            failed,
          ),
        );
      }
      await emitWorkflowRunEvent(options, {
        type: "step-started",
        workflowExecutionId: session.sessionId,
        stepId: stepExecutionAddress.stepId,
        nodeExecId,
        workflowName,
        workflowId: workflow.workflowId,
        nodeId,
        attempt: nextCount,
        queuedStepIds: queue,
      });
      notifyWorkflowProgress(options, {
        type: "step-start",
        sessionId: session.sessionId,
        workflowName,
        workflowId: workflow.workflowId,
        stepId: stepExecutionAddress.stepId,
        nodeId,
        nodeExecId,
        attempt: nextCount,
        queuedStepIds: queue,
      });
      const stepIdentityFields = toStepIdentityFields(stepExecutionAddress);
      const mailboxInstanceId = nodeExecId;
      const mergedVariables = mergeVariables(
        executionNodePayload.variables,
        session.runtimeVariables,
      );
      const upstreamInputsResult = await buildUpstreamInputs(
        workflow,
        session,
        nodeId,
        continuationSnapshotsForMergedReads,
      );
      if (!upstreamInputsResult.ok) {
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt: nowIso(),
          lastError: upstreamInputsResult.error,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            1,
            failed.lastError ?? "upstream communication resolution failed",
            failed,
          ),
        );
      }
      const upstreamInputs = upstreamInputsResult.value;
      const latestOutputsResult = await buildLatestOutputMailboxIndex(session);
      if (!latestOutputsResult.ok) {
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt: nowIso(),
          lastError: latestOutputsResult.error,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            1,
            failed.lastError ?? "latest output context resolution failed",
            failed,
          ),
        );
      }
      const latestOutputs = latestOutputsResult.value;
      const upstreamOutputRefs = upstreamInputs.map(
        ({ output, outputRaw, ...ref }) => ref,
      );
      const upstreamBindingInputs = upstreamInputs.map((entry) => ({
        fromNodeId: entry.fromNodeId,
        transitionWhen: entry.transitionWhen,
        status: entry.status,
        communicationId: entry.communicationId,
        output: entry.output,
      }));
      const upstreamCommunicationIds = upstreamInputs.map(
        (entry) => entry.communicationId,
      );
      const transcriptInput = (session.conversationTurns ?? []).map((turn) => ({
        conversationId: turn.conversationId,
        turnIndex: turn.turnIndex,
        fromManagerStepId: turn.fromManagerStepId,
        toManagerStepId: turn.toManagerStepId,
        communicationId: turn.communicationId,
        outputRef: turn.outputRef,
        sentAt: turn.sentAt,
      }));
      let assembledPromptText: string;
      let assembledArguments: Readonly<Record<string, unknown>> | null;
      let executionMailbox:
        | ReturnType<typeof buildNodeExecutionMailbox>
        | undefined;
      try {
        const assembled = assembleNodeInput({
          runtimeVariables: session.runtimeVariables,
          node: executionNodePayload,
          workflowId: workflow.workflowId,
          workflowDescription: workflow.description,
          nodeKind: describeWorkflowNodeKind(nodeRef),
          upstream: upstreamBindingInputs,
          transcript: transcriptInput,
        });
        executionMailbox = buildNodeExecutionMailbox({
          workflow,
          nodeRef,
          node: executionNodePayload,
          ...stepIdentityFields,
          mailboxInstanceId,
          nodePayloads: nodeMap,
          runtimeVariables: session.runtimeVariables,
          basePromptText: assembled.promptText,
          assembledArguments: assembled.arguments,
          upstreamInputs,
          latestOutputs,
        });
        assembledPromptText = assembled.promptText;
        assembledArguments = assembled.arguments;
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "unknown input assembly failure";
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt: nowIso(),
          lastError: `input assembly failed for ${executionTargetNoun} '${nodeId}': ${message}`,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            3,
            failed.lastError ?? "input assembly failed",
            failed,
          ),
        );
      }
      if (executionMailbox === undefined) {
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt: nowIso(),
          lastError: `input assembly failed for ${executionTargetNoun} '${nodeId}': execution mailbox was not created`,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            3,
            failed.lastError ?? "execution mailbox creation failed",
            failed,
          ),
        );
      }
      let mailboxDir: string;
      try {
        const mailboxPaths = await writeNodeExecutionMailboxArtifacts(
          artifactDir,
          executionMailbox,
        );
        mailboxDir = mailboxPaths.rootDir;
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "unknown execution mailbox persistence failure";
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt: nowIso(),
          lastError: `failed to persist execution mailbox for ${executionTargetNoun} '${nodeId}': ${message}`,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            1,
            failed.lastError ?? "execution mailbox persistence failed",
            failed,
          ),
        );
      }
      const baseInputPayload = {
        sessionId: session.sessionId,
        workflowExecutionId: session.sessionId,
        workflowId: workflow.workflowId,
        nodeId,
        ...stepIdentityFields,
        nodeExecId,
        mailboxInstanceId,
        promptTemplate: executionNodePayload.promptTemplate,
        promptText: assembledPromptText,
        arguments: assembledArguments,
        variables: mergedVariables,
        upstreamOutputRefs,
        upstreamCommunications: upstreamCommunicationIds,
        executionMailbox,
        ...(stepExecutionAddress.promptVariant === undefined
          ? {}
          : { promptVariant: stepExecutionAddress.promptVariant }),
        restartAttempt,
        ...(previousNodeExecId === undefined
          ? {}
          : { restartedFromNodeExecId: previousNodeExecId }),
        dryRun: options.dryRun ?? false,
      };
      const preparedStepInputResult = await handlePreparedStepInput({
        nodePayload,
        baseInputPayload,
        artifactDir,
        nodeExecId,
        workflow,
        session,
        nodeId,
        assembledPromptText,
        queue,
        nextExecutionCounter,
        updatedCounts,
        skipOptionalNode,
        pendingOptionalDecision,
        loopRuleByJudgeNodeId,
        outgoingEdges,
        maxLoopIterations,
        executionNodePayload,
        stepIdentityFields,
        mailboxInstanceId,
        stepExecutionAddress,
        options,
        upstreamCommunicationIds,
        loaded,
      });
      if (preparedStepInputResult.kind === "done") {
        session = preparedStepInputResult.session;
        break;
      }
      if (preparedStepInputResult.kind !== "continue") {
        return preparedStepInputResult;
      }
      if (agentNodePayload === null && nativeNodePayload === null) {
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt: nowIso(),
          lastError: stepAddressedExecution
            ? `step '${nodeId}' is missing agent execution fields`
            : `node '${nodeId}' is missing agent execution fields`,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            1,
            failed.lastError ??
              (stepAddressedExecution
                ? "invalid step execution payload"
                : "invalid node execution payload"),
            failed,
          ),
        );
      }
      const backendSessionSelection =
        agentNodePayload === null
          ? undefined
          : resolveBackendSessionSelection(
              stepExecutionAddress,
              agentNodePayload,
            );
      const backendSessionIdentityFields =
        backendSessionSelection === undefined
          ? undefined
          : toStepIdentityFields(backendSessionSelection);
      let backendSession =
        agentNodePayload === null
          ? undefined
          : resolveRequestedBackendSession({
              session,
              node: agentNodePayload,
              ...(backendSessionSelection?.sessionLookupNodeId === undefined
                ? {}
                : {
                    sessionLookupNodeId:
                      backendSessionSelection.sessionLookupNodeId,
                  }),
              ...(backendSessionSelection?.nodeRegistryId === undefined
                ? {}
                : { nodeRegistryId: backendSessionSelection.nodeRegistryId }),
              ...(backendSessionSelection?.inheritFromStepId === undefined
                ? {}
                : {
                    inheritFromStepId:
                      backendSessionSelection.inheritFromStepId,
                  }),
            });
      const composedPrompts = composeExecutionPrompts({
        promptComposition: {
          workflow,
          nodeRef,
          node: executionNodePayload,
          nodePayloads: nodeMap,
          runtimeVariables: session.runtimeVariables,
          basePromptText: assembledPromptText,
          assembledArguments,
          upstreamInputs,
          executionMailbox,
        },
        includeSessionStartPrompt:
          agentNodePayload !== null && backendSession?.mode !== "reuse",
      });
      const effectivePromptText = appendMailboxPromptGuidance({
        promptText: composedPrompts.promptText,
      });
      const systemPromptText = composedPrompts.systemPromptText;
      const requestedBackendSessionMode = backendSession?.mode;
      let backendSessionId: string | undefined = backendSession?.sessionId;
      let backendSessionProvider: string | undefined;
      const inputPayload = {
        ...baseInputPayload,
        nodeType: executionNodePayload.nodeType ?? "agent",
        ...(agentNodePayload === null
          ? {}
          : { executionBackend: agentNodePayload.executionBackend }),
        ...(agentNodePayload === null ? {} : { model: agentNodePayload.model }),
        ...(agentNodePayload?.systemPromptTemplate === undefined
          ? {}
          : { systemPromptTemplate: agentNodePayload.systemPromptTemplate }),
        ...(agentNodePayload?.sessionStartPromptTemplate === undefined
          ? {}
          : {
              sessionStartPromptTemplate:
                agentNodePayload.sessionStartPromptTemplate,
            }),
        ...(systemPromptText === undefined ? {} : { systemPromptText }),
        promptText: effectivePromptText,
        outputContract:
          executionNodePayload.output === undefined
            ? undefined
            : {
                description: executionNodePayload.output.description,
                jsonSchema: executionNodePayload.output.jsonSchema,
                maxValidationAttempts:
                  resolveOutputValidationAttempts(executionNodePayload),
                publication: buildOutputPublicationPolicy(),
              },
        ...(backendSession === undefined ? {} : { backendSession }),
      };
      const inputJson = stableJson(inputPayload);
      await writeRawTextFile(
        path.join(artifactDir, "input.json"),
        `${inputJson}\n`,
      );
      const startedAt = nowIso();
      const resolvedTimeout = resolveTimeoutMs({
        node: executionNodePayload,
        workflowTimeoutMs:
          options.defaultTimeoutMs ?? workflow.defaults.nodeTimeoutMs,
        ...(stepExecutionAddress.timeoutMs === undefined
          ? {}
          : { stepTimeoutMs: stepExecutionAddress.timeoutMs }),
      });
      const baseTimeoutMs = resolvedTimeout.timeoutMs;
      const timeoutPolicy = workflow.defaults.timeoutPolicy;
      const timeoutIncrementMs = timeoutPolicy?.retryTimeoutIncrementMs ?? 0;
      const applyTimeoutIncrement =
        timeoutIncrementMs > 0 &&
        restartAttempt > 0 &&
        timeoutPolicy !== undefined &&
        (timeoutPolicy.onTimeout === "retry-same-step" ||
          timeoutPolicy.onTimeout === "jump-to-step");
      const timeoutMs =
        baseTimeoutMs +
        (applyTimeoutIncrement ? timeoutIncrementMs * restartAttempt : 0);
      let ambientManagerContext: AdapterAmbientManagerContext | undefined;
      let managerSessionId: string | undefined;
      if (isManagerNodeRef(nodeRef) && options.dryRun !== true) {
        managerSessionId = nextManagerSessionId(nodeExecId);
        const managerAuthToken = mintManagerAuthToken();
        const activeManagerSessionExpiresAt = addMillisecondsToIso(
          startedAt,
          timeoutMs + 5 * 60_000,
        );
        ambientManagerContext = {
          environment: buildAmbientManagerControlPlaneEnvironment({
            workflowId: workflow.workflowId,
            workflowExecutionId: session.sessionId,
            managerStepId: nodeId,
            managerNodeExecId: nodeExecId,
            managerSessionId,
            authToken: managerAuthToken,
            ...(options.env === undefined ? {} : { env: options.env }),
          }),
        };
        try {
          await managerSessionStore.createOrResumeSession({
            managerSessionId,
            workflowId: workflow.workflowId,
            workflowExecutionId: session.sessionId,
            managerStepId: nodeId,
            managerNodeExecId: nodeExecId,
            status: "active",
            createdAt: startedAt,
            updatedAt: startedAt,
            authTokenHash: hashManagerAuthToken(managerAuthToken),
            authTokenExpiresAt: activeManagerSessionExpiresAt,
          });
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : "unknown manager session persistence failure";
          const failed: WorkflowSessionState = {
            ...session,
            queue,
            status: "failed",
            currentNodeId: nodeId,
            endedAt: startedAt,
            lastError: `failed to start manager session for ${executionTargetNoun} '${nodeId}': ${message}`,
          };
          await saveSession(failed, options);
          return err({
            exitCode: 1,
            message: failed.lastError ?? "failed to start manager session",
          });
        }
      }
      let outputPayload: Readonly<Record<string, unknown>>;
      let nodeStatus: NodeExecutionRecord["status"] = "succeeded";
      let outputValidationErrors: readonly JsonSchemaValidationError[] = [];
      let outputAttemptCount = 1;
      let processLogs: readonly AdapterProcessLog[] = [];
      let llmMessages: readonly AdapterLlmSessionMessage[] = [];
      const outputResolution = await resolveNodeExecutionOutput({
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
        finalizedOutput: undefined,
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
      });
      outputPayload = outputResolution.outputPayload;
      nodeStatus = outputResolution.nodeStatus;
      outputValidationErrors = outputResolution.outputValidationErrors;
      outputAttemptCount = outputResolution.outputAttemptCount;
      processLogs = outputResolution.processLogs;
      llmMessages = outputResolution.llmMessages;
      backendSessionProvider = outputResolution.backendSessionProvider;
      backendSession = outputResolution.backendSession;
      backendSessionId = outputResolution.backendSessionId;
      const finalization = await finalizeExecutedNode({
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
        nodeMap,
        isOptionalExecutionNode,
        inputJson,
        executionNodePayload,
        upstreamCommunicationIds,
        stuckRestartBackoffMs,
        agentNodePayload,
        processLogs,
        llmMessages,
      });
      if (finalization.kind === "restart") {
        session = finalization.session;
        previousNodeExecId = finalization.previousNodeExecId;
        restartAttempt = finalization.restartAttempt;
        continue;
      }
      if (finalization.kind === "done") {
        session = finalization.session;
        break;
      }
      return finalization;
    }
  }
  return await finalizeCompletedWorkflowRun({
    session,
    workflow,
    loaded: loaded.value,
    options,
  });
}
