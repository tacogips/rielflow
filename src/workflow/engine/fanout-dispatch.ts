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
  findPriorBranchWorkspaceRoot,
  persistFanoutJoinOutputRef,
  prepareFanoutBranchWorkspace,
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
import type { NodePayload, WorkflowEdge, WorkflowJson } from "../types";
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

export async function executeLocalFanoutTransition(input: {
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
}): Promise<Result<CrossWorkflowDispatchExecutionResult, string>> {
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
  let firstFailure: string | undefined;
  let firstPause: string | undefined;
  let workingSession: WorkflowSessionState = input.session;
  const baseRuntimeVariables = input.session.runtimeVariables;

  const branchResults = await runBoundedFanoutBranches<FanoutBranchRecord>(
    items.value,
    executionConcurrency,
    async (branchIndex, item) => {
      const supersededWorkspaceRoot = findPriorBranchWorkspaceRoot({
        priorGroups: input.session.fanoutGroups ?? [],
        groupId: fanout.groupId,
        branchIndex,
      });
      const supersededRef =
        supersededWorkspaceRoot === undefined
          ? {}
          : { supersededWorkspaceRoot };

      if (firstPause !== undefined) {
        return {
          branchIndex,
          item,
          status: "pending" as const,
          workItemId: `${fanoutGroupRunId}:${branchIndex}`,
          ...supersededRef,
        } satisfies FanoutBranchRecord;
      }

      if (
        (await input.guards?.cancellationProbe.isCancelled(
          input.session.sessionId,
        )) === true
      ) {
        const message = "cancelled by external request";
        firstFailure = firstFailure ?? message;
        workingSession = {
          ...workingSession,
          status: "cancelled",
          queue: [],
          currentNodeId: input.edge.to,
          endedAt: nowIso(),
          lastError: message,
        };
        await saveSession(workingSession, input.options);
        return {
          branchIndex,
          item,
          status: "cancelled" as const,
          workItemId: `${fanoutGroupRunId}:${branchIndex}`,
          error: message,
          ...supersededRef,
        } satisfies FanoutBranchRecord;
      }

      if (failurePolicy === "fail-fast" && firstFailure !== undefined) {
        return {
          branchIndex,
          item,
          status: "cancelled" as const,
          workItemId: `${fanoutGroupRunId}:${branchIndex}`,
          error: "fanout fail-fast stopped before branch launch",
          ...supersededRef,
        } satisfies FanoutBranchRecord;
      }
      if (
        input.options.maxSteps !== undefined &&
        workingSession.nodeExecutionCounter >= input.options.maxSteps
      ) {
        const message = `fanout max steps reached (${input.options.maxSteps})`;
        firstFailure = firstFailure ?? message;
        return {
          branchIndex,
          item,
          status: "failed" as const,
          workItemId: `${fanoutGroupRunId}:${branchIndex}`,
          error: message,
          ...supersededRef,
        } satisfies FanoutBranchRecord;
      }

      const branchWorkspace = await prepareFanoutBranchWorkspace({
        fanout,
        options: input.options,
        sessionId: input.session.sessionId,
        fanoutGroupRunId,
        branchIndex,
      });
      if (!branchWorkspace.ok) {
        const message = branchWorkspace.error;
        firstFailure = firstFailure ?? message;
        return {
          branchIndex,
          item,
          status: "failed" as const,
          workItemId: `${fanoutGroupRunId}:${branchIndex}`,
          error: message,
          ...supersededRef,
        } satisfies FanoutBranchRecord;
      }

      const branchRuntimeVariables = buildFanoutRuntimeVariables({
        baseRuntimeVariables,
        fanout,
        branchIndex,
        item,
      });
      const targetNodePayload = input.nodePayloads[input.edge.to];
      if (
        findNodeRef(input.workflow, input.edge.to)?.execution?.mode ===
        "optional"
      ) {
        const requestedAt = nowIso();
        const owningManagerStepId = findOwningManagerNodeId(
          input.workflow,
          input.edge.to,
        );
        const message = `fanout branch ${branchIndex} paused for optional step decision`;
        firstPause = firstPause ?? message;
        workingSession = {
          ...workingSession,
          status: "paused",
          queue: dedupeNodeIds([owningManagerStepId]),
          currentNodeId: input.edge.to,
          runtimeVariables: branchRuntimeVariables,
          pendingOptionalNodeDecisions: upsertPendingOptionalNodeDecision(
            workingSession.pendingOptionalNodeDecisions ?? [],
            {
              nodeId: input.edge.to,
              owningManagerStepId,
              requestedAt,
              status: "pending",
            },
          ),
          lastError: message,
        };
        await saveSession(workingSession, input.options);
        return {
          branchIndex,
          item,
          status: "paused" as const,
          workItemId: `${fanoutGroupRunId}:${branchIndex}`,
          error: message,
          ...supersededRef,
        } satisfies FanoutBranchRecord;
      }
      if (targetNodePayload?.nodeType === "user-action") {
        const {
          endedAt: _endedAt,
          lastError: _lastError,
          ...runningSessionBase
        } = workingSession;
        await saveSession(
          {
            ...runningSessionBase,
            status: "running",
            queue: [input.edge.to],
            currentNodeId: input.edge.to,
            runtimeVariables: branchRuntimeVariables,
          },
          input.options,
        );
        const branchRun = await runWorkflow(
          input.workflowName,
          {
            ...input.options,
            resumeSessionId: input.session.sessionId,
          },
          input.adapter,
          input.guards,
        );
        if (!branchRun.ok) {
          const message = branchRun.error.message;
          firstFailure = firstFailure ?? message;
          if (branchRun.error.sessionId !== undefined) {
            const loadedBranchSession = await loadSession(
              branchRun.error.sessionId,
              input.options,
            );
            if (loadedBranchSession.ok) {
              workingSession = loadedBranchSession.value;
            }
          }
          return {
            branchIndex,
            item,
            status: "failed" as const,
            workItemId: `${fanoutGroupRunId}:${branchIndex}`,
            ...(branchWorkspace.value === undefined
              ? {}
              : { workspaceRoot: branchWorkspace.value }),
            error: message,
            ...supersededRef,
          } satisfies FanoutBranchRecord;
        }
        const branchSession = branchRun.value.session;
        workingSession = branchSession;
        if (
          branchRun.value.exitCode === 4 &&
          branchSession.status === "paused"
        ) {
          const message = `fanout branch ${branchIndex} paused for user action`;
          firstPause = firstPause ?? message;
          return {
            branchIndex,
            item,
            status: "paused" as const,
            workItemId: `${fanoutGroupRunId}:${branchIndex}`,
            ...((branchSession.activeUserActions ?? []).length === 0
              ? {}
              : {
                  nodeExecIds: (branchSession.activeUserActions ?? [])
                    .filter((entry) => entry.nodeId === input.edge.to)
                    .map((entry) => entry.nodeExecId),
                }),
            error: message,
            ...(branchWorkspace.value === undefined
              ? {}
              : { workspaceRoot: branchWorkspace.value }),
            ...supersededRef,
          } satisfies FanoutBranchRecord;
        }
      }
      const {
        endedAt: _endedAt,
        lastError: _lastError,
        ...runningSessionBase
      } = workingSession;
      await saveSession(
        {
          ...runningSessionBase,
          status: "running",
          queue: [],
          currentNodeId: input.edge.to,
          runtimeVariables: branchRuntimeVariables,
        },
        input.options,
      );

      const branchExecution = await callStepExecution(
        {
          ...input.options,
          workflowId: input.workflow.workflowId,
          workflowRunId: input.session.sessionId,
          stepId: input.edge.to,
          ...(branchWorkspace.value === undefined
            ? {}
            : { workflowWorkingDirectory: branchWorkspace.value }),
        },
        input.adapter,
      );
      const branchSession = branchExecution.ok
        ? branchExecution.value.session
        : branchExecution.error.session;
      workingSession = {
        ...branchSession,
        status: "running",
        queue: [],
        runtimeVariables: baseRuntimeVariables,
      };
      await saveSession(workingSession, input.options);

      if (!branchExecution.ok) {
        const message = branchExecution.error.message;
        firstFailure = firstFailure ?? message;
        return {
          branchIndex,
          item,
          status: "failed" as const,
          workItemId: `${fanoutGroupRunId}:${branchIndex}`,
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
        } satisfies FanoutBranchRecord;
      }

      return {
        branchIndex,
        item,
        status: "succeeded" as const,
        workItemId: `${fanoutGroupRunId}:${branchIndex}`,
        nodeExecIds: [branchExecution.value.nodeExecution.nodeExecId],
        outputRef: branchExecution.value.outputRef,
        ...(branchWorkspace.value === undefined
          ? {}
          : { workspaceRoot: branchWorkspace.value }),
        ...supersededRef,
      } satisfies FanoutBranchRecord;
    },
  );

  const completedBranches = branchResults.map((branch) => branch);
  const group: FanoutGroupRunRecord = {
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
  };

  const failedBranches = completedBranches.filter(
    (branch) => branch.status === "failed" || branch.status === "cancelled",
  );
  const pausedBranches = completedBranches.filter(
    (branch) => branch.status === "paused",
  );
  if (failedBranches.length > 0) {
    return ok({
      communications: input.currentCommunications,
      communicationCounter: input.communicationCounter,
      queuedNodeIds: [],
      transitions: [],
      fanoutGroups: [...(input.session.fanoutGroups ?? []), group],
      session: workingSession,
      failureMessage: `fanout group '${fanoutGroupRunId}' failed: ${failedBranches
        .map(
          (branch) =>
            `branch ${branch.branchIndex}: ${branch.error ?? branch.status}`,
        )
        .join("; ")}`,
    });
  }
  if (pausedBranches.length > 0) {
    const nextFanoutGroups = [...(input.session.fanoutGroups ?? []), group];
    const pausedSession: WorkflowSessionState = {
      ...workingSession,
      status: "paused",
      fanoutGroups: nextFanoutGroups,
      lastError: pausedBranches
        .map(
          (branch) =>
            `branch ${branch.branchIndex}: ${branch.error ?? branch.status}`,
        )
        .join("; "),
    };
    return ok({
      communications: input.currentCommunications,
      communicationCounter: input.communicationCounter,
      queuedNodeIds: [],
      transitions: [],
      fanoutGroups: nextFanoutGroups,
      session: pausedSession,
      pausedMessage: `fanout group '${fanoutGroupRunId}' paused: ${pausedSession.lastError}`,
    });
  }

  const aggregate = {
    fanoutGroupRunId,
    groupId: fanout.groupId,
    sourceStepId: input.callerStepId,
    resultOrder,
    results: completedBranches.map((branch) => ({
      branchIndex: branch.branchIndex,
      item: branch.item,
      status: branch.status,
      ...(branch.outputRef === undefined
        ? {}
        : { outputRef: branch.outputRef }),
      ...(branch.workspaceRoot === undefined
        ? {}
        : { workspaceRoot: branch.workspaceRoot }),
    })),
  };
  const aggregateOutput = await persistFanoutJoinOutputRef({
    artifactDir: input.callerArtifactDir,
    workflow: input.workflow,
    session: input.session,
    sourceStepId: input.callerStepId,
    sourceNodeExecId: input.callerNodeExecId,
    fanoutGroupRunId,
    aggregate,
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
    fanoutGroups: [...(input.session.fanoutGroups ?? []), group],
    runtimeVariables: buildFanoutJoinRuntimeVariables({
      baseRuntimeVariables,
      aggregate,
    }),
    session: workingSession,
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
