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

export async function prepareWorkflowRun(input) {
  const {
    workflowName,
    options,
    adapter,
    guards,
    crossWorkflowInvocationStack,
  } = input;
  let workflowWorkingDirectory: string;
  try {
    workflowWorkingDirectory = resolveWorkflowExecutionWorkingDirectory({
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.workflowWorkingDirectory === undefined
        ? {}
        : { workflowWorkingDirectory: options.workflowWorkingDirectory }),
    });
  } catch (error: unknown) {
    return err({
      exitCode: 2,
      message:
        error instanceof Error
          ? error.message
          : "workingDirectory must be a non-empty path when provided",
    });
  }
  const resumeRequested = options.resumeSessionId !== undefined;
  const rerunRequested = options.rerunFromSessionId !== undefined;
  const continuationRequested =
    options.continueFromWorkflowExecutionId !== undefined;
  if (
    [resumeRequested, rerunRequested, continuationRequested].filter(Boolean)
      .length > 1
  ) {
    return err({
      exitCode: 2,
      message:
        "resumeSessionId, rerunFromSessionId, and continueFromWorkflowExecutionId are mutually exclusive",
    });
  }
  const isFreshAutoImproveSeed =
    !resumeRequested && !rerunRequested && !continuationRequested;
  let preloadedForBundlePath: WorkflowSessionState | undefined;
  if (options.resumeSessionId !== undefined) {
    const pre = await loadSession(options.resumeSessionId, options);
    if (!pre.ok) {
      return err({ exitCode: 1, message: pre.error.message });
    }
    if (pre.value.workflowName !== workflowName) {
      return err({
        exitCode: 1,
        message: "session workflow does not match command workflow",
      });
    }
    preloadedForBundlePath = pre.value;
  } else if (options.rerunFromSessionId !== undefined) {
    const pre = await loadSession(options.rerunFromSessionId, options);
    if (!pre.ok) {
      return err({ exitCode: 1, message: pre.error.message });
    }
    if (pre.value.workflowName !== workflowName) {
      return err({
        exitCode: 1,
        message: "source session workflow does not match command workflow",
      });
    }
    preloadedForBundlePath = pre.value;
  } else if (options.continueFromWorkflowExecutionId !== undefined) {
    const pre = await loadSession(
      options.continueFromWorkflowExecutionId,
      options,
    );
    if (!pre.ok) {
      return err({ exitCode: 1, message: pre.error.message });
    }
    if (pre.value.workflowName !== workflowName) {
      return err({
        exitCode: 1,
        message:
          "source workflow execution workflow does not match command workflow",
      });
    }
    preloadedForBundlePath = pre.value;
  }
  const bundlePathOverrideFromSession =
    preloadedForBundlePath?.supervision?.mutableWorkflowDir;
  const firstLoadOptions: WorkflowRunOptions = {
    ...options,
    ...(options.workflowBundleDirectoryOverride === undefined &&
    bundlePathOverrideFromSession !== undefined
      ? { workflowBundleDirectoryOverride: bundlePathOverrideFromSession }
      : {}),
  };
  let loaded = await loadWorkflowFromDisk(workflowName, firstLoadOptions);
  if (!loaded.ok) {
    return err({
      exitCode:
        loaded.error.code === "VALIDATION" ||
        loaded.error.code === "INVALID_WORKFLOW_NAME"
          ? 2
          : 1,
      message: loaded.error.message,
    });
  }
  let precomputedSupervision: SupervisionRunState | undefined;
  if (isFreshAutoImproveSeed && options.autoImprove !== undefined) {
    const policy = options.autoImprove;
    const initial = createInitialSupervisionRunState({
      policy,
      targetWorkflowId: loaded.value.bundle.workflow.workflowId,
    });
    const roots = resolveEffectiveRoots(options);
    const workspace = await createExecutionCopyMutableWorkspace({
      workflowId: loaded.value.bundle.workflow.workflowId,
      sourceWorkflowDir: loaded.value.workflowDirectory,
      artifactRoot: roots.artifactRoot,
      supervisionRunId: initial.supervisionRunId,
      mutationMode: policy.workflowMutationMode,
    });
    if (!workspace.ok) {
      return err({
        exitCode: 1,
        message: `supervision workspace: ${workspace.error.message}`,
      });
    }
    precomputedSupervision = {
      ...initial,
      mutableWorkflowDir: workspace.value.mutableWorkflowDir,
    };
    if (workspace.value.mutationMode === "execution-copy") {
      const reloaded = await loadWorkflowFromDisk(workflowName, {
        ...options,
        workflowBundleDirectoryOverride: workspace.value.mutableWorkflowDir,
      });
      if (!reloaded.ok) {
        return err({
          exitCode:
            reloaded.error.code === "VALIDATION" ||
            reloaded.error.code === "INVALID_WORKFLOW_NAME"
              ? 2
              : 1,
          message: reloaded.error.message,
        });
      }
      loaded = reloaded;
    }
  }
  const runtimeVariables = options.runtimeVariables ?? {};
  const workflow = loaded.value.bundle.workflow;
  const stepAddressedExecution = true;
  const executionTargetNoun = "step";
  const nodeMap = loaded.value.bundle.nodePayloads;
  const workflowNodes = new Map(
    workflow.nodes.map((entry) => [entry.id, entry]),
  );
  const loopRuleByJudgeNodeId = new Map<string, LoopRule>(
    getStructuralLoops(workflow).map((entry) => [entry.judgeNodeId, entry]),
  );
  const effectiveAdapter =
    adapter ??
    (options.mockScenario === undefined
      ? new DispatchingNodeAdapter()
      : new ScenarioNodeAdapter(options.mockScenario));
  if (
    adapter === undefined &&
    options.mockScenario === undefined &&
    options.dryRun !== true
  ) {
    const readiness = await inspectWorkflowRuntimeReadiness(
      loaded.value.bundle,
      options,
    );
    if (!readiness.ready) {
      return err({
        exitCode: 1,
        message: `workflow runtime readiness failed: ${readiness.blockers.join("; ")}`,
      });
    }
  }
  const cancellationProbe =
    guards?.cancellationProbe ??
    ({
      async isCancelled(sessionId: string): Promise<boolean> {
        const current = await loadSession(sessionId, options);
        return current.ok && current.value.status === "cancelled";
      },
    } satisfies CancellationProbe);
  const managerSessionStore = createManagerSessionStore(options);
  return ok({
    workflowName,
    options,
    adapter,
    guards,
    crossWorkflowInvocationStack,
    workflowWorkingDirectory,
    resumeRequested,
    rerunRequested,
    continuationRequested,
    isFreshAutoImproveSeed,
    preloadedForBundlePath,
    precomputedSupervision,
    loaded,
    runtimeVariables,
    workflow,
    stepAddressedExecution,
    executionTargetNoun,
    nodeMap,
    workflowNodes,
    loopRuleByJudgeNodeId,
    effectiveAdapter,
    cancellationProbe,
    managerSessionStore,
  });
}
