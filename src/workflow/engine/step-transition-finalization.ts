// biome-ignore-all lint/correctness/noUnusedVariables: mechanical extraction preserves transition context fields.
// biome-ignore-all lint/style/useConst: mechanical extraction preserves original mutable state names across phase boundaries.
import type { NodeAdapter } from "../adapter";
import type { LoadedWorkflow } from "../load";
import type { ParsedManagerControl } from "../manager-control";
import { err, ok, type Result } from "../result";
import type { ResolvedStepExecutionAddress } from "../runtime-addressing";
import type {
  CommunicationRecord,
  FanoutGroupRunRecord,
  NodeBackendSessionRecord,
  NodeExecutionRecord,
  OutputRef,
  PendingOptionalNodeDecision,
  WorkflowSessionState,
} from "../session";
import { saveSession } from "../session-store";
import type { NodePayload, WorkflowEdge, WorkflowJson } from "../types";
import {
  executeCrossWorkflowDispatchesForNode,
  executeLocalFanoutTransition,
} from "./fanout-dispatch";
import {
  removePendingOptionalNodeDecision,
  type EngineExecutionGuards,
  type NormalizedWorkflowRunOptions,
  type WorkflowRunFailure,
  type WorkflowRunResult,
  workflowRunFailure,
} from "./types-and-session-state";

export type StepTransitionFinalizationResult =
  | Result<WorkflowRunResult, WorkflowRunFailure>
  | {
      readonly kind: "done";
      readonly session: WorkflowSessionState;
    };

export interface FinalizeStepTransitionsInput {
  readonly session: WorkflowSessionState;
  readonly workflowName: string;
  readonly workflow: WorkflowJson;
  readonly nextExecutionCounter: number;
  readonly updatedCounts: Readonly<Record<string, number>>;
  readonly nodeExecutions: readonly NodeExecutionRecord[];
  readonly currentCommunicationCounter: number;
  readonly currentCommunications: readonly CommunicationRecord[];
  readonly nextNodeBackendSessions: Readonly<
    Record<string, NodeBackendSessionRecord>
  >;
  readonly currentRuntimeVariables: Readonly<Record<string, unknown>>;
  readonly options: NormalizedWorkflowRunOptions;
  readonly loaded: { readonly value: LoadedWorkflow };
  readonly nodeId: string;
  readonly stepExecutionAddress: ResolvedStepExecutionAddress;
  readonly nodeExecId: string;
  readonly artifactDir: string;
  readonly outputPayload: Readonly<Record<string, unknown>>;
  readonly endedAt: string;
  readonly effectiveAdapter: NodeAdapter;
  readonly guards: EngineExecutionGuards | undefined;
  readonly crossWorkflowInvocationStack: readonly string[];
  readonly nodeMap: Readonly<Record<string, NodePayload>>;
  readonly localFanoutEdges: readonly WorkflowEdge[];
  readonly queue: readonly string[];
  readonly updatedLoopIterationCounts: Readonly<Record<string, number>>;
  readonly currentNodeExecutionCounter: number;
  readonly currentNodeExecutionCounts: Readonly<Record<string, number>>;
  readonly currentNodeExecutions: readonly NodeExecutionRecord[];
  readonly currentNodeBackendSessions: Readonly<
    Record<string, NodeBackendSessionRecord>
  >;
  readonly outputRaw: string;
  readonly regularSelected: readonly WorkflowEdge[];
  readonly outputRef: OutputRef;
  readonly managerControl: ParsedManagerControl | null;
  readonly queuedOptionalDecisionNodeIds: readonly string[];
  readonly isOptionalExecutionNode: boolean;
  readonly pendingOptionalNodeDecisionsAfterManagerActions: readonly PendingOptionalNodeDecision[];
}

export async function finalizeStepTransitions(
  input: FinalizeStepTransitionsInput,
): Promise<StepTransitionFinalizationResult> {
  let {
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
    managerControl,
    queuedOptionalDecisionNodeIds,
    isOptionalExecutionNode,
    pendingOptionalNodeDecisionsAfterManagerActions,
  } = input;
  let currentFanoutGroups: readonly FanoutGroupRunRecord[] | undefined =
    session.fanoutGroups;
  const localFanoutQueuedNodeIds: string[] = [];
  const localFanoutTransitions: Array<{
    readonly from: string;
    readonly to: string;
    readonly when: string;
  }> = [];
  for (const edge of localFanoutEdges) {
    const localFanoutResult = await executeLocalFanoutTransition({
      workflowName,
      workflow,
      session: {
        ...session,
        nodeExecutionCounter: nextExecutionCounter,
        nodeExecutionCounts: updatedCounts,
        nodeExecutions,
        communicationCounter: currentCommunicationCounter,
        communications: currentCommunications,
        nodeBackendSessions: nextNodeBackendSessions,
        runtimeVariables: currentRuntimeVariables,
        ...(currentFanoutGroups === undefined
          ? {}
          : { fanoutGroups: currentFanoutGroups }),
      },
      options,
      artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
      callerNodeId: nodeId,
      callerStepId: stepExecutionAddress.stepId,
      callerNodeExecId: nodeExecId,
      callerArtifactDir: artifactDir,
      callerOutputPayload: outputPayload,
      createdAt: endedAt,
      communicationCounter: currentCommunicationCounter,
      currentCommunications,
      adapter: effectiveAdapter,
      guards,
      crossWorkflowInvocationStack,
      edge,
      nodePayloads: nodeMap,
    });
    if (!localFanoutResult.ok) {
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
        runtimeVariables: currentRuntimeVariables,
        ...(currentFanoutGroups === undefined
          ? {}
          : { fanoutGroups: currentFanoutGroups }),
        lastError: localFanoutResult.error,
      };
      await saveSession(failed, options);
      return err(
        workflowRunFailure(
          1,
          failed.lastError ?? "local fanout execution failed",
          failed,
        ),
      );
    }
    currentCommunications = localFanoutResult.value.communications;
    currentCommunicationCounter = localFanoutResult.value.communicationCounter;
    currentRuntimeVariables =
      localFanoutResult.value.runtimeVariables ?? currentRuntimeVariables;
    currentFanoutGroups = localFanoutResult.value.fanoutGroups;
    if (localFanoutResult.value.session !== undefined) {
      currentNodeExecutionCounter =
        localFanoutResult.value.session.nodeExecutionCounter;
      currentNodeExecutionCounts =
        localFanoutResult.value.session.nodeExecutionCounts;
      currentNodeExecutions = localFanoutResult.value.session.nodeExecutions;
      currentNodeBackendSessions =
        localFanoutResult.value.session.nodeBackendSessions ??
        currentNodeBackendSessions;
    }
    if (localFanoutResult.value.pausedMessage !== undefined) {
      const paused = localFanoutResult.value.session;
      if (paused === undefined) {
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt,
          nodeExecutionCounter: currentNodeExecutionCounter,
          nodeExecutionCounts: currentNodeExecutionCounts,
          nodeExecutions: currentNodeExecutions,
          loopIterationCounts: updatedLoopIterationCounts,
          communicationCounter: currentCommunicationCounter,
          communications: currentCommunications,
          nodeBackendSessions: currentNodeBackendSessions,
          runtimeVariables: currentRuntimeVariables,
          ...(currentFanoutGroups === undefined
            ? {}
            : { fanoutGroups: currentFanoutGroups }),
          lastError:
            "internal: local fanout pause missing paused session state",
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            1,
            failed.lastError ?? "local fanout pause failed",
            failed,
          ),
        );
      }
      await saveSession(paused, options);
      return ok({ session: paused, exitCode: 4 });
    }
    localFanoutQueuedNodeIds.push(...localFanoutResult.value.queuedNodeIds);
    localFanoutTransitions.push(...localFanoutResult.value.transitions);
    if (localFanoutResult.value.failureMessage !== undefined) {
      const resultSession = localFanoutResult.value.session;
      const terminalStatus =
        resultSession?.status === "cancelled" ? "cancelled" : "failed";
      const failed: WorkflowSessionState = {
        ...session,
        queue,
        status: terminalStatus,
        currentNodeId: nodeId,
        endedAt,
        nodeExecutionCounter: currentNodeExecutionCounter,
        nodeExecutionCounts: currentNodeExecutionCounts,
        nodeExecutions: currentNodeExecutions,
        loopIterationCounts: updatedLoopIterationCounts,
        communicationCounter: currentCommunicationCounter,
        communications: currentCommunications,
        nodeBackendSessions: currentNodeBackendSessions,
        runtimeVariables: currentRuntimeVariables,
        ...(currentFanoutGroups === undefined
          ? {}
          : { fanoutGroups: currentFanoutGroups }),
        lastError: localFanoutResult.value.failureMessage,
      };
      await saveSession(failed, options);
      return err(
        workflowRunFailure(
          terminalStatus === "cancelled" ? 130 : 1,
          failed.lastError ?? "local fanout execution failed",
          failed,
        ),
      );
    }
  }
  const crossWorkflowDispatchResult =
    await executeCrossWorkflowDispatchesForNode({
      workflow,
      workflowName,
      session: {
        ...session,
        nodeExecutionCounter: currentNodeExecutionCounter,
        nodeExecutionCounts: currentNodeExecutionCounts,
        nodeExecutions: currentNodeExecutions,
        communicationCounter: currentCommunicationCounter,
        communications: currentCommunications,
        nodeBackendSessions: currentNodeBackendSessions,
        runtimeVariables: currentRuntimeVariables,
        ...(currentFanoutGroups === undefined
          ? {}
          : { fanoutGroups: currentFanoutGroups }),
      },
      options,
      artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
      callerNodeId: nodeId,
      callerStepId: stepExecutionAddress.stepId,
      callerNodeRegistryId: stepExecutionAddress.nodeRegistryId,
      callerNodeExecId: nodeExecId,
      callerArtifactDir: artifactDir,
      callerOutputPayload: outputPayload,
      callerOutputRaw: outputRaw,
      createdAt: endedAt,
      communicationCounter: currentCommunicationCounter,
      currentCommunications,
      adapter: effectiveAdapter,
      guards,
      crossWorkflowInvocationStack,
    });
  if (!crossWorkflowDispatchResult.ok) {
    const failed: WorkflowSessionState = {
      ...session,
      queue,
      status: "failed",
      currentNodeId: nodeId,
      endedAt,
      nodeExecutionCounter: currentNodeExecutionCounter,
      nodeExecutionCounts: currentNodeExecutionCounts,
      nodeExecutions: currentNodeExecutions,
      loopIterationCounts: updatedLoopIterationCounts,
      communicationCounter: currentCommunicationCounter,
      communications: currentCommunications,
      nodeBackendSessions: currentNodeBackendSessions,
      lastError: crossWorkflowDispatchResult.error,
    };
    await saveSession(failed, options);
    return err(
      workflowRunFailure(
        1,
        failed.lastError ?? "cross-workflow dispatch execution failed",
        failed,
      ),
    );
  }
  currentCommunications = crossWorkflowDispatchResult.value.communications;
  currentCommunicationCounter =
    crossWorkflowDispatchResult.value.communicationCounter;
  currentRuntimeVariables =
    crossWorkflowDispatchResult.value.runtimeVariables ??
    currentRuntimeVariables;
  if (crossWorkflowDispatchResult.value.failureMessage !== undefined) {
    const failed: WorkflowSessionState = {
      ...session,
      queue,
      status: "failed",
      currentNodeId: nodeId,
      endedAt,
      nodeExecutionCounter: currentNodeExecutionCounter,
      nodeExecutionCounts: currentNodeExecutionCounts,
      nodeExecutions: currentNodeExecutions,
      loopIterationCounts: updatedLoopIterationCounts,
      communicationCounter: currentCommunicationCounter,
      communications: currentCommunications,
      nodeBackendSessions: currentNodeBackendSessions,
      runtimeVariables: currentRuntimeVariables,
      ...(crossWorkflowDispatchResult.value.fanoutGroups === undefined
        ? {}
        : { fanoutGroups: crossWorkflowDispatchResult.value.fanoutGroups }),
      lastError: crossWorkflowDispatchResult.value.failureMessage,
    };
    await saveSession(failed, options);
    return err(
      workflowRunFailure(
        1,
        failed.lastError ?? "cross-workflow dispatch execution failed",
        failed,
      ),
    );
  }
  if (crossWorkflowDispatchResult.value.pausedMessage !== undefined) {
    const paused = crossWorkflowDispatchResult.value.session;
    if (paused === undefined) {
      const failed: WorkflowSessionState = {
        ...session,
        queue,
        status: "failed",
        currentNodeId: nodeId,
        endedAt,
        nodeExecutionCounter: currentNodeExecutionCounter,
        nodeExecutionCounts: currentNodeExecutionCounts,
        nodeExecutions: currentNodeExecutions,
        loopIterationCounts: updatedLoopIterationCounts,
        communicationCounter: currentCommunicationCounter,
        communications: currentCommunications,
        nodeBackendSessions: currentNodeBackendSessions,
        runtimeVariables: currentRuntimeVariables,
        ...(crossWorkflowDispatchResult.value.fanoutGroups === undefined
          ? {}
          : { fanoutGroups: crossWorkflowDispatchResult.value.fanoutGroups }),
        lastError:
          "internal: cross-workflow fanout pause missing paused session state",
      };
      await saveSession(failed, options);
      return err(
        workflowRunFailure(
          1,
          failed.lastError ?? "cross-workflow fanout pause failed",
          failed,
        ),
      );
    }
    const pausedFanoutGroups =
      crossWorkflowDispatchResult.value.fanoutGroups ??
      paused.fanoutGroups ??
      currentFanoutGroups;
    const pausedSession: WorkflowSessionState = {
      ...paused,
      queue: [],
      status: "paused",
      currentNodeId: nodeId,
      nodeExecutionCounter: currentNodeExecutionCounter,
      nodeExecutionCounts: currentNodeExecutionCounts,
      nodeExecutions: currentNodeExecutions,
      loopIterationCounts: updatedLoopIterationCounts,
      communicationCounter: currentCommunicationCounter,
      communications: currentCommunications,
      nodeBackendSessions: currentNodeBackendSessions,
      runtimeVariables: currentRuntimeVariables,
      ...(pausedFanoutGroups === undefined
        ? {}
        : { fanoutGroups: pausedFanoutGroups }),
    };
    await saveSession(pausedSession, options);
    return ok({ session: pausedSession, exitCode: 4 });
  }
  const transitions = [
    ...session.transitions,
    ...regularSelected.map((edge) => ({
      from: edge.from,
      to: edge.to,
      when: edge.when,
    })),
    ...localFanoutTransitions,
    ...crossWorkflowDispatchResult.value.transitions,
  ];
  const transitionNextNodes = regularSelected.map((edge) => edge.to);
  const retryStepIds = managerControl?.retryStepIds ?? [];
  const nextQueue = [
    ...queue,
    ...transitionNextNodes,
    ...localFanoutQueuedNodeIds,
    ...crossWorkflowDispatchResult.value.queuedNodeIds,
    ...queuedOptionalDecisionNodeIds,
  ].filter((value, index, all) => all.indexOf(value) === index);
  const nextQueueWithRetries = [...nextQueue, ...retryStepIds].filter(
    (value, index, all) => all.indexOf(value) === index,
  );
  session = {
    ...session,
    status: "running",
    queue: nextQueueWithRetries,
    currentNodeId: nodeId,
    nodeExecutionCounter: currentNodeExecutionCounter,
    nodeExecutionCounts: currentNodeExecutionCounts,
    loopIterationCounts: updatedLoopIterationCounts,
    transitions,
    nodeExecutions: currentNodeExecutions,
    communicationCounter: currentCommunicationCounter,
    communications: currentCommunications,
    ...(crossWorkflowDispatchResult.value.fanoutGroups === undefined
      ? currentFanoutGroups === undefined
        ? {}
        : { fanoutGroups: currentFanoutGroups }
      : { fanoutGroups: crossWorkflowDispatchResult.value.fanoutGroups }),
    ...(session.conversationTurns === undefined
      ? {}
      : { conversationTurns: session.conversationTurns }),
    nodeBackendSessions: currentNodeBackendSessions,
    pendingOptionalNodeDecisions: isOptionalExecutionNode
      ? removePendingOptionalNodeDecision(
          pendingOptionalNodeDecisionsAfterManagerActions,
          nodeId,
        )
      : pendingOptionalNodeDecisionsAfterManagerActions,
    runtimeVariables: currentRuntimeVariables,
  };
  await saveSession(session, options);
  return { kind: "done", session };
}
