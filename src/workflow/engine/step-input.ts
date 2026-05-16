import { createScheduledEventManager } from "../../events/scheduled-event-manager";
import { markWorkflowSleepScheduledEventRef } from "../session";
import { workflowStepInputPort } from "./workflow-runner-deps";

type LoopRule = any;
type NodeExecutionRecord = any;
type WorkflowSessionState = any;

const {
  mkdir,
  path,
  writeJsonFile,
  writeRawTextFile,
  nowIso,
  stableJson,
  removePendingOptionalNodeDecision,
  loadSession,
  saveSession,
  ok,
  buildOptionalSkipOutput,
  evaluateEdge,
  resolveLoopTransition,
  buildOutputRefForExecution,
  sha256Hex,
  buildCommitMessageTemplate,
  saveNodeExecutionToRuntimeDb,
  markCommunicationsConsumed,
  err,
  persistCommunicationArtifact,
  resolveWorkflowManagerStepId,
  dedupeNodeIds,
  isWorkflowOutputKindNode,
} = workflowStepInputPort;

const defaultWorkflowSleepScheduledEventManager = createScheduledEventManager();

function resolveSleepDueAt(sleepConfig: any) {
  if (sleepConfig.until !== undefined) {
    return new Date(sleepConfig.until);
  }
  return new Date(Date.now() + sleepConfig.durationMs);
}

function buildWorkflowSleepSchedule(input: any) {
  const eventId = `workflow-sleep:${input.session.sessionId}:${input.nodeId}:${input.nodeExecId}`;
  const dueAt = resolveSleepDueAt(input.nodePayload.sleep);
  return { eventId, dueAt };
}

async function markWorkflowSleepRef(input: any, status: any) {
  const loaded = await loadSession(input.sessionId, input.options);
  if (!loaded.ok) {
    return undefined;
  }
  let updated = markWorkflowSleepScheduledEventRef(
    loaded.value,
    input.eventId,
    status,
  );
  if (
    updated === loaded.value &&
    input.nodeId !== undefined &&
    input.nodeExecId !== undefined &&
    input.dueAt !== undefined
  ) {
    updated = {
      ...loaded.value,
      scheduledEvents: [
        ...(loaded.value.scheduledEvents ?? []),
        {
          eventId: input.eventId,
          kind: "workflow-sleep",
          nodeId: input.nodeId,
          nodeExecId: input.nodeExecId,
          dueAt: input.dueAt.toISOString(),
          status,
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }
  if (updated !== loaded.value) {
    await saveSession(updated, input.options);
  }
  return updated;
}

function ownsPendingWorkflowSleepEvent(
  session: any,
  eventId: string,
  nodeExecId: string,
) {
  return (
    session.status === "paused" &&
    session.scheduledEvents?.some(
      (entry: any) =>
        entry.kind === "workflow-sleep" &&
        entry.eventId === eventId &&
        entry.nodeExecId === nodeExecId &&
        entry.status === "pending",
    ) === true
  );
}

function registerWorkflowSleepResume(input: any) {
  const manager =
    input.options.scheduledEventManager ??
    defaultWorkflowSleepScheduledEventManager;
  manager.register({
    id: input.eventId,
    kind: "workflow-sleep",
    dueAt: input.dueAt,
    dedupeKey: input.eventId,
    payload: {
      workflowName: input.workflowName,
      workflowExecutionId: input.session.sessionId,
      stepId: input.stepExecutionAddress.stepId,
      nodeId: input.nodeId,
      nodeExecId: input.nodeExecId,
    },
    fire: async () => {
      const loaded = await loadSession(input.session.sessionId, input.options);
      if (!loaded.ok) {
        throw new Error(loaded.error.message);
      }
      if (
        !ownsPendingWorkflowSleepEvent(
          loaded.value,
          input.eventId,
          input.nodeExecId,
        )
      ) {
        return;
      }
      await saveSession(
        markWorkflowSleepScheduledEventRef(
          loaded.value,
          input.eventId,
          "fired",
        ),
        input.options,
      );
      try {
        const engine = await import("../engine");
        const resumeResult = await engine.runWorkflow(input.workflowName, {
          ...input.options,
          resumeSessionId: input.session.sessionId,
        });
        if (!resumeResult.ok) {
          throw new Error(resumeResult.error.message);
        }
      } catch (error) {
        await markWorkflowSleepRef(
          {
            sessionId: input.session.sessionId,
            eventId: input.eventId,
            nodeId: input.nodeId,
            nodeExecId: input.nodeExecId,
            dueAt: input.dueAt,
            options: input.options,
          },
          "failed",
        );
        throw error;
      }
    },
  });
}

export async function handlePreparedStepInput(input: any) {
  let {
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
    workflowName,
    outputPayload: _unusedOutputPayload,
  } = input;
  if (nodePayload.nodeType === "sleep") {
    const startedAt = nowIso();
    const { eventId, dueAt } = buildWorkflowSleepSchedule({
      session,
      nodePayload,
      nodeId,
      nodeExecId,
    });
    const outputPayload = {
      slept: true,
      scheduledEventId: eventId,
      scheduledAt: startedAt,
      wakeAt: dueAt.toISOString(),
    };
    const selected = (outgoingEdges.get(nodeId) ?? []).filter((edge: any) =>
      evaluateEdge(edge, outputPayload),
    );
    const inputJson = stableJson({
      ...baseInputPayload,
      nodeType: "sleep",
      sleep: nodePayload.sleep,
    });
    await writeRawTextFile(
      path.join(artifactDir, "input.json"),
      `${inputJson}\n`,
    );
    const endedAt = nowIso();
    const nodeExecution: NodeExecutionRecord = {
      nodeId,
      ...stepIdentityFields,
      nodeExecId,
      executionOrdinal: nextExecutionCounter,
      mailboxInstanceId,
      status: "succeeded",
      artifactDir,
      startedAt,
      endedAt,
      ...(stepExecutionAddress.promptVariant === undefined
        ? {}
        : { promptVariant: stepExecutionAddress.promptVariant }),
    };
    const outputRef = buildOutputRefForExecution({
      workflow,
      session,
      execution: nodeExecution,
    });
    const outputJson = stableJson(outputPayload);
    const outputRaw = `${outputJson}\n`;
    const inputHash = sha256Hex(inputJson);
    const outputHash = sha256Hex(outputJson);
    const nextNodes = selected.map((edge: any) => edge.to);
    await writeRawTextFile(path.join(artifactDir, "output.json"), outputRaw);
    await writeJsonFile(path.join(artifactDir, "meta.json"), {
      nodeId,
      ...stepIdentityFields,
      nodeExecId,
      mailboxInstanceId,
      status: "scheduled",
      scheduledEventId: eventId,
      wakeAt: dueAt.toISOString(),
      startedAt,
      endedAt,
      ...(stepExecutionAddress.promptVariant === undefined
        ? {}
        : { promptVariant: stepExecutionAddress.promptVariant }),
    });
    await writeJsonFile(path.join(artifactDir, "handoff.json"), {
      schemaVersion: 1,
      generatedAt: endedAt,
      nodeId,
      ...stepIdentityFields,
      mailboxInstanceId,
      outputRef,
      inputHash: `sha256:${inputHash}`,
      outputHash: `sha256:${outputHash}`,
      nextNodes,
    });
    await writeRawTextFile(
      path.join(artifactDir, "commit-message.txt"),
      `${buildCommitMessageTemplate(inputHash, outputHash, outputRef, nextNodes)}\n`,
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
          status: "succeeded",
          artifactDir,
          startedAt,
          endedAt,
          ...(stepExecutionAddress.promptVariant === undefined
            ? {}
            : { promptVariant: stepExecutionAddress.promptVariant }),
          inputJson,
          outputJson,
          inputHash: `sha256:${inputHash}`,
          outputHash: `sha256:${outputHash}`,
        },
        options,
      );
    } catch {}
    const consumedCommunicationsResult = await markCommunicationsConsumed(
      session,
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
        nodeExecutions: [...session.nodeExecutions, nodeExecution],
        lastError: consumedCommunicationsResult.error,
      };
      await saveSession(failed, options);
      return err({
        exitCode: 1,
        message: failed.lastError ?? "mailbox consumption persistence failed",
      });
    }
    const transitionCommunications = await Promise.all(
      selected.map((edge: any, index: number) =>
        persistCommunicationArtifact({
          artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
          runtimeLogOptions: options,
          workflowId: workflow.workflowId,
          workflowExecutionId: session.sessionId,
          communicationCounter: session.communicationCounter + index,
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
        }),
      ),
    );
    const {
      endedAt: _endedAt,
      lastError: _lastError,
      ...restSession
    } = session;
    const paused: WorkflowSessionState = {
      ...restSession,
      status: "paused",
      queue: dedupeNodeIds([...queue, ...nextNodes]),
      currentNodeId: nodeId,
      nodeExecutionCounter: nextExecutionCounter,
      nodeExecutionCounts: updatedCounts,
      nodeExecutions: [...session.nodeExecutions, nodeExecution],
      transitions: [
        ...session.transitions,
        ...selected.map((edge: any) => ({
          from: edge.from,
          to: edge.to,
          when: edge.when,
        })),
      ],
      communicationCounter:
        session.communicationCounter + transitionCommunications.length,
      communications: [
        ...consumedCommunicationsResult.value,
        ...transitionCommunications,
      ],
      scheduledEvents: [
        ...(session.scheduledEvents ?? []).filter(
          (entry: any) => entry.eventId !== eventId,
        ),
        {
          eventId,
          kind: "workflow-sleep",
          nodeId,
          nodeExecId,
          dueAt: dueAt.toISOString(),
          status: "pending",
          createdAt: startedAt,
        },
      ],
    };
    await saveSession(paused, options);
    registerWorkflowSleepResume({
      workflowName,
      session,
      nodePayload,
      nodeId,
      nodeExecId,
      stepExecutionAddress,
      options,
      eventId,
      dueAt,
    });
    return ok({ session: paused, exitCode: 4 });
  }
  if (nodePayload.nodeType === "user-action") {
    const startedAt = nowIso();
    const inputJson = stableJson({
      ...baseInputPayload,
      nodeType: "user-action",
      userAction: nodePayload.userAction,
      outputContract:
        nodePayload.output === undefined
          ? undefined
          : {
              description: nodePayload.output.description,
              jsonSchema: nodePayload.output.jsonSchema,
              maxValidationAttempts: nodePayload.output.maxValidationAttempts,
            },
    });
    await writeRawTextFile(
      path.join(artifactDir, "input.json"),
      `${inputJson}\n`,
    );
    const userActionDir = path.join(artifactDir, "user-action");
    const userActionId = `useract-${nodeExecId}`;
    await mkdir(userActionDir, { recursive: true });
    await writeJsonFile(path.join(userActionDir, "request.json"), {
      userActionId,
      workflowId: workflow.workflowId,
      workflowExecutionId: session.sessionId,
      nodeId,
      nodeExecId,
      promptText: assembledPromptText,
      userAction: nodePayload.userAction,
      outputContract: nodePayload.output,
      createdAt: startedAt,
      status: "waiting-for-reply",
    });
    await writeJsonFile(path.join(userActionDir, "resolution.json"), {
      status: "waiting-for-reply",
      updatedAt: startedAt,
    });
    const {
      endedAt: _endedAt,
      lastError: _lastError,
      ...restSession
    } = session;
    const paused: WorkflowSessionState = {
      ...restSession,
      status: "paused",
      queue,
      currentNodeId: nodeId,
      nodeExecutionCounter: nextExecutionCounter,
      nodeExecutionCounts: updatedCounts,
      pendingOptionalNodeDecisions: removePendingOptionalNodeDecision(
        session.pendingOptionalNodeDecisions ?? [],
        nodeId,
      ),
      activeUserActions: [
        ...(session.activeUserActions ?? []).filter(
          (entry: any) => entry.nodeId !== nodeId,
        ),
        {
          nodeId,
          nodeExecId,
          userActionId,
          artifactDir: userActionDir,
          status: "waiting-for-reply",
          pausedAt: startedAt,
        },
      ],
    };
    await saveSession(paused, options);
    return ok({ session: paused, exitCode: 4 });
  }
  if (skipOptionalNode) {
    const startedAt = nowIso();
    const endedAt = startedAt;
    const outputPayload = buildOptionalSkipOutput(
      pendingOptionalDecision?.reason,
    );
    const loopRule = loopRuleByJudgeNodeId.get(nodeId);
    let selected = (outgoingEdges.get(nodeId) ?? []).filter((edge: any) =>
      evaluateEdge(edge, outputPayload),
    );
    let updatedLoopIterationCounts = session.loopIterationCounts ?? {};
    if (loopRule !== undefined) {
      const effectiveLoopRule: LoopRule = {
        ...loopRule,
        maxIterations: loopRule.maxIterations ?? maxLoopIterations,
      };
      const iteration = session.loopIterationCounts?.[loopRule.id] ?? 0;
      const transition = resolveLoopTransition({
        loopRule: effectiveLoopRule,
        output: outputPayload,
        state: { loopId: loopRule.id, iteration },
      });
      if (transition === "continue") {
        selected = (outgoingEdges.get(nodeId) ?? []).filter(
          (edge: any) => edge.when === effectiveLoopRule.continueWhen,
        );
        updatedLoopIterationCounts = {
          ...(session.loopIterationCounts ?? {}),
          [loopRule.id]: iteration + 1,
        };
      } else if (transition === "exit") {
        selected = (outgoingEdges.get(nodeId) ?? []).filter(
          (edge: any) => edge.when === effectiveLoopRule.exitWhen,
        );
      }
    }
    const inputJson = stableJson({
      ...baseInputPayload,
      nodeType: executionNodePayload.nodeType ?? "agent",
      optionalDecision: "skip",
    });
    await writeRawTextFile(
      path.join(artifactDir, "input.json"),
      `${inputJson}\n`,
    );
    const nodeExecution: NodeExecutionRecord = {
      nodeId,
      ...stepIdentityFields,
      nodeExecId,
      executionOrdinal: nextExecutionCounter,
      mailboxInstanceId,
      status: "skipped",
      artifactDir,
      startedAt,
      endedAt,
      ...(stepExecutionAddress.promptVariant === undefined
        ? {}
        : { promptVariant: stepExecutionAddress.promptVariant }),
    };
    const outputRef = buildOutputRefForExecution({
      workflow,
      session,
      execution: nodeExecution,
    });
    const outputJson = stableJson(outputPayload);
    const outputRaw = `${outputJson}\n`;
    const inputHash = sha256Hex(inputJson);
    const outputHash = sha256Hex(outputJson);
    const nextNodes = selected.map((edge: any) => edge.to);
    await writeRawTextFile(path.join(artifactDir, "output.json"), outputRaw);
    await writeJsonFile(path.join(artifactDir, "meta.json"), {
      nodeId,
      ...stepIdentityFields,
      nodeExecId,
      mailboxInstanceId,
      status: "skipped",
      startedAt,
      endedAt,
      ...(stepExecutionAddress.promptVariant === undefined
        ? {}
        : { promptVariant: stepExecutionAddress.promptVariant }),
      optionalDecision: "skip",
    });
    await writeJsonFile(path.join(artifactDir, "handoff.json"), {
      schemaVersion: 1,
      generatedAt: endedAt,
      nodeId,
      ...stepIdentityFields,
      mailboxInstanceId,
      outputRef,
      inputHash: `sha256:${inputHash}`,
      outputHash: `sha256:${outputHash}`,
      nextNodes,
    });
    await writeRawTextFile(
      path.join(artifactDir, "commit-message.txt"),
      `${buildCommitMessageTemplate(inputHash, outputHash, outputRef, nextNodes)}\n`,
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
          status: "skipped",
          artifactDir,
          startedAt,
          endedAt,
          ...(stepExecutionAddress.promptVariant === undefined
            ? {}
            : { promptVariant: stepExecutionAddress.promptVariant }),
          inputJson,
          outputJson,
          inputHash: `sha256:${inputHash}`,
          outputHash: `sha256:${outputHash}`,
        },
        options,
      );
    } catch {}
    const consumedCommunicationsResult = await markCommunicationsConsumed(
      session,
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
        nodeExecutions: [...session.nodeExecutions, nodeExecution],
        lastError: consumedCommunicationsResult.error,
      };
      await saveSession(failed, options);
      return err({
        exitCode: 1,
        message: failed.lastError ?? "mailbox consumption persistence failed",
      });
    }
    let currentCommunications = consumedCommunicationsResult.value;
    const transitionCommunications = await Promise.all(
      selected.map((edge: any, index: number) => {
        return persistCommunicationArtifact({
          artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
          runtimeLogOptions: options,
          workflowId: workflow.workflowId,
          workflowExecutionId: session.sessionId,
          communicationCounter: session.communicationCounter + index,
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
    session = {
      ...session,
      status: "running",
      queue: dedupeNodeIds([...queue, ...nextNodes]),
      currentNodeId: nodeId,
      nodeExecutionCounter: nextExecutionCounter,
      nodeExecutionCounts: updatedCounts,
      loopIterationCounts: updatedLoopIterationCounts,
      transitions: [
        ...session.transitions,
        ...selected.map((edge: any) => ({
          from: edge.from,
          to: edge.to,
          when: edge.when,
        })),
      ],
      nodeExecutions: [...session.nodeExecutions, nodeExecution],
      communicationCounter:
        session.communicationCounter + transitionCommunications.length,
      communications: currentCommunications,
      runtimeVariables: isWorkflowOutputKindNode(workflow, nodeId)
        ? {
            ...session.runtimeVariables,
            workflowOutput: outputPayload["payload"],
          }
        : session.runtimeVariables,
      pendingOptionalNodeDecisions: removePendingOptionalNodeDecision(
        session.pendingOptionalNodeDecisions ?? [],
        nodeId,
      ),
    };
    await saveSession(session, options);
    return { kind: "done", session };
  }

  return { kind: "continue" };
}
