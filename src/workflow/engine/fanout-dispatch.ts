import type { NodeAdapter } from "../adapter";
import { callStepExecution } from "../call-step-impl";
import {
  crossWorkflowDispatchesForExecutionMatch,
  effectiveCrossWorkflowDispatches,
} from "../cross-workflow-from-steps";
import {
  buildFanoutGroupRunId,
  buildFanoutJoinRuntimeVariables,
  buildFanoutRuntimeVariables,
  buildFanoutGroupRunRecord,
  findPriorBranchWorkspaceRoot,
  persistFanoutJoinOutputRef,
  prepareFanoutBranchWorkspace,
  reduceFanoutBranchResults,
  resolveFanoutConcurrency,
  resolveFanoutItems,
  runBoundedFanoutBranches,
} from "../engine-fanout";
import { loadWorkflowByIdFromDisk } from "../load";
import { err, ok, type Result } from "../result";
import {
  buildOutputRefForExecution,
  type CommunicationRecord,
  type FanoutBranchRecord,
  type FanoutGroupRunRecord,
  type WorkflowSessionState,
} from "../session";
import { loadSession, saveSession } from "../session-store";
import type {
  NodePayload,
  WorkflowEdge,
  WorkflowJson,
  WorkflowStepFanout,
} from "../types";
import { resolveWorkflowManagerStepId } from "../types";
import type {
  EngineExecutionGuards,
  NormalizedWorkflowRunOptions,
  UpstreamOutputRef,
} from "./types-and-session-state";
import {
  dedupeNodeIds,
  findNodeRef,
  findOwningManagerNodeId,
  nowIso,
  readOutputPayloadArtifact,
  upsertPendingOptionalNodeDecision,
} from "./types-and-session-state";
import type {
  CrossWorkflowDispatchExecutionResult,
  ExecuteCrossWorkflowDispatchesInput,
} from "./cross-workflow-dispatch";
import {
  CROSS_WORKFLOW_DISPATCH_TRANSITION_WHEN_PREFIX,
  buildCrossWorkflowCalleeRunOptions,
  buildCrossWorkflowCalleeRuntimeVariables,
  crossWorkflowDispatchMatchesCallerExecution,
  executeCrossWorkflowFanoutDispatch,
  findLatestCrossWorkflowCalleeResultExecution,
  persistCrossWorkflowDispatchArtifact,
} from "./cross-workflow-dispatch";
import {
  persistCommunicationArtifact,
  runWorkflowInternal,
} from "./mailbox-and-communications";
import { runWorkflow } from "./auto-improve-and-runner";

interface ExecuteLocalFanoutTransitionInput {
  readonly workflowName: string;
  readonly workflow: WorkflowJson;
  readonly session: WorkflowSessionState;
  readonly options: NormalizedWorkflowRunOptions;
  readonly artifactWorkflowRoot: string;
  readonly callerNodeId: string;
  readonly callerStepId: string;
  readonly callerNodeExecId: string;
  readonly callerArtifactDir: string;
  readonly callerOutputPayload: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly communicationCounter: number;
  readonly currentCommunications: readonly CommunicationRecord[];
  readonly adapter: NodeAdapter;
  readonly guards: EngineExecutionGuards | undefined;
  readonly crossWorkflowInvocationStack: readonly string[];
  readonly edge: WorkflowEdge;
  readonly nodePayloads: Readonly<Record<string, NodePayload>>;
}

interface LocalFanoutBranchExecutionState {
  firstFailure?: string;
  firstPause?: string;
  workingSession: WorkflowSessionState;
}

async function executeLocalFanoutBranch(input: {
  readonly transitionInput: ExecuteLocalFanoutTransitionInput;
  readonly fanout: WorkflowStepFanout;
  readonly fanoutGroupRunId: string;
  readonly baseRuntimeVariables: Readonly<Record<string, unknown>>;
  readonly state: LocalFanoutBranchExecutionState;
  readonly branchIndex: number;
  readonly item: unknown;
}): Promise<FanoutBranchRecord> {
  const transitionInput = input.transitionInput;
  const supersededWorkspaceRoot = findPriorBranchWorkspaceRoot({
    priorGroups: transitionInput.session.fanoutGroups ?? [],
    groupId: input.fanout.groupId,
    branchIndex: input.branchIndex,
  });
  const supersededRef =
    supersededWorkspaceRoot === undefined ? {} : { supersededWorkspaceRoot };
  const workItemId = `${input.fanoutGroupRunId}:${input.branchIndex}`;

  if (input.state.firstPause !== undefined) {
    return {
      branchIndex: input.branchIndex,
      item: input.item,
      status: "pending",
      workItemId,
      ...supersededRef,
    };
  }

  if (
    (await transitionInput.guards?.cancellationProbe.isCancelled(
      transitionInput.session.sessionId,
    )) === true
  ) {
    const message = "cancelled by external request";
    input.state.firstFailure = input.state.firstFailure ?? message;
    input.state.workingSession = {
      ...input.state.workingSession,
      status: "cancelled",
      queue: [],
      currentNodeId: transitionInput.edge.to,
      endedAt: nowIso(),
      lastError: message,
    };
    await saveSession(input.state.workingSession, transitionInput.options);
    return {
      branchIndex: input.branchIndex,
      item: input.item,
      status: "cancelled",
      workItemId,
      error: message,
      ...supersededRef,
    };
  }

  if (input.state.firstPause !== undefined) {
    return {
      branchIndex: input.branchIndex,
      item: input.item,
      status: "pending",
      workItemId,
      ...supersededRef,
    };
  }

  if (
    (input.fanout.failurePolicy ?? "fail-fast") === "fail-fast" &&
    input.state.firstFailure !== undefined
  ) {
    return {
      branchIndex: input.branchIndex,
      item: input.item,
      status: "cancelled",
      workItemId,
      error: "fanout fail-fast stopped before branch launch",
      ...supersededRef,
    };
  }

  if (
    transitionInput.options.maxSteps !== undefined &&
    input.state.workingSession.nodeExecutionCounter >=
      transitionInput.options.maxSteps
  ) {
    const message = `fanout max steps reached (${transitionInput.options.maxSteps})`;
    input.state.firstPause = input.state.firstPause ?? message;
    input.state.workingSession = {
      ...input.state.workingSession,
      status: "paused",
      queue: [],
      currentNodeId: transitionInput.edge.to,
      lastError: message,
    };
    return {
      branchIndex: input.branchIndex,
      item: input.item,
      status: "paused",
      workItemId,
      error: message,
      ...supersededRef,
    };
  }

  const branchWorkspace = await prepareFanoutBranchWorkspace({
    fanout: input.fanout,
    options: transitionInput.options,
    sessionId: transitionInput.session.sessionId,
    fanoutGroupRunId: input.fanoutGroupRunId,
    branchIndex: input.branchIndex,
  });
  if (!branchWorkspace.ok) {
    const message = branchWorkspace.error;
    input.state.firstFailure = input.state.firstFailure ?? message;
    return {
      branchIndex: input.branchIndex,
      item: input.item,
      status: "failed",
      workItemId,
      error: message,
      ...supersededRef,
    };
  }

  const branchRuntimeVariables = buildFanoutRuntimeVariables({
    baseRuntimeVariables: input.baseRuntimeVariables,
    fanout: input.fanout,
    branchIndex: input.branchIndex,
    item: input.item,
  });
  const targetNodePayload =
    transitionInput.nodePayloads[transitionInput.edge.to];
  if (
    findNodeRef(transitionInput.workflow, transitionInput.edge.to)?.execution
      ?.mode === "optional"
  ) {
    const requestedAt = nowIso();
    const owningManagerStepId = findOwningManagerNodeId(
      transitionInput.workflow,
      transitionInput.edge.to,
    );
    const message = `fanout branch ${input.branchIndex} paused for optional step decision`;
    input.state.firstPause = input.state.firstPause ?? message;
    input.state.workingSession = {
      ...input.state.workingSession,
      status: "paused",
      queue: dedupeNodeIds([owningManagerStepId]),
      currentNodeId: transitionInput.edge.to,
      runtimeVariables: branchRuntimeVariables,
      pendingOptionalNodeDecisions: upsertPendingOptionalNodeDecision(
        input.state.workingSession.pendingOptionalNodeDecisions ?? [],
        {
          nodeId: transitionInput.edge.to,
          owningManagerStepId,
          requestedAt,
          status: "pending",
        },
      ),
      lastError: message,
    };
    await saveSession(input.state.workingSession, transitionInput.options);
    return {
      branchIndex: input.branchIndex,
      item: input.item,
      status: "paused",
      workItemId,
      error: message,
      ...supersededRef,
    };
  }

  if (targetNodePayload?.nodeType === "user-action") {
    const {
      endedAt: _endedAt,
      lastError: _lastError,
      ...runningSessionBase
    } = input.state.workingSession;
    await saveSession(
      {
        ...runningSessionBase,
        status: "running",
        queue: [transitionInput.edge.to],
        currentNodeId: transitionInput.edge.to,
        runtimeVariables: branchRuntimeVariables,
      },
      transitionInput.options,
    );
    const branchRun = await runWorkflow(
      transitionInput.workflowName,
      {
        ...transitionInput.options,
        resumeSessionId: transitionInput.session.sessionId,
      },
      transitionInput.adapter,
      transitionInput.guards,
    );
    if (!branchRun.ok) {
      const message = branchRun.error.message;
      input.state.firstFailure = input.state.firstFailure ?? message;
      if (branchRun.error.sessionId !== undefined) {
        const loadedBranchSession = await loadSession(
          branchRun.error.sessionId,
          transitionInput.options,
        );
        if (loadedBranchSession.ok) {
          input.state.workingSession = loadedBranchSession.value;
        }
      }
      return {
        branchIndex: input.branchIndex,
        item: input.item,
        status: "failed",
        workItemId,
        ...(branchWorkspace.value === undefined
          ? {}
          : { workspaceRoot: branchWorkspace.value }),
        error: message,
        ...supersededRef,
      };
    }
    const branchSession = branchRun.value.session;
    input.state.workingSession = branchSession;
    if (branchRun.value.exitCode === 4 && branchSession.status === "paused") {
      const message = `fanout branch ${input.branchIndex} paused for user action`;
      input.state.firstPause = input.state.firstPause ?? message;
      return {
        branchIndex: input.branchIndex,
        item: input.item,
        status: "paused",
        workItemId,
        ...((branchSession.activeUserActions ?? []).length === 0
          ? {}
          : {
              nodeExecIds: (branchSession.activeUserActions ?? [])
                .filter((entry) => entry.nodeId === transitionInput.edge.to)
                .map((entry) => entry.nodeExecId),
            }),
        error: message,
        ...(branchWorkspace.value === undefined
          ? {}
          : { workspaceRoot: branchWorkspace.value }),
        ...supersededRef,
      };
    }
  }

  const {
    endedAt: _endedAt,
    lastError: _lastError,
    ...runningSessionBase
  } = input.state.workingSession;
  await saveSession(
    {
      ...runningSessionBase,
      status: "running",
      queue: [],
      currentNodeId: transitionInput.edge.to,
      runtimeVariables: branchRuntimeVariables,
    },
    transitionInput.options,
  );

  const branchExecution = await callStepExecution(
    {
      ...transitionInput.options,
      workflowId: transitionInput.workflow.workflowId,
      workflowRunId: transitionInput.session.sessionId,
      stepId: transitionInput.edge.to,
      ...(branchWorkspace.value === undefined
        ? {}
        : { workflowWorkingDirectory: branchWorkspace.value }),
    },
    transitionInput.adapter,
  );
  const branchSession = branchExecution.ok
    ? branchExecution.value.session
    : branchExecution.error.session;
  input.state.workingSession = {
    ...branchSession,
    status: "running",
    queue: [],
    runtimeVariables: input.baseRuntimeVariables,
  };
  await saveSession(input.state.workingSession, transitionInput.options);

  if (!branchExecution.ok) {
    const message = branchExecution.error.message;
    input.state.firstFailure = input.state.firstFailure ?? message;
    return {
      branchIndex: input.branchIndex,
      item: input.item,
      status: "failed",
      workItemId,
      ...(branchExecution.error.nodeExecution === undefined
        ? {}
        : {
            nodeExecIds: [branchExecution.error.nodeExecution.nodeExecId],
          }),
      ...(branchWorkspace.value === undefined
        ? {}
        : { workspaceRoot: branchWorkspace.value }),
      error: message,
      ...supersededRef,
    };
  }

  return {
    branchIndex: input.branchIndex,
    item: input.item,
    status: "succeeded",
    workItemId,
    nodeExecIds: [branchExecution.value.nodeExecution.nodeExecId],
    outputRef: branchExecution.value.outputRef,
    ...(branchWorkspace.value === undefined
      ? {}
      : { workspaceRoot: branchWorkspace.value }),
    ...supersededRef,
  };
}

export async function executeLocalFanoutTransition(
  input: ExecuteLocalFanoutTransitionInput,
): Promise<Result<CrossWorkflowDispatchExecutionResult, string>> {
  const fanout = input.edge.fanout;
  if (fanout === undefined) {
    return err("internal: local fanout transition missing fanout");
  }
  const items = resolveFanoutItems({
    fanout,
    outputPayload: input.callerOutputPayload,
  });
  if (!items.ok) {
    return err(`local fanout transition '${input.edge.when}': ${items.error}`);
  }

  const configuredConcurrency = resolveFanoutConcurrency({
    workflow: input.workflow,
    fanout,
    ...(input.options.fanoutConcurrencyBudget === undefined
      ? {}
      : { budget: input.options.fanoutConcurrencyBudget }),
  });
  // Local fanout branches execute in one parent workflow session, so branch
  // execution is serialized until the session store has branch-level locking.
  const executionConcurrency = 1;
  const fanoutGroupRunId = buildFanoutGroupRunId({
    groupId: fanout.groupId,
    sourceNodeExecId: input.callerNodeExecId,
  });
  const failurePolicy = fanout.failurePolicy ?? "fail-fast";
  const resultOrder = fanout.resultOrder ?? "input";
  const baseRuntimeVariables = input.session.runtimeVariables;
  const branchState: LocalFanoutBranchExecutionState = {
    workingSession: input.session,
  };

  const branchResults = await runBoundedFanoutBranches<FanoutBranchRecord>(
    items.value,
    executionConcurrency,
    async (branchIndex, item) =>
      executeLocalFanoutBranch({
        transitionInput: input,
        fanout,
        fanoutGroupRunId,
        baseRuntimeVariables,
        state: branchState,
        branchIndex,
        item,
      }),
  );

  const completedBranches = branchResults.map((branch) => branch);
  const group = buildFanoutGroupRunRecord({
    fanoutGroupRunId,
    groupId: fanout.groupId,
    sourceStepId: input.callerStepId,
    sourceNodeExecId: input.callerNodeExecId,
    ...(input.edge.when === undefined
      ? {}
      : { transitionLabel: input.edge.when }),
    targetStepId: input.edge.to,
    joinStepId: fanout.joinStepId,
    concurrency: Math.min(configuredConcurrency, executionConcurrency),
    failurePolicy,
    resultOrder,
    branches: completedBranches,
  });
  const reduction = reduceFanoutBranchResults({
    group,
    priorFanoutGroups: input.session.fanoutGroups ?? [],
    workingSession: branchState.workingSession,
  });

  if (reduction.outcome === "paused") {
    return ok({
      communications: input.currentCommunications,
      communicationCounter: input.communicationCounter,
      queuedNodeIds: [],
      transitions: [],
      fanoutGroups: reduction.fanoutGroups,
      session: reduction.session,
      pausedMessage: reduction.pausedMessage,
    });
  }

  if (reduction.outcome === "failed") {
    return ok({
      communications: input.currentCommunications,
      communicationCounter: input.communicationCounter,
      queuedNodeIds: [],
      transitions: [],
      fanoutGroups: reduction.fanoutGroups,
      session: reduction.session,
      failureMessage: reduction.failureMessage,
    });
  }

  const aggregateOutput = await persistFanoutJoinOutputRef({
    artifactDir: input.callerArtifactDir,
    workflow: input.workflow,
    session: input.session,
    sourceStepId: input.callerStepId,
    sourceNodeExecId: input.callerNodeExecId,
    fanoutGroupRunId,
    aggregate: reduction.aggregate,
  });
  const communication = await persistCommunicationArtifact({
    artifactWorkflowRoot: input.artifactWorkflowRoot,
    runtimeLogOptions: input.options,
    workflowId: input.workflow.workflowId,
    workflowExecutionId: input.session.sessionId,
    communicationCounter: input.communicationCounter,
    fromNodeId: input.callerNodeId,
    toNodeId: fanout.joinStepId,
    routingScope: "intra-workflow",
    deliveryKind: "edge-transition",
    transitionWhen: `fanout-join:${fanoutGroupRunId}`,
    sourceNodeExecId: input.callerNodeExecId,
    payloadRef: aggregateOutput.outputRef,
    outputRaw: aggregateOutput.outputRaw,
    deliveredByNodeId: resolveWorkflowManagerStepId(input.workflow),
    createdAt: input.createdAt,
  });

  return ok({
    communications: [...input.currentCommunications, communication],
    communicationCounter: input.communicationCounter + 1,
    queuedNodeIds: [fanout.joinStepId],
    transitions: [
      {
        from: input.edge.from,
        to: fanout.joinStepId,
        when: `fanout-join:${fanoutGroupRunId}`,
      },
    ],
    fanoutGroups: reduction.fanoutGroups,
    runtimeVariables: buildFanoutJoinRuntimeVariables({
      baseRuntimeVariables,
      aggregate: reduction.aggregate,
    }),
    session: reduction.session,
  });
}
export async function executeCrossWorkflowDispatchesForNode(
  input: ExecuteCrossWorkflowDispatchesInput,
): Promise<Result<CrossWorkflowDispatchExecutionResult, string>> {
  const workflowDispatches = effectiveCrossWorkflowDispatches(input.workflow);
  if (workflowDispatches.length === 0) {
    return ok({
      communications: input.currentCommunications,
      communicationCounter: input.communicationCounter,
      queuedNodeIds: [],
      transitions: [],
    });
  }
  // Cross-workflow dispatch: only step-addressed bundles derive execution rows
  // from `steps[].transitions`. Legacy node-graph bundles no longer dispatch
  // authored top-level `workflow.workflowCalls`.
  const relevantDispatches = crossWorkflowDispatchesForExecutionMatch(
    input.workflow,
    (entry) =>
      crossWorkflowDispatchMatchesCallerExecution({
        entry,
        callerStepId: input.callerStepId,
        callerOutputPayload: input.callerOutputPayload,
      }),
  );
  if (relevantDispatches.length === 0) {
    return ok({
      communications: input.currentCommunications,
      communicationCounter: input.communicationCounter,
      queuedNodeIds: [],
      transitions: [],
    });
  }

  let currentCommunications: CommunicationRecord[] = [
    ...input.currentCommunications,
  ];
  let currentCommunicationCounter = input.communicationCounter;
  const queuedNodeIds: string[] = [];
  const transitions: Array<{
    readonly from: string;
    readonly to: string;
    readonly when: string;
  }> = [];
  let currentFanoutGroups: readonly FanoutGroupRunRecord[] | undefined =
    input.session.fanoutGroups;
  let currentRuntimeVariables: Readonly<Record<string, unknown>> | undefined =
    input.session.runtimeVariables;

  for (const dispatch of relevantDispatches) {
    if (dispatch.fanout !== undefined) {
      const fanoutResult = await executeCrossWorkflowFanoutDispatch({
        base: input,
        dispatch,
        currentCommunications,
        communicationCounter: currentCommunicationCounter,
      });
      if (!fanoutResult.ok) {
        return err(fanoutResult.error);
      }
      currentCommunications = [...fanoutResult.value.communications];
      currentCommunicationCounter = fanoutResult.value.communicationCounter;
      queuedNodeIds.push(...fanoutResult.value.queuedNodeIds);
      transitions.push(...fanoutResult.value.transitions);
      currentFanoutGroups = fanoutResult.value.fanoutGroups;
      currentRuntimeVariables =
        fanoutResult.value.runtimeVariables ?? currentRuntimeVariables;
      if (fanoutResult.value.failureMessage !== undefined) {
        return ok({
          communications: currentCommunications,
          communicationCounter: currentCommunicationCounter,
          queuedNodeIds,
          transitions,
          ...(currentFanoutGroups === undefined
            ? {}
            : { fanoutGroups: currentFanoutGroups }),
          runtimeVariables: currentRuntimeVariables,
          failureMessage: fanoutResult.value.failureMessage,
        });
      }
      if (fanoutResult.value.pausedMessage !== undefined) {
        return ok({
          communications: currentCommunications,
          communicationCounter: currentCommunicationCounter,
          queuedNodeIds,
          transitions,
          ...(currentFanoutGroups === undefined
            ? {}
            : { fanoutGroups: currentFanoutGroups }),
          runtimeVariables: currentRuntimeVariables,
          ...(fanoutResult.value.session === undefined
            ? {}
            : { session: fanoutResult.value.session }),
          pausedMessage: fanoutResult.value.pausedMessage,
        });
      }
      continue;
    }
    if (
      input.crossWorkflowInvocationStack.includes(dispatch.workflowId) ||
      input.workflow.workflowId === dispatch.workflowId
    ) {
      return err(
        `cross-workflow dispatch '${dispatch.id}' would recurse into '${dispatch.workflowId}', which is not supported`,
      );
    }

    const loadedCallee = await loadWorkflowByIdFromDisk(
      dispatch.workflowId,
      input.options,
    );
    if (!loadedCallee.ok) {
      return err(
        `cross-workflow dispatch '${dispatch.id}' target '${dispatch.workflowId}' could not be loaded: ${loadedCallee.error.message}`,
      );
    }

    const calleeRun = await runWorkflowInternal(
      loadedCallee.value.workflowName,
      buildCrossWorkflowCalleeRunOptions(
        input.options,
        buildCrossWorkflowCalleeRuntimeVariables({
          callerRuntimeVariables: input.session.runtimeVariables,
          callerWorkflowId: input.workflow.workflowId,
          callerWorkflowExecutionId: input.session.sessionId,
          callerNodeRegistryId: input.callerNodeRegistryId,
          callerStepId: input.callerStepId,
          crossWorkflowDispatchId: dispatch.id,
          payload: input.callerOutputPayload["payload"] as Readonly<
            Record<string, unknown>
          >,
        }),
      ),
      input.adapter,
      input.guards,
      [...input.crossWorkflowInvocationStack, input.workflow.workflowId],
    );
    if (!calleeRun.ok) {
      return err(
        `cross-workflow dispatch '${dispatch.id}' failed: ${calleeRun.error.message}`,
      );
    }

    const calleeWorkflow = loadedCallee.value.bundle.workflow;
    const calleeResultExecution = findLatestCrossWorkflowCalleeResultExecution(
      calleeWorkflow,
      calleeRun.value.session,
    );
    const calleeOutputRef =
      calleeResultExecution === undefined
        ? undefined
        : buildOutputRefForExecution({
            workflow: calleeWorkflow,
            session: calleeRun.value.session,
            execution: calleeResultExecution,
          });

    await persistCrossWorkflowDispatchArtifact({
      artifactDir: input.callerArtifactDir,
      callId: dispatch.id,
      callerStepId: dispatch.callerStepId,
      calleeWorkflowName: loadedCallee.value.workflowName,
      calleeWorkflowId: calleeWorkflow.workflowId,
      calleeSession: calleeRun.value.session,
      callerNodeExecId: input.callerNodeExecId,
      resumeStepId: dispatch.resumeStepId,
      ...(calleeOutputRef === undefined
        ? {}
        : { resultOutputRef: calleeOutputRef }),
    });

    if (calleeResultExecution === undefined || calleeOutputRef === undefined) {
      return err(
        `cross-workflow dispatch '${dispatch.id}' completed without a result execution for '${dispatch.resumeStepId}'`,
      );
    }

    const calleeOutput = await readOutputPayloadArtifact(
      calleeResultExecution.artifactDir,
    );
    if (!calleeOutput.ok) {
      return err(
        `cross-workflow dispatch '${dispatch.id}' produced an unreadable result: ${calleeOutput.error}`,
      );
    }

    const communication = await persistCommunicationArtifact({
      artifactWorkflowRoot: input.artifactWorkflowRoot,
      runtimeLogOptions: input.options,
      workflowId: input.workflow.workflowId,
      workflowExecutionId: input.session.sessionId,
      communicationCounter: currentCommunicationCounter,
      fromNodeId: input.callerNodeId,
      toNodeId: dispatch.resumeStepId,
      routingScope: "intra-workflow",
      deliveryKind: "edge-transition",
      transitionWhen: `${CROSS_WORKFLOW_DISPATCH_TRANSITION_WHEN_PREFIX}${dispatch.id}`,
      sourceNodeExecId: input.callerNodeExecId,
      payloadRef: calleeOutputRef,
      outputRaw: calleeOutput.value.raw,
      deliveredByNodeId: resolveWorkflowManagerStepId(input.workflow),
      createdAt: input.createdAt,
    });
    currentCommunicationCounter += 1;
    currentCommunications.push(communication);
    queuedNodeIds.push(dispatch.resumeStepId);
    transitions.push({
      from: dispatch.callerStepId,
      to: dispatch.resumeStepId,
      when: `${CROSS_WORKFLOW_DISPATCH_TRANSITION_WHEN_PREFIX}${dispatch.id}`,
    });
  }

  return ok({
    communications: currentCommunications,
    communicationCounter: currentCommunicationCounter,
    queuedNodeIds,
    transitions,
    ...(currentFanoutGroups === undefined
      ? {}
      : { fanoutGroups: currentFanoutGroups }),
    runtimeVariables: currentRuntimeVariables,
  });
}
export function buildUpstreamOutputRefs(
  session: WorkflowSessionState,
  nodeId: string,
): readonly UpstreamOutputRef[] {
  const matchingCommunications = session.communications.filter(
    (communication) =>
      communication.status === "delivered" && communication.toNodeId === nodeId,
  );
  if (matchingCommunications.length === 0) {
    return [];
  }

  return matchingCommunications
    .map((communication) => {
      const execution = session.nodeExecutions.find(
        (candidate) => candidate.nodeExecId === communication.sourceNodeExecId,
      );
      return {
        fromNodeId: communication.fromNodeId,
        transitionWhen: communication.transitionWhen,
        status: execution?.status ?? communication.status,
        communicationId: communication.communicationId,
        ...communication.payloadRef,
      };
    })
    .filter((entry): entry is UpstreamOutputRef => entry !== undefined);
}
