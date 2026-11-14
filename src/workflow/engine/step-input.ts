// @ts-nocheck
import { workflowRunnerDeps } from "./workflow-runner-deps";

const {
  mkdir,
  path,
  writeJsonFile,
  writeRawTextFile,
  nowIso,
  stableJson,
  removePendingOptionalNodeDecision,
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
} = workflowRunnerDeps;

export async function handlePreparedStepInput(input) {
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
    outputPayload: _unusedOutputPayload,
  } = input;
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
          (entry) => entry.nodeId !== nodeId,
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
    let selected = (outgoingEdges.get(nodeId) ?? []).filter((edge) =>
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
          (edge) => edge.when === effectiveLoopRule.continueWhen,
        );
        updatedLoopIterationCounts = {
          ...(session.loopIterationCounts ?? {}),
          [loopRule.id]: iteration + 1,
        };
      } else if (transition === "exit") {
        selected = (outgoingEdges.get(nodeId) ?? []).filter(
          (edge) => edge.when === effectiveLoopRule.exitWhen,
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
    const nextNodes = selected.map((edge) => edge.to);
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
      selected.map((edge, index) => {
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
        ...selected.map((edge) => ({
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
