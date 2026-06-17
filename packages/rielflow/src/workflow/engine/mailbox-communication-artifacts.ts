import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { atomicWriteTextFile as writeRawTextFile } from "../../shared/fs";
import { isAdapterExecutionOutputEnvelope } from "../adapter";
import {
  DEFAULT_SUPERVISER_WORKFLOW_ID,
  resolveSuperviserWorkflowId,
} from "../auto-improve-policy";
import { buildMergedContinuationTimeline } from "../history-continuation";
import { normalizeExternalMailboxBusinessPayload } from "../json-boundary";
import type { PromptCompositionLatestOutput } from "../node-execution-mailbox";
import { err, ok, type Result } from "../result";
import {
  listWorkflowMessagesFromRuntimeDb,
  markWorkflowMessagesConsumedInRuntimeDb,
  type RuntimeWorkflowMessageRecord,
  saveCommunicationEventToRuntimeDb,
  saveWorkflowMessageToRuntimeDb,
  workflowMessageRecordToCommunication,
} from "../runtime-db";
import {
  buildOutputRefForExecution,
  type CommunicationRecord,
  type NodeExecutionRecord,
  type OutputRef,
  type WorkflowSessionState,
} from "../session";
import type {
  AgentNodePayload,
  AutoImprovePolicy,
  LoadOptions,
  NodePayload,
  SupervisionRunState,
  WorkflowJson,
} from "../types";
import { asAgentNodePayload, resolveWorkflowManagerStepId } from "../types";
import type {
  UpstreamCommunicationConsumptionRef,
  UpstreamInput,
  UpstreamOutputRef,
} from "./types-and-session-state";
import {
  WORKFLOW_EXTERNAL_INPUT_NODE_ID,
  WORKFLOW_EXTERNAL_OUTPUT_NODE_ID,
  initialDeliveryAttemptId,
  nextCommunicationId,
  outputArtifactJsonText,
} from "./types-and-session-state";

function parseWorkflowMessagePayloadJson(
  payloadJson: string | null | undefined,
  communicationId: string,
  upstreamTargetNoun: string,
  nodeId: string,
): Result<Readonly<Record<string, unknown>>, string> {
  if (payloadJson === undefined || payloadJson === null) {
    return err(
      `failed to resolve upstream communication '${communicationId}' for ${upstreamTargetNoun} '${nodeId}': workflow_messages.payload_json is missing`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      `failed to resolve upstream communication '${communicationId}' for ${upstreamTargetNoun} '${nodeId}': workflow_messages.payload_json must be valid JSON: ${message}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return err(
      `failed to resolve upstream communication '${communicationId}' for ${upstreamTargetNoun} '${nodeId}': workflow_messages.payload_json must contain a JSON object`,
    );
  }
  return ok(parsed as Readonly<Record<string, unknown>>);
}

async function buildLocalUpstreamOutputRefsFromRuntimeDb(
  session: WorkflowSessionState,
  nodeId: string,
  options: LoadOptions,
): Promise<Result<readonly UpstreamOutputRef[], string>> {
  let sqliteMessages: readonly RuntimeWorkflowMessageRecord[];
  try {
    sqliteMessages = await listWorkflowMessagesFromRuntimeDb(
      { workflowExecutionId: session.sessionId, toNodeId: nodeId },
      options,
    );
  } catch (error) {
    return err(
      `failed to load workflow messages for execution '${session.sessionId}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const refs: UpstreamOutputRef[] = [];
  for (const record of sqliteMessages) {
    if (record.status !== "delivered") {
      continue;
    }
    const communication = workflowMessageRecordToCommunication(record);
    const payloadRef = communication.payloadRef;
    if (payloadRef.kind === "manager-message") {
      continue;
    }
    const execution = session.nodeExecutions.find(
      (candidate) => candidate.nodeExecId === communication.sourceNodeExecId,
    );
    refs.push({
      fromNodeId: communication.fromNodeId,
      transitionWhen: communication.transitionWhen,
      status: execution?.status ?? communication.status,
      communicationId: communication.communicationId,
      payloadJson: record.payloadJson,
      ...payloadRef,
    });
  }
  return ok(refs);
}

export async function buildMergedUpstreamOutputRefs(
  session: WorkflowSessionState,
  nodeId: string,
  continuationSnapshots: ReadonlyMap<string, WorkflowSessionState> | undefined,
  options: LoadOptions = {},
): Promise<Result<readonly UpstreamOutputRef[], string>> {
  const localRefsResult = await buildLocalUpstreamOutputRefsFromRuntimeDb(
    session,
    nodeId,
    options,
  );
  if (!localRefsResult.ok) {
    return err(localRefsResult.error);
  }
  const localRefs = localRefsResult.value;
  if (
    continuationSnapshots === undefined ||
    session.historyImports === undefined ||
    session.historyImports.length === 0
  ) {
    return ok(localRefs);
  }

  const timelineResult = buildMergedContinuationTimeline(
    continuationSnapshots,
    session.sessionId,
  );
  if (!timelineResult.ok) {
    return err(
      `merged continuation timeline resolution failed: ${timelineResult.error.message}`,
    );
  }
  const timeline = timelineResult.value;
  const importedExecKeys = new Set(
    timeline
      .filter(
        (entry) => entry.persistedWorkflowExecutionId !== session.sessionId,
      )
      .map(
        (entry) => `${entry.persistedWorkflowExecutionId}:${entry.stepRunId}`,
      ),
  );
  const positionByOwnerExec = new Map<string, number>();
  timeline.forEach((entry, index) => {
    positionByOwnerExec.set(
      `${entry.persistedWorkflowExecutionId}:${entry.stepRunId}`,
      index,
    );
  });

  const importedRefs: UpstreamOutputRef[] = [];
  for (const snapshot of continuationSnapshots.values()) {
    if (snapshot.sessionId === session.sessionId) {
      continue;
    }
    let snapshotCommunications: readonly RuntimeWorkflowMessageRecord[];
    try {
      snapshotCommunications = await listWorkflowMessagesFromRuntimeDb(
        { workflowExecutionId: snapshot.sessionId },
        options,
      );
    } catch (error) {
      return err(
        `failed to load continuation workflow messages for execution '${snapshot.sessionId}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    for (const record of snapshotCommunications) {
      const communication = workflowMessageRecordToCommunication(record);
      if (
        communication.status !== "delivered" ||
        communication.toNodeId !== nodeId ||
        !importedExecKeys.has(
          `${snapshot.sessionId}:${communication.sourceNodeExecId}`,
        )
      ) {
        continue;
      }
      const payloadRef = communication.payloadRef;
      if (payloadRef.kind === "manager-message") {
        continue;
      }
      const execution = snapshot.nodeExecutions.find(
        (candidate) => candidate.nodeExecId === communication.sourceNodeExecId,
      );
      importedRefs.push({
        fromNodeId: communication.fromNodeId,
        transitionWhen: communication.transitionWhen,
        status: execution?.status ?? communication.status,
        communicationId: communication.communicationId,
        payloadJson: record.payloadJson,
        ...payloadRef,
      });
    }
  }

  importedRefs.sort((left, right) => {
    const leftPos =
      positionByOwnerExec.get(
        `${left.workflowExecutionId}:${left.nodeExecId}`,
      ) ?? -1;
    const rightPos =
      positionByOwnerExec.get(
        `${right.workflowExecutionId}:${right.nodeExecId}`,
      ) ?? -1;
    if (leftPos !== rightPos) {
      return leftPos - rightPos;
    }
    return left.communicationId.localeCompare(right.communicationId);
  });

  return ok([...importedRefs, ...localRefs]);
}
export async function buildUpstreamInputs(
  workflow: WorkflowJson,
  session: WorkflowSessionState,
  nodeId: string,
  continuationSnapshots: ReadonlyMap<string, WorkflowSessionState> | undefined,
  options: LoadOptions = {},
): Promise<Result<readonly UpstreamInput[], string>> {
  const upstreamTargetNoun = workflow.steps !== undefined ? "step" : "node";
  const refsResult = await buildMergedUpstreamOutputRefs(
    session,
    nodeId,
    continuationSnapshots,
    options,
  );
  if (!refsResult.ok) {
    return err(refsResult.error);
  }
  const refs = refsResult.value;
  if (refs.length === 0) {
    return ok([]);
  }

  const loaded: UpstreamInput[] = [];
  for (const ref of refs) {
    const output = parseWorkflowMessagePayloadJson(
      ref.payloadJson,
      ref.communicationId,
      upstreamTargetNoun,
      nodeId,
    );
    if (!output.ok) {
      return err(output.error);
    }
    loaded.push({
      ...ref,
      output: output.value,
      outputRaw: ref.payloadJson ?? "",
    });
  }

  return ok(loaded);
}
export function resolveMailboxBusinessPayload(
  output: Readonly<Record<string, unknown>>,
): unknown {
  if (!isAdapterExecutionOutputEnvelope(output)) {
    return output;
  }
  if (output.completionPassed) {
    return output.payload;
  }
  return {
    completionPassed: output.completionPassed,
    when: output.when,
    payload: output.payload,
  };
}
export async function buildLatestOutputMailboxIndex(
  session: WorkflowSessionState,
  options: LoadOptions = {},
): Promise<Result<readonly PromptCompositionLatestOutput[], string>> {
  const latestByStep = new Map<string, NodeExecutionRecord>();
  for (const execution of session.nodeExecutions) {
    if (execution.status !== "succeeded") {
      continue;
    }
    latestByStep.set(execution.stepId ?? execution.nodeId, execution);
  }

  const latestExecutions = Array.from(latestByStep.values()).sort(
    (left, right) =>
      (left.executionOrdinal ?? 0) - (right.executionOrdinal ?? 0),
  );
  const latestOutputs: PromptCompositionLatestOutput[] = [];
  let messages: readonly RuntimeWorkflowMessageRecord[];
  try {
    messages = await listWorkflowMessagesFromRuntimeDb(
      { workflowExecutionId: session.sessionId },
      options,
    );
  } catch (error) {
    return err(
      `failed to load latest completed workflow message context for execution '${session.sessionId}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const messagesBySourceExec = new Map<string, RuntimeWorkflowMessageRecord>();
  for (const message of messages) {
    if (message.status !== "delivered" && message.status !== "consumed") {
      continue;
    }
    messagesBySourceExec.set(message.sourceNodeExecId, message);
  }
  for (const execution of latestExecutions) {
    const message = messagesBySourceExec.get(execution.nodeExecId);
    if (message === undefined) {
      continue;
    }
    const output = parseWorkflowMessagePayloadJson(
      message.payloadJson,
      message.communicationId,
      "latest completed output",
      execution.nodeId,
    );
    if (!output.ok) {
      return err(
        `failed to resolve latest completed output '${execution.nodeExecId}' for resolved workflow message context: ${output.error}`,
      );
    }
    latestOutputs.push({
      nodeId: execution.nodeId,
      nodeExecId: execution.nodeExecId,
      status: execution.status,
      artifactDir: execution.artifactDir,
      payload: resolveMailboxBusinessPayload(output.value),
      ...(execution.stepId === undefined ? {} : { stepId: execution.stepId }),
      ...(execution.nodeRegistryId === undefined
        ? {}
        : { nodeRegistryId: execution.nodeRegistryId }),
      ...(execution.mailboxInstanceId === undefined
        ? {}
        : { mailboxInstanceId: execution.mailboxInstanceId }),
    });
  }

  return ok(latestOutputs);
}
export function buildCommitMessageTemplate(
  inputHash: string,
  outputHash: string,
  ref: OutputRef,
  nextNodes: readonly string[],
): string {
  const summary = `chore(workflow): checkpoint node ${ref.outputNodeId}`;
  const nextNodeValue =
    nextNodes.length === 0 ? "(terminal)" : nextNodes.join(",");
  return [
    summary,
    "",
    "Node execution checkpoint for deterministic output-to-input handoff.",
    "",
    `Node-ID: ${ref.outputNodeId}`,
    `Run-ID: ${ref.workflowExecutionId}`,
    `Workflow-ID: ${ref.workflowId}`,
    `Node-Exec-ID: ${ref.nodeExecId}`,
    `Artifact-Dir: ${ref.artifactDir}`,
    `Input-Hash: sha256:${inputHash}`,
    `Output-Hash: sha256:${outputHash}`,
    `Next-Node: ${nextNodeValue}`,
  ].join("\n");
}
export interface CreateCommunicationInput {
  readonly artifactWorkflowRoot: string;
  readonly runtimeLogOptions?: LoadOptions;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly communicationCounter: number;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly routingScope: CommunicationRecord["routingScope"];
  readonly deliveryKind: CommunicationRecord["deliveryKind"];
  readonly transitionWhen: string;
  readonly sourceNodeExecId: string;
  readonly payloadRef: OutputRef;
  readonly outputRaw: string;
  readonly deliveredByNodeId: string;
  readonly createdAt: string;
}
export async function persistCommunicationArtifact(
  input: CreateCommunicationInput,
): Promise<CommunicationRecord> {
  const { getWorkflowTelemetry, messagePayloadTelemetryAttributes } =
    await import("../../telemetry");
  const telemetry = getWorkflowTelemetry();
  const communicationId = nextCommunicationId(input.communicationCounter + 1);
  const deliveryAttemptId = initialDeliveryAttemptId();
  const artifactDir = path.join(
    input.artifactWorkflowRoot,
    "executions",
    input.workflowExecutionId,
    "communications",
    communicationId,
  );
  await telemetry.startSpan(
    "rielflow.communication.deliver",
    {
      "workflow.id": input.workflowId,
      "workflow.execution.id": input.workflowExecutionId,
      "communication.from_node.id": input.fromNodeId,
      "communication.to_node.id": input.toNodeId,
      "communication.routing_scope": input.routingScope,
      "communication.delivery_kind": input.deliveryKind,
      "communication.source_node_exec.id": input.sourceNodeExecId,
      ...messagePayloadTelemetryAttributes({
        key: "communication.output",
        value: input.outputRaw,
        exportMessages: telemetry.config.exportMessages,
      }),
    },
    async () => undefined,
  );

  const communication: CommunicationRecord = {
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    communicationId,
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    routingScope: input.routingScope,
    sourceNodeExecId: input.sourceNodeExecId,
    payloadRef: input.payloadRef,
    deliveryKind: input.deliveryKind,
    transitionWhen: input.transitionWhen,
    status: "delivered",
    activeDeliveryAttemptId: deliveryAttemptId,
    deliveryAttemptIds: [deliveryAttemptId],
    createdAt: input.createdAt,
    deliveredAt: input.createdAt,
    artifactDir,
  };

  if (input.runtimeLogOptions !== undefined) {
    await saveWorkflowMessageToRuntimeDb(
      {
        communication,
        outputRaw: input.outputRaw,
        updatedAt: input.createdAt,
      },
      input.runtimeLogOptions,
    );
    try {
      await saveCommunicationEventToRuntimeDb(
        communication,
        input.runtimeLogOptions,
      );
    } catch {
      // runtime DB event logs are best-effort
    }
  }

  return communication;
}
export async function persistExternalMailboxInputCommunication(input: {
  readonly artifactWorkflowRoot: string;
  readonly runtimeLogOptions?: LoadOptions;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly communicationCounter: number;
  readonly deliveredByNodeId: string;
  readonly toNodeId: string;
  readonly humanInput: unknown;
  readonly createdAt: string;
}): Promise<CommunicationRecord> {
  const sourceNodeExecId = "external-input-000001";
  const externalArtifactDir = path.join(
    input.artifactWorkflowRoot,
    "executions",
    input.workflowExecutionId,
    "external-mailbox",
    "input",
  );
  const outputPayload = {
    provider: "external-mailbox",
    model: "workflow-input",
    promptText: "workflow input message delivery",
    completionPassed: true,
    when: { always: true },
    payload: normalizeExternalMailboxBusinessPayload(input.humanInput),
  };
  const outputRaw = outputArtifactJsonText(outputPayload);
  await mkdir(externalArtifactDir, { recursive: true });
  await writeRawTextFile(
    path.join(externalArtifactDir, "output.json"),
    outputRaw,
  );

  return persistCommunicationArtifact({
    artifactWorkflowRoot: input.artifactWorkflowRoot,
    ...(input.runtimeLogOptions === undefined
      ? {}
      : { runtimeLogOptions: input.runtimeLogOptions }),
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    communicationCounter: input.communicationCounter,
    fromNodeId: WORKFLOW_EXTERNAL_INPUT_NODE_ID,
    toNodeId: input.toNodeId,
    routingScope: "external-mailbox",
    deliveryKind: "external-input",
    transitionWhen: "external-mailbox:workflow-input",
    sourceNodeExecId,
    payloadRef: {
      kind: "node-output",
      workflowExecutionId: input.workflowExecutionId,
      workflowId: input.workflowId,
      outputNodeId: WORKFLOW_EXTERNAL_INPUT_NODE_ID,
      nodeExecId: sourceNodeExecId,
      artifactDir: externalArtifactDir,
    },
    outputRaw,
    deliveredByNodeId: input.deliveredByNodeId,
    createdAt: input.createdAt,
  });
}
export async function persistExternalMailboxOutputCommunication(input: {
  readonly artifactWorkflowRoot: string;
  readonly runtimeLogOptions?: LoadOptions;
  readonly workflow: WorkflowJson;
  readonly session: WorkflowSessionState;
  readonly execution: NodeExecutionRecord;
  readonly outputRaw: string;
  readonly communicationCounter: number;
  readonly createdAt: string;
}): Promise<CommunicationRecord> {
  return persistCommunicationArtifact({
    artifactWorkflowRoot: input.artifactWorkflowRoot,
    ...(input.runtimeLogOptions === undefined
      ? {}
      : { runtimeLogOptions: input.runtimeLogOptions }),
    workflowId: input.workflow.workflowId,
    workflowExecutionId: input.session.sessionId,
    communicationCounter: input.communicationCounter,
    fromNodeId: input.execution.nodeId,
    toNodeId: WORKFLOW_EXTERNAL_OUTPUT_NODE_ID,
    routingScope: "external-mailbox",
    deliveryKind: "external-output",
    transitionWhen: "external-mailbox:workflow-output",
    sourceNodeExecId: input.execution.nodeExecId,
    payloadRef: buildOutputRefForExecution({
      workflow: input.workflow,
      session: input.session,
      execution: input.execution,
    }),
    outputRaw: input.outputRaw,
    deliveredByNodeId: resolveWorkflowManagerStepId(input.workflow),
    createdAt: input.createdAt,
  });
}
export async function markCommunicationsConsumed(
  session: WorkflowSessionState,
  communicationRefs: readonly UpstreamCommunicationConsumptionRef[],
  consumedByNodeExecId: string,
  consumedAt: string,
  runtimeLogOptions?: LoadOptions,
): Promise<Result<readonly CommunicationRecord[], string>> {
  if (communicationRefs.length === 0) {
    return ok(session.communications);
  }

  const localConsumedSet = new Set(
    communicationRefs
      .filter((ref) => ref.workflowExecutionId === session.sessionId)
      .map((ref) => ref.communicationId),
  );
  const updates = session.communications.map((communication) =>
    localConsumedSet.has(communication.communicationId)
      ? {
          ...communication,
          status: "consumed" as const,
          consumedByNodeExecId,
          consumedAt,
        }
      : communication,
  );

  if (runtimeLogOptions !== undefined) {
    try {
      const communicationIdsByWorkflowExecutionId = new Map<
        string,
        Set<string>
      >();
      for (const ref of communicationRefs.filter(
        (entry) => entry.workflowExecutionId === session.sessionId,
      )) {
        let communicationIds = communicationIdsByWorkflowExecutionId.get(
          ref.workflowExecutionId,
        );
        if (communicationIds === undefined) {
          communicationIds = new Set<string>();
          communicationIdsByWorkflowExecutionId.set(
            ref.workflowExecutionId,
            communicationIds,
          );
        }
        communicationIds.add(ref.communicationId);
      }
      for (const [
        workflowExecutionId,
        communicationIds,
      ] of communicationIdsByWorkflowExecutionId) {
        await markWorkflowMessagesConsumedInRuntimeDb(
          {
            workflowExecutionId,
            communicationIds: [...communicationIds],
            consumedByNodeExecId,
            consumedAt,
          },
          runtimeLogOptions,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      return err(`failed to persist sqlite message consumption: ${message}`);
    }
  }

  return ok(updates);
}
export function isTerminalStatus(
  status: WorkflowSessionState["status"],
): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}
export function readBusinessPayload(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | null {
  const payload = value["payload"];
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  return payload as Readonly<Record<string, unknown>>;
}
export function cloneSession(
  session: WorkflowSessionState,
): WorkflowSessionState {
  const next: WorkflowSessionState = {
    ...session,
    queue: [...session.queue],
    nodeExecutionCounts: { ...session.nodeExecutionCounts },
    loopIterationCounts: { ...(session.loopIterationCounts ?? {}) },
    restartCounts: { ...(session.restartCounts ?? {}) },
    restartEvents: [...(session.restartEvents ?? [])],
    transitions: [...session.transitions],
    nodeExecutions: [...session.nodeExecutions],
    communicationCounter: session.communicationCounter,
    communications: [...session.communications],
    conversationTurns: [...(session.conversationTurns ?? [])],
    nodeBackendSessions: { ...(session.nodeBackendSessions ?? {}) },
    pendingOptionalNodeDecisions: [
      ...(session.pendingOptionalNodeDecisions ?? []),
    ],
    activeUserActions: [...(session.activeUserActions ?? [])],
    scheduledEvents: [...(session.scheduledEvents ?? [])],
    runtimeVariables: { ...session.runtimeVariables },
  };
  if (session.supervision === undefined) {
    return next;
  }
  return {
    ...next,
    supervision: {
      ...session.supervision,
      incidents: [...session.supervision.incidents],
      ...(session.supervision.remediations === undefined
        ? {}
        : { remediations: [...session.supervision.remediations] }),
    },
  };
}
export function createInitialSupervisionRunState(input: {
  readonly policy: AutoImprovePolicy;
  readonly targetWorkflowId: string;
}): SupervisionRunState {
  const superviserWorkflowId = resolveSuperviserWorkflowId(
    input.policy.superviserWorkflowId,
  );
  return {
    supervisionRunId: `sup-${randomBytes(10).toString("hex")}`,
    targetWorkflowId: input.targetWorkflowId,
    superviserWorkflowId: superviserWorkflowId.ok
      ? superviserWorkflowId.value
      : DEFAULT_SUPERVISER_WORKFLOW_ID,
    status: "running",
    attemptCount: 1,
    workflowPatchCount: 0,
    policy: input.policy,
    incidents: [],
    remediations: [],
  };
}
export function cloneSupervisionForContinuedRun(
  source: SupervisionRunState,
  policy: AutoImprovePolicy,
): SupervisionRunState {
  const superviserWorkflowId = resolveSuperviserWorkflowId(
    policy.superviserWorkflowId,
  );
  return {
    ...source,
    superviserWorkflowId: superviserWorkflowId.ok
      ? superviserWorkflowId.value
      : DEFAULT_SUPERVISER_WORKFLOW_ID,
    status: "running",
    policy,
    incidents: [...source.incidents],
    ...(source.remediations === undefined
      ? {}
      : { remediations: [...source.remediations] }),
  };
}
export function buildScenarioExecutableNodePayload(
  node: NodePayload,
  hasScenarioEntry: boolean,
  allowScenarioFallback: boolean,
  allowDryRun: boolean,
): AgentNodePayload | null {
  const agentNodePayload = asAgentNodePayload(node);
  if (agentNodePayload !== null) {
    return agentNodePayload;
  }

  if (
    node.managerType === "code" &&
    (allowScenarioFallback || allowDryRun) &&
    node.promptTemplate !== undefined
  ) {
    return {
      ...node,
      nodeType: "agent",
      model: node.model ?? "deterministic-code-manager",
      promptTemplate: node.promptTemplate,
    };
  }

  if (
    hasScenarioEntry &&
    (node.nodeType === "command" ||
      node.nodeType === "container" ||
      node.nodeType === "addon")
  ) {
    const { nodeType: _nodeType, ...rest } = node;
    return {
      ...rest,
      nodeType: "agent",
      model: `scenario/${node.nodeType}`,
      promptTemplate: node.promptTemplate ?? "",
    };
  }

  return null;
}
